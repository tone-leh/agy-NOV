import React, { useCallback, useEffect, useState } from 'react';
import type { NovBridge } from '../../bridge.js';
import { useNovI18n } from '../../i18n/index.js';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
}

type CompactPresetOption = 'auto' | 'test' | 'build' | 'git' | 'generic';

const COMPACT_PRESET_CHOICES: ReadonlyArray<{ value: CompactPresetOption; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'test', label: 'Test' },
  { value: 'build', label: 'Build' },
  { value: 'git', label: 'Git' },
  { value: 'generic', label: 'Generic' },
];

interface TurboGainBucket {
  operations: number;
  rawTokens: number;
  returnedTokens: number;
  savedTokens: number;
  savedPercent: number;
  estimatedSavedUsd: number;
}

interface TurboGainSummary {
  totalOperations: number;
  totalRawTokens: number;
  totalReturnedTokens: number;
  totalSavedTokens: number;
  avgCompressionPercent: number;
  estimatedSavedUsd: number;
  guardrailTriggeredCount: number;
  byOperation: {
    search: TurboGainBucket;
    outline: TurboGainBucket;
    compact: TurboGainBucket;
  };
  recent: Array<{
    op: 'batch_search' | 'read_outline' | 'compact_output';
    label: string;
    savedTokens: number;
    savedPercent: number;
    guardrailApplied: boolean;
    timestamp: string;
  }>;
}

interface TurboState {
  mode: string;
  stats: {
    searchCount: number;
    outlineCount: number;
    compactionCount: number;
    indexedChunks: number;
    estimatedSavedTokens: number;
  };
  gain?: TurboGainSummary;
  chunks: Array<{
    chunkId: string;
    label: string;
    totalLines: number;
    estimatedSavedTokens: number;
    detectedPreset?: Exclude<CompactPresetOption, 'auto'>;
    savedPercent?: number;
  }>;
  lastSearch: {
    scannedFiles: number;
    totalMatches: number;
    skippedSensitive: number;
    elapsedMs: number;
    results: Array<{
      query: string;
      totalHits: number;
      matches: Array<{ file: string; line: number; snippet: string }>;
    }>;
  } | null;
  lastOutline: {
    file: string;
    language: string;
    totalLines: number;
    estimatedSavedTokens: number;
    outline: Array<{
      kind: string;
      name: string;
      line: number;
      level?: number;
      parent?: string;
    }>;
    slice: { startLine: number; endLine: number; content: string };
  } | null;
  lastCompact: {
    chunkId: string;
    label: string;
    summaryText: string;
    estimatedRawTokens: number;
    estimatedSummaryTokens: number;
    estimatedSavedTokens: number;
    compressionRatio?: number;
    detectedPreset?: Exclude<CompactPresetOption, 'auto'>;
    linesBefore?: number;
    linesAfter?: number;
    savedPercent?: number;
  } | null;
}

