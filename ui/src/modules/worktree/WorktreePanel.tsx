import React, { useCallback, useEffect, useState } from 'react';
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

interface WorktreeEntry {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  detached?: boolean;
  bare?: boolean;
  locked?: boolean;
  lockReason?: string;
  prunable: boolean;
  pruneReason?: string;
  exists?: boolean;
  isDirty: boolean;
  changedFilesCount?: number;
  ahead: number;
  behind: number;
  isMerged: boolean;
}

interface WorktreeCounts {
  total: number;
  dirty: number;
  merged: number;
  prunable: number;
}

interface WorktreeInspectResult {
  mode: string;
  isGitRepo: boolean;
  repoRoot: string;
  currentBranch?: string;
  baseBranch?: string;
  worktreeConfigWarning: boolean;
  worktrees: WorktreeEntry[];
  counts: WorktreeCounts;
}

interface WorktreeIncludeEntry {
  path: string;
  sizeBytes: number;
}

interface WorktreeIncludeSkippedItem {
  entry: string;
  reason: string;
}

interface WorktreeIncludePreviewResult {
  mode: string;
  repoRoot: string;
  hasConfig: boolean;
  configPath: string;
  eligibleFiles: WorktreeIncludeEntry[];
  skippedSensitive: WorktreeIncludeSkippedItem[];
  skippedInvalid: WorktreeIncludeSkippedItem[];
  totalBytes: number;
  warning?: string;
}

interface CreateWorktreeResult {
  created: WorktreeEntry;
  carriedUncommitted: boolean;
  includedFiles?: string[];
  skippedSensitive?: string[];
  skippedInvalid?: string[];
  warning?: string;
  state: WorktreeInspectResult;
}

interface WorktreeDiffFile {
  status: string;
  path: string;
}

interface WorktreeDiffSummaryResult {
  worktreePath: string;
  branch: string | null;
  baseRef: string;
  statText: string;
  files: WorktreeDiffFile[];
  ahead: number;
  behind: number;
}

interface CleanupWorktreeResult {
  removedPath?: string;
  pruned: boolean;
  message: string;
  state: WorktreeInspectResult;
}

function getDiffStatusBadgeStyle(status: string): React.CSSProperties | undefined {
  const code = status.trim().charAt(0).toUpperCase();
  if (code === 'D') {
    return {
      background: 'var(--nov-danger-soft)',
      color: 'var(--nov-danger)',
      borderColor: 'var(--nov-danger)',
    };
  }
  if (code === 'A' || code === '?') {
    return {
      background: 'var(--nov-success-soft)',
      color: 'var(--nov-success)',
      borderColor: 'var(--nov-success)',
    };
  }
  if (code === 'M' || code === 'R') {
    return {
      background: 'var(--nov-warn-soft)',
      color: 'var(--nov-warn)',
      borderColor: 'var(--nov-warn)',
    };
  }
  return undefined;
}

