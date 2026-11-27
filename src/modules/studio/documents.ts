import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  isLikelyOpenApiDocument,
  OPENAPI_MAX_FILE_BYTES,
  parseOpenApiSpecFromContent,
  type ParsedOpenApiSpec,
} from './openapi.js';
import {
  redactStudioSecrets,
  resolveStudioWorkspaceFile,
} from './sources.js';

// ============================================================================
// Constants & Public Types
// ============================================================================

export const STUDIO_MAX_DOC_LINES = 200;
export const STUDIO_DEFAULT_DOC_LINES = 80;

export const STUDIO_ZIP_MAX_ENTRIES = 512;
export const STUDIO_ZIP_MAX_ENTRY_BYTES = 4 * 1024 * 1024; // 4 MiB per ZIP entry
export const STUDIO_ZIP_MAX_TOTAL_BYTES = 6 * 1024 * 1024; // 6 MiB total inflated per ZIP
export const STUDIO_PDF_MAX_STREAM_BYTES = 2 * 1024 * 1024; // 2 MiB total inflated PDF streams

export interface StudioDocumentOutlineItem {
  level: number;
  title: string;
  line: number;
  kind: string;
}

export interface StudioDocumentSheetPreview {
  name: string;
  rows: string[][];
  totalRows: number;
}

export interface StudioDocumentResult {
  mode: 'live' | 'demo';
  filePath: string;
  format: 'markdown' | 'text' | 'html' | 'svg' | 'yaml' | 'xml' | 'json' | 'docx' | 'xlsx' | 'pdf';
  bytes: number;
  totalLines: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
  outline: StudioDocumentOutlineItem[];
  content: string;
  lines: string[];
  metadata: Record<string, unknown>;
  sheets?: StudioDocumentSheetPreview[];
  openApiSpec?: ParsedOpenApiSpec;
}

export interface StudioInspectDocumentOptions {
  filePath: string;
  startLine?: number;
  maxLines?: number;
}

// ============================================================================
// Pure-Node Zero-Dependency ZIP Reader (ZIP Bomb Guarded)
// ============================================================================

interface ZipCentralEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

class ReadOnlyZipArchive {
  private readonly buf: Buffer;
  private readonly entries = new Map<string, ZipCentralEntry>();
  private totalInflatedBytes = 0;

  constructor(buf: Buffer) {
    this.buf = buf;
    this.parseCentralDirectory();
  }

  private parseCentralDirectory(): void {
    if (this.buf.length < 22) {
      throw new Error('Invalid ZIP archive: file too small');
    }

    // Locate End of Central Directory (EOCD) signature 0x06054b50 within trailing 64 KiB + 22 bytes
    const minOffset = Math.max(0, this.buf.length - 65557);
    let eocdOffset = -1;
    for (let pos = this.buf.length - 22; pos >= minOffset; pos -= 1) {
      if (this.buf.readUInt32LE(pos) === 0x06054b50) {
        const commentLen = this.buf.readUInt16LE(pos + 20);
        if (pos + 22 + commentLen === this.buf.length) {
          eocdOffset = pos;
          break;
        }
      }
    }

    if (eocdOffset < 0) {
      throw new Error('Invalid ZIP archive: End of Central Directory record not found');
    }

    const entryCount = this.buf.readUInt16LE(eocdOffset + 10);
    const cdSize = this.buf.readUInt32LE(eocdOffset + 12);
    const cdOffset = this.buf.readUInt32LE(eocdOffset + 16);

    if (entryCount > STUDIO_ZIP_MAX_ENTRIES) {
      throw new Error(
        `ZIP security guard rejected archive: entry count ${entryCount} exceeds limit (${STUDIO_ZIP_MAX_ENTRIES})`,
      );
    }

    if (cdOffset + cdSize > eocdOffset) {
      throw new Error('Invalid ZIP archive: central directory bounds exceed file size');
    }

    let offset = cdOffset;
    for (let i = 0; i < entryCount; i += 1) {
      if (offset + 46 > cdOffset + cdSize) {
        throw new Error('Invalid ZIP archive: truncated central directory entry');
      }
      if (this.buf.readUInt32LE(offset) !== 0x02014b50) {
        throw new Error('Invalid ZIP archive: corrupt central directory signature');
      }

      const compressionMethod = this.buf.readUInt16LE(offset + 10);
      const compressedSize = this.buf.readUInt32LE(offset + 20);
      const uncompressedSize = this.buf.readUInt32LE(offset + 24);
      const fileNameLen = this.buf.readUInt16LE(offset + 28);
      const extraLen = this.buf.readUInt16LE(offset + 30);
      const commentLen = this.buf.readUInt16LE(offset + 32);
      const localHeaderOffset = this.buf.readUInt32LE(offset + 42);

      if (uncompressedSize > STUDIO_ZIP_MAX_ENTRY_BYTES) {
        throw new Error(
          `ZIP security guard rejected entry exceeding 4 MiB uncompressed limit (${uncompressedSize} bytes)`,
        );
      }

      const nameStart = offset + 46;
      const nameEnd = nameStart + fileNameLen;
      if (nameEnd + extraLen + commentLen > cdOffset + cdSize) {
        throw new Error('Invalid ZIP archive: central directory entry exceeds directory length');
      }

      const name = this.buf.subarray(nameStart, nameEnd).toString('utf8');
      this.entries.set(name, {
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });

      offset = nameEnd + extraLen + commentLen;
    }
  }

