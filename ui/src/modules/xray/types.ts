export type FileOp = 'read' | 'edit' | 'write';

export type XrayTabKey = 'overview' | 'files' | 'timemachine' | 'steps';

export interface TurnMetric {
  turnIndex: number;
  stepIndex: number;
  timestamp: string;
  model: string;
  inputTokens: number;
  cacheReadTokens: number;
  freshInputTokens: number;
  outputTokens: number;
  thinkingChars: number;
  toolCallsCount: number;
  toolOutputBytes: number;
  cacheHitRate: number;
  userPromptPreview?: string;
}

export interface ToolHotspot {
  toolName: string;
  calls: number;
  totalOutputBytes: number;
  avgOutputBytes: number;
  estimatedTokens: number;
  truncatedCount: number;
  sharePercent: number;
}

export interface FileActivityItem {
  path: string;
  basename: string;
  dir: string;
  uri: string;
  ops: FileOp[];
  readCount: number;
  editCount: number;
  writeCount: number;
  totalTouches: number;
  lastStepIndex: number;
  lastTimestamp: string;
}

export interface ArtifactSummary {
  name: string;
  path: string;
  uri: string;
  sizeBytes: number;
  updatedAt: string;
  preview: string;
}

export interface SessionSummary {
  id: string;
  source: 'desktop' | 'cli' | 'ide' | 'custom' | 'demo';
  title: string;
  firstPrompt: string;
  startedAt: string;
  updatedAt: string;
  model: string;
  turns: number;
  steps: number;
  totalInputTokens: number;
  totalCacheReadTokens: number;
  totalFreshInputTokens: number;
  totalOutputTokens: number;
  peakContextTokens: number;
  cacheHitRate: number;
  toolCallsCount: number;
  filesTouchedCount: number;
  artifactsCount: number;
  transcriptPath: string;
  brainDir: string;
}

export interface ContextCompositionBucket {
  key: 'cached_prefix' | 'fresh_input' | 'tool_outputs_est' | 'thinking_est' | 'assistant_output';
  label: string;
  tokens: number;
  sharePercent: number;
}

export interface SessionDetail {
  summary: SessionSummary;
  composition: ContextCompositionBucket[];
  turns: TurnMetric[];
  toolHotspots: ToolHotspot[];
  fileActivity: FileActivityItem[];
  artifacts: ArtifactSummary[];
  recentSteps: Array<{
    stepIndex: number;
    type: string;
    source: string;
    timestamp: string;
    model?: string;
    inputTokens?: number;
    cacheReadTokens?: number;
    outputTokens?: number;
    toolNames: string[];
    preview: string;
    bytes: number;
    truncated: boolean;
  }>;
  diagnostics: Array<{
    severity: 'info' | 'warn' | 'good';
    title: string;
    detail: string;
  }>;
}

export interface SearchHit {
  sessionId: string;
  sessionTitle: string;
  updatedAt: string;
  sourceKind: 'transcript' | 'artifact';
  sourceLabel: string;
  filePath: string;
  uri: string;
  score: number;
  snippet: string;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
