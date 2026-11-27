import React, { useState } from 'react';
import { AnnotationComposer } from './AnnotationComposer';
import type { AnnotationCategory, ReviewAnnotation } from './types';

interface AnnotationCardProps {
  annotation: ReviewAnnotation;
  onUpdate: (id: string, category: AnnotationCategory, comment: string) => Promise<void>;
  onToggleResolve: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const BADGE_TEXT: Record<AnnotationCategory, string> = {
  security: 'SECURITY',
  bug: 'BUG',
  refactor: 'REFACTOR',
  question: 'QUESTION',
  nit: 'NIT',
};

export const AnnotationCard: React.FC<AnnotationCardProps> = ({
  annotation,
  onUpdate,
  onToggleResolve,
  onDelete,
}) => {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(!annotation.resolved);
  const [busy, setBusy] = useState(false);

  const lineLabel =
    annotation.endLine > annotation.startLine
      ? `L${annotation.startLine}–L${annotation.endLine}`
      : `L${annotation.startLine}`;

  if (editing) {
    return (
      <AnnotationComposer
        filePath={annotation.filePath}
        side={annotation.side}
        startLine={annotation.startLine}
        endLine={annotation.endLine}
        initialCategory={annotation.category}
        initialComment={annotation.comment}
        submitLabel="Save Changes"
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
        <span className={`rv-ann-badge rv-cat-${annotation.category}`}>{BADGE_TEXT[annotation.category]}</span>
        <span className="rv-ann-range">{lineLabel}</span>
        <span className="rv-ann-preview-text">{annotation.comment}</span>
        <span className="rv-ann-expand-hint">Resolved · click to expand</span>
      </div>
    );
  }

  return (
    <div
      className={`rv-ann-card rv-cat-border-${annotation.category} ${annotation.resolved ? 'is-resolved' : ''}`}
    >
      <div className="rv-ann-header">
        <div className="rv-ann-meta">
          <span className={`rv-ann-badge rv-cat-${annotation.category}`}>{BADGE_TEXT[annotation.category]}</span>
          <span className="rv-ann-range">
            {lineLabel}
            {annotation.side === 'old' ? ' (removed)' : ''}
          </span>
          {annotation.stale && (
            <span className="rv-ann-stale" title={annotation.staleReason ?? 'Anchored code changed'}>
              Stale
            </span>
          )}
          {annotation.resolved && <span className="rv-ann-resolved-pill">Resolved</span>}
        </div>
        <div className="rv-ann-actions">
          <button
            type="button"
            className="rv-ann-action-btn"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            Edit
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
            {annotation.resolved ? 'Reopen' : 'Resolve'}
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
            Delete
          </button>
        </div>
      </div>
      <div className="rv-ann-body">{annotation.comment}</div>
    </div>
  );
};
