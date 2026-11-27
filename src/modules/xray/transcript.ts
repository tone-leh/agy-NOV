import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  estimateTokenCostUsd,
  formatUsd,
  roundUsd,
  type PricingOverrideMap,
} from './pricing.js';
import { redactSecrets } from './sanitize.js';
import type {
  ArtifactSummary,
  ContextCompositionBucket,
  FileActivityItem,
  FileOp,
  ModelCostBreakdownItem,
  SessionDetail,
  SessionSummary,
  SwarmChildMetrics,
  SwarmLineageSummary,
  ToolHotspot,
  TurnMetric,
} from './types.js';

interface RawTranscriptStep {
  step_index?: number;
  source?: string;
  type?: string;
  status?: string;
  created_at?: string;
  model?: string;
  input_tokens?: number;
  cache_read_tokens?: number;
  output_tokens?: number;
  thinking?: string;
  content?: string;
  error?: unknown;
  conversationId?: string;
  conversation_id?: string;
  childConversationId?: string;
  child_conversation_id?: string;
  metadata?: Record<string, unknown>;
  truncated_fields?: string[];
  tool_calls?: Array<{
    name?: string;
    tool_name?: string;
    args?: Record<string, unknown>;
  }>;
}

const READ_TOOLS = new Set([
  'read_file',
  'view_file',
  'view_file_outline',
  'view_code_item',
  'read_resource',
  'grep_search',
  'find_by_name',
  'list_dir',
]);

const EDIT_TOOLS = new Set([
  'edit_file',
  'replace_file_content',
  'multi_replace_file_content',
  'apply_patch',
]);

const WRITE_TOOLS = new Set([
  'write_file',
  'write_to_file',
  'create_file',
]);

const FILE_ARG_KEYS = [
  'Path',
  'path',
  'AbsolutePath',
  'TargetFile',
  'file_path',
  'filePath',
  'uri',
  'Uri',
  'DirectoryPath',
];