  listEntryNames(): string[] {
    return Array.from(this.entries.keys());
  }

  hasEntry(name: string): boolean {
    return this.entries.has(name);
  }

  readEntryBuffer(name: string): Buffer {
    const entry = this.entries.get(name);
    if (!entry) {
      throw new Error(`ZIP entry not found: ${name}`);
    }

    const lfh = entry.localHeaderOffset;
    if (lfh + 30 > this.buf.length || this.buf.readUInt32LE(lfh) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local file header for entry: ${name}`);
    }

    const localNameLen = this.buf.readUInt16LE(lfh + 26);
    const localExtraLen = this.buf.readUInt16LE(lfh + 28);
    const dataStart = lfh + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > this.buf.length) {
      throw new Error(`ZIP entry data out of bounds: ${name}`);
    }

    const remainingTotal = STUDIO_ZIP_MAX_TOTAL_BYTES - this.totalInflatedBytes;
    const maxAllowed = Math.min(STUDIO_ZIP_MAX_ENTRY_BYTES, remainingTotal);
    if (maxAllowed <= 0) {
      throw new Error(
        `ZIP security guard rejected archive: total inflated bytes exceeded ${STUDIO_ZIP_MAX_TOTAL_BYTES} bytes`,
      );
    }

    const compressedSlice = this.buf.subarray(dataStart, dataEnd);
    let output: Buffer;

    if (entry.compressionMethod === 0) {
      if (compressedSlice.length > maxAllowed) {
        throw new Error(
          `ZIP security guard rejected stored entry exceeding limit (${compressedSlice.length} > ${maxAllowed})`,
        );
      }
      output = Buffer.from(compressedSlice);
    } else if (entry.compressionMethod === 8) {
      try {
        output = zlib.inflateRawSync(compressedSlice, { maxOutputLength: maxAllowed });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ERR_BUFFER_TOO_LARGE') {
          throw new Error(
            `ZIP bomb protection triggered while inflating "${name}": decompressed output exceeded security cap (${maxAllowed} bytes)`,
          );
        }
        throw new Error(
          `Failed to inflate ZIP entry "${name}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for "${name}"`);
    }

    this.totalInflatedBytes += output.length;
    if (this.totalInflatedBytes > STUDIO_ZIP_MAX_TOTAL_BYTES) {
      throw new Error(
        `ZIP security guard rejected archive: total inflated size exceeded ${STUDIO_ZIP_MAX_TOTAL_BYTES} bytes`,
      );
    }

    return output;
  }

  readEntryText(name: string): string {
    return this.readEntryBuffer(name).toString('utf8');
  }
}

// ============================================================================
// XML / Text Slicing & Outline Helpers
// ============================================================================

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function sliceDocumentLines(
  allLines: string[],
  startLineInput?: number,
  maxLinesInput?: number,
): { startLine: number; endLine: number; truncated: boolean; lines: string[]; content: string } {
  const total = allLines.length;
  const maxLines = Math.max(
    1,
    Math.min(
      typeof maxLinesInput === 'number' && Number.isFinite(maxLinesInput)
        ? Math.floor(maxLinesInput)
        : STUDIO_DEFAULT_DOC_LINES,
      STUDIO_MAX_DOC_LINES,
    ),
  );
  const startLine = Math.max(
    1,
    typeof startLineInput === 'number' && Number.isFinite(startLineInput)
      ? Math.floor(startLineInput)
      : 1,
  );

  if (total === 0) {
    return { startLine: 1, endLine: 0, truncated: false, lines: [], content: '' };
  }

  const clampedStart = Math.min(startLine, total);
  const sliceEndExclusive = Math.min(total, clampedStart - 1 + maxLines);
  const rawSlice = allLines.slice(clampedStart - 1, sliceEndExclusive);
  const redactedSlice = rawSlice.map((line) => redactStudioSecrets(line));
  const endLine = clampedStart + redactedSlice.length - 1;

  return {
    startLine: clampedStart,
    endLine,
    truncated: sliceEndExclusive < total,
    lines: redactedSlice,
    content: redactedSlice.join('\n'),
  };
}

