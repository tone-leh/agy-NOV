import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HookEventName, NormalizedHookPayload } from './types.js';

const RETRYABLE_WIN_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const WIN_RETRY_SLEEP_BUF = new Int32Array(new SharedArrayBuffer(4));

function syncSleepMs(ms: number): void {
  if (ms <= 0) return;
  try {
    Atomics.wait(WIN_RETRY_SLEEP_BUF, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // fallback spin when Atomics.wait is unavailable
    }
  }
}

/**
 * Canonical realpath resolution using `fs.realpathSync.native` when available so
 * Windows 8.3 short paths (e.g. `RUNNER~1`) and drive-letter casing are normalized.
 */
export function canonicalRealpathSync(targetPath: string): string {
  const nativeFn = fs.realpathSync.native;
  return typeof nativeFn === 'function' ? nativeFn(targetPath) : fs.realpathSync(targetPath);
}

/**
 * Normalize a resolved path for equality / containment comparison across platforms.
 * Windows paths are case-insensitive and may arrive with `/` or `\`; POSIX paths stay case-sensitive.
 */
export function normalizePathForCompare(
  p: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!p) return '';
  if (platform === 'win32') {
    let winPath = p.replace(/\//g, '\\');
    if (/^\\\\\?\\UNC\\/i.test(winPath)) {
      winPath = `\\\\${winPath.slice(8)}`;
    } else if (/^\\\\\?\\[A-Za-z]:\\/.test(winPath)) {
      winPath = winPath.slice(4);
    }
    const norm = path.win32.normalize(winPath);
    const isDriveRoot = /^[A-Za-z]:\\$/.test(norm);
    const trimmed =
      !isDriveRoot && norm.length > 1 && norm.endsWith('\\')
        ? norm.replace(/\\+$/, '')
        : norm;
    return trimmed.toLowerCase();
  }
  const norm = path.posix.normalize(p);
  return norm.length > 1 && norm.endsWith('/') ? norm.replace(/\/+$/, '') : norm;
}

export function isSamePath(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return normalizePathForCompare(a, platform) === normalizePathForCompare(b, platform);
}

/**
 * Cross-platform directory containment check (`targetReal` is equal to or strictly inside `rootReal`).
 */
export function isPathInsideDir(
  rootReal: string,
  targetReal: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normRoot = normalizePathForCompare(rootReal, platform);
  const normTarget = normalizePathForCompare(targetReal, platform);
  if (!normRoot || !normTarget) return false;
  if (normTarget === normRoot) return true;
  const sep = platform === 'win32' ? '\\' : '/';
  const prefix = normRoot.endsWith(sep) ? normRoot : `${normRoot}${sep}`;
  return normTarget.startsWith(prefix);
}

/**
 * Recognize legitimate OS-level root symlinks so ancestor symlink checks do not
 * false-positive on macOS (`/var`, `/tmp`, `/etc`), Linux (`/home -> /var/home`,
 * `/var/run -> /run`, `/var/lock`, `/tmp`, `/bin`, `/sbin`, `/lib`, `/lib64`),
 * or Windows drive roots (`C:\`).
 */
export function isPlatformSystemSymlink(
  segmentPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === 'darwin') {
    return /^\/(?:var|tmp|etc)$/.test(segmentPath);
  }
  if (platform === 'linux') {
    return /^\/(?:home|tmp|var\/run|var\/lock|bin|sbin|lib|lib64)$/.test(segmentPath);
  }
  if (platform === 'win32') {
    return /^[A-Za-z]:[\\/]?$/.test(segmentPath);
  }
  return false;
}

/**
 * Check whether `targetPath` or any non-system ancestor is a symlink.
 * Stops safely at filesystem root (never triggers false positives on `C:\` or Linux system symlinks).
 */
export function hasUnsafeSymlinkAncestor(
  targetPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  let cur = path.resolve(targetPath);
  const root = path.parse(cur).root;
  while (true) {
    if (cur === root) return false;
    if (!isPlatformSystemSymlink(cur, platform)) {
      try {
        const st = fs.lstatSync(cur);
        if (st.isSymbolicLink()) return true;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code !== 'ENOENT') return true;
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
}

/**
 * Cross-platform atomic rename with bounded short retries on Windows NTFS transient
 * `EPERM` / `EBUSY` / `EACCES` locks (e.g. concurrent reader or AV scan). Cleans up
 * `tmpPath` best-effort if all attempts fail.
 */
export function atomicRenameSync(
  tmpPath: string,
  targetPath: string,
  platform: NodeJS.Platform = process.platform,
  cleanupSourceOnError = true,
): void {
  const retryDelays = platform === 'win32' ? [10, 20, 40, 60, 80] : [];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      fs.renameSync(tmpPath, targetPath);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException)?.code ?? '';
      if (attempt < retryDelays.length && RETRYABLE_WIN_RENAME_CODES.has(code)) {
        syncSleepMs(retryDelays[attempt]);
        continue;
      }
      break;
    }
  }
  if (cleanupSourceOnError) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
  }
  throw lastErr;
}

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

export function parseCliFlag(argv: string[], flag: string): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === flag && i + 1 < argv.length) {
      return argv[i + 1];
    }
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return undefined;
}

export function hasCliFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

export function ensurePrivateDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // ignore on platforms that don't support POSIX mode bits
  }
}

export function atomicWriteJson(filePath: string, data: unknown): void {
  ensurePrivateDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  atomicRenameSync(tmpPath, filePath);
}

