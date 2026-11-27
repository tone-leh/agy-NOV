import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalRealpathSync,
  isPathInsideDir,
  isSamePath,
} from '../../core/utils.js';
import { isSensitiveTurboPath, TURBO_MAX_TOOL_TEXT_BYTES } from './core.js';

export type DepEcosystem = 'node' | 'python' | 'go' | 'rust' | 'unknown';

export interface DepContractSignature {
  line: number;
  kind: string;
  signature: string;
  sourceFile?: string;
}

export interface DepContractOptions {
  symbolFilter?: string;
  maxBytes?: number;
}

export interface DepContractResult {
  found: boolean;
  ecosystem: DepEcosystem;
  packageName: string;
  version: string | null;
  entryFile: string | null;
  exportsSummary: string;
  signatures: DepContractSignature[];
  snippet: string;
  totalBytes: number;
  truncated: boolean;
  note?: string;
}

const MAX_PACKAGE_NAME_LEN = 180;
const MAX_SYMBOL_FILTER_LEN = 128;
const MAX_SINGLE_CONTRACT_FILE_BYTES = 512 * 1024;
const MAX_REEXPORT_DEPTH = 2;
const MAX_REEXPORT_FILES = 8;
const MAX_TOTAL_DTS_BYTES = 768 * 1024;
const MAX_SIGNATURES_COLLECTED = 80;
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;
const WINDOWS_DRIVE_RE = /^[A-Za-z]:/;

interface SafePathCheck {
  status: 'ok' | 'missing' | 'escaped' | 'invalid';
  realPath?: string;
  relPath?: string;
  isFile?: boolean;
  isDirectory?: boolean;
  size?: number;
  reason?: string;
}

function utf8ByteLengthOfCodePoint(cp: number): number {
  if (cp <= 0x7f) return 1;
  if (cp <= 0x7ff) return 2;
  if (cp <= 0xffff) return 3;
  return 4;
}

function truncateToUtf8BytesSafe(input: string, maxBytes: number): string {
  if (maxBytes <= 0 || input.length === 0) return '';
  if (Buffer.byteLength(input, 'utf8') <= maxBytes) return input;

  let bytes = 0;
  let i = 0;
  while (i < input.length) {
    const codeUnit = input.charCodeAt(i);
    let cp = codeUnit;
    let step = 1;
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        cp = ((codeUnit - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        step = 2;
      }
    }
    const charBytes =
      codeUnit >= 0xd800 && codeUnit <= 0xdfff && step === 1
        ? 3
        : utf8ByteLengthOfCodePoint(cp);
    if (bytes + charBytes > maxBytes) {
      break;
    }
    bytes += charBytes;
    i += step;
  }
  return input.slice(0, i);
}

function clampContractSnippet(
  rawSnippet: string,
  maxBytes: number,
  pkgLabel: string,
): { snippet: string; totalBytes: number; truncated: boolean } {
  const limit = Math.max(
    512,
    Math.min(
      Math.floor(Number.isFinite(maxBytes) ? maxBytes : TURBO_MAX_TOOL_TEXT_BYTES),
      TURBO_MAX_TOOL_TEXT_BYTES,
    ),
  );
  const rawBytes = Buffer.byteLength(rawSnippet, 'utf8');
  if (rawBytes <= limit) {
    return { snippet: rawSnippet, totalBytes: rawBytes, truncated: false };
  }

  const suffix = `\n\n[Dep contract truncated from ${rawBytes} bytes to <=${limit} bytes for ${pkgLabel}. Use symbolFilter to narrow exported signatures.]`;
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  const bodyBudget = Math.max(0, limit - suffixBytes);
  let prefix = truncateToUtf8BytesSafe(rawSnippet, bodyBudget);
  const lastNl = prefix.lastIndexOf('\n');
  if (lastNl > 0 && lastNl >= Math.floor(prefix.length * 0.75)) {
    prefix = prefix.slice(0, lastNl);
  }
  let finalText = `${prefix}${suffix}`;
  let finalBytes = Buffer.byteLength(finalText, 'utf8');
  if (finalBytes > limit) {
    finalText = truncateToUtf8BytesSafe(finalText, limit);
    finalBytes = Buffer.byteLength(finalText, 'utf8');
  }
  return { snippet: finalText, totalBytes: finalBytes, truncated: true };
}

export function validatePackageName(rawName: string): string {
  if (typeof rawName !== 'string') {
    throw new Error('Package name must be a non-empty string');
  }
  const trimmed = rawName.trim();
  if (!trimmed || trimmed.length > MAX_PACKAGE_NAME_LEN) {
    throw new Error(`Invalid package name length (expected 1-${MAX_PACKAGE_NAME_LEN} chars)`);
  }
  if (
    CONTROL_CHAR_RE.test(trimmed) ||
    trimmed.includes('\\') ||
    trimmed.includes('..') ||
    trimmed.startsWith('/') ||
    WINDOWS_DRIVE_RE.test(trimmed) ||
    /\s/.test(trimmed)
  ) {
    throw new Error(`Invalid package name rejected by security policy: ${trimmed}`);
  }

  const segments = trimmed.split('/');
  if (segments.length === 0 || segments.length > 8) {
    throw new Error(`Invalid package name segment count: ${trimmed}`);
  }

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (!seg || seg === '.' || seg === '..') {
      throw new Error(`Invalid package path segment in: ${trimmed}`);
    }
    if (i === 0 && seg.startsWith('@')) {
      if (segments.length < 2 || !/^@[A-Za-z0-9][A-Za-z0-9._-]*$/.test(seg)) {
        throw new Error(`Invalid scoped package name: ${trimmed}`);
      }
      continue;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(seg)) {
      throw new Error(`Invalid package name characters: ${trimmed}`);
    }
  }

  return trimmed;
}

function normalizeSymbolFilter(rawFilter?: string): string | null {
  if (typeof rawFilter !== 'string') return null;
  const trimmed = rawFilter.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_SYMBOL_FILTER_LEN || CONTROL_CHAR_RE.test(trimmed)) {
    throw new Error('Invalid symbolFilter parameter');
  }
  return trimmed;
}

