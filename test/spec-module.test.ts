import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getModuleDataDir, MODULE_CATALOG } from '../src/core/config.js';
import { normalizeHookPayload } from '../src/core/utils.js';
import {
  buildSpecStateView,
  computeSpecTaskViews,
  getSpecStatePath,
  loadSpecStateReadOnly,
  saveSpec,
  setSpecStatus,
  updateSpecTask,
  validateTaskDag,
  type SpecDocumentView,
  type SpecStateView,
  type SpecTaskView,
} from '../src/modules/spec/core.js';
import {
  handleSpecPreToolHook,
  handleSpecSessionStartHook,
  SPEC_WRITE_LOCK_TOOLS,
} from '../src/modules/spec/hook.js';
import { registerSpecModule } from '../src/modules/spec/register.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

describe('Spec Flow — zero-write defaults & demoMode isolation', () => {
  it('performs zero disk writes on read-only load, idle hooks, registration, and read-only MCP calls', async () => {
    await withTempDir('agy-nov-spec-zerowrite-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data-must-not-exist');
      const moduleDataDir = getModuleDataDir(dataDir, 'spec');

      const initial = loadSpecStateReadOnly(moduleDataDir);
      assert.equal(initial.activeSpecId, null);
      assert.deepEqual(initial.specs, []);
      assert.equal(fs.existsSync(dataDir), false);

      // Hooks when state.json is absent must return {} and never create directories
      const preRes = handleSpecPreToolHook(
        normalizeHookPayload(
          { toolName: 'write_file', toolInput: { Path: path.join(tmpDir, 'a.ts') } },
          'PreToolUse',
        ),
        dataDir,
      );
      assert.deepEqual(preRes, {});

      const startRes = handleSpecSessionStartHook(
        normalizeHookPayload({ workspaceRoot: tmpDir }, 'SessionStart'),
        dataDir,
      );
      assert.deepEqual(startRes, {});
      assert.equal(fs.existsSync(dataDir), false);

      // Register module and call read-only tools -> still zero disk writes
      const server = new McpServer(
        { name: 'spec-zerowrite-test', version: '0.4.0' },
        { capabilities: { tools: { listChanged: true } } },
      );
      registerSpecModule(server, { dataDir, workspaceRoot: tmpDir, demoMode: false }, 'ui://agy-nov/app.html');
      assert.equal(fs.existsSync(dataDir), false);

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'spec-zerowrite-client', version: '0.4.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        const modelGet = await client.callTool({ name: 'spec_get_state', arguments: {} });
        assert.equal(modelGet.isError, undefined);
        const modelView = modelGet.structuredContent as unknown as SpecStateView;
        assert.equal(modelView.mode, 'live');
        assert.equal(modelView.activeSpecId, null);
        assert.equal(modelView.activeSpec, null);
        assert.equal(modelView.writeLockActive, false);

        const appGet = await client.callTool({ name: 'app_spec_get_state', arguments: {} });
        assert.equal(appGet.isError, undefined);

        // Failed validation write attempt must also keep disk untouched
        const badSave = await client.callTool({
          name: 'spec_create_or_update',
          arguments: {
            title: 'Cyclic Spec',
            goal: 'Should fail validation',
            tasks: [
              { id: 'a', title: 'A', dependsOn: ['b'] },
              { id: 'b', title: 'B', dependsOn: ['a'] },
            ],
          },
        });
        assert.equal(badSave.isError, true);
        assert.equal(fs.existsSync(dataDir), false);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });

  it('serves 2 realistic in-memory demo specs (approved 4-task DAG + draft with write lock) with zero disk writes', async () => {
    await withTempDir('agy-nov-spec-demo-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'demo-data-absent');
      const uiUri = 'ui://agy-nov/app.html';
      const server = new McpServer(
        { name: 'spec-demo-test', version: '0.4.0' },
        { capabilities: { tools: { listChanged: true } } },
      );

      registerSpecModule(server, { dataDir, workspaceRoot: tmpDir, demoMode: true }, uiUri);
      assert.equal(fs.existsSync(dataDir), false);

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'spec-demo-client', version: '0.4.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        const stateCall = await client.callTool({ name: 'app_spec_get_state', arguments: {} });
        assert.equal(stateCall.isError, undefined);
        const view = stateCall.structuredContent as unknown as SpecStateView;
        assert.equal(view.mode, 'demo');
        assert.equal(view.specs.length, 2);

        const approvedSummary = view.specs.find((s) => s.status === 'approved');
        const draftSummary = view.specs.find((s) => s.status === 'draft');
        assert.ok(approvedSummary, 'Expected an approved demo spec');
        assert.ok(draftSummary, 'Expected a draft demo spec');
        assert.equal(approvedSummary.totalTasks, 4);
        assert.equal(draftSummary.enforcePlanBeforeWrite, true);

        // Active spec is the approved 4-task DAG
        assert.ok(view.activeSpec);
        assert.equal(view.activeSpec.status, 'approved');
        assert.equal(view.activeSpec.tasks.length, 4);
        assert.equal(view.writeLockActive, false);

        // Verify computed DAG states & depths on the 4-task approved spec
        const byId = new Map(view.activeSpec.tasks.map((t) => [t.id, t]));
        assert.equal(byId.get('schema-migration')?.depth, 0);
        assert.equal(byId.get('schema-migration')?.computedState, 'done');
        assert.equal(byId.get('rotation-service')?.depth, 1);
        assert.equal(byId.get('rotation-service')?.computedState, 'in_progress');
        assert.equal(byId.get('audit-telemetry')?.depth, 1);
        assert.equal(byId.get('audit-telemetry')?.computedState, 'ready');
        assert.equal(byId.get('integration-canary')?.depth, 2);
        assert.equal(byId.get('integration-canary')?.computedState, 'waiting_deps');

        // Mutate state in demoMode (switch active to draft, update task, save new spec) -> zero disk writes
        const switchCall = await client.callTool({
          name: 'app_spec_set_status',
          arguments: {
            specId: draftSummary.id,
            status: 'draft',
            setActive: true,
          },
        });
        assert.equal(switchCall.isError, undefined);
        const switchedState = (switchCall.structuredContent as { state: SpecStateView }).state;
        assert.equal(switchedState.activeSpecId, draftSummary.id);
        assert.equal(switchedState.writeLockActive, true);

        const taskCall = await client.callTool({
          name: 'app_spec_update_task',
          arguments: {
            specId: draftSummary.id,
            taskId: 'hmac-guard',
            status: 'in_progress',
            note: 'Working in demo mode',
          },
        });
        assert.equal(taskCall.isError, undefined);

        const saveCall = await client.callTool({
          name: 'app_spec_save',
          arguments: {
            title: 'In-memory Demo Spec 3',
            goal: 'Ensure mutations never touch disk in demoMode',
            tasks: [{ id: 'd1', title: 'Demo step 1' }],
          },
        });
        assert.equal(saveCall.isError, undefined);
        assert.equal(fs.existsSync(dataDir), false);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});

describe('Spec Flow — DAG validation, cycle detection & topological depth', () => {
  it('rejects invalid task IDs, duplicate IDs, unknown dependencies, self-cycles, and multi-hop cycles', () => {
    // Invalid task IDs
    const badIds = ['', '   ', ' t1 ', 'bad id', 'a/b', '../escape', 'x'.repeat(49)];
    for (const badId of badIds) {
      const res = validateTaskDag([{ id: badId, dependsOn: [] }]);
      assert.equal(res.valid, false, `Expected invalid task id "${badId}" to be rejected`);
    }

    // Duplicate IDs
    const dupRes = validateTaskDag([
      { id: 't1', dependsOn: [] },
      { id: 't1', dependsOn: [] },
    ]);
    assert.equal(dupRes.valid, false);
    assert.match(dupRes.error, /duplicate/i);

    // Unknown dependency
    const unknownRes = validateTaskDag([
      { id: 't1', dependsOn: ['nonexistent'] },
    ]);
    assert.equal(unknownRes.valid, false);
    assert.match(unknownRes.error, /unknown task "nonexistent"/i);

    // Self-cycle
    const selfCycle = validateTaskDag([{ id: 't1', dependsOn: ['t1'] }]);
    assert.equal(selfCycle.valid, false);
    assert.match(selfCycle.error, /self-cycle|depend on itself/i);

    // 2-node cycle
    const twoCycle = validateTaskDag([
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] },
    ]);
    assert.equal(twoCycle.valid, false);
    assert.match(twoCycle.error, /cycle/i);

    // 3-node cycle attached to a valid root
    const threeCycle = validateTaskDag([
      { id: 'root', dependsOn: [] },
      { id: 'n1', dependsOn: ['root', 'n3'] },
      { id: 'n2', dependsOn: ['n1'] },
      { id: 'n3', dependsOn: ['n2'] },
    ]);
    assert.equal(threeCycle.valid, false);
    assert.match(threeCycle.error, /cycle/i);
  });

  it('computes exact topological depths, unmetDeps, and computedState on a diamond DAG', () => {
    const now = new Date().toISOString();
    const views = computeSpecTaskViews([
      { id: 't0', title: 'Root', dependsOn: [], status: 'done', updatedAt: now },
      { id: 't1', title: 'Branch A', dependsOn: ['t0'], status: 'pending', updatedAt: now },
      { id: 't2', title: 'Branch B', dependsOn: ['t0'], status: 'done', updatedAt: now },
      { id: 't3', title: 'Deep B', dependsOn: ['t2'], status: 'pending', updatedAt: now },
      { id: 't4', title: 'Join', dependsOn: ['t1', 't3'], status: 'pending', updatedAt: now },
      { id: 't5', title: 'Blocked', dependsOn: ['t0'], status: 'blocked', updatedAt: now },
    ]);

    const map = new Map(views.map((v) => [v.id, v]));
    assert.equal(map.get('t0')?.depth, 0);
    assert.equal(map.get('t0')?.computedState, 'done');

    assert.equal(map.get('t1')?.depth, 1);
    assert.equal(map.get('t1')?.computedState, 'ready');
    assert.deepEqual(map.get('t1')?.unmetDeps, []);

    assert.equal(map.get('t2')?.depth, 1);
    assert.equal(map.get('t2')?.computedState, 'done');

    assert.equal(map.get('t3')?.depth, 2);
    assert.equal(map.get('t3')?.computedState, 'ready');

    // Join depends on t1 (depth 1) and t3 (depth 2) -> longest path depth = 3
    assert.equal(map.get('t4')?.depth, 3);
    assert.equal(map.get('t4')?.computedState, 'waiting_deps');
    assert.deepEqual(map.get('t4')?.unmetDeps, ['t1', 't3']);

    assert.equal(map.get('t5')?.depth, 1);
    assert.equal(map.get('t5')?.computedState, 'blocked');
  });
});

describe('Spec Flow — step-skipping prevention & requireUiApproval guardrail', () => {
  it('blocks advancing tasks with unmet prerequisites to in_progress/done while permitting blocked/pending rollback', async () => {
    await withTempDir('agy-nov-spec-dag-progress-', (tmpDir) => {
      const moduleDataDir = getModuleDataDir(tmpDir, 'spec');
      const created = saveSpec(
        moduleDataDir,
        {
          id: 'spec-dag-1',
          title: 'Ordered DAG',
          goal: 'Verify dependency enforcement',
          tasks: [
            { id: 'step-1', title: 'Foundation' },
            { id: 'step-2', title: 'Middle', dependsOn: ['step-1'] },
            { id: 'step-3', title: 'Finish', dependsOn: ['step-2'] },
          ],
        },
        'model',
      );
      assert.equal(created.ok, true);

      // Approve spec so write lock is unlocked and DAG dependency checks are exercised directly
      const approved = setSpecStatus(
        moduleDataDir,
        { specId: 'spec-dag-1', status: 'approved' },
        'user',
      );
      assert.equal(approved.ok, true);

      // Jumping to in_progress on step-2 while step-1 is pending -> rejected with unmet dep listed
      const jumpInProgress = updateSpecTask(
        moduleDataDir,
        {
          specId: 'spec-dag-1',
          taskId: 'step-2',
          status: 'in_progress',
        },
        'model',
      );
      assert.equal(jumpInProgress.ok, false);
      assert.match(jumpInProgress.error, /step-1/);

      // Jumping to done on step-3 while step-2 is pending -> rejected with unmet dep listed
      const jumpDone = updateSpecTask(
        moduleDataDir,
        {
          specId: 'spec-dag-1',
          taskId: 'step-3',
          status: 'done',
        },
        'model',
      );
      assert.equal(jumpDone.ok, false);
      assert.match(jumpDone.error, /step-2/);

      // Marking blocked or resetting pending is always permitted even with unmet deps
      const markBlocked = updateSpecTask(
        moduleDataDir,
        {
          specId: 'spec-dag-1',
          taskId: 'step-2',
          status: 'blocked',
          note: 'Waiting on API schema decision',
        },
        'model',
      );
      assert.equal(markBlocked.ok, true);
      assert.equal(markBlocked.task.computedState, 'blocked');

      const resetPending = updateSpecTask(
        moduleDataDir,
        {
          specId: 'spec-dag-1',
          taskId: 'step-2',
          status: 'pending',
          note: '',
        },
        'model',
      );
      assert.equal(resetPending.ok, true);
      assert.equal(resetPending.task.computedState, 'waiting_deps');

      // Complete step-1 -> step-2 becomes ready -> advance to in_progress & done
      const s1Done = updateSpecTask(
        moduleDataDir,
        {
          specId: 'spec-dag-1',
          taskId: 'step-1',
          status: 'done',
        },
        'model',
      );
      assert.equal(s1Done.ok, true);
      const step2AfterS1 = s1Done.spec.tasks.find((t) => t.id === 'step-2');
      assert.equal(step2AfterS1?.computedState, 'ready');

      const s2InProgress = updateSpecTask(
        moduleDataDir,
        {
          specId: 'spec-dag-1',
          taskId: 'step-2',
          status: 'in_progress',
        },
        'model',
      );
      assert.equal(s2InProgress.ok, true);
      assert.equal(s2InProgress.task.computedState, 'in_progress');

      // Trying to bypass updateSpecTask via saveSpec to mark step-3 done early is also rejected
      const bypassSave = saveSpec(
        moduleDataDir,
        {
          id: 'spec-dag-1',
          title: 'Ordered DAG',
          goal: 'Verify dependency enforcement',
          tasks: [
            { id: 'step-1', title: 'Foundation', status: 'done' },
            { id: 'step-2', title: 'Middle', dependsOn: ['step-1'], status: 'in_progress' },
            { id: 'step-3', title: 'Finish', dependsOn: ['step-2'], status: 'done' },
          ],
        },
        'model',
      );
      assert.equal(bypassSave.ok, false);
      assert.match(bypassSave.error, /step-2/);

      const s2Done = updateSpecTask(
        moduleDataDir,
        {
          specId: 'spec-dag-1',
          taskId: 'step-2',
          status: 'done',
        },
        'model',
      );
      assert.equal(s2Done.ok, true);

      const s3Done = updateSpecTask(
        moduleDataDir,
        {
          specId: 'spec-dag-1',
          taskId: 'step-3',
          status: 'done',
        },
        'model',
      );
      assert.equal(s3Done.ok, true);
      assert.equal(s3Done.task.computedState, 'done');

      // Rolling step-1 back to pending is allowed and subsequent title edits still succeed
      const rollback = updateSpecTask(
        moduleDataDir,
        {
          specId: 'spec-dag-1',
          taskId: 'step-1',
          status: 'pending',
        },
        'model',
      );
      assert.equal(rollback.ok, true);

      const editTitleAfterRollback = saveSpec(
        moduleDataDir,
        {
          id: 'spec-dag-1',
          title: 'Ordered DAG (Revised)',
          goal: 'Verify dependency enforcement',
          tasks: rollback.spec.tasks.map((t) => ({
            id: t.id,
            title: t.title,
            dependsOn: t.dependsOn,
            status: t.status,
          })),
        },
        'user',
      );
      assert.equal(editTitleAfterRollback.ok, true);
    });
  });

  it('blocks model self-approval & guardrail downgrade when requireUiApproval=true, while allowing UI approval', async () => {
    await withTempDir('agy-nov-spec-ui-approval-', (tmpDir) => {
      const moduleDataDir = getModuleDataDir(tmpDir, 'spec');

      // Default requireUiApproval is false -> model can approve
      const normalSpec = saveSpec(
        moduleDataDir,
        {
          id: 'spec-normal',
          title: 'Normal Spec',
          goal: 'Standard model approval',
          tasks: [{ id: 'a1', title: 'Task A1' }],
        },
        'model',
      );
      assert.equal(normalSpec.ok, true);
      assert.equal(normalSpec.spec.requireUiApproval, false);

      const modelOk = setSpecStatus(
        moduleDataDir,
        { specId: 'spec-normal', status: 'approved', approvalNote: 'LGTM' },
        'model',
      );
      assert.equal(modelOk.ok, true);
      assert.equal(modelOk.spec.approvedBy, 'model');

      // Strict UI-approval spec -> model cannot approve or downgrade guardrails
      const guardedSpec = saveSpec(
        moduleDataDir,
        {
          id: 'spec-guarded',
          title: 'Production DB Migration',
          goal: 'Require explicit user sign-off in UI',
          enforcePlanBeforeWrite: true,
          requireUiApproval: true,
          setActive: true,
          tasks: [{ id: 'm1', title: 'Draft migration SQL' }],
        },
        'user',
      );
      assert.equal(guardedSpec.ok, true);
      assert.equal(guardedSpec.spec.requireUiApproval, true);
      assert.equal(buildSpecStateView(guardedSpec.state, 'live').writeLockActive, true);

      // Model self-approval must be rejected
      const modelDenied = setSpecStatus(
        moduleDataDir,
        { specId: 'spec-guarded', status: 'approved' },
        'model',
      );
      assert.equal(modelDenied.ok, false);
      assert.match(modelDenied.error, /requireUiApproval|Spec Flow/i);

      // Model attempting to disable requireUiApproval via spec_create_or_update must be rejected
      const downgradeApproval = saveSpec(
        moduleDataDir,
        {
          id: 'spec-guarded',
          title: 'Production DB Migration',
          goal: 'Try disabling requireUiApproval',
          requireUiApproval: false,
        },
        'model',
      );
      assert.equal(downgradeApproval.ok, false);

      // Model attempting to disable enforcePlanBeforeWrite while requireUiApproval=true must be rejected
      const downgradeWriteLock = saveSpec(
        moduleDataDir,
        {
          id: 'spec-guarded',
          title: 'Production DB Migration',
          goal: 'Try disabling write lock',
          enforcePlanBeforeWrite: false,
        },
        'model',
      );
      assert.equal(downgradeWriteLock.ok, false);

      // Model attempting to switch active spec away from locked draft must be rejected
      const switchAway = saveSpec(
        moduleDataDir,
        {
          id: 'spec-decoy',
          title: 'Decoy Spec',
          goal: 'Try bypassing write lock by switching active spec',
          enforcePlanBeforeWrite: false,
          setActive: true,
        },
        'model',
      );
      assert.equal(switchAway.ok, false);

      // App UI (actor: 'user') can approve and unlock write gate
      const userApproved = setSpecStatus(
        moduleDataDir,
        {
          specId: 'spec-guarded',
          status: 'approved',
          approvalNote: 'Reviewed in UI by engineer',
        },
        'user',
      );
      assert.equal(userApproved.ok, true);
      assert.equal(userApproved.spec.status, 'approved');
      assert.equal(userApproved.spec.approvedBy, 'user');
      assert.equal(userApproved.spec.approvalNote, 'Reviewed in UI by engineer');
      assert.equal(buildSpecStateView(userApproved.state, 'live').writeLockActive, false);
    });
  });
});

describe('Spec Flow — PreToolUse write lock & SessionStart recall hooks', () => {
  it('denies all workspace write tools in DRAFT+writeLock, allows read-only/spec_*/nov_* tools, and unlocks once approved (strictly read-only)', async () => {
    await withTempDir('agy-nov-spec-hooks-', (tmpDir) => {
      const moduleDataDir = getModuleDataDir(tmpDir, 'spec');
      const created = saveSpec(
        moduleDataDir,
        {
          id: 'spec-lock-test',
          title: 'API Gateway Refactor',
          goal: 'Keep code read-only until spec is approved',
          enforcePlanBeforeWrite: true,
          tasks: [{ id: 't1', title: 'Write design doc' }],
        },
        'user',
      );
      assert.equal(created.ok, true);

      const statePath = getSpecStatePath(moduleDataDir);
      const mtimeBefore = fs.statSync(statePath).mtimeMs;

      // Every write tool (including namespaced forms) must be denied with exact reason format
      const expectedReason =
        '[agy-NOV Spec Flow] Active spec "API Gateway Refactor" is in DRAFT with write lock enabled. Approve the spec in agy-NOV Spec Flow before editing workspace files.';

      for (const tool of SPEC_WRITE_LOCK_TOOLS) {
        const res = handleSpecPreToolHook(
          normalizeHookPayload({ toolName: tool, toolInput: { path: 'src/a.ts' } }, 'PreToolUse'),
          tmpDir,
        );
        assert.equal(res.decision, 'deny', `Expected ${tool} to be denied`);
        assert.equal(res.reason, expectedReason);
      }

      // Short tool aliases & case/namespace variants must also be denied
      for (const shortAlias of [
        'write',
        'edit',
        'multi_edit',
        'notebook_edit',
        'Write',
        'Edit',
        'default_api:write',
        'default_api:edit_file',
        'mcp/notebook_edit',
      ]) {
        const aliasDeny = handleSpecPreToolHook(
          normalizeHookPayload({ toolName: shortAlias }, 'PreToolUse'),
          tmpDir,
        );
        assert.equal(aliasDeny.decision, 'deny', `Expected ${shortAlias} to be denied`);
        assert.equal(aliasDeny.reason, expectedReason);
      }

      // Read-only tools & spec_*/nov_* tools must always be allowed
      for (const allowedTool of [
        'read_file',
        'grep_search',
        'list_dir',
        'spec_get_state',
        'spec_create_or_update',
        'spec_approve',
        'spec_update_task',
        'nov_open',
        'nov_status',
      ]) {
        const res = handleSpecPreToolHook(
          normalizeHookPayload({ toolName: allowedTool }, 'PreToolUse'),
          tmpDir,
        );
        assert.deepEqual(res, {}, `Expected ${allowedTool} to pass through`);
      }

      // Hook must never touch state.json on disk
      assert.equal(fs.statSync(statePath).mtimeMs, mtimeBefore);

      // After approving spec -> write tools are allowed
      const approved = setSpecStatus(
        moduleDataDir,
        { specId: 'spec-lock-test', status: 'approved' },
        'user',
      );
      assert.equal(approved.ok, true);

      for (const tool of ['write_file', 'edit_file', 'apply_patch', 'delete_file']) {
        const res = handleSpecPreToolHook(
          normalizeHookPayload({ toolName: tool }, 'PreToolUse'),
          tmpDir,
        );
        assert.deepEqual(res, {}, `Expected ${tool} to be allowed after approval`);
      }

      // Draft with enforcePlanBeforeWrite=false also allows writes
      const unlockedDraft = setSpecStatus(
        moduleDataDir,
        { specId: 'spec-lock-test', status: 'draft', enforcePlanBeforeWrite: false },
        'user',
      );
      assert.equal(unlockedDraft.ok, true);
      assert.deepEqual(
        handleSpecPreToolHook(normalizeHookPayload({ toolName: 'write_file' }, 'PreToolUse'), tmpDir),
        {},
      );
    });
  });

  it('injects concise active spec summary and up to first 5 ready tasks on SessionStart without writing disk', async () => {
    await withTempDir('agy-nov-spec-session-start-', (tmpDir) => {
      const moduleDataDir = getModuleDataDir(tmpDir, 'spec');
      const created = saveSpec(
        moduleDataDir,
        {
          id: 'spec-recall',
          title: 'Search Indexing Pipeline',
          goal: 'Test SessionStart ready task recall',
          enforcePlanBeforeWrite: true,
          tasks: [
            { id: 'r1', title: 'Ready Task 1' },
            { id: 'r2', title: 'Ready Task 2' },
            { id: 'r3', title: 'Ready Task 3' },
            { id: 'r4', title: 'Ready Task 4' },
            { id: 'r5', title: 'Ready Task 5' },
            { id: 'r6', title: 'Ready Task 6 (overflow)' },
            { id: 'r7', title: 'Ready Task 7 (overflow)' },
            { id: 'w1', title: 'Waiting Task', dependsOn: ['r1'] },
          ],
        },
        'user',
      );
      assert.equal(created.ok, true);

      const statePath = getSpecStatePath(moduleDataDir);
      const mtimeBefore = fs.statSync(statePath).mtimeMs;

      const startOut = handleSpecSessionStartHook(
        normalizeHookPayload({ workspaceRoot: tmpDir }, 'SessionStart'),
        tmpDir,
      );
      assert.ok(Array.isArray(startOut.injectSteps) && startOut.injectSteps.length === 1);

      const step = startOut.injectSteps[0] as { systemMessage?: { systemMessage?: string } };
      const text = step.systemMessage?.systemMessage ?? '';
      assert.match(text, /Search Indexing Pipeline/);
      assert.match(text, /DRAFT/);
      assert.match(text, /Write Lock: ENABLED/);
      assert.match(text, /0\/8 done/);
      assert.match(text, /7 ready/);
      // Includes first 5 ready tasks, omits 6th & 7th ready tasks and waiting task
      for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) {
        assert.match(text, new RegExp(`\\[${id}\\]`));
      }
      assert.doesNotMatch(text, /\[r6\]/);
      assert.doesNotMatch(text, /\[r7\]/);
      assert.doesNotMatch(text, /\[w1\]/);
      assert.equal(fs.statSync(statePath).mtimeMs, mtimeBefore);

      // Completed or archived specs should not inject SessionStart steps
      setSpecStatus(moduleDataDir, { specId: 'spec-recall', status: 'completed' }, 'user');
      assert.deepEqual(
        handleSpecSessionStartHook(
          normalizeHookPayload({ workspaceRoot: tmpDir }, 'SessionStart'),
          tmpDir,
        ),
        {},
      );

      // Corrupt state.json must fail-open on both hooks without rewriting disk
      fs.writeFileSync(statePath, '{ invalid json', 'utf8');
      const corruptMtime = fs.statSync(statePath).mtimeMs;
      assert.deepEqual(
        handleSpecPreToolHook(normalizeHookPayload({ toolName: 'write_file' }, 'PreToolUse'), tmpDir),
        {},
      );
      assert.deepEqual(
        handleSpecSessionStartHook(
          normalizeHookPayload({ workspaceRoot: tmpDir }, 'SessionStart'),
          tmpDir,
        ),
        {},
      );
      assert.equal(fs.statSync(statePath).mtimeMs, corruptMtime);
    });
  });
});

