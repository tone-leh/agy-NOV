import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LOCALE_NATIVE_LABELS,
  MAX_MCP_TOOL_BUDGET,
  MODULE_CATALOG,
  MODULE_DOMAIN_IDS,
  MODULE_IDS,
  PRESET_IDS,
  UI_LOCALE_IDS,
  type ModuleDomainId,
  type ModuleId,
  type NovLocale,
  type NovStartupView,
  type PresetId,
} from '../../../src/core/catalog.js';
import type {
  NovBridge,
  NovConfigSnapshot,
  NovHubStatePayload,
  SanitizedConfigExportPayload,
} from '../bridge.js';
import { useNovI18n } from '../i18n/index.js';

export interface SettingsHubProps {
  bridge: NovBridge;
  snapshot: NovConfigSnapshot;
  busyKey: string | null;
  initialExpandedModule?: ModuleId | null;
  onToggleModule: (moduleId: ModuleId, enabled: boolean) => Promise<void> | void;
  onApplyPreset: (preset: PresetId) => Promise<void> | void;
  onChangeLocale: (locale: NovLocale) => Promise<void> | void;
  onChangeStartupView: (startupView: NovStartupView) => Promise<void> | void;
  onOpenModule: (moduleId: ModuleId) => void;
  onSnapshotReplaced?: (snapshot: NovConfigSnapshot) => void;
  onNotify?: (message: string) => void;
}

type GuardDecision = 'allow' | 'ask' | 'deny';

interface GuardDrawerData {
  policy: {
    enabled: boolean;
    protectEnvAndKeys: GuardDecision;
    blockSecretWrites: GuardDecision;
    blockDestructiveCommands: GuardDecision;
    askOnNetworkPipes?: GuardDecision;
    autoSnapshotBeforeEdit: boolean;
  };
  stats?: {
    totalSnapshots?: number;
    blockedCount?: number;
    secretCatches?: number;
  };
}

interface VerifyDrawerData {
  policy: {
    enforceOnStop: boolean;
    autoRunOnStop: boolean;
    blockEmptyWrites: boolean;
    maxConsecutiveBlocks: number;
  };
  stats?: {
    totalRuns?: number;
    passedRuns?: number;
    failedRuns?: number;
    blockedStops?: number;
  };
}

interface SpecDrawerData {
  activeSpecId: string | null;
  activeSpec: {
    id: string;
    title: string;
    status: 'draft' | 'approved' | 'completed' | 'archived';
    enforcePlanBeforeWrite: boolean;
    requireUiApproval: boolean;
    tasks?: Array<{ status?: string }>;
  } | null;
  writeLockActive: boolean;
  specs?: Array<{ id: string }>;
}

interface RadarDrawerData {
  prefs: {
    desktopNotify: boolean;
    soundChime: boolean;
    stallMinutes: number;
  };
  counts?: {
    total?: number;
    running?: number;
    awaiting_approval?: number;
    stalled?: number;
  };
}

interface RemoteDrawerData {
  moduleEnabled?: boolean;
  running?: boolean;
  host?: string;
  port?: number;
  channels?: Array<{ id: string; enabled: boolean; configured: boolean }>;
  status?: {
    running?: boolean;
    connectedClients?: number;
    pendingApprovals?: number;
    remoteApprovalEnabled?: boolean;
    notifyOnStop?: boolean;
  };
}

const CONFIGURABLE_STRATEGY_MODULES = new Set<ModuleId>([
  'guard',
  'verify',
  'spec',
  'radar',
  'remote',
]);

const STRATEGY_SEARCH_HINTS: Partial<Record<ModuleId, string>> = {
  guard: 'secret key env command snapshot firewall policy',
  verify: 'stop hook enforceOnStop autoRunOnStop blockEmptyWrites maxConsecutiveBlocks gate',
  spec: 'write lock enforcePlanBeforeWrite requireUiApproval approval draft dag',
  radar: 'chime sound notify desktopNotify stallMinutes threshold alert',
  remote: 'gateway port pwa approval notifyOnStop isolation network',
};

function getBudgetTone(exposed: number, limit: number): 'is-safe' | 'is-warn' | 'is-danger' {
  const ratio = limit > 0 ? (exposed / limit) * 100 : 0;
  if (ratio >= 85) return 'is-danger';
  if (ratio >= 60) return 'is-warn';
  return 'is-safe';
}

function unwrapGuardData(raw: unknown): GuardDrawerData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const target =
    obj.state && typeof obj.state === 'object' ? (obj.state as Record<string, unknown>) : obj;
  if (target.policy && typeof target.policy === 'object') {
    return {
      policy: target.policy as GuardDrawerData['policy'],
      stats: target.stats as GuardDrawerData['stats'],
    };
  }
  return null;
}

function unwrapVerifyData(raw: unknown): VerifyDrawerData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const target =
    obj.state && typeof obj.state === 'object' ? (obj.state as Record<string, unknown>) : obj;
  if (target.policy && typeof target.policy === 'object') {
    return {
      policy: target.policy as VerifyDrawerData['policy'],
      stats: target.stats as VerifyDrawerData['stats'],
    };
  }
  return null;
}

