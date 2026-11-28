import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  applyPresetConfig,
  createDefaultConfig,
  getConfigPath,
  getModuleDataDir,
  loadNovConfigReadOnly,
  saveNovConfig,
  setModuleEnabled,
  setNovLocale,
  UI_LOCALE_IDS,
} from '../src/core/config.js';
import { listHostConversationsReadOnly } from '../src/core/conversation-service.js';
import {
  buildFeedSnapshot,
  getFeedSnapshotPath,
  writeFeedSnapshotIfDataDirExists,
} from '../src/core/feed.js';
import {
  atomicWriteJson,
  discoverUserCustomSkillsReadOnly,
  getDefaultAntigravitySkillDirs,
  isPidAlive,
  normalizeHookPayload,
} from '../src/core/utils.js';
import { clampHookResult, dispatchNovHook } from '../src/hooks/dispatcher.js';
import { handleGuardPreToolHook } from '../src/modules/guard/hook.js';
import { evaluateToolCall } from '../src/modules/guard/policy.js';
import { capturePreEditSnapshot, loadPolicy, savePolicy } from '../src/modules/guard/store.js';
import { DEFAULT_POLICY } from '../src/modules/guard/types.js';
import { extractEditedFilesFromTranscript } from '../src/modules/mem/hook.js';
import { auditWorkspaceReadOnly } from '../src/modules/ops/core.js';
import {
  getRadarBoardPath,
  getRadarStatusCapsulePath,
  recordRadarSessionEvent,
} from '../src/modules/radar/core.js';
import { handleRadarHook } from '../src/modules/radar/hook.js';
import { readRuntimeInfo, writeRuntimeInfo } from '../src/modules/remote/config.js';
import { ConversationClient } from '../src/modules/remote/conversation-client.js';
import { RemoteGateway } from '../src/modules/remote/gateway.js';
import { buildApprovalRiskCard } from '../src/modules/remote/hook.js';
import { readConversationLiveStream } from '../src/modules/remote/live-stream.js';
import { renderMobilePwaHtml } from '../src/modules/remote/mobile-pwa.js';
import { AnnotationStore } from '../src/modules/review/annotations.js';
import { handleReviewHook, readReviewSignal } from '../src/modules/review/hook.js';
import { getSpecStatePath, loadSpecStateReadOnly, saveSpecState } from '../src/modules/spec/store.js';
import { inspectSqliteDatabase } from '../src/modules/studio/sqlite.js';
import {
  executeSafeCompactRun,
  loadTurboHotspotsReadOnly,
  recordTurboHotspot,
  saveTurboPrefs,
} from '../src/modules/turbo/auto-rtk.js';
import { handleVerifyPostToolHook } from '../src/modules/verify/hook.js';
import { getVerifyStatePath, loadVerifyStateReadOnly, saveVerifyState } from '../src/modules/verify/store.js';
import {
  discoverTranscriptEntries,
  loadSessionDetail,
  readLiveHookState,
} from '../src/modules/xray/discovery.js';
import { handleXrayHook } from '../src/modules/xray/hook.js';
import { searchSessions } from '../src/modules/xray/search.js';
import { parseTranscriptFile } from '../src/modules/xray/transcript.js';
import { buildWorkspaceRecommendation } from '../src/server/cli/recommend.js';
import { parseHostStatusLineStdin } from '../src/server/cli/statusline.js';
import {
  runReadOnlyHealthSweep,
  writeHealthSweepReportIfPermitted,
} from '../src/server/sidecar.js';
import { ErrorBoundary } from '../ui/src/components/ErrorBoundary.js';
import {
  DICTIONARIES,
  formatMessage,
  NovI18nProvider,
} from '../ui/src/i18n/index.js';
import { DiffViewer } from '../ui/src/modules/review/DiffViewer.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

