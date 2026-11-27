import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import type {
  ModuleRegistrationResult,
  ModuleToolHandle,
  NovRuntimeOptions,
} from '../../core/types.js';
import {
  applySaveSpecInMemory,
  applySetSpecStatusInMemory,
  applyUpdateSpecTaskInMemory,
  buildSpecStateView,
  createDemoSpecState,
  loadSpecStateReadOnly,
  saveSpec,
  setSpecStatus,
  updateSpecTask,
  type SaveSpecInput,
  type SetSpecStatusInput,
  type SpecActor,
  type SpecDocumentView,
  type SpecStateFile,
  type SpecStateView,
  type SpecStatus,
  type SpecTaskStatus,
  type SpecTaskView,
  type UpdateSpecTaskInput,
} from './core.js';

function toHandle(name: string, tool: RegisteredTool): ModuleToolHandle {
  return {
    name,
    enable: () => tool.enable(),
    disable: () => tool.disable(),
  };
}

const SPEC_STATUS_ENUM = z.enum(['draft', 'approved', 'completed', 'archived']);
const SPEC_TASK_STATUS_ENUM = z.enum(['pending', 'in_progress', 'done', 'blocked']);

const SPEC_TASK_INPUT_SCHEMA = z.object({
  id: z.string().describe('Unique task ID matching /^[a-zA-Z0-9._-]{1,48}$/'),
  title: z.string().describe('Short task title'),
  description: z.string().max(2000).optional().describe('Optional task details'),
  dependsOn: z
    .array(z.string())
    .max(50)
    .optional()
    .describe('IDs of prerequisite tasks in the same spec'),
  status: SPEC_TASK_STATUS_ENUM.optional().describe('Optional task status (defaults to pending)'),
  note: z.string().max(2000).optional().describe('Optional progress or blocker note'),
});

const SAVE_SPEC_INPUT_SCHEMA = {
  id: z
    .string()
    .max(64)
    .optional()
    .describe('Optional spec ID (auto-generated when omitted; updates existing spec if matched)'),
  title: z.string().max(200).describe('Spec title'),
  goal: z.string().max(4000).describe('High-level engineering goal and scope'),
  acceptanceCriteria: z
    .array(z.string().max(500))
    .max(50)
    .optional()
    .describe('Acceptance criteria list'),
  planSteps: z.array(z.string().max(500)).max(80).optional().describe('Ordered implementation plan steps'),
  enforcePlanBeforeWrite: z
    .boolean()
    .optional()
    .describe('Block workspace write tools while spec is in draft status (default true)'),
  requireUiApproval: z
    .boolean()
    .optional()
    .describe('Require manual user approval in the agy-NOV Spec Flow UI (blocks model spec_approve when true; default false)'),
  tasks: z
    .array(SPEC_TASK_INPUT_SCHEMA)
    .max(100)
    .optional()
    .describe('Task DAG list validated for uniqueness, valid references, and zero cycles'),
  setActive: z
    .boolean()
    .optional()
    .describe('Set this spec as the active spec (defaults to true for newly created specs)'),
};

function serializeStateView(view: SpecStateView): Record<string, unknown> {
  return {
    mode: view.mode,
    activeSpecId: view.activeSpecId,
    activeSpec: view.activeSpec,
    specs: view.specs,
    writeLockActive: view.writeLockActive,
  };
}

