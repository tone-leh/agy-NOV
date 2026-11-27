"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/server/cli.ts
var cli_exports = {};
module.exports = __toCommonJS(cli_exports);
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);

// src/core/config.ts
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path = __toESM(require("node:path"), 1);

// src/core/catalog.ts
var MODULE_IDS = [
  "review",
  "guard",
  "xray",
  "turbo",
  "radar",
  "verify",
  "worktree",
  "spec",
  "studio",
  "canvas",
  "mem",
  "ops",
  "remote"
];
var MODULE_CATEGORY_IDS = [
  "core-dev",
  "safety",
  "observability",
  "workspace",
  "connectivity"
];
var PRESET_IDS = ["core", "power", "local-all", "full", "minimal"];
var UI_LOCALE_IDS = ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de"];
var LOCALE_IDS = ["auto", ...UI_LOCALE_IDS];
var MODULE_CATEGORY_META = {
  "core-dev": {
    id: "core-dev",
    label: "Code & Speed",
    description: "PR-grade diff review and token-saving batch codebase tools."
  },
  safety: {
    id: "safety",
    label: "Safety Shield",
    description: "Pre-tool secret leak firewall, command guard, and zero-Git edit snapshots."
  },
  observability: {
    id: "observability",
    label: "Context & Radar",
    description: "Token/cache X-Ray, cross-session search, and multi-session completion radar."
  },
  workspace: {
    id: "workspace",
    label: "Canvas, Memory & Ops",
    description: "Visual annotation canvas, code-anchored memory graph, prompt vault & doctor."
  },
  connectivity: {
    id: "connectivity",
    label: "Opt-In Remote",
    description: "Strictly OFF by default: local mobile PWA and IM webhook alerts / approvals."
  }
};
var MODULE_CATALOG = {
  review: {
    id: "review",
    category: "core-dev",
    name: "Diff Review",
    shortLabel: "Review",
    tagline: "PR-grade inline diff review & line annotations",
    description: "Review working-tree, staged, or commit diffs line by line, drop categorized comments, and send pinpoint file:line fix prompts back to the agent.",
    isolationTier: "offline",
    networkAccess: "offline",
    uiMode: "full-height",
    hasUiTab: true,
    defaultEnabled: true,
    hooks: ["PostToolUse", "Stop"],
    modelToolNames: ["review_open", "review_get_summary"]
  },
  guard: {
    id: "guard",
    category: "safety",
    name: "Guard & Snapshots",
    shortLabel: "Guard",
    tagline: "Secret leak shield, command firewall & pre-edit snapshots",
    description: "Blocks .env/SSH/credential leaks and destructive commands before execution, snapshots files prior to edits without touching Git, and restores in one click.",
    isolationTier: "offline",
    networkAccess: "offline",
    uiMode: "scroll",
    hasUiTab: true,
    defaultEnabled: true,
    hooks: ["PreToolUse"],
    modelToolNames: [
      "guard_status",
      "guard_list_snapshots",
      "guard_create_checkpoint",
      "guard_scan_secrets"
    ]
  },
  xray: {
    id: "xray",
    category: "observability",
    name: "Context X-Ray",
    shortLabel: "X-Ray",
    tagline: "Token & cache breakdown, live file tree & cross-session search",
    description: "Inspect real cached vs. fresh tokens per turn, diagnose cache misses and token-heavy tools, open touched files in one click, and search past sessions with EN+CJK BM25.",
    isolationTier: "offline",
    networkAccess: "offline",
    uiMode: "scroll",
    hasUiTab: true,
    defaultEnabled: true,
    hooks: ["PostToolUse", "Stop"],
    modelToolNames: [
      "xray_analyze_context",
      "xray_get_file_activity",
      "xray_search_sessions",
      "xray_export_brief"
    ]
  },
  turbo: {
    id: "turbo",
    category: "core-dev",
    name: "Turbo & Output Guard",
    shortLabel: "Turbo",
    tagline: "Batch codebase search, outline slices & RTK-style output compression",
    description: "Cut wasted turns and context bloat with multi-pattern workspace search, symbol outline slicing, and RTK-style smart compression presets (test/build/git/auto) for oversized logs.",
    isolationTier: "offline",
    networkAccess: "offline",
    uiMode: "scroll",
    hasUiTab: true,
    defaultEnabled: false,
    hooks: ["SessionStart"],
    modelToolNames: ["turbo_batch_search", "turbo_read_outline", "turbo_compact_output"]
  },
  radar: {
    id: "radar",
    category: "observability",
    name: "Session Radar & Chime",
    shortLabel: "Radar",
    tagline: "Multi-session attention board, Swarm subagent monitor & completion alerts",
    description: "Track parallel conversations and Swarm subagents across Running, Awaiting Approval, Completed, and Stalled states via lifecycle hooks, with orphan alerts and optional chime.",
    isolationTier: "offline",
    networkAccess: "offline",
    uiMode: "scroll",
    hasUiTab: true,
    defaultEnabled: false,
    hooks: ["PreToolUse", "PostToolUse", "Stop"],
    modelToolNames: ["radar_get_board", "radar_ack_session"]
  },
  verify: {
    id: "verify",
    category: "safety",
    name: "Verify Gate",
    shortLabel: "Verify",
    tagline: 'Stop-hook verification gate blocking unverified "done" claims',
    description: "Enforce real test/typecheck/lint exit codes and non-empty file checks on Stop hooks (respecting continuation_active and loop guardrails), storing a redacted evidence chain per turn.",
    isolationTier: "offline",
    networkAccess: "offline",
    uiMode: "scroll",
    hasUiTab: true,
    defaultEnabled: false,
    hooks: ["PostToolUse", "Stop"],
    modelToolNames: [
      "verify_get_policy",
      "verify_set_policy",
      "verify_run_checks",
      "verify_get_evidence"
    ]
  },
  worktree: {
    id: "worktree",
    category: "core-dev",
    name: "Worktree Orchestrator",
    shortLabel: "Worktree",
    tagline: "Safe parallel Git worktrees, branch diff previews & orphan cleanup",
    description: "Create isolated Git worktrees with optional uncommitted-change carry-over, inspect branch diff summaries, flag extensions.worktreeConfig hazards, and safely prune merged or orphaned worktrees.",
    isolationTier: "offline",
    networkAccess: "offline",
    uiMode: "scroll",
    hasUiTab: true,
    defaultEnabled: false,
    hooks: [],
    modelToolNames: [
      "worktree_list",
      "worktree_create",
      "worktree_diff_summary",
      "worktree_cleanup"
    ]
  },
  spec: {
    id: "spec",
    category: "workspace",
    name: "Spec Flow & Task DAG",
    shortLabel: "Spec",
    tagline: "Spec-driven development, dependency task DAG & pre-approval write lock",
    description: "Maintain structured Spec -> Plan -> Task DAG workflows with cycle detection, SessionStart next-task recall, and a PreToolUse write gate that keeps code read-only until the spec is approved.",
    isolationTier: "offline",
    networkAccess: "offline",
    uiMode: "scroll",
    hasUiTab: true,
    defaultEnabled: false,
    hooks: ["SessionStart", "PreToolUse"],
    modelToolNames: [
      "spec_get_state",
      "spec_create_or_update",
      "spec_approve",
      "spec_update_task"
    ]
  },
  studio: {
    id: "studio",
    category: "workspace",
    name: "Workspace Studio",
    shortLabel: "Studio",
    tagline: "On-demand SQLite/CSV/JSON data viewer, DOCX/XLSX/PDF slicer & loopback HTTP probe",
    description: "Inspect local SQLite/CSV/JSON datasets, slice DOCX/XLSX/PDF/Markdown documents offline without external binaries, and probe localhost/127.0.0.1 APIs \u2014 toggle off for zero tool budget tax.",
    isolationTier: "offline",
    networkAccess: "offline",
    uiMode: "scroll",
    hasUiTab: true,
    defaultEnabled: false,
    hooks: [],
    modelToolNames: [
      "studio_list_sources",
      "studio_inspect_data",
      "studio_inspect_document",
      "studio_http_probe"
    ]
  },
  canvas: {
    id: "canvas",
    category: "workspace",
    name: "Visual Canvas",
    shortLabel: "Canvas",
    tagline: "HTML/SVG/Slides/Markdown visual preview & pin annotations",
    description: "Render web mockups, SVG diagrams, slide decks, Markdown specs, and images in an isolated sandbox, drop numbered visual pins, and send edits back to the agent.",
    isolationTier: "offline",
    networkAccess: "offline",
    uiMode: "full-height",
    hasUiTab: true,
    defaultEnabled: false,
    hooks: [],
    modelToolNames: [
      "canvas_publish_artifact",
      "canvas_open_file",
      "canvas_get_feedback",
      "canvas_resolve_annotations"
    ]
  },
  mem: {
    id: "mem",
    category: "workspace",
    name: "Memory Graph",
    shortLabel: "Memory",
    tagline: "Code-anchored long-term memory with drift detection",
    description: "Capture architectural decisions anchored to SHA-256 file hashes, auto-recall relevant context at SessionStart, and flag stale memories when code changes.",
    isolationTier: "offline",
    networkAccess: "offline",
    uiMode: "scroll",
    hasUiTab: true,
    defaultEnabled: false,
    hooks: ["SessionStart", "Stop"],
    modelToolNames: ["mem_remember", "mem_recall", "mem_forget"]
  },
  ops: {
    id: "ops",
    category: "workspace",
    name: "Prompt Vault & Budget Doctor",
    shortLabel: "Ops",
    tagline: "Parameterized prompt vault, 24KB/20K rule bloat & 100-tool budget doctor",
    description: "Manage reusable {{var}} prompt templates, audit workspace rules for 24KB/20K bloat that triggers false 429s, track the 100-tool MCP budget, and verify local storage hygiene.",
    isolationTier: "offline",
    networkAccess: "offline",
    uiMode: "scroll",
    hasUiTab: true,
    defaultEnabled: false,
    hooks: [],
    modelToolNames: ["ops_list_prompts", "ops_render_prompt", "ops_audit_workspace"]
  },
  remote: {
    id: "remote",
    category: "connectivity",
    name: "Mobile & IM Remote",
    shortLabel: "Remote",
    tagline: "Opt-in Mobile PWA & IM remote alerts / risky approvals",
    description: "Strictly OFF by default (zero ports, zero outbound requests). When enabled, pairs your phone PWA or Telegram/Feishu/DingTalk/WeCom/Slack/Discord webhooks for task alerts and approvals.",
    isolationTier: "opt-in-network",
    networkAccess: "opt-in-network",
    uiMode: "scroll",
    hasUiTab: true,
    defaultEnabled: false,
    hooks: ["PreToolUse", "Stop"],
    modelToolNames: [
      "remote_status",
      "remote_send_alert",
      "remote_list_conversations",
      "remote_dispatch_task"
    ]
  }
};
function makeModulesMap(enabled) {
  const set = new Set(enabled);
  const out = {};
  for (const id of MODULE_IDS) {
    out[id] = set.has(id);
  }
  return out;
}
var OFFLINE_NATIVE_MODULE_IDS = MODULE_IDS.filter(
  (id) => MODULE_CATALOG[id].isolationTier === "offline"
);
var PRESET_DEFINITIONS = {
  core: {
    id: "core",
    label: "Core (Default)",
    description: "Review + Guard + X-Ray \u2014 100% offline local essentials with low token footprint (12 model tools).",
    enabledModules: ["review", "guard", "xray"],
    modules: makeModulesMap(["review", "guard", "xray"])
  },
  power: {
    id: "power",
    label: "Power Dev (9 Offline)",
    description: "Core + Turbo + Radar + Verify + Worktree + Spec + Ops \u2014 complete spec-to-verify offline engineering workflow with zero network usage (32 model tools).",
    enabledModules: [
      "review",
      "guard",
      "xray",
      "turbo",
      "radar",
      "verify",
      "worktree",
      "spec",
      "ops"
    ],
    modules: makeModulesMap([
      "review",
      "guard",
      "xray",
      "turbo",
      "radar",
      "verify",
      "worktree",
      "spec",
      "ops"
    ])
  },
  "local-all": {
    id: "local-all",
    label: "Local All (12 Offline)",
    description: "All 12 native offline modules enabled including Workspace Studio; Remote stays strictly off with zero ports (43 model tools).",
    enabledModules: [
      "review",
      "guard",
      "xray",
      "turbo",
      "radar",
      "verify",
      "worktree",
      "spec",
      "studio",
      "canvas",
      "mem",
      "ops"
    ],
    modules: makeModulesMap([
      "review",
      "guard",
      "xray",
      "turbo",
      "radar",
      "verify",
      "worktree",
      "spec",
      "studio",
      "canvas",
      "mem",
      "ops"
    ])
  },
  full: {
    id: "full",
    label: "Full Suite (All 13)",
    description: "All 13 native modules including the opt-in Mobile PWA & IM remote approval hub (47 model tools).",
    enabledModules: [...MODULE_IDS],
    modules: makeModulesMap(MODULE_IDS)
  },
  minimal: {
    id: "minimal",
    label: "Minimal Shield",
    description: "Guard only \u2014 secret shield & pre-edit snapshots with minimum model tool overhead (6 tools).",
    enabledModules: ["guard"],
    modules: makeModulesMap(["guard"])
  }
};
function isModuleId(value) {
  return typeof value === "string" && MODULE_IDS.includes(value);
}
function isPresetId(value) {
  return typeof value === "string" && PRESET_IDS.includes(value);
}
function isNovLocale(value) {
  return typeof value === "string" && LOCALE_IDS.includes(value);
}
function countEnabledModelTools(modules) {
  let count = 2;
  for (const id of MODULE_IDS) {
    if (modules[id]) {
      count += MODULE_CATALOG[id].modelToolNames.length;
    }
  }
  return count;
}

