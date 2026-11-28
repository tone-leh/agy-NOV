import React, { useMemo, useState } from 'react';
import { useNovI18n } from '../../i18n/index.js';
import { AnnotationCard } from './AnnotationCard';
import { AnnotationComposer } from './AnnotationComposer';
import {
  buildSplitRows,
  extractCodeSnippet,
  type AnnotationCategory,
  type AnnotationSide,
  type DiffFile,
  type DiffLine,
  type DiffLineRiskHint,
  type DiffViewMode,
  type ReviewAnnotation,
} from './types';

interface SelectionRange {
  side: AnnotationSide;
  anchorLine: number;
  startLine: number;
  endLine: number;
}

interface ComposerPreset {
  category: AnnotationCategory;
  comment: string;
}

export type HighlightLang =
  | 'js'
  | 'py'
  | 'go'
  | 'rs'
  | 'json'
  | 'yaml'
  | 'sh'
  | 'css'
  | 'html'
  | 'sql'
  | 'plain';

export type HighlightTokenKind = 'plain' | 'comment' | 'string' | 'keyword' | 'number' | 'type';

export interface HighlightToken {
  kind: HighlightTokenKind;
  text: string;
}

const MAX_HIGHLIGHT_LINE_CHARS = 1024;

const EXT_TO_LANG: Record<string, HighlightLang> = {
  ts: 'js',
  tsx: 'js',
  mts: 'js',
  cts: 'js',
  js: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  py: 'py',
  go: 'go',
  rs: 'rs',
  json: 'json',
  jsonc: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'sh',
  bash: 'sh',
  zsh: 'sh',
  css: 'css',
  scss: 'css',
  html: 'html',
  htm: 'html',
  sql: 'sql',
};

const KEYWORDS_BY_LANG: Record<HighlightLang, ReadonlySet<string>> = {
  js: new Set([
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
    'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
    'for', 'from', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface',
    'let', 'new', 'null', 'of', 'private', 'protected', 'public', 'readonly', 'return',
    'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof',
    'undefined', 'var', 'void', 'while', 'yield', 'as', 'satisfies', 'keyof',
  ]),
  py: new Set([
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class',
    'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
    'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise',
    'return', 'try', 'while', 'with', 'yield', 'match', 'case',
  ]),
  go: new Set([
    'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough',
    'false', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'nil',
    'package', 'range', 'return', 'select', 'struct', 'switch', 'true', 'type', 'var',
  ]),
  rs: new Set([
    'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum',
    'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod',
    'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super',
    'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while',
  ]),
  json: new Set(['true', 'false', 'null']),
  yaml: new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off']),
  sh: new Set([
    'if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while', 'until',
    'case', 'esac', 'function', 'return', 'local', 'export', 'readonly', 'set', 'unset',
    'exit', 'true', 'false',
  ]),
  css: new Set([
    'important', 'from', 'to', 'and', 'not', 'only', 'media', 'keyframes', 'import',
    'supports', 'layer', 'inherit', 'initial', 'unset', 'none', 'auto',
  ]),
  html: new Set([]),
  sql: new Set([
    'select', 'from', 'where', 'join', 'inner', 'left', 'right', 'outer', 'full', 'on',
    'as', 'and', 'or', 'not', 'in', 'is', 'null', 'true', 'false', 'insert', 'into',
    'values', 'update', 'set', 'delete', 'create', 'alter', 'drop', 'table', 'index',
    'view', 'group', 'by', 'order', 'having', 'limit', 'offset', 'distinct', 'union',
    'all', 'case', 'when', 'then', 'else', 'end', 'primary', 'key', 'foreign', 'references',
    'exists', 'with', 'returning',
  ]),
  plain: new Set([]),
};

