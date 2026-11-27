export const MODULE_IDS = ['review', 'guard', 'xray', 'canvas', 'mem', 'remote'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export const PRESET_IDS = ['core', 'local-all', 'full', 'minimal'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export interface ModuleMetadata {
  id: ModuleId;
  name: string;
  shortLabel: string;
  tagline: string;
  description: string;
  networkAccess: 'offline' | 'opt-in-network';
  defaultEnabled: boolean;
  hooks: Array<'SessionStart' | 'PreToolUse' | 'PostToolUse' | 'Stop'>;
  modelToolNames: string[];
}

export const MODULE_CATALOG: Record<ModuleId, ModuleMetadata> = {
  review: {
    id: 'review',
    name: 'Diff Review',
    shortLabel: 'Review',
    tagline: 'PR-grade inline diff review & line annotations',
    description:
      'Review working-tree, staged, or commit diffs line by line, drop categorized comments, and send pinpoint file:line fix prompts back to the agent.',
    networkAccess: 'offline',
    defaultEnabled: true,
    hooks: ['PostToolUse', 'Stop'],
    modelToolNames: ['review_open', 'review_get_summary'],
  },
  guard: {
    id: 'guard',
    name: 'Guard & Snapshots',
    shortLabel: 'Guard',
    tagline: 'Secret leak shield, command firewall & pre-edit snapshots',
    description:
      'Blocks .env/SSH/credential leaks and destructive commands before execution, snapshots files prior to edits without touching Git, and restores in one click.',
    networkAccess: 'offline',
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
    name: 'Context X-Ray',
    shortLabel: 'X-Ray',
    tagline: 'Token breakdown, live file tree & cross-session search',
    description:
      'Inspect real cached vs. fresh tokens per turn, identify token-heavy tools, open touched workspace files in one click, and search past sessions with EN+CJK BM25.',
    networkAccess: 'offline',
    defaultEnabled: true,
    hooks: ['PostToolUse', 'Stop'],
    modelToolNames: [
      'xray_analyze_context',
      'xray_get_file_activity',
      'xray_search_sessions',
      'xray_export_brief',
    ],
  },
  canvas: {
    id: 'canvas',
    name: 'Visual Canvas',
    shortLabel: 'Canvas',
    tagline: 'HTML/SVG/Slides/Markdown visual preview & pin annotations',
    description:
      'Render web mockups, SVG diagrams, slide decks, Markdown specs, and images in an isolated sandbox, drop numbered visual pins, and send edits back to the agent.',
    networkAccess: 'offline',
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
    name: 'Memory Graph',
    shortLabel: 'Memory',
    tagline: 'Code-anchored long-term memory with drift detection',
    description:
      'Capture architectural decisions anchored to SHA-256 file hashes, auto-recall relevant context at SessionStart, and flag stale memories when code changes.',
    networkAccess: 'offline',
    defaultEnabled: false,
    hooks: ['SessionStart', 'Stop'],
    modelToolNames: ['mem_remember', 'mem_recall', 'mem_forget'],
  },
  remote: {
    id: 'remote',
    name: 'Mobile & IM Remote',
    shortLabel: 'Remote',
    tagline: 'Opt-in Mobile PWA & IM remote alerts / risky approvals',
    description:
      'Strictly OFF by default (zero ports, zero outbound requests). When enabled, pairs your phone PWA or Telegram/Feishu/DingTalk/WeCom/Slack/Discord webhooks for task alerts and approvals.',
    networkAccess: 'opt-in-network',
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

export const PRESET_DEFINITIONS: Record<
  PresetId,
  { id: PresetId; label: string; description: string; modules: Record<ModuleId, boolean> }
> = {
  core: {
    id: 'core',
    label: 'Core (Default)',
    description: 'Review + Guard + X-Ray — 100% offline local essentials with low token footprint.',
    modules: { review: true, guard: true, xray: true, canvas: false, mem: false, remote: false },
  },
  'local-all': {
    id: 'local-all',
    label: 'Local All (5 Offline)',
    description: 'All 5 local modules enabled; Remote stays completely off with zero network activity.',
    modules: { review: true, guard: true, xray: true, canvas: true, mem: true, remote: false },
  },
  full: {
    id: 'full',
    label: 'Full Suite (6 Modules)',
    description: 'All 6 modules including the opt-in Mobile PWA / IM remote approval hub.',
    modules: { review: true, guard: true, xray: true, canvas: true, mem: true, remote: true },
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal Shield',
    description: 'Guard only — secret shield & pre-edit snapshots with minimum model tool overhead.',
    modules: { review: false, guard: true, xray: false, canvas: false, mem: false, remote: false },
  },
};

export interface NovConfig {
  schemaVersion: 1;
  preset: PresetId | 'custom';
  modules: Record<ModuleId, boolean>;
  defaultTab: ModuleId;
  updatedAt: string;
}

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === 'string' && (MODULE_IDS as readonly string[]).includes(value);
}

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === 'string' && (PRESET_IDS as readonly string[]).includes(value);
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
