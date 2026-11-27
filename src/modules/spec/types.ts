import crypto from 'node:crypto';
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

export interface DagValidationResult {
  valid: true;
  orderedIds: string[];
  depths: Map<string, number>;
}

export interface DagValidationError {
  valid: false;
  error: string;
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

export const VALID_SPEC_STATUSES: ReadonlySet<SpecStatus> = new Set([
  'draft',
  'approved',
  'completed',
  'archived',
]);

export const VALID_TASK_STATUSES: ReadonlySet<SpecTaskStatus> = new Set([
  'pending',
  'in_progress',
  'done',
  'blocked',
]);

export const VALID_SPEC_MODES: ReadonlySet<SpecMode> = new Set(['full', 'delta']);

export const VALID_DELTA_KINDS: ReadonlySet<SpecDeltaKind> = new Set([
  'added',
  'modified',
  'removed',
]);

export const VALID_ANNOTATION_KINDS: ReadonlySet<SpecAnnotationKind> = new Set([
  'comment',
  'strike',
  'replace',
]);

export function sanitizeSingleLine(input: string, maxLen: number): string {
  return input
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function sanitizeMultiline(input: string, maxLen: number): string {
  return input
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .trim()
    .slice(0, maxLen);
}

export function sanitizeOptionalMultiline(input: unknown, maxLen: number): string | undefined {
  if (typeof input !== 'string') return undefined;
  const cleaned = sanitizeMultiline(input, maxLen);
  return cleaned.length > 0 ? cleaned : undefined;
}

export function sanitizeStringList(raw: unknown, maxItems: number, maxLen: number): string[] {
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

export function isSpecWriteLockActive(spec: SpecDocument | null | undefined): boolean {
  return Boolean(spec && spec.status === 'draft' && spec.enforcePlanBeforeWrite === true);
}
