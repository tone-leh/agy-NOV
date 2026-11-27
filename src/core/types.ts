import type { ModuleId } from './config.js';

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
  isRuntimeRunning?: () => boolean;
  dispose?: () => Promise<void> | void;
  setEnabledRuntime?: (enabled: boolean) => Promise<void> | void;
}
