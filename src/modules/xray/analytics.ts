import fs from 'node:fs';
import { discoverTranscriptEntries, type DiscoveryOptions } from './discovery.js';
import {
  estimateTokenCostUsd,
  formatUsd,
  loadPricingOverrides,
  roundUsd,
  type PricingOverrideMap,
} from './pricing.js';
import { redactSecrets } from './sanitize.js';
import { formatCompactTokens, parseTranscriptFile } from './transcript.js';
import type {
  CostAnalyticsReport,
  DailyCostTrendItem,
  FiveHourBurnWindow,
  ModelCostTotalItem,
  SessionDetail,
} from './types.js';

export const MAX_ANALYTICS_SESSIONS = 60;
export const MAX_ANALYTICS_TRANSCRIPT_BYTES = 20 * 1024 * 1024; // 20 MiB
export const FIVE_HOUR_WINDOW_HOURS = 5 as const;
const FIVE_HOUR_MS = FIVE_HOUR_WINDOW_HOURS * 3_600_000;
const DAY_MS = 24 * 3_600_000;
const TREND_DAYS = 14;
const WEEK_DAYS = 7;

export const FIVE_HOUR_WARN_TOKENS = 5_000_000;
export const FIVE_HOUR_CRITICAL_TOKENS = 15_000_000;
export const FIVE_HOUR_WARN_USD = 15;
export const FIVE_HOUR_CRITICAL_USD = 40;

const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;
const LEADING_WS_FORMULA_RE = /^[\s]*[=+\-@\t\r]/;
const ERROR_STEP_RE = /\b(?:error|failed|exception|429|RESOURCE_EXHAUSTED|rate[\s_-]*limit|timeout)\b/i;

function toUtcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function buildUtcDateWindow(nowMs: number, days: number): string[] {
  const todayStart = Date.UTC(
    new Date(nowMs).getUTCFullYear(),
    new Date(nowMs).getUTCMonth(),
    new Date(nowMs).getUTCDate(),
  );
  const dates: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    dates.push(toUtcDateKey(todayStart - offset * DAY_MS));
  }
  return dates;
}

export function classifyFiveHourWarning(
  totalTokens: number,
  estimatedUsd: number,
): FiveHourBurnWindow['warningLevel'] {
  if (totalTokens >= FIVE_HOUR_CRITICAL_TOKENS || estimatedUsd >= FIVE_HOUR_CRITICAL_USD) {
    return 'critical';
  }
  if (totalTokens >= FIVE_HOUR_WARN_TOKENS || estimatedUsd >= FIVE_HOUR_WARN_USD) {
    return 'warn';
  }
  return 'ok';
}

