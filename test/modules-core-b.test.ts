import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getModuleDataDir,
  MODULE_CATALOG,
  setModuleEnabled,
} from '../src/core/config.js';
import type { NovRuntimeOptions } from '../src/core/types.js';
import { normalizeHookPayload } from '../src/core/utils.js';
import { registerCanvasModule } from '../src/modules/canvas/register.js';
import {
  CanvasStore,
  compileFeedbackPrompt,
  loadLocalFileContent,
} from '../src/modules/canvas/store.js';
import {
  buildSafeSvgSrcDoc,
  isSafeImageDataUri,
} from '../src/modules/canvas/validation.js';
import {
  handleMemSessionStartHook,
  handleMemStopHook,
} from '../src/modules/mem/hook.js';
import { registerMemModule } from '../src/modules/mem/register.js';
import { MemoryStore } from '../src/modules/mem/store.js';
import {
  defaultRemoteConfig,
  loadConfigReadOnly,
  readRuntimeInfo,
  saveConfig,
} from '../src/modules/remote/config.js';
import { ConversationClient } from '../src/modules/remote/conversation-client.js';
import { RemoteGateway } from '../src/modules/remote/gateway.js';
import {
  handleRemotePreToolHook,
  handleRemoteStopHook,
} from '../src/modules/remote/hook.js';
import { registerRemoteModule } from '../src/modules/remote/register.js';

const UI_RESOURCE_URI = 'ui://agy-nov/app.html';
const VALID_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function withTempDirs<T>(
  fn: (dirs: { root: string; dataDir: string; workspaceDir: string }) => Promise<T> | T,
): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-nov-core-b-'));
  const dataDir = path.join(root, 'data');
  const workspaceDir = path.join(root, 'workspace');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  return Promise.resolve()
    .then(() => fn({ root, dataDir, workspaceDir }))
    .finally(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });
}

async function connectInMemoryClient(server: McpServer): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.1.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await Promise.allSettled([client.close(), server.close()]);
    },
  };
}

