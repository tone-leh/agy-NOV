import fs from 'node:fs';
import path from 'node:path';
import { getModuleDataDir } from '../../core/config.js';
import { isSamePath } from '../../core/fs-safe.js';
import { formatFailureTailSnippet, redactVerifyOutput } from './sanitize.js';
import { resolveRealPathWithMissingTail } from './store.js';
import type {
  BuildPrDeliverySummaryOptions,
  PrDeliverySpecSummary,
  PrDeliverySummaryResult,
  VerifyEvidenceRecord,
  VerifyStateFile,
} from './types.js';

const MAX_PR_SPEC_STATE_BYTES = 2 * 1024 * 1024; // 2 MiB read guard

/**
 * Pure read-only Spec loader for PR delivery evidence summary.
 * Never creates directories or writes to disk; returns null when absent or invalid.
 */
export function loadSpecSummaryForPrReadOnly(rootDataDir: string): PrDeliverySpecSummary | null {
  if (!rootDataDir || typeof rootDataDir !== 'string' || rootDataDir.includes('\0')) {
    return null;
  }
  const specStatePath = path.join(getModuleDataDir(rootDataDir, 'spec'), 'state.json');
  let st: fs.Stats;
  try {
    st = fs.lstatSync(specStatePath);
  } catch {
    return null;
  }
  if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_PR_SPEC_STATE_BYTES) {
    return null;
  }

  let parsed: unknown;
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    const fd = fs.openSync(specStatePath, fs.constants.O_RDONLY | noFollow);
    let raw = '';
    try {
      const fdStat = fs.fstatSync(fd);
      if (!fdStat.isFile() || fdStat.size > MAX_PR_SPEC_STATE_BYTES) return null;
      const buf = Buffer.alloc(fdStat.size);
      let offset = 0;
      while (offset < fdStat.size) {
        const n = fs.readSync(fd, buf, offset, fdStat.size - offset, offset);
        if (n <= 0) break;
        offset += n;
      }
      raw = buf.subarray(0, offset).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const activeSpecId = typeof obj.activeSpecId === 'string' ? obj.activeSpecId.trim() : '';
  if (!activeSpecId || !Array.isArray(obj.specs)) return null;

  const matched = obj.specs.find(
    (s): s is Record<string, unknown> =>
      Boolean(s && typeof s === 'object' && !Array.isArray(s) && (s as Record<string, unknown>).id === activeSpecId),
  );
  if (!matched) return null;

  const specId = typeof matched.id === 'string' ? matched.id : activeSpecId;
  const title = redactVerifyOutput(
    typeof matched.title === 'string' && matched.title.trim() ? matched.title.trim() : specId,
  ).slice(0, 180);
  const status = typeof matched.status === 'string' && matched.status.trim() ? matched.status.trim() : 'draft';
  const mode = typeof matched.mode === 'string' && matched.mode.trim() ? matched.mode.trim() : undefined;

  const rawTasks = Array.isArray(matched.tasks) ? matched.tasks : [];
  const tasks: Array<{ id: string; title: string; status: string }> = [];
  for (const rawTask of rawTasks.slice(0, 100)) {
    if (!rawTask || typeof rawTask !== 'object' || Array.isArray(rawTask)) continue;
    const t = rawTask as Record<string, unknown>;
    const taskId = typeof t.id === 'string' && t.id.trim() ? t.id.trim() : `t-${tasks.length + 1}`;
    const taskTitle = redactVerifyOutput(
      typeof t.title === 'string' && t.title.trim() ? t.title.trim() : taskId,
    ).slice(0, 200);
    const taskStatus =
      typeof t.status === 'string' && t.status.trim() ? t.status.trim() : 'pending';
    tasks.push({ id: taskId, title: taskTitle, status: taskStatus });
  }

  const doneTasks = tasks.filter((t) => t.status === 'done').length;
  return {
    specId,
    title,
    status,
    ...(mode ? { mode } : {}),
    totalTasks: tasks.length,
    doneTasks,
    tasks,
  };
}

function formatSafeWorktreeLabel(
  worktreePath: string | undefined,
  workspaceRoot: string | undefined,
): string | undefined {
  if (!worktreePath || !worktreePath.trim()) return undefined;
  if (workspaceRoot && workspaceRoot.trim()) {
    try {
      const realRoot = resolveRealPathWithMissingTail(workspaceRoot);
      const realWt = resolveRealPathWithMissingTail(worktreePath);
      if (isSamePath(realWt, realRoot)) return 'workspace root';
      const rel = path.relative(realRoot, realWt).split(path.sep).join('/');
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return rel;
      }
    } catch {
      // Fall back to basename
    }
  }
  return path.basename(worktreePath) || 'worktree';
}

function escapeMdTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ').trim();
}

/**
 * Pure read-only generator for a sanitized Markdown PR delivery evidence block.
 * Combines latest Verify Gate evidence, target branch/worktree metadata, and active Spec progress.
 * Redacts all secret patterns and never performs any disk writes.
 */
