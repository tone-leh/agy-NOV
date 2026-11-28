import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { applyPresetConfig, getModuleDataDir } from '../src/core/config.js';
import { listHostConversationsReadOnly } from '../src/core/conversation-service.js';
import { withFileLockSync } from '../src/core/fs-safe.js';
import { normalizeHookPayload } from '../src/core/utils.js';
import { dispatchNovHook, resolveHookStdinPayload } from '../src/hooks/dispatcher.js';
import { CanvasStore } from '../src/modules/canvas/store.js';
import { loadAuditLog, loadPolicy, loadSnapshots, savePolicy } from '../src/modules/guard/store.js';
import { loadRadarBoardReadOnly, recordRadarSessionEvent } from '../src/modules/radar/core.js';
import { ConversationClient } from '../src/modules/remote/conversation-client.js';
import { RemoteGateway } from '../src/modules/remote/gateway.js';
import { renderMobilePwaHtml } from '../src/modules/remote/mobile-pwa.js';
import { inspectStudioData, listStudioSources } from '../src/modules/studio/core.js';
import { inspectCsvOrTsv } from '../src/modules/studio/csv.js';
import { runGit } from '../src/modules/worktree/git.js';
import { computeCostAnalytics } from '../src/modules/xray/analytics.js';
import { handleXrayHook } from '../src/modules/xray/hook.js';
import { parseTranscriptLines } from '../src/modules/xray/transcript.js';
import { extractCliPositionals } from '../src/server/cli/helpers.js';
import { createNovServer } from '../src/server/index.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

