import fs from 'node:fs';
import path from 'node:path';
import {
  redactStudioSecrets,
  resolveStudioWorkspaceFile,
  sanitizeHeadersMap,
  validateLoopbackProbeUrl,
} from './core.js';

// ============================================================================
// Security Constants & Public Types
// ============================================================================

export const OPENAPI_MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB
export const OPENAPI_MAX_YAML_LINES = 20_000;
export const OPENAPI_MAX_DEPTH = 24;
export const OPENAPI_MAX_ENDPOINTS = 200;
export const OPENAPI_SAMPLE_MAX_DEPTH = 3;
export const OPENAPI_SAMPLE_MAX_BYTES = 8 * 1024;
export const OPENAPI_DEFAULT_LOOPBACK_BASE = 'http://127.0.0.1:3000';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const SUPPORTED_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head'] as const;
type LowerHttpMethod = (typeof SUPPORTED_METHODS)[number];
export type OpenApiHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

export interface OpenApiServerEntry {
  url: string;
  description?: string;
  isLoopback: boolean;
}

export interface OpenApiEndpointParameter {
  name: string;
  in: string;
  required: boolean;
  example?: string;
}

export interface OpenApiEndpointItem {
  id: string;
  method: OpenApiHttpMethod;
  path: string;
  summary?: string;
  operationId?: string;
  tags: string[];
  parameters: OpenApiEndpointParameter[];
  sampleHeaders: Record<string, string>;
  sampleBody?: string;
  resolvedLoopbackUrl: string;
}

export interface ParsedOpenApiSpec {
  filePath: string;
  specVersion: string;
  title: string;
  apiVersion?: string;
  servers: OpenApiServerEntry[];
  endpoints: OpenApiEndpointItem[];
  totalEndpoints: number;
  truncated: boolean;
  warnings: string[];
}

// ============================================================================
// Prototype-Pollution-Safe Object Helpers
// ============================================================================

type SafeRecord = Record<string, unknown>;

function createSafeRecord(): SafeRecord {
  return Object.create(null) as SafeRecord;
}

function isPlainRecord(val: unknown): val is SafeRecord {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function setSafeProperty(target: SafeRecord, key: string, value: unknown): void {
  if (DANGEROUS_KEYS.has(key)) return;
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function getSafeProperty(obj: unknown, key: string): unknown {
  if (!isPlainRecord(obj) || DANGEROUS_KEYS.has(key)) return undefined;
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function getSafeKeys(obj: SafeRecord): string[] {
  return Object.keys(obj).filter((k) => !DANGEROUS_KEYS.has(k));
}

function assertDepth(depth: number): void {
  if (depth > OPENAPI_MAX_DEPTH) {
    throw new Error(
      `OpenAPI specification exceeds maximum nesting depth of ${OPENAPI_MAX_DEPTH}`,
    );
  }
}

/**
 * Recursively validates nesting depth (<= 24) and strips prototype-pollution keys
 * (__proto__, constructor, prototype) from parsed JSON values.
 */
function sanitizeJsonValue(value: unknown, depth: number): unknown {
  assertDepth(depth);
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i += 1) {
      out.push(sanitizeJsonValue(value[i], depth + 1));
    }
    return out;
  }
  const src = value as Record<string, unknown>;
  const safe = createSafeRecord();
  for (const key of Object.keys(src)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    setSafeProperty(safe, key, sanitizeJsonValue(src[key], depth + 1));
  }
  return safe;
}

// ============================================================================
// Zero-Dependency Safe YAML Subset Parser (No Anchors/Aliases, Bounded Depth)
// ============================================================================

interface YamlLine {
  lineNo: number;
  indent: number;
  text: string; // trimmed leading spaces, preserved trailing for quotes
  raw: string;
}

const ANCHOR_OR_ALIAS_PREFIX_RE = /^(?:&|\*)[^\s,[\]{}]+(?=\s|$|,|\]|\})/;

function assertNoAnchorOrAlias(token: string, lineNo: number): void {
  const trimmed = token.trimStart();
  if (!trimmed) return;
  if (trimmed[0] === '"' || trimmed[0] === "'") return;
  if (ANCHOR_OR_ALIAS_PREFIX_RE.test(trimmed)) {
    throw new Error(
      `YAML anchors (&) and aliases (*) are not supported for security reasons (line ${lineNo})`,
    );
  }
}

function stripInlineComment(raw: string): string {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inDouble) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        if (i + 1 < raw.length && raw[i + 1] === "'") {
          i += 1;
        } else {
          inSingle = false;
        }
      }
      continue;
    }

    if (ch === '"') {
      inDouble = true;
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === '#' && (i === 0 || raw[i - 1] === ' ' || raw[i - 1] === '\t')) {
      return raw.slice(0, i).trimEnd();
    }
  }
  return raw.trimEnd();
}

function decodeDoubleQuotedString(inner: string): string {
  let out = '';
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch !== '\\' || i + 1 >= inner.length) {
      out += ch;
      continue;
    }
    const next = inner[i + 1];
    switch (next) {
      case 'n':
        out += '\n';
        i += 1;
        break;
      case 'r':
        out += '\r';
        i += 1;
        break;
      case 't':
        out += '\t';
        i += 1;
        break;
      case '"':
        out += '"';
        i += 1;
        break;
      case '\\':
        out += '\\';
        i += 1;
        break;
      case '/':
        out += '/';
        i += 1;
        break;
      case 'u': {
        const hex = inner.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 5;
        } else {
          out += next;
          i += 1;
        }
        break;
      }
      default:
        out += next;
        i += 1;
        break;
    }
  }
  return out;
}

function parseScalarToken(rawToken: string, lineNo: number): unknown {
  const cleaned = stripInlineComment(rawToken).trim();
  if (!cleaned) return null;

  assertNoAnchorOrAlias(cleaned, lineNo);

  // Double-quoted scalar
  if (cleaned[0] === '"') {
    let i = 1;
    let escaped = false;
    while (i < cleaned.length) {
      const ch = cleaned[i];
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        return decodeDoubleQuotedString(cleaned.slice(1, i));
      }
      i += 1;
    }
    return decodeDoubleQuotedString(cleaned.slice(1));
  }

  // Single-quoted scalar
  if (cleaned[0] === "'") {
    let i = 1;
    let out = '';
    while (i < cleaned.length) {
      if (cleaned[i] === "'") {
        if (i + 1 < cleaned.length && cleaned[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        return out;
      }
      out += cleaned[i];
      i += 1;
    }
    return out;
  }

  // Unquoted primitives
  const lower = cleaned.toLowerCase();
  if (lower === 'null' || cleaned === '~') return null;
  if (lower === 'true') return true;
  if (lower === 'false') return false;

  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(cleaned)) {
    const num = Number(cleaned);
    if (Number.isFinite(num)) return num;
  }

  return cleaned;
}

/**
 * Splits a YAML line segment into key and value if it represents a mapping entry.
 * Handles quoted keys (e.g. '/api/v1/items:batch':) and unquoted URLs (http://...).
 */
