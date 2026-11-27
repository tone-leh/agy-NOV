import { redactFeedText } from './feed.js';
import { redactSecretsLinear } from './sanitize.js';

export const CONVERSATION_SERVICE_DEFAULT_TIMEOUT_MS = 4_000;
export const CONVERSATION_SERVICE_MAX_TIMEOUT_MS = 4_000;
export const NON_LOOPBACK_ADDRESS_REASON = 'non-loopback or invalid address' as const;

export interface ConversationRecord {
  id: string;
  title: string;
  summary: string;
  runState: 'RUN_STATE_IDLE' | 'RUN_STATE_RUNNING' | 'RUN_STATE_CANCELLING' | string;
  updateTime: string;
  tags: string[];
  pinned: boolean;
  starred: boolean;
  archived: boolean;
}

export interface ConversationServiceOptions {
  lsAddress?: string;
  csrfToken?: string;
  projectId?: string;
  conversationId?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ConversationServiceAvailability {
  available: boolean;
  reason?: string;
  lsAddress?: string;
  projectId?: string;
  conversationId?: string;
}

export interface ListConversationsResult {
  ok: boolean;
  live: boolean;
  available: boolean;
  conversations: ConversationRecord[];
  nextPageToken?: string;
  reason?: string;
  error?: string;
}

export interface GetConversationResult {
  ok: boolean;
  live: boolean;
  available: boolean;
  conversation: ConversationRecord | null;
  reason?: string;
  error?: string;
}

export interface CreateConversationInput {
  title?: string;
  prompt: string;
  model?: 'flash_lite' | 'flash' | 'pro';
  tags?: string[];
  projectId?: string;
}

export interface CreateConversationResult {
  ok: boolean;
  live: boolean;
  available: boolean;
  conversation: ConversationRecord | null;
  reason?: string;
  error?: string;
}

export type LoopbackAddressValidationResult =
  | { valid: true; normalizedAddress: string }
  | { valid: false; reason: string };

const LOOPBACK_LOCALHOST_RE = /^localhost:([1-9]\d{0,4})$/i;
const LOOPBACK_IPV4_RE = /^127\.0\.0\.1:([1-9]\d{0,4})$/;
const LOOPBACK_IPV6_RE = /^\[::1\]:([1-9]\d{0,4})$/;

/**
 * Strict SSRF guard for Antigravity Language Server Connect endpoints (`ANTIGRAVITY_LS_ADDRESS`).
 * Accepts ONLY bare loopback `host:port` forms (`localhost:<port>`, `127.0.0.1:<port>`, `[::1]:<port>`)
 * with port in `1..65535`. Rejects schemes, paths, userinfo (`@`), queries, fragments, control chars,
 * non-loopback IPs, and external hostnames.
 */
export function validateLoopbackLsAddress(
  raw: string | undefined,
): LoopbackAddressValidationResult {
  if (typeof raw !== 'string' || /[\r\n\x00-\x1f\x7f]/.test(raw)) {
    return { valid: false, reason: NON_LOOPBACK_ADDRESS_REASON };
  }
  const trimmed = raw.trim();
  if (
    !trimmed ||
    trimmed.includes('://') ||
    /[\s/@\\?#\x00-\x1f\x7f]/.test(trimmed)
  ) {
    return { valid: false, reason: NON_LOOPBACK_ADDRESS_REASON };
  }

  let normalizedHost: 'localhost' | '127.0.0.1' | '[::1]' | null = null;
  let portStr = '';

  const localhostMatch = LOOPBACK_LOCALHOST_RE.exec(trimmed);
  if (localhostMatch) {
    normalizedHost = 'localhost';
    portStr = localhostMatch[1] ?? '';
  } else {
    const ipv4Match = LOOPBACK_IPV4_RE.exec(trimmed);
    if (ipv4Match) {
      normalizedHost = '127.0.0.1';
      portStr = ipv4Match[1] ?? '';
    } else {
      const ipv6Match = LOOPBACK_IPV6_RE.exec(trimmed);
      if (ipv6Match) {
        normalizedHost = '[::1]';
        portStr = ipv6Match[1] ?? '';
      }
    }
  }

  if (!normalizedHost || !portStr) {
    return { valid: false, reason: NON_LOOPBACK_ADDRESS_REASON };
  }

  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { valid: false, reason: NON_LOOPBACK_ADDRESS_REASON };
  }

  const normalizedAddress = `${normalizedHost}:${port}`;

  // Defense-in-depth: confirm URL parser agrees on loopback host, port, and empty credentials
  try {
    const parsed = new URL(`http://${normalizedAddress}/product.v1.ConversationService/Ping`);
    const parsedHost = parsed.hostname.toLowerCase();
    const hostOk =
      (normalizedHost === 'localhost' && parsedHost === 'localhost') ||
      (normalizedHost === '127.0.0.1' && parsedHost === '127.0.0.1') ||
      (normalizedHost === '[::1]' && (parsedHost === '[::1]' || parsedHost === '::1'));
    const effectivePort = parsed.port || '80';
    if (
      !hostOk ||
      effectivePort !== String(port) ||
      parsed.username !== '' ||
      parsed.password !== ''
    ) {
      return { valid: false, reason: NON_LOOPBACK_ADDRESS_REASON };
    }
  } catch {
    return { valid: false, reason: NON_LOOPBACK_ADDRESS_REASON };
  }

  return { valid: true, normalizedAddress };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/**
 * Normalizes and redacts every string field of a raw ConversationService conversation payload
 * via `redactFeedText` so private keys, API keys, webhooks, and `<private>` blocks never leak.
 */
export function normalizeConversationRecord(raw: unknown): ConversationRecord {
  const obj = asRecord(raw) ?? {};
  const annotations = asRecord(obj.annotations);
  const state = asRecord(obj.state);

  const rawId = typeof obj.id === 'string' ? obj.id : '';
  const id = redactFeedText(rawId, 120) || 'unknown';

  const rawSummary =
    typeof state?.summary === 'string'
      ? state.summary
      : typeof obj.summary === 'string'
        ? obj.summary
        : '';
  const summary = redactFeedText(rawSummary, 240);

  const rawTitle =
    typeof annotations?.title === 'string'
      ? annotations.title
      : typeof obj.title === 'string'
        ? obj.title
        : '';
  const cleanTitle = redactFeedText(rawTitle, 140);
  const title = cleanTitle || redactFeedText(summary, 140) || `Conversation ${id.slice(0, 8)}`;

  const rawRunState =
    typeof state?.runState === 'string'
      ? state.runState
      : typeof obj.runState === 'string'
        ? obj.runState
        : '';
  const runState = redactFeedText(rawRunState, 64) || 'RUN_STATE_IDLE';

  const rawUpdateTime =
    typeof state?.updateTime === 'string'
      ? state.updateTime
      : typeof obj.updateTime === 'string'
        ? obj.updateTime
        : '';
  const cleanUpdateTime = redactFeedText(rawUpdateTime, 40);
  const updateTime =
    cleanUpdateTime && Number.isFinite(Date.parse(cleanUpdateTime))
      ? cleanUpdateTime
      : new Date().toISOString();

  const rawTags = Array.isArray(annotations?.tags)
    ? annotations.tags
    : Array.isArray(obj.tags)
      ? obj.tags
      : [];
  const tags = Array.from(
    new Set(
      rawTags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => redactFeedText(t, 48))
        .filter(Boolean),
    ),
  ).slice(0, 20);

  return {
    id,
    title,
    summary,
    runState,
    updateTime,
    tags,
    pinned: Boolean(annotations?.pinned ?? obj.pinned),
    starred: Boolean(annotations?.starred ?? obj.starred),
    archived: Boolean(annotations?.archived ?? obj.archived),
  };
}

interface ResolvedConnection {
  availability: ConversationServiceAvailability;
  csrfToken?: string;
}

function resolveConnection(opts: ConversationServiceOptions = {}): ResolvedConnection {
  const env = opts.env ?? process.env;
  const rawAddress = opts.lsAddress !== undefined ? opts.lsAddress : env.ANTIGRAVITY_LS_ADDRESS;
  const rawCsrf = opts.csrfToken !== undefined ? opts.csrfToken : env.ANTIGRAVITY_CSRF_TOKEN;
  const rawProjectId =
    opts.projectId !== undefined ? opts.projectId : env.ANTIGRAVITY_PROJECT_ID;
  const rawConversationId =
    opts.conversationId !== undefined ? opts.conversationId : env.ANTIGRAVITY_CONVERSATION_ID;

  if (typeof rawAddress !== 'string' || !rawAddress.trim()) {
    return {
      availability: {
        available: false,
        reason: 'ANTIGRAVITY_LS_ADDRESS not configured',
      },
    };
  }

  const addrCheck = validateLoopbackLsAddress(rawAddress);
  if (!addrCheck.valid) {
    return {
      availability: {
        available: false,
        reason: NON_LOOPBACK_ADDRESS_REASON,
      },
    };
  }

  if (typeof rawCsrf !== 'string' || !rawCsrf.trim()) {
    return {
      availability: {
        available: false,
        reason: 'ANTIGRAVITY_CSRF_TOKEN not configured',
      },
    };
  }

  if (/[\r\n\x00]/.test(rawCsrf)) {
    return {
      availability: {
        available: false,
        reason: 'invalid ANTIGRAVITY_CSRF_TOKEN',
      },
    };
  }

  const projectId =
    typeof rawProjectId === 'string' && rawProjectId.trim()
      ? redactFeedText(rawProjectId.trim(), 128) || undefined
      : undefined;
  const conversationId =
    typeof rawConversationId === 'string' && rawConversationId.trim()
      ? redactFeedText(rawConversationId.trim(), 128) || undefined
      : undefined;

  return {
    availability: {
      available: true,
      lsAddress: addrCheck.normalizedAddress,
      ...(projectId ? { projectId } : {}),
      ...(conversationId ? { conversationId } : {}),
    },
    csrfToken: rawCsrf,
  };
}

/**
 * Checks whether local loopback `ConversationService` credentials and address are valid
 * without issuing any network call. Never echoes `csrfToken`.
 */
export function isConversationServiceConfigured(
  opts: ConversationServiceOptions = {},
): ConversationServiceAvailability {
  return resolveConnection(opts).availability;
}

function resolveTimeoutMs(raw?: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return CONVERSATION_SERVICE_DEFAULT_TIMEOUT_MS;
  }
  return Math.max(100, Math.min(CONVERSATION_SERVICE_MAX_TIMEOUT_MS, Math.floor(raw)));
}

