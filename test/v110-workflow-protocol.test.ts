import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  applyPresetConfig,
  getModuleDataDir,
  setModuleEnabled,
} from '../src/core/config.js';
import { dispatchNovHook } from '../src/hooks/dispatcher.js';
import {
  compileActiveSpecWorkflowReadOnly,
  compileSpecToWorkflow,
  saveSpec,
  type SpecDocument,
} from '../src/modules/spec/core.js';
import {
  buildStatusLine,
  parseHostStatusLineStdin,
} from '../src/server/cli.js';
import { createNovServer, NOV_CONTEXT_RESOURCE_URIS } from '../src/server/index.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

function runCliWithStdin(
  args: string[],
  stdinPayload?: string,
  closeStdinImmediately = true,
): Promise<{ code: number | null; stdout: string; stderr: string; elapsedMs: number }> {
  const cliEntry = path.join(REPO_ROOT, 'src', 'server', 'cli.ts');
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.AGY_NOV_STATUSLINE_SEGMENTS;
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
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
    child.on('close', (code) =>
      resolve({ code, stdout, stderr, elapsedMs: Date.now() - started }),
    );
    if (stdinPayload !== undefined) {
      child.stdin.write(stdinPayload);
    }
    if (closeStdinImmediately) {
      child.stdin.end();
    }
  });
}

