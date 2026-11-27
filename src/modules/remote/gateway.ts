import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type {
  ApprovalRequest,
  ApprovalRiskCard,
  ApprovalRiskLevel,
  ApprovalVerifyStatus,
  AuditEntry,
  GatewayStatus,
  PublicGatewayStatus,
  RemoteConfig,
} from './types.js';
import {
  DEFAULT_PIN_TTL_MS,
  detectLanIpv4,
  generatePairingPin,
  generatePairingToken,
  hasSavedConfig,
  loadConfigReadOnly,
  redactText,
  removeRuntimeInfo,
  saveConfig,
  writeRuntimeInfo,
} from './config.js';
import { broadcastChannels, type ChannelSendOptions } from './channels.js';
import { ConversationClient } from './conversation-client.js';
import {
  buildApprovalRiskCard,
  MAX_RISK_COMMAND_PREVIEW_CHARS,
  MAX_RISK_TARGET_SUMMARY_CHARS,
  MAX_RISK_VERIFY_SUMMARY_CHARS,
  type BuildApprovalRiskCardParams,
} from './hook.js';
import {
  clampLiveStreamLimit,
  InvalidConversationIdError,
  isValidConversationId,
  readConversationLiveStream,
  redactLiveStreamText,
} from './live-stream.js';
import { renderMobilePwaHtml } from './mobile-pwa.js';

export { buildApprovalRiskCard, type BuildApprovalRiskCardParams };

const VALID_RISK_LEVELS = new Set<ApprovalRiskLevel>(['high', 'medium', 'low']);
const VALID_VERIFY_STATUSES = new Set<ApprovalVerifyStatus>([
  'pass',
  'fail',
  'blocked',
  'idle',
  'unknown',
]);

function deriveRootDataDir(moduleDataDir: string): string | undefined {
  const resolved = path.resolve(moduleDataDir);
  const parent = path.dirname(resolved);
  if (path.basename(parent) === 'modules') {
    return path.dirname(parent);
  }
  return undefined;
}

function sanitizeCardLine(raw: unknown, maxChars: number): string {
  if (typeof raw !== 'string') return '';
  const cleaned = redactLiveStreamText(raw).replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function sanitizeIncomingRiskCard(raw: unknown): ApprovalRiskCard | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.riskLevel !== 'string' || !VALID_RISK_LEVELS.has(r.riskLevel as ApprovalRiskLevel)) {
    return undefined;
  }
  const verifyStatus: ApprovalVerifyStatus =
    typeof r.verifyStatus === 'string' &&
    VALID_VERIFY_STATUSES.has(r.verifyStatus as ApprovalVerifyStatus)
      ? (r.verifyStatus as ApprovalVerifyStatus)
      : 'unknown';
  const affectedFilesCount =
    typeof r.affectedFilesCount === 'number' && Number.isFinite(r.affectedFilesCount)
      ? Math.max(0, Math.floor(r.affectedFilesCount))
      : 0;
  const targetSummary = sanitizeCardLine(r.targetSummary, MAX_RISK_TARGET_SUMMARY_CHARS);
  if (!targetSummary) return undefined;
  const commandPreview = sanitizeCardLine(r.commandPreview, MAX_RISK_COMMAND_PREVIEW_CHARS);
  const verifySummary = sanitizeCardLine(r.verifySummary, MAX_RISK_VERIFY_SUMMARY_CHARS);

  return {
    riskLevel: r.riskLevel as ApprovalRiskLevel,
    affectedFilesCount,
    targetSummary,
    ...(commandPreview ? { commandPreview } : {}),
    verifyStatus,
    ...(verifySummary ? { verifySummary } : {}),
  };
}

export const MAX_BODY_BYTES = 64 * 1024; // 64 KiB hard limit
export const MAX_APPROVALS_RETAINED = 100;
export const PAIR_MAX_FAILURES = 5;
export const PAIR_LOCKOUT_MS = 15 * 60 * 1000;
export const MAX_SSE_CLIENTS = 16;
export const SSE_KEEPALIVE_INTERVAL_MS = 25_000;

export interface GatewayOptions {
  pinTtlMs?: number;
  pairLockoutMs?: number;
  maxPairFailures?: number;
  sseKeepaliveIntervalMs?: number;
  now?: () => number;
  channelSendOptions?: ChannelSendOptions;
  demoMode?: boolean;
  brainDirs?: string[];
  rootDataDir?: string;
}

interface PairRateState {
  failures: number;
  lockedUntil: number;
}

class HttpRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Perform a dummy fixed-size comparison before rejecting on length mismatch
    const dummy = Buffer.alloc(32);
    crypto.timingSafeEqual(dummy, dummy);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function isLoopbackBindHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === '' || h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

function normalizeHostForAllowlist(rawHost: string): string | null {
  const trimmed = rawHost.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === '0.0.0.0' || trimmed === '::' || trimmed === '[::]') return null;
  if (trimmed.includes(':') && !trimmed.startsWith('[')) {
    return `[${trimmed}]`;
  }
  return trimmed;
}