describe('Defense 1: Write-Storm Suppression, Semantic Dirty Checks & Coalescing', () => {
  it('skips identical feed-snapshot rewrites via semantic hash and enforces minIntervalMs coalescing', async () => {
    await withTempDir('agy-nov-v122-feed-dirty-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data');
      const ws = path.join(tmpDir, 'ws');
      fs.mkdirSync(ws, { recursive: true });
      const cfg = applyPresetConfig(dataDir, 'core');
      const feedPath = getFeedSnapshotPath(dataDir);

      // 1. Initial write succeeds
      const first = writeFeedSnapshotIfDataDirExists(dataDir, cfg);
      assert.equal(first, true);
      assert.equal(fs.existsSync(feedPath), true);
      const mtime1 = fs.statSync(feedPath).mtimeMs;

      // 2. Second write with identical semantic state (different generatedAt) is skipped
      const second = writeFeedSnapshotIfDataDirExists(dataDir, cfg, {
        now: new Date(Date.now() + 60_000),
      });
      assert.equal(second, false, 'Identical semantic feed snapshot must not trigger redundant disk rewrite');
      assert.equal(fs.statSync(feedPath).mtimeMs, mtime1);

      // 3. minIntervalMs suppresses even state changes inside the coalesce window, unless force:true
      const nextCfg = setModuleEnabled(dataDir, 'turbo', true);
      const throttled = writeFeedSnapshotIfDataDirExists(dataDir, nextCfg, {
        minIntervalMs: 60_000,
      });
      assert.equal(throttled, false, 'minIntervalMs window must coalesce rapid feed writes');

      const forced = writeFeedSnapshotIfDataDirExists(dataDir, nextCfg, { force: true });
      assert.equal(forced, true, 'force:true must bypass coalesce window and persist updated state');

      // 4. Burst of 40 read-only PostToolUse hooks executes in milliseconds with zero review writes
      const reviewSignalPath = path.join(getModuleDataDir(dataDir, 'review'), 'review-signal.json');
      const t0 = Date.now();
      for (let i = 0; i < 40; i += 1) {
        await dispatchNovHook(
          {
            hookEventName: 'PostToolUse',
            conversationId: 'conv-burst-1',
            workspacePaths: [ws],
            toolCall: { name: 'read_file', args: { Path: path.join(ws, 'README.md') } },
          },
          'PostToolUse',
          dataDir,
        );
      }
      const elapsedMs = Date.now() - t0;
      assert.ok(elapsedMs < 1500, `40 PostToolUse calls should complete rapidly, took ${elapsedMs}ms`);
      assert.equal(
        fs.existsSync(reviewSignalPath),
        false,
        'Read-only PostToolUse burst must not create review-signal.json',
      );
    });
  });

  it('short-circuits review read-only hooks, truncates xray errors & coalesces bursts, deduplicates radar capsule, and coalesces verify edits', async () => {
    await withTempDir('agy-nov-v122-hooks-coalesce-', (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data');
      const ws = path.join(tmpDir, 'ws');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.mkdirSync(ws, { recursive: true });
      const fileA = path.join(ws, 'index.ts');
      fs.writeFileSync(fileA, 'export const a = 1;\n', 'utf8');

      // 1. Review hook: mutating edit writes once; subsequent read_file calls do not rewrite
      const reviewDir = getModuleDataDir(dataDir, 'review');
      handleReviewHook(
        normalizeHookPayload(
          {
            hookEventName: 'PostToolUse',
            conversationId: 'conv-r1',
            workspacePaths: [ws],
            toolCall: { name: 'read_file', args: { Path: fileA } },
          },
          'PostToolUse',
        ),
        dataDir,
      );
      assert.equal(fs.existsSync(reviewDir), false, 'Initial read_file must not create modules/review');

      handleReviewHook(
        normalizeHookPayload(
          {
            hookEventName: 'PostToolUse',
            conversationId: 'conv-r1',
            workspacePaths: [ws],
            toolCall: { name: 'edit_file', args: { Path: fileA } },
          },
          'PostToolUse',
        ),
        dataDir,
      );
      const signalPath = path.join(reviewDir, 'review-signal.json');
      assert.equal(fs.existsSync(signalPath), true);
      const reviewMtime = fs.statSync(signalPath).mtimeMs;

      for (let i = 0; i < 10; i += 1) {
        handleReviewHook(
          normalizeHookPayload(
            {
              hookEventName: 'PostToolUse',
              conversationId: 'conv-r1',
              workspacePaths: [ws],
              toolCall: { name: 'read_file', args: { Path: fileA } },
            },
            'PostToolUse',
          ),
          dataDir,
        );
      }
      assert.equal(readReviewSignal(reviewDir)?.changeCount, 1);
      assert.equal(fs.statSync(signalPath).mtimeMs, reviewMtime);

      // 2. X-Ray hook: truncates oversized errors and coalesces repeated identical PostToolUse calls
      const xrayDir = getModuleDataDir(dataDir, 'xray');
      handleXrayHook(
        normalizeHookPayload(
          {
            hookEventName: 'PostToolUse',
            conversationId: 'conv-x1',
            toolCall: { name: 'read_file', args: {} },
          },
          'PostToolUse',
        ),
        dataDir,
      );
      const xrayStatePath = path.join(xrayDir, 'live-state.json');
      const xrayEventsBefore = readLiveHookState(xrayDir).recentEvents.length;
      for (let i = 0; i < 10; i += 1) {
        handleXrayHook(
          normalizeHookPayload(
            {
              hookEventName: 'PostToolUse',
              conversationId: 'conv-x1',
              toolCall: { name: 'read_file', args: {} },
            },
            'PostToolUse',
          ),
          dataDir,
        );
      }
      assert.equal(
        readLiveHookState(xrayDir).recentEvents.length,
        xrayEventsBefore,
        'Identical rapid PostToolUse calls within 2s should coalesce',
      );
      // Error events always persist and truncate cleanly to <= 512 chars
      handleXrayHook(
        normalizeHookPayload(
          {
            hookEventName: 'PostToolUse',
            conversationId: 'conv-x1',
            toolCall: { name: 'read_file', args: {} },
            error: 'E'.repeat(5000),
          },
          'PostToolUse',
        ),
        dataDir,
      );
      const latestXrayEvt = readLiveHookState(xrayDir).recentEvents.at(-1);
      assert.ok(latestXrayEvt?.error && latestXrayEvt.error.length <= 512);
      assert.equal(fs.existsSync(xrayStatePath), true);

      // 3. Radar status-capsule dirty check skips redundant second write when counts/attention unchanged
      const radarDir = getModuleDataDir(dataDir, 'radar');
      recordRadarSessionEvent(radarDir, {
        conversationId: 'conv-rad-1',
        event: 'PostToolUse',
        workspaceRoot: ws,
        toolName: 'read_file',
      });
      const capsulePath = getRadarStatusCapsulePath(radarDir);
      const capsuleRaw1 = fs.readFileSync(capsulePath, 'utf8');
      recordRadarSessionEvent(radarDir, {
        conversationId: 'conv-rad-1',
        event: 'PostToolUse',
        workspaceRoot: ws,
        toolName: 'grep_search',
      });
      const capsuleRaw2 = fs.readFileSync(capsulePath, 'utf8');
      assert.equal(
        capsuleRaw2,
        capsuleRaw1,
        'Radar status-capsule.json should not be rewritten when counts and attention are semantically unchanged',
      );

      // 4. Verify PostToolUse coalesces repeated edits to the same already-dirty file within 2s
      const verifyDir = getModuleDataDir(dataDir, 'verify');
      handleVerifyPostToolHook(
        normalizeHookPayload(
          {
            hookEventName: 'PostToolUse',
            conversationId: 'conv-ver-1',
            workspacePaths: [ws],
            toolCall: { name: 'edit_file', args: { Path: fileA } },
          },
          'PostToolUse',
        ),
        dataDir,
      );
      const verifyStatePath = getVerifyStatePath(verifyDir);
      const verifyRaw1 = fs.readFileSync(verifyStatePath, 'utf8');
      handleVerifyPostToolHook(
        normalizeHookPayload(
          {
            hookEventName: 'PostToolUse',
            conversationId: 'conv-ver-1',
            workspacePaths: [ws],
            toolCall: { name: 'edit_file', args: { Path: fileA } },
          },
          'PostToolUse',
        ),
        dataDir,
      );
      assert.equal(
        fs.readFileSync(verifyStatePath, 'utf8'),
        verifyRaw1,
        'Repeated rapid edits to an already-dirty non-empty file should coalesce verify state rewrites',
      );

      // 5. Guard atomic blob write leaves zero .tmp artifacts
      const guardDir = getModuleDataDir(dataDir, 'guard');
      const policy = loadPolicy(guardDir);
      const snap = capturePreEditSnapshot({
        dataDir: guardDir,
        workspaceRoot: ws,
        filePath: fileA,
        toolName: 'edit_file',
        reason: 'atomic-blob-test',
        policy,
      });
      assert.ok(snap);
      const blobEntries = fs.readdirSync(path.join(guardDir, 'blobs'));
      assert.ok(blobEntries.some((n) => n.endsWith('.blob')));
      assert.equal(blobEntries.some((n) => n.endsWith('.tmp')), false);
    });
  });

  it('prevents Radar/Xray alternating-tool write storms, skips unchanged sidecar reports, and avoids concurrent Guard blob GC races', async () => {
    await withTempDir('agy-nov-v122-hardened-writes-', (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data');
      const ws = path.join(tmpDir, 'ws');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.mkdirSync(ws, { recursive: true });
      applyPresetConfig(dataDir, 'power');

      // 1. X-Ray coalesces alternating different tools within 2s window (e.g. read_file -> grep_search -> view_file)
      const xrayDir = getModuleDataDir(dataDir, 'xray');
      handleXrayHook(
        normalizeHookPayload(
          { hookEventName: 'PostToolUse', conversationId: 'conv-alt', toolCall: { name: 'read_file', args: {} } },
          'PostToolUse',
        ),
        dataDir,
      );
      const xrayCountBefore = readLiveHookState(xrayDir).recentEvents.length;
      for (const tool of ['grep_search', 'view_file', 'list_dir', 'read_file']) {
        handleXrayHook(
          normalizeHookPayload(
            { hookEventName: 'PostToolUse', conversationId: 'conv-alt', toolCall: { name: tool, args: {} } },
            'PostToolUse',
          ),
          dataDir,
        );
      }
      assert.equal(
        readLiveHookState(xrayDir).recentEvents.length,
        xrayCountBefore,
        'X-Ray PostToolUse burst with alternating tools must coalesce within 2s',
      );

      // 2. Radar handleRadarHook coalesces PreToolUse/PostToolUse bursts within 2s on same running session
      const radarDir = getModuleDataDir(dataDir, 'radar');
      const boardPath = getRadarBoardPath(radarDir);
      const prevNoNotify = process.env.AGY_NOV_NO_NOTIFY;
      process.env.AGY_NOV_NO_NOTIFY = '1';
      try {
        handleRadarHook(
          normalizeHookPayload(
            { conversationId: 'conv-rad-burst', workspaceRoot: ws, toolName: 'read_file' },
            'PreToolUse',
          ),
          dataDir,
        );
        const boardRaw1 = fs.readFileSync(boardPath, 'utf8');
        for (let i = 0; i < 15; i += 1) {
          handleRadarHook(
            normalizeHookPayload(
              { conversationId: 'conv-rad-burst', workspaceRoot: ws, toolName: 'read_file' },
              'PostToolUse',
            ),
            dataDir,
          );
          handleRadarHook(
            normalizeHookPayload(
              { conversationId: 'conv-rad-burst', workspaceRoot: ws, toolName: `tool_${i}` },
              'PreToolUse',
            ),
            dataDir,
          );
        }
        assert.equal(
          fs.readFileSync(boardPath, 'utf8'),
          boardRaw1,
          'Radar hook must coalesce rapid running Pre/PostToolUse bursts without rewriting board.json',
        );
      } finally {
        if (prevNoNotify === undefined) delete process.env.AGY_NOV_NO_NOTIFY;
        else process.env.AGY_NOV_NO_NOTIFY = prevNoNotify;
      }

      // 3. Sidecar health-sweep.json semantic dirty check skips redundant atomic rewrite
      const sweep1 = runReadOnlyHealthSweep({ workspaceRoot: ws, dataDir });
      const write1 = writeHealthSweepReportIfPermitted(dataDir, sweep1);
      assert.equal(write1.written, true);
      const sweep2 = { ...sweep1, generatedAt: new Date(Date.now() + 60_000).toISOString() };
      const write2 = writeHealthSweepReportIfPermitted(dataDir, sweep2);
      assert.equal(write2.written, false);
      assert.equal(write2.unchanged, true);

      // 4. Guard targeted blob GC removes ONLY evicted snapshot blobs and NEVER deletes concurrent in-flight blobs
      const guardDir = getModuleDataDir(dataDir, 'guard');
      const policy = { ...loadPolicy(guardDir), maxSnapshotsPerFile: 2 };
      const targetFile = path.join(ws, 'app.ts');
      fs.writeFileSync(targetFile, 'v1\n', 'utf8');
      const snap1 = capturePreEditSnapshot({
        dataDir: guardDir,
        workspaceRoot: ws,
        filePath: targetFile,
        toolName: 'edit_file',
        reason: 's1',
        policy,
        turnKey: 'turn-1',
      });
      assert.ok(snap1);

      // Simulate a concurrent hook process having just written an unregistered blob before updating snapshots.json
      const concurrentHash = 'a'.repeat(64);
      const concurrentBlobPath = path.join(guardDir, 'blobs', `${concurrentHash}.blob`);
      fs.writeFileSync(concurrentBlobPath, 'in-flight-concurrent-blob', { mode: 0o600 });

      fs.writeFileSync(targetFile, 'v2\n', 'utf8');
      capturePreEditSnapshot({
        dataDir: guardDir,
        workspaceRoot: ws,
        filePath: targetFile,
        toolName: 'edit_file',
        reason: 's2',
        policy,
        turnKey: 'turn-2',
      });
      fs.writeFileSync(targetFile, 'v3\n', 'utf8');
      capturePreEditSnapshot({
        dataDir: guardDir,
        workspaceRoot: ws,
        filePath: targetFile,
        toolName: 'edit_file',
        reason: 's3',
        policy,
        turnKey: 'turn-3',
      });

      assert.equal(
        fs.existsSync(path.join(guardDir, 'blobs', `${snap1.sha256}.blob`)),
        false,
        'Evicted snapshot blob must be garbage-collected',
      );
      assert.equal(
        fs.existsSync(concurrentBlobPath),
        true,
        'Targeted GC must NEVER delete unregistered in-flight blobs written by concurrent sessions',
      );
    });
  });

  it('skips redundant rewrites in atomicWriteJson, saveNovConfig, saveTurboPrefs, last-raw.log, and coalesces Turbo hotspot bursts', async () => {
    await withTempDir('agy-nov-v122-fs-config-turbo-', (tmpDir) => {
      // 1. atomicWriteJson: identical content & ignoreTopLevelKeys skip disk rewrite; permission loosening still rewrites
      const jsonFile = path.join(tmpDir, 'state', 'sample.json');
      assert.equal(atomicWriteJson(jsonFile, { a: 1, updatedAt: '2026-11-28T00:00:00.000Z' }), true);
      const st1 = fs.statSync(jsonFile);

      assert.equal(atomicWriteJson(jsonFile, { a: 1, updatedAt: '2026-11-28T00:00:00.000Z' }), false);
      const st2 = fs.statSync(jsonFile);
      assert.equal(st2.ino, st1.ino);
      assert.equal(st2.mtimeMs, st1.mtimeMs);

      assert.equal(
        atomicWriteJson(
          jsonFile,
          { a: 1, updatedAt: '2026-11-28T01:00:00.000Z' },
          { ignoreTopLevelKeys: ['updatedAt'] },
        ),
        false,
        'ignoreTopLevelKeys must skip rewrite when only ignored metadata keys differ',
      );
      assert.equal(fs.statSync(jsonFile).ino, st1.ino);

      assert.equal(
        atomicWriteJson(
          jsonFile,
          { a: 2, updatedAt: '2026-11-28T01:00:00.000Z' },
          { ignoreTopLevelKeys: ['updatedAt'] },
        ),
        true,
        'Semantic change must still persist via atomicWriteJson',
      );
      const st3 = fs.statSync(jsonFile);
      assert.equal((JSON.parse(fs.readFileSync(jsonFile, 'utf8')) as { a: number }).a, 2);

      if (process.platform !== 'win32') {
        fs.chmodSync(jsonFile, 0o644);
        assert.equal(
          atomicWriteJson(jsonFile, { a: 2, updatedAt: '2026-11-28T01:00:00.000Z' }),
          true,
          'Non-0600 file must rewrite to restore private permissions',
        );
        assert.equal(fs.statSync(jsonFile).mode & 0o777, 0o600);
      }

      // 2. saveNovConfig: creates on first write, skips semantic duplicates (preserving inode & updatedAt), writes real changes
      const dataDir = path.join(tmpDir, 'nov-data');
      const cfgPath = getConfigPath(dataDir);
      assert.equal(fs.existsSync(cfgPath), false);

      const initialCfg = saveNovConfig(dataDir, createDefaultConfig());
      assert.equal(fs.existsSync(cfgPath), true);
      const cfgStat1 = fs.statSync(cfgPath);
      const cfgRaw1 = fs.readFileSync(cfgPath, 'utf8');

      const noopSave = saveNovConfig(dataDir, {
        ...initialCfg,
        updatedAt: '2099-01-01T00:00:00.000Z',
      });
      assert.equal(noopSave.updatedAt, initialCfg.updatedAt);
      assert.equal(fs.statSync(cfgPath).ino, cfgStat1.ino);
      assert.equal(fs.readFileSync(cfgPath, 'utf8'), cfgRaw1);

      const noopPreset = applyPresetConfig(dataDir, 'core');
      assert.equal(noopPreset.updatedAt, initialCfg.updatedAt);
      assert.equal(fs.statSync(cfgPath).ino, cfgStat1.ino);

      const changedLocale = setNovLocale(dataDir, 'zh-CN');
      assert.equal(changedLocale.locale, 'zh-CN');
      assert.equal(loadNovConfigReadOnly(dataDir).locale, 'zh-CN');
      assert.notEqual(fs.readFileSync(cfgPath, 'utf8'), cfgRaw1);

      // 3. saveTurboPrefs: first write creates file, duplicate value skips rewrite, symlink still rejected even for autoRtk:false
      const turboDir = getModuleDataDir(dataDir, 'turbo');
      const prefsPath = path.join(turboDir, 'prefs.json');
      const prefs1 = saveTurboPrefs(turboDir, { autoRtk: false });
      assert.equal(fs.existsSync(prefsPath), true);
      const prefsStat1 = fs.statSync(prefsPath);
      const prefs2 = saveTurboPrefs(turboDir, { autoRtk: false });
      assert.equal(prefs2.updatedAt, prefs1.updatedAt);
      assert.equal(fs.statSync(prefsPath).ino, prefsStat1.ino);

      const prefs3 = saveTurboPrefs(turboDir, { autoRtk: true });
      assert.equal(prefs3.autoRtk, true);
      assert.equal((JSON.parse(fs.readFileSync(prefsPath, 'utf8')) as { autoRtk: boolean }).autoRtk, true);

      const symTurboDir = path.join(tmpDir, 'sym-turbo');
      const outsidePrefs = path.join(tmpDir, 'outside-prefs.json');
      fs.mkdirSync(symTurboDir, { recursive: true });
      fs.writeFileSync(outsidePrefs, '{"schemaVersion":1,"autoRtk":false,"updatedAt":"2026-11-28T00:00:00Z"}\n');
      fs.symlinkSync(outsidePrefs, path.join(symTurboDir, 'prefs.json'));
      assert.throws(
        () => saveTurboPrefs(symTurboDir, { autoRtk: false }),
        /symlink|non-regular/i,
        'Symlink defense must never be bypassed by semantic dirty check',
      );

      // 4. writeRedactedRawLogIfDataDirExists (via executeSafeCompactRun): identical output skips last-raw.log rewrite
      const repoDir = path.join(tmpDir, 'git-repo');
      fs.mkdirSync(repoDir, { recursive: true });
      execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoDir, 'a.txt'), 'hello\n', 'utf8');
      const payloadB64 = Buffer.from(
        JSON.stringify({ v: 1, executable: 'git', args: ['status', '--short'], preset: 'git' }),
        'utf8',
      ).toString('base64url');
      const run1 = executeSafeCompactRun({ payloadB64, cwd: repoDir, dataDir });
      assert.ok(run1.rawLogPath && fs.existsSync(run1.rawLogPath));
      const rawStat1 = fs.statSync(run1.rawLogPath);
      const run2 = executeSafeCompactRun({ payloadB64, cwd: repoDir, dataDir });
      assert.equal(run2.rawLogPath, run1.rawLogPath);
      assert.equal(fs.statSync(run1.rawLogPath).ino, rawStat1.ino);
      assert.equal(fs.statSync(run1.rawLogPath).mtimeMs, rawStat1.mtimeMs);

      // 5. recordTurboHotspot: deduplicates identical commands in 2s, preserves distinct initial counts, and coalesces high-frequency bursts (count >= 5)
      const hotspotsPath = path.join(turboDir, 'hotspots.json');
      recordTurboHotspot(turboDir, 'git status --short', dataDir);
      const hsStat1 = fs.statSync(hotspotsPath);
      const hsRaw1 = fs.readFileSync(hotspotsPath, 'utf8');
      for (let i = 0; i < 20; i += 1) {
        recordTurboHotspot(turboDir, 'git status --short', dataDir);
      }
      assert.equal(fs.statSync(hotspotsPath).ino, hsStat1.ino);
      assert.equal(fs.readFileSync(hotspotsPath, 'utf8'), hsRaw1);
      assert.equal(loadTurboHotspotsReadOnly(turboDir).find((h) => h.commandPrefix === 'git status')?.count, 1);

      // Distinct args under the same prefix still record accurately until established (count >= 5), then coalesce within 2s
      for (let i = 1; i <= 5; i += 1) {
        recordTurboHotspot(turboDir, `git diff src/file-${i}.ts`, dataDir);
      }
      assert.equal(loadTurboHotspotsReadOnly(turboDir).find((h) => h.commandPrefix === 'git diff')?.count, 5);
      const hsStat5 = fs.statSync(hotspotsPath);
      const hsRaw5 = fs.readFileSync(hotspotsPath, 'utf8');
      for (let i = 6; i <= 25; i += 1) {
        recordTurboHotspot(turboDir, `git diff src/file-${i}.ts`, dataDir);
      }
      assert.equal(fs.statSync(hotspotsPath).ino, hsStat5.ino);
      assert.equal(fs.readFileSync(hotspotsPath, 'utf8'), hsRaw5);
      assert.equal(loadTurboHotspotsReadOnly(turboDir).find((h) => h.commandPrefix === 'git diff')?.count, 5);
    });
  });

  it('suppresses 3-session concurrent ping-pong write storms across Radar/Review/Xray, skips unchanged top-20 Turbo hotspots, and applies store dirty checks', async () => {
    await withTempDir('agy-nov-v122-concurrent-storms-', (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data');
      const ws = path.join(tmpDir, 'ws');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.mkdirSync(ws, { recursive: true });

      const prevNoNotify = process.env.AGY_NOV_NO_NOTIFY;
      process.env.AGY_NOV_NO_NOTIFY = '1';
      try {
        // 1. Radar realistic alternating Pre(tool_i) -> Post(tool_i) sequence (20 calls) must coalesce to <= 2 writes
        const radarDir = getModuleDataDir(dataDir, 'radar');
        const boardPath = getRadarBoardPath(radarDir);
        let radarWrites = 0;
        let lastIno = 0;
        for (let i = 0; i < 10; i += 1) {
          for (const ev of ['PreToolUse', 'PostToolUse'] as const) {
            handleRadarHook(
              normalizeHookPayload(
                { conversationId: 'conv-realistic', workspaceRoot: ws, toolName: `tool_${i}` },
                ev,
              ),
              dataDir,
            );
            const ino = fs.statSync(boardPath).ino;
            if (ino !== lastIno) {
              radarWrites += 1;
              lastIno = ino;
            }
          }
        }
        assert.ok(
          radarWrites <= 2,
          `Realistic 20-hook Radar sequence should coalesce to <= 2 writes, observed ${radarWrites}`,
        );
      } finally {
        if (prevNoNotify === undefined) delete process.env.AGY_NOV_NO_NOTIFY;
        else process.env.AGY_NOV_NO_NOTIFY = prevNoNotify;
      }

      // 2. Review: 3 concurrent sessions alternating read_file must produce 0 extra writes; rapid mutating loops coalesce
      const reviewDir = getModuleDataDir(dataDir, 'review');
      const reviewSignalPath = path.join(reviewDir, 'review-signal.json');
      handleReviewHook(
        normalizeHookPayload(
          { conversationId: 'conv-A', workspacePaths: [ws], toolCall: { name: 'edit_file', args: {} } },
          'PostToolUse',
        ),
        dataDir,
      );
      const revIno1 = fs.statSync(reviewSignalPath).ino;
      for (let i = 0; i < 15; i += 1) {
        const cid = ['conv-A', 'conv-B', 'conv-C'][i % 3];
        handleReviewHook(
          normalizeHookPayload(
            { conversationId: cid, workspacePaths: [ws], toolCall: { name: 'read_file', args: {} } },
            'PostToolUse',
          ),
          dataDir,
        );
      }
      assert.equal(
        fs.statSync(reviewSignalPath).ino,
        revIno1,
        '3-session read-only ping-pong must never rewrite review-signal.json',
      );
      for (let i = 0; i < 15; i += 1) {
        const cid = ['conv-A', 'conv-B', 'conv-C'][i % 3];
        handleReviewHook(
          normalizeHookPayload(
            { conversationId: cid, workspacePaths: [ws], toolCall: { name: 'run_command', args: {} } },
            'PostToolUse',
          ),
          dataDir,
        );
      }
      assert.equal(
        fs.statSync(reviewSignalPath).ino,
        revIno1,
        'Rapid mutating PostToolUse burst within 1.5s must coalesce review-signal.json',
      );

      // 3. X-Ray: 3 concurrent sessions alternating 18 PostToolUse events write at most once per newly seen session (<= 3)
      const xrayDir = getModuleDataDir(dataDir, 'xray');
      const xrayStatePath = path.join(xrayDir, 'live-state.json');
      let xrayWrites = 0;
      let lastXrayIno = 0;
      for (let i = 0; i < 18; i += 1) {
        const cid = ['conv-A', 'conv-B', 'conv-C'][i % 3];
        handleXrayHook(
          normalizeHookPayload(
            { conversationId: cid, toolCall: { name: `read_${i}`, args: {} } },
            'PostToolUse',
          ),
          dataDir,
        );
        const ino = fs.statSync(xrayStatePath).ino;
        if (ino !== lastXrayIno) {
          xrayWrites += 1;
          lastXrayIno = ino;
        }
      }
      assert.ok(
        xrayWrites <= 3,
        `3-session X-Ray ping-pong must register each session once and coalesce subsequent bursts (<= 3 writes), got ${xrayWrites}`,
      );

      // 4. Turbo hotspots: when top-20 is full and a low-frequency 21st command does not enter top-20, skip disk rewrite
      const turboDir = getModuleDataDir(dataDir, 'turbo');
      fs.mkdirSync(turboDir, { recursive: true, mode: 0o700 });
      const hsPath = path.join(turboDir, 'hotspots.json');
      const seededTop20 = Array.from({ length: 20 }, (_, i) => ({
        commandPrefix: `top-cmd-${i}`,
        count: 10 + i,
        lastCommand: `top-cmd-${i} --flag`,
        estimatedWasteTokens: 12_000,
        lastSeenAt: new Date(Date.now() - 10_000).toISOString(),
      }));
      fs.writeFileSync(
        hsPath,
        `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), items: seededTop20 }, null, 2)}\n`,
        { mode: 0o600 },
      );
      const hsFullIno = fs.statSync(hsPath).ino;
      recordTurboHotspot(turboDir, 'git status --short', dataDir);
      assert.equal(
        fs.statSync(hsPath).ino,
        hsFullIno,
        'Unchanged top-20 hotspots must skip rewriting hotspots.json',
      );

      // 5. Pointed stores skip identical semantic rewrites (Guard policy, Spec state, Verify state, Review annotations)
      const guardDir = getModuleDataDir(dataDir, 'guard');
      savePolicy(guardDir, { permissionMode: 'balanced-dev' });
      const guardPolicyPath = path.join(guardDir, 'policy.json');
      const guardIno1 = fs.statSync(guardPolicyPath).ino;
      savePolicy(guardDir, { permissionMode: 'balanced-dev' });
      assert.equal(fs.statSync(guardPolicyPath).ino, guardIno1, 'Identical savePolicy must skip rewrite');

      const specDir = getModuleDataDir(dataDir, 'spec');
      const specState1 = saveSpecState(specDir, loadSpecStateReadOnly(specDir));
      const specPath = getSpecStatePath(specDir);
      const specIno1 = fs.statSync(specPath).ino;
      saveSpecState(specDir, specState1);
      assert.equal(fs.statSync(specPath).ino, specIno1, 'Identical saveSpecState must skip rewrite');

      const verifyDir = getModuleDataDir(dataDir, 'verify');
      const verifyState1 = saveVerifyState(verifyDir, loadVerifyStateReadOnly(verifyDir));
      const verifyPath = getVerifyStatePath(verifyDir);
      const verifyIno1 = fs.statSync(verifyPath).ino;
      saveVerifyState(verifyDir, verifyState1);
      assert.equal(fs.statSync(verifyPath).ino, verifyIno1, 'Identical saveVerifyState must skip rewrite');

      const annStore = new AnnotationStore(reviewDir);
      annStore.setFileViewed('repo-dirty-check', 'working', 'src/index.ts', true);
      const annFile = path.join(reviewDir, 'sessions', 'repo-dirty-check.json');
      const annIno1 = fs.statSync(annFile).ino;
      annStore.setFileViewed('repo-dirty-check', 'working', 'src/index.ts', true);
      assert.equal(
        fs.statSync(annFile).ino,
        annIno1,
        'Identical Review AnnotationStore state (ignoring updatedAt) must skip rewrite',
      );
    });
  });
});