export function extractTextOutline(
  format: 'markdown' | 'text' | 'html' | 'svg' | 'yaml' | 'xml' | 'json',
  lines: string[],
): StudioDocumentOutlineItem[] {
  const outline: StudioDocumentOutlineItem[] = [];
  const push = (item: StudioDocumentOutlineItem) => {
    if (outline.length < 100) {
      outline.push({ ...item, title: redactStudioSecrets(item.title).slice(0, 140) });
    }
  };

  if (format === 'json') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const topKey = /^\s{1,2}"([^"]+)"\s*:/.exec(line);
      if (topKey) {
        push({ level: 1, title: topKey[1], line: i + 1, kind: 'key' });
        continue;
      }
      const pathKey = /^\s{3,6}"(\/[^"]+)"\s*:/.exec(line);
      if (pathKey) {
        push({ level: 2, title: pathKey[1], line: i + 1, kind: 'endpoint' });
      }
    }
    return outline;
  }

  if (format === 'markdown') {
    let inFence = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
      if (m) {
        push({ level: m[1].length, title: m[2].trim(), line: i + 1, kind: 'heading' });
      }
    }
    return outline;
  }

  if (format === 'yaml') {
    let inPaths = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*#/.test(line) || !line.trim()) continue;
      const top = /^([A-Za-z0-9_.-]+)\s*:/.exec(line);
      if (top) {
        inPaths = top[1] === 'paths';
        push({ level: 1, title: top[1], line: i + 1, kind: 'section' });
        continue;
      }
      if (inPaths) {
        const ep = /^\s{2}('\/[^']+'|"\/[^"]+"|\/[^\s:]+)\s*:/.exec(line);
        if (ep) {
          push({ level: 2, title: ep[1].replace(/^['"]|['"]$/g, ''), line: i + 1, kind: 'endpoint' });
        }
      }
    }
    return outline;
  }

  if (format === 'html') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(line);
      if (titleMatch) {
        push({ level: 1, title: decodeXmlEntities(titleMatch[1].trim()), line: i + 1, kind: 'title' });
      }
      const hMatch = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/i.exec(line);
      if (hMatch) {
        const clean = decodeXmlEntities(hMatch[2].replace(/<[^>]+>/g, '').trim());
        if (clean) {
          push({ level: Number(hMatch[1]), title: clean, line: i + 1, kind: `h${hMatch[1]}` });
        }
      }
    }
    return outline;
  }

  if (format === 'svg') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const tMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(line);
      if (tMatch) {
        push({ level: 1, title: decodeXmlEntities(tMatch[1].trim()), line: i + 1, kind: 'title' });
      }
      const gMatch = /<(?:svg|g|symbol)\b[^>]*\bid=["']([^"']+)["']/i.exec(line);
      if (gMatch) {
        push({ level: 2, title: `#${gMatch[1]}`, line: i + 1, kind: 'group' });
      }
    }
    return outline;
  }

  if (format === 'xml') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const tagMatch = /^(\s*)<([A-Za-z_][A-Za-z0-9_.:-]*)\b(?![/?!])/.exec(line);
      if (tagMatch && tagMatch[1].length <= 4) {
        const level = tagMatch[1].length === 0 ? 1 : 2;
        push({ level, title: `<${tagMatch[2]}>`, line: i + 1, kind: 'element' });
      }
    }
    return outline;
  }

  // Plain text: detect section-like headings or first non-empty line of paragraphs
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (i === 0 || (lines[i - 1]?.trim() === '' && trimmed.length <= 90)) {
      push({ level: i === 0 ? 1 : 2, title: trimmed, line: i + 1, kind: 'paragraph' });
    }
  }
  return outline;
}

// ============================================================================
// DOCX / XLSX / PDF Pure-Node Parsers
// ============================================================================

