import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NovBridge } from '../../bridge.js';
import { useNovI18n } from '../../i18n/index.js';
import './styles.css';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
}

type MemoryKind = 'architecture' | 'decision' | 'pitfall' | 'convention' | 'preference';
type MemSubTab = 'cards' | 'graph' | 'add' | 'injection';
type MemoryRecallMode = 'index' | 'timeline' | 'detail';

interface CodeAnchor {
  filePath: string;
  basename: string;
  uri: string;
  symbol?: string;
  sha256?: string;
  driftStatus?: 'fresh' | 'drifted' | 'missing' | 'untracked' | 'skipped';
}

interface MemoryItem {
  id: string;
  kind: MemoryKind;
  title: string;
  content: string;
  tags: string[];
  workspacePath?: string;
  sourceConversationId?: string;
  anchors: CodeAnchor[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  recallCount: number;
  drifted?: boolean;
  score?: number;
}

interface MemoryIndexEntry {
  id: string;
  kind: MemoryKind;
  title: string;
  pinned: boolean;
  drifted: boolean;
  tags: string[];
  anchors: Array<{
    basename: string;
    symbol?: string;
    driftStatus?: CodeAnchor['driftStatus'];
  }>;
  updatedAt: string;
  recallCount: number;
  score?: number;
}

interface MemoryTimelineEntry {
  id: string;
  kind: MemoryKind;
  title: string;
  excerpt: string;
  pinned: boolean;
  drifted: boolean;
  tags: string[];
  anchorFiles: string[];
  sourceConversationId?: string;
  createdAt: string;
  updatedAt: string;
  recallCount: number;
  isAnchorHit: boolean;
  score?: number;
}

interface MemoryProgressiveStats {
  activeCount: number;
  compactIndexChars: number;
  compactIndexTokens: number;
  fullDumpTokens: number;
  savedTokens: number;
  savedPercent: number;
}

interface MemoryProgressivePreview {
  indexText: string;
  entries: MemoryIndexEntry[];
}

interface GraphNode {
  id: string;
  kind: 'memory' | 'file' | 'tag';
  subKind?: MemoryKind;
  label: string;
  x: number;
  y: number;
  weight: number;
  drifted?: boolean;
  pinned?: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
  kind: 'anchors' | 'tagged';
}

interface MemoryGraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface MemPayload {
  initialTab?: MemSubTab;
  memories?: MemoryItem[];
  graph?: MemoryGraphPayload;
  injectionPreview?: string;
  progressiveStats?: MemoryProgressiveStats;
  progressivePreview?: MemoryProgressivePreview;
}

interface LayeredRecallPayload {
  mode?: MemoryRecallMode;
  query?: string;
  ids?: string[];
  window?: number;
  totalHits?: number;
  text?: string;
  indexEntries?: MemoryIndexEntry[];
  timelineEntries?: MemoryTimelineEntry[];
  detailItems?: Array<MemoryItem & { score?: number }>;
  progressiveStats?: MemoryProgressiveStats;
}

interface MemSearchPayload {
  hits?: Array<MemoryItem & { score?: number }>;
}

const KIND_COLOR: Record<MemoryKind, string> = {
  architecture: '#38bdf8',
  decision: '#10b981',
  pitfall: '#f43f5e',
  convention: '#a78bfa',
  preference: '#f59e0b',
};

function isMemSubTab(v: unknown): v is MemSubTab {
  return v === 'cards' || v === 'graph' || v === 'add' || v === 'injection';
}

export const MemPanel: React.FC<NovModulePanelProps> = ({
  bridge,
  active,
  onNotify,
  incomingEvent,
}) => {
  const { dict, t } = useNovI18n();
  const memDict = dict.panels.mem;

  const [tab, setTab] = useState<MemSubTab>('cards');
  const [data, setData] = useState<{
    memories: MemoryItem[];
    graph: MemoryGraphPayload;
    injectionPreview: string;
    progressiveStats?: MemoryProgressiveStats;
    progressivePreview?: MemoryProgressivePreview;
  } | null>(null);
  const [query, setQuery] = useState('');
  const [recallMode, setRecallMode] = useState<MemoryRecallMode>('detail');
  const [focusedIds, setFocusedIds] = useState<string[]>([]);
  const [layeredResult, setLayeredResult] = useState<LayeredRecallPayload | null>(null);
  const [searchHits, setSearchHits] = useState<Array<MemoryItem & { score?: number }> | null>(null);
  const [searching, setSearching] = useState(false);
  const [filterKind, setFilterKind] = useState<string>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [newKind, setNewKind] = useState<MemoryKind>('architecture');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');
  const [newAnchor, setNewAnchor] = useState('');
  const [newPinned, setNewPinned] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [localToast, setLocalToast] = useState<string | null>(null);

  const loadedOnceRef = useRef(false);
  const fetchSeqRef = useRef(0);
  const layeredSeqRef = useRef(0);
  const lastEventRef = useRef<typeof incomingEvent>(null);
  const toastTimerRef = useRef<number | null>(null);

  const notify = useCallback(
    (msg: string) => {
      if (onNotify) {
        onNotify(msg);
        return;
      }
      setLocalToast(msg);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setLocalToast(null), 2500);
    },
    [onNotify],
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const applyPayload = useCallback((res: MemPayload) => {
    if (!Array.isArray(res.memories)) return;
    setData({
      memories: res.memories,
      graph: res.graph ?? { nodes: [], edges: [] },
      injectionPreview: res.progressivePreview?.indexText ?? res.injectionPreview ?? '',
      progressiveStats: res.progressiveStats,
      progressivePreview: res.progressivePreview,
    });
    loadedOnceRef.current = true;
  }, []);

  const runLayeredRecall = useCallback(
    async (mode: MemoryRecallMode, rawQuery: string, ids: string[] = []) => {
      const seq = ++layeredSeqRef.current;
      const trimmed = rawQuery.trim();
      setSearching(true);
      setErrorMsg(null);
      try {
        const res = await bridge.callTool<LayeredRecallPayload>('app_mem_recall_layered', {
          query: trimmed,
          mode,
          ...(ids.length > 0 ? { ids } : {}),
          limit: 25,
          window: 2,
        });
        if (seq !== layeredSeqRef.current) return;
        setLayeredResult(res);
        if (mode === 'detail') {
          if (trimmed || ids.length > 0) {
            setSearchHits(Array.isArray(res.detailItems) ? res.detailItems : []);
          } else {
            setSearchHits(null);
          }
        }
      } catch (err) {
        if (seq !== layeredSeqRef.current) return;
        if (mode === 'detail' && trimmed && ids.length === 0) {
          try {
            const fallback = await bridge.callTool<MemSearchPayload>('app_mem_search', {
              query: trimmed,
            });
            if (seq !== layeredSeqRef.current) return;
            setSearchHits(Array.isArray(fallback.hits) ? fallback.hits : []);
            return;
          } catch {
            // surface original error below
          }
        }
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        if (seq === layeredSeqRef.current) setSearching(false);
      }
    },
    [bridge],
  );

  const refresh = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await bridge.callTool<MemPayload>('app_mem_get_state', {});
      if (seq !== fetchSeqRef.current) return;
      applyPayload(res);
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [bridge, applyPayload]);

