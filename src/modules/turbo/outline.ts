import fs from 'node:fs';
import path from 'node:path';
import {
  isBinaryFilename,
  isBufferBinary,
  isSensitiveTurboPath,
  resolveInsideWorkspaceReal,
} from './search.js';

// ============================================================================
// Multi-Language Nested Symbol Outline Extractor & Bounded Line Slicer
// ============================================================================

export const TURBO_MAX_OUTLINE_FILE_BYTES = 1024 * 1024; // 1 MiB for outline/slice

export interface OutlineSymbol {
  kind: string;
  name: string;
  line: number;
  signature: string;
  level?: number;
  parent?: string;
}

export interface ReadOutlineOptions {
  startLine?: number;
  endLine?: number;
  includeOutline?: boolean;
  maxSliceLines?: number;
  maxOutlineItems?: number;
}

export interface ReadOutlineResult {
  file: string;
  language: string;
  totalLines: number;
  bytes: number;
  outline: OutlineSymbol[];
  outlineTruncated: boolean;
  slice: {
    startLine: number;
    endLine: number;
    truncated: boolean;
    content: string;
  };
  estimatedFullTokens: number;
  estimatedReturnedTokens: number;
  estimatedSavedTokens: number;
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts') return 'typescript';
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript';
  if (ext === '.py' || ext === '.pyi') return 'python';
  if (ext === '.go') return 'go';
  if (ext === '.rs') return 'rust';
  if (ext === '.md' || ext === '.mdx' || ext === '.markdown') return 'markdown';
  if (ext === '.json') return 'json';
  return 'text';
}

const TS_CONTROL_KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'else',
  'try',
  'return',
  'do',
  'with',
  'throw',
  'case',
  'default',
  'break',
  'continue',
  'new',
  'delete',
  'typeof',
  'void',
  'yield',
  'await',
  'import',
  'export',
  'super',
  'finally',
  'of',
  'in',
  'extends',
  'implements',
  'class',
  'interface',
  'type',
  'enum',
  'namespace',
  'function',
  'const',
  'let',
  'var',
]);

const TS_MEMBER_MODIFIER_RE =
  /^(?:public|private|protected|static|readonly|abstract|override|declare|async)\s+/;

interface BraceScanResult {
  openCount: number;
  closeCount: number;
  delta: number;
  parenDelta: number;
  startedInComment: boolean;
}

const TURBO_OUTLINE_MAX_PROBE_CHARS = 512;

function findSameLineQuoteClose(
  line: string,
  startIdx: number,
  quote: string,
  maxLookahead?: number,
): number {
  let escaped = false;
  const limit =
    maxLookahead !== undefined
      ? Math.min(line.length, startIdx + 1 + maxLookahead)
      : line.length;
  for (let i = startIdx + 1; i < limit; i += 1) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === quote) {
      return i;
    }
  }
  return -1;
}

function scanBraceLineJs(
  line: string,
  state: { inBlockComment: boolean },
): BraceScanResult {
  const startedInComment = state.inBlockComment;
  let openCount = 0;
  let closeCount = 0;
  let parenOpen = 0;
  let parenClose = 0;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (state.inBlockComment) {
      if (ch === '*' && next === '/') {
        state.inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      state.inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      break;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = findSameLineQuoteClose(line, i, ch);
      if (end > i) {
        i = end;
        continue;
      }
      // Unclosed quote on this line: advance straight to end of line to guarantee strict O(n)
      break;
    }
    if (ch === '{') {
      openCount += 1;
    } else if (ch === '}') {
      closeCount += 1;
    } else if (ch === '(') {
      parenOpen += 1;
    } else if (ch === ')') {
      parenClose += 1;
    }
  }

  return {
    openCount,
    closeCount,
    delta: openCount - closeCount,
    parenDelta: parenOpen - parenClose,
    startedInComment,
  };
}

