import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getModuleDataDir, resolveNovDataDir, sanitizeDataDirCandidate } from '../../core/config.js';
import {
  atomicWriteJson,
  canonicalRealpathSync,
  isPathInsideDir,
  isSamePath,
} from '../../core/utils.js';
import type {
  AnnotationTag,
  ArtifactKind,
  CanvasAnnotation,
  CanvasBoard,
  CanvasBoardMeta,
  CanvasBoardSummary,
} from './types.js';
import { buildDemoBoards } from './demo-boards.js';
import { isSafeImageDataUri } from './validation.js';

export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB
export const MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB

const EXTENSION_KIND_MAP: Readonly<Record<string, ArtifactKind>> = {
  '.html': 'html',
  '.htm': 'html',
  '.svg': 'svg',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
};

export const ALLOWED_FILE_EXTENSIONS = Object.keys(EXTENSION_KIND_MAP);

const BOARD_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const SENSITIVE_EXT_RE = /\.(pem|key|p12|pfx|jks|kdbx)$/i;
const SENSITIVE_NAME_RE = /^(id_rsa|id_ed25519|id_ecdsa|id_dsa)(\..+)?$/i;
const VALID_ARTIFACT_KINDS: ReadonlySet<string> = new Set([
  'html',
  'svg',
  'markdown',
  'slides',
  'image',
]);

function sanitizePercentCoord(value: unknown, fallback: number): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Number(Math.max(0, Math.min(100, num)).toFixed(1));
}

function sanitizePercentSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Number(Math.max(0, Math.min(100, value)).toFixed(1));
}

function normalizeStoredBoard(raw: unknown): CanvasBoard | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const b = raw as Record<string, unknown>;
  if (
    typeof b.id !== 'string' ||
    !b.id.trim() ||
    !Array.isArray(b.revisions) ||
    !Array.isArray(b.annotations)
  ) {
    return null;
  }

  const updatedAt = typeof b.updatedAt === 'string' ? b.updatedAt : '';
  const createdAt = typeof b.createdAt === 'string' ? b.createdAt : updatedAt;
  const title = typeof b.title === 'string' ? b.title : b.id;
  const kind: ArtifactKind =
    typeof b.kind === 'string' && VALID_ARTIFACT_KINDS.has(b.kind)
      ? (b.kind as ArtifactKind)
      : 'html';

  const revisions = b.revisions.filter(
    (r): r is CanvasBoard['revisions'][number] =>
      Boolean(
        r &&
          typeof r === 'object' &&
          !Array.isArray(r) &&
          typeof (r as Record<string, unknown>).content === 'string',
      ),
  );
  const annotations = b.annotations.filter(
    (a): a is CanvasAnnotation =>
      Boolean(
        a &&
          typeof a === 'object' &&
          !Array.isArray(a) &&
          typeof (a as Record<string, unknown>).id === 'string',
      ),
  );

  const lastRev = revisions[revisions.length - 1];
  const fallbackVersion =
    lastRev && typeof lastRev.version === 'number' && Number.isFinite(lastRev.version)
      ? lastRev.version
      : revisions.length;
  const currentVersion =
    typeof b.currentVersion === 'number' && Number.isFinite(b.currentVersion)
      ? b.currentVersion
      : fallbackVersion;

  return {
    id: b.id,
    title,
    kind,
    ...(typeof b.sourcePath === 'string' ? { sourcePath: b.sourcePath } : {}),
    ...(typeof b.sourceUri === 'string' ? { sourceUri: b.sourceUri } : {}),
    createdAt,
    updatedAt,
    currentVersion,
    revisions,
    annotations,
  };
}

function chmodSafe(targetPath: string, mode: number): void {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(targetPath, mode);
  } catch {
    // Ignore on filesystems that disallow POSIX chmod
  }
}

function isPathInsideRoot(rootReal: string, targetReal: string): boolean {
  return !isSamePath(rootReal, targetReal) && isPathInsideDir(rootReal, targetReal);
}

