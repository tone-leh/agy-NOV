import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  isModuleId,
  isPresetId,
  loadTeamPresetReadOnly,
  PRESET_DEFINITIONS,
  TEAM_CONFIG_FILENAME,
  TEAM_VERIFY_ALLOWED_EXECUTABLES,
  type ModuleId,
  type PresetId,
  type TeamVerifyCommand,
} from '../../core/config.js';
import {
  atomicRenameSync,
  canonicalRealpathSync,
  discoverUserCustomSkillsReadOnly,
  isPathInsideDir,
} from '../../core/utils.js';
import { asPlainRecord, CLI_VERSION, readJsonSilent } from './helpers.js';

export type SafeRecommendedPreset = Exclude<PresetId, 'full'>;
export type OfflineModuleId = Exclude<ModuleId, 'remote'>;

export interface TeamPresetDraft {
  schemaVersion: 1;
  preset: SafeRecommendedPreset;
  enableModules: OfflineModuleId[];
  verifyCommands: TeamVerifyCommand[];
}

interface TeamPresetRecommendationSummary {
  found: boolean;
  valid: boolean;
  preset?: PresetId;
  enableModules: ModuleId[];
  verifyCommandCount: number;
  warningCount: number;
  errorCount: number;
}

export interface UserCustomSkillsSummary {
  total: number;
  geminiCount: number;
  agentsCount: number;
  shadowedByGeminiCount: number;
}

export interface WorkspaceRecommendation {
  version: string;
  workspaceRoot: string;
  detectedStacks: string[];
  signals: {
    isGitRepo: boolean;
    hasRulesOrMcp: boolean;
    hasDataOrOpenApi: boolean;
    hasMultipleTestsOrScripts: boolean;
  };
  userCustomSkills: UserCustomSkillsSummary;
  teamPreset: TeamPresetRecommendationSummary;
  recommendedPreset: SafeRecommendedPreset;
  suggestedExtraModules: string[];
  reasons: string[];
  applyCommand: string;
}

