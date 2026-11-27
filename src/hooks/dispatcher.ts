import fs from 'node:fs';
import {
  loadNovConfigReadOnly,
  resolveNovDataDir,
  sanitizeDataDirCandidate,
} from '../core/config.js';
import type { HookEventName, NormalizedHookPayload } from '../core/types.js';
import { normalizeHookEvent, normalizeHookPayload, parseCliFlag } from '../core/utils.js';
import { handleGuardPreToolHook } from '../modules/guard/hook.js';
import { handleMemSessionStartHook, handleMemStopHook } from '../modules/mem/hook.js';
import { handleRemotePreToolHook, handleRemoteStopHook } from '../modules/remote/hook.js';
import { handleReviewHook } from '../modules/review/hook.js';
import { handleXrayHook } from '../modules/xray/hook.js';

export interface UnifiedHookResult {
  decision?: 'allow' | 'ask' | 'deny';
  reason?: string;
  injectSteps?: unknown[];
}

export async function dispatchNovHook(
  rawInput: unknown,
  fallbackEvent: HookEventName,
  cliDataDir?: string,
): Promise<UnifiedHookResult> {
  const payload: NormalizedHookPayload = normalizeHookPayload(rawInput, fallbackEvent);
  const rootDataDir = resolveNovDataDir(sanitizeDataDirCandidate(cliDataDir) ?? payload.pluginData);
  // Pure read-only check so disabled modules cause zero disk writes and zero network calls.
  const config = loadNovConfigReadOnly(rootDataDir);
  const { modules } = config;

  if (payload.event === 'SessionStart') {
    if (!modules.mem) return {};
    try {
      const memOut = handleMemSessionStartHook(payload, rootDataDir);
      if (memOut && Array.isArray(memOut.injectSteps) && memOut.injectSteps.length > 0) {
        return { injectSteps: memOut.injectSteps };
      }
    } catch {
      // fail-open
    }
    return {};
  }

  if (payload.event === 'PreToolUse') {
    if (!modules.guard && !modules.remote) {
      return {};
    }

    let finalDecision: 'allow' | 'ask' | 'deny' | undefined;
    const reasons: string[] = [];

    if (modules.guard) {
      try {
        const guardRes = handleGuardPreToolHook(payload, rootDataDir);
        if (guardRes.decision === 'deny') {
          return { decision: 'deny', reason: guardRes.reason };
        }
        if (guardRes.decision === 'ask') {
          finalDecision = 'ask';
          if (guardRes.reason) reasons.push(guardRes.reason);
        } else if (guardRes.decision === 'allow') {
          finalDecision = 'allow';
        }
      } catch {
        // fail-open on unexpected hook error
      }
    }

    if (modules.remote) {
      try {
        const remoteRes = await handleRemotePreToolHook(payload, rootDataDir);
        if (remoteRes?.decision === 'deny') {
          return { decision: 'deny', reason: remoteRes.reason };
        }
        if (remoteRes?.decision === 'ask') {
          finalDecision = 'ask';
          if (remoteRes.reason) reasons.push(remoteRes.reason);
        } else if (remoteRes?.decision === 'allow' && !finalDecision) {
          finalDecision = 'allow';
        }
      } catch {
        // fail-open if remote bridge errors
      }
    }

    if (finalDecision === 'ask') {
      return { decision: 'ask', reason: reasons.join(' | ') || 'Approval required by agy-NOV' };
    }
    if (finalDecision === 'allow') {
      return { decision: 'allow' };
    }
    return {};
  }

  if (payload.event === 'PostToolUse') {
    if (modules.review) {
      try {
        handleReviewHook(payload, rootDataDir);
      } catch {
        // isolate module error
      }
    }
    if (modules.xray) {
      try {
        handleXrayHook(payload, rootDataDir);
      } catch {
        // isolate module error
      }
    }
    return {};
  }

  if (payload.event === 'Stop') {
    if (modules.review) {
      try {
        handleReviewHook(payload, rootDataDir);
      } catch {
        // isolate
      }
    }
    if (modules.xray) {
      try {
        handleXrayHook(payload, rootDataDir);
      } catch {
        // isolate
      }
    }
    if (modules.mem) {
      try {
        handleMemStopHook(payload, rootDataDir);
      } catch {
        // isolate
      }
    }
    if (modules.remote) {
      try {
        await handleRemoteStopHook(payload, rootDataDir);
      } catch {
        // isolate
      }
    }
    return { decision: 'allow' };
  }

  return {};
}

function readStdinText(): string {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const event = normalizeHookEvent(parseCliFlag(argv, '--event'), 'PostToolUse');
  const cliDataDir = parseCliFlag(argv, '--data-dir');

  let rawInput: unknown = {};
  const text = readStdinText().trim();
  if (text) {
    try {
      rawInput = JSON.parse(text);
    } catch {
      rawInput = {};
    }
  }

  try {
    const out = await dispatchNovHook(rawInput, event, cliDataDir);
    process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch {
    const fallback = event === 'Stop' ? { decision: 'allow' } : {};
    process.stdout.write(`${JSON.stringify(fallback)}\n`);
  }
}

const isMain =
  (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) ||
  (typeof process.argv[1] === 'string' &&
    (process.argv[1].endsWith('hook.cjs') || process.argv[1].endsWith('dispatcher.ts')));

if (isMain) {
  void main();
}