function scanBraceLineRust(
  line: string,
  state: { blockCommentDepth: number },
): BraceScanResult {
  const startedInComment = state.blockCommentDepth > 0;
  let openCount = 0;
  let closeCount = 0;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (state.blockCommentDepth > 0) {
      if (ch === '/' && next === '*') {
        state.blockCommentDepth += 1;
        i += 1;
      } else if (ch === '*' && next === '/') {
        state.blockCommentDepth -= 1;
        i += 1;
      }
      continue;
    }

    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      state.blockCommentDepth += 1;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      break;
    }
    if (ch === '"') {
      const end = findSameLineQuoteClose(line, i, '"');
      if (end > i) {
        i = end;
        continue;
      }
      // Unclosed string quote on this line: stop scanning to guarantee strict O(n)
      break;
    }
    // Skip Rust character literals ('a', '\n', '\x7f', '\u{1234}') with O(1) bounded lookahead
    // without misreading lifetimes ('a)
    if (ch === "'") {
      if (next === '\\') {
        const end = findSameLineQuoteClose(line, i, "'", 12);
        if (end > i) {
          i = end;
          continue;
        }
      } else if (i + 2 < line.length && line[i + 2] === "'") {
        i += 2;
        continue;
      }
      continue;
    }
    if (ch === '{') {
      openCount += 1;
    } else if (ch === '}') {
      closeCount += 1;
    }
  }

  return {
    openCount,
    closeCount,
    delta: openCount - closeCount,
    parenDelta: 0,
    startedInComment,
  };
}

function stripLeadingAngleGroup(text: string): string {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('<')) return trimmed;
  let depth = 0;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '<') depth += 1;
    else if (ch === '>') {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(i + 1).trimStart();
      }
    }
  }
  return trimmed;
}

function stripTrailingGenerics(typeExpr: string): string {
  const angleIdx = typeExpr.indexOf('<');
  const base = angleIdx >= 0 ? typeExpr.slice(0, angleIdx) : typeExpr;
  return base.replace(/^\s*&?(?:mut\s+)?/, '').trim();
}

function extractRustImplTarget(trimmedLine: string): string | null {
  const head = /^(?:unsafe\s+)?impl\b(.*)$/.exec(trimmedLine);
  if (!head) return null;
  let rest = stripLeadingAngleGroup(head[1]);
  // Drop trailing block/where clause so we only parse the type header
  const braceIdx = rest.indexOf('{');
  if (braceIdx >= 0) rest = rest.slice(0, braceIdx);
  const whereIdx = rest.search(/\bwhere\b/);
  if (whereIdx >= 0) rest = rest.slice(0, whereIdx);
  rest = rest.trim();
  if (!rest) return null;

  // Handle `impl Trait<A> for TargetType<B>` by tracking angle bracket depth to locate top-level `for`
  let angleDepth = 0;
  let forPos = -1;
  for (let i = 0; i < rest.length - 3; i += 1) {
    const ch = rest[i];
    if (ch === '<') angleDepth += 1;
    else if (ch === '>') angleDepth = Math.max(0, angleDepth - 1);
    else if (
      angleDepth === 0 &&
      rest.slice(i, i + 3) === 'for' &&
      (i === 0 || /\s/.test(rest[i - 1])) &&
      /\s/.test(rest[i + 3])
    ) {
      forPos = i;
      break;
    }
  }

  const targetSlice = forPos >= 0 ? rest.slice(forPos + 3).trim() : rest;
  const cleaned = stripTrailingGenerics(targetSlice);
  const ident = /^([A-Za-z_][A-Za-z0-9_:]*)/.exec(cleaned);
  return ident ? ident[1] : null;
}

function extractGoReceiverType(receiverInner: string): string | null {
  const withoutGenerics = receiverInner.replace(/\[[^\]]*\]/g, '').trim();
  if (!withoutGenerics) return null;
  const tokens = withoutGenerics.split(/\s+/).filter(Boolean);
  const lastToken = tokens[tokens.length - 1] ?? '';
  const stripped = lastToken.replace(/^\*+/, '').trim();
  return stripped || null;
}

