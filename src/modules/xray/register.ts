import path from 'node:path';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getModuleDataDir } from '../../core/config.js';
import type { ModuleRegistrationResult, ModuleToolHandle, NovRuntimeOptions } from '../../core/types.js';
import {
  buildOtlpUsagePayload,
  computeCostAnalytics,
  renderHandoffSnapshot,
  renderUsageCsv,
} from './analytics.js';
import {
  listSessions,
  loadSessionDetail,
  readLiveHookState,
  type DiscoveryOptions,
} from './discovery.js';
import { formatUsd } from './pricing.js';
import { redactSecrets } from './sanitize.js';
import { searchSessions } from './search.js';
import { formatCompactTokens, renderRedactedBrief } from './transcript.js';

function wrapModelTool(name: string, tool: RegisteredTool): ModuleToolHandle {
  return {
    name,
    enable: () => tool.enable(),
    disable: () => tool.disable(),
  };
}

export function registerXrayModule(
  server: McpServer,
  opts: NovRuntimeOptions,
  uiResourceUri: string,
): ModuleRegistrationResult {
  const moduleDataDir = getModuleDataDir(opts.dataDir, 'xray');
  const discoveryOpts: DiscoveryOptions = {
    dataDir: moduleDataDir,
    brainDirs: opts.brainDir ? [{ dir: path.resolve(opts.brainDir), source: 'custom' }] : undefined,
    demoMode: opts.demoMode,
  };

  const INLINE_META = {
    ui: { resourceUri: uiResourceUri },
  };

  const APP_ONLY_META = {
    ui: { visibility: ['app'] },
  };

  // Model-visible tools (4)
  const analyzeContextTool = server.registerTool(
    'xray_analyze_context',
    {
      title: 'Analyze Session Context',
      description:
        'Analyze an Antigravity session transcript for context composition, prompt cache hit rate, estimated offline USD cost, turn-by-turn growth, and tool-output hotspots ("Token Vampires").',
      inputSchema: {
        sessionId: z.string().optional().describe('Optional session ID; defaults to the active or latest session'),
      },
      _meta: INLINE_META,
    },
    async ({ sessionId }) => {
      const detail = loadSessionDetail(sessionId, discoveryOpts);
      if (!detail) {
        return {
          content: [{ type: 'text', text: 'No local session transcript found to analyze.' }],
        };
      }
      const s = detail.summary;
      const topTools = detail.toolHotspots
        .slice(0, 5)
        .map((t) => `${t.toolName}: ${(t.totalOutputBytes / 1024).toFixed(1)} KB (${t.sharePercent}%)`)
        .join(', ');
      const swarmAndModelParts: string[] = [];
      if (detail.swarmLineage.totalSubagents > 0) {
        const sl = detail.swarmLineage;
        swarmAndModelParts.push(
          `Swarm: ${sl.totalSubagents} subagents (${sl.linkedTranscripts} linked, ${sl.orphanSuspects} orphan suspect, +${formatCompactTokens(sl.totalSubagentInputTokens)} in / +${formatCompactTokens(sl.totalSubagentOutputTokens)} out)`,
        );
      }
      if (detail.modelBreakdown.length > 1) {
        swarmAndModelParts.push(
          `Models: ${detail.modelBreakdown
            .map((m) => `${m.model} ${m.sharePercent}%${m.retrySignals > 0 ? ` (${m.retrySignals} retry)` : ''}`)
            .join(', ')}`,
        );
      }
      return {
        content: [
          {
            type: 'text',
            text: [
              `Context X-Ray — ${s.title}`,
              `• Peak Window: ${formatCompactTokens(s.peakContextTokens)} | Total Input: ${formatCompactTokens(s.totalInputTokens)} | Output: ${formatCompactTokens(s.totalOutputTokens)}`,
              `• Prefix Cache Hit: ${(s.cacheHitRate * 100).toFixed(1)}% (${formatCompactTokens(s.totalCacheReadTokens)} cached)`,
              `• Est. Cost (USD): ~${formatUsd(s.estimatedUsd)} | Cache Savings: ~${formatUsd(s.cacheSavingsUsd)} (offline ref. pricing)`,
              `• Top Tool Consumers: ${topTools || 'none'}`,
              ...(swarmAndModelParts.length > 0
                ? [`• Swarm & Models: ${swarmAndModelParts.join(' | ')}`]
                : []),
              ...detail.diagnostics.map((d) => `• [${d.severity.toUpperCase()}] ${d.title}: ${d.detail}`),
            ].join('\n'),
          },
        ],
        structuredContent: {
          novModule: 'xray',
          initialTab: 'overview',
          sessions: listSessions({ ...discoveryOpts, limit: 15 }),
          detail,
        },
      };
    },
  );

  const getFileActivityTool = server.registerTool(
    'xray_get_file_activity',
    {
      title: 'Get Workspace File Activity',
      description:
        'List all workspace files read, edited, or created in the current or specified Antigravity session.',
      inputSchema: {
        sessionId: z.string().optional().describe('Optional session ID; defaults to latest'),
        modifiedOnly: z.boolean().optional().describe('If true, only include edited or written files'),
      },
      _meta: INLINE_META,
    },
    async ({ sessionId, modifiedOnly }) => {
      const detail = loadSessionDetail(sessionId, discoveryOpts);
      if (!detail) {
        return { content: [{ type: 'text', text: 'No local session transcript found.' }] };
      }
      const files = modifiedOnly
        ? detail.fileActivity.filter((f) => f.editCount + f.writeCount > 0)
        : detail.fileActivity;
      const text = files.length
        ? files.map((f) => `- [${f.ops.join('/').toUpperCase()}] ${f.path} (${f.totalTouches}x)`).join('\n')
        : 'No workspace file activity recorded in this session.';
      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          novModule: 'xray',
          initialTab: 'files',
          sessions: listSessions({ ...discoveryOpts, limit: 15 }),
          detail,
        },
      };
    },
  );

  const searchSessionsTool = server.registerTool(
    'xray_search_sessions',
    {
      title: 'Search Past Antigravity Sessions',
      description:
        'Full-text local BM25 search across historical Antigravity transcripts and markdown artifacts (supports English and CJK).',
      inputSchema: {
        query: z.string().describe('Keywords or phrase to search across sessions and artifacts'),
        limit: z.number().int().min(1).max(30).optional().describe('Maximum matches to return (default 10)'),
      },
    },
    async ({ query, limit }) => {
      const hits = searchSessions(query, { ...discoveryOpts, limit: limit ?? 10 });
      const text = hits.length
        ? hits
            .map(
              (h, i) =>
                `${i + 1}. [${h.sourceKind}:${h.sourceLabel}] ${h.sessionTitle} (score ${h.score})\n   ${h.snippet}`,
            )
            .join('\n')
        : `No local sessions or artifacts matched "${query}".`;
      return {
        content: [{ type: 'text', text }],
        structuredContent: { query, hits },
      };
    },
  );

  const exportBriefTool = server.registerTool(
    'xray_export_brief',
    {
      title: 'Export Redacted Session Brief / Handoff / OTLP / CSV',
      description:
        'Generate a secret-redacted session export: Markdown brief (default), anti-compaction handoff snapshot, OpenTelemetry OTLP metrics JSON, or formula-safe daily usage CSV.',
      inputSchema: {
        sessionId: z.string().optional().describe('Optional session ID; defaults to latest'),
        format: z
          .enum(['brief', 'handoff', 'otlp', 'csv'])
          .optional()
          .describe("Export format: 'brief' (default), 'handoff', 'otlp', or 'csv'"),
      },
    },
    async ({ sessionId, format }) => {
      const effectiveFormat = format ?? 'brief';
      if (effectiveFormat === 'csv') {
        const analytics = computeCostAnalytics(discoveryOpts);
        const csv = renderUsageCsv(analytics);
        return {
          content: [{ type: 'text', text: csv }],
          structuredContent: {
            format: 'csv',
            csv,
            sessionsAnalyzed: analytics.sessionsAnalyzed,
          },
        };
      }

      const detail = loadSessionDetail(sessionId, discoveryOpts);
      if (!detail) {
        return { content: [{ type: 'text', text: 'No session found to export.' }] };
      }

      if (effectiveFormat === 'handoff') {
        const markdown = renderHandoffSnapshot(detail);
        return {
          content: [{ type: 'text', text: markdown }],
          structuredContent: {
            sessionId: detail.summary.id,
            format: 'handoff',
            markdown,
          },
        };
      }

      if (effectiveFormat === 'otlp') {
        const analytics = computeCostAnalytics(discoveryOpts);
        const otlp = buildOtlpUsagePayload(detail, analytics);
        const json = JSON.stringify(otlp, null, 2);
        return {
          content: [{ type: 'text', text: json }],
          structuredContent: {
            sessionId: detail.summary.id,
            format: 'otlp',
            otlp,
            json,
          },
        };
      }

      const markdown = renderRedactedBrief(detail);
      return {
        content: [{ type: 'text', text: markdown }],
        structuredContent: { sessionId: detail.summary.id, markdown },
      };
    },
  );

  // App-only tools (8)
  server.registerTool(
    'app_xray_list_sessions',
    {
      title: 'List Sessions (App Only)',
      description: 'Return recent local Antigravity sessions for the X-Ray UI switcher.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ limit }) => {
      const sessions = listSessions({ ...discoveryOpts, limit: limit ?? 30 });
      return {
        content: [{ type: 'text', text: `${sessions.length} sessions` }],
        structuredContent: { sessions },
      };
    },
  );

  server.registerTool(
    'app_xray_get_session_detail',
    {
      title: 'Get Session Detail (App Only)',
      description: 'Fetch full parsed session X-Ray metrics without bloating the model trajectory.',
      inputSchema: {
        sessionId: z.string().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ sessionId }) => {
      const detail = loadSessionDetail(sessionId, discoveryOpts);
      const hookState = readLiveHookState(discoveryOpts.dataDir);
      return {
        content: [{ type: 'text', text: detail ? detail.summary.title : 'empty' }],
        structuredContent: { detail, hookState },
      };
    },
  );

  server.registerTool(
    'app_xray_search_sessions',
    {
      title: 'Search Sessions (App Only)',
      description: 'Interactive Time Machine search called directly from the X-Ray UI.',
      inputSchema: {
        query: z.string(),
        limit: z.number().int().min(1).max(30).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ query, limit }) => {
      const hits = searchSessions(query, { ...discoveryOpts, limit: limit ?? 15 });
      return {
        content: [{ type: 'text', text: `${hits.length} hits` }],
        structuredContent: { query, hits },
      };
    },
  );

  server.registerTool(
    'app_xray_export_brief',
    {
      title: 'Export Brief (App Only)',
      description: 'Generate a secret-redacted markdown brief from the UI.',
      inputSchema: {
        sessionId: z.string().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ sessionId }) => {
      const detail = loadSessionDetail(sessionId, discoveryOpts);
      const markdown = detail ? renderRedactedBrief(detail) : '';
      return {
        content: [{ type: 'text', text: redactSecrets(markdown) }],
        structuredContent: { markdown: redactSecrets(markdown) },
      };
    },
  );

  server.registerTool(
    'app_xray_get_cost_analytics',
    {
      title: 'Get Offline Cost Analytics (App Only)',
      description:
        'Compute read-only offline USD billing estimates, 14-day UTC trend, and 5-hour rolling burn-rate alerts.',
      inputSchema: {
        limit: z.number().int().min(1).max(60).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ limit }) => {
      const analytics = computeCostAnalytics({ ...discoveryOpts, limit });
      return {
        content: [
          {
            type: 'text',
            text: `${analytics.sessionsAnalyzed} sessions · ${formatUsd(analytics.totalEstimatedUsd)} (${analytics.fiveHourWindow.warningLevel})`,
          },
        ],
        structuredContent: { analytics },
      };
    },
  );

  server.registerTool(
    'app_xray_export_handoff',
    {
      title: 'Export Anti-Compaction Handoff Snapshot (App Only)',
      description: 'Generate a secret-redacted Markdown handoff snapshot for seamless session continuation.',
      inputSchema: {
        sessionId: z.string().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ sessionId }) => {
      const detail = loadSessionDetail(sessionId, discoveryOpts);
      const markdown = detail ? renderHandoffSnapshot(detail) : '';
      return {
        content: [{ type: 'text', text: markdown }],
        structuredContent: { sessionId: detail?.summary.id ?? null, markdown },
      };
    },
  );

  server.registerTool(
    'app_xray_export_otlp',
    {
      title: 'Export Redacted OTLP Usage Payload (App Only)',
      description: 'Generate a redacted OpenTelemetry OTLP resourceMetrics JSON payload from the UI.',
      inputSchema: {
        sessionId: z.string().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ sessionId }) => {
      const detail = loadSessionDetail(sessionId, discoveryOpts);
      if (!detail) {
        return {
          content: [{ type: 'text', text: '' }],
          structuredContent: { sessionId: null, otlp: null, json: '' },
        };
      }
      const analytics = computeCostAnalytics(discoveryOpts);
      const otlp = buildOtlpUsagePayload(detail, analytics);
      const json = JSON.stringify(otlp, null, 2);
      return {
        content: [{ type: 'text', text: json }],
        structuredContent: { sessionId: detail.summary.id, otlp, json },
      };
    },
  );

  server.registerTool(
    'app_xray_export_csv',
    {
      title: 'Export Formula-Safe Daily Usage CSV (App Only)',
      description: 'Generate a formula-safe CSV of the 14-day daily token & estimated USD trend from the UI.',
      inputSchema: {
        limit: z.number().int().min(1).max(60).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ limit }) => {
      const analytics = computeCostAnalytics({ ...discoveryOpts, limit });
      const csv = renderUsageCsv(analytics);
      return {
        content: [{ type: 'text', text: csv }],
        structuredContent: { csv, sessionsAnalyzed: analytics.sessionsAnalyzed },
      };
    },
  );

  return {
    moduleId: 'xray',
    modelTools: [
      wrapModelTool('xray_analyze_context', analyzeContextTool),
      wrapModelTool('xray_get_file_activity', getFileActivityTool),
      wrapModelTool('xray_search_sessions', searchSessionsTool),
      wrapModelTool('xray_export_brief', exportBriefTool),
    ],
    exemptReadOnlyAppTools: [
      'app_xray_list_sessions',
      'app_xray_get_session_detail',
      'app_xray_get_cost_analytics',
    ],
  };
}
