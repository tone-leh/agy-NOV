import crypto from 'node:crypto';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import { redactSecretsLinear } from '../../core/sanitize.js';
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
  let rawText: string | undefined;
  if (typeof err === 'string') {
    rawText = err.trim() || undefined;
  } else if (err instanceof Error) {
    rawText = err.message || err.name;
  } else if (typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === 'string' && rec.message.trim()) {
      rawText = rec.message.trim();
    } else if (typeof rec.code === 'string' && rec.code.trim()) {
      rawText = `Error ${rec.code.trim()}`;
    } else {
      try {
        const json = JSON.stringify(err);
        rawText = json && json !== '{}' ? json : 'Unknown error';
      } catch {
        rawText = 'Unknown error';
      }
    }
  } else {
    rawText = String(err);
  }
  if (!rawText) return undefined;
  const redacted = redactSecretsLinear(rawText, { stripPrivate: true }).trim();
  return redacted || 'Error';
}

const RADAR_HOOK_COALESCE_MS = 2000;

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
      payload.event === 'Stop' ? cleanBriefText(formatErrorValue(payload.error), 160) : undefined;
    const summary =
      cleanBriefText(payload.lastUserInput, 120) ??
      (payload.terminationReason ? cleanBriefText(payload.terminationReason, 120) : undefined);

    const parentConversationId = payload.parentConversationId?.trim() || undefined;
    const agentRole = cleanBriefText(payload.agentRole, 64);
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
      coalesceWindowMs: RADAR_HOOK_COALESCE_MS,
    });

    if (payload.event === 'Stop') {
      const title =
        session.status === 'error'
          ? `agy-NOV Radar: Error (${session.workspaceName})`
          : `agy-NOV Radar: Completed (${session.workspaceName})`;
      const rawMessage =
        session.status === 'error'
          ? session.errorMessage || `Session ${session.conversationId} ended with an error.`
          : `Session ${session.conversationId} finished after ${session.stepCount} step(s).`;
      triggerRadarNotification(
        redactSecretsLinear(title, { stripPrivate: true }),
        redactSecretsLinear(rawMessage, { stripPrivate: true }),
        board.prefs,
      );
    } else if (awaitingApproval) {
      triggerRadarNotification(
        redactSecretsLinear(`agy-NOV Radar: Approval Needed (${session.workspaceName})`, {
          stripPrivate: true,
        }),
        redactSecretsLinear(
          `Tool ${session.lastToolName ?? 'action'} is awaiting your confirmation.`,
          { stripPrivate: true },
        ),
        board.prefs,
      );
    }
  } catch {
    // Strictly fail-open
  }
}