export function buildWorkspaceRecommendation(workspaceRoot: string): WorkspaceRecommendation {
  const resolvedRoot = path.resolve(workspaceRoot);
  let realRoot = resolvedRoot;
  try {
    realRoot = canonicalRealpathSync(resolvedRoot);
  } catch {
    // keep resolvedRoot when directory does not exist
  }

  const exists = (rel: string): boolean => {
    try {
      return fs.existsSync(path.join(realRoot, rel));
    } catch {
      return false;
    }
  };

  const detectedStacks: string[] = [];
  let hasMultipleTestsOrScripts = false;
  if (exists('package.json')) {
    detectedStacks.push('Node.js / TypeScript');
    const pkg = readJsonSilent(path.join(realRoot, 'package.json'));
    const scripts =
      pkg?.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts)
        ? Object.keys(pkg.scripts as Record<string, unknown>)
        : [];
    if (scripts.some((s) => /test|typecheck|lint|check|build/i.test(s))) {
      hasMultipleTestsOrScripts = true;
    }
  }
  if (exists('pyproject.toml') || exists('pytest.ini') || exists('requirements.txt')) {
    detectedStacks.push('Python');
    hasMultipleTestsOrScripts = true;
  }
  if (exists('Cargo.toml')) {
    detectedStacks.push('Rust');
    hasMultipleTestsOrScripts = true;
  }
  if (exists('go.mod')) {
    detectedStacks.push('Go');
    hasMultipleTestsOrScripts = true;
  }

  const isGitRepo = exists('.git');
  const hasRulesOrMcp =
    exists('GEMINI.md') ||
    exists('AGENTS.md') ||
    exists('CLAUDE.md') ||
    exists('.mcp.json') ||
    exists('mcp_config.json') ||
    exists('.gemini/mcp_config.json') ||
    exists('.agents/rules') ||
    exists('.agents/skills') ||
    exists('.agents/hooks.json') ||
    exists('.gemini/skills');

  const discoveredSkills = discoverUserCustomSkillsReadOnly();
  const userCustomSkills: UserCustomSkillsSummary = {
    total: discoveredSkills.skills.length,
    geminiCount: discoveredSkills.skills.filter((s) => s.source === 'gemini').length,
    agentsCount: discoveredSkills.skills.filter((s) => s.source === 'agents').length,
    shadowedByGeminiCount: discoveredSkills.shadowedByGemini.length,
  };

  let hasDataOrOpenApi = false;
  try {
    const entries = fs.readdirSync(realRoot, { withFileTypes: true }).slice(0, 120);
    for (const ent of entries) {
      if (ent.isFile() && /\.(?:sqlite|sqlite3|db|csv|openapi\.ya?ml|openapi\.json)$/i.test(ent.name)) {
        hasDataOrOpenApi = true;
        break;
      }
      if (ent.isFile() && /^(?:openapi|swagger)\.(?:ya?ml|json)$/i.test(ent.name)) {
        hasDataOrOpenApi = true;
        break;
      }
    }
  } catch {
    // read-only best effort
  }

  const teamAudit = loadTeamPresetReadOnly(realRoot);
  const teamPresetSummary: TeamPresetRecommendationSummary = {
    found: teamAudit.found,
    valid: teamAudit.valid,
    ...(teamAudit.preset ? { preset: teamAudit.preset } : {}),
    enableModules: [...teamAudit.enableModules],
    verifyCommandCount: teamAudit.verifyCommands.length,
    warningCount: teamAudit.warnings.length,
    errorCount: teamAudit.errors.length,
  };

  const reasons: string[] = [];
  const rawExtraModules: ModuleId[] = [];
  let recommendedPreset: SafeRecommendedPreset = 'core';

  if (isGitRepo && hasMultipleTestsOrScripts) {
    recommendedPreset = 'power';
    reasons.push(
      `Detected Git repository + ${detectedStacks.join(', ')} test/build setup -> "power" preset enables Verify Gate, Worktree Orchestrator, Spec Flow, Turbo RTK & Ops Budget Doctor (100% offline).`,
    );
  } else {
    reasons.push(
      'Lightweight workspace detected -> "core" preset keeps tool footprint minimal (12 tools: Review, Guard & X-Ray, 100% offline).',
    );
  }

  if (hasRulesOrMcp) {
    reasons.push(
      'Found workspace rules or MCP configuration -> Ops Budget Doctor helps prevent 24KB rule bloat & 100-tool limit overflows.',
    );
    if (recommendedPreset === 'core') rawExtraModules.push('ops');
  }
  if (hasDataOrOpenApi) {
    reasons.push(
      'Found local database, CSV, or OpenAPI files -> enable Workspace Studio on demand for offline inspection & loopback API probing.',
    );
    rawExtraModules.push('studio');
  }

  if (teamAudit.found) {
    if (teamAudit.valid && teamAudit.errors.length === 0) {
      if (teamAudit.preset) {
        if (teamAudit.preset === 'full') {
          recommendedPreset = 'local-all';
          reasons.unshift(
            'Found .agy-nov.json preset "full" -> downgraded to offline "local-all" because opt-in network module "remote" must be enabled manually.',
          );
        } else {
          recommendedPreset = teamAudit.preset;
          reasons.unshift(`Adopted team preset "${teamAudit.preset}" from .agy-nov.json (read-only).`);
        }
      }
      const safeTeamExtras = teamAudit.enableModules.filter((m) => m !== 'remote');
      if (safeTeamExtras.length > 0) {
        for (const m of safeTeamExtras) {
          rawExtraModules.push(m);
        }
        reasons.push(
          `Team preset (.agy-nov.json) requests additional offline module(s): ${safeTeamExtras.join(', ')}.`,
        );
      }
    } else {
      reasons.unshift(`Ignored invalid .agy-nov.json: ${teamAudit.errors.join(' ')}`);
    }

    if (teamAudit.warnings.length > 0) {
      for (const warn of teamAudit.warnings.slice(0, 8)) {
        reasons.push(`[.agy-nov.json warning] ${warn}`);
      }
    }
  }

  const presetModules = PRESET_DEFINITIONS[recommendedPreset].modules;
  const suggestedExtraModules: string[] = [];
  for (const mod of rawExtraModules) {
    if (mod === 'remote') continue;
    if (presetModules[mod]) continue;
    if (!suggestedExtraModules.includes(mod)) {
      suggestedExtraModules.push(mod);
    }
  }

  const applyCommand =
    suggestedExtraModules.length > 0
      ? `agy-nov preset ${recommendedPreset} && ${suggestedExtraModules.map((m) => `agy-nov enable ${m}`).join(' && ')}`
      : `agy-nov preset ${recommendedPreset}`;

  return {
    version: CLI_VERSION,
    workspaceRoot: resolvedRoot,
    detectedStacks,
    signals: {
      isGitRepo,
      hasRulesOrMcp,
      hasDataOrOpenApi,
      hasMultipleTestsOrScripts,
    },
    userCustomSkills,
    teamPreset: teamPresetSummary,
    recommendedPreset,
    suggestedExtraModules,
    reasons,
    applyCommand,
  };
}

