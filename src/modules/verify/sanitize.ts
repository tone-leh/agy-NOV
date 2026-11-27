import { redactSecretsLinear, stripPrivateBlocksLinear } from '../../core/sanitize.js';

/**
 * Supplemental Verify-specific redaction rules preserving legacy coverage for shorter
 * tokens, Stripe `sk_live_` underscore prefixes, and quoted `secret`/`authorization` keys
 * on top of the shared `redactSecretsLinear` kernel.
 */
const VERIFY_EXTRA_REDACTION_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]'],
  [
    /\b(?:sk-ant-[A-Za-z0-9_-]{12,}|sk-proj-[A-Za-z0-9_-]{12,}|sk_live_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|ghu_[A-Za-z0-9]{16,}|ghs_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g,
    '[REDACTED_KEY]',
  ],
  [
    /(["']?(?:api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?token|auth[_-]?token|secret|password|passwd|authorization)["']?\s*[:=]\s*["']?)(?!\[REDACTED)([^\s"',;}{]{8,})(["']?)/gi,
    '$1[REDACTED]$3',
  ],
];

/**
 * Linear O(n) redactor for Verify Gate command output, summaries, and PR evidence.
 * Reuses the shared `stripPrivateBlocksLinear` and `redactSecretsLinear` kernel while
 * preserving exact `[REDACTED_PRIVATE]` output and O(n) pass-through on malformed
 * bracket-less `<private ` sequences.
 */
export function redactVerifyOutput(input: string): string {
  if (!input) return '';
  let out =
    input.includes('<') && input.includes('>')
      ? stripPrivateBlocksLinear(input, '[REDACTED_PRIVATE]')
      : input;
  out = redactSecretsLinear(out);
  for (const [pattern, replacement] of VERIFY_EXTRA_REDACTION_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function formatFailureTailSnippet(outputTail: string, maxLines = 4, maxChars = 280): string {
  const lines = redactVerifyOutput(outputTail)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';
  const tail = lines.slice(-maxLines).join(' | ');
  return tail.length > maxChars ? `…${tail.slice(tail.length - (maxChars - 1))}` : tail;
}