const TYPES_BY_LANG: Record<HighlightLang, ReadonlySet<string>> = {
  js: new Set([
    'string', 'number', 'boolean', 'unknown', 'any', 'never', 'bigint', 'symbol', 'object',
    'Array', 'Promise', 'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit',
    'Map', 'Set', 'Error', 'Date', 'RegExp', 'Buffer', 'Uint8Array',
  ]),
  py: new Set([
    'int', 'float', 'str', 'bool', 'bytes', 'list', 'dict', 'set', 'tuple', 'object',
    'Any', 'Optional', 'Union', 'List', 'Dict', 'Set', 'Tuple', 'Callable', 'Sequence',
  ]),
  go: new Set([
    'bool', 'byte', 'complex64', 'complex128', 'error', 'float32', 'float64', 'int',
    'int8', 'int16', 'int32', 'int64', 'rune', 'string', 'uint', 'uint8', 'uint16',
    'uint32', 'uint64', 'uintptr', 'any',
  ]),
  rs: new Set([
    'bool', 'char', 'str', 'i8', 'i16', 'i32', 'i64', 'i128', 'isize', 'u8', 'u16',
    'u32', 'u64', 'u128', 'usize', 'f32', 'f64', 'String', 'Vec', 'Option', 'Result',
    'Box', 'Arc', 'Rc', 'HashMap', 'HashSet',
  ]),
  json: new Set([]),
  yaml: new Set([]),
  sh: new Set([]),
  css: new Set([]),
  html: new Set([]),
  sql: new Set([
    'int', 'integer', 'bigint', 'smallint', 'text', 'varchar', 'char', 'boolean', 'bool',
    'real', 'float', 'double', 'numeric', 'decimal', 'date', 'timestamp', 'json', 'jsonb',
    'uuid', 'blob',
  ]),
  plain: new Set([]),
};

export function detectHighlightLanguage(filePath: string | undefined): HighlightLang {
  if (!filePath) return 'plain';
  const base = filePath.split('/').pop() ?? filePath;
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx < 0 || dotIdx === base.length - 1) return 'plain';
  const ext = base.slice(dotIdx + 1).toLowerCase();
  return EXT_TO_LANG[ext] ?? 'plain';
}

function isIdentStart(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 36
  );
}

function isIdentPart(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    isIdentStart(ch) ||
    (code >= 48 && code <= 57)
  );
}

function isDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isHexDigit(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 70) ||
    (code >= 97 && code <= 102)
  );
}

function isPascalCaseType(word: string): boolean {
  if (word.length < 2) return false;
  const first = word.charCodeAt(0);
  if (first < 65 || first > 90) return false;
  for (let i = 1; i < word.length; i += 1) {
    const c = word.charCodeAt(i);
    if (c >= 97 && c <= 122) return true;
  }
  return false;
}

function pushToken(tokens: HighlightToken[], kind: HighlightTokenKind, text: string): void {
  if (!text) return;
  const prev = tokens[tokens.length - 1];
  if (prev && prev.kind === kind) {
    prev.text += text;
  } else {
    tokens.push({ kind, text });
  }
}

/**
 * Pure linear-time O(n) single-line tokenizer. Produces plain data tokens rendered
 * exclusively as escaped React <span> text children (zero dangerouslySetInnerHTML).
 */