describe('v1.1.0 Spec DAG -> /run-workflow & /swarm Orchestration Compiler', () => {
  it('compiles a diamond Spec DAG into deterministic parallel waves, redacts secrets, and rejects cycles', async () => {
    const fakeKey = ['sk-proj-', 'SECRETKEY1234567890ABCDEFGHIJ'].join('');
    const ts = '2026-11-27T00:00:00Z';
    const spec: SpecDocument = {
      id: 'spec-diamond',
      title: `Auth Upgrade <private>hidden</private> ${fakeKey}`,
      mode: 'full',
      deltaItems: [],
      status: 'approved',
      goal: 'Ship zero-downtime auth refresh with """triple-quote""" escape\nimport os',
      acceptanceCriteria: ['All unit tests pass'],
      planSteps: ['Step 1: core types', 'Step 2: parallel handlers', 'Step 3: wire server'],
      planMarkdown: '# Auth Upgrade\n',
      revision: 1,
      annotations: [],
      revisions: [],
      enforcePlanBeforeWrite: true,
      requireUiApproval: false,
      createdAt: ts,
      updatedAt: ts,
      tasks: [
        {
          id: 't1',
          title: 'Define shared types',
          description: 'Touch src/auth/types.ts, .env, and ../outside.ts',
          status: 'pending',
          dependsOn: [],
          updatedAt: ts,
        },
        {
          id: 't2b',
          title: 'Implement OAuth handler',
          description: 'Implement src/auth/oauth.ts',
          status: 'pending',
          dependsOn: ['t1'],
          updatedAt: ts,
        },
        {
          id: 't2a',
          title: 'Implement JWT signer',
          description: 'Implement src/auth/jwt.ts',
          status: 'pending',
          dependsOn: ['t1'],
          updatedAt: ts,
        },
        {
          id: 't3',
          title: 'Integrate routes & tests',
          description: 'Update src/server/routes.ts',
          status: 'pending',
          dependsOn: ['t2a', 't2b'],
          updatedAt: ts,
        },
      ],
    };

    const compiled = compileSpecToWorkflow(spec, { target: 'both' });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;

    assert.equal(compiled.waves.length, 3);
    assert.deepEqual(compiled.waves[0].tasks.map((t) => t.id), ['t1']);
    assert.equal(compiled.waves[0].parallelizable, false);
    // Wave 2 has 2 independent tasks sorted deterministically by task id
    assert.deepEqual(compiled.waves[1].tasks.map((t) => t.id), ['t2a', 't2b']);
    assert.equal(compiled.waves[1].parallelizable, true);
    assert.deepEqual(compiled.waves[2].tasks.map((t) => t.id), ['t3']);

    // Sensitive & traversal files filtered; secrets & <private> stripped
    assert.ok(!compiled.waves[0].tasks[0].files.includes('.env'));
    assert.ok(!compiled.waves[0].tasks[0].files.includes('../outside.ts'));
    const workflowPy = compiled.workflowPython ?? '';
    const swarmJson = compiled.swarmPlanJson ?? '';
    assert.equal(workflowPy.includes(fakeKey), false);
    assert.equal(workflowPy.includes('hidden'), false);
    assert.equal(swarmJson.includes(fakeKey), false);
    assert.match(workflowPy, /^phase\("Wave 2:/m);
    assert.match(workflowPy, /await parallel\(\s*WAVE_2_TASKS/);
    assert.match(workflowPy, /nov-blind-reviewer/);
    assert.match(workflowPy, /nov-security-auditor/);
    assert.match(workflowPy, /schema=\{"type": "string"\}/);
    assert.equal(compiled.swarmPlan?.schemaVersion, 1);
    assert.equal(compiled.swarmPlan?.waves.length, 3);

    // Cycle rejection
    const cyclic: SpecDocument = {
      ...spec,
      id: 'spec-cycle',
      tasks: [
        { id: 'a', title: 'A', status: 'pending', dependsOn: ['b'], updatedAt: ts },
        { id: 'b', title: 'B', status: 'pending', dependsOn: ['a'], updatedAt: ts },
      ],
    };
    const cycRes = compileSpecToWorkflow(cyclic);
    assert.equal(cycRes.ok, false);
    if (!cycRes.ok) {
      assert.ok(Array.isArray(cycRes.cycleTaskIds) && cycRes.cycleTaskIds.length >= 2);
    }
  });

  it('supports CLI compile-spec strictly read-only and exposes app_spec_compile_workflow with +0 model tools', async () => {
    await withTempDir('agy-nov-v110-spec-', async (tmpDir) => {
      const missingDir = path.join(tmpDir, 'missing-data');
      const missRes = compileActiveSpecWorkflowReadOnly(missingDir);
      assert.equal(missRes.ok, false);
      assert.equal(fs.existsSync(missingDir), false, 'compileActiveSpecWorkflowReadOnly must write zero files');

      const dataDir = path.join(tmpDir, 'data');
      const specDir = getModuleDataDir(dataDir, 'spec');
      saveSpec(
        specDir,
        {
          id: 'spec-cli-1',
          title: 'CLI Compile Test',
          goal: 'Test CLI compile-spec',
          acceptanceCriteria: ['CLI emits valid JSON'],
          planSteps: ['Step A'],
          tasks: [
            { id: 't1', title: 'Task 1', status: 'pending', dependsOn: [] },
            { id: 't2', title: 'Task 2', status: 'pending', dependsOn: [] },
          ],
        },
        'user',
      );

      const cliRes = await runCliWithStdin([
        'compile-spec',
        '--target=swarm',
        '--json',
        `--data-dir=${dataDir}`,
      ]);
      assert.equal(cliRes.code, 0, cliRes.stderr);
      const parsed = JSON.parse(cliRes.stdout) as { ok: boolean; waves: unknown[]; swarmPlan: { schemaVersion: number } };
      assert.equal(parsed.ok, true);
      assert.equal(parsed.waves.length, 1);
      assert.equal(parsed.swarmPlan.schemaVersion, 1);
    });
  });
});

describe('v1.1.0 PreInvocation Inbound Secret Gate & PostInvocation 6th Official Hook', () => {
  it('blocks high-confidence inbound prompt secrets with terminationBehavior=terminate, zero secret echo, and zero disk writes', async () => {
    await withTempDir('agy-nov-v110-preinv-', async (tmpDir) => {
      const missingDataDir = path.join(tmpDir, 'never-created');
      const fakeAws = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
      const fakeOpenAi = ['sk-proj-', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'].join('');

      // Default preset (core) has guard=true; even without dataDir on disk, inbound secret gate fails closed
      const res = await dispatchNovHook(
        {
          hookEventName: 'PreInvocation',
          lastUserInput: `Please deploy with ${fakeAws} and ${fakeOpenAi}`,
        },
        'PreInvocation',
        missingDataDir,
      );

      assert.equal(res.terminationBehavior, 'terminate');
      assert.equal(typeof res.errorMessage, 'string');
      assert.match(res.errorMessage ?? '', /AWS Access Key ID/);
      assert.equal((res.errorMessage ?? '').includes(fakeAws), false, 'Must never echo raw AWS key');
      assert.equal((res.errorMessage ?? '').includes(fakeOpenAi), false, 'Must never echo raw API key');
      assert.equal(fs.existsSync(missingDataDir), false, 'PreInvocation gate must write ZERO files/dirs');

      // Explicit policy blockInboundPromptSecrets: false disables inbound prompt blocking
      const customDir = path.join(tmpDir, 'custom-data');
      setModuleEnabled(customDir, 'guard', true);
      const guardDir = getModuleDataDir(customDir, 'guard');
      fs.mkdirSync(guardDir, { recursive: true });
      fs.writeFileSync(
        path.join(guardDir, 'policy.json'),
        JSON.stringify({ enabled: true, blockInboundPromptSecrets: false }),
        'utf8',
      );
      const allowedRes = await dispatchNovHook(
        {
          hookEventName: 'PreInvocation',
          lastUserInput: `Testing opt-out with ${fakeAws}`,
        },
        'PreInvocation',
        customDir,
      );
      assert.notEqual(allowedRes.terminationBehavior, 'terminate');

      // Symlink policy.json fails closed (still terminates)
      const symDir = path.join(tmpDir, 'sym-data');
      setModuleEnabled(symDir, 'guard', true);
      const symGuardDir = getModuleDataDir(symDir, 'guard');
      fs.mkdirSync(symGuardDir, { recursive: true });
      const outsidePolicy = path.join(tmpDir, 'outside-policy.json');
      fs.writeFileSync(outsidePolicy, JSON.stringify({ enabled: false, blockInboundPromptSecrets: false }), 'utf8');
      fs.symlinkSync(outsidePolicy, path.join(symGuardDir, 'policy.json'));
      const symRes = await dispatchNovHook(
        {
          hookEventName: 'PreInvocation',
          lastUserInput: `Symlink bypass attempt ${fakeAws}`,
        },
        'PreInvocation',
        symDir,
      );
      assert.equal(symRes.terminationBehavior, 'terminate');
    });
  });

  it('dispatches PostInvocation as the 6th official hook with O(1) short-circuit, freshness window, zero-token receipt, and dist/hook.cjs black-box execution', async () => {
    await withTempDir('agy-nov-v110-postinv-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data');
      // Disable all 3 PostInvocation sources (guard/verify/turbo) while active data exists -> true O(1) short-circuit
      applyPresetConfig(dataDir, 'minimal');
      setModuleEnabled(dataDir, 'guard', false);
      const guardDir = getModuleDataDir(dataDir, 'guard');
      fs.mkdirSync(guardDir, { recursive: true });
      fs.writeFileSync(
        path.join(guardDir, 'audit.json'),
        JSON.stringify([
          {
            id: 'a1',
            decision: 'deny',
            toolName: 'read_file',
            reason: 'Blocked .env',
            timestamp: new Date().toISOString(),
          },
        ]),
        'utf8',
      );
      const offRes = await dispatchNovHook({ hookEventName: 'PostInvocation' }, 'PostInvocation', dataDir);
      assert.deepEqual(offRes, {});

      // Stale historical turbo/verify data (> 5 min old, no dirty files) must NOT pollute empty turns
      applyPresetConfig(dataDir, 'power');
      setModuleEnabled(dataDir, 'guard', false);
      const turboDir = getModuleDataDir(dataDir, 'turbo');
      fs.mkdirSync(turboDir, { recursive: true });
      fs.writeFileSync(
        path.join(turboDir, 'stats.json'),
        JSON.stringify({
          totalCompactions: 3,
          totalSavedTokens: 1200,
          updatedAt: '2020-01-01T00:00:00.000Z',
        }),
        'utf8',
      );
      const verifyDir = getModuleDataDir(dataDir, 'verify');
      fs.mkdirSync(verifyDir, { recursive: true });
      fs.writeFileSync(
        path.join(verifyDir, 'state.json'),
        JSON.stringify({
          sessions: {},
          evidence: [{ outcome: 'fail', passed: false, timestamp: '2020-01-01T00:00:00.000Z' }],
        }),
        'utf8',
      );
      const staleRes = await dispatchNovHook({ hookEventName: 'PostInvocation' }, 'PostInvocation', dataDir);
      assert.deepEqual(staleRes, {});

      // Enable guard + verify + turbo and seed fresh events
      setModuleEnabled(dataDir, 'guard', true);
      fs.writeFileSync(
        path.join(verifyDir, 'state.json'),
        JSON.stringify({
          sessions: { s1: { dirtyFiles: ['src/a.ts', 'src/b.ts'] } },
          evidence: [{ outcome: 'fail', passed: false, timestamp: new Date().toISOString() }],
        }),
        'utf8',
      );
      fs.writeFileSync(
        path.join(turboDir, 'stats.json'),
        JSON.stringify({
          totalCompactions: 2,
          totalSavedTokens: 900,
          updatedAt: new Date().toISOString(),
        }),
        'utf8',
      );

      const liveRes = await dispatchNovHook({ hookEventName: 'PostInvocation' }, 'PostInvocation', dataDir);
      assert.ok(Array.isArray(liveRes.injectSteps) && liveRes.injectSteps.length === 1);
      const step = liveRes.injectSteps[0] as {
        systemMessage?: { systemMessage?: string; metadata?: { user_markdown?: string } };
      };
      assert.equal(step.systemMessage?.systemMessage, '');
      const md = step.systemMessage?.metadata?.user_markdown ?? '';
      assert.match(md, /Guard/i);
      assert.match(md, /Verify/i);
      assert.match(md, /Turbo/i);

      // Black-box execution via built dist/hook.cjs (when present)
      const hookBundle = path.join(REPO_ROOT, 'dist', 'hook.cjs');
      if (fs.existsSync(hookBundle)) {
        const rawOut = execSync('node dist/hook.cjs --event PostInvocation', {
          cwd: REPO_ROOT,
          input: JSON.stringify({ hookEventName: 'PostInvocation' }),
          encoding: 'utf8',
          env: { ...process.env, PLUGIN_DATA: dataDir },
          timeout: 10_000,
        }).trim();
        const parsed = JSON.parse(rawOut) as { injectSteps?: unknown[] };
        assert.ok(Array.isArray(parsed.injectSteps) && parsed.injectSteps.length === 1);
      }
    });
  });
});

describe('v1.1.0 MCP Zero-Tax Read-Only Context Resources & 47-Tool Ceiling', () => {
  it('registers agy-nov://context/{review,mem,turbo,xray}, enforces module gates, redacts <private>/secrets, and keeps <=47 model tools', async () => {
    await withTempDir('agy-nov-v110-res-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data');
      applyPresetConfig(dataDir, 'full');

      const memDir = getModuleDataDir(dataDir, 'mem');
      fs.mkdirSync(memDir, { recursive: true });
      const fakeGh = ['ghp', '_1234567890abcdefghijklmnop123456'].join('');
      fs.writeFileSync(
        path.join(memDir, 'memories.json'),
        JSON.stringify({
          memories: [
            {
              id: 'm1',
              title: `Auth Token Note <private>top-secret</private> ${fakeGh}`,
              content: `Always use PKCE <private>do-not-leak</private>`,
              category: 'decision',
              updatedAt: '2026-11-27T00:00:00Z',
              anchors: [{ filePath: 'src/auth.ts', driftStatus: 'drifted' }],
            },
          ],
        }),
        'utf8',
      );

      const bundle = createNovServer({
        dataDir,
        workspaceRoot: tmpDir,
        demoMode: false,
        exposeAppToolsWithoutUiCapability: false,
      });

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'v110-cli-client', version: '1.1.0' });
      await bundle.server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        // Strict 47-tool ceiling preserved on CLI client without UI capability
        const tools = await client.listTools();
        assert.equal(tools.tools.length, 47, 'Full preset CLI client must expose strictly 47 canonical model tools');

        const resources = await client.listResources();
        const uris = resources.resources.map((r) => r.uri);
        for (const expectedUri of Object.values(NOV_CONTEXT_RESOURCE_URIS)) {
          assert.ok(uris.includes(expectedUri), `Missing MCP context resource ${expectedUri}`);
        }

        // Read enabled mem resource and confirm redaction
        const memRead = await client.readResource({ uri: NOV_CONTEXT_RESOURCE_URIS.mem });
        const memText = (memRead.contents[0] as { text?: string })?.text ?? '';
        assert.equal(memText.includes('top-secret'), false);
        assert.equal(memText.includes('do-not-leak'), false);
        assert.equal(memText.includes(fakeGh), false);
        const memPayload = JSON.parse(memText) as {
          enabled: boolean;
          summary: { totalMemories: number; staleCount: number };
        };
        assert.equal(memPayload.enabled, true);
        assert.equal(memPayload.summary.totalMemories, 1);
        assert.equal(memPayload.summary.staleCount, 1);

        // External process disables mem module on disk -> immediate hot-sync before readResource blocks context
        setModuleEnabled(dataDir, 'mem', false);
        const disabledRead = await client.readResource({ uri: NOV_CONTEXT_RESOURCE_URIS.mem });
        const disabledPayload = JSON.parse(
          (disabledRead.contents[0] as { text?: string })?.text ?? '{}',
        ) as { enabled: boolean };
        assert.equal(disabledPayload.enabled, false);
      } finally {
        await client.close();
        await bundle.dispose();
      }
    });
  });

  it('hardens red-team regressions: symlink state.json rejection, unknown dep interception, comment/NEL/Bidi breakout, Windows path & Stripe sk_live_ detection', async () => {
    await withTempDir('agy-nov-v110-redteam-', async (tmpDir) => {
      // 1. Symlinked state.json rejected by compileActiveSpecWorkflowReadOnly
      const outside = path.join(tmpDir, 'outside.json');
      fs.writeFileSync(
        outside,
        JSON.stringify({
          schemaVersion: 1,
          activeSpecId: 'spec-sym',
          specs: [
            {
              id: 'spec-sym',
              title: 'Symlinked Spec',
              goal: 'Escape test',
              tasks: [{ id: 't1', title: 'Task 1', dependsOn: [], status: 'pending' }],
            },
          ],
        }),
        'utf8',
      );
      const dataDir = path.join(tmpDir, 'data');
      const specDir = getModuleDataDir(dataDir, 'spec');
      fs.mkdirSync(specDir, { recursive: true });
      fs.symlinkSync(outside, path.join(specDir, 'state.json'));
      const symCompile = compileActiveSpecWorkflowReadOnly(dataDir);
      assert.equal(symCompile.ok, false, 'Symlinked spec state.json must be rejected');

      // 2. Disk state.json with unknown dependency or self-dependency is rejected (never silently dropped)
      fs.unlinkSync(path.join(specDir, 'state.json'));
      fs.writeFileSync(
        path.join(specDir, 'state.json'),
        JSON.stringify({
          schemaVersion: 1,
          activeSpecId: 'spec-bad-dep',
          specs: [
            {
              id: 'spec-bad-dep',
              title: 'Bad Dep Spec',
              goal: 'Unknown dep test',
              tasks: [{ id: 't1', title: 'Task 1', dependsOn: ['MISSING_DEP'], status: 'pending' }],
            },
          ],
        }),
        'utf8',
      );
      const badDepRes = compileActiveSpecWorkflowReadOnly(dataDir);
      assert.equal(badDepRes.ok, false, 'Unknown dependency in persisted state.json must fail compilation');

      // 3. Header comment breakout via forged status/mode/revision + NEL/Bidi + ..\, ~user, secrets.yaml file hint bypass
      const forgedSpec = {
        id: 'spec-forge',
        title: 'Title\u0085__import__("os").system("pwn")\u202e',
        mode: 'full\n__import__("os").system("pwn")',
        deltaItems: [],
        status: 'draft\n__import__("os").system("pwn")',
        goal: 'Goal',
        acceptanceCriteria: [],
        planSteps: [],
        planMarkdown: '',
        revision: '1\n__import__("os").system("pwn")',
        annotations: [],
        revisions: [],
        enforcePlanBeforeWrite: true,
        requireUiApproval: false,
        createdAt: '2026-11-27T00:00:00Z',
        updatedAt: '2026-11-27T00:00:00Z',
        tasks: [
          {
            id: 't1',
            title: 'Hints',
            description: '..\\outside/leak.ts ~alice/secret/app.ts config/secrets.yaml src/safe/ok.ts',
            dependsOn: [],
            status: 'pending',
            updatedAt: '2026-11-27T00:00:00Z',
          },
        ],
      } as unknown as SpecDocument;

      const forgedRes = compileSpecToWorkflow(forgedSpec);
      assert.equal(forgedRes.ok, true);
      if (forgedRes.ok) {
        const py = forgedRes.workflowPython ?? '';
        assert.equal(py.includes('\u0085'), false);
        assert.equal(py.includes('\u202e'), false);
        // Header lines must never contain un-commented executable __import__
        for (const line of py.split('\n').slice(0, 8)) {
          assert.ok(line === '' || line.startsWith('#') || line.startsWith('SPEC_'), `Unexpected header line: ${line}`);
        }
        assert.deepEqual(forgedRes.waves[0].tasks[0].files, ['src/safe/ok.ts']);
      }

      // 4. Windows backslash workspace path basename & C1 control stripping in statusline stdin
      const winHost = parseHostStatusLineStdin(
        JSON.stringify({
          model: 'gemini-2.5-pro\x1b[31m\u009b32m',
          workspace: { current_dir: 'C:\\Users\\alice\\SecretRepo\\app' },
        }),
      );
      assert.equal(winHost?.workspaceName, 'app');
      assert.equal((winHost?.model ?? '').includes('\u009b'), false);
      assert.equal((winHost?.workspaceName ?? '').includes('Users'), false);

      // 5. Stripe live key sk_live_ blocked in PreInvocation
      const fakeStripe = ['sk_live_', '1234567890abcdefghijklmnop'].join('');
      const stripeRes = await dispatchNovHook(
        { hookEventName: 'PreInvocation', lastUserInput: `stripe key ${fakeStripe}` },
        'PreInvocation',
        path.join(tmpDir, 'absent-stripe'),
      );
      assert.equal(stripeRes.terminationBehavior, 'terminate');
      assert.equal((stripeRes.errorMessage ?? '').includes(fakeStripe), false);
    });
  });
});

