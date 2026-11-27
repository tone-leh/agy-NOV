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
  ALLOWED_VERIFY_EXECUTABLES,
  executeVerifyCommand,
  getVerifyStatePath,
  loadVerifyStateReadOnly,
  MAX_CAPTURE_BYTES,
  redactVerifyOutput,
  runVerifyChecksLive,
  updateVerifyPolicy,
  validateVerifyCommand,
  type VerifyEvidenceRecord,
  type VerifyStateView,
} from '../src/modules/verify/core.js';
import {
  GUARDRAIL_ALLOW_REASON,
  handleVerifyPostToolHook,
  handleVerifyStopHook,
  TRACKED_VERIFY_WRITE_TOOLS,
} from '../src/modules/verify/hook.js';
import { registerVerifyModule } from '../src/modules/verify/register.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

describe('Verify Gate — zero-write defaults & demoMode isolation', () => {
  it('writes zero files on read-only load, idle hooks, and read-only MCP calls', async () => {
    await withTempDir('agy-nov-verify-zerowrite-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'ws');
      const outside = path.join(tmpDir, 'outside');
      const dataDir = path.join(tmpDir, 'data-must-not-exist');
      fs.mkdirSync(workspace, { recursive: true });
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(path.join(outside, 'secret.txt'), '', 'utf8');
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(workspace, 'escape-link.txt'));

      const moduleDataDir = getModuleDataDir(dataDir, 'verify');
      const initial = loadVerifyStateReadOnly(moduleDataDir);
      assert.equal(initial.policy.enforceOnStop, true);
      assert.equal(initial.policy.maxConsecutiveBlocks, 3);
      assert.equal(fs.existsSync(dataDir), false);

      // Non-write PostToolUse and out-of-workspace / symlink-escape writes must not touch disk
      handleVerifyPostToolHook(
        normalizeHookPayload(
          {
            conversationId: 'conv-idle',
            workspaceRoot: workspace,
            toolName: 'read_file',
            toolInput: { Path: path.join(workspace, 'a.ts') },
          },
          'PostToolUse',
        ),
        dataDir,
      );
      handleVerifyPostToolHook(
        normalizeHookPayload(
          {
            conversationId: 'conv-idle',
            workspaceRoot: workspace,
            toolName: 'write_file',
            toolInput: { Path: '../outside/secret.txt' },
          },
          'PostToolUse',
        ),
        dataDir,
      );
      handleVerifyPostToolHook(
        normalizeHookPayload(
          {
            conversationId: 'conv-idle',
            workspaceRoot: workspace,
            toolName: 'write_file',
            toolInput: { Path: 'escape-link.txt' },
          },
          'PostToolUse',
        ),
        dataDir,
      );
      assert.equal(fs.existsSync(dataDir), false);

      // Stop hook with no dirty files allows immediately with zero disk writes
      const stopRes = await handleVerifyStopHook(
        normalizeHookPayload(
          { conversationId: 'conv-idle', workspaceRoot: workspace },
          'Stop',
        ),
        dataDir,
      );
      assert.deepEqual(stopRes, { decision: 'allow' });
      assert.equal(fs.existsSync(dataDir), false);
    });
  });

  it('keeps all demoMode reads and mutations strictly in memory with PASS/BLOCKED/PASS history', async () => {
    await withTempDir('agy-nov-verify-demo-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'demo-data-absent');
      const uiUri = 'ui://agy-nov/app.html';
      const server = new McpServer(
        { name: 'verify-demo-test', version: '0.3.0' },
        { capabilities: { tools: { listChanged: true } } },
      );

      registerVerifyModule(server, { dataDir, workspaceRoot: tmpDir, demoMode: true }, uiUri);
      assert.equal(fs.existsSync(dataDir), false);

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'verify-demo-client', version: '0.3.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        const stateCall = await client.callTool({ name: 'app_verify_get_state', arguments: {} });
        const state = stateCall.structuredContent as unknown as VerifyStateView;
        assert.equal(state.mode, 'demo');
        assert.deepEqual(
          state.evidence.map((e) => e.outcome),
          ['pass', 'blocked', 'pass'],
        );
        assert.deepEqual(state.stats, {
          totalRuns: 3,
          passedRuns: 2,
          failedRuns: 1,
          blockedStops: 1,
        });

        // Mutate policy, run checks, and clear history in demo mode — still zero disk writes
        const saveCall = await client.callTool({
          name: 'app_verify_save_policy',
          arguments: { maxConsecutiveBlocks: 5 },
        });
        assert.equal(saveCall.isError, undefined);
        assert.equal((saveCall.structuredContent as { policy: { maxConsecutiveBlocks: number } }).policy.maxConsecutiveBlocks, 5);

        const runCall = await client.callTool({
          name: 'app_verify_run_checks',
          arguments: { commandId: 'typecheck' },
        });
        assert.equal(runCall.isError, undefined);
        assert.equal((runCall.structuredContent as { run: VerifyEvidenceRecord }).run.passed, true);

        const clearCall = await client.callTool({ name: 'app_verify_clear_history', arguments: {} });
        assert.equal(clearCall.isError, undefined);
        assert.ok((clearCall.structuredContent as { cleared: number }).cleared > 0);
        assert.equal(
          (clearCall.structuredContent as { state: VerifyStateView }).state.evidence.length,
          0,
        );

        assert.equal(fs.existsSync(dataDir), false);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});

describe('Verify Gate — strict executable allowlist & anti-bypass argument guards', () => {
  it('rejects shells, path-qualified executables, interpreter eval flags, unsafe git subcommands, and oversized args', () => {
    // High-risk command launchers must never be in the executable allowlist
    assert.equal(ALLOWED_VERIFY_EXECUTABLES.has('npx'), false);
    assert.equal(ALLOWED_VERIFY_EXECUTABLES.has('make'), false);

    const forbiddenCases: Array<{ label: string; executable: string; args: string[] }> = [
      { label: 'sh shell', executable: 'sh', args: ['-c', 'echo hi'] },
      { label: 'bash shell', executable: 'bash', args: ['-c', 'id'] },
      { label: 'zsh shell', executable: 'zsh', args: ['-c', 'id'] },
      { label: 'absolute path executable', executable: '/usr/bin/node', args: ['--version'] },
      { label: 'relative slash executable', executable: './node', args: ['--version'] },
      { label: 'backslash path executable', executable: 'bin\\node', args: ['--version'] },
      { label: 'parent traversal executable', executable: '..node', args: ['--version'] },
      { label: 'whitespace executable', executable: 'node ', args: ['--version'] },
      { label: 'unlisted binary', executable: 'curl', args: ['https://example.com'] },
      // Adversarial bypass chain 1: npx & make removed from allowlist
      { label: 'npx -c bypass', executable: 'npx', args: ['-c', 'id'] },
      { label: 'make --eval bypass', executable: 'make', args: ['-f', '/dev/null', '--eval=$(shell id)'] },
      // Adversarial bypass chain 2: package manager exec / dlx / eval / script-shell
      { label: 'npm exec -c bypass', executable: 'npm', args: ['exec', '-c', 'id'] },
      { label: 'pnpm dlx bypass', executable: 'pnpm', args: ['dlx', 'cowsay', 'hi'] },
      { label: 'yarn dlx bypass', executable: 'yarn', args: ['dlx', 'cowsay'] },
      { label: 'npm run exec forbidden script', executable: 'npm', args: ['run', 'exec'] },
      { label: 'npm run eval forbidden script', executable: 'npm', args: ['run', 'eval'] },
      { label: 'npm run dlx forbidden script', executable: 'npm', args: ['run', 'dlx'] },
      { label: 'npm run x forbidden script', executable: 'npm', args: ['run', 'x'] },
      { label: 'npm install disallowed', executable: 'npm', args: ['install', 'evil-pkg'] },
      { label: 'npm config set disallowed', executable: 'npm', args: ['config', 'set', 'init-module', 'x'] },
      { label: 'npm run --script-shell bypass', executable: 'npm', args: ['run', 'test', '--script-shell=/bin/sh'] },
      { label: 'npm test --shell bypass', executable: 'npm', args: ['test', '--shell', '/bin/sh'] },
      { label: 'npm test --call bypass', executable: 'npm', args: ['test', '--call', 'id'] },
      { label: 'npm test --onload-script bypass', executable: 'npm', args: ['test', '--onload-script=./evil.js'] },
      {
        label: 'npm run --node-options=data: bypass',
        executable: 'npm',
        args: ['run', 'ok', '--node-options=--import=data:text/javascript,console.log(1)'],
      },
      {
        label: 'npm run --node-options space bypass',
        executable: 'npm',
        args: ['run', 'ok', '--node-options', '--import=data:text/javascript,console.log(1)'],
      },
      {
        label: 'npm test --node_options underscore bypass',
        executable: 'npm',
        args: ['test', '--node_options=--import=tsx'],
      },
      {
        label: 'npm run unknown pre-dash option bypass',
        executable: 'npm',
        args: ['run', 'ok', '--prefix', '/tmp/other'],
      },
      { label: 'bun -e bypass', executable: 'bun', args: ['-e', 'console.log(1)'] },
      { label: 'bun x bypass', executable: 'bun', args: ['x', 'cowsay'] },
      { label: 'bun -p bypass', executable: 'bun', args: ['-p', '1+1'] },
      // Adversarial bypass chain 3: node --import data:/file:, -r/--require/--loader/--env-file/--inspect, path escape
      { label: 'node -e', executable: 'node', args: ['-e', 'console.log(1)'] },
      { label: 'node --eval', executable: 'node', args: ['--eval', 'console.log(1)'] },
      { label: 'node --eval=...', executable: 'node', args: ['--eval=process.exit(0)'] },
      { label: 'node -p', executable: 'node', args: ['-p', '1+1'] },
      { label: 'node --print', executable: 'node', args: ['--print', '1+1'] },
      { label: 'node --print=...', executable: 'node', args: ['--print=1+1'] },
      { label: 'node -c', executable: 'node', args: ['-c', 'app.js'] },
      { label: 'node bundled -pe', executable: 'node', args: ['-pe', '1+1'] },
      { label: 'node compact -e...', executable: 'node', args: ['-econsole.log(1)'] },
      {
        label: 'node --import=data: URL bypass',
        executable: 'node',
        args: ['--import=data:text/javascript,console.log(1)'],
      },
      {
        label: 'node --import data: URL bypass',
        executable: 'node',
        args: ['--import', 'data:text/javascript,console.log(1)'],
      },
      {
        label: 'node --import=file: URL bypass',
        executable: 'node',
        args: ['--import=file:///tmp/evil.mjs'],
      },
      { label: 'node --import relative path', executable: 'node', args: ['--import', './evil.mjs'] },
      { label: 'node --import parent path', executable: 'node', args: ['--import', '../evil.mjs'] },
      { label: 'node --import missing value', executable: 'node', args: ['--import'] },
      { label: 'node -r preload', executable: 'node', args: ['-r', './evil.js', '--version'] },
      { label: 'node --require preload', executable: 'node', args: ['--require=./evil.js', '--version'] },
      { label: 'node --loader', executable: 'node', args: ['--loader', './evil.mjs'] },
      { label: 'node --experimental-loader', executable: 'node', args: ['--experimental-loader=./evil.mjs'] },
      { label: 'node --env-file', executable: 'node', args: ['--env-file=.env', 'check.mjs'] },
      { label: 'node --env_file underscore alias', executable: 'node', args: ['--env_file=.env', 'check.mjs'] },
      { label: 'node --inspect', executable: 'node', args: ['--inspect', 'check.mjs'] },
      { label: 'node --inspect-brk', executable: 'node', args: ['--inspect-brk=0.0.0.0:9229', 'check.mjs'] },
      { label: 'node --inspect_brk underscore alias', executable: 'node', args: ['--inspect_brk', 'check.mjs'] },
      { label: 'node inspect subcommand', executable: 'node', args: ['inspect', 'check.mjs'] },
      { label: 'node --debug-port', executable: 'node', args: ['--debug-port=9229', 'check.mjs'] },
      { label: 'node --experimental-config-file', executable: 'node', args: ['--experimental-config-file=evil.json', 'check.mjs'] },
      { label: 'node --openssl-config', executable: 'node', args: ['--openssl-config=evil.cnf', 'check.mjs'] },
      { label: 'node --test-global-setup', executable: 'node', args: ['--test-global-setup=evil.mjs', '--test'] },
      { label: 'go vet -vettool bypass', executable: 'go', args: ['vet', '-vettool=evil', './...'] },
      { label: 'node absolute path arg', executable: 'node', args: ['/etc/passwd'] },
      { label: 'node parent traversal arg', executable: 'node', args: ['../outside/evil.mjs'] },
      { label: 'node windows drive path arg', executable: 'node', args: ['C:\\Windows\\evil.mjs'] },
      // Adversarial bypass chain 4: python3 arbitrary -m / -i / - / path escape
      { label: 'python3 -c', executable: 'python3', args: ['-c', 'import os'] },
      { label: 'python3 compact -c...', executable: 'python3', args: ['-cimport os'] },
      { label: 'python3 bundled -uc', executable: 'python3', args: ['-uc', 'print(1)'] },
      { label: 'python3 -e', executable: 'python3', args: ['-e', 'print(1)'] },
      { label: 'python3 --eval', executable: 'python3', args: ['--eval', '1'] },
      { label: 'python3 -m timeit bypass', executable: 'python3', args: ['-m', 'timeit', '-s', 'import os', 'os.getpid()'] },
      { label: 'python3 -m pdb bypass', executable: 'python3', args: ['-m', 'pdb', 'script.py'] },
      { label: 'python3 -m code bypass', executable: 'python3', args: ['-m', 'code'] },
      { label: 'python3 -m pip bypass', executable: 'python3', args: ['-m', 'pip', 'install', 'evil'] },
      { label: 'python3 -i interactive', executable: 'python3', args: ['-i'] },
      { label: 'python3 stdin dash', executable: 'python3', args: ['-'] },
      { label: 'python3 script path', executable: 'python3', args: ['/tmp/evil.py'] },
      { label: 'python3 -m pytest absolute path', executable: 'python3', args: ['-m', 'pytest', '/etc/passwd'] },
      { label: 'python3 -m pytest parent traversal', executable: 'python3', args: ['-m', 'pytest', '../outside'] },
      // Adversarial bypass chain 5: go -exec/-toolexec & cargo --config
      { label: 'go test -exec sh bypass', executable: 'go', args: ['test', '-exec', 'sh', './...'] },
      { label: 'go test -exec=sh bypass', executable: 'go', args: ['test', '-exec=sh', './...'] },
      { label: 'go test --exec sh bypass', executable: 'go', args: ['test', '--exec', 'sh', './...'] },
      { label: 'go test -toolexec bypass', executable: 'go', args: ['test', '-toolexec=/bin/sh', './...'] },
      { label: 'go test --toolexec bypass', executable: 'go', args: ['test', '--toolexec', '/bin/sh', './...'] },
      { label: 'go run disallowed', executable: 'go', args: ['run', 'main.go'] },
      { label: 'go build absolute output', executable: 'go', args: ['build', '-o', '/tmp/evil'] },
      { label: 'cargo --config bypass', executable: 'cargo', args: ['test', '--config', 'build.rustc-wrapper=sh'] },
      { label: 'cargo --config= bypass', executable: 'cargo', args: ['test', '--config=target.x.runner=sh'] },
      { label: 'cargo leading --config', executable: 'cargo', args: ['--config', 'a=b', 'test'] },
      { label: 'cargo run disallowed', executable: 'cargo', args: ['run'] },
      { label: 'cargo parent traversal', executable: 'cargo', args: ['test', '--manifest-path', '../Cargo.toml'] },
      // Adversarial bypass chain 6: git implicit --no-index absolute/home/.. path read & global flags
      { label: 'git push', executable: 'git', args: ['push', 'origin', 'main'] },
      { label: 'git commit', executable: 'git', args: ['commit', '-m', 'test'] },
      { label: 'git -c config bypass', executable: 'git', args: ['-c', 'core.pager=sh', 'status'] },
      { label: 'git -C dir bypass', executable: 'git', args: ['-C', '/etc', 'status'] },
      { label: 'git --git-dir bypass', executable: 'git', args: ['--git-dir=/tmp/g', 'status'] },
      { label: 'git --work-tree bypass', executable: 'git', args: ['--work-tree=/etc', 'status'] },
      { label: 'git empty args', executable: 'git', args: [] },
      { label: 'git diff --output', executable: 'git', args: ['diff', '--output=/tmp/out'] },
      { label: 'git diff --ext-diff', executable: 'git', args: ['diff', '--ext-diff'] },
      { label: 'git diff --no-index', executable: 'git', args: ['diff', '--no-index', '/etc/hosts', '/dev/null'] },
      { label: 'git diff implicit --no-index absolute paths', executable: 'git', args: ['diff', '/etc/hosts', '/dev/null'] },
      { label: 'git diff parent traversal', executable: 'git', args: ['diff', '../outside/secret.txt'] },
      { label: 'git diff home path', executable: 'git', args: ['diff', '~/secret.txt'] },
      { label: 'git diff pathspec magic abs path', executable: 'git', args: ['diff', ':(top)/etc/hosts'] },
      { label: 'git diff windows drive path', executable: 'git', args: ['diff', 'C:\\Windows\\win.ini'] },
      // Linter / tester path escape & -c/--eval guards
      { label: 'eslint -c config', executable: 'eslint', args: ['-c', 'evil.js', 'src'] },
      { label: 'eslint absolute path', executable: 'eslint', args: ['/etc/passwd'] },
      { label: 'pytest parent traversal', executable: 'pytest', args: ['../outside/test_evil.py'] },
      { label: 'tsc absolute tsconfig', executable: 'tsc', args: ['-p', '/etc/tsconfig.json'] },
      { label: 'vitest --eval', executable: 'vitest', args: ['--eval=1'] },
      { label: 'jest -c config', executable: 'jest', args: ['-c', 'evil.config.js'] },
      { label: 'ruff absolute path', executable: 'ruff', args: ['check', '/etc'] },
      { label: 'NUL byte in arg', executable: 'node', args: ['script.js\0evil'] },
      { label: 'too many args (>20)', executable: 'node', args: Array.from({ length: 21 }, (_, i) => `a${i}`) },
      { label: 'arg too long (>256)', executable: 'node', args: ['a'.repeat(257)] },
    ];

    for (const tc of forbiddenCases) {
      const res = validateVerifyCommand({
        id: 'test-cmd',
        label: tc.label,
        executable: tc.executable,
        args: tc.args,
        timeoutMs: 5000,
        enabled: true,
      });
      assert.equal(res.valid, false, `Expected rejection for case: ${tc.label}`);
    }

    // Legitimate allowlisted commands must pass validation
    const allowedCases: Array<{ executable: string; args: string[] }> = [
      { executable: 'node', args: ['--version'] },
      { executable: 'node', args: ['--check', 'dist/server.cjs'] },
      { executable: 'node', args: ['--import', 'tsx', '--test', 'test/verify-module.test.ts'] },
      { executable: 'node', args: ['--import=tsx', '--test', 'test/verify-module.test.ts'] },
      { executable: 'python3', args: ['--version'] },
      { executable: 'python3', args: ['-m', 'pytest', '-q'] },
      { executable: 'python3', args: ['-m', 'unittest'] },
      { executable: 'git', args: ['status', '--short'] },
      { executable: 'git', args: ['diff', '--stat'] },
      { executable: 'git', args: ['diff', 'src/core/config.ts'] },
      { executable: 'git', args: ['rev-parse', '--short', 'HEAD'] },
      { executable: 'git', args: ['check-ignore', '.env'] },
      { executable: 'npm', args: ['run', 'typecheck'] },
      { executable: 'npm', args: ['test'] },
      { executable: 'npm', args: ['--version'] },
      { executable: 'pnpm', args: ['run', 'build'] },
      { executable: 'yarn', args: ['test'] },
      { executable: 'bun', args: ['run', 'test'] },
      { executable: 'go', args: ['test', './...'] },
      { executable: 'go', args: ['vet', './...'] },
      { executable: 'cargo', args: ['test'] },
      { executable: 'cargo', args: ['fmt', '--check'] },
      { executable: 'tsc', args: ['--noEmit'] },
      { executable: 'tsc', args: ['-p', 'tsconfig.json', '--noEmit'] },
      { executable: 'vitest', args: ['run'] },
      { executable: 'jest', args: ['--runInBand'] },
      { executable: 'pytest', args: ['-q'] },
      { executable: 'ruff', args: ['check', 'src'] },
      { executable: 'eslint', args: ['src'] },
    ];

    for (const tc of allowedCases) {
      assert.equal(ALLOWED_VERIFY_EXECUTABLES.has(tc.executable), true);
      const res = validateVerifyCommand({
        id: 'safe-cmd',
        label: 'Safe check',
        executable: tc.executable,
        args: tc.args,
        timeoutMs: 5000,
        enabled: true,
      });
      assert.equal(res.valid, true, `Expected acceptance for ${tc.executable} ${tc.args.join(' ')}`);
    }
  });

  it('enforces defense-in-depth if state.json on disk is tampered with disallowed commands', async () => {
    await withTempDir('agy-nov-verify-tamper-', async (tmpDir) => {
      const moduleDataDir = getModuleDataDir(tmpDir, 'verify');
      fs.mkdirSync(moduleDataDir, { recursive: true });
      fs.writeFileSync(
        getVerifyStatePath(moduleDataDir),
        JSON.stringify({
          schemaVersion: 1,
          policy: {
            enforceOnStop: true,
            autoRunOnStop: true,
            blockEmptyWrites: true,
            maxConsecutiveBlocks: 3,
            commands: [
              { id: 'evil-sh', label: 'Evil', executable: 'bash', args: ['-c', 'echo pwn'], timeoutMs: 5000, enabled: true },
              { id: 'evil-eval', label: 'Eval', executable: 'node', args: ['-e', 'process.exit(0)'], timeoutMs: 5000, enabled: true },
              { id: 'safe-node', label: 'Node Version', executable: 'node', args: ['--version'], timeoutMs: 5000, enabled: true },
            ],
          },
          sessions: {},
          evidence: [],
          blockedStops: 0,
          updatedAt: new Date().toISOString(),
        }),
        'utf8',
      );

      const loaded = loadVerifyStateReadOnly(moduleDataDir);
      assert.deepEqual(
        loaded.policy.commands.map((c) => c.id),
        ['safe-node'],
      );

      // Even calling executeVerifyCommand directly refuses non-allowlisted commands
      const directRes = await executeVerifyCommand(
        { id: 'direct-evil', label: 'Direct', executable: 'sh', args: ['-c', 'echo pwn'], timeoutMs: 5000, enabled: true },
        tmpDir,
      );
      assert.equal(directRes.passed, false);
      assert.equal(directRes.exitCode, null);
      assert.match(directRes.error ?? '', /allowlist/i);
    });
  });
});

describe('Verify Gate — real command execution, secret redaction & evidence persistence', () => {
  it('runs real safe commands in a temp workspace, captures exit codes, redacts secrets, and persists evidence', async () => {
    await withTempDir('agy-nov-verify-exec-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'data');
      const moduleDataDir = getModuleDataDir(dataDir, 'verify');
      fs.mkdirSync(workspace, { recursive: true });

      const fakeSecrets = [
        'sk-testLeakSecretKey1234567890abcd',
        'ghp_1234567890abcdef1234567890abcd',
        'AKIAIOSFODNN7EXAMPLE',
        'Bearer topSecretBearerValue987654321',
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAtester\n-----END RSA PRIVATE KEY-----',
      ];

      // Script that leaks fake secrets to stdout/stderr and exits with code 3
      fs.writeFileSync(
        path.join(workspace, 'fail-with-secrets.mjs'),
        [
          `console.log("API=${fakeSecrets[0]} GH=${fakeSecrets[1]}");`,
          `console.error("AWS=${fakeSecrets[2]} AUTH=${fakeSecrets[3]}");`,
          `console.error(${JSON.stringify(fakeSecrets[4])});`,
          'console.error("AssertionError: expected 42 to equal 99");',
          'process.exit(3);',
        ].join('\n'),
        'utf8',
      );

      const savedPolicy = updateVerifyPolicy(moduleDataDir, {
        commands: [
          {
            id: 'node-ver',
            label: 'Node Version',
            executable: 'node',
            args: ['--version'],
            timeoutMs: 5000,
            enabled: true,
          },
          {
            id: 'fail-leak',
            label: 'Failing Check With Secrets',
            executable: 'node',
            args: ['fail-with-secrets.mjs'],
            timeoutMs: 5000,
            enabled: true,
          },
          {
            id: 'missing-script',
            label: 'Missing Script',
            executable: 'node',
            args: ['does-not-exist-check.mjs'],
            timeoutMs: 5000,
            enabled: false,
          },
        ],
      });
      assert.equal(savedPolicy.valid, true);

      // 1. Run single passing command (`node --version`)
      const passRun = await runVerifyChecksLive(moduleDataDir, workspace, {
        commandId: 'node-ver',
        conversationId: 'conv-exec',
      });
      assert.equal(passRun.ok, true);
      if (passRun.ok) {
        assert.equal(passRun.run.passed, true);
        assert.equal(passRun.run.outcome, 'pass');
        assert.equal(passRun.run.results[0].exitCode, 0);
        assert.match(passRun.run.results[0].outputTail, /^v\d+\.\d+/);
      }

      // 2. Run all enabled commands -> node-ver passes, fail-leak fails with exit code 3 & redacted secrets
      const mixedRun = await runVerifyChecksLive(moduleDataDir, workspace, {
        conversationId: 'conv-exec',
      });
      assert.equal(mixedRun.ok, true);
      if (mixedRun.ok) {
        assert.equal(mixedRun.run.passed, false);
        assert.equal(mixedRun.run.outcome, 'fail');
        assert.equal(mixedRun.run.results.length, 2);
        assert.equal(mixedRun.run.results[0].passed, true);
        assert.equal(mixedRun.run.results[1].passed, false);
        assert.equal(mixedRun.run.results[1].exitCode, 3);
        assert.match(mixedRun.run.results[1].outputTail, /AssertionError: expected 42 to equal 99/);

        const rawDiskText = fs.readFileSync(getVerifyStatePath(moduleDataDir), 'utf8');
        for (const secret of fakeSecrets) {
          assert.equal(mixedRun.run.results[1].outputTail.includes(secret), false, `Output leaked secret: ${secret}`);
          assert.equal(rawDiskText.includes(secret), false, `Disk state leaked secret: ${secret}`);
        }
        assert.match(mixedRun.run.results[1].outputTail, /\[REDACTED_KEY\]/);
        assert.match(mixedRun.run.results[1].outputTail, /Bearer \[REDACTED\]/);
        assert.match(mixedRun.run.results[1].outputTail, /\[REDACTED_PRIVATE_KEY\]/);
      }

      // 3. Run missing script command -> non-zero exit code
      const missingRun = await runVerifyChecksLive(moduleDataDir, workspace, {
        commandId: 'missing-script',
      });
      assert.equal(missingRun.ok, true);
      if (missingRun.ok) {
        assert.equal(missingRun.run.passed, false);
        assert.notEqual(missingRun.run.results[0].exitCode, 0);
      }

      // Direct redaction helper sanity check for truncated private key
      assert.equal(
        redactVerifyOutput('prefix -----BEGIN OPENSSH PRIVATE KEY-----\nabcdef'),
        'prefix [REDACTED_PRIVATE_KEY]',
      );

      // 4. Oversized (>64KB) stdout completes cleanly with outputTruncated=true instead of maxBuffer crash
      fs.writeFileSync(
        path.join(workspace, 'big-output.mjs'),
        'process.stdout.write("A".repeat(160 * 1024) + "\\nTAIL_MARKER_OK\\n");\n',
        'utf8',
      );
      const bigRes = await executeVerifyCommand(
        {
          id: 'big-out',
          label: 'Big Output',
          executable: 'node',
          args: ['big-output.mjs'],
          timeoutMs: 5000,
          enabled: true,
        },
        workspace,
      );
      assert.equal(bigRes.passed, true);
      assert.equal(bigRes.exitCode, 0);
      assert.equal(bigRes.outputTruncated, true);
      assert.match(bigRes.outputTail, /TAIL_MARKER_OK/);

      // 5. Timeout enforcement terminates long-running command cleanly
      fs.writeFileSync(
        path.join(workspace, 'slow-script.mjs'),
        'setTimeout(() => { console.log("too late"); }, 5000);\n',
        'utf8',
      );
      const timeoutRes = await executeVerifyCommand(
        {
          id: 'slow',
          label: 'Slow Check',
          executable: 'node',
          args: ['slow-script.mjs'],
          timeoutMs: 1000,
          enabled: true,
        },
        workspace,
      );
      assert.equal(timeoutRes.passed, false);
      assert.equal(timeoutRes.timedOut, true);
      assert.match(timeoutRes.error ?? '', /timed out/i);
    });
  });

  it('passes commands emitting >2 MiB stdout without maxBuffer SIGTERM and caps tail <= 64KB', async () => {
    await withTempDir('agy-nov-verify-large-out-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'ws');
      fs.mkdirSync(workspace, { recursive: true });

      // Emit ~3 MiB across 48 x 64KB chunks followed by a distinct tail marker
      fs.writeFileSync(
        path.join(workspace, 'emit-3mb.mjs'),
        [
          'const chunk = "B".repeat(64 * 1024);',
          'for (let i = 0; i < 48; i += 1) {',
          '  process.stdout.write(chunk);',
          '}',
          'process.stdout.write("\\nTAIL_MARKER_3MB_OK\\n");',
        ].join('\n'),
        'utf8',
      );

      const res = await executeVerifyCommand(
        {
          id: 'large-out',
          label: '3 MiB Output Check',
          executable: 'node',
          args: ['emit-3mb.mjs'],
          timeoutMs: 10_000,
          enabled: true,
        },
        workspace,
      );

      assert.equal(res.passed, true);
      assert.equal(res.exitCode, 0);
      assert.equal(res.timedOut, false);
      assert.equal(res.outputTruncated, true);
      assert.ok(Buffer.byteLength(res.outputTail, 'utf8') <= MAX_CAPTURE_BYTES);
      assert.match(res.outputTail, /TAIL_MARKER_3MB_OK/);
    });
  });

  it('kills timed-out process groups including grandchildren holding stdout pipe within <2200ms', async () => {
    await withTempDir('agy-nov-verify-pgkill-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'ws');
      fs.mkdirSync(workspace, { recursive: true });

      const pidFile = path.join(workspace, 'grandchild.pid');
      fs.writeFileSync(
        path.join(workspace, 'grandchild-holder.mjs'),
        [
          'process.on("SIGTERM", () => {});',
          'process.stdout.write("grandchild-alive\\n");',
          'setInterval(() => {}, 1000);',
        ].join('\n'),
        'utf8',
      );
      fs.writeFileSync(
        path.join(workspace, 'spawn-grandchild.mjs'),
        [
          'import { spawn } from "node:child_process";',
          'import fs from "node:fs";',
          'const gc = spawn(process.execPath, ["grandchild-holder.mjs"], {',
          '  stdio: ["ignore", "inherit", "inherit"],',
          '});',
          'fs.writeFileSync("grandchild.pid", String(gc.pid), "utf8");',
          'setInterval(() => {}, 1000);',
        ].join('\n'),
        'utf8',
      );

      let grandchildPid: number | null = null;
      try {
        const startedAt = Date.now();
        const res = await executeVerifyCommand(
          {
            id: 'pg-timeout',
            label: 'Grandchild Pipe Holder',
            executable: 'node',
            args: ['spawn-grandchild.mjs'],
            timeoutMs: 1000,
            enabled: true,
          },
          workspace,
        );
        const elapsedMs = Date.now() - startedAt;

        assert.equal(res.passed, false);
        assert.equal(res.timedOut, true);
        assert.match(res.error ?? '', /timed out/i);
        assert.ok(elapsedMs < 2200, `Expected timeout settle <2200ms, got ${elapsedMs}ms`);

        if (fs.existsSync(pidFile)) {
          const parsed = Number(fs.readFileSync(pidFile, 'utf8').trim());
          if (Number.isInteger(parsed) && parsed > 0) {
            grandchildPid = parsed;
            // Confirm grandchild was terminated by process-group SIGKILL (POSIX) or taskkill /T /F (Windows)
            let alive = true;
            const maxAttempts = process.platform === 'win32' ? 25 : 10;
            const waitMs = process.platform === 'win32' ? 50 : 30;
            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
              try {
                process.kill(grandchildPid, 0);
                await new Promise((r) => setTimeout(r, waitMs));
              } catch {
                alive = false;
                break;
              }
            }
            assert.equal(alive, false, `Grandchild pid ${grandchildPid} should have been killed`);
          }
        }
      } finally {
        if (grandchildPid) {
          try {
            process.kill(grandchildPid, 'SIGKILL');
          } catch {
            // already dead
          }
        }
      }
    });
  });
});

