import type { DiffFile, DiffLine, SplitRow } from './types.js';

/**
 * Align a hunk's unified lines into side-by-side Split View rows.
 * Consecutive deletions followed immediately by additions are paired row-by-row.
 */
export function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  let rowIndex = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.type === 'context') {
      rows.push({ index: rowIndex++, left: line, right: line });
      i += 1;
      continue;
    }

    if (line.type === 'del') {
      const dels: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'del') {
        dels.push(lines[i]);
        i += 1;
      }
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].type === 'add') {
        adds.push(lines[i]);
        i += 1;
      }
      const maxLen = Math.max(dels.length, adds.length);
      for (let k = 0; k < maxLen; k++) {
        rows.push({
          index: rowIndex++,
          left: dels[k] ?? null,
          right: adds[k] ?? null,
        });
      }
      continue;
    }

    rows.push({ index: rowIndex++, left: null, right: line });
    i += 1;
  }

  return rows;
}

/**
 * Extract a compact snippet of lines from a DiffFile for an annotation range.
 */
export function extractCodeSnippet(
  file: DiffFile | undefined,
  startLine: number,
  endLine: number,
  side: 'new' | 'old' = 'new',
  maxSnippetLines = 8,
): string {
  if (!file || file.hunks.length === 0) return '';
  const lo = Math.min(startLine, endLine);
  const hi = Math.max(startLine, endLine);
  const matched: string[] = [];

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      const lineNo = side === 'old' ? line.oldLine : line.newLine;
      if (lineNo !== null && lineNo >= lo && lineNo <= hi) {
        const marker = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
        matched.push(`${lineNo} | ${marker}${line.content}`);
      }
    }
  }

  if (matched.length <= maxSnippetLines) {
    return matched.join('\n');
  }
  const head = matched.slice(0, maxSnippetLines - 1);
  return [...head, `... (${matched.length - head.length} more lines)`].join('\n');
}