function checkWorkspacePathSafe(
  realRoot: string,
  candidateAbs: string,
): SafePathCheck {
  const normalizedCandidate = path.resolve(candidateAbs);
  if (!isPathInsideDir(realRoot, normalizedCandidate)) {
    return { status: 'escaped', reason: 'Lexical path escapes workspace boundary' };
  }

  let lstat: fs.Stats;
  try {
    lstat = fs.lstatSync(normalizedCandidate);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { status: 'missing' };
    }
    return { status: 'invalid', reason: `Cannot lstat path: ${code ?? 'unknown'}` };
  }

  let realTarget: string;
  try {
    realTarget = canonicalRealpathSync(normalizedCandidate);
  } catch {
    if (lstat.isSymbolicLink()) {
      return { status: 'escaped', reason: 'Dangling or unreadable symlink rejected' };
    }
    return { status: 'missing' };
  }

  if (!isPathInsideDir(realRoot, realTarget)) {
    return {
      status: 'escaped',
      reason: `Symlink target escapes workspace boundary (${path.relative(realRoot, normalizedCandidate)})`,
    };
  }

  let targetStat: fs.Stats;
  try {
    targetStat = fs.statSync(realTarget);
  } catch {
    return { status: 'invalid', reason: 'Cannot stat resolved path' };
  }

  const relPath =
    isSamePath(realTarget, realRoot) ? '.' : path.relative(realRoot, realTarget).replace(/\\/g, '/');

  return {
    status: 'ok',
    realPath: realTarget,
    relPath,
    isFile: targetStat.isFile(),
    isDirectory: targetStat.isDirectory(),
    size: targetStat.size,
  };
}

function assertNotEscaped(check: SafePathCheck, label: string): void {
  if (check.status === 'escaped') {
    throw new Error(`Path escapes workspace boundary (${label}): ${check.reason ?? 'symlink escape'}`);
  }
}

function isWithinRealDir(realTarget: string, realDir: string): boolean {
  return isPathInsideDir(realDir, realTarget);
}

function readWorkspaceFileSafe(
  realRoot: string,
  candidateAbs: string,
  label: string,
  allowNodeModules = false,
  requiredDirReal?: string,
): { content: string; relPath: string; realPath: string } | null {
  const check = checkWorkspacePathSafe(realRoot, candidateAbs);
  assertNotEscaped(check, label);
  if (check.status !== 'ok' || !check.isFile || !check.realPath || !check.relPath) {
    return null;
  }
  if (requiredDirReal && !isWithinRealDir(check.realPath, requiredDirReal)) {
    throw new Error(`Path escapes package boundary (${label}): ${check.relPath}`);
  }
  const relPosix = check.relPath.split(path.sep).join('/');
  const inAllowedDepDir =
    allowNodeModules &&
    (relPosix.startsWith('node_modules/') ||
      relPosix.startsWith('.venv/') ||
      relPosix.startsWith('venv/'));
  if (!inAllowedDepDir && isSensitiveTurboPath(check.relPath)) {
    throw new Error(`Refused to inspect sensitive path: ${check.relPath}`);
  }
  // Even inside node_modules/.venv, always refuse .env or private key basenames
  if (inAllowedDepDir && isSensitiveTurboPath(path.basename(check.realPath))) {
    throw new Error(`Refused to inspect sensitive path: ${check.relPath}`);
  }
  if ((check.size ?? 0) > MAX_SINGLE_CONTRACT_FILE_BYTES) {
    return null;
  }
  try {
    const content = fs.readFileSync(check.realPath, 'utf8');
    return { content, relPath: check.relPath, realPath: check.realPath };
  } catch {
    return null;
  }
}

function summarizeExportsField(exportsField: unknown, mainField?: unknown, typesField?: unknown): string {
  const parts: string[] = [];
  if (typeof typesField === 'string' && typesField.trim()) {
    parts.push(`types=${typesField.trim()}`);
  }
  if (typeof mainField === 'string' && mainField.trim()) {
    parts.push(`main=${mainField.trim()}`);
  }
  if (typeof exportsField === 'string' && exportsField.trim()) {
    parts.push(`exports=${exportsField.trim()}`);
  } else if (exportsField && typeof exportsField === 'object' && !Array.isArray(exportsField)) {
    const rec = exportsField as Record<string, unknown>;
    const keys = Object.keys(rec).slice(0, 10);
    if (keys.length > 0) {
      const formatted = keys.map((k) => {
        const val = rec[k];
        if (typeof val === 'string') return `${k}→${val}`;
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const cond = val as Record<string, unknown>;
          const target =
            (typeof cond.types === 'string' && cond.types) ||
            (typeof cond.import === 'string' && cond.import) ||
            (typeof cond.default === 'string' && cond.default) ||
            (typeof cond.require === 'string' && cond.require) ||
            'object';
          return `${k}→${target}`;
        }
        return k;
      });
      const extra = Object.keys(rec).length > keys.length ? `, +${Object.keys(rec).length - keys.length} more` : '';
      parts.push(`exports=[${formatted.join(', ')}${extra}]`);
    }
  }
  return parts.join(' | ') || '(no explicit exports metadata)';
}

