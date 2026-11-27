import { redactStudioSecrets } from './sources.js';

// ============================================================================
// Constants & Public Types
// ============================================================================

export const STUDIO_HTTP_MAX_BODY_BYTES = 64 * 1024; // 64 KiB cap for HTTP probe response body
export const STUDIO_HTTP_MIN_TIMEOUT_MS = 1000;
export const STUDIO_HTTP_MAX_TIMEOUT_MS = 15000;
export const STUDIO_HTTP_DEFAULT_TIMEOUT_MS = 5000;

export const ALLOWED_HTTP_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

const ALLOWED_LOOPBACK_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '[::1]',
  '::1',
]);

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'www-authenticate',
  'proxy-authenticate',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-secret-key',
  'x-session-token',
  'private-token',
]);

const SENSITIVE_HEADER_SUBSTRINGS = [
  'authorization',
  'auth',
  'cookie',
  'session',
  'jwt',
  'api-key',
  'apikey',
  'auth-token',
  'access-token',
  'secret',
  'token',
  'password',
  'credential',
];

const FORBIDDEN_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
]);

const STRICT_LOOPBACK_URL_PREFIX_RE =
  /^(https?):\/\/(127\.0\.0\.1|localhost|\[::1\])(?::(\d{1,5}))?(?:[/?#]|$)/i;

export interface StudioHttpProbeOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface StudioHttpProbeResult {
  mode: 'live' | 'demo';
  url: string;
  method: string;
  status: number;
  statusText: string;
  ok: boolean;
  elapsedMs: number;
  redirected: boolean;
  location?: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  contentType: string;
  bodyText: string;
  bodyBytes: number;
  truncated: boolean;
}

// ============================================================================
// Strict Loopback-Only Anti-SSRF HTTP Probe (studio_http_probe)
// ============================================================================

export function validateLoopbackProbeUrl(rawUrl: string): URL {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('HTTP probe URL is required');
  }
  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) {
    throw new Error('HTTP probe URL exceeds maximum length (2048)');
  }
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new Error('HTTP probe URL contains forbidden control characters');
  }
  // Conservatively reject "#@" fragment-authority confusion across downstream parsers
  if (trimmed.includes('#@')) {
    throw new Error('HTTP probe URL must not contain "#@" confusion sequence');
  }

  // Strictly validate scheme & authority on the raw string BEFORE calling new URL()
  const schemeSepIdx = trimmed.indexOf('://');
  if (schemeSepIdx <= 0) {
    throw new Error(
      'HTTP probe URL must start with strict http:// or https:// followed by a loopback host',
    );
  }
  const rawScheme = trimmed.slice(0, schemeSepIdx);
  if (/[\s\\]/.test(rawScheme)) {
    throw new Error('HTTP probe URL scheme contains forbidden whitespace or backslash');
  }

  const afterScheme = trimmed.slice(schemeSepIdx + 3);
  const rawAuthority = afterScheme.split(/[/?#]/, 1)[0] ?? '';
  if (!rawAuthority || /[\s\\@]/.test(rawAuthority)) {
    throw new Error(
      'HTTP probe URL authority must not contain whitespace, backslashes, or "@" credentials',
    );
  }

  const prefixMatch = STRICT_LOOPBACK_URL_PREFIX_RE.exec(trimmed);
  if (!prefixMatch) {
    throw new Error(
      'SSRF guard blocked non-canonical or non-loopback URL (strictly limited to http(s)://127.0.0.1, localhost, or [::1])',
    );
  }

  const matchedHostLower = prefixMatch[2].toLowerCase();
  const rawPort = prefixMatch[3];
  let expectedPortNum: number | null = null;
  if (rawPort !== undefined) {
    if (rawPort.startsWith('0')) {
      throw new Error(`HTTP probe URL contains invalid port "${rawPort}"`);
    }
    expectedPortNum = Number(rawPort);
    if (!Number.isInteger(expectedPortNum) || expectedPortNum < 1 || expectedPortNum > 65535) {
      throw new Error(`HTTP probe URL port "${rawPort}" is out of range (1..65535)`);
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid HTTP probe URL: ${trimmed}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `HTTP probe protocol "${parsed.protocol}" is forbidden (only http: and https: are allowed)`,
    );
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('HTTP probe URL must not contain embedded username or password credentials');
  }

  const hostLower = parsed.hostname.toLowerCase();
  if (!ALLOWED_LOOPBACK_HOSTS.has(hostLower)) {
    throw new Error(
      `SSRF guard blocked non-loopback host "${parsed.hostname}" (strictly limited to 127.0.0.1, localhost, or [::1])`,
    );
  }

  // Re-verify parsed host agrees with raw canonical prefix match
  const matchedHostUnbracketed = matchedHostLower.replace(/^\[|\]$/g, '');
  if (hostLower !== matchedHostLower && hostLower !== matchedHostUnbracketed) {
    throw new Error(
      `SSRF guard rejected URL host mismatch between raw authority "${matchedHostLower}" and parsed host "${hostLower}"`,
    );
  }

  if (expectedPortNum !== null && parsed.port !== '' && parsed.port !== String(expectedPortNum)) {
    throw new Error(
      `HTTP probe URL port mismatch between raw authority "${expectedPortNum}" and parsed port "${parsed.port}"`,
    );
  }

  return parsed;
}

function isSensitiveHeaderName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (SENSITIVE_HEADER_NAMES.has(lower)) return true;
  return SENSITIVE_HEADER_SUBSTRINGS.some((sub) => lower.includes(sub));
}

