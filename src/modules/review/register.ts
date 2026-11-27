import fs from 'node:fs';
import path from 'node:path';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import type { ModuleRegistrationResult, ModuleToolHandle, NovRuntimeOptions } from '../../core/types.js';
import {
  AnnotationStore,
  evaluateAnnotationStaleness,
  MAX_CODE_SNIPPET_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_FILE_PATH_LENGTH,
} from './annotations.js';
import {
  buildDemoFiles,
  buildDemoSeedAnnotations,
  createDemoSession,
  DEMO_REPO_KEY,
} from './demo-data.js';
import { extractCodeSnippet } from './diff-parser.js';
import { resolveAllowedReviewTarget, scanGitDiff } from './git-diff.js';
import { readReviewSignal } from './hook.js';
import { buildReviewPrompt } from './prompt-builder.js';
import type {
  AnnotationCategory,
  ReviewScope,
  ReviewSession,
  ReviewSpecCompliance,
  ReviewSpecComplianceItem,
  ReviewSummary,
  Stage1ChecklistItem,
} from './types.js';

const SCOPE_ENUM = z.enum(['working', 'staged', 'unstaged', 'head~1', 'commit-range']);
const CATEGORY_ENUM = z.enum(['security', 'bug', 'refactor', 'question', 'nit']);
const SIDE_ENUM = z.enum(['new', 'old']);
const STAGE1_ITEM_SCHEMA = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(240),
  status: z.string().max(32).optional(),
  checked: z.boolean(),
  note: z.string().max(400).optional(),
});

const MAX_SPEC_STATE_BYTES = 2 * 1024 * 1024; // 2 MiB read guard

export const DEFAULT_SUMMARY_MAX_FILES = 100;

function wrapModelTool(name: string, tool: RegisteredTool): ModuleToolHandle {
  return {
    name,
    enable: () => tool.enable(),
    disable: () => tool.disable(),
  };
}

/**
 * Pure read-only loader for the active Spec compliance checklist from
 * `<rootDataDir>/modules/spec/state.json`.
 * Never creates directories or writes to disk; returns null when missing or invalid.
 */
export function loadActiveSpecComplianceReadOnly(
  rootDataDir: string,
): ReviewSpecCompliance | null {
  if (!rootDataDir || typeof rootDataDir !== 'string' || rootDataDir.includes('\0')) {
    return null;
  }
  const specStatePath = path.join(getModuleDataDir(rootDataDir, 'spec'), 'state.json');
  let st: fs.Stats;
  try {
    st = fs.lstatSync(specStatePath);
  } catch {
    return null;
  }
  if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_SPEC_STATE_BYTES) {
    return null;
  }

  let parsed: unknown;
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    const fd = fs.openSync(specStatePath, fs.constants.O_RDONLY | noFollow);
    let raw = '';
    try {
      const fdStat = fs.fstatSync(fd);
      if (!fdStat.isFile() || fdStat.size > MAX_SPEC_STATE_BYTES) return null;
      const buf = Buffer.alloc(fdStat.size);
      let offset = 0;
      while (offset < fdStat.size) {
        const n = fs.readSync(fd, buf, offset, fdStat.size - offset, offset);
        if (n <= 0) break;
        offset += n;
      }
      raw = buf.subarray(0, offset).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const activeSpecId = typeof obj.activeSpecId === 'string' ? obj.activeSpecId.trim() : '';
  if (!activeSpecId || !Array.isArray(obj.specs)) {
    return null;
  }

  const matched = obj.specs.find(
    (s): s is Record<string, unknown> =>
      Boolean(s && typeof s === 'object' && !Array.isArray(s) && (s as Record<string, unknown>).id === activeSpecId),
  );
  if (!matched) {
    return null;
  }

  const specId = typeof matched.id === 'string' ? matched.id : activeSpecId;
  const title =
    typeof matched.title === 'string' && matched.title.trim() ? matched.title.trim() : specId;
  const status = typeof matched.status === 'string' && matched.status.trim() ? matched.status.trim() : 'draft';
  const mode = typeof matched.mode === 'string' && matched.mode.trim() ? matched.mode.trim() : undefined;

  const rawTasks = Array.isArray(matched.tasks) ? matched.tasks : [];
  const items: ReviewSpecComplianceItem[] = [];
  for (const rawTask of rawTasks.slice(0, 100)) {
    if (!rawTask || typeof rawTask !== 'object' || Array.isArray(rawTask)) continue;
    const t = rawTask as Record<string, unknown>;
    const taskId = typeof t.id === 'string' && t.id.trim() ? t.id.trim() : `t-${items.length + 1}`;
    const taskTitle =
      typeof t.title === 'string' && t.title.trim() ? t.title.trim().slice(0, 240) : taskId;
    const taskStatus =
      typeof t.status === 'string' && t.status.trim() ? t.status.trim() : 'pending';
    items.push({
      id: taskId,
      title: taskTitle,
      status: taskStatus,
      checked: taskStatus === 'done',
    });
  }

  if (items.length === 0 && Array.isArray(matched.acceptanceCriteria)) {
    for (const rawCrit of matched.acceptanceCriteria.slice(0, 50)) {
      if (typeof rawCrit !== 'string' || !rawCrit.trim()) continue;
      const done = status === 'completed';
      items.push({
        id: `ac-${items.length + 1}`,
        title: rawCrit.trim().slice(0, 240),
        status: done ? 'done' : 'pending',
        checked: done,
      });
    }
  }

  const totalTasks = items.length;
  const doneTasks = items.filter((item) => item.checked).length;

  return {
    specId,
    title,
    status,
    ...(mode ? { mode } : {}),
    totalTasks,
    doneTasks,
    items,
  };
}

