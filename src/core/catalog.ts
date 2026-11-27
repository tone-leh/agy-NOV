export const MODULE_IDS = [
  'review',
  'guard',
  'xray',
  'turbo',
  'radar',
  'verify',
  'worktree',
  'spec',
  'studio',
  'canvas',
  'mem',
  'ops',
  'remote',
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export const MODULE_CATEGORY_IDS = [
  'core-dev',
  'safety',
  'observability',
  'workspace',
  'connectivity',
] as const;
export type ModuleCategoryId = (typeof MODULE_CATEGORY_IDS)[number];

export const PRESET_IDS = ['core', 'power', 'local-all', 'full', 'minimal'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const UI_LOCALE_IDS = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de'] as const;
export type ResolvedUiLocale = (typeof UI_LOCALE_IDS)[number];

export const LOCALE_IDS = ['auto', ...UI_LOCALE_IDS] as const;
export type NovLocale = (typeof LOCALE_IDS)[number];

export const LOCALE_NATIVE_LABELS: Record<ResolvedUiLocale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
};

export type IsolationTier = 'offline' | 'opt-in-network';

export interface ModuleMetadata {
  id: ModuleId;
  category: ModuleCategoryId;
  name: string;
  shortLabel: string;
  tagline: string;
  description: string;
  isolationTier: IsolationTier;
  networkAccess: 'offline' | 'opt-in-network';
  uiMode: 'full-height' | 'scroll';
  hasUiTab: boolean;
  defaultEnabled: boolean;
  hooks: Array<'SessionStart' | 'PreToolUse' | 'PostToolUse' | 'Stop'>;
  modelToolNames: string[];
}

export const MODULE_CATEGORY_META: Record<
  ModuleCategoryId,
  { id: ModuleCategoryId; label: string; description: string }
> = {
  'core-dev': {
    id: 'core-dev',
    label: 'Code & Speed',
    description: 'PR-grade diff review and token-saving batch codebase tools.',
  },
  safety: {
    id: 'safety',
    label: 'Safety Shield',
    description: 'Pre-tool secret leak firewall, command guard, and zero-Git edit snapshots.',
  },
  observability: {
    id: 'observability',
    label: 'Context & Radar',
    description: 'Token/cache X-Ray, cross-session search, and multi-session completion radar.',
  },
  workspace: {
    id: 'workspace',
    label: 'Canvas, Memory & Ops',
    description: 'Visual annotation canvas, code-anchored memory graph, prompt vault & doctor.',
  },
  connectivity: {
    id: 'connectivity',
    label: 'Opt-In Remote',
    description: 'Strictly OFF by default: local mobile PWA and IM webhook alerts / approvals.',
  },
};

export const MODULE_CATALOG: Record<ModuleId, ModuleMetadata> = {
  review: {
    id: 'review',
    category: 'core-dev',
    name: 'Diff Review',
    shortLabel: 'Review',
    tagline: 'PR-grade inline diff review & line annotations',
    description:
      'Review working-tree, staged, or commit diffs line by line, drop categorized comments, and send pinpoint file:line fix prompts back to the agent.',
    isolationTier: 'offline',
    networkAccess: 'offline',
    uiMode: 'full-height',
    hasUiTab: true,
    defaultEnabled: true,
    hooks: ['PostToolUse', 'Stop'],
    modelToolNames: ['review_open', 'review_get_summary'],
  },
  guard: {
    id: 'guard',
    category: 'safety',
    name: 'Guard & Snapshots',
    shortLabel: 'Guard',
    tagline: 'Secret leak shield, command firewall & pre-edit snapshots',
    description:
      'Blocks .env/SSH/credential leaks and destructive commands before execution, snapshots files prior to edits without touching Git, and restores in one click.',
    isolationTier: 'offline',
    networkAccess: 'offline',
    uiMode: 'scroll',
    hasUiTab: true,
    defaultEnabled: true,
    hooks: ['PreToolUse'],
    modelToolNames: [
      'guard_status',
      'guard_list_snapshots',
      'guard_create_checkpoint',
      'guard_scan_secrets',
    ],
  },
  xray: {
    id: 'xray',
    category: 'observability',
    name: 'Context X-Ray',
    shortLabel: 'X-Ray',
    tagline: 'Token & cache breakdown, live file tree & cross-session search',
    description:
      'Inspect real cached vs. fresh tokens per turn, diagnose cache misses and token-heavy tools, open touched files in one click, and search past sessions with EN+CJK BM25.',
    isolationTier: 'offline',
    networkAccess: 'offline',
    uiMode: 'scroll',
    hasUiTab: true,
    defaultEnabled: true,
    hooks: ['PostToolUse', 'Stop'],
    modelToolNames: [
      'xray_analyze_context',
      'xray_get_file_activity',
      'xray_search_sessions',
      'xray_export_brief',
    ],
  },
  turbo: {
    id: 'turbo',
    category: 'core-dev',
    name: 'Turbo & Output Guard',
    shortLabel: 'Turbo',
    tagline: 'Batch codebase search, outline slices & RTK-style output compression',
    description:
      'Cut wasted turns and context bloat with multi-pattern workspace search, symbol outline slicing, and RTK-style smart compression presets (test/build/git/auto) for oversized logs.',
    isolationTier: 'offline',
    networkAccess: 'offline',
    uiMode: 'scroll',
    hasUiTab: true,
    defaultEnabled: false,
    hooks: ['SessionStart'],
    modelToolNames: ['turbo_batch_search', 'turbo_read_outline', 'turbo_compact_output'],
  },
  radar: {
    id: 'radar',
    category: 'observability',
    name: 'Session Radar & Chime',
    shortLabel: 'Radar',
    tagline: 'Multi-session attention board, Swarm subagent monitor & completion alerts',
    description:
      'Track parallel conversations and Swarm subagents across Running, Awaiting Approval, Completed, and Stalled states via lifecycle hooks, with orphan alerts and optional chime.',
    isolationTier: 'offline',
    networkAccess: 'offline',
    uiMode: 'scroll',
    hasUiTab: true,
    defaultEnabled: false,
    hooks: ['PreToolUse', 'PostToolUse', 'Stop'],
    modelToolNames: ['radar_get_board', 'radar_ack_session'],
  },
  verify: {
    id: 'verify',
    category: 'safety',
    name: 'Verify Gate',
    shortLabel: 'Verify',
    tagline: 'Stop-hook verification gate blocking unverified "done" claims',
    description:
      'Enforce real test/typecheck/lint exit codes and non-empty file checks on Stop hooks (respecting continuation_active and loop guardrails), storing a redacted evidence chain per turn.',
    isolationTier: 'offline',
    networkAccess: 'offline',
    uiMode: 'scroll',
    hasUiTab: true,
    defaultEnabled: false,
    hooks: ['PostToolUse', 'Stop'],
    modelToolNames: [
      'verify_get_policy',
      'verify_set_policy',
      'verify_run_checks',
      'verify_get_evidence',
    ],
  },
  worktree: {
    id: 'worktree',
    category: 'core-dev',
    name: 'Worktree Orchestrator',
    shortLabel: 'Worktree',
    tagline: 'Safe parallel Git worktrees, branch diff previews & orphan cleanup',
    description:
      'Create isolated Git worktrees with optional uncommitted-change carry-over, inspect branch diff summaries, flag extensions.worktreeConfig hazards, and safely prune merged or orphaned worktrees.',
    isolationTier: 'offline',
    networkAccess: 'offline',
    uiMode: 'scroll',
    hasUiTab: true,
    defaultEnabled: false,
    hooks: [],
    modelToolNames: [
      'worktree_list',
      'worktree_create',
      'worktree_diff_summary',
      'worktree_cleanup',
    ],
  },
  spec: {
    id: 'spec',
    category: 'workspace',
    name: 'Spec Flow & Task DAG',
    shortLabel: 'Spec',
    tagline: 'Spec-driven development, dependency task DAG & pre-approval write lock',
    description:
      'Maintain structured Spec -> Plan -> Task DAG workflows with cycle detection, SessionStart next-task recall, and a PreToolUse write gate that keeps code read-only until the spec is approved.',
    isolationTier: 'offline',
    networkAccess: 'offline',
    uiMode: 'scroll',
    hasUiTab: true,
    defaultEnabled: false,
    hooks: ['SessionStart', 'PreToolUse'],
    modelToolNames: [
      'spec_get_state',
      'spec_create_or_update',
      'spec_approve',
      'spec_update_task',
    ],
  },
  studio: {
    id: 'studio',
    category: 'workspace',
    name: 'Workspace Studio',
    shortLabel: 'Studio',
    tagline: 'On-demand SQLite/CSV/JSON data viewer, DOCX/XLSX/PDF slicer & loopback HTTP probe',
    description:
      'Inspect local SQLite/CSV/JSON datasets, slice DOCX/XLSX/PDF/Markdown documents offline without external binaries, and probe localhost/127.0.0.1 APIs — toggle off for zero tool budget tax.',
    isolationTier: 'offline',
    networkAccess: 'offline',
    uiMode: 'scroll',
    hasUiTab: true,
    defaultEnabled: false,
    hooks: [],
    modelToolNames: [
      'studio_list_sources',
      'studio_inspect_data',
      'studio_inspect_document',
      'studio_http_probe',
    ],
  },
  canvas: {
    id: 'canvas',
    category: 'workspace',
    name: 'Visual Canvas',
    shortLabel: 'Canvas',
    tagline: 'HTML/SVG/Slides/Markdown visual preview & pin annotations',
    description:
      'Render web mockups, SVG diagrams, slide decks, Markdown specs, and images in an isolated sandbox, drop numbered visual pins, and send edits back to the agent.',
    isolationTier: 'offline',
    networkAccess: 'offline',
    uiMode: 'full-height',
    hasUiTab: true,
    defaultEnabled: false,
    hooks: [],
    modelToolNames: [
      'canvas_publish_artifact',
      'canvas_open_file',
      'canvas_get_feedback',
      'canvas_resolve_annotations',
    ],
  },
  mem: {
    id: 'mem',
    category: 'workspace',
    name: 'Memory Graph',
    shortLabel: 'Memory',
    tagline: 'Code-anchored long-term memory with drift detection',
    description:
      'Capture architectural decisions anchored to SHA-256 file hashes, auto-recall relevant context at SessionStart, and flag stale memories when code changes.',
    isolationTier: 'offline',
    networkAccess: 'offline',
    uiMode: 'scroll',
    hasUiTab: true,
    defaultEnabled: false,
    hooks: ['SessionStart', 'Stop'],
    modelToolNames: ['mem_remember', 'mem_recall', 'mem_forget'],
  },
  ops: {
    id: 'ops',
    category: 'workspace',
    name: 'Prompt Vault & Budget Doctor',
    shortLabel: 'Ops',
    tagline: 'Parameterized prompt vault, 24KB/20K rule bloat & 100-tool budget doctor',
    description:
      'Manage reusable {{var}} prompt templates, audit workspace rules for 24KB/20K bloat that triggers false 429s, track the 100-tool MCP budget, and verify local storage hygiene.',
    isolationTier: 'offline',
    networkAccess: 'offline',
    uiMode: 'scroll',
    hasUiTab: true,
    defaultEnabled: false,
    hooks: [],
    modelToolNames: ['ops_list_prompts', 'ops_render_prompt', 'ops_audit_workspace'],
  },
  remote: {
    id: 'remote',
    category: 'connectivity',
    name: 'Mobile & IM Remote',
    shortLabel: 'Remote',
    tagline: 'Opt-in Mobile PWA & IM remote alerts / risky approvals',
    description:
      'Strictly OFF by default (zero ports, zero outbound requests). When enabled, pairs your phone PWA or Telegram/Feishu/DingTalk/WeCom/Slack/Discord webhooks for task alerts and approvals.',
    isolationTier: 'opt-in-network',
    networkAccess: 'opt-in-network',
    uiMode: 'scroll',
    hasUiTab: true,
    defaultEnabled: false,
    hooks: ['PreToolUse', 'Stop'],
    modelToolNames: [
      'remote_status',
      'remote_send_alert',
      'remote_list_conversations',
      'remote_dispatch_task',
    ],
  },
};

function makeModulesMap(enabled: readonly ModuleId[]): Record<ModuleId, boolean> {
  const set = new Set<ModuleId>(enabled);
  const out = {} as Record<ModuleId, boolean>;
  for (const id of MODULE_IDS) {
    out[id] = set.has(id);
  }
  return out;
}

export const OFFLINE_NATIVE_MODULE_IDS: readonly ModuleId[] = MODULE_IDS.filter(
  (id) => MODULE_CATALOG[id].isolationTier === 'offline',
);

export const PRESET_DEFINITIONS: Record<
  PresetId,
  {
    id: PresetId;
    label: string;
    description: string;
    enabledModules: readonly ModuleId[];
    modules: Record<ModuleId, boolean>;
  }
> = {
  core: {
    id: 'core',
    label: 'Core (Default)',
    description: 'Review + Guard + X-Ray — 100% offline local essentials with low token footprint (12 model tools).',
    enabledModules: ['review', 'guard', 'xray'],
    modules: makeModulesMap(['review', 'guard', 'xray']),
  },
  power: {
    id: 'power',
    label: 'Power Dev (9 Offline)',
    description:
      'Core + Turbo + Radar + Verify + Worktree + Spec + Ops — complete spec-to-verify offline engineering workflow with zero network usage (32 model tools).',
    enabledModules: [
      'review',
      'guard',
      'xray',
      'turbo',
      'radar',
      'verify',
      'worktree',
      'spec',
      'ops',
    ],
    modules: makeModulesMap([
      'review',
      'guard',
      'xray',
      'turbo',
      'radar',
      'verify',
      'worktree',
      'spec',
      'ops',
    ]),
  },
  'local-all': {
    id: 'local-all',
    label: 'Local All (12 Offline)',
    description:
      'All 12 native offline modules enabled including Workspace Studio; Remote stays strictly off with zero ports (43 model tools).',
    enabledModules: [
      'review',
      'guard',
      'xray',
      'turbo',
      'radar',
      'verify',
      'worktree',
      'spec',
      'studio',
      'canvas',
      'mem',
      'ops',
    ],
    modules: makeModulesMap([
      'review',
      'guard',
      'xray',
      'turbo',
      'radar',
      'verify',
      'worktree',
      'spec',
      'studio',
      'canvas',
      'mem',
      'ops',
    ]),
  },
  full: {
    id: 'full',
    label: 'Full Suite (All 13)',
    description:
      'All 13 native modules including the opt-in Mobile PWA & IM remote approval hub (47 model tools).',
    enabledModules: [...MODULE_IDS],
    modules: makeModulesMap(MODULE_IDS),
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal Shield',
    description: 'Guard only — secret shield & pre-edit snapshots with minimum model tool overhead (6 tools).',
    enabledModules: ['guard'],
    modules: makeModulesMap(['guard']),
  },
};

export interface NovConfig {
  schemaVersion: 1;
  preset: PresetId | 'custom';
  modules: Record<ModuleId, boolean>;
  defaultTab: ModuleId;
  locale: NovLocale;
  updatedAt: string;
}

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === 'string' && (MODULE_IDS as readonly string[]).includes(value);
}

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === 'string' && (PRESET_IDS as readonly string[]).includes(value);
}

export function isNovLocale(value: unknown): value is NovLocale {
  return typeof value === 'string' && (LOCALE_IDS as readonly string[]).includes(value);
}

export function countEnabledModelTools(modules: Record<ModuleId, boolean>): number {
  let count = 2; // nov_open + nov_status
  for (const id of MODULE_IDS) {
    if (modules[id]) {
      count += MODULE_CATALOG[id].modelToolNames.length;
    }
  }
  return count;
}
