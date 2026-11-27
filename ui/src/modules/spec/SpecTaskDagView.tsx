import React from 'react';
import { useNovI18n } from '../../i18n/index.js';
import { getDeltaKindLabel } from './spec-labels.js';
import {
  SPEC_STYLES,
  getDeltaKindStyle,
  getSpecStatusBadgeProps,
  getTaskStateBadgeProps,
} from './spec-styles.js';
import type {
  NormalizedTaskNode,
  SetSpecStatusParams,
  SpecDocumentView,
  SpecMode,
  SpecPanelExtraLabels,
  SpecSummaryItem,
  SpecTaskStatus,
} from './spec-types.js';

export interface SpecTaskDagViewProps {
  specs: SpecSummaryItem[];
  activeSpec: SpecDocumentView | null;
  dagNodes: NormalizedTaskNode[];
  dagCounts: { ready: number; inProgress: number; done: number };
  taskTitleById: Map<string, string>;
  taskStatusById: Map<string, SpecTaskStatus>;
  unresolvedCount: number;
  busyAction: string | null;
  isBusy: boolean;
  actions: SpecPanelExtraLabels;
  onOpenCreate: () => void;
  onOpenReview: () => void;
  onSetSpecStatus: (params: SetSpecStatusParams) => Promise<void>;
  onUpdateTask: (taskId: string, status: SpecTaskStatus) => Promise<void>;
  onArchiveToMem: () => Promise<void>;
}

