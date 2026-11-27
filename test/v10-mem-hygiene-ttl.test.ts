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
import { handleMemSessionStartHook, handleMemStopHook } from '../src/modules/mem/hook.js';
import { registerMemModule } from '../src/modules/mem/register.js';
import {
  computeHygieneSummary,
  DEFAULT_AUTO_CAPTURE_TTL_DAYS,
  evaluateMemoryHygiene,
  MemoryStore,
} from '../src/modules/mem/store.js';
import type {
  BatchHygieneResult,
  MemoryHygieneSummary,
  MemoryIndexEntry,
  MemoryItem,
  MemoryTimelineEntry,
} from '../src/modules/mem/types.js';
import { createNovServer } from '../src/server/index.js';

const UI_RESOURCE_URI = 'ui://agy-nov/app.html';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function withTempDirs<T>(
  fn: (dirs: { root: string; dataDir: string; workspaceDir: string }) => Promise<T> | T,
): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-nov-v10-mem-'));
  const dataDir = path.join(root, 'data');
  const workspaceDir = path.join(root, 'workspace');
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
  const client = new Client({ name: 'test-v10-mem-hygiene', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await Promise.allSettled([client.close(), server.close()]);
    },
  };
}

describe('Mem 3.0 — Memory Hygiene, Confidence & TTL Governance (T10.2)', () => {
  it('smoothly loads legacy memories.json without new fields using safe defaults (normal / healthy)', async () => {
    await withTempDirs(({ dataDir, workspaceDir }) => {
      const memDir = getModuleDataDir(dataDir, 'mem');
      fs.mkdirSync(memDir, { recursive: true });
      const legacyJson = [
        {
          id: 'mem_legacy_01',
          kind: 'architecture',
          title: 'Legacy Architecture Record',
          content: 'Stored before v1.0.0 without confidence, source, ttlDays, or expiresAt.',
          tags: ['legacy'],
          workspacePath: workspaceDir,
          anchors: [],
          pinned: false,
          createdAt: '2026-01-10T08:00:00.000Z',
          updatedAt: '2026-01-10T08:00:00.000Z',
          recallCount: 2,
        },
      ];
      fs.writeFileSync(path.join(memDir, 'memories.json'), JSON.stringify(legacyJson, null, 2), 'utf8');

      const store = new MemoryStore(memDir, false, workspaceDir);
      const items = store.list({ workspacePath: workspaceDir });
      assert.equal(items.length, 1);
      assert.equal(items[0].confidence, 'normal');
      assert.equal(items[0].source, 'manual');
      assert.equal(items[0].ttlDays, null);
      assert.equal(items[0].expiresAt, null);
      assert.equal(items[0].hygieneStatus, 'healthy');

      const summary = store.getHygieneSummary({ workspacePath: workspaceDir });
      assert.equal(summary.total, 1);
      assert.equal(summary.healthy, 1);
      assert.equal(summary.needsReview, 0);
      assert.equal(summary.staleTtl, 0);
      assert.equal(summary.drifted, 0);
      assert.equal(summary.tentative, 0);
      assert.deepEqual(summary.expiredIds, []);
      assert.deepEqual(summary.reviewIds, []);

      const injection = store.buildSessionStartInjection([workspaceDir]);
      assert.match(injection, /mem_legacy_01/);
      assert.match(injection, /Legacy Architecture Record/);
    });
  });

  it('evaluates evaluateMemoryHygiene and computeHygieneSummary across pinned, drifted, stale_ttl, needs_review, and healthy rules', () => {
    const nowMs = Date.parse('2026-11-27T12:00:00.000Z');
    const iso = (deltaDays: number) => new Date(nowMs + deltaDays * MS_PER_DAY).toISOString();

    const items: MemoryItem[] = [
      {
        id: 'm_healthy_verified',
        kind: 'architecture',
        title: 'Verified Healthy',
        content: 'Long-term verified fact',
        tags: [],
        anchors: [],
        pinned: false,
        createdAt: iso(-10),
        updatedAt: iso(-10),
        verifiedAt: iso(-2),
        recallCount: 0,
        drifted: false,
        confidence: 'verified',
        ttlDays: 30,
        expiresAt: iso(28),
      },
      {
        id: 'm_pinned_past_ttl',
        kind: 'decision',
        title: 'Pinned Immune To Stale TTL',
        content: 'Pinned memory must never become stale_ttl',
        tags: [],
        anchors: [],
        pinned: true,
        createdAt: iso(-40),
        updatedAt: iso(-40),
        recallCount: 0,
        drifted: false,
        confidence: 'normal',
        ttlDays: 7,
        expiresAt: iso(-33),
      },
      {
        id: 'm_pinned_tentative',
        kind: 'decision',
        title: 'Pinned Tentative Needs Review',
        content: 'Pinned tentative still surfaces for review',
        tags: [],
        anchors: [],
        pinned: true,
        createdAt: iso(-20),
        updatedAt: iso(-20),
        recallCount: 0,
        drifted: false,
        confidence: 'tentative',
        ttlDays: 7,
        expiresAt: iso(-13),
      },
      {
        id: 'm_pinned_drifted',
        kind: 'pitfall',
        title: 'Pinned Drifted',
        content: 'Code anchor drifted',
        tags: [],
        anchors: [],
        pinned: true,
        createdAt: iso(-5),
        updatedAt: iso(-5),
        recallCount: 0,
        drifted: true,
        confidence: 'verified',
        ttlDays: null,
        expiresAt: null,
      },
      {
        id: 'm_stale_ttl',
        kind: 'decision',
        title: 'Expired Tentative',
        content: 'Old auto capture',
        tags: [],
        anchors: [],
        pinned: false,
        createdAt: iso(-20),
        updatedAt: iso(-20),
        recallCount: 0,
        drifted: false,
        confidence: 'tentative',
        ttlDays: 14,
        expiresAt: iso(-6),
      },
      {
        id: 'm_expiring_soon',
        kind: 'convention',
        title: 'Expiring Within 3 Days',
        content: 'Normal item with 2 days remaining',
        tags: [],
        anchors: [],
        pinned: false,
        createdAt: iso(-28),
        updatedAt: iso(-28),
        recallCount: 0,
        drifted: false,
        confidence: 'normal',
        ttlDays: 30,
        expiresAt: iso(2),
      },
      {
        id: 'm_tentative_fresh',
        kind: 'preference',
        title: 'Fresh Tentative',
        content: 'Active tentative item',
        tags: [],
        anchors: [],
        pinned: false,
        createdAt: iso(-1),
        updatedAt: iso(-1),
        recallCount: 0,
        drifted: false,
        confidence: 'tentative',
        ttlDays: 14,
        expiresAt: iso(13),
      },
    ];

    assert.equal(evaluateMemoryHygiene(items[0], nowMs), 'healthy');
    assert.equal(evaluateMemoryHygiene(items[1], nowMs), 'healthy');
    assert.equal(evaluateMemoryHygiene(items[2], nowMs), 'needs_review');
    assert.equal(evaluateMemoryHygiene(items[3], nowMs), 'drifted');
    assert.equal(evaluateMemoryHygiene(items[4], nowMs), 'stale_ttl');
    assert.equal(evaluateMemoryHygiene(items[5], nowMs), 'needs_review');
    assert.equal(evaluateMemoryHygiene(items[6], nowMs), 'needs_review');

    // Also verifies dynamic expiresAt derivation when only ttlDays + updatedAt are present
    assert.equal(
      evaluateMemoryHygiene(
        {
          pinned: false,
          drifted: false,
          confidence: 'normal',
          ttlDays: 10,
          createdAt: iso(-15),
          updatedAt: iso(-15),
        },
        nowMs,
      ),
      'stale_ttl',
    );

    const summary = computeHygieneSummary(items, nowMs);
    assert.equal(summary.total, 7);
    assert.equal(summary.healthy, 2);
    assert.equal(summary.needsReview, 3);
    assert.equal(summary.staleTtl, 1);
    assert.equal(summary.drifted, 1);
    assert.equal(summary.tentative, 3);
    assert.deepEqual(summary.expiredIds, ['m_stale_ttl']);
    assert.deepEqual(summary.reviewIds, [
      'm_pinned_tentative',
      'm_expiring_soon',
      'm_tentative_fresh',
    ]);
  });

  it('defaults Stop hook auto-capture to source=auto_capture, confidence=tentative, ttlDays=14 and tags L1 Index with [TENTATIVE]', async () => {
    await withTempDirs(({ dataDir, workspaceDir }) => {
      const editedFile = path.join(workspaceDir, 'queue.ts');
      fs.writeFileSync(editedFile, 'export const retries = 3;\n', 'utf8');
      const transcriptPath = path.join(workspaceDir, 'transcript.jsonl');
      fs.writeFileSync(
        transcriptPath,
        `${JSON.stringify({ tool_calls: [{ name: 'edit_file', args: { Path: editedFile } }] })}\n`,
        'utf8',
      );

      handleMemStopHook(
        normalizeHookPayload(
          {
            conversationId: 'conv-hygiene-001',
            workspacePaths: [workspaceDir],
            transcriptPath,
            lastUserInput: 'Tune retry queue circuit breaker thresholds for staging traffic',
          },
          'Stop',
        ),
        dataDir,
      );

      const memDir = getModuleDataDir(dataDir, 'mem');
      const store = new MemoryStore(memDir, false, workspaceDir);
      const items = store.list({ workspacePath: workspaceDir });
      assert.equal(items.length, 1);

      const captured = items[0];
      assert.equal(captured.source, 'auto_capture');
      assert.equal(captured.confidence, 'tentative');
      assert.equal(captured.ttlDays, DEFAULT_AUTO_CAPTURE_TTL_DAYS);
      assert.equal(captured.ttlDays, 14);
      assert.equal(captured.hygieneStatus, 'needs_review');
      assert.ok(captured.expiresAt);
      const deltaDays = (Date.parse(captured.expiresAt) - Date.parse(captured.updatedAt)) / MS_PER_DAY;
      assert.ok(Math.abs(deltaDays - 14) < 0.01);

      // Active auto-captured tentative item appears in SessionStart L1 Index with [TENTATIVE] marker
      const hookRes = handleMemSessionStartHook(
        normalizeHookPayload({ workspacePaths: [workspaceDir] }, 'SessionStart'),
        dataDir,
      );
      assert.equal(hookRes.injectSteps?.length, 1);
      const injected = (hookRes.injectSteps?.[0] as { systemMessage: { systemMessage: string } })
        .systemMessage.systemMessage;
      assert.match(injected, /\[TENTATIVE\]/);
      assert.match(injected, /mem_auto_conv-hygiene/);
    });
  });

  it('excludes expired tentative memories from SessionStart & default mem_recall, allows includeExpired=true recovery, keeps pinned immune, and boosts verified/pinned ranking', async () => {
    await withTempDirs(async ({ dataDir, workspaceDir }) => {
      const memDir = getModuleDataDir(dataDir, 'mem');
      fs.mkdirSync(memDir, { recursive: true });

      const anchorFile = path.join(workspaceDir, 'cache.ts');
      fs.writeFileSync(anchorFile, 'export const v = 2;\n', 'utf8');

      const nowMs = Date.now();
      const iso = (deltaDays: number) => new Date(nowMs + deltaDays * MS_PER_DAY).toISOString();

      const seed: MemoryItem[] = [
        {
          id: 'mem_expired_tentative',
          kind: 'pitfall',
          title: 'Cache probe expired tentative hypothesis',
          content: 'Temporary cache probe workaround that has expired and should stay filtered by default.',
          tags: ['cache', 'probe'],
          workspacePath: workspaceDir,
          anchors: [],
          pinned: false,
          createdAt: iso(-25),
          updatedAt: iso(-22),
          recallCount: 0,
          confidence: 'tentative',
          source: 'auto_capture',
          ttlDays: 14,
          expiresAt: iso(-8),
        },
        {
          id: 'mem_pinned_old_ttl',
          kind: 'architecture',
          title: 'Cache probe pinned invariant',
          content: 'Pinned cache probe invariant remains active even when ttl timestamp has elapsed.',
          tags: ['cache', 'probe'],
          workspacePath: workspaceDir,
          anchors: [],
          pinned: true,
          createdAt: iso(-40),
          updatedAt: iso(-40),
          recallCount: 0,
          confidence: 'normal',
          source: 'manual',
          ttlDays: 7,
          expiresAt: iso(-33),
        },
        {
          id: 'mem_active_verified',
          kind: 'decision',
          title: 'Cache probe verified policy',
          content: 'Verified cache probe policy with bounded connection pool and fallback.',
          tags: ['cache', 'probe'],
          workspacePath: workspaceDir,
          anchors: [],
          pinned: false,
          createdAt: iso(-5),
          updatedAt: iso(-5),
          verifiedAt: iso(-1),
          recallCount: 0,
          confidence: 'verified',
          source: 'manual',
          ttlDays: 60,
          expiresAt: iso(59),
        },
        {
          id: 'mem_active_tentative',
          kind: 'decision',
          title: 'Cache probe tentative note',
          content: 'Verified-equivalent phrasing? Active tentative cache probe note awaiting confirmation.',
          tags: ['cache', 'probe'],
          workspacePath: workspaceDir,
          anchors: [],
          pinned: false,
          createdAt: iso(-1),
          updatedAt: iso(-1),
          recallCount: 0,
          confidence: 'tentative',
          source: 'auto_capture',
          ttlDays: 14,
          expiresAt: iso(13),
        },
        {
          id: 'mem_drifted_anchor',
          kind: 'pitfall',
          title: 'Cache probe drifted anchor record',
          content: 'Anchored cache probe file changed hash.',
          tags: ['cache', 'probe'],
          workspacePath: workspaceDir,
          anchors: [
            {
              filePath: anchorFile,
              basename: 'cache.ts',
              uri: `file://${anchorFile}`,
              sha256: '0000000000000000',
              driftStatus: 'fresh',
            },
          ],
          pinned: false,
          createdAt: iso(-3),
          updatedAt: iso(-3),
          recallCount: 0,
          confidence: 'normal',
          source: 'manual',
          ttlDays: null,
          expiresAt: null,
        },
      ];
      fs.writeFileSync(path.join(memDir, 'memories.json'), JSON.stringify(seed, null, 2), 'utf8');

      // 1. SessionStart L1 Index excludes expired tentative & drifted, retains pinned (immune) + active tentative ([TENTATIVE])
      const startHook = handleMemSessionStartHook(
        normalizeHookPayload({ workspacePaths: [workspaceDir] }, 'SessionStart'),
        dataDir,
      );
      const l1Injection = (startHook.injectSteps?.[0] as { systemMessage: { systemMessage: string } })
        .systemMessage.systemMessage;
      assert.doesNotMatch(l1Injection, /mem_expired_tentative/);
      assert.doesNotMatch(l1Injection, /mem_drifted_anchor/);
      assert.match(l1Injection, /mem_pinned_old_ttl/);
      assert.match(l1Injection, /mem_active_verified/);
      assert.match(l1Injection, /mem_active_tentative.*\[TENTATIVE\]|\[TENTATIVE\].*Cache probe tentative note/);

      // 2. MCP mem_recall end-to-end checks
      const server = new McpServer(
        { name: 'test-v10-recall', version: '1.0.0' },
        { capabilities: { tools: {} } },
      );
      const reg = registerMemModule(
        server,
        { dataDir, workspaceRoot: workspaceDir, demoMode: false },
        UI_RESOURCE_URI,
      );
      assert.equal(reg.modelTools.length, 3);
      assert.deepEqual(
        reg.modelTools.map((t) => t.name),
        MODULE_CATALOG.mem.modelToolNames,
      );

      const { client, close } = await connectInMemoryClient(server);
      try {
        // Default detail recall excludes expired tentative memory
        const defaultDetail = await client.callTool({
          name: 'mem_recall',
          arguments: { query: 'cache probe', mode: 'detail' },
        });
        const detailSc = defaultDetail.structuredContent as { items: MemoryItem[] };
        const detailIds = detailSc.items.map((i) => i.id);
        assert.equal(detailIds.includes('mem_expired_tentative'), false);
        assert.equal(detailIds.includes('mem_pinned_old_ttl'), true);
        assert.equal(detailIds.includes('mem_active_verified'), true);

        // Verified/pinned entries rank above tentative entry on matching query
        const idxVerified = detailIds.indexOf('mem_active_verified');
        const idxPinned = detailIds.indexOf('mem_pinned_old_ttl');
        const idxTentative = detailIds.indexOf('mem_active_tentative');
        assert.ok(idxPinned >= 0 && idxVerified >= 0 && idxTentative >= 0);
        assert.ok(idxPinned < idxTentative, 'Pinned entry should outrank tentative entry');
        assert.ok(idxVerified < idxTentative, 'Verified entry should outrank tentative entry');

        // Exact ID lookup also excludes expired unless includeExpired=true
        const excludedById = await client.callTool({
          name: 'mem_recall',
          arguments: { mode: 'detail', ids: ['mem_expired_tentative'] },
        });
        assert.equal((excludedById.structuredContent as { totalHits: number }).totalHits, 0);

        // includeExpired=true recovers expired tentative memory across detail, index, and timeline
        const recoveredDetail = await client.callTool({
          name: 'mem_recall',
          arguments: { mode: 'detail', ids: ['mem_expired_tentative'], includeExpired: true },
        });
        const recoveredSc = recoveredDetail.structuredContent as {
          totalHits: number;
          items: MemoryItem[];
        };
        assert.equal(recoveredSc.totalHits, 1);
        assert.equal(recoveredSc.items[0]?.id, 'mem_expired_tentative');
        assert.equal(recoveredSc.items[0]?.hygieneStatus, 'stale_ttl');

        // L1 index mode carries [DRIFT], [TENTATIVE], and [EXPIRED] markers when recovered
        const recoveredIndex = await client.callTool({
          name: 'mem_recall',
          arguments: { query: 'cache probe', mode: 'index', includeExpired: true },
        });
        const idxText = (recoveredIndex.content as Array<{ text: string }>)[0].text;
        const idxMatches = (recoveredIndex.structuredContent as { matches: MemoryIndexEntry[] })
          .matches;
        assert.ok(idxMatches.some((e) => e.id === 'mem_expired_tentative' && e.hygieneStatus === 'stale_ttl'));
        assert.ok(idxMatches.some((e) => e.id === 'mem_drifted_anchor' && e.hygieneStatus === 'drifted'));
        assert.match(idxText, /\[DRIFT\]/);
        assert.match(idxText, /\[TENTATIVE\]/);
        assert.match(idxText, /\[EXPIRED\]/);

        // L2 timeline entries expose confidence, hygieneStatus, and expiresAt
        const timelineRes = await client.callTool({
          name: 'mem_recall',
          arguments: { mode: 'timeline', ids: ['mem_expired_tentative'], window: 1, includeExpired: true },
        });
        const timeline = (timelineRes.structuredContent as { timeline: MemoryTimelineEntry[] })
          .timeline;
        const expiredEntry = timeline.find((e) => e.id === 'mem_expired_tentative');
        assert.ok(expiredEntry);
        assert.equal(expiredEntry.confidence, 'tentative');
        assert.equal(expiredEntry.hygieneStatus, 'stale_ttl');
        assert.ok(expiredEntry.expiresAt);
      } finally {
        await close();
      }
    });
  });

  it('supports app_mem_get_hygiene_summary and app_mem_batch_hygiene (verify, refresh_ttl, prune) and disables write tool when mem module is off', async () => {
    await withTempDirs(async ({ dataDir, workspaceDir }) => {
      const bundle = createNovServer({
        dataDir,
        workspaceRoot: workspaceDir,
        demoMode: false,
        configPollMs: 0,
      });

      const { client, close } = await connectInMemoryClient(bundle.server);
      try {
        // Default preset ('core') has mem disabled:
        // - app_mem_get_hygiene_summary MUST remain available (read-only exempt) and create zero files
        // - app_mem_batch_hygiene and model tools MUST be disabled
        assert.equal(bundle.getConfig().modules.mem, false);

        const toolsWhenOff = await client.listTools();
        const namesWhenOff = new Set(toolsWhenOff.tools.map((t) => t.name));
        assert.equal(namesWhenOff.has('app_mem_get_hygiene_summary'), true);
        assert.equal(namesWhenOff.has('app_mem_batch_hygiene'), false);
        assert.equal(namesWhenOff.has('mem_remember'), false);
        assert.equal(namesWhenOff.has('mem_recall'), false);
        assert.equal(namesWhenOff.has('mem_forget'), false);

        const summaryOff = await client.callTool({
          name: 'app_mem_get_hygiene_summary',
          arguments: {},
        });
        assert.equal(summaryOff.isError, undefined);
        const summaryOffSc = summaryOff.structuredContent as { summary: MemoryHygieneSummary };
        assert.equal(summaryOffSc.summary.total, 0);
        assert.equal(
          fs.existsSync(getModuleDataDir(dataDir, 'mem')),
          false,
          'Read-only hygiene summary must not create mem directory when absent',
        );

        // Calling disabled app_mem_batch_hygiene must fail / reject
        let blocked = false;
        try {
          const res = await client.callTool({
            name: 'app_mem_batch_hygiene',
            arguments: { ids: ['mem_x'], action: 'verify' },
          });
          if (res.isError) blocked = true;
        } catch {
          blocked = true;
        }
        assert.equal(blocked, true, 'app_mem_batch_hygiene must be disabled when mem module is off');

        // Enable mem module and check exact tool exposure & visibility metadata
        await bundle.setModule('mem', true);
        const toolsWhenOn = await client.listTools();
        const memModelVisible = toolsWhenOn.tools.filter(
          (t) => t.name.startsWith('mem_') && !(t._meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility,
        );
        assert.deepEqual(
          memModelVisible.map((t) => t.name),
          ['mem_remember', 'mem_recall', 'mem_forget'],
        );
        const summaryToolDef = toolsWhenOn.tools.find((t) => t.name === 'app_mem_get_hygiene_summary');
        const batchToolDef = toolsWhenOn.tools.find((t) => t.name === 'app_mem_batch_hygiene');
        assert.deepEqual(
          (summaryToolDef?._meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility,
          ['app'],
        );
        assert.deepEqual(
          (batchToolDef?._meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility,
          ['app'],
        );

        // Create 3 memories via mem_remember with new optional confidence & ttlDays
        const m1 = await client.callTool({
          name: 'mem_remember',
          arguments: {
            kind: 'decision',
            title: 'Tentative retry threshold',
            content: 'Candidate backoff multiplier 2.5x pending soak test.',
            confidence: 'tentative',
            ttlDays: 10,
          },
        });
        const m1Id = (m1.structuredContent as { id: string }).id;
        assert.equal((m1.structuredContent as { confidence: string }).confidence, 'tentative');
        assert.equal((m1.structuredContent as { ttlDays: number | null }).ttlDays, 10);

        const m2 = await client.callTool({
          name: 'mem_remember',
          arguments: {
            kind: 'convention',
            title: 'Short-lived migration guard',
            content: 'Temporary migration switch valid during rollout week.',
            confidence: 'normal',
            ttlDays: 2,
          },
        });
        const m2Id = (m2.structuredContent as { id: string }).id;
        assert.equal((m2.structuredContent as { hygieneStatus: string }).hygieneStatus, 'needs_review');

        const m3 = await client.callTool({
          name: 'mem_remember',
          arguments: {
            kind: 'pitfall',
            title: 'Disposable scratch observation',
            content: 'Temporary observation to be pruned in batch.',
            confidence: 'tentative',
            ttlDays: 7,
          },
        });
        const m3Id = (m3.structuredContent as { id: string }).id;

        const summaryBefore = await client.callTool({
          name: 'app_mem_get_hygiene_summary',
          arguments: {},
        });
        const sumBefore = (summaryBefore.structuredContent as { summary: MemoryHygieneSummary })
          .summary;
        assert.equal(sumBefore.total, 3);
        assert.equal(sumBefore.needsReview, 3);
        assert.equal(sumBefore.tentative, 2);

        // 1. Batch verify m1 -> confidence='verified', verifiedAt set, ttlDays=null, hygieneStatus='healthy'
        const verifyRes = await client.callTool({
          name: 'app_mem_batch_hygiene',
          arguments: { ids: [m1Id], action: 'verify' },
        });
        const verifySc = verifyRes.structuredContent as {
          result: BatchHygieneResult;
          memories: MemoryItem[];
        };
        assert.equal(verifySc.result.updatedCount, 1);
        const verifiedItem = verifySc.memories.find((m) => m.id === m1Id);
        assert.ok(verifiedItem);
        assert.equal(verifiedItem.confidence, 'verified');
        assert.ok(verifiedItem.verifiedAt);
        assert.equal(verifiedItem.ttlDays, null);
        assert.equal(verifiedItem.expiresAt, null);
        assert.equal(verifiedItem.hygieneStatus, 'healthy');

        // 2. Batch refresh_ttl on m2 (default +30d) -> extends expiresAt and transitions to healthy
        const refreshRes = await client.callTool({
          name: 'app_mem_batch_hygiene',
          arguments: { ids: [m2Id], action: 'refresh_ttl' },
        });
        const refreshSc = refreshRes.structuredContent as {
          result: BatchHygieneResult;
          memories: MemoryItem[];
        };
        assert.equal(refreshSc.result.updatedCount, 1);
        const refreshedItem = refreshSc.memories.find((m) => m.id === m2Id);
        assert.ok(refreshedItem);
        assert.equal(refreshedItem.ttlDays, 30);
        assert.ok(refreshedItem.expiresAt);
        assert.equal(refreshedItem.hygieneStatus, 'healthy');

        // 3. Batch prune m3 -> deletedCount=1 and removed from disk
        const pruneRes = await client.callTool({
          name: 'app_mem_batch_hygiene',
          arguments: { ids: [m3Id], action: 'prune' },
        });
        const pruneSc = pruneRes.structuredContent as {
          result: BatchHygieneResult;
          memories: MemoryItem[];
          hygieneSummary: MemoryHygieneSummary;
        };
        assert.equal(pruneSc.result.deletedCount, 1);
        assert.equal(pruneSc.memories.some((m) => m.id === m3Id), false);
        assert.equal(pruneSc.hygieneSummary.total, 2);
        assert.equal(pruneSc.hygieneSummary.healthy, 2);

        // Verify 0600 file permissions on persisted memories.json (POSIX)
        const diskFile = path.join(getModuleDataDir(dataDir, 'mem'), 'memories.json');
        assert.equal(fs.existsSync(diskFile), true);
        if (process.platform !== 'win32') {
          const mode = fs.statSync(diskFile).mode & 0o777;
          assert.equal(mode, 0o600);
        }

        // Verify UI app_mem_add_memory forwards confidence & ttlDays while keeping <private> stripping & secret redaction
        const syntheticTestKey = ['sk', 'abcdef1234567890abcdef'].join('-');
        const uiAddRes = await client.callTool({
          name: 'app_mem_add_memory',
          arguments: {
            kind: 'architecture',
            title: 'UI Hygiene Card <private>hidden-title</private>',
            content: `Always validate tokens <private>drop-me</private> never log ${syntheticTestKey}`,
            tags: ['hygiene'],
            pinned: false,
            confidence: 'verified',
            ttlDays: 45,
          },
        });
        const uiAddMemories = (uiAddRes.structuredContent as { memories: MemoryItem[] }).memories;
        const addedViaUi = uiAddMemories.find((m) => m.title === 'UI Hygiene Card');
        assert.ok(addedViaUi);
        assert.equal(addedViaUi.confidence, 'verified');
        assert.equal(addedViaUi.ttlDays, 45);
        assert.equal(addedViaUi.hygieneStatus, 'healthy');
        assert.ok(addedViaUi.expiresAt);
        assert.match(addedViaUi.content, /\[REDACTED_KEY\]/);
        assert.equal(addedViaUi.content.includes('drop-me'), false);
        assert.equal(addedViaUi.content.includes(syntheticTestKey), false);

        // Red-team regression: MemoryStore public methods validate invalid action/confidence/source & recompute TTL from now on explicit ttlDays change
        const directStore = new MemoryStore(getModuleDataDir(dataDir, 'mem'), false);
        assert.throws(
          () => directStore.batchHygieneMemories([addedViaUi.id], 'bogus_action' as never),
          /invalid.*action/i,
        );
        const sanitizedMem = directStore.remember({
          kind: 'convention',
          title: 'Sanitized Invalid Enum Test',
          content: 'Verify invalid confidence/source fallback safely.',
          confidence: 'bogus_level' as never,
          source: 'bogus_source' as never,
        });
        assert.equal(sanitizedMem.confidence, 'normal');
        assert.equal(sanitizedMem.source, 'manual');
        const oldVerifiedIso = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
        const seededOld = directStore.remember({
          kind: 'decision',
          title: 'Old Verified Memory',
          content: 'Verified 20 days ago',
          confidence: 'verified',
          verifiedAt: oldVerifiedIso,
        });
        const updatedWithNewTtl = directStore.remember({
          id: seededOld.id,
          kind: 'decision',
          title: 'Old Verified Memory',
          content: 'Updated with fresh 14-day TTL',
          ttlDays: 14,
        });
        assert.equal(updatedWithNewTtl.hygieneStatus, 'healthy');

        // Disable mem again and confirm app_mem_batch_hygiene re-disables while summary stays readable
        await bundle.setModule('mem', false);
        const toolsAfterReOff = await client.listTools();
        const namesAfterReOff = new Set(toolsAfterReOff.tools.map((t) => t.name));
        assert.equal(namesAfterReOff.has('app_mem_batch_hygiene'), false);
        assert.equal(namesAfterReOff.has('app_mem_get_hygiene_summary'), true);
      } finally {
        await close();
        await bundle.dispose();
      }
    });
  });

  it('never creates missing dataDir on live read-only hygiene queries or no-op batch requests', async () => {
    await withTempDirs(async ({ root, workspaceDir }) => {
      const missingDataDir = path.join(root, 'live-absent-data');
      const server = new McpServer(
        { name: 'test-v10-absent-live', version: '1.0.0' },
        { capabilities: { tools: {} } },
      );
      registerMemModule(
        server,
        { dataDir: missingDataDir, workspaceRoot: workspaceDir, demoMode: false },
        UI_RESOURCE_URI,
      );
      const { client, close } = await connectInMemoryClient(server);
      try {
        const sumRes = await client.callTool({
          name: 'app_mem_get_hygiene_summary',
          arguments: {},
        });
        assert.equal((sumRes.structuredContent as { summary: MemoryHygieneSummary }).summary.total, 0);

        const noopBatch = await client.callTool({
          name: 'app_mem_batch_hygiene',
          arguments: { ids: ['mem_nonexistent'], action: 'prune' },
        });
        assert.equal(
          (noopBatch.structuredContent as { result: BatchHygieneResult }).result.deletedCount,
          0,
        );
        assert.equal(
          fs.existsSync(missingDataDir),
          false,
          'Absent dataDir must remain untouched after read-only or no-op hygiene calls',
        );
      } finally {
        await close();
      }
    });
  });

  it('keeps demoMode strictly zero-disk-write across hygiene summary, batch actions, and model tools while exposing exact 3 model tools', async () => {
    await withTempDirs(async ({ root, workspaceDir }) => {
      const missingDataDir = path.join(root, 'never-created-demo-data');
      const server = new McpServer(
        { name: 'test-v10-demo', version: '1.0.0' },
        { capabilities: { tools: {} } },
      );
      const reg = registerMemModule(
        server,
        { dataDir: missingDataDir, workspaceRoot: workspaceDir, demoMode: true },
        UI_RESOURCE_URI,
      );

      assert.equal(reg.modelTools.length, 3);
      assert.deepEqual(
        reg.modelTools.map((t) => t.name),
        ['mem_remember', 'mem_recall', 'mem_forget'],
      );
      assert.deepEqual(reg.exemptReadOnlyAppTools, ['app_mem_get_hygiene_summary']);

      const { client, close } = await connectInMemoryClient(server);
      try {
        const summaryRes = await client.callTool({
          name: 'app_mem_get_hygiene_summary',
          arguments: {},
        });
        const sum = (summaryRes.structuredContent as { summary: MemoryHygieneSummary }).summary;
        assert.ok(sum.total >= 7);
        assert.ok(sum.healthy >= 2);
        assert.ok(sum.needsReview >= 1);
        assert.ok(sum.staleTtl >= 1);
        assert.ok(sum.drifted >= 1);
        assert.ok(sum.expiredIds.includes('mem_demo_stale_spike'));

        // Default recall in demo mode excludes stale demo entry
        const defaultDemoRecall = await client.callTool({
          name: 'mem_recall',
          arguments: { query: 'staging cache probe', mode: 'detail' },
        });
        assert.equal(
          (defaultDemoRecall.structuredContent as { items: MemoryItem[] }).items.some(
            (m) => m.id === 'mem_demo_stale_spike',
          ),
          false,
        );

        // Batch verify + refresh_ttl + prune operate cleanly in memory with zero disk writes
        const verifyDemo = await client.callTool({
          name: 'app_mem_batch_hygiene',
          arguments: { ids: ['mem_demo_auto_retry'], action: 'verify' },
        });
        assert.equal(
          (verifyDemo.structuredContent as { result: BatchHygieneResult }).result.updatedCount,
          1,
        );

        const refreshDemo = await client.callTool({
          name: 'app_mem_batch_hygiene',
          arguments: { ids: ['mem_demo_pref'], action: 'refresh_ttl', ttlDays: 30 },
        });
        assert.equal(
          (refreshDemo.structuredContent as { result: BatchHygieneResult }).result.updatedCount,
          1,
        );

        const pruneDemo = await client.callTool({
          name: 'app_mem_batch_hygiene',
          arguments: { ids: ['mem_demo_stale_spike'], action: 'prune' },
        });
        assert.equal(
          (pruneDemo.structuredContent as { result: BatchHygieneResult }).result.deletedCount,
          1,
        );

        assert.equal(
          fs.existsSync(missingDataDir),
          false,
          'demoMode must strictly perform zero disk writes even after batch hygiene mutations',
        );
      } finally {
        await close();
      }
    });
  });
});