function formatSpecSummaryText(view: SpecStateView): string {
  const lines: string[] = [
    `Spec Flow (${view.mode}): ${view.specs.length} spec(s), activeSpecId=${view.activeSpecId ?? 'none'}, writeLockActive=${view.writeLockActive}`,
  ];
  const spec = view.activeSpec;
  if (!spec) {
    lines.push('No active spec selected.');
    return lines.join('\n');
  }
  const doneCount = spec.tasks.filter((t) => t.status === 'done').length;
  const readyTasks = spec.tasks.filter((t) => t.computedState === 'ready');
  lines.push(
    `Spec "${spec.title}" [${spec.id}] — status=${spec.status}, enforcePlanBeforeWrite=${spec.enforcePlanBeforeWrite}, requireUiApproval=${spec.requireUiApproval}`,
  );
  lines.push(
    `Tasks: ${doneCount}/${spec.tasks.length} done, ${readyTasks.length} ready`,
  );
  for (const task of spec.tasks.slice(0, 12)) {
    const deps = task.dependsOn.length > 0 ? ` deps=[${task.dependsOn.join(', ')}]` : '';
    const unmet = task.unmetDeps.length > 0 ? ` unmet=[${task.unmetDeps.join(', ')}]` : '';
    lines.push(
      `- [${task.computedState}] ${task.id} (depth=${task.depth}): ${task.title}${deps}${unmet}`,
    );
  }
  if (spec.tasks.length > 12) {
    lines.push(`... (+${spec.tasks.length - 12} more tasks)`);
  }
  return lines.join('\n');
}

