import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  applyPresetConfig,
  countEnabledModelTools,
  createDefaultConfig,
  getConfigPath,
  getModuleDataDir,
  MAX_CONFIG_IMPORT_BYTES,
  saveNovConfig,
  setModuleEnabled,
} from '../src/core/config.js';
import {
  buildFeedSnapshot,
  getFeedSnapshotPath,
  MAX_FEED_SNAPSHOT_BYTES,
  redactFeedText,
  writeFeedSnapshotIfDataDirExists,
} from '../src/core/feed.js';
import { dispatchNovHook } from '../src/hooks/dispatcher.js';
import { createNovServer } from '../src/server/index.js';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function connectInMemory(
  opts: Parameters<typeof createNovServer>[0],
): Promise<{
  bundle: ReturnType<typeof createNovServer>;
  client: Client;
  close: () => Promise<void>;
}> {
  const bundle = createNovServer({ configPollMs: 0, ...opts });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-v07-client', version: '0.7.0' });
  await bundle.server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    bundle,
    client,
    close: async () => {
      await client.close();
      await bundle.dispose();
    },
  };
}

function listModelVisibleTools(
  tools: Array<{ name: string; _meta?: Record<string, unknown> }>,
): string[] {
  return tools
    .filter((t) => {
      const ui = t._meta?.ui as { visibility?: unknown } | undefined;
      const vis = ui?.visibility;
      const isAppOnly = Array.isArray(vis) && vis.length === 1 && vis[0] === 'app';
      return !isAppOnly;
    })
    .map((t) => t.name);
}

