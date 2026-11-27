import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  countEnabledModelTools,
  createDefaultConfig,
  loadNovConfigReadOnly,
  loadTeamPresetReadOnly,
  MODULE_IDS,
  type TeamPresetAuditResult,
} from '../../core/config.js';
import { atomicWriteJson, canonicalRealpathSync, isPathInsideDir } from '../../core/utils.js';

export type { TeamPresetAuditResult };

export type PromptCategory =
  | 'review'
  | 'debug'
  | 'release'
  | 'security'
  | 'handoff'
  | 'custom';

export interface PromptVariableSpec {
  name: string;
  description?: string;
  defaultValue?: string;
  required?: boolean;
}

export interface PromptTemplate {
  id: string;
  title: string;
  category: PromptCategory;
  description: string;
  tags: string[];
  body: string;
  variables: PromptVariableSpec[];
  builtIn: boolean;
  updatedAt: string;
}

export interface SavePromptInput {
  id?: string;
  title: string;
  category?: PromptCategory;
  description?: string;
  tags?: string[];
  body: string;
  variables?: PromptVariableSpec[];
}

export interface RenderPromptResult {
  promptId: string;
  title: string;
  rendered: string;
  usedVariables: string[];
  defaultedVariables: string[];
  missingVariables: string[];
  estimatedTokens: number;
}

export type WorkspaceAssetKind =
  | 'rules'
  | 'skill'
  | 'manifest'
  | 'mcp'
  | 'hooks'
  | 'agent-config';

export interface WorkspaceAssetEntry {
  relPath: string;
  kind: WorkspaceAssetKind;
  bytes: number;
  chars: number;
  estimatedTokens: number;
  lineCount: number;
  meta?: Record<string, unknown>;
}

export interface ModuleStorageStat {
  moduleId: string;
  bytes: number;
  files: number;
}

export interface StorageAuditSummary {
  rootDataDirExists: boolean;
  totalBytes: number;
  totalFiles: number;
  modules: ModuleStorageStat[];
}

export const RULE_SINGLE_FILE_LIMIT_BYTES = 24 * 1024; // 24576 bytes (24 KB)
export const RULE_AGGREGATE_TOKEN_LIMIT = 20_000;
export const TOOL_BUDGET_HARD_LIMIT = 100;
export const DEFAULT_TOOLS_PER_EXTERNAL_MCP_SERVER = 10;

export interface AuditRecommendation {
  level: 'info' | 'warn' | 'critical';
  code: string;
  title: string;
  detail: string;
}

export interface RuleBloatOffender {
  path: string;
  bytes: number;
  estimatedTokens: number;
  reason: string;
}

export interface RuleBloatAssessment {
  status: 'ok' | 'warn' | 'critical';
  singleFileLimitBytes: 24576;
  aggregateTokenLimit: 20000;
  largestFileBytes: number;
  largestFilePath?: string;
  totalRuleBytes: number;
  totalRuleTokens: number;
  offendingFiles: RuleBloatOffender[];
}

export interface ToolBudgetAssessment {
  agyNovTools: number;
  externalServersCount: number;
  estimatedExternalTools: number;
  estimatedTotalTools: number;
  hardLimit: 100;
  usagePercent: number;
  status: 'ok' | 'warn' | 'critical';
}

export interface McpHealthFinding {
  severity: 'info' | 'warn' | 'error';
  serverName?: string;
  file: string;
  message: string;
}

export type CrossClientKind = 'antigravity' | 'claude' | 'cursor' | 'codex' | 'shared';

export interface CrossClientFinding {
  severity: 'info' | 'warn' | 'error';
  code: string;
  client: CrossClientKind;
  file: string;
  message: string;
  suggestion?: string;
}

export type OpsSecuritySeverity = 'high' | 'medium' | 'low';

export type OpsSecurityCategory =
  | 'prompt-injection'
  | 'broad-command-allow'
  | 'risky-hook'
  | 'mcp-unsafe-env';

export interface OpsSecurityFinding {
  id: string;
  severity: OpsSecuritySeverity;
  category: OpsSecurityCategory;
  file: string;
  title: string;
  summary: string;
  remediation: string;
}

export type OpsMigrationClient = 'claude' | 'cursor' | 'codex';
export type OpsMigrationAction = 'dedupe-merge' | 'migrate-unique' | 'keep-pointer';

export interface OpsMigrationEntry {
  client: OpsMigrationClient;
  sourcePath: string;
  bytes: number;
  estimatedTokens: number;
  duplicatePercent: number;
  duplicateLines: number;
  totalLines: number;
  recommendedTarget: string;
  action: OpsMigrationAction;
}

export interface OpsMigrationPreview {
  readOnlyPreview: true;
  totalFiles: number;
  totalBytes: number;
  reclaimableBytes: number;
  estimatedSavingsPercent: number;
  estimatedSavedTokens: number;
  entries: OpsMigrationEntry[];
}

export const MAX_SECURITY_SCAN_FILE_BYTES = 256 * 1024; // 256 KiB cap
export const MAX_SECURITY_SCAN_FILES = 80;

export interface AuditWorkspaceOptions {
  enabledNovTools?: number;
}

export interface WorkspaceAuditReport {
  mode: 'live' | 'demo';
  workspaceName: string;
  scannedAt: string;
  healthScore: number;
  summary: {
    assetCount: number;
    totalBytes: number;
    totalChars: number;
    totalEstimatedTokens: number;
    skippedSymlinks: number;
    skippedSensitive: number;
    byKind: Record<WorkspaceAssetKind, { count: number; estimatedTokens: number }>;
  };
  assets: WorkspaceAssetEntry[];
  storage: StorageAuditSummary;
  recommendations: AuditRecommendation[];
  ruleBloat: RuleBloatAssessment;
  toolBudget: ToolBudgetAssessment;
  mcpHealthFindings: McpHealthFinding[];
  teamPreset: TeamPresetAuditResult;
  crossClientFindings: CrossClientFinding[];
  securityFindings: OpsSecurityFinding[];
  securityScore: number;
  migrationPreview: OpsMigrationPreview;
}

const VALID_CATEGORIES = new Set<PromptCategory>([
  'review',
  'debug',
  'release',
  'security',
  'handoff',
  'custom',
]);

const VARIABLE_TOKEN_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g;

const SENSITIVE_DIR_RE = /(?:^|\/)\.(?:ssh|aws|gnupg|kube)(?:\/|$)/i;
const SENSITIVE_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore']);
const SENSITIVE_BASENAMES = new Set([
  '.env',
  '.envrc',
  '.npmrc',
  '.netrc',
  '.pypirc',
  'id_rsa',
  'id_ed25519',
  'id_dsa',
  'id_ecdsa',
  'master.key',
]);

const ALLOWED_AGENT_CONFIG_EXTS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
]);

const MAX_AUDIT_FILE_BYTES = 1024 * 1024; // 1 MiB cap per config/doc file
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

export function isSensitiveOpsPath(inputPath: string): boolean {
  if (!inputPath) return false;
  const normalized = inputPath.replace(/\\/g, '/').trim().replace(/\/+$/, '');
  if (!normalized) return false;
  if (SENSITIVE_DIR_RE.test(normalized)) return true;

  const segments = normalized.split('/').filter(Boolean);
  for (const seg of segments) {
    const lowerSeg = seg.toLowerCase();
    if (
      lowerSeg === '.ssh' ||
      lowerSeg === '.aws' ||
      lowerSeg === '.gnupg' ||
      lowerSeg === '.kube' ||
      lowerSeg.startsWith('.env') ||
      lowerSeg.startsWith('credentials') ||
      lowerSeg.includes('secret')
    ) {
      return true;
    }
  }

  const base = path.posix.basename(normalized);
  const lower = base.toLowerCase();
  if (SENSITIVE_BASENAMES.has(lower)) return true;
  if (
    lower.startsWith('id_rsa.') ||
    lower.startsWith('id_ed25519.') ||
    lower.startsWith('id_dsa.') ||
    lower.startsWith('id_ecdsa.')
  ) {
    return true;
  }
  if (SENSITIVE_EXTENSIONS.has(path.posix.extname(lower))) return true;
  return false;
}

const PURE_ENV_REF_RE = /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/;
const ENV_VAR_EMBED_RE = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/;
const UNRESOLVED_PLACEHOLDER_RE =
  /\{\{[^}]+\}\}|<YOUR_[A-Z0-9_-]+>|\bYOUR_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|ID|URL|HOST|EMAIL)\b|\b(?:REPLACE_ME|CHANGEME|TODO_SET_[A-Z0-9_]+)\b/i;
const SENSITIVE_KEY_NAME_RE =
  /token|secret|key|auth|bearer|oauth|password|passwd|credential|cookie|private/i;
const OAUTH_OR_EXPIRING_KEY_RE =
  /oauth|access_?token|refresh_?token|id_?token|bearer|expires|expiry|session_?token/i;
const JWT_LIKE_RE = /^eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*$/;
const SECRET_VALUE_PATTERN_RE =
  /(?<![A-Za-z0-9])(?:ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|gh[ousr]_[A-Za-z0-9]{10,}|sk-(?:proj-|live-|test-|ant-)?[A-Za-z0-9_-]{12,}|sk_(?:live|test)_[A-Za-z0-9_-]{12,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|[Bb][Ee][Aa][Rr][Ee][Rr]\s+[A-Za-z0-9\-._~+/=]{8,})(?![A-Za-z0-9])/;
const SECRET_VALUE_REDACT_GLOBAL_RE =
  /(?<![A-Za-z0-9])(?:ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|gh[ousr]_[A-Za-z0-9]{10,}|sk-(?:proj-|live-|test-|ant-)?[A-Za-z0-9_-]{12,}|sk_(?:live|test)_[A-Za-z0-9_-]{12,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?|[Bb][Ee][Aa][Rr][Ee][Rr]\s+[A-Za-z0-9\-._~+/=]{8,})(?![A-Za-z0-9])/g;
const LOCAL_RUNTIME_COMMANDS = new Set([
  'node',
  'tsx',
  'ts-node',
  'python',
  'python3',
  'bash',
  'sh',
  'zsh',
  'bun',
  'deno',
  'ruby',
  'perl',
  'php',
]);
const KNOWN_PATH_CLI_COMMANDS = new Set([
  ...LOCAL_RUNTIME_COMMANDS,
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'uv',
  'uvx',
  'docker',
  'git',
  'cmd',
  'powershell',
  'pwsh',
]);
const SCRIPT_EXT_RE = /\.(?:[cm]?js|[cm]?ts|py|sh|bash|zsh|rb|pl|php|exe|bin|cmd|bat)$/i;
const WINDOWS_ABS_PATH_RE = /^[A-Za-z]:[\\/]/;

function normalizeRuntimeCommandBase(command: string): string {
  return path.posix
    .basename(command.replace(/\\/g, '/'))
    .toLowerCase()
    .replace(/\.(?:exe|cmd|bat)$/i, '');
}

function containsSecretPattern(value: string): boolean {
  return SECRET_VALUE_PATTERN_RE.test(value);
}

function redactSecretsInMessage(message: string): string {
  if (!containsSecretPattern(message)) return message;
  return message.replace(SECRET_VALUE_REDACT_GLOBAL_RE, '<redacted-path>');
}

function sanitizeMcpIdentifier(raw: string): string {
  return containsSecretPattern(raw) ? '<redacted-path>' : raw;
}

function sanitizeDisplayPath(raw: string): string {
  const cleaned = raw.split(/[?#]/)[0].trim();
  if (
    !cleaned ||
    SENSITIVE_KEY_NAME_RE.test(cleaned) ||
    containsSecretPattern(raw) ||
    containsSecretPattern(cleaned) ||
    cleaned.includes('=')
  ) {
    return '<redacted-path>';
  }
  return cleaned.slice(0, 100);
}

function findDuplicateServerKeysInJson(rawText: string): string[] {
  const duplicates = new Set<string>();
  try {
    let i = 0;
    const len = rawText.length;
    const skipWs = () => {
      while (i < len && /\s/.test(rawText[i])) i += 1;
    };
    const readString = (): string | null => {
      if (rawText[i] !== '"') return null;
      i += 1;
      let out = '';
      while (i < len) {
        const ch = rawText[i];
        if (ch === '\\') {
          if (i + 1 < len) out += rawText[i + 1];
          i += 2;
          continue;
        }
        if (ch === '"') {
          i += 1;
          return out;
        }
        out += ch;
        i += 1;
      }
      return null;
    };
    const skipValue = (): void => {
      skipWs();
      if (i >= len) return;
      const ch = rawText[i];
      if (ch === '"') {
        readString();
        return;
      }
      if (ch === '{' || ch === '[') {
        const open = ch;
        const close = ch === '{' ? '}' : ']';
        let depth = 1;
        i += 1;
        while (i < len && depth > 0) {
          const c = rawText[i];
          if (c === '"') {
            readString();
            continue;
          }
          if (c === open) depth += 1;
          else if (c === close) depth -= 1;
          i += 1;
        }
        return;
      }
      while (i < len && !/[,}\]\s]/.test(rawText[i])) i += 1;
    };
    const scanServersObject = (): void => {
      skipWs();
      if (rawText[i] !== '{') {
        skipValue();
        return;
      }
      i += 1;
      const seen = new Set<string>();
      while (i < len) {
        skipWs();
        if (rawText[i] === '}') {
          i += 1;
          return;
        }
        const key = readString();
        if (key === null) return;
        if (seen.has(key)) duplicates.add(key);
        else seen.add(key);
        skipWs();
        if (rawText[i] !== ':') return;
        i += 1;
        skipValue();
        skipWs();
        if (rawText[i] === ',') i += 1;
      }
    };

    skipWs();
    if (rawText[i] !== '{') return [];
    i += 1;
    while (i < len) {
      skipWs();
      if (rawText[i] === '}') break;
      const topKey = readString();
      if (topKey === null) break;
      skipWs();
      if (rawText[i] !== ':') break;
      i += 1;
      if (topKey === 'mcpServers' || topKey === 'servers') {
        scanServersObject();
      } else {
        skipValue();
      }
      skipWs();
      if (rawText[i] === ',') i += 1;
    }
  } catch {
    // ignore scanner failures; JSON.parse handles syntax reporting
  }
  return Array.from(duplicates);
}

const ENV_VAR_GLOBAL_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

function extractSafeEnvPlaceholderTokens(value: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  ENV_VAR_GLOBAL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENV_VAR_GLOBAL_RE.exec(value)) !== null) {
    const rawName = (match[1] ?? match[2] ?? '').slice(0, 48);
    if (!rawName) continue;
    const token = containsSecretPattern(rawName) ? '${<redacted-var>}' : `\${${rawName}}`;
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
    if (out.length >= 6) break;
  }
  return out;
}

