import fs from 'node:fs';
import path from 'node:path';
import { canonicalRealpathSync, isPathInsideDir } from '../../core/fs-safe.js';
import { redactSecretsLinear } from '../../core/sanitize.js';
import type { CrossClientFinding } from './types.js';

const SENSITIVE_DIR_RE = /(?:^|\/)\.(?:ssh|aws|gnupg|kube)(?:\/|$)/i;
const SENSITIVE_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore']);
const SENSITIVE_BASENAMES = new Set([
  '.env',
  '.envrc',
  '.npmrc',
  '.netrc',
  '.pypirc',
  'id_rsa',
  'id_ed25519',
  'id_dsa',
  'id_ecdsa',
  'master.key',
]);

export const PURE_ENV_REF_RE = /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/;
export const ENV_VAR_EMBED_RE = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/;
export const ENV_VAR_GLOBAL_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
export const UNRESOLVED_PLACEHOLDER_RE =
  /\{\{[^}]+\}\}|<YOUR_[A-Z0-9_-]+>|\bYOUR_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|ID|URL|HOST|EMAIL)\b|\b(?:REPLACE_ME|CHANGEME|TODO_SET_[A-Z0-9_]+)\b/i;
export const SENSITIVE_KEY_NAME_RE =
  /token|secret|key|auth|bearer|oauth|password|passwd|credential|cookie|private/i;
export const OAUTH_OR_EXPIRING_KEY_RE =
  /oauth|access_?token|refresh_?token|id_?token|bearer|expires|expiry|session_?token/i;
export const JWT_LIKE_RE = /^eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*$/;

