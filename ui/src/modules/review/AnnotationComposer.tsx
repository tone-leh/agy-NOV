import React, { useEffect, useRef, useState } from 'react';
import type { AnnotationCategory, AnnotationSide } from './types';

interface AnnotationComposerProps {
  filePath: string;
  side: AnnotationSide;
  startLine: number;
  endLine: number;
  snippetPreview?: string;
  initialCategory?: AnnotationCategory;
  initialComment?: string;
  submitLabel?: string;
  saving?: boolean;
  onSubmit: (category: AnnotationCategory, comment: string) => void;
  onCancel: () => void;
}

const CATEGORIES: Array<{ value: AnnotationCategory; label: string }> = [
  { value: 'bug', label: 'Bug' },
  { value: 'security', label: 'Security' },
  { value: 'refactor', label: 'Refactor' },
  { value: 'question', label: 'Question' },
  { value: 'nit', label: 'Nit' },
];

export const AnnotationComposer: React.FC<AnnotationComposerProps> = ({
  filePath,
  side,
  startLine,
  endLine,
  snippetPreview,
  initialCategory = 'bug',
  initialComment = '',
  submitLabel = 'Add Annotation',
  saving = false,
  onSubmit,
  onCancel,
}) => {
  const [category, setCategory] = useState<AnnotationCategory>(initialCategory);
  const [comment, setComment] = useState(initialComment);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const lineLabel = endLine > startLine ? `L${startLine}–L${endLine}` : `L${startLine}`;

  const handleSubmit = () => {
    const trimmed = comment.trim();
    if (!trimmed || saving) return;
    onSubmit(category, trimmed);
  };

  return (
    <div className="rv-composer-card" onClick={(e) => e.stopPropagation()}>
      <div className="rv-composer-header">
        <span className="rv-composer-anchor">
          {filePath}:{lineLabel}
          {side === 'old' ? ' (removed)' : ''}
        </span>
        <div className="rv-category-group" role="radiogroup" aria-label="Annotation category">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`rv-cat-chip rv-cat-${c.value} ${category === c.value ? 'is-active' : ''}`}
              onClick={() => setCategory(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {snippetPreview && (
        <pre className="rv-composer-snippet">
          <code>{snippetPreview}</code>
        </pre>
      )}

      <textarea
        ref={textareaRef}
        className="rv-composer-textarea"
        rows={3}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Write an actionable review note for the agent… (⌘/Ctrl + Enter to save)"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />

      <div className="rv-composer-footer">
        <span className="rv-composer-hint">Shift+click another line to annotate a range</span>
        <div className="rv-composer-buttons">
          <button type="button" className="rv-btn rv-btn-subtle" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="rv-btn rv-btn-primary"
            onClick={handleSubmit}
            disabled={!comment.trim() || saving}
          >
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