function assertSafeRelativeSegments(relPath: string): void {
  const segments = relPath.split(path.sep).filter(Boolean);
  for (const seg of segments) {
    if (seg.startsWith('.')) {
      throw new Error(`Access denied: hidden or sensitive path segment "${seg}" is blocked.`);
    }
    if (SENSITIVE_EXT_RE.test(seg) || SENSITIVE_NAME_RE.test(seg)) {
      throw new Error(`Access denied: sensitive file "${seg}" is blocked.`);
    }
  }
}

function readFileUpToLimit(fd: number, maxBytes: number): Buffer {
  const chunks: Buffer[] = [];
  let total = 0;
  const buf = Buffer.allocUnsafe(64 * 1024);
  while (true) {
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maxBytes) {
      throw new Error(`File exceeds maximum allowed size (${maxBytes} bytes).`);
    }
    chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
  }
  return Buffer.concat(chunks, total);
}

export function resolveCanvasDataDir(explicitRootOrDir?: string): string {
  const sanitized = sanitizeDataDirCandidate(explicitRootOrDir);
  if (sanitized) return getModuleDataDir(sanitized, 'canvas');
  return getModuleDataDir(resolveNovDataDir(), 'canvas');
}

function slugifyId(input: string): string {
  const clean = input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return clean || `board-${crypto.randomBytes(4).toString('hex')}`;
}

export function inferKindFromPath(filePath: string): ArtifactKind | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_KIND_MAP[ext] ?? null;
}

export function loadLocalFileContent(
  filePath: string,
  workspaceRoot: string,
): { kind: ArtifactKind; content: string; uri: string; resolvedPath: string } {
  if (!workspaceRoot || !workspaceRoot.trim()) {
    throw new Error('workspaceRoot is required to load local files onto Agy Canvas.');
  }
  if (!filePath || !filePath.trim()) {
    throw new Error('filePath is required.');
  }

  const rootResolved = path.resolve(workspaceRoot);
  let rootReal: string;
  try {
    rootReal = canonicalRealpathSync(rootResolved);
  } catch {
    throw new Error('Workspace root directory does not exist.');
  }
  if (!fs.statSync(rootReal).isDirectory()) {
    throw new Error('Workspace root must be an existing directory.');
  }

  const candidate = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(rootReal, filePath);

  if (!isPathInsideRoot(rootReal, candidate) && !isPathInsideRoot(rootResolved, candidate)) {
    throw new Error('Access denied: target file resolves outside workspace root.');
  }

  let targetReal: string;
  try {
    targetReal = canonicalRealpathSync(candidate);
  } catch {
    throw new Error(`File not found or inaccessible: ${filePath}`);
  }

  if (!isPathInsideRoot(rootReal, targetReal)) {
    throw new Error('Access denied: target file resolves outside workspace root.');
  }

  assertSafeRelativeSegments(path.relative(rootReal, targetReal));
  if (isPathInsideRoot(rootReal, candidate)) {
    assertSafeRelativeSegments(path.relative(rootReal, candidate));
  } else if (isPathInsideRoot(rootResolved, candidate)) {
    assertSafeRelativeSegments(path.relative(rootResolved, candidate));
  }

  const candidateKind = inferKindFromPath(candidate);
  const kind = inferKindFromPath(targetReal);
  if (!candidateKind || !kind) {
    const ext = path.extname(targetReal).toLowerCase() || path.extname(candidate).toLowerCase();
    throw new Error(
      `Unsupported file extension "${ext || '(none)'}". Allowed extensions: ${ALLOWED_FILE_EXTENSIONS.join(', ')}.`,
    );
  }

  const maxBytes = kind === 'image' ? MAX_IMAGE_FILE_BYTES : MAX_TEXT_FILE_BYTES;
  const fd = fs.openSync(targetReal, fs.constants.O_RDONLY);
  let rawBuf: Buffer;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error('Access denied: target path must be a regular file.');
    }
    if (stat.size > maxBytes) {
      throw new Error(`File exceeds maximum allowed size (${maxBytes} bytes).`);
    }
    rawBuf = readFileUpToLimit(fd, maxBytes);
  } finally {
    fs.closeSync(fd);
  }

  const uri = pathToFileURL(targetReal).href;
  if (kind === 'image') {
    const ext = path.extname(targetReal).toLowerCase().slice(1);
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const dataUri = `data:${mime};base64,${rawBuf.toString('base64')}`;
    if (!isSafeImageDataUri(dataUri)) {
      throw new Error('Image file failed data URI validation.');
    }
    return { kind, content: dataUri, uri, resolvedPath: targetReal };
  }

  const content = rawBuf.toString('utf8');
  // Auto-detect slide decks when Markdown contains >=2 slide separators
  if (kind === 'markdown' && (content.match(/^---$/gm) ?? []).length >= 2) {
    return { kind: 'slides', content, uri, resolvedPath: targetReal };
  }
  return { kind, content, uri, resolvedPath: targetReal };
}

