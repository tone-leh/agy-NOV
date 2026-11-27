import type { TurboHotspotRecord } from './auto-rtk.js';
import type { CompactedChunkStore, CompactOutputResult } from './compress.js';
import {
  CONTEXT_PACK_DEFAULT_MAX_TOKENS,
  CONTEXT_PACK_MAX_TOKENS,
  CONTEXT_PACK_MIN_TOKENS,
  type ContextPackResult,
} from './context-pack.js';
import type { DepContractResult, DepContractSignature } from './dep-contract.js';
import type { TurboGainTracker } from './gain.js';
import type { ReadOutlineResult } from './outline.js';
import type { SymbolReferencesResult } from './references.js';
import type { BatchSearchResult } from './search.js';

// ============================================================================
// Pure In-Memory Synthetic Demo Mode Fixtures (Zero Disk I/O)
// ============================================================================

export function buildDemoZodDepContract(symbolFilter?: string): DepContractResult {
  const allSigs: DepContractSignature[] = [
    {
      line: 12,
      kind: 'function',
      signature: 'export function string(params?: string | $ZodStringParams): ZodString',
      sourceFile: 'node_modules/zod/v4/classic/schemas.d.ts',
    },
    {
      line: 48,
      kind: 'function',
      signature: 'export function number(params?: string | $ZodNumberParams): ZodNumber',
      sourceFile: 'node_modules/zod/v4/classic/schemas.d.ts',
    },
    {
      line: 112,
      kind: 'function',
      signature: 'export function object<T extends $ZodShape>(shape: T): ZodObject<T>',
      sourceFile: 'node_modules/zod/v4/classic/schemas.d.ts',
    },
    {
      line: 164,
      kind: 'function',
      signature: 'export function enum<T extends util.EnumLike>(values: T): ZodEnum<T>',
      sourceFile: 'node_modules/zod/v4/classic/schemas.d.ts',
    },
    {
      line: 210,
      kind: 'interface',
      signature: 'export interface ZodType<Output = unknown, Input = Output>',
      sourceFile: 'node_modules/zod/v4/classic/schemas.d.ts',
    },
    {
      line: 24,
      kind: 'function',
      signature: 'export function toJSONSchema(schema: $ZodType, params?: ToJSONSchemaParams): JSONSchema',
      sourceFile: 'node_modules/zod/v4/core/json-schema-processors.d.ts',
    },
    {
      line: 7,
      kind: 'type',
      signature: 'export type infer<T extends $ZodType> = T["_zod"]["output"]',
      sourceFile: 'node_modules/zod/v4/classic/external.d.ts',
    },
  ];
  const cleanFilter = symbolFilter?.trim() || '';
  const signatures = cleanFilter
    ? allSigs.filter((s) => s.signature.toLowerCase().includes(cleanFilter.toLowerCase()))
    : allSigs;

  const lines = [
    '[Dep Contract] zod@4.6.7 (node)',
    'Description: TypeScript-first schema declaration and validation library with static type inference',
    'Entry: node_modules/zod/index.d.cts',
    'Exports: types=./index.d.cts | main=./index.cjs | exports=[.→./index.d.cts, ./mini→./mini/index.d.cts, ./v4→./v4/index.d.cts]',
    ...(cleanFilter ? [`Filter: "${cleanFilter}" (${signatures.length} matched)`] : []),
    `Signatures (${signatures.length}):`,
    ...signatures.map((s) => `  L${s.line} [${s.kind}] ${s.signature}`),
  ];
  const snippet = lines.join('\n');
  return {
    found: true,
    ecosystem: 'node',
    packageName: 'zod',
    version: '4.6.7',
    entryFile: 'node_modules/zod/index.d.cts',
    exportsSummary:
      'types=./index.d.cts | main=./index.cjs | exports=[.→./index.d.cts, ./mini→./mini/index.d.cts, ./v4→./v4/index.d.cts]',
    signatures,
    snippet,
    totalBytes: Buffer.byteLength(snippet, 'utf8'),
    truncated: false,
    note: 'Demo synthetic locked contract (offline read-only)',
  };
}