describe('Defense 2 & 3: Oversized/Corrupt Sessions, 600KB Single-Step Tail, Hook Caps & SQLite Safety', () => {
  it('handles oversized transcripts via bounded head+tail sampling, caps 3,000+ step payloads, and skips corrupt entries gracefully', async () => {
    await withTempDir('agy-nov-v122-oversized-', (tmpDir) => {
      const brainRoot = path.join(tmpDir, 'brain');
      const bigSessionDir = path.join(brainRoot, 'sess-oversized');
      const bigLogsDir = path.join(bigSessionDir, '.system_generated', 'logs');
      fs.mkdirSync(bigLogsDir, { recursive: true });

      const bigTranscript = path.join(bigLogsDir, 'transcript.jsonl');
      const lines: string[] = [
        JSON.stringify({
          step_index: 1,
          type: 'USER_INPUT',
          content: '<USER_REQUEST>Investigate huge 95MB Antigravity session stability</USER_REQUEST>',
          created_at: '2026-11-28T00:00:00Z',
        }),
        '{{{CORRUPT_JSON_LINE_MUST_NOT_CRASH',
      ];
      // Add ~350 turns and 300+ files to exceed returned caps while keeping test fast
      for (let i = 0; i < 260; i += 1) {
        lines.push(
          JSON.stringify({
            step_index: i * 2 + 2,
            type: 'PLANNER_RESPONSE',
            model: 'gemini-2.5-pro',
            input_tokens: 12_000 + i * 10,
            cache_read_tokens: 9_000,
            output_tokens: 400,
            content: `Step ${i} padding ${'x'.repeat(2400)}`,
            tool_calls: [{ name: 'read_file', args: { Path: `/workspace/src/file-${i}.ts` } }],
            created_at: '2026-11-28T00:01:00Z',
          }),
        );
      }
      fs.writeFileSync(bigTranscript, `${lines.join('\n')}\n`, 'utf8');

      // Trigger oversized bounded sampling explicitly using a small maxFullBytes threshold
      const sampled = parseTranscriptFile(bigTranscript, {
        sessionId: 'sess-oversized',
        brainDir: bigSessionDir,
        maxFullBytes: 128 * 1024,
      });
      assert.ok(sampled.summary.title.includes('Investigate huge 95MB'));
      assert.ok(
        sampled.diagnostics.some(
          (d) => /Large Transcript Bounded Sampling/i.test(d.title) && /128 KiB/.test(d.detail),
        ),
        'Expected bounded sampling diagnostic notice reflecting actual maxFullBytes limit',
      );
      assert.ok(sampled.turns.length <= 200, 'Returned turns must stay capped at <= 200');
      assert.ok(sampled.recentSteps.length <= 60, 'Returned recentSteps must stay capped at <= 60');
      assert.ok(sampled.fileActivity.length <= 300, 'Returned fileActivity must stay capped at <= 300');

      // Symlinked transcript.jsonl must be refused rather than followed
      const symTranscript = path.join(tmpDir, 'sym-transcript.jsonl');
      fs.symlinkSync(bigTranscript, symTranscript);
      const symParsed = parseTranscriptFile(symTranscript, { sessionId: 'sess-sym', brainDir: bigSessionDir });
      assert.equal(symParsed.summary.steps, 0, 'Symlinked transcript must be refused cleanly');

      // Corrupt/unreadable session directory alongside valid one
      const corruptDir = path.join(brainRoot, 'sess-corrupt');
      const corruptLogs = path.join(corruptDir, '.system_generated', 'logs');
      fs.mkdirSync(corruptLogs, { recursive: true });
      fs.writeFileSync(path.join(corruptLogs, 'transcript.jsonl'), 'not valid json\n{broken', 'utf8');

      const entries = discoverTranscriptEntries({ brainDirs: [{ dir: brainRoot, source: 'desktop' }] });
      assert.equal(entries.length, 2);
      const loaded = loadSessionDetail('sess-corrupt', { brainDirs: [{ dir: brainRoot, source: 'desktop' }] });
      assert.ok(loaded, 'Corrupt JSONL lines should degrade to empty metrics rather than throwing');
      assert.equal(loaded.summary.steps, 0);

      const hits = searchSessions('stability', { brainDirs: [{ dir: brainRoot, source: 'desktop' }] });
      assert.ok(hits.length >= 1);
    });
  });

  it('recovers 600KB+ single trailing JSONL steps via adaptive tail window in both live-stream and mem Stop hook', async () => {
    await withTempDir('agy-nov-v122-600kb-step-', (tmpDir) => {
      const brainRoot = path.join(tmpDir, 'brain');
      const convId = 'conv-600kb-step';
      const logsDir = path.join(brainRoot, convId, '.system_generated', 'logs');
      fs.mkdirSync(logsDir, { recursive: true });
      const transcriptPath = path.join(logsDir, 'transcript.jsonl');

      const headLine = JSON.stringify({
        step_index: 1,
        type: 'USER_INPUT',
        content: 'Start session',
        created_at: '2026-11-28T00:00:00Z',
      });
      // Build a ~620 KB single trailing line (> 256 KiB default tail buffer)
      const hugeStepLine = JSON.stringify({
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        content: `Finished editing ${'A'.repeat(620 * 1024)}`,
        tool_calls: [
          {
            name: 'edit_file',
            args: { Path: path.join(tmpDir, 'src', 'huge-step-target.ts') },
          },
        ],
        created_at: '2026-11-28T00:02:00Z',
      });
      fs.writeFileSync(transcriptPath, `${headLine}\n${hugeStepLine}\n`, 'utf8');

      const stream = readConversationLiveStream(convId, { brainDirs: [brainRoot] });
      assert.equal(stream.found, true);
      assert.ok(
        stream.events.length >= 1,
        'Adaptive tail window must recover a 620 KB trailing step instead of returning empty',
      );

      const editedFiles = extractEditedFilesFromTranscript(transcriptPath);
      assert.ok(
        editedFiles.some((p) => p.endsWith('huge-step-target.ts')),
        'Mem hook adaptive tail window must recover edited file from 620 KB trailing step',
      );
    });
  });

  it('clamps oversized hook outputs, rejects oversized ConversationService RPC responses, and degrades cleanly on corrupt SQLite DBs', async () => {
    const clamped = clampHookResult({
      decision: 'deny',
      reason: 'R'.repeat(10_000),
      errorMessage: 'E'.repeat(10_000),
      injectSteps: [{ systemMessage: { systemMessage: 'S'.repeat(40_000) } }],
    });
    assert.ok(Buffer.byteLength(clamped.reason ?? '', 'utf8') <= 4096);
    assert.ok(Buffer.byteLength(clamped.errorMessage ?? '', 'utf8') <= 4096);
    assert.ok(Buffer.byteLength(JSON.stringify(clamped.injectSteps), 'utf8') <= 24 * 1024);

    // UTF-8 byte cap for CJK + UTF-16 surrogate pair safety + strict step ordering on truncation
    const cjkClamped = clampHookResult({ reason: '中'.repeat(4096) });
    assert.ok(
      Buffer.byteLength(cjkClamped.reason ?? '', 'utf8') <= 4096,
      'CJK reason must stay within 4096 UTF-8 bytes',
    );
    const emojiClamped = clampHookResult({ reason: `a${'😀'.repeat(2100)}` });
    assert.ok(Buffer.byteLength(emojiClamped.reason ?? '', 'utf8') <= 4096);
    assert.equal(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
        emojiClamped.reason ?? '',
      ),
      false,
      'UTF-8 truncation must never split UTF-16 surrogate pairs',
    );
    const orderedSteps = clampHookResult({
      injectSteps: [
        { id: 1, payload: 'a'.repeat(10_000) },
        { id: 2, payload: 'b'.repeat(20_000) },
        { id: 3, payload: 'c'.repeat(5_000) },
      ],
    });
    const keptIds = (orderedSteps.injectSteps as Array<{ id?: number }>).map((s) => s.id).filter(Boolean);
    assert.deepEqual(
      keptIds,
      [1],
      'injectSteps truncation must preserve ordering and never skip step 2 to include step 3',
    );
    assert.ok(Buffer.byteLength(JSON.stringify(orderedSteps.injectSteps), 'utf8') <= 24 * 1024);

    // Oversized ConversationService RPC response (> 4 MiB) rejected cleanly
    const bigServer = http.createServer((_req, res) => {
      const payload = `{"conversations":[{"id":"x","blob":"${'z'.repeat(4_500_000)}"}]}`;
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(payload, 'utf8')),
      });
      res.end(payload);
    });
    await new Promise<void>((resolve) => bigServer.listen(0, '127.0.0.1', () => resolve()));
    const bigPort = (bigServer.address() as { port: number }).port;
    try {
      const rpcRes = await listHostConversationsReadOnly({
        lsAddress: `127.0.0.1:${bigPort}`,
        csrfToken: 'tok-test',
      });
      assert.equal(rpcRes.ok, false);
      assert.match(rpcRes.reason ?? '', /safety cap/i);
    } finally {
      await new Promise<void>((done) => bigServer.close(() => done()));
    }

    // Oversized chunked ConversationService RPC response (NO Content-Length header) aborted during streaming
    const chunkedBigServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"conversations":[{"id":"stream","blob":"');
      const chunk = 'q'.repeat(256 * 1024);
      for (let i = 0; i < 20; i += 1) {
        res.write(chunk);
      }
      res.end('"}]}');
    });
    await new Promise<void>((resolve) => chunkedBigServer.listen(0, '127.0.0.1', () => resolve()));
    const chunkedPort = (chunkedBigServer.address() as { port: number }).port;
    try {
      const rpcRes = await listHostConversationsReadOnly({
        lsAddress: `127.0.0.1:${chunkedPort}`,
        csrfToken: 'tok-test',
      });
      assert.equal(rpcRes.ok, false);
      assert.match(rpcRes.reason ?? '', /safety cap/i);
    } finally {
      await new Promise<void>((done) => chunkedBigServer.close(() => done()));
    }

    // RemoteGateway /api/state degrades gracefully when ConversationClient throws
    await withTempDir('agy-nov-v122-gateway-degrade-', async (tmpDir) => {
      const remoteDir = path.join(tmpDir, 'remote');
      const throwingClient = {
        listConversations: async () => {
          throw new Error('Simulated corrupt conversation summary db');
        },
        createConversation: async () => {
          throw new Error('unavailable');
        },
      } as unknown as ConversationClient;
      const gw = new RemoteGateway(remoteDir, throwingClient, { demoMode: false });
      const status = await gw.start(0);
      try {
        const port = gw.getActualPort();
        const res = await fetch(`http://127.0.0.1:${port}/api/state`, {
          headers: {
            Host: `127.0.0.1:${port}`,
            Authorization: `Bearer ${gw.getConfig().pairingToken}`,
          },
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { conversations: unknown[]; approvals: unknown[] };
        assert.deepEqual(body.conversations, []);
        assert.ok(Array.isArray(body.approvals));
        assert.equal(status.running, true);
      } finally {
        await gw.stop();
      }
    });

    // Corrupt SQLite DB file with valid 16-byte header + corrupted pages degrades cleanly
    await withTempDir('agy-nov-v122-corrupt-sqlite-', async (tmpDir) => {
      const corruptDb = path.join(tmpDir, 'corrupt.db');
      const header = Buffer.alloc(4096, 0xff);
      header.write('SQLite format 3\0', 0, 'ascii');
      header.writeUInt16BE(4096, 16);
      fs.writeFileSync(corruptDb, header);

      let threwErr: unknown = null;
      let fallbackResult: Awaited<ReturnType<typeof inspectSqliteDatabase>> | null = null;
      try {
        fallbackResult = await inspectSqliteDatabase(
          tmpDir,
          corruptDb,
          'corrupt.db',
          header.byteLength,
          undefined,
          undefined,
          20,
          'sqlite3',
        );
      } catch (err) {
        threwErr = err;
      }
      if (threwErr) {
        assert.match(String(threwErr instanceof Error ? threwErr.message : threwErr), /corrupt|malformed|SQLite/i);
      } else {
        // Environments without sqlite3 CLI on PATH (e.g., default Windows CI runners) degrade cleanly to header-only metadata
        assert.equal(fallbackResult?.sqlite?.sqliteCliAvailable, false);
      }
    });

    // WAL-mode SQLite DB inside a read-only directory (no -shm file): auto-falls back to immutable=1 URI with zero writes
    if (process.platform !== 'win32') {
      await withTempDir('agy-nov-v122-wal-ro-dir-', async (tmpDir) => {
        const roDir = path.join(tmpDir, 'ro-db-dir');
        fs.mkdirSync(roDir, { recursive: true });
        const walDb = path.join(roDir, 'wal-sample.db');
        let hasSqliteCli = true;
        try {
          execFileSync(
            'sqlite3',
            [walDb, "PRAGMA journal_mode=WAL; CREATE TABLE items(id INT, label TEXT); INSERT INTO items VALUES (1, 'alpha');"],
            { stdio: 'ignore' },
          );
        } catch {
          hasSqliteCli = false;
        }
        if (hasSqliteCli) {
          for (const entry of fs.readdirSync(roDir)) {
            if (entry.endsWith('-shm')) {
              fs.unlinkSync(path.join(roDir, entry));
            }
          }
          fs.chmodSync(roDir, 0o555);
          try {
            const realRoot = fs.realpathSync(tmpDir);
            const realWalDb = fs.realpathSync(walDb);
            const inspected = await inspectSqliteDatabase(
              realRoot,
              realWalDb,
              'ro-db-dir/wal-sample.db',
              fs.statSync(realWalDb).size,
              'SELECT id, label FROM items',
              undefined,
              20,
              'sqlite3',
            );
            assert.equal(inspected.rows.length, 1);
            assert.equal(inspected.rows[0].label, 'alpha');
            assert.equal(
              fs.readdirSync(roDir).some((f) => f.endsWith('-shm')),
              false,
              'immutable=1 fallback must never create -shm files in read-only directory',
            );
          } finally {
            fs.chmodSync(roDir, 0o755);
          }
        }
      });
    }
  });
});

