import fs from 'node:fs';
import path from 'node:path';
import {
  getModuleDataDir,
  loadNovConfigReadOnly,
  resolveNovDataDir,
} from '../../core/config.js';
import type { NormalizedHookPayload } from '../../core/types.js';
import {
  loadConfigReadOnly,
  matchRiskPattern,
  matchSensitivePath,
  readRuntimeInfo,
} from './config.js';
import { redactLiveStreamText } from './live-stream.js';
import type {
  ApprovalRiskCard,
  ApprovalRiskLevel,
  ApprovalVerifyStatus,
  RemoteConfig,
  RuntimeInfo,
} from './types.js';

export const MAX_RISK_TARGET_SUMMARY_CHARS = 120;
export const MAX_RISK_COMMAND_PREVIEW_CHARS = 160;
export const MAX_RISK_VERIFY_SUMMARY_CHARS = 120;
const MAX_VERIFY_STATE_BYTES = 2 * 1024 * 1024;

const COMMAND_TOOL_RE = /(?:^|[_-])(?:run_command|command|shell|bash|zsh|sh|exec|terminal)(?:$|[_-])/i;
const DELETE_TOOL_RE = /(?:^|[_-])(?:delete|remove|rm|unlink)(?:$|[_-])/i;

const HIGH_RISK_COMMAND_PATTERNS: readonly RegExp[] = [
  /\brm\s+(?:-[a-zA-Z]*(?:r[a-zA-Z]*f|f[a-zA-Z]*r)|-[a-zA-Z]*r\b[^;&|\r\n]{0,80}-[a-zA-Z]*f\b)/i,
  /\bgit\s+push\b[^\r\n]{0,160}(?:--force(?:-with-lease)?|\s-f\b)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bsudo\b/i,
  /\b(?:drop|truncate)\s+(?:table|database|schema)\b/i,
  /\b(?:curl|wget)\b[^\r\n]{0,240}\|\s*(?:(?:ba|z|da)?sh|python3?|node|perl|ruby)\b/i,
  /\bchmod\s+(?:-R\s+)?777\b/i,
  /\bmkfs\.[a-z0-9]+|\bdd\s+if=/i,
  /\b(?:shutdown|reboot|poweroff|halt)\b/i,
];

const FILE_MUTATION_TOOLS = new Set([
  'delete_file',
  'write_file',
  'edit_file',
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
]);

const PATH_LIKE_KEYS = new Set([
  'path',
  'file_path',
  'filepath',
  'target_file',
  'targetfile',
  'target_path',
  'targetpath',
  'absolutepath',
  'absolute_path',
  'filename',
  'file',
  'files',
  'paths',
  'uri',
]);

const NESTED_FILE_CONTAINER_KEYS = new Set([
  'edits',
  'changes',
  'operations',
  'items',
  'targets',
]);

export interface BuildApprovalRiskCardParams {
  toolName: string;
  toolInput?: Record<string, unknown> | string;
  summary?: string;
  matchedRule?: string;
  rootDataDir?: string;
  affectedFiles?: string[];
}

function normalizeToolArgs(raw: unknown): { obj: Record<string, unknown>; text: string } {
  if (raw === undefined || raw === null) {
    return { obj: {}, text: '{}' };
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { obj: parsed as Record<string, unknown>, text: JSON.stringify(parsed) };
        }
      } catch {
        // Keep raw string when not valid JSON
      }
    }
    return { obj: { raw: trimmed }, text: trimmed };
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { obj: raw as Record<string, unknown>, text: JSON.stringify(raw) };
  }
  return { obj: {}, text: JSON.stringify(raw) };
}