describe('v1.2.3 Cross-Process File Lock, Gate Integrity & Multi-Process Concurrency', () => {
  it('reclaims dead-PID and stale locks, refuses symlink lock files, and eliminates 8-process hook lost updates & orphan blobs', async () => {
    await withTempDir('agy-nov-v123-lock-', async (tmpDir) => {
      const target = path.join(tmpDir, 'state.json');
      const lockPath = `${target}.lock`;

      // 1) Dead PID stale lock is automatically reclaimed
      fs.writeFileSync(lockPath, JSON.stringify({ pid: 999_999_999, ts: Date.now() }), { mode: 0o600 });
      const res1 = withFileLockSync(target, () => {
        const held = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid: number };
        assert.equal(held.pid, process.pid);
        return 'reclaimed-dead-pid';
      });
      assert.equal(res1, 'reclaimed-dead-pid');
      assert.equal(fs.existsSync(lockPath), false, 'Lock file must be removed after fn returns');

      // 2) Symlink lock file is never followed or unlinked
      const outside = path.join(tmpDir, 'outside.txt');
      fs.writeFileSync(outside, 'untouched', 'utf8');
      fs.symlinkSync(outside, lockPath, 'file');
      const resSym = withFileLockSync(target, () => 'safe-fallback', { timeoutMs: 30 });
      assert.equal(resSym, 'safe-fallback');
      assert.equal(fs.readFileSync(outside, 'utf8'), 'untouched');
      fs.unlinkSync(lockPath);

      // 3) 8 parallel dist/hook.cjs child processes -> 0% lost Guard snapshots/audits/Radar sessions, 0 orphan blobs
      const hookBundle = path.join(REPO_ROOT, 'dist', 'hook.cjs');
      assert.equal(fs.existsSync(hookBundle), true, 'dist/hook.cjs must be built');
      const ws = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(ws, { recursive: true });
      applyPresetConfig(dataDir, 'power');

      const files: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        const f = path.join(ws, `file-${i}.ts`);
        fs.writeFileSync(f, `export const idx = ${i};\n`, 'utf8');
        files.push(f);
      }

      const runHookProc = (payload: Record<string, unknown>) =>
        new Promise<{ stdout: string }>((resolve, reject) => {
          const child = execFile(
            process.execPath,
            [hookBundle, '--event', 'PreToolUse', '--data-dir', dataDir],
            { cwd: REPO_ROOT, timeout: 20_000 },
            (err, stdout) => {
              if (err) reject(err);
              else resolve({ stdout });
            },
          );
          child.stdin?.end(JSON.stringify(payload), 'utf8');
        });

      await Promise.all(
        files.map((filePath, i) =>
          runHookProc({
            hookEventName: 'PreToolUse',
            conversationId: `conv-par-${i}`,
            workspacePaths: [ws],
            toolCall: {
              name: 'write_file',
              args: { Path: filePath, Content: `export const idx = ${i + 100};\n` },
            },
          }),
        ),
      );

      const guardDir = getModuleDataDir(dataDir, 'guard');
      const radarDir = getModuleDataDir(dataDir, 'radar');
      const snaps = loadSnapshots(guardDir);
      const audits = loadAuditLog(guardDir);
      const board = loadRadarBoardReadOnly(radarDir);
      const blobsDir = path.join(guardDir, 'blobs');
      const blobFiles = fs.existsSync(blobsDir)
        ? fs.readdirSync(blobsDir).filter((n) => n.endsWith('.blob'))
        : [];
      const referencedHashes = new Set(snaps.map((s) => s.sha256));
      const orphanBlobs = blobFiles.filter((name) => !referencedHashes.has(name.replace(/\.blob$/, '')));

      assert.equal(snaps.length, 8, 'All 8 parallel Guard snapshots must persist without lost updates');
      assert.equal(orphanBlobs.length, 0, 'Zero orphan blobs must remain after 8-way parallel snapshots');
      assert.equal(audits.length, 8, 'All 8 parallel Guard audit entries must persist');
      assert.equal(Object.keys(board.sessions).length, 8, 'All 8 parallel Radar sessions must persist');
    });
  });

  it('prevents Guard PreToolUse fail-open bypass when policy.json is malformed root JSON (null / array) and returns ask on truncated stdin', async () => {
    await withTempDir('agy-nov-v123-guard-root-', async (tmpDir) => {
      const ws = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(ws, { recursive: true });
      applyPresetConfig(dataDir, 'core');
      const guardDir = getModuleDataDir(dataDir, 'guard');
      fs.mkdirSync(guardDir, { recursive: true });

      for (const badRoot of ['null', '[]', '"oops"', '42']) {
        fs.writeFileSync(path.join(guardDir, 'policy.json'), badRoot, 'utf8');
        const pol = loadPolicy(guardDir);
        assert.equal(pol.enabled, true);
        const res = await dispatchNovHook(
          {
            hookEventName: 'PreToolUse',
            workspacePaths: [ws],
            toolCall: { name: 'read_file', args: { Path: path.join(ws, '.env') } },
          },
          'PreToolUse',
          dataDir,
        );
        assert.equal(res.decision, 'deny', `Guard must still deny .env when policy.json is ${badRoot}`);
      }

      // savePolicy ignores explicit undefined overrides and keeps strict boolean defaults
      const preserved = savePolicy(guardDir, { enabled: undefined as unknown as boolean });
      assert.equal(preserved.enabled, true);

      // Truncated / timed-out PreToolUse stdin must never silently allow
      const truncOut = resolveHookStdinPayload(
        { text: '{"toolCall":{"name":"run_command"', truncated: true, timedOut: false },
        'PreToolUse',
        dataDir,
      );
      assert.equal(truncOut.ok, false);
      if (!truncOut.ok) {
        assert.equal(truncOut.gateResult.decision, 'ask');
      }
    });
  });

  it('serializes dead-PID lock reclamation via .reclaim coordinator with zero lost updates across concurrent processes', async () => {
    await withTempDir('agy-nov-v123-reclaim-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data');
      const ws = path.join(tmpDir, 'ws');
      fs.mkdirSync(ws, { recursive: true });
      applyPresetConfig(dataDir, 'core');

      const hookBundle = path.join(REPO_ROOT, 'dist', 'hook.cjs');
      const guardDir = getModuleDataDir(dataDir, 'guard');
      fs.mkdirSync(guardDir, { recursive: true });
      const auditLockPath = path.join(guardDir, 'audit.json.lock');

      for (let round = 0; round < 3; round += 1) {
        // Plant a dead-PID lock right before launching 6 parallel hook processes
        fs.writeFileSync(
          auditLockPath,
          JSON.stringify({ pid: 999_999_999, ts: Date.now() }),
          { mode: 0o600 },
        );
        const procs = Array.from({ length: 6 }, (_, idx) => {
          const payload = JSON.stringify({
            hookEventName: 'PreToolUse',
            conversationId: `reclaim-r${round}-c${idx}`,
            workspacePaths: [ws],
            toolCall: {
              name: 'run_command',
              arguments: { CommandLine: `rm -rf / # reclaim-${round}-${idx}` },
            },
          });
          return new Promise<void>((resolve, reject) => {
            const child = execFile(
              process.execPath,
              [hookBundle, 'PreToolUse', '--data-dir', dataDir],
              { env: { ...process.env, AGY_NOV_DATA_DIR: dataDir } },
              (err) => {
                if (err) reject(err);
                else resolve();
              },
            );
            child.stdin?.end(payload);
          });
        });
        await Promise.all(procs);
        assert.equal(fs.existsSync(`${auditLockPath}.reclaim`), false, '.reclaim lock must be cleaned up');
      }

      const audits = loadAuditLog(guardDir);
      assert.equal(audits.length, 18, 'All 3x6=18 concurrent audits after dead-PID lock reclaim must survive');
    });
  });
});

