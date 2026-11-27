import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getModuleDataDir } from '../../core/config.js';
import { atomicWriteJson } from '../../core/utils.js';
import { MemoryStore, redactSecrets, stripPrivateTags } from '../mem/store.js';
import type { MemoryItem } from '../mem/types.js';

export type SpecStatus = 'draft' | 'approved' | 'completed' | 'archived';
export type SpecTaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked';
export type SpecActor = 'user' | 'model';
export type SpecMode = 'full' | 'delta';
export type SpecDeltaKind = 'added' | 'modified' | 'removed';
export type SpecAnnotationKind = 'comment' | 'strike' | 'replace';

export interface SpecDeltaItem {
  id: string;
  kind: SpecDeltaKind;
  area?: string;
  text: string;
}

export interface SpecDeltaItemInput {
  id?: string;
  kind: SpecDeltaKind;
  area?: string;
  text: string;
}

export interface SpecRevisionEntry {
  revision: number;
  planMarkdown: string;
  updatedAt: string;
  summary?: string;
}

export interface SpecPlanAnnotation {
  id: string;
  revision: number;
  lineStart: number;
  lineEnd: number;
  kind: SpecAnnotationKind;
  note: string;
  suggestedText?: string;
  resolved: boolean;
  createdAt: string;
  resolvedAt?: string;
}

export interface SpecRevisionDiffHunk {
  type: 'same' | 'add' | 'del';
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface SpecRevisionDiffResult {
  addedLines: number;
  removedLines: number;
  degraded: boolean;
  hunks: SpecRevisionDiffHunk[];
}

export interface SpecTask {
  id: string;
  title: string;
  description?: string;
  dependsOn: string[];
  status: SpecTaskStatus;
  note?: string;
  updatedAt: string;
}

export interface SpecTaskView extends SpecTask {
  computedState: 'ready' | 'waiting_deps' | 'in_progress' | 'done' | 'blocked';
  unmetDeps: string[];
  depth: number;
}

export interface SpecDocument {
  id: string;
  title: string;
  goal: string;
  mode: SpecMode;
  deltaItems: SpecDeltaItem[];
  planMarkdown: string;
  revision: number;
  revisions: SpecRevisionEntry[];
  annotations: SpecPlanAnnotation[];
  archivedMemoryId?: string;
  acceptanceCriteria: string[];
  planSteps: string[];
  status: SpecStatus;
  enforcePlanBeforeWrite: boolean;
  requireUiApproval: boolean;
  approvedBy?: 'user' | 'model';
  approvedAt?: string;
  approvalNote?: string;
  tasks: SpecTask[];
  createdAt: string;
  updatedAt: string;
}

export type SpecDocumentView = Omit<SpecDocument, 'tasks'> & {
  tasks: SpecTaskView[];
  unresolvedAnnotations: number;
};

export interface SpecSummaryItem {
  id: string;
  title: string;
  mode: SpecMode;
  revision: number;
  unresolvedAnnotations: number;
  archivedMemoryId?: string;
  status: SpecStatus;
  enforcePlanBeforeWrite: boolean;
  requireUiApproval: boolean;
  totalTasks: number;
  doneTasks: number;
  readyTasks: number;
  updatedAt: string;
}

export interface SpecStateView {
  mode: 'live' | 'demo';
  activeSpecId: string | null;
  activeSpec: SpecDocumentView | null;
  specs: SpecSummaryItem[];
  writeLockActive: boolean;
}

export interface SpecStateFile {
  schemaVersion: 1;
  activeSpecId: string | null;
  specs: SpecDocument[];
  updatedAt: string;
}

export interface SpecTaskInput {
  id: string;
  title: string;
  description?: string;
  dependsOn?: string[];
  status?: SpecTaskStatus;
  note?: string;
}

export interface SaveSpecInput {
  id?: string;
  title: string;
  goal: string;
  mode?: SpecMode;
  deltaItems?: SpecDeltaItemInput[];
  planMarkdown?: string;
  revisionSummary?: string;
  acceptanceCriteria?: string[];
  planSteps?: string[];
  enforcePlanBeforeWrite?: boolean;
  requireUiApproval?: boolean;
  tasks?: SpecTaskInput[];
  setActive?: boolean;
}

export interface SetSpecStatusInput {
  specId?: string;
  status: SpecStatus;
  enforcePlanBeforeWrite?: boolean;
  requireUiApproval?: boolean;
  approvalNote?: string;
  setActive?: boolean;
}

export interface UpdateSpecTaskInput {
  specId?: string;
  taskId: string;
  status: SpecTaskStatus;
  note?: string;
}

export interface AddSpecAnnotationInput {
  specId?: string;
  lineStart: number;
  lineEnd: number;
  kind: SpecAnnotationKind;
  note?: string;
  suggestedText?: string;
  revision?: number;
}

export interface ResolveSpecAnnotationInput {
  specId?: string;
  annotationId: string;
  resolved?: boolean;
}

export interface DeleteSpecAnnotationInput {
  specId?: string;
  annotationId: string;
}

export interface ArchiveSpecToMemoryOptions {
  isDemo?: boolean;
  demoState?: SpecStateFile | null;
  workspacePath?: string;
  pinned?: boolean;
  note?: string;
}

export interface ArchiveSpecToMemoryResult {
  ok: true;
  memoryId: string;
  memoryTitle: string;
  tags: string[];
  demoSimulated: boolean;
  memory?: MemoryItem;
  spec: SpecDocumentView;
  state: SpecStateFile;
}

export const SPEC_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;
export const SPEC_TASK_ID_RE = /^[a-zA-Z0-9._-]{1,48}$/;
export const SPEC_DELTA_ID_RE = /^[a-zA-Z0-9._-]{1,48}$/;
export const SPEC_ANNOTATION_ID_RE = /^[a-zA-Z0-9._-]{1,48}$/;
export const MAX_SPECS = 50;
export const MAX_TASKS_PER_SPEC = 100;
export const MAX_CRITERIA_ITEMS = 50;
export const MAX_PLAN_STEPS = 80;
export const MAX_DELTA_ITEMS = 60;
export const MAX_PLAN_MARKDOWN_CHARS = 24_000;
export const MAX_REVISIONS_PER_SPEC = 8;
export const MAX_ANNOTATIONS_PER_SPEC = 100;
export const MAX_LCS_DIFF_LINES = 600;

const VALID_SPEC_STATUSES: ReadonlySet<SpecStatus> = new Set([
  'draft',
  'approved',
  'completed',
  'archived',
]);

const VALID_TASK_STATUSES: ReadonlySet<SpecTaskStatus> = new Set([
  'pending',
  'in_progress',
  'done',
  'blocked',
]);

const VALID_SPEC_MODES: ReadonlySet<SpecMode> = new Set(['full', 'delta']);

const VALID_DELTA_KINDS: ReadonlySet<SpecDeltaKind> = new Set([
  'added',
  'modified',
  'removed',
]);

const VALID_ANNOTATION_KINDS: ReadonlySet<SpecAnnotationKind> = new Set([
  'comment',
  'strike',
  'replace',
]);

function sanitizeSingleLine(input: string, maxLen: number): string {
  return input
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function sanitizeMultiline(input: string, maxLen: number): string {
  return input
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .trim()
    .slice(0, maxLen);
}

function sanitizeOptionalMultiline(input: unknown, maxLen: number): string | undefined {
  if (typeof input !== 'string') return undefined;
  const cleaned = sanitizeMultiline(input, maxLen);
  return cleaned.length > 0 ? cleaned : undefined;
}

function sanitizeStringList(raw: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const cleaned = sanitizeSingleLine(item, maxLen);
    if (cleaned) {
      out.push(cleaned);
      if (out.length >= maxItems) break;
    }
  }
  return out;
}

export function sanitizePlanMarkdown(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .trimEnd()
    .slice(0, MAX_PLAN_MARKDOWN_CHARS);
}

export function splitPlanMarkdownLines(markdown: string): string[] {
  if (!markdown) return [];
  return markdown.replace(/\r\n?/g, '\n').split('\n');
}

function createDeltaItemId(index: number, existingIds: ReadonlySet<string>): string {
  for (let i = 0; i < 16; i += 1) {
    const candidate = `delta-${index + 1}-${crypto.randomBytes(2).toString('hex')}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `delta-${index + 1}-${Date.now().toString(36)}`;
}

export function sanitizeDeltaItems(raw: unknown): SpecDeltaItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SpecDeltaItem[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < raw.length && out.length < MAX_DELTA_ITEMS; i += 1) {
    const entry = raw[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const kind =
      typeof obj.kind === 'string' && VALID_DELTA_KINDS.has(obj.kind as SpecDeltaKind)
        ? (obj.kind as SpecDeltaKind)
        : null;
    if (!kind) continue;
    const text = typeof obj.text === 'string' ? sanitizeSingleLine(obj.text, 500) : '';
    if (!text) continue;
    const area =
      typeof obj.area === 'string' && sanitizeSingleLine(obj.area, 80)
        ? sanitizeSingleLine(obj.area, 80)
        : undefined;
    const rawId = typeof obj.id === 'string' ? obj.id.trim() : '';
    const id =
      rawId && SPEC_DELTA_ID_RE.test(rawId) && !seenIds.has(rawId)
        ? rawId
        : createDeltaItemId(out.length, seenIds);
    seenIds.add(id);
    out.push({
      id,
      kind,
      ...(area ? { area } : {}),
      text,
    });
  }
  return out;
}

export function synthesizePlanMarkdown(input: {
  title: string;
  mode: SpecMode;
  goal: string;
  deltaItems: ReadonlyArray<SpecDeltaItem>;
  acceptanceCriteria: ReadonlyArray<string>;
  planSteps: ReadonlyArray<string>;
  tasks?: ReadonlyArray<{ id: string; title: string; dependsOn: ReadonlyArray<string> }>;
}): string {
  const lines: string[] = [];
  lines.push(`# ${input.title}`);
  lines.push(
    input.mode === 'delta' ? '> Mode: BROWNFIELD DELTA SPEC' : '> Mode: FULL SPEC',
  );
  lines.push('');
  lines.push('## Goal');
  lines.push(input.goal);

  if (input.deltaItems.length > 0) {
    lines.push('');
    lines.push('## Behavioral Delta');
    for (const item of input.deltaItems) {
      const areaPrefix = item.area ? `(${item.area}) ` : '';
      lines.push(`- [${item.kind.toUpperCase()}] ${areaPrefix}${item.text}`);
    }
  }

  if (input.planSteps.length > 0) {
    lines.push('');
    lines.push('## Implementation Plan');
    input.planSteps.forEach((step, idx) => {
      lines.push(`${idx + 1}. ${step}`);
    });
  }

  if (input.acceptanceCriteria.length > 0) {
    lines.push('');
    lines.push('## Acceptance Criteria');
    for (const criterion of input.acceptanceCriteria) {
      lines.push(`- [ ] ${criterion}`);
    }
  }

  if (input.tasks && input.tasks.length > 0) {
    lines.push('');
    lines.push('## Task DAG');
    for (const task of input.tasks) {
      const deps = task.dependsOn.length > 0 ? ` (depends on: ${task.dependsOn.join(', ')})` : '';
      lines.push(`- \`${task.id}\`: ${task.title}${deps}`);
    }
  }

  return sanitizePlanMarkdown(lines.join('\n'));
}

/**
 * Pure TypeScript line-level diff engine with O(N*M) LCS guardrails.
 * Uses exact DP LCS when line counts are within MAX_LCS_DIFF_LINES (600),
 * and degrades cleanly to O(N+M) linear prefix/middle/suffix block diff beyond limits.
 */
export function computePlanRevisionDiff(
  prevMarkdown: string,
  nextMarkdown: string,
): SpecRevisionDiffResult {
  const prevLines = splitPlanMarkdownLines(prevMarkdown);
  const nextLines = splitPlanMarkdownLines(nextMarkdown);

  if (prevLines.length === 0 && nextLines.length === 0) {
    return { addedLines: 0, removedLines: 0, degraded: false, hunks: [] };
  }

  let prefixLen = 0;
  const minLen = Math.min(prevLines.length, nextLines.length);
  while (prefixLen < minLen && prevLines[prefixLen] === nextLines[prefixLen]) {
    prefixLen += 1;
  }

  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    prevLines[prevLines.length - 1 - suffixLen] === nextLines[nextLines.length - 1 - suffixLen]
  ) {
    suffixLen += 1;
  }

  const hunks: SpecRevisionDiffHunk[] = [];
  for (let i = 0; i < prefixLen; i += 1) {
    hunks.push({
      type: 'same',
      oldLine: i + 1,
      newLine: i + 1,
      text: prevLines[i],
    });
  }

  const midPrevStart = prefixLen;
  const midPrevEnd = prevLines.length - suffixLen;
  const midNextStart = prefixLen;
  const midNextEnd = nextLines.length - suffixLen;
  const m = midPrevEnd - midPrevStart;
  const n = midNextEnd - midNextStart;

  let addedLines = 0;
  let removedLines = 0;
  let degraded = false;

  if (m > 0 || n > 0) {
    const canUseLcs =
      prevLines.length <= MAX_LCS_DIFF_LINES &&
      nextLines.length <= MAX_LCS_DIFF_LINES &&
      m * n <= MAX_LCS_DIFF_LINES * MAX_LCS_DIFF_LINES;

    if (canUseLcs && m > 0 && n > 0) {
      const cols = n + 1;
      const dp = new Int32Array((m + 1) * cols);

      for (let i = m - 1; i >= 0; i -= 1) {
        const aLine = prevLines[midPrevStart + i];
        const rowOffset = i * cols;
        const nextRowOffset = (i + 1) * cols;
        for (let j = n - 1; j >= 0; j -= 1) {
          if (aLine === nextLines[midNextStart + j]) {
            dp[rowOffset + j] = dp[nextRowOffset + j + 1] + 1;
          } else {
            const down = dp[nextRowOffset + j];
            const right = dp[rowOffset + j + 1];
            dp[rowOffset + j] = down >= right ? down : right;
          }
        }
      }

      let i = 0;
      let j = 0;
      while (i < m && j < n) {
        const aLine = prevLines[midPrevStart + i];
        const bLine = nextLines[midNextStart + j];
        if (aLine === bLine) {
          hunks.push({
            type: 'same',
            oldLine: midPrevStart + i + 1,
            newLine: midNextStart + j + 1,
            text: aLine,
          });
          i += 1;
          j += 1;
        } else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) {
          hunks.push({
            type: 'del',
            oldLine: midPrevStart + i + 1,
            text: aLine,
          });
          removedLines += 1;
          i += 1;
        } else {
          hunks.push({
            type: 'add',
            newLine: midNextStart + j + 1,
            text: bLine,
          });
          addedLines += 1;
          j += 1;
        }
      }

      while (i < m) {
        hunks.push({
          type: 'del',
          oldLine: midPrevStart + i + 1,
          text: prevLines[midPrevStart + i],
        });
        removedLines += 1;
        i += 1;
      }

      while (j < n) {
        hunks.push({
          type: 'add',
          newLine: midNextStart + j + 1,
          text: nextLines[midNextStart + j],
        });
        addedLines += 1;
        j += 1;
      }
    } else {
      if (m > 0 && n > 0 && !canUseLcs) {
        degraded = true;
      }
      for (let i = 0; i < m; i += 1) {
        hunks.push({
          type: 'del',
          oldLine: midPrevStart + i + 1,
          text: prevLines[midPrevStart + i],
        });
        removedLines += 1;
      }
      for (let j = 0; j < n; j += 1) {
        hunks.push({
          type: 'add',
          newLine: midNextStart + j + 1,
          text: nextLines[midNextStart + j],
        });
        addedLines += 1;
      }
    }
  }