export const SpecTaskDagView: React.FC<SpecTaskDagViewProps> = ({
  specs,
  activeSpec,
  dagNodes,
  dagCounts,
  taskTitleById,
  taskStatusById,
  unresolvedCount,
  busyAction,
  isBusy,
  actions,
  onOpenCreate,
  onOpenReview,
  onSetSpecStatus,
  onUpdateTask,
  onArchiveToMem,
}) => {
  const { dict } = useNovI18n();
  const sDict = dict.panels.spec;

  if (specs.length === 0) {
    return (
      <section className="nov-p-card">
        <p style={SPEC_STYLES.mutedParagraph}>{sDict.emptySpecs}</p>
        <div>
          <button
            type="button"
            className="nov-p-btn is-primary"
            onClick={onOpenCreate}
          >
            + {actions.tabCreateDelta}
          </button>
        </div>
      </section>
    );
  }

  const activeSpecStatusBadge = activeSpec ? getSpecStatusBadgeProps(activeSpec.status, sDict) : null;
  const activeSpecMode: SpecMode = activeSpec?.mode === 'delta' ? 'delta' : 'full';
  const activeRevision = activeSpec?.revision ?? 1;
  const activeDeltaItems = Array.isArray(activeSpec?.deltaItems) ? activeSpec.deltaItems : [];

  return (
    <>
      {/* Spec switcher strip */}
      <section className="nov-p-card">
        <div className="nov-p-row">
          <h3 className="nov-card-title">
            {actions.specsLabel} ({specs.length})
          </h3>
        </div>
        <div style={SPEC_STYLES.flexWrapGap8}>
          {specs.map((item) => {
            const isSelected = activeSpec?.id === item.id;
            const badge = getSpecStatusBadgeProps(item.status, sDict);
            const switching = busyAction === `select:${item.id}`;
            const itemMode: SpecMode = item.mode === 'delta' ? 'delta' : 'full';
            const itemOpenAnn = item.unresolvedAnnotations ?? 0;
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
                    void onSetSpecStatus({
                      specId: item.id,
                      status: item.status,
                      setActive: true,
                      actionKey: `select:${item.id}`,
                    });
                  }
                }}
              >
                <span
                  className={`nov-badge ${itemMode === 'delta' ? 'is-accent' : ''}`}
                  style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '10px' }}
                >
                  {itemMode === 'delta' ? actions.modeDeltaBadge : actions.modeFullBadge}
                </span>
                <span>{switching ? dict.common.loading : item.title}</span>
                <span className={badge.className} style={badge.style}>
                  {badge.text}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--nov-text-2)' }}>
                  v{item.revision ?? 1} · {item.doneTasks}/{item.totalTasks}
                </span>
                {itemOpenAnn > 0 && (
                  <span className="nov-badge is-network" style={{ fontSize: '10px' }}>
                    {itemOpenAnn} {actions.unresolvedBadge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {!activeSpec ? (
        <section className="nov-p-card">
          <p style={SPEC_STYLES.mutedParagraph}>{actions.selectSpecHint}</p>
        </section>
      ) : (
        <>
          {/* Active spec details, Delta contract, Archive-to-Mem & write-gate switches */}
          <section className="nov-p-card">
            <div className="nov-p-row">
              <div style={SPEC_STYLES.flexWrapCenterGap8}>
                <h3 className="nov-card-title">{activeSpec.title}</h3>
                <span
                  className={`nov-badge ${activeSpecMode === 'delta' ? 'is-accent' : ''}`}
                  style={SPEC_STYLES.mono}
                >
                  {activeSpecMode === 'delta' ? actions.modeDeltaBadge : actions.modeFullBadge}
                </span>
                <span className="nov-badge" style={SPEC_STYLES.mono}>
                  v{activeRevision}
                </span>
                {activeSpecStatusBadge && (
                  <span
                    className={activeSpecStatusBadge.className}
                    style={activeSpecStatusBadge.style}
                  >
                    {activeSpecStatusBadge.text}
                  </span>
                )}
                {activeSpec.archivedMemoryId && (
                  <span
                    className="nov-badge is-offline"
                    title={activeSpec.archivedMemoryId}
                  >
                    ✓ {actions.archivedBadge} ({activeSpec.archivedMemoryId})
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

              <div style={SPEC_STYLES.flexWrapGap6}>
                <button
                  type="button"
                  className="nov-p-btn"
                  disabled={isBusy}
                  onClick={onOpenReview}
                >
                  {actions.openReviewLink}
                  {unresolvedCount > 0 ? ` (${unresolvedCount})` : ''}
                </button>
                <button
                  type="button"
                  className="nov-p-btn"
                  disabled={isBusy}
                  onClick={() => void onArchiveToMem()}
                >
                  {busyAction === 'archive-mem'
                    ? dict.common.loading
                    : activeSpec.archivedMemoryId
                      ? actions.updateMemArchiveBtn
                      : actions.archiveToMemBtn}
                </button>
              </div>
            </div>

            <div style={SPEC_STYLES.flexWrapGap6}>
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
                      void onSetSpecStatus({
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

            {/* Behavioral Delta Contract list */}
            {activeDeltaItems.length > 0 && (
              <div
                className="nov-p-item"
                style={{ background: 'var(--nov-bg-0)', gap: '8px' }}
              >
                <strong style={{ fontSize: '12px', color: 'var(--nov-text-0)' }}>
                  {actions.deltaSectionTitle} ({activeDeltaItems.length})
                </strong>
                <div style={SPEC_STYLES.flexColGap6}>
                  {activeDeltaItems.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        ...SPEC_STYLES.flexWrapCenterGap6,
                        fontSize: '12px',
                      }}
                    >
                      <span
                        className="nov-badge"
                        style={{
                          ...getDeltaKindStyle(item.kind),
                          ...SPEC_STYLES.monoXs,
                        }}
                      >
                        {getDeltaKindLabel(item.kind, actions)}
                      </span>
                      {item.area && (
                        <code className="nov-badge" style={SPEC_STYLES.monoXs}>
                          {item.area}
                        </code>
                      )}
                      <span style={{ color: 'var(--nov-text-1)' }}>{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>
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
                    void onSetSpecStatus({
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
                    void onSetSpecStatus({
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
                <div style={SPEC_STYLES.flexColGap4}>
                  <strong style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                    {sDict.acceptanceTitle} ({activeSpec.acceptanceCriteria.length})
                  </strong>
                  <ul style={SPEC_STYLES.orderedUnorderedList}>
                    {activeSpec.acceptanceCriteria.map((criterion, i) => (
                      <li key={`${i}:${criterion}`}>{criterion}</li>
                    ))}
                  </ul>
                </div>
              )}

            {Array.isArray(activeSpec.planSteps) && activeSpec.planSteps.length > 0 && (
              <div style={SPEC_STYLES.flexColGap4}>
                <strong style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                  {actions.planStepsLabel} ({activeSpec.planSteps.length})
                </strong>
                <ol style={SPEC_STYLES.orderedUnorderedList}>
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
              <p style={SPEC_STYLES.mutedParagraph}>{dict.common.empty}</p>
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
                              ...SPEC_STYLES.flexWrapCenterGap6,
                              flex: 1,
                              minWidth: '200px',
                            }}
                          >
                            <span className="nov-badge" style={SPEC_STYLES.monoXs}>
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

                          <div style={SPEC_STYLES.flexWrapGap6}>
                            <button
                              type="button"
                              className="nov-p-btn"
                              disabled={isBusy || !canStart}
                              onClick={() => void onUpdateTask(task.id, 'in_progress')}
                            >
                              {startBusy ? dict.common.loading : actions.start}
                            </button>
                            <button
                              type="button"
                              className="nov-p-btn is-primary"
                              disabled={isBusy || !canDone}
                              onClick={() => void onUpdateTask(task.id, 'done')}
                            >
                              {doneBusy ? dict.common.loading : actions.done}
                            </button>
                            <button
                              type="button"
                              className="nov-p-btn"
                              disabled={isBusy || !canReset}
                              onClick={() => void onUpdateTask(task.id, 'pending')}
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
                                  style={SPEC_STYLES.mono}
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
  );
};