export class RemoteGateway {
  private server: http.Server | null = null;
  private stopping = false;
  private pruneTimer: NodeJS.Timeout | null = null;
  private sseKeepaliveTimer: NodeJS.Timeout | null = null;
  private expiryTimers = new Map<string, NodeJS.Timeout>();
  private config: RemoteConfig;
  private configPersisted: boolean;
  private actualPort: number;
  private boundHost: string;
  private pairingPinExpiresAt: number;
  private approvals = new Map<string, ApprovalRequest>();
  private waiters = new Map<string, Array<(req: ApprovalRequest) => void>>();
  private audit: AuditEntry[] = [];
  private sseClients = new Set<http.ServerResponse>();
  private pairIpFailures = new Map<string, PairRateState>();
  private pairGlobalFailures: PairRateState = { failures: 0, lockedUntil: 0 };

  private readonly pinTtlMs: number;
  private readonly pairLockoutMs: number;
  private readonly maxPairFailures: number;
  private readonly sseKeepaliveIntervalMs: number;
  private readonly nowFn: () => number;
  private readonly channelSendOptions?: ChannelSendOptions;
  private readonly demoMode: boolean;
  private readonly brainDirs?: string[];
  private readonly rootDataDir?: string;

  constructor(
    private readonly dataDir: string,
    private readonly convClient: ConversationClient,
    options: GatewayOptions = {},
  ) {
    this.pinTtlMs = options.pinTtlMs ?? DEFAULT_PIN_TTL_MS;
    this.pairLockoutMs = options.pairLockoutMs ?? PAIR_LOCKOUT_MS;
    this.maxPairFailures = options.maxPairFailures ?? PAIR_MAX_FAILURES;
    this.sseKeepaliveIntervalMs = Math.max(
      100,
      options.sseKeepaliveIntervalMs ?? SSE_KEEPALIVE_INTERVAL_MS,
    );
    this.nowFn = options.now ?? (() => Date.now());
    this.channelSendOptions = options.channelSendOptions;
    this.demoMode = Boolean(options.demoMode);
    this.brainDirs = options.brainDirs;
    this.rootDataDir = options.rootDataDir ?? deriveRootDataDir(dataDir);

    // Strictly read-only initialization: zero directories created, zero config.json written, zero timers started.
    const loaded = loadConfigReadOnly(dataDir);
    this.config = loaded.config;
    this.configPersisted = loaded.persisted;
    this.actualPort = this.config.port;
    this.boundHost = this.config.host || '127.0.0.1';
    this.pairingPinExpiresAt = this.resolveInitialPinExpiryInMemory();
  }

  private resolveInitialPinExpiryInMemory(): number {
    const now = this.nowFn();
    const parsed = this.config.pairingPinExpiresAt ? Date.parse(this.config.pairingPinExpiresAt) : NaN;
    if (!Number.isFinite(parsed) || parsed <= now) {
      this.config.pairingPin = generatePairingPin();
      const exp = now + this.pinTtlMs;
      this.config.pairingPinExpiresAt = new Date(exp).toISOString();
      return exp;
    }
    const capped = Math.min(parsed, now + this.pinTtlMs);
    if (capped !== parsed) {
      this.config.pairingPinExpiresAt = new Date(capped).toISOString();
    }
    return capped;
  }

  private ensureFreshPinIfExpired(): void {
    if (this.nowFn() >= this.pairingPinExpiresAt) {
      this.refreshPairingPin(this.configPersisted || this.isRunning());
    }
  }

  isRunning(): boolean {
    return Boolean(this.server?.listening);
  }

  getActualPort(): number {
    return this.actualPort;
  }

  hasPersistedConfig(): boolean {
    return this.configPersisted || hasSavedConfig(this.dataDir);
  }

  getConfig(): RemoteConfig {
    return this.config;
  }

  setGatewayEnabledInMemory(enabled: boolean): void {
    this.config = { ...this.config, gatewayEnabled: enabled };
  }

  updateConfig(patch: Partial<RemoteConfig>): RemoteConfig {
    this.config = { ...this.config, ...patch };
    saveConfig(this.dataDir, this.config);
    this.configPersisted = true;
    return this.config;
  }

  refreshPairingPin(persist = true): { pairingPin: string; pairingPinExpiresAt: string } {
    this.config.pairingPin = generatePairingPin();
    this.pairingPinExpiresAt = this.nowFn() + this.pinTtlMs;
    this.config.pairingPinExpiresAt = new Date(this.pairingPinExpiresAt).toISOString();
    if (persist) {
      saveConfig(this.dataDir, this.config);
      this.configPersisted = true;
    }
    return {
      pairingPin: this.config.pairingPin,
      pairingPinExpiresAt: this.config.pairingPinExpiresAt,
    };
  }

  rotatePairingCredentials(): { pairingToken: string; pairingPin: string; pairingPinExpiresAt: string } {
    this.config.pairingToken = generatePairingToken();
    const { pairingPin, pairingPinExpiresAt } = this.refreshPairingPin(true);
    return { pairingToken: this.config.pairingToken, pairingPin, pairingPinExpiresAt };
  }

