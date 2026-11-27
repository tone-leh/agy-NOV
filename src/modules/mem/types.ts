export type MemoryKind = 'architecture' | 'decision' | 'pitfall' | 'convention' | 'preference';

export type MemoryConfidence = 'verified' | 'normal' | 'tentative';

export type MemorySource = 'manual' | 'spec_archive' | 'auto_capture';

export type MemoryHygieneStatus = 'healthy' | 'needs_review' | 'stale_ttl' | 'drifted';

export type MemoryHygieneAction = 'verify' | 'refresh_ttl' | 'prune';

export interface CodeAnchor {
  filePath: string;
  basename: string;
  uri: string;
  symbol?: string;
  sha256?: string;
  driftStatus?: 'fresh' | 'drifted' | 'missing' | 'untracked' | 'skipped';
}

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  title: string;
  content: string;
  tags: string[];
  workspacePath?: string;
  sourceConversationId?: string;
  anchors: CodeAnchor[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  recallCount: number;
  drifted?: boolean;
  confidence?: MemoryConfidence;
  source?: MemorySource;
  ttlDays?: number | null;
  expiresAt?: string | null;
  verifiedAt?: string;
  hygieneStatus?: MemoryHygieneStatus;
}

export interface MemoryHygieneSummary {
  total: number;
  healthy: number;
  needsReview: number;
  staleTtl: number;
  drifted: number;
  tentative: number;
  expiredIds: string[];
  reviewIds: string[];
}

export interface BatchHygieneResult {
  action: MemoryHygieneAction;
  requestedIds: string[];
  affectedIds: string[];
  updatedCount: number;
  deletedCount: number;
  summary: MemoryHygieneSummary;
}

export interface GraphNode {
  id: string;
  kind: 'memory' | 'file' | 'tag';
  subKind?: MemoryKind;
  label: string;
  x: number;
  y: number;
  weight: number;
  drifted?: boolean;
  pinned?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: 'anchors' | 'tagged';
}

export interface MemoryGraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type MemoryRecallMode = 'index' | 'timeline' | 'detail';

export interface StripPrivateTagsResult {
  cleaned: string;
  strippedCount: number;
}

export interface MemoryIndexEntry {
  id: string;
  kind: MemoryKind;
  title: string;
  pinned: boolean;
  drifted: boolean;
  tags: string[];
  anchors: Array<{
    basename: string;
    symbol?: string;
    driftStatus?: CodeAnchor['driftStatus'];
  }>;
  updatedAt: string;
  recallCount: number;
  confidence?: MemoryConfidence;
  hygieneStatus?: MemoryHygieneStatus;
  expiresAt?: string | null;
  score?: number;
}

export interface MemoryTimelineEntry {
  id: string;
  kind: MemoryKind;
  title: string;
  excerpt: string;
  pinned: boolean;
  drifted: boolean;
  tags: string[];
  anchorFiles: string[];
  sourceConversationId?: string;
  createdAt: string;
  updatedAt: string;
  recallCount: number;
  isAnchorHit: boolean;
  confidence?: MemoryConfidence;
  hygieneStatus?: MemoryHygieneStatus;
  expiresAt?: string | null;
  score?: number;
}

export interface MemoryProgressiveStats {
  activeCount: number;
  compactIndexChars: number;
  compactIndexTokens: number;
  fullDumpTokens: number;
  savedTokens: number;
  savedPercent: number;
}

export interface MemoryProgressivePreview {
  indexText: string;
  entries: MemoryIndexEntry[];
}

export interface LayeredRecallResult {
  mode: MemoryRecallMode;
  query: string;
  ids: string[];
  window: number;
  totalHits: number;
  text: string;
  indexEntries: MemoryIndexEntry[];
  timelineEntries: MemoryTimelineEntry[];
  detailItems: Array<MemoryItem & { score?: number }>;
}
