import type { TeamPresetAuditResult } from '../../core/config.js';

export type { TeamPresetAuditResult };

export type PromptCategory =
  | 'review'
  | 'debug'
  | 'release'
  | 'security'
  | 'handoff'
  | 'custom';

export interface PromptVariableSpec {
  name: string;
  description?: string;
  defaultValue?: string;
  required?: boolean;
}

export interface PromptTemplate {
  id: string;
  title: string;
  category: PromptCategory;
  description: string;
  tags: string[];
  body: string;
  variables: PromptVariableSpec[];
  builtIn: boolean;
  updatedAt: string;
}

export interface SavePromptInput {
  id?: string;
  title: string;
  category?: PromptCategory;
  description?: string;
  tags?: string[];
  body: string;
  variables?: PromptVariableSpec[];
}

export interface RenderPromptResult {
  promptId: string;
  title: string;
  rendered: string;
  usedVariables: string[];
  defaultedVariables: string[];
  missingVariables: string[];
  estimatedTokens: number;
}

export type WorkspaceAssetKind =
  | 'rules'
  | 'skill'
  | 'manifest'
  | 'mcp'
  | 'hooks'
  | 'agent-config';

export interface WorkspaceAssetEntry {
  relPath: string;
  kind: WorkspaceAssetKind;
  bytes: number;
  chars: number;
  estimatedTokens: number;
  lineCount: number;
  meta?: Record<string, unknown>;
}

export interface ModuleStorageStat {
  moduleId: string;
  bytes: number;
  files: number;
}

export interface StorageAuditSummary {
  rootDataDirExists: boolean;
  totalBytes: number;
  totalFiles: number;
  modules: ModuleStorageStat[];
}

export const RULE_SINGLE_FILE_LIMIT_BYTES = 24 * 1024; // 24576 bytes (24 KB)
export const RULE_AGGREGATE_TOKEN_LIMIT = 20_000;
export const TOOL_BUDGET_HARD_LIMIT = 100;
export const DEFAULT_TOOLS_PER_EXTERNAL_MCP_SERVER = 10;

export interface AuditRecommendation {
  level: 'info' | 'warn' | 'critical';
  code: string;
  title: string;
  detail: string;
}

export interface RuleBloatOffender {
  path: string;
  bytes: number;
  estimatedTokens: number;
  reason: string;
}

export interface RuleBloatAssessment {
  status: 'ok' | 'warn' | 'critical';
  singleFileLimitBytes: 24576;
  aggregateTokenLimit: 20000;
  largestFileBytes: number;
  largestFilePath?: string;
  totalRuleBytes: number;
  totalRuleTokens: number;
  offendingFiles: RuleBloatOffender[];
}

export interface ToolBudgetAssessment {
  agyNovTools: number;
  externalServersCount: number;
  estimatedExternalTools: number;
  estimatedTotalTools: number;
  hardLimit: 100;
  usagePercent: number;
  status: 'ok' | 'warn' | 'critical';
}

export interface McpHealthFinding {
  severity: 'info' | 'warn' | 'error';
  serverName?: string;
  file: string;
  message: string;
}

export type CrossClientKind = 'antigravity' | 'claude' | 'cursor' | 'codex' | 'shared';

export interface CrossClientFinding {
  severity: 'info' | 'warn' | 'error';
  code: string;
  client: CrossClientKind;
  file: string;
  message: string;
  suggestion?: string;
}

export type OpsSecuritySeverity = 'high' | 'medium' | 'low';

export type OpsSecurityCategory =
  | 'prompt-injection'
  | 'broad-command-allow'
  | 'risky-hook'
  | 'mcp-unsafe-env';

export interface OpsSecurityFinding {
  id: string;
  severity: OpsSecuritySeverity;
  category: OpsSecurityCategory;
  file: string;
  title: string;
  summary: string;
  remediation: string;
}

export type OpsMigrationClient = 'claude' | 'cursor' | 'codex';
export type OpsMigrationAction = 'dedupe-merge' | 'migrate-unique' | 'keep-pointer';

export interface OpsMigrationEntry {
  client: OpsMigrationClient;
  sourcePath: string;
  bytes: number;
  estimatedTokens: number;
  duplicatePercent: number;
  duplicateLines: number;
  totalLines: number;
  recommendedTarget: string;
  action: OpsMigrationAction;
}

export interface OpsMigrationPreview {
  readOnlyPreview: true;
  totalFiles: number;
  totalBytes: number;
  reclaimableBytes: number;
  estimatedSavingsPercent: number;
  estimatedSavedTokens: number;
  entries: OpsMigrationEntry[];
}

export const MAX_SECURITY_SCAN_FILE_BYTES = 256 * 1024; // 256 KiB cap
export const MAX_SECURITY_SCAN_FILES = 80;

export interface AuditWorkspaceOptions {
  enabledNovTools?: number;
}

export interface WorkspaceAuditReport {
  mode: 'live' | 'demo';
  workspaceName: string;
  scannedAt: string;
  healthScore: number;
  summary: {
    assetCount: number;
    totalBytes: number;
    totalChars: number;
    totalEstimatedTokens: number;
    skippedSymlinks: number;
    skippedSensitive: number;
    byKind: Record<WorkspaceAssetKind, { count: number; estimatedTokens: number }>;
  };
  assets: WorkspaceAssetEntry[];
  storage: StorageAuditSummary;
  recommendations: AuditRecommendation[];
  ruleBloat: RuleBloatAssessment;
  toolBudget: ToolBudgetAssessment;
  mcpHealthFindings: McpHealthFinding[];
  teamPreset: TeamPresetAuditResult;
  crossClientFindings: CrossClientFinding[];
  securityFindings: OpsSecurityFinding[];
  securityScore: number;
  migrationPreview: OpsMigrationPreview;
}
