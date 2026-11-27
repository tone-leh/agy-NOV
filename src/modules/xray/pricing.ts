import fs from 'node:fs';
import path from 'node:path';

/**
 * Offline reference pricing per 1M tokens in USD.
 * All built-in values are conservative offline estimates for local cost visibility.
 */
export interface ModelPricingRate {
  inputPerM: number;
  cacheReadPerM: number;
  outputPerM: number;
}

export type PricingOverrideMap = Record<string, ModelPricingRate>;

export type PricingSource = 'override' | 'builtin-estimated' | 'fallback-estimated';

export interface TokenUsageInput {
  freshInputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

export interface TokenCostEstimate {
  model: string;
  matchedRule: string;
  totalUsd: number;
  inputUsd: number;
  cacheReadUsd: number;
  outputUsd: number;
  cacheSavingsUsd: number;
  pricingSource: PricingSource;
  estimated: true;
  rate: ModelPricingRate;
}

const MAX_OVERRIDES_FILE_BYTES = 1024 * 1024; // 1 MiB safety cap

/**
 * Built-in offline reference rates (USD per 1M tokens).
 * Matched longest-prefix first after normalizing provider prefixes.
 */
export const BUILTIN_MODEL_PRICING: Readonly<Record<string, ModelPricingRate>> = Object.freeze({
  'gemini-4-neon': { inputPerM: 2.5, cacheReadPerM: 0.25, outputPerM: 12.0 },
  'gemini-4-hydrogen': { inputPerM: 1.5, cacheReadPerM: 0.15, outputPerM: 8.0 },
  'gemini-4-pro': { inputPerM: 2.0, cacheReadPerM: 0.2, outputPerM: 10.0 },
  'gemini-4-flash': { inputPerM: 0.3, cacheReadPerM: 0.03, outputPerM: 1.5 },
  'gemini-3-pro': { inputPerM: 1.75, cacheReadPerM: 0.18, outputPerM: 9.0 },
  'gemini-3-flash': { inputPerM: 0.25, cacheReadPerM: 0.025, outputPerM: 1.25 },
  'gemini-3': { inputPerM: 1.25, cacheReadPerM: 0.125, outputPerM: 6.0 },
  'gemini-2.5-pro': { inputPerM: 1.25, cacheReadPerM: 0.125, outputPerM: 10.0 },
  'gemini-2.5-flash': { inputPerM: 0.3, cacheReadPerM: 0.03, outputPerM: 2.5 },
  'gemini-2.0-flash': { inputPerM: 0.1, cacheReadPerM: 0.025, outputPerM: 0.4 },
  'claude-opus': { inputPerM: 15.0, cacheReadPerM: 1.5, outputPerM: 75.0 },
  'claude-sonnet': { inputPerM: 3.0, cacheReadPerM: 0.3, outputPerM: 15.0 },
  'claude-haiku': { inputPerM: 0.8, cacheReadPerM: 0.08, outputPerM: 4.0 },
  'gpt-5-mini': { inputPerM: 0.25, cacheReadPerM: 0.025, outputPerM: 2.0 },
  'gpt-5': { inputPerM: 1.25, cacheReadPerM: 0.125, outputPerM: 10.0 },
  'gpt-4o-mini': { inputPerM: 0.15, cacheReadPerM: 0.075, outputPerM: 0.6 },
  'gpt-4o': { inputPerM: 2.5, cacheReadPerM: 1.25, outputPerM: 10.0 },
  'o3-mini': { inputPerM: 1.1, cacheReadPerM: 0.55, outputPerM: 4.4 },
  o3: { inputPerM: 2.0, cacheReadPerM: 0.5, outputPerM: 8.0 },
});

export const FALLBACK_PRICING_RATE: Readonly<ModelPricingRate> = Object.freeze({
  inputPerM: 1.5,
  cacheReadPerM: 0.15,
  outputPerM: 6.0,
});

const BUILTIN_KEYS_DESC = Object.keys(BUILTIN_MODEL_PRICING).sort((a, b) => b.length - a.length);

const PROVIDER_PREFIX_RE =
  /^(?:models|google|vertex|anthropic|openai|azure|bedrock|openrouter)\//i;

export function normalizeModelName(model: string | undefined): string {
  const trimmed = (model ?? '').trim().toLowerCase();
  if (!trimmed) return 'unknown';
  let normalized = trimmed;
  while (PROVIDER_PREFIX_RE.test(normalized)) {
    normalized = normalized.replace(PROVIDER_PREFIX_RE, '');
  }
  return normalized || 'unknown';
}

const MAX_REASONABLE_RATE_PER_M = 10_000;
const FORBIDDEN_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

function isValidRate(candidate: unknown): candidate is ModelPricingRate {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const obj = candidate as Record<string, unknown>;
  const { inputPerM, cacheReadPerM, outputPerM } = obj;
  return (
    typeof inputPerM === 'number' &&
    Number.isFinite(inputPerM) &&
    inputPerM >= 0 &&
    inputPerM <= MAX_REASONABLE_RATE_PER_M &&
    typeof cacheReadPerM === 'number' &&
    Number.isFinite(cacheReadPerM) &&
    cacheReadPerM >= 0 &&
    cacheReadPerM <= MAX_REASONABLE_RATE_PER_M &&
    typeof outputPerM === 'number' &&
    Number.isFinite(outputPerM) &&
    outputPerM >= 0 &&
    outputPerM <= MAX_REASONABLE_RATE_PER_M
  );
}

function sanitizeOverridesRecord(raw: unknown): PricingOverrideMap {
  const out = Object.create(null) as PricingOverrideMap;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  const container =
    Object.prototype.hasOwnProperty.call(obj, 'models') &&
    obj.models &&
    typeof obj.models === 'object' &&
    !Array.isArray(obj.models)
      ? (obj.models as Record<string, unknown>)
      : Object.prototype.hasOwnProperty.call(obj, 'overrides') &&
          obj.overrides &&
          typeof obj.overrides === 'object' &&
          !Array.isArray(obj.overrides)
        ? (obj.overrides as Record<string, unknown>)
        : obj;

  for (const key of Object.keys(container)) {
    if (FORBIDDEN_OVERRIDE_KEYS.has(key)) continue;
    const cleanKey = normalizeModelName(key);
    if (!cleanKey || cleanKey === 'unknown' || FORBIDDEN_OVERRIDE_KEYS.has(cleanKey)) continue;
    const value = container[key];
    if (!isValidRate(value)) continue;
    out[cleanKey] = {
      inputPerM: value.inputPerM,
      cacheReadPerM: value.cacheReadPerM,
      outputPerM: value.outputPerM,
    };
  }
  return out;
}

/**
 * Strictly read-only loader for `<dataDir>/modules/xray/pricing-overrides.json`
 * (or `<moduleDataDir>/pricing-overrides.json` when given the xray module dir directly).
 * Never creates directories or writes files; invalid JSON silently falls back to `{}`.
 */
export function loadPricingOverrides(dataDir?: string): PricingOverrideMap {
  if (!dataDir || !dataDir.trim()) return {};
  const resolved = path.resolve(dataDir);
  const candidates = [
    path.join(resolved, 'pricing-overrides.json'),
    path.join(resolved, 'modules', 'xray', 'pricing-overrides.json'),
  ];

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_OVERRIDES_FILE_BYTES) {
        continue;
      }
      const rawText = fs.readFileSync(filePath, 'utf8');
      const parsed: unknown = JSON.parse(rawText);
      return sanitizeOverridesRecord(parsed);
    } catch {
      // Corrupt JSON or unreadable file: silently ignore and fall back to built-in table
      return {};
    }
  }

  return {};
}

