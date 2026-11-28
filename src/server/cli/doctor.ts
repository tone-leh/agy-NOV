import fs from 'node:fs';
import path from 'node:path';
import { getModuleDataDir, loadNovConfigReadOnly } from '../../core/config.js';
import { getFeedSnapshotPath, MAX_FEED_SNAPSHOT_BYTES } from '../../core/feed.js';
import { canonicalRealpathSync, isPathInsideDir } from '../../core/fs-safe.js';
import { discoverUserCustomSkillsReadOnly } from '../../core/utils.js';
import { loadTurboPrefsReadOnly } from '../../modules/turbo/auto-rtk.js';
import { CLI_VERSION, resolvePluginRootDir } from './helpers.js';

const MARKETPLACE_DESCRIPTION_MIN = 60;
const MARKETPLACE_DESCRIPTION_MAX = 200;

function hasSymlinkWithinRelativePath(rootDir: string, relPath: string): boolean {
  const segments = relPath.split(/[\\/]+/).filter(Boolean);
  let cur = rootDir;
  for (const seg of segments) {
    cur = path.join(cur, seg);
    const st = fs.lstatSync(cur);
    if (st.isSymbolicLink()) return true;
  }
  return false;
}

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
    'sidecars/audit-sidecar.mjs',
    'sidecars/README.md',
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

  // Validate plugin.json official schema fields & Marketplace Readiness Check (read-only)
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
    let manifest: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(pluginPath, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        manifest = parsed as Record<string, unknown>;
      }
    } catch {
      manifest = null;
    }

    if (!manifest) {
      ok = false;
      console.log('  FAIL plugin.json is not a valid JSON object');
    } else {
      const unknown = Object.keys(manifest).filter((k) => !allowedKeys.has(k));
      if (unknown.length > 0) {
        ok = false;
        console.log(`  FAIL plugin.json contains unknown keys: ${unknown.join(', ')}`);
      } else {
        console.log(
          `  OK   plugin.json schema clean (name=${String(manifest.name)}, version=${String(manifest.version)})`,
        );
      }

      // Marketplace Readiness Check 1: description concise length (60..200 recommended; WARN non-blocking)
      const rawDesc = manifest.description;
      if (typeof rawDesc !== 'string' || !rawDesc.trim()) {
        ok = false;
        console.log('  FAIL Marketplace description missing or empty');
      } else {
        const descLen = rawDesc.trim().length;
        if (descLen >= MARKETPLACE_DESCRIPTION_MIN && descLen <= MARKETPLACE_DESCRIPTION_MAX) {
          console.log(
            `  OK   Marketplace description length (${descLen} chars, within ${MARKETPLACE_DESCRIPTION_MIN}-${MARKETPLACE_DESCRIPTION_MAX} recommended)`,
          );
        } else {
          console.log(
            `  WARN Marketplace description length (${descLen} chars; recommended ${MARKETPLACE_DESCRIPTION_MIN}-${MARKETPLACE_DESCRIPTION_MAX} chars)`,
          );
        }
      }

      // Marketplace Readiness Check 2: suggestedPrompts (1..3 non-empty strings)
      const rawPrompts = manifest.suggestedPrompts;
      const promptsValid =
        Array.isArray(rawPrompts) &&
        rawPrompts.length >= 1 &&
        rawPrompts.length <= 3 &&
        rawPrompts.every((p) => typeof p === 'string' && p.trim().length > 0);
      if (!promptsValid) {
        ok = false;
        console.log('  FAIL Marketplace suggestedPrompts must contain 1-3 non-empty strings');
      } else {
        console.log(
          `  OK   Marketplace suggestedPrompts (${rawPrompts.length}/3 valid non-empty prompts)`,
        );
      }

      // Marketplace Readiness Check 3: logo must be a relative path to an existing regular asset inside rootDir
      const rawLogo = manifest.logo;
      if (typeof rawLogo !== 'string' || !rawLogo.trim()) {
        ok = false;
        console.log('  FAIL Marketplace logo must be a non-empty relative path');
      } else {
        const logoRel = rawLogo.trim();
        const isUnsafeOrAbsolute =
          path.isAbsolute(logoRel) ||
          /^[A-Za-z]:[\\/]/.test(logoRel) ||
          /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(logoRel) ||
          logoRel.startsWith('\\') ||
          logoRel.includes('\0');
        if (isUnsafeOrAbsolute) {
          ok = false;
          console.log(`  FAIL Marketplace logo must be a relative path (got "${logoRel}")`);
        } else {
          const resolvedLogo = path.resolve(rootDir, logoRel);
          let logoExists = false;
          try {
            const realRoot = canonicalRealpathSync(rootDir);
            const relFromRoot = path.relative(rootDir, resolvedLogo);
            const escapesRoot =
              !relFromRoot ||
              relFromRoot.startsWith('..') ||
              path.isAbsolute(relFromRoot);
            if (!escapesRoot && !hasSymlinkWithinRelativePath(rootDir, relFromRoot)) {
              const st = fs.lstatSync(resolvedLogo);
              if (!st.isSymbolicLink() && st.isFile()) {
                const realLogo = canonicalRealpathSync(resolvedLogo);
                logoExists = isPathInsideDir(realRoot, realLogo);
              }
            }
          } catch {
            logoExists = false;
          }
          if (!logoExists) {
            ok = false;
            console.log(`  FAIL Marketplace logo asset missing or outside plugin root (${logoRel})`);
          } else {
            console.log(`  OK   Marketplace logo relative asset exists (${logoRel})`);
          }
        }
      }
    }
  }

  // Marketplace Readiness Check 4: confirm no rules/AGENTS.md (zero always-on rule bloat)
  const alwaysOnRulesPath = path.join(rootDir, 'rules', 'AGENTS.md');
  let hasAlwaysOnRules = false;
  try {
    fs.lstatSync(alwaysOnRulesPath);
    hasAlwaysOnRules = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      hasAlwaysOnRules = true;
    }
  }
  if (hasAlwaysOnRules) {
    ok = false;
    console.log(
      '  FAIL Marketplace rule bloat check: unexpected rules/AGENTS.md found (avoid always-on rule tax)',
    );
  } else {
    console.log(
      '  OK   Marketplace rule bloat check: no rules/AGENTS.md (zero always-on rule tax)',
    );
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

  // Read-only Antigravity v2.36+ dual-root custom skill discovery (~/.gemini precedence over ~/.agents/skills)
  const customSkills = discoverUserCustomSkillsReadOnly();
  const geminiSkillsCount = customSkills.skills.filter((s) => s.source === 'gemini').length;
  const agentsSkillsCount = customSkills.skills.filter((s) => s.source === 'agents').length;
  const shadowedNote =
    customSkills.shadowedByGemini.length > 0
      ? `, ${customSkills.shadowedByGemini.length} shadowed by ~/.gemini precedence`
      : '';
  console.log(
    `  OK   Custom Skills (~/.gemini > ~/.agents/skills): ${customSkills.skills.length} discovered (${geminiSkillsCount} ~/.gemini, ${agentsSkillsCount} ~/.agents/skills${shadowedNote})`,
  );

  return ok ? 0 : 1;
}