export function tokenizeCodeLine(line: string, lang: HighlightLang): HighlightToken[] {
  if (!line || lang === 'plain') {
    return line ? [{ kind: 'plain', text: line }] : [];
  }

  const limit = Math.min(line.length, MAX_HIGHLIGHT_LINE_CHARS);
  const tokens: HighlightToken[] = [];
  const keywords = KEYWORDS_BY_LANG[lang];
  const types = TYPES_BY_LANG[lang];

  let i = 0;

  // HTML lightweight single-line tag/comment/attribute scanner
  if (lang === 'html') {
    while (i < limit) {
      if (line.startsWith('<!--', i)) {
        const end = line.indexOf('-->', i + 4);
        const stop = end >= 0 && end + 3 <= limit ? end + 3 : limit;
        pushToken(tokens, 'comment', line.slice(i, stop));
        i = stop;
        continue;
      }
      if (line[i] === '<') {
        const start = i;
        i += 1;
        if (i < limit && (line[i] === '/' || line[i] === '!')) {
          i += 1;
        }
        pushToken(tokens, 'plain', line.slice(start, i));
        const tagStart = i;
        while (i < limit && /[A-Za-z0-9:_-]/.test(line[i])) i += 1;
        if (i > tagStart) {
          pushToken(tokens, 'keyword', line.slice(tagStart, i));
        }
        while (i < limit && line[i] !== '>') {
          const ch = line[i];
          if (ch === '"' || ch === "'") {
            const q = ch;
            const sStart = i;
            i += 1;
            while (i < limit && line[i] !== q) i += 1;
            if (i < limit) i += 1;
            pushToken(tokens, 'string', line.slice(sStart, i));
          } else if (/[A-Za-z_:@-]/.test(ch)) {
            const aStart = i;
            while (i < limit && /[A-Za-z0-9_.:@-]/.test(line[i])) i += 1;
            pushToken(tokens, 'type', line.slice(aStart, i));
          } else {
            pushToken(tokens, 'plain', ch);
            i += 1;
          }
        }
        if (i < limit && line[i] === '>') {
          pushToken(tokens, 'plain', '>');
          i += 1;
        }
        continue;
      }
      const nextLt = line.indexOf('<', i);
      const stop = nextLt >= 0 && nextLt < limit ? nextLt : limit;
      pushToken(tokens, 'plain', line.slice(i, stop));
      i = stop;
    }
    if (limit < line.length) {
      pushToken(tokens, 'plain', line.slice(limit));
    }
    return tokens;
  }

  while (i < limit) {
    const ch = line[i];
    const next = i + 1 < limit ? line[i + 1] : '';

    // Comments
    if (
      (lang === 'js' || lang === 'go' || lang === 'rs' || lang === 'css' || lang === 'json') &&
      ch === '/' &&
      next === '/'
    ) {
      pushToken(tokens, 'comment', line.slice(i, limit));
      i = limit;
      break;
    }
    if (
      (lang === 'js' || lang === 'go' || lang === 'rs' || lang === 'css' || lang === 'sql') &&
      ch === '/' &&
      next === '*'
    ) {
      const end = line.indexOf('*/', i + 2);
      const stop = end >= 0 && end + 2 <= limit ? end + 2 : limit;
      pushToken(tokens, 'comment', line.slice(i, stop));
      i = stop;
      continue;
    }
    if (
      (lang === 'py' || lang === 'yaml' || lang === 'sh') &&
      ch === '#' &&
      (i === 0 || /\s/.test(line[i - 1]) || lang === 'py')
    ) {
      pushToken(tokens, 'comment', line.slice(i, limit));
      i = limit;
      break;
    }
    if (lang === 'sql' && ch === '-' && next === '-') {
      pushToken(tokens, 'comment', line.slice(i, limit));
      i = limit;
      break;
    }

    // Strings
    const isBacktick = ch === '`' && (lang === 'js' || lang === 'go' || lang === 'sh');
    if (ch === '"' || ch === "'" || isBacktick) {
      // Rust lifetime `'a` is not a char/string literal
      if (lang === 'rs' && ch === "'" && next && isIdentStart(next) && line[i + 2] !== "'") {
        const start = i;
        i += 2;
        while (i < limit && isIdentPart(line[i])) i += 1;
        pushToken(tokens, 'type', line.slice(start, i));
        continue;
      }
      const quote = ch;
      const start = i;
      i += 1;
      while (i < limit) {
        if (line[i] === '\\' && i + 1 < limit) {
          i += 2;
          continue;
        }
        if (line[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      let kind: HighlightTokenKind = 'string';
      if (lang === 'json' && quote === '"') {
        let j = i;
        while (j < limit && (line[j] === ' ' || line[j] === '\t')) j += 1;
        if (line[j] === ':') kind = 'type';
      }
      pushToken(tokens, kind, line.slice(start, i));
      continue;
    }

    // CSS @-rules / custom properties
    if (lang === 'css' && ch === '@' && next && isIdentStart(next)) {
      const start = i;
      i += 2;
      while (i < limit && (isIdentPart(line[i]) || line[i] === '-')) i += 1;
      pushToken(tokens, 'keyword', line.slice(start, i));
      continue;
    }

    // Numbers
    if (isDigit(ch) && (i === 0 || !isIdentPart(line[i - 1]))) {
      const start = i;
      if (ch === '0' && (next === 'x' || next === 'X')) {
        i += 2;
        while (i < limit && (isHexDigit(line[i]) || line[i] === '_')) i += 1;
      } else {
        while (i < limit && (isDigit(line[i]) || line[i] === '_')) i += 1;
        if (i + 1 < limit && line[i] === '.' && isDigit(line[i + 1])) {
          i += 1;
          while (i < limit && (isDigit(line[i]) || line[i] === '_')) i += 1;
        }
        if (i < limit && (line[i] === 'e' || line[i] === 'E')) {
          i += 1;
          if (i < limit && (line[i] === '+' || line[i] === '-')) i += 1;
          while (i < limit && (isDigit(line[i]) || line[i] === '_')) i += 1;
        }
      }
      pushToken(tokens, 'number', line.slice(start, i));
      continue;
    }

    // Identifiers, keywords, types, and YAML/CSS keys
    if (isIdentStart(ch)) {
      const start = i;
      i += 1;
      while (
        i < limit &&
        (isIdentPart(line[i]) || ((lang === 'css' || lang === 'yaml') && line[i] === '-'))
      ) {
        i += 1;
      }
      const word = line.slice(start, i);
      const lookup = lang === 'sql' ? word.toLowerCase() : word;

      if ((lang === 'yaml' || lang === 'css') && line[i] === ':') {
        pushToken(tokens, 'type', word);
      } else if (keywords.has(lookup)) {
        pushToken(tokens, 'keyword', word);
      } else if (types.has(lookup)) {
        pushToken(tokens, 'type', word);
      } else if (
        (lang === 'js' || lang === 'py' || lang === 'go' || lang === 'rs') &&
        isPascalCaseType(word)
      ) {
        pushToken(tokens, 'type', word);
      } else {
        pushToken(tokens, 'plain', word);
      }
      continue;
    }

    pushToken(tokens, 'plain', ch);
    i += 1;
  }

  if (limit < line.length) {
    pushToken(tokens, 'plain', line.slice(limit));
  }

  return tokens;
}

function renderHighlightedCode(content: string, lang: HighlightLang, enabled: boolean): React.ReactNode {
  if (!enabled || lang === 'plain' || !content) {
    return content;
  }
  const tokens = tokenizeCodeLine(content, lang);
  return tokens.map((tok, idx) =>
    tok.kind === 'plain' ? (
      <React.Fragment key={idx}>{tok.text}</React.Fragment>
    ) : (
      <span key={idx} className={`rv-tok-${tok.kind}`}>
        {tok.text}
      </span>
    ),
  );
}

interface DiffViewerProps {
  file: DiffFile | null;
  viewMode: DiffViewMode;
  syntaxHighlight?: boolean;
  viewed: boolean;
  canToggleAuxPane: boolean;
  annotations: ReviewAnnotation[];
  onToggleViewed: (viewed: boolean) => void;
  onOpenInHost: (absolutePath: string) => void;
  onAddAnnotation: (input: {
    filePath: string;
    side: AnnotationSide;
    startLine: number;
    endLine: number;
    category: AnnotationCategory;
    comment: string;
    codeSnippet: string;
    fileFingerprint: string;
  }) => Promise<void>;
  onUpdateAnnotation: (id: string, category: AnnotationCategory, comment: string) => Promise<void>;
  onToggleResolve: (id: string) => Promise<void>;
  onDeleteAnnotation: (id: string) => Promise<void>;
}

function getLineTarget(line: DiffLine): { side: AnnotationSide; lineNo: number } | null {
  if (line.newLine !== null) return { side: 'new', lineNo: line.newLine };
  if (line.oldLine !== null) return { side: 'old', lineNo: line.oldLine };
  return null;
}

function riskHintToCategory(hint: DiffLineRiskHint): AnnotationCategory {
  if (hint.category === 'secret' || hint.category === 'permission') {
    return 'security';
  }
  return 'bug';
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  file,
  viewMode,
  syntaxHighlight = true,
  viewed,
  canToggleAuxPane,
  annotations,
  onToggleViewed,
  onOpenInHost,
  onAddAnnotation,
  onUpdateAnnotation,
  onToggleResolve,
  onDeleteAnnotation,
}) => {
  const { dict } = useNovI18n();
  const r = dict.panels.review;

  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [composerPreset, setComposerPreset] = useState<ComposerPreset | null>(null);
  const [saving, setSaving] = useState(false);

  const INITIAL_DIFF_LINE_BUDGET = 400;
  const [lineRenderBudget, setLineRenderBudget] = useState<number>(INITIAL_DIFF_LINE_BUDGET);
  const highlightLang = useMemo(() => detectHighlightLanguage(file?.path), [file?.path]);

  React.useEffect(() => {
    setSelection(null);
    setComposerPreset(null);
    setLineRenderBudget(INITIAL_DIFF_LINE_BUDGET);
  }, [file?.path]);

  const { visibleHunks, totalDiffLines, renderedDiffLines, visibleAnchors } = useMemo(() => {
    if (!file) {
      return {
        visibleHunks: [],
        totalDiffLines: 0,
        renderedDiffLines: 0,
        visibleAnchors: new Set<string>(),
      };
    }
    let total = 0;
    let remaining = lineRenderBudget;
    let rendered = 0;
    const anchors = new Set<string>();
    const slicedHunks: Array<{ hunk: typeof file.hunks[number]; originalIndex: number }> = [];
    for (let i = 0; i < file.hunks.length; i += 1) {
      const h = file.hunks[i];
      total += h.lines.length;
      if (remaining <= 0) continue;
      const keptLines = h.lines.length <= remaining ? h.lines : h.lines.slice(0, remaining);
      for (const l of keptLines) {
        if (l.newLine !== null) anchors.add(`new:${l.newLine}`);
        if (l.oldLine !== null) anchors.add(`old:${l.oldLine}`);
      }
      if (h.lines.length <= remaining) {
        slicedHunks.push({ hunk: h, originalIndex: i });
        rendered += h.lines.length;
        remaining -= h.lines.length;
      } else {
        slicedHunks.push({
          hunk: { ...h, lines: keptLines },
          originalIndex: i,
        });
        rendered += remaining;
        remaining = 0;
      }
    }
    return {
      visibleHunks: slicedHunks,
      totalDiffLines: total,
      renderedDiffLines: rendered,
      visibleAnchors: anchors,
    };
  }, [file, lineRenderBudget]);

  const { byAnchor, unanchored, hiddenAnnotationsCount } = useMemo(() => {
    const validAnchors = new Set<string>();
    if (file) {
      for (const h of file.hunks) {
        for (const l of h.lines) {
          if (l.newLine !== null) validAnchors.add(`new:${l.newLine}`);
          if (l.oldLine !== null) validAnchors.add(`old:${l.oldLine}`);
        }
      }
    }
    const map = new Map<string, ReviewAnnotation[]>();
    const orphans: ReviewAnnotation[] = [];
    let hidden = 0;
    for (const ann of annotations) {
      const key = `${ann.side}:${ann.endLine}`;
      if (validAnchors.has(key)) {
        const list = map.get(key) ?? [];
        list.push(ann);
        map.set(key, list);
        if (!visibleAnchors.has(key)) {
          hidden += 1;
        }
      } else {
        orphans.push(ann);
      }
    }
    return { byAnchor: map, unanchored: orphans, hiddenAnnotationsCount: hidden };
  }, [annotations, file, visibleAnchors]);

  if (!file) {
    return (
      <section className="rv-diff-pane rv-diff-empty">
        <div className="rv-empty-state">
          <div className="rv-empty-icon">✓</div>
          <h3>{r.title}</h3>
          <p>{r.noChanges}</p>
        </div>
      </section>
    );
  }

  const handleLineClick = (side: AnnotationSide, lineNo: number, shiftKey: boolean) => {
    setComposerPreset(null);
    if (shiftKey && selection && selection.side === side) {
      const lo = Math.min(selection.anchorLine, lineNo);
      const hi = Math.max(selection.anchorLine, lineNo);
      setSelection({ side, anchorLine: selection.anchorLine, startLine: lo, endLine: hi });
      return;
    }
    if (
      selection &&
      selection.side === side &&
      selection.startLine === lineNo &&
      selection.endLine === lineNo
    ) {
      setSelection(null);
      return;
    }
    setSelection({ side, anchorLine: lineNo, startLine: lineNo, endLine: lineNo });
  };

  const handleQuickAnnotateRisk = (
    side: AnnotationSide,
    lineNo: number,
    riskHint: DiffLineRiskHint,
  ) => {
    setSelection({ side, anchorLine: lineNo, startLine: lineNo, endLine: lineNo });
    setComposerPreset({
      category: riskHintToCategory(riskHint),
      comment: `[${riskHint.category.toUpperCase()}] ${riskHint.message}`,
    });
  };

  const isSelectedLine = (side: AnnotationSide, lineNo: number | null): boolean => {
    if (!selection || lineNo === null || selection.side !== side) return false;
    return lineNo >= selection.startLine && lineNo <= selection.endLine;
  };

  const snippetPreview = selection
    ? extractCodeSnippet(file, selection.startLine, selection.endLine, selection.side, 6)
    : '';

  const submitNewAnnotation = async (category: AnnotationCategory, comment: string) => {
    if (!selection) return;
    setSaving(true);
    try {
      await onAddAnnotation({
        filePath: file.path,
        side: selection.side,
        startLine: selection.startLine,
        endLine: selection.endLine,
        category,
        comment,
        codeSnippet: extractCodeSnippet(file, selection.startLine, selection.endLine, selection.side, 8),
        fileFingerprint: file.fingerprint,
      });
      setSelection(null);
      setComposerPreset(null);
    } finally {
      setSaving(false);
    }
  };

  const renderRiskBadge = (
    line: DiffLine | null | undefined,
    target: { side: AnnotationSide; lineNo: number } | null,
  ) => {
    const hint = line?.riskHint;
    if (!hint || !target) return null;
    const sevLabel = hint.severity === 'high' ? r.severityHigh : r.severityMed;
    return (
      <span className="rv-line-risk-inline" onClick={(e) => e.stopPropagation()}>
        <span
          className={`rv-line-risk-badge is-${hint.severity}`}
          title={hint.message}
        >
          ⚠ {r.riskLineBadge} · {sevLabel}
        </span>
        <button
          type="button"
          className="rv-line-risk-btn"
          title={hint.message}
          onClick={(e) => {
            e.stopPropagation();
            handleQuickAnnotateRisk(target.side, target.lineNo, hint);
          }}
        >
          {r.quickAnnotateRisk}
        </button>
      </span>
    );
  };

  return (
    <section className="rv-diff-pane">
      <div className="rv-file-header">
        <div className="rv-file-header-main">
          <span className={`rv-status-pill rv-status-${file.status}`}>{file.status}</span>
          <span className="rv-file-header-path" title={file.path}>
            {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
          </span>
          {!file.isBinary && (
            <span className="rv-file-header-deltas">
              <span className="rv-delta-add">+{file.additions}</span>
              <span className="rv-delta-del">-{file.deletions}</span>
            </span>
          )}
          {file.riskTags.map((tag) => (
            <span key={tag} className={`rv-risk-tag rv-risk-${tag}`}>
              {tag}
            </span>
          ))}
        </div>
        <div className="rv-file-header-actions">
          {canToggleAuxPane && file.absolutePath && file.status !== 'deleted' && (
            <button
              type="button"
              className="rv-btn rv-btn-subtle"
              onClick={() => onOpenInHost(file.absolutePath!)}
              title={dict.panels.canvas.openFile}
            >
              {dict.panels.canvas.openFile} ↗
            </button>
          )}
          <label className="rv-viewed-toggle">
            <input
              type="checkbox"
              checked={viewed}
              onChange={(e) => onToggleViewed(e.target.checked)}
            />
            <span>{r.resolved}</span>
          </label>
        </div>
      </div>

      {file.isTruncated && (
        <div className="rv-banner rv-banner-warn">
          {file.truncationReason ?? dict.panels.studio.truncatedNotice}
        </div>
      )}

      {unanchored.length > 0 && (
        <div className="rv-unanchored-section">
          <div className="rv-unanchored-title">{r.annotations}</div>
          {unanchored.map((ann) => (
            <AnnotationCard
              key={ann.id}
              annotation={ann}
              onUpdate={onUpdateAnnotation}
              onToggleResolve={onToggleResolve}
              onDelete={onDeleteAnnotation}
            />
          ))}
        </div>
      )}

      {file.isBinary ? (
        <div className="rv-empty-state">
          <p>{r.noChanges}</p>
        </div>
      ) : file.hunks.length === 0 ? (
        <div className="rv-empty-state">
          <p>{r.noChanges}</p>
        </div>
      ) : (
        <div className="rv-diff-scroll">
          {visibleHunks.map(({ hunk, originalIndex: hIdx }) => {
            const prevHunk = hIdx > 0 ? file.hunks[hIdx - 1] : null;
            const hiddenLines = prevHunk
              ? Math.max(0, hunk.newStart - (prevHunk.newStart + prevHunk.newCount))
              : Math.max(0, hunk.newStart - 1);

            if (viewMode === 'split') {
              const splitRows = buildSplitRows(hunk.lines);
              return (
                <div key={`${hunk.header}-${hIdx}`} className="rv-hunk-block">
                  <div className="rv-hunk-header">
                    <span className="rv-hunk-meta">
                      {hiddenLines > 0 ? `⋯ ${hiddenLines} · ` : ''}
                      {hunk.header}
                    </span>
                  </div>
                  <div className="rv-diff-table rv-split-table">
                    {splitRows.map((row) => {
                      const leftTarget =
                        row.left?.oldLine != null ? { side: 'old' as const, lineNo: row.left.oldLine } : null;
                      const rightTarget =
                        row.right?.newLine != null ? { side: 'new' as const, lineNo: row.right.newLine } : null;

                      const leftSelected = leftTarget ? isSelectedLine('old', leftTarget.lineNo) : false;
                      const rightSelected = rightTarget ? isSelectedLine('new', rightTarget.lineNo) : false;

                      const rowAnnotations: ReviewAnnotation[] = [
                        ...(leftTarget && row.left?.type === 'del'
                          ? byAnchor.get(`old:${leftTarget.lineNo}`) ?? []
                          : []),
                        ...(rightTarget ? byAnchor.get(`new:${rightTarget.lineNo}`) ?? [] : []),
                      ];

                      const showComposerHere =
                        selection !== null &&
                        ((selection.side === 'new' && rightTarget?.lineNo === selection.endLine) ||
                          (selection.side === 'old' && leftTarget?.lineNo === selection.endLine));

                      const rightRiskClass = row.right?.riskHint
                        ? `rv-has-risk rv-risk-sev-${row.right.riskHint.severity}`
                        : '';

                      return (
                        <React.Fragment key={row.index}>
                          <div className="rv-split-row">
                            <div
                              className={`rv-split-cell rv-line-${row.left?.type ?? 'empty'} ${leftSelected ? 'is-selected' : ''}`}
                              onClick={(e) => {
                                if (leftTarget) handleLineClick('old', leftTarget.lineNo, e.shiftKey);
                              }}
                            >
                              <span className="rv-gutter-num">{row.left?.oldLine ?? ''}</span>
                              <span className="rv-gutter-sign">
                                {row.left?.type === 'del' ? '-' : row.left ? ' ' : ''}
                              </span>
                              <span className="rv-code-text">
                                {renderHighlightedCode(row.left?.content ?? '', highlightLang, syntaxHighlight)}
                              </span>
                            </div>
                            <div
                              className={`rv-split-cell rv-line-${row.right?.type ?? 'empty'} ${rightSelected ? 'is-selected' : ''} ${rightRiskClass}`}
                              onClick={(e) => {
                                if (rightTarget) handleLineClick('new', rightTarget.lineNo, e.shiftKey);
                              }}
                            >
                              <span className="rv-gutter-num">{row.right?.newLine ?? ''}</span>
                              <span className="rv-gutter-sign">
                                {row.right?.type === 'add' ? '+' : row.right ? ' ' : ''}
                              </span>
                              <span className="rv-code-line-wrap">
                                <span className="rv-code-text">
                                  {renderHighlightedCode(row.right?.content ?? '', highlightLang, syntaxHighlight)}
                                </span>
                                {renderRiskBadge(row.right, rightTarget)}
                              </span>
                            </div>
                          </div>

                          {rowAnnotations.length > 0 && (
                            <div className="rv-inline-thread">
                              {rowAnnotations.map((ann) => (
                                <AnnotationCard
                                  key={ann.id}
                                  annotation={ann}
                                  onUpdate={onUpdateAnnotation}
                                  onToggleResolve={onToggleResolve}
                                  onDelete={onDeleteAnnotation}
                                />
                              ))}
                            </div>
                          )}

                          {showComposerHere && selection && (
                            <div className="rv-inline-thread">
                              <AnnotationComposer
                                filePath={file.path}
                                side={selection.side}
                                startLine={selection.startLine}
                                endLine={selection.endLine}
                                snippetPreview={snippetPreview}
                                initialCategory={composerPreset?.category}
                                initialComment={composerPreset?.comment}
                                saving={saving}
                                onSubmit={submitNewAnnotation}
                                onCancel={() => {
                                  setSelection(null);
                                  setComposerPreset(null);
                                }}
                              />
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            }

            return (
              <div key={`${hunk.header}-${hIdx}`} className="rv-hunk-block">
                <div className="rv-hunk-header">
                  <span className="rv-hunk-meta">
                    {hiddenLines > 0 ? `⋯ ${hiddenLines} · ` : ''}
                    {hunk.header}
                  </span>
                </div>
                <div className="rv-diff-table rv-unified-table">
                  {hunk.lines.map((line, lIdx) => {
                    const target = getLineTarget(line);
                    const selected = target ? isSelectedLine(target.side, target.lineNo) : false;
                    const anchorKey = target ? `${target.side}:${target.lineNo}` : '';
                    const lineAnnotations = anchorKey ? byAnchor.get(anchorKey) ?? [] : [];
                    const showComposerHere =
                      selection !== null &&
                      target !== null &&
                      selection.side === target.side &&
                      selection.endLine === target.lineNo;

                    const riskClass = line.riskHint
                      ? `rv-has-risk rv-risk-sev-${line.riskHint.severity}`
                      : '';

                    return (
                      <React.Fragment key={lIdx}>
                        <div
                          className={`rv-diff-row rv-line-${line.type} ${selected ? 'is-selected' : ''} ${riskClass}`}
                          onClick={(e) => {
                            if (target) handleLineClick(target.side, target.lineNo, e.shiftKey);
                          }}
                        >
                          <span className="rv-gutter-action" title={r.addComment}>
                            +
                          </span>
                          <span className="rv-gutter-num">{line.oldLine ?? ''}</span>
                          <span className="rv-gutter-num">{line.newLine ?? ''}</span>
                          <span className="rv-gutter-sign">
                            {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                          </span>
                          <span className="rv-code-line-wrap">
                            <span className="rv-code-text">
                              {renderHighlightedCode(line.content, highlightLang, syntaxHighlight)}
                            </span>
                            {renderRiskBadge(line, target)}
                          </span>
                        </div>

                        {lineAnnotations.length > 0 && (
                          <div className="rv-inline-thread">
                            {lineAnnotations.map((ann) => (
                              <AnnotationCard
                                key={ann.id}
                                annotation={ann}
                                onUpdate={onUpdateAnnotation}
                                onToggleResolve={onToggleResolve}
                                onDelete={onDeleteAnnotation}
                              />
                            ))}
                          </div>
                        )}

                        {showComposerHere && selection && (
                          <div className="rv-inline-thread">
                            <AnnotationComposer
                              filePath={file.path}
                              side={selection.side}
                              startLine={selection.startLine}
                              endLine={selection.endLine}
                              snippetPreview={snippetPreview}
                              initialCategory={composerPreset?.category}
                              initialComment={composerPreset?.comment}
                              saving={saving}
                              onSubmit={submitNewAnnotation}
                              onCancel={() => {
                                setSelection(null);
                                setComposerPreset(null);
                              }}
                            />
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {renderedDiffLines < totalDiffLines && (
            <div className="rv-diff-progressive-bar">
              <span>
                {dict.common.truncated} · {renderedDiffLines} / {totalDiffLines}
                {hiddenAnnotationsCount > 0
                  ? ` · ${hiddenAnnotationsCount} ${r.annotations}`
                  : ''}
              </span>
              <div className="rv-diff-progressive-actions">
                <button
                  type="button"
                  className="rv-btn"
                  onClick={() => setLineRenderBudget((prev) => prev + INITIAL_DIFF_LINE_BUDGET)}
                >
                  +{Math.min(INITIAL_DIFF_LINE_BUDGET, totalDiffLines - renderedDiffLines)}
                </button>
                <button
                  type="button"
                  className="rv-btn"
                  onClick={() => setLineRenderBudget(totalDiffLines)}
                >
                  100% ({totalDiffLines})
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
