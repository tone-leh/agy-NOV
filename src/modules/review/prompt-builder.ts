import { extractCodeSnippet } from './diff-helpers.js';
import type {
  AnnotationCategory,
  BuiltReviewPrompt,
  DiffFile,
  PromptBuildOptions,
  ReviewAnnotation,
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

  if (items.length === 0) {
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

  const lines: string[] = [
    `# Code Review Feedback — ${options.repoName}`,
    '',
    `- **Branch**: \`${options.branch ?? 'current'}\` | **Scope**: \`${scopeLabel}\``,
    `- **Items**: ${items.length} annotation${items.length === 1 ? '' : 's'} across ${sortedFileEntries.length} file${sortedFileEntries.length === 1 ? '' : 's'} (${severitySummary})`,
    '',
    'Please address each inline review item below in priority order:',
    '',
  ];

  let counter = 1;
  for (const [filePath, fileAnnotations] of sortedFileEntries) {
    lines.push(`## \`${filePath}\``);
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
