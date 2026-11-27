import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  applyPresetConfig,
  createDefaultConfig,
  exportSanitizedConfig,
  isModuleDomainId,
  isNovStartupView,
  loadNovConfigReadOnly,
  MAX_CONFIG_IMPORT_BYTES,
  MAX_MCP_TOOL_BUDGET,
  MODULE_CATALOG,
  MODULE_DOMAIN_IDS,
  MODULE_DOMAIN_META,
  MODULE_IDS,
  normalizeConfig,
  parseAndValidateConfigImport,
  resetNovConfig,
  setNovLocale,
  setNovStartupView,
  STARTUP_VIEW_IDS,
  UI_LOCALE_IDS,
  type ModuleDomainId,
  type NovConfig,
  type ResolvedUiLocale,
} from '../src/core/config.js';
import { DE_DICT } from '../ui/src/i18n/locales/de.js';
import { EN_DICT } from '../ui/src/i18n/locales/en.js';
import { ES_DICT } from '../ui/src/i18n/locales/es.js';
import { FR_DICT } from '../ui/src/i18n/locales/fr.js';
import { JA_DICT } from '../ui/src/i18n/locales/ja.js';
import { KO_DICT } from '../ui/src/i18n/locales/ko.js';
import { ZH_CN_DICT } from '../ui/src/i18n/locales/zh-CN.js';
import { ZH_TW_DICT } from '../ui/src/i18n/locales/zh-TW.js';
import type { UiDictionary } from '../ui/src/i18n/types.js';

const ALL_DICTS: Record<ResolvedUiLocale, UiDictionary> = {
  en: EN_DICT,
  'zh-CN': ZH_CN_DICT,
  'zh-TW': ZH_TW_DICT,
  ja: JA_DICT,
  ko: KO_DICT,
  es: ES_DICT,
  fr: FR_DICT,
  de: DE_DICT,
};

function flattenStrings(obj: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      out[key] = v;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenStrings(v, key));
    }
  }
  return out;
}

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

