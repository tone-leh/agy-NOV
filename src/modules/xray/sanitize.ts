const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Bearer & JWT tokens
  { pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replacement: '[REDACTED_JWT]' },
  // Common provider API keys
  {
    pattern:
      /\b(sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z\-_]{24,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g,
    replacement: '[REDACTED_KEY]',
  },
  // Generic key/secret/token assignments in env or JSON
  {
    pattern:
      /(["']?(?:api[_-]?key|secret|token|password|passwd|authorization|csrf[_-]?token)["']?\s*[:=]\s*["']?)([^\s"',;}{]{8,})(["']?)/gi,
    replacement: '$1[REDACTED]$3',
  },
  // Private key blocks
  {
    pattern: /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