function buildDemoCostAnalytics(nowMs: number): CostAnalyticsReport {
  const dates = buildUtcDateWindow(nowMs, TREND_DAYS);
  // Active realistic 7-day synthetic curve placed inside the 14-day UTC window (zero disk access)
  const last7Seeds: Array<{
    sessions: number;
    freshInput: number;
    cacheRead: number;
    output: number;
    model: string;
  }> = [
    { sessions: 2, freshInput: 165_000, cacheRead: 390_000, output: 24_000, model: 'gemini-4-flash' },
    { sessions: 3, freshInput: 310_000, cacheRead: 820_000, output: 41_000, model: 'gemini-4-neon-high' },
    { sessions: 1, freshInput: 120_000, cacheRead: 295_000, output: 18_500, model: 'claude-sonnet-4' },
    { sessions: 4, freshInput: 480_000, cacheRead: 1_360_000, output: 64_200, model: 'gemini-4-neon-high' },
    { sessions: 2, freshInput: 215_000, cacheRead: 640_000, output: 31_400, model: 'gemini-4-flash' },
    { sessions: 3, freshInput: 390_000, cacheRead: 1_120_000, output: 52_000, model: 'claude-sonnet-4' },
    { sessions: 3, freshInput: 425_000, cacheRead: 1_490_000, output: 58_600, model: 'gemini-4-neon-high' },
  ];

  const modelAgg = new Map<
    string,
    {
      sessions: number;
      inputTokens: number;
      cacheReadTokens: number;
      outputTokens: number;
      estimatedUsd: number;
    }
  >();

  let totalEstimatedUsdRaw = 0;
  let totalCacheSavingsRaw = 0;
  let totalSessions = 0;

  const dailyTrend: DailyCostTrendItem[] = dates.map((date, idx) => {
    const activeIdx = idx - (TREND_DAYS - WEEK_DAYS);
    if (activeIdx < 0) {
      return {
        date,
        sessions: 0,
        totalTokens: 0,
        estimatedUsd: 0,
        cacheHitRate: 0,
      };
    }
    const seed = last7Seeds[activeIdx];
    const cost = estimateTokenCostUsd(seed.model, {
      freshInputTokens: seed.freshInput,
      cacheReadTokens: seed.cacheRead,
      outputTokens: seed.output,
    });
    const inputTokens = seed.freshInput + seed.cacheRead;
    const totalTokens = inputTokens + seed.output;
    const cacheHitRate = inputTokens > 0 ? Number((seed.cacheRead / inputTokens).toFixed(4)) : 0;

    totalEstimatedUsdRaw += cost.totalUsd;
    totalCacheSavingsRaw += cost.cacheSavingsUsd;
    totalSessions += seed.sessions;

    const m = modelAgg.get(seed.model) ?? {
      sessions: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      estimatedUsd: 0,
    };
    m.sessions += seed.sessions;
    m.inputTokens += inputTokens;
    m.cacheReadTokens += seed.cacheRead;
    m.outputTokens += seed.output;
    m.estimatedUsd += cost.totalUsd;
    modelAgg.set(seed.model, m);

    return {
      date,
      sessions: seed.sessions,
      totalTokens,
      estimatedUsd: cost.totalUsd,
      cacheHitRate,
    };
  });

  const modelTotals: ModelCostTotalItem[] = Array.from(modelAgg.entries())
    .map(([model, m]) => ({
      model,
      sessions: m.sessions,
      totalTokens: m.inputTokens + m.outputTokens,
      estimatedUsd: roundUsd(m.estimatedUsd),
      cacheHitRate: m.inputTokens > 0 ? Number((m.cacheReadTokens / m.inputTokens).toFixed(4)) : 0,
    }))
    .sort((a, b) => b.estimatedUsd - a.estimatedUsd || b.totalTokens - a.totalTokens);

  const todayItem = dailyTrend[dailyTrend.length - 1];
  const weekEstimatedUsd = roundUsd(
    dailyTrend.slice(-WEEK_DAYS).reduce((sum, item) => sum + item.estimatedUsd, 0),
  );

  // Realistic 5h rolling window subset of today's activity
  const fiveHourTokens = Math.round(todayItem.totalTokens * 0.78);
  const fiveHourUsd = roundUsd(todayItem.estimatedUsd * 0.78);

  return {
    mode: 'demo',
    generatedAt: new Date(nowMs).toISOString(),
    sessionsAnalyzed: totalSessions,
    totalEstimatedUsd: roundUsd(totalEstimatedUsdRaw),
    todayEstimatedUsd: todayItem.estimatedUsd,
    weekEstimatedUsd,
    cacheSavingsUsd: roundUsd(totalCacheSavingsRaw),
    dailyTrend,
    modelTotals,
    fiveHourWindow: {
      windowStartIso: new Date(nowMs - FIVE_HOUR_MS).toISOString(),
      windowHours: FIVE_HOUR_WINDOW_HOURS,
      sessionsCount: Math.max(1, todayItem.sessions - 1),
      totalTokens: fiveHourTokens,
      estimatedUsd: fiveHourUsd,
      burnRateUsdPerHour: roundUsd(fiveHourUsd / FIVE_HOUR_WINDOW_HOURS),
      burnRateTokensPerHour: Math.round(fiveHourTokens / FIVE_HOUR_WINDOW_HOURS),
      warningLevel: classifyFiveHourWarning(fiveHourTokens, fiveHourUsd),
    },
  };
}

