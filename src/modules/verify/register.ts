import path from 'node:path';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import type {
  ModuleRegistrationResult,
  ModuleToolHandle,
  NovRuntimeOptions,
} from '../../core/types.js';
import { isSamePath } from '../../core/utils.js';
import {
  ALLOWED_VERIFY_EXECUTABLES,
  appendEvidenceToState,
  buildPrDeliverySummary,
  buildVerifyStateView,
  clearVerifyHistory,
  clearVerifyHistoryInState,
  createDemoSpecSummaryForPr,
  createDemoVerifyDetection,
  createDemoVerifyState,
  createEvidenceId,
  detectWorkspaceVerifyCommands,
  listVerifyWorktreesReadOnly,
  loadSpecSummaryForPrReadOnly,
  loadVerifyStateReadOnly,
  resolveAllowedVerifyTargetRoot,
  runVerifyChecksLive,
  updateVerifyPolicy,
  validateAndBuildPolicy,
  type DetectedWorkspaceVerifyResult,
  type VerifyCommandRunResult,
  type VerifyEvidenceRecord,
  type VerifyPolicyPatch,
  type VerifyStateFile,
  type VerifyStateView,
  type VerifyTrigger,
  type VerifyWorktreeOption,
} from './core.js';

function toHandle(name: string, tool: RegisteredTool): ModuleToolHandle {
  return {
    name,
    enable: () => tool.enable(),
    disable: () => tool.disable(),
  };
}

const VERIFY_COMMAND_INPUT_SCHEMA = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  executable: z.string().min(1).max(64),
  args: z.array(z.string()),
  timeoutMs: z.number().int().min(1_000).max(60_000).optional(),
  enabled: z.boolean().optional(),
});

const POLICY_PATCH_INPUT_SCHEMA = {
  enforceOnStop: z.boolean().optional().describe('Enforce Verify Gate checks on Stop hooks'),
  autoRunOnStop: z
    .boolean()
    .optional()
    .describe('Automatically execute enabled verification commands during Stop hooks'),
  blockEmptyWrites: z
    .boolean()
    .optional()
    .describe('Block Stop when modified workspace files are 0 bytes'),
  maxConsecutiveBlocks: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('Anti-loop guardrail: max consecutive Stop blocks before safely allowing stop (1..10)'),
  commands: z
    .array(VERIFY_COMMAND_INPUT_SCHEMA)
    .optional()
    .describe(
      `Ordered list of allowlisted verification commands (allowed executables: ${[...ALLOWED_VERIFY_EXECUTABLES].join(', ')})`,
    ),
};

function buildDemoVerifyWorktrees(workspaceRoot: string): VerifyWorktreeOption[] {
  const mainRoot = path.resolve(workspaceRoot);
  return [
    { path: mainRoot, branch: 'main', isMain: true },
    {
      path: path.join(mainRoot, '.agy-worktrees', 'feat-verify-gate'),
      branch: 'feat/verify-gate',
      isMain: false,
    },
  ];
}

function resolveDemoWorktreeTarget(
  demoWorktrees: readonly VerifyWorktreeOption[],
  worktreePath?: string,
): { ok: true; branch?: string; worktreePath?: string } | { ok: false; error: string } {
  if (!worktreePath || !worktreePath.trim()) {
    return { ok: true, branch: demoWorktrees[0]?.branch ?? 'main' };
  }
  const normalized = path.resolve(worktreePath.trim());
  const matched = demoWorktrees.find((w) => isSamePath(path.resolve(w.path), normalized));
  if (!matched) {
    return {
      ok: false,
      error: `Refused: "${worktreePath}" is not the workspace root or a registered demo Git worktree.`,
    };
  }
  return {
    ok: true,
    branch: matched.branch ?? 'main',
    worktreePath: matched.path,
  };
}

