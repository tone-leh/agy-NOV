import fs from 'node:fs';
import path from 'node:path';
import { canonicalRealpathSync, isPathInsideDir, isSamePath } from '../../core/fs-safe.js';
import { validateVerifyCommand } from './allowlist.js';
import type { DetectedVerifyCommand, DetectedWorkspaceVerifyResult } from './types.js';

const MAX_DETECT_FILE_BYTES = 256 * 1024;

const COMMON_NODE_VERIFY_SCRIPTS: ReadonlyArray<{
  script: string;
  label: string;
  timeoutMs: number;
}> = [
  { script: 'typecheck', label: 'Typecheck', timeoutMs: 20_000 },
  { script: 'type-check', label: 'Type Check', timeoutMs: 20_000 },
  { script: 'check', label: 'Check', timeoutMs: 20_000 },
  { script: 'lint', label: 'Lint', timeoutMs: 20_000 },
  { script: 'test', label: 'Tests', timeoutMs: 30_000 },
];

function resolveTopLevelWorkspaceFile(
  realRoot: string,
  fileName: string,
): { realTarget: string; size: number } | null {
  if (
    !fileName ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    fileName.includes('..') ||
    fileName.includes('\0')
  ) {
    return null;
  }
  const candidate = path.join(realRoot, fileName);
  try {
    fs.lstatSync(candidate);
    const realTarget = canonicalRealpathSync(candidate);
    if (!isPathInsideDir(realRoot, realTarget) || isSamePath(realRoot, realTarget)) {
      return null;
    }
    const stat = fs.statSync(realTarget);
    if (!stat.isFile()) {
      return null;
    }
    return { realTarget, size: stat.size };
  } catch {
    return null;
  }
}