function hasSafeRegularFileInWorkspace(realRoot: string, relPath: string): boolean {
  try {
    const candidate = path.join(realRoot, relPath);
    const st = fs.lstatSync(candidate);
    if (st.isSymbolicLink() || !st.isFile()) return false;
    const realTarget = canonicalRealpathSync(candidate);
    return isPathInsideDir(realRoot, realTarget);
  } catch {
    return false;
  }
}

function detectSafeVerifyCommandsReadOnly(
  realRoot: string,
  isGitRepo: boolean,
): TeamVerifyCommand[] {
  const commands: TeamVerifyCommand[] = [];
  const seenKeys = new Set<string>();

  const pushVerified = (label: string, executable: string, args: string[]): void => {
    const execLower = executable.toLowerCase();
    if (!TEAM_VERIFY_ALLOWED_EXECUTABLES.has(execLower)) return;
    if (commands.length >= 10) return;
    const key = `${execLower}\0${args.join('\0')}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    commands.push({ label, executable: execLower, args: [...args] });
  };

  if (hasSafeRegularFileInWorkspace(realRoot, 'package.json')) {
    const pm = hasSafeRegularFileInWorkspace(realRoot, 'pnpm-lock.yaml')
      ? 'pnpm'
      : hasSafeRegularFileInWorkspace(realRoot, 'yarn.lock')
        ? 'yarn'
        : hasSafeRegularFileInWorkspace(realRoot, 'bun.lock') ||
            hasSafeRegularFileInWorkspace(realRoot, 'bun.lockb')
          ? 'bun'
          : 'npm';

    const pkg = readJsonSilent(path.join(realRoot, 'package.json'));
    const scriptsObj = asPlainRecord(pkg?.scripts);
    const RISKY_SCRIPT_BODY_RE =
      /(?:\b(?:curl|wget)\b[^|\r\n]{0,240}\|\s*(?:sh|bash|zsh)\b|\brm\s+-[a-zA-Z]{0,16}r[a-zA-Z]{0,16}f?\s+\/(?:\s|$|;)|\beval\s+["'`$])/i;
    const hasScript = (name: string): boolean => {
      if (!scriptsObj || typeof scriptsObj[name] !== 'string') return false;
      const body = scriptsObj[name].trim();
      if (!body || body.length > 4096 || RISKY_SCRIPT_BODY_RE.test(body)) return false;
      return true;
    };

    if (hasScript('typecheck')) {
      pushVerified('Typecheck', pm, ['run', 'typecheck']);
    } else if (hasSafeRegularFileInWorkspace(realRoot, 'tsconfig.json')) {
      pushVerified('Typecheck', 'tsc', ['--noEmit']);
    }

    if (hasScript('lint')) {
      pushVerified('Lint', pm, ['run', 'lint']);
    }

    if (hasScript('test')) {
      const testBody = String(scriptsObj?.test ?? '');
      if (!/no test specified/i.test(testBody)) {
        pushVerified('Tests', pm, ['test']);
      }
    }

    if (hasScript('build') && commands.length < 3) {
      pushVerified('Build', pm, ['run', 'build']);
    }
  }

  if (
    hasSafeRegularFileInWorkspace(realRoot, 'pyproject.toml') ||
    hasSafeRegularFileInWorkspace(realRoot, 'pytest.ini') ||
    hasSafeRegularFileInWorkspace(realRoot, 'requirements.txt')
  ) {
    pushVerified('Python Tests', 'pytest', ['-q']);
    if (
      hasSafeRegularFileInWorkspace(realRoot, 'ruff.toml') ||
      hasSafeRegularFileInWorkspace(realRoot, '.ruff.toml')
    ) {
      pushVerified('Ruff Lint', 'ruff', ['check', '.']);
    }
  }

  if (hasSafeRegularFileInWorkspace(realRoot, 'Cargo.toml')) {
    pushVerified('Cargo Check', 'cargo', ['check']);
    pushVerified('Cargo Test', 'cargo', ['test']);
  }

  if (hasSafeRegularFileInWorkspace(realRoot, 'go.mod')) {
    pushVerified('Go Vet', 'go', ['vet', './...']);
    pushVerified('Go Test', 'go', ['test', './...']);
  }

  if (commands.length === 0 && isGitRepo) {
    pushVerified('Git Status', 'git', ['status', '--short']);
  }

  return commands;
}

