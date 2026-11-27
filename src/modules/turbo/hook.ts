import fs from 'node:fs';
import path from 'node:path';
import type { NormalizedHookPayload } from '../../core/types.js';
import { buildWorkspaceSnapshot } from './core.js';

/**
 * SessionStart hook for Turbo: read-only, zero disk writes, fail-open.
 * Injects a compact (<= 40 lines) workspace map so the agent starts with layout awareness.
 */
export function handleTurboSessionStartHook(
  payload: NormalizedHookPayload,
  _rootDataDir: string,
): { injectSteps?: unknown[] } {
  try {
    const candidate =
      payload.workspaceRoot ?? payload.workspacePaths[0] ?? payload.cwd;
    if (!candidate || typeof candidate !== 'string' || candidate.includes('\0')) {
      return {};
    }

    const resolved = path.resolve(candidate);
    if (!fs.existsSync(resolved)) {
      return {};
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return {};
    }

    const snapshot = buildWorkspaceSnapshot(resolved);
    if (!snapshot.markdown.trim()) {
      return {};
    }

    return {
      injectSteps: [
        {
          systemMessage: {
            systemMessage: `[agy-NOV Turbo Workspace Map]\n${snapshot.markdown}`,
          },
        },
      ],
    };
  } catch {
    // Strictly fail-open and zero disk writes
    return {};
  }
}