function sanitizeCrossClientFinding(finding: CrossClientFinding): CrossClientFinding {
  return {
    severity: finding.severity,
    code: finding.code,
    client: finding.client,
    file: redactSecretsInMessage(finding.file),
    message: redactSecretsInMessage(finding.message),
    ...(finding.suggestion ? { suggestion: redactSecretsInMessage(finding.suggestion) } : {}),
  };
}

function isSensitiveCrossClientFile(relPath: string): boolean {
  if (isSensitiveOpsPath(relPath)) return true;
  const base = path.posix.basename(relPath.replace(/\\/g, '/')).toLowerCase();
  return (
    base === 'auth.json' ||
    base === 'oauth.json' ||
    base === 'token.json' ||
    base === 'tokens.json' ||
    base === 'history.jsonl'
  );
}

interface McpConfigInspectionResult {
  serverCount: number;
  serverNames: string[];
  envKeyCount: number;
  activeExternalServers: number;
  estimatedExternalTools: number;
  findings: McpHealthFinding[];
  crossClientFindings: CrossClientFinding[];
}

function inspectMcpConfigSafe(
  rawText: string,
  relPath: string,
  realFilePath: string,
  realRoot: string,
  seenServerFiles: Map<string, string>,
): McpConfigInspectionResult {
  const findings: McpHealthFinding[] = [];
  const crossClientFindings: CrossClientFinding[] = [];
  const pushFinding = (finding: McpHealthFinding): void => {
    findings.push({
      severity: finding.severity,
      ...(finding.serverName !== undefined
        ? { serverName: sanitizeMcpIdentifier(finding.serverName) }
        : {}),
      file: redactSecretsInMessage(finding.file),
      message: redactSecretsInMessage(finding.message),
    });
  };
  const pushCrossClientFinding = (finding: CrossClientFinding): void => {
    crossClientFindings.push(sanitizeCrossClientFinding(finding));
  };

  let parsed: Record<string, unknown>;
  try {
    const rawParsed = JSON.parse(rawText);
    if (!rawParsed || typeof rawParsed !== 'object' || Array.isArray(rawParsed)) {
      pushFinding({
        severity: 'error',
        file: relPath,
        message: 'MCP configuration root must be a JSON object.',
      });
      return {
        serverCount: 0,
        serverNames: [],
        envKeyCount: 0,
        activeExternalServers: 0,
        estimatedExternalTools: 0,
        findings,
        crossClientFindings,
      };
    }
    parsed = rawParsed as Record<string, unknown>;
  } catch {
    pushFinding({
      severity: 'error',
      file: relPath,
      message: 'Invalid JSON syntax in MCP configuration file.',
    });
    return {
      serverCount: 0,
      serverNames: [],
      envKeyCount: 0,
      activeExternalServers: 0,
      estimatedExternalTools: 0,
      findings,
      crossClientFindings,
    };
  }

  for (const dupName of findDuplicateServerKeysInJson(rawText)) {
    const safeDupName = sanitizeMcpIdentifier(dupName);
    pushFinding({
      severity: 'warn',
      serverName: safeDupName,
      file: relPath,
      message: `Duplicate MCP server key "${safeDupName}" within the same configuration file.`,
    });
    pushCrossClientFinding({
      severity: 'warn',
      code: 'duplicate-plugin-or-server',
      client: 'shared',
      file: relPath,
      message: `Duplicate MCP server key "${safeDupName}" declared multiple times inside "${relPath}" (#1937).`,
      suggestion: 'Remove duplicate server keys so the host does not shadow or double-register MCP tools.',
    });
  }

  const serversObj =
    parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)
      ? (parsed.mcpServers as Record<string, unknown>)
      : parsed.servers && typeof parsed.servers === 'object' && !Array.isArray(parsed.servers)
        ? (parsed.servers as Record<string, unknown>)
        : null;

  if (!serversObj) {
    pushFinding({
      severity: 'warn',
      file: relPath,
      message: 'No "mcpServers" or "servers" object found in MCP configuration.',
    });
    return {
      serverCount: 0,
      serverNames: [],
      envKeyCount: 0,
      activeExternalServers: 0,
      estimatedExternalTools: 0,
      findings,
      crossClientFindings,
    };
  }

  const allKeys = Object.keys(serversObj);
  const serverNames = allKeys.slice(0, 30).map(sanitizeMcpIdentifier);
  const configDir = path.dirname(realFilePath);
  const isInsideWorkspace = (p: string): boolean => isPathInsideDir(realRoot, p);

  const checkLocalRelativeScript = (
    serverName: string,
    candidate: string,
    sourceLabel: 'command' | 'args',
  ): boolean => {
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.startsWith('-') || trimmed.includes('://') || trimmed.includes('=')) return false;
    if (UNRESOLVED_PLACEHOLDER_RE.test(trimmed) || ENV_VAR_EMBED_RE.test(trimmed)) return false;
    if (path.isAbsolute(trimmed) || WINDOWS_ABS_PATH_RE.test(trimmed)) return false;

    const posixCandidate = trimmed.replace(/\\/g, '/');
    const fromConfigDir = path.resolve(configDir, posixCandidate);
    const fromWorkspaceRoot = path.resolve(realRoot, posixCandidate);
    const configInside = isInsideWorkspace(fromConfigDir);
    const rootInside = isInsideWorkspace(fromWorkspaceRoot);

    if (!configInside && !rootInside) {
      pushFinding({
        severity: 'error',
        serverName,
        file: relPath,
        message: `Relative script in ${sourceLabel} escapes workspace boundary (${sanitizeDisplayPath(trimmed)}).`,
      });
      return true;
    }

    const existsSafe = (absPath: string): boolean => {
      if (!isInsideWorkspace(absPath)) return false;
      try {
        if (!fs.existsSync(absPath)) return false;
        const real = canonicalRealpathSync(absPath);
        return isInsideWorkspace(real);
      } catch {
        return false;
      }
    };

    if (!existsSafe(fromConfigDir) && !existsSafe(fromWorkspaceRoot)) {
      pushFinding({
        severity: 'error',
        serverName,
        file: relPath,
        message: `Local script referenced in ${sourceLabel} does not exist: ${sanitizeDisplayPath(trimmed)}`,
      });
      return true;
    }
    return false;
  };

  let envKeyCount = 0;
  let activeExternalServers = 0;
  let estimatedExternalTools = 0;

  for (const serverName of allKeys) {
    const safeServerName = sanitizeMcpIdentifier(serverName);
    if (containsSecretPattern(serverName)) {
      pushFinding({
        severity: 'warn',
        serverName: safeServerName,
        file: relPath,
        message: `MCP server name contains a hardcoded secret-like token (<redacted-path>).`,
      });
    }
    const prevFile = seenServerFiles.get(serverName);
    const isDuplicateAcrossFiles = prevFile !== undefined && prevFile !== relPath;
    if (isDuplicateAcrossFiles) {
      pushFinding({
        severity: 'warn',
        serverName: safeServerName,
        file: relPath,
        message: `Duplicate MCP server "${safeServerName}" (already defined in ${prevFile}).`,
      });
      pushCrossClientFinding({
        severity: 'warn',
        code: 'duplicate-plugin-or-server',
        client: 'shared',
        file: relPath,
        message: `Duplicate MCP server "${safeServerName}" declared in both "${prevFile}" and "${relPath}" (#1937).`,
        suggestion: 'Consolidate shared MCP servers into a single workspace config or disable duplicates in secondary client configs.',
      });
    } else if (!prevFile) {
      seenServerFiles.set(serverName, relPath);
    }

    const rawDef = serversObj[serverName];
    if (!rawDef || typeof rawDef !== 'object' || Array.isArray(rawDef)) {
      pushFinding({
        severity: 'error',
        serverName: safeServerName,
        file: relPath,
        message: `Server "${safeServerName}" definition must be a JSON object.`,
      });
      continue;
    }

    const def = rawDef as Record<string, unknown>;
    const envPlaceholderRefs: string[] = [];
    const recordEnvPlaceholder = (fieldLabel: string, rawVal: string): void => {
      const tokens = extractSafeEnvPlaceholderTokens(rawVal);
      if (tokens.length > 0) {
        envPlaceholderRefs.push(`${fieldLabel} (${tokens.join(', ')})`);
      }
    };

    const disabled = def.disabled === true || def.enabled === false;
    if (!disabled && !isDuplicateAcrossFiles) {
      activeExternalServers += 1;
      if (Array.isArray(def.tools)) {
        estimatedExternalTools += def.tools.length;
      } else {
        estimatedExternalTools += DEFAULT_TOOLS_PER_EXTERNAL_MCP_SERVER;
      }
    }

    const command = typeof def.command === 'string' ? def.command.trim() : '';
    const urlCandidate =
      typeof def.url === 'string'
        ? def.url.trim()
        : typeof def.serverUrl === 'string'
          ? def.serverUrl.trim()
          : typeof def.httpUrl === 'string'
            ? def.httpUrl.trim()
            : '';

    if (!command && !urlCandidate) {
      pushFinding({
        severity: 'error',
        serverName: safeServerName,
        file: relPath,
        message: `Server "${safeServerName}" is missing required "command" or "url" transport field.`,
      });
    }

    const cmdBase = normalizeRuntimeCommandBase(command);
    const isLocalRuntime = LOCAL_RUNTIME_COMMANDS.has(cmdBase);

    if (command) {
      recordEnvPlaceholder('command', command);
      const isWinAbsCommand = WINDOWS_ABS_PATH_RE.test(command);
      const hasPathSep = command.includes('/') || command.includes('\\');
      const isBareKnownCli = !hasPathSep && KNOWN_PATH_CLI_COMMANDS.has(cmdBase);
      if (UNRESOLVED_PLACEHOLDER_RE.test(command) || ENV_VAR_EMBED_RE.test(command)) {
        pushFinding({
          severity: 'warn',
          serverName: safeServerName,
          file: relPath,
          message: `Server "${safeServerName}" contains an unresolved placeholder in "command" (value redacted).`,
        });
      } else if (
        command.startsWith('./') ||
        command.startsWith('../') ||
        command.startsWith('.\\') ||
        command.startsWith('..\\') ||
        (!path.isAbsolute(command) &&
          !isWinAbsCommand &&
          !command.startsWith('@') &&
          !isBareKnownCli &&
          (hasPathSep || SCRIPT_EXT_RE.test(command)))
      ) {
        const reported = checkLocalRelativeScript(safeServerName, command, 'command');
        if (!reported && containsSecretPattern(command)) {
          pushFinding({
            severity: 'warn',
            serverName: safeServerName,
            file: relPath,
            message: `Server "${safeServerName}" contains a hardcoded secret-like value in "command" (<redacted-path>).`,
          });
        }
      } else if (containsSecretPattern(command)) {
        pushFinding({
          severity: 'warn',
          serverName: safeServerName,
          file: relPath,
          message: `Server "${safeServerName}" contains a hardcoded secret-like value in "command" (<redacted-path>).`,
        });
      }
    }

    if (urlCandidate) {
      recordEnvPlaceholder('url', urlCandidate);
      if (UNRESOLVED_PLACEHOLDER_RE.test(urlCandidate) || ENV_VAR_EMBED_RE.test(urlCandidate)) {
        pushFinding({
          severity: 'warn',
          serverName: safeServerName,
          file: relPath,
          message: `Server "${safeServerName}" contains an unresolved placeholder in "url" (value redacted).`,
        });
      } else if (containsSecretPattern(urlCandidate)) {
        pushFinding({
          severity: 'warn',
          serverName: safeServerName,
          file: relPath,
          message: `Server "${safeServerName}" contains a hardcoded secret-like token in "url" (<redacted-path>).`,
        });
      }
    }

    if (Array.isArray(def.args)) {
      let warnedArgPlaceholder = false;
      for (let argIdx = 0; argIdx < def.args.length; argIdx += 1) {
        const rawArg = def.args[argIdx];
        if (typeof rawArg !== 'string') continue;
        const arg = rawArg.trim();
        if (!arg) continue;
        recordEnvPlaceholder(`args[${argIdx}]`, arg);
        if (UNRESOLVED_PLACEHOLDER_RE.test(arg)) {
          if (!warnedArgPlaceholder) {
            warnedArgPlaceholder = true;
            pushFinding({
              severity: 'warn',
              serverName: safeServerName,
              file: relPath,
              message: `Server "${safeServerName}" contains an unresolved placeholder in "args" (value redacted).`,
            });
          }
          continue;
        }
        const explicitRelative =
          arg.startsWith('./') ||
          arg.startsWith('../') ||
          arg.startsWith('.\\') ||
          arg.startsWith('..\\');
        const isWinAbsArg = WINDOWS_ABS_PATH_RE.test(arg);
        const runtimeScriptCandidate =
          isLocalRuntime &&
          !arg.startsWith('-') &&
          !arg.startsWith('@') &&
          !arg.includes('://') &&
          !arg.includes('=') &&
          !path.isAbsolute(arg) &&
          !isWinAbsArg &&
          (arg.includes('/') || arg.includes('\\') || SCRIPT_EXT_RE.test(arg));
        if (explicitRelative || runtimeScriptCandidate) {
          const reported = checkLocalRelativeScript(safeServerName, arg, 'args');
          if (!reported && containsSecretPattern(arg)) {
            pushFinding({
              severity: 'warn',
              serverName: safeServerName,
              file: relPath,
              message: `Server "${safeServerName}" contains a hardcoded secret-like argument in "args" (<redacted-path>).`,
            });
          }
        } else if (containsSecretPattern(arg)) {
          pushFinding({
            severity: 'warn',
            serverName: safeServerName,
            file: relPath,
            message: `Server "${safeServerName}" contains a hardcoded secret-like argument in "args" (<redacted-path>).`,
          });
        }
      }
    }

    const inspectKeyValueMap = (mapObj: unknown, containerName: 'env' | 'headers', countLiterals: boolean) => {
      if (!mapObj || typeof mapObj !== 'object' || Array.isArray(mapObj)) return;
      for (const [k, v] of Object.entries(mapObj as Record<string, unknown>)) {
        if (typeof v !== 'string') continue;
        const val = v.trim();
        if (!val) continue;
        const cleanedKey = k.replace(/[^\w.-]/g, '').slice(0, 64) || 'key';
        const safeKey = sanitizeMcpIdentifier(cleanedKey);

        recordEnvPlaceholder(`${containerName}.${safeKey}`, val);

        if (UNRESOLVED_PLACEHOLDER_RE.test(val)) {
          pushFinding({
            severity: 'warn',
            serverName: safeServerName,
            file: relPath,
            message: `Server "${safeServerName}" has an unresolved placeholder in ${containerName}.${safeKey} (value redacted).`,
          });
          continue;
        }

        const isEnvRef = PURE_ENV_REF_RE.test(val);
        if (!isEnvRef) {
          if (countLiterals) {
            envKeyCount += 1;
          }
          if (OAUTH_OR_EXPIRING_KEY_RE.test(k) || JWT_LIKE_RE.test(val)) {
            pushFinding({
              severity: 'warn',
              serverName: safeServerName,
              file: relPath,
              message: `Server "${safeServerName}" has a static OAuth/token value in ${containerName}.${safeKey} (value redacted) that may expire or leak.`,
            });
          } else if (SENSITIVE_KEY_NAME_RE.test(k) || containsSecretPattern(val)) {
            pushFinding({
              severity: 'warn',
              serverName: safeServerName,
              file: relPath,
              message: `Server "${safeServerName}" hardcodes a literal secret in ${containerName}.${safeKey} (value redacted); use an env var placeholder instead.`,
            });
          }
        }
      }
    };

    inspectKeyValueMap(def.env, 'env', true);
    inspectKeyValueMap(def.headers, 'headers', false);

    if (envPlaceholderRefs.length > 0) {
      const preview = envPlaceholderRefs.slice(0, 6).join(', ');
      const suffix = envPlaceholderRefs.length > 6 ? `, +${envPlaceholderRefs.length - 6} more` : '';
      pushCrossClientFinding({
        severity: 'warn',
        code: 'mcp-unexpanded-env',
        client: 'antigravity',
        file: relPath,
        message: `Server "${safeServerName}" references static env placeholder(s) (${preview}${suffix}). Antigravity 2.0 static MCP configs may not auto-expand \${ENV_VAR} across all transports (#233).`,
        suggestion:
          'Verify host-level environment injection or use OS keychain / a thin local wrapper script instead of relying on static ${ENV_VAR} expansion in MCP JSON.',
      });
    }

    // Check top-level OAuth / token expiry hints (strictly redacted)
    const expiryRaw = def.expiresAt ?? def.tokenExpiry ?? def.expires_at;
    if (typeof expiryRaw === 'string' || typeof expiryRaw === 'number') {
      const ts = typeof expiryRaw === 'number' ? expiryRaw : Date.parse(expiryRaw);
      const expired = Number.isFinite(ts) && ts < Date.now();
      pushFinding({
        severity: expired ? 'error' : 'warn',
        serverName: safeServerName,
        file: relPath,
        message: expired
          ? `Server "${safeServerName}" contains an expired static OAuth/token expiry field (value redacted).`
          : `Server "${safeServerName}" defines a static OAuth/token expiry field (value redacted); verify auto-refresh is enabled.`,
      });
    } else if (
      (typeof def.accessToken === 'string' && def.accessToken.trim() && !PURE_ENV_REF_RE.test(def.accessToken.trim())) ||
      (typeof def.refreshToken === 'string' && def.refreshToken.trim() && !PURE_ENV_REF_RE.test(def.refreshToken.trim())) ||
      (def.oauth && typeof def.oauth === 'object')
    ) {
      pushFinding({
        severity: 'warn',
        serverName: safeServerName,
        file: relPath,
        message: `Server "${safeServerName}" contains static OAuth/token configuration (values redacted); ensure credentials are not committed and refresh cleanly.`,
      });
    }
  }

  return {
    serverCount: allKeys.length,
    serverNames,
    envKeyCount,
    activeExternalServers,
    estimatedExternalTools,
    findings,
    crossClientFindings,
  };
}

