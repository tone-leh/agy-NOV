import fs from 'node:fs';
import path from 'node:path';
import { isSensitivePath, scanTextForSecrets } from './policy.js';
import type { WorkspaceScanItem, WorkspaceScanReport } from './types.js';

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.venv',
  'venv',
  'target',
  'vendor',
  '.cache',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.conf',
  '.sh', '.bash', '.zsh', '.md', '.txt', '.sql', '.html', '.css',
]);

export function scanWorkspaceForSecrets(
  workspaceRoot: string,
  maxFiles = 250,
  customProtectedPaths: string[] = [],
): WorkspaceScanReport {
  const findings: WorkspaceScanItem[] = [];
  let scannedFiles = 0;
  let skippedFiles = 0;

  function walk(dir: string, depth: number): void {
    if (depth > 6 || scannedFiles >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (scannedFiles >= maxFiles) break;
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        skippedFiles++;
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.') || isSensitivePath(fullPath, customProtectedPaths).sensitive) {
          skippedFiles++;
          continue;
        }
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        if (isSensitivePath(fullPath, customProtectedPaths).sensitive) {
          skippedFiles++;
          continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext)) {
          skippedFiles++;
          continue;
        }
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > 512_000) {
            skippedFiles++;
            continue;
          }
          const raw = fs.readFileSync(fullPath);
          if (raw.includes(0)) {
            skippedFiles++;
            continue;
          }
          scannedFiles++;
          const text = raw.toString('utf8');
          const matches = scanTextForSecrets(text);
          const relPath = path.relative(workspaceRoot, fullPath) || entry.name;
          for (const finding of matches) {
            findings.push({ filePath: fullPath, relPath, finding });
            if (findings.length >= 60) return;
          }
        } catch {
          skippedFiles++;
        }
      }
    }
  }

  if (fs.existsSync(workspaceRoot)) {
    walk(workspaceRoot, 0);
  }

  return {
    scannedFiles,
    skippedFiles,
    findings,
    scannedAt: new Date().toISOString(),
  };
}
