import type { HookEventName, NormalizedHookPayload } from './types.js';

export {
  atomicRenameSync,
  atomicWriteJson,
  canonicalRealpathSync,
  ensurePrivateDir,
  hasUnsafeSymlinkAncestor,
  isPathInsideDir,
  isPlatformSystemSymlink,
  isSamePath,
  normalizePathForCompare,
  safeReadJsonReadOnly,
  withFileLockSync,
  type AtomicWriteJsonOptions,
  type FileLockOptions,
} from './fs-safe.js';
export { isPidAlive, resolveSafeSpawnTarget, type ResolvedSafeSpawnTarget } from './process-safe.js';
export {
  discoverUserCustomSkillsReadOnly,
  getDefaultAntigravityBrainDirs,
  getDefaultAntigravitySkillDirs,
  type CustomSkillDiscoverySummary,
  type CustomSkillRootSpec,
  type DiscoveredCustomSkill,
} from './brain-paths.js';
export {
  detectHighConfidenceSecrets,
  isSensitivePathSegment,
  redactPemBlocksLinear,
  redactSecretsLinear,
  stripPrivateBlocksLinear,
  stripPrivateBlocksWithStats,
  type HighConfidenceSecretMatch,
  type RedactTextOptions,
  type StripPrivateResult,
} from './sanitize.js';

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
