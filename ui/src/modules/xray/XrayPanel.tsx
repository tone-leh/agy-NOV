import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CleanForkLaunchResult,
  CleanForkPackPayload,
  HostCapabilitiesSummary,
  NovBridge,
} from '../../bridge.js';
import { useNovI18n } from '../../i18n/index.js';
import { ContextCharts } from './ContextCharts';
import { FileTreePanel } from './FileTreePanel';
import { TimeMachinePanel } from './TimeMachinePanel';
import {
  fmtTokens,
  fmtUsd,
  type ArtifactSummary,
  type CostAnalyticsReport,
  type FileActivityItem,
  type SearchHit,
  type SessionDetail,
  type SessionSummary,
  type XrayTabKey,
} from './types';
import './styles.css';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
}

type ExportKind = 'brief' | 'handoff' | 'handoff-attach' | 'otlp' | 'csv';

const VALID_TABS = new Set<XrayTabKey>(['overview', 'files', 'timemachine', 'steps', 'cost']);

async function copyTextReliable(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export const XrayPanel: React.FC<NovModulePanelProps> = ({
  bridge,
  active,
  onNotify,
  incomingEvent,
}) => {
  const { dict, t } = useNovI18n();
  const x = dict.panels.xray;

  const loadedOnceRef = useRef(false);
  const lastEventRef = useRef<typeof incomingEvent>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => bridge.getTheme());
  const [caps, setCaps] = useState<HostCapabilitiesSummary>(() => bridge.getCapabilities());

  const [tab, setTab] = useState<XrayTabKey>('overview');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [analytics, setAnalytics] = useState<CostAnalyticsReport | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exportingKind, setExportingKind] = useState<ExportKind | null>(null);
  const [cleanForkPack, setCleanForkPack] = useState<CleanForkPackPayload | null>(null);
  const [cleanForkLoading, setCleanForkLoading] = useState(false);
  const [cleanForkLaunching, setCleanForkLaunching] = useState(false);
  const [showCleanForkPreview, setShowCleanForkPreview] = useState(false);
  const [lastForkResult, setLastForkResult] = useState<CleanForkLaunchResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localToast, setLocalToast] = useState<string | null>(null);

  const notify = useCallback(
    (msg: string) => {
      if (onNotify) {
        onNotify(msg);
        return;
      }
      setLocalToast(msg);
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setLocalToast((cur) => (cur === msg ? null : cur));
      }, 2600);
    },
    [onNotify],
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Sync theme & host capabilities from shared NovBridge
  useEffect(() => {
    let mounted = true;
    const unsub = bridge.onThemeChange((nextTheme) => {
      if (mounted) setTheme(nextTheme);
    });
    void bridge.ready().then(() => {
      if (!mounted) return;
      setTheme(bridge.getTheme());
      setCaps(bridge.getCapabilities());
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, [bridge]);

  const fetchCostAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await bridge.callTool<{ analytics?: CostAnalyticsReport }>(
        'app_xray_get_cost_analytics',
        {},
      );
      if (res?.analytics) {
        setAnalytics(res.analytics);
      }
    } catch {
      // Non-fatal: keep existing analytics or empty state
    } finally {
      setAnalyticsLoading(false);
    }
  }, [bridge]);

  const fetchCleanForkPack = useCallback(
    async (conversationId?: string, silent = true): Promise<CleanForkPackPayload | null> => {
      setCleanForkLoading(true);
      try {
        const pack = await bridge.buildCleanForkPack(
          conversationId ? { conversationId } : {},
        );
        if (pack && typeof pack.promptMarkdown === 'string') {
          setCleanForkPack(pack);
          return pack;
        }
        return null;
      } catch (err) {
        if (!silent) {
          notify(err instanceof Error ? err.message : String(err));
        }
        return null;
      } finally {
        setCleanForkLoading(false);
      }
    },
    [bridge, notify],
  );

  const fetchSessionsAndDetail = useCallback(
    async (sessionId?: string, silent = false) => {
      loadedOnceRef.current = true;
      setLoading(true);
      setLoadError(null);
      try {
        const [listRes, detailRes, costRes, forkPack] = await Promise.all([
          bridge.callTool<{ sessions?: SessionSummary[] }>('app_xray_list_sessions', { limit: 25 }),
          bridge.callTool<{ detail?: SessionDetail | null }>(
            'app_xray_get_session_detail',
            sessionId ? { sessionId } : {},
          ),
          bridge
            .callTool<{ analytics?: CostAnalyticsReport }>('app_xray_get_cost_analytics', {})
            .catch(() => null),
          bridge
            .buildCleanForkPack(sessionId ? { conversationId: sessionId } : {})
            .catch(() => null),
        ]);
        const list = Array.isArray(listRes?.sessions) ? listRes.sessions : [];
        if (list.length > 0) setSessions(list);
        if (detailRes && 'detail' in detailRes) {
          setDetail(detailRes.detail ?? null);
        }
        if (costRes?.analytics) {
          setAnalytics(costRes.analytics);
        }
        if (forkPack && typeof forkPack.promptMarkdown === 'string') {
          setCleanForkPack(forkPack);
        }
        if (!silent) {
          notify(x.refresh);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(msg);
        notify(msg);
      } finally {
        setLoading(false);
      }
    },
    [bridge, notify, x.refresh],
  );

  // Hydrate once on first activation
  useEffect(() => {
    if (active && !loadedOnceRef.current) {
      void fetchSessionsAndDetail(undefined, true);
    }
  }, [active, fetchSessionsAndDetail]);

  // Refresh cost analytics when entering cost tab if not loaded yet
  useEffect(() => {
    if (active && tab === 'cost' && !analytics && !analyticsLoading) {
      void fetchCostAnalytics();
    }
  }, [active, tab, analytics, analyticsLoading, fetchCostAnalytics]);

  // React to incoming tool results targeting X-Ray
  useEffect(() => {
    if (!incomingEvent || incomingEvent === lastEventRef.current) return;
    const sc = incomingEvent.structuredContent;
    if (!sc || typeof sc !== 'object') return;

    const toolName = incomingEvent.toolName ?? '';
    const hasXrayPayload =
      toolName.includes('xray') ||
      Array.isArray(sc.sessions) ||
      (sc.detail !== undefined && sc.detail !== null && typeof sc.detail === 'object') ||
      (sc.analytics !== undefined && sc.analytics !== null && typeof sc.analytics === 'object') ||
      (typeof sc.initialTab === 'string' && VALID_TABS.has(sc.initialTab as XrayTabKey));

    if (!hasXrayPayload) return;
    lastEventRef.current = incomingEvent;

    const maybeTab = sc.initialTab ?? sc.tab;
    if (typeof maybeTab === 'string' && VALID_TABS.has(maybeTab as XrayTabKey)) {
      setTab(maybeTab as XrayTabKey);
    }
    if (Array.isArray(sc.sessions)) {
      setSessions(sc.sessions as SessionSummary[]);
      loadedOnceRef.current = true;
    }
    if (sc.detail !== undefined) {
      setDetail((sc.detail as SessionDetail | null) ?? null);
      loadedOnceRef.current = true;
    }
    if (sc.analytics && typeof sc.analytics === 'object') {
      setAnalytics(sc.analytics as CostAnalyticsReport);
      loadedOnceRef.current = true;
    }
    if (!Array.isArray(sc.sessions) && sc.detail === undefined && active) {
      void fetchSessionsAndDetail(detail?.summary.id, true);
    }
  }, [incomingEvent, active, fetchSessionsAndDetail, detail?.summary.id]);

  const handleSelectSession = async (sessionId: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const [res, forkPack] = await Promise.all([
        bridge.callTool<{ detail?: SessionDetail | null }>(
          'app_xray_get_session_detail',
          { sessionId },
        ),
        bridge.buildCleanForkPack({ conversationId: sessionId }).catch(() => null),
      ]);
      if (res?.detail) {
        setDetail(res.detail);
        setTab('overview');
      }
      if (forkPack && typeof forkPack.promptMarkdown === 'string') {
        setCleanForkPack(forkPack);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    void fetchSessionsAndDetail(detail?.summary.id, false);
  };

  const handleSearch = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      setHasSearched(false);
      return;
    }
    setSearching(true);
    setHasSearched(true);
    try {
      const res = await bridge.callTool<{ hits?: SearchHit[] }>('app_xray_search_sessions', {
        query: trimmed,
        limit: 15,
      });
      setHits(Array.isArray(res?.hits) ? res.hits : []);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const handleOpenFile = async (file: FileActivityItem) => {
    const ok = await bridge.openFile(file.uri || file.path);
    notify(ok ? `${x.openFile}: ${file.basename}` : `${x.openFile} — ${file.basename}`);
  };

  const handleAttachFile = async (file: FileActivityItem) => {
    const outcome = await bridge.updateModelContext(
      `[Agy X-Ray File Reference]\nPath: ${file.path}\nActivity: ${file.ops.join('/')} (${file.totalTouches} touches, last at step #${file.lastStepIndex})`,
    );
    notify(
      outcome === 'context'
        ? `${x.attachContext}: ${file.basename}`
        : `${dict.common.copied}: ${file.basename}`,
    );
  };

  const handleInjectHit = async (hit: SearchHit) => {
    const outcome = await bridge.updateModelContext(
      `[Agy X-Ray Time Machine Context]\nFrom session: ${hit.sessionTitle} (${hit.sessionId})\nSource: ${hit.sourceLabel} (${hit.filePath})\nExcerpt:\n${hit.snippet}`,
    );
    notify(outcome === 'context' ? x.injectExcerpt : dict.common.copied);
  };

  const handleInjectArtifact = async (art: ArtifactSummary) => {
    const outcome = await bridge.updateModelContext(
      `[Agy X-Ray Artifact Context]\nArtifact: ${art.name} (${art.path})\nPreview:\n${art.preview}`,
    );
    notify(
      outcome === 'context'
        ? `${x.attachContext}: ${art.name}`
        : `${dict.common.copied}: ${art.name}`,
    );
  };

  const deliverExportPayload = async (
    payload: string,
    label: string,
    preferContext = false,
  ) => {
    if (!payload) {
      notify(dict.common.empty);
      return;
    }
    if (preferContext) {
      const outcome = await bridge.updateModelContext(payload);
      notify(
        outcome === 'context'
          ? `${x.attachContext} · ${label}`
          : `${dict.common.copied} · ${label}`,
      );
      return;
    }
    const copied = await copyTextReliable(payload);
    if (copied) {
      notify(`${dict.common.copied} · ${label}`);
      return;
    }
    const outcome = await bridge.updateModelContext(payload);
    notify(
      outcome === 'context'
        ? `${x.attachContext} · ${label}`
        : `${dict.common.copied} · ${label}`,
    );
  };

  const handleExportBrief = async () => {
    if (exportingKind !== null) return;
    setExportingKind('brief');
    try {
      const res = await bridge.callTool<{ markdown?: string }>(
        'app_xray_export_brief',
        detail?.summary.id ? { sessionId: detail.summary.id } : {},
      );
      const md = typeof res?.markdown === 'string' ? res.markdown : '';
      await deliverExportPayload(md, x.exportBrief, false);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingKind(null);
    }
  };

  const handleExportHandoff = async (attachToContext = false) => {
    if (exportingKind !== null) return;
    setExportingKind(attachToContext ? 'handoff-attach' : 'handoff');
    try {
      const res = await bridge.callTool<{ markdown?: string }>(
        'app_xray_export_handoff',
        detail?.summary.id ? { sessionId: detail.summary.id } : {},
      );
      const md = typeof res?.markdown === 'string' ? res.markdown : '';
      await deliverExportPayload(md, x.exportHandoff, attachToContext);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingKind(null);
    }
  };

  const handleExportOtlp = async () => {
    if (exportingKind !== null) return;
    setExportingKind('otlp');
    try {
      const res = await bridge.callTool<{ json?: string; otlp?: unknown }>(
        'app_xray_export_otlp',
        detail?.summary.id ? { sessionId: detail.summary.id } : {},
      );
      const json =
        typeof res?.json === 'string' && res.json
          ? res.json
          : res?.otlp
            ? JSON.stringify(res.otlp, null, 2)
            : '';
      await deliverExportPayload(json, x.exportOtlp, false);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingKind(null);
    }
  };

  const handleExportCsv = async () => {
    if (exportingKind !== null) return;
    setExportingKind('csv');
    try {
      const res = await bridge.callTool<{ csv?: string }>('app_xray_export_csv', {});
      const csv = typeof res?.csv === 'string' ? res.csv : '';
      await deliverExportPayload(csv, x.exportCsv, false);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingKind(null);
    }
  };

  const handleLaunchCleanFork = async () => {
    if (cleanForkLaunching) return;
    setCleanForkLaunching(true);
    try {
      const pack = (await fetchCleanForkPack(detail?.summary.id, false)) ?? cleanForkPack;
      if (!pack || !pack.promptMarkdown) {
        notify(dict.common.empty);
        return;
      }
      const outcome = await bridge.startCleanFork(pack.promptMarkdown);
      setLastForkResult(outcome);
      if (outcome.mode === 'new_conversation') {
        notify(
          outcome.conversationId
            ? t(dict.hub.cleanForkStartedIdToast, { id: outcome.conversationId })
            : dict.hub.cleanForkStartedToast,
        );
      } else if (outcome.mode === 'context') {
        notify(dict.hub.cleanForkContextToast);
      } else {
        notify(`${dict.common.copied} · ${dict.hub.cleanForkPackLabel}`);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setCleanForkLaunching(false);
    }
  };

  const handleCopyCleanFork = async () => {
    const pack = cleanForkPack ?? (await fetchCleanForkPack(detail?.summary.id, false));
    if (!pack?.promptMarkdown) {
      notify(dict.common.empty);
      return;
    }
    await deliverExportPayload(pack.promptMarkdown, dict.hub.cleanForkPackLabel, false);
  };

  const canOpenFile = caps.isWorkbench || caps.message || caps.updateModelContext;
  const canAttachContext = caps.isWorkbench || caps.updateModelContext;

  const warningLevel = analytics?.fiveHourWindow.warningLevel ?? 'ok';
  const warningBadgeClass =
    warningLevel === 'critical'
      ? 'xr-sev-danger'
      : warningLevel === 'warn'
        ? 'xr-sev-warn'
        : 'xr-sev-good';

  const maxDailyUsd = analytics
    ? Math.max(0.0001, ...analytics.dailyTrend.map((d) => d.estimatedUsd))
    : 1;
  const maxDailyTokens = analytics
    ? Math.max(1, ...analytics.dailyTrend.map((d) => d.totalTokens))
    : 1;
  const hasAnyTrendActivity = Boolean(
    analytics?.dailyTrend.some((d) => d.totalTokens > 0 || d.estimatedUsd > 0),
  );

  const renderCleanForkCard = () => {
    const sec = cleanForkPack?.sections;
    const capabilityHint = caps.message
      ? dict.hub.cleanForkHintReady
      : dict.hub.cleanForkHintFallback;
    return (
      <section className="xr-card" aria-label={dict.hub.cleanForkTitle}>
        <div className="xr-section-title">
          <span>{dict.hub.cleanForkTitle}</span>
          <span className={`xr-badge ${caps.message ? 'xr-sev-good' : 'xr-sev-warn'}`}>
            {caps.message ? dict.hub.cleanForkReadyBadge : dict.hub.cleanForkFallbackBadge}
          </span>
        </div>
        <div className="xr-kpi-sub" style={{ marginTop: 4, marginBottom: 8 }}>
          {capabilityHint}
        </div>
        <div className="xr-step-badges" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          <span className={`xr-badge ${sec?.hasHandoff ? 'xr-sev-info' : ''}`}>
            {dict.hub.cleanForkHandoffLabel}:{' '}
            {sec ? (sec.hasHandoff ? dict.hub.cleanForkReadyVal : dict.hub.cleanForkNoneVal) : '—'}
          </span>
          <span className={`xr-badge ${sec?.activeSpecTitle ? 'xr-sev-good' : ''}`}>
            {dict.modules.spec.shortLabel}:{' '}
            {sec?.activeSpecTitle ? sec.activeSpecTitle : dict.hub.cleanForkNoneVal}
          </span>
          <span className="xr-badge xr-mono">
            {dict.hub.cleanForkReadyTasksLabel}: {sec ? sec.readyTasksCount : '—'}
          </span>
          <span className="xr-badge xr-mono">
            {dict.hub.cleanForkMemAnchorsLabel}: {sec ? sec.memAnchorsCount : '—'}
          </span>
          {cleanForkPack && (
            <span className="xr-badge xr-mono">
              ~{fmtTokens(cleanForkPack.estimatedTokens)} tok · {cleanForkPack.totalBytes} B
              {cleanForkPack.truncated ? ` (${dict.common.truncated})` : ''}
            </span>
          )}
        </div>
        <div className="xr-export-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button
            type="button"
            className="xr-btn xr-btn-primary"
            disabled={cleanForkLaunching || cleanForkLoading}
            onClick={() => void handleLaunchCleanFork()}
          >
            {cleanForkLaunching
              ? dict.common.loading
              : caps.message
                ? dict.hub.cleanForkTitle
                : dict.hub.cleanForkCopyPackBtn}
          </button>
          <button
            type="button"
            className="xr-btn"
            disabled={cleanForkLoading}
            onClick={async () => {
              if (!showCleanForkPreview && !cleanForkPack) {
                await fetchCleanForkPack(detail?.summary.id, false);
              }
              setShowCleanForkPreview((prev) => !prev);
            }}
          >
            {showCleanForkPreview ? dict.hub.cleanForkHidePreviewBtn : dict.hub.cleanForkPreviewBtn}
          </button>
          <button
            type="button"
            className="xr-btn"
            disabled={cleanForkLoading}
            onClick={() => void handleCopyCleanFork()}
          >
            {dict.hub.cleanForkCopyPackBtn}
          </button>
          <button
            type="button"
            className="xr-btn"
            disabled={cleanForkLoading}
            onClick={() => void fetchCleanForkPack(detail?.summary.id, false)}
          >
            {cleanForkLoading ? dict.common.loading : x.refresh}
          </button>
        </div>
        {lastForkResult && (
          <div className="xr-kpi-sub xr-mono" style={{ marginTop: 6 }}>
            {dict.hub.cleanForkLastLabel}: {lastForkResult.mode}
            {lastForkResult.conversationId ? ` · ${lastForkResult.conversationId}` : ''}
          </div>
        )}
        {showCleanForkPreview && cleanForkPack && (
          <pre
            style={{
              marginTop: 8,
              padding: 10,
              maxHeight: 220,
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
            {cleanForkPack.promptMarkdown}
          </pre>
        )}
      </section>
    );
  };

  const renderCostTab = () => {
    if (analyticsLoading && !analytics) {
      return <div className="xr-card xr-empty-state">{dict.common.loading}</div>;
    }
    if (!analytics) {
      return (
        <div className="xr-card xr-empty-state">
          <div>{dict.common.empty}</div>
          <div className="xr-empty-sub">
            <button type="button" className="xr-btn" onClick={() => void fetchCostAnalytics()}>
              {x.refresh}
            </button>
          </div>
        </div>
      );
    }

    const fw = analytics.fiveHourWindow;
    return (
      <div className="xr-stack">
        {/* 4 Billing KPI Cards */}
        <section className="xr-kpi-grid" aria-label={x.tabCost}>
          <div className="xr-card">
            <div className="xr-kpi-label">{x.todayCost}</div>
            <div className="xr-kpi-value">{fmtUsd(analytics.todayEstimatedUsd)}</div>
            <div className="xr-kpi-sub xr-mono">UTC · {analytics.sessionsAnalyzed}S</div>
          </div>
          <div className="xr-card">
            <div className="xr-kpi-label">{x.weekCost}</div>
            <div className="xr-kpi-value">{fmtUsd(analytics.weekEstimatedUsd)}</div>
            <div className="xr-kpi-sub xr-mono">
              7d · {fmtUsd(analytics.totalEstimatedUsd)}
            </div>
          </div>
          <div className="xr-card">
            <div className="xr-kpi-label">{x.cacheSavings}</div>
            <div className="xr-kpi-value" style={{ color: 'var(--nov-success)' }}>
              {fmtUsd(analytics.cacheSavingsUsd)}
            </div>
            <div className="xr-kpi-sub">{dict.badgeOffline}</div>
          </div>
          <div className="xr-card">
            <div className="xr-window-header">
              <span className="xr-kpi-label">{x.fiveHourWindow}</span>
              <span className={`xr-badge ${warningBadgeClass}`}>
                {warningLevel.toUpperCase()}
              </span>
            </div>
            <div className="xr-kpi-value">{fmtUsd(fw.estimatedUsd)}</div>
            <div className="xr-kpi-sub xr-mono">
              {x.burnRate}: {fmtUsd(fw.burnRateUsdPerHour)}/h · {fmtTokens(fw.burnRateTokensPerHour)}/h
            </div>
          </div>
        </section>

        {/* Export Actions Bar (anti-double-click disabled state) */}
        <section className="xr-card">
          <div className="xr-section-title">
            <span>{x.exportHandoff}</span>
            <span className="xr-badge xr-sev-good">{dict.badgeOffline}</span>
          </div>
          <div className="xr-export-bar">
            <button
              type="button"
              className="xr-btn xr-btn-primary"
              disabled={!detail || exportingKind !== null}
              onClick={() => void handleExportHandoff(false)}
            >
              {exportingKind === 'handoff' ? dict.common.loading : x.exportHandoff}
            </button>
            {canAttachContext && (
              <button
                type="button"
                className="xr-btn"
                disabled={!detail || exportingKind !== null}
                onClick={() => void handleExportHandoff(true)}
              >
                {exportingKind === 'handoff-attach' ? dict.common.loading : x.attachContext}
              </button>
            )}
            <button
              type="button"
              className="xr-btn"
              disabled={!detail || exportingKind !== null}
              onClick={() => void handleExportOtlp()}
            >
              {exportingKind === 'otlp' ? dict.common.loading : x.exportOtlp}
            </button>
            <button
              type="button"
              className="xr-btn"
              disabled={exportingKind !== null}
              onClick={() => void handleExportCsv()}
            >
              {exportingKind === 'csv' ? dict.common.loading : x.exportCsv}
            </button>
          </div>
        </section>

        {/* 14-Day Horizontal Bar Trend */}
        <section className="xr-card">
          <div className="xr-section-title">
            <span>{x.dailyTrendTitle}</span>
            <span className="xr-badge xr-mono">14d UTC</span>
          </div>
          {!hasAnyTrendActivity ? (
            <div className="xr-empty-state">{dict.common.empty}</div>
          ) : (
            <div className="xr-trend-list">
              {analytics.dailyTrend.map((d) => {
                const ratio =
                  d.estimatedUsd > 0
                    ? (d.estimatedUsd / maxDailyUsd) * 100
                    : d.totalTokens > 0
                      ? (d.totalTokens / maxDailyTokens) * 100
                      : 0;
                const widthPct = d.totalTokens > 0 || d.estimatedUsd > 0 ? Math.max(3, Math.min(100, ratio)) : 0;
                return (
                  <div key={d.date} className="xr-trend-row">
                    <span className="xr-trend-date xr-mono">{d.date.slice(5)}</span>
                    <div className="xr-trend-track" title={`${d.date}: ${fmtUsd(d.estimatedUsd)} · ${fmtTokens(d.totalTokens)}`}>
                      <div
                        className="xr-trend-fill"
                        style={{
                          width: `${widthPct}%`,
                          background:
                            d.estimatedUsd >= 15
                              ? 'var(--nov-warn)'
                              : 'var(--nov-accent)',
                        }}
                      />
                    </div>
                    <span className="xr-trend-val xr-mono">
                      {fmtUsd(d.estimatedUsd)} · {fmtTokens(d.totalTokens)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Model Cost Totals */}
        {analytics.modelTotals.length > 0 && (
          <section className="xr-card">
            <div className="xr-section-title">
              <span>{x.modelBreakdown}</span>
              <span className="xr-badge xr-mono">{analytics.modelTotals.length}</span>
            </div>
            <div className="xr-list">
              {analytics.modelTotals.map((m) => (
                <div key={m.model} className="xr-file-row">
                  <div className="xr-step-badges">
                    <span className="xr-badge xr-sev-info xr-mono">{m.model}</span>
                    <span className="xr-kpi-sub xr-mono">
                      {m.sessions}S · {fmtTokens(m.totalTokens)} · {(m.cacheHitRate * 100).toFixed(0)}%
                    </span>
                  </div>
                  <strong className="xr-mono">{fmtUsd(m.estimatedUsd)}</strong>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  };

  return (
    <div className="mod-xray" data-theme={theme}>
      <header className="xr-header">
        <div className="xr-brand">
          <span className="xr-logo-dot">XR</span>
          <span>{x.title}</span>
          <span className="xr-badge xr-sev-info">
            {caps.isWorkbench ? x.modeWorkbench : x.modeMcpApp}
          </span>
        </div>

        <div className="xr-controls">
          <form
            className="xr-controls"
            onSubmit={(e) => {
              e.preventDefault();
              if (!quickQuery.trim()) return;
              setTab('timemachine');
              void handleSearch(quickQuery);
            }}
          >
            <input
              type="search"
              className="xr-input"
              placeholder={x.searchPlaceholder}
              aria-label={x.searchPlaceholder}
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
            />
          </form>
          {sessions.length > 0 && (
            <select
              className="xr-select"
              aria-label={x.title}
              value={detail?.summary.id ?? ''}
              onChange={(e) => void handleSelectSession(e.target.value)}
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} ({s.turns}T · {fmtTokens(s.peakContextTokens)})
                </option>
              ))}
            </select>
          )}
          <button type="button" className="xr-btn" onClick={handleRefresh} disabled={loading}>
            {loading ? dict.common.loading : x.refresh}
          </button>
          <button
            type="button"
            className="xr-btn xr-btn-primary"
            onClick={() => void handleExportBrief()}
            disabled={!detail || exportingKind !== null}
          >
            {exportingKind === 'brief' ? dict.common.loading : x.exportBrief}
          </button>
        </div>
      </header>

      <nav className="xr-tabs" role="tablist" aria-label={x.title}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'overview'}
          className={`xr-tab ${tab === 'overview' ? 'is-active' : ''}`}
          onClick={() => setTab('overview')}
        >
          {x.tabOverview}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'files'}
          className={`xr-tab ${tab === 'files' ? 'is-active' : ''}`}
          onClick={() => setTab('files')}
        >
          {x.tabFiles}
          {detail && <span className="xr-badge">{detail.fileActivity.length}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'timemachine'}
          className={`xr-tab ${tab === 'timemachine' ? 'is-active' : ''}`}
          onClick={() => setTab('timemachine')}
        >
          {x.tabTimeMachine}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'steps'}
          className={`xr-tab ${tab === 'steps' ? 'is-active' : ''}`}
          onClick={() => setTab('steps')}
        >
          {x.tabSteps}
          {detail && <span className="xr-badge">{detail.recentSteps.length}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'cost'}
          className={`xr-tab ${tab === 'cost' ? 'is-active' : ''}`}
          onClick={() => setTab('cost')}
        >
          {x.tabCost}
          {warningLevel !== 'ok' && (
            <span className={`xr-badge ${warningBadgeClass}`}>
              {warningLevel.toUpperCase()}
            </span>
          )}
        </button>
      </nav>

      {loadError && (
        <div className="xr-card xr-error-banner">
          <span>{loadError}</span>
          <button type="button" className="xr-btn" onClick={handleRefresh}>
            {dict.retry}
          </button>
        </div>
      )}

      {tab === 'cost' ? (
        <main className="xr-main">{renderCostTab()}</main>
      ) : loading && !detail ? (
        <div className="xr-card xr-empty-state">{dict.common.loading}</div>
      ) : !detail ? (
        <main className="xr-main">
          {renderCleanForkCard()}
          <div className="xr-card xr-empty-state">
            <strong>{dict.common.empty}</strong>
            <div className="xr-empty-sub">{x.refresh}</div>
          </div>
        </main>
      ) : (
        <main className="xr-main">
          <section className="xr-kpi-grid" aria-label={x.title}>
            <div className="xr-card">
              <div className="xr-kpi-label">{x.totalTokens}</div>
              <div className="xr-kpi-value">
                {fmtTokens(detail.summary.totalInputTokens + detail.summary.totalOutputTokens)}
              </div>
            </div>
            <div className="xr-card">
              <div className="xr-kpi-label">{x.cacheHitRate}</div>
              <div className="xr-kpi-value">
                {(detail.summary.cacheHitRate * 100).toFixed(1)}%
              </div>
            </div>
            <div className="xr-card">
              <div className="xr-kpi-label">{x.cachedTokens}</div>
              <div className="xr-kpi-value">
                {fmtTokens(detail.summary.totalCacheReadTokens)}
              </div>
            </div>
            <div className="xr-card">
              <div className="xr-kpi-label">{x.freshTokens}</div>
              <div className="xr-kpi-value">
                {fmtTokens(detail.summary.totalFreshInputTokens)}
              </div>
            </div>
            <div className="xr-card">
              <div className="xr-kpi-label">{x.estCostUsd}</div>
              <div className="xr-kpi-value">{fmtUsd(detail.summary.estimatedUsd)}</div>
              {detail.summary.cacheSavingsUsd != null && detail.summary.cacheSavingsUsd > 0 && (
                <div className="xr-kpi-sub xr-mono">
                  {x.cacheSavings}: {fmtUsd(detail.summary.cacheSavingsUsd)}
                </div>
              )}
            </div>
          </section>
          {tab === 'overview' && (
            <>
              {renderCleanForkCard()}
              <ContextCharts detail={detail} />
              {((detail.swarmLineage && detail.swarmLineage.totalSubagents > 0) ||
                (detail.modelBreakdown && detail.modelBreakdown.length > 0)) && (
                <section className="xr-card" style={{ marginTop: 12 }}>
                  <div className="xr-section-title">
                    <span>{x.swarmTitle}</span>
                    {detail.swarmLineage && (
                      <span className="xr-kpi-sub">
                        {x.subagents}: {detail.swarmLineage.totalSubagents}
                        {detail.swarmLineage.orphanSuspects > 0
                          ? ` · ${x.orphanSuspects}: ${detail.swarmLineage.orphanSuspects}`
                          : ''}
                      </span>
                    )}
                  </div>
                  {detail.modelBreakdown && detail.modelBreakdown.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div className="xr-kpi-label" style={{ marginBottom: 6 }}>
                        {x.modelBreakdown}
                      </div>
                      <div className="xr-list">
                        {detail.modelBreakdown.map((m) => (
                          <div key={m.model} className="xr-file-row">
                            <div className="xr-step-badges">
                              <span className="xr-badge xr-sev-info xr-mono">{m.model}</span>
                              <span className="xr-kpi-sub xr-mono">
                                {m.turns}T · IN {fmtTokens(m.inputTokens)} · OUT{' '}
                                {fmtTokens(m.outputTokens)} · {(m.cacheHitRate * 100).toFixed(0)}%{' '}
                                ({m.sharePercent}%)
                                {m.estimatedUsd != null ? ` · ${fmtUsd(m.estimatedUsd)}` : ''}
                              </span>
                              {m.retrySignals > 0 && (
                                <span className="xr-badge xr-sev-warn">
                                  429 ×{m.retrySignals}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {detail.swarmLineage && detail.swarmLineage.children.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div className="xr-kpi-label" style={{ marginBottom: 6 }}>
                        {x.subagents} ({detail.swarmLineage.children.length})
                      </div>
                      <div className="xr-list">
                        {detail.swarmLineage.children.map((ch, idx) => (
                          <div
                            key={`${ch.conversationId ?? ch.role}-${ch.stepIndex}-${idx}`}
                            className="xr-file-row"
                          >
                            <div className="xr-step-badges">
                              <span className="xr-badge xr-mono">{ch.typeName}</span>
                              <strong>{ch.role}</strong>
                              <span className="xr-kpi-sub xr-mono">{ch.model}</span>
                              {ch.transcriptFound && (
                                <span className="xr-kpi-sub xr-mono">
                                  IN {fmtTokens(ch.totalInputTokens)} · OUT{' '}
                                  {fmtTokens(ch.totalOutputTokens)}
                                </span>
                              )}
                              {ch.statusHint === 'orphan_suspect' && (
                                <span className="xr-badge xr-sev-warn">{x.orphanSuspects}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
          {tab === 'files' && (
            <FileTreePanel
              files={detail.fileActivity}
              canOpenFile={canOpenFile}
              canAttachContext={canAttachContext}
              onOpenFile={(f) => void handleOpenFile(f)}
              onAttachFile={(f) => void handleAttachFile(f)}
            />
          )}
          {tab === 'timemachine' && (
            <TimeMachinePanel
              sessions={sessions}
              artifacts={detail.artifacts}
              hits={hits}
              searching={searching}
              hasSearched={hasSearched}
              canInject={canAttachContext}
              onSearch={(q) => void handleSearch(q)}
              onSelectSession={(id) => void handleSelectSession(id)}
              onInjectHit={(h) => void handleInjectHit(h)}
              onInjectArtifact={(a) => void handleInjectArtifact(a)}
            />
          )}
          {tab === 'steps' && (
            <div className="xr-card">
              <div className="xr-section-title">
                <span>{x.tabSteps}</span>
                <span className="xr-kpi-sub">{detail.recentSteps.length}</span>
              </div>
              <div className="xr-list">
                {detail.recentSteps.map((st) => (
                  <div key={st.stepIndex} className="xr-file-row">
                    <div className="xr-file-meta">
                      <div className="xr-step-badges">
                        <span className="xr-badge xr-mono">#{st.stepIndex}</span>
                        <span
                          className={`xr-badge ${st.type === 'PLANNER_RESPONSE' ? 'xr-sev-info' : ''}`}
                        >
                          {st.type}
                        </span>
                        {st.toolNames.map((tn, idx) => (
                          <span key={`${tn}-${idx}`} className="xr-badge xr-sev-good xr-mono">
                            {tn}
                          </span>
                        ))}
                        {st.truncated && (
                          <span className="xr-badge xr-sev-warn">{x.truncatedBadge}</span>
                        )}
                        {st.inputTokens != null && (
                          <span className="xr-kpi-sub xr-mono">
                            IN {fmtTokens(st.inputTokens)} · CACHE{' '}
                            {fmtTokens(st.cacheReadTokens ?? 0)} · OUT{' '}
                            {fmtTokens(st.outputTokens ?? 0)}
                          </span>
                        )}
                      </div>
                      {st.preview && <div className="xr-snippet">{st.preview}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      )}

      {localToast && <div className="xr-toast">{localToast}</div>}
    </div>
  );
};
