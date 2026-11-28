import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  applyPresetConfig,
  getModuleDataDir,
  loadNovConfigReadOnly,
  setModuleEnabled,
} from '../src/core/config.js';
import {
  buildFeedSnapshot,
  FEED_SNAPSHOT_VERSION,
  getFeedSnapshotPath,
  writeFeedSnapshotIfDataDirExists,
} from '../src/core/feed.js';
import { dispatchNovHook } from '../src/hooks/dispatcher.js';
import { capturePreEditSnapshot, loadPolicy } from '../src/modules/guard/store.js';
import { archiveSpecToMemory, saveSpec } from '../src/modules/spec/core.js';
import { runReadOnlyHealthSweep } from '../src/server/sidecar.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

describe('v1.2.1 Consistency, Disabled-Module Isolation & Dual-Star Feed Hardening', () => {
  it('P1-1: buildFeedSnapshot picks the newest snapshot via createdAt (never oldest) and keeps GUARD_BLOCKED reason tied to deny events', async () => {
    await withTempDir('agy-nov-v121-feed-', (tmpDir) => {
      const ws = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(ws, { recursive: true });
      applyPresetConfig(dataDir, 'core');

      const targetFile = path.join(ws, 'app.ts');
      fs.writeFileSync(targetFile, 'export const v = 1;\n', 'utf8');

      const guardDir = getModuleDataDir(dataDir, 'guard');
      const policy = loadPolicy(guardDir);
      const firstSnap = capturePreEditSnapshot({
        dataDir: guardDir,
        workspaceRoot: ws,
        filePath: targetFile,
        toolName: 'edit_file',
        reason: 'first',
        policy,
      });
      assert.ok(firstSnap);

      // Force a strictly newer createdAt on the second snapshot and keep descending storage order ([newest, oldest])
      fs.writeFileSync(targetFile, 'export const v = 2;\n', 'utf8');
      const secondSnap = capturePreEditSnapshot({
        dataDir: guardDir,
        workspaceRoot: ws,
        filePath: targetFile,
        toolName: 'edit_file',
        reason: 'second',
        policy,
      });
      assert.ok(secondSnap);

      // Even if both share the same millisecond timestamp, [0] (newest) must win via strict `>` comparison
      const snapsPath = path.join(guardDir, 'snapshots.json');
      const storedSnaps = JSON.parse(fs.readFileSync(snapsPath, 'utf8')) as Array<Record<string, unknown>>;
      assert.equal(storedSnaps[0].id, secondSnap.id);
      storedSnaps[0].createdAt = '2026-11-28T00:00:05.000Z';
      storedSnaps[1].createdAt = '2026-11-28T00:00:01.000Z';
      fs.writeFileSync(snapsPath, JSON.stringify(storedSnaps, null, 2), 'utf8');

      // Seed a deny event followed later by a force_ask event -> GUARD_BLOCKED must cite the deny reason, not force_ask
      fs.writeFileSync(
        path.join(guardDir, 'audit.json'),
        JSON.stringify([
          {
            id: 'ev-ask',
            decision: 'force_ask',
            toolName: 'run_command',
            summary: 'Strict gate confirmation',
            timestamp: '2026-11-28T00:05:00.000Z',
          },
          {
            id: 'ev-deny',
            decision: 'deny',
            toolName: 'read_file',
            summary: 'Blocked secret file .env',
            timestamp: '2026-11-28T00:01:00.000Z',
          },
        ]),
        'utf8',
      );

      // Seed verify evidence in ascending timestamp order -> newest timestamp must win
      const verifyDir = getModuleDataDir(dataDir, 'verify');
      fs.mkdirSync(verifyDir, { recursive: true });
      setModuleEnabled(dataDir, 'verify', true);
      fs.writeFileSync(
        path.join(verifyDir, 'state.json'),
        JSON.stringify({
          policy: { enforceOnStop: true },
          evidence: [
            { outcome: 'fail', passed: false, timestamp: '2026-11-28T00:01:00.000Z' },
            { outcome: 'pass', passed: true, timestamp: '2026-11-28T00:09:00.000Z' },
          ],
        }),
        'utf8',
      );

      const cfg = loadNovConfigReadOnly(dataDir);
      const snap = buildFeedSnapshot(dataDir, cfg);
      assert.equal(snap.version, FEED_SNAPSHOT_VERSION);
      assert.equal(snap.summary.guard.latestSnapshotId, secondSnap.id, 'Must return newest snapshot ID');
      assert.equal(snap.summary.verify.lastStatus, 'pass', 'Must pick latest verify evidence by timestamp');

      const guardAlert = snap.alerts.find((a) => a.code === 'GUARD_BLOCKED');
      assert.ok(guardAlert, 'Expected GUARD_BLOCKED alert');
      assert.match(guardAlert.message, /Blocked secret file \.env/);
      assert.equal(guardAlert.message.includes('Strict gate confirmation'), false);
    });
  });

  it('P1-2 & P2-6: PreToolUse deny refreshes feed-snapshot.json immediately, while PostToolUse short-circuits when all listeners are off', async () => {
    await withTempDir('agy-nov-v121-hooks-', async (tmpDir) => {
      const ws = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(ws, { recursive: true });
      applyPresetConfig(dataDir, 'core');

      // Write initial feed snapshot with blockedCount = 0
      writeFeedSnapshotIfDataDirExists(dataDir, loadNovConfigReadOnly(dataDir));
      const feedPath = getFeedSnapshotPath(dataDir);
      const before = JSON.parse(fs.readFileSync(feedPath, 'utf8')) as {
        summary: { guard: { blockedCount: number } };
      };
      assert.equal(before.summary.guard.blockedCount, 0);

      // Trigger PreToolUse deny against .env -> feed-snapshot.json must refresh immediately
      const preRes = await dispatchNovHook(
        {
          hookEventName: 'PreToolUse',
          toolName: 'read_file',
          toolInput: { Path: path.join(ws, '.env') },
          workspacePaths: [ws],
        },
        'PreToolUse',
        dataDir,
      );
      assert.equal(preRes.decision, 'deny');
      const after = JSON.parse(fs.readFileSync(feedPath, 'utf8')) as {
        summary: { guard: { blockedCount: number } };
      };
      assert.equal(after.summary.guard.blockedCount, 1, 'PreToolUse deny must refresh feed-snapshot.json');

      // Disable all PostToolUse listener modules (review/xray/radar/verify/turbo) -> O(1) short-circuit, zero rewrite
      applyPresetConfig(dataDir, 'minimal');
      setModuleEnabled(dataDir, 'guard', false);
      fs.rmSync(feedPath, { force: true });
      const postRes = await dispatchNovHook(
        { hookEventName: 'PostToolUse', toolName: 'read_file', workspacePaths: [ws] },
        'PostToolUse',
        dataDir,
      );
      assert.deepEqual(postRes, {});
      assert.equal(fs.existsSync(feedPath), false, 'PostToolUse with all listeners off must not write feed-snapshot.json');
    });
  });

  it('P1-3: archiveSpecToMemory refuses disk writes when mem module is disabled and succeeds once enabled', async () => {
    await withTempDir('agy-nov-v121-spec-mem-', (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data');
      applyPresetConfig(dataDir, 'core');
      setModuleEnabled(dataDir, 'spec', true);
      setModuleEnabled(dataDir, 'mem', false);

      const specDir = getModuleDataDir(dataDir, 'spec');
      const memDir = getModuleDataDir(dataDir, 'mem');
      saveSpec(
        specDir,
        {
          id: 'spec-gate-test',
          title: 'Disabled Mem Gate',
          goal: 'Ensure disabled mem module never writes disk',
          acceptanceCriteria: ['No modules/mem directory created when mem=false'],
          tasks: [{ id: 't1', title: 'Check gate', status: 'pending' }],
        },
        'user',
      );

      const denied = archiveSpecToMemory(specDir, dataDir, 'spec-gate-test', { workspacePath: tmpDir });
      assert.equal(denied.ok, false);
      assert.match(denied.error, /disabled/i);
      assert.equal(fs.existsSync(memDir), false, 'Disabled mem module must remain untouched on disk');

      setModuleEnabled(dataDir, 'mem', true);
      const allowed = archiveSpecToMemory(specDir, dataDir, 'spec-gate-test', { workspacePath: tmpDir });
      assert.equal(allowed.ok, true);
      assert.equal(fs.existsSync(path.join(memDir, 'memories.json')), true);
    });
  });

  it('P2-4 & P2-5: Sidecar health sweep respects disabled module toggles, and CLI mutations refresh existing feed-snapshot.json', async () => {
    await withTempDir('agy-nov-v121-sidecar-cli-', (tmpDir) => {
      const ws = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(ws, { recursive: true });
      fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'clean-ws' }), 'utf8');

      // Seed stale historical files for guard/verify/mem, then disable all three modules
      applyPresetConfig(dataDir, 'power');
      const guardDir = getModuleDataDir(dataDir, 'guard');
      fs.mkdirSync(guardDir, { recursive: true });
      fs.writeFileSync(
        path.join(guardDir, 'audit.json'),
        JSON.stringify([{ id: '1', decision: 'deny', toolName: 'read_file', timestamp: new Date().toISOString() }]),
        'utf8',
      );
      const verifyDir = getModuleDataDir(dataDir, 'verify');
      fs.mkdirSync(verifyDir, { recursive: true });
      fs.writeFileSync(
        path.join(verifyDir, 'state.json'),
        JSON.stringify({
          sessions: { s1: { dirtyFiles: ['a.ts'] } },
          evidence: [{ outcome: 'blocked', blocked: true, timestamp: new Date().toISOString() }],
        }),
        'utf8',
      );
      const memDir = getModuleDataDir(dataDir, 'mem');
      fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(
        path.join(memDir, 'memories.json'),
        JSON.stringify({ memories: [{ id: 'm1', title: 'Drifted', stale: true }] }),
        'utf8',
      );

      setModuleEnabled(dataDir, 'guard', false);
      setModuleEnabled(dataDir, 'verify', false);
      setModuleEnabled(dataDir, 'mem', false);

      const sweep = runReadOnlyHealthSweep({ workspaceRoot: ws, dataDir });
      assert.equal(sweep.guard.guardBlockedCount, 0);
      assert.equal(sweep.verify.verifyLastStatus, 'idle');
      assert.equal(sweep.verify.dirtyFilesCount, 0);
      assert.equal(sweep.mem.totalMemories, 0);
      assert.equal(sweep.overallStatus, 'healthy');

      // CLI preset mutation refreshes an existing feed-snapshot.json so config.json and feed stay in sync
      applyPresetConfig(dataDir, 'core');
      writeFeedSnapshotIfDataDirExists(dataDir, loadNovConfigReadOnly(dataDir));
      const cliEntry = path.join(REPO_ROOT, 'src', 'server', 'cli.ts');
      execFileSync(
        process.execPath,
        ['--import', 'tsx', cliEntry, 'preset', 'minimal', `--data-dir=${dataDir}`],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );
      const updatedFeed = JSON.parse(fs.readFileSync(getFeedSnapshotPath(dataDir), 'utf8')) as {
        preset: string;
        enabledCount: number;
      };
      assert.equal(updatedFeed.preset, 'minimal');
      assert.equal(updatedFeed.enabledCount, 1);
    });
  });

  it('Hardening: handles empty-string timestamp fallback, missing/symlink dataDir zero-write, and symlink feed protection', async () => {
    await withTempDir('agy-nov-v121-neg-', async (tmpDir) => {
      const ws = path.join(tmpDir, 'ws');
      fs.mkdirSync(ws, { recursive: true });

      // 1) Missing dataDir must never be created by writeFeedSnapshotIfDataDirExists (or idle PreToolUse allow)
      const absentDir = path.join(tmpDir, 'never-created-dir');
      assert.equal(
        writeFeedSnapshotIfDataDirExists(absentDir, loadNovConfigReadOnly(absentDir)),
        false,
      );
      assert.equal(fs.existsSync(absentDir), false, 'writeFeedSnapshotIfDataDirExists must never create absent dataDir');

      const allowRes = await dispatchNovHook(
        {
          hookEventName: 'PreToolUse',
          toolName: 'read_file',
          toolInput: { Path: path.join(ws, 'README.md') },
          workspacePaths: [ws],
        },
        'PreToolUse',
        absentDir,
      );
      assert.equal(allowRes.decision, 'allow');
      assert.equal(fs.existsSync(absentDir), false, 'PreToolUse allow must never create absent dataDir');

      // 2) Symlinked feed-snapshot.json must never be overwritten by hook deny refresh or CLI mutation
      const dataDir = path.join(tmpDir, 'data');
      applyPresetConfig(dataDir, 'core');
      const outside = path.join(tmpDir, 'outside-sentinel.json');
      fs.writeFileSync(outside, '{"sentinel":true}', 'utf8');
      const feedPath = getFeedSnapshotPath(dataDir);
      fs.symlinkSync(outside, feedPath);

      const denyRes = await dispatchNovHook(
        {
          hookEventName: 'PreToolUse',
          toolName: 'read_file',
          toolInput: { Path: path.join(ws, '.env') },
          workspacePaths: [ws],
        },
        'PreToolUse',
        dataDir,
      );
      assert.equal(denyRes.decision, 'deny');
      assert.equal(fs.readFileSync(outside, 'utf8'), '{"sentinel":true}', 'PreToolUse deny must not write through symlinked feed');

      const cliEntry = path.join(REPO_ROOT, 'src', 'server', 'cli.ts');
      execFileSync(
        process.execPath,
        ['--import', 'tsx', cliEntry, 'preset', 'minimal', `--data-dir=${dataDir}`],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );
      assert.equal(fs.readFileSync(outside, 'utf8'), '{"sentinel":true}', 'CLI must not write through symlinked feed');
      fs.unlinkSync(feedPath);

      // 3) Empty-string createdAt / timestamp falls back cleanly to secondary timestamp field
      applyPresetConfig(dataDir, 'local-all');
      const guardDir = getModuleDataDir(dataDir, 'guard');
      fs.mkdirSync(guardDir, { recursive: true });
      fs.writeFileSync(
        path.join(guardDir, 'snapshots.json'),
        JSON.stringify([
          { id: 'snap-old', createdAt: '2026-11-28T01:00:00.000Z' },
          { id: 'snap-fallback', createdAt: '   ', timestamp: '2026-11-28T05:00:00.000Z' },
        ]),
        'utf8',
      );
      const verifyDir = getModuleDataDir(dataDir, 'verify');
      fs.mkdirSync(verifyDir, { recursive: true });
      fs.writeFileSync(
        path.join(verifyDir, 'state.json'),
        JSON.stringify({
          evidence: [
            { outcome: 'fail', passed: false, timestamp: '2026-11-28T01:00:00.000Z' },
            { outcome: 'pass', passed: true, timestamp: '', createdAt: '2026-11-28T06:00:00.000Z' },
          ],
        }),
        'utf8',
      );

      const snap = buildFeedSnapshot(dataDir, loadNovConfigReadOnly(dataDir));
      assert.equal(snap.summary.guard.latestSnapshotId, 'snap-fallback');
      assert.equal(snap.summary.verify.lastStatus, 'pass');
      const sweep = runReadOnlyHealthSweep({ workspaceRoot: ws, dataDir });
      assert.equal(sweep.verify.verifyLastStatus, 'pass');
    });
  });
});
