import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  ListRootsRequestSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  applyPresetConfig,
  detectExistingOfficialPluginDataDir,
  getModuleDataDir,
  setModuleEnabled,
} from '../src/core/config.js';
import { buildFeedSnapshot } from '../src/core/feed.js';
import { canonicalRealpathSync, isSamePath } from '../src/core/utils.js';
import { MemoryStore } from '../src/modules/mem/store.js';
import { defaultRemoteConfig, saveConfig } from '../src/modules/remote/config.js';
import { ConversationClient } from '../src/modules/remote/conversation-client.js';
import { MAX_SSE_CLIENTS, RemoteGateway } from '../src/modules/remote/gateway.js';
import {
  buildAutoRtkOverwriteCommand,
  isSafeAbsolutePathArg,
  parseSafeAutoRtkCommand,
} from '../src/modules/turbo/auto-rtk.js';
import { updateVerifyPolicy } from '../src/modules/verify/core.js';
import { handleVerifyPostToolHook, handleVerifyStopHook } from '../src/modules/verify/hook.js';
import { createNovServer } from '../src/server/index.js';
import { normalizeHookPayload } from '../src/core/utils.js';
import { DICTIONARIES } from '../ui/src/i18n/index.js';
import { toSafeHostResourceUri, toSafeLocalFileUri } from '../ui/src/bridge.js';
import { validateClientSvgSafety } from '../ui/src/modules/canvas/svg-safety.js';
import { createDirSymlink } from './helpers/cross-platform.js';

const REPO_ROOT = path.resolve(process.cwd());

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

function runShellHookCommand(
  command: string,
  stdinPayload: Record<string, unknown>,
  envOverrides: Record<string, string>,
): { status: number; stdout: string } {
  // Executes the exact command string from hooks.json via native OS shell (sh -c / cmd /c)
  // with cwd=REPO_ROOT and PLUGIN_ROOT/PLUGIN_DATA injected as environment variables,
  // matching Antigravity 2.0's official hook runner contract.
  const out = execSync(command, {
    cwd: REPO_ROOT,
    input: JSON.stringify(stdinPayload),
    encoding: 'utf8',
    env: {
      ...process.env,
      PLUGIN_ROOT: REPO_ROOT,
      ...envOverrides,
    },
    timeout: 15_000,
  });
  return { status: 0, stdout: out.trim() };
}

