import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  countEnabledModelTools,
  isModuleDomainId,
  isModuleId,
  isNovLocale,
  isNovStartupView,
  isPresetId,
  LOCALE_IDS,
  LOCALE_NATIVE_LABELS,
  MAX_MCP_TOOL_BUDGET,
  MODULE_CATALOG,
  MODULE_CATEGORY_IDS,
  MODULE_CATEGORY_META,
  MODULE_DOMAIN_IDS,
  MODULE_DOMAIN_META,
  MODULE_IDS,
  OFFLINE_NATIVE_MODULE_IDS,
  PRESET_DEFINITIONS,
  PRESET_IDS,
  STARTUP_VIEW_IDS,
  UI_LOCALE_IDS,
  type IsolationTier,
  type ModuleCategoryId,
  type ModuleDomainId,
  type ModuleId,
  type ModuleMetadata,
  type NovConfig,
  type NovLocale,
  type NovStartupView,
  type PresetId,
  type ResolvedUiLocale,
} from './catalog.js';

export {
  countEnabledModelTools,
  isModuleDomainId,
  isModuleId,
  isNovLocale,
  isNovStartupView,
  isPresetId,
  LOCALE_IDS,
  LOCALE_NATIVE_LABELS,
  MAX_MCP_TOOL_BUDGET,
  MODULE_CATALOG,
  MODULE_CATEGORY_IDS,
  MODULE_CATEGORY_META,
  MODULE_DOMAIN_IDS,
  MODULE_DOMAIN_META,
  MODULE_IDS,
  OFFLINE_NATIVE_MODULE_IDS,
  PRESET_DEFINITIONS,
  PRESET_IDS,
  STARTUP_VIEW_IDS,
  UI_LOCALE_IDS,
  type IsolationTier,
  type ModuleCategoryId,
  type ModuleDomainId,
  type ModuleId,
  type ModuleMetadata,
  type NovConfig,
  type NovLocale,
  type NovStartupView,
  type PresetId,
  type ResolvedUiLocale,
};

export function sanitizeDataDirCandidate(candidate: string | undefined | null): string | undefined {
  if (!candidate) return undefined;
  const trimmed = candidate.trim();
  if (!trimmed) return undefined;
  if (/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(trimmed)) return undefined;
  return path.resolve(trimmed);
}

export function resolveNovDataDir(cliDataDir?: string): string {
  return (
    sanitizeDataDirCandidate(cliDataDir) ??
    sanitizeDataDirCandidate(process.env.AGY_NOV_DATA_DIR) ??
    sanitizeDataDirCandidate(process.env.PLUGIN_DATA) ??
    path.join(os.homedir(), '.agy-nov-data')
  );
}

export function getModuleDataDir(rootDataDir: string, moduleId: ModuleId): string {
  return path.join(rootDataDir, 'modules', moduleId);
}

export function getConfigPath(rootDataDir: string): string {
  return path.join(rootDataDir, 'config.json');
}

export function getConfigFileSignature(rootDataDir: string): string | null {
  const cfgPath = getConfigPath(rootDataDir);
  try {
    const st = fs.statSync(cfgPath);
    return `${st.ino}:${st.mtimeMs}:${st.size}`;
  } catch {
    return null;
  }
}

export function createDefaultConfig(): NovConfig {
  return {
    schemaVersion: 1,
    preset: 'core',
    modules: { ...PRESET_DEFINITIONS.core.modules },
    defaultTab: 'review',
    startupView: 'hub',
    locale: 'auto',
    updatedAt: new Date().toISOString(),
  };
}

export function detectPreset(modules: Record<ModuleId, boolean>): PresetId | 'custom' {
  for (const id of PRESET_IDS) {
    const target = PRESET_DEFINITIONS[id].modules;
    if (MODULE_IDS.every((m) => Boolean(modules[m]) === Boolean(target[m]))) {
      return id;
    }
  }
  return 'custom';
}

