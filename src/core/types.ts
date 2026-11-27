import type { ModuleId, NovConfig, NovLocale, PresetId } from './config.js';

export type HookEventName =
  | 'SessionStart'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PreInvocation'
  | 'PostInvocation'
  | 'Stop';

/**
 * Normalized hook payload compatible with both Antigravity camelCase (`toolCall`, `workspacePaths`)
 * and snake_case (`tool_name`, `tool_input`, `workspace_root`) hook shapes.
 */
export interface NormalizedHookPayload {
  event: HookEventName;
  conversationId?: string;
  parentConversationId?: string;
  agentRole?: string;
  continuationActive?: boolean;
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
  /**
   * When true, keep `app_*` / `nov_app_*` tools enabled even if the MCP client did not
   * declare `capabilities.extensions["io.modelcontextprotocol/ui"]`. Default `false` so
   * CLI clients that ignore `_meta.ui.visibility` never exceed the 100-tool limit.
   */
  exposeAppToolsWithoutUiCapability?: boolean;
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