function splitYamlKeyValue(
  text: string,
  lineNo: number,
): { key: string; rawValue: string } | null {
  if (!text) return null;

  // Double-quoted key
  if (text[0] === '"') {
    let i = 1;
    let escaped = false;
    while (i < text.length) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        const rest = text.slice(i + 1);
        const colonMatch = /^\s*:(?:\s+(.*)|\s*)$/.exec(rest);
        if (!colonMatch) return null;
        return {
          key: decodeDoubleQuotedString(text.slice(1, i)),
          rawValue: (colonMatch[1] ?? '').trim(),
        };
      }
      i += 1;
    }
    return null;
  }

  // Single-quoted key
  if (text[0] === "'") {
    let i = 1;
    let key = '';
    while (i < text.length) {
      if (text[i] === "'") {
        if (i + 1 < text.length && text[i + 1] === "'") {
          key += "'";
          i += 2;
          continue;
        }
        const rest = text.slice(i + 1);
        const colonMatch = /^\s*:(?:\s+(.*)|\s*)$/.exec(rest);
        if (!colonMatch) return null;
        return {
          key,
          rawValue: (colonMatch[1] ?? '').trim(),
        };
      }
      key += text[i];
      i += 1;
    }
    return null;
  }

  // Reject flow collection or anchor tokens at start of line as mapping keys
  if (text[0] === '[' || text[0] === '{' || text[0] === '-' || text[0] === '?') {
    return null;
  }

  // Scan for first ':' followed by whitespace or end-of-line (ignoring comments)
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '#' && i > 0 && (text[i - 1] === ' ' || text[i - 1] === '\t')) {
      return null;
    }
    if (ch === ':') {
      const next = i + 1 < text.length ? text[i + 1] : '';
      if (next === '' || next === ' ' || next === '\t') {
        const key = text.slice(0, i).trim();
        if (!key) return null;
        assertNoAnchorOrAlias(key, lineNo);
        if (key === '<<') {
          throw new Error(
            `YAML merge keys (<<) are not supported for security reasons (line ${lineNo})`,
          );
        }
        const rawValue = text.slice(i + 1).trim();
        return { key, rawValue };
      }
    }
  }
  return null;
}

/**
 * Recursive-descent parser for YAML flow collections: [ ... ] and { ... }.
 * Enforces strict depth limit, anchor/alias prohibition, and prototype-pollution guards.
 */
class FlowYamlParser {
  private pos = 0;

  constructor(
    private readonly src: string,
    private readonly lineNo: number,
  ) {}

  private skipWs(): void {
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.pos += 1;
      } else {
        break;
      }
    }
  }

  parseValue(depth: number): unknown {
    assertDepth(depth);
    this.skipWs();
    if (this.pos >= this.src.length) return null;

    const ch = this.src[this.pos];
    if (ch === '[') return this.parseArray(depth);
    if (ch === '{') return this.parseObject(depth);
    if (ch === '"') return this.parseDoubleQuoted();
    if (ch === "'") return this.parseSingleQuoted();

    const remaining = this.src.slice(this.pos);
    assertNoAnchorOrAlias(remaining, this.lineNo);

    // Read plain flow scalar until delimiter
    const start = this.pos;
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === ',' || c === ']' || c === '}') break;
      if (c === ':' && (this.pos + 1 >= this.src.length || /[\s,\]}]/.test(this.src[this.pos + 1]))) {
        break;
      }
      this.pos += 1;
    }
    const token = this.src.slice(start, this.pos).trim();
    return parseScalarToken(token, this.lineNo);
  }

  private parseDoubleQuoted(): string {
    this.pos += 1; // skip opening "
    const start = this.pos;
    let escaped = false;
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        const inner = this.src.slice(start, this.pos);
        this.pos += 1;
        return decodeDoubleQuotedString(inner);
      }
      this.pos += 1;
    }
    throw new Error(`Unterminated double-quoted string in YAML flow value (line ${this.lineNo})`);
  }

  private parseSingleQuoted(): string {
    this.pos += 1; // skip opening '
    let out = '';
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === "'") {
        if (this.pos + 1 < this.src.length && this.src[this.pos + 1] === "'") {
          out += "'";
          this.pos += 2;
          continue;
        }
        this.pos += 1;
        return out;
      }
      out += ch;
      this.pos += 1;
    }
    throw new Error(`Unterminated single-quoted string in YAML flow value (line ${this.lineNo})`);
  }

  private parseArray(depth: number): unknown[] {
    this.pos += 1; // skip '['
    const arr: unknown[] = [];
    this.skipWs();
    if (this.pos < this.src.length && this.src[this.pos] === ']') {
      this.pos += 1;
      return arr;
    }
    while (this.pos < this.src.length) {
      this.skipWs();
      if (this.src[this.pos] === ']') {
        this.pos += 1;
        return arr;
      }
      arr.push(this.parseValue(depth + 1));
      this.skipWs();
      if (this.src[this.pos] === ',') {
        this.pos += 1;
        continue;
      }
      if (this.src[this.pos] === ']') {
        this.pos += 1;
        return arr;
      }
      throw new Error(`Invalid YAML flow array syntax (line ${this.lineNo})`);
    }
    throw new Error(`Unterminated YAML flow array (line ${this.lineNo})`);
  }

  private parseObject(depth: number): SafeRecord {
    this.pos += 1; // skip '{'
    const obj = createSafeRecord();
    this.skipWs();
    if (this.pos < this.src.length && this.src[this.pos] === '}') {
      this.pos += 1;
      return obj;
    }
    while (this.pos < this.src.length) {
      this.skipWs();
      if (this.src[this.pos] === '}') {
        this.pos += 1;
        return obj;
      }
      const keyRaw = this.parseKey();
      this.skipWs();
      if (this.src[this.pos] !== ':') {
        throw new Error(`Expected ':' in YAML flow mapping (line ${this.lineNo})`);
      }
      this.pos += 1;
      const val = this.parseValue(depth + 1);
      if (keyRaw === '<<') {
        throw new Error(
          `YAML merge keys (<<) are not supported for security reasons (line ${this.lineNo})`,
        );
      }
      setSafeProperty(obj, keyRaw, val);
      this.skipWs();
      if (this.src[this.pos] === ',') {
        this.pos += 1;
        continue;
      }
      if (this.src[this.pos] === '}') {
        this.pos += 1;
        return obj;
      }
      throw new Error(`Invalid YAML flow mapping syntax (line ${this.lineNo})`);
    }
    throw new Error(`Unterminated YAML flow mapping (line ${this.lineNo})`);
  }

  private parseKey(): string {
    this.skipWs();
    const ch = this.src[this.pos];
    if (ch === '"') return this.parseDoubleQuoted();
    if (ch === "'") return this.parseSingleQuoted();
    const remaining = this.src.slice(this.pos);
    assertNoAnchorOrAlias(remaining, this.lineNo);
    const start = this.pos;
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === ':' && (this.pos + 1 >= this.src.length || /[\s,\]}]/.test(this.src[this.pos + 1]))) {
        break;
      }
      if (c === ',' || c === '}' || c === ']') break;
      this.pos += 1;
    }
    return this.src.slice(start, this.pos).trim();
  }
}

