import type { DiffLine } from './types.js';

/**
 * Pure TypeScript line diff using LCS DP for moderate files and
 * linear fallback for very large files (> 1200 lines) to guarantee O(1) UI responsiveness.
 */
export function computeLineDiff(beforeText: string, afterText: string): { added: number; removed: number; hunks: DiffLine[] } {
  const a = beforeText.length === 0 ? [] : beforeText.split(/\r?\n/);
  const b = afterText.length === 0 ? [] : afterText.split(/\r?\n/);

  if (a.length * b.length > 900_000) {
    return computeFallbackDiff(a, b);
  }

  const m = a.length;
  const n = b.length;
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }
  }

  const raw: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;

  while (i < m && j < n) {
    if (a[i] === b[j]) {
      raw.push({ type: 'ctx', oldLine: i + 1, newLine: j + 1, text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ type: 'del', oldLine: i + 1, newLine: null, text: a[i] });
      removed++;
      i++;
    } else {
      raw.push({ type: 'add', oldLine: null, newLine: j + 1, text: b[j] });
      added++;
      j++;
    }
  }

  while (i < m) {
    raw.push({ type: 'del', oldLine: i + 1, newLine: null, text: a[i] });
    removed++;
    i++;
  }
  while (j < n) {
    raw.push({ type: 'add', oldLine: null, newLine: j + 1, text: b[j] });
    added++;
    j++;
  }

  return { added, removed, hunks: compactContext(raw, 3) };
}

function compactContext(lines: DiffLine[], radius: number): DiffLine[] {
  const changedIndices: number[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    if (lines[idx].type !== 'ctx') changedIndices.push(idx);
  }
  if (changedIndices.length === 0) return lines.slice(0, 30);

  const keep = new Uint8Array(lines.length);
  for (const idx of changedIndices) {
    const start = Math.max(0, idx - radius);
    const end = Math.min(lines.length - 1, idx + radius);
    for (let k = start; k <= end; k++) keep[k] = 1;
  }

  const out: DiffLine[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    if (keep[idx]) out.push(lines[idx]);
    if (out.length >= 260) break;
  }
  return out;
}

function computeFallbackDiff(a: string[], b: string[]): { added: number; removed: number; hunks: DiffLine[] } {
  const max = Math.max(a.length, b.length);
  const hunks: DiffLine[] = [];
  let added = 0;
  let removed = 0;

  for (let idx = 0; idx < max; idx++) {
    const oldL = a[idx];
    const newL = b[idx];
    if (oldL === newL && oldL !== undefined) {
      if (hunks.length < 200) hunks.push({ type: 'ctx', oldLine: idx + 1, newLine: idx + 1, text: oldL });
    } else {
      if (oldL !== undefined) {
        removed++;
        if (hunks.length < 200) hunks.push({ type: 'del', oldLine: idx + 1, newLine: null, text: oldL });
      }
      if (newL !== undefined) {
        added++;
        if (hunks.length < 200) hunks.push({ type: 'add', oldLine: null, newLine: idx + 1, text: newL });
      }
    }
  }
  return { added, removed, hunks };
}