export function registerSpecModule(
  server: McpServer,
  options: NovRuntimeOptions,
  uiResourceUri: string,
): ModuleRegistrationResult {
  const rootDataDir = resolveNovDataDir(options.dataDir);
  const moduleDataDir = getModuleDataDir(rootDataDir, 'spec');
  const isDemo = options.demoMode === true;

  // Keep demo specs strictly in memory with zero disk writes
  const demoState: SpecStateFile | null = isDemo ? createDemoSpecState() : null;

  const APP_ONLY_META = {
    ui: {
      resourceUri: uiResourceUri,
      visibility: ['app'] as ['app'],
    },
  };

  const getCurrentStateFile = (): SpecStateFile =>
    isDemo && demoState ? demoState : loadSpecStateReadOnly(moduleDataDir);

  const getStateView = (
    specId?: string,
  ): { ok: true; view: SpecStateView } | { ok: false; error: string } => {
    const current = getCurrentStateFile();
    const trimmedSpecId = specId?.trim();
    if (trimmedSpecId && !current.specs.some((s) => s.id === trimmedSpecId)) {
      return { ok: false, error: `Spec not found: "${trimmedSpecId}".` };
    }
    return {
      ok: true,
      view: buildSpecStateView(current, isDemo ? 'demo' : 'live', trimmedSpecId || undefined),
    };
  };

  const runSaveSpec = (
    input: SaveSpecInput,
    actor: SpecActor,
  ): { ok: true; spec: SpecDocumentView; state: SpecStateView } | { ok: false; error: string } => {
    if (isDemo && demoState) {
      const res = applySaveSpecInMemory(demoState, input, actor);
      if (!res.ok) return res;
      return {
        ok: true,
        spec: res.spec,
        state: buildSpecStateView(demoState, 'demo'),
      };
    }
    const res = saveSpec(moduleDataDir, input, actor);
    if (!res.ok) return res;
    return {
      ok: true,
      spec: res.spec,
      state: buildSpecStateView(res.state, 'live'),
    };
  };

  const runSetStatus = (
    input: SetSpecStatusInput,
    actor: SpecActor,
  ): { ok: true; spec: SpecDocumentView; state: SpecStateView } | { ok: false; error: string } => {
    if (isDemo && demoState) {
      const res = applySetSpecStatusInMemory(demoState, input, actor);
      if (!res.ok) return res;
      return {
        ok: true,
        spec: res.spec,
        state: buildSpecStateView(demoState, 'demo'),
      };
    }
    const res = setSpecStatus(moduleDataDir, input, actor);
    if (!res.ok) return res;
    return {
      ok: true,
      spec: res.spec,
      state: buildSpecStateView(res.state, 'live'),
    };
  };

  const runUpdateTask = (
    input: UpdateSpecTaskInput,
    actor: SpecActor,
  ): { ok: true; task: SpecTaskView; state: SpecStateView } | { ok: false; error: string } => {
    if (isDemo && demoState) {
      const res = applyUpdateSpecTaskInMemory(demoState, input, actor);
      if (!res.ok) return res;
      return {
        ok: true,
        task: res.task,
        state: buildSpecStateView(demoState, 'demo'),
      };
    }
    const res = updateSpecTask(moduleDataDir, input, actor);
    if (!res.ok) return res;
    return {
      ok: true,
      task: res.task,
      state: buildSpecStateView(res.state, 'live'),
    };
  };

  const modelTools: ModuleToolHandle[] = [];

  // 1. Model-visible: spec_get_state
  const getStateTool = server.registerTool(
    'spec_get_state',
    {
      title: 'Get Spec Flow & Task DAG State',
      description:
        'Read the active (or specified) Spec document, computed Task DAG states/depths, write-lock status, and all tracked specs without modifying disk.',
      inputSchema: {
        specId: z
          .string()
          .max(64)
          .optional()
          .describe('Optional spec ID to inspect; defaults to the active spec'),
      },
    },
    async ({ specId }) => {
      const res = getStateView(specId);
      if (!res.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: res.error }],
        };
      }
      return {
        content: [{ type: 'text', text: formatSpecSummaryText(res.view) }],
        structuredContent: serializeStateView(res.view),
      };
    },
  );
  modelTools.push(toHandle('spec_get_state', getStateTool));

  // 2. Model-visible: spec_create_or_update
  const createOrUpdateTool = server.registerTool(
    'spec_create_or_update',
    {
      title: 'Create or Update Spec & Task DAG',
      description:
        'Create a new draft Spec or update an existing Spec and its Task DAG. Validates task ID format/uniqueness, dependency references, and rejects cycles via Kahn topological sort.',
      inputSchema: SAVE_SPEC_INPUT_SCHEMA,
    },
    async (input) => {
      const res = runSaveSpec(input, 'model');
      if (!res.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: res.error }],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Saved spec "${res.spec.title}" (${res.spec.id}) [${res.spec.status}] with ${res.spec.tasks.length} task(s). writeLockActive=${res.state.writeLockActive}.`,
          },
        ],
        structuredContent: {
          spec: res.spec,
          state: res.state,
        },
      };
    },
  );
  modelTools.push(toHandle('spec_create_or_update', createOrUpdateTool));

  // 3. Model-visible: spec_approve
  const approveTool = server.registerTool(
    'spec_approve',
    {
      title: 'Approve Spec',
      description:
        'Approve a draft Spec to unlock the pre-approval write gate. Automatically rejected if requireUiApproval is enabled (must be approved by the user in the agy-NOV Spec Flow UI).',
      inputSchema: {
        specId: z
          .string()
          .max(64)
          .optional()
          .describe('Spec ID to approve; defaults to the active spec'),
        approvalNote: z.string().max(1000).optional().describe('Optional approval note'),
      },
    },
    async ({ specId, approvalNote }) => {
      const res = runSetStatus(
        {
          specId,
          status: 'approved',
          approvalNote,
        },
        'model',
      );
      if (!res.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: res.error }],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Approved spec "${res.spec.title}" (${res.spec.id}). writeLockActive=${res.state.writeLockActive}.`,
          },
        ],
        structuredContent: {
          spec: res.spec,
          state: res.state,
        },
      };
    },
  );
  modelTools.push(toHandle('spec_approve', approveTool));

  // 4. Model-visible: spec_update_task
  const updateTaskTool = server.registerTool(
    'spec_update_task',
    {
      title: 'Update Spec Task Status',
      description:
        'Update a task status (pending, in_progress, done, blocked) within a Spec DAG. Rejects transitions to in_progress or done while the spec is in draft with write lock enabled, or when prerequisite dependencies are not done.',
      inputSchema: {
        specId: z
          .string()
          .max(64)
          .optional()
          .describe('Spec ID; defaults to the active spec'),
        taskId: z.string().max(48).describe('Task ID within the spec'),
        status: SPEC_TASK_STATUS_ENUM.describe('Target task status'),
        note: z.string().max(2000).optional().describe('Optional progress or blocker note'),
      },
    },
    async ({ specId, taskId, status, note }) => {
      const res = runUpdateTask(
        {
          specId,
          taskId,
          status: status as SpecTaskStatus,
          note,
        },
        'model',
      );
      if (!res.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: res.error }],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Updated task "${res.task.id}" -> ${res.task.status} (computedState=${res.task.computedState}).`,
          },
        ],
        structuredContent: {
          task: res.task,
          state: res.state,
        },
      };
    },
  );
  modelTools.push(toHandle('spec_update_task', updateTaskTool));

  // App-only tools (4)
  server.registerTool(
    'app_spec_get_state',
    {
      title: 'Get Spec Flow State (App Only)',
      description: 'Read Spec Flow state, active Spec DAG view, and write-lock status for the UI.',
      inputSchema: {
        specId: z.string().max(64).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ specId }) => {
      const res = getStateView(specId);
      if (!res.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: res.error }],
        };
      }
      return {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: serializeStateView(res.view),
      };
    },
  );

  server.registerTool(
    'app_spec_save',
    {
      title: 'Save Spec & Task DAG (App Only)',
      description: 'Create or update a Spec document and Task DAG from the Spec Flow UI.',
      inputSchema: SAVE_SPEC_INPUT_SCHEMA,
      _meta: APP_ONLY_META,
    },
    async (input) => {
      const res = runSaveSpec(input, 'user');
      if (!res.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: res.error }],
        };
      }
      return {
        content: [{ type: 'text', text: 'saved' }],
        structuredContent: {
          spec: res.spec,
          state: res.state,
        },
      };
    },
  );

  server.registerTool(
    'app_spec_set_status',
    {
      title: 'Set Spec Status & Guardrails (App Only)',
      description:
        'Update Spec lifecycle status (draft/approved/completed/archived), write-lock settings, requireUiApproval flag, or active selection as the user.',
      inputSchema: {
        specId: z.string().min(1).max(64),
        status: SPEC_STATUS_ENUM,
        enforcePlanBeforeWrite: z.boolean().optional(),
        requireUiApproval: z.boolean().optional(),
        approvalNote: z.string().max(1000).optional(),
        setActive: z.boolean().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({
      specId,
      status,
      enforcePlanBeforeWrite,
      requireUiApproval,
      approvalNote,
      setActive,
    }) => {
      const res = runSetStatus(
        {
          specId,
          status: status as SpecStatus,
          enforcePlanBeforeWrite,
          requireUiApproval,
          approvalNote,
          setActive,
        },
        'user',
      );
      if (!res.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: res.error }],
        };
      }
      return {
        content: [{ type: 'text', text: res.spec.status }],
        structuredContent: {
          spec: res.spec,
          state: res.state,
        },
      };
    },
  );

  server.registerTool(
    'app_spec_update_task',
    {
      title: 'Update Spec Task (App Only)',
      description: 'Update a task status and note from the Spec Flow UI with DAG dependency validation.',
      inputSchema: {
        specId: z.string().min(1).max(64),
        taskId: z.string().min(1).max(48),
        status: SPEC_TASK_STATUS_ENUM,
        note: z.string().max(2000).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ specId, taskId, status, note }) => {
      const res = runUpdateTask(
        {
          specId,
          taskId,
          status: status as SpecTaskStatus,
          note,
        },
        'user',
      );
      if (!res.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: res.error }],
        };
      }
      return {
        content: [{ type: 'text', text: res.task.status }],
        structuredContent: {
          task: res.task,
          state: res.state,
        },
      };
    },
  );

  return {
    moduleId: 'spec',
    modelTools,
    exemptReadOnlyAppTools: ['app_spec_get_state'],
  };
}
