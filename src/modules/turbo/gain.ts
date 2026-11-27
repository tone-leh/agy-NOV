// ============================================================================
// <=8.8KB Anti-Spill Tool Text Guardrail & Cumulative Token Gain Ledger
// ============================================================================

export const TURBO_MAX_TOOL_TEXT_BYTES = 8800; // <= 8.8 KB anti-host-disk-spill guardrail
export const TURBO_INPUT_USD_PER_MILLION_TOKENS = 2.5;
export const TURBO_GAIN_MAX_RECENT = 20;

export interface ToolTextGuardrailResult {
  text: string;
  capped: boolean;
  bytes: number;
  originalBytes: number;
}

export type TurboGainOperation = 'batch_search' | 'read_outline' | 'compact_output';

export interface TurboGainRecordInput {
  op: TurboGainOperation;
  label: string;
  rawTokens: number;
  returnedTokens: number;
  guardrailApplied?: boolean;
  timestamp?: string;
}

export interface TurboGainRecentEntry {
  op: TurboGainOperation;
  label: string;
  rawTokens: number;
  returnedTokens: number;
  savedTokens: number;
  savedPercent: number;
  estimatedSavedUsd: number;
  guardrailApplied: boolean;
  timestamp: string;
}

export interface TurboGainOperationBucket {
  operations: number;
  rawTokens: number;
  returnedTokens: number;
  savedTokens: number;
  savedPercent: number;
  estimatedSavedUsd: number;
}

export interface TurboGainSummary {
  totalOperations: number;
  totalRawTokens: number;
  totalReturnedTokens: number;
  totalSavedTokens: number;
  avgCompressionPercent: number;
  estimatedSavedUsd: number;
  guardrailTriggeredCount: number;
  byOperation: {
    search: TurboGainOperationBucket;
    outline: TurboGainOperationBucket;
    compact: TurboGainOperationBucket;
  };
  recent: TurboGainRecentEntry[];
}

function utf8ByteLengthOfCodePoint(cp: number): number {
  if (cp <= 0x7f) return 1;
  if (cp <= 0x7ff) return 2;
  if (cp <= 0xffff) return 3;
  return 4;
}

function truncateToUtf8BytesSafe(input: string, maxBytes: number): string {
  if (maxBytes <= 0 || input.length === 0) return '';
  let bytes = 0;
  let i = 0;
  while (i < input.length) {
    const codeUnit = input.charCodeAt(i);
    let cp = codeUnit;
    let step = 1;
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && i + 1 < input.length) {
      const low = input.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = ((codeUnit - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
        step = 2;
      }
    }
    const charBytes =
      codeUnit >= 0xd800 && codeUnit <= 0xdfff && step === 1
        ? 3
        : utf8ByteLengthOfCodePoint(cp);
    if (bytes + charBytes > maxBytes) {
      break;
    }
    bytes += charBytes;
    i += step;
  }
  return input.slice(0, i);
}

function truncatePrefixSafe(input: string, maxBytes: number): string {
  if (maxBytes <= 0 || input.length === 0) return '';
  let safe = truncateToUtf8BytesSafe(input, maxBytes);
  const lastNl = safe.lastIndexOf('\n');
  if (lastNl > 0 && lastNl >= Math.floor(safe.length * 0.8)) {
    safe = safe.slice(0, lastNl);
  }
  return safe;
}

export function enforceToolTextGuardrail(
  text: string,
  hint?: string,
): ToolTextGuardrailResult {
  const source = typeof text === 'string' ? text : String(text ?? '');
  const originalBytes = Buffer.byteLength(source, 'utf8');
  if (originalBytes <= TURBO_MAX_TOOL_TEXT_BYTES) {
    return {
      text: source,
      capped: false,
      bytes: originalBytes,
      originalBytes,
    };
  }

  const cleanHint = typeof hint === 'string' ? hint.replace(/[\r\n]+/g, ' ').trim() : '';
  const boundedHint = cleanHint ? truncateToUtf8BytesSafe(cleanHint, 512) : '';
  const suffix = boundedHint
    ? `\n\n[Turbo <=8.8KB guardrail: truncated from ${originalBytes} bytes to <=${TURBO_MAX_TOOL_TEXT_BYTES} bytes to avoid host disk spill. ${boundedHint}]`
    : `\n\n[Turbo <=8.8KB guardrail: truncated from ${originalBytes} bytes to <=${TURBO_MAX_TOOL_TEXT_BYTES} bytes to avoid host disk spill. Narrow the line range, search scope, or query the indexed chunkId.]`;

  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  const prefixBudget = Math.max(0, TURBO_MAX_TOOL_TEXT_BYTES - suffixBytes);
  const prefix = truncatePrefixSafe(source, prefixBudget);
  let finalText = `${prefix}${suffix}`;
  let finalBytes = Buffer.byteLength(finalText, 'utf8');

  if (finalBytes > TURBO_MAX_TOOL_TEXT_BYTES) {
    finalText = truncateToUtf8BytesSafe(finalText, TURBO_MAX_TOOL_TEXT_BYTES);
    finalBytes = Buffer.byteLength(finalText, 'utf8');
  }

  return {
    text: finalText,
    capped: true,
    bytes: finalBytes,
    originalBytes,
  };
}

export function estimateSavedUsd(savedTokens: number): number {
  if (!Number.isFinite(savedTokens) || savedTokens <= 0) return 0;
  return Number(((savedTokens / 1_000_000) * TURBO_INPUT_USD_PER_MILLION_TOKENS).toFixed(4));
}

