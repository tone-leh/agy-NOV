import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { redactSecrets } from './sanitize.js';
import type {
  ArtifactSummary,
  ContextCompositionBucket,
  FileActivityItem,
  FileOp,
  SessionDetail,
  SessionSummary,
  ToolHotspot,
  TurnMetric,
} from './types.js';

interface RawTranscriptStep {
  step_index?: number;
  source?: string;
  type?: string;
  status?: string;
  created_at?: string;
  model?: string;
  input_tokens?: number;
  cache_read_tokens?: number;
  output_tokens?: number;
  thinking?: string;
  content?: string;
  truncated_fields?: string[];
  tool_calls?: Array<{
    name?: string;
    tool_name?: string;
    args?: Record<string, unknown>;
  }>;
}

const READ_TOOLS = new Set([
  'read_file',
  'view_file',
  'view_file_outline',
  'view_code_item',
  'read_resource',
  'grep_search',
  'find_by_name',
  'list_dir',
]);

const EDIT_TOOLS = new Set([
  'edit_file',
  'replace_file_content',
  'multi_replace_file_content',
  'apply_patch',
]);

const WRITE_TOOLS = new Set([
  'write_file',
  'write_to_file',
  'create_file',
]);

const FILE_ARG_KEYS = [
  'Path',
  'path',
  'AbsolutePath',
  'TargetFile',
  'file_path',
  'filePath',
  'uri',
  'Uri',
  'DirectoryPath',
];