describe('Spec Flow — McpServer 4+4 tool alignment & end-to-end tool calls', () => {
  it('registers exact 4 model tools aligned with MODULE_CATALOG + 4 app-only tools with exemptReadOnlyAppTools', async () => {
    await withTempDir('agy-nov-spec-mcp-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data');
      const uiUri = 'ui://agy-nov/app.html';
      const server = new McpServer(
        { name: 'agy-nov-spec-test', version: '0.4.0' },
        { capabilities: { tools: { listChanged: true } } },
      );

      const reg = registerSpecModule(
        server,
        { dataDir, workspaceRoot: tmpDir, demoMode: false },
        uiUri,
      );

      // Zero disk writes upon registration
      assert.equal(fs.existsSync(dataDir), false);

      // Exact catalog alignment
      assert.equal(reg.moduleId, 'spec');
      assert.deepEqual(
        reg.modelTools.map((t) => t.name),
        MODULE_CATALOG.spec.modelToolNames,
      );
      assert.deepEqual(reg.exemptReadOnlyAppTools, [
        'app_spec_get_state',
        'app_spec_diff_revisions',
        'app_spec_compile_workflow',
      ]);

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'spec-mcp-client', version: '0.7.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        const listed = await client.listTools();
        const expectedTools = [
          'spec_get_state',
          'spec_create_or_update',
          'spec_approve',
          'spec_update_task',
          'app_spec_get_state',
          'app_spec_save',
          'app_spec_set_status',
          'app_spec_update_task',
          'app_spec_annotate',
          'app_spec_resolve_annotation',
          'app_spec_diff_revisions',
          'app_spec_archive_to_mem',
          'app_spec_compile_workflow',
        ];
        assert.deepEqual(
          listed.tools.map((t) => t.name),
          expectedTools,
        );

        for (const tool of listed.tools) {
          if (tool.name.startsWith('app_')) {
            const meta = tool._meta as { ui?: { visibility?: string[]; resourceUri?: string } } | undefined;
            assert.deepEqual(meta?.ui?.visibility, ['app'], `Expected app-only visibility on ${tool.name}`);
            assert.equal(meta?.ui?.resourceUri, uiUri);
          }
        }

        // End-to-end flow: create draft with requireUiApproval=true -> model approve blocked -> UI approve succeeds -> tasks progress
        const saveRes = await client.callTool({
          name: 'app_spec_save',
          arguments: {
            id: 'spec-e2e',
            title: 'End-to-End Spec',
            goal: 'Verify 4+4 MCP tool contracts',
            acceptanceCriteria: ['All tests green'],
            planSteps: ['Step 1', 'Step 2'],
            enforcePlanBeforeWrite: true,
            requireUiApproval: true,
            tasks: [
              { id: 't1', title: 'Implement core' },
              { id: 't2', title: 'Add tests', dependsOn: ['t1'] },
            ],
          },
        });
        assert.equal(saveRes.isError, undefined);
        const savedPayload = saveRes.structuredContent as { spec: SpecDocumentView; state: SpecStateView };
        assert.equal(savedPayload.spec.id, 'spec-e2e');
        assert.equal(savedPayload.state.writeLockActive, true);

        // PreToolUse denies writes while draft (including short aliases)
        for (const writeTool of ['write_file', 'write', 'edit', 'multi_edit', 'notebook_edit']) {
          assert.equal(
            handleSpecPreToolHook(
              normalizeHookPayload({ toolName: writeTool }, 'PreToolUse'),
              dataDir,
            ).decision,
            'deny',
            `Expected ${writeTool} to be denied while draft`,
          );
        }

        // Model cannot advance tasks while draft has write lock enabled (neither spec_update_task nor spec_create_or_update)
        const modelStartLocked = await client.callTool({
          name: 'spec_update_task',
          arguments: { specId: 'spec-e2e', taskId: 't1', status: 'in_progress' },
        });
        assert.equal(modelStartLocked.isError, true);

        const modelDoneLocked = await client.callTool({
          name: 'spec_update_task',
          arguments: { specId: 'spec-e2e', taskId: 't1', status: 'done' },
        });
        assert.equal(modelDoneLocked.isError, true);

        const modelSaveAdvanceLocked = await client.callTool({
          name: 'spec_create_or_update',
          arguments: {
            id: 'spec-e2e',
            title: 'End-to-End Spec',
            goal: 'Try advancing task via save while locked',
            tasks: [
              { id: 't1', title: 'Implement core', status: 'done' },
              { id: 't2', title: 'Add tests', dependsOn: ['t1'] },
            ],
          },
        });
        assert.equal(modelSaveAdvanceLocked.isError, true);

        // Model spec_approve denied due to requireUiApproval=true
        const modelApproveDenied = await client.callTool({
          name: 'spec_approve',
          arguments: { specId: 'spec-e2e' },
        });
        assert.equal(modelApproveDenied.isError, true);

        // UI app_spec_set_status approves and unlocks write lock
        const uiApprove = await client.callTool({
          name: 'app_spec_set_status',
          arguments: {
            specId: 'spec-e2e',
            status: 'approved',
            approvalNote: 'Approved via MCP App UI',
          },
        });
        assert.equal(uiApprove.isError, undefined);
        const approvedPayload = uiApprove.structuredContent as { spec: SpecDocumentView; state: SpecStateView };
        assert.equal(approvedPayload.spec.approvedBy, 'user');
        assert.equal(approvedPayload.state.writeLockActive, false);

        // PreToolUse now allows writes
        assert.deepEqual(
          handleSpecPreToolHook(
            normalizeHookPayload({ toolName: 'write_file' }, 'PreToolUse'),
            dataDir,
          ),
          {},
        );

        // Step-skip rejected via spec_update_task
        const skipTask = await client.callTool({
          name: 'spec_update_task',
          arguments: { specId: 'spec-e2e', taskId: 't2', status: 'in_progress' },
        });
        assert.equal(skipTask.isError, true);

        // Complete t1 then advance t2
        const t1Done = await client.callTool({
          name: 'spec_update_task',
          arguments: { specId: 'spec-e2e', taskId: 't1', status: 'done', note: 'Core done' },
        });
        assert.equal(t1Done.isError, undefined);
        assert.equal((t1Done.structuredContent as { task: SpecTaskView }).task.computedState, 'done');

        const t2Done = await client.callTool({
          name: 'app_spec_update_task',
          arguments: { specId: 'spec-e2e', taskId: 't2', status: 'done' },
        });
        assert.equal(t2Done.isError, undefined);
        assert.equal((t2Done.structuredContent as { task: SpecTaskView }).task.computedState, 'done');

        // Dynamic disable / enable on all 4 model tools
        for (const h of reg.modelTools) h.disable();
        const afterDisable = await client.listTools();
        const disabledNames = new Set(afterDisable.tools.map((t) => t.name));
        for (const name of MODULE_CATALOG.spec.modelToolNames) {
          assert.equal(disabledNames.has(name), false, `${name} should be disabled`);
        }

        for (const h of reg.modelTools) h.enable();
        const afterEnable = await client.listTools();
        const enabledNames = new Set(afterEnable.tools.map((t) => t.name));
        for (const name of MODULE_CATALOG.spec.modelToolNames) {
          assert.equal(enabledNames.has(name), true, `${name} should be re-enabled`);
        }
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});

describe('Spec Flow — adversarial model write-lock & task progression bypass regressions', () => {
  it('blocks model from advancing tasks to in_progress/done via spec_update_task or spec_create_or_update while draft write lock is active', async () => {
    await withTempDir('agy-nov-spec-adv-tasks-', async (tmpDir) => {
      const moduleDataDir = getModuleDataDir(tmpDir, 'spec');

      // 1) New draft spec (default enforcePlanBeforeWrite=true) cannot be created by model with in_progress/done tasks
      const createWithInProgress = saveSpec(
        moduleDataDir,
        {
          id: 'spec-new-inprog',
          title: 'Sneaky Draft InProgress',
          goal: 'Attempt to start task on creation',
          tasks: [{ id: 't1', title: 'Step 1', status: 'in_progress' }],
        },
        'model',
      );
      assert.equal(createWithInProgress.ok, false);
      assert.match(createWithInProgress.error, /write lock|approve/i);

      const createWithDone = saveSpec(
        moduleDataDir,
        {
          id: 'spec-new-done',
          title: 'Sneaky Draft Done',
          goal: 'Attempt to finish task on creation',
          enforcePlanBeforeWrite: true,
          tasks: [{ id: 't1', title: 'Step 1', status: 'done' }],
        },
        'model',
      );
      assert.equal(createWithDone.ok, false);
      assert.match(createWithDone.error, /write lock|approve/i);

      // 2) Valid draft creation with pending tasks succeeds
      const created = saveSpec(
        moduleDataDir,
        {
          id: 'spec-draft-locked',
          title: 'Locked Draft',
          goal: 'Enforce plan before work',
          enforcePlanBeforeWrite: true,
          requireUiApproval: false,
          tasks: [
            { id: 't1', title: 'Step 1' },
            { id: 't2', title: 'Step 2', dependsOn: ['t1'] },
          ],
        },
        'model',
      );
      assert.equal(created.ok, true);

      // 3) Model cannot advance tasks via updateSpecTask while draft write lock is active
      const modelStart = updateSpecTask(
        moduleDataDir,
        { specId: 'spec-draft-locked', taskId: 't1', status: 'in_progress' },
        'model',
      );
      assert.equal(modelStart.ok, false);
      assert.match(modelStart.error, /write lock|approve/i);

      const modelDone = updateSpecTask(
        moduleDataDir,
        { specId: 'spec-draft-locked', taskId: 't1', status: 'done' },
        'model',
      );
      assert.equal(modelDone.ok, false);
      assert.match(modelDone.error, /write lock|approve/i);

      // Model may still mark blocked or pending while in draft
      const modelBlocked = updateSpecTask(
        moduleDataDir,
        { specId: 'spec-draft-locked', taskId: 't1', status: 'blocked', note: 'Clarifying scope' },
        'model',
      );
      assert.equal(modelBlocked.ok, true);
      const modelPending = updateSpecTask(
        moduleDataDir,
        { specId: 'spec-draft-locked', taskId: 't1', status: 'pending' },
        'model',
      );
      assert.equal(modelPending.ok, true);

      // 4) Model cannot bypass via saveSpec (spec_create_or_update) with status: in_progress or done
      const saveAdvanceInProgress = saveSpec(
        moduleDataDir,
        {
          id: 'spec-draft-locked',
          title: 'Locked Draft',
          goal: 'Enforce plan before work',
          tasks: [
            { id: 't1', title: 'Step 1', status: 'in_progress' },
            { id: 't2', title: 'Step 2', dependsOn: ['t1'] },
          ],
        },
        'model',
      );
      assert.equal(saveAdvanceInProgress.ok, false);
      assert.match(saveAdvanceInProgress.error, /write lock|approve/i);

      const saveAdvanceDone = saveSpec(
        moduleDataDir,
        {
          id: 'spec-draft-locked',
          title: 'Locked Draft',
          goal: 'Enforce plan before work',
          tasks: [
            { id: 't1', title: 'Step 1', status: 'done' },
            { id: 't2', title: 'Step 2', dependsOn: ['t1'] },
          ],
        },
        'model',
      );
      assert.equal(saveAdvanceDone.ok, false);
      assert.match(saveAdvanceDone.error, /write lock|approve/i);

      // 5) User (UI app tool actor='user') is still allowed to update tasks on a draft spec
      const userStart = updateSpecTask(
        moduleDataDir,
        { specId: 'spec-draft-locked', taskId: 't1', status: 'in_progress' },
        'user',
      );
      assert.equal(userStart.ok, true);

      // Model can still revise draft spec text without passing status:'in_progress'|'done'
      const modelReviseText = saveSpec(
        moduleDataDir,
        {
          id: 'spec-draft-locked',
          title: 'Locked Draft (Clarified)',
          goal: 'Enforce plan before work',
          tasks: [
            { id: 't1', title: 'Step 1 (Clarified)' },
            { id: 't2', title: 'Step 2', dependsOn: ['t1'] },
          ],
        },
        'model',
      );
      assert.equal(modelReviseText.ok, true);

      // 6) Once approved via spec_approve flow, model can advance tasks normally
      const approved = setSpecStatus(
        moduleDataDir,
        { specId: 'spec-draft-locked', status: 'approved', approvalNote: 'Ready to implement' },
        'model',
      );
      assert.equal(approved.ok, true);
      assert.equal(approved.spec.approvedBy, 'model');
      assert.ok(approved.spec.approvedAt);

      const modelFinishAfterApprove = updateSpecTask(
        moduleDataDir,
        { specId: 'spec-draft-locked', taskId: 't1', status: 'done' },
        'model',
      );
      assert.equal(modelFinishAfterApprove.ok, true);
    });
  });

  it('blocks model from downgrading enforcePlanBeforeWrite to false regardless of spec status or requireUiApproval', async () => {
    await withTempDir('agy-nov-spec-adv-downgrade-', async (tmpDir) => {
      const moduleDataDir = getModuleDataDir(tmpDir, 'spec');

      const scenarios: Array<{
        id: string;
        status: 'draft' | 'approved';
        requireUiApproval: boolean;
      }> = [
        { id: 'spec-draft-noui', status: 'draft', requireUiApproval: false },
        { id: 'spec-draft-ui', status: 'draft', requireUiApproval: true },
        { id: 'spec-approved-noui', status: 'approved', requireUiApproval: false },
        { id: 'spec-approved-ui', status: 'approved', requireUiApproval: true },
      ];

      for (const sc of scenarios) {
        const created = saveSpec(
          moduleDataDir,
          {
            id: sc.id,
            title: `Scenario ${sc.id}`,
            goal: 'Verify model cannot downgrade enforcePlanBeforeWrite',
            enforcePlanBeforeWrite: true,
            requireUiApproval: sc.requireUiApproval,
            setActive: true,
            tasks: [{ id: 't1', title: 'Task 1' }],
          },
          'user',
        );
        assert.equal(created.ok, true);

        if (sc.status === 'approved') {
          const app = setSpecStatus(
            moduleDataDir,
            { specId: sc.id, status: 'approved', setActive: true },
            'user',
          );
          assert.equal(app.ok, true);
        }

        const downgradeViaSave = saveSpec(
          moduleDataDir,
          {
            id: sc.id,
            title: `Scenario ${sc.id}`,
            goal: 'Attempt to disable write lock as model',
            enforcePlanBeforeWrite: false,
          },
          'model',
        );
        assert.equal(
          downgradeViaSave.ok,
          false,
          `Expected model downgrade to fail for ${sc.id} (${sc.status}, requireUiApproval=${sc.requireUiApproval})`,
        );
        assert.match(downgradeViaSave.error, /enforcePlanBeforeWrite/i);

        // User actor can legitimately change enforcePlanBeforeWrite
        const userDisable = saveSpec(
          moduleDataDir,
          {
            id: sc.id,
            title: `Scenario ${sc.id}`,
            goal: 'User disables write lock',
            enforcePlanBeforeWrite: false,
          },
          'user',
        );
        assert.equal(userDisable.ok, true);
        assert.equal(userDisable.spec.enforcePlanBeforeWrite, false);
      }
    });
  });

  it('blocks model from switching or clearing activeSpecId while active draft has write lock enabled (even when requireUiApproval=false)', async () => {
    await withTempDir('agy-nov-spec-adv-switch-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data');
      const server = new McpServer(
        { name: 'spec-adv-switch-test', version: '0.4.0' },
        { capabilities: { tools: { listChanged: true } } },
      );
      registerSpecModule(server, { dataDir, workspaceRoot: tmpDir, demoMode: false }, 'ui://agy-nov/app.html');

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'spec-adv-switch-client', version: '0.4.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        // Create an active draft spec with enforcePlanBeforeWrite=true and requireUiApproval=false
        const firstRes = await client.callTool({
          name: 'spec_create_or_update',
          arguments: {
            id: 'spec-active-lock',
            title: 'Active Locked Draft',
            goal: 'Must stay active until approved',
            enforcePlanBeforeWrite: true,
            requireUiApproval: false,
            tasks: [{ id: 't1', title: 'Design' }],
          },
        });
        assert.equal(firstRes.isError, undefined);
        assert.equal(
          (firstRes.structuredContent as { state: SpecStateView }).state.activeSpecId,
          'spec-active-lock',
        );
        assert.equal(
          (firstRes.structuredContent as { state: SpecStateView }).state.writeLockActive,
          true,
        );

        // 1) Model explicitly trying to switch activeSpecId via a decoy spec with setActive: true -> rejected
        const explicitSwitch = await client.callTool({
          name: 'spec_create_or_update',
          arguments: {
            id: 'spec-decoy-1',
            title: 'Decoy Explicit',
            goal: 'Bypass write lock',
            enforcePlanBeforeWrite: false,
            setActive: true,
          },
        });
        assert.equal(explicitSwitch.isError, true);

        // 2) Model creating a second spec without setActive must NOT hijack activeSpecId away from locked draft
        const implicitSwitch = await client.callTool({
          name: 'spec_create_or_update',
          arguments: {
            id: 'spec-decoy-2',
            title: 'Decoy Implicit',
            goal: 'Try implicit switch',
            enforcePlanBeforeWrite: false,
          },
        });
        assert.equal(implicitSwitch.isError, undefined);
        const afterImplicit = (implicitSwitch.structuredContent as { state: SpecStateView }).state;
        assert.equal(afterImplicit.activeSpecId, 'spec-active-lock');
        assert.equal(afterImplicit.writeLockActive, true);

        // 3) Model trying to clear activeSpecId with setActive: false on the locked draft -> rejected
        const clearActive = await client.callTool({
          name: 'spec_create_or_update',
          arguments: {
            id: 'spec-active-lock',
            title: 'Active Locked Draft',
            goal: 'Try clearing activeSpecId',
            setActive: false,
          },
        });
        assert.equal(clearActive.isError, true);

        // PreToolUse must still deny short aliases write/edit
        for (const tool of ['write', 'edit', 'multi_edit', 'notebook_edit']) {
          assert.equal(
            handleSpecPreToolHook(
              normalizeHookPayload({ toolName: tool }, 'PreToolUse'),
              dataDir,
            ).decision,
            'deny',
          );
        }

        // 4) Formal spec_approve unlocks write lock and records audit trail
        const approveRes = await client.callTool({
          name: 'spec_approve',
          arguments: { specId: 'spec-active-lock', approvalNote: 'Approved formally' },
        });
        assert.equal(approveRes.isError, undefined);
        const approvedPayload = approveRes.structuredContent as {
          spec: SpecDocumentView;
          state: SpecStateView;
        };
        assert.equal(approvedPayload.spec.approvedBy, 'model');
        assert.ok(approvedPayload.spec.approvedAt);
        assert.equal(approvedPayload.state.writeLockActive, false);

        for (const tool of ['write', 'edit', 'multi_edit', 'notebook_edit']) {
          assert.deepEqual(
            handleSpecPreToolHook(
              normalizeHookPayload({ toolName: tool }, 'PreToolUse'),
              dataDir,
            ),
            {},
          );
        }
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});