function isFlowBalanced(text: string): boolean {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let brackets = 0;
  let braces = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inDouble) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        if (i + 1 < text.length && text[i + 1] === "'") {
          i += 1;
        } else {
          inSingle = false;
        }
      }
      continue;
    }
    if (ch === '"') inDouble = true;
    else if (ch === "'") inSingle = true;
    else if (ch === '[') brackets += 1;
    else if (ch === ']') brackets -= 1;
    else if (ch === '{') braces += 1;
    else if (ch === '}') braces -= 1;
  }
  return !inSingle && !inDouble && brackets <= 0 && braces <= 0;
}

const BLOCK_SCALAR_HEADER_RE = /^([|>])([+-])?(?:\d+)?(?:\s+#.*)?$/;

export function parseSafeYamlSubset(rawYaml: string): unknown {
  const normalized = rawYaml.charCodeAt(0) === 0xfeff ? rawYaml.slice(1) : rawYaml;
  const rawLines = normalized.split(/\r?\n/);

  if (rawLines.length > OPENAPI_MAX_YAML_LINES) {
    throw new Error(
      `YAML specification exceeds maximum line limit (${rawLines.length} > ${OPENAPI_MAX_YAML_LINES})`,
    );
  }

  const lines: YamlLine[] = [];
  let seenContent = false;

  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    const lineNo = i + 1;

    // Count leading spaces; reject tab indentation
    let indent = 0;
    while (indent < raw.length && raw[indent] === ' ') {
      indent += 1;
    }
    if (indent < raw.length && raw[indent] === '\t') {
      throw new Error(`YAML tab indentation is not supported (line ${lineNo})`);
    }

    const trimmed = raw.slice(indent);
    if (!trimmed || trimmed[0] === '#') continue;

    // Document markers at column 0
    if (indent === 0) {
      if (/^---(?:\s|$)/.test(trimmed)) {
        if (seenContent) break; // Only parse first YAML document
        continue;
      }
      if (/^\.\.\.(?:\s|$)/.test(trimmed)) {
        if (seenContent) break;
        continue;
      }
    }

    seenContent = true;
    lines.push({ lineNo, indent, text: trimmed, raw });
  }

  if (lines.length === 0) {
    return createSafeRecord();
  }

  let idx = 0;

  const readBlockScalar = (parentIndent: number, style: '|' | '>', chomp: '' | '+' | '-'): string => {
    const startLineNo = lines[idx - 1]?.lineNo ?? 1;
    const nextIdx = idx;
    if (nextIdx >= lines.length || lines[nextIdx].indent <= parentIndent) {
      return '';
    }
    const blockIndent = lines[nextIdx].indent;
    const rawStartIdx = startLineNo; // 0-based index of line after header
    // Advance idx past all lines belonging to this block scalar
    while (idx < lines.length && lines[idx].indent >= blockIndent) {
      idx += 1;
    }
    const endRawLineNo = idx < lines.length ? lines[idx].lineNo - 1 : rawLines.length;

    const collected: string[] = [];
    for (let r = rawStartIdx; r < endRawLineNo; r += 1) {
      const rawLine = rawLines[r] ?? '';
      if (rawLine.trim().length === 0) {
        collected.push('');
      } else if (rawLine.length >= blockIndent && rawLine.slice(0, blockIndent).trim() === '') {
        collected.push(rawLine.slice(blockIndent));
      } else {
        break;
      }
    }

    // Trim trailing blank lines unless chomp === '+'
    while (chomp !== '+' && collected.length > 0 && collected[collected.length - 1] === '') {
      collected.pop();
    }

    if (style === '|') {
      return collected.join('\n');
    }

    // Folded scalar '>': fold consecutive non-empty lines with space, keep empty lines as paragraph breaks
    let folded = '';
    for (let k = 0; k < collected.length; k += 1) {
      const part = collected[k];
      if (part === '') {
        folded += '\n';
      } else if (folded === '' || folded.endsWith('\n')) {
        folded += part;
      } else {
        folded += ` ${part}`;
      }
    }
    return folded;
  };

  const readFlowValue = (firstText: string, lineNo: number, depth: number): unknown => {
    let combined = stripInlineComment(firstText).trim();
    let extraLines = 0;
    while (!isFlowBalanced(combined) && idx < lines.length && extraLines < 200) {
      combined += ` ${stripInlineComment(lines[idx].text).trim()}`;
      idx += 1;
      extraLines += 1;
    }
    const parser = new FlowYamlParser(combined, lineNo);
    return parser.parseValue(depth);
  };

  const parseInlineOrNestedValue = (
    rawValue: string,
    parentIndent: number,
    lineNo: number,
    depth: number,
  ): unknown => {
    assertDepth(depth);
    const cleaned = stripInlineComment(rawValue).trim();

    if (cleaned) {
      assertNoAnchorOrAlias(cleaned, lineNo);

      const blockHeader = BLOCK_SCALAR_HEADER_RE.exec(cleaned);
      if (blockHeader) {
        return readBlockScalar(
          parentIndent,
          blockHeader[1] as '|' | '>',
          (blockHeader[2] as '' | '+' | '-') ?? '',
        );
      }

      if (cleaned[0] === '[' || cleaned[0] === '{') {
        return readFlowValue(cleaned, lineNo, depth);
      }

      return parseScalarToken(cleaned, lineNo);
    }

    // Empty inline value: inspect next line for nested block
    if (idx >= lines.length) return null;
    const next = lines[idx];

    // YAML allows sequence items at the same indent as their parent mapping key
    if (next.indent === parentIndent && isSequenceLine(next.text)) {
      return parseSequence(next.indent, depth);
    }
    if (next.indent > parentIndent) {
      return parseNode(next.indent, depth);
    }
    return null;
  };

  const isSequenceLine = (text: string): boolean => text === '-' || text.startsWith('- ');

  const parseMapping = (baseIndent: number, depth: number): SafeRecord => {
    assertDepth(depth);
    const map = createSafeRecord();

    while (idx < lines.length) {
      const line = lines[idx];
      if (line.indent < baseIndent) break;
      if (line.indent > baseIndent) {
        throw new Error(
          `Unexpected YAML indentation at line ${line.lineNo} (expected ${baseIndent}, got ${line.indent})`,
        );
      }
      if (isSequenceLine(line.text)) break;

      const kv = splitYamlKeyValue(line.text, line.lineNo);
      if (!kv) {
        throw new Error(`Invalid YAML mapping entry at line ${line.lineNo}`);
      }
      idx += 1;

      const value = parseInlineOrNestedValue(kv.rawValue, line.indent, line.lineNo, depth + 1);
      setSafeProperty(map, kv.key, value);
    }

    return map;
  };

  const parseSequence = (baseIndent: number, depth: number): unknown[] => {
    assertDepth(depth);
    const seq: unknown[] = [];

    while (idx < lines.length) {
      const line = lines[idx];
      if (line.indent < baseIndent) break;
      if (line.indent > baseIndent) {
        throw new Error(
          `Unexpected YAML sequence indentation at line ${line.lineNo} (expected ${baseIndent}, got ${line.indent})`,
        );
      }
      if (!isSequenceLine(line.text)) break;

      idx += 1;
      const afterDashRaw = line.text.length > 1 ? line.text.slice(1) : '';
      const leadingSpacesAfterDash = afterDashRaw.length - afterDashRaw.trimStart().length;
      const remainder = afterDashRaw.trim();
      const itemIndent = line.indent + 1 + Math.max(1, leadingSpacesAfterDash);

      if (!remainder) {
        // Dash alone on line; parse nested block if deeper
        if (idx < lines.length && lines[idx].indent > baseIndent) {
          seq.push(parseNode(lines[idx].indent, depth + 1));
        } else {
          seq.push(null);
        }
        continue;
      }

      assertNoAnchorOrAlias(remainder, line.lineNo);

      // Block scalar directly after '- '
      const blockHeader = BLOCK_SCALAR_HEADER_RE.exec(stripInlineComment(remainder).trim());
      if (blockHeader) {
        seq.push(
          readBlockScalar(
            baseIndent,
            blockHeader[1] as '|' | '>',
            (blockHeader[2] as '' | '+' | '-') ?? '',
          ),
        );
        continue;
      }

      // Flow collection directly after '- '
      if (remainder[0] === '[' || remainder[0] === '{') {
        seq.push(readFlowValue(remainder, line.lineNo, depth + 1));
        continue;
      }

      // Nested inline sequence '- - item'
      if (isSequenceLine(remainder)) {
        assertDepth(depth + 1);
        const nestedSeq: unknown[] = [];
        const nestedVal = parseScalarToken(remainder.slice(1).trim(), line.lineNo);
        nestedSeq.push(nestedVal);
        seq.push(nestedSeq);
        continue;
      }

      // Inline mapping inside sequence item: '- name: id\n  in: path'
      const kv = splitYamlKeyValue(remainder, line.lineNo);
      if (kv) {
        assertDepth(depth + 1);
        const itemMap = createSafeRecord();
        const firstVal = parseInlineOrNestedValue(
          kv.rawValue,
          itemIndent,
          line.lineNo,
          depth + 2,
        );
        setSafeProperty(itemMap, kv.key, firstVal);

        // Consume sibling keys belonging to this sequence item's mapping
        while (idx < lines.length) {
          const next = lines[idx];
          if (next.indent <= baseIndent) break;
          if (next.indent < itemIndent) {
            throw new Error(
              `Misaligned YAML mapping inside sequence at line ${next.lineNo}`,
            );
          }
          if (next.indent > itemIndent) {
            throw new Error(
              `Unexpected indentation inside sequence item at line ${next.lineNo}`,
            );
          }
          if (isSequenceLine(next.text)) break;
          const sibKv = splitYamlKeyValue(next.text, next.lineNo);
          if (!sibKv) {
            throw new Error(`Invalid YAML mapping entry inside sequence at line ${next.lineNo}`);
          }
          idx += 1;
          const sibVal = parseInlineOrNestedValue(
            sibKv.rawValue,
            next.indent,
            next.lineNo,
            depth + 2,
          );
          setSafeProperty(itemMap, sibKv.key, sibVal);
        }

        seq.push(itemMap);
        continue;
      }

      // Plain or quoted scalar sequence item
      seq.push(parseScalarToken(remainder, line.lineNo));
    }

    return seq;
  };

  const parseNode = (baseIndent: number, depth: number): unknown => {
    assertDepth(depth);
    const line = lines[idx];
    if (!line) return null;

    if (isSequenceLine(line.text)) {
      return parseSequence(baseIndent, depth);
    }

    const cleaned = stripInlineComment(line.text).trim();
    if (cleaned[0] === '[' || cleaned[0] === '{') {
      idx += 1;
      return readFlowValue(cleaned, line.lineNo, depth);
    }

    const kv = splitYamlKeyValue(line.text, line.lineNo);
    if (kv) {
      return parseMapping(baseIndent, depth);
    }

    idx += 1;
    return parseScalarToken(line.text, line.lineNo);
  };

  return parseNode(lines[0].indent, 0);
}

