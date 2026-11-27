import {
  rowMatchesFilter,
  sanitizeCellValue,
  sanitizeRowRecord,
  type StudioDataResult,
} from './sources.js';

// ============================================================================
// CSV / TSV RFC-4180 Parser & JSON / NDJSON Table Inspector
// ============================================================================

/**
 * Linear-time RFC-4180 CSV/TSV parser supporting quoted fields, embedded commas/newlines,
 * and escaped double-quotes (""). Zero regex backtracking.
 */
export function parseDelimitedRecords(rawText: string, delimiter: ',' | '\t'): string[][] {
  const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
      continue;
    }

    if (ch === '"' && field.length === 0) {
      inQuotes = true;
      i += 1;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r') {
      row.push(field);
      field = '';
      records.push(row);
      row = [];
      i += i + 1 < text.length && text[i + 1] === '\n' ? 2 : 1;
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      records.push(row);
      row = [];
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  // Drop trailing single empty line from final newline
  while (records.length > 0) {
    const last = records[records.length - 1];
    if (last.length === 1 && last[0] === '') {
      records.pop();
    } else {
      break;
    }
  }

  return records;
}

export function inspectCsvOrTsv(
  relPath: string,
  format: 'csv' | 'tsv',
  buf: Buffer,
  bytes: number,
  filter: string | undefined,
  limit: number,
): StudioDataResult {
  const delimiter = format === 'tsv' ? '\t' : ',';
  const records = parseDelimitedRecords(buf.toString('utf8'), delimiter);
  if (records.length === 0) {
    return {
      mode: 'live',
      filePath: relPath,
      format,
      bytes,
      columns: [],
      rows: [],
      totalRows: 0,
      returnedRows: 0,
      truncated: false,
      filter,
      summary: `${relPath} (${format.toUpperCase()}): empty file (0 rows).`,
    };
  }

  // Deduplicate and normalize header columns
  const rawHeader = records[0];
  const usedHeaders = new Map<string, number>();
  const columns: string[] = rawHeader.map((h, idx) => {
    const base = h.trim() || `col_${idx + 1}`;
    const prev = usedHeaders.get(base) ?? 0;
    usedHeaders.set(base, prev + 1);
    return prev === 0 ? base : `${base}_${prev + 1}`;
  });

  const needle = filter?.trim().toLowerCase() || '';
  let totalRows = 0;
  const rows: Array<Record<string, unknown>> = [];

  for (let rIdx = 1; rIdx < records.length; rIdx += 1) {
    const rec = records[rIdx];
    const obj: Record<string, unknown> = {};
    const maxCols = Math.max(columns.length, rec.length);
    for (let cIdx = 0; cIdx < maxCols; cIdx += 1) {
      if (cIdx >= columns.length) {
        columns.push(`col_${cIdx + 1}`);
      }
      obj[columns[cIdx]] = sanitizeCellValue(rec[cIdx] ?? '');
    }

    if (needle && !rowMatchesFilter(obj, needle)) {
      continue;
    }
    totalRows += 1;
    if (rows.length < limit) {
      rows.push(obj);
    }
  }

  return {
    mode: 'live',
    filePath: relPath,
    format,
    bytes,
    columns,
    rows,
    totalRows,
    returnedRows: rows.length,
    truncated: totalRows > rows.length,
    filter: filter?.trim() || undefined,
    summary: `${relPath} (${format.toUpperCase()}): ${columns.length} column(s), ${totalRows} matching row(s), showing ${rows.length}.`,
  };
}