function collectCandidatePaths(value: unknown, depth = 0): string[] {
  if (depth > 5 || value === null || value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) out.push(...collectCandidatePaths(item, depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const prioritized: string[] = [];
    const fallback: string[] = [];
    for (const [k, v] of Object.entries(record)) {
      const extracted = collectCandidatePaths(v, depth + 1);
      if (PATH_LIKE_KEYS.has(k.toLowerCase())) {
        prioritized.push(...extracted);
      } else {
        fallback.push(...extracted);
      }
    }
    return prioritized.length > 0 ? prioritized : fallback;
  }
  return [];
}

function extractSummary(obj: Record<string, unknown>, fallbackText: string): string {
  const candidates = [
    obj.CommandLine,
    obj.command,
    obj.cmd,
    obj.file_path,
    obj.filePath,
    obj.TargetFile,
    obj.target_file,
    obj.path,
    obj.Path,
    obj.AbsolutePath,
  ];
  for (const val of candidates) {
    if (typeof val === 'string' && val.trim()) {
      return redactLiveStreamText(val).slice(0, 260);
    }
  }
  return redactLiveStreamText(fallbackText).slice(0, 260);
}

function collapseBoundedText(raw: string, maxChars: number): string {
  const cleaned = redactLiveStreamText(raw).replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function extractStrictAffectedPaths(value: unknown, depth = 0, insidePathKey = false): string[] {
  if (depth > 5 || value === null || value === undefined) return [];
  if (typeof value === 'string') {
    if (!insidePathKey) return [];
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      out.push(...extractStrictAffectedPaths(item, depth + 1, insidePathKey));
    }
    return out;
  }
  if (typeof value === 'object') {
    const out: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (PATH_LIKE_KEYS.has(lower)) {
        out.push(...extractStrictAffectedPaths(v, depth + 1, true));
      } else if (NESTED_FILE_CONTAINER_KEYS.has(lower) || insidePathKey) {
        out.push(...extractStrictAffectedPaths(v, depth + 1, false));
      }
    }
    return out;
  }
  return [];
}

function extractCommandText(toolName: string, obj: Record<string, unknown>, summary?: string): string | undefined {
  const rawCandidates = [obj.CommandLine, obj.commandLine, obj.command, obj.cmd, obj.script];
  for (const val of rawCandidates) {
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
  }
  if (COMMAND_TOOL_RE.test(toolName) && typeof summary === 'string' && summary.trim()) {
    return summary.trim();
  }
  return undefined;
}

