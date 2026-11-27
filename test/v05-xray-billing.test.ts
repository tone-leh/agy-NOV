import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getModuleDataDir, MODULE_CATALOG } from '../src/core/config.js';
import {
  buildOtlpUsagePayload,
  classifyFiveHourWarning,
  computeCostAnalytics,
  escapeCsvCell,
  FIVE_HOUR_CRITICAL_TOKENS,
  FIVE_HOUR_CRITICAL_USD,
  FIVE_HOUR_WARN_TOKENS,
  FIVE_HOUR_WARN_USD,
  MAX_ANALYTICS_TRANSCRIPT_BYTES,
  renderHandoffSnapshot,
  renderUsageCsv,
} from '../src/modules/xray/analytics.js';
import { loadSessionDetail } from '../src/modules/xray/discovery.js';
import {
  BUILTIN_MODEL_PRICING,
  estimateTokenCostUsd,
  FALLBACK_PRICING_RATE,
  loadPricingOverrides,
} from '../src/modules/xray/pricing.js';
import { registerXrayModule } from '../src/modules/xray/register.js';
import { parseTranscriptLines } from '../src/modules/xray/transcript.js';
import type { CostAnalyticsReport } from '../src/modules/xray/types.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

function writeTranscript(
  brainRoot: string,
  sessionId: string,
  steps: Array<Record<string, unknown>>,
): string {
  const logsDir = path.join(brainRoot, sessionId, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const transcriptPath = path.join(logsDir, 'transcript.jsonl');
  fs.writeFileSync(
    transcriptPath,
    `${steps.map((s) => JSON.stringify(s)).join('\n')}\n`,
    'utf8',
  );
  return transcriptPath;
}

describe('v0.5.0 X-Ray 2.0 — Offline Pricing & Overrides', () => {
  it('matches built-in offline reference rates accurately and computes USD + cache savings precisely', () => {
    const neon = estimateTokenCostUsd('gemini-4-neon-high', {
      freshInputTokens: 1_000_000,
      cacheReadTokens: 2_000_000,
      outputTokens: 500_000,
    });
    const neonRate = BUILTIN_MODEL_PRICING['gemini-4-neon'];
    assert.equal(neon.estimated, true);
    assert.equal(neon.pricingSource, 'builtin-estimated');
    assert.equal(neon.matchedRule, 'gemini-4-neon');
    assert.equal(neon.inputUsd, neonRate.inputPerM); // 2.5
    assert.equal(neon.cacheReadUsd, neonRate.cacheReadPerM * 2); // 0.5
    assert.equal(neon.outputUsd, neonRate.outputPerM * 0.5); // 6.0
    assert.equal(neon.totalUsd, 9.0);
    // cacheSavingsUsd = 2M * (2.5 - 0.25) / 1M = 4.5
    assert.equal(neon.cacheSavingsUsd, 4.5);

    // Provider prefix stripping & family fuzzy match
    const prefixedPro = estimateTokenCostUsd('models/gemini-2.5-pro-preview', {
      freshInputTokens: 500_000,
      cacheReadTokens: 500_000,
      outputTokens: 100_000,
    });
    assert.equal(prefixedPro.matchedRule, 'gemini-2.5-pro');
    assert.equal(prefixedPro.pricingSource, 'builtin-estimated');

    const claudeFamily = estimateTokenCostUsd('anthropic/claude-3-7-sonnet-20250219', {
      freshInputTokens: 100_000,
      cacheReadTokens: 400_000,
      outputTokens: 50_000,
    });
    assert.equal(claudeFamily.matchedRule, 'claude-sonnet');
    assert.equal(claudeFamily.pricingSource, 'builtin-estimated');
    // 0.1*3 + 0.4*0.3 + 0.05*15 = 0.3 + 0.12 + 0.75 = 1.17
    assert.equal(claudeFamily.totalUsd, 1.17);
    // 0.4 * (3 - 0.3) = 1.08
    assert.equal(claudeFamily.cacheSavingsUsd, 1.08);

    const o3Estimate = estimateTokenCostUsd('openai/o3-2025-04-16', {
      freshInputTokens: 250_000,
      cacheReadTokens: 0,
      outputTokens: 125_000,
    });
    assert.equal(o3Estimate.matchedRule, 'o3');
    assert.equal(o3Estimate.totalUsd, 1.5);

    // Unknown model uses conservative fallback
    const unknown = estimateTokenCostUsd('custom-local-llm-70b', {
      freshInputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    assert.equal(unknown.pricingSource, 'fallback-estimated');
    assert.equal(unknown.matchedRule, 'fallback');
    assert.equal(
      unknown.totalUsd,
      FALLBACK_PRICING_RATE.inputPerM +
        FALLBACK_PRICING_RATE.cacheReadPerM +
        FALLBACK_PRICING_RATE.outputPerM,
    );
  });

  it('loads pricing-overrides.json strictly read-only with zero writes when absent and degrades cleanly on bad JSON', async () => {
    await withTempDir('agy-nov-pricing-', (tmpDir) => {
      const missingRoot = path.join(tmpDir, 'never-created-root');
      const absentOverrides = loadPricingOverrides(missingRoot);
      assert.deepEqual(absentOverrides, {});
      assert.equal(fs.existsSync(missingRoot), false, 'Must never create missing dataDir');

      // Corrupt JSON -> silently falls back to built-in
      const xrayDir = getModuleDataDir(tmpDir, 'xray');
      fs.mkdirSync(xrayDir, { recursive: true });
      const overridePath = path.join(xrayDir, 'pricing-overrides.json');
      fs.writeFileSync(overridePath, '{ invalid json !!!', 'utf8');

      const badOverrides = loadPricingOverrides(xrayDir);
      assert.deepEqual(badOverrides, {});
      const fallbackCalc = estimateTokenCostUsd(
        'gemini-4-flash',
        { freshInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 },
        badOverrides,
      );
      assert.equal(fallbackCalc.pricingSource, 'builtin-estimated');

      // Valid JSON overrides work whether passed root dataDir or moduleDataDir
      fs.writeFileSync(
        overridePath,
        JSON.stringify({
          'gemini-4-neon': { inputPerM: 10.0, cacheReadPerM: 1.0, outputPerM: 20.0 },
          'bad-entry': { inputPerM: -5, cacheReadPerM: 0, outputPerM: 0 },
        }),
        'utf8',
      );

      const loadedFromRoot = loadPricingOverrides(tmpDir);
      const loadedFromModule = loadPricingOverrides(xrayDir);
      assert.deepEqual(loadedFromRoot, loadedFromModule);
      assert.equal('bad-entry' in loadedFromRoot, false);

      const customCalc = estimateTokenCostUsd(
        'gemini-4-neon-high',
        { freshInputTokens: 100_000, cacheReadTokens: 200_000, outputTokens: 50_000 },
        loadedFromRoot,
      );
      assert.equal(customCalc.pricingSource, 'override');
      // 0.1*10 + 0.2*1 + 0.05*20 = 1 + 0.2 + 1 = 2.2
      assert.equal(customCalc.totalUsd, 2.2);
      // 0.2 * (10 - 1) = 1.8
      assert.equal(customCalc.cacheSavingsUsd, 1.8);

      // Prototype keys, null coercion, and extreme numbers (> 10_000) must be safely ignored
      fs.writeFileSync(
        overridePath,
        '{"__proto__":{"inputPerM":1,"cacheReadPerM":1,"outputPerM":1},"constructor":{"inputPerM":1,"cacheReadPerM":1,"outputPerM":1},"prototype":{"inputPerM":1,"cacheReadPerM":1,"outputPerM":1},"null-rate":{"inputPerM":null,"cacheReadPerM":0,"outputPerM":0},"huge-rate":{"inputPerM":1e308,"cacheReadPerM":0,"outputPerM":0}}',
        'utf8',
      );
      const hardenedOverrides = loadPricingOverrides(tmpDir);
      assert.deepEqual(Object.keys(hardenedOverrides), []);

      // Prototype property names as model names must never match Object.prototype methods
      for (const protoModel of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
        const res = estimateTokenCostUsd(
          protoModel,
          { freshInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 },
          hardenedOverrides,
        );
        assert.equal(res.pricingSource, 'fallback-estimated');
        assert.equal(res.matchedRule, 'fallback');
        assert.equal(Number.isFinite(res.totalUsd), true);
      }
    });
  });
});

describe('v0.5.0 X-Ray 2.0 — 5h Rolling Burn Window & 14-Day UTC Trend', () => {
  it('aggregates 14-day UTC trend, 5h rolling window, warning thresholds, and skips >20 MiB transcripts', async () => {
    await withTempDir('agy-nov-analytics-', (tmpDir) => {
      const brainRoot = path.join(tmpDir, 'brain');
      fs.mkdirSync(brainRoot, { recursive: true });

      const nowMs = Date.parse('2026-11-27T12:00:00Z');

      // Session 1: 1 hour ago (inside 5h window & today) — triggers WARN via >= $15
      // claude-opus: fresh 1M ($15) + cache 2M ($3) + output 0.1M ($7.5) = $25.50
      writeTranscript(brainRoot, 'sess-recent-warn', [
        {
          step_index: 0,
          type: 'USER_INPUT',
          source: 'USER',
          created_at: '2026-11-27T10:55:00Z',
          content: 'Heavy refactor session',
        },
        {
          step_index: 1,
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          created_at: '2026-11-27T11:00:00Z',
          model: 'claude-opus-4',
          input_tokens: 1_000_000,
          cache_read_tokens: 2_000_000,
          output_tokens: 100_000,
          content: 'Done.',
        },
      ]);

      // Session 2: 6 hours ago (today UTC, outside 5h window)
      writeTranscript(brainRoot, 'sess-today-older', [
        {
          step_index: 0,
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          created_at: '2026-11-27T05:30:00Z',
          model: 'gemini-4-flash',
          input_tokens: 1_000_000,
          cache_read_tokens: 1_000_000,
          output_tokens: 200_000,
          content: 'Earlier today.',
        },
      ]);

      // Session 3: 3 days ago (inside 7d week & 14d trend)
      writeTranscript(brainRoot, 'sess-3d-ago', [
        {
          step_index: 0,
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          created_at: '2026-11-24T10:00:00Z',
          model: 'gemini-4-neon-high',
          input_tokens: 400_000,
          cache_read_tokens: 600_000,
          output_tokens: 100_000,
          content: 'Three days ago.',
        },
      ]);

      // Session 4: 10 days ago (inside 14d trend, outside 7d week)
      writeTranscript(brainRoot, 'sess-10d-ago', [
        {
          step_index: 0,
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          created_at: '2026-11-17T08:00:00Z',
          model: 'gemini-4-flash',
          input_tokens: 500_000,
          cache_read_tokens: 500_000,
          output_tokens: 100_000,
          content: 'Ten days ago.',
        },
      ]);

      // Session 5: oversized >20 MiB sparse file -> must be skipped safely without blocking
      const oversizedDir = path.join(brainRoot, 'sess-oversized', '.system_generated', 'logs');
      fs.mkdirSync(oversizedDir, { recursive: true });
      const oversizedPath = path.join(oversizedDir, 'transcript.jsonl');
      fs.writeFileSync(oversizedPath, '');
      fs.truncateSync(oversizedPath, MAX_ANALYTICS_TRANSCRIPT_BYTES + 4096);

      const report = computeCostAnalytics({
        brainDirs: [{ dir: brainRoot, source: 'custom' }],
        dataDir: path.join(tmpDir, 'never-created-data'),
        nowMs,
      });

      assert.equal(report.mode, 'live');
      assert.equal(report.sessionsAnalyzed, 4, 'Oversized >20 MiB file must be skipped');
      assert.equal(report.dailyTrend.length, 14);
      assert.equal(report.dailyTrend[0].date, '2026-11-14');
      assert.equal(report.dailyTrend[13].date, '2026-11-27');

      // 5h window only includes sess-recent-warn: 3.1M tokens, $25.50 -> warn (>= $15)
      assert.equal(report.fiveHourWindow.windowHours, 5);
      assert.equal(report.fiveHourWindow.sessionsCount, 1);
      assert.equal(report.fiveHourWindow.totalTokens, 3_100_000);
      assert.equal(report.fiveHourWindow.estimatedUsd, 25.5);
      assert.equal(report.fiveHourWindow.burnRateUsdPerHour, 5.1);
      assert.equal(report.fiveHourWindow.burnRateTokensPerHour, 620_000);
      assert.equal(report.fiveHourWindow.warningLevel, 'warn');

      // Today includes sess-recent-warn ($25.50) + sess-today-older ($0.30 + $0.03 + $0.30 = $0.63) = $26.13
      assert.equal(report.todayEstimatedUsd, 26.13);
      // 3d ago neon: 0.4*2.5 + 0.6*0.25 + 0.1*12 = 1 + 0.15 + 1.2 = $2.35
      // Week (7d) = $26.13 + $2.35 = $28.48
      assert.equal(report.weekEstimatedUsd, 28.48);
      // 10d ago flash: 0.5*0.3 + 0.5*0.03 + 0.1*1.5 = 0.15 + 0.015 + 0.15 = $0.315
      // Total = $28.48 + $0.315 = $28.795
      assert.equal(report.totalEstimatedUsd, 28.795);
      assert.ok(report.cacheSavingsUsd > 27, 'Expected substantial cache savings');
      assert.equal(report.modelTotals.length, 3);
      assert.equal(report.modelTotals[0].model, 'claude-opus-4');

      // Ensure read-only zero writes to missing dataDir
      assert.equal(fs.existsSync(path.join(tmpDir, 'never-created-data')), false);

      // Verify warning classification boundaries directly
      assert.equal(classifyFiveHourWarning(1_000_000, 5), 'ok');
      assert.equal(classifyFiveHourWarning(FIVE_HOUR_WARN_TOKENS, 1), 'warn');
      assert.equal(classifyFiveHourWarning(100_000, FIVE_HOUR_WARN_USD), 'warn');
      assert.equal(classifyFiveHourWarning(FIVE_HOUR_CRITICAL_TOKENS, 1), 'critical');
      assert.equal(classifyFiveHourWarning(100_000, FIVE_HOUR_CRITICAL_USD), 'critical');
    });
  });

  it('caps live analytics scanning at 60 sessions and handles empty brain dirs with zero disk writes', async () => {
    await withTempDir('agy-nov-analytics-cap-', (tmpDir) => {
      const emptyBrain = path.join(tmpDir, 'empty-brain');
      const absentData = path.join(tmpDir, 'absent-data');
      const emptyReport = computeCostAnalytics({
        brainDirs: [{ dir: emptyBrain, source: 'custom' }],
        dataDir: absentData,
      });
      assert.equal(emptyReport.mode, 'live');
      assert.equal(emptyReport.sessionsAnalyzed, 0);
      assert.equal(emptyReport.totalEstimatedUsd, 0);
      assert.equal(emptyReport.dailyTrend.length, 14);
      assert.equal(emptyReport.fiveHourWindow.warningLevel, 'ok');
      assert.equal(fs.existsSync(emptyBrain), false);
      assert.equal(fs.existsSync(absentData), false);

      // Create 65 sessions -> must scan at most 60
      const brainRoot = path.join(tmpDir, 'many-brain');
      fs.mkdirSync(brainRoot, { recursive: true });
      for (let i = 1; i <= 65; i += 1) {
        writeTranscript(brainRoot, `sess-bulk-${String(i).padStart(2, '0')}`, [
          {
            step_index: 0,
            type: 'PLANNER_RESPONSE',
            source: 'MODEL',
            created_at: '2026-11-27T11:30:00Z',
            model: 'gemini-4-flash',
            input_tokens: 1000,
            cache_read_tokens: 0,
            output_tokens: 100,
          },
        ]);
      }
      const capped = computeCostAnalytics({
        brainDirs: [{ dir: brainRoot, source: 'custom' }],
        dataDir: absentData,
        nowMs: Date.parse('2026-11-27T12:00:00Z'),
        limit: 100,
      });
      assert.equal(capped.sessionsAnalyzed, 60);
      assert.equal(fs.existsSync(absentData), false);
    });
  });
});

describe('v0.5.0 X-Ray 2.0 — Handoff Redaction, OTLP Structure & CSV Formula Injection Protection', () => {
  const FAKE_JWT =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzNDU2In0.supersecretjwtsignature999';
  const FAKE_API_KEY = 'sk-proj-VerySecretTestApiKey1234567890abcdef';
  const FAKE_PRIVATE_KEY =
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA1234567890abcdef\n-----END RSA PRIVATE KEY-----';

  it('redacts secrets in anti-compaction Handoff snapshot and emits strict secret-free OTLP JSON', () => {
    const detail = parseTranscriptLines(
      [
        JSON.stringify({
          step_index: 0,
          type: 'USER_INPUT',
          source: 'USER',
          created_at: '2026-11-27T08:00:00Z',
          content: `<USER_REQUEST>Fix auth middleware using Bearer ${FAKE_JWT} and key ${FAKE_API_KEY}</USER_REQUEST>`,
        }),
        JSON.stringify({
          step_index: 1,
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          created_at: '2026-11-27T08:01:00Z',
          model: 'gemini-4-neon-high',
          input_tokens: 180_000,
          cache_read_tokens: 60_000,
          output_tokens: 4_500,
          tool_calls: [
            { name: 'edit_file', args: { Path: '/workspace/src/auth/jwt.ts' } },
            { name: 'read_file', args: { Path: '/workspace/src/auth/config.ts' } },
          ],
          content: `Loaded key:\n${FAKE_PRIVATE_KEY}`,
        }),
        JSON.stringify({
          step_index: 2,
          type: 'ERROR',
          source: 'SYSTEM',
          created_at: '2026-11-27T08:02:00Z',
          content: `HTTP 429 RESOURCE_EXHAUSTED with token=${FAKE_API_KEY}`,
          truncated_fields: ['content'],
        }),
      ],
      {
        transcriptPath: '/tmp/secret-workspace/transcript.jsonl',
        brainDir: '/tmp/nonexistent-brain',
        sessionId: 'sess-handoff-test',
        source: 'custom',
      },
    );

    // 1. Handoff snapshot
    const handoff = renderHandoffSnapshot(detail);
    assert.match(handoff, /# Context Handoff Snapshot/);
    assert.match(handoff, /## 1\. Session Goal/);
    assert.match(handoff, /## 2\. Token & Estimated USD Telemetry/);
    assert.match(handoff, /## 3\. Key Workspace Files/);
    assert.match(handoff, /\/workspace\/src\/auth\/jwt\.ts/);
    assert.match(handoff, /## 4\. Swarm Subagent Summary/);
    assert.match(handoff, /## 5\. Recent Errors, Risk Diagnostics/);
    assert.match(handoff, /## 6\. Suggested Continuation Prompt/);
    assert.equal(handoff.includes(FAKE_JWT), false, 'JWT must be redacted');
    assert.equal(handoff.includes(FAKE_API_KEY), false, 'API key must be redacted');
    assert.equal(handoff.includes('MIIEpAIBAAKCAQEA'), false, 'Private key must be redacted');
    assert.match(handoff, /\[REDACTED/);

    // 1b. PKCS#8 private key, truncated PEM, Stripe sk_live_, GitHub ghs_, and AWS ASIA keys must all be redacted
    const PKCS8_KEY = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----';
    const TRUNCATED_PEM = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU';
    const STRIPE_KEY = ['sk', 'live', '51TestStripeSecretKey0000111122223333'].join('_');
    const GHS_TOKEN = ['ghs', '1234567890abcdefghijklmnopqrstuvwx1234'].join('_');
    const AWS_STS_KEY = ['ASIA', 'IOSFODNN7EXAMPLE'].join('');
    const secretDetail = parseTranscriptLines(
      [
        JSON.stringify({
          step_index: 0,
          type: 'USER_INPUT',
          source: 'USER',
          created_at: '2026-11-27T08:00:00Z',
          content: `<USER_REQUEST>Rotate ${STRIPE_KEY} ${GHS_TOKEN} ${AWS_STS_KEY}</USER_REQUEST>`,
        }),
        JSON.stringify({
          step_index: 1,
          type: 'ERROR',
          source: 'SYSTEM',
          created_at: '2026-11-27T08:01:00Z',
          content: `Leaked:\n${PKCS8_KEY}\nTruncated:\n${TRUNCATED_PEM}`,
        }),
      ],
      {
        transcriptPath: '/tmp/secret-workspace/pkcs8-transcript.jsonl',
        brainDir: '/tmp/nonexistent-brain',
        sessionId: 'sess-pkcs8-redaction',
        source: 'custom',
      },
    );
    const secretHandoff = renderHandoffSnapshot(secretDetail);
    assert.equal(secretHandoff.includes('MIIEvQIBADAN'), false, 'PKCS#8 key must be redacted');
    assert.equal(secretHandoff.includes('b3BlbnNzaC1rZXktdjE'), false, 'Truncated PEM must be redacted');
    assert.equal(secretHandoff.includes(STRIPE_KEY), false, 'Stripe live key must be redacted');
    assert.equal(secretHandoff.includes(GHS_TOKEN), false, 'GitHub ghs_ token must be redacted');
    assert.equal(secretHandoff.includes(AWS_STS_KEY), false, 'AWS ASIA STS key must be redacted');

    // 2. OTLP payload structure & privacy verification
    const demoAnalytics = computeCostAnalytics({ demoMode: true });
    const otlp = buildOtlpUsagePayload(detail, demoAnalytics);
    assert.ok(Array.isArray(otlp.resourceMetrics));
    assert.equal(otlp.resourceMetrics.length, 1);

    const rm = otlp.resourceMetrics[0];
    assert.ok(
      rm.resource.attributes.some(
        (a) => a.key === 'agy_nov.export.redacted' && a.value.boolValue === true,
      ),
    );
    const metrics = rm.scopeMetrics[0]?.metrics ?? [];
    const metricNames = new Set(metrics.map((m) => m.name));
    assert.ok(metricNames.has('gen_ai.client.token.usage'));
    assert.ok(metricNames.has('gen_ai.client.cost.estimated_usd'));
    assert.ok(metricNames.has('agy_nov.xray.cache.hit_ratio'));
    assert.ok(metricNames.has('agy_nov.xray.cache.savings_usd'));
    assert.ok(metricNames.has('agy_nov.xray.context.peak_tokens'));
    assert.ok(metricNames.has('agy_nov.xray.window_5h.tokens'));
    assert.ok(metricNames.has('agy_nov.xray.window_5h.estimated_usd'));
    assert.ok(metricNames.has('agy_nov.xray.window_5h.burn_rate_usd_per_hour'));

    const serialized = JSON.stringify(otlp);
    assert.equal(serialized.includes(FAKE_JWT), false);
    assert.equal(serialized.includes(FAKE_API_KEY), false);
    assert.equal(serialized.includes('PRIVATE KEY'), false);
    assert.equal(serialized.includes('/workspace/src/auth/jwt.ts'), false, 'OTLP must omit file paths');
    assert.equal(serialized.includes('Fix auth middleware'), false, 'OTLP must omit raw prompts');
  });

  it('neutralizes CSV spreadsheet formula injection payloads (=, +, -, @, \\t, \\r)', () => {
    const payloads = [
      "=cmd|' /C calc'!A0",
      '+SUM(A1:A10)',
      '-1+1',
      '@SUM(1+1)*cmd|calc!A0',
      '\t=IMPORTXML("http://evil.local")',
      '\r=1+1',
      '\n=cmd|calc!A0',
      '   =HYPERLINK("http://evil.local")',
    ];

    for (const p of payloads) {
      const escaped = escapeCsvCell(p);
      // Either starts directly with `'` or starts with `"'` when RFC-4180 quoted
      assert.ok(
        escaped.startsWith("'") || escaped.startsWith(`"'`),
        `Expected formula prefix neutralized for ${JSON.stringify(p)}, got ${JSON.stringify(escaped)}`,
      );
    }

    const maliciousReport: CostAnalyticsReport = {
      mode: 'live',
      generatedAt: '2026-11-27T12:00:00Z',
      sessionsAnalyzed: 1,
      totalEstimatedUsd: 1.25,
      todayEstimatedUsd: 1.25,
      weekEstimatedUsd: 1.25,
      cacheSavingsUsd: 0.4,
      dailyTrend: [
        {
          date: "=cmd|' /C calc'!A0",
          sessions: 2,
          totalTokens: 120_000,
          estimatedUsd: 1.25,
          cacheHitRate: 0.75,
        },
        {
          date: '2026-11-27',
          sessions: 1,
          totalTokens: 50_000,
          estimatedUsd: 0.5,
          cacheHitRate: 0.5,
        },
      ],
      modelTotals: [],
      fiveHourWindow: {
        windowStartIso: '2026-11-27T07:00:00Z',
        windowHours: 5,
        sessionsCount: 1,
        totalTokens: 50_000,
        estimatedUsd: 0.5,
        burnRateUsdPerHour: 0.1,
        burnRateTokensPerHour: 10_000,
        warningLevel: 'ok',
      },
    };

    const csv = renderUsageCsv(maliciousReport);
    const lines = csv.split('\n');
    assert.equal(lines[0], 'date,sessions,total_tokens,estimated_usd,cache_hit_rate');
    assert.equal(lines[1].startsWith("'=cmd|"), true, `Expected safe quote prefix on line: ${lines[1]}`);
    assert.equal(lines[2], '2026-11-27,1,50000,0.5000,0.5');
  });
});

describe('v0.5.0 X-Ray 2.0 — MCP Tool Surface, Formats & Zero-Write Demo Mode', () => {
  it('preserves 4 model tools, registers 4 new read-only app tools, exports brief/handoff/otlp/csv, and keeps zero disk writes in demoMode', async () => {
    await withTempDir('agy-nov-xray-v05-mcp-', async (tmpDir) => {
      const missingDataDir = path.join(tmpDir, 'never-created-data');
      const server = new McpServer(
        { name: 'test-xray-v05', version: '0.5.0' },
        { capabilities: { tools: {} } },
      );

      const reg = registerXrayModule(
        server,
        { dataDir: missingDataDir, workspaceRoot: tmpDir, demoMode: true },
        'ui://agy-nov/app.html',
      );

      assert.equal(reg.modelTools.length, 4);
      assert.deepEqual(
        reg.modelTools.map((t) => t.name),
        MODULE_CATALOG.xray.modelToolNames,
      );
      assert.deepEqual(reg.exemptReadOnlyAppTools, [
        'app_xray_list_sessions',
        'app_xray_get_session_detail',
        'app_xray_get_cost_analytics',
        'app_xray_build_clean_fork_pack',
      ]);

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test-v05-client', version: '0.5.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        const listed = await client.listTools();
        const names = new Set(listed.tools.map((t) => t.name));
        for (const expectedAppTool of [
          'app_xray_get_cost_analytics',
          'app_xray_export_handoff',
          'app_xray_export_otlp',
          'app_xray_export_csv',
        ]) {
          assert.ok(names.has(expectedAppTool), `Missing app tool ${expectedAppTool}`);
          const tool = listed.tools.find((t) => t.name === expectedAppTool);
          const meta = tool?._meta as { ui?: { visibility?: string[] } } | undefined;
          assert.deepEqual(meta?.ui?.visibility, ['app']);
        }

        // xray_analyze_context appends USD cost & cache savings
        const analyzeRes = await client.callTool({ name: 'xray_analyze_context', arguments: {} });
        const analyzeText = (analyzeRes.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
        assert.match(analyzeText, /Est\. Cost \(USD\):/);
        assert.match(analyzeText, /Cache Savings:/);

        // xray_export_brief default format ('brief') backward compatible
        const defaultBrief = await client.callTool({ name: 'xray_export_brief', arguments: {} });
        const briefText = (defaultBrief.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
        assert.match(briefText, /# Session X-Ray Brief:/);

        // format='handoff'
        const handoffRes = await client.callTool({
          name: 'xray_export_brief',
          arguments: { format: 'handoff' },
        });
        const handoffText = (handoffRes.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
        assert.match(handoffText, /# Context Handoff Snapshot/);
        assert.match(handoffText, /Suggested Continuation Prompt/);

        // format='otlp'
        const otlpRes = await client.callTool({
          name: 'xray_export_brief',
          arguments: { format: 'otlp' },
        });
        const otlpText = (otlpRes.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
        const parsedOtlp = JSON.parse(otlpText) as { resourceMetrics: unknown[] };
        assert.equal(Array.isArray(parsedOtlp.resourceMetrics), true);
        assert.equal(parsedOtlp.resourceMetrics.length, 1);

        // format='csv'
        const csvRes = await client.callTool({
          name: 'xray_export_brief',
          arguments: { format: 'csv' },
        });
        const csvText = (csvRes.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
        assert.ok(csvText.startsWith('date,sessions,total_tokens,estimated_usd,cache_hit_rate\n'));
        assert.equal(csvText.split('\n').length, 15, 'Header + 14 daily rows');

        // App-only tools
        const costRes = await client.callTool({ name: 'app_xray_get_cost_analytics', arguments: {} });
        const costSc = costRes.structuredContent as { analytics: CostAnalyticsReport };
        assert.equal(costSc.analytics.mode, 'demo');
        assert.equal(costSc.analytics.dailyTrend.length, 14);
        assert.ok(costSc.analytics.todayEstimatedUsd > 0);
        assert.ok(costSc.analytics.weekEstimatedUsd >= costSc.analytics.todayEstimatedUsd);
        assert.ok(costSc.analytics.modelTotals.length >= 2);
        assert.equal(costSc.analytics.fiveHourWindow.windowHours, 5);

        const appHandoff = await client.callTool({ name: 'app_xray_export_handoff', arguments: {} });
        const appHandoffSc = appHandoff.structuredContent as { markdown: string };
        assert.match(appHandoffSc.markdown, /Context Handoff Snapshot/);

        const appOtlp = await client.callTool({ name: 'app_xray_export_otlp', arguments: {} });
        const appOtlpSc = appOtlp.structuredContent as { otlp: { resourceMetrics: unknown[] } };
        assert.equal(appOtlpSc.otlp.resourceMetrics.length, 1);

        const appCsv = await client.callTool({ name: 'app_xray_export_csv', arguments: {} });
        const appCsvSc = appCsv.structuredContent as { csv: string };
        assert.ok(appCsvSc.csv.startsWith('date,sessions,total_tokens,estimated_usd,cache_hit_rate\n'));

        // Strictly zero disk writes in demoMode
        assert.equal(
          fs.existsSync(missingDataDir),
          false,
          'demoMode must never create dataDir or write files',
        );

        // Verify loadSessionDetail in demoMode populates estimatedUsd & cacheSavingsUsd
        const demoDetail = loadSessionDetail(undefined, { demoMode: true });
        assert.ok(demoDetail);
        assert.ok((demoDetail.summary.estimatedUsd ?? 0) > 0);
        assert.ok((demoDetail.summary.cacheSavingsUsd ?? 0) > 0);
        assert.ok(demoDetail.modelBreakdown.every((m) => (m.estimatedUsd ?? 0) > 0));
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});
