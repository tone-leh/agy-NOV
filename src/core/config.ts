import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  countEnabledModelTools,
  isModuleId,
  isNovLocale,
  isPresetId,
  LOCALE_IDS,
  LOCALE_NATIVE_LABELS,
  MODULE_CATALOG,
  MODULE_CATEGORY_IDS,
  MODULE_CATEGORY_META,
  MODULE_IDS,
  OFFLINE_NATIVE_MODULE_IDS,
  PRESET_DEFINITIONS,
  PRESET_IDS,
  UI_LOCALE_IDS,
  type IsolationTier,
  type ModuleCategoryId,
  type ModuleId,
  type ModuleMetadata,
  type NovConfig,
  type NovLocale,
  type PresetId,
  type ResolvedUiLocale,
} from './catalog.js';

export {
  countEnabledModelTools,
  isModuleId,
  isNovLocale,
  isPresetId,
  LOCALE_IDS,
  LOCALE_NATIVE_LABELS,
  MODULE_CATALOG,
  MODULE_CATEGORY_IDS,
  MODULE_CATEGORY_META,
  MODULE_IDS,
  OFFLINE_NATIVE_MODULE_IDS,
  PRESET_DEFINITIONS,
  PRESET_IDS,
  UI_LOCALE_IDS,
  type IsolationTier,
  type ModuleCategoryId,
  type ModuleId,
  type ModuleMetadata,
  type NovConfig,
  type NovLocale,
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
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  const rawMods =
    obj.modules && typeof obj.modules === 'object' ? (obj.modules as Record<string, unknown>) : {};
  const modules: Record<ModuleId, boolean> = { ...base.modules };
  for (const id of MODULE_IDS) {
    if (typeof rawMods[id] === 'boolean') {
      modules[id] = rawMods[id];
    }
  }
  const enabledTabList = MODULE_IDS.filter((id) => modules[id] && MODULE_CATALOG[id].hasUiTab);
  const defaultTab =
    isModuleId(obj.defaultTab) && modules[obj.defaultTab] && MODULE_CATALOG[obj.defaultTab].hasUiTab
      ? obj.defaultTab
      : enabledTabList[0] ?? 'review';
  const locale: NovLocale = isNovLocale(obj.locale) ? obj.locale : 'auto';
  return {
    schemaVersion: 1,
    preset: detectPreset(modules),
    modules,
    defaultTab,
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
