import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isModuleId,
  LOCALE_NATIVE_LABELS,
  MAX_MCP_TOOL_BUDGET,
  MODULE_CATALOG,
  MODULE_DOMAIN_IDS,
  MODULE_IDS,
  PRESET_IDS,
  UI_LOCALE_IDS,
  type ModuleId,
  type NovLocale,
  type NovStartupView,
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
import { SpecPanel } from './modules/spec/SpecPanel.js';
import { StudioPanel } from './modules/studio/StudioPanel.js';
import { TurboPanel } from './modules/turbo/TurboPanel.js';
import { VerifyPanel } from './modules/verify/VerifyPanel.js';
import { WorktreePanel } from './modules/worktree/WorktreePanel.js';
import { XrayPanel } from './modules/xray/XrayPanel.js';
import { HubPanel } from './panels/HubPanel.js';
import { SettingsHub } from './panels/SettingsHub.js';

type ActiveView = 'hub' | 'settings' | ModuleId;

type ModulePanelComponent = React.FC<{
  bridge: typeof novBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: ToolResultEvent | null;
  onOpenSettings?: (moduleId: ModuleId) => void;
}>;

const MODULE_PANEL_REGISTRY: Record<ModuleId, ModulePanelComponent> = {
  review: ReviewPanel,
  guard: GuardPanel,
  xray: XrayPanel,
  turbo: TurboPanel,
  radar: RadarPanel,
  verify: VerifyPanel,
  worktree: WorktreePanel,
  spec: SpecPanel,
  studio: StudioPanel,
  canvas: CanvasPanel,
  mem: MemPanel,
  ops: OpsPanel,
  remote: RemotePanel,
};

const DEFAULT_ENABLED_MODULES: ModuleId[] = MODULE_IDS.filter(
  (id) => MODULE_CATALOG[id].defaultEnabled,
);

const WIDE_BREAKPOINT_PX = 720;

interface CommandItem {
  id: string;
  group: string;
  label: string;
  sublabel?: string;
  badge?: string;
  searchText: string;
  run: () => void | Promise<void>;
}

function mapIncomingTargetToView(target: unknown): ActiveView | null {
  if (target === 'modules' || target === 'settings') return 'settings';
  if (target === 'hub') return 'hub';
  if (isModuleId(target)) return target;
  return null;
}

function getBudgetTone(exposed: number, limit: number): 'is-safe' | 'is-warn' | 'is-danger' {
  const ratio = limit > 0 ? (exposed / limit) * 100 : 0;
  if (ratio >= 85) return 'is-danger';
  if (ratio >= 60) return 'is-warn';
  return 'is-safe';
}

