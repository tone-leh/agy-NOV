import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import type {
  ModuleRegistrationResult,
  ModuleToolHandle,
  NovRuntimeOptions,
} from '../../core/types.js';
import {
  ackRadarSession,
  ackRadarSessionsInBoard,
  clearCompletedInBoard,
  clearCompletedRadarSessions,
  computeRadarBoardView,
  createDemoRadarBoard,
  loadRadarBoardReadOnly,
  normalizeRadarPrefs,
  updateRadarPrefs,
  type RadarBoardFile,
  type RadarSessionStatus,
} from './core.js';

function toHandle(name: string, tool: RegisteredTool): ModuleToolHandle {
  return {
    name,
    enable: () => tool.enable(),
    disable: () => tool.disable(),
  };
}

export function registerRadarModule(
  server: McpServer,
  options: NovRuntimeOptions,
  uiResourceUri: string,
): ModuleRegistrationResult {
  const rootDataDir = resolveNovDataDir(options.dataDir);
  const moduleDataDir = getModuleDataDir(rootDataDir, 'radar');
  const isDemo = options.demoMode === true;

  // In demo mode keep synthetic sessions strictly in memory (zero disk writes)
  let demoBoard: RadarBoardFile | null = isDemo ? createDemoRadarBoard() : null;

  const APP_ONLY_META = {
    ui: {
      resourceUri: uiResourceUri,
      visibility: ['app'] as ['app'],
    },
  };

  const getBoardView = (filter?: {
    statusFilter?: RadarSessionStatus;
    onlyUnread?: boolean;
  }) => {
    const board = isDemo && demoBoard ? demoBoard : loadRadarBoardReadOnly(moduleDataDir);
    return computeRadarBoardView(board, {
      mode: isDemo ? 'demo' : 'live',
      statusFilter: filter?.statusFilter,
      onlyUnread: filter?.onlyUnread,
    });
  };

  const modelTools: ModuleToolHandle[] = [];

  // 1. Model-visible: radar_get_board
  const getBoardTool = server.registerTool(
    'radar_get_board',
    {
      title: 'Get Session Radar Board',
      description:
        'Read the multi-session attention radar (running, awaiting_approval, completed, stalled, error) with unread counters and idle durations.',
      inputSchema: {
        statusFilter: z
          .enum(['running', 'awaiting_approval', 'completed', 'stalled', 'error'])
          .optional()
          .describe('Optional filter by computed session status'),
        onlyUnread: z.boolean().optional().describe('Return only unread sessions'),
      },
    },
    async ({ statusFilter, onlyUnread }) => {
      const view = getBoardView({ statusFilter, onlyUnread });
      const lines = [
        `Session Radar (${view.mode}): total=${view.counts.total}, running=${view.counts.running}, awaiting_approval=${view.counts.awaiting_approval}, stalled=${view.counts.stalled}, completed=${view.counts.completed}, error=${view.counts.error}, unread=${view.counts.unread}`,
        ...view.sessions.slice(0, 15).map(
          (s) =>
            `- [${s.status.toUpperCase()}${s.unread ? ' · UNREAD' : ''}] ${s.conversationId} (${s.workspaceName}, tool=${s.lastToolName ?? 'n/a'}, idle=${s.idleMinutes}m, steps=${s.stepCount})`,
        ),
      ];
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: { ...view },
      };
    },
  );
  modelTools.push(toHandle('radar_get_board', getBoardTool));

  // 2. Model-visible: radar_ack_session
  const ackSessionTool = server.registerTool(
    'radar_ack_session',
    {
      title: 'Acknowledge Radar Session',
      description:
        'Mark one conversation (or all conversations when omitted / "all") as read on the Session Radar board.',
      inputSchema: {
        conversationId: z
          .string()
          .optional()
          .describe('Conversation ID to acknowledge; omit or pass "all" to acknowledge all unread sessions'),
      },
    },
    async ({ conversationId }) => {
      let acknowledgedCount = 0;
      if (isDemo && demoBoard) {
        acknowledgedCount = ackRadarSessionsInBoard(demoBoard, conversationId).acknowledgedCount;
        demoBoard.updatedAt = new Date().toISOString();
      } else {
        acknowledgedCount = ackRadarSession(moduleDataDir, conversationId).acknowledgedCount;
      }
      const view = getBoardView();
      return {
        content: [
          {
            type: 'text',
            text:
              acknowledgedCount > 0
                ? `Acknowledged ${acknowledgedCount} session(s); remaining unread=${view.counts.unread}.`
                : 'No unread sessions matched.',
          },
        ],
        structuredContent: {
          acknowledgedCount,
          unreadRemaining: view.counts.unread,
          board: view,
        },
      };
    },
  );
  modelTools.push(toHandle('radar_ack_session', ackSessionTool));

  // App-only tools (4)
  server.registerTool(
    'app_radar_get_board',
    {
      title: 'Get Radar Board (App Only)',
      description: 'Fetch full Session Radar board state and notification preferences for UI.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { ...getBoardView() },
    }),
  );

  server.registerTool(
    'app_radar_ack_session',
    {
      title: 'Acknowledge Session (App Only)',
      description: 'Clear unread badge for one session or all sessions from the Radar UI.',
      inputSchema: {
        conversationId: z.string().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ conversationId }) => {
      let acknowledgedCount = 0;
      if (isDemo && demoBoard) {
        acknowledgedCount = ackRadarSessionsInBoard(demoBoard, conversationId).acknowledgedCount;
        demoBoard.updatedAt = new Date().toISOString();
      } else {
        acknowledgedCount = ackRadarSession(moduleDataDir, conversationId).acknowledgedCount;
      }
      const board = getBoardView();
      return {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { acknowledgedCount, board },
      };
    },
  );

  server.registerTool(
    'app_radar_update_prefs',
    {
      title: 'Update Radar Preferences (App Only)',
      description: 'Update desktop notification, sound chime, and stall detection threshold.',
      inputSchema: {
        desktopNotify: z.boolean().optional(),
        soundChime: z.boolean().optional(),
        stallMinutes: z.number().int().min(1).max(120).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async (patch) => {
      if (isDemo && demoBoard) {
        demoBoard.prefs = normalizeRadarPrefs({ ...demoBoard.prefs, ...patch });
        demoBoard.updatedAt = new Date().toISOString();
      } else {
        updateRadarPrefs(moduleDataDir, patch);
      }
      const board = getBoardView();
      return {
        content: [{ type: 'text', text: 'saved' }],
        structuredContent: { prefs: board.prefs, board },
      };
    },
  );

  server.registerTool(
    'app_radar_clear_completed',
    {
      title: 'Clear Completed Sessions (App Only)',
      description: 'Remove completed and errored sessions from the Radar board.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => {
      let removedCount = 0;
      if (isDemo && demoBoard) {
        removedCount = clearCompletedInBoard(demoBoard).removedCount;
        demoBoard.updatedAt = new Date().toISOString();
      } else {
        removedCount = clearCompletedRadarSessions(moduleDataDir).removedCount;
      }
      const board = getBoardView();
      return {
        content: [{ type: 'text', text: 'cleared' }],
        structuredContent: { removedCount, board },
      };
    },
  );

  return {
    moduleId: 'radar',
    modelTools,
  };
}