describe('v1.0.2 Real 3-OS Black-Box hooks.json Execution (dist/hook.cjs)', () => {
  it('executes all 5 hooks.json commands through the OS shell with PLUGIN_DATA env and enforces Stop=continue + terminationReason allow', async () => {
    const hookBundle = path.join(REPO_ROOT, 'dist', 'hook.cjs');
    assert.equal(fs.existsSync(hookBundle), true, 'dist/hook.cjs must exist before black-box hook test');

    const hooksManifest = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'hooks.json'), 'utf8'),
    ) as {
      'agy-nov-hooks': Record<
        string,
        Array<{ command?: string; hooks?: Array<{ command?: string }> }>
      >;
    };

    const getCmd = (event: string): string => {
      const entries = hooksManifest['agy-nov-hooks'][event] ?? [];
      for (const e of entries) {
        if (typeof e.command === 'string') return e.command;
        if (Array.isArray(e.hooks) && typeof e.hooks[0]?.command === 'string') {
          return e.hooks[0].command;
        }
      }
      throw new Error(`Missing hooks.json command for ${event}`);
    };

    await withTempDir('agy-nov-v102-hookbb-', (tmpDir) => {
      const ws = path.join(tmpDir, 'workspace');
      const dataDir = path.join(tmpDir, 'plugin-data');
      fs.mkdirSync(ws, { recursive: true });
      fs.mkdirSync(dataDir, { recursive: true });

      setModuleEnabled(dataDir, 'guard', true);
      setModuleEnabled(dataDir, 'verify', true);
      updateVerifyPolicy(getModuleDataDir(dataDir, 'verify'), {
        enforceOnStop: true,
        autoRunOnStop: false,
        blockEmptyWrites: true,
        maxConsecutiveBlocks: 3,
      });

      const env = { PLUGIN_DATA: dataDir };

      // 1. SessionStart
      const ss = runShellHookCommand(
        getCmd('SessionStart'),
        { hookEventName: 'SessionStart', conversationId: 'bb-1', workspacePaths: [ws] },
        env,
      );
      assert.doesNotThrow(() => JSON.parse(ss.stdout));

      // 2. PreInvocation
      const preInv = runShellHookCommand(
        getCmd('PreInvocation'),
        { hookEventName: 'PreInvocation', conversationId: 'bb-1', workspacePaths: [ws] },
        env,
      );
      assert.doesNotThrow(() => JSON.parse(preInv.stdout));

      // 3. PreToolUse: safe command -> explicit decision="allow"; destructive -> decision="deny"
      const preAllow = runShellHookCommand(
        getCmd('PreToolUse'),
        {
          hookEventName: 'PreToolUse',
          conversationId: 'bb-1',
          workspacePaths: [ws],
          toolCall: { name: 'run_command', args: { CommandLine: 'git status --short' } },
        },
        env,
      );
      assert.equal(JSON.parse(preAllow.stdout).decision, 'allow');

      const preDeny = runShellHookCommand(
        getCmd('PreToolUse'),
        {
          hookEventName: 'PreToolUse',
          conversationId: 'bb-1',
          workspacePaths: [ws],
          toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf /' } },
        },
        env,
      );
      assert.equal(JSON.parse(preDeny.stdout).decision, 'deny');

      // 4. PostToolUse (0-byte file write) + Stop -> must return official decision="continue"
      const emptyFile = path.join(ws, 'empty.ts');
      fs.writeFileSync(emptyFile, '', 'utf8');
      runShellHookCommand(
        getCmd('PostToolUse'),
        {
          hookEventName: 'PostToolUse',
          conversationId: 'bb-1',
          workspacePaths: [ws],
          toolCall: { name: 'write_file', args: { Path: emptyFile } },
        },
        env,
      );

      const stopContinue = runShellHookCommand(
        getCmd('Stop'),
        {
          hookEventName: 'Stop',
          conversationId: 'bb-1',
          workspacePaths: [ws],
          terminationReason: 'NO_TOOL_CALL',
        },
        env,
      );
      const stopContinueJson = JSON.parse(stopContinue.stdout);
      assert.equal(stopContinueJson.decision, 'continue');
      assert.match(stopContinueJson.reason ?? '', /Verify Gate/i);

      // 5. Stop with USER_CANCELED or ERROR must NEVER block termination
      for (const termReason of [
        'USER_CANCELED',
        'ERROR',
        'EXECUTOR_TERMINATION_REASON_MAX_TOKEN_BUDGET_EXCEEDED',
      ]) {
        const stopBypass = runShellHookCommand(
          getCmd('Stop'),
          {
            hookEventName: 'Stop',
            conversationId: 'bb-1',
            workspacePaths: [ws],
            terminationReason: termReason,
          },
          env,
        );
        assert.equal(
          JSON.parse(stopBypass.stdout).decision,
          'allow',
          `Stop hook must allow exit on terminationReason=${termReason}`,
        );
      }
    });
  });

  it('allows immediate exit in handleVerifyStopHook for non-NO_TOOL_CALL terminationReason without mutating state', async () => {
    await withTempDir('agy-nov-v102-term-', async (tmpDir) => {
      const ws = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(ws, { recursive: true });
      updateVerifyPolicy(getModuleDataDir(dataDir, 'verify'), {
        enforceOnStop: true,
        autoRunOnStop: false,
        blockEmptyWrites: true,
      });
      const zeroFile = path.join(ws, 'zero.ts');
      fs.writeFileSync(zeroFile, '', 'utf8');
      handleVerifyPostToolHook(
        normalizeHookPayload(
          { conversationId: 'conv-term', workspaceRoot: ws, toolName: 'write_file', toolInput: { Path: zeroFile } },
          'PostToolUse',
        ),
        dataDir,
      );

      const canceled = await handleVerifyStopHook(
        normalizeHookPayload(
          { conversationId: 'conv-term', workspaceRoot: ws, terminationReason: 'USER_CANCELED' },
          'Stop',
        ),
        dataDir,
      );
      assert.equal(canceled.decision, 'allow');

      const normalStop = await handleVerifyStopHook(
        normalizeHookPayload(
          { conversationId: 'conv-term', workspaceRoot: ws, terminationReason: 'NO_TOOL_CALL' },
          'Stop',
        ),
        dataDir,
      );
      assert.equal(normalStop.decision, 'continue');
    });
  });
});