export function inspectJsonOrNdjson(
  relPath: string,
  format: 'json' | 'ndjson',
  buf: Buffer,
  bytes: number,
  filter: string | undefined,
  limit: number,
): StudioDataResult {
  const text = buf.toString('utf8');
  const needle = filter?.trim().toLowerCase() || '';

  if (format === 'ndjson') {
    const rawLines = text.split(/\r?\n/);
    const colSet = new Set<string>();
    const rows: Array<Record<string, unknown>> = [];
    let totalValidItems = 0;
    let totalMatched = 0;
    let parseErrors = 0;

    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parseErrors += 1;
        continue;
      }
      totalValidItems += 1;
      const record: Record<string, unknown> =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? sanitizeRowRecord(parsed as Record<string, unknown>)
          : { value: sanitizeCellValue(parsed) };

      if (needle && !rowMatchesFilter(record, needle)) {
        continue;
      }
      totalMatched += 1;
      if (rows.length < limit) {
        for (const key of Object.keys(record)) colSet.add(key);
        rows.push(record);
      }
    }

    const columns = Array.from(colSet);
    return {
      mode: 'live',
      filePath: relPath,
      format: 'ndjson',
      bytes,
      columns,
      rows,
      totalRows: totalMatched,
      returnedRows: rows.length,
      truncated: totalMatched > rows.length,
      filter: filter?.trim() || undefined,
      summary: `${relPath} (NDJSON): ${totalValidItems} record(s), ${totalMatched} matched, showing ${rows.length}${parseErrors > 0 ? ` (${parseErrors} parse errors skipped)` : ''}.`,
      jsonSummary: {
        rootType: 'ndjson',
        itemCount: totalValidItems,
        parseErrors,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON in ${relPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (Array.isArray(parsed)) {
    const colSet = new Set<string>();
    const rows: Array<Record<string, unknown>> = [];
    let totalMatched = 0;

    for (let i = 0; i < parsed.length; i += 1) {
      const item = parsed[i];
      const record: Record<string, unknown> =
        item && typeof item === 'object' && !Array.isArray(item)
          ? sanitizeRowRecord(item as Record<string, unknown>)
          : { index: i, value: sanitizeCellValue(item) };

      if (needle && !rowMatchesFilter(record, needle)) {
        continue;
      }
      totalMatched += 1;
      if (rows.length < limit) {
        for (const key of Object.keys(record)) colSet.add(key);
        rows.push(record);
      }
    }

    return {
      mode: 'live',
      filePath: relPath,
      format: 'json',
      bytes,
      columns: Array.from(colSet),
      rows,
      totalRows: totalMatched,
      returnedRows: rows.length,
      truncated: totalMatched > rows.length,
      filter: filter?.trim() || undefined,
      summary: `${relPath} (JSON Array): ${parsed.length} item(s), ${totalMatched} matched, showing ${rows.length}.`,
      jsonSummary: {
        rootType: 'array',
        itemCount: parsed.length,
      },
    };
  }

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const topLevelKeys = Object.keys(obj);
    const rows: Array<Record<string, unknown>> = [];
    let totalMatched = 0;

    for (const key of topLevelKeys) {
      const val = obj[key];
      const valType = Array.isArray(val)
        ? `array(${val.length})`
        : val === null
          ? 'null'
          : typeof val;
      const preview = sanitizeCellValue(val);
      const record: Record<string, unknown> = { key, type: valType, preview };
      if (needle && !rowMatchesFilter(record, needle)) {
        continue;
      }
      totalMatched += 1;
      if (rows.length < limit) {
        rows.push(record);
      }
    }

    return {
      mode: 'live',
      filePath: relPath,
      format: 'json',
      bytes,
      columns: ['key', 'type', 'preview'],
      rows,
      totalRows: totalMatched,
      returnedRows: rows.length,
      truncated: totalMatched > rows.length,
      filter: filter?.trim() || undefined,
      summary: `${relPath} (JSON Object): ${topLevelKeys.length} top-level key(s), showing ${rows.length}.`,
      jsonSummary: {
        rootType: 'object',
        topLevelKeys: topLevelKeys.slice(0, 100),
        itemCount: topLevelKeys.length,
      },
    };
  }

  return {
    mode: 'live',
    filePath: relPath,
    format: 'json',
    bytes,
    columns: ['value'],
    rows: [{ value: sanitizeCellValue(parsed) }],
    totalRows: 1,
    returnedRows: 1,
    truncated: false,
    filter: filter?.trim() || undefined,
    summary: `${relPath} (JSON Primitive): 1 value.`,
    jsonSummary: {
      rootType: 'primitive',
      itemCount: 1,
    },
  };
}