/**
 * Pure read-only scaffold builder for `.agy-nov.json`.
 * Never writes files, never recommends `full` or `remote`, and emits only
 * whitelisted verifyCommands guaranteed to pass `loadTeamPresetReadOnly`.
 */
export function buildTeamPresetDraft(
  rec: WorkspaceRecommendation,
  workspaceRoot: string,
): TeamPresetDraft {
  const rawPreset = rec.recommendedPreset as PresetId;
  const preset: SafeRecommendedPreset =
    rawPreset === 'full'
      ? 'local-all'
      : isPresetId(rawPreset)
        ? rawPreset
        : 'core';

  const presetModules = PRESET_DEFINITIONS[preset].modules;
  const enableModules: OfflineModuleId[] = [];
  const seen = new Set<string>();
  for (const mod of rec.suggestedExtraModules) {
    if (!isModuleId(mod) || mod === 'remote') continue;
    if (presetModules[mod]) continue;
    if (seen.has(mod)) continue;
    seen.add(mod);
    enableModules.push(mod);
  }

  let verifyCommands: TeamVerifyCommand[] = [];
  try {
    const realRoot = canonicalRealpathSync(path.resolve(workspaceRoot));
    if (fs.statSync(realRoot).isDirectory()) {
      verifyCommands = detectSafeVerifyCommandsReadOnly(realRoot, rec.signals.isGitRepo);
    }
  } catch {
    verifyCommands = [];
  }

  return {
    schemaVersion: 1,
    preset,
    enableModules,
    verifyCommands,
  };
}

interface WriteTeamPresetResult {
  ok: true;
  path: string;
  existed: boolean;
  audit: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
}

interface WriteTeamPresetFailure {
  ok: false;
  path: string;
  error: string;
}

