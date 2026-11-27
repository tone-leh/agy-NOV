/**
 * Unified linear O(n) sanitization & secret-redaction kernel for agy-NOV.
 *
 * Single source of truth shared across Core, Feed, Hooks, and all 13 Domain Modules so
 * `<private>` stripping, PEM/API key redaction, and sensitive-path checks remain consistent
 * and immune to ReDoS catastrophic backtracking.
 */

export interface StripPrivateResult {
  text: string;
  strippedCount: number;
  hasUnclosedTag: boolean;
}

export interface RedactTextOptions {
  /** Whether to strip `<private>...</private>` blocks before applying secret regexes. Default: `false`. */
  stripPrivate?: boolean;
  /** Replacement text for stripped `<private>` blocks. Default: `''`. */
  privateReplacement?: string;
  /** Optional max output length truncation (appends `...` when exceeded). */
  maxLength?: number;
}

export interface HighConfidenceSecretMatch {
  ruleId: string;
  label: string;
}

const PRIVATE_OPEN_PREFIX = '<private';
const PRIVATE_CLOSE_PREFIX = '</private';

function isTagDelimiter(ch: string | undefined): boolean {
  return ch === undefined || ch === '>' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '/';
}

/**
 * Single-pass O(n) stripper for `<private>...</private>` blocks (case-insensitive, supports
 * nested tags and fails closed on unclosed `<private>` tags by redacting to end of input).
 */
export function stripPrivateBlocksWithStats(
  input: string,
  replacement = '',
): StripPrivateResult {
  if (!input || (!input.includes('<') && !input.includes('>'))) {
    return { text: input, strippedCount: 0, hasUnclosedTag: false };
  }

  const lower = input.toLowerCase();
  const len = input.length;
  const out: string[] = [];
  let depth = 0;
  let strippedCount = 0;
  let cursor = 0;
  let i = 0;

  while (i < len) {
    if (lower[i] !== '<') {
      i += 1;
      continue;
    }

    if (
      lower.startsWith(PRIVATE_OPEN_PREFIX, i) &&
      isTagDelimiter(lower[i + PRIVATE_OPEN_PREFIX.length])
    ) {
      const closeBracket = input.indexOf('>', i + PRIVATE_OPEN_PREFIX.length);
      const nextLt = input.indexOf('<', i + PRIVATE_OPEN_PREFIX.length);
      if (nextLt !== -1 && (closeBracket === -1 || nextLt < closeBracket)) {
        // Malformed open tag containing nested '<' before '>' — treat '<' as literal text
        i += 1;
        continue;
      }
      if (closeBracket === -1) {
        if (depth === 0) {
          out.push(input.slice(cursor, i));
          if (replacement) out.push(replacement);
          strippedCount += 1;
        }
        return { text: out.join(''), strippedCount, hasUnclosedTag: true };
      }
      const isSelfClosing = input[closeBracket - 1] === '/';
      if (depth === 0) {
        out.push(input.slice(cursor, i));
        if (replacement) out.push(replacement);
        strippedCount += 1;
      }
      if (!isSelfClosing) {
        depth += 1;
      }
      i = closeBracket + 1;
      if (depth === 0) {
        cursor = i;
      }
      continue;
    }

    if (
      lower.startsWith(PRIVATE_CLOSE_PREFIX, i) &&
      isTagDelimiter(lower[i + PRIVATE_CLOSE_PREFIX.length])
    ) {
      const closeBracket = input.indexOf('>', i + PRIVATE_CLOSE_PREFIX.length);
      if (closeBracket === -1) {
        if (depth === 0) {
          out.push(input.slice(cursor, i));
        }
        return { text: out.join(''), strippedCount, hasUnclosedTag: depth > 0 };
      }
      if (depth > 0) {
        depth -= 1;
        i = closeBracket + 1;
        if (depth === 0) {
          cursor = i;
        }
        continue;
      }
      // Stray closing tag at depth 0: strip tag itself
      out.push(input.slice(cursor, i));
      i = closeBracket + 1;
      cursor = i;
      continue;
    }

    i += 1;
  }

  if (depth === 0) {
    out.push(input.slice(cursor));
  }
  return {
    text: out.join(''),
    strippedCount,
    hasUnclosedTag: depth > 0,
  };
}

export function stripPrivateBlocksLinear(input: string, replacement = ''): string {
  return stripPrivateBlocksWithStats(input, replacement).text;
}

/**
 * Linear O(n) PEM/PGP private key block redactor (handles complete and truncated multiline blocks
 * without backtracking regexes; fails closed to end of input when closing trailer is truncated).
 */