export const TurboPanel: React.FC<NovModulePanelProps> = ({ bridge, active, onNotify }) => {
  const { dict, t } = useNovI18n();
  const [tab, setTab] = useState<'search' | 'outline' | 'compact'>('search');
  const [state, setState] = useState<TurboState | null>(null);
  const [busy, setBusy] = useState(false);

  const [queriesText, setQueriesText] = useState('createNovServer\nMODULE_CATALOG');
  const [filePath, setFilePath] = useState('src/core/catalog.ts');
  const [startLine, setStartLine] = useState('1');
  const [endLine, setEndLine] = useState('45');
  const [rawOutput, setRawOutput] = useState('');
  const [compactPreset, setCompactPreset] = useState<CompactPresetOption>('auto');
  const [chunkQuery, setChunkQuery] = useState('');
  const [chunkHits, setChunkHits] = useState<Array<{ matchedLine: number; snippet: string }> | null>(null);

  const loadState = useCallback(async () => {
    try {
      const res = await bridge.callTool<TurboState>('app_turbo_get_state', {});
      setState(res);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    }
  }, [bridge, onNotify]);

  useEffect(() => {
    if (active) void loadState();
  }, [active, loadState]);

  const runSearch = async () => {
    const queries = queriesText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 8);
    if (queries.length === 0) return;
    setBusy(true);
    try {
      const res = await bridge.callTool<{ state: TurboState }>('app_turbo_batch_search', { queries });
      setState(res.state);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runOutline = async () => {
    if (!filePath.trim()) return;
    setBusy(true);
    try {
      const s = Number(startLine) || 1;
      const e = Number(endLine) || undefined;
      const res = await bridge.callTool<{ state: TurboState }>('app_turbo_read_outline', {
        filePath: filePath.trim(),
        startLine: s,
        endLine: e,
      });
      setState(res.state);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runCompact = async () => {
    if (!rawOutput.trim()) return;
    setBusy(true);
    setChunkHits(null);
    try {
      const res = await bridge.callTool<{ state: TurboState }>('app_turbo_compact_output', {
        label: 'pasted-log',
        rawText: rawOutput,
        preset: compactPreset,
      });
      setState(res.state);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runChunkQuery = async (chunkId: string) => {
    if (!chunkQuery.trim()) return;
    setBusy(true);
    try {
      const res = await bridge.callTool<{
        matches: Array<{ matchedLine: number; snippet: string }>;
      }>('app_turbo_query_chunk', { chunkId, query: chunkQuery.trim(), limit: 10 });
      setChunkHits(res.matches ?? []);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const lastCompact = state?.lastCompact;
  const gain = state?.gain;
  const savedRatio = lastCompact
    ? typeof lastCompact.savedPercent === 'number'
      ? Math.max(0, Math.min(100, Math.round(lastCompact.savedPercent)))
      : typeof lastCompact.compressionRatio === 'number'
        ? Math.max(0, Math.round(lastCompact.compressionRatio * 100))
        : lastCompact.estimatedRawTokens > 0
          ? Math.max(
              0,
              Math.round((lastCompact.estimatedSavedTokens / lastCompact.estimatedRawTokens) * 100),
            )
          : 0
    : 0;

  const gainTotalSavedTokens = gain?.totalSavedTokens ?? state?.stats.estimatedSavedTokens ?? 0;
  const gainEstUsdSaved = gain?.estimatedSavedUsd ?? 0;
  const gainAvgCompression = gain?.avgCompressionPercent ?? 0;
  const gainTotalOps =
    gain?.totalOperations ??
    (state
      ? state.stats.searchCount + state.stats.outlineCount + state.stats.compactionCount
      : 0);
  const gainGuardrailCount = gain?.guardrailTriggeredCount ?? 0;

  const formatGainOpLabel = (op: 'batch_search' | 'read_outline' | 'compact_output'): string => {
    if (op === 'batch_search') return dict.turbo.tabSearch;
    if (op === 'read_outline') return dict.turbo.tabOutline;
    return dict.turbo.tabCompact;
  };

  return (
    <div className="nov-p-page">
      <section className="nov-p-card">
        <div className="nov-p-row">
          <div>
            <h2 className="nov-hero-title">{dict.turbo.title}</h2>
            <p className="nov-hero-sub">{dict.turbo.subtitle}</p>
          </div>
          <button type="button" className="nov-p-btn" onClick={() => void loadState()}>
            {dict.common.refresh}
          </button>
        </div>

        <div className="nov-p-stat-grid">
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.turbo.tabSearch}</div>
            <div className="nov-p-stat-val">{state?.stats.searchCount ?? 0}</div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.turbo.tabOutline}</div>
            <div className="nov-p-stat-val">{state?.stats.outlineCount ?? 0}</div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.turbo.tabCompact}</div>
            <div className="nov-p-stat-val">{state?.stats.indexedChunks ?? 0}</div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.turbo.gainTokensSaved}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-success)' }}>
              ~{gainTotalSavedTokens.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="nov-p-banner">{dict.turbo.safetyNote}</div>

        <div className="nov-p-tabs">
          {(['search', 'outline', 'compact'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`nov-preset-btn ${tab === k ? 'is-active' : ''}`}
              onClick={() => setTab(k)}
            >
              {k === 'search'
                ? dict.turbo.tabSearch
                : k === 'outline'
                  ? dict.turbo.tabOutline
                  : dict.turbo.tabCompact}
            </button>
          ))}
        </div>
      </section>

      <section className="nov-p-card">
        <div className="nov-p-row">
          <strong style={{ fontSize: '13px' }}>{dict.turbo.gainTitle}</strong>
          <span className={`nov-badge ${gainGuardrailCount > 0 ? 'is-accent' : 'is-offline'}`}>
            {dict.turbo.guardrailBadge}
            {gainGuardrailCount > 0 ? ` · ${gainGuardrailCount}` : ''}
          </span>
        </div>

        <div className="nov-p-stat-grid">
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.turbo.gainTokensSaved}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-success)' }}>
              ~{gainTotalSavedTokens.toLocaleString()}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.turbo.gainEstUsdSaved}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-accent)' }}>
              ${gainEstUsdSaved.toFixed(4)}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.turbo.gainAvgRatio}</div>
            <div className="nov-p-stat-val">{gainAvgCompression}%</div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.turbo.gainOpsCount}</div>
            <div className="nov-p-stat-val">{gainTotalOps}</div>
          </div>
        </div>

        {gain && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            <span className="nov-badge">
              {dict.turbo.tabSearch}: {gain.byOperation.search.operations} ({gain.byOperation.search.savedPercent}%)
            </span>
            <span className="nov-badge">
              {dict.turbo.tabOutline}: {gain.byOperation.outline.operations} ({gain.byOperation.outline.savedPercent}%)
            </span>
            <span className="nov-badge">
              {dict.turbo.tabCompact}: {gain.byOperation.compact.operations} ({gain.byOperation.compact.savedPercent}%)
            </span>
          </div>
        )}

        {gain && gain.recent.length > 0 && (
          <div className="nov-p-list">
            {gain.recent.slice(0, 4).map((entry, idx) => (
              <div
                key={`${entry.timestamp}-${entry.op}-${idx}`}
                className="nov-p-row"
                style={{ fontSize: '11.5px', fontFamily: 'var(--nov-font-mono)' }}
              >
                <span style={{ display: 'flex', gap: '6px', alignItems: 'center', minWidth: 0 }}>
                  <span className="nov-badge">{formatGainOpLabel(entry.op)}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.label}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
                  {entry.guardrailApplied && (
                    <span className="nov-badge is-accent">{dict.turbo.guardrailBadge}</span>
                  )}
                  <span style={{ color: 'var(--nov-success)' }}>
                    -{entry.savedTokens.toLocaleString()} ({entry.savedPercent}%)
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {tab === 'search' && (
        <section className="nov-p-card">
          <label style={{ fontSize: '12px', fontWeight: 600 }}>{dict.turbo.queriesLabel}</label>
          <textarea
            className="nov-p-textarea"
            value={queriesText}
            placeholder={dict.turbo.queriesPlaceholder}
            onChange={(e) => setQueriesText(e.target.value)}
          />
          <div className="nov-p-row">
            <button
              type="button"
              className="nov-p-btn is-primary"
              disabled={busy}
              onClick={() => void runSearch()}
            >
              {busy ? dict.common.loading : dict.turbo.searchBtn}
            </button>
            {state?.lastSearch && (
              <span style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                {t(dict.turbo.matchesSummary, {
                  files: state.lastSearch.scannedFiles,
                  matches: state.lastSearch.totalMatches,
                })}
              </span>
            )}
          </div>

          {state?.lastSearch && (
            <div className="nov-p-list">
              {state.lastSearch.results.map((r) => (
                <div key={r.query} className="nov-p-item">
                  <div className="nov-p-row">
                    <strong>{r.query}</strong>
                    <span className="nov-badge">{r.totalHits}</span>
                  </div>
                  {r.matches.slice(0, 6).map((m, idx) => (
                    <div
                      key={`${m.file}:${m.line}:${idx}`}
                      style={{ fontSize: '11.5px', fontFamily: 'var(--nov-font-mono)' }}
                    >
                      <span style={{ color: 'var(--nov-accent)' }}>
                        {m.file}:{m.line}
                      </span>{' '}
                      <span style={{ color: 'var(--nov-text-1)' }}>{m.snippet}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'outline' && (
        <section className="nov-p-card">
          <div className="nov-p-banner">{dict.turbo.nestedOutlineNote}</div>
          <label style={{ fontSize: '12px', fontWeight: 600 }}>{dict.turbo.filePathLabel}</label>
          <input
            className="nov-p-input"
            value={filePath}
            placeholder={dict.turbo.filePathPlaceholder}
            onChange={(e) => setFilePath(e.target.value)}
          />
          <div className="nov-p-row">
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <label style={{ fontSize: '11.5px' }}>{dict.turbo.startLine}</label>
              <input
                className="nov-p-input"
                style={{ width: '80px' }}
                value={startLine}
                onChange={(e) => setStartLine(e.target.value)}
              />
              <label style={{ fontSize: '11.5px' }}>{dict.turbo.endLine}</label>
              <input
                className="nov-p-input"
                style={{ width: '80px' }}
                value={endLine}
                onChange={(e) => setEndLine(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="nov-p-btn is-primary"
              disabled={busy}
              onClick={() => void runOutline()}
            >
              {busy ? dict.common.loading : dict.turbo.outlineBtn}
            </button>
          </div>

          {state?.lastOutline && (
            <>
              <div style={{ fontSize: '12px', fontWeight: 600 }}>
                {dict.turbo.symbolsTitle} ({state.lastOutline.file})
              </div>
              <div className="nov-p-list">
                {state.lastOutline.outline.slice(0, 40).map((sym, idx) => {
                  const isNested = sym.level === 1 || Boolean(sym.parent);
                  return (
                    <div
                      key={`${sym.line}-${sym.parent ?? ''}-${sym.name}-${idx}`}
                      className="nov-p-row"
                      style={{
                        fontSize: '12px',
                        fontFamily: 'var(--nov-font-mono)',
                        paddingLeft: isNested ? '18px' : undefined,
                        borderLeft: isNested ? '2px solid var(--nov-border)' : undefined,
                      }}
                    >
                      <span>
                        <span className={`nov-badge ${isNested ? 'is-accent' : ''}`}>{sym.kind}</span>{' '}
                        {sym.parent ? (
                          <>
                            <span style={{ color: 'var(--nov-text-2)' }}>{sym.parent}::</span>
                            {sym.name}
                          </>
                        ) : (
                          sym.name
                        )}
                      </span>
                      <span style={{ color: 'var(--nov-text-2)' }}>L{sym.line}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: '12px', fontWeight: 600 }}>{dict.turbo.sliceTitle}</div>
              <pre className="nov-p-pre">{state.lastOutline.slice.content}</pre>
            </>
          )}
        </section>
      )}

      {tab === 'compact' && (
        <section className="nov-p-card">
          <div className="nov-p-row">
            <label style={{ fontSize: '12px', fontWeight: 600 }}>{dict.turbo.rawOutputLabel}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label htmlFor="nov-turbo-preset" style={{ fontSize: '11.5px', color: 'var(--nov-text-1)' }}>
                {dict.turbo.presetLabel}
              </label>
              <select
                id="nov-turbo-preset"
                className="nov-p-select"
                style={{ width: 'auto', minWidth: '118px', padding: '5px 9px' }}
                value={compactPreset}
                onChange={(e) => setCompactPreset(e.target.value as CompactPresetOption)}
              >
                {COMPACT_PRESET_CHOICES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <textarea
            className="nov-p-textarea"
            value={rawOutput}
            placeholder={dict.turbo.rawOutputPlaceholder}
            onChange={(e) => setRawOutput(e.target.value)}
          />
          <div className="nov-p-row">
            <button
              type="button"
              className="nov-p-btn is-primary"
              disabled={busy || !rawOutput.trim()}
              onClick={() => void runCompact()}
            >
              {busy ? dict.common.loading : dict.turbo.compactBtn}
            </button>
            {lastCompact && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                {lastCompact.detectedPreset && (
                  <span className="nov-badge is-accent">
                    {dict.turbo.presetLabel}: {lastCompact.detectedPreset.toUpperCase()}
                  </span>
                )}
                <span className="nov-badge is-accent">
                  {t(dict.turbo.compressionSaved, { percent: savedRatio })}
                </span>
                {typeof lastCompact.linesBefore === 'number' && typeof lastCompact.linesAfter === 'number' && (
                  <span className="nov-badge">
                    {lastCompact.linesBefore} → {lastCompact.linesAfter}
                  </span>
                )}
                <span className="nov-badge is-offline">
                  {t(dict.turbo.savedTokens, {
                    tokens: lastCompact.estimatedSavedTokens,
                    ratio: savedRatio,
                  })}
                </span>
              </div>
            )}
          </div>

          {lastCompact && (
            <>
              <pre className="nov-p-pre">{lastCompact.summaryText}</pre>
              <div className="nov-p-row">
                <input
                  className="nov-p-input"
                  style={{ flex: 1 }}
                  value={chunkQuery}
                  placeholder={dict.turbo.queryChunkPlaceholder}
                  onChange={(e) => setChunkQuery(e.target.value)}
                />
                <button
                  type="button"
                  className="nov-p-btn"
                  disabled={busy}
                  onClick={() => void runChunkQuery(lastCompact.chunkId)}
                >
                  {dict.turbo.queryChunkBtn}
                </button>
              </div>
              {chunkHits && (
                <pre className="nov-p-pre">
                  {chunkHits.length > 0
                    ? chunkHits.map((h) => `[L${h.matchedLine}]\n${h.snippet}`).join('\n---\n')
                    : dict.common.empty}
                </pre>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
};
