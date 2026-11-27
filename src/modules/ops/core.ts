import fs from 'node:fs';
import path from 'node:path';
import { loadTeamPresetReadOnly } from '../../core/config.js';
import { canonicalRealpathSync, isPathInsideDir } from '../../core/fs-safe.js';
import {
  assessRuleBloat,
  assessToolBudget,
  auditStorageReadOnly,
  buildAuditRecommendations,
  scanCrossClientWorkspaceFiles,
} from './budget-audit.js';
import { inspectMcpConfigSafe } from './mcp-health.js';
import { buildCrossClientMigrationPreviewReadOnly } from './migration.js';
import {
  isSensitiveOpsPath,
  sanitizeCrossClientFinding,
  sanitizeMcpIdentifier,
} from './paths.js';
import { auditStaticSecurityReadOnly } from './security-audit.js';
import type {
  AuditWorkspaceOptions,
  CrossClientFinding,
  McpHealthFinding,
  WorkspaceAssetEntry,
  WorkspaceAssetKind,
  WorkspaceAuditReport,
} from './types.js';

// Re-export public types, constants, prompt vault, security audit, migration preview, and demo APIs
export * from './types.js';
export {
  buildPromptRecordFromInput,
  BUILTIN_PROMPTS,
  deletePromptTemplate,
  extractTemplateVariables,
  filterPromptTemplates,
  getPromptsFilePath,
  listPromptTemplates,
  loadCustomPromptsReadOnly,
  mergePromptTemplates,
  renderPromptTemplate,
  savePromptTemplate,
} from './prompts.js';
export { isSensitiveOpsPath } from './paths.js';
export { calculateSecurityScore } from './security-audit.js';
export { summarizeMigrationPreview } from './migration.js';
export { createDemoOpsAuditReport, createDemoWorkspaceAudit } from './demo.js';

const ALLOWED_AGENT_CONFIG_EXTS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
]);

const MAX_AUDIT_FILE_BYTES = 1024 * 1024; // 1 MiB cap per config/doc file

const FIXED_WORKSPACE_ASSET_CANDIDATES: ReadonlyArray<{ rel: string; kind: WorkspaceAssetKind }> = [
  { rel: 'AGENTS.md', kind: 'rules' },
  { rel: 'CLAUDE.md', kind: 'rules' },
  { rel: 'GEMINI.md', kind: 'rules' },
  { rel: '.cursorrules', kind: 'rules' },
  { rel: '.windsurfrules', kind: 'rules' },
  { rel: 'plugin.json', kind: 'manifest' },
  { rel: '.claude-plugin/plugin.json', kind: 'manifest' },
  { rel: 'mcp_config.json', kind: 'mcp' },
  { rel: '.mcp.json', kind: 'mcp' },
  { rel: '.cursor/mcp.json', kind: 'mcp' },
  { rel: '.vscode/mcp.json', kind: 'mcp' },
  { rel: '.antigravity/mcp.json', kind: 'mcp' },
  { rel: '.gemini/mcp_config.json', kind: 'mcp' },
  { rel: 'hooks.json', kind: 'hooks' },
  { rel: 'hooks/hooks.json', kind: 'hooks' },
];

/**
 * 100% read-only audit of workspace agent assets (rules/skills/manifests/MCP/hooks/.agents/.gemini),
 * 24KB/20K rule bloat guard, 100-tool budget meter, MCP static health check, and agy-NOV local storage footprint.
 * Zero disk writes, strict realpath containment, and zero echoing of sensitive env values or secret files.
 */
