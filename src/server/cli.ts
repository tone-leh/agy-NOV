import fs from 'node:fs';
import path from 'node:path';
import {
  applyPresetConfig,
  countEnabledModelTools,
  getConfigPath,
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
import { parseCliFlag } from '../core/utils.js';

function printHelp(): void {
  console.log(`agy-NOV CLI (v0.2.0) — The 100% Native Modular Super-Workbench for Antigravity 2.0

Usage:
  agy-nov status [--data-dir=<dir>]                 Show enabled modules, preset, UI language & token footprint
  agy-nov enable <module> [--data-dir=<dir>]        Enable a module (${MODULE_IDS.join(' | ')})
  agy-nov disable <module> [--data-dir=<dir>]       Disable a module
  agy-nov preset <name> [--data-dir=<dir>]          Apply preset (${PRESET_IDS.join(' | ')})
  agy-nov locale <lang> [--data-dir=<dir>]          Set UI language (${LOCALE_IDS.join(' | ')})
  agy-nov doctor [--data-dir=<dir>]                 Verify plugin bundle, manifests & config health (read-only)
`);
}

function printStatus(dataDir: string): void {
  const cfg = loadNovConfigReadOnly(dataDir);
  const enabledCount = MODULE_IDS.filter((id) => cfg.modules[id]).length;
  const modelTools = countEnabledModelTools(cfg.modules);
  console.log(`agy-NOV v0.2.0 Status`);
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
  console.log('agy-NOV Doctor (v0.2.0 · Zero ASAR / Zero CDP)');
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

  if (cmd === 'doctor') {
    process.exit(runDoctor(dataDir));
  }

  console.error(`Unknown command "${cmd}".`);
  printHelp();
  process.exit(2);
}

main();
