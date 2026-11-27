import type { ModuleId, NovConfig, NovLocale, PresetId } from './config.js';

export type HookEventName = 'SessionStart' | 'PreToolUse' | 'PostToolUse' | 'Stop';

/**
 * Normalized hook payload compatible with both Antigravity camelCase (`toolCall`, `workspacePaths`)
 * and snake_case (`tool_name`, `tool_input`, `workspace_root`) hook shapes.
 */
export interface NormalizedHookPayload {
  event: HookEventName;
  conversationId?: string;
  workspacePaths: string[];
  workspaceRoot?: string;
  cwd?: string;
  transcriptPath?: string;
  lastUserInput?: string;
  terminationReason?: string;
  error?: unknown;
  stepIdx?: number;
  toolCallId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  pluginData?: string;
  raw: Record<string, unknown>;
}

export interface NovRuntimeOptions {
  dataDir: string;
  workspaceRoot: string;
  demoMode: boolean;
  brainDir?: string;
  uiHtmlPath?: string;
  configPollMs?: number;
}

export interface ModuleRuntimeState {
  running: boolean;
  statusKey?: string;
  detail?: Record<string, unknown>;
}

export interface NovConfigSnapshotPayload {
  config: NovConfig;
  enabledCount: number;
  totalModules: number;
  exposedModelTools: number;
  remoteRunning: boolean;
  moduleRuntimes: Partial<Record<ModuleId, ModuleRuntimeState>>;
  demoMode: boolean;
  workspaceRoot: string;
}

export interface NovServerControlContext {
  getSnapshot: () => NovConfigSnapshotPayload;
  setModule: (moduleId: ModuleId, enabled: boolean) => Promise<NovConfig>;
  applyPreset: (preset: PresetId) => Promise<NovConfig>;
  setLocale: (locale: NovLocale) => Promise<NovConfig>;
  subscribeSnapshot: (listener: (snapshot: NovConfigSnapshotPayload) => void) => () => void;
}

export interface ModuleToolHandle {
  name: string;
  enable: () => void;
  disable: () => void;
}

export interface ModuleRegistrationResult {
  moduleId: ModuleId;
  modelTools: ModuleToolHandle[];
  appTools?: ModuleToolHandle[];
  exemptReadOnlyAppTools?: string[];
  isRuntimeRunning?: () => boolean;
  getRuntimeState?: () => ModuleRuntimeState;
  dispose?: () => Promise<void> | void;
  setEnabledRuntime?: (enabled: boolean) => Promise<void> | void;
}