export const WorktreePanel: React.FC<NovModulePanelProps> = ({
  bridge,
  active,
  onNotify,
  incomingEvent,
  onNavigateModule,
}) => {
  const { dict, t } = useNovI18n();
  const wDict = dict.panels.worktree;

  const [state, setState] = useState<WorktreeInspectResult | null>(null);
  const [includePreview, setIncludePreview] = useState<WorktreeIncludePreviewResult | null>(null);
  const [branch, setBranch] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [carryUncommitted, setCarryUncommitted] = useState(false);
  const [applyInclude, setApplyInclude] = useState(true);
  const [createWarning, setCreateWarning] = useState<string | null>(null);
  const [lastIncludeNote, setLastIncludeNote] = useState<string | null>(null);

  const [diffSummary, setDiffSummary] = useState<WorktreeDiffSummaryResult | null>(null);
  const [confirmForcePath, setConfirmForcePath] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadIncludePreview = useCallback(async () => {
    try {
      const res = await bridge.callTool<WorktreeIncludePreviewResult>(
        'app_worktree_preview_include',
        {},
      );
      setIncludePreview(res);
    } catch {
      // Optional read-only preview; never block main worktree listing
    }
  }, [bridge]);

  const loadList = useCallback(async () => {
    try {
      const res = await bridge.callTool<WorktreeInspectResult>('app_worktree_list', {});
      setState(res);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    }
  }, [bridge, onNotify]);

  useEffect(() => {
    if (active) {
      void loadList();
      void loadIncludePreview();
    }
  }, [active, loadList, loadIncludePreview]);

  useEffect(() => {
    if (!active || !incomingEvent) return;
    const tool = incomingEvent.toolName ?? '';
    const mod = incomingEvent.structuredContent?.novModule;
    if (tool.startsWith('worktree_') || tool.startsWith('app_worktree_') || mod === 'worktree') {
      void loadList();
      void loadIncludePreview();
    }
  }, [active, incomingEvent, loadList, loadIncludePreview]);

  const handleCreate = async () => {
    const cleanBranch = branch.trim();
    if (!cleanBranch || busyAction) return;
    setBusyAction('create');
    setCreateWarning(null);
    setLastIncludeNote(null);
    try {
      const cleanBase = baseRef.trim();
      const res = await bridge.callTool<CreateWorktreeResult>('app_worktree_create', {
        branch: cleanBranch,
        ...(cleanBase ? { baseRef: cleanBase } : {}),
        carryUncommitted,
        applyInclude,
      });
      if (res.state) {
        setState(res.state);
      } else {
        await loadList();
      }
      setBranch('');
      const copiedCount = Array.isArray(res.includedFiles) ? res.includedFiles.length : 0;
      const blockedCount = Array.isArray(res.skippedSensitive) ? res.skippedSensitive.length : 0;
      if (copiedCount > 0 || blockedCount > 0) {
        setLastIncludeNote(
          `.worktreeinclude: copied ${copiedCount} file(s)${blockedCount > 0 ? `, blocked ${blockedCount} sensitive path(s)` : ''}.`,
        );
      }
      if (res.warning) {
        setCreateWarning(res.warning);
        onNotify?.(res.warning);
      } else {
        onNotify?.(`${wDict.createBtn}: ${res.created?.branch ?? cleanBranch}`);
      }
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handlePrune = async () => {
    if (busyAction) return;
    setBusyAction('prune');
    try {
      const res = await bridge.callTool<CleanupWorktreeResult>('app_worktree_cleanup', {
        pruneOnly: true,
      });
      if (res.state) {
        setState(res.state);
      } else {
        await loadList();
      }
      onNotify?.(res.message || wDict.pruneBtn);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleInspectDiff = async (worktreePath: string) => {
    if (busyAction) return;
    setBusyAction(`diff:${worktreePath}`);
    try {
      const res = await bridge.callTool<WorktreeDiffSummaryResult>('app_worktree_diff_summary', {
        worktreePath,
      });
      setDiffSummary(res);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemove = async (wt: WorktreeEntry, force: boolean) => {
    if (wt.isMain || busyAction) return;
    if (wt.isDirty && !force) {
      setConfirmForcePath(wt.path);
      return;
    }
    setBusyAction(`remove:${wt.path}`);
    try {
      const res = await bridge.callTool<CleanupWorktreeResult>('app_worktree_cleanup', {
        worktreePath: wt.path,
        force,
      });
      if (res.state) {
        setState(res.state);
      } else {
        await loadList();
      }
      setConfirmForcePath((prev) => (prev === wt.path ? null : prev));
      setDiffSummary((prev) => (prev?.worktreePath === wt.path ? null : prev));
      onNotify?.(res.message || wDict.removeBtn);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const isBusy = busyAction !== null;
  const counts = state?.counts ?? { total: 0, dirty: 0, merged: 0, prunable: 0 };
  const worktrees = Array.isArray(state?.worktrees) ? state.worktrees : [];

  return (
    <div className="nov-p-page">
      <section className="nov-p-card">
        <div className="nov-p-row">
          <div>
            <h2 className="nov-hero-title">{wDict.title}</h2>
            <p className="nov-hero-sub">{wDict.subtitle}</p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            <button
              type="button"
              className="nov-p-btn"
              disabled={isBusy}
              onClick={() => {
                void loadList();
                void loadIncludePreview();
              }}
            >
              {dict.common.refresh}
            </button>
            <button
              type="button"
              className="nov-p-btn"
              disabled={isBusy || state?.isGitRepo === false}
              onClick={() => void handlePrune()}
            >
              {busyAction === 'prune' ? dict.common.loading : wDict.pruneBtn}
            </button>
          </div>
        </div>

        {state?.isGitRepo && (state.currentBranch || state.repoRoot) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
            {state.currentBranch && (
              <span className="nov-badge is-accent">{state.currentBranch}</span>
            )}
            {state.repoRoot && (
              <code
                style={{
                  fontSize: '11.5px',
                  color: 'var(--nov-text-2)',
                  fontFamily: 'var(--nov-font-mono)',
                }}
              >
                {state.repoRoot}
              </code>
            )}
          </div>
        )}

        <div className="nov-p-stat-grid">
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{wDict.title}</div>
            <div className="nov-p-stat-val">{counts.total}</div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{wDict.dirtyBadge}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-warn)' }}>
              {counts.dirty}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{wDict.mergedBadge}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-success)' }}>
              {counts.merged}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{wDict.prunableBadge}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-danger)' }}>
              {counts.prunable}
            </div>
          </div>
        </div>

        {state?.worktreeConfigWarning && (
          <div
            className="nov-p-banner"
            style={{
              background: 'var(--nov-warn-soft)',
              borderColor: 'var(--nov-warn)',
              color: 'var(--nov-text-0)',
            }}
          >
            <strong style={{ color: 'var(--nov-warn)' }}>{wDict.configWarning}</strong>
          </div>
        )}
      </section>

      {state && !state.isGitRepo ? (
        <section className="nov-p-card">
          <div
            className="nov-p-banner"
            style={{
              background: 'var(--nov-warn-soft)',
              borderColor: 'var(--nov-warn)',
            }}
          >
            {wDict.notGitRepo}
          </div>
        </section>
      ) : (
        <>
          <section className="nov-p-card">
            <h3 className="nov-card-title">{wDict.createTitle}</h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '8px',
              }}
            >
              <input
                className="nov-p-input"
                style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '12px' }}
                value={branch}
                placeholder={wDict.branchPlaceholder}
                disabled={isBusy}
                onChange={(e) => setBranch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleCreate();
                  }
                }}
              />
              <input
                className="nov-p-input"
                style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '12px' }}
                value={baseRef}
                placeholder={wDict.baseRefPlaceholder}
                disabled={isBusy}
                onChange={(e) => setBaseRef(e.target.value)}
              />
            </div>

            <div className="nov-p-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={carryUncommitted}
                    className="nov-switch"
                    disabled={isBusy}
                    onClick={() => setCarryUncommitted((prev) => !prev)}
                  >
                    <span className="nov-switch-thumb" />
                  </button>
                  <span style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                    {wDict.carryUncommitted}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={applyInclude}
                    className="nov-switch"
                    disabled={isBusy}
                    onClick={() => setApplyInclude((prev) => !prev)}
                  >
                    <span className="nov-switch-thumb" />
                  </button>
                  <span style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                    Apply <code>.worktreeinclude</code> whitelist
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="nov-p-btn is-primary"
                disabled={isBusy || !branch.trim()}
                onClick={() => void handleCreate()}
              >
                {busyAction === 'create' ? dict.common.loading : wDict.createBtn}
              </button>
            </div>

            {includePreview && includePreview.hasConfig && (
              <div
                className="nov-p-item"
                style={{
                  background: 'var(--nov-bg-0)',
                  gap: '8px',
                }}
              >
                <div className="nov-p-row">
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                    <strong style={{ fontSize: '12px' }}>
                      <code>.worktreeinclude</code> Preview
                    </strong>
                    <span className="nov-badge is-offline">
                      {includePreview.eligibleFiles.length} eligible
                    </span>
                    {includePreview.skippedSensitive.length > 0 && (
                      <span
                        className="nov-badge"
                        style={{
                          background: 'var(--nov-danger-soft)',
                          color: 'var(--nov-danger)',
                          borderColor: 'var(--nov-danger)',
                        }}
                      >
                        {includePreview.skippedSensitive.length} sensitive blocked
                      </span>
                    )}
                    {includePreview.skippedInvalid.length > 0 && (
                      <span className="nov-badge is-network">
                        {includePreview.skippedInvalid.length} invalid skipped
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--nov-text-2)' }}>
                    {(includePreview.totalBytes / 1024).toFixed(1)} KiB
                  </span>
                </div>

                {includePreview.warning && (
                  <div style={{ fontSize: '11.5px', color: 'var(--nov-danger)' }}>
                    {includePreview.warning}
                  </div>
                )}

                {includePreview.eligibleFiles.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {includePreview.eligibleFiles.map((item) => (
                      <code
                        key={item.path}
                        className="nov-badge is-offline"
                        style={{ fontFamily: 'var(--nov-font-mono)' }}
                      >
                        {item.path}
                      </code>
                    ))}
                  </div>
                )}

                {includePreview.skippedSensitive.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11.5px', color: 'var(--nov-danger)', fontWeight: 600 }}>
                      Blocked (secret policy):
                    </span>
                    {includePreview.skippedSensitive.map((item, idx) => (
                      <code
                        key={`${item.entry}:${idx}`}
                        className="nov-badge"
                        title={item.reason}
                        style={{
                          fontFamily: 'var(--nov-font-mono)',
                          background: 'var(--nov-danger-soft)',
                          color: 'var(--nov-danger)',
                          borderColor: 'var(--nov-danger)',
                        }}
                      >
                        ⚠ {item.entry}
                      </code>
                    ))}
                  </div>
                )}

                {includePreview.skippedInvalid.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11.5px', color: 'var(--nov-warn)' }}>
                      Skipped (invalid):
                    </span>
                    {includePreview.skippedInvalid.map((item, idx) => (
                      <code
                        key={`${item.entry}:${idx}`}
                        className="nov-badge is-network"
                        title={item.reason}
                        style={{ fontFamily: 'var(--nov-font-mono)' }}
                      >
                        {item.entry}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            )}

            {lastIncludeNote && (
              <div
                className="nov-p-banner"
                style={{
                  background: 'var(--nov-success-soft)',
                  borderColor: 'var(--nov-success)',
                  color: 'var(--nov-text-0)',
                }}
              >
                {lastIncludeNote}
              </div>
            )}

            {createWarning && (
              <div
                className="nov-p-banner"
                style={{
                  background: 'var(--nov-warn-soft)',
                  borderColor: 'var(--nov-warn)',
                }}
              >
                {createWarning}
              </div>
            )}
          </section>

          <section className="nov-p-card">
            {worktrees.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--nov-text-2)' }}>{wDict.emptyWorktrees}</p>
            ) : (
              <div className="nov-p-list">
                {worktrees.map((wt) => {
                  const isConfirmingForce = confirmForcePath === wt.path;
                  const isDiffSelected = diffSummary?.worktreePath === wt.path;
                  const diffLoading = busyAction === `diff:${wt.path}`;
                  const removeLoading = busyAction === `remove:${wt.path}`;

                  return (
                    <div
                      key={wt.path}
                      className="nov-p-item"
                      style={
                        isDiffSelected
                          ? { borderColor: 'var(--nov-accent)' }
                          : undefined
                      }
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
                          <strong>{wt.branch ?? '(HEAD)'}</strong>
                          {wt.head && (
                            <code
                              style={{
                                fontSize: '11px',
                                color: 'var(--nov-text-2)',
                                fontFamily: 'var(--nov-font-mono)',
                              }}
                            >
                              {wt.head.slice(0, 8)}
                            </code>
                          )}
                          {wt.isMain && (
                            <span className="nov-badge is-accent">{wDict.mainBadge}</span>
                          )}
                          {wt.isDirty && (
                            <span className="nov-badge is-network">
                              {wDict.dirtyBadge}
                              {typeof wt.changedFilesCount === 'number' && wt.changedFilesCount > 0
                                ? ` (${wt.changedFilesCount})`
                                : ''}
                            </span>
                          )}
                          {wt.isMerged && !wt.isMain && (
                            <span className="nov-badge is-offline">{wDict.mergedBadge}</span>
                          )}
                          {wt.prunable && (
                            <span
                              className="nov-badge"
                              style={{
                                background: 'var(--nov-danger-soft)',
                                color: 'var(--nov-danger)',
                                borderColor: 'var(--nov-danger)',
                              }}
                            >
                              {wDict.prunableBadge}
                            </span>
                          )}
                          {(!wt.isMain || wt.ahead > 0 || wt.behind > 0) && (
                            <span className="nov-badge">
                              {t(wDict.aheadBehind, {
                                ahead: wt.ahead ?? 0,
                                behind: wt.behind ?? 0,
                              })}
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          <button
                            type="button"
                            className={`nov-p-btn ${isDiffSelected ? 'is-primary' : ''}`}
                            disabled={isBusy}
                            onClick={() => void handleInspectDiff(wt.path)}
                          >
                            {diffLoading ? dict.common.loading : wDict.diffBtn}
                          </button>

                          {!wt.isMain && (
                            <>
                              <button
                                type="button"
                                className="nov-p-btn"
                                disabled={isBusy}
                                title={`${dict.modules.review.shortLabel}: ${wt.branch ?? wt.path}`}
                                onClick={() =>
                                  onNavigateModule?.('review', {
                                    worktreePath: wt.path,
                                    branch: wt.branch ?? undefined,
                                  })
                                }
                              >
                                {dict.modules.review.shortLabel}
                              </button>
                              <button
                                type="button"
                                className="nov-p-btn"
                                disabled={isBusy}
                                title={`${dict.modules.verify.shortLabel}: ${wt.branch ?? wt.path}`}
                                onClick={() =>
                                  onNavigateModule?.('verify', {
                                    worktreePath: wt.path,
                                    branch: wt.branch ?? undefined,
                                  })
                                }
                              >
                                {dict.modules.verify.shortLabel}
                              </button>
                            </>
                          )}

                          {!wt.isMain && !isConfirmingForce && (
                            <button
                              type="button"
                              className="nov-p-btn is-danger"
                              disabled={isBusy}
                              onClick={() => void handleRemove(wt, false)}
                            >
                              {removeLoading ? dict.common.loading : wDict.removeBtn}
                            </button>
                          )}
                        </div>
                      </div>

                      <div
                        style={{
                          fontSize: '11.5px',
                          color: 'var(--nov-text-2)',
                          fontFamily: 'var(--nov-font-mono)',
                          wordBreak: 'break-all',
                        }}
                      >
                        {wt.path}
                        {wt.pruneReason ? ` · ${wt.pruneReason}` : ''}
                        {wt.lockReason ? ` · ${wt.lockReason}` : ''}
                      </div>

                      {!wt.isMain && isConfirmingForce && (
                        <div
                          className="nov-p-row"
                          style={{
                            padding: '8px 10px',
                            borderRadius: '8px',
                            background: 'var(--nov-danger-soft)',
                            border: '1px solid var(--nov-danger)',
                          }}
                        >
                          <span style={{ fontSize: '12px', color: 'var(--nov-danger)' }}>
                            {wDict.dirtyBadge}
                          </span>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              type="button"
                              className="nov-p-btn"
                              disabled={isBusy}
                              onClick={() => setConfirmForcePath(null)}
                            >
                              {dict.common.clear}
                            </button>
                            <button
                              type="button"
                              className="nov-p-btn is-danger"
                              disabled={isBusy}
                              onClick={() => void handleRemove(wt, true)}
                            >
                              {removeLoading ? dict.common.loading : wDict.forceRemoveBtn}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {diffSummary && (
            <section className="nov-p-card">
              <div className="nov-p-row">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                  <h3 className="nov-card-title">{wDict.diffTitle}</h3>
                  <span className="nov-badge is-accent">
                    {diffSummary.branch ?? '(HEAD)'} vs {diffSummary.baseRef}
                  </span>
                  <span className="nov-badge">
                    {t(wDict.aheadBehind, {
                      ahead: diffSummary.ahead ?? 0,
                      behind: diffSummary.behind ?? 0,
                    })}
                  </span>
                </div>
                <button
                  type="button"
                  className="nov-p-btn"
                  onClick={() => setDiffSummary(null)}
                >
                  {dict.common.clear}
                </button>
              </div>

              <div
                style={{
                  fontSize: '11.5px',
                  color: 'var(--nov-text-2)',
                  fontFamily: 'var(--nov-font-mono)',
                  wordBreak: 'break-all',
                }}
              >
                {diffSummary.worktreePath}
              </div>

              {diffSummary.files.length > 0 && (
                <div className="nov-p-list">
                  {diffSummary.files.map((f, idx) => (
                    <div
                      key={`${f.status}:${f.path}:${idx}`}
                      className="nov-p-row"
                      style={{
                        fontSize: '12px',
                        fontFamily: 'var(--nov-font-mono)',
                        justifyContent: 'flex-start',
                        gap: '8px',
                      }}
                    >
                      <span
                        className="nov-badge"
                        style={getDiffStatusBadgeStyle(f.status)}
                      >
                        {f.status}
                      </span>
                      <span style={{ color: 'var(--nov-text-0)', wordBreak: 'break-all' }}>
                        {f.path}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {diffSummary.statText ? (
                <pre
                  className="nov-p-pre"
                  style={{ maxHeight: '260px', overflowY: 'auto' }}
                >
                  {diffSummary.statText}
                </pre>
              ) : (
                diffSummary.files.length === 0 && (
                  <p style={{ margin: 0, color: 'var(--nov-text-2)' }}>{dict.common.empty}</p>
                )
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
};