export function normalizeConfig(raw: unknown): NovConfig {
  const base = createDefaultConfig();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const obj = raw as Record<string, unknown>;
  const rawMods =
    obj.modules && typeof obj.modules === 'object' && !Array.isArray(obj.modules)
      ? (obj.modules as Record<string, unknown>)
      : {};
  const modules: Record<ModuleId, boolean> = { ...base.modules };
  for (const id of MODULE_IDS) {
    if (Object.prototype.hasOwnProperty.call(rawMods, id) && typeof rawMods[id] === 'boolean') {
      modules[id] = rawMods[id];
    }
  }
  const enabledTabList = MODULE_IDS.filter((id) => modules[id] && MODULE_CATALOG[id].hasUiTab);
  const defaultTab =
    isModuleId(obj.defaultTab) && modules[obj.defaultTab] && MODULE_CATALOG[obj.defaultTab].hasUiTab
      ? obj.defaultTab
      : enabledTabList[0] ?? 'review';
  const startupView: NovStartupView = isNovStartupView(obj.startupView) ? obj.startupView : 'hub';
  const locale: NovLocale = isNovLocale(obj.locale) ? obj.locale : 'auto';
  return {
    schemaVersion: 1,
    preset: detectPreset(modules),
    modules,
    defaultTab,
    startupView,
    locale,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : base.updatedAt,
  };
}

export function loadNovConfigReadOnly(rootDataDir: string): NovConfig {
  const cfgPath = getConfigPath(rootDataDir);
  if (!fs.existsSync(cfgPath)) {
    return createDefaultConfig();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    return normalizeConfig(raw);
  } catch {
    return createDefaultConfig();
  }
}