function extractTypesPathFromExportEntry(entry: unknown, depth = 0): string | null {
  if (depth > 3 || !entry) return null;
  if (typeof entry === 'string') {
    return /\.(?:d\.ts|d\.cts|d\.mts)$/.test(entry) ? entry : null;
  }
  if (typeof entry === 'object' && !Array.isArray(entry)) {
    const rec = entry as Record<string, unknown>;
    if (typeof rec.types === 'string' && rec.types.trim()) return rec.types.trim();
    for (const key of ['import', 'default', 'require', 'node', 'browser']) {
      const nested = extractTypesPathFromExportEntry(rec[key], depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function mapJsSpecifierToDtsCandidates(baseDir: string, specifier: string): string[] {
  const clean = specifier.trim();
  if (!clean.startsWith('.') || clean.includes('\0') || clean.includes('\\')) return [];
  const rawAbs = path.resolve(baseDir, clean);
  const candidates: string[] = [];

  if (/\.(?:d\.ts|d\.cts|d\.mts)$/.test(rawAbs)) {
    candidates.push(rawAbs);
  } else if (/\.js$/.test(rawAbs)) {
    candidates.push(rawAbs.replace(/\.js$/, '.d.ts'));
    candidates.push(rawAbs.replace(/\.js$/, '.d.mts'));
    candidates.push(rawAbs.replace(/\.js$/, '.d.cts'));
  } else if (/\.cjs$/.test(rawAbs)) {
    candidates.push(rawAbs.replace(/\.cjs$/, '.d.cts'));
    candidates.push(rawAbs.replace(/\.cjs$/, '.d.ts'));
  } else if (/\.mjs$/.test(rawAbs)) {
    candidates.push(rawAbs.replace(/\.mjs$/, '.d.mts'));
    candidates.push(rawAbs.replace(/\.mjs$/, '.d.ts'));
  } else {
    candidates.push(`${rawAbs}.d.ts`);
    candidates.push(`${rawAbs}.d.cts`);
    candidates.push(`${rawAbs}.d.mts`);
    candidates.push(path.join(rawAbs, 'index.d.ts'));
    candidates.push(path.join(rawAbs, 'index.d.cts'));
    candidates.push(path.join(rawAbs, 'index.d.mts'));
  }

  return Array.from(new Set(candidates));
}

function compactSignatureLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim().slice(0, 180);
}

interface ParsedDtsOutput {
  signatures: DepContractSignature[];
  reexportSpecifiers: string[];
}

function parseDtsSignaturesLinear(content: string, sourceFile: string): ParsedDtsOutput {
  const lines = content.split(/\r?\n/);
  const signatures: DepContractSignature[] = [];
  const reexportSpecifiers: string[] = [];
  let inBlockComment = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    let code = '';
    let idx = 0;

    while (idx < rawLine.length) {
      if (inBlockComment) {
        const end = rawLine.indexOf('*/', idx);
        if (end === -1) {
          idx = rawLine.length;
          break;
        }
        inBlockComment = false;
        idx = end + 2;
        continue;
      }
      if (rawLine[idx] === '/' && rawLine[idx + 1] === '*') {
        inBlockComment = true;
        idx += 2;
        continue;
      }
      if (rawLine[idx] === '/' && rawLine[idx + 1] === '/') {
        break;
      }
      code += rawLine[idx];
      idx += 1;
    }

    const trimmed = code.trim();
    const depthBefore = braceDepth;

    // Linear brace depth tracking (outside strings)
    let inStr: string | null = null;
    for (let j = 0; j < code.length; j += 1) {
      const ch = code[j];
      if (inStr) {
        if (ch === '\\') {
          j += 1;
        } else if (ch === inStr) {
          inStr = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        inStr = ch;
      } else if (ch === '{') {
        braceDepth += 1;
      } else if (ch === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
      }
    }

    if (!trimmed || depthBefore > 0) continue;

    // Detect relative re-exports: `export * from "./foo.js"` or `export { a, b } from "./foo.js"`
    if (trimmed.startsWith('export ')) {
      const fromIdx = trimmed.indexOf(' from ');
      if (fromIdx > 0) {
        const tail = trimmed.slice(fromIdx + 6).trim();
        const quote = tail[0];
        if (quote === '"' || quote === "'") {
          const endQuote = tail.indexOf(quote, 1);
          if (endQuote > 1) {
            const spec = tail.slice(1, endQuote);
            if (spec.startsWith('.')) {
              reexportSpecifiers.push(spec);
            }
          }
        }
      }
    }

    const lineNum = i + 1;
    let kind: string | null = null;

    if (/^export\s+(?:declare\s+)?(?:async\s+)?function\b/.test(trimmed) || /^declare\s+(?:async\s+)?function\b/.test(trimmed)) {
      kind = 'function';
    } else if (/^export\s+(?:declare\s+)?(?:abstract\s+)?class\b/.test(trimmed) || /^declare\s+(?:abstract\s+)?class\b/.test(trimmed)) {
      kind = 'class';
    } else if (/^export\s+(?:declare\s+)?interface\b/.test(trimmed) || /^declare\s+interface\b/.test(trimmed)) {
      kind = 'interface';
    } else if (/^export\s+(?:declare\s+)?type\b/.test(trimmed) || /^declare\s+type\b/.test(trimmed)) {
      kind = 'type';
    } else if (/^export\s+(?:declare\s+)?(?:const|let|var)\b/.test(trimmed) || /^declare\s+(?:const|let|var)\b/.test(trimmed)) {
      kind = 'const';
    } else if (/^export\s+(?:declare\s+)?(?:const\s+)?enum\b/.test(trimmed) || /^declare\s+(?:const\s+)?enum\b/.test(trimmed)) {
      kind = 'enum';
    } else if (/^export\s+(?:declare\s+)?(?:namespace|module)\b/.test(trimmed) || /^declare\s+(?:namespace|module)\b/.test(trimmed)) {
      kind = 'namespace';
    } else if (/^export\s+default\b/.test(trimmed)) {
      kind = 'default';
    } else if (/^export\s+(?:type\s+)?(?:\*|\{)/.test(trimmed)) {
      kind = 'reexport';
    }

    if (kind) {
      signatures.push({
        line: lineNum,
        kind,
        signature: compactSignatureLine(trimmed),
        sourceFile,
      });
    }
  }

  return { signatures, reexportSpecifiers };
}

function filterSignatures(
  allSignatures: DepContractSignature[],
  symbolFilter: string | null,
): DepContractSignature[] {
  if (!symbolFilter) return allSignatures.slice(0, MAX_SIGNATURES_COLLECTED);
  const needle = symbolFilter.toLowerCase();
  const matched = allSignatures.filter((s) => s.signature.toLowerCase().includes(needle));
  return matched.slice(0, MAX_SIGNATURES_COLLECTED);
}

function buildFormattedSnippet(params: {
  packageName: string;
  ecosystem: DepEcosystem;
  version: string | null;
  entryFile: string | null;
  description?: string;
  exportsSummary: string;
  signatures: DepContractSignature[];
  symbolFilter: string | null;
  note?: string;
}): string {
  const lines: string[] = [
    `[Dep Contract] ${params.packageName}${params.version ? `@${params.version}` : ''} (${params.ecosystem})`,
  ];
  if (params.description) {
    lines.push(`Description: ${params.description.replace(/\s+/g, ' ').trim().slice(0, 180)}`);
  }
  if (params.entryFile) {
    lines.push(`Entry: ${params.entryFile}`);
  }
  lines.push(`Exports: ${params.exportsSummary}`);
  if (params.symbolFilter) {
    lines.push(`Filter: "${params.symbolFilter}" (${params.signatures.length} matched)`);
  }
  if (params.note) {
    lines.push(`Note: ${params.note}`);
  }
  if (params.signatures.length > 0) {
    lines.push(`Signatures (${params.signatures.length}):`);
    for (const sig of params.signatures) {
      const fileTag = sig.sourceFile && sig.sourceFile !== params.entryFile ? ` (${path.posix.basename(sig.sourceFile)})` : '';
      lines.push(`  L${sig.line} [${sig.kind}]${fileTag} ${sig.signature}`);
    }
  } else {
    lines.push('Signatures: (none extracted)');
  }
  return lines.join('\n');
}

function inspectNodeDep(
  realRoot: string,
  packageName: string,
  symbolFilter: string | null,
  maxBytes: number,
): DepContractResult | null {
  const segments = packageName.split('/');
  const isScoped = packageName.startsWith('@');
  if ((isScoped && segments.length !== 2) || (!isScoped && segments.length !== 1)) {
    return null;
  }

  const pkgDirCandidate = path.join(realRoot, 'node_modules', ...segments);
  const pkgDirCheck = checkWorkspacePathSafe(realRoot, pkgDirCandidate);
  assertNotEscaped(pkgDirCheck, `node_modules/${packageName}`);
  if (pkgDirCheck.status !== 'ok' || !pkgDirCheck.isDirectory || !pkgDirCheck.realPath) {
    return null;
  }

  const pkgRealDir = pkgDirCheck.realPath;
  const pkgJsonPath = path.join(pkgRealDir, 'package.json');
  const pkgJsonFile = readWorkspaceFileSafe(
    realRoot,
    pkgJsonPath,
    `${packageName}/package.json`,
    true,
    pkgRealDir,
  );
  if (!pkgJsonFile) {
    return null;
  }

  let pkgJson: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(pkgJsonFile.content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    pkgJson = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const version = typeof pkgJson.version === 'string' ? pkgJson.version.trim() : null;
  const description = typeof pkgJson.description === 'string' ? pkgJson.description.trim() : undefined;
  const exportsSummary = summarizeExportsField(pkgJson.exports, pkgJson.main, pkgJson.types ?? pkgJson.typings);

  // Build prioritized candidate list for primary .d.ts entry
  const dtsCandidates: string[] = [];
  if (pkgJson.exports && typeof pkgJson.exports === 'object' && !Array.isArray(pkgJson.exports)) {
    const rootExp = (pkgJson.exports as Record<string, unknown>)['.'];
    const expTypes = extractTypesPathFromExportEntry(rootExp ?? pkgJson.exports);
    if (expTypes) {
      dtsCandidates.push(path.resolve(pkgRealDir, expTypes));
    }
  }
  for (const field of [pkgJson.types, pkgJson.typings]) {
    if (typeof field === 'string' && field.trim()) {
      dtsCandidates.push(path.resolve(pkgRealDir, field.trim()));
    }
  }
  if (typeof pkgJson.main === 'string' && pkgJson.main.trim()) {
    const mainNorm = pkgJson.main.trim();
    const spec = mainNorm.startsWith('.') ? mainNorm : `./${mainNorm}`;
    dtsCandidates.push(...mapJsSpecifierToDtsCandidates(pkgRealDir, spec));
  }
  dtsCandidates.push(
    path.join(pkgRealDir, 'index.d.ts'),
    path.join(pkgRealDir, 'index.d.cts'),
    path.join(pkgRealDir, 'index.d.mts'),
    path.join(pkgRealDir, 'dist', 'index.d.ts'),
    path.join(pkgRealDir, 'lib', 'index.d.ts'),
    path.join(pkgRealDir, 'types', 'index.d.ts'),
  );

  // Fallback to @types/<pkg>/index.d.ts
  const typesPkgName = isScoped ? `${segments[0].slice(1)}__${segments[1]}` : segments[0];
  const atTypesDirAbs = path.join(realRoot, 'node_modules', '@types', typesPkgName);
  const atTypesCheck = checkWorkspacePathSafe(realRoot, atTypesDirAbs);
  const atTypesRealDir = atTypesCheck.status === 'ok' && atTypesCheck.isDirectory ? atTypesCheck.realPath : undefined;
  const atTypesIndex = path.join(atTypesRealDir ?? atTypesDirAbs, 'index.d.ts');
  dtsCandidates.push(atTypesIndex);

  let primaryDts: { content: string; relPath: string; realPath: string } | null = null;
  let primaryAllowedDir = pkgRealDir;
  for (const cand of Array.from(new Set(dtsCandidates))) {
    const isAtTypes = cand === atTypesIndex;
    if (isAtTypes && !atTypesRealDir) continue;
    if (!isAtTypes && !isPathInsideDir(pkgRealDir, cand)) {
      throw new Error(`Package declaration path escapes package directory: ${packageName}`);
    }
    const boundaryDir = isAtTypes ? atTypesRealDir! : pkgRealDir;
    const read = readWorkspaceFileSafe(realRoot, cand, `${packageName} types`, true, boundaryDir);
    if (read) {
      primaryDts = read;
      primaryAllowedDir = boundaryDir;
      break;
    }
  }

  const collectedSignatures: DepContractSignature[] = [];
  let entryFile: string | null = primaryDts ? primaryDts.relPath : pkgJsonFile.relPath;
  let note: string | undefined;

  if (primaryDts) {
    const visited = new Set<string>();
    let totalReadBytes = 0;
    const queue: Array<{ file: { content: string; relPath: string; realPath: string }; depth: number }> = [
      { file: primaryDts, depth: 0 },
    ];
    visited.add(primaryDts.realPath);
    totalReadBytes += Buffer.byteLength(primaryDts.content, 'utf8');

    while (queue.length > 0 && visited.size <= MAX_REEXPORT_FILES) {
      const current = queue.shift()!;
      const parsed = parseDtsSignaturesLinear(current.file.content, current.file.relPath);
      collectedSignatures.push(...parsed.signatures);

      if (current.depth >= MAX_REEXPORT_DEPTH) continue;
      // Only follow relative re-exports when file contains re-exports (common in barrel index.d.ts like zod v4)
      for (const spec of parsed.reexportSpecifiers) {
        if (visited.size >= MAX_REEXPORT_FILES || totalReadBytes >= MAX_TOTAL_DTS_BYTES) break;
        const nextCandidates = mapJsSpecifierToDtsCandidates(path.dirname(current.file.realPath), spec);
        for (const nextAbs of nextCandidates) {
          if (!isWithinRealDir(nextAbs, primaryAllowedDir)) {
            continue;
          }
          if (visited.has(nextAbs)) break;
          const nextRead = readWorkspaceFileSafe(
            realRoot,
            nextAbs,
            `${packageName} reexport`,
            true,
            primaryAllowedDir,
          );
          if (nextRead) {
            if (visited.has(nextRead.realPath)) break;
            visited.add(nextRead.realPath);
            totalReadBytes += Buffer.byteLength(nextRead.content, 'utf8');
            queue.push({ file: nextRead, depth: current.depth + 1 });
            break;
          }
        }
      }
    }
  } else {
    note = 'No .d.ts declaration file found; showing package.json metadata only.';
  }

  // Prefer concrete declarations over raw `export *` re-exports when both are available
  const concrete = collectedSignatures.filter((s) => s.kind !== 'reexport');
  const ordered = concrete.length > 0 ? [...concrete, ...collectedSignatures.filter((s) => s.kind === 'reexport')] : collectedSignatures;
  const filtered = filterSignatures(ordered, symbolFilter);

  const rawSnippet = buildFormattedSnippet({
    packageName,
    ecosystem: 'node',
    version,
    entryFile,
    description,
    exportsSummary,
    signatures: filtered,
    symbolFilter,
    note,
  });
  const clamped = clampContractSnippet(rawSnippet, maxBytes, packageName);

  return {
    found: true,
    ecosystem: 'node',
    packageName,
    version,
    entryFile,
    exportsSummary,
    signatures: filtered,
    snippet: clamped.snippet,
    totalBytes: clamped.totalBytes,
    truncated: clamped.truncated,
    note,
  };
}

function parsePythonSignaturesLinear(content: string, sourceFile: string): DepContractSignature[] {
  const lines = content.split(/\r?\n/);
  const signatures: DepContractSignature[] = [];
  let inTripleQuote: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (inTripleQuote) {
      if (raw.includes(inTripleQuote)) {
        inTripleQuote = null;
      }
      continue;
    }
    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
      const marker = trimmed.slice(0, 3);
      if (trimmed.indexOf(marker, 3) === -1) {
        inTripleQuote = marker;
      }
      continue;
    }
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Top-level declarations only (no leading indentation)
    if (raw.startsWith(' ') || raw.startsWith('\t')) continue;

    if (/^(?:async\s+)?def\s+[A-Za-z_][A-Za-z0-9_]*/.test(trimmed)) {
      signatures.push({
        line: i + 1,
        kind: 'def',
        signature: compactSignatureLine(trimmed),
        sourceFile,
      });
    } else if (/^class\s+[A-Za-z_][A-Za-z0-9_]*/.test(trimmed)) {
      signatures.push({
        line: i + 1,
        kind: 'class',
        signature: compactSignatureLine(trimmed),
        sourceFile,
      });
    }
  }
  return signatures;
}

function normalizePyName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '_');
}

function findPythonSitePackagesDirs(realRoot: string): string[] {
  const dirs: string[] = [];
  for (const venvName of ['.venv', 'venv']) {
    const venvAbs = path.join(realRoot, venvName);
    const venvCheck = checkWorkspacePathSafe(realRoot, venvAbs);
    assertNotEscaped(venvCheck, venvName);
    if (venvCheck.status !== 'ok' || !venvCheck.isDirectory || !venvCheck.realPath) continue;

    const winSite = path.join(venvCheck.realPath, 'Lib', 'site-packages');
    const winCheck = checkWorkspacePathSafe(realRoot, winSite);
    assertNotEscaped(winCheck, `${venvName}/Lib/site-packages`);
    if (winCheck.status === 'ok' && winCheck.isDirectory && winCheck.realPath) {
      dirs.push(winCheck.realPath);
    }

    const unixLib = path.join(venvCheck.realPath, 'lib');
    const unixLibCheck = checkWorkspacePathSafe(realRoot, unixLib);
    assertNotEscaped(unixLibCheck, `${venvName}/lib`);
    if (unixLibCheck.status === 'ok' && unixLibCheck.isDirectory && unixLibCheck.realPath) {
      try {
        const subEntries = fs.readdirSync(unixLibCheck.realPath, { withFileTypes: true });
        for (const sub of subEntries) {
          if (!sub.name.startsWith('python')) continue;
          const sp = path.join(unixLibCheck.realPath, sub.name, 'site-packages');
          const spCheck = checkWorkspacePathSafe(realRoot, sp);
          assertNotEscaped(spCheck, `${venvName}/lib/${sub.name}/site-packages`);
          if (spCheck.status === 'ok' && spCheck.isDirectory && spCheck.realPath) {
            dirs.push(spCheck.realPath);
          }
        }
      } catch {
        // ignore unreadable lib dir
      }
    }
  }
  return dirs;
}

function inspectPythonDep(
  realRoot: string,
  packageName: string,
  symbolFilter: string | null,
  maxBytes: number,
): DepContractResult | null {
  if (packageName.includes('/') || packageName.startsWith('@')) return null;

  const normTarget = normalizePyName(packageName);
  let version: string | null = null;
  let description: string | undefined;
  let entryFile: string | null = null;
  const signatures: DepContractSignature[] = [];
  let foundInVenv = false;

  const siteDirs = findPythonSitePackagesDirs(realRoot);
  for (const spDir of siteDirs) {
    // Check dist-info metadata for exact locked version
    try {
      const entries = fs.readdirSync(spDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.name.endsWith('.dist-info')) continue;
        const base = entry.name.slice(0, -'.dist-info'.length);
        const dashIdx = base.lastIndexOf('-');
        if (dashIdx <= 0) continue;
        const distPkg = normalizePyName(base.slice(0, dashIdx));
        if (distPkg !== normTarget) continue;

        const metaPath = path.join(spDir, entry.name, 'METADATA');
        const metaRead = readWorkspaceFileSafe(realRoot, metaPath, `${packageName} METADATA`, true, spDir);
        if (metaRead) {
          foundInVenv = true;
          for (const line of metaRead.content.split(/\r?\n/)) {
            if (line.startsWith('Version:')) {
              version = line.slice('Version:'.length).trim();
            } else if (line.startsWith('Summary:') && !description) {
              description = line.slice('Summary:'.length).trim();
            }
          }
        }
      }
    } catch {
      // ignore unreadable site-packages
    }

    const candidates = [
      path.join(spDir, normTarget, '__init__.pyi'),
      path.join(spDir, normTarget, '__init__.py'),
      path.join(spDir, packageName, '__init__.pyi'),
      path.join(spDir, packageName, '__init__.py'),
      path.join(spDir, `${normTarget}.pyi`),
      path.join(spDir, `${normTarget}.py`),
    ];

    for (const cand of Array.from(new Set(candidates))) {
      const read = readWorkspaceFileSafe(realRoot, cand, `${packageName} python stub`, true, spDir);
      if (read) {
        foundInVenv = true;
        entryFile = read.relPath;
        signatures.push(...parsePythonSignaturesLinear(read.content, read.relPath));
        break;
      }
    }

    if (foundInVenv) break;
  }

  // Check requirements.txt & pyproject.toml for version declaration
  let manifestSource: string | null = null;
  if (!version) {
    const reqFile = readWorkspaceFileSafe(realRoot, path.join(realRoot, 'requirements.txt'), 'requirements.txt');
    if (reqFile) {
      const lines = reqFile.content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const clean = lines[i].split('#')[0].split(';')[0].trim();
        if (!clean || clean.startsWith('-')) continue;
        const m = /^([A-Za-z0-9._-]+)(?:\[[^\]]*\])?\s*(==|>=|<=|~=|!=|>|<)?\s*([^\s,]+)?/.exec(clean);
        if (m && normalizePyName(m[1]) === normTarget) {
          version = m[2] && m[3] ? `${m[2] === '==' ? '' : m[2]}${m[3]}` : 'declared';
          manifestSource = 'requirements.txt';
          if (!entryFile) entryFile = reqFile.relPath;
          if (signatures.length === 0) {
            signatures.push({
              line: i + 1,
              kind: 'requirement',
              signature: clean.slice(0, 180),
              sourceFile: reqFile.relPath,
            });
          }
          break;
        }
      }
    }
  }

  if (!version) {
    const pyproj = readWorkspaceFileSafe(realRoot, path.join(realRoot, 'pyproject.toml'), 'pyproject.toml');
    if (pyproj) {
      const lines = pyproj.content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const trimmed = lines[i].trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        // Match `"pkg==1.2.3"` in dependencies array or `pkg = "^1.2.3"` in poetry table
        const quoteMatch = /["']([A-Za-z0-9._-]+)(?:\[[^\]]*\])?\s*(==|>=|<=|~=|!=|>|<)?\s*([^"';,\s]+)?["']/.exec(trimmed);
        if (quoteMatch && normalizePyName(quoteMatch[1]) === normTarget) {
          version =
            quoteMatch[2] && quoteMatch[3]
              ? `${quoteMatch[2] === '==' ? '' : quoteMatch[2]}${quoteMatch[3]}`
              : 'declared';
          manifestSource = 'pyproject.toml';
          if (!entryFile) entryFile = pyproj.relPath;
          if (signatures.length === 0) {
            signatures.push({
              line: i + 1,
              kind: 'dependency',
              signature: trimmed.slice(0, 180),
              sourceFile: pyproj.relPath,
            });
          }
          break;
        }
        const kvMatch = /^([A-Za-z0-9._-]+)\s*=\s*["']([^"']+)["']/.exec(trimmed);
        if (kvMatch && normalizePyName(kvMatch[1]) === normTarget) {
          version = kvMatch[2].trim();
          manifestSource = 'pyproject.toml';
          if (!entryFile) entryFile = pyproj.relPath;
          if (signatures.length === 0) {
            signatures.push({
              line: i + 1,
              kind: 'dependency',
              signature: trimmed.slice(0, 180),
              sourceFile: pyproj.relPath,
            });
          }
          break;
        }
      }
    }
  }

  if (!foundInVenv && !version) return null;

  const filtered = filterSignatures(signatures, symbolFilter);
  const exportsSummary = foundInVenv
    ? `python site-packages (${entryFile ?? 'metadata'})${manifestSource ? ` + ${manifestSource}` : ''}`
    : `python manifest (${manifestSource ?? 'pyproject.toml'})`;

  const rawSnippet = buildFormattedSnippet({
    packageName,
    ecosystem: 'python',
    version,
    entryFile,
    description,
    exportsSummary,
    signatures: filtered,
    symbolFilter,
  });
  const clamped = clampContractSnippet(rawSnippet, maxBytes, packageName);

  return {
    found: true,
    ecosystem: 'python',
    packageName,
    version,
    entryFile,
    exportsSummary,
    signatures: filtered,
    snippet: clamped.snippet,
    totalBytes: clamped.totalBytes,
    truncated: clamped.truncated,
  };
}

