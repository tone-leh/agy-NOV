import fs from 'node:fs';
import path from 'node:path';
import {
  applyPresetConfig,
  countEnabledModelTools,
  getConfigPath,
  getModuleDataDir,
  isModuleId,
  isNovLocale,
  isPresetId,
  LOCALE_IDS,
  loadNovConfigReadOnly,
  loadTeamPresetReadOnly,
  MODULE_CATALOG,
  MODULE_CATEGORY_IDS,
  MODULE_CATEGORY_META,
  MODULE_IDS,
  PRESET_DEFINITIONS,
  PRESET_IDS,
  resolveNovDataDir,
  setModuleEnabled,
  setNovLocale,
  type ModuleId,
  type PresetId,
} from '../core/config.js';
import { getFeedSnapshotPath, MAX_FEED_SNAPSHOT_BYTES } from '../core/feed.js';
import { hasCliFlag, parseCliFlag } from '../core/utils.js';
import { executeSafeCompactRun, loadTurboPrefsReadOnly } from '../modules/turbo/auto-rtk.js';

const CLI_VERSION = '0.8.0';

function printHelp(): void {
  console.log(`agy-NOV CLI (v${CLI_VERSION}) — The 100% Native Modular Super-Workbench for Antigravity 2.0

Usage:
  agy-nov status [--data-dir=<dir>]                             Show enabled modules, preset, UI language & token footprint
  agy-nov enable <module> [--data-dir=<dir>]                    Enable a module (${MODULE_IDS.join(' | ')})
  agy-nov disable <module> [--data-dir=<dir>]                   Disable a module
  agy-nov preset <name> [--data-dir=<dir>]                      Apply preset (${PRESET_IDS.join(' | ')})
  agy-nov locale <lang> [--data-dir=<dir>]                      Set UI language (${LOCALE_IDS.join(' | ')})
  agy-nov statusline [--json] [--compact] [--data-dir=<dir>]    Zero-token read-only status line for Antigravity CLI
  agy-nov recommend [--workspace=<dir>] [--json]                Read-only project scanner recommending preset & modules
  agy-nov doctor [--data-dir=<dir>]                             Verify plugin bundle, manifests & config health (read-only)
  agy-nov compact-run --payload=<b64> [--data-dir=<dir>]        Auto-RTK whitelisted shell-free compact command runner
`);
}

