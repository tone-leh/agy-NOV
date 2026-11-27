import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import type { ChannelConfig } from './types.js';
import { redactText } from './config.js';

export interface NotificationPayload {
  title: string;
  body: string;
  level: 'info' | 'warn' | 'success';
  actionUrl?: string;
}

export interface ChannelSendOptions {
  /**
   * Internal test-only opt-in to allow local loopback HTTP mock servers
   * (127.0.0.1 / localhost / ::1). Production callers must omit this.
   */
  allowInsecureLocalhostForTests?: boolean;
}

export interface ChannelDispatchResult {
  channelId: string;
  kind: ChannelConfig['kind'];
  ok: boolean;
  error?: string;
}

export const TELEGRAM_BOT_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{20,}$/;
export const TELEGRAM_CHAT_ID_RE = /^(?:-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;

export function validateTelegramBotToken(token: string): string {
  const trimmed = token.trim();
  if (!TELEGRAM_BOT_TOKEN_RE.test(trimmed)) {
    throw new Error('Invalid Telegram botToken format (expected "<digits>:<token>")');
  }
  return trimmed;
}

export function validateTelegramChatId(chatId: string): string {
  const trimmed = chatId.trim();
  if (!TELEGRAM_CHAT_ID_RE.test(trimmed)) {
    throw new Error('Invalid Telegram chatId format (expected numeric chat ID or @channel_username)');
  }
  return trimmed;
}

function isBlockedIpv4Octets(a: number, b: number, c: number, _d: number): boolean {
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT / Tailscale)
  if (a === 127) return true; // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local / cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24, 192.0.2.0/24
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a >= 224) return true; // multicast & reserved (224.0.0.0/4, 240.0.0.0/4)
  return false;
}

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : -1));
  if (nums.some((n) => n < 0 || n > 255)) return null;
  return [nums[0], nums[1], nums[2], nums[3]];
}