// ============================================================================
// Local JSON Pointer ($ref) & Schema Sample Generator
// ============================================================================

function resolveLocalRef(doc: SafeRecord, ref: string): unknown {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    // Strictly local internal document refs only — never load external files or URLs
    return undefined;
  }
  const segments = ref
    .slice(2)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));

  let current: unknown = doc;
  for (const seg of segments) {
    if (!seg || DANGEROUS_KEYS.has(seg)) return undefined;
    if (isPlainRecord(current)) {
      current = getSafeProperty(current, seg);
    } else if (Array.isArray(current)) {
      const idx = Number.parseInt(seg, 10);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) return undefined;
      current = current[idx];
    } else {
      return undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}

function derefObject(
  node: unknown,
  doc: SafeRecord,
  visitedRefs: Set<string>,
): { value: SafeRecord | null; addedRef?: string } {
  if (!isPlainRecord(node)) return { value: null };
  const ref = getSafeProperty(node, '$ref');
  if (typeof ref === 'string') {
    if (visitedRefs.has(ref)) return { value: null };
    const target = resolveLocalRef(doc, ref);
    if (!isPlainRecord(target)) return { value: null };
    visitedRefs.add(ref);
    return { value: target, addedRef: ref };
  }
  return { value: node };
}

function sanitizeAndRedactSampleValue(value: unknown, depth: number): unknown {
  if (depth > OPENAPI_SAMPLE_MAX_DEPTH + 1) return undefined;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return redactStudioSecrets(value);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 5)
      .map((item) => sanitizeAndRedactSampleValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {};
    const keys = getSafeKeys(value).slice(0, 20);
    for (const k of keys) {
      const v = sanitizeAndRedactSampleValue(getSafeProperty(value, k), depth + 1);
      if (v !== undefined) {
        out[k] = v;
      }
    }
    return out;
  }
  return undefined;
}

const OPENAPI_SAMPLE_MAX_STEPS = 256;
const SENSITIVE_PARAM_NAME_RE =
  /(?:authorization|auth|cookie|session|jwt|api[_-]?key|apikey|token|secret|password|passwd|sig|signature|credential)/i;