function readJsonSilent(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export interface StatusLineSnapshot {
  version: string;
  preset: string;
  enabledCount: number;
  totalModules: number;
  modelTools: number;
  locale: string;
  network: 'offline' | 'opt-in-remote';
  verify?: {
    enabled: boolean;
    lastStatus: 'pass' | 'fail' | 'blocked' | 'idle';
    blockedStops: number;
  };
  spec?: {
    enabled: boolean;
    activeTitle?: string;
    status?: string;
    writeLockActive: boolean;
    doneTasks: number;
    totalTasks: number;
  };
  radar?: {
    enabled: boolean;
    running: number;
    awaitingApproval: number;
    stalled: number;
    error: number;
    orphanSubagents: number;
    unread: number;
  };
  xray?: {
    enabled: boolean;
    activeConversationId?: string;
    lastToolName?: string;
  };
  line: string;
}

function buildStatusLine(dataDir: string, compact: boolean): StatusLineSnapshot {
  const cfg = loadNovConfigReadOnly(dataDir);
  const enabledCount = MODULE_IDS.filter((id) => cfg.modules[id]).length;
  const modelTools = countEnabledModelTools(cfg.modules);
  const network: 'offline' | 'opt-in-remote' = cfg.modules.remote ? 'opt-in-remote' : 'offline';

  let verifySummary: StatusLineSnapshot['verify'];
  if (cfg.modules.verify) {
    const verifyState = readJsonSilent(path.join(getModuleDataDir(dataDir, 'verify'), 'state.json'));
    const rawEvidence = Array.isArray(verifyState?.evidence) ? verifyState.evidence : [];
    const validEvidence = rawEvidence.filter(
      (e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object' && !Array.isArray(e),
    );
    const latest = validEvidence[0];
    let lastStatus: 'pass' | 'fail' | 'blocked' | 'idle' = 'idle';
    if (latest) {
      const outcome = typeof latest.outcome === 'string' ? latest.outcome : '';
      if (outcome === 'blocked' || latest.blocked === true) lastStatus = 'blocked';
      else if (outcome === 'pass' || outcome === 'guardrail-allow' || latest.passed === true) {
        lastStatus = 'pass';
      } else {
        lastStatus = 'fail';
      }
    }
    const storedBlockedStops =
      typeof verifyState?.blockedStops === 'number' && Number.isFinite(verifyState.blockedStops)
        ? Math.max(0, Math.floor(verifyState.blockedStops))
        : 0;
    const countedBlocked = validEvidence.filter(
      (e) => e.outcome === 'blocked' || e.blocked === true,
    ).length;
    const blockedStops = Math.max(storedBlockedStops, countedBlocked);
    verifySummary = { enabled: true, lastStatus, blockedStops };
  }

  let specSummary: StatusLineSnapshot['spec'];
  if (cfg.modules.spec) {
    const specState = readJsonSilent(path.join(getModuleDataDir(dataDir, 'spec'), 'state.json'));
    const activeId = typeof specState?.activeSpecId === 'string' ? specState.activeSpecId : undefined;
    let activeDoc: Record<string, unknown> | undefined;
    if (activeId && Array.isArray(specState?.specs)) {
      activeDoc = (specState.specs as Array<unknown>).find(
        (s): s is Record<string, unknown> =>
          Boolean(s) && typeof s === 'object' && !Array.isArray(s) && (s as Record<string, unknown>).id === activeId,
      );
    } else if (activeId && specState?.specs && typeof specState.specs === 'object') {
      const candidate = (specState.specs as Record<string, unknown>)[activeId];
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        activeDoc = candidate as Record<string, unknown>;
      }
    }
    const tasks = Array.isArray(activeDoc?.tasks)
      ? (activeDoc.tasks as Array<unknown>).filter(
          (t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object' && !Array.isArray(t),
        )
      : [];
    const doneTasks = tasks.filter((t) => t.status === 'done').length;
    const status = typeof activeDoc?.status === 'string' ? activeDoc.status : undefined;
    const writeLockActive = Boolean(
      activeDoc && status === 'draft' && activeDoc.enforcePlanBeforeWrite === true,
    );
    specSummary = {
      enabled: true,
      activeTitle: typeof activeDoc?.title === 'string' ? activeDoc.title : undefined,
      status,
      writeLockActive,
      doneTasks,
      totalTasks: tasks.length,
    };
  }

  let radarSummary: StatusLineSnapshot['radar'];
  if (cfg.modules.radar) {
    const radarDir = getModuleDataDir(dataDir, 'radar');
    const capsule = readJsonSilent(path.join(radarDir, 'status-capsule.json'));
    const counts =
      capsule && capsule.counts && typeof capsule.counts === 'object'
        ? (capsule.counts as Record<string, unknown>)
        : null;
    if (counts) {
      radarSummary = {
        enabled: true,
        running: Number(counts.running ?? 0) || 0,
        awaitingApproval: Number(counts.awaiting_approval ?? 0) || 0,
        stalled: Number(counts.stalled ?? 0) || 0,
        error: Number(counts.error ?? 0) || 0,
        orphanSubagents: Number(counts.orphanSubagents ?? 0) || 0,
        unread: Number(counts.unread ?? 0) || 0,
      };
    } else {
      const board = readJsonSilent(path.join(radarDir, 'board.json'));
      const sessionsRaw = board?.sessions;
      const list =
        sessionsRaw && typeof sessionsRaw === 'object' && !Array.isArray(sessionsRaw)
          ? Object.values(sessionsRaw as Record<string, unknown>).filter(
              (s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object' && !Array.isArray(s),
            )
          : [];
      radarSummary = {
        enabled: true,
        running: list.filter((s) => s.status === 'running').length,
        awaitingApproval: list.filter((s) => s.status === 'awaiting_approval').length,
        stalled: 0,
        error: list.filter((s) => s.status === 'error').length,
        orphanSubagents: 0,
        unread: list.filter((s) => s.unread === true).length,
      };
    }
  }

  let xraySummary: StatusLineSnapshot['xray'];
  if (cfg.modules.xray) {
    const live = readJsonSilent(path.join(getModuleDataDir(dataDir, 'xray'), 'live-state.json'));
    xraySummary = {
      enabled: true,
      activeConversationId:
        typeof live?.activeConversationId === 'string' ? live.activeConversationId : undefined,
      lastToolName: typeof live?.lastToolName === 'string' ? live.lastToolName : undefined,
    };
  }

  const parts: string[] = compact
    ? [`NOV ${enabledCount}/${MODULE_IDS.length} (${modelTools}t)`]
    : [
        `agy-NOV ${cfg.preset}`,
        `${enabledCount}/${MODULE_IDS.length} (${modelTools}t)`,
        network === 'offline' ? 'offline' : 'remote:ON',
      ];

  if (verifySummary) {
    const tag =
      verifySummary.lastStatus === 'pass'
        ? 'PASS'
        : verifySummary.lastStatus === 'blocked'
          ? 'BLOCKED'
          : verifySummary.lastStatus === 'fail'
            ? 'FAIL'
            : 'IDLE';
    parts.push(`Verify:${tag}`);
  }

  if (specSummary && specSummary.status) {
    const lockTag = specSummary.writeLockActive ? 'LOCK' : specSummary.status.toUpperCase();
    parts.push(`Spec:${lockTag}(${specSummary.doneTasks}/${specSummary.totalTasks})`);
  }

  if (radarSummary) {
    const radarBits: string[] = [];
    if (radarSummary.running > 0) radarBits.push(`${radarSummary.running}run`);
    if (radarSummary.awaitingApproval > 0) radarBits.push(`${radarSummary.awaitingApproval}wait`);
    if (radarSummary.stalled > 0) radarBits.push(`${radarSummary.stalled}stall`);
    if (radarSummary.orphanSubagents > 0) radarBits.push(`${radarSummary.orphanSubagents}orphan`);
    if (radarSummary.error > 0) radarBits.push(`${radarSummary.error}err`);
    if (radarBits.length > 0) {
      parts.push(`Radar:${radarBits.join('/')}`);
    }
  }

  const line = parts.join(' · ');
  return {
    version: CLI_VERSION,
    preset: cfg.preset,
    enabledCount,
    totalModules: MODULE_IDS.length,
    modelTools,
    locale: cfg.locale,
    network,
    verify: verifySummary,
    spec: specSummary,
    radar: radarSummary,
    xray: xraySummary,
    line,
  };
}

function printStatus(dataDir: string): void {
  const cfg = loadNovConfigReadOnly(dataDir);
  const enabledCount = MODULE_IDS.filter((id) => cfg.modules[id]).length;
  const modelTools = countEnabledModelTools(cfg.modules);
  console.log(`agy-NOV v${CLI_VERSION} Status`);
  console.log(`  Architecture:   100% Native MCP Apps & Hooks (Zero ASAR / Zero CDP)`);
  console.log(`  Data Dir:       ${dataDir}`);
  console.log(`  Config File:    ${getConfigPath(dataDir)} (${fs.existsSync(getConfigPath(dataDir)) ? 'persisted' : 'defaults'})`);
  console.log(`  Preset:         ${cfg.preset}`);
  console.log(`  UI Locale:      ${cfg.locale}`);
  console.log(`  Modules:        ${enabledCount}/${MODULE_IDS.length} enabled (${modelTools} model tools)`);
  console.log(`  Network:        ${cfg.modules.remote ? 'Remote Hub enabled (opt-in)' : '100% offline'}`);
  console.log('');

  for (const catId of MODULE_CATEGORY_IDS) {
    const cat = MODULE_CATEGORY_META[catId];
    console.log(`  [${cat.label}]`);
    for (const id of MODULE_IDS.filter((m) => MODULE_CATALOG[m].category === catId)) {
      const meta = MODULE_CATALOG[id];
      const flag = cfg.modules[id] ? 'ON ' : 'OFF';
      const tier = meta.isolationTier === 'offline' ? 'offline' : 'opt-in-net';
      console.log(
        `    [${flag}] ${id.padEnd(8)} ${meta.name.padEnd(24)} (${meta.modelToolNames.length} tools · ${tier})`,
      );
    }
  }
}

type SafeRecommendedPreset = Exclude<PresetId, 'full'>;

interface TeamPresetRecommendationSummary {
  found: boolean;
  valid: boolean;
  preset?: PresetId;
  enableModules: ModuleId[];
  verifyCommandCount: number;
  warningCount: number;
  errorCount: number;
}

interface WorkspaceRecommendation {
  version: string;
  workspaceRoot: string;
  detectedStacks: string[];
  signals: {
    isGitRepo: boolean;
    hasRulesOrMcp: boolean;
    hasDataOrOpenApi: boolean;
    hasMultipleTestsOrScripts: boolean;
  };
  teamPreset: TeamPresetRecommendationSummary;
  recommendedPreset: SafeRecommendedPreset;
  suggestedExtraModules: string[];
  reasons: string[];
  applyCommand: string;
}

function buildWorkspaceRecommendation(workspaceRoot: string): WorkspaceRecommendation {
  const resolvedRoot = path.resolve(workspaceRoot);
  let realRoot = resolvedRoot;
  try {
    realRoot = fs.realpathSync(resolvedRoot);
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
    exists('.agents/rules');

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
    reasons.push('Found workspace rules or MCP configuration -> Ops Budget Doctor helps prevent 24KB rule bloat & 100-tool limit overflows.');
    if (recommendedPreset === 'core') rawExtraModules.push('ops');
  }
  if (hasDataOrOpenApi) {
    reasons.push('Found local database, CSV, or OpenAPI files -> enable Workspace Studio on demand for offline inspection & loopback API probing.');
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
          reasons.unshift(
            `Adopted team preset "${teamAudit.preset}" from .agy-nov.json (read-only).`,
          );
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
      reasons.unshift(
        `Ignored invalid .agy-nov.json: ${teamAudit.errors.join(' ')}`,
      );
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
    teamPreset: teamPresetSummary,
    recommendedPreset,
    suggestedExtraModules,
    reasons,
    applyCommand,
  };
}

function resolvePluginRootDir(): string {
  const scriptDir = path.dirname(process.argv[1] || process.cwd());
  const candidates = [
    path.resolve(scriptDir, '..'),
    path.resolve(scriptDir, '../..'),
    process.cwd(),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'plugin.json'))) {
      return dir;
    }
  }
  return candidates[0];
}

