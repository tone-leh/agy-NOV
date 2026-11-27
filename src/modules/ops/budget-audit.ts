import fs from 'node:fs';
import path from 'node:path';
import {
  countEnabledModelTools,
  createDefaultConfig,
  loadNovConfigReadOnly,
  MODULE_IDS,
  type TeamPresetAuditResult,
} from '../../core/config.js';
import { canonicalRealpathSync, isPathInsideDir } from '../../core/fs-safe.js';
import {
  isSensitiveCrossClientFile,
  sanitizeCrossClientFinding,
  sanitizeDisplayPath,
} from './paths.js';
import {
  RULE_AGGREGATE_TOKEN_LIMIT,
  RULE_SINGLE_FILE_LIMIT_BYTES,
  TOOL_BUDGET_HARD_LIMIT,
  type AuditRecommendation,
  type AuditWorkspaceOptions,
  type CrossClientFinding,
  type McpHealthFinding,
  type ModuleStorageStat,
  type OpsSecurityFinding,
  type RuleBloatAssessment,
  type RuleBloatOffender,
  type StorageAuditSummary,
  type ToolBudgetAssessment,
  type WorkspaceAssetEntry,
} from './types.js';

function measureDirReadOnly(
  targetDir: string,
  allowedRootReal: string,
  maxDepth = 5,
): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  const visited = new Set<string>();

  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let realDir: string;
    try {
      realDir = canonicalRealpathSync(dir);
    } catch {
      return;
    }
    if (!isPathInsideDir(allowedRootReal, realDir)) return;
    if (visited.has(realDir)) return;
    visited.add(realDir);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(realDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(realDir, entry.name);
      try {
        const lstat = fs.lstatSync(full);
        if (lstat.isSymbolicLink()) {
          // Never follow symlinks when auditing storage
          continue;
        }
        if (lstat.isDirectory()) {
          walk(full, depth + 1);
        } else if (lstat.isFile()) {
          bytes += lstat.size;
          files += 1;
        }
      } catch {
        // ignore inaccessible entry
      }
    }
  };

  walk(targetDir, 0);
  return { bytes, files };
}

export function auditStorageReadOnly(rootDataDir: string | undefined): StorageAuditSummary {
  if (!rootDataDir || !fs.existsSync(rootDataDir)) {
    return {
      rootDataDirExists: false,
      totalBytes: 0,
      totalFiles: 0,
      modules: [],
    };
  }

  let realDataRoot: string;
  try {
    realDataRoot = canonicalRealpathSync(path.resolve(rootDataDir));
  } catch {
    return {
      rootDataDirExists: false,
      totalBytes: 0,
      totalFiles: 0,
      modules: [],
    };
  }

  const modulesDir = path.join(realDataRoot, 'modules');
  const modules: ModuleStorageStat[] = [];
  const seenModuleDirs = new Set<string>();

  if (fs.existsSync(modulesDir)) {
    try {
      const entries = fs.readdirSync(modulesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        seenModuleDirs.add(entry.name);
        const stat = measureDirReadOnly(path.join(modulesDir, entry.name), realDataRoot, 5);
        modules.push({
          moduleId: entry.name,
          bytes: stat.bytes,
          files: stat.files,
        });
      }
    } catch {
      // ignore
    }
  }

  for (const id of MODULE_IDS) {
    if (!seenModuleDirs.has(id)) {
      modules.push({ moduleId: id, bytes: 0, files: 0 });
    }
  }

  modules.sort((a, b) => b.bytes - a.bytes || a.moduleId.localeCompare(b.moduleId));

  const rootTotal = measureDirReadOnly(realDataRoot, realDataRoot, 6);
  return {
    rootDataDirExists: true,
    totalBytes: rootTotal.bytes,
    totalFiles: rootTotal.files,
    modules,
  };
}

