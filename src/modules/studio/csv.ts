import {
  redactStudioSecrets,
  rowMatchesFilter,
  sanitizeCellValue,
  sanitizeRowRecord,
  type StudioDataResult,
} from './sources.js';

// ============================================================================
// CSV / TSV RFC-4180 Parser & JSON / NDJSON Table Inspector
// ============================================================================

export const STUDIO_MAX_PREVIEW_COLUMNS = 100;

const REDACTED_PLACEHOLDER_CATALOG =
  '[redacted:private_key][redacted:aws_key][redacted:github_token][redacted:google_api_key][redacted:api_secret][redacted:slack_token][redacted_webhook][redacted_jwt][redacted_bot_token][redacted_key][redacted]';

function filterCouldMatchRedactedPlaceholder(needleLower: string): boolean {
  return Boolean(needleLower) && REDACTED_PLACEHOLDER_CATALOG.includes(needleLower);
}

function rawValuesMayMatchFilter(values: Iterable<unknown>, needleLower: string): boolean {
  if (!needleLower) return true;
  if (filterCouldMatchRedactedPlaceholder(needleLower)) return true;
  for (const val of values) {
    if (val === null || val === undefined) continue;
    if (typeof val === 'string') {
      if (val.toLowerCase().includes(needleLower)) return true;
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      if (String(val).toLowerCase().includes(needleLower)) return true;
    } else {
      try {
        if (JSON.stringify(val).toLowerCase().includes(needleLower)) return true;
      } catch {
        if (String(val).toLowerCase().includes(needleLower)) return true;
      }
    }
  }
  return false;
}