export function normalizeHookEvent(rawEvent: unknown, fallback: HookEventName): HookEventName {
  if (
    rawEvent === 'SessionStart' ||
    rawEvent === 'PreToolUse' ||
    rawEvent === 'PostToolUse' ||
    rawEvent === 'PreInvocation' ||
    rawEvent === 'PostInvocation' ||
    rawEvent === 'Stop'
  ) {
    return rawEvent;
  }
  return fallback;
}

function asRecord(val: unknown): Record<string, unknown> | undefined {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  return undefined;
}

export function normalizeHookPayload(
  rawInput: unknown,
  fallbackEvent: HookEventName,
): NormalizedHookPayload {
  const raw = asRecord(rawInput) ?? {};
  const toolCall = asRecord(raw.toolCall) ?? asRecord(raw.tool_call);

  const toolNameCandidate =
    toolCall?.name ?? raw.toolName ?? raw.tool_name ?? raw.name ?? undefined;
  const toolName = typeof toolNameCandidate === 'string' ? toolNameCandidate : undefined;

  const toolInputRaw =
    toolCall?.args ??
    toolCall?.arguments ??
    toolCall?.input ??
    raw.toolInput ??
    raw.tool_input ??
    raw.arguments ??
    raw.input;
  let toolInput: Record<string, unknown> | undefined;
  if (typeof toolInputRaw === 'string') {
    try {
      toolInput = asRecord(JSON.parse(toolInputRaw));
    } catch {
      toolInput = { raw: toolInputRaw };
    }
  } else {
    toolInput = asRecord(toolInputRaw);
  }

  const workspacePaths: string[] = [];
  if (Array.isArray(raw.workspacePaths)) {
    for (const p of raw.workspacePaths) {
      if (typeof p === 'string' && p.trim()) workspacePaths.push(p);
    }
  }
  if (Array.isArray(raw.workspace_paths)) {
    for (const p of raw.workspace_paths) {
      if (typeof p === 'string' && p.trim() && !workspacePaths.includes(p)) {
        workspacePaths.push(p);
      }
    }
  }
  const singleWorkspace =
    (typeof raw.workspaceRoot === 'string' && raw.workspaceRoot) ||
    (typeof raw.workspace_root === 'string' && raw.workspace_root) ||
    (typeof raw.cwd === 'string' && raw.cwd) ||
    workspacePaths[0];
  if (singleWorkspace && !workspacePaths.includes(singleWorkspace)) {
    workspacePaths.unshift(singleWorkspace);
  }

  const event = normalizeHookEvent(raw.hookEventName ?? raw.hook_event_name ?? raw.event, fallbackEvent);
  const conversationId =
    (typeof raw.conversationId === 'string' && raw.conversationId) ||
    (typeof raw.conversation_id === 'string' && raw.conversation_id) ||
    undefined;
  const parentConversationId =
    (typeof raw.parentConversationId === 'string' && raw.parentConversationId) ||
    (typeof raw.parent_conversation_id === 'string' && raw.parent_conversation_id) ||
    (typeof raw.rootConversationId === 'string' && raw.rootConversationId) ||
    (typeof raw.root_conversation_id === 'string' && raw.root_conversation_id) ||
    (typeof process.env.ANTIGRAVITY_PARENT_CONVERSATION_ID === 'string' &&
    process.env.ANTIGRAVITY_PARENT_CONVERSATION_ID.trim()
      ? process.env.ANTIGRAVITY_PARENT_CONVERSATION_ID.trim()
      : undefined);
  const agentRole =
    (typeof raw.agentRole === 'string' && raw.agentRole) ||
    (typeof raw.agent_role === 'string' && raw.agent_role) ||
    (typeof raw.subagentRole === 'string' && raw.subagentRole) ||
    (typeof raw.subagent_role === 'string' && raw.subagent_role) ||
    undefined;
  const continuationActive =
    typeof raw.continuationActive === 'boolean'
      ? raw.continuationActive
      : typeof raw.continuation_active === 'boolean'
        ? raw.continuation_active
        : undefined;
  const transcriptPath =
    (typeof raw.transcriptPath === 'string' && raw.transcriptPath) ||
    (typeof raw.transcript_path === 'string' && raw.transcript_path) ||
    undefined;
  const lastUserInput =
    (typeof raw.lastUserInput === 'string' && raw.lastUserInput) ||
    (typeof raw.last_user_input === 'string' && raw.last_user_input) ||
    undefined;
  const terminationReason =
    (typeof raw.terminationReason === 'string' && raw.terminationReason) ||
    (typeof raw.termination_reason === 'string' && raw.termination_reason) ||
    undefined;
  const pluginData =
    (typeof raw.pluginData === 'string' && raw.pluginData) ||
    (typeof raw.plugin_data === 'string' && raw.plugin_data) ||
    undefined;
  const toolCallId =
    (typeof toolCall?.id === 'string' && toolCall.id) ||
    (typeof raw.toolCallId === 'string' && raw.toolCallId) ||
    undefined;
  const stepIdx =
    typeof raw.stepIdx === 'number'
      ? raw.stepIdx
      : typeof raw.step_idx === 'number'
        ? raw.step_idx
        : undefined;

  return {
    event,
    conversationId,
    parentConversationId,
    agentRole,
    continuationActive,
    workspacePaths,
    workspaceRoot: singleWorkspace,
    cwd: typeof raw.cwd === 'string' ? raw.cwd : singleWorkspace,
    transcriptPath,
    lastUserInput,
    terminationReason,
    error: raw.error,
    stepIdx,
    toolCallId,
    toolName,
    toolInput,
    pluginData,
    raw,
  };
}
