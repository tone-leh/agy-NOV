import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ModuleId } from '../../../../src/core/catalog.js';
import type { NovBridge } from '../../bridge.js';
import { useNovI18n } from '../../i18n/index.js';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
  onNavigateModule?: (moduleId: ModuleId, context?: { worktreePath?: string; branch?: string }) => void;
}

interface VerifyCommandSpec {
  id: string;
  label: string;
  executable: string;
  args: string[];
  timeoutMs?: number;
  enabled: boolean;
}

interface VerifyPolicy {
  enforceOnStop: boolean;
  autoRunOnStop: boolean;
  blockEmptyWrites: boolean;
  maxConsecutiveBlocks: number;
  commands: VerifyCommandSpec[];
}

interface VerifySessionRecord {
  conversationId: string;
  workspaceRoot?: string;
  dirtyFiles?: string[];
  emptyFiles?: string[];
  lastEditAt?: string;
  lastVerifiedAt?: string;
  lastVerifiedPassed?: boolean;
  consecutiveBlocks?: number;
  totalBlocks?: number;
  updatedAt?: string;
}

interface VerifyCommandRunResult {
  commandId?: string;
  id?: string;
  label?: string;
  executable?: string;
  args?: string[];
  passed?: boolean;
  exitCode?: number | null;
  timedOut?: boolean;
  durationMs?: number;
  outputTail?: string;
  outputSnippet?: string;
  output?: string;
  outputTruncated?: boolean;
  error?: string;
}

interface VerifyWorktreeOption {
  path: string;
  branch: string | null;
  isMain: boolean;
}

interface PrDeliverySummaryResult {
  mode: string;
  markdown: string;
  passed: boolean;
  branch?: string;
  worktreePath?: string;
  evidenceId?: string;
  specId?: string;
  checksTotal: number;
  checksPassed: number;
}

interface VerifyEvidenceRecord {
  id: string;
  conversationId?: string;
  trigger?: string;
  outcome?: 'pass' | 'fail' | 'blocked' | 'guardrail-allow' | string;
  passed: boolean;
  timestamp?: string;
  durationMs?: number;
  dirtyFiles?: string[];
  emptyFiles?: string[];
  results?: VerifyCommandRunResult[];
  summary?: string;
  reason?: string;
  targetBranch?: string;
  targetWorktree?: string;
}

interface VerifyStats {
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  blockedStops: number;
}

interface VerifyStateView {
  mode: string;
  policy: VerifyPolicy;
  sessions: VerifySessionRecord[];
  evidence: VerifyEvidenceRecord[];
  stats: VerifyStats;
  updatedAt?: string;
  availableWorktrees?: VerifyWorktreeOption[];
}

interface EditableCommand {
  id: string;
  label: string;
  executable: string;
  argsText: string;
  timeoutMs?: number;
  enabled: boolean;
}

interface PolicyDraft {
  enforceOnStop: boolean;
  autoRunOnStop: boolean;
  blockEmptyWrites: boolean;
  maxConsecutiveBlocks: number;
  commands: EditableCommand[];
}

interface DetectedVerifyRecommendation {
  id: string;
  label: string;
  executable: string;
  args: string[];
  timeoutMs: number;
  reason: string;
}

interface DetectedStackResult {
  detectedStacks: string[];
  recommendations: DetectedVerifyRecommendation[];
}

function commandSignature(executable: string, args: readonly string[]): string {
  return `${executable.trim()}\0${args.map((a) => a.trim()).join('\0')}`;
}

function splitArgsText(raw: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    args.push(current);
  }
  return args;
}

function joinArgs(args: readonly string[] | undefined): string {
  if (!Array.isArray(args)) return '';
  return args
    .map((arg) => (/\s/.test(arg) ? `"${arg.replace(/"/g, '')}"` : arg))
    .join(' ');
}

function toDraft(policy: VerifyPolicy): PolicyDraft {
  return {
    enforceOnStop: Boolean(policy.enforceOnStop),
    autoRunOnStop: Boolean(policy.autoRunOnStop),
    blockEmptyWrites: Boolean(policy.blockEmptyWrites),
    maxConsecutiveBlocks: Number(policy.maxConsecutiveBlocks) || 3,
    commands: Array.isArray(policy.commands)
      ? policy.commands.map((c) => ({
          id: c.id,
          label: c.label ?? c.id,
          executable: c.executable ?? '',
          argsText: joinArgs(c.args),
          timeoutMs: c.timeoutMs,
          enabled: c.enabled !== false,
        }))
      : [],
  };
}

