import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MODULE_CATALOG } from '../src/core/catalog.js';
import { registerMemModule } from '../src/modules/mem/register.js';
import { registerRadarModule } from '../src/modules/radar/register.js';
import { resolveAllowedReviewTarget } from '../src/modules/review/git-diff.js';
import { buildReviewPrompt } from '../src/modules/review/prompt-builder.js';
import {
  loadActiveSpecComplianceReadOnly,
  registerReviewModule,
} from '../src/modules/review/register.js';
import type { BuiltReviewPrompt, ReviewSession } from '../src/modules/review/types.js';
import { registerSpecModule } from '../src/modules/spec/register.js';
import {
  buildPrDeliverySummary,
  createDefaultVerifyState,
  resolveAllowedVerifyTargetRoot,
  type PrDeliverySummaryResult,
  type VerifyEvidenceRecord,
} from '../src/modules/verify/core.js';
import { registerVerifyModule } from '../src/modules/verify/register.js';
import {
  createWorktree,
  previewWorktreeInclude,
  WORKTREE_INCLUDE_FILE,
  WORKTREE_INCLUDE_MAX_CONFIG_BYTES,
  WORKTREE_INCLUDE_MAX_FILE_BYTES,
  WORKTREE_INCLUDE_MAX_FILES,
  type CreateWorktreeResult,
  type WorktreeIncludePreviewResult,
} from '../src/modules/worktree/core.js';
import { registerWorktreeModule } from '../src/modules/worktree/register.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

function gitSync(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  });
}

function initTempGitRepo(repoDir: string): string {
  fs.mkdirSync(repoDir, { recursive: true });
  gitSync(repoDir, ['init', '-b', 'main']);
  gitSync(repoDir, ['config', 'user.name', 'agy-NOV Pipeline Test']);
  gitSync(repoDir, ['config', 'user.email', 'pipeline@agy-nov.local']);
  gitSync(repoDir, ['config', 'commit.gpgsign', 'false']);

  fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# Pipeline Repo\n', 'utf8');
  fs.writeFileSync(
    path.join(repoDir, 'src', 'service.ts'),
    'export function compute(x: number): number {\n  return x + 1;\n}\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(repoDir, 'check.mjs'),
    [
      'import fs from "node:fs";',
      'const marker = fs.existsSync("worktree-marker.txt") ? fs.readFileSync("worktree-marker.txt", "utf8").trim() : "main";',
      'console.log(`verify-cwd-marker=${marker}`);',
    ].join('\n') + '\n',
    'utf8',
  );
  gitSync(repoDir, ['add', '.']);
  gitSync(repoDir, ['commit', '-m', 'chore: initial commit']);

  return fs.realpathSync(repoDir);
}

