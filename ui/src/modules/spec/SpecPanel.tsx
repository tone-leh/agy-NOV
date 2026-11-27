import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNovI18n } from '../../i18n/index.js';
import { SpecCreateModal } from './SpecCreateModal.js';
import { SpecPlanReviewView } from './SpecPlanReviewView.js';
import { SpecTaskDagView } from './SpecTaskDagView.js';
import { getSpecActionLabels } from './spec-labels.js';
import { SPEC_STYLES } from './spec-styles.js';
import {
  buildClientFeedbackPrompt,
  computeDagNodes,
  splitMarkdownLinesClient,
  wouldCreateDraftCycle,
  type DraftDeltaItem,
  type DraftTaskItem,
  type NovModulePanelProps,
  type SetSpecStatusParams,
  type SpecAnnotationKind,
  type SpecDeltaKind,
  type SpecDocumentView,
  type SpecMode,
  type SpecPlanAnnotation,
  type SpecRevisionDiffResponse,
  type SpecStateView,
  type SpecTaskStatus,
  type SpecTaskView,
} from './spec-types.js';

export type { NovModulePanelProps };

export const SpecPanel: React.FC<NovModulePanelProps> = ({
  bridge,
  active,
  onNotify,
  incomingEvent,
  onOpenSettings,
}) => {
  const { dict, locale } = useNovI18n();
  const [caps, setCaps] = useState(() => bridge.getCapabilities());
  useEffect(() => {
    let mounted = true;
    void bridge.ready().then(() => {
      if (mounted) setCaps(bridge.getCapabilities());
    });
    return () => {
      mounted = false;
    };
  }, [bridge]);
  const canSendMessage = caps.message;
  const sDict = dict.panels.spec;
  const actions = getSpecActionLabels(locale);

  const [tab, setTab] = useState<'board' | 'review' | 'create'>('board');
  const [state, setState] = useState<SpecStateView | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Plan Review (Plannotator) state
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [annKind, setAnnKind] = useState<SpecAnnotationKind>('comment');
  const [annNote, setAnnNote] = useState('');
  const [annSuggestedText, setAnnSuggestedText] = useState('');
  const [showResolved, setShowResolved] = useState(true);

  // Revision diff state
  const [diffMode, setDiffMode] = useState(false);
  const [diffFromRev, setDiffFromRev] = useState<number | undefined>(undefined);
  const [diffToRev, setDiffToRev] = useState<number | undefined>(undefined);
  const [diffResult, setDiffResult] = useState<SpecRevisionDiffResponse | null>(null);

  // New spec / delta creation draft form
  const [draftMode, setDraftMode] = useState<SpecMode>('full');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftGoal, setDraftGoal] = useState('');
  const [draftPlanMarkdown, setDraftPlanMarkdown] = useState('');
  const [draftAcceptance, setDraftAcceptance] = useState('');
  const [draftEnforceLock, setDraftEnforceLock] = useState(true);
  const [draftRequireUiApproval, setDraftRequireUiApproval] = useState(false);
  const [newDeltaKind, setNewDeltaKind] = useState<SpecDeltaKind>('added');
  const [newDeltaArea, setNewDeltaArea] = useState('');
  const [newDeltaText, setNewDeltaText] = useState('');
  const [draftDeltas, setDraftDeltas] = useState<DraftDeltaItem[]>([]);
  const [deltaSeq, setDeltaSeq] = useState(1);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [draftTasks, setDraftTasks] = useState<DraftTaskItem[]>([]);
  const [taskSeq, setTaskSeq] = useState(1);

  const loadState = useCallback(async () => {
    try {
      const res = await bridge.callTool<SpecStateView>('app_spec_get_state', {});
      setState(res);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    }
  }, [bridge, onNotify]);

  useEffect(() => {
    if (active) {
      void loadState();
    }
  }, [active, loadState]);

  useEffect(() => {
    if (!active || !incomingEvent) return;
    const tool = incomingEvent.toolName ?? '';
    const mod = incomingEvent.structuredContent?.novModule;
    if (tool.startsWith('spec_') || tool.startsWith('app_spec_') || mod === 'spec') {
      void loadState();
    }
  }, [active, incomingEvent, loadState]);

  const activeSpec = state?.activeSpec ?? null;
  const specs = Array.isArray(state?.specs) ? state.specs : [];
  const writeLockActive = Boolean(state?.writeLockActive);
  const isBusy = busyAction !== null;

  // Reset line selection & diff view when active spec changes
  const activeSpecIdRef = activeSpec?.id ?? null;
  useEffect(() => {
    setSelStart(null);
    setSelEnd(null);
    setAnnNote('');
    setAnnSuggestedText('');
    setDiffMode(false);
    setDiffResult(null);
    setDiffFromRev(undefined);
    setDiffToRev(undefined);
  }, [activeSpecIdRef]);

  const dagNodes = useMemo(
    () => (activeSpec && Array.isArray(activeSpec.tasks) ? computeDagNodes(activeSpec.tasks) : []),
    [activeSpec],
  );

  const taskTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of dagNodes) {
      map.set(node.task.id, node.task.title);
    }
    return map;
  }, [dagNodes]);

  const taskStatusById = useMemo(() => {
    const map = new Map<string, SpecTaskStatus>();
    for (const node of dagNodes) {
      map.set(node.task.id, node.task.status);
    }
    return map;
  }, [dagNodes]);

  const dagCounts = useMemo(() => {
    let ready = 0;
    let inProgress = 0;
    let done = 0;
    for (const node of dagNodes) {
      if (node.computedState === 'ready') ready += 1;
      else if (node.computedState === 'in_progress') inProgress += 1;
      else if (node.computedState === 'done') done += 1;
    }
    return { ready, inProgress, done };
  }, [dagNodes]);

  const planLines = useMemo(
    () => splitMarkdownLinesClient(activeSpec?.planMarkdown ?? ''),
    [activeSpec?.planMarkdown],
  );

  const allAnnotations = useMemo(
    () => (Array.isArray(activeSpec?.annotations) ? activeSpec.annotations : []),
    [activeSpec?.annotations],
  );

  const unresolvedCount = useMemo(
    () =>
      typeof activeSpec?.unresolvedAnnotations === 'number'
        ? activeSpec.unresolvedAnnotations
        : allAnnotations.filter((a) => !a.resolved).length,
    [activeSpec?.unresolvedAnnotations, allAnnotations],
  );

  const visibleAnnotations = useMemo(
    () => (showResolved ? allAnnotations : allAnnotations.filter((a) => !a.resolved)),
    [allAnnotations, showResolved],
  );

  const availableRevisions = useMemo(() => {
    if (!activeSpec) return [] as number[];
    const list = new Set<number>();
    if (typeof activeSpec.revision === 'number' && activeSpec.revision >= 1) {
      list.add(activeSpec.revision);
    }
    if (Array.isArray(activeSpec.revisions)) {
      for (const r of activeSpec.revisions) {
        if (typeof r.revision === 'number' && r.revision >= 1) {
          list.add(r.revision);
        }
      }
    }
    return Array.from(list).sort((a, b) => a - b);
  }, [activeSpec]);

  const lineDecorations = useMemo(() => {
    const strikeLines = new Set<number>();
    const replaceLines = new Set<number>();
    const commentLines = new Set<number>();
    const byEndLine = new Map<number, SpecPlanAnnotation[]>();
    const detached: SpecPlanAnnotation[] = [];

    for (const ann of visibleAnnotations) {
      if (!ann.resolved) {
        for (let ln = ann.lineStart; ln <= ann.lineEnd; ln += 1) {
          if (ann.kind === 'strike') strikeLines.add(ln);
          else if (ann.kind === 'replace') replaceLines.add(ln);
          else commentLines.add(ln);
        }
      }
      if (ann.lineEnd >= 1 && ann.lineEnd <= planLines.length) {
        const list = byEndLine.get(ann.lineEnd) ?? [];
        list.push(ann);
        byEndLine.set(ann.lineEnd, list);
      } else {
        detached.push(ann);
      }
    }

    return { strikeLines, replaceLines, commentLines, byEndLine, detached };
  }, [visibleAnnotations, planLines.length]);

  const feedbackPrompt = useMemo(
    () => (activeSpec ? buildClientFeedbackPrompt(activeSpec) : ''),
    [activeSpec],
  );

  const loadRevisionDiff = useCallback(
    async (specId: string, fromRev?: number, toRev?: number) => {
      setBusyAction('diff');
      try {
        const res = await bridge.callTool<SpecRevisionDiffResponse>('app_spec_diff_revisions', {
          specId,
          ...(typeof fromRev === 'number' ? { fromRevision: fromRev } : {}),
          ...(typeof toRev === 'number' ? { toRevision: toRev } : {}),
        });
        setDiffResult(res);
        setDiffFromRev(res.fromRevision);
        setDiffToRev(res.toRevision);
        setDiffMode(true);
      } catch (err) {
        onNotify?.(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyAction(null);
      }
    },
    [bridge, onNotify],
  );

  const handleSetSpecStatus = async (params: SetSpecStatusParams) => {
    if (busyAction) return;
    setBusyAction(params.actionKey);
    try {
      const res = await bridge.callTool<{ spec: SpecDocumentView; state: SpecStateView }>(
        'app_spec_set_status',
        {
          specId: params.specId,
          status: params.status,
          ...(typeof params.enforcePlanBeforeWrite === 'boolean'
            ? { enforcePlanBeforeWrite: params.enforcePlanBeforeWrite }
            : {}),
          ...(typeof params.requireUiApproval === 'boolean'
            ? { requireUiApproval: params.requireUiApproval }
            : {}),
          ...(typeof params.setActive === 'boolean' ? { setActive: params.setActive } : {}),
        },
      );
      if (res.state) {
        setState(res.state);
      } else {
        await loadState();
      }
      if (params.notifyText) {
        onNotify?.(params.notifyText);
      }
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleUpdateTask = async (taskId: string, status: SpecTaskStatus) => {
    if (!activeSpec || busyAction) return;
    setBusyAction(`task:${taskId}:${status}`);
    try {
      const res = await bridge.callTool<{ task: SpecTaskView; state: SpecStateView }>(
        'app_spec_update_task',
        {
          specId: activeSpec.id,
          taskId,
          status,
        },
      );
      if (res.state) {
        setState(res.state);
      } else {
        await loadState();
      }
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleArchiveToMem = async () => {
    if (!activeSpec || busyAction) return;
    setBusyAction('archive-mem');
    try {
      const res = await bridge.callTool<{
        memoryId: string;
        demoSimulated?: boolean;
        spec?: SpecDocumentView;
        state?: SpecStateView;
      }>('app_spec_archive_to_mem', {
        specId: activeSpec.id,
      });
      if (res.state) {
        setState(res.state);
      } else {
        await loadState();
      }
      const suffix = res.demoSimulated ? ` ${actions.archiveDemoSuffix}` : '';
      onNotify?.(`${actions.archiveSuccessPrefix}: ${res.memoryId}${suffix}`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleSelectPlanLine = (lineNumber: number, shiftKey: boolean) => {
    if (selStart === null) {
      setSelStart(lineNumber);
      setSelEnd(lineNumber);
      setAnnSuggestedText(planLines[lineNumber - 1] ?? '');
      return;
    }
    if (shiftKey || (selStart === selEnd && lineNumber !== selStart)) {
      const nextStart = Math.min(selStart, lineNumber);
      const nextEnd = Math.max(selStart, lineNumber);
      setSelStart(nextStart);
      setSelEnd(nextEnd);
      setAnnSuggestedText(planLines.slice(nextStart - 1, nextEnd).join('\n'));
      return;
    }
    if (lineNumber === selStart && lineNumber === selEnd) {
      setSelStart(null);
      setSelEnd(null);
      return;
    }
    setSelStart(lineNumber);
    setSelEnd(lineNumber);
    setAnnSuggestedText(planLines[lineNumber - 1] ?? '');
  };

  const handleSubmitAnnotation = async () => {
    if (!activeSpec || selStart === null || selEnd === null || busyAction) return;
    const start = Math.min(selStart, selEnd);
    const end = Math.max(selStart, selEnd);
    const trimmedNote = annNote.trim();
    const trimmedSuggested = annSuggestedText.trim();

    if (annKind === 'comment' && !trimmedNote) return;
    if (annKind === 'replace' && !trimmedSuggested) return;

    setBusyAction('annotate');
    try {
      const res = await bridge.callTool<{
        annotation: SpecPlanAnnotation;
        spec: SpecDocumentView;
        state: SpecStateView;
      }>('app_spec_annotate', {
        specId: activeSpec.id,
        lineStart: start,
        lineEnd: end,
        kind: annKind,
        ...(trimmedNote ? { note: trimmedNote } : {}),
        ...(annKind === 'replace' ? { suggestedText: trimmedSuggested } : {}),
      });
      if (res.state) {
        setState(res.state);
      } else {
        await loadState();
      }
      setSelStart(null);
      setSelEnd(null);
      setAnnNote('');
      setAnnSuggestedText('');
      onNotify?.(`${actions.annotationAddedToast} (L${start}${end > start ? `-L${end}` : ''})`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleResolveOrDeleteAnnotation = async (
    annotationId: string,
    action: 'resolve' | 'reopen' | 'delete',
  ) => {
    if (!activeSpec || busyAction) return;
    setBusyAction(`ann:${action}:${annotationId}`);
    try {
      const res = await bridge.callTool<{ spec: SpecDocumentView; state: SpecStateView }>(
        'app_spec_resolve_annotation',
        {
          specId: activeSpec.id,
          annotationId,
          action,
        },
      );
      if (res.state) {
        setState(res.state);
      } else {
        await loadState();
      }
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleSendFeedbackToAgent = async () => {
    if (!activeSpec || unresolvedCount === 0 || busyAction) return;
    setBusyAction('send-feedback');
    try {
      const delivery = await bridge.sendMessage(feedbackPrompt);
      if (delivery === 'sent') {
        onNotify?.(actions.feedbackSentToast);
      } else if (delivery === 'context') {
        onNotify?.(actions.feedbackContextToast);
      } else {
        onNotify?.(actions.feedbackCopiedToast);
      }
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyFeedbackPrompt = async () => {
    if (!activeSpec || !feedbackPrompt) return;
    try {
      await navigator.clipboard?.writeText(feedbackPrompt);
      onNotify?.(actions.feedbackCopiedToast);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAddDraftDelta = () => {
    const cleanText = newDeltaText.trim();
    if (!cleanText) return;
    const id = `delta-${deltaSeq}`;
    setDeltaSeq((prev) => prev + 1);
    setDraftDeltas((prev) => [
      ...prev,
      { id, kind: newDeltaKind, area: newDeltaArea.trim(), text: cleanText },
    ]);
    setNewDeltaText('');
  };

  const handleRemoveDraftDelta = (id: string) => {
    setDraftDeltas((prev) => prev.filter((item) => item.id !== id));
  };

  const handleAddDraftTask = () => {
    const clean = newTaskTitle.trim();
    if (!clean) return;
    const id = `task-${taskSeq}`;
    setTaskSeq((prev) => prev + 1);
    setDraftTasks((prev) => [...prev, { id, title: clean, dependsOn: [] }]);
    setNewTaskTitle('');
  };

  const handleRemoveDraftTask = (id: string) => {
    setDraftTasks((prev) =>
      prev
        .filter((t) => t.id !== id)
        .map((t) => ({
          ...t,
          dependsOn: t.dependsOn.filter((dep) => dep !== id),
        })),
    );
  };

  const handleUpdateDraftTaskTitle = (id: string, title: string) => {
    setDraftTasks((prev) =>
      prev.map((item) => (item.id === id ? { ...item, title } : item)),
    );
  };

  const handleToggleDraftDep = (taskId: string, depId: string) => {
    setDraftTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const exists = t.dependsOn.includes(depId);
        if (exists) {
          return { ...t, dependsOn: t.dependsOn.filter((d) => d !== depId) };
        }
        if (wouldCreateDraftCycle(prev, taskId, depId)) {
          return t;
        }
        return { ...t, dependsOn: [...t.dependsOn, depId] };
      }),
    );
  };

  const handleCreateSpec = async () => {
    const cleanTitle = draftTitle.trim();
    const cleanGoal = draftGoal.trim();
    if (!cleanTitle || !cleanGoal || busyAction) return;

    const acceptanceCriteria = draftAcceptance
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean);

    const tasksPayload = draftTasks
      .filter((t) => t.title.trim().length > 0)
      .map((t) => ({
        id: t.id,
        title: t.title.trim(),
        dependsOn: t.dependsOn,
      }));

    const deltaPayload = draftDeltas
      .filter((d) => d.text.trim().length > 0)
      .map((d) => ({
        id: d.id,
        kind: d.kind,
        ...(d.area.trim() ? { area: d.area.trim() } : {}),
        text: d.text.trim(),
      }));

    const cleanPlanMd = draftPlanMarkdown.trim();

    setBusyAction('create');
    try {
      const res = await bridge.callTool<{ spec: SpecDocumentView; state: SpecStateView }>(
        'app_spec_save',
        {
          title: cleanTitle,
          goal: cleanGoal,
          mode: draftMode,
          ...(cleanPlanMd ? { planMarkdown: cleanPlanMd } : {}),
          ...(deltaPayload.length > 0 ? { deltaItems: deltaPayload } : {}),
          ...(acceptanceCriteria.length > 0 ? { acceptanceCriteria } : {}),
          enforcePlanBeforeWrite: draftEnforceLock,
          requireUiApproval: draftRequireUiApproval,
          ...(tasksPayload.length > 0 ? { tasks: tasksPayload } : {}),
          setActive: true,
        },
      );
      if (res.state) {
        setState(res.state);
      } else {
        await loadState();
      }
      setDraftTitle('');
      setDraftGoal('');
      setDraftPlanMarkdown('');
      setDraftAcceptance('');
      setDraftDeltas([]);
      setNewDeltaArea('');
      setNewDeltaText('');
      setDeltaSeq(1);
      setDraftTasks([]);
      setNewTaskTitle('');
      setTaskSeq(1);
      setTab('board');
      onNotify?.(`${sDict.createSpecBtn}: ${res.spec?.title ?? cleanTitle}`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const activeSpecMode: SpecMode = activeSpec?.mode === 'delta' ? 'delta' : 'full';
  const activeRevision = activeSpec?.revision ?? 1;

  return (
    <div className="nov-p-page">
      <section className="nov-p-card">
        <div className="nov-p-row">
          <div>
            <div style={SPEC_STYLES.flexWrapCenterGap8}>
              <h2 className="nov-hero-title">{sDict.title}</h2>
              <span
                className={writeLockActive ? 'nov-badge' : 'nov-badge is-offline'}
                style={writeLockActive ? SPEC_STYLES.writeLockBadgeOn : undefined}
              >
                {writeLockActive ? `🔒 ${sDict.writeLockOn}` : `🔓 ${sDict.writeLockOff}`}
              </span>
              {activeSpec && (
                <span
                  className={`nov-badge ${activeSpecMode === 'delta' ? 'is-accent' : ''}`}
                  style={SPEC_STYLES.mono}
                >
                  {activeSpecMode === 'delta' ? actions.modeDeltaBadge : actions.modeFullBadge} · v
                  {activeRevision}
                </span>
              )}
            </div>
            <p className="nov-hero-sub">{sDict.subtitle}</p>
          </div>

          <div style={SPEC_STYLES.flexWrapGap6AlignCenter}>
            <button
              type="button"
              className="nov-p-btn"
              disabled={isBusy}
              onClick={() => void loadState()}
            >
              {dict.common.refresh}
            </button>

            {activeSpec && activeSpec.status === 'draft' && (
              <button
                type="button"
                className="nov-p-btn is-primary"
                disabled={isBusy}
                onClick={() =>
                  void handleSetSpecStatus({
                    specId: activeSpec.id,
                    status: 'approved',
                    setActive: true,
                    actionKey: 'approve',
                    notifyText: `${sDict.approveBtn}: ${activeSpec.title}`,
                  })
                }
              >
                {busyAction === 'approve' ? dict.common.loading : sDict.approveBtn}
              </button>
            )}

            {activeSpec && activeSpec.status !== 'draft' && (
              <button
                type="button"
                className="nov-p-btn"
                disabled={isBusy}
                onClick={() =>
                  void handleSetSpecStatus({
                    specId: activeSpec.id,
                    status: 'draft',
                    setActive: true,
                    actionKey: 'revert',
                    notifyText: `${sDict.revertDraftBtn}: ${activeSpec.title}`,
                  })
                }
              >
                {busyAction === 'revert' ? dict.common.loading : sDict.revertDraftBtn}
              </button>
            )}

            {onOpenSettings && (
              <button
                type="button"
                className="nov-p-btn"
                title={actions.settingsTooltip}
                aria-label={actions.settingsTooltip}
                style={{ padding: '6px 9px' }}
                onClick={() => onOpenSettings('spec')}
              >
                ⚙
              </button>
            )}
          </div>
        </div>

        <div className="nov-p-stat-grid">
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{actions.specsLabel}</div>
            <div className="nov-p-stat-val">{specs.length}</div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{sDict.readyBadge}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-success)' }}>
              {dagCounts.ready}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{sDict.doneBadge}</div>
            <div className="nov-p-stat-val">
              {dagCounts.done}/{dagNodes.length}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{actions.reviewStatLabel}</div>
            <div
              className="nov-p-stat-val"
              style={{
                color: unresolvedCount > 0 ? 'var(--nov-warn)' : 'var(--nov-success)',
              }}
            >
              {unresolvedCount}
            </div>
          </div>
        </div>

        <div className="nov-p-tabs">
          <button
            type="button"
            className={`nov-preset-btn ${tab === 'board' ? 'is-active' : ''}`}
            onClick={() => setTab('board')}
          >
            {sDict.tabBoard}
          </button>
          <button
            type="button"
            className={`nov-preset-btn ${tab === 'review' ? 'is-active' : ''}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            onClick={() => setTab('review')}
          >
            <span>{actions.tabReview}</span>
            {unresolvedCount > 0 && (
              <span className="nov-badge is-network" style={{ padding: '1px 6px' }}>
                {unresolvedCount}
              </span>
            )}
          </button>
          <button
            type="button"
            className={`nov-preset-btn ${tab === 'create' ? 'is-active' : ''}`}
            onClick={() => setTab('create')}
          >
            + {actions.tabCreateDelta}
          </button>
        </div>
      </section>

      {tab === 'board' && (
        <SpecTaskDagView
          specs={specs}
          activeSpec={activeSpec}
          dagNodes={dagNodes}
          dagCounts={dagCounts}
          taskTitleById={taskTitleById}
          taskStatusById={taskStatusById}
          unresolvedCount={unresolvedCount}
          busyAction={busyAction}
          isBusy={isBusy}
          actions={actions}
          onOpenCreate={() => setTab('create')}
          onOpenReview={() => setTab('review')}
          onSetSpecStatus={handleSetSpecStatus}
          onUpdateTask={handleUpdateTask}
          onArchiveToMem={handleArchiveToMem}
        />
      )}

      {tab === 'review' && (
        <SpecPlanReviewView
          activeSpec={activeSpec}
          specsCount={specs.length}
          planLines={planLines}
          lineDecorations={lineDecorations}
          unresolvedCount={unresolvedCount}
          availableRevisions={availableRevisions}
          canSendMessage={canSendMessage}
          busyAction={busyAction}
          isBusy={isBusy}
          actions={actions}
          selStart={selStart}
          selEnd={selEnd}
          annKind={annKind}
          annNote={annNote}
          annSuggestedText={annSuggestedText}
          showResolved={showResolved}
          diffMode={diffMode}
          diffFromRev={diffFromRev}
          diffToRev={diffToRev}
          diffResult={diffResult}
          onSetSelStart={setSelStart}
          onSetSelEnd={setSelEnd}
          onSetAnnKind={setAnnKind}
          onSetAnnNote={setAnnNote}
          onSetAnnSuggestedText={setAnnSuggestedText}
          onSetShowResolved={setShowResolved}
          onSetDiffMode={setDiffMode}
          onSetDiffFromRev={setDiffFromRev}
          onSetDiffToRev={setDiffToRev}
          onLoadRevisionDiff={loadRevisionDiff}
          onSelectPlanLine={handleSelectPlanLine}
          onSubmitAnnotation={handleSubmitAnnotation}
          onResolveOrDeleteAnnotation={handleResolveOrDeleteAnnotation}
          onSendFeedbackToAgent={handleSendFeedbackToAgent}
          onCopyFeedbackPrompt={handleCopyFeedbackPrompt}
        />
      )}

      {tab === 'create' && (
        <SpecCreateModal
          draftMode={draftMode}
          draftTitle={draftTitle}
          draftGoal={draftGoal}
          draftPlanMarkdown={draftPlanMarkdown}
          draftAcceptance={draftAcceptance}
          draftEnforceLock={draftEnforceLock}
          draftRequireUiApproval={draftRequireUiApproval}
          newDeltaKind={newDeltaKind}
          newDeltaArea={newDeltaArea}
          newDeltaText={newDeltaText}
          draftDeltas={draftDeltas}
          newTaskTitle={newTaskTitle}
          draftTasks={draftTasks}
          busyAction={busyAction}
          isBusy={isBusy}
          actions={actions}
          onSetDraftMode={setDraftMode}
          onSetDraftTitle={setDraftTitle}
          onSetDraftGoal={setDraftGoal}
          onSetDraftPlanMarkdown={setDraftPlanMarkdown}
          onSetDraftAcceptance={setDraftAcceptance}
          onToggleDraftEnforceLock={() => setDraftEnforceLock((prev) => !prev)}
          onToggleDraftRequireUiApproval={() => setDraftRequireUiApproval((prev) => !prev)}
          onSetNewDeltaKind={setNewDeltaKind}
          onSetNewDeltaArea={setNewDeltaArea}
          onSetNewDeltaText={setNewDeltaText}
          onAddDraftDelta={handleAddDraftDelta}
          onRemoveDraftDelta={handleRemoveDraftDelta}
          onSetNewTaskTitle={setNewTaskTitle}
          onAddDraftTask={handleAddDraftTask}
          onRemoveDraftTask={handleRemoveDraftTask}
          onUpdateDraftTaskTitle={handleUpdateDraftTaskTitle}
          onToggleDraftDep={handleToggleDraftDep}
          onCreateSpec={handleCreateSpec}
        />
      )}
    </div>
  );
};
