import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from '../../core/utils.js';
import { buildSpecDocumentView, validateAndNormalizeTaskInputs } from './dag.js';
import {
  MAX_ANNOTATIONS_PER_SPEC,
  MAX_CRITERIA_ITEMS,
  MAX_PLAN_STEPS,
  MAX_REVISIONS_PER_SPEC,
  MAX_SPECS,
  MAX_TASKS_PER_SPEC,
  SPEC_ANNOTATION_ID_RE,
  SPEC_ID_RE,
  SPEC_TASK_ID_RE,
  VALID_ANNOTATION_KINDS,
  VALID_SPEC_MODES,
  VALID_SPEC_STATUSES,
  VALID_TASK_STATUSES,
  createSpecId,
  isSpecWriteLockActive,
  sanitizeDeltaItems,
  sanitizeMultiline,
  sanitizeOptionalMultiline,
  sanitizePlanMarkdown,
  sanitizeSingleLine,
  sanitizeStringList,
  synthesizePlanMarkdown,
  type SaveSpecInput,
  type SetSpecStatusInput,
  type SpecActor,
  type SpecAnnotationKind,
  type SpecDeltaItem,
  type SpecDocument,
  type SpecDocumentView,
  type SpecMode,
  type SpecPlanAnnotation,
  type SpecRevisionEntry,
  type SpecStateFile,
  type SpecStatus,
  type SpecTask,
  type SpecTaskStatus,
  type SpecTaskView,
  type UpdateSpecTaskInput,
} from './types.js';

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