function resolveBaseWorkspaceRoot(workspaceRoot: string, moduleDataDir: string): string {
  if (workspaceRoot && workspaceRoot.trim()) {
    return path.resolve(workspaceRoot.trim());
  }
  const signal = readReviewSignal(moduleDataDir);
  if (signal?.workspacePaths && signal.workspacePaths.length > 0 && fs.existsSync(signal.workspacePaths[0])) {
    return path.resolve(signal.workspacePaths[0]);
  }
  return process.cwd();
}

function buildSessionData(
  store: AnnotationStore,
  rootDataDir: string,
  moduleDataDir: string,
  opts: NovRuntimeOptions,
  params: {
    repoPath?: string;
    worktreePath?: string;
    scope?: ReviewScope;
    commitRange?: string;
    ignoreWhitespace?: boolean;
    demo?: boolean;
  },
): ReviewSession {
  const scope: ReviewScope = params.scope ?? 'working';
  const useDemo = params.demo ?? Boolean(opts.demoMode);
  const ignoreWhitespace = Boolean(params.ignoreWhitespace);
  const requestedTarget = params.worktreePath?.trim() || params.repoPath?.trim() || undefined;

  if (useDemo) {
    const demoBase = createDemoSession(scope, requestedTarget);
    const demoFiles = buildDemoFiles();
    store.seedIfEmpty(
      DEMO_REPO_KEY,
      scope,
      buildDemoSeedAnnotations(demoFiles, scope),
      ['test/token-middleware.test.ts'],
    );
    const savedAnnotations = store.listAnnotations(DEMO_REPO_KEY, scope);
    const annotations = evaluateAnnotationStaleness(savedAnnotations, demoFiles);
    const viewedFiles = store.getViewedFiles(DEMO_REPO_KEY, scope);
    return {
      ...demoBase,
      ignoreWhitespace,
      files: demoFiles,
      annotations,
      viewedFiles,
    };
  }

  const baseWorkspace = resolveBaseWorkspaceRoot(opts.workspaceRoot, moduleDataDir);
  const { targetRepoPath, availableWorktrees } = resolveAllowedReviewTarget(
    baseWorkspace,
    requestedTarget,
  );
  const scan = scanGitDiff({
    repoPath: targetRepoPath,
    scope,
    commitRange: params.commitRange,
    ignoreWhitespace,
  });
  const savedAnnotations = store.listAnnotations(scan.repoKey, scope);
  const annotations = evaluateAnnotationStaleness(savedAnnotations, scan.files);
  const viewedFiles = store.getViewedFiles(scan.repoKey, scope);
  const signal = readReviewSignal(moduleDataDir);
  const specCompliance = loadActiveSpecComplianceReadOnly(rootDataDir);

  return {
    repoPath: scan.repoPath,
    repoName: scan.repoName,
    repoKey: scan.repoKey,
    branch: scan.branch,
    headCommit: scan.headCommit,
    scope: scan.scope,
    commitRange: scan.commitRange,
    ignoreWhitespace: scan.ignoreWhitespace,
    isGitRepo: scan.isGitRepo,
    isDemo: false,
    notice: scan.notice,
    generatedAt: new Date().toISOString(),
    totalFiles: scan.totalFiles,
    totalAdditions: scan.totalAdditions,
    totalDeletions: scan.totalDeletions,
    truncated: scan.truncated,
    files: scan.files,
    viewedFiles,
    annotations,
    signal,
    availableWorktrees,
    specCompliance,
  };
}

