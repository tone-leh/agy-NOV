export type GuardDecision = 'allow' | 'ask' | 'force_ask' | 'deny';

export type GuardPermissionMode = 'readonly-audit' | 'balanced-dev' | 'strict-gate';

export type GuardSnapshotsViewMode = 'turn' | 'file';

export type GuardTabKey = 'snapshots' | 'audit' | 'policy' | 'scanner';

export type ThreatScenario = 'dotenv_read' | 'secret_write' | 'force_push' | 'rm_rf' | 'curl_pipe';

export interface GuardPolicy {
  enabled: boolean;
  permissionMode: GuardPermissionMode;
  protectEnvAndKeys: GuardDecision;
  blockSecretWrites: GuardDecision;
  blockDestructiveCommands: GuardDecision;
  askOnNetworkPipes: GuardDecision;
  autoSnapshotBeforeEdit: boolean;
  maxSnapshotsPerFile: number;
  maxSnapshotFileBytes: number;
  customProtectedPaths: string[];
  customBlockedCommands: string[];
}

export interface SecretFinding {
  ruleId: string;
  label: string;
  severity: 'critical' | 'high' | 'medium';
  line: number;
  preview: string;
}

export interface SnapshotRecord {
  id: string;
  filePath: string;
  relPath: string;
  toolName: string;
  reason: string;
  createdAt: string;
  sha256: string;
  sizeBytes: number;
  lineCount: number;
  existed: boolean;
  turnKey?: string;
  conversationId?: string;
  stepIdx?: number;
  restoredFromId?: string;
  isDemo?: boolean;
}

export interface TurnCheckpointFileEntry {
  snapshotId: string;
  relPath: string;
  filePath: string;
  existed: boolean;
  sizeBytes: number;
  toolName: string;
  createdAt: string;
}

export interface TurnCheckpointSummary {
  turnKey: string;
  conversationId?: string;
  createdAt: string;
  latestAt: string;
  fileCount: number;
  files: TurnCheckpointFileEntry[];
  toolNames: string[];
}

export interface GuardDiffLine {
  type: 'ctx' | 'add' | 'del';
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface SnapshotDiff {
  snapshotId: string;
  filePath: string;
  relPath: string;
  snapshotSha256: string;
  currentSha256: string | null;
  currentExists: boolean;
  identical: boolean;
  added: number;
  removed: number;
  hunks: GuardDiffLine[];
}

export interface TurnCheckpointDiff {
  turnKey: string;
  conversationId?: string;
  createdAt: string;
  latestAt: string;
  fileCount: number;
  changedFiles: number;
  totalAdded: number;
  totalRemoved: number;
  identical: boolean;
  files: SnapshotDiff[];
}

export interface TurnRestoreResult {
  restored: boolean;
  turnKey: string;
  restoredFiles: string[];
  backupSnapshotIds: string[];
  deletedNewFiles: string[];
  message: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  event: 'PreToolUse' | 'PostToolUse' | 'Restore' | 'Checkpoint' | 'Scan' | 'Simulation';
  toolName: string;
  decision: GuardDecision | 'snapshot' | 'restored';
  category: string;
  target: string;
  summary: string;
  ruleId?: string;
  snapshotId?: string;
  isDemo?: boolean;
}

export interface WorkspaceScanItem {
  filePath: string;
  relPath: string;
  finding: SecretFinding;
}

export interface WorkspaceScanReport {
  scannedFiles: number;
  skippedFiles: number;
  findings: WorkspaceScanItem[];
  scannedAt: string;
}

export interface GuardStats {
  totalSnapshots: number;
  trackedFiles: number;
  blockedCount: number;
  askCount: number;
  restoredCount: number;
  secretCatches: number;
}

export interface GuardDashboardState {
  mode: 'live' | 'demo';
  dataDir: string;
  workspaceRoot: string;
  policy: GuardPolicy;
  stats: GuardStats;
  snapshots: SnapshotRecord[];
  turns?: TurnCheckpointSummary[];
  auditLog: AuditEvent[];
  lastScan: WorkspaceScanReport | null;
}
