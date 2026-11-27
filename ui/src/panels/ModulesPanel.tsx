import React from 'react';
import {
  MODULE_CATALOG,
  MODULE_IDS,
  PRESET_DEFINITIONS,
  PRESET_IDS,
  type ModuleId,
  type PresetId,
} from '../../../src/core/catalog.js';
import type { NovConfigSnapshot } from '../bridge.js';

interface ModulesPanelProps {
  snapshot: NovConfigSnapshot;
  busyKey: string | null;
  onToggleModule: (moduleId: ModuleId, enabled: boolean) => void;
  onApplyPreset: (preset: PresetId) => void;
  onOpenModule: (moduleId: ModuleId) => void;
}

export const ModulesPanel: React.FC<ModulesPanelProps> = ({
  snapshot,
  busyKey,
  onToggleModule,
  onApplyPreset,
  onOpenModule,
}) => {
  const { config, enabledCount, exposedModelTools, remoteRunning, demoMode } = snapshot;

  return (
    <div className="nov-modules-page">
      <section className="nov-hero-card">
        <div>
          <h2 className="nov-hero-title">agy-NOV Modular Control Center</h2>
          <p className="nov-hero-sub">
            Enable only the tools you actually need. Disabled modules register zero model tools and
            skip lifecycle hooks instantly.
          </p>
        </div>
        <div className="nov-metrics-row">
          <span className="nov-metric-chip">
            Modules: <strong>{enabledCount} / {MODULE_IDS.length}</strong>
          </span>
          <span className="nov-metric-chip">
            Model Tools: <strong>{exposedModelTools}</strong>
          </span>
          <span className={`nov-metric-chip ${remoteRunning ? 'is-online' : 'is-offline'}`}>
            Network:{' '}
            <strong>{remoteRunning ? 'Remote Hub Active' : '100% Offline'}</strong>
          </span>
          {demoMode && (
            <span className="nov-metric-chip">
              Mode: <strong>Demo Fixture</strong>
            </span>
          )}
        </div>
      </section>

      <section className="nov-presets-bar" aria-label="Module presets">
        <span className="nov-presets-label">Presets</span>
        {PRESET_IDS.map((pid) => {
          const def = PRESET_DEFINITIONS[pid];
          const active = config.preset === pid;
          return (
            <button
              key={pid}
              type="button"
              className={`nov-preset-btn ${active ? 'is-active' : ''}`}
              title={def.description}
              disabled={busyKey !== null}
              onClick={() => onApplyPreset(pid)}
            >
              {def.label}
            </button>
          );
        })}
        {config.preset === 'custom' && (
          <span className="nov-badge">Custom Selection</span>
        )}
      </section>

      <section className="nov-module-grid" aria-label="Available modules">
        {MODULE_IDS.map((id) => {
          const meta = MODULE_CATALOG[id];
          const enabled = Boolean(config.modules[id]);
          const isBusy = busyKey === id || busyKey === 'preset';
          return (
            <article
              key={id}
              className={`nov-module-card ${enabled ? 'is-enabled' : 'is-disabled'}`}
            >
              <div className="nov-card-head">
                <div>
                  <h3 className="nov-card-title">{meta.name}</h3>
                  <p className="nov-card-tagline">{meta.tagline}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`Toggle ${meta.name}`}
                  className="nov-switch"
                  disabled={isBusy}
                  onClick={() => onToggleModule(id, !enabled)}
                >
                  <span className="nov-switch-thumb" />
                </button>
              </div>

              <p className="nov-card-desc">{meta.description}</p>

              <div className="nov-card-tags">
                <span
                  className={`nov-badge ${
                    meta.networkAccess === 'offline' ? 'is-offline' : 'is-network'
                  }`}
                >
                  {meta.networkAccess === 'offline'
                    ? '100% Local Offline'
                    : 'Opt-in Network · Default OFF'}
                </span>
                <span className="nov-badge">
                  {meta.modelToolNames.length} model tools
                </span>
                <span className="nov-badge">
                  {meta.hooks.length > 0 ? `Hooks: ${meta.hooks.join(', ')}` : 'No Hooks'}
                </span>
              </div>

              <div className="nov-card-footer">
                <span style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                  {enabled
                    ? id === 'remote' && remoteRunning
                      ? 'Gateway running'
                      : 'Active'
                    : 'Disabled (0 token tax)'}
                </span>
                <button
                  type="button"
                  className="nov-open-btn"
                  disabled={!enabled}
                  onClick={() => onOpenModule(id)}
                >
                  Open {meta.shortLabel}
                </button>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
};
