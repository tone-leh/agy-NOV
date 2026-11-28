import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalRealpathSync, isSamePath, withFileLockSync } from '../../core/fs-safe.js';
import { resolveSafeSpawnTarget } from '../../core/process-safe.js';
import { validateVerifyCommand } from './allowlist.js';
import { redactVerifyOutput } from './sanitize.js';
import {
  appendEvidenceToState,
  createEvidenceId,
  getVerifyStatePath,
  loadVerifyStateReadOnly,
  resolveRealPathWithMissingTail,
  saveVerifyState,
  scanEmptyWorkspaceFiles,
} from './store.js';
import {
  MAX_CAPTURE_BYTES,
  MAX_COMMAND_TIMEOUT_MS,
  MAX_STORED_OUTPUT_TAIL_CHARS,
  MIN_COMMAND_TIMEOUT_MS,
  type VerifyCommandRunResult,
  type VerifyCommandSpec,
  type VerifyEvidenceRecord,
  type VerifySessionRecord,
  type VerifyStateFile,
  type VerifyTargetResolution,
  type VerifyTrigger,
  type VerifyWorktreeOption,
} from './types.js';

function truncateTailBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) {
    return { text, truncated: false };
  }
  const sliced = buf.subarray(buf.length - maxBytes);
  return { text: sliced.toString('utf8'), truncated: true };
}

function extractTailOutput(
  combinedRaw: string,
  alreadyTruncated = false,
): { outputTail: string; outputTruncated: boolean } {
  const capped = truncateTailBytes(combinedRaw, MAX_CAPTURE_BYTES);
  const redacted = redactVerifyOutput(capped.text);
  let outputTail = redacted;
  let outputTruncated = alreadyTruncated || capped.truncated;
  if (outputTail.length > MAX_STORED_OUTPUT_TAIL_CHARS) {
    outputTail = outputTail.slice(outputTail.length - MAX_STORED_OUTPUT_TAIL_CHARS);
    outputTruncated = true;
  }
  // Second pass guards against secret tokens partially exposed at a truncation boundary
  outputTail = redactVerifyOutput(outputTail).trim();
  return { outputTail, outputTruncated };
}

/**
 * Execute a single validated verification command strictly via child_process.spawn (shell: false).
 * Streams stdout+stderr into a bounded 64KB rolling tail buffer so verbose passing commands (3MB+)
 * are never killed by execFile maxBuffer, and terminates the entire POSIX process group on timeout.
 */