test('feed snapshot: missing dataDir stays 100% read-only with zero dir/file creation and rejects symlink targets', () => {
  const parent = createTempDir('agy-nov-v07-missing-');
  const missingDir = path.join(parent, 'never-created');
  const realDir = path.join(parent, 'real-dir');
  const linkDir = path.join(parent, 'symlink-dir');
  const outsideFile = path.join(parent, 'outside.json');

  try {
    const cfg = createDefaultConfig();
    const snap = buildFeedSnapshot(missingDir, cfg);
    assert.equal(snap.schemaVersion, 1);
    assert.equal(snap.version, '0.7.0');
    assert.equal(snap.totalModules, 13);
    assert.equal(snap.toolBudgetLimit, 100);
    assert.equal(snap.enabledCount, 3);
    assert.equal(snap.exposedModelTools, 12);
    assert.equal(snap.startupView, 'hub');
    assert.equal(fs.existsSync(missingDir), false, 'buildFeedSnapshot must not create missing dataDir');

    const wroteMissing = writeFeedSnapshotIfDataDirExists(missingDir, cfg);
    assert.equal(wroteMissing, false);
    assert.equal(fs.existsSync(missingDir), false, 'writeFeedSnapshotIfDataDirExists must not create missing dataDir');

    // Reject symlink rootDataDir
    fs.mkdirSync(realDir, { recursive: true });
    fs.symlinkSync(realDir, linkDir);
    assert.equal(writeFeedSnapshotIfDataDirExists(linkDir, cfg), false);
    assert.equal(fs.existsSync(getFeedSnapshotPath(realDir)), false);

    // Reject symlink feed-snapshot.json
    fs.writeFileSync(outsideFile, '{"keep":true}\n', 'utf8');
    fs.symlinkSync(outsideFile, getFeedSnapshotPath(realDir));
    assert.equal(writeFeedSnapshotIfDataDirExists(realDir, cfg), false);
    assert.equal(fs.readFileSync(outsideFile, 'utf8'), '{"keep":true}\n');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('feed snapshot: strict redaction, <=64KB cap, explicit modules/* paths, and aggregated summaries/alerts', () => {
  const dataDir = createTempDir('agy-nov-v07-feed-');
  try {
    // Dynamically assemble synthetic secret patterns (zero static secret literals in source)
    const fakeStripeKey = ['sk', 'live', 'AbCdEf0123456789XyZ'].join('_');
    const fakeGhToken = ['ghp', '9876543210abcdefghijklm'].join('_');
    const fakeBearer = ['Bearer', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig1234567890'].join(' ');
    const fakeWebhook = ['https://hooks.slack.com', 'services', 'T0001', 'B0002', 'secret999'].join('/');
    const fakePem = [
      ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' '),
      'MIIEowIBAAKCAQEAtokenBodySecretData',
      ['-----END', 'RSA PRIVATE KEY-----'].join(' '),
    ].join('\n');
    const fakeEnv = [['OPENAI', 'API', 'KEY'].join('_'), 'mySuperSecretEnvValue999'].join('=');
    const fakePin = ['pairingPin', '847291'].join('=');

    // Verify linear-time O(n) redaction performance & completeness
    const adversarial = `${'a'.repeat(50_000)} ${fakeStripeKey} ${fakeWebhook} ${fakeEnv} ${fakePin}`;
    const t0 = Date.now();
    const redactedLarge = redactFeedText(adversarial, 400);
    assert.ok(Date.now() - t0 < 500, 'Linear O(n) redaction must complete rapidly without ReDoS');
    assert.ok(!redactedLarge.includes(fakeStripeKey));
    assert.ok(!redactedLarge.includes('secret999'));
    assert.ok(!redactedLarge.includes('mySuperSecretEnvValue999'));
    assert.ok(!redactedLarge.includes('847291'));

    // Prepare module files under standard modules/<id>/ layout
    const writeModFile = (mod: string, file: string, data: unknown) => {
      const dir = path.join(dataDir, 'modules', mod);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2), 'utf8');
    };

    const nowIso = new Date().toISOString();
    writeModFile('guard', 'audit.json', [
      {
        id: 'evt_1',
        timestamp: nowIso,
        decision: 'deny',
        toolName: 'run_command',
        summary: `Blocked leak ${fakeStripeKey} ${fakeGhToken} ${fakeBearer} ${fakeWebhook} ${fakePem} ${fakeEnv} ${fakePin} <private>hidden</private>`,
      },
      {
        id: 'evt_2',
        timestamp: new Date(Date.now() - 10_000).toISOString(),
        decision: 'ask',
        toolName: 'run_command',
        summary: 'Confirm migration script',
      },
    ]);

    writeModFile('spec', 'state.json', {
      schemaVersion: 1,
      activeSpecId: 'spec-auth',
      specs: [
        {
          id: 'spec-auth',
          title: `Auth Plan ${fakeStripeKey}`,
          status: 'draft',
          enforcePlanBeforeWrite: true,
          tasks: [
            { id: 't1', title: 'Done step', dependsOn: [], status: 'done' },
            { id: 't2', title: 'Ready step', dependsOn: ['t1'], status: 'pending' },
            { id: 't3', title: 'Waiting step', dependsOn: ['t2'], status: 'pending' },
          ],
        },
      ],
    });

    writeModFile('verify', 'state.json', {
      schemaVersion: 1,
      policy: { enforceOnStop: true },
      sessions: {
        s1: { dirtyFiles: ['src/a.ts', 'src/b.ts'] },
        s2: { dirtyFiles: ['src/b.ts', 'src/c.ts'] },
      },
      evidence: [{ id: 'ev1', outcome: 'blocked', passed: false }],
    });

    writeModFile('mem', 'memories.json', [
      { id: 'm1', title: 'Fresh', drifted: false },
      { id: 'm2', title: 'Stale flag', stale: true },
      { id: 'm3', title: 'Anchor drifted', anchors: [{ filePath: 'a.ts', driftStatus: 'drifted' }] },
    ]);

    writeModFile('radar', 'status-capsule.json', {
      schemaVersion: 1,
      counts: { running: 2, awaiting_approval: 1, stalled: 1, unread: 3 },
    });

    writeModFile('xray', 'live-state.json', {
      activeModel: 'gemini-2.5-pro',
      peakContextTokens: 82_000,
      estimatedCostUsd: 0.67,
    });

    const cfg = applyPresetConfig(dataDir, 'local-all');
    const wrote = writeFeedSnapshotIfDataDirExists(dataDir, cfg, { estimatedTotalTools: 80 });
    assert.equal(wrote, true);

    const feedPath = getFeedSnapshotPath(dataDir);
    assert.equal(fs.existsSync(feedPath), true);
    const rawFeed = fs.readFileSync(feedPath, 'utf8');
    assert.ok(Buffer.byteLength(rawFeed, 'utf8') <= MAX_FEED_SNAPSHOT_BYTES);

    // Ensure zero secret leakage anywhere in serialized feed-snapshot.json
    for (const secretFragment of [
      fakeStripeKey,
      fakeGhToken,
      'sig1234567890',
      'secret999',
      'MIIEowIBAAKCAQEAtokenBodySecretData',
      'mySuperSecretEnvValue999',
      '847291',
      'hidden',
    ]) {
      assert.equal(rawFeed.includes(secretFragment), false, `Feed leaked secret fragment: ${secretFragment}`);
    }

    const parsed = JSON.parse(rawFeed);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.version, '0.7.0');
    assert.deepEqual(parsed.paths, {
      configFile: 'config.json',
      feedFile: 'feed-snapshot.json',
      modulesRoot: 'modules',
      moduleFiles: {
        opsPrompts: 'modules/ops/prompts.json',
        guardAudit: 'modules/guard/audit.json',
        radarCapsule: 'modules/radar/status-capsule.json',
        memStore: 'modules/mem/memories.json',
        specState: 'modules/spec/state.json',
        verifyState: 'modules/verify/state.json',
        xrayLive: 'modules/xray/live-state.json',
      },
    });

    assert.equal(parsed.summary.guard.blockedCount, 1);
    assert.equal(parsed.summary.guard.askCount, 1);
    assert.equal(parsed.summary.guard.lastEvent.decision, 'deny');
    assert.equal(parsed.summary.spec.writeLockActive, true);
    assert.equal(parsed.summary.spec.doneTasks, 1);
    assert.equal(parsed.summary.spec.totalTasks, 3);
    assert.equal(parsed.summary.spec.readyTasks, 1);
    assert.equal(parsed.summary.verify.enforceOnStop, true);
    assert.equal(parsed.summary.verify.lastStatus, 'blocked');
    assert.equal(parsed.summary.verify.dirtyFilesCount, 3);
    assert.equal(parsed.summary.mem.totalMemories, 3);
    assert.equal(parsed.summary.mem.staleCount, 2);
    assert.equal(parsed.summary.radar.runningCount, 2);
    assert.equal(parsed.summary.radar.awaitingCount, 1);
    assert.equal(parsed.summary.radar.stalledCount, 1);
    assert.equal(parsed.summary.radar.unreadCount, 3);
    assert.equal(parsed.summary.xray.activeModel, 'gemini-2.5-pro');
    assert.equal(parsed.summary.xray.peakContextTokens, 82_000);
    assert.equal(parsed.summary.xray.estimatedCostUsd, 0.67);
    assert.equal(parsed.summary.turbo.enabled, true);
    assert.equal(parsed.summary.remote.enabled, false);
    assert.equal(parsed.summary.remote.running, false);

    assert.ok(Array.isArray(parsed.alerts));
    assert.ok(parsed.alerts.length > 0 && parsed.alerts.length <= 6);
    const alertCodes = new Set(parsed.alerts.map((a: { code: string }) => a.code));
    assert.ok(alertCodes.has('GUARD_BLOCKED'));
    assert.ok(alertCodes.has('VERIFY_STOP_BLOCKED'));
    assert.ok(alertCodes.has('SPEC_WRITE_LOCK'));
    assert.ok(alertCodes.has('MEM_STALE_DRIFT'));
    assert.ok(alertCodes.has('TOOL_BUDGET_HIGH'));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('PreInvocation hook: O(1) short-circuit when modules off, zero-token user_markdown receipts when triggered, never terminates or writes', async () => {
  const parent = createTempDir('agy-nov-v07-preinv-');
  const missingDir = path.join(parent, 'missing-data');
  const dataDir = path.join(parent, 'live-data');

  try {
    // 1. Missing dataDir with default core config (guard=on, spec=off, mem=off): returns {} and creates zero dirs/files
    const resMissing = await dispatchNovHook({ hookEventName: 'PreInvocation' }, 'PreInvocation', missingDir);
    assert.deepEqual(resMissing, {});
    assert.equal(fs.existsSync(missingDir), false, 'PreInvocation must never create missing dataDir');

    // 2. All three modules OFF -> strict O(1) short-circuit returning {} even when files exist
    setModuleEnabled(dataDir, 'guard', false);
    setModuleEnabled(dataDir, 'spec', false);
    setModuleEnabled(dataDir, 'mem', false);

    const writeMod = (mod: string, file: string, content: unknown) => {
      const dir = path.join(dataDir, 'modules', mod);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), JSON.stringify(content, null, 2), 'utf8');
    };

    const fakeSecret = ['sk', 'test', '99887766554433221100'].join('_');
    writeMod('spec', 'state.json', {
      schemaVersion: 1,
      activeSpecId: 'spec-lock',
      specs: [
        {
          id: 'spec-lock',
          title: 'Checkout Refactor',
          status: 'draft',
          enforcePlanBeforeWrite: true,
          tasks: [],
        },
      ],
    });
    writeMod('mem', 'memories.json', [{ id: 'm-stale', title: 'API Note', stale: true }]);
    writeMod('guard', 'audit.json', [
      {
        id: 'evt-recent',
        timestamp: new Date().toISOString(),
        decision: 'deny',
        toolName: 'read_file',
        summary: `Blocked ${fakeSecret} in .env`,
      },
      {
        id: 'evt-old',
        timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        decision: 'deny',
        toolName: 'run_command',
        summary: 'Old expired denial',
      },
    ]);

    const resOff = await dispatchNovHook({ hookEventName: 'PreInvocation' }, 'PreInvocation', dataDir);
    assert.deepEqual(resOff, {});

    // 3. Enable spec, mem, guard -> returns zero-token systemMessage:"" + metadata.user_markdown
    setModuleEnabled(dataDir, 'spec', true);
    setModuleEnabled(dataDir, 'mem', true);
    setModuleEnabled(dataDir, 'guard', true);

    const resOn = await dispatchNovHook({ hookEventName: 'PreInvocation' }, 'PreInvocation', dataDir);
    assert.equal(resOn.terminationBehavior, undefined, 'PreInvocation must never terminate invocation');
    assert.equal(resOn.decision, undefined);
    assert.ok(Array.isArray(resOn.injectSteps) && resOn.injectSteps.length === 1);

    const step = resOn.injectSteps[0] as {
      systemMessage: { systemMessage: string; metadata: { user_markdown: string } };
    };
    assert.equal(step.systemMessage.systemMessage, '', 'systemMessage must be empty string for zero model token tax');
    const md = step.systemMessage.metadata.user_markdown;
    assert.match(md, /Spec Write Lock/);
    assert.match(md, /Checkout Refactor/);
    assert.match(md, /Memory Drift/);
    assert.match(md, /Guard Blocked/);
    assert.match(md, /read_file/);
    assert.equal(md.includes(fakeSecret), false, 'PreInvocation guard receipt must redact secrets');

    // 4. Expired guard deny (>5 min) does not trigger guard receipt
    writeMod('guard', 'audit.json', [
      {
        id: 'evt-expired',
        timestamp: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
        decision: 'deny',
        toolName: 'run_command',
        summary: 'Expired event',
      },
    ]);
    setModuleEnabled(dataDir, 'spec', false);
    setModuleEnabled(dataDir, 'mem', false);
    const resExpired = await dispatchNovHook({ hookEventName: 'PreInvocation' }, 'PreInvocation', dataDir);
    assert.deepEqual(resExpired, {});

    // 5. PostToolUse & Stop refresh feed-snapshot.json when dataDir exists (best-effort)
    const feedPath = getFeedSnapshotPath(dataDir);
    fs.rmSync(feedPath, { force: true });
    const postOut = await dispatchNovHook(
      { hookEventName: 'PostToolUse', toolCall: { name: 'read_file', args: {} } },
      'PostToolUse',
      dataDir,
    );
    assert.deepEqual(postOut, {});
    assert.equal(fs.existsSync(feedPath), true, 'PostToolUse hook should best-effort refresh feed-snapshot.json when dataDir exists');

    fs.rmSync(feedPath, { force: true });
    const stopOut = await dispatchNovHook(
      { hookEventName: 'Stop', conversationId: 'conv-v07' },
      'Stop',
      dataDir,
    );
    assert.deepEqual(stopOut, { decision: 'allow' });
    assert.equal(fs.existsSync(feedPath), true, 'Stop hook should best-effort refresh feed-snapshot.json when dataDir exists');
    const refreshedFeed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));
    assert.equal(refreshedFeed.schemaVersion, 1);
    assert.equal(refreshedFeed.version, '0.7.0');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('v0.7.0 App-only hub/config tools & strict 47-tool model budget invariant', async () => {
  const parent = createTempDir('agy-nov-v07-mcp-');
  const ws = createTempDir('agy-nov-v07-ws-');
  const missingDataDir = path.join(parent, 'lazy-data');
  const demoDataDir = path.join(parent, 'demo-data');

  const liveConn = await connectInMemory({
    dataDir: missingDataDir,
    workspaceRoot: ws,
    demoMode: false,
  });
  const demoConn = await connectInMemory({
    dataDir: demoDataDir,
    workspaceRoot: ws,
    demoMode: true,
  });

  try {
    // 1. Verify nov_app_get_hub_state stays zero-write in live & demo modes
    const hubLive = await liveConn.client.callTool({ name: 'nov_app_get_hub_state', arguments: {} });
    assert.equal(fs.existsSync(missingDataDir), false, 'nov_app_get_hub_state must not create missing dataDir');
    const hubLiveSc = hubLive.structuredContent as {
      snapshot: { exposedModelTools: number; config: { startupView?: string } };
      feed: { schemaVersion: number; version: string; paths: { feedFile: string } };
      teamPreset: { found: boolean };
    };
    assert.equal(hubLiveSc.snapshot.exposedModelTools, 12);
    assert.equal(hubLiveSc.snapshot.config.startupView, 'hub');
    assert.equal(hubLiveSc.feed.schemaVersion, 1);
    assert.equal(hubLiveSc.feed.version, '0.7.0');
    assert.equal(hubLiveSc.feed.paths.feedFile, 'feed-snapshot.json');
    assert.equal(hubLiveSc.teamPreset.found, false);

    // Demo mode nov_app_get_hub_state performs strictly zero writes (no config.json, no feed-snapshot.json)
    assert.equal(fs.existsSync(getConfigPath(demoDataDir)), false);
    assert.equal(fs.existsSync(getFeedSnapshotPath(demoDataDir)), false);
    const demoEntriesBefore = fs.existsSync(demoDataDir) ? fs.readdirSync(demoDataDir).sort() : [];
    const hubDemo = await demoConn.client.callTool({ name: 'nov_app_get_hub_state', arguments: {} });
    const demoEntriesAfter = fs.existsSync(demoDataDir) ? fs.readdirSync(demoDataDir).sort() : [];
    assert.deepEqual(demoEntriesAfter, demoEntriesBefore, 'demo nov_app_get_hub_state must perform zero disk writes');
    assert.equal(fs.existsSync(getConfigPath(demoDataDir)), false);
    assert.equal(fs.existsSync(getFeedSnapshotPath(demoDataDir)), false);
    const hubDemoSc = hubDemo.structuredContent as {
      feed: { summary: { guard: { blockedCount: number }; xray: { activeModel: string | null } } };
    };
    assert.ok(hubDemoSc.feed.summary.guard.blockedCount > 0);
    assert.ok(hubDemoSc.feed.summary.xray.activeModel);

    // 2. Verify startupView persistence & nov_open routing (hub / last / settings)
    const openDefault = await liveConn.client.callTool({ name: 'nov_open', arguments: {} });
    assert.equal((openDefault.structuredContent as { novModule: string }).novModule, 'hub');

    const openSettings = await liveConn.client.callTool({
      name: 'nov_open',
      arguments: { module: 'settings' },
    });
    assert.equal((openSettings.structuredContent as { novModule: string }).novModule, 'settings');

    const setLast = await liveConn.client.callTool({
      name: 'nov_app_set_startup_view',
      arguments: { startupView: 'last' },
    });
    assert.equal(
      (setLast.structuredContent as { config: { startupView: string } }).config.startupView,
      'last',
    );
    const openLast = await liveConn.client.callTool({ name: 'nov_open', arguments: {} });
    assert.equal((openLast.structuredContent as { novModule: string }).novModule, 'review');

    // 3. Export sanitized config
    const exportRes = await liveConn.client.callTool({ name: 'nov_app_export_config', arguments: {} });
    const exported = exportRes.structuredContent as {
      schemaVersion: number;
      sanitized: boolean;
      config: { preset: string; startupView: string; locale: string; modules: Record<string, boolean> };
    };
    assert.equal(exported.schemaVersion, 1);
    assert.equal(exported.sanitized, true);
    assert.equal(exported.config.startupView, 'last');
    assert.equal(JSON.stringify(exported).includes(missingDataDir), false);

    // 4. Import config security checks
    // 4a. Prototype pollution rejected
    const protoImport = await liveConn.client.callTool({
      name: 'nov_app_import_config',
      arguments: { json: '{"__proto__":{"polluted":true},"modules":{"guard":true}}' },
    });
    assert.equal(protoImport.isError, true);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);

    const nestedProto = await liveConn.client.callTool({
      name: 'nov_app_import_config',
      arguments: { json: '{"modules":{"constructor":true}}' },
    });
    assert.equal(nestedProto.isError, true);

    // 4b. Oversized payload rejected (> 32 KiB)
    const oversizedJson = JSON.stringify({
      modules: { guard: true },
      padding: 'x'.repeat(MAX_CONFIG_IMPORT_BYTES + 128),
    });
    let oversizedRejected = false;
    try {
      const res = await liveConn.client.callTool({
        name: 'nov_app_import_config',
        arguments: { json: oversizedJson },
      });
      oversizedRejected = Boolean(res.isError);
    } catch {
      oversizedRejected = true;
    }
    assert.equal(oversizedRejected, true, 'Oversized config import must be rejected');

    // 4c. Valid import requesting remote:true must force remote:false with safety warning
    const safeImport = await liveConn.client.callTool({
      name: 'nov_app_import_config',
      arguments: {
        json: JSON.stringify({
          config: {
            modules: {
              review: true,
              guard: true,
              xray: true,
              turbo: true,
              ops: true,
              remote: true,
              unknown_mod: true,
            },
            locale: 'ja',
            startupView: 'hub',
          },
        }),
      },
    });
    assert.notEqual(safeImport.isError, true);
    const importSc = safeImport.structuredContent as {
      ok: boolean;
      warnings: string[];
      snapshot: {
        remoteRunning: boolean;
        config: { locale: string; startupView: string; modules: Record<string, boolean> };
      };
    };
    assert.equal(importSc.ok, true);
    assert.equal(importSc.snapshot.config.modules.turbo, true);
    assert.equal(importSc.snapshot.config.modules.ops, true);
    assert.equal(importSc.snapshot.config.modules.remote, false, 'Imported remote:true must be kept OFF for safety');
    assert.equal(importSc.snapshot.remoteRunning, false);
    assert.equal(importSc.snapshot.config.locale, 'ja');
    assert.ok(importSc.warnings.some((w) => /remote/i.test(w)));
    assert.ok(importSc.warnings.some((w) => /unknown_mod/i.test(w)));

    // 5. Reset config requires confirm:true and restores default core preset
    let resetWithoutConfirmRejected = false;
    try {
      const badReset = await liveConn.client.callTool({
        name: 'nov_app_reset_config',
        arguments: { confirm: false },
      });
      resetWithoutConfirmRejected = Boolean(badReset.isError);
    } catch {
      resetWithoutConfirmRejected = true;
    }
    assert.equal(resetWithoutConfirmRejected, true, 'nov_app_reset_config must reject confirm:false');

    const resetRes = await liveConn.client.callTool({
      name: 'nov_app_reset_config',
      arguments: { confirm: true },
    });
    const resetSc = resetRes.structuredContent as {
      enabledCount: number;
      exposedModelTools: number;
      config: { preset: string; locale: string; startupView: string };
    };
    assert.equal(resetSc.config.preset, 'core');
    assert.equal(resetSc.config.locale, 'auto');
    assert.equal(resetSc.config.startupView, 'hub');
    assert.equal(resetSc.enabledCount, 3);
    assert.equal(resetSc.exposedModelTools, 12);
    assert.equal(fs.existsSync(getConfigPath(missingDataDir)), true);
    assert.equal(fs.existsSync(getFeedSnapshotPath(missingDataDir)), true);

    // 6. Strict model tool count verification across all 5 presets (ZERO tool bloat: full === 47)
    const expectedByPreset: Array<[string, number]> = [
      ['minimal', 6],
      ['core', 12],
      ['power', 32],
      ['local-all', 43],
      ['full', 47],
    ];
    for (const [preset, expectedCount] of expectedByPreset) {
      await liveConn.client.callTool({
        name: 'nov_app_apply_preset',
        arguments: { preset },
      });
      const listed = await liveConn.client.listTools();
      const modelTools = listModelVisibleTools(
        listed.tools as Array<{ name: string; _meta?: Record<string, unknown> }>,
      );
      assert.equal(
        modelTools.length,
        expectedCount,
        `Preset "${preset}" must expose exactly ${expectedCount} model-visible tools`,
      );
      assert.equal(countEnabledModelTools(liveConn.bundle.getConfig().modules), expectedCount);

      // Verify all 5 new control tools stay strictly hidden from the model
      for (const appOnlyName of [
        'nov_app_get_hub_state',
        'nov_app_set_startup_view',
        'nov_app_export_config',
        'nov_app_import_config',
        'nov_app_reset_config',
      ]) {
        assert.equal(
          modelTools.includes(appOnlyName),
          false,
          `${appOnlyName} must remain app-only and hidden from model`,
        );
      }
    }

    // Return to core so remote runtime shuts down cleanly
    await liveConn.client.callTool({ name: 'nov_app_apply_preset', arguments: { preset: 'core' } });
  } finally {
    await liveConn.close();
    await demoConn.close();
    fs.rmSync(parent, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('CLI doctor reports Feed Snapshot status strictly read-only without creating missing dataDir', async () => {
  const parent = createTempDir('agy-nov-v07-doctor-');
  const missingDataDir = path.join(parent, 'doctor-uncreated');

  try {
    const cliEntry = path.resolve(process.cwd(), 'src/server/cli.ts');
    const out = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', cliEntry, 'doctor', `--data-dir=${missingDataDir}`],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => {
          stdout += d.toString('utf8');
        });
        child.stderr.on('data', (d) => {
          stderr += d.toString('utf8');
        });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout, stderr }));
      },
    );
    assert.match(out.stdout, /agy-NOV Doctor \(v0\.7\.0/);
    assert.match(out.stdout, /Feed Snapshot:/);
    assert.equal(fs.existsSync(missingDataDir), false, 'CLI doctor must never create missing dataDir');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('red-team regressions: O(n) webhook ReDoS immunity, PGP/pairing/Authorization redaction, surrogate safety, parent symlink block, and PreInvocation markdown escaping', async () => {
  // 1. Repeated https:// without whitespace must stay strictly linear O(n) (<200ms for 300KB)
  const repeatHttps = 'https://'.repeat(37_500);
  const t0 = Date.now();
  redactFeedText(repeatHttps, 180);
  assert.ok(Date.now() - t0 < 250, 'Webhook URL redaction must remain strictly O(n) without ReDoS');

  // 2. PGP private key blocks, pairing_code / pairCode, and custom Authorization schemes
  const pgpBlock = [
    ['-----BEGIN', 'PGP PRIVATE KEY BLOCK-----'].join(' '),
    'SecretBodyPayload12345',
    ['-----END', 'PGP PRIVATE KEY BLOCK-----'].join(' '),
  ].join('\n');
  const combo = [
    pgpBlock,
    ['pairing_code', '839201'].join('='),
    ['pairing code', '948102'].join(': '),
    ['pairCode', '774411'].join(': '),
    ['Authorization', 'Token myCustomSecretValue12345'].join(': '),
  ].join(' | ');
  const safeCombo = redactFeedText(combo, 500);
  assert.equal(safeCombo.includes('SecretBodyPayload12345'), false);
  assert.equal(safeCombo.includes('839201'), false);
  assert.equal(safeCombo.includes('948102'), false);
  assert.equal(safeCombo.includes('774411'), false);
  assert.equal(safeCombo.includes('myCustomSecretValue12345'), false);

  // 3. UTF-16 surrogate-safe truncation (never leaves a lone high surrogate)
  const emojiRes = redactFeedText('😀'.repeat(100), 180);
  for (let i = 0; i < emojiRes.length; i += 1) {
    const c = emojiRes.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = emojiRes.charCodeAt(i + 1);
      assert.ok(next >= 0xdc00 && next <= 0xdfff, 'Truncated string must not contain lone high surrogate');
    }
  }

  // 4. Ancestor symlink parent must be rejected by writeFeedSnapshotIfDataDirExists
  const base = createTempDir('agy-nov-v07-symlink-parent-');
  try {
    const realParent = path.join(base, 'real-parent');
    const realData = path.join(realParent, 'data');
    fs.mkdirSync(realData, { recursive: true });
    const symlinkParent = path.join(base, 'symlink-parent');
    fs.symlinkSync(realParent, symlinkParent);
    const wroteThroughSymlink = writeFeedSnapshotIfDataDirExists(
      path.join(symlinkParent, 'data'),
      createDefaultConfig(),
    );
    assert.equal(wroteThroughSymlink, false);
    assert.equal(fs.existsSync(path.join(realData, 'feed-snapshot.json')), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }

  // 5. PreInvocation user_markdown must escape Markdown links/images and strip BiDi overrides
  const mdDataDir = createTempDir('agy-nov-v07-md-esc-');
  try {
    saveNovConfig(mdDataDir, {
      ...createDefaultConfig(),
      modules: { ...createDefaultConfig().modules, spec: true, guard: true },
    });
    const specDir = getModuleDataDir(mdDataDir, 'spec');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, 'state.json'),
      JSON.stringify({
        schemaVersion: 1,
        activeSpecId: 's-md',
        specs: [
          {
            id: 's-md',
            title: 'Plan ![track](https://evil.test/p.png) [Click](https://evil.test)',
            status: 'draft',
            enforcePlanBeforeWrite: true,
          },
        ],
      }),
    );
    const guardDir = getModuleDataDir(mdDataDir, 'guard');
    fs.mkdirSync(guardDir, { recursive: true });
    fs.writeFileSync(
      path.join(guardDir, 'audit.json'),
      JSON.stringify([
        {
          decision: 'deny',
          toolName: 'run` [fake](https://evil.test) `cmd',
          reason: '![img](https://evil.test/x.gif) \u202eReversed',
          timestamp: new Date().toISOString(),
        },
      ]),
    );
    const res = await dispatchNovHook({ hookEventName: 'PreInvocation' }, 'PreInvocation', mdDataDir);
    const step = (res.injectSteps as Array<{ systemMessage?: { systemMessage?: string; metadata?: { user_markdown?: string } } }>)[0];
    assert.equal(step?.systemMessage?.systemMessage, '');
    const md = step?.systemMessage?.metadata?.user_markdown ?? '';
    assert.equal(md.includes('![track]('), false);
    assert.equal(md.includes('[Click]('), false);
    assert.equal(md.includes('[fake]('), false);
    assert.equal(md.includes('\u202e'), false);
  } finally {
    fs.rmSync(mdDataDir, { recursive: true, force: true });
  }
});
