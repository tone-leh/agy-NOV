import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ModuleId } from './catalog.js';
import type {
  HookEventName,
  ModuleRegistrationResult,
  NovRuntimeOptions,
} from './types.js';

/**
 * agy-NOV 4-Layer Architecture Contract
 *
 * Layer 1 — Core Kernel (`src/core/*`):
 *   Zero-module-import foundation (catalog, config, fs-safe, process-safe, brain-paths,
 *   sanitize, feed, team-config, types). Must NEVER import from `src/modules/*`, `src/server/*`,
 *   or `ui/*`.
 *
 * Layer 2 — Isolated Domain Modules (`src/modules/<moduleId>/*`):
 *   Self-contained vertical slices (core logic, register.ts MCP tool binding, optional hook.ts).
 *   Each module depends only on Layer 1 (`src/core/*`) and its own internal submodules.
 *   Cross-module imports are restricted to explicit read-only contracts (e.g. Spec -> Mem archival).
 *
 * Layer 3 — Protocol Runtime & Entrypoints (`src/server/*`, `src/hooks/*`):
 *   Single MCP server (`src/server/index.ts`), unified 5/6-event hook dispatcher
 *   (`src/hooks/dispatcher.ts`), and modular CLI (`src/server/cli.ts` + `src/server/cli/*`).
 *
 * Layer 4 — Sandboxed Presentation (`ui/src/*`):
 *   Single-file 8-language MCP Apps UI (`dist/ui/app.html`) communicating exclusively over
 *   official MCP App JSON-RPC via `ui/src/bridge.ts` (Zero ASAR / Zero CDP).
 */
export type NovArchitectureLayer = 'core' | 'module' | 'runtime' | 'ui';

export interface NovModuleDescriptor {
  readonly moduleId: ModuleId;
  readonly hooks: readonly HookEventName[];
  readonly register: (
    server: McpServer,
    options: NovRuntimeOptions,
    uiResourceUri: string,
    initialEnabled?: boolean,
  ) => ModuleRegistrationResult;
}

export function assertValidModuleRegistration(
  result: ModuleRegistrationResult,
  expectedModuleId: ModuleId,
): ModuleRegistrationResult {
  if (result.moduleId !== expectedModuleId) {
    throw new Error(
      `Module registration mismatch: expected "${expectedModuleId}", got "${result.moduleId}"`,
    );
  }
  if (!Array.isArray(result.modelTools)) {
    throw new Error(`Module "${expectedModuleId}" must return a modelTools array`);
  }
  return result;
}