export function executeVerifyCommand(
  command: VerifyCommandSpec,
  workspaceRoot: string,
  options: { timeoutCapMs?: number } = {},
): Promise<VerifyCommandRunResult> {
  const validation = validateVerifyCommand(command);
  const startedAt = Date.now();
  if (!validation.valid || !validation.command) {
    return Promise.resolve({
      commandId: command.id,
      label: command.label,
      executable: command.executable,
      args: [...command.args],
      passed: false,
      exitCode: null,
      timedOut: false,
      durationMs: 0,
      outputTail: '',
      outputTruncated: false,
      error: validation.error ?? 'Command rejected by verify allowlist.',
    });
  }

  const safeCmd = validation.command;
  const effectiveTimeoutMs = Math.max(
    MIN_COMMAND_TIMEOUT_MS,
    Math.min(
      safeCmd.timeoutMs,
      options.timeoutCapMs !== undefined
        ? Math.max(MIN_COMMAND_TIMEOUT_MS, Math.floor(options.timeoutCapMs))
        : MAX_COMMAND_TIMEOUT_MS,
    ),
  );

  let resolvedCwd: string;
  try {
    resolvedCwd = canonicalRealpathSync(path.resolve(workspaceRoot));
    if (!fs.statSync(resolvedCwd).isDirectory()) {
      throw new Error('Workspace root is not a directory.');
    }
  } catch (err) {
    return Promise.resolve({
      commandId: safeCmd.id,
      label: safeCmd.label,
      executable: safeCmd.executable,
      args: [...safeCmd.args],
      passed: false,
      exitCode: null,
      timedOut: false,
      durationMs: Date.now() - startedAt,
      outputTail: '',
      outputTruncated: false,
      error: redactVerifyOutput(err instanceof Error ? err.message : String(err)),
    });
  }

  return new Promise<VerifyCommandRunResult>((resolve) => {
    const isPosix = process.platform !== 'win32';
    let settled = false;
    let timedOut = false;
    let streamTruncated = false;
    let bufferedBytes = 0;
    const chunks: Buffer[] = [];
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let hardKillTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanupTimers = () => {
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      if (hardKillTimer) {
        clearTimeout(hardKillTimer);
        hardKillTimer = null;
      }
    };

    const pushChunk = (data: Buffer | string) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      if (buf.length === 0) return;
      if (buf.length >= MAX_CAPTURE_BYTES) {
        const tailCopy = Buffer.from(buf.subarray(buf.length - MAX_CAPTURE_BYTES));
        chunks.length = 0;
        chunks.push(tailCopy);
        bufferedBytes = tailCopy.length;
        streamTruncated = true;
        return;
      }
      chunks.push(buf);
      bufferedBytes += buf.length;
      // Compact rolling tail buffer when accumulated size exceeds 2x the 64KB cap
      if (bufferedBytes > MAX_CAPTURE_BYTES * 2) {
        const merged = Buffer.concat(chunks, bufferedBytes);
        const tailCopy = Buffer.from(merged.subarray(merged.length - MAX_CAPTURE_BYTES));
        chunks.length = 0;
        chunks.push(tailCopy);
        bufferedBytes = tailCopy.length;
        streamTruncated = true;
      }
    };

    const buildOutput = () => {
      const merged = chunks.length > 0 ? Buffer.concat(chunks, bufferedBytes) : Buffer.alloc(0);
      return extractTailOutput(merged.toString('utf8'), streamTruncated);
    };

    const finish = (result: VerifyCommandRunResult) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      resolve(result);
    };

    let child: ReturnType<typeof spawn>;
    try {
      const resolvedSpawn = resolveSafeSpawnTarget(safeCmd.executable, safeCmd.args, {
        cwd: resolvedCwd,
      });
      child = spawn(resolvedSpawn.command, resolvedSpawn.args, {
        cwd: resolvedCwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: isPosix,
      });
    } catch (err) {
      finish({
        commandId: safeCmd.id,
        label: safeCmd.label,
        executable: safeCmd.executable,
        args: [...safeCmd.args],
        passed: false,
        exitCode: null,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        outputTail: '',
        outputTruncated: false,
        error: redactVerifyOutput(err instanceof Error ? err.message : String(err)),
      });
      return;
    }

    const killProcessTree = (signal: NodeJS.Signals) => {
      const pid = child.pid;
      if (isPosix && typeof pid === 'number' && Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(-pid, signal);
          return;
        } catch {
          // Process group may not exist or already exited; fall back to direct child kill
        }
      } else if (!isPosix && typeof pid === 'number' && Number.isInteger(pid) && pid > 0) {
        if (child.exitCode !== null || child.signalCode !== null) {
          return;
        }
        try {
          execFile(
            'taskkill',
            ['/pid', String(pid), '/T', '/F'],
            { windowsHide: true, shell: false },
            (err) => {
              if (err && child.exitCode === null && child.signalCode === null) {
                try {
                  child.kill(signal);
                } catch {
                  // ignore
                }
              }
            },
          );
          return;
        } catch {
          // fall through to direct child kill fallback
        }
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      try {
        child.kill(signal);
      } catch {
        // ignore
      }
    };

    const destroyPipes = () => {
      try {
        child.stdout?.destroy();
      } catch {
        // ignore
      }
      try {
        child.stderr?.destroy();
      } catch {
        // ignore
      }
    };

    child.stdout?.on('data', pushChunk);
    child.stderr?.on('data', pushChunk);
    child.stdout?.on('error', () => {
      // ignore stream errors during forced pipe teardown
    });
    child.stderr?.on('error', () => {
      // ignore stream errors during forced pipe teardown
    });

    child.on('error', (err) => {
      const durationMs = Date.now() - startedAt;
      const { outputTail, outputTruncated } = buildOutput();
      finish({
        commandId: safeCmd.id,
        label: safeCmd.label,
        executable: safeCmd.executable,
        args: [...safeCmd.args],
        passed: false,
        exitCode: null,
        timedOut,
        durationMs,
        outputTail,
        outputTruncated,
        error: redactVerifyOutput(err instanceof Error ? err.message : String(err)),
      });
    });

    child.on('close', (code, signal) => {
      const durationMs = Date.now() - startedAt;
      const { outputTail, outputTruncated } = buildOutput();
      const exitCode = typeof code === 'number' ? code : null;

      if (!timedOut && exitCode === 0) {
        finish({
          commandId: safeCmd.id,
          label: safeCmd.label,
          executable: safeCmd.executable,
          args: [...safeCmd.args],
          passed: true,
          exitCode: 0,
          timedOut: false,
          durationMs,
          outputTail,
          outputTruncated,
        });
        return;
      }

      const errMessage = timedOut
        ? `Command timed out after ${effectiveTimeoutMs}ms`
        : signal
          ? `Command terminated by signal ${signal}`
          : `Command exited with code ${exitCode ?? 'unknown'}`;

      finish({
        commandId: safeCmd.id,
        label: safeCmd.label,
        executable: safeCmd.executable,
        args: [...safeCmd.args],
        passed: false,
        exitCode,
        timedOut,
        durationMs,
        outputTail,
        outputTruncated,
        error: errMessage,
      });
    });

    killTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      killProcessTree('SIGTERM');

      hardKillTimer = setTimeout(() => {
        if (settled) return;
        killProcessTree('SIGKILL');
        destroyPipes();
        try {
          child.unref();
        } catch {
          // ignore
        }
        const durationMs = Date.now() - startedAt;
        const { outputTail, outputTruncated } = buildOutput();
        finish({
          commandId: safeCmd.id,
          label: safeCmd.label,
          executable: safeCmd.executable,
          args: [...safeCmd.args],
          passed: false,
          exitCode: null,
          timedOut: true,
          durationMs,
          outputTail,
          outputTruncated,
          error: `Command timed out after ${effectiveTimeoutMs}ms`,
        });
      }, 300);
      hardKillTimer.unref?.();
    }, effectiveTimeoutMs);
    killTimer.unref?.();
  });
}

