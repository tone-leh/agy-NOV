import {
  MAX_TASKS_PER_SPEC,
  SPEC_TASK_ID_RE,
  VALID_TASK_STATUSES,
  isSpecWriteLockActive,
  sanitizeOptionalMultiline,
  sanitizeSingleLine,
  type DagValidationError,
  type DagValidationResult,
  type SpecDocument,
  type SpecDocumentView,
  type SpecStateFile,
  type SpecStateView,
  type SpecSummaryItem,
  type SpecTask,
  type SpecTaskInput,
  type SpecTaskStatus,
  type SpecTaskView,
} from './types.js';

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

export function validateAndNormalizeTaskInputs(
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