function parseDocxDocument(
  relPath: string,
  buf: Buffer,
  bytes: number,
  startLine?: number,
  maxLines?: number,
): StudioDocumentResult {
  const zip = new ReadOnlyZipArchive(buf);
  if (!zip.hasEntry('word/document.xml')) {
    throw new Error(`Invalid DOCX file (missing word/document.xml): ${relPath}`);
  }

  const docXml = zip.readEntryText('word/document.xml');
  const metadata: Record<string, unknown> = {
    entryCount: zip.listEntryNames().length,
  };

  if (zip.hasEntry('docProps/core.xml')) {
    try {
      const coreXml = zip.readEntryText('docProps/core.xml');
      const titleMatch = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(coreXml);
      const creatorMatch = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(coreXml);
      if (titleMatch) metadata.title = redactStudioSecrets(decodeXmlEntities(titleMatch[1].trim()));
      if (creatorMatch) metadata.author = redactStudioSecrets(decodeXmlEntities(creatorMatch[1].trim()));
    } catch {
      // Optional metadata only
    }
  }

  const paragraphs: string[] = [];
  const outline: StudioDocumentOutlineItem[] = [];

  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let paraMatch: RegExpExecArray | null;
  while ((paraMatch = paraRe.exec(docXml)) !== null) {
    const pBody = paraMatch[1];

    // Replace inline breaks and tabs before extracting w:t text runs
    const normalizedP = pBody
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:br\b[^>]*\/>/g, '\n');

    const textParts: string[] = [];
    const textRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|\n|\t/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = textRe.exec(normalizedP)) !== null) {
      if (tMatch[0] === '\n' || tMatch[0] === '\t') {
        textParts.push(tMatch[0]);
      } else if (tMatch[1] !== undefined) {
        textParts.push(decodeXmlEntities(tMatch[1]));
      }
    }

    const joined = textParts.join('').trim();
    if (!joined) continue;

    const subLines = joined.split('\n').map((l) => l.trimEnd());
    const startIdx = paragraphs.length + 1;
    paragraphs.push(...subLines);

    const styleMatch = /<w:pStyle\b[^>]*w:val=["']([^"']+)["']/i.exec(pBody);
    if (styleMatch) {
      const styleVal = styleMatch[1];
      const headingNum = /^Heading([1-6])$/i.exec(styleVal);
      if (headingNum) {
        outline.push({
          level: Number(headingNum[1]),
          title: redactStudioSecrets(subLines[0]).slice(0, 140),
          line: startIdx,
          kind: 'heading',
        });
      } else if (/^Title$/i.test(styleVal)) {
        outline.push({
          level: 1,
          title: redactStudioSecrets(subLines[0]).slice(0, 140),
          line: startIdx,
          kind: 'title',
        });
      }
    }
  }

  // Fallback if XML has no <w:p> wrappers
  if (paragraphs.length === 0) {
    const stripped = decodeXmlEntities(docXml.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (stripped) paragraphs.push(stripped);
  }

  metadata.paragraphCount = paragraphs.length;
  const sliced = sliceDocumentLines(paragraphs, startLine, maxLines);

  return {
    mode: 'live',
    filePath: relPath,
    format: 'docx',
    bytes,
    totalLines: paragraphs.length,
    startLine: sliced.startLine,
    endLine: sliced.endLine,
    truncated: sliced.truncated,
    outline: outline.slice(0, 100),
    content: sliced.content,
    lines: sliced.lines,
    metadata,
  };
}

function excelColRefToIndex(cellRef: string): number {
  const lettersMatch = /^([A-Za-z]+)/.exec(cellRef);
  if (!lettersMatch) return -1;
  const letters = lettersMatch[1].toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i += 1) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

function parseSharedStringsXml(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRe.exec(xml)) !== null) {
    const body = siMatch[1];
    const parts: string[] = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRe.exec(body)) !== null) {
      parts.push(decodeXmlEntities(tMatch[1]));
    }
    out.push(parts.join(''));
  }
  return out;
}

function resolveXlsxSheets(zip: ReadOnlyZipArchive): Array<{ name: string; path: string }> {
  const sheets: Array<{ name: string; path: string }> = [];
  const relMap = new Map<string, string>();

  if (zip.hasEntry('xl/_rels/workbook.xml.rels')) {
    try {
      const relsXml = zip.readEntryText('xl/_rels/workbook.xml.rels');
      const relRe = /<Relationship\b([^>]+)\/?>/g;
      let m: RegExpExecArray | null;
      while ((m = relRe.exec(relsXml)) !== null) {
        const attrs = m[1];
        const idM = /\bId=["']([^"']+)["']/.exec(attrs);
        const targetM = /\bTarget=["']([^"']+)["']/.exec(attrs);
        if (idM && targetM) {
          let target = targetM[1].replace(/^\/+/, '');
          if (!target.startsWith('xl/')) {
            target = `xl/${target}`;
          }
          relMap.set(idM[1], target);
        }
      }
    } catch {
      // Fallback below
    }
  }

  if (zip.hasEntry('xl/workbook.xml')) {
    try {
      const wbXml = zip.readEntryText('xl/workbook.xml');
      const sheetRe = /<sheet\b([^>]+)\/?>/g;
      let m: RegExpExecArray | null;
      while ((m = sheetRe.exec(wbXml)) !== null) {
        const attrs = m[1];
        const nameM = /\bname=["']([^"']+)["']/.exec(attrs);
        const ridM = /\br:id=["']([^"']+)["']/.exec(attrs);
        const name = nameM ? decodeXmlEntities(nameM[1]) : `Sheet${sheets.length + 1}`;
        const mapped = ridM ? relMap.get(ridM[1]) : undefined;
        const fallbackPath = `xl/worksheets/sheet${sheets.length + 1}.xml`;
        const resolvedPath = mapped && zip.hasEntry(mapped) ? mapped : fallbackPath;
        if (zip.hasEntry(resolvedPath)) {
          sheets.push({ name, path: resolvedPath });
        }
      }
    } catch {
      // Fallback below
    }
  }

  if (sheets.length === 0) {
    const candidates = zip
      .listEntryNames()
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (let i = 0; i < candidates.length; i += 1) {
      sheets.push({ name: `Sheet${i + 1}`, path: candidates[i] });
    }
  }

  return sheets;
}

