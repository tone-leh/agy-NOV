import React, { useMemo, useState } from 'react';
import { AnnotationCard } from './AnnotationCard';
import { AnnotationComposer } from './AnnotationComposer';
import {
  buildSplitRows,
  extractCodeSnippet,
  type AnnotationCategory,
  type AnnotationSide,
  type DiffFile,
  type DiffLine,
  type DiffViewMode,
  type ReviewAnnotation,
} from './types';

interface SelectionRange {
  side: AnnotationSide;
  anchorLine: number;
  startLine: number;
  endLine: number;
}

interface DiffViewerProps {
  file: DiffFile | null;
  viewMode: DiffViewMode;
  viewed: boolean;
  canToggleAuxPane: boolean;
  annotations: ReviewAnnotation[];
  onToggleViewed: (viewed: boolean) => void;
  onOpenInHost: (absolutePath: string) => void;
  onAddAnnotation: (input: {
    filePath: string;
    side: AnnotationSide;
    startLine: number;
    endLine: number;
    category: AnnotationCategory;
    comment: string;
    codeSnippet: string;
    fileFingerprint: string;
  }) => Promise<void>;
  onUpdateAnnotation: (id: string, category: AnnotationCategory, comment: string) => Promise<void>;
  onToggleResolve: (id: string) => Promise<void>;
  onDeleteAnnotation: (id: string) => Promise<void>;
}

