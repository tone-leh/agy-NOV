import { getModuleDataDir } from '../../core/config.js';
import { MemoryStore, redactSecrets, stripPrivateTags } from '../mem/store.js';
import { buildSpecDocumentView } from './dag.js';
import { loadSpecStateReadOnly, saveSpecState } from './store.js';
import {
  sanitizeOptionalMultiline,
  type ArchiveSpecToMemoryOptions,
  type ArchiveSpecToMemoryResult,
  type SpecDocument,
} from './types.js';

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