function parseWorksheetRows(
  sheetXml: string,
  sharedStrings: string[],
): { rows: string[][]; totalRows: number } {
  const MAX_XLSX_ROWS = 500;
  const MAX_XLSX_COLS = 64;
  const rows: string[][] = [];
  let totalRows = 0;

  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(sheetXml)) !== null) {
    totalRows += 1;
    if (rows.length >= MAX_XLSX_ROWS) continue;

    const rowBody = rowMatch[1];
    const cells: string[] = [];
    let nextColIdx = 0;

    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowBody)) !== null) {
      const attrs = cellMatch[1] ?? '';
      const inner = cellMatch[2] ?? '';
      const refM = /\br=["']([^"']+)["']/.exec(attrs);
      const typeM = /\bt=["']([^"']+)["']/.exec(attrs);
      const cellType = typeM ? typeM[1] : '';

      let colIdx = refM ? excelColRefToIndex(refM[1]) : nextColIdx;
      if (colIdx < 0) colIdx = nextColIdx;
      nextColIdx = colIdx + 1;

      if (colIdx >= MAX_XLSX_COLS) continue;
      while (cells.length <= colIdx) cells.push('');

      let value = '';
      if (cellType === 's') {
        const vM = /<v[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        const idx = vM ? Number.parseInt(vM[1].trim(), 10) : -1;
        value = idx >= 0 && idx < sharedStrings.length ? sharedStrings[idx] : '';
      } else if (cellType === 'inlineStr') {
        const tParts: string[] = [];
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let tM: RegExpExecArray | null;
        while ((tM = tRe.exec(inner)) !== null) {
          tParts.push(decodeXmlEntities(tM[1]));
        }
        value = tParts.join('');
      } else if (cellType === 'b') {
        const vM = /<v[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        value = vM && vM[1].trim() === '1' ? 'TRUE' : 'FALSE';
      } else {
        const vM = /<v[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        value = vM ? decodeXmlEntities(vM[1].trim()) : '';
      }

      cells[colIdx] = redactStudioSecrets(value);
    }

    if (cells.some((c) => c !== '')) {
      rows.push(cells);
    }
  }

  return { rows, totalRows };
}

function parseXlsxDocument(
  relPath: string,
  buf: Buffer,
  bytes: number,
  startLine?: number,
  maxLines?: number,
): StudioDocumentResult {
  const zip = new ReadOnlyZipArchive(buf);
  const sheetDefs = resolveXlsxSheets(zip);
  if (sheetDefs.length === 0) {
    throw new Error(`Invalid XLSX file (no worksheets found): ${relPath}`);
  }

  const sharedStrings = zip.hasEntry('xl/sharedStrings.xml')
    ? parseSharedStringsXml(zip.readEntryText('xl/sharedStrings.xml'))
    : [];

  const primarySheet = sheetDefs[0];
  const parsedPrimary = parseWorksheetRows(zip.readEntryText(primarySheet.path), sharedStrings);

  const previewLines: string[] = [`# Sheet: ${primarySheet.name}`];
  for (let i = 0; i < parsedPrimary.rows.length; i += 1) {
    const row = parsedPrimary.rows[i];
    previewLines.push(row.join('\t'));
  }

  const outline: StudioDocumentOutlineItem[] = sheetDefs.map((s, idx) => ({
    level: 1,
    title: s.name,
    line: idx === 0 ? 1 : previewLines.length,
    kind: 'sheet',
  }));

  const sliced = sliceDocumentLines(previewLines, startLine, maxLines);
  const sheets: StudioDocumentSheetPreview[] = [
    {
      name: primarySheet.name,
      rows: parsedPrimary.rows.slice(0, 100),
      totalRows: parsedPrimary.totalRows,
    },
  ];

  return {
    mode: 'live',
    filePath: relPath,
    format: 'xlsx',
    bytes,
    totalLines: previewLines.length,
    startLine: sliced.startLine,
    endLine: sliced.endLine,
    truncated: sliced.truncated,
    outline,
    content: sliced.content,
    lines: sliced.lines,
    metadata: {
      sheetNames: sheetDefs.map((s) => s.name),
      activeSheet: primarySheet.name,
      sharedStringCount: sharedStrings.length,
      rowCount: parsedPrimary.totalRows,
      entryCount: zip.listEntryNames().length,
    },
    sheets,
  };
}

function decodePdfLiteralString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    if (i + 1 >= raw.length) break;
    const next = raw[i + 1];
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
      case 'b':
        out += '\b';
        i += 1;
        break;
      case 'f':
        out += '\f';
        i += 1;
        break;
      case '(':
      case ')':
      case '\\':
        out += next;
        i += 1;
        break;
      case '\r':
        i += raw[i + 2] === '\n' ? 2 : 1;
        break;
      case '\n':
        i += 1;
        break;
      default: {
        // Octal escape \ddd
        if (next >= '0' && next <= '7') {
          let oct = next;
          let j = i + 2;
          while (j < raw.length && oct.length < 3 && raw[j] >= '0' && raw[j] <= '7') {
            oct += raw[j];
            j += 1;
          }
          out += String.fromCharCode(Number.parseInt(oct, 8));
          i = j - 1;
        } else {
          out += next;
          i += 1;
        }
      }
    }
  }
  return out;
}

