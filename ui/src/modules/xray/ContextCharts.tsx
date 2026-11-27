import React from 'react';
import {
  fmtTokens,
  type ContextCompositionBucket,
  type SessionDetail,
  type ToolHotspot,
  type TurnMetric,
} from './types';

const BUCKET_COLOR_VARS: Record<ContextCompositionBucket['key'], string> = {
  cached_prefix: 'var(--nov-success)',
  fresh_input: 'var(--nov-accent)',
  tool_outputs_est: 'var(--nov-warn)',
  thinking_est: 'var(--xr-purple)',
  assistant_output: 'var(--xr-pink)',
};

export const ContextCharts: React.FC<{ detail: SessionDetail }> = ({ detail }) => {
  const { summary, composition, turns, toolHotspots, diagnostics } = detail;
  const maxTurnIn = Math.max(1, ...turns.map((t) => t.inputTokens));

  const cacheColor =
    summary.cacheHitRate >= 0.65
      ? 'var(--nov-success)'
      : summary.cacheHitRate >= 0.4
        ? 'var(--nov-warn)'
        : 'var(--nov-danger)';

  return (
    <div className="xr-stack">
      <div className="xr-kpi-grid">
        <div className="xr-card">
          <div className="xr-kpi-label">Peak Window</div>
          <div className="xr-kpi-value">{fmtTokens(summary.peakContextTokens)}</div>
          <div className="xr-kpi-sub">
            {summary.turns} turns · {summary.steps} steps
          </div>
        </div>
        <div className="xr-card">
          <div className="xr-kpi-label">Prefix Cache Hit</div>
          <div className="xr-kpi-value" style={{ color: cacheColor }}>
            {(summary.cacheHitRate * 100).toFixed(1)}%
          </div>
          <div className="xr-kpi-sub">{fmtTokens(summary.totalCacheReadTokens)} cached</div>
        </div>
        <div className="xr-card">
          <div className="xr-kpi-label">Total Tokens</div>
          <div className="xr-kpi-value">
            {fmtTokens(summary.totalInputTokens + summary.totalOutputTokens)}
          </div>
          <div className="xr-kpi-sub">
            In {fmtTokens(summary.totalInputTokens)} · Out {fmtTokens(summary.totalOutputTokens)}
          </div>
        </div>
        <div className="xr-card">
          <div className="xr-kpi-label">Agent Activity</div>
          <div className="xr-kpi-value">{summary.toolCallsCount}</div>
          <div className="xr-kpi-sub">
            {summary.filesTouchedCount} files · {summary.artifactsCount} artifacts
          </div>
        </div>
      </div>

      {/* Composition Bar */}
      <div className="xr-card">
        <div className="xr-section-title">
          <span>Context Composition X-Ray</span>
          <span className="xr-badge xr-mono">{summary.model}</span>
        </div>
        <div className="xr-stacked-bar" role="img" aria-label="Context token composition">
          {composition.map((b) => (
            <div
              key={b.key}
              title={`${b.label}: ${fmtTokens(b.tokens)} (${b.sharePercent}%)`}
              style={{
                width: `${Math.max(2, b.sharePercent)}%`,
                background: BUCKET_COLOR_VARS[b.key],
              }}
            />
          ))}
        </div>
        <div className="xr-legend-row">
          {composition.map((b) => (
            <span key={b.key} className="xr-legend-item">
              <span className="xr-legend-dot" style={{ background: BUCKET_COLOR_VARS[b.key] }} />
              <span>{b.label}</span>
              <strong className="xr-mono">{fmtTokens(b.tokens)}</strong>
              <span>({b.sharePercent}%)</span>
            </span>
          ))}
        </div>
      </div>

      {/* Turn-by-turn Context Growth SVG */}
      {turns.length > 0 && (
        <div className="xr-card">
          <div className="xr-section-title">
            <span>Turn-by-Turn Context Growth &amp; Cache Stability</span>
            <span className="xr-kpi-sub">Green = Cached · Blue = Fresh Input</span>
          </div>
          <TurnGrowthSvg turns={turns} maxIn={maxTurnIn} />
        </div>
      )}

      {/* Diagnostics */}
      {diagnostics.length > 0 && (
        <div className="xr-card">
          <div className="xr-section-title">
            <span>Automated Diagnostics</span>
          </div>
          <div className="xr-diag-list">
            {diagnostics.map((d, i) => (
              <div key={i} className={`xr-diag-item xr-sev-${d.severity}`}>
                <span className={`xr-badge xr-sev-${d.severity}`}>{d.severity.toUpperCase()}</span>
                <div className="xr-diag-body">
                  <div className="xr-diag-title">{d.title}</div>
                  <div className="xr-diag-detail">{d.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Token Vampires Table */}
      <div className="xr-card">
        <div className="xr-section-title">
          <span>Tool Output Hotspots (&quot;Token Vampires&quot;)</span>
          <span className="xr-kpi-sub">{toolHotspots.length} tools</span>
        </div>
        {toolHotspots.length === 0 ? (
          <div className="xr-empty-state">No tool calls recorded in this session yet.</div>
        ) : (
          <div className="xr-table-wrap">
            <table className="xr-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Calls</th>
                  <th>Payload</th>
                  <th>Est. Tokens</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                {toolHotspots.slice(0, 10).map((t: ToolHotspot) => (
                  <tr key={t.toolName}>
                    <td className="xr-mono">
                      {t.toolName}{' '}
                      {t.truncatedCount > 0 && (
                        <span className="xr-badge xr-sev-warn">{t.truncatedCount} trunc</span>
                      )}
                    </td>
                    <td className="xr-mono">{t.calls}</td>
                    <td className="xr-mono">{(t.totalOutputBytes / 1024).toFixed(1)} KB</td>
                    <td className="xr-mono">{fmtTokens(t.estimatedTokens)}</td>
                    <td className="xr-share-cell">
                      <div className="xr-share-wrap">
                        <div className="xr-share-track">
                          <div
                            className="xr-share-fill"
                            style={{
                              width: `${Math.min(100, t.sharePercent)}%`,
                              background: t.sharePercent >= 35 ? 'var(--nov-warn)' : 'var(--nov-accent)',
                            }}
                          />
                        </div>
                        <span className="xr-mono xr-share-pct">{t.sharePercent}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const TurnGrowthSvg: React.FC<{ turns: TurnMetric[]; maxIn: number }> = ({ turns, maxIn }) => {
  const width = 560;
  const height = 148;
  const padL = 44;
  const padR = 14;
  const padT = 12;
  const padB = 24;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const slotW = plotW / Math.max(1, turns.length);
  const barW = Math.min(28, Math.max(8, slotW * 0.62));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="xr-growth-svg">
      {[0, 0.5, 1].map((frac) => {
        const y = padT + plotH * (1 - frac);
        return (
          <g key={frac}>
            <line
              x1={padL}
              y1={y}
              x2={width - padR}
              y2={y}
              stroke="var(--nov-border)"
              strokeDasharray="3 3"
            />
            <text
              x={padL - 6}
              y={y + 4}
              textAnchor="end"
              fontSize="10"
              fill="var(--nov-text-2)"
              fontFamily="var(--nov-font-mono)"
            >
              {fmtTokens(Math.round(maxIn * frac))}
            </text>
          </g>
        );
      })}
      {turns.map((t, idx) => {
        const cx = padL + idx * slotW + slotW / 2;
        const x = cx - barW / 2;
        const totalH = (t.inputTokens / maxIn) * plotH;
        const cacheH = (t.cacheReadTokens / maxIn) * plotH;
        const freshH = Math.max(0, totalH - cacheH);
        const yTop = padT + plotH - totalH;
        const yCache = padT + plotH - cacheH;
        return (
          <g key={t.turnIndex}>
            <title>
              {`Turn ${t.turnIndex} (step #${t.stepIndex})\nInput: ${fmtTokens(t.inputTokens)} | Cached: ${fmtTokens(t.cacheReadTokens)} (${(t.cacheHitRate * 100).toFixed(0)}%) | Out: ${fmtTokens(t.outputTokens)}`}
            </title>
            <rect
              x={x}
              y={yTop}
              width={barW}
              height={Math.max(1, freshH)}
              rx="2"
              fill="var(--nov-accent)"
              opacity="0.9"
            />
            <rect
              x={x}
              y={yCache}
              width={barW}
              height={cacheH}
              rx="2"
              fill="var(--nov-success)"
              opacity="0.92"
            />
            <text
              x={cx}
              y={height - 7}
              textAnchor="middle"
              fontSize="10"
              fill="var(--nov-text-2)"
              fontFamily="var(--nov-font-mono)"
            >
              T{t.turnIndex}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
