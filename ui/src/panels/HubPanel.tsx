import React, { useCallback, useEffect, useState } from 'react';
import {
  isModuleId,
  LOCALE_NATIVE_LABELS,
  MAX_MCP_TOOL_BUDGET,
  MODULE_IDS,
  PRESET_IDS,
  UI_LOCALE_IDS,
  type ModuleId,
  type NovLocale,
  type PresetId,
} from '../../../src/core/catalog.js';
import type {
  CleanForkLaunchResult,
  CleanForkPackPayload,
  HostCapabilitiesSummary,
  NovBridge,
  NovConfigSnapshot,
  NovFeedAlert,
  NovFeedSnapshot,
  NovHubStatePayload,
} from '../bridge.js';
import { useNovI18n } from '../i18n/index.js';

export interface HubPanelProps {
  bridge: NovBridge;
  snapshot: NovConfigSnapshot;
  busyKey: string | null;
  onOpenModule: (moduleId: ModuleId) => void;
  onOpenSettings: () => void;
  onToggleModule: (moduleId: ModuleId, enabled: boolean) => Promise<void> | void;
  onApplyPreset: (preset: PresetId) => Promise<void> | void;
  onChangeLocale: (locale: NovLocale) => Promise<void> | void;
  onOpenCommandPalette: () => void;
  onNotify?: (message: string) => void;
}

const PIPELINE_NODES: readonly ModuleId[] = [
  'spec',
  'worktree',
  'review',
  'verify',
  'guard',
  'xray',
];

let quickStartDismissedInMemory = false;

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

function getBudgetTone(exposed: number, limit: number): 'is-safe' | 'is-warn' | 'is-danger' {
  const ratio = limit > 0 ? (exposed / limit) * 100 : 0;
  if (ratio >= 85) return 'is-danger';
  if (ratio >= 60) return 'is-warn';
  return 'is-safe';
}

