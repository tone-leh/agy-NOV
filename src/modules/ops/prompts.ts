import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from '../../core/fs-safe.js';
import type {
  PromptCategory,
  PromptTemplate,
  PromptVariableSpec,
  RenderPromptResult,
  SavePromptInput,
} from './types.js';

const VALID_CATEGORIES = new Set<PromptCategory>([
  'review',
  'debug',
  'release',
  'security',
  'handoff',
  'custom',
]);

const VARIABLE_TOKEN_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g;
const BUILTIN_TIMESTAMP = '2026-01-01T00:00:00.000Z';

export const BUILTIN_PROMPTS: readonly PromptTemplate[] = [
  {
    id: 'builtin-code-review',
    title: 'Code Review Checklist / PR 级代码审查',
    category: 'review',
    description:
      'Structured diff review covering correctness, security boundaries, edge cases, and test coverage.',
    tags: ['review', 'diff', 'quality', '代码审查'],
    body: [
      '请对以下变更范围执行 PR 级代码审查（Scope: {{scope}}）。',
      '重点审查维度 / Focus Areas: {{focus}}',
      '预期风险等级 / Risk Level: {{risk_level}}',
      '',
      '请按严重程度（Critical / High / Medium / Low）输出具体 `file:line` 问题、复现条件与最小修复方案，并指出缺失的单元测试用例。',
    ].join('\n'),
    variables: [
      { name: 'scope', description: 'Branch, PR, or file list under review', required: true },
      {
        name: 'focus',
        description: 'Key focus areas',
        defaultValue: 'correctness, security boundaries, error handling, performance',
      },
      { name: 'risk_level', description: 'Expected change risk', defaultValue: 'medium' },
    ],
    builtIn: true,
    updatedAt: BUILTIN_TIMESTAMP,
  },
  {
    id: 'builtin-incident-rca',
    title: 'Incident Root Cause Analysis / 事故根因排查',
    category: 'debug',
    description:
      'Hypothesis-driven incident triage separating symptoms, evidence, root cause, and safe rollback.',
    tags: ['rca', 'debug', 'incident', '根因排查'],
    body: [
      '请协助排查线上/测试故障（Service: {{service}}）。',
      '异常现象 / Symptom: {{symptom}}',
      '发生时间窗口 / Timeframe: {{timeframe}}',
      '近期变更 / Recent Changes: {{recent_changes}}',
      '',
      '请输出：',
      '1. Top 3 根因假设及各自最快的只读验证命令；',
      '2. 区分已证实事实与待验证推断；',
      '3. 止血/回滚方案与长期防复发护栏。',
    ].join('\n'),
    variables: [
      { name: 'service', description: 'Affected service or module name', required: true },
      { name: 'symptom', description: 'Observed failure, error code, or metric anomaly', required: true },
      { name: 'timeframe', description: 'When the anomaly began', defaultValue: 'last 30 minutes' },
      { name: 'recent_changes', description: 'Recent deploys or config edits', defaultValue: 'unknown — inspect git log' },
    ],
    builtIn: true,
    updatedAt: BUILTIN_TIMESTAMP,
  },
  {
    id: 'builtin-pr-summary',
    title: 'Pull Request Summary / PR 变更说明生成',
    category: 'release',
    description:
      'Concise PR description with motivation, key file changes, verification evidence, and rollback notes.',
    tags: ['pr', 'release', 'changelog', '变更说明'],
    body: [
      '请基于分支 `{{branch}}` 生成清晰、可审计的 Pull Request 说明。',
      '核心变更点 / Key Changes: {{changes}}',
      '验证与实测记录 / Verification: {{testing}}',
      '',
      '请按以下结构组织（中英双语标题皆可）：Summary、Changed Files、Verification（区分静态检查/单元测试/端到端）、Breaking Changes & Rollback。',
    ].join('\n'),
    variables: [
      { name: 'branch', description: 'Source branch name', required: true },
      { name: 'changes', description: 'Summary of implemented changes', required: true },
      { name: 'testing', description: 'Commands executed and observed results', defaultValue: 'npm run typecheck && npm test' },
    ],
    builtIn: true,
    updatedAt: BUILTIN_TIMESTAMP,
  },
  {
    id: 'builtin-security-audit',
    title: 'Security Audit Checklist / 安全审计清单',
    category: 'security',
    description:
      'Adversarial security audit focusing on path traversal, symlink escape, injection, and secret redaction.',
    tags: ['security', 'audit', 'appsec', '安全审计'],
    body: [
      '请以只读对抗视角审计目标模块：`{{target}}`。',
      '攻击面 / Attack Surface: {{attack_surface}}',
      '合规与基线要求 / Baseline: {{compliance}}',
      '',
      '重点核查：路径穿越与 symlink realpath 逃逸、命令/正则 ReDoS 注入、敏感文件（.env/SSH/密钥）泄露与脱敏、最小权限与默认关闭红线，并给出可复现验证用例。',
    ].join('\n'),
    variables: [
      { name: 'target', description: 'Module, API, or directory to audit', required: true },
      {
        name: 'attack_surface',
        description: 'Untrusted inputs or external interfaces',
        defaultValue: 'file paths, CLI flags, hook payloads, MCP tool inputs',
      },
      {
        name: 'compliance',
        description: 'Security policy baseline',
        defaultValue: 'offline-first, mode 0600 secrets, zero shell interpolation',
      },
    ],
    builtIn: true,
    updatedAt: BUILTIN_TIMESTAMP,
  },
  {
    id: 'builtin-session-handoff',
    title: 'Session Handoff Brief / 跨会话交接摘要',
    category: 'handoff',
    description:
      'High-signal handoff note for resuming work cleanly in a fresh conversation or another coding agent.',
    tags: ['handoff', 'summary', 'continuity', '交接摘要'],
    body: [
      '请生成一份精简且可直接接续执行的交接摘要（Goal: {{goal}}）。',
      '已完成事项 / Completed: {{completed}}',
      '待办与阻塞 / Pending: {{pending}}',
      '验证状态 / Verification: {{verification}}',
      '',
      '要求列出涉及文件路径、未提交改动状态、明确区分已实测与未验证项，以及下一位接手者的第一步操作。',
    ].join('\n'),
    variables: [
      { name: 'goal', description: 'Overall task objective', required: true },
      { name: 'completed', description: 'Finished deliverables and modified paths', required: true },
      { name: 'pending', description: 'Remaining work or open blockers', defaultValue: 'none' },
      { name: 'verification', description: 'Checks run so far', defaultValue: 'pending final verification' },
    ],
    builtIn: true,
    updatedAt: BUILTIN_TIMESTAMP,
  },
];

