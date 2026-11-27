import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import type {
  ModuleRegistrationResult,
  ModuleToolHandle,
  NovRuntimeOptions,
} from '../../core/types.js';
import {
  loadTurboHotspotsReadOnly,
  loadTurboPrefsReadOnly,
  saveTurboPrefs,
  type TurboHotspotRecord,
  type TurboPrefs,
} from './auto-rtk.js';
import {
  buildContextPack,
  CONTEXT_PACK_DEFAULT_MAX_TOKENS,
  CONTEXT_PACK_MAX_FILES,
  CONTEXT_PACK_MAX_TOKENS,
  CONTEXT_PACK_MIN_TOKENS,
  type ContextPackResult,
} from './context-pack.js';
import {
  batchSearchWorkspace,
  buildWorkspaceSnapshot,
  CompactedChunkStore,
  enforceToolTextGuardrail,
  readFileOutlineAndSlice,
  TURBO_MAX_COMPACTED_CHUNKS,
  TURBO_MAX_QUERIES,
  TurboGainTracker,
  type BatchSearchResult,
  type CompactOutputResult,
  type ReadOutlineResult,
  type WorkspaceSnapshot,
} from './core.js';
import {
  buildDemoContextPack,
  buildDemoReferences,
  buildDemoZodDepContract,
  seedDemoTurboStore,
} from './demo.js';
import {
  inspectLockedDepContract,
  type DepContractResult,
} from './dep-contract.js';
import { findSymbolReferences, type SymbolReferencesResult } from './references.js';

const COMPACT_PRESET_ENUM = z.enum(['auto', 'test', 'build', 'git', 'generic']);
const SEARCH_MODE_ENUM = z.enum(['text', 'references']);

function toHandle(name: string, tool: RegisteredTool): ModuleToolHandle {
  return {
    name,
    enable: () => tool.enable(),
    disable: () => tool.disable(),
  };
}

function formatSymbolReferencesText(result: SymbolReferencesResult): string {
  const formatGroup = (title: string, items: SymbolReferencesResult['definitions']): string => {
    if (items.length === 0) return `${title} (0)`;
    const lines = items
      .slice(0, 40)
      .map((h) => `  - ${h.file}:${h.line}:${h.column} | ${h.snippet}`);
    const extra = items.length > 40 ? `\n  ... (+${items.length - 40} more)` : '';
    return `${title} (${items.length}):\n${lines.join('\n')}${extra}`;
  };

  return [
    `Turbo symbol references for "${result.symbol}" (scope=${result.scope}, ${result.scannedFiles} files in ${result.elapsedMs}ms, ${result.totalHits} hit(s)${result.truncated ? ', truncated' : ''}):`,
    formatGroup('Definitions', result.definitions),
    formatGroup('Imports', result.imports),
    formatGroup('Usages', result.usages),
  ].join('\n');
}