// src/core/config.ts
function sanitizeDataDirCandidate(candidate) {
  if (!candidate) return void 0;
  const trimmed = candidate.trim();
  if (!trimmed) return void 0;
  if (/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(trimmed)) return void 0;
  return import_node_path.default.resolve(trimmed);
}
function resolveNovDataDir(cliDataDir) {
  return sanitizeDataDirCandidate(cliDataDir) ?? sanitizeDataDirCandidate(process.env.AGY_NOV_DATA_DIR) ?? sanitizeDataDirCandidate(process.env.PLUGIN_DATA) ?? import_node_path.default.join(import_node_os.default.homedir(), ".agy-nov-data");
}
function getModuleDataDir(rootDataDir, moduleId) {
  return import_node_path.default.join(rootDataDir, "modules", moduleId);
}
function getConfigPath(rootDataDir) {
  return import_node_path.default.join(rootDataDir, "config.json");
}
function createDefaultConfig() {
  return {
    schemaVersion: 1,
    preset: "core",
    modules: { ...PRESET_DEFINITIONS.core.modules },
    defaultTab: "review",
    locale: "auto",
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function detectPreset(modules) {
  for (const id of PRESET_IDS) {
    const target = PRESET_DEFINITIONS[id].modules;
    if (MODULE_IDS.every((m) => Boolean(modules[m]) === Boolean(target[m]))) {
      return id;
    }
  }
  return "custom";
}
function normalizeConfig(raw) {
  const base = createDefaultConfig();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw;
  const rawMods = obj.modules && typeof obj.modules === "object" ? obj.modules : {};
  const modules = { ...base.modules };
  for (const id of MODULE_IDS) {
    if (typeof rawMods[id] === "boolean") {
      modules[id] = rawMods[id];
    }
  }
  const enabledTabList = MODULE_IDS.filter((id) => modules[id] && MODULE_CATALOG[id].hasUiTab);
  const defaultTab = isModuleId(obj.defaultTab) && modules[obj.defaultTab] && MODULE_CATALOG[obj.defaultTab].hasUiTab ? obj.defaultTab : enabledTabList[0] ?? "review";
  const locale = isNovLocale(obj.locale) ? obj.locale : "auto";
  return {
    schemaVersion: 1,
    preset: detectPreset(modules),
    modules,
    defaultTab,
    locale,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : base.updatedAt
  };
}
function loadNovConfigReadOnly(rootDataDir) {
  const cfgPath = getConfigPath(rootDataDir);
  if (!import_node_fs.default.existsSync(cfgPath)) {
    return createDefaultConfig();
  }
  try {
    const raw = JSON.parse(import_node_fs.default.readFileSync(cfgPath, "utf8"));
    return normalizeConfig(raw);
  } catch {
    return createDefaultConfig();
  }
}
function saveNovConfig(rootDataDir, config) {
  const normalized = normalizeConfig({
    ...config,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  import_node_fs.default.mkdirSync(rootDataDir, { recursive: true, mode: 448 });
  try {
    import_node_fs.default.chmodSync(rootDataDir, 448);
  } catch {
  }
  const cfgPath = getConfigPath(rootDataDir);
  const tmpPath = `${cfgPath}.tmp.${process.pid}.${Date.now()}`;
  import_node_fs.default.writeFileSync(tmpPath, `${JSON.stringify(normalized, null, 2)}
`, { mode: 384 });
  import_node_fs.default.renameSync(tmpPath, cfgPath);
  return normalized;
}
function loadOrInitNovConfig(rootDataDir) {
  const cfgPath = getConfigPath(rootDataDir);
  if (!import_node_fs.default.existsSync(cfgPath)) {
    return createDefaultConfig();
  }
  try {
    const raw = JSON.parse(import_node_fs.default.readFileSync(cfgPath, "utf8"));
    return normalizeConfig(raw);
  } catch {
    try {
      import_node_fs.default.renameSync(cfgPath, `${cfgPath}.corrupt.${Date.now()}`);
    } catch {
    }
    return saveNovConfig(rootDataDir, createDefaultConfig());
  }
}
function setModuleEnabled(rootDataDir, moduleId, enabled) {
  const current = loadOrInitNovConfig(rootDataDir);
  const nextModules = {
    ...current.modules,
    [moduleId]: enabled
  };
  return saveNovConfig(rootDataDir, {
    ...current,
    modules: nextModules,
    defaultTab: enabled && MODULE_CATALOG[moduleId].hasUiTab ? moduleId : current.defaultTab
  });
}
function applyPresetConfig(rootDataDir, preset) {
  const current = loadOrInitNovConfig(rootDataDir);
  const def = PRESET_DEFINITIONS[preset];
  return saveNovConfig(rootDataDir, {
    ...current,
    preset,
    modules: { ...def.modules },
    defaultTab: MODULE_IDS.find((id) => def.modules[id] && MODULE_CATALOG[id].hasUiTab) ?? "review"
  });
}
function setNovLocale(rootDataDir, locale) {
  const current = loadOrInitNovConfig(rootDataDir);
  return saveNovConfig(rootDataDir, {
    ...current,
    locale
  });
}

// src/core/utils.ts
function parseCliFlag(argv, flag) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === flag && i + 1 < argv.length) {
      return argv[i + 1];
    }
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return void 0;
}
function hasCliFlag(argv, flag) {
  return argv.includes(flag);
}

// src/server/cli.ts
var CLI_VERSION = "0.4.0";
function printHelp() {
  console.log(`agy-NOV CLI (v${CLI_VERSION}) \u2014 The 100% Native Modular Super-Workbench for Antigravity 2.0

Usage:
  agy-nov status [--data-dir=<dir>]                             Show enabled modules, preset, UI language & token footprint
  agy-nov enable <module> [--data-dir=<dir>]                    Enable a module (${MODULE_IDS.join(" | ")})
  agy-nov disable <module> [--data-dir=<dir>]                   Disable a module
  agy-nov preset <name> [--data-dir=<dir>]                      Apply preset (${PRESET_IDS.join(" | ")})
  agy-nov locale <lang> [--data-dir=<dir>]                      Set UI language (${LOCALE_IDS.join(" | ")})
  agy-nov statusline [--json] [--compact] [--data-dir=<dir>]    Zero-token read-only status line for Antigravity CLI
  agy-nov doctor [--data-dir=<dir>]                             Verify plugin bundle, manifests & config health (read-only)
`);
}
function readJsonSilent(filePath) {
  try {
    if (!import_node_fs2.default.existsSync(filePath)) return null;
    const raw = JSON.parse(import_node_fs2.default.readFileSync(filePath, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}
function buildStatusLine(dataDir, compact) {
  const cfg = loadNovConfigReadOnly(dataDir);
  const enabledCount = MODULE_IDS.filter((id) => cfg.modules[id]).length;
  const modelTools = countEnabledModelTools(cfg.modules);
  const network = cfg.modules.remote ? "opt-in-remote" : "offline";
  let verifySummary;
  if (cfg.modules.verify) {
    const verifyState = readJsonSilent(import_node_path2.default.join(getModuleDataDir(dataDir, "verify"), "state.json"));
    const rawEvidence = Array.isArray(verifyState?.evidence) ? verifyState.evidence : [];
    const validEvidence = rawEvidence.filter(
      (e) => Boolean(e) && typeof e === "object" && !Array.isArray(e)
    );
    const latest = validEvidence[0];
    let lastStatus = "idle";
    if (latest) {
      const outcome = typeof latest.outcome === "string" ? latest.outcome : "";
      if (outcome === "blocked" || latest.blocked === true) lastStatus = "blocked";
      else if (outcome === "pass" || outcome === "guardrail-allow" || latest.passed === true) {
        lastStatus = "pass";
      } else {
        lastStatus = "fail";
      }
    }
    const storedBlockedStops = typeof verifyState?.blockedStops === "number" && Number.isFinite(verifyState.blockedStops) ? Math.max(0, Math.floor(verifyState.blockedStops)) : 0;
    const countedBlocked = validEvidence.filter(
      (e) => e.outcome === "blocked" || e.blocked === true
    ).length;
    const blockedStops = Math.max(storedBlockedStops, countedBlocked);
    verifySummary = { enabled: true, lastStatus, blockedStops };
  }
  let specSummary;
  if (cfg.modules.spec) {
    const specState = readJsonSilent(import_node_path2.default.join(getModuleDataDir(dataDir, "spec"), "state.json"));
    const activeId = typeof specState?.activeSpecId === "string" ? specState.activeSpecId : void 0;
    let activeDoc;
    if (activeId && Array.isArray(specState?.specs)) {
      activeDoc = specState.specs.find(
        (s) => Boolean(s) && typeof s === "object" && !Array.isArray(s) && s.id === activeId
      );
    } else if (activeId && specState?.specs && typeof specState.specs === "object") {
      const candidate = specState.specs[activeId];
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        activeDoc = candidate;
      }
    }
    const tasks = Array.isArray(activeDoc?.tasks) ? activeDoc.tasks.filter(
      (t) => Boolean(t) && typeof t === "object" && !Array.isArray(t)
    ) : [];
    const doneTasks = tasks.filter((t) => t.status === "done").length;
    const status = typeof activeDoc?.status === "string" ? activeDoc.status : void 0;
    const writeLockActive = Boolean(
      activeDoc && status === "draft" && activeDoc.enforcePlanBeforeWrite === true
    );
    specSummary = {
      enabled: true,
      activeTitle: typeof activeDoc?.title === "string" ? activeDoc.title : void 0,
      status,
      writeLockActive,
      doneTasks,
      totalTasks: tasks.length
    };
  }
  let radarSummary;
  if (cfg.modules.radar) {
    const radarDir = getModuleDataDir(dataDir, "radar");
    const capsule = readJsonSilent(import_node_path2.default.join(radarDir, "status-capsule.json"));
    const counts = capsule && capsule.counts && typeof capsule.counts === "object" ? capsule.counts : null;
    if (counts) {
      radarSummary = {
        enabled: true,
        running: Number(counts.running ?? 0) || 0,
        awaitingApproval: Number(counts.awaiting_approval ?? 0) || 0,
        stalled: Number(counts.stalled ?? 0) || 0,
        error: Number(counts.error ?? 0) || 0,
        orphanSubagents: Number(counts.orphanSubagents ?? 0) || 0,
        unread: Number(counts.unread ?? 0) || 0
      };
    } else {
      const board = readJsonSilent(import_node_path2.default.join(radarDir, "board.json"));
      const sessionsRaw = board?.sessions;
      const list = sessionsRaw && typeof sessionsRaw === "object" && !Array.isArray(sessionsRaw) ? Object.values(sessionsRaw).filter(
        (s) => Boolean(s) && typeof s === "object" && !Array.isArray(s)
      ) : [];
      radarSummary = {
        enabled: true,
        running: list.filter((s) => s.status === "running").length,
        awaitingApproval: list.filter((s) => s.status === "awaiting_approval").length,
        stalled: 0,
        error: list.filter((s) => s.status === "error").length,
        orphanSubagents: 0,
        unread: list.filter((s) => s.unread === true).length
      };
    }
  }
  let xraySummary;
  if (cfg.modules.xray) {
    const live = readJsonSilent(import_node_path2.default.join(getModuleDataDir(dataDir, "xray"), "live-state.json"));
    xraySummary = {
      enabled: true,
      activeConversationId: typeof live?.activeConversationId === "string" ? live.activeConversationId : void 0,
      lastToolName: typeof live?.lastToolName === "string" ? live.lastToolName : void 0
    };
  }
  const parts = compact ? [`NOV ${enabledCount}/${MODULE_IDS.length} (${modelTools}t)`] : [
    `agy-NOV ${cfg.preset}`,
    `${enabledCount}/${MODULE_IDS.length} (${modelTools}t)`,
    network === "offline" ? "offline" : "remote:ON"
  ];
  if (verifySummary) {
    const tag = verifySummary.lastStatus === "pass" ? "PASS" : verifySummary.lastStatus === "blocked" ? "BLOCKED" : verifySummary.lastStatus === "fail" ? "FAIL" : "IDLE";
    parts.push(`Verify:${tag}`);
  }
  if (specSummary && specSummary.status) {
    const lockTag = specSummary.writeLockActive ? "LOCK" : specSummary.status.toUpperCase();
    parts.push(`Spec:${lockTag}(${specSummary.doneTasks}/${specSummary.totalTasks})`);
  }
  if (radarSummary) {
    const radarBits = [];
    if (radarSummary.running > 0) radarBits.push(`${radarSummary.running}run`);
    if (radarSummary.awaitingApproval > 0) radarBits.push(`${radarSummary.awaitingApproval}wait`);
    if (radarSummary.stalled > 0) radarBits.push(`${radarSummary.stalled}stall`);
    if (radarSummary.orphanSubagents > 0) radarBits.push(`${radarSummary.orphanSubagents}orphan`);
    if (radarSummary.error > 0) radarBits.push(`${radarSummary.error}err`);
    if (radarBits.length > 0) {
      parts.push(`Radar:${radarBits.join("/")}`);
    }
  }
  const line = parts.join(" \xB7 ");
  return {
    version: CLI_VERSION,
    preset: cfg.preset,
    enabledCount,
    totalModules: MODULE_IDS.length,
    modelTools,
    locale: cfg.locale,
    network,
    verify: verifySummary,
    spec: specSummary,
    radar: radarSummary,
    xray: xraySummary,
    line
  };
}
function printStatus(dataDir) {
  const cfg = loadNovConfigReadOnly(dataDir);
  const enabledCount = MODULE_IDS.filter((id) => cfg.modules[id]).length;
  const modelTools = countEnabledModelTools(cfg.modules);
  console.log(`agy-NOV v${CLI_VERSION} Status`);
  console.log(`  Architecture:   100% Native MCP Apps & Hooks (Zero ASAR / Zero CDP)`);
  console.log(`  Data Dir:       ${dataDir}`);
  console.log(`  Config File:    ${getConfigPath(dataDir)} (${import_node_fs2.default.existsSync(getConfigPath(dataDir)) ? "persisted" : "defaults"})`);
  console.log(`  Preset:         ${cfg.preset}`);
  console.log(`  UI Locale:      ${cfg.locale}`);
  console.log(`  Modules:        ${enabledCount}/${MODULE_IDS.length} enabled (${modelTools} model tools)`);
  console.log(`  Network:        ${cfg.modules.remote ? "Remote Hub enabled (opt-in)" : "100% offline"}`);
  console.log("");
  for (const catId of MODULE_CATEGORY_IDS) {
    const cat = MODULE_CATEGORY_META[catId];
    console.log(`  [${cat.label}]`);
    for (const id of MODULE_IDS.filter((m) => MODULE_CATALOG[m].category === catId)) {
      const meta = MODULE_CATALOG[id];
      const flag = cfg.modules[id] ? "ON " : "OFF";
      const tier = meta.isolationTier === "offline" ? "offline" : "opt-in-net";
      console.log(
        `    [${flag}] ${id.padEnd(8)} ${meta.name.padEnd(24)} (${meta.modelToolNames.length} tools \xB7 ${tier})`
      );
    }
  }
}
function runDoctor(dataDir) {
  const rootDir = import_node_path2.default.resolve(import_node_path2.default.dirname(process.argv[1] || process.cwd()), "..");
  const requiredFiles = [
    "plugin.json",
    "mcp_config.json",
    "hooks.json",
    "skills/agy-nov/SKILL.md",
    "assets/logo.svg",
    "dist/server.cjs",
    "dist/hook.cjs",
    "dist/cli.cjs",
    "dist/ui/app.html"
  ];
  let ok = true;
  console.log(`agy-NOV Doctor (v${CLI_VERSION} \xB7 Zero ASAR / Zero CDP)`);
  for (const rel of requiredFiles) {
    const abs = import_node_path2.default.join(rootDir, rel);
    const exists = import_node_fs2.default.existsSync(abs);
    if (!exists) ok = false;
    const size = exists ? `${(import_node_fs2.default.statSync(abs).size / 1024).toFixed(1)} KB` : "MISSING";
    console.log(`  ${exists ? "OK  " : "FAIL"} ${rel.padEnd(28)} ${size}`);
  }
  const pluginPath = import_node_path2.default.join(rootDir, "plugin.json");
  if (import_node_fs2.default.existsSync(pluginPath)) {
    const allowedKeys = /* @__PURE__ */ new Set([
      "name",
      "displayName",
      "description",
      "version",
      "logo",
      "suggestedPrompts",
      "author",
      "homepage",
      "repository",
      "disabled"
    ]);
    const manifest = JSON.parse(import_node_fs2.default.readFileSync(pluginPath, "utf8"));
    const unknown = Object.keys(manifest).filter((k) => !allowedKeys.has(k));
    if (unknown.length > 0) {
      ok = false;
      console.log(`  FAIL plugin.json contains unknown keys: ${unknown.join(", ")}`);
    } else {
      console.log(`  OK   plugin.json schema clean (name=${String(manifest.name)}, version=${String(manifest.version)})`);
    }
  }
  const uiPath = import_node_path2.default.join(rootDir, "dist/ui/app.html");
  if (import_node_fs2.default.existsSync(uiPath)) {
    const bytes = import_node_fs2.default.statSync(uiPath).size;
    if (bytes >= 10 * 1024 * 1024) {
      ok = false;
      console.log(`  FAIL dist/ui/app.html exceeds 10 MiB limit (${bytes} bytes)`);
    } else {
      console.log(`  OK   dist/ui/app.html well below 10 MiB cap (${(bytes / 1024).toFixed(1)} KB)`);
    }
  }
  const cfg = loadNovConfigReadOnly(dataDir);
  console.log(
    `  OK   config readable (preset=${cfg.preset}, locale=${cfg.locale}, remote=${cfg.modules.remote ? "ON" : "OFF"})`
  );
  return ok ? 0 : 1;
}
function main() {
  const argv = process.argv.slice(2);
  const cmd = argv.find((a) => !a.startsWith("-")) ?? "status";
  const positional = argv.filter((a) => !a.startsWith("-"));
  const dataDir = resolveNovDataDir(parseCliFlag(argv, "--data-dir"));
  if (cmd === "help" || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  if (cmd === "status") {
    printStatus(dataDir);
    return;
  }
  if (cmd === "enable" || cmd === "disable") {
    const target = positional[1];
    if (!isModuleId(target)) {
      console.error(`Unknown module "${target ?? ""}". Valid modules: ${MODULE_IDS.join(", ")}`);
      process.exit(2);
    }
    const next = setModuleEnabled(dataDir, target, cmd === "enable");
    console.log(
      `${cmd === "enable" ? "Enabled" : "Disabled"} module "${target}". Preset is now "${next.preset}".`
    );
    return;
  }
  if (cmd === "preset") {
    const target = positional[1];
    if (!isPresetId(target)) {
      console.error(`Unknown preset "${target ?? ""}". Valid presets: ${PRESET_IDS.join(", ")}`);
      process.exit(2);
    }
    const next = applyPresetConfig(dataDir, target);
    const def = PRESET_DEFINITIONS[target];
    console.log(`Applied preset "${def.label}" (${next.preset}).`);
    printStatus(dataDir);
    return;
  }
  if (cmd === "locale") {
    const target = positional[1];
    if (!isNovLocale(target)) {
      console.error(`Unknown locale "${target ?? ""}". Valid locales: ${LOCALE_IDS.join(", ")}`);
      process.exit(2);
    }
    const next = setNovLocale(dataDir, target);
    console.log(`Updated agy-NOV UI locale to "${next.locale}".`);
    return;
  }
  if (cmd === "statusline") {
    const asJson = hasCliFlag(argv, "--json");
    const compact = hasCliFlag(argv, "--compact");
    const snap = buildStatusLine(dataDir, compact);
    console.log(asJson ? JSON.stringify(snap) : snap.line);
    return;
  }
  if (cmd === "doctor") {
    process.exit(runDoctor(dataDir));
  }
  console.error(`Unknown command "${cmd}".`);
  printHelp();
  process.exit(2);
}
main();
