import React, { useState } from 'react';
import {
  MODULE_CATALOG,
  MODULE_CATEGORY_IDS,
  MODULE_IDS,
  PRESET_IDS,
  type ModuleCategoryId,
  type ModuleId,
  type PresetId,
} from '../../../src/core/catalog.js';
import type { NovConfigSnapshot } from '../bridge.js';
import { useNovI18n } from '../i18n/index.js';

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
  const { dict, t } = useNovI18n();
  const [selectedCategory, setSelectedCategory] = useState<ModuleCategoryId | 'all'>('all');

  const {
    config,
    enabledCount,
    totalModules,
    exposedModelTools,
    remoteRunning,
    demoMode,
  } = snapshot;

  const visibleCategories: ModuleCategoryId[] =
    selectedCategory === 'all' ? [...MODULE_CATEGORY_IDS] : [selectedCategory];

  return (
    <div className="nov-modules-page">
      <section className="nov-hero-card">
        <div>
          <h2 className="nov-hero-title">{dict.heroTitle}</h2>
          <p className="nov-hero-sub">{dict.heroSub}</p>
        </div>
        <div className="nov-metrics-row">
          <span className="nov-metric-chip">
            {dict.metricModules}:{' '}
            <strong>
              {enabledCount} / {totalModules || MODULE_IDS.length}
            </strong>
          </span>
          <span className="nov-metric-chip">
            {dict.metricTools}: <strong>{exposedModelTools}</strong>
          </span>
          <span className={`nov-metric-chip ${remoteRunning ? 'is-online' : 'is-offline'}`}>
            {dict.metricNetwork}:{' '}
            <strong>{remoteRunning ? dict.networkRemoteOn : dict.networkOffline}</strong>
          </span>
          <span className="nov-metric-chip is-offline">
            <strong>{dict.badgeZeroCdp}</strong>
          </span>
          {demoMode && (
            <span className="nov-metric-chip">
              {dict.metricDemo}: <strong>{dict.demoFixture}</strong>
            </span>
          )}
        </div>
      </section>

      <section className="nov-presets-bar" aria-label={dict.presetsLabel}>
        <span className="nov-presets-label">{dict.presetsLabel}</span>
        {PRESET_IDS.map((pid) => {
          const def = dict.presets[pid];
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
          <span className="nov-badge">{dict.customSelection}</span>
        )}
      </section>

      <section className="nov-category-bar" aria-label="Filter categories">
        <button
          type="button"
          className={`nov-cat-pill ${selectedCategory === 'all' ? 'is-active' : ''}`}
          onClick={() => setSelectedCategory('all')}
        >
          {dict.categoryAll} ({MODULE_IDS.length})
        </button>
        {MODULE_CATEGORY_IDS.map((catId) => {
          const count = MODULE_IDS.filter((id) => MODULE_CATALOG[id].category === catId).length;
          return (
            <button
              key={catId}
              type="button"
              className={`nov-cat-pill ${selectedCategory === catId ? 'is-active' : ''}`}
              onClick={() => setSelectedCategory(catId)}
            >
              {dict.categories[catId].label} ({count})
            </button>
          );
        })}
      </section>

      {visibleCategories.map((catId) => {
        const catModules = MODULE_IDS.filter((id) => MODULE_CATALOG[id].category === catId);
        const catText = dict.categories[catId];
        return (
          <section key={catId} className="nov-category-section" aria-label={catText.label}>
            <div className="nov-category-heading">
              <h3>{catText.label}</h3>
              <span>{catText.description}</span>
            </div>

            <div className="nov-module-grid">
              {catModules.map((id) => {
                const meta = MODULE_CATALOG[id];
                const text = dict.modules[id];
                const enabled = Boolean(config.modules[id]);
                const isBusy = busyKey === id || busyKey === 'preset';

                const tierBadgeClass =
                  meta.isolationTier === 'offline' ? 'is-offline' : 'is-network';
                const tierBadgeText =
                  meta.isolationTier === 'offline' ? dict.badgeOffline : dict.badgeOptInNet;

                let statusText = dict.statusDisabled;
                if (enabled) {
                  statusText =
                    id === 'remote' && remoteRunning
                      ? dict.statusGatewayRunning
                      : dict.statusActive;
                }

                return (
                  <article
                    key={id}
                    className={`nov-module-card ${enabled ? 'is-enabled' : 'is-disabled'}`}
                  >
                    <div className="nov-card-head">
                      <div>
                        <h3 className="nov-card-title">{text.name}</h3>
                        <p className="nov-card-tagline">{text.tagline}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={`Toggle ${text.name}`}
                        className="nov-switch"
                        disabled={isBusy}
                        onClick={() => onToggleModule(id, !enabled)}
                      >
                        <span className="nov-switch-thumb" />
                      </button>
                    </div>

                    <p className="nov-card-desc">{text.description}</p>

                    <div className="nov-card-tags">
                      <span className={`nov-badge ${tierBadgeClass}`}>{tierBadgeText}</span>
                      <span className="nov-badge">
                        {t(dict.badgeToolsCount, { n: meta.modelToolNames.length })}
                      </span>
                      <span className="nov-badge">
                        {meta.hooks.length > 0
                          ? t(dict.badgeHooks, { hooks: meta.hooks.join(', ') })
                          : dict.badgeNoHooks}
                      </span>
                    </div>

                    <div className="nov-card-footer">
                      <span style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                        {statusText}
                      </span>
                      <button
                        type="button"
                        className="nov-open-btn"
                        disabled={!enabled}
                        onClick={() => onOpenModule(id)}
                      >
                        {t(dict.openModuleBtn, { label: text.shortLabel })}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
};