function synthesizeSampleFromSchema(
  rawSchema: unknown,
  doc: SafeRecord,
  depth: number,
  visitedRefs: Set<string>,
  budget: { steps: number } = { steps: 0 },
): unknown {
  if (depth > OPENAPI_SAMPLE_MAX_DEPTH) return undefined;
  budget.steps += 1;
  if (budget.steps > OPENAPI_SAMPLE_MAX_STEPS) return undefined;
  if (!isPlainRecord(rawSchema)) return undefined;

  const { value: schema, addedRef } = derefObject(rawSchema, doc, visitedRefs);
  if (!schema) return undefined;

  try {
    // Explicit example / default / enum take precedence
    const explicitExample = getSafeProperty(schema, 'example');
    if (explicitExample !== undefined) {
      return sanitizeAndRedactSampleValue(explicitExample, depth);
    }

    const explicitDefault = getSafeProperty(schema, 'default');
    if (explicitDefault !== undefined) {
      return sanitizeAndRedactSampleValue(explicitDefault, depth);
    }

    const enumVal = getSafeProperty(schema, 'enum');
    if (Array.isArray(enumVal) && enumVal.length > 0) {
      return sanitizeAndRedactSampleValue(enumVal[0], depth);
    }

    // Handle allOf composition
    const allOf = getSafeProperty(schema, 'allOf');
    if (Array.isArray(allOf) && allOf.length > 0) {
      if (depth >= OPENAPI_SAMPLE_MAX_DEPTH) return {};
      const merged: Record<string, unknown> = {};
      for (const sub of allOf.slice(0, 8)) {
        if (budget.steps >= OPENAPI_SAMPLE_MAX_STEPS) break;
        const part = synthesizeSampleFromSchema(sub, doc, depth + 1, visitedRefs, budget);
        if (part && typeof part === 'object' && !Array.isArray(part)) {
          for (const [k, v] of Object.entries(part as Record<string, unknown>)) {
            if (!DANGEROUS_KEYS.has(k)) {
              merged[k] = v;
            }
          }
        }
      }
      return merged;
    }

    // Handle oneOf / anyOf by taking first branch
    const oneOf = getSafeProperty(schema, 'oneOf') ?? getSafeProperty(schema, 'anyOf');
    if (Array.isArray(oneOf) && oneOf.length > 0) {
      if (depth >= OPENAPI_SAMPLE_MAX_DEPTH) return undefined;
      return synthesizeSampleFromSchema(oneOf[0], doc, depth + 1, visitedRefs, budget);
    }

    const rawType = getSafeProperty(schema, 'type');
    const schemaType = Array.isArray(rawType)
      ? String(rawType.find((t) => t !== 'null') ?? 'string')
      : typeof rawType === 'string'
        ? rawType
        : getSafeProperty(schema, 'properties')
          ? 'object'
          : getSafeProperty(schema, 'items')
            ? 'array'
            : 'object';

    if (schemaType === 'object') {
      if (depth >= OPENAPI_SAMPLE_MAX_DEPTH) {
        return {};
      }
      const props = getSafeProperty(schema, 'properties');
      if (!isPlainRecord(props)) {
        return {};
      }
      const result: Record<string, unknown> = {};
      const propKeys = getSafeKeys(props).slice(0, 20);
      for (const key of propKeys) {
        if (budget.steps >= OPENAPI_SAMPLE_MAX_STEPS) break;
        const propSample = synthesizeSampleFromSchema(
          getSafeProperty(props, key),
          doc,
          depth + 1,
          visitedRefs,
          budget,
        );
        if (propSample !== undefined) {
          result[key] = propSample;
        }
      }
      return result;
    }

    if (schemaType === 'array') {
      if (depth >= OPENAPI_SAMPLE_MAX_DEPTH) {
        return [];
      }
      const items = getSafeProperty(schema, 'items');
      const itemSample = synthesizeSampleFromSchema(items, doc, depth + 1, visitedRefs, budget);
      return itemSample !== undefined ? [itemSample] : [];
    }

    if (schemaType === 'integer') return 1;
    if (schemaType === 'number') return 1.5;
    if (schemaType === 'boolean') return true;
    if (schemaType === 'null') return null;

    // Default: string with format hints
    const format = String(getSafeProperty(schema, 'format') ?? '').toLowerCase();
    switch (format) {
      case 'date-time':
        return '2026-11-27T00:00:00Z';
      case 'date':
        return '2026-11-27';
      case 'email':
        return 'dev@localhost';
      case 'uri':
      case 'url':
        return OPENAPI_DEFAULT_LOOPBACK_BASE;
      case 'uuid':
        return '00000000-0000-4000-8000-000000000001';
      default:
        return 'sample';
    }
  } finally {
    if (addedRef) {
      visitedRefs.delete(addedRef);
    }
  }
}

// ============================================================================
// OpenAPI 2.0 / 3.x Structured Extraction
// ============================================================================

function toCleanString(val: unknown): string | undefined {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed ? redactStudioSecrets(trimmed) : undefined;
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val);
  }
  return undefined;
}

function expandServerTemplateVariables(rawUrl: string, serverObj: SafeRecord): string {
  const variables = getSafeProperty(serverObj, 'variables');
  if (!isPlainRecord(variables)) return rawUrl;
  return rawUrl.replace(/\{([^{}]+)\}/g, (match, varName: string) => {
    const varDef = getSafeProperty(variables, varName.trim());
    if (!isPlainRecord(varDef)) return match;
    const defVal = getSafeProperty(varDef, 'default');
    if (typeof defVal === 'string' || typeof defVal === 'number') {
      return String(defVal);
    }
    return match;
  });
}

function checkIsLoopbackUrl(candidateUrl: string): boolean {
  try {
    validateLoopbackProbeUrl(candidateUrl);
    return true;
  } catch {
    return false;
  }
}

function extractServers(
  doc: SafeRecord,
  isSwagger2: boolean,
): { servers: OpenApiServerEntry[]; swaggerBasePath: string } {
  const servers: OpenApiServerEntry[] = [];
  const seen = new Set<string>();
  let swaggerBasePath = '';

  if (!isSwagger2) {
    const rawServers = getSafeProperty(doc, 'servers');
    if (Array.isArray(rawServers)) {
      for (const item of rawServers.slice(0, 20)) {
        if (!isPlainRecord(item)) continue;
        const rawUrl = getSafeProperty(item, 'url');
        if (typeof rawUrl !== 'string' || !rawUrl.trim()) continue;
        const expanded = expandServerTemplateVariables(rawUrl.trim(), item);
        const isLoopback = checkIsLoopbackUrl(expanded);
        const redactedUrl = redactStudioSecrets(expanded);
        if (seen.has(redactedUrl)) continue;
        seen.add(redactedUrl);
        const description = toCleanString(getSafeProperty(item, 'description'));
        servers.push({
          url: redactedUrl,
          ...(description ? { description } : {}),
          isLoopback,
        });
      }
    }
    return { servers, swaggerBasePath };
  }

  // Swagger 2.0: schemes + host + basePath
  const rawHost = getSafeProperty(doc, 'host');
  const host = typeof rawHost === 'string' ? rawHost.trim() : '';
  const rawBasePath = getSafeProperty(doc, 'basePath');
  const basePath =
    typeof rawBasePath === 'string' && rawBasePath.trim()
      ? rawBasePath.trim().startsWith('/')
        ? rawBasePath.trim().replace(/\/+$/, '')
        : `/${rawBasePath.trim().replace(/\/+$/, '')}`
      : '';
  swaggerBasePath = basePath;

  const rawSchemes = getSafeProperty(doc, 'schemes');
  const schemes: string[] = Array.isArray(rawSchemes)
    ? rawSchemes
        .map((s) => (typeof s === 'string' ? s.trim().toLowerCase() : ''))
        .filter((s) => s === 'http' || s === 'https')
    : [];

  if (host) {
    const effectiveSchemes = schemes.length > 0 ? schemes : ['http'];
    for (const scheme of effectiveSchemes.slice(0, 4)) {
      const candidate = `${scheme}://${host}${basePath}`;
      const isLoopback = checkIsLoopbackUrl(candidate);
      const redactedUrl = redactStudioSecrets(candidate);
      if (seen.has(redactedUrl)) continue;
      seen.add(redactedUrl);
      servers.push({
        url: redactedUrl,
        description: `Swagger 2.0 (${scheme.toUpperCase()})`,
        isLoopback,
      });
    }
  }

  return { servers, swaggerBasePath };
}

