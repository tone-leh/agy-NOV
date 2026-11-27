import fs from 'node:fs';
import path from 'node:path';
import {
  getModuleDataDir,
  loadNovConfigReadOnly,
  resolveNovDataDir,
  sanitizeDataDirCandidate,
  type NovConfig,
} from '../core/config.js';
import {
  isMemoryRecordStale,
  redactFeedText,
  writeFeedSnapshotIfDataDirExists,
} from '../core/feed.js';
import type { HookEventName, NormalizedHookPayload } from '../core/types.js';
import { normalizeHookEvent, normalizeHookPayload, parseCliFlag } from '../core/utils.js';
import { handleGuardPreToolHook } from '../modules/guard/hook.js';
import { handleMemSessionStartHook, handleMemStopHook } from '../modules/mem/hook.js';
import { handleRadarHook } from '../modules/radar/hook.js';
import { handleRemotePreToolHook, handleRemoteStopHook } from '../modules/remote/hook.js';
import { handleReviewHook } from '../modules/review/hook.js';
import { handleSpecPreToolHook, handleSpecSessionStartHook } from '../modules/spec/hook.js';
import { handleTurboSessionStartHook } from '../modules/turbo/hook.js';
import { handleVerifyPostToolHook, handleVerifyStopHook } from '../modules/verify/hook.js';
import { handleXrayHook } from '../modules/xray/hook.js';

export interface UnifiedHookResult {
  decision?: 'allow' | 'ask' | 'deny';
  reason?: string;
  injectSteps?: unknown[];
  terminationBehavior?: '' | 'terminate' | 'force_continue';
}

const PRE_INVOCATION_GUARD_WINDOW_MS = 5 * 60 * 1000;
const MAX_PRE_INVOCATION_FILE_BYTES = 2 * 1024 * 1024;

function readJsonStrictReadOnly(rootDataDir: string, moduleId: 'spec' | 'mem' | 'guard', fileName: string): unknown | null {
  try {
    const rootStat = fs.lstatSync(rootDataDir);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return null;
    const modulesRoot = path.join(rootDataDir, 'modules');
    const modsStat = fs.lstatSync(modulesRoot);
    if (modsStat.isSymbolicLink() || !modsStat.isDirectory()) return null;
    const modDir = getModuleDataDir(rootDataDir, moduleId);
    const modStat = fs.lstatSync(modDir);
    if (modStat.isSymbolicLink() || !modStat.isDirectory()) return null;
    const filePath = path.join(modDir, fileName);
    const fileStat = fs.lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile() || fileStat.size > MAX_PRE_INVOCATION_FILE_BYTES) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function stripBidiAndZeroWidth(input: string): string {
  return input.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '');
}

function escapeMarkdownInline(input: string): string {
  return stripBidiAndZeroWidth(input).replace(/([\\`*_~[\]()!<>|#])/g, '\\$1');
}

function sanitizeInlineCodeToken(input: string): string {
  const cleaned = stripBidiAndZeroWidth(input)
    .replace(/[`\r\n]/g, '')
    .replace(/[^A-Za-z0-9._:/ -]/g, '_')
    .trim();
  return cleaned || 'tool';
}

function buildPreInvocationReceiptLines(rootDataDir: string, config: NovConfig): string[] {
  const { modules } = config;
  const lines: string[] = [];

  // 1. Spec DRAFT write-lock receipt
  if (modules.spec) {
    const raw = readJsonStrictReadOnly(rootDataDir, 'spec', 'state.json');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const state = raw as Record<string, unknown>;
      const activeId = typeof state.activeSpecId === 'string' ? state.activeSpecId : null;
      let activeSpec: Record<string, unknown> | null = null;
      if (activeId && Array.isArray(state.specs)) {
        for (const item of state.specs) {
          if (item && typeof item === 'object' && !Array.isArray(item) && (item as Record<string, unknown>).id === activeId) {
            activeSpec = item as Record<string, unknown>;
            break;
          }
        }
      } else if (activeId && state.specs && typeof state.specs === 'object' && !Array.isArray(state.specs)) {
        const candidate = (state.specs as Record<string, unknown>)[activeId];
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          activeSpec = candidate as Record<string, unknown>;
        }
      }
      if (activeSpec && activeSpec.status === 'draft' && activeSpec.enforcePlanBeforeWrite === true) {
        const rawTitle = typeof activeSpec.title === 'string' && activeSpec.title.trim() ? activeSpec.title : activeId ?? 'Active Spec';
        const safeTitle = escapeMarkdownInline(redactFeedText(rawTitle, 80));
        lines.push(`🔒 **Spec Write Lock**: "${safeTitle}" is in DRAFT — approve before editing files.`);
      }
    }
  }

  // 2. Memory stale/drifted anchor receipt
  if (modules.mem) {
    const raw = readJsonStrictReadOnly(rootDataDir, 'mem', 'memories.json');
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).memories)
        ? ((raw as Record<string, unknown>).memories as unknown[])
        : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).items)
          ? ((raw as Record<string, unknown>).items as unknown[])
          : [];
    let staleCount = 0;
    for (const item of list) {
      if (item && typeof item === 'object' && !Array.isArray(item) && isMemoryRecordStale(item as Record<string, unknown>)) {
        staleCount += 1;
      }
    }
    if (staleCount > 0) {
      lines.push(`🧠 **Memory Drift**: ${staleCount} anchored memory item(s) marked stale/drifted — review or re-verify anchors.`);
    }
  }

  // 3. Guard recent deny receipt (within last 5 minutes)
  if (modules.guard) {
    const raw = readJsonStrictReadOnly(rootDataDir, 'guard', 'audit.json');
    const events = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).events)
        ? ((raw as Record<string, unknown>).events as unknown[])
        : [];
    const nowMs = Date.now();
    let newestTs = -Infinity;
    let newestDeny: { toolName: string; reason: string } | null = null;
    for (const item of events) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const decision = String(rec.decision ?? '').trim().toLowerCase();
      if (decision !== 'deny') continue;
      const tsMs = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : Number.NaN;
      if (!Number.isFinite(tsMs)) continue;
      const ageMs = nowMs - tsMs;
      if (ageMs > PRE_INVOCATION_GUARD_WINDOW_MS || ageMs < -60_000) continue;
      if (tsMs > newestTs) {
        newestTs = tsMs;
        newestDeny = {
          toolName: sanitizeInlineCodeToken(redactFeedText(String(rec.toolName ?? rec.tool_name ?? 'tool'), 48)),
          reason: escapeMarkdownInline(
            redactFeedText(String(rec.reason ?? rec.summary ?? 'blocked by Guard policy'), 120) ||
              'blocked by Guard policy',
          ),
        };
      }
    }
    if (newestDeny) {
      lines.push(`🛡️ **Guard Blocked**: \`${newestDeny.toolName}\` was denied recently — ${newestDeny.reason}`);
    }
  }

  return lines;
}