describe('v0.9.0 T9.1 — Worktree .worktreeinclude safe whitelist', () => {
  it('copies whitelisted non-sensitive files, blocks 100% of secrets/traversal/symlinks, and never executes scripts', async () => {
    await withTempDir('agy-nov-v09-wtinclude-', async (tmpDir) => {
      const repoRoot = initTempGitRepo(path.join(tmpDir, 'repo'));
      const outsideDir = path.join(tmpDir, 'outside');
      fs.mkdirSync(outsideDir, { recursive: true });
      fs.writeFileSync(path.join(outsideDir, 'outside.txt'), 'secret-outside\n', 'utf8');

      // Prepare legitimate files in main repo
      fs.mkdirSync(path.join(repoRoot, 'config'), { recursive: true });
      fs.mkdirSync(path.join(repoRoot, 'certs'), { recursive: true });
      fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(repoRoot, '.env.example'), 'PORT=3000\n', 'utf8');
      fs.writeFileSync(path.join(repoRoot, '.env.sample'), 'MODE=dev\n', 'utf8');
      fs.writeFileSync(path.join(repoRoot, '.env.template'), 'HOST=127.0.0.1\n', 'utf8');
      fs.writeFileSync(
        path.join(repoRoot, 'config', 'local.dev.json'),
        '{"logLevel":"debug"}\n',
        'utf8',
      );

      // Script file (should be copied as 0644 data only, never executed)
      const sideEffectMarker = path.join(tmpDir, 'script-must-not-run.flag');
      fs.writeFileSync(
        path.join(repoRoot, 'scripts', 'helper.sh'),
        `#!/bin/sh\ntouch "${sideEffectMarker}"\n`,
        { encoding: 'utf8', mode: 0o755 },
      );

      // Sensitive files that MUST be blocked by hard secret redline
      const sensitiveEntries = [
        '.env',
        '.env.local',
        '.env.production',
        'sub/config.env',
        'prod.env',
        'sub/app.env.local',
        '.envrc',
        '.kube/config',
        'kubeconfig',
        'gcp/service-account.json',
        'config/private_key.json',
        'certs/server.pem',
        'certs/tls.key',
        'certs/client.p12',
        'certs/bundle.pfx',
        'id_rsa',
        'id_ed25519',
        'config/app-secret.json',
        'config/db_credentials.json',
        'config/api_token.txt',
        '.npmrc',
        '.pypirc',
        '.netrc',
      ];
      for (const rel of sensitiveEntries) {
        const full = path.join(repoRoot, ...rel.split('/'));
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, 'sensitive-placeholder-data\n', 'utf8');
      }

      // Symlink escapes (leaf symlink and parent-dir symlink)
      fs.symlinkSync(path.join(outsideDir, 'outside.txt'), path.join(repoRoot, 'escape-leaf.txt'));
      fs.symlinkSync(outsideDir, path.join(repoRoot, 'escape-dir'));

      const includeLines = [
        '# Valid non-sensitive whitelist entries',
        '',
        '.env.example',
        '.env.sample',
        '.env.template',
        'config/local.dev.json',
        'scripts/helper.sh',
        // Existing tracked file (must never be overwritten in new worktree)
        'README.md',
        // Sensitive redline entries
        ...sensitiveEntries,
        // Invalid entries: absolute, traversal, wildcard, control char, symlink escapes, nonexistent
        '/etc/hosts',
        '../outside/outside.txt',
        'config/*.json',
        'config/local.?.json',
        'bad\x07name.txt',
        'escape-leaf.txt',
        'escape-dir/outside.txt',
        'does-not-exist.json',
      ];
      fs.writeFileSync(path.join(repoRoot, WORKTREE_INCLUDE_FILE), includeLines.join('\n'), 'utf8');

      // 1. Read-only preview check
      const preview = previewWorktreeInclude(repoRoot);
      assert.equal(preview.hasConfig, true);
      assert.deepEqual(
        preview.eligibleFiles.map((f) => f.path),
        [
          '.env.example',
          '.env.sample',
          '.env.template',
          'config/local.dev.json',
          'scripts/helper.sh',
          'README.md',
        ],
      );
      const blockedSensitive = preview.skippedSensitive.map((s) => s.entry);
      for (const rel of sensitiveEntries) {
        assert.ok(blockedSensitive.includes(rel), `Expected sensitive path blocked: ${rel}`);
      }
      const blockedInvalid = preview.skippedInvalid.map((s) => s.entry);
      assert.ok(blockedInvalid.includes('/etc/hosts'));
      assert.ok(blockedInvalid.includes('../outside/outside.txt'));
      assert.ok(blockedInvalid.includes('config/*.json'));
      assert.ok(blockedInvalid.includes('config/local.?.json'));
      assert.ok(blockedInvalid.includes('escape-leaf.txt'));
      assert.ok(blockedInvalid.includes('escape-dir/outside.txt'));
      assert.ok(blockedInvalid.includes('does-not-exist.json'));

      // 2. Create worktree (applyInclude defaults to true)
      const createdRes = await createWorktree(repoRoot, { branch: 'feat/include-check' });
      const wtPath = createdRes.created.path;

      // Legitimate untracked files copied; existing tracked README.md not overwritten
      assert.deepEqual(createdRes.includedFiles, [
        '.env.example',
        '.env.sample',
        '.env.template',
        'config/local.dev.json',
        'scripts/helper.sh',
      ]);
      assert.ok(createdRes.skippedInvalid.includes('README.md'));
      assert.equal(fs.readFileSync(path.join(wtPath, '.env.example'), 'utf8'), 'PORT=3000\n');
      assert.equal(
        fs.readFileSync(path.join(wtPath, 'config', 'local.dev.json'), 'utf8'),
        '{"logLevel":"debug"}\n',
      );

      // Script was never executed and copied without execute bit
      assert.equal(fs.existsSync(sideEffectMarker), false);
      const copiedScriptStat = fs.statSync(path.join(wtPath, 'scripts', 'helper.sh'));
      assert.equal(copiedScriptStat.mode & 0o111, 0);

      // Zero sensitive files copied into the new worktree
      for (const rel of sensitiveEntries) {
        assert.ok(createdRes.skippedSensitive.includes(rel));
        assert.equal(
          fs.existsSync(path.join(wtPath, ...rel.split('/'))),
          false,
          `Sensitive file must never be copied: ${rel}`,
        );
      }
      assert.equal(fs.existsSync(path.join(wtPath, 'escape-leaf.txt')), false);
      assert.equal(fs.existsSync(path.join(wtPath, 'escape-dir')), false);

      // 3. applyInclude: false skips copying completely
      const noIncludeRes = await createWorktree(repoRoot, {
        branch: 'feat/no-include',
        applyInclude: false,
      });
      assert.deepEqual(noIncludeRes.includedFiles, []);
      assert.deepEqual(noIncludeRes.skippedSensitive, []);
      assert.equal(fs.existsSync(path.join(noIncludeRes.created.path, '.env.example')), false);
    });
  });

  it('enforces .worktreeinclude symlink rejection, 16 KiB config cap, 32-file cap, 512 KiB per-file cap, and 4 MiB total cap', async () => {
    await withTempDir('agy-nov-v09-wtlimits-', (tmpDir) => {
      // A. Symlink .worktreeinclude must be refused
      const repoSym = path.join(tmpDir, 'repo-sym');
      fs.mkdirSync(repoSym, { recursive: true });
      const outsideInclude = path.join(tmpDir, 'external-include');
      fs.writeFileSync(outsideInclude, 'a.txt\n', 'utf8');
      fs.writeFileSync(path.join(repoSym, 'a.txt'), 'ok\n', 'utf8');
      fs.symlinkSync(outsideInclude, path.join(repoSym, WORKTREE_INCLUDE_FILE));
      const symPreview = previewWorktreeInclude(repoSym);
      assert.equal(symPreview.eligibleFiles.length, 0);
      assert.match(symPreview.warning ?? '', /symbolic link/i);

      // B. Oversized .worktreeinclude (> 16 KiB) must be refused
      const repoBigCfg = path.join(tmpDir, 'repo-bigcfg');
      fs.mkdirSync(repoBigCfg, { recursive: true });
      fs.writeFileSync(
        path.join(repoBigCfg, WORKTREE_INCLUDE_FILE),
        '#'.repeat(WORKTREE_INCLUDE_MAX_CONFIG_BYTES + 32),
        'utf8',
      );
      const bigCfgPreview = previewWorktreeInclude(repoBigCfg);
      assert.equal(bigCfgPreview.eligibleFiles.length, 0);
      assert.match(bigCfgPreview.warning ?? '', /16 KiB/i);

      // C. File count cap (> 32 files) and single-file size cap (> 512 KiB)
      const repoCount = path.join(tmpDir, 'repo-count');
      fs.mkdirSync(repoCount, { recursive: true });
      const lines: string[] = [];
      for (let i = 0; i < WORKTREE_INCLUDE_MAX_FILES + 4; i += 1) {
        const name = `file-${String(i).padStart(2, '0')}.txt`;
        fs.writeFileSync(path.join(repoCount, name), `data-${i}\n`, 'utf8');
        lines.push(name);
      }
      fs.writeFileSync(
        path.join(repoCount, 'too-big.bin'),
        Buffer.alloc(WORKTREE_INCLUDE_MAX_FILE_BYTES + 16, 0x61),
      );
      lines.push('too-big.bin');
      fs.writeFileSync(path.join(repoCount, WORKTREE_INCLUDE_FILE), lines.join('\n'), 'utf8');

      const countPreview = previewWorktreeInclude(repoCount);
      assert.equal(countPreview.eligibleFiles.length, WORKTREE_INCLUDE_MAX_FILES);
      assert.ok(countPreview.skippedInvalid.some((s) => s.entry === 'too-big.bin'));
      assert.ok(countPreview.skippedInvalid.some((s) => /32 included files/i.test(s.reason)));

      // D. Cumulative size cap (> 4 MiB across 10 x 480 KiB files)
      const repoTotal = path.join(tmpDir, 'repo-total');
      fs.mkdirSync(repoTotal, { recursive: true });
      const chunkLines: string[] = [];
      const chunkBuf = Buffer.alloc(480 * 1024, 0x62);
      for (let i = 0; i < 10; i += 1) {
        const name = `chunk-${i}.dat`;
        fs.writeFileSync(path.join(repoTotal, name), chunkBuf);
        chunkLines.push(name);
      }
      fs.writeFileSync(path.join(repoTotal, WORKTREE_INCLUDE_FILE), chunkLines.join('\n'), 'utf8');
      const totalPreview = previewWorktreeInclude(repoTotal);
      // 8 * 480 KiB = 3840 KiB <= 4096 KiB; 9th would be 4320 KiB > 4096 KiB
      assert.equal(totalPreview.eligibleFiles.length, 8);
      assert.equal(totalPreview.skippedInvalid.length, 2);
      assert.ok(totalPreview.skippedInvalid.every((s) => /4 MiB/i.test(s.reason)));
    });
  });
});

