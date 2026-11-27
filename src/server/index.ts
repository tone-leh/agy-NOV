import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RootsListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  applyPresetConfig,
  countEnabledModelTools,
  createDefaultConfig,
  exportSanitizedConfig,
  getConfigFileSignature,
  getConfigPath,
  LOCALE_IDS,
  loadOrInitNovConfig,
  loadTeamPresetReadOnly,
  MAX_CONFIG_IMPORT_BYTES,
  MODULE_CATALOG,
  MODULE_IDS,
  normalizeConfig,
  parseAndValidateConfigImport,
  PRESET_IDS,
  resetNovConfig,
  resolveNovDataDir,
  saveNovConfig,
  setModuleEnabled,
  setNovLocale,
  setNovStartupView,
  STARTUP_VIEW_IDS,
  type ModuleId,
  type NovConfig,
  type NovLocale,
  type NovStartupView,
  type PresetId,
} from '../core/config.js';
import {
  buildDemoFeedSnapshot,
  buildFeedSnapshot,
  writeFeedSnapshotIfDataDirExists,
} from '../core/feed.js';
import type {
  ModuleRegistrationResult,
  ModuleRuntimeState,
  ModuleToolHandle,
  NovConfigSnapshotPayload,
  NovRuntimeOptions,
} from '../core/types.js';
import { canonicalRealpathSync, hasCliFlag, parseCliFlag } from '../core/utils.js';
import { registerCanvasModule } from '../modules/canvas/register.js';
import { registerGuardModule } from '../modules/guard/register.js';
import { registerMemModule } from '../modules/mem/register.js';
import { registerOpsModule } from '../modules/ops/register.js';
import { registerRadarModule } from '../modules/radar/register.js';
import { registerRemoteModule } from '../modules/remote/register.js';
import { registerReviewModule } from '../modules/review/register.js';
import { registerSpecModule } from '../modules/spec/register.js';
import { registerStudioModule } from '../modules/studio/register.js';
import { registerTurboModule } from '../modules/turbo/register.js';
import { registerVerifyModule } from '../modules/verify/register.js';
import { registerWorktreeModule } from '../modules/worktree/register.js';
import { registerXrayModule } from '../modules/xray/register.js';
import { NOV_CONTEXT_RESOURCE_URIS, registerNovContextResources } from './context-resources.js';

export { NOV_CONTEXT_RESOURCE_URIS };
export const UI_RESOURCE_URI = 'ui://agy-nov/app.html';
export const NOV_VERSION = '1.2.0';

const MCP_APPS_UI_EXTENSION_ID = 'io.modelcontextprotocol/ui';

function hasMcpAppsUiCapability(capabilities: unknown): boolean {
  if (!capabilities || typeof capabilities !== 'object') return false;
  const caps = capabilities as Record<string, unknown>;
  const extensions = caps.extensions;
  if (extensions && typeof extensions === 'object' && MCP_APPS_UI_EXTENSION_ID in (extensions as Record<string, unknown>)) {
    return Boolean((extensions as Record<string, unknown>)[MCP_APPS_UI_EXTENSION_ID]);
  }
  const experimental = caps.experimental;
  if (
    experimental &&
    typeof experimental === 'object' &&
    MCP_APPS_UI_EXTENSION_ID in (experimental as Record<string, unknown>)
  ) {
    return Boolean((experimental as Record<string, unknown>)[MCP_APPS_UI_EXTENSION_ID]);
  }
  return false;
}

