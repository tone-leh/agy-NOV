import React from 'react';
import { useNovI18n } from '../../i18n/index.js';
import { getDeltaKindLabel } from './spec-labels.js';
import { SPEC_STYLES, getDeltaKindStyle } from './spec-styles.js';
import {
  wouldCreateDraftCycle,
  type DraftDeltaItem,
  type DraftTaskItem,
  type SpecDeltaKind,
  type SpecMode,
  type SpecPanelExtraLabels,
} from './spec-types.js';

export interface SpecCreateModalProps {
  draftMode: SpecMode;
  draftTitle: string;
  draftGoal: string;
  draftPlanMarkdown: string;
  draftAcceptance: string;
  draftEnforceLock: boolean;
  draftRequireUiApproval: boolean;
  newDeltaKind: SpecDeltaKind;
  newDeltaArea: string;
  newDeltaText: string;
  draftDeltas: DraftDeltaItem[];
  newTaskTitle: string;
  draftTasks: DraftTaskItem[];
  busyAction: string | null;
  isBusy: boolean;
  actions: SpecPanelExtraLabels;
  onSetDraftMode: (mode: SpecMode) => void;
  onSetDraftTitle: (val: string) => void;
  onSetDraftGoal: (val: string) => void;
  onSetDraftPlanMarkdown: (val: string) => void;
  onSetDraftAcceptance: (val: string) => void;
  onToggleDraftEnforceLock: () => void;
  onToggleDraftRequireUiApproval: () => void;
  onSetNewDeltaKind: (kind: SpecDeltaKind) => void;
  onSetNewDeltaArea: (val: string) => void;
  onSetNewDeltaText: (val: string) => void;
  onAddDraftDelta: () => void;
  onRemoveDraftDelta: (id: string) => void;
  onSetNewTaskTitle: (val: string) => void;
  onAddDraftTask: () => void;
  onRemoveDraftTask: (id: string) => void;
  onUpdateDraftTaskTitle: (id: string, title: string) => void;
  onToggleDraftDep: (taskId: string, depId: string) => void;
  onCreateSpec: () => Promise<void>;
}

