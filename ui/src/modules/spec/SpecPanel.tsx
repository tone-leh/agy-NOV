import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { NovBridge } from '../../bridge.js';
import { useNovI18n, type ResolvedUiLocale } from '../../i18n/index.js';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
}

type SpecStatus = 'draft' | 'approved' | 'completed' | 'archived';
type SpecTaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked';
type SpecTaskComputedState = 'ready' | 'waiting_deps' | 'in_progress' | 'done' | 'blocked';

interface SpecTaskView {
  id: string;
  title: string;
  description?: string;
  dependsOn: string[];
  status: SpecTaskStatus;
  note?: string;
  updatedAt?: string;
  computedState?: SpecTaskComputedState;
  unmetDeps?: string[];
  depth?: number;
}

interface SpecDocumentView {
  id: string;
  title: string;
  goal: string;
  acceptanceCriteria: string[];
  planSteps: string[];
  status: SpecStatus;
  enforcePlanBeforeWrite: boolean;
  requireUiApproval: boolean;
  approvedBy?: string;
  approvedAt?: string;
  approvalNote?: string;
  tasks: SpecTaskView[];
  createdAt?: string;
  updatedAt?: string;
}

interface SpecSummaryItem {
  id: string;
  title: string;
  status: SpecStatus;
  enforcePlanBeforeWrite: boolean;
  requireUiApproval: boolean;
  totalTasks: number;
  doneTasks: number;
  readyTasks: number;
  updatedAt?: string;
}

interface SpecStateView {
  mode: string;
  activeSpecId: string | null;
  activeSpec: SpecDocumentView | null;
  specs: SpecSummaryItem[];
  writeLockActive: boolean;
}

interface DraftTaskItem {
  id: string;
  title: string;
  dependsOn: string[];
}

interface NormalizedTaskNode {
  task: SpecTaskView;
  computedState: SpecTaskComputedState;
  unmetDeps: string[];
  depth: number;
  originalIndex: number;
}

const ACTION_LABELS: Record<
  ResolvedUiLocale,
  {
    start: string;
    done: string;
    reset: string;
    addTask: string;
    depsLabel: string;
    planStepsLabel: string;
    specsLabel: string;
    selectSpecHint: string;
  }
> = {
  en: {
    start: 'Start',
    done: 'Done',
    reset: 'Reset',
    addTask: 'Add Task',
    depsLabel: 'Depends on',
    planStepsLabel: 'Plan Steps',
    specsLabel: 'Specs',
    selectSpecHint: 'No active spec selected. Click a spec in the list above to activate it.',
  },
  'zh-CN': {
    start: '开始',
    done: '完成',
    reset: '重置',
    addTask: '添加任务',
    depsLabel: '前置依赖',
    planStepsLabel: '实施步骤',
    specsLabel: '规格列表',
    selectSpecHint: '当前未激活规格。请点击上方列表中的规格进行激活。',
  },
  'zh-TW': {
    start: '開始',
    done: '完成',
    reset: '重設',
    addTask: '新增任務',
    depsLabel: '前置相依',
    planStepsLabel: '實作步驟',
    specsLabel: '規格清單',
    selectSpecHint: '目前未啟用規格。請點擊上方清單中的規格以進行啟用。',
  },
  ja: {
    start: '開始',
    done: '完了',
    reset: 'リセット',
    addTask: 'タスク追加',
    depsLabel: '依存先',
    planStepsLabel: '実装ステップ',
    specsLabel: 'Spec 一覧',
    selectSpecHint: 'アクティブな Spec が未選択です。上のリストから Spec をクリックして有効化してください。',
  },
  ko: {
    start: '시작',
    done: '완료',
    reset: '초기화',
    addTask: '작업 추가',
    depsLabel: '선행 의존',
    planStepsLabel: '실행 단계',
    specsLabel: 'Spec 목록',
    selectSpecHint: '활성화된 Spec이 없습니다. 위 목록에서 Spec을 클릭하여 활성화하세요.',
  },
  es: {
    start: 'Iniciar',
    done: 'Completar',
    reset: 'Reiniciar',
    addTask: 'Añadir tarea',
    depsLabel: 'Depende de',
    planStepsLabel: 'Pasos del plan',
    specsLabel: 'Specs',
    selectSpecHint: 'No hay ninguna spec activa. Haz clic en una spec de la lista superior para activarla.',
  },
  fr: {
    start: 'Démarrer',
    done: 'Terminer',
    reset: 'Réinitialiser',
    addTask: 'Ajouter tâche',
    depsLabel: 'Dépend de',
    planStepsLabel: 'Étapes du plan',
    specsLabel: 'Specs',
    selectSpecHint: 'Aucune spec active. Cliquez sur une spec dans la liste ci-dessus pour l’activer.',
  },
  de: {
    start: 'Starten',
    done: 'Erledigt',
    reset: 'Zurücksetzen',
    addTask: 'Aufgabe hinzufügen',
    depsLabel: 'Hängt ab von',
    planStepsLabel: 'Planschritte',
    specsLabel: 'Specs',
    selectSpecHint: 'Keine aktive Spec ausgewählt. Klicken Sie oben in der Liste auf eine Spec, um sie zu aktivieren.',
  },
};