function readTopLevelWorkspaceFile(
  realRoot: string,
  fileName: string,
  maxBytes = MAX_DETECT_FILE_BYTES,
): string | null {
  const resolved = resolveTopLevelWorkspaceFile(realRoot, fileName);
  if (!resolved) return null;
  const readLen = Math.min(resolved.size, maxBytes);
  const buf = Buffer.alloc(readLen);
  try {
    const fd = fs.openSync(resolved.realTarget, 'r');
    try {
      if (readLen > 0) {
        fs.readSync(fd, buf, 0, readLen, 0);
      }
    } finally {
      fs.closeSync(fd);
    }
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Pure read-only project stack detector for Verify Gate.
 * Inspects only top-level workspace manifests inside workspaceRoot (realpath-confined)
 * and passes every candidate through validateVerifyCommand() before returning.
 */
export function detectWorkspaceVerifyCommands(
  workspaceRoot: string,
  platform: NodeJS.Platform = process.platform,
): DetectedWorkspaceVerifyResult {
  if (!workspaceRoot || typeof workspaceRoot !== 'string' || workspaceRoot.includes('\0')) {
    return { detectedStacks: [], recommendations: [] };
  }

  let realRoot: string;
  try {
    realRoot = canonicalRealpathSync(path.resolve(workspaceRoot));
    if (!fs.statSync(realRoot).isDirectory()) {
      return { detectedStacks: [], recommendations: [] };
    }
  } catch {
    return { detectedStacks: [], recommendations: [] };
  }

  const stacks: string[] = [];
  const stackSet = new Set<string>();
  const recommendations: DetectedVerifyCommand[] = [];
  const seenIds = new Set<string>();

  const addStack = (name: string) => {
    if (!stackSet.has(name)) {
      stackSet.add(name);
      stacks.push(name);
    }
  };

  const pushValidated = (candidate: DetectedVerifyCommand) => {
    const checked = validateVerifyCommand({
      id: candidate.id,
      label: candidate.label,
      executable: candidate.executable,
      args: candidate.args,
      timeoutMs: candidate.timeoutMs,
      enabled: true,
    });
    if (!checked.valid || !checked.command) return;
    if (seenIds.has(checked.command.id)) return;
    seenIds.add(checked.command.id);
    recommendations.push({
      id: checked.command.id,
      label: checked.command.label,
      executable: checked.command.executable,
      args: [...checked.command.args],
      timeoutMs: checked.command.timeoutMs,
      reason: candidate.reason,
    });
  };

  // 1. Node / TypeScript (package.json)
  const pkgRaw = readTopLevelWorkspaceFile(realRoot, 'package.json');
  if (pkgRaw !== null) {
    addStack('node');
    let pm: 'pnpm' | 'yarn' | 'bun' | 'npm' = 'npm';
    if (resolveTopLevelWorkspaceFile(realRoot, 'pnpm-lock.yaml')) {
      pm = 'pnpm';
    } else if (resolveTopLevelWorkspaceFile(realRoot, 'yarn.lock')) {
      pm = 'yarn';
    } else if (
      resolveTopLevelWorkspaceFile(realRoot, 'bun.lock') ||
      resolveTopLevelWorkspaceFile(realRoot, 'bun.lockb')
    ) {
      pm = 'bun';
    }

    const hasTsConfig = Boolean(resolveTopLevelWorkspaceFile(realRoot, 'tsconfig.json'));
    if (hasTsConfig) {
      addStack('typescript');
    }

    try {
      const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
      const deps =
        pkg.dependencies && typeof pkg.dependencies === 'object' && !Array.isArray(pkg.dependencies)
          ? (pkg.dependencies as Record<string, unknown>)
          : null;
      const devDeps =
        pkg.devDependencies &&
        typeof pkg.devDependencies === 'object' &&
        !Array.isArray(pkg.devDependencies)
          ? (pkg.devDependencies as Record<string, unknown>)
          : null;
      if (deps?.typescript || devDeps?.typescript) {
        addStack('typescript');
      }

      if (pkg.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts)) {
        const scripts = pkg.scripts as Record<string, unknown>;
        for (const item of COMMON_NODE_VERIFY_SCRIPTS) {
          if (!Object.prototype.hasOwnProperty.call(scripts, item.script)) continue;
          const scriptVal = scripts[item.script];
          if (typeof scriptVal !== 'string' || !scriptVal.trim()) continue;
          pushValidated({
            id: `node-${item.script}`,
            label: `${item.label} (${pm})`,
            executable: pm,
            args: item.script === 'test' ? ['test'] : ['run', item.script],
            timeoutMs: item.timeoutMs,
            reason: `Detected "${item.script}" script in package.json (${pm})`,
          });
        }
      }
    } catch {
      // Malformed package.json: skip scripts safely with zero writes
    }
  }

  // 2. Python (pyproject.toml / pytest.ini)
  const pyprojectRaw = readTopLevelWorkspaceFile(realRoot, 'pyproject.toml');
  const hasPytestIni = Boolean(resolveTopLevelWorkspaceFile(realRoot, 'pytest.ini'));
  if (pyprojectRaw !== null || hasPytestIni) {
    addStack('python');
    pushValidated({
      id: 'python-pytest',
      label: 'Python Pytest',
      executable: platform === 'win32' ? 'python' : 'python3',
      args: ['-m', 'pytest'],
      timeoutMs: 30_000,
      reason: pyprojectRaw !== null ? 'Detected pyproject.toml' : 'Detected pytest.ini',
    });

    const hasRuff =
      (pyprojectRaw !== null && /\bruff\b/i.test(pyprojectRaw)) ||
      Boolean(resolveTopLevelWorkspaceFile(realRoot, 'ruff.toml')) ||
      Boolean(resolveTopLevelWorkspaceFile(realRoot, '.ruff.toml'));
    if (hasRuff) {
      pushValidated({
        id: 'python-ruff',
        label: 'Python Ruff Check',
        executable: 'ruff',
        args: ['check', '.'],
        timeoutMs: 15_000,
        reason: 'Detected ruff configuration in Python project',
      });
    }
  }

  // 3. Rust (Cargo.toml)
  if (resolveTopLevelWorkspaceFile(realRoot, 'Cargo.toml')) {
    addStack('rust');
    pushValidated({
      id: 'rust-check',
      label: 'Cargo Check',
      executable: 'cargo',
      args: ['check'],
      timeoutMs: 30_000,
      reason: 'Detected Cargo.toml',
    });
    pushValidated({
      id: 'rust-test',
      label: 'Cargo Test',
      executable: 'cargo',
      args: ['test'],
      timeoutMs: 45_000,
      reason: 'Detected Cargo.toml',
    });
  }

  // 4. Go (go.mod)
  if (resolveTopLevelWorkspaceFile(realRoot, 'go.mod')) {
    addStack('go');
    pushValidated({
      id: 'go-vet',
      label: 'Go Vet',
      executable: 'go',
      args: ['vet', './...'],
      timeoutMs: 20_000,
      reason: 'Detected go.mod',
    });
    pushValidated({
      id: 'go-test',
      label: 'Go Test',
      executable: 'go',
      args: ['test', './...'],
      timeoutMs: 45_000,
      reason: 'Detected go.mod',
    });
  }

  return {
    detectedStacks: stacks,
    recommendations,
  };
}
