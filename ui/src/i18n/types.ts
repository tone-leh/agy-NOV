import type {
  ModuleCategoryId,
  ModuleDomainId,
  ModuleId,
  NovLocale,
  NovStartupView,
  PresetId,
  ResolvedUiLocale,
} from '../../../src/core/catalog.js';

export type {
  ModuleCategoryId,
  ModuleDomainId,
  ModuleId,
  NovLocale,
  NovStartupView,
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
  ignoreWhitespace: string;
  syntaxHighlight: string;
  riskLineBadge: string;
  quickAnnotateRisk: string;
  cartTitle: string;
  cartEmpty: string;
  cartCopyAll: string;
  cartSendAll: string;
  cartClear: string;
  addComment: string;
  commentPlaceholder: string;
  severityHigh: string;
  severityMed: string;
  severityLow: string;
  filesTitle: string;
  resolved: string;
  unresolved: string;
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
  tabCost: string;
  refresh: string;
  exportBrief: string;
  searchPlaceholder: string;
  totalTokens: string;
  cacheHitRate: string;
  freshTokens: string;
  cachedTokens: string;
  swarmTitle: string;
  subagents: string;
  orphanSuspects: string;
  modelBreakdown: string;
  estCostUsd: string;
  todayCost: string;
  weekCost: string;
  cacheSavings: string;
  fiveHourWindow: string;
  burnRate: string;
  exportHandoff: string;
  exportOtlp: string;
  exportCsv: string;
  dailyTrendTitle: string;
  compositionTitle: string;
  hotspotsTitle: string;
  diagnosticsTitle: string;
  filesEmpty: string;
  openFile: string;
  attachContext: string;
  timeMachineTitle: string;
  artifactsTitle: string;
  injectExcerpt: string;
  noSearchHits: string;
}

export interface VerifyPanelI18n {
  title: string;
  subtitle: string;
  tabGate: string;
  tabEvidence: string;
  enforceOnStop: string;
  autoRunOnStop: string;
  blockEmptyWrites: string;
  maxBlocks: string;
  commandsTitle: string;
  addCommand: string;
  runChecks: string;
  clearHistory: string;
  savePolicy: string;
  passed: string;
  failed: string;
  blocked: string;
  emptyEvidence: string;
  dirtyFiles: string;
  executablePlaceholder: string;
  argsPlaceholder: string;
  labelPlaceholder: string;
  detectStackBtn: string;
  detectedCommandsTitle: string;
  applyDetectedBtn: string;
  noDetectedCommands: string;
}

export interface WorktreePanelI18n {
  title: string;
  subtitle: string;
  createTitle: string;
  branchPlaceholder: string;
  baseRefPlaceholder: string;
  carryUncommitted: string;
  createBtn: string;
  pruneBtn: string;
  diffBtn: string;
  removeBtn: string;
  forceRemoveBtn: string;
  mainBadge: string;
  dirtyBadge: string;
  mergedBadge: string;
  prunableBadge: string;
  configWarning: string;
  notGitRepo: string;
  emptyWorktrees: string;
  diffTitle: string;
  aheadBehind: string;
}

export interface SpecPanelI18n {
  title: string;
  subtitle: string;
  tabBoard: string;
  tabCreate: string;
  writeLockOn: string;
  writeLockOff: string;
  statusDraft: string;
  statusApproved: string;
  statusCompleted: string;
  statusArchived: string;
  approveBtn: string;
  revertDraftBtn: string;
  enforceLockLabel: string;
  requireUiApprovalLabel: string;
  tasksTitle: string;
  readyBadge: string;
  waitingBadge: string;
  doneBadge: string;
  inProgressBadge: string;
  blockedBadge: string;
  specTitlePlaceholder: string;
  specGoalPlaceholder: string;
  addTaskPlaceholder: string;
  createSpecBtn: string;
  emptySpecs: string;
  acceptanceTitle: string;
}

