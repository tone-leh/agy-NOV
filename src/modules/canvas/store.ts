import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getModuleDataDir, resolveNovDataDir, sanitizeDataDirCandidate } from '../../core/config.js';
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

function chmodSafe(targetPath: string, mode: number): void {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(targetPath, mode);
  } catch {
    // Ignore on filesystems that disallow POSIX chmod
  }
}

function realpathNative(targetPath: string): string {
  return typeof fs.realpathSync.native === 'function'
    ? fs.realpathSync.native(targetPath)
    : fs.realpathSync(targetPath);
}

function isPathInsideRoot(rootReal: string, targetReal: string): boolean {
  const rel = path.relative(rootReal, targetReal);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
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
    rootReal = realpathNative(rootResolved);
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
    targetReal = realpathNative(candidate);
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

  private readBoardById(boardId: string): CanvasBoard | null {
    if (typeof boardId !== 'string' || !BOARD_ID_RE.test(boardId)) {
      return null;
    }
    const p = path.join(this.boardsDir, `${boardId.toLowerCase()}.json`);
    if (path.dirname(p) !== this.boardsDir || !fs.existsSync(p)) {
      return null;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as CanvasBoard;
      if (!parsed || typeof parsed.id !== 'string') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private writeBoard(board: CanvasBoard): void {
    this.ensureStorageDirs();
    const file = this.boardPath(board.id);
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(board, null, 2), { encoding: 'utf8', mode: 0o600 });
    chmodSafe(tmp, 0o600);
    fs.renameSync(tmp, file);
    chmodSafe(file, 0o600);
  }

  listBoards(): CanvasBoardSummary[] {
    this.ensureDemoSeeded();
    const out: CanvasBoardSummary[] = [];
    for (const file of this.listBoardFiles()) {
      try {
        const b = JSON.parse(fs.readFileSync(file, 'utf8')) as CanvasBoard;
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
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
      existing.title = input.title || existing.title;
      existing.kind = input.kind;
      existing.sourcePath = input.sourcePath ?? existing.sourcePath;
      existing.sourceUri = sourceUri;
      existing.updatedAt = now;
      existing.currentVersion = nextVer;
      existing.revisions.push({
        version: nextVer,
        createdAt: now,
        summary: input.summary || `Revision v${nextVer}`,
        content: input.content,
      });
      // Keep latest 15 revisions to stay lean
      if (existing.revisions.length > 15) {
        existing.revisions = existing.revisions.slice(-15);
      }
      this.writeBoard(existing);
      return existing;
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
    const nextNum = board.annotations.reduce((m, a) => Math.max(m, a.number), 0) + 1;
    const pin: CanvasAnnotation = {
      id: `pin_${crypto.randomBytes(4).toString('hex')}`,
      number: nextNum,
      revision: input.revision ?? board.currentVersion,
      slideIndex: input.slideIndex,
      xPct: Number(Math.max(0, Math.min(100, input.xPct)).toFixed(1)),
      yPct: Number(Math.max(0, Math.min(100, input.yPct)).toFixed(1)),
      wPct: Number(Math.max(0, Math.min(100, input.wPct ?? 0)).toFixed(1)),
      hPct: Number(Math.max(0, Math.min(100, input.hPct ?? 0)).toFixed(1)),
      tag: input.tag ?? 'fix',
      note: input.note.trim(),
      status: 'open',
      createdAt: new Date().toISOString(),
    };
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
