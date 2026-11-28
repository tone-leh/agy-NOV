import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  applyPresetConfig,
  getModuleDataDir,
} from '../src/core/config.js';
import {
  createHostConversation,
  getHostConversationReadOnly,
  isConversationServiceConfigured,
  listHostConversationsReadOnly,
  validateLoopbackLsAddress,
} from '../src/core/conversation-service.js';
import { reconcileRadarWithHostConversations } from '../src/modules/radar/core.js';
import { ConversationClient } from '../src/modules/remote/conversation-client.js';
import {
  getHealthSweepReportPath,
  MAX_HEALTH_SWEEP_BYTES,
  runReadOnlyHealthSweep,
  writeHealthSweepReportIfPermitted,
} from '../src/server/sidecar.js';
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

function startMockConversationService(handler: (method: string, body: Record<string, unknown>, headers: http.IncomingHttpHeaders) => { status?: number; json: unknown }): Promise<{
  address: string;
  requests: Array<{ method: string; body: Record<string, unknown>; csrf: string }>;
  close: () => Promise<void>;
}> {
  const requests: Array<{ method: string; body: Record<string, unknown>; csrf: string }> = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let parsed: Record<string, unknown> = {};
      try {
        parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        parsed = {};
      }
      const method = (req.url ?? '').split('/').pop() ?? '';
      requests.push({
        method,
        body: parsed,
        csrf: String(req.headers['x-antigravity-csrf-token'] ?? ''),
      });
      const out = handler(method, parsed, req.headers);
      res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.json));
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind mock ConversationService'));
        return;
      }
      resolve({
        address: `127.0.0.1:${addr.port}`,
        requests,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

describe('v1.2.0 Opt-In Read-Only Audit Sidecar & CLI audit-once', () => {
  it('runs 100% read-only health sweeps with zero disk writes, aggregates ops/mem/verify/guard, and guards symlink writes', async () => {
    await withTempDir('agy-nov-v120-sidecar-', (tmpDir) => {
      const ws = path.join(tmpDir, 'demo-project');
      const absentDataDir = path.join(tmpDir, 'absent-data');
      fs.mkdirSync(ws, { recursive: true });
      fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'demo-project' }), 'utf8');

      const emptySweep = runReadOnlyHealthSweep({ workspaceRoot: ws, dataDir: absentDataDir });
      assert.equal(fs.existsSync(absentDataDir), false, 'Health sweep must never create missing dataDir');
      assert.equal(emptySweep.workspaceName, 'demo-project');
      assert.equal(JSON.stringify(emptySweep).includes(tmpDir), false, 'Must not leak full host workspace path');
      assert.equal(emptySweep.config.preset, 'core');

      // Refuses write when dataDir does not exist
      const refuseMissing = writeHealthSweepReportIfPermitted(absentDataDir, emptySweep);
      assert.equal(refuseMissing.written, false);
      assert.equal(fs.existsSync(absentDataDir), false);

      // Populate realistic module state (drifted + expired unpinned + pinned expired + blocked verify + guard denies)
      const dataDir = path.join(tmpDir, 'data');
      applyPresetConfig(dataDir, 'local-all');

      const memDir = getModuleDataDir(dataDir, 'mem');
      fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(
        path.join(memDir, 'memories.json'),
        JSON.stringify({
          memories: [
            { id: 'm1', title: 'Drifted', pinned: false, stale: true },
            { id: 'm2', title: 'Expired unpinned', pinned: false, expiresAt: '2020-01-01T00:00:00.000Z' },
            { id: 'm3', title: 'Expired pinned', pinned: true, expiresAt: '2020-01-01T00:00:00.000Z' },
          ],
        }),
        'utf8',
      );

      const verifyDir = getModuleDataDir(dataDir, 'verify');
      fs.mkdirSync(verifyDir, { recursive: true });
      fs.writeFileSync(
        path.join(verifyDir, 'state.json'),
        JSON.stringify({
          sessions: { s1: { dirtyFiles: ['src/a.ts', 'src/b.ts'] } },
          evidence: [{ outcome: 'blocked', blocked: true, timestamp: new Date().toISOString() }],
        }),
        'utf8',
      );

      const guardDir = getModuleDataDir(dataDir, 'guard');
      fs.mkdirSync(guardDir, { recursive: true });
      fs.writeFileSync(
        path.join(guardDir, 'audit.json'),
        JSON.stringify([
          { id: 'g1', decision: 'deny', toolName: 'read_file', timestamp: new Date().toISOString() },
          { id: 'g2', decision: 'allow', toolName: 'read_file', timestamp: new Date().toISOString() },
        ]),
        'utf8',
      );

      const sweep = runReadOnlyHealthSweep({ workspaceRoot: ws, dataDir });
      assert.equal(sweep.mem.totalMemories, 3);
      assert.equal(sweep.mem.staleCount, 1);
      assert.equal(sweep.mem.expiredUnpinnedCount, 1);
      assert.equal(sweep.verify.verifyLastStatus, 'blocked');
      assert.equal(sweep.verify.dirtyFilesCount, 2);
      assert.equal(sweep.guard.guardBlockedCount, 1);
      assert.ok(sweep.recommendations.length <= 6);
      assert.notEqual(sweep.overallStatus, 'healthy');

      // Symlink target refused by writeHealthSweepReportIfPermitted
      const outside = path.join(tmpDir, 'outside.json');
      fs.writeFileSync(outside, '{}', 'utf8');
      const reportPath = getHealthSweepReportPath(dataDir);
      fs.symlinkSync(outside, reportPath);
      const symWrite = writeHealthSweepReportIfPermitted(dataDir, sweep);
      assert.equal(symWrite.written, false);
      fs.unlinkSync(reportPath);

      // Safe real directory write succeeds with <= 64 KiB cap
      const okWrite = writeHealthSweepReportIfPermitted(dataDir, sweep);
      assert.equal(okWrite.written, true);
      assert.ok(fs.existsSync(reportPath));
      assert.ok(fs.statSync(reportPath).size <= MAX_HEALTH_SWEEP_BYTES);
    });
  });

  it('executes sidecars/audit-sidecar.mjs --once end-to-end (zero port binding, valid JSON, zero write by default)', async () => {
    const cliBundle = path.join(REPO_ROOT, 'dist', 'cli.cjs');
    assert.equal(fs.existsSync(cliBundle), true, 'dist/cli.cjs must exist');
    await withTempDir('agy-nov-v120-sidecar-cli-', (tmpDir) => {
      const absentDir = path.join(tmpDir, 'never-created');
      const raw = execFileSync(
        process.execPath,
        [
          path.join(REPO_ROOT, 'sidecars', 'audit-sidecar.mjs'),
          '--once',
          `--workspace=${REPO_ROOT}`,
          `--data-dir=${absentDir}`,
        ],
        { cwd: REPO_ROOT, encoding: 'utf8', timeout: 15_000 },
      );
      const parsed = JSON.parse(raw) as { schemaVersion: number; workspaceName: string; overallStatus: string };
      assert.equal(parsed.schemaVersion, 1);
      assert.equal(parsed.workspaceName, 'agy-NOV');
      assert.ok(['healthy', 'attention', 'action-required'].includes(parsed.overallStatus));
      assert.equal(fs.existsSync(absentDir), false, 'Sidecar --once must write ZERO files without --write-report');
    });
  });
});

