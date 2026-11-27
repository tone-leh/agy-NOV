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
  redactText,
} from './config.js';
import type { RemoteConfig, RuntimeInfo } from './types.js';

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
      return redactText(val).slice(0, 260);
    }
  }
  return redactText(fallbackText).slice(0, 260);
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
