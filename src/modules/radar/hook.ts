import crypto from 'node:crypto';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import type { NormalizedHookPayload } from '../../core/types.js';
import {
  cleanBriefText,
  recordRadarSessionEvent,
  triggerRadarNotification,
} from './core.js';

const APPROVAL_TOOL_RE =
  /\b(?:run_command|execute|bash|shell|terminal|delete|remove|deploy|publish|push)\b/i;

function deriveConversationId(payload: NormalizedHookPayload): string {
  if (payload.conversationId && payload.conversationId.trim()) {
    return payload.conversationId.trim();
  }
  const seed = payload.workspaceRoot ?? payload.workspacePaths[0] ?? payload.cwd;
  if (seed) {
    const hash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 10);
    return `ws-${hash}`;
  }
  return 'default-session';
}

function detectAwaitingApproval(payload: NormalizedHookPayload): boolean {
  const raw = payload.raw ?? {};
  if (
    raw.requiresApproval === true ||
    raw.awaitingApproval === true ||
    raw.approvalRequired === true ||
    raw.requires_approval === true ||
    raw.awaiting_approval === true
  ) {
    return true;
  }
  const input = payload.toolInput ?? {};
  if (
    input.requiresApproval === true ||
    input.approvalRequired === true ||
    input.requires_approval === true
  ) {
    return true;
  }
  if (
    payload.toolName &&
    APPROVAL_TOOL_RE.test(payload.toolName) &&
    (input.SafeToAutoRun === false || input.safeToAutoRun === false)
  ) {
    return true;
  }
  return false;
}

function formatErrorValue(err: unknown): string | undefined {
  if (err === undefined || err === null || err === false) return undefined;
  if (typeof err === 'string') return err.trim() || undefined;
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === 'string' && rec.message.trim()) return rec.message.trim();
    if (typeof rec.code === 'string' && rec.code.trim()) return `Error ${rec.code.trim()}`;
    try {
      const json = JSON.stringify(err);
      return json && json !== '{}' ? json : 'Unknown error';
    } catch {
      return 'Unknown error';
    }
  }
  return String(err);
}

/**
 * Lifecycle hook for Session Radar (PreToolUse / PostToolUse / Stop).
 * Fail-open: never throws or disrupts agent tool execution.
 */
export function handleRadarHook(
  payload: NormalizedHookPayload,
  rootDataDir: string,
): void {
  try {
    if (
      payload.event !== 'PreToolUse' &&
      payload.event !== 'PostToolUse' &&
      payload.event !== 'Stop'
    ) {
      return;
    }

    const resolvedRoot = resolveNovDataDir(rootDataDir);
    const moduleDataDir = getModuleDataDir(resolvedRoot, 'radar');
    const conversationId = deriveConversationId(payload);
    const workspaceRoot = payload.workspaceRoot ?? payload.workspacePaths[0] ?? payload.cwd;

    const awaitingApproval =
      payload.event === 'PreToolUse' ? detectAwaitingApproval(payload) : false;
    const errorMessage =
      payload.event === 'Stop' ? formatErrorValue(payload.error) : undefined;
    const summary =
      cleanBriefText(payload.lastUserInput, 120) ??
      (payload.terminationReason ? cleanBriefText(payload.terminationReason, 120) : undefined);

    const parentConversationId = payload.parentConversationId?.trim() || undefined;
    const agentRole = payload.agentRole?.trim() || undefined;
    const isSubagent = parentConversationId ? true : undefined;

    const { board, session } = recordRadarSessionEvent(moduleDataDir, {
      conversationId,
      parentConversationId,
      agentRole,
      isSubagent,
      event: payload.event,
      workspaceRoot,
      toolName: payload.toolName,
      awaitingApproval,
      errorMessage,
      summary,
    });

    if (payload.event === 'Stop') {
      const title =
        session.status === 'error'
          ? `agy-NOV Radar: Error (${session.workspaceName})`
          : `agy-NOV Radar: Completed (${session.workspaceName})`;
      const message =
        session.status === 'error'
          ? session.errorMessage || `Session ${session.conversationId} ended with an error.`
          : `Session ${session.conversationId} finished after ${session.stepCount} step(s).`;
      triggerRadarNotification(title, message, board.prefs);
    } else if (awaitingApproval) {
      triggerRadarNotification(
        `agy-NOV Radar: Approval Needed (${session.workspaceName})`,
        `Tool ${session.lastToolName ?? 'action'} is awaiting your confirmation.`,
        board.prefs,
      );
    }
  } catch {
    // Strictly fail-open
  }
}