function measurePythonIndent(line: string): number {
  let width = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4;
    else break;
  }
  return width;
}

function updatePythonTripleQuoteState(
  line: string,
  activeQuote: '"""' | "'''" | null,
): '"""' | "'''" | null {
  let state = activeQuote;
  let i = 0;
  while (i < line.length) {
    if (state) {
      if (line.startsWith(state, i)) {
        state = null;
        i += 3;
        continue;
      }
      if (line[i] === '\\') {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    const ch = line[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '#') break;
    if (line.startsWith('"""', i)) {
      state = '"""';
      i += 3;
      continue;
    }
    if (line.startsWith("'''", i)) {
      state = "'''";
      i += 3;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = findSameLineQuoteClose(line, i, ch);
      if (end > i) {
        i = end + 1;
        continue;
      }
      // Unclosed single-line quote: advance straight to end of line to guarantee strict O(n)
      break;
    }
    i += 1;
  }
  return state;
}

function stripTsMemberModifiers(trimmed: string): string {
  let rest = trimmed;
  for (let step = 0; step < 8; step += 1) {
    const m = TS_MEMBER_MODIFIER_RE.exec(rest);
    if (!m) break;
    rest = rest.slice(m[0].length);
  }
  return rest;
}

export function extractOutlineSymbols(
  content: string,
  language: string,
  maxItems = 120,
): { symbols: OutlineSymbol[]; truncated: boolean } {
  const lines = content.split(/\r?\n/);
  const symbols: OutlineSymbol[] = [];
  let truncated = false;

  const push = (sym: OutlineSymbol): boolean => {
    if (symbols.length >= maxItems) {
      truncated = true;
      return false;
    }
    symbols.push(sym);
    return true;
  };

  if (language === 'markdown') {
    let inFence = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const probe =
        line.length > TURBO_OUTLINE_MAX_PROBE_CHARS
          ? line.slice(0, TURBO_OUTLINE_MAX_PROBE_CHARS)
          : line;
      if (/^\s*(`{3,}|~{3,})/.test(probe)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const m = /^(#{1,6})\s+(.+)$/.exec(probe);
      if (m) {
        const level = m[1].length;
        const heading = m[2].trim().replace(/#+$/, '').trim();
        if (heading) {
          if (!push({ kind: `h${level}`, name: heading, line: i + 1, signature: probe.trim().slice(0, 120), level })) {
            break;
          }
        }
      }
    }
    return { symbols, truncated };
  }

  if (language === 'typescript' || language === 'javascript') {
    interface TsContainer {
      kind: 'class' | 'interface' | 'namespace';
      name: string;
      bodyDepth: number;
      awaitingBrace: boolean;
    }

    const commentState = { inBlockComment: false };
    const containers: TsContainer[] = [];
    let braceDepth = 0;
    let parenDepth = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const depthBefore = braceDepth;
      const parenBefore = parenDepth;
      const scan = scanBraceLineJs(line, commentState);
      const depthAfter = Math.max(0, depthBefore + scan.delta);
      braceDepth = depthAfter;
      parenDepth = Math.max(0, parenBefore + scan.parenDelta);

      // Resolve any pending Allman-style container waiting for its opening brace
      const pendingTop = containers[containers.length - 1];
      if (pendingTop?.awaitingBrace && scan.openCount > 0) {
        pendingTop.awaitingBrace = false;
      }

      const trimmed = line.trim();
      const skipLine =
        !trimmed ||
        scan.startedInComment ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('@');

      let stop = false;

      if (!skipLine && parenBefore === 0) {
        const probe =
          trimmed.length > TURBO_OUTLINE_MAX_PROBE_CHARS
            ? trimmed.slice(0, TURBO_OUTLINE_MAX_PROBE_CHARS)
            : trimmed;
        const top = containers[containers.length - 1];
        const inNamespaceTop =
          top !== undefined &&
          top.kind === 'namespace' &&
          !top.awaitingBrace &&
          depthBefore === top.bodyDepth;
        const inClassBody =
          top !== undefined &&
          top.kind === 'class' &&
          !top.awaitingBrace &&
          depthBefore === top.bodyDepth;
        const inInterfaceBody =
          top !== undefined &&
          top.kind === 'interface' &&
          !top.awaitingBrace &&
          depthBefore === top.bodyDepth;

        if (depthBefore === 0 || inNamespaceTop) {
          const parentName = inNamespaceTop ? top.name : undefined;
          const level = inNamespaceTop ? 1 : 0;
          let m: RegExpExecArray | null;

          if (
            (m = /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?function(?:\s*\*\s*|\s+)([A-Za-z_$][A-Za-z0-9_$]*)/.exec(
              probe,
            ))
          ) {
            if (
              !push({
                kind: 'function',
                name: m[1],
                line: i + 1,
                signature: probe.slice(0, 120),
                level,
                ...(parentName ? { parent: parentName } : {}),
              })
            ) {
              stop = true;
            }
          } else if (
            (m = /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(
              probe,
            ))
          ) {
            if (
              !push({
                kind: 'class',
                name: m[1],
                line: i + 1,
                signature: probe.slice(0, 120),
                level,
                ...(parentName ? { parent: parentName } : {}),
              })
            ) {
              stop = true;
            } else if (depthAfter >= depthBefore + 1) {
              containers.push({
                kind: 'class',
                name: m[1],
                bodyDepth: depthBefore + 1,
                awaitingBrace: false,
              });
            } else if (scan.openCount === 0 && !trimmed.endsWith(';')) {
              containers.push({
                kind: 'class',
                name: m[1],
                bodyDepth: depthBefore + 1,
                awaitingBrace: true,
              });
            }
          } else if (
            (m = /^(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(
              probe,
            ))
          ) {
            if (
              !push({
                kind: 'interface',
                name: m[1],
                line: i + 1,
                signature: probe.slice(0, 120),
                level,
                ...(parentName ? { parent: parentName } : {}),
              })
            ) {
              stop = true;
            } else if (depthAfter >= depthBefore + 1) {
              containers.push({
                kind: 'interface',
                name: m[1],
                bodyDepth: depthBefore + 1,
                awaitingBrace: false,
              });
            } else if (scan.openCount === 0 && !trimmed.endsWith(';')) {
              containers.push({
                kind: 'interface',
                name: m[1],
                bodyDepth: depthBefore + 1,
                awaitingBrace: true,
              });
            }
          } else if (
            (m = /^(?:export\s+)?(?:declare\s+)?(?:namespace|module)\s+([A-Za-z_$][A-Za-z0-9_$.]*)/.exec(
              probe,
            ))
          ) {
            if (
              !push({
                kind: 'namespace',
                name: m[1],
                line: i + 1,
                signature: probe.slice(0, 120),
                level,
                ...(parentName ? { parent: parentName } : {}),
              })
            ) {
              stop = true;
            } else if (depthAfter >= depthBefore + 1) {
              containers.push({
                kind: 'namespace',
                name: m[1],
                bodyDepth: depthBefore + 1,
                awaitingBrace: false,
              });
            } else if (scan.openCount === 0 && !trimmed.endsWith(';')) {
              containers.push({
                kind: 'namespace',
                name: m[1],
                bodyDepth: depthBefore + 1,
                awaitingBrace: true,
              });
            }
          } else if (
            (m = /^(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*<[^>\n]{0,120}>)?\s*=/.exec(
              probe,
            ))
          ) {
            if (
              !push({
                kind: 'type',
                name: m[1],
                line: i + 1,
                signature: probe.slice(0, 120),
                level,
                ...(parentName ? { parent: parentName } : {}),
              })
            ) {
              stop = true;
            }
          } else if (
            (m = /^(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(
              probe,
            ))
          ) {
            if (
              !push({
                kind: 'enum',
                name: m[1],
                line: i + 1,
                signature: probe.slice(0, 120),
                level,
                ...(parentName ? { parent: parentName } : {}),
              })
            ) {
              stop = true;
            }
          } else if (
            (m = /^export\s+(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(
              probe,
            ))
          ) {
            if (
              !push({
                kind: 'export',
                name: m[1],
                line: i + 1,
                signature: probe.slice(0, 120),
                level,
                ...(parentName ? { parent: parentName } : {}),
              })
            ) {
              stop = true;
            }
          }
        } else if (inClassBody && top) {
          const rest = stripTsMemberModifiers(probe);
          let m: RegExpExecArray | null;
          if (/^constructor\s*\(/.test(rest)) {
            if (
              !push({
                kind: 'method',
                name: 'constructor',
                line: i + 1,
                signature: probe.slice(0, 120),
                parent: top.name,
                level: 1,
              })
            ) {
              stop = true;
            }
          } else if ((m = /^(?:get|set)\s+(#?[A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(rest))) {
            const name = m[1];
            if (!TS_CONTROL_KEYWORDS.has(name)) {
              if (
                !push({
                  kind: 'method',
                  name,
                  line: i + 1,
                  signature: probe.slice(0, 120),
                  parent: top.name,
                  level: 1,
                })
              ) {
                stop = true;
              }
            }
          } else if (
            (m = /^(?:\*\s*)?(#?[A-Za-z_$][A-Za-z0-9_$]*)(?:\s*<[^>\n]{0,120}>)?\s*\(/.exec(rest))
          ) {
            const name = m[1];
            if (!TS_CONTROL_KEYWORDS.has(name)) {
              if (
                !push({
                  kind: 'method',
                  name,
                  line: i + 1,
                  signature: probe.slice(0, 120),
                  parent: top.name,
                  level: 1,
                })
              ) {
                stop = true;
              }
            }
          } else if (
            (m = /^(#?[A-Za-z_$][A-Za-z0-9_$]*)[!?]?\s*(?::[^=\n]{1,120})?=\s*(?:async\s+)?(?:\([^)\n]{0,160}\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/.exec(
              rest,
            ))
          ) {
            const name = m[1];
            if (!TS_CONTROL_KEYWORDS.has(name)) {
              if (
                !push({
                  kind: 'method',
                  name,
                  line: i + 1,
                  signature: probe.slice(0, 120),
                  parent: top.name,
                  level: 1,
                })
              ) {
                stop = true;
              }
            }
          }
        } else if (inInterfaceBody && top) {
          let m: RegExpExecArray | null;
          if (
            (m = /^(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\??(?:\s*<[^>\n]{0,120}>)?\s*\(/.exec(
              probe,
            ))
          ) {
            const name = m[1];
            if (!TS_CONTROL_KEYWORDS.has(name)) {
              if (
                !push({
                  kind: 'method',
                  name,
                  line: i + 1,
                  signature: probe.slice(0, 120),
                  parent: top.name,
                  level: 1,
                })
              ) {
                stop = true;
              }
            }
          } else if ((m = /^(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\??\s*:/.exec(probe))) {
            const name = m[1];
            if (!TS_CONTROL_KEYWORDS.has(name)) {
              if (
                !push({
                  kind: 'property',
                  name,
                  line: i + 1,
                  signature: probe.slice(0, 120),
                  parent: top.name,
                  level: 1,
                })
              ) {
                stop = true;
              }
            }
          }
        }
      }

      // Pop containers whose closing brace has been passed
      while (containers.length > 0) {
        const current = containers[containers.length - 1];
        if (!current.awaitingBrace && depthAfter < current.bodyDepth) {
          containers.pop();
        } else if (current.awaitingBrace && trimmed.endsWith(';')) {
          containers.pop();
        } else {
          break;
        }
      }

      if (stop) break;
    }
    return { symbols, truncated };
  }

  if (language === 'python') {
    const classStack: Array<{ name: string; indent: number }> = [];
    const defStack: number[] = [];
    let tripleQuote: '"""' | "'''" | null = null;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const wasInTriple = tripleQuote !== null;
      tripleQuote = updatePythonTripleQuoteState(line, tripleQuote);
      if (wasInTriple) continue;

      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const indent = measurePythonIndent(line);

      while (classStack.length > 0 && classStack[classStack.length - 1].indent >= indent) {
        classStack.pop();
      }
      while (defStack.length > 0 && defStack[defStack.length - 1] >= indent) {
        defStack.pop();
      }

      const probe =
        trimmed.length > TURBO_OUTLINE_MAX_PROBE_CHARS
          ? trimmed.slice(0, TURBO_OUTLINE_MAX_PROBE_CHARS)
          : trimmed;

      let m: RegExpExecArray | null;
      if ((m = /^class\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(probe))) {
        const parentClass = classStack[classStack.length - 1];
        const insideMethod =
          defStack.length > 0 &&
          (!parentClass || defStack[defStack.length - 1] > parentClass.indent);
        if (!insideMethod) {
          if (
            !push({
              kind: 'class',
              name: m[1],
              line: i + 1,
              signature: probe.slice(0, 120),
              level: parentClass ? 1 : 0,
              ...(parentClass ? { parent: parentClass.name } : {}),
            })
          ) {
            break;
          }
          classStack.push({ name: m[1], indent });
        }
      } else if ((m = /^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(probe))) {
        const parentClass = classStack[classStack.length - 1];
        if (indent === 0 && !parentClass) {
          if (
            !push({
              kind: 'function',
              name: m[1],
              line: i + 1,
              signature: probe.slice(0, 120),
              level: 0,
            })
          ) {
            break;
          }
          defStack.push(indent);
        } else if (parentClass) {
          const insideMethod =
            defStack.length > 0 && defStack[defStack.length - 1] > parentClass.indent;
          if (!insideMethod) {
            if (
              !push({
                kind: 'method',
                name: m[1],
                line: i + 1,
                signature: probe.slice(0, 120),
                parent: parentClass.name,
                level: 1,
              })
            ) {
              break;
            }
          }
          defStack.push(indent);
        }
      }
    }
    return { symbols, truncated };
  }

  if (language === 'go') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const probe =
        line.length > TURBO_OUTLINE_MAX_PROBE_CHARS
          ? line.slice(0, TURBO_OUTLINE_MAX_PROBE_CHARS)
          : line;
      let m: RegExpExecArray | null;
      if (
        (m = /^func\s+\(([^)\n]{1,120})\)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\[[^\]\n]{0,120}\])?\s*\(/.exec(
          probe,
        ))
      ) {
        const receiverType = extractGoReceiverType(m[1]);
        if (
          !push({
            kind: 'method',
            name: m[2],
            line: i + 1,
            signature: probe.trim().slice(0, 120),
            ...(receiverType ? { parent: receiverType } : {}),
            level: 1,
          })
        ) {
          break;
        }
      } else if (
        (m = /^func\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\[[^\]\n]{0,120}\])?\s*\(/.exec(probe))
      ) {
        if (
          !push({
            kind: 'function',
            name: m[1],
            line: i + 1,
            signature: probe.trim().slice(0, 120),
            level: 0,
          })
        ) {
          break;
        }
      } else if (
        (m = /^type\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\[[^\]\n]{0,120}\])?\s+(struct|interface)\b/.exec(
          probe,
        ))
      ) {
        if (
          !push({
            kind: m[2],
            name: m[1],
            line: i + 1,
            signature: probe.trim().slice(0, 120),
            level: 0,
          })
        ) {
          break;
        }
      }
    }
    return { symbols, truncated };
  }

  if (language === 'rust') {
    interface RustContainer {
      kind: 'impl' | 'trait' | 'mod';
      name: string;
      bodyDepth: number;
      awaitingBrace: boolean;
    }

    const commentState = { blockCommentDepth: 0 };
    const containers: RustContainer[] = [];
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const depthBefore = braceDepth;
      const scan = scanBraceLineRust(line, commentState);
      const depthAfter = Math.max(0, depthBefore + scan.delta);
      braceDepth = depthAfter;

      const pendingTop = containers[containers.length - 1];
      if (pendingTop?.awaitingBrace && scan.openCount > 0) {
        pendingTop.awaitingBrace = false;
      }

      const trimmed = line.trim();
      const skipLine =
        !trimmed ||
        scan.startedInComment ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('#[');

      let stop = false;

      if (!skipLine) {
        const probe =
          trimmed.length > TURBO_OUTLINE_MAX_PROBE_CHARS
            ? trimmed.slice(0, TURBO_OUTLINE_MAX_PROBE_CHARS)
            : trimmed;
        const top = containers[containers.length - 1];
        const inImplOrTrait =
          top !== undefined &&
          (top.kind === 'impl' || top.kind === 'trait') &&
          !top.awaitingBrace &&
          depthBefore === top.bodyDepth;
        const inModBody =
          top !== undefined &&
          top.kind === 'mod' &&
          !top.awaitingBrace &&
          depthBefore === top.bodyDepth;

        let m: RegExpExecArray | null;
        if (inImplOrTrait && top) {
          if (
            (m = /^(?:pub(?:\([^)\n]{0,60}\))?\s+)?(?:default\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"\n]{0,30}"\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(
              probe,
            ))
          ) {
            if (
              !push({
                kind: 'method',
                name: m[1],
                line: i + 1,
                signature: probe.slice(0, 120),
                parent: top.name,
                level: 1,
              })
            ) {
              stop = true;
            }
          }
        } else if (depthBefore === 0 || inModBody) {
          const parentName = inModBody ? top.name : undefined;
          const level = inModBody ? 1 : 0;

          if (
            (m = /^(?:pub(?:\([^)\n]{0,60}\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"\n]{0,30}"\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(
              probe,
            ))
          ) {
            if (
              !push({
                kind: 'fn',
                name: m[1],
                line: i + 1,
                signature: probe.slice(0, 120),
                level,
                ...(parentName ? { parent: parentName } : {}),
              })
            ) {
              stop = true;
            }
          } else if (
            (m = /^(?:pub(?:\([^)\n]{0,60}\))?\s+)?(?:unsafe\s+)?(struct|enum|trait|mod)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(
              probe,
            ))
          ) {
            const symKind = m[1];
            const symName = m[2];
            if (
              !push({
                kind: symKind,
                name: symName,
                line: i + 1,
                signature: probe.slice(0, 120),
                level,
                ...(parentName ? { parent: parentName } : {}),
              })
            ) {
              stop = true;
            } else if (symKind === 'trait' || symKind === 'mod') {
              if (depthAfter >= depthBefore + 1) {
                containers.push({
                  kind: symKind,
                  name: symName,
                  bodyDepth: depthBefore + 1,
                  awaitingBrace: false,
                });
              } else if (scan.openCount === 0 && !trimmed.endsWith(';')) {
                containers.push({
                  kind: symKind,
                  name: symName,
                  bodyDepth: depthBefore + 1,
                  awaitingBrace: true,
                });
              }
            }
          } else if (/^(?:unsafe\s+)?impl\b/.test(probe)) {
            const target = extractRustImplTarget(probe);
            if (target) {
              if (
                !push({
                  kind: 'impl',
                  name: target,
                  line: i + 1,
                  signature: probe.slice(0, 120),
                  level,
                  ...(parentName ? { parent: parentName } : {}),
                })
              ) {
                stop = true;
              } else if (depthAfter >= depthBefore + 1) {
                containers.push({
                  kind: 'impl',
                  name: target,
                  bodyDepth: depthBefore + 1,
                  awaitingBrace: false,
                });
              } else if (scan.openCount === 0 && !trimmed.endsWith(';')) {
                containers.push({
                  kind: 'impl',
                  name: target,
                  bodyDepth: depthBefore + 1,
                  awaitingBrace: true,
                });
              }
            }
          }
        }
      }

      while (containers.length > 0) {
        const current = containers[containers.length - 1];
        if (!current.awaitingBrace && depthAfter < current.bodyDepth) {
          containers.pop();
        } else if (current.awaitingBrace && trimmed.endsWith(';')) {
          containers.pop();
        } else {
          break;
        }
      }

      if (stop) break;
    }
    return { symbols, truncated };
  }

  return { symbols, truncated };
}

export function readFileOutlineAndSlice(
  workspaceRoot: string,
  filePath: string,
  opts: ReadOutlineOptions = {},
): ReadOutlineResult {
  const { realTarget, relPath } = resolveInsideWorkspaceReal(workspaceRoot, filePath);

  if ((!path.isAbsolute(filePath) && isSensitiveTurboPath(filePath)) || isSensitiveTurboPath(relPath)) {
    throw new Error(`Refused to read sensitive file: ${path.basename(filePath)}`);
  }

  if (isBinaryFilename(realTarget)) {
    throw new Error(`Refused to read binary file: ${relPath}`);
  }

  const stat = fs.statSync(realTarget);
  if (!stat.isFile()) {
    throw new Error(`Target is not a regular file: ${relPath}`);
  }
  if (stat.size > TURBO_MAX_OUTLINE_FILE_BYTES) {
    throw new Error(`File exceeds ${TURBO_MAX_OUTLINE_FILE_BYTES} byte limit: ${relPath}`);
  }

  const buf = fs.readFileSync(realTarget);
  if (isBufferBinary(buf)) {
    throw new Error(`Detected binary content in file: ${relPath}`);
  }

  const text = buf.toString('utf8');
  const lines = text.split(/\r?\n/);
  const totalLines = lines.length;
  const language = detectLanguage(realTarget);

  const includeOutline = opts.includeOutline !== false;
  const maxOutlineItems = Math.max(1, Math.min(opts.maxOutlineItems ?? 120, 300));
  const { symbols, truncated: outlineTruncated } = includeOutline
    ? extractOutlineSymbols(text, language, maxOutlineItems)
    : { symbols: [], truncated: false };

  const maxSliceLines = Math.max(1, Math.min(opts.maxSliceLines ?? 120, 300));
  const startLine = Math.max(1, Math.min(Math.floor(opts.startLine ?? 1), Math.max(1, totalLines)));
  const requestedEnd =
    opts.endLine !== undefined
      ? Math.max(startLine, Math.floor(opts.endLine))
      : Math.min(totalLines, startLine + Math.min(maxSliceLines, 60) - 1);
  const clampedEnd = Math.min(totalLines, startLine + maxSliceLines - 1, requestedEnd);
  const sliceTruncated = clampedEnd < requestedEnd || clampedEnd < totalLines;

  const sliceLines = lines.slice(startLine - 1, clampedEnd);
  const numberedContent = sliceLines
    .map((lineText, idx) => `${startLine + idx} | ${lineText}`)
    .join('\n');

  const estimatedFullTokens = Math.ceil(text.length / 4);
  const outlineChars = symbols.reduce((sum, s) => sum + s.signature.length + 16, 0);
  const estimatedReturnedTokens = Math.ceil((numberedContent.length + outlineChars) / 4);
  const estimatedSavedTokens = Math.max(0, estimatedFullTokens - estimatedReturnedTokens);

  return {
    file: relPath,
    language,
    totalLines,
    bytes: stat.size,
    outline: symbols,
    outlineTruncated,
    slice: {
      startLine,
      endLine: clampedEnd,
      truncated: sliceTruncated,
      content: numberedContent,
    },
    estimatedFullTokens,
    estimatedReturnedTokens,
    estimatedSavedTokens,
  };
}
