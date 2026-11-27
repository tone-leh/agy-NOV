import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { NovBridge } from '../../bridge.js';
import { useNovI18n } from '../../i18n/index.js';
import './styles.css';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
}

type ChannelKind = 'telegram' | 'feishu' | 'dingtalk' | 'wecom' | 'slack' | 'discord' | 'webhook';
type RemoteSubTab = 'hub' | 'channels' | 'conversations' | 'audit';

interface SafeChannelView {
  id: string;
  kind: ChannelKind;
  label: string;
  enabled: boolean;
  configured: boolean;
}

interface ApprovalRequest {
  id: string;
  conversationId: string;
  toolName: string;
  summary: string;
  matchedRule: string;
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  decidedBy?: string;
  decidedAt?: string;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  kind: 'approval_requested' | 'approval_decided' | 'stop_alert' | 'task_dispatched' | 'channel_ping';
  title: string;
  detail: string;
  actor: string;
}

interface AntigravityConversation {
  id: string;
  title: string;
  summary: string;
  runState: 'RUN_STATE_IDLE' | 'RUN_STATE_RUNNING' | 'RUN_STATE_CANCELLING' | string;
  updateTime: string;
  tags: string[];
  pinned: boolean;
  starred: boolean;
  archived: boolean;
}

interface GatewayStatus {
  running: boolean;
  url: string;
  lanUrl: string;
  mobilePath: string;
  mobileUrl: string;
  connectedClients: number;
  pendingApprovals: number;
  remoteApprovalEnabled: boolean;
  notifyOnStop: boolean;
  pairingUrl?: string;
  pairingPin?: string;
  pairingPinExpiresAt?: string;
}

interface RemoteHubPayload {
  initialTab?: RemoteSubTab;
  running?: boolean;
  enabled?: boolean;
  status?: GatewayStatus;
  channels?: SafeChannelView[];
  approvals?: ApprovalRequest[];
  audit?: AuditEntry[];
  conversations?: AntigravityConversation[];
  conversationApiLive?: boolean;
  riskPatterns?: string[];
  host?: string;
  publicBaseUrl?: string;
}

function isRemoteSubTab(v: unknown): v is RemoteSubTab {
  return v === 'hub' || v === 'channels' || v === 'conversations' || v === 'audit';
}

function resolveRemoteRunning(payload: RemoteHubPayload | null): boolean {
  if (!payload) return false;
  if (typeof payload.status?.running === 'boolean') return payload.status.running;
  if (typeof payload.running === 'boolean') return payload.running;
  return false;
}