function extractParameterExample(paramObj: SafeRecord, doc: SafeRecord): string | undefined {
  const direct = getSafeProperty(paramObj, 'example');
  if (direct !== undefined && direct !== null) {
    return toCleanString(
      typeof direct === 'object' ? JSON.stringify(direct) : direct,
    );
  }

  const examples = getSafeProperty(paramObj, 'examples');
  if (isPlainRecord(examples)) {
    const keys = getSafeKeys(examples);
    if (keys.length > 0) {
      const firstEx = getSafeProperty(examples, keys[0]);
      if (isPlainRecord(firstEx)) {
        const val = getSafeProperty(firstEx, 'value');
        if (val !== undefined && val !== null) {
          return toCleanString(typeof val === 'object' ? JSON.stringify(val) : val);
        }
      }
    }
  }

  const rawSchema = getSafeProperty(paramObj, 'schema');
  if (isPlainRecord(rawSchema)) {
    const { value: resolvedSchema } = derefObject(rawSchema, doc, new Set());
    if (resolvedSchema) {
      const schemaEx =
        getSafeProperty(resolvedSchema, 'example') ??
        getSafeProperty(resolvedSchema, 'default');
      if (schemaEx !== undefined && schemaEx !== null) {
        return toCleanString(typeof schemaEx === 'object' ? JSON.stringify(schemaEx) : schemaEx);
      }
      const schemaEnum = getSafeProperty(resolvedSchema, 'enum');
      if (Array.isArray(schemaEnum) && schemaEnum.length > 0) {
        return toCleanString(schemaEnum[0]);
      }
    }
  }

  // Swagger 2.0 parameter-level default / enum
  const paramDefault = getSafeProperty(paramObj, 'default');
  if (paramDefault !== undefined && paramDefault !== null) {
    return toCleanString(paramDefault);
  }
  const paramEnum = getSafeProperty(paramObj, 'enum');
  if (Array.isArray(paramEnum) && paramEnum.length > 0) {
    return toCleanString(paramEnum[0]);
  }

  return undefined;
}

function inferPlaceholderValue(paramName: string, paramObj?: SafeRecord, doc?: SafeRecord): string {
  if (paramObj && doc) {
    const rawSchema = getSafeProperty(paramObj, 'schema');
    const resolvedSchema = isPlainRecord(rawSchema)
      ? derefObject(rawSchema, doc, new Set()).value
      : paramObj;
    const rawType = resolvedSchema ? getSafeProperty(resolvedSchema, 'type') : undefined;
    const paramType = typeof rawType === 'string' ? rawType.toLowerCase() : '';
    const format = resolvedSchema
      ? String(getSafeProperty(resolvedSchema, 'format') ?? '').toLowerCase()
      : '';
    if (paramType === 'integer' || paramType === 'number') return '1';
    if (paramType === 'boolean') return 'true';
    if (format === 'uuid') return '00000000-0000-4000-8000-000000000001';
  }
  return /id$/i.test(paramName) ? '1' : 'sample';
}

function extractParameters(
  pathItem: SafeRecord,
  operation: SafeRecord,
  doc: SafeRecord,
): { params: OpenApiEndpointParameter[]; rawByKey: Map<string, SafeRecord> } {
  const merged = new Map<string, { item: OpenApiEndpointParameter; raw: SafeRecord }>();

  const collect = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const entry of list.slice(0, 60)) {
      const { value: paramObj } = derefObject(entry, doc, new Set());
      if (!paramObj) continue;
      const name = toCleanString(getSafeProperty(paramObj, 'name'));
      const paramIn = toCleanString(getSafeProperty(paramObj, 'in'))?.toLowerCase();
      if (!name || !paramIn) continue;
      // Swagger 2.0 body parameter is handled as sampleBody, keep it documented too if desired,
      // but exclude body from query/path/header parameter list only when constructing URLs.
      const required = Boolean(getSafeProperty(paramObj, 'required')) || paramIn === 'path';
      const rawExample = extractParameterExample(paramObj, doc);
      const isSensitiveParam =
        (paramIn === 'header' || paramIn === 'query' || paramIn === 'cookie') &&
        SENSITIVE_PARAM_NAME_RE.test(name);
      const example =
        rawExample !== undefined && isSensitiveParam ? '[REDACTED]' : rawExample;
      const dedupKey = `${paramIn}:${name}`;
      merged.set(dedupKey, {
        item: {
          name,
          in: paramIn,
          required,
          ...(example !== undefined ? { example } : {}),
        },
        raw: paramObj,
      });
    }
  };

  collect(getSafeProperty(pathItem, 'parameters'));
  collect(getSafeProperty(operation, 'parameters'));

  const params: OpenApiEndpointParameter[] = [];
  const rawByKey = new Map<string, SafeRecord>();
  for (const [k, v] of merged.entries()) {
    params.push(v.item);
    rawByKey.set(k, v.raw);
  }
  return { params, rawByKey };
}

function extractSampleBody(
  operation: SafeRecord,
  rawParamsByKey: Map<string, SafeRecord>,
  doc: SafeRecord,
  isSwagger2: boolean,
): string | undefined {
  let candidateSample: unknown = undefined;

  if (!isSwagger2) {
    const rawReqBody = getSafeProperty(operation, 'requestBody');
    const { value: reqBody } = derefObject(rawReqBody, doc, new Set());
    if (reqBody) {
      const content = getSafeProperty(reqBody, 'content');
      if (isPlainRecord(content)) {
        const contentKeys = getSafeKeys(content);
        const jsonKey =
          contentKeys.find((k) => k.toLowerCase() === 'application/json') ??
          contentKeys.find((k) => k.toLowerCase().includes('json'));
        if (jsonKey) {
          const media = getSafeProperty(content, jsonKey);
          if (isPlainRecord(media)) {
            const directEx = getSafeProperty(media, 'example');
            if (directEx !== undefined) {
              candidateSample = sanitizeAndRedactSampleValue(directEx, 0);
            } else {
              const examples = getSafeProperty(media, 'examples');
              if (isPlainRecord(examples)) {
                const exKeys = getSafeKeys(examples);
                if (exKeys.length > 0) {
                  const first = getSafeProperty(examples, exKeys[0]);
                  if (isPlainRecord(first) && getSafeProperty(first, 'value') !== undefined) {
                    candidateSample = sanitizeAndRedactSampleValue(
                      getSafeProperty(first, 'value'),
                      0,
                    );
                  }
                }
              }
            }

            if (candidateSample === undefined) {
              const schema = getSafeProperty(media, 'schema');
              if (schema !== undefined) {
                candidateSample = synthesizeSampleFromSchema(schema, doc, 0, new Set());
              }
            }
          }
        }
      }
    }
  } else {
    // Swagger 2.0: parameter with in === 'body'
    for (const [key, rawParam] of rawParamsByKey.entries()) {
      if (!key.startsWith('body:')) continue;
      const schema = getSafeProperty(rawParam, 'schema');
      if (schema !== undefined) {
        candidateSample = synthesizeSampleFromSchema(schema, doc, 0, new Set());
        break;
      }
    }
  }

  if (candidateSample === undefined) return undefined;

  let serialized: string;
  try {
    serialized =
      typeof candidateSample === 'string'
        ? candidateSample
        : JSON.stringify(candidateSample, null, 2);
  } catch {
    return undefined;
  }

  if (serialized.length > OPENAPI_SAMPLE_MAX_BYTES) {
    serialized = `${serialized.slice(0, OPENAPI_SAMPLE_MAX_BYTES)}…`;
  }
  return redactStudioSecrets(serialized);
}