function computeDagNodes(tasks: readonly SpecTaskView[]): NormalizedTaskNode[] {
  const byId = new Map<string, SpecTaskView>();
  for (const task of tasks) {
    byId.set(task.id, task);
  }

  const depthMemo = new Map<string, number>();
  const resolveDepth = (id: string, stack: Set<string>): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    const item = byId.get(id);
    if (!item || !Array.isArray(item.dependsOn) || item.dependsOn.length === 0) {
      depthMemo.set(id, 0);
      return 0;
    }
    if (stack.has(id)) return 0;
    stack.add(id);
    let maxParent = -1;
    for (const depId of item.dependsOn) {
      if (byId.has(depId)) {
        maxParent = Math.max(maxParent, resolveDepth(depId, stack));
      }
    }
    stack.delete(id);
    const depth = maxParent + 1;
    depthMemo.set(id, depth);
    return depth;
  };

  const nodes: NormalizedTaskNode[] = tasks.map((task, idx) => {
    const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
    const unmetDeps = Array.isArray(task.unmetDeps)
      ? task.unmetDeps
      : deps.filter((depId) => {
          const parent = byId.get(depId);
          return parent ? parent.status !== 'done' : false;
        });

    let computedState: SpecTaskComputedState;
    if (task.computedState) {
      computedState = task.computedState;
    } else if (task.status === 'done') {
      computedState = 'done';
    } else if (task.status === 'in_progress') {
      computedState = 'in_progress';
    } else if (task.status === 'blocked') {
      computedState = 'blocked';
    } else {
      computedState = unmetDeps.length > 0 ? 'waiting_deps' : 'ready';
    }

    const depth =
      typeof task.depth === 'number' && Number.isFinite(task.depth) && task.depth >= 0
        ? Math.floor(task.depth)
        : resolveDepth(task.id, new Set<string>());

    return {
      task: { ...task, dependsOn: deps },
      computedState,
      unmetDeps,
      depth,
      originalIndex: idx,
    };
  });

  nodes.sort((a, b) => a.depth - b.depth || a.originalIndex - b.originalIndex);
  return nodes;
}

function wouldCreateDraftCycle(
  tasks: readonly DraftTaskItem[],
  sourceId: string,
  candidateDepId: string,
): boolean {
  if (sourceId === candidateDepId) return true;
  const byId = new Map<string, DraftTaskItem>();
  for (const t of tasks) byId.set(t.id, t);

  const visited = new Set<string>();
  const queue: string[] = [candidateDepId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === sourceId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const item = byId.get(cur);
    if (item) {
      for (const nextDep of item.dependsOn) {
        if (!visited.has(nextDep)) queue.push(nextDep);
      }
    }
  }
  return false;
}

