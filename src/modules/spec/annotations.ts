import crypto from 'node:crypto';
import { buildSpecDocumentView } from './dag.js';
import {
  MAX_ANNOTATIONS_PER_SPEC,
  MAX_LCS_DIFF_LINES,
  VALID_ANNOTATION_KINDS,
  sanitizeMultiline,
  sanitizeOptionalMultiline,
  splitPlanMarkdownLines,
  type AddSpecAnnotationInput,
  type DeleteSpecAnnotationInput,
  type ResolveSpecAnnotationInput,
  type SpecDocument,
  type SpecDocumentView,
  type SpecPlanAnnotation,
  type SpecRevisionDiffHunk,
  type SpecRevisionDiffResult,
  type SpecStateFile,
} from './types.js';

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
