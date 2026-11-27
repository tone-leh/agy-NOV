import React, { useCallback, useEffect, useState } from 'react';
import {
  isModuleId,
  LOCALE_NATIVE_LABELS,
  MODULE_CATALOG,
  MODULE_IDS,
  UI_LOCALE_IDS,
  type ModuleId,
  type NovLocale,
  type PresetId,
} from '../../src/core/catalog.js';
import { novBridge, type NovConfigSnapshot, type ToolResultEvent } from './bridge.js';
import {
  formatMessage,
  getDictionary,
  NovI18nProvider,
  resolveUiLocale,
} from './i18n/index.js';
import { CanvasPanel } from './modules/canvas/CanvasPanel.js';
import { GuardPanel } from './modules/guard/GuardPanel.js';
import { MemPanel } from './modules/mem/MemPanel.js';
import { OpsPanel } from './modules/ops/OpsPanel.js';
import { RadarPanel } from './modules/radar/RadarPanel.js';
import { RemotePanel } from './modules/remote/RemotePanel.js';
import { ReviewPanel } from './modules/review/ReviewPanel.js';
import { TurboPanel } from './modules/turbo/TurboPanel.js';
import { VerifyPanel } from './modules/verify/VerifyPanel.js';
import { WorktreePanel } from './modules/worktree/WorktreePanel.js';
import { XrayPanel } from './modules/xray/XrayPanel.js';
import { ModulesPanel } from './panels/ModulesPanel.js';

type ActiveTab = ModuleId | 'modules';

type ModulePanelComponent = React.FC<{
  bridge: typeof novBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: ToolResultEvent | null;
}>;

const MODULE_PANEL_REGISTRY: Record<ModuleId, ModulePanelComponent> = {
  review: ReviewPanel,
  guard: GuardPanel,
  xray: XrayPanel,
  turbo: TurboPanel,
  radar: RadarPanel,
  verify: VerifyPanel,
  worktree: WorktreePanel,
  canvas: CanvasPanel,
  mem: MemPanel,
  ops: OpsPanel,
  remote: RemotePanel,
};

const DEFAULT_ENABLED_MODULES: ModuleId[] = MODULE_IDS.filter(
  (id) => MODULE_CATALOG[id].defaultEnabled,
);