  for (let s = 0; s < suffixLen; s += 1) {
    const oldIdx = midPrevEnd + s;
    const newIdx = midNextEnd + s;
    hunks.push({
      type: 'same',
      oldLine: oldIdx + 1,
      newLine: newIdx + 1,
      text: prevLines[oldIdx],
    });
  }

  return {
    addedLines,
    removedLines,
    degraded,
    hunks,
  };
}

function resolveRevisionMarkdown(spec: SpecDocument, revision: number): string | null {
  if (revision === spec.revision) {
    return spec.planMarkdown;
  }
  const found = spec.revisions.find((r) => r.revision === revision);
  return found ? found.planMarkdown : null;
}

export function diffSpecRevisions(
  spec: SpecDocument,
  fromRevision?: number,
  toRevision?: number,
):
  | {
      ok: true;
      specId: string;
      fromRevision: number;
      toRevision: number;
      availableRevisions: number[];
      diff: SpecRevisionDiffResult;
    }
  | { ok: false; error: string } {
  const revNumbers = Array.from(
    new Set([...spec.revisions.map((r) => r.revision), spec.revision]),
  ).sort((a, b) => a - b);

  const resolvedTo =
    typeof toRevision === 'number' && Number.isInteger(toRevision) ? toRevision : spec.revision;

  let resolvedFrom: number;
  if (typeof fromRevision === 'number' && Number.isInteger(fromRevision)) {
    resolvedFrom = fromRevision;
  } else {
    const priorRevs = revNumbers.filter((r) => r < resolvedTo);
    resolvedFrom = priorRevs.length > 0 ? priorRevs[priorRevs.length - 1] : resolvedTo;
  }

  const fromMd = resolveRevisionMarkdown(spec, resolvedFrom);
  if (fromMd === null) {
    return {
      ok: false,
      error: `Revision v${resolvedFrom} not found in spec "${spec.id}". Available: ${revNumbers.map((r) => `v${r}`).join(', ')}.`,
    };
  }
  const toMd = resolveRevisionMarkdown(spec, resolvedTo);
  if (toMd === null) {
    return {
      ok: false,
      error: `Revision v${resolvedTo} not found in spec "${spec.id}". Available: ${revNumbers.map((r) => `v${r}`).join(', ')}.`,
    };
  }

  return {
    ok: true,
    specId: spec.id,
    fromRevision: resolvedFrom,
    toRevision: resolvedTo,
    availableRevisions: revNumbers,
    diff: computePlanRevisionDiff(fromMd, toMd),
  };
}

export function buildAnnotationFeedbackPrompt(spec: SpecDocument | SpecDocumentView): string {
  const unresolved = spec.annotations
    .filter((a) => !a.resolved)
    .sort((a, b) => a.lineStart - b.lineStart || a.lineEnd - b.lineEnd || a.createdAt.localeCompare(b.createdAt));

  const lines: string[] = [
    `# Spec Plan Revision Request — "${spec.title}"`,
    `- Spec ID: \`${spec.id}\``,
    `- Mode: ${spec.mode === 'delta' ? 'Brownfield Delta Spec' : 'Full Spec'}`,
    `- Current Revision: v${spec.revision} -> Target Revision: v${spec.revision + 1}`,
    `- Unresolved Annotations: ${unresolved.length}`,
  ];

  if (unresolved.length === 0) {
    lines.push('');
    lines.push('There are currently no unresolved inline annotations on this plan.');
    return lines.join('\n');
  }

  const mdLines = splitPlanMarkdownLines(spec.planMarkdown);
  lines.push('');
  lines.push('## Inline Review Feedback');

  unresolved.forEach((ann, idx) => {
    const lineRange = ann.lineStart === ann.lineEnd ? `L${ann.lineStart}` : `L${ann.lineStart}-L${ann.lineEnd}`;
    const kindLabel =
      ann.kind === 'strike'
        ? 'STRIKE / CUT SCOPE'
        : ann.kind === 'replace'
          ? 'REPLACE SUGGESTION'
          : 'COMMENT';

    lines.push('');
    lines.push(`### ${idx + 1}. [${kindLabel}] ${lineRange} (ann: \`${ann.id}\`, on v${ann.revision})`);

    const startIdx = Math.max(0, ann.lineStart - 1);
    const endIdx = Math.min(mdLines.length, ann.lineEnd);
    if (startIdx < endIdx) {
      lines.push('Original excerpt:');
      lines.push('```markdown');
      for (let i = startIdx; i < endIdx; i += 1) {
        lines.push(`${i + 1} | ${mdLines[i]}`);
      }
      lines.push('```');
    }

    if (ann.note) {
      lines.push(`Reviewer note: ${ann.note}`);
    }
    if (ann.kind === 'strike') {
      lines.push('Action: Remove or cut the struck scope from the plan.');
    }
    if (ann.kind === 'replace' && ann.suggestedText) {
      lines.push('Suggested replacement:');
      lines.push('```markdown');
      lines.push(ann.suggestedText);
      lines.push('```');
    }
  });

  if (spec.deltaItems.length > 0) {
    lines.push('');
    lines.push('## Current Behavioral Delta Contract');
    for (const item of spec.deltaItems) {
      const area = item.area ? ` (${item.area})` : '';
      lines.push(`- [${item.kind.toUpperCase()}]${area} ${item.text}`);
    }
  }

  lines.push('');
  lines.push('## Required Next Step');
  lines.push(
    `Address all ${unresolved.length} inline annotation(s) above and publish revision v${spec.revision + 1} by calling \`spec_create_or_update\` with \`id: "${spec.id}"\`, updated \`planMarkdown\`, and a concise \`revisionSummary\`. Wait for user review before requesting approval.`,
  );

  return lines.join('\n');
}

export function getSpecStatePath(moduleDataDir: string): string {
  return path.join(moduleDataDir, 'state.json');
}