export function sanitizeHeadersMap(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = isSensitiveHeaderName(k) ? '[REDACTED]' : redactStudioSecrets(v);
  }
  return out;
}

export async function runLoopbackHttpProbe(
  opts: StudioHttpProbeOptions,
): Promise<StudioHttpProbeResult> {
  const parsedUrl = validateLoopbackProbeUrl(opts.url);
  const method = (opts.method ?? 'GET').toUpperCase();
  if (!ALLOWED_HTTP_METHODS.has(method)) {
    throw new Error(`Unsupported HTTP method: ${method}`);
  }

  const rawTimeout =
    typeof opts.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs)
      ? Math.round(opts.timeoutMs)
      : STUDIO_HTTP_DEFAULT_TIMEOUT_MS;
  const clampedTimeoutMs = Math.max(
    STUDIO_HTTP_MIN_TIMEOUT_MS,
    Math.min(rawTimeout, STUDIO_HTTP_MAX_TIMEOUT_MS),
  );

  const outgoingHeaders: Record<string, string> = {};
  if (opts.headers && typeof opts.headers === 'object') {
    for (const [rawKey, rawVal] of Object.entries(opts.headers)) {
      const key = rawKey.trim();
      if (!key || /[\r\n:]/.test(key)) continue;
      if (FORBIDDEN_REQUEST_HEADERS.has(key.toLowerCase())) continue;
      const val = String(rawVal ?? '');
      if (/[\r\n]/.test(val)) {
        throw new Error(`Invalid newline character in request header "${key}"`);
      }
      outgoingHeaders[key] = val;
    }
  }

  const canSendBody = method !== 'GET' && method !== 'HEAD' && typeof opts.body === 'string';
  const requestBody = canSendBody ? opts.body : undefined;

  const startedAt = Date.now();
  const response = await fetch(parsedUrl.toString(), {
    method,
    headers: outgoingHeaders,
    body: requestBody,
    redirect: 'manual',
    signal: AbortSignal.timeout(clampedTimeoutMs),
  });

  // Stream response body with strict 64 KiB cap
  const chunks: Uint8Array[] = [];
  let collectedBytes = 0;
  let truncated = false;

  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        const remaining = STUDIO_HTTP_MAX_BODY_BYTES - collectedBytes;
        if (value.byteLength <= remaining) {
          chunks.push(value);
          collectedBytes += value.byteLength;
        } else {
          if (remaining > 0) {
            chunks.push(value.subarray(0, remaining));
            collectedBytes += remaining;
          }
          truncated = true;
          await reader.cancel();
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const rawBodyBuf = Buffer.concat(chunks, collectedBytes);
  const bodyText = redactStudioSecrets(rawBodyBuf.toString('utf8'));

  const rawResponseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    rawResponseHeaders[key] = value;
  });

  const locationRaw = response.headers.get('location');
  const redirected = response.status >= 300 && response.status < 400;
  const redirectedLocation = locationRaw ? redactStudioSecrets(locationRaw) : undefined;

  return {
    mode: 'live',
    url: redactStudioSecrets(parsedUrl.toString()),
    method,
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    elapsedMs,
    redirected,
    ...(redirectedLocation ? { location: redirectedLocation } : {}),
    requestHeaders: sanitizeHeadersMap(outgoingHeaders),
    responseHeaders: sanitizeHeadersMap(rawResponseHeaders),
    contentType: response.headers.get('content-type') ?? '',
    bodyText,
    bodyBytes: collectedBytes,
    truncated,
  };
}
