import type {
  ModuleCategoryId,
  ModuleId,
  NovLocale,
  PresetId,
  ResolvedUiLocale,
} from '../../../src/core/catalog.js';

export type {
  ModuleCategoryId,
  ModuleId,
  NovLocale,
  PresetId,
  ResolvedUiLocale,
};

export interface ModuleI18nEntry {
  name: string;
  shortLabel: string;
  tagline: string;
  description: string;
}

export interface ReviewPanelI18n {
  title: string;
  scopeWorking: string;
  scopeStaged: string;
  scopeUnstaged: string;
  scopeHead: string;
  scopeRange: string;
  unified: string;
  split: string;
  filterFilesPlaceholder: string;
  refresh: string;
  copyPrompt: string;
  sendFixes: string;
  annotations: string;
  filesChanged: string;
  noChanges: string;
}

export interface GuardPanelI18n {
  title: string;
  tabSnapshots: string;
  tabAudit: string;
  tabPolicy: string;
  tabScanner: string;
  createCheckpoint: string;
  scanWorkspace: string;
  restore: string;
  safe: string;
  blocked: string;
  ask: string;
  rules: string;
  noSnapshots: string;
}

export interface XrayPanelI18n {
  title: string;
  tabOverview: string;
  tabFiles: string;
  tabTimeMachine: string;
  tabSteps: string;
  refresh: string;
  exportBrief: string;
  searchPlaceholder: string;
  totalTokens: string;
  cacheHitRate: string;
  freshTokens: string;
  cachedTokens: string;
}

export interface CanvasPanelI18n {
  title: string;
  publishNew: string;
  openFile: string;
  preview: string;
  annotations: string;
  resolveAll: string;
  sendFeedback: string;
  pinPlaceholder: string;
  emptyCanvas: string;
}

export interface MemPanelI18n {
  title: string;
  tabCards: string;
  tabGraph: string;
  tabAdd: string;
  tabInjection: string;
  searchPlaceholder: string;
  addMemory: string;
  injectContext: string;
  fresh: string;
  stale: string;
  forget: string;
  emptyMemories: string;
}

export interface RemotePanelI18n {
  title: string;
  tabHub: string;
  tabChannels: string;
  tabConversations: string;
  tabAudit: string;
  offlineNotice: string;
  startGateway: string;
  stopGateway: string;
  pairMobile: string;
  sendAlert: string;
  dispatchTask: string;
  promptPlaceholder: string;
}

export interface PanelsI18n {
  review: ReviewPanelI18n;
  guard: GuardPanelI18n;
  xray: XrayPanelI18n;
  canvas: CanvasPanelI18n;
  mem: MemPanelI18n;
  remote: RemotePanelI18n;
}

export interface UiDictionary {
  brandTitle: string;
  modulesBtn: string;
  modulesBtnTitle: string;
  langToggleTitle: string;
  langAutoOption: string;
  connectErrorTitle: string;
  retry: string;
  moduleOffTitle: string;
  enableModuleBtn: string;
  toastModuleToggled: string;
  toastPresetApplied: string;
  toastLocaleChanged: string;
  heroTitle: string;
  heroSub: string;
  metricModules: string;
  metricTools: string;
  metricNetwork: string;
  metricDemo: string;
  networkOffline: string;
  networkRemoteOn: string;
  demoFixture: string;
  presetsLabel: string;
  customSelection: string;
  categoryAll: string;
  badgeOffline: string;
  badgeZeroCdp: string;
  badgeOptInNet: string;
  badgeToolsCount: string;
  badgeNoHooks: string;
  badgeHooks: string;
  statusActive: string;
  statusDisabled: string;
  statusGatewayRunning: string;
  openModuleBtn: string;
  categories: Record<ModuleCategoryId, { label: string; description: string }>;
  presets: Record<PresetId, { label: string; description: string }>;
  modules: Record<ModuleId, ModuleI18nEntry>;
  common: {
    refresh: string;
    loading: string;
    copy: string;
    copied: string;
    save: string;
    delete: string;
    clear: string;
    run: string;
    enabled: string;
    disabled: string;
    empty: string;
  };
  turbo: {
    title: string;
    subtitle: string;
    tabSearch: string;
    tabOutline: string;
    tabCompact: string;
    queriesLabel: string;
    queriesPlaceholder: string;
    searchBtn: string;
    matchesSummary: string;
    filePathLabel: string;
    filePathPlaceholder: string;
    startLine: string;
    endLine: string;
    outlineBtn: string;
    symbolsTitle: string;
    sliceTitle: string;
    rawOutputLabel: string;
    rawOutputPlaceholder: string;
    compactBtn: string;
    queryChunkPlaceholder: string;
    queryChunkBtn: string;
    savedTokens: string;
    safetyNote: string;
  };
  radar: {
    title: string;
    subtitle: string;
    running: string;
    awaiting: string;
    completed: string;
    stalled: string;
    error: string;
    unread: string;
    ackBtn: string;
    clearDoneBtn: string;
    prefsTitle: string;
    desktopNotify: string;
    soundChime: string;
    stallThreshold: string;
    emptyBoard: string;
    lastTool: string;
    steps: string;
  };
  ops: {
    title: string;
    subtitle: string;
    tabPrompts: string;
    tabAudit: string;
    newPrompt: string;
    promptTitle: string;
    promptCategory: string;
    promptBody: string;
    renderBtn: string;
    sendToAgent: string;
    copyRendered: string;
    variablesTitle: string;
    renderedPreview: string;
    auditRefresh: string;
    auditAssets: string;
    auditStorage: string;
    auditEstTokens: string;
    auditFindings: string;
    auditCleanNote: string;
  };
  panels: PanelsI18n;
}

export interface NovI18nContextValue {
  locale: ResolvedUiLocale;
  prefLocale: NovLocale;
  dict: UiDictionary;
  t: (template: string, params?: Record<string, string | number>) => string;
}