export function createEmptySpecState(): SpecStateFile {
  return {
    schemaVersion: 1,
    activeSpecId: null,
    specs: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export function createSpecId(title: string, existingIds: ReadonlySet<string>): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  const base = slug ? `spec-${slug}` : 'spec';
  for (let i = 0; i < 16; i += 1) {
    const suffix = crypto.randomBytes(3).toString('hex');
    const candidate = `${base}-${suffix}`.slice(0, 64);
    if (SPEC_ID_RE.test(candidate) && !existingIds.has(candidate)) {
      return candidate;
    }
  }
  return `spec-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
}

export interface DagValidationResult {
  valid: true;
  orderedIds: string[];
  depths: Map<string, number>;
}

export interface DagValidationError {
  valid: false;
  error: string;
}

function findCyclePath(
  cycleNodeIds: ReadonlySet<string>,
  dependsOnMap: ReadonlyMap<string, string[]>,
): string[] {
  const state = new Map<string, 0 | 1 | 2>(); // 0=unvisited, 1=visiting, 2=visited
  const stack: string[] = [];

  const dfs = (node: string): string[] | null => {
    state.set(node, 1);
    stack.push(node);
    const deps = dependsOnMap.get(node) ?? [];
    for (const dep of deps) {
      if (!cycleNodeIds.has(dep)) continue;
      const st = state.get(dep) ?? 0;
      if (st === 1) {
        const idx = stack.indexOf(dep);
        return [...stack.slice(idx), dep];
      }
      if (st === 0) {
        const found = dfs(dep);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(node, 2);
    return null;
  };

  for (const node of cycleNodeIds) {
    if ((state.get(node) ?? 0) === 0) {
      const cycle = dfs(node);
      if (cycle) return cycle;
    }
  }
  return [...cycleNodeIds];
}

/**
 * Validates task IDs, uniqueness, dependency references, and runs Kahn's algorithm
 * to guarantee an acyclic DAG and compute topological depths (root = 0).
 */
export function validateTaskDag(
  tasks: ReadonlyArray<{ id: string; dependsOn: ReadonlyArray<string> }>,
): DagValidationResult | DagValidationError {
  if (tasks.length > MAX_TASKS_PER_SPEC) {
    return {
      valid: false,
      error: `Spec cannot contain more than ${MAX_TASKS_PER_SPEC} tasks.`,
    };
  }

  const idSet = new Set<string>();
  const dependsOnMap = new Map<string, string[]>();

  for (const task of tasks) {
    if (typeof task.id !== 'string' || !SPEC_TASK_ID_RE.test(task.id)) {
      return {
        valid: false,
        error: `Invalid task id "${String(task.id)}": must match ${SPEC_TASK_ID_RE.source}.`,
      };
    }
    if (idSet.has(task.id)) {
      return {
        valid: false,
        error: `Duplicate task id "${task.id}". Task IDs must be unique within a spec.`,
      };
    }
    idSet.add(task.id);
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const task of tasks) {
    inDegree.set(task.id, 0);
    dependents.set(task.id, []);
  }

  for (const task of tasks) {
    const dedupDeps: string[] = [];
    const seenDeps = new Set<string>();
    for (const rawDep of task.dependsOn) {
      if (typeof rawDep !== 'string' || !rawDep.trim()) {
        return {
          valid: false,
          error: `Task "${task.id}" contains an empty dependency ID.`,
        };
      }
      const dep = rawDep;
      if (dep === task.id) {
        return {
          valid: false,
          error: `Task "${task.id}" cannot depend on itself (self-cycle detected).`,
        };
      }
      if (!idSet.has(dep)) {
        return {
          valid: false,
          error: `Task "${task.id}" depends on unknown task "${dep}".`,
        };
      }
      if (!seenDeps.has(dep)) {
        seenDeps.add(dep);
        dedupDeps.push(dep);
      }
    }
    dependsOnMap.set(task.id, dedupDeps);
    inDegree.set(task.id, dedupDeps.length);
    for (const dep of dedupDeps) {
      dependents.get(dep)!.push(task.id);
    }
  }

  // Kahn's topological sort + longest-path depth calculation
  const queue: string[] = [];
  const depths = new Map<string, number>();

  for (const task of tasks) {
    if ((inDegree.get(task.id) ?? 0) === 0) {
      queue.push(task.id);
      depths.set(task.id, 0);
    }
  }

  const orderedIds: string[] = [];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    orderedIds.push(current);
    const currentDepth = depths.get(current) ?? 0;

    for (const next of dependents.get(current) ?? []) {
      const prevDepth = depths.get(next) ?? 0;
      if (currentDepth + 1 > prevDepth) {
        depths.set(next, currentDepth + 1);
      }
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) {
        queue.push(next);
      }
    }
  }

  if (orderedIds.length !== tasks.length) {
    const remainingNodes = new Set<string>(
      tasks.filter((t) => (inDegree.get(t.id) ?? 0) > 0).map((t) => t.id),
    );
    const cyclePath = findCyclePath(remainingNodes, dependsOnMap);
    return {
      valid: false,
      error: `Dependency cycle detected in task DAG: ${cyclePath.join(' -> ')}.`,
    };
  }

  return {
    valid: true,
    orderedIds,
    depths,
  };
}

export function computeSpecTaskViews(tasks: ReadonlyArray<SpecTask>): SpecTaskView[] {
  const dag = validateTaskDag(tasks);
  const depths = dag.valid ? dag.depths : new Map<string, number>();
  const taskMap = new Map<string, SpecTask>();
  for (const task of tasks) {
    taskMap.set(task.id, task);
  }

  return tasks.map((task) => {
    const unmetDeps = task.dependsOn.filter((depId) => taskMap.get(depId)?.status !== 'done');
    let computedState: SpecTaskView['computedState'];
    if (task.status === 'done') {
      computedState = 'done';
    } else if (task.status === 'in_progress') {
      computedState = 'in_progress';
    } else if (task.status === 'blocked') {
      computedState = 'blocked';
    } else {
      computedState = unmetDeps.length === 0 ? 'ready' : 'waiting_deps';
    }

    return {
      ...task,
      dependsOn: [...task.dependsOn],
      computedState,
      unmetDeps,
      depth: depths.get(task.id) ?? 0,
    };
  });
}

export function buildSpecDocumentView(spec: SpecDocument): SpecDocumentView {
  const unresolvedAnnotations = spec.annotations.reduce(
    (acc, ann) => acc + (ann.resolved ? 0 : 1),
    0,
  );
  return {
    id: spec.id,
    title: spec.title,
    goal: spec.goal,
    mode: spec.mode,
    deltaItems: spec.deltaItems.map((d) => ({ ...d })),
    planMarkdown: spec.planMarkdown,
    revision: spec.revision,
    revisions: spec.revisions.map((r) => ({ ...r })),
    annotations: spec.annotations.map((a) => ({ ...a })),
    unresolvedAnnotations,
    ...(spec.archivedMemoryId !== undefined ? { archivedMemoryId: spec.archivedMemoryId } : {}),
    acceptanceCriteria: [...spec.acceptanceCriteria],
    planSteps: [...spec.planSteps],
    status: spec.status,
    enforcePlanBeforeWrite: spec.enforcePlanBeforeWrite,
    requireUiApproval: spec.requireUiApproval,
    ...(spec.approvedBy !== undefined ? { approvedBy: spec.approvedBy } : {}),
    ...(spec.approvedAt !== undefined ? { approvedAt: spec.approvedAt } : {}),
    ...(spec.approvalNote !== undefined ? { approvalNote: spec.approvalNote } : {}),
    tasks: computeSpecTaskViews(spec.tasks),
    createdAt: spec.createdAt,
    updatedAt: spec.updatedAt,
  };
}

export function isSpecWriteLockActive(spec: SpecDocument | null | undefined): boolean {
  return Boolean(spec && spec.status === 'draft' && spec.enforcePlanBeforeWrite === true);
}

export function buildSpecStateView(
  state: SpecStateFile,
  mode: 'live' | 'demo' = 'live',
  requestedSpecId?: string,
): SpecStateView {
  const globalActiveSpec = state.activeSpecId
    ? state.specs.find((s) => s.id === state.activeSpecId) ?? null
    : null;
  const effectiveActiveSpecId = globalActiveSpec ? globalActiveSpec.id : null;

  const targetSpec = requestedSpecId
    ? state.specs.find((s) => s.id === requestedSpecId) ?? null
    : globalActiveSpec;

  const sortedSpecs = [...state.specs].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );

  const specs: SpecSummaryItem[] = sortedSpecs.map((spec) => {
    const taskViews = computeSpecTaskViews(spec.tasks);
    let doneTasks = 0;
    let readyTasks = 0;
    for (const task of taskViews) {
      if (task.status === 'done') doneTasks += 1;
      if (task.computedState === 'ready') readyTasks += 1;
    }
    const unresolvedAnnotations = spec.annotations.reduce(
      (acc, ann) => acc + (ann.resolved ? 0 : 1),
      0,
    );
    return {
      id: spec.id,
      title: spec.title,
      mode: spec.mode,
      revision: spec.revision,
      unresolvedAnnotations,
      ...(spec.archivedMemoryId !== undefined ? { archivedMemoryId: spec.archivedMemoryId } : {}),
      status: spec.status,
      enforcePlanBeforeWrite: spec.enforcePlanBeforeWrite,
      requireUiApproval: spec.requireUiApproval,
      totalTasks: taskViews.length,
      doneTasks,
      readyTasks,
      updatedAt: spec.updatedAt,
    };
  });

  return {
    mode,
    activeSpecId: effectiveActiveSpecId,
    activeSpec: targetSpec ? buildSpecDocumentView(targetSpec) : null,
    specs,
    writeLockActive: isSpecWriteLockActive(globalActiveSpec),
  };
}

function normalizeTaskFromDisk(raw: unknown, fallbackIso: string): SpecTask | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !SPEC_TASK_ID_RE.test(obj.id.trim())) return null;
  const id = obj.id.trim();
  const title = typeof obj.title === 'string' ? sanitizeSingleLine(obj.title, 200) : '';
  if (!title) return null;

  const status: SpecTaskStatus =
    typeof obj.status === 'string' && VALID_TASK_STATUSES.has(obj.status as SpecTaskStatus)
      ? (obj.status as SpecTaskStatus)
      : 'pending';

  const dependsOn: string[] = [];
  if (Array.isArray(obj.dependsOn)) {
    const seen = new Set<string>();
    for (const dep of obj.dependsOn) {
      if (typeof dep === 'string') {
        const cleanDep = dep.trim();
        if (cleanDep && cleanDep !== id && SPEC_TASK_ID_RE.test(cleanDep) && !seen.has(cleanDep)) {
          seen.add(cleanDep);
          dependsOn.push(cleanDep);
        }
      }
    }
  }

  const description = sanitizeOptionalMultiline(obj.description, 2000);
  const note = sanitizeOptionalMultiline(obj.note, 2000);

  return {
    id,
    title,
    ...(description !== undefined ? { description } : {}),
    dependsOn,
    status,
    ...(note !== undefined ? { note } : {}),
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : fallbackIso,
  };
}

function normalizeRevisionsFromDisk(
  raw: unknown,
  currentRevision: number,
  currentMarkdown: string,
  fallbackIso: string,
): SpecRevisionEntry[] {
  const byRev = new Map<number, SpecRevisionEntry>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const obj = item as Record<string, unknown>;
      const rev =
        typeof obj.revision === 'number' && Number.isInteger(obj.revision) && obj.revision >= 1
          ? obj.revision
          : null;
      if (rev === null) continue;
      const planMarkdown =
        typeof obj.planMarkdown === 'string' ? sanitizePlanMarkdown(obj.planMarkdown) : '';
      const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : fallbackIso;
      const summary =
        typeof obj.summary === 'string' && sanitizeSingleLine(obj.summary, 300)
          ? sanitizeSingleLine(obj.summary, 300)
          : undefined;
      byRev.set(rev, {
        revision: rev,
        planMarkdown,
        updatedAt,
        ...(summary ? { summary } : {}),
      });
    }
  }
  if (!byRev.has(currentRevision)) {
    byRev.set(currentRevision, {
      revision: currentRevision,
      planMarkdown: currentMarkdown,
      updatedAt: fallbackIso,
    });
  }
  return Array.from(byRev.values())
    .sort((a, b) => a.revision - b.revision)
    .slice(-MAX_REVISIONS_PER_SPEC);
}

function normalizeAnnotationsFromDisk(
  raw: unknown,
  defaultRevision: number,
  fallbackIso: string,
): SpecPlanAnnotation[] {
  if (!Array.isArray(raw)) return [];
  const out: SpecPlanAnnotation[] = [];
  const seenIds = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_ANNOTATIONS_PER_SPEC) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const rawId = typeof obj.id === 'string' ? obj.id.trim() : '';
    const id =
      rawId && SPEC_ANNOTATION_ID_RE.test(rawId) && !seenIds.has(rawId)
        ? rawId
        : `ann_${crypto.randomBytes(4).toString('hex')}`;
    if (seenIds.has(id)) continue;
    const kind =
      typeof obj.kind === 'string' && VALID_ANNOTATION_KINDS.has(obj.kind as SpecAnnotationKind)
        ? (obj.kind as SpecAnnotationKind)
        : null;
    if (!kind) continue;
    const lineStart =
      typeof obj.lineStart === 'number' && Number.isInteger(obj.lineStart) && obj.lineStart >= 1
        ? obj.lineStart
        : null;
    const lineEnd =
      typeof obj.lineEnd === 'number' && Number.isInteger(obj.lineEnd) && obj.lineEnd >= 1
        ? obj.lineEnd
        : null;
    if (lineStart === null || lineEnd === null || lineEnd < lineStart) continue;
    const revision =
      typeof obj.revision === 'number' && Number.isInteger(obj.revision) && obj.revision >= 1
        ? obj.revision
        : defaultRevision;
    const note = typeof obj.note === 'string' ? sanitizeMultiline(obj.note, 2000) : '';
    const suggestedText = sanitizeOptionalMultiline(obj.suggestedText, 6000);
    const resolved = Boolean(obj.resolved);
    const createdAt = typeof obj.createdAt === 'string' ? obj.createdAt : fallbackIso;
    const resolvedAt =
      resolved && typeof obj.resolvedAt === 'string' ? obj.resolvedAt : undefined;
    seenIds.add(id);
    out.push({
      id,
      revision,
      lineStart,
      lineEnd,
      kind,
      note,
      ...(suggestedText !== undefined ? { suggestedText } : {}),
      resolved,
      createdAt,
      ...(resolvedAt !== undefined ? { resolvedAt } : {}),
    });
  }
  return out;
}

function normalizeSpecFromDisk(raw: unknown): SpecDocument | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !SPEC_ID_RE.test(obj.id.trim())) return null;
  const id = obj.id.trim();
  const title = typeof obj.title === 'string' ? sanitizeSingleLine(obj.title, 200) : '';
  if (!title) return null;
  const goal = typeof obj.goal === 'string' ? sanitizeMultiline(obj.goal, 4000) : '';
  const createdAt = typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString();
  const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : createdAt;

  const status: SpecStatus =
    typeof obj.status === 'string' && VALID_SPEC_STATUSES.has(obj.status as SpecStatus)
      ? (obj.status as SpecStatus)
      : 'draft';

  const mode: SpecMode =
    typeof obj.mode === 'string' && VALID_SPEC_MODES.has(obj.mode as SpecMode)
      ? (obj.mode as SpecMode)
      : 'full';

  const deltaItems = sanitizeDeltaItems(obj.deltaItems);
  const acceptanceCriteria = sanitizeStringList(obj.acceptanceCriteria, MAX_CRITERIA_ITEMS, 500);
  const planSteps = sanitizeStringList(obj.planSteps, MAX_PLAN_STEPS, 500);

  const rawTasks: SpecTask[] = [];
  if (Array.isArray(obj.tasks)) {
    const seenTaskIds = new Set<string>();
    for (const item of obj.tasks.slice(0, MAX_TASKS_PER_SPEC)) {
      const task = normalizeTaskFromDisk(item, updatedAt);
      if (task && !seenTaskIds.has(task.id)) {
        seenTaskIds.add(task.id);
        rawTasks.push(task);
      }
    }
  }
  const knownTaskIds = new Set(rawTasks.map((t) => t.id));
  const tasks = rawTasks.map((t) => ({
    ...t,
    dependsOn: t.dependsOn.filter((dep) => knownTaskIds.has(dep)),
  }));

  const rawPlanMarkdown =
    typeof obj.planMarkdown === 'string' ? sanitizePlanMarkdown(obj.planMarkdown) : '';
  const planMarkdown =
    rawPlanMarkdown.length > 0
      ? rawPlanMarkdown
      : synthesizePlanMarkdown({
          title,
          mode,
          goal,
          deltaItems,
          acceptanceCriteria,
          planSteps,
          tasks,
        });

  const revision =
    typeof obj.revision === 'number' && Number.isInteger(obj.revision) && obj.revision >= 1
      ? obj.revision
      : 1;
  const revisions = normalizeRevisionsFromDisk(obj.revisions, revision, planMarkdown, updatedAt);
  const annotations = normalizeAnnotationsFromDisk(obj.annotations, revision, updatedAt);
  const archivedMemoryId =
    typeof obj.archivedMemoryId === 'string' && obj.archivedMemoryId.trim()
      ? sanitizeSingleLine(obj.archivedMemoryId, 80)
      : undefined;

  const approvedBy =
    obj.approvedBy === 'user' || obj.approvedBy === 'model' ? obj.approvedBy : undefined;
  const approvedAt = typeof obj.approvedAt === 'string' ? obj.approvedAt : undefined;
  const approvalNote = sanitizeOptionalMultiline(obj.approvalNote, 1000);

  return {
    id,
    title,
    goal,
    mode,
    deltaItems,
    planMarkdown,
    revision,
    revisions,
    annotations,
    ...(archivedMemoryId !== undefined ? { archivedMemoryId } : {}),
    acceptanceCriteria,
    planSteps,
    status,
    enforcePlanBeforeWrite:
      typeof obj.enforcePlanBeforeWrite === 'boolean' ? obj.enforcePlanBeforeWrite : true,
    requireUiApproval: typeof obj.requireUiApproval === 'boolean' ? obj.requireUiApproval : false,
    ...(approvedBy !== undefined ? { approvedBy } : {}),
    ...(approvedAt !== undefined ? { approvedAt } : {}),
    ...(approvalNote !== undefined ? { approvalNote } : {}),
    tasks,
    createdAt,
    updatedAt,
  };
}

/**
 * Pure read-only load. Never creates directories or writes to disk.
 */
export function loadSpecStateReadOnly(moduleDataDir: string): SpecStateFile {
  const statePath = getSpecStatePath(moduleDataDir);
  if (!fs.existsSync(statePath)) {
    return createEmptySpecState();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return createEmptySpecState();
    }
    const specs: SpecDocument[] = [];
    const seenSpecIds = new Set<string>();
    if (Array.isArray(raw.specs)) {
      for (const item of raw.specs.slice(0, MAX_SPECS)) {
        const spec = normalizeSpecFromDisk(item);
        if (spec && !seenSpecIds.has(spec.id)) {
          seenSpecIds.add(spec.id);
          specs.push(spec);
        }
      }
    }
    const activeSpecId =
      typeof raw.activeSpecId === 'string' && seenSpecIds.has(raw.activeSpecId)
        ? raw.activeSpecId
        : null;

    return {
      schemaVersion: 1,
      activeSpecId,
      specs,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    };
  } catch {
    return createEmptySpecState();
  }
}

export function saveSpecState(moduleDataDir: string, state: SpecStateFile): SpecStateFile {
  const sorted = [...state.specs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  let kept = sorted.slice(0, MAX_SPECS);
  if (state.activeSpecId && !kept.some((s) => s.id === state.activeSpecId)) {
    const activeDoc = sorted.find((s) => s.id === state.activeSpecId);
    if (activeDoc && kept.length > 0) {
      kept = [...kept.slice(0, MAX_SPECS - 1), activeDoc];
    }
  }
  const keptIds = new Set(kept.map((s) => s.id));
  const next: SpecStateFile = {
    schemaVersion: 1,
    activeSpecId: state.activeSpecId && keptIds.has(state.activeSpecId) ? state.activeSpecId : null,
    specs: kept,
    updatedAt: new Date().toISOString(),
  };
  atomicWriteJson(getSpecStatePath(moduleDataDir), next);
  return next;
}

function validateAndNormalizeTaskInputs(
  rawTasks: ReadonlyArray<SpecTaskInput>,
  existingTaskMap: ReadonlyMap<string, SpecTask>,
  nowIso: string,
  options?: {
    forbidAdvancingTaskStatus?: boolean;
    specTitle?: string;
  },
): { ok: true; tasks: SpecTask[] } | { ok: false; error: string } {
  if (rawTasks.length > MAX_TASKS_PER_SPEC) {
    return {
      ok: false,
      error: `Spec cannot contain more than ${MAX_TASKS_PER_SPEC} tasks.`,
    };
  }

  const normalized: SpecTask[] = [];
  for (let i = 0; i < rawTasks.length; i += 1) {
    const raw = rawTasks[i];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: `Task at index ${i} must be an object.` };
    }
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!SPEC_TASK_ID_RE.test(id)) {
      return {
        ok: false,
        error: `Invalid task id "${String(raw.id ?? '')}": must be 1..48 chars matching ${SPEC_TASK_ID_RE.source}.`,
      };
    }
    const title = typeof raw.title === 'string' ? sanitizeSingleLine(raw.title, 200) : '';
    if (!title) {
      return { ok: false, error: `Task "${id}" must have a non-empty title.` };
    }

    const existing = existingTaskMap.get(id);
    const status: SpecTaskStatus =
      raw.status !== undefined
        ? raw.status
        : existing?.status ?? 'pending';

    if (!VALID_TASK_STATUSES.has(status)) {
      return {
        ok: false,
        error: `Task "${id}" has invalid status "${String(status)}".`,
      };
    }

    if (
      options?.forbidAdvancingTaskStatus &&
      (raw.status === 'in_progress' || raw.status === 'done')
    ) {
      const label = options.specTitle ? `"${options.specTitle}" ` : '';
      return {
        ok: false,
        error: `Cannot set task "${id}" to "${raw.status}" from a model tool while draft spec ${label}has write lock enabled. Approve the spec first before advancing tasks.`,
      };
    }

    const dependsOnRaw = raw.dependsOn ?? [];
    if (!Array.isArray(dependsOnRaw)) {
      return { ok: false, error: `Task "${id}" dependsOn must be an array of task IDs.` };
    }

    const dependsOn: string[] = [];
    const seenDeps = new Set<string>();
    for (const dep of dependsOnRaw) {
      if (typeof dep !== 'string' || !dep.trim()) {
        return { ok: false, error: `Task "${id}" contains an empty dependency ID.` };
      }
      if (!seenDeps.has(dep)) {
        seenDeps.add(dep);
        dependsOn.push(dep);
      }
    }

    const description =
      raw.description !== undefined
        ? sanitizeOptionalMultiline(raw.description, 2000)
        : existing?.description;
    const note =
      raw.note !== undefined ? sanitizeOptionalMultiline(raw.note, 2000) : existing?.note;

    normalized.push({
      id,
      title,
      ...(description !== undefined ? { description } : {}),
      dependsOn,
      status,
      ...(note !== undefined ? { note } : {}),
      updatedAt:
        existing &&
        existing.title === title &&
        existing.status === status &&
        existing.description === description &&
        existing.note === note &&
        existing.dependsOn.length === dependsOn.length &&
        existing.dependsOn.every((d, idx) => d === dependsOn[idx])
          ? existing.updatedAt
          : nowIso,
    });
  }

  const dagCheck = validateTaskDag(normalized);
  if (!dagCheck.valid) {
    return { ok: false, error: dagCheck.error };
  }

  // Prevent skipping prerequisite tasks when newly transitioning a task into in_progress/done
  const nextTaskMap = new Map<string, SpecTask>(normalized.map((t) => [t.id, t]));
  for (const task of normalized) {
    const prev = existingTaskMap.get(task.id);
    const transitioningToActiveOrDone =
      (task.status === 'in_progress' || task.status === 'done') && prev?.status !== task.status;
    if (transitioningToActiveOrDone) {
      const unmet = task.dependsOn.filter((depId) => nextTaskMap.get(depId)?.status !== 'done');
      if (unmet.length > 0) {
        return {
          ok: false,
          error: `Cannot set task "${task.id}" to "${task.status}": unmet dependencies must be done first (${unmet.join(', ')}).`,
        };
      }
    }
  }

  return { ok: true, tasks: normalized };
}

export function applySaveSpecInMemory(
  state: SpecStateFile,
  input: SaveSpecInput,
  actor: SpecActor,
): { ok: true; spec: SpecDocumentView; state: SpecStateFile } | { ok: false; error: string } {
  const title = typeof input.title === 'string' ? sanitizeSingleLine(input.title, 200) : '';
  if (!title) {
    return { ok: false, error: 'Spec title must be non-empty.' };
  }
  const goal = typeof input.goal === 'string' ? sanitizeMultiline(input.goal, 4000) : '';
  if (!goal) {
    return { ok: false, error: 'Spec goal must be non-empty.' };
  }

  const existingIds = new Set(state.specs.map((s) => s.id));
  let specId: string;
  if (input.id !== undefined && input.id.trim().length > 0) {
    const trimmedId = input.id.trim();
    if (!SPEC_ID_RE.test(trimmedId)) {
      return {
        ok: false,
        error: `Invalid spec id "${trimmedId}": must match ${SPEC_ID_RE.source}.`,
      };
    }
    specId = trimmedId;
  } else {
    specId = createSpecId(title, existingIds);
  }

  const existingIndex = state.specs.findIndex((s) => s.id === specId);
  const existing = existingIndex >= 0 ? state.specs[existingIndex] : undefined;
  const currentActiveSpec = state.activeSpecId
    ? state.specs.find((s) => s.id === state.activeSpecId) ?? null
    : null;
  const globalWriteLockActive = isSpecWriteLockActive(currentActiveSpec);

  // Prevent model from downgrading UI approval / write lock guardrails
  if (actor === 'model' && existing) {
    if (existing.requireUiApproval && input.requireUiApproval === false) {
      return {
        ok: false,
        error:
          'Cannot disable requireUiApproval from a model tool. Update this setting in the agy-NOV Spec Flow UI.',
      };
    }
    if (existing.enforcePlanBeforeWrite && input.enforcePlanBeforeWrite === false) {
      return {
        ok: false,
        error:
          'Cannot disable enforcePlanBeforeWrite from a model tool. Approve the spec via spec_approve or update guardrails in the agy-NOV Spec Flow UI.',
      };
    }
  }

  const enforcePlanBeforeWrite =
    input.enforcePlanBeforeWrite !== undefined
      ? Boolean(input.enforcePlanBeforeWrite)
      : existing?.enforcePlanBeforeWrite ?? true;
  const requireUiApproval =
    input.requireUiApproval !== undefined
      ? Boolean(input.requireUiApproval)
      : existing?.requireUiApproval ?? false;
  const nextStatus: SpecStatus = existing?.status ?? 'draft';
  const targetWriteLockActive =
    isSpecWriteLockActive(existing) || (nextStatus === 'draft' && enforcePlanBeforeWrite);

  const nowIso = new Date().toISOString();
  const existingTaskMap = new Map<string, SpecTask>(
    (existing?.tasks ?? []).map((t) => [t.id, t]),
  );

  let nextTasks: SpecTask[];
  if (input.tasks !== undefined) {
    const validated = validateAndNormalizeTaskInputs(input.tasks, existingTaskMap, nowIso, {
      forbidAdvancingTaskStatus: actor === 'model' && targetWriteLockActive,
      specTitle: title,
    });
    if (!validated.ok) return validated;
    nextTasks = validated.tasks;
  } else {
    nextTasks = existing ? existing.tasks.map((t) => ({ ...t, dependsOn: [...t.dependsOn] })) : [];
  }

  // Determine next activeSpecId with guardrail against bypassing any write-locked draft spec
  let nextActiveSpecId = state.activeSpecId;
  const wantsSetActive = input.setActive === true || (!existing && input.setActive !== false);
  const wantsClearActive = input.setActive === false && state.activeSpecId === specId;

  if (actor === 'model' && globalWriteLockActive && currentActiveSpec) {
    if (wantsClearActive && currentActiveSpec.id === specId) {
      return {
        ok: false,
        error:
          'Cannot deactivate a draft spec with write lock enabled from a model tool. Approve the spec or switch specs in the agy-NOV Spec Flow UI.',
      };
    }
    if (wantsSetActive && currentActiveSpec.id !== specId) {
      if (input.setActive === true) {
        return {
          ok: false,
          error:
            'Cannot switch active spec from a model tool while the current draft spec has write lock enabled. Approve the active spec first or switch in the agy-NOV Spec Flow UI.',
        };
      }
      // Keep the write-locked active spec active instead of silently replacing it
      nextActiveSpecId = currentActiveSpec.id;
    } else if (wantsSetActive) {
      nextActiveSpecId = specId;
    }
  } else {
    if (wantsSetActive) {
      nextActiveSpecId = specId;
    } else if (wantsClearActive) {
      nextActiveSpecId = null;
    }
  }

  const nextMode: SpecMode =
    input.mode !== undefined
      ? VALID_SPEC_MODES.has(input.mode)
        ? input.mode
        : 'full'
      : existing?.mode ?? 'full';
  if (input.mode !== undefined && !VALID_SPEC_MODES.has(input.mode)) {
    return { ok: false, error: `Invalid spec mode "${String(input.mode)}". Expected "full" or "delta".` };
  }

  const nextDeltaItems: SpecDeltaItem[] =
    input.deltaItems !== undefined
      ? sanitizeDeltaItems(input.deltaItems)
      : existing
        ? existing.deltaItems.map((d) => ({ ...d }))
        : [];

  const nextAcceptanceCriteria =
    input.acceptanceCriteria !== undefined
      ? sanitizeStringList(input.acceptanceCriteria, MAX_CRITERIA_ITEMS, 500)
      : existing
        ? [...existing.acceptanceCriteria]
        : [];

  const nextPlanSteps =
    input.planSteps !== undefined
      ? sanitizeStringList(input.planSteps, MAX_PLAN_STEPS, 500)
      : existing
        ? [...existing.planSteps]
        : [];

  const synthesizedForNext = synthesizePlanMarkdown({
    title,
    mode: nextMode,
    goal,
    deltaItems: nextDeltaItems,
    acceptanceCriteria: nextAcceptanceCriteria,
    planSteps: nextPlanSteps,
    tasks: nextTasks,
  });

  let nextPlanMarkdown: string;
  if (input.planMarkdown !== undefined) {
    const cleanedMd = sanitizePlanMarkdown(input.planMarkdown);
    nextPlanMarkdown = cleanedMd.length > 0 ? cleanedMd : synthesizedForNext;
  } else if (!existing) {
    nextPlanMarkdown = synthesizedForNext;
  } else {
    const existingWasSynthesized =
      existing.planMarkdown ===
      synthesizePlanMarkdown({
        title: existing.title,
        mode: existing.mode,
        goal: existing.goal,
        deltaItems: existing.deltaItems,
        acceptanceCriteria: existing.acceptanceCriteria,
        planSteps: existing.planSteps,
        tasks: existing.tasks,
      });
    nextPlanMarkdown = existingWasSynthesized ? synthesizedForNext : existing.planMarkdown;
  }

  const revSummary =
    typeof input.revisionSummary === 'string' && sanitizeSingleLine(input.revisionSummary, 300)
      ? sanitizeSingleLine(input.revisionSummary, 300)
      : undefined;

  let nextRevision: number;
  let nextRevisions: SpecRevisionEntry[];
  if (!existing) {
    nextRevision = 1;
    nextRevisions = [
      {
        revision: 1,
        planMarkdown: nextPlanMarkdown,
        updatedAt: nowIso,
        ...(revSummary ? { summary: revSummary } : {}),
      },
    ];
  } else {
    const baseRevisions = existing.revisions.map((r) => ({ ...r }));
    if (!baseRevisions.some((r) => r.revision === existing.revision)) {
      baseRevisions.push({
        revision: existing.revision,
        planMarkdown: existing.planMarkdown,
        updatedAt: existing.updatedAt,
      });
    }
    if (nextPlanMarkdown !== existing.planMarkdown) {
      nextRevision = existing.revision + 1;
      baseRevisions.push({
        revision: nextRevision,
        planMarkdown: nextPlanMarkdown,
        updatedAt: nowIso,
        ...(revSummary ? { summary: revSummary } : {}),
      });
      nextRevisions = baseRevisions
        .sort((a, b) => a.revision - b.revision)
        .slice(-MAX_REVISIONS_PER_SPEC);
    } else {
      nextRevision = existing.revision;
      nextRevisions = baseRevisions
        .sort((a, b) => a.revision - b.revision)
        .slice(-MAX_REVISIONS_PER_SPEC);
    }
  }

  const nextSpec: SpecDocument = {
    id: specId,
    title,
    goal,
    mode: nextMode,
    deltaItems: nextDeltaItems,
    planMarkdown: nextPlanMarkdown,
    revision: nextRevision,
    revisions: nextRevisions,
    annotations: existing ? existing.annotations.map((a) => ({ ...a })) : [],
    ...(existing?.archivedMemoryId !== undefined
      ? { archivedMemoryId: existing.archivedMemoryId }
      : {}),
    acceptanceCriteria: nextAcceptanceCriteria,
    planSteps: nextPlanSteps,
    status: nextStatus,
    enforcePlanBeforeWrite,
    requireUiApproval,
    ...(existing?.approvedBy !== undefined ? { approvedBy: existing.approvedBy } : {}),
    ...(existing?.approvedAt !== undefined ? { approvedAt: existing.approvedAt } : {}),
    ...(existing?.approvalNote !== undefined ? { approvalNote: existing.approvalNote } : {}),
    tasks: nextTasks,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };

  if (existingIndex >= 0) {
    state.specs[existingIndex] = nextSpec;
  } else {
    state.specs.unshift(nextSpec);
  }
  state.activeSpecId = nextActiveSpecId;
  state.updatedAt = nowIso;

  return {
    ok: true,
    spec: buildSpecDocumentView(nextSpec),
    state,
  };
}

export function saveSpec(
  moduleDataDir: string,
  input: SaveSpecInput,
  actor: SpecActor,
): { ok: true; spec: SpecDocumentView; state: SpecStateFile } | { ok: false; error: string } {
  const state = loadSpecStateReadOnly(moduleDataDir);
  const res = applySaveSpecInMemory(state, input, actor);
  if (!res.ok) return res;
  const saved = saveSpecState(moduleDataDir, res.state);
  const savedDoc = saved.specs.find((s) => s.id === res.spec.id);
  return {
    ok: true,
    spec: savedDoc ? buildSpecDocumentView(savedDoc) : res.spec,
    state: saved,
  };
}

export function applySetSpecStatusInMemory(
  state: SpecStateFile,
  input: SetSpecStatusInput,
  actor: SpecActor,
): { ok: true; spec: SpecDocumentView; state: SpecStateFile } | { ok: false; error: string } {
  if (!VALID_SPEC_STATUSES.has(input.status)) {
    return { ok: false, error: `Invalid spec status "${String(input.status)}".` };
  }

  const targetId = input.specId?.trim() || state.activeSpecId || undefined;
  if (!targetId) {
    return { ok: false, error: 'No specId specified and no active spec exists.' };
  }

  const idx = state.specs.findIndex((s) => s.id === targetId);
  if (idx < 0) {
    return { ok: false, error: `Spec not found: "${targetId}".` };
  }

  const existing = state.specs[idx];

  // Security gate: prevent model self-approval when requireUiApproval is enabled
  if (actor === 'model' && input.status === 'approved' && existing.requireUiApproval) {
    return {
      ok: false,
      error: `Spec "${existing.title}" requires UI approval (requireUiApproval=true). Please ask the user to approve it in the agy-NOV Spec Flow panel.`,
    };
  }

  if (actor === 'model' && input.status === 'approved' && existing.status === 'archived') {
    return {
      ok: false,
      error: `Spec "${existing.title}" is archived and cannot be approved directly by a model tool.`,
    };
  }

  if (actor === 'model') {
    if (existing.requireUiApproval && input.requireUiApproval === false) {
      return {
        ok: false,
        error:
          'Cannot disable requireUiApproval from a model tool. Update this setting in the agy-NOV Spec Flow UI.',
      };
    }
    if (existing.enforcePlanBeforeWrite && input.enforcePlanBeforeWrite === false) {
      return {
        ok: false,
        error:
          'Cannot disable enforcePlanBeforeWrite from a model tool. Approve the spec via spec_approve or update guardrails in the agy-NOV Spec Flow UI.',
      };
    }
    const currentActiveSpec = state.activeSpecId
      ? state.specs.find((s) => s.id === state.activeSpecId) ?? null
      : null;
    if (currentActiveSpec && isSpecWriteLockActive(currentActiveSpec)) {
      const unlockingActive = existing.id === currentActiveSpec.id && input.status === 'approved';
      if (!unlockingActive) {
        if (input.setActive === false && currentActiveSpec.id === existing.id) {
          return {
            ok: false,
            error:
              'Cannot deactivate a draft spec with write lock enabled from a model tool. Approve the spec or switch specs in the agy-NOV Spec Flow UI.',
          };
        }
        if (input.setActive === true && currentActiveSpec.id !== existing.id) {
          return {
            ok: false,
            error:
              'Cannot switch active spec from a model tool while the current draft spec has write lock enabled. Approve the active spec first or switch in the agy-NOV Spec Flow UI.',
          };
        }
      }
    }
  }

  const nowIso = new Date().toISOString();
  const nextSpec: SpecDocument = {
    ...existing,
    deltaItems: existing.deltaItems.map((d) => ({ ...d })),
    revisions: existing.revisions.map((r) => ({ ...r })),
    annotations: existing.annotations.map((a) => ({ ...a })),
    acceptanceCriteria: [...existing.acceptanceCriteria],
    planSteps: [...existing.planSteps],
    tasks: existing.tasks.map((t) => ({ ...t, dependsOn: [...t.dependsOn] })),
    status: input.status,
    enforcePlanBeforeWrite:
      input.enforcePlanBeforeWrite !== undefined
        ? Boolean(input.enforcePlanBeforeWrite)
        : existing.enforcePlanBeforeWrite,
    requireUiApproval:
      input.requireUiApproval !== undefined
        ? Boolean(input.requireUiApproval)
        : existing.requireUiApproval,
    updatedAt: nowIso,
  };

  const cleanedNote =
    input.approvalNote !== undefined
      ? sanitizeOptionalMultiline(input.approvalNote, 1000)
      : undefined;

  if (input.status === 'approved') {
    if (existing.status !== 'approved' || !existing.approvedBy) {
      nextSpec.approvedBy = actor;
      nextSpec.approvedAt = nowIso;
    }
    if (input.approvalNote !== undefined) {
      if (cleanedNote !== undefined) nextSpec.approvalNote = cleanedNote;
      else delete nextSpec.approvalNote;
    }
  } else if (input.status === 'draft') {
    delete nextSpec.approvedBy;
    delete nextSpec.approvedAt;
    if (input.approvalNote !== undefined) {
      if (cleanedNote !== undefined) nextSpec.approvalNote = cleanedNote;
      else delete nextSpec.approvalNote;
    } else {
      delete nextSpec.approvalNote;
    }
  } else if (input.approvalNote !== undefined) {
    if (cleanedNote !== undefined) nextSpec.approvalNote = cleanedNote;
    else delete nextSpec.approvalNote;
  }

  state.specs[idx] = nextSpec;

  if (input.setActive === true) {
    state.activeSpecId = nextSpec.id;
  } else if (input.setActive === false && state.activeSpecId === nextSpec.id) {
    state.activeSpecId = null;
  }
  state.updatedAt = nowIso;

  return {
    ok: true,
    spec: buildSpecDocumentView(nextSpec),
    state,
  };
}

export function setSpecStatus(
  moduleDataDir: string,
  input: SetSpecStatusInput,
  actor: SpecActor,
): { ok: true; spec: SpecDocumentView; state: SpecStateFile } | { ok: false; error: string } {
  const state = loadSpecStateReadOnly(moduleDataDir);
  const res = applySetSpecStatusInMemory(state, input, actor);
  if (!res.ok) return res;
  const saved = saveSpecState(moduleDataDir, res.state);
  const savedDoc = saved.specs.find((s) => s.id === res.spec.id);
  return {
    ok: true,
    spec: savedDoc ? buildSpecDocumentView(savedDoc) : res.spec,
    state: saved,
  };
}

export function applyUpdateSpecTaskInMemory(
  state: SpecStateFile,
  input: UpdateSpecTaskInput,
  actor: SpecActor,
): { ok: true; task: SpecTaskView; spec: SpecDocumentView; state: SpecStateFile } | { ok: false; error: string } {
  if (!VALID_TASK_STATUSES.has(input.status)) {
    return { ok: false, error: `Invalid task status "${String(input.status)}".` };
  }

  const targetSpecId = input.specId?.trim() || state.activeSpecId || undefined;
  if (!targetSpecId) {
    return { ok: false, error: 'No specId specified and no active spec exists.' };
  }

  const specIdx = state.specs.findIndex((s) => s.id === targetSpecId);
  if (specIdx < 0) {
    return { ok: false, error: `Spec not found: "${targetSpecId}".` };
  }

  const spec = state.specs[specIdx];
  const taskId = input.taskId.trim();
  const taskIdx = spec.tasks.findIndex((t) => t.id === taskId);
  if (taskIdx < 0) {
    return { ok: false, error: `Task "${taskId}" not found in spec "${spec.id}".` };
  }

  const targetTask = spec.tasks[taskIdx];

  // Block model from advancing tasks into in_progress/done while the draft spec has write lock enabled
  if (
    actor === 'model' &&
    isSpecWriteLockActive(spec) &&
    (input.status === 'in_progress' || input.status === 'done')
  ) {
    return {
      ok: false,
      error: `Cannot mark task "${taskId}" as "${input.status}" while spec "${spec.title}" is in DRAFT with write lock enabled. Approve the spec first before advancing tasks.`,
    };
  }

  // Enforce DAG dependency ordering: prevent jumping to in_progress or done with unmet prerequisites
  if (input.status === 'in_progress' || input.status === 'done') {
    const taskMap = new Map<string, SpecTask>(spec.tasks.map((t) => [t.id, t]));
    const unmetDeps = targetTask.dependsOn.filter(
      (depId) => taskMap.get(depId)?.status !== 'done',
    );
    if (unmetDeps.length > 0) {
      return {
        ok: false,
        error: `Cannot mark task "${taskId}" as "${input.status}": unmet prerequisite task(s) must be done first: ${unmetDeps.join(', ')}.`,
      };
    }
  }

  const nowIso = new Date().toISOString();
  const nextNote =
    input.note !== undefined ? sanitizeOptionalMultiline(input.note, 2000) : targetTask.note;

  const updatedTask: SpecTask = {
    ...targetTask,
    dependsOn: [...targetTask.dependsOn],
    status: input.status,
    updatedAt: nowIso,
  };
  if (nextNote !== undefined) {
    updatedTask.note = nextNote;
  } else {
    delete updatedTask.note;
  }

  const nextTasks = spec.tasks.map((t, i) => (i === taskIdx ? updatedTask : t));
  const nextSpec: SpecDocument = {
    ...spec,
    deltaItems: spec.deltaItems.map((d) => ({ ...d })),
    revisions: spec.revisions.map((r) => ({ ...r })),
    annotations: spec.annotations.map((a) => ({ ...a })),
    tasks: nextTasks,
    updatedAt: nowIso,
  };

  state.specs[specIdx] = nextSpec;
  state.updatedAt = nowIso;

  const specView = buildSpecDocumentView(nextSpec);
  const taskView = specView.tasks.find((t) => t.id === taskId)!;

  return {
    ok: true,
    task: taskView,
    spec: specView,
    state,
  };
}

export function updateSpecTask(
  moduleDataDir: string,
  input: UpdateSpecTaskInput,
  actor: SpecActor,
): { ok: true; task: SpecTaskView; spec: SpecDocumentView; state: SpecStateFile } | { ok: false; error: string } {
  const state = loadSpecStateReadOnly(moduleDataDir);
  const res = applyUpdateSpecTaskInMemory(state, input, actor);
  if (!res.ok) return res;
  const saved = saveSpecState(moduleDataDir, res.state);
  const savedDoc = saved.specs.find((s) => s.id === res.spec.id);
  const specView = savedDoc ? buildSpecDocumentView(savedDoc) : res.spec;
  const taskView = specView.tasks.find((t) => t.id === res.task.id) ?? res.task;
  return {
    ok: true,
    task: taskView,
    spec: specView,
    state: saved,
  };
}

export function applyAddSpecAnnotationInMemory(
  state: SpecStateFile,
  input: AddSpecAnnotationInput,
):
  | { ok: true; annotation: SpecPlanAnnotation; spec: SpecDocumentView; state: SpecStateFile }
  | { ok: false; error: string } {
  if (!VALID_ANNOTATION_KINDS.has(input.kind)) {
    return {
      ok: false,
      error: `Invalid annotation kind "${String(input.kind)}". Expected "comment", "strike", or "replace".`,
    };
  }

  const targetSpecId = input.specId?.trim() || state.activeSpecId || undefined;
  if (!targetSpecId) {
    return { ok: false, error: 'No specId specified and no active spec exists.' };
  }

  const specIdx = state.specs.findIndex((s) => s.id === targetSpecId);
  if (specIdx < 0) {
    return { ok: false, error: `Spec not found: "${targetSpecId}".` };
  }

  const spec = state.specs[specIdx];
  if (spec.annotations.length >= MAX_ANNOTATIONS_PER_SPEC) {
    return {
      ok: false,
      error: `Spec "${spec.id}" reached the maximum limit of ${MAX_ANNOTATIONS_PER_SPEC} annotations. Delete resolved annotations first.`,
    };
  }

  const lines = splitPlanMarkdownLines(spec.planMarkdown);
  const totalLines = lines.length;
  if (totalLines === 0) {
    return { ok: false, error: 'Cannot annotate an empty plan document.' };
  }

  if (
    typeof input.lineStart !== 'number' ||
    !Number.isInteger(input.lineStart) ||
    typeof input.lineEnd !== 'number' ||
    !Number.isInteger(input.lineEnd)
  ) {
    return { ok: false, error: 'lineStart and lineEnd must be positive integers.' };
  }

  if (input.lineStart < 1 || input.lineEnd < input.lineStart || input.lineEnd > totalLines) {
    return {
      ok: false,
      error: `Invalid line range L${input.lineStart}-L${input.lineEnd}: must satisfy 1 <= lineStart <= lineEnd <= ${totalLines}.`,
    };
  }

  const rawNote = typeof input.note === 'string' ? sanitizeMultiline(input.note, 2000) : '';
  const suggestedText =
    input.kind === 'replace' ? sanitizeOptionalMultiline(input.suggestedText, 6000) : undefined;

  if (input.kind === 'comment' && !rawNote) {
    return { ok: false, error: 'Comment annotation requires a non-empty note.' };
  }
  if (input.kind === 'replace' && !suggestedText) {
    return { ok: false, error: 'Replace annotation requires non-empty suggestedText.' };
  }

  const note =
    rawNote ||
    (input.kind === 'strike'
      ? 'Cut from scope.'
      : input.kind === 'replace'
        ? 'Replace with suggested revision.'
        : '');

  const existingAnnIds = new Set(spec.annotations.map((a) => a.id));
  let annId = `ann_${crypto.randomBytes(4).toString('hex')}`;
  for (let i = 0; i < 8 && existingAnnIds.has(annId); i += 1) {
    annId = `ann_${crypto.randomBytes(4).toString('hex')}`;
  }

  const nowIso = new Date().toISOString();
  const targetRevision =
    typeof input.revision === 'number' && Number.isInteger(input.revision) && input.revision >= 1
      ? input.revision
      : spec.revision;

  const annotation: SpecPlanAnnotation = {
    id: annId,
    revision: targetRevision,
    lineStart: input.lineStart,
    lineEnd: input.lineEnd,
    kind: input.kind,
    note,
    ...(suggestedText !== undefined ? { suggestedText } : {}),
    resolved: false,
    createdAt: nowIso,
  };

  const nextSpec: SpecDocument = {
    ...spec,
    deltaItems: spec.deltaItems.map((d) => ({ ...d })),
    revisions: spec.revisions.map((r) => ({ ...r })),
    annotations: [...spec.annotations.map((a) => ({ ...a })), annotation],
    tasks: spec.tasks.map((t) => ({ ...t, dependsOn: [...t.dependsOn] })),
    updatedAt: nowIso,
  };

  state.specs[specIdx] = nextSpec;
  state.updatedAt = nowIso;

  return {
    ok: true,
    annotation,
    spec: buildSpecDocumentView(nextSpec),
    state,
  };
}

export function addSpecAnnotation(
  moduleDataDir: string,
  input: AddSpecAnnotationInput,
):
  | { ok: true; annotation: SpecPlanAnnotation; spec: SpecDocumentView; state: SpecStateFile }
  | { ok: false; error: string } {
  const state = loadSpecStateReadOnly(moduleDataDir);
  const res = applyAddSpecAnnotationInMemory(state, input);
  if (!res.ok) return res;
  const saved = saveSpecState(moduleDataDir, res.state);
  const savedDoc = saved.specs.find((s) => s.id === res.spec.id);
  return {
    ok: true,
    annotation: res.annotation,
    spec: savedDoc ? buildSpecDocumentView(savedDoc) : res.spec,
    state: saved,
  };
}

export function applyResolveSpecAnnotationInMemory(
  state: SpecStateFile,
  input: ResolveSpecAnnotationInput,
): { ok: true; annotation: SpecPlanAnnotation; spec: SpecDocumentView; state: SpecStateFile } | { ok: false; error: string } {
  const targetSpecId = input.specId?.trim() || state.activeSpecId || undefined;
  if (!targetSpecId) {
    return { ok: false, error: 'No specId specified and no active spec exists.' };
  }

  const specIdx = state.specs.findIndex((s) => s.id === targetSpecId);
  if (specIdx < 0) {
    return { ok: false, error: `Spec not found: "${targetSpecId}".` };
  }

  const spec = state.specs[specIdx];
  const annId = input.annotationId.trim();
  const annIdx = spec.annotations.findIndex((a) => a.id === annId);
  if (annIdx < 0) {
    return { ok: false, error: `Annotation "${annId}" not found in spec "${spec.id}".` };
  }

  const nowIso = new Date().toISOString();
  const nextResolved = input.resolved !== undefined ? Boolean(input.resolved) : true;
  const targetAnn = spec.annotations[annIdx];
  const updatedAnn: SpecPlanAnnotation = {
    ...targetAnn,
    resolved: nextResolved,
  };
  if (nextResolved) {
    updatedAnn.resolvedAt = nowIso;
  } else {
    delete updatedAnn.resolvedAt;
  }

  const nextSpec: SpecDocument = {
    ...spec,
    deltaItems: spec.deltaItems.map((d) => ({ ...d })),
    revisions: spec.revisions.map((r) => ({ ...r })),
    annotations: spec.annotations.map((a, i) => (i === annIdx ? updatedAnn : { ...a })),
    tasks: spec.tasks.map((t) => ({ ...t, dependsOn: [...t.dependsOn] })),
    updatedAt: nowIso,
  };

  state.specs[specIdx] = nextSpec;
  state.updatedAt = nowIso;

  return {
    ok: true,
    annotation: updatedAnn,
    spec: buildSpecDocumentView(nextSpec),
    state,
  };
}

export function resolveSpecAnnotation(
  moduleDataDir: string,
  input: ResolveSpecAnnotationInput,
): { ok: true; annotation: SpecPlanAnnotation; spec: SpecDocumentView; state: SpecStateFile } | { ok: false; error: string } {
  const state = loadSpecStateReadOnly(moduleDataDir);
  const res = applyResolveSpecAnnotationInMemory(state, input);
  if (!res.ok) return res;
  const saved = saveSpecState(moduleDataDir, res.state);
  const savedDoc = saved.specs.find((s) => s.id === res.spec.id);
  return {
    ok: true,
    annotation: res.annotation,
    spec: savedDoc ? buildSpecDocumentView(savedDoc) : res.spec,
    state: saved,
  };
}

export function applyDeleteSpecAnnotationInMemory(
  state: SpecStateFile,
  input: DeleteSpecAnnotationInput,
): { ok: true; deletedId: string; spec: SpecDocumentView; state: SpecStateFile } | { ok: false; error: string } {
  const targetSpecId = input.specId?.trim() || state.activeSpecId || undefined;
  if (!targetSpecId) {
    return { ok: false, error: 'No specId specified and no active spec exists.' };
  }

  const specIdx = state.specs.findIndex((s) => s.id === targetSpecId);
  if (specIdx < 0) {
    return { ok: false, error: `Spec not found: "${targetSpecId}".` };
  }

  const spec = state.specs[specIdx];
  const annId = input.annotationId.trim();
  const annIdx = spec.annotations.findIndex((a) => a.id === annId);
  if (annIdx < 0) {
    return { ok: false, error: `Annotation "${annId}" not found in spec "${spec.id}".` };
  }

  const nowIso = new Date().toISOString();
  const nextSpec: SpecDocument = {
    ...spec,
    deltaItems: spec.deltaItems.map((d) => ({ ...d })),
    revisions: spec.revisions.map((r) => ({ ...r })),
    annotations: spec.annotations.filter((a) => a.id !== annId).map((a) => ({ ...a })),
    tasks: spec.tasks.map((t) => ({ ...t, dependsOn: [...t.dependsOn] })),
    updatedAt: nowIso,
  };

  state.specs[specIdx] = nextSpec;
  state.updatedAt = nowIso;

  return {
    ok: true,
    deletedId: annId,
    spec: buildSpecDocumentView(nextSpec),
    state,
  };
}

export function deleteSpecAnnotation(
  moduleDataDir: string,
  input: DeleteSpecAnnotationInput,
): { ok: true; deletedId: string; spec: SpecDocumentView; state: SpecStateFile } | { ok: false; error: string } {
  const state = loadSpecStateReadOnly(moduleDataDir);
  const res = applyDeleteSpecAnnotationInMemory(state, input);
  if (!res.ok) return res;
  const saved = saveSpecState(moduleDataDir, res.state);
  const savedDoc = saved.specs.find((s) => s.id === res.spec.id);
  return {
    ok: true,
    deletedId: res.deletedId,
    spec: savedDoc ? buildSpecDocumentView(savedDoc) : res.spec,
    state: saved,
  };
}

function buildArchiveMemoryContent(spec: SpecDocument, extraNote?: string): string {
  const lines: string[] = [
    `Spec ID: ${spec.id}`,
    `Mode: ${spec.mode === 'delta' ? 'Brownfield Delta Spec' : 'Full Spec'} | Status: ${spec.status} | Revision: v${spec.revision}`,
    '',
    '## Goal',
    spec.goal,
  ];

  if (spec.deltaItems.length > 0) {
    lines.push('');
    lines.push('## Behavioral Delta Contract');
    for (const item of spec.deltaItems) {
      const area = item.area ? ` (${item.area})` : '';
      lines.push(`- [${item.kind.toUpperCase()}]${area} ${item.text}`);
    }
  }

  if (spec.acceptanceCriteria.length > 0) {
    lines.push('');
    lines.push('## Acceptance Criteria');
    for (const criterion of spec.acceptanceCriteria) {
      lines.push(`- ${criterion}`);
    }
  }

  if (spec.tasks.length > 0) {
    const completed = spec.tasks.filter((t) => t.status === 'done');
    lines.push('');
    lines.push(`## Tasks Summary (${completed.length}/${spec.tasks.length} done)`);
    for (const task of spec.tasks) {
      const note = task.note ? ` — ${task.note}` : '';
      lines.push(`- [${task.status}] ${task.id}: ${task.title}${note}`);
    }
  }

  if (spec.planMarkdown.trim()) {
    lines.push('');
    lines.push('## Plan Snapshot');
    lines.push(spec.planMarkdown.slice(0, 4000));
  }

  const cleanExtra = sanitizeOptionalMultiline(extraNote, 1000);
  if (cleanExtra) {
    lines.push('');
    lines.push('## Archive Note');
    lines.push(cleanExtra);
  }

  return lines.join('\n');
}