export function buildDemoContextPack(
  maxTokens = CONTEXT_PACK_DEFAULT_MAX_TOKENS,
  fromGitDiff = false,
): ContextPackResult {
  const tree = [
    '- src/',
    '  - core/',
    '    - catalog.ts',
    '  - modules/',
    '    - turbo/',
    '      - dep-contract.ts',
    '      - register.ts',
  ].join('\n');

  const body = [
    `# Turbo Context Pack (${fromGitDiff ? 'git-diff' : 'scope: src/modules/turbo'})`,
    `Budget: <= ${maxTokens.toLocaleString()} tokens | Redacted secrets enabled`,
    '',
    '## Directory Tree',
    tree,
    '',
    '## Files',
    '',
    '### src/modules/turbo/dep-contract.ts',
    '```ts',
    'export function inspectLockedDepContract(workspaceRoot: string, packageName: string) {',
    '  // 100% offline read-only contract extraction with <=8.8KB guardrail',
    '  const demoToken = "[REDACTED_KEY]";',
    '  return { found: true, packageName, demoToken };',
    '}',
    '```',
    '',
    '### src/modules/turbo/register.ts',
    '```ts',
    'export function registerTurboModule(server, options, uiResourceUri) {',
    '  // Strictly 3 model-visible tools, zero tool-count bloat',
    '  return { moduleId: "turbo", modelTools };',
    '}',
    '```',
  ].join('\n');

  const maxChars = Math.max(CONTEXT_PACK_MIN_TOKENS, Math.min(maxTokens, CONTEXT_PACK_MAX_TOKENS)) * 4;
  const truncated = body.length > maxChars;
  const markdown = truncated ? body.slice(0, maxChars) : body;

  return {
    mode: fromGitDiff ? 'git_diff' : 'scope',
    scope: 'src/modules/turbo',
    globs: ['**/*.ts'],
    maxTokens,
    estimatedTokens: Math.ceil(markdown.length / 4),
    totalChars: markdown.length,
    totalFiles: 2,
    includedFiles: 2,
    skippedSensitive: 1,
    skippedBinary: 0,
    skippedSymlinks: 0,
    skippedOversized: 0,
    redactionCount: 1,
    truncated,
    tree,
    files: [
      {
        path: 'src/modules/turbo/dep-contract.ts',
        bytes: 214,
        estimatedTokens: 54,
        truncated: false,
        redactions: 1,
      },
      {
        path: 'src/modules/turbo/register.ts',
        bytes: 162,
        estimatedTokens: 41,
        truncated: false,
        redactions: 0,
      },
    ],
    markdown,
    elapsedMs: 6,
    note: 'Demo synthetic redacted context pack (zero disk writes)',
  };
}

export function buildDemoReferences(): SymbolReferencesResult {
  return {
    symbol: 'registerTurboModule',
    scope: 'src',
    scannedFiles: 46,
    definitions: [
      {
        file: 'src/modules/turbo/register.ts',
        line: 238,
        column: 17,
        kind: 'definition',
        snippet: 'export function registerTurboModule(server: McpServer, options: NovRuntimeOptions, uiResourceUri: string)',
      },
    ],
    imports: [
      {
        file: 'src/server/index.ts',
        line: 56,
        column: 10,
        kind: 'import',
        snippet: "import { registerTurboModule } from '../modules/turbo/register.js';",
      },
      {
        file: 'test/v06-turbo-gain.test.ts',
        line: 20,
        column: 10,
        kind: 'import',
        snippet: "import { registerTurboModule } from '../src/modules/turbo/register.js';",
      },
    ],
    usages: [
      {
        file: 'src/server/index.ts',
        line: 462,
        column: 34,
        kind: 'usage',
        snippet: 'registerWithAppTracking((s) => registerTurboModule(s, options, UI_RESOURCE_URI)),',
      },
    ],
    totalHits: 4,
    truncated: false,
    elapsedMs: 9,
  };
}

export function createDemoHotspots(): TurboHotspotRecord[] {
  const now = Date.now();
  return [
    {
      commandPrefix: 'npm test',
      count: 7,
      lastCommand: 'npm test',
      estimatedWasteTokens: 48_600,
      lastSeenAt: new Date(now - 90_000).toISOString(),
    },
    {
      commandPrefix: 'git diff',
      count: 4,
      lastCommand: 'git diff --stat',
      estimatedWasteTokens: 19_200,
      lastSeenAt: new Date(now - 240_000).toISOString(),
    },
  ];
}