function hasHighRiskCommandSignature(text: string): boolean {
  if (!text) return false;
  for (const re of HIGH_RISK_COMMAND_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

function textMentionsSensitivePath(text: string): boolean {
  if (!text) return false;
  if (matchSensitivePath(text)) return true;
  const tokens = text.split(/[\s"'`=;,()[\]{}]+/).filter(Boolean);
  for (const tok of tokens) {
    if (matchSensitivePath(tok)) return true;
  }
  return false;
}

function readVerifyStatusReadOnly(rootDataDir?: string): {
  verifyStatus: ApprovalVerifyStatus;
  verifySummary?: string;
} {
  if (!rootDataDir || !rootDataDir.trim()) {
    return { verifyStatus: 'unknown' };
  }
  const statePath = path.join(getModuleDataDir(rootDataDir, 'verify'), 'state.json');
  try {
    const st = fs.lstatSync(statePath);
    if (st.isSymbolicLink() || !st.isFile() || st.size <= 0 || st.size > MAX_VERIFY_STATE_BYTES) {
      return { verifyStatus: 'unknown' };
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { verifyStatus: 'unknown' };
    }
    const rec = parsed as Record<string, unknown>;
    const evidenceRaw = Array.isArray(rec.evidence) ? rec.evidence : [];
    let latest: Record<string, unknown> | null = null;
    let latestTs = -Infinity;
    for (const item of evidenceRaw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const entry = item as Record<string, unknown>;
      const rawTs =
        typeof entry.timestamp === 'string' && entry.timestamp.trim()
          ? entry.timestamp.trim()
          : typeof entry.createdAt === 'string' && entry.createdAt.trim()
            ? entry.createdAt.trim()
            : '';
      const tsMs = rawTs ? Date.parse(rawTs) : Number.NaN;
      const score = Number.isFinite(tsMs) ? tsMs : -Infinity;
      if (!latest || score > latestTs) {
        latest = entry;
        latestTs = score;
      }
    }
    if (!latest) {
      return { verifyStatus: 'idle' };
    }
    const outcome = typeof latest.outcome === 'string' ? latest.outcome.toLowerCase() : '';
    let verifyStatus: ApprovalVerifyStatus;
    if (outcome === 'blocked' || latest.blocked === true) {
      verifyStatus = 'blocked';
    } else if (outcome === 'pass' || outcome === 'guardrail-allow' || latest.passed === true) {
      verifyStatus = 'pass';
    } else {
      verifyStatus = 'fail';
    }
    const verifySummary =
      typeof latest.summary === 'string' && latest.summary.trim()
        ? collapseBoundedText(latest.summary, MAX_RISK_VERIFY_SUMMARY_CHARS)
        : undefined;
    return {
      verifyStatus,
      ...(verifySummary ? { verifySummary } : {}),
    };
  } catch {
    return { verifyStatus: 'unknown' };
  }
}

/**
 * Pure deterministic risk-card builder for Remote 2.5 approvals.
 * Performs strictly read-only inspection of verify/state.json (zero mkdir / zero disk writes)
 * and linear O(n) secret redaction on all summaries and command previews.
 */
export function buildApprovalRiskCard(params: BuildApprovalRiskCardParams): ApprovalRiskCard {
  const toolName = (params.toolName || 'unknown').trim() || 'unknown';
  const normalized = normalizeToolArgs(params.toolInput);
  const rawPaths = [
    ...(Array.isArray(params.affectedFiles)
      ? params.affectedFiles.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : []),
    ...extractStrictAffectedPaths(normalized.obj),
  ];

  // If a file mutation tool was called without structured toolInput (e.g. gateway fallback), use summary when path-like
  if (
    rawPaths.length === 0 &&
    FILE_MUTATION_TOOLS.has(toolName.toLowerCase()) &&
    typeof params.summary === 'string' &&
    params.summary.trim() &&
    !/\s/.test(params.summary.trim())
  ) {
    rawPaths.push(params.summary.trim());
  }

  const uniquePaths = Array.from(new Set(rawPaths.map((p) => p.trim()).filter(Boolean)));
  const affectedFilesCount = uniquePaths.length;

  const commandRaw = extractCommandText(toolName, normalized.obj, params.summary);
  const commandPreview = commandRaw
    ? collapseBoundedText(commandRaw, MAX_RISK_COMMAND_PREVIEW_CHARS)
    : undefined;

  const matchedRule = (params.matchedRule ?? '').trim();
  const isSensitiveTarget =
    matchedRule.toLowerCase().startsWith('sensitive_path:') ||
    uniquePaths.some((p) => Boolean(matchSensitivePath(p))) ||
    textMentionsSensitivePath(commandRaw ?? '') ||
    textMentionsSensitivePath(params.summary ?? '');

  const isHighRiskCmd =
    hasHighRiskCommandSignature(commandRaw ?? '') ||
    hasHighRiskCommandSignature(params.summary ?? '') ||
    hasHighRiskCommandSignature(matchedRule);

  const isCommandTool = COMMAND_TOOL_RE.test(toolName) || Boolean(commandRaw);
  const isDeleteTool = DELETE_TOOL_RE.test(toolName);

  let riskLevel: ApprovalRiskLevel;
  if (isHighRiskCmd || isSensitiveTarget || (isDeleteTool && affectedFilesCount > 1)) {
    riskLevel = 'high';
  } else if (isCommandTool || affectedFilesCount >= 2 || isDeleteTool) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }

  let rawTargetSummary = '';
  if (uniquePaths.length > 0) {
    const first = uniquePaths[0];
    rawTargetSummary =
      uniquePaths.length > 1 ? `${first} (+${uniquePaths.length - 1} more)` : first;
  } else if (commandRaw) {
    rawTargetSummary = commandRaw;
  } else if (params.summary && params.summary.trim()) {
    rawTargetSummary = params.summary.trim();
  } else {
    rawTargetSummary = toolName;
  }

  const targetSummary = collapseBoundedText(rawTargetSummary, MAX_RISK_TARGET_SUMMARY_CHARS);
  const { verifyStatus, verifySummary } = readVerifyStatusReadOnly(params.rootDataDir);

  return {
    riskLevel,
    affectedFilesCount,
    targetSummary,
    ...(commandPreview ? { commandPreview } : {}),
    verifyStatus,
    ...(verifySummary ? { verifySummary } : {}),
  };
}

/**
 * Pure read-only guard: both `NovConfig.modules.remote` and remote's own persisted `gatewayEnabled`
 * must be strictly `true`. When either is off or missing, returns `null` immediately without creating
 * files, probing ports, or performing network I/O.
 */
function loadEnabledRemoteStateReadOnly(
  rootDataDir: string,
): { config: RemoteConfig; runtime: RuntimeInfo | null } | null {
  const resolvedRoot = resolveNovDataDir(rootDataDir);
  const novConfig = loadNovConfigReadOnly(resolvedRoot);
  if (!novConfig.modules.remote) {
    return null;
  }

  const remoteDataDir = getModuleDataDir(resolvedRoot, 'remote');
  const { config, persisted } = loadConfigReadOnly(remoteDataDir);
  if (!persisted || config.gatewayEnabled !== true) {
    return null;
  }

  return {
    config,
    runtime: readRuntimeInfo(remoteDataDir),
  };
}

export async function handleRemotePreToolHook(
  payload: NormalizedHookPayload,
  rootDataDir: string,
): Promise<{ decision?: 'allow' | 'ask' | 'deny'; reason?: string }> {
  const active = loadEnabledRemoteStateReadOnly(rootDataDir);
  if (!active) {
    return {};
  }

  const { config, runtime } = active;
  const toolName = payload.toolName ?? 'unknown';
  const { obj: toolArgsObj, text: rawArgsText } = normalizeToolArgs(payload.toolInput ?? {});

  let matched = matchRiskPattern(rawArgsText, config.riskPatterns);
  if (!matched && FILE_MUTATION_TOOLS.has(toolName.toLowerCase())) {
    const candidatePaths = collectCandidatePaths(toolArgsObj);
    for (const candidate of candidatePaths) {
      const hit = matchSensitivePath(candidate);
      if (hit) {
        matched = hit;
        break;
      }
    }
  }

  if (!matched) {
    return {};
  }

  const summary = extractSummary(toolArgsObj, rawArgsText);
  const riskCard = buildApprovalRiskCard({
    toolName,
    toolInput: toolArgsObj,
    summary,
    matchedRule: matched,
    rootDataDir,
  });

  if (!config.remoteApprovalEnabled) {
    return {
      decision: 'ask',
      reason: `Agy Remote risk policy matched (${matched}); prompting locally.`,
    };
  }

  // Never blindly probe default ports when runtime.json is absent.
  if (!runtime) {
    return {
      decision: 'ask',
      reason: `Risky operation matched (${matched}) while remote gateway is offline; confirming locally.`,
    };
  }

  try {
    const waitMs = Math.max(2_000, Math.min(25_000, config.approvalTimeoutSec * 1000));
    const res = await fetch(`${runtime.url}/api/hooks/approval`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.pairingToken}`,
      },
      body: JSON.stringify({
        conversationId: payload.conversationId ?? 'unknown',
        toolName,
        summary,
        matchedRule: matched,
        riskCard,
        timeoutSec: config.approvalTimeoutSec,
        waitMs,
      }),
      signal: AbortSignal.timeout(waitMs + 1_500),
    });

    if (res.ok) {
      const data = (await res.json()) as { approval?: { status?: string; decidedBy?: string } };
      const st = data.approval?.status;
      if (st === 'approved') {
        return {
          decision: 'allow',
          reason: `Approved remotely via Agy Remote (${data.approval?.decidedBy ?? 'mobile'}).`,
        };
      }
      if (st === 'denied') {
        return {
          decision: 'deny',
          reason: `Denied remotely via Agy Remote (${data.approval?.decidedBy ?? 'mobile'}).`,
        };
      }
    }
  } catch {
    // Gateway unreachable or timed out: fail safe to local ask without outbound fallback
  }

  return {
    decision: 'ask',
    reason: `Risky operation matched (${matched}) and no remote decision arrived; confirming locally.`,
  };
}

export async function handleRemoteStopHook(
  payload: NormalizedHookPayload,
  rootDataDir: string,
): Promise<void> {
  const active = loadEnabledRemoteStateReadOnly(rootDataDir);
  if (!active) {
    return;
  }

  const { config, runtime } = active;
  if (!config.notifyOnStop) {
    return;
  }

  // Never probe default ports or fall back to direct outbound broadcastChannels() when gateway is offline.
  if (!runtime) {
    return;
  }

  const terminationReason = payload.terminationReason ?? 'NO_TOOL_CALL';
  const lastUserInput = payload.lastUserInput ?? '';
  try {
    await fetch(`${runtime.url}/api/hooks/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.pairingToken}`,
      },
      body: JSON.stringify({
        conversationId: payload.conversationId ?? 'unknown',
        terminationReason,
        lastUserInput,
        error: typeof payload.error === 'string' ? payload.error : '',
      }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // Gateway unreachable: never fall back to direct IM broadcast
  }
}