export function redactPemBlocksLinear(input: string, placeholder = '[REDACTED_PRIVATE_KEY]'): string {
  if (!input || !input.includes('-----')) return input;
  const upper = input.toUpperCase();
  const beginMarker = '-----BEGIN ';
  if (!upper.includes(beginMarker)) return input;

  const out: string[] = [];
  let cursor = 0;
  let searchPos = 0;

  while (searchPos < input.length) {
    const startIdx = upper.indexOf(beginMarker, searchPos);
    if (startIdx === -1) break;
    const headerEnd = input.indexOf('-----', startIdx + beginMarker.length);
    if (headerEnd === -1) break;
    const headerLabel = upper.slice(startIdx + beginMarker.length, headerEnd);
    if (!/^[A-Z0-9 _-]{0,48}PRIVATE KEY(?: BLOCK)?$/.test(headerLabel)) {
      searchPos = headerEnd + 5;
      continue;
    }

    out.push(input.slice(cursor, startIdx));
    out.push(placeholder);

    const endPrefix = '-----END ';
    let endIdx = upper.indexOf(endPrefix, headerEnd + 5);
    let closedAt = -1;
    while (endIdx !== -1) {
      const footerEnd = input.indexOf('-----', endIdx + endPrefix.length);
      if (footerEnd === -1) break;
      const endLabel = upper.slice(endIdx + endPrefix.length, footerEnd);
      if (/^[A-Z0-9 _-]{0,48}PRIVATE KEY(?: BLOCK)?$/.test(endLabel)) {
        closedAt = footerEnd + 5;
        break;
      }
      endIdx = upper.indexOf(endPrefix, footerEnd + 5);
    }

    // Truncated PEM/PGP private key: fail closed by redacting through end of input
    cursor = closedAt === -1 ? input.length : closedAt;
    searchPos = cursor;
  }

  if (cursor < input.length) {
    out.push(input.slice(cursor));
  }
  return out.join('');
}

/**
 * Single-pass O(n) redactor for generic URLs containing "webhook" without nested backtracking.
 */
export function redactGenericWebhookUrlsLinear(input: string): string {
  if (!input || !input.includes('://')) return input;
  return input.replace(/https?:\/\/[^\s"'<>]+/gi, (match) =>
    match.toLowerCase().includes('webhook') ? '[REDACTED_WEBHOOK]' : match,
  );
}

/**
 * Truncates text without splitting UTF-16 surrogate pairs (e.g. emoji or CJK extension B).
 */
export function truncateUtf16Safe(input: string, maxLen: number, ellipsis = '…'): string {
  if (maxLen <= 0 || input.length <= maxLen) return input;
  let end = Math.max(1, maxLen - ellipsis.length);
  if (end > 0) {
    const code = input.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      end = Math.max(0, end - 1);
    }
  }
  return `${input.slice(0, end).trimEnd()}${ellipsis}`;
}

