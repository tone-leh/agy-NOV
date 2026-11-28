import crypto from 'node:crypto';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import { withFileLockSync } from '../../core/fs-safe.js';
import type { NormalizedHookPayload } from '../../core/types.js';
import {
  appendEvidenceToState,
  createEvidenceId,
  formatFailureTailSnippet,
  getVerifyStatePath,
  inspectWorkspaceFile,
  loadVerifyStateReadOnly,
  redactVerifyOutput,
  runVerifyCommands,
  saveVerifyState,
  scanEmptyWorkspaceFiles,
  STOP_HOOK_SINGLE_TIMEOUT_MS,
  STOP_HOOK_TOTAL_BUDGET_MS,
  type VerifyEvidenceRecord,
  type VerifySessionRecord,
} from './core.js';

export const TRACKED_VERIFY_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'write_file',
  'edit_file',
  'write_to_file',
  'create_file',
  'apply_patch',
  'patch_file',
  'replace_file_content',
  'multi_replace_file_content',
]);

export const GUARDRAIL_ALLOW_REASON = 'Reached maxConsecutiveBlocks guardrail; allowing stop.';

const SINGLE_PATH_KEYS = [
  'Path',
  'path',
  'TargetFile',
  'targetFile',
  'target_file',
  'TargetPath',
  'targetPath',
  'target_path',
  'AbsolutePath',
  'absolutePath',
  'absolute_path',
  'filePath',
  'file_path',
  'FilePath',
] as const;

const PATCH_TEXT_KEYS = ['patch', 'Patch', 'diff', 'Diff', 'input', 'Input'] as const;

function normalizeToolName(rawName: string | undefined): string {
  if (!rawName) return '';
  const trimmed = rawName.trim().toLowerCase();
  const sepIdx = Math.max(trimmed.lastIndexOf(':'), trimmed.lastIndexOf('/'));
  return sepIdx >= 0 ? trimmed.slice(sepIdx + 1) : trimmed;
}

export function deriveVerifyConversationId(payload: NormalizedHookPayload): string {
  if (payload.conversationId && payload.conversationId.trim()) {
    return payload.conversationId.trim().slice(0, 120);
  }
  const seed = payload.workspaceRoot ?? payload.workspacePaths[0] ?? payload.cwd;
  if (seed) {
    const hash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 10);
    return `ws-${hash}`;
  }
  return 'default-session';
}

function extractPatchPaths(patchText: string): string[] {
  const paths: string[] = [];
  const lines = patchText.split(/\r?\n/);
  for (const line of lines) {
    const applyMatch = /^\*\*\*\s+(?:Add File|Update File|Move to):\s*(.+)$/.exec(line);
    if (applyMatch?.[1]) {
      const candidate = applyMatch[1].trim();
      if (candidate) paths.push(candidate);
      continue;
    }
    const diffMatch = /^\+\+\+\s+(?:b\/)?([^\t\r\n]+)/.exec(line);
    if (diffMatch?.[1]) {
      const candidate = diffMatch[1].trim();
      if (candidate && candidate !== '/dev/null') {
        paths.push(candidate);
      }
    }
  }
  return paths;
}

export function extractVerifyTargetPaths(toolInput: Record<string, unknown> | undefined): string[] {
  if (!toolInput) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (val: unknown) => {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        found.push(trimmed);
      }
    }
  };

  for (const key of SINGLE_PATH_KEYS) {
    add(toolInput[key]);
  }

  for (const listKey of ['files', 'paths', 'Files', 'Paths'] as const) {
    const arr = toolInput[listKey];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        add(item);
      }
    }
  }

  if (found.length === 0) {
    for (const patchKey of PATCH_TEXT_KEYS) {
      const val = toolInput[patchKey];
      if (typeof val === 'string' && val.trim()) {
        for (const p of extractPatchPaths(val)) {
          add(p);
        }
      }
    }
  }

  return found;
}

/**
 * PostToolUse hook for Verify Gate.
 * Tracks workspace file edits and 0-byte empty writes per conversation.
 * Strictly ignores non-write tools and paths outside workspaceRoot (zero disk writes).
 */
