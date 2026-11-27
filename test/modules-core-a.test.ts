import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getModuleDataDir, MODULE_CATALOG } from '../src/core/config.js';
import { normalizeHookPayload } from '../src/core/utils.js';
import { handleGuardPreToolHook } from '../src/modules/guard/hook.js';
import { evaluateToolCall, redactCommand } from '../src/modules/guard/policy.js';
import { registerGuardModule } from '../src/modules/guard/register.js';
import { diffSnapshot, loadAuditLog, loadSnapshots, restoreSnapshot } from '../src/modules/guard/store.js';
import { DEFAULT_POLICY } from '../src/modules/guard/types.js';
import { AnnotationStore, evaluateAnnotationStaleness } from '../src/modules/review/annotations.js';
import { buildSplitRows, extractCodeSnippet, parseUnifiedDiff } from '../src/modules/review/diff-parser.js';
import { scanGitDiff } from '../src/modules/review/git-diff.js';
import { handleReviewHook, readReviewSignal } from '../src/modules/review/hook.js';
import { buildReviewPrompt } from '../src/modules/review/prompt-builder.js';
import { registerReviewModule } from '../src/modules/review/register.js';
import { listSessions, loadSessionDetail, readLiveHookState } from '../src/modules/xray/discovery.js';
import { handleXrayHook } from '../src/modules/xray/hook.js';
import { registerXrayModule } from '../src/modules/xray/register.js';
import { searchSessions } from '../src/modules/xray/search.js';
import { parseTranscriptLines, renderRedactedBrief } from '../src/modules/xray/transcript.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