function decodePdfHexString(hexRaw: string): string {
  const cleaned = hexRaw.replace(/\s+/g, '');
  const padded = cleaned.length % 2 === 1 ? `${cleaned}0` : cleaned;
  const bytes = Buffer.from(padded, 'hex');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    // UTF-16BE with BOM
    const chars: string[] = [];
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      chars.push(String.fromCharCode((bytes[i] << 8) | bytes[i + 1]));
    }
    return chars.join('');
  }
  return bytes.toString('latin1');
}

function extractPdfInfoMetadata(latin1Text: string): Record<string, string> {
  const info: Record<string, string> = {};
  const keys = ['Title', 'Author', 'Subject', 'Creator', 'Producer', 'CreationDate'] as const;
  for (const key of keys) {
    const litRe = new RegExp(`/${key}\\s*\\(([^\\\\()]*(?:\\\\.[^\\\\()]*)*)\\)`);
    const litM = litRe.exec(latin1Text);
    if (litM) {
      const val = redactStudioSecrets(decodePdfLiteralString(litM[1]).trim());
      if (val) info[key.toLowerCase()] = val;
      continue;
    }
    const hexRe = new RegExp(`/${key}\\s*<([0-9A-Fa-f\\s]+)>`);
    const hexM = hexRe.exec(latin1Text);
    if (hexM) {
      const val = redactStudioSecrets(decodePdfHexString(hexM[1]).trim());
      if (val) info[key.toLowerCase()] = val;
    }
  }
  return info;
}

function extractPdfTextFromContentStream(streamText: string): string[] {
  const lines: string[] = [];
  const btEtRe = /\bBT\b([\s\S]*?)\bET\b/g;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = btEtRe.exec(streamText)) !== null) {
    const block = blockMatch[1];
    let currentLine = '';
    let i = 0;

    const flushLine = () => {
      const cleaned = currentLine.replace(/\s+/g, ' ').trim();
      if (cleaned) lines.push(cleaned);
      currentLine = '';
    };

    while (i < block.length) {
      const ch = block[i];

      // Literal PDF string (...)
      if (ch === '(') {
        let depth = 1;
        let j = i + 1;
        let escaped = false;
        while (j < block.length && depth > 0) {
          const c = block[j];
          if (escaped) {
            escaped = false;
          } else if (c === '\\') {
            escaped = true;
          } else if (c === '(') {
            depth += 1;
          } else if (c === ')') {
            depth -= 1;
          }
          j += 1;
        }
        const literalRaw = block.slice(i + 1, j - 1);
        const after = block.slice(j, j + 12).trimStart();
        if (after.startsWith('Tj') || after.startsWith("'") || after.startsWith('"')) {
          currentLine += decodePdfLiteralString(literalRaw);
          if (after.startsWith("'") || after.startsWith('"')) {
            flushLine();
          }
        }
        i = j;
        continue;
      }

      // TJ array [ (Hello) -120 (World) ] TJ
      if (ch === '[') {
        let j = i + 1;
        let parts = '';
        let inParen = false;
        let parenDepth = 0;
        let escaped = false;
        let tokenStart = -1;

        while (j < block.length) {
          const c = block[j];
          if (inParen) {
            if (escaped) {
              escaped = false;
            } else if (c === '\\') {
              escaped = true;
            } else if (c === '(') {
              parenDepth += 1;
            } else if (c === ')') {
              parenDepth -= 1;
              if (parenDepth === 0) {
                parts += decodePdfLiteralString(block.slice(tokenStart, j));
                inParen = false;
              }
            }
          } else if (c === '(') {
            inParen = true;
            parenDepth = 1;
            tokenStart = j + 1;
          } else if (c === ']') {
            j += 1;
            break;
          } else if (c === '-' && j + 1 < block.length && /\d/.test(block[j + 1])) {
            const numMatch = /^-(\d+(?:\.\d+)?)/.exec(block.slice(j));
            if (numMatch && Number(numMatch[1]) >= 120 && parts && !parts.endsWith(' ')) {
              parts += ' ';
            }
          }
          j += 1;
        }
        const after = block.slice(j, j + 12).trimStart();
        if (after.startsWith('TJ') && parts) {
          currentLine += parts;
        }
        i = j;
        continue;
      }

      // Line breaks on T* / Td / TD
      if (
        (ch === 'T' && (block[i + 1] === '*' || block[i + 1] === 'd' || block[i + 1] === 'D')) &&
        (i === 0 || /\s/.test(block[i - 1]))
      ) {
        flushLine();
        i += 2;
        continue;
      }

      i += 1;
    }

    flushLine();
  }

  return lines;
}

