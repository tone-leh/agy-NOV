import React, { useEffect, useRef, useState } from 'react';
import { useNovI18n } from '../../i18n/index.js';
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

export const AnnotationComposer: React.FC<AnnotationComposerProps> = ({
  filePath,
  side,
  startLine,
  endLine,
  snippetPreview,
  initialCategory = 'bug',
  initialComment = '',
  submitLabel,
  saving = false,
  onSubmit,
  onCancel,
}) => {
  const { dict } = useNovI18n();
  const r = dict.panels.review;

  const [category, setCategory] = useState<AnnotationCategory>(initialCategory);
  const [comment, setComment] = useState(initialComment);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setCategory(initialCategory);
    setComment(initialComment);
  }, [filePath, side, startLine, endLine, initialCategory, initialComment]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [filePath, side, startLine, endLine]);

  const categories: Array<{ value: AnnotationCategory; label: string }> = [
    { value: 'security', label: `${r.severityHigh} · SEC` },
    { value: 'bug', label: `${r.severityHigh} · BUG` },
    { value: 'refactor', label: `${r.severityMed} · REF` },
    { value: 'question', label: `${r.severityLow} · ?` },
    { value: 'nit', label: `${r.severityLow} · NIT` },
  ];

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
          {side === 'old' ? ' [-]' : ''}
        </span>
        <div className="rv-category-group" role="radiogroup" aria-label={r.annotations}>
          {categories.map((c) => (
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
        placeholder={r.commentPlaceholder}
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
        <span className="rv-composer-hint">Shift+Click · ⌘/Ctrl+Enter</span>
        <div className="rv-composer-buttons">
          <button type="button" className="rv-btn rv-btn-subtle" onClick={onCancel} disabled={saving}>
            {dict.common.clear}
          </button>
          <button
            type="button"
            className="rv-btn rv-btn-primary"
            onClick={handleSubmit}
            disabled={!comment.trim() || saving}
          >
            {saving ? dict.common.loading : (submitLabel ?? r.addComment)}
          </button>
        </div>
      </div>
    </div>
  );
};