function unwrapSpecData(raw: unknown): SpecDrawerData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const target =
    obj.state && typeof obj.state === 'object' ? (obj.state as Record<string, unknown>) : obj;
  if ('activeSpec' in target || 'writeLockActive' in target) {
    return {
      activeSpecId: typeof target.activeSpecId === 'string' ? target.activeSpecId : null,
      activeSpec: (target.activeSpec as SpecDrawerData['activeSpec']) ?? null,
      writeLockActive: Boolean(target.writeLockActive),
      specs: Array.isArray(target.specs) ? (target.specs as SpecDrawerData['specs']) : [],
    };
  }
  return null;
}

function unwrapRadarData(raw: unknown): RadarDrawerData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const target =
    obj.board && typeof obj.board === 'object' ? (obj.board as Record<string, unknown>) : obj;
  if (target.prefs && typeof target.prefs === 'object') {
    return {
      prefs: target.prefs as RadarDrawerData['prefs'],
      counts: target.counts as RadarDrawerData['counts'],
    };
  }
  return null;
}

export const SettingsHub: React.FC<SettingsHubProps> = ({
  bridge,
  snapshot,
  busyKey,
  initialExpandedModule = null,
  onToggleModule,
  onApplyPreset,
  onChangeLocale,
  onChangeStartupView,
  onOpenModule,
  onSnapshotReplaced,
  onNotify,
}) => {
  const { dict, prefLocale, t } = useNovI18n();
  const sh = dict.settingsHub;

  const [searchQuery, setSearchQuery] = useState('');
  const [hubState, setHubState] = useState<NovHubStatePayload | null>(null);

  // S3 Accordion state — at most one enabled module expanded at any time
  const [expandedModuleId, setExpandedModuleId] = useState<ModuleId | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  const [guardData, setGuardData] = useState<GuardDrawerData | null>(null);
  const [verifyData, setVerifyData] = useState<VerifyDrawerData | null>(null);
  const [specData, setSpecData] = useState<SpecDrawerData | null>(null);
  const [radarData, setRadarData] = useState<RadarDrawerData | null>(null);
  const [remoteData, setRemoteData] = useState<RemoteDrawerData | null>(null);
  const [remotePortDraft, setRemotePortDraft] = useState<string>('');

  // S4 Governance state
  const [exportedPayload, setExportedPayload] = useState<SanitizedConfigExportPayload | null>(null);
  const [exportCopied, setExportCopied] = useState(false);
  const [importText, setImportText] = useState('');
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [govBusy, setGovBusy] = useState(false);

  const loadHubSnapshot = useCallback(async () => {
    try {
      const payload = await bridge.getHubState();
      setHubState(payload);
    } catch {
      setHubState(null);
    }
  }, [bridge]);

  useEffect(() => {
    void loadHubSnapshot();
  }, [loadHubSnapshot, snapshot.enabledCount, snapshot.config.updatedAt]);

  // Collapse drawer immediately if the expanded module is disabled
  useEffect(() => {
    if (expandedModuleId && !snapshot.config.modules[expandedModuleId]) {
      setExpandedModuleId(null);
      setDrawerError(null);
    }
  }, [expandedModuleId, snapshot.config.modules]);

  const loadDrawerForModule = useCallback(
    async (modId: ModuleId) => {
      if (!CONFIGURABLE_STRATEGY_MODULES.has(modId)) return;
      setDrawerLoading(true);
      setDrawerError(null);
      try {
        if (modId === 'guard') {
          const raw = await bridge.callTool('app_guard_get_state', {});
          setGuardData(unwrapGuardData(raw));
        } else if (modId === 'verify') {
          const raw = await bridge.callTool('app_verify_get_state', {});
          setVerifyData(unwrapVerifyData(raw));
        } else if (modId === 'spec') {
          const raw = await bridge.callTool('app_spec_get_state', {});
          setSpecData(unwrapSpecData(raw));
        } else if (modId === 'radar') {
          const raw = await bridge.callTool('app_radar_get_board', {});
          setRadarData(unwrapRadarData(raw));
        } else if (modId === 'remote') {
          const raw = (await bridge.callTool('app_remote_get_hub_state', {})) as RemoteDrawerData;
          setRemoteData(raw);
          setRemotePortDraft(typeof raw?.port === 'number' ? String(raw.port) : '');
        }
      } catch (err) {
        setDrawerError(err instanceof Error ? err.message : String(err));
      } finally {
        setDrawerLoading(false);
      }
    },
    [bridge],
  );

  // Honor deep-link focus from business module panels (e.g. SpecPanel strategy button)
  useEffect(() => {
    if (initialExpandedModule && snapshot.config.modules[initialExpandedModule]) {
      setExpandedModuleId(initialExpandedModule);
      setDrawerError(null);
      void loadDrawerForModule(initialExpandedModule);
    }
  }, [initialExpandedModule, snapshot.config.modules, loadDrawerForModule]);

  const handleToggleDrawer = (modId: ModuleId) => {
    if (!snapshot.config.modules[modId]) return;
    if (expandedModuleId === modId) {
      setExpandedModuleId(null);
      setDrawerError(null);
      return;
    }
    setExpandedModuleId(modId);
    setDrawerError(null);
    void loadDrawerForModule(modId);
  };

  // S3 Strategy mutation handlers
  const updateGuardPolicy = async (patch: Record<string, unknown>) => {
    setDrawerSaving(true);
    setDrawerError(null);
    try {
      const raw = await bridge.callTool('app_guard_update_policy', patch);
      const next = unwrapGuardData(raw);
      if (next) setGuardData(next);
      onNotify?.(`${dict.modules.guard.shortLabel}: ${dict.common.save}`);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrawerSaving(false);
    }
  };

  const updateVerifyPolicy = async (patch: Record<string, unknown>) => {
    setDrawerSaving(true);
    setDrawerError(null);
    try {
      const raw = await bridge.callTool('app_verify_save_policy', patch);
      const next = unwrapVerifyData(raw);
      if (next) setVerifyData(next);
      onNotify?.(`${dict.modules.verify.shortLabel}: ${dict.common.save}`);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrawerSaving(false);
    }
  };

  const updateSpecGuardrails = async (patch: {
    enforcePlanBeforeWrite?: boolean;
    requireUiApproval?: boolean;
  }) => {
    const activeSpec = specData?.activeSpec;
    if (!activeSpec) return;
    setDrawerSaving(true);
    setDrawerError(null);
    try {
      const raw = await bridge.callTool('app_spec_set_status', {
        specId: activeSpec.id,
        status: activeSpec.status,
        ...patch,
      });
      const next = unwrapSpecData(raw);
      if (next) setSpecData(next);
      onNotify?.(`${dict.modules.spec.shortLabel}: ${dict.common.save}`);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrawerSaving(false);
    }
  };

  const updateRadarPrefs = async (patch: {
    desktopNotify?: boolean;
    soundChime?: boolean;
    stallMinutes?: number;
  }) => {
    setDrawerSaving(true);
    setDrawerError(null);
    try {
      const raw = await bridge.callTool('app_radar_update_prefs', patch);
      const next = unwrapRadarData(raw);
      if (next) setRadarData(next);
      onNotify?.(`${dict.modules.radar.shortLabel}: ${dict.common.save}`);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrawerSaving(false);
    }
  };

  const updateRemoteSettings = async (patch: {
    remoteApprovalEnabled?: boolean;
    notifyOnStop?: boolean;
    port?: number;
  }) => {
    setDrawerSaving(true);
    setDrawerError(null);
    try {
      const raw = (await bridge.callTool(
        'app_remote_update_settings',
        patch,
      )) as RemoteDrawerData;
      setRemoteData(raw);
      if (typeof raw?.port === 'number') setRemotePortDraft(String(raw.port));
      onNotify?.(`${dict.modules.remote.shortLabel}: ${dict.common.save}`);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrawerSaving(false);
    }
  };

  // S4 Governance handlers
  const handleExportConfig = async () => {
    setGovBusy(true);
    setExportCopied(false);
    try {
      const exported = await bridge.exportConfig();
      setExportedPayload(exported);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setGovBusy(false);
    }
  };

  const handleCopyExport = async () => {
    if (!exportedPayload) return;
    try {
      await navigator.clipboard?.writeText(JSON.stringify(exportedPayload, null, 2));
      setExportCopied(true);
      onNotify?.(dict.common.copied);
    } catch {
      // clipboard unavailable
    }
  };

  const handleImportConfig = async () => {
    if (!importText.trim()) return;
    setGovBusy(true);
    setImportError(null);
    setImportSuccessMsg(null);
    setImportWarnings([]);
    try {
      const res = await bridge.importConfig(importText);
      setImportWarnings(Array.isArray(res.warnings) ? res.warnings : []);
      setImportSuccessMsg(sh.importSuccess);
      if (res.snapshot) {
        onSnapshotReplaced?.(res.snapshot);
      }
      onNotify?.(sh.importSuccess);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setGovBusy(false);
    }
  };

  const handleConfirmReset = async () => {
    setGovBusy(true);
    try {
      const next = await bridge.resetConfig();
      setConfirmingReset(false);
      setExpandedModuleId(null);
      onSnapshotReplaced?.(next);
      onNotify?.(sh.resetSuccess);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setGovBusy(false);
    }
  };

  // Live search filtering across S1-S4
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredDomains = useMemo(() => {
    return MODULE_DOMAIN_IDS.map((domainId: ModuleDomainId) => {
      const domainMeta = dict.domains[domainId];
      const domainMatches =
        !normalizedQuery ||
        domainId.includes(normalizedQuery) ||
        domainMeta.label.toLowerCase().includes(normalizedQuery) ||
        domainMeta.description.toLowerCase().includes(normalizedQuery);

      const modules = MODULE_IDS.filter((modId) => {
        if (MODULE_CATALOG[modId].domain !== domainId) return false;
        if (!normalizedQuery || domainMatches) return true;
        const mText = dict.modules[modId];
        const mMeta = MODULE_CATALOG[modId];
        const hint = STRATEGY_SEARCH_HINTS[modId] ?? '';
        const haystack = [
          modId,
          mText.name,
          mText.shortLabel,
          mText.tagline,
          mText.description,
          ...mMeta.modelToolNames,
          hint,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      });

      return { domainId, modules };
    }).filter((group) => group.modules.length > 0);
  }, [dict.domains, dict.modules, normalizedQuery]);

  const advancedMatchesQuery = useMemo(() => {
    if (!normalizedQuery) return true;
    const advHaystack = [
      sh.advancedTitle,
      sh.advancedSub,
      sh.teamPresetSection,
      sh.exportBtn,
      sh.importBtn,
      sh.resetBtn,
      sh.dualStarSection,
      'json export import reset team feed-snapshot.json agy-nov.json backup restore',
    ]
      .join(' ')
      .toLowerCase();
    return advHaystack.includes(normalizedQuery);
  }, [normalizedQuery, sh]);

  const totalVisibleModules = filteredDomains.reduce((sum, g) => sum + g.modules.length, 0);
  const noSearchHits = Boolean(normalizedQuery) && totalVisibleModules === 0 && !advancedMatchesQuery;

  const exposedTools = snapshot.exposedModelTools;
  const budgetLimit = hubState?.feed?.toolBudgetLimit ?? MAX_MCP_TOOL_BUDGET;
  const budgetPercent = Math.min(100, Math.round((exposedTools / Math.max(1, budgetLimit)) * 100));
  const budgetTone = getBudgetTone(exposedTools, budgetLimit);
  const currentStartupView: NovStartupView = snapshot.config.startupView ?? 'hub';

  const feedSummary = hubState?.feed?.summary ?? {};
  const feedPath =
    hubState?.feed?.paths?.feedSnapshotPath ??
    hubState?.feed?.paths?.feedPath ??
    (hubState?.feed?.paths?.feedFile
      ? `<dataDir>/${hubState.feed.paths.feedFile}`
      : '<dataDir>/feed-snapshot.json');
  const feedSynced = Boolean(
    hubState?.feed &&
      (hubState.feed.feedExists ||
        hubState.feed.generatedAt ||
        hubState.feed.updatedAt ||
        hubState.feed.paths?.feedFile ||
        hubState.feed.paths?.feedSnapshotPath),
  );
  const teamPreset = hubState?.teamPreset ?? null;

  const renderStrategyDrawer = (modId: ModuleId): React.ReactNode => {
    const meta = MODULE_CATALOG[modId];
    const modText = dict.modules[modId];

    if (drawerLoading && CONFIGURABLE_STRATEGY_MODULES.has(modId)) {
      return (
        <div className="nov-drawer">
          <span className="nov-muted">{dict.common.loading}</span>
        </div>
      );
    }

    return (
      <div className="nov-drawer" aria-label={`${modText.name} ${sh.strategyTitle}`}>
        <div className="nov-drawer-head">
          <strong className="nov-drawer-title">
            {sh.strategyTitle} · {modText.shortLabel}
          </strong>
          <button
            type="button"
            className="nov-open-btn"
            onClick={() => onOpenModule(modId)}
          >
            {sh.openFullPanelBtn}
          </button>
        </div>

        {drawerError && <div className="nov-drawer-error">{drawerError}</div>}

        {modId === 'guard' && guardData && (
          <div className="nov-drawer-grid">
            <label className="nov-drawer-field">
              <span>.env / SSH / Keys</span>
              <select
                className="nov-p-select"
                value={guardData.policy.protectEnvAndKeys}
                disabled={drawerSaving}
                onChange={(e) =>
                  void updateGuardPolicy({ protectEnvAndKeys: e.target.value as GuardDecision })
                }
              >
                <option value="deny">DENY — {dict.panels.guard.blocked}</option>
                <option value="ask">ASK — {dict.panels.guard.ask}</option>
                <option value="allow">ALLOW — {dict.panels.guard.safe}</option>
              </select>
            </label>

            <label className="nov-drawer-field">
              <span>{dict.panels.guard.tabScanner} (Write)</span>
              <select
                className="nov-p-select"
                value={guardData.policy.blockSecretWrites}
                disabled={drawerSaving}
                onChange={(e) =>
                  void updateGuardPolicy({ blockSecretWrites: e.target.value as GuardDecision })
                }
              >
                <option value="deny">DENY — {dict.panels.guard.blocked}</option>
                <option value="ask">ASK — {dict.panels.guard.ask}</option>
                <option value="allow">ALLOW — {dict.panels.guard.safe}</option>
              </select>
            </label>

            <label className="nov-drawer-field">
              <span>Shell Firewall</span>
              <select
                className="nov-p-select"
                value={guardData.policy.blockDestructiveCommands}
                disabled={drawerSaving}
                onChange={(e) =>
                  void updateGuardPolicy({
                    blockDestructiveCommands: e.target.value as GuardDecision,
                  })
                }
              >
                <option value="deny">DENY — {dict.panels.guard.blocked}</option>
                <option value="ask">ASK — {dict.panels.guard.ask}</option>
                <option value="allow">ALLOW — {dict.panels.guard.safe}</option>
              </select>
            </label>

            <div className="nov-drawer-toggle-row">
              <span>{dict.panels.guard.tabSnapshots} (Auto)</span>
              <button
                type="button"
                role="switch"
                aria-checked={guardData.policy.autoSnapshotBeforeEdit}
                className="nov-switch"
                disabled={drawerSaving}
                onClick={() =>
                  void updateGuardPolicy({
                    autoSnapshotBeforeEdit: !guardData.policy.autoSnapshotBeforeEdit,
                  })
                }
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>
          </div>
        )}

        {modId === 'verify' && verifyData && (
          <div className="nov-drawer-grid">
            <div className="nov-drawer-toggle-row">
              <span>{dict.panels.verify.enforceOnStop}</span>
              <button
                type="button"
                role="switch"
                aria-checked={verifyData.policy.enforceOnStop}
                className="nov-switch"
                disabled={drawerSaving}
                onClick={() =>
                  void updateVerifyPolicy({ enforceOnStop: !verifyData.policy.enforceOnStop })
                }
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>

            <div className="nov-drawer-toggle-row">
              <span>{dict.panels.verify.autoRunOnStop}</span>
              <button
                type="button"
                role="switch"
                aria-checked={verifyData.policy.autoRunOnStop}
                className="nov-switch"
                disabled={drawerSaving}
                onClick={() =>
                  void updateVerifyPolicy({ autoRunOnStop: !verifyData.policy.autoRunOnStop })
                }
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>

            <div className="nov-drawer-toggle-row">
              <span>{dict.panels.verify.blockEmptyWrites}</span>
              <button
                type="button"
                role="switch"
                aria-checked={verifyData.policy.blockEmptyWrites}
                className="nov-switch"
                disabled={drawerSaving}
                onClick={() =>
                  void updateVerifyPolicy({
                    blockEmptyWrites: !verifyData.policy.blockEmptyWrites,
                  })
                }
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>

            <label className="nov-drawer-field">
              <span>{dict.panels.verify.maxBlocks} (1–10)</span>
              <input
                type="number"
                className="nov-p-input"
                min={1}
                max={10}
                value={verifyData.policy.maxConsecutiveBlocks}
                disabled={drawerSaving}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(10, Math.floor(Number(e.target.value) || 1)));
                  void updateVerifyPolicy({ maxConsecutiveBlocks: val });
                }}
              />
            </label>
          </div>
        )}

        {modId === 'spec' && specData && (
          <div className="nov-drawer-stack">
            {!specData.activeSpec ? (
              <div className="nov-muted">{dict.panels.spec.emptySpecs}</div>
            ) : (
              <>
                <div className="nov-p-row">
                  <span className="nov-mono">{specData.activeSpec.title}</span>
                  <span
                    className={`nov-badge ${specData.writeLockActive ? 'is-network' : 'is-offline'}`}
                  >
                    {specData.writeLockActive
                      ? dict.panels.spec.writeLockOn
                      : dict.panels.spec.writeLockOff}
                  </span>
                </div>
                <div className="nov-drawer-grid">
                  <div className="nov-drawer-toggle-row">
                    <span>{dict.panels.spec.enforceLockLabel}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={specData.activeSpec.enforcePlanBeforeWrite}
                      className="nov-switch"
                      disabled={drawerSaving}
                      onClick={() =>
                        void updateSpecGuardrails({
                          enforcePlanBeforeWrite: !specData.activeSpec!.enforcePlanBeforeWrite,
                        })
                      }
                    >
                      <span className="nov-switch-thumb" />
                    </button>
                  </div>

                  <div className="nov-drawer-toggle-row">
                    <span>{dict.panels.spec.requireUiApprovalLabel}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={specData.activeSpec.requireUiApproval}
                      className="nov-switch"
                      disabled={drawerSaving}
                      onClick={() =>
                        void updateSpecGuardrails({
                          requireUiApproval: !specData.activeSpec!.requireUiApproval,
                        })
                      }
                    >
                      <span className="nov-switch-thumb" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {modId === 'radar' && radarData && (
          <div className="nov-drawer-grid">
            <div className="nov-drawer-toggle-row">
              <span>{dict.radar.soundChime}</span>
              <button
                type="button"
                role="switch"
                aria-checked={radarData.prefs.soundChime}
                className="nov-switch"
                disabled={drawerSaving}
                onClick={() =>
                  void updateRadarPrefs({ soundChime: !radarData.prefs.soundChime })
                }
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>

            <div className="nov-drawer-toggle-row">
              <span>{dict.radar.desktopNotify}</span>
              <button
                type="button"
                role="switch"
                aria-checked={radarData.prefs.desktopNotify}
                className="nov-switch"
                disabled={drawerSaving}
                onClick={() =>
                  void updateRadarPrefs({ desktopNotify: !radarData.prefs.desktopNotify })
                }
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>

            <label className="nov-drawer-field">
              <span>{dict.radar.stallThreshold} (1–120)</span>
              <input
                type="number"
                className="nov-p-input"
                min={1}
                max={120}
                value={radarData.prefs.stallMinutes}
                disabled={drawerSaving}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(120, Math.floor(Number(e.target.value) || 5)));
                  void updateRadarPrefs({ stallMinutes: val });
                }}
              />
            </label>
          </div>
        )}

        {modId === 'remote' && remoteData && (
          <div className="nov-drawer-stack">
            <div className="nov-card-tags">
              <span className={`nov-badge ${remoteData.running ? 'is-network' : 'is-offline'}`}>
                {remoteData.running ? dict.statusGatewayRunning : dict.common.disabled}
              </span>
              <span className="nov-badge">
                {remoteData.host || '127.0.0.1'}:{remoteData.port ?? 0}
              </span>
              <span className="nov-badge">
                PWA: {remoteData.status?.connectedClients ?? 0}
              </span>
              <span className="nov-badge">
                IM: {(remoteData.channels ?? []).filter((c) => c.enabled).length}
              </span>
            </div>

            <div className="nov-drawer-grid">
              <div className="nov-drawer-toggle-row">
                <span>Remote Approval Gate</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(remoteData.status?.remoteApprovalEnabled)}
                  className="nov-switch"
                  disabled={drawerSaving}
                  onClick={() =>
                    void updateRemoteSettings({
                      remoteApprovalEnabled: !remoteData.status?.remoteApprovalEnabled,
                    })
                  }
                >
                  <span className="nov-switch-thumb" />
                </button>
              </div>

              <div className="nov-drawer-toggle-row">
                <span>Stop Alerts (IM)</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(remoteData.status?.notifyOnStop)}
                  className="nov-switch"
                  disabled={drawerSaving}
                  onClick={() =>
                    void updateRemoteSettings({
                      notifyOnStop: !remoteData.status?.notifyOnStop,
                    })
                  }
                >
                  <span className="nov-switch-thumb" />
                </button>
              </div>

              <div className="nov-drawer-field">
                <span>Gateway Port (0–65535)</span>
                <div className="nov-inline-input-row">
                  <input
                    type="number"
                    className="nov-p-input"
                    min={0}
                    max={65535}
                    value={remotePortDraft}
                    disabled={drawerSaving}
                    onChange={(e) => setRemotePortDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    className="nov-p-btn"
                    disabled={drawerSaving}
                    onClick={() => {
                      const parsed = Number(remotePortDraft);
                      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
                        void updateRemoteSettings({ port: parsed });
                      }
                    }}
                  >
                    {dict.common.save}
                  </button>
                </div>
              </div>
            </div>
            <div className="nov-muted">{dict.panels.remote.liveStreamHint}</div>
          </div>
        )}

        {!CONFIGURABLE_STRATEGY_MODULES.has(modId) && (
          <div className="nov-drawer-stack">
            <p className="nov-drawer-desc">{modText.description}</p>
            <div className="nov-card-tags">
              <span className="nov-badge is-offline">{dict.badgeOffline}</span>
              <span className="nov-badge">
                {t(dict.badgeToolsCount, { n: meta.modelToolNames.length })}
              </span>
              <span className="nov-badge">
                {meta.hooks.length > 0
                  ? t(dict.badgeHooks, { hooks: meta.hooks.join(', ') })
                  : dict.badgeNoHooks}
              </span>
              {modId === 'mem' &&
                typeof (feedSummary.mem?.totalMemories ?? feedSummary.mem?.total) === 'number' && (
                  <span className="nov-badge is-accent">
                    {feedSummary.mem?.totalMemories ?? feedSummary.mem?.total} ·{' '}
                    {dict.hub.staleMemBadge}:{' '}
                    {feedSummary.mem?.staleCount ??
                      feedSummary.mem?.stale ??
                      feedSummary.mem?.drifted ??
                      0}
                  </span>
                )}
              {modId === 'turbo' &&
                typeof (feedSummary.turbo?.totalSavedTokens ?? feedSummary.turbo?.savedTokens) ===
                  'number' && (
                  <span className="nov-badge is-accent">
                    ~{feedSummary.turbo?.totalSavedTokens ?? feedSummary.turbo?.savedTokens} tok
                  </span>
                )}
              {modId === 'xray' &&
                typeof (feedSummary.xray?.peakContextTokens ?? feedSummary.xray?.totalTokens) ===
                  'number' && (
                  <span className="nov-badge is-accent">
                    {feedSummary.xray?.peakContextTokens ?? feedSummary.xray?.totalTokens} tok
                    {typeof feedSummary.xray?.estimatedCostUsd === 'number' &&
                    feedSummary.xray.estimatedCostUsd > 0
                      ? ` · $${feedSummary.xray.estimatedCostUsd.toFixed(2)}`
                      : ''}
                  </span>
                )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="nov-settings-page">
      {/* S1: Global Mode, Live Search, Presets & Tool Budget */}
      <section className="nov-p-card nov-settings-s1" aria-label={sh.title}>
        <div className="nov-p-row">
          <div>
            <h2 className="nov-hero-title">{sh.title}</h2>
            <p className="nov-hero-sub">{sh.subtitle}</p>
          </div>
          <span className="nov-metric-chip is-offline">
            <strong>{dict.badgeZeroCdp}</strong>
          </span>
        </div>

        {/* Live Search across S1-S4 */}
        <div className="nov-search-wrap">
          <input
            type="search"
            className="nov-p-input"
            aria-label={sh.searchPlaceholder}
            placeholder={sh.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="nov-p-btn"
              onClick={() => setSearchQuery('')}
            >
              {sh.searchClear}
            </button>
          )}
        </div>

        {/* 5 Presets */}
        <div className="nov-presets-bar" aria-label={dict.presetsLabel}>
          <span className="nov-presets-label">{dict.presetsLabel}</span>
          {PRESET_IDS.map((pid) => {
            const def = dict.presets[pid];
            const active = snapshot.config.preset === pid;
            return (
              <button
                key={pid}
                type="button"
                className={`nov-preset-btn ${active ? 'is-active' : ''}`}
                title={def.description}
                disabled={busyKey !== null}
                onClick={() => void onApplyPreset(pid)}
              >
                {def.label}
              </button>
            );
          })}
          {snapshot.config.preset === 'custom' && (
            <span className="nov-badge">{dict.customSelection}</span>
          )}
        </div>

        {/* MCP Tool Slot Budget Progress Bar */}
        <div className="nov-budget-block">
          <div className="nov-p-row">
            <span className="nov-budget-label">
              {dict.nav.toolBudgetLabel}:{' '}
              <strong>
                {exposedTools} / {budgetLimit}
              </strong>{' '}
              ({snapshot.enabledCount}/{snapshot.totalModules || MODULE_IDS.length}{' '}
              {dict.metricModules})
            </span>
            <span className={`nov-badge ${budgetTone === 'is-safe' ? 'is-offline' : budgetTone === 'is-warn' ? 'is-network' : 'is-danger'}`}>
              {budgetPercent}%
            </span>
          </div>
          <div
            className="nov-budget-meter"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={budgetLimit}
            aria-valuenow={exposedTools}
            aria-label={dict.nav.toolBudgetLabel}
          >
            <div
              className={`nov-budget-fill ${budgetTone}`}
              style={{ width: `${budgetPercent}%` }}
            />
          </div>
        </div>

        {/* Language & Startup View Row */}
        <div className="nov-s1-controls">
          <label className="nov-s1-control-group">
            <span className="nov-s1-label">{dict.langToggleTitle}</span>
            <select
              className="nov-p-select"
              aria-label={dict.langToggleTitle}
              value={prefLocale}
              disabled={busyKey === 'locale'}
              onChange={(e) => void onChangeLocale(e.target.value as NovLocale)}
            >
              <option value="auto">{dict.langAutoOption}</option>
              {UI_LOCALE_IDS.map((loc) => (
                <option key={loc} value={loc}>
                  {LOCALE_NATIVE_LABELS[loc]}
                </option>
              ))}
            </select>
          </label>

          <div className="nov-s1-control-group">
            <span className="nov-s1-label">{sh.startupViewLabel}</span>
            <div className="nov-segmented" role="group" aria-label={sh.startupViewLabel}>
              <button
                type="button"
                className={`nov-seg-btn ${currentStartupView === 'hub' ? 'is-active' : ''}`}
                disabled={busyKey === 'startupView'}
                onClick={() => void onChangeStartupView('hub')}
              >
                {sh.startupHub}
              </button>
              <button
                type="button"
                className={`nov-seg-btn ${currentStartupView === 'last' ? 'is-active' : ''}`}
                disabled={busyKey === 'startupView'}
                onClick={() => void onChangeStartupView('last')}
              >
                {sh.startupLast}
              </button>
            </div>
          </div>
        </div>
      </section>

      {noSearchHits && (
        <div className="nov-p-card">
          <div className="nov-muted">{sh.searchNoHits}</div>
        </div>
      )}

      {/* S2 & S3: 4 Domain Groups — Sole Module Switch Source + On-Demand Strategy Drawer */}
      {filteredDomains.map(({ domainId, modules }) => {
        const domainText = dict.domains[domainId];
        const enabledInDomain = modules.filter((id) => snapshot.config.modules[id]).length;
        return (
          <section
            key={domainId}
            className="nov-domain-group"
            aria-label={domainText.label}
          >
            <div className="nov-category-heading">
              <div className="nov-domain-title-row">
                <h3>{domainText.label}</h3>
                <span className="nov-badge is-accent">{domainText.tierLabel}</span>
                <span className="nov-badge">
                  {enabledInDomain}/{modules.length}
                </span>
              </div>
              <span>{domainText.description}</span>
            </div>

            <div className="nov-module-rows">
              {modules.map((modId) => {
                const meta = MODULE_CATALOG[modId];
                const text = dict.modules[modId];
                const enabled = Boolean(snapshot.config.modules[modId]);
                const isBusy = busyKey === modId || busyKey === 'preset';
                const isExpanded = enabled && expandedModuleId === modId;
                const tierBadgeClass =
                  meta.isolationTier === 'offline' ? 'is-offline' : 'is-network';
                const tierBadgeText =
                  meta.isolationTier === 'offline' ? dict.badgeOffline : dict.badgeOptInNet;

                return (
                  <article
                    key={modId}
                    className={`nov-module-row-card ${enabled ? 'is-enabled' : 'is-disabled'}`}
                  >
                    <div className="nov-module-row-main">
                      <div className="nov-module-row-info">
                        <div className="nov-module-row-title-line">
                          <strong className="nov-module-row-name">{text.name}</strong>
                          <span className={`nov-badge ${tierBadgeClass}`}>{tierBadgeText}</span>
                          <span className="nov-badge">
                            {t(dict.badgeToolsCount, { n: meta.modelToolNames.length })}
                          </span>
                        </div>
                        <p className="nov-module-row-tagline">{text.tagline}</p>
                      </div>

                      <div className="nov-module-row-actions">
                        {/* Strictly on-demand: only show Configure trigger when module is ON */}
                        {enabled && (
                          <button
                            type="button"
                            className={`nov-open-btn ${isExpanded ? 'is-active' : ''}`}
                            aria-expanded={isExpanded}
                            onClick={() => handleToggleDrawer(modId)}
                          >
                            {isExpanded ? sh.collapseBtn : sh.configureBtn}
                          </button>
                        )}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          aria-label={`Toggle ${text.name}`}
                          className="nov-switch"
                          disabled={isBusy}
                          onClick={() => void onToggleModule(modId, !enabled)}
                        >
                          <span className="nov-switch-thumb" />
                        </button>
                      </div>
                    </div>

                    {/* S3: Lazy-loaded strategy drawer rendered only for the active expanded ON module */}
                    {isExpanded && renderStrategyDrawer(modId)}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* S4: Advanced & Team Governance (collapsed by default via <details>) */}
      {advancedMatchesQuery && (
        <details
          className="nov-advanced-details"
          open={Boolean(normalizedQuery) && advancedMatchesQuery}
        >
          <summary className="nov-advanced-summary">
            <div>
              <strong>{sh.advancedTitle}</strong>
              <div className="nov-muted">{sh.advancedSub}</div>
            </div>
          </summary>

          <div className="nov-advanced-body">
            {/* Export / Import Sanitized JSON */}
            <div className="nov-p-item">
              <div className="nov-p-row">
                <strong>
                  {sh.exportBtn} / {sh.importBtn}
                </strong>
                <div className="nov-inline-input-row">
                  <button
                    type="button"
                    className="nov-p-btn"
                    disabled={govBusy}
                    onClick={() => void handleExportConfig()}
                  >
                    {sh.exportBtn}
                  </button>
                  {exportedPayload && (
                    <button
                      type="button"
                      className="nov-p-btn"
                      onClick={() => void handleCopyExport()}
                    >
                      {exportCopied ? dict.common.copied : dict.common.copy}
                    </button>
                  )}
                </div>
              </div>
              <div className="nov-muted">{sh.safetyNotice}</div>

              {exportedPayload && (
                <pre className="nov-p-pre">
                  {JSON.stringify(exportedPayload, null, 2)}
                </pre>
              )}

              <textarea
                className="nov-p-textarea"
                rows={4}
                placeholder={sh.importPlaceholder}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <div className="nov-p-row">
                <button
                  type="button"
                  className="nov-p-btn is-primary"
                  disabled={govBusy || !importText.trim()}
                  onClick={() => void handleImportConfig()}
                >
                  {sh.importApplyBtn}
                </button>
                {importSuccessMsg && (
                  <span className="nov-badge is-offline">{importSuccessMsg}</span>
                )}
                {importError && <span className="nov-badge is-danger">{importError}</span>}
              </div>

              {importWarnings.length > 0 && (
                <ul className="nov-warning-list">
                  {importWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* Team Preset Status (.agy-nov.json) */}
            <div className="nov-p-item">
              <div className="nov-p-row">
                <strong>{sh.teamPresetSection}</strong>
                {teamPreset?.found ? (
                  <span className={`nov-badge ${teamPreset.valid ? 'is-offline' : 'is-danger'}`}>
                    {teamPreset.valid ? dict.ops.teamPresetValid : 'INVALID'}
                    {teamPreset.preset ? ` · ${teamPreset.preset}` : ''}
                  </span>
                ) : (
                  <span className="nov-badge">{dict.ops.teamPresetMissing}</span>
                )}
              </div>
              {teamPreset?.warnings && teamPreset.warnings.length > 0 && (
                <ul className="nov-warning-list">
                  {teamPreset.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* Dual-Star Feed Snapshot Contract & Slot Hint */}
            <div className="nov-p-item">
              <div className="nov-p-row">
                <strong>{sh.dualStarSection}</strong>
                <span className={`nov-badge ${feedSynced ? 'is-offline' : ''}`}>
                  {feedSynced ? sh.feedReady : sh.feedMissing}
                </span>
              </div>
              <div className="nov-mono nov-path-line">{feedPath}</div>
              <div className="nov-muted">{sh.idleSlotHint}</div>
            </div>

            {/* Inline Two-Step Reset Confirmation (zero window.confirm / window.alert) */}
            <div className="nov-p-item">
              <div className="nov-p-row">
                <strong>{sh.resetBtn}</strong>
                {!confirmingReset ? (
                  <button
                    type="button"
                    className="nov-p-btn is-danger"
                    disabled={govBusy}
                    onClick={() => setConfirmingReset(true)}
                  >
                    {sh.resetBtn}
                  </button>
                ) : (
                  <div className="nov-confirm-inline">
                    <button
                      type="button"
                      className="nov-p-btn is-danger"
                      disabled={govBusy}
                      onClick={() => void handleConfirmReset()}
                    >
                      {sh.resetConfirmBtn}
                    </button>
                    <button
                      type="button"
                      className="nov-p-btn"
                      disabled={govBusy}
                      onClick={() => setConfirmingReset(false)}
                    >
                      {sh.resetCancelBtn}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </details>
      )}
    </div>
  );
};