function parsePdfDocument(
  relPath: string,
  buf: Buffer,
  bytes: number,
  startLine?: number,
  maxLines?: number,
): StudioDocumentResult {
  const headText = buf.subarray(0, Math.min(buf.length, 1024)).toString('latin1');
  const versionMatch = /%PDF-(\d+\.\d+)/.exec(headText);
  if (!versionMatch) {
    throw new Error(`Invalid PDF file (missing %PDF header): ${relPath}`);
  }
  const pdfVersion = versionMatch[1];

  const fullLatin1 = buf.toString('latin1');
  const pageMatches = fullLatin1.match(/\/Type\s*\/Page(?![A-Za-z])/g);
  let estimatedPages = pageMatches ? pageMatches.length : 0;
  if (estimatedPages === 0) {
    const countMatch = /\/Count\s+(\d+)/.exec(fullLatin1);
    if (countMatch) estimatedPages = Number.parseInt(countMatch[1], 10) || 0;
  }

  const info = extractPdfInfoMetadata(fullLatin1);

  const streamKeyword = Buffer.from('stream');
  const endstreamKeyword = Buffer.from('endstream');
  const extractedLines: string[] = [];
  let totalDecompressed = 0;
  let streamsInspected = 0;
  let searchPos = 0;

  while (searchPos < buf.length && streamsInspected < 256) {
    const kwIdx = buf.indexOf(streamKeyword, searchPos);
    if (kwIdx < 0) break;
    searchPos = kwIdx + streamKeyword.length;

    // Validate token boundary before and newline after 'stream'
    if (kwIdx > 0) {
      const prevByte = buf[kwIdx - 1];
      const validPrev =
        prevByte === 0x0a ||
        prevByte === 0x0d ||
        prevByte === 0x20 ||
        prevByte === 0x09 ||
        prevByte === 0x3e || // '>'
        prevByte === 0x5d; // ']'
      if (!validPrev) continue;
    }

    let dataStart = kwIdx + streamKeyword.length;
    if (buf[dataStart] === 0x0d && buf[dataStart + 1] === 0x0a) {
      dataStart += 2;
    } else if (buf[dataStart] === 0x0a) {
      dataStart += 1;
    } else {
      continue;
    }

    const endIdx = buf.indexOf(endstreamKeyword, dataStart);
    if (endIdx < 0) break;
    searchPos = endIdx + endstreamKeyword.length;
    streamsInspected += 1;

    let dataEnd = endIdx;
    if (dataEnd > dataStart && buf[dataEnd - 1] === 0x0a) dataEnd -= 1;
    if (dataEnd > dataStart && buf[dataEnd - 1] === 0x0d) dataEnd -= 1;

    const dictWindowStart = Math.max(0, kwIdx - 512);
    const dictText = buf.subarray(dictWindowStart, kwIdx).toString('latin1');
    const rawStream = buf.subarray(dataStart, dataEnd);

    // Skip image/binary filters that never hold text operators
    if (/\/(?:DCTDecode|JPXDecode|JBIG2Decode|CCITTFaxDecode)\b/.test(dictText)) {
      continue;
    }

    let decodedText: string | null = null;
    if (/\/FlateDecode\b/.test(dictText)) {
      const remaining = STUDIO_PDF_MAX_STREAM_BYTES - totalDecompressed;
      if (remaining <= 0) continue;
      try {
        const inflated = zlib.inflateSync(rawStream, { maxOutputLength: remaining });
        totalDecompressed += inflated.length;
        decodedText = inflated.toString('latin1');
      } catch {
        // Gracefully skip non-standard predictor or oversized compressed stream
        continue;
      }
    } else if (rawStream.length <= STUDIO_PDF_MAX_STREAM_BYTES - totalDecompressed) {
      const textCandidate = rawStream.toString('latin1');
      if (textCandidate.includes('BT') && textCandidate.includes('ET')) {
        totalDecompressed += rawStream.length;
        decodedText = textCandidate;
      }
    }

    if (decodedText && decodedText.includes('BT')) {
      const streamLines = extractPdfTextFromContentStream(decodedText);
      extractedLines.push(...streamLines);
    }
  }

  const outline: StudioDocumentOutlineItem[] = [];
  if (info.title) {
    outline.push({ level: 1, title: info.title, line: 1, kind: 'title' });
  }
  for (let i = 0; i < extractedLines.length && outline.length < 30; i += 1) {
    const line = extractedLines[i];
    if (line.length >= 3 && line.length <= 90 && (i === 0 || /^\d+(?:\.\d+)*\s+\S/.test(line))) {
      outline.push({
        level: i === 0 ? 1 : 2,
        title: redactStudioSecrets(line),
        line: i + 1,
        kind: 'section',
      });
    }
  }

  const sliced = sliceDocumentLines(extractedLines, startLine, maxLines);

  return {
    mode: 'live',
    filePath: relPath,
    format: 'pdf',
    bytes,
    totalLines: extractedLines.length,
    startLine: sliced.startLine,
    endLine: sliced.endLine,
    truncated: sliced.truncated,
    outline,
    content: sliced.content,
    lines: sliced.lines,
    metadata: {
      pdfVersion,
      estimatedPages,
      info,
      streamsInspected,
      decompressedStreamBytes: totalDecompressed,
    },
  };
}

