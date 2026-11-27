export type ReviewScope = 'working' | 'staged' | 'unstaged' | 'head~1' | 'commit-range';

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'copied';

export type RiskTag = 'security-sensitive' | 'large' | 'config' | 'test';

export type AnnotationCategory = 'security' | 'bug' | 'refactor' | 'question' | 'nit';

export type DiffLineType = 'context' | 'add' | 'del';

export type AnnotationSide = 'new' | 'old';

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

export interface ReviewSummaryFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  isBinary: boolean;
  isTruncated: boolean;
  riskTags: RiskTag[];
  viewed: boolean;
  openAnnotationCount: number;
}

export interface ReviewSummary {
  repoPath: string;
  repoName: string;
  repoKey: string;
  branch: string;
  scope: ReviewScope;
  commitRange?: string;
  ignoreWhitespace?: boolean;
  isGitRepo: boolean;
  isDemo: boolean;
  notice?: string;
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  viewedCount: number;
  openAnnotationCount: number;
  resolvedAnnotationCount: number;
  truncated: boolean;
  omittedFileCount: number;
  files: ReviewSummaryFile[];
}

export interface PromptBuildOptions {
  repoName: string;
  branch?: string;
  scope: ReviewScope;
  commitRange?: string;
  annotations: ReviewAnnotation[];
  files?: DiffFile[];
  includeResolved?: boolean;
  annotationIds?: string[];
  specCompliance?: ReviewSpecCompliance | null;
  stage1Checklist?: Stage1ChecklistItem[];
}

export interface BuiltReviewPrompt {
  markdown: string;
  annotationCount: number;
  fileCount: number;
  categoryCounts: Record<AnnotationCategory, number>;
}