function unwrapArgString(raw: unknown): string {
  if (typeof raw !== 'string') {
    if (raw == null) return '';
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function cleanUserRequest(raw: string): string {
  const match = raw.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  const body = match ? match[1] : raw;
  return body.replace(/\s+/g, ' ').trim();
}

function toSafeFileUri(filePath: string): string {
  if (filePath.startsWith('file://')) return filePath;
  try {
    return pathToFileURL(path.resolve(filePath)).href;
  } catch {
    return `file://${filePath}`;
  }
}

function classifyToolFileOp(toolName: string): FileOp | null {
  const lower = toolName.toLowerCase();
  if (WRITE_TOOLS.has(lower)) return 'write';
  if (EDIT_TOOLS.has(lower)) return 'edit';
  if (READ_TOOLS.has(lower)) return 'read';
  return null;
}

function extractFilePathsFromArgs(args: Record<string, unknown> | undefined): string[] {
  if (!args) return [];
  const results: string[] = [];
  for (const key of FILE_ARG_KEYS) {
    if (key in args && args[key] != null) {
      const val = unwrapArgString(args[key]);
      if (val && (val.startsWith('/') || /^[A-Za-z]:\\/.test(val) || val.startsWith('file://'))) {
        results.push(val.replace(/^file:\/\//, ''));
      }
    }
  }
  return results;
}

function listArtifactsInBrainDir(brainDir: string): ArtifactSummary[] {
  if (!brainDir || !fs.existsSync(brainDir)) return [];
  const artifacts: ArtifactSummary[] = [];
  try {
    for (const entry of fs.readdirSync(brainDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(md|txt|json|html|svg)$/i.test(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(brainDir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath, 'utf8').slice(0, 800);
        artifacts.push({
          name: entry.name,
          path: fullPath,
          uri: toSafeFileUri(fullPath),
          sizeBytes: stat.size,
          updatedAt: stat.mtime.toISOString(),
          preview: redactSecrets(content.replace(/\r\n/g, '\n').trim()),
        });
      } catch {
        // ignore unreadable files
      }
    }
  } catch {
    // ignore unreadable directory
  }
  return artifacts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function parseTranscriptFile(
  transcriptPath: string,
  opts: {
    sessionId?: string;
    source?: SessionSummary['source'];
    brainDir?: string;
  } = {},
): SessionDetail {
  const rawText = fs.readFileSync(transcriptPath, 'utf8');
  return parseTranscriptLines(rawText.split(/\r?\n/), {
    transcriptPath,
    brainDir: opts.brainDir ?? path.resolve(path.dirname(transcriptPath), '..', '..'),
    sessionId: opts.sessionId ?? path.basename(path.resolve(path.dirname(transcriptPath), '..', '..')),
    source: opts.source ?? 'desktop',
  });
}

export function parseTranscriptLines(
  lines: string[],
  meta: {
    transcriptPath: string;
    brainDir: string;
    sessionId: string;
    source: SessionSummary['source'];
  },
): SessionDetail {
  const steps: RawTranscriptStep[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      steps.push(JSON.parse(trimmed) as RawTranscriptStep);
    } catch {
      // skip partial/corrupt JSONL line cleanly
    }
  }

  let firstPrompt = '';
  let startedAt = '';
  let updatedAt = '';
  let lastModel = 'unknown';

  const turns: TurnMetric[] = [];
  const toolStats = new Map<
    string,
    { calls: number; totalOutputBytes: number; truncatedCount: number }
  >();
  const fileMap = new Map<string, FileActivityItem>();

  let totalInputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalFreshInputTokens = 0;
  let totalOutputTokens = 0;
  let peakContextTokens = 0;
  let totalToolCalls = 0;
  let totalThinkingChars = 0;

  let pendingToolNames: string[] = [];
  let pendingTurnIdx = -1;
  let latestUserPrompt = '';

  const recentSteps: SessionDetail['recentSteps'] = [];

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const stepIndex = typeof s.step_index === 'number' ? s.step_index : i;
    const timestamp = s.created_at ?? '';
    if (timestamp) {
      if (!startedAt) startedAt = timestamp;
      updatedAt = timestamp;
    }

    const type = s.type ?? 'UNKNOWN';
    const source = s.source ?? 'UNKNOWN';
    const content = typeof s.content === 'string' ? s.content : '';
    const truncated = Array.isArray(s.truncated_fields) && s.truncated_fields.length > 0;

    if (type === 'USER_INPUT') {
      const cleaned = cleanUserRequest(content);
      if (!firstPrompt && cleaned) firstPrompt = redactSecrets(cleaned);
      if (cleaned) latestUserPrompt = cleaned;
      pendingToolNames = [];
      pendingTurnIdx = -1;
      recentSteps.push({
        stepIndex,
        type,
        source,
        timestamp,
        toolNames: [],
        preview: redactSecrets(cleaned).slice(0, 180),
        bytes: Buffer.byteLength(content, 'utf8'),
        truncated,
      });
      continue;
    }

    if (type === 'PLANNER_RESPONSE') {
      const model = s.model ?? lastModel;
      if (s.model) lastModel = s.model;

      const rawIn = Number(s.input_tokens ?? 0);
      const rawCache = Number(s.cache_read_tokens ?? 0);
      const rawOut = Number(s.output_tokens ?? 0);

      const freshInput = Math.max(0, rawIn);
      const effectiveInput = freshInput + Math.max(0, rawCache);
      const cacheHitRate = effectiveInput > 0 ? rawCache / effectiveInput : 0;

      totalInputTokens += effectiveInput;
      totalCacheReadTokens += rawCache;
      totalFreshInputTokens += freshInput;
      totalOutputTokens += rawOut;
      if (effectiveInput > peakContextTokens) peakContextTokens = effectiveInput;

      const thinkingChars = typeof s.thinking === 'string' ? s.thinking.length : 0;
      totalThinkingChars += thinkingChars;

      const toolCalls = Array.isArray(s.tool_calls) ? s.tool_calls : [];
      const toolNames: string[] = [];
      pendingToolNames = [];

      for (const tc of toolCalls) {
        const name = tc.name ?? tc.tool_name ?? 'unknown_tool';
        toolNames.push(name);
        pendingToolNames.push(name);
        totalToolCalls += 1;

        const existing = toolStats.get(name) ?? {
          calls: 0,
          totalOutputBytes: 0,
          truncatedCount: 0,
        };
        existing.calls += 1;
        toolStats.set(name, existing);

        const op = classifyToolFileOp(name);
        if (op) {
          for (const fp of extractFilePathsFromArgs(tc.args)) {
            const normalized = path.resolve(fp);
            const cur = fileMap.get(normalized) ?? {
              path: normalized,
              basename: path.basename(normalized),
              dir: path.dirname(normalized),
              uri: toSafeFileUri(normalized),
              ops: [],
              readCount: 0,
              editCount: 0,
              writeCount: 0,
              totalTouches: 0,
              lastStepIndex: stepIndex,
              lastTimestamp: timestamp,
            };
            if (!cur.ops.includes(op)) cur.ops.push(op);
            if (op === 'read') cur.readCount += 1;
            if (op === 'edit') cur.editCount += 1;
            if (op === 'write') cur.writeCount += 1;
            cur.totalTouches += 1;
            cur.lastStepIndex = stepIndex;
            cur.lastTimestamp = timestamp;
            fileMap.set(normalized, cur);
          }
        }
      }

      const turnMetric: TurnMetric = {
        turnIndex: turns.length + 1,
        stepIndex,
        timestamp,
        model,
        inputTokens: effectiveInput,
        cacheReadTokens: rawCache,
        freshInputTokens: freshInput,
        outputTokens: rawOut,
        thinkingChars,
        toolCallsCount: toolCalls.length,
        toolOutputBytes: 0,
        cacheHitRate,
        userPromptPreview: latestUserPrompt ? redactSecrets(latestUserPrompt).slice(0, 120) : undefined,
      };
      latestUserPrompt = '';
      turns.push(turnMetric);
      pendingTurnIdx = turns.length - 1;

      recentSteps.push({
        stepIndex,
        type,
        source,
        timestamp,
        model,
        inputTokens: effectiveInput,
        cacheReadTokens: rawCache,
        outputTokens: rawOut,
        toolNames,
        preview: redactSecrets(content || (s.thinking ? `[thinking] ${s.thinking}` : toolNames.join(', '))).slice(0, 180),
        bytes: Buffer.byteLength(content, 'utf8'),
        truncated,
      });
      continue;
    }

    const bytes = Buffer.byteLength(content, 'utf8');
    const attributedTool = pendingToolNames.shift();
    if (attributedTool) {
      const stat = toolStats.get(attributedTool);
      if (stat) {
        stat.totalOutputBytes += bytes;
        if (truncated) stat.truncatedCount += 1;
      }
      if (pendingTurnIdx >= 0 && turns[pendingTurnIdx]) {
        turns[pendingTurnIdx].toolOutputBytes += bytes;
      }
    }

    recentSteps.push({
      stepIndex,
      type,
      source,
      timestamp,
      toolNames: attributedTool ? [attributedTool] : [],
      preview: redactSecrets(content.replace(/\s+/g, ' ').trim()).slice(0, 180),
      bytes,
      truncated,
    });
  }

  const totalToolBytes = Array.from(toolStats.values()).reduce((sum, v) => sum + v.totalOutputBytes, 0);
  const toolHotspots: ToolHotspot[] = Array.from(toolStats.entries())
    .map(([toolName, stat]) => ({
      toolName,
      calls: stat.calls,
      totalOutputBytes: stat.totalOutputBytes,
      avgOutputBytes: stat.calls > 0 ? Math.round(stat.totalOutputBytes / stat.calls) : 0,
      estimatedTokens: Math.round(stat.totalOutputBytes / 4),
      truncatedCount: stat.truncatedCount,
      sharePercent:
        totalToolBytes > 0 ? Number(((stat.totalOutputBytes / totalToolBytes) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.totalOutputBytes - a.totalOutputBytes || b.calls - a.calls);

  const fileActivity = Array.from(fileMap.values()).sort(
    (a, b) => b.editCount + b.writeCount - (a.editCount + a.writeCount) || b.totalTouches - a.totalTouches,
  );

  const artifacts = listArtifactsInBrainDir(meta.brainDir);

  const estToolTokens = Math.min(totalFreshInputTokens, Math.round(totalToolBytes / 4));
  const netFreshTokens = Math.max(0, totalFreshInputTokens - estToolTokens);
  const estThinkingTokens = Math.round(totalThinkingChars / 4);
  const compTotal =
    totalCacheReadTokens + netFreshTokens + estToolTokens + totalOutputTokens + estThinkingTokens;

  const pct = (n: number) => (compTotal > 0 ? Number(((n / compTotal) * 100).toFixed(1)) : 0);

  const allBuckets: ContextCompositionBucket[] = [
    {
      key: 'cached_prefix',
      label: 'Cached Prefix',
      tokens: totalCacheReadTokens,
      sharePercent: pct(totalCacheReadTokens),
    },
    {
      key: 'fresh_input',
      label: 'Fresh Context Input',
      tokens: netFreshTokens,
      sharePercent: pct(netFreshTokens),
    },
    {
      key: 'tool_outputs_est',
      label: 'Tool Output Payload (est.)',
      tokens: estToolTokens,
      sharePercent: pct(estToolTokens),
    },
    {
      key: 'thinking_est',
      label: 'Reasoning / Thinking (est.)',
      tokens: estThinkingTokens,
      sharePercent: pct(estThinkingTokens),
    },
    {
      key: 'assistant_output',
      label: 'Model Output',
      tokens: totalOutputTokens,
      sharePercent: pct(totalOutputTokens),
    },
  ];
  const composition = allBuckets.filter((b) => b.tokens > 0);

  const overallCacheHit = totalInputTokens > 0 ? totalCacheReadTokens / totalInputTokens : 0;

  const diagnostics: SessionDetail['diagnostics'] = [];
  if (turns.length >= 2) {
    if (overallCacheHit >= 0.65) {
      diagnostics.push({
        severity: 'good',
        title: `Healthy Prefix Cache (${(overallCacheHit * 100).toFixed(1)}%)`,
        detail: `${formatCompactTokens(totalCacheReadTokens)} of ${formatCompactTokens(totalInputTokens)} input tokens served from prompt cache across ${turns.length} turns.`,
      });
    } else {
      diagnostics.push({
        severity: 'warn',
        title: `Low Prefix Cache Hit (${(overallCacheHit * 100).toFixed(1)}%)`,
        detail: `Only ${formatCompactTokens(totalCacheReadTokens)} input tokens reused cache. Avoid mid-session config churn or huge unbatched tool bursts.`,
      });
    }
  }

  const topVampire = toolHotspots[0];
  if (topVampire && topVampire.totalOutputBytes > 8_000) {
    diagnostics.push({
      severity: topVampire.truncatedCount > 0 || topVampire.sharePercent > 40 ? 'warn' : 'info',
      title: `Top Token Consumer: ${topVampire.toolName} (${topVampire.sharePercent}%)`,
      detail: `${topVampire.calls} calls returned ${(topVampire.totalOutputBytes / 1024).toFixed(1)} KB (~${formatCompactTokens(topVampire.estimatedTokens)} tokens${topVampire.truncatedCount ? `, ${topVampire.truncatedCount} truncated` : ''}).`,
    });
  }

  for (let t = 1; t < turns.length; t++) {
    const prev = turns[t - 1];
    const curr = turns[t];
    if (prev.cacheHitRate >= 0.5 && prev.cacheHitRate - curr.cacheHitRate >= 0.25) {
      diagnostics.push({
        severity: 'info',
        title: `Cache Dip at Turn ${curr.turnIndex} (-${((prev.cacheHitRate - curr.cacheHitRate) * 100).toFixed(1)}%)`,
        detail: `Prefix cache fell from ${(prev.cacheHitRate * 100).toFixed(1)}% to ${(curr.cacheHitRate * 100).toFixed(1)}% at step #${curr.stepIndex}.`,
      });
      break;
    }
  }

  const title = firstPrompt
    ? firstPrompt.slice(0, 72) + (firstPrompt.length > 72 ? '…' : '')
    : `Session ${meta.sessionId.slice(0, 8)}`;

  const summary: SessionSummary = {
    id: meta.sessionId,
    source: meta.source,
    title,
    firstPrompt: firstPrompt.slice(0, 320),
    startedAt: startedAt || new Date(0).toISOString(),
    updatedAt: updatedAt || startedAt || new Date(0).toISOString(),
    model: lastModel,
    turns: turns.length,
    steps: steps.length,
    totalInputTokens,
    totalCacheReadTokens,
    totalFreshInputTokens,
    totalOutputTokens,
    peakContextTokens,
    cacheHitRate: overallCacheHit,
    toolCallsCount: totalToolCalls,
    filesTouchedCount: fileActivity.length,
    artifactsCount: artifacts.length,
    transcriptPath: meta.transcriptPath,
    brainDir: meta.brainDir,
  };

  return {
    summary,
    composition,
    turns,
    toolHotspots,
    fileActivity,
    artifacts,
    recentSteps: recentSteps.slice(-60).reverse(),
    diagnostics,
  };
}

export function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

export function renderRedactedBrief(detail: SessionDetail): string {
  const s = detail.summary;
  const lines: string[] = [
    `# Session X-Ray Brief: ${redactSecrets(s.title)}`,
    '',
    `- **Session ID**: \`${s.id}\``,
    `- **Model**: \`${s.model}\` | **Turns**: ${s.turns} | **Steps**: ${s.steps}`,
    `- **Input Tokens**: ${formatCompactTokens(s.totalInputTokens)} (Cache Hit: **${(s.cacheHitRate * 100).toFixed(1)}%**, Peak Window: ${formatCompactTokens(s.peakContextTokens)})`,
    `- **Output Tokens**: ${formatCompactTokens(s.totalOutputTokens)} | **Tool Calls**: ${s.toolCallsCount}`,
    '',
    '## Context Diagnostics',
    ...detail.diagnostics.map((d) => `- **[${d.severity.toUpperCase()}] ${redactSecrets(d.title)}** — ${redactSecrets(d.detail)}`),
    '',
    '## Top Tool Output Consumers',
    '| Tool | Calls | Payload | Est. Tokens | Share |',
    '| :--- | ---: | ---: | ---: | ---: |',
    ...detail.toolHotspots.slice(0, 8).map(
      (t) =>
        `| \`${t.toolName}\` | ${t.calls} | ${(t.totalOutputBytes / 1024).toFixed(1)} KB | ${formatCompactTokens(t.estimatedTokens)} | ${t.sharePercent}% |`,
    ),
    '',
    '## Workspace Files Touched',
    ...(detail.fileActivity.length
      ? detail.fileActivity.slice(0, 20).map(
          (f) => `- \`${f.path}\` (${f.ops.join('/')} · ${f.totalTouches} touches)`,
        )
      : ['- No workspace file operations recorded.']),
    '',
    '## Artifacts',
    ...(detail.artifacts.length
      ? detail.artifacts.map((a) => `- \`${a.name}\` (${(a.sizeBytes / 1024).toFixed(1)} KB)`)
      : ['- No markdown artifacts in brain directory.']),
  ];
  return redactSecrets(lines.join('\n'));
}
