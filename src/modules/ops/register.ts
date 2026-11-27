import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import type {
  ModuleRegistrationResult,
  ModuleToolHandle,
  NovRuntimeOptions,
} from '../../core/types.js';
import {
  auditWorkspaceAssets,
  buildPromptRecordFromInput,
  BUILTIN_PROMPTS,
  createDemoOpsAuditReport,
  deletePromptTemplate,
  filterPromptTemplates,
  listPromptTemplates,
  mergePromptTemplates,
  renderPromptTemplate,
  savePromptTemplate,
  type PromptCategory,
  type PromptTemplate,
  type WorkspaceAuditReport,
} from './core.js';

function toHandle(name: string, tool: RegisteredTool): ModuleToolHandle {
  return {
    name,
    enable: () => tool.enable(),
    disable: () => tool.disable(),
  };
}

const PROMPT_CATEGORY_ENUM = z.enum([
  'review',
  'debug',
  'release',
  'security',
  'handoff',
  'custom',
]);

const PROMPT_VAR_SCHEMA = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  defaultValue: z.string().optional(),
  required: z.boolean().optional(),
});

export function registerOpsModule(
  server: McpServer,
  options: NovRuntimeOptions,
  uiResourceUri: string,
): ModuleRegistrationResult {
  const rootDataDir = resolveNovDataDir(options.dataDir);
  const moduleDataDir = getModuleDataDir(rootDataDir, 'ops');
  const workspaceRoot = options.workspaceRoot;
  const isDemo = options.demoMode === true;

  // In demo mode keep custom templates & audit cache strictly in memory (zero disk writes)
  const demoCustomPrompts: PromptTemplate[] = isDemo
    ? [
        buildPromptRecordFromInput({
          id: 'demo-release-readiness',
          title: 'Release Readiness Gate / 发布上线前检查',
          category: 'release',
          description: 'Custom team template verifying offline guarantees, bundle size, and rollback plan.',
          tags: ['release', 'checklist', 'demo'],
          body: '请核对 {{version}} 发布前的门禁清单：确认 UI 包体积小于 {{max_mb}} MiB，全部单元测试通过，并检查 {{module_scope}} 的默认关闭边界。',
          variables: [
            { name: 'version', defaultValue: 'v0.3.0' },
            { name: 'max_mb', defaultValue: '10' },
            { name: 'module_scope', defaultValue: 'opt-in remote' },
          ],
        }),
      ]
    : [];

  let cachedAudit: WorkspaceAuditReport | null = null;

  const APP_ONLY_META = {
    ui: {
      resourceUri: uiResourceUri,
      visibility: ['app'] as ['app'],
    },
  };

  const getPrompts = (filter?: { category?: PromptCategory; query?: string }): PromptTemplate[] => {
    if (isDemo) {
      return filterPromptTemplates(mergePromptTemplates(demoCustomPrompts), filter);
    }
    return listPromptTemplates(moduleDataDir, filter);
  };

  const runAudit = (): WorkspaceAuditReport => {
    const report = isDemo
      ? createDemoOpsAuditReport(workspaceRoot)
      : auditWorkspaceAssets(workspaceRoot, rootDataDir);
    cachedAudit = report;
    return report;
  };

  const buildState = () => {
    const prompts = getPrompts();
    const audit = cachedAudit ?? runAudit();
    return {
      mode: isDemo ? 'demo' : 'live',
      prompts,
      promptCount: prompts.length,
      builtInCount: prompts.filter((p) => p.builtIn).length,
      customCount: prompts.filter((p) => !p.builtIn).length,
      audit,
    };
  };

  const modelTools: ModuleToolHandle[] = [];

  // 1. Model-visible: ops_list_prompts
  const listPromptsTool = server.registerTool(
    'ops_list_prompts',
    {
      title: 'List Prompt Vault Templates',
      description:
        'List built-in and custom {{variable}} engineering prompt templates in the local Prompt Vault.',
      inputSchema: {
        category: PROMPT_CATEGORY_ENUM.optional(),
        query: z.string().optional().describe('Optional keyword filter across title, tags, and body'),
      },
    },
    async ({ category, query }) => {
      const prompts = getPrompts({ category, query });
      const text = prompts.length
        ? prompts
            .map(
              (p) =>
                `- [${p.category}${p.builtIn ? ' · built-in' : ' · custom'}] ${p.id}: ${p.title} (vars: ${p.variables.map((v) => `{{${v.name}}}`).join(', ') || 'none'})`,
            )
            .join('\n')
        : 'No prompt templates matched the filter.';
      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          count: prompts.length,
          prompts: prompts.map((p) => ({
            id: p.id,
            title: p.title,
            category: p.category,
            description: p.description,
            tags: p.tags,
            variables: p.variables,
            builtIn: p.builtIn,
          })),
        },
      };
    },
  );
  modelTools.push(toHandle('ops_list_prompts', listPromptsTool));

  // 2. Model-visible: ops_render_prompt
  const renderPromptTool = server.registerTool(
    'ops_render_prompt',
    {
      title: 'Render Prompt Template',
      description:
        'Safely render a Prompt Vault template by ID using {{variable}} substitution without recursive expansion.',
      inputSchema: {
        id: z.string().min(1).describe('Prompt template ID'),
        variables: z
          .record(z.string(), z.string())
          .optional()
          .describe('Map of variable name to replacement value'),
      },
    },
    async ({ id, variables }) => {
      const tpl = getPrompts().find((p) => p.id === id);
      if (!tpl) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Prompt template not found: ${id}` }],
        };
      }
      const rendered = renderPromptTemplate(tpl, variables ?? {});
      const missingNote =
        rendered.missingVariables.length > 0
          ? `\n\n[Missing variables: ${rendered.missingVariables.join(', ')}]`
          : '';
      return {
        content: [{ type: 'text', text: `${rendered.rendered}${missingNote}` }],
        structuredContent: { ...rendered },
      };
    },
  );
  modelTools.push(toHandle('ops_render_prompt', renderPromptTool));

  // 3. Model-visible: ops_audit_workspace
  const auditWorkspaceTool = server.registerTool(
    'ops_audit_workspace',
    {
      title: 'Audit Workspace Assets & Storage',
      description:
        'Read-only inspection of workspace agent rules, skills, manifests, MCP/hook configs, token estimates, and local agy-NOV storage usage.',
      inputSchema: {},
    },
    async () => {
      try {
        const report = runAudit();
        const lines = [
          `Workspace Audit (${report.workspaceName}, score=${report.healthScore}/100): ${report.summary.assetCount} asset(s), ~${report.summary.totalEstimatedTokens} tokens (${report.summary.totalBytes} bytes)`,
          `Local storage: ${report.storage.rootDataDirExists ? `${report.storage.totalFiles} files, ${report.storage.totalBytes} bytes` : 'not initialized (0 bytes)'}`,
          ...report.assets.slice(0, 12).map(
            (a) => `- [${a.kind}] ${a.relPath}: ~${a.estimatedTokens} tokens (${a.bytes}B, ${a.lineCount}L)`,
          ),
          ...report.recommendations.map((r) => `• [${r.level.toUpperCase()}] ${r.title}: ${r.detail}`),
        ];
        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: { ...report },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );
  modelTools.push(toHandle('ops_audit_workspace', auditWorkspaceTool));

  // App-only tools (5)
  server.registerTool(
    'app_ops_get_state',
    {
      title: 'Get Ops State (App Only)',
      description: 'Fetch Prompt Vault templates and workspace audit report for the Ops UI.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: buildState(),
    }),
  );

  server.registerTool(
    'app_ops_save_prompt',
    {
      title: 'Save Prompt Template (App Only)',
      description: 'Create or update a custom {{variable}} prompt template.',
      inputSchema: {
        id: z.string().optional(),
        title: z.string().min(2),
        category: PROMPT_CATEGORY_ENUM.optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        body: z.string().min(4),
        variables: z.array(PROMPT_VAR_SCHEMA).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async (input) => {
      try {
        let saved: PromptTemplate;
        if (isDemo) {
          saved = buildPromptRecordFromInput(input);
          const idx = demoCustomPrompts.findIndex((p) => p.id === saved.id);
          if (idx >= 0) demoCustomPrompts[idx] = saved;
          else demoCustomPrompts.push(saved);
        } else {
          saved = savePromptTemplate(moduleDataDir, input);
        }
        return {
          content: [{ type: 'text', text: 'saved' }],
          structuredContent: { saved, state: buildState() },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  server.registerTool(
    'app_ops_delete_prompt',
    {
      title: 'Delete Prompt Template (App Only)',
      description: 'Delete a custom prompt template from Prompt Vault.',
      inputSchema: {
        id: z.string().min(1),
      },
      _meta: APP_ONLY_META,
    },
    async ({ id }) => {
      let res: { deleted: boolean; reason?: string };
      if (isDemo) {
        const idx = demoCustomPrompts.findIndex((p) => p.id === id);
        if (idx >= 0) {
          demoCustomPrompts.splice(idx, 1);
          res = { deleted: true };
        } else {
          const isBuiltIn = BUILTIN_PROMPTS.some((p) => p.id === id);
          res = {
            deleted: false,
            reason: isBuiltIn
              ? `Built-in template "${id}" cannot be deleted`
              : `Prompt template "${id}" not found`,
          };
        }
      } else {
        res = deletePromptTemplate(moduleDataDir, id);
      }
      return {
        content: [{ type: 'text', text: res.deleted ? 'deleted' : res.reason ?? 'not_deleted' }],
        structuredContent: { ...res, state: buildState() },
      };
    },
  );

  server.registerTool(
    'app_ops_render_prompt',
    {
      title: 'Render Prompt Template (App Only)',
      description: 'Render a template with provided variables from the Ops UI.',
      inputSchema: {
        id: z.string().min(1),
        variables: z.record(z.string(), z.string()).optional(),
      },
      _meta: APP_ONLY_META,
    },
    async ({ id, variables }) => {
      const tpl = getPrompts().find((p) => p.id === id);
      if (!tpl) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Prompt template not found: ${id}` }],
        };
      }
      const rendered = renderPromptTemplate(tpl, variables ?? {});
      return {
        content: [{ type: 'text', text: rendered.rendered }],
        structuredContent: { ...rendered },
      };
    },
  );

  server.registerTool(
    'app_ops_audit_workspace',
    {
      title: 'Audit Workspace Assets (App Only)',
      description: 'Trigger a fresh read-only workspace asset, token, and storage audit from the Ops UI.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => {
      try {
        const report = runAudit();
        return {
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: { report, state: buildState() },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  return {
    moduleId: 'ops',
    modelTools,
  };
}