  getApprovals(): ApprovalRequest[] {
    return Array.from(this.approvals.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getAudit(limit = 40): AuditEntry[] {
    return this.audit.slice(0, limit);
  }

  private clearExpiryTimer(id: string): void {
    const timer = this.expiryTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(id);
    }
  }

  private pruneApprovals(): void {
    if (this.approvals.size <= MAX_APPROVALS_RETAINED) return;
    const entries = Array.from(this.approvals.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let excess = this.approvals.size - MAX_APPROVALS_RETAINED;

    // Evict oldest finalized approvals first
    for (const item of entries) {
      if (excess <= 0) break;
      if (item.status !== 'pending') {
        this.clearExpiryTimer(item.id);
        this.approvals.delete(item.id);
        this.waiters.delete(item.id);
        excess--;
      }
    }

    // If still above cap (e.g. flood of pending approvals), evict oldest remaining entries
    if (excess > 0) {
      const nowIso = new Date(this.nowFn()).toISOString();
      for (const item of entries) {
        if (excess <= 0) break;
        if (this.approvals.has(item.id)) {
          this.clearExpiryTimer(item.id);
          if (item.status === 'pending') {
            item.status = 'expired';
            item.decidedAt = nowIso;
            this.resolveWaiters(item.id, item);
          } else {
            this.waiters.delete(item.id);
          }
          this.approvals.delete(item.id);
          excess--;
        }
      }
    }
  }

  private pushAudit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
    const full: AuditEntry = {
      id: crypto.randomBytes(6).toString('hex'),
      timestamp: new Date(this.nowFn()).toISOString(),
      ...entry,
      title: redactText(entry.title),
      detail: redactText(entry.detail),
    };
    this.audit.unshift(full);
    if (this.audit.length > 120) this.audit.length = 120;
    this.broadcastSse({ type: 'audit', entry: full });
    return full;
  }

  private pruneClosedSseClients(): void {
    for (const res of Array.from(this.sseClients)) {
      if (res.destroyed || res.writableEnded) {
        this.sseClients.delete(res);
      }
    }
    if (this.sseClients.size === 0) {
      this.stopSseKeepaliveTimer();
    }
  }

  private ensureSseKeepaliveTimer(): void {
    if (
      this.sseKeepaliveTimer ||
      !this.isRunning() ||
      this.stopping ||
      this.sseClients.size === 0
    ) {
      return;
    }
    this.sseKeepaliveTimer = setInterval(() => {
      if (!this.isRunning() || this.stopping || this.sseClients.size === 0) {
        this.stopSseKeepaliveTimer();
        return;
      }
      for (const res of Array.from(this.sseClients)) {
        if (res.destroyed || res.writableEnded) {
          this.sseClients.delete(res);
          continue;
        }
        try {
          res.write(': keepalive\n\n');
        } catch {
          this.sseClients.delete(res);
        }
      }
      if (this.sseClients.size === 0) {
        this.stopSseKeepaliveTimer();
      }
    }, this.sseKeepaliveIntervalMs);
    this.sseKeepaliveTimer.unref();
  }

  private stopSseKeepaliveTimer(): void {
    if (this.sseKeepaliveTimer) {
      clearInterval(this.sseKeepaliveTimer);
      this.sseKeepaliveTimer = null;
    }
  }

  private broadcastSse(event: Record<string, unknown>) {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of Array.from(this.sseClients)) {
      if (res.destroyed || res.writableEnded) {
        this.sseClients.delete(res);
        continue;
      }
      try {
        res.write(line);
      } catch {
        this.sseClients.delete(res);
      }
    }
    if (this.sseClients.size === 0) {
      this.stopSseKeepaliveTimer();
    }
  }

  private getAllowedLocalHosts(): Set<string> {
    const allowed = new Set<string>(['127.0.0.1', 'localhost', '[::1]']);
    const normalizedBound = normalizeHostForAllowlist(this.boundHost);
    if (normalizedBound) {
      allowed.add(normalizedBound);
    }
    const configuredHost = this.config.host?.trim().toLowerCase() ?? '';
    const normalizedConfigured = normalizeHostForAllowlist(configuredHost);
    if (normalizedConfigured) {
      allowed.add(normalizedConfigured);
    }
    const wildcardV4 = this.boundHost === '0.0.0.0' || configuredHost === '0.0.0.0';
    const wildcardV6 = this.boundHost === '::' || configuredHost === '::';
    if (wildcardV4 || wildcardV6) {
      const lanIp = normalizeHostForAllowlist(detectLanIpv4());
      if (lanIp) allowed.add(lanIp);
      try {
        const ifaces = os.networkInterfaces();
        for (const entries of Object.values(ifaces)) {
          if (!entries) continue;
          for (const entry of entries) {
            if (entry.internal || !entry.address) continue;
            if (entry.family === 'IPv4' || (wildcardV6 && entry.family === 'IPv6')) {
              const norm = normalizeHostForAllowlist(entry.address);
              if (norm) allowed.add(norm);
            }
          }
        }
      } catch {
        // ignore interface enumeration error
      }
    }
    return allowed;
  }