const SECRET_REPLACEMENT_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // Webhook URLs with embedded secrets
  [/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/open\.(?:feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/oapi\.dingtalk\.com\/robot\/send\?[^\s"'<>]+/gi, '[REDACTED_WEBHOOK]'],
  [/https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?[^\s"'<>]+/gi, '[REDACTED_WEBHOOK]'],
  // URL basic-auth credentials (`https://user:pass@host`)
  [/(https?:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi, '$1[REDACTED]$3'],
  // Sensitive query parameters
  [/([?&](?:token|access_token|api[_-]?key|key|secret|sign|sig|pin|code|password)=)([^&#\s"'<>]+)/gi, '$1[REDACTED]'],
  // Authorization headers (including custom schemes like Token / ApiKey / Digest / HMAC)
  [
    /\b(Authorization[ \t]*:[ \t]*(?:Bearer|Basic|Token|ApiKey|Digest|HMAC)[ \t]+)([^\s"',;}{]+)/gi,
    '$1[REDACTED]',
  ],
  [/\bBearer[ \t]+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]'],
  [/\bBasic[ \t]+[A-Za-z0-9+/]+=*/gi, 'Basic [REDACTED]'],
  // JWT tokens
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]'],
  // Telegram bot tokens (`123456789:AA...`)
  [/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_BOT_TOKEN]'],
  // Well-known provider API tokens
  [
    /\b(?:sk-proj-|sk-ant-|sk_(?:live|test)_|sk-|AIza|gh[pousr]_|github_pat_|glpat-|xox[baprs]-|AKIA|ASIA|npm_|hf_|pypi-)[A-Za-z0-9_-]{10,}\b/g,
    '[REDACTED_KEY]',
  ],
  // Uppercase environment variable secret assignments (e.g. OPENAI_API_KEY=..., MY_TOKEN=...)
  [
    /\b([A-Z][A-Z0-9_]{1,40}_(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|WEBHOOK|PIN|AUTH|CREDENTIAL|CREDENTIALS)[ \t]*=[ \t]*["']?)([^\s"',;}{]+)(["']?)/g,
    '$1[REDACTED]$3',
  ],
  // Key-value secret/token/pairing-code assignments (stops before &/# so non-secret URL params survive)
  [
    /(["']?(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|bot[_-]?token|pairing[_-]?token|pairing[_-]?pin|pairing[_ -]?code|pair[_-]?code|passcode|signing[_-]?secret|client[_-]?secret|private[_-]?key|secret[_-]?key|csrf[_-]?token|webhook[_-]?secret|webhook[_-]?url|webhook|secret|token|password|passwd|authorization|pin)["']?[ \t]*[:=][ \t]*["']?)([^\s"',;}{`&#]{4,})(["']?)/gi,
    '$1[REDACTED]$3',
  ],
];

/**
 * Unified linear O(n) secret redaction helper.
 */
export function redactSecretsLinear(input: string, options: RedactTextOptions = {}): string {
  if (!input) return '';
  let text = options.stripPrivate
    ? stripPrivateBlocksLinear(input, options.privateReplacement ?? '')
    : input;

  text = redactPemBlocksLinear(text);
  text = redactGenericWebhookUrlsLinear(text);
  for (const [regex, replacement] of SECRET_REPLACEMENT_RULES) {
    text = text.replace(regex, replacement);
  }

  if (typeof options.maxLength === 'number' && options.maxLength > 0 && text.length > options.maxLength) {
    return truncateUtf16Safe(text, options.maxLength, '...');
  }
  return text;
}

const HIGH_CONFIDENCE_SECRET_PATTERNS: ReadonlyArray<{
  ruleId: string;
  label: string;
  regex: RegExp;
}> = [
  {
    ruleId: 'inbound.pem-private-key',
    label: 'PEM Private Key block',
    regex: /-----BEGIN\s+[A-Z0-9 ]{0,40}PRIVATE KEY-----/i,
  },
  {
    ruleId: 'inbound.openai-anthropic-key',
    label: 'OpenAI / Anthropic API key',
    regex: /\bsk-(?:proj-|ant-|live-)[A-Za-z0-9_-]{20,256}\b/,
  },
  {
    ruleId: 'inbound.github-token',
    label: 'GitHub personal access token',
    regex: /\b(?:gh[opusr]_[A-Za-z0-9_]{24,128}|github_pat_[A-Za-z0-9_]{24,256})\b/,
  },
  {
    ruleId: 'inbound.google-api-key',
    label: 'Google Cloud / Gemini API key',
    regex: /\bAIza[0-9A-Za-z\-_]{30,64}\b/,
  },
  {
    ruleId: 'inbound.aws-access-key',
    label: 'AWS Access Key ID',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    ruleId: 'inbound.slack-token',
    label: 'Slack API token',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{16,128}\b/,
  },
  {
    ruleId: 'inbound.gitlab-npm-hf-pypi-token',
    label: 'Package / platform secret token',
    regex: /\b(?:glpat-[A-Za-z0-9_-]{20,128}|npm_[A-Za-z0-9]{24,128}|hf_[A-Za-z0-9]{24,128}|pypi-[A-Za-z0-9_-]{24,256})\b/,
  },
];

/**
 * Low-false-positive high-confidence secret detector for PreInvocation inbound user-prompt gating.
 * Never returns raw secret values — returns rule metadata only.
 */
export function detectHighConfidenceSecrets(input: string): HighConfidenceSecretMatch[] {
  if (!input || input.length < 16) return [];
  // Ignore already redacted placeholder strings
  const matches: HighConfidenceSecretMatch[] = [];
  for (const rule of HIGH_CONFIDENCE_SECRET_PATTERNS) {
    if (rule.regex.test(input)) {
      matches.push({ ruleId: rule.ruleId, label: rule.label });
    }
  }
  return matches;
}

const SAFE_ENV_TEMPLATE_SUFFIXES = ['.example', '.sample', '.template', '.dist', '.schema'];

/**
 * Cross-platform sensitive file path detector shared across Guard, Mem, Ops, and Team Config.
 */
export function isSensitivePathSegment(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, '/').trim();
  if (!norm) return false;
  const segments = norm.split('/').filter(Boolean);
  const base = (segments[segments.length - 1] ?? '').toLowerCase();

  if (base === '.env' || base === '.envrc' || base.startsWith('.env.')) {
    const isSafeTemplate =
      base.startsWith('.env.') && SAFE_ENV_TEMPLATE_SUFFIXES.some((s) => base.endsWith(s));
    if (!isSafeTemplate) return true;
  }

  if (
    base === 'id_rsa' ||
    base === 'id_ed25519' ||
    base === 'id_dsa' ||
    base === 'id_ecdsa' ||
    base === '.netrc' ||
    base === '.npmrc' ||
    base === '.pypirc'
  ) {
    return true;
  }

  if (/\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(base)) return true;
  if (/service[-_]?account.*\.json$/i.test(base)) return true;
  if (/(?:^|\/)\.(?:ssh|gnupg)(?:\/|$)/i.test(norm)) return true;
  if (/(?:^|\/)\.aws\/(?:credentials|config)(?:\/|$)/i.test(norm)) return true;
  if (/(?:^|\/)\.kube\/config$/i.test(norm)) return true;

  return false;
}