function isRuleBloatTarget(asset: WorkspaceAssetEntry): boolean {
  if (asset.kind === 'rules') return true;
  const lower = asset.relPath.toLowerCase();
  if (
    (lower.startsWith('.agents/rules/') || lower.startsWith('.gemini/')) &&
    (lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.txt'))
  ) {
    return true;
  }
  return false;
}

export function assessRuleBloat(assets: readonly WorkspaceAssetEntry[]): RuleBloatAssessment {
  const ruleAssets = assets.filter(isRuleBloatTarget);
  const singleWarnBytes = Math.floor(RULE_SINGLE_FILE_LIMIT_BYTES * 0.8);
  const aggregateWarnTokens = Math.floor(RULE_AGGREGATE_TOKEN_LIMIT * 0.8);

  let largestFileBytes = 0;
  let largestFilePath: string | undefined;
  let totalRuleBytes = 0;
  let totalRuleTokens = 0;
  const offendingFiles: RuleBloatOffender[] = [];

  for (const r of ruleAssets) {
    totalRuleBytes += r.bytes;
    totalRuleTokens += r.estimatedTokens;
    if (r.bytes > largestFileBytes) {
      largestFileBytes = r.bytes;
      largestFilePath = r.relPath;
    }
    if (r.bytes > RULE_SINGLE_FILE_LIMIT_BYTES) {
      offendingFiles.push({
        path: r.relPath,
        bytes: r.bytes,
        estimatedTokens: r.estimatedTokens,
        reason: `Exceeds 24 KB single-file limit (${(r.bytes / 1024).toFixed(1)} KB); may trigger false 429 retry loops.`,
      });
    } else if (r.bytes >= singleWarnBytes) {
      offendingFiles.push({
        path: r.relPath,
        bytes: r.bytes,
        estimatedTokens: r.estimatedTokens,
        reason: `Approaching 24 KB single-file limit (${(r.bytes / 1024).toFixed(1)} KB, >= 80%).`,
      });
    }
  }

  let ruleBloatStatus: 'ok' | 'warn' | 'critical' = 'ok';
  if (largestFileBytes > RULE_SINGLE_FILE_LIMIT_BYTES || totalRuleTokens > RULE_AGGREGATE_TOKEN_LIMIT) {
    ruleBloatStatus = 'critical';
    if (offendingFiles.length === 0 && totalRuleTokens > RULE_AGGREGATE_TOKEN_LIMIT) {
      const topRules = [...ruleAssets].sort((a, b) => b.estimatedTokens - a.estimatedTokens).slice(0, 3);
      for (const r of topRules) {
        offendingFiles.push({
          path: r.relPath,
          bytes: r.bytes,
          estimatedTokens: r.estimatedTokens,
          reason: `Contributes to aggregate rule bloat (~${totalRuleTokens} > 20,000 tokens); may trigger false 429 retry loops.`,
        });
      }
    }
  } else if (largestFileBytes >= singleWarnBytes || totalRuleTokens >= aggregateWarnTokens) {
    ruleBloatStatus = 'warn';
  }

  return {
    status: ruleBloatStatus,
    singleFileLimitBytes: 24576,
    aggregateTokenLimit: 20000,
    largestFileBytes,
    ...(largestFilePath ? { largestFilePath } : {}),
    totalRuleBytes,
    totalRuleTokens,
    offendingFiles,
  };
}

function resolveEnabledNovTools(
  rootDataDir: string | undefined,
  optsOrCount?: number | AuditWorkspaceOptions,
): number {
  const explicit =
    typeof optsOrCount === 'number' ? optsOrCount : optsOrCount?.enabledNovTools;
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit >= 0) {
    return Math.floor(explicit);
  }
  if (rootDataDir) {
    try {
      const cfg = loadNovConfigReadOnly(rootDataDir);
      return countEnabledModelTools(cfg.modules);
    } catch {
      // fall through to default config count
    }
  }
  return countEnabledModelTools(createDefaultConfig().modules);
}

export function assessToolBudget(
  rootDataDir: string | undefined,
  optsOrEnabledNovTools: number | AuditWorkspaceOptions | undefined,
  externalServersCount: number,
  estimatedExternalTools: number,
): ToolBudgetAssessment {
  const agyNovTools = resolveEnabledNovTools(rootDataDir, optsOrEnabledNovTools);
  const estimatedTotalTools = agyNovTools + estimatedExternalTools;
  const usagePercent = Math.round((estimatedTotalTools / TOOL_BUDGET_HARD_LIMIT) * 100);
  const toolBudgetStatus: 'ok' | 'warn' | 'critical' =
    estimatedTotalTools >= 95 ? 'critical' : estimatedTotalTools >= 75 ? 'warn' : 'ok';

  return {
    agyNovTools,
    externalServersCount,
    estimatedExternalTools,
    estimatedTotalTools,
    hardLimit: 100,
    usagePercent,
    status: toolBudgetStatus,
  };
}

export interface CrossClientScanCallbacks {
  walkBounded: (
    relBaseDir: string,
    maxDepth: number,
    onFile: (fullPath: string, entryName: string) => void,
  ) => void;
  onSkippedSymlink: () => void;
  onSkippedSensitive: () => void;
  pushFinding: (finding: CrossClientFinding) => void;
}