function inspectGoDep(
  realRoot: string,
  packageName: string,
  symbolFilter: string | null,
  maxBytes: number,
): DepContractResult | null {
  const goMod = readWorkspaceFileSafe(realRoot, path.join(realRoot, 'go.mod'), 'go.mod');
  if (!goMod) return null;

  const lines = goMod.content.split(/\r?\n/);
  const lowerPkg = packageName.toLowerCase();
  let inRequireBlock = false;
  let inReplaceBlock = false;
  let matchedModule: string | null = null;
  let matchedVersion: string | null = null;
  const signatures: DepContractSignature[] = [];
  let goToolchain: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const commentIdx = rawLine.indexOf('//');
    const code = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).trim();
    const comment = commentIdx >= 0 ? rawLine.slice(commentIdx).trim() : '';

    if (!code) continue;
    if (code.startsWith('go ')) {
      goToolchain = code.slice(3).trim();
      continue;
    }

    if (code === ')') {
      inRequireBlock = false;
      inReplaceBlock = false;
      continue;
    }
    if (/^require\s*\($/.test(code)) {
      inRequireBlock = true;
      continue;
    }
    if (/^replace\s*\($/.test(code)) {
      inReplaceBlock = true;
      continue;
    }

    const isSingleRequire = code.startsWith('require ');
    if (inRequireBlock || isSingleRequire) {
      const body = isSingleRequire ? code.slice('require '.length).trim() : code;
      const parts = body.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        const modPath = parts[0];
        const modVer = parts[1];
        const lowerMod = modPath.toLowerCase();
        if (lowerMod === lowerPkg || lowerMod.endsWith(`/${lowerPkg}`)) {
          matchedModule = modPath;
          matchedVersion = modVer;
          signatures.push({
            line: i + 1,
            kind: 'require',
            signature: `${modPath} ${modVer}${comment ? ` ${comment}` : ''}`,
            sourceFile: goMod.relPath,
          });
        }
      }
      continue;
    }

    const isSingleReplace = code.startsWith('replace ');
    if (inReplaceBlock || isSingleReplace) {
      const body = isSingleReplace ? code.slice('replace '.length).trim() : code;
      if (body.toLowerCase().includes(lowerPkg)) {
        signatures.push({
          line: i + 1,
          kind: 'replace',
          signature: compactSignatureLine(body),
          sourceFile: goMod.relPath,
        });
      }
    }
  }

  if (!matchedModule) return null;

  const filtered = filterSignatures(signatures, symbolFilter);
  const exportsSummary = `go.mod module=${matchedModule}${goToolchain ? ` | go=${goToolchain}` : ''}`;
  const rawSnippet = buildFormattedSnippet({
    packageName: matchedModule,
    ecosystem: 'go',
    version: matchedVersion,
    entryFile: goMod.relPath,
    exportsSummary,
    signatures: filtered,
    symbolFilter,
  });
  const clamped = clampContractSnippet(rawSnippet, maxBytes, matchedModule);

  return {
    found: true,
    ecosystem: 'go',
    packageName: matchedModule,
    version: matchedVersion,
    entryFile: goMod.relPath,
    exportsSummary,
    signatures: filtered,
    snippet: clamped.snippet,
    totalBytes: clamped.totalBytes,
    truncated: clamped.truncated,
  };
}