function matchModelRate(
  model: string,
  overrides?: PricingOverrideMap,
): { rate: ModelPricingRate; matchedRule: string; pricingSource: PricingSource } {
  const normalized = normalizeModelName(model);

  // 1. User overrides (exact match first, then longest prefix)
  if (overrides) {
    const sanitized = sanitizeOverridesRecord(overrides);
    if (Object.prototype.hasOwnProperty.call(sanitized, normalized)) {
      return {
        rate: sanitized[normalized],
        matchedRule: normalized,
        pricingSource: 'override',
      };
    }
    const overrideKeysDesc = Object.keys(sanitized).sort((a, b) => b.length - a.length);
    for (const key of overrideKeysDesc) {
      if (normalized.startsWith(key)) {
        return {
          rate: sanitized[key],
          matchedRule: key,
          pricingSource: 'override',
        };
      }
    }
  }

  // 2. Built-in exact or longest prefix match
  if (Object.prototype.hasOwnProperty.call(BUILTIN_MODEL_PRICING, normalized)) {
    return {
      rate: BUILTIN_MODEL_PRICING[normalized],
      matchedRule: normalized,
      pricingSource: 'builtin-estimated',
    };
  }
  for (const key of BUILTIN_KEYS_DESC) {
    if (normalized.startsWith(key)) {
      return {
        rate: BUILTIN_MODEL_PRICING[key],
        matchedRule: key,
        pricingSource: 'builtin-estimated',
      };
    }
  }

  // 3. Family fuzzy fallback (e.g. claude-3-7-sonnet-20250219, gemini-4.0-flash-exp)
  if (normalized.includes('claude')) {
    if (normalized.includes('opus')) {
      return { rate: BUILTIN_MODEL_PRICING['claude-opus'], matchedRule: 'claude-opus', pricingSource: 'builtin-estimated' };
    }
    if (normalized.includes('haiku')) {
      return { rate: BUILTIN_MODEL_PRICING['claude-haiku'], matchedRule: 'claude-haiku', pricingSource: 'builtin-estimated' };
    }
    if (normalized.includes('sonnet')) {
      return { rate: BUILTIN_MODEL_PRICING['claude-sonnet'], matchedRule: 'claude-sonnet', pricingSource: 'builtin-estimated' };
    }
  }
  if (normalized.includes('gemini')) {
    if (normalized.includes('neon')) {
      return { rate: BUILTIN_MODEL_PRICING['gemini-4-neon'], matchedRule: 'gemini-4-neon', pricingSource: 'builtin-estimated' };
    }
    if (normalized.includes('hydrogen')) {
      return { rate: BUILTIN_MODEL_PRICING['gemini-4-hydrogen'], matchedRule: 'gemini-4-hydrogen', pricingSource: 'builtin-estimated' };
    }
    if (normalized.includes('flash')) {
      return { rate: BUILTIN_MODEL_PRICING['gemini-4-flash'], matchedRule: 'gemini-4-flash', pricingSource: 'builtin-estimated' };
    }
    if (normalized.includes('pro')) {
      return { rate: BUILTIN_MODEL_PRICING['gemini-4-pro'], matchedRule: 'gemini-4-pro', pricingSource: 'builtin-estimated' };
    }
  }

  // 4. Conservative fallback estimate
  return {
    rate: FALLBACK_PRICING_RATE,
    matchedRule: 'fallback',
    pricingSource: 'fallback-estimated',
  };
}