function buildResolvedLoopbackUrl(
  loopbackBase: string,
  rawPath: string,
  params: OpenApiEndpointParameter[],
  rawParamsByKey: Map<string, SafeRecord>,
  doc: SafeRecord,
): string {
  const cleanBase = loopbackBase.replace(/\/+$/, '');
  const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;

  // Substitute {param} placeholders in path
  const substitutedPath = normalizedPath.replace(/\{([^{}]+)\}/g, (_m, paramName: string) => {
    const trimmedName = paramName.trim();
    const matchedParam = params.find((p) => p.in === 'path' && p.name === trimmedName);
    const rawParam = rawParamsByKey.get(`path:${trimmedName}`);
    const val = matchedParam?.example ?? inferPlaceholderValue(trimmedName, rawParam, doc);
    return encodeURIComponent(val);
  });

  // Append required or example-bearing query parameters
  const queryParts: string[] = [];
  for (const p of params) {
    if (p.in !== 'query') continue;
    if (!p.required && p.example === undefined) continue;
    if (queryParts.length >= 8) break;
    const rawParam = rawParamsByKey.get(`query:${p.name}`);
    const val = p.example ?? inferPlaceholderValue(p.name, rawParam, doc);
    queryParts.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(val)}`);
  }

  const querySuffix = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
  const candidate = `${cleanBase}${substitutedPath}${querySuffix}`;

  // Guarantee the emitted URL strictly passes Studio's loopback SSRF validator
  try {
    const validated = validateLoopbackProbeUrl(candidate);
    return redactStudioSecrets(validated.toString());
  } catch {
    const safePath = substitutedPath
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    const fallbackCandidate = `${OPENAPI_DEFAULT_LOOPBACK_BASE}${safePath.startsWith('/') ? safePath : `/${safePath}`}`;
    try {
      return redactStudioSecrets(validateLoopbackProbeUrl(fallbackCandidate).toString());
    } catch {
      return `${OPENAPI_DEFAULT_LOOPBACK_BASE}/`;
    }
  }
}

export function isLikelyOpenApiDocument(
  filePath: string,
  rawText: string,
  format: 'json' | 'yaml',
): boolean {
  const head = rawText.slice(0, 4096);
  if (format === 'json') {
    if (/"(?:openapi|swagger)"\s*:\s*"[23]\./i.test(head)) return true;
  } else if (/^(?:openapi|swagger)\s*:\s*['"]?[23]\./m.test(head)) {
    return true;
  }
  const baseLower = path.posix.basename(filePath.replace(/\\/g, '/')).toLowerCase();
  if (/(?:^|[-_.])(?:openapi|swagger)(?:[-_.]|$)/i.test(baseLower)) {
    if (format === 'json') {
      return /"(?:openapi|swagger)"\s*:/i.test(head);
    }
    return /^(?:openapi|swagger)\s*:/m.test(head);
  }
  return false;
}

export function parseOpenApiSpecFromContent(
  filePath: string,
  rawContent: string,
  ext: '.json' | '.yaml' | '.yml',
): ParsedOpenApiSpec {
  const byteLength = Buffer.byteLength(rawContent, 'utf8');
  if (byteLength > OPENAPI_MAX_FILE_BYTES) {
    throw new Error(
      `OpenAPI file exceeds 2 MiB size limit (${byteLength} bytes > ${OPENAPI_MAX_FILE_BYTES} bytes): ${filePath}`,
    );
  }

  let parsedUnknown: unknown;
  if (ext === '.json') {
    let rawJson: unknown;
    try {
      rawJson = JSON.parse(rawContent);
    } catch (err) {
      throw new Error(
        `Invalid OpenAPI JSON in ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    parsedUnknown = sanitizeJsonValue(rawJson, 0);
  } else {
    parsedUnknown = parseSafeYamlSubset(rawContent);
  }

  if (!isPlainRecord(parsedUnknown)) {
    throw new Error(`OpenAPI specification root must be an object: ${filePath}`);
  }
  const doc = parsedUnknown;

  const openapiRaw = getSafeProperty(doc, 'openapi');
  const swaggerRaw = getSafeProperty(doc, 'swagger');
  const openapiVersion =
    openapiRaw !== undefined && openapiRaw !== null ? String(openapiRaw).trim() : '';
  const swaggerVersion =
    swaggerRaw !== undefined && swaggerRaw !== null ? String(swaggerRaw).trim() : '';

  let specVersion = '';
  let isSwagger2 = false;
  if (/^3\./.test(openapiVersion)) {
    specVersion = redactStudioSecrets(openapiVersion);
    isSwagger2 = false;
  } else if (/^2\./.test(swaggerVersion)) {
    specVersion = redactStudioSecrets(swaggerVersion);
    isSwagger2 = true;
  } else {
    throw new Error(
      `Unsupported or missing OpenAPI/Swagger version in ${filePath} (expected openapi 3.x or swagger 2.0)`,
    );
  }

  const info = getSafeProperty(doc, 'info');
  const title =
    (isPlainRecord(info) ? toCleanString(getSafeProperty(info, 'title')) : undefined) ??
    'Untitled API';
  const apiVersion = isPlainRecord(info)
    ? toCleanString(getSafeProperty(info, 'version'))
    : undefined;

  const warnings: string[] = [];
  const { servers, swaggerBasePath } = extractServers(doc, isSwagger2);

  const firstLoopbackServer = servers.find((s) => s.isLoopback);
  let loopbackBase = firstLoopbackServer?.url;

  if (!loopbackBase) {
    loopbackBase = swaggerBasePath
      ? `${OPENAPI_DEFAULT_LOOPBACK_BASE}${swaggerBasePath}`
      : OPENAPI_DEFAULT_LOOPBACK_BASE;
    if (servers.length > 0) {
      warnings.push(
        `No loopback server found in spec; endpoints were mapped to ${loopbackBase} to enforce Loopback-Only security policy.`,
      );
    } else {
      warnings.push(
        `No servers defined in spec; endpoints defaulted to ${loopbackBase} to enforce Loopback-Only security policy.`,
      );
    }
  }

  const rawPaths = getSafeProperty(doc, 'paths');
  const endpoints: OpenApiEndpointItem[] = [];
  let totalEndpoints = 0;

  if (isPlainRecord(rawPaths)) {
    const pathKeys = getSafeKeys(rawPaths);
    for (const rawPath of pathKeys) {
      if (!rawPath.startsWith('/')) continue;
      const pathItem = getSafeProperty(rawPaths, rawPath);
      if (!isPlainRecord(pathItem)) continue;

      const safePath = redactStudioSecrets(rawPath);

      for (const lowerMethod of SUPPORTED_METHODS) {
        const opVal = getSafeProperty(pathItem, lowerMethod);
        if (!isPlainRecord(opVal)) continue;

        totalEndpoints += 1;
        if (endpoints.length >= OPENAPI_MAX_ENDPOINTS) continue;

        const method = lowerMethod.toUpperCase() as OpenApiHttpMethod;
        const summary =
          toCleanString(getSafeProperty(opVal, 'summary')) ??
          toCleanString(getSafeProperty(opVal, 'description'));
        const operationId = toCleanString(getSafeProperty(opVal, 'operationId'));

        const rawTags = getSafeProperty(opVal, 'tags');
        const tags: string[] = Array.isArray(rawTags)
          ? rawTags
              .map((t) => toCleanString(t))
              .filter((t): t is string => Boolean(t))
              .slice(0, 12)
          : [];

        const { params, rawByKey } = extractParameters(pathItem, opVal, doc);
        const sampleBody =
          method !== 'GET' && method !== 'HEAD'
            ? extractSampleBody(opVal, rawByKey, doc, isSwagger2)
            : undefined;

        const rawSampleHeaders: Record<string, string> = {
          Accept: 'application/json',
        };
        if (sampleBody !== undefined) {
          rawSampleHeaders['Content-Type'] = 'application/json';
        }
        for (const p of params) {
          if (p.in !== 'header') continue;
          if (DANGEROUS_KEYS.has(p.name) || /[\r\n:]/.test(p.name)) continue;
          const lowerHeader = p.name.toLowerCase();
          if (lowerHeader === 'host' || lowerHeader === 'content-length') continue;
          const val = p.example ?? 'sample';
          rawSampleHeaders[p.name] = val;
        }
        const sampleHeaders = sanitizeHeadersMap(rawSampleHeaders);

        const resolvedLoopbackUrl = buildResolvedLoopbackUrl(
          loopbackBase,
          rawPath,
          params,
          rawByKey,
          doc,
        );

        endpoints.push({
          id: `${method}:${safePath}`,
          method,
          path: safePath,
          ...(summary ? { summary: summary.slice(0, 240) } : {}),
          ...(operationId ? { operationId } : {}),
          tags,
          parameters: params,
          sampleHeaders,
          ...(sampleBody !== undefined ? { sampleBody } : {}),
          resolvedLoopbackUrl,
        });
      }
    }
  }

  const truncated = totalEndpoints > endpoints.length;
  if (truncated) {
    warnings.push(
      `Endpoints truncated to ${OPENAPI_MAX_ENDPOINTS} of ${totalEndpoints} total operations.`,
    );
  }

  return {
    filePath: redactStudioSecrets(filePath),
    specVersion,
    title,
    ...(apiVersion ? { apiVersion } : {}),
    servers,
    endpoints,
    totalEndpoints,
    truncated,
    warnings: warnings.map((w) => redactStudioSecrets(w)),
  };
}