export function handleVerifyPostToolHook(
  payload: NormalizedHookPayload,
  rootDataDir: string,
): void {
  try {
    if (payload.event !== 'PostToolUse') {
      return;
    }
    const toolName = normalizeToolName(payload.toolName);
    if (!TRACKED_VERIFY_WRITE_TOOLS.has(toolName)) {
      return;
    }

    const workspaceRoot = payload.workspaceRoot ?? payload.workspacePaths[0] ?? payload.cwd;
    if (!workspaceRoot) {
      return;
    }

    const rawPaths = extractVerifyTargetPaths(payload.toolInput);
    if (rawPaths.length === 0) {
      return;
    }

    const validChecks = rawPaths
      .map((p) => inspectWorkspaceFile(workspaceRoot, p))
      .filter((check) => check.inside && Boolean(check.relPath));

    if (validChecks.length === 0) {
      return;
    }

    const resolvedRoot = resolveNovDataDir(rootDataDir);
    const moduleDataDir = getModuleDataDir(resolvedRoot, 'verify');
    const conversationId = deriveVerifyConversationId(payload);

    withFileLockSync(getVerifyStatePath(moduleDataDir), () => {
      const state = loadVerifyStateReadOnly(moduleDataDir);
      const nowIso = new Date().toISOString();

      const existing = state.sessions[conversationId];
      const prevDirty = existing?.dirtyFiles ?? [];
      const prevEmpty = existing?.emptyFiles ?? [];
      const dirtySet = new Set<string>(prevDirty);
      const emptySet = new Set<string>(prevEmpty);
      let resolvedWorkspaceRoot = existing?.workspaceRoot;

      for (const check of validChecks) {
        if (!check.relPath) continue;
        if (check.realRoot) resolvedWorkspaceRoot = check.realRoot;
        dirtySet.add(check.relPath);
        if (check.exists && check.isFile && check.isEmpty) {
          emptySet.add(check.relPath);
        } else {
          // File now has non-empty content (or was removed) -> clear empty flag
          emptySet.delete(check.relPath);
        }
      }

      const lastVerifiedMs = existing?.lastVerifiedAt ? Date.parse(existing.lastVerifiedAt) : Number.NaN;
      const nowMs = Date.parse(nowIso);
      const existingEditMs = existing?.lastEditAt ? Date.parse(existing.lastEditAt) : Number.NaN;
      const existingUpdatedMs = existing?.updatedAt ? Date.parse(existing.updatedAt) : Number.NaN;

      // Coalesce repeated edits to already-dirty files within 2s when dirty/empty sets are unchanged
      const sameDirty =
        dirtySet.size === prevDirty.length && prevDirty.every((f) => dirtySet.has(f));
      const sameEmpty =
        emptySet.size === prevEmpty.length && prevEmpty.every((f) => emptySet.has(f));
      const alreadyStaleAfterVerify =
        !Number.isFinite(lastVerifiedMs) ||
        (Number.isFinite(existingEditMs) && existingEditMs > lastVerifiedMs);
      if (
        existing &&
        sameDirty &&
        sameEmpty &&
        existing.lastVerifiedPassed === false &&
        alreadyStaleAfterVerify &&
        Number.isFinite(existingUpdatedMs) &&
        nowMs - existingUpdatedMs >= 0 &&
        nowMs - existingUpdatedMs < 2000
      ) {
        return;
      }

      const editIso =
        Number.isFinite(lastVerifiedMs) && nowMs <= lastVerifiedMs
          ? new Date(lastVerifiedMs + 1).toISOString()
          : nowIso;

      const nextSession: VerifySessionRecord = {
        conversationId,
        workspaceRoot: resolvedWorkspaceRoot ?? workspaceRoot,
        dirtyFiles: [...dirtySet],
        emptyFiles: [...emptySet],
        lastEditAt: editIso,
        lastVerifiedAt: existing?.lastVerifiedAt,
        lastVerifiedPassed: false,
        consecutiveBlocks: existing?.consecutiveBlocks ?? 0,
        totalBlocks: existing?.totalBlocks ?? 0,
        lastGuardrailReleaseAt: existing?.lastGuardrailReleaseAt,
        updatedAt: editIso,
      };

      state.sessions[conversationId] = nextSession;
      saveVerifyState(moduleDataDir, state);
    });
  } catch {
    // Strictly fail-open
  }
}

