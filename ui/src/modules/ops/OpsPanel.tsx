import React, { useCallback, useEffect, useState } from 'react';
import type { NovBridge } from '../../bridge.js';
import { useNovI18n } from '../../i18n/index.js';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
}

interface PromptTemplate {
  id: string;
  title: string;
  category: 'review' | 'debug' | 'release' | 'security' | 'handoff' | 'custom';
  description?: string;
  body: string;
  variables: Array<{ name: string; defaultValue?: string }>;
  builtIn: boolean;
}

interface RuleBloatView {
  status: 'ok' | 'warn' | 'critical';
  singleFileLimitBytes: number;
  aggregateTokenLimit: number;
  largestFileBytes: number;
  largestFilePath?: string;
  totalRuleBytes: number;
  totalRuleTokens: number;
  offendingFiles: Array<{ path: string; bytes: number; estimatedTokens: number; reason: string }>;
}

interface ToolBudgetView {
  agyNovTools: number;
  externalServersCount: number;
  estimatedExternalTools: number;
  estimatedTotalTools: number;
  hardLimit: number;
  usagePercent: number;
  status: 'ok' | 'warn' | 'critical';
}

interface McpHealthFindingView {
  severity: 'info' | 'warn' | 'error';
  serverName?: string;
  file: string;
  message: string;
}

interface TeamPresetView {
  found: boolean;
  filePath: string;
  valid: boolean;
  preset?: string;
  enableModules: string[];
  verifyCommands: Array<{ label: string; executable: string; args: string[] }>;
  specTemplatesCount: number;
  warnings: string[];
  errors: string[];
}

interface CrossClientFindingView {
  severity: 'info' | 'warn' | 'error';
  code: string;
  client: 'antigravity' | 'claude' | 'cursor' | 'codex' | 'shared';
  file: string;
  message: string;
  suggestion?: string;
}

interface OpsAudit {
  workspaceName: string;
  healthScore: number;
  summary: { assetCount: number; totalBytes: number; totalEstimatedTokens: number };
  assets: Array<{ kind: string; relPath: string; bytes: number; lineCount: number; estimatedTokens: number }>;
  storage: {
    rootDataDirExists: boolean;
    totalFiles: number;
    totalBytes: number;
    modules: Array<{ moduleId: string; files: number; bytes: number }>;
  };
  recommendations: Array<{ level: string; title: string; detail: string }>;
  ruleBloat?: RuleBloatView;
  toolBudget?: ToolBudgetView;
  mcpHealthFindings?: McpHealthFindingView[];
  teamPreset?: TeamPresetView;
  crossClientFindings?: CrossClientFindingView[];
}

function getStatusColor(status: 'ok' | 'warn' | 'critical' | 'info' | 'error'): string {
  if (status === 'critical' || status === 'error') return 'var(--nov-danger)';
  if (status === 'warn') return 'var(--nov-warn)';
  if (status === 'info') return 'var(--nov-accent)';
  return 'var(--nov-success)';
}

function getStatusSoftBg(status: 'ok' | 'warn' | 'critical' | 'info' | 'error'): string {
  if (status === 'critical' || status === 'error') return 'var(--nov-danger-soft)';
  if (status === 'warn') return 'var(--nov-warn-soft)';
  if (status === 'info') return 'var(--nov-accent-soft)';
  return 'var(--nov-success-soft)';
}

interface OpsState {
  mode: string;
  prompts: PromptTemplate[];
  audit: OpsAudit;
}

