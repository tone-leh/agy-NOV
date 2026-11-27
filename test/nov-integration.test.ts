import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyPresetConfig,
  countEnabledModelTools,
  getConfigPath,
  loadNovConfigReadOnly,
  MODULE_CATEGORY_IDS,
  MODULE_IDS,
  PRESET_IDS,
  resolveNovDataDir,
  setModuleEnabled,
  setNovLocale,
  UI_LOCALE_IDS,
} from '../src/core/config.js';
import type { NovConfigSnapshotPayload } from '../src/core/types.js';
import { dispatchNovHook } from '../src/hooks/dispatcher.js';
import { loadRadarBoardReadOnly } from '../src/modules/radar/core.js';
import { createNovServer } from '../src/server/index.js';
import { DICTIONARIES, EN_DICT, resolveUiLocale } from '../ui/src/i18n/index.js';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

class StdioClient {
  private proc;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = '';
  public notifications: Array<{ method: string; params?: unknown }> = [];

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
          } else if (typeof msg.method === 'string') {
            this.notifications.push({ method: msg.method, params: msg.params });
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
      clientInfo: { name: 'agy-nov-test', version: '0.2.0' },
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

async function assertDisabledToolCall(
  client: StdioClient,
  name: string,
  args: Record<string, unknown> = {},
): Promise<void> {
  try {
    const res = await client.request('tools/call', { name, arguments: args });
    assert.equal(res.isError, true, `Expected ${name} to fail with isError:true when disabled`);
    const msg = JSON.stringify(res.content ?? '');
    assert.match(msg, /disabled/i);
  } catch (err) {
    assert.match(err instanceof Error ? err.message : String(err), /disabled/i);
  }
}

test('config defaults, placeholder filtering, 5 presets, 8-language locale persistence & legacy compatibility', () => {
  const tmp = createTempDir('agy-nov-cfg-');
  const legacyTmp = createTempDir('agy-nov-legacy-cfg-');
  try {
    // Unexpanded ${PLUGIN_DATA} must be ignored
    const resolved = resolveNovDataDir('${PLUGIN_DATA}');
    assert.ok(!resolved.includes('${PLUGIN_DATA}'));

    const cfg = loadNovConfigReadOnly(tmp);
    assert.equal(cfg.preset, 'core');
    assert.equal(cfg.locale, 'auto');
    assert.equal(MODULE_IDS.length, 11);
    assert.equal(cfg.modules.review, true);
    assert.equal(cfg.modules.guard, true);
    assert.equal(cfg.modules.xray, true);
    assert.equal(cfg.modules.turbo, false);
    assert.equal(cfg.modules.radar, false);
    assert.equal(cfg.modules.verify, false);
    assert.equal(cfg.modules.worktree, false);
    assert.equal(cfg.modules.canvas, false);
    assert.equal(cfg.modules.mem, false);
    assert.equal(cfg.modules.ops, false);
    assert.equal(cfg.modules.remote, false);
    // Read-only load must not write config.json
    assert.equal(fs.existsSync(path.join(tmp, 'config.json')), false);

    const next = setModuleEnabled(tmp, 'canvas', true);
    assert.equal(next.modules.canvas, true);
    assert.equal(next.preset, 'custom');
    assert.equal(fs.existsSync(path.join(tmp, 'config.json')), true);

    // Verify all 5 presets (module counts, isolation invariants, and exact model tool counts)
    const minimal = applyPresetConfig(tmp, 'minimal');
    assert.equal(minimal.preset, 'minimal');
    assert.equal(MODULE_IDS.filter((m) => minimal.modules[m]).length, 1);
    assert.equal(countEnabledModelTools(minimal.modules), 6); // nov_open + nov_status + 4 guard

    const core = applyPresetConfig(tmp, 'core');
    assert.equal(core.preset, 'core');
    assert.equal(MODULE_IDS.filter((m) => core.modules[m]).length, 3);
    assert.equal(countEnabledModelTools(core.modules), 12);

    const power = applyPresetConfig(tmp, 'power');
    assert.equal(power.preset, 'power');
    assert.equal(MODULE_IDS.filter((m) => power.modules[m]).length, 8);
    assert.equal(power.modules.verify, true);
    assert.equal(power.modules.worktree, true);
    assert.equal(power.modules.remote, false);
    assert.equal(countEnabledModelTools(power.modules), 28);

    const localAll = applyPresetConfig(tmp, 'local-all');
    assert.equal(localAll.preset, 'local-all');
    assert.equal(localAll.modules.remote, false);
    assert.equal(MODULE_IDS.filter((m) => localAll.modules[m]).length, 10);
    assert.equal(countEnabledModelTools(localAll.modules), 35);

    const full = applyPresetConfig(tmp, 'full');
    assert.equal(full.preset, 'full');
    assert.equal(full.modules.remote, true);
    assert.equal(MODULE_IDS.filter((m) => full.modules[m]).length, 11);
    assert.equal(countEnabledModelTools(full.modules), 39);

    // 8-language locale persistence round-trip
    for (const loc of [...UI_LOCALE_IDS, 'auto'] as const) {
      const updated = setNovLocale(tmp, loc);
      assert.equal(updated.locale, loc);
      assert.equal(loadNovConfigReadOnly(tmp).locale, loc);
    }

    // Backward compatibility: v0.1 config.json missing locale and newly added v0.2/v0.3 modules
    fs.writeFileSync(
      path.join(legacyTmp, 'config.json'),
      JSON.stringify({
        schemaVersion: 1,
        preset: 'custom',
        modules: {
          review: true,
          guard: true,
          xray: true,
          canvas: true,
          mem: false,
          remote: false,
        },
        defaultTab: 'canvas',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      'utf8',
    );
    const migrated = loadNovConfigReadOnly(legacyTmp);
    assert.equal(migrated.locale, 'auto');
    assert.equal(migrated.modules.canvas, true);
    assert.equal(migrated.modules.turbo, false);
    assert.equal(migrated.modules.radar, false);
    assert.equal(migrated.modules.verify, false);
    assert.equal(migrated.modules.worktree, false);
    assert.equal(migrated.modules.ops, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(legacyTmp, { recursive: true, force: true });
  }
});

test('unified hook dispatcher respects module switches, turbo SessionStart snapshot & radar lifecycle transitions', async () => {
  const tmp = createTempDir('agy-nov-hook-');
  const ws = createTempDir('agy-nov-hook-ws-');
  const prevNoNotify = process.env.AGY_NOV_NO_NOTIFY;
  process.env.AGY_NOV_NO_NOTIFY = '1';

  try {
    fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'demo-hook-ws' }), 'utf8');
    fs.writeFileSync(path.join(ws, 'src', 'index.ts'), 'export const hello = "world";\n', 'utf8');

    // Default config: turbo=false, radar=false, mem=false, remote=false, guard=true
    const sessionOut = await dispatchNovHook(
      { workspacePaths: [ws], conversationId: 'conv-1' },
      'SessionStart',
      tmp,
    );
    assert.deepEqual(sessionOut, {});
    assert.equal(fs.existsSync(path.join(tmp, 'modules', 'turbo')), false);
    assert.equal(fs.existsSync(path.join(tmp, 'modules', 'mem')), false);

    // Guard blocks dangerous rm -rf / even via camelCase toolCall payload
    const preDanger = await dispatchNovHook(
      {
        hookEventName: 'PreToolUse',
        workspacePaths: [ws],
        toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf /' } },
      },
      'PreToolUse',
      tmp,
    );
    assert.equal(preDanger.decision, 'deny');

    // Disable guard and verify PreToolUse / PostToolUse / Stop keep turbo, radar, mem, remote zero-write
    setModuleEnabled(tmp, 'guard', false);
    const preDisabled = await dispatchNovHook(
      {
        hookEventName: 'PreToolUse',
        workspacePaths: [ws],
        toolCall: { name: 'run_command', args: { CommandLine: 'rm -rf /' } },
      },
      'PreToolUse',
      tmp,
    );
    assert.deepEqual(preDisabled, {});
    await dispatchNovHook(
      {
        hookEventName: 'PostToolUse',
        workspacePaths: [ws],
        conversationId: 'conv-1',
        toolCall: { name: 'read_file', args: {} },
      },
      'PostToolUse',
      tmp,
    );
    const stopOut = await dispatchNovHook(
      { hookEventName: 'Stop', workspacePaths: [ws], conversationId: 'conv-1' },
      'Stop',
      tmp,
    );
    assert.deepEqual(stopOut, { decision: 'allow' });
    for (const inert of ['turbo', 'radar', 'verify', 'worktree', 'mem', 'remote'] as const) {
      assert.equal(
        fs.existsSync(path.join(tmp, 'modules', inert)),
        false,
        `Disabled module ${inert} must not write to disk during hooks`,
      );
    }

    // Enable turbo -> SessionStart injects workspace snapshot with zero disk writes
    setModuleEnabled(tmp, 'turbo', true);
    const turboSession = await dispatchNovHook(
      { workspacePaths: [ws], conversationId: 'conv-turbo' },
      'SessionStart',
      tmp,
    );
    assert.ok(Array.isArray(turboSession.injectSteps) && turboSession.injectSteps.length > 0);
    const serializedSteps = JSON.stringify(turboSession.injectSteps);
    assert.match(serializedSteps, /agy-NOV Turbo Workspace Map/);
    assert.match(serializedSteps, /package\.json|src/);
    assert.equal(
      fs.existsSync(path.join(tmp, 'modules', 'turbo')),
      false,
      'Turbo SessionStart hook must remain strictly read-only with zero disk writes',
    );

    // Enable radar -> PreToolUse -> PostToolUse -> Stop records & transitions session state
    setModuleEnabled(tmp, 'radar', true);
    const radarDir = path.join(tmp, 'modules', 'radar');

    await dispatchNovHook(
      {
        hookEventName: 'PreToolUse',
        workspacePaths: [ws],
        conversationId: 'conv-radar-1',
        toolCall: { name: 'run_command', args: { SafeToAutoRun: false, CommandLine: 'npm test' } },
      },
      'PreToolUse',
      tmp,
    );
    let board = loadRadarBoardReadOnly(radarDir);
    assert.equal(board.sessions['conv-radar-1']?.status, 'awaiting_approval');
    assert.equal(board.sessions['conv-radar-1']?.unread, true);
    assert.equal(board.sessions['conv-radar-1']?.stepCount, 1);
    assert.equal(board.sessions['conv-radar-1']?.lastToolName, 'run_command');

    await dispatchNovHook(
      {
        hookEventName: 'PostToolUse',
        workspacePaths: [ws],
        conversationId: 'conv-radar-1',
        toolCall: { name: 'run_command', args: {} },
      },
      'PostToolUse',
      tmp,
    );
    board = loadRadarBoardReadOnly(radarDir);
    assert.equal(board.sessions['conv-radar-1']?.status, 'running');
    assert.equal(board.sessions['conv-radar-1']?.unread, false);
    assert.equal(board.sessions['conv-radar-1']?.stepCount, 2);
    assert.equal(board.sessions['conv-radar-1']?.lastEvent, 'PostToolUse');

    const radarStop = await dispatchNovHook(
      {
        hookEventName: 'Stop',
        workspacePaths: [ws],
        conversationId: 'conv-radar-1',
        terminationReason: 'All checks passed',
      },
      'Stop',
      tmp,
    );
    assert.deepEqual(radarStop, { decision: 'allow' });
    board = loadRadarBoardReadOnly(radarDir);
    assert.equal(board.sessions['conv-radar-1']?.status, 'completed');
    assert.equal(board.sessions['conv-radar-1']?.unread, true);
    assert.equal(board.sessions['conv-radar-1']?.stepCount, 3);
    assert.equal(board.sessions['conv-radar-1']?.lastEvent, 'Stop');
    assert.ok(typeof board.sessions['conv-radar-1']?.completedAt === 'string');

    // Mem & remote stayed strictly untouched
    assert.equal(fs.existsSync(path.join(tmp, 'modules', 'mem')), false);
    assert.equal(fs.existsSync(path.join(tmp, 'modules', 'remote')), false);
  } finally {
    if (prevNoNotify === undefined) delete process.env.AGY_NOV_NO_NOTIFY;
    else process.env.AGY_NOV_NO_NOTIFY = prevNoNotify;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('bundled MCP stdio server (9 native modules, Zero-CDP): default core exposure, lazy isolation, live toggles, 8-lang locale & UI resource', async () => {
  const bundlePath = path.resolve(process.cwd(), 'dist/server.cjs');
  assert.ok(fs.existsSync(bundlePath), 'dist/server.cjs must exist before running integration tests');

  const tmp = createTempDir('agy-nov-stdio-');
  const client = new StdioClient(bundlePath, [`--data-dir=${tmp}`, '--demo']);
  try {
    await client.init();

    // 1. Default preset = core: expose review/guard/xray + nov_open/nov_status only
    const initialTools = await client.request('tools/list', {});
    const initialNames: string[] = initialTools.tools.map((t: any) => t.name);
    assert.ok(initialNames.includes('nov_open'));
    assert.ok(initialNames.includes('nov_status'));
    assert.ok(initialNames.includes('review_open'));
    assert.ok(initialNames.includes('guard_status'));
    assert.ok(initialNames.includes('xray_analyze_context'));
    assert.ok(!initialNames.includes('turbo_batch_search'));
    assert.ok(!initialNames.includes('radar_get_board'));
    assert.ok(!initialNames.includes('canvas_publish_artifact'));
    assert.ok(!initialNames.includes('mem_remember'));
    assert.ok(!initialNames.includes('ops_list_prompts'));
    assert.ok(!initialNames.includes('remote_status'));

    // 2. Lazy isolation invariant: all 8 default-OFF modules must create ZERO dirs/files on startup
    const defaultOffModules = [
      'turbo',
      'radar',
      'verify',
      'worktree',
      'canvas',
      'mem',
      'ops',
      'remote',
    ] as const;
    for (const mod of defaultOffModules) {
      assert.equal(
        fs.existsSync(path.join(tmp, 'modules', mod)),
        false,
        `Startup must not create modules/${mod} directory when module is OFF`,
      );
    }
    assert.ok(!initialNames.includes('verify_run_checks'));
    assert.ok(!initialNames.includes('worktree_list'));

    // 3. Dynamically enable turbo & ops -> model tools appear immediately in tools/list
    const turboOn = await client.request('tools/call', {
      name: 'nov_app_set_module',
      arguments: { module: 'turbo', enabled: true },
    });
    assert.equal(turboOn.structuredContent.config.modules.turbo, true);

    const opsOn = await client.request('tools/call', {
      name: 'nov_app_set_module',
      arguments: { module: 'ops', enabled: true },
    });
    assert.equal(opsOn.structuredContent.config.modules.ops, true);

    const afterEnable = await client.request('tools/list', {});
    const afterEnableNames: string[] = afterEnable.tools.map((t: any) => t.name);
    assert.ok(afterEnableNames.includes('turbo_batch_search'));
    assert.ok(afterEnableNames.includes('turbo_read_outline'));
    assert.ok(afterEnableNames.includes('turbo_compact_output'));
    assert.ok(afterEnableNames.includes('ops_list_prompts'));
    assert.ok(afterEnableNames.includes('ops_render_prompt'));
    assert.ok(afterEnableNames.includes('ops_audit_workspace'));

    // 4. Persist any of the 8 supported UI languages via nov_app_set_locale
    for (const lang of ['zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'en'] as const) {
      const localeRes = await client.request('tools/call', {
        name: 'nov_app_set_locale',
        arguments: { locale: lang },
      });
      assert.equal(localeRes.structuredContent.config.locale, lang);
    }
    const persisted = JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'), 'utf8'));
    assert.equal(persisted.locale, 'en');

    // 5. Apply minimal preset -> review, xray, turbo, ops hidden immediately
    await client.request('tools/call', {
      name: 'nov_app_apply_preset',
      arguments: { preset: 'minimal' },
    });
    const minimalTools = await client.request('tools/list', {});
    const minimalNames: string[] = minimalTools.tools.map((t: any) => t.name);
    assert.ok(minimalNames.includes('guard_status'));
    assert.ok(!minimalNames.includes('review_open'));
    assert.ok(!minimalNames.includes('xray_analyze_context'));
    assert.ok(!minimalNames.includes('turbo_batch_search'));
    assert.ok(!minimalNames.includes('ops_list_prompts'));

    // 6. UI resource loads cleanly under 10 MiB with MCP App MIME type
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
  assert.equal(manifest.version, '0.3.0');
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

test('isolation regressions: lazy storage (M-4), disabled app_* tool blocking (M-3), mem workspace boundary (M-2), symlink escape (R-1), and truthful remoteRunning (M-5)', async () => {
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
    for (const mod of ['turbo', 'radar', 'canvas', 'mem', 'ops', 'remote'] as const) {
      assert.equal(fs.existsSync(path.join(tmp, 'modules', mod)), false);
    }

    // M-3: Calling app_* on disabled modules must be rejected and must NOT write config.json
    await assertDisabledToolCall(client, 'app_remote_update_channel', { id: 'slack', enabled: false });
    assert.equal(fs.existsSync(path.join(tmp, 'modules', 'remote', 'config.json')), false);

    await assertDisabledToolCall(client, 'app_canvas_list_boards', {});

    // Disable review and confirm app_review_get_diff is also blocked
    await client.request('tools/call', {
      name: 'nov_app_set_module',
      arguments: { module: 'review', enabled: false },
    });
    await assertDisabledToolCall(client, 'app_review_get_diff', {});

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

test('all 8 native UI language dictionaries are 100% key-aligned, placeholder-aligned, and BCP-47 auto-resolution works', () => {
  function collectLeaves(obj: unknown, prefix = ''): Map<string, string> {
    const out = new Map<string, string>();
    assert.ok(obj && typeof obj === 'object' && !Array.isArray(obj), `Expected object at ${prefix || 'root'}`);
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const fullKey = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const sub = collectLeaves(v, fullKey);
        for (const [sk, sv] of sub) out.set(sk, sv);
      } else {
        assert.equal(typeof v, 'string', `Expected string value at i18n key "${fullKey}"`);
        assert.ok((v as string).trim().length > 0, `Empty string at i18n key "${fullKey}"`);
        out.set(fullKey, v as string);
      }
    }
    return out;
  }

  function extractPlaceholders(text: string): string[] {
    const matches = text.match(/\{\{?[A-Za-z0-9_]+\}?\}/g) ?? [];
    return [...new Set(matches)].sort();
  }

  assert.deepEqual(Object.keys(DICTIONARIES).sort(), [...UI_LOCALE_IDS].sort());
  const enLeaves = collectLeaves(EN_DICT);
  const enKeys = [...enLeaves.keys()].sort();

  for (const locale of UI_LOCALE_IDS) {
    const dict = DICTIONARIES[locale];
    const leaves = collectLeaves(dict);
    assert.deepEqual(
      [...leaves.keys()].sort(),
      enKeys,
      `Dictionary "${locale}" keys must match EN_DICT 100%`,
    );
    for (const key of enKeys) {
      assert.deepEqual(
        extractPlaceholders(leaves.get(key)!),
        extractPlaceholders(enLeaves.get(key)!),
        `Placeholder mismatch in "${locale}" for key "${key}"`,
      );
    }
    assert.deepEqual(Object.keys(dict.modules).sort(), [...MODULE_IDS].sort());
    assert.deepEqual(Object.keys(dict.categories).sort(), [...MODULE_CATEGORY_IDS].sort());
    assert.deepEqual(Object.keys(dict.presets).sort(), [...PRESET_IDS].sort());
  }

  // BCP-47 auto-resolution checks across all 8 languages
  assert.equal(resolveUiLocale('auto', 'zh-CN'), 'zh-CN');
  assert.equal(resolveUiLocale('auto', 'zh-SG'), 'zh-CN');
  assert.equal(resolveUiLocale('auto', 'zh-TW'), 'zh-TW');
  assert.equal(resolveUiLocale('auto', 'zh-HK'), 'zh-TW');
  assert.equal(resolveUiLocale('auto', 'zh-Hant'), 'zh-TW');
  assert.equal(resolveUiLocale('auto', 'ja-JP'), 'ja');
  assert.equal(resolveUiLocale('auto', 'ko-KR'), 'ko');
  assert.equal(resolveUiLocale('auto', 'es-ES'), 'es');
  assert.equal(resolveUiLocale('auto', 'fr-FR'), 'fr');
  assert.equal(resolveUiLocale('auto', 'de-DE'), 'de');
  assert.equal(resolveUiLocale('auto', 'pt-BR'), 'en');
  assert.equal(resolveUiLocale('ja', 'en-US'), 'ja');
});

test('offline workbench --smoke --port=0 exits 0 and passes all endpoint checks', async () => {
  const workbenchPath = path.resolve(process.cwd(), 'workbench/server.mjs');
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [workbenchPath, '--smoke', '--port=0'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

  assert.equal(
    result.code,
    0,
    `Workbench smoke failed (exit=${result.code})\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
  assert.match(result.stdout, /smoke pass/i);
  assert.match(result.stdout, /\/=200/);
  assert.match(result.stdout, /\/app=200/);
  assert.match(result.stdout, /\/api\/tools=200/);
});

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 2000,
  stepMs = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  assert.ok(predicate(), `Condition was not met within ${timeoutMs}ms`);
}

test('config.json external live hot-sync: zero dir/file creation when missing, atomic external update, invalid JSON resilience & delete fallback', async () => {
  const parentTmp = createTempDir('agy-nov-hotsync-parent-');
  const ws = createTempDir('agy-nov-hotsync-ws-');
  const missingDataDir = path.join(parentTmp, 'uncreated-data-dir');

  const bundle = createNovServer({
    dataDir: missingDataDir,
    workspaceRoot: ws,
    demoMode: false,
    configPollMs: 30,
  });

  const snapshots: NovConfigSnapshotPayload[] = [];
  const unsubscribe = bundle.subscribeSnapshot((snap) => {
    snapshots.push(snap);
  });

  try {
    // 1. Strict zero-touch guarantee when dataDir & config.json do not exist yet
    assert.equal(fs.existsSync(missingDataDir), false);
    await new Promise((r) => setTimeout(r, 150));
    await bundle.syncConfigFromDisk();
    assert.equal(
      fs.existsSync(missingDataDir),
      false,
      'Poller and read-only sync must never create a missing dataDir or config.json',
    );
    assert.equal(bundle.getConfig().preset, 'core');
    assert.equal(snapshots.length, 0);

    // 2. External process (agy-Sag Settings panel / agy-nov CLI) atomically enables canvas
    setModuleEnabled(missingDataDir, 'canvas', true);
    await waitForCondition(() => bundle.getConfig().modules.canvas === true);
    assert.equal(bundle.getSnapshot().exposedModelTools, 16); // core(12) + canvas(4)
    assert.ok(snapshots.length >= 1, 'Expected snapshot listener to receive external canvas toggle');
    assert.equal(snapshots[snapshots.length - 1]!.config.modules.canvas, true);

    // 3. Transient malformed JSON must be ignored safely without disabling modules or rewriting config.json
    const cfgPath = getConfigPath(missingDataDir);
    const brokenJson = '{"schemaVersion": 1, "modules": { "canvas": ';
    fs.writeFileSync(cfgPath, brokenJson, 'utf8');
    const snapCountBeforeBroken = snapshots.length;
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(bundle.getConfig().modules.canvas, true, 'Invalid JSON must not disable enabled modules');
    assert.equal(snapshots.length, snapCountBeforeBroken);
    assert.equal(
      fs.readFileSync(cfgPath, 'utf8'),
      brokenJson,
      'Invalid JSON must not be overwritten or renamed by the read-only poller',
    );

    // 4. External process atomically applies the power preset
    applyPresetConfig(missingDataDir, 'power');
    await waitForCondition(() => bundle.getConfig().preset === 'power');
    assert.equal(bundle.getConfig().modules.turbo, true);
    assert.equal(bundle.getConfig().modules.radar, true);
    assert.equal(bundle.getConfig().modules.verify, true);
    assert.equal(bundle.getConfig().modules.worktree, true);
    assert.equal(bundle.getConfig().modules.ops, true);
    assert.equal(bundle.getConfig().modules.canvas, false);
    assert.equal(bundle.getSnapshot().exposedModelTools, 28);
    assert.equal(snapshots[snapshots.length - 1]!.config.preset, 'power');

    // 5. Deleting config.json cleanly falls back to default core preset
    fs.rmSync(cfgPath, { force: true });
    await waitForCondition(() => bundle.getConfig().preset === 'core');
    assert.equal(bundle.getSnapshot().exposedModelTools, 12);
    assert.equal(snapshots[snapshots.length - 1]!.config.preset, 'core');
  } finally {
    unsubscribe();
    await bundle.dispose();
    fs.rmSync(parentTmp, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('bundled MCP stdio server live hot-syncs external config.json updates with delta tool notifications and zero initial writes', async () => {
  const bundlePath = path.resolve(process.cwd(), 'dist/server.cjs');
  assert.ok(fs.existsSync(bundlePath), 'dist/server.cjs must exist before running integration tests');

  const parentTmp = createTempDir('agy-nov-stdio-hotsync-');
  const ws = createTempDir('agy-nov-stdio-hotsync-ws-');
  const missingDataDir = path.join(parentTmp, 'lazy-data-dir');
  const client = new StdioClient(bundlePath, [
    `--data-dir=${missingDataDir}`,
    `--workspace=${ws}`,
    '--config-poll-ms=40',
  ]);

  try {
    await client.init();

    // 1. Wait across multiple poll intervals and confirm zero dataDir creation
    await new Promise((r) => setTimeout(r, 160));
    assert.equal(fs.existsSync(missingDataDir), false, 'Stdio server poller must not create missing dataDir');

    const beforeTools = await client.request('tools/list', {});
    const beforeNames: string[] = beforeTools.tools.map((t: any) => t.name);
    assert.ok(!beforeNames.includes('canvas_publish_artifact'));
    assert.ok(!beforeNames.includes('turbo_batch_search'));

    // 2. External process enables canvas -> poller detects signature change & emits delta tools/list_changed
    client.notifications.length = 0;
    setModuleEnabled(missingDataDir, 'canvas', true);
    await waitForCondition(() =>
      client.notifications.some((n) => n.method === 'notifications/tools/list_changed'),
    );

    const listChangedAfterCanvas = client.notifications.filter(
      (n) => n.method === 'notifications/tools/list_changed',
    ).length;
    assert.ok(
      listChangedAfterCanvas > 0 && listChangedAfterCanvas <= 12,
      `Expected delta notifications only for canvas tools, got ${listChangedAfterCanvas}`,
    );

    const afterCanvasTools = await client.request('tools/list', {});
    const afterCanvasNames: string[] = afterCanvasTools.tools.map((t: any) => t.name);
    assert.ok(afterCanvasNames.includes('canvas_publish_artifact'));

    const cfgAfterCanvas = await client.request('tools/call', {
      name: 'nov_app_get_config',
      arguments: {},
    });
    assert.equal(cfgAfterCanvas.structuredContent.config.modules.canvas, true);
    assert.equal(cfgAfterCanvas.structuredContent.exposedModelTools, 16);

    // 3. External process applies power preset -> nov_status immediately syncs even before next poll tick
    applyPresetConfig(missingDataDir, 'power');
    const statusAfterPower = await client.request('tools/call', {
      name: 'nov_status',
      arguments: {},
    });
    assert.equal(statusAfterPower.structuredContent.config.preset, 'power');
    assert.equal(statusAfterPower.structuredContent.exposedModelTools, 28);

    const afterPowerTools = await client.request('tools/list', {});
    const afterPowerNames: string[] = afterPowerTools.tools.map((t: any) => t.name);
    assert.ok(afterPowerNames.includes('turbo_batch_search'));
    assert.ok(afterPowerNames.includes('radar_get_board'));
    assert.ok(afterPowerNames.includes('verify_run_checks'));
    assert.ok(afterPowerNames.includes('worktree_list'));
    assert.ok(afterPowerNames.includes('ops_list_prompts'));
    assert.ok(!afterPowerNames.includes('canvas_publish_artifact'));
  } finally {
    await client.close();
    fs.rmSync(parentTmp, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('v0.3.0 verify Stop hook blocks empty writes via unified dispatcher and CLI statusline stays strictly read-only', async () => {
  const parentTmp = createTempDir('agy-nov-v03-');
  const dataDir = path.join(parentTmp, 'uncreated-data');
  const ws = createTempDir('agy-nov-v03-ws-');
  const cliPath = path.resolve(process.cwd(), 'dist/cli.cjs');

  try {
    // 1. CLI statusline on uncreated dataDir must return valid JSON & create ZERO dirs/files
    const statuslineRes = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [cliPath, 'statusline', '--json', `--data-dir=${dataDir}`],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (c) => (stdout += c.toString('utf8')));
        child.stderr.on('data', (c) => (stderr += c.toString('utf8')));
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout, stderr }));
      },
    );
    assert.equal(statuslineRes.code, 0, statuslineRes.stderr);
    assert.equal(fs.existsSync(dataDir), false, 'statusline must remain strictly read-only');
    const parsed = JSON.parse(statuslineRes.stdout);
    assert.equal(parsed.totalModules, 11);
    assert.equal(parsed.preset, 'core');
    assert.equal(parsed.modelTools, 12);
    assert.match(parsed.line, /agy-NOV core/);

    // 2. Enable verify -> write empty file -> Stop hook denies via unified dispatcher
    setModuleEnabled(dataDir, 'verify', true);
    const emptyFile = path.join(ws, 'stub.ts');
    fs.writeFileSync(emptyFile, '', 'utf8');

    await dispatchNovHook(
      {
        hookEventName: 'PostToolUse',
        conversationId: 'conv-verify-int',
        workspacePaths: [ws],
        toolCall: { name: 'write_file', args: { Path: emptyFile } },
      },
      'PostToolUse',
      dataDir,
    );

    const stopDenied = await dispatchNovHook(
      {
        hookEventName: 'Stop',
        conversationId: 'conv-verify-int',
        workspacePaths: [ws],
      },
      'Stop',
      dataDir,
    );
    assert.equal(stopDenied.decision, 'deny');
    assert.match(stopDenied.reason ?? '', /Verify Gate/i);

    // 3. CLI statusline must accurately report Verify:BLOCKED and blockedStops >= 1
    const blockedStatusRes = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [cliPath, 'statusline', '--json', `--data-dir=${dataDir}`],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (c) => (stdout += c.toString('utf8')));
        child.stderr.on('data', (c) => (stderr += c.toString('utf8')));
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout, stderr }));
      },
    );
    assert.equal(blockedStatusRes.code, 0, blockedStatusRes.stderr);
    const blockedParsed = JSON.parse(blockedStatusRes.stdout);
    assert.equal(blockedParsed.verify?.lastStatus, 'blocked');
    assert.ok((blockedParsed.verify?.blockedStops ?? 0) >= 1);
    assert.match(blockedParsed.line, /Verify:BLOCKED/);
  } finally {
    fs.rmSync(parentTmp, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