const TERMINATION_REASON_PREFIX = 'EXECUTOR_TERMINATION_REASON_';

function extractNormalizedTerminationReason(payload: NormalizedHookPayload): string | undefined {
  const rawCandidate =
    (typeof payload.terminationReason === 'string' && payload.terminationReason) ||
    (typeof payload.raw?.terminationReason === 'string' && payload.raw.terminationReason) ||
    (typeof payload.raw?.termination_reason === 'string' && payload.raw.termination_reason) ||
    undefined;
  if (!rawCandidate) return undefined;
  const trimmed = rawCandidate.trim();
  if (!trimmed) return undefined;
  const upper = trimmed.toUpperCase();
  return upper.startsWith(TERMINATION_REASON_PREFIX)
    ? upper.slice(TERMINATION_REASON_PREFIX.length)
    : upper;
}

function isContinuationActive(payload: NormalizedHookPayload): boolean {
  return (
    payload.continuationActive === true ||
    payload.raw?.continuationActive === true ||
    payload.raw?.continuation_active === true
  );
}

/**
 * Stop hook for Verify Gate.
 * Blocks unverified or failing stops when workspace files were modified using Antigravity's
 * official Stop hook `continue` protocol, allows non-NO_TOOL_CALL terminations immediately,
 * and enforces strict loop guardrails (maxConsecutiveBlocks & continuationActive) with redacted evidence logs.
 */
