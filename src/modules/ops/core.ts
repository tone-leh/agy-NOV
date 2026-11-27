import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MODULE_IDS } from '../../core/catalog.js';
import { atomicWriteJson } from '../../core/utils.js';

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

export interface AuditRecommendation {
  level: 'info' | 'warn' | 'critical';
  code: string;
  title: string;
  detail: string;
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

function summarizeMcpConfigSafe(rawText: string): {
  serverCount: number;
  serverNames: string[];
  envKeyCount: number;
} | null {
  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const serversObj =
      (parsed.mcpServers && typeof parsed.mcpServers === 'object'
        ? (parsed.mcpServers as Record<string, unknown>)
        : parsed.servers && typeof parsed.servers === 'object'
          ? (parsed.servers as Record<string, unknown>)
          : null);
    if (!serversObj) return null;

    const serverNames = Object.keys(serversObj).slice(0, 30);
    let envKeyCount = 0;
    for (const key of serverNames) {
      const def = serversObj[key];
      if (def && typeof def === 'object') {
        const envObj = (def as Record<string, unknown>).env;
        if (envObj && typeof envObj === 'object') {
          for (const [, val] of Object.entries(envObj as Record<string, unknown>)) {
            if (typeof val === 'string' && val.trim().length > 0 && !/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(val.trim())) {
              envKeyCount += 1;
            }
          }
        }
      }
    }
    return {
      serverCount: Object.keys(serversObj).length,
      serverNames,
      envKeyCount,
    };
  } catch {
    return null;
  }
}

function measureDirReadOnly(
  targetDir: string,
  allowedRootReal: string,
  maxDepth = 5,
): { bytes: number; files: number } {
  const rootPrefix = allowedRootReal.endsWith(path.sep)
    ? allowedRootReal
    : `${allowedRootReal}${path.sep}`;
  let bytes = 0;
  let files = 0;
  const visited = new Set<string>();

  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let realDir: string;
    try {
      realDir = fs.realpathSync(dir);
    } catch {
      return;
    }
    if (realDir !== allowedRootReal && !realDir.startsWith(rootPrefix)) return;
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
    realDataRoot = fs.realpathSync(path.resolve(rootDataDir));
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

/**
 * 100% read-only audit of workspace agent assets (rules/skills/manifests/MCP/hooks/.agents)
 * and agy-NOV local storage footprint. Zero disk writes, strict realpath containment,
 * and zero echoing of sensitive env values or secret files.
 */
export function auditWorkspaceAssets(
  workspaceRoot: string,
  rootDataDir?: string,
): WorkspaceAuditReport {
  const realRoot = fs.realpathSync(path.resolve(workspaceRoot));
  const rootPrefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  const workspaceName = path.basename(realRoot) || 'workspace';

  const assets: WorkspaceAssetEntry[] = [];
  const seenRealPaths = new Set<string>();
  let skippedSymlinks = 0;
  let skippedSensitive = 0;
  let mcpLiteralEnvCount = 0;

  const isInsideWorkspace = (realCandidate: string): boolean =>
    realCandidate === realRoot || realCandidate.startsWith(rootPrefix);

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
        realPath = fs.realpathSync(candidatePath);
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
        realPath = fs.realpathSync(candidatePath);
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
      const mcpInfo = summarizeMcpConfigSafe(text);
      if (mcpInfo) {
        mcpLiteralEnvCount += mcpInfo.envKeyCount;
        meta = {
          serverCount: mcpInfo.serverCount,
          serverNames: mcpInfo.serverNames,
          literalEnvEntries: mcpInfo.envKeyCount,
        };
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

  // 1. Direct well-known root files
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
    { rel: 'hooks.json', kind: 'hooks' },
    { rel: 'hooks/hooks.json', kind: 'hooks' },
  ];

  for (const item of fixedCandidates) {
    inspectFile(path.join(realRoot, item.rel), item.kind);
  }

  // 2. Recursive scanner for skills/**/SKILL.md and .agents/**/*
  const walkBounded = (
    relBaseDir: string,
    maxDepth: number,
    onFile: (fullPath: string, entryName: string) => void,
  ) => {
    const startDir = path.join(realRoot, relBaseDir);
    if (!fs.existsSync(startDir)) return;

    let realStart: string;
    try {
      realStart = fs.realpathSync(startDir);
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
            realSub = fs.realpathSync(full);
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
    const ext = path.extname(entryName).toLowerCase();
    if (ALLOWED_AGENT_CONFIG_EXTS.has(ext)) {
      inspectFile(fullPath, 'agent-config');
    }
  });

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

  const storage = auditStorageReadOnly(rootDataDir);
  const recommendations: AuditRecommendation[] = [];
  let penalty = 0;

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

  if (storage.totalBytes > 50 * 1024 * 1024) {
    penalty += 10;
    recommendations.push({
      level: 'info',
      code: 'ops.storage-growth',
      title: 'Local agy-NOV storage exceeds 50 MiB',
      detail: `Current data directory size is ${(storage.totalBytes / (1024 * 1024)).toFixed(1)} MiB across ${storage.totalFiles} files. Consider pruning old snapshots or completed sessions.`,
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
    healthScore: Math.max(20, 100 - penalty),
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
  };
}

export function createDemoOpsAuditReport(workspaceRoot: string): WorkspaceAuditReport {
  const workspaceName = path.basename(path.resolve(workspaceRoot)) || 'agy-NOV';
  const assets: WorkspaceAssetEntry[] = [
    {
      relPath: 'AGENTS.md',
      kind: 'rules',
      bytes: 2840,
      chars: 2620,
      estimatedTokens: 655,
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
    healthScore: 96,
    summary: {
      assetCount: assets.length,
      totalBytes: 6460,
      totalChars: 6120,
      totalEstimatedTokens: 1530,
      skippedSymlinks: 0,
      skippedSensitive: 0,
      byKind: {
        rules: { count: 1, estimatedTokens: 655 },
        skill: { count: 1, estimatedTokens: 460 },
        manifest: { count: 1, estimatedTokens: 180 },
        mcp: { count: 0, estimatedTokens: 0 },
        hooks: { count: 1, estimatedTokens: 235 },
        'agent-config': { count: 0, estimatedTokens: 0 },
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
        title: 'Workspace asset footprint looks healthy',
        detail: 'Scanned 4 asset(s) (~1,530 tokens) with compact startup overhead and zero boundary issues.',
      },
    ],
  };
}
