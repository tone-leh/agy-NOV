import fs from 'node:fs';
import path from 'node:path';
import {
  countEnabledModelTools,
  getConfigPath,
  LOCALE_IDS,
  loadNovConfigReadOnly,
  MODULE_CATALOG,
  MODULE_CATEGORY_IDS,
  MODULE_CATEGORY_META,
  MODULE_IDS,
  PRESET_IDS,
} from '../../core/config.js';

export const CLI_VERSION = '1.2.3';
export const MAX_READ_JSON_BYTES = 2 * 1024 * 1024; // 2 MiB hard cap for silent read-only JSON loading

export const CLI_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--data-dir',
  '--workspace',
  '--repo',
  '--segments',
  '--payload',
  '--format',
  '--target',
  '--out',
  '--spec',
  '--preset',
  '--locale',
  '--model',
]);

/**
 * Extract positional arguments (subcommand and positional operands) while skipping
 * values attached to space-separated value options (e.g. `--data-dir /path/to/dir status`).
 * Supports `--flag=val`, `--flag val`, and the `--` end-of-options terminator.
 */
export function extractCliPositionals(
  argv: string[],
  valueFlags: ReadonlySet<string> = CLI_VALUE_FLAGS,
): string[] {
  const positional: string[] = [];
  let afterDoubleDash = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (afterDoubleDash) {
      positional.push(arg);
      continue;
    }
    if (arg === '--') {
      afterDoubleDash = true;
      continue;
    }
    if (arg.startsWith('-')) {
      if (valueFlags.has(arg) && i + 1 < argv.length) {
        i += 1;
      }
      continue;
    }
    positional.push(arg);
  }

  return positional;
}

export function printHelp(): void {
  console.log(`agy-NOV CLI (v${CLI_VERSION}) — The 100% Native Modular Super-Workbench for Antigravity 2.0

Usage:
  agy-nov status [--data-dir=<dir>]                                                   Show enabled modules, preset, UI language & token footprint
  agy-nov enable <module> [--data-dir=<dir>]                                          Enable a module (${MODULE_IDS.join(' | ')})
  agy-nov disable <module> [--data-dir=<dir>]                                         Disable a module
  agy-nov preset <name> [--data-dir=<dir>]                                            Apply preset (${PRESET_IDS.join(' | ')})
  agy-nov locale <lang> [--data-dir=<dir>]                                            Set UI language (${LOCALE_IDS.join(' | ')})
  agy-nov statusline [--json] [--compact] [--segments=<list>] [--data-dir=<dir>]      Zero-token read-only status line for Antigravity CLI
  agy-nov recommend [--workspace=<dir>] [--json] [--export-preset [--confirm] [--force]]  Read-only project scanner & .agy-nov.json scaffold
  agy-nov doctor [--data-dir=<dir>]                                                   Verify plugin bundle, manifests & config health (read-only)
  agy-nov compact-run --payload=<b64> [--data-dir=<dir>]                              Auto-RTK whitelisted shell-free compact command runner
  agy-nov compile-spec [--spec=<id>] [--format=workflow|swarm|both] [--json]          Read-only Spec DAG compiler to /run-workflow Python & /swarm plan.json
  agy-nov audit-once [--workspace=<dir>] [--data-dir=<dir>] [--json] [--write-report] Read-only workspace & plugin health sweep (zero writes by default)

Tip:
  When installed via "agy plugin install", invoke directly with:
    node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs <command>
  (or run "npm link" inside the plugin directory once to register the global "agy-nov" binary).
  Without --data-dir, agy-NOV automatically detects an existing Antigravity plugin_data/agy-nov directory before falling back to ~/.agy-nov-data.
`);
}

export function readJsonAnySilent(filePath: string): unknown | null {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_READ_JSON_BYTES) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export function readJsonSilent(filePath: string): Record<string, unknown> | null {
  const raw = readJsonAnySilent(filePath);
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

export function asPlainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function pickFiniteNonNegNumber(...candidates: unknown[]): number | undefined {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c >= 0) {
      return c;
    }
  }
  return undefined;
}

export function pickFinitePositiveNumber(...candidates: unknown[]): number | undefined {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) {
      return c;
    }
  }
  return undefined;
}

export function resolvePluginRootDir(): string {
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

export function printStatus(dataDir: string): void {
  const cfg = loadNovConfigReadOnly(dataDir);
  const enabledCount = MODULE_IDS.filter((id) => cfg.modules[id]).length;
  const modelTools = countEnabledModelTools(cfg.modules);
  console.log(`agy-NOV v${CLI_VERSION} Status`);
  console.log(`  Architecture:   100% Native MCP Apps & Hooks (Zero ASAR / Zero CDP)`);
  console.log(`  Data Dir:       ${dataDir}`);
  console.log(
    `  Config File:    ${getConfigPath(dataDir)} (${fs.existsSync(getConfigPath(dataDir)) ? 'persisted' : 'defaults'})`,
  );
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
