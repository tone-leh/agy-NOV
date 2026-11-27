import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  loadTeamPresetReadOnly,
  MAX_TEAM_CONFIG_BYTES,
  MODULE_CATALOG,
} from '../src/core/config.js';
import {
  auditWorkspaceReadOnly,
  createDemoWorkspaceAudit,
} from '../src/modules/ops/core.js';
import { registerOpsModule } from '../src/modules/ops/register.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

function runCliRecommend(workspace: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const cliEntry = path.resolve(process.cwd(), 'src/server/cli.ts');
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', cliEntry, 'recommend', `--workspace=${workspace}`, '--json'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
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

describe('v0.6.0 Team Preset (.agy-nov.json) — Strictly Read-Only Loader & Security Guards', () => {
  it('returns found: false with zero disk writes when .agy-nov.json is absent', async () => {
    await withTempDir('agy-nov-v06-missing-', (tmpDir) => {
      const res = loadTeamPresetReadOnly(tmpDir);
      assert.deepEqual(res, {
        found: false,
        filePath: '.agy-nov.json',
        valid: true,
        enableModules: [],
        verifyCommands: [],
        specTemplatesCount: 0,
        warnings: [],
        errors: [],
      });
      assert.equal(fs.existsSync(path.join(tmpDir, '.agy-nov.json')), false);
      assert.deepEqual(fs.readdirSync(tmpDir), []);
    });
  });

  it('parses valid .agy-nov.json, clamps specTemplates to 10, strips remote, ignores proto pollution, and blocks dangerous verifyCommands', async () => {
    await withTempDir('agy-nov-v06-valid-', (tmpDir) => {
      const markerFile = path.join(tmpDir, 'must-never-be-created.txt');
      const specTemplates = Array.from({ length: 12 }, (_, idx) => ({
        name: `Template #${idx + 1}`,
        goal: `Goal for item ${idx + 1}`,
        tasks: ['Step A', 'Step B'],
      }));

      // Include raw prototype pollution keys directly in JSON text
      const rawJson = JSON.stringify(
        {
          schemaVersion: 1,
          preset: 'power',
          enableModules: ['studio', 'remote', 'mem', 'unknown-mod'],
          verifyCommands: [
            { label: 'Typecheck', executable: 'npm', args: ['run', 'typecheck'] },
            { label: 'Node Tests', executable: 'node', args: ['--test', 'test/a.test.ts'] },
            { label: 'Go Test', executable: 'go', args: ['test', './...'] },
            { label: 'Pytest', executable: 'pytest', args: ['-q', 'tests'] },
            { label: 'Python Pytest', executable: 'python3', args: ['-m', 'pytest', '-q'] },
            { label: 'Cargo Test', executable: 'cargo', args: ['test'] },
            { label: 'Git Status', executable: 'git', args: ['status', '--short'] },
            { label: 'Bad Shell', executable: 'bash', args: ['-c', `touch ${markerFile}`] },
            { label: 'Bad Path Shell', executable: '/bin/sh', args: ['-c', 'id'] },
            { label: 'Bad PowerShell', executable: 'powershell', args: ['-Command', 'Get-Process'] },
            { label: 'Bad Node Eval', executable: 'node', args: ['-e', 'process.exit(1)'] },
            { label: 'Bad Node Long Eval', executable: 'node', args: ['--eval', '1+1'] },
            { label: 'Bad Node Options', executable: 'node', args: ['--node-options=--require=./x.js', '--test'] },
            { label: 'Bad Python -c', executable: 'python3', args: ['-c', 'import os'] },
            { label: 'Bad NPM Exec', executable: 'npm', args: ['exec', 'evil-pkg'] },
            { label: 'Bad Git Push', executable: 'git', args: ['push', 'origin', 'main'] },
            { label: 'Bad Unknown Bin', executable: 'curl', args: ['https://example.com'] },
          ],
          specTemplates,
        },
        null,
        2,
      ).replace(
        '"schemaVersion": 1,',
        '"__proto__": { "novProtoPolluted": true }, "constructor": { "prototype": { "novCtorPolluted": true } }, "schemaVersion": 1,',
      );

      fs.writeFileSync(path.join(tmpDir, '.agy-nov.json'), rawJson, 'utf8');

      const res = loadTeamPresetReadOnly(tmpDir);
      assert.equal(res.found, true);
      assert.equal(res.valid, true);
      assert.equal(res.errors.length, 0);
      assert.equal(res.preset, 'power');

      // Remote stripped, unknown module ignored, safe offline modules preserved
      assert.deepEqual(res.enableModules, ['studio', 'mem']);
      assert.ok(
        res.warnings.some((w) => /remote/i.test(w) && /manual/i.test(w)),
        'Expected security warning when stripping opt-in remote module',
      );

      // Prototype pollution blocked & warned without mutating Object.prototype
      assert.equal(({} as Record<string, unknown>).novProtoPolluted, undefined);
      assert.equal(({} as Record<string, unknown>).novCtorPolluted, undefined);
      assert.ok(
        res.warnings.some((w) => /prototype-pollution/i.test(w)),
        'Expected warning for prototype-pollution keys',
      );

      // Only the 7 safe verifyCommands are retained; all 10 unsafe ones are rejected & warned
      assert.deepEqual(
        res.verifyCommands.map((c) => c.label),
        ['Typecheck', 'Node Tests', 'Go Test', 'Pytest', 'Python Pytest', 'Cargo Test', 'Git Status'],
      );
      for (const badLabel of [
        'Bad Shell',
        'Bad Path Shell',
        'Bad PowerShell',
        'Bad Node Eval',
        'Bad Node Long Eval',
        'Bad Node Options',
        'Bad Python -c',
        'Bad NPM Exec',
        'Bad Git Push',
        'Bad Unknown Bin',
      ]) {
        assert.ok(
          res.warnings.some((w) => w.includes(badLabel)),
          `Expected warning rejecting unsafe verifyCommand "${badLabel}"`,
        );
      }

      // Spec templates capped at 10
      assert.equal(res.specTemplatesCount, 10);

      // Strictly static — commands are never executed
      assert.equal(fs.existsSync(markerFile), false);
    });
  });

  it('[S1] blocks all 21 red-team RCE verifyCommands payloads plus extra bypass variants with strict per-tool allowlists', async () => {
    const redTeamPayloads: Array<{ label: string; executable: string; args: string[] }> = [
      // 1-3: python3 dangerous -m modules
      { label: 'RT-01 py http.server', executable: 'python3', args: ['-m', 'http.server', '8080'] },
      { label: 'RT-02 py timeit', executable: 'python3', args: ['-m', 'timeit', '-s', '__import__("os").system("id")'] },
      { label: 'RT-03 py pip install', executable: 'python3', args: ['-m', 'pip', 'install', 'evil'] },
      // 4-7: go exec/toolexec/generate/run
      { label: 'RT-04 go --exec', executable: 'go', args: ['test', '--exec=sh'] },
      { label: 'RT-05 go -toolexec', executable: 'go', args: ['test', '-toolexec=sh'] },
      { label: 'RT-06 go generate', executable: 'go', args: ['generate'] },
      { label: 'RT-07 go run', executable: 'go', args: ['run', 'evil.go'] },
      // 8-12: git difftool/bisect/ls-remote/--ext-diff/--output
      { label: 'RT-08 git difftool', executable: 'git', args: ['difftool', '--extcmd=id'] },
      { label: 'RT-09 git bisect', executable: 'git', args: ['bisect', 'run', 'sh'] },
      { label: 'RT-10 git ls-remote', executable: 'git', args: ['ls-remote', '--exec=id'] },
      { label: 'RT-11 git --ext-diff', executable: 'git', args: ['diff', '--ext-diff'] },
      { label: 'RT-12 git --output', executable: 'git', args: ['diff', '--output=pwned.txt'] },
      // 13-17: package manager init/create/explore
      { label: 'RT-13 npm init', executable: 'npm', args: ['init'] },
      { label: 'RT-14 npm create', executable: 'npm', args: ['create', 'evil'] },
      { label: 'RT-15 npm explore', executable: 'npm', args: ['explore', 'pkg'] },
      { label: 'RT-16 yarn create', executable: 'yarn', args: ['create', 'evil'] },
      { label: 'RT-17 pnpm create', executable: 'pnpm', args: ['create', 'evil'] },
      // 18-19: cargo --config / install
      { label: 'RT-18 cargo --config', executable: 'cargo', args: ['test', '--config', 'build.rustc-wrapper="sh"'] },
      { label: 'RT-19 cargo install', executable: 'cargo', args: ['install', 'evil'] },
      // 20: node --test-reporter
      { label: 'RT-20 node --test-reporter', executable: 'node', args: ['--test', '--test-reporter=./evil.mjs'] },
      // 21: make CC=python3 test
      { label: 'RT-21 make CC override', executable: 'make', args: ['CC=python3', 'test'] },
      // Extra hardening checks
      { label: 'RT-22 node --import', executable: 'node', args: ['--import', 'tsx', '--test'] },
      { label: 'RT-23 go -vettool', executable: 'go', args: ['vet', '-vettool=evil'] },
      { label: 'RT-24 git -c config', executable: 'git', args: ['diff', '-c', 'core.pager=sh'] },
      { label: 'RT-25 cargo -Z', executable: 'cargo', args: ['test', '-Z', 'script'] },
      { label: 'RT-26 eslint --rulesdir', executable: 'eslint', args: ['--rulesdir', './evil', 'src'] },
      { label: 'RT-27 pytest -p', executable: 'pytest', args: ['-p', 'evil_plugin'] },
      { label: 'RT-28 rustc -C linker', executable: 'rustc', args: ['-C', 'linker=sh', 'main.rs'] },
      { label: 'RT-29 gradle -I', executable: 'gradle', args: ['test', '-I', 'evil.gradle'] },
      { label: 'RT-30 npm pre-dash --script-shell', executable: 'npm', args: ['run', 'test', '--script-shell=sh'] },
    ];

    // Evaluate in chunks <= 15 so none are rejected merely by MAX_TEAM_VERIFY_COMMANDS truncation
    await withTempDir('agy-nov-v06-redteam-s1-', (tmpDir) => {
      for (let offset = 0; offset < redTeamPayloads.length; offset += 15) {
        const batch = redTeamPayloads.slice(offset, offset + 15);
        fs.writeFileSync(
          path.join(tmpDir, '.agy-nov.json'),
          JSON.stringify({ schemaVersion: 1, preset: 'core', verifyCommands: batch }),
          'utf8',
        );
        const res = loadTeamPresetReadOnly(tmpDir);
        assert.equal(res.found, true);
        assert.equal(res.valid, true);
        assert.equal(
          res.verifyCommands.length,
          0,
          `Expected 0 accepted commands in red-team batch, got: ${JSON.stringify(res.verifyCommands)}`,
        );
        for (const item of batch) {
          assert.ok(
            res.warnings.some((w) => w.includes(item.label) && /^Rejected verifyCommand/.test(w)),
            `Expected explicit rejection warning for "${item.label}", warnings: ${JSON.stringify(res.warnings)}`,
          );
        }
      }
    });
  });

  it('[L2] downgrades preset: "full" directly to "local-all" in loader and refuses symlinks targeting SSH/token/oauth/secret files', async () => {
    await withTempDir('agy-nov-v06-l2-', (tmpDir) => {
      // 1. Loader-level downgrade of preset: "full" -> "local-all"
      const wsFull = path.join(tmpDir, 'ws-full');
      fs.mkdirSync(wsFull, { recursive: true });
      fs.writeFileSync(
        path.join(wsFull, '.agy-nov.json'),
        JSON.stringify({ schemaVersion: 1, preset: 'full' }),
        'utf8',
      );
      const fullRes = loadTeamPresetReadOnly(wsFull);
      assert.equal(fullRes.found, true);
      assert.equal(fullRes.valid, true);
      assert.equal(fullRes.preset, 'local-all');
      assert.ok(
        fullRes.warnings.some((w) => /full/i.test(w) && /local-all/i.test(w) && /remote/i.test(w)),
        'Expected loader-level downgrade warning for preset "full"',
      );

      // 2. Sensitive symlink targets (id_rsa, id_ed25519, id_ecdsa, id_dsa, oauth.json, token.json, tokens.json, secrets.json)
      const sensitiveNames = [
        'id_rsa',
        'id_ed25519',
        'id_ecdsa',
        'id_dsa',
        'oauth.json',
        'token.json',
        'tokens.json',
        'secrets.json',
      ];
      for (const filename of sensitiveNames) {
        const wsSens = path.join(tmpDir, `ws-sens-${filename.replace(/[^a-z0-9]/gi, '_')}`);
        fs.mkdirSync(wsSens, { recursive: true });
        const marker = `CANARY_${filename.toUpperCase()}_NEVER_LEAK`;
        fs.writeFileSync(path.join(wsSens, filename), JSON.stringify({ [marker]: 'x' }), 'utf8');
        fs.symlinkSync(path.join(wsSens, filename), path.join(wsSens, '.agy-nov.json'));

        const sensRes = loadTeamPresetReadOnly(wsSens);
        assert.equal(sensRes.found, true);
        assert.equal(sensRes.valid, false, `Expected symlink to "${filename}" to be refused`);
        assert.equal(JSON.stringify(sensRes).includes(marker), false);
        assert.ok(sensRes.errors.some((e) => /sensitive/i.test(e)));
      }
    });
  });

  it('rejects symlink escape outside workspace, files exceeding 64 KiB cap, and redacts Stripe/Bearer secrets in team-config warnings', async () => {
    await withTempDir('agy-nov-v06-bounds-', (tmpDir) => {
      const wsEscape = path.join(tmpDir, 'ws-escape');
      const wsOversize = path.join(tmpDir, 'ws-oversize');
      const wsSecretWarn = path.join(tmpDir, 'ws-secret-warn');
      const outside = path.join(tmpDir, 'outside');
      fs.mkdirSync(wsEscape, { recursive: true });
      fs.mkdirSync(wsOversize, { recursive: true });
      fs.mkdirSync(wsSecretWarn, { recursive: true });
      fs.mkdirSync(outside, { recursive: true });

      const outsideConfig = path.join(outside, 'external-preset.json');
      fs.writeFileSync(outsideConfig, JSON.stringify({ schemaVersion: 1, preset: 'power' }), 'utf8');
      fs.symlinkSync(outsideConfig, path.join(wsEscape, '.agy-nov.json'));

      const escapeRes = loadTeamPresetReadOnly(wsEscape);
      assert.equal(escapeRes.found, true);
      assert.equal(escapeRes.valid, false);
      assert.equal(escapeRes.preset, undefined);
      assert.ok(escapeRes.errors.some((e) => /escapes workspace boundary/i.test(e)));

      // Oversized file > 64 KiB must be rejected before reading into JSON.parse
      const padding = 'x'.repeat(MAX_TEAM_CONFIG_BYTES + 1024);
      fs.writeFileSync(
        path.join(wsOversize, '.agy-nov.json'),
        JSON.stringify({ schemaVersion: 1, preset: 'core', pad: padding }),
        'utf8',
      );
      const oversizeRes = loadTeamPresetReadOnly(wsOversize);
      assert.equal(oversizeRes.found, true);
      assert.equal(oversizeRes.valid, false);
      assert.equal(oversizeRes.preset, undefined);
      assert.ok(oversizeRes.errors.some((e) => /64 KiB|maximum allowed size/i.test(e)));

      // [M2] Underscore-joined Stripe key & Bearer token inside rejected verifyCommand label/arg must be redacted
      const joinedStripeKey = `srv_${['sk', 'live', 'TeamCfgSecret9876543210'].join('_')}`;
      const bearerVal = ['Bearer', 'TeamCfgBearerToken12345678=='].join(' ');
      fs.writeFileSync(
        path.join(wsSecretWarn, '.agy-nov.json'),
        JSON.stringify({
          schemaVersion: 1,
          verifyCommands: [
            { label: joinedStripeKey, executable: 'curl', args: [bearerVal] },
          ],
        }),
        'utf8',
      );
      const warnRes = loadTeamPresetReadOnly(wsSecretWarn);
      const serialized = JSON.stringify(warnRes);
      assert.equal(serialized.includes(joinedStripeKey), false);
      assert.equal(serialized.includes('TeamCfgSecret9876543210'), false);
      assert.equal(serialized.includes('TeamCfgBearerToken12345678'), false);
      assert.ok(serialized.includes('<redacted>'));
    });
  });

  it('[R2] blocks Jest / Vitest / TypeScript / dotnet camelCase & kebab-case code-loading and write flags', async () => {
    await withTempDir('agy-nov-v06-r2-camel-', (tmpDir) => {
      const camelPayloads: Array<{ label: string; executable: string; args: string[] }> = [
        { label: 'jest-globalSetup', executable: 'jest', args: ['--globalSetup=./evil.js'] },
        { label: 'jest-setupFiles', executable: 'jest', args: ['--setupFiles=./evil.js'] },
        { label: 'jest-setupFilesAfterEnv', executable: 'jest', args: ['--setupFilesAfterEnv=./evil.js'] },
        { label: 'jest-testRunner', executable: 'jest', args: ['--testRunner=./evil.js'] },
        { label: 'jest-globalTeardown', executable: 'jest', args: ['--globalTeardown=./evil.js'] },
        { label: 'jest-testEnvironment', executable: 'jest', args: ['--testEnvironment=./evil.js'] },
        { label: 'jest-cacheDirectory', executable: 'jest', args: ['--cacheDirectory=./out'] },
        { label: 'jest-moduleNameMapper', executable: 'jest', args: ['--moduleNameMapper=./map.json'] },
        { label: 'vitest-globalSetup', executable: 'vitest', args: ['run', '--globalSetup=./evil.js'] },
        { label: 'tsc-outFile', executable: 'tsc', args: ['--outFile', 'pwned.js'] },
        { label: 'tsc-outDir', executable: 'tsc', args: ['--outDir', 'pwned'] },
        { label: 'tsc-tsBuildInfoFile', executable: 'tsc', args: ['--tsBuildInfoFile', 'pwned.tsbuildinfo'] },
        { label: 'tsc-declarationDir', executable: 'tsc', args: ['--declarationDir', 'types'] },
        { label: 'dotnet-artifacts', executable: 'dotnet', args: ['test', '--artifacts-path', 'out'] },
        { label: 'dotnet-out-short', executable: 'dotnet', args: ['build', '-o', 'out'] },
      ];

      for (const cmd of camelPayloads) {
        const ws = path.join(tmpDir, `ws-${cmd.label}`);
        fs.mkdirSync(ws, { recursive: true });
        fs.writeFileSync(
          path.join(ws, '.agy-nov.json'),
          JSON.stringify({ schemaVersion: 1, verifyCommands: [cmd] }),
          'utf8',
        );
        const res = loadTeamPresetReadOnly(ws);
        assert.equal(
          res.verifyCommands.length,
          0,
          `Expected camelCase/write flag payload "${cmd.label}" to be rejected`,
        );
        assert.ok(
          res.warnings.length > 0,
          `Expected warning for rejected payload "${cmd.label}"`,
        );
      }

      // Confirm safe tsc --noEmit and vitest run remain accepted
      const wsSafe = path.join(tmpDir, 'ws-safe-camel');
      fs.mkdirSync(wsSafe, { recursive: true });
      fs.writeFileSync(
        path.join(wsSafe, '.agy-nov.json'),
        JSON.stringify({
          schemaVersion: 1,
          verifyCommands: [
            { label: 'Typecheck', executable: 'tsc', args: ['--noEmit'] },
            { label: 'Unit', executable: 'vitest', args: ['run'] },
          ],
        }),
        'utf8',
      );
      const safeRes = loadTeamPresetReadOnly(wsSafe);
      assert.equal(safeRes.verifyCommands.length, 2);
      assert.equal(safeRes.warnings.length, 0);
    });
  });
});

describe('v0.6.0 Ops 2.5 — Cross-Client Pitfalls (#233, #1937), Secret Redaction [M2] & Migration Audit', () => {
  it('detects unexpanded ${ENV_VAR} (#233), duplicate plugin/server (#1937), cross-client rules/commands, skips sensitive files, and leaks zero secrets', async () => {
    await withTempDir('agy-nov-v06-ops25-', (tmpDir) => {
      const workspace = path.join(tmpDir, 'repo');
      const outside = path.join(tmpDir, 'outside');
      const dataDir = path.join(tmpDir, 'nov-data-absent');

      fs.mkdirSync(path.join(workspace, '.claude-plugin'), { recursive: true });
      fs.mkdirSync(path.join(workspace, '.claude', 'commands'), { recursive: true });
      fs.mkdirSync(path.join(workspace, '.claude', 'rules'), { recursive: true });
      fs.mkdirSync(path.join(workspace, '.cursor', 'rules'), { recursive: true });
      fs.mkdirSync(path.join(workspace, '.codex'), { recursive: true });
      fs.mkdirSync(path.join(workspace, '.gemini'), { recursive: true });
      fs.mkdirSync(outside, { recursive: true });

      // Construct synthetic secrets at runtime to avoid triggering push protection scanners
      const mcpMixedSecret = ['sk', 'proj', 'RealSecretNeverEchoMcp987654321'].join('-');
      const claudeSettingsSecret = ['ghp', 'ClaudeSettingsSecretNeverEcho123456'].join('_');
      const codexTomlSecret = ['sk', 'proj', 'CodexConfigSecretNeverEcho654321'].join('-');
      const outsideSecret = 'OUTSIDE_SYMLINK_SECRET_NEVER_READ';

      // Duplicate plugin manifests with identical name (#1937)
      fs.writeFileSync(
        path.join(workspace, 'plugin.json'),
        JSON.stringify({ name: 'dup-suite', version: '1.0.0' }),
        'utf8',
      );
      fs.writeFileSync(
        path.join(workspace, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'dup-suite', version: '1.0.0' }),
        'utf8',
      );

      // MCP configs: #233 unexpanded ${API_KEY} in env/headers/args/url + #1937 duplicate server across files
      fs.writeFileSync(
        path.join(workspace, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            'shared-db': {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-postgres', '--token=${DB_TOKEN}'],
              env: {
                API_KEY: '${API_KEY}',
                MIXED_SECRET: `${mcpMixedSecret}-\${FALLBACK_VAR}`,
              },
              headers: {
                Authorization: 'Bearer ${AUTH_BEARER_TOKEN}',
              },
            },
          },
        }),
        'utf8',
      );
      fs.writeFileSync(
        path.join(workspace, '.gemini', 'mcp_config.json'),
        JSON.stringify({
          mcpServers: {
            'shared-db': {
              url: 'https://mcp.internal.example/sse?region=${MCP_REGION}',
            },
          },
        }),
        'utf8',
      );

      // Cross-client files (.claude/, .cursor/rules/, .codex/)
      fs.writeFileSync(
        path.join(workspace, '.claude', 'commands', 'release.md'),
        '# Release Command\nRun tests before tagging.\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(workspace, '.claude', 'rules', 'security.md'),
        '# Security\nNever commit keys.\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(workspace, '.claude', 'settings.json'),
        JSON.stringify({ env: { SECRET_KEY: claudeSettingsSecret } }),
        'utf8',
      );
      fs.writeFileSync(
        path.join(workspace, '.cursor', 'rules', 'typescript.mdc'),
        '---\ndescription: TS rules\n---\nUse strict types.\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(workspace, '.codex', 'config.toml'),
        `model = "gpt-5"\napi_key = "${codexTomlSecret}"\n`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(workspace, '.codex', 'AGENTS.md'),
        '# Codex Agent Rules\nKeep edits minimal.\n',
        'utf8',
      );

      // Sensitive files & outside symlink inside cross-client dirs (must all be skipped)
      fs.writeFileSync(path.join(workspace, '.claude', '.env'), 'CLAUDE_ENV=never\n', 'utf8');
      fs.writeFileSync(path.join(workspace, '.claude', 'secrets.json'), '{"k":"never"}\n', 'utf8');
      fs.writeFileSync(path.join(workspace, '.cursor', 'rules', 'secret-notes.mdc'), 'never\n', 'utf8');
      fs.writeFileSync(path.join(workspace, '.codex', 'auth.json'), '{"token":"never"}\n', 'utf8');

      const outsideFile = path.join(outside, 'escape.md');
      fs.writeFileSync(outsideFile, outsideSecret, 'utf8');
      fs.symlinkSync(outsideFile, path.join(workspace, '.claude', 'rules', 'escape-link.md'));

      // Optional .agy-nov.json
      fs.writeFileSync(
        path.join(workspace, '.agy-nov.json'),
        JSON.stringify({
          schemaVersion: 1,
          preset: 'power',
          enableModules: ['ops', 'remote'],
          verifyCommands: [{ label: 'Typecheck', executable: 'npm', args: ['run', 'typecheck'] }],
        }),
        'utf8',
      );

      const report = auditWorkspaceReadOnly(workspace, dataDir, { enabledNovTools: 12 });

      // Strictly zero disk writes
      assert.equal(fs.existsSync(dataDir), false);

      // Team Preset embedded cleanly
      assert.equal(report.teamPreset.found, true);
      assert.equal(report.teamPreset.valid, true);
      assert.equal(report.teamPreset.preset, 'power');
      assert.deepEqual(report.teamPreset.enableModules, ['ops']);
      assert.equal(report.teamPreset.verifyCommands.length, 1);
      assert.ok(report.teamPreset.warnings.some((w) => /remote/i.test(w)));

      // 1. Antigravity #233 unexpanded ${ENV_VAR} pitfall
      const envPitfalls = report.crossClientFindings.filter(
        (f) => f.code === 'mcp-unexpanded-env' && f.severity === 'warn' && f.client === 'antigravity',
      );
      assert.ok(envPitfalls.length >= 2, `Expected >= 2 #233 env pitfall findings, got ${envPitfalls.length}`);
      assert.ok(
        envPitfalls.some((f) => f.file === '.mcp.json' && f.message.includes('env.API_KEY') && f.message.includes('${API_KEY}')),
        'Expected env.API_KEY -> ${API_KEY} finding in .mcp.json',
      );
      assert.ok(
        envPitfalls.some((f) => f.file === '.gemini/mcp_config.json' && f.message.includes('url') && f.message.includes('${MCP_REGION}')),
        'Expected url -> ${MCP_REGION} finding in .gemini/mcp_config.json',
      );

      // 2. Duplicate plugin manifest & duplicate MCP server (#1937)
      const dupFindings = report.crossClientFindings.filter((f) => f.code === 'duplicate-plugin-or-server');
      assert.ok(
        dupFindings.some((f) => /dup-suite/.test(f.message) && f.file === '.claude-plugin/plugin.json'),
        'Expected duplicate plugin manifest finding for dup-suite',
      );
      assert.ok(
        dupFindings.some((f) => /shared-db/.test(f.message) && f.file === '.gemini/mcp_config.json'),
        'Expected duplicate MCP server finding for shared-db',
      );

      // 3. Cross-client rules & commands migration audit
      assert.ok(
        report.crossClientFindings.some(
          (f) => f.client === 'claude' && f.code === 'cross-client-commands' && f.file.includes('.claude/commands/release.md'),
        ),
        'Expected Claude custom command migration finding',
      );
      assert.ok(
        report.crossClientFindings.some(
          (f) => f.client === 'claude' && f.code === 'cross-client-rules' && f.file.includes('.claude/rules/security.md'),
        ),
        'Expected Claude rules migration finding',
      );
      assert.ok(
        report.crossClientFindings.some(
          (f) => f.client === 'claude' && f.code === 'cross-client-rules' && f.file.includes('.claude/settings.json'),
        ),
        'Expected Claude settings migration finding',
      );
      assert.ok(
        report.crossClientFindings.some(
          (f) => f.client === 'cursor' && f.code === 'cross-client-rules' && f.file.includes('.cursor/rules/typescript.mdc'),
        ),
        'Expected Cursor rules migration finding',
      );
      assert.ok(
        report.crossClientFindings.some(
          (f) => f.client === 'codex' && f.code === 'cross-client-rules' && f.file.includes('.codex'),
        ),
        'Expected Codex config/rules migration finding',
      );

      // Sensitive files and escaped symlink were skipped
      assert.ok(report.summary.skippedSensitive >= 4);
      assert.ok(report.summary.skippedSymlinks >= 1);

      // Zero secret leakage across ENTIRE serialized report
      const serialized = JSON.stringify(report);
      assert.equal(serialized.includes(mcpMixedSecret), false, 'MCP secret value must never echo');
      assert.equal(serialized.includes(claudeSettingsSecret), false, 'Claude settings secret must never echo');
      assert.equal(serialized.includes(codexTomlSecret), false, 'Codex config secret must never echo');
      assert.equal(serialized.includes(outsideSecret), false, 'Escaped symlink content must never echo');
      assert.equal(serialized.includes('auth.json'), false, 'Sensitive auth.json must not be listed');
    });
  });

  it('[M2] flags underscore-joined Stripe keys (sk_live_/sk_test_) and Bearer tokens in MCP configs with zero plaintext echo', async () => {
    await withTempDir('agy-nov-v06-m2-secrets-', (tmpDir) => {
      const workspace = path.join(tmpDir, 'repo');
      const dataDir = path.join(tmpDir, 'nov-data-absent');
      fs.mkdirSync(workspace, { recursive: true });

      const stripeLive = ['sk', 'live', 'AlphaBetaGammaDelta123456'].join('_');
      const stripeTest = ['sk', 'test', 'ZetaEtaThetaIota65432100'].join('_');
      const bearerHeader = ['Bearer', 'OpaqueBearerSecretValue998877=='].join(' ');
      const bearerArg = ['Bearer', 'ArgBearerSecretToken55443322'].join(' ');

      const joinedServerName = `srv_${stripeLive}`;
      const joinedScriptPath = `./run_${stripeLive}.js`;

      fs.writeFileSync(
        path.join(workspace, '.mcp.json'),
        JSON.stringify(
          {
            mcpServers: {
              [joinedServerName]: {
                command: 'node',
                args: [joinedScriptPath, bearerArg],
                env: {
                  CUSTOM_VAR: `prefix_${stripeTest}`,
                },
                headers: {
                  'X-Custom-Header': bearerHeader,
                },
              },
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      const report = auditWorkspaceReadOnly(workspace, dataDir, { enabledNovTools: 12 });
      assert.equal(fs.existsSync(dataDir), false);

      // Must emit warnings/errors for server name, missing script path, Bearer arg, env sk_test_, and header Bearer
      assert.ok(
        report.mcpHealthFindings.some((f) => /server name contains a hardcoded secret/i.test(f.message)),
        'Expected warning for underscore-joined sk_live_ in server name',
      );
      assert.ok(
        report.mcpHealthFindings.some((f) => /does not exist: <redacted-path>/i.test(f.message)),
        'Expected redacted finding for ./run_sk_live_....js path',
      );
      assert.ok(
        report.mcpHealthFindings.some((f) => /hardcoded secret-like argument in "args"/i.test(f.message)),
        'Expected warning for Bearer token in args',
      );
      assert.ok(
        report.mcpHealthFindings.some((f) => /env\.CUSTOM_VAR/.test(f.message)),
        'Expected warning for underscore-joined sk_test_ in non-sensitive env key name',
      );
      assert.ok(
        report.mcpHealthFindings.some((f) => /headers\.X-Custom-Header/.test(f.message)),
        'Expected warning for Bearer token in non-sensitive header key name',
      );

      // Strictly ZERO plaintext leakage across the entire report
      const serialized = JSON.stringify(report);
      assert.equal(serialized.includes(stripeLive), false, 'sk_live_ token must never appear in report');
      assert.equal(serialized.includes(stripeTest), false, 'sk_test_ token must never appear in report');
      assert.equal(serialized.includes('AlphaBetaGammaDelta123456'), false);
      assert.equal(serialized.includes('ZetaEtaThetaIota65432100'), false);
      assert.equal(serialized.includes('OpaqueBearerSecretValue998877'), false);
      assert.equal(serialized.includes('ArgBearerSecretToken55443322'), false);
    });
  });
});

describe('v0.6.0 CLI recommend + Ops MCP Tool Contract & Demo Zero-Write', () => {
  it('integrates .agy-nov.json into agy-nov recommend --json while never auto-enabling remote and writing zero files', async () => {
    await withTempDir('agy-nov-v06-cli-rec-', async (tmpDir) => {
      // 1. Workspace without .agy-nov.json
      const wsPlain = path.join(tmpDir, 'ws-plain');
      fs.mkdirSync(wsPlain, { recursive: true });
      const plainRes = await runCliRecommend(wsPlain);
      assert.equal(plainRes.code, 0, plainRes.stderr);
      const plainJson = JSON.parse(plainRes.stdout);
      const pkgVersion = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
      ).version;
      assert.equal(plainJson.version, pkgVersion);
      assert.equal(plainJson.recommendedPreset, 'core');
      assert.equal(plainJson.teamPreset.found, false);
      assert.equal(plainJson.teamPreset.valid, true);
      assert.equal(fs.existsSync(path.join(wsPlain, '.agy-nov.json')), false);

      // 2. Valid .agy-nov.json overrides heuristic preset (core -> local-all)
      const wsValid = path.join(tmpDir, 'ws-valid');
      fs.mkdirSync(wsValid, { recursive: true });
      fs.writeFileSync(
        path.join(wsValid, '.agy-nov.json'),
        JSON.stringify({
          schemaVersion: 1,
          preset: 'local-all',
          verifyCommands: [{ label: 'Build', executable: 'npm', args: ['run', 'build'] }],
        }),
        'utf8',
      );
      const validRes = await runCliRecommend(wsValid);
      assert.equal(validRes.code, 0, validRes.stderr);
      const validJson = JSON.parse(validRes.stdout);
      assert.equal(validJson.recommendedPreset, 'local-all');
      assert.equal(validJson.teamPreset.found, true);
      assert.equal(validJson.teamPreset.valid, true);
      assert.equal(validJson.teamPreset.preset, 'local-all');
      assert.equal(validJson.teamPreset.verifyCommandCount, 1);
      assert.ok(
        validJson.reasons.some((r: string) => r.includes('.agy-nov.json') && r.includes('local-all')),
        'Expected reason citing .agy-nov.json',
      );

      // 3. .agy-nov.json requesting "full" + "remote" + dangerous verifyCommand must NEVER recommend remote/full
      const wsUnsafe = path.join(tmpDir, 'ws-unsafe');
      fs.mkdirSync(wsUnsafe, { recursive: true });
      fs.writeFileSync(
        path.join(wsUnsafe, '.agy-nov.json'),
        JSON.stringify({
          schemaVersion: 1,
          preset: 'full',
          enableModules: ['remote', 'canvas'],
          verifyCommands: [{ label: 'Shell Hack', executable: 'bash', args: ['-c', 'echo hi'] }],
        }),
        'utf8',
      );
      const unsafeRes = await runCliRecommend(wsUnsafe);
      assert.equal(unsafeRes.code, 0, unsafeRes.stderr);
      const unsafeJson = JSON.parse(unsafeRes.stdout);
      assert.equal(unsafeJson.teamPreset.preset, 'local-all');
      assert.equal(unsafeJson.recommendedPreset, 'local-all');
      assert.equal(unsafeJson.suggestedExtraModules.includes('remote'), false);
      assert.equal(unsafeJson.applyCommand.includes('remote'), false);
      assert.equal(unsafeJson.applyCommand.includes('full'), false);
      assert.ok(unsafeJson.teamPreset.warningCount >= 3);
      assert.ok(
        unsafeJson.reasons.some((r: string) => /\[.agy-nov\.json warning\]/i.test(r)),
        'Expected security warnings surfaced in reasons',
      );

      // 4. Invalid .agy-nov.json is safely ignored with fallback to heuristic preset
      const wsInvalid = path.join(tmpDir, 'ws-invalid');
      fs.mkdirSync(wsInvalid, { recursive: true });
      fs.writeFileSync(path.join(wsInvalid, '.agy-nov.json'), '{ broken json', 'utf8');
      const invalidRes = await runCliRecommend(wsInvalid);
      assert.equal(invalidRes.code, 0, invalidRes.stderr);
      const invalidJson = JSON.parse(invalidRes.stdout);
      assert.equal(invalidJson.recommendedPreset, 'core');
      assert.equal(invalidJson.teamPreset.found, true);
      assert.equal(invalidJson.teamPreset.valid, false);
      assert.ok(invalidJson.teamPreset.errorCount >= 1);
      assert.ok(
        invalidJson.reasons.some((r: string) => /Ignored invalid \.agy-nov\.json/i.test(r)),
        'Expected invalid .agy-nov.json error surfaced in reasons',
      );
    });
  });

  it('keeps ops strictly at 3 model tools and ensures demoMode returns rich v0.6.0 audit data with zero disk writes', async () => {
    await withTempDir('agy-nov-v06-mcp-demo-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'ws');
      const liveDataDir = path.join(tmpDir, 'live-data-absent');
      const demoDataDir = path.join(tmpDir, 'demo-data-absent');
      fs.mkdirSync(workspace, { recursive: true });
      fs.writeFileSync(path.join(workspace, 'AGENTS.md'), '# Rules\nStay compact.\n', 'utf8');
      fs.writeFileSync(
        path.join(workspace, '.mcp.json'),
        JSON.stringify({ mcpServers: { api: { command: 'node', env: { KEY: '${API_KEY}' } } } }),
        'utf8',
      );

      // Live registration keeps exactly 3 model tools matching MODULE_CATALOG.ops
      const liveServer = new McpServer(
        { name: 'v06-ops-live', version: '0.6.0' },
        { capabilities: { tools: { listChanged: true } } },
      );
      const liveReg = registerOpsModule(
        liveServer,
        { dataDir: liveDataDir, workspaceRoot: workspace, demoMode: false },
        'ui://agy-nov/app.html',
      );
      assert.equal(liveReg.modelTools.length, 3);
      assert.deepEqual(
        liveReg.modelTools.map((t) => t.name),
        ['ops_list_prompts', 'ops_render_prompt', 'ops_audit_workspace'],
      );
      assert.deepEqual(
        liveReg.modelTools.map((t) => t.name),
        MODULE_CATALOG.ops.modelToolNames,
      );

      const [cT, sT] = InMemoryTransport.createLinkedPair();
      const liveClient = new Client({ name: 'v06-live-client', version: '0.6.0' });
      await liveServer.connect(sT);
      await liveClient.connect(cT);
      try {
        const auditRes = await liveClient.callTool({ name: 'ops_audit_workspace', arguments: {} });
        assert.equal(auditRes.isError, undefined);
        const text = (auditRes.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
        assert.match(text, /Team Preset \(\.agy-nov\.json\):/);
        assert.match(text, /Cross-Client Findings: \d+ finding\(s\)/);
        const sc = auditRes.structuredContent as {
          teamPreset: { found: boolean };
          crossClientFindings: Array<{ code: string }>;
        };
        assert.equal(sc.teamPreset.found, false);
        assert.ok(sc.crossClientFindings.some((f) => f.code === 'mcp-unexpanded-env'));
        assert.equal(fs.existsSync(liveDataDir), false);
      } finally {
        await liveClient.close();
        await liveServer.close();
      }

      // Demo mode returns realistic teamPreset & crossClientFindings with strictly zero disk writes
      const demoAudit = createDemoWorkspaceAudit(workspace, 12);
      assert.equal(demoAudit.mode, 'demo');
      assert.equal(demoAudit.teamPreset.found, true);
      assert.equal(demoAudit.teamPreset.valid, true);
      assert.ok(demoAudit.teamPreset.verifyCommands.length >= 1);
      assert.ok(demoAudit.crossClientFindings.length >= 2);
      assert.ok(demoAudit.crossClientFindings.some((f) => f.code === 'mcp-unexpanded-env'));

      const demoServer = new McpServer(
        { name: 'v06-ops-demo', version: '0.6.0' },
        { capabilities: { tools: { listChanged: true } } },
      );
      registerOpsModule(
        demoServer,
        { dataDir: demoDataDir, workspaceRoot: workspace, demoMode: true },
        'ui://agy-nov/app.html',
      );
      const [dcT, dsT] = InMemoryTransport.createLinkedPair();
      const demoClient = new Client({ name: 'v06-demo-client', version: '0.6.0' });
      await demoServer.connect(dsT);
      await demoClient.connect(dcT);
      try {
        const stateRes = await demoClient.callTool({ name: 'app_ops_get_state', arguments: {} });
        const sc = stateRes.structuredContent as {
          mode: string;
          audit: {
            teamPreset: { found: boolean; valid: boolean };
            crossClientFindings: unknown[];
          };
        };
        assert.equal(sc.mode, 'demo');
        assert.equal(sc.audit.teamPreset.found, true);
        assert.equal(sc.audit.teamPreset.valid, true);
        assert.ok(sc.audit.crossClientFindings.length >= 2);
        assert.equal(fs.existsSync(demoDataDir), false);
      } finally {
        await demoClient.close();
        await demoServer.close();
      }
    });
  });
});
