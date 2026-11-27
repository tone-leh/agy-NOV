import { validateVerifyCommand } from './allowlist.js';
import type {
  DetectedVerifyCommand,
  DetectedWorkspaceVerifyResult,
  PrDeliverySpecSummary,
  VerifyStateFile,
} from './types.js';

/**
 * Rich synthetic demo state (PASS / BLOCKED / PASS) kept strictly in memory with zero disk writes.
 */
export function createDemoVerifyState(nowMs = Date.now()): VerifyStateFile {
  const isoAgo = (minutesAgo: number) => new Date(nowMs - minutesAgo * 60_000).toISOString();

  return {
    schemaVersion: 1,
    policy: {
      enforceOnStop: true,
      autoRunOnStop: true,
      blockEmptyWrites: true,
      maxConsecutiveBlocks: 3,
      commands: [
        {
          id: 'typecheck',
          label: 'TypeScript Typecheck',
          executable: 'npm',
          args: ['run', 'typecheck'],
          timeoutMs: 15_000,
          enabled: true,
        },
        {
          id: 'unit-tests',
          label: 'Offline Unit Tests',
          executable: 'npm',
          args: ['test'],
          timeoutMs: 30_000,
          enabled: true,
        },
        {
          id: 'git-status',
          label: 'Git Working Tree Check',
          executable: 'git',
          args: ['status', '--short'],
          timeoutMs: 5_000,
          enabled: true,
        },
      ],
    },
    sessions: {
      'conv-verify-demo-1': {
        conversationId: 'conv-verify-demo-1',
        workspaceRoot: '/demo/agy-NOV',
        dirtyFiles: [],
        emptyFiles: [],
        lastEditAt: isoAgo(5),
        lastVerifiedAt: isoAgo(2),
        lastVerifiedPassed: true,
        consecutiveBlocks: 0,
        totalBlocks: 1,
        updatedAt: isoAgo(2),
      },
    },
    evidence: [
      {
        id: 'ver-demo-3',
        conversationId: 'conv-verify-demo-1',
        trigger: 'stop-hook',
        outcome: 'pass',
        passed: true,
        timestamp: isoAgo(2),
        durationMs: 1840,
        dirtyFiles: ['src/modules/verify/core.ts', 'src/modules/verify/hook.ts'],
        emptyFiles: [],
        results: [
          {
            commandId: 'typecheck',
            label: 'TypeScript Typecheck',
            executable: 'npm',
            args: ['run', 'typecheck'],
            passed: true,
            exitCode: 0,
            timedOut: false,
            durationMs: 920,
            outputTail: 'tsc --noEmit completed with 0 errors.',
            outputTruncated: false,
          },
          {
            commandId: 'unit-tests',
            label: 'Offline Unit Tests',
            executable: 'npm',
            args: ['test'],
            passed: true,
            exitCode: 0,
            timedOut: false,
            durationMs: 920,
            outputTail: 'pass 12 | fail 0 | duration 880ms',
            outputTruncated: false,
          },
        ],
        summary: 'All 2 verification command(s) passed after fix; stop allowed.',
      },
      {
        id: 'ver-demo-2',
        conversationId: 'conv-verify-demo-1',
        trigger: 'stop-hook',
        outcome: 'blocked',
        passed: false,
        timestamp: isoAgo(6),
        durationMs: 1120,
        dirtyFiles: ['src/modules/verify/hook.ts'],
        emptyFiles: [],
        results: [
          {
            commandId: 'typecheck',
            label: 'TypeScript Typecheck',
            executable: 'npm',
            args: ['run', 'typecheck'],
            passed: false,
            exitCode: 2,
            timedOut: false,
            durationMs: 1120,
            outputTail:
              "src/modules/verify/hook.ts(42,14): error TS2322: Type 'string' is not assignable to type 'number'.",
            outputTruncated: false,
            error: 'Command exited with code 2',
          },
        ],
        summary: '1/1 verification command(s) failed; Stop blocked pending fix.',
        reason:
          '[agy-NOV Verify Gate] Blocked stop: TypeScript Typecheck exited with code 2 (TS2322).',
      },
      {
        id: 'ver-demo-1',
        conversationId: 'conv-verify-demo-1',
        trigger: 'manual',
        outcome: 'pass',
        passed: true,
        timestamp: isoAgo(18),
        durationMs: 760,
        dirtyFiles: ['src/core/catalog.ts'],
        emptyFiles: [],
        results: [
          {
            commandId: 'typecheck',
            label: 'TypeScript Typecheck',
            executable: 'npm',
            args: ['run', 'typecheck'],
            passed: true,
            exitCode: 0,
            timedOut: false,
            durationMs: 760,
            outputTail: 'tsc --noEmit completed cleanly.',
            outputTruncated: false,
          },
        ],
        summary: 'Baseline typecheck passed cleanly.',
      },
    ],
    blockedStops: 1,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * Pure in-memory synthetic stack detection for demoMode (zero disk reads/writes).
 */
export function createDemoVerifyDetection(): DetectedWorkspaceVerifyResult {
  const candidates: DetectedVerifyCommand[] = [
    {
      id: 'node-typecheck',
      label: 'Typecheck (npm)',
      executable: 'npm',
      args: ['run', 'typecheck'],
      timeoutMs: 20_000,
      reason: '[demo] Detected "typecheck" script in package.json (npm)',
    },
    {
      id: 'node-lint',
      label: 'Lint (npm)',
      executable: 'npm',
      args: ['run', 'lint'],
      timeoutMs: 20_000,
      reason: '[demo] Detected "lint" script in package.json (npm)',
    },
    {
      id: 'node-test',
      label: 'Tests (npm)',
      executable: 'npm',
      args: ['test'],
      timeoutMs: 30_000,
      reason: '[demo] Detected "test" script in package.json (npm)',
    },
  ];
  const recommendations: DetectedVerifyCommand[] = [];
  for (const item of candidates) {
    const checked = validateVerifyCommand({ ...item, enabled: true });
    if (checked.valid && checked.command) {
      recommendations.push({
        id: checked.command.id,
        label: checked.command.label,
        executable: checked.command.executable,
        args: [...checked.command.args],
        timeoutMs: checked.command.timeoutMs,
        reason: item.reason,
      });
    }
  }
  return {
    detectedStacks: ['node', 'typescript'],
    recommendations,
  };
}

export function createDemoSpecSummaryForPr(): PrDeliverySpecSummary {
  const tasks = [
    { id: 't1', title: 'Configure allowlisted typecheck and unit test commands', status: 'done' },
    { id: 't2', title: 'Enforce Stop-hook verification gate with anti-loop guardrail', status: 'done' },
    { id: 't3', title: 'Generate redacted PR delivery evidence summary', status: 'done' },
  ];
  return {
    specId: 'spec-verify-pipeline',
    title: 'Verify Gate & PR Evidence Pipeline',
    status: 'approved',
    mode: 'full',
    totalTasks: tasks.length,
    doneTasks: tasks.length,
    tasks,
  };
}
