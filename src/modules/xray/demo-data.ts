import type { SearchHit, SessionDetail, SessionSummary } from './types.js';

/**
 * Synthetic, privacy-safe fixture dataset used exclusively by the offline
 * workbench and demo mode so screenshots and tests never expose real personal chats.
 */
export function buildDemoSessions(): { summaries: SessionSummary[]; details: Record<string, SessionDetail> } {
  const s1Summary: SessionSummary = {
    id: 'demo-auth-refactor-2026',
    source: 'demo',
    title: 'OAuth2 PKCE + Session Refresh Architecture Refactor',
    firstPrompt:
      'Refactor our OAuth2 PKCE token refresh middleware, eliminate race conditions under concurrent API calls, and add full integration tests.',
    startedAt: '2026-11-26T06:10:00Z',
    updatedAt: '2026-11-26T06:48:12Z',
    model: 'gemini-4-neon-high',
    turns: 8,
    steps: 31,
    totalInputTokens: 482_400,
    totalCacheReadTokens: 348_200,
    totalFreshInputTokens: 134_200,
    totalOutputTokens: 19_840,
    peakContextTokens: 96_400,
    cacheHitRate: 0.7218,
    toolCallsCount: 22,
    filesTouchedCount: 9,
    artifactsCount: 2,
    transcriptPath: '/workspace/demo/transcript.jsonl',
    brainDir: '/workspace/demo',
  };

  const s2Summary: SessionSummary = {
    id: 'demo-checkout-perf-2026',
    source: 'demo',
    title: 'Checkout Latency Profiling & Redis Pipeline Batching',
    firstPrompt:
      'Profile checkout p99 spikes (>850ms), inspect Redis round-trips, and implement pipeline batching with fallback circuit breaker.',
    startedAt: '2026-11-25T14:20:00Z',
    updatedAt: '2026-11-25T15:04:33Z',
    model: 'gemini-4-flash',
    turns: 5,
    steps: 18,
    totalInputTokens: 215_900,
    totalCacheReadTokens: 162_100,
    totalFreshInputTokens: 53_800,
    totalOutputTokens: 11_420,
    peakContextTokens: 61_200,
    cacheHitRate: 0.7508,
    toolCallsCount: 13,
    filesTouchedCount: 6,
    artifactsCount: 1,
    transcriptPath: '/workspace/demo2/transcript.jsonl',
    brainDir: '/workspace/demo2',
  };

  const s3Summary: SessionSummary = {
    id: 'demo-ci-docker-cache-2026',
    source: 'demo',
    title: 'GitHub Actions BuildKit Layer Cache & Multi-Arch Release',
    firstPrompt:
      'Cut CI Docker build time from 11m to under 3m using BuildKit GHA cache mounts and verify arm64/amd64 manifests.',
    startedAt: '2026-11-24T09:15:00Z',
    updatedAt: '2026-11-24T09:51:04Z',
    model: 'gemini-4-neon-high',
    turns: 4,
    steps: 14,
    totalInputTokens: 149_300,
    totalCacheReadTokens: 94_800,
    totalFreshInputTokens: 54_500,
    totalOutputTokens: 8_210,
    peakContextTokens: 48_900,
    cacheHitRate: 0.635,
    toolCallsCount: 10,
    filesTouchedCount: 4,
    artifactsCount: 1,
    transcriptPath: '/workspace/demo3/transcript.jsonl',
    brainDir: '/workspace/demo3',
  };

  const s1Detail: SessionDetail = {
    summary: s1Summary,
    composition: [
      { key: 'cached_prefix', label: 'Cached Prefix', tokens: 348_200, sharePercent: 69.3 },
      { key: 'fresh_input', label: 'Fresh Context Input', tokens: 102_600, sharePercent: 20.4 },
      { key: 'tool_outputs_est', label: 'Tool Output Payload (est.)', tokens: 31_600, sharePercent: 6.3 },
      { key: 'assistant_output', label: 'Model Output', tokens: 19_840, sharePercent: 4.0 },
    ],
    turns: [
      { turnIndex: 1, stepIndex: 1, timestamp: '2026-11-26T06:10:02Z', model: 'gemini-4-neon-high', inputTokens: 18_400, cacheReadTokens: 0, freshInputTokens: 18_400, outputTokens: 1_420, thinkingChars: 1_850, toolCallsCount: 3, toolOutputBytes: 18_200, cacheHitRate: 0, userPromptPreview: 'Refactor our OAuth2 PKCE token refresh middleware...' },
      { turnIndex: 2, stepIndex: 5, timestamp: '2026-11-26T06:14:18Z', model: 'gemini-4-flash', inputTokens: 34_200, cacheReadTokens: 17_900, freshInputTokens: 16_300, outputTokens: 2_110, thinkingChars: 2_400, toolCallsCount: 4, toolOutputBytes: 42_100, cacheHitRate: 0.5234 },
      { turnIndex: 3, stepIndex: 10, timestamp: '2026-11-26T06:19:45Z', model: 'gemini-4-flash', inputTokens: 52_600, cacheReadTokens: 33_500, freshInputTokens: 19_100, outputTokens: 3_050, thinkingChars: 3_120, toolCallsCount: 3, toolOutputBytes: 24_800, cacheHitRate: 0.6369 },
      { turnIndex: 4, stepIndex: 14, timestamp: '2026-11-26T06:24:11Z', model: 'gemini-4-neon-high', inputTokens: 64_900, cacheReadTokens: 51_400, freshInputTokens: 13_500, outputTokens: 2_890, thinkingChars: 2_190, toolCallsCount: 4, toolOutputBytes: 31_400, cacheHitRate: 0.792 },
      { turnIndex: 5, stepIndex: 19, timestamp: '2026-11-26T06:30:20Z', model: 'gemini-4-neon-high', inputTokens: 71_500, cacheReadTokens: 63_800, freshInputTokens: 7_700, outputTokens: 2_640, thinkingChars: 1_780, toolCallsCount: 2, toolOutputBytes: 6_200, cacheHitRate: 0.8923 },
      { turnIndex: 6, stepIndex: 22, timestamp: '2026-11-26T06:36:05Z', model: 'gemini-4-neon-high', inputTokens: 78_900, cacheReadTokens: 69_200, freshInputTokens: 9_700, outputTokens: 3_120, thinkingChars: 2_650, toolCallsCount: 3, toolOutputBytes: 14_300, cacheHitRate: 0.8771 },
      { turnIndex: 7, stepIndex: 26, timestamp: '2026-11-26T06:42:40Z', model: 'gemini-4-neon-high', inputTokens: 85_500, cacheReadTokens: 54_100, freshInputTokens: 31_400, outputTokens: 2_410, thinkingChars: 1_940, toolCallsCount: 2, toolOutputBytes: 11_900, cacheHitRate: 0.6327 },
      { turnIndex: 8, stepIndex: 30, timestamp: '2026-11-26T06:48:10Z', model: 'gemini-4-neon-high', inputTokens: 96_400, cacheReadTokens: 58_300, freshInputTokens: 38_100, outputTokens: 2_200, thinkingChars: 1_410, toolCallsCount: 1, toolOutputBytes: 4_800, cacheHitRate: 0.6048 },
    ],
    toolHotspots: [
      { toolName: 'run_command', calls: 7, totalOutputBytes: 68_400, avgOutputBytes: 9_771, estimatedTokens: 17_100, truncatedCount: 2, sharePercent: 44.5 },
      { toolName: 'read_file', calls: 8, totalOutputBytes: 49_200, avgOutputBytes: 6_150, estimatedTokens: 12_300, truncatedCount: 1, sharePercent: 32.0 },
      { toolName: 'edit_file', calls: 5, totalOutputBytes: 21_900, avgOutputBytes: 4_380, estimatedTokens: 5_475, truncatedCount: 0, sharePercent: 14.2 },
      { toolName: 'search_web', calls: 2, totalOutputBytes: 14_200, avgOutputBytes: 7_100, estimatedTokens: 3_550, truncatedCount: 0, sharePercent: 9.3 },
    ],
    fileActivity: [
      { path: '/workspace/demo-app/src/auth/token-refresh.ts', basename: 'token-refresh.ts', dir: '/workspace/demo-app/src/auth', uri: 'file:///workspace/demo-app/src/auth/token-refresh.ts', ops: ['read', 'edit'], readCount: 2, editCount: 3, writeCount: 0, totalTouches: 5, lastStepIndex: 27, lastTimestamp: '2026-11-26T06:43:10Z' },
      { path: '/workspace/demo-app/src/auth/pkce-verifier.ts', basename: 'pkce-verifier.ts', dir: '/workspace/demo-app/src/auth', uri: 'file:///workspace/demo-app/src/auth/pkce-verifier.ts', ops: ['read', 'edit'], readCount: 1, editCount: 2, writeCount: 0, totalTouches: 3, lastStepIndex: 21, lastTimestamp: '2026-11-26T06:34:02Z' },
      { path: '/workspace/demo-app/src/auth/singleflight-lock.ts', basename: 'singleflight-lock.ts', dir: '/workspace/demo-app/src/auth', uri: 'file:///workspace/demo-app/src/auth/singleflight-lock.ts', ops: ['write'], readCount: 0, editCount: 0, writeCount: 1, totalTouches: 1, lastStepIndex: 15, lastTimestamp: '2026-11-26T06:25:18Z' },
      { path: '/workspace/demo-app/test/auth-refresh.test.ts', basename: 'auth-refresh.test.ts', dir: '/workspace/demo-app/test', uri: 'file:///workspace/demo-app/test/auth-refresh.test.ts', ops: ['read', 'write', 'edit'], readCount: 1, editCount: 1, writeCount: 1, totalTouches: 3, lastStepIndex: 28, lastTimestamp: '2026-11-26T06:44:50Z' },
      { path: '/workspace/demo-app/src/middleware/session.ts', basename: 'session.ts', dir: '/workspace/demo-app/src/middleware', uri: 'file:///workspace/demo-app/src/middleware/session.ts', ops: ['read'], readCount: 2, editCount: 0, writeCount: 0, totalTouches: 2, lastStepIndex: 8, lastTimestamp: '2026-11-26T06:16:30Z' },
      { path: '/workspace/demo-app/package.json', basename: 'package.json', dir: '/workspace/demo-app', uri: 'file:///workspace/demo-app/package.json', ops: ['read'], readCount: 1, editCount: 0, writeCount: 0, totalTouches: 1, lastStepIndex: 2, lastTimestamp: '2026-11-26T06:10:44Z' },
    ],
    artifacts: [
      { name: 'implementation_plan.md', path: '/workspace/demo/implementation_plan.md', uri: 'file:///workspace/demo/implementation_plan.md', sizeBytes: 4_820, updatedAt: '2026-11-26T06:22:00Z', preview: '# OAuth2 PKCE Single-Flight Refresh Plan\n\nUse an in-memory single-flight promise keyed by session ID with 30s clock-skew margin so parallel 401 responses share one refresh call...' },
      { name: 'walkthrough.md', path: '/workspace/demo/walkthrough.md', uri: 'file:///workspace/demo/walkthrough.md', sizeBytes: 2_940, updatedAt: '2026-11-26T06:48:00Z', preview: '# Verification Summary\n\nAll 24 unit and concurrent-race integration tests pass. Verified zero duplicate refresh calls across 50 simultaneous requests...' },
    ],
    recentSteps: [
      { stepIndex: 30, type: 'PLANNER_RESPONSE', source: 'MODEL', timestamp: '2026-11-26T06:48:10Z', model: 'gemini-4-neon-high', inputTokens: 96_400, cacheReadTokens: 58_300, outputTokens: 2_200, toolNames: ['run_command'], preview: 'Final verification run: npm test (24/24 passed in 1.4s)', bytes: 4_800, truncated: false },
      { stepIndex: 27, type: 'PLANNER_RESPONSE', source: 'MODEL', timestamp: '2026-11-26T06:42:40Z', model: 'gemini-4-neon-high', inputTokens: 85_500, cacheReadTokens: 54_100, outputTokens: 2_410, toolNames: ['edit_file', 'run_command'], preview: 'Fix edge case when refresh token rotates mid-flight and update test assertion', bytes: 11_900, truncated: false },
      { stepIndex: 22, type: 'PLANNER_RESPONSE', source: 'MODEL', timestamp: '2026-11-26T06:36:05Z', model: 'gemini-4-neon-high', inputTokens: 78_900, cacheReadTokens: 69_200, outputTokens: 3_120, toolNames: ['edit_file', 'read_file', 'run_command'], preview: 'Wire single-flight lock into token-refresh.ts and run race suite', bytes: 14_300, truncated: true },
    ],
    diagnostics: [
      { severity: 'good', title: 'Healthy Prefix Cache (72.2%)', detail: '348.2K of 482.4K input tokens served from prompt cache across 8 turns.' },
      { severity: 'warn', title: 'Top Token Vampire: run_command (44.5%)', detail: '7 shell invocations returned 68.4 KB (2 truncated). Filter verbose test logs with --reporter=dot or tail.' },
      { severity: 'info', title: 'Cache Dip at Turn 7 (-24.4%)', detail: 'Cache hit dropped from 87.7% to 63.3% after a large test output spike.' },
    ],
    swarmLineage: {
      totalSubagents: 2,
      linkedTranscripts: 2,
      orphanSuspects: 0,
      totalSubagentInputTokens: 118_600,
      totalSubagentOutputTokens: 7_950,
      children: [
        {
          conversationId: 'demo-sub-scout-01',
          role: 'Scout',
          typeName: 'scout',
          model: 'gemini-4-flash',
          stepIndex: 5,
          timestamp: '2026-11-26T06:14:22Z',
          transcriptFound: true,
          totalInputTokens: 46_200,
          totalCacheReadTokens: 29_400,
          totalOutputTokens: 3_150,
          cacheHitRate: 0.6364,
          turns: 3,
          statusHint: 'completed',
        },
        {
          conversationId: 'demo-sub-auditor-02',
          role: 'Auditor',
          typeName: 'auditor',
          model: 'gemini-4-neon-high',
          stepIndex: 26,
          timestamp: '2026-11-26T06:43:02Z',
          transcriptFound: true,
          totalInputTokens: 72_400,
          totalCacheReadTokens: 54_800,
          totalOutputTokens: 4_800,
          cacheHitRate: 0.7569,
          turns: 4,
          statusHint: 'completed',
        },
      ],
    },
    modelBreakdown: [
      {
        model: 'gemini-4-neon-high',
        turns: 6,
        inputTokens: 395_600,
        cacheReadTokens: 296_800,
        freshInputTokens: 98_800,
        outputTokens: 14_680,
        cacheHitRate: 0.7503,
        retrySignals: 0,
        sharePercent: 81.7,
      },
      {
        model: 'gemini-4-flash',
        turns: 2,
        inputTokens: 86_800,
        cacheReadTokens: 51_400,
        freshInputTokens: 35_400,
        outputTokens: 5_160,
        cacheHitRate: 0.5922,
        retrySignals: 1,
        sharePercent: 18.3,
      },
    ],
  };

  const s2Detail: SessionDetail = {
    ...s1Detail,
    summary: s2Summary,
    composition: [
      { key: 'cached_prefix', label: 'Cached Prefix', tokens: 162_100, sharePercent: 71.3 },
      { key: 'fresh_input', label: 'Fresh Context Input', tokens: 38_200, sharePercent: 16.8 },
      { key: 'tool_outputs_est', label: 'Tool Output Payload (est.)', tokens: 15_600, sharePercent: 6.9 },
      { key: 'assistant_output', label: 'Model Output', tokens: 11_420, sharePercent: 5.0 },
    ],
    turns: s1Detail.turns.slice(0, 5).map((t, i) => ({
      ...t,
      turnIndex: i + 1,
      model: 'gemini-4-flash',
      inputTokens: Math.round(t.inputTokens * 0.65),
      cacheReadTokens: Math.round(t.cacheReadTokens * 0.72),
      freshInputTokens: Math.round(t.freshInputTokens * 0.55),
    })),
    diagnostics: [
      { severity: 'good', title: 'High Cache Reuse (75.1%)', detail: 'Stable prompt prefix kept p95 latency low across 5 turns.' },
    ],
    swarmLineage: {
      totalSubagents: 0,
      linkedTranscripts: 0,
      orphanSuspects: 0,
      totalSubagentInputTokens: 0,
      totalSubagentOutputTokens: 0,
      children: [],
    },
    modelBreakdown: [
      {
        model: 'gemini-4-flash',
        turns: 5,
        inputTokens: 215_900,
        cacheReadTokens: 162_100,
        freshInputTokens: 53_800,
        outputTokens: 11_420,
        cacheHitRate: 0.7508,
        retrySignals: 0,
        sharePercent: 100,
      },
    ],
  };

  const s3Detail: SessionDetail = {
    ...s1Detail,
    summary: s3Summary,
    turns: s1Detail.turns.slice(0, 4).map((t, i) => ({
      ...t,
      turnIndex: i + 1,
      model: 'gemini-4-neon-high',
      inputTokens: Math.round(t.inputTokens * 0.52),
      cacheReadTokens: Math.round(t.cacheReadTokens * 0.48),
      freshInputTokens: Math.round(t.freshInputTokens * 0.6),
    })),
    diagnostics: [
      { severity: 'info', title: 'Moderate Cache Reuse (63.5%)', detail: 'Consider batching Dockerfile & workflow edits in fewer turns.' },
    ],
    swarmLineage: {
      totalSubagents: 0,
      linkedTranscripts: 0,
      orphanSuspects: 0,
      totalSubagentInputTokens: 0,
      totalSubagentOutputTokens: 0,
      children: [],
    },
    modelBreakdown: [
      {
        model: 'gemini-4-neon-high',
        turns: 4,
        inputTokens: 149_300,
        cacheReadTokens: 94_800,
        freshInputTokens: 54_500,
        outputTokens: 8_210,
        cacheHitRate: 0.635,
        retrySignals: 0,
        sharePercent: 100,
      },
    ],
  };

  return {
    summaries: [s1Summary, s2Summary, s3Summary],
    details: {
      [s1Summary.id]: s1Detail,
      [s2Summary.id]: s2Detail,
      [s3Summary.id]: s3Detail,
    },
  };
}