function parseIpv6Groups(rawIp: string): number[] | null {
  const ip = rawIp.toLowerCase().split('%')[0];
  let normalized = ip;

  // Convert trailing embedded IPv4 (e.g. ::ffff:127.0.0.1) to two hex groups
  const lastColon = normalized.lastIndexOf(':');
  if (lastColon >= 0 && normalized.slice(lastColon + 1).includes('.')) {
    const octets = parseIpv4Octets(normalized.slice(lastColon + 1));
    if (!octets) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = `${normalized.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const doubleColonParts = normalized.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseChunk = (s: string): number[] | null => {
    if (!s) return [];
    const items = s.split(':');
    const out: number[] = [];
    for (const item of items) {
      if (!/^[0-9a-f]{1,4}$/.test(item)) return null;
      out.push(parseInt(item, 16));
    }
    return out;
  };

  if (doubleColonParts.length === 1) {
    const groups = parseChunk(doubleColonParts[0]);
    return groups && groups.length === 8 ? groups : null;
  }

  const head = parseChunk(doubleColonParts[0]);
  const tail = parseChunk(doubleColonParts[1]);
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

export function isBlockedIpAddress(rawIp: string): boolean {
  const clean = rawIp.replace(/^\[|\]$/g, '').split('%')[0].trim().toLowerCase();
  const ver = net.isIP(clean);
  if (ver === 4) {
    const octets = parseIpv4Octets(clean);
    return !octets || isBlockedIpv4Octets(...octets);
  }
  if (ver === 6) {
    const g = parseIpv6Groups(clean);
    if (!g) return true;
    // :: (unspecified)
    if (g.every((n) => n === 0)) return true;
    // ::1 (loopback)
    if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true;
    // ::ffff:0:0/96 (IPv4-mapped IPv6)
    if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
      return isBlockedIpv4Octets(g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff);
    }
    // 64:ff9b::/96 (NAT64 embedded IPv4)
    if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
      return isBlockedIpv4Octets(g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff);
    }
    // 2002::/16 (6to4 embedded IPv4)
    if (g[0] === 0x2002) {
      return isBlockedIpv4Octets(g[1] >> 8, g[1] & 0xff, g[2] >> 8, g[2] & 0xff);
    }
    // fc00::/7 (ULA), fe80::/10 (link-local), fec0::/10 (site-local), ff00::/8 (multicast)
    if ((g[0] & 0xfe00) === 0xfc00) return true;
    if ((g[0] & 0xffc0) === 0xfe80) return true;
    if ((g[0] & 0xffc0) === 0xfec0) return true;
    if ((g[0] & 0xff00) === 0xff00) return true;
    return false;
  }
  return false;
}

function isLoopbackHost(hostname: string): boolean {
  const clean = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (clean === 'localhost' || clean === '::1') return true;
  if (net.isIP(clean) === 4) {
    const octets = parseIpv4Octets(clean);
    return Boolean(octets && octets[0] === 127);
  }
  return false;
}

export function validateWebhookUrl(rawUrl: string, opts: ChannelSendOptions = {}): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid webhook URL');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Webhook URL must not embed credentials');
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host) {
    throw new Error('Webhook URL is missing hostname');
  }

  if (opts.allowInsecureLocalhostForTests) {
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && isLoopbackHost(host)) {
      return parsed;
    }
    throw new Error('Test localhost bypass only permits loopback http(s) endpoints');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use https://');
  }

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error(`Webhook host "${host}" is blocked (loopback/local host)`);
  }

  if (net.isIP(host) !== 0) {
    if (isBlockedIpAddress(host)) {
      throw new Error(`Webhook target IP "${host}" is blocked (private/loopback/link-local)`);
    }
  }

  return parsed;
}

async function assertSafeResolvedTarget(parsed: URL, opts: ChannelSendOptions = {}): Promise<void> {
  if (opts.allowInsecureLocalhostForTests) return;
  const host = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (net.isIP(host) !== 0) {
    if (isBlockedIpAddress(host)) {
      throw new Error(`Webhook target IP "${host}" is blocked (private/loopback/link-local)`);
    }
    return;
  }
  const records = await dns.lookup(host, { all: true });
  if (records.length === 0) {
    throw new Error(`Webhook host "${host}" did not resolve`);
  }
  for (const rec of records) {
    if (isBlockedIpAddress(rec.address)) {
      throw new Error(`Webhook host "${host}" resolved to blocked address ${rec.address}`);
    }
  }
}

function sanitizeActionUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete('token');
    parsed.searchParams.delete('pairingToken');
    parsed.searchParams.delete('pin');
    parsed.searchParams.delete('pairingPin');
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function signFeishu(timestampSec: string, secret: string): string {
  const stringToSign = `${timestampSec}\n${secret}`;
  return crypto.createHmac('sha256', stringToSign).update('').digest('base64');
}

export function signDingTalk(timestampMs: number, secret: string): string {
  const stringToSign = `${timestampMs}\n${secret}`;
  const hmac = crypto.createHmac('sha256', secret).update(stringToSign).digest('base64');
  return encodeURIComponent(hmac);
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  opts: ChannelSendOptions = {},
): Promise<void> {
  const parsed = validateWebhookUrl(url, opts);
  await assertSafeResolvedTarget(parsed, opts);
  const res = await fetch(parsed.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

export async function sendToChannel(
  channel: ChannelConfig,
  rawPayload: NotificationPayload,
  opts: ChannelSendOptions = {},
): Promise<ChannelDispatchResult> {
  const title = redactText(rawPayload.title);
  const body = redactText(rawPayload.body);
  const cleanActionUrl = sanitizeActionUrl(rawPayload.actionUrl);
  const footer = cleanActionUrl ? `\nOpen Remote Hub: ${cleanActionUrl}` : '';

  try {
    switch (channel.kind) {
      case 'telegram': {
        if (!channel.botToken || !channel.chatId) {
          return { channelId: channel.id, kind: channel.kind, ok: false, error: 'Missing botToken or chatId' };
        }
        const botToken = validateTelegramBotToken(channel.botToken);
        const chatId = validateTelegramChatId(channel.chatId);
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        await postJson(url, {
          chat_id: chatId,
          text: `${title}\n\n${body}${footer}`,
          disable_web_page_preview: true,
        });
        return { channelId: channel.id, kind: channel.kind, ok: true };
      }

      case 'feishu': {
        if (!channel.webhookUrl) {
          return { channelId: channel.id, kind: channel.kind, ok: false, error: 'Missing webhookUrl' };
        }
        const payload: Record<string, unknown> = {
          msg_type: 'interactive',
          card: {
            header: {
              title: { tag: 'plain_text', content: title },
              template:
                rawPayload.level === 'warn' ? 'orange' : rawPayload.level === 'success' ? 'green' : 'blue',
            },
            elements: [
              { tag: 'markdown', content: `${body}${footer}` },
            ],
          },
        };
        if (channel.secret) {
          const ts = String(Math.floor(Date.now() / 1000));
          payload.timestamp = ts;
          payload.sign = signFeishu(ts, channel.secret);
        }
        await postJson(channel.webhookUrl, payload, opts);
        return { channelId: channel.id, kind: channel.kind, ok: true };
      }

      case 'dingtalk': {
        if (!channel.webhookUrl) {
          return { channelId: channel.id, kind: channel.kind, ok: false, error: 'Missing webhookUrl' };
        }
        const validated = validateWebhookUrl(channel.webhookUrl, opts);
        if (channel.secret) {
          const ts = Date.now();
          const sign = signDingTalk(ts, channel.secret);
          validated.searchParams.set('timestamp', String(ts));
          validated.searchParams.set('sign', decodeURIComponent(sign));
        }
        await postJson(
          validated.toString(),
          {
            msgtype: 'markdown',
            markdown: { title, text: `### ${title}\n\n${body}${footer}` },
          },
          opts,
        );
        return { channelId: channel.id, kind: channel.kind, ok: true };
      }

      case 'wecom': {
        if (!channel.webhookUrl) {
          return { channelId: channel.id, kind: channel.kind, ok: false, error: 'Missing webhookUrl' };
        }
        await postJson(
          channel.webhookUrl,
          {
            msgtype: 'markdown',
            markdown: { content: `**${title}**\n${body}${footer}` },
          },
          opts,
        );
        return { channelId: channel.id, kind: channel.kind, ok: true };
      }

      case 'slack': {
        if (!channel.webhookUrl) {
          return { channelId: channel.id, kind: channel.kind, ok: false, error: 'Missing webhookUrl' };
        }
        await postJson(channel.webhookUrl, { text: `*${title}*\n${body}${footer}` }, opts);
        return { channelId: channel.id, kind: channel.kind, ok: true };
      }

      case 'discord': {
        if (!channel.webhookUrl) {
          return { channelId: channel.id, kind: channel.kind, ok: false, error: 'Missing webhookUrl' };
        }
        await postJson(channel.webhookUrl, { content: `**${title}**\n${body}${footer}` }, opts);
        return { channelId: channel.id, kind: channel.kind, ok: true };
      }

      default: {
        if (!channel.webhookUrl) {
          return { channelId: channel.id, kind: channel.kind, ok: false, error: 'Missing webhookUrl' };
        }
        await postJson(
          channel.webhookUrl,
          { title, body, level: rawPayload.level, actionUrl: cleanActionUrl },
          opts,
        );
        return { channelId: channel.id, kind: channel.kind, ok: true };
      }
    }
  } catch (err) {
    return {
      channelId: channel.id,
      kind: channel.kind,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function broadcastChannels(
  channels: ChannelConfig[],
  payload: NotificationPayload,
  opts: ChannelSendOptions = {},
): Promise<ChannelDispatchResult[]> {
  const active = channels.filter((c) => c.enabled);
  if (active.length === 0) return [];
  return Promise.all(active.map((c) => sendToChannel(c, payload, opts)));
}