export const OpsPanel: React.FC<NovModulePanelProps> = ({ bridge, active, onNotify }) => {
  const { dict } = useNovI18n();
  const [tab, setTab] = useState<'prompts' | 'audit'>('prompts');
  const [state, setState] = useState<OpsState | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [rendered, setRendered] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftCategory, setDraftCategory] = useState<PromptTemplate['category']>('custom');
  const [draftBody, setDraftBody] = useState('');
  const [busy, setBusy] = useState(false);

  const loadState = useCallback(async () => {
    try {
      const res = await bridge.callTool<OpsState>('app_ops_get_state', {});
      setState(res);
      setSelectedId((prev) => prev || res.prompts[0]?.id || '');
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    }
  }, [bridge, onNotify]);

  useEffect(() => {
    if (active) void loadState();
  }, [active, loadState]);

  const selected = state?.prompts.find((p) => p.id === selectedId) ?? state?.prompts[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    const defaults: Record<string, string> = {};
    for (const v of selected.variables) {
      defaults[v.name] = v.defaultValue ?? '';
    }
    setVarValues(defaults);
    setRendered('');
  }, [selected?.id]);

  const handleRender = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await bridge.callTool<{ rendered: string }>('app_ops_render_prompt', {
        id: selected.id,
        variables: varValues,
      });
      setRendered(res.rendered ?? '');
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSavePrompt = async () => {
    if (draftTitle.trim().length < 2 || draftBody.trim().length < 4) return;
    setBusy(true);
    try {
      const res = await bridge.callTool<{ saved: PromptTemplate; state: OpsState }>(
        'app_ops_save_prompt',
        { title: draftTitle.trim(), category: draftCategory, body: draftBody.trim() },
      );
      setState(res.state);
      setSelectedId(res.saved.id);
      setCreating(false);
      setDraftTitle('');
      setDraftBody('');
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePrompt = async (id: string) => {
    setBusy(true);
    try {
      const res = await bridge.callTool<{ state: OpsState }>('app_ops_delete_prompt', { id });
      setState(res.state);
      setSelectedId(res.state.prompts[0]?.id ?? '');
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleReaudit = async () => {
    setBusy(true);
    try {
      const res = await bridge.callTool<{ state: OpsState }>('app_ops_audit_workspace', {});
      setState(res.state);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const opsDictExt = dict.ops as Record<string, string>;
  const ruleBloatTitle = opsDictExt.ruleBloatTitle ?? 'Rule Bloat Guard (24 KB / 20K Tokens)';
  const toolBudgetTitle = opsDictExt.toolBudgetTitle ?? '100-Tool Budget Meter';
  const mcpHealthTitle = opsDictExt.mcpHealthTitle ?? 'MCP Static Health Check';
  const teamPresetTitle = dict.ops.teamPresetTitle ?? 'Team Preset (.agy-nov.json)';
  const teamPresetMissing =
    dict.ops.teamPresetMissing ?? 'No .agy-nov.json found (optional, strictly read-only)';
  const teamPresetValid = dict.ops.teamPresetValid ?? 'Valid';
  const teamPresetWarnings = dict.ops.teamPresetWarnings ?? 'Warnings';
  const crossClientTitle =
    dict.ops.crossClientTitle ?? 'Cross-Client Compatibility & Pitfall Guard';
  const crossClientEmpty =
    dict.ops.crossClientEmpty ?? 'No cross-client config pitfalls detected.';

  return (
    <div className="nov-p-page">
      <section className="nov-p-card">
        <div className="nov-p-row">
          <div>
            <h2 className="nov-hero-title">{dict.ops.title}</h2>
            <p className="nov-hero-sub">{dict.ops.subtitle}</p>
          </div>
          <div className="nov-p-tabs">
            <button
              type="button"
              className={`nov-preset-btn ${tab === 'prompts' ? 'is-active' : ''}`}
              onClick={() => setTab('prompts')}
            >
              {dict.ops.tabPrompts} ({state?.prompts.length ?? 0})
            </button>
            <button
              type="button"
              className={`nov-preset-btn ${tab === 'audit' ? 'is-active' : ''}`}
              onClick={() => setTab('audit')}
            >
              {dict.ops.tabAudit}
            </button>
          </div>
        </div>
      </section>

      {tab === 'prompts' && (
        <>
          <section className="nov-p-card">
            <div className="nov-p-row">
              <div className="nov-p-tabs">
                {(state?.prompts ?? []).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`nov-preset-btn ${selected?.id === p.id ? 'is-active' : ''}`}
                    onClick={() => {
                      setCreating(false);
                      setSelectedId(p.id);
                    }}
                  >
                    {p.title}
                  </button>
                ))}
              </div>
              <button type="button" className="nov-p-btn" onClick={() => setCreating((v) => !v)}>
                + {dict.ops.newPrompt}
              </button>
            </div>

            {creating ? (
              <div className="nov-p-list">
                <input
                  className="nov-p-input"
                  placeholder={dict.ops.promptTitle}
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                />
                <select
                  className="nov-p-select"
                  value={draftCategory}
                  onChange={(e) => setDraftCategory(e.target.value as PromptTemplate['category'])}
                >
                  {(['custom', 'review', 'debug', 'release', 'security', 'handoff'] as const).map(
                    (c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ),
                  )}
                </select>
                <textarea
                  className="nov-p-textarea"
                  placeholder={dict.ops.promptBody}
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                />
                <div>
                  <button
                    type="button"
                    className="nov-p-btn is-primary"
                    disabled={busy}
                    onClick={() => void handleSavePrompt()}
                  >
                    {dict.common.save}
                  </button>
                </div>
              </div>
            ) : (
              selected && (
                <div className="nov-p-list">
                  <div className="nov-p-row">
                    <strong>{selected.title}</strong>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <span className="nov-badge">{selected.category}</span>
                      {!selected.builtIn && (
                        <button
                          type="button"
                          className="nov-p-btn is-danger"
                          disabled={busy}
                          onClick={() => void handleDeletePrompt(selected.id)}
                        >
                          {dict.common.delete}
                        </button>
                      )}
                    </div>
                  </div>
                  <pre className="nov-p-pre">{selected.body}</pre>

                  {selected.variables.length > 0 && (
                    <div className="nov-p-list">
                      <strong style={{ fontSize: '12px' }}>{dict.ops.variablesTitle}</strong>
                      {selected.variables.map((v) => (
                        <div key={v.name} className="nov-p-row">
                          <code style={{ minWidth: '130px' }}>{`{{${v.name}}}`}</code>
                          <input
                            className="nov-p-input"
                            style={{ flex: 1 }}
                            value={varValues[v.name] ?? ''}
                            onChange={(e) =>
                              setVarValues((prev) => ({ ...prev, [v.name]: e.target.value }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="nov-p-row">
                    <button
                      type="button"
                      className="nov-p-btn is-primary"
                      disabled={busy}
                      onClick={() => void handleRender()}
                    >
                      {dict.ops.renderBtn}
                    </button>
                    {rendered && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="nov-p-btn"
                          onClick={() => {
                            void navigator.clipboard?.writeText(rendered);
                            onNotify?.(dict.common.copied);
                          }}
                        >
                          {dict.ops.copyRendered}
                        </button>
                        <button
                          type="button"
                          className="nov-p-btn is-primary"
                          onClick={() => {
                            void bridge.sendMessage(rendered);
                            onNotify?.(dict.ops.sendToAgent);
                          }}
                        >
                          {dict.ops.sendToAgent}
                        </button>
                      </div>
                    )}
                  </div>

                  {rendered && (
                    <>
                      <strong style={{ fontSize: '12px' }}>{dict.ops.renderedPreview}</strong>
                      <pre className="nov-p-pre">{rendered}</pre>
                    </>
                  )}
                </div>
              )
            )}
          </section>
        </>
      )}

      {tab === 'audit' && state?.audit && (
        <section className="nov-p-card">
          <div className="nov-p-row">
            <div className="nov-p-banner" style={{ flex: 1 }}>
              {dict.ops.auditCleanNote}
            </div>
            <button
              type="button"
              className="nov-p-btn is-primary"
              disabled={busy}
              onClick={() => void handleReaudit()}
            >
              {dict.ops.auditRefresh}
            </button>
          </div>

          {(state.audit.ruleBloat || state.audit.toolBudget) && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '10px',
              }}
            >
              {state.audit.ruleBloat && (() => {
                const rb = state.audit.ruleBloat;
                const singlePct = Math.min(
                  100,
                  rb.singleFileLimitBytes > 0
                    ? Math.round((rb.largestFileBytes / rb.singleFileLimitBytes) * 100)
                    : 0,
                );
                const aggPct = Math.min(
                  100,
                  rb.aggregateTokenLimit > 0
                    ? Math.round((rb.totalRuleTokens / rb.aggregateTokenLimit) * 100)
                    : 0,
                );
                const rbColor = getStatusColor(rb.status);
                const rbBg = getStatusSoftBg(rb.status);
                return (
                  <div className="nov-p-item" style={{ gap: '8px' }}>
                    <div className="nov-p-row">
                      <strong style={{ fontSize: '12.5px' }}>{ruleBloatTitle}</strong>
                      <span
                        className="nov-badge"
                        style={{ color: rbColor, background: rbBg, borderColor: rbColor }}
                      >
                        {rb.status.toUpperCase()}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div className="nov-p-row" style={{ fontSize: '11.5px', color: 'var(--nov-text-1)' }}>
                        <span>
                          Largest file{rb.largestFilePath ? `: ${rb.largestFilePath}` : ''}
                        </span>
                        <span style={{ fontFamily: 'var(--nov-font-mono)' }}>
                          {(rb.largestFileBytes / 1024).toFixed(1)} / {(rb.singleFileLimitBytes / 1024).toFixed(0)} KB
                        </span>
                      </div>
                      <div
                        style={{
                          height: '7px',
                          borderRadius: '999px',
                          background: 'var(--nov-bg-0)',
                          border: '1px solid var(--nov-border)',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${singlePct}%`,
                            height: '100%',
                            background:
                              rb.largestFileBytes > rb.singleFileLimitBytes
                                ? 'var(--nov-danger)'
                                : rb.largestFileBytes >= rb.singleFileLimitBytes * 0.8
                                  ? 'var(--nov-warn)'
                                  : 'var(--nov-success)',
                            transition: 'width 180ms ease',
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div className="nov-p-row" style={{ fontSize: '11.5px', color: 'var(--nov-text-1)' }}>
                        <span>Aggregate rule tokens</span>
                        <span style={{ fontFamily: 'var(--nov-font-mono)' }}>
                          ~{rb.totalRuleTokens.toLocaleString()} / {rb.aggregateTokenLimit.toLocaleString()}
                        </span>
                      </div>
                      <div
                        style={{
                          height: '7px',
                          borderRadius: '999px',
                          background: 'var(--nov-bg-0)',
                          border: '1px solid var(--nov-border)',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${aggPct}%`,
                            height: '100%',
                            background:
                              rb.totalRuleTokens > rb.aggregateTokenLimit
                                ? 'var(--nov-danger)'
                                : rb.totalRuleTokens >= rb.aggregateTokenLimit * 0.8
                                  ? 'var(--nov-warn)'
                                  : 'var(--nov-success)',
                            transition: 'width 180ms ease',
                          }}
                        />
                      </div>
                    </div>

                    {rb.offendingFiles.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
                        {rb.offendingFiles.slice(0, 4).map((f) => (
                          <div
                            key={f.path}
                            style={{ fontSize: '11px', color: rbColor, fontFamily: 'var(--nov-font-mono)' }}
                          >
                            • {f.path} ({(f.bytes / 1024).toFixed(1)} KB, ~{f.estimatedTokens} tok)
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {state.audit.toolBudget && (() => {
                const tb = state.audit.toolBudget;
                const barWidth = Math.min(100, Math.max(0, tb.usagePercent));
                const tbColor = getStatusColor(tb.status);
                const tbBg = getStatusSoftBg(tb.status);
                return (
                  <div className="nov-p-item" style={{ gap: '8px' }}>
                    <div className="nov-p-row">
                      <strong style={{ fontSize: '12.5px' }}>{toolBudgetTitle}</strong>
                      <span
                        className="nov-badge"
                        style={{ color: tbColor, background: tbBg, borderColor: tbColor }}
                      >
                        {tb.estimatedTotalTools} / {tb.hardLimit} ({tb.usagePercent}%)
                      </span>
                    </div>

                    <div
                      style={{
                        height: '10px',
                        borderRadius: '999px',
                        background: 'var(--nov-bg-0)',
                        border: '1px solid var(--nov-border)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${barWidth}%`,
                          height: '100%',
                          background: tbColor,
                          transition: 'width 180ms ease',
                        }}
                      />
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '8px',
                        fontSize: '11.5px',
                        color: 'var(--nov-text-1)',
                      }}
                    >
                      <span className="nov-badge is-accent">agy-NOV: {tb.agyNovTools} tools</span>
                      <span className="nov-badge">
                        External MCP: {tb.externalServersCount} server(s) (~{tb.estimatedExternalTools} tools)
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <div className="nov-p-stat-grid">
            <div className="nov-p-stat">
              <div className="nov-p-stat-label">Health Score</div>
              <div
                className="nov-p-stat-val"
                style={{
                  color:
                    state.audit.healthScore >= 80
                      ? 'var(--nov-success)'
                      : state.audit.healthScore >= 60
                        ? 'var(--nov-warn)'
                        : 'var(--nov-danger)',
                }}
              >
                {state.audit.healthScore}/100
              </div>
            </div>
            <div className="nov-p-stat">
              <div className="nov-p-stat-label">{dict.ops.auditEstTokens}</div>
              <div className="nov-p-stat-val">~{state.audit.summary.totalEstimatedTokens}</div>
            </div>
            <div className="nov-p-stat">
              <div className="nov-p-stat-label">{dict.ops.auditAssets}</div>
              <div className="nov-p-stat-val">{state.audit.summary.assetCount}</div>
            </div>
            <div className="nov-p-stat">
              <div className="nov-p-stat-label">{dict.ops.auditStorage}</div>
              <div className="nov-p-stat-val">
                {(state.audit.storage.totalBytes / 1024).toFixed(1)} KB
              </div>
            </div>
          </div>

          {Array.isArray(state.audit.mcpHealthFindings) && (
            <>
              <strong style={{ fontSize: '12px' }}>
                {mcpHealthTitle} ({state.audit.mcpHealthFindings.length})
              </strong>
              {state.audit.mcpHealthFindings.length > 0 ? (
                <div className="nov-p-list">
                  {state.audit.mcpHealthFindings.map((f, idx) => {
                    const color = getStatusColor(f.severity);
                    const bg = getStatusSoftBg(f.severity);
                    return (
                      <div key={`${f.file}-${f.serverName ?? 'global'}-${idx}`} className="nov-p-item">
                        <div className="nov-p-row" style={{ fontSize: '12px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              className="nov-badge"
                              style={{ color, background: bg, borderColor: color }}
                            >
                              {f.severity.toUpperCase()}
                            </span>
                            <code>{f.file}</code>
                            {f.serverName && <span className="nov-badge">{f.serverName}</span>}
                          </span>
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>{f.message}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="nov-p-item" style={{ fontSize: '12px', color: 'var(--nov-success)' }}>
                  No MCP configuration issues detected.
                </div>
              )}
            </>
          )}

          {state.audit.teamPreset && (() => {
            const tp = state.audit.teamPreset;
            const statusType: 'ok' | 'warn' | 'error' = !tp.found
              ? 'ok'
              : !tp.valid
                ? 'error'
                : tp.warnings.length > 0
                  ? 'warn'
                  : 'ok';
            const badgeColor = getStatusColor(statusType);
            const badgeBg = getStatusSoftBg(statusType);
            return (
              <div className="nov-p-item" style={{ gap: '8px' }}>
                <div className="nov-p-row">
                  <strong style={{ fontSize: '12.5px' }}>{teamPresetTitle}</strong>
                  {!tp.found ? (
                    <span className="nov-badge">Optional</span>
                  ) : (
                    <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                      <span
                        className="nov-badge"
                        style={{ color: badgeColor, background: badgeBg, borderColor: badgeColor }}
                      >
                        {tp.valid ? teamPresetValid : 'INVALID'}
                      </span>
                      {tp.warnings.length > 0 && (
                        <span
                          className="nov-badge"
                          style={{
                            color: 'var(--nov-warn)',
                            background: 'var(--nov-warn-soft)',
                            borderColor: 'var(--nov-warn)',
                          }}
                        >
                          {teamPresetWarnings}: {tp.warnings.length}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {!tp.found ? (
                  <span style={{ fontSize: '12px', color: 'var(--nov-text-2)' }}>
                    {teamPresetMissing}
                  </span>
                ) : (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '6px',
                        fontSize: '11.5px',
                      }}
                    >
                      {tp.preset && (
                        <span className="nov-badge is-accent">preset: {tp.preset}</span>
                      )}
                      {tp.enableModules.length > 0 && (
                        <span className="nov-badge">
                          modules: {tp.enableModules.join(', ')}
                        </span>
                      )}
                      <span className="nov-badge">
                        verifyCommands: {tp.verifyCommands.length}
                      </span>
                      {tp.specTemplatesCount > 0 && (
                        <span className="nov-badge">
                          specTemplates: {tp.specTemplatesCount}
                        </span>
                      )}
                    </div>

                    {tp.errors.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {tp.errors.map((errMsg, idx) => (
                          <div
                            key={`tp-err-${idx}`}
                            style={{ fontSize: '11.5px', color: 'var(--nov-danger)' }}
                          >
                            • {errMsg}
                          </div>
                        ))}
                      </div>
                    )}

                    {tp.warnings.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <strong style={{ fontSize: '11.5px', color: 'var(--nov-warn)' }}>
                          {teamPresetWarnings} ({tp.warnings.length})
                        </strong>
                        {tp.warnings.map((warnMsg, idx) => (
                          <div
                            key={`tp-warn-${idx}`}
                            style={{ fontSize: '11.5px', color: 'var(--nov-warn)' }}
                          >
                            • {warnMsg}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}

          {Array.isArray(state.audit.crossClientFindings) && (
            <div className="nov-p-item" style={{ gap: '8px' }}>
              <div className="nov-p-row">
                <strong style={{ fontSize: '12.5px' }}>
                  {crossClientTitle} ({state.audit.crossClientFindings.length})
                </strong>
              </div>
              {state.audit.crossClientFindings.length > 0 ? (
                <div className="nov-p-list">
                  {state.audit.crossClientFindings.map((f, idx) => {
                    const color = getStatusColor(f.severity);
                    const bg = getStatusSoftBg(f.severity);
                    return (
                      <div key={`${f.code}-${f.file}-${idx}`} className="nov-p-item" style={{ gap: '4px' }}>
                        <div className="nov-p-row" style={{ fontSize: '12px' }}>
                          <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                            <span
                              className="nov-badge"
                              style={{ color, background: bg, borderColor: color }}
                            >
                              {f.severity.toUpperCase()}
                            </span>
                            <span className="nov-badge is-accent">{f.client}</span>
                            <code>{f.file}</code>
                          </span>
                        </div>
                        <span style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>{f.message}</span>
                        {f.suggestion && (
                          <span style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                            {f.suggestion}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <span style={{ fontSize: '12px', color: 'var(--nov-success)' }}>
                  {crossClientEmpty}
                </span>
              )}
            </div>
          )}

          <strong style={{ fontSize: '12px' }}>{dict.ops.auditAssets}</strong>
          <div className="nov-p-list">
            {state.audit.assets.map((a) => (
              <div key={a.relPath} className="nov-p-row" style={{ fontSize: '12px' }}>
                <span>
                  <span className="nov-badge">{a.kind}</span> <code>{a.relPath}</code>
                </span>
                <span style={{ color: 'var(--nov-text-2)' }}>
                  ~{a.estimatedTokens} tok · {a.lineCount}L
                </span>
              </div>
            ))}
          </div>

          {state.audit.recommendations.length > 0 && (
            <>
              <strong style={{ fontSize: '12px' }}>{dict.ops.auditFindings}</strong>
              <div className="nov-p-list">
                {state.audit.recommendations.map((r, i) => (
                  <div key={i} className="nov-p-item">
                    <strong>{r.title}</strong>
                    <span style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>{r.detail}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
};