function getLineTarget(line: DiffLine): { side: AnnotationSide; lineNo: number } | null {
  if (line.newLine !== null) return { side: 'new', lineNo: line.newLine };
  if (line.oldLine !== null) return { side: 'old', lineNo: line.oldLine };
  return null;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  file,
  viewMode,
  viewed,
  canToggleAuxPane,
  annotations,
  onToggleViewed,
  onOpenInHost,
  onAddAnnotation,
  onUpdateAnnotation,
  onToggleResolve,
  onDeleteAnnotation,
}) => {
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    setSelection(null);
  }, [file?.path]);

  const { byAnchor, unanchored } = useMemo(() => {
    const validAnchors = new Set<string>();
    if (file) {
      for (const h of file.hunks) {
        for (const l of h.lines) {
          if (l.newLine !== null) validAnchors.add(`new:${l.newLine}`);
          if (l.oldLine !== null) validAnchors.add(`old:${l.oldLine}`);
        }
      }
    }
    const map = new Map<string, ReviewAnnotation[]>();
    const orphans: ReviewAnnotation[] = [];
    for (const ann of annotations) {
      const key = `${ann.side}:${ann.endLine}`;
      if (validAnchors.has(key)) {
        const list = map.get(key) ?? [];
        list.push(ann);
        map.set(key, list);
      } else {
        orphans.push(ann);
      }
    }
    return { byAnchor: map, unanchored: orphans };
  }, [annotations, file]);

  if (!file) {
    return (
      <section className="rv-diff-pane rv-diff-empty">
        <div className="rv-empty-state">
          <div className="rv-empty-icon">✓</div>
          <h3>No diff selected</h3>
          <p>Switch diff scope or make edits in your workspace, then click Refresh.</p>
        </div>
      </section>
    );
  }

  const handleLineClick = (side: AnnotationSide, lineNo: number, shiftKey: boolean) => {
    if (shiftKey && selection && selection.side === side) {
      const lo = Math.min(selection.anchorLine, lineNo);
      const hi = Math.max(selection.anchorLine, lineNo);
      setSelection({ side, anchorLine: selection.anchorLine, startLine: lo, endLine: hi });
      return;
    }
    if (
      selection &&
      selection.side === side &&
      selection.startLine === lineNo &&
      selection.endLine === lineNo
    ) {
      setSelection(null);
      return;
    }
    setSelection({ side, anchorLine: lineNo, startLine: lineNo, endLine: lineNo });
  };

  const isSelectedLine = (side: AnnotationSide, lineNo: number | null): boolean => {
    if (!selection || lineNo === null || selection.side !== side) return false;
    return lineNo >= selection.startLine && lineNo <= selection.endLine;
  };

  const snippetPreview = selection
    ? extractCodeSnippet(file, selection.startLine, selection.endLine, selection.side, 6)
    : '';

  const submitNewAnnotation = async (category: AnnotationCategory, comment: string) => {
    if (!selection) return;
    setSaving(true);
    try {
      await onAddAnnotation({
        filePath: file.path,
        side: selection.side,
        startLine: selection.startLine,
        endLine: selection.endLine,
        category,
        comment,
        codeSnippet: extractCodeSnippet(file, selection.startLine, selection.endLine, selection.side, 8),
        fileFingerprint: file.fingerprint,
      });
      setSelection(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rv-diff-pane">
      <div className="rv-file-header">
        <div className="rv-file-header-main">
          <span className={`rv-status-pill rv-status-${file.status}`}>{file.status}</span>
          <span className="rv-file-header-path" title={file.path}>
            {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
          </span>
          {!file.isBinary && (
            <span className="rv-file-header-deltas">
              <span className="rv-delta-add">+{file.additions}</span>
              <span className="rv-delta-del">-{file.deletions}</span>
            </span>
          )}
          {file.riskTags.map((tag) => (
            <span key={tag} className={`rv-risk-tag rv-risk-${tag}`}>
              {tag}
            </span>
          ))}
        </div>
        <div className="rv-file-header-actions">
          {canToggleAuxPane && file.absolutePath && file.status !== 'deleted' && (
            <button
              type="button"
              className="rv-btn rv-btn-subtle"
              onClick={() => onOpenInHost(file.absolutePath!)}
              title="Open source file in Antigravity side pane"
            >
              Open File ↗
            </button>
          )}
          <label className="rv-viewed-toggle">
            <input
              type="checkbox"
              checked={viewed}
              onChange={(e) => onToggleViewed(e.target.checked)}
            />
            <span>Viewed</span>
          </label>
        </div>
      </div>

      {file.isTruncated && (
        <div className="rv-banner rv-banner-warn">
          {file.truncationReason ?? 'Large file diff truncated to preserve responsiveness.'}
        </div>
      )}

      {unanchored.length > 0 && (
        <div className="rv-unanchored-section">
          <div className="rv-unanchored-title">Annotations outside current diff hunks</div>
          {unanchored.map((ann) => (
            <AnnotationCard
              key={ann.id}
              annotation={ann}
              onUpdate={onUpdateAnnotation}
              onToggleResolve={onToggleResolve}
              onDelete={onDeleteAnnotation}
            />
          ))}
        </div>
      )}

      {file.isBinary ? (
        <div className="rv-empty-state">
          <p>Binary file changed — inline line diff is omitted.</p>
        </div>
      ) : file.hunks.length === 0 ? (
        <div className="rv-empty-state">
          <p>No textual line changes in this file (mode change, rename only, or empty file).</p>
        </div>
      ) : (
        <div className="rv-diff-scroll">
          {file.hunks.map((hunk, hIdx) => {
            const prevHunk = hIdx > 0 ? file.hunks[hIdx - 1] : null;
            const hiddenLines = prevHunk
              ? Math.max(0, hunk.newStart - (prevHunk.newStart + prevHunk.newCount))
              : Math.max(0, hunk.newStart - 1);

            if (viewMode === 'split') {
              const splitRows = buildSplitRows(hunk.lines);
              return (
                <div key={`${hunk.header}-${hIdx}`} className="rv-hunk-block">
                  <div className="rv-hunk-header">
                    <span className="rv-hunk-meta">
                      {hiddenLines > 0 ? `⋯ ${hiddenLines} unchanged lines hidden · ` : ''}
                      {hunk.header}
                    </span>
                  </div>
                  <div className="rv-diff-table rv-split-table">
                    {splitRows.map((row) => {
                      const leftTarget =
                        row.left?.oldLine != null ? { side: 'old' as const, lineNo: row.left.oldLine } : null;
                      const rightTarget =
                        row.right?.newLine != null ? { side: 'new' as const, lineNo: row.right.newLine } : null;

                      const leftSelected = leftTarget ? isSelectedLine('old', leftTarget.lineNo) : false;
                      const rightSelected = rightTarget ? isSelectedLine('new', rightTarget.lineNo) : false;

                      const rowAnnotations: ReviewAnnotation[] = [
                        ...(leftTarget && row.left?.type === 'del'
                          ? byAnchor.get(`old:${leftTarget.lineNo}`) ?? []
                          : []),
                        ...(rightTarget ? byAnchor.get(`new:${rightTarget.lineNo}`) ?? [] : []),
                      ];

                      const showComposerHere =
                        selection !== null &&
                        ((selection.side === 'new' && rightTarget?.lineNo === selection.endLine) ||
                          (selection.side === 'old' && leftTarget?.lineNo === selection.endLine));

                      return (
                        <React.Fragment key={row.index}>
                          <div className="rv-split-row">
                            <div
                              className={`rv-split-cell rv-line-${row.left?.type ?? 'empty'} ${leftSelected ? 'is-selected' : ''}`}
                              onClick={(e) => {
                                if (leftTarget) handleLineClick('old', leftTarget.lineNo, e.shiftKey);
                              }}
                            >
                              <span className="rv-gutter-num">{row.left?.oldLine ?? ''}</span>
                              <span className="rv-gutter-sign">
                                {row.left?.type === 'del' ? '-' : row.left ? ' ' : ''}
                              </span>
                              <span className="rv-code-text">{row.left?.content ?? ''}</span>
                            </div>
                            <div
                              className={`rv-split-cell rv-line-${row.right?.type ?? 'empty'} ${rightSelected ? 'is-selected' : ''}`}
                              onClick={(e) => {
                                if (rightTarget) handleLineClick('new', rightTarget.lineNo, e.shiftKey);
                              }}
                            >
                              <span className="rv-gutter-num">{row.right?.newLine ?? ''}</span>
                              <span className="rv-gutter-sign">
                                {row.right?.type === 'add' ? '+' : row.right ? ' ' : ''}
                              </span>
                              <span className="rv-code-text">{row.right?.content ?? ''}</span>
                            </div>
                          </div>

                          {rowAnnotations.length > 0 && (
                            <div className="rv-inline-thread">
                              {rowAnnotations.map((ann) => (
                                <AnnotationCard
                                  key={ann.id}
                                  annotation={ann}
                                  onUpdate={onUpdateAnnotation}
                                  onToggleResolve={onToggleResolve}
                                  onDelete={onDeleteAnnotation}
                                />
                              ))}
                            </div>
                          )}

                          {showComposerHere && selection && (
                            <div className="rv-inline-thread">
                              <AnnotationComposer
                                filePath={file.path}
                                side={selection.side}
                                startLine={selection.startLine}
                                endLine={selection.endLine}
                                snippetPreview={snippetPreview}
                                saving={saving}
                                onSubmit={submitNewAnnotation}
                                onCancel={() => setSelection(null)}
                              />
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            }

            return (
              <div key={`${hunk.header}-${hIdx}`} className="rv-hunk-block">
                <div className="rv-hunk-header">
                  <span className="rv-hunk-meta">
                    {hiddenLines > 0 ? `⋯ ${hiddenLines} unchanged lines hidden · ` : ''}
                    {hunk.header}
                  </span>
                </div>
                <div className="rv-diff-table rv-unified-table">
                  {hunk.lines.map((line, lIdx) => {
                    const target = getLineTarget(line);
                    const selected = target ? isSelectedLine(target.side, target.lineNo) : false;
                    const anchorKey = target ? `${target.side}:${target.lineNo}` : '';
                    const lineAnnotations = anchorKey ? byAnchor.get(anchorKey) ?? [] : [];
                    const showComposerHere =
                      selection !== null &&
                      target !== null &&
                      selection.side === target.side &&
                      selection.endLine === target.lineNo;

                    return (
                      <React.Fragment key={lIdx}>
                        <div
                          className={`rv-diff-row rv-line-${line.type} ${selected ? 'is-selected' : ''}`}
                          onClick={(e) => {
                            if (target) handleLineClick(target.side, target.lineNo, e.shiftKey);
                          }}
                        >
                          <span className="rv-gutter-action" title="Click to annotate (Shift+click for range)">
                            +
                          </span>
                          <span className="rv-gutter-num">{line.oldLine ?? ''}</span>
                          <span className="rv-gutter-num">{line.newLine ?? ''}</span>
                          <span className="rv-gutter-sign">
                            {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                          </span>
                          <span className="rv-code-text">{line.content}</span>
                        </div>

                        {lineAnnotations.length > 0 && (
                          <div className="rv-inline-thread">
                            {lineAnnotations.map((ann) => (
                              <AnnotationCard
                                key={ann.id}
                                annotation={ann}
                                onUpdate={onUpdateAnnotation}
                                onToggleResolve={onToggleResolve}
                                onDelete={onDeleteAnnotation}
                              />
                            ))}
                          </div>
                        )}

                        {showComposerHere && selection && (
                          <div className="rv-inline-thread">
                            <AnnotationComposer
                              filePath={file.path}
                              side={selection.side}
                              startLine={selection.startLine}
                              endLine={selection.endLine}
                              snippetPreview={snippetPreview}
                              saving={saving}
                              onSubmit={submitNewAnnotation}
                              onCancel={() => setSelection(null)}
                            />
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