describe('v1.0.2 MCP CLI Tool Budget Gate, Dynamic roots/list & Official plugin_data Detection', () => {
  it('hides all app_* and nov_app_* tools for CLI clients lacking io.modelcontextprotocol/ui so full preset stays at 47 tools', async () => {
    await withTempDir('agy-nov-v102-cli-gate-', async (tmpDir) => {
      const ws = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(ws, { recursive: true });
      applyPresetConfig(dataDir, 'full');

      // 1. CLI client (no io.modelcontextprotocol/ui extension)
      const cliBundle = createNovServer({ dataDir, workspaceRoot: ws, demoMode: false, configPollMs: 0 });
      const [cliCTrans, cliSTrans] = InMemoryTransport.createLinkedPair();
      const cliClient = new Client({ name: 'antigravity-cli', version: '2.35.2' });
      let listChangedCount = 0;
      cliClient.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        listChangedCount += 1;
      });
      try {
        await cliBundle.server.connect(cliSTrans);
        await cliClient.connect(cliCTrans);
        await new Promise((r) => setTimeout(r, 30));
        const { tools } = await cliClient.listTools();
        const names = tools.map((t) => t.name);
        assert.equal(cliBundle.hasUiAppToolsEnabled(), false);
        assert.ok(
          listChangedCount <= 1,
          `Expected coalesced tools/list_changed notification (<=1), got ${listChangedCount}`,
        );
        assert.equal(names.length, 47, `CLI full preset must expose strictly 47 canonical tools, got ${names.length}`);
        assert.equal(
          names.some((n) => n.startsWith('app_') || n.startsWith('nov_app_')),
          false,
          'CLI client must receive zero app_* / nov_app_* tools',
        );
      } finally {
        await cliClient.close();
        await cliBundle.dispose();
      }

      // 2. Desktop/UI client declaring io.modelcontextprotocol/ui extension
      const uiBundle = createNovServer({ dataDir, workspaceRoot: ws, demoMode: false, configPollMs: 0 });
      const [uiCTrans, uiSTrans] = InMemoryTransport.createLinkedPair();
      const uiClient = new Client(
        { name: 'antigravity-desktop', version: '2.35.2' },
        {
          capabilities: {
            extensions: {
              'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] },
            },
          } as any,
        },
      );
      try {
        await uiBundle.server.connect(uiSTrans);
        await uiClient.connect(uiCTrans);
        const { tools } = await uiClient.listTools();
        const names = tools.map((t) => t.name);
        assert.equal(uiBundle.hasUiAppToolsEnabled(), true);
        assert.ok(names.includes('nov_app_get_config'));
        assert.ok(names.includes('nov_app_get_hub_state'));
        assert.ok(names.length > 100);
      } finally {
        await uiClient.close();
        await uiBundle.dispose();
      }
    });
  });

  it('dynamically updates workspaceRoot via MCP roots/list and roots/list_changed without restarting server', async () => {
    await withTempDir('agy-nov-v102-roots-', async (tmpDir) => {
      const wsA = path.join(tmpDir, 'project-a');
      const wsB = path.join(tmpDir, 'project-b');
      const dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(wsA, { recursive: true });
      fs.mkdirSync(wsB, { recursive: true });
      fs.writeFileSync(path.join(wsB, 'AGENTS.md'), '# Project B Rules\n', 'utf8');
      setModuleEnabled(dataDir, 'ops', true);

      let activeRoot = wsA;
      const bundle = createNovServer({
        dataDir,
        workspaceRoot: wsA,
        demoMode: false,
        configPollMs: 0,
        exposeAppToolsWithoutUiCapability: true,
      });
      const [cTrans, sTrans] = InMemoryTransport.createLinkedPair();
      const client = new Client(
        { name: 'antigravity-roots-test', version: '2.35.2' },
        { capabilities: { roots: { listChanged: true } } },
      );
      client.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: [{ uri: pathToFileURL(activeRoot).href, name: path.basename(activeRoot) }],
      }));

      try {
        await bundle.server.connect(sTrans);
        await client.connect(cTrans);
        // Wait briefly for initial async roots/list sync
        await new Promise((r) => setTimeout(r, 40));
        assert.equal(isSamePath(bundle.options.workspaceRoot, canonicalRealpathSync(wsA)), true);

        // Switch client workspace to wsB and notify server
        activeRoot = wsB;
        await client.sendRootsListChanged();
        await new Promise((r) => setTimeout(r, 60));
        assert.equal(isSamePath(bundle.options.workspaceRoot, canonicalRealpathSync(wsB)), true);

        // Call ops_audit_workspace without passing explicit workspacePath -> must audit wsB
        const auditRes = await client.callTool({ name: 'ops_audit_workspace', arguments: {} });
        const sc = (auditRes as any).structuredContent;
        assert.equal(sc.workspaceName, 'project-b');
        assert.ok(sc.assets.some((a: { relPath: string }) => a.relPath === 'AGENTS.md'));
      } finally {
        await client.close();
        await bundle.dispose();
      }
    });
  });

  it('auto-detects existing official Antigravity plugin_data/agy-nov read-only and skips symlinks', async () => {
    await withTempDir('agy-nov-v102-plugindata-', (tmpDir) => {
      const fakeHome = path.join(tmpDir, 'home');
      fs.mkdirSync(fakeHome, { recursive: true });

      // When missing -> undefined and zero dirs created
      assert.equal(detectExistingOfficialPluginDataDir({}, process.platform, fakeHome), undefined);
      assert.equal(fs.existsSync(path.join(fakeHome, '.gemini')), false);

      // When official plugin_data/agy-nov exists -> detected read-only
      const officialDir = path.join(fakeHome, '.gemini', 'antigravity', 'plugin_data', 'agy-nov');
      fs.mkdirSync(officialDir, { recursive: true });
      const detected = detectExistingOfficialPluginDataDir({}, process.platform, fakeHome);
      assert.equal(isSamePath(detected ?? '', officialDir), true);

      // Symlinked plugin_data/agy-nov must be ignored safely
      const outside = path.join(tmpDir, 'outside');
      fs.mkdirSync(outside, { recursive: true });
      fs.rmSync(officialDir, { recursive: true, force: true });
      createDirSymlink(outside, officialDir);
      assert.equal(detectExistingOfficialPluginDataDir({}, process.platform, fakeHome), undefined);
    });
  });
});

