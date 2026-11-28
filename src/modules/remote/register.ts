import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import type {
  ModuleRegistrationResult,
  ModuleToolHandle,
  NovRuntimeOptions,
} from '../../core/types.js';
import {
  broadcastChannels,
  sendToChannel,
  validateTelegramBotToken,
  validateTelegramChatId,
  validateWebhookUrl,
} from './channels.js';
import { hasSavedConfig, toSafeChannelViews } from './config.js';
import { ConversationClient } from './conversation-client.js';
import { RemoteGateway } from './gateway.js';
import { detectLocalTunnelTools, readConversationLiveStream } from './live-stream.js';
import type { ChannelConfig } from './types.js';

function toHandle(
  name: string,
  reg: { enable: () => void; disable: () => void },
): ModuleToolHandle {
  return {
    name,
    enable: () => reg.enable(),
    disable: () => reg.disable(),
  };
}

export function registerRemoteModule(
  server: McpServer,
  opts: NovRuntimeOptions,
  uiResourceUri: string,
  initialEnabled: boolean,
): ModuleRegistrationResult {
  const rootDataDir = resolveNovDataDir(opts.dataDir);
  const dataDir = getModuleDataDir(rootDataDir, 'remote');
  const brainDirs = opts.brainDir ? [opts.brainDir] : undefined;
  const convClient = new ConversationClient({ demoMode: opts.demoMode });
  const gateway = new RemoteGateway(dataDir, convClient, {
    demoMode: opts.demoMode,
    rootDataDir,
    ...(brainDirs ? { brainDirs } : {}),
  });

  let moduleEnabled = Boolean(initialEnabled);
  let lifecycleQueue: Promise<void> = Promise.resolve();

  const enqueueLifecycle = <T>(task: () => Promise<T>): Promise<T> => {
    const next = lifecycleQueue.then(task, task);
    lifecycleQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const startGatewayWithFallback = async (): Promise<void> => {
    try {
      await gateway.start();
    } catch {
      // If configured port is already bound, try ephemeral fallback port 0
      try {
        await gateway.start(0);
      } catch {
        // Leave stopped; status endpoint reflects running: false
      }
    }
  };

  const setEnabledRuntime = (enabled: boolean): Promise<void> =>
    enqueueLifecycle(async () => {
      moduleEnabled = enabled;
      if (enabled) {
        gateway.updateConfig({ gatewayEnabled: true });
        if (!gateway.isRunning()) {
          await startGatewayWithFallback();
        }
      } else {
        if (hasSavedConfig(dataDir)) {
          gateway.updateConfig({ gatewayEnabled: false });
        } else {
          gateway.setGatewayEnabledInMemory(false);
        }
        await gateway.stop();
      }
    });

  const dispose = (): Promise<void> =>
    enqueueLifecycle(async () => {
      moduleEnabled = false;
      await gateway.stop();
    });

  // Strictly opt-in: when initialEnabled is false, perform zero port binds, zero config.json writes, and zero timers.
  if (initialEnabled) {
    void setEnabledRuntime(true).catch(() => {
      // Initialization errors (e.g., read-only dataDir) must never surface as unhandled rejections
    });
  }

  const APP_ONLY_META = {
    ui: {
      resourceUri: uiResourceUri,
      visibility: ['app'] as ['app'],
    },
  };

  const buildHubPayload = async () => {
    const cfg = gateway.getConfig();
    const channels = toSafeChannelViews(cfg.channels);
    if (!moduleEnabled) {
      const pub = gateway.getPublicStatus();
      return {
        moduleEnabled: false,
        running: false,
        status: { ...pub, running: false },
        channels,
        approvals: [],
        pendingApprovals: [],
        conversations: [],
        audit: [],
        conversationApiLive: false,
        riskPatterns: cfg.riskPatterns,
        host: cfg.host,
        port: cfg.port,
        publicBaseUrl: cfg.publicBaseUrl ?? '',
      };
    }

    const { conversations, live } = await convClient.listConversations(20);
    const status = gateway.getStatus();
    const approvals = gateway.getApprovals();
    return {
      moduleEnabled: true,
      running: status.running,
      status,
      channels,
      approvals,
      pendingApprovals: approvals.filter((a) => a.status === 'pending'),
      conversations,
      audit: gateway.getAudit(30),
      conversationApiLive: live,
      riskPatterns: cfg.riskPatterns,
      host: cfg.host,
      port: cfg.port,
      publicBaseUrl: cfg.publicBaseUrl ?? '',
    };
  };

  const modelTools: ModuleToolHandle[] = [];

  // 1. Model-visible: strictly sanitized gateway status (zero secrets/PINs/tokens)
  const statusTool = server.registerTool(
    'remote_status',
    {
      title: 'Get Remote Hub Status',
      description:
        'Return gateway status, connected mobile clients, enabled IM channels, and pending approval count (strictly sanitized; never exposes pairing tokens or PINs).',
      inputSchema: {},
    },
    async () => {
      const st = gateway.getPublicStatus();
      const channels = toSafeChannelViews(gateway.getConfig().channels);
      const running = moduleEnabled && st.running;
      return {
        content: [
          {
            type: 'text',
            text: `Gateway: ${running ? 'RUNNING' : 'STOPPED'}${running ? ` (${st.url})` : ''} | Mobile Clients: ${st.connectedClients} | Pending Approvals: ${st.pendingApprovals} | Enabled IM Channels: ${channels.filter((c) => c.enabled).map((c) => c.label).join(', ') || 'none'}`,
          },
        ],
        structuredContent: {
          moduleEnabled,
          running,
          url: running ? st.url : '',
          mobileUrl: running ? st.mobileUrl : '',
          connectedClients: st.connectedClients,
          pendingApprovals: st.pendingApprovals,
          channels,
        },
      };
    },
  );
  modelTools.push(toHandle('remote_status', statusTool));

  // 2. Model-visible: send redacted status alert to enabled IM channels
  const sendAlertTool = server.registerTool(
    'remote_send_alert',
    {
      title: 'Send Remote Alert',
      description:
        'Send a redacted status notification to all enabled IM channels (Telegram, Feishu, DingTalk, WeCom, Slack, Discord).',
      inputSchema: {
        title: z.string().min(1),
        body: z.string().min(1),
        level: z.enum(['info', 'warn', 'success']).optional(),
      },
    },
    async ({ title, body, level }) => {
      if (!moduleEnabled) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Remote module is currently disabled.' }],
          structuredContent: { results: [], moduleEnabled: false },
        };
      }
      const results = await broadcastChannels(gateway.getConfig().channels, {
        title,
        body,
        level: level ?? 'info',
      });
      const summary = results.length
        ? results.map((r) => `${r.channelId}: ${r.ok ? 'OK' : r.error}`).join(', ')
        : 'No enabled IM channels configured yet. Open the Remote tab to enable one.';
      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: { results },
      };
    },
  );
  modelTools.push(toHandle('remote_send_alert', sendAlertTool));

  // 3. Model-visible: list desktop Antigravity conversations
  const listConversationsTool = server.registerTool(
    'remote_list_conversations',
    {
      title: 'List Desktop Conversations',
      description: 'List local Antigravity conversations and their run states via ConversationService.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ limit }) => {
      if (!moduleEnabled) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Remote module is currently disabled.' }],
          structuredContent: { conversations: [], live: false, moduleEnabled: false },
        };
      }
      const { conversations, live } = await convClient.listConversations(limit ?? 20);
      const text = conversations
        .map((c) => `- [${c.runState.replace('RUN_STATE_', '')}] ${c.title} (${c.id})`)
        .join('\n');
      return {
        content: [{ type: 'text', text: text || 'No conversations found.' }],
        structuredContent: { conversations, live },
      };
    },
  );
  modelTools.push(toHandle('remote_list_conversations', listConversationsTool));

  // 4. Model-visible: dispatch new background task
  const dispatchTaskTool = server.registerTool(
    'remote_dispatch_task',
    {
      title: 'Dispatch Background Task',
      description:
        'Create a new Antigravity conversation with an initial prompt via ConversationService/CreateConversation.',
      inputSchema: {
        prompt: z.string().min(1),
        title: z.string().optional(),
        model: z.enum(['flash_lite', 'flash', 'pro']).optional(),
      },
    },
    async ({ prompt, title, model }) => {
      if (!moduleEnabled) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Remote module is currently disabled.' }],
          structuredContent: { moduleEnabled: false },
        };
      }
      const res = await convClient.createConversation({ prompt, title, model });
      return {
        content: [
          {
            type: 'text',
            text: `Dispatched conversation "${res.conversation.title}" (${res.conversation.id}, live=${res.live}).`,
          },
        ],
        structuredContent: res,
      };
    },
  );
  modelTools.push(toHandle('remote_dispatch_task', dispatchTaskTool));

  // App-only tools (11)
  server.registerTool(
    'app_remote_get_hub_state',
    {
      title: 'Get Remote Hub State (App Only)',
      description: 'Fetch full hub state for MCP App UI (returns lightweight offline snapshot when disabled).',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => {
      const payload = await buildHubPayload();
      return {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    'app_remote_update_channel',
    {
      title: 'Update IM Channel (App Only)',
      description: 'Validate and save IM channel credentials securely to mode-0600 config.json.',
      inputSchema: {
        id: z.string(),
        enabled: z.boolean().optional(),
        webhookUrl: z.string().optional(),
        secret: z.string().optional(),
        botToken: z.string().optional(),
        chatId: z.string().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async (input) => {
      if (!moduleEnabled) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Remote module is disabled.' }],
          structuredContent: { ok: false, error: 'Remote module is disabled. Enable Remote first.' },
        };
      }
      const cfg = gateway.getConfig();
      const target = cfg.channels.find((c) => c.id === input.id);
      if (!target) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Unknown channel: ${input.id}` }],
          structuredContent: {
            ok: false,
            error: `Unknown channel: ${input.id}`,
            channels: toSafeChannelViews(cfg.channels),
          },
        };
      }

      let validatedWebhook = target.webhookUrl;
      let validatedBotToken = target.botToken;
      let validatedChatId = target.chatId;

      try {
        if (target.kind === 'telegram') {
          if (input.botToken !== undefined) {
            const trimmed = input.botToken.trim();
            validatedBotToken = trimmed ? validateTelegramBotToken(trimmed) : undefined;
          }
          if (input.chatId !== undefined) {
            const trimmed = input.chatId.trim();
            validatedChatId = trimmed ? validateTelegramChatId(trimmed) : undefined;
          }
        } else if (input.webhookUrl !== undefined) {
          const trimmed = input.webhookUrl.trim();
          validatedWebhook = trimmed ? validateWebhookUrl(trimmed).toString() : undefined;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: msg }],
          structuredContent: { ok: false, error: msg, channels: toSafeChannelViews(cfg.channels) },
        };
      }

      const channels: ChannelConfig[] = cfg.channels.map((c) => {
        if (c.id !== input.id) return c;
        return {
          ...c,
          enabled: input.enabled ?? c.enabled,
          webhookUrl: validatedWebhook,
          secret: input.secret !== undefined ? input.secret.trim() : c.secret,
          botToken: validatedBotToken,
          chatId: validatedChatId,
        };
      });
      gateway.updateConfig({ channels });
      return {
        content: [{ type: 'text', text: 'saved' }],
        structuredContent: { ok: true, channels: toSafeChannelViews(channels) },
      };
    },
  );

  server.registerTool(
    'app_remote_test_channel',
    {
      title: 'Test IM Channel (App Only)',
      description: 'Send a live test ping to a specific configured IM channel.',
      inputSchema: { id: z.string() },
      _meta: APP_ONLY_META,
    },
    async ({ id }) => {
      if (!moduleEnabled) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Remote module is disabled.' }],
          structuredContent: { ok: false, error: 'Remote module is disabled. Enable Remote first.' },
        };
      }
      const ch = gateway.getConfig().channels.find((c) => c.id === id);
      if (!ch) {
        return {
          content: [{ type: 'text', text: 'not found' }],
          structuredContent: { ok: false, error: 'Channel not found' },
        };
      }
      const res = await sendToChannel(ch, {
        title: '🚀 Agy Remote Test Ping',
        body: 'Your Google Antigravity 2.0 remote channel is connected and ready.',
        level: 'success',
      });
      return {
        content: [{ type: 'text', text: res.ok ? 'ok' : res.error ?? 'err' }],
        structuredContent: { ...res },
      };
    },
  );

  server.registerTool(
    'app_remote_decide_approval',
    {
      title: 'Decide Approval (App Only)',
      description: 'Approve or deny a pending risky tool request.',
      inputSchema: { id: z.string(), decision: z.enum(['approved', 'denied']) },
      _meta: APP_ONLY_META,
    },
    async ({ id, decision }) => {
      if (!moduleEnabled) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Remote module is disabled.' }],
          structuredContent: { ok: false, error: 'Remote module is disabled.' },
        };
      }
      const updated = gateway.decideApproval(id, decision, 'antigravity-sidebar');
      return {
        content: [{ type: 'text', text: decision }],
        structuredContent: { approval: updated },
      };
    },
  );

  server.registerTool(
    'app_remote_simulate_approval',
    {
      title: 'Simulate Risky Command Approval (App Only)',
      description: 'Queue a synthetic risky command approval to test phone & IM alerts safely.',
      inputSchema: { command: z.string().optional() },
      _meta: APP_ONLY_META,
    },
    async ({ command }) => {
      if (!moduleEnabled || !gateway.isRunning()) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Remote gateway is not running. Enable Remote first.' }],
          structuredContent: { ok: false, error: 'Remote gateway is not running.' },
        };
      }
      const req = await gateway.createApproval({
        conversationId: 'demo-sim',
        toolName: 'run_command',
        summary: command || 'git push origin main --force',
        matchedRule: '\\bgit\\s+push\\b.*(--force|-f\\b)',
        timeoutSec: 90,
      });
      return {
        content: [{ type: 'text', text: req.id }],
        structuredContent: { approval: req },
      };
    },
  );

  server.registerTool(
    'app_remote_refresh_pin',
    {
      title: 'Refresh Pairing PIN (App Only)',
      description:
        'Generate a fresh 6-digit pairing PIN valid for 5 minutes while keeping existing paired devices connected.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => {
      if (!moduleEnabled) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Remote module is disabled.' }],
          structuredContent: { ok: false, error: 'Remote module is disabled.' },
        };
      }
      gateway.refreshPairingPin(true);
      return {
        content: [{ type: 'text', text: 'pin_refreshed' }],
        structuredContent: { status: gateway.getStatus() },
      };
    },
  );

  server.registerTool(
    'app_remote_rotate_pairing',
    {
      title: 'Rotate Pairing Token & PIN (App Only)',
      description: 'Generate a fresh 256-bit pairing token and 6-digit PIN.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => {
      if (!moduleEnabled) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Remote module is disabled.' }],
          structuredContent: { ok: false, error: 'Remote module is disabled.' },
        };
      }
      gateway.rotatePairingCredentials();
      return {
        content: [{ type: 'text', text: 'rotated' }],
        structuredContent: { status: gateway.getStatus() },
      };
    },
  );

  server.registerTool(
    'app_remote_update_settings',
    {
      title: 'Update Remote Policy Settings (App Only)',
      description:
        'Toggle remote approvals, stop alerts, LAN bind host/port, or public tunnel URL. Restarts gateway automatically when host or port changes while running.',
      inputSchema: {
        remoteApprovalEnabled: z.boolean().optional(),
        notifyOnStop: z.boolean().optional(),
        host: z.string().optional(),
        port: z.number().int().min(0).max(65535).optional(),
        publicBaseUrl: z.string().optional(),
        riskPatterns: z.array(z.string()).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async (patch) => {
      if (!moduleEnabled) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Remote module is disabled.' }],
          structuredContent: { ok: false, error: 'Remote module is disabled. Enable Remote first.' },
        };
      }
      let cleanPublicBaseUrl: string | undefined;
      if (patch.publicBaseUrl !== undefined) {
        const trimmed = patch.publicBaseUrl.trim();
        if (trimmed) {
          try {
            const parsed = new URL(trimmed);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
              throw new Error('publicBaseUrl must use http:// or https://');
            }
            if (parsed.searchParams.has('token') || parsed.username || parsed.password) {
              throw new Error('publicBaseUrl must not contain credentials or token query parameters');
            }
            cleanPublicBaseUrl = parsed.origin + parsed.pathname.replace(/\/+$/, '');
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              isError: true,
              content: [{ type: 'text', text: msg }],
              structuredContent: { ok: false, error: msg },
            };
          }
        }
      }

      await enqueueLifecycle(async () => {
        const prevCfg = gateway.getConfig();
        const nextHost = patch.host !== undefined ? patch.host.trim() || '127.0.0.1' : prevCfg.host;
        const nextPort = patch.port !== undefined ? patch.port : prevCfg.port;
        const bindChanged = nextHost !== prevCfg.host || nextPort !== prevCfg.port;

        gateway.updateConfig({
          ...(patch.remoteApprovalEnabled !== undefined
            ? { remoteApprovalEnabled: patch.remoteApprovalEnabled }
            : {}),
          ...(patch.notifyOnStop !== undefined ? { notifyOnStop: patch.notifyOnStop } : {}),
          ...(patch.host !== undefined ? { host: nextHost } : {}),
          ...(patch.port !== undefined ? { port: nextPort } : {}),
          ...(patch.publicBaseUrl !== undefined ? { publicBaseUrl: cleanPublicBaseUrl } : {}),
          ...(patch.riskPatterns !== undefined ? { riskPatterns: patch.riskPatterns } : {}),
        });

        if (bindChanged && moduleEnabled && gateway.isRunning()) {
          await gateway.stop();
          await startGatewayWithFallback();
        }
      });

      return {
        content: [{ type: 'text', text: 'updated' }],
        structuredContent: await buildHubPayload(),
      };
    },
  );

  server.registerTool(
    'app_remote_dispatch_task',
    {
      title: 'Dispatch Task (App Only)',
      description: 'Start a new Antigravity conversation from the Remote Hub UI.',
      inputSchema: {
        prompt: z.string().min(1),
        model: z.enum(['flash_lite', 'flash', 'pro']).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ prompt, model }) => {
      if (!moduleEnabled) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Remote module is disabled.' }],
          structuredContent: { ok: false, error: 'Remote module is disabled.' },
        };
      }
      const res = await convClient.createConversation({ prompt, model });
      return {
        content: [{ type: 'text', text: res.conversation.id }],
        structuredContent: res,
      };
    },
  );

  server.registerTool(
    'app_remote_get_conversation_stream',
    {
      title: 'Get Conversation Read-Only Live Stream (App Only)',
      description:
        'Read recent redacted conversation transcript steps (strictly read-only; rejects disabled remote module and unsafe IDs).',
      inputSchema: {
        conversationId: z.string().min(1),
        limit: z.number().int().min(1).max(40).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ conversationId, limit }) => {
      if (!moduleEnabled) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Remote module is disabled.' }],
          structuredContent: {
            ok: false,
            readOnly: true,
            error: 'Remote module is disabled. Enable Remote first.',
          },
        };
      }
      try {
        const stream = readConversationLiveStream(conversationId, {
          demoMode: opts.demoMode,
          limit,
          brainDirs,
        });
        return {
          content: [
            {
              type: 'text',
              text: stream.found
                ? `Loaded ${stream.events.length}/${stream.totalSteps} read-only steps (${stream.mode}).`
                : `No local transcript found for ${stream.conversationId}.`,
            },
          ],
          structuredContent: { ok: true, ...stream },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: msg }],
          structuredContent: { ok: false, readOnly: true, error: msg },
        };
      }
    },
  );

  server.registerTool(
    'app_remote_detect_tunnels',
    {
      title: 'Detect Local Tunnel Tools (App Only)',
      description:
        'Read-only on-demand check for locally installed tailscale/cloudflared CLI versions and safe copy-only commands (never auto-starts any tunnel).',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => {
      if (!moduleEnabled) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Remote module is disabled.' }],
          structuredContent: {
            ok: false,
            readOnly: true,
            autoStart: false,
            error: 'Remote module is disabled. Enable Remote first.',
          },
        };
      }
      const activePort = gateway.isRunning() ? gateway.getActualPort() : gateway.getConfig().port;
      const result = await detectLocalTunnelTools({
        port: activePort,
        demoMode: opts.demoMode,
      });
      return {
        content: [
          {
            type: 'text',
            text: result.tools
              .map((t) => `${t.binary}: ${t.installed ? t.version ?? 'installed' : 'not detected'}`)
              .join(' | '),
          },
        ],
        structuredContent: { ok: true, ...result },
      };
    },
  );

  return {
    moduleId: 'remote',
    modelTools,
    isRuntimeRunning: () => gateway.isRunning(),
    setEnabledRuntime,
    dispose,
  };
}