describe('Builder A — Review module core & hook', () => {
  it('parses unified diff, computes risk tags, manages annotations, and builds prioritized prompt', async () => {
    await withTempDir('agy-nov-review-', (tmpDir) => {
      const sampleDiff = [
        'diff --git a/src/auth/jwt-verify.ts b/src/auth/jwt-verify.ts',
        'index 1111111..2222222 100644',
        '--- a/src/auth/jwt-verify.ts',
        '+++ b/src/auth/jwt-verify.ts',
        '@@ -1,4 +1,6 @@',
        ' export function verifyToken(token: string) {',
        '-  return token.length > 0;',
        '+  if (!token) return true;',
        '+  return token.startsWith("Bearer ");',
        ' }',
        'diff --git a/test/jwt-verify.test.ts b/test/jwt-verify.test.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/test/jwt-verify.test.ts',
        '@@ -0,0 +1,2 @@',
        '+import { verifyToken } from "../src/auth/jwt-verify";',
        '+console.log(verifyToken("x"));',
      ].join('\n');

      const parsed = parseUnifiedDiff(sampleDiff, { repoPath: tmpDir });
      assert.equal(parsed.truncated, false);
      assert.equal(parsed.files.length, 2);

      const authFile = parsed.files.find((f) => f.path === 'src/auth/jwt-verify.ts');
      const testFile = parsed.files.find((f) => f.path === 'test/jwt-verify.test.ts');
      assert.ok(authFile);
      assert.ok(testFile);
      assert.ok(authFile.riskTags.includes('security-sensitive'));
      assert.ok(testFile.riskTags.includes('test'));
      assert.equal(authFile.additions, 2);
      assert.equal(authFile.deletions, 1);

      const splitRows = buildSplitRows(authFile.hunks[0].lines);
      assert.ok(splitRows.length >= 3);

      const snippet = extractCodeSnippet(authFile, 2, 3, 'new');
      assert.match(snippet, /2 \| \+  if \(!token\) return true;/);

      const reviewDataDir = getModuleDataDir(tmpDir, 'review');
      const store = new AnnotationStore(reviewDataDir);

      const ann1 = store.addAnnotation({
        repoKey: 'repo_test_01',
        scope: 'working',
        filePath: authFile.path,
        startLine: 2,
        endLine: 3,
        category: 'security',
        comment: 'Empty token returns true and bypasses auth.',
        codeSnippet: snippet,
        fileFingerprint: authFile.fingerprint,
      });

      const ann2 = store.addAnnotation({
        repoKey: 'repo_test_01',
        scope: 'working',
        filePath: testFile.path,
        startLine: 2,
        category: 'nit',
        comment: 'Replace console.log with assert.',
      });

      const updated = store.updateAnnotation('repo_test_01', 'working', ann2.id, {
        comment: 'Use node:assert instead of console.log.',
      });
      assert.equal(updated?.comment, 'Use node:assert instead of console.log.');

      const resolvedToggle = store.toggleResolve('repo_test_01', 'working', ann2.id);
      assert.equal(resolvedToggle?.resolved, true);

      const evaluated = evaluateAnnotationStaleness(
        store.listAnnotations('repo_test_01', 'working'),
        parsed.files,
      );
      assert.equal(evaluated.find((a) => a.id === ann1.id)?.stale, false);

      const prompt = buildReviewPrompt({
        repoName: 'demo-repo',
        branch: 'main',
        scope: 'working',
        annotations: evaluated,
        files: parsed.files,
      });
      assert.equal(prompt.annotationCount, 1);
      assert.equal(prompt.categoryCounts.security, 1);
      assert.match(prompt.markdown, /\[SECURITY\]/);
      assert.match(prompt.markdown, /src\/auth\/jwt-verify\.ts:L2-L3/);

      const cleared = store.clearResolved('repo_test_01', 'working');
      assert.equal(cleared, 1);
      assert.equal(store.deleteAnnotation('repo_test_01', 'working', ann1.id), true);
      assert.equal(store.listAnnotations('repo_test_01', 'working').length, 0);
    });
  });

  it('scans a real temporary git repo and writes review-signal.json from handleReviewHook', async () => {
    await withTempDir('agy-nov-review-git-', (tmpDir) => {
      const repoDir = path.join(tmpDir, 'repo');
      const dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(repoDir, { recursive: true });

      execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir, stdio: 'ignore' });

      fs.writeFileSync(path.join(repoDir, 'index.ts'), 'export const v = 1;\n', 'utf8');
      execFileSync('git', ['add', 'index.ts'], { cwd: repoDir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir, stdio: 'ignore' });

      fs.writeFileSync(path.join(repoDir, 'index.ts'), 'export const v = 2;\n', 'utf8');
      fs.writeFileSync(path.join(repoDir, 'new-file.ts'), 'export const added = true;\n', 'utf8');

      const scan = scanGitDiff({ repoPath: repoDir, scope: 'working' });
      assert.equal(scan.isGitRepo, true);
      assert.equal(scan.totalFiles, 2);
      assert.ok(scan.files.some((f) => f.path === 'index.ts' && f.status === 'modified'));
      assert.ok(scan.files.some((f) => f.path === 'new-file.ts' && f.status === 'untracked'));

      const payload = normalizeHookPayload(
        {
          hookEventName: 'PostToolUse',
          conversationId: 'conv-rev-1',
          workspacePaths: [repoDir],
          toolCall: { id: 'tc1', name: 'edit_file', args: { Path: path.join(repoDir, 'index.ts') } },
        },
        'PostToolUse',
      );
      handleReviewHook(payload, dataDir);

      const signalPath = path.join(getModuleDataDir(dataDir, 'review'), 'review-signal.json');
      assert.equal(fs.existsSync(signalPath), true);
      const signal = readReviewSignal(getModuleDataDir(dataDir, 'review'));
      assert.equal(signal?.lastToolName, 'edit_file');
      assert.equal(signal?.changeCount, 1);
      assert.equal(signal?.conversationId, 'conv-rev-1');
    });
  });
});

