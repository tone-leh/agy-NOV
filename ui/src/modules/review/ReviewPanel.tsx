import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ModuleId } from '../../../../src/core/catalog.js';
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
  type Stage1ChecklistItem,
} from './types';
import './styles.css';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
  onNavigateModule?: (moduleId: ModuleId, context?: { worktreePath?: string; branch?: string }) => void;
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
  onNavigateModule,
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
  const [worktreePath, setWorktreePath] = useState<string | undefined>(undefined);
  const [demoMode, setDemoMode] = useState<boolean | undefined>(undefined);
  const [scope, setScope] = useState<ReviewScope>('working');
  const [commitRange, setCommitRange] = useState('HEAD~1..HEAD');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [twoStageOpen, setTwoStageOpen] = useState(false);
  const [stage1Overrides, setStage1Overrides] = useState<Record<string, boolean>>({});
  const lastSpecIdRef = useRef<string | null>(null);

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
        if (query.worktreePath) args.worktreePath = query.worktreePath;
        else if (query.repoPath) args.repoPath = query.repoPath;
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
        setWorktreePath(nextSession.repoPath);
        setDemoMode(nextSession.isDemo);

        const nextSpecId = nextSession.specCompliance?.specId ?? null;
        if (nextSpecId !== lastSpecIdRef.current) {
          lastSpecIdRef.current = nextSpecId;
          setStage1Overrides({});
          if (nextSpecId) {
            setTwoStageOpen(true);
          }
        }

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

  // React to incoming tool results or navigation events directed at Review
  useEffect(() => {
    if (!incomingEvent || incomingEvent === lastEventRef.current) return;
    const sc = incomingEvent.structuredContent;
    if (!sc || typeof sc !== 'object') return;

    const toolName = incomingEvent.toolName ?? '';
    const contextObj =
      sc.context && typeof sc.context === 'object'
        ? (sc.context as { worktreePath?: string; branch?: string })
        : null;
    const directWorktreePath =
      typeof sc.worktreePath === 'string' && sc.worktreePath.trim()
        ? sc.worktreePath.trim()
        : typeof contextObj?.worktreePath === 'string' && contextObj.worktreePath.trim()
          ? contextObj.worktreePath.trim()
          : undefined;

    const launch =
      sc.launch && typeof sc.launch === 'object'
        ? (sc.launch as {
            repoPath?: string;
            worktreePath?: string;
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
      const launchWorktree = launch.worktreePath?.trim() || directWorktreePath;
      void loadDiff(
        {
          repoPath: launch.demo ? undefined : launch.repoPath,
          worktreePath: launch.demo ? undefined : launchWorktree,
          scope: nextScope,
          commitRange: launch.commitRange,
          ignoreWhitespace: nextIgnoreWs,
          demo: launch.demo,
        },
        launch.selectedFile,
      );
      return;
    }

    if (directWorktreePath) {
      lastEventRef.current = incomingEvent;
      void loadDiff({
        worktreePath: directWorktreePath,
        scope,
        commitRange: scope === 'commit-range' ? commitRange : undefined,
        ignoreWhitespace,
        demo: demoMode,
      });
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
      setWorktreePath(nextSession.repoPath);
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
        worktreePath,
        scope,
        commitRange: scope === 'commit-range' ? commitRange : undefined,
        ignoreWhitespace,
        demo: demoMode,
      });
    }
  }, [incomingEvent, loadDiff, repoPath, worktreePath, scope, commitRange, ignoreWhitespace, demoMode]);

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

  const effectiveStage1Checklist = useMemo<Stage1ChecklistItem[]>(() => {
    const spec = session?.specCompliance;
    if (!spec || !Array.isArray(spec.items)) return [];
    return spec.items.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      checked: item.id in stage1Overrides ? stage1Overrides[item.id] : item.checked,
    }));
  }, [session?.specCompliance, stage1Overrides]);

  const stage1CheckedCount = useMemo(
    () => effectiveStage1Checklist.filter((item) => item.checked).length,
    [effectiveStage1Checklist],
  );

  const stage2CategoryCounts = useMemo(() => {
    const counts: Record<AnnotationCategory, number> = {
      security: 0,
      bug: 0,
      refactor: 0,
      question: 0,
      nit: 0,
    };
    for (const ann of session?.annotations ?? []) {
      if (!ann.resolved) {
        counts[ann.category] = (counts[ann.category] ?? 0) + 1;
      }
    }
    return counts;
  }, [session?.annotations]);

  // Instant local prompt preview; authoritative server prompt is fetched on Preview / Send / Copy
  useEffect(() => {
    if (!session) {
      setPreviewMarkdown('');
      return;
    }
    setPreviewMarkdown(buildLocalReviewPrompt(session, effectiveStage1Checklist));
  }, [session, effectiveStage1Checklist]);

  const handleWorktreeChange = (nextWorktreePath: string) => {
    setWorktreePath(nextWorktreePath);
    void loadDiff({
      worktreePath: nextWorktreePath,
      scope,
      commitRange: scope === 'commit-range' ? commitRange : undefined,
      ignoreWhitespace,
      demo: demoMode,
    });
  };

  const handleToggleStage1Item = (id: string, currentChecked: boolean) => {
    setStage1Overrides((prev) => ({ ...prev, [id]: !currentChecked }));
  };

  const handleScopeChange = (nextScope: ReviewScope) => {
    setScope(nextScope);
    if (nextScope !== 'commit-range') {
      void loadDiff({
        repoPath,
        worktreePath,
        scope: nextScope,
        ignoreWhitespace,
        demo: demoMode,
      });
    }
  };

  const handleCommitRangeApply = () => {
    void loadDiff({
      repoPath,
      worktreePath,
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
      worktreePath,
      scope,
      commitRange: scope === 'commit-range' ? commitRange : undefined,
      ignoreWhitespace: next,
      demo: demoMode,
    });
  };

  const handleRefresh = () => {
    void loadDiff({
      repoPath,
      worktreePath,
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
      if (session.repoPath) {
        args.worktreePath = session.repoPath;
        if (!session.isDemo) args.repoPath = session.repoPath;
      }
      if (session.commitRange) args.commitRange = session.commitRange;
      if (ignoreWhitespace) args.ignoreWhitespace = true;
      if (session.isDemo !== undefined) args.demo = session.isDemo;
      if (effectiveStage1Checklist.length > 0) {
        args.stage1Checklist = effectiveStage1Checklist;
      }

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

  const hasTwoStagePayload = Boolean(session?.specCompliance || openAnnotationsCount > 0);

  const handleQuickCopyPrompt = async () => {
    if (!hasTwoStagePayload) return;
    const md = await handleRefreshPreview();
    try {
      await navigator.clipboard?.writeText(md);
      onNotify?.(dict.common.copied);
    } catch {
      onNotify?.(r.copyPrompt);
    }
  };

  const handleQuickSendFixes = async () => {
    if (!hasTwoStagePayload) return;
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
        availableWorktrees={session?.availableWorktrees}
        activeWorktreePath={session?.repoPath}
        onWorktreeChange={handleWorktreeChange}
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

      {session && (
        <section className="rv-twostage-bar" aria-label="Two-Stage Review">
          <div className="rv-twostage-head">
            <button
              type="button"
              className="rv-twostage-toggle"
              aria-expanded={twoStageOpen}
              onClick={() => setTwoStageOpen((v) => !v)}
            >
              <span>{twoStageOpen ? '▾' : '▸'}</span>
              <strong>Two-Stage Review</strong>
              {session.specCompliance ? (
                <span className="rv-twostage-pill is-spec">
                  Stage 1 · Spec {stage1CheckedCount}/{effectiveStage1Checklist.length}
                </span>
              ) : (
                <span className="rv-twostage-pill">Stage 1 · No active spec</span>
              )}
              <span className="rv-twostage-pill is-code">
                Stage 2 · {openAnnotationsCount} {r.annotations}
              </span>
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {hasTwoStagePayload && (
                <button
                  type="button"
                  className="rv-btn rv-btn-subtle"
                  onClick={() => void handleQuickCopyPrompt()}
                >
                  {r.copyPrompt}
                </button>
              )}
              {hasTwoStagePayload && (caps.message || caps.isWorkbench) && (
                <button
                  type="button"
                  className="rv-btn rv-btn-primary"
                  onClick={() => void handleQuickSendFixes()}
                >
                  {r.sendFixes}
                </button>
              )}
              {onNavigateModule && (
                <button
                  type="button"
                  className="rv-btn rv-btn-subtle"
                  onClick={() =>
                    onNavigateModule('verify', {
                      worktreePath: session.repoPath,
                      branch: session.branch,
                    })
                  }
                >
                  {dict.modules.verify.shortLabel} →
                </button>
              )}
            </div>
          </div>

          {twoStageOpen && (
            <div className="rv-twostage-body">
              <div className="rv-twostage-col">
                <div className="rv-twostage-col-title">
                  <span>Stage 1 · Spec Compliance Checklist</span>
                  {session.specCompliance && (
                    <span className="rv-twostage-meta">
                      <code>{session.specCompliance.specId}</code> · {session.specCompliance.status}
                    </span>
                  )}
                </div>
                {session.specCompliance ? (
                  <>
                    <div className="rv-twostage-spec-title">{session.specCompliance.title}</div>
                    {effectiveStage1Checklist.length === 0 ? (
                      <div className="rv-twostage-empty">No tasks defined in active spec.</div>
                    ) : (
                      <ul className="rv-twostage-checklist">
                        {effectiveStage1Checklist.map((item) => (
                          <li key={item.id} className="rv-twostage-check-item">
                            <label>
                              <input
                                type="checkbox"
                                checked={item.checked}
                                onChange={() => handleToggleStage1Item(item.id, item.checked)}
                              />
                              <code>{item.id}</code>
                              <span className={item.checked ? 'is-done' : ''}>{item.title}</span>
                              {item.status && (
                                <span className="rv-twostage-status">{item.status}</span>
                              )}
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <div className="rv-twostage-empty">
                    No active Spec found. Activate a Spec in Spec Flow to link Stage 1 compliance checks.
                  </div>
                )}
              </div>

              <div className="rv-twostage-col">
                <div className="rv-twostage-col-title">
                  <span>Stage 2 · Code Quality Annotations</span>
                  <span className="rv-twostage-meta">
                    {openAnnotationsCount} open · {session.annotations.length - openAnnotationsCount}{' '}
                    {r.resolved}
                  </span>
                </div>
                <div className="rv-twostage-cat-row">
                  {(['security', 'bug', 'refactor', 'question', 'nit'] as AnnotationCategory[]).map(
                    (cat) => (
                      <span
                        key={cat}
                        className={`rv-twostage-cat is-${cat} ${stage2CategoryCounts[cat] > 0 ? 'has-items' : ''}`}
                      >
                        {cat.toUpperCase()}: {stage2CategoryCounts[cat]}
                      </span>
                    ),
                  )}
                </div>
                {openAnnotationsCount === 0 ? (
                  <div className="rv-twostage-empty">
                    Click any diff line below to attach pinpoint file:line annotations.
                  </div>
                ) : (
                  <div className="rv-twostage-empty">
                    Two-stage prompt packages Stage 1 Spec checks + {openAnnotationsCount} prioritized
                    file:line annotation(s).
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
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