export async function runVerifyCommands(
  commands: readonly VerifyCommandSpec[],
  workspaceRoot: string,
  options: {
    singleTimeoutCapMs?: number;
    totalBudgetMs?: number;
  } = {},
): Promise<{
  passed: boolean;
  results: VerifyCommandRunResult[];
  durationMs: number;
}> {
  const startedAt = Date.now();
  const results: VerifyCommandRunResult[] = [];
  const totalBudgetMs = options.totalBudgetMs;

  for (const cmd of commands) {
    let timeoutCapMs = options.singleTimeoutCapMs;
    if (totalBudgetMs !== undefined) {
      const elapsed = Date.now() - startedAt;
      const remaining = totalBudgetMs - elapsed;
      if (remaining < MIN_COMMAND_TIMEOUT_MS) {
        results.push({
          commandId: cmd.id,
          label: cmd.label,
          executable: cmd.executable,
          args: [...cmd.args],
          passed: false,
          exitCode: null,
          timedOut: true,
          durationMs: 0,
          outputTail: '',
          outputTruncated: false,
          error: `Skipped: total verification time budget (${totalBudgetMs}ms) exhausted.`,
        });
        continue;
      }
      timeoutCapMs =
        timeoutCapMs !== undefined ? Math.min(timeoutCapMs, remaining) : remaining;
    }

    const res = await executeVerifyCommand(cmd, workspaceRoot, { timeoutCapMs });
    results.push(res);
  }

  return {
    passed: results.every((r) => r.passed),
    results,
    durationMs: Date.now() - startedAt,
  };
}