export const App: React.FC = () => {
  const [snapshot, setSnapshot] = useState<NovConfigSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('review');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<ToolResultEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hostLocaleHint, setHostLocaleHint] = useState<string>(() => novBridge.getHostLocaleHint());

  const prefLocale: NovLocale = snapshot?.config.locale ?? 'auto';
  const resolvedLocale = resolveUiLocale(prefLocale, hostLocaleHint);
  const dict = getDictionary(resolvedLocale);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = resolvedLocale;
    }
  }, [resolvedLocale]);

  const notify = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadConfig = useCallback(async () => {
    try {
      const next = await novBridge.getConfig();
      setSnapshot(next);
      setLoadError(null);
      setActiveTab((prev) => {
        if (prev === 'modules') return prev;
        if (next.config.modules[prev]) return prev;
        const firstOn = MODULE_IDS.find((id) => next.config.modules[id]);
        return firstOn ?? 'modules';
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    const unsubLocale = novBridge.onHostLocaleChange((hint) => setHostLocaleHint(hint));
    const unsubConfig = novBridge.onConfigChange((next) => {
      setSnapshot(next);
      setLoadError(null);
    });
    const unsub = novBridge.onToolResult((evt) => {
      setLastEvent(evt);
      const target = evt.structuredContent?.novModule;
      if (target === 'modules') {
        setActiveTab('modules');
      } else if (isModuleId(target)) {
        setActiveTab(target);
      }
      if (evt.structuredContent?.config) {
        void loadConfig();
      }
    });
    return () => {
      unsub();
      unsubConfig();
      unsubLocale();
    };
  }, [loadConfig]);

  const handleToggleModule = useCallback(
    async (moduleId: ModuleId, enabled: boolean) => {
      setBusyKey(moduleId);
      try {
        const next = await novBridge.setModule(moduleId, enabled);
        setSnapshot(next);
        if (!enabled && activeTab === moduleId) {
          const fallback = MODULE_IDS.find((id) => next.config.modules[id]) ?? 'modules';
          setActiveTab(fallback);
        }
        const localDict = getDictionary(resolveUiLocale(next.config.locale, hostLocaleHint));
        notify(
          formatMessage(localDict.toastModuleToggled, {
            name: localDict.modules[moduleId].name,
            state: enabled ? localDict.common.enabled : localDict.common.disabled,
            tools: next.exposedModelTools,
          }),
        );
      } catch (err) {
        notify(`Failed to toggle ${moduleId}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusyKey(null);
      }
    },
    [activeTab, hostLocaleHint, notify],
  );

  const handleApplyPreset = useCallback(
    async (preset: PresetId) => {
      setBusyKey('preset');
      try {
        const next = await novBridge.applyPreset(preset);
        setSnapshot(next);
        if (activeTab !== 'modules' && !next.config.modules[activeTab]) {
          const fallback = MODULE_IDS.find((id) => next.config.modules[id]) ?? 'modules';
          setActiveTab(fallback);
        }
        const localDict = getDictionary(resolveUiLocale(next.config.locale, hostLocaleHint));
        notify(
          formatMessage(localDict.toastPresetApplied, {
            preset: localDict.presets[preset].label,
            enabled: next.enabledCount,
            total: next.totalModules || MODULE_IDS.length,
          }),
        );
      } catch (err) {
        notify(`Failed to apply preset: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusyKey(null);
      }
    },
    [activeTab, hostLocaleHint, notify],
  );

  const handleChangeLocale = useCallback(
    async (nextLocale: NovLocale) => {
      setBusyKey('locale');
      try {
        const next = await novBridge.setLocale(nextLocale);
        setSnapshot(next);
        const resolved = resolveUiLocale(next.config.locale, hostLocaleHint);
        const nextDict = getDictionary(resolved);
        const displayName =
          nextLocale === 'auto' ? nextDict.langAutoOption : LOCALE_NATIVE_LABELS[resolved];
        notify(formatMessage(nextDict.toastLocaleChanged, { locale: displayName }));
      } catch (err) {
        notify(`Failed to switch locale: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusyKey(null);
      }
    },
    [hostLocaleHint, notify],
  );

  const enabledModules = snapshot
    ? MODULE_IDS.filter((id) => snapshot.config.modules[id])
    : DEFAULT_ENABLED_MODULES;

  const isFullHeightTab =
    activeTab !== 'modules' && MODULE_CATALOG[activeTab].uiMode === 'full-height';

  const ActivePanel =
    activeTab !== 'modules' && snapshot?.config.modules[activeTab]
      ? MODULE_PANEL_REGISTRY[activeTab]
      : null;

  return (
    <NovI18nProvider locale={resolvedLocale} prefLocale={prefLocale}>
      <div className="nov-shell">
        <header className="nov-topbar">
          <div className="nov-brand" title={dict.brandTitle}>
            <span className="nov-brand-mark">N</span>
            <span>agy-NOV</span>
          </div>

          <nav className="nov-nav" aria-label="Enabled modules">
            {enabledModules.map((id) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={`nov-tab ${isActive ? 'is-active' : ''}`}
                  onClick={() => setActiveTab(id)}
                >
                  <span className="nov-tab-dot" />
                  <span>{dict.modules[id].shortLabel}</span>
                </button>
              );
            })}
          </nav>

          <div className="nov-topbar-actions">
            <select
              className="nov-lang-select"
              aria-label={dict.langToggleTitle}
              title={dict.langToggleTitle}
              value={prefLocale}
              disabled={busyKey === 'locale'}
              onChange={(e) => void handleChangeLocale(e.target.value as NovLocale)}
            >
              <option value="auto">{dict.langAutoOption}</option>
              {UI_LOCALE_IDS.map((loc) => (
                <option key={loc} value={loc}>
                  {LOCALE_NATIVE_LABELS[loc]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`nov-pill-btn ${activeTab === 'modules' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('modules')}
              title={dict.modulesBtnTitle}
            >
              <span>{dict.modulesBtn}</span>
              <span>
                {snapshot
                  ? `${snapshot.enabledCount}/${snapshot.totalModules || MODULE_IDS.length}`
                  : `${DEFAULT_ENABLED_MODULES.length}/${MODULE_IDS.length}`}
              </span>
            </button>
          </div>
        </header>

        <main className={`nov-stage ${isFullHeightTab ? 'is-full-height' : ''}`}>
          {loadError && !snapshot && (
            <div className="nov-disabled-notice">
              <h3>{dict.connectErrorTitle}</h3>
              <p>{loadError}</p>
              <button type="button" className="nov-open-btn" onClick={() => void loadConfig()}>
                {dict.retry}
              </button>
            </div>
          )}

          {snapshot && activeTab === 'modules' && (
            <ModulesPanel
              snapshot={snapshot}
              busyKey={busyKey}
              onToggleModule={handleToggleModule}
              onApplyPreset={handleApplyPreset}
              onOpenModule={(id) => setActiveTab(id)}
            />
          )}

          {snapshot && activeTab !== 'modules' && !snapshot.config.modules[activeTab] && (
            <div className="nov-disabled-notice">
              <h3>
                {formatMessage(dict.moduleOffTitle, { name: dict.modules[activeTab].name })}
              </h3>
              <p>{dict.modules[activeTab].description}</p>
              <button
                type="button"
                className="nov-open-btn"
                disabled={busyKey !== null}
                onClick={() => void handleToggleModule(activeTab, true)}
              >
                {formatMessage(dict.enableModuleBtn, { name: dict.modules[activeTab].name })}
              </button>
            </div>
          )}

          {snapshot && ActivePanel && (
            <ActivePanel
              bridge={novBridge}
              active={true}
              onNotify={notify}
              incomingEvent={lastEvent}
            />
          )}
        </main>

        {toast && (
          <div className="nov-toast" role="status" aria-live="polite">
            {toast}
          </div>
        )}
      </div>
    </NovI18nProvider>
  );
};
