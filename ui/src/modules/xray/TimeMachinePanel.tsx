import React, { useState } from 'react';
import { useNovI18n } from '../../i18n/index.js';
import {
  fmtTokens,
  fmtUsd,
  type ArtifactSummary,
  type SearchHit,
  type SessionSummary,
} from './types';

interface TimeMachinePanelProps {
  sessions: SessionSummary[];
  artifacts: ArtifactSummary[];
  hits: SearchHit[];
  searching: boolean;
  hasSearched?: boolean;
  canInject: boolean;
  onSearch: (q: string) => void;
  onSelectSession: (id: string) => void;
  onInjectHit: (hit: SearchHit) => void;
  onInjectArtifact: (art: ArtifactSummary) => void;
}

export const TimeMachinePanel: React.FC<TimeMachinePanelProps> = ({
  sessions,
  artifacts,
  hits,
  searching,
  hasSearched = false,
  canInject,
  onSearch,
  onSelectSession,
  onInjectHit,
  onInjectArtifact,
}) => {
  const { dict } = useNovI18n();
  const x = dict.panels.xray;
  const [query, setQuery] = useState('');
  const [submittedOnce, setSubmittedOnce] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSubmittedOnce(true);
    onSearch(query);
  };

  const showNoHits = (hasSearched || submittedOnce) && !searching && hits.length === 0;

  return (
    <div className="xr-stack">
      <form onSubmit={handleSubmit} className="xr-search-form">
        <input
          className="xr-input xr-search-input"
          placeholder={x.searchPlaceholder}
          aria-label={x.searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="xr-btn xr-btn-primary" disabled={searching}>
          {searching ? dict.common.loading : dict.common.run}
        </button>
      </form>

      {/* Search Hits or Empty Search State */}
      {hits.length > 0 ? (
        <div className="xr-card">
          <div className="xr-section-title">
            <span>
              {x.timeMachineTitle} ({hits.length})
            </span>
            <span className="xr-badge xr-sev-good">{dict.badgeOffline}</span>
          </div>
          <div className="xr-list">
            {hits.map((hit, i) => (
              <div key={`${hit.sessionId}-${hit.filePath}-${i}`} className="xr-file-row">
                <div className="xr-file-meta">
                  <div className="xr-hit-header">
                    <span
                      className={`xr-badge ${hit.sourceKind === 'artifact' ? 'xr-sev-info' : 'xr-sev-good'}`}
                    >
                      {hit.sourceKind === 'artifact' ? hit.sourceLabel : 'JSONL'}
                    </span>
                    <strong className="xr-hit-title">{hit.sessionTitle}</strong>
                    <span className="xr-badge xr-mono">{hit.score}</span>
                  </div>
                  <div className="xr-snippet">{hit.snippet}</div>
                </div>
                <div className="xr-row-actions">
                  <button
                    type="button"
                    className="xr-btn"
                    onClick={() => onSelectSession(hit.sessionId)}
                  >
                    {x.tabOverview}
                  </button>
                  {canInject && (
                    <button
                      type="button"
                      className="xr-btn xr-btn-primary"
                      onClick={() => onInjectHit(hit)}
                    >
                      {x.injectExcerpt}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        showNoHits && <div className="xr-card xr-empty-state">{x.noSearchHits}</div>
      )}

      {/* Current Session Artifacts */}
      {artifacts.length > 0 && (
        <div className="xr-card">
          <div className="xr-section-title">
            <span>
              {x.artifactsTitle} ({artifacts.length})
            </span>
          </div>
          <div className="xr-list">
            {artifacts.map((art) => (
              <div key={art.path} className="xr-file-row">
                <div className="xr-file-meta">
                  <div className="xr-file-name">{art.name}</div>
                  <div className="xr-snippet">{art.preview.slice(0, 160)}</div>
                </div>
                {canInject && (
                  <div className="xr-row-actions">
                    <button
                      type="button"
                      className="xr-btn xr-btn-primary"
                      onClick={() => onInjectArtifact(art)}
                    >
                      {x.attachContext}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Local Sessions */}
      <div className="xr-card">
        <div className="xr-section-title">
          <span>
            {x.title} ({sessions.length})
          </span>
        </div>
        {sessions.length === 0 ? (
          <div className="xr-empty-state">{dict.common.empty}</div>
        ) : (
          <div className="xr-list">
            {sessions.slice(0, 12).map((s) => (
              <div key={s.id} className="xr-file-row">
                <div className="xr-file-meta">
                  <div className="xr-session-title">{s.title}</div>
                  <div className="xr-file-dir xr-mono">
                    {s.source} · {s.model} · {s.turns}T · {fmtTokens(s.totalInputTokens)} ·{' '}
                    {(s.cacheHitRate * 100).toFixed(0)}%
                    {s.estimatedUsd != null ? ` · ${fmtUsd(s.estimatedUsd)}` : ''}
                  </div>
                </div>
                <div className="xr-row-actions">
                  <button type="button" className="xr-btn" onClick={() => onSelectSession(s.id)}>
                    {x.tabOverview}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
