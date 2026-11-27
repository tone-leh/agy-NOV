import React, { useCallback, useEffect, useState } from 'react';
import type { NovBridge } from '../../bridge.js';
import { useNovI18n } from '../../i18n/index.js';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
}

interface RadarBoard {
  mode: string;
  prefs: {
    desktopNotify: boolean;
    soundChime: boolean;
    stallMinutes: number;
  };
  counts: {
    total: number;
    running: number;
    awaiting_approval: number;
    completed: number;
    stalled: number;
    error: number;
    unread: number;
    subagents?: number;
    orphanSubagents?: number;
  };
  sessions: Array<{
    conversationId: string;
    workspaceName: string;
    status: 'running' | 'awaiting_approval' | 'completed' | 'stalled' | 'error';
    lastToolName?: string;
    stepCount: number;
    idleMinutes: number;
    unread: boolean;
    parentConversationId?: string;
    agentRole?: string;
    isSubagent?: boolean;
    isOrphanSubagent?: boolean;
  }>;
}

export const RadarPanel: React.FC<NovModulePanelProps> = ({ bridge, active, onNotify }) => {
  const { dict } = useNovI18n();
  const [board, setBoard] = useState<RadarBoard | null>(null);
  const [busy, setBusy] = useState(false);

  const loadBoard = useCallback(async () => {
    try {
      const res = await bridge.callTool<RadarBoard>('app_radar_get_board', {});
      setBoard(res);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    }
  }, [bridge, onNotify]);

  useEffect(() => {
    if (active) void loadBoard();
  }, [active, loadBoard]);

  const ackSession = async (conversationId?: string) => {
    setBusy(true);
    try {
      const res = await bridge.callTool<{ board: RadarBoard }>('app_radar_ack_session', {
        ...(conversationId ? { conversationId } : {}),
      });
      setBoard(res.board);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const clearCompleted = async () => {
    setBusy(true);
    try {
      const res = await bridge.callTool<{ board: RadarBoard }>('app_radar_clear_completed', {});
      setBoard(res.board);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const updatePrefs = async (patch: Partial<RadarBoard['prefs']>) => {
    setBusy(true);
    try {
      const res = await bridge.callTool<{ board: RadarBoard }>('app_radar_update_prefs', patch);
      setBoard(res.board);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = (st: RadarBoard['sessions'][number]['status']): string => {
    switch (st) {
      case 'running':
        return dict.radar.running;
      case 'awaiting_approval':
        return dict.radar.awaiting;
      case 'completed':
        return dict.radar.completed;
      case 'stalled':
        return dict.radar.stalled;
      case 'error':
        return dict.radar.error;
    }
  };

  const statusBadgeClass = (st: RadarBoard['sessions'][number]['status']): string => {
    if (st === 'completed') return 'nov-badge is-offline';
    if (st === 'awaiting_approval' || st === 'stalled' || st === 'error') return 'nov-badge is-network';
    return 'nov-badge is-accent';
  };

  return (
    <div className="nov-p-page">
      <section className="nov-p-card">
        <div className="nov-p-row">
          <div>
            <h2 className="nov-hero-title">{dict.radar.title}</h2>
            <p className="nov-hero-sub">{dict.radar.subtitle}</p>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button type="button" className="nov-p-btn" onClick={() => void loadBoard()}>
              {dict.common.refresh}
            </button>
            <button
              type="button"
              className="nov-p-btn"
              disabled={busy || !board?.counts.unread}
              onClick={() => void ackSession()}
            >
              {dict.radar.ackBtn}
            </button>
            <button
              type="button"
              className="nov-p-btn"
              disabled={busy}
              onClick={() => void clearCompleted()}
            >
              {dict.radar.clearDoneBtn}
            </button>
          </div>
        </div>

        <div className="nov-p-stat-grid">
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.radar.running}</div>
            <div className="nov-p-stat-val">{board?.counts.running ?? 0}</div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.radar.awaiting}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-warn)' }}>
              {board?.counts.awaiting_approval ?? 0}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.radar.stalled}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-danger)' }}>
              {board?.counts.stalled ?? 0}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.radar.completed}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-success)' }}>
              {board?.counts.completed ?? 0}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.radar.subagents}</div>
            <div className="nov-p-stat-val">{board?.counts.subagents ?? 0}</div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.radar.orphanSubagents}</div>
            <div
              className="nov-p-stat-val"
              style={{
                color: (board?.counts.orphanSubagents ?? 0) > 0 ? 'var(--nov-danger)' : undefined,
              }}
            >
              {board?.counts.orphanSubagents ?? 0}
            </div>
          </div>
        </div>
      </section>

      <section className="nov-p-card">
        {!board || board.sessions.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--nov-text-2)' }}>{dict.radar.emptyBoard}</p>
        ) : (
          <div className="nov-p-list">
            {board.sessions.map((s) => (
              <div key={s.conversationId} className="nov-p-item">
                <div className="nov-p-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span className={statusBadgeClass(s.status)}>{statusLabel(s.status)}</span>
                    <strong>{s.workspaceName}</strong>
                    <span style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                      {s.conversationId}
                    </span>
                    {s.isSubagent && (
                      <span className="nov-badge is-accent">
                        {dict.radar.subagents}
                        {s.agentRole ? `: ${s.agentRole}` : ''}
                      </span>
                    )}
                    {s.isOrphanSubagent && (
                      <span className="nov-badge is-network">{dict.radar.orphanSubagents}</span>
                    )}
                    {s.unread && <span className="nov-badge is-network">{dict.radar.unread}</span>}
                  </div>
                  {s.unread && (
                    <button
                      type="button"
                      className="nov-open-btn"
                      disabled={busy}
                      onClick={() => void ackSession(s.conversationId)}
                    >
                      {dict.radar.ackBtn}
                    </button>
                  )}
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--nov-text-1)' }}>
                  {dict.radar.lastTool}: <code>{s.lastToolName ?? '—'}</code> · {s.stepCount}{' '}
                  {dict.radar.steps} · {s.idleMinutes}m
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {board && (
        <section className="nov-p-card">
          <h3 className="nov-card-title">{dict.radar.prefsTitle}</h3>
          <div className="nov-p-row">
            <span>{dict.radar.desktopNotify}</span>
            <button
              type="button"
              role="switch"
              aria-checked={board.prefs.desktopNotify}
              className="nov-switch"
              disabled={busy}
              onClick={() => void updatePrefs({ desktopNotify: !board.prefs.desktopNotify })}
            >
              <span className="nov-switch-thumb" />
            </button>
          </div>
          <div className="nov-p-row">
            <span>{dict.radar.soundChime}</span>
            <button
              type="button"
              role="switch"
              aria-checked={board.prefs.soundChime}
              className="nov-switch"
              disabled={busy}
              onClick={() => void updatePrefs({ soundChime: !board.prefs.soundChime })}
            >
              <span className="nov-switch-thumb" />
            </button>
          </div>
          <div className="nov-p-row">
            <span>{dict.radar.stallThreshold}</span>
            <select
              className="nov-p-select"
              style={{ width: '110px' }}
              value={board.prefs.stallMinutes}
              disabled={busy}
              onChange={(e) => void updatePrefs({ stallMinutes: Number(e.target.value) })}
            >
              {[2, 5, 10, 15, 30].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </div>
        </section>
      )}
    </div>
  );
};