function getSpecStatusBadgeProps(
  status: SpecStatus,
  labels: {
    statusDraft: string;
    statusApproved: string;
    statusCompleted: string;
    statusArchived: string;
  },
): { text: string; className: string; style?: React.CSSProperties } {
  switch (status) {
    case 'approved':
      return { text: labels.statusApproved, className: 'nov-badge is-offline' };
    case 'completed':
      return { text: labels.statusCompleted, className: 'nov-badge is-accent' };
    case 'archived':
      return { text: labels.statusArchived, className: 'nov-badge' };
    case 'draft':
    default:
      return { text: labels.statusDraft, className: 'nov-badge is-network' };
  }
}

function getTaskStateBadgeProps(
  state: SpecTaskComputedState,
  labels: {
    readyBadge: string;
    waitingBadge: string;
    doneBadge: string;
    inProgressBadge: string;
    blockedBadge: string;
  },
): { text: string; className: string; style?: React.CSSProperties } {
  switch (state) {
    case 'done':
      return { text: labels.doneBadge, className: 'nov-badge is-offline' };
    case 'in_progress':
      return { text: labels.inProgressBadge, className: 'nov-badge is-accent' };
    case 'blocked':
      return {
        text: labels.blockedBadge,
        className: 'nov-badge',
        style: {
          background: 'var(--nov-danger-soft)',
          color: 'var(--nov-danger)',
          borderColor: 'var(--nov-danger)',
        },
      };
    case 'waiting_deps':
      return { text: labels.waitingBadge, className: 'nov-badge is-network' };
    case 'ready':
    default:
      return {
        text: labels.readyBadge,
        className: 'nov-badge',
        style: {
          background: 'var(--nov-success-soft)',
          color: 'var(--nov-success)',
          borderColor: 'var(--nov-success)',
        },
      };
  }
}

