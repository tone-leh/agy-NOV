import path from 'node:path';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type {
  ModuleRegistrationResult,
  ModuleToolHandle,
  NovRuntimeOptions,
} from '../../core/types.js';
import {
  cleanupWorktree,
  createDemoWorktreeStore,
  createWorktree,
  getWorktreeDiffSummary,
  inspectWorktrees,
  previewWorktreeIncludeForWorkspace,
  type CleanupWorktreeOptions,
  type CleanupWorktreeResult,
  type CreateWorktreeOptions,
  type CreateWorktreeResult,
  type DemoWorktreeStore,
  type WorktreeDiffSummaryResult,
  type WorktreeIncludePreviewResult,
  type WorktreeInspectResult,
} from './core.js';

function toHandle(name: string, tool: RegisteredTool): ModuleToolHandle {
  return {
    name,
    enable: () => tool.enable(),
    disable: () => tool.disable(),
  };
}

function formatErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatListSummary(state: WorktreeInspectResult): string {
  if (!state.isGitRepo) {
    return `Not a Git repository: ${state.repoRoot} (0 worktrees).`;
  }
  const lines: string[] = [
    `Git Worktrees (${state.mode}) — repo=${state.repoRoot}, total=${state.counts.total}, dirty=${state.counts.dirty}, merged=${state.counts.merged}, prunable=${state.counts.prunable}`,
  ];
  if (state.worktreeConfigWarning) {
    lines.push(
      'WARNING: extensions.worktreeConfig=true is enabled in this repository and may cause unexpected worktree config behavior.',
    );
  }
  for (const wt of state.worktrees) {
    const flags: string[] = [];
    if (wt.isMain) flags.push('MAIN');
    if (wt.detached) flags.push('DETACHED');
    if (wt.isDirty) flags.push(`DIRTY:${wt.changedFilesCount}`);
    if (wt.isMerged && !wt.isMain) flags.push('MERGED');
    if (wt.locked) flags.push('LOCKED');
    if (wt.prunable) flags.push('PRUNABLE');
    const aheadBehind = wt.ahead || wt.behind ? ` (+${wt.ahead}/-${wt.behind})` : '';
    lines.push(
      `- [${flags.join(', ') || 'CLEAN'}] ${wt.branch ?? '(detached)'} @ ${wt.head || 'unborn'}${aheadBehind} -> ${wt.path}`,
    );
  }
  return lines.join('\n');
}

function formatDiffSummary(diff: WorktreeDiffSummaryResult): string {
  const lines: string[] = [
    `Worktree Diff Summary: ${diff.branch ?? '(detached)'} vs ${diff.baseRef} (+${diff.ahead}/-${diff.behind})`,
    `Path: ${diff.worktreePath}`,
    `Files (${diff.files.length}):`,
    ...(diff.files.length > 0
      ? diff.files.slice(0, 40).map((f) => `  ${f.status.padEnd(2, ' ')} ${f.path}`)
      : ['  (none)']),
    '',
    diff.statText,
  ];
  return lines.join('\n');
}

