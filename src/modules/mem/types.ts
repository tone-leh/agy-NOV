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