function runReadOnlyGitForVerify(cwd: string, args: string[]): { ok: boolean; stdout: string } {
  try {
    const stdout = execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: '' };
  }
}

function parseVerifyWorktreePorcelain(
  output: string,
): Array<{ rawPath: string; branch: string | null; isMain: boolean; bare: boolean }> {
  const entries: Array<{ rawPath: string; branch: string | null; isMain: boolean; bare: boolean }> = [];
  let current: { rawPath?: string; branch: string | null; bare: boolean } | null = null;

  const flush = () => {
    if (!current || !current.rawPath) return;
    entries.push({
      rawPath: current.rawPath,
      branch: current.branch,
      isMain: entries.length === 0,
      bare: current.bare,
    });
    current = null;
  };

  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      current = { rawPath: line.slice('worktree '.length), branch: null, bare: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    } else if (line === 'detached') {
      current.branch = null;
    } else if (line === 'bare') {
      current.bare = true;
    }
  }
  flush();
  return entries;
}

/**
 * Pure read-only discovery of active registered Git worktrees belonging to `mainWorkspaceRoot`.
 */
export function listVerifyWorktreesReadOnly(mainWorkspaceRoot: string): VerifyWorktreeOption[] {
  if (!mainWorkspaceRoot || typeof mainWorkspaceRoot !== 'string' || mainWorkspaceRoot.includes('\0')) {
    return [];
  }
  let mainReal: string;
  try {
    mainReal = canonicalRealpathSync(path.resolve(mainWorkspaceRoot));
    if (!fs.statSync(mainReal).isDirectory()) return [];
  } catch {
    return [];
  }

  const topRes = runReadOnlyGitForVerify(mainReal, ['rev-parse', '--show-toplevel']);
  if (!topRes.ok || !topRes.stdout.trim()) return [];

  let topReal: string;
  try {
    topReal = canonicalRealpathSync(path.resolve(topRes.stdout.trim()));
  } catch {
    return [];
  }

  const listRes = runReadOnlyGitForVerify(topReal, ['worktree', 'list', '--porcelain']);
  if (!listRes.ok) return [];

  const parsed = parseVerifyWorktreePorcelain(listRes.stdout);
  const out: VerifyWorktreeOption[] = [];
  for (const item of parsed) {
    if (item.bare) continue;
    try {
      const resolved = path.resolve(item.rawPath);
      if (!fs.statSync(resolved).isDirectory()) continue;
      const realPath = canonicalRealpathSync(resolved);
      out.push({
        path: realPath,
        branch: item.branch,
        isMain: item.isMain,
      });
    } catch {
      // Skip non-existent or inaccessible prunable entries
    }
  }
  return out;
}

function detectGitBranchReadOnly(cwd: string): string | undefined {
  const sym = runReadOnlyGitForVerify(cwd, ['symbolic-ref', '--short', 'HEAD']);
  if (sym.ok && sym.stdout.trim()) {
    return sym.stdout.trim();
  }
  const sha = runReadOnlyGitForVerify(cwd, ['rev-parse', '--short', 'HEAD']);
  if (sha.ok && sha.stdout.trim()) {
    return `detached@${sha.stdout.trim()}`;
  }
  return undefined;
}

/**
 * Resolve and authorize the target execution directory for Verify Gate checks.
 * - When `worktreePath` is omitted, returns the canonicalized `mainWorkspaceRoot`.
 * - When `worktreePath` is provided, verifies it is not a symlink leaf and strictly matches
 *   either `mainWorkspaceRoot` or an active Git worktree listed by `git worktree list --porcelain`
 *   for `mainWorkspaceRoot` (with matching `realpathSync`). Refuses all arbitrary external paths.
 */
