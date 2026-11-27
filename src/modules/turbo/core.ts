import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalRealpathSync,
  isPathInsideDir,
  isSamePath,
} from '../../core/utils.js';
import { isSensitiveTurboPath, TURBO_SKIP_DIRS } from './search.js';

// ============================================================================
// Turbo Context Public Facade (100% Backward-Compatible Re-Exports)
// ============================================================================

export {
  batchSearchWorkspace,
  isPotentiallyUnsafeRegex,
  isSensitiveTurboPath,
  resolveInsideWorkspaceReal,
  TURBO_MAX_FILE_BYTES,
  TURBO_MAX_QUERIES,
  TURBO_MAX_QUERY_LENGTH,
  type BatchQueryResult,
  type BatchSearchMatch,
  type BatchSearchOptions,
  type BatchSearchResult,
} from './search.js';

export {
  enforceToolTextGuardrail,
  estimateSavedUsd,
  TURBO_GAIN_MAX_RECENT,
  TURBO_INPUT_USD_PER_MILLION_TOKENS,
  TURBO_MAX_TOOL_TEXT_BYTES,
  TurboGainTracker,
  type ToolTextGuardrailResult,
  type TurboGainOperation,
  type TurboGainOperationBucket,
  type TurboGainRecentEntry,
  type TurboGainRecordInput,
  type TurboGainSummary,
} from './gain.js';

export {
  extractOutlineSymbols,
  readFileOutlineAndSlice,
  TURBO_MAX_OUTLINE_FILE_BYTES,
  type OutlineSymbol,
  type ReadOutlineOptions,
  type ReadOutlineResult,
} from './outline.js';

export {
  capCompactedLines,
  CompactedChunkStore,
  compactLargeOutput,
  defaultCompactedChunkStore,
  detectOutputPreset,
  queryCompactedChunk,
  TURBO_DEFAULT_MAX_COMPACT_LINES,
  TURBO_MAX_COMPACT_LINES,
  TURBO_MAX_COMPACTED_CHUNKS,
  TURBO_MIN_COMPACT_LINES,
  type AggregatedDiagnostic,
  type ChunkQueryMatch,
  type ChunkQueryResult,
  type CompactedChunkMeta,
  type CompactOutputOptions,
  type CompactOutputResult,
  type CompactPreset,
  type ResolvedCompactPreset,
} from './compress.js';

// ============================================================================
// Read-Only Workspace Snapshot (<= 40 lines, Zero Disk Writes)
// ============================================================================

export interface WorkspaceSnapshot {
  workspaceName: string;
  packageName?: string;
  packageVersion?: string;
  techStack: string[];
  scripts: string[];
  treeLines: string[];
  lineCount: number;
  markdown: string;
  elapsedMs: number;
}

const SNAPSHOT_EXPAND_DIRS = new Set([
  'src',
  'app',
  'apps',
  'packages',
  'lib',
  'ui',
  'test',
  'tests',
  'scripts',
  'cmd',
  'pkg',
  'internal',
]);