export function scanCrossClientWorkspaceFiles(
  realRoot: string,
  cb: CrossClientScanCallbacks,
): void {
  const claudeCommands: string[] = [];
  const claudeRules: string[] = [];
  const claudeSettings: string[] = [];
  const cursorRules: string[] = [];
  const codexFiles: string[] = [];

  const verifySafeCrossClientEntry = (fullPath: string): string | null => {
    const rel = path.relative(realRoot, fullPath).replace(/\\/g, '/');
    if (isSensitiveCrossClientFile(rel)) {
      cb.onSkippedSensitive();
      return null;
    }
    let realTarget: string;
    try {
      realTarget = canonicalRealpathSync(fullPath);
    } catch {
      cb.onSkippedSymlink();
      return null;
    }
    if (!isPathInsideDir(realRoot, realTarget)) {
      cb.onSkippedSymlink();
      return null;
    }
    const realRel = path.relative(realRoot, realTarget).replace(/\\/g, '/');
    if (isSensitiveCrossClientFile(realRel)) {
      cb.onSkippedSensitive();
      return null;
    }
    try {
      const st = fs.statSync(realTarget);
      if (!st.isFile()) return null;
    } catch {
      return null;
    }
    return rel;
  };

  cb.walkBounded('.claude', 4, (fullPath) => {
    const rel = verifySafeCrossClientEntry(fullPath);
    if (!rel) return;
    const lower = rel.toLowerCase();
    if (/^\.claude\/commands\/.+\.(?:md|mdx|txt)$/.test(lower)) {
      claudeCommands.push(rel);
    } else if (/^\.claude\/rules\/.+\.(?:md|mdx|txt)$/.test(lower)) {
      claudeRules.push(rel);
    } else if (/^\.claude\/settings(?:\.local)?\.json$/.test(lower)) {
      claudeSettings.push(rel);
    }
  });

  cb.walkBounded('.cursor/rules', 4, (fullPath) => {
    const rel = verifySafeCrossClientEntry(fullPath);
    if (!rel) return;
    if (/\.(?:mdc|md|mdx|txt)$/i.test(rel)) {
      cursorRules.push(rel);
    }
  });

  cb.walkBounded('.codex', 4, (fullPath) => {
    const rel = verifySafeCrossClientEntry(fullPath);
    if (!rel) return;
    const lower = rel.toLowerCase();
    if (
      lower === '.codex/config.toml' ||
      /\.(?:md|mdx|txt)$/i.test(lower) ||
      /^\.codex\/rules\/.+\.toml$/i.test(lower)
    ) {
      codexFiles.push(rel);
    }
  });

  const formatFilePreview = (list: readonly string[]): string => {
    const head = list.slice(0, 3).map((p) => sanitizeDisplayPath(p));
    return list.length > 3 ? `${head.join(', ')}, +${list.length - 3} more` : head.join(', ');
  };

  const pushSafe = (finding: CrossClientFinding) =>
    cb.pushFinding(sanitizeCrossClientFinding(finding));

  if (claudeCommands.length > 0) {
    pushSafe({
      severity: 'info',
      code: 'cross-client-commands',
      client: 'claude',
      file: claudeCommands.length === 1 ? claudeCommands[0] : '.claude/commands/',
      message: `Detected ${claudeCommands.length} Claude custom command file(s) (${formatFilePreview(claudeCommands)}).`,
      suggestion:
        'Mirror reusable slash commands as skills/*/SKILL.md or Ops Prompt Vault templates so Antigravity and Claude Code stay aligned.',
    });
  }

  if (claudeRules.length > 0) {
    pushSafe({
      severity: 'info',
      code: 'cross-client-rules',
      client: 'claude',
      file: claudeRules.length === 1 ? claudeRules[0] : '.claude/rules/',
      message: `Detected ${claudeRules.length} Claude rule file(s) (${formatFilePreview(claudeRules)}).`,
      suggestion:
        'Consolidate shared engineering rules into root AGENTS.md (or on-demand skills/) so Antigravity and Claude Code share one source of truth.',
    });
  }

  if (claudeSettings.length > 0) {
    pushSafe({
      severity: 'info',
      code: 'cross-client-rules',
      client: 'claude',
      file: claudeSettings.length === 1 ? claudeSettings[0] : '.claude/settings.json',
      message: `Detected Claude workspace settings (${formatFilePreview(claudeSettings)}); file values are not read or echoed.`,
      suggestion:
        'Share neutral team presets and safe verifyCommands via .agy-nov.json while keeping client-specific settings isolated.',
    });
  }

  if (cursorRules.length > 0) {
    pushSafe({
      severity: 'info',
      code: 'cross-client-rules',
      client: 'cursor',
      file: cursorRules.length === 1 ? cursorRules[0] : '.cursor/rules/',
      message: `Detected ${cursorRules.length} Cursor rule file(s) (${formatFilePreview(cursorRules)}).`,
      suggestion:
        'Keep shared workspace rules in AGENTS.md or modular skills/ so Antigravity and Cursor coexist without rule drift.',
    });
  }

  if (codexFiles.length > 0) {
    pushSafe({
      severity: 'info',
      code: 'cross-client-rules',
      client: 'codex',
      file: codexFiles.length === 1 ? codexFiles[0] : '.codex/',
      message: `Detected ${codexFiles.length} Codex config/rule file(s) (${formatFilePreview(codexFiles)}); configuration values are never echoed.`,
      suggestion:
        'Coexist cleanly by using root AGENTS.md as the canonical rule file alongside optional read-only .agy-nov.json team presets.',
    });
  }
}

