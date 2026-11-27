import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import type {
  ModuleRegistrationResult,
  ModuleToolHandle,
  NovRuntimeOptions,
} from '../../core/types.js';
import { buildMemoryGraph } from './graph.js';
import { MAX_TTL_DAYS, MemoryStore, MIN_TTL_DAYS } from './store.js';

const CONFIDENCE_SCHEMA = z.enum(['verified', 'normal', 'tentative']);
const TTL_DAYS_SCHEMA = z.number().int().min(MIN_TTL_DAYS).max(MAX_TTL_DAYS).nullable();

function toHandle(
  name: string,
  reg: { enable: () => void; disable: () => void },
): ModuleToolHandle {
  return {
    name,
    enable: () => reg.enable(),
    disable: () => reg.disable(),
  };
}

export function registerMemModule(
  server: McpServer,
  opts: NovRuntimeOptions,
  uiResourceUri: string,
): ModuleRegistrationResult {
  const rootDataDir = resolveNovDataDir(opts.dataDir);
  const dataDir = getModuleDataDir(rootDataDir, 'mem');
  const getWorkspaceRoot = () => opts.workspaceRoot;
  const store = new MemoryStore(dataDir, Boolean(opts.demoMode), getWorkspaceRoot);

  const APP_ONLY_META = {
    ui: {
      resourceUri: uiResourceUri,
      visibility: ['app'] as ['app'],
    },
  };

  const buildPayload = () => {
    const memories = store.list();
    const indexText = store.buildSessionStartInjection();
    const progressiveStats = store.buildProgressiveStats();
    const indexEntries = store.buildCompactIndexEntries();
    const hygieneSummary = store.getHygieneSummary();
    return {
      memories,
      graph: buildMemoryGraph(memories),
      injectionPreview: indexText,
      progressiveStats,
      progressivePreview: {
        indexText,
        entries: indexEntries,
      },
      hygieneSummary,
    };
  };

  const modelTools: ModuleToolHandle[] = [];

  // 1. Model-visible: remember code-anchored fact
  const rememberTool = server.registerTool(
    'mem_remember',
    {
      title: 'Remember Code-Anchored Fact',
      description:
        'Store a long-term architectural decision, pitfall, convention, or preference anchored to source file paths (with SHA-256 drift tracking, confidence/TTL hygiene governance, <private> tag stripping, and secret redaction).',
      inputSchema: {
        kind: z.enum(['architecture', 'decision', 'pitfall', 'convention', 'preference']),
        title: z.string().min(2),
        content: z.string().min(4),
        tags: z.array(z.string()).optional(),
        workspacePath: z.string().optional(),
        anchors: z
          .array(z.object({ filePath: z.string(), symbol: z.string().optional() }))
          .optional(),
        pinned: z.boolean().optional(),
        confidence: CONFIDENCE_SCHEMA.optional(),
        ttlDays: TTL_DAYS_SCHEMA.optional(),
      },
    },
    async (input) => {
      const saved = store.remember(input);
      return {
        content: [
          {
            type: 'text',
            text: `Remembered [${saved.kind.toUpperCase()}] "${saved.title}" (id=${saved.id}, anchors=${saved.anchors.length}, pinned=${saved.pinned}, confidence=${saved.confidence ?? 'normal'}, hygiene=${saved.hygieneStatus ?? 'healthy'}).`,
          },
        ],
        structuredContent: {
          id: saved.id,
          kind: saved.kind,
          title: saved.title,
          pinned: saved.pinned,
          drifted: Boolean(saved.drifted),
          confidence: saved.confidence ?? 'normal',
          source: saved.source ?? 'manual',
          ttlDays: saved.ttlDays ?? null,
          expiresAt: saved.expiresAt ?? null,
          hygieneStatus: saved.hygieneStatus ?? 'healthy',
          anchorCount: saved.anchors.length,
          tagCount: saved.tags.length,
          updatedAt: saved.updatedAt,
        },
      };
    },
  );
  modelTools.push(toHandle('mem_remember', rememberTool));

  // 2. Model-visible: 3-layer progressive disclosure recall (L1 index / L2 timeline / L3 detail)
  const recallTool = server.registerTool(
    'mem_recall',
    {
      title: 'Recall Long-Term Memories',
      description:
        'Search or load long-term memories with 3-layer progressive disclosure: mode="index" (compact L1 catalog without content), mode="timeline" (L2 chronological context window around hits/ids), or mode="detail" (default L3 full content by query or exact ids). Excludes expired TTL memories unless includeExpired=true.',
      inputSchema: {
        query: z.string().optional().default(''),
        mode: z.enum(['index', 'timeline', 'detail']).optional(),
        ids: z.array(z.string().min(1)).max(20).optional(),
        workspacePath: z.string().optional(),
        limit: z.number().int().min(1).max(30).optional(),
        window: z.number().int().min(1).max(5).optional(),
        includeExpired: z.boolean().optional(),
      },
    },
    async ({ query, mode, ids, workspacePath, limit, window, includeExpired }) => {
      const effectiveMode = mode ?? 'detail';
      const result = store.recallLayered({
        query,
        mode: effectiveMode,
        ids,
        workspacePath,
        limit: limit ?? 8,
        window: window ?? 2,
        incrementRecall: effectiveMode === 'detail',
        includeExpired: Boolean(includeExpired),
      });

      if (effectiveMode === 'index') {
        return {
          content: [{ type: 'text', text: result.text }],
          structuredContent: {
            mode: 'index',
            query: result.query,
            ids: result.ids,
            totalHits: result.totalHits,
            matches: result.indexEntries,
          },
        };
      }

      if (effectiveMode === 'timeline') {
        return {
          content: [{ type: 'text', text: result.text }],
          structuredContent: {
            mode: 'timeline',
            query: result.query,
            ids: result.ids,
            window: result.window,
            totalHits: result.totalHits,
            timeline: result.timelineEntries,
            matches: result.timelineEntries.map((entry) => ({
              id: entry.id,
              kind: entry.kind,
              title: entry.title,
              pinned: entry.pinned,
              drifted: entry.drifted,
              confidence: entry.confidence ?? 'normal',
              hygieneStatus: entry.hygieneStatus,
              expiresAt: entry.expiresAt ?? null,
              isAnchorHit: entry.isAnchorHit,
              updatedAt: entry.updatedAt,
              ...(typeof entry.score === 'number' ? { score: entry.score } : {}),
            })),
          },
        };
      }

      return {
        content: [{ type: 'text', text: result.text }],
        structuredContent: {
          mode: 'detail',
          query: result.query,
          ids: result.ids,
          totalHits: result.totalHits,
          matches: result.detailItems.map((m) => ({
            id: m.id,
            kind: m.kind,
            title: m.title,
            score: m.score ?? 1,
            pinned: m.pinned,
            drifted: Boolean(m.drifted),
            confidence: m.confidence ?? 'normal',
            hygieneStatus: m.hygieneStatus,
            expiresAt: m.expiresAt ?? null,
            anchorCount: m.anchors.length,
            tagCount: m.tags.length,
          })),
          items: result.detailItems,
        },
      };
    },
  );
  modelTools.push(toHandle('mem_recall', recallTool));

  // 3. Model-visible: delete memory by ID
  const forgetTool = server.registerTool(
    'mem_forget',
    {
      title: 'Forget Memory',
      description: 'Permanently delete a memory by its ID.',
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      const ok = store.forget(id);
      return {
        content: [{ type: 'text', text: ok ? `Deleted memory ${id}.` : `Memory ${id} not found.` }],
        structuredContent: { deleted: ok, id },
      };
    },
  );
  modelTools.push(toHandle('mem_forget', forgetTool));

  // App-only tools (9)
  server.registerTool(
    'app_mem_get_state',
    {
      title: 'Get Memory State (App Only)',
      description:
        'Fetch memories, graph, hygiene summary, progressive disclosure stats & compact injection preview.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: buildPayload(),
    }),
  );

  server.registerTool(
    'app_mem_search',
    {
      title: 'Search Memories (App Only)',
      description: 'Interactive bilingual search from UI.',
      inputSchema: {
        query: z.string(),
        includeExpired: z.boolean().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ query, includeExpired }) => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: {
        hits: store.recall(query, { limit: 25, includeExpired: Boolean(includeExpired) }),
      },
    }),
  );

  server.registerTool(
    'app_mem_recall_layered',
    {
      title: 'Layered Recall Preview (App Only)',
      description:
        'Read-only UI tool to preview 3-layer progressive disclosure (L1 index, L2 timeline, L3 detail) without mutating recall counts.',
      inputSchema: {
        query: z.string().optional().default(''),
        mode: z.enum(['index', 'timeline', 'detail']).optional().default('detail'),
        ids: z.array(z.string().min(1)).max(20).optional(),
        limit: z.number().int().min(1).max(30).optional(),
        window: z.number().int().min(1).max(5).optional(),
        includeExpired: z.boolean().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ query, mode, ids, limit, window, includeExpired }) => {
      const result = store.recallLayered({
        query,
        mode,
        ids,
        limit: limit ?? 25,
        window: window ?? 2,
        incrementRecall: false,
        includeExpired: Boolean(includeExpired),
      });
      return {
        content: [{ type: 'text', text: result.text }],
        structuredContent: {
          mode: result.mode,
          query: result.query,
          ids: result.ids,
          window: result.window,
          totalHits: result.totalHits,
          text: result.text,
          indexEntries: result.indexEntries,
          timelineEntries: result.timelineEntries,
          detailItems: result.detailItems,
          progressiveStats: store.buildProgressiveStats(),
        },
      };
    },
  );

  server.registerTool(
    'app_mem_get_hygiene_summary',
    {
      title: 'Get Memory Hygiene Summary (App Only)',
      description:
        'Read-only hygiene report covering healthy, needs_review, stale_ttl, drifted, and tentative memories.',
      inputSchema: {
        workspacePath: z.string().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ workspacePath }) => {
      const summary = store.getHygieneSummary({ workspacePath });
      return {
        content: [
          {
            type: 'text',
            text: `Memory hygiene: total=${summary.total}, healthy=${summary.healthy}, needsReview=${summary.needsReview}, staleTtl=${summary.staleTtl}, drifted=${summary.drifted}, tentative=${summary.tentative}.`,
          },
        ],
        structuredContent: {
          ...summary,
          summary,
        },
      };
    },
  );

  server.registerTool(
    'app_mem_batch_hygiene',
    {
      title: 'Batch Memory Hygiene Governance (App Only)',
      description:
        'Batch verify confidence, refresh TTL, or prune selected memories from UI (atomic 0600 write in live mode, strictly in-memory in demo mode).',
      inputSchema: {
        ids: z.array(z.string().min(1)).min(1).max(100),
        action: z.enum(['verify', 'refresh_ttl', 'prune']),
        ttlDays: TTL_DAYS_SCHEMA.optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ ids, action, ttlDays }) => {
      const result = store.batchHygieneMemories(ids, action, {
        ttlDays,
        workspaceRoot: getWorkspaceRoot(),
      });
      const unresolvedCount = result.unresolvedDriftIds?.length ?? 0;
      const summaryText =
        action === 'prune'
          ? `Pruned ${result.deletedCount} memory item(s).`
          : action === 'verify' && unresolvedCount > 0
            ? `Updated ${result.updatedCount} memory item(s) via verify (${result.reverifiedAnchorCount ?? 0} anchor(s) reverified, ${unresolvedCount} item(s) remain drifted due to missing or out-of-workspace anchors).`
            : `Updated ${result.updatedCount} memory item(s) via ${action}.`;
      return {
        content: [
          {
            type: 'text',
            text: summaryText,
          },
        ],
        structuredContent: {
          result,
          ...buildPayload(),
        },
      };
    },
  );

  server.registerTool(
    'app_mem_add_memory',
    {
      title: 'Add Memory (App Only)',
      description: 'Create or update a memory card from UI.',
      inputSchema: {
        kind: z.enum(['architecture', 'decision', 'pitfall', 'convention', 'preference']),
        title: z.string().min(2),
        content: z.string().min(4),
        tags: z.array(z.string()).optional(),
        anchorFiles: z.array(z.string()).optional(),
        pinned: z.boolean().optional(),
        confidence: CONFIDENCE_SCHEMA.optional(),
        ttlDays: TTL_DAYS_SCHEMA.optional(),
      },
      _meta: APP_ONLY_META,
    },
    async (input) => {
      store.remember({
        kind: input.kind,
        title: input.title,
        content: input.content,
        tags: input.tags,
        anchors: (input.anchorFiles ?? []).filter(Boolean).map((filePath) => ({ filePath })),
        pinned: input.pinned,
        confidence: input.confidence,
        ttlDays: input.ttlDays,
      });
      return {
        content: [{ type: 'text', text: 'saved' }],
        structuredContent: buildPayload(),
      };
    },
  );

  server.registerTool(
    'app_mem_toggle_pin',
    {
      title: 'Toggle Pin (App Only)',
      description: 'Pin or unpin a memory for SessionStart recall.',
      inputSchema: { id: z.string() },
      _meta: APP_ONLY_META,
    },
    async ({ id }) => {
      store.togglePin(id);
      return {
        content: [{ type: 'text', text: 'toggled' }],
        structuredContent: buildPayload(),
      };
    },
  );

  server.registerTool(
    'app_mem_reverify_drift',
    {
      title: 'Reverify Anchor Hashes (App Only)',
      description: 'Refresh SHA-256 anchor hashes after confirming a drifted memory is still accurate.',
      inputSchema: { id: z.string() },
      _meta: APP_ONLY_META,
    },
    async ({ id }) => {
      store.reverifyAnchorHashes(id);
      return {
        content: [{ type: 'text', text: 'reverified' }],
        structuredContent: buildPayload(),
      };
    },
  );

  server.registerTool(
    'app_mem_delete_memory',
    {
      title: 'Delete Memory (App Only)',
      description: 'Delete a memory card from UI.',
      inputSchema: { id: z.string() },
      _meta: APP_ONLY_META,
    },
    async ({ id }) => {
      store.forget(id);
      return {
        content: [{ type: 'text', text: 'deleted' }],
        structuredContent: buildPayload(),
      };
    },
  );

  return {
    moduleId: 'mem',
    modelTools,
    exemptReadOnlyAppTools: ['app_mem_get_hygiene_summary'],
  };
}