function inspectRustDep(
  realRoot: string,
  packageName: string,
  symbolFilter: string | null,
  maxBytes: number,
): DepContractResult | null {
  if (packageName.includes('/') || packageName.startsWith('@')) return null;

  const normTarget = normalizePyName(packageName);
  const cargoLock = readWorkspaceFileSafe(realRoot, path.join(realRoot, 'Cargo.lock'), 'Cargo.lock');

  if (cargoLock) {
    const lines = cargoLock.content.split(/\r?\n/);
    interface CargoPkg {
      name: string;
      version: string | null;
      source: string | null;
      startLine: number;
      dependencies: string[];
    }
    const packages: CargoPkg[] = [];
    let current: CargoPkg | null = null;
    let inDepsArray = false;

    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (trimmed === '[[package]]') {
        if (current) packages.push(current);
        current = { name: '', version: null, source: null, startLine: i + 1, dependencies: [] };
        inDepsArray = false;
        continue;
      }
      if (!current) continue;

      if (inDepsArray) {
        if (trimmed.startsWith(']')) {
          inDepsArray = false;
          continue;
        }
        const depMatch = /"([^"]+)"/.exec(trimmed);
        if (depMatch) current.dependencies.push(depMatch[1]);
        continue;
      }

      const nameMatch = /^name\s*=\s*"([^"]+)"/.exec(trimmed);
      if (nameMatch) {
        current.name = nameMatch[1];
        continue;
      }
      const verMatch = /^version\s*=\s*"([^"]+)"/.exec(trimmed);
      if (verMatch) {
        current.version = verMatch[1];
        continue;
      }
      const srcMatch = /^source\s*=\s*"([^"]+)"/.exec(trimmed);
      if (srcMatch) {
        current.source = srcMatch[1];
        continue;
      }
      if (/^dependencies\s*=\s*\[/.test(trimmed)) {
        if (!trimmed.includes(']')) {
          inDepsArray = true;
        } else {
          const inlineDeps = trimmed.match(/"([^"]+)"/g);
          if (inlineDeps) {
            for (const d of inlineDeps) current.dependencies.push(d.slice(1, -1));
          }
        }
      }
    }
    if (current) packages.push(current);

    const matched = packages.filter((p) => normalizePyName(p.name) === normTarget);
    if (matched.length > 0) {
      const primary = matched[0];
      const signatures: DepContractSignature[] = [];
      for (const pkg of matched) {
        signatures.push({
          line: pkg.startLine,
          kind: 'crate',
          signature: `${pkg.name}@${pkg.version ?? 'unknown'}${pkg.source ? ` (${pkg.source})` : ''}`,
          sourceFile: cargoLock.relPath,
        });
        for (const dep of pkg.dependencies.slice(0, 20)) {
          signatures.push({
            line: pkg.startLine,
            kind: 'dependency',
            signature: `depends on ${dep}`,
            sourceFile: cargoLock.relPath,
          });
        }
      }

      const filtered = filterSignatures(signatures, symbolFilter);
      const exportsSummary = `Cargo.lock crate=${primary.name} | versions=${matched.map((m) => m.version ?? '?').join(', ')} | deps=${primary.dependencies.length}`;
      const rawSnippet = buildFormattedSnippet({
        packageName: primary.name,
        ecosystem: 'rust',
        version: primary.version,
        entryFile: cargoLock.relPath,
        exportsSummary,
        signatures: filtered,
        symbolFilter,
      });
      const clamped = clampContractSnippet(rawSnippet, maxBytes, primary.name);

      return {
        found: true,
        ecosystem: 'rust',
        packageName: primary.name,
        version: primary.version,
        entryFile: cargoLock.relPath,
        exportsSummary,
        signatures: filtered,
        snippet: clamped.snippet,
        totalBytes: clamped.totalBytes,
        truncated: clamped.truncated,
      };
    }
  }

  // Fallback to Cargo.toml dependency entry
  const cargoToml = readWorkspaceFileSafe(realRoot, path.join(realRoot, 'Cargo.toml'), 'Cargo.toml');
  if (cargoToml) {
    const lines = cargoToml.content.split(/\r?\n/);
    let inDeps = false;
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('[')) {
        inDeps = /^\[(?:[\w.-]*dependencies[\w.-]*)\]/i.test(trimmed);
        continue;
      }
      if (!inDeps || !trimmed || trimmed.startsWith('#')) continue;
      const m = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(trimmed);
      if (m && normalizePyName(m[1]) === normTarget) {
        const rawVal = m[2].trim();
        const strVer = /^"([^"]+)"/.exec(rawVal)?.[1] ?? /version\s*=\s*"([^"]+)"/.exec(rawVal)?.[1] ?? 'declared';
        const sigs: DepContractSignature[] = [
          {
            line: i + 1,
            kind: 'crate',
            signature: compactSignatureLine(trimmed),
            sourceFile: cargoToml.relPath,
          },
        ];
        const filtered = filterSignatures(sigs, symbolFilter);
        const exportsSummary = `Cargo.toml crate=${m[1]} (${strVer})`;
        const rawSnippet = buildFormattedSnippet({
          packageName: m[1],
          ecosystem: 'rust',
          version: strVer,
          entryFile: cargoToml.relPath,
          exportsSummary,
          signatures: filtered,
          symbolFilter,
        });
        const clamped = clampContractSnippet(rawSnippet, maxBytes, m[1]);
        return {
          found: true,
          ecosystem: 'rust',
          packageName: m[1],
          version: strVer,
          entryFile: cargoToml.relPath,
          exportsSummary,
          signatures: filtered,
          snippet: clamped.snippet,
          totalBytes: clamped.totalBytes,
          truncated: clamped.truncated,
        };
      }
    }
  }

  return null;
}