  // Initial fetch when active
  useEffect(() => {
    if (!active) return;
    if (!loadedOnceRef.current) {
      void refresh();
    }
  }, [active, refresh]);

  // Respond to incoming tool result events
  useEffect(() => {
    if (!incomingEvent || incomingEvent === lastEventRef.current) return;
    const sc = incomingEvent.structuredContent;
    if (!sc || typeof sc !== 'object') return;

    const isMemTool =
      sc.novModule === 'mem' ||
      (typeof incomingEvent.toolName === 'string' && incomingEvent.toolName.includes('mem'));
    const hasMemShape =
      Array.isArray(sc.memories) ||
      isMemSubTab(sc.initialTab) ||
      typeof sc.graphNodeCount === 'number' ||
      typeof sc.anchorCount === 'number' ||
      typeof sc.deleted === 'boolean';

    if (!isMemTool && !hasMemShape) return;
    lastEventRef.current = incomingEvent;

    if (isMemSubTab(sc.initialTab)) {
      setTab(sc.initialTab);
    }
    if (Array.isArray(sc.memories)) {
      applyPayload(sc as unknown as MemPayload);
    } else if (active) {
      void refresh();
    }
  }, [incomingEvent, active, applyPayload, refresh]);

  const handleSelectRecallMode = (nextMode: MemoryRecallMode) => {
    setRecallMode(nextMode);
    if (nextMode !== 'detail') {
      setFocusedIds([]);
    }
    void runLayeredRecall(nextMode, query, nextMode === 'detail' ? focusedIds : []);
  };

  const handleInspectById = (id: string, targetMode: MemoryRecallMode = 'detail') => {
    setRecallMode(targetMode);
    setFocusedIds(targetMode === 'detail' ? [id] : []);
    void runLayeredRecall(targetMode, targetMode === 'detail' ? '' : query, [id]);
  };