export async function handleVerifyStopHook(
  payload: NormalizedHookPayload,
  rootDataDir: string,
): Promise<{ decision: 'allow' | 'continue'; reason?: string }> {
  try {
    if (payload.event !== 'Stop') {
      return { decision: 'allow' };
    }

    // Never block user cancellation, runtime errors, invocation/token caps, or other non-NO_TOOL_CALL exits
    const terminationReason = extractNormalizedTerminationReason(payload);
    if (terminationReason !== undefined && terminationReason !== 'NO_TOOL_CALL') {
      return { decision: 'allow' };
    }

    const resolvedRoot = resolveNovDataDir(rootDataDir);
    const moduleDataDir = getModuleDataDir(resolvedRoot, 'verify');
    const statePath = getVerifyStatePath(moduleDataDir);
    const state = loadVerifyStateReadOnly(moduleDataDir);

    if (!state.policy.enforceOnStop) {
      return { decision: 'allow' };
    }

    const conversationId = deriveVerifyConversationId(payload);
    const session = state.sessions[conversationId];
    if (!session || (session.dirtyFiles.length === 0 && session.emptyFiles.length === 0)) {
      return { decision: 'allow' };
    }

    const nowIso = new Date().toISOString();
    const workspaceRoot =
      payload.workspaceRoot ?? payload.workspacePaths[0] ?? payload.cwd ?? session.workspaceRoot;

    // 1. Loop guardrail: allow safely once consecutiveBlocks hits maxConsecutiveBlocks
    if (session.consecutiveBlocks >= state.policy.maxConsecutiveBlocks) {
      const snapshotEmpty = scanEmptyWorkspaceFiles(workspaceRoot, [
        ...session.dirtyFiles,
        ...session.emptyFiles,
      ]);
      const continuationNote = isContinuationActive(payload) ? ' (continuationActive=true)' : '';

      withFileLockSync(statePath, () => {
        const latestState = loadVerifyStateReadOnly(moduleDataDir);
        const latestSession = latestState.sessions[conversationId] ?? {
          ...session,
          dirtyFiles: [...session.dirtyFiles],
          emptyFiles: [...session.emptyFiles],
        };
        latestState.sessions[conversationId] = latestSession;
        const snapshotDirty = [...new Set([...session.dirtyFiles, ...latestSession.dirtyFiles])];

        const record: VerifyEvidenceRecord = {
          id: createEvidenceId('ver'),
          conversationId,
          trigger: 'stop-hook',
          outcome: 'guardrail-allow',
          passed: false,
          timestamp: nowIso,
          durationMs: 0,
          dirtyFiles: snapshotDirty,
          emptyFiles: snapshotEmpty,
          results: [],
          summary: `${GUARDRAIL_ALLOW_REASON}${continuationNote} consecutiveBlocks=${latestSession.consecutiveBlocks}/${latestState.policy.maxConsecutiveBlocks}.`,
          reason: GUARDRAIL_ALLOW_REASON,
        };

        latestSession.dirtyFiles = [];
        latestSession.emptyFiles = [];
        latestSession.consecutiveBlocks = 0;
        latestSession.lastVerifiedPassed = false;
        latestSession.lastGuardrailReleaseAt = nowIso;
        latestSession.updatedAt = nowIso;

        appendEvidenceToState(latestState, record);
        saveVerifyState(moduleDataDir, latestState);
      });
      return {
        decision: 'allow',
        reason: GUARDRAIL_ALLOW_REASON,
      };
    }

    // 2. Re-scan dirty files for 0-byte empty writes
    const currentEmptyFiles = scanEmptyWorkspaceFiles(workspaceRoot, [
      ...session.dirtyFiles,
      ...session.emptyFiles,
    ]);
    session.emptyFiles = currentEmptyFiles;

    if (state.policy.blockEmptyWrites && currentEmptyFiles.length > 0) {
      const fileList = currentEmptyFiles.slice(0, 5).join(', ');
      const extra = currentEmptyFiles.length > 5 ? ` (+${currentEmptyFiles.length - 5} more)` : '';
      const reason = `[agy-NOV Verify Gate] Blocked stop: detected ${currentEmptyFiles.length} empty (0-byte) modified file(s): ${fileList}${extra}. Write valid content or remove empty files before finishing.`;

      withFileLockSync(statePath, () => {
        const latestState = loadVerifyStateReadOnly(moduleDataDir);
        const latestSession = latestState.sessions[conversationId] ?? {
          ...session,
          dirtyFiles: [...session.dirtyFiles],
          emptyFiles: [...currentEmptyFiles],
        };
        latestState.sessions[conversationId] = latestSession;
        const mergedDirty = [...new Set([...session.dirtyFiles, ...latestSession.dirtyFiles])];
        latestSession.dirtyFiles = mergedDirty;
        latestSession.emptyFiles = [...currentEmptyFiles];
        latestSession.consecutiveBlocks += 1;
        latestSession.totalBlocks += 1;
        latestSession.lastVerifiedPassed = false;
        latestSession.updatedAt = nowIso;
        latestState.blockedStops += 1;

        const record: VerifyEvidenceRecord = {
          id: createEvidenceId('ver'),
          conversationId,
          trigger: 'stop-hook',
          outcome: 'blocked',
          passed: false,
          timestamp: nowIso,
          durationMs: 0,
          dirtyFiles: mergedDirty,
          emptyFiles: [...currentEmptyFiles],
          results: [],
          summary: `Blocked stop due to ${currentEmptyFiles.length} empty modified file(s).`,
          reason,
        };

        appendEvidenceToState(latestState, record);
        saveVerifyState(moduleDataDir, latestState);
      });
      return { decision: 'continue', reason };
    }

    // 3. Auto-run enabled checks on Stop within bounded Stop-hook budget (<=8s each, <=14s total)
    const enabledCommands = state.policy.commands.filter((c) => c.enabled);
    const preRunDirtyFiles = [...session.dirtyFiles];
    const preRunLastEditAt = session.lastEditAt;
    const preRunWorkspaceRoot = session.workspaceRoot;
    const preRunConsecutiveBlocks = session.consecutiveBlocks;
    const preRunTotalBlocks = session.totalBlocks;
    const preRunLastGuardrailReleaseAt = session.lastGuardrailReleaseAt;

    if (state.policy.autoRunOnStop && enabledCommands.length > 0) {
      if (!workspaceRoot) {
        return { decision: 'allow' };
      }

      const runOut = await runVerifyCommands(enabledCommands, workspaceRoot, {
        singleTimeoutCapMs: STOP_HOOK_SINGLE_TIMEOUT_MS,
        totalBudgetMs: STOP_HOOK_TOTAL_BUDGET_MS,
      });
      const commandResults = runOut.results;
      const runDurationMs = runOut.durationMs;
      const effectiveNowIso = new Date().toISOString();

      // Reload latest state under file lock before writing so concurrent session/policy/evidence updates are merged
      return withFileLockSync<{ decision: 'allow' | 'continue'; reason?: string }>(statePath, () => {
        const targetState = loadVerifyStateReadOnly(moduleDataDir);
        const targetSession = targetState.sessions[conversationId] ?? {
          conversationId,
          workspaceRoot: preRunWorkspaceRoot ?? workspaceRoot,
          dirtyFiles: [...preRunDirtyFiles],
          emptyFiles: [...currentEmptyFiles],
          lastEditAt: preRunLastEditAt,
          consecutiveBlocks: preRunConsecutiveBlocks,
          totalBlocks: preRunTotalBlocks,
          lastGuardrailReleaseAt: preRunLastGuardrailReleaseAt,
          updatedAt: effectiveNowIso,
        };
        targetState.sessions[conversationId] = targetSession;
        const concurrentEditOccurred = targetSession.lastEditAt !== preRunLastEditAt;

        if (!runOut.passed) {
          const failed = runOut.results.filter((r) => !r.passed);
          const mergedDirtyFiles = [...new Set([...preRunDirtyFiles, ...targetSession.dirtyFiles])];
          const mergedEmptyFiles = scanEmptyWorkspaceFiles(workspaceRoot, [
            ...mergedDirtyFiles,
            ...targetSession.emptyFiles,
            ...currentEmptyFiles,
          ]);

          targetSession.dirtyFiles = mergedDirtyFiles;
          targetSession.emptyFiles = mergedEmptyFiles;
          targetSession.consecutiveBlocks += 1;
          targetSession.totalBlocks += 1;
          targetSession.lastVerifiedAt = effectiveNowIso;
          targetSession.lastVerifiedPassed = false;
          targetSession.updatedAt = effectiveNowIso;
          targetState.blockedStops += 1;

          const failureDetails = failed
            .slice(0, 3)
            .map((item) => {
              const statusText = item.timedOut
                ? 'timed out'
                : `exit=${item.exitCode !== null ? item.exitCode : 'error'}`;
              const tail = formatFailureTailSnippet(
                item.outputTail.trim() || item.error || '',
                3,
                220,
              );
              return tail
                ? `${item.label} [${item.commandId}] (${statusText}): ${tail}`
                : `${item.label} [${item.commandId}] (${statusText})`;
            })
            .join('; ');

          const reason = redactVerifyOutput(
            `[agy-NOV Verify Gate] Blocked stop: ${failed.length}/${runOut.results.length} check(s) failed — ${failureDetails}. Fix the failing check(s) before finishing.`,
          );

          const record: VerifyEvidenceRecord = {
            id: createEvidenceId('ver'),
            conversationId,
            trigger: 'stop-hook',
            outcome: 'blocked',
            passed: false,
            timestamp: effectiveNowIso,
            durationMs: runDurationMs,
            dirtyFiles: [...mergedDirtyFiles],
            emptyFiles: [...mergedEmptyFiles],
            results: commandResults,
            summary: `Blocked stop: ${failed.length}/${runOut.results.length} verification check(s) failed.`,
            reason,
          };

          appendEvidenceToState(targetState, record);
          saveVerifyState(moduleDataDir, targetState);
          return { decision: 'continue', reason };
        }

        const verifiedDirtyFiles = [...preRunDirtyFiles];
        if (concurrentEditOccurred) {
          // Preserve concurrent edits that landed while checks were running
          targetSession.consecutiveBlocks = 0;
          targetSession.lastVerifiedPassed = false;
        } else {
          targetSession.dirtyFiles = [];
          targetSession.emptyFiles = [];
          targetSession.consecutiveBlocks = 0;
          targetSession.lastVerifiedAt = effectiveNowIso;
          targetSession.lastVerifiedPassed = true;
          targetSession.updatedAt = effectiveNowIso;
        }

        const passRecord: VerifyEvidenceRecord = {
          id: createEvidenceId('ver'),
          conversationId,
          trigger: 'stop-hook',
          outcome: 'pass',
          passed: true,
          timestamp: effectiveNowIso,
          durationMs: runDurationMs,
          dirtyFiles: verifiedDirtyFiles,
          emptyFiles: [],
          results: commandResults,
          summary: `All ${commandResults.length} verification check(s) passed on Stop in ${runDurationMs}ms.`,
        };

        appendEvidenceToState(targetState, passRecord);
        saveVerifyState(moduleDataDir, targetState);
        return { decision: 'allow' };
      });
    }

    // 4 & 5. Manual verification enforcement or no-command pass path -> merge and persist under file lock
    return withFileLockSync<{ decision: 'allow' | 'continue'; reason?: string }>(statePath, () => {
      const targetState = loadVerifyStateReadOnly(moduleDataDir);
      const targetSession = targetState.sessions[conversationId] ?? {
        ...session,
        dirtyFiles: [...preRunDirtyFiles],
        emptyFiles: [...currentEmptyFiles],
      };
      targetState.sessions[conversationId] = targetSession;
      const mergedDirtyFiles = [...new Set([...preRunDirtyFiles, ...targetSession.dirtyFiles])];
      targetSession.dirtyFiles = mergedDirtyFiles;

      if (!targetState.policy.autoRunOnStop && targetSession.dirtyFiles.length > 0) {
        const lastEditMs = targetSession.lastEditAt
          ? Date.parse(targetSession.lastEditAt)
          : Number.POSITIVE_INFINITY;
        const lastVerifiedMs = targetSession.lastVerifiedAt
          ? Date.parse(targetSession.lastVerifiedAt)
          : Number.NEGATIVE_INFINITY;
        const unverified =
          !targetSession.lastVerifiedAt ||
          !Number.isFinite(lastVerifiedMs) ||
          (Number.isFinite(lastEditMs) && lastVerifiedMs < lastEditMs) ||
          targetSession.lastVerifiedPassed === false;

        if (unverified) {
          targetSession.consecutiveBlocks += 1;
          targetSession.totalBlocks += 1;
          targetSession.updatedAt = nowIso;
          targetState.blockedStops += 1;

          const fileList = targetSession.dirtyFiles.slice(0, 5).join(', ');
          const extra =
            targetSession.dirtyFiles.length > 5
              ? ` (+${targetSession.dirtyFiles.length - 5} more)`
              : '';
          const reason = `[agy-NOV Verify Gate] Blocked stop: ${targetSession.dirtyFiles.length} modified file(s) (${fileList}${extra}) have not been verified since the last edit. Run verify_run_checks and ensure checks pass before finishing.`;

          const record: VerifyEvidenceRecord = {
            id: createEvidenceId('ver'),
            conversationId,
            trigger: 'stop-hook',
            outcome: 'blocked',
            passed: false,
            timestamp: nowIso,
            durationMs: 0,
            dirtyFiles: [...targetSession.dirtyFiles],
            emptyFiles: [...currentEmptyFiles],
            results: [],
            summary: `Blocked stop: ${targetSession.dirtyFiles.length} modified file(s) unverified (autoRunOnStop=false).`,
            reason,
          };

          appendEvidenceToState(targetState, record);
          saveVerifyState(moduleDataDir, targetState);
          return { decision: 'continue', reason };
        }
      }

      const concurrentEditOccurred = targetSession.lastEditAt !== preRunLastEditAt;
      const verifiedDirtyFiles = [...preRunDirtyFiles];
      if (concurrentEditOccurred) {
        targetSession.consecutiveBlocks = 0;
        targetSession.lastVerifiedPassed = false;
      } else {
        targetSession.dirtyFiles = [];
        targetSession.emptyFiles = [];
        targetSession.consecutiveBlocks = 0;
        targetSession.lastVerifiedAt = nowIso;
        targetSession.lastVerifiedPassed = true;
        targetSession.updatedAt = nowIso;
      }

      const passRecord: VerifyEvidenceRecord = {
        id: createEvidenceId('ver'),
        conversationId,
        trigger: 'stop-hook',
        outcome: 'pass',
        passed: true,
        timestamp: nowIso,
        durationMs: 0,
        dirtyFiles: verifiedDirtyFiles,
        emptyFiles: [],
        results: [],
        summary: `Verified ${verifiedDirtyFiles.length} modified file(s) with no empty writes; Stop allowed.`,
      };

      appendEvidenceToState(targetState, passRecord);
      saveVerifyState(moduleDataDir, targetState);
      return { decision: 'allow' };
    });
  } catch {
    // Fail-open on unexpected runtime/I/O error
    return { decision: 'allow' };
  }
}