function runDoctor(dataDir: string): number {
  const rootDir = resolvePluginRootDir();
  const requiredFiles = [
    'plugin.json',
    'mcp_config.json',
    'hooks.json',
    'skills/agy-nov/SKILL.md',
    'assets/logo.svg',
    'dist/server.cjs',
    'dist/hook.cjs',
    'dist/cli.cjs',
    'dist/ui/app.html',
  ];

  let ok = true;
  console.log(`agy-NOV Doctor (v${CLI_VERSION} · Zero ASAR / Zero CDP)`);
  for (const rel of requiredFiles) {
    const abs = path.join(rootDir, rel);
    const exists = fs.existsSync(abs);
    if (!exists) ok = false;
    const size = exists ? `${(fs.statSync(abs).size / 1024).toFixed(1)} KB` : 'MISSING';
    console.log(`  ${exists ? 'OK  ' : 'FAIL'} ${rel.padEnd(28)} ${size}`);
  }

  // Validate plugin.json official schema fields
  const pluginPath = path.join(rootDir, 'plugin.json');
  if (fs.existsSync(pluginPath)) {
    const allowedKeys = new Set([
      'name',
      'displayName',
      'description',
      'version',
      'logo',
      'suggestedPrompts',
      'author',
      'homepage',
      'repository',
      'disabled',
    ]);
    const manifest = JSON.parse(fs.readFileSync(pluginPath, 'utf8')) as Record<string, unknown>;
    const unknown = Object.keys(manifest).filter((k) => !allowedKeys.has(k));
    if (unknown.length > 0) {
      ok = false;
      console.log(`  FAIL plugin.json contains unknown keys: ${unknown.join(', ')}`);
    } else {
      console.log(`  OK   plugin.json schema clean (name=${String(manifest.name)}, version=${String(manifest.version)})`);
    }
  }

  // Verify UI bundle stays well under Antigravity 10 MiB resource limit
  const uiPath = path.join(rootDir, 'dist/ui/app.html');
  if (fs.existsSync(uiPath)) {
    const bytes = fs.statSync(uiPath).size;
    if (bytes >= 10 * 1024 * 1024) {
      ok = false;
      console.log(`  FAIL dist/ui/app.html exceeds 10 MiB limit (${bytes} bytes)`);
    } else {
      console.log(`  OK   dist/ui/app.html well below 10 MiB cap (${(bytes / 1024).toFixed(1)} KB)`);
    }
  }

  const cfg = loadNovConfigReadOnly(dataDir);
  console.log(
    `  OK   config readable (preset=${cfg.preset}, locale=${cfg.locale}, remote=${cfg.modules.remote ? 'ON' : 'OFF'})`,
  );

  // Read-only Auto-RTK proxy status (default OFF, zero disk writes)
  const turboPrefs = loadTurboPrefsReadOnly(getModuleDataDir(dataDir, 'turbo'));
  const autoRtkActive = cfg.modules.turbo && turboPrefs.autoRtk;
  console.log(
    `  OK   Auto-RTK: ${turboPrefs.autoRtk ? (autoRtkActive ? 'ON (active)' : 'ON (waiting for turbo module)') : 'OFF (default safe passive mode)'}`,
  );

  // Read-only dual-star feed snapshot status check (never writes or creates directories)
  const feedPath = getFeedSnapshotPath(dataDir);
  let feedStatusTag = 'OK  ';
  let feedNote = 'not generated yet (lazy read-only until first write)';
  try {
    const feedStat = fs.lstatSync(feedPath);
    if (feedStat.isSymbolicLink() || !feedStat.isFile()) {
      ok = false;
      feedStatusTag = 'FAIL';
      feedNote = 'unsafe symlink or non-regular file';
    } else if (feedStat.size > MAX_FEED_SNAPSHOT_BYTES) {
      ok = false;
      feedStatusTag = 'FAIL';
      feedNote = `exceeds 64 KB cap (${feedStat.size} bytes)`;
    } else {
      feedNote = `ready (${(feedStat.size / 1024).toFixed(1)} KB)`;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      feedNote = 'unreadable';
    }
  }
  console.log(`  ${feedStatusTag} Feed Snapshot: ${feedPath} (${feedNote})`);

  return ok ? 0 : 1;
}