/**
 * Archive a Spec's decisions, behavioral delta contract, acceptance criteria, and task summary
 * into the `mem` persistent knowledge store (with <private> tag stripping & secret redaction).
 * Strictly zero disk writes in demo mode.
 */
export function archiveSpecToMemory(
  specModuleDataDir: string,
  rootDataDir: string,
  specId?: string,
  options?: ArchiveSpecToMemoryOptions,
): ArchiveSpecToMemoryResult | { ok: false; error: string } {
  const isDemo = options?.isDemo === true;
  const state =
    isDemo && options?.demoState ? options.demoState : loadSpecStateReadOnly(specModuleDataDir);

  const targetSpecId = specId?.trim() || state.activeSpecId || undefined;
  if (!targetSpecId) {
    return { ok: false, error: 'No specId specified and no active spec exists.' };
  }

  const specIdx = state.specs.findIndex((s) => s.id === targetSpecId);
  if (specIdx < 0) {
    return { ok: false, error: `Spec not found: "${targetSpecId}".` };
  }

  const spec = state.specs[specIdx];
  const tags = ['spec', spec.mode === 'delta' ? 'delta-spec' : 'full-spec'];
  const rawTitle = `[Spec] ${spec.title} (v${spec.revision})`;
  const rawContent = buildArchiveMemoryContent(spec, options?.note);

  if (isDemo) {
    const cleanTitle = redactSecrets(stripPrivateTags(rawTitle).cleaned.trim() || `[Spec] ${spec.id}`);
    const memoryId =
      spec.archivedMemoryId && spec.archivedMemoryId.startsWith('demo-mem-spec-')
        ? spec.archivedMemoryId
        : `demo-mem-spec-${spec.id.slice(0, 24)}-v${spec.revision}`;
    const nowIso = new Date().toISOString();
    const updatedSpec: SpecDocument = {
      ...spec,
      deltaItems: spec.deltaItems.map((d) => ({ ...d })),
      revisions: spec.revisions.map((r) => ({ ...r })),
      annotations: spec.annotations.map((a) => ({ ...a })),
      tasks: spec.tasks.map((t) => ({ ...t, dependsOn: [...t.dependsOn] })),
      archivedMemoryId: memoryId,
      updatedAt: nowIso,
    };
    state.specs[specIdx] = updatedSpec;
    state.updatedAt = nowIso;
    return {
      ok: true,
      memoryId,
      memoryTitle: cleanTitle,
      tags,
      demoSimulated: true,
      spec: buildSpecDocumentView(updatedSpec),
      state,
    };
  }

  const memDataDir = getModuleDataDir(rootDataDir, 'mem');
  const memStore = new MemoryStore(memDataDir, false, options?.workspacePath);
  const existingMemId =
    spec.archivedMemoryId && !spec.archivedMemoryId.startsWith('demo-mem-spec-')
      ? spec.archivedMemoryId
      : undefined;

  const savedMem = memStore.remember({
    id: existingMemId,
    kind: 'decision',
    title: rawTitle,
    content: rawContent,
    tags,
    workspacePath: options?.workspacePath,
    pinned: options?.pinned ?? false,
  });

  const nowIso = new Date().toISOString();
  const updatedSpec: SpecDocument = {
    ...spec,
    deltaItems: spec.deltaItems.map((d) => ({ ...d })),
    revisions: spec.revisions.map((r) => ({ ...r })),
    annotations: spec.annotations.map((a) => ({ ...a })),
    tasks: spec.tasks.map((t) => ({ ...t, dependsOn: [...t.dependsOn] })),
    archivedMemoryId: savedMem.id,
    updatedAt: nowIso,
  };
  state.specs[specIdx] = updatedSpec;
  state.updatedAt = nowIso;

  const savedState = saveSpecState(specModuleDataDir, state);
  const savedDoc = savedState.specs.find((s) => s.id === updatedSpec.id) ?? updatedSpec;

  return {
    ok: true,
    memoryId: savedMem.id,
    memoryTitle: savedMem.title,
    tags: [...savedMem.tags],
    demoSimulated: false,
    memory: savedMem,
    spec: buildSpecDocumentView(savedDoc),
    state: savedState,
  };
}