  const handleServerSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = query.trim();
    setFocusedIds([]);
    if (!trimmed && recallMode === 'detail') {
      setSearchHits(null);
      setLayeredResult(null);
      return;
    }
    await runLayeredRecall(recallMode, trimmed, []);
  };

  const handleClearSearch = () => {
    setQuery('');
    setFocusedIds([]);
    setSearchHits(null);
    if (recallMode === 'detail') {
      setLayeredResult(null);
    } else {
      void runLayeredRecall(recallMode, '', []);
    }
  };

  const matchesKindFilter = useCallback(
    (item: { kind: MemoryKind; pinned: boolean; drifted?: boolean }) => {
      if (filterKind === 'pinned' && !item.pinned) return false;
      if (filterKind === 'drifted' && !item.drifted) return false;
      if (
        filterKind !== 'all' &&
        filterKind !== 'pinned' &&
        filterKind !== 'drifted' &&
        item.kind !== filterKind
      ) {
        return false;
      }
      return true;
    },
    [filterKind],
  );

  const filtered = useMemo(() => {
    const baseList = searchHits !== null ? searchHits : data?.memories ?? [];
    const q = searchHits !== null ? '' : query.trim().toLowerCase();
    return baseList.filter((m) => {
      if (!matchesKindFilter(m)) return false;
      if (q) {
        const hay = `${m.title} ${m.content} ${m.tags.join(' ')} ${m.anchors.map((a) => a.filePath).join(' ')}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    });
  }, [data?.memories, searchHits, matchesKindFilter, query]);

  const indexEntries = useMemo<MemoryIndexEntry[]>(() => {
    const rawEntries: MemoryIndexEntry[] =
      layeredResult?.mode === 'index' && Array.isArray(layeredResult.indexEntries)
        ? layeredResult.indexEntries
        : (data?.memories ?? []).map((m) => ({
            id: m.id,
            kind: m.kind,
            title: m.title,
            pinned: m.pinned,
            drifted: Boolean(m.drifted),
            tags: m.tags,
            anchors: m.anchors.map((a) => ({
              basename: a.basename,
              symbol: a.symbol,
              driftStatus: a.driftStatus,
            })),
            updatedAt: m.updatedAt,
            recallCount: m.recallCount,
            score: m.score,
          }));
    const q = layeredResult?.mode === 'index' ? '' : query.trim().toLowerCase();
    return rawEntries.filter((entry) => {
      if (!matchesKindFilter(entry)) return false;
      if (q) {
        const hay = `${entry.id} ${entry.title} ${entry.tags.join(' ')} ${entry.anchors.map((a) => a.basename).join(' ')}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    });
  }, [layeredResult, data?.memories, matchesKindFilter, query]);

  const timelineEntries = useMemo<MemoryTimelineEntry[]>(() => {
    const rawEntries: MemoryTimelineEntry[] =
      layeredResult?.mode === 'timeline' && Array.isArray(layeredResult.timelineEntries)
        ? layeredResult.timelineEntries
        : [...(data?.memories ?? [])]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((m) => ({
              id: m.id,
              kind: m.kind,
              title: m.title,
              excerpt: m.content.replace(/\s+/g, ' ').trim().slice(0, 120),
              pinned: m.pinned,
              drifted: Boolean(m.drifted),
              tags: m.tags,
              anchorFiles: m.anchors.map((a) => a.basename),
              sourceConversationId: m.sourceConversationId,
              createdAt: m.createdAt,
              updatedAt: m.updatedAt,
              recallCount: m.recallCount,
              isAnchorHit: false,
            }));
    return rawEntries.filter((entry) => matchesKindFilter(entry));
  }, [layeredResult, data?.memories, matchesKindFilter]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    const content = newContent.trim();
    if (title.length < 2 || content.length < 4) {
      notify('Title (min 2 chars) and content (min 4 chars) are required');
      return;
    }
    try {
      const res = await bridge.callTool<MemPayload>('app_mem_add_memory', {
        kind: newKind,
        title,
        content,
        tags: newTags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        anchorFiles: newAnchor
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        pinned: newPinned,
      });
      applyPayload(res);
      setSearchHits(null);
      setFocusedIds([]);
      if (recallMode !== 'detail') {
        void runLayeredRecall(recallMode, query, []);
      }
      setNewTitle('');
      setNewContent('');
      setNewTags('');
      setNewAnchor('');
      setTab('cards');
      notify('Saved code-anchored memory');
    } catch (err) {
      notify(`Failed to save memory: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleTogglePin = async (id: string) => {
    try {
      const res = await bridge.callTool<MemPayload>('app_mem_toggle_pin', { id });
      applyPayload(res);
      if (recallMode !== 'detail' || searchHits !== null || focusedIds.length > 0) {
        await runLayeredRecall(recallMode, query, focusedIds);
      }
    } catch (err) {
      notify(`Failed to toggle pin: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleReverifyDrift = async (id: string) => {
    try {
      const res = await bridge.callTool<MemPayload>('app_mem_reverify_drift', { id });
      applyPayload(res);
      if (recallMode !== 'detail' || searchHits !== null || focusedIds.length > 0) {
        await runLayeredRecall(recallMode, query, focusedIds);
      }
      notify('Re-verified file anchor hashes');
    } catch (err) {
      notify(`Failed to verify anchor: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      const res = await bridge.callTool<MemPayload>('app_mem_delete_memory', { id });
      applyPayload(res);
      if (searchHits !== null) {
        setSearchHits((prev) => (prev ? prev.filter((item) => item.id !== id) : null));
      }
      if (focusedIds.includes(id)) {
        const nextIds = focusedIds.filter((itemId) => itemId !== id);
        setFocusedIds(nextIds);
        if (nextIds.length === 0) setSearchHits(null);
      }
      if (recallMode !== 'detail') {
        void runLayeredRecall(recallMode, query, []);
      }
      if (selectedNodeId === id) setSelectedNodeId(null);
      notify('Deleted memory card');
    } catch (err) {
      notify(`Failed to delete memory: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleOpenAnchor = async (anchor: CodeAnchor) => {
    const target = anchor.uri || anchor.filePath;
    const ok = await bridge.openFile(target);
    notify(ok ? `Opened ${anchor.basename} in side pane` : 'Open file available in Side Pane mode');
  };

  const handleInjectContext = async (title: string, content: string) => {
    const mode = await bridge.updateModelContext(`[Memory Graph: ${title}]\n${content}`);
    notify(
      mode === 'context'
        ? `Injected "${title}" into next model context`
        : `Copied "${title}" to clipboard`,
    );
  };

  const selectedGraphNode = useMemo(() => {
    if (!selectedNodeId || !data) return null;
    return data.graph.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [selectedNodeId, data]);

  const selectedMemoryForNode = useMemo(() => {
    if (!selectedGraphNode || selectedGraphNode.kind !== 'memory' || !data) return null;
    return (
      data.memories.find(
        (m) => m.id === selectedGraphNode.id || `mem:${m.id}` === selectedGraphNode.id,
      ) ?? null
    );
  }, [selectedGraphNode, data]);

  const selectedAnchorForNode = useMemo(() => {
    if (!selectedGraphNode || selectedGraphNode.kind !== 'file' || !data) return null;
    for (const m of data.memories) {
      const hit = m.anchors.find(
        (a) =>
          a.filePath === selectedGraphNode.id ||
          `file:${a.filePath}` === selectedGraphNode.id ||
          a.basename === selectedGraphNode.label,
      );
      if (hit) return hit;
    }
    return null;
  }, [selectedGraphNode, data]);

  const memories = data?.memories ?? [];
  const driftedCount = memories.filter((m) => m.drifted).length;
  const pinnedCount = memories.filter((m) => m.pinned).length;
  const progressiveStats = data?.progressiveStats;
  const indexPreviewText = data?.progressivePreview?.indexText ?? data?.injectionPreview ?? '';
  const estimatedPreviewTokens =
    progressiveStats?.compactIndexTokens ?? Math.ceil(indexPreviewText.length / 4);

  return (
    <div className="mod-mem">
      <header className="mem-hdr">
        <div className="mem-brand">
          <span className="mem-logo">MG</span>
          <span>{memDict.title}</span>
          <span className="mem-badge is-purple">{dict.badgeOffline}</span>
          <span className="mem-badge is-info">{memDict.progressiveIndexBadge}</span>
        </div>
        <button
          type="button"
          className="mem-btn is-primary"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? dict.common.loading : dict.common.refresh}
        </button>
      </header>

      <nav className="mem-tabs" aria-label={memDict.title}>
        <button
          type="button"
          className={`mem-tab ${tab === 'cards' ? 'is-active' : ''}`}
          onClick={() => setTab('cards')}
        >
          {memDict.tabCards} ({memories.length})
        </button>
        <button
          type="button"
          className={`mem-tab ${tab === 'graph' ? 'is-active' : ''}`}
          onClick={() => setTab('graph')}
        >
          {memDict.tabGraph}
        </button>
        <button
          type="button"
          className={`mem-tab ${tab === 'add' ? 'is-active' : ''}`}
          onClick={() => setTab('add')}
        >
          {memDict.tabAdd}
        </button>
        <button
          type="button"
          className={`mem-tab ${tab === 'injection' ? 'is-active' : ''}`}
          onClick={() => setTab('injection')}
        >
          {memDict.tabInjection}
        </button>
      </nav>

      {errorMsg && (
        <div className="mem-error" role="alert">
          {errorMsg}
        </div>
      )}

      {!data ? (
        <div className="mem-card mem-muted">{dict.common.loading}</div>
      ) : (
        <>
          <div className="mem-kpi-grid">
            <div className="mem-card">
              <div className="mem-kpi-label">{memDict.tabCards}</div>
              <div className="mem-kpi-value">{memories.length}</div>
            </div>
            <div className="mem-card">
              <div className="mem-kpi-label">{memDict.tabInjection}</div>
              <div className="mem-kpi-value is-accent">{pinnedCount}</div>
            </div>
            <div className="mem-card">
              <div className="mem-kpi-label">{memDict.stale}</div>
              <div className={`mem-kpi-value ${driftedCount ? 'is-warn' : 'is-good'}`}>
                {driftedCount}
              </div>
            </div>
            <div className="mem-card">
              <div className="mem-kpi-label">{memDict.tabGraph}</div>
              <div className="mem-kpi-value is-purple">{data.graph.nodes.length}</div>
            </div>
          </div>

          {tab === 'cards' && (
            <div className="mem-stack">
              <form className="mem-row" onSubmit={(e) => void handleServerSearch(e)}>
                <input
                  className="mem-input mem-search-input"
                  placeholder={memDict.searchPlaceholder}
                  aria-label={memDict.searchPlaceholder}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    if (!e.target.value.trim()) {
                      setSearchHits(null);
                      setFocusedIds([]);
                      if (recallMode !== 'detail') {
                        void runLayeredRecall(recallMode, '', []);
                      }
                    }
                  }}
                />
                <button
                  type="submit"
                  className="mem-btn is-primary"
                  disabled={searching || (recallMode === 'detail' && !query.trim())}
                >
                  {searching ? dict.common.loading : dict.common.run}
                </button>
                {(searchHits !== null || focusedIds.length > 0 || query.trim().length > 0) && (
                  <button type="button" className="mem-btn" onClick={handleClearSearch}>
                    {dict.common.clear}
                    {searchHits !== null ? ` (${searchHits.length})` : ''}
                  </button>
                )}
                <select
                  className="mem-select mem-filter-select"
                  aria-label={memDict.tabCards}
                  value={filterKind}
                  onChange={(e) => setFilterKind(e.target.value)}
                >
                  <option value="all">{dict.categoryAll}</option>
                  <option value="pinned">Pinned Only</option>
                  <option value="drifted">{memDict.stale}</option>
                  <option value="architecture">Architecture</option>
                  <option value="decision">Decision</option>
                  <option value="pitfall">Pitfall</option>
                  <option value="convention">Convention</option>
                  <option value="preference">Preference</option>
                </select>
              </form>

              <div className="mem-row is-between">
                <div className="mem-tabs" role="group" aria-label={memDict.progressiveIndexBadge}>
                  <button
                    type="button"
                    aria-pressed={recallMode === 'index'}
                    className={`mem-tab ${recallMode === 'index' ? 'is-active' : ''}`}
                    onClick={() => handleSelectRecallMode('index')}
                  >
                    {memDict.recallModeIndex}
                  </button>
                  <button
                    type="button"
                    aria-pressed={recallMode === 'timeline'}
                    className={`mem-tab ${recallMode === 'timeline' ? 'is-active' : ''}`}
                    onClick={() => handleSelectRecallMode('timeline')}
                  >
                    {memDict.recallModeTimeline}
                  </button>
                  <button
                    type="button"
                    aria-pressed={recallMode === 'detail'}
                    className={`mem-tab ${recallMode === 'detail' ? 'is-active' : ''}`}
                    onClick={() => handleSelectRecallMode('detail')}
                  >
                    {memDict.recallModeDetail}
                  </button>
                </div>
                {focusedIds.length > 0 && (
                  <div className="mem-row">
                    <span className="mem-badge is-info">ID: {focusedIds.join(', ')}</span>
                    <button
                      type="button"
                      className="mem-btn"
                      onClick={() => {
                        setFocusedIds([]);
                        setSearchHits(null);
                      }}
                    >
                      {dict.common.clear}
                    </button>
                  </div>
                )}
              </div>

              {recallMode === 'index' &&
                (indexEntries.length === 0 ? (
                  <div className="mem-card mem-muted">{memDict.emptyMemories}</div>
                ) : (
                  <div className="mem-stack">
                    {indexEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className={`mem-item-card ${entry.drifted ? 'is-drifted' : ''}`}
                      >
                        <div className="mem-row is-between">
                          <div className="mem-row">
                            <span className="mem-badge">{entry.id}</span>
                            <span
                              className="mem-badge"
                              style={{
                                color: KIND_COLOR[entry.kind],
                                borderColor: KIND_COLOR[entry.kind],
                              }}
                            >
                              {entry.kind.toUpperCase()}
                            </span>
                            <strong>{entry.title}</strong>
                            {typeof entry.score === 'number' && (
                              <span className="mem-badge is-good">BM25 {entry.score.toFixed(2)}</span>
                            )}
                            {entry.pinned && <span className="mem-badge is-info">★</span>}
                            {entry.drifted ? (
                              <span className="mem-badge is-warn">⚠ {memDict.stale}</span>
                            ) : (
                              <span className="mem-badge is-good">✓ {memDict.fresh}</span>
                            )}
                          </div>
                          <div className="mem-row">
                            {entry.anchors.slice(0, 3).map((a) => (
                              <span key={`${entry.id}:${a.basename}`} className="mem-badge">
                                📄 {a.basename}
                              </span>
                            ))}
                            <button
                              type="button"
                              className="mem-btn"
                              onClick={() => handleInspectById(entry.id, 'timeline')}
                            >
                              {memDict.recallModeTimeline}
                            </button>
                            <button
                              type="button"
                              className="mem-btn is-primary"
                              onClick={() => handleInspectById(entry.id, 'detail')}
                            >
                              {memDict.recallModeDetail}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}

              {recallMode === 'timeline' &&
                (timelineEntries.length === 0 ? (
                  <div className="mem-card mem-muted">{memDict.emptyMemories}</div>
                ) : (
                  <div className="mem-stack">
                    {timelineEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className={`mem-item-card ${entry.drifted ? 'is-drifted' : ''}`}
                      >
                        <div className="mem-row is-between">
                          <div className="mem-row">
                            <span className="mem-badge">{entry.updatedAt.slice(0, 19).replace('T', ' ')}</span>
                            {entry.isAnchorHit && <span className="mem-badge is-info">★ HIT</span>}
                            <span className="mem-badge">{entry.id}</span>
                            <span
                              className="mem-badge"
                              style={{
                                color: KIND_COLOR[entry.kind],
                                borderColor: KIND_COLOR[entry.kind],
                              }}
                            >
                              {entry.kind.toUpperCase()}
                            </span>
                            <strong>{entry.title}</strong>
                            {typeof entry.score === 'number' && (
                              <span className="mem-badge is-good">BM25 {entry.score.toFixed(2)}</span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="mem-btn is-primary"
                            onClick={() => handleInspectById(entry.id, 'detail')}
                          >
                            {memDict.recallModeDetail}
                          </button>
                        </div>
                        <div className="mem-muted">{entry.excerpt}</div>
                        <div className="mem-row">
                          {entry.anchorFiles.map((file) => (
                            <span key={`${entry.id}:${file}`} className="mem-badge">
                              📄 {file}
                            </span>
                          ))}
                          {entry.sourceConversationId && (
                            <span className="mem-badge is-purple">
                              session:{entry.sourceConversationId.slice(0, 12)}
                            </span>
                          )}
                          {entry.tags.map((tag) => (
                            <span key={`${entry.id}:#${tag}`} className="mem-badge">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}

              {recallMode === 'detail' &&
                (filtered.length === 0 ? (
                  <div className="mem-card mem-muted">{memDict.emptyMemories}</div>
                ) : (
                  filtered.map((m) => (
                    <div key={m.id} className={`mem-item-card ${m.drifted ? 'is-drifted' : ''}`}>
                      <div className="mem-row is-between">
                        <div className="mem-row">
                          <span
                            className="mem-badge"
                            style={{ color: KIND_COLOR[m.kind], borderColor: KIND_COLOR[m.kind] }}
                          >
                            {m.kind.toUpperCase()}
                          </span>
                          <strong>{m.title}</strong>
                          <span className="mem-badge">{m.id}</span>
                          {typeof m.score === 'number' && (
                            <span className="mem-badge is-good">BM25 {m.score.toFixed(2)}</span>
                          )}
                          {m.pinned && <span className="mem-badge is-info">★ PINNED</span>}
                          {m.drifted ? (
                            <span className="mem-badge is-warn">⚠ {memDict.stale}</span>
                          ) : (
                            <span className="mem-badge is-good">✓ {memDict.fresh}</span>
                          )}
                        </div>
                        <div className="mem-row">
                          <button
                            type="button"
                            className="mem-btn is-primary"
                            onClick={() => void handleInjectContext(m.title, m.content)}
                          >
                            {memDict.injectContext}
                          </button>
                          <button
                            type="button"
                            className="mem-btn"
                            onClick={() => void handleTogglePin(m.id)}
                          >
                            {m.pinned ? 'Unpin' : 'Pin'}
                          </button>
                          {m.drifted && (
                            <button
                              type="button"
                              className="mem-btn"
                              onClick={() => void handleReverifyDrift(m.id)}
                            >
                              Verify
                            </button>
                          )}
                          <button
                            type="button"
                            className="mem-btn"
                            aria-label={`${memDict.forget}: ${m.title}`}
                            onClick={() => void handleDeleteMemory(m.id)}
                          >
                            {memDict.forget}
                          </button>
                        </div>
                      </div>
                      <div className="mem-content">{m.content}</div>
                      <div className="mem-row">
                        {m.anchors.map((a) => (
                          <button
                            key={`${a.filePath}:${a.symbol ?? ''}`}
                            type="button"
                            className={`mem-anchor-chip ${
                              a.driftStatus === 'drifted' || a.driftStatus === 'missing'
                                ? 'is-drifted'
                                : ''
                            }`}
                            title={`${a.filePath} (${a.driftStatus ?? 'tracked'}) — click to open in side pane`}
                            onClick={() => void handleOpenAnchor(a)}
                          >
                            📄 {a.basename}
                            {a.symbol ? `::${a.symbol}` : ''}
                          </button>
                        ))}
                        {m.tags.map((tag) => (
                          <span key={tag} className="mem-badge">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
                ))}
            </div>
          )}

          {tab === 'graph' && (
            <div className="mem-card">
              <div className="mem-row is-between" style={{ marginBottom: 8 }}>
                <strong>{memDict.tabGraph}</strong>
                <span className="mem-badge">{memDict.title}</span>
              </div>
              <svg viewBox="0 0 680 400" className="mem-graph-svg">
                {data.graph.edges.map((e, idx) => {
                  const s = data.graph.nodes.find((n) => n.id === e.source);
                  const tgt = data.graph.nodes.find((n) => n.id === e.target);
                  if (!s || !tgt) return null;
                  const hi =
                    selectedNodeId !== null &&
                    (e.source === selectedNodeId || e.target === selectedNodeId);
                  return (
                    <line
                      key={idx}
                      x1={s.x}
                      y1={s.y}
                      x2={tgt.x}
                      y2={tgt.y}
                      stroke={e.kind === 'anchors' ? '#38bdf8' : '#a78bfa'}
                      strokeOpacity={hi ? 0.95 : 0.3}
                      strokeWidth={hi ? 2.2 : 1.2}
                      strokeDasharray={e.kind === 'tagged' ? '4 3' : undefined}
                    />
                  );
                })}
                {data.graph.nodes.map((n) => {
                  const color =
                    n.kind === 'memory'
                      ? n.drifted
                        ? '#f59e0b'
                        : KIND_COLOR[n.subKind ?? 'decision']
                      : n.kind === 'file'
                        ? '#38bdf8'
                        : '#94a3b8';
                  const r = n.kind === 'memory' ? 11 : n.kind === 'file' ? 8 : 6;
                  const isSelected = selectedNodeId === n.id;
                  return (
                    <g
                      key={n.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSelectedNodeId(isSelected ? null : n.id)}
                    >
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={isSelected ? r + 2.5 : r}
                        fill={color}
                        stroke={isSelected ? 'var(--nov-text-0)' : 'var(--nov-bg-1)'}
                        strokeWidth={isSelected ? 2.5 : 2}
                      />
                      <text
                        x={n.x}
                        y={n.y + r + 12}
                        textAnchor="middle"
                        fill="var(--nov-text-0)"
                        fontSize="9.5"
                        fontFamily="var(--nov-font-mono)"
                      >
                        {n.label}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {selectedGraphNode && (
                <div className="mem-graph-inspector">
                  <div className="mem-row is-between">
                    <div className="mem-row">
                      <span className="mem-badge is-info">{selectedGraphNode.kind.toUpperCase()}</span>
                      <strong>{selectedGraphNode.label}</strong>
                    </div>
                    <button
                      type="button"
                      className="mem-btn"
                      onClick={() => setSelectedNodeId(null)}
                    >
                      {dict.common.clear}
                    </button>
                  </div>
                  {selectedMemoryForNode && (
                    <>
                      <div className="mem-content">{selectedMemoryForNode.content}</div>
                      <div className="mem-row">
                        <button
                          type="button"
                          className="mem-btn is-primary"
                          onClick={() =>
                            void handleInjectContext(
                              selectedMemoryForNode.title,
                              selectedMemoryForNode.content,
                            )
                          }
                        >
                          {memDict.injectContext}
                        </button>
                        {selectedMemoryForNode.anchors.map((a) => (
                          <button
                            key={a.filePath}
                            type="button"
                            className="mem-anchor-chip"
                            onClick={() => void handleOpenAnchor(a)}
                          >
                            📄 {a.basename}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {selectedAnchorForNode && (
                    <div className="mem-row is-between">
                      <span className="mem-muted">{selectedAnchorForNode.filePath}</span>
                      <button
                        type="button"
                        className="mem-btn is-primary"
                        onClick={() => void handleOpenAnchor(selectedAnchorForNode)}
                      >
                        {dict.panels.canvas.openFile}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'add' && (
            <form className="mem-card mem-stack" onSubmit={(e) => void handleAdd(e)}>
              <strong>{memDict.tabAdd}</strong>
              <select
                className="mem-select"
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as MemoryKind)}
              >
                <option value="architecture">Architecture</option>
                <option value="decision">Decision</option>
                <option value="pitfall">Pitfall / Root Cause</option>
                <option value="convention">Convention</option>
                <option value="preference">Preference</option>
              </select>
              <input
                className="mem-input"
                placeholder="Short title (e.g. Redis Pipeline Batching Rule)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <textarea
                className="mem-textarea"
                rows={3}
                placeholder="Concise, actionable truth the agent should always remember..."
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
              />
              <div className="mem-row" role="note">
                <span className="mem-badge is-purple">&lt;private&gt;</span>
                <span className="mem-muted">{memDict.privateTagHint}</span>
              </div>
              <input
                className="mem-input"
                placeholder="Tags (comma-separated, e.g. redis, checkout)"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
              />
              <input
                className="mem-input"
                placeholder="Anchored file path(s) (comma-separated, optional)"
                value={newAnchor}
                onChange={(e) => setNewAnchor(e.target.value)}
              />
              <label className="mem-checkbox-row">
                <input
                  type="checkbox"
                  checked={newPinned}
                  onChange={(e) => setNewPinned(e.target.checked)}
                />
                {memDict.tabInjection}
              </label>
              <button type="submit" className="mem-btn is-primary">
                {memDict.addMemory}
              </button>
            </form>
          )}

          {tab === 'injection' && (
            <div className="mem-card mem-stack">
              <div className="mem-row is-between">
                <div className="mem-row">
                  <strong>{memDict.tabInjection}</strong>
                  <span className="mem-badge is-info">{memDict.progressiveIndexBadge}</span>
                </div>
                {indexPreviewText && (
                  <button
                    type="button"
                    className="mem-btn is-primary"
                    onClick={() =>
                      void handleInjectContext('SessionStart Injection', indexPreviewText)
                    }
                  >
                    {memDict.injectContext}
                  </button>
                )}
              </div>
              <div className="mem-row">
                <span className="mem-badge is-info">
                  {t(memDict.tokenSavingsNote, { tokens: estimatedPreviewTokens })}
                </span>
                {progressiveStats && progressiveStats.fullDumpTokens > 0 && (
                  <span className="mem-badge is-good">
                    -{progressiveStats.savedPercent}% (-{progressiveStats.savedTokens} /{' '}
                    {progressiveStats.fullDumpTokens} tok)
                  </span>
                )}
                {progressiveStats && (
                  <span className="mem-muted">
                    {progressiveStats.activeCount} active · {progressiveStats.compactIndexChars} chars
                  </span>
                )}
              </div>
              <div className="mem-prebox">{indexPreviewText || memDict.emptyMemories}</div>
            </div>
          )}
        </>
      )}

      {!onNotify && localToast && <div className="mem-toast">{localToast}</div>}
    </div>
  );
};