describe('v1.1.0 Antigravity CLI statusLine stdin JSON Fusion', () => {
  it('merges live CLI stdin JSON (model, context_window, cost, quota, subagents) and never hangs on open stdin', async () => {
    const parsed = parseHostStatusLineStdin(
      JSON.stringify({
        model: { id: 'gemini-2.5-pro', display_name: 'Gemini 2.5 Pro' },
        context_window: { used_percentage: 64 },
        cost: { total_cost_usd: 0.37 },
        quota: { remaining_percentage: 82 },
        subagents: { running: 2 },
        workspace: { current_dir: '/tmp/my-secret-root/project-alpha' },
      }),
    );
    assert.ok(parsed);
    assert.equal(parsed.model, 'Gemini 2.5 Pro');
    assert.equal(parsed.contextPercent, 64);
    assert.equal(parsed.costUsd, 0.37);
    assert.equal(parsed.quotaRemainingPercent, 82);
    assert.equal(parsed.runningSubagents, 2);
    assert.equal(parsed.workspaceName, 'project-alpha');

    await withTempDir('agy-nov-v110-sl-', async (tmpDir) => {
      const missingDir = path.join(tmpDir, 'absent');
      const snap = buildStatusLine(missingDir, false, {
        segments: ['brand', 'model', 'context', 'burn', 'quota', 'radar'],
        hostStdin: parsed,
      });
      assert.match(snap.line, /Model:Gemini 2\.5 Pro/);
      assert.match(snap.line, /Ctx\[███░░\]64%/);
      assert.match(snap.line, /5h:\$0\.37/);
      assert.match(snap.line, /Quota:82%/);
      assert.match(snap.line, /Radar:2run/);
      assert.equal(fs.existsSync(missingDir), false, 'statusline must remain 100% read-only');

      // Live process stdin pipe test
      const piped = await runCliWithStdin(
        ['statusline', '--json', `--data-dir=${missingDir}`],
        JSON.stringify({
          model: 'gemini-2.5-flash',
          context_window: { used_percentage: 42 },
          cost: { total_cost_usd: 0.12 },
          quota: { remaining_percentage: 91 },
        }),
        true,
      );
      assert.equal(piped.code, 0, piped.stderr);
      const outSnap = JSON.parse(piped.stdout) as {
        host?: { model?: string; contextPercent?: number; quotaRemainingPercent?: number };
        line: string;
      };
      assert.equal(outSnap.host?.model, 'gemini-2.5-flash');
      assert.equal(outSnap.host?.contextPercent, 42);
      assert.equal(outSnap.host?.quotaRemainingPercent, 91);
      assert.match(outSnap.line, /gemini-2\.5-flash/);
      assert.match(outSnap.line, /Quota:91%/);

      // Open stdin that never closes must return rapidly via bounded timeout (never hang)
      const openPipe = await runCliWithStdin(
        ['statusline', '--compact', `--data-dir=${missingDir}`],
        undefined,
        false,
      );
      assert.equal(openPipe.code, 0, openPipe.stderr);
      assert.ok(openPipe.elapsedMs < 4000, `statusline stalled on open stdin (${openPipe.elapsedMs}ms)`);
      assert.match(openPipe.stdout, /NOV 3\/13 \(12t\)/);
    });
  });
});