export function roundUsd(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 1_000_000) / 1_000_000;
}

export function formatUsd(usd: number | undefined): string {
  if (usd == null || !Number.isFinite(usd) || usd <= 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function estimateTokenCostUsd(
  model: string,
  usage: TokenUsageInput,
  overrides?: PricingOverrideMap,
): TokenCostEstimate {
  const { rate, matchedRule, pricingSource } = matchModelRate(model, overrides);

  const fresh = Math.max(0, Number(usage.freshInputTokens) || 0);
  const cached = Math.max(0, Number(usage.cacheReadTokens) || 0);
  const output = Math.max(0, Number(usage.outputTokens) || 0);

  const inputUsdRaw = (fresh * rate.inputPerM) / 1_000_000;
  const cacheReadUsdRaw = (cached * rate.cacheReadPerM) / 1_000_000;
  const outputUsdRaw = (output * rate.outputPerM) / 1_000_000;
  const totalUsdRaw = inputUsdRaw + cacheReadUsdRaw + outputUsdRaw;
  const cacheSavingsRaw = Math.max(0, (cached * (rate.inputPerM - rate.cacheReadPerM)) / 1_000_000);

  return {
    model: model || 'unknown',
    matchedRule,
    totalUsd: roundUsd(totalUsdRaw),
    inputUsd: roundUsd(inputUsdRaw),
    cacheReadUsd: roundUsd(cacheReadUsdRaw),
    outputUsd: roundUsd(outputUsdRaw),
    cacheSavingsUsd: roundUsd(cacheSavingsRaw),
    pricingSource,
    estimated: true,
    rate: { ...rate },
  };
}