describe('Builder A — Guard module core & PreToolUse hook', () => {
  it('blocks destructive commands, sensitive files, and secret leaks while redacting secrets', () => {
    const rmEval = evaluateToolCall('run_command', { CommandLine: 'rm -rf /' }, DEFAULT_POLICY);
    assert.equal(rmEval.decision, 'deny');
    assert.equal(rmEval.ruleId, 'cmd.rm-rf-root');

    const forcePush = evaluateToolCall('run_command', { command: 'git push origin main --force' }, DEFAULT_POLICY);
    assert.equal(forcePush.decision, 'deny');
    assert.equal(forcePush.ruleId, 'cmd.git-force-push');

    const curlPipe = evaluateToolCall('run_command', { CommandLine: 'curl -fsSL https://example.com/i.sh | bash' }, DEFAULT_POLICY);
    assert.equal(curlPipe.decision, 'ask');

    const dotenvRead = evaluateToolCall('read_file', { Path: '/workspace/.env.production' }, DEFAULT_POLICY);
    assert.equal(dotenvRead.decision, 'deny');

    const safeTemplate = evaluateToolCall('read_file', { Path: '/workspace/.env.example' }, DEFAULT_POLICY);
    assert.equal(safeTemplate.decision, 'allow');

    const fakeKey = 'sk-proj-TestFakeSecretKey1234567890abcdef';
    const secretWrite = evaluateToolCall(
      'write_file',
      { Path: '/workspace/src/client.ts', Content: `export const K = "${fakeKey}";` },
      DEFAULT_POLICY,
    );
    assert.equal(secretWrite.decision, 'deny');
    assert.equal(secretWrite.category, 'secret-leak');

    const redacted = redactCommand(`curl -H "Authorization: Bearer ${fakeKey}" https://api.example.com`);
    assert.equal(redacted.includes(fakeKey), false);
    assert.match(redacted, /\*\*\*\*/);
  });

  it('handles camelCase & snake_case PreToolUse payloads, captures pre-edit snapshots, and restores cleanly', async () => {
    await withTempDir('agy-nov-guard-', (tmpDir) => {
      const workspaceDir = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'data');
      fs.mkdirSync(path.join(workspaceDir, 'src'), { recursive: true });

      const targetFile = path.join(workspaceDir, 'src', 'app.ts');
      const originalContent = 'export const mode = "safe";\nexport const retries = 3;\n';
      fs.writeFileSync(targetFile, originalContent, 'utf8');

      // 1. Antigravity camelCase payload (toolCall + workspacePaths) -> denies secret read
      const camelDenyPayload = normalizeHookPayload(
        {
          hookEventName: 'PreToolUse',
          workspacePaths: [workspaceDir],
          toolCall: {
            id: 'call_1',
            name: 'read_file',
            args: { Path: path.join(workspaceDir, '.env') },
          },
        },
        'PreToolUse',
      );
      const camelDeny = handleGuardPreToolHook(camelDenyPayload, dataDir);
      assert.equal(camelDeny.decision, 'deny');
      assert.ok(camelDeny.reason?.includes('.env'));

      // 2. snake_case payload (tool_name + tool_input + workspace_root) -> denies force push
      const snakeDenyPayload = normalizeHookPayload(
        {
          hook_event_name: 'PreToolUse',
          workspace_root: workspaceDir,
          tool_name: 'run_command',
          tool_input: { command: 'git push origin main --force' },
        },
        'PreToolUse',
      );
      const snakeDeny = handleGuardPreToolHook(snakeDenyPayload, dataDir);
      assert.equal(snakeDeny.decision, 'deny');
      assert.ok(snakeDeny.reason?.includes('Git force push'));

      // 3. Antigravity camelCase PreToolUse edit_file -> allows and automatically snapshots original file
      const camelEditPayload = normalizeHookPayload(
        {
          hookEventName: 'PreToolUse',
          workspacePaths: [workspaceDir],
          toolCall: {
            id: 'call_2',
            name: 'edit_file',
            args: { Path: targetFile, Replacement: 'export const mode = "broken";' },
          },
        },
        'PreToolUse',
      );
      const editRes = handleGuardPreToolHook(camelEditPayload, dataDir);
      assert.equal(editRes.decision, 'allow');

      const guardDataDir = getModuleDataDir(dataDir, 'guard');
      const snapshots = loadSnapshots(guardDataDir);
      assert.equal(snapshots.length, 1);
      const snapId = snapshots[0].id;
      assert.equal(snapshots[0].relPath, path.join('src', 'app.ts'));

      // 4. Simulate agent mutating the file, verify diff, then restore to pre-edit snapshot
      const mutatedContent = 'export const mode = "broken";\nexport const retries = 0;\n';
      fs.writeFileSync(targetFile, mutatedContent, 'utf8');

      const diff = diffSnapshot(guardDataDir, snapId, workspaceDir);
      assert.equal(diff.identical, false);
      assert.equal(diff.added, 2);
      assert.equal(diff.removed, 2);

      const restored = restoreSnapshot({
        dataDir: guardDataDir,
        snapshotId: snapId,
        workspaceRoot: workspaceDir,
      });
      assert.equal(restored.restored, true);
      assert.ok(restored.safetyBackupId);
      assert.equal(fs.readFileSync(targetFile, 'utf8'), originalContent);

      const audit = loadAuditLog(guardDataDir);
      assert.ok(audit.some((e) => e.decision === 'deny' && e.ruleId === 'path.dotenv'));
      assert.ok(audit.some((e) => e.decision === 'deny' && e.ruleId === 'cmd.git-force-push'));
      assert.ok(audit.some((e) => e.decision === 'restored' && e.snapshotId === snapId));
    });
  });

  it('does not seed demo data or write files when registered in live mode', async () => {
    await withTempDir('agy-nov-guard-live-', (tmpDir) => {
      const server = new McpServer({ name: 'test-nov', version: '0.1.0' });
      const dataDir = path.join(tmpDir, 'data');
      registerGuardModule(
        server,
        { dataDir, workspaceRoot: tmpDir, demoMode: false },
        'ui://agy-nov/app.html',
      );
      const guardDataDir = getModuleDataDir(dataDir, 'guard');
      assert.equal(fs.existsSync(guardDataDir), false);
    });
  });
});

