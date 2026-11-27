import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from '../../core/utils.js';

export type SpecStatus = 'draft' | 'approved' | 'completed' | 'archived';
export type SpecTaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked';
export type SpecActor = 'user' | 'model';

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

export type SpecDocumentView = Omit<SpecDocument, 'tasks'> & { tasks: SpecTaskView[] };

export interface SpecSummaryItem {
  id: string;
  title: string;
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

export const SPEC_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;
export const SPEC_TASK_ID_RE = /^[a-zA-Z0-9._-]{1,48}$/;
export const MAX_SPECS = 50;
export const MAX_TASKS_PER_SPEC = 100;
export const MAX_CRITERIA_ITEMS = 50;
export const MAX_PLAN_STEPS = 80;

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
  return {
    id: spec.id,
    title: spec.title,
    goal: spec.goal,
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
    return {
      id: spec.id,
      title: spec.title,
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

  const approvedBy =
    obj.approvedBy === 'user' || obj.approvedBy === 'model' ? obj.approvedBy : undefined;
  const approvedAt = typeof obj.approvedAt === 'string' ? obj.approvedAt : undefined;
  const approvalNote = sanitizeOptionalMultiline(obj.approvalNote, 1000);

  return {
    id,
    title,
    goal,
    acceptanceCriteria: sanitizeStringList(obj.acceptanceCriteria, MAX_CRITERIA_ITEMS, 500),
    planSteps: sanitizeStringList(obj.planSteps, MAX_PLAN_STEPS, 500),
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

  const nextSpec: SpecDocument = {
    id: specId,
    title,
    goal,
    acceptanceCriteria:
      input.acceptanceCriteria !== undefined
        ? sanitizeStringList(input.acceptanceCriteria, MAX_CRITERIA_ITEMS, 500)
        : existing
          ? [...existing.acceptanceCriteria]
          : [],
    planSteps:
      input.planSteps !== undefined
        ? sanitizeStringList(input.planSteps, MAX_PLAN_STEPS, 500)
        : existing
          ? [...existing.planSteps]
          : [],
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

/**
 * Pure in-memory demo dataset for demoMode (zero disk writes).
 * Contains 2 realistic specs:
 * 1) An approved spec with a 4-task dependency DAG (done -> in_progress & ready -> waiting_deps)
 * 2) A draft spec with pre-approval write lock & UI approval enabled
 */
export function createDemoSpecState(): SpecStateFile {
  const now = Date.now();
  const iso = (offsetMinutes: number) => new Date(now - offsetMinutes * 60_000).toISOString();

  const approvedSpec: SpecDocument = {
    id: 'spec-oauth-refresh-rotation',
    title: 'OAuth2 Refresh Token Rotation & Replay Guard',
    goal: 'Implement rolling refresh token families with automatic replay revocation and backward-compatible session cookie migration.',
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

  const draftSpec: SpecDocument = {
    id: 'spec-billing-webhook-idempotency',
    title: 'Idempotent Billing Webhook Processor',
    goal: 'Guarantee exactly-once invoice state transitions with HMAC signature validation and bounded dead-letter retries.',
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
