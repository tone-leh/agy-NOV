import fs from 'node:fs';
import path from 'node:path';
import { getModuleDataDir, loadNovConfigReadOnly } from '../../core/config.js';
import { getFeedSnapshotPath, MAX_FEED_SNAPSHOT_BYTES } from '../../core/feed.js';
import { loadTurboPrefsReadOnly } from '../../modules/turbo/auto-rtk.js';
import { CLI_VERSION, resolvePluginRootDir } from './helpers.js';

export function runDoctor(dataDir: string): number {
  const rootDir = resolvePluginRootDir();
  const requiredFiles = [
    'plugin.json',
    'mcp_config.json',
    'hooks.json',
    'skills/agy-nov/SKILL.md',
    'skills/nov-spec/SKILL.md',
    'skills/nov-debug/SKILL.md',
    'skills/nov-review/SKILL.md',
    'skills/nov-handoff/SKILL.md',
    'skills/nov-workflow/SKILL.md',
    'agents/nov-blind-reviewer.md',
    'agents/nov-security-auditor.md',
    'assets/logo.svg',
    'dist/server.cjs',
    'dist/hook.cjs',
    'dist/cli.cjs',
    'dist/ui/app.html',
  ];

  let ok = true;
  console.log(`agy-NOV Doctor (v${CLI_VERSION} · Zero ASAR / Zero CDP)`);
  for (const rel of requiredFiles) {
    const abs = path.join(rootDir, rel);
    const exists = fs.existsSync(abs);
    if (!exists) ok = false;
    const size = exists ? `${(fs.statSync(abs).size / 1024).toFixed(1)} KB` : 'MISSING';
    console.log(`  ${exists ? 'OK  ' : 'FAIL'} ${rel.padEnd(28)} ${size}`);
  }

  // Validate plugin.json official schema fields
  const pluginPath = path.join(rootDir, 'plugin.json');
  if (fs.existsSync(pluginPath)) {
    const allowedKeys = new Set([
      'name',
      'displayName',
      'description',
      'version',
      'logo',
      'suggestedPrompts',
      'author',
      'homepage',
      'repository',
      'disabled',
    ]);
    const manifest = JSON.parse(fs.readFileSync(pluginPath, 'utf8')) as Record<string, unknown>;
    const unknown = Object.keys(manifest).filter((k) => !allowedKeys.has(k));
    if (unknown.length > 0) {
      ok = false;
      console.log(`  FAIL plugin.json contains unknown keys: ${unknown.join(', ')}`);
    } else {
      console.log(
        `  OK   plugin.json schema clean (name=${String(manifest.name)}, version=${String(manifest.version)})`,
      );
    }
  }

  // Verify UI bundle stays well under Antigravity 10 MiB resource limit
  const uiPath = path.join(rootDir, 'dist/ui/app.html');
  if (fs.existsSync(uiPath)) {
    const bytes = fs.statSync(uiPath).size;
    if (bytes >= 10 * 1024 * 1024) {
      ok = false;
      console.log(`  FAIL dist/ui/app.html exceeds 10 MiB limit (${bytes} bytes)`);
    } else {
      console.log(`  OK   dist/ui/app.html well below 10 MiB cap (${(bytes / 1024).toFixed(1)} KB)`);
    }
  }

  const cfg = loadNovConfigReadOnly(dataDir);
  console.log(
    `  OK   config readable (preset=${cfg.preset}, locale=${cfg.locale}, remote=${cfg.modules.remote ? 'ON' : 'OFF'})`,
  );

  // Read-only Auto-RTK proxy status (default OFF, zero disk writes)
  const turboPrefs = loadTurboPrefsReadOnly(getModuleDataDir(dataDir, 'turbo'));
  const autoRtkActive = cfg.modules.turbo && turboPrefs.autoRtk;
  console.log(
    `  OK   Auto-RTK: ${turboPrefs.autoRtk ? (autoRtkActive ? 'ON (active)' : 'ON (waiting for turbo module)') : 'OFF (default safe passive mode)'}`,
  );

  // Read-only dual-star feed snapshot status check (never writes or creates directories)
  const feedPath = getFeedSnapshotPath(dataDir);
  let feedStatusTag = 'OK  ';
  let feedNote = 'not generated yet (lazy read-only until first write)';
  try {
    const feedStat = fs.lstatSync(feedPath);
    if (feedStat.isSymbolicLink() || !feedStat.isFile()) {
      ok = false;
      feedStatusTag = 'FAIL';
      feedNote = 'unsafe symlink or non-regular file';
    } else if (feedStat.size > MAX_FEED_SNAPSHOT_BYTES) {
      ok = false;
      feedStatusTag = 'FAIL';
      feedNote = `exceeds 64 KB cap (${feedStat.size} bytes)`;
    } else {
      feedNote = `ready (${(feedStat.size / 1024).toFixed(1)} KB)`;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      feedNote = 'unreadable';
    }
  }
  console.log(`  ${feedStatusTag} Feed Snapshot: ${feedPath} (${feedNote})`);

  return ok ? 0 : 1;
}