export function getPromptsFilePath(moduleDataDir: string): string {
  return path.join(moduleDataDir, 'prompts.json');
}

export function extractTemplateVariables(body: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  VARIABLE_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VARIABLE_TOKEN_RE.exec(body)) !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      found.push(name);
    }
  }
  return found;
}

function normalizeVariableSpecs(
  body: string,
  provided?: PromptVariableSpec[],
): PromptVariableSpec[] {
  const map = new Map<string, PromptVariableSpec>();
  for (const spec of provided ?? []) {
    if (!spec || typeof spec.name !== 'string') continue;
    const cleanName = spec.name.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(cleanName)) continue;
    map.set(cleanName, {
      name: cleanName,
      description: typeof spec.description === 'string' ? spec.description.trim().slice(0, 160) : undefined,
      defaultValue: typeof spec.defaultValue === 'string' ? spec.defaultValue : undefined,
      required: typeof spec.required === 'boolean' ? spec.required : undefined,
    });
  }

  const ordered: PromptVariableSpec[] = [];
  const extracted = extractTemplateVariables(body);
  for (const name of extracted) {
    const existing = map.get(name);
    if (existing) {
      ordered.push(existing);
      map.delete(name);
    } else {
      ordered.push({ name, required: true });
    }
  }
  for (const remaining of map.values()) {
    ordered.push(remaining);
  }
  return ordered;
}

function normalizePromptRecord(raw: unknown): PromptTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id.trim() : '';
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  const body = typeof obj.body === 'string' ? obj.body : '';
  if (!id || !title || !body) return null;

  const category: PromptCategory =
    typeof obj.category === 'string' && VALID_CATEGORIES.has(obj.category as PromptCategory)
      ? (obj.category as PromptCategory)
      : 'custom';
  const tags = Array.isArray(obj.tags)
    ? Array.from(
        new Set(
          obj.tags
            .filter((t): t is string => typeof t === 'string')
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ).slice(0, 12)
    : [];

  return {
    id,
    title: title.slice(0, 120),
    category,
    description: typeof obj.description === 'string' ? obj.description.trim().slice(0, 240) : '',
    tags,
    body,
    variables: normalizeVariableSpecs(
      body,
      Array.isArray(obj.variables) ? (obj.variables as PromptVariableSpec[]) : undefined,
    ),
    builtIn: false,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
  };
}

/**
 * Pure read-only loader for custom prompts. Never touches disk when missing.
 */
export function loadCustomPromptsReadOnly(moduleDataDir: string): PromptTemplate[] {
  const filePath = getPromptsFilePath(moduleDataDir);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { prompts?: unknown[] } | unknown[];
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.prompts)
        ? parsed.prompts
        : [];
    const out: PromptTemplate[] = [];
    for (const item of list) {
      const normalized = normalizePromptRecord(item);
      if (normalized) out.push(normalized);
    }
    return out;
  } catch {
    return [];
  }
}

export function mergePromptTemplates(customPrompts: readonly PromptTemplate[]): PromptTemplate[] {
  const byId = new Map<string, PromptTemplate>();
  for (const builtIn of BUILTIN_PROMPTS) {
    byId.set(builtIn.id, {
      ...builtIn,
      tags: [...builtIn.tags],
      variables: builtIn.variables.map((v) => ({ ...v })),
    });
  }
  for (const custom of customPrompts) {
    byId.set(custom.id, {
      ...custom,
      builtIn: false,
      tags: [...custom.tags],
      variables: custom.variables.map((v) => ({ ...v })),
    });
  }
  return Array.from(byId.values());
}