function main(): void {
  const argv = process.argv.slice(2);
  const cmd = argv.find((a) => !a.startsWith('-')) ?? 'status';
  const positional = argv.filter((a) => !a.startsWith('-'));
  const dataDir = resolveNovDataDir(parseCliFlag(argv, '--data-dir'));

  if (cmd === 'help' || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  if (cmd === 'status') {
    printStatus(dataDir);
    return;
  }

  if (cmd === 'enable' || cmd === 'disable') {
    const target = positional[1];
    if (!isModuleId(target)) {
      console.error(`Unknown module "${target ?? ''}". Valid modules: ${MODULE_IDS.join(', ')}`);
      process.exit(2);
    }
    const next = setModuleEnabled(dataDir, target, cmd === 'enable');
    console.log(
      `${cmd === 'enable' ? 'Enabled' : 'Disabled'} module "${target}". Preset is now "${next.preset}".`,
    );
    return;
  }

  if (cmd === 'preset') {
    const target = positional[1];
    if (!isPresetId(target)) {
      console.error(`Unknown preset "${target ?? ''}". Valid presets: ${PRESET_IDS.join(', ')}`);
      process.exit(2);
    }
    const next = applyPresetConfig(dataDir, target);
    const def = PRESET_DEFINITIONS[target];
    console.log(`Applied preset "${def.label}" (${next.preset}).`);
    printStatus(dataDir);
    return;
  }

  if (cmd === 'locale') {
    const target = positional[1];
    if (!isNovLocale(target)) {
      console.error(`Unknown locale "${target ?? ''}". Valid locales: ${LOCALE_IDS.join(', ')}`);
      process.exit(2);
    }
    const next = setNovLocale(dataDir, target);
    console.log(`Updated agy-NOV UI locale to "${next.locale}".`);
    return;
  }

  if (cmd === 'statusline') {
    const asJson = hasCliFlag(argv, '--json');
    const compact = hasCliFlag(argv, '--compact');
    const snap = buildStatusLine(dataDir, compact);
    console.log(asJson ? JSON.stringify(snap) : snap.line);
    return;
  }

  if (cmd === 'recommend') {
    const ws = parseCliFlag(argv, '--workspace') ?? process.cwd();
    const asJson = hasCliFlag(argv, '--json');
    const rec = buildWorkspaceRecommendation(ws);
    if (asJson) {
      console.log(JSON.stringify(rec, null, 2));
    } else {
      console.log(`agy-NOV v${CLI_VERSION} Workspace Recommendation (Read-Only)`);
      console.log(`  Workspace:   ${rec.workspaceRoot}`);
      console.log(`  Stacks:      ${rec.detectedStacks.length > 0 ? rec.detectedStacks.join(', ') : 'Generic'}`);
      if (rec.teamPreset.found) {
        console.log(
          `  Team Preset: .agy-nov.json (${rec.teamPreset.valid ? 'valid' : 'invalid'}${rec.teamPreset.preset ? ` · preset=${rec.teamPreset.preset}` : ''} · ${rec.teamPreset.verifyCommandCount} verify cmd(s) · ${rec.teamPreset.warningCount} warn(s))`,
        );
      }
      console.log(`  Recommended: preset "${rec.recommendedPreset}"${rec.suggestedExtraModules.length > 0 ? ` + [${rec.suggestedExtraModules.join(', ')}]` : ''}`);
      for (const r of rec.reasons) {
        console.log(`  - ${r}`);
      }
      console.log(`  Apply:       ${rec.applyCommand}`);
    }
    return;
  }

  if (cmd === 'doctor') {
    process.exit(runDoctor(dataDir));
  }

  if (cmd === 'compact-run') {
    const payloadB64 = parseCliFlag(argv, '--payload');
    if (!payloadB64) {
      console.error('[agy-NOV Auto-RTK] Missing required --payload=<base64url> argument.');
      process.exit(2);
    }
    const result = executeSafeCompactRun({
      payloadB64,
      cwd: process.cwd(),
      dataDir,
    });
    if (result.output) {
      process.stdout.write(result.output.endsWith('\n') ? result.output : `${result.output}\n`);
    }
    process.exit(result.exitCode);
  }

  console.error(`Unknown command "${cmd}".`);
  printHelp();
  process.exit(2);
}

main();