function measureDirReadOnly(
  targetDir: string,
  allowedRootReal: string,
  maxDepth = 5,
): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  const visited = new Set<string>();

  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let realDir: string;
    try {
      realDir = canonicalRealpathSync(dir);
    } catch {
      return;
    }
    if (!isPathInsideDir(allowedRootReal, realDir)) return;
    if (visited.has(realDir)) return;
    visited.add(realDir);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(realDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(realDir, entry.name);
      try {
        const lstat = fs.lstatSync(full);
        if (lstat.isSymbolicLink()) {
          // Never follow symlinks when auditing storage
          continue;
        }
        if (lstat.isDirectory()) {
          walk(full, depth + 1);
        } else if (lstat.isFile()) {
          bytes += lstat.size;
          files += 1;
        }
      } catch {
        // ignore inaccessible entry
      }
    }
  };

  walk(targetDir, 0);
  return { bytes, files };
}

function auditStorageReadOnly(rootDataDir: string | undefined): StorageAuditSummary {
  if (!rootDataDir || !fs.existsSync(rootDataDir)) {
    return {
      rootDataDirExists: false,
      totalBytes: 0,
      totalFiles: 0,
      modules: [],
    };
  }

  let realDataRoot: string;
  try {
    realDataRoot = canonicalRealpathSync(path.resolve(rootDataDir));
  } catch {
    return {
      rootDataDirExists: false,
      totalBytes: 0,
      totalFiles: 0,
      modules: [],
    };
  }

  const modulesDir = path.join(realDataRoot, 'modules');
  const modules: ModuleStorageStat[] = [];
  const seenModuleDirs = new Set<string>();

  if (fs.existsSync(modulesDir)) {
    try {
      const entries = fs.readdirSync(modulesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        seenModuleDirs.add(entry.name);
        const stat = measureDirReadOnly(path.join(modulesDir, entry.name), realDataRoot, 5);
        modules.push({
          moduleId: entry.name,
          bytes: stat.bytes,
          files: stat.files,
        });
      }
    } catch {
      // ignore
    }
  }

  for (const id of MODULE_IDS) {
    if (!seenModuleDirs.has(id)) {
      modules.push({ moduleId: id, bytes: 0, files: 0 });
    }
  }

  modules.sort((a, b) => b.bytes - a.bytes || a.moduleId.localeCompare(b.moduleId));

  const rootTotal = measureDirReadOnly(realDataRoot, realDataRoot, 6);
  return {
    rootDataDirExists: true,
    totalBytes: rootTotal.bytes,
    totalFiles: rootTotal.files,
    modules,
  };
}

function isRuleBloatTarget(asset: WorkspaceAssetEntry): boolean {
  if (asset.kind === 'rules') return true;
  const lower = asset.relPath.toLowerCase();
  if (
    (lower.startsWith('.agents/rules/') || lower.startsWith('.gemini/')) &&
    (lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.txt'))
  ) {
    return true;
  }
  return false;
}

function resolveEnabledNovTools(
  rootDataDir: string | undefined,
  optsOrCount?: number | AuditWorkspaceOptions,
): number {
  const explicit =
    typeof optsOrCount === 'number' ? optsOrCount : optsOrCount?.enabledNovTools;
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit >= 0) {
    return Math.floor(explicit);
  }
  if (rootDataDir) {
    try {
      const cfg = loadNovConfigReadOnly(rootDataDir);
      return countEnabledModelTools(cfg.modules);
    } catch {
      // fall through to default config count
    }
  }
  return countEnabledModelTools(createDefaultConfig().modules);
}

const SECURITY_DEDUCTION: Record<OpsSecuritySeverity, number> = {
  high: 25,
  medium: 10,
  low: 4,
};

export function calculateSecurityScore(findings: readonly OpsSecurityFinding[]): number {
  let deduction = 0;
  for (const f of findings) {
    deduction += SECURITY_DEDUCTION[f.severity] ?? 0;
  }
  return Math.max(0, 100 - deduction);
}

export function summarizeMigrationPreview(entries: readonly OpsMigrationEntry[]): OpsMigrationPreview {
  let totalBytes = 0;
  let reclaimableBytes = 0;
  for (const entry of entries) {
    totalBytes += entry.bytes;
    if (entry.action !== 'keep-pointer' && entry.duplicatePercent > 0) {
      const entryReclaim = Math.min(
        entry.bytes,
        Math.round((entry.bytes * entry.duplicatePercent) / 100),
      );
      reclaimableBytes += entryReclaim;
    }
  }
  const estimatedSavingsPercent =
    totalBytes > 0 ? Math.min(100, Math.round((reclaimableBytes / totalBytes) * 100)) : 0;
  return {
    readOnlyPreview: true,
    totalFiles: entries.length,
    totalBytes,
    reclaimableBytes,
    estimatedSavingsPercent,
    estimatedSavedTokens: Math.ceil(reclaimableBytes / 4),
    entries: [...entries],
  };
}

function sanitizeSecurityFinding(finding: OpsSecurityFinding): OpsSecurityFinding {
  return {
    id: finding.id,
    severity: finding.severity,
    category: finding.category,
    file: redactSecretsInMessage(finding.file),
    title: redactSecretsInMessage(finding.title),
    summary: redactSecretsInMessage(finding.summary),
    remediation: redactSecretsInMessage(finding.remediation),
  };
}

function makeFindingSlug(relPath: string, suffix: string): string {
  const hash = crypto.createHash('sha256').update(`${relPath}:${suffix}`).digest('hex').slice(0, 8);
  return `${suffix}-${hash}`;
}

type StrictReadResult =
  | { ok: true; relPath: string; realPath: string; bytes: number; text: string }
  | { ok: false; reason: 'missing' | 'symlink' | 'sensitive' | 'not-file' | 'oversized' | 'binary' | 'error' };

function readFileStrictNoSymlink(
  realRoot: string,
  relPosix: string,
  maxBytes: number,
): StrictReadResult {
  const normalizedRel = relPosix.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedRel) return { ok: false, reason: 'missing' };
  if (isSensitiveCrossClientFile(normalizedRel)) {
    return { ok: false, reason: 'sensitive' };
  }

  const segments = normalizedRel.split('/').filter(Boolean);
  let cur = realRoot;
  let finalLstat: fs.Stats | null = null;
  for (const seg of segments) {
    if (seg === '.' || seg === '..') return { ok: false, reason: 'symlink' };
    cur = path.join(cur, seg);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(cur);
    } catch {
      return { ok: false, reason: 'missing' };
    }
    if (st.isSymbolicLink()) {
      return { ok: false, reason: 'symlink' };
    }
    finalLstat = st;
  }

  if (!finalLstat || !finalLstat.isFile()) {
    return { ok: false, reason: 'not-file' };
  }

  let realTarget: string;
  try {
    realTarget = canonicalRealpathSync(cur);
  } catch {
    return { ok: false, reason: 'error' };
  }
  if (!isPathInsideDir(realRoot, realTarget)) {
    return { ok: false, reason: 'symlink' };
  }

  const realRel = path.relative(realRoot, realTarget).replace(/\\/g, '/');
  if (isSensitiveCrossClientFile(realRel)) {
    return { ok: false, reason: 'sensitive' };
  }

  if (finalLstat.size > maxBytes) {
    return { ok: false, reason: 'oversized' };
  }

  try {
    const buf = fs.readFileSync(realTarget);
    if (buf.length > maxBytes) {
      return { ok: false, reason: 'oversized' };
    }
    const inspectLen = Math.min(buf.length, 4096);
    for (let i = 0; i < inspectLen; i += 1) {
      if (buf[i] === 0) return { ok: false, reason: 'binary' };
    }
    return {
      ok: true,
      relPath: normalizedRel,
      realPath: realTarget,
      bytes: buf.length,
      text: buf.toString('utf8'),
    };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

function listFilesStrictNoSymlink(
  realRoot: string,
  relBaseDir: string,
  maxDepth: number,
  maxEntries: number,
  predicate: (relPosix: string, entryName: string) => boolean,
): string[] {
  const normalizedBase = relBaseDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalizedBase) return [];

  const segments = normalizedBase.split('/').filter(Boolean);
  let cur = realRoot;
  let baseStat: fs.Stats | null = null;
  for (const seg of segments) {
    if (seg === '.' || seg === '..') return [];
    cur = path.join(cur, seg);
    try {
      const st = fs.lstatSync(cur);
      if (st.isSymbolicLink()) return [];
      baseStat = st;
    } catch {
      return [];
    }
  }
  if (!baseStat || !baseStat.isDirectory()) return [];

  let realBase: string;
  try {
    realBase = canonicalRealpathSync(cur);
  } catch {
    return [];
  }
  if (!isPathInsideDir(realRoot, realBase)) return [];

  const results: string[] = [];
  const visited = new Set<string>();

  const walk = (dirAbs: string, relDir: string, depth: number): void => {
    if (depth > maxDepth || results.length >= maxEntries) return;
    if (visited.has(dirAbs)) return;
    visited.add(dirAbs);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (results.length >= maxEntries) break;
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dirAbs, entry.name);
      const rel = `${relDir}/${entry.name}`;
      if (isSensitiveCrossClientFile(rel)) continue;

      let lstat: fs.Stats;
      try {
        lstat = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (lstat.isSymbolicLink()) {
        // Strictly reject symlinks in static security & dedup scans
        continue;
      }
      if (lstat.isDirectory()) {
        walk(full, rel, depth + 1);
      } else if (lstat.isFile() && predicate(rel, entry.name)) {
        results.push(rel);
      }
    }
  };

  walk(realBase, normalizedBase, 0);
  return results;
}

