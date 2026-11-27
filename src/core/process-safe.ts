import fs from 'node:fs';
import path from 'node:path';
import { canonicalRealpathSync, isPathInsideDir } from './fs-safe.js';

export interface ResolvedSafeSpawnTarget {
  command: string;
  args: string[];
  resolvedViaNodeJs?: boolean;
}

const NODE_JS_BIN_MAP: Readonly<
  Record<
    string,
    { pkg: string; binKey: string; fallbackPaths: string[]; allowWorkspaceLocal: boolean }
  >
> = {
  tsc: { pkg: 'typescript', binKey: 'tsc', fallbackPaths: ['bin/tsc'], allowWorkspaceLocal: true },
  eslint: { pkg: 'eslint', binKey: 'eslint', fallbackPaths: ['bin/eslint.js'], allowWorkspaceLocal: true },
  vitest: { pkg: 'vitest', binKey: 'vitest', fallbackPaths: ['vitest.mjs'], allowWorkspaceLocal: true },
  jest: { pkg: 'jest', binKey: 'jest', fallbackPaths: ['bin/jest.js'], allowWorkspaceLocal: true },
  pnpm: { pkg: 'pnpm', binKey: 'pnpm', fallbackPaths: ['bin/pnpm.cjs'], allowWorkspaceLocal: false },
  yarn: { pkg: 'yarn', binKey: 'yarn', fallbackPaths: ['bin/yarn.js'], allowWorkspaceLocal: false },
};

