import React from 'react';
import { useNovI18n } from '../../i18n/index.js';
import type { DiffViewMode, FileFilterMode, ReviewScope } from './types';

interface HeaderBarProps {
  repoName: string;
  branch: string;
  isDemo: boolean;
  scope: ReviewScope;
  commitRange: string;
  searchQuery: string;
  viewMode: DiffViewMode;
  filterMode: FileFilterMode;
  ignoreWhitespace: boolean;
  syntaxHighlight: boolean;
  viewedCount: number;
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  loading: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onScopeChange: (scope: ReviewScope) => void;
  onCommitRangeChange: (range: string) => void;
  onCommitRangeApply: () => void;
  onSearchChange: (q: string) => void;
  onViewModeChange: (mode: DiffViewMode) => void;
  onFilterModeChange: (mode: FileFilterMode) => void;
  onToggleIgnoreWhitespace: () => void;
  onToggleSyntaxHighlight: () => void;
  onRefresh: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  repoName,
  branch,
  isDemo,
  scope,
  commitRange,
  searchQuery,
  viewMode,
  filterMode,
  ignoreWhitespace,
  syntaxHighlight,
  viewedCount,
  totalFiles,
  totalAdditions,
  totalDeletions,
  loading,
  sidebarOpen,
  onToggleSidebar,
  onScopeChange,
  onCommitRangeChange,
  onCommitRangeApply,
  onSearchChange,
  onViewModeChange,
  onFilterModeChange,
  onToggleIgnoreWhitespace,
  onToggleSyntaxHighlight,
  onRefresh,
}) => {
  const { dict } = useNovI18n();
  const r = dict.panels.review;
  const progressPct = totalFiles > 0 ? Math.round((viewedCount / totalFiles) * 100) : 0;

  return (
    <header className="rv-header" aria-label={r.title}>
      <div className="rv-header-top">
        <div className="rv-header-brand">
          <button
            type="button"
            className="rv-icon-btn"
            onClick={onToggleSidebar}
            title={r.filesChanged}
            aria-label={r.filesChanged}
            aria-expanded={sidebarOpen}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="2.5" width="12" height="11" rx="2" />
              <line x1="6" y1="2.5" x2="6" y2="13.5" />
            </svg>
          </button>
          <span className="rv-brand-mark" aria-hidden="true" title={r.title}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor" opacity="0.14" />
              <path
                d="M7 8.5h4.5M9.25 6.25V10.75M7 15.5h4.5M14 9l2.5 2.5L20 7.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div className="rv-brand-meta">
            <div className="rv-brand-title-row">
              <span className="rv-repo-name">{r.title}</span>
              {repoName && repoName !== r.title && <span className="rv-branch-pill">{repoName}</span>}
              <span className="rv-branch-pill">{branch}</span>
              {isDemo && <span className="rv-demo-pill">{dict.demoFixture}</span>}
            </div>
            <div className="rv-header-stats">
              <span className="rv-stat-files">
                {totalFiles} {r.filesChanged}
              </span>
              <span className="rv-stat-add">+{totalAdditions}</span>
              <span className="rv-stat-del">-{totalDeletions}</span>
              <span className="rv-progress-inline" title={`${viewedCount}/${totalFiles} ${r.filesChanged}`}>
                <span className="rv-progress-track">
                  <span className="rv-progress-fill" style={{ width: `${progressPct}%` }} />
                </span>
                <span>
                  {viewedCount}/{totalFiles}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="rv-header-actions">
          <div className="rv-segmented" role="group" aria-label={r.title}>
            <button
              type="button"
              className={viewMode === 'unified' ? 'rv-seg-btn is-active' : 'rv-seg-btn'}
              onClick={() => onViewModeChange('unified')}
            >
              {r.unified}
            </button>
            <button
              type="button"
              className={viewMode === 'split' ? 'rv-seg-btn is-active' : 'rv-seg-btn'}
              onClick={() => onViewModeChange('split')}
            >
              {r.split}
            </button>
          </div>
          <button
            type="button"
            className={loading ? 'rv-btn rv-btn-ghost rv-spinning' : 'rv-btn rv-btn-ghost'}
            onClick={onRefresh}
            disabled={loading}
            title={r.refresh}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path
                d="M13.5 8a5.5 5.5 0 1 1-1.4-3.67M13.5 2.5v2.75h-2.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="rv-btn-label-sm">{loading ? dict.common.loading : r.refresh}</span>
          </button>
        </div>
      </div>

      <div className="rv-header-controls">
        <select
          className="rv-scope-select"
          value={scope}
          onChange={(e) => onScopeChange(e.target.value as ReviewScope)}
          aria-label={r.scopeRange}
        >
          <option value="working">{r.scopeWorking}</option>
          <option value="staged">{r.scopeStaged}</option>
          <option value="unstaged">{r.scopeUnstaged}</option>
          <option value="head~1">{r.scopeHead}</option>
          <option value="commit-range">{r.scopeRange}</option>
        </select>

        {scope === 'commit-range' && (
          <form
            className="rv-range-form"
            onSubmit={(e) => {
              e.preventDefault();
              onCommitRangeApply();
            }}
          >
            <input
              type="text"
              className="rv-input-sm rv-range-input"
              value={commitRange}
              onChange={(e) => onCommitRangeChange(e.target.value)}
              placeholder="HEAD~2..HEAD"
              aria-label={r.scopeRange}
            />
            <button type="submit" className="rv-btn rv-btn-subtle">
              {dict.common.run}
            </button>
          </form>
        )}

        <input
          type="search"
          className="rv-input-sm rv-search-input"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={r.filterFilesPlaceholder}
          aria-label={r.filterFilesPlaceholder}
        />

        <div className="rv-filter-pills" role="group" aria-label={r.filesChanged}>
          {(
            [
              ['all', dict.categoryAll],
              ['annotated', r.annotations],
              ['unviewed', r.unresolved],
              ['risky', r.riskLineBadge],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              className={filterMode === val ? 'rv-filter-pill is-active' : 'rv-filter-pill'}
              onClick={() => onFilterModeChange(val)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="rv-filter-pills" role="group" aria-label={r.title}>
          <button
            type="button"
            className={ignoreWhitespace ? 'rv-filter-pill is-active' : 'rv-filter-pill'}
            onClick={onToggleIgnoreWhitespace}
            aria-pressed={ignoreWhitespace}
            title={r.ignoreWhitespace}
          >
            {r.ignoreWhitespace}
          </button>
          <button
            type="button"
            className={syntaxHighlight ? 'rv-filter-pill is-active' : 'rv-filter-pill'}
            onClick={onToggleSyntaxHighlight}
            aria-pressed={syntaxHighlight}
            title={r.syntaxHighlight}
          >
            {r.syntaxHighlight}
          </button>
        </div>
      </div>
    </header>
  );
};