function runDemoChecksInMemory(
  demoState: VerifyStateFile,
  demoWorktrees: readonly VerifyWorktreeOption[],
  opts: { commandId?: string; conversationId?: string; trigger: VerifyTrigger; worktreePath?: string },
): { ok: true; run: VerifyEvidenceRecord } | { ok: false; error: string } {
  const resolvedWt = resolveDemoWorktreeTarget(demoWorktrees, opts.worktreePath);
  if (!resolvedWt.ok) return resolvedWt;

  const targetCommands = opts.commandId
    ? demoState.policy.commands.filter((c) => c.id === opts.commandId)
    : demoState.policy.commands.filter((c) => c.enabled);

  if (opts.commandId && targetCommands.length === 0) {
    return { ok: false, error: `Verify command not found: "${opts.commandId}".` };
  }

  const nowIso = new Date().toISOString();
  const results: VerifyCommandRunResult[] = targetCommands.map((cmd, idx) => ({
    commandId: cmd.id,
    label: cmd.label,
    executable: cmd.executable,
    args: [...cmd.args],
    passed: true,
    exitCode: 0,
    timedOut: false,
    durationMs: 240 + idx * 110,
    outputTail: `[demo] ${cmd.executable} ${cmd.args.join(' ')} exited with code 0`,
    outputTruncated: false,
  }));

  const durationMs = results.reduce((sum, item) => sum + item.durationMs, 0);
  const run: VerifyEvidenceRecord = {
    id: createEvidenceId('ver-demo'),
    conversationId: opts.conversationId?.trim() || 'conv-verify-demo-1',
    trigger: opts.trigger,
    outcome: 'pass',
    passed: true,
    timestamp: nowIso,
    durationMs,
    dirtyFiles: [],
    emptyFiles: [],
    results,
    summary:
      results.length > 0
        ? `[demo] All ${results.length} verification command(s) passed in ${durationMs}ms.`
        : '[demo] No enabled verification commands configured; check passed.',
    ...(resolvedWt.branch ? { targetBranch: resolvedWt.branch } : {}),
    ...(resolvedWt.worktreePath ? { targetWorktree: resolvedWt.worktreePath } : {}),
  };

  appendEvidenceToState(demoState, run);
  return { ok: true, run };
}

