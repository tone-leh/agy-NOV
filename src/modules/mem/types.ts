export type MemoryKind = 'architecture' | 'decision' | 'pitfall' | 'convention' | 'preference';

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
