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
import {
  cleanupWorktree,
  createWorktree,
  getWorktreeDiffSummary,
  inspectWorktrees,
  validateGitRef,
  validateWorktreeDirName,
  WORKTREE_MANAGED_DIR,
  type CleanupWorktreeResult,
  type CreateWorktreeResult,
  type WorktreeDiffSummaryResult,
  type WorktreeInspectResult,
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
  gitSync(repoDir, ['config', 'user.name', 'agy-NOV Test']);
  gitSync(repoDir, ['config', 'user.email', 'test@agy-nov.local']);
  gitSync(repoDir, ['config', 'commit.gpgsign', 'false']);

  fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# Test Repo\n', 'utf8');
  fs.writeFileSync(
    path.join(repoDir, 'src', 'app.ts'),
    'export const version = "1.0.0";\nexport function greet() {\n  return "hello";\n}\n',
    'utf8',
  );
  gitSync(repoDir, ['add', '.']);
  gitSync(repoDir, ['commit', '-m', 'chore: initial commit']);

  return fs.realpathSync(repoDir);
}

describe('v0.3.0 Worktree Orchestrator module', () => {
  it('1. gracefully handles a non-Git directory with isGitRepo=false and zero errors', async () => {
    await withTempDir('agy-nov-wt-nongit-', async (tmpDir) => {
      const state = await inspectWorktrees(tmpDir);
      assert.equal(state.mode, 'live');
      assert.equal(state.isGitRepo, false);
      assert.equal(state.repoRoot, tmpDir);
      assert.equal(state.worktreeConfigWarning, false);
      assert.deepEqual(state.worktrees, []);
      assert.deepEqual(state.counts, { total: 0, dirty: 0, merged: 0, prunable: 0 });
      assert.equal(fs.existsSync(path.join(tmpDir, WORKTREE_MANAGED_DIR)), false);

      // Also verify via MCP tool
      const server = new McpServer(
        { name: 'wt-nongit-test', version: '0.3.0' },
        { capabilities: { tools: { listChanged: true } } },
      );
      const dataDir = path.join(tmpDir, 'absent-data');
      registerWorktreeModule(
        server,
        { dataDir, workspaceRoot: tmpDir, demoMode: false },
        'ui://agy-nov/app.html',
      );

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'wt-nongit-client', version: '0.3.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        const res = await client.callTool({ name: 'worktree_list', arguments: {} });
        assert.equal(res.isError, undefined);
        const data = res.structuredContent as unknown as WorktreeInspectResult;
        assert.equal(data.isGitRepo, false);
        assert.deepEqual(data.worktrees, []);
        assert.equal(fs.existsSync(dataDir), false);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });

  it('2. creates worktrees, carries uncommitted changes cleanly, tracks dirty/ahead/merged, and detects extensions.worktreeConfig', async () => {
    await withTempDir('agy-nov-wt-live-', async (tmpDir) => {
      const repoRoot = initTempGitRepo(path.join(tmpDir, 'repo'));

      // Initial state: single clean main worktree, no worktreeConfig warning
      const initial = await inspectWorktrees(repoRoot);
      assert.equal(initial.mode, 'live');
      assert.equal(initial.isGitRepo, true);
      assert.equal(initial.repoRoot, repoRoot);
      assert.equal(initial.currentBranch, 'main');
      assert.equal(initial.worktreeConfigWarning, false);
      assert.equal(initial.worktrees.length, 1);
      assert.equal(initial.worktrees[0].isMain, true);
      assert.equal(initial.worktrees[0].branch, 'main');
      assert.equal(initial.worktrees[0].head.length, 7);
      assert.equal(initial.worktrees[0].isDirty, false);
      assert.deepEqual(initial.counts, { total: 1, dirty: 0, merged: 0, prunable: 0 });

      // Modify a tracked file in main worktree without committing
      const mainAppPath = path.join(repoRoot, 'src', 'app.ts');
      const dirtyContent =
        'export const version = "1.1.0-wip";\nexport function greet() {\n  return "hello carried";\n}\n';
      fs.writeFileSync(mainAppPath, dirtyContent, 'utf8');

      // Create new worktree with carryUncommitted: true
      const createdRes = await createWorktree(repoRoot, {
        branch: 'feat/parallel-task',
        carryUncommitted: true,
      });

      assert.equal(createdRes.carriedUncommitted, true);
      assert.equal(createdRes.warning, undefined);
      assert.match(
        fs.readFileSync(path.join(repoRoot, '.git', 'info', 'exclude'), 'utf8'),
        /\/\.agy-worktrees\//,
      );
      assert.equal(
        createdRes.created.path,
        path.join(repoRoot, WORKTREE_MANAGED_DIR, 'feat-parallel-task'),
      );
      assert.equal(createdRes.created.branch, 'feat/parallel-task');
      assert.equal(createdRes.created.isMain, false);
      assert.equal(createdRes.created.isDirty, true);
      assert.equal(createdRes.created.changedFilesCount, 1);

      // Verify carried file content in new worktree and that main worktree stays intact
      assert.equal(
        fs.readFileSync(path.join(createdRes.created.path, 'src', 'app.ts'), 'utf8'),
        dirtyContent,
      );
      assert.equal(fs.readFileSync(mainAppPath, 'utf8'), dirtyContent);

      // Commit the carried change inside the new worktree -> ahead=1, isDirty=false, isMerged=false
      gitSync(createdRes.created.path, ['add', 'src/app.ts']);
      gitSync(createdRes.created.path, ['commit', '-m', 'feat: update greeting in parallel worktree']);

      // Restore main worktree back to clean state
      gitSync(repoRoot, ['checkout', '--', 'src/app.ts']);

      // Also test checking out an existing local branch (not checked out anywhere)
      gitSync(repoRoot, ['branch', 'fix/already-exists']);
      const existingBranchRes = await createWorktree(repoRoot, {
        branch: 'fix/already-exists',
        dirName: 'custom-fix-dir',
      });
      assert.equal(existingBranchRes.created.branch, 'fix/already-exists');
      assert.equal(
        existingBranchRes.created.path,
        path.join(repoRoot, WORKTREE_MANAGED_DIR, 'custom-fix-dir'),
      );
      assert.equal(existingBranchRes.created.isMerged, true);

      // Inspect full list: ahead/behind, merged, dirty
      const listed = await inspectWorktrees(repoRoot);
      assert.equal(listed.counts.total, 3);
      assert.equal(listed.counts.dirty, 0);
      assert.equal(listed.counts.merged, 1);

      const featWt = listed.worktrees.find((w) => w.branch === 'feat/parallel-task');
      assert.ok(featWt);
      assert.equal(featWt.ahead, 1);
      assert.equal(featWt.behind, 0);
      assert.equal(featWt.isDirty, false);
      assert.equal(featWt.isMerged, false);

      // Trigger carryUncommitted 3-way conflict gracefully:
      // must return carriedUncommitted=false + warning, roll back UU index & conflict markers + partial new files,
      // leave new worktree 100% clean (isDirty=false), and allow non-forced cleanupWorktree removal.
      const firstCommitSha = gitSync(repoRoot, ['rev-parse', 'HEAD']).trim();
      const firstCommitAppContent = fs.readFileSync(mainAppPath, 'utf8');
      fs.writeFileSync(mainAppPath, 'export const version = "2.0.0";\n', 'utf8');
      gitSync(repoRoot, ['add', 'src/app.ts']);
      gitSync(repoRoot, ['commit', '-m', 'chore: bump version to 2.0.0']);
      // Now make an uncommitted change based on 2.0.0 that conflicts with initial 1.0.0,
      // plus a staged new file to verify git clean -fd cleans any partially applied file as well.
      const conflictingMainContent = 'export const version = "2.1.0-conflict";\n';
      fs.writeFileSync(mainAppPath, conflictingMainContent, 'utf8');
      const stagedExtraPath = path.join(repoRoot, 'src', 'partial-extra.ts');
      fs.writeFileSync(stagedExtraPath, 'export const extra = 1;\n', 'utf8');
      gitSync(repoRoot, ['add', 'src/partial-extra.ts']);

      const conflictRes = await createWorktree(repoRoot, {
        branch: 'feat/conflict-carry',
        baseRef: firstCommitSha,
        carryUncommitted: true,
      });
      assert.equal(conflictRes.carriedUncommitted, false);
      assert.ok(conflictRes.warning && /with conflicts/i.test(conflictRes.warning));
      assert.equal(fs.existsSync(conflictRes.created.path), true);
      assert.equal(conflictRes.created.isDirty, false);
      assert.equal(conflictRes.created.changedFilesCount, 0);
      assert.equal(
        conflictRes.state.worktrees.find((w) => w.path === conflictRes.created.path)?.isDirty,
        false,
      );

      // Verify zero UU index entries, zero untracked leftovers, and zero conflict markers
      assert.equal(gitSync(conflictRes.created.path, ['status', '--porcelain']).trim(), '');
      const rolledBackAppContent = fs.readFileSync(
        path.join(conflictRes.created.path, 'src', 'app.ts'),
        'utf8',
      );
      assert.equal(rolledBackAppContent, firstCommitAppContent);
      assert.doesNotMatch(rolledBackAppContent, /<<<<<<<|=======|>>>>>>>/);
      assert.equal(
        fs.existsSync(path.join(conflictRes.created.path, 'src', 'partial-extra.ts')),
        false,
      );
      // Main worktree uncommitted edit stays intact
      assert.equal(fs.readFileSync(mainAppPath, 'utf8'), conflictingMainContent);

      // Subsequent non-forced cleanupWorktree must cleanly remove the rolled-back worktree
      const cleanedConflict = await cleanupWorktree(repoRoot, {
        worktreePath: conflictRes.created.path,
      });
      assert.equal(cleanedConflict.removedPath, conflictRes.created.path);
      assert.equal(cleanedConflict.pruned, true);
      assert.equal(fs.existsSync(conflictRes.created.path), false);
      assert.equal(
        cleanedConflict.state.worktrees.some((w) => w.path === conflictRes.created.path),
        false,
      );

      // Restore main worktree clean and enable extensions.worktreeConfig=true -> warning flagged
      gitSync(repoRoot, ['reset', '--', 'src/partial-extra.ts']);
      fs.rmSync(stagedExtraPath, { force: true });
      gitSync(repoRoot, ['checkout', '--', 'src/app.ts']);
      gitSync(repoRoot, ['config', 'core.repositoryformatversion', '1']);
      gitSync(repoRoot, ['config', 'extensions.worktreeConfig', 'true']);

      const warnedState = await inspectWorktrees(repoRoot);
      assert.equal(warnedState.worktreeConfigWarning, true);
    });
  });

  it('3. computes accurate worktree_diff_summary and rejects non-whitelisted paths', async () => {
    await withTempDir('agy-nov-wt-diff-', async (tmpDir) => {
      const repoRoot = initTempGitRepo(path.join(tmpDir, 'repo'));
      const outsideDir = path.join(tmpDir, 'outside-dir');
      fs.mkdirSync(outsideDir, { recursive: true });

      const { created } = await createWorktree(repoRoot, { branch: 'feat/diff-check' });

      // Add a committed file and an uncommitted modification + untracked file inside the worktree
      fs.writeFileSync(path.join(created.path, 'src', 'feature.ts'), 'export const feat = 1;\n', 'utf8');
      gitSync(created.path, ['add', 'src/feature.ts']);
      gitSync(created.path, ['commit', '-m', 'feat: add feature.ts']);

      fs.writeFileSync(
        path.join(created.path, 'README.md'),
        '# Test Repo\nUpdated in worktree\n',
        'utf8',
      );
      fs.writeFileSync(path.join(created.path, 'notes.txt'), 'untracked note\n', 'utf8');

      const summary = await getWorktreeDiffSummary(repoRoot, created.path);
      assert.equal(summary.worktreePath, created.path);
      assert.equal(summary.branch, 'feat/diff-check');
      assert.equal(summary.baseRef, 'main');
      assert.equal(summary.ahead, 1);
      assert.equal(summary.behind, 0);

      const filePaths = summary.files.map((f) => f.path);
      assert.ok(filePaths.includes('src/feature.ts'), 'should include committed file');
      assert.ok(filePaths.includes('README.md'), 'should include modified tracked file');
      assert.ok(filePaths.includes('notes.txt'), 'should include untracked file');
      assert.match(summary.statText, /src\/feature\.ts/);
      assert.match(summary.statText, /README\.md/);
      assert.match(summary.statText, /notes\.txt/);

      // Reject external directory, repository subdirectory, nonexistent path, and symlink outside whitelist
      await assert.rejects(
        () => getWorktreeDiffSummary(repoRoot, outsideDir),
        /not in the active git worktree list/i,
      );
      await assert.rejects(
        () => getWorktreeDiffSummary(repoRoot, path.join(repoRoot, 'src')),
        /not in the active git worktree list/i,
      );
      await assert.rejects(
        () => getWorktreeDiffSummary(repoRoot, path.join(tmpDir, 'does-not-exist')),
        /does not exist/i,
      );

      const badSymlink = path.join(tmpDir, 'link-to-outside');
      fs.symlinkSync(outsideDir, badSymlink);
      await assert.rejects(
        () => getWorktreeDiffSummary(repoRoot, badSymlink),
        /not in the active git worktree list/i,
      );

      // Reject flag-injected baseRef
      await assert.rejects(
        () => getWorktreeDiffSummary(repoRoot, created.path, '-evil'),
        /invalid git ref/i,
      );
    });
  });

  it('4. enforces security boundaries against ref injection, directory traversal, and symlink escape', async () => {
    await withTempDir('agy-nov-wt-sec-', async (tmpDir) => {
      const repoRoot = initTempGitRepo(path.join(tmpDir, 'repo'));

      // Invalid Git refs must all be rejected
      const maliciousRefs = [
        '-evil',
        '--orphan',
        'a..b',
        'feat//double',
        'feat/bad.lock',
        'feat/@{1}',
        'feat with space',
        'feat;rm -rf /',
        'feat\\backslash',
        'feat/',
        'feat/.hidden',
        '',
        'a'.repeat(121),
      ];
      for (const badRef of maliciousRefs) {
        assert.throws(() => validateGitRef(badRef), /invalid git ref/i, `Expected ref rejection: ${badRef}`);
        await assert.rejects(
          () => createWorktree(repoRoot, { branch: badRef }),
          /invalid git ref/i,
          `createWorktree should reject branch: ${badRef}`,
        );
      }

      // Invalid baseRef must also be rejected
      await assert.rejects(
        () => createWorktree(repoRoot, { branch: 'feat/safe', baseRef: '--exec=evil' }),
        /invalid git ref/i,
      );

      // Directory traversal dirName must be rejected
      const maliciousDirNames = [
        '../../outside',
        '../escape',
        '/tmp/absolute',
        'nested/path',
        'win\\path',
        '-leading-dash',
        '.hidden',
        '..',
        'has space',
        'semi;colon',
      ];
      for (const badDir of maliciousDirNames) {
        assert.throws(
          () => validateWorktreeDirName(badDir),
          /invalid worktree dirname/i,
          `Expected dirName rejection: ${badDir}`,
        );
        await assert.rejects(
          () => createWorktree(repoRoot, { branch: 'feat/safe', dirName: badDir }),
          /invalid worktree dirname/i,
          `createWorktree should reject dirName: ${badDir}`,
        );
      }

      // None of the rejected attempts should have created `.agy-worktrees`
      assert.equal(fs.existsSync(path.join(repoRoot, WORKTREE_MANAGED_DIR)), false);

      // Symlink escape on `.agy-worktrees` itself must be blocked
      const outsideEscape = path.join(tmpDir, 'outside-escape');
      fs.mkdirSync(outsideEscape, { recursive: true });
      fs.symlinkSync(outsideEscape, path.join(repoRoot, WORKTREE_MANAGED_DIR));

      await assert.rejects(
        () => createWorktree(repoRoot, { branch: 'feat/symlink-escape' }),
        /real directory|symlink|escapes/i,
      );
      assert.deepEqual(fs.readdirSync(outsideEscape), []);

      // Symlink escape on `.git/info/exclude` (existing target & dangling target) and `.git/info` must be skipped safely
      const repoExcludeFileSym = initTempGitRepo(path.join(tmpDir, 'repo-exclude-file-sym'));
      const outsideExcludeTarget = path.join(tmpDir, 'outside-exclude.txt');
      fs.writeFileSync(outsideExcludeTarget, '# keep untouched\n', 'utf8');
      const excludePath1 = path.join(repoExcludeFileSym, '.git', 'info', 'exclude');
      fs.rmSync(excludePath1, { force: true });
      fs.symlinkSync(outsideExcludeTarget, excludePath1);

      const res1 = await createWorktree(repoExcludeFileSym, { branch: 'feat/exclude-sym-existing' });
      assert.equal(fs.existsSync(res1.created.path), true);
      assert.equal(fs.readFileSync(outsideExcludeTarget, 'utf8'), '# keep untouched\n');

      // Dangling symlink on `.git/info/exclude` must not create external file
      const outsideDanglingTarget = path.join(tmpDir, 'outside-dangling-exclude.txt');
      fs.rmSync(excludePath1, { force: true });
      fs.symlinkSync(outsideDanglingTarget, excludePath1);

      const res2 = await createWorktree(repoExcludeFileSym, { branch: 'feat/exclude-sym-dangling' });
      assert.equal(fs.existsSync(res2.created.path), true);
      assert.equal(fs.existsSync(outsideDanglingTarget), false);

      // Symlink on `.git/info` directory itself must not write inside external directory
      const repoInfoDirSym = initTempGitRepo(path.join(tmpDir, 'repo-info-dir-sym'));
      const outsideInfoDir = path.join(tmpDir, 'outside-info-dir');
      fs.mkdirSync(outsideInfoDir, { recursive: true });
      const infoDirPath = path.join(repoInfoDirSym, '.git', 'info');
      fs.rmSync(infoDirPath, { recursive: true, force: true });
      fs.symlinkSync(outsideInfoDir, infoDirPath);

      const res3 = await createWorktree(repoInfoDirSym, { branch: 'feat/info-dir-sym' });
      assert.equal(fs.existsSync(res3.created.path), true);
      assert.deepEqual(fs.readdirSync(outsideInfoDir), []);
    });
  });

  it('5. protects main and dirty worktrees during cleanup, allows force/clean removal, and prunes orphans', async () => {
    await withTempDir('agy-nov-wt-cleanup-', async (tmpDir) => {
      const repoRoot = initTempGitRepo(path.join(tmpDir, 'repo'));
      const outsideDir = path.join(tmpDir, 'not-a-worktree');
      fs.mkdirSync(outsideDir, { recursive: true });

      const cleanWt = (await createWorktree(repoRoot, { branch: 'feat/clean-wt' })).created;
      const dirtyWt = (await createWorktree(repoRoot, { branch: 'feat/dirty-wt' })).created;
      const lockedWt = (await createWorktree(repoRoot, { branch: 'feat/locked-wt' })).created;
      const orphanWt = (await createWorktree(repoRoot, { branch: 'feat/orphan-wt' })).created;

      // Make dirtyWt dirty and lock lockedWt
      fs.writeFileSync(path.join(dirtyWt.path, 'src', 'app.ts'), 'export const dirty = true;\n', 'utf8');
      gitSync(repoRoot, ['worktree', 'lock', '--reason', 'pinned for review', lockedWt.path]);

      // 1) Never allow removing the main worktree, even with force=true
      await assert.rejects(
        () => cleanupWorktree(repoRoot, { worktreePath: repoRoot }),
        /cannot remove the main worktree/i,
      );
      await assert.rejects(
        () => cleanupWorktree(repoRoot, { worktreePath: repoRoot, force: true }),
        /cannot remove the main worktree/i,
      );

      // 2) Reject non-whitelisted path
      await assert.rejects(
        () => cleanupWorktree(repoRoot, { worktreePath: outsideDir, force: true }),
        /not in the active git worktree list/i,
      );

      // 3) Refuse removing locked worktree both without force and with force=true, with consistent unlock message
      for (const forceFlag of [false, true]) {
        await assert.rejects(
          () => cleanupWorktree(repoRoot, { worktreePath: lockedWt.path, force: forceFlag }),
          (err: unknown) => {
            assert.ok(err instanceof Error);
            assert.match(
              err.message,
              /Worktree is locked; unlock it with "git worktree unlock" before removing\./,
            );
            assert.doesNotMatch(err.message, /force:\s*true/i);
            return true;
          },
        );
      }
      assert.equal(fs.existsSync(lockedWt.path), true);

      // Unlocking allows normal non-forced cleanup
      gitSync(repoRoot, ['worktree', 'unlock', lockedWt.path]);
      const unlockedRes = await cleanupWorktree(repoRoot, { worktreePath: lockedWt.path });
      assert.equal(unlockedRes.removedPath, lockedWt.path);
      assert.equal(fs.existsSync(lockedWt.path), false);

      // 4) Refuse removing dirty worktree unless force=true
      await assert.rejects(
        () => cleanupWorktree(repoRoot, { worktreePath: dirtyWt.path }),
        /uncommitted change/i,
      );
      assert.equal(fs.existsSync(dirtyWt.path), true);

      // 5) Remove dirty worktree with force=true
      const forcedRes = await cleanupWorktree(repoRoot, {
        worktreePath: dirtyWt.path,
        force: true,
      });
      assert.equal(forcedRes.removedPath, dirtyWt.path);
      assert.equal(forcedRes.pruned, true);
      assert.equal(fs.existsSync(dirtyWt.path), false);
      assert.equal(
        forcedRes.state.worktrees.some((w) => w.path === dirtyWt.path),
        false,
      );

      // 6) Remove clean worktree without force
      const cleanRes = await cleanupWorktree(repoRoot, { worktreePath: cleanWt.path });
      assert.equal(cleanRes.removedPath, cleanWt.path);
      assert.equal(cleanRes.pruned, true);
      assert.equal(fs.existsSync(cleanWt.path), false);

      // 7) Manually delete orphanWt directory -> inspect sees prunable=true, pruneOnly cleans it up
      fs.rmSync(orphanWt.path, { recursive: true, force: true });
      const withOrphan = await inspectWorktrees(repoRoot);
      const orphanEntry = withOrphan.worktrees.find((w) => w.path === orphanWt.path);
      assert.ok(orphanEntry);
      assert.equal(orphanEntry.prunable, true);
      assert.equal(withOrphan.counts.prunable, 1);

      const pruneRes = await cleanupWorktree(repoRoot, { pruneOnly: true });
      assert.equal(pruneRes.pruned, true);
      assert.equal(pruneRes.removedPath, undefined);
      assert.equal(pruneRes.state.counts.prunable, 0);
      assert.equal(pruneRes.state.worktrees.length, 1);
      assert.equal(pruneRes.state.worktrees[0].isMain, true);
    });
  });

  it('6. runs demoMode completely in-memory with zero disk writes and aligns MCP registration with MODULE_CATALOG', async () => {
    await withTempDir('agy-nov-wt-demo-', async (tmpDir) => {
      // Deliberately point both dataDir and workspaceRoot to non-existent directories to prove zero disk I/O
      const dataDir = path.join(tmpDir, 'never-created-data');
      const fakeWorkspace = path.join(tmpDir, 'never-created-workspace');

      const server = new McpServer(
        { name: 'agy-nov-worktree-demo', version: '0.3.0' },
        { capabilities: { tools: { listChanged: true } } },
      );

      const reg = registerWorktreeModule(
        server,
        { dataDir, workspaceRoot: fakeWorkspace, demoMode: true },
        'ui://agy-nov/app.html',
      );

      assert.equal(reg.moduleId, 'worktree');
      assert.deepEqual(
        reg.modelTools.map((t) => t.name).sort(),
        [...MODULE_CATALOG.worktree.modelToolNames].sort(),
      );
      assert.deepEqual(reg.exemptReadOnlyAppTools, ['app_worktree_list']);

      // Registration must touch neither dataDir nor workspaceRoot
      assert.equal(fs.existsSync(dataDir), false);
      assert.equal(fs.existsSync(fakeWorkspace), false);

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'wt-demo-client', version: '0.3.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        // Verify all 4 model tools + 4 app-only tools are registered with proper metadata
        const listedTools = await client.listTools();
        const toolMap = new Map(listedTools.tools.map((t) => [t.name, t]));

        for (const name of MODULE_CATALOG.worktree.modelToolNames) {
          assert.ok(toolMap.has(name), `Missing model tool: ${name}`);
        }
        for (const appToolName of [
          'app_worktree_list',
          'app_worktree_create',
          'app_worktree_diff_summary',
          'app_worktree_cleanup',
        ]) {
          const tool = toolMap.get(appToolName);
          assert.ok(tool, `Missing app-only tool: ${appToolName}`);
          const meta = (tool as { _meta?: { ui?: { resourceUri?: string; visibility?: string[] } } })._meta;
          assert.equal(meta?.ui?.resourceUri, 'ui://agy-nov/app.html');
          assert.deepEqual(meta?.ui?.visibility, ['app']);
        }

        // Initial demo list: 3 synthetic entries (main, feat/verify-gate dirty, fix/cache-leak merged)
        const listRes = await client.callTool({ name: 'app_worktree_list', arguments: {} });
        assert.equal(listRes.isError, undefined);
        const state = listRes.structuredContent as unknown as WorktreeInspectResult;
        assert.equal(state.mode, 'demo');
        assert.equal(state.isGitRepo, true);
        assert.equal(state.worktrees.length, 3);
        assert.deepEqual(state.counts, { total: 3, dirty: 1, merged: 1, prunable: 0 });

        const mainWt = state.worktrees.find((w) => w.branch === 'main');
        const featWt = state.worktrees.find((w) => w.branch === 'feat/verify-gate');
        const fixWt = state.worktrees.find((w) => w.branch === 'fix/cache-leak');
        assert.ok(mainWt && mainWt.isMain);
        assert.ok(featWt && featWt.isDirty && featWt.changedFilesCount > 0);
        assert.ok(fixWt && fixWt.isMerged && !fixWt.isDirty);

        // Demo diff summary works on whitelisted demo worktree and rejects external path
        const diffRes = await client.callTool({
          name: 'app_worktree_diff_summary',
          arguments: { worktreePath: featWt.path },
        });
        assert.equal(diffRes.isError, undefined);
        const diffData = diffRes.structuredContent as unknown as WorktreeDiffSummaryResult;
        assert.equal(diffData.branch, 'feat/verify-gate');
        assert.ok(diffData.files.length >= 2);
        assert.ok(diffData.statText.length > 0);

        const badDiffRes = await client.callTool({
          name: 'worktree_diff_summary',
          arguments: { worktreePath: '/tmp/arbitrary-outside-path' },
        });
        assert.equal(badDiffRes.isError, true);

        // Demo create (in-memory only) + validation guards
        const badCreateRes = await client.callTool({
          name: 'worktree_create',
          arguments: { branch: '-evil' },
        });
        assert.equal(badCreateRes.isError, true);

        const createRes = await client.callTool({
          name: 'app_worktree_create',
          arguments: { branch: 'feat/demo-new', carryUncommitted: true },
        });
        assert.equal(createRes.isError, undefined);
        const createdData = createRes.structuredContent as unknown as CreateWorktreeResult;
        assert.equal(createdData.created.branch, 'feat/demo-new');
        assert.equal(createdData.carriedUncommitted, true);
        assert.equal(createdData.state.counts.total, 4);

        // Demo cleanup protects main & dirty worktrees, removes clean merged worktree
        const rmMain = await client.callTool({
          name: 'worktree_cleanup',
          arguments: { worktreePath: mainWt.path, force: true },
        });
        assert.equal(rmMain.isError, true);

        const rmDirtyNoForce = await client.callTool({
          name: 'worktree_cleanup',
          arguments: { worktreePath: featWt.path },
        });
        assert.equal(rmDirtyNoForce.isError, true);

        const rmClean = await client.callTool({
          name: 'app_worktree_cleanup',
          arguments: { worktreePath: fixWt.path },
        });
        assert.equal(rmClean.isError, undefined);
        const cleanData = rmClean.structuredContent as unknown as CleanupWorktreeResult;
        assert.equal(cleanData.removedPath, fixWt.path);
        assert.equal(cleanData.pruned, true);
        assert.equal(cleanData.state.counts.total, 3);

        // Dynamic disable / enable toggles all 4 model tools cleanly
        for (const h of reg.modelTools) h.disable();
        const afterDisable = await client.listTools();
        const disabledNames = new Set(afterDisable.tools.map((t) => t.name));
        for (const name of MODULE_CATALOG.worktree.modelToolNames) {
          assert.equal(disabledNames.has(name), false, `${name} should be disabled`);
        }

        for (const h of reg.modelTools) h.enable();
        const afterEnable = await client.listTools();
        const enabledNames = new Set(afterEnable.tools.map((t) => t.name));
        for (const name of MODULE_CATALOG.worktree.modelToolNames) {
          assert.equal(enabledNames.has(name), true, `${name} should be re-enabled`);
        }

        // Strict zero disk writes throughout all demo interactions
        assert.equal(fs.existsSync(dataDir), false);
        assert.equal(fs.existsSync(fakeWorkspace), false);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });

  it('7. end-to-end live MCP tool flow (create, list, diff summary, cleanup) with zero dataDir writes', async () => {
    await withTempDir('agy-nov-wt-mcp-live-', async (tmpDir) => {
      const repoRoot = initTempGitRepo(path.join(tmpDir, 'repo'));
      const dataDir = path.join(tmpDir, 'unused-data-dir');

      const server = new McpServer(
        { name: 'agy-nov-worktree-live', version: '0.3.0' },
        { capabilities: { tools: { listChanged: true } } },
      );
      registerWorktreeModule(
        server,
        { dataDir, workspaceRoot: repoRoot, demoMode: false },
        'ui://agy-nov/app.html',
      );

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'wt-live-client', version: '0.3.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        // Create via MCP model tool
        const created = await client.callTool({
          name: 'worktree_create',
          arguments: { branch: 'feat/mcp-live-flow', dirName: 'mcp-live-flow' },
        });
        assert.equal(created.isError, undefined);
        const createData = created.structuredContent as unknown as CreateWorktreeResult;
        assert.equal(createData.created.branch, 'feat/mcp-live-flow');

        // Make a change inside the newly created worktree
        fs.writeFileSync(
          path.join(createData.created.path, 'src', 'app.ts'),
          'export const version = "1.2.0";\n',
          'utf8',
        );

        // Diff summary via MCP model tool
        const diffRes = await client.callTool({
          name: 'worktree_diff_summary',
          arguments: { worktreePath: createData.created.path },
        });
        assert.equal(diffRes.isError, undefined);
        const diffData = diffRes.structuredContent as unknown as WorktreeDiffSummaryResult;
        assert.equal(diffData.branch, 'feat/mcp-live-flow');
        assert.ok(diffData.files.some((f) => f.path === 'src/app.ts'));

        // Refusing dirty cleanup without force returns isError=true cleanly
        const refusedCleanup = await client.callTool({
          name: 'worktree_cleanup',
          arguments: { worktreePath: createData.created.path },
        });
        assert.equal(refusedCleanup.isError, true);

        // Forced cleanup succeeds via app tool and leaves 1 main worktree
        const forcedCleanup = await client.callTool({
          name: 'app_worktree_cleanup',
          arguments: { worktreePath: createData.created.path, force: true },
        });
        assert.equal(forcedCleanup.isError, undefined);
        const cleanupData = forcedCleanup.structuredContent as unknown as CleanupWorktreeResult;
        assert.equal(cleanupData.removedPath, createData.created.path);
        assert.equal(cleanupData.pruned, true);
        assert.equal(cleanupData.state.counts.total, 1);

        // Worktree module never creates dataDir
        assert.equal(fs.existsSync(dataDir), false);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});