const PI_OVERRIDE_RE =
  /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:previous|prior|above|system)\s+(?:instructions?|rules?|prompts?|policies?)\b/i;
const PI_JAILBREAK_RE =
  /\byou\s+are\s+now\s+(?:in\s+)?(?:developer|unrestricted|jailbreak)\s+mode\b/i;
const PI_EXFIL_SECRET_RE =
  /\b(?:exfiltrate|steal|leak|dump|upload|post|send|transmit)\b[^\r\n]{0,100}\b(?:secret|secrets|token|tokens|api[_ -]?key|keys|credential|credentials|\.env|id_rsa|ssh|password|passwd)\b/i;
const PI_EXFIL_NET_RE =
  /\b(?:curl|wget|fetch|nc|netcat)\b[^\r\n]{0,120}(?:https?:\/\/|\$\(|\.(?:env|ssh)|id_rsa|secret|token|password|api[_ -]?key)/i;
const PI_EXFIL_URL_SEND_RE =
  /\b(?:send|post|upload|exfiltrate)\b[^\r\n]{0,100}https?:\/\//i;

const BROAD_ALLOW_KEYS = new Set([
  'allow',
  'allowedtools',
  'allowed_tools',
  'autoapprove',
  'auto_approve',
  'alwaysallow',
  'always_allow',
  'allowedcommands',
  'allowed_commands',
  'approvecommands',
  'approvedtools',
]);

const BROAD_WILDCARD_VALUE_RE = /^(?:\*{1,2}|(?:bash|shell|exec|terminal|run_command|command)\(\*\))$/i;
const DANGEROUS_SKIP_PERM_RE = /--dangerously-skip-permissions\b/i;
const DANGEROUS_YOLO_RE = /(?:^|[\s`"'])--yolo(?=$|[\s`"'])/i;
const DANGEROUS_CHMOD_777_RE = /\bchmod\s+(?:-R\s+)?(?:0?777|a\+rwx)\b/i;
const NEGATION_CONTEXT_RE =
  /\b(?:never|do not|don't|avoid|forbid|forbidden|prohibit|prohibited|block|blocked|deny|denied|reject|rejected|ban|banned|disallow|disallowed)\b|严禁|禁止|不要|不得/i;

const HOOK_PIPE_SHELL_RE =
  /\b(?:curl|wget)\b[^|\r\n]{0,240}\|\s*(?:sudo\s+)?(?:\/(?:usr\/)?bin\/)?(?:sh|bash|zsh|dash|ksh|python3?|node)\b/i;
const HOOK_RM_RF_ROOT_RE =
  /\brm\s+(?:-[a-zA-Z]*[rf][a-zA-Z]*\s+){1,2}(?:--no-preserve-root\s+)?(?:\/(?:\s|$|\*|[;&|])|~\/?(?:\s|$|[;&|])|\$HOME\/?(?:\s|$|[;&|]))/i;
const HOOK_EVAL_RE =
  /(?:^|[;&|]\s*|\b(?:sh|bash|zsh)\s+-c\s+["']?)\beval(?:\s+["'$A-Za-z0-9_(]|\s*$)/i;

const SAFE_LITERAL_ENV_VALUES_RE =
  /^(?:true|false|yes|no|on|off|0|1|none|null|empty|disabled|enabled|readonly|dev|prod|staging|local|test)$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUTH_SCHEME_ONLY_RE = /^(?:Bearer|Basic|Token|ApiKey|Digest)$/i;

function computeShannonEntropy(input: string): number {
  if (!input) return 0;
  const freq = new Map<string, number>();
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  const len = input.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isHighEntropySecretLiteral(val: string): boolean {
  if (val.length < 24 || val.length > 512) return false;
  if (/\s/.test(val)) return false;
  if (val.includes('${') || val.includes('{{')) return false;
  if (/^https?:\/\//i.test(val)) return false;
  if (val.includes('/') || val.includes('\\')) return false;
  if (UUID_RE.test(val)) return false;
  const hasLower = /[a-z]/.test(val);
  const hasUpper = /[A-Z]/.test(val);
  const hasDigit = /[0-9]/.test(val);
  if (!(hasLower && hasUpper && hasDigit)) return false;
  return computeShannonEntropy(val) >= 4.0;
}

function isLoopbackHost(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (host.endsWith('.localhost')) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

function extractSafeHttpHost(urlCandidate: string): string {
  try {
    const parsed = new URL(urlCandidate);
    return parsed.hostname;
  } catch {
    const withoutScheme = urlCandidate.replace(/^http:\/\//i, '');
    const authority = withoutScheme.split(/[/?#]/)[0] ?? '';
    const hostPort = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
    if (hostPort.startsWith('[')) {
      const endBracket = hostPort.indexOf(']');
      return endBracket > 0 ? hostPort.slice(0, endBracket + 1) : hostPort;
    }
    return hostPort.split(':')[0] ?? '';
  }
}

function scanPromptInjection(
  relPath: string,
  text: string,
  push: (finding: OpsSecurityFinding) => void,
): void {
  // 1. O(n) single-pass scan for covert BiDi overrides & zero-width steganography runs
  let bidiCount = 0;
  let zwRun = 0;
  let maxZwRun = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) {
      bidiCount += 1;
    }
    if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff) {
      zwRun += 1;
      if (zwRun > maxZwRun) maxZwRun = zwRun;
    } else {
      zwRun = 0;
    }
  }

  if (bidiCount > 0) {
    push({
      id: makeFindingSlug(relPath, 'pi-bidi'),
      severity: 'high',
      category: 'prompt-injection',
      file: relPath,
      title: 'Covert BiDi directional control characters detected',
      summary: `Found ${bidiCount} Unicode BiDi control character(s) (U+202A–U+202E / U+2066–U+2069) that can disguise hidden prompt instructions.`,
      remediation:
        'Remove all hidden Unicode BiDi override characters from rule and skill markdown files and inspect surrounding lines in plain hex/ASCII view.',
    });
  }

  if (maxZwRun >= 4) {
    push({
      id: makeFindingSlug(relPath, 'pi-zw'),
      severity: 'high',
      category: 'prompt-injection',
      file: relPath,
      title: 'Zero-width steganographic character sequence detected',
      summary: `Found a contiguous run of ${maxZwRun} zero-width characters (U+200B–U+200D / U+FEFF), commonly used for invisible prompt smuggling.`,
      remediation:
        'Strip contiguous zero-width characters from the instruction file and re-verify diff history for unauthorized edits.',
    });
  }

  // 2. Instruction override paired with concrete exfiltration/network sink (zero false positives on security docs)
  const hasOverride = PI_OVERRIDE_RE.test(text) || PI_JAILBREAK_RE.test(text);
  const hasExfil =
    PI_EXFIL_SECRET_RE.test(text) || PI_EXFIL_NET_RE.test(text) || PI_EXFIL_URL_SEND_RE.test(text);
  if (hasOverride && hasExfil) {
    push({
      id: makeFindingSlug(relPath, 'pi-override-exfil'),
      severity: 'high',
      category: 'prompt-injection',
      file: relPath,
      title: 'Prompt override combined with secret exfiltration pattern',
      summary:
        'Instruction file combines system/previous-instruction override phrasing with secret exfiltration or outbound network commands.',
      remediation:
        'Remove untrusted override directives and outbound secret-handling instructions from workspace rule or skill files.',
    });
  }
}

function scanJsonBroadCommandAllow(
  relPath: string,
  text: string,
  push: (finding: OpsSecurityFinding) => void,
): void {
  const reportedSubtypes = new Set<string>();
  const reportOnce = (subtype: string, title: string, summary: string, remediation: string) => {
    if (reportedSubtypes.has(subtype)) return;
    reportedSubtypes.add(subtype);
    push({
      id: makeFindingSlug(relPath, `broad-${subtype}`),
      severity: 'high',
      category: 'broad-command-allow',
      file: relPath,
      title,
      summary,
      remediation,
    });
  };

  const inspectStringForFlags = (str: string) => {
    if (DANGEROUS_SKIP_PERM_RE.test(str)) {
      reportOnce(
        'skip-permissions',
        'Unrestricted permission bypass flag (--dangerously-skip-permissions)',
        'Configuration enables --dangerously-skip-permissions, disabling host confirmation gates.',
        'Remove --dangerously-skip-permissions and rely on explicit allowlists or Guard permission modes.',
      );
    }
    if (DANGEROUS_YOLO_RE.test(str)) {
      reportOnce(
        'yolo-flag',
        'Unrestricted auto-approval flag (--yolo)',
        'Configuration enables --yolo auto-execution without safety prompts.',
        'Remove --yolo and scope permitted commands explicitly.',
      );
    }
    if (DANGEROUS_CHMOD_777_RE.test(str)) {
      reportOnce(
        'chmod-777',
        'World-writable permission command (chmod 777)',
        'Configuration invokes chmod 777 / a+rwx, granting unrestricted read/write/execute permissions.',
        'Replace chmod 777 with least-privilege permissions (for example 0600 for secrets or 0755 for executables).',
      );
    }
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (/"(?:allow|allowedTools|allowed_tools|autoApprove|alwaysAllow)"\s*:\s*\[\s*"\*"\s*\]/i.test(text)) {
      reportOnce(
        'wildcard-allow',
        'Wildcard command/tool allowlist ("*") detected',
        'Configuration grants wildcard "*" allowlist access to all commands or tools.',
        'Replace wildcard "*" allowlists with an explicit, minimal list of safe read-only tools or commands.',
      );
    }
    inspectStringForFlags(text);
    return;
  }

  const walk = (node: unknown, depth: number): void => {
    if (depth > 12 || node === null || node === undefined) return;
    if (typeof node === 'string') {
      inspectStringForFlags(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        const lowerKey = key.toLowerCase();
        if (BROAD_ALLOW_KEYS.has(lowerKey)) {
          const checkWildcard = (candidate: unknown): boolean =>
            typeof candidate === 'string' && BROAD_WILDCARD_VALUE_RE.test(candidate.trim());
          if (checkWildcard(val) || (Array.isArray(val) && val.some(checkWildcard))) {
            reportOnce(
              'wildcard-allow',
              `Wildcard permission allowlist in "${key}"`,
              `Configuration sets "${key}" to a wildcard ("*"), permitting unrestricted tool or shell execution.`,
              `Replace wildcard entries in "${key}" with explicit, least-privilege tool or command names.`,
            );
          }
        } else if (
          (lowerKey === 'defaultmode' || lowerKey === 'permissionmode') &&
          typeof val === 'string' &&
          /^(?:bypasspermissions|dangerously-skip-permissions|yolo)$/i.test(val.trim())
        ) {
          reportOnce(
            'bypass-mode',
            `Unrestricted permission mode ("${val.trim()}")`,
            `Configuration sets "${key}" to an unrestricted bypass mode.`,
            'Use a guarded permission mode such as balanced-dev or strict-gate.',
          );
        }
        walk(val, depth + 1);
      }
    }
  };

  walk(parsed, 0);
}

function scanTextBroadCommandAllow(
  relPath: string,
  text: string,
  push: (finding: OpsSecurityFinding) => void,
): void {
  const reportedSubtypes = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line || NEGATION_CONTEXT_RE.test(line)) continue;
    if (!reportedSubtypes.has('skip-permissions') && DANGEROUS_SKIP_PERM_RE.test(line)) {
      reportedSubtypes.add('skip-permissions');
      push({
        id: makeFindingSlug(relPath, 'broad-text-skip-permissions'),
        severity: 'high',
        category: 'broad-command-allow',
        file: relPath,
        title: 'Rule/skill recommends --dangerously-skip-permissions',
        summary:
          'Instruction text directs the agent to pass --dangerously-skip-permissions without safety constraints.',
        remediation:
          'Remove --dangerously-skip-permissions directives from workspace rules and skills.',
      });
    }
    if (!reportedSubtypes.has('yolo-flag') && DANGEROUS_YOLO_RE.test(line)) {
      reportedSubtypes.add('yolo-flag');
      push({
        id: makeFindingSlug(relPath, 'broad-text-yolo'),
        severity: 'high',
        category: 'broad-command-allow',
        file: relPath,
        title: 'Rule/skill recommends --yolo auto-execution',
        summary: 'Instruction text directs the agent to run commands with --yolo unrestricted approval.',
        remediation: 'Remove --yolo directives and require explicit user approval for destructive commands.',
      });
    }
    if (!reportedSubtypes.has('chmod-777') && DANGEROUS_CHMOD_777_RE.test(line)) {
      reportedSubtypes.add('chmod-777');
      push({
        id: makeFindingSlug(relPath, 'broad-text-chmod-777'),
        severity: 'high',
        category: 'broad-command-allow',
        file: relPath,
        title: 'Rule/skill recommends world-writable chmod 777',
        summary: 'Instruction text includes chmod 777 / a+rwx, exposing workspace files to world-writable access.',
        remediation: 'Replace chmod 777 with minimal file permissions (0600 / 0644 / 0755).',
      });
    }
  }
}

function scanRiskyHooks(
  relPath: string,
  text: string,
  push: (finding: OpsSecurityFinding) => void,
): void {
  const commands: string[] = [];
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Fallback linear extraction when JSON syntax is malformed
    const cmdLineRe = /"(?:command|cmd|script)"\s*:\s*"([^"\r\n]{1,500})"/g;
    let m: RegExpExecArray | null;
    while ((m = cmdLineRe.exec(text)) !== null) {
      commands.push(m[1]);
      if (commands.length >= 64) break;
    }
  }

  if (parsed && typeof parsed === 'object') {
    const walk = (node: unknown, depth: number): void => {
      if (depth > 12 || !node || typeof node !== 'object' || commands.length >= 64) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      const obj = node as Record<string, unknown>;
      for (const field of ['command', 'cmd', 'script'] as const) {
        const rawCmd = obj[field];
        if (typeof rawCmd === 'string' && rawCmd.trim()) {
          const argList = Array.isArray(obj.args)
            ? obj.args.filter((a): a is string => typeof a === 'string').join(' ')
            : '';
          commands.push(argList ? `${rawCmd.trim()} ${argList}` : rawCmd.trim());
        }
      }
      for (const val of Object.values(obj)) {
        if (val && typeof val === 'object') walk(val, depth + 1);
      }
    };
    walk(parsed, 0);
  }

  const reported = new Set<string>();
  for (const cmd of commands) {
    if (!reported.has('pipe-sh') && HOOK_PIPE_SHELL_RE.test(cmd)) {
      reported.add('pipe-sh');
      push({
        id: makeFindingSlug(relPath, 'hook-pipe-sh'),
        severity: 'high',
        category: 'risky-hook',
        file: relPath,
        title: 'Hook pipes remote download directly into shell interpreter',
        summary:
          'Lifecycle hook command executes a remote script via curl/wget piped directly into a shell or runtime.',
        remediation:
          'Pin and verify scripts locally inside the repository with checksum verification instead of piping remote downloads into sh/bash.',
      });
    }
    if (!reported.has('rm-rf-root') && HOOK_RM_RF_ROOT_RE.test(cmd)) {
      reported.add('rm-rf-root');
      push({
        id: makeFindingSlug(relPath, 'hook-rm-rf-root'),
        severity: 'high',
        category: 'risky-hook',
        file: relPath,
        title: 'Hook executes destructive root/home deletion (rm -rf)',
        summary:
          'Lifecycle hook command contains a destructive recursive rm targeting /, /*, ~, or $HOME.',
        remediation:
          'Remove destructive root/home rm commands from hooks and restrict cleanup strictly to explicit workspace temp paths.',
      });
    }
    if (!reported.has('eval') && HOOK_EVAL_RE.test(cmd)) {
      reported.add('eval');
      push({
        id: makeFindingSlug(relPath, 'hook-eval'),
        severity: 'high',
        category: 'risky-hook',
        file: relPath,
        title: 'Hook invokes dynamic eval execution',
        summary:
          'Lifecycle hook command calls shell eval, enabling arbitrary command injection from untrusted hook payloads.',
        remediation:
          'Replace eval with direct argv invocation (for example node ./dist/hook.cjs with explicit CLI flags).',
      });
    }
  }
}

function scanMcpUnsafeEnv(
  relPath: string,
  text: string,
  push: (finding: OpsSecurityFinding) => void,
): void {
  let parsed: Record<string, unknown>;
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    parsed = raw as Record<string, unknown>;
  } catch {
    return;
  }

  const serversObj =
    parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)
      ? (parsed.mcpServers as Record<string, unknown>)
      : parsed.servers && typeof parsed.servers === 'object' && !Array.isArray(parsed.servers)
        ? (parsed.servers as Record<string, unknown>)
        : null;
  if (!serversObj) return;

  for (const [serverName, rawDef] of Object.entries(serversObj)) {
    if (!rawDef || typeof rawDef !== 'object' || Array.isArray(rawDef)) continue;
    const def = rawDef as Record<string, unknown>;
    const safeServerName = sanitizeMcpIdentifier(serverName);

    // 1. Hardcoded literal secrets inside env (zero value echo — only serverName & key name)
    if (def.env && typeof def.env === 'object' && !Array.isArray(def.env)) {
      for (const [rawKey, rawVal] of Object.entries(def.env as Record<string, unknown>)) {
        if (typeof rawVal !== 'string') continue;
        const val = rawVal.trim();
        if (!val) continue;
        if (PURE_ENV_REF_RE.test(val) || UNRESOLVED_PLACEHOLDER_RE.test(val)) continue;

        const stripped = val.replace(ENV_VAR_GLOBAL_RE, '').trim();
        if (!stripped || AUTH_SCHEME_ONLY_RE.test(stripped)) continue;

        const cleanedKey = rawKey.replace(/[^\w.-]/g, '').slice(0, 64) || 'key';
        const safeKey = sanitizeMcpIdentifier(cleanedKey);

        const knownSecret = containsSecretPattern(val) || JWT_LIKE_RE.test(val);
        const sensitiveKeyLiteral =
          SENSITIVE_KEY_NAME_RE.test(rawKey) &&
          stripped.length >= 4 &&
          !SAFE_LITERAL_ENV_VALUES_RE.test(stripped);
        const highEntropy = isHighEntropySecretLiteral(stripped);

        if (knownSecret || sensitiveKeyLiteral || highEntropy) {
          push({
            id: makeFindingSlug(relPath, `mcp-env-${safeServerName}-${safeKey}`),
            severity: 'high',
            category: 'mcp-unsafe-env',
            file: relPath,
            title: `Hardcoded credential in MCP env (${safeServerName}.${safeKey})`,
            summary: `MCP server "${safeServerName}" defines a hardcoded non-placeholder value for env.${safeKey} (secret value redacted).`,
            remediation: `Replace the literal value in "${safeServerName}" env.${safeKey} with a \${${safeKey}} placeholder or host keychain injection.`,
          });
        }
      }
    }

    // 2. Plaintext http:// remote MCP endpoint (non-loopback)
    const urlCandidate =
      typeof def.url === 'string'
        ? def.url.trim()
        : typeof def.serverUrl === 'string'
          ? def.serverUrl.trim()
          : typeof def.httpUrl === 'string'
            ? def.httpUrl.trim()
            : '';

    if (urlCandidate && /^http:\/\//i.test(urlCandidate)) {
      const host = extractSafeHttpHost(urlCandidate);
      if (host && !isLoopbackHost(host)) {
        const safeHost =
          containsSecretPattern(host) || SENSITIVE_KEY_NAME_RE.test(host)
            ? '<redacted-host>'
            : host.slice(0, 80);
        push({
          id: makeFindingSlug(relPath, `mcp-http-${safeServerName}`),
          severity: 'medium',
          category: 'mcp-unsafe-env',
          file: relPath,
          title: `Unencrypted remote http:// MCP endpoint (${safeServerName})`,
          summary: `MCP server "${safeServerName}" points to remote host "${safeHost}" over plaintext http://.`,
          remediation: `Use https:// with TLS for remote MCP server "${safeServerName}", or confine plaintext http:// strictly to localhost / 127.0.0.1 / [::1].`,
        });
      }
    }
  }
}

type SecurityScanTargetKind = 'rule' | 'skill' | 'hook' | 'mcp' | 'client-settings';

function auditStaticSecurityReadOnly(
  realRoot: string,
): { securityFindings: OpsSecurityFinding[]; securityScore: number } {
  const findings: OpsSecurityFinding[] = [];
  const seenFindingIds = new Set<string>();
  const pushFinding = (finding: OpsSecurityFinding): void => {
    const clean = sanitizeSecurityFinding(finding);
    if (seenFindingIds.has(clean.id)) return;
    seenFindingIds.add(clean.id);
    findings.push(clean);
  };

  const candidates: Array<{ relPath: string; kind: SecurityScanTargetKind }> = [];
  const seenCandidates = new Set<string>();
  const addCandidate = (relPath: string, kind: SecurityScanTargetKind): void => {
    const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!norm || seenCandidates.has(norm) || candidates.length >= MAX_SECURITY_SCAN_FILES * 2) return;
    seenCandidates.add(norm);
    candidates.push({ relPath: norm, kind });
  };

  // Fixed root rule / hook / MCP / settings files
  addCandidate('AGENTS.md', 'rule');
  addCandidate('GEMINI.md', 'rule');
  addCandidate('CLAUDE.md', 'rule');
  addCandidate('hooks.json', 'hook');
  addCandidate('.agents/hooks.json', 'hook');
  addCandidate('hooks/hooks.json', 'hook');
  addCandidate('mcp_config.json', 'mcp');
  addCandidate('.mcp.json', 'mcp');
  addCandidate('.cursor/mcp.json', 'mcp');
  addCandidate('.gemini/mcp_config.json', 'mcp');
  addCandidate('.claude/settings.json', 'client-settings');

  // Dynamic bounded directories (strictly no symlinks)
  for (const rel of listFilesStrictNoSymlink(
    realRoot,
    '.agents/rules',
    4,
    MAX_SECURITY_SCAN_FILES,
    (_rel, name) => /\.(?:md|mdx|txt)$/i.test(name),
  )) {
    addCandidate(rel, 'rule');
  }

  for (const rel of listFilesStrictNoSymlink(
    realRoot,
    '.cursor/rules',
    4,
    MAX_SECURITY_SCAN_FILES,
    (_rel, name) => /\.(?:mdc|md|mdx|txt)$/i.test(name),
  )) {
    addCandidate(rel, 'rule');
  }

  for (const rel of listFilesStrictNoSymlink(
    realRoot,
    'skills',
    2,
    MAX_SECURITY_SCAN_FILES,
    (_rel, name) => name.toUpperCase() === 'SKILL.MD',
  )) {
    addCandidate(rel, 'skill');
  }

  for (const rel of listFilesStrictNoSymlink(
    realRoot,
    '.agents/skills',
    2,
    MAX_SECURITY_SCAN_FILES,
    (_rel, name) => name.toUpperCase() === 'SKILL.MD',
  )) {
    addCandidate(rel, 'skill');
  }

  let scannedCount = 0;
  for (const target of candidates) {
    if (scannedCount >= MAX_SECURITY_SCAN_FILES) break;
    const read = readFileStrictNoSymlink(
      realRoot,
      target.relPath,
      MAX_SECURITY_SCAN_FILE_BYTES,
    );
    if (!read.ok) continue;
    scannedCount += 1;

    if (target.kind === 'rule' || target.kind === 'skill') {
      scanPromptInjection(read.relPath, read.text, pushFinding);
      scanTextBroadCommandAllow(read.relPath, read.text, pushFinding);
    } else if (target.kind === 'hook') {
      scanJsonBroadCommandAllow(read.relPath, read.text, pushFinding);
      scanRiskyHooks(read.relPath, read.text, pushFinding);
    } else if (target.kind === 'mcp') {
      scanJsonBroadCommandAllow(read.relPath, read.text, pushFinding);
      scanMcpUnsafeEnv(read.relPath, read.text, pushFinding);
    } else if (target.kind === 'client-settings') {
      scanJsonBroadCommandAllow(read.relPath, read.text, pushFinding);
    }
  }

  const severityRank: Record<OpsSecuritySeverity, number> = { high: 0, medium: 1, low: 2 };
  findings.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      a.file.localeCompare(b.file) ||
      a.id.localeCompare(b.id),
  );

  return {
    securityFindings: findings,
    securityScore: calculateSecurityScore(findings),
  };
}

