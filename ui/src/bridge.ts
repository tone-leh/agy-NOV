import {
  App as McpApp,
  applyDocumentTheme,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';
import type {
  ModuleId,
  NovConfig,
  NovLocale,
  NovStartupView,
  PresetId,
} from '../../src/core/catalog.js';
import type { ModuleRuntimeState } from '../../src/core/types.js';

declare global {
  interface Window {
    __AGY_NOV_WORKBENCH__?: boolean;
  }
}

export interface HostCapabilitiesSummary {
  message: boolean;
  updateModelContext: boolean;
  openLinks: boolean;
  isWorkbench: boolean;
}

/**
 * Convert a local absolute filesystem path or local `file://` URI into a safe,
 * canonical local `file://` URI. Rejects remote UNC shares, non-localhost `file://`
 * hosts (SMB/NTLM leak protection), relative paths, control characters, and `..` segments.
 */
export function toSafeLocalFileUri(filePath: string): string | null {
  if (typeof filePath !== 'string') return null;
  if (/[\x00-\x1f\x7f]/.test(filePath)) return null;
  const trimmed = filePath.trim();
  if (!trimmed) return null;

  if (/^file:\/\//i.test(trimmed)) {
    // Reject traversal segments (`..` or percent-encoded `%2e%2e`) before URL normalization collapses them
    const rawAfterScheme = trimmed.slice('file://'.length);
    let rawDecodedAfterScheme: string;
    try {
      rawDecodedAfterScheme = decodeURIComponent(rawAfterScheme);
    } catch {
      return null;
    }
    if (
      /[\x00-\x1f\x7f\\]/.test(rawDecodedAfterScheme) ||
      rawDecodedAfterScheme.split('/').some((seg) => seg === '..')
    ) {
      return null;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'file:') return null;
    const host = parsed.hostname.toLowerCase();
    if (host !== '' && host !== 'localhost') return null;
    if (parsed.search || parsed.hash) return null;

    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(parsed.pathname);
    } catch {
      return null;
    }
    if (!decodedPath || /[\x00-\x1f\x7f\\]/.test(decodedPath)) return null;
    const rawSegs = decodedPath.replace(/^\/+/, '').split('/');
    if (rawSegs.some((s) => s === '..')) return null;

    const encoded = rawSegs
      .map((seg, idx) => (idx === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
      .join('/');
    return `file:///${encoded}`;
  }

  // Reject Windows/POSIX UNC network shares (including extended-length `\\?\UNC\...`)
  if (/^(?:\\\\\?\\UNC\\|\\\\(?!\?\\[A-Za-z]:[\\/])|\/\/)/i.test(trimmed)) {
    return null;
  }

  // Strip local Windows extended-length prefix (`\\?\C:\...`)
  const stripped = /^\\\\\?\\[A-Za-z]:[\\/]/.test(trimmed) ? trimmed.slice(4) : trimmed;
  const normalized = stripped.replace(/\\/g, '/');

  const isWinAbs = /^[A-Za-z]:\//.test(normalized);
  const isPosixAbs = normalized.startsWith('/');
  if (!isWinAbs && !isPosixAbs) {
    return null;
  }

  const rawSegments = (isPosixAbs ? normalized.replace(/^\/+/, '') : normalized).split('/');
  if (rawSegments.some((seg) => seg === '..')) {
    return null;
  }

  const encoded = rawSegments
    .map((seg, idx) =>
      idx === 0 && isWinAbs && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg),
    )
    .join('/');
  return `file:///${encoded}`;
}

export interface ToolResultEvent {
  toolName?: string;
  structuredContent: Record<string, unknown>;
}

export interface NovConfigSnapshot {
  config: NovConfig;
  enabledCount: number;
  totalModules: number;
  exposedModelTools: number;
  remoteRunning: boolean;
  moduleRuntimes?: Partial<Record<ModuleId, ModuleRuntimeState>>;
  demoMode: boolean;
  workspaceRoot: string;
}

export interface NovFeedAlert {
  level: 'info' | 'warn' | 'danger' | 'error' | string;
  moduleId: ModuleId | string;
  code: string;
  message: string;
}

export interface NovFeedPaths {
  configFile?: string;
  feedFile?: string;
  modulesRoot?: string;
  moduleFiles?: Record<string, string>;
  dataDir?: string;
  configPath?: string;
  feedSnapshotPath?: string;
  feedPath?: string;
}

export interface NovFeedSummary {
  guard?: {
    enabled?: boolean;
    blockedCount?: number;
    askCount?: number;
    totalSnapshots?: number;
    secretCatches?: number;
    lastEvent?: {
      decision: string;
      toolName: string;
      reason: string;
      timestamp: string;
    };
    [key: string]: unknown;
  };
  spec?: {
    enabled?: boolean;
    activeSpecId?: string | null;
    title?: string | null;
    status?: string | null;
    writeLockActive?: boolean;
    totalTasks?: number;
    doneTasks?: number;
    readyTasks?: number;
    totalSpecs?: number;
    [key: string]: unknown;
  };
  verify?: {
    enabled?: boolean;
    enforceOnStop?: boolean;
    lastStatus?: 'pass' | 'fail' | 'blocked' | 'idle' | string;
    lastOutcome?: string | null;
    lastPassed?: boolean | null;
    passedRuns?: number;
    failedRuns?: number;
    blockedStops?: number;
    totalRuns?: number;
    dirtyFilesCount?: number;
    [key: string]: unknown;
  };
  mem?: {
    enabled?: boolean;
    totalMemories?: number;
    staleCount?: number;
    total?: number;
    pinned?: number;
    stale?: number;
    drifted?: number;
    [key: string]: unknown;
  };
  radar?: {
    enabled?: boolean;
    runningCount?: number;
    awaitingCount?: number;
    stalledCount?: number;
    unreadCount?: number;
    total?: number;
    running?: number;
    awaitingApproval?: number;
    awaiting_approval?: number;
    stalled?: number;
    unread?: number;
    orphanSubagents?: number;
    [key: string]: unknown;
  };
  xray?: {
    enabled?: boolean;
    activeModel?: string | null;
    peakContextTokens?: number;
    estimatedCostUsd?: number;
    totalTokens?: number;
    peakTokens?: number;
    cacheHitRate?: number;
    estCostUsd?: number;
    todayCostUsd?: number;
    [key: string]: unknown;
  };
  turbo?: {
    enabled?: boolean;
    savedTokens?: number;
    totalSavedTokens?: number;
    avgCompressionRatio?: number;
    compactionCount?: number;
    [key: string]: unknown;
  };
  remote?: {
    enabled?: boolean;
    running?: boolean;
    connectedClients?: number;
    pendingApprovals?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface NovFeedSnapshot {
  schemaVersion?: number;
  version?: string;
  generatedAt?: string;
  updatedAt?: string;
  preset?: PresetId | 'custom';
  locale?: NovLocale;
  startupView?: NovStartupView;
  enabledCount?: number;
  totalModules?: number;
  summary: NovFeedSummary;
  alerts: NovFeedAlert[];
  paths?: NovFeedPaths;
  exposedModelTools?: number;
  toolBudgetLimit?: number;
  feedExists?: boolean;
  [key: string]: unknown;
}

export interface NovHubTeamPresetSummary {
  found?: boolean;
  valid?: boolean;
  preset?: string;
  path?: string;
  warnings?: string[];
  errors?: string[];
  [key: string]: unknown;
}

export interface NovHubStatePayload {
  snapshot: NovConfigSnapshot;
  feed: NovFeedSnapshot;
  teamPreset?: NovHubTeamPresetSummary | null;
}

export interface SanitizedConfigExportPayload {
  schemaVersion: 1;
  exportedAt: string;
  sanitized: true;
  config: {
    preset: PresetId | 'custom';
    modules: Record<ModuleId, boolean>;
    defaultTab: ModuleId;
    startupView: NovStartupView;
    locale: NovLocale;
  };
}

export interface ImportConfigResultPayload {
  ok: true;
  warnings: string[];
  snapshot: NovConfigSnapshot;
}

export interface CleanForkLaunchResult {
  mode: 'new_conversation' | 'context' | 'copied';
  conversationId?: string;
}

export interface CleanForkPackPayload {
  promptMarkdown: string;
  estimatedTokens: number;
  totalBytes: number;
  truncated: boolean;
  sections: {
    hasHandoff: boolean;
    activeSpecTitle: string | null;
    readyTasksCount: number;
    memAnchorsCount: number;
  };
}

const ToggleAuxPaneResultSchema = z
  .object({
    isError: z.boolean().optional(),
  })
  .passthrough();

type ThemeListener = (theme: 'dark' | 'light') => void;
type LocaleHintListener = (localeHint: string) => void;
type ToolResultListener = (evt: ToolResultEvent) => void;
type ConfigChangeListener = (snapshot: NovConfigSnapshot) => void;

export class NovBridge {
  private app: McpApp | null = null;
  private readyPromise: Promise<void>;
  private isWorkbenchMode = false;
  private capabilities: HostCapabilitiesSummary = {
    message: false,
    updateModelContext: false,
    openLinks: false,
    isWorkbench: false,
  };
  private themeListeners = new Set<ThemeListener>();
  private localeListeners = new Set<LocaleHintListener>();
  private toolResultListeners = new Set<ToolResultListener>();
  private configListeners = new Set<ConfigChangeListener>();
  private currentTheme: 'dark' | 'light' = 'dark';
  private hostLocaleHint: string =
    typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en';

  constructor() {
    this.isWorkbenchMode = Boolean(
      typeof window !== 'undefined' &&
        (window.__AGY_NOV_WORKBENCH__ || window.parent === window),
    );
    this.capabilities.isWorkbench = this.isWorkbenchMode;
    this.readyPromise = this.init();
  }

  private async init(): Promise<void> {
    if (typeof window === 'undefined') return;

    // Listen for workbench theme & locale toggle postMessages
    window.addEventListener('message', (event) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data) return;
      if (data.type === 'nov-workbench-theme' && (data.theme === 'dark' || data.theme === 'light')) {
        this.applyTheme(data.theme);
      }
      if (data.type === 'nov-workbench-locale' && typeof data.locale === 'string') {
        this.applyHostLocaleHint(data.locale);
      }
    });

    if (this.isWorkbenchMode) {
      const initialTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      this.applyTheme(initialTheme);
      this.capabilities = {
        message: true,
        updateModelContext: true,
        openLinks: true,
        isWorkbench: true,
      };
      return;
    }

    const app = new McpApp({ name: 'agy-NOV', version: '1.0.1' }, {});
    this.app = app;

    app.ontoolresult = (result) => {
      const sc =
        result && typeof result === 'object' && result.structuredContent && typeof result.structuredContent === 'object'
          ? (result.structuredContent as Record<string, unknown>)
          : {};
      const evt: ToolResultEvent = {
        toolName: typeof sc.toolName === 'string' ? sc.toolName : undefined,
        structuredContent: sc,
      };
      for (const listener of this.toolResultListeners) {
        try {
          listener(evt);
        } catch {
          // isolate subscriber failures
        }
      }
    };

    app.onhostcontextchanged = (ctx) => {
      if (ctx?.theme === 'dark' || ctx?.theme === 'light') {
        this.applyTheme(ctx.theme);
      }
      if (ctx?.styles?.variables) {
        applyHostStyleVariables(ctx.styles.variables);
      }
      const rawLocale = (ctx as { locale?: unknown } | undefined)?.locale;
      if (typeof rawLocale === 'string' && rawLocale.trim()) {
        this.applyHostLocaleHint(rawLocale.trim());
      }
    };

    try {
      await app.connect();
      const ctx = app.getHostContext();
      if (ctx?.theme === 'dark' || ctx?.theme === 'light') {
        this.applyTheme(ctx.theme);
      } else {
        this.applyTheme('dark');
      }
      if (ctx?.styles?.variables) {
        applyHostStyleVariables(ctx.styles.variables);
      }
      const rawLocale = (ctx as { locale?: unknown } | undefined)?.locale;
      if (typeof rawLocale === 'string' && rawLocale.trim()) {
        this.applyHostLocaleHint(rawLocale.trim());
      }
      const caps = app.getHostCapabilities() as Record<string, unknown> | undefined;
      this.capabilities = {
        message: Boolean(caps?.message),
        updateModelContext: Boolean(caps?.updateModelContext),
        openLinks: Boolean(caps?.openLinks),
        isWorkbench: false,
      };
    } catch {
      // Fallback safely to standalone workbench mode if host handshake unavailable
      this.isWorkbenchMode = true;
      this.capabilities = {
        message: true,
        updateModelContext: true,
        openLinks: true,
        isWorkbench: true,
      };
      this.applyTheme('dark');
    }
  }

  private applyHostLocaleHint(localeHint: string): void {
    this.hostLocaleHint = localeHint;
    for (const listener of this.localeListeners) {
      try {
        listener(localeHint);
      } catch {
        // isolate listener error
      }
    }
  }

  private applyTheme(theme: 'dark' | 'light'): void {
    this.currentTheme = theme;
    try {
      applyDocumentTheme(theme);
    } catch {
      // ignore outside browser
    }
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = theme;
    }
    for (const listener of this.themeListeners) {
      try {
        listener(theme);
      } catch {
        // ignore listener failure
      }
    }
  }

  async ready(): Promise<void> {
    await this.readyPromise;
  }

  getCapabilities(): HostCapabilitiesSummary {
    return { ...this.capabilities };
  }

  getTheme(): 'dark' | 'light' {
    return this.currentTheme;
  }

  getHostLocaleHint(): string {
    return this.hostLocaleHint;
  }

  onThemeChange(listener: ThemeListener): () => void {
    this.themeListeners.add(listener);
    return () => this.themeListeners.delete(listener);
  }

  onHostLocaleChange(listener: LocaleHintListener): () => void {
    this.localeListeners.add(listener);
    return () => this.localeListeners.delete(listener);
  }

  onToolResult(listener: ToolResultListener): () => void {
    this.toolResultListeners.add(listener);
    return () => this.toolResultListeners.delete(listener);
  }

  onConfigChange(listener: ConfigChangeListener): () => void {
    this.configListeners.add(listener);
    return () => this.configListeners.delete(listener);
  }

  private emitConfigChange(snapshot: NovConfigSnapshot): void {
    for (const listener of this.configListeners) {
      try {
        listener(snapshot);
      } catch {
        // isolate subscriber errors
      }
    }
  }

  async callTool<T = Record<string, unknown>>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    await this.readyPromise;

    if (this.isWorkbenchMode || !this.app) {
      const res = await fetch(`/api/tool/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`Tool ${name} failed (${res.status}): ${errText}`);
      }
      const data = (await res.json()) as {
        structuredContent?: T;
        error?: string;
        isError?: boolean;
        content?: Array<{ text?: string }>;
      };
      if (data.error) throw new Error(data.error);
      if (data.isError) {
        const textItem = Array.isArray(data.content)
          ? data.content.find((c) => c && typeof c === 'object' && typeof c.text === 'string')
          : undefined;
        throw new Error(textItem?.text || `Tool ${name} returned error`);
      }
      return (data.structuredContent ?? (data as unknown as T)) as T;
    }

    const res = await this.app.callServerTool({ name, arguments: args });
    if (res?.isError) {
      const textItem = Array.isArray(res.content)
        ? (res.content.find((c) => c && typeof c === 'object' && 'text' in c) as { text?: string } | undefined)
        : undefined;
      throw new Error(textItem?.text || `Tool ${name} returned error`);
    }
    if (res?.structuredContent && typeof res.structuredContent === 'object') {
      return res.structuredContent as T;
    }
    const textItem = Array.isArray(res?.content)
      ? (res.content.find((c) => c && typeof c === 'object' && 'text' in c) as { text?: string } | undefined)
      : undefined;
    if (textItem?.text) {
      try {
        return JSON.parse(textItem.text) as T;
      } catch {
        return { text: textItem.text } as unknown as T;
      }
    }
    return {} as T;
  }

  private notifyWorkbenchHost(kind: string, payload: Record<string, unknown>): void {
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'nov-workbench-event', kind, payload }, '*');
    }
  }

  async sendMessage(text: string): Promise<'sent' | 'context' | 'copied'> {
    await this.readyPromise;
    if (this.isWorkbenchMode || !this.app) {
      this.notifyWorkbenchHost('sendMessage', { text });
      try {
        await navigator.clipboard?.writeText(text);
      } catch {
        // clipboard may be restricted
      }
      return 'sent';
    }
    if (this.capabilities.message) {
      try {
        await this.app.sendMessage({
          role: 'user',
          content: [{ type: 'text', text }],
        });
        return 'sent';
      } catch {
        // fall through to updateModelContext
      }
    }
    if (this.capabilities.updateModelContext) {
      try {
        await this.app.updateModelContext({
          content: [{ type: 'text', text }],
        });
        return 'context';
      } catch {
        // fall through to clipboard
      }
    }
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      // ignore
    }
    return 'copied';
  }

  async startCleanFork(text: string): Promise<CleanForkLaunchResult> {
    await this.readyPromise;
    if (this.isWorkbenchMode || !this.app) {
      this.notifyWorkbenchHost('cleanFork', { text, target: 'new' });
      try {
        await navigator.clipboard?.writeText(text);
      } catch {
        // clipboard may be restricted
      }
      return { mode: 'new_conversation', conversationId: 'workbench-fork-preview' };
    }

    if (this.capabilities.message) {
      try {
        const res = (await this.app.sendMessage({
          role: 'user',
          content: [{ type: 'text', text }],
          _meta: { 'com.google.antigravity/message': { target: 'new' } },
        } as Parameters<McpApp['sendMessage']>[0])) as
          | { _meta?: Record<string, unknown> }
          | undefined;
        const agyMeta = res?._meta?.['com.google.antigravity/message'] as
          | { conversationId?: unknown }
          | undefined;
        const conversationId =
          typeof agyMeta?.conversationId === 'string' && agyMeta.conversationId.trim()
            ? agyMeta.conversationId.trim()
            : undefined;
        return {
          mode: 'new_conversation',
          ...(conversationId ? { conversationId } : {}),
        };
      } catch {
        // fall through to updateModelContext
      }
    }

    if (this.capabilities.updateModelContext) {
      try {
        await this.app.updateModelContext({
          content: [{ type: 'text', text }],
        });
        return { mode: 'context' };
      } catch {
        // fall through to clipboard
      }
    }

    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      // ignore clipboard restrictions
    }
    return { mode: 'copied' };
  }

  buildCleanForkPack(
    args: { conversationId?: string; maxBytes?: number } = {},
  ): Promise<CleanForkPackPayload> {
    return this.callTool<CleanForkPackPayload>('app_xray_build_clean_fork_pack', args);
  }

  async updateModelContext(text: string): Promise<'context' | 'copied'> {
    await this.readyPromise;
    if (this.isWorkbenchMode || !this.app) {
      this.notifyWorkbenchHost('updateModelContext', { text });
      try {
        await navigator.clipboard?.writeText(text);
      } catch {
        // ignore
      }
      return 'context';
    }
    if (this.capabilities.updateModelContext) {
      try {
        await this.app.updateModelContext({
          content: text ? [{ type: 'text', text }] : [],
        });
        return 'context';
      } catch {
        // fallback to clipboard
      }
    }
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      // ignore
    }
    return 'copied';
  }

  async openFile(filePath: string): Promise<boolean> {
    await this.readyPromise;
    const uri = toSafeLocalFileUri(filePath);
    if (!uri) {
      return false;
    }

    if (this.isWorkbenchMode || !this.app) {
      this.notifyWorkbenchHost('openFile', { uri, filePath });
      return true;
    }
    try {
      const result = await this.app.request(
        {
          method: 'com.google.antigravity/toggle-aux-pane',
          params: { tabType: 'fileView', uri },
        },
        ToggleAuxPaneResultSchema,
      );
      return !result?.isError;
    } catch {
      return false;
    }
  }

  async openExternalLink(url: string): Promise<boolean> {
    await this.readyPromise;
    if (!/^https?:\/\//i.test(url)) return false;
    if (this.isWorkbenchMode || !this.app) {
      this.notifyWorkbenchHost('openLink', { url });
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    }
    if (this.capabilities.openLinks) {
      try {
        await this.app.openLink({ url });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  // Convenience typed helpers for top-level config
  getConfig(): Promise<NovConfigSnapshot> {
    return this.callTool<NovConfigSnapshot>('nov_app_get_config', {});
  }

  async setModule(module: ModuleId, enabled: boolean): Promise<NovConfigSnapshot> {
    const next = await this.callTool<NovConfigSnapshot>('nov_app_set_module', { module, enabled });
    this.emitConfigChange(next);
    return next;
  }

  async applyPreset(preset: PresetId): Promise<NovConfigSnapshot> {
    const next = await this.callTool<NovConfigSnapshot>('nov_app_apply_preset', { preset });
    this.emitConfigChange(next);
    return next;
  }

  async setLocale(locale: NovLocale): Promise<NovConfigSnapshot> {
    const next = await this.callTool<NovConfigSnapshot>('nov_app_set_locale', { locale });
    this.emitConfigChange(next);
    return next;
  }

  getHubState(): Promise<NovHubStatePayload> {
    return this.callTool<NovHubStatePayload>('nov_app_get_hub_state', {});
  }

  async setStartupView(startupView: NovStartupView): Promise<NovConfigSnapshot> {
    const next = await this.callTool<NovConfigSnapshot>('nov_app_set_startup_view', {
      startupView,
    });
    this.emitConfigChange(next);
    return next;
  }

  exportConfig(): Promise<SanitizedConfigExportPayload> {
    return this.callTool<SanitizedConfigExportPayload>('nov_app_export_config', {});
  }

  async importConfig(json: string): Promise<ImportConfigResultPayload> {
    const res = await this.callTool<ImportConfigResultPayload>('nov_app_import_config', { json });
    if (res?.snapshot) {
      this.emitConfigChange(res.snapshot);
    }
    return res;
  }

  async resetConfig(): Promise<NovConfigSnapshot> {
    const next = await this.callTool<NovConfigSnapshot>('nov_app_reset_config', { confirm: true });
    this.emitConfigChange(next);
    return next;
  }
}

export const novBridge = new NovBridge();