export interface StudioPanelI18n {
  title: string;
  subtitle: string;
  tabData: string;
  tabDocs: string;
  tabHttp: string;
  sourcesTitle: string;
  refreshSources: string;
  filePathPlaceholder: string;
  sqlQueryPlaceholder: string;
  filterPlaceholder: string;
  inspectBtn: string;
  probeBtn: string;
  urlPlaceholder: string;
  loopbackOnlyNote: string;
  headersPlaceholder: string;
  bodyPlaceholder: string;
  emptySources: string;
  rowsCount: string;
  statusCode: string;
  truncatedNotice: string;
  openApiEndpointsTitle: string;
  loadEndpointBtn: string;
  openApiEmpty: string;
  serversTitle: string;
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
  progressiveIndexBadge: string;
  privateTagHint: string;
  recallModeIndex: string;
  recallModeTimeline: string;
  recallModeDetail: string;
  tokenSavingsNote: string;
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
  liveStreamTitle: string;
  liveStreamHint: string;
  tunnelGuideTitle: string;
  detectTunnelBtn: string;
  tunnelNotDetected: string;
  tunnelDetected: string;
  tunnelSafetyNote: string;
}

export interface PanelsI18n {
  review: ReviewPanelI18n;
  guard: GuardPanelI18n;
  xray: XrayPanelI18n;
  verify: VerifyPanelI18n;
  worktree: WorktreePanelI18n;
  spec: SpecPanelI18n;
  studio: StudioPanelI18n;
  canvas: CanvasPanelI18n;
  mem: MemPanelI18n;
  remote: RemotePanelI18n;
}

export interface DomainI18nEntry {
  label: string;
  description: string;
  tierLabel: string;
}

export interface NavI18n {
  hubLabel: string;
  settingsLabel: string;
  switchModulePlaceholder: string;
  commandPaletteTitle: string;
  commandPalettePlaceholder: string;
  commandPaletteEmpty: string;
  openSettingsTip: string;
  toolBudgetLabel: string;
  narrowSwitcherLabel: string;
}

export interface HubI18n {
  title: string;
  subtitle: string;
  pipelineTitle: string;
  alertsTitle: string;
  noAlerts: string;
  quickActionsTitle: string;
  openModule: string;
  enableToUse: string;
  writeLockBadge: string;
  staleMemBadge: string;
  blockedBadge: string;
  verifyPass: string;
  verifyFail: string;
  verifyIdle: string;
  dualStarReady: string;
}

export interface SettingsHubI18n {
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  searchClear: string;
  searchNoHits: string;
  startupViewLabel: string;
  startupHub: string;
  startupLast: string;
  configureBtn: string;
  collapseBtn: string;
  strategyTitle: string;
  openFullPanelBtn: string;
  advancedTitle: string;
  advancedSub: string;
  teamPresetSection: string;
  exportBtn: string;
  importBtn: string;
  importPlaceholder: string;
  importApplyBtn: string;
  resetBtn: string;
  resetConfirmBtn: string;
  resetCancelBtn: string;
  dualStarSection: string;
  feedReady: string;
  feedMissing: string;
  idleSlotHint: string;
  safetyNotice: string;
  importSuccess: string;
  resetSuccess: string;
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
  domains: Record<ModuleDomainId, DomainI18nEntry>;
  nav: NavI18n;
  hub: HubI18n;
  settingsHub: SettingsHubI18n;
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
    presetLabel: string;
    compressionSaved: string;
    gainTitle: string;
    gainTokensSaved: string;
    gainEstUsdSaved: string;
    gainAvgRatio: string;
    gainOpsCount: string;
    guardrailBadge: string;
    nestedOutlineNote: string;
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
    subagents: string;
    orphanSubagents: string;
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
    ruleBloatTitle: string;
    toolBudgetTitle: string;
    mcpHealthTitle: string;
    teamPresetTitle: string;
    teamPresetMissing: string;
    teamPresetValid: string;
    teamPresetWarnings: string;
    crossClientTitle: string;
    crossClientEmpty: string;
  };
  panels: PanelsI18n;
  quickStart: {
    title: string;
    subtitle: string;
    step1: string;
    step2: string;
    step3: string;
    tryNowBtn: string;
    dismissBtn: string;
  };
}

export interface NovI18nContextValue {
  locale: ResolvedUiLocale;
  prefLocale: NovLocale;
  dict: UiDictionary;
  t: (template: string, params?: Record<string, string | number>) => string;
}
