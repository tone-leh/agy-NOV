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
  MAX_SESSION_START_CHARS,
  MemoryStore,
  PRIVATE_CONTENT_PLACEHOLDER,
  stripPrivateTags,
} from '../src/modules/mem/store.js';
import type {
  MemoryIndexEntry,
  MemoryItem,
  MemoryProgressivePreview,
  MemoryProgressiveStats,
  MemoryTimelineEntry,
} from '../src/modules/mem/types.js';

const UI_RESOURCE_URI = 'ui://agy-nov/app.html';

function withTempDirs<T>(
  fn: (dirs: { root: string; dataDir: string; workspaceDir: string }) => Promise<T> | T,
): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-nov-v06-mem-'));
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
  const client = new Client({ name: 'test-v06-mem', version: '0.6.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await Promise.allSettled([client.close(), server.close()]);
    },
  };
}

describe('Mem 2.0 — <private> Stripping & 3-Layer Progressive Disclosure', () => {
  describe('stripPrivateTags & privacy guardrails', () => {
    it('strips closed, multi-segment, mixed-case, multiline, nested, and unclosed <private> tags in O(n) time', () => {
      // Plain text unchanged
      const plain = stripPrivateTags('Use single-flight lock for token refresh');
      assert.equal(plain.cleaned, 'Use single-flight lock for token refresh');
      assert.equal(plain.strippedCount, 0);

      // Single closed block
      const single = stripPrivateTags('Keep this <private>drop secret 123</private> and this');
      assert.equal(single.cleaned, 'Keep this and this');
      assert.equal(single.strippedCount, 1);

      // Multiple blocks with mixed case and multiline content
      const multi = stripPrivateTags(
        'Line1 <PRIVATE>\nsecret-line-a\nsecret-line-b\n</PrIvAtE> mid <Private reason="pii">otp=9911</PRIVATE> tail',
      );
      assert.equal(multi.cleaned, 'Line1 mid tail');
      assert.equal(multi.strippedCount, 2);
      assert.doesNotMatch(multi.cleaned, /secret-line|otp=9911/i);

      // Nested <private> tags must not leak outer tail
      const nested = stripPrivateTags(
        'Public <private>outer <private>inner</private> tail-secret</private> safe',
      );
      assert.equal(nested.cleaned, 'Public safe');
      assert.equal(nested.strippedCount, 1);
      assert.doesNotMatch(nested.cleaned, /outer|inner|tail-secret/);

      // Unclosed <private> forcibly strips through EOF
      const unclosed = stripPrivateTags('Safe prefix <private>leaked-password-999 and more text');
      assert.equal(unclosed.cleaned, 'Safe prefix');
      assert.equal(unclosed.strippedCount, 1);
      assert.doesNotMatch(unclosed.cleaned, /leaked-password-999|more text/);

      // Nested unclosed <private> forcibly strips through EOF
      const nestedUnclosed = stripPrivateTags(
        'Visible <private>outer <private>inner</private> still-unclosed-secret',
      );
      assert.equal(nestedUnclosed.cleaned, 'Visible');
      assert.equal(nestedUnclosed.strippedCount, 1);
      assert.doesNotMatch(nestedUnclosed.cleaned, /still-unclosed-secret/);

      // Non-tag lookalike (<private_key>) stays intact
      const lookalike = stripPrivateTags('Read <private_key> schema field');
      assert.equal(lookalike.cleaned, 'Read <private_key> schema field');
      assert.equal(lookalike.strippedCount, 0);

      // Linear O(n) stress input (zero ReDoS)
      const stressInput = `${'<private '.repeat(20_000)}tail`;
      const t0 = Date.now();
      const stressRes = stripPrivateTags(stressInput);
      const elapsedMs = Date.now() - t0;
      assert.equal(stressRes.strippedCount, 0);
      assert.ok(elapsedMs < 500, `Expected linear runtime <500ms, got ${elapsedMs}ms`);
    });

    it('strips <private> before secret redaction in MemoryStore.remember and falls back safely on pure-private content', async () => {
      await withTempDirs(({ dataDir, workspaceDir }) => {
        const memDir = getModuleDataDir(dataDir, 'mem');
        const anchorFile = path.join(workspaceDir, 'auth.ts');
        fs.writeFileSync(anchorFile, 'export const auth = true;\n', 'utf8');

        const store = new MemoryStore(memDir, false, workspaceDir);
        const saved = store.remember({
          kind: 'architecture',
          title: 'Auth flow <private>internal-codename-77</private>',
          content:
            'Always rotate refresh tokens; <private>prod-db-pass=supersecret</private> never log sk-1234567890abcdef123456',
          tags: ['auth', '<private>secret-tag</private>', 'cache-<private>drop</private>'],
          workspacePath: workspaceDir,
          anchors: [{ filePath: anchorFile, symbol: 'refresh<private>Internal</private>Token' }],
          pinned: true,
        });

        assert.equal(saved.title, 'Auth flow');
        assert.doesNotMatch(saved.title, /internal-codename-77/);
        assert.match(saved.content, /Always rotate refresh tokens/);
        assert.match(saved.content, /\[REDACTED_KEY\]/);
        assert.doesNotMatch(saved.content, /prod-db-pass|supersecret|sk-1234567890abcdef123456/);
        assert.deepEqual(saved.tags, ['auth', 'cache-']);
        assert.equal(saved.anchors[0]?.symbol, 'refreshToken');

        // Pure-private content falls back to safe placeholder
        const purePrivate = store.remember({
          kind: 'decision',
          title: 'Private-only body test',
          content: '<PRIVATE>only secret payload that must vanish</PRIVATE>',
          workspacePath: workspaceDir,
        });
        assert.equal(purePrivate.content, PRIVATE_CONTENT_PLACEHOLDER);

        // Verify disk file never stores stripped plaintext
        const rawOnDisk = fs.readFileSync(path.join(memDir, 'memories.json'), 'utf8');
        assert.doesNotMatch(
          rawOnDisk,
          /internal-codename-77|prod-db-pass|supersecret|secret-tag|only secret payload/,
        );
      });
    });

    it('skips Stop hook auto-capture when lastUserInput is pure <private> or shorter than 16 safe chars after stripping', async () => {
      await withTempDirs(({ dataDir, workspaceDir }) => {
        const editedFile = path.join(workspaceDir, 'service.ts');
        fs.writeFileSync(editedFile, 'export const ok = 1;\n', 'utf8');
        const transcriptPath = path.join(workspaceDir, 'transcript.jsonl');
        fs.writeFileSync(
          transcriptPath,
          `${JSON.stringify({ tool_calls: [{ name: 'edit_file', args: { Path: editedFile } }] })}\n`,
          'utf8',
        );

        // Case 1: Pure <private> input -> skip, zero writes
        handleMemStopHook(
          normalizeHookPayload(
            {
              conversationId: 'conv-private-only',
              workspacePaths: [workspaceDir],
              transcriptPath,
              lastUserInput: '<private>Rotate production root credentials for cluster-alpha</private>',
            },
            'Stop',
          ),
          dataDir,
        );
        const memDir = getModuleDataDir(dataDir, 'mem');
        assert.equal(fs.existsSync(memDir), false, 'Pure private Stop input must not create mem dir');

        // Case 2: Unclosed <private> leaving <16 safe chars -> skip, zero writes
        handleMemStopHook(
          normalizeHookPayload(
            {
              conversationId: 'conv-short-safe',
              workspacePaths: [workspaceDir],
              transcriptPath,
              lastUserInput: 'Fix bug <private>with secret password 12345678901234567890',
            },
            'Stop',
          ),
          dataDir,
        );
        assert.equal(fs.existsSync(memDir), false, 'Short residual Stop input (<16 chars) must not write');

        // Case 3: Safe prefix >= 16 chars + private tail -> persists only safe portion
        handleMemStopHook(
          normalizeHookPayload(
            {
              conversationId: 'conv-mixed-safe-1234',
              workspacePaths: [workspaceDir],
              transcriptPath,
              lastUserInput:
                'Add retry backoff to service queue <private>using key=ultra-secret-token-999</private>',
            },
            'Stop',
          ),
          dataDir,
        );
        const store = new MemoryStore(memDir, false, workspaceDir);
        const items = store.list({ workspacePath: workspaceDir });
        assert.equal(items.length, 1);
        assert.match(items[0].title, /Add retry backoff to service queue/);
        assert.doesNotMatch(items[0].title, /ultra-secret-token-999/);
      });
    });

    it('[S2 regression] resists Unicode case-folding offset shifts (Turkish İ, German ß, CJK, Emoji) across stripPrivateTags, remember, and Stop hook', async () => {
      // 1. Direct red-team PoC: 45x U+0130 ('İ') whose .toLowerCase() expands UTF-16 length 1 -> 2
      const pocPrefix = '\u0130'.repeat(45);
      const pocInput = `${pocPrefix} <private>TOP_SECRET_123456</private> tail`;
      const pocRes = stripPrivateTags(pocInput);
      assert.equal(pocRes.strippedCount, 1);
      assert.equal(pocRes.cleaned, `${pocPrefix} tail`);
      assert.doesNotMatch(pocRes.cleaned, /TOP_SECRET_123456/);

      // Mixed multibyte Unicode (Emoji surrogate pairs + CJK + German ß + Turkish İ) with attributes, mixed case & nesting
      const polyPrefix = `${'\u0130'.repeat(30)}🚀🔐中文ß`;
      const nestedPoly = stripPrivateTags(
        `${polyPrefix} <PRIVATE id="1">OUTER_SECRET <private>INNER_SECRET</private> TAIL_SECRET</PrIvAtE> safe-tail`,
      );
      assert.equal(nestedPoly.strippedCount, 1);
      assert.equal(nestedPoly.cleaned, `${polyPrefix} safe-tail`);
      assert.doesNotMatch(nestedPoly.cleaned, /OUTER_SECRET|INNER_SECRET|TAIL_SECRET/);

      // Unclosed <private> after Turkish İ + multibyte Unicode strips through EOF
      const unclosedPoly = stripPrivateTags(
        `${pocPrefix} 🚀中文ß <private id="unclosed">UNCLOSED_UNICODE_SECRET_999`,
      );
      assert.equal(unclosedPoly.strippedCount, 1);
      assert.equal(unclosedPoly.cleaned, `${pocPrefix} 🚀中文ß`);
      assert.doesNotMatch(unclosedPoly.cleaned, /UNCLOSED_UNICODE_SECRET_999/);

      // 2. End-to-end MemoryStore.remember() and handleMemStopHook() zero plaintext leakage
      await withTempDirs(({ dataDir, workspaceDir }) => {
        const memDir = getModuleDataDir(dataDir, 'mem');
        const anchorFile = path.join(workspaceDir, 'unicode-guard.ts');
        fs.writeFileSync(anchorFile, 'export const guard = true;\n', 'utf8');

        const store = new MemoryStore(memDir, false, workspaceDir);
        const saved = store.remember({
          kind: 'pitfall',
          title: `${pocPrefix} 中文标题 <private>TITLE_LEAK_123</private> ß🚀`,
          content: `${pocPrefix} 🚀中文ß <private id="body">TOP_SECRET_123456</private> tail`,
          tags: [`${polyPrefix}<private>TAG_LEAK_456</private>`],
          workspacePath: workspaceDir,
          anchors: [
            {
              filePath: anchorFile,
              symbol: `${pocPrefix}fn<private>SYM_LEAK_789</private>Safe`,
            },
          ],
        });

        assert.doesNotMatch(saved.title, /TITLE_LEAK_123/);
        assert.doesNotMatch(saved.content, /TOP_SECRET_123456/);
        assert.match(saved.content, /tail$/);
        assert.equal(saved.tags.some((t) => t.includes('tag_leak_456')), false);
        assert.doesNotMatch(saved.anchors[0]?.symbol ?? '', /SYM_LEAK_789/);

        const transcriptPath = path.join(workspaceDir, 'unicode-transcript.jsonl');
        fs.writeFileSync(
          transcriptPath,
          `${JSON.stringify({ tool_calls: [{ name: 'edit_file', args: { Path: anchorFile } }] })}\n`,
          'utf8',
        );

        // Stop hook with short Unicode prefix (<16 chars after stripping) must skip without writing new auto entry
        handleMemStopHook(
          normalizeHookPayload(
            {
              conversationId: 'conv-uni-short',
              workspacePaths: [workspaceDir],
              transcriptPath,
              lastUserInput: `${'\u0130'.repeat(10)} <private>STOP_SHORT_SECRET_111</private>`,
            },
            'Stop',
          ),
          dataDir,
        );
        assert.equal(
          store.list({ workspacePath: workspaceDir }).some((m) => m.id === 'mem_auto_conv-uni-sho'),
          false,
        );

        // Stop hook with long Unicode prefix (>=16 chars after stripping) strips secret completely
        handleMemStopHook(
          normalizeHookPayload(
            {
              conversationId: 'conv-uni-long-123',
              workspacePaths: [workspaceDir],
              transcriptPath,
              lastUserInput: `${pocPrefix} 中文ß🚀 <private>STOP_LONG_SECRET_222</private> tail`,
            },
            'Stop',
          ),
          dataDir,
        );
        const rawOnDisk = fs.readFileSync(path.join(memDir, 'memories.json'), 'utf8');
        assert.doesNotMatch(
          rawOnDisk,
          /TOP_SECRET_123456|TITLE_LEAK_123|TAG_LEAK_456|SYM_LEAK_789|STOP_SHORT_SECRET_111|STOP_LONG_SECRET_222/,
        );
      });
    });
  });

  describe('Layer 1 compact SessionStart index & progressive token savings', () => {
    it('builds compact L1 index <= 1200 chars with IDs and guidance while significantly saving tokens vs full dump', async () => {
      await withTempDirs(({ dataDir, workspaceDir }) => {
        const memDir = getModuleDataDir(dataDir, 'mem');
        const store = new MemoryStore(memDir, false, workspaceDir);

        const createdIds: string[] = [];
        for (let i = 1; i <= 14; i += 1) {
          const filePath = path.join(workspaceDir, `module-${i}.ts`);
          fs.writeFileSync(filePath, `export const mod${i} = ${i};\n`, 'utf8');
          const longBody = `Detailed engineering rationale #${i}: `.concat(
            'Always enforce idempotency keys, circuit breakers, deterministic backoff jitter, and strict workspace boundary checks. '.repeat(
              4,
            ),
          );
          const item = store.remember({
            id: `mem_item_${String(i).padStart(2, '0')}`,
            kind: i % 2 === 0 ? 'architecture' : 'decision',
            title: `Architecture Rule ${i}: Bounded Queue Policy`,
            content: longBody,
            tags: ['perf', `mod-${i}`],
            workspacePath: workspaceDir,
            anchors: [{ filePath }],
            pinned: i <= 3,
          });
          createdIds.push(item.id);
        }

        const indexText = store.buildSessionStartInjection([workspaceDir], 12);
        assert.ok(indexText.length > 0);
        assert.ok(
          indexText.length <= MAX_SESSION_START_CHARS,
          `L1 index length ${indexText.length} exceeded ${MAX_SESSION_START_CHARS}`,
        );
        assert.match(indexText, /^\[Agy Mem/);
        assert.match(indexText, /mem_item_01/);
        assert.match(indexText, /★/);
        assert.match(indexText, /module-1\.ts/);
        assert.match(indexText, /mem_recall\(mode="detail", ids=\[/);
        // Must NOT dump verbose body prose into SessionStart
        assert.doesNotMatch(indexText, /Detailed engineering rationale #1:/);

        // Progressive stats confirm substantial token reduction
        const stats = store.buildProgressiveStats([workspaceDir]);
        assert.equal(stats.activeCount, 14);
        assert.equal(stats.compactIndexChars, indexText.length);
        assert.ok(stats.compactIndexTokens < stats.fullDumpTokens);
        assert.ok(stats.savedTokens > 0);
        assert.ok(stats.savedPercent >= 60, `Expected >=60% token savings, got ${stats.savedPercent}%`);

        // SessionStart hook returns the compact L1 index
        const hookRes = handleMemSessionStartHook(
          normalizeHookPayload({ workspacePaths: [workspaceDir] }, 'SessionStart'),
          dataDir,
        );
        assert.equal(hookRes.injectSteps?.length, 1);
        const injected = (hookRes.injectSteps?.[0] as { systemMessage: { systemMessage: string } })
          .systemMessage.systemMessage;
        assert.equal(injected, indexText);
        assert.ok(createdIds.includes('mem_item_01'));
      });
    });
  });

  describe('MCP end-to-end 3-layer mem_recall, app_mem_recall_layered & zero-write isolation', () => {
    it('supports L1 index, L2 timeline (query & ids + window), L3 detail (ids & BM25), and app_mem_get_state progressive metadata', async () => {
      await withTempDirs(async ({ dataDir, workspaceDir }) => {
        const memDir = getModuleDataDir(dataDir, 'mem');
        fs.mkdirSync(memDir, { recursive: true });

        // Seed 6 chronological memories with explicit distinct updatedAt timestamps
        const seedItems: MemoryItem[] = [
          {
            id: 'mem_t1',
            kind: 'architecture',
            title: 'Bootstrap Workspace Scanner',
            content: 'Initial workspace scanner skips node_modules and dotfiles.',
            tags: ['scanner'],
            workspacePath: workspaceDir,
            sourceConversationId: 'conv-001',
            anchors: [{ filePath: path.join(workspaceDir, 'scan.ts'), basename: 'scan.ts', uri: 'file:///scan.ts', driftStatus: 'untracked' }],
            pinned: false,
            createdAt: '2026-11-20T08:00:00.000Z',
            updatedAt: '2026-11-20T08:00:00.000Z',
            recallCount: 0,
          },
          {
            id: 'mem_t2',
            kind: 'decision',
            title: 'Retry Queue Backoff Policy',
            content: 'Use capped exponential backoff with 20% jitter for webhook retries.',
            tags: ['queue', 'retry'],
            workspacePath: workspaceDir,
            sourceConversationId: 'conv-002',
            anchors: [{ filePath: path.join(workspaceDir, 'queue.ts'), basename: 'queue.ts', uri: 'file:///queue.ts', driftStatus: 'untracked' }],
            pinned: false,
            createdAt: '2026-11-21T09:00:00.000Z',
            updatedAt: '2026-11-21T09:00:00.000Z',
            recallCount: 0,
          },
          {
            id: 'mem_t3',
            kind: 'pitfall',
            title: 'Redis Pipeline Starvation Root Cause',
            content: 'Sequential HGET calls inside checkout loops saturate connections; always batch with pipeline().',
            tags: ['redis', '缓存'],
            workspacePath: workspaceDir,
            sourceConversationId: 'conv-003-redis',
            anchors: [{ filePath: path.join(workspaceDir, 'cache.ts'), basename: 'cache.ts', uri: 'file:///cache.ts', driftStatus: 'untracked' }],
            pinned: true,
            createdAt: '2026-11-22T10:00:00.000Z',
            updatedAt: '2026-11-22T10:00:00.000Z',
            recallCount: 0,
          },
          {
            id: 'mem_t4',
            kind: 'convention',
            title: 'Zero-Native-Addon Packaging Rule',
            content: 'Prefer pure TypeScript over native C++ modules to avoid platform rebuild failures.',
            tags: ['packaging'],
            workspacePath: workspaceDir,
            sourceConversationId: 'conv-004',
            anchors: [{ filePath: path.join(workspaceDir, 'package.json'), basename: 'package.json', uri: 'file:///package.json', driftStatus: 'untracked' }],
            pinned: false,
            createdAt: '2026-11-23T11:00:00.000Z',
            updatedAt: '2026-11-23T11:00:00.000Z',
            recallCount: 0,
          },
          {
            id: 'mem_t5',
            kind: 'decision',
            title: 'Outbox Pattern for Billing Events',
            content: 'Write events to transactional outbox table before Kafka dispatch for idempotency.',
            tags: ['billing'],
            workspacePath: workspaceDir,
            sourceConversationId: 'conv-005',
            anchors: [{ filePath: path.join(workspaceDir, 'billing.ts'), basename: 'billing.ts', uri: 'file:///billing.ts', driftStatus: 'untracked' }],
            pinned: false,
            createdAt: '2026-11-24T12:00:00.000Z',
            updatedAt: '2026-11-24T12:00:00.000Z',
            recallCount: 0,
          },
          {
            id: 'mem_t6',
            kind: 'preference',
            title: 'Strict Atomic File Writes',
            content: 'Write temp files with 0600 permissions then rename atomically.',
            tags: ['io'],
            workspacePath: workspaceDir,
            sourceConversationId: 'conv-006',
            anchors: [{ filePath: path.join(workspaceDir, 'io.ts'), basename: 'io.ts', uri: 'file:///io.ts', driftStatus: 'untracked' }],
            pinned: false,
            createdAt: '2026-11-25T13:00:00.000Z',
            updatedAt: '2026-11-25T13:00:00.000Z',
            recallCount: 0,
          },
        ];
        fs.writeFileSync(path.join(memDir, 'memories.json'), JSON.stringify(seedItems, null, 2), 'utf8');

        const server = new McpServer(
          { name: 'test-v06-mem', version: '0.6.0' },
          { capabilities: { tools: {} } },
        );
        const reg = registerMemModule(
          server,
          { dataDir, workspaceRoot: workspaceDir, demoMode: false },
          UI_RESOURCE_URI,
        );

        // Strictly preserves exact 3 model tools
        assert.deepEqual(
          reg.modelTools.map((t) => t.name),
          ['mem_remember', 'mem_recall', 'mem_forget'],
        );
        assert.deepEqual(
          reg.modelTools.map((t) => t.name),
          MODULE_CATALOG.mem.modelToolNames,
        );

        const { client, close } = await connectInMemoryClient(server);
        try {
          const listed = await client.listTools();
          const layeredDef = listed.tools.find((t) => t.name === 'app_mem_recall_layered');
          assert.ok(layeredDef, 'Expected app_mem_recall_layered tool');
          assert.deepEqual(
            (layeredDef._meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility,
            ['app'],
          );

          // L1 mode='index': returns compact catalog WITHOUT content prose and does NOT increment recallCount
          const l1Res = await client.callTool({
            name: 'mem_recall',
            arguments: { query: 'redis 缓存', mode: 'index' },
          });
          const l1Text = (l1Res.content as Array<{ text: string }>)[0].text;
          const l1Sc = l1Res.structuredContent as {
            mode: string;
            totalHits: number;
            matches: MemoryIndexEntry[];
          };
          assert.equal(l1Sc.mode, 'index');
          assert.equal(l1Sc.totalHits, 1);
          assert.equal(l1Sc.matches[0]?.id, 'mem_t3');
          assert.equal('content' in (l1Sc.matches[0] as unknown as Record<string, unknown>), false);
          assert.match(l1Text, /mem_t3/);
          assert.doesNotMatch(l1Text, /Sequential HGET calls/);

          // L2 mode='timeline' around mem_t3 with window=1 -> returns [mem_t4, mem_t3(HIT), mem_t2] sorted by updatedAt desc
          const l2ByIds = await client.callTool({
            name: 'mem_recall',
            arguments: { mode: 'timeline', ids: ['mem_t3'], window: 1 },
          });
          const l2Sc = l2ByIds.structuredContent as {
            mode: string;
            window: number;
            timeline: MemoryTimelineEntry[];
          };
          assert.equal(l2Sc.mode, 'timeline');
          assert.equal(l2Sc.window, 1);
          assert.deepEqual(
            l2Sc.timeline.map((e) => e.id),
            ['mem_t4', 'mem_t3', 'mem_t2'],
          );
          assert.equal(l2Sc.timeline[0]?.isAnchorHit, false);
          assert.equal(l2Sc.timeline[1]?.isAnchorHit, true);
          assert.equal(l2Sc.timeline[1]?.sourceConversationId, 'conv-003-redis');
          assert.deepEqual(l2Sc.timeline[1]?.anchorFiles, ['cache.ts']);

          // L2 mode='timeline' by query with default window=2 -> [mem_t5, mem_t4, mem_t3(HIT), mem_t2, mem_t1]
          const l2ByQuery = await client.callTool({
            name: 'mem_recall',
            arguments: { query: 'Redis Pipeline', mode: 'timeline' },
          });
          const l2QuerySc = l2ByQuery.structuredContent as { timeline: MemoryTimelineEntry[] };
          assert.deepEqual(
            l2QuerySc.timeline.map((e) => e.id),
            ['mem_t5', 'mem_t4', 'mem_t3', 'mem_t2', 'mem_t1'],
          );

          // Verify L1 and L2 left recallCount untouched at 0
          const beforeDetailRaw = JSON.parse(
            fs.readFileSync(path.join(memDir, 'memories.json'), 'utf8'),
          ) as MemoryItem[];
          assert.equal(beforeDetailRaw.find((m) => m.id === 'mem_t3')?.recallCount, 0);

          // L3 mode='detail' by exact ids -> returns full content and increments recallCount
          const l3ByIds = await client.callTool({
            name: 'mem_recall',
            arguments: { mode: 'detail', ids: ['mem_t3', 'mem_t5'] },
          });
          const l3Text = (l3ByIds.content as Array<{ text: string }>)[0].text;
          const l3Sc = l3ByIds.structuredContent as {
            mode: string;
            totalHits: number;
            items: MemoryItem[];
          };
          assert.equal(l3Sc.mode, 'detail');
          assert.equal(l3Sc.totalHits, 2);
          assert.deepEqual(
            l3Sc.items.map((m) => m.id),
            ['mem_t3', 'mem_t5'],
          );
          assert.match(l3Text, /Sequential HGET calls/);
          assert.match(l3Text, /transactional outbox table/);
          assert.equal(l3Sc.items[0]?.recallCount, 1);

          const afterDetailRaw = JSON.parse(
            fs.readFileSync(path.join(memDir, 'memories.json'), 'utf8'),
          ) as MemoryItem[];
          assert.equal(afterDetailRaw.find((m) => m.id === 'mem_t3')?.recallCount, 1);
          assert.equal(afterDetailRaw.find((m) => m.id === 'mem_t5')?.recallCount, 1);

          // Default mode (omitted) maintains backward-compatible BM25 detail search
          const legacyRecall = await client.callTool({
            name: 'mem_recall',
            arguments: { query: '缓存 redis' },
          });
          const legacySc = legacyRecall.structuredContent as {
            mode: string;
            totalHits: number;
            matches: Array<{ id: string }>;
          };
          assert.equal(legacySc.mode, 'detail');
          assert.equal(legacySc.totalHits, 1);
          assert.equal(legacySc.matches[0]?.id, 'mem_t3');

          // app_mem_get_state includes progressiveStats & progressivePreview
          const stateRes = await client.callTool({ name: 'app_mem_get_state', arguments: {} });
          const stateSc = stateRes.structuredContent as {
            injectionPreview: string;
            progressiveStats: MemoryProgressiveStats;
            progressivePreview: MemoryProgressivePreview;
          };
          assert.equal(stateSc.progressiveStats.activeCount, 6);
          assert.ok(stateSc.progressiveStats.compactIndexTokens > 0);
          assert.ok(stateSc.progressiveStats.fullDumpTokens > stateSc.progressiveStats.compactIndexTokens);
          assert.equal(stateSc.progressivePreview.indexText, stateSc.injectionPreview);
          assert.equal(stateSc.progressivePreview.entries.length, 6);

          // app_mem_recall_layered is strictly read-only (does NOT increment recallCount even in detail mode)
          const countBeforeApp = (
            JSON.parse(fs.readFileSync(path.join(memDir, 'memories.json'), 'utf8')) as MemoryItem[]
          ).find((m) => m.id === 'mem_t3')?.recallCount;

          const appLayered = await client.callTool({
            name: 'app_mem_recall_layered',
            arguments: { mode: 'detail', ids: ['mem_t3'] },
          });
          const appLayeredSc = appLayered.structuredContent as {
            mode: string;
            detailItems: MemoryItem[];
          };
          assert.equal(appLayeredSc.mode, 'detail');
          assert.equal(appLayeredSc.detailItems[0]?.id, 'mem_t3');

          const countAfterApp = (
            JSON.parse(fs.readFileSync(path.join(memDir, 'memories.json'), 'utf8')) as MemoryItem[]
          ).find((m) => m.id === 'mem_t3')?.recallCount;
          assert.equal(countAfterApp, countBeforeApp);
        } finally {
          await close();
        }
      });
    });

    it('enforces strictly zero disk writes in demoMode and on read-only live operations', async () => {
      await withTempDirs(async ({ root, workspaceDir }) => {
        // 1. Live mode with absent dataDir: read-only calls never create directories or files
        const liveMissingDataDir = path.join(root, 'live-missing-data');
        const liveServer = new McpServer(
          { name: 'test-live-ro', version: '0.6.0' },
          { capabilities: { tools: {} } },
        );
        registerMemModule(
          liveServer,
          { dataDir: liveMissingDataDir, workspaceRoot: workspaceDir, demoMode: false },
          UI_RESOURCE_URI,
        );
        const liveConn = await connectInMemoryClient(liveServer);
        try {
          await liveConn.client.callTool({ name: 'app_mem_get_state', arguments: {} });
          await liveConn.client.callTool({
            name: 'app_mem_recall_layered',
            arguments: { query: 'anything', mode: 'index' },
          });
          await liveConn.client.callTool({
            name: 'mem_recall',
            arguments: { query: 'anything', mode: 'timeline' },
          });
          await liveConn.client.callTool({
            name: 'mem_recall',
            arguments: { query: '', mode: 'detail' },
          });
          assert.equal(
            fs.existsSync(liveMissingDataDir),
            false,
            'Read-only live operations must never create dataDir',
          );
        } finally {
          await liveConn.close();
        }

        // 2. Demo mode with absent dataDir: reads AND in-memory mutations write ZERO files to disk
        const demoMissingDataDir = path.join(root, 'demo-missing-data');
        const demoServer = new McpServer(
          { name: 'test-demo-ro', version: '0.6.0' },
          { capabilities: { tools: {} } },
        );
        const demoReg = registerMemModule(
          demoServer,
          { dataDir: demoMissingDataDir, workspaceRoot: workspaceDir, demoMode: true },
          UI_RESOURCE_URI,
        );
        assert.equal(demoReg.modelTools.length, 3);

        const demoConn = await connectInMemoryClient(demoServer);
        try {
          const state = await demoConn.client.callTool({ name: 'app_mem_get_state', arguments: {} });
          const sc = state.structuredContent as {
            memories: MemoryItem[];
            progressiveStats: MemoryProgressiveStats;
          };
          assert.ok(sc.memories.length >= 4);
          assert.ok(sc.progressiveStats.activeCount >= 3);
          assert.ok(sc.progressiveStats.savedTokens > 0);

          await demoConn.client.callTool({
            name: 'app_mem_recall_layered',
            arguments: { query: 'redis', mode: 'index' },
          });
          await demoConn.client.callTool({
            name: 'app_mem_recall_layered',
            arguments: { ids: ['mem_demo_pkce'], mode: 'timeline', window: 2 },
          });
          await demoConn.client.callTool({
            name: 'mem_recall',
            arguments: { ids: ['mem_demo_pkce'], mode: 'detail' },
          });
          await demoConn.client.callTool({
            name: 'mem_remember',
            arguments: {
              kind: 'decision',
              title: 'In-memory demo note',
              content: 'This demo mutation must never touch disk <private>secret</private>',
            },
          });

          assert.equal(
            fs.existsSync(demoMissingDataDir),
            false,
            'demoMode must stay 100% in-memory with zero disk writes',
          );
        } finally {
          await demoConn.close();
        }
      });
    });
  });
});