describe('v0.7.0 i18n dictionary coverage (domains / nav / hub / settingsHub)', () => {
  const EXPECTED_NAV_KEYS = [
    'hubLabel',
    'settingsLabel',
    'switchModulePlaceholder',
    'commandPaletteTitle',
    'commandPalettePlaceholder',
    'commandPaletteEmpty',
    'openSettingsTip',
    'toolBudgetLabel',
    'narrowSwitcherLabel',
  ];

  const EXPECTED_HUB_KEYS = [
    'title',
    'subtitle',
    'pipelineTitle',
    'alertsTitle',
    'noAlerts',
    'quickActionsTitle',
    'openModule',
    'enableToUse',
    'writeLockBadge',
    'staleMemBadge',
    'blockedBadge',
    'verifyPass',
    'verifyFail',
    'verifyIdle',
    'dualStarReady',
  ];

  const EXPECTED_SETTINGS_HUB_KEYS = [
    'title',
    'subtitle',
    'searchPlaceholder',
    'searchClear',
    'searchNoHits',
    'startupViewLabel',
    'startupHub',
    'startupLast',
    'configureBtn',
    'collapseBtn',
    'strategyTitle',
    'openFullPanelBtn',
    'advancedTitle',
    'advancedSub',
    'teamPresetSection',
    'exportBtn',
    'importBtn',
    'importPlaceholder',
    'importApplyBtn',
    'resetBtn',
    'resetConfirmBtn',
    'resetCancelBtn',
    'dualStarSection',
    'feedReady',
    'feedMissing',
    'idleSlotHint',
    'safetyNotice',
    'importSuccess',
    'resetSuccess',
  ];

  it('contains exact required keys across all 8 locales with non-empty strings', () => {
    const enFlat = {
      ...flattenStrings(EN_DICT.domains, 'domains'),
      ...flattenStrings(EN_DICT.nav, 'nav'),
      ...flattenStrings(EN_DICT.hub, 'hub'),
      ...flattenStrings(EN_DICT.settingsHub, 'settingsHub'),
    };
    const enKeys = Object.keys(enFlat).sort();

    assert.deepEqual(Object.keys(EN_DICT.domains).sort(), [...MODULE_DOMAIN_IDS].sort());
    assert.deepEqual(Object.keys(EN_DICT.nav).sort(), [...EXPECTED_NAV_KEYS].sort());
    assert.deepEqual(Object.keys(EN_DICT.hub).sort(), [...EXPECTED_HUB_KEYS].sort());
    assert.deepEqual(
      Object.keys(EN_DICT.settingsHub).sort(),
      [...EXPECTED_SETTINGS_HUB_KEYS].sort(),
    );

    for (const locale of UI_LOCALE_IDS) {
      const dict = ALL_DICTS[locale];
      assert.ok(dict, `Missing dictionary for locale ${locale}`);

      const flat = {
        ...flattenStrings(dict.domains, 'domains'),
        ...flattenStrings(dict.nav, 'nav'),
        ...flattenStrings(dict.hub, 'hub'),
        ...flattenStrings(dict.settingsHub, 'settingsHub'),
      };
      assert.deepEqual(
        Object.keys(flat).sort(),
        enKeys,
        `Locale ${locale} v0.7.0 keys diverged from English baseline`,
      );

      for (const [k, val] of Object.entries(flat)) {
        assert.equal(typeof val, 'string', `${locale}.${k} must be a string`);
        assert.ok(val.trim().length > 0, `${locale}.${k} must be non-empty`);
      }
    }
  });

  it('translates all new v0.7.0 keys natively in all 7 non-English locales (zero English placeholders)', () => {
    const enFlat = {
      ...flattenStrings(EN_DICT.domains, 'domains'),
      ...flattenStrings(EN_DICT.nav, 'nav'),
      ...flattenStrings(EN_DICT.hub, 'hub'),
      ...flattenStrings(EN_DICT.settingsHub, 'settingsHub'),
    };

    for (const locale of UI_LOCALE_IDS) {
      if (locale === 'en') continue;
      const dict = ALL_DICTS[locale];
      const flat = {
        ...flattenStrings(dict.domains, 'domains'),
        ...flattenStrings(dict.nav, 'nav'),
        ...flattenStrings(dict.hub, 'hub'),
        ...flattenStrings(dict.settingsHub, 'settingsHub'),
      };

      const untranslated: string[] = [];
      for (const [key, enValue] of Object.entries(enFlat)) {
        if (flat[key].trim() === enValue.trim()) {
          untranslated.push(`${locale}.${key}="${flat[key]}"`);
        }
      }
      assert.deepEqual(
        untranslated,
        [],
        `Found untranslated English strings in ${locale}: ${untranslated.join(', ')}`,
      );
    }
  });
});

describe('v0.7.0 domain taxonomy and catalog constants', () => {
  it('covers all 13 modules across 4 domains without omissions or duplicates', () => {
    assert.deepEqual([...MODULE_DOMAIN_IDS], ['core', 'pipeline', 'toolbox', 'connectivity']);
    assert.deepEqual([...STARTUP_VIEW_IDS], ['hub', 'last']);
    assert.equal(MAX_MCP_TOOL_BUDGET, 100);

    const seen = new Set<string>();
    const countsByDomain: Record<ModuleDomainId, number> = {
      core: 0,
      pipeline: 0,
      toolbox: 0,
      connectivity: 0,
    };

    for (const domainId of MODULE_DOMAIN_IDS) {
      assert.equal(isModuleDomainId(domainId), true);
      const meta = MODULE_DOMAIN_META[domainId];
      assert.ok(meta.label.trim().length > 0);
      assert.ok(meta.description.trim().length > 0);
      assert.ok(meta.tierLabel.trim().length > 0);
    }
    assert.equal(isModuleDomainId('unknown-domain'), false);

    for (const modId of MODULE_IDS) {
      const domain = MODULE_CATALOG[modId].domain;
      assert.equal(isModuleDomainId(domain), true, `Invalid domain for ${modId}: ${String(domain)}`);
      assert.equal(seen.has(modId), false, `Duplicate module ${modId}`);
      seen.add(modId);
      countsByDomain[domain] += 1;
    }

    assert.equal(seen.size, MODULE_IDS.length);
    assert.equal(seen.size, 13);
    assert.deepEqual(countsByDomain, {
      core: 3,
      pipeline: 5,
      toolbox: 4,
      connectivity: 1,
    });
  });
});