function sanitizeErrorMessage(err: unknown, csrfToken?: string): string {
  let safe = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  if (csrfToken) {
    const trimmed = csrfToken.trim();
    if (trimmed && safe.includes(trimmed)) {
      safe = safe.split(trimmed).join('[REDACTED_CSRF]');
    }
    if (safe.includes(csrfToken)) {
      safe = safe.split(csrfToken).join('[REDACTED_CSRF]');
    }
  }
  return redactFeedText(safe, 200) || 'ConversationService request failed';
}

type ConnectRpcResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; available: boolean; reason: string };

async function invokeConversationServiceRpc(
  opts: ConversationServiceOptions,
  method: 'ListConversations' | 'GetConversation' | 'CreateConversation',
  body: Record<string, unknown>,
): Promise<ConnectRpcResult> {
  const { availability, csrfToken } = resolveConnection(opts);
  if (!availability.available || !availability.lsAddress || !csrfToken) {
    return {
      ok: false,
      available: false,
      reason: availability.reason ?? NON_LOOPBACK_ADDRESS_REASON,
    };
  }

  // Re-verify loopback invariant right before network dispatch
  const addrCheck = validateLoopbackLsAddress(availability.lsAddress);
  if (!addrCheck.valid) {
    return {
      ok: false,
      available: false,
      reason: NON_LOOPBACK_ADDRESS_REASON,
    };
  }

  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return {
      ok: false,
      available: false,
      reason: 'fetch API unavailable in runtime',
    };
  }

  const timeoutMs = resolveTimeoutMs(opts.timeoutMs);
  const url = `http://${addrCheck.normalizedAddress}/product.v1.ConversationService/${method}`;

  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-antigravity-csrf-token': csrfToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return {
      ok: false,
      available: false,
      reason: sanitizeErrorMessage(err, csrfToken),
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      available: false,
      reason: `ConversationService/${method} failed: HTTP ${res.status}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    return {
      ok: false,
      available: false,
      reason: `Invalid JSON response from ConversationService/${method}: ${sanitizeErrorMessage(err, csrfToken)}`,
    };
  }

  const data = asRecord(parsed);
  if (!data) {
    return {
      ok: false,
      available: false,
      reason: `Unexpected payload from ConversationService/${method}`,
    };
  }

  return { ok: true, data };
}

/**
 * Read-only listing of host conversations via `product.v1.ConversationService/ListConversations`.
 * Strictly enforces loopback-only addressing, timeout <= 4000ms, full output redaction,
 * and graceful error return without throwing uncaught exceptions.
 */
export async function listHostConversationsReadOnly(
  opts: ConversationServiceOptions = {},
  pageSize = 20,
): Promise<ListConversationsResult> {
  const safePageSize = Number.isFinite(pageSize)
    ? Math.max(1, Math.min(100, Math.floor(pageSize)))
    : 20;

  const rpc = await invokeConversationServiceRpc(opts, 'ListConversations', {
    pageSize: safePageSize,
    includeArchived: false,
  });

  if (!rpc.ok) {
    return {
      ok: false,
      live: false,
      available: rpc.available,
      conversations: [],
      reason: rpc.reason,
      error: rpc.reason,
    };
  }

  const rawList = Array.isArray(rpc.data.conversations) ? rpc.data.conversations : [];
  const conversations = rawList.map((item) => normalizeConversationRecord(item));
  const nextPageToken =
    typeof rpc.data.nextPageToken === 'string' && rpc.data.nextPageToken.trim()
      ? redactFeedText(rpc.data.nextPageToken.trim(), 256)
      : undefined;

  return {
    ok: true,
    live: true,
    available: true,
    conversations,
    ...(nextPageToken ? { nextPageToken } : {}),
  };
}

/**
 * Read-only fetch of a single host conversation via `product.v1.ConversationService/GetConversation`.
 */
export async function getHostConversationReadOnly(
  opts: ConversationServiceOptions = {},
  conversationId: string,
): Promise<GetConversationResult> {
  const cleanId = typeof conversationId === 'string' ? conversationId.trim() : '';
  if (!cleanId || /[\r\n\x00/\\]/.test(cleanId) || cleanId.length > 128) {
    const availability = isConversationServiceConfigured(opts);
    return {
      ok: false,
      live: false,
      available: availability.available,
      conversation: null,
      reason: 'invalid conversationId',
      error: 'invalid conversationId',
    };
  }

  const rpc = await invokeConversationServiceRpc(opts, 'GetConversation', {
    conversationId: cleanId,
  });

  if (!rpc.ok) {
    return {
      ok: false,
      live: false,
      available: rpc.available,
      conversation: null,
      reason: rpc.reason,
      error: rpc.reason,
    };
  }

  const rawConv =
    asRecord(rpc.data.conversation) ??
    (typeof rpc.data.id === 'string' ? rpc.data : null);

  if (!rawConv) {
    return {
      ok: false,
      live: false,
      available: true,
      conversation: null,
      reason: 'conversation not found in response',
      error: 'conversation not found in response',
    };
  }

  return {
    ok: true,
    live: true,
    available: true,
    conversation: normalizeConversationRecord(rawConv),
  };
}

/**
 * Creates a fresh host conversation via `product.v1.ConversationService/CreateConversation`.
 * Automatically redacts `title` and `prompt` (including `<private>` blocks and secrets) before
 * sending over the local loopback channel, and never echoes `csrfToken` in errors.
 */
export async function createHostConversation(
  opts: ConversationServiceOptions = {},
  input: CreateConversationInput,
): Promise<CreateConversationResult> {
  const { availability } = resolveConnection(opts);
  if (!availability.available) {
    const reason = availability.reason ?? NON_LOOPBACK_ADDRESS_REASON;
    return {
      ok: false,
      live: false,
      available: false,
      conversation: null,
      reason,
      error: reason,
    };
  }

  const rawPrompt = typeof input?.prompt === 'string' ? input.prompt : '';
  const sanitizedPrompt = redactSecretsLinear(rawPrompt, {
    stripPrivate: true,
    privateReplacement: '[REDACTED_PRIVATE]',
  }).trim();

  if (!sanitizedPrompt) {
    return {
      ok: false,
      live: false,
      available: true,
      conversation: null,
      reason: 'prompt is required',
      error: 'prompt is required',
    };
  }

  const rawTitle = typeof input?.title === 'string' ? input.title : '';
  const sanitizedTitle = rawTitle.trim()
    ? redactSecretsLinear(rawTitle, {
        stripPrivate: true,
        privateReplacement: '[REDACTED_PRIVATE]',
      })
        .replace(/[\r\n\t\x00-\x1f]+/g, ' ')
        .trim()
        .slice(0, 140)
    : undefined;

  const model: 'flash_lite' | 'flash' | 'pro' =
    input.model === 'flash_lite' || input.model === 'pro' ? input.model : 'flash';

  const rawTags = Array.isArray(input.tags) ? input.tags : [];
  const tags = Array.from(
    new Set(
      rawTags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => redactFeedText(t, 48))
        .filter(Boolean),
    ),
  ).slice(0, 20);

  const projectId =
    (typeof input.projectId === 'string' && input.projectId.trim()
      ? redactFeedText(input.projectId.trim(), 128)
      : undefined) ?? availability.projectId;

  const payload: Record<string, unknown> = {
    ...(sanitizedTitle ? { title: sanitizedTitle } : {}),
    model,
    tags,
    prompt: [{ text: sanitizedPrompt }],
    ...(projectId ? { projectId } : {}),
  };

  const rpc = await invokeConversationServiceRpc(opts, 'CreateConversation', payload);
  if (!rpc.ok) {
    return {
      ok: false,
      live: false,
      available: rpc.available,
      conversation: null,
      reason: rpc.reason,
      error: rpc.reason,
    };
  }

  const rawConv =
    asRecord(rpc.data.conversation) ??
    (typeof rpc.data.id === 'string' ? rpc.data : {});

  return {
    ok: true,
    live: true,
    available: true,
    conversation: normalizeConversationRecord(rawConv),
  };
}