export function auditWorkspaceAssets(
  workspaceRoot: string,
  rootDataDir?: string,
  optsOrEnabledNovTools?: number | AuditWorkspaceOptions,
): WorkspaceAuditReport {
  const realRoot = canonicalRealpathSync(path.resolve(workspaceRoot));
  const workspaceName = path.basename(realRoot) || 'workspace';

  const assets: WorkspaceAssetEntry[] = [];
  const seenRealPaths = new Set<string>();
  const seenMcpServerFiles = new Map<string, string>();
  const seenManifestNames = new Map<string, string>();
  const mcpHealthFindings: McpHealthFinding[] = [];
  const crossClientFindings: CrossClientFinding[] = [];
  const pushCrossClientFinding = (finding: CrossClientFinding): void => {
    crossClientFindings.push(sanitizeCrossClientFinding(finding));
  };
  let skippedSymlinks = 0;
  let skippedSensitive = 0;
  let mcpLiteralEnvCount = 0;
  let externalServersCount = 0;
  let estimatedExternalTools = 0;

  const isInsideWorkspace = (realCandidate: string): boolean =>
    isPathInsideDir(realRoot, realCandidate);

  const inspectFile = (candidatePath: string, kind: WorkspaceAssetKind): void => {
    const rawRel = path.relative(realRoot, candidatePath).replace(/\\/g, '/');
    if (isSensitiveOpsPath(rawRel)) {
      skippedSensitive += 1;
      return;
    }

    let lstat: fs.Stats;
    try {
      lstat = fs.lstatSync(candidatePath);
    } catch {
      return;
    }

    let realPath = candidatePath;
    if (lstat.isSymbolicLink()) {
      try {
        realPath = canonicalRealpathSync(candidatePath);
      } catch {
        skippedSymlinks += 1;
        return;
      }
      if (!isInsideWorkspace(realPath)) {
        skippedSymlinks += 1;
        return;
      }
    } else {
      try {
        realPath = canonicalRealpathSync(candidatePath);
      } catch {
        return;
      }
      if (!isInsideWorkspace(realPath)) {
        skippedSymlinks += 1;
        return;
      }
    }

    const realRel = path.relative(realRoot, realPath).replace(/\\/g, '/');
    if (isSensitiveOpsPath(realRel)) {
      skippedSensitive += 1;
      return;
    }

    if (seenRealPaths.has(realPath)) return;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(realPath);
    } catch {
      return;
    }
    if (!stat.isFile() || stat.size > MAX_AUDIT_FILE_BYTES) return;

    let text: string;
    try {
      const buf = fs.readFileSync(realPath);
      const inspectLen = Math.min(buf.length, 4096);
      for (let i = 0; i < inspectLen; i += 1) {
        if (buf[i] === 0) return; // skip binary
      }
      text = buf.toString('utf8');
    } catch {
      return;
    }

    seenRealPaths.add(realPath);

    let meta: Record<string, unknown> | undefined;
    if (kind === 'mcp') {
      const mcpInfo = inspectMcpConfigSafe(
        text,
        rawRel,
        realPath,
        realRoot,
        seenMcpServerFiles,
      );
      mcpLiteralEnvCount += mcpInfo.envKeyCount;
      externalServersCount += mcpInfo.activeExternalServers;
      estimatedExternalTools += mcpInfo.estimatedExternalTools;
      if (mcpInfo.findings.length > 0) {
        mcpHealthFindings.push(...mcpInfo.findings);
      }
      if (mcpInfo.crossClientFindings.length > 0) {
        crossClientFindings.push(...mcpInfo.crossClientFindings);
      }
      meta = {
        serverCount: mcpInfo.serverCount,
        serverNames: mcpInfo.serverNames,
        literalEnvEntries: mcpInfo.envKeyCount,
        estimatedTools: mcpInfo.estimatedExternalTools,
      };
    } else if (kind === 'manifest') {
      try {
        const parsedManifest = JSON.parse(text) as Record<string, unknown>;
        if (parsedManifest && typeof parsedManifest === 'object' && !Array.isArray(parsedManifest)) {
          const rawName = typeof parsedManifest.name === 'string' ? parsedManifest.name.trim() : '';
          if (rawName) {
            const normName = rawName.toLowerCase();
            const safePluginName = sanitizeMcpIdentifier(rawName.slice(0, 80));
            const prevManifest = seenManifestNames.get(normName);
            if (prevManifest && prevManifest !== rawRel) {
              pushCrossClientFinding({
                severity: 'warn',
                code: 'duplicate-plugin-or-server',
                client: 'shared',
                file: rawRel,
                message: `Duplicate plugin manifest name "${safePluginName}" declared in both "${prevManifest}" and "${rawRel}" (#1937).`,
                suggestion:
                  'Keep one canonical plugin manifest or disambiguate plugin names so Antigravity / Claude hosts do not register duplicate tools.',
              });
            } else if (!prevManifest) {
              seenManifestNames.set(normName, rawRel);
            }
            meta = { pluginName: safePluginName };
          }
        }
      } catch {
        // ignore invalid manifest JSON here
      }
    }

    const chars = text.length;
    const lineCount = text.length === 0 ? 0 : text.split(/\r?\n/).length;
    assets.push({
      relPath: rawRel,
      kind,
      bytes: stat.size,
      chars,
      estimatedTokens: Math.ceil(chars / 4),
      lineCount,
      meta,
    });
  };

  // 1. Direct well-known root & standard workspace MCP config files
  for (const item of FIXED_WORKSPACE_ASSET_CANDIDATES) {
    inspectFile(path.join(realRoot, item.rel), item.kind);
  }

  // 2. Recursive scanner for skills/**/SKILL.md, .agents/**/* and .gemini/**/*.md
  const walkBounded = (
    relBaseDir: string,
    maxDepth: number,
    onFile: (fullPath: string, entryName: string) => void,
  ) => {
    const startDir = path.join(realRoot, relBaseDir);
    if (!fs.existsSync(startDir)) return;

    let realStart: string;
    try {
      realStart = canonicalRealpathSync(startDir);
    } catch {
      skippedSymlinks += 1;
      return;
    }
    if (!isInsideWorkspace(realStart)) {
      skippedSymlinks += 1;
      return;
    }

    const visitedDirs = new Set<string>();
    const recurse = (dir: string, depth: number) => {
      if (depth > maxDepth) return;
      if (visitedDirs.has(dir)) return;
      visitedDirs.add(dir);

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(realRoot, full).replace(/\\/g, '/');

        if (isSensitiveOpsPath(rel)) {
          skippedSensitive += 1;
          continue;
        }

        if (entry.isSymbolicLink()) {
          let realSub: string;
          try {
            realSub = canonicalRealpathSync(full);
          } catch {
            skippedSymlinks += 1;
            continue;
          }
          if (!isInsideWorkspace(realSub)) {
            skippedSymlinks += 1;
            continue;
          }
          const realSubRel = path.relative(realRoot, realSub).replace(/\\/g, '/');
          if (isSensitiveOpsPath(realSubRel)) {
            skippedSensitive += 1;
            continue;
          }
          try {
            const st = fs.statSync(realSub);
            if (st.isDirectory()) {
              recurse(realSub, depth + 1);
            } else if (st.isFile()) {
              onFile(full, entry.name);
            }
          } catch {
            skippedSymlinks += 1;
          }
          continue;
        }

        if (entry.isDirectory()) {
          recurse(full, depth + 1);
        } else if (entry.isFile()) {
          onFile(full, entry.name);
        }
      }
    };

    recurse(realStart, 0);
  };

  walkBounded('skills', 4, (fullPath, entryName) => {
    if (entryName.toUpperCase() === 'SKILL.MD') {
      inspectFile(fullPath, 'skill');
    }
  });

  walkBounded('.agents', 4, (fullPath, entryName) => {
    const lowerName = entryName.toLowerCase();
    if (lowerName === 'mcp.json' || lowerName === 'mcp_config.json') {
      inspectFile(fullPath, 'mcp');
      return;
    }
    const ext = path.extname(lowerName);
    if (ALLOWED_AGENT_CONFIG_EXTS.has(ext)) {
      inspectFile(fullPath, 'agent-config');
    }
  });

  walkBounded('.gemini', 4, (fullPath, entryName) => {
    const ext = path.extname(entryName).toLowerCase();
    if (ext === '.md' || ext === '.mdx' || ext === '.txt') {
      inspectFile(fullPath, 'rules');
    }
  });

  // 2.5 Ops 2.5 read-only cross-client migration check (.claude/, .cursor/rules/, .codex/)
  scanCrossClientWorkspaceFiles(realRoot, {
    walkBounded,
    onSkippedSymlink: () => {
      skippedSymlinks += 1;
    },
    onSkippedSensitive: () => {
      skippedSensitive += 1;
    },
    pushFinding: pushCrossClientFinding,
  });

  // Strictly read-only team preset audit (.agy-nov.json)
  const teamPreset = loadTeamPresetReadOnly(realRoot);

  assets.sort((a, b) => b.estimatedTokens - a.estimatedTokens || a.relPath.localeCompare(b.relPath));

  const byKind: Record<WorkspaceAssetKind, { count: number; estimatedTokens: number }> = {
    rules: { count: 0, estimatedTokens: 0 },
    skill: { count: 0, estimatedTokens: 0 },
    manifest: { count: 0, estimatedTokens: 0 },
    mcp: { count: 0, estimatedTokens: 0 },
    hooks: { count: 0, estimatedTokens: 0 },
    'agent-config': { count: 0, estimatedTokens: 0 },
  };

  let totalBytes = 0;
  let totalChars = 0;
  let totalEstimatedTokens = 0;
  for (const a of assets) {
    totalBytes += a.bytes;
    totalChars += a.chars;
    totalEstimatedTokens += a.estimatedTokens;
    byKind[a.kind].count += 1;
    byKind[a.kind].estimatedTokens += a.estimatedTokens;
  }

  // 3. Rule Bloat Guard, 100-Tool Budget Meter, and local storage audit
  const ruleBloat = assessRuleBloat(assets);
  const toolBudget = assessToolBudget(
    rootDataDir,
    optsOrEnabledNovTools,
    externalServersCount,
    estimatedExternalTools,
  );
  const storage = auditStorageReadOnly(rootDataDir);

  // 4. Ops 3.0 strictly read-only static security audit & cross-client dedup preview
  const { securityFindings, securityScore } = auditStaticSecurityReadOnly(realRoot);
  const migrationPreview = buildCrossClientMigrationPreviewReadOnly(realRoot);

  const { recommendations, healthScore } = buildAuditRecommendations({
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
  });

  return {
    mode: 'live',
    workspaceName,
    scannedAt: new Date().toISOString(),
    healthScore,
    summary: {
      assetCount: assets.length,
      totalBytes,
      totalChars,
      totalEstimatedTokens,
      skippedSymlinks,
      skippedSensitive,
      byKind,
    },
    assets,
    storage,
    recommendations,
    ruleBloat,
    toolBudget,
    mcpHealthFindings,
    teamPreset,
    crossClientFindings,
    securityFindings,
    securityScore,
    migrationPreview,
  };
}

export const auditWorkspaceReadOnly = auditWorkspaceAssets;