describe('Builder A — X-Ray module core, EN+CJK search & hook', () => {
  it('parses transcripts, performs EN+CJK BM25 search, redacts briefs, and writes live-state.json', async () => {
    await withTempDir('agy-nov-xray-', (tmpDir) => {
      const brainRoot = path.join(tmpDir, 'brain');
      const dataDir = path.join(tmpDir, 'data');

      // Create two sessions inside brainRoot
      const sessA = path.join(brainRoot, 'sess-alpha-01');
      const sessALogs = path.join(sessA, '.system_generated', 'logs');
      fs.mkdirSync(sessALogs, { recursive: true });
      const transcriptA = path.join(sessALogs, 'transcript.jsonl');

      const linesA = [
        JSON.stringify({
          step_index: 0,
          type: 'USER_INPUT',
          source: 'USER',
          created_at: '2026-11-26T10:00:00Z',
          content: '<USER_REQUEST>优化网关限流策略并排查 Redis 缓存击穿问题</USER_REQUEST>',
        }),
        JSON.stringify({
          step_index: 1,
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          created_at: '2026-11-26T10:00:05Z',
          model: 'gemini-4-neon-high',
          input_tokens: 12000,
          cache_read_tokens: 0,
          output_tokens: 800,
          thinking: 'Inspecting gateway rate limiter implementation.',
          tool_calls: [
            { name: 'read_file', args: { Path: '/workspace/src/gateway/rate-limit.ts' } },
            { name: 'edit_file', args: { Path: '/workspace/src/gateway/rate-limit.ts' } },
          ],
          content: 'Reading gateway rate limiter.',
        }),
        JSON.stringify({
          step_index: 2,
          type: 'GENERIC',
          source: 'TOOL',
          created_at: '2026-11-26T10:00:06Z',
          content: 'x'.repeat(10000),
        }),
        JSON.stringify({
          step_index: 3,
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          created_at: '2026-11-26T10:00:20Z',
          model: 'gemini-4-neon-high',
          input_tokens: 4000,
          cache_read_tokens: 20000,
          output_tokens: 600,
          content: 'Applied token bucket with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature12345',
        }),
      ];
      fs.writeFileSync(transcriptA, `${linesA.join('\n')}\n`, 'utf8');
      fs.writeFileSync(
        path.join(sessA, 'notes.md'),
        '# 限流架构说明\n采用滑动窗口 + Redis Lua 脚本防止缓存击穿。\n',
        'utf8',
      );

      const sessB = path.join(brainRoot, 'sess-beta-02');
      fs.mkdirSync(sessB, { recursive: true });
      fs.writeFileSync(
        path.join(sessB, 'transcript.jsonl'),
        [
          JSON.stringify({
            step_index: 0,
            type: 'USER_INPUT',
            source: 'USER',
            created_at: '2026-11-26T09:00:00Z',
            content: 'Refactor OAuth2 PKCE singleflight refresh middleware',
          }),
          JSON.stringify({
            step_index: 1,
            type: 'PLANNER_RESPONSE',
            source: 'MODEL',
            created_at: '2026-11-26T09:00:10Z',
            model: 'gemini-4-flash',
            input_tokens: 5000,
            cache_read_tokens: 15000,
            output_tokens: 400,
            content: 'Implemented singleflight lock for OAuth2 refresh.',
          }),
        ].join('\n'),
        'utf8',
      );

      // Parse transcript lines directly
      const detail = parseTranscriptLines(linesA, {
        transcriptPath: transcriptA,
        brainDir: sessA,
        sessionId: 'sess-alpha-01',
        source: 'custom',
      });
      assert.equal(detail.summary.turns, 2);
      assert.equal(detail.summary.totalInputTokens, 36000);
      assert.equal(detail.summary.totalCacheReadTokens, 20000);
      assert.equal(detail.fileActivity.length, 1);
      assert.deepEqual(detail.fileActivity[0].ops.sort(), ['edit', 'read']);
      assert.equal(detail.toolHotspots[0].toolName, 'read_file');

      const brief = renderRedactedBrief(detail);
      assert.match(brief, /Session X-Ray Brief/);
      assert.equal(brief.includes('eyJhbGciOiJIUzI1NiI'), false);

      // EN + CJK BM25 search
      const discoveryOpts = {
        brainDirs: [{ dir: brainRoot, source: 'custom' as const }],
        dataDir: getModuleDataDir(dataDir, 'xray'),
      };
      const cjkHits = searchSessions('缓存击穿', discoveryOpts);
      assert.ok(cjkHits.length >= 1);
      assert.equal(cjkHits[0].sessionId, 'sess-alpha-01');

      const enHits = searchSessions('singleflight OAuth2', discoveryOpts);
      assert.ok(enHits.length >= 1);
      assert.equal(enHits[0].sessionId, 'sess-beta-02');

      const summaries = listSessions(discoveryOpts);
      assert.equal(summaries.length, 2);

      // Hook writes live-state.json into <dataDir>/modules/xray/
      const hookPayload = normalizeHookPayload(
        {
          hookEventName: 'PostToolUse',
          conversationId: 'sess-alpha-01',
          transcriptPath: transcriptA,
          workspacePaths: [tmpDir],
          stepIdx: 3,
          toolCall: { name: 'edit_file' },
        },
        'PostToolUse',
      );
      handleXrayHook(hookPayload, dataDir);

      const liveStatePath = path.join(getModuleDataDir(dataDir, 'xray'), 'live-state.json');
      assert.equal(fs.existsSync(liveStatePath), true);
      const liveState = readLiveHookState(getModuleDataDir(dataDir, 'xray'));
      assert.equal(liveState.activeConversationId, 'sess-alpha-01');
      assert.equal(liveState.lastToolName, 'edit_file');
      assert.equal(liveState.recentEvents.length, 1);

      const activeDetail = loadSessionDetail(undefined, discoveryOpts);
      assert.equal(activeDetail?.summary.id, 'sess-alpha-01');
    });
  });
});