export function buildPrDeliverySummary(
  state: VerifyStateFile,
  opts: BuildPrDeliverySummaryOptions = {},
): PrDeliverySummaryResult {
  const mode: 'live' | 'demo' = opts.mode ?? 'live';
  const evidenceList = Array.isArray(state.evidence) ? state.evidence : [];

  let chosen: VerifyEvidenceRecord | undefined;
  if (opts.evidenceId) {
    chosen = evidenceList.find((e) => e.id === opts.evidenceId);
  }
  if (!chosen && opts.worktreePath) {
    let normalizedWanted = opts.worktreePath;
    try {
      normalizedWanted = resolveRealPathWithMissingTail(opts.worktreePath);
    } catch {
      // keep raw
    }
    chosen = evidenceList.find((e) => {
      if (!e.targetWorktree) return false;
      try {
        return isSamePath(resolveRealPathWithMissingTail(e.targetWorktree), normalizedWanted);
      } catch {
        return isSamePath(e.targetWorktree, normalizedWanted);
      }
    });
  }
  if (!chosen) {
    chosen = evidenceList[0];
  }

  const branch = opts.branch || chosen?.targetBranch;
  const effectiveWorktree = opts.worktreePath || chosen?.targetWorktree;
  const safeWorktreeLabel = formatSafeWorktreeLabel(effectiveWorktree, opts.workspaceRoot);
  const spec = opts.specSummary ?? null;

  const results = chosen?.results ?? [];
  const checksTotal = results.length;
  const checksPassed = results.filter((r) => r.passed).length;
  const passed = Boolean(chosen?.passed);

  const statusBadge = !chosen
    ? 'NOT RUN'
    : chosen.outcome === 'pass'
      ? 'PASS'
      : chosen.outcome === 'blocked'
        ? 'BLOCKED'
        : chosen.outcome === 'guardrail-allow'
          ? 'GUARDRAIL-ALLOW'
          : 'FAIL';

  const lines: string[] = [
    '## PR Delivery Verification Evidence',
    '',
    `- **Verify Gate Status**: \`${statusBadge}\`${chosen ? ` (\`${chosen.id}\`, ${chosen.durationMs}ms, ${chosen.timestamp})` : ''}`,
  ];

  if (branch || safeWorktreeLabel) {
    const targetParts: string[] = [];
    if (branch) targetParts.push(`Branch: \`${branch}\``);
    if (safeWorktreeLabel) targetParts.push(`Worktree: \`${safeWorktreeLabel}\``);
    lines.push(`- **Target**: ${targetParts.join(' · ')}`);
  }

  if (spec) {
    const modeTag = spec.mode ? ` · \`${spec.mode}\`` : '';
    lines.push(
      `- **Active Spec**: \`${spec.specId}\` — ${spec.title} (\`${spec.status}\`${modeTag}, ${spec.doneTasks}/${spec.totalTasks} tasks done)`,
    );
  }

  if (chosen?.summary) {
    lines.push(`- **Summary**: ${redactVerifyOutput(chosen.summary)}`);
  }

  lines.push('');
  lines.push('### Verification Checks');
  lines.push('');

  if (!chosen) {
    lines.push('_No verification runs recorded yet._');
  } else if (results.length === 0) {
    lines.push('_No enabled verification commands were executed in this run._');
  } else {
    lines.push('| Status | Check | Command | Exit | Duration | Notes |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const r of results) {
      const cmdStr = escapeMdTableCell(`${r.executable} ${r.args.join(' ')}`.trim());
      const exitStr = r.timedOut ? 'TIMEOUT' : r.exitCode === null ? 'ERR' : String(r.exitCode);
      const snippet = formatFailureTailSnippet(r.outputTail || r.error || '', 2, 140);
      const notes = snippet ? escapeMdTableCell(snippet) : '—';
      lines.push(
        `| ${r.passed ? 'PASS' : 'FAIL'} | ${escapeMdTableCell(r.label || r.commandId)} | \`${cmdStr}\` | ${exitStr} | ${r.durationMs}ms | ${notes} |`,
      );
    }
  }

  if (spec && spec.tasks.length > 0) {
    lines.push('');
    lines.push('### Spec Compliance Progress');
    lines.push('');
    for (const t of spec.tasks) {
      const mark = t.status === 'done' ? 'x' : ' ';
      lines.push(`- [${mark}] \`${t.id}\`: ${t.title} _(${t.status})_`);
    }
  }

  if (chosen && chosen.dirtyFiles.length > 0) {
    lines.push('');
    lines.push(`### Verified Files (${chosen.dirtyFiles.length})`);
    lines.push('');
    for (const file of chosen.dirtyFiles.slice(0, 20)) {
      lines.push(`- \`${file}\``);
    }
    if (chosen.dirtyFiles.length > 20) {
      lines.push(`- _... and ${chosen.dirtyFiles.length - 20} more file(s)_`);
    }
  }

  const finalMarkdown = redactVerifyOutput(lines.join('\n'));

  return {
    mode,
    markdown: finalMarkdown,
    passed,
    ...(branch ? { branch } : {}),
    ...(effectiveWorktree ? { worktreePath: effectiveWorktree } : {}),
    ...(chosen?.id ? { evidenceId: chosen.id } : {}),
    ...(spec?.specId ? { specId: spec.specId } : {}),
    checksTotal,
    checksPassed,
  };
}