describe('v1.0.2 Dual-Star Feed, Mem Verify Re-Anchor, Auto-RTK Unicode & Remote Gateway Hardening', () => {
  it('populates Guard forceAskCount, permissionMode, snapshotCount, and latestSnapshotId in feed-snapshot.json', async () => {
    await withTempDir('agy-nov-v102-feed-', (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data');
      const guardDir = getModuleDataDir(dataDir, 'guard');
      fs.mkdirSync(guardDir, { recursive: true });
      const cfg = setModuleEnabled(dataDir, 'guard', true);

      fs.writeFileSync(
        path.join(guardDir, 'policy.json'),
        JSON.stringify({ permissionMode: 'strict-gate' }),
        'utf8',
      );
      fs.writeFileSync(
        path.join(guardDir, 'audit.json'),
        JSON.stringify({
          events: [
            { decision: 'deny', toolName: 'run_command', summary: 'blocked rm', timestamp: '2026-11-27T10:00:00Z' },
            { decision: 'force_ask', toolName: 'edit_file', summary: 'strict gate', timestamp: '2026-11-27T10:05:00Z' },
          ],
        }),
        'utf8',
      );
      fs.writeFileSync(
        path.join(guardDir, 'snapshots.json'),
        JSON.stringify([
          { id: 'snap-1', timestamp: '2026-11-27T09:00:00Z' },
          { id: 'snap-2', timestamp: '2026-11-27T10:04:00Z' },
        ]),
        'utf8',
      );

      const snap = buildFeedSnapshot(dataDir, cfg);
      assert.equal(snap.version, '1.0.2');
      assert.equal(snap.summary.guard.blockedCount, 1);
      assert.equal(snap.summary.guard.askCount, 1);
      assert.equal(snap.summary.guard.forceAskCount, 1);
      assert.equal(snap.summary.guard.permissionMode, 'strict-gate');
      assert.equal(snap.summary.guard.snapshotCount, 2);
      assert.equal(snap.summary.guard.latestSnapshotId, 'snap-2');
    });
  });

  it('recomputes anchor SHA-256 hashes and clears drifted status on batch verify while keeping deleted files drifted', async () => {
    await withTempDir('agy-nov-v102-mem-reverify-', (tmpDir) => {
      const ws = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(ws, { recursive: true });
      const fileOk = path.join(ws, 'app.ts');
      const fileGone = path.join(ws, 'gone.ts');
      fs.writeFileSync(fileOk, 'export const v = 1;\n', 'utf8');
      fs.writeFileSync(fileGone, 'export const g = 1;\n', 'utf8');

      const store = new MemoryStore(getModuleDataDir(dataDir, 'mem'), false, () => ws);
      const itemOk = store.remember({
        kind: 'architecture',
        title: 'App invariant',
        content: 'Keep v positive',
        anchors: [{ filePath: 'app.ts' }],
        workspacePath: ws,
      });
      const itemGone = store.remember({
        kind: 'pitfall',
        title: 'Gone file note',
        content: 'Old file note',
        anchors: [{ filePath: 'gone.ts' }],
        workspacePath: ws,
      });

      // Modify app.ts and delete gone.ts -> both become drifted
      fs.writeFileSync(fileOk, 'export const v = 2;\n', 'utf8');
      fs.rmSync(fileGone);
      const before = store.list({ workspacePath: ws });
      assert.equal(before.find((m) => m.id === itemOk.id)?.drifted, true);
      assert.equal(before.find((m) => m.id === itemGone.id)?.drifted, true);

      // Batch verify -> itemOk re-anchored and healthy; itemGone stays drifted honestly
      const res = store.batchHygieneMemories([itemOk.id, itemGone.id], 'verify', ws);
      assert.equal(res.reverifiedItemCount, 1);
      assert.deepEqual(res.unresolvedDriftIds, [itemGone.id]);

      const after = store.list({ workspacePath: ws });
      assert.equal(after.find((m) => m.id === itemOk.id)?.drifted, false);
      assert.equal(after.find((m) => m.id === itemOk.id)?.confidence, 'verified');
      assert.equal(after.find((m) => m.id === itemGone.id)?.drifted, true);
    });
  });

  it('accepts non-ASCII (CJK) usernames and parenthesized paths in Auto-RTK while rejecting shell injection', () => {
    const parsed = parseSafeAutoRtkCommand('git status --short');
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const cjkWinCli = 'C:\\Users\\张伟\\Program Files (x86)\\agy-nov\\dist\\cli.cjs';
    const cjkWinData = 'C:\\Users\\山田太郎\\.agy-nov';
    assert.equal(isSafeAbsolutePathArg(cjkWinCli, 'win32'), true);
    const winCmd = buildAutoRtkOverwriteCommand(cjkWinCli, parsed, cjkWinData, 'win32');
    assert.ok(winCmd && winCmd.includes('张伟') && winCmd.includes('Program Files (x86)'));

    const cjkPosixCli = '/home/김철수/my (work)/agy-nov/dist/cli.cjs';
    assert.equal(isSafeAbsolutePathArg(cjkPosixCli, 'linux'), true);
    const posixCmd = buildAutoRtkOverwriteCommand(cjkPosixCli, parsed, '/home/김철수/.agy-nov', 'linux');
    assert.ok(posixCmd && posixCmd.includes("'/home/김철수/my (work)/agy-nov/dist/cli.cjs'"));

    // Command substitution and shell metacharacters remain hard-rejected
    for (const bad of [
      '/home/张伟/$(id)/cli.cjs',
      '/home/张伟/`id`/cli.cjs',
      'C:\\Users\\张伟\\%COMSPEC%\\cli.cjs',
      'C:\\Users\\张伟\\a;id\\cli.cjs',
    ]) {
      assert.equal(isSafeAbsolutePathArg(bad, bad.startsWith('/') ? 'linux' : 'win32'), false);
    }
  });

  it('blocks cross-origin /api/pair DoS and enforces SSE client cap + keepalive in RemoteGateway', async () => {
    await withTempDir('agy-nov-v102-remote-gw-', async (tmpDir) => {
      const cfg = defaultRemoteConfig();
      cfg.host = '127.0.0.1';
      cfg.port = 0;
      saveConfig(tmpDir, cfg);

      const gw = new RemoteGateway(tmpDir, new ConversationClient({ demoMode: true }), {
        sseKeepaliveIntervalMs: 80,
      });

      const sseReqs: http.ClientRequest[] = [];
      try {
        const info = await gw.start(0);
        const port = Number(new URL(info.mobileUrl).port);

        // 1. Cross-origin attack on /api/pair returns 403 and must NOT trip PIN lockout
        for (let i = 0; i < 6; i += 1) {
          const attackStatus = await new Promise<number>((resolve, reject) => {
            const req = http.request(
              {
                hostname: '127.0.0.1',
                port,
                path: '/api/pair',
                method: 'POST',
                headers: {
                  Host: `127.0.0.1:${port}`,
                  Origin: 'https://evil.example',
                  'Content-Type': 'application/json',
                },
              },
              (res) => {
                res.resume();
                resolve(res.statusCode ?? 0);
              },
            );
            req.on('error', reject);
            req.end(JSON.stringify({ pin: '000000' }));
          });
          assert.equal(attackStatus, 403);
        }

        // 1b. Explicit :80 Host header spoofing must also be rejected (403) without tripping PIN lockout
        const port80Status = await new Promise<number>((resolve, reject) => {
          const req = http.request(
            {
              hostname: '127.0.0.1',
              port,
              path: '/api/pair',
              method: 'POST',
              headers: {
                Host: '127.0.0.1:80',
                'Content-Type': 'application/json',
              },
            },
            (res) => {
              res.resume();
              resolve(res.statusCode ?? 0);
            },
          );
          req.on('error', reject);
          req.end(JSON.stringify({ pin: '000000' }));
        });
        assert.equal(port80Status, 403);

        // Legitimate same-origin pairing must still succeed immediately
        const validPin = gw.getStatus().pairingPin;
        const pairRes = await new Promise<{ status: number; body: string }>((resolve, reject) => {
          const req = http.request(
            {
              hostname: '127.0.0.1',
              port,
              path: '/api/pair',
              method: 'POST',
              headers: {
                Host: `127.0.0.1:${port}`,
                Origin: `http://127.0.0.1:${port}`,
                'Content-Type': 'application/json',
              },
            },
            (res) => {
              let body = '';
              res.on('data', (c) => (body += c.toString('utf8')));
              res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
            },
          );
          req.on('error', reject);
          req.end(JSON.stringify({ pin: validPin }));
        });
        assert.equal(pairRes.status, 200);
        const token = JSON.parse(pairRes.body).token as string;
        assert.ok(token);

        // 2. SSE keepalive & MAX_SSE_CLIENTS cap
        let gotKeepalive = false;
        const openSse = (): Promise<number> =>
          new Promise((resolve, reject) => {
            const req = http.request(
              {
                hostname: '127.0.0.1',
                port,
                path: '/api/events',
                method: 'GET',
                headers: {
                  Host: `127.0.0.1:${port}`,
                  Authorization: `Bearer ${token}`,
                },
              },
              (res) => {
                res.on('data', (chunk) => {
                  if (chunk.toString('utf8').includes(': keepalive')) {
                    gotKeepalive = true;
                  }
                });
                resolve(res.statusCode ?? 0);
              },
            );
            req.on('error', () => undefined);
            req.end();
            sseReqs.push(req);
          });

        for (let i = 0; i < MAX_SSE_CLIENTS; i += 1) {
          assert.equal(await openSse(), 200);
        }
        assert.equal(await openSse(), 503);
        await new Promise((r) => setTimeout(r, 140));
        assert.equal(gotKeepalive, true, 'Expected SSE keepalive comment frame');
      } finally {
        for (const r of sseReqs) {
          try {
            r.destroy();
          } catch {
            // ignore
          }
        }
        await gw.stop();
      }
    });
  });

  it('declares only native Antigravity read-only tools in agents/nov-*.md', () => {
    for (const file of ['agents/nov-blind-reviewer.md', 'agents/nov-security-auditor.md']) {
      const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      assert.match(content, /^tools:\n\s+-\s+read_file\n/m, `${file} must declare native read_file`);
      assert.equal(
        /\b(?:grep_search|find_by_name|list_dir)\b/.test(content),
        false,
        `${file} must not declare non-native tool names`,
      );
    }

    // Client-side SVG XSS & Host URI boundary hardening regressions
    const xssSvgs = [
      '<svg xmlns:svg="http://www.w3.org/2000/svg"><svg:script>alert(1)</svg:script></svg>',
      '<svg xmlns:svg="http://www.w3.org/2000/svg"><svg:foreignObject><div>x</div></svg:foreignObject></svg>',
      '<svg xmlns:xhtml="http://www.w3.org/1999/xhtml"><xhtml:iframe src="about:blank"/></svg>',
      '<svg id="x"onload="alert(1)"></svg>',
      '<svg><a href="javascript&#58alert(1)">x</a></svg>',
      '<svg><a href="javascript&#00000000000058;alert(1)">x</a></svg>',
      '<svg><a href="java&Tab;script:alert(1)">x</a></svg>',
      '<svg><a href="java&NewLine;script:alert(1)">x</a></svg>',
      '<svg><a href="data:text&sol;html,hi">x</a></svg>',
      '<svg><image href=https://evil.example/x.png /></svg>',
    ];
    for (const payload of xssSvgs) {
      assert.equal(
        validateClientSvgSafety(payload).safe,
        false,
        `Client SVG validator must reject XSS payload: ${payload}`,
      );
    }
    assert.equal(
      validateClientSvgSafety('<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>').safe,
      true,
    );
    assert.equal(toSafeLocalFileUri('file:////evil.com/share/a.csv'), null);
    assert.equal(toSafeHostResourceUri('antigravity-file://host/ws/a?x=../etc/passwd'), null);
    assert.equal(toSafeHostResourceUri('antigravity-file://host/ws/a#frag'), null);
  });

  it('keeps all 8 UI locale dictionaries 100% key-symmetric with zero empty strings or placeholder mismatches', () => {
    const flatten = (obj: Record<string, unknown>, prefix = ''): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          Object.assign(out, flatten(v as Record<string, unknown>, key));
        } else {
          out[key] = String(v ?? '');
        }
      }
      return out;
    };
    const extractPlaceholders = (s: string): string[] =>
      Array.from(new Set(s.match(/\{[a-zA-Z0-9_]+\}/g) ?? [])).sort();

    const base = flatten(DICTIONARIES.en as unknown as Record<string, unknown>);
    const baseKeys = Object.keys(base).sort();
    assert.ok(baseKeys.length >= 700, `Expected expanded i18n dictionary >=700 keys, got ${baseKeys.length}`);

    for (const [locale, dict] of Object.entries(DICTIONARIES)) {
      if (locale === 'en') continue;
      const flat = flatten(dict as unknown as Record<string, unknown>);
      assert.deepEqual(Object.keys(flat).sort(), baseKeys, `Key mismatch in locale ${locale}`);
      for (const key of baseKeys) {
        assert.ok(flat[key].trim().length > 0, `Empty value in ${locale}: ${key}`);
        assert.deepEqual(
          extractPlaceholders(flat[key]),
          extractPlaceholders(base[key]),
          `Placeholder mismatch in ${locale}: ${key}`,
        );
      }
    }
  });
});
