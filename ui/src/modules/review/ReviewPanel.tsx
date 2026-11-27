import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HostCapabilitiesSummary, NovBridge } from '../../bridge.js';
import { useNovI18n } from '../../i18n/index.js';
import { DiffViewer } from './DiffViewer';
import { FileTree } from './FileTree';
import { HeaderBar } from './HeaderBar';
import { ReviewCart } from './ReviewCart';
import {
  buildLocalReviewPrompt,
  type AnnotationCategory,
  type AnnotationSide,
  type BuiltReviewPrompt,
  type DiffQuery,
  type DiffViewMode,
  type FileFilterMode,
  type ReviewAnnotation,
  type ReviewScope,
  type ReviewSession,
} from './types';
import './styles.css';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
}

const VALID_SCOPES = new Set<ReviewScope>(['working', 'staged', 'unstaged', 'head~1', 'commit-range']);

function isReviewSessionLike(val: unknown): val is ReviewSession {
  return Boolean(
    val &&
      typeof val === 'object' &&
      'repoKey' in val &&
      Array.isArray((val as ReviewSession).files) &&
      Array.isArray((val as ReviewSession).annotations),
  );
}

export const ReviewPanel: React.FC<NovModulePanelProps> = ({
  bridge,
  active,
  onNotify,
  incomingEvent,
}) => {
  const { dict } = useNovI18n();
  const r = dict.panels.review;

  const rootRef = useRef<HTMLDivElement>(null);
  const loadedOnceRef = useRef(false);
  const requestSeqRef = useRef(0);
  const lastEventRef = useRef<typeof incomingEvent>(null);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => bridge.getTheme());
  const [caps, setCaps] = useState<HostCapabilitiesSummary>(() => bridge.getCapabilities());

  const [session, setSession] = useState<ReviewSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hostNotice, setHostNotice] = useState<string | null>(null);

  const [repoPath, setRepoPath] = useState<string | undefined>(undefined);
  const [demoMode, setDemoMode] = useState<boolean | undefined>(undefined);
  const [scope, setScope] = useState<ReviewScope>('working');
  const [commitRange, setCommitRange] = useState('HEAD~1..HEAD');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<DiffViewMode>('unified');
  const [filterMode, setFilterMode] = useState<FileFilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [syntaxHighlight, setSyntaxHighlight] = useState(true);

  const [compact, setCompact] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 720 : false,
  );
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 720 : true,
  );

  const [previewMarkdown, setPreviewMarkdown] = useState('');

  // Sync theme and host capabilities with shared NovBridge
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

  // Responsive container observer for Aux Pane (~460-480px) vs wide sidebar
  useEffect(() => {
    const updateWidth = (w: number) => {
      const nextCompact = w < 720;
      setCompact((prev) => {
        if (prev !== nextCompact) {
          setSidebarOpen(!nextCompact);
        }
        return nextCompact;
      });
    };

    const el = rootRef.current;
    if (el && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (typeof width === 'number' && width > 0) {
          updateWidth(width);
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    }

    const onResize = () => updateWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const loadDiff = useCallback(
    async (query: DiffQuery, preferredFile?: string) => {
      const seq = ++requestSeqRef.current;
      loadedOnceRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const args: Record<string, unknown> = {};
        if (query.repoPath) args.repoPath = query.repoPath;
        if (query.scope) args.scope = query.scope;
        if (query.commitRange) args.commitRange = query.commitRange;
        if (query.ignoreWhitespace !== undefined) args.ignoreWhitespace = query.ignoreWhitespace;
        if (query.demo !== undefined) args.demo = query.demo;

        const raw = await bridge.callTool<{ session?: ReviewSession } | ReviewSession>(
          'app_review_get_diff',
          args,
        );
        if (seq !== requestSeqRef.current) return;

        const nextSession =
          raw && typeof raw === 'object' && 'session' in raw && isReviewSessionLike(raw.session)
            ? raw.session
            : isReviewSessionLike(raw)
              ? raw
              : null;

        if (!nextSession) {
          throw new Error('Unexpected response format from app_review_get_diff');
        }

        setSession(nextSession);
        setScope(nextSession.scope);
        if (nextSession.commitRange) setCommitRange(nextSession.commitRange);
        if (typeof nextSession.ignoreWhitespace === 'boolean') {
          setIgnoreWhitespace(nextSession.ignoreWhitespace);
        }
        setRepoPath(nextSession.isDemo ? undefined : nextSession.repoPath);
        setDemoMode(nextSession.isDemo);

        setSelectedFile((prev) => {
          if (preferredFile && nextSession.files.some((f) => f.path === preferredFile)) {
            return preferredFile;
          }
          if (prev && nextSession.files.some((f) => f.path === prev)) {
            return prev;
          }
          return nextSession.files[0]?.path ?? null;
        });
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [bridge],
  );

  // Hydrate on first activation
  useEffect(() => {
    if (active && !loadedOnceRef.current) {
      void loadDiff({});
    }
  }, [active, loadDiff]);

  // React to incoming tool results directed at Review
  useEffect(() => {
    if (!incomingEvent || incomingEvent === lastEventRef.current) return;
    const sc = incomingEvent.structuredContent;
    if (!sc || typeof sc !== 'object') return;

    const toolName = incomingEvent.toolName ?? '';
    const launch =
      sc.launch && typeof sc.launch === 'object'
        ? (sc.launch as {
            repoPath?: string;
            scope?: string;
            commitRange?: string;
            ignoreWhitespace?: boolean;
            selectedFile?: string;
            demo?: boolean;
          })
        : null;

    if (launch) {
      lastEventRef.current = incomingEvent;
      const nextScope =
        launch.scope && VALID_SCOPES.has(launch.scope as ReviewScope)
          ? (launch.scope as ReviewScope)
          : 'working';
      const nextIgnoreWs =
        typeof launch.ignoreWhitespace === 'boolean' ? launch.ignoreWhitespace : ignoreWhitespace;
      if (typeof launch.ignoreWhitespace === 'boolean') {
        setIgnoreWhitespace(launch.ignoreWhitespace);
      }
      void loadDiff(
        {
          repoPath: launch.demo ? undefined : launch.repoPath,
          scope: nextScope,
          commitRange: launch.commitRange,
          ignoreWhitespace: nextIgnoreWs,
          demo: launch.demo,
        },
        launch.selectedFile,
      );
      return;
    }

    if (isReviewSessionLike(sc.session)) {
      lastEventRef.current = incomingEvent;
      loadedOnceRef.current = true;
      const nextSession = sc.session;
      setSession(nextSession);
      setScope(nextSession.scope);
      if (nextSession.commitRange) setCommitRange(nextSession.commitRange);
      if (typeof nextSession.ignoreWhitespace === 'boolean') {
        setIgnoreWhitespace(nextSession.ignoreWhitespace);
      }
      setRepoPath(nextSession.isDemo ? undefined : nextSession.repoPath);
      setDemoMode(nextSession.isDemo);
      setSelectedFile((prev) =>
        prev && nextSession.files.some((f) => f.path === prev)
          ? prev
          : nextSession.files[0]?.path ?? null,
      );
      return;
    }

    if (toolName.includes('review')) {
      lastEventRef.current = incomingEvent;
      void loadDiff({
        repoPath,
        scope,
        commitRange: scope === 'commit-range' ? commitRange : undefined,
        ignoreWhitespace,
        demo: demoMode,
      });
    }
  }, [incomingEvent, loadDiff, repoPath, scope, commitRange, ignoreWhitespace, demoMode]);

  const viewedSet = useMemo(() => new Set(session?.viewedFiles ?? []), [session?.viewedFiles]);

  const openCountByFile = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of session?.annotations ?? []) {
      if (!a.resolved) {
        map.set(a.filePath, (map.get(a.filePath) ?? 0) + 1);
      }
    }
    return map;
  }, [session?.annotations]);

  const filteredFiles = useMemo(() => {
    const list = session?.files ?? [];
    const q = searchQuery.trim().toLowerCase();
    return list.filter((f) => {
      if (
        q &&
        !f.path.toLowerCase().includes(q) &&
        !(f.oldPath?.toLowerCase().includes(q) ?? false)
      ) {
        return false;
      }
      if (filterMode === 'annotated') {
        return (openCountByFile.get(f.path) ?? 0) > 0;
      }
      if (filterMode === 'unviewed') {
        return !viewedSet.has(f.path);
      }
      if (filterMode === 'risky') {
        const hasRiskLine = f.hunks.some((h) => h.lines.some((l) => Boolean(l.riskHint)));
        return hasRiskLine || f.riskTags.includes('security-sensitive') || f.riskTags.includes('large');
      }
      return true;
    });
  }, [session?.files, searchQuery, filterMode, openCountByFile, viewedSet]);

  useEffect(() => {
    if (filteredFiles.length === 0) return;
    if (!selectedFile || !filteredFiles.some((f) => f.path === selectedFile)) {
      setSelectedFile(filteredFiles[0].path);
    }
  }, [filteredFiles, selectedFile]);

  const activeFile = useMemo(
    () => (session?.files ?? []).find((f) => f.path === selectedFile) ?? null,
    [session?.files, selectedFile],
  );

  const activeFileAnnotations = useMemo(
    () => (session?.annotations ?? []).filter((a) => a.filePath === activeFile?.path),
    [session?.annotations, activeFile?.path],
  );

  // Instant local prompt preview; authoritative server prompt is fetched on Preview / Send / Copy
  useEffect(() => {
    if (!session) {
      setPreviewMarkdown('');
      return;
    }
    setPreviewMarkdown(buildLocalReviewPrompt(session));
  }, [session]);

  const handleScopeChange = (nextScope: ReviewScope) => {
    setScope(nextScope);
    if (nextScope !== 'commit-range') {
      void loadDiff({
        repoPath,
        scope: nextScope,
        ignoreWhitespace,
        demo: demoMode,
      });
    }
  };

  const handleCommitRangeApply = () => {
    void loadDiff({
      repoPath,
      scope: 'commit-range',
      commitRange,
      ignoreWhitespace,
      demo: demoMode,
    });
  };

  const handleToggleIgnoreWhitespace = () => {
    const next = !ignoreWhitespace;
    setIgnoreWhitespace(next);
    void loadDiff({
      repoPath,
      scope,
      commitRange: scope === 'commit-range' ? commitRange : undefined,
      ignoreWhitespace: next,
      demo: demoMode,
    });
  };

  const handleRefresh = () => {
    void loadDiff({
      repoPath,
      scope,
      commitRange: scope === 'commit-range' ? commitRange : undefined,
      ignoreWhitespace,
      demo: demoMode,
    });
  };

  const handleAddAnnotation = async (input: {
    filePath: string;
    side: AnnotationSide;
    startLine: number;
    endLine: number;
    category: AnnotationCategory;
    comment: string;
    codeSnippet: string;
    fileFingerprint: string;
  }) => {
    if (!session) return;
    try {
      const res = await bridge.callTool<{ annotations?: ReviewAnnotation[] }>(
        'app_review_add_annotation',
        {
          repoKey: session.repoKey,
          scope: session.scope,
          ...input,
        },
      );
      if (Array.isArray(res.annotations)) {
        setSession((prev) => (prev ? { ...prev, annotations: res.annotations! } : prev));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to save annotation: ${msg}`);
    }
  };

  const handleUpdateAnnotation = async (
    id: string,
    category: AnnotationCategory,
    comment: string,
  ) => {
    if (!session) return;
    try {
      const res = await bridge.callTool<{ annotations?: ReviewAnnotation[] }>(
        'app_review_update_annotation',
        {
          repoKey: session.repoKey,
          scope: session.scope,
          id,
          category,
          comment,
        },
      );
      if (Array.isArray(res.annotations)) {
        setSession((prev) => (prev ? { ...prev, annotations: res.annotations! } : prev));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to update annotation: ${msg}`);
    }
  };

  const handleToggleResolve = async (id: string) => {
    if (!session) return;
    try {
      const res = await bridge.callTool<{ annotations?: ReviewAnnotation[] }>(
        'app_review_toggle_resolve',
        {
          repoKey: session.repoKey,
          scope: session.scope,
          id,
        },
      );
      if (Array.isArray(res.annotations)) {
        setSession((prev) => (prev ? { ...prev, annotations: res.annotations! } : prev));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to toggle resolve: ${msg}`);
    }
  };

  const handleDeleteAnnotation = async (id: string) => {
    if (!session) return;
    try {
      const res = await bridge.callTool<{ annotations?: ReviewAnnotation[] }>(
        'app_review_delete_annotation',
        {
          repoKey: session.repoKey,
          scope: session.scope,
          id,
        },
      );
      if (Array.isArray(res.annotations)) {
        setSession((prev) => (prev ? { ...prev, annotations: res.annotations! } : prev));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to delete annotation: ${msg}`);
    }
  };

  const handleClearResolved = async () => {
    if (!session) return;
    try {
      const res = await bridge.callTool<{ annotations?: ReviewAnnotation[] }>(
        'app_review_clear_resolved',
        {
          repoKey: session.repoKey,
          scope: session.scope,
        },
      );
      if (Array.isArray(res.annotations)) {
        setSession((prev) => (prev ? { ...prev, annotations: res.annotations! } : prev));
        onNotify?.(r.cartClear);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to clear resolved annotations: ${msg}`);
    }
  };

  const handleToggleViewed = async (filePath: string, next: boolean) => {
    if (!session) return;
    try {
      const res = await bridge.callTool<{ viewedFiles?: string[] }>('app_review_mark_file_viewed', {
        repoKey: session.repoKey,
        scope: session.scope,
        filePath,
        viewed: next,
      });
      if (Array.isArray(res.viewedFiles)) {
        setSession((prev) => (prev ? { ...prev, viewedFiles: res.viewedFiles! } : prev));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to update viewed state: ${msg}`);
    }
  };

  const handleRefreshPreview = async (): Promise<string> => {
    if (!session) return previewMarkdown;
    try {
      const args: Record<string, unknown> = {
        scope: session.scope,
      };
      if (!session.isDemo && session.repoPath) args.repoPath = session.repoPath;
      if (session.commitRange) args.commitRange = session.commitRange;
      if (ignoreWhitespace) args.ignoreWhitespace = true;
      if (session.isDemo !== undefined) args.demo = session.isDemo;

      const built = await bridge.callTool<BuiltReviewPrompt>('app_review_build_prompt', args);
      if (typeof built?.markdown === 'string') {
        setPreviewMarkdown(built.markdown);
        return built.markdown;
      }
      return previewMarkdown;
    } catch {
      return previewMarkdown;
    }
  };

  const handleOpenInHost = async (absolutePath: string) => {
    const ok = await bridge.openFile(absolutePath);
    if (ok) {
      onNotify?.(`Opened ${absolutePath.split('/').pop() || absolutePath}`);
      return;
    }
    const msg = 'Side-pane file opening is unavailable in this host surface.';
    setHostNotice(msg);
    onNotify?.(msg);
    window.setTimeout(() => {
      setHostNotice((curr) => (curr === msg ? null : curr));
    }, 3500);
  };

  const viewedCount = useMemo(() => {
    if (!session) return 0;
    return session.files.filter((f) => viewedSet.has(f.path)).length;
  }, [session, viewedSet]);

  const openAnnotationsCount = useMemo(() => {
    if (!session) return 0;
    return session.annotations.filter((a) => !a.resolved).length;
  }, [session]);

  const handleQuickCopyPrompt = async () => {
    if (openAnnotationsCount === 0) return;
    const md = await handleRefreshPreview();
    try {
      await navigator.clipboard?.writeText(md);
      onNotify?.(dict.common.copied);
    } catch {
      onNotify?.(r.copyPrompt);
    }
  };

  const handleQuickSendFixes = async () => {
    if (openAnnotationsCount === 0) return;
    const md = await handleRefreshPreview();
    await bridge.sendMessage(md);
    onNotify?.(r.sendFixes);
  };

  const canToggleAuxPane = caps.isWorkbench || caps.message || caps.updateModelContext;

  return (
    <div ref={rootRef} className="mod-review" data-theme={theme}>
      <HeaderBar
        repoName={session?.repoName ?? r.title}
        branch={session?.branch ?? '…'}
        isDemo={Boolean(session?.isDemo)}
        scope={scope}
        commitRange={commitRange}
        searchQuery={searchQuery}
        viewMode={viewMode}
        filterMode={filterMode}
        ignoreWhitespace={ignoreWhitespace}
        syntaxHighlight={syntaxHighlight}
        viewedCount={viewedCount}
        totalFiles={session?.totalFiles ?? 0}
        totalAdditions={session?.totalAdditions ?? 0}
        totalDeletions={session?.totalDeletions ?? 0}
        loading={loading}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onScopeChange={handleScopeChange}
        onCommitRangeChange={setCommitRange}
        onCommitRangeApply={handleCommitRangeApply}
        onSearchChange={setSearchQuery}
        onViewModeChange={setViewMode}
        onFilterModeChange={setFilterMode}
        onToggleIgnoreWhitespace={handleToggleIgnoreWhitespace}
        onToggleSyntaxHighlight={() => setSyntaxHighlight((v) => !v)}
        onRefresh={handleRefresh}
      />

      {error && (
        <div className="rv-banner rv-banner-error">
          <span>{error}</span>
          <button type="button" className="rv-link-btn" onClick={handleRefresh}>
            {dict.retry}
          </button>
        </div>
      )}

      {hostNotice && (
        <div className="rv-banner rv-banner-info">
          <span>{hostNotice}</span>
          <button type="button" className="rv-link-btn" onClick={() => setHostNotice(null)}>
            {dict.common.clear}
          </button>
        </div>
      )}

      {session?.notice && (
        <div className="rv-banner rv-banner-info">
          <span>{session.notice}</span>
          {!session.isGitRepo && (
            <button
              type="button"
              className="rv-btn rv-btn-subtle"
              onClick={() => void loadDiff({ demo: true, scope: 'working' })}
            >
              {dict.demoFixture}
            </button>
          )}
        </div>
      )}

      {session?.truncated && (
        <div className="rv-banner rv-banner-warn">
          <span>{dict.panels.studio.truncatedNotice}</span>
        </div>
      )}

      {openAnnotationsCount > 0 && (
        <div className="rv-banner rv-banner-info">
          <span>
            {r.annotations}: <strong>{openAnnotationsCount}</strong>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="rv-btn rv-btn-subtle"
              onClick={() => void handleQuickCopyPrompt()}
            >
              {r.copyPrompt}
            </button>
            {(caps.message || caps.isWorkbench) && (
              <button
                type="button"
                className="rv-btn rv-btn-primary"
                onClick={() => void handleQuickSendFixes()}
              >
                {r.sendFixes}
              </button>
            )}
          </div>
        </div>
      )}

      <main className={`rv-studio-body ${compact ? 'is-compact' : ''}`}>
        <FileTree
          files={filteredFiles}
          selectedPath={selectedFile}
          viewedSet={viewedSet}
          openCountByFile={openCountByFile}
          canToggleAuxPane={canToggleAuxPane}
          compact={compact}
          open={sidebarOpen}
          onSelectFile={setSelectedFile}
          onToggleViewed={handleToggleViewed}
          onOpenInHost={handleOpenInHost}
          onCloseDrawer={() => setSidebarOpen(false)}
        />

        {loading && !session ? (
          <section className="rv-diff-pane rv-diff-empty">
            <div className="rv-empty-state">
              <div className="rv-loader-ring" />
              <p>{dict.common.loading}</p>
            </div>
          </section>
        ) : session && session.files.length === 0 ? (
          <section className="rv-diff-pane rv-diff-empty">
            <div className="rv-empty-state">
              <div className="rv-empty-icon">✓</div>
              <h3>{r.title}</h3>
              <p>{r.noChanges}</p>
              <button type="button" className="rv-btn rv-btn-subtle" onClick={handleRefresh}>
                {r.refresh}
              </button>
            </div>
          </section>
        ) : (
          <DiffViewer
            file={activeFile}
            viewMode={viewMode}
            syntaxHighlight={syntaxHighlight}
            viewed={activeFile ? viewedSet.has(activeFile.path) : false}
            canToggleAuxPane={canToggleAuxPane}
            annotations={activeFileAnnotations}
            onToggleViewed={(next) => {
              if (activeFile) void handleToggleViewed(activeFile.path, next);
            }}
            onOpenInHost={handleOpenInHost}
            onAddAnnotation={handleAddAnnotation}
            onUpdateAnnotation={handleUpdateAnnotation}
            onToggleResolve={handleToggleResolve}
            onDeleteAnnotation={handleDeleteAnnotation}
          />
        )}
      </main>

      <ReviewCart
        annotations={session?.annotations ?? []}
        previewMarkdown={previewMarkdown}
        canSendMessage={caps.message || caps.isWorkbench}
        canUpdateContext={caps.updateModelContext || caps.isWorkbench}
        onRefreshPreview={handleRefreshPreview}
        onSendToAgent={(md) => bridge.sendMessage(md)}
        onAttachToNextTurn={(md) => bridge.updateModelContext(md)}
        onClearResolved={handleClearResolved}
        onNotify={onNotify}
      />
    </div>
  );
};