describe('v1.2.3 Canvas Self-Lock, Remote Gateway, Worktree EPIPE & CLI Option Hardening', () => {
  it('prevents CanvasStore >8 MiB self-lock, malformed updatedAt crash, and NaN coordinate persistence', async () => {
    await withTempDir('agy-nov-v123-canvas-', (tmpDir) => {
      const store = new CanvasStore(tmpDir, false);

      // Publish 4 x 2.4 MiB revisions -> older revisions evicted so board stays readable (< 7.5 MiB)
      const bigBody = `<div>${'x'.repeat(2_400_000)}</div>`;
      for (let i = 1; i <= 4; i += 1) {
        store.publishArtifact({
          boardId: 'big-board',
          title: `Big Board v${i}`,
          kind: 'html',
          content: bigBody,
        });
      }
      const reloaded = store.getBoard('big-board');
      assert.ok(reloaded, 'Board must remain readable and never self-lock past 8 MiB');
      assert.ok(reloaded.revisions.length >= 1 && reloaded.revisions.length < 4);

      // Malformed JSON missing updatedAt must not crash listBoards()
      const boardsDir = path.join(tmpDir, 'boards');
      fs.writeFileSync(
        path.join(boardsDir, 'missing-ts.json'),
        JSON.stringify({ id: 'missing-ts', title: 'No Timestamp', kind: 'html', revisions: [], annotations: [] }),
        'utf8',
      );
      const list = store.listBoards();
      assert.ok(list.length >= 2);

      // NaN coordinates must normalize to finite numbers rather than JSON null
      const updatedBoard = store.addAnnotation('big-board', {
        note: 'Check spacing',
        xPct: Number.NaN,
        yPct: Number.POSITIVE_INFINITY,
        wPct: Number.NaN,
        hPct: -5,
      });
      assert.ok(updatedBoard);
      const pin = updatedBoard.annotations[updatedBoard.annotations.length - 1];
      assert.ok(pin);
      assert.equal(Number.isFinite(pin.xPct), true);
      assert.equal(Number.isFinite(pin.yPct), true);
      assert.equal(pin.xPct, 50);
      assert.equal(pin.yPct, 50);
    });
  });

  it('handles RemoteGateway %ZZ 400, timeout clamping, Worktree stdin EPIPE, CLI space-separated options, and fetch body cancel', async () => {
    await withTempDir('agy-nov-v123-remote-cli-', async (tmpDir) => {
      const convClient = new ConversationClient({ demoMode: true });
      const gw = new RemoteGateway(tmpDir, convClient, { demoMode: true });
      await gw.start(0);
      try {
        const port = gw.getActualPort();
        // Malformed %ZZ encoding returns HTTP 400 (never 500)
        const res = await fetch(`http://127.0.0.1:${port}/api/approvals/%ZZ/decide`, {
          method: 'POST',
          headers: {
            Host: `127.0.0.1:${port}`,
            Authorization: `Bearer ${gw.getConfig().pairingToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ decision: 'denied' }),
        });
        assert.equal(res.status, 400);
        await res.body?.cancel?.();

        // NaN / extreme timeoutSec is clamped cleanly
        const appr = await gw.createApproval({
          conversationId: 'conv-timeout-clamp',
          toolName: 'run_command',
          summary: 'test',
          matchedRule: 'test.rule',
          timeoutSec: Number.NaN,
        });
        assert.ok(Date.parse(appr.expiresAt) > Date.now());
      } finally {
        await gw.stop();
      }

      // Mobile PWA HTML wraps localStorage in safe try/catch helpers
      const html = renderMobilePwaHtml();
      assert.match(html, /safeStorageGet/);
      assert.match(html, /try\s*\{[\s\S]*localStorage/);

      // CLI space-separated option values are not misclassified as subcommands
      const pos = extractCliPositionals(['--data-dir', '/tmp/custom-dir', 'status', '--json']);
      assert.deepEqual(pos, ['status']);
      const pos2 = extractCliPositionals(['--workspace', '/tmp/repo', 'enable', 'turbo']);
      assert.deepEqual(pos2, ['enable', 'turbo']);

      // Worktree runGit absorbs stdin EPIPE cleanly when child exits early
      const gitRes = await runGit(REPO_ROOT, ['--version'], 'x'.repeat(256_000));
      assert.equal(gitRes.ok, true);

      // ConversationService cancels response body on !res.ok
      let bodyCancelled = false;
      const srv = http.createServer((_req, res) => {
        res.statusCode = 500;
        res.end('server error payload');
      });
      await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
      const port = (srv.address() as { port: number }).port;
      const wrappedFetch: typeof fetch = async (...args) => {
        const resp = await fetch(...args);
        if (resp.body) {
          const origCancel = resp.body.cancel.bind(resp.body);
          resp.body.cancel = async (reason?: unknown) => {
            bodyCancelled = true;
            return origCancel(reason);
          };
        }
        return resp;
      };
      try {
        await listHostConversationsReadOnly({
          lsAddress: `127.0.0.1:${port}`,
          csrfToken: 'tok-test',
          fetchImpl: wrappedFetch,
        });
        assert.equal(bodyCancelled, true, 'Non-2xx ConversationService fetch must cancel response body');
      } finally {
        await new Promise<void>((resolve) => srv.close(() => resolve()));
      }
    });
  });
});

describe('v1.2.3 X-Ray Secret Redaction, Billing Accuracy & Studio Large SQLite / CSV', () => {
  it('redacts secrets in X-Ray and Radar hook persistence, keeps >200-turn X-Ray billing accurate, and permits >10 MiB Studio SQLite', async () => {
    await withTempDir('agy-nov-v123-xray-studio-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data');
      const ws = path.join(tmpDir, 'ws');
      fs.mkdirSync(ws, { recursive: true });
      const fakeKey = ['sk', 'proj', '1234567890abcdefghijklmnop'].join('-');

      // 1) X-Ray & Radar redact secrets + <private> before persisting to disk
      handleXrayHook(
        normalizeHookPayload(
          {
            hookEventName: 'PostToolUse',
            conversationId: 'conv-sec-1',
            workspacePaths: [ws],
            toolCall: { name: 'run_command' },
            error: `Auth failed Bearer ${fakeKey} <private>top_secret_pin</private>`,
          },
          'PostToolUse',
        ),
        dataDir,
      );
      const xrayRaw = fs.readFileSync(path.join(getModuleDataDir(dataDir, 'xray'), 'live-state.json'), 'utf8');
      assert.equal(xrayRaw.includes(fakeKey), false, 'X-Ray live-state.json must not persist raw secret');
      assert.equal(xrayRaw.includes('top_secret_pin'), false, 'X-Ray live-state.json must strip <private>');

      const radarDir = getModuleDataDir(dataDir, 'radar');
      recordRadarSessionEvent(radarDir, {
        conversationId: 'conv-sec-2',
        event: 'PostToolUse',
        toolName: 'run_command',
        summary: `Deploy using ${fakeKey} <private>vault_pass</private>`,
        errorMessage: `Failed with ${fakeKey}`,
      });
      const radarRaw = fs.readFileSync(path.join(radarDir, 'board.json'), 'utf8');
      assert.equal(radarRaw.includes(fakeKey), false, 'Radar board.json must not persist raw secret');
      assert.equal(radarRaw.includes('vault_pass'), false, 'Radar board.json must strip <private>');

      // 2) X-Ray clamps negative / NaN tokens and preserves >200-turn full billing
      const lines: string[] = [];
      for (let i = 0; i < 230; i += 1) {
        lines.push(
          JSON.stringify({
            step_index: i,
            type: 'PLANNER_RESPONSE',
            source: 'MODEL',
            model: 'gemini-2.5-pro',
            created_at: new Date(Date.UTC(2026, 10, 28, 10, 0, i)).toISOString(),
            input_tokens: i === 0 ? -500 : 1000,
            output_tokens: i === 1 ? -100 : 200,
            cache_read_tokens: i === 2 ? -50 : 500,
            content: 'Turn ok.',
          }),
        );
      }
      const brainDir = path.join(tmpDir, 'brain');
      const sessDir = path.join(brainDir, 'long-230', '.system_generated', 'logs');
      fs.mkdirSync(sessDir, { recursive: true });
      const transcriptPath = path.join(sessDir, 'transcript.jsonl');
      fs.writeFileSync(transcriptPath, `${lines.join('\n')}\n`, 'utf8');

      const detail = parseTranscriptLines(lines, {
        transcriptPath,
        brainDir: path.join(brainDir, 'long-230'),
        sessionId: 'long-230',
        source: 'custom',
      });
      assert.equal(detail.turns.length, 200, 'Returned turns array stays capped at 200 for UI');
      assert.equal(detail.summary.turns, 230, 'Summary preserves all 230 turns');
      assert.ok(detail.summary.totalOutputTokens >= 229 * 200, 'Negative output tokens must not reduce totals');
      const estUsd = detail.summary.estimatedUsd ?? 0;
      assert.ok(estUsd > 0 && Number.isFinite(estUsd));

      const analytics = computeCostAnalytics({
        brainDirs: [{ dir: brainDir, source: 'custom' }],
      });
      assert.ok(
        Math.abs(analytics.totalEstimatedUsd - estUsd) < 1e-4,
        'Cost analytics must match full 230-turn estimatedUsd without dropping early turns',
      );

      // 3) Studio allows >10 MiB SQLite (up to 256 MiB) and listStudioSources does not flag it oversized
      const bigSqlite = path.join(ws, 'large-history.sqlite');
      const sqliteBuf = Buffer.alloc(11 * 1024 * 1024, 0);
      sqliteBuf.write('SQLite format 3\0', 0, 'ascii');
      sqliteBuf.writeUInt16BE(4096, 16);
      fs.writeFileSync(bigSqlite, sqliteBuf);

      const sources = listStudioSources(ws, { category: 'data' });
      const sqliteEntry = sources.sources.find((s) => s.relPath === 'large-history.sqlite');
      assert.ok(sqliteEntry, 'Large SQLite file must be discovered');
      assert.equal(sqliteEntry.oversized, undefined, '11 MiB SQLite must not be flagged oversized');

      const inspected = await inspectStudioData(ws, {
        filePath: 'large-history.sqlite',
        sqliteBin: 'nonexistent-sqlite3-for-header-check',
      });
      assert.equal(inspected.format, 'sqlite');
      assert.equal(inspected.sqlite?.sqliteCliAvailable, false);

      // 4) Studio CSV filter redacts secrets without filter-oracle leak on wide or ragged tables
      const header = ['id', 'note', ...Array.from({ length: 110 }, (_, idx) => `c${idx}`)].join(',');
      const row = ['1', fakeKey, ...Array.from({ length: 110 }, () => 'v')].join(',');
      const csvBuf = Buffer.from(`${header}\n${row}\n`, 'utf8');
      const filtered = inspectCsvOrTsv('wide.csv', 'csv', csvBuf, csvBuf.byteLength, fakeKey, 50);
      assert.equal(filtered.returnedRows, 0, 'CSV filter must not leak rows matching redacted secret');

      const raggedBuf = Buffer.from(`id,name\n1,alice,${fakeKey}\n`, 'utf8');
      const raggedMatch = inspectCsvOrTsv(
        'ragged.csv',
        'csv',
        raggedBuf,
        raggedBuf.byteLength,
        fakeKey.slice(0, 12),
        50,
      );
      const raggedMiss = inspectCsvOrTsv(
        'ragged.csv',
        'csv',
        raggedBuf,
        raggedBuf.byteLength,
        'no-such-prefix',
        50,
      );
      assert.equal(raggedMatch.returnedRows, 0);
      assert.equal(raggedMiss.returnedRows, 0);
      assert.deepEqual(
        raggedMatch.columns,
        ['id', 'name'],
        'Non-matching ragged row must never extend columns as a secret filter oracle',
      );
      assert.deepEqual(raggedMatch.columns, raggedMiss.columns);
    });
  });

  it('keeps oninitialized non-blocking when client stalls roots/list and hides app_* tools immediately for non-UI clients', async () => {
    await withTempDir('agy-nov-v123-roots-nonblock-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data');
      const ws = path.join(tmpDir, 'ws');
      fs.mkdirSync(ws, { recursive: true });
      const nov = createNovServer({ dataDir, workspaceRoot: ws, demoMode: false });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client(
        { name: 'stalled-roots-client', version: '1.0.0' },
        { capabilities: { roots: {} } },
      );

      let releaseRoots: (() => void) | undefined;
      client.setRequestHandler(ListRootsRequestSchema, () => {
        return new Promise((resolve) => {
          releaseRoots = () => resolve({ roots: [] });
        });
      });

      await nov.server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        // Immediately after initialize, non-UI client must see zero app_* tools
        const listed = await client.listTools();
        const exposedAppTools = listed.tools.filter((t) => t.name.includes('_app_'));
        assert.equal(exposedAppTools.length, 0, 'Non-UI client must never see app_* tools on immediate tools/list');

        // nov_status must finish rapidly even while roots/list is stalled
        const statusStart = Date.now();
        const statusRes = await Promise.race([
          client.callTool({ name: 'nov_status', arguments: {} }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('nov_status blocked by stalled roots/list')), 2000),
          ),
        ]);
        assert.ok(statusRes, 'nov_status returned while roots/list stalled');
        assert.ok(Date.now() - statusStart < 2000);

        // dispose() must finish rapidly even while roots/list is still stalled
        const disposeStart = Date.now();
        await Promise.race([
          nov.dispose(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('dispose() blocked by stalled roots/list')), 2000),
          ),
        ]);
        assert.ok(Date.now() - disposeStart < 2000);
      } finally {
        (releaseRoots as (() => void) | undefined)?.();
        await client.close().catch(() => undefined);
      }
    });
  });
});