export function registerVerifyModule(
  server: McpServer,
  options: NovRuntimeOptions,
  uiResourceUri: string,
): ModuleRegistrationResult {
  const rootDataDir = resolveNovDataDir(options.dataDir);
  const moduleDataDir = getModuleDataDir(rootDataDir, 'verify');
  const getWorkspaceRoot = () => options.workspaceRoot;
  const isDemo = options.demoMode === true;

  // In demo mode keep synthetic policy & verification evidence strictly in memory (zero disk writes)
  const demoState: VerifyStateFile | null = isDemo ? createDemoVerifyState() : null;
  const getDemoWorktrees = (): VerifyWorktreeOption[] =>
    isDemo ? buildDemoVerifyWorktrees(getWorkspaceRoot()) : [];

  const APP_ONLY_META = {
    ui: {
      resourceUri: uiResourceUri,
      visibility: ['app'] as ['app'],
    },
  };

  const getCurrentStateFile = (): VerifyStateFile =>
    isDemo && demoState ? demoState : loadVerifyStateReadOnly(moduleDataDir);

  const getStateView = (): VerifyStateView =>
    buildVerifyStateView(getCurrentStateFile(), isDemo ? 'demo' : 'live');

  const getAvailableWorktrees = (): VerifyWorktreeOption[] =>
    isDemo ? getDemoWorktrees() : listVerifyWorktreesReadOnly(getWorkspaceRoot());

  const getDetectedStack = (): DetectedWorkspaceVerifyResult =>
    isDemo ? createDemoVerifyDetection() : detectWorkspaceVerifyCommands(getWorkspaceRoot());

  const applyPolicyPatch = (
    patch: VerifyPolicyPatch,
  ): { valid: true; policy: VerifyStateView['policy']; state: VerifyStateView } | { valid: false; error: string } => {
    if (isDemo && demoState) {
      const checked = validateAndBuildPolicy(demoState.policy, patch);
      if (!checked.valid) return checked;
      demoState.policy = checked.policy;
      demoState.updatedAt = new Date().toISOString();
      const view = getStateView();
      return { valid: true, policy: view.policy, state: view };
    }
    const updated = updateVerifyPolicy(moduleDataDir, patch);
    if (!updated.valid) return updated;
    const view = buildVerifyStateView(updated.state, 'live');
    return { valid: true, policy: view.policy, state: view };
  };

  const executeChecks = async (opts: {
    commandId?: string;
    conversationId?: string;
    worktreePath?: string;
    trigger: VerifyTrigger;
  }): Promise<
    { ok: true; run: VerifyEvidenceRecord; state: VerifyStateView } | { ok: false; error: string }
  > => {
    if (isDemo && demoState) {
      const demoRes = runDemoChecksInMemory(demoState, getDemoWorktrees(), opts);
      if (!demoRes.ok) return demoRes;
      return { ok: true, run: demoRes.run, state: getStateView() };
    }
    const liveRes = await runVerifyChecksLive(moduleDataDir, getWorkspaceRoot(), opts);
    if (!liveRes.ok) return liveRes;
    return {
      ok: true,
      run: liveRes.run,
      state: buildVerifyStateView(liveRes.state, 'live'),
    };
  };

  const modelTools: ModuleToolHandle[] = [];

  // 1. Model-visible: verify_get_policy
  const getPolicyTool = server.registerTool(
    'verify_get_policy',
    {
      title: 'Get Verify Gate Policy',
      description:
        'Read the current Verify Gate stop-hook policy, allowlisted verification commands, loop guardrail limit, and summary stats.',
      inputSchema: {},
    },
    async () => {
      const view = getStateView();
      const detected = getDetectedStack();
      const enabledCount = view.policy.commands.filter((c) => c.enabled).length;
      const lines = [
        `Verify Gate Policy (${view.mode}): enforceOnStop=${view.policy.enforceOnStop}, autoRunOnStop=${view.policy.autoRunOnStop}, blockEmptyWrites=${view.policy.blockEmptyWrites}, maxConsecutiveBlocks=${view.policy.maxConsecutiveBlocks}`,
        `Commands (${enabledCount}/${view.policy.commands.length} enabled):`,
        ...view.policy.commands.map(
          (c) =>
            `- [${c.enabled ? 'ON' : 'OFF'}] ${c.id} (${c.label}): ${c.executable} ${c.args.join(' ')} (timeout=${c.timeoutMs}ms)`,
        ),
        `Stats: totalRuns=${view.stats.totalRuns}, passed=${view.stats.passedRuns}, failed=${view.stats.failedRuns}, blockedStops=${view.stats.blockedStops}`,
      ];
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
          mode: view.mode,
          policy: view.policy,
          stats: view.stats,
          allowedExecutables: [...ALLOWED_VERIFY_EXECUTABLES],
          detectedStacks: detected.detectedStacks,
          detectedStackRecommendations: detected.recommendations,
        },
      };
    },
  );
  modelTools.push(toHandle('verify_get_policy', getPolicyTool));

  // 2. Model-visible: verify_set_policy
  const setPolicyTool = server.registerTool(
    'verify_set_policy',
    {
      title: 'Update Verify Gate Policy',
      description:
        'Update Verify Gate stop-hook enforcement settings and allowlisted verification commands (shell: false only; rejects non-allowlisted executables and inline eval flags).',
      inputSchema: POLICY_PATCH_INPUT_SCHEMA,
    },
    async (patch) => {
      const res = applyPolicyPatch(patch);
      if (!res.valid) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Invalid verify policy: ${res.error}` }],
        };
      }
      const enabledCount = res.policy.commands.filter((c) => c.enabled).length;
      return {
        content: [
          {
            type: 'text',
            text: `Updated Verify Gate policy: enforceOnStop=${res.policy.enforceOnStop}, autoRunOnStop=${res.policy.autoRunOnStop}, blockEmptyWrites=${res.policy.blockEmptyWrites}, maxConsecutiveBlocks=${res.policy.maxConsecutiveBlocks}, enabledCommands=${enabledCount}/${res.policy.commands.length}.`,
          },
        ],
        structuredContent: {
          policy: res.policy,
          state: res.state,
        },
      };
    },
  );
  modelTools.push(toHandle('verify_set_policy', setPolicyTool));

  // 3. Model-visible: verify_run_checks
  const runChecksTool = server.registerTool(
    'verify_run_checks',
    {
      title: 'Run Verify Gate Checks',
      description:
        'Execute configured allowlisted verification commands via execFile (shell: false), optionally targeting a registered Git worktree, redact secrets from outputs, record evidence, and update session verification state.',
      inputSchema: {
        commandId: z
          .string()
          .min(1)
          .optional()
          .describe('Optional single command ID to execute; runs all enabled commands when omitted'),
        conversationId: z
          .string()
          .min(1)
          .optional()
          .describe('Optional conversation ID whose dirty-file verification state should be updated'),
        worktreePath: z
          .string()
          .min(1)
          .optional()
          .describe('Optional registered Git worktree path belonging to this repository to run checks inside'),
      },
    },
    async ({ commandId, conversationId, worktreePath }) => {
      const res = await executeChecks({
        commandId,
        conversationId,
        worktreePath,
        trigger: 'manual',
      });
      if (!res.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: res.error }],
        };
      }
      const { run } = res;
      const targetTag = run.targetBranch ? ` [${run.targetBranch}]` : '';
      const lines = [
        `Verify Run ${run.id} [${run.outcome.toUpperCase()}]${targetTag}: ${run.summary}`,
        ...run.results.map(
          (r) =>
            `- [${r.passed ? 'PASS' : 'FAIL'}] ${r.commandId} (${r.executable} ${r.args.join(' ')}) exit=${r.exitCode ?? (r.timedOut ? 'TIMEOUT' : 'ERR')} (${r.durationMs}ms)${r.outputTail ? `\n  ${r.outputTail.slice(0, 240)}` : ''}`,
        ),
      ];
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
          run,
          state: res.state,
        },
      };
    },
  );
  modelTools.push(toHandle('verify_run_checks', runChecksTool));

  // 4. Model-visible: verify_get_evidence
  const getEvidenceTool = server.registerTool(
    'verify_get_evidence',
    {
      title: 'Get Verification Evidence Chain',
      description:
        'Read the redacted verification evidence history (PASS / FAIL / BLOCKED / GUARDRAIL-ALLOW) and active session verification status.',
      inputSchema: {
        conversationId: z
          .string()
          .min(1)
          .optional()
          .describe('Optional conversation ID filter'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Maximum number of recent evidence entries to return (default 10)'),
      },
    },
    async ({ conversationId, limit }) => {
      const view = getStateView();
      const maxItems = limit ?? 10;
      const filtered = conversationId
        ? view.evidence.filter((e) => e.conversationId === conversationId)
        : view.evidence;
      const items = filtered.slice(0, maxItems);
      const lines = [
        `Verify Evidence (${view.mode}): showing ${items.length}/${filtered.length} record(s); blockedStops=${view.stats.blockedStops}`,
        ...items.map(
          (e) =>
            `- [${e.outcome.toUpperCase()}] ${e.id} (${e.timestamp}, conv=${e.conversationId}, trigger=${e.trigger}, ${e.durationMs}ms): ${e.summary}`,
        ),
      ];
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
          mode: view.mode,
          total: filtered.length,
          evidence: items,
          stats: view.stats,
        },
      };
    },
  );
  modelTools.push(toHandle('verify_get_evidence', getEvidenceTool));

  // App-only tools
  server.registerTool(
    'app_verify_get_state',
    {
      title: 'Get Verify Gate State (App Only)',
      description: 'Fetch Verify Gate policy, tracked sessions, redacted evidence, available worktrees, and summary stats for the UI.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => {
      const view = getStateView();
      const availableWorktrees = getAvailableWorktrees();
      return {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: {
          mode: view.mode,
          policy: view.policy,
          sessions: view.sessions,
          evidence: view.evidence,
          stats: view.stats,
          updatedAt: view.updatedAt,
          availableWorktrees,
        },
      };
    },
  );

  server.registerTool(
    'app_verify_save_policy',
    {
      title: 'Save Verify Gate Policy (App Only)',
      description: 'Validate and save Verify Gate policy and commands from the UI.',
      inputSchema: POLICY_PATCH_INPUT_SCHEMA,
      _meta: APP_ONLY_META,
    },
    async (patch) => {
      const res = applyPolicyPatch(patch);
      if (!res.valid) {
        return {
          isError: true,
          content: [{ type: 'text', text: res.error }],
        };
      }
      return {
        content: [{ type: 'text', text: 'saved' }],
        structuredContent: {
          policy: res.policy,
          state: res.state,
        },
      };
    },
  );

  server.registerTool(
    'app_verify_run_checks',
    {
      title: 'Run Verify Gate Checks (App Only)',
      description: 'Trigger verification checks from the Verify Gate UI, optionally targeting a registered Git worktree.',
      inputSchema: {
        commandId: z.string().min(1).optional(),
        conversationId: z.string().min(1).optional(),
        worktreePath: z.string().min(1).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ commandId, conversationId, worktreePath }) => {
      const res = await executeChecks({
        commandId,
        conversationId,
        worktreePath,
        trigger: 'app-ui',
      });
      if (!res.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: res.error }],
        };
      }
      return {
        content: [{ type: 'text', text: res.run.passed ? 'passed' : 'failed' }],
        structuredContent: {
          run: res.run,
          state: res.state,
        },
      };
    },
  );

  server.registerTool(
    'app_verify_clear_history',
    {
      title: 'Clear Verify Gate History (App Only)',
      description: 'Clear stored verification evidence and tracked session history from the Verify Gate UI.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => {
      let cleared = 0;
      let state: VerifyStateView;
      if (isDemo && demoState) {
        cleared = clearVerifyHistoryInState(demoState);
        state = getStateView();
      } else {
        const res = clearVerifyHistory(moduleDataDir);
        cleared = res.cleared;
        state = buildVerifyStateView(res.state, 'live');
      }
      return {
        content: [{ type: 'text', text: 'cleared' }],
        structuredContent: {
          cleared,
          state,
        },
      };
    },
  );

  server.registerTool(
    'app_verify_detect_commands',
    {
      title: 'Detect Workspace Verification Commands (App Only)',
      description:
        'Read-only inspection of top-level workspace manifests (package.json, pyproject.toml, Cargo.toml, go.mod) to recommend allowlisted verification commands.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => {
      const detected = getDetectedStack();
      return {
        content: [
          {
            type: 'text',
            text: `Detected ${detected.recommendations.length} recommendation(s) across [${detected.detectedStacks.join(', ')}]`,
          },
        ],
        structuredContent: {
          mode: isDemo ? 'demo' : 'live',
          detectedStacks: detected.detectedStacks,
          recommendations: detected.recommendations,
        },
      };
    },
  );

  server.registerTool(
    'app_verify_pr_summary',
    {
      title: 'Generate PR Delivery Verification Evidence (App Only)',
      description:
        'Read-only generator for a sanitized Markdown PR delivery evidence summary combining latest Verify Gate checks, target branch/worktree, and active Spec progress.',
      inputSchema: {
        worktreePath: z.string().min(1).optional(),
        evidenceId: z.string().min(1).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ worktreePath, evidenceId }) => {
      let resolvedBranch: string | undefined;
      let resolvedWorktree: string | undefined;

      const currentWorkspaceRoot = getWorkspaceRoot();
      if (worktreePath) {
        if (isDemo) {
          const demoTarget = resolveDemoWorktreeTarget(getDemoWorktrees(), worktreePath);
          if (!demoTarget.ok) {
            return {
              isError: true,
              content: [{ type: 'text', text: demoTarget.error }],
            };
          }
          resolvedBranch = demoTarget.branch;
          resolvedWorktree = demoTarget.worktreePath;
        } else {
          try {
            const liveTarget = resolveAllowedVerifyTargetRoot(currentWorkspaceRoot, worktreePath);
            resolvedBranch = liveTarget.branch;
            resolvedWorktree = liveTarget.targetRoot;
          } catch (err) {
            return {
              isError: true,
              content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
            };
          }
        }
      }

      const currentState = getCurrentStateFile();
      const specSummary = isDemo
        ? createDemoSpecSummaryForPr()
        : loadSpecSummaryForPrReadOnly(rootDataDir);
      const summary = buildPrDeliverySummary(currentState, {
        workspaceRoot: currentWorkspaceRoot,
        worktreePath: resolvedWorktree,
        branch: resolvedBranch,
        specSummary,
        mode: isDemo ? 'demo' : 'live',
        evidenceId,
      });

      return {
        content: [{ type: 'text', text: summary.markdown }],
        structuredContent: { ...summary },
      };
    },
  );

  return {
    moduleId: 'verify',
    modelTools,
    exemptReadOnlyAppTools: [
      'app_verify_get_state',
      'app_verify_detect_commands',
      'app_verify_pr_summary',
    ],
  };
}