  private getConfiguredPublicUrl(): URL | null {
    const raw = this.config.publicBaseUrl?.trim();
    if (!raw) return null;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private validateSensitiveRequestHeaders(
    req: http.IncomingMessage,
  ): { ok: true } | { ok: false; error: string } {
    const allowedLocalHosts = this.getAllowedLocalHosts();
    const publicUrl = this.getConfiguredPublicUrl();
    const expectedPort = String(this.actualPort);

    // 1. Validate Host header (prevents DNS rebinding & cross-host / explicit :80 port spoofing)
    const rawHostHeader = req.headers.host;
    if (typeof rawHostHeader !== 'string' || !rawHostHeader.trim()) {
      return { ok: false, error: 'Forbidden: missing Host header' };
    }
    const hostValue = rawHostHeader.trim();
    if (/[\s/@?#\\\x00-\x1f\x7f]/.test(hostValue)) {
      return { ok: false, error: 'Forbidden: invalid Host header' };
    }
    let explicitPort = '';
    if (hostValue.startsWith('[')) {
      const m = /^\[[^\]]+\](?::(\d+))?$/.exec(hostValue);
      if (!m) {
        return { ok: false, error: 'Forbidden: malformed IPv6 Host header' };
      }
      explicitPort = m[1] ?? '';
    } else {
      const firstColon = hostValue.indexOf(':');
      if (firstColon !== -1) {
        const portPart = hostValue.slice(firstColon + 1);
        if (!/^\d{1,5}$/.test(portPart)) {
          return { ok: false, error: 'Forbidden: malformed Host port' };
        }
        explicitPort = portPart;
      }
    }
    let parsedHostUrl: URL;
    try {
      parsedHostUrl = new URL(`http://${hostValue}`);
    } catch {
      return { ok: false, error: 'Forbidden: malformed Host header' };
    }
    const hostName = parsedHostUrl.hostname.toLowerCase();
    const hostPort = explicitPort;
    const isAllowedLocalHost =
      allowedLocalHosts.has(hostName) && (!hostPort || hostPort === expectedPort);
    const isAllowedPublicHost =
      publicUrl !== null &&
      hostName === publicUrl.hostname.toLowerCase() &&
      (!hostPort ||
        hostPort === (publicUrl.port || (publicUrl.protocol === 'https:' ? '443' : '80')));
    if (!isAllowedLocalHost && !isAllowedPublicHost) {
      return { ok: false, error: 'Forbidden: Host header is not allowed for local gateway' };
    }

    // 2. Validate optional Origin header (prevents cross-site PIN brute-force / lockout DoS)
    const rawOriginHeader = req.headers.origin;
    if (rawOriginHeader !== undefined) {
      const originValue = Array.isArray(rawOriginHeader) ? rawOriginHeader[0] : rawOriginHeader;
      if (typeof originValue !== 'string' || !originValue.trim()) {
        return { ok: false, error: 'Forbidden: invalid Origin header' };
      }
      const trimmedOrigin = originValue.trim();
      if (trimmedOrigin.toLowerCase() === 'null') {
        return { ok: false, error: 'Forbidden: null Origin is not permitted' };
      }
      let parsedOrigin: URL;
      try {
        parsedOrigin = new URL(trimmedOrigin);
      } catch {
        return { ok: false, error: 'Forbidden: malformed Origin header' };
      }
      if (parsedOrigin.origin === 'null' || parsedOrigin.origin !== trimmedOrigin) {
        return { ok: false, error: 'Forbidden: non-canonical Origin header' };
      }
      const originPort = parsedOrigin.port || (parsedOrigin.protocol === 'https:' ? '443' : '80');
      const isSameLocalOrigin =
        parsedOrigin.protocol === 'http:' &&
        allowedLocalHosts.has(parsedOrigin.hostname.toLowerCase()) &&
        originPort === expectedPort;
      const isSamePublicOrigin = publicUrl !== null && parsedOrigin.origin === publicUrl.origin;
      if (!isSameLocalOrigin && !isSamePublicOrigin) {
        return { ok: false, error: 'Forbidden: cross-origin request rejected' };
      }
    }

    return { ok: true };
  }

  private resolvePublicBaseUrl(): { localUrl: string; baseUrl: string } {
    const localUrl = `http://127.0.0.1:${this.actualPort}`;
    const customPublic = this.config.publicBaseUrl?.trim().replace(/\/+$/, '');
    if (customPublic) {
      return { localUrl, baseUrl: customPublic };
    }
    const host = this.config.host || '127.0.0.1';
    if (isLoopbackBindHost(host)) {
      return { localUrl, baseUrl: localUrl };
    }
    const advertisedHost = host === '0.0.0.0' || host === '::' ? detectLanIpv4() : host;
    return { localUrl, baseUrl: `http://${advertisedHost}:${this.actualPort}` };
  }

  /**
   * Sanitized status safe for model-visible tools and mobile /api/state.
   * Never exposes pairingUrl, pairingPin, or pairingToken.
   */
  getPublicStatus(): PublicGatewayStatus {
    const { localUrl, baseUrl } = this.resolvePublicBaseUrl();
    const pendingApprovals = Array.from(this.approvals.values()).filter((a) => a.status === 'pending').length;
    return {
      running: Boolean(this.server?.listening),
      url: localUrl,
      lanUrl: baseUrl,
      mobilePath: '/m',
      mobileUrl: `${baseUrl}/m`,
      connectedClients: this.sseClients.size,
      pendingApprovals,
      remoteApprovalEnabled: this.config.remoteApprovalEnabled,
      notifyOnStop: this.config.notifyOnStop,
    };
  }

  /**
   * Full status including pairingUrl & active pairingPin.
   * Reserved strictly for trusted app-only MCP tools and local CLI output.
   */
  getStatus(): GatewayStatus {
    this.ensureFreshPinIfExpired();
    const pub = this.getPublicStatus();
    return {
      ...pub,
      pairingUrl: `${pub.mobileUrl}?token=${this.config.pairingToken}`,
      pairingPin: this.config.pairingPin,
      pairingPinExpiresAt: new Date(this.pairingPinExpiresAt).toISOString(),
    };
  }

  async createApproval(input: {
    conversationId: string;
    toolName: string;
    summary: string;
    matchedRule: string;
    timeoutSec?: number;
    toolInput?: Record<string, unknown> | string;
    riskCard?: ApprovalRiskCard;
  }): Promise<ApprovalRequest> {
    const timeoutMs = Math.max(100, (input.timeoutSec ?? this.config.approvalTimeoutSec) * 1000);
    const now = this.nowFn();
    const safeSummary = redactLiveStreamText(redactText(input.summary)).slice(0, 400);
    const riskCard =
      sanitizeIncomingRiskCard(input.riskCard) ??
      buildApprovalRiskCard({
        toolName: input.toolName,
        toolInput: input.toolInput,
        summary: safeSummary,
        matchedRule: input.matchedRule,
        rootDataDir: this.rootDataDir,
      });
    const req: ApprovalRequest = {
      id: `apr_${crypto.randomBytes(6).toString('hex')}`,
      conversationId: input.conversationId,
      toolName: input.toolName,
      summary: safeSummary,
      matchedRule: input.matchedRule,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + timeoutMs).toISOString(),
      status: 'pending',
      riskCard,
    };
    this.approvals.set(req.id, req);
    this.pruneApprovals();
    this.pushAudit({
      kind: 'approval_requested',
      title: `Approval needed: ${req.toolName}`,
      detail: req.summary,
      actor: 'antigravity-hook',
    });
    this.broadcastSse({ type: 'approval', approval: req });

    if (this.isRunning()) {
      const pub = this.getPublicStatus();
      void broadcastChannels(
        this.config.channels,
        {
          title: `⚠️ Antigravity Approval Needed (${req.toolName})`,
          body: `${req.summary}\nRule: \`${req.matchedRule}\``,
          level: 'warn',
          // Send clean Mobile PWA base URL only; never attach long-lived Master Token to IM pushes
          actionUrl: pub.mobileUrl,
          riskCard: req.riskCard,
        },
        this.channelSendOptions,
      );
    }

    const expiryTimer = setTimeout(() => {
      this.expiryTimers.delete(req.id);
      const current = this.approvals.get(req.id);
      if (current && current.status === 'pending') {
        current.status = 'expired';
        current.decidedAt = new Date(this.nowFn()).toISOString();
        this.resolveWaiters(req.id, current);
        this.pruneApprovals();
        this.broadcastSse({ type: 'approval_expired', id: req.id });
      }
    }, timeoutMs);
    expiryTimer.unref();
    this.expiryTimers.set(req.id, expiryTimer);

    return req;
  }