function stripYamlFrontmatter(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length >= 3 && lines[0].trim() === '---') {
    for (let i = 1; i < Math.min(lines.length, 40); i += 1) {
      if (lines[i].trim() === '---') {
        return lines.slice(i + 1).join('\n');
      }
    }
  }
  return text;
}

function normalizeDedupLine(rawLine: string): string {
  let s = rawLine.trim();
  if (!s) return '';
  if (/^[-*_=`~]{3,}$/.test(s)) return '';
  // Strip leading Markdown list / heading / blockquote prefixes
  s = s.replace(/^(?:[>#*+-]+\s+|\d+[.)]\s+)/, '');
  // Strip inline emphasis & code ticks for resilient cross-client matching
  s = s.replace(/[`*_]+/g, '');
  s = s.replace(/\s+/g, ' ').trim().toLowerCase();
  const alphaNumCount = (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (alphaNumCount < 4) return '';
  return s;
}

function hashDedupUnit(unit: string): string {
  return crypto.createHash('sha256').update(unit).digest('hex').slice(0, 16);
}

interface NormalizedDocUnits {
  meaningfulLineHashes: string[];
  lineToParaHash: string[];
  paragraphHashes: string[];
  rawLineCount: number;
}

function extractNormalizedDocUnits(text: string): NormalizedDocUnits {
  const body = stripYamlFrontmatter(text);
  const rawLines = body.length === 0 ? [] : body.split(/\r?\n/);
  const meaningfulLineHashes: string[] = [];
  const lineToParaHash: string[] = [];
  const paragraphHashes: string[] = [];

  let paraBuf: string[] = [];
  const flushPara = () => {
    if (paraBuf.length === 0) return;
    const paraHash = paraBuf.length >= 2 ? hashDedupUnit(paraBuf.join('\n')) : '';
    if (paraHash) paragraphHashes.push(paraHash);
    for (const normLine of paraBuf) {
      meaningfulLineHashes.push(hashDedupUnit(normLine));
      lineToParaHash.push(paraHash);
    }
    paraBuf = [];
  };

  for (const raw of rawLines) {
    if (!raw.trim()) {
      flushPara();
      continue;
    }
    const norm = normalizeDedupLine(raw);
    if (!norm) continue;
    paraBuf.push(norm);
  }
  flushPara();

  return {
    meaningfulLineHashes,
    lineToParaHash,
    paragraphHashes,
    rawLineCount: text.length === 0 ? 0 : text.split(/\r?\n/).length,
  };
}

function isThinRulePointer(text: string): boolean {
  const nonEmpty = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (nonEmpty.length === 0 || nonEmpty.length > 3) return false;
  const joined = nonEmpty.join(' ');
  if (joined.length > 220) return false;
  return /(?:^|\s)@(?:AGENTS|GEMINI)\.md\b|\b(?:see|follow|import|source of truth:?)\s+[`"]?(?:AGENTS|GEMINI)\.md[`"]?/i.test(
    joined,
  );
}

function buildCrossClientMigrationPreviewReadOnly(
  realRoot: string,
): OpsMigrationPreview {
  const seenLineHashes = new Set<string>();
  const seenParaHashes = new Set<string>();

  const hasAgentsMd = readFileStrictNoSymlink(
    realRoot,
    'AGENTS.md',
    MAX_SECURITY_SCAN_FILE_BYTES,
  );
  const hasGeminiMd = readFileStrictNoSymlink(
    realRoot,
    'GEMINI.md',
    MAX_SECURITY_SCAN_FILE_BYTES,
  );
  const defaultRuleTarget = !hasAgentsMd.ok && hasGeminiMd.ok ? 'GEMINI.md' : 'AGENTS.md';

  const indexCanonicalText = (text: string): void => {
    const units = extractNormalizedDocUnits(text);
    for (const lh of units.meaningfulLineHashes) seenLineHashes.add(lh);
    for (const ph of units.paragraphHashes) seenParaHashes.add(ph);
  };

  if (hasAgentsMd.ok) indexCanonicalText(hasAgentsMd.text);
  if (hasGeminiMd.ok) indexCanonicalText(hasGeminiMd.text);

  const canonicalAgentRules = listFilesStrictNoSymlink(
    realRoot,
    '.agents/rules',
    4,
    MAX_SECURITY_SCAN_FILES,
    (_rel, name) => /\.(?:md|mdx|txt)$/i.test(name),
  );
  for (const rel of canonicalAgentRules) {
    const read = readFileStrictNoSymlink(realRoot, rel, MAX_SECURITY_SCAN_FILE_BYTES);
    if (read.ok) indexCanonicalText(read.text);
  }

  // Collect cross-client candidates (.claude/, CLAUDE.md, .cursor/rules/*, .codex/)
  const sources: Array<{ client: OpsMigrationClient; relPath: string; isConfig: boolean }> = [];
  const seenSourcePaths = new Set<string>();
  const addSource = (client: OpsMigrationClient, relPath: string, isConfig: boolean): void => {
    const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!norm || seenSourcePaths.has(norm) || sources.length >= MAX_SECURITY_SCAN_FILES) return;
    seenSourcePaths.add(norm);
    sources.push({ client, relPath: norm, isConfig });
  };

  // Claude sources
  addSource('claude', 'CLAUDE.md', false);
  for (const rel of listFilesStrictNoSymlink(
    realRoot,
    '.claude/rules',
    4,
    MAX_SECURITY_SCAN_FILES,
    (_rel, name) => /\.(?:md|mdx|txt)$/i.test(name),
  )) {
    addSource('claude', rel, false);
  }
  for (const rel of listFilesStrictNoSymlink(
    realRoot,
    '.claude/commands',
    4,
    MAX_SECURITY_SCAN_FILES,
    (_rel, name) => /\.(?:md|mdx|txt)$/i.test(name),
  )) {
    addSource('claude', rel, false);
  }
  addSource('claude', '.claude/settings.json', true);
  addSource('claude', '.claude/settings.local.json', true);

  // Cursor sources
  for (const rel of listFilesStrictNoSymlink(
    realRoot,
    '.cursor/rules',
    4,
    MAX_SECURITY_SCAN_FILES,
    (_rel, name) => /\.(?:mdc|md|mdx|txt)$/i.test(name),
  )) {
    addSource('cursor', rel, false);
  }

  // Codex sources
  for (const rel of listFilesStrictNoSymlink(
    realRoot,
    '.codex',
    4,
    MAX_SECURITY_SCAN_FILES,
    (r, name) => {
      const lower = r.toLowerCase();
      return (
        lower === '.codex/config.toml' ||
        /^\.codex\/rules\/.+\.toml$/i.test(lower) ||
        /\.(?:md|mdx|txt)$/i.test(name)
      );
    },
  )) {
    const isCfg = /\.toml$/i.test(rel);
    addSource('codex', rel, isCfg);
  }

  const entries: OpsMigrationEntry[] = [];
  for (const src of sources) {
    const read = readFileStrictNoSymlink(
      realRoot,
      src.relPath,
      MAX_SECURITY_SCAN_FILE_BYTES,
    );
    if (!read.ok) continue;

    const estimatedTokens = Math.ceil(read.text.length / 4);
    const rawLineCount = read.text.length === 0 ? 0 : read.text.split(/\r?\n/).length;

    if (src.isConfig) {
      entries.push({
        client: src.client,
        sourcePath: read.relPath,
        bytes: read.bytes,
        estimatedTokens,
        duplicatePercent: 0,
        duplicateLines: 0,
        totalLines: rawLineCount,
        recommendedTarget: '.agy-nov.json',
        action: 'keep-pointer',
      });
      continue;
    }

    const recommendedTarget = src.relPath.toLowerCase().startsWith('.claude/commands/')
      ? '.agents/skills/'
      : defaultRuleTarget;

    if (isThinRulePointer(read.text)) {
      entries.push({
        client: src.client,
        sourcePath: read.relPath,
        bytes: read.bytes,
        estimatedTokens,
        duplicatePercent: 0,
        duplicateLines: 0,
        totalLines: rawLineCount,
        recommendedTarget,
        action: 'keep-pointer',
      });
      continue;
    }

    const units = extractNormalizedDocUnits(read.text);
    const totalLines = units.meaningfulLineHashes.length > 0 ? units.meaningfulLineHashes.length : rawLineCount;
    let duplicateLines = 0;
    for (let i = 0; i < units.meaningfulLineHashes.length; i += 1) {
      const lh = units.meaningfulLineHashes[i];
      const ph = units.lineToParaHash[i];
      if (seenLineHashes.has(lh) || (ph && seenParaHashes.has(ph))) {
        duplicateLines += 1;
      }
    }

    const duplicatePercent =
      units.meaningfulLineHashes.length > 0
        ? Math.min(100, Math.round((duplicateLines / units.meaningfulLineHashes.length) * 100))
        : 0;

    // Add this source's normalized units to cumulative baseline so duplicate rules across clients are detected
    for (const lh of units.meaningfulLineHashes) seenLineHashes.add(lh);
    for (const ph of units.paragraphHashes) seenParaHashes.add(ph);

    const action: OpsMigrationAction =
      duplicatePercent >= 30 || (duplicateLines >= 2 && duplicatePercent >= 20)
        ? 'dedupe-merge'
        : 'migrate-unique';

    entries.push({
      client: src.client,
      sourcePath: read.relPath,
      bytes: read.bytes,
      estimatedTokens,
      duplicatePercent,
      duplicateLines,
      totalLines,
      recommendedTarget,
      action,
    });
  }

  return summarizeMigrationPreview(entries);
}

