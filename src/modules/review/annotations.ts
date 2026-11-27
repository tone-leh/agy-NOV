import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensurePrivateDir } from '../../core/utils.js';
import type {
  AnnotationCategory,
  AnnotationSide,
  DiffFile,
  ReviewAnnotation,
  ReviewScope,
} from './types.js';

interface ScopeState {
  annotations: ReviewAnnotation[];
  viewedFiles: string[];
}

interface RepoStoreFile {
  version: 1;
  repoKey: string;
  updatedAt: string;
  scopes: Record<string, ScopeState>;
}

export interface AddAnnotationInput {
  repoKey: string;
  scope: ReviewScope;
  filePath: string;
  side?: AnnotationSide;
  startLine: number;
  endLine?: number;
  category: AnnotationCategory;
  comment: string;
  codeSnippet?: string;
  fileFingerprint?: string;
}

export interface UpdateAnnotationPatch {
  comment?: string;
  category?: AnnotationCategory;
  resolved?: boolean;
  startLine?: number;
  endLine?: number;
}

const SAFE_REPO_KEY_RE = /^[a-zA-Z0-9_-]{4,64}$/;
export const MAX_FILE_PATH_LENGTH = 1024;
export const MAX_COMMENT_LENGTH = 16000;
export const MAX_CODE_SNIPPET_LENGTH = 32000;

