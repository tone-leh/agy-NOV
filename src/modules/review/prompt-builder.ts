import { extractCodeSnippet } from './diff-helpers.js';
import type {
  AnnotationCategory,
  BuiltReviewPrompt,
  DiffFile,
  PromptBuildOptions,
  ReviewAnnotation,
  Stage1ChecklistItem,
} from './types.js';

const CATEGORY_ORDER: Record<AnnotationCategory, number> = {
  security: 0,
  bug: 1,
  refactor: 2,
  question: 3,
  nit: 4,
};

const CATEGORY_BADGE: Record<AnnotationCategory, string> = {
  security: '[SECURITY]',
  bug: '[BUG]',
  refactor: '[REFACTOR]',
  question: '[QUESTION]',
  nit: '[NIT]',
};

export function formatLineAnchor(ann: Pick<ReviewAnnotation, 'filePath' | 'startLine' | 'endLine' | 'side'>): string {
  const range =
    ann.endLine > ann.startLine
      ? `L${ann.startLine}-L${ann.endLine}`
      : `L${ann.startLine}`;
  const sideTag = ann.side === 'old' ? ' (removed lines)' : '';
  return `${ann.filePath}:${range}${sideTag}`;
}

function resolveStage1Items(options: PromptBuildOptions): Stage1ChecklistItem[] {
  if (Array.isArray(options.stage1Checklist) && options.stage1Checklist.length > 0) {
    return options.stage1Checklist;
  }
  if (options.specCompliance && Array.isArray(options.specCompliance.items)) {
    return options.specCompliance.items.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      checked: item.checked,
    }));
  }
  return [];
}