describe('v0.7.0 config export/import, startupView, and reset governance', () => {
  it('exportSanitizedConfig exports strictly whitelisted fields and strips extra/secret properties', () => {
    const base = createDefaultConfig();
    const syntheticSecret = ['sk', 'live', 'do-not-export'].join('-');
    const syntheticPath = path.join('/tmp', 'synthetic-private-nov-data');
    const pollutedInput = {
      ...base,
      startupView: 'last' as const,
      locale: 'zh-CN' as const,
      secret: syntheticSecret,
      pairingToken: 'top-secret-token',
      webhookUrl: 'https://hooks.example.com/secret',
      dataDir: syntheticPath,
    } as NovConfig & Record<string, unknown>;

    const exported = exportSanitizedConfig(pollutedInput);
    assert.equal(exported.schemaVersion, 1);
    assert.equal(exported.sanitized, true);
    assert.equal(typeof exported.exportedAt, 'string');
    assert.deepEqual(Object.keys(exported).sort(), ['config', 'exportedAt', 'sanitized', 'schemaVersion']);
    assert.deepEqual(Object.keys(exported.config).sort(), [
      'defaultTab',
      'locale',
      'modules',
      'preset',
      'startupView',
    ]);
    assert.equal(exported.config.startupView, 'last');
    assert.equal(exported.config.locale, 'zh-CN');

    const serialized = JSON.stringify(exported);
    assert.equal(serialized.includes(syntheticSecret), false);
    assert.equal(serialized.includes('top-secret-token'), false);
    assert.equal(serialized.includes('hooks.example.com'), false);
    assert.equal(serialized.includes(syntheticPath), false);
  });

  it('parseAndValidateConfigImport accepts wrapped, bare, and preset-only JSON and enforces remote=false', () => {
    // 1. Wrapped export with remote forced ON
    const wrappedWithRemote = JSON.stringify({
      schemaVersion: 1,
      sanitized: true,
      config: {
        preset: 'full',
        modules: {
          review: true,
          guard: true,
          xray: true,
          verify: true,
          remote: true,
          unknownFutureMod: true,
        },
        startupView: 'last',
        locale: 'ja',
      },
    });
    const res1 = parseAndValidateConfigImport(wrappedWithRemote);
    assert.equal(res1.ok, true);
    if (res1.ok) {
      assert.equal(res1.config.modules.remote, false);
      assert.equal(res1.config.modules.verify, true);
      assert.equal(res1.config.startupView, 'last');
      assert.equal(res1.config.locale, 'ja');
      assert.ok(res1.warnings.some((w) => w.includes('unknownFutureMod')));
      assert.ok(res1.warnings.some((w) => w.toLowerCase().includes('remote')));
    }

    // 2. Preset-only ("full") also forces remote=false for safety
    const res2 = parseAndValidateConfigImport(JSON.stringify({ preset: 'full', locale: 'de' }));
    assert.equal(res2.ok, true);
    if (res2.ok) {
      assert.equal(res2.config.modules.remote, false);
      assert.equal(res2.config.modules.spec, true);
      assert.equal(res2.config.locale, 'de');
      assert.ok(res2.warnings.some((w) => w.toLowerCase().includes('remote')));
    }

    // 3. Bare object with offline modules produces zero warnings
    const res3 = parseAndValidateConfigImport(
      JSON.stringify({
        modules: { review: true, guard: true, xray: false },
        startupView: 'hub',
      }),
    );
    assert.equal(res3.ok, true);
    if (res3.ok) {
      assert.deepEqual(res3.warnings, []);
      assert.equal(res3.config.modules.review, true);
      assert.equal(res3.config.modules.xray, false);
      assert.equal(res3.config.modules.remote, false);
    }
  });

  it('parseAndValidateConfigImport blocks prototype pollution and malformed/oversized payloads', () => {
    const protoTop = '{"__proto__": {"polluted": true}, "modules": {"guard": true}}';
    const protoConfig = '{"config": {"constructor": {"x": 1}, "modules": {"guard": true}}}';
    const protoModules = '{"modules": {"prototype": true, "guard": true}}';

    for (const payload of [protoTop, protoConfig, protoModules]) {
      const res = parseAndValidateConfigImport(payload);
      assert.equal(res.ok, false, `Expected unsafe payload to be rejected: ${payload}`);
    }
    assert.equal(({} as Record<string, unknown>).polluted, undefined);

    assert.equal(parseAndValidateConfigImport('').ok, false);
    assert.equal(parseAndValidateConfigImport('   ').ok, false);
    assert.equal(parseAndValidateConfigImport('{bad json').ok, false);
    assert.equal(parseAndValidateConfigImport('[]').ok, false);
    assert.equal(parseAndValidateConfigImport('{}').ok, false);

    const oversized = JSON.stringify({
      preset: 'core',
      padding: 'x'.repeat(MAX_CONFIG_IMPORT_BYTES + 128),
    });
    const oversizedRes = parseAndValidateConfigImport(oversized);
    assert.equal(oversizedRes.ok, false);
  });

  it('persists startupView changes and restores Core defaults on resetNovConfig', async () => {
    await withTempDir('agy-nov-v07-cfg-', (dataDir) => {
      assert.equal(isNovStartupView('hub'), true);
      assert.equal(isNovStartupView('last'), true);
      assert.equal(isNovStartupView('other'), false);

      // Invalid startupView normalizes safely to 'hub'
      const normalized = normalizeConfig({ startupView: 'invalid-mode' });
      assert.equal(normalized.startupView, 'hub');

      // Mutate preset, locale, startupView
      applyPresetConfig(dataDir, 'full');
      setNovLocale(dataDir, 'ko');
      const updated = setNovStartupView(dataDir, 'last');
      assert.equal(updated.startupView, 'last');
      assert.equal(updated.locale, 'ko');
      assert.equal(updated.modules.remote, true);

      const reloaded = loadNovConfigReadOnly(dataDir);
      assert.equal(reloaded.startupView, 'last');
      assert.equal(reloaded.locale, 'ko');
      assert.equal(reloaded.preset, 'full');

      // Reset to defaults
      const reset = resetNovConfig(dataDir);
      assert.equal(reset.preset, 'core');
      assert.equal(reset.startupView, 'hub');
      assert.equal(reset.locale, 'auto');
      assert.equal(reset.modules.remote, false);
      assert.equal(reset.modules.review, true);
      assert.equal(reset.modules.guard, true);
      assert.equal(reset.modules.xray, true);
      assert.equal(reset.modules.spec, false);

      const afterReset = loadNovConfigReadOnly(dataDir);
      assert.equal(afterReset.preset, 'core');
      assert.equal(afterReset.startupView, 'hub');
      assert.equal(afterReset.modules.remote, false);
    });
  });

  it('parseAndValidateConfigImport rejects deep prototype keys and malformed modules shapes', () => {
    const nestedProto = '{"modules":{"review":{"__proto__":{"polluted":true}}}}';
    const siblingProto = '{"modules":{"review":true},"extra":{"__proto__":{"polluted":true}}}';
    const arrayCtor = '{"modules":{"review":true},"arr":[{"constructor":{"prototype":{"x":1}}}]}';
    const stringModules = '{"preset":"full","modules":"bad"}';
    const arrayModules = '{"preset":"full","modules":[]}';
    const nonBoolToggle = '{"modules":{"review":"yes","guard":123}}';

    for (const badPayload of [
      nestedProto,
      siblingProto,
      arrayCtor,
      stringModules,
      arrayModules,
      nonBoolToggle,
    ]) {
      const res = parseAndValidateConfigImport(badPayload);
      assert.equal(res.ok, false, `Expected rejection for payload: ${badPayload}`);
    }
  });
});
