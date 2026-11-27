import fs from 'node:fs';
import path from 'node:path';

/**
 * Create a directory symlink safely across macOS, Linux, and Windows.
 * On Windows, uses `'junction'` so tests work without elevated administrator privileges.
 */
export function createDirSymlink(target: string, linkPath: string): void {
  if (process.platform === 'win32') {
    fs.symlinkSync(path.resolve(target), linkPath, 'junction');
  } else {
    fs.symlinkSync(target, linkPath, 'dir');
  }
}

/**
 * Create a file symlink safely across macOS, Linux, and Windows.
 * Returns `false` if a restricted Windows environment without Developer Mode throws `EPERM`,
 * allowing callers to skip gracefully; returns `true` on GitHub Actions `windows-latest`
 * and all Linux/macOS environments.
 */
export function createFileSymlink(target: string, linkPath: string): boolean {
  try {
    if (process.platform === 'win32') {
      fs.symlinkSync(target, linkPath, 'file');
    } else {
      fs.symlinkSync(target, linkPath);
    }
    return true;
  } catch (err) {
    if (
      process.platform === 'win32' &&
      (err as NodeJS.ErrnoException)?.code === 'EPERM'
    ) {
      return false;
    }
    throw err;
  }
}