function parseTimestampMs(iso: string | undefined, fallbackMs: number): number {
  if (iso) {
    const parsed = Date.parse(iso);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallbackMs;
}

/**
 * Offline read-only cost, 14-day UTC trend, and 5-hour rolling burn-rate aggregator.
 * Scans at most the 60 most recent transcripts (skipping files > 20 MiB) and never writes to disk.
 */
export function computeCostAnalytics(
  opts: DiscoveryOptions & { nowMs?: number; limit?: number } = {},
): CostAnalyticsReport {
  const nowMs = opts.nowMs ?? Date.now();
  if (opts.demoMode) {
    return buildDemoCostAnalytics(nowMs);
  }

  const maxSessions = Math.min(
    MAX_ANALYTICS_SESSIONS,
    Math.max(1, Math.floor(opts.limit ?? MAX_ANALYTICS_SESSIONS)),
  );
  const pricingOverrides: PricingOverrideMap = loadPricingOverrides(opts.dataDir);
  const entries = discoverTranscriptEntries(opts).slice(0, maxSessions);

  const dateKeys = buildUtcDateWindow(nowMs, TREND_DAYS);
  const todayKey = dateKeys[dateKeys.length - 1];
  const weekDateSet = new Set(dateKeys.slice(-WEEK_DAYS));
  const dailyBuckets = new Map<
    string,
    {
      sessionIds: Set<string>;
      inputTokens: number;
      cacheReadTokens: number;
      outputTokens: number;
      estimatedUsd: number;
    }
  >();
  for (const key of dateKeys) {
    dailyBuckets.set(key, {
      sessionIds: new Set<string>(),
      inputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      estimatedUsd: 0,
    });
  }

  const modelBuckets = new Map<
    string,
    {
      sessionIds: Set<string>;
      inputTokens: number;
      cacheReadTokens: number;
      outputTokens: number;
      estimatedUsd: number;
    }
  >();

  const windowStartMs = nowMs - FIVE_HOUR_MS;
  const windowUpperMs = nowMs + 60_000; // allow minor clock skew without leaking far-future data
  const fiveHourSessionIds = new Set<string>();
  let fiveHourTokens = 0;
  let fiveHourUsdRaw = 0;

  let sessionsAnalyzed = 0;
  let totalEstimatedUsdRaw = 0;
  let totalCacheSavingsUsdRaw = 0;

  for (const entry of entries) {
    try {
      const st = fs.statSync(entry.transcriptPath);
      if (!st.isFile() || st.size === 0 || st.size > MAX_ANALYTICS_TRANSCRIPT_BYTES) {
        continue;
      }
    } catch {
      continue;
    }

    let detail: SessionDetail;
    try {
      // Do not pass siblingBrainRoot here so top-level child transcripts are never double-counted
      detail = parseTranscriptFile(entry.transcriptPath, {
        sessionId: entry.id,
        source: entry.source,
        brainDir: entry.brainDir,
        pricingOverrides,
      });
    } catch {
      continue;
    }

    sessionsAnalyzed += 1;
    const sessionFallbackMs = parseTimestampMs(detail.summary.updatedAt, entry.mtimeMs);

    const recordUsageUnit = (
      tsMs: number,
      model: string,
      freshInputTokens: number,
      cacheReadTokens: number,
      outputTokens: number,
    ) => {
      const effectiveInput = Math.max(0, freshInputTokens) + Math.max(0, cacheReadTokens);
      const safeOutput = Math.max(0, outputTokens);
      const totalTokens = effectiveInput + safeOutput;
      const cost = estimateTokenCostUsd(
        model,
        {
          freshInputTokens,
          cacheReadTokens,
          outputTokens: safeOutput,
        },
        pricingOverrides,
      );

      totalEstimatedUsdRaw += cost.totalUsd;
      totalCacheSavingsUsdRaw += cost.cacheSavingsUsd;

      const modelKey = model || 'unknown';
      let mBucket = modelBuckets.get(modelKey);
      if (!mBucket) {
        mBucket = {
          sessionIds: new Set<string>(),
          inputTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
          estimatedUsd: 0,
        };
        modelBuckets.set(modelKey, mBucket);
      }
      mBucket.sessionIds.add(entry.id);
      mBucket.inputTokens += effectiveInput;
      mBucket.cacheReadTokens += Math.max(0, cacheReadTokens);
      mBucket.outputTokens += safeOutput;
      mBucket.estimatedUsd += cost.totalUsd;

      const dateKey = toUtcDateKey(tsMs);
      const dBucket = dailyBuckets.get(dateKey);
      if (dBucket) {
        dBucket.sessionIds.add(entry.id);
        dBucket.inputTokens += effectiveInput;
        dBucket.cacheReadTokens += Math.max(0, cacheReadTokens);
        dBucket.outputTokens += safeOutput;
        dBucket.estimatedUsd += cost.totalUsd;
      }

      if (tsMs >= windowStartMs && tsMs <= windowUpperMs) {
        fiveHourSessionIds.add(entry.id);
        fiveHourTokens += totalTokens;
        fiveHourUsdRaw += cost.totalUsd;
      }
    };

    if (detail.turns.length > 0) {
      for (const turn of detail.turns) {
        const turnTs = parseTimestampMs(turn.timestamp, sessionFallbackMs);
        recordUsageUnit(
          turnTs,
          turn.model,
          turn.freshInputTokens,
          turn.cacheReadTokens,
          turn.outputTokens,
        );
      }
    } else if (detail.summary.totalInputTokens + detail.summary.totalOutputTokens > 0) {
      recordUsageUnit(
        sessionFallbackMs,
        detail.summary.model,
        detail.summary.totalFreshInputTokens,
        detail.summary.totalCacheReadTokens,
        detail.summary.totalOutputTokens,
      );
    }
  }

  const dailyTrend: DailyCostTrendItem[] = dateKeys.map((date) => {
    const b = dailyBuckets.get(date)!;
    return {
      date,
      sessions: b.sessionIds.size,
      totalTokens: b.inputTokens + b.outputTokens,
      estimatedUsd: roundUsd(b.estimatedUsd),
      cacheHitRate: b.inputTokens > 0 ? Number((b.cacheReadTokens / b.inputTokens).toFixed(4)) : 0,
    };
  });

  const todayEstimatedUsd =
    dailyTrend.find((item) => item.date === todayKey)?.estimatedUsd ?? 0;
  const weekEstimatedUsd = roundUsd(
    dailyTrend
      .filter((item) => weekDateSet.has(item.date))
      .reduce((sum, item) => sum + item.estimatedUsd, 0),
  );

  const modelTotals: ModelCostTotalItem[] = Array.from(modelBuckets.entries())
    .map(([model, m]) => ({
      model,
      sessions: m.sessionIds.size,
      totalTokens: m.inputTokens + m.outputTokens,
      estimatedUsd: roundUsd(m.estimatedUsd),
      cacheHitRate: m.inputTokens > 0 ? Number((m.cacheReadTokens / m.inputTokens).toFixed(4)) : 0,
    }))
    .sort((a, b) => b.estimatedUsd - a.estimatedUsd || b.totalTokens - a.totalTokens);

  const fiveHourUsd = roundUsd(fiveHourUsdRaw);

  return {
    mode: 'live',
    generatedAt: new Date(nowMs).toISOString(),
    sessionsAnalyzed,
    totalEstimatedUsd: roundUsd(totalEstimatedUsdRaw),
    todayEstimatedUsd,
    weekEstimatedUsd,
    cacheSavingsUsd: roundUsd(totalCacheSavingsUsdRaw),
    dailyTrend,
    modelTotals,
    fiveHourWindow: {
      windowStartIso: new Date(windowStartMs).toISOString(),
      windowHours: FIVE_HOUR_WINDOW_HOURS,
      sessionsCount: fiveHourSessionIds.size,
      totalTokens: fiveHourTokens,
      estimatedUsd: fiveHourUsd,
      burnRateUsdPerHour: roundUsd(fiveHourUsd / FIVE_HOUR_WINDOW_HOURS),
      burnRateTokensPerHour: Math.round(fiveHourTokens / FIVE_HOUR_WINDOW_HOURS),
      warningLevel: classifyFiveHourWarning(fiveHourTokens, fiveHourUsd),
    },
  };
}

function escapeMdCell(raw: string): string {
  return redactSecrets(raw).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function resolveSessionCost(detail: SessionDetail): { estimatedUsd: number; cacheSavingsUsd: number } {
  if (detail.summary.estimatedUsd != null && detail.summary.cacheSavingsUsd != null) {
    return {
      estimatedUsd: detail.summary.estimatedUsd,
      cacheSavingsUsd: detail.summary.cacheSavingsUsd,
    };
  }
  if (detail.modelBreakdown && detail.modelBreakdown.length > 0) {
    let total = 0;
    let savings = 0;
    for (const m of detail.modelBreakdown) {
      const c = estimateTokenCostUsd(m.model, {
        freshInputTokens: m.freshInputTokens,
        cacheReadTokens: m.cacheReadTokens,
        outputTokens: m.outputTokens,
      });
      total += c.totalUsd;
      savings += c.cacheSavingsUsd;
    }
    return {
      estimatedUsd: roundUsd(total),
      cacheSavingsUsd: roundUsd(savings),
    };
  }
  const c = estimateTokenCostUsd(detail.summary.model, {
    freshInputTokens: detail.summary.totalFreshInputTokens,
    cacheReadTokens: detail.summary.totalCacheReadTokens,
    outputTokens: detail.summary.totalOutputTokens,
  });
  return {
    estimatedUsd: c.totalUsd,
    cacheSavingsUsd: c.cacheSavingsUsd,
  };
}

/**
 * Generates a secret-redacted anti-compaction Markdown handoff snapshot designed to
 * survive ~250K context compaction or transfer cleanly into a fresh conversation.
 */
export function renderHandoffSnapshot(detail: SessionDetail): string {
  const s = detail.summary;
  const { estimatedUsd, cacheSavingsUsd } = resolveSessionCost(detail);
  const objective = redactSecrets(s.firstPrompt || s.title || `Session ${s.id}`);

  const modifiedFiles = detail.fileActivity.filter((f) => f.editCount + f.writeCount > 0);
  const readOnlyFiles = detail.fileActivity.filter((f) => f.editCount + f.writeCount === 0);
  const prioritizedFiles = [...modifiedFiles, ...readOnlyFiles].slice(0, 25);

  const errorOrTruncSteps = detail.recentSteps
    .filter((st) => st.type === 'ERROR' || st.truncated || ERROR_STEP_RE.test(st.preview))
    .slice(0, 8);

  const lines: string[] = [
    `# Context Handoff Snapshot — ${redactSecrets(s.title)}`,
    '',
    '> Redacted anti-compaction checkpoint generated offline by agy-NOV Context X-Ray.',
    '',
    '## 1. Session Goal & Metadata',
    `- **Session ID**: \`${redactSecrets(s.id)}\` (${s.source})`,
    `- **Primary Model**: \`${redactSecrets(s.model)}\` | **Turns**: ${s.turns} | **Steps**: ${s.steps}`,
    `- **Timeframe**: ${s.startedAt} -> ${s.updatedAt}`,
    `- **Original Objective**: ${objective}`,
    '',
    '## 2. Token & Estimated USD Telemetry',
    `- **Peak Context Window**: ${formatCompactTokens(s.peakContextTokens)}${s.peakContextTokens >= 200_000 ? ' (near compaction threshold — handoff recommended)' : ''}`,
    `- **Total Input**: ${formatCompactTokens(s.totalInputTokens)} (Cached: ${formatCompactTokens(s.totalCacheReadTokens)} · Fresh: ${formatCompactTokens(s.totalFreshInputTokens)} · Cache Hit: **${(s.cacheHitRate * 100).toFixed(1)}%**)`,
    `- **Total Output**: ${formatCompactTokens(s.totalOutputTokens)} | **Tool Calls**: ${s.toolCallsCount}`,
    `- **Estimated Cost (USD, offline ref.)**: ~${formatUsd(estimatedUsd)} | **Prefix Cache Savings**: ~${formatUsd(cacheSavingsUsd)}`,
  ];

  if (detail.modelBreakdown && detail.modelBreakdown.length > 0) {
    lines.push(
      '',
      '| Model | Turns | Input | Cache Hit | Output | Est. USD | Retries |',
      '| :--- | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...detail.modelBreakdown.map((m) => {
        const mUsd =
          m.estimatedUsd ??
          estimateTokenCostUsd(m.model, {
            freshInputTokens: m.freshInputTokens,
            cacheReadTokens: m.cacheReadTokens,
            outputTokens: m.outputTokens,
          }).totalUsd;
        return `| \`${escapeMdCell(m.model)}\` | ${m.turns} | ${formatCompactTokens(m.inputTokens)} | ${(m.cacheHitRate * 100).toFixed(1)}% | ${formatCompactTokens(m.outputTokens)} | ${formatUsd(mUsd)} | ${m.retrySignals} |`;
      }),
    );
  }

  lines.push('', '## 3. Key Workspace Files (Modified & Read)');
  if (prioritizedFiles.length === 0) {
    lines.push('- No workspace file operations recorded.');
  } else {
    lines.push(
      '| Path | Operations | Touches | Last Step |',
      '| :--- | :--- | ---: | ---: |',
      ...prioritizedFiles.map(
        (f) =>
          `| \`${escapeMdCell(f.path)}\` | ${f.ops.map((o) => o.toUpperCase()).join('/')} | ${f.totalTouches} | #${f.lastStepIndex} |`,
      ),
    );
  }

  lines.push('', '## 4. Swarm Subagent Summary');
  if (detail.swarmLineage && detail.swarmLineage.totalSubagents > 0) {
    const sl = detail.swarmLineage;
    lines.push(
      `- **Subagents**: ${sl.totalSubagents} (Linked: ${sl.linkedTranscripts}, Orphan Suspects: ${sl.orphanSuspects})`,
      `- **Subagent Tokens**: Input ${formatCompactTokens(sl.totalSubagentInputTokens)} | Output ${formatCompactTokens(sl.totalSubagentOutputTokens)}`,
      '| Role | Type | Model | Turns | Input | Output | Status |',
      '| :--- | :--- | :--- | ---: | ---: | ---: | :--- |',
      ...sl.children
        .slice(0, 12)
        .map(
          (c) =>
            `| ${escapeMdCell(c.role)} | \`${escapeMdCell(c.typeName)}\` | \`${escapeMdCell(c.model)}\` | ${c.turns} | ${formatCompactTokens(c.totalInputTokens)} | ${formatCompactTokens(c.totalOutputTokens)} | ${c.statusHint} |`,
        ),
    );
  } else {
    lines.push('- No Swarm subagents dispatched in this session.');
  }

  lines.push('', '## 5. Recent Errors, Risk Diagnostics & Artifacts');
  if (detail.diagnostics.length > 0) {
    lines.push(
      ...detail.diagnostics.map(
        (d) => `- **[${d.severity.toUpperCase()}] ${redactSecrets(d.title)}**: ${redactSecrets(d.detail)}`,
      ),
    );
  } else {
    lines.push('- No automated risk diagnostics triggered.');
  }

  if (errorOrTruncSteps.length > 0) {
    lines.push('', '### Flagged Recent Steps');
    for (const st of errorOrTruncSteps) {
      const tags = [st.type, ...(st.truncated ? ['TRUNCATED'] : [])].join(' · ');
      lines.push(`- **Step #${st.stepIndex}** (${tags}): ${redactSecrets(st.preview).slice(0, 160)}`);
    }
  }

  if (detail.artifacts.length > 0) {
    lines.push('', '### Session Artifacts');
    for (const art of detail.artifacts.slice(0, 10)) {
      lines.push(
        `- \`${escapeMdCell(art.name)}\` (${(art.sizeBytes / 1024).toFixed(1)} KB): ${redactSecrets(art.preview).replace(/\s+/g, ' ').slice(0, 140)}`,
      );
    }
  }

  const keyPathsList = (modifiedFiles.length > 0 ? modifiedFiles : prioritizedFiles)
    .slice(0, 8)
    .map((f) => `- ${redactSecrets(f.path)} (${f.ops.join('/')})`)
    .join('\n');
  const warnSummary = detail.diagnostics
    .filter((d) => d.severity === 'warn')
    .map((d) => `- ${redactSecrets(d.title)}`)
    .join('\n');

  lines.push(
    '',
    '## 6. Suggested Continuation Prompt',
    '```text',
    `Continue from session "${redactSecrets(s.title)}" (ID: ${redactSecrets(s.id)}).`,
    `Primary goal: ${objective}`,
    keyPathsList
      ? `Files already touched in workspace:\n${keyPathsList}`
      : 'No modified workspace files were recorded yet.',
    warnSummary
      ? `Open risks / diagnostics to keep in mind:\n${warnSummary}`
      : 'No open warning diagnostics.',
    'Next step: inspect the modified files above, verify current git status/tests, and continue cleanly without repeating completed work.',
    '```',
  );

  return redactSecrets(lines.join('\n'));
}