export function writeTeamPresetDraft(
  workspaceRoot: string,
  draft: TeamPresetDraft,
  force: boolean,
): WriteTeamPresetResult | WriteTeamPresetFailure {
  const resolvedRoot = path.resolve(workspaceRoot);
  const fallbackTarget = path.join(resolvedRoot, TEAM_CONFIG_FILENAME);

  let realRoot: string;
  try {
    realRoot = canonicalRealpathSync(resolvedRoot);
    if (!fs.statSync(realRoot).isDirectory()) {
      return {
        ok: false,
        path: fallbackTarget,
        error: `Workspace path is not a directory: ${resolvedRoot}`,
      };
    }
  } catch {
    return {
      ok: false,
      path: fallbackTarget,
      error: `Workspace directory does not exist: ${resolvedRoot}`,
    };
  }

  if ((draft.preset as string) === 'full') {
    return {
      ok: false,
      path: path.join(realRoot, TEAM_CONFIG_FILENAME),
      error:
        'Refused to write .agy-nov.json: preset "full" is disallowed (opt-in remote must be enabled manually).',
    };
  }
  if ((draft.enableModules as string[]).includes('remote')) {
    return {
      ok: false,
      path: path.join(realRoot, TEAM_CONFIG_FILENAME),
      error: 'Refused to write .agy-nov.json: opt-in "remote" module is forbidden in team presets.',
    };
  }

  const targetPath = path.join(realRoot, TEAM_CONFIG_FILENAME);
  let existed = false;

  try {
    const st = fs.lstatSync(targetPath);
    if (st.isSymbolicLink()) {
      return {
        ok: false,
        path: targetPath,
        error: `Refused to write ${TEAM_CONFIG_FILENAME}: target path is a symbolic link (symlink escape protection).`,
      };
    }
    if (!st.isFile()) {
      return {
        ok: false,
        path: targetPath,
        error: `Refused to write ${TEAM_CONFIG_FILENAME}: target path exists and is not a regular file.`,
      };
    }
    existed = true;
    if (!force) {
      return {
        ok: false,
        path: targetPath,
        error: `${TEAM_CONFIG_FILENAME} already exists at ${targetPath}. Re-run with --export-preset --confirm --force to overwrite.`,
      };
    }
    const realExisting = canonicalRealpathSync(targetPath);
    if (!isPathInsideDir(realRoot, realExisting)) {
      return {
        ok: false,
        path: targetPath,
        error: `Refused to write ${TEAM_CONFIG_FILENAME}: resolved target escapes workspace boundary.`,
      };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      return {
        ok: false,
        path: targetPath,
        error: `Unable to inspect ${TEAM_CONFIG_FILENAME}: ${code ?? 'unknown error'}`,
      };
    }
  }

  const serialized = `${JSON.stringify(draft, null, 2)}\n`;
  const tmpPath = path.join(
    realRoot,
    `.${TEAM_CONFIG_FILENAME}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`,
  );

  try {
    fs.writeFileSync(tmpPath, serialized, {
      encoding: 'utf8',
      mode: 0o644,
      flag: 'wx',
    });

    // Re-check target symlink right before atomic rename
    try {
      const preRenameStat = fs.lstatSync(targetPath);
      if (preRenameStat.isSymbolicLink()) {
        throw new Error(
          `Refused to write ${TEAM_CONFIG_FILENAME}: target path is a symbolic link.`,
        );
      }
      if (!force) {
        throw new Error(
          `${TEAM_CONFIG_FILENAME} already exists at ${targetPath}. Re-run with --export-preset --confirm --force to overwrite.`,
        );
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw err;
      }
    }

    atomicRenameSync(tmpPath, targetPath);
    try {
      fs.chmodSync(targetPath, 0o644);
    } catch {
      // ignore chmod failures on filesystems without POSIX modes
    }

    const realWritten = canonicalRealpathSync(targetPath);
    if (!isPathInsideDir(realRoot, realWritten)) {
      return {
        ok: false,
        path: targetPath,
        error: `Written ${TEAM_CONFIG_FILENAME} failed realpath containment verification.`,
      };
    }
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // ignore cleanup failure
    }
    return {
      ok: false,
      path: targetPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const audit = loadTeamPresetReadOnly(realRoot);
  if (!audit.found || !audit.valid || audit.errors.length > 0) {
    return {
      ok: false,
      path: targetPath,
      error: `Self-check failed for written ${TEAM_CONFIG_FILENAME}: ${audit.errors.join('; ') || 'invalid preset'}`,
    };
  }

  return {
    ok: true,
    path: targetPath,
    existed,
    audit: {
      valid: audit.valid,
      errors: audit.errors,
      warnings: audit.warnings,
    },
  };
}