/**
 * 100% read-only audit of workspace agent assets (rules/skills/manifests/MCP/hooks/.agents/.gemini),
 * 24KB/20K rule bloat guard, 100-tool budget meter, MCP static health check, and agy-NOV local storage footprint.
 * Zero disk writes, strict realpath containment, and zero echoing of sensitive env values or secret files.
 */
export function auditWorkspaceAssets(
  workspaceRoot: string,
  rootDataDir?: string,
  optsOrEnabledNovTools?: number | AuditWorkspaceOptions,
): WorkspaceAuditReport {
  const realRoot = canonicalRealpathSync(path.resolve(workspaceRoot));
  const workspaceName = path.basename(realRoot) || 'workspace';

  const assets: WorkspaceAssetEntry[] = [];
  const seenRealPaths = new Set<string>();
  const seenMcpServerFiles = new Map<string, string>();
  const seenManifestNames = new Map<string, string>();
  const mcpHealthFindings: McpHealthFinding[] = [];
  const crossClientFindings: CrossClientFinding[] = [];
  const pushCrossClientFinding = (finding: CrossClientFinding): void => {
    crossClientFindings.push(sanitizeCrossClientFinding(finding));
  };
  let skippedSymlinks = 0;
  let skippedSensitive = 0;
  let mcpLiteralEnvCount = 0;
  let externalServersCount = 0;
  let estimatedExternalTools = 0;

  const isInsideWorkspace = (realCandidate: string): boolean =>
    isPathInsideDir(realRoot, realCandidate);

  const inspectFile = (candidatePath: string, kind: WorkspaceAssetKind): void => {
    const rawRel = path.relative(realRoot, candidatePath).replace(/\\/g, '/');
    if (isSensitiveOpsPath(rawRel)) {
      skippedSensitive += 1;
      return;
    }

    let lstat: fs.Stats;
    try {
      lstat = fs.lstatSync(candidatePath);
    } catch {
      return;
    }

    let realPath = candidatePath;
    if (lstat.isSymbolicLink()) {
      try {
        realPath = canonicalRealpathSync(candidatePath);
      } catch {
        skippedSymlinks += 1;
        return;
      }
      if (!isInsideWorkspace(realPath)) {
        skippedSymlinks += 1;
        return;
      }
    } else {
      try {
        realPath = canonicalRealpathSync(candidatePath);
      } catch {
        return;
      }
      if (!isInsideWorkspace(realPath)) {
        skippedSymlinks += 1;
        return;
      }
    }

    const realRel = path.relative(realRoot, realPath).replace(/\\/g, '/');
    if (isSensitiveOpsPath(realRel)) {
      skippedSensitive += 1;
      return;
    }

    if (seenRealPaths.has(realPath)) return;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(realPath);
    } catch {
      return;
    }
    if (!stat.isFile() || stat.size > MAX_AUDIT_FILE_BYTES) return;

    let text: string;
    try {
      const buf = fs.readFileSync(realPath);
      const inspectLen = Math.min(buf.length, 4096);
      for (let i = 0; i < inspectLen; i += 1) {
        if (buf[i] === 0) return; // skip binary
      }
      text = buf.toString('utf8');
    } catch {
      return;
    }

    seenRealPaths.add(realPath);

    let meta: Record<string, unknown> | undefined;
    if (kind === 'mcp') {
      const mcpInfo = inspectMcpConfigSafe(
        text,
        rawRel,
        realPath,
        realRoot,
        seenMcpServerFiles,
      );
      mcpLiteralEnvCount += mcpInfo.envKeyCount;
      externalServersCount += mcpInfo.activeExternalServers;
      estimatedExternalTools += mcpInfo.estimatedExternalTools;
      if (mcpInfo.findings.length > 0) {
        mcpHealthFindings.push(...mcpInfo.findings);
      }
      if (mcpInfo.crossClientFindings.length > 0) {
        crossClientFindings.push(...mcpInfo.crossClientFindings);
      }
      meta = {
        serverCount: mcpInfo.serverCount,
        serverNames: mcpInfo.serverNames,
        literalEnvEntries: mcpInfo.envKeyCount,
        estimatedTools: mcpInfo.estimatedExternalTools,
      };
    } else if (kind === 'manifest') {
      try {
        const parsedManifest = JSON.parse(text) as Record<string, unknown>;
        if (parsedManifest && typeof parsedManifest === 'object' && !Array.isArray(parsedManifest)) {
          const rawName = typeof parsedManifest.name === 'string' ? parsedManifest.name.trim() : '';
          if (rawName) {
            const normName = rawName.toLowerCase();
            const safePluginName = sanitizeMcpIdentifier(rawName.slice(0, 80));
            const prevManifest = seenManifestNames.get(normName);
            if (prevManifest && prevManifest !== rawRel) {
              pushCrossClientFinding({
                severity: 'warn',
                code: 'duplicate-plugin-or-server',
                client: 'shared',
                file: rawRel,
                message: `Duplicate plugin manifest name "${safePluginName}" declared in both "${prevManifest}" and "${rawRel}" (#1937).`,
                suggestion:
                  'Keep one canonical plugin manifest or disambiguate plugin names so Antigravity / Claude hosts do not register duplicate tools.',
              });
            } else if (!prevManifest) {
              seenManifestNames.set(normName, rawRel);
            }
            meta = { pluginName: safePluginName };
          }
        }
      } catch {
        // ignore invalid manifest JSON here
      }
    }

    const chars = text.length;
    const lineCount = text.length === 0 ? 0 : text.split(/\r?\n/).length;
    assets.push({
      relPath: rawRel,
      kind,
      bytes: stat.size,
      chars,
      estimatedTokens: Math.ceil(chars / 4),
      lineCount,
      meta,
    });
  };

  // 1. Direct well-known root & standard workspace MCP config files
  const fixedCandidates: Array<{ rel: string; kind: WorkspaceAssetKind }> = [
    { rel: 'AGENTS.md', kind: 'rules' },
    { rel: 'CLAUDE.md', kind: 'rules' },
    { rel: 'GEMINI.md', kind: 'rules' },
    { rel: '.cursorrules', kind: 'rules' },
    { rel: '.windsurfrules', kind: 'rules' },
    { rel: 'plugin.json', kind: 'manifest' },
    { rel: '.claude-plugin/plugin.json', kind: 'manifest' },
    { rel: 'mcp_config.json', kind: 'mcp' },
    { rel: '.mcp.json', kind: 'mcp' },
    { rel: '.cursor/mcp.json', kind: 'mcp' },
    { rel: '.vscode/mcp.json', kind: 'mcp' },
    { rel: '.antigravity/mcp.json', kind: 'mcp' },
    { rel: '.gemini/mcp_config.json', kind: 'mcp' },
    { rel: 'hooks.json', kind: 'hooks' },
    { rel: 'hooks/hooks.json', kind: 'hooks' },
  ];

  for (const item of fixedCandidates) {
    inspectFile(path.join(realRoot, item.rel), item.kind);
  }

  // 2. Recursive scanner for skills/**/SKILL.md, .agents/**/* and .gemini/**/*.md
  const walkBounded = (
    relBaseDir: string,
    maxDepth: number,
    onFile: (fullPath: string, entryName: string) => void,
  ) => {
    const startDir = path.join(realRoot, relBaseDir);
    if (!fs.existsSync(startDir)) return;

    let realStart: string;
    try {
      realStart = canonicalRealpathSync(startDir);
    } catch {
      skippedSymlinks += 1;
      return;
    }
    if (!isInsideWorkspace(realStart)) {
      skippedSymlinks += 1;
      return;
    }

    const visitedDirs = new Set<string>();
    const recurse = (dir: string, depth: number) => {
      if (depth > maxDepth) return;
      if (visitedDirs.has(dir)) return;
      visitedDirs.add(dir);

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(realRoot, full).replace(/\\/g, '/');

        if (isSensitiveOpsPath(rel)) {
          skippedSensitive += 1;
          continue;
        }

        if (entry.isSymbolicLink()) {
          let realSub: string;
          try {
            realSub = canonicalRealpathSync(full);
          } catch {
            skippedSymlinks += 1;
            continue;
          }
          if (!isInsideWorkspace(realSub)) {
            skippedSymlinks += 1;
            continue;
          }
          const realSubRel = path.relative(realRoot, realSub).replace(/\\/g, '/');
          if (isSensitiveOpsPath(realSubRel)) {
            skippedSensitive += 1;
            continue;
          }
          try {
            const st = fs.statSync(realSub);
            if (st.isDirectory()) {
              recurse(realSub, depth + 1);
            } else if (st.isFile()) {
              onFile(full, entry.name);
            }
          } catch {
            skippedSymlinks += 1;
          }
          continue;
        }

        if (entry.isDirectory()) {
          recurse(full, depth + 1);
        } else if (entry.isFile()) {
          onFile(full, entry.name);
        }
      }
    };

    recurse(realStart, 0);
  };

  walkBounded('skills', 4, (fullPath, entryName) => {
    if (entryName.toUpperCase() === 'SKILL.MD') {
      inspectFile(fullPath, 'skill');
    }
  });

  walkBounded('.agents', 4, (fullPath, entryName) => {
    const lowerName = entryName.toLowerCase();
    if (lowerName === 'mcp.json' || lowerName === 'mcp_config.json') {
      inspectFile(fullPath, 'mcp');
      return;
    }
    const ext = path.extname(lowerName);
    if (ALLOWED_AGENT_CONFIG_EXTS.has(ext)) {
      inspectFile(fullPath, 'agent-config');
    }
  });

  // Read-only scan of non-sensitive markdown/text rule documents inside workspace .gemini/
  walkBounded('.gemini', 4, (fullPath, entryName) => {
    const ext = path.extname(entryName).toLowerCase();
    if (ext === '.md' || ext === '.mdx' || ext === '.txt') {
      inspectFile(fullPath, 'rules');
    }
  });

  // 2.5 Ops 2.5 read-only cross-client migration check (.claude/, .cursor/rules/, .codex/)
  // Strictly respects walkBounded realpath containment & skips all sensitive paths without echoing file values.
  const claudeCommands: string[] = [];
  const claudeRules: string[] = [];
  const claudeSettings: string[] = [];
  const cursorRules: string[] = [];
  const codexFiles: string[] = [];

  const verifySafeCrossClientEntry = (fullPath: string): string | null => {
    const rel = path.relative(realRoot, fullPath).replace(/\\/g, '/');
    if (isSensitiveCrossClientFile(rel)) {
      skippedSensitive += 1;
      return null;
    }
    let realTarget: string;
    try {
      realTarget = canonicalRealpathSync(fullPath);
    } catch {
      skippedSymlinks += 1;
      return null;
    }
    if (!isInsideWorkspace(realTarget)) {
      skippedSymlinks += 1;
      return null;
    }
    const realRel = path.relative(realRoot, realTarget).replace(/\\/g, '/');
    if (isSensitiveCrossClientFile(realRel)) {
      skippedSensitive += 1;
      return null;
    }
    try {
      const st = fs.statSync(realTarget);
      if (!st.isFile()) return null;
    } catch {
      return null;
    }
    return rel;
  };

  walkBounded('.claude', 4, (fullPath) => {
    const rel = verifySafeCrossClientEntry(fullPath);
    if (!rel) return;
    const lower = rel.toLowerCase();
    if (/^\.claude\/commands\/.+\.(?:md|mdx|txt)$/.test(lower)) {
      claudeCommands.push(rel);
    } else if (/^\.claude\/rules\/.+\.(?:md|mdx|txt)$/.test(lower)) {
      claudeRules.push(rel);
    } else if (/^\.claude\/settings(?:\.local)?\.json$/.test(lower)) {
      claudeSettings.push(rel);
    }
  });

  walkBounded('.cursor/rules', 4, (fullPath) => {
    const rel = verifySafeCrossClientEntry(fullPath);
    if (!rel) return;
    if (/\.(?:mdc|md|mdx|txt)$/i.test(rel)) {
      cursorRules.push(rel);
    }
  });

  walkBounded('.codex', 4, (fullPath) => {
    const rel = verifySafeCrossClientEntry(fullPath);
    if (!rel) return;
    const lower = rel.toLowerCase();
    if (
      lower === '.codex/config.toml' ||
      /\.(?:md|mdx|txt)$/i.test(lower) ||
      /^\.codex\/rules\/.+\.toml$/i.test(lower)
    ) {
      codexFiles.push(rel);
    }
  });

  const formatFilePreview = (list: readonly string[]): string => {
    const head = list.slice(0, 3).map((p) => sanitizeDisplayPath(p));
    return list.length > 3 ? `${head.join(', ')}, +${list.length - 3} more` : head.join(', ');
  };

  if (claudeCommands.length > 0) {
    pushCrossClientFinding({
      severity: 'info',
      code: 'cross-client-commands',
      client: 'claude',
      file: claudeCommands.length === 1 ? claudeCommands[0] : '.claude/commands/',
      message: `Detected ${claudeCommands.length} Claude custom command file(s) (${formatFilePreview(claudeCommands)}).`,
      suggestion:
        'Mirror reusable slash commands as skills/*/SKILL.md or Ops Prompt Vault templates so Antigravity and Claude Code stay aligned.',
    });
  }

  if (claudeRules.length > 0) {
    pushCrossClientFinding({
      severity: 'info',
      code: 'cross-client-rules',
      client: 'claude',
      file: claudeRules.length === 1 ? claudeRules[0] : '.claude/rules/',
      message: `Detected ${claudeRules.length} Claude rule file(s) (${formatFilePreview(claudeRules)}).`,
      suggestion:
        'Consolidate shared engineering rules into root AGENTS.md (or on-demand skills/) so Antigravity and Claude Code share one source of truth.',
    });
  }

  if (claudeSettings.length > 0) {
    pushCrossClientFinding({
      severity: 'info',
      code: 'cross-client-rules',
      client: 'claude',
      file: claudeSettings.length === 1 ? claudeSettings[0] : '.claude/settings.json',
      message: `Detected Claude workspace settings (${formatFilePreview(claudeSettings)}); file values are not read or echoed.`,
      suggestion:
        'Share neutral team presets and safe verifyCommands via .agy-nov.json while keeping client-specific settings isolated.',
    });
  }

  if (cursorRules.length > 0) {
    pushCrossClientFinding({
      severity: 'info',
      code: 'cross-client-rules',
      client: 'cursor',
      file: cursorRules.length === 1 ? cursorRules[0] : '.cursor/rules/',
      message: `Detected ${cursorRules.length} Cursor rule file(s) (${formatFilePreview(cursorRules)}).`,
      suggestion:
        'Keep shared workspace rules in AGENTS.md or modular skills/ so Antigravity and Cursor coexist without rule drift.',
    });
  }

  if (codexFiles.length > 0) {
    pushCrossClientFinding({
      severity: 'info',
      code: 'cross-client-rules',
      client: 'codex',
      file: codexFiles.length === 1 ? codexFiles[0] : '.codex/',
      message: `Detected ${codexFiles.length} Codex config/rule file(s) (${formatFilePreview(codexFiles)}); configuration values are never echoed.`,
      suggestion:
        'Coexist cleanly by using root AGENTS.md as the canonical rule file alongside optional read-only .agy-nov.json team presets.',
    });
  }

  // Strictly read-only team preset audit (.agy-nov.json)
  const teamPreset = loadTeamPresetReadOnly(realRoot);

  assets.sort((a, b) => b.estimatedTokens - a.estimatedTokens || a.relPath.localeCompare(b.relPath));

  const byKind: Record<WorkspaceAssetKind, { count: number; estimatedTokens: number }> = {
    rules: { count: 0, estimatedTokens: 0 },
    skill: { count: 0, estimatedTokens: 0 },
    manifest: { count: 0, estimatedTokens: 0 },
    mcp: { count: 0, estimatedTokens: 0 },
    hooks: { count: 0, estimatedTokens: 0 },
    'agent-config': { count: 0, estimatedTokens: 0 },
  };

  let totalBytes = 0;
  let totalChars = 0;
  let totalEstimatedTokens = 0;
  for (const a of assets) {
    totalBytes += a.bytes;
    totalChars += a.chars;
    totalEstimatedTokens += a.estimatedTokens;
    byKind[a.kind].count += 1;
    byKind[a.kind].estimatedTokens += a.estimatedTokens;
  }

  // 3. Rule Bloat Guard (24 KB single file / 20K aggregate estimated tokens)
  const ruleAssets = assets.filter(isRuleBloatTarget);
  const singleWarnBytes = Math.floor(RULE_SINGLE_FILE_LIMIT_BYTES * 0.8);
  const aggregateWarnTokens = Math.floor(RULE_AGGREGATE_TOKEN_LIMIT * 0.8);

  let largestFileBytes = 0;
  let largestFilePath: string | undefined;
  let totalRuleBytes = 0;
  let totalRuleTokens = 0;
  const offendingFiles: RuleBloatOffender[] = [];

  for (const r of ruleAssets) {
    totalRuleBytes += r.bytes;
    totalRuleTokens += r.estimatedTokens;
    if (r.bytes > largestFileBytes) {
      largestFileBytes = r.bytes;
      largestFilePath = r.relPath;
    }
    if (r.bytes > RULE_SINGLE_FILE_LIMIT_BYTES) {
      offendingFiles.push({
        path: r.relPath,
        bytes: r.bytes,
        estimatedTokens: r.estimatedTokens,
        reason: `Exceeds 24 KB single-file limit (${(r.bytes / 1024).toFixed(1)} KB); may trigger false 429 retry loops.`,
      });
    } else if (r.bytes >= singleWarnBytes) {
      offendingFiles.push({
        path: r.relPath,
        bytes: r.bytes,
        estimatedTokens: r.estimatedTokens,
        reason: `Approaching 24 KB single-file limit (${(r.bytes / 1024).toFixed(1)} KB, >= 80%).`,
      });
    }
  }

  let ruleBloatStatus: 'ok' | 'warn' | 'critical' = 'ok';
  if (largestFileBytes > RULE_SINGLE_FILE_LIMIT_BYTES || totalRuleTokens > RULE_AGGREGATE_TOKEN_LIMIT) {
    ruleBloatStatus = 'critical';
    if (offendingFiles.length === 0 && totalRuleTokens > RULE_AGGREGATE_TOKEN_LIMIT) {
      const topRules = [...ruleAssets].sort((a, b) => b.estimatedTokens - a.estimatedTokens).slice(0, 3);
      for (const r of topRules) {
        offendingFiles.push({
          path: r.relPath,
          bytes: r.bytes,
          estimatedTokens: r.estimatedTokens,
          reason: `Contributes to aggregate rule bloat (~${totalRuleTokens} > 20,000 tokens); may trigger false 429 retry loops.`,
        });
      }
    }
  } else if (largestFileBytes >= singleWarnBytes || totalRuleTokens >= aggregateWarnTokens) {
    ruleBloatStatus = 'warn';
  }

  const ruleBloat: RuleBloatAssessment = {
    status: ruleBloatStatus,
    singleFileLimitBytes: 24576,
    aggregateTokenLimit: 20000,
    largestFileBytes,
    ...(largestFilePath ? { largestFilePath } : {}),
    totalRuleBytes,
    totalRuleTokens,
    offendingFiles,
  };

  // 4. 100-Tool Hard Limit Budget Meter
  const agyNovTools = resolveEnabledNovTools(rootDataDir, optsOrEnabledNovTools);
  const estimatedTotalTools = agyNovTools + estimatedExternalTools;
  const usagePercent = Math.round((estimatedTotalTools / TOOL_BUDGET_HARD_LIMIT) * 100);
  const toolBudgetStatus: 'ok' | 'warn' | 'critical' =
    estimatedTotalTools >= 95 ? 'critical' : estimatedTotalTools >= 75 ? 'warn' : 'ok';

  const toolBudget: ToolBudgetAssessment = {
    agyNovTools,
    externalServersCount,
    estimatedExternalTools,
    estimatedTotalTools,
    hardLimit: 100,
    usagePercent,
    status: toolBudgetStatus,
  };

  const storage = auditStorageReadOnly(rootDataDir);
  const recommendations: AuditRecommendation[] = [];
  let penalty = 0;

  if (ruleBloat.status === 'critical') {
    penalty += 25;
    recommendations.push({
      level: 'critical',
      code: 'ops.rule-bloat',
      title: 'Rule bloat exceeds 24 KB / 20K token safety limit',
      detail: `Largest rule file ${ruleBloat.largestFilePath ?? '(rules)'} is ${(ruleBloat.largestFileBytes / 1024).toFixed(1)} KB; aggregate rules total ~${ruleBloat.totalRuleTokens} tokens. Oversized always-on rules can trigger false 429 retry loops — split reference content into on-demand skills.`,
    });
  } else if (ruleBloat.status === 'warn') {
    penalty += 12;
    recommendations.push({
      level: 'warn',
      code: 'ops.rule-bloat-warn',
      title: 'Rule files approaching 24 KB / 20K token ceiling (>= 80%)',
      detail: `Largest rule file ${ruleBloat.largestFilePath ?? '(rules)'} is ${(ruleBloat.largestFileBytes / 1024).toFixed(1)} KB; aggregate rules total ~${ruleBloat.totalRuleTokens} tokens. Trim redundant instructions to prevent false 429 retry loops.`,
    });
  }

  if (toolBudget.status === 'critical') {
    penalty += 20;
    recommendations.push({
      level: 'critical',
      code: 'ops.tool-budget',
      title: `Tool budget critical (${toolBudget.estimatedTotalTools}/100 tools)`,
      detail: `Estimated ${toolBudget.estimatedTotalTools} active tools (agy-NOV ${toolBudget.agyNovTools} + ${toolBudget.externalServersCount} external MCP server(s) ~${toolBudget.estimatedExternalTools}) approaches or exceeds the 100-tool hard ceiling. Disable unused modules or external MCP servers.`,
    });
  } else if (toolBudget.status === 'warn') {
    penalty += 10;
    recommendations.push({
      level: 'warn',
      code: 'ops.tool-budget-warn',
      title: `Tool budget elevated (${toolBudget.estimatedTotalTools}/100 tools)`,
      detail: `Estimated ${toolBudget.estimatedTotalTools} active tools (${toolBudget.usagePercent}% of the 100-tool hard ceiling). Keep unused modules switched off for headroom.`,
    });
  }

  const mcpErrorCount = mcpHealthFindings.filter((f) => f.severity === 'error').length;
  if (mcpErrorCount > 0) {
    penalty += Math.min(24, mcpErrorCount * 8);
    recommendations.push({
      level: 'warn',
      code: 'ops.mcp-health-errors',
      title: `MCP static health check found ${mcpErrorCount} configuration error(s)`,
      detail: `Inspect mcpHealthFindings for missing local scripts, invalid JSON, or missing transport fields.`,
    });
  }

  if (totalEstimatedTokens > 8000) {
    penalty += 15;
    recommendations.push({
      level: 'warn',
      code: 'ops.high-context-budget',
      title: 'Workspace rule & skill context budget is elevated',
      detail: `Scanned assets total ~${totalEstimatedTokens} tokens (> 8,000). Trim verbose rule sections or move reference docs into on-demand skills.`,
    });
  }

  const oversizedDocs = assets.filter(
    (a) => (a.kind === 'rules' || a.kind === 'skill') && a.estimatedTokens > 3000,
  );
  for (const doc of oversizedDocs.slice(0, 3)) {
    penalty += 10;
    recommendations.push({
      level: 'warn',
      code: 'ops.large-instruction-file',
      title: `Large instruction file: ${doc.relPath}`,
      detail: `${doc.relPath} is ~${doc.estimatedTokens} tokens (${doc.lineCount} lines). Split stable policy from reference appendices.`,
    });
  }

  if (skippedSymlinks > 0) {
    penalty += 10;
    recommendations.push({
      level: 'warn',
      code: 'ops.symlink-escape-skipped',
      title: 'Out-of-workspace symlink(s) skipped',
      detail: `Skipped ${skippedSymlinks} symlink(s) resolving outside the workspace boundary during read-only audit.`,
    });
  }

  if (mcpLiteralEnvCount > 0) {
    penalty += 15;
    recommendations.push({
      level: 'warn',
      code: 'ops.mcp-literal-env',
      title: 'Literal env values detected in MCP config',
      detail: `Detected ${mcpLiteralEnvCount} non-placeholder env value(s) in MCP config (values redacted). Prefer environment variable references instead of hardcoded tokens.`,
    });
  }

  if (teamPreset.found && !teamPreset.valid) {
    penalty += 10;
    recommendations.push({
      level: 'warn',
      code: 'ops.team-preset-invalid',
      title: 'Team preset (.agy-nov.json) failed validation',
      detail: teamPreset.errors.join(' '),
    });
  } else if (teamPreset.found && teamPreset.warnings.length > 0) {
    recommendations.push({
      level: 'warn',
      code: 'ops.team-preset-warnings',
      title: `Team preset (.agy-nov.json) has ${teamPreset.warnings.length} security/schema warning(s)`,
      detail: teamPreset.warnings.slice(0, 3).join(' '),
    });
  }

  if (storage.totalBytes > 50 * 1024 * 1024) {
    penalty += 10;
    recommendations.push({
      level: 'info',
      code: 'ops.storage-growth',
      title: 'Local agy-NOV storage exceeds 50 MiB',
      detail: `Current data directory size is ${(storage.totalBytes / (1024 * 1024)).toFixed(1)} MiB across ${storage.totalFiles} files. Consider pruning old snapshots or completed sessions.`,
    });
  }

  // 5. Ops 3.0 strictly read-only static security audit & cross-client dedup preview
  const { securityFindings, securityScore } = auditStaticSecurityReadOnly(realRoot);
  const migrationPreview = buildCrossClientMigrationPreviewReadOnly(realRoot);

  const highSecurityCount = securityFindings.filter((f) => f.severity === 'high').length;
  if (highSecurityCount > 0) {
    recommendations.push({
      level: 'critical',
      code: 'ops.static-security-findings',
      title: `Static security audit detected ${highSecurityCount} high-severity risk(s) (score ${securityScore}/100)`,
      detail: `Inspect securityFindings for prompt-injection, unrestricted command allowlists, risky hooks, or hardcoded MCP credentials.`,
    });
  } else if (securityFindings.length > 0) {
    recommendations.push({
      level: 'warn',
      code: 'ops.static-security-findings',
      title: `Static security audit detected ${securityFindings.length} finding(s) (score ${securityScore}/100)`,
      detail: `Review securityFindings for recommended hardening across workspace rules, hooks, and MCP endpoints.`,
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      level: 'info',
      code: 'ops.healthy',
      title: 'Workspace asset footprint looks healthy',
      detail: `Scanned ${assets.length} asset(s) (~${totalEstimatedTokens} tokens) with zero boundary violations.`,
    });
  }

  return {
    mode: 'live',
    workspaceName,
    scannedAt: new Date().toISOString(),
    healthScore: Math.max(10, 100 - penalty),
    summary: {
      assetCount: assets.length,
      totalBytes,
      totalChars,
      totalEstimatedTokens,
      skippedSymlinks,
      skippedSensitive,
      byKind,
    },
    assets,
    storage,
    recommendations,
    ruleBloat,
    toolBudget,
    mcpHealthFindings,
    teamPreset,
    crossClientFindings,
    securityFindings,
    securityScore,
    migrationPreview,
  };
}