/**
 * 100% offline read-only inspector for locked dependency API contracts across
 * Node/TypeScript (node_modules + .d.ts / @types), Python (.venv/venv + pyproject/requirements),
 * Go (go.mod), and Rust (Cargo.lock / Cargo.toml).
 */
export function inspectLockedDepContract(
  workspaceRoot: string,
  packageName: string,
  options: DepContractOptions = {},
): DepContractResult {
  if (!workspaceRoot || workspaceRoot.includes('\0')) {
    throw new Error('Invalid workspace root path');
  }
  const cleanPkg = validatePackageName(packageName);
  const symbolFilter = normalizeSymbolFilter(options.symbolFilter);
  const maxBytes = Math.max(
    512,
    Math.min(
      Math.floor(Number.isFinite(options.maxBytes) ? (options.maxBytes as number) : TURBO_MAX_TOOL_TEXT_BYTES),
      TURBO_MAX_TOOL_TEXT_BYTES,
    ),
  );

  const realRoot = canonicalRealpathSync(path.resolve(workspaceRoot));

  // 1. Node / TypeScript (priority)
  const nodeResult = inspectNodeDep(realRoot, cleanPkg, symbolFilter, maxBytes);
  if (nodeResult) return nodeResult;

  // 2. Python
  const pythonResult = inspectPythonDep(realRoot, cleanPkg, symbolFilter, maxBytes);
  if (pythonResult) return pythonResult;

  // 3. Go / Rust
  const goResult = inspectGoDep(realRoot, cleanPkg, symbolFilter, maxBytes);
  if (goResult) return goResult;

  const rustResult = inspectRustDep(realRoot, cleanPkg, symbolFilter, maxBytes);
  if (rustResult) return rustResult;

  const notFoundNote = `Package "${cleanPkg}" was not found in local node_modules, Python .venv/manifest, go.mod, or Cargo.lock.`;
  const rawSnippet = `[Dep Contract] ${cleanPkg} (not found)\n${notFoundNote}`;
  const clamped = clampContractSnippet(rawSnippet, maxBytes, cleanPkg);

  return {
    found: false,
    ecosystem: 'unknown',
    packageName: cleanPkg,
    version: null,
    entryFile: null,
    exportsSummary: '',
    signatures: [],
    snippet: clamped.snippet,
    totalBytes: clamped.totalBytes,
    truncated: clamped.truncated,
    note: notFoundNote,
  };
}