export function registerTurboModule(
  server: McpServer,
  options: NovRuntimeOptions,
  uiResourceUri: string,
): ModuleRegistrationResult {
  const rootDataDir = resolveNovDataDir(options.dataDir);
  const moduleDataDir = getModuleDataDir(rootDataDir, 'turbo');
  const getWorkspaceRoot = () => options.workspaceRoot;
  const isDemo = options.demoMode === true;

  // Strictly in-memory stores: zero disk writes during registration or standard runtime
  const chunkStore = new CompactedChunkStore(TURBO_MAX_COMPACTED_CHUNKS);
  const gainTracker = new TurboGainTracker();

  let searchCount = 0;
  let outlineCount = 0;
  let outlineSavedTokens = 0;
  let lastSearch: BatchSearchResult | null = null;
  let lastOutline: ReadOutlineResult | null = null;
  let lastCompact: CompactOutputResult | null = null;
  let lastReferences: SymbolReferencesResult | null = null;
  let lastDepContract: DepContractResult | null = null;
  let lastContextPack: ContextPackResult | null = null;

  let demoPrefs: TurboPrefs = {
    schemaVersion: 1,
    autoRtk: false,
    updatedAt: '',
  };
  let demoHotspots: TurboHotspotRecord[] = [];

  if (isDemo) {
    const seeded = seedDemoTurboStore(chunkStore, gainTracker);
    lastCompact = seeded.lastCompact;
    lastSearch = seeded.lastSearch;
    lastOutline = seeded.lastOutline;
    lastReferences = seeded.lastReferences;
    lastDepContract = seeded.lastDepContract;
    lastContextPack = seeded.lastContextPack;
    demoHotspots = seeded.hotspots;
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

  const readCurrentPrefsAndHotspots = (): { prefs: TurboPrefs; hotspots: TurboHotspotRecord[] } => {
    if (isDemo) {
      return {
        prefs: { ...demoPrefs },
        hotspots: demoHotspots.map((h) => ({ ...h })),
      };
    }
    return {
      prefs: loadTurboPrefsReadOnly(moduleDataDir),
      hotspots: loadTurboHotspotsReadOnly(moduleDataDir),
    };
  };

  const buildSnapshotSafe = (): WorkspaceSnapshot | null => {
    try {
      return buildWorkspaceSnapshot(getWorkspaceRoot());
    } catch {
      return null;
    }
  };

  const formatBatchSearchText = (result: BatchSearchResult): string => {
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
    return lines.join('\n');
  };

  const recordSearchGain = (
    queries: string[],
    result: BatchSearchResult,
    returnedText: string,
    guardrailApplied: boolean,
  ): void => {
    const returnedTokens = Math.ceil(returnedText.length / 4);
    const scannedTokens =
      typeof result.scannedBytes === 'number' && result.scannedBytes > 0
        ? Math.ceil(result.scannedBytes / 4)
        : result.scannedFiles > 0
          ? result.scannedFiles * 512
          : 0;
    const rawTokens = Math.max(returnedTokens, scannedTokens);
    gainTracker.record({
      op: 'batch_search',
      label: queries.slice(0, 3).join(', '),
      rawTokens,
      returnedTokens,
      guardrailApplied,
    });
  };

  const recordReferencesGain = (
    result: SymbolReferencesResult,
    returnedText: string,
    guardrailApplied: boolean,
  ): void => {
    const returnedTokens = Math.ceil(returnedText.length / 4);
    const scannedTokens = result.scannedFiles > 0 ? result.scannedFiles * 480 : returnedTokens;
    const rawTokens = Math.max(returnedTokens, scannedTokens);
    gainTracker.record({
      op: 'batch_search',
      label: `refs:${result.symbol}`,
      rawTokens,
      returnedTokens,
      guardrailApplied,
    });
  };

  const recordDepContractGain = (
    result: DepContractResult,
    returnedText: string,
    guardrailApplied: boolean,
  ): void => {
    const returnedTokens = Math.ceil(returnedText.length / 4);
    const estimatedFullTokens = result.found
      ? Math.max(returnedTokens * 4, 2400 + result.signatures.length * 48)
      : returnedTokens;
    const saved = Math.max(0, estimatedFullTokens - returnedTokens);
    outlineSavedTokens += saved;
    gainTracker.record({
      op: 'read_outline',
      label: `dep:${result.packageName}`,
      rawTokens: estimatedFullTokens,
      returnedTokens,
      guardrailApplied,
    });
  };

  const buildState = () => {
    const compactStats = chunkStore.getStats();
    const gain = gainTracker.getSummary();
    const { prefs, hotspots } = readCurrentPrefsAndHotspots();
    return {
      mode: isDemo ? 'demo' : 'live',
      workspaceRoot: getWorkspaceRoot(),
      stats: {
        searchCount,
        outlineCount,
        compactionCount: compactStats.totalCompactions,
        indexedChunks: compactStats.indexedChunks,
        maxChunks: compactStats.maxChunks,
        estimatedSavedTokens: Math.max(
          compactStats.totalSavedTokens + outlineSavedTokens,
          gain.totalSavedTokens,
        ),
        compactedSavedTokens: compactStats.totalSavedTokens,
        outlineSavedTokens,
      },
      gain,
      prefs,
      hotspots,
      chunks: chunkStore.listChunks(),
      lastSearch,
      lastReferences,
      lastOutline,
      lastDepContract,
      lastCompact,
      lastContextPack,
      snapshot: buildSnapshotSafe(),
    };
  };

  const modelTools: ModuleToolHandle[] = [];

  // 1. Model-visible: turbo_batch_search (supports text search & lightweight symbol references)
  const batchSearchTool = server.registerTool(
    'turbo_batch_search',
    {
      title: 'Batch Search & Symbol References',
      description:
        'Search 1–8 keywords/safe regex patterns across the workspace in a single pass, or set mode="references" to find exact cross-file definitions, imports, and usages of queries[0] without running an LSP.',
      inputSchema: {
        queries: z
          .array(z.string().min(1))
          .min(1)
          .max(TURBO_MAX_QUERIES)
          .describe('1 to 8 keywords/safe regex patterns (or [symbolName] when mode="references")'),
        mode: SEARCH_MODE_ENUM.optional().describe('Search mode: "text" (default) or "references" for lexical symbol references'),
        directory: z.string().optional().describe('Optional relative subdirectory inside workspace'),
        regex: z.boolean().optional().describe('Treat queries as regex in text mode (auto-falls back to literal if unsafe/invalid)'),
        caseSensitive: z.boolean().optional(),
        maxMatchesPerQuery: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ queries, mode, directory, regex, caseSensitive, maxMatchesPerQuery }) => {
      try {
        if (mode === 'references') {
          const symbol = queries[0]?.trim() ?? '';
          const maxHits = maxMatchesPerQuery ? Math.min(maxMatchesPerQuery * 4, 120) : 120;
          const refResult = findSymbolReferences(getWorkspaceRoot(), symbol, {
            scope: directory,
            maxHits,
          });
          searchCount += 1;
          lastReferences = refResult;

          const rawText = formatSymbolReferencesText(refResult);
          const guarded = enforceToolTextGuardrail(
            rawText,
            `Narrow directory scope or inspect a specific file for symbol "${refResult.symbol}".`,
          );
          recordReferencesGain(refResult, guarded.text, guarded.capped);

          return {
            content: [{ type: 'text', text: guarded.text }],
            structuredContent: {
              mode: 'references',
              ...refResult,
              textGuardrailApplied: guarded.capped,
              textBytes: guarded.bytes,
            },
          };
        }

        const result = batchSearchWorkspace(getWorkspaceRoot(), queries, {
          directory,
          regex,
          caseSensitive,
          maxMatchesPerQuery,
        });
        searchCount += 1;
        lastSearch = result;

        const rawText = formatBatchSearchText(result);
        const guarded = enforceToolTextGuardrail(
          rawText,
          'Narrow `directory`, reduce `maxMatchesPerQuery`, or use more specific queries.',
        );
        recordSearchGain(queries, result, guarded.text, guarded.capped);

        return {
          content: [{ type: 'text', text: guarded.text }],
          structuredContent: {
            ...result,
            textGuardrailApplied: guarded.capped,
            textBytes: guarded.bytes,
          },
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

  // 2. Model-visible: turbo_read_outline (supports file outline/slice & offline dep-contract lookup)
  const readOutlineTool = server.registerTool(
    'turbo_read_outline',
    {
      title: 'Read File Outline / Offline Dep Contract',
      description:
        'Extract top-level/nested symbols and a bounded line slice from a workspace file, or pass depPackage to inspect a locally locked dependency contract (node_modules .d.ts, Python .pyi, go.mod, Cargo.lock) 100% offline.',
      inputSchema: {
        filePath: z.string().min(1).optional().describe('Relative or workspace-scoped file path (required unless depPackage is provided)'),
        depPackage: z
          .string()
          .min(1)
          .max(180)
          .optional()
          .describe('Optional locked dependency name to inspect offline API contract (e.g. "zod", "@modelcontextprotocol/sdk")'),
        symbolFilter: z
          .string()
          .max(128)
          .optional()
          .describe('Optional case-insensitive symbol substring filter when inspecting depPackage'),
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
        includeOutline: z.boolean().optional(),
        maxSliceLines: z.number().int().min(1).max(300).optional(),
      },
    },
    async ({ filePath, depPackage, symbolFilter, startLine, endLine, includeOutline, maxSliceLines }) => {
      try {
        if (depPackage && depPackage.trim()) {
          const depResult = inspectLockedDepContract(getWorkspaceRoot(), depPackage.trim(), {
            symbolFilter,
          });
          outlineCount += 1;
          lastDepContract = depResult;

          const guarded = enforceToolTextGuardrail(
            depResult.snippet,
            `Pass symbolFilter to narrow exported signatures for "${depResult.packageName}".`,
          );
          recordDepContractGain(depResult, guarded.text, guarded.capped || depResult.truncated);

          return {
            content: [{ type: 'text', text: guarded.text }],
            structuredContent: {
              mode: 'dep_contract',
              ...depResult,
              textGuardrailApplied: guarded.capped || depResult.truncated,
              textBytes: guarded.bytes,
            },
          };
        }

        if (!filePath || !filePath.trim()) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Provide either filePath (for file outline & slice) or depPackage (for offline dependency contract lookup).',
              },
            ],
          };
        }

        const result = readFileOutlineAndSlice(getWorkspaceRoot(), filePath, {
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
          .map((s) => {
            const indentPrefix = s.level && s.level > 0 ? '    ' : '  ';
            const displayName = s.parent ? `${s.parent}::${s.name}` : s.name;
            return `${indentPrefix}L${s.line} [${s.kind}] ${displayName}`;
          })
          .join('\n');
        const summary = [
          `${result.file} (${result.language}, ${result.totalLines} lines, ~${result.estimatedSavedTokens} tokens saved)`,
          outlineText ? `Outline (${result.outline.length}):\n${outlineText}` : 'Outline: (none)',
          `Slice (L${result.slice.startLine}-L${result.slice.endLine}):\n${result.slice.content}`,
        ].join('\n');

        const guarded = enforceToolTextGuardrail(
          summary,
          `Narrow startLine/endLine or reduce maxSliceLines for ${result.file}.`,
        );
        const returnedTokens = guarded.capped
          ? Math.min(result.estimatedReturnedTokens, Math.ceil(guarded.text.length / 4))
          : result.estimatedReturnedTokens;
        gainTracker.record({
          op: 'read_outline',
          label: result.file,
          rawTokens: result.estimatedFullTokens,
          returnedTokens,
          guardrailApplied: guarded.capped,
        });

        return {
          content: [{ type: 'text', text: guarded.text }],
          structuredContent: {
            ...result,
            textGuardrailApplied: guarded.capped,
            textBytes: guarded.bytes,
          },
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
        'Compress oversized test/build/git/log output with RTK-style smart presets (auto/test/build/git/generic) while indexing full chunks in memory (LRU 24) for follow-up queries.',
      inputSchema: {
        label: z.string().min(1).max(120).optional().describe('Short label for the command or log output'),
        rawText: z.string().optional().describe('Raw command/log text to compact'),
        preset: COMPACT_PRESET_ENUM.optional().describe('Smart compression preset (auto, test, build, git, generic)'),
        headLines: z.number().int().min(1).max(50).optional(),
        tailLines: z.number().int().min(1).max(50).optional(),
        maxErrorLines: z.number().int().min(1).max(60).optional(),
        query: z.string().optional().describe('Optional immediate keyword query against an existing chunkId'),
        chunkId: z.string().optional().describe('Optional existing chunkId to search instead of compacting'),
      },
    },
    async ({ label, rawText, preset, headLines, tailLines, maxErrorLines, query, chunkId }) => {
      if (chunkId && query !== undefined) {
        const hit = chunkStore.query(chunkId, query, 10);
        const rawQueryText = hit.found
          ? `Chunk ${chunkId} (${hit.label}): ${hit.totalHits} match(es) for "${hit.query}"\n${hit.matches.map((m) => `[L${m.matchedLine}]\n${m.snippet}`).join('\n---\n')}`
          : `Chunk ${chunkId} not found in memory LRU.`;
        const guarded = enforceToolTextGuardrail(
          rawQueryText,
          `Use a more specific query for chunkId="${chunkId}".`,
        );
        return {
          content: [{ type: 'text', text: guarded.text }],
          structuredContent: {
            ...hit,
            textGuardrailApplied: guarded.capped,
            textBytes: guarded.bytes,
          },
        };
      }

      if (typeof rawText !== 'string') {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Provide rawText to compact, or chunkId + query to search an indexed chunk.' }],
        };
      }

      const result = chunkStore.compact(moduleDataDir, label ?? 'output', rawText, {
        preset,
        headLines,
        tailLines,
        maxErrorLines,
        persistStats: false,
      });
      lastCompact = result;
      const presetTag = `[preset=${result.detectedPreset}, saved ${result.savedPercent}%]`;
      const textSummary = result.summaryText.includes(presetTag)
        ? result.summaryText
        : `${presetTag}\n${result.summaryText}`;
      const guarded = enforceToolTextGuardrail(
        textSummary,
        `Query full indexed log via turbo_compact_output with chunkId="${result.chunkId}" and a keyword query.`,
      );
      const returnedTokens = guarded.capped
        ? Math.min(result.estimatedSummaryTokens, Math.ceil(guarded.text.length / 4))
        : result.estimatedSummaryTokens;
      gainTracker.record({
        op: 'compact_output',
        label: result.label,
        rawTokens: result.estimatedRawTokens,
        returnedTokens,
        guardrailApplied: guarded.capped,
      });

      return {
        content: [{ type: 'text', text: guarded.text }],
        structuredContent: {
          ...result,
          textGuardrailApplied: guarded.capped,
          textBytes: guarded.bytes,
        },
      };
    },
  );
  modelTools.push(toHandle('turbo_compact_output', compactOutputTool));

  // App-only tools (10 total: 6 existing + 4 new v0.8.0)
  server.registerTool(
    'app_turbo_get_state',
    {
      title: 'Get Turbo State (App Only)',
      description: 'Return Turbo counters, cumulative gain summary, Auto-RTK prefs/hotspots, indexed chunks, recent search/refs/outline/dep/compaction/pack results, and workspace snapshot.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: buildState(),
    }),
  );

  server.registerTool(
    'app_turbo_get_gain',
    {
      title: 'Get Turbo Cumulative Gain (App Only)',
      description:
        'Return in-memory cumulative token savings, estimated USD saved ($2.50/1M), average compression ratio, guardrail trigger count, and recent Turbo operations.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => {
      const gain = gainTracker.getSummary();
      return {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { ...gain },
      };
    },
  );

  server.registerTool(
    'app_turbo_batch_search',
    {
      title: 'Batch Search / Symbol References (App Only)',
      description: 'Run batch workspace search or cross-file lexical symbol reference lookup from the Turbo UI.',
      inputSchema: {
        queries: z.array(z.string().min(1)).min(1).max(TURBO_MAX_QUERIES),
        mode: SEARCH_MODE_ENUM.optional(),
        directory: z.string().optional(),
        regex: z.boolean().optional(),
        caseSensitive: z.boolean().optional(),
        maxMatchesPerQuery: z.number().int().min(1).max(100).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async (input) => {
      try {
        if (input.mode === 'references') {
          const symbol = input.queries[0]?.trim() ?? '';
          const maxHits = input.maxMatchesPerQuery ? Math.min(input.maxMatchesPerQuery * 4, 120) : 120;
          let refResult = findSymbolReferences(getWorkspaceRoot(), symbol, {
            scope: input.directory,
            maxHits,
          });
          if (isDemo && refResult.totalHits === 0 && symbol === 'registerTurboModule') {
            refResult = buildDemoReferences();
          }
          searchCount += 1;
          lastReferences = refResult;
          const guarded = enforceToolTextGuardrail(formatSymbolReferencesText(refResult));
          recordReferencesGain(refResult, guarded.text, guarded.capped);
          return {
            content: [{ type: 'text', text: 'ok' }],
            structuredContent: { mode: 'references', result: refResult, state: buildState() },
          };
        }

        const result = batchSearchWorkspace(getWorkspaceRoot(), input.queries, input);
        searchCount += 1;
        lastSearch = result;
        const guarded = enforceToolTextGuardrail(formatBatchSearchText(result));
        recordSearchGain(input.queries, result, guarded.text, guarded.capped);
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
        const result = readFileOutlineAndSlice(getWorkspaceRoot(), input.filePath, input);
        outlineCount += 1;
        outlineSavedTokens += result.estimatedSavedTokens;
        lastOutline = result;
        gainTracker.record({
          op: 'read_outline',
          label: result.file,
          rawTokens: result.estimatedFullTokens,
          returnedTokens: result.estimatedReturnedTokens,
          guardrailApplied: false,
        });
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
        preset: COMPACT_PRESET_ENUM.optional(),
        headLines: z.number().int().min(1).max(50).optional(),
        tailLines: z.number().int().min(1).max(50).optional(),
        maxErrorLines: z.number().int().min(1).max(60).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async (input) => {
      const result = chunkStore.compact(moduleDataDir, input.label, input.rawText, {
        preset: input.preset,
        headLines: input.headLines,
        tailLines: input.tailLines,
        maxErrorLines: input.maxErrorLines,
        persistStats: false,
      });
      lastCompact = result;
      const guarded = enforceToolTextGuardrail(result.summaryText);
      gainTracker.record({
        op: 'compact_output',
        label: result.label,
        rawTokens: result.estimatedRawTokens,
        returnedTokens: result.estimatedSummaryTokens,
        guardrailApplied: guarded.capped,
      });
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

  // New v0.8.0 App-only 1 (read-only exempt): app_turbo_get_prefs
  server.registerTool(
    'app_turbo_get_prefs',
    {
      title: 'Get Turbo Auto-RTK Prefs & Hotspots (App Only)',
      description: 'Return read-only Turbo Auto-RTK preferences and command savings hotspots (zero disk writes).',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => {
      const { prefs, hotspots } = readCurrentPrefsAndHotspots();
      return {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { prefs, hotspots },
      };
    },
  );

  // New v0.8.0 App-only 2 (WRITE operation — auto-disabled when turbo module is off): app_turbo_update_prefs
  server.registerTool(
    'app_turbo_update_prefs',
    {
      title: 'Update Turbo Auto-RTK Prefs (App Only)',
      description: 'Toggle opt-in Auto-RTK transparent command compression preference.',
      inputSchema: {
        autoRtk: z.boolean(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ autoRtk }) => {
      try {
        if (isDemo) {
          demoPrefs = {
            schemaVersion: 1,
            autoRtk,
            updatedAt: new Date().toISOString(),
          };
          return {
            content: [{ type: 'text', text: 'ok' }],
            structuredContent: {
              prefs: { ...demoPrefs },
              hotspots: demoHotspots.map((h) => ({ ...h })),
            },
          };
        }
        const prefs = saveTurboPrefs(moduleDataDir, { autoRtk });
        const hotspots = loadTurboHotspotsReadOnly(moduleDataDir);
        return {
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: { prefs, hotspots },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  // New v0.8.0 App-only 3 (read-only exempt): app_turbo_inspect_dep
  server.registerTool(
    'app_turbo_inspect_dep',
    {
      title: 'Inspect Locked Dependency Contract (App Only)',
      description: 'Inspect offline locked dependency API signatures from the Turbo UI (zero network, zero writes).',
      inputSchema: {
        packageName: z.string().min(1).max(180),
        symbolFilter: z.string().max(128).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ packageName, symbolFilter }) => {
      try {
        const cleanPkg = packageName.trim();
        let result: DepContractResult;
        if (isDemo && cleanPkg.toLowerCase() === 'zod') {
          result = buildDemoZodDepContract(symbolFilter);
        } else {
          result = inspectLockedDepContract(getWorkspaceRoot(), cleanPkg, { symbolFilter });
        }
        outlineCount += 1;
        lastDepContract = result;
        const guarded = enforceToolTextGuardrail(result.snippet);
        recordDepContractGain(result, guarded.text, guarded.capped || result.truncated);
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

  // New v0.8.0 App-only 4 (read-only exempt): app_turbo_build_context_pack
  server.registerTool(
    'app_turbo_build_context_pack',
    {
      title: 'Build Redacted Context Pack (App Only)',
      description: 'Build a token-budgeted, secret-redacted Markdown context pack from workspace files or git diff.',
      inputSchema: {
        scope: z.string().optional(),
        globs: z.array(z.string()).max(16).optional(),
        fromGitDiff: z.boolean().optional(),
        maxTokens: z.number().int().min(CONTEXT_PACK_MIN_TOKENS).max(CONTEXT_PACK_MAX_TOKENS).optional(),
        maxFiles: z.number().int().min(1).max(CONTEXT_PACK_MAX_FILES).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async (input) => {
      try {
        const result = isDemo
          ? buildDemoContextPack(input.maxTokens ?? CONTEXT_PACK_DEFAULT_MAX_TOKENS, Boolean(input.fromGitDiff))
          : buildContextPack(getWorkspaceRoot(), input);
        lastContextPack = result;
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

  return {
    moduleId: 'turbo',
    modelTools,
    exemptReadOnlyAppTools: [
      'app_turbo_get_prefs',
      'app_turbo_inspect_dep',
      'app_turbo_build_context_pack',
    ],
  };
}
