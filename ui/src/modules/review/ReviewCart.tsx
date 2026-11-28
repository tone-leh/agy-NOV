import React, { useEffect, useRef, useState } from 'react';
import { useNovI18n } from '../../i18n/index.js';
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

const CAT_CODE: Record<AnnotationCategory, string> = {
  security: 'SEC',
  bug: 'BUG',
  refactor: 'REF',
  question: '?',
  nit: 'NIT',
};

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
  const { dict } = useNovI18n();
  const r = dict.panels.review;

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

  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const notify = (msg: string) => {
    setInlineToast(msg);
    onNotify?.(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
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
        notify(r.cartSendAll);
      } else if (outcome === 'context') {
        notify(dict.panels.xray.attachContext);
      } else {
        notify(dict.common.copied);
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
      notify(outcome === 'context' ? dict.panels.xray.attachContext : dict.common.copied);
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
      notify(ok ? dict.common.copied : r.cartCopyAll);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <footer className="rv-review-cart">
      {previewOpen && (
        <div className="rv-cart-preview-drawer">
          <div className="rv-cart-preview-bar">
            <span className="rv-cart-preview-title">{r.cartTitle}</span>
            <button
              type="button"
              className="rv-icon-btn"
              onClick={() => setPreviewOpen(false)}
              aria-label={dict.common.clear}
            >
              ✕
            </button>
          </div>
          <pre className="rv-cart-preview-code">
            <code>{previewMarkdown || r.cartEmpty}</code>
          </pre>
        </div>
      )}

      <div className="rv-cart-bar">
        <div className="rv-cart-summary">
          <button type="button" className="rv-cart-count-btn" onClick={handleTogglePreview}>
            <span className="rv-cart-count-num">{openItems.length}</span>
            <span>{r.annotations}</span>
            <span className="rv-cart-chevron">{previewOpen ? '▾' : '▴'}</span>
          </button>

          <div className="rv-cart-chips">
            {CAT_ORDER.filter((c) => counts[c] > 0).map((cat) => (
              <span key={cat} className={`rv-ann-badge rv-cat-${cat}`}>
                {CAT_CODE[cat]} {counts[cat]}
              </span>
            ))}
          </div>

          {resolvedCount > 0 && (
            <button
              type="button"
              className="rv-link-btn"
              onClick={() => void onClearResolved()}
              title={r.cartClear}
            >
              {r.cartClear} ({resolvedCount})
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
            {busyAction === 'copy' ? dict.common.loading : r.cartCopyAll}
          </button>

          {canUpdateContext && (
            <button
              type="button"
              className="rv-btn rv-btn-secondary"
              onClick={() => void handleAttach()}
              disabled={openItems.length === 0 || busyAction !== null}
              title={dict.panels.xray.attachContext}
            >
              {busyAction === 'attach' ? dict.common.loading : dict.panels.xray.attachContext}
            </button>
          )}

          {canSendMessage && (
            <button
              type="button"
              className="rv-btn rv-btn-primary"
              onClick={() => void handleSend()}
              disabled={openItems.length === 0 || busyAction !== null}
              title={r.cartSendAll}
            >
              {busyAction === 'send' ? dict.common.loading : r.cartSendAll}
            </button>
          )}
        </div>
      </div>
    </footer>
  );
};
