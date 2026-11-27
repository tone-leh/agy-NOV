import React, { useState } from 'react';
import { useNovI18n } from '../../i18n/index.js';
import { AnnotationComposer } from './AnnotationComposer';
import type { AnnotationCategory, ReviewAnnotation } from './types';

interface AnnotationCardProps {
  annotation: ReviewAnnotation;
  onUpdate: (id: string, category: AnnotationCategory, comment: string) => Promise<void>;
  onToggleResolve: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const BADGE_CODE: Record<AnnotationCategory, string> = {
  security: 'SEC',
  bug: 'BUG',
  refactor: 'REF',
  question: '?',
  nit: 'NIT',
};

export const AnnotationCard: React.FC<AnnotationCardProps> = ({
  annotation,
  onUpdate,
  onToggleResolve,
  onDelete,
}) => {
  const { dict } = useNovI18n();
  const r = dict.panels.review;

  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(!annotation.resolved);
  const [busy, setBusy] = useState(false);

  const lineLabel =
    annotation.endLine > annotation.startLine
      ? `L${annotation.startLine}–L${annotation.endLine}`
      : `L${annotation.startLine}`;

  const severityLabel =
    annotation.category === 'security' || annotation.category === 'bug'
      ? r.severityHigh
      : annotation.category === 'refactor'
        ? r.severityMed
        : r.severityLow;

  const badgeText = `${severityLabel} · ${BADGE_CODE[annotation.category]}`;

  if (editing) {
    return (
      <AnnotationComposer
        filePath={annotation.filePath}
        side={annotation.side}
        startLine={annotation.startLine}
        endLine={annotation.endLine}
        initialCategory={annotation.category}
        initialComment={annotation.comment}
        submitLabel={dict.common.save}
        saving={busy}
        onCancel={() => setEditing(false)}
        onSubmit={async (cat, text) => {
          setBusy(true);
          try {
            await onUpdate(annotation.id, cat, text);
            setEditing(false);
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }

  if (annotation.resolved && !expanded) {
    return (
      <div className="rv-ann-card rv-ann-resolved-collapsed" onClick={() => setExpanded(true)}>
        <span className="rv-ann-resolved-check">✓</span>
        <span className={`rv-ann-badge rv-cat-${annotation.category}`}>{badgeText}</span>
        <span className="rv-ann-range">{lineLabel}</span>
        <span className="rv-ann-preview-text">{annotation.comment}</span>
        <span className="rv-ann-expand-hint">{r.resolved}</span>
      </div>
    );
  }

  return (
    <div
      className={`rv-ann-card rv-cat-border-${annotation.category} ${annotation.resolved ? 'is-resolved' : ''}`}
    >
      <div className="rv-ann-header">
        <div className="rv-ann-meta">
          <span className={`rv-ann-badge rv-cat-${annotation.category}`}>{badgeText}</span>
          <span className="rv-ann-range">
            {lineLabel}
            {annotation.side === 'old' ? ' [-]' : ''}
          </span>
          {annotation.stale && (
            <span className="rv-ann-stale" title={annotation.staleReason ?? dict.panels.mem.stale}>
              {dict.panels.mem.stale}
            </span>
          )}
          {annotation.resolved && <span className="rv-ann-resolved-pill">{r.resolved}</span>}
        </div>
        <div className="rv-ann-actions">
          <button
            type="button"
            className="rv-ann-action-btn"
            disabled={busy}
            onClick={() => setEditing(true)}
            title={r.addComment}
            aria-label={r.addComment}
          >
            ✎
          </button>
          <button
            type="button"
            className="rv-ann-action-btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onToggleResolve(annotation.id);
                if (!annotation.resolved) setExpanded(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {annotation.resolved ? r.unresolved : r.resolved}
          </button>
          <button
            type="button"
            className="rv-ann-action-btn rv-ann-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onDelete(annotation.id);
              } finally {
                setBusy(false);
              }
            }}
          >
            {dict.common.delete}
          </button>
        </div>
      </div>
      <div className="rv-ann-body">{annotation.comment}</div>
    </div>
  );
};