function unwrapArgString(raw: unknown): string {
  if (typeof raw !== 'string') {
    if (raw == null) return '';
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function cleanUserRequest(raw: string): string {
  const match = raw.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  const body = match ? match[1] : raw;
  return body.replace(/\s+/g, ' ').trim();
}

function toSafeFileUri(filePath: string): string {
  if (filePath.startsWith('file://')) return filePath;
  try {
    return pathToFileURL(path.resolve(filePath)).href;
  } catch {
    return `file://${filePath}`;
  }
}

function classifyToolFileOp(toolName: string): FileOp | null {
  const lower = toolName.toLowerCase();
  if (WRITE_TOOLS.has(lower)) return 'write';
  if (EDIT_TOOLS.has(lower)) return 'edit';
  if (READ_TOOLS.has(lower)) return 'read';
  return null;
}

function extractFilePathsFromArgs(args: Record<string, unknown> | undefined): string[] {
  if (!args) return [];
  const results: string[] = [];
  for (const key of FILE_ARG_KEYS) {
    if (key in args && args[key] != null) {
      const val = unwrapArgString(args[key]);
      if (val && (val.startsWith('/') || /^[A-Za-z]:\\/.test(val) || val.startsWith('file://'))) {
        results.push(val.replace(/^file:\/\//, ''));
      }
    }
  }
  return results;
}

function listArtifactsInBrainDir(brainDir: string): ArtifactSummary[] {
  if (!brainDir || !fs.existsSync(brainDir)) return [];
  const artifacts: ArtifactSummary[] = [];
  try {
    for (const entry of fs.readdirSync(brainDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(md|txt|json|html|svg)$/i.test(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(brainDir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath, 'utf8').slice(0, 800);
        artifacts.push({
          name: entry.name,
          path: fullPath,
          uri: toSafeFileUri(fullPath),
          sizeBytes: stat.size,
          updatedAt: stat.mtime.toISOString(),
          preview: redactSecrets(content.replace(/\r\n/g, '\n').trim()),
        });
      } catch {
        // ignore unreadable files
      }
    }
  } catch {
    // ignore unreadable directory
  }
  return artifacts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const MAX_LINKED_SUBAGENTS = 24;
const CHILD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;
const UUID_RE = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;
const LABELED_CONV_ID_RE =
  /["']?(?:child[_-]?conversation[_-]?id|subagent[_-]?conversation[_-]?id|conversation[_-]?id|session[_-]?id|subagent[_-]?id)["']?\s*[:=]\s*["'`]?([A-Za-z0-9][A-Za-z0-9._-]{1,127})["'`]?/i;
const BRAIN_PATH_ID_RE =
  /brain[\\/]([A-Za-z0-9][A-Za-z0-9._-]{1,127})[\\/](?:\.system_generated[\\/]logs[\\/])?transcript\.jsonl/i;
const RETRY_SIGNAL_RE =
  /\b(?:429|RESOURCE_EXHAUSTED|rate[\s_-]*limit(?:ed|ing)?|quota(?:\s+exceeded)?|too\s+many\s+requests|retry(?:ing|able)?|backoff)\b/i;

const ACTIVE_STEP_STATUSES = new Set([
  'RUNNING',
  'WAITING',
  'PENDING',
  'IN_PROGRESS',
  'ACTIVE',
  'AWAITING_APPROVAL',
  'EXECUTING',
]);
const DONE_STEP_STATUSES = new Set(['DONE', 'COMPLETED', 'FINISHED', 'STOPPED']);
const DONE_STEP_TYPES = new Set(['DONE', 'STOP', 'COMPLETED', 'SESSION_END', 'TASK_COMPLETE']);

interface SubagentDraft {
  conversationId?: string;
  role: string;
  typeName: string;
  model: string;
  explicitModel: boolean;
  stepIndex: number;
  timestamp: string;
  plannerContent: string;
}

interface ChildTranscriptStats {
  turns: number;
  totalInputTokens: number;
  totalCacheReadTokens: number;
  totalOutputTokens: number;
  cacheHitRate: number;
  lastModel?: string;
  completed: boolean;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSafeChildId(candidate: string | undefined, parentSessionId: string): candidate is string {
  if (!candidate) return false;
  const trimmed = candidate.trim();
  if (!trimmed || trimmed === parentSessionId) return false;
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) return false;
  return CHILD_ID_RE.test(trimmed);
}

function pickFirstArgString(args: Record<string, unknown> | undefined, keys: string[]): string {
  if (!args) return '';
  for (const key of keys) {
    if (key in args && args[key] != null) {
      const val = unwrapArgString(args[key]);
      if (val) return val;
    }
  }
  return '';
}

function isSubagentToolCall(toolName: string, args: Record<string, unknown> | undefined): boolean {
  const lower = toolName.toLowerCase();
  if (lower === 'invoke_subagent' || lower.endsWith(':invoke_subagent')) {
    return true;
  }
  if (lower === 'swarm' || lower.endsWith(':swarm')) {
    const action = pickFirstArgString(args, ['action', 'Action']).toLowerCase();
    return action === 'add';
  }
  return false;
}

function listSiblingBrainDirs(siblingBrainRoot: string | undefined, parentSessionId: string): string[] {
  if (!siblingBrainRoot || !fs.existsSync(siblingBrainRoot)) return [];
  try {
    const entries = fs.readdirSync(siblingBrainRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && isSafeChildId(entry.name, parentSessionId))
      .map((entry) => entry.name)
      .sort((a, b) => b.length - a.length);
  } catch {
    return [];
  }
}

function extractChildIdFromObject(
  obj: Record<string, unknown> | undefined,
  parentSessionId: string,
  allowGenericId: boolean,
): string | undefined {
  if (!obj) return undefined;
  const keys = [
    'childConversationId',
    'child_conversation_id',
    'subagentConversationId',
    'subagent_conversation_id',
    'conversationId',
    'conversation_id',
    'ConversationId',
    'sessionId',
    'session_id',
    'SessionId',
    'targetConversationId',
    'target_conversation_id',
    'subagentId',
    'subagent_id',
    ...(allowGenericId ? ['id', 'Id', 'ID'] : []),
  ];
  for (const key of keys) {
    if (key in obj && obj[key] != null) {
      const val = unwrapArgString(obj[key]);
      if (isSafeChildId(val, parentSessionId)) {
        return val;
      }
    }
  }
  return undefined;
}

function extractChildIdFromText(
  text: string,
  parentSessionId: string,
  siblingDirNames: string[],
  usedIds: Set<string>,
): string | undefined {
  if (!text) return undefined;

  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const fromJson = extractChildIdFromObject(
          parsed as Record<string, unknown>,
          parentSessionId,
          true,
        );
        if (fromJson && !usedIds.has(fromJson)) return fromJson;
      }
    } catch {
      // fall through to regex matchers
    }
  }

  for (const re of [LABELED_CONV_ID_RE, BRAIN_PATH_ID_RE, UUID_RE]) {
    const match = text.match(re);
    if (match?.[1] && isSafeChildId(match[1], parentSessionId) && !usedIds.has(match[1])) {
      return match[1];
    }
  }

  for (const dirName of siblingDirNames) {
    if (usedIds.has(dirName)) continue;
    if (!text.includes(dirName)) continue;
    const boundaryRe = new RegExp(`(?:^|[^A-Za-z0-9_-])${escapeRegExp(dirName)}(?:$|[^A-Za-z0-9_-])`);
    if (boundaryRe.test(text)) {
      return dirName;
    }
  }

  return undefined;
}

function extractChildIdFromStep(
  step: RawTranscriptStep,
  parentSessionId: string,
  siblingDirNames: string[],
  usedIds: Set<string>,
): string | undefined {
  const fromStepFields =
    extractChildIdFromObject(
      {
        childConversationId: step.childConversationId,
        child_conversation_id: step.child_conversation_id,
        conversationId: step.conversationId,
        conversation_id: step.conversation_id,
      },
      parentSessionId,
      false,
    ) ?? extractChildIdFromObject(step.metadata, parentSessionId, true);

  if (fromStepFields && !usedIds.has(fromStepFields)) {
    return fromStepFields;
  }

  const content = typeof step.content === 'string' ? step.content : '';
  return extractChildIdFromText(content, parentSessionId, siblingDirNames, usedIds);
}

function resolveChildTranscriptPath(siblingBrainRoot: string, childId: string): string | null {
  if (!siblingBrainRoot || !fs.existsSync(siblingBrainRoot)) return null;
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(siblingBrainRoot);
  } catch {
    return null;
  }

  const candidates = [
    path.join(siblingBrainRoot, childId, '.system_generated', 'logs', 'transcript.jsonl'),
    path.join(siblingBrainRoot, childId, 'transcript.jsonl'),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const realCandidate = fs.realpathSync(candidate);
      if (realCandidate !== realRoot && !realCandidate.startsWith(`${realRoot}${path.sep}`)) {
        continue;
      }
      const stat = fs.statSync(realCandidate);
      if (!stat.isFile()) continue;
      return realCandidate;
    } catch {
      // ignore unreadable or escaping candidate
    }
  }

  return null;
}

function isStepCompletedTerminal(step: RawTranscriptStep | undefined): boolean {
  if (!step) return false;
  const status = typeof step.status === 'string' ? step.status.trim().toUpperCase() : '';
  const type = typeof step.type === 'string' ? step.type.trim().toUpperCase() : '';
  const source = typeof step.source === 'string' ? step.source.trim().toUpperCase() : '';
  const hasPendingToolCalls =
    type === 'PLANNER_RESPONSE' && Array.isArray(step.tool_calls) && step.tool_calls.length > 0;

  if (hasPendingToolCalls) return false;
  if (ACTIVE_STEP_STATUSES.has(status)) return false;
  if (type === 'USER_INPUT' || source === 'TOOL' || type === 'TOOL_RESULT' || type === 'GENERIC') {
    return false;
  }
  if (DONE_STEP_STATUSES.has(status)) return true;
  if (DONE_STEP_TYPES.has(type)) return true;
  return false;
}

function isParentSessionStopped(steps: RawTranscriptStep[]): boolean {
  if (steps.length === 0) return false;
  const last = steps[steps.length - 1];
  const status = typeof last.status === 'string' ? last.status.trim().toUpperCase() : '';
  const type = typeof last.type === 'string' ? last.type.trim().toUpperCase() : '';
  const hasPendingToolCalls =
    type === 'PLANNER_RESPONSE' && Array.isArray(last.tool_calls) && last.tool_calls.length > 0;

  if (ACTIVE_STEP_STATUSES.has(status)) return false;
  if (hasPendingToolCalls || type === 'USER_INPUT') return false;
  if (DONE_STEP_STATUSES.has(status) || DONE_STEP_TYPES.has(type)) return true;
  if (type === 'PLANNER_RESPONSE') return true;
  return false;
}

const MAX_CHILD_TRANSCRIPT_BYTES = 20 * 1024 * 1024;

function readChildTranscriptStats(transcriptPath: string): ChildTranscriptStats | null {
  let rawText: string;
  try {
    const st = fs.statSync(transcriptPath);
    if (!st.isFile() || st.size > MAX_CHILD_TRANSCRIPT_BYTES) {
      return null;
    }
    rawText = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  let turns = 0;
  let totalInputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalOutputTokens = 0;
  let lastModel: string | undefined;
  let lastStep: RawTranscriptStep | undefined;

  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let step: RawTranscriptStep;
    try {
      step = JSON.parse(trimmed) as RawTranscriptStep;
    } catch {
      continue;
    }
    lastStep = step;
    if (step.model) {
      lastModel = step.model;
    }
    if (step.type === 'PLANNER_RESPONSE') {
      turns += 1;
      const rawIn = Math.max(0, Number(step.input_tokens ?? 0));
      const rawCache = Math.max(0, Number(step.cache_read_tokens ?? 0));
      const rawOut = Math.max(0, Number(step.output_tokens ?? 0));
      totalInputTokens += rawIn + rawCache;
      totalCacheReadTokens += rawCache;
      totalOutputTokens += rawOut;
    }
  }

  const cacheHitRate = totalInputTokens > 0 ? totalCacheReadTokens / totalInputTokens : 0;
  return {
    turns,
    totalInputTokens,
    totalCacheReadTokens,
    totalOutputTokens,
    cacheHitRate,
    lastModel,
    completed: isStepCompletedTerminal(lastStep),
  };
}

function formatStepErrorText(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function hasRetrySignalInStep(step: RawTranscriptStep): boolean {
  if (step.type === 'USER_INPUT') return false;
  const parts = [
    typeof step.content === 'string' ? step.content : '',
    typeof step.thinking === 'string' ? step.thinking : '',
    typeof step.status === 'string' ? step.status : '',
    formatStepErrorText(step.error),
  ];
  return parts.some((part) => Boolean(part) && RETRY_SIGNAL_RE.test(part));
}

export function parseTranscriptFile(
  transcriptPath: string,
  opts: {
    sessionId?: string;
    source?: SessionSummary['source'];
    brainDir?: string;
    siblingBrainRoot?: string;
    pricingOverrides?: PricingOverrideMap;
  } = {},
): SessionDetail {
  const rawText = fs.readFileSync(transcriptPath, 'utf8');
  return parseTranscriptLines(rawText.split(/\r?\n/), {
    transcriptPath,
    brainDir: opts.brainDir ?? path.resolve(path.dirname(transcriptPath), '..', '..'),
    sessionId: opts.sessionId ?? path.basename(path.resolve(path.dirname(transcriptPath), '..', '..')),
    source: opts.source ?? 'desktop',
    siblingBrainRoot: opts.siblingBrainRoot,
    pricingOverrides: opts.pricingOverrides,
  });
}

export function parseTranscriptLines(
  lines: string[],
  meta: {
    transcriptPath: string;
    brainDir: string;
    sessionId: string;
    source: SessionSummary['source'];
    siblingBrainRoot?: string;
    pricingOverrides?: PricingOverrideMap;
  },
): SessionDetail {
  const steps: RawTranscriptStep[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      steps.push(JSON.parse(trimmed) as RawTranscriptStep);
    } catch {
      // skip partial/corrupt JSONL line cleanly
    }
  }

  let firstPrompt = '';
  let startedAt = '';
  let updatedAt = '';
  let lastModel = 'unknown';

  const turns: TurnMetric[] = [];
  const toolStats = new Map<
    string,
    { calls: number; totalOutputBytes: number; truncatedCount: number }
  >();
  const fileMap = new Map<string, FileActivityItem>();
  const modelStats = new Map<
    string,
    {
      turns: number;
      inputTokens: number;
      cacheReadTokens: number;
      freshInputTokens: number;
      outputTokens: number;
      retrySignals: number;
    }
  >();

  const ensureModelStat = (modelName: string) => {
    const key = modelName || 'unknown';
    let entry = modelStats.get(key);
    if (!entry) {
      entry = {
        turns: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        freshInputTokens: 0,
        outputTokens: 0,
        retrySignals: 0,
      };
      modelStats.set(key, entry);
    }
    return entry;
  };

  let totalInputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalFreshInputTokens = 0;
  let totalOutputTokens = 0;
  let peakContextTokens = 0;
  let totalToolCalls = 0;
  let totalThinkingChars = 0;
  let earlyRetrySignals = 0;

  let pendingTools: Array<{ name: string; subagentDraft?: SubagentDraft }> = [];
  let pendingTurnIdx = -1;
  let latestUserPrompt = '';

  const siblingDirNames = listSiblingBrainDirs(meta.siblingBrainRoot, meta.sessionId);
  const subagentDrafts: SubagentDraft[] = [];
  const usedChildIds = new Set<string>();

  const recentSteps: SessionDetail['recentSteps'] = [];

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const stepIndex = typeof s.step_index === 'number' ? s.step_index : i;
    const timestamp = s.created_at ?? '';
    if (timestamp) {
      if (!startedAt) startedAt = timestamp;
      updatedAt = timestamp;
    }

    const type = s.type ?? 'UNKNOWN';
    const source = s.source ?? 'UNKNOWN';
    const content = typeof s.content === 'string' ? s.content : '';
    const truncated = Array.isArray(s.truncated_fields) && s.truncated_fields.length > 0;

    if (type === 'USER_INPUT') {
      const cleaned = cleanUserRequest(content);
      if (!firstPrompt && cleaned) firstPrompt = redactSecrets(cleaned);
      if (cleaned) latestUserPrompt = cleaned;
      pendingTools = [];
      pendingTurnIdx = -1;
      recentSteps.push({
        stepIndex,
        type,
        source,
        timestamp,
        toolNames: [],
        preview: redactSecrets(cleaned).slice(0, 180),
        bytes: Buffer.byteLength(content, 'utf8'),
        truncated,
      });
      continue;
    }

    if (type === 'PLANNER_RESPONSE') {
      const model = s.model ?? lastModel;
      if (s.model) lastModel = s.model;

      const rawIn = Number(s.input_tokens ?? 0);
      const rawCache = Number(s.cache_read_tokens ?? 0);
      const rawOut = Number(s.output_tokens ?? 0);

      const freshInput = Math.max(0, rawIn);
      const effectiveInput = freshInput + Math.max(0, rawCache);
      const cacheHitRate = effectiveInput > 0 ? rawCache / effectiveInput : 0;

      totalInputTokens += effectiveInput;
      totalCacheReadTokens += rawCache;
      totalFreshInputTokens += freshInput;
      totalOutputTokens += rawOut;
      if (effectiveInput > peakContextTokens) peakContextTokens = effectiveInput;

      const mStat = ensureModelStat(model);
      mStat.turns += 1;
      mStat.inputTokens += effectiveInput;
      mStat.cacheReadTokens += Math.max(0, rawCache);
      mStat.freshInputTokens += freshInput;
      mStat.outputTokens += Math.max(0, rawOut);
      if (hasRetrySignalInStep(s)) {
        mStat.retrySignals += 1;
      }

      const thinkingChars = typeof s.thinking === 'string' ? s.thinking.length : 0;
      totalThinkingChars += thinkingChars;

      const toolCalls = Array.isArray(s.tool_calls) ? s.tool_calls : [];
      const toolNames: string[] = [];
      pendingTools = [];

      for (const tc of toolCalls) {
        const name = tc.name ?? tc.tool_name ?? 'unknown_tool';
        toolNames.push(name);
        totalToolCalls += 1;

        let subagentDraft: SubagentDraft | undefined;
        if (isSubagentToolCall(name, tc.args)) {
          const explicitRole = pickFirstArgString(tc.args, [
            'Role',
            'role',
            'AgentRole',
            'agentRole',
            'agent_role',
            'subagentRole',
            'subagent_role',
          ]);
          const explicitType = pickFirstArgString(tc.args, [
            'TypeName',
            'typeName',
            'type_name',
            'Name',
            'name',
            'AgentName',
            'agentName',
            'AgentType',
            'agentType',
          ]);
          const explicitModel = pickFirstArgString(tc.args, [
            'Model',
            'model',
            'ModelName',
            'modelName',
            'model_name',
          ]);
          const childIdFromArgs = extractChildIdFromObject(
            tc.args,
            meta.sessionId,
            name.toLowerCase().endsWith('swarm'),
          );
          if (childIdFromArgs) {
            usedChildIds.add(childIdFromArgs);
          }

          subagentDraft = {
            conversationId: childIdFromArgs,
            role: explicitRole || explicitType || 'subagent',
            typeName: explicitType || explicitRole || name,
            model: explicitModel || model || 'unknown',
            explicitModel: Boolean(explicitModel),
            stepIndex,
            timestamp,
            plannerContent: content,
          };
          subagentDrafts.push(subagentDraft);
        }

        pendingTools.push({ name, subagentDraft });

        const existing = toolStats.get(name) ?? {
          calls: 0,
          totalOutputBytes: 0,
          truncatedCount: 0,
        };
        existing.calls += 1;
        toolStats.set(name, existing);

        const op = classifyToolFileOp(name);
        if (op) {
          for (const fp of extractFilePathsFromArgs(tc.args)) {
            const normalized = path.resolve(fp);
            const cur = fileMap.get(normalized) ?? {
              path: normalized,
              basename: path.basename(normalized),
              dir: path.dirname(normalized),
              uri: toSafeFileUri(normalized),
              ops: [],
              readCount: 0,
              editCount: 0,
              writeCount: 0,
              totalTouches: 0,
              lastStepIndex: stepIndex,
              lastTimestamp: timestamp,
            };
            if (!cur.ops.includes(op)) cur.ops.push(op);
            if (op === 'read') cur.readCount += 1;
            if (op === 'edit') cur.editCount += 1;
            if (op === 'write') cur.writeCount += 1;
            cur.totalTouches += 1;
            cur.lastStepIndex = stepIndex;
            cur.lastTimestamp = timestamp;
            fileMap.set(normalized, cur);
          }
        }
      }

      const turnMetric: TurnMetric = {
        turnIndex: turns.length + 1,
        stepIndex,
        timestamp,
        model,
        inputTokens: effectiveInput,
        cacheReadTokens: rawCache,
        freshInputTokens: freshInput,
        outputTokens: rawOut,
        thinkingChars,
        toolCallsCount: toolCalls.length,
        toolOutputBytes: 0,
        cacheHitRate,
        userPromptPreview: latestUserPrompt ? redactSecrets(latestUserPrompt).slice(0, 120) : undefined,
      };
      latestUserPrompt = '';
      turns.push(turnMetric);
      pendingTurnIdx = turns.length - 1;

      recentSteps.push({
        stepIndex,
        type,
        source,
        timestamp,
        model,
        inputTokens: effectiveInput,
        cacheReadTokens: rawCache,
        outputTokens: rawOut,
        toolNames,
        preview: redactSecrets(content || (s.thinking ? `[thinking] ${s.thinking}` : toolNames.join(', '))).slice(0, 180),
        bytes: Buffer.byteLength(content, 'utf8'),
        truncated,
      });
      continue;
    }

    if (hasRetrySignalInStep(s)) {
      const targetModel =
        s.model ??
        (pendingTurnIdx >= 0 ? turns[pendingTurnIdx]?.model : undefined) ??
        (lastModel !== 'unknown' ? lastModel : undefined);
      if (targetModel) {
        ensureModelStat(targetModel).retrySignals += 1;
      } else {
        earlyRetrySignals += 1;
      }
    }

    const bytes = Buffer.byteLength(content, 'utf8');
    const pendingTool = pendingTools.shift();
    const attributedTool = pendingTool?.name;
    if (pendingTool?.subagentDraft && !pendingTool.subagentDraft.conversationId) {
      const matchedId = extractChildIdFromStep(s, meta.sessionId, siblingDirNames, usedChildIds);
      if (matchedId) {
        pendingTool.subagentDraft.conversationId = matchedId;
        usedChildIds.add(matchedId);
      }
    }
    if (attributedTool) {
      const stat = toolStats.get(attributedTool);
      if (stat) {
        stat.totalOutputBytes += bytes;
        if (truncated) stat.truncatedCount += 1;
      }
      if (pendingTurnIdx >= 0 && turns[pendingTurnIdx]) {
        turns[pendingTurnIdx].toolOutputBytes += bytes;
      }
    }

    recentSteps.push({
      stepIndex,
      type,
      source,
      timestamp,
      toolNames: attributedTool ? [attributedTool] : [],
      preview: redactSecrets(content.replace(/\s+/g, ' ').trim()).slice(0, 180),
      bytes,
      truncated,
    });
  }

  if (earlyRetrySignals > 0) {
    const fallbackModel = turns[0]?.model ?? 'unknown';
    ensureModelStat(fallbackModel).retrySignals += earlyRetrySignals;
  }

  // Fallback child ID matching from the planner step content if no tool output bound an ID
  for (const draft of subagentDrafts) {
    if (!draft.conversationId && draft.plannerContent) {
      const fallbackId = extractChildIdFromText(
        draft.plannerContent,
        meta.sessionId,
        siblingDirNames,
        usedChildIds,
      );
      if (fallbackId) {
        draft.conversationId = fallbackId;
        usedChildIds.add(fallbackId);
      }
    }
  }

  // Resolve up to MAX_LINKED_SUBAGENTS sibling child transcripts (strictly 1 level deep, read-only)
  const parentStopped = isParentSessionStopped(steps);
  const childStatsCache = new Map<string, ChildTranscriptStats | null>();
  let parsedChildFiles = 0;

  const swarmChildren: SwarmChildMetrics[] = subagentDrafts.map((draft) => {
    let stats: ChildTranscriptStats | null = null;
    if (draft.conversationId && meta.siblingBrainRoot) {
      if (childStatsCache.has(draft.conversationId)) {
        stats = childStatsCache.get(draft.conversationId) ?? null;
      } else if (parsedChildFiles < MAX_LINKED_SUBAGENTS) {
        const childTranscriptPath = resolveChildTranscriptPath(
          meta.siblingBrainRoot,
          draft.conversationId,
        );
        if (childTranscriptPath) {
          parsedChildFiles += 1;
          stats = readChildTranscriptStats(childTranscriptPath);
        }
        childStatsCache.set(draft.conversationId, stats);
      }
    }

    const transcriptFound = stats !== null;
    const statusHint: SwarmChildMetrics['statusHint'] =
      stats === null
        ? 'unknown'
        : stats.completed
          ? 'completed'
          : parentStopped
            ? 'orphan_suspect'
            : 'active';

    const resolvedModel =
      draft.explicitModel || !stats?.lastModel ? draft.model : stats.lastModel;

    return {
      conversationId: draft.conversationId,
      role: draft.role,
      typeName: draft.typeName,
      model: resolvedModel,
      stepIndex: draft.stepIndex,
      timestamp: draft.timestamp,
      transcriptFound,
      totalInputTokens: stats?.totalInputTokens ?? 0,
      totalCacheReadTokens: stats?.totalCacheReadTokens ?? 0,
      totalOutputTokens: stats?.totalOutputTokens ?? 0,
      cacheHitRate: stats?.cacheHitRate ?? 0,
      turns: stats?.turns ?? 0,
      statusHint,
    };
  });

  const swarmLineage: SwarmLineageSummary = {
    totalSubagents: swarmChildren.length,
    linkedTranscripts: swarmChildren.filter((c) => c.transcriptFound).length,
    orphanSuspects: swarmChildren.filter((c) => c.statusHint === 'orphan_suspect').length,
    totalSubagentInputTokens: swarmChildren.reduce((sum, c) => sum + c.totalInputTokens, 0),
    totalSubagentOutputTokens: swarmChildren.reduce((sum, c) => sum + c.totalOutputTokens, 0),
    children: swarmChildren,
  };

  const totalModelCombinedTokens = Array.from(modelStats.values()).reduce(
    (sum, m) => sum + m.inputTokens + m.outputTokens,
    0,
  );
  const totalModelTurns = Array.from(modelStats.values()).reduce((sum, m) => sum + m.turns, 0);

  let sessionEstimatedUsdRaw = 0;
  let sessionCacheSavingsUsdRaw = 0;

  const modelBreakdown: ModelCostBreakdownItem[] = Array.from(modelStats.entries())
    .map(([model, stat]) => {
      const combined = stat.inputTokens + stat.outputTokens;
      const sharePercent =
        totalModelCombinedTokens > 0
          ? Number(((combined / totalModelCombinedTokens) * 100).toFixed(1))
          : totalModelTurns > 0
            ? Number(((stat.turns / totalModelTurns) * 100).toFixed(1))
            : 0;
      const cost = estimateTokenCostUsd(
        model,
        {
          freshInputTokens: stat.freshInputTokens,
          cacheReadTokens: stat.cacheReadTokens,
          outputTokens: stat.outputTokens,
        },
        meta.pricingOverrides,
      );
      sessionEstimatedUsdRaw += cost.totalUsd;
      sessionCacheSavingsUsdRaw += cost.cacheSavingsUsd;
      return {
        model,
        turns: stat.turns,
        inputTokens: stat.inputTokens,
        cacheReadTokens: stat.cacheReadTokens,
        freshInputTokens: stat.freshInputTokens,
        outputTokens: stat.outputTokens,
        cacheHitRate: stat.inputTokens > 0 ? stat.cacheReadTokens / stat.inputTokens : 0,
        retrySignals: stat.retrySignals,
        sharePercent,
        estimatedUsd: cost.totalUsd,
      };
    })
    .sort(
      (a, b) =>
        b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens) ||
        b.turns - a.turns ||
        a.model.localeCompare(b.model),
    );

  if (modelBreakdown.length === 0 && totalInputTokens + totalOutputTokens > 0) {
    const fallbackCost = estimateTokenCostUsd(
      lastModel,
      {
        freshInputTokens: totalFreshInputTokens,
        cacheReadTokens: totalCacheReadTokens,
        outputTokens: totalOutputTokens,
      },
      meta.pricingOverrides,
    );
    sessionEstimatedUsdRaw = fallbackCost.totalUsd;
    sessionCacheSavingsUsdRaw = fallbackCost.cacheSavingsUsd;
  }

  const estimatedUsd = roundUsd(sessionEstimatedUsdRaw);
  const cacheSavingsUsd = roundUsd(sessionCacheSavingsUsdRaw);

  const totalToolBytes = Array.from(toolStats.values()).reduce((sum, v) => sum + v.totalOutputBytes, 0);
  const toolHotspots: ToolHotspot[] = Array.from(toolStats.entries())
    .map(([toolName, stat]) => ({
      toolName,
      calls: stat.calls,
      totalOutputBytes: stat.totalOutputBytes,
      avgOutputBytes: stat.calls > 0 ? Math.round(stat.totalOutputBytes / stat.calls) : 0,
      estimatedTokens: Math.round(stat.totalOutputBytes / 4),
      truncatedCount: stat.truncatedCount,
      sharePercent:
        totalToolBytes > 0 ? Number(((stat.totalOutputBytes / totalToolBytes) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.totalOutputBytes - a.totalOutputBytes || b.calls - a.calls);

  const fileActivity = Array.from(fileMap.values()).sort(
    (a, b) => b.editCount + b.writeCount - (a.editCount + a.writeCount) || b.totalTouches - a.totalTouches,
  );

  const artifacts = listArtifactsInBrainDir(meta.brainDir);

  const estToolTokens = Math.min(totalFreshInputTokens, Math.round(totalToolBytes / 4));
  const netFreshTokens = Math.max(0, totalFreshInputTokens - estToolTokens);
  const estThinkingTokens = Math.round(totalThinkingChars / 4);
  const compTotal =
    totalCacheReadTokens + netFreshTokens + estToolTokens + totalOutputTokens + estThinkingTokens;

  const pct = (n: number) => (compTotal > 0 ? Number(((n / compTotal) * 100).toFixed(1)) : 0);

  const allBuckets: ContextCompositionBucket[] = [
    {
      key: 'cached_prefix',
      label: 'Cached Prefix',
      tokens: totalCacheReadTokens,
      sharePercent: pct(totalCacheReadTokens),
    },
    {
      key: 'fresh_input',
      label: 'Fresh Context Input',
      tokens: netFreshTokens,
      sharePercent: pct(netFreshTokens),
    },
    {
      key: 'tool_outputs_est',
      label: 'Tool Output Payload (est.)',
      tokens: estToolTokens,
      sharePercent: pct(estToolTokens),
    },
    {
      key: 'thinking_est',
      label: 'Reasoning / Thinking (est.)',
      tokens: estThinkingTokens,
      sharePercent: pct(estThinkingTokens),
    },
    {
      key: 'assistant_output',
      label: 'Model Output',
      tokens: totalOutputTokens,
      sharePercent: pct(totalOutputTokens),
    },
  ];
  const composition = allBuckets.filter((b) => b.tokens > 0);

  const overallCacheHit = totalInputTokens > 0 ? totalCacheReadTokens / totalInputTokens : 0;

  const diagnostics: SessionDetail['diagnostics'] = [];
  if (turns.length >= 2) {
    if (overallCacheHit >= 0.65) {
      diagnostics.push({
        severity: 'good',
        title: `Healthy Prefix Cache (${(overallCacheHit * 100).toFixed(1)}%)`,
        detail: `${formatCompactTokens(totalCacheReadTokens)} of ${formatCompactTokens(totalInputTokens)} input tokens served from prompt cache across ${turns.length} turns.`,
      });
    } else {
      diagnostics.push({
        severity: 'warn',
        title: `Low Prefix Cache Hit (${(overallCacheHit * 100).toFixed(1)}%)`,
        detail: `Only ${formatCompactTokens(totalCacheReadTokens)} input tokens reused cache. Avoid mid-session config churn or huge unbatched tool bursts.`,
      });
    }
  }

  const topVampire = toolHotspots[0];
  if (topVampire && topVampire.totalOutputBytes > 8_000) {
    diagnostics.push({
      severity: topVampire.truncatedCount > 0 || topVampire.sharePercent > 40 ? 'warn' : 'info',
      title: `Top Token Consumer: ${topVampire.toolName} (${topVampire.sharePercent}%)`,
      detail: `${topVampire.calls} calls returned ${(topVampire.totalOutputBytes / 1024).toFixed(1)} KB (~${formatCompactTokens(topVampire.estimatedTokens)} tokens${topVampire.truncatedCount ? `, ${topVampire.truncatedCount} truncated` : ''}).`,
    });
  }

  for (let t = 1; t < turns.length; t++) {
    const prev = turns[t - 1];
    const curr = turns[t];
    if (prev.cacheHitRate >= 0.5 && prev.cacheHitRate - curr.cacheHitRate >= 0.25) {
      diagnostics.push({
        severity: 'info',
        title: `Cache Dip at Turn ${curr.turnIndex} (-${((prev.cacheHitRate - curr.cacheHitRate) * 100).toFixed(1)}%)`,
        detail: `Prefix cache fell from ${(prev.cacheHitRate * 100).toFixed(1)}% to ${(curr.cacheHitRate * 100).toFixed(1)}% at step #${curr.stepIndex}.`,
      });
      break;
    }
  }

  const totalRetrySignals = modelBreakdown.reduce((sum, item) => sum + item.retrySignals, 0);
  if (totalRetrySignals > 0) {
    const retryModels = modelBreakdown
      .filter((item) => item.retrySignals > 0)
      .map((item) => `${item.model} (${item.retrySignals})`);
    diagnostics.push({
      severity: 'warn',
      title: `Rate-Limit / Retry Signals Detected (${totalRetrySignals})`,
      detail: `Observed ${totalRetrySignals} retry/quota signal(s) on ${retryModels.join(', ')}. Repeated 429 retries can amplify token consumption and break prompt cache continuity.`,
    });
  }

  const activeModels = modelBreakdown.filter((item) => item.turns > 0);
  if (activeModels.length >= 2) {
    let modelSwitches = 0;
    for (let t = 1; t < turns.length; t++) {
      if (turns[t].model !== turns[t - 1].model) {
        modelSwitches += 1;
      }
    }
    diagnostics.push({
      severity: totalRetrySignals > 0 ? 'warn' : 'info',
      title:
        totalRetrySignals > 0
          ? `Mid-Session Model Fallback / Switch (${activeModels.length} models)`
          : `Multi-Model Session (${activeModels.length} models)`,
      detail: `Session switched models ${modelSwitches} time(s) (${activeModels.map((m) => `${m.model}: ${m.sharePercent}%`).join(', ')}). Switching models mid-session resets prompt cache.`,
    });
  }

  if (swarmLineage.orphanSuspects > 0) {
    diagnostics.push({
      severity: 'warn',
      title: `Swarm Orphan Suspects (${swarmLineage.orphanSuspects}/${swarmLineage.totalSubagents})`,
      detail: `${swarmLineage.orphanSuspects} subagent transcript(s) ended without a terminal DONE marker after parent activity stopped. Inspect lingering background subagents.`,
    });
  }

  const title = firstPrompt
    ? firstPrompt.slice(0, 72) + (firstPrompt.length > 72 ? '…' : '')
    : `Session ${meta.sessionId.slice(0, 8)}`;

  const summary: SessionSummary = {
    id: meta.sessionId,
    source: meta.source,
    title,
    firstPrompt: firstPrompt.slice(0, 320),
    startedAt: startedAt || new Date(0).toISOString(),
    updatedAt: updatedAt || startedAt || new Date(0).toISOString(),
    model: lastModel,
    turns: turns.length,
    steps: steps.length,
    totalInputTokens,
    totalCacheReadTokens,
    totalFreshInputTokens,
    totalOutputTokens,
    peakContextTokens,
    cacheHitRate: overallCacheHit,
    toolCallsCount: totalToolCalls,
    filesTouchedCount: fileActivity.length,
    artifactsCount: artifacts.length,
    estimatedUsd,
    cacheSavingsUsd,
    transcriptPath: meta.transcriptPath,
    brainDir: meta.brainDir,
  };

  return {
    summary,
    composition,
    turns,
    toolHotspots,
    fileActivity,
    artifacts,
    recentSteps: recentSteps.slice(-60).reverse(),
    diagnostics,
    swarmLineage,
    modelBreakdown,
  };
}

export function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

export function renderRedactedBrief(detail: SessionDetail): string {
  const s = detail.summary;
  const lines: string[] = [
    `# Session X-Ray Brief: ${redactSecrets(s.title)}`,
    '',
    `- **Session ID**: \`${s.id}\``,
    `- **Model**: \`${s.model}\` | **Turns**: ${s.turns} | **Steps**: ${s.steps}`,
    `- **Input Tokens**: ${formatCompactTokens(s.totalInputTokens)} (Cache Hit: **${(s.cacheHitRate * 100).toFixed(1)}%**, Peak Window: ${formatCompactTokens(s.peakContextTokens)})`,
    `- **Output Tokens**: ${formatCompactTokens(s.totalOutputTokens)} | **Tool Calls**: ${s.toolCallsCount}`,
    ...(s.estimatedUsd != null
      ? [
          `- **Est. Cost (USD)**: ~${formatUsd(s.estimatedUsd)} (Cache Savings: ~${formatUsd(s.cacheSavingsUsd)}, offline ref. pricing)`,
        ]
      : []),
    '',
    '## Context Diagnostics',
    ...detail.diagnostics.map((d) => `- **[${d.severity.toUpperCase()}] ${redactSecrets(d.title)}** — ${redactSecrets(d.detail)}`),
  ];

  if (detail.swarmLineage && detail.swarmLineage.totalSubagents > 0) {
    const sl = detail.swarmLineage;
    lines.push(
      '',
      '## Swarm Lineage',
      `- **Subagents**: ${sl.totalSubagents} (Linked Transcripts: ${sl.linkedTranscripts}, Orphan Suspects: ${sl.orphanSuspects})`,
      `- **Subagent Tokens**: Input ${formatCompactTokens(sl.totalSubagentInputTokens)} | Output ${formatCompactTokens(sl.totalSubagentOutputTokens)}`,
      '| Role | Type | Model | Turns | Input | Output | Status |',
      '| :--- | :--- | :--- | ---: | ---: | ---: | :--- |',
      ...sl.children.slice(0, 12).map(
        (c) =>
          `| ${redactSecrets(c.role)} | \`${redactSecrets(c.typeName)}\` | \`${c.model}\` | ${c.turns} | ${formatCompactTokens(c.totalInputTokens)} | ${formatCompactTokens(c.totalOutputTokens)} | ${c.statusHint} |`,
      ),
    );
  }

  const hasRetrySignals = detail.modelBreakdown?.some((m) => m.retrySignals > 0) ?? false;
  if (detail.modelBreakdown && (detail.modelBreakdown.length > 1 || hasRetrySignals)) {
    lines.push(
      '',
      '## Model Breakdown',
      '| Model | Turns | Input | Cache Hit | Output | Retries | Share |',
      '| :--- | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...detail.modelBreakdown.map(
        (m) =>
          `| \`${m.model}\` | ${m.turns} | ${formatCompactTokens(m.inputTokens)} | ${(m.cacheHitRate * 100).toFixed(1)}% | ${formatCompactTokens(m.outputTokens)} | ${m.retrySignals} | ${m.sharePercent}% |`,
      ),
    );
  }

  lines.push(
    '',
    '## Top Tool Output Consumers',
    '| Tool | Calls | Payload | Est. Tokens | Share |',
    '| :--- | ---: | ---: | ---: | ---: |',
    ...detail.toolHotspots.slice(0, 8).map(
      (t) =>
        `| \`${t.toolName}\` | ${t.calls} | ${(t.totalOutputBytes / 1024).toFixed(1)} KB | ${formatCompactTokens(t.estimatedTokens)} | ${t.sharePercent}% |`,
    ),
    '',
    '## Workspace Files Touched',
    ...(detail.fileActivity.length
      ? detail.fileActivity.slice(0, 20).map(
          (f) => `- \`${f.path}\` (${f.ops.join('/')} · ${f.totalTouches} touches)`,
        )
      : ['- No workspace file operations recorded.']),
    '',
    '## Artifacts',
    ...(detail.artifacts.length
      ? detail.artifacts.map((a) => `- \`${a.name}\` (${(a.sizeBytes / 1024).toFixed(1)} KB)`)
      : ['- No markdown artifacts in brain directory.']),
  );
  return redactSecrets(lines.join('\n'));
}
