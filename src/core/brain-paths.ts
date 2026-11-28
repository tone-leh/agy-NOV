import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalRealpathSync,
  isPathInsideDir,
  isSamePath,
  normalizePathForCompare,
} from './fs-safe.js';

export interface CustomSkillRootSpec {
  dir: string;
  source: 'gemini' | 'agents';
  priority: number;
}

export interface DiscoveredCustomSkill {
  name: string;
  source: 'gemini' | 'agents';
  rootDir: string;
  skillFile: string;
}

export interface CustomSkillDiscoverySummary {
  rootsChecked: CustomSkillRootSpec[];
  existingRoots: CustomSkillRootSpec[];
  skills: DiscoveredCustomSkill[];
  shadowedByGemini: Array<{ name: string; shadowedFrom: string }>;
}

const MAX_CUSTOM_SKILL_ENTRIES_PER_ROOT = 200;
const MAX_CUSTOM_SKILL_SCANNED_DIRENTS = 1000;

/**
 * Canonical ordered list of Antigravity Brain directories across macOS, Linux, and Windows.
 */
export function getDefaultAntigravityBrainDirs(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
): string[] {
  const dirs: string[] = [];
  const pushUnique = (dir: string | undefined) => {
    if (!dir || !dir.trim()) return;
    const resolved = path.resolve(dir.trim());
    if (!dirs.some((d) => isSamePath(d, resolved, platform))) {
      dirs.push(resolved);
    }
  };

  if (env.AGY_BRAIN_DIR) {
    pushUnique(env.AGY_BRAIN_DIR);
  }
  if (env.ANTIGRAVITY_BRAIN_DIR) {
    pushUnique(env.ANTIGRAVITY_BRAIN_DIR);
  }

  const geminiRoots: string[] = [path.join(homeDir, '.gemini')];
  if (platform === 'linux') {
    if (env.XDG_DATA_HOME) geminiRoots.push(path.join(env.XDG_DATA_HOME, 'gemini'));
    if (env.XDG_CONFIG_HOME) geminiRoots.push(path.join(env.XDG_CONFIG_HOME, 'gemini'));
  } else if (platform === 'win32') {
    if (env.LOCALAPPDATA) geminiRoots.push(path.join(env.LOCALAPPDATA, 'gemini'));
    if (env.APPDATA) geminiRoots.push(path.join(env.APPDATA, 'gemini'));
  }

  for (const root of geminiRoots) {
    pushUnique(path.join(root, 'antigravity', 'brain'));
    pushUnique(path.join(root, 'antigravity-cli', 'brain'));
    pushUnique(path.join(root, 'antigravity-ide', 'brain'));
    pushUnique(path.join(root, 'brain'));
  }

  return dirs;
}

/**
 * Antigravity v2.36.0+ user-level custom skill search roots across macOS, Linux, and Windows.
 * Strictly orders `~/.gemini` roots ahead of `~/.agents/skills` so identically named skills
 * resolve with `~/.gemini` taking precedence.
 */
export function getDefaultAntigravitySkillDirs(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
): CustomSkillRootSpec[] {
  const specs: CustomSkillRootSpec[] = [];
  const pushUnique = (dir: string | undefined, source: 'gemini' | 'agents') => {
    if (!dir || !dir.trim()) return;
    const resolved = path.resolve(dir.trim());
    if (!specs.some((s) => isSamePath(s.dir, resolved, platform))) {
      specs.push({ dir: resolved, source, priority: specs.length });
    }
  };

  const geminiRoots: string[] = [path.join(homeDir, '.gemini')];
  if (platform === 'linux') {
    if (env.XDG_CONFIG_HOME) geminiRoots.push(path.join(env.XDG_CONFIG_HOME, 'gemini'));
    if (env.XDG_DATA_HOME) geminiRoots.push(path.join(env.XDG_DATA_HOME, 'gemini'));
  } else if (platform === 'win32') {
    if (env.APPDATA) geminiRoots.push(path.join(env.APPDATA, 'gemini'));
    if (env.LOCALAPPDATA) geminiRoots.push(path.join(env.LOCALAPPDATA, 'gemini'));
  }

  // ~/.gemini paths always take precedence over ~/.agents/skills (Antigravity v2.36.0 contract)
  for (const root of geminiRoots) {
    pushUnique(path.join(root, 'config', 'skills'), 'gemini');
    pushUnique(path.join(root, 'antigravity', 'skills'), 'gemini');
    pushUnique(path.join(root, 'skills'), 'gemini');
  }

  pushUnique(path.join(homeDir, '.agents', 'skills'), 'agents');

  return specs;
}