export interface BuildRecommendationsInput {
  assets: readonly WorkspaceAssetEntry[];
  totalEstimatedTokens: number;
  skippedSymlinks: number;
  mcpLiteralEnvCount: number;
  ruleBloat: RuleBloatAssessment;
  toolBudget: ToolBudgetAssessment;
  mcpHealthFindings: readonly McpHealthFinding[];
  teamPreset: TeamPresetAuditResult;
  storage: StorageAuditSummary;
  securityFindings: readonly OpsSecurityFinding[];
  securityScore: number;
}

export function buildAuditRecommendations(
  input: BuildRecommendationsInput,
): { recommendations: AuditRecommendation[]; healthScore: number } {
  const {
    assets,
    totalEstimatedTokens,
    skippedSymlinks,
    mcpLiteralEnvCount,
    ruleBloat,
    toolBudget,
    mcpHealthFindings,
    teamPreset,
    storage,
    securityFindings,
    securityScore,
  } = input;

  const recommendations: AuditRecommendation[] = [];
  let penalty = 0;

  if (ruleBloat.status === 'critical') {
    penalty += 25;
    recommendations.push({
      level: 'critical',
      code: 'ops.rule-bloat',
      title: 'Rule bloat exceeds 24 KB / 20K token safety limit',
      detail: `Largest rule file ${ruleBloat.largestFilePath ?? '(rules)'} is ${(ruleBloat.largestFileBytes / 1024).toFixed(1)} KB; aggregate rules total ~${ruleBloat.totalRuleTokens} tokens. Oversized always-on rules can trigger false 429 retry loops — split reference content into on-demand skills.`,
    });
  } else if (ruleBloat.status === 'warn') {
    penalty += 12;
    recommendations.push({
      level: 'warn',
      code: 'ops.rule-bloat-warn',
      title: 'Rule files approaching 24 KB / 20K token ceiling (>= 80%)',
      detail: `Largest rule file ${ruleBloat.largestFilePath ?? '(rules)'} is ${(ruleBloat.largestFileBytes / 1024).toFixed(1)} KB; aggregate rules total ~${ruleBloat.totalRuleTokens} tokens. Trim redundant instructions to prevent false 429 retry loops.`,
    });
  }

  if (toolBudget.status === 'critical') {
    penalty += 20;
    recommendations.push({
      level: 'critical',
      code: 'ops.tool-budget',
      title: `Tool budget critical (${toolBudget.estimatedTotalTools}/100 tools)`,
      detail: `Estimated ${toolBudget.estimatedTotalTools} active tools (agy-NOV ${toolBudget.agyNovTools} + ${toolBudget.externalServersCount} external MCP server(s) ~${toolBudget.estimatedExternalTools}) approaches or exceeds the 100-tool hard ceiling. Disable unused modules or external MCP servers.`,
    });
  } else if (toolBudget.status === 'warn') {
    penalty += 10;
    recommendations.push({
      level: 'warn',
      code: 'ops.tool-budget-warn',
      title: `Tool budget elevated (${toolBudget.estimatedTotalTools}/100 tools)`,
      detail: `Estimated ${toolBudget.estimatedTotalTools} active tools (${toolBudget.usagePercent}% of the 100-tool hard ceiling). Keep unused modules switched off for headroom.`,
    });
  }

  const mcpErrorCount = mcpHealthFindings.filter((f) => f.severity === 'error').length;
  if (mcpErrorCount > 0) {
    penalty += Math.min(24, mcpErrorCount * 8);
    recommendations.push({
      level: 'warn',
      code: 'ops.mcp-health-errors',
      title: `MCP static health check found ${mcpErrorCount} configuration error(s)`,
      detail: `Inspect mcpHealthFindings for missing local scripts, invalid JSON, or missing transport fields.`,
    });
  }

  if (totalEstimatedTokens > 8000) {
    penalty += 15;
    recommendations.push({
      level: 'warn',
      code: 'ops.high-context-budget',
      title: 'Workspace rule & skill context budget is elevated',
      detail: `Scanned assets total ~${totalEstimatedTokens} tokens (> 8,000). Trim verbose rule sections or move reference docs into on-demand skills.`,
    });
  }

  const oversizedDocs = assets.filter(
    (a) => (a.kind === 'rules' || a.kind === 'skill') && a.estimatedTokens > 3000,
  );
  for (const doc of oversizedDocs.slice(0, 3)) {
    penalty += 10;
    recommendations.push({
      level: 'warn',
      code: 'ops.large-instruction-file',
      title: `Large instruction file: ${doc.relPath}`,
      detail: `${doc.relPath} is ~${doc.estimatedTokens} tokens (${doc.lineCount} lines). Split stable policy from reference appendices.`,
    });
  }

  if (skippedSymlinks > 0) {
    penalty += 10;
    recommendations.push({
      level: 'warn',
      code: 'ops.symlink-escape-skipped',
      title: 'Out-of-workspace symlink(s) skipped',
      detail: `Skipped ${skippedSymlinks} symlink(s) resolving outside the workspace boundary during read-only audit.`,
    });
  }

  if (mcpLiteralEnvCount > 0) {
    penalty += 15;
    recommendations.push({
      level: 'warn',
      code: 'ops.mcp-literal-env',
      title: 'Literal env values detected in MCP config',
      detail: `Detected ${mcpLiteralEnvCount} non-placeholder env value(s) in MCP config (values redacted). Prefer environment variable references instead of hardcoded tokens.`,
    });
  }

  if (teamPreset.found && !teamPreset.valid) {
    penalty += 10;
    recommendations.push({
      level: 'warn',
      code: 'ops.team-preset-invalid',
      title: 'Team preset (.agy-nov.json) failed validation',
      detail: teamPreset.errors.join(' '),
    });
  } else if (teamPreset.found && teamPreset.warnings.length > 0) {
    recommendations.push({
      level: 'warn',
      code: 'ops.team-preset-warnings',
      title: `Team preset (.agy-nov.json) has ${teamPreset.warnings.length} security/schema warning(s)`,
      detail: teamPreset.warnings.slice(0, 3).join(' '),
    });
  }

  if (storage.totalBytes > 50 * 1024 * 1024) {
    penalty += 10;
    recommendations.push({
      level: 'info',
      code: 'ops.storage-growth',
      title: 'Local agy-NOV storage exceeds 50 MiB',
      detail: `Current data directory size is ${(storage.totalBytes / (1024 * 1024)).toFixed(1)} MiB across ${storage.totalFiles} files. Consider pruning old snapshots or completed sessions.`,
    });
  }

  const highSecurityCount = securityFindings.filter((f) => f.severity === 'high').length;
  if (highSecurityCount > 0) {
    recommendations.push({
      level: 'critical',
      code: 'ops.static-security-findings',
      title: `Static security audit detected ${highSecurityCount} high-severity risk(s) (score ${securityScore}/100)`,
      detail: `Inspect securityFindings for prompt-injection, unrestricted command allowlists, risky hooks, or hardcoded MCP credentials.`,
    });
  } else if (securityFindings.length > 0) {
    recommendations.push({
      level: 'warn',
      code: 'ops.static-security-findings',
      title: `Static security audit detected ${securityFindings.length} finding(s) (score ${securityScore}/100)`,
      detail: `Review securityFindings for recommended hardening across workspace rules, hooks, and MCP endpoints.`,
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      level: 'info',
      code: 'ops.healthy',
      title: 'Workspace asset footprint looks healthy',
      detail: `Scanned ${assets.length} asset(s) (~${totalEstimatedTokens} tokens) with zero boundary violations.`,
    });
  }

  return {
    recommendations,
    healthScore: Math.max(10, 100 - penalty),
  };
}