export const auditWorkspaceReadOnly = auditWorkspaceAssets;

export function createDemoOpsAuditReport(
  workspaceRoot: string,
  enabledNovTools?: number,
): WorkspaceAuditReport {
  const workspaceName = path.basename(path.resolve(workspaceRoot)) || 'agy-NOV';
  const novTools =
    typeof enabledNovTools === 'number' && Number.isFinite(enabledNovTools) && enabledNovTools >= 0
      ? Math.floor(enabledNovTools)
      : countEnabledModelTools(createDefaultConfig().modules);
  const externalServersCount = 3;
  const estimatedExternalTools = 28;
  const estimatedTotalTools = novTools + estimatedExternalTools;
  const usagePercent = Math.round((estimatedTotalTools / TOOL_BUDGET_HARD_LIMIT) * 100);
  const toolBudgetStatus: 'ok' | 'warn' | 'critical' =
    estimatedTotalTools >= 95 ? 'critical' : estimatedTotalTools >= 75 ? 'warn' : 'ok';

  const demoSecurityFindings: OpsSecurityFinding[] = [
    {
      id: 'demo-sec-mcp-http-docs',
      severity: 'medium',
      category: 'mcp-unsafe-env',
      file: '.mcp.json',
      title: 'Unencrypted remote http:// MCP endpoint (docs-search)',
      summary:
        'MCP server "docs-search" points to remote host "mcp-docs.staging.internal" over plaintext http://.',
      remediation:
        'Use https:// with TLS for remote MCP server "docs-search", or confine plaintext http:// strictly to localhost / 127.0.0.1 / [::1].',
    },
  ];
  const demoSecurityScore = calculateSecurityScore(demoSecurityFindings);

  const demoMigrationPreview = summarizeMigrationPreview([
    {
      client: 'claude',
      sourcePath: 'CLAUDE.md',
      bytes: 3420,
      estimatedTokens: 855,
      duplicatePercent: 82,
      duplicateLines: 41,
      totalLines: 50,
      recommendedTarget: 'AGENTS.md',
      action: 'dedupe-merge',
    },
    {
      client: 'cursor',
      sourcePath: '.cursor/rules/typescript.mdc',
      bytes: 2180,
      estimatedTokens: 545,
      duplicatePercent: 64,
      duplicateLines: 25,
      totalLines: 39,
      recommendedTarget: 'AGENTS.md',
      action: 'dedupe-merge',
    },
    {
      client: 'claude',
      sourcePath: '.claude/commands/release.md',
      bytes: 1240,
      estimatedTokens: 310,
      duplicatePercent: 15,
      duplicateLines: 3,
      totalLines: 20,
      recommendedTarget: '.agents/skills/',
      action: 'migrate-unique',
    },
    {
      client: 'codex',
      sourcePath: '.codex/config.toml',
      bytes: 480,
      estimatedTokens: 120,
      duplicatePercent: 0,
      duplicateLines: 0,
      totalLines: 14,
      recommendedTarget: '.agy-nov.json',
      action: 'keep-pointer',
    },
  ]);

  const assets: WorkspaceAssetEntry[] = [
    {
      relPath: 'AGENTS.md',
      kind: 'rules',
      bytes: 4280,
      chars: 4020,
      estimatedTokens: 1005,
      lineCount: 68,
    },
    {
      relPath: '.agents/rules/security.md',
      kind: 'agent-config',
      bytes: 2840,
      chars: 2680,
      estimatedTokens: 670,
      lineCount: 44,
    },
    {
      relPath: 'skills/agy-nov/SKILL.md',
      kind: 'skill',
      bytes: 1960,
      chars: 1840,
      estimatedTokens: 460,
      lineCount: 38,
    },
    {
      relPath: '.mcp.json',
      kind: 'mcp',
      bytes: 880,
      chars: 880,
      estimatedTokens: 220,
      lineCount: 34,
      meta: {
        serverCount: externalServersCount,
        serverNames: ['github', 'postgres-readonly', 'docs-search'],
        literalEnvEntries: 0,
        estimatedTools: estimatedExternalTools,
      },
    },
    {
      relPath: 'plugin.json',
      kind: 'manifest',
      bytes: 720,
      chars: 720,
      estimatedTokens: 180,
      lineCount: 24,
    },
    {
      relPath: 'hooks/hooks.json',
      kind: 'hooks',
      bytes: 940,
      chars: 940,
      estimatedTokens: 235,
      lineCount: 31,
    },
  ];
  return {
    mode: 'demo',
    workspaceName,
    scannedAt: new Date().toISOString(),
    healthScore: 94,
    summary: {
      assetCount: assets.length,
      totalBytes: 11_620,
      totalChars: 11_080,
      totalEstimatedTokens: 2770,
      skippedSymlinks: 0,
      skippedSensitive: 0,
      byKind: {
        rules: { count: 1, estimatedTokens: 1005 },
        skill: { count: 1, estimatedTokens: 460 },
        manifest: { count: 1, estimatedTokens: 180 },
        mcp: { count: 1, estimatedTokens: 220 },
        hooks: { count: 1, estimatedTokens: 235 },
        'agent-config': { count: 1, estimatedTokens: 670 },
      },
    },
    assets,
    storage: {
      rootDataDirExists: true,
      totalBytes: 186_420,
      totalFiles: 14,
      modules: [
        { moduleId: 'guard', bytes: 112_640, files: 7 },
        { moduleId: 'xray', bytes: 42_180, files: 3 },
        { moduleId: 'mem', bytes: 19_200, files: 2 },
        { moduleId: 'radar', bytes: 8_400, files: 1 },
        { moduleId: 'ops', bytes: 4_000, files: 1 },
      ],
    },
    recommendations: [
      {
        level: 'info',
        code: 'ops.healthy',
        title: 'Workspace rules & tool budget are within safe bounds',
        detail: `Largest rule file is 4.2 KB (< 24 KB limit) and estimated tool load is ${estimatedTotalTools}/100 (${usagePercent}%).`,
      },
    ],
    ruleBloat: {
      status: 'ok',
      singleFileLimitBytes: 24576,
      aggregateTokenLimit: 20000,
      largestFileBytes: 4280,
      largestFilePath: 'AGENTS.md',
      totalRuleBytes: 7120,
      totalRuleTokens: 1675,
      offendingFiles: [],
    },
    toolBudget: {
      agyNovTools: novTools,
      externalServersCount,
      estimatedExternalTools,
      estimatedTotalTools,
      hardLimit: 100,
      usagePercent,
      status: toolBudgetStatus,
    },
    mcpHealthFindings: [
      {
        severity: 'info',
        serverName: 'postgres-readonly',
        file: '.mcp.json',
        message: 'Server "postgres-readonly" uses env var placeholder references (zero hardcoded literals detected).',
      },
      {
        severity: 'warn',
        serverName: 'docs-search',
        file: '.mcp.json',
        message: 'Server "docs-search" defines a static OAuth/token expiry field (value redacted); verify auto-refresh is enabled.',
      },
    ],
    teamPreset: {
      found: true,
      filePath: '.agy-nov.json',
      valid: true,
      preset: 'power',
      enableModules: ['verify', 'ops'],
      verifyCommands: [
        { label: 'TypeScript Typecheck', executable: 'npm', args: ['run', 'typecheck'] },
        { label: 'Unit Tests', executable: 'npm', args: ['test'] },
      ],
      specTemplatesCount: 2,
      warnings: [],
      errors: [],
    },
    crossClientFindings: [
      {
        severity: 'warn',
        code: 'mcp-unexpanded-env',
        client: 'antigravity',
        file: '.mcp.json',
        message:
          'Server "github" references static env placeholder(s) (env.GITHUB_TOKEN (${GITHUB_TOKEN})). Antigravity 2.0 static MCP configs may not auto-expand ${ENV_VAR} across all transports (#233).',
        suggestion:
          'Verify host-level environment injection or use OS keychain / a thin local wrapper script instead of relying on static ${ENV_VAR} expansion in MCP JSON.',
      },
      {
        severity: 'info',
        code: 'cross-client-rules',
        client: 'cursor',
        file: '.cursor/rules/typescript.mdc',
        message: 'Detected 1 Cursor rule file(s) (.cursor/rules/typescript.mdc).',
        suggestion:
          'Keep shared workspace rules in AGENTS.md or modular skills/ so Antigravity and Cursor coexist without rule drift.',
      },
    ],
    securityFindings: demoSecurityFindings,
    securityScore: demoSecurityScore,
    migrationPreview: demoMigrationPreview,
  };
}

export const createDemoWorkspaceAudit = createDemoOpsAuditReport;
