import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { getModuleDataDir, MODULE_CATALOG, setModuleEnabled } from '../src/core/config.js';
import { dispatchNovHook } from '../src/hooks/dispatcher.js';
import {
  buildAutoRtkOverwriteCommand,
  executeSafeCompactRun,
  loadTurboHotspotsReadOnly,
  loadTurboPrefsReadOnly,
  parseSafeAutoRtkCommand,
  recordTurboHotspot,
  saveTurboPrefs,
} from '../src/modules/turbo/auto-rtk.js';
import { handleTurboPostToolHook, handleTurboPreToolHook } from '../src/modules/turbo/hook.js';
import { NOV_VERSION } from '../src/server/index.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

function encodeRawPayload(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

describe('v0.8.0 Auto-RTK defaults, prefs persistence & symlink defense', () => {
  it('defaults to OFF with strict zero disk writes when dataDir is absent', async () => {
    await withTempDir('agy-nov-v08-zero-', async (tmpBase) => {
      const missingDataDir = path.join(tmpBase, 'non-existent-data');
      const turboDataDir = getModuleDataDir(missingDataDir, 'turbo');

      const prefs = loadTurboPrefsReadOnly(turboDataDir);
      assert.equal(prefs.schemaVersion, 1);
      assert.equal(prefs.autoRtk, false);
      assert.equal(prefs.updatedAt, '');
      assert.deepEqual(loadTurboHotspotsReadOnly(turboDataDir), []);

      const hookRes = handleTurboPreToolHook(
        {
          event: 'PreToolUse',
          workspacePaths: [tmpBase],
          toolName: 'run_command',
          toolInput: { CommandLine: 'git status' },
          raw: {},
        },
        missingDataDir,
      );
      assert.deepEqual(hookRes, {});

      const dispatchRes = await dispatchNovHook(
        {
          hookEventName: 'PreToolUse',
          toolCall: { name: 'run_command', args: { CommandLine: 'git status' } },
          workspacePaths: [tmpBase],
        },
        'PreToolUse',
        missingDataDir,
      );
      assert.equal(dispatchRes.overwrite, undefined);
      assert.equal(fs.existsSync(missingDataDir), false, 'missing dataDir must never be created');
    });
  });

  it('saves prefs atomically with 0700/0600 modes and blocks symlink escape', async () => {
    await withTempDir('agy-nov-v08-prefs-', (tmpBase) => {
      const dataDir = path.join(tmpBase, 'nov-data');
      const turboDataDir = getModuleDataDir(dataDir, 'turbo');

      const saved = saveTurboPrefs(turboDataDir, { autoRtk: true });
      assert.equal(saved.schemaVersion, 1);
      assert.equal(saved.autoRtk, true);
      assert.ok(saved.updatedAt.length > 0);

      const reloaded = loadTurboPrefsReadOnly(turboDataDir);
      assert.equal(reloaded.autoRtk, true);

      if (process.platform !== 'win32') {
        const dirMode = fs.statSync(turboDataDir).mode & 0o777;
        const fileMode = fs.statSync(path.join(turboDataDir, 'prefs.json')).mode & 0o777;
        assert.equal(dirMode, 0o700);
        assert.equal(fileMode, 0o600);
      }

      // Symlink escape defense: refuse symlinked prefs.json or module dir
      const outsideFile = path.join(tmpBase, 'outside-prefs.json');
      fs.writeFileSync(outsideFile, '{"autoRtk":true}\n');
      const symDir = path.join(tmpBase, 'sym-turbo');
      fs.mkdirSync(symDir, { recursive: true });
      fs.symlinkSync(outsideFile, path.join(symDir, 'prefs.json'));

      assert.equal(loadTurboPrefsReadOnly(symDir).autoRtk, false);
      assert.throws(() => saveTurboPrefs(symDir, { autoRtk: true }));
    });
  });
});

describe('v0.8.0 parseSafeAutoRtkCommand strict whitelist & injection blocking', () => {
  it('accepts strictly whitelisted read-only/test/build single commands with accurate presets', () => {
    const allowedCases: Array<[string, 'git' | 'test' | 'build', string]> = [
      ['git status', 'git', 'git'],
      ['git status --short', 'git', 'git'],
      ['git diff --stat HEAD~1', 'git', 'git'],
      ['git log -n 10 --oneline', 'git', 'git'],
      ['git branch --show-current', 'git', 'git'],
      ['git branch -a', 'git', 'git'],
      ['git show HEAD --stat', 'git', 'git'],
      ['npm test', 'test', 'npm'],
      ['npm run test', 'test', 'npm'],
      ['npm run build', 'build', 'npm'],
      ['npm run typecheck', 'build', 'npm'],
      ['npm run lint', 'build', 'npm'],
      ['pnpm test', 'test', 'pnpm'],
      ['pnpm build', 'build', 'pnpm'],
      ['pnpm typecheck', 'build', 'pnpm'],
      ['pnpm lint', 'build', 'pnpm'],
      ['yarn test', 'test', 'yarn'],
      ['yarn build', 'build', 'yarn'],
      ['yarn typecheck', 'build', 'yarn'],
      ['yarn lint', 'build', 'yarn'],
      ['npx tsc --noEmit', 'build', 'npx'],
      ['npx vitest run', 'test', 'npx'],
      ['npx jest', 'test', 'npx'],
      ['npx eslint src', 'build', 'npx'],
      ['pytest -q', 'test', 'pytest'],
      ['pytest -k "test_auth"', 'test', 'pytest'],
      ['cargo test', 'test', 'cargo'],
      ['cargo check', 'build', 'cargo'],
      ['cargo build', 'build', 'cargo'],
      ['go test ./...', 'test', 'go'],
      ['go test -count=1 ./...', 'test', 'go'],
      ['go test -cover ./...', 'test', 'go'],
      ['go vet ./...', 'build', 'go'],
    ];

    for (const [cmd, expectedPreset, expectedExe] of allowedCases) {
      const parsed = parseSafeAutoRtkCommand(cmd);
      assert.equal(parsed.ok, true, `Expected allowed command to pass: ${cmd}`);
      if (parsed.ok) {
        assert.equal(parsed.executable, expectedExe, `Executable mismatch for: ${cmd}`);
        assert.equal(parsed.preset, expectedPreset, `Preset mismatch for: ${cmd}`);
      }
    }
  });

  it('hard-rejects all shell injections, metacharacters, dangerous flags, env prefixes & non-whitelisted commands', () => {
    const blockedCases = [
      // Shell metacharacters & control sequences
      'git status; id',
      'git status && whoami',
      'git status || whoami',
      'git status | cat /etc/passwd',
      'git status $(whoami)',
      'git log `whoami`',
      'git status > /tmp/out.txt',
      'git status < /etc/passwd',
      'git status\nwhoami',
      'git status\r\nwhoami',
      'git status \\n',
      '(git status)',
      'npm test -- $HOME',
      'npm test test/*.test.ts',
      'git status ~/secret',
      // Environment variable assignment prefixes & shells
      'FOO=bar git status',
      'NODE_OPTIONS=--require=/tmp/x npm test',
      'sh -c "git status"',
      'bash -c "npm test"',
      'zsh -c "git diff"',
      'cmd /c git status',
      'eval "git status"',
      // Dangerous git flags & write subcommands
      'git -c core.pager=whoami status',
      'git status -c core.pager=whoami',
      'git diff --ext-diff',
      'git diff --upload-pack=evil',
      'git diff --no-index /etc/passwd /dev/null',
      'git diff -O /etc/passwd',
      'git show --exec=evil',
      'git diff --output=/tmp/leak.patch',
      'git branch evil-branch',
      'git branch -D main',
      'git push origin main',
      'git reset --hard HEAD',
      // Dangerous package manager / runner invocations
      'npm install lodash',
      'npm i',
      'npm run deploy',
      'npm test --script-shell=/bin/sh',
      'pnpm install',
      'yarn add evil',
      'npx tsc',
      'npx tsc --noEmit --watch',
      'npx -y evil-pkg',
      'npx eslint --fix src',
      'npx jest --updateSnapshot',
      'pytest -p evil_plugin',
      'cargo publish',
      'cargo test --config=net.offline=false',
      'go test -exec=evil ./...',
      'go vet -vettool=/tmp/evil ./...',
      'rm -rf /tmp/foo',
      // Length & arg limits
      `git log ${'a'.repeat(520)}`,
      `git log ${Array.from({ length: 26 }, (_, i) => `f${i}`).join(' ')}`,
      // Red-team regression: short-option glue, double-dash Go flags, tsc write/RCE flags, runner RCE & git branch creation
      'git -ccore.pager=id status',
      'git -C/tmp/evil status',
      'git status -O/etc/passwd',
      'git branch --color evil-branch',
      'git branch --abbrev evil-branch',
      'git branch --merged evil-branch',
      'git branch --no-merged evil-branch',
      'npx tsc --noEmit false',
      'npx tsc --noEmit=false',
      'npx tsc --noEmit --generateTrace /tmp/trace',
      'npx tsc --noEmit --build',
      'npx tsc --noEmit -p /tmp/evil.json',
      'npx tsc --noemit --tsBuildInfoFile /tmp/out.tsbuildinfo',
      'npx eslint --plugin=evil src',
      'npx eslint --config /tmp/evil.js src',
      'npx eslint --rulesdir /tmp/evil src',
      'npx eslint -o /tmp/leak.txt src',
      'npx vitest run --config /tmp/evil.ts',
      'npx vitest run -c/tmp/evil.ts',
      'npx vitest run --outputFile /tmp/out.json',
      'npx jest --config /tmp/evil.js',
      'npx jest --setupFiles /tmp/evil.js',
      'npx jest --outputFile /tmp/out.json',
      'pytest --rootdir=/tmp/evil',
      'pytest -c/tmp/evil.ini',
      'pytest --confcutdir=/tmp/evil',
      'pytest -o filterwarnings=ignore',
      'pytest --junitxml=/tmp/out.xml',
      'go test --exec=evil ./...',
      'go test -toolexec=/tmp/evil ./...',
      'go test --toolexec=/tmp/evil ./...',
      'go test -o /tmp/bin ./...',
      'go vet --vettool=/tmp/evil ./...',
      'npm test -- --script-shell=/bin/sh',
      'pnpm test -- --exec=evil',
      'yarn test -- --config=/tmp/evil',
      'pnpm test --setupFiles=/tmp/evil.js',
      'yarn test --resolver=/tmp/evil.js',
      'yarn lint -f ./evil.js',
      'pnpm test --require=/tmp/evil.js',
      'pytest -qc /tmp/evil.ini',
      'pytest -qp evil_plugin',
      'pytest -qo addopts=--help',
      'npx eslint -qf ./evil.js src',
    ];

    for (const cmd of blockedCases) {
      const parsed = parseSafeAutoRtkCommand(cmd);
      assert.equal(parsed.ok, false, `Expected unsafe/non-whitelisted command to be rejected: ${cmd}`);
    }

    // Also verify valid git branch optional-value flags with explicit = still pass cleanly
    assert.equal(parseSafeAutoRtkCommand('git branch --color=never').ok, true);
    assert.equal(parseSafeAutoRtkCommand('git branch --list').ok, true);
  });
});

describe('v0.8.0 PreToolUse.overwrite & Guard/Spec/Remote precedence invariants', () => {
  it('rewrites whitelisted run_command via base64url payload when autoRtk is ON and supports CommandLine/command keys', async () => {
    await withTempDir('agy-nov-v08-overwrite-', async (tmpBase) => {
      const dataDir = path.join(tmpBase, 'nov-data');
      setModuleEnabled(dataDir, 'turbo', true);
      saveTurboPrefs(getModuleDataDir(dataDir, 'turbo'), { autoRtk: true });
      const fakeCli = path.join(tmpBase, 'cli.cjs');

      // 1. CommandLine key
      const res1 = await dispatchNovHook(
        {
          hookEventName: 'PreToolUse',
          toolCall: { name: 'run_command', args: { CommandLine: 'git status --short' } },
          workspacePaths: [tmpBase],
        },
        'PreToolUse',
        dataDir,
        { turboCliEntryPath: fakeCli },
      );
      assert.equal(res1.decision, 'allow');
      assert.ok(res1.overwrite && typeof res1.overwrite.CommandLine === 'string');
      const rewritten1 = res1.overwrite.CommandLine as string;
      const expectedCliArg =
        process.platform === 'win32'
          ? `"${path.resolve(fakeCli).replace(/\\/g, '/')}"`
          : `'${path.resolve(fakeCli)}'`;
      const expectedDataDirArg =
        process.platform === 'win32'
          ? `"${path.resolve(dataDir).replace(/\\/g, '/')}"`
          : `'${path.resolve(dataDir)}'`;
      assert.ok(rewritten1.startsWith(`node ${expectedCliArg} compact-run --payload=`));
      assert.ok(rewritten1.includes(`--data-dir=${expectedDataDirArg}`));
      // Must NOT splice raw command text verbatim into the rewritten shell string
      assert.equal(rewritten1.includes('git status'), false);

      // 2. command key
      const res2 = handleTurboPreToolHook(
        {
          event: 'PreToolUse',
          workspacePaths: [tmpBase],
          toolName: 'run_command',
          toolInput: { command: 'npm run typecheck' },
          raw: {},
        },
        dataDir,
        fakeCli,
      );
      assert.equal(res2.decision, 'allow');
      assert.ok(res2.overwrite && typeof res2.overwrite.command === 'string');
      assert.equal(res2.overwrite.CommandLine, undefined);

      // 3. Rejects unsafe path chars (including control chars / trailing newlines / leading or trailing spaces)
      const parsed = parseSafeAutoRtkCommand('git status');
      assert.equal(parsed.ok, true);
      if (parsed.ok) {
        assert.equal(buildAutoRtkOverwriteCommand("/tmp/bad;id/cli.cjs", parsed, dataDir), null);
        assert.equal(buildAutoRtkOverwriteCommand(fakeCli, parsed, "/tmp/bad'quote"), null);
        assert.equal(buildAutoRtkOverwriteCommand(fakeCli, parsed, '/tmp/bad\nid'), null);
        assert.equal(buildAutoRtkOverwriteCommand('/tmp/bad\r/cli.cjs', parsed, dataDir), null);
        assert.equal(buildAutoRtkOverwriteCommand(' /tmp/cli.cjs', parsed, dataDir), null);
      }
    });
  });

  it('never triggers turbo overwrite when Guard returns deny, force_ask, or ask (and remote ask never downgrades force_ask)', async () => {
    await withTempDir('agy-nov-v08-precedence-', async (tmpBase) => {
      const dataDir = path.join(tmpBase, 'nov-data');
      setModuleEnabled(dataDir, 'guard', true);
      setModuleEnabled(dataDir, 'turbo', true);
      setModuleEnabled(dataDir, 'remote', true);
      saveTurboPrefs(getModuleDataDir(dataDir, 'turbo'), { autoRtk: true });
      const fakeCli = path.join(tmpBase, 'cli.cjs');

      const rawInput = {
        hookEventName: 'PreToolUse',
        toolCall: { name: 'run_command', args: { CommandLine: 'git status' } },
        workspacePaths: [tmpBase],
      };

      // Guard deny -> immediate deny, no overwrite
      const denyRes = await dispatchNovHook(rawInput, 'PreToolUse', dataDir, {
        guardPreTool: () => ({ decision: 'deny', reason: 'guard blocked' }),
        remotePreTool: async () => ({ decision: 'allow' }),
        turboCliEntryPath: fakeCli,
      });
      assert.equal(denyRes.decision, 'deny');
      assert.equal(denyRes.overwrite, undefined);

      // Guard force_ask + Remote ask -> MUST stay force_ask (never downgraded), no overwrite
      const forceAskRes = await dispatchNovHook(rawInput, 'PreToolUse', dataDir, {
        guardPreTool: () => ({ decision: 'force_ask', reason: 'strict-gate force_ask' }),
        remotePreTool: async () => ({ decision: 'ask', reason: 'remote ask' }),
        turboCliEntryPath: fakeCli,
      });
      assert.equal(forceAskRes.decision, 'force_ask');
      assert.equal(forceAskRes.overwrite, undefined);

      // Guard ask -> ask, no overwrite
      const askRes = await dispatchNovHook(rawInput, 'PreToolUse', dataDir, {
        guardPreTool: () => ({ decision: 'ask', reason: 'guard ask' }),
        remotePreTool: async () => ({ decision: 'allow' }),
        turboCliEntryPath: fakeCli,
      });
      assert.equal(askRes.decision, 'ask');
      assert.equal(askRes.overwrite, undefined);

      // Real Guard policy test: customBlockedCommands blocking `git status` produces real deny & zero overwrite
      const guardDir = getModuleDataDir(dataDir, 'guard');
      fs.mkdirSync(guardDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        path.join(guardDir, 'policy.json'),
        JSON.stringify({
          enabled: true,
          protectEnvAndKeys: 'deny',
          blockSecretWrites: 'deny',
          blockDestructiveCommands: 'deny',
          askOnNetworkPipes: 'ask',
          autoSnapshotBeforeEdit: true,
          maxSnapshotsPerFile: 30,
          maxSnapshotFileBytes: 1_048_576,
          customProtectedPaths: [],
          customBlockedCommands: ['git status'],
        }),
        { mode: 0o600 },
      );
      setModuleEnabled(dataDir, 'remote', false);
      const realGuardDeny = await dispatchNovHook(rawInput, 'PreToolUse', dataDir, {
        turboCliEntryPath: fakeCli,
      });
      assert.equal(realGuardDeny.decision, 'deny');
      assert.equal(realGuardDeny.overwrite, undefined);

      // Real Guard policy test 2: permissionMode='strict-gate' produces real force_ask & zero overwrite
      fs.writeFileSync(
        path.join(guardDir, 'policy.json'),
        JSON.stringify({
          enabled: true,
          permissionMode: 'strict-gate',
          protectEnvAndKeys: 'deny',
          blockSecretWrites: 'deny',
          blockDestructiveCommands: 'deny',
          askOnNetworkPipes: 'ask',
          autoSnapshotBeforeEdit: true,
          maxSnapshotsPerFile: 30,
          maxSnapshotFileBytes: 1_048_576,
          customProtectedPaths: [],
          customBlockedCommands: [],
        }),
        { mode: 0o600 },
      );
      const realGuardForceAsk = await dispatchNovHook(rawInput, 'PreToolUse', dataDir, {
        turboCliEntryPath: fakeCli,
      });
      assert.equal(realGuardForceAsk.decision, 'force_ask');
      assert.equal(realGuardForceAsk.overwrite, undefined);
    });
  });
});

describe('v0.8.0 executeSafeCompactRun real execution, failure tail & redacted 0600 raw log', () => {
  it('rejects tampered/non-whitelisted base64url payloads in depth without spawning', () => {
    const tamperedPayloads = [
      encodeRawPayload({ v: 1, executable: 'sh', args: ['-c', 'echo pwned'], preset: 'test' }),
      encodeRawPayload({ v: 1, executable: 'git', args: ['-c', 'core.pager=id', 'status'], preset: 'git' }),
      encodeRawPayload({ v: 1, executable: 'npm', args: ['install', 'evil'], preset: 'build' }),
      encodeRawPayload({ v: 1, executable: 'git', args: ['status;id'], preset: 'git' }),
      '!!!not-valid-base64url!!!',
    ];

    for (const payloadB64 of tamperedPayloads) {
      const res = executeSafeCompactRun({ payloadB64 });
      assert.equal(res.exitCode, 126);
      assert.ok(res.output.includes('Rejected'));
    }
  });

  it('executes real whitelisted git status in a temp repo, compacts output, and saves 0600 last-raw.log', async () => {
    await withTempDir('agy-nov-v08-git-', (tmpBase) => {
      const repoDir = path.join(tmpBase, 'repo');
      const dataDir = path.join(tmpBase, 'nov-data');
      fs.mkdirSync(repoDir, { recursive: true });
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

      execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
      for (let i = 0; i < 30; i += 1) {
        fs.writeFileSync(path.join(repoDir, `file-${String(i).padStart(2, '0')}.txt`), `hello ${i}\n`);
      }

      const parsed = parseSafeAutoRtkCommand('git status --short');
      assert.equal(parsed.ok, true);
      if (!parsed.ok) return;

      const payloadB64 = encodeRawPayload({
        v: 1,
        executable: parsed.executable,
        args: parsed.args,
        preset: parsed.preset,
      });

      const res = executeSafeCompactRun({ payloadB64, cwd: repoDir, dataDir });
      assert.equal(res.exitCode, 0);
      assert.ok(res.output.includes('[Turbo Compact]'));
      assert.ok(res.rawLogPath && fs.existsSync(res.rawLogPath));
      assert.ok(res.output.includes(res.rawLogPath));
      assert.ok(res.rawTokens > 0);
      assert.ok(res.summaryTokens > 0);

      if (process.platform !== 'win32') {
        const mode = fs.statSync(res.rawLogPath).mode & 0o777;
        assert.equal(mode, 0o600);
      }

      // Missing dataDir -> zero directory creation and no rawLogPath
      const absentDataDir = path.join(tmpBase, 'absent-data');
      const noLogRes = executeSafeCompactRun({ payloadB64, cwd: repoDir, dataDir: absentDataDir });
      assert.equal(noLogRes.exitCode, 0);
      assert.equal(noLogRes.rawLogPath, undefined);
      assert.equal(fs.existsSync(absentDataDir), false);
    });
  });

  it('preserves original non-zero exit code, >=60 failure stack lines, and redacts secrets in last-raw.log', async () => {
    await withTempDir('agy-nov-v08-fail-', (tmpBase) => {
      const projDir = path.join(tmpBase, 'proj');
      const dataDir = path.join(tmpBase, 'nov-data');
      fs.mkdirSync(projDir, { recursive: true });
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

      const fakeSecretKey = ['sk', 'proj', 'ABCDEF1234567890abcdef1234567890'].join('-');
      const fakePemHeader = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ');
      const fakePemFooter = ['-----END', 'RSA PRIVATE KEY-----'].join(' ');

      const failScript = [
        'for (let i = 1; i <= 140; i++) console.log(`ok ${i} - passing verbose check #${i}`);',
        `console.log('DEBUG leak token=${fakeSecretKey}');`,
        `console.log('<private>outer <private>inner</private> OUTER_TRAIL_SECRET_XYZ</private>');`,
        `console.log(${JSON.stringify(fakePemHeader)});`,
        `console.log('MIIEFAKEPRIVATEKEYBODYLINE0123456789');`,
        `console.log(${JSON.stringify(fakePemFooter)});`,
        'for (let j = 1; j <= 65; j++) console.error(`STACK_FRAME_${String(j).padStart(2, "0")}: at failTest (src/demo.ts:${j}:1)`);',
        'process.exit(3);',
      ].join('\n');

      fs.writeFileSync(path.join(projDir, 'fail-runner.mjs'), failScript);
      fs.writeFileSync(
        path.join(projDir, 'package.json'),
        JSON.stringify({
          name: 'v08-fail-fixture',
          version: '1.0.0',
          scripts: {
            test: 'node fail-runner.mjs',
          },
        }),
      );

      const parsed = parseSafeAutoRtkCommand('npm test');
      assert.equal(parsed.ok, true);
      if (!parsed.ok) return;

      const payloadB64 = encodeRawPayload({
        v: 1,
        executable: parsed.executable,
        args: parsed.args,
        preset: parsed.preset,
      });

      const res = executeSafeCompactRun({ payloadB64, cwd: projDir, dataDir });
      assert.equal(res.exitCode, 3, 'Must preserve exact original non-zero exit code');

      // Last 60 stack lines (frames 06..65) must be preserved in output
      assert.ok(res.output.includes('STACK_FRAME_06:'), 'Missing start of last 60 failure lines');
      assert.ok(res.output.includes('STACK_FRAME_35:'), 'Missing middle of last 60 failure lines');
      assert.ok(res.output.includes('STACK_FRAME_65:'), 'Missing final failure line');

      // Redacted last-raw.log checks
      assert.ok(res.rawLogPath && fs.existsSync(res.rawLogPath));
      const rawLogStat = fs.statSync(res.rawLogPath);
      assert.ok(rawLogStat.size <= 128 * 1024, 'last-raw.log must stay <= 128 KiB');
      if (process.platform !== 'win32') {
        assert.equal(rawLogStat.mode & 0o777, 0o600);
      }
      const rawLogText = fs.readFileSync(res.rawLogPath, 'utf8');
      assert.equal(rawLogText.includes(fakeSecretKey), false, 'API key must be redacted in last-raw.log');
      assert.equal(
        rawLogText.includes('OUTER_TRAIL_SECRET_XYZ'),
        false,
        'Nested <private> outer trailing text must be stripped in last-raw.log',
      );
      assert.equal(
        rawLogText.includes('MIIEFAKEPRIVATEKEYBODYLINE0123456789'),
        false,
        'PEM private key body must be redacted in last-raw.log',
      );
      assert.ok(
        rawLogText.includes('[REDACTED_PRIVATE_KEY]') || rawLogText.includes('[REDACTED'),
        'Redaction markers must be present',
      );
    });
  });
});

describe('v0.8.0 PostToolUse hotspots & version/catalog alignment', () => {
  it('writes zero files when rootDataDir is missing and records redacted hotspots when rootDataDir exists', async () => {
    await withTempDir('agy-nov-v08-hotspots-', async (tmpBase) => {
      const missingRoot = path.join(tmpBase, 'missing-root');
      const missingTurboDir = getModuleDataDir(missingRoot, 'turbo');

      assert.equal(recordTurboHotspot(missingTurboDir, 'npm test', missingRoot), null);
      handleTurboPostToolHook(
        {
          event: 'PostToolUse',
          workspacePaths: [tmpBase],
          toolName: 'run_command',
          toolInput: { CommandLine: 'npm test' },
          raw: {},
        },
        missingRoot,
      );
      assert.equal(fs.existsSync(missingRoot), false, 'PostToolUse must not create missing dataDir');

      // Existing rootDataDir: records whitelisted hotspots with secret redaction & <=100 char cap
      const existingRoot = path.join(tmpBase, 'existing-root');
      fs.mkdirSync(existingRoot, { recursive: true, mode: 0o700 });
      setModuleEnabled(existingRoot, 'turbo', true);
      const turboDir = getModuleDataDir(existingRoot, 'turbo');

      const fakeGhToken = ['ghp', '1234567890abcdef1234567890abcdef1234'].join('_');
      const noisyCmd = `pytest -k test_${'x'.repeat(90)} --token=${fakeGhToken}`;

      await dispatchNovHook(
        {
          hookEventName: 'PostToolUse',
          toolCall: { name: 'run_command', args: { CommandLine: noisyCmd } },
          workspacePaths: [tmpBase],
        },
        'PostToolUse',
        existingRoot,
      );
      await dispatchNovHook(
        {
          hookEventName: 'PostToolUse',
          toolCall: { name: 'run_command', args: { command: 'git diff --stat' } },
          workspacePaths: [tmpBase],
        },
        'PostToolUse',
        existingRoot,
      );
      await dispatchNovHook(
        {
          hookEventName: 'PostToolUse',
          toolCall: { name: 'run_command', args: { CommandLine: 'git diff --cached' } },
          workspacePaths: [tmpBase],
        },
        'PostToolUse',
        existingRoot,
      );
      // compact-run and non-whitelisted commands must be ignored
      await dispatchNovHook(
        {
          hookEventName: 'PostToolUse',
          toolCall: {
            name: 'run_command',
            args: { CommandLine: "node '/tmp/cli.cjs' compact-run --payload=abc" },
          },
          workspacePaths: [tmpBase],
        },
        'PostToolUse',
        existingRoot,
      );
      await dispatchNovHook(
        {
          hookEventName: 'PostToolUse',
          toolCall: { name: 'run_command', args: { CommandLine: 'npm install evil' } },
          workspacePaths: [tmpBase],
        },
        'PostToolUse',
        existingRoot,
      );

      const hotspots = loadTurboHotspotsReadOnly(turboDir);
      assert.equal(hotspots.length, 2);
      assert.equal(hotspots[0].commandPrefix, 'git diff');
      assert.equal(hotspots[0].count, 2);
      assert.equal(hotspots[1].commandPrefix, 'pytest');
      assert.equal(hotspots[1].count, 1);
      assert.ok(hotspots[1].lastCommand.length <= 100);
      assert.equal(hotspots[1].lastCommand.includes(fakeGhToken), false);
    });
  });

  it('updates catalog turbo hooks and aligns core version constants with manifests', () => {
    assert.deepEqual(MODULE_CATALOG.turbo.hooks, ['SessionStart', 'PreToolUse', 'PostToolUse']);

    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as { version: string };
    const plugin = JSON.parse(fs.readFileSync(path.resolve('plugin.json'), 'utf8')) as { version: string };
    assert.equal(NOV_VERSION, pkg.version);
    assert.equal(plugin.version, pkg.version);
  });

  it('supports CLI compact-run with original exit code preservation and reports Auto-RTK OFF in doctor (zero writes)', async () => {
    await withTempDir('agy-nov-v08-cli-', (tmpBase) => {
      const cliSource = path.resolve('src/server/cli.ts');
      const requireFromHere = createRequire(import.meta.url);
      const tsxImportUrl = pathToFileURL(requireFromHere.resolve('tsx')).href;
      const absentDataDir = path.join(tmpBase, 'absent-cli-data');

      // 1. CLI doctor reports Auto-RTK OFF and creates no directories
      const doctorProc = spawnSync(
        process.execPath,
        ['--import', tsxImportUrl, cliSource, 'doctor', `--data-dir=${absentDataDir}`],
        { cwd: process.cwd(), encoding: 'utf8', shell: false },
      );
      assert.equal(doctorProc.status, 0, doctorProc.stderr || doctorProc.stdout);
      assert.ok(doctorProc.stdout.includes('Auto-RTK: OFF'), doctorProc.stdout);
      assert.ok(doctorProc.stdout.includes(`v${NOV_VERSION}`), doctorProc.stdout);
      assert.equal(fs.existsSync(absentDataDir), false, 'doctor must remain strictly read-only');

      // 2. CLI compact-run preserves non-zero exit code on failing whitelisted command
      const projDir = path.join(tmpBase, 'cli-proj');
      fs.mkdirSync(projDir, { recursive: true });
      fs.writeFileSync(
        path.join(projDir, 'package.json'),
        JSON.stringify({
          name: 'cli-compact-run-fixture',
          version: '1.0.0',
          scripts: { test: 'node -e "console.error(\'CLI_FAIL_MARKER\'); process.exit(4)"' },
        }),
      );
      const payloadB64 = encodeRawPayload({
        v: 1,
        executable: 'npm',
        args: ['test'],
        preset: 'test',
      });

      const runProc = spawnSync(
        process.execPath,
        [
          '--import',
          tsxImportUrl,
          cliSource,
          'compact-run',
          `--payload=${payloadB64}`,
          `--data-dir=${absentDataDir}`,
        ],
        { cwd: projDir, encoding: 'utf8', shell: false },
      );
      assert.equal(runProc.status, 4, `Expected exitCode 4, got ${runProc.status}: ${runProc.stdout}${runProc.stderr}`);
      assert.ok(runProc.stdout.includes('CLI_FAIL_MARKER'), runProc.stdout);
      assert.ok(runProc.stdout.includes('[Auto-RTK] exit=4'), runProc.stdout);
      assert.equal(fs.existsSync(absentDataDir), false, 'compact-run must not create missing dataDir');
    });
  });
});