export function parseStudioOpenApiFile(
  workspaceRoot: string,
  filePath: string,
): ParsedOpenApiSpec {
  const resolved = resolveStudioWorkspaceFile(workspaceRoot, filePath);
  const ext = path.extname(resolved.relPath).toLowerCase();
  if (ext !== '.json' && ext !== '.yaml' && ext !== '.yml') {
    throw new Error(
      `Unsupported OpenAPI file extension "${ext || '(none)'}" (supported: .json, .yaml, .yml): ${resolved.relPath}`,
    );
  }
  if (resolved.stat.size > OPENAPI_MAX_FILE_BYTES) {
    throw new Error(
      `OpenAPI file exceeds 2 MiB size limit (${resolved.stat.size} bytes > ${OPENAPI_MAX_FILE_BYTES} bytes): ${resolved.relPath}`,
    );
  }

  const rawText = fs.readFileSync(resolved.realTarget, 'utf8');
  return parseOpenApiSpecFromContent(resolved.relPath, rawText, ext);
}

// ============================================================================
// Pure In-Memory Demo Mode OpenAPI Fixture (Zero Disk I/O, Zero Network)
// ============================================================================

export function createDemoOpenApiSpec(filePath = 'api/openapi.yaml'): ParsedOpenApiSpec {
  return {
    filePath,
    specVersion: '3.1.0',
    title: 'Local Sandbox Dev API',
    apiVersion: '0.5.0',
    servers: [
      {
        url: 'http://127.0.0.1:4399',
        description: 'Local Loopback Dev Server',
        isLoopback: true,
      },
      {
        url: 'https://api.example.com/v1',
        description: 'Production (Blocked by Loopback-Only Guard)',
        isLoopback: false,
      },
    ],
    endpoints: [
      {
        id: 'GET:/api/health',
        method: 'GET',
        path: '/api/health',
        summary: 'Loopback service health and readiness check',
        operationId: 'getHealth',
        tags: ['system'],
        parameters: [],
        sampleHeaders: { Accept: 'application/json' },
        resolvedLoopbackUrl: 'http://127.0.0.1:4399/api/health',
      },
      {
        id: 'GET:/api/projects/{id}',
        method: 'GET',
        path: '/api/projects/{id}',
        summary: 'Fetch workspace project metadata by identifier',
        operationId: 'getProjectById',
        tags: ['projects'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            example: 'proj_101',
          },
          {
            name: 'includeStats',
            in: 'query',
            required: false,
            example: 'true',
          },
        ],
        sampleHeaders: { Accept: 'application/json' },
        resolvedLoopbackUrl: 'http://127.0.0.1:4399/api/projects/proj_101?includeStats=true',
      },
      {
        id: 'POST:/api/reviews',
        method: 'POST',
        path: '/api/reviews',
        summary: 'Create a local code review annotation batch',
        operationId: 'createReview',
        tags: ['reviews'],
        parameters: [
          {
            name: 'X-Trace-Id',
            in: 'header',
            required: false,
            example: 'trace-demo-01',
          },
        ],
        sampleHeaders: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Trace-Id': 'trace-demo-01',
        },
        sampleBody: JSON.stringify(
          {
            filePath: 'src/modules/studio/openapi.ts',
            severity: 'med',
            comment: 'Verify loopback URL mapping on non-local servers.',
          },
          null,
          2,
        ),
        resolvedLoopbackUrl: 'http://127.0.0.1:4399/api/reviews',
      },
      {
        id: 'DELETE:/api/cache',
        method: 'DELETE',
        path: '/api/cache',
        summary: 'Evict local loopback preview cache entries',
        operationId: 'purgeCache',
        tags: ['system', 'maintenance'],
        parameters: [
          {
            name: 'scope',
            in: 'query',
            required: false,
            example: 'preview',
          },
        ],
        sampleHeaders: { Accept: 'application/json' },
        resolvedLoopbackUrl: 'http://127.0.0.1:4399/api/cache?scope=preview',
      },
    ],
    totalEndpoints: 4,
    truncated: false,
    warnings: [],
  };
}