export interface OtlpAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string;
    doubleValue?: number;
    boolValue?: boolean;
  };
}

export interface OtlpMetric {
  name: string;
  description: string;
  unit: string;
  sum?: {
    aggregationTemporality: 2;
    isMonotonic: boolean;
    dataPoints: Array<{
      attributes: OtlpAttribute[];
      startTimeUnixNano: string;
      timeUnixNano: string;
      asInt?: string;
      asDouble?: number;
    }>;
  };
  gauge?: {
    dataPoints: Array<{
      attributes: OtlpAttribute[];
      timeUnixNano: string;
      asInt?: string;
      asDouble?: number;
    }>;
  };
}

export interface OtlpUsagePayload {
  resourceMetrics: Array<{
    resource: {
      attributes: OtlpAttribute[];
    };
    scopeMetrics: Array<{
      scope: {
        name: string;
        version: string;
      };
      metrics: OtlpMetric[];
    }>;
  }>;
}

function toUnixNanoString(iso: string | undefined, fallbackMs: number): string {
  const ms = parseTimestampMs(iso, fallbackMs);
  return (BigInt(Math.max(0, Math.floor(ms))) * 1_000_000n).toString();
}

function strAttr(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: redactSecrets(value) } };
}

function boolAttr(key: string, value: boolean): OtlpAttribute {
  return { key, value: { boolValue: value } };
}

