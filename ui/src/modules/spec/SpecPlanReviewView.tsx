import React from 'react';
import { useNovI18n } from '../../i18n/index.js';
import { getAnnotationKindLabel } from './spec-labels.js';
import {
  SPEC_STYLES,
  getAnnotationBorderLeft,
  getAnnotationKindStyle,
} from './spec-styles.js';
import type {
  SpecAnnotationKind,
  SpecDocumentView,
  SpecMode,
  SpecPanelExtraLabels,
  SpecPlanAnnotation,
  SpecRevisionDiffResponse,
} from './spec-types.js';

export interface LineDecorationsState {
  strikeLines: Set<number>;
  replaceLines: Set<number>;
  commentLines: Set<number>;
  byEndLine: Map<number, SpecPlanAnnotation[]>;
  detached: SpecPlanAnnotation[];
}

export interface SpecPlanReviewViewProps {
  activeSpec: SpecDocumentView | null;
  specsCount: number;
  planLines: string[];
  lineDecorations: LineDecorationsState;
  unresolvedCount: number;
  availableRevisions: number[];
  canSendMessage: boolean;
  busyAction: string | null;
  isBusy: boolean;
  actions: SpecPanelExtraLabels;
  selStart: number | null;
  selEnd: number | null;
  annKind: SpecAnnotationKind;
  annNote: string;
  annSuggestedText: string;
  showResolved: boolean;
  diffMode: boolean;
  diffFromRev: number | undefined;
  diffToRev: number | undefined;
  diffResult: SpecRevisionDiffResponse | null;
  onSetSelStart: (val: number | null) => void;
  onSetSelEnd: (val: number | null) => void;
  onSetAnnKind: (val: SpecAnnotationKind) => void;
  onSetAnnNote: (val: string) => void;
  onSetAnnSuggestedText: (val: string) => void;
  onSetShowResolved: (val: boolean) => void;
  onSetDiffMode: (val: boolean) => void;
  onSetDiffFromRev: (val: number | undefined) => void;
  onSetDiffToRev: (val: number | undefined) => void;
  onLoadRevisionDiff: (specId: string, fromRev?: number, toRev?: number) => Promise<void>;
  onSelectPlanLine: (lineNumber: number, shiftKey: boolean) => void;
  onSubmitAnnotation: () => Promise<void>;
  onResolveOrDeleteAnnotation: (
    annotationId: string,
    action: 'resolve' | 'reopen' | 'delete',
  ) => Promise<void>;
  onSendFeedbackToAgent: () => Promise<void>;
  onCopyFeedbackPrompt: () => Promise<void>;
}