function refreshFeedSnapshotBestEffort(rootDataDir: string, config: NovConfig): void {
  try {
    writeFeedSnapshotIfDataDirExists(rootDataDir, config);
  } catch {
    // Best-effort only: never impact hook result or latency
  }
}

export async function dispatchNovHook(
  rawInput: unknown,
  fallbackEvent: HookEventName,
  cliDataDir?: string,
): Promise<UnifiedHookResult> {
  const payload: NormalizedHookPayload = normalizeHookPayload(rawInput, fallbackEvent);
  const rootDataDir = resolveNovDataDir(sanitizeDataDirCandidate(cliDataDir) ?? payload.pluginData);
  // Pure read-only O(1) check so disabled modules cause zero disk writes and zero network/CDP calls.
  const config = loadNovConfigReadOnly(rootDataDir);
  const { modules } = config;

  if (payload.event === 'SessionStart') {
    if (!modules.mem && !modules.turbo && !modules.spec) return {};
    const injectSteps: unknown[] = [];

    if (modules.turbo) {
      try {
        const turboOut = handleTurboSessionStartHook(payload, rootDataDir);
        if (turboOut && Array.isArray(turboOut.injectSteps) && turboOut.injectSteps.length > 0) {
          injectSteps.push(...turboOut.injectSteps);
        }
      } catch {
        // fail-open
      }
    }

    if (modules.spec) {
      try {
        const specOut = handleSpecSessionStartHook(payload, rootDataDir);
        if (specOut && Array.isArray(specOut.injectSteps) && specOut.injectSteps.length > 0) {
          injectSteps.push(...specOut.injectSteps);
        }
      } catch {
        // fail-open
      }
    }

    if (modules.mem) {
      try {
        const memOut = handleMemSessionStartHook(payload, rootDataDir);
        if (memOut && Array.isArray(memOut.injectSteps) && memOut.injectSteps.length > 0) {
          injectSteps.push(...memOut.injectSteps);
        }
      } catch {
        // fail-open
      }
    }

    return injectSteps.length > 0 ? { injectSteps } : {};
  }

  if (payload.event === 'PreInvocation') {
    // O(1) short-circuit: zero disk reads and zero disk writes when all 3 receipt sources are off.
    if (!modules.spec && !modules.mem && !modules.guard) {
      return {};
    }
    try {
      const lines = buildPreInvocationReceiptLines(rootDataDir, config);
      if (lines.length === 0) {
        return {};
      }
      return {
        injectSteps: [
          {
            systemMessage: {
              systemMessage: '',
              metadata: {
                user_markdown: lines.join('\n'),
              },
            },
          },
        ],
      };
    } catch {
      return {};
    }
  }

  if (payload.event === 'PreToolUse') {
    if (!modules.guard && !modules.spec && !modules.remote && !modules.radar) {
      return {};
    }

    if (modules.radar) {
      try {
        handleRadarHook(payload, rootDataDir);
      } catch {
        // isolate observer error
      }
    }

    let finalDecision: 'allow' | 'ask' | 'deny' | undefined;
    const reasons: string[] = [];

    // Guard always takes strict precedence over spec and remote
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

    // Spec write-lock gate blocks workspace mutations while active spec stays in DRAFT
    if (modules.spec) {
      try {
        const specRes = handleSpecPreToolHook(payload, rootDataDir);
        if (specRes.decision === 'deny') {
          return { decision: 'deny', reason: specRes.reason };
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
    if (modules.radar) {
      try {
        handleRadarHook(payload, rootDataDir);
      } catch {
        // isolate module error
      }
    }
    if (modules.verify) {
      try {
        handleVerifyPostToolHook(payload, rootDataDir);
      } catch {
        // isolate module error
      }
    }
    refreshFeedSnapshotBestEffort(rootDataDir, config);
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
    if (modules.verify) {
      try {
        const verifyRes = await handleVerifyStopHook(payload, rootDataDir);
        if (verifyRes.decision === 'deny') {
          refreshFeedSnapshotBestEffort(rootDataDir, config);
          return {
            decision: 'deny',
            reason:
              verifyRes.reason ||
              '[agy-NOV Verify Gate] Verification checks failed before stopping.',
          };
        }
      } catch {
        // fail-open on unexpected hook error
      }
    }
    if (modules.radar) {
      try {
        handleRadarHook(payload, rootDataDir);
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
    refreshFeedSnapshotBestEffort(rootDataDir, config);
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