export function seedDemoTurboStore(
  store: CompactedChunkStore,
  gainTracker: TurboGainTracker,
): {
  lastCompact: CompactOutputResult;
  lastSearch: BatchSearchResult;
  lastOutline: ReadOutlineResult;
  lastReferences: SymbolReferencesResult;
  lastDepContract: DepContractResult;
  lastContextPack: ContextPackResult;
  hotspots: TurboHotspotRecord[];
} {
  const sampleBuildLog = [
    '> agy-nov@0.8.0 test',
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
  const installCompact = store.compact(undefined, 'npm ci (demo output)', sampleInstallLog, {
    persistStats: false,
  });

  const lastSearch: BatchSearchResult = {
    scope: 'src',
    scannedFiles: 46,
    scannedBytes: 168400,
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
      {
        kind: 'function',
        name: 'isSensitiveTurboPath',
        line: 196,
        signature: 'export function isSensitiveTurboPath(inputPath: string): boolean',
        level: 0,
      },
      {
        kind: 'function',
        name: 'batchSearchWorkspace',
        line: 342,
        signature: 'export function batchSearchWorkspace(workspaceRoot, queries, opts)',
        level: 0,
      },
      {
        kind: 'function',
        name: 'readFileOutlineAndSlice',
        line: 510,
        signature: 'export function readFileOutlineAndSlice(workspaceRoot, filePath, opts)',
        level: 0,
      },
      {
        kind: 'class',
        name: 'CompactedChunkStore',
        line: 580,
        signature: 'export class CompactedChunkStore',
        level: 0,
      },
      {
        kind: 'method',
        name: 'compact',
        line: 592,
        signature: 'compact(dataDir, label, rawText, opts): CompactOutputResult',
        parent: 'CompactedChunkStore',
        level: 1,
      },
      {
        kind: 'method',
        name: 'query',
        line: 794,
        signature: 'query(chunkId: string, query: string, limit = 10): ChunkQueryResult',
        parent: 'CompactedChunkStore',
        level: 1,
      },
      {
        kind: 'function',
        name: 'buildWorkspaceSnapshot',
        line: 890,
        signature: 'export function buildWorkspaceSnapshot(workspaceRoot: string)',
        level: 0,
      },
    ],
    outlineTruncated: false,
    slice: {
      startLine: 1,
      endLine: 12,
      truncated: true,
      content:
        '1 | import crypto from "node:crypto";\n2 | import fs from "node:fs";\n3 | import path from "node:path";',
    },
    estimatedFullTokens: 4605,
    estimatedReturnedTokens: 218,
    estimatedSavedTokens: 4387,
  };

  const lastReferences = buildDemoReferences();
  const lastDepContract = buildDemoZodDepContract();
  const lastContextPack = buildDemoContextPack();
  const hotspots = createDemoHotspots();

  // Seed realistic in-memory cumulative gain records (zero disk writes)
  const baseTs = Date.now() - 180_000;
  gainTracker.record({
    op: 'batch_search',
    label: 'registerTool, realpathSync',
    rawTokens: 42100,
    returnedTokens: 420,
    guardrailApplied: false,
    timestamp: new Date(baseTs).toISOString(),
  });
  gainTracker.record({
    op: 'read_outline',
    label: 'src/server/index.ts',
    rawTokens: 5400,
    returnedTokens: 310,
    guardrailApplied: false,
    timestamp: new Date(baseTs + 30_000).toISOString(),
  });
  gainTracker.record({
    op: 'read_outline',
    label: 'src/modules/turbo/core.ts',
    rawTokens: lastOutline.estimatedFullTokens,
    returnedTokens: lastOutline.estimatedReturnedTokens,
    guardrailApplied: false,
    timestamp: new Date(baseTs + 60_000).toISOString(),
  });
  gainTracker.record({
    op: 'compact_output',
    label: installCompact.label,
    rawTokens: installCompact.estimatedRawTokens,
    returnedTokens: installCompact.estimatedSummaryTokens,
    guardrailApplied: false,
    timestamp: new Date(baseTs + 110_000).toISOString(),
  });
  gainTracker.record({
    op: 'compact_output',
    label: lastCompact.label,
    rawTokens: Math.max(lastCompact.estimatedRawTokens, 12800),
    returnedTokens: Math.min(lastCompact.estimatedSummaryTokens, 1450),
    guardrailApplied: true,
    timestamp: new Date(baseTs + 150_000).toISOString(),
  });

  return {
    lastCompact,
    lastSearch,
    lastOutline,
    lastReferences,
    lastDepContract,
    lastContextPack,
    hotspots,
  };
}
