import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MODULE_CATALOG } from '../src/core/config.js';
import {
  detectLineRiskHint,
  parseUnifiedDiff,
} from '../src/modules/review/diff-parser.js';
import { scanGitDiff } from '../src/modules/review/git-diff.js';
import { registerReviewModule } from '../src/modules/review/register.js';
import type { ReviewSession } from '../src/modules/review/types.js';
import {
  detectWorkspaceVerifyCommands,
  validateVerifyCommand,
  type DetectedVerifyCommand,
} from '../src/modules/verify/core.js';
import { registerVerifyModule } from '../src/modules/verify/register.js';
import {
  detectHighlightLanguage,
  tokenizeCodeLine,
} from '../ui/src/modules/review/DiffViewer.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

describe('v0.5.0 Verify — read-only project stack auto-detection', () => {
  it('detects Node(pnpm), filters malicious script names 100%, and stays strictly zero-write', async () => {
    await withTempDir('agy-nov-v05-node-', (tmpDir) => {
      const ws = path.join(tmpDir, 'ws');
      fs.mkdirSync(ws, { recursive: true });
      fs.writeFileSync(path.join(ws, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8');
      fs.writeFileSync(path.join(ws, 'tsconfig.json'), '{"compilerOptions":{}}\n', 'utf8');
      fs.writeFileSync(
        path.join(ws, 'package.json'),
        JSON.stringify(
          {
            name: 'demo-pnpm-app',
            scripts: {
              typecheck: 'tsc --noEmit',
              lint: 'eslint src',
              test: 'vitest run',
              exec: 'rm -rf /',
              '../evil': 'id',
              eval: 'node -e "process.exit(1)"',
              dlx: 'evil-pkg',
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      const beforeEntries = fs.readdirSync(ws).sort();
      const detected = detectWorkspaceVerifyCommands(ws);
      const afterEntries = fs.readdirSync(ws).sort();

      assert.deepEqual(afterEntries, beforeEntries);
      assert.ok(detected.detectedStacks.includes('node'));
      assert.ok(detected.detectedStacks.includes('typescript'));

      const cmds = detected.recommendations.map((r) => [r.executable, ...r.args].join(' '));
      assert.deepEqual(cmds, ['pnpm run typecheck', 'pnpm run lint', 'pnpm test']);

      // Malicious script names are 100% filtered out and every output passes validateVerifyCommand
      for (const rec of detected.recommendations) {
        assert.equal(rec.args.includes('exec'), false);
        assert.equal(rec.args.includes('../evil'), false);
        assert.equal(rec.args.includes('eval'), false);
        assert.equal(rec.args.includes('dlx'), false);
        const check = validateVerifyCommand({ ...rec, enabled: true });
        assert.equal(check.valid, true, `Recommendation failed allowlist: ${rec.id}`);
      }
    });
  });

  it('detects Python (pytest + ruff), Rust (Cargo), and Go (go.mod) workspaces read-only', async () => {
    await withTempDir('agy-nov-v05-stacks-', (tmpDir) => {
      // Python with pyproject.toml mentioning ruff
      const pyDir = path.join(tmpDir, 'py');
      fs.mkdirSync(pyDir, { recursive: true });
      fs.writeFileSync(
        path.join(pyDir, 'pyproject.toml'),
        '[project]\nname = "demo"\n\n[tool.ruff]\nline-length = 100\n',
        'utf8',
      );
      const pyDetected = detectWorkspaceVerifyCommands(pyDir);
      assert.deepEqual(pyDetected.detectedStacks, ['python']);
      assert.deepEqual(
        pyDetected.recommendations.map((r) => [r.executable, ...r.args]),
        [
          ['python3', '-m', 'pytest'],
          ['ruff', 'check', '.'],
        ],
      );

      // Python with pytest.ini only (no ruff)
      const pyMiniDir = path.join(tmpDir, 'py-mini');
      fs.mkdirSync(pyMiniDir, { recursive: true });
      fs.writeFileSync(path.join(pyMiniDir, 'pytest.ini'), '[pytest]\n', 'utf8');
      const pyMiniDetected = detectWorkspaceVerifyCommands(pyMiniDir);
      assert.deepEqual(pyMiniDetected.detectedStacks, ['python']);
      assert.deepEqual(
        pyMiniDetected.recommendations.map((r) => [r.executable, ...r.args]),
        [['python3', '-m', 'pytest']],
      );

      // Rust
      const rustDir = path.join(tmpDir, 'rust');
      fs.mkdirSync(rustDir, { recursive: true });
      fs.writeFileSync(path.join(rustDir, 'Cargo.toml'), '[package]\nname = "demo"\n', 'utf8');
      const rustDetected = detectWorkspaceVerifyCommands(rustDir);
      assert.deepEqual(rustDetected.detectedStacks, ['rust']);
      assert.deepEqual(
        rustDetected.recommendations.map((r) => [r.executable, ...r.args]),
        [
          ['cargo', 'check'],
          ['cargo', 'test'],
        ],
      );

      // Go
      const goDir = path.join(tmpDir, 'go');
      fs.mkdirSync(goDir, { recursive: true });
      fs.writeFileSync(path.join(goDir, 'go.mod'), 'module example.com/demo\n\ngo 1.22\n', 'utf8');
      const goDetected = detectWorkspaceVerifyCommands(goDir);
      assert.deepEqual(goDetected.detectedStacks, ['go']);
      assert.deepEqual(
        goDetected.recommendations.map((r) => [r.executable, ...r.args]),
        [
          ['go', 'vet', './...'],
          ['go', 'test', './...'],
        ],
      );

      // Symlink escaping workspace root must be refused
      const outside = path.join(tmpDir, 'outside');
      const escapeWs = path.join(tmpDir, 'escape-ws');
      fs.mkdirSync(outside, { recursive: true });
      fs.mkdirSync(escapeWs, { recursive: true });
      fs.writeFileSync(
        path.join(outside, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo ok' } }),
        'utf8',
      );
      fs.symlinkSync(path.join(outside, 'package.json'), path.join(escapeWs, 'package.json'));
      const escapeDetected = detectWorkspaceVerifyCommands(escapeWs);
      assert.deepEqual(escapeDetected.detectedStacks, []);
      assert.deepEqual(escapeDetected.recommendations, []);
    });
  });

  it('exposes app_verify_detect_commands (read-only exempt) in live & demoMode with zero disk writes', async () => {
    await withTempDir('agy-nov-v05-verify-mcp-', async (tmpDir) => {
      const ws = path.join(tmpDir, 'go-ws');
      const dataDir = path.join(tmpDir, 'data-must-not-exist');
      fs.mkdirSync(ws, { recursive: true });
      fs.writeFileSync(path.join(ws, 'go.mod'), 'module example.com/app\n', 'utf8');

      // Live mode
      const liveServer = new McpServer(
        { name: 'v05-verify-live', version: '0.5.0' },
        { capabilities: { tools: {} } },
      );
      const reg = registerVerifyModule(
        liveServer,
        { dataDir, workspaceRoot: ws, demoMode: false },
        'ui://agy-nov/app.html',
      );

      assert.deepEqual(
        reg.modelTools.map((t) => t.name),
        MODULE_CATALOG.verify.modelToolNames,
      );
      assert.ok(reg.exemptReadOnlyAppTools?.includes('app_verify_detect_commands'));

      const [ct1, st1] = InMemoryTransport.createLinkedPair();
      const client1 = new Client({ name: 'v05-client-live', version: '0.5.0' });
      await liveServer.connect(st1);
      await client1.connect(ct1);
      try {
        const detectRes = await client1.callTool({ name: 'app_verify_detect_commands', arguments: {} });
        assert.equal(detectRes.isError, undefined);
        const sc = detectRes.structuredContent as {
          mode: string;
          detectedStacks: string[];
          recommendations: DetectedVerifyCommand[];
        };
        assert.equal(sc.mode, 'live');
        assert.deepEqual(sc.detectedStacks, ['go']);
        assert.deepEqual(
          sc.recommendations.map((r) => [r.executable, ...r.args]),
          [
            ['go', 'vet', './...'],
            ['go', 'test', './...'],
          ],
        );

        const policyRes = await client1.callTool({ name: 'verify_get_policy', arguments: {} });
        const policySc = policyRes.structuredContent as {
          detectedStackRecommendations?: DetectedVerifyCommand[];
        };
        assert.equal(policySc.detectedStackRecommendations?.length, 2);
        assert.equal(fs.existsSync(dataDir), false);
      } finally {
        await client1.close();
        await liveServer.close();
      }

      // Demo mode: zero disk reads even when workspaceRoot does not exist
      const demoServer = new McpServer(
        { name: 'v05-verify-demo', version: '0.5.0' },
        { capabilities: { tools: {} } },
      );
      registerVerifyModule(
        demoServer,
        {
          dataDir,
          workspaceRoot: path.join(tmpDir, 'nonexistent-workspace'),
          demoMode: true,
        },
        'ui://agy-nov/app.html',
      );
      const [ct2, st2] = InMemoryTransport.createLinkedPair();
      const client2 = new Client({ name: 'v05-client-demo', version: '0.5.0' });
      await demoServer.connect(st2);
      await client2.connect(ct2);
      try {
        const demoDetect = await client2.callTool({ name: 'app_verify_detect_commands', arguments: {} });
        assert.equal(demoDetect.isError, undefined);
        const sc = demoDetect.structuredContent as {
          mode: string;
          detectedStacks: string[];
          recommendations: DetectedVerifyCommand[];
        };
        assert.equal(sc.mode, 'demo');
        assert.ok(sc.detectedStacks.includes('typescript'));
        assert.ok(sc.recommendations.length >= 2);
        assert.equal(fs.existsSync(dataDir), false);
      } finally {
        await client2.close();
        await demoServer.close();
      }
    });
  });
});

describe('v0.5.0 Review — ignoreWhitespace (-w), deterministic risk hints & syntax tokenizer', () => {
  it('hides indentation-only edits when ignoreWhitespace=true and shows them when false', async () => {
    await withTempDir('agy-nov-v05-ws-diff-', async (tmpDir) => {
      const repoDir = path.join(tmpDir, 'repo');
      const dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(repoDir, { recursive: true });

      execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir, stdio: 'ignore' });

      const targetFile = path.join(repoDir, 'app.ts');
      fs.writeFileSync(
        targetFile,
        'export function sum(a: number, b: number) {\n  return a + b;\n}\n',
        'utf8',
      );
      execFileSync('git', ['add', 'app.ts'], { cwd: repoDir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir, stdio: 'ignore' });

      // Modify indentation only
      fs.writeFileSync(
        targetFile,
        'export function sum(a: number, b: number) {\n      return a + b;\n}\n',
        'utf8',
      );

      const withWs = scanGitDiff({ repoPath: repoDir, scope: 'working', ignoreWhitespace: false });
      assert.equal(withWs.totalFiles, 1);
      assert.equal(withWs.files[0].path, 'app.ts');
      assert.ok(withWs.totalAdditions >= 1);

      const withoutWs = scanGitDiff({ repoPath: repoDir, scope: 'working', ignoreWhitespace: true });
      assert.equal(withoutWs.totalFiles, 0);
      assert.equal(withoutWs.files.length, 0);
      assert.equal(withoutWs.ignoreWhitespace, true);

      // Verify MCP app_review_get_diff forwards ignoreWhitespace cleanly
      const server = new McpServer(
        { name: 'v05-review-test', version: '0.5.0' },
        { capabilities: { tools: {} } },
      );
      const reg = registerReviewModule(
        server,
        { dataDir, workspaceRoot: repoDir, demoMode: false },
        'ui://agy-nov/app.html',
      );
      assert.deepEqual(
        reg.modelTools.map((t) => t.name),
        MODULE_CATALOG.review.modelToolNames,
      );

      const [ct, st] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'v05-review-client', version: '0.5.0' });
      await server.connect(st);
      await client.connect(ct);
      try {
        const resFalse = await client.callTool({
          name: 'app_review_get_diff',
          arguments: { repoPath: repoDir, scope: 'working', ignoreWhitespace: false },
        });
        const sFalse = (resFalse.structuredContent as { session: ReviewSession }).session;
        assert.equal(sFalse.totalFiles, 1);

        const resTrue = await client.callTool({
          name: 'app_review_get_diff',
          arguments: { repoPath: repoDir, scope: 'working', ignoreWhitespace: true },
        });
        const sTrue = (resTrue.structuredContent as { session: ReviewSession }).session;
        assert.equal(sTrue.totalFiles, 0);
        assert.equal(sTrue.ignoreWhitespace, true);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });

  it('pre-annotates secret/permission/unsafe_eval added lines without leaking raw secrets', () => {
    const fakeGhToken = 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz123456';
    const fakeOpenAiKey = 'sk-proj-TestFakeSecretKey9876543210';
    const fakeAwsKey = 'AKIAIOSFODNN7EXAMPLE';
    const fakePassword = 'SuperRealProdPassword!890';

    const rawDiff = [
      'diff --git a/src/risky.ts b/src/risky.ts',
      'index 1111111..2222222 100644',
      '--- a/src/risky.ts',
      '+++ b/src/risky.ts',
      '@@ -1,2 +1,11 @@',
      ' const safeLine = 1;',
      `-const removedSecret = "${fakeGhToken}";`,
      `+const gh = "${fakeGhToken}";`,
      `+const openai = "${fakeOpenAiKey}";`,
      `+const aws = "${fakeAwsKey}";`,
      `+const password = "${fakePassword}";`,
      '+const placeholder = { password: "example_value", apiKey: "<YOUR_KEY>", secret: "xxxxxxxx" };',
      '+const cmd = "chmod 777 /var/app";',
      '+const tlsOpts = { rejectUnauthorized: false };',
      '+const host = "0.0.0.0";',
      '+const el = <div dangerouslySetInnerHTML={{ __html: userInput }} />;',
      '+const out = require("child_process").exec(cmd);',
    ].join('\n');

    const parsed = parseUnifiedDiff(rawDiff);
    assert.equal(parsed.files.length, 1);
    const lines = parsed.files[0].hunks[0].lines;

    // Context & removed lines never receive riskHint
    assert.equal(lines[0].riskHint, undefined);
    assert.equal(lines[1].type, 'del');
    assert.equal(lines[1].riskHint, undefined);

    // ghp_ secret
    const ghHint = lines[2].riskHint;
    assert.equal(ghHint?.severity, 'high');
    assert.equal(ghHint?.category, 'secret');
    assert.equal(ghHint?.message.includes(fakeGhToken), false);
    assert.equal(ghHint?.message.includes('ghp_'), false);

    // sk-proj- secret
    const openaiHint = lines[3].riskHint;
    assert.equal(openaiHint?.severity, 'high');
    assert.equal(openaiHint?.category, 'secret');
    assert.equal(openaiHint?.message.includes(fakeOpenAiKey), false);

    // AKIA secret
    const awsHint = lines[4].riskHint;
    assert.equal(awsHint?.severity, 'high');
    assert.equal(awsHint?.category, 'secret');
    assert.equal(awsHint?.message.includes(fakeAwsKey), false);

    // Hardcoded password secret
    const pwdHint = lines[5].riskHint;
    assert.equal(pwdHint?.severity, 'high');
    assert.equal(pwdHint?.category, 'secret');
    assert.equal(pwdHint?.message.includes(fakePassword), false);

    // Placeholder secret values are skipped
    assert.equal(lines[6].riskHint, undefined);

    // Permission hazards
    assert.equal(lines[7].riskHint?.severity, 'high');
    assert.equal(lines[7].riskHint?.category, 'permission');
    assert.equal(lines[8].riskHint?.severity, 'high');
    assert.equal(lines[8].riskHint?.category, 'permission');
    assert.equal(lines[9].riskHint?.severity, 'high');
    assert.equal(lines[9].riskHint?.category, 'permission');

    // Unsafe eval / HTML / shell exec
    assert.equal(lines[10].riskHint?.severity, 'medium');
    assert.equal(lines[10].riskHint?.category, 'unsafe_eval');
    assert.equal(lines[11].riskHint?.severity, 'medium');
    assert.equal(lines[11].riskHint?.category, 'unsafe_eval');

    // Direct helper checks: private key, NODE_TLS_REJECT_UNAUTHORIZED=0, eval, new Function, long line safety
    assert.equal(detectLineRiskHint('-----BEGIN OPENSSH PRIVATE KEY-----')?.category, 'secret');
    assert.equal(detectLineRiskHint('NODE_TLS_REJECT_UNAUTHORIZED=0 node app.js')?.category, 'permission');
    assert.equal(detectLineRiskHint('const x = eval(userCode);')?.category, 'unsafe_eval');
    assert.equal(detectLineRiskHint('const fn = new Function("a", body);')?.category, 'unsafe_eval');

    // Extremely long line completes cleanly within bounded 1024-char slice
    const start = Date.now();
    const hugeLine = 'a'.repeat(100_000) + ' eval(1)';
    assert.equal(detectLineRiskHint(hugeLine), undefined);
    assert.ok(Date.now() - start < 200);
  });

  it('tokenizes multiple languages in linear time without HTML injection', () => {
    assert.equal(detectHighlightLanguage('src/auth/jwt.ts'), 'js');
    assert.equal(detectHighlightLanguage('scripts/check.py'), 'py');
    assert.equal(detectHighlightLanguage('cmd/main.go'), 'go');
    assert.equal(detectHighlightLanguage('src/lib.rs'), 'rs');
    assert.equal(detectHighlightLanguage('config.json'), 'json');
    assert.equal(detectHighlightLanguage('.github/ci.yml'), 'yaml');
    assert.equal(detectHighlightLanguage('deploy.sh'), 'sh');
    assert.equal(detectHighlightLanguage('theme.css'), 'css');
    assert.equal(detectHighlightLanguage('index.html'), 'html');
    assert.equal(detectHighlightLanguage('query.sql'), 'sql');

    const tsTokens = tokenizeCodeLine('export const count: number = 42; // ok', 'js');
    assert.ok(tsTokens.some((t) => t.kind === 'keyword' && t.text === 'export'));
    assert.ok(tsTokens.some((t) => t.kind === 'type' && t.text === 'number'));
    assert.ok(tsTokens.some((t) => t.kind === 'number' && t.text === '42'));
    assert.ok(tsTokens.some((t) => t.kind === 'comment' && t.text.includes('// ok')));

    const xssLine = 'const s = "<img src=x onerror=alert(1)>";';
    const xssTokens = tokenizeCodeLine(xssLine, 'js');
    assert.equal(xssTokens.map((t) => t.text).join(''), xssLine);
    assert.ok(xssTokens.some((t) => t.kind === 'string' && t.text.includes('<img')));
  });
});