describe('Defense 4 & 5: ErrorBoundary, 0x0 Resize & Leak Guards, SIGKILL Stale PID Recovery', () => {
  it('validates ErrorBoundary recovery rendering, DiffViewer 400-line truncation with hidden annotation alert, rAF 0x0 ResizeObserver guards, RemotePanel/PWA pause, and v2.36 floating composer safe insets', () => {
    const derived = ErrorBoundary.getDerivedStateFromError(new Error('boom\x00\npanel crash'));
    assert.equal(derived.hasError, true);
    assert.equal(derived.errorMessage.includes('\x00'), false);
    assert.match(derived.errorMessage, /boom/);

    // Real React render test: ErrorBoundary normal path & recovery UI markup
    const okMarkup = renderToStaticMarkup(
      React.createElement(ErrorBoundary, {
        scopeLabel: 'Review',
        retryLabel: 'Retry Panel',
        reloadLabel: 'Reload',
        children: React.createElement('div', { id: 'ok-child' }, 'healthy'),
      }),
    );
    assert.match(okMarkup, /healthy/);

    const ebInstance = new ErrorBoundary({
      scopeLabel: 'Review',
      retryLabel: 'Retry Panel',
      returnHomeLabel: 'Hub',
      reloadLabel: 'Reload',
      onReturnHome: () => undefined,
      children: null,
    });
    (ebInstance as unknown as { state: { hasError: boolean; errorMessage: string } }).state = derived;
    const fallbackMarkup = renderToStaticMarkup(ebInstance.render() as React.ReactElement);
    assert.match(fallbackMarkup, /nov-error-boundary/);
    assert.match(fallbackMarkup, /Retry Panel/);
    assert.match(fallbackMarkup, /Reload/);
    assert.match(fallbackMarkup, /Hub/);
    assert.match(fallbackMarkup, /boom/);

    // Root ErrorBoundary without I18nProvider still renders safe English fallback
    const rootEb = new ErrorBoundary({
      scopeLabel: 'agy-NOV Shell',
      children: null,
    });
    (rootEb as unknown as { state: { hasError: boolean; errorMessage: string } }).state = derived;
    const rootFallbackMarkup = renderToStaticMarkup(rootEb.render() as React.ReactElement);
    assert.match(rootFallbackMarkup, /agy-NOV Shell encountered a render error/);
    assert.match(rootFallbackMarkup, /Retry/);
    assert.match(rootFallbackMarkup, /Reload Panel/);

    // Localized ErrorBoundary across all 8 UI locales (no leaked hardcoded English on non-EN locales)
    for (const locale of UI_LOCALE_IDS) {
      const dict = DICTIONARIES[locale];
      const scope = dict.modules.review.name;
      const localizedTitle = formatMessage(dict.common.errorBoundaryTitle, { scope });
      const localizedEb = new ErrorBoundary({
        scopeLabel: scope,
        title: localizedTitle,
        retryLabel: dict.retry,
        returnHomeLabel: dict.common.errorBoundaryReturnHome,
        reloadLabel: dict.common.errorBoundaryReload,
        onReturnHome: () => undefined,
        children: null,
      });
      (localizedEb as unknown as { state: { hasError: boolean; errorMessage: string } }).state = derived;
      const localizedHtml = renderToStaticMarkup(localizedEb.render() as React.ReactElement);
      assert.ok(localizedHtml.includes(localizedTitle), `Missing localized title for locale ${locale}`);
      assert.ok(localizedHtml.includes(dict.retry), `Missing localized retry for locale ${locale}`);
      assert.ok(
        localizedHtml.includes(dict.common.errorBoundaryReturnHome),
        `Missing localized returnHome for locale ${locale}`,
      );
      assert.ok(
        localizedHtml.includes(dict.common.errorBoundaryReload),
        `Missing localized reload for locale ${locale}`,
      );
      if (locale !== 'en') {
        assert.equal(
          localizedHtml.includes('encountered a render error'),
          false,
          `Hardcoded English leaked in ErrorBoundary for locale ${locale}`,
        );
        assert.equal(
          localizedHtml.includes('Reload Panel'),
          false,
          `Hardcoded English Reload button leaked in ErrorBoundary for locale ${locale}`,
        );
      }
    }

    // Real React render test: DiffViewer truncates 500-line diff at 400 lines AND reports hidden annotation at line 450
    const manyLines = Array.from({ length: 500 }, (_, i) => ({
      type: 'add' as const,
      oldLine: null,
      newLine: i + 1,
      content: `const line_${i + 1} = ${i + 1};`,
    }));
    const diffMarkup = renderToStaticMarkup(
      React.createElement(NovI18nProvider, {
        locale: 'zh-CN',
        prefLocale: 'zh-CN',
        children: React.createElement(DiffViewer, {
          file: {
            path: 'src/large.ts',
            status: 'modified',
            additions: 500,
            deletions: 0,
            isBinary: false,
            isTruncated: false,
            riskTags: [],
            fingerprint: 'fp-large',
            hunks: [{ header: '@@ -0,0 +1,500 @@', oldStart: 0, oldCount: 0, newStart: 1, newCount: 500, lines: manyLines }],
          },
          viewMode: 'unified',
          viewed: false,
          canToggleAuxPane: false,
          annotations: [
            {
              id: 'ann-450',
              repoKey: 'repo',
              scope: 'working',
              filePath: 'src/large.ts',
              side: 'new',
              startLine: 450,
              endLine: 450,
              category: 'bug',
              comment: 'Hidden below fold',
              codeSnippet: 'const line_450 = 450;',
              resolved: false,
              createdAt: '2026-11-28T00:00:00Z',
              updatedAt: '2026-11-28T00:00:00Z',
            },
          ],
          onToggleViewed: () => undefined,
          onOpenInHost: () => undefined,
          onAddAnnotation: async () => undefined,
          onUpdateAnnotation: async () => undefined,
          onToggleResolve: async () => undefined,
          onDeleteAnnotation: async () => undefined,
        }),
      }),
    );
    assert.match(diffMarkup, /400 \/ 500/);
    assert.match(diffMarkup, /1 批注|1 Annotations|1 /);
    assert.equal(diffMarkup.includes('line_450'), false, 'Lines beyond 400 budget must stay folded initially');

    const mainSrc = fs.readFileSync(path.join(REPO_ROOT, 'ui/src/main.tsx'), 'utf8');
    assert.match(mainSrc, /<ErrorBoundary/);

    const appSrc = fs.readFileSync(path.join(REPO_ROOT, 'ui/src/App.tsx'), 'utf8');
    assert.match(appSrc, /<ErrorBoundary/);
    assert.match(appSrc, /errorBoundaryTitle/);
    assert.match(appSrc, /errorBoundaryReturnHome/);
    assert.match(appSrc, /errorBoundaryReload/);
    assert.match(appSrc, /toastSeqRef/);
    assert.match(appSrc, /activeToastId/);
    assert.match(appSrc, /let disposed = false/);
    assert.match(appSrc, /requestAnimationFrame/);
    assert.match(appSrc, /rect\.width > 0 && rect\.height > 0/);
    assert.match(appSrc, /clearTimeout\(focusTimer\)/);

    const reviewPanelSrc = fs.readFileSync(path.join(REPO_ROOT, 'ui/src/modules/review/ReviewPanel.tsx'), 'utf8');
    assert.match(reviewPanelSrc, /let disposed = false/);
    assert.match(reviewPanelSrc, /requestAnimationFrame/);
    assert.match(reviewPanelSrc, /rect\.width > 0 && rect\.height > 0/);
    assert.match(reviewPanelSrc, /clearTimeout/);

    const remotePanelSrc = fs.readFileSync(path.join(REPO_ROOT, 'ui/src/modules/remote/RemotePanel.tsx'), 'utf8');
    assert.match(remotePanelSrc, /visibilitychange/);
    assert.match(remotePanelSrc, /addEventListener\('blur'/);
    assert.match(remotePanelSrc, /removeEventListener\('blur'/);

    const pwaHtml = renderMobilePwaHtml();
    assert.match(pwaHtml, /visibilitychange/);
    assert.match(pwaHtml, /closeEventStream/);

    const xrayPanelSrc = fs.readFileSync(path.join(REPO_ROOT, 'ui/src/modules/xray/XrayPanel.tsx'), 'utf8');
    assert.match(xrayPanelSrc, /setStepsRenderLimit\(60\)/);

    const studioPanelSrc = fs.readFileSync(path.join(REPO_ROOT, 'ui/src/modules/studio/StudioPanel.tsx'), 'utf8');
    assert.match(studioPanelSrc, /copyTimerRef/);

    const specPlanSrc = fs.readFileSync(path.join(REPO_ROOT, 'ui/src/modules/spec/SpecPlanReviewView.tsx'), 'utf8');
    assert.match(specPlanSrc, /INITIAL_PLAN_LINE_BUDGET/);

    const shellCss = fs.readFileSync(path.join(REPO_ROOT, 'ui/src/styles/shell.css'), 'utf8');
    assert.match(shellCss, /--nov-safe-bottom/);
    assert.match(shellCss, /--nov-wide-composer-clearance/);
    assert.match(shellCss, /\.nov-error-boundary/);

    const ebSrc = fs.readFileSync(path.join(REPO_ROOT, 'ui/src/components/ErrorBoundary.tsx'), 'utf8');
    assert.match(ebSrc, /window\.location\.protocol === 'http:'/);
    assert.match(appSrc, /mountedRef\.current/);

    for (const relCss of [
      'ui/src/modules/review/styles.css',
      'ui/src/modules/remote/styles.css',
      'ui/src/modules/canvas/styles.css',
      'ui/src/modules/guard/styles.css',
      'ui/src/modules/xray/styles.css',
      'ui/src/modules/mem/styles.css',
    ]) {
      const cssText = fs.readFileSync(path.join(REPO_ROOT, relCss), 'utf8');
      assert.match(cssText, /--nov-safe-bottom/, `${relCss} must honor --nov-safe-bottom`);
    }
  });

  it('detects stale remote runtime.json left after SIGKILL via isPidAlive without mutating disk', async () => {
    assert.equal(isPidAlive(process.pid), true);
    assert.equal(isPidAlive(0), false);
    assert.equal(isPidAlive(-1), false);
    assert.equal(isPidAlive(999_999_999), false);

    await withTempDir('agy-nov-v122-sigkill-', (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data');
      const fullCfg = applyPresetConfig(dataDir, 'full');
      const remoteDir = getModuleDataDir(dataDir, 'remote');

      // Seed stale runtime.json with dead PID (simulates abrupt host SIGKILL)
      writeRuntimeInfo(remoteDir, {
        port: 4391,
        host: '127.0.0.1',
        url: 'http://127.0.0.1:4391',
        pid: 999_999_999,
        startedAt: new Date().toISOString(),
      });

      assert.equal(readRuntimeInfo(remoteDir), null, 'Dead PID runtime.json must be treated as not running');
      assert.equal(
        fs.existsSync(path.join(remoteDir, 'runtime.json')),
        true,
        'Read-only probe must not delete files on disk',
      );
      const snapDead = buildFeedSnapshot(dataDir, fullCfg);
      assert.equal(snapDead.summary.remote.running, false);

      // Live PID runtime.json is recognized as running
      writeRuntimeInfo(remoteDir, {
        port: 4391,
        host: '127.0.0.1',
        url: 'http://127.0.0.1:4391',
        pid: process.pid,
        startedAt: new Date().toISOString(),
      });
      const liveInfo = readRuntimeInfo(remoteDir);
      assert.ok(liveInfo && liveInfo.pid === process.pid);
      const snapLive = buildFeedSnapshot(dataDir, fullCfg);
      assert.equal(snapLive.summary.remote.running, true);
    });

    // Verify shutdown watchdog & sidecar timeout guards exist
    const serverSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/server/index.ts'), 'utf8');
    assert.match(serverSrc, /SIGHUP/);
    assert.match(serverSrc, /EPIPE/);
    const sidecarSrc = fs.readFileSync(path.join(REPO_ROOT, 'sidecars/audit-sidecar.mjs'), 'utf8');
    assert.match(sidecarSrc, /timeout:\s*30_000/);
  });
});

describe('Antigravity Desktop v2.36.0 Compatibility Suite', () => {
  it('discovers ~/.agents/skills alongside ~/.gemini with strict ~/.gemini precedence and zero writes', async () => {
    await withTempDir('agy-nov-v236-skills-', (tmpDir) => {
      const fakeHome = path.join(tmpDir, 'home');
      const geminiSkillDir = path.join(fakeHome, '.gemini', 'config', 'skills', 'shared-skill');
      const agentsShadowedDir = path.join(fakeHome, '.agents', 'skills', 'shared-skill');
      const agentsUniqueDir = path.join(fakeHome, '.agents', 'skills', 'agents-only');
      fs.mkdirSync(geminiSkillDir, { recursive: true });
      fs.mkdirSync(agentsShadowedDir, { recursive: true });
      fs.mkdirSync(agentsUniqueDir, { recursive: true });
      fs.writeFileSync(path.join(geminiSkillDir, 'SKILL.md'), '# Gemini Winner\n', 'utf8');
      fs.writeFileSync(path.join(agentsShadowedDir, 'SKILL.md'), '# Agents Shadowed\n', 'utf8');
      fs.writeFileSync(path.join(agentsUniqueDir, 'SKILL.md'), '# Agents Only\n', 'utf8');

      const roots = getDefaultAntigravitySkillDirs({}, 'darwin', fakeHome);
      const geminiIdx = roots.findIndex((r) => r.source === 'gemini');
      const agentsIdx = roots.findIndex((r) => r.source === 'agents');
      assert.ok(geminiIdx >= 0 && agentsIdx > geminiIdx, '~/.gemini roots must precede ~/.agents/skills');

      const discovered = discoverUserCustomSkillsReadOnly({ homeDir: fakeHome, platform: process.platform, env: {} });
      assert.equal(discovered.skills.length, 2);
      const shared = discovered.skills.find((s) => s.name === 'shared-skill');
      const unique = discovered.skills.find((s) => s.name === 'agents-only');
      assert.equal(shared?.source, 'gemini');
      assert.equal(unique?.source, 'agents');
      assert.equal(discovered.shadowedByGemini.length, 1);
      assert.equal(discovered.shadowedByGemini[0].name, 'shared-skill');

      // Symlinked ~/.agents/skills -> ~/.gemini/config/skills must deduplicate physical dir without false shadowing
      const symHome = path.join(tmpDir, 'sym-home');
      const symGeminiSkills = path.join(symHome, '.gemini', 'config', 'skills');
      fs.mkdirSync(path.join(symGeminiSkills, 'one-skill'), { recursive: true });
      fs.writeFileSync(path.join(symGeminiSkills, 'one-skill', 'SKILL.md'), '# One\n', 'utf8');
      fs.mkdirSync(path.join(symHome, '.agents'), { recursive: true });
      fs.symlinkSync(
        symGeminiSkills,
        path.join(symHome, '.agents', 'skills'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const symDiscovered = discoverUserCustomSkillsReadOnly({ homeDir: symHome, platform: process.platform, env: {} });
      assert.equal(symDiscovered.skills.length, 1);
      assert.equal(symDiscovered.shadowedByGemini.length, 0, 'Symlink to same physical skill dir must not report false shadowing');

      // Workspace recommend detects .agents/skills and .gemini/skills as rules/skills signals
      const wsWithGeminiSkills = path.join(tmpDir, 'ws-skills');
      fs.mkdirSync(path.join(wsWithGeminiSkills, '.gemini', 'skills', 's1'), { recursive: true });
      const rec = buildWorkspaceRecommendation(wsWithGeminiSkills);
      assert.equal(rec.signals.hasRulesOrMcp, true);
      assert.equal(typeof rec.userCustomSkills.total, 'number');

      // CLI doctor prints dual-root Custom Skills check without creating missing dataDir
      const missingDataDir = path.join(tmpDir, 'absent-doctor-data');
      const cliEntry = path.join(REPO_ROOT, 'src', 'server', 'cli.ts');
      const out = execFileSync(
        process.execPath,
        ['--import', 'tsx', cliEntry, 'doctor', `--data-dir=${missingDataDir}`],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );
      assert.match(out, /Custom Skills \(~\/\.gemini > ~\/\.agents\/skills\):/);
      assert.equal(fs.existsSync(missingDataDir), false);
    });
  });

  it('tightens Guard sensitive config protection for v2.36 cross-repo Auto edits without blocking legitimate cross-repo source files', async () => {
    await withTempDir('agy-nov-v236-guard-', (tmpDir) => {
      const primaryWs = path.join(tmpDir, 'repo-a');
      const siblingRepo = path.join(tmpDir, 'repo-b');
      const dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(path.join(primaryWs, 'src'), { recursive: true });
      fs.mkdirSync(path.join(siblingRepo, 'src'), { recursive: true });
      const siblingCode = path.join(siblingRepo, 'src', 'utils.ts');
      fs.writeFileSync(siblingCode, 'export const ok = true;\n', 'utf8');

      // 1. Legitimate cross-repo edit outside primary workspace is allowed
      const crossRepoAllow = handleGuardPreToolHook(
        normalizeHookPayload(
          {
            hookEventName: 'PreToolUse',
            workspacePaths: [primaryWs],
            toolCall: {
              name: 'edit_file',
              args: { Path: siblingCode, Replacement: 'export const ok = false;\n' },
            },
          },
          'PreToolUse',
        ),
        dataDir,
      );
      assert.equal(crossRepoAllow.decision, 'allow', 'Legitimate cross-repo source edits must remain allowed');

      // 2. Out-of-project sensitive config files must be strictly denied even under cross-repo Auto mode
      const sensitivePaths = [
        '/Users/dev/.gitconfig',
        path.join(siblingRepo, '.git', 'config'),
        path.join(siblingRepo, '.git', 'hooks', 'pre-commit'),
        '/Users/dev/.git-credentials',
        '/Users/dev/.docker/config.json',
        '/Users/dev/.config/gh/hosts.yml',
        '/Users/dev/.gemini/settings.json',
        '/Users/dev/.gemini/antigravity/mcp_config.json',
        '/Users/dev/.claude/settings.json',
        '/Users/dev/.codex/auth.json',
        path.join(siblingRepo, 'credentials.json'),
      ];
      for (const p of sensitivePaths) {
        const res = evaluateToolCall('edit_file', { Path: p, Replacement: 'x' }, DEFAULT_POLICY);
        assert.equal(res.decision, 'deny', `Expected Guard deny for sensitive config path: ${p}`);
      }

      // 3. Shell commands attempting to read or tamper with v2.36 sensitive config paths must also be blocked
      const sensitiveShellCmds = [
        'cat ~/.gemini/antigravity/mcp_config.json',
        'cat ~/.docker/config.json',
        'cat ~/.config/gh/hosts.yml',
        'cat ~/.codex/auth.json',
        'cat ~/.gitconfig',
        `echo evil >> ${path.join(siblingRepo, '.git', 'config')}`,
        `chmod +x ${path.join(siblingRepo, '.git', 'hooks', 'pre-commit')}`,
      ];
      for (const cmd of sensitiveShellCmds) {
        const res = evaluateToolCall('run_command', { CommandLine: cmd }, DEFAULT_POLICY);
        assert.equal(res.decision, 'deny', `Expected Guard shell deny for sensitive config command: ${cmd}`);
      }

      // Legitimate cross-repo source command remains allowed
      const safeCrossRepoCmd = evaluateToolCall(
        'run_command',
        { CommandLine: `cat ${siblingCode}` },
        DEFAULT_POLICY,
      );
      assert.equal(safeCrossRepoCmd.decision, 'allow');

      // Remote risk card also classifies v2.36 sensitive host/repo configs as high risk
      const riskCard = buildApprovalRiskCard({
        toolName: 'edit_file',
        toolInput: { Path: '/Users/dev/.gemini/antigravity/mcp_config.json' },
      });
      assert.equal(riskCard.riskLevel, 'high');
    });
  });

  it('distinguishes dynamic v2.36 offline-refresh OAuth MCP configs from hardcoded OAuth secrets and recognizes workspace .gemini/skills', async () => {
    await withTempDir('agy-nov-v236-ops-oauth-', (tmpDir) => {
      const ws = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'absent-data');
      fs.mkdirSync(path.join(ws, '.gemini', 'skills', 'local-gem'), { recursive: true });
      fs.mkdirSync(path.join(ws, '.agents', 'skills', 'local-ag'), { recursive: true });
      fs.writeFileSync(path.join(ws, '.gemini', 'skills', 'local-gem', 'SKILL.md'), '# Local Gemini Skill\n', 'utf8');
      fs.writeFileSync(path.join(ws, '.agents', 'skills', 'local-ag', 'SKILL.md'), '# Local Agents Skill\n', 'utf8');

      const fakeSecret = ['oauth', 'client', 'secret', '9988776655'].join('_');
      fs.writeFileSync(
        path.join(ws, 'mcp_config.json'),
        JSON.stringify(
          {
            mcpServers: {
              'dynamic-oauth-srv': {
                url: 'https://mcp.example.com/sse',
                oauth: {
                  clientId: 'antigravity-public-client',
                  scopes: ['read', 'offline_access'],
                },
              },
              'static-oauth-secret-srv': {
                url: 'https://mcp2.example.com/sse',
                oauth: {
                  clientId: 'srv-2',
                  clientSecret: fakeSecret,
                },
              },
              'nested-oauth-secret-srv': {
                url: 'https://mcp3.example.com/sse',
                oauth: {
                  clientId: 'srv-3',
                  credentials: {
                    clientSecret: fakeSecret,
                  },
                },
              },
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      const report = auditWorkspaceReadOnly(ws, dataDir, { enabledNovTools: 12 });
      const dynFinding = report.mcpHealthFindings.find((f) => f.serverName === 'dynamic-oauth-srv');
      const staticFinding = report.mcpHealthFindings.find((f) => f.serverName === 'static-oauth-secret-srv');
      const nestedFinding = report.mcpHealthFindings.find((f) => f.serverName === 'nested-oauth-secret-srv');
      assert.equal(dynFinding?.severity, 'info', 'Dynamic OAuth config without plaintext secrets should be info');
      assert.equal(staticFinding?.severity, 'warn', 'OAuth config with hardcoded clientSecret must be warn');
      assert.equal(nestedFinding?.severity, 'warn', 'Nested OAuth config with hardcoded clientSecret must be warn');
      assert.equal(JSON.stringify(report).includes(fakeSecret), false);

      const gemSkillAsset = report.assets.find((a) => a.relPath === '.gemini/skills/local-gem/SKILL.md');
      const agSkillAsset = report.assets.find((a) => a.relPath === '.agents/skills/local-ag/SKILL.md');
      assert.equal(gemSkillAsset?.kind, 'skill');
      assert.equal(agSkillAsset?.kind, 'skill');
    });
  });

  it('parses v2.36 statusLine stdin JSON variants (NDJSON, remaining_percentage) cleanly with zero hardcoded 2.35 runtime gates', () => {
    const ndjson = [
      '{"model":"gemini-2.5-flash","context_window":{"remaining_percentage":80}}',
      '{"version":"2.36.0","model":{"display_name":"Gemini 3 Pro"},"context_window":{"remaining_percentage":35},"quota":{"remaining_percentage":92}}',
    ].join('\n');
    const parsed = parseHostStatusLineStdin(ndjson);
    assert.equal(parsed?.model, 'Gemini 3 Pro');
    assert.equal(parsed?.contextPercent, 65);
    assert.equal(parsed?.quotaRemainingPercent, 92);

    // Ensure no runtime version check in src/ hardcodes "2.35"
    const srcFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (entry.isFile() && abs.endsWith('.ts')) srcFiles.push(abs);
      }
    };
    walk(path.join(REPO_ROOT, 'src'));
    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf8');
      // Strip comments before checking for hardcoded runtime "2.35" literals
      const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.equal(
        /['"`]2\.35(?:\.\d+)?['"`]/.test(stripped),
        false,
        `Unexpected hardcoded 2.35 runtime version literal in ${path.relative(REPO_ROOT, file)}`,
      );
    }

    // Verify sidecars/README.md explicitly states 2.35+ / 2.36+ compatibility
    const sidecarReadme = fs.readFileSync(path.join(REPO_ROOT, 'sidecars/README.md'), 'utf8');
    assert.match(sidecarReadme, /2\.35\+\s*\/\s*2\.36\+/);
  });

  it('v1.2.2 Red-Team Regressions: blocks // /./ /../ bypasses, Remote .git/hooks/*, tightens 0600 modes, guards blobs symlink, and allows dynamic OAuth tokenUrl', async () => {
    await withTempDir('agy-nov-v122-redteam-', async (tmpDir) => {
      const ws = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(ws, { recursive: true });
      const cfg = applyPresetConfig(dataDir, 'core');

      // 1) Guard Shell & File path normalization defeats //, /./, /../ obfuscation
      const bypassCmds = [
        'cat ~/.gemini/./mcp_config.json',
        'cat ~/.gemini//mcp_config.json',
        'cat ~/.gemini/antigravity/../mcp_config.json',
        'chmod +x /repo/.git/./hooks/pre-commit',
        'cat ~/.docker//config.json',
      ];
      for (const cmd of bypassCmds) {
        const res = await dispatchNovHook(
          {
            hookEventName: 'PreToolUse',
            toolName: 'run_command',
            toolInput: { CommandLine: cmd },
            workspacePaths: [ws],
          },
          'PreToolUse',
          dataDir,
        );
        assert.equal(res.decision, 'deny', `Guard Shell must deny obfuscated command: ${cmd}`);
      }
      const directFile = evaluateToolCall(
        'edit_file',
        { Path: '/Users/dev/.gemini/./mcp_config.json' },
        DEFAULT_POLICY,
      );
      assert.equal(directFile.decision, 'deny', 'evaluateToolCall must deny /./ obfuscated sensitive path');

      // 2) Remote risk card flags concrete .git/hooks/pre-commit and .gemini/google_accounts.json as high risk
      const hookCard = buildApprovalRiskCard({
        toolName: 'write_file',
        toolInput: { Path: '/repo/.git/hooks/pre-commit' },
      });
      assert.equal(hookCard.riskLevel, 'high', 'Remote risk card must classify .git/hooks/pre-commit as high');
      const googleAccCard = buildApprovalRiskCard({
        toolName: 'read_file',
        toolInput: { Path: '/Users/dev/.gemini/google_accounts.json' },
      });
      assert.equal(
        googleAccCard.riskLevel,
        'high',
        'Remote risk card must classify .gemini/google_accounts.json as high',
      );

      // 3) Dirty checks converge lax 0644 files back to 0600 on POSIX
      if (process.platform !== 'win32') {
        const feedPath = getFeedSnapshotPath(dataDir);
        writeFeedSnapshotIfDataDirExists(dataDir, cfg);
        fs.chmodSync(feedPath, 0o644);
        const tightenedFeed = writeFeedSnapshotIfDataDirExists(dataDir, cfg, { minIntervalMs: 60_000 });
        assert.equal(tightenedFeed, true, 'feed-snapshot.json with 0644 mode must be rewritten to 0600');
        assert.equal(fs.lstatSync(feedPath).mode & 0o777, 0o600);

        const sweep = runReadOnlyHealthSweep({ workspaceRoot: ws, dataDir });
        const sweepRes1 = writeHealthSweepReportIfPermitted(dataDir, sweep);
        assert.equal(sweepRes1.written, true);
        assert.ok(sweepRes1.path);
        fs.chmodSync(sweepRes1.path, 0o644);
        const sweepRes2 = writeHealthSweepReportIfPermitted(dataDir, sweep);
        assert.equal(sweepRes2.written, true, 'health-sweep.json with 0644 mode must be rewritten to 0600');
        assert.equal(fs.lstatSync(sweepRes1.path).mode & 0o777, 0o600);

        const radarDir = getModuleDataDir(dataDir, 'radar');
        recordRadarSessionEvent(radarDir, {
          conversationId: 'conv-mode',
          event: 'PreToolUse',
          toolName: 'read_file',
        });
        const capsulePath = getRadarStatusCapsulePath(radarDir);
        fs.chmodSync(capsulePath, 0o644);
        recordRadarSessionEvent(radarDir, {
          conversationId: 'conv-mode',
          event: 'PreToolUse',
          toolName: 'read_file',
        });
        assert.equal(fs.lstatSync(capsulePath).mode & 0o777, 0o600, 'status-capsule.json must tighten 0644 -> 0600');
      }

      // 4) Guard blobs/ symlink is strictly refused (zero external write/delete)
      const guardDir = getModuleDataDir(dataDir, 'guard');
      fs.mkdirSync(guardDir, { recursive: true });
      const victimDir = path.join(tmpDir, 'victim-blobs');
      fs.mkdirSync(victimDir, { recursive: true });
      const blobsLink = path.join(guardDir, 'blobs');
      fs.rmSync(blobsLink, { recursive: true, force: true });
      fs.symlinkSync(victimDir, blobsLink, process.platform === 'win32' ? 'junction' : 'dir');
      const safeFile = path.join(ws, 'sample.ts');
      fs.writeFileSync(safeFile, 'export const ok = 1;\n', 'utf8');
      assert.throws(() => {
        capturePreEditSnapshot({
          dataDir: guardDir,
          workspaceRoot: ws,
          filePath: safeFile,
          toolName: 'edit_file',
          reason: 'symlink blobs test',
          policy: loadPolicy(guardDir),
        });
      }, /symlinked Guard snapshot blobs/i);
      assert.deepEqual(fs.readdirSync(victimDir), [], 'Symlinked blobs dir must never receive external writes');
      fs.unlinkSync(blobsLink);

      // 5) Dynamic OAuth with tokenUrl / tokenEndpoint / token_endpoint_auth_method is info (not warn)
      fs.writeFileSync(
        path.join(ws, 'mcp_config.json'),
        JSON.stringify(
          {
            mcpServers: {
              'oauth-endpoints-srv': {
                url: 'https://mcp-dyn.example.com/sse',
                oauth: {
                  clientId: 'pub-client',
                  authorizationUrl: 'https://auth.example.com/oauth/authorize',
                  tokenUrl: 'https://auth.example.com/oauth/token',
                  tokenEndpoint: 'https://auth.example.com/oauth/token',
                  token_endpoint_auth_method: 'none',
                  scopes: ['offline_access'],
                },
              },
            },
          },
          null,
          2,
        ),
        'utf8',
      );
      const report = auditWorkspaceReadOnly(ws, dataDir, { enabledNovTools: 12 });
      const dynEndpointFinding = report.mcpHealthFindings.find((f) => f.serverName === 'oauth-endpoints-srv');
      assert.equal(
        dynEndpointFinding?.severity,
        'info',
        'Standard dynamic OAuth tokenUrl/tokenEndpoint fields must be classified as info',
      );
    });
  });
});
