import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getModuleDataDir, MODULE_CATALOG } from '../src/core/config.js';
import { normalizeHookPayload } from '../src/core/utils.js';
import {
  buildRadarStatusCapsule,
  computeRadarBoardView,
  createDemoRadarBoard,
  getRadarBoardPath,
  getRadarStatusCapsulePath,
  loadRadarBoardReadOnly,
  type RadarStatusCapsule,
} from '../src/modules/radar/core.js';
import { handleRadarHook } from '../src/modules/radar/hook.js';
import { registerRadarModule } from '../src/modules/radar/register.js';
import { loadSessionDetail } from '../src/modules/xray/discovery.js';
import { registerXrayModule } from '../src/modules/xray/register.js';
import { renderRedactedBrief } from '../src/modules/xray/transcript.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

function writeTranscript(brainRoot: string, sessionId: string, steps: Array<Record<string, unknown>>): string {
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

function listAllFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listAllFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out.sort();
}

describe('v0.3.0 X-Ray Swarm Lineage, Model Cost Breakdown & Diagnostics', () => {
  it('reconstructs swarmLineage, linked transcripts, orphan suspects, modelBreakdown, 429 diagnostics & brief strictly read-only', async () => {
    await withTempDir('agy-nov-xray-swarm-', (tmpDir) => {
      const brainRoot = path.join(tmpDir, 'brain');
      fs.mkdirSync(brainRoot, { recursive: true });

      // Child 1: completed cleanly with terminal DONE status
      writeTranscript(brainRoot, 'child-1', [
        {
          step_index: 0,
          type: 'USER_INPUT',
          source: 'USER',
          created_at: '2026-11-27T04:00:10Z',
          content: 'Inspect auth middleware modules',
        },
        {
          step_index: 1,
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          status: 'DONE',
          created_at: '2026-11-27T04:00:14Z',
          model: 'gemini-4-flash',
          input_tokens: 4000,
          cache_read_tokens: 6000,
          output_tokens: 700,
          content: 'Found 3 middleware files.',
        },
        {
          step_index: 2,
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          status: 'DONE',
          created_at: '2026-11-27T04:00:25Z',
          model: 'gemini-4-flash',
          input_tokens: 2000,
          cache_read_tokens: 8000,
          output_tokens: 500,
          content: 'Scout summary complete.',
        },
      ]);

      // Child 2: still RUNNING without terminal DONE (orphan suspect once parent finishes)
      writeTranscript(brainRoot, 'child-2', [
        {
          step_index: 0,
          type: 'USER_INPUT',
          source: 'USER',
          created_at: '2026-11-27T04:00:12Z',
          content: 'Audit security diff',
        },
        {
          step_index: 1,
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          status: 'RUNNING',
          created_at: '2026-11-27T04:00:20Z',
          model: 'gemini-4-neon-high',
          input_tokens: 5000,
          cache_read_tokens: 10000,
          output_tokens: 900,
          tool_calls: [{ name: 'read_file', args: { Path: '/workspace/src/auth.ts' } }],
          content: 'Waiting on file read...',
        },
      ]);

      // Parent session invoking child-1 (invoke_subagent) and child-2 (swarm add), hitting 429 & switching model
      writeTranscript(brainRoot, 'parent-1', [
        {
          step_index: 0,
          type: 'USER_INPUT',
          source: 'USER',
          created_at: '2026-11-27T04:00:00Z',
          content: '<USER_REQUEST>Coordinate Scout and Auditor subagents for auth refactor</USER_REQUEST>',
        },
        {
          step_index: 1,
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          status: 'DONE',
          created_at: '2026-11-27T04:00:05Z',
          model: 'gemini-4-neon-high',
          input_tokens: 15000,
          cache_read_tokens: 5000,
          output_tokens: 1200,
          tool_calls: [
            {
              name: 'invoke_subagent',
              args: { Role: 'Scout', TypeName: 'scout', Model: 'gemini-4-flash' },
            },
            {
              name: 'swarm',
              args: {
                action: 'add',
                role: 'Auditor',
                name: 'auditor',
                model: 'gemini-4-neon-high',
                conversationId: 'child-2',
              },
            },
          ],
          content: 'Dispatching Scout and Auditor.',
        },
        {
          step_index: 2,
          type: 'GENERIC',
          source: 'TOOL',
          created_at: '2026-11-27T04:00:06Z',
          content: JSON.stringify({ conversationId: 'child-1', status: 'started' }),
        },
        {
          step_index: 3,
          type: 'GENERIC',
          source: 'TOOL',
          created_at: '2026-11-27T04:00:07Z',
          content: 'Swarm agent added for child-2',
        },
        {
          step_index: 4,
          type: 'ERROR',
          source: 'SYSTEM',
          created_at: '2026-11-27T04:00:30Z',
          model: 'gemini-4-neon-high',
          content: 'HTTP 429 RESOURCE_EXHAUSTED: rate limit exceeded, retrying with fallback model',
        },
        {
          step_index: 5,
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          status: 'DONE',
          created_at: '2026-11-27T04:00:45Z',
          model: 'gemini-4-flash',
          input_tokens: 8000,
          cache_read_tokens: 2000,
          output_tokens: 800,
          content: 'Final summary completed after fallback.',
        },
      ]);

      const filesBefore = listAllFilesRecursive(brainRoot);

      const detail = loadSessionDetail('parent-1', {
        brainDirs: [{ dir: brainRoot, source: 'custom' }],
      });
      assert.ok(detail);

      // Strictly read-only access to brain/
      const filesAfter = listAllFilesRecursive(brainRoot);
      assert.deepEqual(filesAfter, filesBefore);

      // Swarm lineage assertions
      assert.equal(detail.swarmLineage.totalSubagents, 2);
      assert.equal(detail.swarmLineage.linkedTranscripts, 2);
      assert.equal(detail.swarmLineage.orphanSuspects, 1);
      // child-1: (4000+6000) + (2000+8000) = 20000 input, 700+500 = 1200 output
      // child-2: (5000+10000) = 15000 input, 900 output
      assert.equal(detail.swarmLineage.totalSubagentInputTokens, 35000);
      assert.equal(detail.swarmLineage.totalSubagentOutputTokens, 2100);

      const scout = detail.swarmLineage.children.find((c) => c.conversationId === 'child-1');
      const auditor = detail.swarmLineage.children.find((c) => c.conversationId === 'child-2');
      assert.ok(scout);
      assert.ok(auditor);
      assert.equal(scout.role, 'Scout');
      assert.equal(scout.typeName, 'scout');
      assert.equal(scout.model, 'gemini-4-flash');
      assert.equal(scout.transcriptFound, true);
      assert.equal(scout.turns, 2);
      assert.equal(scout.totalInputTokens, 20000);
      assert.equal(scout.totalCacheReadTokens, 14000);
      assert.equal(scout.totalOutputTokens, 1200);
      assert.equal(scout.statusHint, 'completed');

      assert.equal(auditor.role, 'Auditor');
      assert.equal(auditor.typeName, 'auditor');
      assert.equal(auditor.model, 'gemini-4-neon-high');
      assert.equal(auditor.transcriptFound, true);
      assert.equal(auditor.turns, 1);
      assert.equal(auditor.totalInputTokens, 15000);
      assert.equal(auditor.totalOutputTokens, 900);
      assert.equal(auditor.statusHint, 'orphan_suspect');

      // Model breakdown assertions
      assert.equal(detail.modelBreakdown.length, 2);
      const neon = detail.modelBreakdown.find((m) => m.model === 'gemini-4-neon-high');
      const flash = detail.modelBreakdown.find((m) => m.model === 'gemini-4-flash');
      assert.ok(neon);
      assert.ok(flash);
      assert.equal(neon.turns, 1);
      assert.equal(neon.inputTokens, 20000);
      assert.equal(neon.cacheReadTokens, 5000);
      assert.equal(neon.freshInputTokens, 15000);
      assert.equal(neon.outputTokens, 1200);
      assert.equal(neon.retrySignals, 1);

      assert.equal(flash.turns, 1);
      assert.equal(flash.inputTokens, 10000);
      assert.equal(flash.cacheReadTokens, 2000);
      assert.equal(flash.freshInputTokens, 8000);
      assert.equal(flash.outputTokens, 800);
      assert.equal(flash.retrySignals, 0);
      assert.ok(Math.abs(neon.sharePercent + flash.sharePercent - 100) <= 0.2);

      // Diagnostics include retry, model fallback/switch, and orphan suspect warnings
      assert.ok(
        detail.diagnostics.some(
          (d) => d.severity === 'warn' && /Rate-Limit|Retry/i.test(d.title),
        ),
        'Expected retry warning in diagnostics',
      );
      assert.ok(
        detail.diagnostics.some(
          (d) => d.severity === 'warn' && /Fallback|Switch/i.test(d.title),
        ),
        'Expected model fallback warning in diagnostics',
      );
      assert.ok(
        detail.diagnostics.some(
          (d) => d.severity === 'warn' && /Orphan/i.test(d.title),
        ),
        'Expected swarm orphan suspect warning in diagnostics',
      );

      // Brief includes Swarm Lineage & Model Breakdown sections
      const brief = renderRedactedBrief(detail);
      assert.match(brief, /## Swarm Lineage/);
      assert.match(brief, /Scout/);
      assert.match(brief, /orphan_suspect/);
      assert.match(brief, /## Model Breakdown/);
      assert.match(brief, /gemini-4-neon-high/);
      assert.match(brief, /gemini-4-flash/);
    });
  });

  it('caps linked subagent parsing at 24 and blocks symlink escapes outside sibling brain root', async () => {
    await withTempDir('agy-nov-xray-cap-', (tmpDir) => {
      const brainRoot = path.join(tmpDir, 'brain');
      const outsideDir = path.join(tmpDir, 'outside');
      fs.mkdirSync(brainRoot, { recursive: true });
      fs.mkdirSync(outsideDir, { recursive: true });

      const outsideTranscript = path.join(outsideDir, 'secret-transcript.jsonl');
      fs.writeFileSync(
        outsideTranscript,
        `${JSON.stringify({
          step_index: 0,
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          model: 'secret-model',
          input_tokens: 999999,
          output_tokens: 100,
        })}\n`,
        'utf8',
      );

      // Create an escaping symlink masquerading as a child transcript
      const escapeChildLogs = path.join(brainRoot, 'child-escape', '.system_generated', 'logs');
      fs.mkdirSync(escapeChildLogs, { recursive: true });
      fs.symlinkSync(outsideTranscript, path.join(escapeChildLogs, 'transcript.jsonl'));

      const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [
        { name: 'invoke_subagent', args: { Role: 'Escape', conversationId: 'child-escape' } },
      ];

      for (let i = 1; i <= 28; i += 1) {
        const cid = `child-batch-${i}`;
        writeTranscript(brainRoot, cid, [
          {
            step_index: 0,
            type: 'PLANNER_RESPONSE',
            status: 'DONE',
            model: 'gemini-4-flash',
            input_tokens: 100,
            cache_read_tokens: 0,
            output_tokens: 10,
          },
        ]);
        toolCalls.push({
          name: 'invoke_subagent',
          args: { Role: `Worker-${i}`, conversationId: cid },
        });
      }

      writeTranscript(brainRoot, 'parent-many', [
        {
          step_index: 0,
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          model: 'gemini-4-neon-high',
          input_tokens: 1000,
          output_tokens: 200,
          tool_calls: toolCalls,
        },
        {
          step_index: 1,
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          model: 'gemini-4-neon-high',
          input_tokens: 1200,
          output_tokens: 150,
          content: 'All done.',
        },
      ]);

      const detail = loadSessionDetail('parent-many', {
        brainDirs: [{ dir: brainRoot, source: 'custom' }],
      });
      assert.ok(detail);
      assert.equal(detail.swarmLineage.totalSubagents, 29);
      assert.equal(detail.swarmLineage.linkedTranscripts, 24);

      const escaped = detail.swarmLineage.children.find((c) => c.conversationId === 'child-escape');
      assert.ok(escaped);
      assert.equal(escaped.transcriptFound, false);
      assert.equal(escaped.totalInputTokens, 0);
      assert.equal(escaped.statusHint, 'unknown');
    });
  });

  it('keeps xray tool count unchanged (4 model tools) and includes Swarm & Models summary in xray_analyze_context', async () => {
    await withTempDir('agy-nov-xray-mcp-', async (tmpDir) => {
      const server = new McpServer(
        { name: 'test-xray-swarm', version: '0.3.0' },
        { capabilities: { tools: {} } },
      );
      const reg = registerXrayModule(
        server,
        { dataDir: path.join(tmpDir, 'data'), workspaceRoot: tmpDir, demoMode: true },
        'ui://agy-nov/app.html',
      );
      assert.deepEqual(
        reg.modelTools.map((t) => t.name),
        MODULE_CATALOG.xray.modelToolNames,
      );
      assert.equal(reg.modelTools.length, 4);

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test-client', version: '0.3.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      try {
        const res = await client.callTool({ name: 'xray_analyze_context', arguments: {} });
        const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
        assert.match(text, /Swarm & Models:/);
        assert.match(text, /2 subagents/);
        assert.match(text, /gemini-4-neon-high/);
        assert.match(text, /gemini-4-flash/);

        const sc = res.structuredContent as {
          detail: {
            swarmLineage: { totalSubagents: number };
            modelBreakdown: unknown[];
          };
        };
        assert.equal(sc.detail.swarmLineage.totalSubagents, 2);
        assert.equal(sc.detail.modelBreakdown.length, 2);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});

describe('v0.3.0 Radar Parent-Child Lineage, Orphan Alerts & status-capsule.json', () => {
  it('detects orphan subagents after parent Stop and atomically writes status-capsule.json', async () => {
    await withTempDir('agy-nov-radar-swarm-', (tmpDir) => {
      const prevNoNotify = process.env.AGY_NOV_NO_NOTIFY;
      process.env.AGY_NOV_NO_NOTIFY = '1';
      try {
        const rootDataDir = path.join(tmpDir, 'nov-data');
        const radarDir = getModuleDataDir(rootDataDir, 'radar');

        // 1. Parent session starts running
        handleRadarHook(
          normalizeHookPayload(
            {
              conversationId: 'parent-conv',
              workspaceRoot: '/tmp/ws-swarm',
              toolName: 'invoke_subagent',
            },
            'PreToolUse',
          ),
          rootDataDir,
        );

        // 2. Child 1 (Builder) running under parent-conv
        handleRadarHook(
          normalizeHookPayload(
            {
              conversationId: 'child-running',
              parentConversationId: 'parent-conv',
              agentRole: 'Builder',
              workspaceRoot: '/tmp/ws-swarm',
              toolName: 'edit_file',
            },
            'PreToolUse',
          ),
          rootDataDir,
        );

        // 3. Child 2 (Scout) runs and completes cleanly
        handleRadarHook(
          normalizeHookPayload(
            {
              conversationId: 'child-done',
              parentConversationId: 'parent-conv',
              agentRole: 'Scout',
              workspaceRoot: '/tmp/ws-swarm',
              toolName: 'read_file',
            },
            'PreToolUse',
          ),
          rootDataDir,
        );
        handleRadarHook(
          normalizeHookPayload(
            {
              conversationId: 'child-done',
              parentConversationId: 'parent-conv',
              agentRole: 'Scout',
              workspaceRoot: '/tmp/ws-swarm',
            },
            'Stop',
          ),
          rootDataDir,
        );

        // While parent is still running, orphanSubagents must be 0
        let view = computeRadarBoardView(loadRadarBoardReadOnly(radarDir), { nowMs: Date.now() });
        assert.equal(view.counts.subagents, 2);
        assert.equal(view.counts.orphanSubagents, 0);
        assert.equal(
          view.sessions.find((s) => s.conversationId === 'child-running')?.isOrphanSubagent,
          false,
        );

        // 4. Parent completes (Stop) while child-running is still running -> orphan detected
        handleRadarHook(
          normalizeHookPayload(
            {
              conversationId: 'parent-conv',
              workspaceRoot: '/tmp/ws-swarm',
              terminationReason: 'Parent finished task',
            },
            'Stop',
          ),
          rootDataDir,
        );

        const board = loadRadarBoardReadOnly(radarDir);
        assert.equal(board.sessions['child-running']?.parentConversationId, 'parent-conv');
        assert.equal(board.sessions['child-running']?.agentRole, 'Builder');
        assert.equal(board.sessions['child-running']?.isSubagent, true);

        view = computeRadarBoardView(board, { nowMs: Date.now() });
        assert.equal(view.counts.subagents, 2);
        assert.equal(view.counts.orphanSubagents, 1);

        const runningChild = view.sessions.find((s) => s.conversationId === 'child-running');
        const doneChild = view.sessions.find((s) => s.conversationId === 'child-done');
        assert.equal(runningChild?.isOrphanSubagent, true);
        assert.equal(doneChild?.isOrphanSubagent, false);

        // Verify status-capsule.json was atomically written alongside board.json
        const capsulePath = getRadarStatusCapsulePath(radarDir);
        assert.equal(fs.existsSync(getRadarBoardPath(radarDir)), true);
        assert.equal(fs.existsSync(capsulePath), true);
        if (process.platform !== 'win32') {
          const mode = fs.statSync(capsulePath).mode & 0o777;
          assert.equal(mode, 0o600);
        }

        const capsule = JSON.parse(fs.readFileSync(capsulePath, 'utf8')) as RadarStatusCapsule;
        assert.equal(capsule.schemaVersion, 1);
        assert.equal(typeof capsule.updatedAt, 'string');
        assert.equal(capsule.counts.total, 3);
        assert.equal(capsule.counts.subagents, 2);
        assert.equal(capsule.counts.orphanSubagents, 1);
        assert.ok(capsule.latestAttention);
        assert.equal(capsule.latestAttention.conversationId, 'child-running');
        assert.equal(capsule.latestAttention.status, 'running');
        assert.equal(capsule.latestAttention.workspaceName, 'ws-swarm');
        assert.equal(capsule.latestAttention.lastToolName, 'edit_file');

        // Pure builder matches persisted capsule structure
        const rebuilt = buildRadarStatusCapsule(view);
        assert.equal(rebuilt.schemaVersion, 1);
        assert.equal(rebuilt.counts.orphanSubagents, 1);
        assert.equal(rebuilt.latestAttention?.conversationId, 'child-running');

        // Stalled subagent under an errored parent is also flagged as orphanSubagent
        handleRadarHook(
          normalizeHookPayload(
            {
              conversationId: 'parent-err',
              workspaceRoot: '/tmp/ws-swarm',
              error: { message: 'Parent crashed unexpectedly' },
            },
            'Stop',
          ),
          rootDataDir,
        );
        handleRadarHook(
          normalizeHookPayload(
            {
              conversationId: 'child-stalled',
              parentConversationId: 'parent-err',
              agentRole: 'Auditor',
              workspaceRoot: '/tmp/ws-swarm',
              toolName: 'run_command',
            },
            'PreToolUse',
          ),
          rootDataDir,
        );
        const futureNowMs = Date.now() + 10 * 60_000;
        const stalledView = computeRadarBoardView(loadRadarBoardReadOnly(radarDir), {
          nowMs: futureNowMs,
        });
        const stalledChild = stalledView.sessions.find((s) => s.conversationId === 'child-stalled');
        assert.equal(stalledChild?.status, 'stalled');
        assert.equal(stalledChild?.isOrphanSubagent, true);
        assert.equal(stalledView.counts.orphanSubagents, 2);
      } finally {
        if (prevNoNotify === undefined) delete process.env.AGY_NOV_NO_NOTIFY;
        else process.env.AGY_NOV_NO_NOTIFY = prevNoNotify;
      }
    });
  });

  it('keeps zero disk writes on loadRadarBoardReadOnly in an absent directory and in demoMode', async () => {
    await withTempDir('agy-nov-radar-zerowrite-', async (tmpDir) => {
      const missingRoot = path.join(tmpDir, 'never-created');
      const radarDir = getModuleDataDir(missingRoot, 'radar');

      const empty = loadRadarBoardReadOnly(radarDir);
      assert.equal(Object.keys(empty.sessions).length, 0);
      assert.equal(fs.existsSync(missingRoot), false);
      assert.equal(fs.existsSync(getRadarBoardPath(radarDir)), false);
      assert.equal(fs.existsSync(getRadarStatusCapsulePath(radarDir)), false);

      // Demo radar board includes at least 1 subagent while preserving v0.2 status counts
      const demoView = computeRadarBoardView(createDemoRadarBoard(), { mode: 'demo' });
      assert.ok(demoView.counts.subagents >= 1);
      assert.equal(demoView.counts.running, 1);
      assert.equal(demoView.counts.awaiting_approval, 1);
      assert.equal(demoView.counts.completed, 1);
      assert.equal(demoView.counts.stalled, 1);

      // MCP registration in demoMode preserves 2 model tools and writes zero files
      const server = new McpServer(
        { name: 'test-radar-demo', version: '0.3.0' },
        { capabilities: { tools: {} } },
      );
      const reg = registerRadarModule(
        server,
        { dataDir: missingRoot, workspaceRoot: tmpDir, demoMode: true },
        'ui://agy-nov/app.html',
      );
      assert.deepEqual(
        reg.modelTools.map((t) => t.name),
        MODULE_CATALOG.radar.modelToolNames,
      );
      assert.equal(reg.modelTools.length, 2);

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test-radar-client', version: '0.3.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      try {
        const res = await client.callTool({ name: 'radar_get_board', arguments: {} });
        const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
        assert.match(text, /subagents=1/);
        assert.equal(fs.existsSync(missingRoot), false);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});
