import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getModuleDataDir, MODULE_CATALOG } from '../src/core/config.js';
import { ConversationClient } from '../src/modules/remote/conversation-client.js';
import { defaultRemoteConfig, readRuntimeInfo, saveConfig } from '../src/modules/remote/config.js';
import { RemoteGateway } from '../src/modules/remote/gateway.js';
import {
  detectLocalTunnelTools,
  InvalidConversationIdError,
  isValidConversationId,
  MAX_LIVE_STREAM_SUMMARY_CHARS,
  MAX_LIVE_STREAM_TIMESTAMP_CHARS,
  MAX_TUNNEL_VERSION_CHARS,
  readConversationLiveStream,
  redactLiveStreamText,
} from '../src/modules/remote/live-stream.js';
import { renderMobilePwaHtml } from '../src/modules/remote/mobile-pwa.js';
import { registerRemoteModule } from '../src/modules/remote/register.js';
import { createDirSymlink } from './helpers/cross-platform.js';

const UI_RESOURCE_URI = 'ui://agy-nov/app.html';

function withTempSandbox<T>(
  fn: (dirs: { root: string; dataDir: string; brainDir: string; outsideDir: string }) => Promise<T> | T,
): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-nov-v06-remote-'));
  const dataDir = path.join(root, 'data');
  const brainDir = path.join(root, 'brain');
  const outsideDir = path.join(root, 'outside');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(brainDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  return Promise.resolve()
    .then(() => fn({ root, dataDir, brainDir, outsideDir }))
    .finally(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });
}

async function connectInMemoryClient(server: McpServer): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-v06-remote-client', version: '0.6.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await Promise.allSettled([client.close(), server.close()]);
    },
  };
}