describe('Verify Gate — PostToolUse + Stop hook enforcement & loop guardrail', () => {
  it('blocks 0-byte writes and failing checks, allows after fix, and triggers maxConsecutiveBlocks guardrail', async () => {
    await withTempDir('agy-nov-verify-hooks-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'data');
      const moduleDataDir = getModuleDataDir(dataDir, 'verify');
      fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });

      // Verification script: checks src/feature.ts contains "export const READY = true;"
      fs.writeFileSync(
        path.join(workspace, 'check-ready.mjs'),
        [
          'import fs from "node:fs";',
          'const text = fs.readFileSync("src/feature.ts", "utf8");',
          'if (!text.includes("READY = true")) {',
          '  console.error("Verify failed: READY flag missing (token=sk-hookLeakSecret1234567890)");',
          '  process.exit(2);',
          '}',
          'console.log("READY check passed");',
        ].join('\n'),
        'utf8',
      );

      const policyRes = updateVerifyPolicy(moduleDataDir, {
        enforceOnStop: true,
        autoRunOnStop: true,
        blockEmptyWrites: true,
        maxConsecutiveBlocks: 2,
        commands: [
          {
            id: 'ready-check',
            label: 'Ready Flag Check',
            executable: 'node',
            args: ['check-ready.mjs'],
            timeoutMs: 5000,
            enabled: true,
          },
        ],
      });
      assert.equal(policyRes.valid, true);

      const targetFile = path.join(workspace, 'src', 'feature.ts');

      // Step 1: Agent creates an empty 0-byte file -> PostToolUse records dirtyFiles & emptyFiles
      fs.writeFileSync(targetFile, '', 'utf8');
      handleVerifyPostToolHook(
        normalizeHookPayload(
          {
            conversationId: 'conv-flow',
            workspaceRoot: workspace,
            toolName: 'write_file',
            toolInput: { Path: targetFile },
          },
          'PostToolUse',
        ),
        dataDir,
      );

      let state = loadVerifyStateReadOnly(moduleDataDir);
      assert.deepEqual(state.sessions['conv-flow']?.dirtyFiles, ['src/feature.ts']);
      assert.deepEqual(state.sessions['conv-flow']?.emptyFiles, ['src/feature.ts']);

      // Stop #1: Blocked because file is 0 bytes (Antigravity Stop protocol uses decision="continue")
      const stopEmpty = await handleVerifyStopHook(
        normalizeHookPayload({ conversationId: 'conv-flow', workspaceRoot: workspace }, 'Stop'),
        dataDir,
      );
      assert.equal(stopEmpty.decision, 'continue');
      assert.match(stopEmpty.reason ?? '', /\[agy-NOV Verify Gate\]/);
      assert.match(stopEmpty.reason ?? '', /empty \(0-byte\)/i);

      // Step 2: Agent writes non-empty but still broken content -> PostToolUse removes from emptyFiles
      fs.writeFileSync(targetFile, 'export const READY = false;\n', 'utf8');
      handleVerifyPostToolHook(
        normalizeHookPayload(
          {
            conversationId: 'conv-flow',
            workspaceRoot: workspace,
            toolName: 'edit_file',
            toolInput: { file_path: 'src/feature.ts' },
          },
          'PostToolUse',
        ),
        dataDir,
      );

      state = loadVerifyStateReadOnly(moduleDataDir);
      assert.deepEqual(state.sessions['conv-flow']?.emptyFiles, []);

      // Stop #2: Blocked because check-ready.mjs exits 2; reason must include redacted tail
      const stopFail = await handleVerifyStopHook(
        normalizeHookPayload({ conversationId: 'conv-flow', workspaceRoot: workspace }, 'Stop'),
        dataDir,
      );
      assert.equal(stopFail.decision, 'continue');
      assert.match(stopFail.reason ?? '', /\[agy-NOV Verify Gate\]/);
      assert.match(stopFail.reason ?? '', /exit=2/);
      assert.match(stopFail.reason ?? '', /READY flag missing/);
      assert.equal((stopFail.reason ?? '').includes('sk-hookLeakSecret1234567890'), false);

      // Verify consecutiveBlocks is now 2 (= maxConsecutiveBlocks)
      state = loadVerifyStateReadOnly(moduleDataDir);
      assert.equal(state.sessions['conv-flow']?.consecutiveBlocks, 2);

      // Stop #3 with continuationActive=true: hits maxConsecutiveBlocks guardrail -> allows stop safely!
      const stopGuardrail = await handleVerifyStopHook(
        normalizeHookPayload(
          {
            conversationId: 'conv-flow',
            workspaceRoot: workspace,
            continuation_active: true,
          },
          'Stop',
        ),
        dataDir,
      );
      assert.equal(stopGuardrail.decision, 'allow');
      assert.equal(stopGuardrail.reason, GUARDRAIL_ALLOW_REASON);

      state = loadVerifyStateReadOnly(moduleDataDir);
      assert.equal(state.evidence[0]?.outcome, 'guardrail-allow');
      assert.match(state.evidence[0]?.summary ?? '', /continuationActive=true/);
      assert.equal(state.sessions['conv-flow']?.consecutiveBlocks, 0);

      // Step 3: Next turn agent fixes the file -> PostToolUse + Stop -> PASS and clean session!
      fs.writeFileSync(targetFile, 'export const READY = true;\n', 'utf8');
      handleVerifyPostToolHook(
        normalizeHookPayload(
          {
            conversationId: 'conv-flow',
            workspaceRoot: workspace,
            toolName: 'replace_file_content',
            toolInput: { TargetFile: targetFile },
          },
          'PostToolUse',
        ),
        dataDir,
      );

      const stopPass = await handleVerifyStopHook(
        normalizeHookPayload({ conversationId: 'conv-flow', workspaceRoot: workspace }, 'Stop'),
        dataDir,
      );
      assert.equal(stopPass.decision, 'allow');
      assert.equal(stopPass.reason, undefined);

      state = loadVerifyStateReadOnly(moduleDataDir);
      assert.deepEqual(state.sessions['conv-flow']?.dirtyFiles, []);
      assert.deepEqual(state.sessions['conv-flow']?.emptyFiles, []);
      assert.equal(state.sessions['conv-flow']?.consecutiveBlocks, 0);
      assert.equal(state.sessions['conv-flow']?.lastVerifiedPassed, true);
      assert.ok(state.sessions['conv-flow']?.lastVerifiedAt);
      assert.equal(state.evidence[0]?.outcome, 'pass');
    });
  });

  it('blocks unverified edits when autoRunOnStop=false until verify_run_checks passes', async () => {
    await withTempDir('agy-nov-verify-manual-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'data');
      const moduleDataDir = getModuleDataDir(dataDir, 'verify');
      fs.mkdirSync(workspace, { recursive: true });

      updateVerifyPolicy(moduleDataDir, {
        enforceOnStop: true,
        autoRunOnStop: false,
        blockEmptyWrites: true,
        maxConsecutiveBlocks: 3,
        commands: [
          {
            id: 'node-ver',
            label: 'Node Version',
            executable: 'node',
            args: ['--version'],
            timeoutMs: 5000,
            enabled: true,
          },
        ],
      });

      const fileA = path.join(workspace, 'index.ts');
      fs.writeFileSync(fileA, 'export const x = 1;\n', 'utf8');
      handleVerifyPostToolHook(
        normalizeHookPayload(
          {
            conversationId: 'conv-manual',
            workspaceRoot: workspace,
            toolName: 'create_file',
            toolInput: { Path: fileA },
          },
          'PostToolUse',
        ),
        dataDir,
      );

      // Stop before manual verify_run_checks -> continued with prompt to run verify_run_checks
      const blocked = await handleVerifyStopHook(
        normalizeHookPayload({ conversationId: 'conv-manual', workspaceRoot: workspace }, 'Stop'),
        dataDir,
      );
      assert.equal(blocked.decision, 'continue');
      assert.match(blocked.reason ?? '', /verify_run_checks/);

      // Run manual checks -> passes and updates session
      const checkRes = await runVerifyChecksLive(moduleDataDir, workspace, {
        conversationId: 'conv-manual',
      });
      assert.equal(checkRes.ok, true);

      // Stop now succeeds cleanly
      const allowed = await handleVerifyStopHook(
        normalizeHookPayload({ conversationId: 'conv-manual', workspaceRoot: workspace }, 'Stop'),
        dataDir,
      );
      assert.equal(allowed.decision, 'allow');

      // apply_patch PostToolUse tracks files mentioned in patch headers inside workspace
      const patchedFile = path.join(workspace, 'patched.ts');
      fs.writeFileSync(patchedFile, '', 'utf8');
      handleVerifyPostToolHook(
        normalizeHookPayload(
          {
            conversationId: 'conv-patch',
            workspaceRoot: workspace,
            toolName: 'apply_patch',
            toolInput: {
              patch: '*** Begin Patch\n*** Add File: patched.ts\n*** End Patch\n',
            },
          },
          'PostToolUse',
        ),
        dataDir,
      );
      const patchState = loadVerifyStateReadOnly(moduleDataDir);
      assert.deepEqual(patchState.sessions['conv-patch']?.dirtyFiles, ['patched.ts']);
      assert.deepEqual(patchState.sessions['conv-patch']?.emptyFiles, ['patched.ts']);

      // patch_file is also tracked in TRACKED_VERIFY_WRITE_TOOLS
      assert.equal(TRACKED_VERIFY_WRITE_TOOLS.has('patch_file'), true);
      const patchFileTarget = path.join(workspace, 'patched-by-tool.ts');
      fs.writeFileSync(patchFileTarget, 'export const ok = true;\n', 'utf8');
      handleVerifyPostToolHook(
        normalizeHookPayload(
          {
            conversationId: 'conv-patch-file',
            workspaceRoot: workspace,
            toolName: 'patch_file',
            toolInput: { path: patchFileTarget },
          },
          'PostToolUse',
        ),
        dataDir,
      );
      const patchFileState = loadVerifyStateReadOnly(moduleDataDir);
      assert.deepEqual(patchFileState.sessions['conv-patch-file']?.dirtyFiles, ['patched-by-tool.ts']);
      assert.deepEqual(patchFileState.sessions['conv-patch-file']?.emptyFiles, []);
    });
  });

  it('reloads latest state.json before persisting after long commands to prevent concurrent write clobbering', async () => {
    await withTempDir('agy-nov-verify-concurrent-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'data');
      const moduleDataDir = getModuleDataDir(dataDir, 'verify');
      fs.mkdirSync(workspace, { recursive: true });

      fs.writeFileSync(
        path.join(workspace, 'delay-pass.mjs'),
        'setTimeout(() => { console.log("delayed ok"); }, 350);\n',
        'utf8',
      );

      updateVerifyPolicy(moduleDataDir, {
        enforceOnStop: true,
        autoRunOnStop: true,
        blockEmptyWrites: true,
        maxConsecutiveBlocks: 3,
        commands: [
          {
            id: 'delay-pass',
            label: 'Delayed Pass',
            executable: 'node',
            args: ['delay-pass.mjs'],
            timeoutMs: 5000,
            enabled: true,
          },
        ],
      });

      const fileA = path.join(workspace, 'a.ts');
      const fileB = path.join(workspace, 'b.ts');
      fs.writeFileSync(fileA, 'export const a = 1;\n', 'utf8');
      fs.writeFileSync(fileB, 'export const b = 2;\n', 'utf8');

      // Session A edits fileA and triggers a Stop hook running the 350ms check
      handleVerifyPostToolHook(
        normalizeHookPayload(
          {
            conversationId: 'conv-a',
            workspaceRoot: workspace,
            toolName: 'write_file',
            toolInput: { Path: fileA },
          },
          'PostToolUse',
        ),
        dataDir,
      );

      const stopPromise = handleVerifyStopHook(
        normalizeHookPayload({ conversationId: 'conv-a', workspaceRoot: workspace }, 'Stop'),
        dataDir,
      );

      // While Stop hook command is still executing, Session B writes fileB via PostToolUse
      await new Promise((r) => setTimeout(r, 120));
      handleVerifyPostToolHook(
        normalizeHookPayload(
          {
            conversationId: 'conv-b',
            workspaceRoot: workspace,
            toolName: 'patch_file',
            toolInput: { Path: fileB },
          },
          'PostToolUse',
        ),
        dataDir,
      );

      const stopRes = await stopPromise;
      assert.equal(stopRes.decision, 'allow');

      // Session B's concurrent dirty write must survive Stop hook persistence
      const afterStop = loadVerifyStateReadOnly(moduleDataDir);
      assert.deepEqual(afterStop.sessions['conv-a']?.dirtyFiles, []);
      assert.deepEqual(afterStop.sessions['conv-b']?.dirtyFiles, ['b.ts']);

      // Similarly, concurrent PostToolUse during runVerifyChecksLive must not be clobbered
      const fileC = path.join(workspace, 'c.ts');
      fs.writeFileSync(fileC, 'export const c = 3;\n', 'utf8');
      const livePromise = runVerifyChecksLive(moduleDataDir, workspace, {
        conversationId: 'conv-a',
      });
      await new Promise((r) => setTimeout(r, 120));
      handleVerifyPostToolHook(
        normalizeHookPayload(
          {
            conversationId: 'conv-c',
            workspaceRoot: workspace,
            toolName: 'write_file',
            toolInput: { Path: fileC },
          },
          'PostToolUse',
        ),
        dataDir,
      );

      const liveRes = await livePromise;
      assert.equal(liveRes.ok, true);

      const afterLive = loadVerifyStateReadOnly(moduleDataDir);
      assert.deepEqual(afterLive.sessions['conv-c']?.dirtyFiles, ['c.ts']);
      assert.equal(afterLive.sessions['conv-c']?.lastVerifiedPassed, false);
      assert.ok(afterLive.evidence.length >= 2);
    });
  });
});

