import path from 'node:path';
import { isSensitivePathSegment, redactSecretsLinear } from '../../core/sanitize.js';
import { validateTaskDag } from './dag.js';
import { loadSpecStateReadOnly } from './store.js';
import {
  isSpecWriteLockActive,
  VALID_SPEC_MODES,
  VALID_SPEC_STATUSES,
  type SpecDocument,
  type SpecMode,
  type SpecStatus,
  type SpecTask,
  type SpecTaskStatus,
} from './types.js';

export type SpecWorkflowTarget = 'workflow' | 'swarm' | 'both';
export type SpecWorkflowModelTier = 'inherit' | 'flash' | 'pro';

export interface SpecCompileOptions {
  target?: SpecWorkflowTarget;
  includeReviewGate?: boolean;
  includeVerifyGate?: boolean;
  useShareWorkspace?: boolean;
  modelTier?: SpecWorkflowModelTier;
  includeCompleted?: boolean;
}

export interface SpecWorkflowWaveTask {
  id: string;
  title: string;
  description?: string;
  status: SpecTaskStatus;
  dependsOn: string[];
  files: string[];
  role: string;
  suggestedWorkspace: 'share' | 'inherit';
}

export interface SpecWorkflowWave {
  waveIndex: number;
  parallelizable: boolean;
  suggestedWorkspace: 'share' | 'inherit';
  tasks: SpecWorkflowWaveTask[];
}

export interface SpecSwarmTaskEntry {
  id: string;
  title: string;
  description?: string;
  status: SpecTaskStatus;
  dependsOn: string[];
  files: string[];
  role: string;
  suggestedWorkspace: 'share' | 'inherit';
}

export interface SpecSwarmWave {
  waveIndex: number;
  parallelizable: boolean;
  tasks: SpecSwarmTaskEntry[];
}

export interface SpecSwarmPlan {
  schemaVersion: 1;
  generator: 'agy-nov/spec-compiler';
  specId: string;
  title: string;
  status: SpecStatus;
  mode: SpecMode;
  revision: number;
  writeLockActive: boolean;
  goal: string;
  waves: SpecSwarmWave[];
  gates: {
    blindReview: boolean;
    securityAudit: boolean;
    verifyStopGate: boolean;
  };
  acceptanceCriteria: string[];
  warnings: string[];
}

export interface SpecWorkflowCompilationSuccess {
  ok: true;
  target: SpecWorkflowTarget;
  specId: string;
  title: string;
  status: SpecStatus;
  mode: SpecMode;
  revision: number;
  writeLockActive: boolean;
  totalTasks: number;
  compiledTasks: number;
  skippedCompletedTasks: number;
  waveCount: number;
  parallelWaveCount: number;
  waves: SpecWorkflowWave[];
  warnings: string[];
  workflowPython?: string;
  swarmPlan?: SpecSwarmPlan;
  swarmPlanJson?: string;
}

export interface SpecWorkflowCompilationFailure {
  ok: false;
  error: string;
  specId?: string;
  cycleTaskIds?: string[];
  unknownDependencies?: Array<{ taskId: string; dependencyId: string }>;
}

export type SpecWorkflowCompilationResult =
  | SpecWorkflowCompilationSuccess
  | SpecWorkflowCompilationFailure;

const VALID_TARGETS: ReadonlySet<SpecWorkflowTarget> = new Set(['workflow', 'swarm', 'both']);
const VALID_MODEL_TIERS: ReadonlySet<SpecWorkflowModelTier> = new Set(['inherit', 'flash', 'pro']);
const FILE_HINT_PATH_RE = /\b(?:[a-zA-Z0-9._-]+\/)+[a-zA-Z0-9._-]+\.[a-zA-Z0-9]{1,12}\b/g;
const DOMAIN_FIRST_SEG_RE = /\.(?:com|org|net|io|dev|app|ai|edu|gov|co|cn|jp|de|fr|es)$/i;
const MAX_TASK_FILE_HINTS = 16;

interface RedactionTracker {
  hadRedaction: boolean;
}

function compareStable(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function redactField(input: string, tracker: RedactionTracker): string {
  if (!input) return '';
  const cleaned = redactSecretsLinear(input, {
    stripPrivate: true,
    privateReplacement: '[REDACTED_PRIVATE]',
  });
  if (cleaned !== input) {
    tracker.hadRedaction = true;
  }
  return cleaned;
}

/**
 * Strips unpaired UTF-16 surrogates so JSON/Python string serialization stays valid UTF-8.
 */
function stripUnpairedSurrogates(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i] + input[i + 1];
        i += 1;
      } else {
        out += '\uFFFD';
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += '\uFFFD';
    } else {
      out += input[i];
    }
  }
  return out;
}

