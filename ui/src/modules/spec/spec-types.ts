import type { NovBridge } from '../../bridge.js';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
  onOpenSettings?: (moduleId: 'spec') => void;
}

export type SpecStatus = 'draft' | 'approved' | 'completed' | 'archived';
export type SpecTaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked';
export type SpecTaskComputedState = 'ready' | 'waiting_deps' | 'in_progress' | 'done' | 'blocked';
export type SpecMode = 'full' | 'delta';
export type SpecDeltaKind = 'added' | 'modified' | 'removed';
export type SpecAnnotationKind = 'comment' | 'strike' | 'replace';

export interface SpecDeltaItem {
  id: string;
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

export interface SpecRevisionDiffResponse {
  specId: string;
  fromRevision: number;
  toRevision: number;
  availableRevisions: number[];
  addedLines: number;
  removedLines: number;
  degraded: boolean;
  hunks: SpecRevisionDiffHunk[];
}

export interface SpecCompiledWorkflowWaveTask {
  id: string;
  title: string;
  description?: string;
  status: SpecTaskStatus;
  dependsOn: string[];
  files: string[];
  role: string;
  suggestedWorkspace: 'share' | 'inherit';
}

export interface SpecCompiledWorkflowWave {
  waveIndex: number;
  parallelizable: boolean;
  suggestedWorkspace: 'share' | 'inherit';
  tasks: SpecCompiledWorkflowWaveTask[];
}

export interface SpecCompiledWorkflowResponse {
  ok: true;
  target: 'workflow' | 'swarm' | 'both';
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
  waves: SpecCompiledWorkflowWave[];
  warnings: string[];
  workflowPython?: string;
  swarmPlanJson?: string;
  runtimeMode?: string;
}

export interface SpecTaskView {
  id: string;
  title: string;
  description?: string;
  dependsOn: string[];
  status: SpecTaskStatus;
  note?: string;
  updatedAt?: string;
  computedState?: SpecTaskComputedState;
  unmetDeps?: string[];
  depth?: number;
}

export interface SpecDocumentView {
  id: string;
  title: string;
  goal: string;
  mode?: SpecMode;
  deltaItems?: SpecDeltaItem[];
  planMarkdown?: string;
  revision?: number;
  revisions?: SpecRevisionEntry[];
  annotations?: SpecPlanAnnotation[];
  unresolvedAnnotations?: number;
  archivedMemoryId?: string;
  acceptanceCriteria: string[];
  planSteps: string[];
  status: SpecStatus;
  enforcePlanBeforeWrite: boolean;
  requireUiApproval: boolean;
  approvedBy?: string;
  approvedAt?: string;
  approvalNote?: string;
  tasks: SpecTaskView[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SpecSummaryItem {
  id: string;
  title: string;
  mode?: SpecMode;
  revision?: number;
  unresolvedAnnotations?: number;
  archivedMemoryId?: string;
  status: SpecStatus;
  enforcePlanBeforeWrite: boolean;
  requireUiApproval: boolean;
  totalTasks: number;
  doneTasks: number;
  readyTasks: number;
  updatedAt?: string;
}

export interface SpecStateView {
  mode: string;
  activeSpecId: string | null;
  activeSpec: SpecDocumentView | null;
  specs: SpecSummaryItem[];
  writeLockActive: boolean;
}

export interface DraftTaskItem {
  id: string;
  title: string;
  dependsOn: string[];
}

export interface DraftDeltaItem {
  id: string;
  kind: SpecDeltaKind;
  area: string;
  text: string;
}

export interface NormalizedTaskNode {
  task: SpecTaskView;
  computedState: SpecTaskComputedState;
  unmetDeps: string[];
  depth: number;
  originalIndex: number;
}

export interface SpecPanelExtraLabels {
  start: string;
  done: string;
  reset: string;
  addTask: string;
  depsLabel: string;
  planStepsLabel: string;
  specsLabel: string;
  selectSpecHint: string;
  settingsTooltip: string;
  tabReview: string;
  tabCreateDelta: string;
  modeFullBadge: string;
  modeDeltaBadge: string;
  modeFullTitle: string;
  modeFullDesc: string;
  modeDeltaTitle: string;
  modeDeltaDesc: string;
  deltaSectionTitle: string;
  deltaAdded: string;
  deltaModified: string;
  deltaRemoved: string;
  deltaAreaPlaceholder: string;
  deltaTextPlaceholder: string;
  addDeltaBtn: string;
  archiveToMemBtn: string;
  updateMemArchiveBtn: string;
  archivedBadge: string;
  archiveSuccessPrefix: string;
  archiveDemoSuffix: string;
  reviewStatLabel: string;
  unresolvedBadge: string;
  resolvedBadge: string;
  allResolvedHint: string;
  reviewLineHint: string;
  emptyPlanHint: string;
  showResolvedLabel: string;
  toggleDiffBtn: string;
  exitDiffBtn: string;
  diffFromLabel: string;
  diffToLabel: string;
  diffSingleRevHint: string;
  diffNoChangesHint: string;
  diffDegradedNotice: string;
  sendFeedbackBtn: string;
  copyFeedbackBtn: string;
  feedbackSentToast: string;
  feedbackContextToast: string;
  feedbackCopiedToast: string;
  kindComment: string;
  kindStrike: string;
  kindReplace: string;
  selectedRangeLabel: string;
  lineStartLabel: string;
  lineEndLabel: string;
  notePlaceholderComment: string;
  notePlaceholderStrike: string;
  notePlaceholderReplace: string;
  replaceTextLabel: string;
  replaceTextPlaceholder: string;
  submitAnnotationBtn: string;
  cancelBtn: string;
  resolveBtn: string;
  reopenBtn: string;
  suggestedLabel: string;
  detachedAnnotationsTitle: string;
  planMarkdownLabel: string;
  planMarkdownHint: string;
  planMarkdownPlaceholder: string;
  acceptancePlaceholder: string;
  openReviewLink: string;
  annotationAddedToast: string;
  compileWorkflowBtn: string;
  workflowPreviewTitle: string;
  workflowTabPython: string;
  workflowTabSwarm: string;
  workflowCopyBtn: string;
  workflowCopiedToast: string;
  workflowCloseBtn: string;
  workflowDraftWarning: string;
  workflowWavesBadge: string;
  workflowParallelBadge: string;
  workflowTasksBadge: string;
  workflowSkippedDoneBadge: string;
  workflowIncludeCompletedLabel: string;
  workflowWavePrefix: string;
  workflowEmptyHint: string;
}

export interface SetSpecStatusParams {
  specId: string;
  status: SpecStatus;
  enforcePlanBeforeWrite?: boolean;
  requireUiApproval?: boolean;
  setActive?: boolean;
  actionKey: string;
  notifyText?: string;
}

export function computeDagNodes(tasks: readonly SpecTaskView[]): NormalizedTaskNode[] {
  const byId = new Map<string, SpecTaskView>();
  for (const task of tasks) {
    byId.set(task.id, task);
  }

  const depthMemo = new Map<string, number>();
  const resolveDepth = (id: string, stack: Set<string>): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    const item = byId.get(id);
    if (!item || !Array.isArray(item.dependsOn) || item.dependsOn.length === 0) {
      depthMemo.set(id, 0);
      return 0;
    }
    if (stack.has(id)) return 0;
    stack.add(id);
    let maxParent = -1;
    for (const depId of item.dependsOn) {
      if (byId.has(depId)) {
        maxParent = Math.max(maxParent, resolveDepth(depId, stack));
      }
    }
    stack.delete(id);
    const depth = maxParent + 1;
    depthMemo.set(id, depth);
    return depth;
  };

  const nodes: NormalizedTaskNode[] = tasks.map((task, idx) => {
    const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
    const unmetDeps = Array.isArray(task.unmetDeps)
      ? task.unmetDeps
      : deps.filter((depId) => {
          const parent = byId.get(depId);
          return parent ? parent.status !== 'done' : false;
        });

    let computedState: SpecTaskComputedState;
    if (task.computedState) {
      computedState = task.computedState;
    } else if (task.status === 'done') {
      computedState = 'done';
    } else if (task.status === 'in_progress') {
      computedState = 'in_progress';
    } else if (task.status === 'blocked') {
      computedState = 'blocked';
    } else {
      computedState = unmetDeps.length > 0 ? 'waiting_deps' : 'ready';
    }

    const depth =
      typeof task.depth === 'number' && Number.isFinite(task.depth) && task.depth >= 0
        ? Math.floor(task.depth)
        : resolveDepth(task.id, new Set<string>());

    return {
      task: { ...task, dependsOn: deps },
      computedState,
      unmetDeps,
      depth,
      originalIndex: idx,
    };
  });

  nodes.sort((a, b) => a.depth - b.depth || a.originalIndex - b.originalIndex);
  return nodes;
}

export function wouldCreateDraftCycle(
  tasks: readonly DraftTaskItem[],
  sourceId: string,
  candidateDepId: string,
): boolean {
  if (sourceId === candidateDepId) return true;
  const byId = new Map<string, DraftTaskItem>();
  for (const t of tasks) byId.set(t.id, t);

  const visited = new Set<string>();
  const queue: string[] = [candidateDepId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === sourceId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const item = byId.get(cur);
    if (item) {
      for (const nextDep of item.dependsOn) {
        if (!visited.has(nextDep)) queue.push(nextDep);
      }
    }
  }
  return false;
}

export function splitMarkdownLinesClient(md: string): string[] {
  if (!md) return [];
  return md.replace(/\r\n?/g, '\n').split('\n');
}

export function buildClientFeedbackPrompt(spec: SpecDocumentView): string {
  const annotations = Array.isArray(spec.annotations) ? spec.annotations : [];
  const unresolved = annotations
    .filter((a) => !a.resolved)
    .sort((a, b) => a.lineStart - b.lineStart || a.lineEnd - b.lineEnd || a.createdAt.localeCompare(b.createdAt));

  const rev = spec.revision ?? 1;
  const specMode: SpecMode = spec.mode === 'delta' ? 'delta' : 'full';
  const lines: string[] = [
    `# Spec Plan Revision Request — "${spec.title}"`,
    `- Spec ID: \`${spec.id}\``,
    `- Mode: ${specMode === 'delta' ? 'Brownfield Delta Spec' : 'Full Spec'}`,
    `- Current Revision: v${rev} -> Target Revision: v${rev + 1}`,
    `- Unresolved Annotations: ${unresolved.length}`,
  ];

  if (unresolved.length === 0) {
    lines.push('');
    lines.push('There are currently no unresolved inline annotations on this plan.');
    return lines.join('\n');
  }

  const mdLines = splitMarkdownLinesClient(spec.planMarkdown ?? '');
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

  const deltaItems = Array.isArray(spec.deltaItems) ? spec.deltaItems : [];
  if (deltaItems.length > 0) {
    lines.push('');
    lines.push('## Current Behavioral Delta Contract');
    for (const item of deltaItems) {
      const area = item.area ? ` (${item.area})` : '';
      lines.push(`- [${item.kind.toUpperCase()}]${area} ${item.text}`);
    }
  }

  lines.push('');
  lines.push('## Required Next Step');
  lines.push(
    `Address all ${unresolved.length} inline annotation(s) above and publish revision v${rev + 1} by calling \`spec_create_or_update\` with \`id: "${spec.id}"\`, updated \`planMarkdown\`, and a concise \`revisionSummary\`. Wait for user review before requesting approval.`,
  );

  return lines.join('\n');
}