export const SpecPanel: React.FC<NovModulePanelProps> = ({
  bridge,
  active,
  onNotify,
  incomingEvent,
}) => {
  const { dict, locale } = useNovI18n();
  const sDict = dict.panels.spec;
  const actions = ACTION_LABELS[locale] ?? ACTION_LABELS.en;

  const [tab, setTab] = useState<'board' | 'create'>('board');
  const [state, setState] = useState<SpecStateView | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // New spec creation draft form
  const [draftTitle, setDraftTitle] = useState('');
  const [draftGoal, setDraftGoal] = useState('');
  const [draftAcceptance, setDraftAcceptance] = useState('');
  const [draftEnforceLock, setDraftEnforceLock] = useState(true);
  const [draftRequireUiApproval, setDraftRequireUiApproval] = useState(false);
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

  const handleSetSpecStatus = async (params: {
    specId: string;
    status: SpecStatus;
    enforcePlanBeforeWrite?: boolean;
    requireUiApproval?: boolean;
    setActive?: boolean;
    actionKey: string;
    notifyText?: string;
  }) => {
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

    setBusyAction('create');
    try {
      const res = await bridge.callTool<{ spec: SpecDocumentView; state: SpecStateView }>(
        'app_spec_save',
        {
          title: cleanTitle,
          goal: cleanGoal,
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
      setDraftAcceptance('');
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

  const activeSpecStatusBadge = activeSpec ? getSpecStatusBadgeProps(activeSpec.status, sDict) : null;

  return (
    <div className="nov-p-page">
      <section className="nov-p-card">
        <div className="nov-p-row">
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
              <h2 className="nov-hero-title">{sDict.title}</h2>
              <span
                className={writeLockActive ? 'nov-badge' : 'nov-badge is-offline'}
                style={
                  writeLockActive
                    ? {
                        background: 'var(--nov-danger-soft)',
                        color: 'var(--nov-danger)',
                        borderColor: 'var(--nov-danger)',
                      }
                    : undefined
                }
              >
                {writeLockActive ? `🔒 ${sDict.writeLockOn}` : `🔓 ${sDict.writeLockOff}`}
              </span>
            </div>
            <p className="nov-hero-sub">{sDict.subtitle}</p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
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
            <div className="nov-p-stat-label">{sDict.inProgressBadge}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-accent)' }}>
              {dagCounts.inProgress}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{sDict.doneBadge}</div>
            <div className="nov-p-stat-val">{dagCounts.done}</div>
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
            className={`nov-preset-btn ${tab === 'create' ? 'is-active' : ''}`}
            onClick={() => setTab('create')}
          >
            + {sDict.tabCreate}
          </button>
        </div>
      </section>

      {tab === 'board' && (
        <>
          {specs.length === 0 ? (
            <section className="nov-p-card">
              <p style={{ margin: 0, color: 'var(--nov-text-2)' }}>{sDict.emptySpecs}</p>
              <div>
                <button
                  type="button"
                  className="nov-p-btn is-primary"
                  onClick={() => setTab('create')}
                >
                  + {sDict.tabCreate}
                </button>
              </div>
            </section>
          ) : (
            <>
              {/* Spec switcher strip */}
              <section className="nov-p-card">
                <div className="nov-p-row">
                  <h3 className="nov-card-title">
                    {actions.specsLabel} ({specs.length})
                  </h3>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {specs.map((item) => {
                    const isSelected = activeSpec?.id === item.id;
                    const badge = getSpecStatusBadgeProps(item.status, sDict);
                    const switching = busyAction === `select:${item.id}`;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`nov-preset-btn ${isSelected ? 'is-active' : ''}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '6px 10px',
                        }}
                        disabled={isBusy}
                        onClick={() => {
                          if (!isSelected) {
                            void handleSetSpecStatus({
                              specId: item.id,
                              status: item.status,
                              setActive: true,
                              actionKey: `select:${item.id}`,
                            });
                          }
                        }}
                      >
                        <span>{switching ? dict.common.loading : item.title}</span>
                        <span className={badge.className} style={badge.style}>
                          {badge.text}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--nov-text-2)' }}>
                          {item.doneTasks}/{item.totalTasks}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {!activeSpec ? (
                <section className="nov-p-card">
                  <p style={{ margin: 0, color: 'var(--nov-text-2)' }}>
                    {actions.selectSpecHint}
                  </p>
                </section>
              ) : (
                <>
                  {/* Active spec details & write-gate switches */}
                  <section className="nov-p-card">
                <div className="nov-p-row">
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                    <h3 className="nov-card-title">{activeSpec.title}</h3>
                    {activeSpecStatusBadge && (
                      <span
                        className={activeSpecStatusBadge.className}
                        style={activeSpecStatusBadge.style}
                      >
                        {activeSpecStatusBadge.text}
                      </span>
                    )}
                    <code
                      style={{
                        fontSize: '11px',
                        color: 'var(--nov-text-2)',
                        fontFamily: 'var(--nov-font-mono)',
                      }}
                    >
                      {activeSpec.id}
                    </code>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {(['draft', 'approved', 'completed', 'archived'] as const).map((st) => {
                      const stBadge = getSpecStatusBadgeProps(st, sDict);
                      const isCurrent = activeSpec.status === st;
                      const key = `status:${st}`;
                      return (
                        <button
                          key={st}
                          type="button"
                          className={`nov-preset-btn ${isCurrent ? 'is-active' : ''}`}
                          disabled={isBusy || isCurrent}
                          onClick={() =>
                            void handleSetSpecStatus({
                              specId: activeSpec.id,
                              status: st,
                              setActive: true,
                              actionKey: key,
                              notifyText: `${activeSpec.title} -> ${stBadge.text}`,
                            })
                          }
                        >
                          {busyAction === key ? dict.common.loading : stBadge.text}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {activeSpec.goal && (
                  <p
                    style={{
                      margin: 0,
                      fontSize: '12.5px',
                      color: 'var(--nov-text-1)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {activeSpec.goal}
                  </p>
                )}

                <div
                  className="nov-p-item"
                  style={{ background: 'var(--nov-bg-0)', gap: '10px' }}
                >
                  <div className="nov-p-row">
                    <span style={{ fontSize: '12.5px', color: 'var(--nov-text-0)' }}>
                      {sDict.enforceLockLabel}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={activeSpec.enforcePlanBeforeWrite}
                      className="nov-switch"
                      disabled={isBusy}
                      onClick={() =>
                        void handleSetSpecStatus({
                          specId: activeSpec.id,
                          status: activeSpec.status,
                          enforcePlanBeforeWrite: !activeSpec.enforcePlanBeforeWrite,
                          setActive: true,
                          actionKey: 'toggle:enforce',
                        })
                      }
                    >
                      <span className="nov-switch-thumb" />
                    </button>
                  </div>

                  <div className="nov-p-row">
                    <span style={{ fontSize: '12.5px', color: 'var(--nov-text-0)' }}>
                      {sDict.requireUiApprovalLabel}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={activeSpec.requireUiApproval}
                      className="nov-switch"
                      disabled={isBusy}
                      onClick={() =>
                        void handleSetSpecStatus({
                          specId: activeSpec.id,
                          status: activeSpec.status,
                          requireUiApproval: !activeSpec.requireUiApproval,
                          setActive: true,
                          actionKey: 'toggle:uiApproval',
                        })
                      }
                    >
                      <span className="nov-switch-thumb" />
                    </button>
                  </div>
                </div>

                {Array.isArray(activeSpec.acceptanceCriteria) &&
                  activeSpec.acceptanceCriteria.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <strong style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                        {sDict.acceptanceTitle} ({activeSpec.acceptanceCriteria.length})
                      </strong>
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: '18px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                          fontSize: '12px',
                          color: 'var(--nov-text-1)',
                        }}
                      >
                        {activeSpec.acceptanceCriteria.map((criterion, i) => (
                          <li key={`${i}:${criterion}`}>{criterion}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                {Array.isArray(activeSpec.planSteps) && activeSpec.planSteps.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <strong style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                      {actions.planStepsLabel} ({activeSpec.planSteps.length})
                    </strong>
                    <ol
                      style={{
                        margin: 0,
                        paddingLeft: '18px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                        fontSize: '12px',
                        color: 'var(--nov-text-1)',
                      }}
                    >
                      {activeSpec.planSteps.map((step, i) => (
                        <li key={`${i}:${step}`}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </section>

              {/* Dependency Task DAG card */}
              <section className="nov-p-card">
                <div className="nov-p-row">
                  <h3 className="nov-card-title">
                    {sDict.tasksTitle} ({dagCounts.done}/{dagNodes.length})
                  </h3>
                </div>

                {dagNodes.length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--nov-text-2)' }}>{dict.common.empty}</p>
                ) : (
                  <div className="nov-p-list">
                    {dagNodes.map((node) => {
                      const { task, computedState, unmetDeps, depth } = node;
                      const badge = getTaskStateBadgeProps(computedState, sDict);
                      const hasUnmetDeps = unmetDeps.length > 0;
                      const indentPx = Math.min(depth, 5) * 20;

                      const canStart =
                        !hasUnmetDeps &&
                        task.status !== 'in_progress' &&
                        task.status !== 'done';
                      const canDone = !hasUnmetDeps && task.status !== 'done';
                      const canReset = task.status !== 'pending';

                      const startBusy = busyAction === `task:${task.id}:in_progress`;
                      const doneBusy = busyAction === `task:${task.id}:done`;
                      const resetBusy = busyAction === `task:${task.id}:pending`;

                      return (
                        <div
                          key={task.id}
                          style={{
                            marginLeft: `${indentPx}px`,
                            paddingLeft: depth > 0 ? '10px' : '0px',
                            borderLeft:
                              depth > 0 ? '2px solid var(--nov-border-strong)' : 'none',
                          }}
                        >
                          <div
                            className="nov-p-item"
                            style={
                              computedState === 'ready'
                                ? { borderColor: 'var(--nov-success)' }
                                : computedState === 'in_progress'
                                  ? { borderColor: 'var(--nov-accent)' }
                                  : undefined
                            }
                          >
                            <div className="nov-p-row">
                              <div
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  alignItems: 'center',
                                  gap: '6px',
                                  flex: 1,
                                  minWidth: '200px',
                                }}
                              >
                                <span
                                  className="nov-badge"
                                  style={{
                                    fontFamily: 'var(--nov-font-mono)',
                                    fontSize: '10.5px',
                                  }}
                                >
                                  L{depth}
                                </span>
                                <code
                                  style={{
                                    fontSize: '11.5px',
                                    color: 'var(--nov-text-2)',
                                    fontFamily: 'var(--nov-font-mono)',
                                  }}
                                >
                                  {task.id}
                                </code>
                                <strong
                                  style={{
                                    textDecoration:
                                      task.status === 'done' ? 'line-through' : 'none',
                                    opacity: task.status === 'done' ? 0.75 : 1,
                                  }}
                                >
                                  {task.title}
                                </strong>
                                <span className={badge.className} style={badge.style}>
                                  {badge.text}
                                </span>
                              </div>

                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                <button
                                  type="button"
                                  className="nov-p-btn"
                                  disabled={isBusy || !canStart}
                                  onClick={() => void handleUpdateTask(task.id, 'in_progress')}
                                >
                                  {startBusy ? dict.common.loading : actions.start}
                                </button>
                                <button
                                  type="button"
                                  className="nov-p-btn is-primary"
                                  disabled={isBusy || !canDone}
                                  onClick={() => void handleUpdateTask(task.id, 'done')}
                                >
                                  {doneBusy ? dict.common.loading : actions.done}
                                </button>
                                <button
                                  type="button"
                                  className="nov-p-btn"
                                  disabled={isBusy || !canReset}
                                  onClick={() => void handleUpdateTask(task.id, 'pending')}
                                >
                                  {resetBusy ? dict.common.loading : actions.reset}
                                </button>
                              </div>
                            </div>

                            {task.dependsOn.length > 0 && (
                              <div
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  alignItems: 'center',
                                  gap: '5px',
                                  fontSize: '11.5px',
                                  color: 'var(--nov-text-2)',
                                }}
                              >
                                <span>{actions.depsLabel}:</span>
                                {task.dependsOn.map((depId) => {
                                  const satisfied = taskStatusById.get(depId) === 'done';
                                  const depTitle = taskTitleById.get(depId);
                                  return (
                                    <span
                                      key={depId}
                                      className={`nov-badge ${satisfied ? 'is-offline' : 'is-network'}`}
                                      style={{ fontFamily: 'var(--nov-font-mono)' }}
                                      title={depTitle ?? depId}
                                    >
                                      {satisfied ? '✓' : '⏳'} {depId}
                                      {depTitle ? ` · ${depTitle}` : ''}
                                    </span>
                                  );
                                })}
                              </div>
                            )}

                            {(task.description || task.note) && (
                              <div
                                style={{
                                  fontSize: '12px',
                                  color: 'var(--nov-text-1)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '3px',
                                }}
                              >
                                {task.description && <span>{task.description}</span>}
                                {task.note && (
                                  <span style={{ color: 'var(--nov-text-2)' }}>
                                    {task.note}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
                </>
              )}
            </>
          )}
        </>
      )}

      {tab === 'create' && (
        <section className="nov-p-card">
          <h3 className="nov-card-title">{sDict.tabCreate}</h3>

          <input
            className="nov-p-input"
            value={draftTitle}
            placeholder={sDict.specTitlePlaceholder}
            disabled={isBusy}
            onChange={(e) => setDraftTitle(e.target.value)}
          />

          <textarea
            className="nov-p-textarea"
            style={{ fontFamily: 'var(--nov-font-sans)', minHeight: '78px' }}
            value={draftGoal}
            placeholder={sDict.specGoalPlaceholder}
            disabled={isBusy}
            onChange={(e) => setDraftGoal(e.target.value)}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '12px', color: 'var(--nov-text-1)', fontWeight: 600 }}>
              {sDict.acceptanceTitle}
            </label>
            <textarea
              className="nov-p-textarea"
              style={{ fontFamily: 'var(--nov-font-sans)', minHeight: '64px' }}
              value={draftAcceptance}
              placeholder="- npm run typecheck passes\n- Unit tests cover all edge cases"
              disabled={isBusy}
              onChange={(e) => setDraftAcceptance(e.target.value)}
            />
          </div>

          <div className="nov-p-item" style={{ background: 'var(--nov-bg-0)', gap: '10px' }}>
            <div className="nov-p-row">
              <span style={{ fontSize: '12.5px' }}>{sDict.enforceLockLabel}</span>
              <button
                type="button"
                role="switch"
                aria-checked={draftEnforceLock}
                className="nov-switch"
                disabled={isBusy}
                onClick={() => setDraftEnforceLock((prev) => !prev)}
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>
            <div className="nov-p-row">
              <span style={{ fontSize: '12.5px' }}>{sDict.requireUiApprovalLabel}</span>
              <button
                type="button"
                role="switch"
                aria-checked={draftRequireUiApproval}
                className="nov-switch"
                disabled={isBusy}
                onClick={() => setDraftRequireUiApproval((prev) => !prev)}
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>
          </div>

          {/* Multi-task DAG builder */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <strong style={{ fontSize: '12.5px', color: 'var(--nov-text-0)' }}>
              {sDict.tasksTitle} ({draftTasks.length})
            </strong>

            <div className="nov-p-row" style={{ flexWrap: 'nowrap' }}>
              <input
                className="nov-p-input"
                value={newTaskTitle}
                placeholder={sDict.addTaskPlaceholder}
                disabled={isBusy}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddDraftTask();
                  }
                }}
              />
              <button
                type="button"
                className="nov-p-btn"
                style={{ flexShrink: 0 }}
                disabled={isBusy || !newTaskTitle.trim()}
                onClick={handleAddDraftTask}
              >
                + {actions.addTask}
              </button>
            </div>

            {draftTasks.length > 0 && (
              <div className="nov-p-list">
                {draftTasks.map((task) => {
                  const otherTasks = draftTasks.filter((o) => o.id !== task.id);
                  return (
                    <div key={task.id} className="nov-p-item">
                      <div className="nov-p-row">
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            flex: 1,
                            minWidth: '200px',
                          }}
                        >
                          <code
                            className="nov-badge"
                            style={{ fontFamily: 'var(--nov-font-mono)' }}
                          >
                            {task.id}
                          </code>
                          <input
                            className="nov-p-input"
                            value={task.title}
                            disabled={isBusy}
                            onChange={(e) => {
                              const next = e.target.value;
                              setDraftTasks((prev) =>
                                prev.map((item) =>
                                  item.id === task.id ? { ...item, title: next } : item,
                                ),
                              );
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          className="nov-p-btn is-danger"
                          disabled={isBusy}
                          onClick={() => handleRemoveDraftTask(task.id)}
                        >
                          {dict.common.delete}
                        </button>
                      </div>

                      {otherTasks.length > 0 && (
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '11.5px',
                            color: 'var(--nov-text-2)',
                          }}
                        >
                          <span>{actions.depsLabel}:</span>
                          {otherTasks.map((candidate) => {
                            const checked = task.dependsOn.includes(candidate.id);
                            const cycleBlocked =
                              !checked &&
                              wouldCreateDraftCycle(draftTasks, task.id, candidate.id);
                            return (
                              <button
                                key={candidate.id}
                                type="button"
                                className={`nov-cat-pill ${checked ? 'is-active' : ''}`}
                                disabled={isBusy || cycleBlocked}
                                onClick={() => handleToggleDraftDep(task.id, candidate.id)}
                              >
                                {checked ? '✓ ' : '+ '}
                                {candidate.id}: {candidate.title}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="nov-p-row" style={{ justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="nov-p-btn is-primary"
              disabled={isBusy || !draftTitle.trim() || !draftGoal.trim()}
              onClick={() => void handleCreateSpec()}
            >
              {busyAction === 'create' ? dict.common.loading : sDict.createSpecBtn}
            </button>
          </div>
        </section>
      )}
    </div>
  );
};
