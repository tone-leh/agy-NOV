import {
  applyAddSpecAnnotationInMemory,
  applyDeleteSpecAnnotationInMemory,
  applyResolveSpecAnnotationInMemory,
  buildAnnotationFeedbackPrompt,
  computePlanRevisionDiff,
  diffSpecRevisions,
} from './annotations.js';
import { archiveSpecToMemory } from './archive.js';
import {
  buildSpecDocumentView,
  buildSpecStateView,
  computeSpecTaskViews,
  validateTaskDag,
} from './dag.js';
import { createDemoSpecState } from './demo.js';
import {
  applySaveSpecInMemory,
  applySetSpecStatusInMemory,
  applyUpdateSpecTaskInMemory,
  createEmptySpecState,
  getSpecStatePath,
  loadSpecStateReadOnly,
  saveSpecState,
} from './store.js';
import {
  MAX_ANNOTATIONS_PER_SPEC,
  MAX_CRITERIA_ITEMS,
  MAX_DELTA_ITEMS,
  MAX_LCS_DIFF_LINES,
  MAX_PLAN_MARKDOWN_CHARS,
  MAX_PLAN_STEPS,
  MAX_REVISIONS_PER_SPEC,
  MAX_SPECS,
  MAX_TASKS_PER_SPEC,
  SPEC_ANNOTATION_ID_RE,
  SPEC_DELTA_ID_RE,
  SPEC_ID_RE,
  SPEC_TASK_ID_RE,
  createSpecId,
  isSpecWriteLockActive,
  sanitizeDeltaItems,
  sanitizePlanMarkdown,
  splitPlanMarkdownLines,
  synthesizePlanMarkdown,
  type AddSpecAnnotationInput,
  type ArchiveSpecToMemoryOptions,
  type ArchiveSpecToMemoryResult,
  type DagValidationError,
  type DagValidationResult,
  type DeleteSpecAnnotationInput,
  type ResolveSpecAnnotationInput,
  type SaveSpecInput,
  type SetSpecStatusInput,
  type SpecActor,
  type SpecAnnotationKind,
  type SpecDeltaItem,
  type SpecDeltaItemInput,
  type SpecDeltaKind,
  type SpecDocument,
  type SpecDocumentView,
  type SpecMode,
  type SpecPlanAnnotation,
  type SpecRevisionDiffHunk,
  type SpecRevisionDiffResult,
  type SpecRevisionEntry,
  type SpecStateFile,
  type SpecStateView,
  type SpecStatus,
  type SpecSummaryItem,
  type SpecTask,
  type SpecTaskInput,
  type SpecTaskStatus,
  type SpecTaskView,
  type UpdateSpecTaskInput,
} from './types.js';

export type {
  SpecStatus,
  SpecTaskStatus,
  SpecActor,
  SpecMode,
  SpecDeltaKind,
  SpecAnnotationKind,
  SpecDeltaItem,
  SpecDeltaItemInput,
  SpecRevisionEntry,
  SpecPlanAnnotation,
  SpecRevisionDiffHunk,
  SpecRevisionDiffResult,
  SpecTask,
  SpecTaskView,
  SpecDocument,
  SpecDocumentView,
  SpecSummaryItem,
  SpecStateView,
  SpecStateFile,
  SpecTaskInput,
  SaveSpecInput,
  SetSpecStatusInput,
  UpdateSpecTaskInput,
  AddSpecAnnotationInput,
  ResolveSpecAnnotationInput,
  DeleteSpecAnnotationInput,
  ArchiveSpecToMemoryOptions,
  ArchiveSpecToMemoryResult,
  DagValidationResult,
  DagValidationError,
};

export {
  SPEC_ID_RE,
  SPEC_TASK_ID_RE,
  SPEC_DELTA_ID_RE,
  SPEC_ANNOTATION_ID_RE,
  MAX_SPECS,
  MAX_TASKS_PER_SPEC,
  MAX_CRITERIA_ITEMS,
  MAX_PLAN_STEPS,
  MAX_DELTA_ITEMS,
  MAX_PLAN_MARKDOWN_CHARS,
  MAX_REVISIONS_PER_SPEC,
  MAX_ANNOTATIONS_PER_SPEC,
  MAX_LCS_DIFF_LINES,
  sanitizePlanMarkdown,
  splitPlanMarkdownLines,
  sanitizeDeltaItems,
  synthesizePlanMarkdown,
  createSpecId,
  isSpecWriteLockActive,
  validateTaskDag,
  computeSpecTaskViews,
  buildSpecDocumentView,
  buildSpecStateView,
  computePlanRevisionDiff,
  diffSpecRevisions,
  buildAnnotationFeedbackPrompt,
  applyAddSpecAnnotationInMemory,
  applyResolveSpecAnnotationInMemory,
  applyDeleteSpecAnnotationInMemory,
  getSpecStatePath,
  createEmptySpecState,
  loadSpecStateReadOnly,
  saveSpecState,
  applySaveSpecInMemory,
  applySetSpecStatusInMemory,
  applyUpdateSpecTaskInMemory,
  archiveSpecToMemory,
  createDemoSpecState,
};

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
