import crypto from 'node:crypto';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import type { NormalizedHookPayload } from '../../core/types.js';
import {
  appendEvidenceToState,
  createEvidenceId,
  formatFailureTailSnippet,
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
    const state = loadVerifyStateReadOnly(moduleDataDir);
    const conversationId = deriveVerifyConversationId(payload);
    const nowIso = new Date().toISOString();

    const existing = state.sessions[conversationId];
    const dirtySet = new Set<string>(existing?.dirtyFiles ?? []);
    const emptySet = new Set<string>(existing?.emptyFiles ?? []);
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
    const editIso =
      Number.isFinite(lastVerifiedMs) && Date.parse(nowIso) <= lastVerifiedMs
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
  } catch {
    // Strictly fail-open
  }
}

/**
 * Stop hook for Verify Gate.
 * Blocks unverified or failing stops when workspace files were modified,
 * with strict loop guardrails (maxConsecutiveBlocks & continuationActive) and redacted evidence logs.
 */
export async function handleVerifyStopHook(
  payload: NormalizedHookPayload,
  rootDataDir: string,
): Promise<{ decision: 'allow' | 'deny'; reason?: string }> {
  try {
    if (payload.event !== 'Stop') {
      return { decision: 'allow' };
    }

    const resolvedRoot = resolveNovDataDir(rootDataDir);
    const moduleDataDir = getModuleDataDir(resolvedRoot, 'verify');
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
      const snapshotDirty = [...session.dirtyFiles];
      const snapshotEmpty = scanEmptyWorkspaceFiles(workspaceRoot, [
        ...session.dirtyFiles,
        ...session.emptyFiles,
      ]);
      const continuationNote =
        payload.continuationActive === true ? ' (continuationActive=true)' : '';

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
        summary: `${GUARDRAIL_ALLOW_REASON}${continuationNote} consecutiveBlocks=${session.consecutiveBlocks}/${state.policy.maxConsecutiveBlocks}.`,
        reason: GUARDRAIL_ALLOW_REASON,
      };

      session.dirtyFiles = [];
      session.emptyFiles = [];
      session.consecutiveBlocks = 0;
      session.lastVerifiedPassed = false;
      session.lastGuardrailReleaseAt = nowIso;
      session.updatedAt = nowIso;

      appendEvidenceToState(state, record);
      saveVerifyState(moduleDataDir, state);
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
      session.consecutiveBlocks += 1;
      session.totalBlocks += 1;
      session.lastVerifiedPassed = false;
      session.updatedAt = nowIso;
      state.blockedStops += 1;

      const fileList = currentEmptyFiles.slice(0, 5).join(', ');
      const extra = currentEmptyFiles.length > 5 ? ` (+${currentEmptyFiles.length - 5} more)` : '';
      const reason = `[agy-NOV Verify Gate] Blocked stop: detected ${currentEmptyFiles.length} empty (0-byte) modified file(s): ${fileList}${extra}. Write valid content or remove empty files before finishing.`;

      const record: VerifyEvidenceRecord = {
        id: createEvidenceId('ver'),
        conversationId,
        trigger: 'stop-hook',
        outcome: 'blocked',
        passed: false,
        timestamp: nowIso,
        durationMs: 0,
        dirtyFiles: [...session.dirtyFiles],
        emptyFiles: [...currentEmptyFiles],
        results: [],
        summary: `Blocked stop due to ${currentEmptyFiles.length} empty modified file(s).`,
        reason,
      };

      appendEvidenceToState(state, record);
      saveVerifyState(moduleDataDir, state);
      return { decision: 'deny', reason };
    }

    // 3. Auto-run enabled checks on Stop within bounded Stop-hook budget (<=8s each, <=14s total)
    const enabledCommands = state.policy.commands.filter((c) => c.enabled);
    let commandResults = [] as VerifyEvidenceRecord['results'];
    let runDurationMs = 0;
    let targetState = state;
    let targetSession = session;
    let effectiveNowIso = nowIso;
    let concurrentEditOccurred = false;
    const preRunDirtyFiles = [...session.dirtyFiles];

    if (state.policy.autoRunOnStop && enabledCommands.length > 0) {
      if (!workspaceRoot) {
        return { decision: 'allow' };
      }

      const preRunLastEditAt = session.lastEditAt;
      const preRunWorkspaceRoot = session.workspaceRoot;
      const preRunConsecutiveBlocks = session.consecutiveBlocks;
      const preRunTotalBlocks = session.totalBlocks;
      const preRunLastGuardrailReleaseAt = session.lastGuardrailReleaseAt;

      const runOut = await runVerifyCommands(enabledCommands, workspaceRoot, {
        singleTimeoutCapMs: STOP_HOOK_SINGLE_TIMEOUT_MS,
        totalBudgetMs: STOP_HOOK_TOTAL_BUDGET_MS,
      });
      commandResults = runOut.results;
      runDurationMs = runOut.durationMs;

      // Reload latest state from disk before writing so concurrent session/policy/evidence updates are merged
      effectiveNowIso = new Date().toISOString();
      targetState = loadVerifyStateReadOnly(moduleDataDir);
      targetSession = targetState.sessions[conversationId] ?? {
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
      concurrentEditOccurred = targetSession.lastEditAt !== preRunLastEditAt;

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
        return { decision: 'deny', reason };
      }
    } else if (!state.policy.autoRunOnStop && session.dirtyFiles.length > 0) {
      // 4. Manual verification enforcement when autoRunOnStop is disabled
      const lastEditMs = session.lastEditAt ? Date.parse(session.lastEditAt) : Number.POSITIVE_INFINITY;
      const lastVerifiedMs = session.lastVerifiedAt
        ? Date.parse(session.lastVerifiedAt)
        : Number.NEGATIVE_INFINITY;
      const unverified =
        !session.lastVerifiedAt ||
        !Number.isFinite(lastVerifiedMs) ||
        (Number.isFinite(lastEditMs) && lastVerifiedMs < lastEditMs) ||
        session.lastVerifiedPassed === false;

      if (unverified) {
        session.consecutiveBlocks += 1;
        session.totalBlocks += 1;
        session.updatedAt = nowIso;
        state.blockedStops += 1;

        const fileList = session.dirtyFiles.slice(0, 5).join(', ');
        const extra =
          session.dirtyFiles.length > 5 ? ` (+${session.dirtyFiles.length - 5} more)` : '';
        const reason = `[agy-NOV Verify Gate] Blocked stop: ${session.dirtyFiles.length} modified file(s) (${fileList}${extra}) have not been verified since the last edit. Run verify_run_checks and ensure checks pass before finishing.`;

        const record: VerifyEvidenceRecord = {
          id: createEvidenceId('ver'),
          conversationId,
          trigger: 'stop-hook',
          outcome: 'blocked',
          passed: false,
          timestamp: nowIso,
          durationMs: 0,
          dirtyFiles: [...session.dirtyFiles],
          emptyFiles: [...currentEmptyFiles],
          results: [],
          summary: `Blocked stop: ${session.dirtyFiles.length} modified file(s) unverified (autoRunOnStop=false).`,
          reason,
        };

        appendEvidenceToState(state, record);
        saveVerifyState(moduleDataDir, state);
        return { decision: 'deny', reason };
      }
    }

    // 5. All checks passed -> clear session dirty state & consecutiveBlocks and log PASS evidence
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

    const summary =
      commandResults.length > 0
        ? `All ${commandResults.length} verification check(s) passed on Stop in ${runDurationMs}ms.`
        : `Verified ${verifiedDirtyFiles.length} modified file(s) with no empty writes; Stop allowed.`;

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
      summary,
    };

    appendEvidenceToState(targetState, passRecord);
    saveVerifyState(moduleDataDir, targetState);
    return { decision: 'allow' };
  } catch {
    // Fail-open on unexpected runtime/I/O error
    return { decision: 'allow' };
  }
}
