import os from 'node:os';
import path from 'node:path';
import { isSamePath } from './fs-safe.js';

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
