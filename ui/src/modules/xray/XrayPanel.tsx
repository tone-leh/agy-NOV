import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { HostCapabilitiesSummary, NovBridge } from '../../bridge.js';
import { useNovI18n } from '../../i18n/index.js';
import { ContextCharts } from './ContextCharts';
import { FileTreePanel } from './FileTreePanel';
import { TimeMachinePanel } from './TimeMachinePanel';
import {
  fmtTokens,
  type ArtifactSummary,
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

const VALID_TABS = new Set<XrayTabKey>(['overview', 'files', 'timemachine', 'steps']);

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
  const { dict } = useNovI18n();
  const x = dict.panels.xray;

  const loadedOnceRef = useRef(false);
  const lastEventRef = useRef<typeof incomingEvent>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => bridge.getTheme());
  const [caps, setCaps] = useState<HostCapabilitiesSummary>(() => bridge.getCapabilities());

  const [tab, setTab] = useState<XrayTabKey>('overview');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [quickQuery, setQuickQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
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

  const fetchSessionsAndDetail = useCallback(
    async (sessionId?: string, silent = false) => {
      loadedOnceRef.current = true;
      setLoading(true);
      setLoadError(null);
      try {
        const [listRes, detailRes] = await Promise.all([
          bridge.callTool<{ sessions?: SessionSummary[] }>('app_xray_list_sessions', { limit: 25 }),
          bridge.callTool<{ detail?: SessionDetail | null }>(
            'app_xray_get_session_detail',
            sessionId ? { sessionId } : {},
          ),
        ]);
        const list = Array.isArray(listRes?.sessions) ? listRes.sessions : [];
        if (list.length > 0) setSessions(list);
        if (detailRes && 'detail' in detailRes) {
          setDetail(detailRes.detail ?? null);
        }
        if (!silent) {
          notify('Refreshed local transcript metrics');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(msg);
        notify(`Failed to load X-Ray telemetry: ${msg}`);
      } finally {
        setLoading(false);
      }
    },
    [bridge, notify],
  );

  // Hydrate once on first activation
  useEffect(() => {
    if (active && !loadedOnceRef.current) {
      void fetchSessionsAndDetail(undefined, true);
    }
  }, [active, fetchSessionsAndDetail]);

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
    if (!Array.isArray(sc.sessions) && sc.detail === undefined && active) {
      void fetchSessionsAndDetail(detail?.summary.id, true);
    }
  }, [incomingEvent, active, fetchSessionsAndDetail, detail?.summary.id]);

  const handleSelectSession = async (sessionId: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await bridge.callTool<{ detail?: SessionDetail | null }>(
        'app_xray_get_session_detail',
        { sessionId },
      );
      if (res?.detail) {
        setDetail(res.detail);
        setTab('overview');
      }
    } catch (err) {
      notify(`Failed to load session: ${err instanceof Error ? err.message : String(err)}`);
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
      return;
    }
    setSearching(true);
    try {
      const res = await bridge.callTool<{ hits?: SearchHit[] }>('app_xray_search_sessions', {
        query: trimmed,
        limit: 15,
      });
      setHits(Array.isArray(res?.hits) ? res.hits : []);
    } catch (err) {
      notify(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSearching(false);
    }
  };

  const handleOpenFile = async (file: FileActivityItem) => {
    const ok = await bridge.openFile(file.uri || file.path);
    notify(
      ok
        ? `Opened ${file.basename} in side pane`
        : 'File opening is available in Conversation Side Pane mode',
    );
  };

  const handleAttachFile = async (file: FileActivityItem) => {
    const outcome = await bridge.updateModelContext(
      `[Agy X-Ray File Reference]\nPath: ${file.path}\nActivity: ${file.ops.join('/')} (${file.totalTouches} touches, last at step #${file.lastStepIndex})`,
    );
    notify(
      outcome === 'context'
        ? `Attached ${file.basename} to next message`
        : `Copied ${file.basename} reference to clipboard`,
    );
  };

  const handleInjectHit = async (hit: SearchHit) => {
    const outcome = await bridge.updateModelContext(
      `[Agy X-Ray Time Machine Context]\nFrom session: ${hit.sessionTitle} (${hit.sessionId})\nSource: ${hit.sourceLabel} (${hit.filePath})\nExcerpt:\n${hit.snippet}`,
    );
    notify(
      outcome === 'context'
        ? 'Injected historical excerpt into next message'
        : 'Copied historical excerpt to clipboard',
    );
  };

  const handleInjectArtifact = async (art: ArtifactSummary) => {
    const outcome = await bridge.updateModelContext(
      `[Agy X-Ray Artifact Context]\nArtifact: ${art.name} (${art.path})\nPreview:\n${art.preview}`,
    );
    notify(
      outcome === 'context'
        ? `Attached ${art.name} to next message`
        : `Copied ${art.name} preview to clipboard`,
    );
  };

  const handleExportBrief = async () => {
    try {
      const res = await bridge.callTool<{ markdown?: string }>(
        'app_xray_export_brief',
        detail?.summary.id ? { sessionId: detail.summary.id } : {},
      );
      const md = typeof res?.markdown === 'string' ? res.markdown : '';
      if (!md) {
        notify('No brief content returned for this session');
        return;
      }
      const copied = await copyTextReliable(md);
      if (copied) {
        notify('Copied secret-redacted Markdown brief to clipboard');
      } else {
        const outcome = await bridge.updateModelContext(md);
        notify(
          outcome === 'context'
            ? 'Attached secret-redacted brief to next message'
            : 'Brief ready — clipboard restricted in this host',
        );
      }
    } catch (err) {
      notify(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const canOpenFile = caps.isWorkbench || caps.message || caps.updateModelContext;
  const canAttachContext = caps.isWorkbench || caps.updateModelContext;

  return (
    <div className="mod-xray" data-theme={theme}>
      <header className="xr-header">
        <div className="xr-brand">
          <span className="xr-logo-dot">XR</span>
          <span>{x.title}</span>
          <span className="xr-badge xr-sev-info">
            {caps.isWorkbench ? 'Workbench' : 'MCP App'}
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
            disabled={!detail}
          >
            {x.exportBrief}
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
      </nav>

      {loadError && (
        <div className="xr-card xr-error-banner">
          <span>{loadError}</span>
          <button type="button" className="xr-btn" onClick={handleRefresh}>
            {dict.retry}
          </button>
        </div>
      )}

      {loading && !detail ? (
        <div className="xr-card xr-empty-state">{dict.common.loading}</div>
      ) : !detail ? (
        <div className="xr-card xr-empty-state">
          <strong>{dict.common.empty}</strong>
          <div className="xr-empty-sub">{x.refresh}</div>
        </div>
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
          </section>
          {tab === 'overview' && (
            <>
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
                              <span className="xr-kpi-sub">
                                {m.turns}T · in {fmtTokens(m.inputTokens)} · out{' '}
                                {fmtTokens(m.outputTokens)} · {(m.cacheHitRate * 100).toFixed(0)}%{' '}
                                ({m.sharePercent}%)
                              </span>
                              {m.retrySignals > 0 && (
                                <span className="xr-badge xr-sev-warn">
                                  429/retry ×{m.retrySignals}
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
                                  in {fmtTokens(ch.totalInputTokens)} · out{' '}
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
                        {st.truncated && <span className="xr-badge xr-sev-warn">TRUNCATED</span>}
                        {st.inputTokens != null && (
                          <span className="xr-kpi-sub xr-mono">
                            in {fmtTokens(st.inputTokens)} · cache{' '}
                            {fmtTokens(st.cacheReadTokens ?? 0)} · out{' '}
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
