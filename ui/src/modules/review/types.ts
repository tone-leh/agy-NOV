export type ReviewScope = 'working' | 'staged' | 'unstaged' | 'head~1' | 'commit-range';

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'copied';

export type RiskTag = 'security-sensitive' | 'large' | 'config' | 'test';

export type AnnotationCategory = 'security' | 'bug' | 'refactor' | 'question' | 'nit';

export type DiffLineType = 'context' | 'add' | 'del';

export type AnnotationSide = 'new' | 'old';

export type DiffViewMode = 'unified' | 'split';

export type FileFilterMode = 'all' | 'annotated' | 'unviewed' | 'risky';

export type DiffLineRiskSeverity = 'high' | 'medium';

export type DiffLineRiskCategory = 'secret' | 'permission' | 'unsafe_eval' | 'network';

export interface DiffLineRiskHint {
  severity: DiffLineRiskSeverity;
  category: DiffLineRiskCategory;
  message: string;
}

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLine: number | null;
  newLine: number | null;
  riskHint?: DiffLineRiskHint;
}

export interface SplitRow {
  index: number;
  left: DiffLine | null;
  right: DiffLine | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  sectionHeading?: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  absolutePath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  isBinary: boolean;
  isTruncated: boolean;
  truncationReason?: string;
  riskTags: RiskTag[];
  fingerprint: string;
  hunks: DiffHunk[];
}

export interface ReviewAnnotation {
  id: string;
  repoKey: string;
  scope: ReviewScope;
  filePath: string;
  side: AnnotationSide;
  startLine: number;
  endLine: number;
  category: AnnotationCategory;
  comment: string;
  codeSnippet?: string;
  fileFingerprint?: string;
  resolved: boolean;
  stale?: boolean;
  staleReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSignal {
  lastEvent?: string;
  lastToolName?: string;
  lastWriteAt?: string;
  updatedAt?: string;
  changeCount: number;
  workspacePaths?: string[];
  conversationId?: string;
}

export interface ReviewWorktreeOption {
  path: string;
  branch: string | null;
  isMain: boolean;
  isDirty?: boolean;
}

export interface ReviewSpecComplianceItem {
  id: string;
  title: string;
  status: string;
  checked: boolean;
}

export interface ReviewSpecCompliance {
  specId: string;
  title: string;
  status: string;
  mode?: string;
  totalTasks: number;
  doneTasks: number;
  items: ReviewSpecComplianceItem[];
}

export interface Stage1ChecklistItem {
  id: string;
  title: string;
  status?: string;
  checked: boolean;
  note?: string;
}

export interface ReviewSession {
  repoPath: string;
  repoName: string;
  repoKey: string;
  branch: string;
  headCommit?: string;
  scope: ReviewScope;
  commitRange?: string;
  ignoreWhitespace?: boolean;
  isGitRepo: boolean;
  isDemo: boolean;
  notice?: string;
  generatedAt: string;
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  truncated: boolean;
  files: DiffFile[];
  viewedFiles: string[];
  annotations: ReviewAnnotation[];
  signal?: ReviewSignal | null;
  availableWorktrees?: ReviewWorktreeOption[];
  specCompliance?: ReviewSpecCompliance | null;
}

export interface BuiltReviewPrompt {
  markdown: string;
  annotationCount: number;
  fileCount: number;
  categoryCounts: Record<AnnotationCategory, number>;
}

export interface DiffQuery {
  repoPath?: string;
  worktreePath?: string;
  scope?: ReviewScope;
  commitRange?: string;
  ignoreWhitespace?: boolean;
  demo?: boolean;
}

/**
 * Align a hunk's unified lines into side-by-side Split View rows.
 * Consecutive deletions followed immediately by additions are paired row-by-row.
 */
export function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  let rowIndex = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.type === 'context') {
      rows.push({ index: rowIndex++, left: line, right: line });
      i += 1;
      continue;
    }

    if (line.type === 'del') {
      const dels: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'del') {
        dels.push(lines[i]);
        i += 1;
      }
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'add') {
        adds.push(lines[i]);
        i += 1;
      }
      const maxLen = Math.max(dels.length, adds.length);
      for (let k = 0; k < maxLen; k++) {
        rows.push({
          index: rowIndex++,
          left: dels[k] ?? null,
          right: adds[k] ?? null,
        });
      }
      continue;
    }

    rows.push({ index: rowIndex++, left: null, right: line });
    i += 1;
  }

  return rows;
}

/**
 * Extract a compact snippet of lines from a DiffFile for an annotation range.
 */
