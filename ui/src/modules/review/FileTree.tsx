import React from 'react';
import { useNovI18n } from '../../i18n/index.js';
import type { DiffFile, RiskTag } from './types';

interface FileTreeProps {
  files: DiffFile[];
  selectedPath: string | null;
  viewedSet: Set<string>;
  openCountByFile: Map<string, number>;
  canToggleAuxPane: boolean;
  compact: boolean;
  open: boolean;
  onSelectFile: (filePath: string) => void;
  onToggleViewed: (filePath: string, next: boolean) => void;
  onOpenInHost: (absolutePath: string) => void;
  onCloseDrawer: () => void;
}

const STATUS_LETTER: Record<DiffFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  copied: 'C',
};

const RISK_LABEL: Record<RiskTag, string> = {
  'security-sensitive': 'SEC',
  large: 'LARGE',
  config: 'CFG',
  test: 'TEST',
};

function splitDirAndName(filePath: string): { dir: string; name: string } {
  const idx = filePath.lastIndexOf('/');
  if (idx < 0) return { dir: '', name: filePath };
  return { dir: filePath.slice(0, idx), name: filePath.slice(idx + 1) };
}

export const FileTree: React.FC<FileTreeProps> = ({
  files,
  selectedPath,
  viewedSet,
  openCountByFile,
  canToggleAuxPane,
  compact,
  open,
  onSelectFile,
  onToggleViewed,
  onOpenInHost,
  onCloseDrawer,
}) => {
  const { dict } = useNovI18n();
  const r = dict.panels.review;

  if (compact && !open) {
    return (
      <div className="rv-compact-file-bar">
        <select
          className="rv-compact-file-select"
          value={selectedPath ?? ''}
          onChange={(e) => onSelectFile(e.target.value)}
          aria-label={r.filesTitle}
        >
          {files.length === 0 ? (
            <option value="">{dict.common.empty}</option>
          ) : (
            files.map((f) => {
              const ann = openCountByFile.get(f.path) ?? 0;
              const viewedMark = viewedSet.has(f.path) ? '✓ ' : '';
              const annSuffix = ann > 0 ? ` (${ann} ${r.annotations})` : '';
              return (
                <option key={f.path} value={f.path}>
                  {viewedMark}[{STATUS_LETTER[f.status]}] {f.path} (+{f.additions}/-{f.deletions}){annSuffix}
                </option>
              );
            })
          )}
        </select>
      </div>
    );
  }

  if (!open) return null;

  return (
    <aside className={compact ? 'rv-file-tree rv-file-tree-drawer' : 'rv-file-tree'}>
      <div className="rv-file-tree-header">
        <span className="rv-file-tree-title">
          {r.filesTitle} ({files.length})
        </span>
        {compact && (
          <button type="button" className="rv-icon-btn" onClick={onCloseDrawer} aria-label={dict.common.clear}>
            ✕
          </button>
        )}
      </div>
      <div className="rv-file-tree-list">
        {files.length === 0 ? (
          <div className="rv-file-tree-empty">{dict.common.empty}</div>
        ) : (
          files.map((file) => {
            const selected = file.path === selectedPath;
            const viewed = viewedSet.has(file.path);
            const openCount = openCountByFile.get(file.path) ?? 0;
            const { dir, name } = splitDirAndName(file.path);
            return (
              <div
                key={file.path}
                className={`rv-file-item ${selected ? 'is-selected' : ''} ${viewed ? 'is-viewed' : ''}`}
                onClick={() => {
                  onSelectFile(file.path);
                  if (compact) onCloseDrawer();
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectFile(file.path);
                    if (compact) onCloseDrawer();
                  }
                }}
              >
                <div className="rv-file-item-top">
                  <label
                    className="rv-viewed-check"
                    onClick={(e) => e.stopPropagation()}
                    title={viewed ? r.resolved : r.unresolved}
                  >
                    <input
                      type="checkbox"
                      checked={viewed}
                      onChange={(e) => onToggleViewed(file.path, e.target.checked)}
                    />
                  </label>
                  <span className={`rv-status-dot rv-status-${file.status}`}>{STATUS_LETTER[file.status]}</span>
                  <span className="rv-file-name" title={file.path}>
                    {name}
                  </span>
                  {openCount > 0 && (
                    <span className="rv-file-ann-badge" title={`${openCount} ${r.annotations}`}>
                      {openCount}
                    </span>
                  )}
                  {canToggleAuxPane && file.absolutePath && file.status !== 'deleted' && (
                    <button
                      type="button"
                      className="rv-file-open-btn"
                      title={dict.panels.canvas.openFile}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenInHost(file.absolutePath!);
                      }}
                    >
                      ↗
                    </button>
                  )}
                </div>
                <div className="rv-file-item-bottom">
                  <span className="rv-file-dir" title={dir}>
                    {dir || '.'}
                  </span>
                  <span className="rv-file-deltas">
                    {file.isBinary ? (
                      <span className="rv-risk-tag rv-risk-config">BIN</span>
                    ) : (
                      <>
                        <span className="rv-delta-add">+{file.additions}</span>
                        <span className="rv-delta-del">-{file.deletions}</span>
                      </>
                    )}
                  </span>
                </div>
                {file.riskTags.length > 0 && (
                  <div className="rv-file-risk-row">
                    {file.riskTags.map((tag) => (
                      <span key={tag} className={`rv-risk-tag rv-risk-${tag}`} title={r.riskLineBadge}>
                        {RISK_LABEL[tag]}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