function emptyGainBucket(): TurboGainOperationBucket {
  return {
    operations: 0,
    rawTokens: 0,
    returnedTokens: 0,
    savedTokens: 0,
    savedPercent: 0,
    estimatedSavedUsd: 0,
  };
}

export class TurboGainTracker {
  private readonly maxRecent: number;
  private totalOperations = 0;
  private totalRawTokens = 0;
  private totalReturnedTokens = 0;
  private totalSavedTokens = 0;
  private guardrailTriggeredCount = 0;
  private readonly buckets: {
    search: { operations: number; rawTokens: number; returnedTokens: number; savedTokens: number };
    outline: { operations: number; rawTokens: number; returnedTokens: number; savedTokens: number };
    compact: { operations: number; rawTokens: number; returnedTokens: number; savedTokens: number };
  } = {
    search: { operations: 0, rawTokens: 0, returnedTokens: 0, savedTokens: 0 },
    outline: { operations: 0, rawTokens: 0, returnedTokens: 0, savedTokens: 0 },
    compact: { operations: 0, rawTokens: 0, returnedTokens: 0, savedTokens: 0 },
  };
  private readonly recentEntries: TurboGainRecentEntry[] = [];

  constructor(maxRecent = TURBO_GAIN_MAX_RECENT) {
    this.maxRecent = Math.max(1, Math.min(Math.floor(maxRecent), 100));
  }

  record(input: TurboGainRecordInput): TurboGainRecentEntry {
    const rawTokens =
      Number.isFinite(input.rawTokens) && input.rawTokens > 0 ? Math.round(input.rawTokens) : 0;
    const returnedTokens =
      Number.isFinite(input.returnedTokens) && input.returnedTokens > 0
        ? Math.round(input.returnedTokens)
        : 0;
    const savedTokens = Math.max(0, rawTokens - returnedTokens);
    const savedPercent =
      rawTokens > 0 ? Math.max(0, Math.min(100, Math.round((savedTokens / rawTokens) * 100))) : 0;
    const estimatedSavedUsd = estimateSavedUsd(savedTokens);
    const guardrailApplied = Boolean(input.guardrailApplied);
    const safeLabel =
      (input.label || input.op).replace(/[\r\n\t\x00-\x1f]/g, ' ').trim().slice(0, 80) || input.op;
    const timestamp = input.timestamp ?? new Date().toISOString();

    const entry: TurboGainRecentEntry = {
      op: input.op,
      label: safeLabel,
      rawTokens,
      returnedTokens,
      savedTokens,
      savedPercent,
      estimatedSavedUsd,
      guardrailApplied,
      timestamp,
    };

    this.totalOperations += 1;
    this.totalRawTokens += rawTokens;
    this.totalReturnedTokens += returnedTokens;
    this.totalSavedTokens += savedTokens;
    if (guardrailApplied) {
      this.guardrailTriggeredCount += 1;
    }

    const bucketKey =
      input.op === 'batch_search' ? 'search' : input.op === 'read_outline' ? 'outline' : 'compact';
    const bucket = this.buckets[bucketKey];
    bucket.operations += 1;
    bucket.rawTokens += rawTokens;
    bucket.returnedTokens += returnedTokens;
    bucket.savedTokens += savedTokens;

    this.recentEntries.unshift(entry);
    if (this.recentEntries.length > this.maxRecent) {
      this.recentEntries.length = this.maxRecent;
    }

    return entry;
  }

  getSummary(): TurboGainSummary {
    const formatBucket = (b: {
      operations: number;
      rawTokens: number;
      returnedTokens: number;
      savedTokens: number;
    }): TurboGainOperationBucket => {
      if (b.operations === 0) return emptyGainBucket();
      return {
        operations: b.operations,
        rawTokens: b.rawTokens,
        returnedTokens: b.returnedTokens,
        savedTokens: b.savedTokens,
        savedPercent:
          b.rawTokens > 0
            ? Math.max(0, Math.min(100, Math.round((b.savedTokens / b.rawTokens) * 100)))
            : 0,
        estimatedSavedUsd: estimateSavedUsd(b.savedTokens),
      };
    };

    const avgCompressionPercent =
      this.totalRawTokens > 0
        ? Math.max(0, Math.min(100, Math.round((this.totalSavedTokens / this.totalRawTokens) * 100)))
        : 0;

    return {
      totalOperations: this.totalOperations,
      totalRawTokens: this.totalRawTokens,
      totalReturnedTokens: this.totalReturnedTokens,
      totalSavedTokens: this.totalSavedTokens,
      avgCompressionPercent,
      estimatedSavedUsd: estimateSavedUsd(this.totalSavedTokens),
      guardrailTriggeredCount: this.guardrailTriggeredCount,
      byOperation: {
        search: formatBucket(this.buckets.search),
        outline: formatBucket(this.buckets.outline),
        compact: formatBucket(this.buckets.compact),
      },
      recent: this.recentEntries.map((r) => ({ ...r })),
    };
  }

  clear(): void {
    this.totalOperations = 0;
    this.totalRawTokens = 0;
    this.totalReturnedTokens = 0;
    this.totalSavedTokens = 0;
    this.guardrailTriggeredCount = 0;
    this.buckets.search = { operations: 0, rawTokens: 0, returnedTokens: 0, savedTokens: 0 };
    this.buckets.outline = { operations: 0, rawTokens: 0, returnedTokens: 0, savedTokens: 0 };
    this.buckets.compact = { operations: 0, rawTokens: 0, returnedTokens: 0, savedTokens: 0 };
    this.recentEntries.length = 0;
  }
}