/**
 * Encodes an arbitrary string as a safe Python 3 double-quoted string literal.
 * Never uses triple quotes, and escapes NEL / line separators / C1 / Bidi control characters
 * so host wrappers using `str.splitlines()` or Python 3.13+ cannot break out or syntax-error.
 */
function toPyStringLiteral(text: string): string {
  const safe = stripUnpairedSurrogates(text);
  return JSON.stringify(safe)
    .replace(/[\u0080-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, (ch) => {
      const hex = ch.charCodeAt(0).toString(16).padStart(4, '0');
      return `\\u${hex}`;
    });
}

/**
 * Produces a single-line safe Python comment fragment (cannot inject newlines, NEL, or Bidi controls).
 */
function toPyCommentSafe(text: string, maxLen = 180): string {
  const safe = stripUnpairedSurrogates(text)
    .replace(/[\r\n\u0085\u2028\u2029\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (safe.length <= maxLen) return safe;
  return `${safe.slice(0, Math.max(1, maxLen - 3)).trimEnd()}...`;
}

function toPyStringList(items: readonly string[]): string {
  if (items.length === 0) return '[]';
  return `[${items.map((item) => toPyStringLiteral(item)).join(', ')}]`;
}

function normalizeTarget(raw: unknown): SpecWorkflowTarget {
  return typeof raw === 'string' && VALID_TARGETS.has(raw as SpecWorkflowTarget)
    ? (raw as SpecWorkflowTarget)
    : 'both';
}

function normalizeModelTier(raw: unknown): SpecWorkflowModelTier {
  return typeof raw === 'string' && VALID_MODEL_TIERS.has(raw as SpecWorkflowModelTier)
    ? (raw as SpecWorkflowModelTier)
    : 'inherit';
}

function isSafeRelativeFileHint(candidate: string): boolean {
  const norm = candidate.replace(/\\/g, '/').trim();
  if (!norm || norm.length > 180) return false;
  if (norm.startsWith('/') || norm.startsWith('~') || /^[a-zA-Z]:/.test(norm)) return false;
  if (norm.includes('://')) return false;
  const segments = norm.split('/');
  if (segments.some((seg) => !seg || seg === '.' || seg === '..')) return false;
  if (DOMAIN_FIRST_SEG_RE.test(segments[0] ?? '')) return false;
  if (isSensitivePathSegment(norm)) return false;
  return true;
}

function extractTaskFileHints(
  task: SpecTask & { files?: unknown },
  redactedTitle: string,
  redactedDescription: string | undefined,
  redactedNote: string | undefined,
  tracker: RedactionTracker,
): string[] {
  const seen = new Set<string>();
  const files: string[] = [];

  const pushHint = (raw: string) => {
    if (files.length >= MAX_TASK_FILE_HINTS) return;
    const cleaned = raw.replace(/^['"`(]+|['"`),.;:!?]+$/g, '').trim();
    if (!isSafeRelativeFileHint(cleaned)) return;
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      files.push(cleaned);
    }
  };

  if (Array.isArray(task.files)) {
    for (const entry of task.files) {
      if (typeof entry !== 'string') continue;
      const redacted = redactField(entry, tracker);
      pushHint(redacted);
    }
  }

  const corpus = [redactedTitle, redactedDescription ?? '', redactedNote ?? ''].join('\n');
  FILE_HINT_PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_HINT_PATH_RE.exec(corpus)) !== null) {
    const idx = match.index;
    const prevChar = idx > 0 ? corpus[idx - 1] : '';
    if (
      prevChar === '/' ||
      prevChar === '\\' ||
      prevChar === ':' ||
      prevChar === '@' ||
      prevChar === '~'
    ) {
      continue;
    }
    pushHint(match[0]);
    if (files.length >= MAX_TASK_FILE_HINTS) break;
  }

  return files;
}

function inferTaskRole(taskId: string, title: string, description?: string): string {
  const haystack = `${taskId} ${title} ${description ?? ''}`.toLowerCase();
  if (/\b(security|audit|review|compliance|vuln)\b/.test(haystack)) {
    return 'reviewer';
  }
  if (/\b(test|tests|spec-test|e2e|verify|qa|canary|regression)\b/.test(haystack)) {
    return 'tester';
  }
  if (/\b(docs|documentation|readme|changelog|skill|guide)\b/.test(haystack)) {
    return 'writer';
  }
  return 'builder';
}

function inspectDagFailureDetails(
  tasks: ReadonlyArray<SpecTask>,
): {
  cycleTaskIds?: string[];
  unknownDependencies?: Array<{ taskId: string; dependencyId: string }>;
} {
  const idSet = new Set<string>(tasks.map((t) => t.id));
  const unknownDependencies: Array<{ taskId: string; dependencyId: string }> = [];
  const selfCycleIds: string[] = [];

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    inDegree.set(task.id, 0);
    dependents.set(task.id, []);
  }

  for (const task of tasks) {
    const seen = new Set<string>();
    for (const dep of task.dependsOn) {
      if (dep === task.id) {
        selfCycleIds.push(task.id);
        continue;
      }
      if (!idSet.has(dep)) {
        unknownDependencies.push({ taskId: task.id, dependencyId: dep });
        continue;
      }
      if (!seen.has(dep)) {
        seen.add(dep);
        dependents.get(dep)!.push(task.id);
        inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
      }
    }
  }

  if (selfCycleIds.length > 0) {
    return {
      cycleTaskIds: Array.from(new Set(selfCycleIds)).sort(compareStable),
      ...(unknownDependencies.length > 0 ? { unknownDependencies } : {}),
    };
  }

  if (unknownDependencies.length > 0) {
    return { unknownDependencies };
  }

  const queue: string[] = [];
  for (const task of tasks) {
    if ((inDegree.get(task.id) ?? 0) === 0) {
      queue.push(task.id);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    for (const next of dependents.get(current) ?? []) {
      const rem = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, rem);
      if (rem === 0) {
        queue.push(next);
      }
    }
  }

  const cycleTaskIds = tasks
    .filter((t) => (inDegree.get(t.id) ?? 0) > 0)
    .map((t) => t.id)
    .sort(compareStable);

  return cycleTaskIds.length > 0 ? { cycleTaskIds } : {};
}

function buildTaskPrompt(
  specId: string,
  specTitle: string,
  specGoal: string,
  task: SpecWorkflowWaveTask,
  acceptanceCriteria: readonly string[],
): string {
  const lines: string[] = [
    `Execute Spec task "${task.id}": ${task.title}`,
    `Spec: ${specTitle} (${specId})`,
    `Goal: ${specGoal}`,
  ];
  if (task.description) {
    lines.push(`Details: ${task.description}`);
  }
  if (task.dependsOn.length > 0) {
    lines.push(`Prerequisites already satisfied: ${task.dependsOn.join(', ')}`);
  }
  if (task.files.length > 0) {
    lines.push(`Suggested file scope: ${task.files.join(', ')}`);
  }
  if (acceptanceCriteria.length > 0) {
    lines.push('Spec acceptance criteria:');
    for (const criterion of acceptanceCriteria.slice(0, 8)) {
      lines.push(`- ${criterion}`);
    }
  }
  lines.push(
    'Stay strictly within the approved Spec scope, verify your changes with targeted checks, and return a concise JSON summary with taskId, summary, and filesTouched.',
  );
  return lines.join('\n');
}

function buildWorkflowPython(params: {
  specId: string;
  title: string;
  status: SpecStatus;
  mode: SpecMode;
  revision: number;
  writeLockActive: boolean;
  goal: string;
  acceptanceCriteria: readonly string[];
  waves: readonly SpecWorkflowWave[];
  totalTasks: number;
  compiledTasks: number;
  skippedCompletedTasks: number;
  includeReviewGate: boolean;
  includeVerifyGate: boolean;
  useShareWorkspace: boolean;
  modelTier: SpecWorkflowModelTier;
  warnings: readonly string[];
}): string {
  const {
    specId,
    title,
    status,
    mode,
    revision,
    writeLockActive,
    goal,
    acceptanceCriteria,
    waves,
    totalTasks,
    compiledTasks,
    skippedCompletedTasks,
    includeReviewGate,
    includeVerifyGate,
    useShareWorkspace,
    modelTier,
    warnings,
  } = params;

  const safeStatusLabel = toPyCommentSafe(String(status).toUpperCase(), 24);
  const safeModeLabel = toPyCommentSafe(String(mode).toUpperCase(), 24);
  const safeRevisionLabel = Number.isInteger(revision) && revision >= 1 ? String(revision) : '1';
  const lines: string[] = [
    '# Generated by agy-NOV Spec Workflow Compiler (read-only export for Antigravity /run-workflow)',
    `# Spec ID: ${toPyCommentSafe(specId, 80)} | Title: ${toPyCommentSafe(title, 140)}`,
    `# Status: ${safeStatusLabel} | Mode: ${safeModeLabel} | Revision: v${safeRevisionLabel} | Write Lock: ${writeLockActive ? 'ACTIVE' : 'OFF'}`,
    `# Waves: ${waves.length} | Compiled Tasks: ${compiledTasks}/${totalTasks} (skipped done: ${skippedCompletedTasks})`,
    `# Gates: blindReview=${includeReviewGate}, securityAudit=${includeReviewGate}, verifyStopGate=${includeVerifyGate}`,
  ];

  if (status === 'draft') {
    lines.push(
      `# WARNING: Spec is still in DRAFT status${writeLockActive ? ' with write lock ACTIVE' : ''}. Approve the Spec in agy-NOV Spec Flow before executing write phases.`,
    );
  }
  for (const warning of warnings) {
    lines.push(`# NOTE: ${toPyCommentSafe(warning, 180)}`);
  }

  lines.push('');
  lines.push(`SPEC_ID = ${toPyStringLiteral(specId)}`);
  lines.push(`SPEC_TITLE = ${toPyStringLiteral(title)}`);
  lines.push(`SPEC_STATUS = ${toPyStringLiteral(status)}`);
  lines.push(`SPEC_GOAL = ${toPyStringLiteral(goal)}`);
  lines.push(`ACCEPTANCE_CRITERIA = ${toPyStringList(acceptanceCriteria)}`);
  lines.push('');

  lines.push(
    `log(${toPyStringLiteral(`Starting agy-NOV compiled workflow for ${specId} (${waves.length} wave(s), ${compiledTasks}/${totalTasks} task(s))`)})`,
  );

  if (status === 'draft') {
    lines.push(
      `log(${toPyStringLiteral(`WARNING: Spec "${title}" (${specId}) is still in DRAFT status. Approve it in agy-NOV Spec Flow before running workspace mutations.`)})`,
    );
  }

  if (waves.length === 0) {
    lines.push('');
    lines.push(`phase(${toPyStringLiteral('No Pending Tasks')})`);
    lines.push(
      `log(${toPyStringLiteral(
        totalTasks === 0
          ? 'Spec has no DAG tasks defined; proceeding directly to configured audit/verify handoff phases.'
          : `All ${totalTasks} task(s) are already done; skipping implementation waves (pass includeCompleted=true to recompile).`,
      )})`,
    );
  } else {
    for (const wave of waves) {
      lines.push('');
      const varPrefix = `WAVE_${wave.waveIndex}`;
      if (wave.tasks.length >= 2) {
        const workspaceLiteral = toPyStringLiteral(useShareWorkspace ? 'share' : 'inherit');
        const modelLiteral = toPyStringLiteral(modelTier);
        const phaseTitle = `Wave ${wave.waveIndex}: Parallel (${wave.tasks.length} tasks)`;

        lines.push(`${varPrefix}_TASKS = [`);
        for (const task of wave.tasks) {
          const prompt = buildTaskPrompt(specId, title, goal, task, acceptanceCriteria);
          lines.push('    {');
          lines.push(`        "id": ${toPyStringLiteral(task.id)},`);
          lines.push(`        "title": ${toPyStringLiteral(task.title)},`);
          lines.push(`        "role": ${toPyStringLiteral(task.role)},`);
          lines.push(`        "status": ${toPyStringLiteral(task.status)},`);
          lines.push(`        "dependsOn": ${toPyStringList(task.dependsOn)},`);
          lines.push(`        "files": ${toPyStringList(task.files)},`);
          lines.push(`        "prompt": ${toPyStringLiteral(prompt)},`);
          lines.push('    },');
        }
        lines.push(']');
        lines.push(`phase(${toPyStringLiteral(phaseTitle)})`);
        lines.push(
          `log(${toPyStringLiteral(`Wave ${wave.waveIndex}: dispatching ${wave.tasks.length} independent tasks in parallel (workspace=${useShareWorkspace ? 'share' : 'inherit'})`)})`,
        );
        lines.push(`wave_${wave.waveIndex}_results = await parallel(`);
        lines.push(`    ${varPrefix}_TASKS,`);
        lines.push('    lambda t: agent(');
        lines.push('        t["prompt"],');
        lines.push('        schema={');
        lines.push('            "type": "object",');
        lines.push('            "properties": {');
        lines.push('                "taskId": {"type": "string"},');
        lines.push('                "summary": {"type": "string"},');
        lines.push('                "filesTouched": {"type": "array", "items": {"type": "string"}},');
        lines.push('            },');
        lines.push('            "required": ["taskId", "summary"],');
        lines.push('        },');
        lines.push('        role=t["role"],');
        lines.push(`        workspace=${workspaceLiteral},`);
        lines.push(`        model=${modelLiteral},`);
        lines.push('    ),');
        lines.push(')');
      } else {
        const task = wave.tasks[0]!;
        const modelLiteral = toPyStringLiteral(modelTier);
        const prompt = buildTaskPrompt(specId, title, goal, task, acceptanceCriteria);
        const phaseTitle = `Wave ${wave.waveIndex}: ${task.id} — ${task.title}`;

        lines.push(`${varPrefix}_TASK = {`);
        lines.push(`    "id": ${toPyStringLiteral(task.id)},`);
        lines.push(`    "title": ${toPyStringLiteral(task.title)},`);
        lines.push(`    "role": ${toPyStringLiteral(task.role)},`);
        lines.push(`    "status": ${toPyStringLiteral(task.status)},`);
        lines.push(`    "dependsOn": ${toPyStringList(task.dependsOn)},`);
        lines.push(`    "files": ${toPyStringList(task.files)},`);
        lines.push(`    "prompt": ${toPyStringLiteral(prompt)},`);
        lines.push('}');
        lines.push(`phase(${toPyStringLiteral(phaseTitle)})`);
        lines.push(
          `log(${toPyStringLiteral(`Wave ${wave.waveIndex}: executing single task ${task.id} (workspace=inherit)`)})`,
        );
        lines.push(`wave_${wave.waveIndex}_result = await agent(`);
        lines.push(`    ${varPrefix}_TASK["prompt"],`);
        lines.push('    schema={');
        lines.push('        "type": "object",');
        lines.push('        "properties": {');
        lines.push('            "taskId": {"type": "string"},');
        lines.push('            "summary": {"type": "string"},');
        lines.push('            "filesTouched": {"type": "array", "items": {"type": "string"}},');
        lines.push('        },');
        lines.push('        "required": ["taskId", "summary"],');
        lines.push('    },');
        lines.push(`    role=${varPrefix}_TASK["role"],`);
        lines.push('    workspace="inherit",');
        lines.push(`    model=${modelLiteral},`);
        lines.push(')');
      }
    }
  }

  if (includeReviewGate) {
    const blindPrompt = [
      `Perform a zero-history-bias read-only Stage 1 & Stage 2 audit for Spec "${title}" (${specId}).`,
      `Goal: ${goal}`,
      acceptanceCriteria.length > 0
        ? `Acceptance criteria:\n${acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`
        : 'Verify implementation correctness, scope adherence, edge cases, and test coverage directly from disk.',
      'Return PASS or CHANGES_REQUESTED with concrete file:line evidence.',
    ].join('\n');

    const securityPrompt = [
      `Perform an independent read-only security audit for Spec "${title}" (${specId}).`,
      'Inspect changed files for path/symlink containment, command/argument injection, secret/<private> leakage, XSS/HTML safety, ReDoS, and privilege boundaries.',
      'Return PASS or RISK_FOUND with Critical/High/Medium/Low severity and concrete file:line proof.',
    ].join('\n');

    lines.push('');
    lines.push(`BLIND_REVIEW_PROMPT = ${toPyStringLiteral(blindPrompt)}`);
    lines.push(`SECURITY_AUDIT_PROMPT = ${toPyStringLiteral(securityPrompt)}`);
    lines.push(`phase(${toPyStringLiteral('Blind Review & Security Audit')})`);
    lines.push(
      `log(${toPyStringLiteral('Dispatching read-only nov-blind-reviewer and nov-security-auditor subagents in parallel')})`,
    );
    lines.push('review_gate_results = await parallel(');
    lines.push('    ["nov-blind-reviewer", "nov-security-auditor"],');
    lines.push('    lambda auditor: (');
    lines.push('        agent(');
    lines.push('            BLIND_REVIEW_PROMPT,');
    lines.push('            schema={"type": "string"},');
    lines.push('            role="Blind Spec & Code Reviewer",');
    lines.push('            type_name="nov-blind-reviewer",');
    lines.push('            workspace="inherit",');
    lines.push(`            model=${toPyStringLiteral(modelTier)},`);
    lines.push('        )');
    lines.push('        if auditor == "nov-blind-reviewer"');
    lines.push('        else agent(');
    lines.push('            SECURITY_AUDIT_PROMPT,');
    lines.push('            schema={"type": "string"},');
    lines.push('            role="Read-Only Security Auditor",');
    lines.push('            type_name="nov-security-auditor",');
    lines.push('            workspace="inherit",');
    lines.push(`            model=${toPyStringLiteral(modelTier)},`);
    lines.push('        )');
    lines.push('    ),');
    lines.push(')');
  }

  if (includeVerifyGate) {
    lines.push('');
    lines.push(`phase(${toPyStringLiteral('Verify Gate Handoff')})`);
    lines.push(
      `log(${toPyStringLiteral(
        `Verify Gate Handoff for ${specId}: run typecheck, targeted tests, and verify_run_checks (${acceptanceCriteria.length} acceptance criterion/criteria) before marking the spec completed.`,
      )})`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Pure read-only compiler that transforms a Spec Document's Task DAG into
 * native Antigravity `/run-workflow` Python orchestration and `/swarm` blueprint JSON.
 *
 * Strictly rejects unknown dependencies and dependency cycles without producing deadlocked scripts,
 * strips `<private>` blocks and redacts secrets linearly, and safely encodes all Python string literals.
 */
export function compileSpecToWorkflow(
  spec: SpecDocument,
  options?: SpecCompileOptions,
): SpecWorkflowCompilationResult {
  const target = normalizeTarget(options?.target);
  const includeReviewGate = options?.includeReviewGate !== false;
  const includeVerifyGate = options?.includeVerifyGate !== false;
  const useShareWorkspace = options?.useShareWorkspace !== false;
  const modelTier = normalizeModelTier(options?.modelTier);
  const includeCompleted = options?.includeCompleted === true;

  const allTasks = Array.isArray(spec.tasks) ? spec.tasks : [];

  const safeStatus: SpecStatus =
    typeof spec.status === 'string' && VALID_SPEC_STATUSES.has(spec.status as SpecStatus)
      ? (spec.status as SpecStatus)
      : 'draft';
  const safeMode: SpecMode =
    typeof spec.mode === 'string' && VALID_SPEC_MODES.has(spec.mode as SpecMode)
      ? (spec.mode as SpecMode)
      : 'full';
  const safeRevision =
    typeof spec.revision === 'number' && Number.isInteger(spec.revision) && spec.revision >= 1
      ? spec.revision
      : 1;
  const safeSpecId = toPyCommentSafe(String(spec.id ?? 'spec'), 80) || 'spec';
  const safeSpec: SpecDocument = {
    ...spec,
    id: safeSpecId,
    status: safeStatus,
    mode: safeMode,
    revision: safeRevision,
  };

  // 1. Validate full Task DAG integrity (unknown deps, duplicate/invalid IDs, self-cycles, multi-hop cycles)
  const dagCheck = validateTaskDag(allTasks);
  if (!dagCheck.valid) {
    const details = inspectDagFailureDetails(allTasks);
    return {
      ok: false,
      specId: safeSpecId,
      error: dagCheck.error,
      ...(details.cycleTaskIds ? { cycleTaskIds: details.cycleTaskIds } : {}),
      ...(details.unknownDependencies ? { unknownDependencies: details.unknownDependencies } : {}),
    };
  }

  // 2. Redact all untrusted Spec text linearly (strip <private> + high-risk secrets)
  const tracker: RedactionTracker = { hadRedaction: false };
  const safeTitle = redactField(String(safeSpec.title ?? ''), tracker);
  const safeGoal = redactField(String(safeSpec.goal ?? ''), tracker);
  const safeAcceptanceCriteria = (Array.isArray(safeSpec.acceptanceCriteria) ? safeSpec.acceptanceCriteria : []).map(
    (item) => redactField(String(item ?? ''), tracker),
  );

  // 3. Filter active tasks to compile (skip `done` tasks unless includeCompleted=true)
  const activeTasks = includeCompleted
    ? [...allTasks]
    : allTasks.filter((t) => t.status !== 'done');
  const skippedCompletedTasks = allTasks.length - activeTasks.length;

  const activeById = new Map<string, SpecTask>(activeTasks.map((t) => [t.id, t]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const task of activeTasks) {
    inDegree.set(task.id, 0);
    dependents.set(task.id, []);
  }

  for (const task of activeTasks) {
    const seen = new Set<string>();
    for (const dep of task.dependsOn) {
      if (!activeById.has(dep) || seen.has(dep)) continue;
      seen.add(dep);
      dependents.get(dep)!.push(task.id);
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    }
  }

  // 4. Kahn level-by-level topological wave grouping with deterministic task ID ordering
  let currentWaveIds = activeTasks
    .filter((t) => (inDegree.get(t.id) ?? 0) === 0)
    .map((t) => t.id)
    .sort(compareStable);

  const waves: SpecWorkflowWave[] = [];
  let waveIndex = 1;
  let processed = 0;

  while (currentWaveIds.length > 0) {
    const nextWaveSet = new Set<string>();
    const parallelizable = currentWaveIds.length >= 2;
    const suggestedWorkspace: 'share' | 'inherit' =
      parallelizable && useShareWorkspace ? 'share' : 'inherit';

    const waveTasks: SpecWorkflowWaveTask[] = [];
    for (const id of currentWaveIds) {
      processed += 1;
      const task = activeById.get(id)!;
      const redactedTitle = redactField(task.title, tracker);
      const redactedDesc =
        task.description !== undefined ? redactField(task.description, tracker) : undefined;
      const redactedNote =
        task.note !== undefined ? redactField(task.note, tracker) : undefined;
      const files = extractTaskFileHints(
        task as SpecTask & { files?: unknown },
        redactedTitle,
        redactedDesc,
        redactedNote,
        tracker,
      );
      const role = inferTaskRole(task.id, redactedTitle, redactedDesc);

      waveTasks.push({
        id: task.id,
        title: redactedTitle,
        ...(redactedDesc !== undefined ? { description: redactedDesc } : {}),
        status: task.status,
        dependsOn: [...task.dependsOn].sort(compareStable),
        files,
        role,
        suggestedWorkspace,
      });

      for (const nextId of dependents.get(id) ?? []) {
        const nextDeg = (inDegree.get(nextId) ?? 0) - 1;
        inDegree.set(nextId, nextDeg);
        if (nextDeg === 0) {
          nextWaveSet.add(nextId);
        }
      }
    }

    waves.push({
      waveIndex,
      parallelizable,
      suggestedWorkspace,
      tasks: waveTasks,
    });

    currentWaveIds = Array.from(nextWaveSet).sort(compareStable);
    waveIndex += 1;
  }

  // Defensive secondary cycle guard
  if (processed !== activeTasks.length) {
    const remainingIds = activeTasks
      .filter((t) => (inDegree.get(t.id) ?? 0) > 0)
      .map((t) => t.id)
      .sort(compareStable);
    return {
      ok: false,
      specId: spec.id,
      error: `Dependency cycle detected in task DAG: ${remainingIds.join(', ')}.`,
      cycleTaskIds: remainingIds,
    };
  }

  // 5. Assemble audit warnings
  const writeLockActive = isSpecWriteLockActive(safeSpec);
  const warnings: string[] = [];

  if (safeStatus === 'draft') {
    warnings.push(
      writeLockActive
        ? 'Spec is in DRAFT status with write lock active. Approve the spec in agy-NOV Spec Flow before running workspace-mutating workflow phases.'
        : 'Spec is still in DRAFT status. Review and approve the spec before executing implementation waves.',
    );
  } else if (safeStatus === 'archived') {
    warnings.push('Spec is ARCHIVED. Confirm that re-running its workflow is intentional.');
  }

  const unresolvedCount = Array.isArray(spec.annotations)
    ? spec.annotations.filter((a) => !a.resolved).length
    : 0;
  if (unresolvedCount > 0) {
    warnings.push(
      `Spec has ${unresolvedCount} unresolved inline plan review annotation(s). Address open review feedback before execution.`,
    );
  }

  const blockedTasks = activeTasks.filter((t) => t.status === 'blocked').map((t) => t.id).sort(compareStable);
  if (blockedTasks.length > 0) {
    warnings.push(
      `Task(s) marked blocked: ${blockedTasks.join(', ')}. Clear blockers before dispatching dependent waves.`,
    );
  }

  if (allTasks.length === 0) {
    warnings.push('Spec has no Task DAG items defined; compiled artifact contains handoff gates only.');
  } else if (!includeCompleted && activeTasks.length === 0) {
    warnings.push(
      `All ${allTasks.length} task(s) are already done; emitting review/verify handoff only. Set includeCompleted=true to compile all tasks.`,
    );
  }

  if (tracker.hadRedaction) {
    warnings.push(
      'Sensitive tokens or <private> blocks were automatically redacted from compiled workflow artifacts.',
    );
  }

  const parallelWaveCount = waves.filter((w) => w.parallelizable).length;

  // 6. Emit requested target artifacts
  const shouldEmitWorkflow = target === 'workflow' || target === 'both';
  const shouldEmitSwarm = target === 'swarm' || target === 'both';

  const workflowPython = shouldEmitWorkflow
    ? buildWorkflowPython({
        specId: safeSpecId,
        title: safeTitle,
        status: safeStatus,
        mode: safeMode,
        revision: safeRevision,
        writeLockActive,
        goal: safeGoal,
        acceptanceCriteria: safeAcceptanceCriteria,
        waves,
        totalTasks: allTasks.length,
        compiledTasks: activeTasks.length,
        skippedCompletedTasks,
        includeReviewGate,
        includeVerifyGate,
        useShareWorkspace,
        modelTier,
        warnings,
      })
    : undefined;

  const swarmPlan: SpecSwarmPlan | undefined = shouldEmitSwarm
    ? {
        schemaVersion: 1,
        generator: 'agy-nov/spec-compiler',
        specId: safeSpecId,
        title: safeTitle,
        status: safeStatus,
        mode: safeMode,
        revision: safeRevision,
        writeLockActive,
        goal: safeGoal,
        waves: waves.map((wave) => ({
          waveIndex: wave.waveIndex,
          parallelizable: wave.parallelizable,
          tasks: wave.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            ...(task.description !== undefined ? { description: task.description } : {}),
            status: task.status,
            dependsOn: [...task.dependsOn],
            files: [...task.files],
            role: task.role,
            suggestedWorkspace: task.suggestedWorkspace,
          })),
        })),
        gates: {
          blindReview: includeReviewGate,
          securityAudit: includeReviewGate,
          verifyStopGate: includeVerifyGate,
        },
        acceptanceCriteria: [...safeAcceptanceCriteria],
        warnings: [...warnings],
      }
    : undefined;

  const swarmPlanJson = swarmPlan ? JSON.stringify(swarmPlan, null, 2) : undefined;

  return {
    ok: true,
    target,
    specId: safeSpecId,
    title: safeTitle,
    status: safeStatus,
    mode: safeMode,
    revision: safeRevision,
    writeLockActive,
    totalTasks: allTasks.length,
    compiledTasks: activeTasks.length,
    skippedCompletedTasks,
    waveCount: waves.length,
    parallelWaveCount,
    waves,
    warnings,
    ...(workflowPython !== undefined ? { workflowPython } : {}),
    ...(swarmPlan !== undefined ? { swarmPlan } : {}),
    ...(swarmPlanJson !== undefined ? { swarmPlanJson } : {}),
  };
}

/**
 * Pure read-only convenience helper to compile the active (or explicitly selected) Spec
 * directly from disk without creating directories or writing any files.
 *
 * Accepts either the spec module data directory (`.../modules/spec`) or the root agy-NOV
 * data directory (`.../` containing `modules/spec/state.json`).
 */
export function compileActiveSpecWorkflowReadOnly(
  dataDir: string,
  specId?: string,
  options?: SpecCompileOptions,
): SpecWorkflowCompilationResult {
  let state = loadSpecStateReadOnly(dataDir, { preserveRawTaskDeps: true });
  if (state.specs.length === 0) {
    const nestedModuleDir = path.join(dataDir, 'modules', 'spec');
    const nestedState = loadSpecStateReadOnly(nestedModuleDir, { preserveRawTaskDeps: true });
    if (nestedState.specs.length > 0) {
      state = nestedState;
    }
  }

  const targetSpecId = specId?.trim() || state.activeSpecId || undefined;
  if (!targetSpecId) {
    return {
      ok: false,
      error: 'No specId specified and no active spec exists.',
    };
  }

  const spec = state.specs.find((s) => s.id === targetSpecId);
  if (!spec) {
    return {
      ok: false,
      specId: targetSpecId,
      error: `Spec not found: "${targetSpecId}".`,
    };
  }

  return compileSpecToWorkflow(spec, options);
}
