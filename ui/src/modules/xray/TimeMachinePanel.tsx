import React, { useState } from 'react';
import { fmtTokens, type ArtifactSummary, type SearchHit, type SessionSummary } from './types';

interface TimeMachinePanelProps {
  sessions: SessionSummary[];
  artifacts: ArtifactSummary[];
  hits: SearchHit[];
  searching: boolean;
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
  canInject,
  onSearch,
  onSelectSession,
  onInjectHit,
  onInjectArtifact,
}) => {
  const [query, setQuery] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query);
  };

  return (
    <div className="xr-stack">
      <form onSubmit={handleSubmit} className="xr-search-form">
        <input
          className="xr-input xr-search-input"
          placeholder="Search all local Antigravity transcripts & artifacts (EN / 中文)..."
          aria-label="Search local transcripts and artifacts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="xr-btn xr-btn-primary" disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {/* Search Hits */}
      {hits.length > 0 && (
        <div className="xr-card">
          <div className="xr-section-title">
            <span>Time Machine Matches ({hits.length})</span>
            <span className="xr-kpi-sub">Local BM25 index · zero cloud upload</span>
          </div>
          <div className="xr-list">
            {hits.map((hit, i) => (
              <div key={`${hit.sessionId}-${hit.filePath}-${i}`} className="xr-file-row">
                <div className="xr-file-meta">
                  <div className="xr-hit-header">
                    <span
                      className={`xr-badge ${hit.sourceKind === 'artifact' ? 'xr-sev-info' : 'xr-sev-good'}`}
                    >
                      {hit.sourceKind === 'artifact' ? hit.sourceLabel : 'Transcript'}
                    </span>
                    <strong className="xr-hit-title">{hit.sessionTitle}</strong>
                    <span className="xr-badge xr-mono">score {hit.score}</span>
                  </div>
                  <div className="xr-snippet">{hit.snippet}</div>
                </div>
                <div className="xr-row-actions">
                  <button
                    type="button"
                    className="xr-btn"
                    onClick={() => onSelectSession(hit.sessionId)}
                  >
                    Inspect
                  </button>
                  {canInject && (
                    <button
                      type="button"
                      className="xr-btn xr-btn-primary"
                      onClick={() => onInjectHit(hit)}
                    >
                      Inject
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current Session Artifacts */}
      {artifacts.length > 0 && (
        <div className="xr-card">
          <div className="xr-section-title">
            <span>Active Session Artifacts ({artifacts.length})</span>
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
                      + Context
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
          <span>Recent Local Sessions ({sessions.length})</span>
        </div>
        {sessions.length === 0 ? (
          <div className="xr-empty-state">No local sessions available yet.</div>
        ) : (
          <div className="xr-list">
            {sessions.slice(0, 12).map((s) => (
              <div key={s.id} className="xr-file-row">
                <div className="xr-file-meta">
                  <div className="xr-session-title">{s.title}</div>
                  <div className="xr-file-dir xr-mono">
                    {s.source} · {s.model} · {s.turns} turns · {fmtTokens(s.totalInputTokens)} in ·{' '}
                    {(s.cacheHitRate * 100).toFixed(0)}% cache
                  </div>
                </div>
                <div className="xr-row-actions">
                  <button type="button" className="xr-btn" onClick={() => onSelectSession(s.id)}>
                    X-Ray
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