describe('Builder B Modules (canvas, mem, remote)', () => {
  describe('Canvas module', () => {
    it('stores artifacts, validates SVG CSP & image URIs, enforces workspace boundaries, and compiles canvas_publish_artifact prompt', async () => {
      await withTempDirs(async ({ dataDir, workspaceDir }) => {
        const canvasDir = getModuleDataDir(dataDir, 'canvas');
        const store = new CanvasStore(canvasDir, false);

        // Publish HTML & revision v2
        const v1 = store.publishArtifact({
          boardId: 'pricing-card',
          title: 'Pricing Card',
          kind: 'html',
          content: '<h1>v1</h1>',
          summary: 'Initial draft',
          sourcePath: path.join(workspaceDir, 'pricing.html'),
        });
        assert.equal(v1.currentVersion, 1);

        const v2 = store.publishArtifact({
          boardId: 'pricing-card',
          title: 'Pricing Card',
          kind: 'html',
          content: '<h1>v2</h1>',
          summary: 'Updated hero',
        });
        assert.equal(v2.currentVersion, 2);
        assert.equal(v2.revisions.length, 2);

        // Add pin and verify compileFeedbackPrompt calls canvas_publish_artifact
        const withPin = store.addAnnotation('pricing-card', {
          xPct: 42.5,
          yPct: 30,
          wPct: 20,
          hPct: 12,
          tag: 'polish',
          note: 'Increase contrast on CTA button',
        });
        assert.ok(withPin);
        assert.equal(withPin.annotations.length, 1);

        const prompt = compileFeedbackPrompt(withPin);
        assert.match(prompt, /call `canvas_publish_artifact`/);
        assert.doesNotMatch(prompt, /call `publish_artifact`/);
        assert.match(prompt, /Increase contrast on CTA button/);

        // SVG CSP validation
        const svgDoc = buildSafeSvgSrcDoc('<svg><rect width="10" height="10"/></svg>');
        assert.match(svgDoc, /http-equiv="Content-Security-Policy"/);
        assert.match(svgDoc, /default-src 'none'/);

        // Image data URI validation
        assert.equal(isSafeImageDataUri(VALID_PNG_DATA_URI), true);
        assert.equal(isSafeImageDataUri('https://evil.example/img.png'), false);
        assert.equal(isSafeImageDataUri('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), false);
        assert.equal(isSafeImageDataUri('data:image/png;base64,!!!invalid!!!'), false);

        // Local file whitelist & boundary checks
        const okHtml = path.join(workspaceDir, 'demo.html');
        fs.writeFileSync(okHtml, '<div>ok</div>', 'utf8');
        const loaded = loadLocalFileContent('demo.html', workspaceDir);
        assert.equal(loaded.kind, 'html');
        assert.equal(loaded.content, '<div>ok</div>');

        // Hidden dotfile / sensitive file / outside workspace / disallowed extension must fail
        const hiddenFile = path.join(workspaceDir, '.env');
        fs.writeFileSync(hiddenFile, 'SECRET=1', 'utf8');
        assert.throws(() => loadLocalFileContent('.env', workspaceDir), /Access denied|Unsupported/i);

        const tsFile = path.join(workspaceDir, 'index.ts');
        fs.writeFileSync(tsFile, 'export const a = 1;', 'utf8');
        assert.throws(() => loadLocalFileContent('index.ts', workspaceDir), /Unsupported file extension/i);

        const outsideFile = path.join(path.dirname(workspaceDir), 'outside.html');
        fs.writeFileSync(outsideFile, '<div>escape</div>', 'utf8');
        assert.throws(() => loadLocalFileContent('../outside.html', workspaceDir), /outside workspace root/i);

        // MCP tool integration: novModule & dangerous image rejection
        const server = new McpServer(
          { name: 'test-canvas', version: '0.1.0' },
          { capabilities: { tools: {} } },
        );
        const opts: NovRuntimeOptions = { dataDir, workspaceRoot: workspaceDir, demoMode: false };
        registerCanvasModule(server, opts, UI_RESOURCE_URI);
        const { client, close } = await connectInMemoryClient(server);
        try {
          const badImg = await client.callTool({
            name: 'canvas_publish_artifact',
            arguments: {
              title: 'External Image',
              kind: 'image',
              content: 'https://evil.example/leak.png',
            },
          });
          assert.equal(badImg.isError, true);

          const pub = await client.callTool({
            name: 'canvas_publish_artifact',
            arguments: {
              boardId: 'mcp-board',
              title: 'MCP Board',
              kind: 'svg',
              content: '<svg></svg>',
            },
          });
          assert.equal(pub.isError, undefined);
          assert.equal((pub.structuredContent as Record<string, unknown>)?.novModule, 'canvas');

          const opened = await client.callTool({
            name: 'canvas_open_file',
            arguments: { filePath: 'demo.html' },
          });
          assert.equal(opened.isError, undefined);
          assert.equal((opened.structuredContent as Record<string, unknown>)?.novModule, 'canvas');

          // App-only annotation -> compile feedback -> resolve roundtrip
          await client.callTool({
            name: 'app_canvas_add_annotation',
            arguments: {
              boardId: 'mcp-board',
              xPct: 50,
              yPct: 50,
              tag: 'fix',
              note: 'Fix SVG alignment',
            },
          });
          const compiled = await client.callTool({
            name: 'app_canvas_compile_feedback',
            arguments: { boardId: 'mcp-board' },
          });
          const compiledPrompt = String((compiled.structuredContent as { prompt?: string })?.prompt ?? '');
          assert.match(compiledPrompt, /call `canvas_publish_artifact`/);
          assert.match(compiledPrompt, /Fix SVG alignment/);

          await client.callTool({
            name: 'canvas_resolve_annotations',
            arguments: { boardId: 'mcp-board' },
          });
          const fbAfter = await client.callTool({
            name: 'canvas_get_feedback',
            arguments: { boardId: 'mcp-board' },
          });
          assert.match(
            String((fbAfter.structuredContent as { prompt?: string })?.prompt ?? ''),
            /No open pins/,
          );
        } finally {
          await close();
        }
      });
    });
  });

  describe('Mem module', () => {
    it('supports CRUD, secret redaction, SHA-256 drift detection, SessionStart injection, and Stop auto-capture', async () => {
      await withTempDirs(async ({ dataDir, workspaceDir }) => {
        const memDataDir = getModuleDataDir(dataDir, 'mem');
        const anchorFile = path.join(workspaceDir, 'auth.ts');
        fs.writeFileSync(anchorFile, 'export const version = 1;\n', 'utf8');

        const store = new MemoryStore(memDataDir, false, workspaceDir);
        const created = store.remember({
          kind: 'architecture',
          title: 'Single-flight token refresh',
          content: 'Use single-flight lock; never log sk-1234567890abcdef123456',
          tags: ['auth', '缓存'],
          workspacePath: workspaceDir,
          anchors: [{ filePath: anchorFile, symbol: 'refreshToken' }],
          pinned: true,
        });

        assert.equal(created.drifted, false);
        assert.equal(created.anchors[0]?.driftStatus, 'fresh');
        assert.ok(created.anchors[0]?.sha256);
        assert.match(created.content, /\[REDACTED_KEY\]/);
        assert.doesNotMatch(created.content, /sk-1234567890abcdef123456/);

        // SessionStart hook injects fresh memory
        const startRes = handleMemSessionStartHook(
          normalizeHookPayload({ workspacePaths: [workspaceDir] }, 'SessionStart'),
          dataDir,
        );
        assert.ok(Array.isArray(startRes.injectSteps));
        assert.equal(startRes.injectSteps.length, 1);
        const injectedText = (
          startRes.injectSteps[0] as { systemMessage: { systemMessage: string } }
        ).systemMessage.systemMessage;
        assert.match(injectedText, /Single-flight token refresh/);

        // Modify anchored file -> SHA-256 drift detected
        fs.writeFileSync(anchorFile, 'export const version = 2;\n', 'utf8');
        const listedAfterEdit = store.list({ workspacePath: workspaceDir });
        assert.equal(listedAfterEdit[0]?.drifted, true);
        assert.equal(listedAfterEdit[0]?.anchors[0]?.driftStatus, 'drifted');

        // Drifted memory should be excluded from SessionStart injection
        const driftedStart = handleMemSessionStartHook(
          normalizeHookPayload({ workspacePaths: [workspaceDir] }, 'SessionStart'),
          dataDir,
        );
        assert.equal(driftedStart.injectSteps, undefined);

        // Reverify restores fresh state
        const reverified = store.reverifyAnchorHashes(created.id);
        assert.ok(reverified);
        assert.equal(reverified.drifted, false);
        assert.equal(reverified.anchors[0]?.driftStatus, 'fresh');

        // Bilingual BM25 recall & forget
        const hits = store.recall('缓存 token', { workspacePath: workspaceDir });
        assert.equal(hits.length, 1);
        assert.equal(hits[0]?.id, created.id);
        assert.equal(store.forget(created.id), true);
        assert.equal(store.list().length, 0);

        // Stop hook auto-capture from transcript (filters out sensitive .env)
        const editedOk = path.join(workspaceDir, 'worker.ts');
        const envFile = path.join(workspaceDir, '.env');
        fs.writeFileSync(editedOk, 'export const run = () => true;\n', 'utf8');
        fs.writeFileSync(envFile, 'TOKEN=abc\n', 'utf8');
        const transcriptPath = path.join(workspaceDir, 'transcript.jsonl');
        fs.writeFileSync(
          transcriptPath,
          [
            JSON.stringify({ tool_calls: [{ name: 'edit_file', args: { Path: editedOk } }] }),
            JSON.stringify({ tool_calls: [{ name: 'write_file', args: { Path: envFile } }] }),
          ].join('\n'),
          'utf8',
        );

        handleMemStopHook(
          normalizeHookPayload(
            {
              conversationId: 'conv-auto-12345',
              workspacePaths: [workspaceDir],
              transcriptPath,
              lastUserInput: 'Implement background worker retry strategy with exponential backoff',
            },
            'Stop',
          ),
          dataDir,
        );

        const autoCaptured = store.list({ workspacePath: workspaceDir });
        assert.equal(autoCaptured.length, 1);
        assert.equal(autoCaptured[0]?.id, 'mem_auto_conv-auto-12');
        assert.equal(autoCaptured[0]?.anchors.length, 1);
        assert.equal(autoCaptured[0]?.anchors[0]?.basename, 'worker.ts');

        // MCP App-only CRUD roundtrip
        const server = new McpServer(
          { name: 'test-mem', version: '0.1.0' },
          { capabilities: { tools: {} } },
        );
        registerMemModule(server, { dataDir, workspaceRoot: workspaceDir, demoMode: false }, UI_RESOURCE_URI);
        const { client, close } = await connectInMemoryClient(server);
        try {
          await client.callTool({
            name: 'app_mem_add_memory',
            arguments: {
              kind: 'convention',
              title: 'Always isolate dataDir per module',
              content: 'Store each module inside modules/<id> under root data directory.',
              tags: ['storage'],
              anchorFiles: [editedOk],
              pinned: false,
            },
          });
          const state = await client.callTool({ name: 'app_mem_get_state', arguments: {} });
          const memories = (state.structuredContent as { memories: Array<{ id: string; title: string; pinned: boolean }> }).memories;
          const added = memories.find((m) => m.title === 'Always isolate dataDir per module');
          assert.ok(added);
          assert.equal(added.pinned, false);

          const pinnedState = await client.callTool({ name: 'app_mem_toggle_pin', arguments: { id: added.id } });
          const pinnedItem = (
            pinnedState.structuredContent as { memories: Array<{ id: string; pinned: boolean }> }
          ).memories.find((m) => m.id === added.id);
          assert.equal(pinnedItem?.pinned, true);

          await client.callTool({ name: 'app_mem_delete_memory', arguments: { id: added.id } });
          const afterDel = await client.callTool({ name: 'app_mem_get_state', arguments: {} });
          assert.equal(
            (afterDel.structuredContent as { memories: Array<{ id: string }> }).memories.some((m) => m.id === added.id),
            false,
          );
        } finally {
          await close();
        }
      });
    });
  });

  describe('Remote module — default-off triple-zero isolation & graceful lifecycle', () => {
    it('keeps zero ports, zero config.json writes, zero runtime.json, and zero convClient calls when initialEnabled=false', async () => {
      await withTempDirs(async ({ dataDir, workspaceDir }) => {
        assert.equal(defaultRemoteConfig().gatewayEnabled, false);

        const remoteDir = getModuleDataDir(dataDir, 'remote');
        const configFile = path.join(remoteDir, 'config.json');
        const runtimeFile = path.join(remoteDir, 'runtime.json');

        // Spy on global fetch to prove zero outbound requests or ConversationService RPCs
        const origFetch = globalThis.fetch;
        const origLs = process.env.ANTIGRAVITY_LS_ADDRESS;
        const origCsrf = process.env.ANTIGRAVITY_CSRF_TOKEN;
        let fetchCalls = 0;
        globalThis.fetch = (async () => {
          fetchCalls += 1;
          throw new Error('Unexpected fetch during disabled state');
        }) as typeof fetch;
        process.env.ANTIGRAVITY_LS_ADDRESS = '127.0.0.1:59999';
        process.env.ANTIGRAVITY_CSRF_TOKEN = 'fake-csrf-token';

        const server = new McpServer(
          { name: 'test-remote-off', version: '0.1.0' },
          { capabilities: { tools: {} } },
        );
        const reg = registerRemoteModule(
          server,
          { dataDir, workspaceRoot: workspaceDir, demoMode: false },
          UI_RESOURCE_URI,
          false,
        );
        const { client, close } = await connectInMemoryClient(server);

        try {
          assert.equal(fs.existsSync(configFile), false, 'config.json must NOT be pre-written');
          assert.equal(fs.existsSync(runtimeFile), false, 'runtime.json must NOT exist');
          assert.equal(readRuntimeInfo(remoteDir), null);

          // app_remote_get_hub_state returns offline lightweight snapshot without calling convClient
          const hubRes = await client.callTool({ name: 'app_remote_get_hub_state', arguments: {} });
          const hub = hubRes.structuredContent as Record<string, unknown>;
          assert.equal(hub.moduleEnabled, false);
          assert.equal(hub.running, false);
          assert.deepEqual(hub.pendingApprovals, []);
          assert.deepEqual(hub.conversations, []);
          assert.deepEqual(hub.audit, []);
          assert.equal(fetchCalls, 0);
          assert.equal(fs.existsSync(configFile), false, 'hub state read must not create config.json');

          // remote_status must stay sanitized (no pairingPin / pairingToken / pairingUrl)
          const stRes = await client.callTool({ name: 'remote_status', arguments: {} });
          const stText = JSON.stringify(stRes);
          assert.equal((stRes.structuredContent as Record<string, unknown>).running, false);
          assert.doesNotMatch(stText, /pairingPin|pairingToken|pairingUrl/);
        } finally {
          await close();
          await reg.dispose?.();
          globalThis.fetch = origFetch;
          if (origLs === undefined) delete process.env.ANTIGRAVITY_LS_ADDRESS;
          else process.env.ANTIGRAVITY_LS_ADDRESS = origLs;
          if (origCsrf === undefined) delete process.env.ANTIGRAVITY_CSRF_TOKEN;
          else process.env.ANTIGRAVITY_CSRF_TOKEN = origCsrf;
        }
      });
    });

    it('short-circuits PreToolUse and Stop hooks with zero network calls when disabled or gateway offline', async () => {
      await withTempDirs(async ({ dataDir }) => {
        const origFetch = globalThis.fetch;
        let fetchCalls = 0;
        globalThis.fetch = (async () => {
          fetchCalls += 1;
          throw new Error('Unexpected network call in hook');
        }) as typeof fetch;

        try {
          const riskyPayload = normalizeHookPayload(
            {
              conversationId: 'conv-hook-1',
              toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf /tmp/test-target' } },
            },
            'PreToolUse',
          );
          const stopPayload = normalizeHookPayload(
            {
              conversationId: 'conv-hook-1',
              terminationReason: 'NO_TOOL_CALL',
              lastUserInput: 'Run migration script',
            },
            'Stop',
          );

          // Case 1: NovConfig default (modules.remote === false)
          const pre1 = await handleRemotePreToolHook(riskyPayload, dataDir);
          assert.deepEqual(pre1, {});
          const stop1 = await handleRemoteStopHook(stopPayload, dataDir);
          assert.equal(stop1, undefined);
          assert.equal(fetchCalls, 0);

          // Case 2: NovConfig enables remote, but remote's own config has gatewayEnabled: false + enabled webhook
          setModuleEnabled(dataDir, 'remote', true);
          const remoteDir = getModuleDataDir(dataDir, 'remote');
          const cfg = defaultRemoteConfig();
          cfg.gatewayEnabled = false;
          cfg.channels = cfg.channels.map((c) =>
            c.id === 'slack' ? { ...c, enabled: true, webhookUrl: 'https://hooks.slack.com/services/T/B/X' } : c,
          );
          saveConfig(remoteDir, cfg);

          const pre2 = await handleRemotePreToolHook(riskyPayload, dataDir);
          assert.deepEqual(pre2, {});
          const stop2 = await handleRemoteStopHook(stopPayload, dataDir);
          assert.equal(stop2, undefined);
          assert.equal(fetchCalls, 0);

          // Case 3: Both enabled, but gateway is offline (no runtime.json) — must NOT probe ports or fallback broadcastChannels()
          cfg.gatewayEnabled = true;
          saveConfig(remoteDir, cfg);
          const stop3 = await handleRemoteStopHook(stopPayload, dataDir);
          assert.equal(stop3, undefined);
          const pre3 = await handleRemotePreToolHook(riskyPayload, dataDir);
          assert.equal(pre3.decision, 'ask');
          assert.equal(fetchCalls, 0);
        } finally {
          globalThis.fetch = origFetch;
        }
      });
    });

    it('supports enable -> listen on ephemeral port -> stop -> release port & unblock pending waiters immediately', async () => {
      await withTempDirs(async ({ dataDir, workspaceDir }) => {
        const remoteDir = getModuleDataDir(dataDir, 'remote');
        // Pre-seed port: 0 so test never collides with fixed host ports
        const initCfg = defaultRemoteConfig();
        initCfg.port = 0;
        initCfg.gatewayEnabled = false;
        saveConfig(remoteDir, initCfg);

        const server = new McpServer(
          { name: 'test-remote-lifecycle', version: '0.1.0' },
          { capabilities: { tools: {} } },
        );
        const reg = registerRemoteModule(
          server,
          { dataDir, workspaceRoot: workspaceDir, demoMode: true },
          UI_RESOURCE_URI,
          false,
        );
        const { client, close } = await connectInMemoryClient(server);

        try {
          assert.equal(readRuntimeInfo(remoteDir), null);

          // Enable runtime -> starts gateway and writes runtime.json
          await reg.setEnabledRuntime?.(true);
          const runtime = readRuntimeInfo(remoteDir);
          assert.ok(runtime && runtime.port > 0, 'runtime.json should report bound ephemeral port');
          const persistedOn = loadConfigReadOnly(remoteDir);
          assert.equal(persistedOn.config.gatewayEnabled, true);

          // Verify real HTTP health endpoint
          const healthRes = await fetch(`http://127.0.0.1:${runtime.port}/health`);
          assert.equal(healthRes.status, 200);
          const healthJson = (await healthRes.json()) as { ok: boolean };
          assert.equal(healthJson.ok, true);

          // Start a long-polling approval request that waits up to 20s, then immediately disable runtime
          const longPollStart = Date.now();
          const longPollPromise = fetch(`http://127.0.0.1:${runtime.port}/api/hooks/approval`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${persistedOn.config.pairingToken}`,
            },
            body: JSON.stringify({
              conversationId: 'conv-wait',
              toolName: 'run_command',
              summary: 'rm -rf /tmp/demo',
              matchedRule: 'rm_rf',
              timeoutSec: 20,
              waitMs: 20_000,
            }),
          })
            .then(async (r) => ({ ok: true as const, data: (await r.json()) as { approval?: { status?: string } } }))
            .catch((err) => ({ ok: false as const, error: String(err) }));

          // Give server a brief moment to register the pending waiter
          await new Promise((r) => setTimeout(r, 80));

          await reg.setEnabledRuntime?.(false);
          const pollOutcome = await longPollPromise;
          const elapsedMs = Date.now() - longPollStart;
          assert.ok(elapsedMs < 2_000, `stop() should unblock long-poll promptly (took ${elapsedMs}ms)`);
          assert.equal(pollOutcome.ok, true, 'Long-poll should receive clean JSON response before socket closes');
          if (pollOutcome.ok) {
            assert.equal(pollOutcome.data.approval?.status, 'expired');
          }

          // runtime.json removed & gatewayEnabled persisted false
          assert.equal(readRuntimeInfo(remoteDir), null);
          assert.equal(fs.existsSync(path.join(remoteDir, 'runtime.json')), false);
          assert.equal(loadConfigReadOnly(remoteDir).config.gatewayEnabled, false);

          // Port must be closed and refuse new connections
          await assert.rejects(
            () => fetch(`http://127.0.0.1:${runtime.port}/health`),
            /fetch failed|ECONNREFUSED/i,
          );

          // Re-enable and verify app_remote_update_settings restarts gateway on port change
          await reg.setEnabledRuntime?.(true);
          const runtime2 = readRuntimeInfo(remoteDir);
          assert.ok(runtime2 && runtime2.port > 0);
          await client.callTool({
            name: 'app_remote_update_settings',
            arguments: { host: '127.0.0.1', port: 0, notifyOnStop: false },
          });
          const runtime3 = readRuntimeInfo(remoteDir);
          assert.ok(runtime3 && runtime3.port > 0);
          const health3 = await fetch(`http://127.0.0.1:${runtime3.port}/health`);
          assert.equal(health3.status, 200);
        } finally {
          await close();
          await reg.dispose?.();
        }
      });
    });

    it('RemoteGateway.stop() directly resolves pending waitForApproval waiters with status expired and clears timers', async () => {
      await withTempDirs(async ({ dataDir }) => {
        const remoteDir = getModuleDataDir(dataDir, 'remote');
        const gw = new RemoteGateway(remoteDir, new ConversationClient({ demoMode: true }));
        assert.equal(gw.isRunning(), false);
        assert.equal(fs.existsSync(path.join(remoteDir, 'config.json')), false);

        await gw.start(0);
        assert.equal(gw.isRunning(), true);
        const approval = await gw.createApproval({
          conversationId: 'c1',
          toolName: 'run_command',
          summary: 'sudo reboot',
          matchedRule: 'sudo',
          timeoutSec: 60,
        });
        const waiterPromise = gw.waitForApproval(approval.id, 60_000);

        const t0 = Date.now();
        await gw.stop();
        const result = await waiterPromise;
        const dt = Date.now() - t0;

        assert.equal(gw.isRunning(), false);
        assert.ok(result);
        assert.equal(result.status, 'expired');
        assert.ok(dt < 1_000, `Expected immediate waiter release, got ${dt}ms`);
        assert.equal(readRuntimeInfo(remoteDir), null);
      });
    });

    it('routes live PreToolUse approval decisions and Stop alerts when both NovConfig and Remote gateway are enabled', async () => {
      await withTempDirs(async ({ dataDir, workspaceDir }) => {
        setModuleEnabled(dataDir, 'remote', true);
        const remoteDir = getModuleDataDir(dataDir, 'remote');
        const cfg = defaultRemoteConfig();
        cfg.port = 0;
        cfg.gatewayEnabled = false;
        saveConfig(remoteDir, cfg);

        const server = new McpServer(
          { name: 'test-remote-live-hook', version: '0.1.0' },
          { capabilities: { tools: {} } },
        );
        const reg = registerRemoteModule(
          server,
          { dataDir, workspaceRoot: workspaceDir, demoMode: true },
          UI_RESOURCE_URI,
          false,
        );
        const { client, close } = await connectInMemoryClient(server);

        try {
          await reg.setEnabledRuntime?.(true);

          // Trigger risky PreToolUse hook and decide remotely via app_remote_decide_approval
          const hookPromise = handleRemotePreToolHook(
            normalizeHookPayload(
              {
                conversationId: 'conv-live-1',
                toolCall: { name: 'run_command', args: { CommandLine: 'git push origin main --force' } },
              },
              'PreToolUse',
            ),
            dataDir,
          );

          // Poll hub state until pending approval appears, then approve it
          let approvalId: string | undefined;
          for (let i = 0; i < 30; i += 1) {
            const stateRes = await client.callTool({ name: 'app_remote_get_hub_state', arguments: {} });
            const pending = (stateRes.structuredContent as { pendingApprovals?: Array<{ id: string }> }).pendingApprovals ?? [];
            if (pending.length > 0) {
              approvalId = pending[0].id;
              break;
            }
            await new Promise((r) => setTimeout(r, 20));
          }
          assert.ok(approvalId, 'Pending approval should appear in hub state');

          await client.callTool({
            name: 'app_remote_decide_approval',
            arguments: { id: approvalId, decision: 'approved' },
          });

          const decision = await hookPromise;
          assert.equal(decision.decision, 'allow');

          // Stop hook records stop_alert in gateway audit log
          await handleRemoteStopHook(
            normalizeHookPayload(
              {
                conversationId: 'conv-live-1',
                terminationReason: 'NO_TOOL_CALL',
                lastUserInput: 'Deploy release build',
              },
              'Stop',
            ),
            dataDir,
          );
          const hubAfterStop = await client.callTool({ name: 'app_remote_get_hub_state', arguments: {} });
          const audit = (hubAfterStop.structuredContent as { audit?: Array<{ kind: string }> }).audit ?? [];
          assert.ok(audit.some((e) => e.kind === 'stop_alert'));
        } finally {
          await close();
          await reg.dispose?.();
        }
      });
    });
  });

  describe('Unified multi-module registration on a single McpServer', () => {
    it('registers canvas, mem, and remote without conflicts, returns exact modelTools, and supports dynamic enable/disable', async () => {
      await withTempDirs(async ({ dataDir, workspaceDir }) => {
        const server = new McpServer(
          { name: 'agy-nov-test', version: '0.1.0' },
          { capabilities: { tools: {} } },
        );
        const opts: NovRuntimeOptions = { dataDir, workspaceRoot: workspaceDir, demoMode: false };

        const canvasReg = registerCanvasModule(server, opts, UI_RESOURCE_URI);
        const memReg = registerMemModule(server, opts, UI_RESOURCE_URI);
        const remoteReg = registerRemoteModule(server, opts, UI_RESOURCE_URI, false);

        try {
          assert.deepEqual(
            canvasReg.modelTools.map((t) => t.name),
            MODULE_CATALOG.canvas.modelToolNames,
          );
          assert.deepEqual(
            memReg.modelTools.map((t) => t.name),
            MODULE_CATALOG.mem.modelToolNames,
          );
          assert.deepEqual(
            remoteReg.modelTools.map((t) => t.name),
            MODULE_CATALOG.remote.modelToolNames,
          );

          const { client, close } = await connectInMemoryClient(server);
          try {
            const allTools = await client.listTools();
            const names = new Set(allTools.tools.map((t) => t.name));

            // 4 + 6 = 10 canvas, 3 + 6 = 9 mem, 4 + 9 = 13 remote -> 32 tools total
            assert.equal(allTools.tools.length, 32);

            const expectedAppTools = [
              'app_canvas_list_boards',
              'app_canvas_get_board',
              'app_canvas_add_annotation',
              'app_canvas_toggle_annotation',
              'app_canvas_delete_annotation',
              'app_canvas_compile_feedback',
              'app_mem_get_state',
              'app_mem_search',
              'app_mem_add_memory',
              'app_mem_toggle_pin',
              'app_mem_reverify_drift',
              'app_mem_delete_memory',
              'app_remote_get_hub_state',
              'app_remote_update_channel',
              'app_remote_test_channel',
              'app_remote_decide_approval',
              'app_remote_simulate_approval',
              'app_remote_refresh_pin',
              'app_remote_rotate_pairing',
              'app_remote_update_settings',
              'app_remote_dispatch_task',
            ];
            for (const appName of expectedAppTools) {
              assert.ok(names.has(appName), `Missing app-only tool ${appName}`);
              const toolDef = allTools.tools.find((t) => t.name === appName);
              const metaUi = (toolDef?._meta as { ui?: { visibility?: string[] } } | undefined)?.ui;
              assert.deepEqual(metaUi?.visibility, ['app'], `${appName} must declare app visibility`);
            }

            // Canvas visual entry tools carry ui.resourceUri
            for (const uiTool of ['canvas_publish_artifact', 'canvas_open_file']) {
              const def = allTools.tools.find((t) => t.name === uiTool);
              const metaUi = (def?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui;
              assert.equal(metaUi?.resourceUri, UI_RESOURCE_URI);
            }

            // Dynamic disable/enable hides and restores model-visible tools
            for (const handle of remoteReg.modelTools) handle.disable();
            const afterDisable = await client.listTools();
            const disabledNames = new Set(afterDisable.tools.map((t) => t.name));
            for (const name of MODULE_CATALOG.remote.modelToolNames) {
              assert.equal(disabledNames.has(name), false, `${name} should be hidden when disabled`);
            }

            for (const handle of remoteReg.modelTools) handle.enable();
            const afterEnable = await client.listTools();
            const enabledNames = new Set(afterEnable.tools.map((t) => t.name));
            for (const name of MODULE_CATALOG.remote.modelToolNames) {
              assert.equal(enabledNames.has(name), true, `${name} should reappear when enabled`);
            }
          } finally {
            await close();
          }
        } finally {
          await remoteReg.dispose?.();
        }
      });
    });

    it('filters unexpanded ${PLUGIN_DATA} placeholder instead of creating literal template directory', async () => {
      await withTempDirs(async ({ root, workspaceDir }) => {
        const origEnv = process.env.AGY_NOV_DATA_DIR;
        const fallbackDir = path.join(root, 'fallback-nov-data');
        process.env.AGY_NOV_DATA_DIR = fallbackDir;
        const server = new McpServer(
          { name: 'agy-nov-placeholder', version: '0.1.0' },
          { capabilities: { tools: {} } },
        );

        try {
          const opts: NovRuntimeOptions = {
            dataDir: '${PLUGIN_DATA}',
            workspaceRoot: workspaceDir,
            demoMode: false,
          };
          registerCanvasModule(server, opts, UI_RESOURCE_URI);
          registerMemModule(server, opts, UI_RESOURCE_URI);
          const remoteReg = registerRemoteModule(server, opts, UI_RESOURCE_URI, false);
          await remoteReg.dispose?.();

          // Lazy storage (M-4): registering modules without tool calls creates neither literal ${PLUGIN_DATA} nor eager empty dirs
          assert.equal(fs.existsSync(path.resolve('${PLUGIN_DATA}')), false);
          assert.equal(fs.existsSync(path.join(fallbackDir, 'modules', 'canvas')), false);
          assert.equal(fs.existsSync(path.join(fallbackDir, 'modules', 'mem')), false);
          assert.equal(fs.existsSync(path.join(fallbackDir, 'modules', 'remote', 'config.json')), false);

          // First write persists under fallbackDir/modules/<id>, never literal ${PLUGIN_DATA}
          const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
          const client = new Client({ name: 'placeholder-test', version: '0.1.0' });
          await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
          try {
            await client.callTool({
              name: 'canvas_publish_artifact',
              arguments: { title: 'Test Board', kind: 'markdown', content: '# Hi' },
            });
            await client.callTool({
              name: 'mem_remember',
              arguments: { kind: 'decision', title: 'Test Mem', content: 'Persisted under fallback dir' },
            });
          } finally {
            await client.close();
            await server.close();
          }

          assert.equal(fs.existsSync(path.resolve('${PLUGIN_DATA}')), false);
          assert.equal(fs.existsSync(path.join(fallbackDir, 'modules', 'canvas', 'boards')), true);
          assert.equal(fs.existsSync(path.join(fallbackDir, 'modules', 'mem', 'memories.json')), true);
          assert.equal(fs.existsSync(path.join(fallbackDir, 'modules', 'remote', 'config.json')), false);
        } finally {
          if (origEnv === undefined) delete process.env.AGY_NOV_DATA_DIR;
          else process.env.AGY_NOV_DATA_DIR = origEnv;
        }
      });
    });
  });
});
