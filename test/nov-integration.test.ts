import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyPresetConfig,
  countEnabledModelTools,
  loadNovConfigReadOnly,
  MODULE_IDS,
  resolveNovDataDir,
  setModuleEnabled,
} from '../src/core/config.js';
import { dispatchNovHook } from '../src/hooks/dispatcher.js';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

class StdioClient {
  private proc;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = '';

  constructor(bundlePath: string, args: string[]) {
    this.proc = spawn(process.execPath, [bundlePath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      let idx;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id && this.pending.has(msg.id)) {
            const entry = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.error) entry.reject(new Error(msg.error.message || 'MCP error'));
            else entry.resolve(msg.result);
          }
        } catch {
          // ignore non-json
        }
      }
    });
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async init(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'agy-nov-test', version: '0.1.0' },
    });
    this.proc.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    );
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.proc.once('exit', () => resolve());
      this.proc.stdin.end();
      setTimeout(() => {
        try {
          this.proc.kill('SIGTERM');
        } catch {
          // ignore
        }
        resolve();
      }, 1500);
    });
  }
}

test('config defaults, placeholder filtering, presets & read-only load', () => {
  const tmp = createTempDir('agy-nov-cfg-');
  try {
    // Unexpanded ${PLUGIN_DATA} must be ignored
    const resolved = resolveNovDataDir('${PLUGIN_DATA}');
    assert.ok(!resolved.includes('${PLUGIN_DATA}'));

    const cfg = loadNovConfigReadOnly(tmp);
    assert.equal(cfg.preset, 'core');
    assert.equal(cfg.modules.review, true);
    assert.equal(cfg.modules.guard, true);
    assert.equal(cfg.modules.xray, true);
    assert.equal(cfg.modules.canvas, false);
    assert.equal(cfg.modules.mem, false);
    assert.equal(cfg.modules.remote, false);
    // Read-only load must not write config.json
    assert.equal(fs.existsSync(path.join(tmp, 'config.json')), false);

    const next = setModuleEnabled(tmp, 'canvas', true);
    assert.equal(next.modules.canvas, true);
    assert.equal(next.preset, 'custom');
    assert.equal(fs.existsSync(path.join(tmp, 'config.json')), true);

    const minimal = applyPresetConfig(tmp, 'minimal');
    assert.equal(minimal.preset, 'minimal');
    assert.equal(countEnabledModelTools(minimal.modules), 6); // nov_open + nov_status + 4 guard tools

    const localAll = applyPresetConfig(tmp, 'local-all');
    assert.equal(localAll.modules.remote, false);
    assert.equal(MODULE_IDS.filter((m) => localAll.modules[m]).length, 5);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('unified hook dispatcher respects module switches and keeps remote strictly inert when OFF', async () => {
  const tmp = createTempDir('agy-nov-hook-');
  try {
    // Default config: mem=false, remote=false, guard=true
    const sessionOut = await dispatchNovHook(
      { workspacePaths: [tmp], conversationId: 'conv-1' },
      'SessionStart',
      tmp,
    );
    assert.deepEqual(sessionOut, {});

    // Guard blocks dangerous rm -rf / even via camelCase toolCall payload
    const preDanger = await dispatchNovHook(
      {
        hookEventName: 'PreToolUse',
        workspacePaths: [tmp],
        toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf /' } },
      },
      'PreToolUse',
      tmp,
    );
    assert.equal(preDanger.decision, 'deny');

    // Disable guard and verify PreToolUse short-circuits completely with zero side effects
    setModuleEnabled(tmp, 'guard', false);
    const preDisabled = await dispatchNovHook(
      {
        hookEventName: 'PreToolUse',
        workspacePaths: [tmp],
        toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf /' } },
      },
      'PreToolUse',
      tmp,
    );
    assert.deepEqual(preDisabled, {});
    // Remote directory must never be created when remote is OFF
    assert.equal(fs.existsSync(path.join(tmp, 'modules', 'remote')), false);

    // Stop event returns allow and keeps remote untouched
    const stopOut = await dispatchNovHook(
      { hookEventName: 'Stop', conversationId: 'conv-1' },
      'Stop',
      tmp,
    );
    assert.deepEqual(stopOut, { decision: 'allow' });
    assert.equal(fs.existsSync(path.join(tmp, 'modules', 'remote')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('bundled MCP stdio server dynamically toggles exposed model tools and reads UI resource', async () => {
  const bundlePath = path.resolve(process.cwd(), 'dist/server.cjs');
  assert.ok(fs.existsSync(bundlePath), 'dist/server.cjs must exist before running integration tests');

  const tmp = createTempDir('agy-nov-stdio-');
  const client = new StdioClient(bundlePath, [`--data-dir=${tmp}`, '--demo']);
  try {
    await client.init();

    // 1. Default preset = core: canvas/mem/remote model tools must NOT appear in tools/list
    const initialTools = await client.request('tools/list', {});
    const initialNames: string[] = initialTools.tools.map((t: any) => t.name);
    assert.ok(initialNames.includes('nov_open'));
    assert.ok(initialNames.includes('nov_status'));
    assert.ok(initialNames.includes('review_open'));
    assert.ok(initialNames.includes('guard_status'));
    assert.ok(initialNames.includes('xray_analyze_context'));
    assert.ok(!initialNames.includes('canvas_publish_artifact'));
    assert.ok(!initialNames.includes('mem_remember'));
    assert.ok(!initialNames.includes('remote_status'));

    // Remote must NOT have written runtime.json on startup
    assert.equal(fs.existsSync(path.join(tmp, 'modules', 'remote', 'runtime.json')), false);

    // 2. Toggle canvas ON live -> canvas_publish_artifact immediately appears in tools/list
    const toggleRes = await client.request('tools/call', {
      name: 'nov_app_set_module',
      arguments: { module: 'canvas', enabled: true },
    });
    assert.equal(toggleRes.structuredContent.config.modules.canvas, true);

    const afterEnable = await client.request('tools/list', {});
    const afterEnableNames: string[] = afterEnable.tools.map((t: any) => t.name);
    assert.ok(afterEnableNames.includes('canvas_publish_artifact'));

    // 3. Apply minimal preset -> review & xray & canvas model tools hidden immediately
    await client.request('tools/call', {
      name: 'nov_app_apply_preset',
      arguments: { preset: 'minimal' },
    });
    const minimalTools = await client.request('tools/list', {});
    const minimalNames: string[] = minimalTools.tools.map((t: any) => t.name);
    assert.ok(minimalNames.includes('guard_status'));
    assert.ok(!minimalNames.includes('review_open'));
    assert.ok(!minimalNames.includes('xray_analyze_context'));
    assert.ok(!minimalNames.includes('canvas_publish_artifact'));

    // 4. UI resource loads cleanly under 10 MiB with MCP App MIME type
    const resource = await client.request('resources/read', { uri: 'ui://agy-nov/app.html' });
    assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.ok(resource.contents[0].text.length > 1000);
    assert.ok(Buffer.byteLength(resource.contents[0].text, 'utf8') < 10 * 1024 * 1024);
  } finally {
    await client.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('plugin.json contains only official Antigravity manifest keys', () => {
  const manifestPath = path.resolve(process.cwd(), 'plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const allowed = new Set([
    'name',
    'displayName',
    'description',
    'version',
    'logo',
    'suggestedPrompts',
    'author',
    'homepage',
    'repository',
    'disabled',
  ]);
  for (const key of Object.keys(manifest)) {
    assert.ok(allowed.has(key), `Unexpected top-level key in plugin.json: ${key}`);
  }
  assert.equal(manifest.name, 'agy-nov');
  assert.equal(manifest.displayName, 'agy-NOV');
});

test('security regressions: Guard symlink blocking (H-1), snake_case target_file (M-1), and unexpanded ${PLUGIN_DATA} fallback (H-2)', async () => {
  const ws = createTempDir('agy-nov-sec-ws-');
  const outside = createTempDir('agy-nov-sec-out-');
  const dataDir = createTempDir('agy-nov-sec-data-');
  try {
    fs.writeFileSync(path.join(ws, '.env'), 'SECRET=topsecret\n');
    fs.writeFileSync(path.join(outside, 'id_rsa'), '-----BEGIN OPENSSH PRIVATE KEY-----\n');
    fs.symlinkSync(path.join(ws, '.env'), path.join(ws, 'innocent-link.txt'));
    fs.symlinkSync(path.join(outside, 'id_rsa'), path.join(ws, 'readme-alias.txt'));

    // H-1: Symlinks pointing to .env or external id_rsa must be blocked
    const linkEnv = await dispatchNovHook(
      {
        hookEventName: 'PreToolUse',
        workspacePaths: [ws],
        toolCall: { name: 'read_file', args: { Path: path.join(ws, 'innocent-link.txt') } },
      },
      'PreToolUse',
      dataDir,
    );
    assert.equal(linkEnv.decision, 'deny');

    const linkKey = await dispatchNovHook(
      {
        hookEventName: 'PreToolUse',
        workspacePaths: [ws],
        toolCall: { name: 'read_file', args: { Path: path.join(ws, 'readme-alias.txt') } },
      },
      'PreToolUse',
      dataDir,
    );
    assert.equal(linkKey.decision, 'deny');

    // M-1: snake_case target_file must be recognized and blocked
    const snakeEnv = await dispatchNovHook(
      {
        hookEventName: 'PreToolUse',
        workspacePaths: [ws],
        toolCall: { name: 'read_file', args: { target_file: path.join(ws, '.env') } },
      },
      'PreToolUse',
      dataDir,
    );
    assert.equal(snakeEnv.decision, 'deny');

    // H-2: When --data-dir=${PLUGIN_DATA} is unexpanded, dispatcher must fall back to stdin payload.pluginData
    setModuleEnabled(dataDir, 'guard', false);
    const fallbackOut = await dispatchNovHook(
      {
        hookEventName: 'PreToolUse',
        pluginData: dataDir,
        workspacePaths: [ws],
        toolCall: { name: 'read_file', args: { Path: path.join(ws, '.env') } },
      },
      'PreToolUse',
      '${PLUGIN_DATA}',
    );
    assert.deepEqual(fallbackOut, {});
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('isolation regressions: lazy storage (M-4), disabled app_* tool blocking (M-3), mem workspace boundary (M-2), and truthful remoteRunning (M-5)', async () => {
  const bundlePath = path.resolve(process.cwd(), 'dist/server.cjs');
  const tmp = createTempDir('agy-nov-iso-');
  const ws = createTempDir('agy-nov-iso-ws-');
  const outside = createTempDir('agy-nov-iso-out-');
  fs.writeFileSync(path.join(ws, 'app.ts'), 'export const ok = 1;\n');
  fs.writeFileSync(path.join(outside, 'secret-notes.txt'), 'do not hash outside workspace\n');

  const client = new StdioClient(bundlePath, [`--data-dir=${tmp}`, `--workspace=${ws}`]);
  try {
    await client.init();

    // M-4: Disabled modules must NOT create directories or files on server startup
    assert.equal(fs.existsSync(path.join(tmp, 'modules', 'canvas')), false);
    assert.equal(fs.existsSync(path.join(tmp, 'modules', 'mem')), false);
    assert.equal(fs.existsSync(path.join(tmp, 'modules', 'remote')), false);

    // M-3: Calling app_* on disabled modules must be rejected (either JSON-RPC error or isError:true) and must NOT write config.json
    const assertDisabledCall = async (name: string, args: Record<string, unknown> = {}) => {
      try {
        const res = await client.request('tools/call', { name, arguments: args });
        assert.equal(res.isError, true, `Expected ${name} to fail with isError:true when disabled`);
        const msg = JSON.stringify(res.content ?? '');
        assert.match(msg, /disabled/i);
      } catch (err) {
        assert.match(err instanceof Error ? err.message : String(err), /disabled/i);
      }
    };

    await assertDisabledCall('app_remote_update_channel', { id: 'slack', enabled: false });
    assert.equal(fs.existsSync(path.join(tmp, 'modules', 'remote', 'config.json')), false);

    await assertDisabledCall('app_canvas_list_boards', {});

    // Disable review and confirm app_review_get_diff is also blocked
    await client.request('tools/call', {
      name: 'nov_app_set_module',
      arguments: { module: 'review', enabled: false },
    });
    await assertDisabledCall('app_review_get_diff', {});

    // M-2: Enable mem and verify model-supplied outside workspacePath cannot escape workspaceRoot, while relative path resolves against workspaceRoot
    await client.request('tools/call', {
      name: 'nov_app_set_module',
      arguments: { module: 'mem', enabled: true },
    });
    await client.request('tools/call', {
      name: 'mem_remember',
      arguments: {
        kind: 'decision',
        title: 'Boundary check',
        content: 'Verify anchor boundary',
        workspacePath: outside,
        anchors: [
          { filePath: path.join(outside, 'secret-notes.txt') },
          { filePath: 'app.ts' },
        ],
      },
    });
    const memState = await client.request('tools/call', {
      name: 'app_mem_get_state',
      arguments: {},
    });
    const savedItem = memState.structuredContent.memories.find((m: any) => m.title === 'Boundary check');
    assert.ok(savedItem, 'Expected saved memory in app_mem_get_state');
    const anchors = savedItem.anchors;
    assert.equal(anchors[0].driftStatus, 'skipped');
    assert.equal(anchors[0].sha256, undefined);
    assert.equal(anchors[1].driftStatus, 'fresh');
    assert.ok(typeof anchors[1].sha256 === 'string' && anchors[1].sha256.length > 0);

    // R-1: Directory symlink inside workspace pointing outside must not bypass workspaceRoot boundary
    const escapeLink = path.join(ws, 'escape-dir');
    fs.symlinkSync(outside, escapeLink);
    await client.request('tools/call', {
      name: 'mem_remember',
      arguments: {
        kind: 'decision',
        title: 'Symlink dir escape check',
        content: 'Verify directory symlink cannot escape workspaceRoot',
        workspacePath: escapeLink,
        anchors: [{ filePath: path.join(outside, 'secret-notes.txt') }],
      },
    });
    const memStateAfterEscape = await client.request('tools/call', {
      name: 'app_mem_get_state',
      arguments: {},
    });
    const escapedItem = memStateAfterEscape.structuredContent.memories.find(
      (m: any) => m.title === 'Symlink dir escape check',
    );
    assert.ok(escapedItem);
    assert.equal(escapedItem.anchors[0].driftStatus, 'skipped');
    assert.equal(escapedItem.anchors[0].sha256, undefined);

    // M-5: If remote gateway fails to bind an unbindable host, nov_status must truthfully report remoteRunning: false
    const remoteDir = path.join(tmp, 'modules', 'remote');
    fs.mkdirSync(remoteDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(remoteDir, 'config.json'),
      JSON.stringify({ host: '203.0.113.1', port: 4391, gatewayEnabled: false }),
    );
    // Restart a fresh client pointing at this dataDir and enable remote
    await client.close();
    const client2 = new StdioClient(bundlePath, [`--data-dir=${tmp}`, `--workspace=${ws}`]);
    try {
      await client2.init();
      const toggled = await client2.request('tools/call', {
        name: 'nov_app_set_module',
        arguments: { module: 'remote', enabled: true },
      });
      assert.equal(toggled.structuredContent.remoteRunning, false);
      const status = await client2.request('tools/call', { name: 'nov_status', arguments: {} });
      assert.equal(status.structuredContent.remoteRunning, false);
    } finally {
      await client2.close();
    }
  } finally {
    await client.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
