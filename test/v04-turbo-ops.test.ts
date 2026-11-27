import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  applyPresetConfig,
  countEnabledModelTools,
  MODULE_CATALOG,
  PRESET_DEFINITIONS,
} from '../src/core/config.js';
import {
  auditWorkspaceAssets,
  auditWorkspaceReadOnly,
  createDemoWorkspaceAudit,
} from '../src/modules/ops/core.js';
import { registerOpsModule } from '../src/modules/ops/register.js';
import {
  compactLargeOutput,
  detectOutputPreset,
  queryCompactedChunk,
} from '../src/modules/turbo/core.js';
import { registerTurboModule } from '../src/modules/turbo/register.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

describe('v0.4.0 Turbo 2.0 — RTK-style smart output compression', () => {
  it('auto-detects and compresses noisy test logs while preserving failures, diffs, stack traces, and summary', () => {
    const rawLines: string[] = [
      '> agy-nov@0.4.0 test',
      '> vitest run',
      ...Array.from(
        { length: 200 },
        (_, idx) => `✔ suite/core.test.ts > invariant case #${idx + 1} passes reliably (${(idx % 9) + 1}ms)`,
      ),
      '✖ suite/billing.test.ts > computes invoice tax with rounding (14ms)',
      '  AssertionError: expected 108.5 to equal 109.0',
      '  - Expected',
      '  + Received',
      '  - 109.0',
      '  + 108.5',
      '    at Object.computeInvoiceTax (src/billing/tax.ts:88:17)',
      '    at runTest (node_modules/vitest/dist/runner.js:412:9)',
      '',
      'Test Files  1 failed | 14 passed (15)',
      'Tests       1 failed | 200 passed (201)',
      'ℹ pass 200',
      'ℹ fail 1',
      'Duration    3.12s',
    ];
    const rawText = rawLines.join('\n');

    assert.equal(detectOutputPreset(rawText), 'test');

    const res = compactLargeOutput(undefined, 'vitest run', rawText);
    assert.equal(res.detectedPreset, 'test');
    assert.equal(res.linesBefore, rawLines.length);
    assert.equal(res.totalLines, rawLines.length);
    assert.ok(res.linesAfter < res.linesBefore);
    assert.ok(res.savedPercent >= 50, `Expected savedPercent >= 50, got ${res.savedPercent}`);
    assert.ok(res.savedPercent <= 100);
    assert.ok(res.estimatedSavedTokens > 0);
    assert.match(res.summaryText, /\[preset=test, saved \d+%\]/);
    assert.match(res.summaryText, /\.\.\. \[collapsed 200 passing test lines\]/);

    // 100% preservation of failure line, assertion diff, stack trace, and summary stats
    assert.ok(res.summaryText.includes('suite/billing.test.ts > computes invoice tax with rounding'));
    assert.ok(res.summaryText.includes('AssertionError: expected 108.5 to equal 109.0'));
    assert.ok(res.summaryText.includes('- 109.0'));
    assert.ok(res.summaryText.includes('+ 108.5'));
    assert.ok(res.summaryText.includes('src/billing/tax.ts:88:17'));
    assert.ok(res.summaryText.includes('Tests       1 failed | 200 passed (201)'));
    assert.ok(res.summaryText.includes('ℹ fail 1'));

    // Indexed chunk query still resolves exact 1-based original line numbers
    const hit = queryCompactedChunk(res.chunkId, 'case #150', 5);
    assert.equal(hit.found, true);
    assert.equal(hit.matches[0]?.matchedLine, 152);
  });

  it('strips ANSI escapes and CR progress bars on build logs while preserving all TS errors & build summary', () => {
    const rawLines: string[] = [
      '\x1b[36mvite v6.1.0 building for production...\x1b[0m',
      ...Array.from(
        { length: 150 },
        (_, idx) =>
          `\x1b[90mtransforming (${idx + 1})\r\x1b[36mtransforming (${idx + 1}) src/components/Widget${idx + 1}.tsx\x1b[0m`,
      ),
      '✓ 150 modules transformed.',
      '\x1b[31msrc/modules/turbo/core.ts:412:14 - error TS2322: Type "number" is not assignable to type "string".\x1b[0m',
      '  412 |   const name: string = count;',
      '      |         ~~~~',
      '\x1b[31msrc/modules/ops/core.ts(98,5): error TS2345: Argument of type "undefined" is not assignable.\x1b[0m',
      '\x1b[33mwarning: unused import "foo" in src/utils.ts:3:10\x1b[0m',
      'dist/assets/app.js  148.20 kB | gzip: 44.10 kB',
      '✓ built in 2.15s',
    ];
    const rawText = rawLines.join('\n');

    assert.equal(detectOutputPreset(rawText), 'build');

    const res = compactLargeOutput(undefined, 'vite build', rawText);
    assert.equal(res.detectedPreset, 'build');
    assert.equal(res.linesBefore, rawLines.length);
    assert.ok(res.savedPercent >= 50, `Expected savedPercent >= 50, got ${res.savedPercent}`);
    assert.equal(/\x1b\[/.test(res.summaryText), false, 'ANSI sequences must be stripped');
    assert.equal(res.summaryText.includes('\r'), false, 'CR progress overwrites must be cleaned');
    assert.match(res.summaryText, /\[preset=build, saved \d+%\]/);
    assert.match(res.summaryText, /collapsed \d+ build progress lines/);

    // 100% preservation of both error TS diagnostics, warning, and final artifact summary
    assert.ok(res.summaryText.includes('src/modules/turbo/core.ts:412:14 - error TS2322'));
    assert.ok(res.summaryText.includes('src/modules/ops/core.ts(98,5): error TS2345'));
    assert.ok(res.summaryText.includes('warning: unused import "foo"'));
    assert.ok(res.summaryText.includes('dist/assets/app.js  148.20 kB'));
    assert.ok(res.summaryText.includes('built in 2.15s'));
  });

  it('auto-detects git diff, collapses lockfile hunks, and preserves headers & source changes', () => {
    const lockHunkLines = [
      '@@ -1,220 +1,220 @@',
      ...Array.from(
        { length: 110 },
        (_, i) => `-"pkg-${i}": "1.0.${i}",`,
      ),
      ...Array.from(
        { length: 110 },
        (_, i) => `+"pkg-${i}": "1.1.${i}",`,
      ),
    ];

    const rawLines = [
      'diff --git a/package-lock.json b/package-lock.json',
      'index 1111111..2222222 100644',
      '--- a/package-lock.json',
      '+++ b/package-lock.json',
      ...lockHunkLines,
      'diff --git a/src/server/index.ts b/src/server/index.ts',
      'index 3333333..4444444 100644',
      '--- a/src/server/index.ts',
      '+++ b/src/server/index.ts',
      '@@ -10,6 +10,7 @@ export function boot() {',
      '   const mode = "offline";',
      '-  return startLegacy(mode);',
      '+  return startNativeV04(mode);',
      ' }',
    ];
    const rawText = rawLines.join('\n');

    assert.equal(detectOutputPreset(rawText), 'git');

    const res = compactLargeOutput(undefined, 'git diff', rawText);
    assert.equal(res.detectedPreset, 'git');
    assert.equal(res.linesBefore, rawLines.length);
    assert.ok(res.savedPercent >= 50, `Expected savedPercent >= 50, got ${res.savedPercent}`);
    assert.match(res.summaryText, /\[preset=git, saved \d+%\]/);
    assert.ok(res.summaryText.includes('diff --git a/package-lock.json b/package-lock.json'));
    assert.match(res.summaryText, /collapsed lockfile\/generated diff: \d+ lines \(\+110 \/ -110\)/);
    assert.ok(res.summaryText.includes('diff --git a/src/server/index.ts b/src/server/index.ts'));
    assert.ok(res.summaryText.includes('+  return startNativeV04(mode);'));
  });

  it('respects explicit preset override and exposes preset parameter through MCP tools without changing tool count', async () => {
    await withTempDir('agy-nov-v04-turbo-mcp-', async (tmpDir) => {
      const dataDir = path.join(tmpDir, 'data-absent');
      const server = new McpServer(
        { name: 'v04-turbo-test', version: '0.4.0' },
        { capabilities: { tools: { listChanged: true } } },
      );

      const reg = registerTurboModule(server, { dataDir, workspaceRoot: tmpDir, demoMode: false }, 'ui://agy-nov/app.html');
      assert.equal(reg.modelTools.length, 3);
      assert.deepEqual(
        reg.modelTools.map((t) => t.name),
        MODULE_CATALOG.turbo.modelToolNames,
      );

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'v04-turbo-client', version: '0.4.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        const testLog = [
          ...Array.from({ length: 60 }, (_, i) => `✔ pass item #${i + 1}`),
          'FAIL test/demo.test.ts',
          'Tests: 1 failed, 60 passed',
        ].join('\n');

        const call = await client.callTool({
          name: 'turbo_compact_output',
          arguments: { label: 'ci-tests', rawText: testLog, preset: 'auto' },
        });
        assert.equal(call.isError, undefined);
        const text = (call.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
        assert.match(text, /\[preset=test, saved \d+%\]/);

        const sc = call.structuredContent as {
          detectedPreset: string;
          linesBefore: number;
          linesAfter: number;
          savedPercent: number;
        };
        assert.equal(sc.detectedPreset, 'test');
        assert.equal(sc.linesBefore, 62);
        assert.ok(sc.linesAfter < 20);
        assert.ok(sc.savedPercent >= 50);

        const forcedGeneric = await client.callTool({
          name: 'app_turbo_compact_output',
          arguments: { label: 'forced', rawText: testLog, preset: 'generic' },
        });
        assert.equal(forcedGeneric.isError, undefined);
        const appSc = forcedGeneric.structuredContent as { result: { detectedPreset: string } };
        assert.equal(appSc.result.detectedPreset, 'generic');

        assert.equal(fs.existsSync(dataDir), false);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });

  it('caps 50,000-line all-error build logs, 50,000-line failing test stacks, and huge git logs with >=95% savings while keeping first/last errors and summaries', () => {
    // 1. 50,000-line all-error TypeScript build log
    const buildLines: string[] = [
      ...Array.from(
        { length: 50_000 },
        (_, i) =>
          `src/pkg/mod_${i + 1}.ts:${i + 1}:12 - error TS2322: Type "number" is not assignable to type "string" [build-err-${i + 1}].`,
      ),
      'Found 50000 errors in 50000 files.',
    ];
    const buildRaw = buildLines.join('\n');
    const buildRes = compactLargeOutput(undefined, 'tsc massive-errors', buildRaw);

    assert.equal(buildRes.detectedPreset, 'build');
    assert.equal(buildRes.linesBefore, buildLines.length);
    assert.ok(buildRes.linesAfter <= 250, `Expected build linesAfter <= 250, got ${buildRes.linesAfter}`);
    assert.ok(buildRes.savedPercent >= 95, `Expected build savedPercent >= 95, got ${buildRes.savedPercent}`);
    assert.match(buildRes.summaryText, /truncated \d+ additional diagnostic lines; query full indexed log via chunkId/);
    assert.ok(buildRes.summaryText.includes('[build-err-1]'), 'Must preserve first build error');
    assert.ok(buildRes.summaryText.includes('[build-err-50000]'), 'Must preserve last build error');
    assert.ok(buildRes.summaryText.includes('Found 50000 errors in 50000 files.'), 'Must preserve build summary');

    // Middle truncated line remains queryable via chunkId
    const midBuildHit = queryCompactedChunk(buildRes.chunkId, '[build-err-25000]', 3);
    assert.equal(midBuildHit.found, true);
    assert.equal(midBuildHit.matches[0]?.matchedLine, 25_000);

    // 2. 50,000-line failing test stack trace
    const testLines: string[] = [
      'FAIL test/massive-failure.test.ts',
      '✖ suite/massive.test.ts > first failure marker [test-fail-first]',
      '  AssertionError: expected true to equal false [assert-first]',
      ...Array.from(
        { length: 49_994 },
        (_, i) => `    at frameStep${i + 1} (src/runtime/stack_${i + 1}.ts:${i + 10}:5)`,
      ),
      '✖ suite/massive.test.ts > final failure marker [test-fail-last]',
      '  AssertionError: expected 200 to equal 500 [assert-last]',
      'Tests       2 failed | 0 passed (2)',
    ];
    const testRaw = testLines.join('\n');
    const testRes = compactLargeOutput(undefined, 'vitest massive-stack', testRaw);

    assert.equal(testRes.detectedPreset, 'test');
    assert.equal(testRes.linesBefore, testLines.length);
    assert.ok(testRes.linesAfter <= 250, `Expected test linesAfter <= 250, got ${testRes.linesAfter}`);
    assert.ok(testRes.savedPercent >= 95, `Expected test savedPercent >= 95, got ${testRes.savedPercent}`);
    assert.match(testRes.summaryText, /truncated \d+ additional diagnostic lines; query full indexed log via chunkId/);
    assert.ok(testRes.summaryText.includes('[test-fail-first]'), 'Must preserve first test failure');
    assert.ok(testRes.summaryText.includes('[assert-first]'), 'Must preserve first assertion detail');
    assert.ok(testRes.summaryText.includes('[test-fail-last]'), 'Must preserve last test failure');
    assert.ok(testRes.summaryText.includes('[assert-last]'), 'Must preserve last assertion detail');
    assert.ok(testRes.summaryText.includes('Tests       2 failed | 0 passed (2)'), 'Must preserve test summary');

    // 3. Respects custom maxErrorLines bounded to 20..300 and caps huge git output too
    const customSmall = compactLargeOutput(undefined, 'tsc cap-40', buildRaw, { maxErrorLines: 40 });
    assert.ok(customSmall.linesAfter <= 50, `Expected linesAfter <= 50 for cap 40, got ${customSmall.linesAfter}`);

    const clampedMin = compactLargeOutput(undefined, 'tsc cap-min', buildRaw, { maxErrorLines: 5 });
    assert.ok(clampedMin.linesAfter <= 30, `Expected linesAfter <= 30 for min clamp 20, got ${clampedMin.linesAfter}`);

    const clampedMax = compactLargeOutput(undefined, 'tsc cap-max', buildRaw, { maxErrorLines: 999 });
    assert.ok(clampedMax.linesAfter <= 310, `Expected linesAfter <= 310 for max clamp 300, got ${clampedMax.linesAfter}`);

    const hugeGitDiff = Array.from(
      { length: 2000 },
      (_, i) =>
        `diff --git a/src/f${i + 1}.ts b/src/f${i + 1}.ts\n--- a/src/f${i + 1}.ts\n+++ b/src/f${i + 1}.ts\n@@ -1,1 +1,1 @@\n-const a = ${i};\n+const a = ${i + 1};`,
    ).join('\n');
    const gitRes = compactLargeOutput(undefined, 'git massive-diff', hugeGitDiff);
    assert.equal(gitRes.detectedPreset, 'git');
    assert.ok(gitRes.linesAfter <= 250, `Expected git linesAfter <= 250, got ${gitRes.linesAfter}`);
    assert.match(gitRes.summaryText, /truncated \d+ additional diagnostic lines; query full indexed log via chunkId/);
    assert.ok(gitRes.summaryText.includes('diff --git a/src/f1.ts b/src/f1.ts'));
    assert.ok(gitRes.summaryText.includes('diff --git a/src/f2000.ts b/src/f2000.ts'));
  });
});

describe('v0.4.0 Ops 2.0 — Rule Bloat Guard, 100-Tool Budget Meter & MCP Static Health Check', () => {
  it('flags 30KB GEMINI.md as critical bloat, accurately computes tool budget, detects broken local scripts, and leaks zero secrets', async () => {
    await withTempDir('agy-nov-v04-ops-', (tmpDir) => {
      const workspace = path.join(tmpDir, 'repo');
      const dataDir = path.join(tmpDir, 'nov-data-absent');
      fs.mkdirSync(path.join(workspace, '.agents', 'rules'), { recursive: true });
      fs.mkdirSync(path.join(workspace, '.cursor'), { recursive: true });
      fs.mkdirSync(path.join(workspace, 'scripts'), { recursive: true });

      // 30 KB GEMINI.md (> 24 KB single-file limit)
      const bloatLine = 'Always validate input boundaries and avoid oversized always-on instruction docs.\n';
      const geminiContent = `# Workspace GEMINI Rules\n${bloatLine.repeat(400)}`;
      assert.ok(Buffer.byteLength(geminiContent, 'utf8') > 30 * 1024);
      fs.writeFileSync(path.join(workspace, 'GEMINI.md'), geminiContent, 'utf8');
      fs.writeFileSync(path.join(workspace, '.agents', 'rules', 'concise.md'), '# Short Rule\nKeep PRs focused.\n', 'utf8');

      // Existing local script for healthy server
      fs.writeFileSync(path.join(workspace, 'scripts', 'valid-server.js'), 'console.log("ok");\n', 'utf8');

      const fakeApiKey = 'sk-super-fake-secret-key-do-not-leak-847291';
      const fakeJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEifQ.fake_signature_never_echo';

      // .mcp.json with 6 distinct servers
      fs.writeFileSync(
        path.join(workspace, '.mcp.json'),
        JSON.stringify(
          {
            mcpServers: {
              'srv-1-valid': {
                command: 'node',
                args: ['./scripts/valid-server.js'],
                env: { SAFE_TOKEN: '${SAFE_TOKEN}' },
              },
              'srv-2-explicit-tools': {
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-memory'],
                tools: ['mem_read', 'mem_write', 'mem_list', 'mem_delete'],
              },
              'srv-3-missing-arg-script': {
                command: 'node',
                args: ['./scripts/does-not-exist-mcp.js'],
              },
              'srv-4-missing-cmd-script': {
                command: './scripts/missing-runner.sh',
              },
              'srv-5-secrets-and-oauth': {
                command: 'npx',
                args: ['-y', 'some-mcp', '<YOUR_PROJECT_ID>'],
                env: {
                  API_SECRET_KEY: fakeApiKey,
                  OAUTH_ACCESS_TOKEN: fakeJwt,
                  PLACEHOLDER_HOST: '<YOUR_API_HOST>',
                },
                expiresAt: '2020-01-01T00:00:00.000Z',
              },
              'srv-6-missing-transport': {
                args: ['--stdio'],
              },
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      // Duplicate server defined in .cursor/mcp.json (must trigger duplicate warning without double-counting tools)
      fs.writeFileSync(
        path.join(workspace, '.cursor', 'mcp.json'),
        JSON.stringify(
          {
            mcpServers: {
              'srv-1-valid': {
                command: 'node',
                args: ['./scripts/valid-server.js'],
              },
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      // Run with explicit enabledNovTools = 20
      // External tools: 5 default servers (5 * 10 = 50) + srv-2-explicit-tools (4) = 54
      // Total = 20 + 54 = 74
      const report = auditWorkspaceReadOnly(workspace, dataDir, { enabledNovTools: 20 });

      // Zero disk writes
      assert.equal(fs.existsSync(dataDir), false);

      // Rule Bloat assertions
      assert.equal(report.ruleBloat.status, 'critical');
      assert.equal(report.ruleBloat.singleFileLimitBytes, 24576);
      assert.equal(report.ruleBloat.aggregateTokenLimit, 20000);
      assert.equal(report.ruleBloat.largestFilePath, 'GEMINI.md');
      assert.ok(report.ruleBloat.largestFileBytes > 30 * 1024);
      assert.ok(report.ruleBloat.totalRuleBytes >= report.ruleBloat.largestFileBytes);
      assert.ok(report.ruleBloat.offendingFiles.some((f) => f.path === 'GEMINI.md'));
      assert.ok(
        report.recommendations.some((r) => r.level === 'critical' && r.code === 'ops.rule-bloat' && /429/.test(r.detail)),
      );

      // Tool Budget exact arithmetic & status threshold checks
      assert.equal(report.toolBudget.agyNovTools, 20);
      assert.equal(report.toolBudget.externalServersCount, 6);
      assert.equal(report.toolBudget.estimatedExternalTools, 54);
      assert.equal(report.toolBudget.estimatedTotalTools, 74);
      assert.equal(report.toolBudget.hardLimit, 100);
      assert.equal(report.toolBudget.usagePercent, 74);
      assert.equal(report.toolBudget.status, 'ok');

      const warnBudgetReport = auditWorkspaceAssets(workspace, dataDir, { enabledNovTools: 25 });
      assert.equal(warnBudgetReport.toolBudget.estimatedTotalTools, 79);
      assert.equal(warnBudgetReport.toolBudget.status, 'warn');

      const critBudgetReport = auditWorkspaceAssets(workspace, dataDir, { enabledNovTools: 45 });
      assert.equal(critBudgetReport.toolBudget.estimatedTotalTools, 99);
      assert.equal(critBudgetReport.toolBudget.status, 'critical');

      // MCP Static Health Check assertions
      assert.ok(
        report.mcpHealthFindings.some(
          (f) =>
            f.severity === 'error' &&
            f.serverName === 'srv-3-missing-arg-script' &&
            f.message.includes('does-not-exist-mcp.js'),
        ),
        'Expected missing local script finding in args',
      );
      assert.ok(
        report.mcpHealthFindings.some(
          (f) =>
            f.severity === 'error' &&
            f.serverName === 'srv-4-missing-cmd-script' &&
            f.message.includes('missing-runner.sh'),
        ),
        'Expected missing local script finding in command',
      );
      assert.ok(
        report.mcpHealthFindings.some(
          (f) => f.severity === 'error' && f.serverName === 'srv-6-missing-transport',
        ),
        'Expected missing transport field finding',
      );
      assert.ok(
        report.mcpHealthFindings.some(
          (f) => f.severity === 'warn' && f.serverName === 'srv-1-valid' && /duplicate/i.test(f.message),
        ),
        'Expected duplicate server name finding across MCP files',
      );
      assert.ok(
        report.mcpHealthFindings.some(
          (f) => f.serverName === 'srv-5-secrets-and-oauth' && /placeholder/i.test(f.message),
        ),
        'Expected unresolved placeholder finding',
      );
      assert.ok(
        report.mcpHealthFindings.some(
          (f) => f.serverName === 'srv-5-secrets-and-oauth' && /oauth|token/i.test(f.message),
        ),
        'Expected OAuth/token warning finding',
      );

      // Strict secret non-leakage across ENTIRE serialized report
      const serialized = JSON.stringify(report);
      assert.equal(serialized.includes(fakeApiKey), false, 'Fake API key must NEVER appear in audit report');
      assert.equal(serialized.includes(fakeJwt), false, 'Fake JWT must NEVER appear in audit report');
      assert.equal(serialized.includes('fake_signature_never_echo'), false);
      assert.equal(serialized.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), false);
    });
  });

  it('triggers warn at >= 80% rule threshold and critical when aggregate rules exceed 20K tokens', async () => {
    await withTempDir('agy-nov-v04-ops-thresholds-', (tmpDir) => {
      const wsWarn = path.join(tmpDir, 'ws-warn');
      fs.mkdirSync(wsWarn, { recursive: true });
      // ~20.5 KB (between 80% = 19.2 KB and 100% = 24 KB)
      fs.writeFileSync(path.join(wsWarn, 'AGENTS.md'), 'A'.repeat(21_000), 'utf8');
      const warnReport = auditWorkspaceAssets(wsWarn);
      assert.equal(warnReport.ruleBloat.status, 'warn');

      const wsAgg = path.join(tmpDir, 'ws-agg');
      fs.mkdirSync(path.join(wsAgg, '.gemini'), { recursive: true });
      // Four files each 22 KB (< 24 KB individually, but ~88,000 chars -> 22,000 tokens > 20,000 aggregate)
      fs.writeFileSync(path.join(wsAgg, 'AGENTS.md'), 'R'.repeat(22_000), 'utf8');
      fs.writeFileSync(path.join(wsAgg, 'CLAUDE.md'), 'C'.repeat(22_000), 'utf8');
      fs.writeFileSync(path.join(wsAgg, 'GEMINI.md'), 'G'.repeat(22_000), 'utf8');
      fs.writeFileSync(path.join(wsAgg, '.gemini', 'extra-rules.md'), 'E'.repeat(22_000), 'utf8');
      const aggReport = auditWorkspaceAssets(wsAgg);
      assert.ok(aggReport.ruleBloat.largestFileBytes <= 24576);
      assert.ok(aggReport.ruleBloat.totalRuleTokens > 20000);
      assert.equal(aggReport.ruleBloat.status, 'critical');
    });
  });

  it('wires live enabledNovTools from config.json in registerOpsModule, keeps 3 model tools, and upgrades demo mode to v0.4.0', async () => {
    await withTempDir('agy-nov-v04-ops-mcp-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'nov-data');
      fs.mkdirSync(workspace, { recursive: true });
      fs.writeFileSync(path.join(workspace, 'AGENTS.md'), '# Agents\nStay compact.\n', 'utf8');
      const hiddenSecret = 'ghp_secretTokenShouldNeverEchoAnywhere123456';
      fs.writeFileSync(
        path.join(workspace, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: hiddenSecret } },
            localBroken: { command: 'node', args: ['./missing-local-mcp.cjs'] },
          },
        }),
        'utf8',
      );

      // Apply 'power' preset to dataDir/config.json so live audit reflects power tool count
      applyPresetConfig(dataDir, 'power');
      const expectedNovTools = countEnabledModelTools(PRESET_DEFINITIONS.power.modules);

      const server = new McpServer(
        { name: 'v04-ops-test', version: '0.4.0' },
        { capabilities: { tools: { listChanged: true } } },
      );
      const reg = registerOpsModule(server, { dataDir, workspaceRoot: workspace, demoMode: false }, 'ui://agy-nov/app.html');
      assert.equal(reg.modelTools.length, 3);
      assert.deepEqual(
        reg.modelTools.map((t) => t.name),
        MODULE_CATALOG.ops.modelToolNames,
      );

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'v04-ops-client', version: '0.4.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        const auditCall = await client.callTool({ name: 'ops_audit_workspace', arguments: {} });
        assert.equal(auditCall.isError, undefined);
        const text = (auditCall.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
        assert.match(text, /Rule Bloat:/);
        assert.match(text, /Tool Budget \(\d+\/100\):/);
        assert.equal(text.includes(hiddenSecret), false);

        const sc = auditCall.structuredContent as {
          toolBudget: { agyNovTools: number; externalServersCount: number; estimatedTotalTools: number };
          mcpHealthFindings: Array<{ severity: string; message: string }>;
        };
        assert.equal(sc.toolBudget.agyNovTools, expectedNovTools);
        assert.equal(sc.toolBudget.externalServersCount, 2);
        assert.equal(sc.toolBudget.estimatedTotalTools, expectedNovTools + 20);
        assert.equal(JSON.stringify(sc).includes(hiddenSecret), false);
      } finally {
        await client.close();
        await server.close();
      }

      // Demo mode audit & v0.4.0 default version with zero disk writes
      const demoDataDir = path.join(tmpDir, 'demo-data-absent');
      const demoAudit = createDemoWorkspaceAudit(workspace, 12);
      assert.equal(demoAudit.mode, 'demo');
      assert.equal(demoAudit.ruleBloat.singleFileLimitBytes, 24576);
      assert.equal(demoAudit.toolBudget.hardLimit, 100);
      assert.ok(demoAudit.mcpHealthFindings.length >= 1);

      const demoServer = new McpServer(
        { name: 'v04-ops-demo', version: '0.4.0' },
        { capabilities: { tools: { listChanged: true } } },
      );
      registerOpsModule(demoServer, { dataDir: demoDataDir, workspaceRoot: workspace, demoMode: true }, 'ui://agy-nov/app.html');
      const [dcTransport, dsTransport] = InMemoryTransport.createLinkedPair();
      const demoClient = new Client({ name: 'v04-ops-demo-client', version: '0.4.0' });
      await demoServer.connect(dsTransport);
      await demoClient.connect(dcTransport);
      try {
        const rendered = await demoClient.callTool({
          name: 'ops_render_prompt',
          arguments: { id: 'demo-release-readiness', variables: {} },
        });
        const rText = (rendered.structuredContent as { rendered: string }).rendered;
        assert.ok(rText.includes('v1.0.0'), `Expected demo template default version v1.0.0, got: ${rText}`);
        assert.equal(fs.existsSync(demoDataDir), false);
      } finally {
        await demoClient.close();
        await demoServer.close();
      }
    });
  });

  it('redacts real secret formats in .mcp.json path/arg values without relying on sensitive keyword names', async () => {
    await withTempDir('agy-nov-v04-ops-secret-paths-', (tmpDir) => {
      const workspace = path.join(tmpDir, 'repo');
      const dataDir = path.join(tmpDir, 'nov-data-absent');
      fs.mkdirSync(workspace, { recursive: true });

      const ghSecret = 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6';
      const skSecret = 'sk-proj-x9Y8z7W6v5U4t3S2r1Q0p9O8n7M6';
      const awsSecret = 'AKIAIOSFODNN7EXAMPLE';

      fs.writeFileSync(
        path.join(workspace, '.mcp.json'),
        JSON.stringify(
          {
            mcpServers: {
              'alpha-runner': {
                command: 'node',
                args: [`./${ghSecret}`, `../${skSecret}`, `./${awsSecret}.js`],
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

      const serialized = JSON.stringify(report);
      assert.equal(serialized.includes(ghSecret), false, 'GitHub PAT must NEVER appear in audit report');
      assert.equal(serialized.includes(skSecret), false, 'OpenAI sk-proj key must NEVER appear in audit report');
      assert.equal(serialized.includes(awsSecret), false, 'AWS AKIA key must NEVER appear in audit report');
      assert.ok(serialized.includes('<redacted-path>'), 'Audit report must replace secret path segments with <redacted-path>');

      const redactedFindings = report.mcpHealthFindings.filter((f) => f.message.includes('<redacted-path>'));
      assert.ok(
        redactedFindings.length >= 3,
        `Expected at least 3 redacted MCP health findings, got ${redactedFindings.length}`,
      );
    });
  });
});
