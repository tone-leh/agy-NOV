import fs from 'node:fs';
import path from 'node:path';
import { getModuleDataDir } from '../../core/config.js';
import type { NormalizedHookPayload } from '../../core/types.js';
import {
  buildAutoRtkOverwriteCommand,
  loadTurboPrefsReadOnly,
  parseSafeAutoRtkCommand,
  recordTurboHotspot,
  resolveDefaultCliEntryPath,
} from './auto-rtk.js';
import { buildWorkspaceSnapshot } from './core.js';

const RUN_COMMAND_TOOL_RE = /^run_command$/i;

function extractRunCommandInput(
  payload: NormalizedHookPayload,
): { cmdKey: 'CommandLine' | 'command'; commandLine: string } | null {
  if (!payload.toolName || !RUN_COMMAND_TOOL_RE.test(payload.toolName.trim())) {
    return null;
  }
  const toolInput = payload.toolInput;
  if (!toolInput || typeof toolInput !== 'object') {
    return null;
  }
  if (typeof toolInput.CommandLine === 'string' && toolInput.CommandLine.trim()) {
    return { cmdKey: 'CommandLine', commandLine: toolInput.CommandLine };
  }
  if (typeof toolInput.command === 'string' && toolInput.command.trim()) {
    return { cmdKey: 'command', commandLine: toolInput.command };
  }
  return null;
}

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

/**
 * PreToolUse hook for Turbo Auto-RTK transparent output compression proxy.
 * - O(1) read-only short-circuit when autoRtk !== true (default OFF, zero disk writes).
 * - Matches only `run_command` (supporting `CommandLine` / `command` parameter keys).
 * - Rewrites strictly whitelisted single commands via base64url-encoded compact-run proxy.
 * - Strictly fail-open: any non-whitelisted or unsafe command passes through untouched (`{}`).
 */
export function handleTurboPreToolHook(
  payload: NormalizedHookPayload,
  rootDataDir: string,
  cliEntryPath?: string,
): { decision?: 'allow'; overwrite?: Record<string, unknown> } {
  try {
    if (payload.event !== 'PreToolUse') {
      return {};
    }

    const moduleDataDir = getModuleDataDir(rootDataDir, 'turbo');
    const prefs = loadTurboPrefsReadOnly(moduleDataDir);
    if (prefs.autoRtk !== true) {
      return {};
    }

    const extracted = extractRunCommandInput(payload);
    if (!extracted) {
      return {};
    }

    const parsed = parseSafeAutoRtkCommand(extracted.commandLine);
    if (!parsed.ok) {
      return {};
    }

    const resolvedCliEntry =
      typeof cliEntryPath === 'string' && cliEntryPath.trim()
        ? cliEntryPath
        : resolveDefaultCliEntryPath();
    const rewrittenCmd = buildAutoRtkOverwriteCommand(resolvedCliEntry, parsed, rootDataDir);
    if (!rewrittenCmd) {
      return {};
    }

    return {
      decision: 'allow',
      overwrite: {
        [extracted.cmdKey]: rewrittenCmd,
      },
    };
  } catch {
    // Strictly fail-open
    return {};
  }
}

/**
 * PostToolUse hook for Turbo: observes high-noise whitelisted `run_command` executions
 * to record hotspots for the Turbo UI (fail-open, zero writes when rootDataDir is absent).
 */
export function handleTurboPostToolHook(
  payload: NormalizedHookPayload,
  rootDataDir: string,
): void {
  try {
    if (payload.event !== 'PostToolUse') {
      return;
    }
    const extracted = extractRunCommandInput(payload);
    if (!extracted) {
      return;
    }
    const moduleDataDir = getModuleDataDir(rootDataDir, 'turbo');
    recordTurboHotspot(moduleDataDir, extracted.commandLine, rootDataDir);
  } catch {
    // Strictly fail-open
  }
}