function draftToPayload(draft: PolicyDraft): {
  enforceOnStop: boolean;
  autoRunOnStop: boolean;
  blockEmptyWrites: boolean;
  maxConsecutiveBlocks: number;
  commands: VerifyCommandSpec[];
} {
  return {
    enforceOnStop: draft.enforceOnStop,
    autoRunOnStop: draft.autoRunOnStop,
    blockEmptyWrites: draft.blockEmptyWrites,
    maxConsecutiveBlocks: Math.max(1, Math.min(10, Math.round(draft.maxConsecutiveBlocks) || 3)),
    commands: draft.commands
      .filter((c) => c.executable.trim().length > 0)
      .map((c, idx) => ({
        id: (c.id || `cmd-${idx + 1}`).slice(0, 64),
        label: (c.label.trim() || c.executable.trim()).slice(0, 120),
        executable: c.executable.trim().slice(0, 64),
        args: splitArgsText(c.argsText),
        ...(typeof c.timeoutMs === 'number' && Number.isFinite(c.timeoutMs)
          ? { timeoutMs: Math.max(1_000, Math.min(60_000, Math.round(c.timeoutMs))) }
          : {}),
        enabled: c.enabled,
      })),
  };
}

function makeSafeCommandId(label: string, existingIds: Set<string>): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const base = slug || 'check';
  let candidate = base;
  let seq = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${seq}`;
    seq += 1;
  }
  return candidate;
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatDuration(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '0ms';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function getCommandOutput(res: VerifyCommandRunResult): string {
  const first = [res.outputTail, res.outputSnippet, res.output, res.error].find(
    (val): val is string => typeof val === 'string' && val.trim().length > 0,
  );
  return first ? first.trim() : '';
}

export const VerifyPanel: React.FC<NovModulePanelProps> = ({
  bridge,
  active,
  onNotify,
  incomingEvent,
  onNavigateModule,
}) => {
  const { dict } = useNovI18n();
  const vDict = dict.panels.verify;

  const [tab, setTab] = useState<'gate' | 'evidence'>('gate');
  const [state, setState] = useState<VerifyStateView | null>(null);
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [policyDirty, setPolicyDirty] = useState(false);
  const policyDirtyRef = useRef(false);
  policyDirtyRef.current = policyDirty;

  const [newLabel, setNewLabel] = useState('');
  const [newExec, setNewExec] = useState('');
  const [newArgs, setNewArgs] = useState('');

  const [selectedWorktreePath, setSelectedWorktreePath] = useState<string>('');
  const [prSummary, setPrSummary] = useState<PrDeliverySummaryResult | null>(null);
  const [detectedResult, setDetectedResult] = useState<DetectedStackResult | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const applyServerState = useCallback((next: VerifyStateView, syncDraft: boolean) => {
    setState((prev) => ({
      ...next,
      availableWorktrees: next.availableWorktrees ?? prev?.availableWorktrees,
    }));
    if (syncDraft && next.policy) {
      setDraft(toDraft(next.policy));
      setPolicyDirty(false);
    }
  }, []);

  const loadState = useCallback(
    async (syncDraft = true) => {
      try {
        const res = await bridge.callTool<VerifyStateView>('app_verify_get_state', {});
        applyServerState(res, syncDraft);
      } catch (err) {
        onNotify?.(err instanceof Error ? err.message : String(err));
      }
    },
    [applyServerState, bridge, onNotify],
  );

  useEffect(() => {
    if (active) {
      void loadState(!policyDirtyRef.current);
    }
  }, [active, loadState]);

  useEffect(() => {
    if (!incomingEvent) return;
    const sc = incomingEvent.structuredContent;
    if (sc && typeof sc === 'object') {
      const ctx =
        sc.context && typeof sc.context === 'object'
          ? (sc.context as { worktreePath?: string })
          : null;
      const incomingWt =
        typeof sc.worktreePath === 'string' && sc.worktreePath.trim()
          ? sc.worktreePath.trim()
          : typeof ctx?.worktreePath === 'string' && ctx.worktreePath.trim()
            ? ctx.worktreePath.trim()
            : '';
      if (incomingWt) {
        setSelectedWorktreePath(incomingWt);
      }
    }
    if (!active) return;
    const tool = incomingEvent.toolName ?? '';
    const mod = sc?.novModule;
    if (tool.startsWith('verify_') || tool.startsWith('app_verify_') || mod === 'verify') {
      void loadState(!policyDirtyRef.current);
    }
  }, [active, incomingEvent, loadState]);

  const updateDraft = useCallback((updater: (prev: PolicyDraft) => PolicyDraft) => {
    setDraft((prev) => (prev ? updater(prev) : prev));
    setPolicyDirty(true);
  }, []);

  const persistPolicy = useCallback(
    async (currentDraft: PolicyDraft): Promise<VerifyStateView | null> => {
      const payload = draftToPayload(currentDraft);
      const res = await bridge.callTool<{ policy: VerifyPolicy; state: VerifyStateView }>(
        'app_verify_save_policy',
        payload,
      );
      const nextState = res.state ?? (state ? { ...state, policy: res.policy } : null);
      if (nextState) {
        applyServerState(nextState, true);
      }
      return nextState;
    },
    [applyServerState, bridge, state],
  );

  const handleSavePolicy = async () => {
    if (!draft || busyAction) return;
    setBusyAction('save');
    try {
      await persistPolicy(draft);
      onNotify?.(vDict.savePolicy);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunChecks = async (commandId?: string) => {
    if (busyAction) return;
    setBusyAction(commandId ? `run:${commandId}` : 'run:all');
    try {
      if (policyDirty && draft) {
        await persistPolicy(draft);
      }
      const args: Record<string, unknown> = {};
      if (commandId) args.commandId = commandId;
      if (selectedWorktreePath) args.worktreePath = selectedWorktreePath;
      const res = await bridge.callTool<{ run?: VerifyEvidenceRecord; state?: VerifyStateView }>(
        'app_verify_run_checks',
        args,
      );
      if (res.state) {
        applyServerState(res.state, !policyDirty);
      } else {
        await loadState(false);
      }
      if (res.run) {
        onNotify?.(res.run.passed ? vDict.passed : vDict.failed);
      }
      setTab('evidence');
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleGeneratePrSummary = async () => {
    if (busyAction) return;
    setBusyAction('pr-summary');
    try {
      const args: Record<string, unknown> = {};
      if (selectedWorktreePath) args.worktreePath = selectedWorktreePath;
      const res = await bridge.callTool<PrDeliverySummaryResult>('app_verify_pr_summary', args);
      setPrSummary(res);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyPrSummary = async () => {
    if (!prSummary?.markdown) return;
    try {
      await navigator.clipboard?.writeText(prSummary.markdown);
      onNotify?.(dict.common.copied);
    } catch {
      onNotify?.(dict.common.copy);
    }
  };

  const handleSendPrSummary = async () => {
    if (!prSummary?.markdown) return;
    try {
      await bridge.sendMessage(prSummary.markdown);
      onNotify?.(dict.ops.sendToAgent);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClearHistory = async () => {
    if (busyAction) return;
    setBusyAction('clear');
    try {
      const res = await bridge.callTool<{ cleared?: number; state?: VerifyStateView }>(
        'app_verify_clear_history',
        {},
      );
      if (res.state) {
        applyServerState(res.state, false);
      } else {
        await loadState(false);
      }
      onNotify?.(vDict.clearHistory);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleAddCommand = () => {
    if (!draft) return;
    const exec = newExec.trim();
    if (!exec) return;
    const label = newLabel.trim() || exec;
    const existing = new Set(draft.commands.map((c) => c.id));
    const id = makeSafeCommandId(label, existing);
    updateDraft((prev) => ({
      ...prev,
      commands: [
        ...prev.commands,
        {
          id,
          label,
          executable: exec,
          argsText: newArgs.trim(),
          enabled: true,
        },
      ],
    }));
    setNewLabel('');
    setNewExec('');
    setNewArgs('');
  };

  const handleRemoveCommand = (id: string) => {
    updateDraft((prev) => ({
      ...prev,
      commands: prev.commands.filter((c) => c.id !== id),
    }));
  };

  const handlePatchCommand = (id: string, patch: Partial<EditableCommand>) => {
    updateDraft((prev) => ({
      ...prev,
      commands: prev.commands.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  };

  const handleDetectStack = async () => {
    if (busyAction) return;
    setBusyAction('detect');
    try {
      const res = await bridge.callTool<DetectedStackResult>('app_verify_detect_commands', {});
      const stacks = Array.isArray(res?.detectedStacks) ? res.detectedStacks : [];
      const recommendations = Array.isArray(res?.recommendations) ? res.recommendations : [];
      setDetectedResult({ detectedStacks: stacks, recommendations });
      if (recommendations.length === 0) {
        onNotify?.(vDict.noDetectedCommands);
      }
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const isRecommendationInDraft = useCallback(
    (rec: DetectedVerifyRecommendation, commands: readonly EditableCommand[]): boolean => {
      const recSig = commandSignature(rec.executable, rec.args);
      return commands.some(
        (c) =>
          c.id === rec.id || commandSignature(c.executable, splitArgsText(c.argsText)) === recSig,
      );
    },
    [],
  );

  const handleApplyDetected = (items: readonly DetectedVerifyRecommendation[]) => {
    if (!draft || items.length === 0) return;
    const toAdd: EditableCommand[] = [];
    const existingIds = new Set(draft.commands.map((c) => c.id));
    const existingSigs = new Set(
      draft.commands.map((c) => commandSignature(c.executable, splitArgsText(c.argsText))),
    );
    for (const rec of items) {
      const sig = commandSignature(rec.executable, rec.args);
      if (existingIds.has(rec.id) || existingSigs.has(sig)) continue;
      existingIds.add(rec.id);
      existingSigs.add(sig);
      toAdd.push({
        id: rec.id,
        label: rec.label,
        executable: rec.executable,
        argsText: joinArgs(rec.args),
        timeoutMs: rec.timeoutMs,
        enabled: true,
      });
    }
    if (toAdd.length === 0) return;
    updateDraft((prev) => {
      const merged = [...prev.commands];
      const prevIds = new Set(merged.map((c) => c.id));
      const prevSigs = new Set(
        merged.map((c) => commandSignature(c.executable, splitArgsText(c.argsText))),
      );
      for (const item of toAdd) {
        const sig = commandSignature(item.executable, splitArgsText(item.argsText));
        if (prevIds.has(item.id) || prevSigs.has(sig)) continue;
        prevIds.add(item.id);
        prevSigs.add(sig);
        merged.push(item);
      }
      return { ...prev, commands: merged };
    });
    onNotify?.(`${vDict.applyDetectedBtn} (+${toAdd.length})`);
  };

  const allDirtyFiles = useMemo(() => {
    const set = new Set<string>();
    const sessions = Array.isArray(state?.sessions) ? state.sessions : [];
    for (const sess of sessions) {
      if (Array.isArray(sess.dirtyFiles)) {
        for (const f of sess.dirtyFiles) set.add(f);
      }
    }
    return [...set];
  }, [state?.sessions]);

  const evidenceList = Array.isArray(state?.evidence) ? state.evidence : [];
  const availableWorktrees = Array.isArray(state?.availableWorktrees)
    ? state.availableWorktrees
    : [];
  const stats = state?.stats ?? { totalRuns: 0, passedRuns: 0, failedRuns: 0, blockedStops: 0 };
  const isBusy = busyAction !== null;

  return (
    <div className="nov-p-page">
      <section className="nov-p-card">
        <div className="nov-p-row">
          <div>
            <h2 className="nov-hero-title">{vDict.title}</h2>
            <p className="nov-hero-sub">{vDict.subtitle}</p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            <button
              type="button"
              className="nov-p-btn"
              disabled={isBusy}
              onClick={() => void loadState(true)}
            >
              {dict.common.refresh}
            </button>
            <button
              type="button"
              className="nov-p-btn is-primary"
              disabled={isBusy}
              onClick={() => void handleRunChecks()}
            >
              {busyAction === 'run:all' ? dict.common.loading : vDict.runChecks}
            </button>
            {onNavigateModule && (
              <button
                type="button"
                className="nov-p-btn"
                disabled={isBusy}
                onClick={() =>
                  onNavigateModule('review', {
                    worktreePath: selectedWorktreePath || undefined,
                  })
                }
              >
                {dict.modules.review.shortLabel}
              </button>
            )}
            <button
              type="button"
              className="nov-p-btn is-danger"
              disabled={isBusy || evidenceList.length === 0}
              onClick={() => void handleClearHistory()}
            >
              {busyAction === 'clear' ? dict.common.loading : vDict.clearHistory}
            </button>
          </div>
        </div>

        {availableWorktrees.length > 0 && (
          <div className="nov-p-row" style={{ gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: 'var(--nov-text-1)', fontWeight: 500 }}>
              Target Worktree:
            </span>
            <select
              className="nov-p-select"
              style={{
                flex: '1 1 240px',
                maxWidth: '420px',
                fontFamily: 'var(--nov-font-mono)',
                fontSize: '12px',
              }}
              aria-label="Target Worktree"
              disabled={isBusy}
              value={selectedWorktreePath}
              onChange={(e) => setSelectedWorktreePath(e.target.value)}
            >
              <option value="">Workspace Default (Main)</option>
              {availableWorktrees.map((wt) => (
                <option key={wt.path} value={wt.path}>
                  [{wt.isMain ? 'Main' : 'WT'}] {wt.branch ?? '(detached)'} — {wt.path}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="nov-p-stat-grid">
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{vDict.runChecks}</div>
            <div className="nov-p-stat-val">{stats.totalRuns}</div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{vDict.passed}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-success)' }}>
              {stats.passedRuns}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{vDict.failed}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-danger)' }}>
              {stats.failedRuns}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{vDict.blocked}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-warn)' }}>
              {stats.blockedStops}
            </div>
          </div>
        </div>

        {allDirtyFiles.length > 0 && (
          <div
            className="nov-p-banner"
            style={{
              background: 'var(--nov-warn-soft)',
              borderColor: 'var(--nov-warn)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <strong style={{ fontSize: '12px', color: 'var(--nov-warn)' }}>
              {vDict.dirtyFiles} ({allDirtyFiles.length})
            </strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {allDirtyFiles.slice(0, 12).map((file) => (
                <code
                  key={file}
                  className="nov-badge"
                  style={{ fontFamily: 'var(--nov-font-mono)' }}
                >
                  {file}
                </code>
              ))}
              {allDirtyFiles.length > 12 && (
                <span className="nov-badge">+{allDirtyFiles.length - 12}</span>
              )}
            </div>
          </div>
        )}

        <div className="nov-p-tabs">
          <button
            type="button"
            className={`nov-preset-btn ${tab === 'gate' ? 'is-active' : ''}`}
            onClick={() => setTab('gate')}
          >
            {vDict.tabGate}
          </button>
          <button
            type="button"
            className={`nov-preset-btn ${tab === 'evidence' ? 'is-active' : ''}`}
            onClick={() => setTab('evidence')}
          >
            {vDict.tabEvidence} ({evidenceList.length})
          </button>
        </div>
      </section>

      <section className="nov-p-card">
        <div className="nov-p-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
            <h3 className="nov-card-title">Generate PR Delivery Evidence</h3>
            {prSummary && (
              <span className={prSummary.passed ? 'nov-badge is-offline' : 'nov-badge is-network'}>
                {prSummary.checksPassed}/{prSummary.checksTotal} checks passed
              </span>
            )}
            {prSummary?.branch && (
              <span className="nov-badge is-accent">{prSummary.branch}</span>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            <button
              type="button"
              className="nov-p-btn is-primary"
              disabled={isBusy}
              onClick={() => void handleGeneratePrSummary()}
            >
              {busyAction === 'pr-summary' ? dict.common.loading : 'Generate PR Delivery Evidence'}
            </button>
            {prSummary && (
              <>
                <button
                  type="button"
                  className="nov-p-btn"
                  disabled={isBusy}
                  onClick={() => void handleCopyPrSummary()}
                >
                  {dict.common.copy}
                </button>
                <button
                  type="button"
                  className="nov-p-btn"
                  disabled={isBusy}
                  onClick={() => void handleSendPrSummary()}
                >
                  {dict.ops.sendToAgent}
                </button>
              </>
            )}
          </div>
        </div>

        {prSummary ? (
          <pre
            className="nov-p-pre"
            style={{ maxHeight: '240px', overflowY: 'auto', margin: 0 }}
          >
            {prSummary.markdown}
          </pre>
        ) : (
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--nov-text-2)' }}>
            Compile redacted Verify Gate checks, target worktree/branch metadata, and active Spec
            progress into a PR-ready Markdown block.
          </p>
        )}
      </section>

      {tab === 'gate' && draft && (
        <>
          <section className="nov-p-card">
            <div className="nov-p-row">
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                <h3 className="nov-card-title">{vDict.detectedCommandsTitle}</h3>
                {detectedResult &&
                  detectedResult.detectedStacks.map((stack) => (
                    <span key={stack} className="nov-badge is-offline">
                      {stack}
                    </span>
                  ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                <button
                  type="button"
                  className="nov-p-btn"
                  disabled={isBusy}
                  onClick={() => void handleDetectStack()}
                >
                  {busyAction === 'detect' ? dict.common.loading : vDict.detectStackBtn}
                </button>
                {detectedResult && detectedResult.recommendations.length > 0 && (
                  <button
                    type="button"
                    className="nov-p-btn is-primary"
                    disabled={
                      isBusy ||
                      detectedResult.recommendations.every((rec) =>
                        isRecommendationInDraft(rec, draft.commands),
                      )
                    }
                    onClick={() => handleApplyDetected(detectedResult.recommendations)}
                  >
                    {vDict.applyDetectedBtn}
                  </button>
                )}
              </div>
            </div>

            {detectedResult && (
              detectedResult.recommendations.length === 0 ? (
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--nov-text-2)' }}>
                  {vDict.noDetectedCommands}
                </p>
              ) : (
                <div className="nov-p-list">
                  {detectedResult.recommendations.map((rec) => {
                    const alreadyAdded = isRecommendationInDraft(rec, draft.commands);
                    return (
                      <div key={rec.id} className="nov-p-item">
                        <div className="nov-p-row">
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '3px',
                              minWidth: 0,
                              flex: 1,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                gap: '6px',
                              }}
                            >
                              <strong>{rec.label}</strong>
                              <code
                                style={{
                                  fontFamily: 'var(--nov-font-mono)',
                                  fontSize: '12px',
                                  color: 'var(--nov-accent)',
                                }}
                              >
                                {[rec.executable, ...rec.args].join(' ')}
                              </code>
                              <span className="nov-badge">{formatDuration(rec.timeoutMs)}</span>
                            </div>
                            <span style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                              {rec.reason}
                            </span>
                          </div>
                          <button
                            type="button"
                            className={alreadyAdded ? 'nov-p-btn' : 'nov-p-btn is-primary'}
                            disabled={isBusy || alreadyAdded}
                            onClick={() => handleApplyDetected([rec])}
                          >
                            {alreadyAdded ? dict.common.enabled : vDict.applyDetectedBtn}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </section>

          <section className="nov-p-card">
            <div className="nov-p-row">
              <h3 className="nov-card-title">{vDict.tabGate}</h3>
              <button
                type="button"
                className="nov-p-btn is-primary"
                disabled={isBusy}
                onClick={() => void handleSavePolicy()}
              >
                {busyAction === 'save' ? dict.common.loading : vDict.savePolicy}
              </button>
            </div>

            <div className="nov-p-row">
              <span>{vDict.enforceOnStop}</span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.enforceOnStop}
                className="nov-switch"
                disabled={isBusy}
                onClick={() =>
                  updateDraft((prev) => ({ ...prev, enforceOnStop: !prev.enforceOnStop }))
                }
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>

            <div className="nov-p-row">
              <span>{vDict.autoRunOnStop}</span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.autoRunOnStop}
                className="nov-switch"
                disabled={isBusy}
                onClick={() =>
                  updateDraft((prev) => ({ ...prev, autoRunOnStop: !prev.autoRunOnStop }))
                }
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>

            <div className="nov-p-row">
              <span>{vDict.blockEmptyWrites}</span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.blockEmptyWrites}
                className="nov-switch"
                disabled={isBusy}
                onClick={() =>
                  updateDraft((prev) => ({ ...prev, blockEmptyWrites: !prev.blockEmptyWrites }))
                }
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>

            <div className="nov-p-row">
              <span>{vDict.maxBlocks}</span>
              <select
                className="nov-p-select"
                style={{ width: '96px' }}
                value={draft.maxConsecutiveBlocks}
                disabled={isBusy}
                onChange={(e) =>
                  updateDraft((prev) => ({
                    ...prev,
                    maxConsecutiveBlocks: Number(e.target.value) || 3,
                  }))
                }
              >
                {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="nov-p-card">
            <div className="nov-p-row">
              <h3 className="nov-card-title">
                {vDict.commandsTitle} ({draft.commands.length})
              </h3>
              {policyDirty && (
                <button
                  type="button"
                  className="nov-p-btn is-primary"
                  disabled={isBusy}
                  onClick={() => void handleSavePolicy()}
                >
                  {busyAction === 'save' ? dict.common.loading : vDict.savePolicy}
                </button>
              )}
            </div>

            {draft.commands.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--nov-text-2)' }}>{dict.common.empty}</p>
            ) : (
              <div className="nov-p-list">
                {draft.commands.map((cmd) => {
                  const cmdRunning = busyAction === `run:${cmd.id}`;
                  return (
                    <div key={cmd.id} className="nov-p-item">
                      <div className="nov-p-row">
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            flex: 1,
                            minWidth: '220px',
                          }}
                        >
                          <button
                            type="button"
                            role="switch"
                            aria-checked={cmd.enabled}
                            className="nov-switch"
                            disabled={isBusy}
                            onClick={() => handlePatchCommand(cmd.id, { enabled: !cmd.enabled })}
                          >
                            <span className="nov-switch-thumb" />
                          </button>
                          <input
                            className="nov-p-input"
                            style={{ flex: 1 }}
                            value={cmd.label}
                            placeholder={vDict.labelPlaceholder}
                            disabled={isBusy}
                            onChange={(e) => handlePatchCommand(cmd.id, { label: e.target.value })}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            className="nov-p-btn"
                            disabled={isBusy || !cmd.executable.trim()}
                            onClick={() => void handleRunChecks(cmd.id)}
                          >
                            {cmdRunning ? dict.common.loading : dict.common.run}
                          </button>
                          <button
                            type="button"
                            className="nov-p-btn is-danger"
                            disabled={isBusy}
                            onClick={() => handleRemoveCommand(cmd.id)}
                          >
                            {dict.common.delete}
                          </button>
                        </div>
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(130px, 1fr) minmax(200px, 2.2fr)',
                          gap: '8px',
                        }}
                      >
                        <input
                          className="nov-p-input"
                          style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '12px' }}
                          value={cmd.executable}
                          placeholder={vDict.executablePlaceholder}
                          disabled={isBusy}
                          onChange={(e) =>
                            handlePatchCommand(cmd.id, { executable: e.target.value })
                          }
                        />
                        <input
                          className="nov-p-input"
                          style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '12px' }}
                          value={cmd.argsText}
                          placeholder={vDict.argsPlaceholder}
                          disabled={isBusy}
                          onChange={(e) => handlePatchCommand(cmd.id, { argsText: e.target.value })}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div
              className="nov-p-item"
              style={{ borderStyle: 'dashed', background: 'var(--nov-bg-0)' }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: '8px',
                }}
              >
                <input
                  className="nov-p-input"
                  value={newLabel}
                  placeholder={vDict.labelPlaceholder}
                  disabled={isBusy}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
                <input
                  className="nov-p-input"
                  style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '12px' }}
                  value={newExec}
                  placeholder={vDict.executablePlaceholder}
                  disabled={isBusy}
                  onChange={(e) => setNewExec(e.target.value)}
                />
                <input
                  className="nov-p-input"
                  style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '12px' }}
                  value={newArgs}
                  placeholder={vDict.argsPlaceholder}
                  disabled={isBusy}
                  onChange={(e) => setNewArgs(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCommand();
                    }
                  }}
                />
              </div>
              <div className="nov-p-row">
                <button
                  type="button"
                  className="nov-p-btn"
                  disabled={isBusy || !newExec.trim()}
                  onClick={handleAddCommand}
                >
                  + {vDict.addCommand}
                </button>
              </div>
            </div>
          </section>
        </>
      )}

      {tab === 'evidence' && (
        <section className="nov-p-card">
          {evidenceList.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--nov-text-2)' }}>{vDict.emptyEvidence}</p>
          ) : (
            <div className="nov-p-list">
              {evidenceList.map((rec) => {
                const isBlocked = rec.outcome === 'blocked';
                const results = Array.isArray(rec.results) ? rec.results : [];
                const emptyFiles = Array.isArray(rec.emptyFiles) ? rec.emptyFiles : [];
                const dirtyFiles = Array.isArray(rec.dirtyFiles) ? rec.dirtyFiles : [];
                const badgeStyle = rec.passed
                  ? undefined
                  : isBlocked
                    ? undefined
                    : {
                        background: 'var(--nov-danger-soft)',
                        color: 'var(--nov-danger)',
                        borderColor: 'var(--nov-danger)',
                      };
                const badgeClass = rec.passed
                  ? 'nov-badge is-offline'
                  : isBlocked
                    ? 'nov-badge is-network'
                    : 'nov-badge';
                const badgeLabel = isBlocked
                  ? vDict.blocked
                  : rec.passed
                    ? vDict.passed
                    : vDict.failed;

                return (
                  <div key={rec.id} className="nov-p-item">
                    <div className="nov-p-row">
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                        <span className={badgeClass} style={badgeStyle}>
                          {badgeLabel}
                        </span>
                        {rec.trigger && <span className="nov-badge">{rec.trigger}</span>}
                        {rec.targetBranch && (
                          <span className="nov-badge is-accent">{rec.targetBranch}</span>
                        )}
                        {rec.targetWorktree && (
                          <code
                            className="nov-badge"
                            title={rec.targetWorktree}
                            style={{ fontFamily: 'var(--nov-font-mono)' }}
                          >
                            {rec.targetWorktree.split(/[\\/]/).filter(Boolean).pop() ??
                              rec.targetWorktree}
                          </code>
                        )}
                        {typeof rec.durationMs === 'number' && (
                          <span className="nov-badge">{formatDuration(rec.durationMs)}</span>
                        )}
                      </div>
                      <span style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                        {formatTime(rec.timestamp)}
                      </span>
                    </div>

                    {(rec.summary || rec.reason) && (
                      <div style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                        {rec.reason ?? rec.summary}
                      </div>
                    )}

                    {emptyFiles.length > 0 && (
                      <div
                        className="nov-p-banner"
                        style={{
                          background: 'var(--nov-danger-soft)',
                          borderColor: 'var(--nov-danger)',
                          color: 'var(--nov-danger)',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '6px',
                          alignItems: 'center',
                        }}
                      >
                        <strong>{vDict.blockEmptyWrites}:</strong>
                        {emptyFiles.map((file) => (
                          <code key={file} style={{ fontFamily: 'var(--nov-font-mono)' }}>
                            {file}
                          </code>
                        ))}
                      </div>
                    )}

                    {dirtyFiles.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                          {vDict.dirtyFiles}:
                        </span>
                        {dirtyFiles.slice(0, 8).map((file) => (
                          <code
                            key={file}
                            className="nov-badge"
                            style={{ fontFamily: 'var(--nov-font-mono)' }}
                          >
                            {file}
                          </code>
                        ))}
                        {dirtyFiles.length > 8 && (
                          <span className="nov-badge">+{dirtyFiles.length - 8}</span>
                        )}
                      </div>
                    )}

                    {results.length > 0 && (
                      <div className="nov-p-list" style={{ marginTop: '4px' }}>
                        {results.map((r, idx) => {
                          const output = getCommandOutput(r);
                          const errorDetail = typeof r.error === 'string' ? r.error.trim() : '';
                          const hasSeparateError = Boolean(
                            errorDetail && output && output !== errorDetail,
                          );
                          const outputIsErrorOnly = Boolean(errorDetail && output === errorDetail);
                          const cmdPassed = Boolean(r.passed ?? r.exitCode === 0);
                          const exitLabel = r.timedOut
                            ? 'TIMEOUT'
                            : `exit ${r.exitCode ?? '—'}`;
                          return (
                            <div
                              key={`${r.commandId ?? r.id ?? 'res'}-${idx}`}
                              style={{
                                background: 'var(--nov-bg-1)',
                                border: '1px solid var(--nov-border)',
                                borderRadius: '8px',
                                padding: '8px 10px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                              }}
                            >
                              <div className="nov-p-row">
                                <div
                                  style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    alignItems: 'center',
                                    gap: '6px',
                                  }}
                                >
                                  <strong>{r.label ?? r.commandId ?? r.executable}</strong>
                                  <code
                                    style={{
                                      fontSize: '11.5px',
                                      color: 'var(--nov-text-2)',
                                      fontFamily: 'var(--nov-font-mono)',
                                    }}
                                  >
                                    {[r.executable, ...(r.args ?? [])].filter(Boolean).join(' ')}
                                  </code>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span
                                    className={cmdPassed ? 'nov-badge is-offline' : 'nov-badge'}
                                    style={
                                      cmdPassed
                                        ? undefined
                                        : {
                                            background: 'var(--nov-danger-soft)',
                                            color: 'var(--nov-danger)',
                                            borderColor: 'var(--nov-danger)',
                                          }
                                    }
                                  >
                                    {exitLabel}
                                  </span>
                                  <span style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                                    {formatDuration(r.durationMs)}
                                  </span>
                                </div>
                              </div>
                              {hasSeparateError && (
                                <div
                                  style={{
                                    fontSize: '11.5px',
                                    color: 'var(--nov-danger)',
                                    fontFamily: 'var(--nov-font-mono)',
                                    wordBreak: 'break-word',
                                  }}
                                >
                                  {errorDetail}
                                </div>
                              )}
                              {output && (
                                <pre
                                  className="nov-p-pre"
                                  style={{
                                    maxHeight: '180px',
                                    overflowY: 'auto',
                                    ...(outputIsErrorOnly ? { color: 'var(--nov-danger)' } : {}),
                                  }}
                                >
                                  {output}
                                </pre>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
