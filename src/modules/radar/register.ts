import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import {
  listHostConversationsReadOnly,
  type ConversationRecord,
} from '../../core/conversation-service.js';
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
  reconcileRadarWithHostConversations,
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
      const subagentSummary =
        view.counts.subagents > 0 || view.counts.orphanSubagents > 0
          ? `, subagents=${view.counts.subagents}, orphan_subagents=${view.counts.orphanSubagents}`
          : '';
      const lines = [
        `Session Radar (${view.mode}): total=${view.counts.total}, running=${view.counts.running}, awaiting_approval=${view.counts.awaiting_approval}, stalled=${view.counts.stalled}, completed=${view.counts.completed}, error=${view.counts.error}, unread=${view.counts.unread}${subagentSummary}`,
        ...view.sessions.slice(0, 15).map((s) => {
          const badges = [
            s.status.toUpperCase(),
            ...(s.unread ? ['UNREAD'] : []),
            ...(s.isSubagent ? [s.agentRole ? `SUBAGENT:${s.agentRole}` : 'SUBAGENT'] : []),
            ...(s.isOrphanSubagent ? ['ORPHAN'] : []),
          ].join(' · ');
          return `- [${badges}] ${s.conversationId} (${s.workspaceName}, tool=${s.lastToolName ?? 'n/a'}, idle=${s.idleMinutes}m, steps=${s.stepCount})`;
        }),
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

  server.registerTool(
    'app_radar_reconcile_conversations',
    {
      title: 'Reconcile Radar with Host Conversations (App Only)',
      description:
        'Read-only comparison of local Radar board sessions against live Antigravity ConversationService records to detect ghost-active (driftedToIdle) and untracked host-running sessions.',
      inputSchema: {
        pageSize: z.number().int().min(1).max(100).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ pageSize }) => {
      const boardView = getBoardView();
      const checkedAt = new Date().toISOString();

      if (isDemo) {
        const nowMs = Date.now();
        const demoHostConversations: ConversationRecord[] = [
          {
            id: 'conv-ui-polish',
            title: 'Implementing Turbo & Radar tabs in single-file MCP App UI',
            summary: 'Actively editing Radar tab layout',
            runState: 'RUN_STATE_RUNNING',
            updateTime: new Date(nowMs - 20_000).toISOString(),
            tags: ['ui', 'radar'],
            pinned: false,
            starred: false,
            archived: false,
          },
          {
            id: 'conv-dep-upgrade',
            title: 'Background Scout subagent dependency audit',
            summary: 'Subagent finished execution on host while Radar still marks stalled',
            runState: 'RUN_STATE_IDLE',
            updateTime: new Date(nowMs - 9 * 60_000).toISOString(),
            tags: ['subagent'],
            pinned: false,
            starred: false,
            archived: false,
          },
          {
            id: 'conv-unit-tests',
            title: 'Offline unit test suite',
            summary: 'All 42 offline unit tests passed with zero warnings',
            runState: 'RUN_STATE_IDLE',
            updateTime: new Date(nowMs - 2 * 60_000).toISOString(),
            tags: ['tests'],
            pinned: false,
            starred: false,
            archived: false,
          },
          {
            id: 'conv-host-background-01',
            title: 'Untracked host background build verification',
            summary: 'Running on host without Radar hook registration yet',
            runState: 'RUN_STATE_RUNNING',
            updateTime: new Date(nowMs - 15_000).toISOString(),
            tags: ['host-live'],
            pinned: false,
            starred: false,
            archived: false,
          },
        ];

        const report = reconcileRadarWithHostConversations(
          boardView.sessions,
          demoHostConversations,
        );
        return {
          content: [
            {
              type: 'text',
              text: `Radar reconcile (demo): matched=${report.matchedCount}, driftedToIdle=${report.driftedToIdle.length}, hostOnlyRunning=${report.hostOnlyRunning.length}.`,
            },
          ],
          structuredContent: {
            mode: 'demo' as const,
            live: false,
            serviceAvailable: true,
            readOnly: true,
            ...report,
            checkedAt,
          },
        };
      }

      const res = await listHostConversationsReadOnly({}, pageSize ?? 50);
      if (!res.ok || !res.live) {
        const report = reconcileRadarWithHostConversations(boardView.sessions, []);
        const reason = res.reason || res.error || 'ConversationService unavailable';
        return {
          content: [
            {
              type: 'text',
              text: `Radar reconcile skipped (${reason}); local Radar tracks ${boardView.counts.total} session(s).`,
            },
          ],
          structuredContent: {
            mode: 'live' as const,
            live: false,
            serviceAvailable: false,
            readOnly: true,
            reason,
            ...report,
            checkedAt,
          },
        };
      }

      const report = reconcileRadarWithHostConversations(boardView.sessions, res.conversations);
      return {
        content: [
          {
            type: 'text',
            text: `Radar reconcile (live): matched=${report.matchedCount}, driftedToIdle=${report.driftedToIdle.length}, hostOnlyRunning=${report.hostOnlyRunning.length}.`,
          },
        ],
        structuredContent: {
          mode: 'live' as const,
          live: true,
          serviceAvailable: true,
          readOnly: true,
          ...report,
          checkedAt,
        },
      };
    },
  );

  return {
    moduleId: 'radar',
    modelTools,
    exemptReadOnlyAppTools: ['app_radar_reconcile_conversations'],
  };
}