function validateLineNumber(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive integer >= 1.`);
  }
  return value;
}

function validateFilePath(filePath: string): string {
  const normalized = filePath.trim().replace(/\\/g, '/');
  if (!normalized) {
    throw new Error('Annotation filePath cannot be empty.');
  }
  if (normalized.length > MAX_FILE_PATH_LENGTH) {
    throw new Error(`Annotation filePath exceeds maximum length (${MAX_FILE_PATH_LENGTH}).`);
  }
  return normalized;
}

function validateComment(rawComment: string): string {
  const trimmed = rawComment.trim();
  if (!trimmed) {
    throw new Error('Annotation comment cannot be empty.');
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(`Annotation comment exceeds maximum length (${MAX_COMMENT_LENGTH}).`);
  }
  return trimmed;
}

function validateCodeSnippet(snippet: string | undefined): string | undefined {
  if (snippet === undefined) return undefined;
  if (snippet.length > MAX_CODE_SNIPPET_LENGTH) {
    throw new Error(`Annotation codeSnippet exceeds maximum length (${MAX_CODE_SNIPPET_LENGTH}).`);
  }
  return snippet;
}

export function sanitizeRepoKey(repoKey: string): string {
  const trimmed = repoKey.trim();
  if (!SAFE_REPO_KEY_RE.test(trimmed)) {
    throw new Error(`Invalid repoKey "${repoKey}": contains disallowed characters.`);
  }
  return trimmed;
}

export class AnnotationStore {
  private readonly sessionsDir: string;
  private readonly inMemoryOnly: boolean;
  private readonly inMemoryRepoKeys: Set<string>;
  private readonly memoryFiles = new Map<string, RepoStoreFile>();

  constructor(
    dataDir?: string,
    options: { inMemoryOnly?: boolean; inMemoryRepoKeys?: readonly string[] } = {},
  ) {
    const baseDir = dataDir && dataDir.trim()
      ? path.resolve(dataDir.trim())
      : path.join(os.tmpdir(), 'agy-nov-review-data');
    this.sessionsDir = path.join(baseDir, 'sessions');
    this.inMemoryOnly = Boolean(options.inMemoryOnly);
    this.inMemoryRepoKeys = new Set(options.inMemoryRepoKeys ?? []);
  }

  private usesMemory(safeKey: string): boolean {
    return this.inMemoryOnly || this.inMemoryRepoKeys.has(safeKey);
  }

  private cloneStoreFile(data: RepoStoreFile): RepoStoreFile {
    const scopes: Record<string, ScopeState> = {};
    for (const [k, v] of Object.entries(data.scopes)) {
      scopes[k] = {
        annotations: v.annotations.map((a) => ({ ...a })),
        viewedFiles: [...v.viewedFiles],
      };
    }
    return {
      version: 1,
      repoKey: data.repoKey,
      updatedAt: data.updatedAt,
      scopes,
    };
  }

  private resolveStorePath(repoKey: string): string {
    const safeKey = sanitizeRepoKey(repoKey);
    const target = path.resolve(this.sessionsDir, `${safeKey}.json`);
    const rel = path.relative(this.sessionsDir, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('Blocked path traversal attempt in AnnotationStore.');
    }
    return target;
  }

  private loadRepoFile(repoKey: string): RepoStoreFile {
    const safeKey = sanitizeRepoKey(repoKey);
    const empty: RepoStoreFile = {
      version: 1,
      repoKey: safeKey,
      updatedAt: new Date().toISOString(),
      scopes: {},
    };

    if (this.usesMemory(safeKey)) {
      const mem = this.memoryFiles.get(safeKey);
      return mem ? this.cloneStoreFile(mem) : empty;
    }

    const filePath = this.resolveStorePath(safeKey);
    if (!fs.existsSync(filePath)) {
      return empty;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RepoStoreFile>;
      if (!parsed || typeof parsed !== 'object' || !parsed.scopes || typeof parsed.scopes !== 'object') {
        return empty;
      }
      const scopes: Record<string, ScopeState> = {};
      for (const [k, v] of Object.entries(parsed.scopes)) {
        if (v && typeof v === 'object') {
          scopes[k] = {
            annotations: Array.isArray(v.annotations) ? v.annotations : [],
            viewedFiles: Array.isArray(v.viewedFiles) ? v.viewedFiles.filter((x) => typeof x === 'string') : [],
          };
        }
      }
      return {
        version: 1,
        repoKey: safeKey,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : empty.updatedAt,
        scopes,
      };
    } catch {
      return empty;
    }
  }

  private saveRepoFile(data: RepoStoreFile): void {
    const safeKey = sanitizeRepoKey(data.repoKey);
    data.updatedAt = new Date().toISOString();
    if (this.usesMemory(safeKey)) {
      this.memoryFiles.set(safeKey, this.cloneStoreFile(data));
      return;
    }
    const filePath = this.resolveStorePath(safeKey);
    ensurePrivateDir(this.sessionsDir);
    const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
  }

  private ensureScope(data: RepoStoreFile, scope: ReviewScope): ScopeState {
    if (!data.scopes[scope]) {
      data.scopes[scope] = { annotations: [], viewedFiles: [] };
    }
    return data.scopes[scope];
  }

  listAnnotations(repoKey: string, scope: ReviewScope): ReviewAnnotation[] {
    const data = this.loadRepoFile(repoKey);
    return [...(data.scopes[scope]?.annotations ?? [])];
  }

  getViewedFiles(repoKey: string, scope: ReviewScope): string[] {
    const data = this.loadRepoFile(repoKey);
    return [...(data.scopes[scope]?.viewedFiles ?? [])];
  }

  seedIfEmpty(repoKey: string, scope: ReviewScope, annotations: ReviewAnnotation[], viewedFiles: string[] = []): void {
    const data = this.loadRepoFile(repoKey);
    const existing = data.scopes[scope];
    if (existing && (existing.annotations.length > 0 || existing.viewedFiles.length > 0)) {
      return;
    }
    data.scopes[scope] = {
      annotations: annotations.map((a) => ({ ...a, repoKey: sanitizeRepoKey(repoKey), scope })),
      viewedFiles: [...viewedFiles],
    };
    this.saveRepoFile(data);
  }

  addAnnotation(input: AddAnnotationInput): ReviewAnnotation {
    const safeKey = sanitizeRepoKey(input.repoKey);
    const filePath = validateFilePath(input.filePath);
    const comment = validateComment(input.comment);
    const codeSnippet = validateCodeSnippet(input.codeSnippet);
    const start = validateLineNumber(input.startLine, 'startLine');
    const end =
      input.endLine !== undefined
        ? validateLineNumber(input.endLine, 'endLine')
        : start;
    if (end < start) {
      throw new Error(`Invalid line range: endLine (${end}) must be greater than or equal to startLine (${start}).`);
    }
    const now = new Date().toISOString();

    const record: ReviewAnnotation = {
      id: `ann_${crypto.randomBytes(6).toString('hex')}`,
      repoKey: safeKey,
      scope: input.scope,
      filePath,
      side: input.side ?? 'new',
      startLine: start,
      endLine: end,
      category: input.category,
      comment,
      codeSnippet,
      fileFingerprint: input.fileFingerprint,
      resolved: false,
      createdAt: now,
      updatedAt: now,
    };

    const data = this.loadRepoFile(safeKey);
    const state = this.ensureScope(data, input.scope);
    state.annotations.push(record);
    this.saveRepoFile(data);
    return record;
  }

  updateAnnotation(
    repoKey: string,
    scope: ReviewScope,
    id: string,
    patch: UpdateAnnotationPatch,
  ): ReviewAnnotation | null {
    const data = this.loadRepoFile(repoKey);
    const state = this.ensureScope(data, scope);
    const target = state.annotations.find((a) => a.id === id);
    if (!target) return null;

    if (patch.comment !== undefined) {
      target.comment = validateComment(patch.comment);
    }
    if (patch.category !== undefined) {
      target.category = patch.category;
    }
    if (patch.resolved !== undefined) {
      target.resolved = patch.resolved;
    }
    const nextStart =
      patch.startLine !== undefined
        ? validateLineNumber(patch.startLine, 'startLine')
        : target.startLine;
    const nextEnd =
      patch.endLine !== undefined
        ? validateLineNumber(patch.endLine, 'endLine')
        : target.endLine;
    if (nextEnd < nextStart) {
      throw new Error(
        `Invalid line range: endLine (${nextEnd}) must be greater than or equal to startLine (${nextStart}).`,
      );
    }
    target.startLine = nextStart;
    target.endLine = nextEnd;
    target.updatedAt = new Date().toISOString();
    this.saveRepoFile(data);
    return { ...target };
  }

  toggleResolve(repoKey: string, scope: ReviewScope, id: string): ReviewAnnotation | null {
    const data = this.loadRepoFile(repoKey);
    const state = this.ensureScope(data, scope);
    const target = state.annotations.find((a) => a.id === id);
    if (!target) return null;

    target.resolved = !target.resolved;
    target.updatedAt = new Date().toISOString();
    this.saveRepoFile(data);
    return { ...target };
  }

  deleteAnnotation(repoKey: string, scope: ReviewScope, id: string): boolean {
    const data = this.loadRepoFile(repoKey);
    const state = this.ensureScope(data, scope);
    const before = state.annotations.length;
    state.annotations = state.annotations.filter((a) => a.id !== id);
    if (state.annotations.length === before) return false;
    this.saveRepoFile(data);
    return true;
  }

  clearResolved(repoKey: string, scope: ReviewScope): number {
    const data = this.loadRepoFile(repoKey);
    const state = this.ensureScope(data, scope);
    const before = state.annotations.length;
    state.annotations = state.annotations.filter((a) => !a.resolved);
    const removed = before - state.annotations.length;
    if (removed > 0) {
      this.saveRepoFile(data);
    }
    return removed;
  }

  setFileViewed(repoKey: string, scope: ReviewScope, filePath: string, viewed: boolean): string[] {
    const normalized = validateFilePath(filePath);
    const data = this.loadRepoFile(repoKey);
    const state = this.ensureScope(data, scope);
    const set = new Set(state.viewedFiles);
    if (viewed) set.add(normalized);
    else set.delete(normalized);
    state.viewedFiles = [...set].sort();
    this.saveRepoFile(data);
    return [...state.viewedFiles];
  }
}

/**
 * Evaluate whether each annotation's target file or anchored lines drifted since creation.
 */
export function evaluateAnnotationStaleness(
  annotations: ReviewAnnotation[],
  files: DiffFile[],
): ReviewAnnotation[] {
  const byPath = new Map<string, DiffFile>();
  for (const f of files) {
    byPath.set(f.path, f);
  }

  return annotations.map((ann) => {
    const file = byPath.get(ann.filePath);
    if (!file) {
      return {
        ...ann,
        stale: true,
        staleReason: 'File is no longer in the current diff.',
      };
    }

    if (ann.fileFingerprint && file.fingerprint && ann.fileFingerprint === file.fingerprint) {
      return { ...ann, stale: false, staleReason: undefined };
    }

    const currentLines = new Map<number, string>();
    for (const h of file.hunks) {
      for (const l of h.lines) {
        const ln = ann.side === 'old' ? l.oldLine : l.newLine;
        if (ln !== null) {
          currentLines.set(ln, l.content.trim());
        }
      }
    }

    const hasRangeLine = currentLines.has(ann.startLine) || currentLines.has(ann.endLine);
    if (!hasRangeLine && file.hunks.length > 0) {
      return {
        ...ann,
        stale: true,
        staleReason: 'Referenced line range is no longer present in the diff.',
      };
    }

    if (ann.codeSnippet && ann.fileFingerprint && ann.fileFingerprint !== file.fingerprint) {
      const firstSnippetLine = ann.codeSnippet
        .split('\n')[0]
        ?.replace(/^\d+\s*\|\s*[+\-\s]?/, '')
        .trim();
      const targetText = currentLines.get(ann.startLine);
      if (firstSnippetLine && targetText !== undefined && targetText !== firstSnippetLine) {
        return {
          ...ann,
          stale: true,
          staleReason: 'Anchored line content changed since this annotation was saved.',
        };
      }
    }

    return { ...ann, stale: false, staleReason: undefined };
  });
}