export function toBoardMeta(board: CanvasBoard): CanvasBoardMeta {
  const latest =
    board.revisions.find((r) => r.version === board.currentVersion) ??
    board.revisions[board.revisions.length - 1];
  return {
    boardId: board.id,
    id: board.id,
    title: board.title,
    kind: board.kind,
    sourcePath: board.sourcePath,
    currentVersion: board.currentVersion,
    revisionCount: board.revisions.length,
    latestRevision: latest
      ? {
          version: latest.version,
          createdAt: latest.createdAt,
          summary: latest.summary,
        }
      : undefined,
    openPins: board.annotations.filter((a) => a.status === 'open').length,
    totalPins: board.annotations.length,
    updatedAt: board.updatedAt,
  };
}

export class CanvasStore {
  private readonly boardsDir: string;
  private demoSeeded = false;

  constructor(
    private readonly dataDir: string,
    private readonly demoMode = false,
  ) {
    this.boardsDir = path.join(dataDir, 'boards');
  }

  private ensureDemoSeeded(): void {
    if (!this.demoMode || this.demoSeeded) return;
    this.demoSeeded = true;
    if (this.listBoardFiles().length === 0) {
      for (const b of buildDemoBoards()) {
        this.writeBoard(b);
      }
    }
  }

  private ensureStorageDirs(): void {
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.boardsDir, { recursive: true, mode: 0o700 });
    chmodSafe(this.dataDir, 0o700);
    chmodSafe(this.boardsDir, 0o700);
  }

  private listBoardFiles(): string[] {
    try {
      return fs
        .readdirSync(this.boardsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => path.join(this.boardsDir, f));
    } catch {
      return [];
    }
  }

  private boardPath(id: string): string {
    return path.join(this.boardsDir, `${slugifyId(id)}.json`);
  }

  private static readonly MAX_BOARD_FILE_BYTES = 8 * 1024 * 1024;
  private static readonly MAX_BOARD_WRITE_BYTES = Math.floor(7.5 * 1024 * 1024);
  private static readonly MAX_ANNOTATIONS_PER_BOARD = 500;

  private static serializedByteLength(board: CanvasBoard): number {
    return Buffer.byteLength(`${JSON.stringify(board, null, 2)}\n`, 'utf8');
  }

  private readBoardById(boardId: string): CanvasBoard | null {
    if (typeof boardId !== 'string' || !BOARD_ID_RE.test(boardId)) {
      return null;
    }
    const p = path.join(this.boardsDir, `${boardId.toLowerCase()}.json`);
    if (!isSamePath(path.dirname(p), this.boardsDir) || !fs.existsSync(p)) {
      return null;
    }
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink() || !st.isFile() || st.size > CanvasStore.MAX_BOARD_FILE_BYTES) {
        return null;
      }
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown;
      return normalizeStoredBoard(parsed);
    } catch {
      return null;
    }
  }

  private writeBoard(board: CanvasBoard): void {
    // Evict oldest revisions first so persisted JSON stays strictly under the 8 MiB read ceiling
    // while always keeping the latest revision intact.
    while (
      board.revisions.length > 1 &&
      CanvasStore.serializedByteLength(board) > CanvasStore.MAX_BOARD_WRITE_BYTES
    ) {
      board.revisions.shift();
    }
    const finalBytes = CanvasStore.serializedByteLength(board);
    if (finalBytes > CanvasStore.MAX_BOARD_WRITE_BYTES) {
      throw new Error(
        `Canvas board "${board.id}" exceeds maximum storage budget (${finalBytes} > ${CanvasStore.MAX_BOARD_WRITE_BYTES} bytes).`,
      );
    }
    this.ensureStorageDirs();
    const file = this.boardPath(board.id);
    atomicWriteJson(file, board);
  }

  listBoards(): CanvasBoardSummary[] {
    this.ensureDemoSeeded();
    const out: CanvasBoardSummary[] = [];
    for (const file of this.listBoardFiles().slice(0, 200)) {
      try {
        const st = fs.lstatSync(file);
        if (st.isSymbolicLink() || !st.isFile() || st.size > CanvasStore.MAX_BOARD_FILE_BYTES) {
          continue;
        }
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
        const b = normalizeStoredBoard(raw);
        if (!b) continue;
        out.push({
          id: b.id,
          title: b.title,
          kind: b.kind,
          sourcePath: b.sourcePath,
          currentVersion: b.currentVersion,
          openPins: b.annotations.filter((a) => a.status === 'open').length,
          totalPins: b.annotations.length,
          updatedAt: b.updatedAt,
        });
      } catch {
        // skip corrupted file
      }
    }
    return out.sort((a, b) => {
      const bAt = typeof b.updatedAt === 'string' ? b.updatedAt : '';
      const aAt = typeof a.updatedAt === 'string' ? a.updatedAt : '';
      return bAt.localeCompare(aAt);
    });
  }

  getBoard(boardId?: string): CanvasBoard | null {
    this.ensureDemoSeeded();
    if (boardId === undefined) {
      const list = this.listBoards();
      if (list.length === 0) return null;
      return this.readBoardById(list[0].id);
    }
    return this.readBoardById(boardId);
  }

  publishArtifact(input: {
    boardId?: string;
    title: string;
    kind: ArtifactKind;
    content: string;
    summary?: string;
    sourcePath?: string;
  }): CanvasBoard {
    const id = input.boardId ? slugifyId(input.boardId) : slugifyId(input.title);
    const now = new Date().toISOString();
    const existing = this.getBoard(id);
    const sourceUri = input.sourcePath ? pathToFileURL(path.resolve(input.sourcePath)).href : existing?.sourceUri;

    if (existing) {
      const nextVer = existing.currentVersion + 1;
      const updated: CanvasBoard = {
        ...existing,
        title: input.title || existing.title,
        kind: input.kind,
        sourcePath: input.sourcePath ?? existing.sourcePath,
        sourceUri,
        updatedAt: now,
        currentVersion: nextVer,
        revisions: [
          ...existing.revisions,
          {
            version: nextVer,
            createdAt: now,
            summary: input.summary || `Revision v${nextVer}`,
            content: input.content,
          },
        ].slice(-15),
      };
      this.writeBoard(updated);
      return updated;
    }

    const fresh: CanvasBoard = {
      id,
      title: input.title,
      kind: input.kind,
      sourcePath: input.sourcePath,
      sourceUri,
      createdAt: now,
      updatedAt: now,
      currentVersion: 1,
      revisions: [
        {
          version: 1,
          createdAt: now,
          summary: input.summary || 'Initial draft',
          content: input.content,
        },
      ],
      annotations: [],
    };
    this.writeBoard(fresh);
    return fresh;
  }

  addAnnotation(
    boardId: string,
    input: {
      xPct: number;
      yPct: number;
      wPct?: number;
      hPct?: number;
      tag?: AnnotationTag;
      note: string;
      revision?: number;
      slideIndex?: number;
    },
  ): CanvasBoard | null {
    const board = this.getBoard(boardId);
    if (!board) return null;
    const nextNum =
      board.annotations.reduce(
        (m, a) => Math.max(m, typeof a.number === 'number' && Number.isFinite(a.number) ? a.number : 0),
        0,
      ) + 1;
    const revision =
      typeof input.revision === 'number' && Number.isFinite(input.revision)
        ? Math.max(1, Math.floor(input.revision))
        : board.currentVersion;
    const slideIndex =
      typeof input.slideIndex === 'number' && Number.isFinite(input.slideIndex)
        ? Math.max(0, Math.floor(input.slideIndex))
        : undefined;
    const pin: CanvasAnnotation = {
      id: `pin_${crypto.randomBytes(4).toString('hex')}`,
      number: nextNum,
      revision,
      slideIndex,
      xPct: sanitizePercentCoord(input.xPct, 50),
      yPct: sanitizePercentCoord(input.yPct, 50),
      wPct: sanitizePercentSize(input.wPct),
      hPct: sanitizePercentSize(input.hPct),
      tag: input.tag ?? 'fix',
      note: input.note.trim(),
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    if (board.annotations.length >= CanvasStore.MAX_ANNOTATIONS_PER_BOARD) {
      const oldestResolvedIdx = board.annotations.findIndex((a) => a.status === 'resolved');
      if (oldestResolvedIdx >= 0) {
        board.annotations.splice(oldestResolvedIdx, 1);
      } else {
        board.annotations.shift();
      }
    }
    board.annotations.push(pin);
    board.updatedAt = new Date().toISOString();
    this.writeBoard(board);
    return board;
  }

  updateAnnotationStatus(
    boardId: string,
    annotationIds: string[],
    status: 'open' | 'resolved',
  ): CanvasBoard | null {
    const board = this.getBoard(boardId);
    if (!board) return null;
    const targetSet = new Set(annotationIds);
    const now = new Date().toISOString();
    for (const pin of board.annotations) {
      if (targetSet.size === 0 || targetSet.has(pin.id)) {
        pin.status = status;
        pin.resolvedAt = status === 'resolved' ? now : undefined;
      }
    }
    board.updatedAt = now;
    this.writeBoard(board);
    return board;
  }

  deleteAnnotation(boardId: string, annotationId: string): CanvasBoard | null {
    const board = this.getBoard(boardId);
    if (!board) return null;
    board.annotations = board.annotations.filter((a) => a.id !== annotationId);
    board.updatedAt = new Date().toISOString();
    this.writeBoard(board);
    return board;
  }
}

