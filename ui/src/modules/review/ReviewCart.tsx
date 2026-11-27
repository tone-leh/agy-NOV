import React, { useState } from 'react';
import type { AnnotationCategory, ReviewAnnotation } from './types';

interface ReviewCartProps {
  annotations: ReviewAnnotation[];
  previewMarkdown: string;
  canSendMessage: boolean;
  canUpdateContext: boolean;
  onRefreshPreview: () => Promise<string>;
  onSendToAgent: (markdown: string) => Promise<'sent' | 'context' | 'copied'>;
  onAttachToNextTurn: (markdown: string) => Promise<'context' | 'copied'>;
  onClearResolved: () => Promise<void>;
  onNotify?: (message: string) => void;
}

const CAT_ORDER: AnnotationCategory[] = ['security', 'bug', 'refactor', 'question', 'nit'];

async function copyTextReliable(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export const ReviewCart: React.FC<ReviewCartProps> = ({
  annotations,
  previewMarkdown,
  canSendMessage,
  canUpdateContext,
  onRefreshPreview,
  onSendToAgent,
  onAttachToNextTurn,
  onClearResolved,
  onNotify,
}) => {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [inlineToast, setInlineToast] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'send' | 'attach' | 'copy' | null>(null);

  const openItems = annotations.filter((a) => !a.resolved);
  const resolvedCount = annotations.length - openItems.length;

  const counts: Record<AnnotationCategory, number> = {
    security: 0,
    bug: 0,
    refactor: 0,
    question: 0,
    nit: 0,
  };
  for (const a of openItems) {
    counts[a.category] = (counts[a.category] ?? 0) + 1;
  }

  const notify = (msg: string) => {
    setInlineToast(msg);
    onNotify?.(msg);
    window.setTimeout(() => {
      setInlineToast((curr) => (curr === msg ? null : curr));
    }, 2600);
  };

  const handleTogglePreview = async () => {
    if (!previewOpen) {
      await onRefreshPreview();
    }
    setPreviewOpen((v) => !v);
  };

  const handleSend = async () => {
    if (openItems.length === 0) return;
    setBusyAction('send');
    try {
      const md = await onRefreshPreview();
      const outcome = await onSendToAgent(md);
      if (outcome === 'sent') {
        notify('Sent review feedback to Agent');
      } else if (outcome === 'context') {
        notify('Attached review prompt to next Agent turn');
      } else {
        notify('Copied review prompt to clipboard (host message unavailable)');
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleAttach = async () => {
    if (openItems.length === 0) return;
    setBusyAction('attach');
    try {
      const md = await onRefreshPreview();
      const outcome = await onAttachToNextTurn(md);
      notify(
        outcome === 'context'
          ? 'Attached review prompt to next turn'
          : 'Copied review prompt to clipboard (context attach unavailable)',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopy = async () => {
    if (openItems.length === 0) return;
    setBusyAction('copy');
    try {
      const md = await onRefreshPreview();
      const ok = await copyTextReliable(md);
      notify(ok ? 'Copied structured review prompt' : 'Copy failed — open Preview to select text');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <footer className="rv-review-cart">
      {previewOpen && (
        <div className="rv-cart-preview-drawer">
          <div className="rv-cart-preview-bar">
            <span className="rv-cart-preview-title">Structured Review Prompt Preview</span>
            <button
              type="button"
              className="rv-icon-btn"
              onClick={() => setPreviewOpen(false)}
              aria-label="Close prompt preview"
            >
              ✕
            </button>
          </div>
          <pre className="rv-cart-preview-code">
            <code>{previewMarkdown || 'No open annotations yet.'}</code>
          </pre>
        </div>
      )}

      <div className="rv-cart-bar">
        <div className="rv-cart-summary">
          <button type="button" className="rv-cart-count-btn" onClick={handleTogglePreview}>
            <span className="rv-cart-count-num">{openItems.length}</span>
            <span>pending note{openItems.length === 1 ? '' : 's'}</span>
            <span className="rv-cart-chevron">{previewOpen ? '▾' : '▴'}</span>
          </button>

          <div className="rv-cart-chips">
            {CAT_ORDER.filter((c) => counts[c] > 0).map((cat) => (
              <span key={cat} className={`rv-ann-badge rv-cat-${cat}`}>
                {cat.toUpperCase()} {counts[cat]}
              </span>
            ))}
          </div>

          {resolvedCount > 0 && (
            <button
              type="button"
              className="rv-link-btn"
              onClick={() => void onClearResolved()}
              title="Delete all resolved annotations in this scope"
            >
              Clear {resolvedCount} resolved
            </button>
          )}

          {inlineToast && <span className="rv-cart-toast">{inlineToast}</span>}
        </div>

        <div className="rv-cart-actions">
          <button
            type="button"
            className="rv-btn rv-btn-subtle"
            onClick={() => void handleCopy()}
            disabled={openItems.length === 0 || busyAction !== null}
          >
            {busyAction === 'copy' ? 'Copying…' : 'Copy Prompt'}
          </button>

          {canUpdateContext && (
            <button
              type="button"
              className="rv-btn rv-btn-secondary"
              onClick={() => void handleAttach()}
              disabled={openItems.length === 0 || busyAction !== null}
              title="Attach annotations as a context pill on your next chat turn"
            >
              {busyAction === 'attach' ? 'Attaching…' : 'Attach to Next Turn'}
            </button>
          )}

          {canSendMessage && (
            <button
              type="button"
              className="rv-btn rv-btn-primary"
              onClick={() => void handleSend()}
              disabled={openItems.length === 0 || busyAction !== null}
              title="Send structured file:line review prompt straight to the active agent"
            >
              {busyAction === 'send' ? 'Sending…' : 'Send to Agent'}
            </button>
          )}
        </div>
      </div>
    </footer>
  );
};