export const HubPanel: React.FC<HubPanelProps> = ({
  bridge,
  snapshot,
  busyKey,
  onOpenModule,
  onOpenSettings,
  onToggleModule,
  onApplyPreset,
  onChangeLocale,
  onOpenCommandPalette,
  onNotify,
}) => {
  const { dict, prefLocale, t } = useNovI18n();
  const [hubState, setHubState] = useState<NovHubStatePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [showQuickStart, setShowQuickStart] = useState(!quickStartDismissedInMemory);
  const [caps, setCaps] = useState<HostCapabilitiesSummary>(() => bridge.getCapabilities());
  const [forkPack, setForkPack] = useState<CleanForkPackPayload | null>(null);
  const [forkLoading, setForkLoading] = useState(false);
  const [forkLaunching, setForkLaunching] = useState(false);
  const [showForkPreview, setShowForkPreview] = useState(false);
  const [lastFork, setLastFork] = useState<CleanForkLaunchResult | null>(null);

  useEffect(() => {
    let mounted = true;
    void bridge.ready().then(() => {
      if (mounted) setCaps(bridge.getCapabilities());
    });
    return () => {
      mounted = false;
    };
  }, [bridge]);

  const loadCleanForkPreview = useCallback(
    async (silent = true): Promise<CleanForkPackPayload | null> => {
      setForkLoading(true);
      try {
        const pack = await bridge.buildCleanForkPack({});
        if (pack && typeof pack.promptMarkdown === 'string') {
          setForkPack(pack);
          return pack;
        }
        return null;
      } catch (err) {
        if (!silent) {
          onNotify?.(err instanceof Error ? err.message : String(err));
        }
        return null;
      } finally {
        setForkLoading(false);
      }
    },
    [bridge, onNotify],
  );

  const handleCleanForkLaunch = async () => {
    if (forkLaunching) return;
    setForkLaunching(true);
    try {
      const pack = (await loadCleanForkPreview(false)) ?? forkPack;
      if (!pack || !pack.promptMarkdown) {
        onNotify?.(dict.common.empty);
        return;
      }
      const res = await bridge.startCleanFork(pack.promptMarkdown);
      setLastFork(res);
      if (res.mode === 'new_conversation') {
        onNotify?.(
          res.conversationId
            ? t(dict.hub.cleanForkStartedIdToast, { id: res.conversationId })
            : dict.hub.cleanForkStartedToast,
        );
      } else if (res.mode === 'context') {
        onNotify?.(dict.hub.cleanForkContextToast);
      } else {
        onNotify?.(`${dict.common.copied} · ${dict.hub.cleanForkPackLabel}`);
      }
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setForkLaunching(false);
    }
  };

  const loadHub = useCallback(async () => {
    setLoading(true);
    try {
      const [payload, pack] = await Promise.all([
        bridge.getHubState(),
        bridge.buildCleanForkPack({}).catch(() => null),
      ]);
      setHubState(payload);
      if (pack && typeof pack.promptMarkdown === 'string') {
        setForkPack(pack);
      }
    } catch {
      // Graceful fallback when running against an older server without nov_app_get_hub_state
      setHubState(null);
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    void loadHub();
  }, [loadHub, snapshot.enabledCount, snapshot.config.updatedAt]);

  const effectiveSnapshot = hubState?.snapshot ?? snapshot;
  const feed: NovFeedSnapshot | null = hubState?.feed ?? null;
  const summary = feed?.summary ?? {};
  const alerts: NovFeedAlert[] = Array.isArray(feed?.alerts) ? feed.alerts : [];

  const totalModules = effectiveSnapshot.totalModules || MODULE_IDS.length;
  const exposedTools = feed?.exposedModelTools ?? effectiveSnapshot.exposedModelTools;
  const budgetLimit = feed?.toolBudgetLimit ?? MAX_MCP_TOOL_BUDGET;
  const budgetTone = getBudgetTone(exposedTools, budgetLimit);
  const dualStarAvailable = Boolean(
    feed &&
      (feed.feedExists ||
        feed.paths?.feedFile ||
        feed.paths?.feedSnapshotPath ||
        feed.paths?.feedPath ||
        feed.generatedAt),
  );

  const dismissQuickStart = () => {
    quickStartDismissedInMemory = true;
    setShowQuickStart(false);
  };

  const renderNodeTelemetry = (id: ModuleId, enabled: boolean): React.ReactNode => {
    if (!enabled) {
      return <span className="nov-flow-meta">{dict.statusDisabled}</span>;
    }

    if (id === 'spec') {
      const sp = summary.spec;
      if (!sp) return <span className="nov-flow-meta">{dict.statusActive}</span>;
      const done = typeof sp.doneTasks === 'number' ? sp.doneTasks : 0;
      const total = typeof sp.totalTasks === 'number' ? sp.totalTasks : 0;
      return (
        <div className="nov-flow-telemetry">
          {sp.writeLockActive && (
            <span className="nov-badge is-network">{dict.hub.writeLockBadge}</span>
          )}
          <span className="nov-flow-meta">
            {total > 0 ? `${done}/${total} DAG` : sp.status ? String(sp.status) : dict.statusActive}
          </span>
        </div>
      );
    }

    if (id === 'verify') {
      const vf = summary.verify;
      if (!vf) return <span className="nov-flow-meta">{dict.hub.verifyIdle}</span>;
      const rawStatus =
        typeof vf.lastStatus === 'string'
          ? vf.lastStatus.toLowerCase()
          : typeof vf.lastOutcome === 'string'
            ? vf.lastOutcome.toLowerCase()
            : '';
      const passed =
        vf.lastPassed === true || rawStatus === 'pass' || rawStatus === 'passed';
      const failed =
        vf.lastPassed === false ||
        rawStatus === 'fail' ||
        rawStatus === 'failed' ||
        rawStatus === 'blocked';
      const dirtyCount = typeof vf.dirtyFilesCount === 'number' ? vf.dirtyFilesCount : 0;
      return (
        <div className="nov-flow-telemetry">
          {passed ? (
            <span className="nov-badge is-offline">{dict.hub.verifyPass}</span>
          ) : failed ? (
            <span className="nov-badge is-danger">{dict.hub.verifyFail}</span>
          ) : (
            <span className="nov-badge">{dict.hub.verifyIdle}</span>
          )}
          {dirtyCount > 0 && (
            <span className="nov-flow-meta">
              {dirtyCount} {dict.panels.verify.dirtyFiles}
            </span>
          )}
        </div>
      );
    }

    if (id === 'guard') {
      const gd = summary.guard;
      if (!gd) return <span className="nov-flow-meta">{dict.statusActive}</span>;
      const blocked = typeof gd.blockedCount === 'number' ? gd.blockedCount : 0;
      const ask = typeof gd.askCount === 'number' ? gd.askCount : 0;
      return (
        <div className="nov-flow-telemetry">
          {blocked > 0 ? (
            <span className="nov-badge is-network">
              {dict.hub.blockedBadge} {blocked}
            </span>
          ) : (
            <span className="nov-badge is-offline">{dict.panels.guard.safe}</span>
          )}
          {ask > 0 && (
            <span className="nov-flow-meta">
              {dict.panels.guard.ask}: {ask}
            </span>
          )}
        </div>
      );
    }

    if (id === 'xray') {
      const xr = summary.xray;
      if (!xr) return <span className="nov-flow-meta">{dict.statusActive}</span>;
      const tokens =
        typeof xr.peakContextTokens === 'number'
          ? xr.peakContextTokens
          : typeof xr.peakTokens === 'number'
            ? xr.peakTokens
            : typeof xr.totalTokens === 'number'
              ? xr.totalTokens
              : 0;
      const cost =
        typeof xr.estimatedCostUsd === 'number'
          ? xr.estimatedCostUsd
          : typeof xr.todayCostUsd === 'number'
            ? xr.todayCostUsd
            : typeof xr.estCostUsd === 'number'
              ? xr.estCostUsd
              : null;
      return (
        <div className="nov-flow-telemetry">
          <span className="nov-flow-meta">
            {tokens > 0 ? `${formatCompactNumber(tokens)} tok` : dict.statusActive}
            {cost !== null && cost > 0 ? ` · $${cost.toFixed(2)}` : ''}
          </span>
        </div>
      );
    }

    if (id === 'worktree') {
      const wt = summary.worktree as { total?: number; dirty?: number } | undefined;
      if (wt && typeof wt.total === 'number') {
        return (
          <span className="nov-flow-meta">
            {wt.dirty
              ? t(dict.hub.worktreeDirtySummary, { count: wt.total, dirty: wt.dirty })
              : t(dict.hub.worktreeSummary, { count: wt.total })}
          </span>
        );
      }
      return <span className="nov-flow-meta">{dict.statusActive}</span>;
    }

    // review or generic
    const rv = summary.review as { changedFiles?: number; unresolved?: number } | undefined;
    if (rv && typeof rv.changedFiles === 'number') {
      return (
        <span className="nov-flow-meta">
          {rv.changedFiles} {dict.panels.review.filesTitle}
        </span>
      );
    }
    return <span className="nov-flow-meta">{dict.statusActive}</span>;
  };

  // Secondary telemetry pills for mem / radar / turbo / remote
  const memSummary = summary.mem;
  const memTotal =
    typeof memSummary?.totalMemories === 'number'
      ? memSummary.totalMemories
      : typeof memSummary?.total === 'number'
        ? memSummary.total
        : 0;
  const memStale =
    typeof memSummary?.staleCount === 'number'
      ? memSummary.staleCount
      : typeof memSummary?.stale === 'number'
        ? memSummary.stale
        : typeof memSummary?.drifted === 'number'
          ? memSummary.drifted
          : 0;
  const radarSummary = summary.radar;
  const radarRunning =
    typeof radarSummary?.runningCount === 'number'
      ? radarSummary.runningCount
      : typeof radarSummary?.running === 'number'
        ? radarSummary.running
        : 0;
  const radarAwaiting =
    typeof radarSummary?.awaitingCount === 'number'
      ? radarSummary.awaitingCount
      : typeof radarSummary?.awaitingApproval === 'number'
        ? radarSummary.awaitingApproval
        : typeof radarSummary?.awaiting_approval === 'number'
          ? radarSummary.awaiting_approval
          : 0;
  const turboSummary = summary.turbo;
  const turboSaved =
    typeof turboSummary?.totalSavedTokens === 'number'
      ? turboSummary.totalSavedTokens
      : typeof turboSummary?.savedTokens === 'number'
        ? turboSummary.savedTokens
        : 0;
  const remoteSummary = summary.remote;
  const remoteActive = Boolean(effectiveSnapshot.remoteRunning || remoteSummary?.running);

  const hasPulseChips =
    effectiveSnapshot.config.modules.mem ||
    effectiveSnapshot.config.modules.radar ||
    effectiveSnapshot.config.modules.turbo ||
    effectiveSnapshot.config.modules.remote ||
    memStale > 0 ||
    radarRunning > 0 ||
    radarAwaiting > 0 ||
    turboSaved > 0;

  return (
    <div className="nov-hub-page">
      {/* Header overview */}
      <section className="nov-hero-card">
        <div>
          <h2 className="nov-hero-title">{dict.hub.title}</h2>
          <p className="nov-hero-sub">{dict.hub.subtitle}</p>
        </div>
        <div className="nov-metrics-row">
          <span className="nov-metric-chip">
            {dict.metricModules}:{' '}
            <strong>
              {effectiveSnapshot.enabledCount} / {totalModules}
            </strong>
          </span>
          <span className={`nov-metric-chip ${budgetTone}`}>
            {dict.nav.toolBudgetLabel}:{' '}
            <strong>
              {exposedTools} / {budgetLimit}
            </strong>
          </span>
          <span className={`nov-metric-chip ${remoteActive ? 'is-online' : 'is-offline'}`}>
            <strong>{remoteActive ? dict.networkRemoteOn : dict.networkOffline}</strong>
          </span>
          {dualStarAvailable && (
            <span className="nov-metric-chip is-offline">
              <strong>{dict.hub.dualStarReady}</strong>
            </span>
          )}
          <button
            type="button"
            className="nov-p-btn"
            disabled={loading}
            onClick={() => void loadHub()}
          >
            {loading ? dict.common.loading : dict.common.refresh}
          </button>
        </div>
      </section>

      {/* Compact dismissible 30-second quick start */}
      {showQuickStart && (
        <section className="nov-quickstart-strip" aria-label={dict.quickStart.title}>
          <div className="nov-quickstart-main">
            <span className="nov-badge is-accent">{dict.quickStart.title}</span>
            <span className="nov-quickstart-text">{dict.quickStart.subtitle}</span>
          </div>
          <div className="nov-quickstart-actions">
            {effectiveSnapshot.config.modules.xray && (
              <button
                type="button"
                className="nov-p-btn is-primary"
                onClick={() => onOpenModule('xray')}
              >
                {dict.quickStart.tryNowBtn}
              </button>
            )}
            <button type="button" className="nov-p-btn" onClick={dismissQuickStart}>
              {dict.quickStart.dismissBtn}
            </button>
          </div>
        </section>
      )}

      {/* Today's Engineering Pipeline Flow Bar */}
      <section className="nov-p-card" aria-label={dict.hub.pipelineTitle}>
        <div className="nov-p-row">
          <h3 className="nov-section-title">{dict.hub.pipelineTitle}</h3>
          <button type="button" className="nov-open-btn" onClick={onOpenSettings}>
            {dict.nav.settingsLabel} →
          </button>
        </div>

        <div className="nov-flow-bar">
          {PIPELINE_NODES.map((modId, idx) => {
            const enabled = Boolean(effectiveSnapshot.config.modules[modId]);
            const modText = dict.modules[modId];
            const isToggling = busyKey === modId || busyKey === 'preset';
            return (
              <React.Fragment key={modId}>
                <div
                  className={`nov-flow-node ${enabled ? 'is-enabled' : 'is-disabled'}`}
                  role={enabled ? 'button' : undefined}
                  tabIndex={enabled ? 0 : undefined}
                  onClick={enabled ? () => onOpenModule(modId) : undefined}
                  onKeyDown={
                    enabled
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onOpenModule(modId);
                          }
                        }
                      : undefined
                  }
                >
                  <div className="nov-flow-node-head">
                    <span className="nov-flow-step">{idx + 1}</span>
                    <span className={`nov-tab-dot ${enabled ? '' : 'is-off'}`} />
                    <span className="nov-flow-name">{modText.shortLabel}</span>
                  </div>

                  <div className="nov-flow-node-body">{renderNodeTelemetry(modId, enabled)}</div>

                  <div className="nov-flow-node-foot">
                    {enabled ? (
                      <span className="nov-flow-link">{dict.hub.openModule} →</span>
                    ) : (
                      <button
                        type="button"
                        className="nov-open-btn"
                        disabled={isToggling}
                        onClick={(e) => {
                          e.stopPropagation();
                          void onToggleModule(modId, true);
                        }}
                      >
                        {dict.hub.enableToUse}
                      </button>
                    )}
                  </div>
                </div>
                {idx < PIPELINE_NODES.length - 1 && (
                  <span className="nov-flow-arrow" aria-hidden="true">
                    →
                  </span>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Supplementary module telemetry strip (mem / radar / turbo / remote) */}
        {hasPulseChips && (
          <div className="nov-pulse-strip">
            {(effectiveSnapshot.config.modules.mem || memStale > 0) && (
              <button
                type="button"
                className="nov-pulse-chip"
                onClick={() =>
                  effectiveSnapshot.config.modules.mem
                    ? onOpenModule('mem')
                    : void onToggleModule('mem', true)
                }
              >
                <span>{dict.modules.mem.shortLabel}:</span>
                <strong>{memTotal}</strong>
                {memStale > 0 && (
                  <span className="nov-badge is-network">
                    {dict.hub.staleMemBadge} {memStale}
                  </span>
                )}
              </button>
            )}

            {(effectiveSnapshot.config.modules.radar || radarRunning > 0 || radarAwaiting > 0) && (
              <button
                type="button"
                className="nov-pulse-chip"
                onClick={() =>
                  effectiveSnapshot.config.modules.radar
                    ? onOpenModule('radar')
                    : void onToggleModule('radar', true)
                }
              >
                <span>{dict.modules.radar.shortLabel}:</span>
                <strong>
                  {radarRunning} {dict.radar.running}
                </strong>
                {radarAwaiting > 0 && (
                  <span className="nov-badge is-network">
                    {radarAwaiting} {dict.radar.awaiting}
                  </span>
                )}
              </button>
            )}

            {(effectiveSnapshot.config.modules.turbo || turboSaved > 0) && (
              <button
                type="button"
                className="nov-pulse-chip"
                onClick={() =>
                  effectiveSnapshot.config.modules.turbo
                    ? onOpenModule('turbo')
                    : void onToggleModule('turbo', true)
                }
              >
                <span>{dict.modules.turbo.shortLabel}:</span>
                <strong>~{formatCompactNumber(turboSaved)} tok</strong>
              </button>
            )}

            {effectiveSnapshot.config.modules.remote && (
              <button
                type="button"
                className="nov-pulse-chip"
                onClick={() => onOpenModule('remote')}
              >
                <span>{dict.modules.remote.shortLabel}:</span>
                <strong>{remoteActive ? dict.statusGatewayRunning : dict.common.disabled}</strong>
                {typeof remoteSummary?.connectedClients === 'number' &&
                  remoteSummary.connectedClients > 0 && (
                    <span className="nov-badge is-accent">
                      {remoteSummary.connectedClients} PWA
                    </span>
                  )}
              </button>
            )}
          </div>
        )}
      </section>

      {/* Clean Fork (Fresh Session) Quick Launch */}
      <section className="nov-p-card" aria-label={dict.hub.cleanForkTitle}>
        <div className="nov-p-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 className="nov-section-title" style={{ margin: 0 }}>
              {dict.hub.cleanForkTitle}
            </h3>
            <span className={`nov-badge ${caps.message ? 'is-offline' : 'is-network'}`}>
              {caps.message ? dict.hub.cleanForkReadyBadge : dict.hub.cleanForkFallbackBadge}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="nov-p-btn is-primary"
              disabled={forkLaunching || forkLoading}
              onClick={() => void handleCleanForkLaunch()}
            >
              {forkLaunching
                ? dict.common.loading
                : caps.message
                  ? dict.hub.cleanForkTitle
                  : dict.hub.cleanForkCopyPackBtn}
            </button>
            <button
              type="button"
              className="nov-p-btn"
              disabled={forkLoading}
              onClick={async () => {
                if (!showForkPreview && !forkPack) {
                  await loadCleanForkPreview(false);
                }
                setShowForkPreview((prev) => !prev);
              }}
            >
              {showForkPreview ? dict.hub.cleanForkHidePreviewBtn : dict.hub.cleanForkPreviewBtn}
            </button>
          </div>
        </div>
        <p style={{ margin: '6px 0 8px', fontSize: 12, color: 'var(--nov-text-2)' }}>
          {caps.message ? dict.hub.cleanForkHintReady : dict.hub.cleanForkHintFallback}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span className={`nov-badge ${forkPack?.sections.hasHandoff ? 'is-accent' : ''}`}>
            {dict.hub.cleanForkHandoffLabel}:{' '}
            {forkPack
              ? forkPack.sections.hasHandoff
                ? dict.hub.cleanForkReadyVal
                : dict.hub.cleanForkNoneVal
              : '—'}
          </span>
          <span className={`nov-badge ${forkPack?.sections.activeSpecTitle ? 'is-offline' : ''}`}>
            {dict.modules.spec.shortLabel}:{' '}
            {forkPack?.sections.activeSpecTitle ?? dict.hub.cleanForkNoneVal}
          </span>
          <span className="nov-badge">
            {dict.hub.cleanForkReadyTasksLabel}:{' '}
            {forkPack ? forkPack.sections.readyTasksCount : '—'}
          </span>
          <span className="nov-badge">
            {dict.hub.cleanForkMemAnchorsLabel}:{' '}
            {forkPack ? forkPack.sections.memAnchorsCount : '—'}
          </span>
          {forkPack && (
            <span className="nov-badge">
              ~{formatCompactNumber(forkPack.estimatedTokens)} tok · {forkPack.totalBytes} B
              {forkPack.truncated ? ` (${dict.common.truncated})` : ''}
            </span>
          )}
          {lastFork && (
            <span className="nov-badge is-accent">
              {dict.hub.cleanForkLastLabel}: {lastFork.mode}
              {lastFork.conversationId ? ` (${lastFork.conversationId})` : ''}
            </span>
          )}
        </div>
        {showForkPreview && forkPack && (
          <pre
            style={{
              marginTop: 8,
              padding: 10,
              maxHeight: 200,
              overflow: 'auto',
              borderRadius: 8,
              border: '1px solid var(--nov-border)',
              background: 'var(--nov-bg-0)',
              fontFamily: 'var(--nov-font-mono)',
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {forkPack.promptMarkdown}
          </pre>
        )}
      </section>

      {/* Active Alerts Card */}
      <section className="nov-p-card" aria-label={dict.hub.alertsTitle}>
        <div className="nov-p-row">
          <h3 className="nov-section-title">
            {dict.hub.alertsTitle} ({alerts.length})
          </h3>
        </div>
        {alerts.length === 0 ? (
          <div className="nov-alert-empty">{dict.hub.noAlerts}</div>
        ) : (
          <div className="nov-alert-list">
            {alerts.map((alert, idx) => {
              const levelClass =
                alert.level === 'danger' || alert.level === 'error'
                  ? 'is-danger'
                  : alert.level === 'warn'
                    ? 'is-network'
                    : 'is-accent';
              const targetMod = isModuleId(alert.moduleId) ? alert.moduleId : null;
              const modEnabled = targetMod ? Boolean(effectiveSnapshot.config.modules[targetMod]) : false;
              return (
                <div key={`${alert.code}-${idx}`} className="nov-alert-card">
                  <span className={`nov-badge ${levelClass}`}>{alert.level.toUpperCase()}</span>
                  {targetMod && (
                    <span className="nov-badge">{dict.modules[targetMod].shortLabel}</span>
                  )}
                  <span className="nov-alert-msg">{alert.message}</span>
                  {targetMod && (
                    <button
                      type="button"
                      className="nov-open-btn"
                      onClick={() => (modEnabled ? onOpenModule(targetMod) : onOpenSettings())}
                    >
                      {modEnabled ? dict.hub.openModule : dict.nav.settingsLabel}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Quick Actions Bar */}
      <section className="nov-p-card" aria-label={dict.hub.quickActionsTitle}>
        <div className="nov-p-row">
          <h3 className="nov-section-title">{dict.hub.quickActionsTitle}</h3>
          <div className="nov-quick-actions-right">
            <button type="button" className="nov-p-btn" onClick={onOpenCommandPalette}>
              ⌘K · {dict.nav.commandPaletteTitle}
            </button>
            <select
              className="nov-lang-select"
              aria-label={dict.langToggleTitle}
              title={dict.langToggleTitle}
              value={prefLocale}
              disabled={busyKey === 'locale'}
              onChange={(e) => void onChangeLocale(e.target.value as NovLocale)}
            >
              <option value="auto">{dict.langAutoOption}</option>
              {UI_LOCALE_IDS.map((loc) => (
                <option key={loc} value={loc}>
                  {LOCALE_NATIVE_LABELS[loc]}
                </option>
              ))}
            </select>
            <button type="button" className="nov-p-btn is-primary" onClick={onOpenSettings}>
              ⚙ {dict.nav.settingsLabel}
            </button>
          </div>
        </div>

        <div className="nov-presets-bar" aria-label={dict.presetsLabel}>
          <span className="nov-presets-label">{dict.presetsLabel}</span>
          {PRESET_IDS.map((pid) => {
            const def = dict.presets[pid];
            const active = effectiveSnapshot.config.preset === pid;
            return (
              <button
                key={pid}
                type="button"
                className={`nov-preset-btn ${active ? 'is-active' : ''}`}
                title={def.description}
                disabled={busyKey !== null}
                onClick={() => void onApplyPreset(pid)}
              >
                {def.label}
              </button>
            );
          })}
          {effectiveSnapshot.config.preset === 'custom' && (
            <span className="nov-badge">{dict.customSelection}</span>
          )}
        </div>
      </section>
    </div>
  );
};
