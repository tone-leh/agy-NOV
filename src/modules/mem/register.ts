import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import type {
  ModuleRegistrationResult,
  ModuleToolHandle,
  NovRuntimeOptions,
} from '../../core/types.js';
import { buildMemoryGraph } from './graph.js';
import { MemoryStore } from './store.js';

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
  const store = new MemoryStore(dataDir, Boolean(opts.demoMode), opts.workspaceRoot);

  const APP_ONLY_META = {
    ui: {
      resourceUri: uiResourceUri,
      visibility: ['app'] as ['app'],
    },
  };

  const buildPayload = () => {
    const memories = store.list();
    return {
      memories,
      graph: buildMemoryGraph(memories),
      injectionPreview: store.buildSessionStartInjection(),
    };
  };

  const modelTools: ModuleToolHandle[] = [];

  // 1. Model-visible: remember code-anchored fact
  const rememberTool = server.registerTool(
    'mem_remember',
    {
      title: 'Remember Code-Anchored Fact',
      description:
        'Store a long-term architectural decision, pitfall, convention, or preference anchored to source file paths (with SHA-256 drift tracking).',
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
      },
    },
    async (input) => {
      const saved = store.remember(input);
      return {
        content: [
          {
            type: 'text',
            text: `Remembered [${saved.kind.toUpperCase()}] "${saved.title}" (id=${saved.id}, anchors=${saved.anchors.length}, pinned=${saved.pinned}).`,
          },
        ],
        structuredContent: {
          id: saved.id,
          kind: saved.kind,
          title: saved.title,
          pinned: saved.pinned,
          drifted: Boolean(saved.drifted),
          anchorCount: saved.anchors.length,
          tagCount: saved.tags.length,
          updatedAt: saved.updatedAt,
        },
      };
    },
  );
  modelTools.push(toHandle('mem_remember', rememberTool));

  // 2. Model-visible: bilingual BM25 recall
  const recallTool = server.registerTool(
    'mem_recall',
    {
      title: 'Recall Long-Term Memories',
      description: 'Search saved long-term memories using local bilingual (EN + 中文) BM25 ranking.',
      inputSchema: {
        query: z.string(),
        workspacePath: z.string().optional(),
        limit: z.number().int().min(1).max(30).optional(),
      },
    },
    async ({ query, workspacePath, limit }) => {
      const hits = store.recall(query, { workspacePath, limit: limit ?? 8, incrementRecall: true });
      const text = hits.length
        ? hits
            .map(
              (m, i) =>
                `${i + 1}. [${m.kind.toUpperCase()}${m.drifted ? ' · DRIFTED' : ''}] ${m.title} (score ${m.score})\n   ${m.content}`,
            )
            .join('\n')
        : `No memories matched "${query}".`;
      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          query,
          totalHits: hits.length,
          matches: hits.map((m) => ({
            id: m.id,
            kind: m.kind,
            title: m.title,
            score: m.score,
            pinned: m.pinned,
            drifted: Boolean(m.drifted),
            anchorCount: m.anchors.length,
            tagCount: m.tags.length,
          })),
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

  // App-only tools (6)
  server.registerTool(
    'app_mem_get_state',
    {
      title: 'Get Memory State (App Only)',
      description: 'Fetch memories, graph & injection preview.',
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
      inputSchema: { query: z.string() },
      _meta: APP_ONLY_META,
    },
    async ({ query }) => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { hits: store.recall(query, { limit: 25 }) },
    }),
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
  };
}