export function extractCodeSnippet(
  file: DiffFile | undefined,
  startLine: number,
  endLine: number,
  side: AnnotationSide = 'new',
  maxSnippetLines = 8,
): string {
  if (!file || file.hunks.length === 0) return '';
  const lo = Math.min(startLine, endLine);
  const hi = Math.max(startLine, endLine);
  const matched: string[] = [];

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      const lineNo = side === 'old' ? line.oldLine : line.newLine;
      if (lineNo !== null && lineNo >= lo && lineNo <= hi) {
        const marker = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
        matched.push(`${lineNo} | ${marker}${line.content}`);
      }
    }
  }

  if (matched.length <= maxSnippetLines) {
    return matched.join('\n');
  }
  const head = matched.slice(0, maxSnippetLines - 1);
  return [...head, `... (${matched.length - head.length} more lines)`].join('\n');
}

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

/**
 * Client-side fallback prompt formatter used for instant preview before
 * authoritative server formatting via app_review_build_prompt.
 */
export function buildLocalReviewPrompt(
  session: ReviewSession,
  stage1Checklist?: Stage1ChecklistItem[],
): string {
  const openItems = session.annotations.filter((a) => !a.resolved);
  const spec = session.specCompliance ?? null;
  const stage1Items: Stage1ChecklistItem[] =
    Array.isArray(stage1Checklist) && stage1Checklist.length > 0
      ? stage1Checklist
      : spec?.items.map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          checked: item.checked,
        })) ?? [];
  const hasTwoStage = Boolean(spec || stage1Items.length > 0);

  if (openItems.length === 0 && !hasTwoStage) {
    return `No pending review annotations for \`${session.repoName}\` (${session.scope}).`;
  }

  const fileMap = new Map<string, DiffFile>();
  for (const f of session.files) {
    fileMap.set(f.path, f);
  }

  const categoryCounts: Record<AnnotationCategory, number> = {
    security: 0,
    bug: 0,
    refactor: 0,
    question: 0,
    nit: 0,
  };

  const grouped = new Map<string, ReviewAnnotation[]>();
  for (const item of openItems) {
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
    session.scope === 'commit-range' && session.commitRange
      ? `${session.scope} (${session.commitRange})`
      : session.scope;

  const lines: string[] = [];

  if (hasTwoStage) {
    const checkedCount = stage1Items.filter((item) => item.checked).length;
    lines.push(`# Two-Stage Code Review Feedback — ${session.repoName}`);
    lines.push('');
    lines.push(`- **Branch**: \`${session.branch || 'current'}\` | **Scope**: \`${scopeLabel}\``);
    if (spec) {
      const modeTag = spec.mode ? ` · mode: \`${spec.mode}\`` : '';
      lines.push(
        `- **Active Spec**: \`${spec.specId}\` — ${spec.title} (status: \`${spec.status}\`${modeTag}, progress: ${spec.doneTasks}/${spec.totalTasks})`,
      );
    }
    lines.push(
      `- **Stage 1 Spec Checklist**: ${checkedCount}/${stage1Items.length} verified | **Stage 2 Annotations**: ${openItems.length} across ${sortedFileEntries.length} file${sortedFileEntries.length === 1 ? '' : 's'}${severitySummary ? ` (${severitySummary})` : ''}`,
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
        lines.push(`- [${mark}] \`${item.id}\`: ${item.title}${statusSuffix}`);
      }
    }
    lines.push('');
    lines.push('## Stage 2: Code Quality Annotations (`file:line`)');
    lines.push('');
    if (openItems.length === 0) {
      lines.push('_No pending inline code quality annotations._');
      lines.push('');
    }
  } else {
    lines.push(`# Code Review Feedback — ${session.repoName}`);
    lines.push('');
    lines.push(`- **Branch**: \`${session.branch || 'current'}\` | **Scope**: \`${scopeLabel}\``);
    lines.push(
      `- **Items**: ${openItems.length} annotation${openItems.length === 1 ? '' : 's'} across ${sortedFileEntries.length} file${sortedFileEntries.length === 1 ? '' : 's'} (${severitySummary})`,
    );
    lines.push('');
    lines.push('Please address each inline review item below in priority order:');
    lines.push('');
  }

  let counter = 1;
  const headingPrefix = hasTwoStage ? '###' : '##';
  for (const [filePath, fileAnnotations] of sortedFileEntries) {
    lines.push(`${headingPrefix} \`${filePath}\``);
    lines.push('');
    const diffFile = fileMap.get(filePath);
    for (const ann of fileAnnotations) {
      const range = ann.endLine > ann.startLine ? `L${ann.startLine}-L${ann.endLine}` : `L${ann.startLine}`;
      const sideTag = ann.side === 'old' ? ' (removed lines)' : '';
      const anchor = `${ann.filePath}:${range}${sideTag}`;
      const staleNote = ann.stale ? ' *(line shifted since annotation — check surrounding context)*' : '';
      lines.push(`${counter}. **${CATEGORY_BADGE[ann.category]}** \`${anchor}\`${staleNote}`);
      lines.push(`   ${ann.comment}`);

      const snippet =
        ann.codeSnippet?.trim() || extractCodeSnippet(diffFile, ann.startLine, ann.endLine, ann.side);
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

  return lines.join('\n');
}
