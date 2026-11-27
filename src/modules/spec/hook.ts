import fs from 'node:fs';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import type { NormalizedHookPayload } from '../../core/types.js';
import {
  buildSpecStateView,
  getSpecStatePath,
  isSpecWriteLockActive,
  loadSpecStateReadOnly,
} from './core.js';

export const SPEC_WRITE_LOCK_TOOLS: ReadonlySet<string> = new Set([
  'write',
  'edit',
  'multi_edit',
  'multiedit',
  'notebook_edit',
  'notebookedit',
  'write_file',
  'edit_file',
  'write_to_file',
  'create_file',
  'patch_file',
  'apply_patch',
  'replace_file_content',
  'multi_replace_file_content',
  'delete_file',
]);

function normalizeToolName(rawName: string | undefined): string {
  if (!rawName) return '';
  const trimmed = rawName.trim().toLowerCase();
  const sepIdx = Math.max(trimmed.lastIndexOf(':'), trimmed.lastIndexOf('/'));
  return sepIdx >= 0 ? trimmed.slice(sepIdx + 1) : trimmed;
}

function isAlwaysAllowedSpecOrNovTool(normalizedToolName: string): boolean {
  return (
    normalizedToolName.startsWith('spec_') ||
    normalizedToolName.startsWith('nov_') ||
    normalizedToolName.startsWith('app_spec_')
  );
}

/**
 * Pure read-only PreToolUse hook for Spec Flow & Task DAG.
 * Never creates directories or writes to disk; fails open on unexpected I/O errors.
 * Blocks workspace write/edit tools when the active spec is in DRAFT with write lock enabled.
 */
export function handleSpecPreToolHook(
  payload: NormalizedHookPayload,
  rootDataDir: string,
): { decision?: 'deny'; reason?: string } {
  try {
    if (payload.event !== 'PreToolUse') {
      return {};
    }

    const toolName = normalizeToolName(payload.toolName);
    if (!toolName || isAlwaysAllowedSpecOrNovTool(toolName)) {
      return {};
    }
    if (!SPEC_WRITE_LOCK_TOOLS.has(toolName)) {
      return {};
    }

    const resolvedRoot = resolveNovDataDir(rootDataDir);
    const moduleDataDir = getModuleDataDir(resolvedRoot, 'spec');
    if (!fs.existsSync(getSpecStatePath(moduleDataDir))) {
      return {};
    }

    const state = loadSpecStateReadOnly(moduleDataDir);
    const activeSpec = state.activeSpecId
      ? state.specs.find((s) => s.id === state.activeSpecId) ?? null
      : null;

    if (activeSpec && isSpecWriteLockActive(activeSpec)) {
      const safeTitle = activeSpec.title.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
      return {
        decision: 'deny',
        reason: `[agy-NOV Spec Flow] Active spec "${safeTitle}" is in DRAFT with write lock enabled. Approve the spec in agy-NOV Spec Flow before editing workspace files.`,
      };
    }

    return {};
  } catch {
    // Strictly fail-open and zero disk writes
    return {};
  }
}

/**
 * Pure read-only SessionStart hook for Spec Flow & Task DAG.
 * Never creates directories or writes to disk; fails open on unexpected I/O errors.
 * Injects active spec summary (draft or approved), write-lock status, progress stats,
 * and up to the first 5 ready executable tasks.
 */
export function handleSpecSessionStartHook(
  payload: NormalizedHookPayload,
  rootDataDir: string,
): { injectSteps?: unknown[] } {
  try {
    if (payload.event !== 'SessionStart') {
      return {};
    }

    const resolvedRoot = resolveNovDataDir(rootDataDir);
    const moduleDataDir = getModuleDataDir(resolvedRoot, 'spec');
    if (!fs.existsSync(getSpecStatePath(moduleDataDir))) {
      return {};
    }

    const state = loadSpecStateReadOnly(moduleDataDir);
    const view = buildSpecStateView(state, 'live');
    const spec = view.activeSpec;

    if (!spec || (spec.status !== 'draft' && spec.status !== 'approved')) {
      return {};
    }

    const readyTasks = spec.tasks.filter((t) => t.computedState === 'ready');
    const inProgressCount = spec.tasks.filter((t) => t.computedState === 'in_progress').length;
    const doneCount = spec.tasks.filter((t) => t.computedState === 'done').length;
    const waitingCount = spec.tasks.filter((t) => t.computedState === 'waiting_deps').length;
    const blockedCount = spec.tasks.filter((t) => t.computedState === 'blocked').length;

    const writeLockLabel = view.writeLockActive
      ? 'ENABLED (workspace writes blocked until approved)'
      : spec.enforcePlanBeforeWrite
        ? 'UNLOCKED (spec approved)'
        : 'OFF';

    const lines: string[] = [
      `[agy-NOV Spec Flow] Active Spec: "${spec.title}" (${spec.id})`,
      `Status: ${spec.status.toUpperCase()} | Write Lock: ${writeLockLabel}${spec.requireUiApproval ? ' | UI Approval Required' : ''}`,
      `Progress: ${doneCount}/${spec.tasks.length} done, ${inProgressCount} in_progress, ${readyTasks.length} ready, ${waitingCount} waiting_deps, ${blockedCount} blocked`,
    ];

    const topReady = readyTasks.slice(0, 5);
    if (topReady.length > 0) {
      lines.push(`Next Ready Tasks (${topReady.length}/${readyTasks.length}):`);
      for (const task of topReady) {
        lines.push(`- [${task.id}] (depth ${task.depth}) ${task.title}`);
      }
    } else {
      lines.push('Next Ready Tasks: none (remaining tasks are in progress, waiting on dependencies, blocked, or done).');
    }

    if (view.writeLockActive) {
      lines.push(
        spec.requireUiApproval
          ? 'Action required: Ask the user to review and approve this draft spec in the agy-NOV Spec Flow UI before editing workspace files.'
          : 'Action required: Approve this draft spec before editing workspace files.',
      );
    }

    return {
      injectSteps: [
        {
          systemMessage: {
            systemMessage: lines.join('\n'),
          },
        },
      ],
    };
  } catch {
    // Strictly fail-open and zero disk writes
    return {};
  }
}
