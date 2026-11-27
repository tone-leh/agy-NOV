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

          <div className="nov-p-stat-grid">
            <div className="nov-p-stat">
              <div className="nov-p-stat-label">Health Score</div>
              <div className="nov-p-stat-val" style={{ color: 'var(--nov-success)' }}>
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