describe('Verify Gate — McpServer registration, tool contract & dynamic enable/disable', () => {
  it('aligns 4 model tools with MODULE_CATALOG, registers 4 app-only tools with exemptReadOnlyAppTools, and handles end-to-end tool calls', async () => {
    await withTempDir('agy-nov-verify-mcp-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(workspace, { recursive: true });

      const uiUri = 'ui://agy-nov/app.html';
      const server = new McpServer(
        { name: 'agy-nov-verify-test', version: '0.3.0' },
        { capabilities: { tools: { listChanged: true } } },
      );

      const reg = registerVerifyModule(
        server,
        { dataDir, workspaceRoot: workspace, demoMode: false },
        uiUri,
      );

      // Zero disk writes upon registration
      assert.equal(fs.existsSync(dataDir), false);

      // Exact alignment with MODULE_CATALOG.verify.modelToolNames & exemptReadOnlyAppTools
      assert.equal(reg.moduleId, 'verify');
      assert.deepEqual(
        reg.modelTools.map((t) => t.name),
        MODULE_CATALOG.verify.modelToolNames,
      );
      assert.deepEqual(reg.exemptReadOnlyAppTools, [
        'app_verify_get_state',
        'app_verify_detect_commands',
        'app_verify_pr_summary',
      ]);

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'verify-mcp-client', version: '0.3.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        const listed = await client.listTools();
        const expectedTools = [
          'verify_get_policy',
          'verify_set_policy',
          'verify_run_checks',
          'verify_get_evidence',
          'app_verify_get_state',
          'app_verify_save_policy',
          'app_verify_run_checks',
          'app_verify_clear_history',
          'app_verify_detect_commands',
          'app_verify_pr_summary',
        ];
        assert.deepEqual(
          listed.tools.map((t) => t.name),
          expectedTools,
        );

        for (const tool of listed.tools) {
          if (tool.name.startsWith('app_')) {
            const meta = tool._meta as { ui?: { visibility?: string[]; resourceUri?: string } } | undefined;
            assert.deepEqual(meta?.ui?.visibility, ['app'], `Expected app-only visibility on ${tool.name}`);
            assert.equal(meta?.ui?.resourceUri, uiUri);
          }
        }

        // Read-only calls keep dataDir untouched
        const getPol = await client.callTool({ name: 'verify_get_policy', arguments: {} });
        assert.equal(getPol.isError, undefined);
        const getEv = await client.callTool({ name: 'verify_get_evidence', arguments: {} });
        assert.equal(getEv.isError, undefined);
        const getState = await client.callTool({ name: 'app_verify_get_state', arguments: {} });
        assert.equal(getState.isError, undefined);
        assert.equal(fs.existsSync(dataDir), false);

        // Reject unsafe command via verify_set_policy -> isError & still zero disk writes
        const badPolicy = await client.callTool({
          name: 'verify_set_policy',
          arguments: {
            commands: [
              {
                id: 'bad',
                label: 'Shell injection',
                executable: 'bash',
                args: ['-c', 'echo hi'],
                timeoutMs: 5000,
                enabled: true,
              },
            ],
          },
        });
        assert.equal(badPolicy.isError, true);
        assert.equal(fs.existsSync(dataDir), false);

        // Save valid command and execute via verify_run_checks
        const goodPolicy = await client.callTool({
          name: 'verify_set_policy',
          arguments: {
            enforceOnStop: true,
            autoRunOnStop: true,
            maxConsecutiveBlocks: 4,
            commands: [
              {
                id: 'node-v',
                label: 'Node Version',
                executable: 'node',
                args: ['--version'],
                timeoutMs: 5000,
                enabled: true,
              },
            ],
          },
        });
        assert.equal(goodPolicy.isError, undefined);

        const runRes = await client.callTool({
          name: 'verify_run_checks',
          arguments: { conversationId: 'conv-mcp' },
        });
        assert.equal(runRes.isError, undefined);
        assert.equal((runRes.structuredContent as { run: VerifyEvidenceRecord }).run.passed, true);

        const evAfter = await client.callTool({
          name: 'verify_get_evidence',
          arguments: { conversationId: 'conv-mcp', limit: 5 },
        });
        assert.equal((evAfter.structuredContent as { total: number }).total, 1);

        const cleared = await client.callTool({ name: 'app_verify_clear_history', arguments: {} });
        assert.equal(cleared.isError, undefined);
        assert.equal(
          (cleared.structuredContent as { state: VerifyStateView }).state.evidence.length,
          0,
        );

        // Dynamic disable / enable on all 4 model tools
        for (const h of reg.modelTools) h.disable();
        const afterDisable = await client.listTools();
        const disabledNames = new Set(afterDisable.tools.map((t) => t.name));
        for (const name of MODULE_CATALOG.verify.modelToolNames) {
          assert.equal(disabledNames.has(name), false, `${name} should be disabled`);
        }

        for (const h of reg.modelTools) h.enable();
        const afterEnable = await client.listTools();
        const enabledNames = new Set(afterEnable.tools.map((t) => t.name));
        for (const name of MODULE_CATALOG.verify.modelToolNames) {
          assert.equal(enabledNames.has(name), true, `${name} should be re-enabled`);
        }
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});