export const App: React.FC = () => {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const cmdInputRef = useRef<HTMLInputElement | null>(null);
  const initialViewResolvedRef = useRef(false);
  const explicitTargetSeenRef = useRef(false);

  const [snapshot, setSnapshot] = useState<NovConfigSnapshot | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>('hub');
  const [settingsFocusModule, setSettingsFocusModule] = useState<ModuleId | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<ToolResultEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hostLocaleHint, setHostLocaleHint] = useState<string>(() => novBridge.getHostLocaleHint());
  const [containerWidth, setContainerWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 960,
  );

  // Command Palette (Cmd/Ctrl+K)
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');
  const [cmdSelectedIdx, setCmdSelectedIdx] = useState(0);

  const prefLocale: NovLocale = snapshot?.config.locale ?? 'auto';
  const resolvedLocale = resolveUiLocale(prefLocale, hostLocaleHint);
  const dict = getDictionary(resolvedLocale);
  const isWide = containerWidth >= WIDE_BREAKPOINT_PX;

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = resolvedLocale;
    }
  }, [resolvedLocale]);

  // Dual-mode adaptive layout via ResizeObserver + window resize fallback
  useEffect(() => {
    const updateFromWindow = () => {
      if (typeof window !== 'undefined') {
        setContainerWidth(shellRef.current?.clientWidth || window.innerWidth);
      }
    };

    const el = shellRef.current;
    let ro: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect?.width;
        if (typeof w === 'number' && w > 0) {
          setContainerWidth(w);
        }
      });
      ro.observe(el);
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', updateFromWindow);
      updateFromWindow();
    }

    return () => {
      ro?.disconnect();
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', updateFromWindow);
      }
    };
  }, []);

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

      if (!initialViewResolvedRef.current) {
        initialViewResolvedRef.current = true;
        if (!explicitTargetSeenRef.current) {
          if (next.config.startupView === 'last') {
            const preferred = next.config.defaultTab;
            if (preferred && next.config.modules[preferred]) {
              setActiveView(preferred);
            } else {
              const firstOn = MODULE_IDS.find((id) => next.config.modules[id]);
              setActiveView(firstOn ?? 'hub');
            }
          } else {
            setActiveView('hub');
          }
        }
      } else {
        setActiveView((prev) => {
          if (prev === 'hub' || prev === 'settings') return prev;
          if (next.config.modules[prev]) return prev;
          return 'hub';
        });
      }
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
      const mapped = mapIncomingTargetToView(evt.structuredContent?.novModule);
      if (mapped) {
        explicitTargetSeenRef.current = true;
        setActiveView(mapped);
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

  // Global Cmd/Ctrl+K shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((open) => {
          const next = !open;
          if (next) {
            setCmdQuery('');
            setCmdSelectedIdx(0);
          }
          return next;
        });
      } else if (e.key === 'Escape') {
        setCmdOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (cmdOpen) {
      window.setTimeout(() => cmdInputRef.current?.focus(), 10);
    }
  }, [cmdOpen]);

  const handleToggleModule = useCallback(
    async (moduleId: ModuleId, enabled: boolean) => {
      setBusyKey(moduleId);
      try {
        const next = await novBridge.setModule(moduleId, enabled);
        setSnapshot(next);
        if (!enabled && activeView === moduleId) {
          setActiveView('hub');
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
    [activeView, hostLocaleHint, notify],
  );

  const handleApplyPreset = useCallback(
    async (preset: PresetId) => {
      setBusyKey('preset');
      try {
        const next = await novBridge.applyPreset(preset);
        setSnapshot(next);
        if (activeView !== 'hub' && activeView !== 'settings' && !next.config.modules[activeView]) {
          setActiveView('hub');
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
    [activeView, hostLocaleHint, notify],
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

  const handleChangeStartupView = useCallback(
    async (startupView: NovStartupView) => {
      setBusyKey('startupView');
      try {
        const next = await novBridge.setStartupView(startupView);
        setSnapshot(next);
        const localDict = getDictionary(resolveUiLocale(next.config.locale, hostLocaleHint));
        notify(
          `${localDict.settingsHub.startupViewLabel}: ${
            startupView === 'hub'
              ? localDict.settingsHub.startupHub
              : localDict.settingsHub.startupLast
          }`,
        );
      } catch (err) {
        notify(
          `Failed to update startup view: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setBusyKey(null);
      }
    },
    [hostLocaleHint, notify],
  );

  const openCommandPalette = useCallback(() => {
    setCmdQuery('');
    setCmdSelectedIdx(0);
    setCmdOpen(true);
  }, []);

  const enabledModules = snapshot
    ? MODULE_IDS.filter((id) => snapshot.config.modules[id])
    : DEFAULT_ENABLED_MODULES;

  const groupedEnabledDomains = useMemo(() => {
    return MODULE_DOMAIN_IDS.map((domainId) => ({
      domainId,
      modules: enabledModules.filter((modId) => MODULE_CATALOG[modId].domain === domainId),
    })).filter((g) => g.modules.length > 0);
  }, [enabledModules]);

  const commandItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      {
        id: 'nav:hub',
        group: dict.nav.hubLabel,
        label: dict.hub.title,
        sublabel: dict.hub.subtitle,
        badge: dict.nav.hubLabel,
        searchText: `hub overview ${dict.hub.title} ${dict.nav.hubLabel}`.toLowerCase(),
        run: () => setActiveView('hub'),
      },
      {
        id: 'nav:settings',
        group: dict.nav.settingsLabel,
        label: dict.settingsHub.title,
        sublabel: dict.settingsHub.subtitle,
        badge: dict.nav.settingsLabel,
        searchText: `settings modules config ${dict.settingsHub.title} ${dict.nav.settingsLabel}`.toLowerCase(),
        run: () => setActiveView('settings'),
      },
    ];

    for (const modId of MODULE_IDS) {
      const enabled = Boolean(snapshot?.config.modules[modId]);
      const modText = dict.modules[modId];
      const domainLabel = dict.domains[MODULE_CATALOG[modId].domain].label;
      items.push({
        id: `mod:${modId}`,
        group: domainLabel,
        label: modText.name,
        sublabel: modText.tagline,
        badge: enabled ? dict.hub.openModule : dict.hub.enableToUse,
        searchText: `${modId} ${modText.name} ${modText.shortLabel} ${modText.tagline} ${domainLabel}`.toLowerCase(),
        run: async () => {
          if (enabled) {
            setActiveView(modId);
          } else {
            await handleToggleModule(modId, true);
            setActiveView(modId);
          }
        },
      });
    }

    for (const pid of PRESET_IDS) {
      const pDef = dict.presets[pid];
      items.push({
        id: `preset:${pid}`,
        group: dict.presetsLabel,
        label: pDef.label,
        sublabel: pDef.description,
        badge: dict.presetsLabel,
        searchText: `preset ${pid} ${pDef.label} ${pDef.description}`.toLowerCase(),
        run: () => handleApplyPreset(pid),
      });
    }

    return items;
  }, [dict, snapshot, handleToggleModule, handleApplyPreset]);

  const filteredCommands = useMemo(() => {
    const q = cmdQuery.trim().toLowerCase();
    if (!q) return commandItems;
    return commandItems.filter((item) => item.searchText.includes(q));
  }, [commandItems, cmdQuery]);

  const executeCommand = async (item: CommandItem) => {
    setCmdOpen(false);
    await item.run();
  };

  const isFullHeightView =
    activeView !== 'hub' &&
    activeView !== 'settings' &&
    MODULE_CATALOG[activeView].uiMode === 'full-height';

  const ActiveModulePanel =
    activeView !== 'hub' && activeView !== 'settings' && snapshot?.config.modules[activeView]
      ? MODULE_PANEL_REGISTRY[activeView]
      : null;

  const totalModulesCount = snapshot?.totalModules || MODULE_IDS.length;
  const enabledCountDisplay = snapshot ? snapshot.enabledCount : DEFAULT_ENABLED_MODULES.length;
  const exposedToolsDisplay = snapshot ? snapshot.exposedModelTools : 12;
  const budgetTone = getBudgetTone(exposedToolsDisplay, MAX_MCP_TOOL_BUDGET);

  const narrowSelectValue =
    activeView !== 'hub' && activeView !== 'settings' ? activeView : '';

  return (
    <NovI18nProvider locale={resolvedLocale} prefLocale={prefLocale}>
      <div ref={shellRef} className={`nov-shell ${isWide ? 'is-wide' : 'is-narrow'}`}>
        {/* Narrow Mode (< 720px, aux_pane): Clean 4-control topbar */}
        {!isWide && (
          <header className="nov-topbar is-narrow">
            <button
              type="button"
              className={`nov-brand-btn ${activeView === 'hub' ? 'is-active' : ''}`}
              title={dict.brandTitle}
              onClick={() => setActiveView('hub')}
            >
              <span className="nov-brand-mark">N</span>
              <span>{dict.nav.hubLabel}</span>
            </button>

            <select
              className="nov-narrow-select"
              aria-label={dict.nav.narrowSwitcherLabel}
              value={narrowSelectValue}
              onChange={(e) => {
                const val = e.target.value;
                if (isModuleId(val)) {
                  setActiveView(val);
                }
              }}
            >
              <option value="" disabled>
                {dict.nav.switchModulePlaceholder}
              </option>
              {groupedEnabledDomains.map(({ domainId, modules }) => (
                <optgroup key={domainId} label={dict.domains[domainId].label}>
                  {modules.map((modId) => (
                    <option key={modId} value={modId}>
                      {dict.modules[modId].shortLabel} — {dict.modules[modId].name}
                    </option>
                  ))}
                </optgroup>
              ))}
              {activeView !== 'hub' &&
                activeView !== 'settings' &&
                !enabledModules.includes(activeView) && (
                  <option value={activeView}>{dict.modules[activeView].name}</option>
                )}
            </select>

            <button
              type="button"
              className="nov-pill-btn nov-cmd-trigger"
              title={dict.nav.commandPaletteTitle}
              aria-label={dict.nav.commandPaletteTitle}
              onClick={openCommandPalette}
            >
              ⌘K
            </button>

            <button
              type="button"
              className={`nov-pill-btn ${activeView === 'settings' ? 'is-active' : ''}`}
              title={dict.nav.openSettingsTip}
              aria-label={dict.nav.settingsLabel}
              onClick={() => setActiveView('settings')}
            >
              ⚙
            </button>
          </header>
        )}

        {/* Wide Mode (>= 720px, global): 204px grouped sidebar */}
        {isWide && (
          <aside className="nov-sidebar" aria-label="Primary navigation">
            <div className="nov-sidebar-top">
              <div className="nov-brand" title={dict.brandTitle}>
                <span className="nov-brand-mark">N</span>
                <span>agy-NOV</span>
              </div>
              <button
                type="button"
                className="nov-pill-btn nov-cmd-trigger"
                title={dict.nav.commandPaletteTitle}
                aria-label={dict.nav.commandPaletteTitle}
                onClick={openCommandPalette}
              >
                ⌘K
              </button>
            </div>

            <div className="nov-sidebar-hub-wrap">
              <button
                type="button"
                className={`nov-sidebar-item ${activeView === 'hub' ? 'is-active' : ''}`}
                onClick={() => setActiveView('hub')}
              >
                <span className="nov-sidebar-item-label">{dict.hub.title}</span>
              </button>
            </div>

            <nav className="nov-sidebar-nav" aria-label="Enabled modules by domain">
              {groupedEnabledDomains.map(({ domainId, modules }) => (
                <div key={domainId} className="nov-sidebar-group">
                  <div className="nov-sidebar-group-title">{dict.domains[domainId].label}</div>
                  {modules.map((modId) => {
                    const isActive = activeView === modId;
                    return (
                      <button
                        key={modId}
                        type="button"
                        className={`nov-sidebar-item ${isActive ? 'is-active' : ''}`}
                        onClick={() => setActiveView(modId)}
                      >
                        <span className="nov-tab-dot" />
                        <span className="nov-sidebar-item-label">
                          {dict.modules[modId].shortLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>

            <div className="nov-sidebar-footer">
              <button
                type="button"
                className={`nov-sidebar-settings-btn ${activeView === 'settings' ? 'is-active' : ''}`}
                title={dict.nav.openSettingsTip}
                onClick={() => setActiveView('settings')}
              >
                <span>⚙ {dict.nav.settingsLabel}</span>
                <span className={`nov-sidebar-budget ${budgetTone}`}>
                  {enabledCountDisplay}/{totalModulesCount} · {exposedToolsDisplay}/
                  {MAX_MCP_TOOL_BUDGET}t
                </span>
              </button>

              <select
                className="nov-lang-select nov-sidebar-lang"
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
            </div>
          </aside>
        )}

        {/* Main Content Stage */}
        <main className={`nov-stage ${isFullHeightView ? 'is-full-height' : ''}`}>
          {loadError && !snapshot && (
            <div className="nov-disabled-notice">
              <h3>{dict.connectErrorTitle}</h3>
              <p>{loadError}</p>
              <button type="button" className="nov-open-btn" onClick={() => void loadConfig()}>
                {dict.retry}
              </button>
            </div>
          )}

          {snapshot && activeView === 'hub' && (
            <HubPanel
              bridge={novBridge}
              snapshot={snapshot}
              busyKey={busyKey}
              onOpenModule={(id) => setActiveView(id)}
              onOpenSettings={() => setActiveView('settings')}
              onToggleModule={handleToggleModule}
              onApplyPreset={handleApplyPreset}
              onChangeLocale={handleChangeLocale}
              onOpenCommandPalette={openCommandPalette}
              onNotify={notify}
            />
          )}

          {snapshot && activeView === 'settings' && (
            <SettingsHub
              bridge={novBridge}
              snapshot={snapshot}
              busyKey={busyKey}
              initialExpandedModule={settingsFocusModule}
              onToggleModule={handleToggleModule}
              onApplyPreset={handleApplyPreset}
              onChangeLocale={handleChangeLocale}
              onChangeStartupView={handleChangeStartupView}
              onOpenModule={(id) => {
                setSettingsFocusModule(null);
                setActiveView(id);
              }}
              onSnapshotReplaced={(next) => setSnapshot(next)}
              onNotify={notify}
            />
          )}

          {snapshot &&
            activeView !== 'hub' &&
            activeView !== 'settings' &&
            !snapshot.config.modules[activeView] && (
              <div className="nov-disabled-notice">
                <h3>
                  {formatMessage(dict.moduleOffTitle, { name: dict.modules[activeView].name })}
                </h3>
                <p>{dict.modules[activeView].description}</p>
                <button
                  type="button"
                  className="nov-open-btn"
                  disabled={busyKey !== null}
                  onClick={() => void handleToggleModule(activeView, true)}
                >
                  {formatMessage(dict.enableModuleBtn, { name: dict.modules[activeView].name })}
                </button>
              </div>
            )}

          {snapshot && ActiveModulePanel && (
            <ActiveModulePanel
              bridge={novBridge}
              active={true}
              onNotify={notify}
              incomingEvent={lastEvent}
              onOpenSettings={(modId) => {
                setSettingsFocusModule(modId);
                setActiveView('settings');
              }}
            />
          )}
        </main>

        {/* Cmd/Ctrl+K Command Palette */}
        {cmdOpen && (
          <div
            className="nov-cmd-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label={dict.nav.commandPaletteTitle}
            onClick={() => setCmdOpen(false)}
          >
            <div className="nov-cmd-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="nov-cmd-head">
                <input
                  ref={cmdInputRef}
                  type="text"
                  className="nov-cmd-input"
                  placeholder={dict.nav.commandPalettePlaceholder}
                  value={cmdQuery}
                  onChange={(e) => {
                    setCmdQuery(e.target.value);
                    setCmdSelectedIdx(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setCmdSelectedIdx((idx) =>
                        filteredCommands.length > 0 ? (idx + 1) % filteredCommands.length : 0,
                      );
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setCmdSelectedIdx((idx) =>
                        filteredCommands.length > 0
                          ? (idx - 1 + filteredCommands.length) % filteredCommands.length
                          : 0,
                      );
                    } else if (e.key === 'Enter' && filteredCommands[cmdSelectedIdx]) {
                      e.preventDefault();
                      void executeCommand(filteredCommands[cmdSelectedIdx]);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setCmdOpen(false);
                    }
                  }}
                />
                <span className="nov-badge">ESC</span>
              </div>

              <div className="nov-cmd-list">
                {filteredCommands.length === 0 ? (
                  <div className="nov-cmd-empty">{dict.nav.commandPaletteEmpty}</div>
                ) : (
                  filteredCommands.map((item, idx) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`nov-cmd-item ${idx === cmdSelectedIdx ? 'is-selected' : ''}`}
                      onMouseEnter={() => setCmdSelectedIdx(idx)}
                      onClick={() => void executeCommand(item)}
                    >
                      <div className="nov-cmd-item-main">
                        <span className="nov-cmd-item-label">{item.label}</span>
                        {item.sublabel && (
                          <span className="nov-cmd-item-sub">{item.sublabel}</span>
                        )}
                      </div>
                      <div className="nov-cmd-item-meta">
                        <span className="nov-badge">{item.group}</span>
                        {item.badge && (
                          <span className="nov-badge is-accent">{item.badge}</span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {toast && (
          <div className="nov-toast" role="status" aria-live="polite">
            {toast}
          </div>
        )}
      </div>
    </NovI18nProvider>
  );
};