export const SpecCreateModal: React.FC<SpecCreateModalProps> = ({
  draftMode,
  draftTitle,
  draftGoal,
  draftPlanMarkdown,
  draftAcceptance,
  draftEnforceLock,
  draftRequireUiApproval,
  newDeltaKind,
  newDeltaArea,
  newDeltaText,
  draftDeltas,
  newTaskTitle,
  draftTasks,
  busyAction,
  isBusy,
  actions,
  onSetDraftMode,
  onSetDraftTitle,
  onSetDraftGoal,
  onSetDraftPlanMarkdown,
  onSetDraftAcceptance,
  onToggleDraftEnforceLock,
  onToggleDraftRequireUiApproval,
  onSetNewDeltaKind,
  onSetNewDeltaArea,
  onSetNewDeltaText,
  onAddDraftDelta,
  onRemoveDraftDelta,
  onSetNewTaskTitle,
  onAddDraftTask,
  onRemoveDraftTask,
  onUpdateDraftTaskTitle,
  onToggleDraftDep,
  onCreateSpec,
}) => {
  const { dict } = useNovI18n();
  const sDict = dict.panels.spec;

  return (
    <section className="nov-p-card">
      <h3 className="nov-card-title">{actions.tabCreateDelta}</h3>

      {/* Full Spec vs Brownfield Delta Spec selector */}
      <div style={SPEC_STYLES.modeGrid}>
        <button
          type="button"
          className="nov-p-item"
          style={{
            textAlign: 'left',
            cursor: 'pointer',
            borderColor: draftMode === 'full' ? 'var(--nov-accent)' : 'var(--nov-border)',
            background: draftMode === 'full' ? 'var(--nov-accent-soft)' : 'var(--nov-bg-0)',
          }}
          disabled={isBusy}
          onClick={() => onSetDraftMode('full')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="nov-badge" style={SPEC_STYLES.mono}>
              {actions.modeFullBadge}
            </span>
            <strong style={{ color: 'var(--nov-text-0)', fontSize: '12.5px' }}>
              {actions.modeFullTitle}
            </strong>
          </div>
          <span style={{ fontSize: '11.5px', color: 'var(--nov-text-1)' }}>
            {actions.modeFullDesc}
          </span>
        </button>

        <button
          type="button"
          className="nov-p-item"
          style={{
            textAlign: 'left',
            cursor: 'pointer',
            borderColor: draftMode === 'delta' ? 'var(--nov-accent)' : 'var(--nov-border)',
            background: draftMode === 'delta' ? 'var(--nov-accent-soft)' : 'var(--nov-bg-0)',
          }}
          disabled={isBusy}
          onClick={() => onSetDraftMode('delta')}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="nov-badge is-accent" style={SPEC_STYLES.mono}>
              {actions.modeDeltaBadge}
            </span>
            <strong style={{ color: 'var(--nov-text-0)', fontSize: '12.5px' }}>
              {actions.modeDeltaTitle}
            </strong>
          </div>
          <span style={{ fontSize: '11.5px', color: 'var(--nov-text-1)' }}>
            {actions.modeDeltaDesc}
          </span>
        </button>
      </div>

      <input
        className="nov-p-input"
        value={draftTitle}
        placeholder={sDict.specTitlePlaceholder}
        disabled={isBusy}
        onChange={(e) => onSetDraftTitle(e.target.value)}
      />

      <textarea
        className="nov-p-textarea"
        style={{ fontFamily: 'var(--nov-font-sans)', minHeight: '72px' }}
        value={draftGoal}
        placeholder={sDict.specGoalPlaceholder}
        disabled={isBusy}
        onChange={(e) => onSetDraftGoal(e.target.value)}
      />

      {/* Brownfield Delta items builder */}
      <div
        className="nov-p-item"
        style={{
          background: 'var(--nov-bg-0)',
          borderColor: draftMode === 'delta' ? 'var(--nov-accent)' : 'var(--nov-border)',
          gap: '8px',
        }}
      >
        <strong style={{ fontSize: '12.5px', color: 'var(--nov-text-0)' }}>
          {actions.deltaSectionTitle} ({draftDeltas.length})
        </strong>

        <div style={SPEC_STYLES.deltaInputGrid}>
          <select
            className="nov-p-select"
            value={newDeltaKind}
            disabled={isBusy}
            onChange={(e) => onSetNewDeltaKind(e.target.value as SpecDeltaKind)}
          >
            <option value="added">{actions.deltaAdded}</option>
            <option value="modified">{actions.deltaModified}</option>
            <option value="removed">{actions.deltaRemoved}</option>
          </select>

          <input
            className="nov-p-input"
            value={newDeltaArea}
            placeholder={actions.deltaAreaPlaceholder}
            disabled={isBusy}
            onChange={(e) => onSetNewDeltaArea(e.target.value)}
          />

          <input
            className="nov-p-input"
            value={newDeltaText}
            placeholder={actions.deltaTextPlaceholder}
            disabled={isBusy}
            onChange={(e) => onSetNewDeltaText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAddDraftDelta();
              }
            }}
          />

          <button
            type="button"
            className="nov-p-btn"
            disabled={isBusy || !newDeltaText.trim()}
            onClick={onAddDraftDelta}
          >
            + {actions.addDeltaBtn}
          </button>
        </div>

        {draftDeltas.length > 0 && (
          <div className="nov-p-list">
            {draftDeltas.map((item) => (
              <div key={item.id} className="nov-p-row">
                <div style={SPEC_STYLES.flexWrapCenterGap6}>
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
                    <code className="nov-badge" style={SPEC_STYLES.mono}>
                      {item.area}
                    </code>
                  )}
                  <span style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                    {item.text}
                  </span>
                </div>
                <button
                  type="button"
                  className="nov-open-btn"
                  style={{ color: 'var(--nov-danger)' }}
                  disabled={isBusy}
                  onClick={() => onRemoveDraftDelta(item.id)}
                >
                  {dict.common.delete}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Plan Markdown editor */}
      <div style={SPEC_STYLES.flexColGap4}>
        <label style={{ fontSize: '12px', color: 'var(--nov-text-1)', fontWeight: 600 }}>
          {actions.planMarkdownLabel}
        </label>
        <span style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
          {actions.planMarkdownHint}
        </span>
        <textarea
          className="nov-p-textarea"
          style={{ minHeight: '96px' }}
          value={draftPlanMarkdown}
          placeholder={actions.planMarkdownPlaceholder}
          disabled={isBusy}
          onChange={(e) => onSetDraftPlanMarkdown(e.target.value)}
        />
      </div>

      <div style={SPEC_STYLES.flexColGap4}>
        <label style={{ fontSize: '12px', color: 'var(--nov-text-1)', fontWeight: 600 }}>
          {sDict.acceptanceTitle}
        </label>
        <textarea
          className="nov-p-textarea"
          style={{ fontFamily: 'var(--nov-font-sans)', minHeight: '64px' }}
          value={draftAcceptance}
          placeholder={actions.acceptancePlaceholder}
          disabled={isBusy}
          onChange={(e) => onSetDraftAcceptance(e.target.value)}
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
            onClick={onToggleDraftEnforceLock}
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
            onClick={onToggleDraftRequireUiApproval}
          >
            <span className="nov-switch-thumb" />
          </button>
        </div>
      </div>

      {/* Multi-task DAG builder */}
      <div style={SPEC_STYLES.flexColGap8}>
        <strong style={{ fontSize: '12.5px', color: 'var(--nov-text-0)' }}>
          {sDict.tasksTitle} ({draftTasks.length})
        </strong>

        <div className="nov-p-row" style={{ flexWrap: 'nowrap' }}>
          <input
            className="nov-p-input"
            value={newTaskTitle}
            placeholder={sDict.addTaskPlaceholder}
            disabled={isBusy}
            onChange={(e) => onSetNewTaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAddDraftTask();
              }
            }}
          />
          <button
            type="button"
            className="nov-p-btn"
            style={{ flexShrink: 0 }}
            disabled={isBusy || !newTaskTitle.trim()}
            onClick={onAddDraftTask}
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
                      <code className="nov-badge" style={SPEC_STYLES.mono}>
                        {task.id}
                      </code>
                      <input
                        className="nov-p-input"
                        value={task.title}
                        disabled={isBusy}
                        onChange={(e) => onUpdateDraftTaskTitle(task.id, e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="nov-p-btn is-danger"
                      disabled={isBusy}
                      onClick={() => onRemoveDraftTask(task.id)}
                    >
                      {dict.common.delete}
                    </button>
                  </div>

                  {otherTasks.length > 0 && (
                    <div
                      style={{
                        ...SPEC_STYLES.flexWrapCenterGap6,
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
                            onClick={() => onToggleDraftDep(task.id, candidate.id)}
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
          onClick={() => void onCreateSpec()}
        >
          {busyAction === 'create' ? dict.common.loading : sDict.createSpecBtn}
        </button>
      </div>
    </section>
  );
};