export function saveNovConfig(rootDataDir: string, config: NovConfig): NovConfig {
  const normalized = normalizeConfig({
    ...config,
    updatedAt: new Date().toISOString(),
  });
  fs.mkdirSync(rootDataDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(rootDataDir, 0o700);
  } catch {
    // ignore
  }
  const cfgPath = getConfigPath(rootDataDir);
  const tmpPath = `${cfgPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmpPath, cfgPath);
  return normalized;
}

export function loadOrInitNovConfig(rootDataDir: string): NovConfig {
  const cfgPath = getConfigPath(rootDataDir);
  if (!fs.existsSync(cfgPath)) {
    return createDefaultConfig();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    return normalizeConfig(raw);
  } catch {
    try {
      fs.renameSync(cfgPath, `${cfgPath}.corrupt.${Date.now()}`);
    } catch {
      // ignore
    }
    return saveNovConfig(rootDataDir, createDefaultConfig());
  }
}

export function setModuleEnabled(
  rootDataDir: string,
  moduleId: ModuleId,
  enabled: boolean,
): NovConfig {
  const current = loadOrInitNovConfig(rootDataDir);
  const nextModules: Record<ModuleId, boolean> = {
    ...current.modules,
    [moduleId]: enabled,
  };
  return saveNovConfig(rootDataDir, {
    ...current,
    modules: nextModules,
    defaultTab: enabled && MODULE_CATALOG[moduleId].hasUiTab ? moduleId : current.defaultTab,
  });
}

export function applyPresetConfig(rootDataDir: string, preset: PresetId): NovConfig {
  const current = loadOrInitNovConfig(rootDataDir);
  const def = PRESET_DEFINITIONS[preset];
  return saveNovConfig(rootDataDir, {
    ...current,
    preset,
    modules: { ...def.modules },
    defaultTab: MODULE_IDS.find((id) => def.modules[id] && MODULE_CATALOG[id].hasUiTab) ?? 'review',
  });
}

export function setNovLocale(rootDataDir: string, locale: NovLocale): NovConfig {
  const current = loadOrInitNovConfig(rootDataDir);
  return saveNovConfig(rootDataDir, {
    ...current,
    locale,
  });
}

export function setNovStartupView(rootDataDir: string, startupView: NovStartupView): NovConfig {
  const current = loadOrInitNovConfig(rootDataDir);
  return saveNovConfig(rootDataDir, {
    ...current,
    startupView,
  });
}

export interface SanitizedConfigExport {
  schemaVersion: 1;
  exportedAt: string;
  sanitized: true;
  config: {
    preset: PresetId | 'custom';
    modules: Record<ModuleId, boolean>;
    defaultTab: ModuleId;
    startupView: NovStartupView;
    locale: NovLocale;
  };
}

/**
 * Exports strictly whitelisted agy-NOV configuration fields (never includes secrets,
 * webhooks, pairing tokens, or local filesystem paths).
 */
export function exportSanitizedConfig(config: NovConfig): SanitizedConfigExport {
  const normalized = normalizeConfig(config);
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    sanitized: true,
    config: {
      preset: normalized.preset,
      modules: { ...normalized.modules },
      defaultTab: normalized.defaultTab,
      startupView: normalized.startupView ?? 'hub',
      locale: normalized.locale,
    },
  };
}

const FORBIDDEN_IMPORT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const MAX_CONFIG_IMPORT_BYTES = 32 * 1024;
const MAX_CONFIG_IMPORT_DEPTH = 16;

function hasForbiddenKeyDeep(node: unknown, depth = 0): boolean {
  if (depth > MAX_CONFIG_IMPORT_DEPTH) return true;
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (hasForbiddenKeyDeep(item, depth + 1)) return true;
    }
    return false;
  }
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_IMPORT_KEYS.has(key)) return true;
    if (hasForbiddenKeyDeep(obj[key], depth + 1)) return true;
  }
  return false;
}

export function parseAndValidateConfigImport(
  rawJson: string,
): { ok: true; config: NovConfig; warnings: string[] } | { ok: false; error: string } {
  if (typeof rawJson !== 'string' || !rawJson.trim()) {
    return { ok: false, error: 'Import payload must be a non-empty JSON string.' };
  }
  if (Buffer.byteLength(rawJson, 'utf8') > MAX_CONFIG_IMPORT_BYTES) {
    return { ok: false, error: `Import payload exceeds ${MAX_CONFIG_IMPORT_BYTES} bytes limit.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: 'Invalid JSON syntax in configuration import.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Configuration import must be a JSON object.' };
  }
  if (hasForbiddenKeyDeep(parsed)) {
    return { ok: false, error: 'Rejected unsafe key or excessive nesting in configuration import.' };
  }
  const obj = parsed as Record<string, unknown>;
  const candidate =
    obj.config && typeof obj.config === 'object' && !Array.isArray(obj.config)
      ? (obj.config as Record<string, unknown>)
      : obj;

  const warnings: string[] = [];
  if (candidate.modules !== undefined) {
    if (!candidate.modules || typeof candidate.modules !== 'object' || Array.isArray(candidate.modules)) {
      return { ok: false, error: '"modules" must be a plain object mapping module IDs to booleans.' };
    }
    const rawMods = candidate.modules as Record<string, unknown>;
    for (const key of Object.keys(rawMods)) {
      if (!isModuleId(key)) {
        warnings.push(`Ignored unknown module key "${key}".`);
      } else if (typeof rawMods[key] !== 'boolean') {
        return { ok: false, error: `Module toggle "${key}" must be a boolean.` };
      }
    }
  } else if (!isPresetId(candidate.preset)) {
    return { ok: false, error: 'Import JSON must contain a valid "modules" object or "preset".' };
  }

  let normalized: NovConfig;
  if (isPresetId(candidate.preset) && candidate.modules === undefined) {
    normalized = normalizeConfig({
      ...candidate,
      modules: { ...PRESET_DEFINITIONS[candidate.preset].modules },
    });
  } else {
    normalized = normalizeConfig(candidate);
  }

  // Never silently enable opt-in remote networking during config import unless explicitly kept false
  if (normalized.modules.remote) {
    normalized = normalizeConfig({
      ...normalized,
      modules: { ...normalized.modules, remote: false },
    });
    warnings.push(
      'Opt-in "remote" module was kept OFF for safety on import; toggle it explicitly in Settings if needed.',
    );
  }

  return { ok: true, config: normalized, warnings };
}

export function resetNovConfig(rootDataDir: string): NovConfig {
  return saveNovConfig(rootDataDir, createDefaultConfig());
}

export {
  loadTeamPresetReadOnly,
  MAX_TEAM_CONFIG_BYTES,
  TEAM_CONFIG_FILENAME,
  TEAM_VERIFY_ALLOWED_EXECUTABLES,
  type TeamPresetAuditResult,
  type TeamSpecTemplate,
  type TeamVerifyCommand,
} from './team-config.js';
