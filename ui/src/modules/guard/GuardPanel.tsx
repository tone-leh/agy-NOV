import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { NovBridge } from '../../bridge.js';
import type {
  GuardDashboardState,
  GuardDecision,
  GuardTabKey,
  SnapshotDiff,
  ThreatScenario,
} from './types';
import './styles.css';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
}

const VALID_TABS = new Set<GuardTabKey>(['snapshots', 'audit', 'policy', 'scanner']);

function formatTime(iso: string): string {
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

function isGuardStateLike(val: unknown): val is GuardDashboardState {
  return Boolean(
    val &&
      typeof val === 'object' &&
      'policy' in val &&
      'stats' in val &&
      Array.isArray((val as GuardDashboardState).snapshots) &&
      Array.isArray((val as GuardDashboardState).auditLog),
  );
}

function unwrapGuardState(raw: unknown): GuardDashboardState | null {
  if (isGuardStateLike(raw)) return raw;
  if (raw && typeof raw === 'object' && 'state' in raw) {
    const inner = (raw as { state?: unknown }).state;
    if (isGuardStateLike(inner)) return inner;
  }
  return null;
}

function unwrapSnapshotDiff(raw: unknown): SnapshotDiff | null {
  if (raw && typeof raw === 'object') {
    if ('hunks' in raw && Array.isArray((raw as SnapshotDiff).hunks)) {
      return raw as SnapshotDiff;
    }
    if ('diff' in raw) {
      const inner = (raw as { diff?: unknown }).diff;
      if (inner && typeof inner === 'object' && 'hunks' in inner && Array.isArray((inner as SnapshotDiff).hunks)) {
        return inner as SnapshotDiff;
      }
    }
  }
  return null;
}

export const GuardPanel: React.FC<NovModulePanelProps> = ({
  bridge,
  active,
  onNotify,
  incomingEvent,
}) => {
  const loadedOnceRef = useRef(false);
  const lastEventRef = useRef<typeof incomingEvent>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => bridge.getTheme());
  const [state, setState] = useState<GuardDashboardState | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<GuardTabKey>('snapshots');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [diffNonce, setDiffNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [localToast, setLocalToast] = useState<string | null>(null);
  const [customPathsText, setCustomPathsText] = useState('');
  const [customCmdsText, setCustomCmdsText] = useState('');

  const notify = useCallback(
    (msg: string) => {
      if (onNotify) {
        onNotify(msg);
        return;
      }
      setLocalToast(msg);
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setLocalToast((cur) => (cur === msg ? null : cur));
      }, 3200);
    },
    [onNotify],
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Follow NovBridge dark/light theme changes
  useEffect(() => {
    let mounted = true;
    const unsub = bridge.onThemeChange((nextTheme) => {
      if (mounted) setTheme(nextTheme);
    });
    void bridge.ready().then(() => {
      if (mounted) setTheme(bridge.getTheme());
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, [bridge]);

  const applyDashboardState = useCallback((next: GuardDashboardState) => {
    setState(next);
    setCustomPathsText((next.policy.customProtectedPaths ?? []).join('\n'));
    setCustomCmdsText((next.policy.customBlockedCommands ?? []).join('\n'));
    setSelectedId((cur) => {
      if (cur && next.snapshots.some((s) => s.id === cur)) return cur;
      return next.snapshots[0]?.id ?? null;
    });
  }, []);

  const loadState = useCallback(
    async (alsoRefreshDiff = false) => {
      loadedOnceRef.current = true;
      setLoading(true);
      setLoadError(null);
      try {
        const raw = await bridge.callTool<Record<string, unknown>>('app_guard_get_state', {});
        const next = unwrapGuardState(raw);
        if (!next) {
          throw new Error('Unexpected response format from app_guard_get_state');
        }
        applyDashboardState(next);
        if (alsoRefreshDiff) {
          setDiffNonce((n) => n + 1);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(msg);
        notify(`Failed to load guard state: ${msg}`);
      } finally {
        setLoading(false);
      }
    },
    [bridge, applyDashboardState, notify],
  );

  // Fetch initial state once on first activation (no reconnect loop)
  useEffect(() => {
    if (active && !loadedOnceRef.current) {
      void loadState(false);
    }
  }, [active, loadState]);

  // React to incoming tool results targeting Guard
  useEffect(() => {
    if (!incomingEvent || incomingEvent === lastEventRef.current) return;
    const sc = incomingEvent.structuredContent;
    if (!sc || typeof sc !== 'object') return;

    const toolName = incomingEvent.toolName ?? '';
    const isGuardEvent =
      toolName.includes('guard') ||
      'policy' in sc ||
      (typeof sc.tab === 'string' && VALID_TABS.has(sc.tab as GuardTabKey));

    if (!isGuardEvent) return;
    lastEventRef.current = incomingEvent;

    if (typeof sc.tab === 'string' && VALID_TABS.has(sc.tab as GuardTabKey)) {
      setTab(sc.tab as GuardTabKey);
    }

    const hydrated = unwrapGuardState(sc);
    if (hydrated) {
      loadedOnceRef.current = true;
      applyDashboardState(hydrated);
      setDiffNonce((n) => n + 1);
    } else if (active) {
      void loadState(true);
    }
  }, [incomingEvent, active, applyDashboardState, loadState]);

  const hasSnapshots = (state?.snapshots.length ?? 0) > 0;

  // Fetch diff only when selected snapshot changes or after explicit refresh/restore
  useEffect(() => {
    if (!selectedId || !hasSnapshots) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    bridge
      .callTool<Record<string, unknown>>('app_guard_diff_snapshot', { snapshotId: selectedId })
      .then((raw) => {
        if (!cancelled) {
          setDiff(unwrapSnapshotDiff(raw));
        }
      })
      .catch(() => {
        if (!cancelled) setDiff(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, hasSnapshots, diffNonce, bridge]);

  const handleRestore = async (snapshotId: string) => {
    setBusy(true);
    try {
      const res = await bridge.callTool<{
        result?: { message?: string };
        state?: GuardDashboardState;
      }>('app_guard_restore_snapshot', { snapshotId });

      const nextState = unwrapGuardState(res);
      if (nextState) {
        applyDashboardState(nextState);
      } else {
        await loadState(false);
      }
      notify(res.result?.message ?? 'Snapshot restored');
      setDiffNonce((n) => n + 1);
    } catch (err) {
      notify(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenFile = async (filePath: string) => {
    const ok = await bridge.openFile(filePath);
    if (ok) {
      notify(`Opened ${filePath.split('/').pop() || filePath}`);
    } else {
      notify(`File path: ${filePath} (native aux-pane open available inside Antigravity)`);
    }
  };

  const handleUpdatePolicy = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await bridge.callTool<{ state?: GuardDashboardState }>(
        'app_guard_update_policy',
        patch,
      );
      const nextState = unwrapGuardState(res);
      if (nextState) {
        applyDashboardState(nextState);
      } else {
        await loadState(false);
      }
      notify('Guard policy updated (saved with 0600 permissions)');
    } catch (err) {
      notify(`Policy update failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSimulate = async (scenario: ThreatScenario) => {
    setBusy(true);
    try {
      const res = await bridge.callTool<{
        evaluation?: { decision: string; reason: string };
        state?: GuardDashboardState;
      }>('app_guard_simulate_threat', { scenario });

      const nextState = unwrapGuardState(res);
      if (nextState) {
        applyDashboardState(nextState);
      } else {
        await loadState(false);
      }
      if (res.evaluation) {
        notify(`[${res.evaluation.decision.toUpperCase()}] ${res.evaluation.reason}`);
      } else {
        notify('Simulated threat evaluated');
      }
    } catch (err) {
      notify(`Simulation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleScanWorkspace = async () => {
    setBusy(true);
    try {
      const res = await bridge.callTool<{ state?: GuardDashboardState }>(
        'app_guard_scan_workspace',
        {},
      );
      const nextState = unwrapGuardState(res);
      if (nextState) {
        applyDashboardState(nextState);
        const count = nextState.lastScan?.findings.length ?? 0;
        notify(
          count === 0
            ? 'Workspace clean: 0 hardcoded secrets found'
            : `Found ${count} potential secret(s)`,
        );
      } else {
        await loadState(false);
        notify('Workspace secret scan completed');
      }
    } catch (err) {
      notify(`Workspace scan failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <div className="mod-guard" data-theme={theme}>
        <div className="gd-loading-shell">
          {loadError ? (
            <div className="gd-error-box">
              <div className="gd-error-title">Unable to load Agy Guard</div>
              <div className="gd-muted">{loadError}</div>
              <button type="button" className="gd-btn gd-btn-primary" onClick={() => void loadState(true)}>
                Retry
              </button>
            </div>
          ) : (
            <div className="gd-muted">{loading ? 'Loading Agy Guard…' : 'Initializing Agy Guard…'}</div>
          )}
        </div>
      </div>
    );
  }

  const selectedSnap = state.snapshots.find((s) => s.id === selectedId) ?? state.snapshots[0] ?? null;

  return (
    <div className="mod-guard" data-theme={theme}>
      <header className="gd-topbar">
        <div className="gd-brand">
          <div className="gd-shield-badge">G</div>
          <div className="gd-brand-text">
            <div className="gd-brand-title">Agy Guard</div>
            <div className="gd-brand-sub">Local Security Guardrail &amp; Pre-Edit Snapshot Time Machine</div>
          </div>
        </div>
        <div className="gd-topbar-right">
          <span className={`gd-pill ${state.policy.enabled ? 'gd-pill-success' : 'gd-pill-danger'}`}>
            {state.policy.enabled ? '● Shield Active' : '○ Shield Paused'}
          </span>
          <span className="gd-pill gd-pill-accent">
            {state.mode === 'demo' ? 'DEMO MODE' : 'LIVE WORKSPACE'}
          </span>
          <button
            type="button"
            className="gd-btn"
            disabled={loading || busy}
            onClick={() => void loadState(true)}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <section className="gd-stats-strip">
        <div className="gd-stat-card">
          <div className="gd-stat-label">Time Machine Snapshots</div>
          <div className="gd-stat-val gd-val-success">{state.stats.totalSnapshots}</div>
        </div>
        <div className="gd-stat-card">
          <div className="gd-stat-label">Threats Blocked</div>
          <div className="gd-stat-val gd-val-danger">{state.stats.blockedCount}</div>
        </div>
        <div className="gd-stat-card">
          <div className="gd-stat-label">Secret Leaks Caught</div>
          <div className="gd-stat-val gd-val-warn">{state.stats.secretCatches}</div>
        </div>
        <div className="gd-stat-card">
          <div className="gd-stat-label">Files Restored</div>
          <div className="gd-stat-val gd-val-accent">{state.stats.restoredCount}</div>
        </div>
      </section>

      <nav className="gd-tabs" role="tablist" aria-label="Guard sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'snapshots'}
          className={`gd-tab-btn ${tab === 'snapshots' ? 'is-active' : ''}`}
          onClick={() => setTab('snapshots')}
        >
          Time Machine ({state.snapshots.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'audit'}
          className={`gd-tab-btn ${tab === 'audit' ? 'is-active' : ''}`}
          onClick={() => setTab('audit')}
        >
          Security Audit ({state.auditLog.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'policy'}
          className={`gd-tab-btn ${tab === 'policy' ? 'is-active' : ''}`}
          onClick={() => setTab('policy')}
        >
          Guard Policy
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'scanner'}
          className={`gd-tab-btn ${tab === 'scanner' ? 'is-active' : ''}`}
          onClick={() => setTab('scanner')}
        >
          Secret Scanner
        </button>
      </nav>

      <main className="gd-main-area">
        {tab === 'snapshots' && (
          <div className="gd-split-grid">
            <div className="gd-card gd-snap-list-card">
              <div className="gd-card-header">
                <span>Pre-Edit Checkpoints</span>
                <span className="gd-header-meta">{state.stats.trackedFiles} files</span>
              </div>
              <div className="gd-list-scroll">
                {state.snapshots.length === 0 ? (
                  <div className="gd-empty-box">
                    No snapshots yet. Every file edit is automatically snapshotted before mutation — zero Git
                    pollution.
                  </div>
                ) : (
                  state.snapshots.map((snap) => (
                    <button
                      type="button"
                      key={snap.id}
                      className={`gd-snap-item ${selectedSnap?.id === snap.id ? 'is-selected' : ''}`}
                      onClick={() => setSelectedId(snap.id)}
                    >
                      <div className="gd-mono gd-snap-path">{snap.relPath}</div>
                      <div className="gd-snap-row-meta">
                        <span>{snap.toolName}</span>
                        <span>{formatTime(snap.createdAt)}</span>
                      </div>
                      <div className="gd-snap-sub">
                        {snap.existed ? `${snap.lineCount} lines · ${snap.sizeBytes} B` : 'New file marker'}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="gd-card gd-diff-card">
              <div className="gd-card-header gd-diff-header">
                <div className="gd-diff-title-group">
                  <span className="gd-mono gd-diff-file">
                    {selectedSnap ? selectedSnap.relPath : 'Select a snapshot'}
                  </span>
                  {diff && (
                    <span className="gd-header-meta">
                      {diff.identical ? 'Identical to current file' : `+${diff.added} / -${diff.removed} vs snapshot`}
                    </span>
                  )}
                </div>
                {selectedSnap && (
                  <div className="gd-diff-actions">
                    <button
                      type="button"
                      className="gd-btn"
                      onClick={() => void handleOpenFile(selectedSnap.filePath)}
                    >
                      Open File
                    </button>
                    <button
                      type="button"
                      className="gd-btn gd-btn-primary"
                      disabled={busy || diff?.identical}
                      onClick={() => void handleRestore(selectedSnap.id)}
                    >
                      {diff?.identical ? 'Up to Date' : 'Restore Snapshot'}
                    </button>
                  </div>
                )}
              </div>
              <div className="gd-diff-box">
                {!diff ? (
                  <div className="gd-empty-box">Select a checkpoint to inspect diff.</div>
                ) : (
                  diff.hunks.map((line, idx) => (
                    <div key={idx} className={`gd-diff-line gd-diff-${line.type}`}>
                      <span className="gd-diff-ln">{line.oldLine ?? ''}</span>
                      <span className="gd-diff-ln">{line.newLine ?? ''}</span>
                      <span className="gd-diff-sign">
                        {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                      </span>
                      <span className="gd-diff-text">{line.text}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'audit' && (
          <div className="gd-stack">
            <div className="gd-sim-bar">
              <strong className="gd-sim-title">Dry-Run Threat Simulator:</strong>
              <button
                type="button"
                className="gd-btn gd-btn-danger"
                disabled={busy}
                onClick={() => void handleSimulate('dotenv_read')}
              >
                Test .env Read
              </button>
              <button
                type="button"
                className="gd-btn gd-btn-danger"
                disabled={busy}
                onClick={() => void handleSimulate('secret_write')}
              >
                Test Hardcoded API Key
              </button>
              <button
                type="button"
                className="gd-btn gd-btn-danger"
                disabled={busy}
                onClick={() => void handleSimulate('force_push')}
              >
                Test git push --force
              </button>
              <button
                type="button"
                className="gd-btn gd-btn-danger"
                disabled={busy}
                onClick={() => void handleSimulate('rm_rf')}
              >
                Test rm -rf /
              </button>
              <button
                type="button"
                className="gd-btn"
                disabled={busy}
                onClick={() => void handleSimulate('curl_pipe')}
              >
                Test curl | sh
              </button>
            </div>

            <div className="gd-card">
              <div className="gd-card-header">
                <span>Deterministic PreToolUse &amp; Snapshot Audit Stream</span>
                <span className="gd-header-meta">Last {state.auditLog.length} events</span>
              </div>
              <div className="gd-audit-list">
                {state.auditLog.length === 0 ? (
                  <div className="gd-empty-box">No security audit events recorded yet.</div>
                ) : (
                  state.auditLog.map((evt) => {
                    const pillClass =
                      evt.decision === 'deny'
                        ? 'gd-pill-danger'
                        : evt.decision === 'ask'
                          ? 'gd-pill-warn'
                          : evt.decision === 'restored'
                            ? 'gd-pill-accent'
                            : 'gd-pill-success';
                    return (
                      <div key={evt.id} className="gd-audit-row">
                        <span className={`gd-pill gd-pill-center ${pillClass}`}>
                          {evt.decision.toUpperCase()}
                        </span>
                        <span className="gd-mono gd-audit-tool">{evt.toolName}</span>
                        <div className="gd-audit-body">
                          <div className="gd-audit-summary">{evt.summary}</div>
                          <div className="gd-mono gd-audit-target">
                            {evt.target} {evt.ruleId ? `· ${evt.ruleId}` : ''}
                          </div>
                        </div>
                        <span className="gd-audit-time">{formatTime(evt.timestamp)}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'policy' && (
          <div className="gd-policy-grid">
            <div className="gd-policy-card">
              <div className="gd-policy-title">Master Guardrail Switch</div>
              <div className="gd-policy-desc">
                Deterministic PreToolUse evaluation runs locally in &lt;5ms with zero cloud calls.
              </div>
              <button
                type="button"
                className={`gd-btn ${state.policy.enabled ? 'gd-btn-primary' : ''}`}
                disabled={busy}
                onClick={() => void handleUpdatePolicy({ enabled: !state.policy.enabled })}
              >
                {state.policy.enabled ? 'Enabled — Click to Pause' : 'Paused — Click to Enable'}
              </button>
            </div>

            {(
              [
                [
                  'protectEnvAndKeys',
                  '.env, SSH & Cloud Credential Shield',
                  'Blocks reads/exfil of .env, *.pem, ~/.ssh, ~/.aws/credentials',
                ],
                [
                  'blockSecretWrites',
                  'Outgoing Secret-Leak Shield',
                  'Scans write_file/edit_file payloads for API keys, JWTs, private keys',
                ],
                [
                  'blockDestructiveCommands',
                  'Destructive Shell Command Shield',
                  'Blocks rm -rf /, git push --force, git reset --hard, DROP TABLE',
                ],
                [
                  'askOnNetworkPipes',
                  'Remote Pipe Execution Gate',
                  'Prompts or denies curl/wget piped directly into sh/bash',
                ],
              ] as const
            ).map(([field, title, desc]) => (
              <div className="gd-policy-card" key={field}>
                <div className="gd-policy-title">{title}</div>
                <div className="gd-policy-desc">{desc}</div>
                <select
                  className="gd-select-input"
                  value={state.policy[field]}
                  disabled={busy}
                  aria-label={title}
                  onChange={(e) => void handleUpdatePolicy({ [field]: e.target.value as GuardDecision })}
                >
                  <option value="deny">DENY (Hard Block)</option>
                  <option value="ask">ASK (Require Approval)</option>
                  <option value="allow">ALLOW (Log Only)</option>
                </select>
              </div>
            ))}

            <div className="gd-policy-card">
              <div className="gd-policy-title">Auto Pre-Edit Snapshot Time Machine</div>
              <div className="gd-policy-desc">
                SHA-256 deduplicated file backup before every mutating edit — zero Git stash/log pollution.
              </div>
              <button
                type="button"
                className={`gd-btn ${state.policy.autoSnapshotBeforeEdit ? 'gd-btn-primary' : ''}`}
                disabled={busy}
                onClick={() =>
                  void handleUpdatePolicy({
                    autoSnapshotBeforeEdit: !state.policy.autoSnapshotBeforeEdit,
                  })
                }
              >
                {state.policy.autoSnapshotBeforeEdit ? 'Auto-Snapshot ON' : 'Auto-Snapshot OFF'}
              </button>
            </div>

            <div className="gd-policy-card">
              <div className="gd-policy-title">Custom Protected Paths (one per line)</div>
              <textarea
                className="gd-text-input gd-mono"
                rows={3}
                value={customPathsText}
                placeholder={'prod-config/\nbilling-keys.json'}
                onChange={(e) => setCustomPathsText(e.target.value)}
              />
              <button
                type="button"
                className="gd-btn"
                disabled={busy}
                onClick={() =>
                  void handleUpdatePolicy({
                    customProtectedPaths: customPathsText
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              >
                Save Path Rules
              </button>
            </div>

            <div className="gd-policy-card">
              <div className="gd-policy-title">Custom Blocked Commands (one per line)</div>
              <textarea
                className="gd-text-input gd-mono"
                rows={3}
                value={customCmdsText}
                placeholder={'terraform destroy\nkubectl delete namespace'}
                onChange={(e) => setCustomCmdsText(e.target.value)}
              />
              <button
                type="button"
                className="gd-btn"
                disabled={busy}
                onClick={() =>
                  void handleUpdatePolicy({
                    customBlockedCommands: customCmdsText
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              >
                Save Command Rules
              </button>
            </div>
          </div>
        )}

        {tab === 'scanner' && (
          <div className="gd-card">
            <div className="gd-card-header">
              <span>Read-Only Workspace Secret Scanner (Masked Output Only)</span>
              <button
                type="button"
                className="gd-btn gd-btn-primary"
                disabled={busy}
                onClick={() => void handleScanWorkspace()}
              >
                {busy ? 'Scanning…' : 'Run Secret Scan'}
              </button>
            </div>
            <div className="gd-scanner-body">
              {!state.lastScan ? (
                <div className="gd-muted">
                  Click <strong>Run Secret Scan</strong> to audit workspace source files for accidentally hardcoded API
                  keys, JWTs, or private keys. Protected files like <code className="gd-mono">.env</code> are never
                  opened.
                </div>
              ) : (
                <div>
                  <div className="gd-scan-summary">
                    Scanned <strong>{state.lastScan.scannedFiles}</strong> files (skipped {state.lastScan.skippedFiles})
                    at {formatTime(state.lastScan.scannedAt)} —{' '}
                    <strong
                      className={
                        state.lastScan.findings.length === 0 ? 'gd-val-success' : 'gd-val-danger'
                      }
                    >
                      {state.lastScan.findings.length} finding(s)
                    </strong>
                  </div>
                  {state.lastScan.findings.length === 0 ? (
                    <div className="gd-pill gd-pill-success">
                      Clean — No hardcoded secrets detected in scanned source files.
                    </div>
                  ) : (
                    state.lastScan.findings.map((item, i) => (
                      <div key={`${item.relPath}-${item.finding.line}-${i}`} className="gd-audit-row">
                        <span
                          className={`gd-pill gd-pill-center ${
                            item.finding.severity === 'critical' ? 'gd-pill-danger' : 'gd-pill-warn'
                          }`}
                        >
                          {item.finding.severity.toUpperCase()}
                        </span>
                        <span className="gd-mono gd-audit-tool">
                          {item.relPath}:{item.finding.line}
                        </span>
                        <div className="gd-audit-body">
                          <strong>{item.finding.label}</strong> · masked:{' '}
                          <code className="gd-mono">{item.finding.preview}</code>
                        </div>
                        <button
                          type="button"
                          className="gd-btn"
                          onClick={() => void handleOpenFile(item.filePath)}
                        >
                          Open
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {localToast && <div className="gd-toast">{localToast}</div>}
    </div>
  );
};