export function buildSummaryFromSession(
  session: ReviewSession,
  maxFiles = DEFAULT_SUMMARY_MAX_FILES,
): ReviewSummary {
  const viewedSet = new Set(session.viewedFiles);
  const openCountByFile = new Map<string, number>();
  let openAnnotationCount = 0;
  let resolvedAnnotationCount = 0;

  for (const a of session.annotations) {
    if (a.resolved) {
      resolvedAnnotationCount += 1;
    } else {
      openAnnotationCount += 1;
      openCountByFile.set(a.filePath, (openCountByFile.get(a.filePath) ?? 0) + 1);
    }
  }

  const limit = Math.max(1, Math.floor(maxFiles));
  const visibleFiles = session.files.slice(0, limit);
  const omittedFileCount = Math.max(0, session.files.length - visibleFiles.length);

  return {
    repoPath: session.repoPath,
    repoName: session.repoName,
    repoKey: session.repoKey,
    branch: session.branch,
    scope: session.scope,
    commitRange: session.commitRange,
    ignoreWhitespace: session.ignoreWhitespace,
    isGitRepo: session.isGitRepo,
    isDemo: session.isDemo,
    notice: session.notice,
    totalFiles: session.totalFiles,
    totalAdditions: session.totalAdditions,
    totalDeletions: session.totalDeletions,
    viewedCount: session.files.filter((f) => viewedSet.has(f.path)).length,
    openAnnotationCount,
    resolvedAnnotationCount,
    truncated: session.truncated || omittedFileCount > 0,
    omittedFileCount,
    files: visibleFiles.map((f) => ({
      path: f.path,
      oldPath: f.oldPath,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      isBinary: f.isBinary,
      isTruncated: f.isTruncated,
      riskTags: f.riskTags,
      viewed: viewedSet.has(f.path),
      openAnnotationCount: openCountByFile.get(f.path) ?? 0,
    })),
  };
}

function formatSummaryText(summary: ReviewSummary): string {
  if (!summary.isGitRepo) {
    return `Diff Review — ${summary.repoName}: ${summary.notice ?? 'Not a Git repository.'}`;
  }
  const header = `Diff Review — ${summary.repoName} (${summary.branch}, scope: ${summary.scope}): ${summary.totalFiles} file(s), +${summary.totalAdditions} -${summary.totalDeletions}, ${summary.openAnnotationCount} open annotation(s), ${summary.viewedCount}/${summary.totalFiles} viewed.`;
  if (summary.files.length === 0) {
    if (summary.notice) {
      return `${header}\nNotice: ${summary.notice}`;
    }
    return `${header}\nWorking tree is clean for scope "${summary.scope}".`;
  }
  const shown = summary.files.slice(0, 25);
  const fileLines = shown.map((f) => {
    const tags = f.riskTags.length > 0 ? ` [${f.riskTags.join(', ')}]` : '';
    const ann = f.openAnnotationCount > 0 ? ` · ${f.openAnnotationCount} comment(s)` : '';
    const stat = f.isBinary ? 'binary' : `+${f.additions}/-${f.deletions}`;
    return `- [${f.status.toUpperCase()}] ${f.path} (${stat})${tags}${ann}`;
  });
  const remainingCount = Math.max(0, summary.totalFiles - shown.length);
  if (remainingCount > 0) {
    fileLines.push(`... and ${remainingCount} more file(s).`);
  }
  if (summary.notice) {
    fileLines.push(`Notice: ${summary.notice}`);
  }
  return [header, ...fileLines].join('\n');
}

