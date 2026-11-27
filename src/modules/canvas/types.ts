export type ArtifactKind = 'html' | 'svg' | 'markdown' | 'slides' | 'image';

export type AnnotationTag = 'fix' | 'layout' | 'copy' | 'polish';

export interface CanvasAnnotation {
  id: string;
  number: number;
  revision: number;
  slideIndex?: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  tag: AnnotationTag;
  note: string;
  status: 'open' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
}

export interface CanvasRevision {
  version: number;
  createdAt: string;
  summary: string;
  content: string;
}

export interface CanvasBoard {
  id: string;
  title: string;
  kind: ArtifactKind;
  sourcePath?: string;
  sourceUri?: string;
  createdAt: string;
  updatedAt: string;
  currentVersion: number;
  revisions: CanvasRevision[];
  annotations: CanvasAnnotation[];
}

export interface CanvasBoardSummary {
  id: string;
  title: string;
  kind: ArtifactKind;
  sourcePath?: string;
  currentVersion: number;
  openPins: number;
  totalPins: number;
  updatedAt: string;
}

export interface CanvasRevisionSummary {
  version: number;
  createdAt: string;
  summary: string;
}

export interface CanvasBoardMeta {
  boardId: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  sourcePath?: string;
  currentVersion: number;
  revisionCount: number;
  latestRevision?: CanvasRevisionSummary;
  openPins: number;
  totalPins: number;
  updatedAt: string;
}