function resolveLocalRootFileUri(uri: string): string | null {
  if (typeof uri !== 'string' || !/^file:\/\//i.test(uri.trim())) return null;
  try {
    const parsed = new URL(uri.trim());
    if (parsed.protocol !== 'file:') return null;
    const host = parsed.hostname.toLowerCase();
    if (host !== '' && host !== 'localhost') return null;
    const fsPath = fileURLToPath(parsed);
    const real = canonicalRealpathSync(fsPath);
    if (!fs.statSync(real).isDirectory()) return null;
    return real;
  } catch {
    return null;
  }
}

const UI_ENTRYPOINT_META = {
  ui: { resourceUri: UI_RESOURCE_URI },
  'com.google.antigravity/ui': {
    entrypoints: [
      { type: 'aux_pane', title: 'agy-NOV' },
      { type: 'global', title: 'agy-NOV' },
    ],
  },
};

const APP_ONLY_META = {
  ui: { visibility: ['app'] },
};

type OpenTabId = ModuleId | 'modules' | 'hub' | 'settings';
const OPEN_TAB_ENUM = [...MODULE_IDS, 'modules', 'hub', 'settings'] as [
  OpenTabId,
  ...OpenTabId[],
];

function resolveUiHtmlPath(override?: string): string {
  const envOverride = process.env.AGY_NOV_APP_HTML;
  const scriptDir = process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : '';
  const candidates = [
    override,
    envOverride,
    scriptDir ? path.resolve(scriptDir, 'ui/app.html') : '',
    scriptDir ? path.resolve(scriptDir, '../dist/ui/app.html') : '',
    path.resolve(process.cwd(), 'dist/ui/app.html'),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? path.resolve(process.cwd(), 'dist/ui/app.html');
}

export const DEFAULT_CONFIG_POLL_MS = 1500;

export interface NovServerBundle {
  server: McpServer;
  options: NovRuntimeOptions;
  getConfig: () => NovConfig;
  getSnapshot: () => NovConfigSnapshotPayload;
  setModule: (moduleId: ModuleId, enabled: boolean) => Promise<NovConfig>;
  applyPreset: (preset: PresetId) => Promise<NovConfig>;
  setLocale: (locale: NovLocale) => Promise<NovConfig>;
  setStartupView: (startupView: NovStartupView) => Promise<NovConfig>;
  resetConfig: () => Promise<NovConfig>;
  setWorkspaceRoot: (dir: string) => boolean;
  hasUiAppToolsEnabled: () => boolean;
  subscribeSnapshot: (listener: (snapshot: NovConfigSnapshotPayload) => void) => () => void;
  syncConfigFromDisk: () => Promise<boolean>;
  dispose: () => Promise<void>;
}

function hasConfigChanged(prev: NovConfig, next: NovConfig): boolean {
  if (
    prev.locale !== next.locale ||
    prev.defaultTab !== next.defaultTab ||
    (prev.startupView ?? 'hub') !== (next.startupView ?? 'hub')
  ) {
    return true;
  }
  return MODULE_IDS.some((id) => Boolean(prev.modules[id]) !== Boolean(next.modules[id]));
}

function readDiskConfigForSync(
  rootDataDir: string,
):
  | { status: 'missing'; config: NovConfig }
  | { status: 'ok'; config: NovConfig }
  | { status: 'invalid' } {
  const cfgPath = getConfigPath(rootDataDir);
  let rawText: string;
  try {
    rawText = fs.readFileSync(cfgPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { status: 'missing', config: createDefaultConfig() };
    }
    return { status: 'invalid' };
  }
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { status: 'invalid' };
    }
    return { status: 'ok', config: normalizeConfig(parsed) };
  } catch {
    return { status: 'invalid' };
  }
}