export function compileFeedbackPrompt(board: CanvasBoard): string {
  const openPins = board.annotations.filter((a) => a.status === 'open');
  const lines = [
    `[Agy Canvas Visual Review Feedback]`,
    `- **Board**: ${board.title} (\`boardId: ${board.id}\`, \`kind: ${board.kind}\`, \`v${board.currentVersion}\`)`,
    ...(board.sourcePath ? [`- **Source File**: \`${board.sourcePath}\``] : []),
    '',
  ];

  if (openPins.length === 0) {
    lines.push('No open pins — please confirm the current revision is ready or suggest final polish.');
    return lines.join('\n');
  }

  lines.push(
    `Please apply the following **${openPins.length}** pinpoint visual revision(s) and re-publish \`v${board.currentVersion + 1}\` to Agy Canvas (\`boardId: "${board.id}"\`):`,
    '',
  );

  for (const pin of openPins) {
    const area =
      pin.wPct > 1 && pin.hPct > 1
        ? `region x=${pin.xPct}%, y=${pin.yPct}%, size=${pin.wPct}%×${pin.hPct}%`
        : `point x=${pin.xPct}%, y=${pin.yPct}%`;
    const slidePart = pin.slideIndex != null ? ` · Slide ${pin.slideIndex + 1}` : '';
    lines.push(`${pin.number}. **[${pin.tag.toUpperCase()}]** (${area}${slidePart}) — ${pin.note}`);
  }

  lines.push(
    '',
    `After updating${board.sourcePath ? ` \`${board.sourcePath}\`` : ''}, call \`canvas_publish_artifact\` with \`boardId: "${board.id}"\` and mark addressed pin IDs resolved (${openPins.map((p) => `\`${p.id}\``).join(', ')}).`,
  );
  return lines.join('\n');
}
