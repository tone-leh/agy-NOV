import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getModuleDataDir } from '../../core/config.js';
import type { NormalizedHookPayload } from '../../core/types.js';
import { atomicRenameSync, ensurePrivateDir } from '../../core/utils.js';
import type { ReviewSignal } from './types.js';

const MUTATING_TOOL_RE =
  /(write|edit|replace|patch|create|delete|remove|rename|move|run_command|command|bash|shell|terminal|multi_replace)/i;

export function readReviewSignal(moduleDataDir?: string): ReviewSignal | null {
  if (!moduleDataDir) return null;
  const signalPath = path.join(moduleDataDir, 'review-signal.json');
  if (!fs.existsSync(signalPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(signalPath, 'utf8')) as Partial<ReviewSignal>;
    return {
      lastEvent: parsed.lastEvent,
      lastToolName: parsed.lastToolName,
      lastWriteAt: parsed.lastWriteAt,
      updatedAt: parsed.updatedAt,
      changeCount: typeof parsed.changeCount === 'number' ? parsed.changeCount : 0,
      workspacePaths: Array.isArray(parsed.workspacePaths) ? parsed.workspacePaths : undefined,
      conversationId: parsed.conversationId,
    };
  } catch {
    return null;
  }
}

/**
 * Pure fail-open hook handler: records lightweight edit signals to
 * `<rootDataDir>/modules/review/review-signal.json` via atomic write-and-rename.
 */
export function handleReviewHook(payload: NormalizedHookPayload, rootDataDir: string): void {
  const moduleDataDir = getModuleDataDir(rootDataDir, 'review');
  const event = payload.event;
  const toolName = payload.toolName;
  const now = new Date().toISOString();

  try {
    ensurePrivateDir(moduleDataDir);
    const signalPath = path.join(moduleDataDir, 'review-signal.json');
    const prev = readReviewSignal(moduleDataDir) ?? { changeCount: 0 };

    const isMutating = event === 'Stop' || (toolName ? MUTATING_TOOL_RE.test(toolName) : false);
    const next: ReviewSignal = {
      ...prev,
      lastEvent: event,
      lastToolName: toolName ?? prev.lastToolName,
      lastWriteAt: isMutating ? now : prev.lastWriteAt,
      updatedAt: now,
      changeCount: isMutating ? prev.changeCount + 1 : prev.changeCount,
      workspacePaths:
        payload.workspacePaths.length > 0
          ? payload.workspacePaths
          : prev.workspacePaths,
      conversationId: payload.conversationId ?? prev.conversationId,
    };

    const tmpPath = `${signalPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    atomicRenameSync(tmpPath, signalPath);
  } catch {
    // Fail-open on filesystem permissions or transient I/O errors
  }
}