export function createNovServer(rawOpts: Partial<NovRuntimeOptions> = {}): NovServerBundle {
  const options: NovRuntimeOptions = {
    dataDir: resolveNovDataDir(rawOpts.dataDir),
    workspaceRoot: path.resolve(rawOpts.workspaceRoot ?? process.cwd()),
    demoMode: Boolean(rawOpts.demoMode),
    brainDir: rawOpts.brainDir,
    uiHtmlPath: rawOpts.uiHtmlPath,
    configPollMs: rawOpts.configPollMs,
    exposeAppToolsWithoutUiCapability: rawOpts.exposeAppToolsWithoutUiCapability,
  };

  let currentConfig: NovConfig = loadOrInitNovConfig(options.dataDir);
  let lastConfigSignature: string | null = getConfigFileSignature(options.dataDir);
  let toggleQueue: Promise<void> = Promise.resolve();
  let disposed = false;
  let uiAppToolsAllowed = true;
  let lastSyncedUiAllowed = true;
  const snapshotListeners = new Set<(snapshot: NovConfigSnapshotPayload) => void>();
  const lastSyncedVisibility = new Map<ModuleId, boolean>();
  const exemptAppOnlyHandles: ModuleToolHandle[] = [];
  const topLevelAppOnlyHandles: ModuleToolHandle[] = [];

  const server = new McpServer(
    { name: 'agy-nov', version: NOV_VERSION },
    { capabilities: { tools: { listChanged: true }, resources: {} } },
  );

  // Register unified single-file HTML MCP App UI resource (8 native languages, dark & light)
  server.registerResource(
    'agy-nov-ui',
    UI_RESOURCE_URI,
    {
      title: 'agy-NOV Modular Super-Workbench',
      description: 'Unified 8-language modular side-pane and global MCP App UI for agy-NOV',
      mimeType: 'text/html;profile=mcp-app',
    },
    async () => {
      const htmlPath = resolveUiHtmlPath(options.uiHtmlPath);
      const html = fs.existsSync(htmlPath)
        ? fs.readFileSync(htmlPath, 'utf8')
        : '<!doctype html><html><body><p>agy-NOV UI bundle missing. Run npm run build.</p></body></html>';
      return {
        contents: [
          {
            uri: UI_RESOURCE_URI,
            mimeType: 'text/html;profile=mcp-app',
            text: html,
            _meta: { ui: { prefersBorder: false } },
          },
        ],
      };
    },
  );

  // Register zero-injection-tax read-only on-demand MCP context resources (+0 model tools)
  registerNovContextResources(server, options, async () => {
    await syncConfigFromDiskIfChanged();
    return currentConfig;
  });

  const registrations = new Map<ModuleId, ModuleRegistrationResult>();

  function buildConfigSnapshot(): NovConfigSnapshotPayload {
    const enabledCount = MODULE_IDS.filter((id) => currentConfig.modules[id]).length;
    const remoteReg = registrations.get('remote');
    const remoteRunning = Boolean(remoteReg?.isRuntimeRunning?.());
    const moduleRuntimes: Partial<Record<ModuleId, ModuleRuntimeState>> = {};

    for (const id of MODULE_IDS) {
      const reg = registrations.get(id);
      if (!reg) continue;
      if (reg.getRuntimeState) {
        moduleRuntimes[id] = reg.getRuntimeState();
      } else if (reg.isRuntimeRunning) {
        moduleRuntimes[id] = { running: Boolean(reg.isRuntimeRunning()) };
      }
    }

    return {
      config: currentConfig,
      enabledCount,
      totalModules: MODULE_IDS.length,
      exposedModelTools: countEnabledModelTools(currentConfig.modules),
      remoteRunning,
      moduleRuntimes,
      demoMode: options.demoMode,
      workspaceRoot: options.workspaceRoot,
    };
  }

  function enqueueMutation<T>(fn: () => Promise<T>): Promise<T> {
    const run = toggleQueue.then(fn, fn);
    toggleQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function broadcastSnapshot(): void {
    if (snapshotListeners.size === 0) return;
    const snap = buildConfigSnapshot();
    for (const listener of snapshotListeners) {
      try {
        listener(snap);
      } catch {
        // isolate subscriber errors
      }
    }
  }

  function subscribeSnapshot(listener: (snapshot: NovConfigSnapshotPayload) => void): () => void {
    snapshotListeners.add(listener);
    return () => {
      snapshotListeners.delete(listener);
    };
  }

  const toolEnabledState = new WeakMap<ModuleToolHandle, boolean>();
  const baseSendToolListChanged = server.sendToolListChanged.bind(server);

  function setHandleEnabled(handle: ModuleToolHandle, targetEnabled: boolean): boolean {
    const current = toolEnabledState.get(handle) ?? true;
    if (current === targetEnabled) return false;
    toolEnabledState.set(handle, targetEnabled);
    if (targetEnabled) handle.enable();
    else handle.disable();
    return true;
  }

  function syncToolVisibility(cfg: NovConfig, forceResync = false): void {
    const uiStateChanged = forceResync || lastSyncedUiAllowed !== uiAppToolsAllowed;
    let anyChanged = false;
    // Coalesce batch enable/disable calls into at most ONE notifications/tools/list_changed emission
    server.sendToolListChanged = () => {
      anyChanged = true;
    };
    try {
      if (uiStateChanged) {
        lastSyncedUiAllowed = uiAppToolsAllowed;
        for (const h of [...topLevelAppOnlyHandles, ...exemptAppOnlyHandles]) {
          if (setHandleEnabled(h, uiAppToolsAllowed)) {
            anyChanged = true;
          }
        }
      }
      for (const id of MODULE_IDS) {
        const reg = registrations.get(id);
        if (!reg) continue;
        const on = Boolean(cfg.modules[id]);
        const prev = lastSyncedVisibility.get(id);
        if (!uiStateChanged && prev === on) continue;
        lastSyncedVisibility.set(id, on);
        if (!uiStateChanged && prev === undefined && on) continue;
        for (const tool of reg.modelTools) {
          if (setHandleEnabled(tool, on)) {
            anyChanged = true;
          }
        }
        for (const appTool of reg.appTools ?? []) {
          if (setHandleEnabled(appTool, on && uiAppToolsAllowed)) {
            anyChanged = true;
          }
        }
      }
    } finally {
      server.sendToolListChanged = baseSendToolListChanged;
    }
    if (anyChanged) {
      baseSendToolListChanged();
    }
  }

  function setWorkspaceRoot(candidateDir: string): boolean {
    if (typeof candidateDir !== 'string' || !candidateDir.trim()) return false;
    try {
      const realDir = canonicalRealpathSync(path.resolve(candidateDir));
      if (!fs.statSync(realDir).isDirectory()) return false;
      if (realDir !== options.workspaceRoot) {
        options.workspaceRoot = realDir;
        broadcastSnapshot();
      }
      return true;
    } catch {
      return false;
    }
  }

  async function syncWorkspaceRootFromClientRoots(): Promise<void> {
    if (disposed) return;
    try {
      const clientCaps = server.server.getClientCapabilities();
      if (!clientCaps?.roots) return;
      const result = await server.server.listRoots();
      const roots = Array.isArray(result?.roots) ? result.roots : [];
      for (const root of roots) {
        const localDir = resolveLocalRootFileUri(root?.uri);
        if (localDir) {
          setWorkspaceRoot(localDir);
          return;
        }
      }
    } catch {
      // Client may not support roots/list or may reject during startup; keep current workspaceRoot
    }
  }

  async function syncModuleRuntimes(prev: NovConfig, next: NovConfig): Promise<void> {
    for (const id of MODULE_IDS) {
      if (prev.modules[id] === next.modules[id]) continue;
      const reg = registrations.get(id);
      if (reg?.setEnabledRuntime) {
        await reg.setEnabledRuntime(Boolean(next.modules[id]));
      }
    }
  }

  function refreshFeedSnapshotSafe(cfg: NovConfig): void {
    try {
      const remoteRunning = Boolean(registrations.get('remote')?.isRuntimeRunning?.());
      writeFeedSnapshotIfDataDirExists(options.dataDir, cfg, { remoteRunning });
    } catch {
      // Best-effort only: never fail config mutations on feed snapshot I/O errors
    }
  }

  function syncConfigFromDiskIfChanged(): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    return enqueueMutation(async () => {
      if (disposed) return false;
      const diskSig = getConfigFileSignature(options.dataDir);
      if (diskSig === lastConfigSignature) {
        return false;
      }

      let next: NovConfig;
      if (diskSig === null) {
        next = createDefaultConfig();
        lastConfigSignature = null;
      } else {
        const readRes = readDiskConfigForSync(options.dataDir);
        if (readRes.status === 'invalid') {
          // Transient partial/invalid JSON write: skip without mutating state or touching disk
          return false;
        }
        next = readRes.config;
        lastConfigSignature = readRes.status === 'missing' ? null : diskSig;
      }

      const prev = currentConfig;
      if (!hasConfigChanged(prev, next)) {
        return false;
      }

      currentConfig = next;
      syncToolVisibility(next);
      await syncModuleRuntimes(prev, next);
      broadcastSnapshot();
      refreshFeedSnapshotSafe(next);
      return true;
    });
  }

  const applySingleToggle = (moduleId: ModuleId, enabled: boolean): Promise<NovConfig> =>
    enqueueMutation(async () => {
      const prev = currentConfig;
      const next = setModuleEnabled(options.dataDir, moduleId, enabled);
      lastConfigSignature = getConfigFileSignature(options.dataDir);
      currentConfig = next;
      syncToolVisibility(next);
      await syncModuleRuntimes(prev, next);
      broadcastSnapshot();
      refreshFeedSnapshotSafe(next);
      return next;
    });

  const applyPresetMutation = (preset: PresetId): Promise<NovConfig> =>
    enqueueMutation(async () => {
      const prev = currentConfig;
      const next = applyPresetConfig(options.dataDir, preset);
      lastConfigSignature = getConfigFileSignature(options.dataDir);
      currentConfig = next;
      syncToolVisibility(next);
      await syncModuleRuntimes(prev, next);
      broadcastSnapshot();
      refreshFeedSnapshotSafe(next);
      return next;
    });

  const applyLocaleMutation = (locale: NovLocale): Promise<NovConfig> =>
    enqueueMutation(async () => {
      const prev = currentConfig;
      const next = setNovLocale(options.dataDir, locale);
      lastConfigSignature = getConfigFileSignature(options.dataDir);
      currentConfig = next;
      syncToolVisibility(next);
      await syncModuleRuntimes(prev, next);
      broadcastSnapshot();
      refreshFeedSnapshotSafe(next);
      return next;
    });

  const applyStartupViewMutation = (startupView: NovStartupView): Promise<NovConfig> =>
    enqueueMutation(async () => {
      const prev = currentConfig;
      const next = setNovStartupView(options.dataDir, startupView);
      lastConfigSignature = getConfigFileSignature(options.dataDir);
      currentConfig = next;
      syncToolVisibility(next);
      await syncModuleRuntimes(prev, next);
      broadcastSnapshot();
      refreshFeedSnapshotSafe(next);
      return next;
    });

  const applyImportConfigMutation = (importedConfig: NovConfig): Promise<NovConfig> =>
    enqueueMutation(async () => {
      const prev = currentConfig;
      const next = saveNovConfig(options.dataDir, importedConfig);
      lastConfigSignature = getConfigFileSignature(options.dataDir);
      currentConfig = next;
      syncToolVisibility(next);
      await syncModuleRuntimes(prev, next);
      broadcastSnapshot();
      refreshFeedSnapshotSafe(next);
      return next;
    });

  const applyResetConfigMutation = (): Promise<NovConfig> =>
    enqueueMutation(async () => {
      const prev = currentConfig;
      const next = resetNovConfig(options.dataDir);
      lastConfigSignature = getConfigFileSignature(options.dataDir);
      currentConfig = next;
      syncToolVisibility(next);
      await syncModuleRuntimes(prev, next);
      broadcastSnapshot();
      refreshFeedSnapshotSafe(next);
      return next;
    });

  // Default read-only offline exemptions (plus per-module declared exemptReadOnlyAppTools)
  const BASE_READONLY_OFFLINE_EXEMPT = new Set(['app_remote_get_hub_state']);

  function registerWithAppTracking(
    registerFn: (trackedServer: McpServer) => ModuleRegistrationResult,
  ): ModuleRegistrationResult {
    const capturedAppTools: Array<{ name: string; enable: () => void; disable: () => void }> = [];
    const tracked = new Proxy(server, {
      get(target, prop, receiver) {
        if (prop === 'registerTool') {
          return (name: string, config: any, cb: any) => {
            const handle = (target.registerTool as any).call(target, name, config, cb);
            const vis = config?._meta?.ui?.visibility;
            const isAppOnly = Array.isArray(vis) && vis.length === 1 && vis[0] === 'app';
            if (isAppOnly) {
              capturedAppTools.push({
                name,
                enable: () => handle.enable(),
                disable: () => handle.disable(),
              });
            }
            return handle;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const result = registerFn(tracked);
    const exempt = new Set<string>([
      ...BASE_READONLY_OFFLINE_EXEMPT,
      ...(result.exemptReadOnlyAppTools ?? []),
    ]);
    for (const t of capturedAppTools) {
      if (exempt.has(t.name)) {
        exemptAppOnlyHandles.push(t);
      }
    }
    const filteredAppTools = capturedAppTools.filter((t) => !exempt.has(t.name));
    return {
      ...result,
      appTools: [...(result.appTools ?? []), ...filteredAppTools],
    };
  }

  // Register all 13 strictly native (Zero-ASAR / Zero-CDP) modules onto the single McpServer
  const registerAll: ModuleRegistrationResult[] = [
    registerWithAppTracking((s) => registerReviewModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) => registerGuardModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) => registerXrayModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) => registerTurboModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) => registerRadarModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) => registerVerifyModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) => registerWorktreeModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) => registerSpecModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) => registerStudioModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) => registerCanvasModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) => registerMemModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) => registerOpsModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) =>
      registerRemoteModule(s, options, UI_RESOURCE_URI, Boolean(currentConfig.modules.remote)),
    ),
  ];

  for (const reg of registerAll) {
    registrations.set(reg.moduleId, reg);
  }

  // Apply initial enable/disable state so disabled modules have zero model tool overhead and cannot mutate state
  syncToolVisibility(currentConfig);

  // Lightweight .unref() disk poller for live external config.json sync (agy-Sag Settings panel / agy-nov CLI).
  // Performs microsecond read-only statSync only — never creates missing dataDir or writes config.json.
  const rawPollMs = options.configPollMs ?? DEFAULT_CONFIG_POLL_MS;
  const pollMs = Number.isFinite(rawPollMs) && rawPollMs > 0 ? Math.max(10, Math.floor(rawPollMs)) : 0;
  let pollInFlight = false;
  let configPollTimer: ReturnType<typeof setInterval> | null = null;
  if (pollMs > 0) {
    configPollTimer = setInterval(() => {
      if (disposed || pollInFlight) return;
      if (getConfigFileSignature(options.dataDir) === lastConfigSignature) return;
      pollInFlight = true;
      void syncConfigFromDiskIfChanged()
        .catch(() => undefined)
        .finally(() => {
          pollInFlight = false;
        });
    }, pollMs);
    configPollTimer.unref();
  }

  // Always-on entrypoint tools (2 lightweight tools)
  server.registerTool(
    'nov_open',
    {
      title: 'Open agy-NOV',
      description:
        'Open the unified agy-NOV side-pane/global workbench (optionally jumping directly to any module tab or the Modules control center).',
      inputSchema: {
        module: z
          .enum(OPEN_TAB_ENUM)
          .optional()
          .describe('Optional target tab to focus when opening agy-NOV'),
      },
      _meta: UI_ENTRYPOINT_META,
    },
    async ({ module: targetModule }) => {
      await syncConfigFromDiskIfChanged();
      const snapshot = buildConfigSnapshot();
      const enabledNames = MODULE_IDS.filter((id) => currentConfig.modules[id])
        .map((id) => MODULE_CATALOG[id].name)
        .join(', ');
      return {
        content: [
          {
            type: 'text',
            text: `Opened agy-NOV workbench (${snapshot.enabledCount}/${MODULE_IDS.length} modules enabled: ${enabledNames || 'none'}).`,
          },
        ],
        structuredContent: {
          ...snapshot,
          toolName: 'nov_open',
          novModule: targetModule ?? (currentConfig.startupView === 'last' ? currentConfig.defaultTab : 'hub'),
        },
      };
    },
  );

  server.registerTool(
    'nov_status',
    {
      title: 'agy-NOV Status',
      description:
        'Return currently enabled agy-NOV modules, preset name, UI language preference, exposed model tool count, and network isolation status.',
      inputSchema: {},
    },
    async () => {
      await syncConfigFromDiskIfChanged();
      const snapshot = buildConfigSnapshot();
      const lines = [
        `agy-NOV v${NOV_VERSION} — Preset: ${currentConfig.preset} (${snapshot.enabledCount}/${MODULE_IDS.length} enabled, ${snapshot.exposedModelTools} model tools, locale=${currentConfig.locale})`,
        `Architecture: 100% Native MCP Apps & Hooks (Zero ASAR / Zero CDP)`,
        `Network isolation: ${snapshot.remoteRunning ? 'Remote Hub active (opt-in)' : '100% offline'}`,
        ...MODULE_IDS.map(
          (id) =>
            `- ${id} (${MODULE_CATALOG[id].name} · ${MODULE_CATALOG[id].isolationTier}): ${currentConfig.modules[id] ? 'ON' : 'OFF'}`,
        ),
      ];
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: { ...snapshot },
      };
    },
  );

  function trackTopLevelAppTool(
    name: string,
    handle: { enable: () => void; disable: () => void },
  ): void {
    topLevelAppOnlyHandles.push({
      name,
      enable: () => handle.enable(),
      disable: () => handle.disable(),
    });
  }

  // Always-on App-only switchboard tools (hidden from model; disabled on non-UI CLI clients)
  trackTopLevelAppTool(
    'nov_app_get_config',
    server.registerTool(
      'nov_app_get_config',
      {
        title: 'Get agy-NOV Config',
        description: 'App-only: read current module toggle state, locale, and runtime metadata.',
        inputSchema: {},
        _meta: APP_ONLY_META,
      },
      async () => {
        await syncConfigFromDiskIfChanged();
        const snapshot = buildConfigSnapshot();
        return {
          content: [{ type: 'text', text: JSON.stringify(snapshot) }],
          structuredContent: { ...snapshot },
        };
      },
    ),
  );

  trackTopLevelAppTool(
    'nov_app_set_module',
    server.registerTool(
      'nov_app_set_module',
      {
        title: 'Toggle agy-NOV Module',
        description: 'App-only: enable or disable a module and update exposed model tools live.',
        inputSchema: {
          module: z.enum(MODULE_IDS),
          enabled: z.boolean(),
        },
        _meta: APP_ONLY_META,
      },
      async ({ module: moduleId, enabled }) => {
        await applySingleToggle(moduleId, enabled);
        const snapshot = buildConfigSnapshot();
        return {
          content: [{ type: 'text', text: JSON.stringify(snapshot) }],
          structuredContent: { ...snapshot },
        };
      },
    ),
  );

  trackTopLevelAppTool(
    'nov_app_apply_preset',
    server.registerTool(
      'nov_app_apply_preset',
      {
        title: 'Apply agy-NOV Preset',
        description: 'App-only: apply a module preset (core, power, local-all, full, minimal).',
        inputSchema: {
          preset: z.enum(PRESET_IDS),
        },
        _meta: APP_ONLY_META,
      },
      async ({ preset }) => {
        await applyPresetMutation(preset);
        const snapshot = buildConfigSnapshot();
        return {
          content: [{ type: 'text', text: JSON.stringify(snapshot) }],
          structuredContent: { ...snapshot },
        };
      },
    ),
  );

  trackTopLevelAppTool(
    'nov_app_set_locale',
    server.registerTool(
      'nov_app_set_locale',
      {
        title: 'Set agy-NOV UI Locale',
        description:
          'App-only: persist interface language preference (auto, en, zh-CN, zh-TW, ja, ko, es, fr, de).',
        inputSchema: {
          locale: z.enum(LOCALE_IDS),
        },
        _meta: APP_ONLY_META,
      },
      async ({ locale }) => {
        await applyLocaleMutation(locale);
        const snapshot = buildConfigSnapshot();
        return {
          content: [{ type: 'text', text: JSON.stringify(snapshot) }],
          structuredContent: { ...snapshot },
        };
      },
    ),
  );

  trackTopLevelAppTool(
    'nov_app_get_hub_state',
    server.registerTool(
      'nov_app_get_hub_state',
      {
        title: 'Get agy-NOV Hub State',
        description:
          'App-only: sync disk config and return unified Hub snapshot, dual-star feed summary, and read-only team preset.',
        inputSchema: {},
        _meta: APP_ONLY_META,
      },
      async () => {
        await syncConfigFromDiskIfChanged();
        const snapshot = buildConfigSnapshot();
        const feed = options.demoMode
          ? buildDemoFeedSnapshot(currentConfig, { remoteRunning: snapshot.remoteRunning })
          : buildFeedSnapshot(options.dataDir, currentConfig, { remoteRunning: snapshot.remoteRunning });
        const teamPreset = loadTeamPresetReadOnly(options.workspaceRoot);
        const payload = { snapshot, feed, teamPreset };
        return {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          structuredContent: payload,
        };
      },
    ),
  );

  trackTopLevelAppTool(
    'nov_app_set_startup_view',
    server.registerTool(
      'nov_app_set_startup_view',
      {
        title: 'Set agy-NOV Startup View',
        description: 'App-only: persist default startup view preference (hub or last).',
        inputSchema: {
          startupView: z.enum(STARTUP_VIEW_IDS),
        },
        _meta: APP_ONLY_META,
      },
      async ({ startupView }) => {
        await applyStartupViewMutation(startupView);
        const snapshot = buildConfigSnapshot();
        return {
          content: [{ type: 'text', text: JSON.stringify(snapshot) }],
          structuredContent: { ...snapshot },
        };
      },
    ),
  );

  trackTopLevelAppTool(
    'nov_app_export_config',
    server.registerTool(
      'nov_app_export_config',
      {
        title: 'Export Sanitized agy-NOV Config',
        description:
          'App-only: export strictly whitelisted agy-NOV configuration JSON with zero secrets or local paths.',
        inputSchema: {},
        _meta: APP_ONLY_META,
      },
      async () => {
        await syncConfigFromDiskIfChanged();
        const exported = exportSanitizedConfig(currentConfig);
        return {
          content: [{ type: 'text', text: JSON.stringify(exported, null, 2) }],
          structuredContent: { ...exported },
        };
      },
    ),
  );

  trackTopLevelAppTool(
    'nov_app_import_config',
    server.registerTool(
      'nov_app_import_config',
      {
        title: 'Import agy-NOV Config',
        description:
          'App-only: validate and apply a sanitized agy-NOV configuration JSON payload with hot tool sync.',
        inputSchema: {
          json: z.string().max(MAX_CONFIG_IMPORT_BYTES),
        },
        _meta: APP_ONLY_META,
      },
      async ({ json }) => {
        const parsed = parseAndValidateConfigImport(json);
        if (!parsed.ok) {
          return {
            isError: true,
            content: [{ type: 'text', text: parsed.error }],
            structuredContent: { ok: false, error: parsed.error },
          };
        }
        await applyImportConfigMutation(parsed.config);
        const snapshot = buildConfigSnapshot();
        const payload = {
          ok: true,
          warnings: parsed.warnings,
          snapshot,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          structuredContent: payload,
        };
      },
    ),
  );

  trackTopLevelAppTool(
    'nov_app_reset_config',
    server.registerTool(
      'nov_app_reset_config',
      {
        title: 'Reset agy-NOV Config',
        description: 'App-only: reset agy-NOV configuration back to the default core preset.',
        inputSchema: {
          confirm: z.literal(true),
        },
        _meta: APP_ONLY_META,
      },
      async () => {
        await applyResetConfigMutation();
        const snapshot = buildConfigSnapshot();
        return {
          content: [{ type: 'text', text: JSON.stringify(snapshot) }],
          structuredContent: { ...snapshot },
        };
      },
    ),
  );

  // Negotiate MCP Apps UI extension & dynamic client roots on initialize.
  // Clients without `io.modelcontextprotocol/ui` (such as Antigravity CLI) ignore `_meta.ui.visibility`
  // and would otherwise expose all ~106 app_* tools to the model, exceeding the 100-tool budget.
  const prevOnInitialized = server.server.oninitialized;
  server.server.oninitialized = () => {
    prevOnInitialized?.();
    const forceExpose =
      Boolean(options.exposeAppToolsWithoutUiCapability) ||
      process.env.AGY_NOV_EXPOSE_APP_TOOLS === '1';
    if (!forceExpose) {
      const clientCaps = server.server.getClientCapabilities();
      if (!hasMcpAppsUiCapability(clientCaps)) {
        uiAppToolsAllowed = false;
        syncToolVisibility(currentConfig, true);
      }
    }
    void syncWorkspaceRootFromClientRoots();
  };

  server.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
    await syncWorkspaceRootFromClientRoots();
  });

  async function dispose(): Promise<void> {
    disposed = true;
    if (configPollTimer) {
      clearInterval(configPollTimer);
      configPollTimer = null;
    }
    snapshotListeners.clear();
    await enqueueMutation(async () => {
      for (const reg of registrations.values()) {
        if (reg.dispose) {
          try {
            await reg.dispose();
          } catch {
            // best-effort teardown
          }
        }
      }
    });
  }

  return {
    server,
    options,
    getConfig: () => currentConfig,
    getSnapshot: buildConfigSnapshot,
    setModule: applySingleToggle,
    applyPreset: applyPresetMutation,
    setLocale: applyLocaleMutation,
    setStartupView: applyStartupViewMutation,
    resetConfig: applyResetConfigMutation,
    setWorkspaceRoot,
    hasUiAppToolsEnabled: () => uiAppToolsAllowed,
    subscribeSnapshot,
    syncConfigFromDisk: syncConfigFromDiskIfChanged,
    dispose,
  };
}

