import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getModuleDataDir, resolveNovDataDir, sanitizeDataDirCandidate } from '../../core/config.js';
import type { ChannelConfig, RemoteConfig, RuntimeInfo, SafeChannelView } from './types.js';

export const DEFAULT_PIN_TTL_MS = 5 * 60 * 1000;

export const DEFAULT_RISK_PATTERNS = [
  '\\brm\\s+(-[a-zA-Z]*(?:r[a-zA-Z]*f|f[a-zA-Z]*r)|-[a-zA-Z]*r\\b[^;&|]*-[a-zA-Z]*f\\b)',
  '\\bgit\\s+push\\b.*(--force|-f\\b)',
  '\\bgit\\s+reset\\s+--hard',
  '\\bsudo\\b',
  '\\b(drop|truncate)\\s+(table|database)\\b',
  'curl\\b.*\\|\\s*(ba)?sh\\b',
  '\\bchmod\\s+777\\b',
  '\\bmkfs\\.|\\bdd\\s+if=',
];

export const DEFAULT_SENSITIVE_PATH_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'sensitive_path:.env*', regex: /(?:^|[\\/])\.env[^\\/\s"']*(?:$|[\\/\s"'])/i },
  { label: 'sensitive_path:.ssh', regex: /(?:^|[\\/])\.ssh(?:$|[\\/\s"'])/i },
  { label: 'sensitive_path:*.pem', regex: /(?:^|[\\/])[^\\/\s"']+\.pem(?:$|[\\/\s"'])/i },
  { label: 'sensitive_path:*.key', regex: /(?:^|[\\/])[^\\/\s"']+\.key(?:$|[\\/\s"'])/i },
  { label: 'sensitive_path:ssh_key', regex: /(?:^|[\\/])id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?(?:$|[\\/\s"'])/i },
];

const SECRET_REGEXES: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  [/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/open\.(?:feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/oapi\.dingtalk\.com\/robot\/send\?[^\s"']+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?[^\s"']+/gi, '[REDACTED_WEBHOOK]'],
  [/(https?:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi, '$1[REDACTED]$3'],
  [/([?&](?:token|access_token|api[_-]?key|key|secret|sign|sig)=)([^&#\s"']+)/gi, '$1[REDACTED]'],
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]'],
  [/\bBasic\s+[A-Za-z0-9+/]+=*/gi, 'Basic [REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]'],
  [/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_BOT_TOKEN]'],
  [
    /\b(sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z\-_]{24,}|gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16}|npm_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|pypi-[A-Za-z0-9_-]{20,})\b/g,
    '[REDACTED_KEY]',
  ],
  [
    /(["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|bot[_-]?token|client[_-]?secret|signing[_-]?secret|secret|token|password|passwd|csrf[_-]?token)["']?\s*[:=]\s*["']?)([^\s"',;}{]{6,})(["']?)/gi,
    '$1[REDACTED]$3',
  ],
];

export function redactText(text: string): string {
  let out = text;
  for (const [re, rep] of SECRET_REGEXES) out = out.replace(re, rep);
  return out;
}

export function generatePairingToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function generatePairingPin(): string {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * Default Remote configuration strictly disables the gateway (`gatewayEnabled: false`)
 * to guarantee zero ports, zero timers, and zero outbound requests until explicitly opted in.
 */
export function defaultRemoteConfig(now = Date.now()): RemoteConfig {
  return {
    gatewayEnabled: false,
    host: '127.0.0.1',
    port: 4391,
    pairingToken: generatePairingToken(),
    pairingPin: generatePairingPin(),
    pairingPinExpiresAt: new Date(now + DEFAULT_PIN_TTL_MS).toISOString(),
    remoteApprovalEnabled: true,
    approvalTimeoutSec: 25,
    notifyOnStop: true,
    riskPatterns: [...DEFAULT_RISK_PATTERNS],
    channels: [
      { id: 'telegram', kind: 'telegram', label: 'Telegram Bot', enabled: false },
      { id: 'feishu', kind: 'feishu', label: 'Feishu / Lark (飞书)', enabled: false },
      { id: 'dingtalk', kind: 'dingtalk', label: 'DingTalk (钉钉)', enabled: false },
      { id: 'wecom', kind: 'wecom', label: 'WeCom (企业微信)', enabled: false },
      { id: 'slack', kind: 'slack', label: 'Slack Webhook', enabled: false },
      { id: 'discord', kind: 'discord', label: 'Discord Webhook', enabled: false },
    ],
  };
}

export function resolveRemoteDataDir(explicitRoot?: string): string {
  const sanitized = sanitizeDataDirCandidate(explicitRoot);
  if (sanitized) return getModuleDataDir(sanitized, 'remote');
  return getModuleDataDir(resolveNovDataDir(), 'remote');
}

export function getRemoteConfigPath(dataDir: string): string {
  return path.join(dataDir, 'config.json');
}

export function hasSavedConfig(dataDir: string): boolean {
  return fs.existsSync(getRemoteConfigPath(dataDir));
}

export function ensureSecureDataDir(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dataDir, 0o700);
  } catch {
    // Windows chmod no-op
  }
}

function writeSecureAtomicJson(filePath: string, dataDir: string, value: unknown): void {
  ensureSecureDataDir(dataDir);
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows chmod no-op
  }
}

function normalizeRemoteConfig(raw: Partial<RemoteConfig>): RemoteConfig {
  const base = defaultRemoteConfig();
  return {
    ...base,
    ...raw,
    gatewayEnabled: typeof raw.gatewayEnabled === 'boolean' ? raw.gatewayEnabled : false,
    host: typeof raw.host === 'string' && raw.host.trim() ? raw.host.trim() : base.host,
    port:
      typeof raw.port === 'number' && Number.isInteger(raw.port) && raw.port >= 0 && raw.port <= 65535
        ? raw.port
        : base.port,
    pairingToken: typeof raw.pairingToken === 'string' && raw.pairingToken ? raw.pairingToken : base.pairingToken,
    pairingPin: typeof raw.pairingPin === 'string' && raw.pairingPin ? raw.pairingPin : base.pairingPin,
    pairingPinExpiresAt:
      typeof raw.pairingPinExpiresAt === 'string' && raw.pairingPinExpiresAt
        ? raw.pairingPinExpiresAt
        : base.pairingPinExpiresAt,
    riskPatterns: Array.isArray(raw.riskPatterns) && raw.riskPatterns.length ? raw.riskPatterns : base.riskPatterns,
    channels: Array.isArray(raw.channels) && raw.channels.length ? raw.channels : base.channels,
  };
}

/**
 * Pure read-only load. Never creates directories and never writes `config.json`.
 * When `config.json` does not exist or is unreadable, returns defaults (`gatewayEnabled: false`)
 * with `persisted: false`.
 */
export function loadConfigReadOnly(dataDir: string): { config: RemoteConfig; persisted: boolean } {
  const cfgPath = getRemoteConfigPath(dataDir);
  if (!fs.existsSync(cfgPath)) {
    return { config: defaultRemoteConfig(), persisted: false };
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { config: defaultRemoteConfig(), persisted: false };
    }
    return {
      config: normalizeRemoteConfig(parsed as Partial<RemoteConfig>),
      persisted: true,
    };
  } catch {
    return { config: defaultRemoteConfig(), persisted: false };
  }
}

export function saveConfig(dataDir: string, config: RemoteConfig): void {
  const cfgPath = getRemoteConfigPath(dataDir);
  writeSecureAtomicJson(cfgPath, dataDir, config);
}

export function writeRuntimeInfo(dataDir: string, info: RuntimeInfo): void {
  const runtimePath = path.join(dataDir, 'runtime.json');
  writeSecureAtomicJson(runtimePath, dataDir, info);
}

export function readRuntimeInfo(dataDir: string): RuntimeInfo | null {
  const runtimePath = path.join(dataDir, 'runtime.json');
  if (!fs.existsSync(runtimePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(runtimePath, 'utf8')) as Partial<RuntimeInfo>;
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    const pid = Number(parsed.pid ?? 0);
    return {
      port,
      host: typeof parsed.host === 'string' && parsed.host ? parsed.host : '127.0.0.1',
      url: `http://127.0.0.1:${port}`,
      pid: Number.isInteger(pid) ? pid : 0,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
    };
  } catch {
    return null;
  }
}

export function removeRuntimeInfo(dataDir: string, expectedPid?: number): void {
  const runtimePath = path.join(dataDir, 'runtime.json');
  if (!fs.existsSync(runtimePath)) return;
  try {
    if (expectedPid !== undefined) {
      const current = readRuntimeInfo(dataDir);
      if (current && current.pid && current.pid !== expectedPid) return;
    }
    fs.unlinkSync(runtimePath);
  } catch {
    // ignore removal errors
  }
}

export function toSafeChannelViews(channels: ChannelConfig[]): SafeChannelView[] {
  return channels.map((c) => ({
    id: c.id,
    kind: c.kind,
    label: c.label,
    enabled: c.enabled,
    configured:
      c.kind === 'telegram'
        ? Boolean(c.botToken && c.chatId)
        : Boolean(c.webhookUrl),
  }));
}

export function matchRiskPattern(text: string, patterns: string[]): string | null {
  for (const raw of patterns) {
    try {
      const re = new RegExp(raw, 'i');
      if (re.test(text)) return raw;
    } catch {
      // skip invalid user regex
    }
  }
  return null;
}

export function matchSensitivePath(target: string): string | null {
  const normalized = target.trim();
  if (!normalized) return null;
  for (const { label, regex } of DEFAULT_SENSITIVE_PATH_PATTERNS) {
    if (regex.test(normalized)) return label;
  }
  return null;
}

export function detectLanIpv4(): string {
  const ifaces = os.networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const info of entries) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address;
      }
    }
  }
  return '127.0.0.1';
}