function findJsBinEntryInNodeModules(
  baseDir: string,
  pkg: string,
  binKey: string,
  fallbackPaths: string[],
  platform: NodeJS.Platform,
): string | null {
  let realBase: string;
  try {
    realBase = canonicalRealpathSync(baseDir);
  } catch {
    return null;
  }
  const pkgDir = path.join(realBase, 'node_modules', pkg);
  let realPkg: string;
  try {
    realPkg = canonicalRealpathSync(pkgDir);
    if (!fs.statSync(realPkg).isDirectory()) return null;
    if (!isPathInsideDir(realBase, realPkg, platform)) return null;
  } catch {
    return null;
  }

  const pkgJsonPath = path.join(realPkg, 'package.json');
  try {
    if (fs.existsSync(pkgJsonPath) && fs.statSync(pkgJsonPath).isFile()) {
      const parsed = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as {
        bin?: string | Record<string, string>;
      };
      const relBin =
        typeof parsed.bin === 'string'
          ? parsed.bin
          : parsed.bin && typeof parsed.bin === 'object'
            ? parsed.bin[binKey]
            : undefined;
      if (typeof relBin === 'string' && relBin.trim()) {
        const absBin = path.resolve(realPkg, relBin.trim());
        if (fs.existsSync(absBin)) {
          const realBin = canonicalRealpathSync(absBin);
          if (
            fs.statSync(realBin).isFile() &&
            isPathInsideDir(realBase, realBin, platform) &&
            isPathInsideDir(realPkg, realBin, platform) &&
            /\.(?:c|m)?js$/i.test(realBin)
          ) {
            return realBin;
          }
        }
      }
    }
  } catch {
    // fall through to fallback paths
  }
  for (const rel of fallbackPaths) {
    const abs = path.resolve(realPkg, rel);
    try {
      if (fs.existsSync(abs)) {
        const realBin = canonicalRealpathSync(abs);
        if (
          fs.statSync(realBin).isFile() &&
          isPathInsideDir(realBase, realBin, platform) &&
          isPathInsideDir(realPkg, realBin, platform)
        ) {
          return realBin;
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Resolve a whitelisted executable for shell-free (`shell: false`) child execution
 * across macOS, Linux, and Windows.
 *
 * On Windows, `npm`, `npx`, `pnpm`, `yarn`, and local Node CLI shims (`tsc`, `eslint`,
 * `vitest`, `jest`) are `.cmd` files that throw `ENOENT` or `EINVAL` (CVE-2024-27980)
 * when spawned with `shell: false`. Resolving their underlying `.js`/`.cjs`/`.mjs` entry
 * and invoking `process.execPath` keeps execution 100% shell-free without weakening security.
 */
export function resolveSafeSpawnTarget(
  executable: string,
  args: string[],
  opts: {
    cwd?: string;
    platform?: NodeJS.Platform;
    execPath?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): ResolvedSafeSpawnTarget {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'win32') {
    return { command: executable, args: [...args] };
  }

  const execPath = opts.execPath ?? process.execPath;
  const env = opts.env ?? process.env;
  const lower = executable.toLowerCase();
  const nodeDir = path.dirname(execPath);

  const trustedGlobalRootsRaw: string[] = [nodeDir];
  if (env.APPDATA) trustedGlobalRootsRaw.push(path.join(env.APPDATA, 'npm'));
  if (env.ProgramFiles) trustedGlobalRootsRaw.push(path.join(env.ProgramFiles, 'nodejs'));
  if (env.NVM_SYMLINK) trustedGlobalRootsRaw.push(env.NVM_SYMLINK);
  if (env.NVM_HOME) trustedGlobalRootsRaw.push(env.NVM_HOME);

  const trustedGlobalRealRoots: string[] = [];
  for (const rootCand of trustedGlobalRootsRaw) {
    try {
      const realRoot = canonicalRealpathSync(rootCand);
      if (fs.statSync(realRoot).isDirectory()) {
        trustedGlobalRealRoots.push(realRoot);
      }
    } catch {
      // ignore nonexistent global root
    }
  }

  // 1. npm / npx -> run bundled npm-cli.js / npx-cli.js directly via Node (shell: false)
  if (lower === 'npm' || lower === 'npx') {
    const targetScript = lower === 'npm' ? 'npm-cli.js' : 'npx-cli.js';
    const envExec = lower === 'npm' ? env.npm_execpath : undefined;
    if (typeof envExec === 'string' && envExec.trim() && /npm-cli\.js$/i.test(envExec.trim())) {
      try {
        const realEnvExec = canonicalRealpathSync(envExec.trim());
        if (
          fs.statSync(realEnvExec).isFile() &&
          trustedGlobalRealRoots.some((root) => isPathInsideDir(root, realEnvExec, platform))
        ) {
          return {
            command: execPath,
            args: [realEnvExec, ...args],
            resolvedViaNodeJs: true,
          };
        }
      } catch {
        // untrusted or invalid npm_execpath; fall back to trusted global candidates
      }
    }

    for (const trustedRoot of trustedGlobalRealRoots) {
      const cand = path.join(trustedRoot, 'node_modules', 'npm', 'bin', targetScript);
      try {
        if (fs.existsSync(cand)) {
          const realCand = canonicalRealpathSync(cand);
          if (
            fs.statSync(realCand).isFile() &&
            isPathInsideDir(trustedRoot, realCand, platform)
          ) {
            return {
              command: execPath,
              args: [realCand, ...args],
              resolvedViaNodeJs: true,
            };
          }
        }
      } catch {
        // ignore unreadable candidate
      }
    }
  }

  // 2. JS CLI runners (pnpm / yarn / tsc / eslint / vitest / jest) -> prefer safe JS bin via Node
  const binSpec = NODE_JS_BIN_MAP[lower];
  if (binSpec) {
    const searchBases: string[] = [];
    if (binSpec.allowWorkspaceLocal && opts.cwd) {
      searchBases.push(path.resolve(opts.cwd));
    }
    searchBases.push(...trustedGlobalRealRoots);
    for (const base of searchBases) {
      const jsBin = findJsBinEntryInNodeModules(
        base,
        binSpec.pkg,
        binSpec.binKey,
        binSpec.fallbackPaths,
        platform,
      );
      if (jsBin) {
        return {
          command: execPath,
          args: [jsBin, ...args],
          resolvedViaNodeJs: true,
        };
      }
    }
  }

  // 3. python3 on Windows: official installer ships `python.exe` (python3.exe is often MS Store stub)
  if (lower === 'python3') {
    return { command: 'python', args: [...args] };
  }

  return { command: executable, args: [...args] };
}