export function buildReviewPrompt(options: PromptBuildOptions): BuiltReviewPrompt {
  const categoryCounts: Record<AnnotationCategory, number> = {
    security: 0,
    bug: 0,
    refactor: 0,
    question: 0,
    nit: 0,
  };

  let items = options.annotations.filter((a) => (options.includeResolved ? true : !a.resolved));
  if (options.annotationIds && options.annotationIds.length > 0) {
    const idSet = new Set(options.annotationIds);
    items = items.filter((a) => idSet.has(a.id));
  }

  const spec = options.specCompliance ?? null;
  const stage1Items = resolveStage1Items(options);
  const hasTwoStage = Boolean(spec || stage1Items.length > 0);

  if (items.length === 0 && !hasTwoStage) {
    return {
      markdown: `No pending review annotations for \`${options.repoName}\` (${options.scope}).`,
      annotationCount: 0,
      fileCount: 0,
      categoryCounts,
    };
  }

  const fileMap = new Map<string, DiffFile>();
  for (const f of options.files ?? []) {
    fileMap.set(f.path, f);
  }

  const grouped = new Map<string, ReviewAnnotation[]>();
  for (const item of items) {
    categoryCounts[item.category] = (categoryCounts[item.category] ?? 0) + 1;
    const list = grouped.get(item.filePath) ?? [];
    list.push(item);
    grouped.set(item.filePath, list);
  }

  for (const list of grouped.values()) {
    list.sort((a, b) => {
      if (a.startLine !== b.startLine) return a.startLine - b.startLine;
      return CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    });
  }

  const sortedFileEntries = [...grouped.entries()].sort(([pathA, listA], [pathB, listB]) => {
    const minA = Math.min(...listA.map((x) => CATEGORY_ORDER[x.category]));
    const minB = Math.min(...listB.map((x) => CATEGORY_ORDER[x.category]));
    if (minA !== minB) return minA - minB;
    return pathA.localeCompare(pathB);
  });

  const severitySummary = (['security', 'bug', 'refactor', 'question', 'nit'] as AnnotationCategory[])
    .filter((cat) => categoryCounts[cat] > 0)
    .map((cat) => `${CATEGORY_BADGE[cat]} ${categoryCounts[cat]}`)
    .join(' · ');

  const scopeLabel =
    options.scope === 'commit-range' && options.commitRange
      ? `${options.scope} (${options.commitRange})`
      : options.scope;

  const lines: string[] = [];

  if (hasTwoStage) {
    const checkedCount = stage1Items.filter((item) => item.checked).length;
    lines.push(`# Two-Stage Code Review Feedback — ${options.repoName}`);
    lines.push('');
    lines.push(`- **Branch**: \`${options.branch ?? 'current'}\` | **Scope**: \`${scopeLabel}\``);
    if (spec) {
      const modeTag = spec.mode ? ` · mode: \`${spec.mode}\`` : '';
      lines.push(
        `- **Active Spec**: \`${spec.specId}\` — ${spec.title} (status: \`${spec.status}\`${modeTag}, progress: ${spec.doneTasks}/${spec.totalTasks})`,
      );
    }
    lines.push(
      `- **Stage 1 Spec Checklist**: ${checkedCount}/${stage1Items.length} verified | **Stage 2 Annotations**: ${items.length} across ${sortedFileEntries.length} file${sortedFileEntries.length === 1 ? '' : 's'}${severitySummary ? ` (${severitySummary})` : ''}`,
    );
    lines.push('');
    lines.push('## Stage 1: Spec Compliance Checklist');
    lines.push('');
    if (stage1Items.length === 0) {
      lines.push('_No checklist tasks defined in the active spec._');
    } else {
      for (const item of stage1Items) {
        const mark = item.checked ? 'x' : ' ';
        const statusSuffix = item.status ? ` _(${item.status})_` : '';
        const noteSuffix = item.note?.trim() ? ` — ${item.note.trim()}` : '';
        lines.push(`- [${mark}] \`${item.id}\`: ${item.title}${statusSuffix}${noteSuffix}`);
      }
    }
    lines.push('');
    lines.push('## Stage 2: Code Quality Annotations (`file:line`)');
    lines.push('');
    if (items.length === 0) {
      lines.push('_No pending inline code quality annotations._');
      lines.push('');
    }
  } else {
    lines.push(`# Code Review Feedback — ${options.repoName}`);
    lines.push('');
    lines.push(`- **Branch**: \`${options.branch ?? 'current'}\` | **Scope**: \`${scopeLabel}\``);
    lines.push(
      `- **Items**: ${items.length} annotation${items.length === 1 ? '' : 's'} across ${sortedFileEntries.length} file${sortedFileEntries.length === 1 ? '' : 's'} (${severitySummary})`,
    );
    lines.push('');
    lines.push('Please address each inline review item below in priority order:');
    lines.push('');
  }

  let counter = 1;
  const fileHeadingPrefix = hasTwoStage ? '###' : '##';
  for (const [filePath, fileAnnotations] of sortedFileEntries) {
    lines.push(`${fileHeadingPrefix} \`${filePath}\``);
    lines.push('');

    const diffFile = fileMap.get(filePath);
    for (const ann of fileAnnotations) {
      const badge = CATEGORY_BADGE[ann.category];
      const anchor = formatLineAnchor(ann);
      const staleNote = ann.stale ? ' *(line shifted since annotation — check surrounding context)*' : '';
      lines.push(`${counter}. **${badge}** \`${anchor}\`${staleNote}`);
      lines.push(`   ${ann.comment}`);

      const snippet =
        ann.codeSnippet?.trim() ||
        extractCodeSnippet(diffFile, ann.startLine, ann.endLine, ann.side);
      if (snippet) {
        lines.push('   ```diff');
        for (const snippetLine of snippet.split('\n')) {
          lines.push(`   ${snippetLine}`);
        }
        lines.push('   ```');
      }
      lines.push('');
      counter += 1;
    }
  }

  lines.push('---');
  lines.push('### Expectations');
  if (hasTwoStage) {
    lines.push('- Complete all unchecked Stage 1 Spec Compliance items before closing the review.');
  }
  lines.push('- Prioritize `[SECURITY]` and `[BUG]` items first, keeping changes focused on the annotated lines.');
  lines.push('- Answer `[QUESTION]` items directly with code references before changing behavior unless a fix is asked for.');
  lines.push('- Run the relevant typecheck/tests after applying edits, then summarize each item resolved by file and line.');

  return {
    markdown: lines.join('\n'),
    annotationCount: items.length,
    fileCount: sortedFileEntries.length,
    categoryCounts,
  };
}
