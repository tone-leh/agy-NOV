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
  MODULE_CATALOG,
  MODULE_CATEGORY_IDS,
  MODULE_CATEGORY_META,
  MODULE_IDS,
  PRESET_DEFINITIONS,
  PRESET_IDS,
  resolveNovDataDir,
  setModuleEnabled,
  setNovLocale,
} from '../core/config.js';
import { hasCliFlag, parseCliFlag } from '../core/utils.js';

const CLI_VERSION = '0.3.0';

function printHelp(): void {
  console.log(`agy-NOV CLI (v${CLI_VERSION}) — The 100% Native Modular Super-Workbench for Antigravity 2.0

Usage:
  agy-nov status [--data-dir=<dir>]                             Show enabled modules, preset, UI language & token footprint
  agy-nov enable <module> [--data-dir=<dir>]                    Enable a module (${MODULE_IDS.join(' | ')})
  agy-nov disable <module> [--data-dir=<dir>]                   Disable a module
  agy-nov preset <name> [--data-dir=<dir>]                      Apply preset (${PRESET_IDS.join(' | ')})
  agy-nov locale <lang> [--data-dir=<dir>]                      Set UI language (${LOCALE_IDS.join(' | ')})
  agy-nov statusline [--json] [--compact] [--data-dir=<dir>]    Zero-token read-only status line for Antigravity CLI
  agy-nov doctor [--data-dir=<dir>]                             Verify plugin bundle, manifests & config health (read-only)
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
      const sessionsObj =
        board && board.sessions && typeof board.sessions === 'object'
          ? (board.sessions as Record<string, Record<string, unknown>>)
          : {};
      const list = Object.values(sessionsObj);
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

function runDoctor(dataDir: string): number {
  const rootDir = path.resolve(path.dirname(process.argv[1] || process.cwd()), '..');
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

  if (cmd === 'doctor') {
    process.exit(runDoctor(dataDir));
  }

  console.error(`Unknown command "${cmd}".`);
  printHelp();
  process.exit(2);
}

main();