  decideApproval(id: string, decision: 'approved' | 'denied', actor = 'remote'): ApprovalRequest | null {
    const req = this.approvals.get(id);
    if (!req || req.status !== 'pending') return req ?? null;
    this.clearExpiryTimer(id);
    req.status = decision;
    req.decidedBy = actor;
    req.decidedAt = new Date(this.nowFn()).toISOString();
    this.pushAudit({
      kind: 'approval_decided',
      title: `${decision.toUpperCase()}: ${req.toolName}`,
      detail: `${req.summary} (by ${actor})`,
      actor,
    });
    this.resolveWaiters(id, req);
    this.pruneApprovals();
    this.broadcastSse({ type: 'approval_decided', approval: req });
    return req;
  }

  waitForApproval(id: string, maxWaitMs: number): Promise<ApprovalRequest | null> {
    const cur = this.approvals.get(id);
    if (!cur) return Promise.resolve(null);
    if (cur.status !== 'pending') return Promise.resolve(cur);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (finalReq: ApprovalRequest | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(finalReq);
      };
      const waiterCb = (finalReq: ApprovalRequest) => finish(finalReq);
      const timer = setTimeout(() => {
        const list = this.waiters.get(id);
        if (list) {
          const next = list.filter((fn) => fn !== waiterCb);
          if (next.length > 0) this.waiters.set(id, next);
          else this.waiters.delete(id);
        }
        finish(this.approvals.get(id) ?? null);
      }, maxWaitMs);
      timer.unref();
      const list = this.waiters.get(id) ?? [];
      list.push(waiterCb);
      this.waiters.set(id, list);
    });
  }

  private resolveWaiters(id: string, req: ApprovalRequest) {
    const list = this.waiters.get(id);
    if (!list) return;
    this.waiters.delete(id);
    for (const fn of list) {
      try {
        fn(req);
      } catch {
        // ignore waiter callback failure
      }
    }
  }

  private isAuthorized(req: http.IncomingMessage, url: URL): boolean {
    const auth = req.headers.authorization ?? '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    // EventSource cannot attach custom Authorization headers; limit query token to SSE only
    const queryTok = url.pathname === '/api/events' ? (url.searchParams.get('token') ?? '') : '';
    const candidate = bearer || queryTok;
    if (!candidate) return false;
    return constantTimeEqual(candidate, this.config.pairingToken);
  }

  private getClientIp(req: http.IncomingMessage): string {
    return req.socket.remoteAddress || 'unknown';
  }

  private getOrResetRateState(state: PairRateState, now: number): PairRateState {
    if (state.lockedUntil > 0 && now >= state.lockedUntil) {
      state.failures = 0;
      state.lockedUntil = 0;
    }
    return state;
  }

  private checkPairLockout(clientIp: string, now: number): number {
    const globalState = this.getOrResetRateState(this.pairGlobalFailures, now);
    const ipState = this.pairIpFailures.get(clientIp);
    if (ipState) this.getOrResetRateState(ipState, now);

    const lockedUntil = Math.max(globalState.lockedUntil, ipState?.lockedUntil ?? 0);
    if (lockedUntil > now) {
      return Math.max(1, Math.ceil((lockedUntil - now) / 1000));
    }
    return 0;
  }

  private recordPairFailure(clientIp: string, now: number): number {
    if (this.pairIpFailures.size > 500) {
      for (const [ip, st] of this.pairIpFailures.entries()) {
        if (st.lockedUntil <= now) this.pairIpFailures.delete(ip);
      }
    }

    const ipState = this.getOrResetRateState(
      this.pairIpFailures.get(clientIp) ?? { failures: 0, lockedUntil: 0 },
      now,
    );
    ipState.failures += 1;
    if (ipState.failures >= this.maxPairFailures) {
      ipState.lockedUntil = now + this.pairLockoutMs;
    }
    this.pairIpFailures.set(clientIp, ipState);

    const globalState = this.getOrResetRateState(this.pairGlobalFailures, now);
    globalState.failures += 1;
    if (globalState.failures >= this.maxPairFailures) {
      globalState.lockedUntil = now + this.pairLockoutMs;
    }

    const lockedUntil = Math.max(ipState.lockedUntil, globalState.lockedUntil);
    if (lockedUntil > now) {
      return Math.max(1, Math.ceil((lockedUntil - now) / 1000));
    }
    return 0;
  }

  private resetPairFailures(clientIp: string): void {
    this.pairIpFailures.delete(clientIp);
    this.pairGlobalFailures = { failures: 0, lockedUntil: 0 };
  }

  private async readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    const contentTypeHeader = String(req.headers['content-type'] ?? '');
    const mediaType = contentTypeHeader.split(';')[0].trim().toLowerCase();
    if (mediaType !== 'application/json') {
      throw new HttpRequestError(415, 'Content-Type must be application/json');
    }

    const contentLengthHeader = req.headers['content-length'];
    if (contentLengthHeader !== undefined) {
      const declared = Number(contentLengthHeader);
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        throw new HttpRequestError(413, `Payload too large (max ${MAX_BODY_BYTES} bytes)`);
      }
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (totalBytes > MAX_BODY_BYTES) {
        throw new HttpRequestError(413, `Payload too large (max ${MAX_BODY_BYTES} bytes)`);
      }
      chunks.push(buf);
    }

    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return {};

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HttpRequestError(400, 'Invalid JSON body');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpRequestError(400, 'JSON body must be an object');
    }
    return parsed as Record<string, unknown>;
  }

  private writeJson(
    res: http.ServerResponse,
    status: number,
    payload: Record<string, unknown>,
    extraHeaders: Record<string, string> = {},
  ): void {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...(this.stopping ? { Connection: 'close' } : {}),
      ...extraHeaders,
    });
    res.end(JSON.stringify(payload));
  }

  async start(overridePort?: number): Promise<GatewayStatus> {
    if (this.server?.listening) return this.getStatus();
    this.stopping = false;
    const bindHost = this.config.host || '127.0.0.1';
    const bindPort = overridePort ?? this.config.port;

    const srv = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.actualPort}`);

        if (url.pathname === '/health') {
          this.writeJson(res, 200, { ok: true, pending: this.getPublicStatus().pendingApprovals });
          return;
        }

        if (url.pathname === '/m' || url.pathname === '/') {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy':
              "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'self' http://127.0.0.1:* http://localhost:*",
          });
          res.end(renderMobilePwaHtml());
          return;
        }

        // Guard all sensitive /api/* routes (including /api/pair, /api/approve, /api/approvals/*,
        // /api/events, /api/status, /api/state, /api/live, /api/conversations/*, /api/hooks/*)
        // against DNS rebinding and cross-site lockout DoS before touching PIN rate limits or auth.
        if (url.pathname.startsWith('/api/')) {
          const headerCheck = this.validateSensitiveRequestHeaders(req);
          if (!headerCheck.ok) {
            this.writeJson(res, 403, { error: headerCheck.error });
            return;
          }
        }

        if (url.pathname === '/api/pair' && req.method === 'POST') {
          const now = this.nowFn();
          const clientIp = this.getClientIp(req);
          const lockedRetryAfter = this.checkPairLockout(clientIp, now);
          if (lockedRetryAfter > 0) {
            this.writeJson(
              res,
              429,
              { error: 'Too many failed pairing attempts. Try again later.', retryAfterSec: lockedRetryAfter },
              { 'Retry-After': String(lockedRetryAfter) },
            );
            return;
          }

          const body = await this.readBody(req);
          const submittedPin =
            typeof body.pin === 'string' || typeof body.pin === 'number' ? String(body.pin).trim() : '';
          const pinMatches = constantTimeEqual(submittedPin, this.config.pairingPin);
          const pinActive = now < this.pairingPinExpiresAt;

          if (pinMatches && pinActive) {
            this.resetPairFailures(clientIp);
            // Rotate PIN immediately after a single successful pairing to prevent replay
            this.refreshPairingPin(true);
            this.writeJson(res, 200, { token: this.config.pairingToken });
          } else {
            const newlyLockedRetryAfter = this.recordPairFailure(clientIp, now);
            if (newlyLockedRetryAfter > 0) {
              this.writeJson(
                res,
                429,
                { error: 'Too many failed pairing attempts. Locked for 15 minutes.', retryAfterSec: newlyLockedRetryAfter },
                { 'Retry-After': String(newlyLockedRetryAfter) },
              );
            } else {
              this.writeJson(res, 401, { error: 'Invalid or expired pairing PIN' });
            }
          }
          return;
        }

        if (!this.isAuthorized(req, url)) {
          this.writeJson(res, 401, { error: 'Unauthorized' });
          return;
        }

        if (url.pathname === '/api/events') {
          this.pruneClosedSseClients();
          if (this.sseClients.size >= MAX_SSE_CLIENTS) {
            this.writeJson(
              res,
              503,
              { error: `Too many active SSE clients (max ${MAX_SSE_CLIENTS})` },
              { 'Retry-After': '5' },
            );
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
          });
          res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
          this.sseClients.add(res);
          this.ensureSseKeepaliveTimer();
          const cleanupClient = () => {
            this.sseClients.delete(res);
            if (this.sseClients.size === 0) {
              this.stopSseKeepaliveTimer();
            }
          };
          req.on('close', cleanupClient);
          res.on('close', cleanupClient);
          res.on('error', cleanupClient);
          return;
        }

        if (url.pathname === '/api/state' && req.method === 'GET') {
          const { conversations } = await this.convClient.listConversations(15);
          this.writeJson(res, 200, {
            status: this.getPublicStatus(),
            approvals: this.getApprovals(),
            conversations,
            audit: this.getAudit(25),
          });
          return;
        }

        // Hook endpoint: request approval & optionally long-poll until decided
        if (url.pathname === '/api/hooks/approval' && req.method === 'POST') {
          const body = await this.readBody(req);
          const created = await this.createApproval({
            conversationId: String(body.conversationId ?? 'unknown'),
            toolName: String(body.toolName ?? 'run_command'),
            summary: String(body.summary ?? ''),
            matchedRule: String(body.matchedRule ?? 'risk'),
            timeoutSec: Number(body.timeoutSec ?? this.config.approvalTimeoutSec),
            riskCard: sanitizeIncomingRiskCard(body.riskCard),
          });
          const waitMs = Math.min(26_000, Number(body.waitMs ?? 24_000));
          const finalReq = waitMs > 0 ? await this.waitForApproval(created.id, waitMs) : created;
          this.writeJson(res, 200, { approval: finalReq ?? created });
          return;
        }

        // Hook endpoint: Stop notification
        if (url.pathname === '/api/hooks/stop' && req.method === 'POST') {
          const body = await this.readBody(req);
          const reason = String(body.terminationReason ?? 'NO_TOOL_CALL');
          const convId = String(body.conversationId ?? 'unknown');
          const lastInput = redactText(String(body.lastUserInput ?? '')).slice(0, 140);
          this.pushAudit({
            kind: 'stop_alert',
            title: `Session stopped (${reason})`,
            detail: lastInput || `Conversation ${convId}`,
            actor: 'antigravity-hook',
          });
          if (this.config.notifyOnStop && this.isRunning()) {
            void broadcastChannels(
              this.config.channels,
              {
                title: reason === 'ERROR' ? '❌ Antigravity Task Errored' : '✅ Antigravity Task Ready',
                body: `Reason: ${reason}\nTask: ${lastInput || convId}`,
                level: reason === 'ERROR' ? 'warn' : 'success',
                actionUrl: this.getPublicStatus().mobileUrl,
              },
              this.channelSendOptions,
            );
          }
          this.writeJson(res, 200, { ok: true });
          return;
        }

        // Decide approval
        const decideMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)\/decide$/);
        if (decideMatch && req.method === 'POST') {
          const body = await this.readBody(req);
          const decision = body.decision === 'approved' ? 'approved' : 'denied';
          const actor = String(body.actor ?? 'mobile-pwa');
          const updated = this.decideApproval(decodeURIComponent(decideMatch[1]), decision, actor);
          this.writeJson(res, updated ? 200 : 404, { approval: updated });
          return;
        }

        // Read-only conversation live stream (strictly after auth check)
        const rawPathname = (req.url ?? '/').split('?')[0];
        const streamPathMatch = url.pathname.match(/^\/api\/conversations\/(.*)\/stream$/);
        const rawStreamPathMatch = rawPathname.match(/^\/api\/conversations\/(.*)\/stream$/);
        if ((streamPathMatch || rawStreamPathMatch) && req.method === 'GET') {
          if (!streamPathMatch || (rawStreamPathMatch && rawPathname !== url.pathname)) {
            this.writeJson(res, 400, { error: 'Invalid conversationId' });
            return;
          }
          let decodedId: string;
          try {
            decodedId = decodeURIComponent(streamPathMatch[1]);
          } catch {
            this.writeJson(res, 400, { error: 'Invalid conversationId encoding' });
            return;
          }
          if (!isValidConversationId(decodedId)) {
            this.writeJson(res, 400, {
              error: 'Invalid conversationId: must match /^[A-Za-z0-9._-]{1,128}$/ without ".."',
            });
            return;
          }

          const rawLimit = url.searchParams.get('limit');
          const parsedLimit =
            rawLimit !== null && rawLimit.trim() !== '' ? Number(rawLimit) : undefined;
          const limit =
            parsedLimit !== undefined && Number.isFinite(parsedLimit)
              ? clampLiveStreamLimit(parsedLimit)
              : undefined;

          try {
            const stream = readConversationLiveStream(decodedId, {
              demoMode: this.demoMode,
              limit,
              brainDirs: this.brainDirs,
            });
            this.writeJson(res, 200, { ...stream, readOnly: true });
          } catch (err) {
            if (err instanceof InvalidConversationIdError) {
              this.writeJson(res, 400, { error: err.message });
              return;
            }
            throw err;
          }
          return;
        }

        // Dispatch new conversation
        if (url.pathname === '/api/conversations' && req.method === 'POST') {
          const body = await this.readBody(req);
          const prompt = String(body.prompt ?? '').trim();
          if (!prompt) {
            this.writeJson(res, 400, { error: 'prompt is required' });
            return;
          }
          const model = body.model === 'pro' || body.model === 'flash_lite' ? body.model : 'flash';
          const created = await this.convClient.createConversation({
            title: typeof body.title === 'string' ? body.title : undefined,
            prompt,
            model,
          });
          this.pushAudit({
            kind: 'task_dispatched',
            title: `Remote task dispatched (${model})`,
            detail: prompt.slice(0, 140),
            actor: 'mobile-pwa',
          });
          this.writeJson(res, 200, created);
          return;
        }

        this.writeJson(res, 404, { error: 'Not found' });
      } catch (err) {
        if (err instanceof HttpRequestError) {
          const extraHeaders: Record<string, string> = err.statusCode === 413 ? { Connection: 'close' } : {};
          this.writeJson(res, err.statusCode, { error: err.message }, extraHeaders);
          if (err.statusCode === 413) {
            res.once('finish', () => req.destroy());
          }
          return;
        }
        if (!res.headersSent) {
          this.writeJson(res, 500, { error: 'Internal server error' });
        }
      }
    });

    this.server = srv;

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          srv.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          srv.off('error', onError);
          const addr = srv.address() as AddressInfo | null;
          if (addr?.port) this.actualPort = addr.port;
          this.boundHost = addr?.address || bindHost;
          resolve();
        };
        srv.once('error', onError);
        srv.once('listening', onListening);
        srv.listen(bindPort, bindHost);
      });
    } catch (err) {
      this.server = null;
      throw err;
    }

    writeRuntimeInfo(this.dataDir, {
      port: this.actualPort,
      host: bindHost,
      url: `http://127.0.0.1:${this.actualPort}`,
      pid: process.pid,
      startedAt: new Date(this.nowFn()).toISOString(),
    });

    this.pruneTimer = setInterval(() => this.pruneApprovals(), 5 * 60 * 1000);
    this.pruneTimer.unref();

    return this.getStatus();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    // 1. Stop periodic prune & SSE keepalive timers and clear all approval expiry timers
    this.stopSseKeepaliveTimer();
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    for (const timer of this.expiryTimers.values()) {
      clearTimeout(timer);
    }
    this.expiryTimers.clear();

    // 2. Immediately resolve all pending approval waiters with status 'expired' so long-polls unblock
    const hadWaiters = this.waiters.size > 0;
    const stoppedAt = new Date(this.nowFn()).toISOString();
    for (const [id, list] of this.waiters.entries()) {
      const existing = this.approvals.get(id);
      const resolvedReq: ApprovalRequest = existing
        ? {
            ...existing,
            status: existing.status === 'pending' ? 'expired' : existing.status,
            decidedAt: existing.decidedAt ?? stoppedAt,
          }
        : {
            id,
            conversationId: 'unknown',
            toolName: 'unknown',
            summary: 'Gateway stopped',
            matchedRule: 'gateway_stopped',
            createdAt: stoppedAt,
            expiresAt: stoppedAt,
            status: 'expired',
            decidedAt: stoppedAt,
          };
      if (existing && existing.status === 'pending') {
        existing.status = 'expired';
        existing.decidedAt = stoppedAt;
      }
      for (const fn of list) {
        try {
          fn(resolvedReq);
        } catch {
          // ignore waiter callback failure
        }
      }
    }
    this.waiters.clear();

    // Allow newly unblocked long-poll handlers to flush their final JSON response with Connection: close
    if (hadWaiters && this.server) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    // 3. End all SSE clients
    for (const res of this.sseClients) {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
    this.sseClients.clear();

    // 4. Close HTTP server promptly with closeIdleConnections + short fallback to closeAllConnections
    const srv = this.server;
    this.server = null;
    this.actualPort = this.config.port;
    this.boundHost = this.config.host || '127.0.0.1';
    if (srv) {
      try {
        srv.closeIdleConnections?.();
      } catch {
        // ignore
      }
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          clearTimeout(forceTimer);
          resolve();
        };
        const forceTimer = setTimeout(() => {
          try {
            srv.closeAllConnections?.();
          } catch {
            // ignore
          }
          done();
        }, 250);
        forceTimer.unref();
        try {
          srv.close(() => done());
        } catch {
          done();
        }
      });
    }

    // 5. Remove runtime.json
    removeRuntimeInfo(this.dataDir, process.pid);
  }
}
