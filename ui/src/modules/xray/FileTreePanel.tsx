import React, { useMemo, useState } from 'react';
import { useNovI18n } from '../../i18n/index.js';
import type { FileActivityItem } from './types';

interface FileTreePanelProps {
  files: FileActivityItem[];
  canOpenFile: boolean;
  canAttachContext: boolean;
  onOpenFile: (file: FileActivityItem) => void;
  onAttachFile: (file: FileActivityItem) => void;
}

export const FileTreePanel: React.FC<FileTreePanelProps> = ({
  files,
  canOpenFile,
  canAttachContext,
  onOpenFile,
  onAttachFile,
}) => {
  const { dict } = useNovI18n();
  const x = dict.panels.xray;
  const [filter, setFilter] = useState<'all' | 'modified' | 'read'>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => {
      if (filter === 'modified' && f.editCount + f.writeCount === 0) return false;
      if (filter === 'read' && f.editCount + f.writeCount > 0) return false;
      if (q && !f.path.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [files, filter, query]);

  const modifiedCount = useMemo(
    () => files.filter((f) => f.editCount + f.writeCount > 0).length,
    [files],
  );
  const readOnlyCount = files.length - modifiedCount;

  return (
    <div className="xr-stack">
      <div className="xr-filter-bar">
        <div className="xr-tabs" role="tablist" aria-label={x.tabFiles}>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={`xr-tab ${filter === 'all' ? 'is-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            {dict.categoryAll} ({files.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'modified'}
            className={`xr-tab ${filter === 'modified' ? 'is-active' : ''}`}
            onClick={() => setFilter('modified')}
          >
            {dict.panels.review.filesChanged} ({modifiedCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'read'}
            className={`xr-tab ${filter === 'read' ? 'is-active' : ''}`}
            onClick={() => setFilter('read')}
          >
            R ({readOnlyCount})
          </button>
        </div>
        <input
          className="xr-input xr-filter-input"
          placeholder={dict.panels.review.filterFilesPlaceholder}
          aria-label={dict.panels.review.filterFilesPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="xr-card xr-empty-state">{x.filesEmpty}</div>
      ) : (
        <div className="xr-list">
          {filtered.map((file) => (
            <div key={file.path} className="xr-file-row">
              <div className="xr-file-meta">
                <div className="xr-file-name">
                  {file.ops.map((op) => (
                    <span key={op} className={`xr-op-pill xr-op-${op}`}>
                      {op[0].toUpperCase()}
                    </span>
                  ))}
                  {file.basename}
                </div>
                <div className="xr-file-dir" title={file.path}>
                  {file.dir} · ×{file.totalTouches} · #{file.lastStepIndex}
                </div>
              </div>
              <div className="xr-row-actions">
                {canOpenFile && (
                  <button
                    type="button"
                    className="xr-btn xr-btn-primary"
                    title={x.openFile}
                    onClick={() => onOpenFile(file)}
                  >
                    {x.openFile}
                  </button>
                )}
                {canAttachContext && (
                  <button
                    type="button"
                    className="xr-btn"
                    title={x.attachContext}
                    onClick={() => onAttachFile(file)}
                  >
                    {x.attachContext}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