export function filterPromptTemplates(
  templates: readonly PromptTemplate[],
  opts: { category?: PromptCategory; query?: string } = {},
): PromptTemplate[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  return templates.filter((tpl) => {
    if (opts.category && tpl.category !== opts.category) return false;
    if (!q) return true;
    const hay = `${tpl.id} ${tpl.title} ${tpl.description} ${tpl.tags.join(' ')} ${tpl.body}`.toLowerCase();
    return hay.includes(q);
  });
}

export function listPromptTemplates(
  moduleDataDir: string,
  opts: { category?: PromptCategory; query?: string } = {},
): PromptTemplate[] {
  const custom = loadCustomPromptsReadOnly(moduleDataDir);
  return filterPromptTemplates(mergePromptTemplates(custom), opts);
}

export function buildPromptRecordFromInput(input: SavePromptInput): PromptTemplate {
  const title = (input.title ?? '').trim();
  const body = (input.body ?? '').trim();
  if (title.length < 2) {
    throw new Error('Prompt title must be at least 2 characters');
  }
  if (body.length < 4) {
    throw new Error('Prompt body must be at least 4 characters');
  }

  const rawId = input.id?.trim();
  const safeId =
    rawId && /^[A-Za-z0-9_.-]{2,64}$/.test(rawId)
      ? rawId
      : `usr_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

  const category: PromptCategory =
    input.category && VALID_CATEGORIES.has(input.category) ? input.category : 'custom';

  const tags = Array.from(
    new Set(
      (input.tags ?? [])
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ).slice(0, 12);

  return {
    id: safeId,
    title: title.slice(0, 120),
    category,
    description: (input.description ?? '').trim().slice(0, 240),
    tags,
    body,
    variables: normalizeVariableSpecs(body, input.variables),
    builtIn: false,
    updatedAt: new Date().toISOString(),
  };
}

export function savePromptTemplate(
  moduleDataDir: string,
  input: SavePromptInput,
): PromptTemplate {
  const next = buildPromptRecordFromInput(input);
  const existing = loadCustomPromptsReadOnly(moduleDataDir);
  const idx = existing.findIndex((p) => p.id === next.id);
  if (idx >= 0) {
    existing[idx] = next;
  } else {
    existing.push(next);
  }
  atomicWriteJson(getPromptsFilePath(moduleDataDir), {
    schemaVersion: 1,
    prompts: existing,
    updatedAt: next.updatedAt,
  });
  return next;
}

export function deletePromptTemplate(
  moduleDataDir: string,
  id: string,
): { deleted: boolean; reason?: string } {
  const existing = loadCustomPromptsReadOnly(moduleDataDir);
  const idx = existing.findIndex((p) => p.id === id);
  if (idx < 0) {
    const isBuiltIn = BUILTIN_PROMPTS.some((p) => p.id === id);
    return {
      deleted: false,
      reason: isBuiltIn
        ? `Built-in template "${id}" cannot be deleted`
        : `Prompt template "${id}" not found`,
    };
  }
  existing.splice(idx, 1);
  atomicWriteJson(getPromptsFilePath(moduleDataDir), {
    schemaVersion: 1,
    prompts: existing,
    updatedAt: new Date().toISOString(),
  });
  return { deleted: true };
}

/**
 * Single-pass non-recursive {{variable}} renderer.
 * Prevents nested template expansion when variable values themselves contain "{{...}}".
 */
export function renderPromptTemplate(
  template: PromptTemplate,
  variables: Record<string, string> = {},
): RenderPromptResult {
  const specMap = new Map<string, PromptVariableSpec>();
  for (const spec of template.variables) {
    specMap.set(spec.name, spec);
  }

  const usedVariables: string[] = [];
  const defaultedVariables: string[] = [];
  const missingVariables: string[] = [];

  const pushUnique = (arr: string[], name: string) => {
    if (!arr.includes(name)) arr.push(name);
  };

  const rendered = template.body.replace(VARIABLE_TOKEN_RE, (fullMatch, varName: string) => {
    const provided = Object.prototype.hasOwnProperty.call(variables, varName)
      ? variables[varName]
      : undefined;
    if (typeof provided === 'string' && provided.length > 0) {
      pushUnique(usedVariables, varName);
      return provided;
    }
    const spec = specMap.get(varName);
    if (spec?.defaultValue !== undefined && spec.defaultValue !== '') {
      pushUnique(defaultedVariables, varName);
      return spec.defaultValue;
    }
    pushUnique(missingVariables, varName);
    return fullMatch;
  });

  return {
    promptId: template.id,
    title: template.title,
    rendered,
    usedVariables,
    defaultedVariables,
    missingVariables,
    estimatedTokens: Math.ceil(rendered.length / 4),
  };
}
