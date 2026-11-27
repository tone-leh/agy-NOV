export type FileOp = 'read' | 'edit' | 'write';

export interface ToolCallSummary {
  name: string;
  args: Record<string, string>;
  outputBytes: number;
  truncated: boolean;
  stepIndex: number;
  timestamp: string;
}

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

export interface SwarmChildMetrics {
  conversationId?: string;
  role: string;
  typeName: string;
  model: string;
  stepIndex: number;
  timestamp: string;
  transcriptFound: boolean;
  totalInputTokens: number;
  totalCacheReadTokens: number;
  totalOutputTokens: number;
  cacheHitRate: number;
  turns: number;
  statusHint: 'completed' | 'active' | 'orphan_suspect' | 'unknown';
}

export interface SwarmLineageSummary {
  totalSubagents: number;
  linkedTranscripts: number;
  orphanSuspects: number;
  totalSubagentInputTokens: number;
  totalSubagentOutputTokens: number;
  children: SwarmChildMetrics[];
}

export interface ModelCostBreakdownItem {
  model: string;
  turns: number;
  inputTokens: number;
  cacheReadTokens: number;
  freshInputTokens: number;
  outputTokens: number;
  cacheHitRate: number;
  retrySignals: number;
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
  swarmLineage: SwarmLineageSummary;
  modelBreakdown: ModelCostBreakdownItem[];
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

export interface LiveHookState {
  activeConversationId?: string;
  activeTranscriptPath?: string;
  activeWorkspacePaths?: string[];
  lastToolName?: string;
  lastEvent?: string;
  updatedAt?: string;
  recentEvents: Array<{
    event: string;
    conversationId: string;
    toolName?: string;
    stepIdx?: number;
    timestamp: string;
    error?: string;
  }>;
}
