import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MODULE_CATALOG } from '../src/core/catalog.js';
import {
  inspectStudioData,
  inspectStudioDocument,
  listStudioSources,
  resolveStudioWorkspaceFile,
  runLoopbackHttpProbe,
  STUDIO_HTTP_MAX_BODY_BYTES,
  STUDIO_MAX_FILE_BYTES,
  validateLoopbackProbeUrl,
  validateReadOnlySqliteQuery,
  type StudioDataResult,
  type StudioDocumentResult,
  type StudioHttpProbeResult,
  type StudioSourcesResult,
} from '../src/modules/studio/core.js';
import { registerStudioModule } from '../src/modules/studio/register.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

function hasSqliteCli(): boolean {
  try {
    execFileSync('sqlite3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Minimal CRC32 + pure-Node ZIP builder for synthetic DOCX / XLSX / ZIP-bomb test fixtures
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface SyntheticZipEntry {
  name: string;
  content: Buffer | string;
  compress?: boolean;
  /** Optional forged uncompressedSize header field for testing ZIP bomb defenses */
  forgedUncompressedSize?: number;
}

function buildZipBuffer(entries: SyntheticZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const rawBuf = typeof entry.content === 'string' ? Buffer.from(entry.content, 'utf8') : entry.content;
    const useDeflate = entry.compress !== false;
    const dataBuf = useDeflate ? zlib.deflateRawSync(rawBuf) : rawBuf;
    const method = useDeflate ? 8 : 0;
    const checksum = crc32(rawBuf);
    const declaredUncompressed = entry.forgedUncompressedSize ?? rawBuf.length;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // Local file header signature
    lfh.writeUInt16LE(20, 4); // Version needed
    lfh.writeUInt16LE(0, 6); // Flags
    lfh.writeUInt16LE(method, 8); // Compression method
    lfh.writeUInt16LE(0, 10); // Mod time
    lfh.writeUInt16LE(0, 12); // Mod date
    lfh.writeUInt32LE(checksum, 14);
    lfh.writeUInt32LE(dataBuf.length, 18);
    lfh.writeUInt32LE(declaredUncompressed, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // Extra length

    const localRecord = Buffer.concat([lfh, nameBuf, dataBuf]);
    localParts.push(localRecord);

    const cdfh = Buffer.alloc(46);
    cdfh.writeUInt32LE(0x02014b50, 0); // Central directory header signature
    cdfh.writeUInt16LE(20, 4); // Version made by
    cdfh.writeUInt16LE(20, 6); // Version needed
    cdfh.writeUInt16LE(0, 8); // Flags
    cdfh.writeUInt16LE(method, 10);
    cdfh.writeUInt16LE(0, 12);
    cdfh.writeUInt16LE(0, 14);
    cdfh.writeUInt32LE(checksum, 16);
    cdfh.writeUInt32LE(dataBuf.length, 20);
    cdfh.writeUInt32LE(declaredUncompressed, 24);
    cdfh.writeUInt16LE(nameBuf.length, 28);
    cdfh.writeUInt16LE(0, 30); // Extra length
    cdfh.writeUInt16LE(0, 32); // Comment length
    cdfh.writeUInt16LE(0, 34); // Disk number
    cdfh.writeUInt16LE(0, 36); // Internal attrs
    cdfh.writeUInt32LE(0, 38); // External attrs
    cdfh.writeUInt32LE(offset, 42); // Relative offset of local header

    centralParts.push(Buffer.concat([cdfh, nameBuf]));
    offset += localRecord.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // Disk number
  eocd.writeUInt16LE(0, 6); // Start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function buildMinimalPdfBuffer(): Buffer {
  const flateContent = zlib.deflateSync(
    Buffer.from(
      'BT\n/F1 12 Tf\n72 720 Td\n(1.1 Studio PDF Verification) Tj\nT*\n[(Token leaked: ) -120 (sk-proj-abcdefghijklmnopqrstuvwxyz123456)] TJ\nET\n',
      'latin1',
    ),
  );

  const chunks: Buffer[] = [
    Buffer.from('%PDF-1.7\n', 'latin1'),
    Buffer.from(
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n' +
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>\nendobj\n' +
        '4 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n' +
        '6 0 obj\n<< /Title (Studio Offline Spec) /Author (agy-NOV QA) >>\nendobj\n',
      'latin1',
    ),
    Buffer.from(`5 0 obj\n<< /Length ${flateContent.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
    flateContent,
    Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
  ];
  return Buffer.concat(chunks);
}

describe('v0.4.0 Workspace Studio module', () => {
  it('1. studio_list_sources discovers data/document/openapi assets while blocking sensitive files, .git/node_modules, oversized files, and escaping symlinks', async () => {
    await withTempDir('agy-nov-studio-scan-', (tmpRoot) => {
      const ws = path.join(tmpRoot, 'workspace');
      const outside = path.join(tmpRoot, 'outside');
      fs.mkdirSync(path.join(ws, 'data'), { recursive: true });
      fs.mkdirSync(path.join(ws, 'docs'), { recursive: true });
      fs.mkdirSync(path.join(ws, 'api'), { recursive: true });
      fs.mkdirSync(path.join(ws, 'secrets'), { recursive: true });
      fs.mkdirSync(path.join(ws, 'credentials'), { recursive: true });
      fs.mkdirSync(path.join(ws, '.git'), { recursive: true });
      fs.mkdirSync(path.join(ws, 'node_modules', 'pkg'), { recursive: true });
      fs.mkdirSync(outside, { recursive: true });

      // Valid workspace sources
      fs.writeFileSync(path.join(ws, 'data', 'sales.csv'), 'id,amount\n1,42\n', 'utf8');
      fs.writeFileSync(path.join(ws, 'data', 'events.ndjson'), '{"event":"boot"}\n', 'utf8');
      fs.writeFileSync(path.join(ws, 'docs', 'guide.md'), '# Studio Guide\nHello\n', 'utf8');
      fs.writeFileSync(path.join(ws, 'docs', 'diagram.svg'), '<svg viewBox="0 0 10 10"><title>Arch</title></svg>', 'utf8');
      fs.writeFileSync(path.join(ws, 'api', 'openapi.yaml'), 'openapi: 3.1.0\ninfo:\n  title: Demo\n', 'utf8');
      fs.writeFileSync(
        path.join(ws, 'api', 'service-spec.json'),
        JSON.stringify({ openapi: '3.0.3', info: { title: 'Spec' } }),
        'utf8',
      );

      // Sensitive & restricted files that MUST be skipped and refused
      fs.writeFileSync(path.join(ws, '.env'), 'SECRET_KEY=topsecret\n', 'utf8');
      fs.writeFileSync(path.join(ws, '.env.production'), 'DB_PASSWORD=topsecret\n', 'utf8');
      fs.writeFileSync(path.join(ws, 'secrets', 'tokens.json'), '{"api_key":"secret"}\n', 'utf8');
      fs.writeFileSync(path.join(ws, 'credentials', 'aws.csv'), 'key,secret\na,b\n', 'utf8');
      fs.writeFileSync(path.join(ws, 'id_rsa'), 'PRIVATE KEY', 'utf8');
      fs.writeFileSync(path.join(ws, 'tls.pem'), 'CERT', 'utf8');
      fs.writeFileSync(path.join(ws, 'signing.key'), 'KEY', 'utf8');
      fs.writeFileSync(path.join(ws, '.git', 'HEAD.txt'), 'ref: refs/heads/main\n', 'utf8');
      fs.writeFileSync(path.join(ws, 'node_modules', 'pkg', 'data.json'), '{"ok":true}\n', 'utf8');

      // Symlinks: one escaping workspace, one disguised symlink to .env inside workspace
      const outsideCsv = path.join(outside, 'leak.csv');
      fs.writeFileSync(outsideCsv, 'secret\n1\n', 'utf8');
      fs.symlinkSync(outsideCsv, path.join(ws, 'data', 'escape-link.csv'));
      fs.symlinkSync(outside, path.join(ws, 'outside-dir-link'));
      fs.symlinkSync(path.join(ws, '.env'), path.join(ws, 'docs', 'innocent.txt'));

      const allRes = listStudioSources(ws);
      assert.equal(allRes.mode, 'live');
      assert.equal(allRes.counts.total, 6);
      assert.equal(allRes.counts.data, 2);
      assert.equal(allRes.counts.document, 2);
      assert.equal(allRes.counts.openapi, 2);
      assert.ok(allRes.skippedSensitive >= 4);
      assert.ok(allRes.skippedSymlinks >= 2);

      const relPaths = allRes.sources.map((s) => s.relPath);
      assert.deepEqual(relPaths, [
        'api/openapi.yaml',
        'api/service-spec.json',
        'data/events.ndjson',
        'data/sales.csv',
        'docs/diagram.svg',
        'docs/guide.md',
      ]);

      // Category filtering preserves total counts while slicing sources list
      const dataOnly = listStudioSources(ws, { category: 'data' });
      assert.equal(dataOnly.counts.total, 6);
      assert.deepEqual(
        dataOnly.sources.map((s) => s.relPath),
        ['data/events.ndjson', 'data/sales.csv'],
      );

      const openapiOnly = listStudioSources(ws, { category: 'openapi' });
      assert.deepEqual(
        openapiOnly.sources.map((s) => s.relPath),
        ['api/openapi.yaml', 'api/service-spec.json'],
      );

      // Direct path access checks
      assert.throws(() => resolveStudioWorkspaceFile(ws, '.env'), /sensitive|restricted/i);
      assert.throws(() => resolveStudioWorkspaceFile(ws, '.env.production'), /sensitive|restricted/i);
      assert.throws(() => resolveStudioWorkspaceFile(ws, 'secrets/tokens.json'), /sensitive|restricted/i);
      assert.throws(() => resolveStudioWorkspaceFile(ws, 'credentials/aws.csv'), /sensitive|restricted/i);
      assert.throws(() => resolveStudioWorkspaceFile(ws, 'tls.pem'), /sensitive|restricted/i);
      assert.throws(() => resolveStudioWorkspaceFile(ws, 'signing.key'), /sensitive|restricted/i);
      assert.throws(() => resolveStudioWorkspaceFile(ws, '.git/HEAD.txt'), /sensitive|restricted/i);
      assert.throws(() => resolveStudioWorkspaceFile(ws, 'node_modules/pkg/data.json'), /sensitive|restricted/i);
      assert.throws(() => resolveStudioWorkspaceFile(ws, 'data/escape-link.csv'), /escapes workspace/i);
      assert.throws(() => resolveStudioWorkspaceFile(ws, 'docs/innocent.txt'), /sensitive|restricted/i);

      // Oversized file (> 10 MiB) must be rejected before reading
      const hugePath = path.join(ws, 'data', 'too-big.csv');
      fs.writeFileSync(hugePath, Buffer.alloc(STUDIO_MAX_FILE_BYTES + 16, 0x61));
      assert.throws(() => resolveStudioWorkspaceFile(ws, 'data/too-big.csv'), /10 MiB/i);
    });
  });

  it('2. studio_inspect_data parses CSV/TSV/JSON/NDJSON with filter+limit and enforces strict read-only SQLite queries', async () => {
    await withTempDir('agy-nov-studio-data-', async (ws) => {
      // RFC-4180 CSV with quoted commas, escaped quotes, and embedded newline
      const csvText = [
        'id,name,notes',
        '1,"Alice, PhD","Said ""hello""\nmultiline"',
        '2,Bob,normal row',
        '3,Carol,alpha target',
        '4,Dave,alpha second',
      ].join('\r\n');
      fs.writeFileSync(path.join(ws, 'people.csv'), csvText, 'utf8');

      const csvRes = await inspectStudioData(ws, { filePath: 'people.csv', limit: 2 });
      assert.equal(csvRes.format, 'csv');
      assert.deepEqual(csvRes.columns, ['id', 'name', 'notes']);
      assert.equal(csvRes.totalRows, 4);
      assert.equal(csvRes.returnedRows, 2);
      assert.equal(csvRes.truncated, true);
      assert.equal(csvRes.rows[0].name, 'Alice, PhD');
      assert.equal(csvRes.rows[0].notes, 'Said "hello"\nmultiline');

      const csvFiltered = await inspectStudioData(ws, { filePath: 'people.csv', filter: 'ALPHA' });
      assert.equal(csvFiltered.totalRows, 2);
      assert.deepEqual(
        csvFiltered.rows.map((r) => r.name),
        ['Carol', 'Dave'],
      );

      // JSON array & NDJSON (with malformed line tolerance & secret redaction)
      fs.writeFileSync(
        path.join(ws, 'items.json'),
        JSON.stringify([
          { id: 1, label: 'alpha', apiKey: 'ghp_1234567890abcdefghijklmnopqrstuvwx' },
          { id: 2, label: 'beta', apiKey: 'clean' },
        ]),
        'utf8',
      );
      const jsonRes = await inspectStudioData(ws, { filePath: 'items.json', filter: 'alpha' });
      assert.equal(jsonRes.format, 'json');
      assert.equal(jsonRes.jsonSummary?.rootType, 'array');
      assert.equal(jsonRes.totalRows, 1);
      assert.equal(jsonRes.rows[0].apiKey, '[REDACTED:GITHUB_TOKEN]');

      fs.writeFileSync(
        path.join(ws, 'stream.ndjson'),
        '{"step":1,"status":"ok"}\nnot-valid-json\n{"step":2,"status":"warn"}\n{"step":3,"status":"ok"}\n',
        'utf8',
      );
      const ndjsonRes = await inspectStudioData(ws, {
        filePath: 'stream.ndjson',
        filter: 'ok',
        limit: 1,
      });
      assert.equal(ndjsonRes.format, 'ndjson');
      assert.equal(ndjsonRes.jsonSummary?.itemCount, 3);
      assert.equal(ndjsonRes.jsonSummary?.parseErrors, 1);
      assert.equal(ndjsonRes.totalRows, 2);
      assert.equal(ndjsonRes.returnedRows, 1);
      assert.equal(ndjsonRes.truncated, true);

      // Strict read-only SQLite validator red-team matrix
      const forbiddenQueries = [
        'DROP TABLE users',
        'DELETE FROM users WHERE id = 1',
        'UPDATE users SET name = "pwn"',
        'INSERT INTO users VALUES (9, "x")',
        'ALTER TABLE users ADD COLUMN x TEXT',
        'CREATE TABLE evil (id INT)',
        'REPLACE INTO users VALUES (1, "x")',
        'VACUUM',
        "ATTACH DATABASE '/tmp/other.db' AS other",
        'DETACH DATABASE other',
        'REINDEX',
        'BEGIN TRANSACTION',
        'COMMIT',
        'ROLLBACK',
        'SAVEPOINT sp1',
        'SELECT * FROM users; DROP TABLE users;',
        'SELECT * FROM users;;',
        'SELECT * FROM users -- trailing comment',
        'SELECT /* block comment */ * FROM users',
        "SELECT load_extension('/tmp/evil.so')",
        "SELECT readfile('/etc/passwd')",
        "SELECT writefile('/tmp/pwn', 'abc')",
        'PRAGMA journal_mode = WAL',
        'PRAGMA table_info(users) UNION SELECT 1',
        'SELECT 1\n.shell id',
      ];
      for (const badSql of forbiddenQueries) {
        assert.throws(() => validateReadOnlySqliteQuery(badSql), `Expected rejection for: ${badSql}`);
      }

      // Allowed single read-only queries (including identifiers like created_at / updated_at)
      assert.equal(
        validateReadOnlySqliteQuery('  SELECT id, created_at, updated_at FROM events ORDER BY id;  '),
        'SELECT id, created_at, updated_at FROM events ORDER BY id',
      );
      assert.equal(
        validateReadOnlySqliteQuery('EXPLAIN QUERY PLAN SELECT * FROM events'),
        'EXPLAIN QUERY PLAN SELECT * FROM events',
      );
      assert.equal(
        validateReadOnlySqliteQuery('PRAGMA table_info("events");'),
        'PRAGMA table_info("events")',
      );

      // Real SQLite database test (when sqlite3 CLI is available on host)
      const dbPath = path.join(ws, 'sample.sqlite');
      if (hasSqliteCli()) {
        execFileSync(
          'sqlite3',
          [
            dbPath,
            'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL);' +
              "INSERT INTO users (name, role) VALUES ('Alice','admin'),('Bob','dev'),('Carol','dev'),('Dave','ops'),('Eve','dev');",
          ],
          { stdio: 'pipe' },
        );

        // Schema overview when no query is supplied
        const schemaRes = await inspectStudioData(ws, { filePath: 'sample.sqlite' });
        assert.equal(schemaRes.format, 'sqlite');
        assert.equal(schemaRes.sqlite?.sqliteCliAvailable, true);
        assert.equal(schemaRes.sqlite?.tables.length, 1);
        assert.equal(schemaRes.sqlite?.tables[0].name, 'users');
        assert.deepEqual(
          schemaRes.sqlite?.tables[0].columns.map((c) => c.name),
          ['id', 'name', 'role'],
        );

        // Real read-only SELECT with limit & truncation
        const queryRes = await inspectStudioData(ws, {
          filePath: 'sample.sqlite',
          query: 'SELECT id, name, role FROM users ORDER BY id;',
          limit: 2,
        });
        assert.equal(queryRes.returnedRows, 2);
        assert.equal(queryRes.truncated, true);
        assert.deepEqual(
          queryRes.rows.map((r) => r.name),
          ['Alice', 'Bob'],
        );

        // Real EXPLAIN QUERY PLAN & PRAGMA table_info
        const explainRes = await inspectStudioData(ws, {
          filePath: 'sample.sqlite',
          query: 'EXPLAIN QUERY PLAN SELECT * FROM users WHERE id = 1',
        });
        assert.ok(explainRes.returnedRows >= 1);

        const pragmaRes = await inspectStudioData(ws, {
          filePath: 'sample.sqlite',
          query: 'PRAGMA table_info("users")',
        });
        assert.equal(pragmaRes.returnedRows, 3);

        // Empty result set must not throw JSON parse error
        const emptyRes = await inspectStudioData(ws, {
          filePath: 'sample.sqlite',
          query: 'SELECT * FROM users WHERE id = 9999',
        });
        assert.equal(emptyRes.returnedRows, 0);
        assert.deepEqual(emptyRes.rows, []);

        // Write attempt must be rejected and leave table untouched
        await assert.rejects(
          () => inspectStudioData(ws, { filePath: 'sample.sqlite', query: 'DELETE FROM users' }),
          /must start with SELECT|blocked/i,
        );
        const verifyCount = await inspectStudioData(ws, {
          filePath: 'sample.sqlite',
          query: 'SELECT COUNT(*) AS cnt FROM users',
        });
        assert.equal(verifyCount.rows[0].cnt, 5);
      } else {
        // Synthesize minimal valid 100-byte SQLite 3 header for fallback test even without sqlite3 CLI
        const header = Buffer.alloc(100);
        header.write('SQLite format 3\0', 0, 'ascii');
        header.writeUInt16BE(4096, 16);
        fs.writeFileSync(dbPath, header);
      }

      // Graceful fallback when sqlite3 CLI is unavailable
      const fallbackRes = await inspectStudioData(ws, {
        filePath: 'sample.sqlite',
        sqliteBin: '__nonexistent_sqlite3_binary_for_test__',
      });
      assert.equal(fallbackRes.format, 'sqlite');
      assert.equal(fallbackRes.sqlite?.sqliteCliAvailable, false);
      assert.equal(fallbackRes.sqlite?.headerFormat, 'SQLite format 3');
      assert.ok((fallbackRes.sqlite?.pageSize ?? 0) > 0);
      assert.match(fallbackRes.sqlite?.note ?? '', /sqlite3/i);
    });
  });

  it('3. studio_inspect_document parses real pure-Node DOCX, XLSX, PDF (FlateDecode), and Markdown while blocking ZIP bombs and escaping symlinks', async () => {
    await withTempDir('agy-nov-studio-doc-', (tmpRoot) => {
      const ws = path.join(tmpRoot, 'ws');
      const outside = path.join(tmpRoot, 'outside');
      fs.mkdirSync(ws, { recursive: true });
      fs.mkdirSync(outside, { recursive: true });

      // 3a. Markdown with headings, fenced code comment, and bounded slicing
      const mdLines = [
        '# Architecture Overview',
        'Intro paragraph.',
        '```bash',
        '# Not a heading inside fence',
        '```',
        '## Security Rules',
        'Line 7 details.',
        'Line 8 details.',
        'Line 9 details.',
      ];
      fs.writeFileSync(path.join(ws, 'notes.md'), mdLines.join('\n'), 'utf8');
      const mdRes = inspectStudioDocument(ws, { filePath: 'notes.md', startLine: 2, maxLines: 4 });
      assert.equal(mdRes.format, 'markdown');
      assert.equal(mdRes.totalLines, 9);
      assert.equal(mdRes.startLine, 2);
      assert.equal(mdRes.endLine, 5);
      assert.equal(mdRes.truncated, true);
      assert.deepEqual(
        mdRes.outline.map((o) => o.title),
        ['Architecture Overview', 'Security Rules'],
      );

      // 3b. Pure-Node minimal real DOCX ZIP
      const docxBuf = buildZipBuffer([
        {
          name: 'docProps/core.xml',
          content:
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
            '<dc:title>Studio Design Doc</dc:title><dc:creator>Builder QA</dc:creator></cp:coreProperties>',
        },
        {
          name: 'word/document.xml',
          content:
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
            '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Executive Summary</w:t></w:r></w:p>' +
            '<w:p><w:r><w:t>Pure Node parser handles &amp; entities &lt;safely&gt;.</w:t></w:r></w:p>' +
            '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Milestones</w:t></w:r></w:p>' +
            '<w:p><w:r><w:t>Phase 1</w:t><w:br/><w:t>Phase 2</w:t></w:r></w:p>' +
            '</w:body></w:document>',
        },
      ]);
      fs.writeFileSync(path.join(ws, 'design.docx'), docxBuf);

      const docxRes = inspectStudioDocument(ws, { filePath: 'design.docx' });
      assert.equal(docxRes.format, 'docx');
      assert.equal(docxRes.metadata.title, 'Studio Design Doc');
      assert.equal(docxRes.metadata.author, 'Builder QA');
      assert.deepEqual(
        docxRes.outline.map((o) => ({ level: o.level, title: o.title })),
        [
          { level: 1, title: 'Executive Summary' },
          { level: 2, title: 'Milestones' },
        ],
      );
      assert.match(docxRes.content, /Pure Node parser handles & entities <safely>\./);
      assert.match(docxRes.content, /Phase 1\nPhase 2/);

      // 3c. Pure-Node minimal real XLSX ZIP
      const xlsxBuf = buildZipBuffer([
        {
          name: 'xl/workbook.xml',
          content:
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
            '<sheets><sheet name="Q4 Budget" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>',
        },
        {
          name: 'xl/_rels/workbook.xml.rels',
          content:
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
            '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>' +
            '</Relationships>',
        },
        {
          name: 'xl/sharedStrings.xml',
          content:
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<sst><si><t>Team</t></si><si><t>Spend</t></si><si><t>Approved</t></si><si><t>Platform</t></si></sst>',
        },
        {
          name: 'xl/worksheets/sheet1.xml',
          content:
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<worksheet><sheetData>' +
            '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
            '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>42500</v></c><c r="C2" t="b"><v>1</v></c></row>' +
            '<row r="3"><c r="A3" t="inlineStr"><is><t>Security &amp; Audit</t></is></c><c r="B3"><v>18000</v></c><c r="C3" t="b"><v>0</v></c></row>' +
            '</sheetData></worksheet>',
        },
        {
          name: 'xl/worksheets/sheet2.xml',
          content: '<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData/></worksheet>',
        },
      ]);
      fs.writeFileSync(path.join(ws, 'budget.xlsx'), xlsxBuf);

      const xlsxRes = inspectStudioDocument(ws, { filePath: 'budget.xlsx' });
      assert.equal(xlsxRes.format, 'xlsx');
      assert.deepEqual(xlsxRes.metadata.sheetNames, ['Q4 Budget', 'Notes']);
      assert.equal(xlsxRes.sheets?.[0].name, 'Q4 Budget');
      assert.deepEqual(xlsxRes.sheets?.[0].rows, [
        ['Team', 'Spend', 'Approved'],
        ['Platform', '42500', 'TRUE'],
        ['Security & Audit', '18000', 'FALSE'],
      ]);
      assert.match(xlsxRes.content, /Platform\t42500\tTRUE/);
      assert.match(xlsxRes.content, /Security & Audit\t18000\tFALSE/);

      // 3d. Pure-Node PDF with FlateDecode stream, page count, Info metadata, and secret redaction
      fs.writeFileSync(path.join(ws, 'spec.pdf'), buildMinimalPdfBuffer());
      const pdfRes = inspectStudioDocument(ws, { filePath: 'spec.pdf' });
      assert.equal(pdfRes.format, 'pdf');
      assert.equal(pdfRes.metadata.pdfVersion, '1.7');
      assert.equal(pdfRes.metadata.estimatedPages, 2);
      assert.deepEqual(pdfRes.metadata.info, {
        title: 'Studio Offline Spec',
        author: 'agy-NOV QA',
      });
      assert.match(pdfRes.content, /1\.1 Studio PDF Verification/);
      assert.match(pdfRes.content, /\[REDACTED:API_SECRET\]/);
      assert.doesNotMatch(pdfRes.content, /sk-proj-abcdefghijklmnopqrstuvwxyz123456/);

      // 3e. ZIP bomb protection:
      // (i) Forged small header size, real decompressed payload = 5 MiB > 4 MiB per-entry cap
      const bombPayload = Buffer.alloc(5 * 1024 * 1024, 0x41);
      const zipBombDocx = buildZipBuffer([
        {
          name: 'word/document.xml',
          content: bombPayload,
          compress: true,
          forgedUncompressedSize: 128,
        },
      ]);
      assert.ok(zipBombDocx.length < 100 * 1024, 'ZIP bomb fixture should be tiny on disk');
      fs.writeFileSync(path.join(ws, 'bomb.docx'), zipBombDocx);
      assert.throws(
        () => inspectStudioDocument(ws, { filePath: 'bomb.docx' }),
        /ZIP bomb|exceeded security cap|4 MiB/i,
      );

      // (ii) Too many ZIP entries (> 512 limit)
      const tooManyEntriesZip = buildZipBuffer(
        Array.from({ length: 513 }, (_, idx) => ({
          name: `item_${idx}.txt`,
          content: 'x',
          compress: false,
        })),
      );
      fs.writeFileSync(path.join(ws, 'too-many.docx'), tooManyEntriesZip);
      assert.throws(
        () => inspectStudioDocument(ws, { filePath: 'too-many.docx' }),
        /entry count 513 exceeds limit/i,
      );

      // (iii) Total inflated bytes exceeding 6 MiB across two <= 4 MiB entries
      const totalCapXlsx = buildZipBuffer([
        {
          name: 'xl/sharedStrings.xml',
          content: `<sst><si><t>${'A'.repeat(3.5 * 1024 * 1024)}</t></si></sst>`,
          compress: true,
        },
        {
          name: 'xl/worksheets/sheet1.xml',
          content: `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${'B'.repeat(3.5 * 1024 * 1024)}</t></is></c></row></sheetData></worksheet>`,
          compress: true,
        },
      ]);
      fs.writeFileSync(path.join(ws, 'total-cap.xlsx'), totalCapXlsx);
      assert.throws(
        () => inspectStudioDocument(ws, { filePath: 'total-cap.xlsx' }),
        /ZIP bomb|exceeded security cap|total inflated/i,
      );

      // 3f. Symlink escaping workspace MUST be blocked
      const outsideDoc = path.join(outside, 'secret-plan.md');
      fs.writeFileSync(outsideDoc, '# Outside Secret\n', 'utf8');
      fs.symlinkSync(outsideDoc, path.join(ws, 'escape-doc.md'));
      assert.throws(
        () => inspectStudioDocument(ws, { filePath: 'escape-doc.md' }),
        /escapes workspace/i,
      );
    });
  });

  it('4. studio_http_probe executes real 127.0.0.1 GET/POST with header+body redaction, 64KB cap, manual redirects, and 100% SSRF rejection', async () => {
    let lastPostBody = '';
    let receivedAuthHeader = '';

    const server = http.createServer((req, res) => {
      const urlPath = req.url ?? '/';
      if (urlPath === '/api/health' && req.method === 'GET') {
        receivedAuthHeader = String(req.headers.authorization ?? '');
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 'session_id=top-secret-cookie; HttpOnly',
          'x-api-key': 'resp-api-secret-value',
          'x-studio-echo': 'ok',
        });
        res.end(
          JSON.stringify({
            ok: true,
            leakedToken: 'ghp_1234567890abcdefghijklmnopqrstuvwx',
            api_key: 'super-secret-inline-key',
          }),
        );
        return;
      }

      if (urlPath === '/api/echo' && req.method === 'POST') {
        const parts: Buffer[] = [];
        req.on('data', (chunk: Buffer) => parts.push(chunk));
        req.on('end', () => {
          lastPostBody = Buffer.concat(parts).toString('utf8');
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ echoed: lastPostBody, trace: req.headers['x-trace-id'] ?? '' }));
        });
        return;
      }

      if (urlPath === '/api/large') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('X'.repeat(120 * 1024));
        return;
      }

      if (urlPath === '/api/redirect') {
        res.writeHead(302, { location: 'https://example.com/ssrf-target' });
        res.end('redirecting');
        return;
      }

      res.writeHead(404);
      res.end('not found');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // GET with sensitive request & response headers + secret in response body
      const getRes = await runLoopbackHttpProbe({
        url: `${baseUrl}/api/health`,
        method: 'GET',
        headers: {
          Authorization: 'Bearer secret-jwt-token-value',
          Cookie: 'sid=private-cookie',
          'X-Api-Key': 'client-secret-key',
          'X-Auth-Token': 'client-auth-token',
          'X-Trace-Id': 'trace-123',
        },
      });
      assert.equal(getRes.status, 200);
      assert.equal(getRes.ok, true);
      assert.equal(getRes.truncated, false);
      assert.equal(receivedAuthHeader, 'Bearer secret-jwt-token-value');
      assert.equal(getRes.requestHeaders.Authorization, '[REDACTED]');
      assert.equal(getRes.requestHeaders.Cookie, '[REDACTED]');
      assert.equal(getRes.requestHeaders['X-Api-Key'], '[REDACTED]');
      assert.equal(getRes.requestHeaders['X-Auth-Token'], '[REDACTED]');
      assert.equal(getRes.requestHeaders['X-Trace-Id'], 'trace-123');
      assert.equal(getRes.responseHeaders['set-cookie'], '[REDACTED]');
      assert.equal(getRes.responseHeaders['x-api-key'], '[REDACTED]');
      assert.equal(getRes.responseHeaders['x-studio-echo'], 'ok');
      assert.doesNotMatch(getRes.bodyText, /ghp_1234567890abcdefghijklmnopqrstuvwx/);
      assert.doesNotMatch(getRes.bodyText, /super-secret-inline-key/);
      assert.match(getRes.bodyText, /\[REDACTED/);

      // POST with JSON body
      const postRes = await runLoopbackHttpProbe({
        url: `${baseUrl}/api/echo`,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-trace-id': 'post-42' },
        body: JSON.stringify({ ping: 'pong' }),
      });
      assert.equal(postRes.status, 201);
      assert.equal(lastPostBody, JSON.stringify({ ping: 'pong' }));
      assert.match(postRes.bodyText, /post-42/);

      // 64 KiB response body truncation
      const largeRes = await runLoopbackHttpProbe({ url: `${baseUrl}/api/large` });
      assert.equal(largeRes.status, 200);
      assert.equal(largeRes.truncated, true);
      assert.equal(largeRes.bodyBytes, STUDIO_HTTP_MAX_BODY_BYTES);
      assert.equal(largeRes.bodyText.length, STUDIO_HTTP_MAX_BODY_BYTES);

      // redirect: 'manual' must NOT follow redirect to external host
      const redirRes = await runLoopbackHttpProbe({ url: `${baseUrl}/api/redirect` });
      assert.equal(redirRes.status, 302);
      assert.equal(redirRes.redirected, true);
      assert.equal(redirRes.location, 'https://example.com/ssrf-target');

      // Valid loopback URLs allowed by validator
      assert.equal(validateLoopbackProbeUrl('http://127.0.0.1:4399/api/health').hostname, '127.0.0.1');
      assert.equal(validateLoopbackProbeUrl('http://localhost:3000/ping').hostname, 'localhost');
      assert.equal(validateLoopbackProbeUrl('http://[::1]:3000/ping').hostname, '[::1]');

      // SSRF rejection matrix (100% blocked)
      const blockedUrls = [
        'https://example.com',
        'http://169.254.169.254/',
        'http://169.254.169.254/latest/meta-data/',
        'http://10.0.0.1/',
        'http://192.168.1.10/api',
        'http://0.0.0.0:8080/',
        'http://user@127.0.0.1/',
        'http://user:pass@localhost:3000/',
        'http://@127.0.0.1/',
        'http://127.0.0.1.nip.io/',
        'http://127.0.0.2/',
        'http://[::ffff:169.254.169.254]/',
        'file:///etc/passwd',
      ];
      for (const badUrl of blockedUrls) {
        assert.throws(() => validateLoopbackProbeUrl(badUrl), `Expected SSRF block for: ${badUrl}`);
        await assert.rejects(() => runLoopbackHttpProbe({ url: badUrl }), `Expected probe reject for: ${badUrl}`);
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('5. demoMode performs zero disk writes / zero network calls and aligns 4 model + 4 app-only tools with MODULE_CATALOG', async () => {
    await withTempDir('agy-nov-studio-demo-', async (tmpDir) => {
      const absentDataDir = path.join(tmpDir, 'never-created-data');
      const absentWorkspace = path.join(tmpDir, 'nonexistent-workspace');

      const server = new McpServer(
        { name: 'studio-demo-test', version: '0.4.0' },
        { capabilities: { tools: { listChanged: true } } },
      );

      const reg = registerStudioModule(
        server,
        {
          dataDir: absentDataDir,
          workspaceRoot: absentWorkspace,
          demoMode: true,
        },
        'ui://agy-nov/app.html',
      );

      // Verify registration contract alignment
      assert.equal(reg.moduleId, 'studio');
      assert.deepEqual(
        reg.modelTools.map((t) => t.name),
        MODULE_CATALOG.studio.modelToolNames,
      );
      assert.deepEqual(reg.exemptReadOnlyAppTools, ['app_studio_list_sources', 'app_nov_file_viewer']);
      assert.equal(fs.existsSync(absentDataDir), false);

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'studio-demo-client', version: '0.5.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        const listedTools = await client.listTools();
        const toolNames = listedTools.tools.map((t) => t.name).sort();
        assert.deepEqual(toolNames, [
          'app_nov_file_viewer',
          'app_studio_http_probe',
          'app_studio_inspect_data',
          'app_studio_inspect_document',
          'app_studio_list_sources',
          'app_studio_parse_openapi',
          'studio_http_probe',
          'studio_inspect_data',
          'studio_inspect_document',
          'studio_list_sources',
        ]);

        // Verify _meta.ui.visibility on app-only tools
        for (const appName of [
          'app_studio_list_sources',
          'app_studio_inspect_data',
          'app_studio_inspect_document',
          'app_studio_http_probe',
          'app_studio_parse_openapi',
        ]) {
          const toolDef = listedTools.tools.find((t) => t.name === appName);
          assert.deepEqual(
            (toolDef?._meta as { ui?: { resourceUri?: string; visibility?: string[] } } | undefined)?.ui,
            { resourceUri: 'ui://agy-nov/app.html', visibility: ['app'] },
          );
        }

        // 1. Sources in demo mode
        const srcCall = await client.callTool({ name: 'app_studio_list_sources', arguments: {} });
        assert.equal(srcCall.isError, undefined);
        const srcData = srcCall.structuredContent as unknown as StudioSourcesResult;
        assert.equal(srcData.mode, 'demo');
        assert.deepEqual(srcData.counts, { total: 6, data: 2, document: 3, openapi: 1 });
        assert.deepEqual(
          srcData.sources.map((s) => s.name),
          ['analytics.sqlite', 'metrics.csv', 'architecture.docx', 'q4-budget.xlsx', 'spec.pdf', 'openapi.yaml'],
        );

        // 2. Data viewers in demo mode + SQLite write guard active even in demo mode
        const sqliteCall = await client.callTool({
          name: 'studio_inspect_data',
          arguments: { filePath: 'data/analytics.sqlite', query: 'SELECT * FROM events' },
        });
        assert.equal(sqliteCall.isError, undefined);
        const sqliteData = sqliteCall.structuredContent as unknown as StudioDataResult;
        assert.equal(sqliteData.mode, 'demo');
        assert.ok(sqliteData.returnedRows > 0);

        const csvCall = await client.callTool({
          name: 'app_studio_inspect_data',
          arguments: { filePath: 'metrics.csv', filter: 'studio' },
        });
        assert.equal(csvCall.isError, undefined);
        const csvData = csvCall.structuredContent as unknown as StudioDataResult;
        assert.equal(csvData.returnedRows, 1);

        const badSqlCall = await client.callTool({
          name: 'studio_inspect_data',
          arguments: { filePath: 'data/analytics.sqlite', query: 'DROP TABLE events' },
        });
        assert.equal(badSqlCall.isError, true);

        // 3. Document slicers in demo mode
        for (const docPath of [
          'docs/architecture.docx',
          'docs/q4-budget.xlsx',
          'docs/spec.pdf',
          'api/openapi.yaml',
        ]) {
          const docCall = await client.callTool({
            name: 'studio_inspect_document',
            arguments: { filePath: docPath, startLine: 1, maxLines: 10 },
          });
          assert.equal(docCall.isError, undefined);
          const docData = docCall.structuredContent as unknown as StudioDocumentResult;
          assert.equal(docData.mode, 'demo');
          assert.ok(docData.lines.length > 0);
        }

        // 4. Synthetic loopback probe (no network) + SSRF block active even in demo mode
        const probeCall = await client.callTool({
          name: 'app_studio_http_probe',
          arguments: {
            url: 'http://127.0.0.1:4399/api/health',
            headers: { Authorization: 'Bearer demo-secret' },
          },
        });
        assert.equal(probeCall.isError, undefined);
        const probeData = probeCall.structuredContent as unknown as StudioHttpProbeResult;
        assert.equal(probeData.mode, 'demo');
        assert.equal(probeData.status, 200);
        assert.equal(probeData.requestHeaders.Authorization, '[REDACTED]');
        assert.match(probeData.bodyText, /agy-nov-demo-loopback/);

        const ssrfDemoCall = await client.callTool({
          name: 'studio_http_probe',
          arguments: { url: 'https://example.com' },
        });
        assert.equal(ssrfDemoCall.isError, true);

        // Strictly zero disk creation throughout demo lifecycle
        assert.equal(fs.existsSync(absentDataDir), false);
        assert.equal(fs.existsSync(absentWorkspace), false);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });

  it('6. Red-team regression: blocks quoted SQLite RCE/file-I/O & vtables, companion symlinks, obfuscated loopback URLs, and redacts auth headers/302 Location/JSON secrets', async () => {
    // 6a. SQLite quoted function RCE, file I/O, virtual tables, pragma_* TVFs, and companion symlinks
    await withTempDir('agy-nov-studio-redteam-sql-', async (tmpRoot) => {
      const ws = path.join(tmpRoot, 'ws');
      const outside = path.join(tmpRoot, 'outside');
      fs.mkdirSync(ws, { recursive: true });
      fs.mkdirSync(outside, { recursive: true });

      const dbPath = path.join(ws, 'target.sqlite');
      const sentinelWriteFile = path.join(outside, 'sqlite-rce-pwned.txt');
      const outsideSecret = path.join(outside, 'outside-wal-secret.txt');
      fs.writeFileSync(outsideSecret, 'OUTSIDE_WAL_SECRET_PAYLOAD\n', 'utf8');

      if (hasSqliteCli()) {
        execFileSync(
          'sqlite3',
          [
            dbPath,
            'CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT NOT NULL);' +
              "INSERT INTO items (label) VALUES ('alpha'),('beta');",
          ],
          { stdio: 'pipe' },
        );
      } else {
        const header = Buffer.alloc(100);
        header.write('SQLite format 3\0', 0, 'ascii');
        header.writeUInt16BE(4096, 16);
        fs.writeFileSync(dbPath, header);
      }

      const redTeamSqlVectors = [
        `SELECT "edit"('a','sh -c id')`,
        `SELECT"edit"('a','sh -c id')`,
        `SELECT "writefile"('/tmp/x','y')`,
        `SELECT "writefile"('${sentinelWriteFile}','pwned')`,
        `SELECT "readfile"('/etc/hosts')`,
        `SELECT [readfile]('/etc/hosts')`,
        'SELECT `readfile`(\'/etc/hosts\')',
        `SELECT "x'y" AS a, "edit"('a','sh -c id') AS b`,
        `SELECT * FROM fsdir('/tmp')`,
        `SELECT * FROM "fsdir"('/tmp')`,
        `SELECT * FROM zipfile('/tmp/a.zip')`,
        `SELECT * FROM zipfile_cds('/tmp/a.zip')`,
        `SELECT * FROM pragma_database_list`,
        `SELECT * FROM "pragma_database_list"`,
        `SELECT * FROM pragma_compile_options`,
        `SELECT * FROM pragma_table_info('items')`,
        `SELECT * FROM sqlite_dbpage`,
        `SELECT * FROM main.[sqlite_dbpage]`,
        `SELECT * FROM sqlite_dbptr`,
        `SELECT * FROM sqlite_dbdata`,
        `SELECT * FROM sqlite_stmt`,
        `SELECT * FROM dbstat`,
        `SELECT * FROM completion('sel')`,
        `SELECT * FROM bytecode('SELECT 1')`,
        `SELECT * FROM tables_used('SELECT 1')`,
        `SELECT * FROM generate_series(1, 10)`,
        `SELECT shell_putsnl('x')`,
        `SELECT shell_temp_filename()`,
        `SELECT shell_add_schema('a','b')`,
        `SELECT shell_format_schema('a')`,
        `SELECT shell_module_schema('a')`,
        `SELECT shell_prompt_test('a')`,
        `SELECT sqlar_compress('a')`,
        `SELECT sqlar_uncompress(x'00', 1)`,
        `SELECT fts3_tokenizer('simple')`,
        `SELECT sha1_query('SELECT 1')`,
        `SELECT sha3_query('SELECT 1')`,
        `SELECT realpath('/etc/hosts')`,
        `PRAGMA table_info('items')`,
        `SELECT * FROM items WHERE label = 'unterminated`,
        `SELECT "unterminated FROM items`,
      ];

      for (const payload of redTeamSqlVectors) {
        assert.throws(
          () => validateReadOnlySqliteQuery(payload),
          `Expected validateReadOnlySqliteQuery to block: ${payload}`,
        );
        await assert.rejects(
          () => inspectStudioData(ws, { filePath: 'target.sqlite', query: payload }),
          `Expected live inspectStudioData to block: ${payload}`,
        );
      }

      // Sentinel host file must NEVER be created
      assert.equal(fs.existsSync(sentinelWriteFile), false);

      // Legitimate single-quoted escape & unquoted/double-quoted PRAGMA table_info remain allowed
      assert.equal(
        validateReadOnlySqliteQuery(`SELECT 'it''s fine' AS note, label FROM items WHERE label = 'alpha'`),
        `SELECT 'it''s fine' AS note, label FROM items WHERE label = 'alpha'`,
      );
      assert.equal(validateReadOnlySqliteQuery('PRAGMA table_info(items)'), 'PRAGMA table_info(items)');
      assert.equal(validateReadOnlySqliteQuery('PRAGMA table_info("items")'), 'PRAGMA table_info("items")');

      // Companion file symlink checks (-wal, -shm, -journal pointing outside workspace)
      for (const suffix of ['-wal', '-shm', '-journal'] as const) {
        const companionLink = `${dbPath}${suffix}`;
        fs.symlinkSync(outsideSecret, companionLink);
        try {
          await assert.rejects(
            () => inspectStudioData(ws, { filePath: 'target.sqlite' }),
            /companion file|symbolic link|escapes workspace/i,
            `Expected rejection when ${suffix} companion symlink exists`,
          );
          await assert.rejects(
            () => inspectStudioData(ws, { filePath: 'target.sqlite', query: 'SELECT * FROM items' }),
            /companion file|symbolic link|escapes workspace/i,
            `Expected query rejection when ${suffix} companion symlink exists`,
          );
        } finally {
          fs.unlinkSync(companionLink);
        }
      }

      // After removing symlinks, legitimate query succeeds again
      if (hasSqliteCli()) {
        const okRes = await inspectStudioData(ws, {
          filePath: 'target.sqlite',
          query: `SELECT 'it''s fine' AS note, label FROM items ORDER BY id`,
        });
        assert.equal(okRes.returnedRows, 2);
        assert.equal(okRes.rows[0].note, "it's fine");
        assert.equal(okRes.rows[0].label, 'alpha');
      }

      // Verify -safe flag is passed first and gracefully falls back on legacy sqlite3 "unknown option: -safe"
      const argsLogPath = path.join(outside, 'sqlite-args.log');
      const legacyStubPath = path.join(outside, 'legacy-sqlite3.sh');
      fs.writeFileSync(
        legacyStubPath,
        [
          '#!/bin/sh',
          `printf '%s\\n' "$*" >> "${argsLogPath}"`,
          'if [ "$1" = "-safe" ]; then',
          '  echo "sqlite3: Error: unknown option: -safe" >&2',
          '  exit 1',
          'fi',
          'printf \'[{"ok":1}]\\n\'',
        ].join('\n') + '\n',
        { mode: 0o755 },
      );
      const fallbackSafeRes = await inspectStudioData(ws, {
        filePath: 'target.sqlite',
        query: 'SELECT 1 AS ok',
        sqliteBin: legacyStubPath,
      });
      assert.equal(fallbackSafeRes.rows[0]?.ok, 1);
      const loggedCalls = fs.readFileSync(argsLogPath, 'utf8').trim().split('\n');
      assert.ok(loggedCalls.some((line) => line.startsWith('-safe -readonly ')));
      assert.ok(loggedCalls.some((line) => line.startsWith('-readonly ')));
    });

    // 6b. Obfuscated IP / multi-slash / backslash / #@ confusion URL rejection
    const obfuscatedUrls = [
      'http://0177.0.0.1/',
      'http://2130706433/',
      'http://0x7f000001/',
      'http://127.1/',
      'http:///@127.0.0.1/',
      'http:////127.0.0.1/',
      'http:127.0.0.1/',
      'http:\\127.0.0.1/',
      'http:\\\\127.0.0.1/',
      'http://127.0.0.1#@example.com/',
      'http://127.0.0.1:8080#@example.com/',
      'http://127.0.0.1:0/',
      'http://127.0.0.1:080/',
      'http://127.0.0.1:65536/',
      'http://127.0.0.1\\foo',
      'http://127.0.0.1@example.com/',
      'http://localhost.evil.com/',
      'http://[::ffff:127.0.0.1]/',
      'http:// 127.0.0.1/',
    ];

    for (const badUrl of obfuscatedUrls) {
      assert.throws(
        () => validateLoopbackProbeUrl(badUrl),
        `Expected validateLoopbackProbeUrl to block: ${badUrl}`,
      );
      await assert.rejects(
        () => runLoopbackHttpProbe({ url: badUrl }),
        `Expected runLoopbackHttpProbe to reject: ${badUrl}`,
      );
    }

    // Valid canonical loopback URLs with path '@' and query email remain accepted
    assert.equal(
      validateLoopbackProbeUrl('http://127.0.0.1:8080/users/@me?email=a@b.com').hostname,
      '127.0.0.1',
    );
    assert.equal(validateLoopbackProbeUrl('https://localhost/health').hostname, 'localhost');
    assert.equal(validateLoopbackProbeUrl('http://[::1]:4399/status').hostname, '[::1]');

    // 6c. Live HTTP probe redaction: X-Custom-Auth, WWW-Authenticate, 302 Location query secrets, JSON cookie/session/authorization
    const server = http.createServer((req, res) => {
      const urlPath = req.url ?? '/';
      if (urlPath === '/api/auth-headers') {
        res.writeHead(401, {
          'content-type': 'application/json',
          'x-custom-auth': 'custom-secret-header-value',
          'www-authenticate': 'Bearer realm="studio", error="invalid_token"',
          'proxy-authenticate': 'Basic realm="internal"',
          'x-session-id': 'sess_live_header_secret',
          'x-user-jwt': 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
          'x-safe-header': 'visible-ok',
        });
        res.end(
          JSON.stringify({
            ok: false,
            cookie: 'sid=super-secret-json-cookie; HttpOnly',
            authorization: 'Bearer inline-json-bearer-secret',
            session: 'sess_inline_json_secret_1234',
            message: 'unauthorized',
          }),
        );
        return;
      }

      if (urlPath === '/api/redirect-secret') {
        res.writeHead(302, {
          location:
            'https://example.com/oauth/callback?token=tok_live_secret_abc&api_key=ak_live_secret_xyz&sig=deadbeef999&next=/dashboard#done',
        });
        res.end('redirecting');
        return;
      }

      res.writeHead(404);
      res.end('not found');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const authRes = await runLoopbackHttpProbe({ url: `${baseUrl}/api/auth-headers` });
      assert.equal(authRes.status, 401);
      assert.equal(authRes.responseHeaders['x-custom-auth'], '[REDACTED]');
      assert.equal(authRes.responseHeaders['www-authenticate'], '[REDACTED]');
      assert.equal(authRes.responseHeaders['proxy-authenticate'], '[REDACTED]');
      assert.equal(authRes.responseHeaders['x-session-id'], '[REDACTED]');
      assert.equal(authRes.responseHeaders['x-user-jwt'], '[REDACTED]');
      assert.equal(authRes.responseHeaders['x-safe-header'], 'visible-ok');

      // JSON body secrets (cookie, authorization, session) must be 100% redacted
      assert.doesNotMatch(authRes.bodyText, /super-secret-json-cookie/);
      assert.doesNotMatch(authRes.bodyText, /inline-json-bearer-secret/);
      assert.doesNotMatch(authRes.bodyText, /sess_inline_json_secret_1234/);
      const parsedBody = JSON.parse(authRes.bodyText) as Record<string, unknown>;
      assert.equal(parsedBody.cookie, '[REDACTED]');
      assert.equal(parsedBody.authorization, '[REDACTED]');
      assert.equal(parsedBody.session, '[REDACTED]');
      assert.equal(parsedBody.message, 'unauthorized');

      // 302 Location query secrets must be 100% redacted while preserving non-secret params and fragment
      const redirRes = await runLoopbackHttpProbe({ url: `${baseUrl}/api/redirect-secret` });
      assert.equal(redirRes.status, 302);
      assert.equal(redirRes.redirected, true);
      const expectedLocation =
        'https://example.com/oauth/callback?token=[REDACTED]&api_key=[REDACTED]&sig=[REDACTED]&next=/dashboard#done';
      assert.equal(redirRes.location, expectedLocation);
      assert.equal(redirRes.responseHeaders.location, expectedLocation);
      assert.doesNotMatch(redirRes.location ?? '', /tok_live_secret_abc|ak_live_secret_xyz|deadbeef999/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