/**
 * Pure in-memory demo dataset for demoMode (zero disk writes).
 * Contains 2 realistic specs:
 * 1) An approved Brownfield Delta Spec (v1 -> v2) with a 4-task dependency DAG, delta items, and plan annotations
 * 2) A draft Full Spec (v1 -> v2) with pre-approval write lock, UI approval, and unresolved review annotations
 */
export function createDemoSpecState(): SpecStateFile {
  const now = Date.now();
  const iso = (offsetMinutes: number) => new Date(now - offsetMinutes * 60_000).toISOString();

  const oauthPlanV1 = [
    '# OAuth2 Refresh Token Rotation & Replay Guard',
    '> Mode: BROWNFIELD DELTA SPEC',
    '',
    '## Context & Behavioral Delta',
    '- [ADDED] (auth/db) Add token_family_id and revoked_at columns to refresh_tokens.',
    '- [MODIFIED] (auth/service) Mint single-use child refresh token on every /oauth/token refresh.',
    '- [REMOVED] (auth/session) Remove legacy static 30-day multi-use refresh token path.',
    '',
    '## Implementation Plan',
    '1. Create migration adding token_family_id and revoked_at indexes.',
    '2. Update AuthTokenService.refresh() to rotate token inside a serializable transaction.',
    '3. Sync rotated sessions to Redis pub/sub cluster for instant edge invalidation.',
    '4. Log raw refresh token prefix and user email on replay anomaly for triage.',
    '5. Run integration replay test suite and canary checklist.',
    '',
    '## Rollback Strategy',
    '- Keep dual-read compatibility flag `OAUTH_ROTATION_V2` for 7 days.',
  ].join('\n');

  const oauthPlanV2 = [
    '# OAuth2 Refresh Token Rotation & Replay Guard',
    '> Mode: BROWNFIELD DELTA SPEC',
    '',
    '## Context & Behavioral Delta',
    '- [ADDED] (auth/db) Add token_family_id and revoked_at columns to refresh_tokens.',
    '- [ADDED] (auth/telemetry) Emit secret-redacted replay anomaly counter & family revocation audit log.',
    '- [MODIFIED] (auth/service) Mint single-use child refresh token inside an atomic transaction on /oauth/token refresh.',
    '- [REMOVED] (auth/session) Remove legacy static 30-day multi-use refresh token path.',
    '',
    '## Implementation Plan',
    '1. Create non-blocking migration adding token_family_id and revoked_at indexes.',
    '2. Update AuthTokenService.refresh() to rotate token atomically and revoke the family on reuse.',
    '3. Emit structured, secret-redacted telemetry events (family_id hash only — zero raw tokens or emails).',
    '4. Execute concurrent refresh race tests, rollback drill, and canary rollout checklist.',
    '',
    '## Rollback Strategy',
    '- Keep dual-read compatibility flag `OAUTH_ROTATION_V2` for 7 days with instant fallback.',
    '- Verify p99 token refresh latency stays under 35ms before removing legacy index.',
  ].join('\n');

  const approvedSpec: SpecDocument = {
    id: 'spec-oauth-refresh-rotation',
    title: 'OAuth2 Refresh Token Rotation & Replay Guard',
    goal: 'Implement rolling refresh token families with automatic replay revocation and backward-compatible session cookie migration.',
    mode: 'delta',
    deltaItems: [
      {
        id: 'delta-oauth-1',
        kind: 'added',
        area: 'auth/db',
        text: 'Add token_family_id index and nullable revoked_at column on refresh_tokens.',
      },
      {
        id: 'delta-oauth-2',
        kind: 'added',
        area: 'auth/telemetry',
        text: 'Emit secret-redacted replay anomaly audit events with hashed family_id.',
      },
      {
        id: 'delta-oauth-3',
        kind: 'modified',
        area: 'auth/service',
        text: 'Rotate refresh tokens atomically per request and revoke entire family on reuse.',
      },
      {
        id: 'delta-oauth-4',
        kind: 'removed',
        area: 'auth/session',
        text: 'Deprecate and remove legacy static multi-use 30-day refresh token path.',
      },
    ],
    planMarkdown: oauthPlanV2,
    revision: 2,
    revisions: [
      {
        revision: 1,
        planMarkdown: oauthPlanV1,
        updatedAt: iso(55),
        summary: 'Initial brownfield delta draft for refresh token rotation',
      },
      {
        revision: 2,
        planMarkdown: oauthPlanV2,
        updatedAt: iso(44),
        summary: 'Removed Redis pub/sub scope and enforced redacted telemetry',
      },
    ],
    annotations: [
      {
        id: 'ann_demo_resolved_1',
        revision: 1,
        lineStart: 12,
        lineEnd: 12,
        kind: 'strike',
        note: 'Cut Redis pub/sub cluster sync out of phase 1 — transactional DB revocation is sufficient.',
        resolved: true,
        createdAt: iso(50),
        resolvedAt: iso(44),
      },
      {
        id: 'ann_demo_open_1',
        revision: 2,
        lineStart: 17,
        lineEnd: 18,
        kind: 'comment',
        note: 'Please add explicit canary abort threshold (e.g. >0.5% unexpected family revocations) before GA.',
        resolved: false,
        createdAt: iso(15),
      },
    ],
    acceptanceCriteria: [
      'Every refresh call mints a single-use child token and invalidates its immediate parent.',
      'Replaying a previously rotated token revokes the entire token family and logs a redacted audit event.',
      'All unit and integration tests pass with zero breaking changes to active sessions.',
    ],
    planSteps: [
      'Add token_family_id and revoked_at columns with non-blocking migration.',
      'Implement atomic rotation and reuse detection in AuthTokenService.',
      'Emit structured, secret-redacted telemetry events for rotation and replay anomalies.',
      'Execute integration suite and canary rollout verification checklist.',
    ],
    status: 'approved',
    enforcePlanBeforeWrite: true,
    requireUiApproval: false,
    approvedBy: 'user',
    approvedAt: iso(42),
    approvalNote: 'Approved schema design and rollback guardrails.',
    tasks: [
      {
        id: 'schema-migration',
        title: 'Define refresh token family schema & migration',
        description: 'Add token_family_id index and nullable revoked_at timestamp.',
        dependsOn: [],
        status: 'done',
        note: 'Migration verified cleanly on SQLite & Postgres fixtures.',
        updatedAt: iso(35),
      },
      {
        id: 'rotation-service',
        title: 'Implement atomic rotation & replay revocation',
        description: 'Rotate refresh token inside transaction and revoke family on reuse.',
        dependsOn: ['schema-migration'],
        status: 'in_progress',
        note: 'Core transaction path complete; finishing race-condition test.',
        updatedAt: iso(12),
      },
      {
        id: 'audit-telemetry',
        title: 'Add redacted security telemetry & metrics',
        description: 'Record family revocations without logging raw tokens or JWT payloads.',
        dependsOn: ['schema-migration'],
        status: 'pending',
        updatedAt: iso(35),
      },
      {
        id: 'integration-canary',
        title: 'Run end-to-end replay suite & canary checklist',
        description: 'Verify concurrent refresh races, rollback script, and latency budget.',
        dependsOn: ['rotation-service', 'audit-telemetry'],
        status: 'pending',
        updatedAt: iso(35),
      },
    ],
    createdAt: iso(55),
    updatedAt: iso(12),
  };

  const webhookPlanV1 = [
    '# Idempotent Billing Webhook Processor',
    '> Mode: FULL SPEC',
    '',
    '## Goal',
    'Guarantee exactly-once invoice state transitions with HMAC validation and dead-letter retries.',
    '',
    '## Implementation Plan',
    '1. Verify webhook HMAC signature on parsed JSON body.',
    '2. Store processed event_id in an in-memory LRU cache.',
    '3. Build custom admin dashboard UI for manual DLQ replays.',
    '4. Add duplicate & out-of-order webhook integration tests.',
  ].join('\n');

  const webhookPlanV2 = [
    '# Idempotent Billing Webhook Processor',
    '> Mode: FULL SPEC',
    '',
    '## Goal',
    'Guarantee exactly-once invoice state transitions with HMAC signature validation and bounded dead-letter retries.',
    '',
    '## Implementation Plan',
    '1. Add raw-body HMAC verification middleware with constant-time digest comparison and 5-minute timestamp window.',
    '2. Introduce persistent idempotency ledger table keyed by (provider, event_id) with 30-day TTL cleanup.',
    '3. Build custom admin dashboard UI for manual DLQ replays.',
    '4. Add automated replay tests for duplicate and out-of-order invoice webhooks.',
  ].join('\n');

  const draftSpec: SpecDocument = {
    id: 'spec-billing-webhook-idempotency',
    title: 'Idempotent Billing Webhook Processor',
    goal: 'Guarantee exactly-once invoice state transitions with HMAC signature validation and bounded dead-letter retries.',
    mode: 'full',
    deltaItems: [],
    planMarkdown: webhookPlanV2,
    revision: 2,
    revisions: [
      {
        revision: 1,
        planMarkdown: webhookPlanV1,
        updatedAt: iso(25),
        summary: 'Initial webhook processor draft',
      },
      {
        revision: 2,
        planMarkdown: webhookPlanV2,
        updatedAt: iso(18),
        summary: 'Switched to raw-body constant-time HMAC and persistent idempotency ledger',
      },
    ],
    annotations: [
      {
        id: 'ann_demo_draft_strike',
        revision: 2,
        lineStart: 10,
        lineEnd: 10,
        kind: 'strike',
        note: 'Cut the custom admin dashboard UI from this milestone — expose CLI replay command only.',
        resolved: false,
        createdAt: iso(16),
      },
      {
        id: 'ann_demo_draft_replace',
        revision: 2,
        lineStart: 9,
        lineEnd: 9,
        kind: 'replace',
        note: 'Use UNIQUE constraint instead of read-then-write check to avoid concurrent races.',
        suggestedText:
          '2. Introduce idempotency_ledger table with UNIQUE(provider, event_id) insert-on-conflict and 30-day TTL cleanup.',
        resolved: false,
        createdAt: iso(14),
      },
    ],
    acceptanceCriteria: [
      'Reject invalid or stale webhook signatures before touching application state.',
      'Deduplicate retried provider deliveries using composite (provider, event_id) keys.',
      'Surface poison events in a replayable dead-letter queue with redacted payloads.',
    ],
    planSteps: [
      'Add raw-body HMAC verification middleware with constant-time digest comparison.',
      'Introduce idempotency ledger table and transactional handler wrapper.',
      'Add automated replay tests for duplicate and out-of-order invoice webhooks.',
    ],
    status: 'draft',
    enforcePlanBeforeWrite: true,
    requireUiApproval: true,
    tasks: [
      {
        id: 'hmac-guard',
        title: 'Implement constant-time HMAC webhook signature guard',
        dependsOn: [],
        status: 'pending',
        updatedAt: iso(18),
      },
      {
        id: 'idempotency-ledger',
        title: 'Persist provider event idempotency ledger with TTL cleanup',
        dependsOn: ['hmac-guard'],
        status: 'pending',
        updatedAt: iso(18),
      },
      {
        id: 'webhook-replay-tests',
        title: 'Add duplicate & out-of-order webhook integration tests',
        dependsOn: ['idempotency-ledger'],
        status: 'pending',
        updatedAt: iso(18),
      },
    ],
    createdAt: iso(25),
    updatedAt: iso(18),
  };

  return {
    schemaVersion: 1,
    activeSpecId: approvedSpec.id,
    specs: [approvedSpec, draftSpec],
    updatedAt: iso(12),
  };
}
