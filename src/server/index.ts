import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  applyPresetConfig,
  countEnabledModelTools,
  loadOrInitNovConfig,
  MODULE_CATALOG,
  MODULE_IDS,
  PRESET_IDS,
  resolveNovDataDir,
  setModuleEnabled,
  type ModuleId,
  type NovConfig,
  type PresetId,
} from '../core/config.js';
import type { ModuleRegistrationResult, NovRuntimeOptions } from '../core/types.js';
import { hasCliFlag, parseCliFlag } from '../core/utils.js';
import { registerCanvasModule } from '../modules/canvas/register.js';
import { registerGuardModule } from '../modules/guard/register.js';
import { registerMemModule } from '../modules/mem/register.js';
import { registerRemoteModule } from '../modules/remote/register.js';
import { registerReviewModule } from '../modules/review/register.js';
import { registerXrayModule } from '../modules/xray/register.js';

export const UI_RESOURCE_URI = 'ui://agy-nov/app.html';

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

function resolveUiHtmlPath(override?: string): string {
  const envOverride = process.env.AGY_NOV_APP_HTML;
  const candidates = [
    override,
    envOverride,
    path.resolve(process.cwd(), 'dist/ui/app.html'),
    path.resolve(path.dirname(process.argv[1] || process.cwd()), 'ui/app.html'),
    path.resolve(path.dirname(process.argv[1] || process.cwd()), '../dist/ui/app.html'),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? path.resolve(process.cwd(), 'dist/ui/app.html');
}

export interface NovServerBundle {
  server: McpServer;
  options: NovRuntimeOptions;
  getConfig: () => NovConfig;
  setModule: (moduleId: ModuleId, enabled: boolean) => Promise<NovConfig>;
  applyPreset: (preset: PresetId) => Promise<NovConfig>;
  dispose: () => Promise<void>;
}

export function createNovServer(rawOpts: Partial<NovRuntimeOptions> = {}): NovServerBundle {
  const options: NovRuntimeOptions = {
    dataDir: resolveNovDataDir(rawOpts.dataDir),
    workspaceRoot: path.resolve(rawOpts.workspaceRoot ?? process.cwd()),
    demoMode: Boolean(rawOpts.demoMode),
    brainDir: rawOpts.brainDir,
    uiHtmlPath: rawOpts.uiHtmlPath,
  };

  let currentConfig: NovConfig = loadOrInitNovConfig(options.dataDir);
  let toggleQueue: Promise<void> = Promise.resolve();

  const server = new McpServer(
    { name: 'agy-nov', version: '0.1.0' },
    { capabilities: { tools: { listChanged: true }, resources: {} } },
  );

  // Register unified single-file HTML MCP App UI resource
  server.registerResource(
    'agy-nov-ui',
    UI_RESOURCE_URI,
    {
      title: 'agy-NOV Modular Workbench',
      description: 'Unified modular side-pane and global MCP App UI for agy-NOV',
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

  // Track every module's app-only tools automatically so disabling a module disables both model and app tools
  // (keeping read-only app_remote_get_hub_state available to report offline state cleanly).
  const READONLY_OFFLINE_EXEMPT = new Set(['app_remote_get_hub_state']);

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
            if (isAppOnly && !READONLY_OFFLINE_EXEMPT.has(name)) {
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
    return {
      ...result,
      appTools: [...(result.appTools ?? []), ...capturedAppTools],
    };
  }

  // Register all 6 modules onto the single McpServer
  const registrations = new Map<ModuleId, ModuleRegistrationResult>();
  const registerAll: ModuleRegistrationResult[] = [
    registerWithAppTracking((s) => registerReviewModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) => registerGuardModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) => registerXrayModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) => registerCanvasModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) => registerMemModule(s, options, UI_RESOURCE_URI)),
    registerWithAppTracking((s) =>
      registerRemoteModule(s, options, UI_RESOURCE_URI, Boolean(currentConfig.modules.remote)),
    ),
  ];

  for (const reg of registerAll) {
    registrations.set(reg.moduleId, reg);
  }

  function syncToolVisibility(cfg: NovConfig): void {
    for (const id of MODULE_IDS) {
      const reg = registrations.get(id);
      if (!reg) continue;
      const on = Boolean(cfg.modules[id]);
      for (const tool of reg.modelTools) {
        if (on) tool.enable();
        else tool.disable();
      }
      for (const appTool of reg.appTools ?? []) {
        if (on) appTool.enable();
        else appTool.disable();
      }
    }
  }

  // Apply initial enable/disable state so disabled modules have zero model tool overhead and cannot mutate state
  syncToolVisibility(currentConfig);

  function buildConfigSnapshot() {
    const enabledCount = MODULE_IDS.filter((id) => currentConfig.modules[id]).length;
    const remoteRunning = Boolean(registrations.get('remote')?.isRuntimeRunning?.());
    return {
      config: currentConfig,
      enabledCount,
      exposedModelTools: countEnabledModelTools(currentConfig.modules),
      remoteRunning,
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

  async function syncModuleRuntimes(prev: NovConfig, next: NovConfig): Promise<void> {
    for (const id of MODULE_IDS) {
      if (prev.modules[id] === next.modules[id]) continue;
      const reg = registrations.get(id);
      if (reg?.setEnabledRuntime) {
        await reg.setEnabledRuntime(Boolean(next.modules[id]));
      }
    }
  }

  const applySingleToggle = (moduleId: ModuleId, enabled: boolean): Promise<NovConfig> =>
    enqueueMutation(async () => {
      const prev = currentConfig;
      const next = setModuleEnabled(options.dataDir, moduleId, enabled);
      currentConfig = next;
      syncToolVisibility(next);
      await syncModuleRuntimes(prev, next);
      return next;
    });

  const applyPresetMutation = (preset: PresetId): Promise<NovConfig> =>
    enqueueMutation(async () => {
      const prev = currentConfig;
      const next = applyPresetConfig(options.dataDir, preset);
      currentConfig = next;
      syncToolVisibility(next);
      await syncModuleRuntimes(prev, next);
      return next;
    });

  // Always-on entrypoint tools (2 lightweight tools)
  server.registerTool(
    'nov_open',
    {
      title: 'Open agy-NOV',
      description:
        'Open the unified agy-NOV side-pane/global workbench (optionally jumping directly to a module tab or the Modules switchboard).',
      inputSchema: {
        module: z
          .enum(['review', 'guard', 'xray', 'canvas', 'mem', 'remote', 'modules'])
          .optional()
          .describe('Optional target tab to focus when opening agy-NOV'),
      },
      _meta: UI_ENTRYPOINT_META,
    },
    async ({ module: targetModule }) => {
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
          novModule: targetModule ?? currentConfig.defaultTab,
        },
      };
    },
  );

  server.registerTool(
    'nov_status',
    {
      title: 'agy-NOV Status',
      description:
        'Return currently enabled agy-NOV modules, preset name, exposed model tool count, and network isolation status.',
      inputSchema: {},
    },
    async () => {
      const snapshot = buildConfigSnapshot();
      const lines = [
        `agy-NOV v0.1.0 — Preset: ${currentConfig.preset} (${snapshot.enabledCount}/${MODULE_IDS.length} enabled, ${snapshot.exposedModelTools} model tools)`,
        `Network isolation: ${snapshot.remoteRunning ? 'Remote Hub active (opt-in)' : '100% offline'}`,
        ...MODULE_IDS.map(
          (id) =>
            `- ${id} (${MODULE_CATALOG[id].name}): ${currentConfig.modules[id] ? 'ON' : 'OFF'}`,
        ),
      ];
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: snapshot,
      };
    },
  );

  // Always-on App-only switchboard tools (hidden from model)
  server.registerTool(
    'nov_app_get_config',
    {
      title: 'Get agy-NOV Config',
      description: 'App-only: read current module toggle state and metadata.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => {
      const snapshot = buildConfigSnapshot();
      return {
        content: [{ type: 'text', text: JSON.stringify(snapshot) }],
        structuredContent: snapshot,
      };
    },
  );

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
        structuredContent: snapshot,
      };
    },
  );

  server.registerTool(
    'nov_app_apply_preset',
    {
      title: 'Apply agy-NOV Preset',
      description: 'App-only: apply a module preset (core, local-all, full, minimal).',
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
        structuredContent: snapshot,
      };
    },
  );

  async function dispose(): Promise<void> {
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
    setModule: applySingleToggle,
    applyPreset: applyPresetMutation,
    dispose,
  };
}

function parseServerFlags(argv: string[]): Partial<NovRuntimeOptions> {
  return {
    dataDir: parseCliFlag(argv, '--data-dir'),
    workspaceRoot: parseCliFlag(argv, '--workspace') ?? parseCliFlag(argv, '--repo') ?? process.cwd(),
    brainDir: parseCliFlag(argv, '--brain-dir'),
    uiHtmlPath: parseCliFlag(argv, '--ui-html'),
    demoMode: hasCliFlag(argv, '--demo') || process.env.AGY_NOV_DEMO === '1',
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
    (process.argv[1].endsWith('server.cjs') || process.argv[1].endsWith('server/index.ts')));

if (isMain) {
  void main();
}