const SECRET_VALUE_PATTERN_RE =
  /(?<![A-Za-z0-9])(?:ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|gh[ousr]_[A-Za-z0-9]{10,}|sk-(?:proj-|live-|test-|ant-)?[A-Za-z0-9_-]{12,}|sk_(?:live|test)_[A-Za-z0-9_-]{12,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|[Bb][Ee][Aa][Rr][Ee][Rr]\s+[A-Za-z0-9\-._~+/=]{8,})(?![A-Za-z0-9])/;
const SECRET_VALUE_REDACT_GLOBAL_RE =
  /(?<![A-Za-z0-9])(?:ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|gh[ousr]_[A-Za-z0-9]{10,}|sk-(?:proj-|live-|test-|ant-)?[A-Za-z0-9_-]{12,}|sk_(?:live|test)_[A-Za-z0-9_-]{12,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?|[Bb][Ee][Aa][Rr][Ee][Rr]\s+[A-Za-z0-9\-._~+/=]{8,})(?![A-Za-z0-9])/g;

export function isSensitiveOpsPath(inputPath: string): boolean {
  if (!inputPath) return false;
  const normalized = inputPath.replace(/\\/g, '/').trim().replace(/\/+$/, '');
  if (!normalized) return false;
  if (SENSITIVE_DIR_RE.test(normalized)) return true;

  const segments = normalized.split('/').filter(Boolean);
  for (const seg of segments) {
    const lowerSeg = seg.toLowerCase();
    if (
      lowerSeg === '.ssh' ||
      lowerSeg === '.aws' ||
      lowerSeg === '.gnupg' ||
      lowerSeg === '.kube' ||
      lowerSeg.startsWith('.env') ||
      lowerSeg.startsWith('credentials') ||
      lowerSeg.includes('secret')
    ) {
      return true;
    }
  }

  const base = path.posix.basename(normalized);
  const lower = base.toLowerCase();
  if (SENSITIVE_BASENAMES.has(lower)) return true;
  if (
    lower.startsWith('id_rsa.') ||
    lower.startsWith('id_ed25519.') ||
    lower.startsWith('id_dsa.') ||
    lower.startsWith('id_ecdsa.')
  ) {
    return true;
  }
  if (SENSITIVE_EXTENSIONS.has(path.posix.extname(lower))) return true;
  return false;
}

export function isSensitiveCrossClientFile(relPath: string): boolean {
  if (isSensitiveOpsPath(relPath)) return true;
  const base = path.posix.basename(relPath.replace(/\\/g, '/')).toLowerCase();
  return (
    base === 'auth.json' ||
    base === 'oauth.json' ||
    base === 'token.json' ||
    base === 'tokens.json' ||
    base === 'history.jsonl'
  );
}

export function containsSecretPattern(value: string): boolean {
  return SECRET_VALUE_PATTERN_RE.test(value);
}

export function redactSecretsInMessage(message: string): string {
  if (!message) return message;
  let result = containsSecretPattern(message)
    ? message.replace(SECRET_VALUE_REDACT_GLOBAL_RE, '<redacted-path>')
    : message;

  // Defense-in-depth via shared O(n) sanitizer for PEM blocks, webhooks, and `<private>` blocks
  if (
    result.includes('-----') ||
    result.includes('://') ||
    (result.includes('<') && result.includes('>'))
  ) {
    result = redactSecretsLinear(result, {
      stripPrivate: result.includes('<') && result.includes('>'),
      privateReplacement: '<redacted-path>',
    });
  }
  return result;
}

export function sanitizeMcpIdentifier(raw: string): string {
  return containsSecretPattern(raw) ? '<redacted-path>' : raw;
}

export function sanitizeDisplayPath(raw: string): string {
  const cleaned = raw.split(/[?#]/)[0].trim();
  if (
    !cleaned ||
    SENSITIVE_KEY_NAME_RE.test(cleaned) ||
    containsSecretPattern(raw) ||
    containsSecretPattern(cleaned) ||
    cleaned.includes('=')
  ) {
    return '<redacted-path>';
  }
  return cleaned.slice(0, 100);
}

export function extractSafeEnvPlaceholderTokens(value: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  ENV_VAR_GLOBAL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENV_VAR_GLOBAL_RE.exec(value)) !== null) {
    const rawName = (match[1] ?? match[2] ?? '').slice(0, 48);
    if (!rawName) continue;
    const token = containsSecretPattern(rawName) ? '${<redacted-var>}' : `\${${rawName}}`;
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
    if (out.length >= 6) break;
  }
  return out;
}

export function sanitizeCrossClientFinding(finding: CrossClientFinding): CrossClientFinding {
  return {
    severity: finding.severity,
    code: finding.code,
    client: finding.client,
    file: redactSecretsInMessage(finding.file),
    message: redactSecretsInMessage(finding.message),
    ...(finding.suggestion ? { suggestion: redactSecretsInMessage(finding.suggestion) } : {}),
  };
}

export type StrictReadResult =
  | { ok: true; relPath: string; realPath: string; bytes: number; text: string }
  | { ok: false; reason: 'missing' | 'symlink' | 'sensitive' | 'not-file' | 'oversized' | 'binary' | 'error' };

export function readFileStrictNoSymlink(
  realRoot: string,
  relPosix: string,
  maxBytes: number,
): StrictReadResult {
  const normalizedRel = relPosix.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedRel) return { ok: false, reason: 'missing' };
  if (isSensitiveCrossClientFile(normalizedRel)) {
    return { ok: false, reason: 'sensitive' };
  }

  const segments = normalizedRel.split('/').filter(Boolean);
  let cur = realRoot;
  let finalLstat: fs.Stats | null = null;
  for (const seg of segments) {
    if (seg === '.' || seg === '..') return { ok: false, reason: 'symlink' };
    cur = path.join(cur, seg);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(cur);
    } catch {
      return { ok: false, reason: 'missing' };
    }
    if (st.isSymbolicLink()) {
      return { ok: false, reason: 'symlink' };
    }
    finalLstat = st;
  }

  if (!finalLstat || !finalLstat.isFile()) {
    return { ok: false, reason: 'not-file' };
  }

  let realTarget: string;
  try {
    realTarget = canonicalRealpathSync(cur);
  } catch {
    return { ok: false, reason: 'error' };
  }
  if (!isPathInsideDir(realRoot, realTarget)) {
    return { ok: false, reason: 'symlink' };
  }

  const realRel = path.relative(realRoot, realTarget).replace(/\\/g, '/');
  if (isSensitiveCrossClientFile(realRel)) {
    return { ok: false, reason: 'sensitive' };
  }

  if (finalLstat.size > maxBytes) {
    return { ok: false, reason: 'oversized' };
  }

  try {
    const buf = fs.readFileSync(realTarget);
    if (buf.length > maxBytes) {
      return { ok: false, reason: 'oversized' };
    }
    const inspectLen = Math.min(buf.length, 4096);
    for (let i = 0; i < inspectLen; i += 1) {
      if (buf[i] === 0) return { ok: false, reason: 'binary' };
    }
    return {
      ok: true,
      relPath: normalizedRel,
      realPath: realTarget,
      bytes: buf.length,
      text: buf.toString('utf8'),
    };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export function listFilesStrictNoSymlink(
  realRoot: string,
  relBaseDir: string,
  maxDepth: number,
  maxEntries: number,
  predicate: (relPosix: string, entryName: string) => boolean,
): string[] {
  const normalizedBase = relBaseDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalizedBase) return [];

  const segments = normalizedBase.split('/').filter(Boolean);
  let cur = realRoot;
  let baseStat: fs.Stats | null = null;
  for (const seg of segments) {
    if (seg === '.' || seg === '..') return [];
    cur = path.join(cur, seg);
    try {
      const st = fs.lstatSync(cur);
      if (st.isSymbolicLink()) return [];
      baseStat = st;
    } catch {
      return [];
    }
  }
  if (!baseStat || !baseStat.isDirectory()) return [];

  let realBase: string;
  try {
    realBase = canonicalRealpathSync(cur);
  } catch {
    return [];
  }
  if (!isPathInsideDir(realRoot, realBase)) return [];

  const results: string[] = [];
  const visited = new Set<string>();

  const walk = (dirAbs: string, relDir: string, depth: number): void => {
    if (depth > maxDepth || results.length >= maxEntries) return;
    if (visited.has(dirAbs)) return;
    visited.add(dirAbs);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (results.length >= maxEntries) break;
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dirAbs, entry.name);
      const rel = `${relDir}/${entry.name}`;
      if (isSensitiveCrossClientFile(rel)) continue;

      let lstat: fs.Stats;
      try {
        lstat = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (lstat.isSymbolicLink()) {
        // Strictly reject symlinks in static security & dedup scans
        continue;
      }
      if (lstat.isDirectory()) {
        walk(full, rel, depth + 1);
      } else if (lstat.isFile() && predicate(rel, entry.name)) {
        results.push(rel);
      }
    }
  };

  walk(realBase, normalizedBase, 0);
  return results;
}