function writeTranscript(brainDir: string, convId: string, lines: unknown[]): string {
  const logsDir = path.join(brainDir, convId, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const filePath = path.join(logsDir, 'transcript.jsonl');
  const body = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';
  fs.writeFileSync(filePath, body, 'utf8');
  return filePath;
}

function rawHttpGet(
  port: number,
  rawPath: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: rawPath,
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Remote 2.0 — Read-Only Conversation Live Stream & Safe Tunnel Guide', () => {
  it('enforces 401 auth gate and 400 strict validation on path traversal IDs over HTTP', async () => {
    await withTempSandbox(async ({ dataDir, brainDir }) => {
      const remoteDir = getModuleDataDir(dataDir, 'remote');
      const gw = new RemoteGateway(remoteDir, new ConversationClient({ demoMode: true }), {
        demoMode: false,
        brainDirs: [brainDir],
      });
      await gw.start(0);

      try {
        const port = gw.getActualPort();
        const token = gw.getConfig().pairingToken;
        const authHeader = { Authorization: `Bearer ${token}` };

        // 1. Unauthenticated request must return 401
        const unauth = await fetch(`http://127.0.0.1:${port}/api/conversations/abc/stream`);
        assert.equal(unauth.status, 401);

        // 2. Encoded & multi-segment path traversal IDs (including "." and "%2e") must return 400
        const badRawPaths = [
          '/api/conversations/..%2Fetc%2Fpasswd/stream',
          '/api/conversations/%2e%2e/stream',
          '/api/conversations/%2e/stream',
          '/api/conversations/./stream',
          '/api/conversations/..%5Csecret/stream',
          '/api/conversations/a/b/stream',
          '/api/conversations/a%2Fb/stream',
          '/api/conversations/../etc/passwd/stream',
          '/api/conversations/../stream',
          '/api/conversations//stream',
          '/api/conversations/%E0%A4%A/stream',
        ];
        for (const badPath of badRawPaths) {
          const res = await rawHttpGet(port, badPath, authHeader);
          assert.equal(res.status, 400, `Expected HTTP 400 for ${badPath}, got ${res.status}: ${res.body}`);
        }

        // Direct API call must reject "." / ".." and unsafe IDs
        assert.equal(isValidConversationId('.'), false);
        assert.equal(isValidConversationId('..'), false);
        for (const badId of ['.', '../etc/passwd', '..', 'a/b', 'conv..1', 'bad id', '']) {
          assert.equal(isValidConversationId(badId), false);
          assert.throws(
            () => readConversationLiveStream(badId, { brainDirs: [brainDir] }),
            InvalidConversationIdError,
          );
        }
      } finally {
        await gw.stop();
      }
    });
  });

  it('streams real transcript over HTTP with 0 leakage of PKCS#8 PEM, truncated PEM, JWT, Bearer, sk-, GitHub/AWS/Google tokens, passwords, and sensitive file paths', async () => {
    await withTempSandbox(async ({ dataDir, brainDir }) => {
      const remoteDir = getModuleDataDir(dataDir, 'remote');
      const convId = 'conv-sec-audit-01';

      // Build synthetic secret fixtures at runtime so static push-protection scanners are never triggered
      const pemBegin = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ');
      const pemEnd = ['-----END', 'PRIVATE', 'KEY-----'].join(' ');
      const pkcs8SecretBody = ['MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSk', 'AgEAAoIBAQC9TESTSECRETKEY'].join('');
      const truncatedPemBody = ['MIIEowIBAAKCAQEA7TRUNCATEDPEMSECRET', 'BODY0123456789ABCDEF'].join('');
      const jwtToken = [
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        'eyJzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6ImFkbWluIn0',
        'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      ].join('.');
      const bearerSecret = ['mySuperSecretBearer', 'Token9876543210'].join('');
      const openaiKey = ['sk', 'proj', 'TestOpenAISecretKey9876543210abcdef'].join('-');
      const stripeLiveKey = ['sk', 'live', '51TestStripeLiveSecretKey9999'].join('_');
      const stripeTestKey = ['sk', 'test', '51TestStripeTestSecretKey8888'].join('_');
      const ghpToken = ['ghp', '1234567890abcdefghij1234567890abcd'].join('_');
      const ghsToken = ['ghs', '9876543210zyxwvutsrq9876543210zyxw'].join('_');
      const ghPatToken = ['github', 'pat', '11ABCDEFG0123456789', 'secretTokenValueXYZ'].join('_');
      const awsAkia = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
      const awsAsia = ['ASIA', 'IOSFODNN7EXAMPLE'].join('');
      const googleAiza = ['AIza', 'SyD-TestGoogleApiKey1234567890abcdefg'].join('');
      const kvPassword = 'UltraSecretDbPassword!2026';
      const fileContentSecret = 'TOP_SECRET_FILE_BODY_SHOULD_NEVER_APPEAR';

      writeTranscript(brainDir, convId, [
        {
          step_index: 1,
          source: 'USER',
          created_at: '2026-11-27T08:00:01.000Z',
          content: `<USER_REQUEST>Debug auth failure with Authorization: Bearer ${bearerSecret} and password=${kvPassword}</USER_REQUEST>`,
        },
        {
          step_index: 2,
          source: 'MODEL',
          created_at: '2026-11-27T08:00:02.000Z',
          content: `Found JWT ${jwtToken} and provider keys ${openaiKey} ${stripeLiveKey} ${stripeTestKey}`,
          tool_calls: [
            {
              name: 'read_file',
              args: {
                Path: '/Users/alice/private-project/src/worker.ts',
                Content: fileContentSecret,
              },
            },
            {
              name: 'read_file',
              args: {
                Path: '/Users/alice/private-project/.env.production',
                Content: fileContentSecret,
              },
            },
          ],
        },
        {
          step_index: 3,
          source: 'TOOL',
          created_at: '2026-11-27T08:00:03.000Z',
          tool_calls: [
            {
              name: 'edit_file',
              args: {
                Path: '/Users/alice/private-project/src/gateway.ts',
                Replacement: fileContentSecret,
              },
            },
          ],
        },
        {
          step_index: 4,
          source: 'TOOL',
          created_at: '2026-11-27T08:00:04.000Z',
          content: `Tokens found: ${ghpToken}, ${ghsToken}, ${ghPatToken}, ${awsAkia}, ${awsAsia}, ${googleAiza}`,
        },
        {
          step_index: 5,
          source: 'MODEL',
          created_at: '2026-11-27T08:00:05.000Z',
          content: `Key dump:\n${pemBegin}\n${pkcs8SecretBody}\n${pemEnd}\nAll done.`,
        },
        {
          step_index: 6,
          source: 'TOOL',
          created_at: '2026-11-27T08:00:06.000Z',
          error: `Truncated key leak: ${pemBegin}\n${truncatedPemBody}`,
        },
      ]);

      const gw = new RemoteGateway(remoteDir, new ConversationClient({ demoMode: true }), {
        demoMode: false,
        brainDirs: [brainDir],
      });
      await gw.start(0);

      try {
        const port = gw.getActualPort();
        const token = gw.getConfig().pairingToken;
        const res = await fetch(
          `http://127.0.0.1:${port}/api/conversations/${convId}/stream?limit=20`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        assert.equal(res.status, 200);
        const bodyText = await res.text();
        const data = JSON.parse(bodyText) as {
          conversationId: string;
          mode: string;
          readOnly: boolean;
          found: boolean;
          totalSteps: number;
          events: Array<{
            stepIndex: number;
            role: string;
            toolNames: string[];
            summary: string;
            truncated: boolean;
          }>;
        };

        assert.equal(data.conversationId, convId);
        assert.equal(data.mode, 'live');
        assert.equal(data.readOnly, true);
        assert.equal(data.found, true);
        assert.equal(data.totalSteps, 6);
        assert.equal(data.events.length, 6);

        // Roles & tool metadata preserved
        assert.equal(data.events[0].role, 'user');
        assert.equal(data.events[1].role, 'assistant');
        assert.deepEqual(data.events[1].toolNames, ['read_file']);
        assert.equal(data.events[2].role, 'tool');
        assert.deepEqual(data.events[2].toolNames, ['edit_file']);
        assert.match(data.events[2].summary, /gateway\.ts/);
        assert.equal(data.events[5].role, 'error');

        // Summary length cap enforced
        for (const ev of data.events) {
          assert.ok(
            ev.summary.length <= MAX_LIVE_STREAM_SUMMARY_CHARS,
            `Summary exceeded ${MAX_LIVE_STREAM_SUMMARY_CHARS} chars: ${ev.summary.length}`,
          );
        }

        // ZERO leakage of every secret, file content, and sensitive path
        const forbiddenLiterals = [
          pkcs8SecretBody,
          truncatedPemBody,
          pemBegin,
          jwtToken,
          bearerSecret,
          openaiKey,
          stripeLiveKey,
          stripeTestKey,
          ghpToken,
          ghsToken,
          ghPatToken,
          awsAkia,
          awsAsia,
          googleAiza,
          kvPassword,
          fileContentSecret,
          '.env.production',
          '/Users/alice/private-project',
        ];
        for (const secret of forbiddenLiterals) {
          assert.equal(
            bodyText.includes(secret),
            false,
            `Secret or sensitive data leaked in live stream response: ${secret}`,
          );
        }

        // Limit query clamping (limit=2 returns only last 2 steps)
        const limitedRes = await fetch(
          `http://127.0.0.1:${port}/api/conversations/${convId}/stream?limit=2`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        assert.equal(limitedRes.status, 200);
        const limited = (await limitedRes.json()) as { events: Array<{ stepIndex: number }> };
        assert.equal(limited.events.length, 2);
        assert.equal(limited.events[0].stepIndex, 5);
        assert.equal(limited.events[1].stepIndex, 6);
      } finally {
        await gw.stop();
      }
    });
  });

  it('silently rejects symlink escape outside brainDir (found: false) and enforces 256 KiB tail cap', async () => {
    await withTempSandbox(async ({ dataDir, brainDir, outsideDir }) => {
      // 1. Symlink file escaping brainDir
      const outsideSecretTranscript = path.join(outsideDir, 'outside-transcript.jsonl');
      fs.writeFileSync(
        outsideSecretTranscript,
        JSON.stringify({ step_index: 1, source: 'USER', content: 'OUTSIDE_ESCAPE_PAYLOAD' }) + '\n',
        'utf8',
      );
      const escapeLogsDir = path.join(brainDir, 'conv-symlink-file', '.system_generated', 'logs');
      fs.mkdirSync(escapeLogsDir, { recursive: true });
      fs.symlinkSync(outsideSecretTranscript, path.join(escapeLogsDir, 'transcript.jsonl'));

      const fileEscapeRes = readConversationLiveStream('conv-symlink-file', {
        brainDirs: [brainDir],
      });
      assert.equal(fileEscapeRes.found, false);
      assert.equal(fileEscapeRes.readOnly, true);
      assert.deepEqual(fileEscapeRes.events, []);

      // 2. Symlink conversation directory escaping brainDir
      const outsideConvDir = path.join(outsideDir, 'outside-conv');
      fs.mkdirSync(path.join(outsideConvDir, '.system_generated', 'logs'), { recursive: true });
      fs.writeFileSync(
        path.join(outsideConvDir, '.system_generated', 'logs', 'transcript.jsonl'),
        JSON.stringify({ step_index: 1, source: 'USER', content: 'OUTSIDE_DIR_ESCAPE' }) + '\n',
        'utf8',
      );
      createDirSymlink(outsideConvDir, path.join(brainDir, 'conv-symlink-dir'));

      const dirEscapeRes = readConversationLiveStream('conv-symlink-dir', {
        brainDirs: [brainDir],
      });
      assert.equal(dirEscapeRes.found, false);
      assert.deepEqual(dirEscapeRes.events, []);

      // Verify HTTP endpoint also returns found: false with zero outside payload
      const gw = new RemoteGateway(
        getModuleDataDir(dataDir, 'remote'),
        new ConversationClient({ demoMode: true }),
        { demoMode: false, brainDirs: [brainDir] },
      );
      await gw.start(0);
      try {
        const res = await fetch(
          `http://127.0.0.1:${gw.getActualPort()}/api/conversations/conv-symlink-file/stream`,
          {
            headers: { Authorization: `Bearer ${gw.getConfig().pairingToken}` },
          },
        );
        assert.equal(res.status, 200);
        const text = await res.text();
        assert.equal(text.includes('OUTSIDE_ESCAPE_PAYLOAD'), false);
        assert.equal((JSON.parse(text) as { found: boolean }).found, false);
      } finally {
        await gw.stop();
      }

      // 3. Oversized > 300 KiB transcript reads only the tail (<= 256 KiB) cleanly
      const bigLines: string[] = [];
      const pad = 'x'.repeat(2000);
      for (let i = 1; i <= 180; i += 1) {
        bigLines.push(
          JSON.stringify({
            step_index: i,
            source: 'ASSISTANT',
            content: `Step ${i} marker ${pad}`,
          }),
        );
      }
      writeTranscript(brainDir, 'conv-huge-tail', bigLines);
      const tailRes = readConversationLiveStream('conv-huge-tail', {
        brainDirs: [brainDir],
        limit: 5,
      });
      assert.equal(tailRes.found, true);
      assert.equal(tailRes.events.length, 5);
      assert.equal(tailRes.events[4].stepIndex, 180);
      assert.ok(tailRes.totalSteps < 180, 'Should only parse lines within the 256 KiB tail');
      assert.equal(tailRes.events[4].truncated, true);
      assert.ok(tailRes.events[4].summary.length <= MAX_LIVE_STREAM_SUMMARY_CHARS);
    });
  });

  it('detectLocalTunnelTools runs read-only probes with autoStart=false, safe copy commands, and demo mode zero-process', async () => {
    const calls: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
    const mockProbe = async (command: string, args: string[], timeoutMs: number) => {
      calls.push({ command, args, timeoutMs });
      if (command === 'tailscale') {
        return {
          ok: true,
          stdout: `1.82.0 ${'v'.repeat(200)}\ntailscale commit: abcdef`,
          stderr: '',
        };
      }
      return { ok: false, errorCode: 'ENOENT' };
    };

    const res = await detectLocalTunnelTools({ port: 4567, probeBinary: mockProbe });
    assert.equal(res.readOnly, true);
    assert.equal(res.autoStart, false);
    assert.equal(res.localTargetUrl, 'http://127.0.0.1:4567');
    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((c) => [c.command, c.args]),
      [
        ['tailscale', ['version']],
        ['cloudflared', ['--version']],
      ],
    );

    const ts = res.tools.find((t) => t.id === 'tailscale');
    const cf = res.tools.find((t) => t.id === 'cloudflared');
    assert.ok(ts && cf);
    assert.equal(ts.installed, true);
    assert.ok(ts.version && ts.version.length <= MAX_TUNNEL_VERSION_CHARS);
    assert.equal(ts.recommendedCommand, 'tailscale serve --bg http://127.0.0.1:4567');
    assert.equal(cf.installed, false);
    assert.equal(cf.version, null);
    assert.equal(cf.recommendedCommand, 'cloudflared tunnel --url http://127.0.0.1:4567');

    // Demo mode must never invoke probeBinary or spawn any child process
    let demoProbeCalled = 0;
    const demoRes = await detectLocalTunnelTools({
      port: 4391,
      demoMode: true,
      probeBinary: async () => {
        demoProbeCalled += 1;
        throw new Error('Must not probe in demoMode');
      },
    });
    assert.equal(demoProbeCalled, 0);
    assert.equal(demoRes.readOnly, true);
    assert.equal(demoRes.autoStart, false);
    assert.equal(demoRes.tools.find((t) => t.id === 'tailscale')?.installed, true);
    assert.equal(demoRes.tools.find((t) => t.id === 'cloudflared')?.installed, false);

    // Demo mode live stream returns 6 synthetic steps covering user/assistant/tool/error with zero disk access
    const demoStream = readConversationLiveStream('conv-demo-001', { demoMode: true });
    assert.equal(demoStream.mode, 'demo');
    assert.equal(demoStream.readOnly, true);
    assert.equal(demoStream.found, true);
    assert.equal(demoStream.totalSteps, 6);
    assert.equal(demoStream.events.length, 6);
    const roles = new Set(demoStream.events.map((e) => e.role));
    assert.ok(roles.has('user'));
    assert.ok(roles.has('assistant'));
    assert.ok(roles.has('tool'));
    assert.ok(roles.has('error'));
  });

  it('rejects app_remote_detect_tunnels & app_remote_get_conversation_stream when disabled (quad-zero isolation) and keeps exactly 4 model tools', async () => {
    await withTempSandbox(async ({ dataDir, brainDir, root }) => {
      const remoteDir = getModuleDataDir(dataDir, 'remote');
      writeTranscript(brainDir, 'conv-off-check', [
        { step_index: 1, source: 'USER', content: 'SHOULD_NOT_BE_READ_WHILE_OFF' },
      ]);

      const server = new McpServer(
        { name: 'test-v06-remote-reg', version: '0.6.0' },
        { capabilities: { tools: {} } },
      );
      const reg = registerRemoteModule(
        server,
        { dataDir, workspaceRoot: root, brainDir, demoMode: false },
        UI_RESOURCE_URI,
        false,
      );
      const { client, close } = await connectInMemoryClient(server);

      try {
        // 1. Strictly 4 model tools unchanged
        assert.deepEqual(
          reg.modelTools.map((t) => t.name),
          ['remote_status', 'remote_send_alert', 'remote_list_conversations', 'remote_dispatch_task'],
        );
        assert.deepEqual(
          reg.modelTools.map((t) => t.name),
          MODULE_CATALOG.remote.modelToolNames,
        );

        // Verify the 2 new app-only tools declare visibility: ['app']
        const listed = await client.listTools();
        for (const appName of ['app_remote_get_conversation_stream', 'app_remote_detect_tunnels']) {
          const def = listed.tools.find((t) => t.name === appName);
          assert.ok(def, `Missing app-only tool ${appName}`);
          const metaUi = (def._meta as { ui?: { visibility?: string[] } } | undefined)?.ui;
          assert.deepEqual(metaUi?.visibility, ['app']);
        }

        // 2. While disabled: both new app tools reject with isError: true and keep zero ports/zero disk writes
        const offTunnels = await client.callTool({
          name: 'app_remote_detect_tunnels',
          arguments: {},
        });
        assert.equal(offTunnels.isError, true);
        assert.equal((offTunnels.structuredContent as { autoStart?: boolean }).autoStart, false);

        const offStream = await client.callTool({
          name: 'app_remote_get_conversation_stream',
          arguments: { conversationId: 'conv-off-check' },
        });
        assert.equal(offStream.isError, true);
        assert.equal(JSON.stringify(offStream).includes('SHOULD_NOT_BE_READ_WHILE_OFF'), false);

        // Quad-zero invariants: no remote dir, no config.json, no runtime.json, not running
        assert.equal(reg.isRuntimeRunning?.(), false);
        assert.equal(fs.existsSync(remoteDir), false);
        assert.equal(readRuntimeInfo(remoteDir), null);

        // 3. Enable on ephemeral port -> live stream & tunnel tools work cleanly
        const seedCfg = defaultRemoteConfig();
        seedCfg.port = 0;
        seedCfg.gatewayEnabled = false;
        saveConfig(remoteDir, seedCfg);
        await reg.setEnabledRuntime?.(true);
        assert.equal(reg.isRuntimeRunning?.(), true);

        const onStream = await client.callTool({
          name: 'app_remote_get_conversation_stream',
          arguments: { conversationId: 'conv-off-check', limit: 10 },
        });
        assert.equal(onStream.isError, undefined);
        const sc = onStream.structuredContent as {
          ok: boolean;
          readOnly: boolean;
          found: boolean;
          events: Array<{ summary: string }>;
        };
        assert.equal(sc.ok, true);
        assert.equal(sc.readOnly, true);
        assert.equal(sc.found, true);
        assert.equal(sc.events.length, 1);

        // Invalid conversationId rejected even when enabled
        const badIdCall = await client.callTool({
          name: 'app_remote_get_conversation_stream',
          arguments: { conversationId: '../etc/passwd' },
        });
        assert.equal(badIdCall.isError, true);
      } finally {
        await close();
        await reg.dispose?.();
      }
    });
  });

  it('serves demoMode live stream over HTTP and detects demo tunnels via app_remote_detect_tunnels using actual bound port', async () => {
    await withTempSandbox(async ({ dataDir, root }) => {
      const remoteDir = getModuleDataDir(dataDir, 'remote');
      const seedCfg = defaultRemoteConfig();
      seedCfg.port = 0;
      seedCfg.gatewayEnabled = false;
      saveConfig(remoteDir, seedCfg);

      const server = new McpServer(
        { name: 'test-v06-remote-demo', version: '0.6.0' },
        { capabilities: { tools: {} } },
      );
      const reg = registerRemoteModule(
        server,
        { dataDir, workspaceRoot: root, demoMode: true },
        UI_RESOURCE_URI,
        false,
      );
      const { client, close } = await connectInMemoryClient(server);

      try {
        await reg.setEnabledRuntime?.(true);
        const runtime = readRuntimeInfo(remoteDir);
        assert.ok(runtime && runtime.port > 0);

        const tunnelRes = await client.callTool({
          name: 'app_remote_detect_tunnels',
          arguments: {},
        });
        assert.equal(tunnelRes.isError, undefined);
        const tunnelSc = tunnelRes.structuredContent as {
          ok: boolean;
          readOnly: boolean;
          autoStart: boolean;
          localTargetUrl: string;
          tools: Array<{ id: string; installed: boolean; recommendedCommand: string }>;
        };
        assert.equal(tunnelSc.ok, true);
        assert.equal(tunnelSc.readOnly, true);
        assert.equal(tunnelSc.autoStart, false);
        assert.equal(tunnelSc.localTargetUrl, `http://127.0.0.1:${runtime.port}`);
        assert.equal(
          tunnelSc.tools.find((t) => t.id === 'tailscale')?.recommendedCommand,
          `tailscale serve --bg http://127.0.0.1:${runtime.port}`,
        );

        const hubRes = await client.callTool({
          name: 'app_remote_get_hub_state',
          arguments: {},
        });
        const pairingUrl = String(
          (hubRes.structuredContent as { status?: { pairingUrl?: string } }).status?.pairingUrl ?? '',
        );
        const token = new URL(pairingUrl).searchParams.get('token');
        assert.ok(token);

        const httpStreamRes = await fetch(
          `http://127.0.0.1:${runtime.port}/api/conversations/conv-demo-001/stream`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        assert.equal(httpStreamRes.status, 200);
        const streamJson = (await httpStreamRes.json()) as {
          mode: string;
          readOnly: boolean;
          found: boolean;
          totalSteps: number;
          events: Array<{ role: string }>;
        };
        assert.equal(streamJson.mode, 'demo');
        assert.equal(streamJson.readOnly, true);
        assert.equal(streamJson.found, true);
        assert.equal(streamJson.totalSteps, 6);
        assert.equal(streamJson.events.length, 6);
      } finally {
        await close();
        await reg.dispose?.();
      }
    });
  });

  it('red-team regression [M1/L3]: redacts compound env secrets, lowercase PEM, underscore-glued tokens, malicious timestamps, and rejects "."', async () => {
    await withTempSandbox(async ({ dataDir, brainDir }) => {
      const remoteDir = getModuleDataDir(dataDir, 'remote');
      const convId = 'conv-redteam-m1-l3';

      // Runtime-assembled fixtures (no static secret literals in source)
      const awsSecretVal = ['wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCYEXAMPLEKEY'].join('/');
      const awsSecretEnvLine = [['AWS', 'SECRET', 'ACCESS', 'KEY'].join('_'), awsSecretVal].join('=');
      const lowerPemBegin = ['-----begin', 'private', 'key-----'].join(' ');
      const lowerPemEnd = ['-----end', 'private', 'key-----'].join(' ');
      const lowerPemBody = ['MIIEvgIBADANBgkqhkiG9w0', 'LOWERCASEPEMSECRETBODY'].join('');
      const lowerTruncBody = ['MIIEowIBAAKCAQEA', 'LOWERCASETRUNCATEDBODY'].join('');
      const gluedStripeKey = ['sk', 'live', '51RealStripeSecretKey1234567890'].join('_');
      const gluedGhpKey = ['ghp', 'UnderscoreGluedSecret1234567890'].join('_');
      const gluedAwsKey = ['AKIA', 'GLUEDKEYEXAMPLE1'].join('');
      const tsLeakedKey = ['sk', 'proj', 'LeakInTimestamp1234567890'].join('-');
      const validIsoTs = '2026-11-27T08:15:30.123Z';

      writeTranscript(brainDir, convId, [
        {
          step_index: 1,
          source: 'TOOL',
          timestamp: validIsoTs,
          content: `Exported ${awsSecretEnvLine} in env output`,
        },
        {
          step_index: 2,
          source: 'MODEL',
          timestamp: `2026-11-27T00:00:00Z ${tsLeakedKey}`,
          content: `Lowercase key:\n${lowerPemBegin}\n${lowerPemBody}\n${lowerPemEnd}\nok`,
        },
        {
          step_index: 3,
          source: 'TOOL',
          created_at: `${'2026-11-27T00:00:00Z'.repeat(5)} ${tsLeakedKey}`,
          content: `Glued tokens: prefix_${gluedStripeKey} env_${gluedGhpKey} key_${gluedAwsKey}`,
        },
        {
          step_index: 4,
          source: 'TOOL',
          createdAt: 'not-a-timestamp-with-secret-payload-999999999999999999999',
          error: `Truncated lowercase PEM: ${lowerPemBegin}\n${lowerTruncBody}`,
        },
      ]);

      const gw = new RemoteGateway(remoteDir, new ConversationClient({ demoMode: true }), {
        demoMode: false,
        brainDirs: [brainDir],
      });
      await gw.start(0);

      try {
        const port = gw.getActualPort();
        const token = gw.getConfig().pairingToken;
        const authHeader = { Authorization: `Bearer ${token}` };

        // [L3] Single dot and double dot rejected directly & over HTTP
        assert.equal(isValidConversationId('.'), false);
        assert.equal(isValidConversationId('..'), false);
        assert.throws(() => readConversationLiveStream('.', { brainDirs: [brainDir] }), InvalidConversationIdError);
        const dotEncoded = await rawHttpGet(port, '/api/conversations/%2e/stream', authHeader);
        assert.equal(dotEncoded.status, 400);
        const dotRaw = await rawHttpGet(port, '/api/conversations/./stream', authHeader);
        assert.equal(dotRaw.status, 400);

        // [M1] HTTP stream response has 0 leakage across all 4 bypass vectors
        const res = await fetch(`http://127.0.0.1:${port}/api/conversations/${convId}/stream`, {
          headers: authHeader,
        });
        assert.equal(res.status, 200);
        const bodyText = await res.text();
        const data = JSON.parse(bodyText) as {
          found: boolean;
          readOnly: boolean;
          events: Array<{ stepIndex: number; timestamp: string; summary: string }>;
        };

        assert.equal(data.found, true);
        assert.equal(data.readOnly, true);
        assert.equal(data.events.length, 4);

        // Valid ISO timestamp preserved; all malicious / oversized timestamps cleared to '' and bounded <= 40 chars
        assert.equal(data.events[0].timestamp, validIsoTs);
        assert.equal(data.events[1].timestamp, '');
        assert.equal(data.events[2].timestamp, '');
        assert.equal(data.events[3].timestamp, '');
        for (const ev of data.events) {
          assert.ok(ev.timestamp.length <= MAX_LIVE_STREAM_TIMESTAMP_CHARS);
          assert.ok(ev.summary.length <= MAX_LIVE_STREAM_SUMMARY_CHARS);
        }

        const forbidden = [
          awsSecretVal,
          lowerPemBegin,
          lowerPemBody,
          lowerTruncBody,
          gluedStripeKey,
          gluedGhpKey,
          gluedAwsKey,
          tsLeakedKey,
          'not-a-timestamp-with-secret-payload',
        ];
        for (const item of forbidden) {
          assert.equal(bodyText.includes(item), false, `Red-team M1 leak detected: ${item}`);
        }
      } finally {
        await gw.stop();
      }
    });
  });

  it('red-team regression [R1]: redactLiveStreamText remains strictly linear O(n) (< 50ms) on 50KB repeated secret_ and unclosed PEM payloads', () => {
    const repeatedSecretPayload = `${'secret_'.repeat(7200)}!`;
    const plainAlphaPayload = `${'a'.repeat(50_000)}!`;
    const unclosedPemPayload = '-----BEGIN PRIVATE KEY-----\n'.repeat(500);

    const t0 = Date.now();
    const r1 = redactLiveStreamText(repeatedSecretPayload);
    const r2 = redactLiveStreamText(plainAlphaPayload);
    const r3 = redactLiveStreamText(unclosedPemPayload);
    const elapsedMs = Date.now() - t0;

    assert.equal(r1, repeatedSecretPayload);
    assert.equal(r2, plainAlphaPayload);
    assert.equal(r3.includes('BEGIN PRIVATE KEY'), false);
    assert.ok(elapsedMs < 50, `Expected linear O(n) redaction < 50ms, took ${elapsedMs}ms`);

    // Ensure compound key=value redaction still works after R1 refactor
    const kvInput = 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY normal_key=keep_me';
    const kvRedacted = redactLiveStreamText(kvInput);
    assert.equal(kvRedacted.includes('wJalrXUtnFEMI'), false);
    assert.match(kvRedacted, /AWS_SECRET_ACCESS_KEY=\[REDACTED\]/);
    assert.match(kvRedacted, /normal_key=keep_me/);
  });

  it('renders Mobile PWA with valid JS syntax, read-only live stream drawer, and strictly zero innerHTML / insertAdjacentHTML usage', () => {
    const html = renderMobilePwaHtml();
    assert.match(html, /READ-ONLY/);
    assert.match(html, /\/api\/conversations\/.*\/stream/);
    assert.doesNotMatch(html, /\binnerHTML\b/);
    assert.doesNotMatch(html, /\binsertAdjacentHTML\b/);
    assert.doesNotMatch(html, /\bouterHTML\b/);

    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch && scriptMatch[1], 'Mobile PWA must contain inline script');
    // Compile via vm.Script to verify zero JS syntax errors
    assert.doesNotThrow(() => new vm.Script(scriptMatch[1]));
  });
});
