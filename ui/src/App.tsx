import React, { useCallback, useEffect, useState } from 'react';
import {
  isModuleId,
  MODULE_CATALOG,
  MODULE_IDS,
  type ModuleId,
  type PresetId,
} from '../../src/core/catalog.js';
import { novBridge, type NovConfigSnapshot, type ToolResultEvent } from './bridge.js';
import { CanvasPanel } from './modules/canvas/CanvasPanel.js';
import { GuardPanel } from './modules/guard/GuardPanel.js';
import { MemPanel } from './modules/mem/MemPanel.js';
import { RemotePanel } from './modules/remote/RemotePanel.js';
import { ReviewPanel } from './modules/review/ReviewPanel.js';
import { XrayPanel } from './modules/xray/XrayPanel.js';
import { ModulesPanel } from './panels/ModulesPanel.js';

type ActiveTab = ModuleId | 'modules';

export const App: React.FC = () => {
  const [snapshot, setSnapshot] = useState<NovConfigSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('review');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<ToolResultEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
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
    return unsub;
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
        notify(
          `${MODULE_CATALOG[moduleId].name} ${enabled ? 'enabled' : 'disabled'} (${next.exposedModelTools} model tools active)`,
        );
      } catch (err) {
        notify(`Failed to toggle ${moduleId}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusyKey(null);
      }
    },
    [activeTab, notify],
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
        notify(`Preset applied: ${preset} (${next.enabledCount}/${MODULE_IDS.length} modules)`);
      } catch (err) {
        notify(`Failed to apply preset: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusyKey(null);
      }
    },
    [activeTab, notify],
  );

  const enabledModules = snapshot
    ? MODULE_IDS.filter((id) => snapshot.config.modules[id])
    : (['review', 'guard', 'xray'] as ModuleId[]);

  const isFullHeightTab = activeTab === 'review' || activeTab === 'canvas';

  return (
    <div className="nov-shell">
      <header className="nov-topbar">
        <div className="nov-brand" title="agy-NOV Modular Workbench">
          <span className="nov-brand-mark">N</span>
          <span>agy-NOV</span>
        </div>

        <nav className="nov-nav" aria-label="Enabled modules">
          {enabledModules.map((id) => {
            const meta = MODULE_CATALOG[id];
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                className={`nov-tab ${isActive ? 'is-active' : ''}`}
                onClick={() => setActiveTab(id)}
              >
                <span className="nov-tab-dot" />
                <span>{meta.shortLabel}</span>
              </button>
            );
          })}
        </nav>

        <div className="nov-topbar-actions">
          <button
            type="button"
            className={`nov-pill-btn ${activeTab === 'modules' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('modules')}
            title="Enable or disable agy-NOV modules"
          >
            <span>Modules</span>
            <span>
              {snapshot ? `${snapshot.enabledCount}/${MODULE_IDS.length}` : '3/6'}
            </span>
          </button>
        </div>
      </header>

      <main className={`nov-stage ${isFullHeightTab ? 'is-full-height' : ''}`}>
        {loadError && !snapshot && (
          <div className="nov-disabled-notice">
            <h3>Unable to connect to agy-NOV server</h3>
            <p>{loadError}</p>
            <button type="button" className="nov-open-btn" onClick={() => void loadConfig()}>
              Retry
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
            <h3>{MODULE_CATALOG[activeTab].name} is currently turned off</h3>
            <p>{MODULE_CATALOG[activeTab].description}</p>
            <button
              type="button"
              className="nov-open-btn"
              disabled={busyKey !== null}
              onClick={() => void handleToggleModule(activeTab, true)}
            >
              Enable {MODULE_CATALOG[activeTab].name}
            </button>
          </div>
        )}

        {snapshot && activeTab === 'review' && snapshot.config.modules.review && (
          <ReviewPanel
            bridge={novBridge}
            active={activeTab === 'review'}
            onNotify={notify}
            incomingEvent={lastEvent}
          />
        )}
        {snapshot && activeTab === 'guard' && snapshot.config.modules.guard && (
          <GuardPanel
            bridge={novBridge}
            active={activeTab === 'guard'}
            onNotify={notify}
            incomingEvent={lastEvent}
          />
        )}
        {snapshot && activeTab === 'xray' && snapshot.config.modules.xray && (
          <XrayPanel
            bridge={novBridge}
            active={activeTab === 'xray'}
            onNotify={notify}
            incomingEvent={lastEvent}
          />
        )}
        {snapshot && activeTab === 'canvas' && snapshot.config.modules.canvas && (
          <CanvasPanel
            bridge={novBridge}
            active={activeTab === 'canvas'}
            onNotify={notify}
            incomingEvent={lastEvent}
          />
        )}
        {snapshot && activeTab === 'mem' && snapshot.config.modules.mem && (
          <MemPanel
            bridge={novBridge}
            active={activeTab === 'mem'}
            onNotify={notify}
            incomingEvent={lastEvent}
          />
        )}
        {snapshot && activeTab === 'remote' && snapshot.config.modules.remote && (
          <RemotePanel
            bridge={novBridge}
            active={activeTab === 'remote'}
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
  );
};