function sliceAndSanitizeObjectRow(
  raw: Record<string, unknown>,
  maxColumns: number,
): Record<string, unknown> {
  const entries = Object.entries(raw);
  if (entries.length <= maxColumns) {
    return sanitizeRowRecord(raw);
  }
  const bounded: Record<string, unknown> = {};
  for (let i = 0; i < maxColumns; i += 1) {
    const [k, v] = entries[i];
    bounded[k] = v;
  }
  return sanitizeRowRecord(bounded);
}

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

  // Deduplicate, cap preview column count, and redact header columns
  const rawHeader = records[0].slice(0, STUDIO_MAX_PREVIEW_COLUMNS);
  const usedHeaders = new Map<string, number>();
  const columns: string[] = rawHeader.map((h, idx) => {
    const cleaned = redactStudioSecrets(h.trim());
    const base = cleaned || `col_${idx + 1}`;
    const prev = usedHeaders.get(base) ?? 0;
    usedHeaders.set(base, prev + 1);
    return prev === 0 ? base : `${base}_${prev + 1}`;
  });

  const buildSanitizedCsvRow = (
    rec: string[],
  ): { obj: Record<string, unknown>; neededCols: number } => {
    const obj: Record<string, unknown> = {};
    const neededCols = Math.min(STUDIO_MAX_PREVIEW_COLUMNS, Math.max(columns.length, rec.length));
    for (let cIdx = 0; cIdx < neededCols; cIdx += 1) {
      const colName = cIdx < columns.length ? columns[cIdx] : `col_${cIdx + 1}`;
      obj[colName] = sanitizeCellValue(rec[cIdx] ?? '');
    }
    return { obj, neededCols };
  };

  const extendColumnsTo = (neededCols: number): void => {
    while (columns.length < neededCols) {
      columns.push(`col_${columns.length + 1}`);
    }
  };

  const needle = filter?.trim().toLowerCase() || '';
  let totalRows = 0;
  const rows: Array<Record<string, unknown>> = [];

  if (!needle) {
    // Unfiltered fast path: slice rows/columns to preview bounds BEFORE running secret redaction
    totalRows = Math.max(0, records.length - 1);
    const endIdx = Math.min(records.length, 1 + limit);
    for (let rIdx = 1; rIdx < endIdx; rIdx += 1) {
      const { obj, neededCols } = buildSanitizedCsvRow(records[rIdx]);
      extendColumnsTo(neededCols);
      rows.push(obj);
    }
  } else {
    // Filtered path: cheap raw-value precheck skips non-matching rows without regex redaction,
    // then redacts bounded columns BEFORE matching and only extends `columns` on matched rows
    // so non-matching ragged rows never leak redacted secrets via a column-count filter oracle.
    for (let rIdx = 1; rIdx < records.length; rIdx += 1) {
      const rec = records[rIdx];
      const boundedRaw =
        rec.length > STUDIO_MAX_PREVIEW_COLUMNS ? rec.slice(0, STUDIO_MAX_PREVIEW_COLUMNS) : rec;
      if (!rawValuesMayMatchFilter(boundedRaw, needle)) {
        continue;
      }
      const { obj, neededCols } = buildSanitizedCsvRow(boundedRaw);
      if (!rowMatchesFilter(obj, needle)) {
        continue;
      }
      totalRows += 1;
      if (rows.length < limit) {
        extendColumnsTo(neededCols);
        rows.push(obj);
      }
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

      if (!needle) {
        totalMatched += 1;
        if (rows.length < limit) {
          const record: Record<string, unknown> =
            parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? sliceAndSanitizeObjectRow(parsed as Record<string, unknown>, STUDIO_MAX_PREVIEW_COLUMNS)
              : { value: sanitizeCellValue(parsed) };
          for (const key of Object.keys(record)) colSet.add(key);
          rows.push(record);
        }
        continue;
      }

      const rawVals =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? Object.values(parsed as Record<string, unknown>).slice(0, STUDIO_MAX_PREVIEW_COLUMNS)
          : [parsed];
      if (!rawValuesMayMatchFilter(rawVals, needle)) {
        continue;
      }
      const record: Record<string, unknown> =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? sliceAndSanitizeObjectRow(parsed as Record<string, unknown>, STUDIO_MAX_PREVIEW_COLUMNS)
          : { value: sanitizeCellValue(parsed) };

      if (!rowMatchesFilter(record, needle)) {
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

    if (!needle) {
      totalMatched = parsed.length;
      const previewEnd = Math.min(parsed.length, limit);
      for (let i = 0; i < previewEnd; i += 1) {
        const item = parsed[i];
        const record: Record<string, unknown> =
          item && typeof item === 'object' && !Array.isArray(item)
            ? sliceAndSanitizeObjectRow(item as Record<string, unknown>, STUDIO_MAX_PREVIEW_COLUMNS)
            : { index: i, value: sanitizeCellValue(item) };
        for (const key of Object.keys(record)) colSet.add(key);
        rows.push(record);
      }
    } else {
      for (let i = 0; i < parsed.length; i += 1) {
        const item = parsed[i];
        const rawVals =
          item && typeof item === 'object' && !Array.isArray(item)
            ? Object.values(item as Record<string, unknown>).slice(0, STUDIO_MAX_PREVIEW_COLUMNS)
            : [i, item];
        if (!rawValuesMayMatchFilter(rawVals, needle)) {
          continue;
        }
        const record: Record<string, unknown> =
          item && typeof item === 'object' && !Array.isArray(item)
            ? sliceAndSanitizeObjectRow(item as Record<string, unknown>, STUDIO_MAX_PREVIEW_COLUMNS)
            : { index: i, value: sanitizeCellValue(item) };

        if (!rowMatchesFilter(record, needle)) {
          continue;
        }
        totalMatched += 1;
        if (rows.length < limit) {
          for (const key of Object.keys(record)) colSet.add(key);
          rows.push(record);
        }
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

    if (!needle) {
      totalMatched = topLevelKeys.length;
      const previewEnd = Math.min(topLevelKeys.length, limit);
      for (let i = 0; i < previewEnd; i += 1) {
        const key = topLevelKeys[i];
        const val = obj[key];
        const valType = Array.isArray(val)
          ? `array(${val.length})`
          : val === null
            ? 'null'
            : typeof val;
        const preview = sanitizeCellValue(val);
        rows.push({ key, type: valType, preview });
      }
    } else {
      for (const key of topLevelKeys) {
        const val = obj[key];
        const valType = Array.isArray(val)
          ? `array(${val.length})`
          : val === null
            ? 'null'
            : typeof val;
        if (!rawValuesMayMatchFilter([key, valType, val], needle)) {
          continue;
        }
        const preview = sanitizeCellValue(val);
        const record: Record<string, unknown> = { key, type: valType, preview };
        if (!rowMatchesFilter(record, needle)) {
          continue;
        }
        totalMatched += 1;
        if (rows.length < limit) {
          rows.push(record);
        }
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