describe('v0.9.0 T9.1 — Review worktree switching, Spec compliance & two-stage prompt', () => {
  it('switches to a real Git worktree, refuses out-of-repo directories, loads active Spec read-only, and compiles two-stage prompt', async () => {
    await withTempDir('agy-nov-v09-review-', async (tmpDir) => {
      const repoRoot = initTempGitRepo(path.join(tmpDir, 'repo'));
      const outsideDir = path.join(tmpDir, 'outside-repo');
      fs.mkdirSync(outsideDir, { recursive: true });
      const dataDir = path.join(tmpDir, 'data-absent');

      // Create a real worktree and modify a file only inside the worktree
      const wtRes = await createWorktree(repoRoot, { branch: 'feat/review-target' });
      const wtPath = wtRes.created.path;
      fs.writeFileSync(
        path.join(wtPath, 'src', 'service.ts'),
        'export function compute(x: number): number {\n  return x * 2;\n}\n',
        'utf8',
      );

      // Verify missing spec/state.json returns null with zero disk writes
      assert.equal(loadActiveSpecComplianceReadOnly(dataDir), null);
      assert.equal(fs.existsSync(dataDir), false);

      // Reject outside directory, unregistered subdirectory, and symlink leaf
      assert.throws(() => resolveAllowedReviewTarget(repoRoot, outsideDir), /not the main repository or a registered git worktree/i);
      assert.throws(() => resolveAllowedReviewTarget(repoRoot, path.join(repoRoot, 'src')), /not the main repository or a registered git worktree/i);
      const symToWt = path.join(tmpDir, 'wt-symlink');
      fs.symlinkSync(wtPath, symToWt);
      assert.throws(() => resolveAllowedReviewTarget(repoRoot, symToWt), /symbolic link/i);

      // Legacy buildReviewPrompt signature remains 100% backward-compatible
      const legacyPrompt = buildReviewPrompt({
        repoName: 'legacy-app',
        branch: 'main',
        scope: 'working',
        annotations: [
          {
            id: 'a1',
            repoKey: 'repo_legacy',
            scope: 'working',
            filePath: 'src/service.ts',
            side: 'new',
            startLine: 2,
            endLine: 2,
            category: 'bug',
            comment: 'Check edge case for x=0.',
            resolved: false,
            createdAt: '2026-11-27T00:00:00.000Z',
            updatedAt: '2026-11-27T00:00:00.000Z',
          },
        ],
      });
      assert.match(legacyPrompt.markdown, /^# Code Review Feedback — legacy-app/);
      assert.doesNotMatch(legacyPrompt.markdown, /Stage 1: Spec Compliance Checklist/);

      // Register Review + Spec on MCP server
      const server = new McpServer(
        { name: 'v09-review-test', version: '0.9.0' },
        { capabilities: { tools: {} } },
      );
      registerSpecModule(server, { dataDir, workspaceRoot: repoRoot, demoMode: false }, 'ui://agy-nov/app.html');
      registerReviewModule(server, { dataDir, workspaceRoot: repoRoot, demoMode: false }, 'ui://agy-nov/app.html');

      const [ct, st] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'v09-review-client', version: '0.9.0' });
      await server.connect(st);
      await client.connect(ct);

      try {
        // Before creating any Spec: get diff on worktree succeeds, specCompliance is null, dataDir stays clean
        const initialDiff = await client.callTool({
          name: 'app_review_get_diff',
          arguments: { worktreePath: wtPath, scope: 'working' },
        });
        assert.equal(initialDiff.isError, undefined);
        const initialSession = (initialDiff.structuredContent as { session: ReviewSession }).session;
        assert.equal(initialSession.branch, 'feat/review-target');
        assert.equal(initialSession.repoPath, wtPath);
        assert.equal(initialSession.totalFiles, 1);
        assert.equal(initialSession.files[0].path, 'src/service.ts');
        assert.equal(initialSession.specCompliance, null);
        assert.ok((initialSession.availableWorktrees?.length ?? 0) >= 2);
        assert.equal(fs.existsSync(dataDir), false);

        // Outside path via MCP must fail cleanly with isError=true
        const rejectedCall = await client.callTool({
          name: 'app_review_get_diff',
          arguments: { worktreePath: outsideDir },
        });
        assert.equal(rejectedCall.isError, true);

        // Now create an active Spec via spec_create_or_update, approve it, and advance task t1
        const specRes = await client.callTool({
          name: 'spec_create_or_update',
          arguments: {
            id: 'spec-double-compute',
            title: 'Double Compute Pipeline',
            goal: 'Multiply input by 2 safely and preserve unit tests.',
            tasks: [
              { id: 't1', title: 'Update compute() implementation', status: 'pending' },
              { id: 't2', title: 'Add negative input guard', status: 'pending' },
            ],
          },
        });
        assert.equal(specRes.isError, undefined);
        const approveRes = await client.callTool({
          name: 'spec_approve',
          arguments: { specId: 'spec-double-compute' },
        });
        assert.equal(approveRes.isError, undefined);
        const advanceT1 = await client.callTool({
          name: 'spec_update_task',
          arguments: { specId: 'spec-double-compute', taskId: 't1', status: 'done' },
        });
        assert.equal(advanceT1.isError, undefined);
        const advanceT2 = await client.callTool({
          name: 'spec_update_task',
          arguments: { specId: 'spec-double-compute', taskId: 't2', status: 'in_progress' },
        });
        assert.equal(advanceT2.isError, undefined);

        // Fetch worktree diff again -> specCompliance is hydrated read-only
        const diffWithSpec = await client.callTool({
          name: 'app_review_get_diff',
          arguments: { worktreePath: wtPath, scope: 'working' },
        });
        assert.equal(diffWithSpec.isError, undefined);
        const session = (diffWithSpec.structuredContent as { session: ReviewSession }).session;
        assert.ok(session.specCompliance);
        assert.equal(session.specCompliance.specId, 'spec-double-compute');
        assert.equal(session.specCompliance.totalTasks, 2);
        assert.equal(session.specCompliance.doneTasks, 1);
        assert.equal(session.specCompliance.items.length, 2);

        // Add inline annotation & build two-stage prompt
        await client.callTool({
          name: 'app_review_add_annotation',
          arguments: {
            repoKey: session.repoKey,
            scope: 'working',
            filePath: 'src/service.ts',
            startLine: 2,
            category: 'bug',
            comment: 'Guard against NaN and negative numbers per task t2.',
          },
        });

        const promptRes = await client.callTool({
          name: 'app_review_build_prompt',
          arguments: {
            worktreePath: wtPath,
            scope: 'working',
            stage1Checklist: [
              { id: 't1', title: 'Update compute() implementation', status: 'done', checked: true },
              { id: 't2', title: 'Add negative input guard', status: 'in_progress', checked: false },
            ],
          },
        });
        assert.equal(promptRes.isError, undefined);
        const built = promptRes.structuredContent as unknown as BuiltReviewPrompt;
        assert.equal(built.annotationCount, 1);
        assert.match(built.markdown, /## Stage 1: Spec Compliance Checklist/);
        assert.match(built.markdown, /- \[x\] `t1`: Update compute\(\) implementation/);
        assert.match(built.markdown, /- \[ \] `t2`: Add negative input guard/);
        assert.match(built.markdown, /## Stage 2: Code Quality Annotations \(`file:line`\)/);
        assert.match(built.markdown, /src\/service\.ts:L2/);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});

describe('v0.9.0 T9.1 — Verify targeted worktree checks & redacted PR delivery summary', () => {
  it('runs allowlisted commands inside a real worktree, rejects outside paths, and generates redacted PR evidence', async () => {
    await withTempDir('agy-nov-v09-verify-', async (tmpDir) => {
      const repoRoot = initTempGitRepo(path.join(tmpDir, 'repo'));
      const outsideDir = path.join(tmpDir, 'outside-dir');
      fs.mkdirSync(outsideDir, { recursive: true });
      const dataDir = path.join(tmpDir, 'data-clean');

      const wtRes = await createWorktree(repoRoot, { branch: 'feat/verify-wt' });
      const wtPath = wtRes.created.path;
      fs.writeFileSync(path.join(wtPath, 'worktree-marker.txt'), 'wt-feat-verify\n', 'utf8');

      // Direct validation checks
      const mainRes = resolveAllowedVerifyTargetRoot(repoRoot);
      assert.equal(mainRes.targetRoot, repoRoot);
      assert.equal(mainRes.isWorktree, false);
      assert.equal(mainRes.branch, 'main');

      const wtResolved = resolveAllowedVerifyTargetRoot(repoRoot, wtPath);
      assert.equal(wtResolved.targetRoot, wtPath);
      assert.equal(wtResolved.isWorktree, true);
      assert.equal(wtResolved.branch, 'feat/verify-wt');

      assert.throws(() => resolveAllowedVerifyTargetRoot(repoRoot, outsideDir), /not the workspace root or a registered git worktree/i);
      assert.throws(() => resolveAllowedVerifyTargetRoot(repoRoot, path.join(repoRoot, 'src')), /not the workspace root or a registered git worktree/i);
      const escapeSym = path.join(tmpDir, 'verify-sym');
      fs.symlinkSync(wtPath, escapeSym);
      assert.throws(() => resolveAllowedVerifyTargetRoot(repoRoot, escapeSym), /symbolic link/i);

      // Direct buildPrDeliverySummary redaction check (using runtime-composed synthetic secret strings)
      const dynApiKey = ['sk', 'proj', 'SyntheticUnitVerifyKey9876543210'].join('-');
      const dynBearer = ['Bearer ', 'synthetic_bearer_', '1234567890abcdef'].join('');
      const dynPem = [
        ['-----BEG', 'IN PRIVATE KEY-----'].join(''),
        'MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgw',
        ['-----E', 'ND PRIVATE KEY-----'].join(''),
      ].join('\n');

      const syntheticState = createDefaultVerifyState();
      syntheticState.evidence.unshift({
        id: 'ver-redact-test',
        conversationId: 'conv-1',
        trigger: 'manual',
        outcome: 'pass',
        passed: true,
        timestamp: '2026-11-27T10:00:00.000Z',
        durationMs: 120,
        dirtyFiles: ['src/service.ts'],
        emptyFiles: [],
        targetBranch: 'feat/verify-wt',
        targetWorktree: wtPath,
        summary: `Verified cleanly (key=${dynApiKey})`,
        results: [
          {
            commandId: 'check-script',
            label: 'Worktree Check',
            executable: 'node',
            args: ['check.mjs'],
            passed: true,
            exitCode: 0,
            timedOut: false,
            durationMs: 120,
            outputTail: `ok auth=${dynBearer}\n${dynPem}`,
            outputTruncated: false,
          },
        ],
      });

      const directPr = buildPrDeliverySummary(syntheticState, {
        workspaceRoot: repoRoot,
        worktreePath: wtPath,
        specSummary: {
          specId: 'spec-1',
          title: 'PR Evidence Spec',
          status: 'approved',
          totalTasks: 1,
          doneTasks: 1,
          tasks: [{ id: 't1', title: 'Complete check', status: 'done' }],
        },
      });
      assert.equal(directPr.passed, true);
      assert.equal(directPr.branch, 'feat/verify-wt');
      assert.match(directPr.markdown, /## PR Delivery Verification Evidence/);
      assert.match(directPr.markdown, /`feat\/verify-wt`/);
      assert.match(directPr.markdown, /`spec-1`/);
      assert.equal(directPr.markdown.includes(dynApiKey), false);
      assert.equal(directPr.markdown.includes('synthetic_bearer_'), false);
      assert.equal(directPr.markdown.includes('MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgw'), false);

      // MCP flow: zero-write PR summary when dataDir absent -> configure -> run inside worktree -> reject outside
      const server = new McpServer(
        { name: 'v09-verify-test', version: '0.9.0' },
        { capabilities: { tools: {} } },
      );
      const reg = registerVerifyModule(
        server,
        { dataDir, workspaceRoot: repoRoot, demoMode: false },
        'ui://agy-nov/app.html',
      );
      assert.ok(reg.exemptReadOnlyAppTools?.includes('app_verify_pr_summary'));

      const [ct, st] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'v09-verify-client', version: '0.9.0' });
      await server.connect(st);
      await client.connect(ct);

      try {
        // Read-only PR summary before any state exists -> zero disk writes
        const emptySummary = await client.callTool({
          name: 'app_verify_pr_summary',
          arguments: { worktreePath: wtPath },
        });
        assert.equal(emptySummary.isError, undefined);
        assert.equal(fs.existsSync(dataDir), false);

        // Outside path rejected on both verify_run_checks and app_verify_pr_summary
        const badRun = await client.callTool({
          name: 'verify_run_checks',
          arguments: { worktreePath: outsideDir },
        });
        assert.equal(badRun.isError, true);
        const badSummary = await client.callTool({
          name: 'app_verify_pr_summary',
          arguments: { worktreePath: outsideDir },
        });
        assert.equal(badSummary.isError, true);
        assert.equal(fs.existsSync(dataDir), false);

        // Configure allowlisted command `node check.mjs`
        const policyRes = await client.callTool({
          name: 'verify_set_policy',
          arguments: {
            commands: [
              {
                id: 'wt-check',
                label: 'Worktree Marker Check',
                executable: 'node',
                args: ['check.mjs'],
                enabled: true,
              },
            ],
          },
        });
        assert.equal(policyRes.isError, undefined);

        // Run inside the real worktree -> must read worktree-marker.txt from worktree cwd
        const runRes = await client.callTool({
          name: 'verify_run_checks',
          arguments: { worktreePath: wtPath },
        });
        assert.equal(runRes.isError, undefined);
        const runRecord = (runRes.structuredContent as { run: VerifyEvidenceRecord }).run;
        assert.equal(runRecord.passed, true);
        assert.equal(runRecord.targetBranch, 'feat/verify-wt');
        assert.equal(runRecord.targetWorktree, wtPath);
        assert.match(runRecord.results[0].outputTail, /verify-cwd-marker=wt-feat-verify/);

        // Generate PR delivery evidence via app_verify_pr_summary
        const prCall = await client.callTool({
          name: 'app_verify_pr_summary',
          arguments: { worktreePath: wtPath },
        });
        assert.equal(prCall.isError, undefined);
        const prData = prCall.structuredContent as unknown as PrDeliverySummaryResult;
        assert.equal(prData.passed, true);
        assert.equal(prData.checksTotal, 1);
        assert.equal(prData.checksPassed, 1);
        assert.match(prData.markdown, /Worktree Marker Check/);
        assert.match(prData.markdown, /feat\/verify-wt/);

        // Red-team regression: redact <private> blocks (including nested/unclosed) and lowercase PEM private keys
        const lowerPemBegin = ['-----begin', 'rsa private key-----'].join(' ');
        const lowerPemEnd = ['-----end', 'rsa private key-----'].join(' ');
        const redactedSummary = buildPrDeliverySummary(
          {
            schemaVersion: 1,
            policy: {
              enforceOnStop: true,
              autoRunOnStop: false,
              blockEmptyWrites: true,
              maxConsecutiveBlocks: 3,
              commands: [],
            },
            sessions: {},
            evidence: [
              {
                ...runRecord,
                summary: 'ok <private>INNER_SUMMARY_SECRET</private>',
                results: [
                  {
                    ...runRecord.results[0],
                    outputTail: `ok\n${lowerPemBegin}\nLOWERCASE_PEM_SECRET_BODY\n${lowerPemEnd}\n<private>NESTED_PRIVATE_LEAK`,
                  },
                ],
              },
            ],
            blockedStops: 0,
            updatedAt: new Date().toISOString(),
          },
          {
            specSummary: {
              specId: 'spec-red',
              title: 'Safe <private>SPEC_TITLE_SECRET</private>',
              status: 'approved',
              totalTasks: 1,
              doneTasks: 1,
              tasks: [{ id: 't1', title: 'Task <private>TASK_SECRET</private>', status: 'done' }],
            },
          },
        );
        for (const leaked of [
          'INNER_SUMMARY_SECRET',
          'LOWERCASE_PEM_SECRET_BODY',
          'NESTED_PRIVATE_LEAK',
          'SPEC_TITLE_SECRET',
          'TASK_SECRET',
        ]) {
          assert.equal(redactedSummary.markdown.includes(leaked), false, `PR summary leaked ${leaked}`);
        }
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});

describe('v0.9.0 T9.1 — Full 5-step pipeline chain, tool budget +0, and demo zero-write', () => {
  it('completes Spec -> Worktree -> Two-Stage Review -> Verify -> Mem end-to-end with zero model-tool bloat', async () => {
    await withTempDir('agy-nov-v09-e2e-', async (tmpDir) => {
      const repoRoot = initTempGitRepo(path.join(tmpDir, 'repo'));
      const dataDir = path.join(tmpDir, 'nov-data');

      // Seed .worktreeinclude with 1 safe config and 1 blocked dotenv file
      fs.writeFileSync(path.join(repoRoot, '.env.example'), 'APP_ENV=test\n', 'utf8');
      fs.writeFileSync(path.join(repoRoot, '.env.local'), 'APP_ENV=secret\n', 'utf8');
      fs.writeFileSync(
        path.join(repoRoot, WORKTREE_INCLUDE_FILE),
        '.env.example\n.env.local\n',
        'utf8',
      );

      const server = new McpServer(
        { name: 'v09-pipeline-e2e', version: '0.9.0' },
        { capabilities: { tools: {} } },
      );
      const opts = { dataDir, workspaceRoot: repoRoot, demoMode: false };
      const uiUri = 'ui://agy-nov/app.html';

      const specReg = registerSpecModule(server, opts, uiUri);
      const worktreeReg = registerWorktreeModule(server, opts, uiUri);
      const reviewReg = registerReviewModule(server, opts, uiUri);
      const verifyReg = registerVerifyModule(server, opts, uiUri);
      const radarReg = registerRadarModule(server, opts, uiUri);
      const memReg = registerMemModule(server, opts, uiUri);

      // Verify model tool counts remain strictly +0 vs MODULE_CATALOG
      assert.equal(worktreeReg.modelTools.length, 4);
      assert.equal(reviewReg.modelTools.length, 2);
      assert.equal(verifyReg.modelTools.length, 4);
      assert.equal(radarReg.modelTools.length, 2);
      assert.deepEqual(
        worktreeReg.modelTools.map((t) => t.name),
        MODULE_CATALOG.worktree.modelToolNames,
      );
      assert.deepEqual(
        reviewReg.modelTools.map((t) => t.name),
        MODULE_CATALOG.review.modelToolNames,
      );
      assert.deepEqual(
        verifyReg.modelTools.map((t) => t.name),
        MODULE_CATALOG.verify.modelToolNames,
      );
      assert.deepEqual(
        radarReg.modelTools.map((t) => t.name),
        MODULE_CATALOG.radar.modelToolNames,
      );
      assert.equal(specReg.modelTools.length, MODULE_CATALOG.spec.modelToolNames.length);
      assert.equal(memReg.modelTools.length, MODULE_CATALOG.mem.modelToolNames.length);
      assert.ok(worktreeReg.exemptReadOnlyAppTools?.includes('app_worktree_preview_include'));
      assert.ok(verifyReg.exemptReadOnlyAppTools?.includes('app_verify_pr_summary'));

      const [ct, st] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'v09-e2e-client', version: '0.9.0' });
      await server.connect(st);
      await client.connect(ct);

      try {
        // Step 1: Spec — create draft spec, approve to unlock writes, and advance t1
        const specCreate = await client.callTool({
          name: 'spec_create_or_update',
          arguments: {
            id: 'spec-pipeline-v09',
            title: 'Engineering Pipeline Hardening',
            goal: 'Execute full Spec -> Worktree -> Two-Stage Review -> Verify -> Mem loop.',
            tasks: [
              { id: 't1', title: 'Isolate changes in dedicated Git worktree', status: 'pending' },
              { id: 't2', title: 'Implement compute multiplication update', status: 'pending' },
            ],
          },
        });
        assert.equal(specCreate.isError, undefined);

        const specApprove = await client.callTool({
          name: 'spec_approve',
          arguments: { specId: 'spec-pipeline-v09' },
        });
        assert.equal(specApprove.isError, undefined);

        await client.callTool({
          name: 'spec_update_task',
          arguments: { specId: 'spec-pipeline-v09', taskId: 't1', status: 'done' },
        });
        await client.callTool({
          name: 'spec_update_task',
          arguments: { specId: 'spec-pipeline-v09', taskId: 't2', status: 'in_progress' },
        });

        // Step 2: Worktree — preview .worktreeinclude and create isolated worktree
        const previewCall = await client.callTool({
          name: 'app_worktree_preview_include',
          arguments: {},
        });
        assert.equal(previewCall.isError, undefined);
        const preview = previewCall.structuredContent as unknown as WorktreeIncludePreviewResult;
        assert.deepEqual(
          preview.eligibleFiles.map((f) => f.path),
          ['.env.example'],
        );
        assert.deepEqual(
          preview.skippedSensitive.map((s) => s.entry),
          ['.env.local'],
        );

        const createWtCall = await client.callTool({
          name: 'worktree_create',
          arguments: { branch: 'feat/pipeline-loop', applyInclude: true },
        });
        assert.equal(createWtCall.isError, undefined);
        const createdWt = createWtCall.structuredContent as unknown as CreateWorktreeResult;
        const wtPath = createdWt.created.path;
        assert.deepEqual(createdWt.includedFiles, ['.env.example']);
        assert.deepEqual(createdWt.skippedSensitive, ['.env.local']);
        assert.equal(fs.existsSync(path.join(wtPath, '.env.example')), true);
        assert.equal(fs.existsSync(path.join(wtPath, '.env.local')), false);

        // Edit code inside the isolated worktree (main repo stays clean)
        fs.writeFileSync(
          path.join(wtPath, 'src', 'service.ts'),
          'export function compute(x: number): number {\n  return x * 3;\n}\n',
          'utf8',
        );
        fs.writeFileSync(path.join(wtPath, 'worktree-marker.txt'), 'pipeline-wt-ok\n', 'utf8');

        // Step 3: Two-Stage Review — inspect worktree diff + Spec compliance + build two-stage prompt
        const reviewDiffCall = await client.callTool({
          name: 'app_review_get_diff',
          arguments: { worktreePath: wtPath, scope: 'working' },
        });
        assert.equal(reviewDiffCall.isError, undefined);
        const reviewSession = (reviewDiffCall.structuredContent as { session: ReviewSession }).session;
        assert.equal(reviewSession.branch, 'feat/pipeline-loop');
        assert.equal(reviewSession.specCompliance?.specId, 'spec-pipeline-v09');
        assert.ok(reviewSession.files.some((f) => f.path === 'src/service.ts'));

        await client.callTool({
          name: 'app_review_add_annotation',
          arguments: {
            repoKey: reviewSession.repoKey,
            scope: 'working',
            filePath: 'src/service.ts',
            startLine: 2,
            category: 'refactor',
            comment: 'Document factor=3 constant clearly.',
          },
        });

        const reviewPromptCall = await client.callTool({
          name: 'app_review_build_prompt',
          arguments: { worktreePath: wtPath, scope: 'working' },
        });
        assert.equal(reviewPromptCall.isError, undefined);
        const twoStagePrompt = reviewPromptCall.structuredContent as unknown as BuiltReviewPrompt;
        assert.match(twoStagePrompt.markdown, /Stage 1: Spec Compliance Checklist/);
        assert.match(twoStagePrompt.markdown, /spec-pipeline-v09/);
        assert.match(twoStagePrompt.markdown, /Stage 2: Code Quality Annotations/);
        assert.match(twoStagePrompt.markdown, /src\/service\.ts:L2/);

        // Complete task t2 before Verify
        await client.callTool({
          name: 'spec_update_task',
          arguments: { specId: 'spec-pipeline-v09', taskId: 't2', status: 'done' },
        });

        // Step 4: Verify — run allowlisted check inside worktree and generate PR delivery summary
        await client.callTool({
          name: 'verify_set_policy',
          arguments: {
            commands: [
              {
                id: 'node-check',
                label: 'Pipeline Check',
                executable: 'node',
                args: ['check.mjs'],
                enabled: true,
              },
            ],
          },
        });
        const verifyRunCall = await client.callTool({
          name: 'app_verify_run_checks',
          arguments: { worktreePath: wtPath },
        });
        assert.equal(verifyRunCall.isError, undefined);
        const verifyRun = (verifyRunCall.structuredContent as { run: VerifyEvidenceRecord }).run;
        assert.equal(verifyRun.passed, true);
        assert.equal(verifyRun.targetBranch, 'feat/pipeline-loop');
        assert.match(verifyRun.results[0].outputTail, /pipeline-wt-ok/);

        const prSummaryCall = await client.callTool({
          name: 'app_verify_pr_summary',
          arguments: { worktreePath: wtPath },
        });
        assert.equal(prSummaryCall.isError, undefined);
        const prSummary = prSummaryCall.structuredContent as unknown as PrDeliverySummaryResult;
        assert.equal(prSummary.passed, true);
        assert.equal(prSummary.specId, 'spec-pipeline-v09');
        assert.match(prSummary.markdown, /2\/2 tasks done/);
        assert.match(prSummary.markdown, /Pipeline Check/);

        // Step 5: Mem — archive pipeline verification decision anchored to code file and recall it
        const memSave = await client.callTool({
          name: 'mem_remember',
          arguments: {
            kind: 'decision',
            title: 'Pipeline compute factor verified',
            content: 'Completed spec-pipeline-v09 in feat/pipeline-loop with passing verify evidence.',
            tags: ['pipeline', 'verify'],
            anchors: [{ filePath: 'src/service.ts', symbol: 'compute' }],
          },
        });
        assert.equal(memSave.isError, undefined);

        const memRecall = await client.callTool({
          name: 'mem_recall',
          arguments: { query: 'spec-pipeline-v09' },
        });
        assert.equal(memRecall.isError, undefined);
        const recallText = (memRecall.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
        assert.match(recallText, /Pipeline compute factor verified/);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });

  it('keeps demo mode 100% zero-write across Worktree, Review, and Verify new v0.9.0 tools', async () => {
    await withTempDir('agy-nov-v09-demo-zerowrite-', async (tmpDir) => {
      const absentDataDir = path.join(tmpDir, 'must-not-be-created-data');
      const absentWorkspace = path.join(tmpDir, 'must-not-be-created-ws');

      const server = new McpServer(
        { name: 'v09-demo-test', version: '0.9.0' },
        { capabilities: { tools: {} } },
      );
      const opts = { dataDir: absentDataDir, workspaceRoot: absentWorkspace, demoMode: true };
      const uiUri = 'ui://agy-nov/app.html';

      registerWorktreeModule(server, opts, uiUri);
      registerReviewModule(server, opts, uiUri);
      registerVerifyModule(server, opts, uiUri);

      const [ct, st] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'v09-demo-client', version: '0.9.0' });
      await server.connect(st);
      await client.connect(ct);

      try {
        // Worktree demo preview & create
        const wtPrev = await client.callTool({
          name: 'app_worktree_preview_include',
          arguments: {},
        });
        assert.equal(wtPrev.isError, undefined);
        const prevData = wtPrev.structuredContent as unknown as WorktreeIncludePreviewResult;
        assert.equal(prevData.mode, 'demo');
        assert.ok(prevData.eligibleFiles.length > 0);
        assert.ok(prevData.skippedSensitive.length > 0);

        const wtCreate = await client.callTool({
          name: 'app_worktree_create',
          arguments: { branch: 'feat/demo-pipeline', applyInclude: true },
        });
        assert.equal(wtCreate.isError, undefined);

        // Review demo diff + two-stage prompt
        const rvDiff = await client.callTool({
          name: 'app_review_get_diff',
          arguments: { demo: true },
        });
        assert.equal(rvDiff.isError, undefined);
        const rvSession = (rvDiff.structuredContent as { session: ReviewSession }).session;
        assert.ok((rvSession.availableWorktrees?.length ?? 0) >= 2);
        assert.ok(rvSession.specCompliance);

        const rvPrompt = await client.callTool({
          name: 'app_review_build_prompt',
          arguments: { demo: true },
        });
        assert.equal(rvPrompt.isError, undefined);
        const rvBuilt = rvPrompt.structuredContent as unknown as BuiltReviewPrompt;
        assert.match(rvBuilt.markdown, /Stage 1: Spec Compliance Checklist/);
        assert.match(rvBuilt.markdown, /Stage 2: Code Quality Annotations/);

        // Verify demo worktree run + PR summary
        const demoWtPath = path.join(absentWorkspace, '.agy-worktrees', 'feat-verify-gate');
        const vfRun = await client.callTool({
          name: 'app_verify_run_checks',
          arguments: { worktreePath: demoWtPath },
        });
        assert.equal(vfRun.isError, undefined);

        const vfPr = await client.callTool({
          name: 'app_verify_pr_summary',
          arguments: { worktreePath: demoWtPath },
        });
        assert.equal(vfPr.isError, undefined);
        const vfPrData = vfPr.structuredContent as unknown as PrDeliverySummaryResult;
        assert.equal(vfPrData.mode, 'demo');
        assert.match(vfPrData.markdown, /## PR Delivery Verification Evidence/);

        // Strict zero disk writes
        assert.equal(fs.existsSync(absentDataDir), false);
        assert.equal(fs.existsSync(absentWorkspace), false);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});