describe('Builder A — Unified McpServer registration, tool naming & dynamic toggles', () => {
  it('registers review, guard, and xray on a single McpServer without conflicts and executes tools via MCP', async () => {
    await withTempDir('agy-nov-unified-', async (tmpDir) => {
      const uiUri = 'ui://agy-nov/app.html';
      const dataDir = path.join(tmpDir, 'data');
      const workspaceRoot = path.join(tmpDir, 'ws');
      fs.mkdirSync(workspaceRoot, { recursive: true });
      fs.writeFileSync(path.join(workspaceRoot, 'hello.ts'), 'export const greeting = "hello";\n', 'utf8');

      const server = new McpServer(
        { name: 'agy-nov-test', version: '0.1.0' },
        { capabilities: { tools: {} } },
      );

      const runtimeOpts = {
        dataDir,
        workspaceRoot,
        demoMode: true,
      };

      const reviewReg = registerReviewModule(server, runtimeOpts, uiUri);
      const guardReg = registerGuardModule(server, runtimeOpts, uiUri);
      const xrayReg = registerXrayModule(server, runtimeOpts, uiUri);

      assert.equal(reviewReg.moduleId, 'review');
      assert.equal(guardReg.moduleId, 'guard');
      assert.equal(xrayReg.moduleId, 'xray');

      assert.deepEqual(
        reviewReg.modelTools.map((t) => t.name),
        MODULE_CATALOG.review.modelToolNames,
      );
      assert.deepEqual(
        guardReg.modelTools.map((t) => t.name),
        MODULE_CATALOG.guard.modelToolNames,
      );
      assert.deepEqual(
        xrayReg.modelTools.map((t) => t.name),
        MODULE_CATALOG.xray.modelToolNames,
      );

      // Connect real MCP client over InMemoryTransport
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test-client', version: '0.1.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        const listed = await client.listTools();
        const names = new Set(listed.tools.map((t) => t.name));

        const expectedAll = [
          // review (2 + 8)
          'review_open',
          'review_get_summary',
          'app_review_get_diff',
          'app_review_add_annotation',
          'app_review_update_annotation',
          'app_review_toggle_resolve',
          'app_review_delete_annotation',
          'app_review_clear_resolved',
          'app_review_mark_file_viewed',
          'app_review_build_prompt',
          // guard (4 + 6)
          'guard_status',
          'guard_list_snapshots',
          'guard_create_checkpoint',
          'guard_scan_secrets',
          'app_guard_get_state',
          'app_guard_diff_snapshot',
          'app_guard_restore_snapshot',
          'app_guard_update_policy',
          'app_guard_scan_workspace',
          'app_guard_simulate_threat',
          // xray (4 + 8)
          'xray_analyze_context',
          'xray_get_file_activity',
          'xray_search_sessions',
          'xray_export_brief',
          'app_xray_list_sessions',
          'app_xray_get_session_detail',
          'app_xray_search_sessions',
          'app_xray_export_brief',
          'app_xray_get_cost_analytics',
          'app_xray_export_handoff',
          'app_xray_export_otlp',
          'app_xray_export_csv',
        ];

        assert.equal(listed.tools.length, expectedAll.length);
        for (const name of expectedAll) {
          assert.ok(names.has(name), `Missing registered tool: ${name}`);
        }

        // Verify _meta on review_open & all app_* tools
        const reviewOpenMeta = listed.tools.find((t) => t.name === 'review_open')?._meta as
          | { ui?: { resourceUri?: string } }
          | undefined;
        assert.equal(reviewOpenMeta?.ui?.resourceUri, uiUri);

        for (const tool of listed.tools) {
          if (tool.name.startsWith('app_')) {
            const meta = tool._meta as { ui?: { visibility?: string[] } } | undefined;
            assert.deepEqual(meta?.ui?.visibility, ['app'], `Expected app-only visibility on ${tool.name}`);
          }
        }

        // Invoke review_open -> verify novModule: 'review'
        const reviewOpenRes = await client.callTool({ name: 'review_open', arguments: { demo: true } });
        const reviewStructured = reviewOpenRes.structuredContent as Record<string, unknown>;
        assert.equal(reviewStructured.novModule, 'review');

        // Invoke guard_status & guard_create_checkpoint
        const guardStatusRes = await client.callTool({ name: 'guard_status', arguments: {} });
        const guardStructured = guardStatusRes.structuredContent as { mode: string; stats: { totalSnapshots: number } };
        assert.equal(guardStructured.mode, 'demo');
        assert.ok(guardStructured.stats.totalSnapshots >= 2);

        const cpRes = await client.callTool({
          name: 'guard_create_checkpoint',
          arguments: { files: ['hello.ts'], reason: 'unit test checkpoint' },
        });
        assert.equal(cpRes.isError, undefined);
        const cpStructured = cpRes.structuredContent as { created: Array<{ id: string; relPath: string }> };
        assert.equal(cpStructured.created.length, 1);
        assert.equal(cpStructured.created[0].relPath, 'hello.ts');

        const simRes = await client.callTool({
          name: 'app_guard_simulate_threat',
          arguments: { scenario: 'force_push' },
        });
        const simStructured = simRes.structuredContent as { evaluation: { decision: string } };
        assert.equal(simStructured.evaluation.decision, 'deny');

        // Invoke xray tools
        const xrayAnalyzeRes = await client.callTool({ name: 'xray_analyze_context', arguments: {} });
        const xrayStructured = xrayAnalyzeRes.structuredContent as { novModule: string; detail: { summary: { id: string } } };
        assert.equal(xrayStructured.novModule, 'xray');
        assert.equal(xrayStructured.detail.summary.id, 'demo-auth-refactor-2026');

        const xraySearchRes = await client.callTool({
          name: 'xray_search_sessions',
          arguments: { query: 'PKCE' },
        });
        const searchStructured = xraySearchRes.structuredContent as { hits: Array<{ sessionId: string }> };
        assert.ok(searchStructured.hits.length >= 1);

        // Verify dynamic enable/disable via returned modelTools handles
        for (const handle of reviewReg.modelTools) {
          handle.disable();
        }
        const afterDisable = await client.listTools();
        const disabledNames = new Set(afterDisable.tools.map((t) => t.name));
        assert.equal(disabledNames.has('review_open'), false);
        assert.equal(disabledNames.has('review_get_summary'), false);
        assert.equal(disabledNames.has('guard_status'), true);

        for (const handle of reviewReg.modelTools) {
          handle.enable();
        }
        const afterEnable = await client.listTools();
        const enabledNames = new Set(afterEnable.tools.map((t) => t.name));
        assert.equal(enabledNames.has('review_open'), true);
        assert.equal(enabledNames.has('review_get_summary'), true);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});