export function searchDemoSessions(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  const { summaries, details } = buildDemoSessions();
  const hits: SearchHit[] = [];
  for (const s of summaries) {
    const hay = `${s.title} ${s.firstPrompt}`.toLowerCase();
    if (!q || hay.includes(q) || q.split(/\s+/).some((w) => hay.includes(w))) {
      hits.push({
        sessionId: s.id,
        sessionTitle: s.title,
        updatedAt: s.updatedAt,
        sourceKind: 'transcript',
        sourceLabel: 'User Request',
        filePath: s.transcriptPath,
        uri: `file://${s.transcriptPath}`,
        score: hay.includes(q) ? 9.5 : 4.2,
        snippet: s.firstPrompt,
      });
    }
    const detail = details[s.id];
    for (const art of detail?.artifacts ?? []) {
      const ahay = `${art.name} ${art.preview}`.toLowerCase();
      if (!q || ahay.includes(q) || q.split(/\s+/).some((w) => ahay.includes(w))) {
        hits.push({
          sessionId: s.id,
          sessionTitle: s.title,
          updatedAt: art.updatedAt,
          sourceKind: 'artifact',
          sourceLabel: art.name,
          filePath: art.path,
          uri: art.uri,
          score: ahay.includes(q) ? 10.0 : 4.5,
          snippet: art.preview,
        });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}
