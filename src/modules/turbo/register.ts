import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import type {
  ModuleRegistrationResult,
  ModuleToolHandle,
  NovRuntimeOptions,
} from '../../core/types.js';
import {
  batchSearchWorkspace,
  buildWorkspaceSnapshot,
  CompactedChunkStore,
  readFileOutlineAndSlice,
  TURBO_MAX_COMPACTED_CHUNKS,
  TURBO_MAX_QUERIES,
  type BatchSearchResult,
  type CompactOutputResult,
  type ReadOutlineResult,
  type WorkspaceSnapshot,
} from './core.js';

function toHandle(name: string, tool: RegisteredTool): ModuleToolHandle {
  return {
    name,
    enable: () => tool.enable(),
    disable: () => tool.disable(),
  };
}

function seedDemoTurboStore(store: CompactedChunkStore): {
  lastCompact: CompactOutputResult;
  lastSearch: BatchSearchResult;
  lastOutline: ReadOutlineResult;
} {
  const sampleBuildLog = [
    '> agy-nov@0.2.0 test',
    '> node --import tsx --test test/*.test.ts',
    'TAP version 13',
    '# Subtest: Core modules',
    'ok 1 - parses unified diff & risk tags',
    'ok 2 - guard blocks .env symlink traversal',
    ...Array.from({ length: 48 }, (_, idx) => `info [runner] step ${idx + 1}: verified invariant #${idx + 100}`),
    'WARN deprecated buffer constructor detected in legacy fixture',
    'WARN deprecated buffer constructor detected in legacy fixture',
    'ERROR TS2345: Argument of type "string" is not assignable to parameter of type "ModuleId" at src/server/index.ts:154',
    'ERROR AssertionError: Expected 9 registered modules, received 6 at test/nov-integration.test.ts:42',
    'FAIL test/nov-integration.test.ts (2 failed, 38 passed)',
    'Summary: duration 1482ms, exitCode=1',
  ].join('\n');

  const lastCompact = store.compact(undefined, 'npm test (demo build log)', sampleBuildLog, {
    persistStats: false,
  });

  const sampleInstallLog = [
    'npm timing idealTree Completed in 412ms',
    ...Array.from({ length: 30 }, (_, idx) => `reify:pkg-${idx + 1} unpacked 142KB`),
    'WARN peerOptional @types/node version range mismatch',
    'added 84 packages, audited 85 packages in 2s',
    'found 0 vulnerabilities',
  ].join('\n');
  store.compact(undefined, 'npm ci (demo output)', sampleInstallLog, { persistStats: false });

  const lastSearch: BatchSearchResult = {
    scope: 'src',
    scannedFiles: 46,
    skippedFiles: 3,
    skippedSensitive: 2,
    skippedSymlinks: 0,
    totalMatches: 9,
    truncated: false,
    elapsedMs: 11,
    results: [
      {
        query: 'registerTool',
        mode: 'literal',
        totalHits: 6,
        truncated: false,
        matches: [
          {
            file: 'src/modules/turbo/register.ts',
            line: 74,
            column: 10,
            snippet: "server.registerTool('turbo_batch_search', { title: 'Batch Search Workspace' })",
          },
          {
            file: 'src/modules/radar/register.ts',
            line: 52,
            column: 10,
            snippet: "server.registerTool('radar_get_board', { title: 'Get Session Radar Board' })",
          },
        ],
      },
      {
        query: 'realpathSync',
        mode: 'literal',
        totalHits: 3,
        truncated: false,
        matches: [
          {
            file: 'src/modules/turbo/core.ts',
            line: 251,
            column: 23,
            snippet: 'const realTarget = fs.realpathSync(candidate);',
          },
        ],
      },
    ],
  };

  const lastOutline: ReadOutlineResult = {
    file: 'src/modules/turbo/core.ts',
    language: 'typescript',
    totalLines: 540,
    bytes: 18420,
    outline: [
      { kind: 'function', name: 'isSensitiveTurboPath', line: 196, signature: 'export function isSensitiveTurboPath(inputPath: string): boolean' },
      { kind: 'function', name: 'batchSearchWorkspace', line: 342, signature: 'export function batchSearchWorkspace(workspaceRoot, queries, opts)' },
      { kind: 'function', name: 'readFileOutlineAndSlice', line: 510, signature: 'export function readFileOutlineAndSlice(workspaceRoot, filePath, opts)' },
      { kind: 'class', name: 'CompactedChunkStore', line: 580, signature: 'export class CompactedChunkStore' },
      { kind: 'function', name: 'buildWorkspaceSnapshot', line: 720, signature: 'export function buildWorkspaceSnapshot(workspaceRoot: string)' },
    ],
    outlineTruncated: false,
    slice: {
      startLine: 1,
      endLine: 12,
      truncated: true,
      content: '1 | import crypto from "node:crypto";\n2 | import fs from "node:fs";\n3 | import path from "node:path";',
    },
    estimatedFullTokens: 4605,
    estimatedReturnedTokens: 218,
    estimatedSavedTokens: 4387,
  };

  return { lastCompact, lastSearch, lastOutline };
}