export const SpecPlanReviewView: React.FC<SpecPlanReviewViewProps> = ({
  activeSpec,
  specsCount,
  planLines,
  lineDecorations,
  unresolvedCount,
  availableRevisions,
  canSendMessage,
  busyAction,
  isBusy,
  actions,
  selStart,
  selEnd,
  annKind,
  annNote,
  annSuggestedText,
  showResolved,
  diffMode,
  diffFromRev,
  diffToRev,
  diffResult,
  onSetSelStart,
  onSetSelEnd,
  onSetAnnKind,
  onSetAnnNote,
  onSetAnnSuggestedText,
  onSetShowResolved,
  onSetDiffMode,
  onSetDiffFromRev,
  onSetDiffToRev,
  onLoadRevisionDiff,
  onSelectPlanLine,
  onSubmitAnnotation,
  onResolveOrDeleteAnnotation,
  onSendFeedbackToAgent,
  onCopyFeedbackPrompt,
}) => {
  const { dict } = useNovI18n();
  const sDict = dict.panels.spec;
  const INITIAL_PLAN_LINE_BUDGET = 400;
  const [planLineLimit, setPlanLineLimit] = React.useState<number>(INITIAL_PLAN_LINE_BUDGET);

  React.useEffect(() => {
    setPlanLineLimit(INITIAL_PLAN_LINE_BUDGET);
  }, [activeSpec?.id]);

  if (!activeSpec) {
    return (
      <section className="nov-p-card">
        <p style={SPEC_STYLES.mutedParagraph}>
          {specsCount === 0 ? sDict.emptySpecs : actions.selectSpecHint}
        </p>
      </section>
    );
  }

  const activeSpecMode: SpecMode = activeSpec.mode === 'delta' ? 'delta' : 'full';
  const activeRevision = activeSpec.revision ?? 1;

  const renderAnnotationCard = (ann: SpecPlanAnnotation) => {
    const kindStyle = getAnnotationKindStyle(ann.kind);
    const rangeText =
      ann.lineStart === ann.lineEnd ? `L${ann.lineStart}` : `L${ann.lineStart}–L${ann.lineEnd}`;
    return (
      <div
        key={ann.id}
        className="nov-p-item"
        style={{
          margin: '6px 10px',
          background: 'var(--nov-bg-1)',
          opacity: ann.resolved ? 0.65 : 1,
          borderLeft: getAnnotationBorderLeft(ann.kind),
        }}
      >
        <div className="nov-p-row">
          <div style={SPEC_STYLES.flexWrapCenterGap6}>
            <span className="nov-badge" style={kindStyle}>
              {getAnnotationKindLabel(ann.kind, actions)}
            </span>
            <code className="nov-badge" style={SPEC_STYLES.monoXs}>
              {rangeText} · v{ann.revision}
            </code>
            {ann.resolved && <span className="nov-badge is-offline">{actions.resolvedBadge}</span>}
          </div>

          <div style={SPEC_STYLES.flexWrapGap6}>
            <button
              type="button"
              className="nov-open-btn"
              disabled={isBusy}
              onClick={() =>
                void onResolveOrDeleteAnnotation(ann.id, ann.resolved ? 'reopen' : 'resolve')
              }
            >
              {ann.resolved ? actions.reopenBtn : actions.resolveBtn}
            </button>
            <button
              type="button"
              className="nov-open-btn"
              style={{ color: 'var(--nov-danger)' }}
              disabled={isBusy}
              onClick={() => void onResolveOrDeleteAnnotation(ann.id, 'delete')}
            >
              {dict.common.delete}
            </button>
          </div>
        </div>

        {ann.note && (
          <div style={{ fontSize: '12px', color: 'var(--nov-text-0)', whiteSpace: 'pre-wrap' }}>
            {ann.note}
          </div>
        )}

        {ann.kind === 'replace' && ann.suggestedText && (
          <div style={SPEC_STYLES.flexColGap4}>
            <span style={{ fontSize: '11px', color: 'var(--nov-text-2)', fontWeight: 600 }}>
              {actions.suggestedLabel}:
            </span>
            <pre className="nov-p-pre" style={SPEC_STYLES.suggestedPre}>
              {ann.suggestedText}
            </pre>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="nov-p-card">
      {/* Review toolbar */}
      <div className="nov-p-row">
        <div style={SPEC_STYLES.flexWrapCenterGap8}>
          <h3 className="nov-card-title">{activeSpec.title}</h3>
          <span
            className={`nov-badge ${activeSpecMode === 'delta' ? 'is-accent' : ''}`}
            style={SPEC_STYLES.mono}
          >
            {activeSpecMode === 'delta' ? actions.modeDeltaBadge : actions.modeFullBadge} ·
            v{activeRevision}
          </span>
          <span
            className={`nov-badge ${unresolvedCount > 0 ? 'is-network' : 'is-offline'}`}
          >
            {unresolvedCount > 0
              ? `${unresolvedCount} ${actions.unresolvedBadge}`
              : actions.allResolvedHint}
          </span>
        </div>

        <div style={SPEC_STYLES.flexWrapGap6AlignCenter}>
          <button
            type="button"
            className={`nov-p-btn ${diffMode ? 'is-primary' : ''}`}
            disabled={isBusy}
            onClick={() => {
              if (diffMode) {
                onSetDiffMode(false);
              } else {
                void onLoadRevisionDiff(activeSpec.id);
              }
            }}
          >
            {busyAction === 'diff'
              ? dict.common.loading
              : diffMode
                ? actions.exitDiffBtn
                : availableRevisions.length >= 2
                  ? `${actions.toggleDiffBtn} (v${availableRevisions[availableRevisions.length - 2]} → v${availableRevisions[availableRevisions.length - 1]})`
                  : actions.toggleDiffBtn}
          </button>

          <button
            type="button"
            className="nov-p-btn is-primary"
            disabled={isBusy || unresolvedCount === 0}
            onClick={() => void onSendFeedbackToAgent()}
          >
            {busyAction === 'send-feedback'
              ? dict.common.loading
              : `${canSendMessage ? actions.sendFeedbackBtn : dict.common.copyPrompt} (${unresolvedCount})`}
          </button>

          <button
            type="button"
            className="nov-p-btn"
            disabled={isBusy || unresolvedCount === 0}
            onClick={() => void onCopyFeedbackPrompt()}
          >
            {actions.copyFeedbackBtn}
          </button>
        </div>
      </div>

      {diffMode ? (
        /* Revision Diff view */
        <div style={SPEC_STYLES.flexColGap10}>
          {availableRevisions.length < 2 ? (
            <div className="nov-p-banner">{actions.diffSingleRevHint}</div>
          ) : (
            <div className="nov-p-row">
              <div style={SPEC_STYLES.flexWrapCenterGap8}>
                <label style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                  {actions.diffFromLabel}:
                </label>
                <select
                  className="nov-p-select"
                  style={SPEC_STYLES.diffSelect}
                  value={diffFromRev ?? availableRevisions[0]}
                  disabled={isBusy}
                  onChange={(e) => {
                    const nextFrom = Number(e.target.value);
                    onSetDiffFromRev(nextFrom);
                    void onLoadRevisionDiff(
                      activeSpec.id,
                      nextFrom,
                      diffToRev ?? activeRevision,
                    );
                  }}
                >
                  {availableRevisions.map((rev) => (
                    <option key={rev} value={rev}>
                      v{rev}
                    </option>
                  ))}
                </select>

                <span style={{ color: 'var(--nov-text-2)' }}>→</span>

                <label style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                  {actions.diffToLabel}:
                </label>
                <select
                  className="nov-p-select"
                  style={SPEC_STYLES.diffSelect}
                  value={diffToRev ?? activeRevision}
                  disabled={isBusy}
                  onChange={(e) => {
                    const nextTo = Number(e.target.value);
                    onSetDiffToRev(nextTo);
                    void onLoadRevisionDiff(
                      activeSpec.id,
                      diffFromRev ?? availableRevisions[0],
                      nextTo,
                    );
                  }}
                >
                  {availableRevisions.map((rev) => (
                    <option key={rev} value={rev}>
                      v{rev}
                    </option>
                  ))}
                </select>
              </div>

              {diffResult && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <span className="nov-badge" style={SPEC_STYLES.diffAddedBadge}>
                    +{diffResult.addedLines}
                  </span>
                  <span className="nov-badge" style={SPEC_STYLES.diffRemovedBadge}>
                    -{diffResult.removedLines}
                  </span>
                </div>
              )}
            </div>
          )}

          {diffResult?.degraded && (
            <div className="nov-p-banner">{actions.diffDegradedNotice}</div>
          )}

          {diffResult &&
            diffResult.addedLines === 0 &&
            diffResult.removedLines === 0 && (
              <div className="nov-p-banner">{actions.diffNoChangesHint}</div>
            )}

          {diffResult && (
            <div style={SPEC_STYLES.diffContainer}>
              {diffResult.hunks.map((hunk, idx) => {
                const isAdd = hunk.type === 'add';
                const isDel = hunk.type === 'del';
                const bg = isAdd
                  ? 'var(--nov-success-soft)'
                  : isDel
                    ? 'var(--nov-danger-soft)'
                    : 'transparent';
                const markerColor = isAdd
                  ? 'var(--nov-success)'
                  : isDel
                    ? 'var(--nov-danger)'
                    : 'var(--nov-text-2)';
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '42px 42px 18px 1fr',
                      background: bg,
                      borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
                      lineHeight: 1.55,
                    }}
                  >
                    <span style={SPEC_STYLES.diffLineNumLeft}>{hunk.oldLine ?? ''}</span>
                    <span style={SPEC_STYLES.diffLineNumRight}>{hunk.newLine ?? ''}</span>
                    <span
                      style={{
                        textAlign: 'center',
                        fontWeight: 700,
                        color: markerColor,
                        userSelect: 'none',
                      }}
                    >
                      {isAdd ? '+' : isDel ? '-' : ' '}
                    </span>
                    <span
                      style={{
                        padding: '1px 8px 1px 2px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        color: 'var(--nov-text-0)',
                        textDecoration: isDel ? 'line-through' : 'none',
                      }}
                    >
                      {hunk.text || ' '}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Plannotator line-by-line review workbench */
        <div style={SPEC_STYLES.flexColGap10}>
          <div className="nov-p-row">
            <span style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
              {actions.reviewLineHint}
            </span>

            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: 'var(--nov-text-1)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => onSetShowResolved(e.target.checked)}
              />
              <span>{actions.showResolvedLabel}</span>
            </label>
          </div>

          {planLines.length === 0 ? (
            <p style={SPEC_STYLES.mutedParagraph}>{actions.emptyPlanHint}</p>
          ) : (
            <div style={SPEC_STYLES.codeBox}>
              {planLines.slice(0, planLineLimit).map((lineText, idx) => {
                const lineNum = idx + 1;
                const normStart =
                  selStart !== null && selEnd !== null
                    ? Math.min(selStart, selEnd)
                    : null;
                const normEnd =
                  selStart !== null && selEnd !== null
                    ? Math.max(selStart, selEnd)
                    : null;
                const isSelected =
                  normStart !== null &&
                  normEnd !== null &&
                  lineNum >= normStart &&
                  lineNum <= normEnd;
                const isStruck = lineDecorations.strikeLines.has(lineNum);
                const isReplaced = lineDecorations.replaceLines.has(lineNum);
                const isCommented = lineDecorations.commentLines.has(lineNum);
                const lineAnnotations = lineDecorations.byEndLine.get(lineNum) ?? [];

                let rowBg = 'transparent';
                let leftBorder = '3px solid transparent';
                if (isSelected) {
                  rowBg = 'var(--nov-accent-soft)';
                  leftBorder = '3px solid var(--nov-accent)';
                } else if (isStruck) {
                  rowBg = 'var(--nov-danger-soft)';
                  leftBorder = '3px solid var(--nov-danger)';
                } else if (isReplaced) {
                  rowBg = 'var(--nov-warn-soft)';
                  leftBorder = '3px solid var(--nov-warn)';
                } else if (isCommented) {
                  rowBg = 'var(--nov-accent-soft)';
                  leftBorder = '3px solid var(--nov-accent)';
                }

                return (
                  <React.Fragment key={lineNum}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '48px 1fr',
                        alignItems: 'stretch',
                        background: rowBg,
                        borderLeft: leftBorder,
                        borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
                        fontFamily: 'var(--nov-font-mono)',
                        fontSize: '12px',
                        lineHeight: 1.6,
                      }}
                    >
                      <button
                        type="button"
                        onClick={(e) => onSelectPlanLine(lineNum, e.shiftKey)}
                        style={{
                          appearance: 'none',
                          border: 'none',
                          borderRight: '1px solid var(--nov-border)',
                          background: 'transparent',
                          color: isSelected
                            ? 'var(--nov-accent)'
                            : 'var(--nov-text-2)',
                          fontFamily: 'var(--nov-font-mono)',
                          fontSize: '11.5px',
                          fontWeight: isSelected ? 700 : 500,
                          textAlign: 'right',
                          padding: '2px 8px 2px 4px',
                          cursor: 'pointer',
                          userSelect: 'none',
                        }}
                      >
                        {lineNum}
                      </button>
                      <div
                        onClick={(e) => onSelectPlanLine(lineNum, e.shiftKey)}
                        style={{
                          padding: '2px 10px',
                          cursor: 'pointer',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          color: isStruck ? 'var(--nov-danger)' : 'var(--nov-text-0)',
                          textDecoration: isStruck ? 'line-through' : 'none',
                        }}
                      >
                        {lineText || ' '}
                      </div>
                    </div>

                    {/* Inline annotation composer right below selected lineEnd */}
                    {normEnd === lineNum && normStart !== null && (
                      <div
                        className="nov-p-item"
                        style={{
                          margin: '8px 10px',
                          background: 'var(--nov-bg-1)',
                          borderColor: 'var(--nov-accent)',
                          gap: '8px',
                        }}
                      >
                        <div className="nov-p-row">
                          <div style={SPEC_STYLES.flexWrapCenterGap8}>
                            <strong style={{ fontSize: '12px' }}>
                              {actions.selectedRangeLabel}: L{normStart}
                              {normEnd > normStart ? `–L${normEnd}` : ''}
                            </strong>
                            <label
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '11.5px',
                                color: 'var(--nov-text-2)',
                              }}
                            >
                              <span>{actions.lineStartLabel}</span>
                              <input
                                type="number"
                                min={1}
                                max={planLines.length}
                                value={normStart}
                                className="nov-p-input"
                                style={{ width: '62px', padding: '3px 6px' }}
                                onChange={(e) => {
                                  const v = Math.max(
                                    1,
                                    Math.min(planLines.length, Number(e.target.value) || 1),
                                  );
                                  onSetSelStart(v);
                                  onSetSelEnd(Math.max(v, normEnd));
                                }}
                              />
                            </label>
                            <label
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '11.5px',
                                color: 'var(--nov-text-2)',
                              }}
                            >
                              <span>{actions.lineEndLabel}</span>
                              <input
                                type="number"
                                min={normStart}
                                max={planLines.length}
                                value={normEnd}
                                className="nov-p-input"
                                style={{ width: '62px', padding: '3px 6px' }}
                                onChange={(e) => {
                                  const v = Math.max(
                                    normStart,
                                    Math.min(
                                      planLines.length,
                                      Number(e.target.value) || normStart,
                                    ),
                                  );
                                  onSetSelEnd(v);
                                }}
                              />
                            </label>
                          </div>

                          <div style={SPEC_STYLES.flexWrapGap6}>
                            {(['comment', 'strike', 'replace'] as const).map((k) => (
                              <button
                                key={k}
                                type="button"
                                className={`nov-cat-pill ${annKind === k ? 'is-active' : ''}`}
                                onClick={() => {
                                  onSetAnnKind(k);
                                  if (k === 'replace' && !annSuggestedText.trim()) {
                                    onSetAnnSuggestedText(
                                      planLines.slice(normStart - 1, normEnd).join('\n'),
                                    );
                                  }
                                }}
                              >
                                {getAnnotationKindLabel(k, actions)}
                              </button>
                            ))}
                          </div>
                        </div>

                        <textarea
                          className="nov-p-textarea"
                          style={{
                            fontFamily: 'var(--nov-font-sans)',
                            minHeight: '58px',
                          }}
                          value={annNote}
                          disabled={isBusy}
                          placeholder={
                            annKind === 'strike'
                              ? actions.notePlaceholderStrike
                              : annKind === 'replace'
                                ? actions.notePlaceholderReplace
                                : actions.notePlaceholderComment
                          }
                          onChange={(e) => onSetAnnNote(e.target.value)}
                        />

                        {annKind === 'replace' && (
                          <div style={SPEC_STYLES.flexColGap4}>
                            <label
                              style={{
                                fontSize: '11.5px',
                                color: 'var(--nov-text-1)',
                                fontWeight: 600,
                              }}
                            >
                              {actions.replaceTextLabel}
                            </label>
                            <textarea
                              className="nov-p-textarea"
                              style={{ minHeight: '68px' }}
                              value={annSuggestedText}
                              disabled={isBusy}
                              placeholder={actions.replaceTextPlaceholder}
                              onChange={(e) => onSetAnnSuggestedText(e.target.value)}
                            />
                          </div>
                        )}

                        <div className="nov-p-row" style={{ justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="nov-p-btn"
                            disabled={isBusy}
                            onClick={() => {
                              onSetSelStart(null);
                              onSetSelEnd(null);
                            }}
                          >
                            {actions.cancelBtn}
                          </button>
                          <button
                            type="button"
                            className="nov-p-btn is-primary"
                            disabled={
                              isBusy ||
                              (annKind === 'comment' && !annNote.trim()) ||
                              (annKind === 'replace' && !annSuggestedText.trim())
                            }
                            onClick={() => void onSubmitAnnotation()}
                          >
                            {busyAction === 'annotate'
                              ? dict.common.loading
                              : actions.submitAnnotationBtn}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Inline annotation cards anchored at lineEnd */}
                    {lineAnnotations.map((ann) => renderAnnotationCard(ann))}
                  </React.Fragment>
                );
              })}
              {planLines.length > planLineLimit && (
                <div
                  className="nov-p-row"
                  style={{
                    padding: '10px 12px',
                    borderTop: '1px dashed var(--nov-border)',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                    {dict.common.truncated} · {planLineLimit} / {planLines.length}
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="nov-p-btn"
                      onClick={() => setPlanLineLimit((prev) => prev + INITIAL_PLAN_LINE_BUDGET)}
                    >
                      +{Math.min(INITIAL_PLAN_LINE_BUDGET, planLines.length - planLineLimit)}
                    </button>
                    <button
                      type="button"
                      className="nov-p-btn"
                      onClick={() => setPlanLineLimit(planLines.length)}
                    >
                      100% ({planLines.length})
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {lineDecorations.detached.length > 0 && (
            <div style={SPEC_STYLES.flexColGap6}>
              <strong style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                {actions.detachedAnnotationsTitle} ({lineDecorations.detached.length})
              </strong>
              {lineDecorations.detached.map((ann) => renderAnnotationCard(ann))}
            </div>
          )}

          {unresolvedCount > 0 && (
            <div
              className="nov-p-row"
              style={{
                paddingTop: '8px',
                borderTop: '1px solid var(--nov-border)',
                justifyContent: 'flex-end',
              }}
            >
              <button
                type="button"
                className="nov-p-btn"
                disabled={isBusy}
                onClick={() => void onCopyFeedbackPrompt()}
              >
                {actions.copyFeedbackBtn}
              </button>
              <button
                type="button"
                className="nov-p-btn is-primary"
                disabled={isBusy}
                onClick={() => void onSendFeedbackToAgent()}
              >
                {busyAction === 'send-feedback'
                  ? dict.common.loading
                  : `${canSendMessage ? actions.sendFeedbackBtn : dict.common.copyPrompt} (${unresolvedCount})`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