// ============================================================================
// Public Document Inspector Entrypoint (studio_inspect_document)
// ============================================================================

export function inspectStudioDocument(
  workspaceRoot: string,
  opts: StudioInspectDocumentOptions,
): StudioDocumentResult {
  const resolved = resolveStudioWorkspaceFile(workspaceRoot, opts.filePath);
  const ext = path.extname(resolved.relPath).toLowerCase();
  const buf = fs.readFileSync(resolved.realTarget);

  if (ext === '.docx') {
    return parseDocxDocument(resolved.relPath, buf, resolved.stat.size, opts.startLine, opts.maxLines);
  }
  if (ext === '.xlsx') {
    return parseXlsxDocument(resolved.relPath, buf, resolved.stat.size, opts.startLine, opts.maxLines);
  }
  if (ext === '.pdf') {
    return parsePdfDocument(resolved.relPath, buf, resolved.stat.size, opts.startLine, opts.maxLines);
  }

  let textFormat: 'markdown' | 'text' | 'html' | 'svg' | 'yaml' | 'xml' | 'json';
  switch (ext) {
    case '.md':
    case '.mdx':
      textFormat = 'markdown';
      break;
    case '.txt':
      textFormat = 'text';
      break;
    case '.html':
    case '.htm':
      textFormat = 'html';
      break;
    case '.svg':
      textFormat = 'svg';
      break;
    case '.yaml':
    case '.yml':
      textFormat = 'yaml';
      break;
    case '.xml':
      textFormat = 'xml';
      break;
    case '.json':
      textFormat = 'json';
      break;
    default:
      throw new Error(
        `Unsupported document format "${ext || '(none)'}" for studio_inspect_document (supported: .md, .txt, .html, .svg, .yaml, .yml, .xml, .json, .docx, .xlsx, .pdf)`,
      );
  }

  const rawText = buf.toString('utf8');
  const allLines = rawText.split(/\r?\n/);
  const outline = extractTextOutline(textFormat, allLines);
  const sliced = sliceDocumentLines(allLines, opts.startLine, opts.maxLines);

  const metadata: Record<string, unknown> = {
    extension: ext,
    lineCount: allLines.length,
    charCount: rawText.length,
  };

  if (textFormat === 'svg') {
    const vbMatch = /\bviewBox=["']([^"']+)["']/i.exec(rawText);
    if (vbMatch) metadata.viewBox = vbMatch[1];
  }

  let openApiSpec: ParsedOpenApiSpec | undefined;
  if (
    (textFormat === 'yaml' || textFormat === 'json') &&
    resolved.stat.size <= OPENAPI_MAX_FILE_BYTES &&
    isLikelyOpenApiDocument(resolved.relPath, rawText, textFormat)
  ) {
    try {
      const openApiExt: '.json' | '.yaml' | '.yml' =
        ext === '.json' ? '.json' : ext === '.yml' ? '.yml' : '.yaml';
      openApiSpec = parseOpenApiSpecFromContent(resolved.relPath, rawText, openApiExt);
      metadata.openapi = openApiSpec.specVersion;
      metadata.openApiEndpoints = openApiSpec.totalEndpoints;
    } catch {
      // Preserve offline document slicing even if OpenAPI parsing rejects malformed/unsafe input
    }
  }

  return {
    mode: 'live',
    filePath: resolved.relPath,
    format: textFormat,
    bytes: resolved.stat.size,
    totalLines: allLines.length,
    startLine: sliced.startLine,
    endLine: sliced.endLine,
    truncated: sliced.truncated,
    outline,
    content: sliced.content,
    lines: sliced.lines,
    metadata,
    ...(openApiSpec ? { openApiSpec } : {}),
  };
}