function parseServerFlags(argv: string[]): Partial<NovRuntimeOptions> {
  const pollRaw = parseCliFlag(argv, '--config-poll-ms') ?? process.env.AGY_NOV_CONFIG_POLL_MS;
  const parsedPoll = pollRaw !== undefined ? Number(pollRaw) : undefined;
  const configPollMs =
    parsedPoll !== undefined && Number.isFinite(parsedPoll) && parsedPoll >= 0
      ? parsedPoll
      : undefined;

  return {
    dataDir: parseCliFlag(argv, '--data-dir'),
    workspaceRoot: parseCliFlag(argv, '--workspace') ?? parseCliFlag(argv, '--repo') ?? process.cwd(),
    brainDir: parseCliFlag(argv, '--brain-dir'),
    uiHtmlPath: parseCliFlag(argv, '--ui-html'),
    demoMode: hasCliFlag(argv, '--demo') || process.env.AGY_NOV_DEMO === '1',
    configPollMs,
  };
}

async function main(): Promise<void> {
  const opts = parseServerFlags(process.argv.slice(2));
  const bundle = createNovServer(opts);
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await bundle.dispose();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.stdin.on('close', () => void shutdown());

  await bundle.server.connect(transport);
}

const isMain =
  (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) ||
  (typeof process.argv[1] === 'string' &&
    (/(?:^|[/\\])server\.cjs$/i.test(process.argv[1]) ||
      /(?:^|[/\\])server[/\\]index\.ts$/i.test(process.argv[1])));

if (isMain) {
  void main();
}