export function buildWorkspaceSnapshot(workspaceRoot: string): WorkspaceSnapshot {
  const startedAt = Date.now();
  const realRoot = canonicalRealpathSync(path.resolve(workspaceRoot));
  const workspaceName = path.basename(realRoot) || 'workspace';

  const techStack: string[] = [];
  const scripts: string[] = [];
  let packageName: string | undefined;
  let packageVersion: string | undefined;

  const hasFile = (name: string): boolean => {
    try {
      const candidate = path.join(realRoot, name);
      const real = canonicalRealpathSync(candidate);
      return isPathInsideDir(realRoot, real) && !isSamePath(realRoot, real) && fs.statSync(real).isFile();
    } catch {
      return false;
    }
  };

  if (hasFile('package.json')) {
    techStack.push('Node.js');
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(realRoot, 'package.json'), 'utf8')) as {
        name?: unknown;
        version?: unknown;
        scripts?: Record<string, unknown>;
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      };
      if (typeof pkg.name === 'string') packageName = pkg.name.slice(0, 64);
      if (typeof pkg.version === 'string') packageVersion = pkg.version.slice(0, 32);
      if (pkg.scripts && typeof pkg.scripts === 'object') {
        scripts.push(...Object.keys(pkg.scripts).slice(0, 8));
      }
      const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      if ('typescript' in allDeps) techStack.push('TypeScript');
      if ('react' in allDeps) techStack.push('React');
      if ('vite' in allDeps) techStack.push('Vite');
      if ('next' in allDeps) techStack.push('Next.js');
      if ('vue' in allDeps) techStack.push('Vue');
    } catch {
      // ignore invalid package.json
    }
  }
  if (hasFile('tsconfig.json') && !techStack.includes('TypeScript')) techStack.push('TypeScript');
  if (hasFile('pyproject.toml') || hasFile('requirements.txt')) techStack.push('Python');
  if (hasFile('go.mod')) techStack.push('Go');
  if (hasFile('Cargo.toml')) techStack.push('Rust');
  if (hasFile('Dockerfile') || hasFile('docker-compose.yml') || hasFile('compose.yaml')) {
    techStack.push('Docker');
  }
  if (hasFile('AGENTS.md')) techStack.push('AGENTS.md');
  if (hasFile('CLAUDE.md')) techStack.push('CLAUDE.md');

  const treeLines: string[] = [];
  const maxTreeLines = 28;
  let extraEntries = 0;

  try {
    const entries = fs
      .readdirSync(realRoot, { withFileTypes: true })
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of entries) {
      if (TURBO_SKIP_DIRS.has(entry.name) || isSensitiveTurboPath(entry.name)) continue;
      if (entry.isSymbolicLink()) {
        try {
          const realEntry = canonicalRealpathSync(path.join(realRoot, entry.name));
          const realEntryRel = path.relative(realRoot, realEntry).replace(/\\/g, '/');
          if (!isPathInsideDir(realRoot, realEntry) || isSamePath(realRoot, realEntry) || isSensitiveTurboPath(realEntryRel)) continue;
        } catch {
          continue;
        }
      }

      if (treeLines.length >= maxTreeLines) {
        extraEntries += 1;
        continue;
      }

      if (entry.isDirectory()) {
        treeLines.push(`- ${entry.name}/`);
        if (SNAPSHOT_EXPAND_DIRS.has(entry.name) && treeLines.length < maxTreeLines) {
          try {
            const subEntries = fs
              .readdirSync(path.join(realRoot, entry.name), { withFileTypes: true })
              .filter((sub) => {
                if (TURBO_SKIP_DIRS.has(sub.name) || isSensitiveTurboPath(`${entry.name}/${sub.name}`)) {
                  return false;
                }
                if (sub.isSymbolicLink()) {
                  try {
                    const realSub = canonicalRealpathSync(path.join(realRoot, entry.name, sub.name));
                    const realSubRel = path.relative(realRoot, realSub).replace(/\\/g, '/');
                    return isPathInsideDir(realRoot, realSub) && !isSamePath(realRoot, realSub) && !isSensitiveTurboPath(realSubRel);
                  } catch {
                    return false;
                  }
                }
                return true;
              })
              .sort((a, b) => a.name.localeCompare(b.name));
            const shown = subEntries.slice(0, 5);
            for (const sub of shown) {
              if (treeLines.length >= maxTreeLines) break;
              treeLines.push(`  - ${sub.name}${sub.isDirectory() ? '/' : ''}`);
            }
            if (subEntries.length > shown.length && treeLines.length < maxTreeLines) {
              treeLines.push(`  - ... (+${subEntries.length - shown.length} more)`);
            }
          } catch {
            // ignore unreadable subdir
          }
        }
      } else {
        treeLines.push(`- ${entry.name}`);
      }
    }
  } catch {
    // ignore unreadable root
  }

  if (extraEntries > 0) {
    treeLines.push(`- ... (+${extraEntries} more entries)`);
  }

  const lines: string[] = [
    `Workspace: ${packageName ? `${packageName}${packageVersion ? `@${packageVersion}` : ''}` : workspaceName}`,
    `Stack: ${techStack.length > 0 ? techStack.join(', ') : 'Generic'}`,
  ];
  if (scripts.length > 0) {
    lines.push(`Scripts: ${scripts.join(', ')}`);
  }
  lines.push('Structure:');
  lines.push(...treeLines);

  // Enforce strict <= 40 lines budget
  const finalLines = lines.slice(0, 40);
  if (lines.length > 40) {
    finalLines[39] = '... (truncated to 40-line budget)';
  }

  return {
    workspaceName,
    packageName,
    packageVersion,
    techStack,
    scripts,
    treeLines,
    lineCount: finalLines.length,
    markdown: finalLines.join('\n'),
    elapsedMs: Date.now() - startedAt,
  };
}
