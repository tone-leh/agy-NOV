#!/usr/bin/env node
/**
 * agy-NOV Read-Only Audit Sidecar (Opt-In, Zero Idle Daemon)
 *
 * Strictly one-shot, offline, zero-port, and read-only by default.
 * Never auto-starts on plugin install and never opens any network socket.
 * Delegates to the bundled `dist/cli.cjs audit-once --json` with `shell: false`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err) => {
    if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') {
      process.exit(0);
    }
  });
}

function printHelp() {
  process.stdout.write(`agy-NOV Read-Only Audit Sidecar (Opt-In, Zero Idle Daemon)

Usage:
  node sidecars/audit-sidecar.mjs [--once] [--workspace=<dir>] [--data-dir=<dir>] [--write-report]
  node sidecars/audit-sidecar.mjs --help

Options:
  --once              Run a single read-only health sweep and emit redacted JSON (default)
  --workspace=<dir>   Workspace directory to audit (defaults to current working directory)
  --data-dir=<dir>    agy-NOV plugin data directory (auto-detected read-only if omitted)
  --write-report      Atomically write health-sweep.json (<= 64 KiB, mode 0600) only if dataDir already exists
  --help, -h          Show this help message

Security Guarantees:
  - Opt-in only: never auto-started on plugin install; exits immediately after one sweep.
  - Zero listening ports, zero outbound network requests, zero code modifications.
  - Zero disk writes and zero directory creation unless --write-report targets an existing safe dataDir.
  - Invokes dist/cli.cjs directly via spawnSync(..., { shell: false }).
`);
}

function parseArgs(argv) {
  const forwarded = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      return { help: true, forwarded: [] };
    }
    if (arg === '--once') {
      continue;
    }
    if (arg === '--write-report') {
      forwarded.push('--write-report');
      continue;
    }
    if (arg.startsWith('--workspace=')) {
      const value = arg.slice('--workspace='.length);
      if (!value.trim()) {
        return { error: 'Missing value for --workspace=<dir>.' };
      }
      forwarded.push(`--workspace=${value}`);
      continue;
    }
    if (arg === '--workspace') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        return { error: 'Missing directory argument after --workspace.' };
      }
      forwarded.push(`--workspace=${next}`);
      i += 1;
      continue;
    }
    if (arg.startsWith('--data-dir=')) {
      const value = arg.slice('--data-dir='.length);
      if (!value.trim()) {
        return { error: 'Missing value for --data-dir=<dir>.' };
      }
      forwarded.push(`--data-dir=${value}`);
      continue;
    }
    if (arg === '--data-dir') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        return { error: 'Missing directory argument after --data-dir.' };
      }
      forwarded.push(`--data-dir=${next}`);
      i += 1;
      continue;
    }
    return { error: `Unknown argument "${arg}". Run with --help for supported options.` };
  }

  return { help: false, forwarded };
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    process.stderr.write(`[agy-NOV sidecar] ${parsed.error}\n`);
    process.exit(2);
  }
  if (parsed.help) {
    printHelp();
    process.exit(0);
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const pluginRoot = path.resolve(scriptDir, '..');
  const distDirPath = path.join(pluginRoot, 'dist');
  const cliBundlePath = path.join(distDirPath, 'cli.cjs');

  let distStat;
  try {
    distStat = fs.lstatSync(distDirPath);
  } catch {
    process.stderr.write(
      '[agy-NOV sidecar] Missing CLI bundle at "dist/cli.cjs". Run "npm run build" in the plugin root or verify your plugin installation.\n',
    );
    process.exit(1);
  }
  if (distStat.isSymbolicLink() || !distStat.isDirectory()) {
    process.stderr.write(
      '[agy-NOV sidecar] Refusing to execute CLI bundle from symlinked or non-directory "dist/".\n',
    );
    process.exit(1);
  }

  let bundleStat;
  try {
    bundleStat = fs.lstatSync(cliBundlePath);
  } catch {
    process.stderr.write(
      '[agy-NOV sidecar] Missing CLI bundle at "dist/cli.cjs". Run "npm run build" in the plugin root or verify your plugin installation.\n',
    );
    process.exit(1);
  }

  if (bundleStat.isSymbolicLink() || !bundleStat.isFile()) {
    process.stderr.write(
      '[agy-NOV sidecar] Refusing to execute unsafe or non-regular CLI bundle at "dist/cli.cjs".\n',
    );
    process.exit(1);
  }

  const realpathNative = fs.realpathSync.native ?? fs.realpathSync;
  let realPluginRoot;
  let realCliBundle;
  try {
    realPluginRoot = realpathNative(pluginRoot);
    realCliBundle = realpathNative(cliBundlePath);
  } catch {
    process.stderr.write(
      '[agy-NOV sidecar] Unable to verify canonical path of "dist/cli.cjs".\n',
    );
    process.exit(1);
  }
  const relBundle = path.relative(realPluginRoot, realCliBundle);
  if (!relBundle || relBundle.startsWith('..') || path.isAbsolute(relBundle)) {
    process.stderr.write(
      '[agy-NOV sidecar] Refusing to execute CLI bundle escaping the plugin root directory.\n',
    );
    process.exit(1);
  }

  const child = spawnSync(
    process.execPath,
    [realCliBundle, 'audit-once', '--json', ...parsed.forwarded],
    {
      shell: false,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );

  if (child.stdout) {
    process.stdout.write(child.stdout);
  }
  if (child.stderr) {
    process.stderr.write(child.stderr);
  }

  if (child.error) {
    const errCode = child.error.code;
    const reason =
      errCode === 'ETIMEDOUT'
        ? 'audit-once exceeded 30s execution timeout and was terminated cleanly'
        : child.error.message;
    process.stderr.write(`[agy-NOV sidecar] Failed to launch dist/cli.cjs: ${reason}\n`);
    process.exit(1);
  }

  process.exit(typeof child.status === 'number' ? child.status : 1);
}

main();