describe('v1.2.0 ConversationService Loopback Bridge, Clean Fork & Radar Reconciliation', () => {
  it('blocks non-loopback SSRF addresses, redacts secrets, and never echoes csrfToken', async () => {
    const badAddresses = [
      '',
      'example.com:5387',
      '169.254.169.254:80',
      '10.0.0.1:5387',
      '192.168.1.10:5387',
      'http://127.0.0.1:5387',
      '127.0.0.1:5387/extra',
      'user@127.0.0.1:5387',
      '127.0.0.1:0',
      '127.0.0.1:99999',
      'localhost.evil.com:5387',
    ];
    for (const addr of badAddresses) {
      assert.equal(validateLoopbackLsAddress(addr).valid, false, `Expected SSRF rejection for "${addr}"`);
    }
    assert.equal(validateLoopbackLsAddress('127.0.0.1:5387').valid, true);
    assert.equal(validateLoopbackLsAddress('localhost:5387').valid, true);
    assert.equal(validateLoopbackLsAddress('[::1]:5387').valid, true);
    assert.equal(validateLoopbackLsAddress('LOCALHOST:80').valid, true);
    assert.equal(validateLoopbackLsAddress('127.0.0.1:5387\n').valid, false);
    assert.equal(validateLoopbackLsAddress('\r127.0.0.1:5387').valid, false);

    assert.equal(
      isConversationServiceConfigured({ lsAddress: '169.254.169.254:80', csrfToken: 'tok-123' }).available,
      false,
    );

    const secretCsrf = 'super-secret-csrf-token-99999';
    const ssrfRes = await listHostConversationsReadOnly({
      lsAddress: 'example.com:443',
      csrfToken: secretCsrf,
    });
    assert.equal(ssrfRes.ok, false);
    assert.equal(ssrfRes.live, false);
    assert.equal(JSON.stringify(ssrfRes).includes(secretCsrf), false, 'Must never echo csrfToken');

    // Remote ConversationClient also rejects non-loopback SSRF and falls back cleanly
    const client = new ConversationClient({
      lsAddress: '169.254.169.254:80',
      csrfToken: secretCsrf,
    });
    const listRes = await client.listConversations(5);
    assert.equal(listRes.live, false);
  });

  it('connects to local loopback ConversationService for Clean Fork & Radar reconciliation with +0 model tools', async () => {
    const fakeKey = ['sk-proj-', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'].join('');
    const mock = await startMockConversationService((method, body) => {
      if (method === 'ListConversations') {
        return {
          json: {
            conversations: [
              {
                id: 'conv-drifted',
                annotations: { title: 'Stuck Session' },
                state: { runState: 'RUN_STATE_IDLE', updateTime: '2026-11-28T00:00:00Z' },
              },
              {
                id: 'conv-host-only',
                annotations: { title: 'External Running Agent' },
                state: { runState: 'RUN_STATE_RUNNING', updateTime: '2026-11-28T00:01:00Z' },
              },
            ],
          },
        };
      }
      if (method === 'GetConversation') {
        return {
          json: {
            id: String(body.conversationId ?? 'conv-1'),
            annotations: { title: 'Checked Session' },
            state: { runState: 'RUN_STATE_IDLE', updateTime: '2026-11-28T00:00:00Z' },
          },
        };
      }
      if (method === 'CreateConversation') {
        return {
          json: {
            conversation: {
              id: 'conv-forked-new',
              annotations: { title: String(body.title ?? 'Clean Fork') },
              state: { runState: 'RUN_STATE_RUNNING', updateTime: '2026-11-28T00:02:00Z' },
            },
          },
        };
      }
      return { status: 404, json: { error: 'unknown method' } };
    });

    try {
      const opts = { lsAddress: mock.address, csrfToken: 'local-csrf-ok' };
      const listed = await listHostConversationsReadOnly(opts, 10);
      assert.equal(listed.ok, true);
      assert.equal(listed.live, true);
      assert.equal(listed.conversations.length, 2);

      const got = await getHostConversationReadOnly(opts, 'conv-drifted');
      assert.equal(got.ok, true);
      assert.equal(got.conversation?.id, 'conv-drifted');

      const created = await createHostConversation(opts, {
        title: `Fork <private>secret</private> ${fakeKey}`,
        prompt: `Continue work <private>hidden-prompt</private> ${fakeKey}`,
      });
      assert.equal(created.ok, true);
      assert.equal(created.conversation?.id, 'conv-forked-new');

      const createReq = mock.requests.find((r) => r.method === 'CreateConversation');
      assert.ok(createReq);
      assert.equal(createReq.csrf, 'local-csrf-ok');
      const sentBody = JSON.stringify(createReq.body);
      assert.equal(sentBody.includes(fakeKey), false, 'Outbound prompt must redact API keys');
      assert.equal(sentBody.includes('hidden-prompt'), false, 'Outbound prompt must strip <private>');

      // Pure reconciliation check
      const reconciled = reconcileRadarWithHostConversations(
        [{ conversationId: 'conv-drifted', status: 'running', workspaceName: 'demo-ws' }],
        listed.conversations,
      );
      assert.equal(reconciled.matchedCount, 1);
      assert.equal(reconciled.driftedToIdle.length, 1);
      assert.equal(reconciled.driftedToIdle[0].conversationId, 'conv-drifted');
      assert.equal(reconciled.hostOnlyRunning.length, 1);
      assert.equal(reconciled.hostOnlyRunning[0].id, 'conv-host-only');

      // End-to-end MCP tool call with demoMode & full preset verifying strict 47 model tool ceiling
      await withTempDir('agy-nov-v120-mcp-', async (tmpDir) => {
        const dataDir = path.join(tmpDir, 'data');
        applyPresetConfig(dataDir, 'full');
        const bundle = createNovServer({
          dataDir,
          workspaceRoot: tmpDir,
          demoMode: true,
          exposeAppToolsWithoutUiCapability: false,
        });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client(
          { name: 'v120-cli-client', version: '1.2.0' },
          { capabilities: {} },
        );
        await bundle.server.connect(serverTransport);
        await client.connect(clientTransport);
        try {
          const tools = await client.listTools();
          assert.equal(tools.tools.length, 47, 'v1.2.0 must strictly preserve the 47 canonical model tool cap');
        } finally {
          await client.close();
          await bundle.dispose();
        }
      });
    } finally {
      await mock.close();
    }
  });
});

describe('v1.2.0 Antigravity Marketplace Readiness & Official Manifest Hygiene', () => {
  it('passes all official plugin.json Marketplace constraints and CLI doctor readiness checks', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'plugin.json'), 'utf8'),
    ) as Record<string, unknown>;
    const officialAllowed = new Set([
      'name',
      'displayName',
      'description',
      'version',
      'logo',
      'suggestedPrompts',
      'author',
      'homepage',
      'repository',
      'disabled',
    ]);
    for (const key of Object.keys(manifest)) {
      assert.ok(officialAllowed.has(key), `Unexpected non-official key in plugin.json: ${key}`);
    }
    const desc = String(manifest.description ?? '');
    assert.ok(desc.length >= 60 && desc.length <= 200, `Expected concise Marketplace description (60..200 chars), got ${desc.length}`);
    assert.ok(Array.isArray(manifest.suggestedPrompts) && manifest.suggestedPrompts.length === 3);
    assert.equal(manifest.logo, 'assets/logo.svg');
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'assets', 'logo.svg')), true);
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'rules', 'AGENTS.md')), false);
  });

  it('hardens v1.2.0 red-team regressions: blocks 307 redirect SSRF/CSRF leak, symlinked dist/ escape, and mixed-prefix absolute paths', async () => {
    // 1. Block 307 cross-origin redirect and prevent CSRF header leakage
    let sinkHitCount = 0;
    let leakedCsrf = '';
    const sinkServer = http.createServer((req, res) => {
      sinkHitCount += 1;
      leakedCsrf = String(req.headers['x-antigravity-csrf-token'] ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ conversations: [] }));
    });
    await new Promise<void>((resolve) => sinkServer.listen(0, '127.0.0.1', () => resolve()));
    const sinkPort = (sinkServer.address() as { port: number }).port;

    const redirectServer = http.createServer((_req, res) => {
      res.writeHead(307, { Location: `http://localhost:${sinkPort}/stolen` });
      res.end();
    });
    await new Promise<void>((resolve) => redirectServer.listen(0, '127.0.0.1', () => resolve()));
    const redirectPort = (redirectServer.address() as { port: number }).port;

    try {
      const secretCsrf = 'csrf-must-not-redirect-77777';
      const listRes = await listHostConversationsReadOnly({
        lsAddress: `127.0.0.1:${redirectPort}`,
        csrfToken: secretCsrf,
      });
      assert.equal(listRes.ok, false);
      assert.equal(sinkHitCount, 0, 'Must never follow 307 redirect');
      assert.equal(leakedCsrf, '', 'Must never leak CSRF token cross-origin');
      assert.equal(JSON.stringify(listRes).includes(secretCsrf), false);
    } finally {
      await new Promise<void>((done) => redirectServer.close(() => done()));
      await new Promise<void>((done) => sinkServer.close(() => done()));
    }

    // 2. Reject symlinked dist/ directory in sidecars/audit-sidecar.mjs
    await withTempDir('agy-nov-v120-dist-sym-', (tmpDir) => {
      const fakePlugin = path.join(tmpDir, 'plugin');
      const fakeSidecars = path.join(fakePlugin, 'sidecars');
      const evilDist = path.join(tmpDir, 'evil-dist');
      fs.mkdirSync(fakeSidecars, { recursive: true });
      fs.mkdirSync(evilDist, { recursive: true });
      fs.copyFileSync(
        path.join(REPO_ROOT, 'sidecars', 'audit-sidecar.mjs'),
        path.join(fakeSidecars, 'audit-sidecar.mjs'),
      );
      fs.writeFileSync(path.join(evilDist, 'cli.cjs'), 'console.log("EVIL_EXECUTED");', 'utf8');
      fs.symlinkSync(evilDist, path.join(fakePlugin, 'dist'));

      let failed = false;
      let errOut = '';
      try {
        execFileSync(process.execPath, [path.join(fakeSidecars, 'audit-sidecar.mjs'), '--once'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        failed = true;
        errOut = String((err as { stderr?: string }).stderr ?? '');
      }
      assert.equal(failed, true, 'Sidecar must refuse symlinked dist/ directory');
      assert.equal(errOut.includes(tmpDir), false, 'Sidecar error output must not leak host absolute path');
    });

    // 3. Strip Windows forward-slash & prefixed POSIX host paths in sidecar sweep output
    await withTempDir('agy-nov-v120-path-leak-', (tmpDir) => {
      const ws = path.join(tmpDir, 'leak-ws');
      fs.mkdirSync(ws, { recursive: true });
      fs.writeFileSync(
        path.join(ws, 'mcp_config.json'),
        JSON.stringify({
          mcpServers: {
            'srv_/Users/alice/x': {
              command: 'node',
              args: ['D:/Projects/secret-client/index.js'],
              env: { API_KEY: 'literal-secret-value-12345' },
            },
          },
        }),
        'utf8',
      );
      const sweep = runReadOnlyHealthSweep({ workspaceRoot: ws, dataDir: path.join(tmpDir, 'absent') });
      const serialized = JSON.stringify(sweep);
      assert.equal(serialized.includes('/Users/alice/x'), false);
      assert.equal(serialized.includes('D:/Projects/secret-client'), false);
    });
  });
});