export const RemotePanel: React.FC<NovModulePanelProps> = ({
  bridge,
  active,
  onNotify,
  incomingEvent,
}) => {
  const { dict } = useNovI18n();
  const rm = dict.panels.remote;

  const [tab, setTab] = useState<RemoteSubTab>('hub');
  const [data, setData] = useState<RemoteHubPayload | null>(null);
  const [togglingGateway, setTogglingGateway] = useState<boolean>(false);
  const [selectedChannel, setSelectedChannel] = useState<string>('feishu');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [taskModel, setTaskModel] = useState<'flash' | 'pro' | 'flash_lite'>('flash');

  // Settings form state (app_remote_update_settings)
  const [remoteApprovalEnabled, setRemoteApprovalEnabled] = useState<boolean>(true);
  const [notifyOnStop, setNotifyOnStop] = useState<boolean>(true);
  const [bindHost, setBindHost] = useState<string>('127.0.0.1');
  const [publicBaseUrl, setPublicBaseUrl] = useState<string>('');
  const [settingsDirty, setSettingsDirty] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pollPausedByError, setPollPausedByError] = useState<boolean>(false);
  const [localToast, setLocalToast] = useState<string | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const fetchSeqRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const lastEventRef = useRef<typeof incomingEvent>(null);
  const settingsDirtyRef = useRef<boolean>(false);

  useEffect(() => {
    settingsDirtyRef.current = settingsDirty;
  }, [settingsDirty]);

  const notify = useCallback(
    (msg: string) => {
      if (onNotify) {
        onNotify(msg);
        return;
      }
      setLocalToast(msg);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setLocalToast(null), 2600);
    },
    [onNotify],
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const syncSettingsFromPayload = useCallback((payload: RemoteHubPayload) => {
    if (settingsDirtyRef.current) return;
    if (typeof payload.status?.remoteApprovalEnabled === 'boolean') {
      setRemoteApprovalEnabled(payload.status.remoteApprovalEnabled);
    }
    if (typeof payload.status?.notifyOnStop === 'boolean') {
      setNotifyOnStop(payload.status.notifyOnStop);
    }
    if (typeof payload.host === 'string') {
      setBindHost(payload.host);
    }
    if (typeof payload.publicBaseUrl === 'string') {
      setPublicBaseUrl(payload.publicBaseUrl);
    }
  }, []);

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (opts?.silent && inFlightRef.current) return;
      const seq = ++fetchSeqRef.current;
      inFlightRef.current = true;
      if (!opts?.silent) {
        setLoading(true);
        setErrorMsg(null);
      }
      try {
        const fresh = await bridge.callTool<RemoteHubPayload>('app_remote_get_hub_state', {});
        if (seq !== fetchSeqRef.current) return;
        setData(fresh);
        setPollPausedByError(false);
        setErrorMsg(null);
        syncSettingsFromPayload(fresh);
      } catch (err) {
        if (seq !== fetchSeqRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
        setPollPausedByError(true);
      } finally {
        if (seq === fetchSeqRef.current) {
          inFlightRef.current = false;
          if (!opts?.silent) setLoading(false);
        }
      }
    },
    [bridge, syncSettingsFromPayload],
  );

  // Gate 1: Fetch state ONLY when panel becomes active (zero fetches while inactive)
  useEffect(() => {
    if (!active) return;
    setPollPausedByError(false);
    void refresh();
  }, [active, refresh]);

  // Gate 2: Conditional 3-second polling ONLY when active === true AND gateway running === true
  const isRunning = resolveRemoteRunning(data);
  useEffect(() => {
    if (!active || !isRunning || pollPausedByError) return;
    const intervalId = window.setInterval(() => {
      void refresh({ silent: true });
    }, 3000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [active, isRunning, pollPausedByError, refresh]);

  // Respond to incoming tool result events without bypassing active gate
  useEffect(() => {
    if (!incomingEvent || incomingEvent === lastEventRef.current) return;
    const sc = incomingEvent.structuredContent;
    if (!sc || typeof sc !== 'object') return;

    const isRemoteTool =
      sc.novModule === 'remote' ||
      (typeof incomingEvent.toolName === 'string' && incomingEvent.toolName.includes('remote'));
    const hasRemoteShape =
      isRemoteSubTab(sc.initialTab) ||
      (sc.status !== undefined && typeof sc.status === 'object' && sc.status !== null && 'running' in sc.status) ||
      Array.isArray(sc.approvals);

    if (!isRemoteTool && !hasRemoteShape) return;
    lastEventRef.current = incomingEvent;

    if (isRemoteSubTab(sc.initialTab)) {
      setTab(sc.initialTab);
    }
    if (active) {
      void refresh({ silent: true });
    }
  }, [incomingEvent, active, refresh]);

  const channels = data?.channels ?? [];
  const approvals = data?.approvals ?? [];
  const audit = data?.audit ?? [];
  const conversations = data?.conversations ?? [];
  const riskPatterns = data?.riskPatterns ?? [];
  const pendingApprovals = approvals.filter((a) => a.status === 'pending');

  const handleSaveChannel = async (enabled: boolean) => {
    try {
      const res = await bridge.callTool<{ ok?: boolean; error?: string }>('app_remote_update_channel', {
        id: selectedChannel,
        enabled,
        ...(selectedChannel === 'telegram'
          ? { botToken: botToken || undefined, chatId: chatId || undefined }
          : { webhookUrl: webhookUrl || undefined, secret: secret || undefined }),
      });
      if (res.ok === false || typeof res.error === 'string') {
        notify(`Validation failed: ${String(res.error ?? 'invalid channel configuration')}`);
        return;
      }
      setWebhookUrl('');
      setSecret('');
      setBotToken('');
      notify(`Saved ${selectedChannel} channel settings (mode 0600)`);
      await refresh();
    } catch (err) {
      notify(`Save channel failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleTestChannel = async (id: string) => {
    try {
      const res = await bridge.callTool<{ ok?: boolean; error?: string }>('app_remote_test_channel', { id });
      notify(res.ok ? `Test ping delivered to ${id}!` : `Ping failed: ${String(res.error ?? 'not configured')}`);
    } catch (err) {
      notify(`Ping failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSimulate = async () => {
    try {
      await bridge.callTool('app_remote_simulate_approval', { command: 'git push origin main --force' });
      notify('Queued simulated risky command approval!');
      await refresh();
    } catch (err) {
      notify(`Simulate failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDecide = async (id: string, decision: 'approved' | 'denied') => {
    try {
      await bridge.callTool('app_remote_decide_approval', { id, decision });
      notify(`Marked ${id} as ${decision}`);
      await refresh();
    } catch (err) {
      notify(`Decision failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleRefreshPin = async () => {
    try {
      await bridge.callTool('app_remote_refresh_pin', {});
      notify('Generated fresh 6-digit PIN (valid for 5 min)');
      await refresh();
    } catch (err) {
      notify(`Refresh PIN failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleRotatePairing = async () => {
    try {
      await bridge.callTool('app_remote_rotate_pairing', {});
      notify('Rotated 256-bit token & 6-digit PIN');
      await refresh();
    } catch (err) {
      notify(`Rotate secret failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await bridge.callTool<RemoteHubPayload & { ok?: boolean; error?: string }>(
        'app_remote_update_settings',
        {
          remoteApprovalEnabled,
          notifyOnStop,
          host: bindHost.trim() || '127.0.0.1',
          publicBaseUrl: publicBaseUrl.trim(),
        },
      );
      if (res.ok === false || typeof res.error === 'string') {
        notify(`Settings error: ${String(res.error ?? 'invalid settings')}`);
        return;
      }
      setSettingsDirty(false);
      if (res.status) {
        setData(res);
      } else {
        await refresh();
      }
      notify('Updated Remote gateway policy settings');
    } catch (err) {
      notify(`Update settings failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskPrompt.trim()) return;
    try {
      await bridge.callTool('app_remote_dispatch_task', {
        prompt: taskPrompt.trim(),
        model: taskModel,
      });
      setTaskPrompt('');
      notify('Dispatched new Antigravity conversation!');
      await refresh();
    } catch (err) {
      notify(`Dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleToggleGateway = async (enable: boolean) => {
    setTogglingGateway(true);
    try {
      await bridge.setModule('remote', enable);
      notify(enable ? rm.startGateway : rm.stopGateway);
      await refresh();
    } catch (err) {
      notify(`Gateway toggle failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTogglingGateway(false);
    }
  };

  const pairingUrl = data?.status?.pairingUrl ?? '';
  const pairingPin = data?.status?.pairingPin ?? '------';

  return (
    <div className="mod-remote">
      <header className="remote-hdr">
        <div className="remote-brand">
          <span className="remote-logo">RM</span>
          <span>{rm.title}</span>
          <span className={`remote-badge ${isRunning ? 'is-good' : 'is-warn'}`}>
            {isRunning ? dict.statusGatewayRunning : dict.common.disabled}
          </span>
        </div>
        <div className="remote-row">
          <button
            type="button"
            className={`remote-btn ${isRunning ? 'is-danger' : 'is-good'}`}
            onClick={() => void handleToggleGateway(!isRunning)}
            disabled={togglingGateway || loading}
          >
            {isRunning ? rm.stopGateway : rm.startGateway}
          </button>
          <button
            type="button"
            className="remote-btn"
            onClick={() => void handleSimulate()}
            disabled={!isRunning}
          >
            Simulate Approval
          </button>
          <button
            type="button"
            className="remote-btn is-primary"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? dict.common.loading : dict.common.refresh}
          </button>
        </div>
      </header>

      {errorMsg && (
        <div className="remote-error" role="alert">
          {errorMsg}
        </div>
      )}

      {data && !isRunning && (
        <section className="remote-offline-banner" role="status">
          <div className="remote-offline-title">
            <span className="remote-badge is-good">{dict.badgeOffline}</span>
            <span>{rm.title}</span>
          </div>
          <p className="remote-offline-desc">{rm.offlineNotice}</p>
        </section>
      )}

      <nav className="remote-tabs" aria-label={rm.title}>
        <button
          type="button"
          className={`remote-tab ${tab === 'hub' ? 'is-active' : ''}`}
          onClick={() => setTab('hub')}
        >
          {rm.tabHub}{' '}
          {pendingApprovals.length > 0 && (
            <span className="remote-badge is-warn">{pendingApprovals.length}</span>
          )}
        </button>
        <button
          type="button"
          className={`remote-tab ${tab === 'channels' ? 'is-active' : ''}`}
          onClick={() => setTab('channels')}
        >
          {rm.tabChannels}
        </button>
        <button
          type="button"
          className={`remote-tab ${tab === 'conversations' ? 'is-active' : ''}`}
          onClick={() => setTab('conversations')}
        >
          {rm.tabConversations}
        </button>
        <button
          type="button"
          className={`remote-tab ${tab === 'audit' ? 'is-active' : ''}`}
          onClick={() => setTab('audit')}
        >
          {rm.tabAudit}
        </button>
      </nav>

      {!data ? (
        <div className="remote-card remote-muted">
          {loading ? dict.common.loading : rm.offlineNotice}
        </div>
      ) : (
        <>
          {tab === 'hub' && (
            <div className="remote-stack">
              <div className="remote-kpi-grid">
                <div className="remote-card">
                  <div className="remote-kpi-label">Pending Approvals</div>
                  <div className={`remote-kpi-value ${pendingApprovals.length ? 'is-warn' : 'is-good'}`}>
                    {pendingApprovals.length}
                  </div>
                </div>
                <div className="remote-card">
                  <div className="remote-kpi-label">Connected Phones</div>
                  <div className="remote-kpi-value">{data.status?.connectedClients ?? 0}</div>
                </div>
                <div className="remote-card">
                  <div className="remote-kpi-label">Pairing PIN</div>
                  <div className="remote-kpi-value remote-mono">
                    {isRunning ? pairingPin : dict.common.disabled}
                  </div>
                </div>
                <div className="remote-card">
                  <div className="remote-kpi-label">{rm.tabChannels}</div>
                  <div className="remote-kpi-value">
                    {channels.filter((c) => c.enabled).length}
                  </div>
                </div>
              </div>

              <div className="remote-card">
                <div className="remote-row is-between" style={{ marginBottom: 8 }}>
                  <strong>{rm.pairMobile}</strong>
                  <div className="remote-row">
                    <button
                      type="button"
                      className="remote-btn is-primary"
                      disabled={!isRunning || !pairingUrl}
                      onClick={() => {
                        void navigator.clipboard?.writeText(pairingUrl);
                        notify(dict.common.copied);
                      }}
                    >
                      {dict.common.copy}
                    </button>
                    {isRunning && /^https?:\/\//i.test(pairingUrl) && (
                      <button
                        type="button"
                        className="remote-btn"
                        onClick={async () => {
                          const ok = await bridge.openExternalLink(pairingUrl);
                          if (!ok) notify('Host blocked external link; use Copy Link instead');
                        }}
                      >
                        Open Link
                      </button>
                    )}
                    <button
                      type="button"
                      className="remote-btn"
                      disabled={!isRunning}
                      onClick={() => void handleRefreshPin()}
                    >
                      Refresh PIN
                    </button>
                    <button
                      type="button"
                      className="remote-btn"
                      disabled={!isRunning}
                      onClick={() => void handleRotatePairing()}
                    >
                      Rotate Secret
                    </button>
                  </div>
                </div>
                <div className="remote-codebox">
                  {isRunning && pairingUrl ? pairingUrl : rm.offlineNotice}
                </div>
                <div className="remote-muted" style={{ marginTop: 6 }}>
                  Open on your phone over LAN Wi-Fi, Tailscale, or Cloudflare Tunnel — zero cloud middleman.
                </div>
              </div>

              <div className="remote-card">
                <strong style={{ display: 'block', marginBottom: 8 }}>Pending Risky Approvals</strong>
                {pendingApprovals.length === 0 ? (
                  <div className="remote-muted">
                    {isRunning ? dict.common.empty : rm.offlineNotice}
                  </div>
                ) : (
                  <div className="remote-stack-sm">
                    {pendingApprovals.map((a) => (
                      <div key={a.id} className="remote-item">
                        <div className="remote-row is-between" style={{ marginBottom: 5 }}>
                          <strong className="remote-mono">{a.toolName}</strong>
                          <span className="remote-badge is-warn">WAITING</span>
                        </div>
                        <div className="remote-codebox" style={{ marginBottom: 8 }}>
                          {a.summary}
                        </div>
                        <div className="remote-row">
                          <button
                            type="button"
                            className="remote-btn is-good"
                            onClick={() => void handleDecide(a.id, 'approved')}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="remote-btn is-danger"
                            onClick={() => void handleDecide(a.id, 'denied')}
                          >
                            Deny
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'channels' && (
            <div className="remote-stack">
              <div className="remote-card remote-stack-sm">
                <strong>{rm.tabChannels}</strong>
                {channels.length === 0 ? (
                  <div className="remote-muted">{dict.common.empty}</div>
                ) : (
                  channels.map((ch) => (
                    <div key={ch.id} className="remote-item remote-row is-between">
                      <div>
                        <strong>{ch.label}</strong>{' '}
                        <span className={`remote-badge ${ch.enabled ? 'is-good' : ''}`}>
                          {ch.enabled ? dict.common.enabled : dict.common.disabled}
                        </span>{' '}
                        {ch.configured && <span className="remote-badge is-info">CONFIGURED</span>}
                      </div>
                      <div className="remote-row">
                        <button
                          type="button"
                          className="remote-btn"
                          onClick={() => setSelectedChannel(ch.id)}
                        >
                          Configure
                        </button>
                        <button
                          type="button"
                          className="remote-btn is-primary"
                          disabled={!isRunning}
                          onClick={() => void handleTestChannel(ch.id)}
                        >
                          {rm.sendAlert}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="remote-card remote-stack-sm">
                <strong>Edit Channel: {selectedChannel}</strong>
                {selectedChannel === 'telegram' ? (
                  <>
                    <input
                      className="remote-input"
                      type="password"
                      placeholder="Telegram Bot Token"
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                    />
                    <input
                      className="remote-input"
                      placeholder="Target Chat ID"
                      value={chatId}
                      onChange={(e) => setChatId(e.target.value)}
                    />
                  </>
                ) : (
                  <>
                    <input
                      className="remote-input"
                      type="password"
                      placeholder="Webhook URL (Feishu / DingTalk / WeCom / Slack / Discord)"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                    />
                    <input
                      className="remote-input"
                      type="password"
                      placeholder="Optional HMAC Signing Secret (Feishu / DingTalk)"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                    />
                  </>
                )}
                <div className="remote-row">
                  <button
                    type="button"
                    className="remote-btn is-good"
                    disabled={!isRunning}
                    onClick={() => void handleSaveChannel(true)}
                  >
                    {dict.common.save} ({dict.common.enabled})
                  </button>
                  <button
                    type="button"
                    className="remote-btn"
                    disabled={!isRunning}
                    onClick={() => void handleSaveChannel(false)}
                  >
                    {dict.common.save} ({dict.common.disabled})
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'conversations' && (
            <div className="remote-stack">
              <form
                className="remote-card remote-stack-sm"
                onSubmit={(e) => void handleDispatch(e)}
              >
                <div className="remote-row is-between">
                  <strong>{rm.dispatchTask}</strong>
                  <span className="remote-badge is-info">
                    {data.conversationApiLive ? 'LIVE API' : 'DEMO MOCK'}
                  </span>
                </div>
                <select
                  className="remote-select"
                  value={taskModel}
                  onChange={(e) =>
                    setTaskModel(e.target.value as 'flash' | 'pro' | 'flash_lite')
                  }
                >
                  <option value="flash">Model: flash</option>
                  <option value="pro">Model: pro</option>
                  <option value="flash_lite">Model: flash_lite</option>
                </select>
                <textarea
                  className="remote-textarea"
                  rows={2}
                  placeholder={rm.promptPlaceholder}
                  value={taskPrompt}
                  onChange={(e) => setTaskPrompt(e.target.value)}
                />
                <button
                  type="submit"
                  className="remote-btn is-primary"
                  disabled={!isRunning || !taskPrompt.trim()}
                >
                  {rm.dispatchTask}
                </button>
              </form>

              <div className="remote-card remote-stack-sm">
                <strong>
                  {rm.tabConversations} ({conversations.length})
                </strong>
                {conversations.length === 0 ? (
                  <div className="remote-muted">{dict.common.empty}</div>
                ) : (
                  conversations.map((c) => (
                    <div key={c.id} className="remote-item">
                      <div className="remote-row is-between">
                        <strong>{c.title}</strong>
                        <span
                          className={`remote-badge ${
                            c.runState === 'RUN_STATE_RUNNING' ? 'is-good' : ''
                          }`}
                        >
                          {c.runState.replace('RUN_STATE_', '')}
                        </span>
                      </div>
                      <div className="remote-muted" style={{ marginTop: 3 }}>
                        {c.summary}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {tab === 'audit' && (
            <div className="remote-stack">
              <form
                className="remote-card remote-stack-sm"
                onSubmit={(e) => void handleSaveSettings(e)}
              >
                <strong>Gateway &amp; Policy Settings</strong>
                <div className="remote-row">
                  <label className="remote-checkbox-row">
                    <input
                      type="checkbox"
                      checked={remoteApprovalEnabled}
                      onChange={(e) => {
                        setRemoteApprovalEnabled(e.target.checked);
                        setSettingsDirty(true);
                      }}
                    />
                    Require remote approval on risky commands
                  </label>
                  <label className="remote-checkbox-row">
                    <input
                      type="checkbox"
                      checked={notifyOnStop}
                      onChange={(e) => {
                        setNotifyOnStop(e.target.checked);
                        setSettingsDirty(true);
                      }}
                    />
                    Send IM alert when task stops
                  </label>
                </div>
                <label className="remote-field-label">
                  Bind Host (default 127.0.0.1; use 0.0.0.0 for LAN Wi-Fi)
                  <input
                    className="remote-input"
                    value={bindHost}
                    onChange={(e) => {
                      setBindHost(e.target.value);
                      setSettingsDirty(true);
                    }}
                  />
                </label>
                <label className="remote-field-label">
                  Optional Public Base URL (Tailscale / Cloudflare Tunnel, http(s):// only)
                  <input
                    className="remote-input"
                    placeholder="https://my-devbox.ts.net"
                    value={publicBaseUrl}
                    onChange={(e) => {
                      setPublicBaseUrl(e.target.value);
                      setSettingsDirty(true);
                    }}
                  />
                </label>
                <div className="remote-row">
                  <button type="submit" className="remote-btn is-primary" disabled={!isRunning}>
                    {dict.common.save}
                  </button>
                </div>
              </form>

              <div className="remote-card">
                <strong style={{ display: 'block', marginBottom: 8 }}>
                  Risky Command Patterns ({riskPatterns.length})
                </strong>
                <div className="remote-codebox">
                  {riskPatterns.length > 0 ? riskPatterns.join('\n') : '(No risk patterns configured)'}
                </div>
              </div>

              <div className="remote-card remote-stack-sm">
                <strong>
                  {rm.tabAudit} ({audit.length})
                </strong>
                {audit.length === 0 ? (
                  <div className="remote-muted">{dict.common.empty}</div>
                ) : (
                  audit.map((entry) => (
                    <div key={entry.id} className="remote-item">
                      <div className="remote-row is-between">
                        <strong>{entry.title}</strong>
                        <span className="remote-badge remote-mono">{entry.actor}</span>
                      </div>
                      <div className="remote-muted">{entry.detail}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}

      {!onNotify && localToast && <div className="remote-toast">{localToast}</div>}
    </div>
  );
};