export function registerWorktreeModule(
  server: McpServer,
  options: NovRuntimeOptions,
  uiResourceUri: string,
): ModuleRegistrationResult {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const isDemo = options.demoMode === true;

  // Registration performs zero disk I/O and zero Git commands.
  // In demo mode, all state lives strictly in memory.
  const demoStore: DemoWorktreeStore | null = isDemo
    ? createDemoWorktreeStore(workspaceRoot)
    : null;

  const APP_ONLY_META = {
    ui: {
      resourceUri: uiResourceUri,
      visibility: ['app'] as ['app'],
    },
  };

  const runList = async (): Promise<WorktreeInspectResult> =>
    isDemo && demoStore ? demoStore.list() : inspectWorktrees(workspaceRoot);

  const runPreviewInclude = async (): Promise<WorktreeIncludePreviewResult> =>
    isDemo && demoStore
      ? demoStore.previewInclude()
      : previewWorktreeIncludeForWorkspace(workspaceRoot);

  const runCreate = async (opts: CreateWorktreeOptions): Promise<CreateWorktreeResult> =>
    isDemo && demoStore ? demoStore.create(opts) : createWorktree(workspaceRoot, opts);

  const runDiffSummary = async (
    worktreePath: string,
    baseRef?: string,
  ): Promise<WorktreeDiffSummaryResult> =>
    isDemo && demoStore
      ? demoStore.diffSummary(worktreePath, baseRef)
      : getWorktreeDiffSummary(workspaceRoot, worktreePath, baseRef);

  const runCleanup = async (opts: CleanupWorktreeOptions): Promise<CleanupWorktreeResult> =>
    isDemo && demoStore ? demoStore.cleanup(opts) : cleanupWorktree(workspaceRoot, opts);

  const modelTools: ModuleToolHandle[] = [];

  // 1. Model-visible: worktree_list
  const listTool = server.registerTool(
    'worktree_list',
    {
      title: 'List Git Worktrees',
      description:
        'Inspect all active Git worktrees for this repository, including dirty state, ahead/behind counts, merged status, prunable entries, and extensions.worktreeConfig hazard detection.',
      inputSchema: {},
    },
    async () => {
      try {
        const state = await runList();
        return {
          content: [{ type: 'text', text: formatListSummary(state) }],
          structuredContent: { ...state },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );
  modelTools.push(toHandle('worktree_list', listTool));

  // 2. Model-visible: worktree_create
  const createTool = server.registerTool(
    'worktree_create',
    {
      title: 'Create Git Worktree',
      description:
        'Create an isolated Git worktree inside `<repo>/.agy-worktrees/<slug>` for a new or existing branch, optionally carrying uncommitted changes and safely copying whitelisted non-sensitive files declared in `.worktreeinclude`.',
      inputSchema: {
        branch: z
          .string()
          .min(1)
          .describe('Target branch name (validated against Git ref rules; no leading "-", "..", or whitespace)'),
        baseRef: z
          .string()
          .min(1)
          .optional()
          .describe('Optional base commit/branch ref when creating a new branch'),
        dirName: z
          .string()
          .min(1)
          .optional()
          .describe('Optional single-level directory slug inside .agy-worktrees/'),
        carryUncommitted: z
          .boolean()
          .optional()
          .describe('When true, extract git diff HEAD from the current worktree and apply it cleanly to the new worktree'),
        applyInclude: z
          .boolean()
          .optional()
          .describe('When true (default), safely copy validated non-sensitive files listed in .worktreeinclude into the new worktree'),
      },
    },
    async ({ branch, baseRef, dirName, carryUncommitted, applyInclude }) => {
      try {
        const result = await runCreate({ branch, baseRef, dirName, carryUncommitted, applyInclude });
        const lines = [
          `Created worktree for branch "${result.created.branch ?? branch}" at ${result.created.path}.`,
          `Carried uncommitted changes: ${result.carriedUncommitted ? 'yes' : 'no'}.`,
        ];
        if (result.includedFiles.length > 0) {
          lines.push(`Included (.worktreeinclude): ${result.includedFiles.join(', ')}`);
        }
        if (result.skippedSensitive.length > 0) {
          lines.push(
            `Blocked sensitive (.worktreeinclude): ${result.skippedSensitive.join(', ')}`,
          );
        }
        if (result.skippedInvalid.length > 0) {
          lines.push(`Skipped invalid (.worktreeinclude): ${result.skippedInvalid.join(', ')}`);
        }
        if (result.warning) {
          lines.push(`Warning: ${result.warning}`);
        }
        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: { ...result },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );
  modelTools.push(toHandle('worktree_create', createTool));

  // 3. Model-visible: worktree_diff_summary
  const diffSummaryTool = server.registerTool(
    'worktree_diff_summary',
    {
      title: 'Worktree Diff Summary',
      description:
        'Return committed diff statistics, uncommitted changes, changed file list, and ahead/behind counts for an active Git worktree path.',
      inputSchema: {
        worktreePath: z
          .string()
          .min(1)
          .describe('Absolute path to an active worktree from worktree_list'),
        baseRef: z
          .string()
          .min(1)
          .optional()
          .describe('Optional base branch/ref to compare against (defaults to main worktree branch)'),
      },
    },
    async ({ worktreePath, baseRef }) => {
      try {
        const summary = await runDiffSummary(worktreePath, baseRef);
        return {
          content: [{ type: 'text', text: formatDiffSummary(summary) }],
          structuredContent: { ...summary },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );
  modelTools.push(toHandle('worktree_diff_summary', diffSummaryTool));

  // 4. Model-visible: worktree_cleanup
  const cleanupTool = server.registerTool(
    'worktree_cleanup',
    {
      title: 'Cleanup or Prune Git Worktrees',
      description:
        'Safely remove a non-main active Git worktree (refusing dirty worktrees unless force=true) and prune stale metadata, or prune orphaned metadata only.',
      inputSchema: {
        worktreePath: z
          .string()
          .min(1)
          .optional()
          .describe('Absolute path to a non-main active worktree to remove'),
        pruneOnly: z
          .boolean()
          .optional()
          .describe('When true, only run git worktree prune without removing any worktree'),
        force: z
          .boolean()
          .optional()
          .describe('Required to remove a worktree that still has uncommitted changes (never allows removing the main worktree)'),
      },
    },
    async ({ worktreePath, pruneOnly, force }) => {
      try {
        const result = await runCleanup({ worktreePath, pruneOnly, force });
        return {
          content: [{ type: 'text', text: result.message }],
          structuredContent: { ...result },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );
  modelTools.push(toHandle('worktree_cleanup', cleanupTool));

  // App-only tools (4)
  server.registerTool(
    'app_worktree_list',
    {
      title: 'List Git Worktrees (App Only)',
      description: 'Fetch full Git worktree orchestrator state for the Worktree UI tab.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => {
      try {
        const state = await runList();
        return {
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: { ...state },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );

  server.registerTool(
    'app_worktree_create',
    {
      title: 'Create Git Worktree (App Only)',
      description: 'Create a controlled Git worktree from the Worktree UI tab.',
      inputSchema: {
        branch: z.string().min(1),
        baseRef: z.string().min(1).optional(),
        dirName: z.string().min(1).optional(),
        carryUncommitted: z.boolean().optional(),
        applyInclude: z.boolean().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ branch, baseRef, dirName, carryUncommitted, applyInclude }) => {
      try {
        const result = await runCreate({ branch, baseRef, dirName, carryUncommitted, applyInclude });
        return {
          content: [{ type: 'text', text: 'created' }],
          structuredContent: { ...result },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );

  server.registerTool(
    'app_worktree_preview_include',
    {
      title: 'Preview .worktreeinclude Whitelist (App Only)',
      description:
        'Read-only preview of `.worktreeinclude` eligible files, blocked sensitive paths, and invalid entries.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => {
      try {
        const preview = await runPreviewInclude();
        return {
          content: [
            {
              type: 'text',
              text: preview.hasConfig
                ? `eligible=${preview.eligibleFiles.length}, blockedSensitive=${preview.skippedSensitive.length}, invalid=${preview.skippedInvalid.length}`
                : 'no .worktreeinclude configured',
            },
          ],
          structuredContent: { ...preview },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );

  server.registerTool(
    'app_worktree_diff_summary',
    {
      title: 'Worktree Diff Summary (App Only)',
      description: 'Fetch branch and working-tree diff summary for an active worktree from the Worktree UI.',
      inputSchema: {
        worktreePath: z.string().min(1),
        baseRef: z.string().min(1).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ worktreePath, baseRef }) => {
      try {
        const summary = await runDiffSummary(worktreePath, baseRef);
        return {
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: { ...summary },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );

  server.registerTool(
    'app_worktree_cleanup',
    {
      title: 'Cleanup Git Worktree (App Only)',
      description: 'Remove a non-main worktree or prune stale metadata from the Worktree UI.',
      inputSchema: {
        worktreePath: z.string().min(1).optional(),
        pruneOnly: z.boolean().optional(),
        force: z.boolean().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ worktreePath, pruneOnly, force }) => {
      try {
        const result = await runCleanup({ worktreePath, pruneOnly, force });
        return {
          content: [{ type: 'text', text: result.message }],
          structuredContent: { ...result },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(err) }],
        };
      }
    },
  );

  return {
    moduleId: 'worktree',
    modelTools,
    exemptReadOnlyAppTools: ['app_worktree_list', 'app_worktree_preview_include'],
  };
}