export function registerReviewModule(
  server: McpServer,
  opts: NovRuntimeOptions,
  uiResourceUri: string,
): ModuleRegistrationResult {
  const rootDataDir = resolveNovDataDir(opts.dataDir);
  const moduleDataDir = getModuleDataDir(rootDataDir, 'review');
  const store = new AnnotationStore(moduleDataDir, {
    inMemoryOnly: Boolean(opts.demoMode),
    inMemoryRepoKeys: [DEMO_REPO_KEY],
  });

  const APP_ONLY_META = {
    ui: { visibility: ['app'] },
  };

  // Model-visible tools (2)
  const reviewOpenTool = server.registerTool(
    'review_open',
    {
      title: 'Open Diff Review',
      description:
        'Open the interactive PR-grade inline diff reviewer and annotation studio in agy-NOV. All arguments are optional; pass {} to inspect the active workspace working tree.',
      inputSchema: {
        repoPath: z.string().optional().describe('Optional path to a Git repository or registered worktree; defaults to active workspace'),
        worktreePath: z.string().optional().describe('Optional registered Git worktree path belonging to the active repository'),
        scope: SCOPE_ENUM.optional().describe('Diff scope: working (default), staged, unstaged, head~1, or commit-range'),
        commitRange: z.string().optional().describe('Git commit range when scope is commit-range (e.g. HEAD~2..HEAD)'),
        ignoreWhitespace: z.boolean().optional().describe('Ignore whitespace-only changes (git diff -w)'),
        selectedFile: z.string().optional().describe('Optional relative file path to focus initially'),
        demo: z.boolean().optional().describe('Launch with built-in synthetic demo diff'),
      },
      _meta: {
        ui: { resourceUri: uiResourceUri },
      },
    },
    async ({ repoPath, worktreePath, scope, commitRange, ignoreWhitespace, selectedFile, demo }) => {
      try {
        const session = buildSessionData(store, rootDataDir, moduleDataDir, opts, {
          repoPath,
          worktreePath,
          scope,
          commitRange,
          ignoreWhitespace,
          demo,
        });
        const summary = buildSummaryFromSession(session);
        return {
          content: [{ type: 'text', text: formatSummaryText(summary) }],
          structuredContent: {
            novModule: 'review',
            launch: {
              repoPath: session.repoPath,
              worktreePath: session.repoPath,
              scope: session.scope,
              commitRange: session.commitRange,
              ignoreWhitespace: session.ignoreWhitespace,
              selectedFile: selectedFile ?? session.files[0]?.path,
              demo: session.isDemo,
            },
            summary,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to open Diff Review: ${message}` }],
        };
      }
    },
  );

  const reviewGetSummaryTool = server.registerTool(
    'review_get_summary',
    {
      title: 'Get Review Diff Summary',
      description:
        'Return a concise, token-efficient summary of changed Git files, additions/deletions, risk tags (security-sensitive, large, config, test), and open inline review annotations.',
      inputSchema: {
        repoPath: z.string().optional().describe('Optional path to a Git repository or registered worktree'),
        worktreePath: z.string().optional().describe('Optional registered Git worktree path belonging to the active repository'),
        scope: SCOPE_ENUM.optional().describe('Diff scope (default: working)'),
        commitRange: z.string().optional().describe('Optional Git range when scope is commit-range'),
        ignoreWhitespace: z.boolean().optional().describe('Ignore whitespace-only changes (git diff -w)'),
        demo: z.boolean().optional().describe('Use built-in synthetic demo diff'),
      },
    },
    async ({ repoPath, worktreePath, scope, commitRange, ignoreWhitespace, demo }) => {
      try {
        const session = buildSessionData(store, rootDataDir, moduleDataDir, opts, {
          repoPath,
          worktreePath,
          scope,
          commitRange,
          ignoreWhitespace,
          demo,
        });
        const summary = buildSummaryFromSession(session);
        return {
          content: [{ type: 'text', text: formatSummaryText(summary) }],
          structuredContent: { ...summary },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to inspect diff summary: ${message}` }],
        };
      }
    },
  );

  // App-only tools (8)
  server.registerTool(
    'app_review_get_diff',
    {
      title: 'Get Full Diff Session (App Only)',
      description: 'Fetch parsed diff hunks, file risk tags, viewed states, annotations, available worktrees, and active spec compliance for the Diff Review UI.',
      inputSchema: {
        repoPath: z.string().optional(),
        worktreePath: z.string().optional(),
        scope: SCOPE_ENUM.optional(),
        commitRange: z.string().optional(),
        ignoreWhitespace: z.boolean().optional(),
        demo: z.boolean().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ repoPath, worktreePath, scope, commitRange, ignoreWhitespace, demo }) => {
      try {
        const session = buildSessionData(store, rootDataDir, moduleDataDir, opts, {
          repoPath,
          worktreePath,
          scope,
          commitRange,
          ignoreWhitespace,
          demo,
        });
        return {
          content: [
            {
              type: 'text',
              text: `${session.totalFiles} files (+${session.totalAdditions}/-${session.totalDeletions})`,
            },
          ],
          structuredContent: { session },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: message }],
        };
      }
    },
  );

  server.registerTool(
    'app_review_add_annotation',
    {
      title: 'Add Inline Annotation (App Only)',
      description: 'Persist a new inline diff annotation to the review module data directory.',
      inputSchema: {
        repoKey: z.string().min(4).max(64),
        scope: SCOPE_ENUM,
        filePath: z.string().min(1).max(MAX_FILE_PATH_LENGTH),
        side: SIDE_ENUM.optional(),
        startLine: z.number().int().min(1),
        endLine: z.number().int().min(1).optional(),
        category: CATEGORY_ENUM,
        comment: z.string().min(1).max(MAX_COMMENT_LENGTH),
        codeSnippet: z.string().max(MAX_CODE_SNIPPET_LENGTH).optional(),
        fileFingerprint: z.string().max(128).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async (args) => {
      try {
        if (args.endLine !== undefined && args.endLine < args.startLine) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Invalid line range: endLine (${args.endLine}) must be greater than or equal to startLine (${args.startLine}).`,
              },
            ],
          };
        }
        const annotation = store.addAnnotation({
          repoKey: args.repoKey,
          scope: args.scope,
          filePath: args.filePath,
          side: args.side,
          startLine: args.startLine,
          endLine: args.endLine,
          category: args.category as AnnotationCategory,
          comment: args.comment,
          codeSnippet: args.codeSnippet,
          fileFingerprint: args.fileFingerprint,
        });
        const annotations = store.listAnnotations(args.repoKey, args.scope);
        return {
          content: [{ type: 'text', text: `Saved annotation ${annotation.id}` }],
          structuredContent: { annotation, annotations },
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
    'app_review_update_annotation',
    {
      title: 'Update Inline Annotation (App Only)',
      description: 'Update an existing annotation comment, category, or resolved flag.',
      inputSchema: {
        repoKey: z.string().min(4).max(64),
        scope: SCOPE_ENUM,
        id: z.string().min(1).max(128),
        comment: z.string().min(1).max(MAX_COMMENT_LENGTH).optional(),
        category: CATEGORY_ENUM.optional(),
        resolved: z.boolean().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ repoKey, scope, id, comment, category, resolved }) => {
      try {
        const updated = store.updateAnnotation(repoKey, scope, id, {
          comment,
          category: category as AnnotationCategory | undefined,
          resolved,
        });
        if (!updated) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Annotation "${id}" not found.` }],
          };
        }
        const annotations = store.listAnnotations(repoKey, scope);
        return {
          content: [{ type: 'text', text: `Updated annotation ${id}` }],
          structuredContent: { annotation: updated, annotations },
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
    'app_review_toggle_resolve',
    {
      title: 'Toggle Annotation Resolved State (App Only)',
      description: 'Toggle an annotation between open and resolved states.',
      inputSchema: {
        repoKey: z.string().min(4).max(64),
        scope: SCOPE_ENUM,
        id: z.string().min(1).max(128),
      },
      _meta: APP_ONLY_META,
    },
    async ({ repoKey, scope, id }) => {
      try {
        const updated = store.toggleResolve(repoKey, scope, id);
        if (!updated) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Annotation "${id}" not found.` }],
          };
        }
        const annotations = store.listAnnotations(repoKey, scope);
        return {
          content: [{ type: 'text', text: `Annotation ${id} resolved=${updated.resolved}` }],
          structuredContent: { annotation: updated, annotations },
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
    'app_review_delete_annotation',
    {
      title: 'Delete Inline Annotation (App Only)',
      description: 'Delete an annotation by ID.',
      inputSchema: {
        repoKey: z.string().min(4).max(64),
        scope: SCOPE_ENUM,
        id: z.string().min(1).max(128),
      },
      _meta: APP_ONLY_META,
    },
    async ({ repoKey, scope, id }) => {
      try {
        const deleted = store.deleteAnnotation(repoKey, scope, id);
        const annotations = store.listAnnotations(repoKey, scope);
        return {
          content: [{ type: 'text', text: deleted ? `Deleted ${id}` : `Not found: ${id}` }],
          structuredContent: { deleted, annotations },
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
    'app_review_clear_resolved',
    {
      title: 'Clear Resolved Annotations (App Only)',
      description: 'Remove all resolved annotations in the given repo scope.',
      inputSchema: {
        repoKey: z.string().min(4).max(64),
        scope: SCOPE_ENUM,
      },
      _meta: APP_ONLY_META,
    },
    async ({ repoKey, scope }) => {
      try {
        const removed = store.clearResolved(repoKey, scope);
        const annotations = store.listAnnotations(repoKey, scope);
        return {
          content: [{ type: 'text', text: `Cleared ${removed} resolved annotation(s)` }],
          structuredContent: { removed, annotations },
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
    'app_review_mark_file_viewed',
    {
      title: 'Mark File Viewed (App Only)',
      description: 'Toggle the viewed checkmark for a diff file.',
      inputSchema: {
        repoKey: z.string().min(4).max(64),
        scope: SCOPE_ENUM,
        filePath: z.string().min(1).max(MAX_FILE_PATH_LENGTH),
        viewed: z.boolean(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ repoKey, scope, filePath, viewed }) => {
      try {
        const viewedFiles = store.setFileViewed(repoKey, scope, filePath, viewed);
        return {
          content: [{ type: 'text', text: `${filePath} viewed=${viewed}` }],
          structuredContent: { viewedFiles },
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
    'app_review_build_prompt',
    {
      title: 'Build Structured Review Prompt (App Only)',
      description: 'Package Stage 1 spec compliance checks and Stage 2 file:line inline annotations into a structured review prompt for the agent.',
      inputSchema: {
        repoPath: z.string().optional(),
        worktreePath: z.string().optional(),
        scope: SCOPE_ENUM.optional(),
        commitRange: z.string().optional(),
        ignoreWhitespace: z.boolean().optional(),
        demo: z.boolean().optional(),
        includeResolved: z.boolean().optional(),
        annotationIds: z.array(z.string()).optional(),
        stage1Checklist: z.array(STAGE1_ITEM_SCHEMA).max(100).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({
      repoPath,
      worktreePath,
      scope,
      commitRange,
      ignoreWhitespace,
      demo,
      includeResolved,
      annotationIds,
      stage1Checklist,
    }) => {
      try {
        const session = buildSessionData(store, rootDataDir, moduleDataDir, opts, {
          repoPath,
          worktreePath,
          scope,
          commitRange,
          ignoreWhitespace,
          demo,
        });
        const enrichedAnnotations = session.annotations.map((ann) => {
          if (ann.codeSnippet) return ann;
          const file = session.files.find((f) => f.path === ann.filePath);
          return {
            ...ann,
            codeSnippet: extractCodeSnippet(file, ann.startLine, ann.endLine, ann.side),
          };
        });
        const built = buildReviewPrompt({
          repoName: session.repoName,
          branch: session.branch,
          scope: session.scope,
          commitRange: session.commitRange,
          annotations: enrichedAnnotations,
          files: session.files,
          includeResolved,
          annotationIds,
          specCompliance: session.specCompliance,
          stage1Checklist: stage1Checklist as Stage1ChecklistItem[] | undefined,
        });
        return {
          content: [{ type: 'text', text: built.markdown }],
          structuredContent: { ...built },
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
    moduleId: 'review',
    modelTools: [
      wrapModelTool('review_open', reviewOpenTool),
      wrapModelTool('review_get_summary', reviewGetSummaryTool),
    ],
  };
}