export function registerTurboModule(
  server: McpServer,
  options: NovRuntimeOptions,
  uiResourceUri: string,
): ModuleRegistrationResult {
  const rootDataDir = resolveNovDataDir(options.dataDir);
  const moduleDataDir = getModuleDataDir(rootDataDir, 'turbo');
  const workspaceRoot = options.workspaceRoot;
  const isDemo = options.demoMode === true;

  // Strictly in-memory store: zero disk writes during registration or standard runtime
  const chunkStore = new CompactedChunkStore(TURBO_MAX_COMPACTED_CHUNKS);

  let searchCount = 0;
  let outlineCount = 0;
  let outlineSavedTokens = 0;
  let lastSearch: BatchSearchResult | null = null;
  let lastOutline: ReadOutlineResult | null = null;
  let lastCompact: CompactOutputResult | null = null;

  if (isDemo) {
    const seeded = seedDemoTurboStore(chunkStore);
    lastCompact = seeded.lastCompact;
    lastSearch = seeded.lastSearch;
    lastOutline = seeded.lastOutline;
    searchCount = 4;
    outlineCount = 7;
    outlineSavedTokens = 14820;
  }

  const APP_ONLY_META = {
    ui: {
      resourceUri: uiResourceUri,
      visibility: ['app'] as ['app'],
    },
  };

  const buildSnapshotSafe = (): WorkspaceSnapshot | null => {
    try {
      return buildWorkspaceSnapshot(workspaceRoot);
    } catch {
      return null;
    }
  };

  const buildState = () => {
    const compactStats = chunkStore.getStats();
    return {
      mode: isDemo ? 'demo' : 'live',
      workspaceRoot,
      stats: {
        searchCount,
        outlineCount,
        compactionCount: compactStats.totalCompactions,
        indexedChunks: compactStats.indexedChunks,
        maxChunks: compactStats.maxChunks,
        estimatedSavedTokens: compactStats.totalSavedTokens + outlineSavedTokens,
        compactedSavedTokens: compactStats.totalSavedTokens,
        outlineSavedTokens,
      },
      chunks: chunkStore.listChunks(),
      lastSearch,
      lastOutline,
      lastCompact,
      snapshot: buildSnapshotSafe(),
    };
  };

  const modelTools: ModuleToolHandle[] = [];

  // 1. Model-visible: turbo_batch_search
  const batchSearchTool = server.registerTool(
    'turbo_batch_search',
    {
      title: 'Batch Search Workspace',
      description:
        'Search 1–8 keywords or safe regex patterns across the workspace in a single pass, skipping binaries, symlinks escaping workspace, and sensitive files (.env*, .ssh, keys, secrets).',
      inputSchema: {
        queries: z
          .array(z.string().min(1))
          .min(1)
          .max(TURBO_MAX_QUERIES)
          .describe('1 to 8 keywords or safe regex patterns to search in parallel'),
        directory: z.string().optional().describe('Optional relative subdirectory inside workspace'),
        regex: z.boolean().optional().describe('Treat queries as regex (auto-falls back to literal if unsafe/invalid)'),
        caseSensitive: z.boolean().optional(),
        maxMatchesPerQuery: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ queries, directory, regex, caseSensitive, maxMatchesPerQuery }) => {
      try {
        const result = batchSearchWorkspace(workspaceRoot, queries, {
          directory,
          regex,
          caseSensitive,
          maxMatchesPerQuery,
        });
        searchCount += 1;
        lastSearch = result;

        const lines = [
          `Turbo batch search (${result.scannedFiles} files in ${result.elapsedMs}ms, ${result.totalMatches} total hit(s), skipped ${result.skippedSensitive} sensitive / ${result.skippedSymlinks} symlink):`,
          ...result.results.map((r) => {
            const top = r.matches
              .slice(0, 5)
              .map((m) => `  - ${m.file}:${m.line} | ${m.snippet}`)
              .join('\n');
            return `• "${r.query}" [${r.mode}${r.fallbackLiteral ? ' fallback' : ''}]: ${r.totalHits} hit(s)${top ? `\n${top}` : ''}`;
          }),
        ];
        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: { ...result },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );
  modelTools.push(toHandle('turbo_batch_search', batchSearchTool));

  // 2. Model-visible: turbo_read_outline
  const readOutlineTool = server.registerTool(
    'turbo_read_outline',
    {
      title: 'Read File Outline & Slice',
      description:
        'Extract top-level symbols (functions, classes, interfaces, exports, headings) and a bounded line slice from a workspace file without flooding context.',
      inputSchema: {
        filePath: z.string().min(1).describe('Relative or workspace-scoped file path'),
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
        includeOutline: z.boolean().optional(),
        maxSliceLines: z.number().int().min(1).max(300).optional(),
      },
    },
    async ({ filePath, startLine, endLine, includeOutline, maxSliceLines }) => {
      try {
        const result = readFileOutlineAndSlice(workspaceRoot, filePath, {
          startLine,
          endLine,
          includeOutline,
          maxSliceLines,
        });
        outlineCount += 1;
        outlineSavedTokens += result.estimatedSavedTokens;
        lastOutline = result;

        const outlineText = result.outline
          .slice(0, 40)
          .map((s) => `  L${s.line} [${s.kind}] ${s.name}`)
          .join('\n');
        const summary = [
          `${result.file} (${result.language}, ${result.totalLines} lines, ~${result.estimatedSavedTokens} tokens saved)`,
          outlineText ? `Outline (${result.outline.length}):\n${outlineText}` : 'Outline: (none)',
          `Slice (L${result.slice.startLine}-L${result.slice.endLine}):\n${result.slice.content}`,
        ].join('\n');

        return {
          content: [{ type: 'text', text: summary }],
          structuredContent: { ...result },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );
  modelTools.push(toHandle('turbo_read_outline', readOutlineTool));

  // 3. Model-visible: turbo_compact_output
  const compactOutputTool = server.registerTool(
    'turbo_compact_output',
    {
      title: 'Compact Large Output',
      description:
        'Compress oversized test/build/log output into head/tail + aggregated errors/warnings while indexing full chunks in memory (LRU 24) for follow-up queries.',
      inputSchema: {
        label: z.string().min(1).max(120).optional().describe('Short label for the command or log output'),
        rawText: z.string().optional().describe('Raw command/log text to compact'),
        headLines: z.number().int().min(1).max(50).optional(),
        tailLines: z.number().int().min(1).max(50).optional(),
        maxErrorLines: z.number().int().min(1).max(60).optional(),
        query: z.string().optional().describe('Optional immediate keyword query against an existing chunkId'),
        chunkId: z.string().optional().describe('Optional existing chunkId to search instead of compacting'),
      },
    },
    async ({ label, rawText, headLines, tailLines, maxErrorLines, query, chunkId }) => {
      if (chunkId && query !== undefined) {
        const hit = chunkStore.query(chunkId, query, 10);
        return {
          content: [
            {
              type: 'text',
              text: hit.found
                ? `Chunk ${chunkId} (${hit.label}): ${hit.totalHits} match(es) for "${hit.query}"\n${hit.matches.map((m) => `[L${m.matchedLine}]\n${m.snippet}`).join('\n---\n')}`
                : `Chunk ${chunkId} not found in memory LRU.`,
            },
          ],
          structuredContent: { ...hit },
        };
      }

      if (typeof rawText !== 'string') {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Provide rawText to compact, or chunkId + query to search an indexed chunk.' }],
        };
      }

      const result = chunkStore.compact(moduleDataDir, label ?? 'output', rawText, {
        headLines,
        tailLines,
        maxErrorLines,
        persistStats: false,
      });
      lastCompact = result;
      return {
        content: [{ type: 'text', text: result.summaryText }],
        structuredContent: { ...result },
      };
    },
  );
  modelTools.push(toHandle('turbo_compact_output', compactOutputTool));

  // App-only tools (5)
  server.registerTool(
    'app_turbo_get_state',
    {
      title: 'Get Turbo State (App Only)',
      description: 'Return Turbo counters, indexed chunks, recent search/outline/compaction results, and workspace snapshot.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: buildState(),
    }),
  );

  server.registerTool(
    'app_turbo_batch_search',
    {
      title: 'Batch Search Workspace (App Only)',
      description: 'Run batch workspace search from the Turbo UI.',
      inputSchema: {
        queries: z.array(z.string().min(1)).min(1).max(TURBO_MAX_QUERIES),
        directory: z.string().optional(),
        regex: z.boolean().optional(),
        caseSensitive: z.boolean().optional(),
        maxMatchesPerQuery: z.number().int().min(1).max(100).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async (input) => {
      try {
        const result = batchSearchWorkspace(workspaceRoot, input.queries, input);
        searchCount += 1;
        lastSearch = result;
        return {
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: { result, state: buildState() },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  server.registerTool(
    'app_turbo_read_outline',
    {
      title: 'Read File Outline (App Only)',
      description: 'Inspect symbol outline and line slice from the Turbo UI.',
      inputSchema: {
        filePath: z.string().min(1),
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
        includeOutline: z.boolean().optional(),
        maxSliceLines: z.number().int().min(1).max(300).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async (input) => {
      try {
        const result = readFileOutlineAndSlice(workspaceRoot, input.filePath, input);
        outlineCount += 1;
        outlineSavedTokens += result.estimatedSavedTokens;
        lastOutline = result;
        return {
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: { result, state: buildState() },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  server.registerTool(
    'app_turbo_compact_output',
    {
      title: 'Compact Large Output (App Only)',
      description: 'Compact pasted logs or build output in the Turbo UI.',
      inputSchema: {
        label: z.string().min(1).max(120),
        rawText: z.string(),
        headLines: z.number().int().min(1).max(50).optional(),
        tailLines: z.number().int().min(1).max(50).optional(),
        maxErrorLines: z.number().int().min(1).max(60).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async (input) => {
      const result = chunkStore.compact(moduleDataDir, input.label, input.rawText, {
        headLines: input.headLines,
        tailLines: input.tailLines,
        maxErrorLines: input.maxErrorLines,
        persistStats: false,
      });
      lastCompact = result;
      return {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { result, state: buildState() },
      };
    },
  );

  server.registerTool(
    'app_turbo_query_chunk',
    {
      title: 'Query Compacted Chunk (App Only)',
      description: 'Search inside an in-memory compacted output chunk by keyword.',
      inputSchema: {
        chunkId: z.string().min(1),
        query: z.string(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ chunkId, query, limit }) => {
      const result = chunkStore.query(chunkId, query, limit ?? 10);
      return {
        content: [{ type: 'text', text: result.found ? 'ok' : 'not_found' }],
        structuredContent: { ...result },
      };
    },
  );

  return {
    moduleId: 'turbo',
    modelTools,
  };
}
