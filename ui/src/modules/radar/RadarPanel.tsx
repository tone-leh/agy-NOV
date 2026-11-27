import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ModuleId } from '../../../../src/core/catalog.js';
import type { NovBridge } from '../../bridge.js';
import { useNovI18n } from '../../i18n/index.js';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
  onNavigateModule?: (moduleId: ModuleId, context?: { worktreePath?: string; branch?: string }) => void;
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

type RadarSession = RadarBoard['sessions'][number];
type RadarViewMode = 'kanban' | 'list';

export const RadarPanel: React.FC<NovModulePanelProps> = ({
  bridge,
  active,
  onNotify,
  onNavigateModule,
}) => {
  const { dict, t } = useNovI18n();
  const [board, setBoard] = useState<RadarBoard | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewMode, setViewMode] = useState<RadarViewMode>('kanban');

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

  const statusLabel = (st: RadarSession['status']): string => {
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

  const statusBadgeClass = (st: RadarSession['status']): string => {
    if (st === 'completed') return 'nov-badge is-offline';
    if (st === 'awaiting_approval' || st === 'stalled' || st === 'error') return 'nov-badge is-network';
    return 'nov-badge is-accent';
  };

  const kanbanLanes = useMemo(() => {
    const sessions = board?.sessions ?? [];
    return [
      {
        id: 'awaiting_approval',
        title: dict.radar.awaiting,
        accentColor: 'var(--nov-warn)',
        highlightBg: 'var(--nov-warn-soft)',
        priority: true,
        items: sessions.filter((s) => s.status === 'awaiting_approval'),
      },
      {
        id: 'running',
        title: dict.radar.running,
        accentColor: 'var(--nov-accent)',
        highlightBg: undefined,
        priority: false,
        items: sessions.filter((s) => s.status === 'running'),
      },
      {
        id: 'stalled_error',
        title: `${dict.radar.stalled} / ${dict.radar.error}`,
        accentColor: 'var(--nov-danger)',
        highlightBg: undefined,
        priority: false,
        items: sessions.filter((s) => s.status === 'stalled' || s.status === 'error'),
      },
      {
        id: 'completed',
        title: dict.radar.completed,
        accentColor: 'var(--nov-success)',
        highlightBg: undefined,
        priority: false,
        items: sessions.filter((s) => s.status === 'completed'),
      },
    ];
  }, [board?.sessions, dict.radar]);

  const renderSessionCard = (s: RadarSession, highlightApproval = false) => (
    <div
      key={s.conversationId}
      className="nov-p-item"
      style={
        highlightApproval
          ? {
              borderColor: 'var(--nov-warn)',
              background: 'var(--nov-bg-0)',
            }
          : undefined
      }
    >
      <div className="nov-p-row" style={{ flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span className={statusBadgeClass(s.status)}>{statusLabel(s.status)}</span>
          <strong>{s.workspaceName}</strong>
          <span style={{ fontSize: '11px', color: 'var(--nov-text-2)' }}>{s.conversationId}</span>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="nov-p-btn"
            disabled={busy}
            onClick={() => onNavigateModule?.('review')}
          >
            {t(dict.openModuleBtn, { label: dict.modules.review.shortLabel })}
          </button>
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
      </div>
      <div style={{ fontSize: '11.5px', color: 'var(--nov-text-1)' }}>
        {dict.radar.lastTool}: <code>{s.lastToolName ?? '—'}</code> · {s.stepCount}{' '}
        {dict.radar.steps} · {s.idleMinutes}m
      </div>
    </div>
  );

  return (
    <div className="nov-p-page">
      <section className="nov-p-card">
        <div className="nov-p-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h2 className="nov-hero-title">{dict.radar.title}</h2>
            <p className="nov-hero-sub">{dict.radar.subtitle}</p>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="nov-p-tabs" role="group" aria-label={dict.radar.boardViewLabel}>
              <button
                type="button"
                className={`nov-preset-btn ${viewMode === 'kanban' ? 'is-active' : ''}`}
                onClick={() => setViewMode('kanban')}
              >
                {dict.radar.viewKanban}
              </button>
              <button
                type="button"
                className={`nov-preset-btn ${viewMode === 'list' ? 'is-active' : ''}`}
                onClick={() => setViewMode('list')}
              >
                {dict.radar.viewList}
              </button>
            </div>
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
            <div className="nov-p-stat-label">{dict.radar.awaiting}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-warn)' }}>
              {board?.counts.awaiting_approval ?? 0}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.radar.running}</div>
            <div className="nov-p-stat-val">{board?.counts.running ?? 0}</div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.radar.stalled}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-danger)' }}>
              {(board?.counts.stalled ?? 0) + (board?.counts.error ?? 0)}
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
        ) : viewMode === 'list' ? (
          <div className="nov-p-list">
            {board.sessions.map((s) => renderSessionCard(s, s.status === 'awaiting_approval'))}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              gap: '10px',
              alignItems: 'start',
            }}
          >
            {kanbanLanes.map((lane) => {
              const isHighlighted = lane.priority && lane.items.length > 0;
              return (
                <div
                  key={lane.id}
                  style={{
                    borderRadius: '10px',
                    border: isHighlighted
                      ? `2px solid ${lane.accentColor}`
                      : '1px solid var(--nov-border)',
                    background: isHighlighted ? lane.highlightBg : 'var(--nov-bg-1)',
                    padding: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    minWidth: 0,
                  }}
                >
                  <div className="nov-p-row" style={{ gap: '6px' }}>
                    <strong
                      style={{
                        fontSize: '12px',
                        color: lane.priority ? lane.accentColor : 'var(--nov-text-0)',
                      }}
                    >
                      {lane.priority ? '● ' : ''}
                      {lane.title}
                    </strong>
                    <span
                      className="nov-badge"
                      style={{
                        borderColor: lane.accentColor,
                        color: lane.accentColor,
                      }}
                    >
                      {lane.items.length}
                    </span>
                  </div>
                  {lane.items.length === 0 ? (
                    <div
                      style={{
                        fontSize: '11.5px',
                        color: 'var(--nov-text-2)',
                        padding: '6px 2px',
                      }}
                    >
                      {dict.common.empty}
                    </div>
                  ) : (
                    <div className="nov-p-list">
                      {lane.items.map((s) => renderSessionCard(s, lane.priority))}
                    </div>
                  )}
                </div>
              );
            })}
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
                  {t(dict.radar.minutesUnit, { m })}
                </option>
              ))}
            </select>
          </div>
        </section>
      )}
    </div>
  );
};
