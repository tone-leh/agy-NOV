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
import { createNovServer } from '../src/server/index.js';
import {
  addSpecAnnotation,
  archiveSpecToMemory,
  buildAnnotationFeedbackPrompt,
  computePlanRevisionDiff,
  createDemoSpecState,
  deleteSpecAnnotation,
  diffSpecRevisions,
  getSpecStatePath,
  loadSpecStateReadOnly,
  MAX_LCS_DIFF_LINES,
  MAX_REVISIONS_PER_SPEC,
  resolveSpecAnnotation,
  saveSpec,
  type SpecDocumentView,
  type SpecStateView,
} from '../src/modules/spec/core.js';
import { handleSpecSessionStartHook } from '../src/modules/spec/hook.js';
import { registerSpecModule } from '../src/modules/spec/register.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

describe('Spec 2.0 — Full & Brownfield Delta Specs, revision history cap & line diff engine', () => {
  it('auto-synthesizes planMarkdown for full & delta specs and preserves backward compatibility with legacy v0.4 state.json', async () => {
    await withTempDir('agy-nov-v07-spec-delta-', (tmpDir) => {
      const moduleDataDir = getModuleDataDir(tmpDir, 'spec');

      // 1) Legacy v0.4 state.json lacking v0.7 fields must load cleanly with synthesized defaults
      fs.mkdirSync(moduleDataDir, { recursive: true });
      const legacyState = {
        schemaVersion: 1,
        activeSpecId: 'spec-legacy',
        updatedAt: '2026-01-01T00:00:00.000Z',
        specs: [
          {
            id: 'spec-legacy',
            title: 'Legacy Spec Document',
            goal: 'Ensure v0.4 disk data remains 100% readable in v0.7',
            acceptanceCriteria: ['Backward compatible load'],
            planSteps: ['Load state.json cleanly'],
            status: 'approved',
            enforcePlanBeforeWrite: true,
            requireUiApproval: false,
            tasks: [
              {
                id: 't1',
                title: 'Legacy task',
                dependsOn: [],
                status: 'done',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      };
      fs.writeFileSync(getSpecStatePath(moduleDataDir), JSON.stringify(legacyState, null, 2), 'utf8');

      const loaded = loadSpecStateReadOnly(moduleDataDir);
      assert.equal(loaded.specs.length, 1);
      const legacy = loaded.specs[0];
      assert.equal(legacy.mode, 'full');
      assert.deepEqual(legacy.deltaItems, []);
      assert.equal(legacy.revision, 1);
      assert.equal(legacy.revisions.length, 1);
      assert.deepEqual(legacy.annotations, []);
      assert.match(legacy.planMarkdown, /# Legacy Spec Document/);
      assert.match(legacy.planMarkdown, /Mode: FULL SPEC/);
      assert.match(legacy.planMarkdown, /Backward compatible load/);

      // 2) Create a Brownfield Delta Spec without explicit planMarkdown -> auto-synthesizes delta sections
      const createdDelta = saveSpec(
        moduleDataDir,
        {
          id: 'spec-delta-auth',
          title: 'Session Cookie Hardening',
          goal: 'Upgrade legacy session cookies to SameSite=Lax with rotating CSRF tokens.',
          mode: 'delta',
          deltaItems: [
            { kind: 'added', area: 'auth/csrf', text: 'Issue per-session double-submit CSRF token.' },
            { kind: 'modified', area: 'auth/cookie', text: 'Set SameSite=Lax and Secure flags by default.' },
            { kind: 'removed', area: 'auth/legacy', text: 'Remove fallback query-string session_id parsing.' },
          ],
          acceptanceCriteria: ['No CSRF regressions on POST endpoints'],
          tasks: [{ id: 'csrf-mw', title: 'Add CSRF middleware' }],
          setActive: true,
        },
        'user',
      );
      assert.equal(createdDelta.ok, true);
      assert.equal(createdDelta.spec.mode, 'delta');
      assert.equal(createdDelta.spec.deltaItems.length, 3);
      assert.equal(createdDelta.spec.revision, 1);
      assert.equal(createdDelta.spec.revisions.length, 1);
      assert.match(createdDelta.spec.planMarkdown, /BROWNFIELD DELTA SPEC/);
      assert.match(createdDelta.spec.planMarkdown, /\[ADDED\] \(auth\/csrf\)/);
      assert.match(createdDelta.spec.planMarkdown, /\[MODIFIED\] \(auth\/cookie\)/);
      assert.match(createdDelta.spec.planMarkdown, /\[REMOVED\] \(auth\/legacy\)/);
    });
  });

  it('increments revisions on planMarkdown changes, stays idempotent when unchanged, and caps history at 8 revisions', async () => {
    await withTempDir('agy-nov-v07-spec-revisions-', (tmpDir) => {
      const moduleDataDir = getModuleDataDir(tmpDir, 'spec');

      // Publish 10 distinct revisions
      for (let rev = 1; rev <= 10; rev += 1) {
        const res = saveSpec(
          moduleDataDir,
          {
            id: 'spec-rev-cap',
            title: 'Iterative Plan Spec',
            goal: 'Track plan revisions safely',
            planMarkdown: [
              '# Iterative Plan',
              '## Scope',
              `Revision step ${rev}`,
              '## Verification',
              '- Run test suite',
            ].join('\n'),
            revisionSummary: `Update to v${rev}`,
          },
          'user',
        );
        assert.equal(res.ok, true);
        assert.equal(res.spec.revision, rev);
        assert.ok(
          res.spec.revisions.length <= MAX_REVISIONS_PER_SPEC,
          `Revisions count ${res.spec.revisions.length} exceeded cap ${MAX_REVISIONS_PER_SPEC}`,
        );
      }

      // Saving identical planMarkdown must NOT bump revision
      const idempotent = saveSpec(
        moduleDataDir,
        {
          id: 'spec-rev-cap',
          title: 'Iterative Plan Spec',
          goal: 'Track plan revisions safely',
          planMarkdown: [
            '# Iterative Plan',
            '## Scope',
            'Revision step 10',
            '## Verification',
            '- Run test suite',
          ].join('\n'),
        },
        'user',
      );
      assert.equal(idempotent.ok, true);
      assert.equal(idempotent.spec.revision, 10);
      assert.equal(idempotent.spec.revisions.length, MAX_REVISIONS_PER_SPEC);
      assert.deepEqual(
        idempotent.spec.revisions.map((r) => r.revision),
        [3, 4, 5, 6, 7, 8, 9, 10],
      );

      // Default diffSpecRevisions compares v9 -> v10
      const loadedSpec = loadSpecStateReadOnly(moduleDataDir).specs.find((s) => s.id === 'spec-rev-cap')!;
      const defaultDiff = diffSpecRevisions(loadedSpec);
      assert.equal(defaultDiff.ok, true);
      assert.equal(defaultDiff.fromRevision, 9);
      assert.equal(defaultDiff.toRevision, 10);
      assert.equal(defaultDiff.diff.addedLines, 1);
      assert.equal(defaultDiff.diff.removedLines, 1);
      assert.equal(defaultDiff.diff.degraded, false);

      // Evicted v1 must return clean error
      const missingDiff = diffSpecRevisions(loadedSpec, 1, 10);
      assert.equal(missingDiff.ok, false);
      assert.match(missingDiff.error, /v1/);
    });
  });

  it('computes exact LCS line-level diff within limits and degrades safely to linear block diff above 600 lines', () => {
    const prev = [
      '# Plan',
      'line-1',
      'line-2-old',
      'line-3',
      'line-4-removed',
      'line-5',
    ].join('\n');
    const next = [
      '# Plan',
      'line-1',
      'line-2-new',
      'line-3',
      'line-5',
      'line-6-added',
    ].join('\n');

    const diff = computePlanRevisionDiff(prev, next);
    assert.equal(diff.degraded, false);
    assert.equal(diff.addedLines, 2);
    assert.equal(diff.removedLines, 2);

    const dels = diff.hunks.filter((h) => h.type === 'del').map((h) => `${h.oldLine}:${h.text}`);
    const adds = diff.hunks.filter((h) => h.type === 'add').map((h) => `${h.newLine}:${h.text}`);
    assert.deepEqual(dels, ['3:line-2-old', '5:line-4-removed']);
    assert.deepEqual(adds, ['3:line-2-new', '6:line-6-added']);

    // Oversized document (> MAX_LCS_DIFF_LINES) triggers linear guardrail cleanly & rapidly
    const total = MAX_LCS_DIFF_LINES + 120;
    const bigPrev = Array.from({ length: total }, (_, i) =>
      i === 350 ? 'old-middle-A' : i === 351 ? 'old-middle-B' : `shared-line-${i}`,
    ).join('\n');
    const bigNext = Array.from({ length: total + 1 }, (_, i) =>
      i === 350
        ? 'new-middle-A'
        : i === 351
          ? 'new-middle-B'
          : i === 352
            ? 'new-middle-C'
            : `shared-line-${i > 352 ? i - 1 : i}`,
    ).join('\n');

    const startedAt = Date.now();
    const bigDiff = computePlanRevisionDiff(bigPrev, bigNext);
    const elapsedMs = Date.now() - startedAt;

    assert.equal(bigDiff.degraded, true);
    assert.equal(bigDiff.removedLines, 2);
    assert.equal(bigDiff.addedLines, 3);
    assert.ok(elapsedMs < 500, `Expected linear fallback to finish rapidly, took ${elapsedMs}ms`);
  });
});

describe('Spec 2.0 — Plannotator inline annotations, bounds checks & feedback prompt assembly', () => {
  it('supports comment/strike/replace lifecycle, rejects invalid bounds, and builds structured feedback prompts', async () => {
    await withTempDir('agy-nov-v07-spec-ann-', (tmpDir) => {
      const moduleDataDir = getModuleDataDir(tmpDir, 'spec');
      const planMarkdown = [
        '# Billing Sync Plan',
        '## Steps',
        '1. Fetch invoices from provider API.',
        '2. Build custom Excel export portal.',
        '3. Retry failed jobs with infinite loop.',
        '4. Emit audit metrics.',
      ].join('\n');

      const created = saveSpec(
        moduleDataDir,
        {
          id: 'spec-billing-sync',
          title: 'Billing Sync Plan',
          goal: 'Keep invoice ledger synced reliably',
          mode: 'delta',
          deltaItems: [
            { kind: 'added', area: 'billing/sync', text: 'Persist cursor checkpoint per tenant.' },
          ],
          planMarkdown,
        },
        'user',
      );
      assert.equal(created.ok, true);

      // Invalid line bounds & missing required payloads must be rejected
      const badZero = addSpecAnnotation(moduleDataDir, {
        specId: 'spec-billing-sync',
        lineStart: 0,
        lineEnd: 1,
        kind: 'comment',
        note: 'Out of lower bound',
      });
      assert.equal(badZero.ok, false);

      const badInverted = addSpecAnnotation(moduleDataDir, {
        specId: 'spec-billing-sync',
        lineStart: 4,
        lineEnd: 2,
        kind: 'comment',
        note: 'Inverted range',
      });
      assert.equal(badInverted.ok, false);

      const badOverflow = addSpecAnnotation(moduleDataDir, {
        specId: 'spec-billing-sync',
        lineStart: 1,
        lineEnd: 99,
        kind: 'strike',
        note: 'Past EOF',
      });
      assert.equal(badOverflow.ok, false);

      const badFloat = addSpecAnnotation(moduleDataDir, {
        specId: 'spec-billing-sync',
        lineStart: 1.5,
        lineEnd: 2,
        kind: 'comment',
        note: 'Non-integer',
      });
      assert.equal(badFloat.ok, false);

      const emptyComment = addSpecAnnotation(moduleDataDir, {
        specId: 'spec-billing-sync',
        lineStart: 3,
        lineEnd: 3,
        kind: 'comment',
        note: '   ',
      });
      assert.equal(emptyComment.ok, false);

      const emptyReplace = addSpecAnnotation(moduleDataDir, {
        specId: 'spec-billing-sync',
        lineStart: 5,
        lineEnd: 5,
        kind: 'replace',
        note: 'Missing suggested text',
        suggestedText: '',
      });
      assert.equal(emptyReplace.ok, false);

      // Add 3 valid annotations: comment, strike, replace
      const a1 = addSpecAnnotation(moduleDataDir, {
        specId: 'spec-billing-sync',
        lineStart: 3,
        lineEnd: 3,
        kind: 'comment',
        note: 'Respect provider rate-limit headers.',
      });
      assert.equal(a1.ok, true);

      const a2 = addSpecAnnotation(moduleDataDir, {
        specId: 'spec-billing-sync',
        lineStart: 4,
        lineEnd: 4,
        kind: 'strike',
        note: 'Cut custom Excel portal from this sprint.',
      });
      assert.equal(a2.ok, true);

      const a3 = addSpecAnnotation(moduleDataDir, {
        specId: 'spec-billing-sync',
        lineStart: 5,
        lineEnd: 5,
        kind: 'replace',
        note: 'Use bounded exponential backoff instead of infinite loop.',
        suggestedText: '3. Retry failed jobs with capped exponential backoff (max 5 attempts) then route to DLQ.',
      });
      assert.equal(a3.ok, true);
      assert.equal(a3.spec.unresolvedAnnotations, 3);

      // Resolve a1 -> only a2 and a3 remain unresolved
      const resolvedA1 = resolveSpecAnnotation(moduleDataDir, {
        specId: 'spec-billing-sync',
        annotationId: a1.annotation.id,
        resolved: true,
      });
      assert.equal(resolvedA1.ok, true);
      assert.equal(resolvedA1.annotation.resolved, true);
      assert.ok(resolvedA1.annotation.resolvedAt);
      assert.equal(resolvedA1.spec.unresolvedAnnotations, 2);

      // Structured feedback prompt must include only unresolved strike & replace + excerpts + delta + v2 instruction
      const prompt = buildAnnotationFeedbackPrompt(resolvedA1.spec);
      assert.match(prompt, /Target Revision: v2/);
      assert.match(prompt, /Unresolved Annotations: 2/);
      assert.doesNotMatch(prompt, /Respect provider rate-limit headers/);
      assert.match(prompt, /\[STRIKE \/ CUT SCOPE\] L4/);
      assert.match(prompt, /Build custom Excel export portal/);
      assert.match(prompt, /Cut custom Excel portal from this sprint/);
      assert.match(prompt, /\[REPLACE SUGGESTION\] L5/);
      assert.match(prompt, /capped exponential backoff \(max 5 attempts\)/);
      assert.match(prompt, /\[ADDED\] \(billing\/sync\)/);
      assert.match(prompt, /spec_create_or_update/);

      // Reopen a1, then delete a2
      const reopened = resolveSpecAnnotation(moduleDataDir, {
        specId: 'spec-billing-sync',
        annotationId: a1.annotation.id,
        resolved: false,
      });
      assert.equal(reopened.ok, true);
      assert.equal(reopened.spec.unresolvedAnnotations, 3);

      const deleted = deleteSpecAnnotation(moduleDataDir, {
        specId: 'spec-billing-sync',
        annotationId: a2.annotation.id,
      });
      assert.equal(deleted.ok, true);
      assert.equal(deleted.spec.annotations.length, 2);
      assert.equal(deleted.spec.unresolvedAnnotations, 2);
    });
  });
});

describe('Spec 2.0 — Archive to Mem (<private> stripping + live disk vs demo zero-write)', () => {
  it('writes sanitized memory into memories.json with stripped <private> tags and records archivedMemoryId in live mode', async () => {
    await withTempDir('agy-nov-v07-spec-archive-live-', (tmpDir) => {
      const rootDataDir = path.join(tmpDir, 'nov-data');
      const specDataDir = getModuleDataDir(rootDataDir, 'spec');
      const memDataDir = getModuleDataDir(rootDataDir, 'mem');

      const syntheticKey = ['sk', '1234567890abcdef1234567890'].join('-');
      const created = saveSpec(
        specDataDir,
        {
          id: 'spec-archive-delta',
          title: 'Payment Tokenization <private>INTERNAL_CODE_99</private>',
          goal: 'Tokenize card numbers before storage. <private>secret_db_pass=supersecret999</private>',
          mode: 'delta',
          deltaItems: [
            {
              kind: 'added',
              area: 'payments/vault',
              text: 'Store vault token only; never persist PAN.',
            },
          ],
          acceptanceCriteria: ['PCI audit passes with zero raw PAN logs'],
          planMarkdown: [
            '# Payment Tokenization',
            '1. Proxy card payload to vault.',
            '<private>Bearer secret_bearer_token_should_never_leak</private>',
            `2. Reference key ${syntheticKey} must be redacted.`,
          ].join('\n'),
          tasks: [{ id: 'vault-proxy', title: 'Implement vault proxy', status: 'pending' }],
        },
        'user',
      );
      assert.equal(created.ok, true);

      const archived = archiveSpecToMemory(specDataDir, rootDataDir, 'spec-archive-delta', {
        workspacePath: tmpDir,
        pinned: true,
        note: 'Final approved contract <private>private_note_xyz</private>',
      });
      assert.equal(archived.ok, true);
      assert.equal(archived.demoSimulated, false);
      assert.ok(archived.memoryId.startsWith('mem_'));
      assert.equal(archived.spec.archivedMemoryId, archived.memoryId);
      assert.ok(archived.tags.includes('spec'));
      assert.ok(archived.tags.includes('delta-spec'));

      // Verify memories.json on disk contains stripped & redacted content only
      const memFile = path.join(memDataDir, 'memories.json');
      assert.equal(fs.existsSync(memFile), true);
      const rawMemDisk = fs.readFileSync(memFile, 'utf8');
      assert.doesNotMatch(rawMemDisk, /INTERNAL_CODE_99/);
      assert.doesNotMatch(rawMemDisk, /supersecret999/);
      assert.doesNotMatch(rawMemDisk, /secret_bearer_token_should_never_leak/);
      assert.doesNotMatch(rawMemDisk, /private_note_xyz/);
      assert.equal(rawMemDisk.includes(syntheticKey), false);
      assert.match(rawMemDisk, /\[REDACTED_KEY\]/);

      const parsedMemories = JSON.parse(rawMemDisk) as Array<{
        id: string;
        tags: string[];
        pinned: boolean;
        content: string;
      }>;
      assert.equal(parsedMemories.length, 1);
      assert.equal(parsedMemories[0].id, archived.memoryId);
      assert.equal(parsedMemories[0].pinned, true);
      assert.ok(parsedMemories[0].tags.includes('spec'));
      assert.ok(parsedMemories[0].tags.includes('delta-spec'));
      assert.match(parsedMemories[0].content, /Store vault token only/);

      // Re-archiving updates the existing memory in-place instead of duplicating
      const archivedAgain = archiveSpecToMemory(specDataDir, rootDataDir, 'spec-archive-delta', {
        workspacePath: tmpDir,
      });
      assert.equal(archivedAgain.ok, true);
      assert.equal(archivedAgain.memoryId, archived.memoryId);
      const afterSecond = JSON.parse(fs.readFileSync(memFile, 'utf8')) as unknown[];
      assert.equal(afterSecond.length, 1);

      // Reloaded spec from disk retains archivedMemoryId
      const reloaded = loadSpecStateReadOnly(specDataDir).specs.find(
        (s) => s.id === 'spec-archive-delta',
      );
      assert.equal(reloaded?.archivedMemoryId, archived.memoryId);
    });
  });

  it('strictly avoids any disk writes when archiving in demoMode', async () => {
    await withTempDir('agy-nov-v07-spec-archive-demo-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'demo-data-must-not-exist');
      const server = new McpServer(
        { name: 'spec-demo-archive-test', version: '0.7.0' },
        { capabilities: { tools: { listChanged: true } } },
      );
      registerSpecModule(server, { dataDir, workspaceRoot: tmpDir, demoMode: true }, 'ui://agy-nov/app.html');

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'spec-demo-archive-client', version: '0.7.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        // Demo state already includes rich v1 -> v2 delta spec with annotations
        const stateRes = await client.callTool({ name: 'spec_get_state', arguments: {} });
        assert.equal(stateRes.isError, undefined);
        const statePayload = stateRes.structuredContent as unknown as SpecStateView & {
          revision: number;
          unresolvedAnnotations: number;
        };
        assert.equal(statePayload.activeSpec?.mode, 'delta');
        assert.equal(statePayload.revision, 2);
        assert.ok(statePayload.unresolvedAnnotations >= 1);

        // Diff v1 -> v2 in demo mode works with zero disk writes
        const diffRes = await client.callTool({
          name: 'app_spec_diff_revisions',
          arguments: { specId: statePayload.activeSpec?.id },
        });
        assert.equal(diffRes.isError, undefined);
        const diffPayload = diffRes.structuredContent as {
          fromRevision: number;
          toRevision: number;
          addedLines: number;
          removedLines: number;
        };
        assert.equal(diffPayload.fromRevision, 1);
        assert.equal(diffPayload.toRevision, 2);
        assert.ok(diffPayload.addedLines > 0);
        assert.ok(diffPayload.removedLines > 0);

        // Archive to mem in demo mode returns simulated ID with strictly zero disk writes
        const archiveRes = await client.callTool({
          name: 'app_spec_archive_to_mem',
          arguments: { specId: statePayload.activeSpec?.id },
        });
        assert.equal(archiveRes.isError, undefined);
        const archivePayload = archiveRes.structuredContent as {
          memoryId: string;
          demoSimulated: boolean;
          spec: SpecDocumentView;
        };
        assert.equal(archivePayload.demoSimulated, true);
        assert.match(archivePayload.memoryId, /^demo-mem-spec-/);
        assert.equal(archivePayload.spec.archivedMemoryId, archivePayload.memoryId);

        assert.equal(fs.existsSync(dataDir), false, 'demoMode must perform zero disk writes');
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});

describe('Spec 2.0 — SessionStart hook [DELTA] & annotation reminders + disabled-module tool gating', () => {
  it('injects [DELTA] label and unresolved annotation reminder in SessionStart hook without touching disk', async () => {
    await withTempDir('agy-nov-v07-spec-hook-', (tmpDir) => {
      const moduleDataDir = getModuleDataDir(tmpDir, 'spec');
      const saved = saveSpec(
        moduleDataDir,
        {
          id: 'spec-hook-delta',
          title: 'Rate Limiter Upgrade',
          goal: 'Switch fixed window to token bucket',
          mode: 'delta',
          deltaItems: [
            { kind: 'modified', area: 'gateway/limit', text: 'Use sliding token bucket per API key.' },
          ],
          planMarkdown: ['# Rate Limiter Upgrade', '1. Replace Redis counter.', '2. Add burst cap.'].join('\n'),
          tasks: [{ id: 'bucket-impl', title: 'Implement token bucket' }],
        },
        'user',
      );
      assert.equal(saved.ok, true);

      const ann = addSpecAnnotation(moduleDataDir, {
        specId: 'spec-hook-delta',
        lineStart: 2,
        lineEnd: 2,
        kind: 'comment',
        note: 'Keep Lua script atomic to avoid race conditions.',
      });
      assert.equal(ann.ok, true);

      const statePath = getSpecStatePath(moduleDataDir);
      const mtimeBefore = fs.statSync(statePath).mtimeMs;

      const out = handleSpecSessionStartHook(
        normalizeHookPayload({ workspaceRoot: tmpDir }, 'SessionStart'),
        tmpDir,
      );
      assert.ok(Array.isArray(out.injectSteps) && out.injectSteps.length === 1);
      const step = out.injectSteps[0] as { systemMessage?: { systemMessage?: string } };
      const msg = step.systemMessage?.systemMessage ?? '';
      assert.match(msg, /\[DELTA\]/);
      assert.match(msg, /Rate Limiter Upgrade/);
      assert.match(msg, /1 unresolved inline annotation/i);
      assert.match(msg, /spec_get_state/);
      assert.equal(fs.statSync(statePath).mtimeMs, mtimeBefore);
    });
  });

  it('keeps model-visible tool count strictly at 4 and disables all write app_spec_* tools when spec module is OFF', async () => {
    await withTempDir('agy-nov-v07-spec-gating-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'nov-server-data');
      const bundle = createNovServer({
        dataDir,
        workspaceRoot: tmpDir,
        demoMode: false,
        configPollMs: 0,
        exposeAppToolsWithoutUiCapability: true,
      });

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'spec-gating-client', version: '0.7.0' });
      await bundle.server.connect(serverTransport);
      await client.connect(clientTransport);

      const WRITE_APP_SPEC_TOOLS = [
        'app_spec_save',
        'app_spec_set_status',
        'app_spec_update_task',
        'app_spec_annotate',
        'app_spec_resolve_annotation',
        'app_spec_archive_to_mem',
      ];
      const READONLY_APP_SPEC_TOOLS = ['app_spec_get_state', 'app_spec_diff_revisions'];

      try {
        // Default preset (core) has spec OFF -> all 4 model tools & all 6 write app_spec_* tools must be disabled
        const initialTools = await client.listTools();
        const initialNames = new Set(initialTools.tools.map((t) => t.name));

        for (const modelName of MODULE_CATALOG.spec.modelToolNames) {
          assert.equal(initialNames.has(modelName), false, `${modelName} must be disabled when spec is OFF`);
        }
        for (const writeAppName of WRITE_APP_SPEC_TOOLS) {
          assert.equal(initialNames.has(writeAppName), false, `${writeAppName} must be disabled when spec is OFF`);
        }
        for (const roName of READONLY_APP_SPEC_TOOLS) {
          assert.equal(initialNames.has(roName), true, `${roName} should remain available as read-only exempt`);
        }

        // Enable spec module -> strictly 4 model-visible spec_* tools + all 8 app_spec_* tools enabled
        await bundle.setModule('spec', true);
        const enabledTools = await client.listTools();
        const specModelTools = enabledTools.tools.filter((t) => t.name.startsWith('spec_'));
        assert.equal(specModelTools.length, 4, 'Spec module must expose strictly 4 model-visible tools');
        assert.deepEqual(
          specModelTools.map((t) => t.name),
          MODULE_CATALOG.spec.modelToolNames,
        );

        const enabledNames = new Set(enabledTools.tools.map((t) => t.name));
        for (const writeAppName of WRITE_APP_SPEC_TOOLS) {
          assert.equal(enabledNames.has(writeAppName), true, `${writeAppName} must be enabled when spec is ON`);
        }

        // End-to-end MCP tool flow: create v1 -> annotate -> publish v2 -> diff -> resolve -> archive to mem
        const v1 = await client.callTool({
          name: 'spec_create_or_update',
          arguments: {
            id: 'spec-mcp-v07',
            title: 'Search Cache Layer',
            goal: 'Reduce p99 query latency with bounded LRU cache',
            mode: 'delta',
            deltaItems: [{ kind: 'added', area: 'search/cache', text: 'Add 64MB in-memory LRU.' }],
            planMarkdown: ['# Search Cache Layer', '1. Add cache map.', '2. Skip invalidation.'].join('\n'),
            revisionSummary: 'Initial draft',
          },
        });
        assert.equal(v1.isError, undefined);

        const annCall = await client.callTool({
          name: 'app_spec_annotate',
          arguments: {
            specId: 'spec-mcp-v07',
            lineStart: 3,
            lineEnd: 3,
            kind: 'replace',
            note: 'Invalidation is mandatory on write.',
            suggestedText: '2. Invalidate cache keys on write events.',
          },
        });
        assert.equal(annCall.isError, undefined);
        const annId = (annCall.structuredContent as { annotation: { id: string } }).annotation.id;

        const getStateCall = await client.callTool({
          name: 'spec_get_state',
          arguments: { specId: 'spec-mcp-v07' },
        });
        assert.equal(getStateCall.isError, undefined);
        const getText = (getStateCall.content as Array<{ text?: string }>)[0]?.text ?? '';
        assert.match(getText, /1 unresolved inline annotation/i);
        assert.equal(
          (getStateCall.structuredContent as { unresolvedAnnotations: number }).unresolvedAnnotations,
          1,
        );

        const v2 = await client.callTool({
          name: 'spec_create_or_update',
          arguments: {
            id: 'spec-mcp-v07',
            title: 'Search Cache Layer',
            goal: 'Reduce p99 query latency with bounded LRU cache',
            mode: 'delta',
            planMarkdown: [
              '# Search Cache Layer',
              '1. Add bounded 64MB LRU cache map.',
              '2. Invalidate cache keys on write events.',
            ].join('\n'),
            revisionSummary: 'Addressed annotation on cache invalidation',
          },
        });
        assert.equal(v2.isError, undefined);
        assert.equal((v2.structuredContent as { spec: SpecDocumentView }).spec.revision, 2);

        const diffCall = await client.callTool({
          name: 'app_spec_diff_revisions',
          arguments: { specId: 'spec-mcp-v07' },
        });
        assert.equal(diffCall.isError, undefined);
        const diffData = diffCall.structuredContent as {
          fromRevision: number;
          toRevision: number;
          addedLines: number;
          removedLines: number;
        };
        assert.equal(diffData.fromRevision, 1);
        assert.equal(diffData.toRevision, 2);
        assert.equal(diffData.addedLines, 2);
        assert.equal(diffData.removedLines, 2);

        const resolveCall = await client.callTool({
          name: 'app_spec_resolve_annotation',
          arguments: { specId: 'spec-mcp-v07', annotationId: annId, action: 'resolve' },
        });
        assert.equal(resolveCall.isError, undefined);
        assert.equal(
          (resolveCall.structuredContent as { spec: SpecDocumentView }).spec.unresolvedAnnotations,
          0,
        );

        const archiveCall = await client.callTool({
          name: 'app_spec_archive_to_mem',
          arguments: { specId: 'spec-mcp-v07' },
        });
        assert.equal(archiveCall.isError, undefined);
        assert.ok(
          ((archiveCall.structuredContent as { memoryId: string }).memoryId ?? '').startsWith('mem_'),
        );

        // Disable spec again -> write app_spec_* tools must be disabled synchronously
        await bundle.setModule('spec', false);
        const disabledAgain = await client.listTools();
        const disabledNames = new Set(disabledAgain.tools.map((t) => t.name));
        for (const modelName of MODULE_CATALOG.spec.modelToolNames) {
          assert.equal(disabledNames.has(modelName), false);
        }
        for (const writeAppName of WRITE_APP_SPEC_TOOLS) {
          assert.equal(disabledNames.has(writeAppName), false);
        }
        for (const roName of READONLY_APP_SPEC_TOOLS) {
          assert.equal(disabledNames.has(roName), true);
        }
      } finally {
        await client.close();
        await bundle.dispose();
      }
    });
  });

  it('ships rich demo specs with multi-revision history, delta items, and sample annotations', () => {
    const demo = createDemoSpecState();
    assert.equal(demo.specs.length, 2);
    const active = demo.specs.find((s) => s.id === demo.activeSpecId);
    assert.ok(active);
    assert.equal(active.mode, 'delta');
    assert.equal(active.revision, 2);
    assert.equal(active.revisions.length, 2);
    assert.ok(active.deltaItems.length >= 3);
    assert.ok(active.annotations.length >= 2);

    const diff = diffSpecRevisions(active);
    assert.equal(diff.ok, true);
    assert.equal(diff.fromRevision, 1);
    assert.equal(diff.toRevision, 2);
    assert.ok(diff.diff.addedLines > 0 && diff.diff.removedLines > 0);
  });
});