export function resolveAllowedVerifyTargetRoot(
  mainWorkspaceRoot: string,
  worktreePath?: string,
): VerifyTargetResolution {
  if (!mainWorkspaceRoot || typeof mainWorkspaceRoot !== 'string' || mainWorkspaceRoot.includes('\0')) {
    throw new Error('Invalid mainWorkspaceRoot: must be a non-empty path without NUL bytes.');
  }

  let mainRealRoot: string;
  try {
    mainRealRoot = canonicalRealpathSync(path.resolve(mainWorkspaceRoot));
    if (!fs.statSync(mainRealRoot).isDirectory()) {
      throw new Error('Workspace root is not a directory.');
    }
  } catch (err) {
    throw new Error(
      `Invalid workspaceRoot "${mainWorkspaceRoot}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (worktreePath === undefined || worktreePath.trim() === '') {
    const branch = detectGitBranchReadOnly(mainRealRoot);
    return {
      targetRoot: mainRealRoot,
      isWorktree: false,
      ...(branch ? { branch } : {}),
    };
  }

  const trimmed = worktreePath.trim();
  if (trimmed.includes('\0')) {
    throw new Error('Invalid worktreePath: NUL byte is disallowed.');
  }

  const resolvedCandidate = path.resolve(trimmed);
  let candidateLstat: fs.Stats;
  try {
    candidateLstat = fs.lstatSync(resolvedCandidate);
  } catch {
    throw new Error(`Verify target worktree does not exist or is inaccessible: ${trimmed}`);
  }
  if (candidateLstat.isSymbolicLink()) {
    throw new Error(`Refused: verify target worktree "${trimmed}" must not be a symbolic link.`);
  }
  if (!candidateLstat.isDirectory()) {
    throw new Error(`Refused: verify target worktree "${trimmed}" is not a directory.`);
  }

  const realCandidate = canonicalRealpathSync(resolvedCandidate);
  const worktrees = listVerifyWorktreesReadOnly(mainRealRoot);

  if (isSamePath(realCandidate, mainRealRoot)) {
    const matchedMain = worktrees.find((w) => isSamePath(w.path, mainRealRoot));
    const branch = matchedMain?.branch ?? detectGitBranchReadOnly(mainRealRoot);
    return {
      targetRoot: mainRealRoot,
      isWorktree: false,
      ...(branch ? { branch } : {}),
      worktreePath: mainRealRoot,
    };
  }

  const matched = worktrees.find((w) => isSamePath(w.path, realCandidate));
  if (!matched) {
    throw new Error(
      `Refused: "${trimmed}" is not the workspace root or a registered Git worktree for this repository.`,
    );
  }

  const branch = matched.branch ?? detectGitBranchReadOnly(matched.path);
  return {
    targetRoot: matched.path,
    isWorktree: !matched.isMain,
    ...(branch ? { branch } : {}),
    worktreePath: matched.path,
  };
}

export async function runVerifyChecksLive(
  moduleDataDir: string,
  workspaceRoot: string,
  options: {
    commandId?: string;
    conversationId?: string;
    trigger?: VerifyTrigger;
    worktreePath?: string;
  } = {},
): Promise<
  | { ok: true; run: VerifyEvidenceRecord; state: VerifyStateFile }
  | { ok: false; error: string }
> {
  let targetResolution: VerifyTargetResolution;
  try {
    targetResolution = resolveAllowedVerifyTargetRoot(workspaceRoot, options.worktreePath);
  } catch (err) {
    return {
      ok: false,
      error: redactVerifyOutput(err instanceof Error ? err.message : String(err)),
    };
  }

  const executionRoot = targetResolution.targetRoot;
  const initialState = loadVerifyStateReadOnly(moduleDataDir);
  let targetCommands: VerifyCommandSpec[];

  if (options.commandId) {
    const match = initialState.policy.commands.find((c) => c.id === options.commandId);
    if (!match) {
      return { ok: false, error: `Verify command not found: "${options.commandId}".` };
    }
    targetCommands = [match];
  } else {
    targetCommands = initialState.policy.commands.filter((c) => c.enabled);
  }

  // Track each session's pre-run lastEditAt so concurrent edits are never marked stale-verified
  const initialLastEditAt = new Map<string, string | undefined>();
  for (const [id, sess] of Object.entries(initialState.sessions)) {
    initialLastEditAt.set(id, sess.lastEditAt);
  }

  const runOut = await runVerifyCommands(targetCommands, executionRoot);
  const nowIso = new Date().toISOString();
  const convId = options.conversationId?.trim() || 'manual';

  // Reload latest state from disk under cross-process file lock so concurrent hook updates are preserved
  return withFileLockSync(getVerifyStatePath(moduleDataDir), () => {
    const state = loadVerifyStateReadOnly(moduleDataDir);

    let realWorkspace: string | undefined;
    try {
      realWorkspace = resolveRealPathWithMissingTail(executionRoot);
    } catch {
      realWorkspace = undefined;
    }

    // Update matching session verification timestamps when running full check suite or targeted session
    const targetSessions: VerifySessionRecord[] = [];
    if (options.conversationId && state.sessions[convId]) {
      targetSessions.push(state.sessions[convId]);
    } else if (!options.commandId) {
      for (const s of Object.values(state.sessions)) {
        if (s.dirtyFiles.length === 0 && s.emptyFiles.length === 0) continue;
        if (!s.workspaceRoot || !realWorkspace) {
          targetSessions.push(s);
        } else {
          try {
            if (isSamePath(resolveRealPathWithMissingTail(s.workspaceRoot), realWorkspace)) {
              targetSessions.push(s);
            }
          } catch {
            // ignore unresolvable workspace
          }
        }
      }
    }

    const dirtyFilesSet = new Set<string>();
    const emptyFilesSet = new Set<string>();
    for (const s of targetSessions) {
      const curEmpty = scanEmptyWorkspaceFiles(s.workspaceRoot ?? executionRoot, [
        ...s.dirtyFiles,
        ...s.emptyFiles,
      ]);
      s.emptyFiles = curEmpty;
      for (const f of s.dirtyFiles) dirtyFilesSet.add(f);
      for (const f of curEmpty) emptyFilesSet.add(f);

      const editedDuringRun =
        !initialLastEditAt.has(s.conversationId) ||
        initialLastEditAt.get(s.conversationId) !== s.lastEditAt;

      if (!options.commandId && !editedDuringRun) {
        const lastEditMs = s.lastEditAt ? Date.parse(s.lastEditAt) : Number.NaN;
        const verifiedTs =
          Number.isFinite(lastEditMs) && Date.parse(nowIso) <= lastEditMs
            ? new Date(lastEditMs + 1).toISOString()
            : nowIso;

        s.lastVerifiedAt = verifiedTs;
        s.lastVerifiedPassed = runOut.passed && curEmpty.length === 0;
        if (s.lastVerifiedPassed) {
          s.consecutiveBlocks = 0;
        }
        s.updatedAt = verifiedTs;
      }
    }

    const passedCount = runOut.results.filter((r) => r.passed).length;
    const summary =
      runOut.results.length === 0
        ? 'No enabled verification commands configured; check passed.'
        : runOut.passed
          ? `All ${runOut.results.length} verification command(s) passed in ${runOut.durationMs}ms.`
          : `${runOut.results.length - passedCount}/${runOut.results.length} verification command(s) failed.`;

    const record: VerifyEvidenceRecord = {
      id: createEvidenceId('ver'),
      conversationId: convId,
      trigger: options.trigger ?? 'manual',
      outcome: runOut.passed ? 'pass' : 'fail',
      passed: runOut.passed,
      timestamp: nowIso,
      durationMs: runOut.durationMs,
      dirtyFiles: [...dirtyFilesSet],
      emptyFiles: [...emptyFilesSet],
      results: runOut.results,
      summary,
      ...(targetResolution.branch ? { targetBranch: targetResolution.branch } : {}),
      ...(options.worktreePath || targetResolution.isWorktree
        ? { targetWorktree: executionRoot }
        : {}),
    };

    appendEvidenceToState(state, record);
    const saved = saveVerifyState(moduleDataDir, state);
    return { ok: true as const, run: record, state: saved };
  });
}