/**
 * Builds an OpenTelemetry OTLP/JSON `resourceMetrics` payload containing strictly
 * redacted numeric telemetry (zero prompts, zero file paths, zero credentials).
 */
export function buildOtlpUsagePayload(
  detail: SessionDetail,
  analytics?: CostAnalyticsReport,
): OtlpUsagePayload {
  const s = detail.summary;
  const fallbackNow = Date.now();
  const startNano = toUnixNanoString(s.startedAt, fallbackNow);
  const endNano = toUnixNanoString(s.updatedAt, fallbackNow);
  const { estimatedUsd, cacheSavingsUsd } = resolveSessionCost(detail);

  const models =
    detail.modelBreakdown && detail.modelBreakdown.length > 0
      ? detail.modelBreakdown
      : [
          {
            model: s.model || 'unknown',
            turns: s.turns,
            inputTokens: s.totalInputTokens,
            cacheReadTokens: s.totalCacheReadTokens,
            freshInputTokens: s.totalFreshInputTokens,
            outputTokens: s.totalOutputTokens,
            cacheHitRate: s.cacheHitRate,
            retrySignals: 0,
            sharePercent: 100,
            estimatedUsd,
          },
        ];

  const tokenDataPoints: NonNullable<OtlpMetric['sum']>['dataPoints'] = [];
  const costDataPoints: NonNullable<OtlpMetric['sum']>['dataPoints'] = [];

  for (const m of models) {
    const modelName = redactSecrets(m.model || 'unknown');
    tokenDataPoints.push(
      {
        attributes: [
          strAttr('gen_ai.request.model', modelName),
          strAttr('gen_ai.token.type', 'input_fresh'),
        ],
        startTimeUnixNano: startNano,
        timeUnixNano: endNano,
        asInt: String(Math.max(0, Math.round(m.freshInputTokens))),
      },
      {
        attributes: [
          strAttr('gen_ai.request.model', modelName),
          strAttr('gen_ai.token.type', 'input_cache_read'),
        ],
        startTimeUnixNano: startNano,
        timeUnixNano: endNano,
        asInt: String(Math.max(0, Math.round(m.cacheReadTokens))),
      },
      {
        attributes: [
          strAttr('gen_ai.request.model', modelName),
          strAttr('gen_ai.token.type', 'output'),
        ],
        startTimeUnixNano: startNano,
        timeUnixNano: endNano,
        asInt: String(Math.max(0, Math.round(m.outputTokens))),
      },
    );

    const modelUsd =
      m.estimatedUsd ??
      estimateTokenCostUsd(m.model, {
        freshInputTokens: m.freshInputTokens,
        cacheReadTokens: m.cacheReadTokens,
        outputTokens: m.outputTokens,
      }).totalUsd;
    costDataPoints.push({
      attributes: [
        strAttr('gen_ai.request.model', modelName),
        strAttr('agy_nov.cost.basis', 'offline_estimated'),
      ],
      startTimeUnixNano: startNano,
      timeUnixNano: endNano,
      asDouble: roundUsd(modelUsd),
    });
  }

  const metrics: OtlpMetric[] = [
    {
      name: 'gen_ai.client.token.usage',
      description: 'Offline read-only token usage broken down by model and token type',
      unit: '{token}',
      sum: {
        aggregationTemporality: 2,
        isMonotonic: true,
        dataPoints: tokenDataPoints,
      },
    },
    {
      name: 'gen_ai.client.cost.estimated_usd',
      description: 'Offline estimated cost in USD using local reference pricing',
      unit: 'USD',
      sum: {
        aggregationTemporality: 2,
        isMonotonic: true,
        dataPoints: costDataPoints,
      },
    },
    {
      name: 'agy_nov.xray.cache.hit_ratio',
      description: 'Prompt prefix cache hit ratio (0 to 1)',
      unit: '1',
      gauge: {
        dataPoints: [
          {
            attributes: [strAttr('gen_ai.request.model', s.model || 'unknown')],
            timeUnixNano: endNano,
            asDouble: Number(Math.max(0, Math.min(1, s.cacheHitRate)).toFixed(4)),
          },
        ],
      },
    },
    {
      name: 'agy_nov.xray.cache.savings_usd',
      description: 'Estimated USD saved via prompt prefix cache hits',
      unit: 'USD',
      sum: {
        aggregationTemporality: 2,
        isMonotonic: true,
        dataPoints: [
          {
            attributes: [strAttr('agy_nov.cost.basis', 'offline_estimated')],
            startTimeUnixNano: startNano,
            timeUnixNano: endNano,
            asDouble: roundUsd(cacheSavingsUsd),
          },
        ],
      },
    },
    {
      name: 'agy_nov.xray.context.peak_tokens',
      description: 'Peak context window token count observed in the session',
      unit: '{token}',
      gauge: {
        dataPoints: [
          {
            attributes: [strAttr('gen_ai.request.model', s.model || 'unknown')],
            timeUnixNano: endNano,
            asInt: String(Math.max(0, Math.round(s.peakContextTokens))),
          },
        ],
      },
    },
  ];

  if (analytics) {
    const windowNowNano = toUnixNanoString(analytics.generatedAt, fallbackNow);
    const w = analytics.fiveHourWindow;
    metrics.push(
      {
        name: 'agy_nov.xray.window_5h.tokens',
        description: 'Rolling 5-hour total tokens across recent local sessions',
        unit: '{token}',
        gauge: {
          dataPoints: [
            {
              attributes: [
                strAttr('agy_nov.window.warning_level', w.warningLevel),
                strAttr('agy_nov.analytics.mode', analytics.mode),
              ],
              timeUnixNano: windowNowNano,
              asInt: String(Math.max(0, Math.round(w.totalTokens))),
            },
          ],
        },
      },
      {
        name: 'agy_nov.xray.window_5h.estimated_usd',
        description: 'Rolling 5-hour estimated USD across recent local sessions',
        unit: 'USD',
        gauge: {
          dataPoints: [
            {
              attributes: [
                strAttr('agy_nov.window.warning_level', w.warningLevel),
                strAttr('agy_nov.analytics.mode', analytics.mode),
              ],
              timeUnixNano: windowNowNano,
              asDouble: roundUsd(w.estimatedUsd),
            },
          ],
        },
      },
      {
        name: 'agy_nov.xray.window_5h.burn_rate_usd_per_hour',
        description: 'Rolling 5-hour estimated burn rate in USD per hour',
        unit: 'USD/h',
        gauge: {
          dataPoints: [
            {
              attributes: [strAttr('agy_nov.window.warning_level', w.warningLevel)],
              timeUnixNano: windowNowNano,
              asDouble: roundUsd(w.burnRateUsdPerHour),
            },
          ],
        },
      },
    );
  }

  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            strAttr('service.name', 'agy-nov-xray'),
            strAttr('service.version', '0.5.0'),
            strAttr('telemetry.sdk.name', 'agy-nov'),
            strAttr('gen_ai.system', 'antigravity'),
            strAttr('agy_nov.session.id', s.id),
            strAttr('agy_nov.session.source', s.source),
            boolAttr('agy_nov.export.redacted', true),
          ],
        },
        scopeMetrics: [
          {
            scope: {
              name: 'agy-nov.xray.billing',
              version: '0.5.0',
            },
            metrics,
          },
        ],
      },
    ],
  };
}

/**
 * RFC 4180 CSV cell escaping with spreadsheet formula-injection protection.
 * Any string beginning with `=`, `+`, `-`, `@`, `\t`, or `\r` (including after leading
 * spaces) is prefixed with a single quote `'` so Excel/Sheets never evaluates formulas.
 */
export function escapeCsvCell(value: string | number): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '0';
  }
  let str = redactSecrets(String(value));
  if (FORMULA_PREFIX_RE.test(str) || LEADING_WS_FORMULA_RE.test(str)) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Renders daily usage & cost analytics as a formula-safe CSV document.
 */
export function renderUsageCsv(analytics: CostAnalyticsReport): string {
  const header = 'date,sessions,total_tokens,estimated_usd,cache_hit_rate';
  const rows = analytics.dailyTrend.map((row) =>
    [
      escapeCsvCell(row.date),
      escapeCsvCell(Math.max(0, Math.round(row.sessions))),
      escapeCsvCell(Math.max(0, Math.round(row.totalTokens))),
      escapeCsvCell(roundUsd(row.estimatedUsd).toFixed(4)),
      escapeCsvCell(Number(Math.max(0, Math.min(1, row.cacheHitRate)).toFixed(4))),
    ].join(','),
  );
  return [header, ...rows].join('\n');
}