/**
 * Pure read-only discovery of user-level custom skills across `~/.gemini/*` and `~/.agents/skills`.
 * Deduplicates by skill name (case-insensitive) and physical target directory with `~/.gemini` strictly
 * taking precedence, never creates directories, permits legitimate symlinked skill directories, and
 * skips broken symlinks or `SKILL.md` files that escape their skill directory.
 */
export function discoverUserCustomSkillsReadOnly(
  opts: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    homeDir?: string;
    skillRoots?: CustomSkillRootSpec[];
  } = {},
): CustomSkillDiscoverySummary {
  const platform = opts.platform ?? process.platform;
  const rootsChecked =
    opts.skillRoots ??
    getDefaultAntigravitySkillDirs(
      opts.env ?? process.env,
      platform,
      opts.homeDir ?? os.homedir(),
    );

  const existingRoots: CustomSkillRootSpec[] = [];
  const skills: DiscoveredCustomSkill[] = [];
  const shadowedByGemini: Array<{ name: string; shadowedFrom: string }> = [];
  const winnerByName = new Map<string, DiscoveredCustomSkill>();
  const seenRealRoots = new Set<string>();
  const seenRealSkillDirs = new Set<string>();

  for (const rootSpec of rootsChecked) {
    let rootStat: fs.Stats;
    let realRoot: string;
    try {
      rootStat = fs.statSync(rootSpec.dir);
      if (!rootStat.isDirectory()) continue;
      realRoot = canonicalRealpathSync(rootSpec.dir);
    } catch {
      continue;
    }

    // Deduplicate symlinked skill roots pointing to the same physical directory
    // (e.g., ~/.agents/skills -> ~/.gemini/config/skills) so skills are not double-counted or falsely shadowed.
    const realRootKey = normalizePathForCompare(realRoot, platform);
    if (seenRealRoots.has(realRootKey)) {
      continue;
    }
    seenRealRoots.add(realRootKey);
    existingRoots.push(rootSpec);

    let entries: fs.Dirent[];
    try {
      entries = fs
        .readdirSync(realRoot, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      continue;
    }

    let inspected = 0;
    let scannedDirents = 0;
    for (const entry of entries) {
      if (inspected >= MAX_CUSTOM_SKILL_ENTRIES_PER_ROOT) break;
      if (scannedDirents >= MAX_CUSTOM_SKILL_SCANNED_DIRENTS) break;
      scannedDirents += 1;
      if (entry.name.startsWith('.')) continue;

      const candidateDir = path.join(realRoot, entry.name);
      let realCandidateDir: string;
      try {
        const st = fs.statSync(candidateDir);
        if (!st.isDirectory()) continue;
        realCandidateDir = canonicalRealpathSync(candidateDir);
      } catch {
        continue;
      }

      // Check SKILL.md (case-tolerant on POSIX too: SKILL.md / skill.md)
      const skillFileCandidates = ['SKILL.md', 'skill.md'];
      let matchedSkillFile: string | null = null;
      for (const fileName of skillFileCandidates) {
        const candFile = path.join(realCandidateDir, fileName);
        try {
          const fStat = fs.lstatSync(candFile);
          if (fStat.isSymbolicLink() || !fStat.isFile()) continue;
          const realFile = canonicalRealpathSync(candFile);
          if (!isPathInsideDir(realCandidateDir, realFile, platform)) continue;
          matchedSkillFile = realFile;
          break;
        } catch {
          // continue checking
        }
      }

      if (!matchedSkillFile) continue;
      inspected += 1;

      const skillName = entry.name.trim();
      const dedupeKey = skillName.toLowerCase();
      const realSkillDirKey = normalizePathForCompare(realCandidateDir, platform);
      const existing = winnerByName.get(dedupeKey);
      if (existing) {
        if (
          existing.source === 'gemini' &&
          rootSpec.source === 'agents' &&
          !seenRealSkillDirs.has(realSkillDirKey)
        ) {
          shadowedByGemini.push({ name: skillName, shadowedFrom: rootSpec.dir });
        }
        continue;
      }
      if (seenRealSkillDirs.has(realSkillDirKey)) {
        continue;
      }
      seenRealSkillDirs.add(realSkillDirKey);

      const record: DiscoveredCustomSkill = {
        name: skillName,
        source: rootSpec.source,
        rootDir: rootSpec.dir,
        skillFile: matchedSkillFile,
      };
      winnerByName.set(dedupeKey, record);
      skills.push(record);
    }
  }

  return {
    rootsChecked,
    existingRoots,
    skills,
    shadowedByGemini,
  };
}
