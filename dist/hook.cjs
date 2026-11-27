"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
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

// src/hooks/dispatcher.ts
var dispatcher_exports = {};
__export(dispatcher_exports, {
  dispatchNovHook: () => dispatchNovHook
});
module.exports = __toCommonJS(dispatcher_exports);
var import_node_fs17 = __toESM(require("node:fs"), 1);
var import_node_path18 = __toESM(require("node:path"), 1);

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
var STARTUP_VIEW_IDS = ["hub", "last"];
var MAX_MCP_TOOL_BUDGET = 100;
var PRESET_IDS = ["core", "power", "local-all", "full", "minimal"];
var UI_LOCALE_IDS = ["en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de"];
var LOCALE_IDS = ["auto", ...UI_LOCALE_IDS];
var MODULE_CATALOG = {
  review: {
    id: "review",
    category: "core-dev",
    domain: "core",
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
    domain: "core",
    name: "Guard & Snapshots",
    shortLabel: "Guard",
    tagline: "Secret leak shield, command firewall & pre-edit snapshots",
    description: "Blocks .env/SSH/credential leaks and destructive commands before execution, snapshots files prior to edits without touching Git, and restores in one click.",
    isolationTier: "offline",
    networkAccess: "offline",
    uiMode: "scroll",
    hasUiTab: true,
    defaultEnabled: true,
    hooks: ["PreToolUse", "PreInvocation"],
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
    domain: "core",
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
    domain: "pipeline",
    name: "Turbo & Output Guard",
    shortLabel: "Turbo",
    tagline: "Batch codebase search, outline slices & RTK-style output compression",
    description: "Cut wasted turns and context bloat with multi-pattern workspace search, symbol outline slicing, and RTK-style smart compression presets (test/build/git/auto) for oversized logs.",
    isolationTier: "offline",
    networkAccess: "offline",
    uiMode: "scroll",
    hasUiTab: true,
    defaultEnabled: false,
    hooks: ["SessionStart", "PreToolUse", "PostToolUse"],
    modelToolNames: ["turbo_batch_search", "turbo_read_outline", "turbo_compact_output"]
  },
  radar: {
    id: "radar",
    category: "observability",
    domain: "toolbox",
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
    domain: "pipeline",
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
    domain: "pipeline",
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
    domain: "pipeline",
    name: "Spec Flow & Task DAG",
    shortLabel: "Spec",
    tagline: "Plan inline review, Brownfield Delta Spec, Task DAG & pre-approval write lock",
    description: "Maintain structured Full or Delta Specs with Plannotator-style inline annotations, revision diffs, dependency Task DAGs, SessionStart recall, and PreToolUse/PreInvocation guardrails.",
    isolationTier: "offline",
    networkAccess: "offline",
    uiMode: "scroll",
    hasUiTab: true,
    defaultEnabled: false,
    hooks: ["SessionStart", "PreToolUse", "PreInvocation"],
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
    domain: "toolbox",
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
    domain: "toolbox",
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
    domain: "pipeline",
    name: "Memory Graph",
    shortLabel: "Memory",
    tagline: "Code-anchored long-term memory with drift detection",
    description: "Capture architectural decisions anchored to SHA-256 file hashes, auto-recall relevant context at SessionStart, and flag stale memories when code changes.",
    isolationTier: "offline",
    networkAccess: "offline",
    uiMode: "scroll",
    hasUiTab: true,
    defaultEnabled: false,
    hooks: ["SessionStart", "PreInvocation", "Stop"],
    modelToolNames: ["mem_remember", "mem_recall", "mem_forget"]
  },
  ops: {
    id: "ops",
    category: "workspace",
    domain: "toolbox",
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
    domain: "connectivity",
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
function isNovStartupView(value) {
  return typeof value === "string" && STARTUP_VIEW_IDS.includes(value);
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

// src/core/team-config.ts
var MAX_TEAM_CONFIG_BYTES = 64 * 1024;
function normalizeCanonicalFlag(arg) {
  const lower = arg.toLowerCase();
  const eqIdx = lower.indexOf("=");
  const flag = eqIdx >= 0 ? lower.slice(0, eqIdx) : lower;
  if (flag.startsWith("--")) {
    return `--${flag.slice(2).replace(/[-_]/g, "")}`;
  }
  return flag.replace(/_/g, "-");
}
var FORBIDDEN_LINTER_COMMON_FLAGS = new Set(
  [
    "--eval",
    "--config",
    "--config-file",
    "--config-path",
    "--plugin",
    "--plugins",
    "--plugin-search-dir",
    "--require",
    "--import",
    "--loader",
    "--experimental-loader",
    "--preload",
    "--node-options",
    "--exec",
    "--shell",
    "--script-shell",
    "--output",
    "--output-file",
    "--output-dir",
    "--out-file",
    "--out-dir",
    "--ts-build-info-file",
    "--declaration-dir",
    "--rulesdir",
    "--resolve-plugins-relative-to",
    "--parser",
    "--formatter",
    "--format",
    "--setup-files",
    "--setup-files-after-env",
    "--global-setup",
    "--global-teardown",
    "--reporter",
    "--reporters",
    "--runner",
    "--test-runner",
    "--test-environment",
    "--test-sequencer",
    "--snapshot-resolver",
    "--dependency-extractor",
    "--module-name-mapper",
    "--watch-plugins",
    "--haste",
    "--transform",
    "--resolver",
    "--preset",
    "--environment",
    "--projects",
    "--workspace",
    "--override-ini",
    "--confcutdir",
    "--rootdir",
    "--basetemp",
    "--python-executable",
    "--custom-typeshed-dir",
    "--cache-dir",
    "--cache-directory",
    "--coverage-directory",
    "--artifacts-path",
    "--write"
  ].map(normalizeCanonicalFlag)
);
var FORBIDDEN_BUILD_TOOL_CANONICAL_FLAGS = new Set(
  [
    "--init-script",
    "--build-file",
    "--settings-file",
    "--settings",
    "--global-settings",
    "--file",
    "--property",
    "--logger",
    "--gradle-user-home",
    "--project-dir",
    "--artifacts-path",
    "--output",
    "--output-dir",
    "--results-directory"
  ].map(normalizeCanonicalFlag)
);

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
    startupView: "hub",
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
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const obj = raw;
  const rawMods = obj.modules && typeof obj.modules === "object" && !Array.isArray(obj.modules) ? obj.modules : {};
  const modules = { ...base.modules };
  for (const id of MODULE_IDS) {
    if (Object.prototype.hasOwnProperty.call(rawMods, id) && typeof rawMods[id] === "boolean") {
      modules[id] = rawMods[id];
    }
  }
  const enabledTabList = MODULE_IDS.filter((id) => modules[id] && MODULE_CATALOG[id].hasUiTab);
  const defaultTab = isModuleId(obj.defaultTab) && modules[obj.defaultTab] && MODULE_CATALOG[obj.defaultTab].hasUiTab ? obj.defaultTab : enabledTabList[0] ?? "review";
  const startupView = isNovStartupView(obj.startupView) ? obj.startupView : "hub";
  const locale = isNovLocale(obj.locale) ? obj.locale : "auto";
  return {
    schemaVersion: 1,
    preset: detectPreset(modules),
    modules,
    defaultTab,
    startupView,
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
var MAX_CONFIG_IMPORT_BYTES = 32 * 1024;

// src/core/feed.ts
var import_node_crypto = __toESM(require("node:crypto"), 1);
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);
var FEED_SNAPSHOT_VERSION = "0.8.0";
var FEED_SNAPSHOT_FILENAME = "feed-snapshot.json";
var MAX_FEED_SNAPSHOT_BYTES = 64 * 1024;
var MAX_FEED_ALERTS = 6;
var MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
var STANDARD_FEED_PATHS = {
  configFile: "config.json",
  feedFile: "feed-snapshot.json",
  modulesRoot: "modules",
  moduleFiles: {
    opsPrompts: "modules/ops/prompts.json",
    guardAudit: "modules/guard/audit.json",
    radarCapsule: "modules/radar/status-capsule.json",
    memStore: "modules/mem/memories.json",
    specState: "modules/spec/state.json",
    verifyState: "modules/verify/state.json",
    xrayLive: "modules/xray/live-state.json"
  }
};
function isAsciiSpace(code) {
  return code === 32 || code === 9 || code === 13 || code === 10;
}
function asciiLower(code) {
  return code >= 65 && code <= 90 ? code + 32 : code;
}
function startsWithAsciiCI(input, idx, lowerPrefix) {
  if (idx + lowerPrefix.length > input.length) return false;
  for (let i = 0; i < lowerPrefix.length; i += 1) {
    if (asciiLower(input.charCodeAt(idx + i)) !== lowerPrefix.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}
function matchPrivateOpenEnd(input, idx) {
  if (!startsWithAsciiCI(input, idx, "<private")) return -1;
  let cur = idx + 8;
  if (cur >= input.length) return -1;
  const ch = input.charCodeAt(cur);
  if (ch === 62) return cur;
  if (!isAsciiSpace(ch)) return -1;
  cur += 1;
  while (cur < input.length) {
    const code = input.charCodeAt(cur);
    if (code === 62) return cur;
    if (code === 60) return -1;
    cur += 1;
  }
  return -1;
}
function matchPrivateCloseEnd(input, idx) {
  if (!startsWithAsciiCI(input, idx, "</private")) return -1;
  let cur = idx + 9;
  while (cur < input.length && isAsciiSpace(input.charCodeAt(cur))) {
    cur += 1;
  }
  return cur < input.length && input.charCodeAt(cur) === 62 ? cur : -1;
}
function stripPrivateBlocksLinear(input) {
  if (!input.includes("<")) return input;
  const chunks = [];
  let cur = 0;
  while (cur < input.length) {
    const lt = input.indexOf("<", cur);
    if (lt === -1) {
      chunks.push(input.slice(cur));
      break;
    }
    const openEnd = matchPrivateOpenEnd(input, lt);
    if (openEnd === -1) {
      chunks.push(input.slice(cur, lt + 1));
      cur = lt + 1;
      continue;
    }
    if (lt > cur) chunks.push(input.slice(cur, lt));
    let depth = 1;
    let scan = openEnd + 1;
    while (scan < input.length && depth > 0) {
      const nextLt = input.indexOf("<", scan);
      if (nextLt === -1) {
        scan = input.length;
        break;
      }
      const nestedOpen = matchPrivateOpenEnd(input, nextLt);
      if (nestedOpen !== -1) {
        depth += 1;
        scan = nestedOpen + 1;
        continue;
      }
      const closeEnd = matchPrivateCloseEnd(input, nextLt);
      if (closeEnd !== -1) {
        depth -= 1;
        scan = closeEnd + 1;
        continue;
      }
      scan = nextLt + 1;
    }
    chunks.push("[REDACTED_PRIVATE]");
    cur = depth > 0 ? input.length : scan;
  }
  return chunks.join("");
}
function stripPemPrivateKeysLinear(input) {
  const beginMarker = "-----BEGIN ";
  if (!input.includes(beginMarker)) return input;
  const chunks = [];
  let cur = 0;
  while (cur < input.length) {
    const start = input.indexOf(beginMarker, cur);
    if (start === -1) {
      chunks.push(input.slice(cur));
      break;
    }
    const headerEnd = input.indexOf("-----", start + beginMarker.length);
    if (headerEnd === -1) {
      chunks.push(input.slice(cur));
      break;
    }
    const label = input.slice(start + beginMarker.length, headerEnd);
    if (!/^[A-Z0-9 _-]{0,48}PRIVATE KEY(?: BLOCK)?$/i.test(label)) {
      chunks.push(input.slice(cur, headerEnd + 5));
      cur = headerEnd + 5;
      continue;
    }
    if (start > cur) chunks.push(input.slice(cur, start));
    chunks.push("[REDACTED_PRIVATE_KEY]");
    const endPrefix = "-----END ";
    const searchFrom = headerEnd + 5;
    let endIdx = input.indexOf(endPrefix, searchFrom);
    let closedAt = -1;
    while (endIdx !== -1) {
      const footerEnd = input.indexOf("-----", endIdx + endPrefix.length);
      if (footerEnd === -1) break;
      const endLabel = input.slice(endIdx + endPrefix.length, footerEnd);
      if (/^[A-Z0-9 _-]{0,48}PRIVATE KEY(?: BLOCK)?$/i.test(endLabel)) {
        closedAt = footerEnd + 5;
        break;
      }
      endIdx = input.indexOf(endPrefix, footerEnd + 5);
    }
    cur = closedAt === -1 ? input.length : closedAt;
  }
  return chunks.join("");
}
var LINEAR_REDACT_PATTERNS = [
  // IM webhook URLs
  [/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/gi, "[REDACTED_WEBHOOK]"],
  [/https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi, "[REDACTED_WEBHOOK]"],
  [/https:\/\/open\.(?:feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+/gi, "[REDACTED_WEBHOOK]"],
  [/https:\/\/oapi\.dingtalk\.com\/robot\/send\?[^\s"'<>]+/gi, "[REDACTED_WEBHOOK]"],
  [/https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?[^\s"'<>]+/gi, "[REDACTED_WEBHOOK]"],
  // URL embedded credentials and sensitive query params
  [/(https?:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi, "$1[REDACTED]$3"],
  [/([?&](?:token|access_token|api[_-]?key|key|secret|sign|sig|pin|code)=)([^&#\s"'<>]+)/gi, "$1[REDACTED]"],
  // Authorization headers (including custom schemes like Token / ApiKey / Digest / HMAC) & JWTs
  [
    /\b(Authorization[ \t]*:[ \t]*(?:Bearer|Basic|Token|ApiKey|Digest|HMAC)[ \t]+)([^\s"',;}{]+)/gi,
    "$1[REDACTED]"
  ],
  [/\bBearer[ \t]+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]"],
  [/\bBasic[ \t]+[A-Za-z0-9+/]+=*/gi, "Basic [REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]"],
  // Telegram bot tokens & cloud/provider API keys
  [/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_BOT_TOKEN]"],
  [
    /\b(?:sk-proj-|sk-ant-|sk_(?:live|test)_|sk-|AIza|gh[pousr]_|github_pat_|glpat-|xox[baprs]-|AKIA|ASIA|npm_|hf_|pypi-)[A-Za-z0-9_-]{10,}\b/g,
    "[REDACTED_KEY]"
  ],
  // Uppercase environment variable secret assignments (e.g. OPENAI_API_KEY=..., MY_TOKEN=...)
  [
    /\b([A-Z][A-Z0-9_]{1,40}_(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|WEBHOOK|PIN|AUTH|CREDENTIAL|CREDENTIALS)[ \t]*=[ \t]*["']?)([^\s"',;}{]+)(["']?)/g,
    "$1[REDACTED]$3"
  ],
  // Key-value secret/token/pairing-code assignments
  [
    /(["']?(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|bot[_-]?token|pairing[_-]?token|pairing[_-]?pin|pairing[_ -]?code|pair[_-]?code|passcode|signing[_-]?secret|client[_-]?secret|private[_-]?key|csrf[_-]?token|webhook[_-]?url|webhook|secret|token|password|passwd|authorization|pin)["']?[ \t]*[:=][ \t]*["']?)([^\s"',;}{]{4,})(["']?)/gi,
    "$1[REDACTED]$3"
  ]
];
function redactGenericWebhookUrlsLinear(input) {
  return input.replace(
    /https?:\/\/[^\s"'<>]+/gi,
    (match) => match.toLowerCase().includes("webhook") ? "[REDACTED_WEBHOOK]" : match
  );
}
function truncateUtf16Safe(input, maxLen) {
  if (maxLen <= 0 || input.length <= maxLen) return input;
  let end = Math.max(1, maxLen - 1);
  if (end > 0) {
    const code = input.charCodeAt(end - 1);
    if (code >= 55296 && code <= 56319) {
      end = Math.max(0, end - 1);
    }
  }
  return `${input.slice(0, end).trimEnd()}\u2026`;
}
function redactFeedText(input, maxLen = 180) {
  if (typeof input !== "string" || !input) return "";
  let out = stripPrivateBlocksLinear(input);
  out = stripPemPrivateKeysLinear(out);
  out = redactGenericWebhookUrlsLinear(out);
  for (const [pattern, replacement] of LINEAR_REDACT_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim();
  return truncateUtf16Safe(out, maxLen);
}
function isPlatformSystemRootSymlink(segmentPath) {
  return process.platform === "darwin" && /^\/(?:var|tmp|etc)$/.test(segmentPath);
}
function hasUnsafeSymlinkAncestor(targetPath) {
  let cur = import_node_path2.default.resolve(targetPath);
  const root = import_node_path2.default.parse(cur).root;
  while (true) {
    if (!isPlatformSystemRootSymlink(cur)) {
      try {
        const st = import_node_fs2.default.lstatSync(cur);
        if (st.isSymbolicLink()) return true;
      } catch (err) {
        const code = err?.code;
        if (code !== "ENOENT") return true;
      }
    }
    if (cur === root) return false;
    const parent = import_node_path2.default.dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
}
function isWithinRealBase(childReal, baseReal) {
  if (childReal === baseReal) return true;
  const prefix = baseReal.endsWith(import_node_path2.default.sep) ? baseReal : `${baseReal}${import_node_path2.default.sep}`;
  return childReal.startsWith(prefix);
}
function resolveSafeRealDir(dirPath) {
  if (hasUnsafeSymlinkAncestor(dirPath)) return null;
  try {
    const st = import_node_fs2.default.lstatSync(dirPath);
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
    return import_node_fs2.default.realpathSync(dirPath);
  } catch {
    return null;
  }
}
function readSafeModuleJson(rootDataDir, moduleId, fileName) {
  const realRoot = resolveSafeRealDir(rootDataDir);
  if (!realRoot) return null;
  const modulesRoot = import_node_path2.default.join(realRoot, "modules");
  const realModules = resolveSafeRealDir(modulesRoot);
  if (!realModules || !isWithinRealBase(realModules, realRoot)) return null;
  const modDir = import_node_path2.default.join(realModules, moduleId);
  const realMod = resolveSafeRealDir(modDir);
  if (!realMod || !isWithinRealBase(realMod, realModules)) return null;
  const targetPath = import_node_path2.default.join(realMod, fileName);
  try {
    const st = import_node_fs2.default.lstatSync(targetPath);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    if (st.size > MAX_SOURCE_FILE_BYTES) return null;
    const realTarget = import_node_fs2.default.realpathSync(targetPath);
    if (!isWithinRealBase(realTarget, realMod)) return null;
    const raw = import_node_fs2.default.readFileSync(realTarget, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function asRecord(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return null;
}
function toNonNegInt(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
}
function toNonNegFloat(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.round(num * 1e4) / 1e4 : 0;
}
function extractGuardSummary(rootDataDir, enabled) {
  if (!enabled) {
    return { enabled: false, blockedCount: 0, askCount: 0 };
  }
  const raw = readSafeModuleJson(rootDataDir, "guard", "audit.json");
  const rawObj = asRecord(raw);
  const eventsRaw = Array.isArray(raw) ? raw : Array.isArray(rawObj?.events) ? rawObj.events : [];
  let blockedCount = 0;
  let askCount = 0;
  let lastEvent;
  let lastEventTs = -Infinity;
  for (const item of eventsRaw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const rawDecision = String(rec.decision ?? rec.action ?? rec.outcome ?? "").trim().toLowerCase();
    if (rawDecision === "deny" || rawDecision === "denied" || rawDecision === "block" || rawDecision === "blocked") {
      blockedCount += 1;
    } else if (rawDecision === "ask" || rawDecision === "force_ask") {
      askCount += 1;
    }
    const tsStr = typeof rec.timestamp === "string" ? rec.timestamp : "";
    const parsedTs = tsStr ? Date.parse(tsStr) : Number.NaN;
    const scoreTs = Number.isFinite(parsedTs) ? parsedTs : -Infinity;
    const candidate = {
      decision: redactFeedText(rawDecision || "unknown", 24),
      toolName: redactFeedText(String(rec.toolName ?? rec.tool_name ?? "tool"), 64),
      reason: redactFeedText(String(rec.reason ?? rec.summary ?? ""), 140),
      timestamp: redactFeedText(tsStr, 40)
    };
    if (!lastEvent || scoreTs > lastEventTs) {
      lastEvent = candidate;
      lastEventTs = scoreTs;
    }
  }
  return {
    enabled: true,
    blockedCount,
    askCount,
    ...lastEvent ? { lastEvent } : {}
  };
}
function extractSpecSummary(rootDataDir, enabled) {
  if (!enabled) {
    return {
      enabled: false,
      activeSpecId: null,
      title: null,
      status: null,
      writeLockActive: false,
      doneTasks: 0,
      totalTasks: 0,
      readyTasks: 0
    };
  }
  const state = asRecord(readSafeModuleJson(rootDataDir, "spec", "state.json"));
  const activeId = typeof state?.activeSpecId === "string" && state.activeSpecId.trim() ? state.activeSpecId.trim() : null;
  let activeDoc = null;
  if (activeId && Array.isArray(state?.specs)) {
    for (const item of state.specs) {
      const rec = asRecord(item);
      if (rec && rec.id === activeId) {
        activeDoc = rec;
        break;
      }
    }
  } else if (activeId) {
    const specsObj = asRecord(state?.specs);
    if (specsObj) {
      activeDoc = asRecord(specsObj[activeId]);
    }
  }
  if (!activeDoc) {
    return {
      enabled: true,
      activeSpecId: activeId ? redactFeedText(activeId, 64) : null,
      title: null,
      status: null,
      writeLockActive: false,
      doneTasks: 0,
      totalTasks: 0,
      readyTasks: 0
    };
  }
  const rawTasks = Array.isArray(activeDoc.tasks) ? activeDoc.tasks : [];
  const tasks = [];
  const statusById = /* @__PURE__ */ new Map();
  for (const rawTask of rawTasks) {
    const rec = asRecord(rawTask);
    if (!rec || typeof rec.id !== "string") continue;
    const status2 = typeof rec.status === "string" ? rec.status : "pending";
    const dependsOn = Array.isArray(rec.dependsOn) ? rec.dependsOn.filter((d) => typeof d === "string") : [];
    const computedState = typeof rec.computedState === "string" ? rec.computedState : void 0;
    tasks.push({ id: rec.id, status: status2, dependsOn, computedState });
    statusById.set(rec.id, status2);
  }
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const readyTasks = tasks.filter((t) => {
    if (t.computedState === "ready") return true;
    if (t.status !== "pending") return false;
    return t.dependsOn.every((depId) => statusById.get(depId) === "done");
  }).length;
  const status = typeof activeDoc.status === "string" ? redactFeedText(activeDoc.status, 32) : null;
  const writeLockActive = Boolean(status === "draft" && activeDoc.enforcePlanBeforeWrite === true);
  const title = typeof activeDoc.title === "string" && activeDoc.title.trim() ? redactFeedText(activeDoc.title, 100) : null;
  return {
    enabled: true,
    activeSpecId: redactFeedText(String(activeDoc.id ?? activeId ?? ""), 64) || null,
    title,
    status,
    writeLockActive,
    doneTasks,
    totalTasks: tasks.length,
    readyTasks
  };
}
function extractVerifySummary(rootDataDir, enabled) {
  if (!enabled) {
    return {
      enabled: false,
      enforceOnStop: false,
      lastStatus: "idle",
      dirtyFilesCount: 0
    };
  }
  const state = asRecord(readSafeModuleJson(rootDataDir, "verify", "state.json"));
  const policy = asRecord(state?.policy);
  const enforceOnStop = typeof policy?.enforceOnStop === "boolean" ? policy.enforceOnStop : false;
  const evidenceRaw = Array.isArray(state?.evidence) ? state.evidence : [];
  const latest = evidenceRaw.map((e) => asRecord(e)).find((e) => e !== null);
  let lastStatus = "idle";
  if (latest) {
    const outcome = typeof latest.outcome === "string" ? latest.outcome : "";
    if (outcome === "blocked" || latest.blocked === true) {
      lastStatus = "blocked";
    } else if (outcome === "pass" || outcome === "guardrail-allow" || latest.passed === true) {
      lastStatus = "pass";
    } else {
      lastStatus = "fail";
    }
  }
  const dirtySet = /* @__PURE__ */ new Set();
  const sessionsRaw = state?.sessions;
  const sessionList = Array.isArray(sessionsRaw) ? sessionsRaw : sessionsRaw && typeof sessionsRaw === "object" ? Object.values(sessionsRaw) : [];
  for (const session of sessionList) {
    const rec = asRecord(session);
    if (!rec || !Array.isArray(rec.dirtyFiles)) continue;
    for (const file of rec.dirtyFiles) {
      if (typeof file === "string" && file.trim()) {
        dirtySet.add(file.trim());
      }
    }
  }
  return {
    enabled: true,
    enforceOnStop,
    lastStatus,
    dirtyFilesCount: dirtySet.size
  };
}
function isMemoryRecordStale(rec) {
  if (rec.stale === true || rec.drifted === true) return true;
  if (Array.isArray(rec.anchors)) {
    for (const anchor of rec.anchors) {
      const a = asRecord(anchor);
      if (a && (a.driftStatus === "drifted" || a.driftStatus === "missing")) {
        return true;
      }
    }
  }
  return false;
}
function extractMemSummary(rootDataDir, enabled) {
  if (!enabled) {
    return { enabled: false, totalMemories: 0, staleCount: 0 };
  }
  const raw = readSafeModuleJson(rootDataDir, "mem", "memories.json");
  const rawObj = asRecord(raw);
  const list = Array.isArray(raw) ? raw : Array.isArray(rawObj?.memories) ? rawObj.memories : Array.isArray(rawObj?.items) ? rawObj.items : [];
  let totalMemories = 0;
  let staleCount = 0;
  for (const item of list) {
    const rec = asRecord(item);
    if (!rec) continue;
    totalMemories += 1;
    if (isMemoryRecordStale(rec)) {
      staleCount += 1;
    }
  }
  return {
    enabled: true,
    totalMemories,
    staleCount
  };
}
function extractRadarSummary(rootDataDir, enabled) {
  if (!enabled) {
    return {
      enabled: false,
      runningCount: 0,
      awaitingCount: 0,
      stalledCount: 0,
      unreadCount: 0
    };
  }
  const capsule = asRecord(readSafeModuleJson(rootDataDir, "radar", "status-capsule.json"));
  const counts = asRecord(capsule?.counts);
  if (counts) {
    return {
      enabled: true,
      runningCount: toNonNegInt(counts.running),
      awaitingCount: toNonNegInt(counts.awaiting_approval ?? counts.awaiting),
      stalledCount: toNonNegInt(counts.stalled),
      unreadCount: toNonNegInt(counts.unread)
    };
  }
  const board = asRecord(readSafeModuleJson(rootDataDir, "radar", "board.json"));
  const sessionsObj = asRecord(board?.sessions);
  const sessions = sessionsObj ? Object.values(sessionsObj).map(asRecord).filter((s) => s !== null) : [];
  return {
    enabled: true,
    runningCount: sessions.filter((s) => s.status === "running").length,
    awaitingCount: sessions.filter((s) => s.status === "awaiting_approval").length,
    stalledCount: sessions.filter((s) => s.status === "stalled").length,
    unreadCount: sessions.filter((s) => s.unread === true).length
  };
}
function extractXraySummary(rootDataDir, enabled) {
  if (!enabled) {
    return {
      enabled: false,
      activeModel: null,
      peakContextTokens: 0,
      estimatedCostUsd: 0
    };
  }
  const live = asRecord(readSafeModuleJson(rootDataDir, "xray", "live-state.json"));
  const rawModel = typeof live?.activeModel === "string" && live.activeModel.trim() ? live.activeModel.trim() : typeof live?.model === "string" && live.model.trim() ? live.model.trim() : null;
  return {
    enabled: true,
    activeModel: rawModel ? redactFeedText(rawModel, 80) : null,
    peakContextTokens: toNonNegInt(live?.peakContextTokens),
    estimatedCostUsd: toNonNegFloat(live?.estimatedCostUsd ?? live?.estimatedUsd)
  };
}
function extractRemoteRunningReadOnly(rootDataDir, enabled, overrideRunning) {
  if (!enabled) return false;
  if (typeof overrideRunning === "boolean") return overrideRunning;
  const runtime = asRecord(readSafeModuleJson(rootDataDir, "remote", "runtime.json"));
  const port = Number(runtime?.port);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}
var ALERT_PRIORITY = {
  danger: 0,
  warn: 1,
  info: 2
};
function buildFeedAlerts(summary, exposedModelTools, estimatedTotalTools) {
  const alerts = [];
  if (summary.guard.enabled && summary.guard.blockedCount > 0) {
    const lastReason = summary.guard.lastEvent?.reason ? `: ${summary.guard.lastEvent.reason}` : "";
    alerts.push({
      level: "danger",
      moduleId: "guard",
      code: "GUARD_BLOCKED",
      message: redactFeedText(
        `Guard blocked ${summary.guard.blockedCount} risky tool call(s)${lastReason}`,
        160
      )
    });
  }
  if (summary.verify.enabled && summary.verify.lastStatus === "blocked") {
    alerts.push({
      level: "danger",
      moduleId: "verify",
      code: "VERIFY_STOP_BLOCKED",
      message: redactFeedText(
        `Verify Gate blocked the latest Stop attempt (${summary.verify.dirtyFilesCount} dirty file(s)).`,
        160
      )
    });
  } else if (summary.verify.enabled && summary.verify.lastStatus === "fail") {
    alerts.push({
      level: "warn",
      moduleId: "verify",
      code: "VERIFY_CHECK_FAILED",
      message: redactFeedText(
        `Latest Verify Gate run failed (${summary.verify.dirtyFilesCount} dirty file(s)).`,
        160
      )
    });
  }
  if (summary.spec.enabled && summary.spec.writeLockActive) {
    const specLabel = summary.spec.title ?? summary.spec.activeSpecId ?? "active spec";
    alerts.push({
      level: "warn",
      moduleId: "spec",
      code: "SPEC_WRITE_LOCK",
      message: redactFeedText(
        `Spec "${specLabel}" is in DRAFT with write lock active; approve before editing files.`,
        160
      )
    });
  }
  if (summary.mem.enabled && summary.mem.staleCount > 0) {
    alerts.push({
      level: "warn",
      moduleId: "mem",
      code: "MEM_STALE_DRIFT",
      message: redactFeedText(
        `${summary.mem.staleCount} anchored memory item(s) drifted or stale out of ${summary.mem.totalMemories}.`,
        160
      )
    });
  }
  const effectiveTools = Math.max(exposedModelTools, toNonNegInt(estimatedTotalTools));
  if (effectiveTools >= 75) {
    alerts.push({
      level: effectiveTools >= 90 ? "danger" : "warn",
      moduleId: "ops",
      code: "TOOL_BUDGET_HIGH",
      message: redactFeedText(
        `Active MCP tool footprint (${effectiveTools}/${MAX_MCP_TOOL_BUDGET}) is approaching the 100-tool budget cap.`,
        160
      )
    });
  }
  if (summary.radar.enabled && (summary.radar.awaitingCount > 0 || summary.radar.stalledCount > 0)) {
    alerts.push({
      level: "info",
      moduleId: "radar",
      code: "RADAR_ATTENTION",
      message: redactFeedText(
        `Radar attention: ${summary.radar.awaitingCount} awaiting approval, ${summary.radar.stalledCount} stalled.`,
        160
      )
    });
  }
  return alerts.sort((a, b) => ALERT_PRIORITY[a.level] - ALERT_PRIORITY[b.level]).slice(0, MAX_FEED_ALERTS);
}
function cloneStandardPaths() {
  return {
    configFile: STANDARD_FEED_PATHS.configFile,
    feedFile: STANDARD_FEED_PATHS.feedFile,
    modulesRoot: STANDARD_FEED_PATHS.modulesRoot,
    moduleFiles: { ...STANDARD_FEED_PATHS.moduleFiles }
  };
}
function enforceFeedSizeCap(snapshot) {
  const byteSize = (s) => Buffer.byteLength(JSON.stringify(s), "utf8");
  if (byteSize(snapshot) <= MAX_FEED_SNAPSHOT_BYTES) {
    return snapshot;
  }
  const trimmed = {
    ...snapshot,
    paths: cloneStandardPaths(),
    modules: { ...snapshot.modules },
    summary: {
      ...snapshot.summary,
      guard: {
        ...snapshot.summary.guard,
        ...snapshot.summary.guard.lastEvent ? {
          lastEvent: {
            ...snapshot.summary.guard.lastEvent,
            toolName: redactFeedText(snapshot.summary.guard.lastEvent.toolName, 32),
            reason: redactFeedText(snapshot.summary.guard.lastEvent.reason, 64)
          }
        } : {}
      },
      spec: {
        ...snapshot.summary.spec,
        title: snapshot.summary.spec.title ? redactFeedText(snapshot.summary.spec.title, 64) : null
      },
      xray: {
        ...snapshot.summary.xray,
        activeModel: snapshot.summary.xray.activeModel ? redactFeedText(snapshot.summary.xray.activeModel, 48) : null
      }
    },
    alerts: snapshot.alerts.map((a) => ({
      ...a,
      message: redactFeedText(a.message, 80)
    }))
  };
  while (trimmed.alerts.length > 0 && byteSize(trimmed) > MAX_FEED_SNAPSHOT_BYTES) {
    trimmed.alerts.pop();
  }
  if (byteSize(trimmed) > MAX_FEED_SNAPSHOT_BYTES && trimmed.summary.guard.lastEvent) {
    delete trimmed.summary.guard.lastEvent;
  }
  return trimmed;
}
function buildFeedSnapshot(rootDataDir, config, options = {}) {
  const normalized = normalizeConfig(config);
  const enabledCount = MODULE_IDS.filter((id) => normalized.modules[id]).length;
  const exposedModelTools = countEnabledModelTools(normalized.modules);
  const generatedAt = (options.now ?? /* @__PURE__ */ new Date()).toISOString();
  const summary = {
    guard: extractGuardSummary(rootDataDir, normalized.modules.guard),
    spec: extractSpecSummary(rootDataDir, normalized.modules.spec),
    verify: extractVerifySummary(rootDataDir, normalized.modules.verify),
    mem: extractMemSummary(rootDataDir, normalized.modules.mem),
    radar: extractRadarSummary(rootDataDir, normalized.modules.radar),
    xray: extractXraySummary(rootDataDir, normalized.modules.xray),
    turbo: { enabled: normalized.modules.turbo },
    remote: {
      enabled: normalized.modules.remote,
      running: extractRemoteRunningReadOnly(
        rootDataDir,
        normalized.modules.remote,
        options.remoteRunning
      )
    }
  };
  const alerts = buildFeedAlerts(summary, exposedModelTools, options.estimatedTotalTools);
  const snapshot = {
    schemaVersion: 1,
    version: FEED_SNAPSHOT_VERSION,
    generatedAt,
    preset: normalized.preset,
    locale: normalized.locale,
    startupView: normalized.startupView ?? "hub",
    enabledCount,
    totalModules: 13,
    exposedModelTools,
    toolBudgetLimit: 100,
    modules: { ...normalized.modules },
    paths: cloneStandardPaths(),
    summary,
    alerts
  };
  return enforceFeedSizeCap(snapshot);
}
function writeFeedSnapshotIfDataDirExists(rootDataDir, config, options = {}) {
  const realRoot = resolveSafeRealDir(rootDataDir);
  if (!realRoot) {
    return false;
  }
  const targetPath = import_node_path2.default.join(realRoot, FEED_SNAPSHOT_FILENAME);
  if (import_node_path2.default.relative(realRoot, targetPath) !== FEED_SNAPSHOT_FILENAME) {
    return false;
  }
  try {
    const existing = import_node_fs2.default.lstatSync(targetPath);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      return false;
    }
    const realTarget = import_node_fs2.default.realpathSync(targetPath);
    if (!isWithinRealBase(realTarget, realRoot)) {
      return false;
    }
  } catch (err) {
    if (err?.code !== "ENOENT") {
      return false;
    }
  }
  const snapshot = buildFeedSnapshot(realRoot, config, options);
  let serialized = `${JSON.stringify(snapshot, null, 2)}
`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_FEED_SNAPSHOT_BYTES) {
    serialized = `${JSON.stringify(snapshot)}
`;
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_FEED_SNAPSHOT_BYTES) {
    return false;
  }
  const tmpPath = import_node_path2.default.join(
    realRoot,
    `.${FEED_SNAPSHOT_FILENAME}.tmp.${process.pid}.${import_node_crypto.default.randomBytes(8).toString("hex")}`
  );
  try {
    import_node_fs2.default.writeFileSync(tmpPath, serialized, { encoding: "utf8", mode: 384, flag: "wx" });
    try {
      import_node_fs2.default.chmodSync(tmpPath, 384);
    } catch {
    }
    try {
      const postCheck = import_node_fs2.default.lstatSync(targetPath);
      if (postCheck.isSymbolicLink() || !postCheck.isFile()) {
        import_node_fs2.default.unlinkSync(tmpPath);
        return false;
      }
    } catch (err) {
      if (err?.code !== "ENOENT") {
        import_node_fs2.default.unlinkSync(tmpPath);
        return false;
      }
    }
    import_node_fs2.default.renameSync(tmpPath, targetPath);
    return true;
  } catch {
    try {
      const tmpStat = import_node_fs2.default.lstatSync(tmpPath);
      if (!tmpStat.isSymbolicLink() && tmpStat.isFile()) {
        import_node_fs2.default.unlinkSync(tmpPath);
      }
    } catch {
    }
    return false;
  }
}

// src/core/utils.ts
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_path3 = __toESM(require("node:path"), 1);
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
function ensurePrivateDir(dirPath) {
  import_node_fs3.default.mkdirSync(dirPath, { recursive: true, mode: 448 });
  try {
    import_node_fs3.default.chmodSync(dirPath, 448);
  } catch {
  }
}
function atomicWriteJson(filePath, data) {
  ensurePrivateDir(import_node_path3.default.dirname(filePath));
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  import_node_fs3.default.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}
`, { mode: 384 });
  import_node_fs3.default.renameSync(tmpPath, filePath);
}
function normalizeHookEvent(rawEvent, fallback) {
  if (rawEvent === "SessionStart" || rawEvent === "PreToolUse" || rawEvent === "PostToolUse" || rawEvent === "PreInvocation" || rawEvent === "PostInvocation" || rawEvent === "Stop") {
    return rawEvent;
  }
  return fallback;
}
function asRecord2(val) {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return val;
  }
  return void 0;
}
function normalizeHookPayload(rawInput, fallbackEvent) {
  const raw = asRecord2(rawInput) ?? {};
  const toolCall = asRecord2(raw.toolCall) ?? asRecord2(raw.tool_call);
  const toolNameCandidate = toolCall?.name ?? raw.toolName ?? raw.tool_name ?? raw.name ?? void 0;
  const toolName = typeof toolNameCandidate === "string" ? toolNameCandidate : void 0;
  const toolInputRaw = toolCall?.args ?? toolCall?.arguments ?? toolCall?.input ?? raw.toolInput ?? raw.tool_input ?? raw.arguments ?? raw.input;
  let toolInput;
  if (typeof toolInputRaw === "string") {
    try {
      toolInput = asRecord2(JSON.parse(toolInputRaw));
    } catch {
      toolInput = { raw: toolInputRaw };
    }
  } else {
    toolInput = asRecord2(toolInputRaw);
  }
  const workspacePaths = [];
  if (Array.isArray(raw.workspacePaths)) {
    for (const p of raw.workspacePaths) {
      if (typeof p === "string" && p.trim()) workspacePaths.push(p);
    }
  }
  if (Array.isArray(raw.workspace_paths)) {
    for (const p of raw.workspace_paths) {
      if (typeof p === "string" && p.trim() && !workspacePaths.includes(p)) {
        workspacePaths.push(p);
      }
    }
  }
  const singleWorkspace = typeof raw.workspaceRoot === "string" && raw.workspaceRoot || typeof raw.workspace_root === "string" && raw.workspace_root || typeof raw.cwd === "string" && raw.cwd || workspacePaths[0];
  if (singleWorkspace && !workspacePaths.includes(singleWorkspace)) {
    workspacePaths.unshift(singleWorkspace);
  }
  const event = normalizeHookEvent(raw.hookEventName ?? raw.hook_event_name ?? raw.event, fallbackEvent);
  const conversationId = typeof raw.conversationId === "string" && raw.conversationId || typeof raw.conversation_id === "string" && raw.conversation_id || void 0;
  const parentConversationId = typeof raw.parentConversationId === "string" && raw.parentConversationId || typeof raw.parent_conversation_id === "string" && raw.parent_conversation_id || typeof raw.rootConversationId === "string" && raw.rootConversationId || typeof raw.root_conversation_id === "string" && raw.root_conversation_id || (typeof process.env.ANTIGRAVITY_PARENT_CONVERSATION_ID === "string" && process.env.ANTIGRAVITY_PARENT_CONVERSATION_ID.trim() ? process.env.ANTIGRAVITY_PARENT_CONVERSATION_ID.trim() : void 0);
  const agentRole = typeof raw.agentRole === "string" && raw.agentRole || typeof raw.agent_role === "string" && raw.agent_role || typeof raw.subagentRole === "string" && raw.subagentRole || typeof raw.subagent_role === "string" && raw.subagent_role || void 0;
  const continuationActive = typeof raw.continuationActive === "boolean" ? raw.continuationActive : typeof raw.continuation_active === "boolean" ? raw.continuation_active : void 0;
  const transcriptPath = typeof raw.transcriptPath === "string" && raw.transcriptPath || typeof raw.transcript_path === "string" && raw.transcript_path || void 0;
  const lastUserInput = typeof raw.lastUserInput === "string" && raw.lastUserInput || typeof raw.last_user_input === "string" && raw.last_user_input || void 0;
  const terminationReason = typeof raw.terminationReason === "string" && raw.terminationReason || typeof raw.termination_reason === "string" && raw.termination_reason || void 0;
  const pluginData = typeof raw.pluginData === "string" && raw.pluginData || typeof raw.plugin_data === "string" && raw.plugin_data || void 0;
  const toolCallId = typeof toolCall?.id === "string" && toolCall.id || typeof raw.toolCallId === "string" && raw.toolCallId || void 0;
  const stepIdx = typeof raw.stepIdx === "number" ? raw.stepIdx : typeof raw.step_idx === "number" ? raw.step_idx : void 0;
  return {
    event,
    conversationId,
    parentConversationId,
    agentRole,
    continuationActive,
    workspacePaths,
    workspaceRoot: singleWorkspace,
    cwd: typeof raw.cwd === "string" ? raw.cwd : singleWorkspace,
    transcriptPath,
    lastUserInput,
    terminationReason,
    error: raw.error,
    stepIdx,
    toolCallId,
    toolName,
    toolInput,
    pluginData,
    raw
  };
}

// src/modules/guard/hook.ts
var import_node_path6 = __toESM(require("node:path"), 1);

// src/modules/guard/policy.ts
var import_node_path4 = __toESM(require("node:path"), 1);
var VALID_PERMISSION_MODES = /* @__PURE__ */ new Set([
  "readonly-audit",
  "balanced-dev",
  "strict-gate"
]);
var MUTATING_FILE_TOOL_NAMES = /* @__PURE__ */ new Set([
  "edit_file",
  "write_file",
  "write_to_file",
  "create_file",
  "patch_file",
  "apply_patch",
  "replace_file_content",
  "multi_replace_file_content",
  "replace_in_file",
  "str_replace_editor",
  "delete_file",
  "remove_file",
  "rm_file",
  "unlink_file",
  "move_file",
  "rename_file",
  "write",
  "edit",
  "multi_edit",
  "multiedit",
  "notebook_edit",
  "notebookedit"
]);
var COMMAND_EXEC_TOOL_NAMES = /* @__PURE__ */ new Set([
  "run_command",
  "run_shell_command",
  "run_terminal_command",
  "send_command_input",
  "exec_command",
  "bash",
  "shell",
  "execute_command"
]);
function normalizeGuardToolName(toolName) {
  const trimmed = toolName.trim().toLowerCase();
  const sepIdx = Math.max(trimmed.lastIndexOf(":"), trimmed.lastIndexOf("/"));
  return sepIdx >= 0 ? trimmed.slice(sepIdx + 1) : trimmed;
}
function normalizePermissionMode(value) {
  if (typeof value === "string" && VALID_PERMISSION_MODES.has(value)) {
    return value;
  }
  return "balanced-dev";
}
function isMutatingFileToolName(toolName) {
  return MUTATING_FILE_TOOL_NAMES.has(normalizeGuardToolName(toolName));
}
function isCommandExecToolName(toolName) {
  return COMMAND_EXEC_TOOL_NAMES.has(normalizeGuardToolName(toolName));
}
var DECISION_SEVERITY = {
  allow: 0,
  ask: 1,
  force_ask: 2,
  deny: 3
};
var SECRET_PATTERNS = [
  {
    ruleId: "secret.private-key",
    label: "Private Key Block",
    severity: "critical",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g
  },
  {
    ruleId: "secret.aws-access-key",
    label: "AWS Access Key ID",
    severity: "critical",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g
  },
  {
    ruleId: "secret.github-token",
    label: "GitHub Personal Access Token",
    severity: "critical",
    regex: /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|gho_[A-Za-z0-9]{30,})\b/g
  },
  {
    ruleId: "secret.google-api-key",
    label: "Google / Gemini API Key",
    severity: "high",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g
  },
  {
    ruleId: "secret.openai-anthropic",
    label: "OpenAI / Anthropic / Stripe Secret Key",
    severity: "critical",
    regex: /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{32,})\b/g
  },
  {
    ruleId: "secret.slack-token",
    label: "Slack API Token",
    severity: "high",
    regex: /\bxox[baprs]-[0-9A-Za-z-]{16,}\b/g
  },
  {
    ruleId: "secret.jwt-bearer",
    label: "Hardcoded Bearer JWT",
    severity: "high",
    regex: /Bearer\s+eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
  },
  {
    ruleId: "secret.generic-assignment",
    label: "Hardcoded Secret Assignment",
    severity: "medium",
    regex: /\b(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|PRIVATE_TOKEN|DB_PASSWORD|DATABASE_PASSWORD)\s*[:=]\s*['"`](?!YOUR_|REPLACE_|EXAMPLE_|TEST_|DUMMY_|<|\$\{)[A-Za-z0-9_/+=-]{18,}['"`]/g
  }
];
var SAFE_ENV_SUFFIXES = [".example", ".sample", ".template", ".dist"];
var SENSITIVE_BASENAMES = /* @__PURE__ */ new Set([
  ".env",
  ".npmrc",
  ".netrc",
  ".pypirc",
  "id_rsa",
  "id_ed25519",
  "id_dsa",
  "id_ecdsa",
  "credentials",
  "secrets.yaml",
  "secrets.yml",
  "secrets.json",
  "master.key"
]);
var SHELL_SENSITIVE_BASENAMES = /* @__PURE__ */ new Set([
  "id_rsa",
  "id_ed25519",
  "id_dsa",
  "id_ecdsa",
  ".netrc",
  ".npmrc",
  ".pypirc"
]);
var SENSITIVE_EXTENSIONS = /* @__PURE__ */ new Set([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"]);
var SENSITIVE_PATH_REGEXES = [
  { ruleId: "path.ssh-dir", regex: /(?:^|[/\\])\.ssh(?:[/\\]|$)/i, label: "SSH key directory (~/.ssh)" },
  { ruleId: "path.aws-dir", regex: /(?:^|[/\\])\.aws[/\\](?:credentials|config)(?:[/\\]|$)/i, label: "AWS credentials directory" },
  { ruleId: "path.kube-config", regex: /(?:^|[/\\])\.kube[/\\]config$/i, label: "Kubernetes config" },
  { ruleId: "path.gcp-sa", regex: /service[-_]?account.*\.json$/i, label: "GCP service account JSON" },
  { ruleId: "path.gnupg", regex: /(?:^|[/\\])\.gnupg(?:[/\\]|$)/i, label: "GPG private keyring" }
];
var DESTRUCTIVE_COMMAND_RULES = [
  {
    ruleId: "cmd.git-force-push",
    regex: /\bgit\s+push\b[^\n]*(?:\s--force\b|\s-f\b|\s--force-with-lease\b)/,
    label: "Git force push"
  },
  {
    ruleId: "cmd.git-reset-hard",
    regex: /\bgit\s+(?:reset\s+--hard|clean\s+-[a-zA-Z]*f[a-zA-Z]*d)/,
    label: "Destructive git reset --hard / clean -fd"
  },
  {
    ruleId: "cmd.disk-format",
    regex: /\b(?:mkfs\.[a-z0-9]+|dd\s+if=.*of=\/dev\/|diskutil\s+eraseDisk)\b/i,
    label: "Raw disk wipe / format command"
  },
  {
    ruleId: "cmd.chmod-777",
    regex: /\bchmod\s+(?:-R\s+)?0?777\b/,
    label: "World-writable chmod 777 permission change"
  },
  {
    ruleId: "cmd.fork-bomb",
    regex: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    label: "Shell fork bomb"
  }
];
var SQL_DESTRUCTIVE_REGEX = /\b(?:DROP\s+(?:DATABASE|SCHEMA|TABLE)|TRUNCATE\s+TABLE)\b/i;
var NETWORK_PIPE_RULES = [
  {
    ruleId: "cmd.curl-pipe-shell",
    regex: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|fish|python3?|node)\b/,
    label: "Remote script piped directly into shell/interpreter"
  }
];
var CATASTROPHIC_SYSTEM_ROOT_PREFIX_RE = /^\/(?:etc|usr|bin|sbin|lib|lib64|boot|dev|proc|sys|root|System|Library)(?:\/|$)/;
var CATASTROPHIC_TOP_LEVEL_DIR_RE = /^\/(?:var|home|Users|Applications|opt)(?:\/?\*?)?$/;
function splitShellSegments(commandLine) {
  const segments = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (let i = 0; i < commandLine.length; i++) {
    const ch = commandLine[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      current += ch;
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    const next = commandLine[i + 1];
    if (ch === "\n" || ch === ";") {
      if (current.trim()) segments.push({ segment: current.trim(), pipedToNext: false });
      current = "";
      continue;
    }
    if (ch === "&" && next === "&" || ch === "|" && next === "|") {
      if (current.trim()) segments.push({ segment: current.trim(), pipedToNext: false });
      current = "";
      i++;
      continue;
    }
    if (ch === "|") {
      if (current.trim()) segments.push({ segment: current.trim(), pipedToNext: true });
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) segments.push({ segment: current.trim(), pipedToNext: false });
  return segments;
}
function tokenizeSimpleShellSegment(segment) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}
function stripCommandWrappers(tokens) {
  let idx = 0;
  while (idx < tokens.length) {
    const tok = tokens[idx];
    if (tok === "sudo" || tok === "env" || tok === "command" || tok === "nohup" || tok === "time") {
      idx++;
      while (idx < tokens.length && tokens[idx].startsWith("-")) {
        const flag = tokens[idx];
        idx++;
        if ((flag === "-u" || flag === "-g" || flag === "-C") && idx < tokens.length) idx++;
      }
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      idx++;
      continue;
    }
    break;
  }
  return tokens.slice(idx);
}
function isCatastrophicRmTarget(rawTarget) {
  const trimmed = rawTarget.trim();
  if (!trimmed) return false;
  const collapsed = trimmed.replace(/\/+/g, "/");
  const candidates = [collapsed];
  if (collapsed.startsWith("/")) {
    const normalizedAbs = import_node_path4.default.posix.normalize(collapsed);
    if (normalizedAbs !== collapsed) candidates.push(normalizedAbs);
  }
  for (const target of candidates) {
    if (target === "/" || target === "/*" || target === "/." || target === "~" || target === "~/" || target === "~/*" || target === "$HOME" || target === "$HOME/" || target === "$HOME/*" || target === "${HOME}" || target === "${HOME}/" || target === "${HOME}/*" || target === "*" || target === "." || target === "./" || target === "./*" || target === ".." || target === "../" || target === "../*") {
      return true;
    }
    if (CATASTROPHIC_SYSTEM_ROOT_PREFIX_RE.test(target)) return true;
    if (CATASTROPHIC_TOP_LEVEL_DIR_RE.test(target)) return true;
  }
  return false;
}
function isCatastrophicRmCommand(commandLine) {
  for (const { segment } of splitShellSegments(commandLine)) {
    const tokens = stripCommandWrappers(tokenizeSimpleShellSegment(segment));
    if (tokens.length < 2) continue;
    const cmd = import_node_path4.default.posix.basename(tokens[0].replace(/\\/g, "/"));
    if (cmd !== "rm") continue;
    let hasRecursive = false;
    let endOfFlags = false;
    const targets = [];
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!endOfFlags && tok === "--") {
        endOfFlags = true;
        continue;
      }
      if (!endOfFlags && tok.startsWith("--")) {
        if (tok === "--recursive") hasRecursive = true;
        continue;
      }
      if (!endOfFlags && tok.startsWith("-") && tok.length > 1) {
        if (/[rR]/.test(tok.slice(1))) hasRecursive = true;
        continue;
      }
      targets.push(tok);
    }
    if (hasRecursive && targets.some((t) => isCatastrophicRmTarget(t))) {
      return true;
    }
  }
  return false;
}
function hasUnquotedRedirection(segment) {
  let quote = null;
  let escaped = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return true;
  }
  return false;
}
function hasDangerousSqlCommand(commandLine) {
  if (!SQL_DESTRUCTIVE_REGEX.test(commandLine)) return false;
  const segments = splitShellSegments(commandLine);
  for (const { segment, pipedToNext } of segments) {
    if (!SQL_DESTRUCTIVE_REGEX.test(segment)) continue;
    const tokens = stripCommandWrappers(tokenizeSimpleShellSegment(segment));
    if (tokens.length === 0) return true;
    const cmd = import_node_path4.default.posix.basename(tokens[0].replace(/\\/g, "/")).toLowerCase();
    const sub = (tokens[1] ?? "").toLowerCase();
    const hasRedirection = hasUnquotedRedirection(segment);
    if (!pipedToNext && !hasRedirection) {
      if (cmd === "git" && (sub === "commit" || sub === "log" || sub === "tag")) {
        continue;
      }
      if (cmd === "grep" || cmd === "egrep" || cmd === "fgrep" || cmd === "rg" || cmd === "ag") {
        continue;
      }
      if (cmd === "echo" || cmd === "printf") {
        continue;
      }
    }
    return true;
  }
  return false;
}
function isSafeEnvBasename(lowerBase) {
  return lowerBase.startsWith(".env.") && SAFE_ENV_SUFFIXES.some((s) => lowerBase.endsWith(s));
}
function detectCommandSensitiveAccess(commandLine, customProtectedPaths) {
  const rawTokens = commandLine.split(/[\s"'`()\[\]{}<>|&;,=@:]+/).filter(Boolean);
  for (const rawTok of rawTokens) {
    const norm = rawTok.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!norm || norm === "-" || norm === "--") continue;
    const base = import_node_path4.default.posix.basename(norm);
    const lowerBase = base.toLowerCase();
    if (lowerBase === ".env" || lowerBase === ".envrc" || lowerBase.startsWith(".env.") || /^\.env[*?[]/.test(lowerBase)) {
      if (!isSafeEnvBasename(lowerBase)) {
        return {
          ruleId: "cmd.read-env-secret",
          category: "sensitive-file",
          label: `Shell access/exfiltration of .env file (${base})`
        };
      }
      continue;
    }
    if (/(?:^|\/)\.ssh(?:\/|$)/i.test(norm)) {
      return {
        ruleId: "cmd.read-ssh-aws",
        category: "sensitive-file",
        label: "Shell access/exfiltration of SSH directory"
      };
    }
    if (/(?:^|\/)\.aws\/(?:credentials|config)(?:\/|$)/i.test(norm)) {
      return {
        ruleId: "cmd.read-ssh-aws",
        category: "sensitive-file",
        label: "Shell access/exfiltration of AWS credentials"
      };
    }
    if (/(?:^|\/)\.gnupg(?:\/|$)/i.test(norm)) {
      return {
        ruleId: "cmd.read-ssh-aws",
        category: "sensitive-file",
        label: "Shell access/exfiltration of GPG private keyring"
      };
    }
    if (/(?:^|\/)\.kube\/config$/i.test(norm)) {
      return {
        ruleId: "cmd.read-ssh-aws",
        category: "sensitive-file",
        label: "Shell access/exfiltration of Kubernetes config"
      };
    }
    if (SHELL_SENSITIVE_BASENAMES.has(lowerBase)) {
      return {
        ruleId: "cmd.read-ssh-aws",
        category: "sensitive-file",
        label: `Shell access/exfiltration of credential file (${base})`
      };
    }
    for (const rawPat of customProtectedPaths) {
      const pat = rawPat.trim();
      if (!pat) continue;
      if (norm.toLowerCase().includes(pat.toLowerCase())) {
        return {
          ruleId: "custom.path",
          category: "custom",
          label: `Custom protected path rule (${pat})`
        };
      }
    }
  }
  return null;
}
function maskSecret(raw) {
  const clean = raw.trim();
  if (clean.length <= 10) return `${clean.slice(0, 2)}****`;
  return `${clean.slice(0, 5)}****${clean.slice(-3)}`;
}
function redactCommand(cmd) {
  if (!cmd) return "";
  let out = cmd;
  out = out.replace(
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----|$)/g,
    (match) => match.includes("****") ? match : maskSecret(match)
  );
  out = out.replace(
    /\b((?:Bearer|Basic|Token)\s+)([A-Za-z0-9._~+/=-]{6,})/gi,
    (full, prefix, token) => token.includes("****") ? full : `${prefix}${maskSecret(token)}`
  );
  out = out.replace(
    /([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)([^@\s]+)@/gi,
    (full, prefix, secret) => secret.includes("****") ? full : `${prefix}${maskSecret(secret)}@`
  );
  out = out.replace(
    /((?:^|\s)(?:-u|--user)(?:\s+|=))([^:\s'"]+):([^\s'"]+)/g,
    (full, flag, user, pass) => pass.includes("****") ? full : `${flag}${user}:${maskSecret(pass)}`
  );
  for (const pat of SECRET_PATTERNS) {
    pat.regex.lastIndex = 0;
    out = out.replace(pat.regex, (match) => match.includes("****") ? match : maskSecret(match));
  }
  out = out.replace(
    /(^|[\s"'`({;,])((?:--)?[A-Za-z0-9_.-]*(?:key|secret|token|password|passwd|pwd|credential|auth|cookie)[A-Za-z0-9_.-]*['"`]?\s*[:=]\s*)(['"`]?)([^\s'"`;|&(){}]{4,})(\3)/gi,
    (full, lead, prefix, quote, val, endQuote) => {
      if (val.includes("****")) return full;
      if (/^\$(?:\{[A-Za-z0-9_]+\}|[A-Za-z0-9_]+)$/.test(val)) return full;
      if (/^(?:true|false|null|none|undefined|bearer|basic|token|digest|oauth)$/i.test(val)) return full;
      return `${lead}${prefix}${quote}${maskSecret(val)}${endQuote}`;
    }
  );
  return out;
}
function scanTextForSecrets(text) {
  if (!text) return [];
  const findings = [];
  const seen = /* @__PURE__ */ new Set();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    if (!lineText || lineText.length > 2e4) continue;
    for (const pat of SECRET_PATTERNS) {
      pat.regex.lastIndex = 0;
      let match;
      while ((match = pat.regex.exec(lineText)) !== null) {
        const masked = maskSecret(match[0]);
        const key = `${pat.ruleId}:${i + 1}:${masked}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          ruleId: pat.ruleId,
          label: pat.label,
          severity: pat.severity,
          line: i + 1,
          preview: masked
        });
        if (findings.length >= 25) return findings;
      }
    }
  }
  return findings;
}
function isSensitivePath(filePath, customPatterns = []) {
  if (!filePath) return { sensitive: false };
  const normalized = filePath.replace(/\\/g, "/").trim().replace(/\/+$/, "");
  if (!normalized) return { sensitive: false };
  const base = import_node_path4.default.posix.basename(normalized);
  const lowerBase = base.toLowerCase();
  for (const rule of SENSITIVE_PATH_REGEXES) {
    if (rule.regex.test(normalized)) {
      return { sensitive: true, ruleId: rule.ruleId, label: rule.label };
    }
  }
  for (const rawPat of customPatterns) {
    const pat = rawPat.trim();
    if (!pat) continue;
    if (normalized.toLowerCase().includes(pat.toLowerCase())) {
      return { sensitive: true, ruleId: "custom.path", label: `Custom protected path rule (${pat})` };
    }
  }
  if (isSafeEnvBasename(lowerBase)) {
    return { sensitive: false };
  }
  if (lowerBase === ".env" || lowerBase === ".envrc" || lowerBase.startsWith(".env.")) {
    return { sensitive: true, ruleId: "path.dotenv", label: `Environment secrets file (${base})` };
  }
  if (SENSITIVE_BASENAMES.has(lowerBase)) {
    return { sensitive: true, ruleId: "path.sensitive-file", label: `Protected credential file (${base})` };
  }
  const ext = import_node_path4.default.posix.extname(lowerBase);
  if (SENSITIVE_EXTENSIONS.has(ext)) {
    return { sensitive: true, ruleId: "path.private-key-ext", label: `Private key / certificate file (${base})` };
  }
  return { sensitive: false };
}
function extractTargetPath(args) {
  const candidates = [
    args.Path,
    args.path,
    args.TargetFile,
    args.targetFile,
    args.target_file,
    args.TargetPath,
    args.targetPath,
    args.target_path,
    args.AbsolutePath,
    args.absolutePath,
    args.absolute_path,
    args.filePath,
    args.file_path,
    args.FilePath
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}
function extractCommandLine(args) {
  const candidates = [args.CommandLine, args.commandLine, args.command, args.cmd];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}
function extractWritePayload(args) {
  const parts = [];
  const directKeys = [
    "Content",
    "content",
    "CodeContent",
    "Replacement",
    "replacement",
    "ReplacementContent",
    "new_str",
    "newString",
    "patch",
    "Patch",
    "diff",
    "Diff",
    "input",
    "Input",
    "text",
    "Text",
    "body",
    "Body",
    "file_text"
  ];
  for (const key of directKeys) {
    if (typeof args[key] === "string") parts.push(args[key]);
  }
  if (Array.isArray(args.ReplacementChunks)) {
    for (const chunk of args.ReplacementChunks) {
      if (chunk && typeof chunk === "object" && typeof chunk.ReplacementContent === "string") {
        parts.push(chunk.ReplacementContent);
      }
    }
  }
  return parts.join("\n");
}
function evaluatePermissionModeGate(toolName, policy, args) {
  const mode = normalizePermissionMode(policy.permissionMode);
  if (mode === "balanced-dev") return null;
  const hasCmd = Boolean(args && extractCommandLine(args));
  const restricted = isMutatingFileToolName(toolName) || isCommandExecToolName(toolName) || hasCmd;
  if (!restricted) return null;
  if (mode === "readonly-audit") {
    return {
      decision: "deny",
      category: "permission-mode",
      ruleId: "mode.readonly-audit",
      reason: `Blocked ${toolName}: Guard permission mode is readonly-audit (read-only)`,
      findings: []
    };
  }
  if (mode === "strict-gate") {
    return {
      decision: "force_ask",
      category: "permission-mode",
      ruleId: "mode.strict-gate",
      reason: `Confirmation required for ${toolName}: Guard permission mode is strict-gate`,
      findings: []
    };
  }
  return null;
}
function finalizeEvaluation(highRiskEval, toolName, policy, args) {
  if (highRiskEval && highRiskEval.decision === "deny") {
    return highRiskEval;
  }
  const modeEval = evaluatePermissionModeGate(toolName, policy, args);
  if (highRiskEval && modeEval) {
    if (DECISION_SEVERITY[modeEval.decision] > DECISION_SEVERITY[highRiskEval.decision]) {
      return {
        ...highRiskEval,
        decision: modeEval.decision,
        reason: `${highRiskEval.reason} (${modeEval.ruleId})`
      };
    }
    return highRiskEval;
  }
  if (highRiskEval) return highRiskEval;
  if (modeEval) return modeEval;
  return { decision: "allow", category: "safe", reason: "Passed all guardrails", findings: [] };
}
function evaluateToolCall(toolName, args, policy, options) {
  if (!policy.enabled) {
    return { decision: "allow", category: "safe", reason: "Guard policy disabled", findings: [] };
  }
  const lowerTool = toolName.trim().toLowerCase();
  const targetPath = extractTargetPath(args);
  const commandLine = extractCommandLine(args);
  let highRiskEval = null;
  if (targetPath && policy.protectEnvAndKeys !== "allow") {
    const check = isSensitivePath(targetPath, policy.customProtectedPaths);
    if (check.sensitive) {
      highRiskEval = {
        decision: policy.protectEnvAndKeys,
        category: check.ruleId?.startsWith("custom.") ? "custom" : "sensitive-file",
        ruleId: check.ruleId,
        reason: `Blocked ${toolName} on protected path: ${check.label} (${import_node_path4.default.basename(targetPath)})`,
        findings: []
      };
    } else if (options?.resolvedTargetPath && options.resolvedTargetPath !== targetPath) {
      const realCheck = isSensitivePath(options.resolvedTargetPath, policy.customProtectedPaths);
      if (realCheck.sensitive) {
        highRiskEval = {
          decision: policy.protectEnvAndKeys,
          category: realCheck.ruleId?.startsWith("custom.") ? "custom" : "sensitive-file",
          ruleId: realCheck.ruleId,
          reason: `Blocked ${toolName} via symlink resolving to protected path: ${realCheck.label} (${import_node_path4.default.basename(options.resolvedTargetPath)})`,
          findings: []
        };
      }
    }
  }
  if (highRiskEval) {
    return finalizeEvaluation(highRiskEval, toolName, policy, args);
  }
  const isMutatingFileTool = MUTATING_FILE_TOOL_NAMES.has(lowerTool) || /write|edit|replace|patch_file|apply_patch|create_file|patch/.test(lowerTool);
  if (isMutatingFileTool && policy.blockSecretWrites !== "allow") {
    const payload = extractWritePayload(args);
    if (payload) {
      const findings = scanTextForSecrets(payload);
      if (findings.length > 0) {
        const summary = findings.slice(0, 3).map((f) => `${f.label} (${f.preview})`).join(", ");
        return finalizeEvaluation(
          {
            decision: policy.blockSecretWrites,
            category: "secret-leak",
            ruleId: findings[0].ruleId,
            reason: `Detected ${findings.length} potential secret(s) in ${toolName} payload: ${summary}`,
            findings
          },
          toolName,
          policy,
          args
        );
      }
    }
  }
  if (commandLine) {
    if (policy.blockDestructiveCommands !== "allow") {
      if (isCatastrophicRmCommand(commandLine)) {
        return finalizeEvaluation(
          {
            decision: policy.blockDestructiveCommands,
            category: "destructive-command",
            ruleId: "cmd.rm-rf-root",
            reason: "Blocked dangerous command: Catastrophic recursive delete (rm -r/-rf targeting /, ~, $HOME, or system root)",
            findings: []
          },
          toolName,
          policy,
          args
        );
      }
      if (hasDangerousSqlCommand(commandLine)) {
        return finalizeEvaluation(
          {
            decision: policy.blockDestructiveCommands,
            category: "destructive-command",
            ruleId: "cmd.sql-drop",
            reason: "Blocked dangerous command: Destructive SQL DROP/TRUNCATE statement",
            findings: []
          },
          toolName,
          policy,
          args
        );
      }
      for (const rule of DESTRUCTIVE_COMMAND_RULES) {
        if (rule.regex.test(commandLine)) {
          return finalizeEvaluation(
            {
              decision: policy.blockDestructiveCommands,
              category: "destructive-command",
              ruleId: rule.ruleId,
              reason: `Blocked dangerous command: ${rule.label}`,
              findings: []
            },
            toolName,
            policy,
            args
          );
        }
      }
    }
    for (const custom of policy.customBlockedCommands) {
      const trimmed = custom.trim();
      if (trimmed && commandLine.toLowerCase().includes(trimmed.toLowerCase())) {
        return finalizeEvaluation(
          {
            decision: "deny",
            category: "custom",
            ruleId: "custom.command",
            reason: `Matched custom blocked command pattern: "${trimmed}"`,
            findings: []
          },
          toolName,
          policy,
          args
        );
      }
    }
    if (policy.protectEnvAndKeys !== "allow") {
      const hit = detectCommandSensitiveAccess(commandLine, policy.customProtectedPaths);
      if (hit) {
        return finalizeEvaluation(
          {
            decision: policy.protectEnvAndKeys,
            category: hit.category,
            ruleId: hit.ruleId,
            reason: `Blocked credential access in shell: ${hit.label}`,
            findings: []
          },
          toolName,
          policy,
          args
        );
      }
    }
    if (policy.askOnNetworkPipes !== "allow") {
      for (const rule of NETWORK_PIPE_RULES) {
        if (rule.regex.test(commandLine)) {
          return finalizeEvaluation(
            {
              decision: policy.askOnNetworkPipes,
              category: "network-pipe",
              ruleId: rule.ruleId,
              reason: `Requires confirmation: ${rule.label}`,
              findings: []
            },
            toolName,
            policy,
            args
          );
        }
      }
    }
    if (policy.blockSecretWrites !== "allow") {
      const cmdSecrets = scanTextForSecrets(commandLine);
      if (cmdSecrets.length > 0) {
        return finalizeEvaluation(
          {
            decision: policy.blockSecretWrites,
            category: "secret-leak",
            ruleId: cmdSecrets[0].ruleId,
            reason: `Command contains inline secret (${cmdSecrets[0].label}: ${cmdSecrets[0].preview})`,
            findings: cmdSecrets
          },
          toolName,
          policy,
          args
        );
      }
    }
  }
  return finalizeEvaluation(null, toolName, policy, args);
}

// src/modules/guard/store.ts
var import_node_crypto2 = __toESM(require("node:crypto"), 1);
var import_node_fs4 = __toESM(require("node:fs"), 1);
var import_node_path5 = __toESM(require("node:path"), 1);

// src/modules/guard/types.ts
var DEFAULT_POLICY = {
  enabled: true,
  permissionMode: "balanced-dev",
  protectEnvAndKeys: "deny",
  blockSecretWrites: "deny",
  blockDestructiveCommands: "deny",
  askOnNetworkPipes: "ask",
  autoSnapshotBeforeEdit: true,
  maxSnapshotsPerFile: 30,
  maxSnapshotFileBytes: 1048576,
  customProtectedPaths: [],
  customBlockedCommands: []
};

// src/modules/guard/store.ts
var SHA256_HEX_RE = /^[a-f0-9]{64}$/;
var MAX_SYMLINK_DEPTH = 20;
var TURN_GROUP_WINDOW_MS = 9e4;
var TURN_STEP_MAX_GAP = 4;
var TURN_STEP_MAX_WINDOW_MS = 5 * 6e4;
var BACKUP_TOOL_NAMES = /* @__PURE__ */ new Set(["pre_restore_backup", "pre_rewind_backup"]);
function ensureDir(dir) {
  import_node_fs4.default.mkdirSync(dir, { recursive: true, mode: 448 });
  try {
    import_node_fs4.default.chmodSync(dir, 448);
  } catch {
  }
}
function writePrivateJson(filePath, data) {
  ensureDir(import_node_path5.default.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${import_node_crypto2.default.randomBytes(4).toString("hex")}.tmp`;
  import_node_fs4.default.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}
`, { encoding: "utf8", mode: 384 });
  try {
    import_node_fs4.default.chmodSync(tmp, 384);
  } catch {
  }
  import_node_fs4.default.renameSync(tmp, filePath);
}
function resolveRealPathWithMissingTail(inputPath, depth = 0) {
  if (depth > MAX_SYMLINK_DEPTH) {
    throw new Error(`Too many levels of symbolic links: ${inputPath}`);
  }
  const resolved = import_node_path5.default.resolve(inputPath);
  const missingSegments = [];
  let current = resolved;
  while (true) {
    try {
      const realBase = import_node_fs4.default.realpathSync(current);
      return missingSegments.length > 0 ? import_node_path5.default.join(realBase, ...missingSegments.reverse()) : realBase;
    } catch (err) {
      const code = err?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw err;
      }
      try {
        const lstat = import_node_fs4.default.lstatSync(current);
        if (lstat.isSymbolicLink()) {
          const linkTarget = import_node_fs4.default.readlinkSync(current);
          const resolvedLink = import_node_path5.default.resolve(import_node_path5.default.dirname(current), linkTarget);
          const nextTarget = missingSegments.length > 0 ? import_node_path5.default.join(resolvedLink, ...missingSegments.reverse()) : resolvedLink;
          return resolveRealPathWithMissingTail(nextTarget, depth + 1);
        }
      } catch {
      }
      const parent = import_node_path5.default.dirname(current);
      if (parent === current) {
        return resolved;
      }
      missingSegments.push(import_node_path5.default.basename(current));
      current = parent;
    }
  }
}
function assertInsideWorkspace(workspaceRoot, targetPath) {
  if (!workspaceRoot || workspaceRoot.includes("\0")) {
    throw new Error("Invalid workspace root path");
  }
  if (!targetPath || targetPath.includes("\0")) {
    throw new Error("Invalid target path");
  }
  const realRoot = resolveRealPathWithMissingTail(workspaceRoot);
  const candidate = import_node_path5.default.isAbsolute(targetPath) ? targetPath : import_node_path5.default.resolve(workspaceRoot, targetPath);
  const realTarget = resolveRealPathWithMissingTail(candidate);
  const rootPrefix = realRoot.endsWith(import_node_path5.default.sep) ? realRoot : `${realRoot}${import_node_path5.default.sep}`;
  if (realTarget !== realRoot && !realTarget.startsWith(rootPrefix)) {
    throw new Error(`Path escapes workspace boundary: ${targetPath}`);
  }
  return realTarget;
}
function assertNotSensitive(rawPath, realPath, customProtectedPaths, action) {
  const rawCheck = isSensitivePath(rawPath, customProtectedPaths);
  const realCheck = isSensitivePath(realPath, customProtectedPaths);
  if (rawCheck.sensitive || realCheck.sensitive) {
    const label = rawCheck.label ?? realCheck.label ?? import_node_path5.default.basename(realPath);
    throw new Error(`Refused to ${action} sensitive path: ${label}`);
  }
}
function readJsonSafe(filePath, fallback) {
  try {
    if (!import_node_fs4.default.existsSync(filePath)) return fallback;
    return JSON.parse(import_node_fs4.default.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}
function sha256Buffer(buf) {
  return import_node_crypto2.default.createHash("sha256").update(buf).digest("hex");
}
function loadPolicy(dataDir) {
  const stored = readJsonSafe(import_node_path5.default.join(dataDir, "policy.json"), {});
  return {
    ...DEFAULT_POLICY,
    ...stored,
    permissionMode: normalizePermissionMode(stored.permissionMode)
  };
}
function sanitizeTurnSegment(raw) {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  return cleaned || "session";
}
function deriveTurnKey(dataDir, params = {}) {
  const nowMs = typeof params.nowMs === "number" && Number.isFinite(params.nowMs) ? params.nowMs : Date.now();
  const convId = typeof params.conversationId === "string" && params.conversationId.trim() ? params.conversationId.trim() : void 0;
  const stepIdx = typeof params.stepIdx === "number" && Number.isFinite(params.stepIdx) ? params.stepIdx : void 0;
  const existing = loadSnapshots(dataDir);
  if (convId) {
    const recent = existing.find(
      (s) => !s.isDemo && !s.restoredFromId && !BACKUP_TOOL_NAMES.has(s.toolName) && s.conversationId === convId && typeof s.turnKey === "string" && s.turnKey.length > 0
    );
    if (recent?.turnKey) {
      const prevMs = Date.parse(recent.createdAt);
      if (Number.isFinite(prevMs)) {
        const deltaMs = nowMs - prevMs;
        const withinTimeWindow = deltaMs <= TURN_GROUP_WINDOW_MS && deltaMs >= -5e3;
        const withinStepWindow = stepIdx !== void 0 && typeof recent.stepIdx === "number" && Math.abs(stepIdx - recent.stepIdx) <= TURN_STEP_MAX_GAP && deltaMs <= TURN_STEP_MAX_WINDOW_MS && deltaMs >= -5e3;
        if (withinTimeWindow || withinStepWindow) {
          return recent.turnKey;
        }
      }
    }
    const windowBucket2 = Math.floor(nowMs / TURN_GROUP_WINDOW_MS);
    return `turn:${sanitizeTurnSegment(convId)}:${windowBucket2}`;
  }
  const recentLocal = existing.find(
    (s) => !s.isDemo && !s.restoredFromId && !BACKUP_TOOL_NAMES.has(s.toolName) && !s.conversationId && typeof s.turnKey === "string" && s.turnKey.length > 0
  );
  if (recentLocal?.turnKey) {
    const prevMs = Date.parse(recentLocal.createdAt);
    if (Number.isFinite(prevMs)) {
      const deltaMs = nowMs - prevMs;
      if (deltaMs <= TURN_GROUP_WINDOW_MS && deltaMs >= -5e3) {
        return recentLocal.turnKey;
      }
    }
  }
  const windowBucket = Math.floor(nowMs / TURN_GROUP_WINDOW_MS);
  return `turn:workspace:${windowBucket}`;
}
function loadSnapshots(dataDir) {
  return readJsonSafe(import_node_path5.default.join(dataDir, "snapshots.json"), []);
}
function saveSnapshots(dataDir, records) {
  writePrivateJson(import_node_path5.default.join(dataDir, "snapshots.json"), records);
}
function loadAuditLog(dataDir) {
  return readJsonSafe(import_node_path5.default.join(dataDir, "audit.json"), []);
}
function appendAuditEvent(dataDir, event) {
  const existing = loadAuditLog(dataDir);
  const full = {
    id: event.id ?? `evt_${import_node_crypto2.default.randomBytes(5).toString("hex")}`,
    timestamp: event.timestamp ?? (/* @__PURE__ */ new Date()).toISOString(),
    event: event.event,
    toolName: event.toolName,
    decision: event.decision,
    category: event.category,
    target: redactCommand(event.target),
    summary: redactCommand(event.summary),
    ruleId: event.ruleId,
    snapshotId: event.snapshotId,
    isDemo: event.isDemo
  };
  const next = [full, ...existing].slice(0, 200);
  writePrivateJson(import_node_path5.default.join(dataDir, "audit.json"), next);
  return full;
}
function blobPath(dataDir, hash) {
  if (!SHA256_HEX_RE.test(hash)) {
    throw new Error("Invalid snapshot blob hash: expected 64 lowercase hexadecimal characters");
  }
  return import_node_path5.default.join(dataDir, "blobs", `${hash}.blob`);
}
function capturePreEditSnapshot(params) {
  const { dataDir, toolName, reason, policy, workspaceRoot, restoredFromId, turnKey, conversationId, stepIdx } = params;
  const realRoot = assertInsideWorkspace(workspaceRoot, workspaceRoot);
  const safePath = assertInsideWorkspace(workspaceRoot, params.filePath);
  assertNotSensitive(params.filePath, safePath, policy.customProtectedPaths, "snapshot");
  const relPath = import_node_path5.default.relative(realRoot, safePath) || import_node_path5.default.basename(safePath);
  const existed = import_node_fs4.default.existsSync(safePath);
  let sha256 = "EMPTY_FILE";
  let sizeBytes = 0;
  let lineCount = 0;
  if (existed) {
    const stat = import_node_fs4.default.statSync(safePath);
    if (!stat.isFile() || stat.size > policy.maxSnapshotFileBytes) {
      return null;
    }
    const raw = import_node_fs4.default.readFileSync(safePath);
    if (raw.includes(0)) return null;
    sha256 = sha256Buffer(raw);
    sizeBytes = raw.byteLength;
    lineCount = raw.toString("utf8").split(/\r?\n/).length;
    const targetBlob = blobPath(dataDir, sha256);
    if (!import_node_fs4.default.existsSync(targetBlob)) {
      ensureDir(import_node_path5.default.dirname(targetBlob));
      import_node_fs4.default.writeFileSync(targetBlob, raw, { mode: 384 });
      try {
        import_node_fs4.default.chmodSync(targetBlob, 384);
      } catch {
      }
    }
  }
  const isManualCheckpoint = toolName === "guard_create_checkpoint" || toolName === "create_checkpoint";
  const all = loadSnapshots(dataDir);
  const latestForFile = all.find((s) => s.filePath === safePath && !s.isDemo);
  const sameTurn = (latestForFile?.turnKey ?? void 0) === (turnKey ?? void 0);
  if (latestForFile && sameTurn && latestForFile.sha256 === sha256 && latestForFile.existed === existed && !isManualCheckpoint && !restoredFromId) {
    return latestForFile;
  }
  let createdMs = Date.now();
  const newestPrevMs = all.reduce((max, s) => {
    const t = Date.parse(s.createdAt);
    return Number.isFinite(t) && t > max ? t : max;
  }, 0);
  if (newestPrevMs >= createdMs && newestPrevMs - createdMs < 6e4) {
    createdMs = newestPrevMs + 1;
  }
  const record = {
    id: `snap_${createdMs.toString(36)}_${import_node_crypto2.default.randomBytes(3).toString("hex")}`,
    filePath: safePath,
    relPath,
    toolName,
    reason,
    createdAt: new Date(createdMs).toISOString(),
    sha256,
    sizeBytes,
    lineCount,
    existed,
    ...turnKey ? { turnKey } : {},
    ...conversationId ? { conversationId } : {},
    ...typeof stepIdx === "number" && Number.isFinite(stepIdx) ? { stepIdx } : {},
    ...restoredFromId ? { restoredFromId } : {}
  };
  const sameFile = [record, ...all.filter((s) => s.filePath === safePath)].slice(0, policy.maxSnapshotsPerFile);
  const others = all.filter((s) => s.filePath !== safePath);
  const next = [...sameFile, ...others].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300);
  saveSnapshots(dataDir, next);
  appendAuditEvent(dataDir, {
    event: isManualCheckpoint ? "Checkpoint" : "PreToolUse",
    toolName,
    decision: "snapshot",
    category: "time-machine",
    target: relPath,
    summary: existed ? `Saved pre-edit snapshot (${lineCount} lines, ${sizeBytes} B) before ${toolName}` : `Recorded pre-create marker before ${toolName} creates ${relPath}`,
    snapshotId: record.id
  });
  return record;
}

// src/modules/guard/hook.ts
function handleGuardPreToolHook(payload, rootDataDir) {
  if (payload.event !== "PreToolUse") {
    return { decision: "allow" };
  }
  const moduleDataDir = getModuleDataDir(rootDataDir, "guard");
  const workspaceRoot = payload.workspaceRoot || payload.cwd || payload.workspacePaths[0] || process.cwd();
  const toolName = payload.toolName ?? "";
  const toolInput = payload.toolInput ?? {};
  const policy = loadPolicy(moduleDataDir);
  const targetPath = extractTargetPath(toolInput);
  let resolvedTargetPath;
  let symlinkLoopBlocked = false;
  if (targetPath) {
    const absTarget = import_node_path6.default.isAbsolute(targetPath) ? targetPath : import_node_path6.default.resolve(workspaceRoot, targetPath);
    try {
      resolvedTargetPath = resolveRealPathWithMissingTail(absTarget);
    } catch {
      symlinkLoopBlocked = true;
    }
  }
  const evalResult = symlinkLoopBlocked && policy.enabled && policy.protectEnvAndKeys !== "allow" ? {
    decision: policy.protectEnvAndKeys,
    category: "sensitive-file",
    ruleId: "path.symlink-loop",
    reason: `Blocked ${toolName} on unresolvable/cyclic symlink target (${import_node_path6.default.basename(targetPath ?? "")})`,
    findings: []
  } : evaluateToolCall(toolName, toolInput, policy, { resolvedTargetPath });
  const commandLine = extractCommandLine(toolInput);
  const targetDisplay = targetPath ? import_node_path6.default.relative(workspaceRoot, import_node_path6.default.resolve(workspaceRoot, targetPath)) || import_node_path6.default.basename(targetPath) : commandLine ? redactCommand(commandLine).slice(0, 100) : toolName;
  if (evalResult.decision === "deny" || evalResult.decision === "ask" || evalResult.decision === "force_ask") {
    const safeReason = redactCommand(evalResult.reason);
    try {
      appendAuditEvent(moduleDataDir, {
        event: "PreToolUse",
        toolName,
        decision: evalResult.decision,
        category: evalResult.category,
        target: targetDisplay,
        summary: safeReason,
        ruleId: evalResult.ruleId
      });
    } catch {
    }
    return {
      decision: evalResult.decision,
      reason: `[Agy NOV Guard] ${safeReason}`
    };
  }
  if (policy.enabled && policy.autoSnapshotBeforeEdit && isMutatingFileToolName(toolName) && targetPath) {
    try {
      const resolvedPath = import_node_path6.default.isAbsolute(targetPath) ? targetPath : import_node_path6.default.resolve(workspaceRoot, targetPath);
      const turnKey = deriveTurnKey(moduleDataDir, {
        conversationId: payload.conversationId,
        stepIdx: payload.stepIdx
      });
      capturePreEditSnapshot({
        dataDir: moduleDataDir,
        filePath: resolvedPath,
        toolName,
        reason: `Automatic pre-edit snapshot before ${toolName}`,
        policy,
        workspaceRoot,
        turnKey,
        conversationId: payload.conversationId,
        stepIdx: payload.stepIdx
      });
    } catch {
    }
  }
  return { decision: "allow" };
}

// src/modules/mem/hook.ts
var import_node_fs6 = __toESM(require("node:fs"), 1);
var import_node_path8 = __toESM(require("node:path"), 1);

// src/modules/mem/store.ts
var import_node_crypto3 = __toESM(require("node:crypto"), 1);
var import_node_fs5 = __toESM(require("node:fs"), 1);
var import_node_path7 = __toESM(require("node:path"), 1);
var import_node_url = require("node:url");

// src/modules/mem/demo-memories.ts
function buildDemoMemories() {
  return [
    {
      id: "mem_demo_pkce",
      kind: "architecture",
      title: "Single-Flight OAuth2 PKCE Refresh Lock",
      content: "Concurrent 401 responses share one in-flight refresh promise keyed by sessionId with a 30s clock-skew margin to prevent duplicate refresh token rotation failures.",
      tags: ["auth", "oauth2", "concurrency"],
      workspacePath: "/workspace/demo-app",
      anchors: [
        { filePath: "/workspace/demo-app/src/auth/token-refresh.ts", basename: "token-refresh.ts", uri: "file:///workspace/demo-app/src/auth/token-refresh.ts", symbol: "refreshSessionToken", driftStatus: "fresh" },
        { filePath: "/workspace/demo-app/src/auth/singleflight-lock.ts", basename: "singleflight-lock.ts", uri: "file:///workspace/demo-app/src/auth/singleflight-lock.ts", symbol: "SingleFlightMap", driftStatus: "fresh" }
      ],
      pinned: true,
      createdAt: "2026-11-24T09:10:00Z",
      updatedAt: "2026-11-26T06:40:00Z",
      recallCount: 7,
      drifted: false
    },
    {
      id: "mem_demo_redis",
      kind: "pitfall",
      title: "Redis Pool Starvation Under Burst Checkout",
      content: "Never run sequential HGET calls inside checkout loops; batch via pipeline() with a 400ms circuit breaker fallback or p99 latency spikes past 850ms.",
      tags: ["redis", "performance", "checkout"],
      workspacePath: "/workspace/demo-app",
      anchors: [
        { filePath: "/workspace/demo-app/src/checkout/pricing-cache.ts", basename: "pricing-cache.ts", uri: "file:///workspace/demo-app/src/checkout/pricing-cache.ts", symbol: "fetchCartPrices", driftStatus: "drifted" }
      ],
      pinned: true,
      createdAt: "2026-11-22T14:20:00Z",
      updatedAt: "2026-11-25T15:02:00Z",
      recallCount: 5,
      drifted: true
    },
    {
      id: "mem_demo_stripe",
      kind: "decision",
      title: "Transactional Outbox for Billing Webhooks",
      content: "Persist webhook events into PostgreSQL outbox table within the same transaction before publishing to Kafka orders.v1 topic so duplicate Stripe retries remain idempotent.",
      tags: ["billing", "postgres", "kafka"],
      workspacePath: "/workspace/demo-app",
      anchors: [
        { filePath: "/workspace/demo-app/src/billing/webhook-handler.ts", basename: "webhook-handler.ts", uri: "file:///workspace/demo-app/src/billing/webhook-handler.ts", driftStatus: "fresh" }
      ],
      pinned: false,
      createdAt: "2026-11-21T11:00:00Z",
      updatedAt: "2026-11-24T17:12:00Z",
      recallCount: 3,
      drifted: false
    },
    {
      id: "mem_demo_style",
      kind: "convention",
      title: "Zero-Native-Addon Policy for Cross-Platform Plugins",
      content: "Prefer pure TypeScript + Node 20+ built-ins over native C++ addons (better-sqlite3/node-gyp) so users on macOS, Linux, and Windows never hit compilation errors.",
      tags: ["typescript", "packaging", "plugins"],
      workspacePath: "/workspace/demo-app",
      anchors: [
        { filePath: "/workspace/demo-app/package.json", basename: "package.json", uri: "file:///workspace/demo-app/package.json", driftStatus: "fresh" }
      ],
      pinned: true,
      createdAt: "2026-11-20T08:00:00Z",
      updatedAt: "2026-11-26T05:10:00Z",
      recallCount: 9,
      drifted: false
    },
    {
      id: "mem_demo_pref",
      kind: "preference",
      title: "Concise Chinese Summaries & English Code Comments",
      content: "Respond in concise Chinese with conclusions first; keep source code comments in clear English and always verify builds before reporting completion.",
      tags: ["workflow", "style"],
      anchors: [],
      pinned: false,
      createdAt: "2026-11-18T10:30:00Z",
      updatedAt: "2026-11-26T04:00:00Z",
      recallCount: 12,
      drifted: false
    }
  ];
}

// src/modules/mem/store.ts
var MAX_ANCHOR_FILE_BYTES = 2 * 1024 * 1024;
var MAX_SESSION_START_CHARS = 1200;
var PRIVATE_CONTENT_PLACEHOLDER = "[PRIVATE_CONTENT_STRIPPED]";
var PRIVATE_TITLE_PLACEHOLDER = "[PRIVATE_TITLE_STRIPPED]";
var PRIVATE_OPEN_PREFIX = "<private";
var PRIVATE_CLOSE_PREFIX = "</private";
var VALID_MEMORY_KINDS = /* @__PURE__ */ new Set([
  "architecture",
  "decision",
  "pitfall",
  "convention",
  "preference"
]);
var VALID_DRIFT_STATUSES = /* @__PURE__ */ new Set([
  "fresh",
  "drifted",
  "missing",
  "untracked",
  "skipped"
]);
var SECRET_RE = [
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi,
    "[REDACTED_PRIVATE_KEY]"
  ],
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[^\r\n]*/gi, "[REDACTED_PRIVATE_KEY]"],
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]"],
  [
    /(?<![A-Za-z0-9])(sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z\-_]{24,}|github_pat_[A-Za-z0-9_]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})(?![A-Za-z0-9])/g,
    "[REDACTED_KEY]"
  ],
  [
    /(["']?(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["']?)([^\s"',;}{]{8,})(["']?)/gi,
    "$1[REDACTED]$3"
  ]
];
function isAsciiWhitespaceCode(code) {
  return code === 32 || code === 9 || code === 13 || code === 10;
}
function asciiLowerCode(code) {
  return code >= 65 && code <= 90 ? code + 32 : code;
}
function startsWithAsciiCaseInsensitive(input, idx, lowerPrefix) {
  if (idx + lowerPrefix.length > input.length) return false;
  for (let i = 0; i < lowerPrefix.length; i++) {
    if (asciiLowerCode(input.charCodeAt(idx + i)) !== lowerPrefix.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}
function matchOpenPrivateTagEnd(input, idx) {
  if (!startsWithAsciiCaseInsensitive(input, idx, PRIVATE_OPEN_PREFIX)) return -1;
  let cursor = idx + PRIVATE_OPEN_PREFIX.length;
  if (cursor >= input.length) return -1;
  const boundary = input.charCodeAt(cursor);
  if (boundary === 62) return cursor;
  if (!isAsciiWhitespaceCode(boundary)) return -1;
  cursor += 1;
  while (cursor < input.length) {
    const code = input.charCodeAt(cursor);
    if (code === 62) return cursor;
    if (code === 60) return -1;
    cursor += 1;
  }
  return -1;
}
function matchClosePrivateTagEnd(input, idx) {
  if (!startsWithAsciiCaseInsensitive(input, idx, PRIVATE_CLOSE_PREFIX)) return -1;
  let cursor = idx + PRIVATE_CLOSE_PREFIX.length;
  while (cursor < input.length && isAsciiWhitespaceCode(input.charCodeAt(cursor))) {
    cursor += 1;
  }
  if (cursor < input.length && input.charCodeAt(cursor) === 62) {
    return cursor;
  }
  return -1;
}
function stripPrivateTags(input) {
  if (!input || !input.includes("<")) return { cleaned: input, strippedCount: 0 };
  const chunks = [];
  let cursor = 0;
  let strippedCount = 0;
  while (cursor < input.length) {
    const ltIdx = input.indexOf("<", cursor);
    if (ltIdx === -1) {
      chunks.push(input.slice(cursor));
      break;
    }
    const openEnd = matchOpenPrivateTagEnd(input, ltIdx);
    if (openEnd === -1) {
      chunks.push(input.slice(cursor, ltIdx + 1));
      cursor = ltIdx + 1;
      continue;
    }
    if (ltIdx > cursor) {
      chunks.push(input.slice(cursor, ltIdx));
    }
    let depth = 1;
    let scan = openEnd + 1;
    while (scan < input.length && depth > 0) {
      const nextLt = input.indexOf("<", scan);
      if (nextLt === -1) {
        scan = input.length;
        break;
      }
      const nestedOpenEnd = matchOpenPrivateTagEnd(input, nextLt);
      if (nestedOpenEnd !== -1) {
        depth += 1;
        scan = nestedOpenEnd + 1;
        continue;
      }
      const closeEnd = matchClosePrivateTagEnd(input, nextLt);
      if (closeEnd !== -1) {
        depth -= 1;
        scan = closeEnd + 1;
        continue;
      }
      scan = nextLt + 1;
    }
    strippedCount += 1;
    cursor = depth > 0 ? input.length : scan;
  }
  if (strippedCount === 0) {
    return { cleaned: input, strippedCount: 0 };
  }
  const cleaned = chunks.join("").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { cleaned, strippedCount };
}
function estimateTokenCount(text) {
  if (!text) return 0;
  let cjk = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 19968 && code <= 40959 || code >= 12352 && code <= 12543 || code >= 44032 && code <= 55215) {
      cjk += 1;
    }
  }
  const nonCjk = text.length - cjk;
  return Math.max(1, Math.ceil(nonCjk / 4 + cjk * 0.7));
}
function redactSecrets(input) {
  let out = input;
  for (const [re, rep] of SECRET_RE) out = out.replace(re, rep);
  return out;
}
function sanitizeTag(raw) {
  const stripped = stripPrivateTags(raw).cleaned.trim();
  if (!stripped) return "";
  const redacted = redactSecrets(stripped);
  if (redacted === stripped) return stripped.toLowerCase();
  return redacted.toLowerCase().replace(/\[redacted(?:_[a-z_]+)?\]/g, (m) => m.toUpperCase());
}
function collapseSingleLine(text, maxLen) {
  const single = text.replace(/\s+/g, " ").trim();
  if (single.length <= maxLen) return single;
  return `${single.slice(0, Math.max(1, maxLen - 1)).trimEnd()}\u2026`;
}
function formatCompactAnchorList(anchors, maxFiles = 3) {
  if (anchors.length === 0) return "";
  const names = anchors.slice(0, maxFiles).map((a) => a.basename);
  const extra = anchors.length > maxFiles ? `, +${anchors.length - maxFiles}` : "";
  return ` [${names.join(", ")}${extra}]`;
}
function toIndexEntry(m, score) {
  return {
    id: m.id,
    kind: m.kind,
    title: m.title,
    pinned: m.pinned,
    drifted: Boolean(m.drifted),
    tags: [...m.tags],
    anchors: m.anchors.map((a) => ({
      basename: a.basename,
      ...a.symbol ? { symbol: a.symbol } : {},
      ...a.driftStatus ? { driftStatus: a.driftStatus } : {}
    })),
    updatedAt: m.updatedAt,
    recallCount: m.recallCount,
    ...typeof score === "number" ? { score } : {}
  };
}
function formatCompactIndexLine(entry, maxTitleLen = 72) {
  const title = collapseSingleLine(entry.title, maxTitleLen);
  const pinMark = entry.pinned ? " \u2605" : "";
  const driftMark = entry.drifted ? " \xB7 DRIFTED" : "";
  const scoreMark = typeof entry.score === "number" ? ` (score ${entry.score})` : "";
  const files = entry.anchors.length > 0 ? ` [${entry.anchors.slice(0, 3).map((a) => a.basename).join(", ")}${entry.anchors.length > 3 ? `, +${entry.anchors.length - 3}` : ""}]` : "";
  return `- [${entry.id}] (${entry.kind.toUpperCase()}${pinMark}${driftMark}) ${title}${files}${scoreMark}`;
}
function isSensitiveFilePath(filePath) {
  const trimmed = filePath.trim();
  if (!trimmed) return true;
  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) return true;
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (lower === ".ssh") return true;
    if (lower.startsWith(".env")) return true;
  }
  const base = segments[segments.length - 1].toLowerCase();
  if (/\.(pem|key|p12|pfx|jks)$/i.test(base)) return true;
  if (/^(id_rsa|id_ed25519|id_ecdsa|id_dsa)(\.pub)?$/i.test(base)) return true;
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].toLowerCase() === ".aws" && base === "credentials") return true;
  }
  return false;
}
function isRelativeInside(rootDir, targetPath) {
  const rel = import_node_path7.default.relative(rootDir, targetPath);
  return rel !== "" && !rel.startsWith("..") && !import_node_path7.default.isAbsolute(rel);
}
function resolveExistingAncestorRealpath(absTarget) {
  let cursor = import_node_path7.default.dirname(absTarget);
  while (true) {
    try {
      const realAncestor = import_node_fs5.default.realpathSync(cursor);
      const tail = import_node_path7.default.relative(cursor, absTarget);
      return import_node_path7.default.join(realAncestor, tail);
    } catch {
      const parent = import_node_path7.default.dirname(cursor);
      if (parent === cursor) return void 0;
      cursor = parent;
    }
  }
}
function inspectAnchorFile(filePath, workspacePath, maxBytes = MAX_ANCHOR_FILE_BYTES) {
  if (!filePath || !filePath.trim()) {
    return { status: "skipped", reason: "unreadable" };
  }
  const absFile = import_node_path7.default.resolve(filePath);
  if (isSensitiveFilePath(filePath) || isSensitiveFilePath(absFile)) {
    return { status: "skipped", reason: "sensitive" };
  }
  const effectiveWorkspace = workspacePath && workspacePath.trim() ? workspacePath.trim() : process.cwd();
  let realWorkspace;
  try {
    realWorkspace = import_node_fs5.default.realpathSync(import_node_path7.default.resolve(effectiveWorkspace));
  } catch {
    return { status: "skipped", reason: "outside-workspace" };
  }
  let realFile;
  try {
    realFile = import_node_fs5.default.realpathSync(absFile);
  } catch (err) {
    const code = err?.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      const projected = resolveExistingAncestorRealpath(absFile);
      if (!projected || !isRelativeInside(realWorkspace, projected)) {
        return { status: "skipped", reason: "outside-workspace" };
      }
      return { status: "missing" };
    }
    return { status: "skipped", reason: "unreadable" };
  }
  if (isSensitiveFilePath(realFile)) {
    return { status: "skipped", reason: "sensitive" };
  }
  if (!isRelativeInside(realWorkspace, realFile)) {
    return { status: "skipped", reason: "outside-workspace" };
  }
  let fd;
  try {
    const stat = import_node_fs5.default.statSync(realFile);
    if (!stat.isFile()) return { status: "skipped", reason: "non-file" };
    if (stat.size > maxBytes) return { status: "skipped", reason: "oversized" };
    fd = import_node_fs5.default.openSync(realFile, "r");
    const fdStat = import_node_fs5.default.fstatSync(fd);
    if (!fdStat.isFile()) return { status: "skipped", reason: "non-file" };
    if (fdStat.size > maxBytes) return { status: "skipped", reason: "oversized" };
    const hash = import_node_crypto3.default.createHash("sha256");
    const chunkSize = Math.min(64 * 1024, Math.max(1, maxBytes));
    const chunk = Buffer.alloc(chunkSize);
    let totalRead = 0;
    while (true) {
      const n = import_node_fs5.default.readSync(fd, chunk, 0, chunk.length, null);
      if (n <= 0) break;
      totalRead += n;
      if (totalRead > maxBytes) {
        return { status: "skipped", reason: "oversized" };
      }
      hash.update(chunk.subarray(0, n));
    }
    return { status: "ok", sha256: hash.digest("hex").slice(0, 16) };
  } catch {
    return { status: "skipped", reason: "unreadable" };
  } finally {
    if (fd !== void 0) {
      try {
        import_node_fs5.default.closeSync(fd);
      } catch {
      }
    }
  }
}
function safePathToFileUri(filePath) {
  try {
    return (0, import_node_url.pathToFileURL)(import_node_path7.default.resolve(filePath)).href;
  } catch {
    return "";
  }
}
function normalizeAnchor(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw;
  if (typeof r.filePath !== "string" || !r.filePath.trim()) return null;
  const filePath = r.filePath.trim();
  const basename = typeof r.basename === "string" && r.basename.trim() ? r.basename.trim() : import_node_path7.default.basename(filePath);
  const uri = typeof r.uri === "string" && r.uri.trim() ? r.uri.trim() : safePathToFileUri(filePath);
  const symbol = typeof r.symbol === "string" && r.symbol.trim() ? r.symbol.trim() : void 0;
  const sha256 = typeof r.sha256 === "string" && r.sha256.trim() ? r.sha256.trim() : void 0;
  const driftStatus = typeof r.driftStatus === "string" && VALID_DRIFT_STATUSES.has(r.driftStatus) ? r.driftStatus : void 0;
  return {
    filePath,
    basename,
    uri,
    ...symbol ? { symbol } : {},
    ...sha256 ? { sha256 } : {},
    ...driftStatus ? { driftStatus } : {}
  };
}
function normalizeMemoryItem(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw;
  const fallbackSeed = `${index}:${String(r.title ?? "")}:${String(r.content ?? "")}`;
  const fallbackId = `mem_rec_${import_node_crypto3.default.createHash("sha256").update(fallbackSeed).digest("hex").slice(0, 10)}`;
  const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : fallbackId;
  const kind = typeof r.kind === "string" && VALID_MEMORY_KINDS.has(r.kind) ? r.kind : "decision";
  const title = typeof r.title === "string" && r.title.trim() ? r.title.trim() : "(Untitled memory)";
  const content = typeof r.content === "string" ? r.content : "";
  const tags = Array.isArray(r.tags) ? Array.from(
    new Set(
      r.tags.filter((t) => typeof t === "string").map((t) => t.trim()).filter(Boolean)
    )
  ) : [];
  const anchors = Array.isArray(r.anchors) ? r.anchors.map((a) => normalizeAnchor(a)).filter((a) => a !== null) : [];
  const workspacePath = typeof r.workspacePath === "string" && r.workspacePath.trim() ? r.workspacePath.trim() : void 0;
  const sourceConversationId = typeof r.sourceConversationId === "string" && r.sourceConversationId.trim() ? r.sourceConversationId.trim() : void 0;
  const createdAt = typeof r.createdAt === "string" && r.createdAt.trim() ? r.createdAt.trim() : (/* @__PURE__ */ new Date(0)).toISOString();
  const updatedAt = typeof r.updatedAt === "string" && r.updatedAt.trim() ? r.updatedAt.trim() : createdAt;
  const recallCount = typeof r.recallCount === "number" && Number.isFinite(r.recallCount) && r.recallCount >= 0 ? Math.floor(r.recallCount) : 0;
  const pinned = Boolean(r.pinned);
  const drifted = typeof r.drifted === "boolean" ? r.drifted : void 0;
  return {
    id,
    kind,
    title,
    content,
    tags,
    ...workspacePath ? { workspacePath } : {},
    ...sourceConversationId ? { sourceConversationId } : {},
    anchors,
    pinned,
    createdAt,
    updatedAt,
    recallCount,
    ...drifted !== void 0 ? { drifted } : {}
  };
}
function ensurePrivateDir2(dirPath) {
  import_node_fs5.default.mkdirSync(dirPath, { recursive: true, mode: 448 });
  try {
    import_node_fs5.default.chmodSync(dirPath, 448);
  } catch {
  }
}
function tokenize(text) {
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9_./-]{2,}/g) ?? [];
  const cjkRuns = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  const cjk = [];
  for (const run of cjkRuns) {
    if (run.length === 1) cjk.push(run);
    else for (let i = 0; i < run.length - 1; i++) cjk.push(run.slice(i, i + 2));
  }
  return [...latin, ...cjk];
}
var MemoryStore = class {
  constructor(dataDir, demoMode = false, defaultWorkspaceRoot) {
    this.dataDir = dataDir;
    this.demoMode = demoMode;
    this.defaultWorkspaceRoot = defaultWorkspaceRoot;
    this.filePath = import_node_path7.default.join(dataDir, "memories.json");
  }
  filePath;
  demoItems = null;
  cloneItems(items) {
    return items.map((m) => ({
      ...m,
      tags: [...m.tags],
      anchors: m.anchors.map((a) => ({ ...a }))
    }));
  }
  backupCorruptFile(reason) {
    const base = `${this.filePath}.corrupt.${Date.now()}`;
    const backupPath = import_node_fs5.default.existsSync(base) ? `${base}.${import_node_crypto3.default.randomBytes(2).toString("hex")}` : base;
    try {
      import_node_fs5.default.renameSync(this.filePath, backupPath);
      try {
        import_node_fs5.default.chmodSync(backupPath, 384);
      } catch {
      }
      console.error(`[agy-nov:mem] Corrupt memories store backed up to ${backupPath}: ${reason}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[agy-nov:mem] Corrupt memories store detected (${reason}), backup failed: ${msg}`);
    }
  }
  readRaw() {
    if (this.demoMode) {
      if (!this.demoItems) {
        this.demoItems = buildDemoMemories();
      }
      return this.cloneItems(this.demoItems);
    }
    if (!import_node_fs5.default.existsSync(this.filePath)) return [];
    let rawText;
    try {
      rawText = import_node_fs5.default.readFileSync(this.filePath, "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[agy-nov:mem] Failed to read ${this.filePath}: ${msg}`);
      return [];
    }
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.backupCorruptFile(`invalid JSON (${msg})`);
      return [];
    }
    if (!Array.isArray(parsed)) {
      this.backupCorruptFile("root JSON value must be an array");
      return [];
    }
    return parsed.map((entry, idx) => normalizeMemoryItem(entry, idx)).filter((item) => item !== null);
  }
  writeAll(items) {
    if (this.demoMode) {
      this.demoItems = this.cloneItems(items);
      return;
    }
    ensurePrivateDir2(this.dataDir);
    const tmp = `${this.filePath}.${process.pid}.${import_node_crypto3.default.randomBytes(4).toString("hex")}.tmp`;
    try {
      import_node_fs5.default.writeFileSync(tmp, JSON.stringify(items, null, 2), { encoding: "utf8", mode: 384 });
      try {
        import_node_fs5.default.chmodSync(tmp, 384);
      } catch {
      }
      import_node_fs5.default.renameSync(tmp, this.filePath);
    } catch (err) {
      try {
        if (import_node_fs5.default.existsSync(tmp)) import_node_fs5.default.unlinkSync(tmp);
      } catch {
      }
      throw err;
    }
  }
  evaluateDrift(item) {
    if (this.demoMode && item.id.startsWith("mem_demo_")) {
      return item;
    }
    let anyDrifted = false;
    const effectiveWs = item.workspacePath ?? this.defaultWorkspaceRoot;
    const rawAnchors = Array.isArray(item.anchors) ? item.anchors : [];
    const anchors = rawAnchors.map((a) => {
      if (!a.sha256) return { ...a, driftStatus: a.driftStatus ?? "untracked" };
      const inspected = inspectAnchorFile(a.filePath, effectiveWs);
      if (inspected.status === "skipped") {
        return { ...a, driftStatus: "skipped" };
      }
      if (inspected.status === "missing" || !inspected.sha256) {
        anyDrifted = true;
        return { ...a, driftStatus: "missing" };
      }
      if (inspected.sha256 !== a.sha256) {
        anyDrifted = true;
        return { ...a, driftStatus: "drifted" };
      }
      return { ...a, driftStatus: "fresh" };
    });
    return { ...item, anchors, drifted: anyDrifted };
  }
  list(opts = {}) {
    let items = this.readRaw().map((m) => this.evaluateDrift(m));
    if (opts.workspacePath) {
      const target = import_node_path7.default.resolve(opts.workspacePath);
      items = items.filter((m) => !m.workspacePath || import_node_path7.default.resolve(m.workspacePath) === target);
    }
    if (opts.kind) items = items.filter((m) => m.kind === opts.kind);
    if (opts.pinnedOnly) items = items.filter((m) => m.pinned);
    return items.sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)
    );
  }
  remember(input) {
    const items = this.readRaw();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const requestedWorkspace = input.workspacePath ? import_node_path7.default.resolve(input.workspacePath) : void 0;
    let inspectWorkspace = this.defaultWorkspaceRoot ? import_node_path7.default.resolve(this.defaultWorkspaceRoot) : requestedWorkspace;
    let resolvedWorkspace = inspectWorkspace;
    if (requestedWorkspace && this.defaultWorkspaceRoot) {
      const trustedRoot = import_node_path7.default.resolve(this.defaultWorkspaceRoot);
      const realTrusted = (() => {
        try {
          return import_node_fs5.default.realpathSync(trustedRoot);
        } catch {
          return trustedRoot;
        }
      })();
      let realReq;
      try {
        realReq = import_node_fs5.default.realpathSync(requestedWorkspace);
      } catch {
        realReq = resolveExistingAncestorRealpath(requestedWorkspace) ?? requestedWorkspace;
      }
      if (realReq === realTrusted || isRelativeInside(realTrusted, realReq)) {
        inspectWorkspace = realReq;
        resolvedWorkspace = requestedWorkspace;
      }
    }
    const anchors = (input.anchors ?? []).filter((a) => a && typeof a.filePath === "string" && a.filePath.trim().length > 0).map((a) => {
      const rawPath = a.filePath.trim();
      const abs = import_node_path7.default.isAbsolute(rawPath) ? import_node_path7.default.resolve(rawPath) : import_node_path7.default.resolve(inspectWorkspace ?? process.cwd(), rawPath);
      const strippedSymbol = a.symbol ? stripPrivateTags(a.symbol).cleaned.trim() : "";
      const cleanSymbol = strippedSymbol ? redactSecrets(strippedSymbol) : void 0;
      const inspected = inspectAnchorFile(abs, inspectWorkspace);
      const driftStatus = inspected.status === "ok" ? "fresh" : inspected.status === "skipped" ? "skipped" : "untracked";
      return {
        filePath: abs,
        basename: import_node_path7.default.basename(abs),
        uri: safePathToFileUri(abs),
        ...cleanSymbol ? { symbol: cleanSymbol } : {},
        ...inspected.sha256 ? { sha256: inspected.sha256 } : {},
        driftStatus
      };
    });
    const titleStripped = stripPrivateTags(input.title);
    const cleanTitle = redactSecrets(
      titleStripped.cleaned.trim() || (titleStripped.strippedCount > 0 ? PRIVATE_TITLE_PLACEHOLDER : "(Untitled memory)")
    );
    const contentStripped = stripPrivateTags(input.content);
    const cleanContent = redactSecrets(
      contentStripped.cleaned.trim() || (contentStripped.strippedCount > 0 ? PRIVATE_CONTENT_PLACEHOLDER : "")
    );
    const tags = Array.from(new Set((input.tags ?? []).map((t) => sanitizeTag(t)).filter(Boolean)));
    const existingIdx = input.id ? items.findIndex((m) => m.id === input.id) : items.findIndex(
      (m) => m.title.toLowerCase() === cleanTitle.toLowerCase() && (m.workspacePath ?? "") === (resolvedWorkspace ?? "")
    );
    if (existingIdx >= 0) {
      const updated = {
        ...items[existingIdx],
        kind: input.kind,
        title: cleanTitle,
        content: cleanContent,
        tags,
        anchors: anchors.length ? anchors : items[existingIdx].anchors,
        pinned: input.pinned ?? items[existingIdx].pinned,
        updatedAt: now
      };
      items[existingIdx] = updated;
      this.writeAll(items);
      return this.evaluateDrift(updated);
    }
    const created = {
      id: input.id || `mem_${import_node_crypto3.default.randomBytes(5).toString("hex")}`,
      kind: input.kind,
      title: cleanTitle,
      content: cleanContent,
      tags,
      workspacePath: resolvedWorkspace,
      sourceConversationId: input.sourceConversationId,
      anchors,
      pinned: Boolean(input.pinned),
      createdAt: now,
      updatedAt: now,
      recallCount: 0
    };
    items.unshift(created);
    this.writeAll(items);
    return this.evaluateDrift(created);
  }
  reverifyAnchorHashes(id) {
    const items = this.readRaw();
    const idx = items.findIndex((m) => m.id === id);
    if (idx < 0) return null;
    const ws = items[idx].workspacePath ?? this.defaultWorkspaceRoot;
    items[idx].anchors = items[idx].anchors.map((a) => {
      const inspected = inspectAnchorFile(a.filePath, ws);
      if (inspected.status === "ok" && inspected.sha256) {
        return { ...a, sha256: inspected.sha256, driftStatus: "fresh" };
      }
      if (inspected.status === "skipped") {
        const { sha256: _ignored, ...rest } = a;
        return { ...rest, driftStatus: "skipped" };
      }
      return { ...a, driftStatus: "missing" };
    });
    items[idx].drifted = false;
    items[idx].updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.writeAll(items);
    return this.evaluateDrift(items[idx]);
  }
  togglePin(id, pinned) {
    const items = this.readRaw();
    const idx = items.findIndex((m) => m.id === id);
    if (idx < 0) return null;
    items[idx].pinned = pinned ?? !items[idx].pinned;
    items[idx].updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.writeAll(items);
    return this.evaluateDrift(items[idx]);
  }
  forget(id) {
    const items = this.readRaw();
    const next = items.filter((m) => m.id !== id);
    if (next.length === items.length) return false;
    this.writeAll(next);
    return true;
  }
  getByIds(ids, opts = {}) {
    const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    if (uniqueIds.length === 0) return [];
    const all = this.list({ workspacePath: opts.workspacePath });
    const byId = new Map(all.map((m) => [m.id, m]));
    const matched = uniqueIds.map((id) => byId.get(id)).filter((m) => m !== void 0);
    if (opts.incrementRecall && matched.length > 0) {
      const raw = this.readRaw();
      const matchedSet = new Set(matched.map((m) => m.id));
      for (const m of raw) {
        if (matchedSet.has(m.id)) {
          m.recallCount = (m.recallCount ?? 0) + 1;
        }
      }
      this.writeAll(raw);
      return matched.map((m) => ({ ...m, recallCount: (m.recallCount ?? 0) + 1 }));
    }
    return matched;
  }
  recall(query, opts = {}) {
    const limit = opts.limit ?? 10;
    const all = this.list({ workspacePath: opts.workspacePath });
    const trimmed = query.trim();
    if (!trimmed) {
      return all.slice(0, limit).map((m) => ({ ...m, score: m.pinned ? 2 : 1 }));
    }
    const qTokens = Array.from(new Set(tokenize(trimmed)));
    if (qTokens.length === 0) return [];
    const docTokens = all.map(
      (m) => tokenize(
        `${m.title} ${m.content} ${m.tags.join(" ")} ${m.anchors.map((a) => `${a.basename} ${a.symbol ?? ""}`).join(" ")}`
      )
    );
    const N = all.length || 1;
    const avgLen = docTokens.reduce((s, t) => s + t.length, 0) / N || 1;
    const df = /* @__PURE__ */ new Map();
    for (const q of qTokens) {
      let c = 0;
      for (const dt of docTokens) if (dt.includes(q)) c += 1;
      df.set(q, c);
    }
    const k1 = 1.5;
    const b = 0.75;
    const qLower = trimmed.toLowerCase();
    const hits = all.map((m, i) => {
      const tfMap = /* @__PURE__ */ new Map();
      for (const t of docTokens[i]) tfMap.set(t, (tfMap.get(t) ?? 0) + 1);
      let score = 0;
      for (const q of qTokens) {
        const tf = tfMap.get(q) ?? 0;
        if (!tf) continue;
        const docFreq = df.get(q) ?? 0;
        const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
        score += idf * (tf * (k1 + 1) / (tf + k1 * (1 - b + b * docTokens[i].length / avgLen)));
      }
      if (m.title.toLowerCase().includes(qLower)) score += 3;
      if (m.content.toLowerCase().includes(qLower)) score += 2;
      if (m.pinned && score > 0) score += 0.6;
      return { ...m, score: Number(score.toFixed(2)) };
    }).filter((h) => h.score > 0).sort((a, b2) => b2.score - a.score).slice(0, limit);
    if (opts.incrementRecall && hits.length > 0) {
      const raw = this.readRaw();
      const hitIds = new Set(hits.map((h) => h.id));
      for (const m of raw) {
        if (hitIds.has(m.id)) m.recallCount = (m.recallCount ?? 0) + 1;
      }
      this.writeAll(raw);
      return hits.map((h) => ({ ...h, recallCount: (h.recallCount ?? 0) + 1 }));
    }
    return hits;
  }
  buildCompactIndexEntries(workspacePaths = [], maxItems = 12) {
    const ws = workspacePaths[0];
    return this.list({ workspacePath: ws }).filter((m) => !m.drifted).slice(0, maxItems).map((m) => toIndexEntry(m));
  }
  buildSessionStartInjection(workspacePaths = [], maxItems = 12) {
    const entries = this.buildCompactIndexEntries(workspacePaths, maxItems);
    if (entries.length === 0) return "";
    const header = `[Agy Mem \u2014 Progressive Index (${entries.length} active \xB7 L1)]`;
    const footer = 'Call mem_recall(mode="detail", ids=["<id>"]) for full content or mode="timeline" for nearby context.';
    const lines = [header];
    let usedLen = header.length + 1 + footer.length;
    let included = 0;
    for (const entry of entries) {
      const line = formatCompactIndexLine(entry);
      const nextLen = usedLen + 1 + line.length;
      if (nextLen <= MAX_SESSION_START_CHARS) {
        lines.push(line);
        usedLen = nextLen;
        included += 1;
      } else if (included === 0) {
        const available = Math.max(24, MAX_SESSION_START_CHARS - usedLen - 1);
        lines.push(collapseSingleLine(line, available));
        included += 1;
        break;
      } else {
        break;
      }
    }
    const omitted = entries.length - included;
    if (omitted > 0) {
      const moreLine = `(+${omitted} more indexed; query with mem_recall(mode="index", query="..."))`;
      if (usedLen + 1 + moreLine.length <= MAX_SESSION_START_CHARS) {
        lines.push(moreLine);
      }
    }
    lines.push(footer);
    const out = lines.join("\n");
    return out.length <= MAX_SESSION_START_CHARS ? out : out.slice(0, MAX_SESSION_START_CHARS);
  }
  buildProgressiveStats(workspacePaths, maxItems = 12) {
    const ws = workspacePaths?.[0];
    const active = this.list({ workspacePath: ws }).filter((m) => !m.drifted);
    if (active.length === 0) {
      return {
        activeCount: 0,
        compactIndexChars: 0,
        compactIndexTokens: 0,
        fullDumpTokens: 0,
        savedTokens: 0,
        savedPercent: 0
      };
    }
    const compactIndex = this.buildSessionStartInjection(workspacePaths ?? [], maxItems);
    const fullDumpText = [
      `[Agy Mem \u2014 Persistent Workspace Memory (${active.length} active)]`,
      ...active.map((m) => {
        const anchorTxt = formatCompactAnchorList(m.anchors, m.anchors.length);
        const tagTxt = m.tags.length ? ` [tags: ${m.tags.join(", ")}]` : "";
        return `- [${m.id}] (${m.kind.toUpperCase()}${m.pinned ? " \u2605" : ""}) **${m.title}**: ${m.content}${anchorTxt}${tagTxt}`;
      })
    ].join("\n");
    const compactIndexChars = compactIndex.length;
    const compactIndexTokens = estimateTokenCount(compactIndex);
    const fullDumpTokens = estimateTokenCount(fullDumpText);
    const savedTokens = Math.max(0, fullDumpTokens - compactIndexTokens);
    const savedPercent = fullDumpTokens > 0 ? Math.round(savedTokens / fullDumpTokens * 100) : 0;
    return {
      activeCount: active.length,
      compactIndexChars,
      compactIndexTokens,
      fullDumpTokens,
      savedTokens,
      savedPercent
    };
  }
  recallLayered(opts = {}) {
    const mode = opts.mode ?? "detail";
    const query = (opts.query ?? "").trim();
    const ids = Array.from(new Set((opts.ids ?? []).map((id) => id.trim()).filter(Boolean)));
    const limit = opts.limit ?? 8;
    const windowSize = Math.min(5, Math.max(1, Math.floor(opts.window ?? 2)));
    if (mode === "index") {
      const entries = ids.length > 0 ? this.getByIds(ids, { workspacePath: opts.workspacePath, incrementRecall: false }).map(
        (m) => toIndexEntry(m)
      ) : this.recall(query, {
        workspacePath: opts.workspacePath,
        limit,
        incrementRecall: false
      }).map((m) => toIndexEntry(m, m.score));
      const text2 = entries.length ? [
        `[Agy Mem \xB7 L1 Index (${entries.length} ${entries.length === 1 ? "match" : "matches"})]`,
        ...entries.map((entry) => formatCompactIndexLine(entry)),
        'Call mem_recall(mode="detail", ids=["<id>"]) to load full memory content.'
      ].join("\n") : ids.length > 0 ? `No memories found for ids: ${ids.join(", ")}.` : `No memories matched "${query}".`;
      return {
        mode,
        query,
        ids,
        window: windowSize,
        totalHits: entries.length,
        text: text2,
        indexEntries: entries,
        timelineEntries: [],
        detailItems: []
      };
    }
    if (mode === "timeline") {
      const chronological = this.list({ workspacePath: opts.workspacePath }).sort(
        (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
      );
      const indexById = /* @__PURE__ */ new Map();
      chronological.forEach((m, idx) => indexById.set(m.id, idx));
      const anchorIndices = /* @__PURE__ */ new Set();
      const anchorHitIds = /* @__PURE__ */ new Set();
      const scoreMap = /* @__PURE__ */ new Map();
      if (ids.length > 0) {
        for (const id of ids) {
          const idx = indexById.get(id);
          if (idx !== void 0) {
            anchorIndices.add(idx);
            anchorHitIds.add(id);
          }
        }
      } else if (query) {
        const hits = this.recall(query, {
          workspacePath: opts.workspacePath,
          limit,
          incrementRecall: false
        });
        for (const h of hits) {
          const idx = indexById.get(h.id);
          if (idx !== void 0) {
            anchorIndices.add(idx);
            anchorHitIds.add(h.id);
            scoreMap.set(h.id, h.score);
          }
        }
      } else {
        const count = Math.min(limit, chronological.length);
        for (let i = 0; i < count; i++) {
          anchorIndices.add(i);
        }
      }
      const includedIndices = /* @__PURE__ */ new Set();
      if (ids.length > 0 || query) {
        for (const anchorIdx of anchorIndices) {
          const start = Math.max(0, anchorIdx - windowSize);
          const end = Math.min(chronological.length - 1, anchorIdx + windowSize);
          for (let i = start; i <= end; i++) {
            includedIndices.add(i);
          }
        }
      } else {
        for (const idx of anchorIndices) {
          includedIndices.add(idx);
        }
      }
      const orderedIndices = Array.from(includedIndices).sort((a, b) => a - b);
      const timelineEntries = orderedIndices.map((idx) => {
        const m = chronological[idx];
        const score = scoreMap.get(m.id);
        return {
          id: m.id,
          kind: m.kind,
          title: m.title,
          excerpt: collapseSingleLine(m.content, 120),
          pinned: m.pinned,
          drifted: Boolean(m.drifted),
          tags: [...m.tags],
          anchorFiles: m.anchors.map((a) => a.basename),
          ...m.sourceConversationId ? { sourceConversationId: m.sourceConversationId } : {},
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
          recallCount: m.recallCount,
          isAnchorHit: anchorHitIds.has(m.id),
          ...typeof score === "number" ? { score } : {}
        };
      });
      const text2 = timelineEntries.length ? [
        `[Agy Mem \xB7 L2 Timeline (${timelineEntries.length} items, window=\xB1${windowSize})]`,
        ...timelineEntries.map((entry) => {
          const marker = entry.isAnchorHit ? "\u2605 HIT" : "\xB7 ctx";
          const filesTxt = entry.anchorFiles.length ? ` [files: ${entry.anchorFiles.slice(0, 3).join(", ")}]` : "";
          const convTxt = entry.sourceConversationId ? ` (session:${entry.sourceConversationId.slice(0, 12)})` : "";
          const scoreTxt = typeof entry.score === "number" ? ` score=${entry.score}` : "";
          return `- ${entry.updatedAt} ${marker} [${entry.id}] (${entry.kind.toUpperCase()}${entry.pinned ? " \u2605" : ""}${entry.drifted ? " \xB7 DRIFTED" : ""}) ${entry.title}${filesTxt}${convTxt}${scoreTxt}
  ${entry.excerpt}`;
        }),
        'Call mem_recall(mode="detail", ids=["<id>"]) to load full memory content.'
      ].join("\n") : ids.length > 0 ? `No memories found for ids: ${ids.join(", ")}.` : `No memories matched "${query}".`;
      return {
        mode,
        query,
        ids,
        window: windowSize,
        totalHits: timelineEntries.length,
        text: text2,
        indexEntries: [],
        timelineEntries,
        detailItems: []
      };
    }
    const detailItems = ids.length > 0 ? this.getByIds(ids, {
      workspacePath: opts.workspacePath,
      incrementRecall: Boolean(opts.incrementRecall)
    }).map((m) => ({ ...m, score: 1 })) : this.recall(query, {
      workspacePath: opts.workspacePath,
      limit,
      incrementRecall: Boolean(opts.incrementRecall)
    });
    const text = detailItems.length ? detailItems.map((m, i) => {
      const anchorTxt = formatCompactAnchorList(m.anchors, 4);
      const scoreTxt = typeof m.score === "number" ? ` (score ${m.score})` : "";
      return `${i + 1}. [${m.id}] [${m.kind.toUpperCase()}${m.pinned ? " \u2605" : ""}${m.drifted ? " \xB7 DRIFTED" : ""}] ${m.title}${anchorTxt}${scoreTxt}
   ${m.content}`;
    }).join("\n") : ids.length > 0 ? `No memories found for ids: ${ids.join(", ")}.` : `No memories matched "${query}".`;
    return {
      mode,
      query,
      ids,
      window: windowSize,
      totalHits: detailItems.length,
      text,
      indexEntries: [],
      timelineEntries: [],
      detailItems
    };
  }
};

// src/modules/mem/hook.ts
var MAX_TRANSCRIPT_TAIL_BYTES = 256 * 1024;
function isSensitiveOrSymlinkToSensitive(filePath) {
  if (isSensitiveFilePath(filePath)) return true;
  try {
    const real = import_node_fs6.default.realpathSync(filePath);
    if (isSensitiveFilePath(real)) return true;
  } catch {
  }
  return false;
}
function extractEditedFilesFromTranscript(transcriptPath, maxTailBytes = MAX_TRANSCRIPT_TAIL_BYTES) {
  if (!transcriptPath) return [];
  const files = /* @__PURE__ */ new Set();
  let fd;
  try {
    fd = import_node_fs6.default.openSync(transcriptPath, "r");
    const stat = import_node_fs6.default.fstatSync(fd);
    if (!stat.isFile() || stat.size === 0) return [];
    const bytesToRead = Math.min(stat.size, maxTailBytes);
    const startOffset = stat.size - bytesToRead;
    const buf = Buffer.alloc(bytesToRead);
    let totalRead = 0;
    while (totalRead < bytesToRead) {
      const n = import_node_fs6.default.readSync(fd, buf, totalRead, bytesToRead - totalRead, startOffset + totalRead);
      if (n <= 0) break;
      totalRead += n;
    }
    let text = buf.subarray(0, totalRead).toString("utf8");
    if (startOffset > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }
    const lines = text.split(/\r?\n/).slice(-120);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const calls = obj.tool_calls ?? obj.toolCalls ?? [];
        for (const tc of calls) {
          if (!tc.name || !/edit|write|replace/i.test(tc.name)) continue;
          const rawPath = tc.args?.Path ?? tc.args?.path ?? tc.args?.TargetFile ?? tc.args?.target_file ?? tc.args?.file_path ?? tc.args?.filePath;
          if (typeof rawPath === "string") {
            const clean = rawPath.replace(/^["']|["']$/g, "").trim();
            if (clean.startsWith("/") && !isSensitiveOrSymlinkToSensitive(clean)) {
              files.add(clean);
            }
          }
        }
      } catch {
      }
    }
  } catch {
  } finally {
    if (fd !== void 0) {
      try {
        import_node_fs6.default.closeSync(fd);
      } catch {
      }
    }
  }
  return Array.from(files).slice(0, 6);
}
function handleMemSessionStartHook(payload, rootDataDir) {
  try {
    const resolvedRoot = resolveNovDataDir(rootDataDir);
    const dataDir = getModuleDataDir(resolvedRoot, "mem");
    const storeFile = import_node_path8.default.join(dataDir, "memories.json");
    if (!import_node_fs6.default.existsSync(storeFile)) {
      return {};
    }
    const workspacePaths = payload.workspacePaths.length > 0 ? payload.workspacePaths : payload.workspaceRoot ? [payload.workspaceRoot] : [];
    const store = new MemoryStore(dataDir, false, workspacePaths[0]);
    const injected = store.buildSessionStartInjection(workspacePaths, 12);
    if (!injected) return {};
    return {
      injectSteps: [
        {
          systemMessage: {
            systemMessage: injected
          }
        }
      ]
    };
  } catch {
    return {};
  }
}
function handleMemStopHook(payload, rootDataDir) {
  try {
    const editedFiles = extractEditedFilesFromTranscript(payload.transcriptPath);
    const strippedInput = stripPrivateTags(payload.lastUserInput ?? "").cleaned;
    const userPrompt = strippedInput.replace(/\s+/g, " ").trim();
    if (editedFiles.length === 0 || userPrompt.length < 16) {
      return;
    }
    const resolvedRoot = resolveNovDataDir(rootDataDir);
    const dataDir = getModuleDataDir(resolvedRoot, "mem");
    const workspacePath = payload.workspacePaths[0] ?? payload.workspaceRoot;
    const convId = payload.conversationId ?? "session";
    const store = new MemoryStore(dataDir, false, workspacePath);
    store.remember({
      id: `mem_auto_${convId.slice(0, 12)}`,
      kind: "decision",
      title: `Session recap: ${userPrompt.slice(0, 56)}${userPrompt.length > 56 ? "\u2026" : ""}`,
      content: `Auto-captured from conversation ${convId.slice(0, 8)}. Modified ${editedFiles.length} file(s): ${editedFiles.map((f) => import_node_path8.default.basename(f)).join(", ")}.`,
      tags: ["auto-capture"],
      workspacePath,
      sourceConversationId: convId,
      anchors: editedFiles.map((filePath) => ({ filePath })),
      pinned: false
    });
  } catch {
  }
}

// src/modules/radar/hook.ts
var import_node_crypto4 = __toESM(require("node:crypto"), 1);

// src/modules/radar/core.ts
var import_node_child_process = require("node:child_process");
var import_node_fs7 = __toESM(require("node:fs"), 1);
var import_node_path9 = __toESM(require("node:path"), 1);
var DEFAULT_RADAR_PREFS = {
  desktopNotify: false,
  soundChime: false,
  stallMinutes: 5
};
var MAX_STORED_SESSIONS = 100;
var STATUS_PRIORITY = {
  awaiting_approval: 0,
  error: 1,
  stalled: 2,
  completed: 3,
  running: 4
};
function getRadarBoardPath(moduleDataDir) {
  return import_node_path9.default.join(moduleDataDir, "board.json");
}
function getRadarStatusCapsulePath(moduleDataDir) {
  return import_node_path9.default.join(moduleDataDir, "status-capsule.json");
}
function buildRadarStatusCapsule(view) {
  const attention = view.sessions.find((s) => s.status === "awaiting_approval") ?? view.sessions.find((s) => s.status === "error") ?? view.sessions.find((s) => s.isOrphanSubagent) ?? view.sessions.find((s) => s.status === "stalled") ?? view.sessions.find((s) => s.unread);
  const capsule = {
    schemaVersion: 1,
    updatedAt: view.updatedAt,
    counts: { ...view.counts }
  };
  if (attention) {
    capsule.latestAttention = {
      conversationId: attention.conversationId,
      status: attention.status,
      workspaceName: attention.workspaceName,
      ...attention.lastToolName ? { lastToolName: attention.lastToolName } : {}
    };
  }
  return capsule;
}
function normalizeRadarPrefs(raw) {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_RADAR_PREFS };
  }
  const obj = raw;
  const rawStall = typeof obj.stallMinutes === "number" && Number.isFinite(obj.stallMinutes) ? Math.round(obj.stallMinutes) : DEFAULT_RADAR_PREFS.stallMinutes;
  return {
    desktopNotify: typeof obj.desktopNotify === "boolean" ? obj.desktopNotify : false,
    soundChime: typeof obj.soundChime === "boolean" ? obj.soundChime : false,
    stallMinutes: Math.max(1, Math.min(rawStall, 120))
  };
}
function createEmptyBoard() {
  return {
    schemaVersion: 1,
    prefs: { ...DEFAULT_RADAR_PREFS },
    sessions: {},
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function isStoredStatus(value) {
  return value === "running" || value === "awaiting_approval" || value === "completed" || value === "error";
}
function normalizeSessionRecord(id, raw) {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const status = isStoredStatus(obj.status) ? obj.status : "running";
  const lastEvent = obj.lastEvent === "PreToolUse" || obj.lastEvent === "PostToolUse" || obj.lastEvent === "Stop" || obj.lastEvent === "manual" ? obj.lastEvent : "manual";
  const conversationId = typeof obj.conversationId === "string" && obj.conversationId ? obj.conversationId : id;
  const rawParentId = typeof obj.parentConversationId === "string" && obj.parentConversationId.trim() ? obj.parentConversationId.trim().slice(0, 120) : void 0;
  const parentConversationId = rawParentId && rawParentId !== conversationId ? rawParentId : void 0;
  const agentRole = typeof obj.agentRole === "string" ? cleanBriefText(obj.agentRole, 64) : void 0;
  const isSubagent = typeof obj.isSubagent === "boolean" ? obj.isSubagent : parentConversationId ? true : void 0;
  return {
    conversationId,
    ...parentConversationId ? { parentConversationId } : {},
    ...agentRole ? { agentRole } : {},
    ...isSubagent !== void 0 ? { isSubagent } : {},
    status,
    workspaceName: typeof obj.workspaceName === "string" && obj.workspaceName ? obj.workspaceName : "workspace",
    workspaceRoot: typeof obj.workspaceRoot === "string" ? obj.workspaceRoot : void 0,
    lastToolName: typeof obj.lastToolName === "string" ? obj.lastToolName : void 0,
    lastEvent,
    stepCount: typeof obj.stepCount === "number" && Number.isFinite(obj.stepCount) ? Math.max(0, Math.floor(obj.stepCount)) : 0,
    unread: Boolean(obj.unread),
    summary: typeof obj.summary === "string" ? obj.summary : void 0,
    errorMessage: typeof obj.errorMessage === "string" ? obj.errorMessage : void 0,
    startedAt: typeof obj.startedAt === "string" ? obj.startedAt : nowIso,
    lastActiveAt: typeof obj.lastActiveAt === "string" ? obj.lastActiveAt : nowIso,
    completedAt: typeof obj.completedAt === "string" ? obj.completedAt : void 0
  };
}
function loadRadarBoardReadOnly(moduleDataDir) {
  const boardPath = getRadarBoardPath(moduleDataDir);
  if (!import_node_fs7.default.existsSync(boardPath)) {
    return createEmptyBoard();
  }
  try {
    const raw = JSON.parse(import_node_fs7.default.readFileSync(boardPath, "utf8"));
    const prefs = normalizeRadarPrefs(raw.prefs);
    const sessions = {};
    if (raw.sessions && typeof raw.sessions === "object") {
      for (const [id, rec] of Object.entries(raw.sessions)) {
        const normalized = normalizeSessionRecord(id, rec);
        if (normalized) {
          sessions[normalized.conversationId] = normalized;
        }
      }
    }
    return {
      schemaVersion: 1,
      prefs,
      sessions,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch {
    return createEmptyBoard();
  }
}
function saveRadarBoard(moduleDataDir, board) {
  const entries = Object.values(board.sessions).sort(
    (a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt)
  );
  const pruned = {};
  for (const rec of entries.slice(0, MAX_STORED_SESSIONS)) {
    pruned[rec.conversationId] = rec;
  }
  const next = {
    schemaVersion: 1,
    prefs: normalizeRadarPrefs(board.prefs),
    sessions: pruned,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  atomicWriteJson(getRadarBoardPath(moduleDataDir), next);
  const capsule = buildRadarStatusCapsule(computeRadarBoardView(next, { mode: "live" }));
  atomicWriteJson(getRadarStatusCapsulePath(moduleDataDir), capsule);
  return next;
}
function computeRadarBoardView(board, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const stallThresholdMs = Math.max(1, board.prefs.stallMinutes) * 6e4;
  const counts = {
    total: 0,
    running: 0,
    awaiting_approval: 0,
    completed: 0,
    stalled: 0,
    error: 0,
    unread: 0,
    subagents: 0,
    orphanSubagents: 0
  };
  const sessionRecords = Object.values(board.sessions);
  const effectiveStatusById = /* @__PURE__ */ new Map();
  const idleMinutesById = /* @__PURE__ */ new Map();
  for (const rec of sessionRecords) {
    const activeMs = Date.parse(rec.lastActiveAt);
    const idleMs = Number.isFinite(activeMs) ? Math.max(0, nowMs - activeMs) : 0;
    const idleMinutes = Number((idleMs / 6e4).toFixed(1));
    const effectiveStatus = rec.status === "running" && idleMs >= stallThresholdMs ? "stalled" : rec.status;
    effectiveStatusById.set(rec.conversationId, effectiveStatus);
    idleMinutesById.set(rec.conversationId, idleMinutes);
  }
  const allViews = sessionRecords.map((rec) => {
    const effectiveStatus = effectiveStatusById.get(rec.conversationId) ?? rec.status;
    const idleMinutes = idleMinutesById.get(rec.conversationId) ?? 0;
    const parentStatus = rec.parentConversationId ? effectiveStatusById.get(rec.parentConversationId) : void 0;
    const isOrphanSubagent = rec.isSubagent === true && (parentStatus === "completed" || parentStatus === "error") && (effectiveStatus === "running" || effectiveStatus === "stalled");
    counts.total += 1;
    counts[effectiveStatus] += 1;
    if (rec.unread) counts.unread += 1;
    if (rec.isSubagent === true) counts.subagents += 1;
    if (isOrphanSubagent) counts.orphanSubagents += 1;
    return {
      ...rec,
      status: effectiveStatus,
      rawStatus: rec.status,
      idleMinutes,
      isOrphanSubagent
    };
  });
  allViews.sort((a, b) => {
    const aWeight = a.status === "completed" && !a.unread ? 5 : STATUS_PRIORITY[a.status];
    const bWeight = b.status === "completed" && !b.unread ? 5 : STATUS_PRIORITY[b.status];
    if (aWeight !== bWeight) return aWeight - bWeight;
    return Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt);
  });
  const filtered = allViews.filter((item) => {
    if (opts.statusFilter && item.status !== opts.statusFilter) return false;
    if (opts.onlyUnread && !item.unread) return false;
    return true;
  });
  return {
    mode: opts.mode ?? "live",
    prefs: { ...board.prefs },
    counts,
    sessions: filtered,
    updatedAt: board.updatedAt
  };
}
function cleanBriefText(raw, maxLen = 160) {
  if (!raw) return void 0;
  const cleaned = raw.replace(/[\r\n\t\x00-\x1f]+/g, " ").trim();
  if (!cleaned) return void 0;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}\u2026` : cleaned;
}
function recordRadarSessionEvent(moduleDataDir, input) {
  const board = loadRadarBoardReadOnly(moduleDataDir);
  const nowIso = input.timestampIso ?? (/* @__PURE__ */ new Date()).toISOString();
  const convId = input.conversationId.trim().slice(0, 120) || "default-session";
  const existing = board.sessions[convId];
  const workspaceName = input.workspaceRoot ? import_node_path9.default.basename(import_node_path9.default.resolve(input.workspaceRoot)) || existing?.workspaceName || "workspace" : existing?.workspaceName ?? "workspace";
  const rawParent = input.parentConversationId?.trim().slice(0, 120) || existing?.parentConversationId;
  const parentConversationId = rawParent && rawParent !== convId ? rawParent : void 0;
  const agentRole = cleanBriefText(input.agentRole, 64) ?? existing?.agentRole;
  const isSubagent = input.isSubagent !== void 0 ? input.isSubagent : parentConversationId ? true : existing?.isSubagent;
  let nextStatus = existing?.status ?? "running";
  let nextUnread = existing?.unread ?? false;
  let completedAt = existing?.completedAt;
  let errorMessage = existing?.errorMessage;
  if (input.event === "PreToolUse") {
    if (input.awaitingApproval) {
      nextStatus = "awaiting_approval";
      nextUnread = true;
    } else {
      nextStatus = "running";
    }
    completedAt = void 0;
    errorMessage = void 0;
  } else if (input.event === "PostToolUse") {
    nextStatus = "running";
    if (existing?.status === "awaiting_approval") {
      nextUnread = false;
    }
    completedAt = void 0;
    errorMessage = void 0;
  } else if (input.event === "Stop") {
    if (input.errorMessage) {
      nextStatus = "error";
      errorMessage = cleanBriefText(input.errorMessage, 160);
    } else {
      nextStatus = "completed";
      errorMessage = void 0;
    }
    nextUnread = true;
    completedAt = nowIso;
  }
  const nextSession = {
    conversationId: convId,
    ...parentConversationId ? { parentConversationId } : {},
    ...agentRole ? { agentRole } : {},
    ...isSubagent !== void 0 ? { isSubagent } : {},
    status: nextStatus,
    workspaceName,
    workspaceRoot: input.workspaceRoot ?? existing?.workspaceRoot,
    lastToolName: input.toolName ?? existing?.lastToolName,
    lastEvent: input.event,
    stepCount: (existing?.stepCount ?? 0) + 1,
    unread: nextUnread,
    summary: cleanBriefText(input.summary, 140) ?? existing?.summary,
    errorMessage,
    startedAt: existing?.startedAt ?? nowIso,
    lastActiveAt: nowIso,
    completedAt
  };
  board.sessions[convId] = nextSession;
  const saved = saveRadarBoard(moduleDataDir, board);
  return { board: saved, session: nextSession };
}
function sanitizeNotificationText(text, maxLen = 120) {
  const stripped = String(text ?? "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/["'`\\$<>|;&{}]/g, "").replace(/\s+/g, " ").trim();
  if (!stripped) return "agy-NOV";
  return stripped.length > maxLen ? `${stripped.slice(0, maxLen - 1)}\u2026` : stripped;
}
function buildSafeNotifyInvocation(platform, title, message, prefs) {
  if (!prefs.desktopNotify && !prefs.soundChime) {
    return null;
  }
  const safeTitle = sanitizeNotificationText(title, 64);
  const safeMsg = sanitizeNotificationText(message, 140);
  if (platform === "darwin") {
    if (prefs.desktopNotify) {
      const displayLine = prefs.soundChime ? 'display notification (item 1 of argv) with title (item 2 of argv) sound name "Glass"' : "display notification (item 1 of argv) with title (item 2 of argv)";
      return {
        command: "osascript",
        args: ["-e", "on run argv", "-e", displayLine, "-e", "end run", "--", safeMsg, safeTitle]
      };
    }
    if (prefs.soundChime) {
      return {
        command: "afplay",
        args: ["/System/Library/Sounds/Glass.aiff"]
      };
    }
  }
  if (platform === "linux" && prefs.desktopNotify) {
    return {
      command: "notify-send",
      args: ["--", safeTitle, safeMsg]
    };
  }
  return null;
}
function triggerRadarNotification(title, message, prefs, platform = process.platform) {
  if (process.env.NODE_ENV === "test" || Boolean(process.env.NODE_TEST_CONTEXT) || Boolean(process.env.AGY_NOV_NO_NOTIFY)) {
    return { dispatched: false, reason: "suppressed-by-env" };
  }
  if (!prefs.desktopNotify && !prefs.soundChime) {
    return { dispatched: false, reason: "disabled-in-prefs" };
  }
  const invocation = buildSafeNotifyInvocation(platform, title, message, prefs);
  if (!invocation) {
    return { dispatched: false, reason: "unsupported-platform" };
  }
  try {
    const child = (0, import_node_child_process.execFile)(
      invocation.command,
      invocation.args,
      { timeout: 3e3, windowsHide: true },
      () => {
      }
    );
    child.unref?.();
    return { dispatched: true, invocation };
  } catch {
    return { dispatched: false, reason: "exec-failed" };
  }
}

// src/modules/radar/hook.ts
var APPROVAL_TOOL_RE = /\b(?:run_command|execute|bash|shell|terminal|delete|remove|deploy|publish|push)\b/i;
function deriveConversationId(payload) {
  if (payload.conversationId && payload.conversationId.trim()) {
    return payload.conversationId.trim();
  }
  const seed = payload.workspaceRoot ?? payload.workspacePaths[0] ?? payload.cwd;
  if (seed) {
    const hash = import_node_crypto4.default.createHash("sha256").update(seed).digest("hex").slice(0, 10);
    return `ws-${hash}`;
  }
  return "default-session";
}
function detectAwaitingApproval(payload) {
  const raw = payload.raw ?? {};
  if (raw.requiresApproval === true || raw.awaitingApproval === true || raw.approvalRequired === true || raw.requires_approval === true || raw.awaiting_approval === true) {
    return true;
  }
  const input = payload.toolInput ?? {};
  if (input.requiresApproval === true || input.approvalRequired === true || input.requires_approval === true) {
    return true;
  }
  if (payload.toolName && APPROVAL_TOOL_RE.test(payload.toolName) && (input.SafeToAutoRun === false || input.safeToAutoRun === false)) {
    return true;
  }
  return false;
}
function formatErrorValue(err) {
  if (err === void 0 || err === null || err === false) return void 0;
  if (typeof err === "string") return err.trim() || void 0;
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "object") {
    const rec = err;
    if (typeof rec.message === "string" && rec.message.trim()) return rec.message.trim();
    if (typeof rec.code === "string" && rec.code.trim()) return `Error ${rec.code.trim()}`;
    try {
      const json = JSON.stringify(err);
      return json && json !== "{}" ? json : "Unknown error";
    } catch {
      return "Unknown error";
    }
  }
  return String(err);
}
function handleRadarHook(payload, rootDataDir) {
  try {
    if (payload.event !== "PreToolUse" && payload.event !== "PostToolUse" && payload.event !== "Stop") {
      return;
    }
    const resolvedRoot = resolveNovDataDir(rootDataDir);
    const moduleDataDir = getModuleDataDir(resolvedRoot, "radar");
    const conversationId = deriveConversationId(payload);
    const workspaceRoot = payload.workspaceRoot ?? payload.workspacePaths[0] ?? payload.cwd;
    const awaitingApproval = payload.event === "PreToolUse" ? detectAwaitingApproval(payload) : false;
    const errorMessage = payload.event === "Stop" ? formatErrorValue(payload.error) : void 0;
    const summary = cleanBriefText(payload.lastUserInput, 120) ?? (payload.terminationReason ? cleanBriefText(payload.terminationReason, 120) : void 0);
    const parentConversationId = payload.parentConversationId?.trim() || void 0;
    const agentRole = payload.agentRole?.trim() || void 0;
    const isSubagent = parentConversationId ? true : void 0;
    const { board, session } = recordRadarSessionEvent(moduleDataDir, {
      conversationId,
      parentConversationId,
      agentRole,
      isSubagent,
      event: payload.event,
      workspaceRoot,
      toolName: payload.toolName,
      awaitingApproval,
      errorMessage,
      summary
    });
    if (payload.event === "Stop") {
      const title = session.status === "error" ? `agy-NOV Radar: Error (${session.workspaceName})` : `agy-NOV Radar: Completed (${session.workspaceName})`;
      const message = session.status === "error" ? session.errorMessage || `Session ${session.conversationId} ended with an error.` : `Session ${session.conversationId} finished after ${session.stepCount} step(s).`;
      triggerRadarNotification(title, message, board.prefs);
    } else if (awaitingApproval) {
      triggerRadarNotification(
        `agy-NOV Radar: Approval Needed (${session.workspaceName})`,
        `Tool ${session.lastToolName ?? "action"} is awaiting your confirmation.`,
        board.prefs
      );
    }
  } catch {
  }
}

// src/modules/remote/config.ts
var import_node_crypto5 = __toESM(require("node:crypto"), 1);
var import_node_fs8 = __toESM(require("node:fs"), 1);
var import_node_path10 = __toESM(require("node:path"), 1);
var DEFAULT_PIN_TTL_MS = 5 * 60 * 1e3;
var DEFAULT_RISK_PATTERNS = [
  "\\brm\\s+(-[a-zA-Z]*(?:r[a-zA-Z]*f|f[a-zA-Z]*r)|-[a-zA-Z]*r\\b[^;&|]*-[a-zA-Z]*f\\b)",
  "\\bgit\\s+push\\b.*(--force|-f\\b)",
  "\\bgit\\s+reset\\s+--hard",
  "\\bsudo\\b",
  "\\b(drop|truncate)\\s+(table|database)\\b",
  "curl\\b.*\\|\\s*(ba)?sh\\b",
  "\\bchmod\\s+777\\b",
  "\\bmkfs\\.|\\bdd\\s+if="
];
var DEFAULT_SENSITIVE_PATH_PATTERNS = [
  { label: "sensitive_path:.env*", regex: /(?:^|[\\/])\.env[^\\/\s"']*(?:$|[\\/\s"'])/i },
  { label: "sensitive_path:.ssh", regex: /(?:^|[\\/])\.ssh(?:$|[\\/\s"'])/i },
  { label: "sensitive_path:*.pem", regex: /(?:^|[\\/])[^\\/\s"']+\.pem(?:$|[\\/\s"'])/i },
  { label: "sensitive_path:*.key", regex: /(?:^|[\\/])[^\\/\s"']+\.key(?:$|[\\/\s"'])/i },
  { label: "sensitive_path:ssh_key", regex: /(?:^|[\\/])id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?(?:$|[\\/\s"'])/i }
];
var SECRET_REGEXES = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
  [/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/gi, "[REDACTED_WEBHOOK]"],
  [/https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi, "[REDACTED_WEBHOOK]"],
  [/https:\/\/open\.(?:feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+/gi, "[REDACTED_WEBHOOK]"],
  [/https:\/\/oapi\.dingtalk\.com\/robot\/send\?[^\s"']+/gi, "[REDACTED_WEBHOOK]"],
  [/https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?[^\s"']+/gi, "[REDACTED_WEBHOOK]"],
  [/(https?:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi, "$1[REDACTED]$3"],
  [/([?&](?:token|access_token|api[_-]?key|key|secret|sign|sig)=)([^&#\s"']+)/gi, "$1[REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]"],
  [/\bBasic\s+[A-Za-z0-9+/]+=*/gi, "Basic [REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]"],
  [/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_BOT_TOKEN]"],
  [
    /\b(sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z\-_]{24,}|gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16}|npm_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|pypi-[A-Za-z0-9_-]{20,})\b/g,
    "[REDACTED_KEY]"
  ],
  [
    /(["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|bot[_-]?token|client[_-]?secret|signing[_-]?secret|secret|token|password|passwd|csrf[_-]?token)["']?\s*[:=]\s*["']?)([^\s"',;}{]{6,})(["']?)/gi,
    "$1[REDACTED]$3"
  ]
];
function redactText(text) {
  let out = text;
  for (const [re, rep] of SECRET_REGEXES) out = out.replace(re, rep);
  return out;
}
function generatePairingToken() {
  return import_node_crypto5.default.randomBytes(24).toString("base64url");
}
function generatePairingPin() {
  return String(import_node_crypto5.default.randomInt(1e5, 1e6));
}
function defaultRemoteConfig(now = Date.now()) {
  return {
    gatewayEnabled: false,
    host: "127.0.0.1",
    port: 4391,
    pairingToken: generatePairingToken(),
    pairingPin: generatePairingPin(),
    pairingPinExpiresAt: new Date(now + DEFAULT_PIN_TTL_MS).toISOString(),
    remoteApprovalEnabled: true,
    approvalTimeoutSec: 25,
    notifyOnStop: true,
    riskPatterns: [...DEFAULT_RISK_PATTERNS],
    channels: [
      { id: "telegram", kind: "telegram", label: "Telegram Bot", enabled: false },
      { id: "feishu", kind: "feishu", label: "Feishu / Lark (\u98DE\u4E66)", enabled: false },
      { id: "dingtalk", kind: "dingtalk", label: "DingTalk (\u9489\u9489)", enabled: false },
      { id: "wecom", kind: "wecom", label: "WeCom (\u4F01\u4E1A\u5FAE\u4FE1)", enabled: false },
      { id: "slack", kind: "slack", label: "Slack Webhook", enabled: false },
      { id: "discord", kind: "discord", label: "Discord Webhook", enabled: false }
    ]
  };
}
function getRemoteConfigPath(dataDir) {
  return import_node_path10.default.join(dataDir, "config.json");
}
function normalizeRemoteConfig(raw) {
  const base = defaultRemoteConfig();
  return {
    ...base,
    ...raw,
    gatewayEnabled: typeof raw.gatewayEnabled === "boolean" ? raw.gatewayEnabled : false,
    host: typeof raw.host === "string" && raw.host.trim() ? raw.host.trim() : base.host,
    port: typeof raw.port === "number" && Number.isInteger(raw.port) && raw.port >= 0 && raw.port <= 65535 ? raw.port : base.port,
    pairingToken: typeof raw.pairingToken === "string" && raw.pairingToken ? raw.pairingToken : base.pairingToken,
    pairingPin: typeof raw.pairingPin === "string" && raw.pairingPin ? raw.pairingPin : base.pairingPin,
    pairingPinExpiresAt: typeof raw.pairingPinExpiresAt === "string" && raw.pairingPinExpiresAt ? raw.pairingPinExpiresAt : base.pairingPinExpiresAt,
    riskPatterns: Array.isArray(raw.riskPatterns) && raw.riskPatterns.length ? raw.riskPatterns : base.riskPatterns,
    channels: Array.isArray(raw.channels) && raw.channels.length ? raw.channels : base.channels
  };
}
function loadConfigReadOnly(dataDir) {
  const cfgPath = getRemoteConfigPath(dataDir);
  if (!import_node_fs8.default.existsSync(cfgPath)) {
    return { config: defaultRemoteConfig(), persisted: false };
  }
  try {
    const parsed = JSON.parse(import_node_fs8.default.readFileSync(cfgPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { config: defaultRemoteConfig(), persisted: false };
    }
    return {
      config: normalizeRemoteConfig(parsed),
      persisted: true
    };
  } catch {
    return { config: defaultRemoteConfig(), persisted: false };
  }
}
function readRuntimeInfo(dataDir) {
  const runtimePath = import_node_path10.default.join(dataDir, "runtime.json");
  if (!import_node_fs8.default.existsSync(runtimePath)) return null;
  try {
    const parsed = JSON.parse(import_node_fs8.default.readFileSync(runtimePath, "utf8"));
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    const pid = Number(parsed.pid ?? 0);
    return {
      port,
      host: typeof parsed.host === "string" && parsed.host ? parsed.host : "127.0.0.1",
      url: `http://127.0.0.1:${port}`,
      pid: Number.isInteger(pid) ? pid : 0,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : ""
    };
  } catch {
    return null;
  }
}
function matchRiskPattern(text, patterns) {
  for (const raw of patterns) {
    try {
      const re = new RegExp(raw, "i");
      if (re.test(text)) return raw;
    } catch {
    }
  }
  return null;
}
function matchSensitivePath(target) {
  const normalized = target.trim();
  if (!normalized) return null;
  for (const { label, regex } of DEFAULT_SENSITIVE_PATH_PATTERNS) {
    if (regex.test(normalized)) return label;
  }
  return null;
}

// src/modules/remote/hook.ts
var FILE_MUTATION_TOOLS = /* @__PURE__ */ new Set([
  "delete_file",
  "write_file",
  "edit_file",
  "write_to_file",
  "replace_file_content",
  "multi_replace_file_content"
]);
var PATH_LIKE_KEYS = /* @__PURE__ */ new Set([
  "path",
  "file_path",
  "filepath",
  "target_file",
  "targetfile",
  "target_path",
  "targetpath",
  "absolutepath",
  "absolute_path",
  "filename",
  "file",
  "files",
  "paths",
  "uri"
]);
function normalizeToolArgs(raw) {
  if (raw === void 0 || raw === null) {
    return { obj: {}, text: "{}" };
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return { obj: parsed, text: JSON.stringify(parsed) };
        }
      } catch {
      }
    }
    return { obj: { raw: trimmed }, text: trimmed };
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return { obj: raw, text: JSON.stringify(raw) };
  }
  return { obj: {}, text: JSON.stringify(raw) };
}
function collectCandidatePaths(value, depth = 0) {
  if (depth > 5 || value === null || value === void 0) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(...collectCandidatePaths(item, depth + 1));
    return out;
  }
  if (typeof value === "object") {
    const record = value;
    const prioritized = [];
    const fallback = [];
    for (const [k, v] of Object.entries(record)) {
      const extracted = collectCandidatePaths(v, depth + 1);
      if (PATH_LIKE_KEYS.has(k.toLowerCase())) {
        prioritized.push(...extracted);
      } else {
        fallback.push(...extracted);
      }
    }
    return prioritized.length > 0 ? prioritized : fallback;
  }
  return [];
}
function extractSummary(obj, fallbackText) {
  const candidates = [
    obj.CommandLine,
    obj.command,
    obj.cmd,
    obj.file_path,
    obj.filePath,
    obj.TargetFile,
    obj.target_file,
    obj.path,
    obj.Path,
    obj.AbsolutePath
  ];
  for (const val of candidates) {
    if (typeof val === "string" && val.trim()) {
      return redactText(val).slice(0, 260);
    }
  }
  return redactText(fallbackText).slice(0, 260);
}
function loadEnabledRemoteStateReadOnly(rootDataDir) {
  const resolvedRoot = resolveNovDataDir(rootDataDir);
  const novConfig = loadNovConfigReadOnly(resolvedRoot);
  if (!novConfig.modules.remote) {
    return null;
  }
  const remoteDataDir = getModuleDataDir(resolvedRoot, "remote");
  const { config, persisted } = loadConfigReadOnly(remoteDataDir);
  if (!persisted || config.gatewayEnabled !== true) {
    return null;
  }
  return {
    config,
    runtime: readRuntimeInfo(remoteDataDir)
  };
}
async function handleRemotePreToolHook(payload, rootDataDir) {
  const active = loadEnabledRemoteStateReadOnly(rootDataDir);
  if (!active) {
    return {};
  }
  const { config, runtime } = active;
  const toolName = payload.toolName ?? "unknown";
  const { obj: toolArgsObj, text: rawArgsText } = normalizeToolArgs(payload.toolInput ?? {});
  let matched = matchRiskPattern(rawArgsText, config.riskPatterns);
  if (!matched && FILE_MUTATION_TOOLS.has(toolName.toLowerCase())) {
    const candidatePaths = collectCandidatePaths(toolArgsObj);
    for (const candidate of candidatePaths) {
      const hit = matchSensitivePath(candidate);
      if (hit) {
        matched = hit;
        break;
      }
    }
  }
  if (!matched) {
    return {};
  }
  const summary = extractSummary(toolArgsObj, rawArgsText);
  if (!config.remoteApprovalEnabled) {
    return {
      decision: "ask",
      reason: `Agy Remote risk policy matched (${matched}); prompting locally.`
    };
  }
  if (!runtime) {
    return {
      decision: "ask",
      reason: `Risky operation matched (${matched}) while remote gateway is offline; confirming locally.`
    };
  }
  try {
    const waitMs = Math.max(2e3, Math.min(25e3, config.approvalTimeoutSec * 1e3));
    const res = await fetch(`${runtime.url}/api/hooks/approval`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.pairingToken}`
      },
      body: JSON.stringify({
        conversationId: payload.conversationId ?? "unknown",
        toolName,
        summary,
        matchedRule: matched,
        timeoutSec: config.approvalTimeoutSec,
        waitMs
      }),
      signal: AbortSignal.timeout(waitMs + 1500)
    });
    if (res.ok) {
      const data = await res.json();
      const st = data.approval?.status;
      if (st === "approved") {
        return {
          decision: "allow",
          reason: `Approved remotely via Agy Remote (${data.approval?.decidedBy ?? "mobile"}).`
        };
      }
      if (st === "denied") {
        return {
          decision: "deny",
          reason: `Denied remotely via Agy Remote (${data.approval?.decidedBy ?? "mobile"}).`
        };
      }
    }
  } catch {
  }
  return {
    decision: "ask",
    reason: `Risky operation matched (${matched}) and no remote decision arrived; confirming locally.`
  };
}
async function handleRemoteStopHook(payload, rootDataDir) {
  const active = loadEnabledRemoteStateReadOnly(rootDataDir);
  if (!active) {
    return;
  }
  const { config, runtime } = active;
  if (!config.notifyOnStop) {
    return;
  }
  if (!runtime) {
    return;
  }
  const terminationReason = payload.terminationReason ?? "NO_TOOL_CALL";
  const lastUserInput = payload.lastUserInput ?? "";
  try {
    await fetch(`${runtime.url}/api/hooks/stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.pairingToken}`
      },
      body: JSON.stringify({
        conversationId: payload.conversationId ?? "unknown",
        terminationReason,
        lastUserInput,
        error: typeof payload.error === "string" ? payload.error : ""
      }),
      signal: AbortSignal.timeout(3e3)
    });
  } catch {
  }
}

// src/modules/review/hook.ts
var import_node_crypto6 = __toESM(require("node:crypto"), 1);
var import_node_fs9 = __toESM(require("node:fs"), 1);
var import_node_path11 = __toESM(require("node:path"), 1);
var MUTATING_TOOL_RE = /(write|edit|replace|patch|create|delete|remove|rename|move|run_command|command|bash|shell|terminal|multi_replace)/i;
function readReviewSignal(moduleDataDir) {
  if (!moduleDataDir) return null;
  const signalPath = import_node_path11.default.join(moduleDataDir, "review-signal.json");
  if (!import_node_fs9.default.existsSync(signalPath)) return null;
  try {
    const parsed = JSON.parse(import_node_fs9.default.readFileSync(signalPath, "utf8"));
    return {
      lastEvent: parsed.lastEvent,
      lastToolName: parsed.lastToolName,
      lastWriteAt: parsed.lastWriteAt,
      updatedAt: parsed.updatedAt,
      changeCount: typeof parsed.changeCount === "number" ? parsed.changeCount : 0,
      workspacePaths: Array.isArray(parsed.workspacePaths) ? parsed.workspacePaths : void 0,
      conversationId: parsed.conversationId
    };
  } catch {
    return null;
  }
}
function handleReviewHook(payload, rootDataDir) {
  const moduleDataDir = getModuleDataDir(rootDataDir, "review");
  const event = payload.event;
  const toolName = payload.toolName;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    ensurePrivateDir(moduleDataDir);
    const signalPath = import_node_path11.default.join(moduleDataDir, "review-signal.json");
    const prev = readReviewSignal(moduleDataDir) ?? { changeCount: 0 };
    const isMutating = event === "Stop" || (toolName ? MUTATING_TOOL_RE.test(toolName) : false);
    const next = {
      ...prev,
      lastEvent: event,
      lastToolName: toolName ?? prev.lastToolName,
      lastWriteAt: isMutating ? now : prev.lastWriteAt,
      updatedAt: now,
      changeCount: isMutating ? prev.changeCount + 1 : prev.changeCount,
      workspacePaths: payload.workspacePaths.length > 0 ? payload.workspacePaths : prev.workspacePaths,
      conversationId: payload.conversationId ?? prev.conversationId
    };
    const tmpPath = `${signalPath}.${process.pid}.${import_node_crypto6.default.randomBytes(4).toString("hex")}.tmp`;
    import_node_fs9.default.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}
`, { encoding: "utf8", mode: 384 });
    import_node_fs9.default.renameSync(tmpPath, signalPath);
  } catch {
  }
}

// src/modules/spec/hook.ts
var import_node_fs11 = __toESM(require("node:fs"), 1);

// src/modules/spec/core.ts
var import_node_crypto7 = __toESM(require("node:crypto"), 1);
var import_node_fs10 = __toESM(require("node:fs"), 1);
var import_node_path12 = __toESM(require("node:path"), 1);
var SPEC_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;
var SPEC_TASK_ID_RE = /^[a-zA-Z0-9._-]{1,48}$/;
var SPEC_DELTA_ID_RE = /^[a-zA-Z0-9._-]{1,48}$/;
var SPEC_ANNOTATION_ID_RE = /^[a-zA-Z0-9._-]{1,48}$/;
var MAX_SPECS = 50;
var MAX_TASKS_PER_SPEC = 100;
var MAX_CRITERIA_ITEMS = 50;
var MAX_PLAN_STEPS = 80;
var MAX_DELTA_ITEMS = 60;
var MAX_PLAN_MARKDOWN_CHARS = 24e3;
var MAX_REVISIONS_PER_SPEC = 8;
var MAX_ANNOTATIONS_PER_SPEC = 100;
var VALID_SPEC_STATUSES = /* @__PURE__ */ new Set([
  "draft",
  "approved",
  "completed",
  "archived"
]);
var VALID_TASK_STATUSES = /* @__PURE__ */ new Set([
  "pending",
  "in_progress",
  "done",
  "blocked"
]);
var VALID_SPEC_MODES = /* @__PURE__ */ new Set(["full", "delta"]);
var VALID_DELTA_KINDS = /* @__PURE__ */ new Set([
  "added",
  "modified",
  "removed"
]);
var VALID_ANNOTATION_KINDS = /* @__PURE__ */ new Set([
  "comment",
  "strike",
  "replace"
]);
function sanitizeSingleLine(input, maxLen) {
  return input.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLen);
}
function sanitizeMultiline(input, maxLen) {
  return input.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim().slice(0, maxLen);
}
function sanitizeOptionalMultiline(input, maxLen) {
  if (typeof input !== "string") return void 0;
  const cleaned = sanitizeMultiline(input, maxLen);
  return cleaned.length > 0 ? cleaned : void 0;
}
function sanitizeStringList(raw, maxItems, maxLen) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const cleaned = sanitizeSingleLine(item, maxLen);
    if (cleaned) {
      out.push(cleaned);
      if (out.length >= maxItems) break;
    }
  }
  return out;
}
function sanitizePlanMarkdown(input) {
  return input.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trimEnd().slice(0, MAX_PLAN_MARKDOWN_CHARS);
}
function createDeltaItemId(index, existingIds) {
  for (let i = 0; i < 16; i += 1) {
    const candidate = `delta-${index + 1}-${import_node_crypto7.default.randomBytes(2).toString("hex")}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `delta-${index + 1}-${Date.now().toString(36)}`;
}
function sanitizeDeltaItems(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seenIds = /* @__PURE__ */ new Set();
  for (let i = 0; i < raw.length && out.length < MAX_DELTA_ITEMS; i += 1) {
    const entry = raw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry;
    const kind = typeof obj.kind === "string" && VALID_DELTA_KINDS.has(obj.kind) ? obj.kind : null;
    if (!kind) continue;
    const text = typeof obj.text === "string" ? sanitizeSingleLine(obj.text, 500) : "";
    if (!text) continue;
    const area = typeof obj.area === "string" && sanitizeSingleLine(obj.area, 80) ? sanitizeSingleLine(obj.area, 80) : void 0;
    const rawId = typeof obj.id === "string" ? obj.id.trim() : "";
    const id = rawId && SPEC_DELTA_ID_RE.test(rawId) && !seenIds.has(rawId) ? rawId : createDeltaItemId(out.length, seenIds);
    seenIds.add(id);
    out.push({
      id,
      kind,
      ...area ? { area } : {},
      text
    });
  }
  return out;
}
function synthesizePlanMarkdown(input) {
  const lines = [];
  lines.push(`# ${input.title}`);
  lines.push(
    input.mode === "delta" ? "> Mode: BROWNFIELD DELTA SPEC" : "> Mode: FULL SPEC"
  );
  lines.push("");
  lines.push("## Goal");
  lines.push(input.goal);
  if (input.deltaItems.length > 0) {
    lines.push("");
    lines.push("## Behavioral Delta");
    for (const item of input.deltaItems) {
      const areaPrefix = item.area ? `(${item.area}) ` : "";
      lines.push(`- [${item.kind.toUpperCase()}] ${areaPrefix}${item.text}`);
    }
  }
  if (input.planSteps.length > 0) {
    lines.push("");
    lines.push("## Implementation Plan");
    input.planSteps.forEach((step, idx) => {
      lines.push(`${idx + 1}. ${step}`);
    });
  }
  if (input.acceptanceCriteria.length > 0) {
    lines.push("");
    lines.push("## Acceptance Criteria");
    for (const criterion of input.acceptanceCriteria) {
      lines.push(`- [ ] ${criterion}`);
    }
  }
  if (input.tasks && input.tasks.length > 0) {
    lines.push("");
    lines.push("## Task DAG");
    for (const task of input.tasks) {
      const deps = task.dependsOn.length > 0 ? ` (depends on: ${task.dependsOn.join(", ")})` : "";
      lines.push(`- \`${task.id}\`: ${task.title}${deps}`);
    }
  }
  return sanitizePlanMarkdown(lines.join("\n"));
}
function getSpecStatePath(moduleDataDir) {
  return import_node_path12.default.join(moduleDataDir, "state.json");
}
function createEmptySpecState() {
  return {
    schemaVersion: 1,
    activeSpecId: null,
    specs: [],
    updatedAt: (/* @__PURE__ */ new Date(0)).toISOString()
  };
}
function findCyclePath(cycleNodeIds, dependsOnMap) {
  const state = /* @__PURE__ */ new Map();
  const stack = [];
  const dfs = (node) => {
    state.set(node, 1);
    stack.push(node);
    const deps = dependsOnMap.get(node) ?? [];
    for (const dep of deps) {
      if (!cycleNodeIds.has(dep)) continue;
      const st = state.get(dep) ?? 0;
      if (st === 1) {
        const idx = stack.indexOf(dep);
        return [...stack.slice(idx), dep];
      }
      if (st === 0) {
        const found = dfs(dep);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(node, 2);
    return null;
  };
  for (const node of cycleNodeIds) {
    if ((state.get(node) ?? 0) === 0) {
      const cycle = dfs(node);
      if (cycle) return cycle;
    }
  }
  return [...cycleNodeIds];
}
function validateTaskDag(tasks) {
  if (tasks.length > MAX_TASKS_PER_SPEC) {
    return {
      valid: false,
      error: `Spec cannot contain more than ${MAX_TASKS_PER_SPEC} tasks.`
    };
  }
  const idSet = /* @__PURE__ */ new Set();
  const dependsOnMap = /* @__PURE__ */ new Map();
  for (const task of tasks) {
    if (typeof task.id !== "string" || !SPEC_TASK_ID_RE.test(task.id)) {
      return {
        valid: false,
        error: `Invalid task id "${String(task.id)}": must match ${SPEC_TASK_ID_RE.source}.`
      };
    }
    if (idSet.has(task.id)) {
      return {
        valid: false,
        error: `Duplicate task id "${task.id}". Task IDs must be unique within a spec.`
      };
    }
    idSet.add(task.id);
  }
  const inDegree = /* @__PURE__ */ new Map();
  const dependents = /* @__PURE__ */ new Map();
  for (const task of tasks) {
    inDegree.set(task.id, 0);
    dependents.set(task.id, []);
  }
  for (const task of tasks) {
    const dedupDeps = [];
    const seenDeps = /* @__PURE__ */ new Set();
    for (const rawDep of task.dependsOn) {
      if (typeof rawDep !== "string" || !rawDep.trim()) {
        return {
          valid: false,
          error: `Task "${task.id}" contains an empty dependency ID.`
        };
      }
      const dep = rawDep;
      if (dep === task.id) {
        return {
          valid: false,
          error: `Task "${task.id}" cannot depend on itself (self-cycle detected).`
        };
      }
      if (!idSet.has(dep)) {
        return {
          valid: false,
          error: `Task "${task.id}" depends on unknown task "${dep}".`
        };
      }
      if (!seenDeps.has(dep)) {
        seenDeps.add(dep);
        dedupDeps.push(dep);
      }
    }
    dependsOnMap.set(task.id, dedupDeps);
    inDegree.set(task.id, dedupDeps.length);
    for (const dep of dedupDeps) {
      dependents.get(dep).push(task.id);
    }
  }
  const queue = [];
  const depths = /* @__PURE__ */ new Map();
  for (const task of tasks) {
    if ((inDegree.get(task.id) ?? 0) === 0) {
      queue.push(task.id);
      depths.set(task.id, 0);
    }
  }
  const orderedIds = [];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    orderedIds.push(current);
    const currentDepth = depths.get(current) ?? 0;
    for (const next of dependents.get(current) ?? []) {
      const prevDepth = depths.get(next) ?? 0;
      if (currentDepth + 1 > prevDepth) {
        depths.set(next, currentDepth + 1);
      }
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) {
        queue.push(next);
      }
    }
  }
  if (orderedIds.length !== tasks.length) {
    const remainingNodes = new Set(
      tasks.filter((t) => (inDegree.get(t.id) ?? 0) > 0).map((t) => t.id)
    );
    const cyclePath = findCyclePath(remainingNodes, dependsOnMap);
    return {
      valid: false,
      error: `Dependency cycle detected in task DAG: ${cyclePath.join(" -> ")}.`
    };
  }
  return {
    valid: true,
    orderedIds,
    depths
  };
}
function computeSpecTaskViews(tasks) {
  const dag = validateTaskDag(tasks);
  const depths = dag.valid ? dag.depths : /* @__PURE__ */ new Map();
  const taskMap = /* @__PURE__ */ new Map();
  for (const task of tasks) {
    taskMap.set(task.id, task);
  }
  return tasks.map((task) => {
    const unmetDeps = task.dependsOn.filter((depId) => taskMap.get(depId)?.status !== "done");
    let computedState;
    if (task.status === "done") {
      computedState = "done";
    } else if (task.status === "in_progress") {
      computedState = "in_progress";
    } else if (task.status === "blocked") {
      computedState = "blocked";
    } else {
      computedState = unmetDeps.length === 0 ? "ready" : "waiting_deps";
    }
    return {
      ...task,
      dependsOn: [...task.dependsOn],
      computedState,
      unmetDeps,
      depth: depths.get(task.id) ?? 0
    };
  });
}
function buildSpecDocumentView(spec) {
  const unresolvedAnnotations = spec.annotations.reduce(
    (acc, ann) => acc + (ann.resolved ? 0 : 1),
    0
  );
  return {
    id: spec.id,
    title: spec.title,
    goal: spec.goal,
    mode: spec.mode,
    deltaItems: spec.deltaItems.map((d) => ({ ...d })),
    planMarkdown: spec.planMarkdown,
    revision: spec.revision,
    revisions: spec.revisions.map((r) => ({ ...r })),
    annotations: spec.annotations.map((a) => ({ ...a })),
    unresolvedAnnotations,
    ...spec.archivedMemoryId !== void 0 ? { archivedMemoryId: spec.archivedMemoryId } : {},
    acceptanceCriteria: [...spec.acceptanceCriteria],
    planSteps: [...spec.planSteps],
    status: spec.status,
    enforcePlanBeforeWrite: spec.enforcePlanBeforeWrite,
    requireUiApproval: spec.requireUiApproval,
    ...spec.approvedBy !== void 0 ? { approvedBy: spec.approvedBy } : {},
    ...spec.approvedAt !== void 0 ? { approvedAt: spec.approvedAt } : {},
    ...spec.approvalNote !== void 0 ? { approvalNote: spec.approvalNote } : {},
    tasks: computeSpecTaskViews(spec.tasks),
    createdAt: spec.createdAt,
    updatedAt: spec.updatedAt
  };
}
function isSpecWriteLockActive(spec) {
  return Boolean(spec && spec.status === "draft" && spec.enforcePlanBeforeWrite === true);
}
function buildSpecStateView(state, mode = "live", requestedSpecId) {
  const globalActiveSpec = state.activeSpecId ? state.specs.find((s) => s.id === state.activeSpecId) ?? null : null;
  const effectiveActiveSpecId = globalActiveSpec ? globalActiveSpec.id : null;
  const targetSpec = requestedSpecId ? state.specs.find((s) => s.id === requestedSpecId) ?? null : globalActiveSpec;
  const sortedSpecs = [...state.specs].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  );
  const specs = sortedSpecs.map((spec) => {
    const taskViews = computeSpecTaskViews(spec.tasks);
    let doneTasks = 0;
    let readyTasks = 0;
    for (const task of taskViews) {
      if (task.status === "done") doneTasks += 1;
      if (task.computedState === "ready") readyTasks += 1;
    }
    const unresolvedAnnotations = spec.annotations.reduce(
      (acc, ann) => acc + (ann.resolved ? 0 : 1),
      0
    );
    return {
      id: spec.id,
      title: spec.title,
      mode: spec.mode,
      revision: spec.revision,
      unresolvedAnnotations,
      ...spec.archivedMemoryId !== void 0 ? { archivedMemoryId: spec.archivedMemoryId } : {},
      status: spec.status,
      enforcePlanBeforeWrite: spec.enforcePlanBeforeWrite,
      requireUiApproval: spec.requireUiApproval,
      totalTasks: taskViews.length,
      doneTasks,
      readyTasks,
      updatedAt: spec.updatedAt
    };
  });
  return {
    mode,
    activeSpecId: effectiveActiveSpecId,
    activeSpec: targetSpec ? buildSpecDocumentView(targetSpec) : null,
    specs,
    writeLockActive: isSpecWriteLockActive(globalActiveSpec)
  };
}
function normalizeTaskFromDisk(raw, fallbackIso) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw;
  if (typeof obj.id !== "string" || !SPEC_TASK_ID_RE.test(obj.id.trim())) return null;
  const id = obj.id.trim();
  const title = typeof obj.title === "string" ? sanitizeSingleLine(obj.title, 200) : "";
  if (!title) return null;
  const status = typeof obj.status === "string" && VALID_TASK_STATUSES.has(obj.status) ? obj.status : "pending";
  const dependsOn = [];
  if (Array.isArray(obj.dependsOn)) {
    const seen = /* @__PURE__ */ new Set();
    for (const dep of obj.dependsOn) {
      if (typeof dep === "string") {
        const cleanDep = dep.trim();
        if (cleanDep && cleanDep !== id && SPEC_TASK_ID_RE.test(cleanDep) && !seen.has(cleanDep)) {
          seen.add(cleanDep);
          dependsOn.push(cleanDep);
        }
      }
    }
  }
  const description = sanitizeOptionalMultiline(obj.description, 2e3);
  const note = sanitizeOptionalMultiline(obj.note, 2e3);
  return {
    id,
    title,
    ...description !== void 0 ? { description } : {},
    dependsOn,
    status,
    ...note !== void 0 ? { note } : {},
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : fallbackIso
  };
}
function normalizeRevisionsFromDisk(raw, currentRevision, currentMarkdown, fallbackIso) {
  const byRev = /* @__PURE__ */ new Map();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const obj = item;
      const rev = typeof obj.revision === "number" && Number.isInteger(obj.revision) && obj.revision >= 1 ? obj.revision : null;
      if (rev === null) continue;
      const planMarkdown = typeof obj.planMarkdown === "string" ? sanitizePlanMarkdown(obj.planMarkdown) : "";
      const updatedAt = typeof obj.updatedAt === "string" ? obj.updatedAt : fallbackIso;
      const summary = typeof obj.summary === "string" && sanitizeSingleLine(obj.summary, 300) ? sanitizeSingleLine(obj.summary, 300) : void 0;
      byRev.set(rev, {
        revision: rev,
        planMarkdown,
        updatedAt,
        ...summary ? { summary } : {}
      });
    }
  }
  if (!byRev.has(currentRevision)) {
    byRev.set(currentRevision, {
      revision: currentRevision,
      planMarkdown: currentMarkdown,
      updatedAt: fallbackIso
    });
  }
  return Array.from(byRev.values()).sort((a, b) => a.revision - b.revision).slice(-MAX_REVISIONS_PER_SPEC);
}
function normalizeAnnotationsFromDisk(raw, defaultRevision, fallbackIso) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seenIds = /* @__PURE__ */ new Set();
  for (const item of raw) {
    if (out.length >= MAX_ANNOTATIONS_PER_SPEC) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item;
    const rawId = typeof obj.id === "string" ? obj.id.trim() : "";
    const id = rawId && SPEC_ANNOTATION_ID_RE.test(rawId) && !seenIds.has(rawId) ? rawId : `ann_${import_node_crypto7.default.randomBytes(4).toString("hex")}`;
    if (seenIds.has(id)) continue;
    const kind = typeof obj.kind === "string" && VALID_ANNOTATION_KINDS.has(obj.kind) ? obj.kind : null;
    if (!kind) continue;
    const lineStart = typeof obj.lineStart === "number" && Number.isInteger(obj.lineStart) && obj.lineStart >= 1 ? obj.lineStart : null;
    const lineEnd = typeof obj.lineEnd === "number" && Number.isInteger(obj.lineEnd) && obj.lineEnd >= 1 ? obj.lineEnd : null;
    if (lineStart === null || lineEnd === null || lineEnd < lineStart) continue;
    const revision = typeof obj.revision === "number" && Number.isInteger(obj.revision) && obj.revision >= 1 ? obj.revision : defaultRevision;
    const note = typeof obj.note === "string" ? sanitizeMultiline(obj.note, 2e3) : "";
    const suggestedText = sanitizeOptionalMultiline(obj.suggestedText, 6e3);
    const resolved = Boolean(obj.resolved);
    const createdAt = typeof obj.createdAt === "string" ? obj.createdAt : fallbackIso;
    const resolvedAt = resolved && typeof obj.resolvedAt === "string" ? obj.resolvedAt : void 0;
    seenIds.add(id);
    out.push({
      id,
      revision,
      lineStart,
      lineEnd,
      kind,
      note,
      ...suggestedText !== void 0 ? { suggestedText } : {},
      resolved,
      createdAt,
      ...resolvedAt !== void 0 ? { resolvedAt } : {}
    });
  }
  return out;
}
function normalizeSpecFromDisk(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw;
  if (typeof obj.id !== "string" || !SPEC_ID_RE.test(obj.id.trim())) return null;
  const id = obj.id.trim();
  const title = typeof obj.title === "string" ? sanitizeSingleLine(obj.title, 200) : "";
  if (!title) return null;
  const goal = typeof obj.goal === "string" ? sanitizeMultiline(obj.goal, 4e3) : "";
  const createdAt = typeof obj.createdAt === "string" ? obj.createdAt : (/* @__PURE__ */ new Date()).toISOString();
  const updatedAt = typeof obj.updatedAt === "string" ? obj.updatedAt : createdAt;
  const status = typeof obj.status === "string" && VALID_SPEC_STATUSES.has(obj.status) ? obj.status : "draft";
  const mode = typeof obj.mode === "string" && VALID_SPEC_MODES.has(obj.mode) ? obj.mode : "full";
  const deltaItems = sanitizeDeltaItems(obj.deltaItems);
  const acceptanceCriteria = sanitizeStringList(obj.acceptanceCriteria, MAX_CRITERIA_ITEMS, 500);
  const planSteps = sanitizeStringList(obj.planSteps, MAX_PLAN_STEPS, 500);
  const rawTasks = [];
  if (Array.isArray(obj.tasks)) {
    const seenTaskIds = /* @__PURE__ */ new Set();
    for (const item of obj.tasks.slice(0, MAX_TASKS_PER_SPEC)) {
      const task = normalizeTaskFromDisk(item, updatedAt);
      if (task && !seenTaskIds.has(task.id)) {
        seenTaskIds.add(task.id);
        rawTasks.push(task);
      }
    }
  }
  const knownTaskIds = new Set(rawTasks.map((t) => t.id));
  const tasks = rawTasks.map((t) => ({
    ...t,
    dependsOn: t.dependsOn.filter((dep) => knownTaskIds.has(dep))
  }));
  const rawPlanMarkdown = typeof obj.planMarkdown === "string" ? sanitizePlanMarkdown(obj.planMarkdown) : "";
  const planMarkdown = rawPlanMarkdown.length > 0 ? rawPlanMarkdown : synthesizePlanMarkdown({
    title,
    mode,
    goal,
    deltaItems,
    acceptanceCriteria,
    planSteps,
    tasks
  });
  const revision = typeof obj.revision === "number" && Number.isInteger(obj.revision) && obj.revision >= 1 ? obj.revision : 1;
  const revisions = normalizeRevisionsFromDisk(obj.revisions, revision, planMarkdown, updatedAt);
  const annotations = normalizeAnnotationsFromDisk(obj.annotations, revision, updatedAt);
  const archivedMemoryId = typeof obj.archivedMemoryId === "string" && obj.archivedMemoryId.trim() ? sanitizeSingleLine(obj.archivedMemoryId, 80) : void 0;
  const approvedBy = obj.approvedBy === "user" || obj.approvedBy === "model" ? obj.approvedBy : void 0;
  const approvedAt = typeof obj.approvedAt === "string" ? obj.approvedAt : void 0;
  const approvalNote = sanitizeOptionalMultiline(obj.approvalNote, 1e3);
  return {
    id,
    title,
    goal,
    mode,
    deltaItems,
    planMarkdown,
    revision,
    revisions,
    annotations,
    ...archivedMemoryId !== void 0 ? { archivedMemoryId } : {},
    acceptanceCriteria,
    planSteps,
    status,
    enforcePlanBeforeWrite: typeof obj.enforcePlanBeforeWrite === "boolean" ? obj.enforcePlanBeforeWrite : true,
    requireUiApproval: typeof obj.requireUiApproval === "boolean" ? obj.requireUiApproval : false,
    ...approvedBy !== void 0 ? { approvedBy } : {},
    ...approvedAt !== void 0 ? { approvedAt } : {},
    ...approvalNote !== void 0 ? { approvalNote } : {},
    tasks,
    createdAt,
    updatedAt
  };
}
function loadSpecStateReadOnly(moduleDataDir) {
  const statePath = getSpecStatePath(moduleDataDir);
  if (!import_node_fs10.default.existsSync(statePath)) {
    return createEmptySpecState();
  }
  try {
    const raw = JSON.parse(import_node_fs10.default.readFileSync(statePath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return createEmptySpecState();
    }
    const specs = [];
    const seenSpecIds = /* @__PURE__ */ new Set();
    if (Array.isArray(raw.specs)) {
      for (const item of raw.specs.slice(0, MAX_SPECS)) {
        const spec = normalizeSpecFromDisk(item);
        if (spec && !seenSpecIds.has(spec.id)) {
          seenSpecIds.add(spec.id);
          specs.push(spec);
        }
      }
    }
    const activeSpecId = typeof raw.activeSpecId === "string" && seenSpecIds.has(raw.activeSpecId) ? raw.activeSpecId : null;
    return {
      schemaVersion: 1,
      activeSpecId,
      specs,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch {
    return createEmptySpecState();
  }
}

// src/modules/spec/hook.ts
var SPEC_WRITE_LOCK_TOOLS = /* @__PURE__ */ new Set([
  "write",
  "edit",
  "multi_edit",
  "multiedit",
  "notebook_edit",
  "notebookedit",
  "write_file",
  "edit_file",
  "write_to_file",
  "create_file",
  "patch_file",
  "apply_patch",
  "replace_file_content",
  "multi_replace_file_content",
  "delete_file"
]);
function normalizeToolName(rawName) {
  if (!rawName) return "";
  const trimmed = rawName.trim().toLowerCase();
  const sepIdx = Math.max(trimmed.lastIndexOf(":"), trimmed.lastIndexOf("/"));
  return sepIdx >= 0 ? trimmed.slice(sepIdx + 1) : trimmed;
}
function isAlwaysAllowedSpecOrNovTool(normalizedToolName) {
  return normalizedToolName.startsWith("spec_") || normalizedToolName.startsWith("nov_") || normalizedToolName.startsWith("app_spec_");
}
function handleSpecPreToolHook(payload, rootDataDir) {
  try {
    if (payload.event !== "PreToolUse") {
      return {};
    }
    const toolName = normalizeToolName(payload.toolName);
    if (!toolName || isAlwaysAllowedSpecOrNovTool(toolName)) {
      return {};
    }
    if (!SPEC_WRITE_LOCK_TOOLS.has(toolName)) {
      return {};
    }
    const resolvedRoot = resolveNovDataDir(rootDataDir);
    const moduleDataDir = getModuleDataDir(resolvedRoot, "spec");
    if (!import_node_fs11.default.existsSync(getSpecStatePath(moduleDataDir))) {
      return {};
    }
    const state = loadSpecStateReadOnly(moduleDataDir);
    const activeSpec = state.activeSpecId ? state.specs.find((s) => s.id === state.activeSpecId) ?? null : null;
    if (activeSpec && isSpecWriteLockActive(activeSpec)) {
      const safeTitle = activeSpec.title.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
      return {
        decision: "deny",
        reason: `[agy-NOV Spec Flow] Active spec "${safeTitle}" is in DRAFT with write lock enabled. Approve the spec in agy-NOV Spec Flow before editing workspace files.`
      };
    }
    return {};
  } catch {
    return {};
  }
}
function handleSpecSessionStartHook(payload, rootDataDir) {
  try {
    if (payload.event !== "SessionStart") {
      return {};
    }
    const resolvedRoot = resolveNovDataDir(rootDataDir);
    const moduleDataDir = getModuleDataDir(resolvedRoot, "spec");
    if (!import_node_fs11.default.existsSync(getSpecStatePath(moduleDataDir))) {
      return {};
    }
    const state = loadSpecStateReadOnly(moduleDataDir);
    const view = buildSpecStateView(state, "live");
    const spec = view.activeSpec;
    if (!spec || spec.status !== "draft" && spec.status !== "approved") {
      return {};
    }
    const readyTasks = spec.tasks.filter((t) => t.computedState === "ready");
    const inProgressCount = spec.tasks.filter((t) => t.computedState === "in_progress").length;
    const doneCount = spec.tasks.filter((t) => t.computedState === "done").length;
    const waitingCount = spec.tasks.filter((t) => t.computedState === "waiting_deps").length;
    const blockedCount = spec.tasks.filter((t) => t.computedState === "blocked").length;
    const writeLockLabel = view.writeLockActive ? "ENABLED (workspace writes blocked until approved)" : spec.enforcePlanBeforeWrite ? "UNLOCKED (spec approved)" : "OFF";
    const modeTag = spec.mode === "delta" ? "[DELTA] " : "";
    const lines = [
      `[agy-NOV Spec Flow] Active Spec: ${modeTag}"${spec.title}" (${spec.id}) [v${spec.revision}]`,
      `Status: ${spec.status.toUpperCase()} | Write Lock: ${writeLockLabel}${spec.requireUiApproval ? " | UI Approval Required" : ""}`,
      `Progress: ${doneCount}/${spec.tasks.length} done, ${inProgressCount} in_progress, ${readyTasks.length} ready, ${waitingCount} waiting_deps, ${blockedCount} blocked`
    ];
    if (spec.mode === "delta" && spec.deltaItems.length > 0) {
      const added = spec.deltaItems.filter((d) => d.kind === "added").length;
      const modified = spec.deltaItems.filter((d) => d.kind === "modified").length;
      const removed = spec.deltaItems.filter((d) => d.kind === "removed").length;
      lines.push(`Delta Contract: +${added} added, ~${modified} modified, -${removed} removed`);
    }
    if (spec.unresolvedAnnotations > 0) {
      lines.push(
        `Plan Review Pending: ${spec.unresolvedAnnotations} unresolved inline annotation(s) on v${spec.revision}. Read and address the user's inline annotations via spec_get_state (and publish v${spec.revision + 1}) before requesting approval.`
      );
    }
    const topReady = readyTasks.slice(0, 5);
    if (topReady.length > 0) {
      lines.push(`Next Ready Tasks (${topReady.length}/${readyTasks.length}):`);
      for (const task of topReady) {
        lines.push(`- [${task.id}] (depth ${task.depth}) ${task.title}`);
      }
    } else {
      lines.push("Next Ready Tasks: none (remaining tasks are in progress, waiting on dependencies, blocked, or done).");
    }
    if (view.writeLockActive) {
      lines.push(
        spec.requireUiApproval ? "Action required: Ask the user to review and approve this draft spec in the agy-NOV Spec Flow UI before editing workspace files." : "Action required: Approve this draft spec before editing workspace files."
      );
    }
    return {
      injectSteps: [
        {
          systemMessage: {
            systemMessage: lines.join("\n")
          }
        }
      ]
    };
  } catch {
    return {};
  }
}

// src/modules/turbo/hook.ts
var import_node_fs14 = __toESM(require("node:fs"), 1);
var import_node_path15 = __toESM(require("node:path"), 1);

// src/modules/turbo/auto-rtk.ts
var import_node_crypto9 = __toESM(require("node:crypto"), 1);
var import_node_fs13 = __toESM(require("node:fs"), 1);
var import_node_path14 = __toESM(require("node:path"), 1);

// src/modules/turbo/core.ts
var import_node_crypto8 = __toESM(require("node:crypto"), 1);
var import_node_fs12 = __toESM(require("node:fs"), 1);
var import_node_path13 = __toESM(require("node:path"), 1);
var TURBO_MAX_FILE_BYTES = 512 * 1024;
var TURBO_MAX_OUTLINE_FILE_BYTES = 1024 * 1024;
var TURBO_MAX_COMPACTED_CHUNKS = 24;
var SKIP_DIRS = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".next",
  ".nuxt",
  ".cache",
  ".turbo",
  "build",
  "out",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube"
]);
var SENSITIVE_EXTENSIONS2 = /* @__PURE__ */ new Set([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"]);
var SENSITIVE_EXACT_BASENAMES = /* @__PURE__ */ new Set([
  ".env",
  ".envrc",
  ".npmrc",
  ".netrc",
  ".pypirc",
  "id_rsa",
  "id_ed25519",
  "id_dsa",
  "id_ecdsa",
  "master.key"
]);
var SENSITIVE_DIR_SEGMENT_RE = /(?:^|\/)\.(?:ssh|aws|gnupg|kube)(?:\/|$)/i;
function isSensitiveTurboPath(inputPath) {
  if (!inputPath) return false;
  const normalized = inputPath.replace(/\\/g, "/").trim().replace(/\/+$/, "");
  if (!normalized) return false;
  if (SENSITIVE_DIR_SEGMENT_RE.test(normalized)) return true;
  const segments = normalized.split("/").filter(Boolean);
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (lower === ".ssh" || lower === ".aws" || lower === ".gnupg" || lower === ".kube" || lower.startsWith(".env") || lower.startsWith("credentials") || lower.includes("secret")) {
      return true;
    }
  }
  const base = import_node_path13.default.posix.basename(normalized);
  const lowerBase = base.toLowerCase();
  if (SENSITIVE_EXACT_BASENAMES.has(lowerBase)) return true;
  if (lowerBase.startsWith("id_rsa.") || lowerBase.startsWith("id_ed25519.") || lowerBase.startsWith("id_dsa.") || lowerBase.startsWith("id_ecdsa.")) {
    return true;
  }
  const ext = import_node_path13.default.posix.extname(lowerBase);
  if (SENSITIVE_EXTENSIONS2.has(ext)) return true;
  return false;
}
var ANSI_ESCAPE_RE = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;
var ERROR_LINE_RE = /\b(?:error|err!|fail|failed|failure|exception|fatal|panic|traceback|assertionerror|typeerror|syntaxerror|referenceerror|enoent|eacces|ts\d{4})\b|^\s*(?:✗|✖|×|FAIL\b)/i;
var WARN_LINE_RE = /\b(?:warn|warning|deprecated)\b|^\s*⚠/i;
function stripAnsiSequences(text) {
  return text.replace(ANSI_ESCAPE_RE, "");
}
function cleanLogLine(line) {
  const noAnsi = stripAnsiSequences(line);
  if (!noAnsi.includes("\r")) return noAnsi;
  const segments = noAnsi.split("\r");
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (segments[i].length > 0) return segments[i];
  }
  return "";
}
function normalizeDiagKey(line) {
  return line.trim().replace(/\b\d+\b/g, "#").replace(/\s+/g, " ").slice(0, 120);
}
var TEST_PASS_LINE_RE = /^\s*(?:(?:✔|✓)\s+(?!built in\b|\d+\s+modules?\s+transformed\b)\S|ok\s+\d+(?:\s|-|$)|PASS(?:\s+\S|\s*$)|---\s+PASS:|test\s+.+\.\.\.\s+ok\s*$|.+::.+PASSED(?:\s+\[\s*\d+%\])?\s*$)/;
var TEST_FAIL_START_RE = /^\s*(?:FAIL(?:\s|:|$)|not ok\s+\d+|---\s+FAIL:|(?:✖|✗|×)\s+|AssertionError\b|Error:|TypeError:|SyntaxError:|ReferenceError:|Traceback\b|FAILURES\b|short test summary|thread '[^']*' panicked|panicked at|E\s{3,})|\.\.\.\s+FAILED\s*$|\bFAILED(?:\s+\[\s*\d+%\])?\s*$/;
var TEST_STACK_OR_DIFF_RE = /^\s*(?:at\s+\S|File\s+"|Expected\b|Received\b|Actual\b|expected\b|actual\b|stack:|[-+]\s|\|\s|\d+\s*\||>?\s*\d+\s*\||[~^]{2,}|Difference:)/;
var TEST_SUMMARY_LINE_RE = /^\s*(?:Tests:|Test Suites:|Test Files\b|Snapshots:|Time:|Duration\b|Start at\b|Summary:|Ran\s+\d+\s+tests?|test result:|ℹ\s+(?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b|={3,}.*(?:passed|failed|error).*={3,}|FAILED\s*\(|exitCode=|exit code\b)/i;
var TEST_VERBOSE_NOISE_RE = /^\s*(?:info\s+\[|debug\s+\[|\[(?:info|debug)\]|#\s*Subtest:)/i;
var BUILD_NOISE_LINE_RE = /transforming\s*\(\d+\)|\b\d+\s+modules?\s+transformed\b|^\s*(?:transforming\b|Compiling\s+|Checking\s+|Downloading\s+|Unpacking\s+|Resolving\s+|Fetching\s+|Updating\s+|Fresh\s+|Copying\s+|Bundling\s+|Generating\s+|Rendering\s+chunks|Computing\s+gzip|reify:|npm\s+(?:timing|http)\b|info\s+\[|debug\s+\[|\[(?:info|debug)\]|\[\d+\/\d+\]\s+(?:Building|Compiling|Resolving|Fetching|Linking)|\d{1,3}%\s+(?:building|sealing|emitting|compiling|hashing|asset))/i;
var BUILD_FILE_LOC_RE = /[A-Za-z0-9_./-]+\.[A-Za-z0-9]+(?:\(\d+,\d+\)|:\d+:\d+)/;
var BUILD_DIAG_CONTEXT_RE = /^\s*(?:\d+\s*\||\|\s|[~^]{2,}|-->\s+|=\s*(?:note|help):|at\s+\S)/;
var BUILD_SUMMARY_LINE_RE = /(?:✓|✔)?\s*built in\s+\d|^\s*(?:Finished\s+|Found\s+\d+\s+errors?|Compiled\s+|Build\s+(?:succeeded|failed|complete)|Done in\s+|added\s+\d+\s+packages|found\s+\d+\s+vulnerabilities|Summary:|FAILED\b|dist\/\S+\s+[\d.]+\s*(?:kB|KB|MB|B)\b|webpack\b.*compiled)/i;
var LOCK_OR_GENERATED_PATH_RE = /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock|go\.sum|Podfile\.lock|uv\.lock|flake\.lock|bun\.lock|bun\.lockb)$|(?:^|\/)(?:dist|build|vendor|generated)\/|\.(?:min\.js|min\.css|bundle\.js|map|snap|pb\.go)$|\.generated\.[^/]+$/i;
function detectOutputPreset(text) {
  const raw = typeof text === "string" ? text : String(text ?? "");
  if (!raw.trim()) return "generic";
  const rawLines = raw.split(/\r?\n/);
  const sampleLines = [];
  if (rawLines.length <= 800) {
    for (const l of rawLines) sampleLines.push(cleanLogLine(l));
  } else {
    for (let i = 0; i < 600; i += 1) sampleLines.push(cleanLogLine(rawLines[i]));
    for (let i = rawLines.length - 200; i < rawLines.length; i += 1) {
      sampleLines.push(cleanLogLine(rawLines[i]));
    }
  }
  let gitScore = 0;
  let testScore = 0;
  let buildScore = 0;
  let gitDiffHeaders = 0;
  let gitHunks = 0;
  let gitMetaHits = 0;
  let testPassHits = 0;
  let testStrongHits = 0;
  let buildNoiseHits = 0;
  let buildStrongHits = 0;
  for (const rawLine of sampleLines) {
    if (!rawLine) continue;
    const line = rawLine.length > 512 ? rawLine.slice(0, 512) : rawLine;
    if (/^diff --git\s+/.test(line)) {
      gitDiffHeaders += 1;
      gitScore += 6;
    } else if (/^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/.test(line)) {
      gitHunks += 1;
      if (gitHunks <= 4) gitScore += 4;
    } else if (/^commit\s+[0-9a-f]{7,40}\b/.test(line)) {
      gitMetaHits += 1;
      if (gitMetaHits <= 4) gitScore += 3;
    } else if (/^(?:index\s+[0-9a-f]{7,}\.\.[0-9a-f]{7,}|---\s+a\/|\+\+\+\s+b\/)/.test(line) || /^\s*(?:modified|new file|deleted|renamed):\s+\S/.test(line) || /\b\d+\s+files?\s+changed,\s+\d+\s+(?:insertions?|deletions?)/.test(line)) {
      gitMetaHits += 1;
      if (gitMetaHits <= 6) gitScore += 2;
    }
    if (/^\s*(?:---\s+(?:FAIL|PASS):|Tests:|Test Suites:|Test Files\b|TAP version \d+|ℹ\s+(?:pass|fail|tests)\b|test result:\s*(?:ok|FAILED))/.test(
      line
    ) || /\b(?:pytest|cargo test)\b/i.test(line)) {
      testStrongHits += 1;
      if (testStrongHits <= 6) testScore += 4;
    } else if (/^\s*(?:PASS|FAIL)\s+\S/.test(line) || /^\s*not ok\s+\d+/.test(line)) {
      testStrongHits += 1;
      if (testStrongHits <= 6) testScore += 3;
    } else if (TEST_PASS_LINE_RE.test(line) || /^\s*(?:✖|✗)\s+\S/.test(line)) {
      testPassHits += 1;
      if (testPassHits <= 6) testScore += 2;
    }
    if (/\berror\s+TS\d{4}\b|\bTS\d{4}:/.test(line) || /transforming\s*\(\d+\)|\b\d+\s+modules?\s+transformed\b|(?:✓|✔)?\s*built in\s+\d/.test(line) || /\b(?:vite|esbuild|webpack|eslint)\b/i.test(line)) {
      buildStrongHits += 1;
      if (buildStrongHits <= 6) buildScore += 4;
    } else if (/^\s*(?:Compiling|Checking|Finished|Bundling)\s+\S/.test(line) || /\bwarning:\s+\S/i.test(line) || BUILD_FILE_LOC_RE.test(line) && /\b(?:error|warning)\b/i.test(line)) {
      buildNoiseHits += 1;
      if (buildNoiseHits <= 6) buildScore += 2;
    }
  }
  if (gitDiffHeaders > 0) {
    return "git";
  }
  const best = Math.max(gitScore, testScore, buildScore);
  if (best < 3) return "generic";
  if (gitScore >= testScore && gitScore >= buildScore) return "git";
  if (testScore >= buildScore) return "test";
  return "build";
}
var TURBO_DEFAULT_MAX_COMPACT_LINES = 180;
var TURBO_MIN_COMPACT_LINES = 20;
var TURBO_MAX_COMPACT_LINES = 300;
var TURBO_MAX_COMPACT_BYTES = 48 * 1024;
function capCompactedLines(lines, maxLines = TURBO_DEFAULT_MAX_COMPACT_LINES, maxBytes = TURBO_MAX_COMPACT_BYTES) {
  const cap = Math.max(
    TURBO_MIN_COMPACT_LINES,
    Math.min(
      Math.floor(Number.isFinite(maxLines) ? maxLines : TURBO_DEFAULT_MAX_COMPACT_LINES),
      TURBO_MAX_COMPACT_LINES
    )
  );
  const byteLimit = Math.max(
    2048,
    Math.floor(Number.isFinite(maxBytes) ? maxBytes : TURBO_MAX_COMPACT_BYTES)
  );
  const clipLine = (l) => l.length > 240 ? l.slice(0, 240) : l;
  const calcBytes = (arr) => Buffer.byteLength(arr.join("\n"), "utf8");
  if (lines.length <= cap) {
    const bounded = lines.map(clipLine);
    if (calcBytes(bounded) <= byteLimit) {
      return bounded;
    }
  }
  const buildCapped = (budget2) => {
    const contentBudget = Math.max(2, budget2 - 1);
    const headKeep = Math.max(1, Math.floor(contentBudget * 0.6));
    const tailKeep = Math.max(1, contentBudget - headKeep);
    const omitted = lines.length - headKeep - tailKeep;
    if (omitted <= 0) {
      return lines.map(clipLine);
    }
    const marker = `... [truncated ${omitted} additional diagnostic lines; query full indexed log via chunkId]`;
    return [
      ...lines.slice(0, headKeep).map(clipLine),
      marker,
      ...lines.slice(lines.length - tailKeep).map(clipLine)
    ];
  };
  let budget = Math.min(cap, Math.max(3, lines.length - 1));
  let result = buildCapped(budget);
  while (calcBytes(result) > byteLimit && budget > 3) {
    const nextBudget = Math.max(3, Math.floor(budget * 0.75));
    if (nextBudget >= budget) break;
    budget = nextBudget;
    result = buildCapped(budget);
  }
  return result;
}
function compactTestOutputLines(cleanedLines, maxLines = TURBO_DEFAULT_MAX_COMPACT_LINES) {
  const out = [];
  let passingRun = [];
  let noiseRun = [];
  let inFailureBlock = false;
  let failureBlankStreak = 0;
  const flushPassing = () => {
    if (passingRun.length === 0) return;
    if (passingRun.length === 1) {
      out.push(passingRun[0].slice(0, 240));
    } else {
      out.push(`... [collapsed ${passingRun.length} passing test lines]`);
    }
    passingRun = [];
  };
  const flushNoise = () => {
    if (noiseRun.length === 0) return;
    if (noiseRun.length <= 2) {
      for (const l of noiseRun) out.push(l.slice(0, 240));
    } else {
      out.push(`... [collapsed ${noiseRun.length} verbose log lines]`);
    }
    noiseRun = [];
  };
  for (let i = 0; i < cleanedLines.length; i += 1) {
    const line = cleanedLines[i];
    const probe = line.length > 512 ? line.slice(0, 512) : line;
    const trimmed = probe.trim();
    if (TEST_SUMMARY_LINE_RE.test(probe)) {
      flushPassing();
      flushNoise();
      inFailureBlock = false;
      failureBlankStreak = 0;
      out.push(line.slice(0, 240));
      continue;
    }
    if (TEST_FAIL_START_RE.test(probe)) {
      flushPassing();
      flushNoise();
      inFailureBlock = true;
      failureBlankStreak = 0;
      out.push(line.slice(0, 240));
      continue;
    }
    if (inFailureBlock) {
      if (TEST_PASS_LINE_RE.test(probe)) {
        inFailureBlock = false;
        failureBlankStreak = 0;
        passingRun.push(line);
        continue;
      }
      if (!trimmed) {
        failureBlankStreak += 1;
        if (failureBlankStreak <= 2) {
          out.push("");
        } else {
          inFailureBlock = false;
        }
        continue;
      }
      if (TEST_VERBOSE_NOISE_RE.test(probe) && !ERROR_LINE_RE.test(probe)) {
        inFailureBlock = false;
        failureBlankStreak = 0;
        noiseRun.push(line);
        continue;
      }
      failureBlankStreak = 0;
      out.push(line.slice(0, 240));
      continue;
    }
    if (TEST_PASS_LINE_RE.test(probe)) {
      flushNoise();
      passingRun.push(line);
      continue;
    }
    if (!trimmed) {
      if (passingRun.length === 0 && noiseRun.length === 0 && out.length > 0 && out[out.length - 1] !== "") {
        out.push("");
      }
      continue;
    }
    if (ERROR_LINE_RE.test(probe) || WARN_LINE_RE.test(probe) || TEST_STACK_OR_DIFF_RE.test(probe)) {
      flushPassing();
      flushNoise();
      if (ERROR_LINE_RE.test(probe)) {
        inFailureBlock = true;
        failureBlankStreak = 0;
      }
      out.push(line.slice(0, 240));
      continue;
    }
    if (i < 3) {
      flushPassing();
      flushNoise();
      out.push(line.slice(0, 240));
      continue;
    }
    if (TEST_VERBOSE_NOISE_RE.test(probe)) {
      flushPassing();
      noiseRun.push(line);
      continue;
    }
    if (passingRun.length > 0) {
      flushPassing();
    }
    noiseRun.push(line);
  }
  flushPassing();
  flushNoise();
  return capCompactedLines(out, maxLines);
}
function compactBuildOutputLines(cleanedLines, maxLines = TURBO_DEFAULT_MAX_COMPACT_LINES) {
  const out = [];
  let noiseRun = [];
  let diagFollowRemaining = 0;
  const flushNoise = () => {
    if (noiseRun.length === 0) return;
    if (noiseRun.length === 1) {
      out.push(noiseRun[0].slice(0, 240));
    } else {
      out.push(`... [collapsed ${noiseRun.length} build progress lines]`);
    }
    noiseRun = [];
  };
  for (let i = 0; i < cleanedLines.length; i += 1) {
    const line = cleanedLines[i];
    const probe = line.length > 512 ? line.slice(0, 512) : line;
    const trimmed = probe.trim();
    const isErrorOrWarn = ERROR_LINE_RE.test(probe) || WARN_LINE_RE.test(probe) || /^\s*\d+:\d+\s+(?:error|warning)\b/i.test(probe) || BUILD_FILE_LOC_RE.test(probe) && !BUILD_NOISE_LINE_RE.test(probe);
    if (isErrorOrWarn) {
      flushNoise();
      out.push(line.slice(0, 240));
      diagFollowRemaining = 3;
      continue;
    }
    if (diagFollowRemaining > 0) {
      if (trimmed && (BUILD_DIAG_CONTEXT_RE.test(probe) || /^\s{2,}\S/.test(probe)) && !BUILD_NOISE_LINE_RE.test(probe)) {
        flushNoise();
        out.push(line.slice(0, 240));
        diagFollowRemaining -= 1;
        continue;
      }
      diagFollowRemaining = 0;
    }
    if (BUILD_SUMMARY_LINE_RE.test(probe)) {
      flushNoise();
      out.push(line.slice(0, 240));
      continue;
    }
    if (BUILD_NOISE_LINE_RE.test(probe)) {
      noiseRun.push(line);
      continue;
    }
    if (!trimmed) {
      if (noiseRun.length === 0 && out.length > 0 && out[out.length - 1] !== "") {
        out.push("");
      }
      continue;
    }
    if (i < 2 || i >= cleanedLines.length - 3) {
      flushNoise();
      out.push(line.slice(0, 240));
      continue;
    }
    noiseRun.push(line);
  }
  flushNoise();
  return capCompactedLines(out, maxLines);
}
function extractGitDiffPath(diffHeaderLine) {
  const m = /^diff --git\s+"?a\/(.+?)"?\s+"?b\/(.+?)"?\s*$/.exec(diffHeaderLine);
  if (m) return m[2];
  return diffHeaderLine;
}
function compactGitOutputLines(cleanedLines, maxLines = TURBO_DEFAULT_MAX_COMPACT_LINES) {
  const hasDiff = cleanedLines.some((l) => l.startsWith("diff --git "));
  if (!hasDiff) {
    const out2 = [];
    let listRun = [];
    const flushList = () => {
      if (listRun.length === 0) return;
      if (listRun.length <= 20) {
        for (const l of listRun) out2.push(l.slice(0, 240));
      } else {
        for (const l of listRun.slice(0, 12)) out2.push(l.slice(0, 240));
        out2.push(`... [collapsed ${listRun.length - 16} git file status lines]`);
        for (const l of listRun.slice(-4)) out2.push(l.slice(0, 240));
      }
      listRun = [];
    };
    for (const line of cleanedLines) {
      if (/^\s*(?:modified|new file|deleted|renamed|untracked):\s+/.test(line) || /^\t\S/.test(line)) {
        listRun.push(line);
      } else {
        flushList();
        out2.push(line.slice(0, 240));
      }
    }
    flushList();
    return capCompactedLines(out2, maxLines);
  }
  const out = [];
  const preamble = [];
  const blocks = [];
  let current = null;
  let inBody = false;
  for (const line of cleanedLines) {
    if (line.startsWith("diff --git ")) {
      current = {
        headerLine: line,
        filePath: extractGitDiffPath(line),
        metaLines: [],
        bodyLines: []
      };
      blocks.push(current);
      inBody = false;
      continue;
    }
    if (!current) {
      preamble.push(line);
      continue;
    }
    if (!inBody && (line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("new file mode") || line.startsWith("deleted file mode") || line.startsWith("old mode") || line.startsWith("new mode") || line.startsWith("similarity index") || line.startsWith("rename from") || line.startsWith("rename to") || line.startsWith("Binary files"))) {
      current.metaLines.push(line);
    } else {
      inBody = true;
      current.bodyLines.push(line);
    }
  }
  for (const line of preamble.slice(0, 25)) {
    out.push(line.slice(0, 240));
  }
  if (preamble.length > 25) {
    out.push(`... [collapsed ${preamble.length - 25} git preamble lines]`);
  }
  for (let bIdx = 0; bIdx < blocks.length; bIdx += 1) {
    const block = blocks[bIdx];
    out.push(block.headerLine.slice(0, 240));
    for (const m of block.metaLines) {
      out.push(m.slice(0, 240));
    }
    if (block.bodyLines.length === 0) continue;
    let added = 0;
    let removed = 0;
    for (const l of block.bodyLines) {
      if (l.startsWith("+") && !l.startsWith("+++")) added += 1;
      else if (l.startsWith("-") && !l.startsWith("---")) removed += 1;
    }
    const isLockOrGenerated = LOCK_OR_GENERATED_PATH_RE.test(block.filePath);
    if (isLockOrGenerated || block.bodyLines.length > 200 || bIdx >= 35) {
      const kindLabel = isLockOrGenerated ? "lockfile/generated diff" : "large file diff";
      out.push(`... [collapsed ${kindLabel}: ${block.bodyLines.length} lines (+${added} / -${removed})]`);
      continue;
    }
    const hunks = [];
    let currentHunk = [];
    for (const l of block.bodyLines) {
      if (l.startsWith("@@ ")) {
        if (currentHunk.length > 0) hunks.push(currentHunk);
        currentHunk = [l];
      } else {
        currentHunk.push(l);
      }
    }
    if (currentHunk.length > 0) hunks.push(currentHunk);
    for (const hunk of hunks) {
      if (hunk.length <= 36) {
        for (const l of hunk) out.push(l.slice(0, 240));
      } else {
        const keepHead = 12;
        const keepTail = 6;
        const middle = hunk.slice(keepHead, hunk.length - keepTail);
        let midAdd = 0;
        let midDel = 0;
        for (const ml of middle) {
          if (ml.startsWith("+")) midAdd += 1;
          else if (ml.startsWith("-")) midDel += 1;
        }
        for (const l of hunk.slice(0, keepHead)) out.push(l.slice(0, 240));
        out.push(`... [collapsed ${middle.length} hunk lines (+${midAdd} / -${midDel})]`);
        for (const l of hunk.slice(-keepTail)) out.push(l.slice(0, 240));
      }
    }
  }
  return capCompactedLines(out, maxLines);
}
var CompactedChunkStore = class {
  entries = /* @__PURE__ */ new Map();
  maxEntries;
  totalCompactions = 0;
  totalSavedTokens = 0;
  totalRawBytes = 0;
  constructor(maxEntries = TURBO_MAX_COMPACTED_CHUNKS) {
    this.maxEntries = Math.max(1, maxEntries);
  }
  compact(dataDir, label, rawText, opts = {}) {
    const safeLabel = (label || "output").replace(/[\r\n\t\x00-\x1f]/g, " ").trim().slice(0, 80) || "output";
    const raw = typeof rawText === "string" ? rawText : String(rawText ?? "");
    const rawLines = raw.split(/\r?\n/);
    const lines = rawLines.map(cleanLogLine);
    const totalLines = lines.length;
    const linesBefore = totalLines;
    const rawBytes = Buffer.byteLength(raw, "utf8");
    const estimatedRawTokens = Math.ceil(raw.length / 4);
    const headCount = Math.max(1, Math.min(opts.headLines ?? 12, 50));
    const tailCount = Math.max(1, Math.min(opts.tailLines ?? 15, 50));
    const maxErrorLines = Math.max(1, Math.min(opts.maxErrorLines ?? 20, 60));
    const maxCompactedLines = typeof opts.maxErrorLines === "number" && Number.isFinite(opts.maxErrorLines) ? Math.max(
      TURBO_MIN_COMPACT_LINES,
      Math.min(Math.floor(opts.maxErrorLines), TURBO_MAX_COMPACT_LINES)
    ) : TURBO_DEFAULT_MAX_COMPACT_LINES;
    const chunkLines = Math.max(10, Math.min(opts.chunkLines ?? 40, 200));
    const requestedPreset = opts.preset ?? "auto";
    const detectedPreset = requestedPreset === "auto" ? detectOutputPreset(raw) : requestedPreset;
    const diagMap = /* @__PURE__ */ new Map();
    let errorCount = 0;
    let warningCount = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i].trim();
      if (!text) continue;
      let severity = null;
      if (ERROR_LINE_RE.test(text)) {
        severity = "error";
        errorCount += 1;
      } else if (WARN_LINE_RE.test(text)) {
        severity = "warning";
        warningCount += 1;
      }
      if (!severity) continue;
      const key = `${severity}:${normalizeDiagKey(text)}`;
      const existing = diagMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        diagMap.set(key, {
          line: i + 1,
          severity,
          count: 1,
          text: text.slice(0, 180)
        });
      }
    }
    const diagnostics = Array.from(diagMap.values()).sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
      if (b.count !== a.count) return b.count - a.count;
      return a.line - b.line;
    }).slice(0, maxErrorLines);
    const bodySections = [];
    if (detectedPreset === "test") {
      bodySections.push(...compactTestOutputLines(lines, maxCompactedLines));
    } else if (detectedPreset === "build") {
      bodySections.push(...compactBuildOutputLines(lines, maxCompactedLines));
    } else if (detectedPreset === "git") {
      bodySections.push(...compactGitOutputLines(lines, maxCompactedLines));
    } else {
      const headSlice = lines.slice(0, Math.min(headCount, totalLines));
      const tailStart = Math.max(headSlice.length, totalLines - tailCount);
      const tailSlice = tailStart < totalLines ? lines.slice(tailStart) : [];
      const omittedMid = Math.max(0, tailStart - headSlice.length);
      if (diagnostics.length > 0) {
        bodySections.push("--- Errors & Warnings (aggregated) ---");
        for (const d of diagnostics) {
          const repeat = d.count > 1 ? ` (x${d.count})` : "";
          bodySections.push(`[${d.severity.toUpperCase()} L${d.line}]${repeat} ${d.text}`);
        }
      }
      bodySections.push(`--- Head (L1-L${headSlice.length}) ---`);
      bodySections.push(
        headSlice.map((l, idx) => `${idx + 1} | ${l.slice(0, 220)}`).join("\n")
      );
      if (omittedMid > 0) {
        bodySections.push(`... (${omittedMid} middle lines indexed in memory; query via chunkId) ...`);
      }
      if (tailSlice.length > 0) {
        bodySections.push(`--- Tail (L${tailStart + 1}-L${totalLines}) ---`);
        bodySections.push(
          tailSlice.map((l, idx) => `${tailStart + idx + 1} | ${l.slice(0, 220)}`).join("\n")
        );
      }
    }
    const buildSummary = (pct) => {
      const header = `[Turbo Compact] ${safeLabel} [preset=${detectedPreset}, saved ${pct}%] \u2014 ${totalLines} lines, ${rawBytes} bytes (~${estimatedRawTokens} tokens), errors=${errorCount}, warnings=${warningCount}`;
      return [header, ...bodySections].join("\n");
    };
    const draftText = buildSummary(0);
    const draftBytes = Buffer.byteLength(draftText, "utf8");
    const draftRatio = rawBytes > 0 ? Number((1 - Math.min(draftBytes, rawBytes) / rawBytes).toFixed(3)) : 0;
    const draftSavedPct = Math.max(0, Math.min(100, Math.round(draftRatio * 100)));
    let summaryText = buildSummary(draftSavedPct);
    let summaryBytes = Buffer.byteLength(summaryText, "utf8");
    let compressionRatio = rawBytes > 0 ? Number((1 - Math.min(summaryBytes, rawBytes) / rawBytes).toFixed(3)) : 0;
    let savedPercent = Math.max(0, Math.min(100, Math.round(compressionRatio * 100)));
    if (savedPercent !== draftSavedPct) {
      summaryText = buildSummary(savedPercent);
      summaryBytes = Buffer.byteLength(summaryText, "utf8");
      compressionRatio = rawBytes > 0 ? Number((1 - Math.min(summaryBytes, rawBytes) / rawBytes).toFixed(3)) : 0;
      savedPercent = Math.max(0, Math.min(100, Math.round(compressionRatio * 100)));
    }
    const linesAfter = summaryText.split(/\r?\n/).length;
    const estimatedSummaryTokens = Math.ceil(summaryText.length / 4);
    const estimatedSavedTokens = Math.max(0, estimatedRawTokens - estimatedSummaryTokens);
    const chunkCount = Math.max(1, Math.ceil(totalLines / chunkLines));
    const chunkId = `chk_${Date.now().toString(36)}_${import_node_crypto8.default.randomBytes(3).toString("hex")}`;
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    const meta = {
      chunkId,
      label: safeLabel,
      createdAt,
      totalLines,
      rawBytes,
      estimatedRawTokens,
      estimatedSummaryTokens,
      estimatedSavedTokens,
      chunkCount,
      errorCount,
      warningCount,
      detectedPreset,
      savedPercent
    };
    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== void 0) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(chunkId, { meta, lines, chunkLines, summaryText });
    this.totalCompactions += 1;
    this.totalSavedTokens += estimatedSavedTokens;
    this.totalRawBytes += rawBytes;
    if (opts.persistStats && dataDir) {
      try {
        atomicWriteJson(import_node_path13.default.join(dataDir, "stats.json"), {
          schemaVersion: 1,
          totalCompactions: this.totalCompactions,
          totalSavedTokens: this.totalSavedTokens,
          totalRawBytes: this.totalRawBytes,
          updatedAt: createdAt
        });
      } catch {
      }
    }
    return {
      ...meta,
      summaryBytes,
      compressionRatio,
      diagnostics,
      summaryText,
      detectedPreset,
      linesBefore,
      linesAfter,
      savedPercent
    };
  }
  query(chunkId, query, limit = 10) {
    const cleanQuery = (query || "").trim();
    const entry = this.entries.get(chunkId);
    if (!entry) {
      return {
        found: false,
        chunkId,
        query: cleanQuery,
        totalHits: 0,
        matches: []
      };
    }
    this.entries.delete(chunkId);
    this.entries.set(chunkId, entry);
    const maxHits = Math.max(1, Math.min(limit, 50));
    const tokens = cleanQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = [];
    let totalHits = 0;
    for (let i = 0; i < entry.lines.length; i += 1) {
      const lower = entry.lines[i].toLowerCase();
      const matched = tokens.length === 0 ? true : tokens.every((tok) => lower.includes(tok));
      if (!matched) continue;
      totalHits += 1;
      if (matches.length < maxHits) {
        const ctxStart = Math.max(0, i - 1);
        const ctxEnd = Math.min(entry.lines.length - 1, i + 1);
        const snippet = entry.lines.slice(ctxStart, ctxEnd + 1).map((l, offset) => `${ctxStart + offset + 1} | ${l.slice(0, 220)}`).join("\n");
        matches.push({
          chunkIndex: Math.floor(i / entry.chunkLines),
          startLine: ctxStart + 1,
          endLine: ctxEnd + 1,
          matchedLine: i + 1,
          snippet
        });
      }
    }
    return {
      found: true,
      chunkId,
      label: entry.meta.label,
      totalLines: entry.meta.totalLines,
      query: cleanQuery,
      totalHits,
      matches
    };
  }
  listChunks() {
    return Array.from(this.entries.values()).map((e) => ({ ...e.meta })).reverse();
  }
  getStats() {
    return {
      indexedChunks: this.entries.size,
      maxChunks: this.maxEntries,
      totalCompactions: this.totalCompactions,
      totalSavedTokens: this.totalSavedTokens,
      totalRawBytes: this.totalRawBytes
    };
  }
  clear() {
    this.entries.clear();
  }
};
var defaultCompactedChunkStore = new CompactedChunkStore(TURBO_MAX_COMPACTED_CHUNKS);
var SNAPSHOT_EXPAND_DIRS = /* @__PURE__ */ new Set(["src", "app", "apps", "packages", "lib", "ui", "test", "tests", "scripts", "cmd", "pkg", "internal"]);
function buildWorkspaceSnapshot(workspaceRoot) {
  const startedAt = Date.now();
  const realRoot = import_node_fs12.default.realpathSync(import_node_path13.default.resolve(workspaceRoot));
  const rootPrefix = realRoot.endsWith(import_node_path13.default.sep) ? realRoot : `${realRoot}${import_node_path13.default.sep}`;
  const workspaceName = import_node_path13.default.basename(realRoot) || "workspace";
  const techStack = [];
  const scripts = [];
  let packageName;
  let packageVersion;
  const hasFile = (name) => {
    try {
      const candidate = import_node_path13.default.join(realRoot, name);
      const real = import_node_fs12.default.realpathSync(candidate);
      return real.startsWith(rootPrefix) && import_node_fs12.default.statSync(real).isFile();
    } catch {
      return false;
    }
  };
  if (hasFile("package.json")) {
    techStack.push("Node.js");
    try {
      const pkg = JSON.parse(import_node_fs12.default.readFileSync(import_node_path13.default.join(realRoot, "package.json"), "utf8"));
      if (typeof pkg.name === "string") packageName = pkg.name.slice(0, 64);
      if (typeof pkg.version === "string") packageVersion = pkg.version.slice(0, 32);
      if (pkg.scripts && typeof pkg.scripts === "object") {
        scripts.push(...Object.keys(pkg.scripts).slice(0, 8));
      }
      const allDeps = { ...pkg.dependencies ?? {}, ...pkg.devDependencies ?? {} };
      if ("typescript" in allDeps) techStack.push("TypeScript");
      if ("react" in allDeps) techStack.push("React");
      if ("vite" in allDeps) techStack.push("Vite");
      if ("next" in allDeps) techStack.push("Next.js");
      if ("vue" in allDeps) techStack.push("Vue");
    } catch {
    }
  }
  if (hasFile("tsconfig.json") && !techStack.includes("TypeScript")) techStack.push("TypeScript");
  if (hasFile("pyproject.toml") || hasFile("requirements.txt")) techStack.push("Python");
  if (hasFile("go.mod")) techStack.push("Go");
  if (hasFile("Cargo.toml")) techStack.push("Rust");
  if (hasFile("Dockerfile") || hasFile("docker-compose.yml") || hasFile("compose.yaml")) {
    techStack.push("Docker");
  }
  if (hasFile("AGENTS.md")) techStack.push("AGENTS.md");
  if (hasFile("CLAUDE.md")) techStack.push("CLAUDE.md");
  const treeLines = [];
  const maxTreeLines = 28;
  let extraEntries = 0;
  try {
    const entries = import_node_fs12.default.readdirSync(realRoot, { withFileTypes: true }).sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || isSensitiveTurboPath(entry.name)) continue;
      if (entry.isSymbolicLink()) {
        try {
          const realEntry = import_node_fs12.default.realpathSync(import_node_path13.default.join(realRoot, entry.name));
          const realEntryRel = import_node_path13.default.relative(realRoot, realEntry).replace(/\\/g, "/");
          if (!realEntry.startsWith(rootPrefix) || isSensitiveTurboPath(realEntryRel)) continue;
        } catch {
          continue;
        }
      }
      if (treeLines.length >= maxTreeLines) {
        extraEntries += 1;
        continue;
      }
      if (entry.isDirectory()) {
        treeLines.push(`- ${entry.name}/`);
        if (SNAPSHOT_EXPAND_DIRS.has(entry.name) && treeLines.length < maxTreeLines) {
          try {
            const subEntries = import_node_fs12.default.readdirSync(import_node_path13.default.join(realRoot, entry.name), { withFileTypes: true }).filter((sub) => {
              if (SKIP_DIRS.has(sub.name) || isSensitiveTurboPath(`${entry.name}/${sub.name}`)) {
                return false;
              }
              if (sub.isSymbolicLink()) {
                try {
                  const realSub = import_node_fs12.default.realpathSync(import_node_path13.default.join(realRoot, entry.name, sub.name));
                  const realSubRel = import_node_path13.default.relative(realRoot, realSub).replace(/\\/g, "/");
                  return realSub.startsWith(rootPrefix) && !isSensitiveTurboPath(realSubRel);
                } catch {
                  return false;
                }
              }
              return true;
            }).sort((a, b) => a.name.localeCompare(b.name));
            const shown = subEntries.slice(0, 5);
            for (const sub of shown) {
              if (treeLines.length >= maxTreeLines) break;
              treeLines.push(`  - ${sub.name}${sub.isDirectory() ? "/" : ""}`);
            }
            if (subEntries.length > shown.length && treeLines.length < maxTreeLines) {
              treeLines.push(`  - ... (+${subEntries.length - shown.length} more)`);
            }
          } catch {
          }
        }
      } else {
        treeLines.push(`- ${entry.name}`);
      }
    }
  } catch {
  }
  if (extraEntries > 0) {
    treeLines.push(`- ... (+${extraEntries} more entries)`);
  }
  const lines = [
    `Workspace: ${packageName ? `${packageName}${packageVersion ? `@${packageVersion}` : ""}` : workspaceName}`,
    `Stack: ${techStack.length > 0 ? techStack.join(", ") : "Generic"}`
  ];
  if (scripts.length > 0) {
    lines.push(`Scripts: ${scripts.join(", ")}`);
  }
  lines.push("Structure:");
  lines.push(...treeLines);
  const finalLines = lines.slice(0, 40);
  if (lines.length > 40) {
    finalLines[39] = "... (truncated to 40-line budget)";
  }
  return {
    workspaceName,
    packageName,
    packageVersion,
    techStack,
    scripts,
    treeLines,
    lineCount: finalLines.length,
    markdown: finalLines.join("\n"),
    elapsedMs: Date.now() - startedAt
  };
}

// src/modules/turbo/auto-rtk.ts
var PREFS_FILENAME = "prefs.json";
var HOTSPOTS_FILENAME = "hotspots.json";
var MAX_PREFS_BYTES = 64 * 1024;
var MAX_HOTSPOTS_BYTES = 256 * 1024;
var MAX_HOTSPOTS_ITEMS = 20;
var MAX_RAW_LOG_BYTES = 128 * 1024;
var MAX_COMMAND_LENGTH = 512;
var MAX_COMMAND_ARGS = 24;
var MAX_PAYLOAD_B64_LENGTH = 4096;
var COMPACT_RUN_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
var SHELL_META_HARD_DENY_RE = /[;&|`$><\r\n()\\\x00-\x1f\x7f]/;
var UNQUOTED_SHELL_SYNTAX_RE = /[*?[\]{}#]/;
var SAFE_EXECUTABLE_RE = /^[a-z][a-z0-9-]*$/;
var SAFE_SHELL_PATH_RE = /^[A-Za-z0-9._/@:+ -]+$/;
var SAFE_B64URL_RE = /^[A-Za-z0-9_-]+$/;
var ENV_ASSIGN_TOKEN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
var FORBIDDEN_SHELL_EXECUTABLES = /* @__PURE__ */ new Set([
  "eval",
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "cmd",
  "powershell",
  "pwsh",
  "env",
  "exec",
  "source",
  "node",
  "agy-nov"
]);
var GIT_ALLOWED_SUBCOMMANDS = /* @__PURE__ */ new Set(["status", "diff", "log", "branch", "show"]);
var GIT_DANGEROUS_SHORT_FLAGS = /* @__PURE__ */ new Set(["-c", "-C", "-o", "-O"]);
var GIT_DANGEROUS_LONG_FLAG_PREFIXES = [
  "--config",
  "--config-env",
  "--upload-pack",
  "--receive-pack",
  "--exec",
  "--exec-path",
  "--ext-diff",
  "--external-diff",
  "--textconv",
  "--no-index",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--output",
  "--paginate",
  "--pager",
  "--difftool",
  "--alias"
];
var GIT_BRANCH_REQUIRED_VALUE_FLAGS = /* @__PURE__ */ new Set([
  "--contains",
  "--no-contains",
  "--format",
  "--sort",
  "--points-at"
]);
var GIT_BRANCH_OPTIONAL_VALUE_FLAGS = /* @__PURE__ */ new Set([
  "--merged",
  "--no-merged",
  "--color",
  "--abbrev"
]);
var GIT_BRANCH_READONLY_BOOL_FLAGS = /* @__PURE__ */ new Set([
  "-a",
  "--all",
  "-r",
  "--remotes",
  "-v",
  "-vv",
  "--verbose",
  "-l",
  "--list",
  "--show-current",
  "--no-color",
  "--no-abbrev",
  "-q",
  "--quiet",
  "--column",
  "--no-column",
  "-i",
  "--ignore-case"
]);
var NPM_ALLOWED_RUN_SCRIPTS = /* @__PURE__ */ new Set(["test", "build", "typecheck", "lint"]);
var NPM_DANGEROUS_FLAGS = /* @__PURE__ */ new Set([
  "--script-shell",
  "--prefix",
  "--userconfig",
  "--globalconfig",
  "--cache",
  "--registry",
  "--eval",
  "-e",
  "-C",
  "--cwd",
  "--before",
  "--shell"
]);
var PNPM_YARN_ALLOWED_SCRIPTS = /* @__PURE__ */ new Set(["test", "build", "typecheck", "lint"]);
var PNPM_YARN_DANGEROUS_FLAGS = /* @__PURE__ */ new Set([
  "--config",
  "--dir",
  "-C",
  "--prefix",
  "--cwd",
  "--script-shell",
  "--registry",
  "--global",
  "-g",
  "--shell"
]);
var NPX_DANGEROUS_FLAGS = /* @__PURE__ */ new Set([
  "-c",
  "--call",
  "--package",
  "-p",
  "--shell",
  "-y",
  "--yes"
]);
var TSC_DANGEROUS_FLAGS = /* @__PURE__ */ new Set([
  "-b",
  "--build",
  "-p",
  "--project",
  "--outDir",
  "--outFile",
  "--declaration",
  "--declarationDir",
  "--emitDeclarationOnly",
  "--tsBuildInfoFile",
  "--generateTrace",
  "--listEmittedFiles",
  "-w",
  "--watch",
  "--init"
]);
var VITEST_DANGEROUS_FLAGS = /* @__PURE__ */ new Set([
  "-w",
  "--watch",
  "--ui",
  "-c",
  "--config",
  "--configLoader",
  "--config-loader",
  "-r",
  "--root",
  "--dir",
  "--outputFile",
  "--output-file",
  "--reporter",
  "--reporters",
  "--setupFiles",
  "--setup-files",
  "--globalSetup",
  "--global-setup",
  "--execArgv",
  "--exec-argv",
  "--environment",
  "--browser",
  "-u",
  "--update"
]);
var JEST_DANGEROUS_FLAGS = /* @__PURE__ */ new Set([
  "-w",
  "--watch",
  "--watchAll",
  "--watch-all",
  "-u",
  "--updateSnapshot",
  "--update-snapshot",
  "-c",
  "--config",
  "--outputFile",
  "--output-file",
  "--reporters",
  "--setupFiles",
  "--setup-files",
  "--setupFilesAfterEnv",
  "--setup-files-after-env",
  "--runner",
  "--testRunner",
  "--test-runner",
  "--testEnvironment",
  "--test-environment",
  "--resolver",
  "--transform",
  "--preset",
  "--rootDir",
  "--root-dir",
  "--roots",
  "--projects",
  "--watchPlugins",
  "--watch-plugins",
  "--globalSetup",
  "--global-setup",
  "--globalTeardown",
  "--global-teardown"
]);
var ESLINT_DANGEROUS_FLAGS = /* @__PURE__ */ new Set([
  "--fix",
  "--fix-dry-run",
  "--fix-type",
  "-o",
  "--output-file",
  "-c",
  "--config",
  "-f",
  "--format",
  "--parser",
  "--plugin",
  "--rulesdir",
  "--resolve-plugins-relative-to",
  "--cache",
  "--cache-location",
  "--cache-file"
]);
var PYTEST_DANGEROUS_FLAGS = /* @__PURE__ */ new Set([
  "-c",
  "--confcutdir",
  "--rootdir",
  "-o",
  "--override-ini",
  "-p",
  "--basetemp",
  "--junitxml",
  "--junit-xml",
  "--log-file",
  "--resultlog",
  "--result-log",
  "--cache-clear",
  "--import-mode"
]);
var CARGO_ALLOWED_SUBCOMMANDS = /* @__PURE__ */ new Set(["test", "check", "build"]);
var CARGO_DANGEROUS_FLAGS = /* @__PURE__ */ new Set([
  "--config",
  "-Z",
  "--target-dir",
  "--manifest-path",
  "--out-dir"
]);
var GO_ALLOWED_SUBCOMMANDS = /* @__PURE__ */ new Set(["test", "vet"]);
var GO_DANGEROUS_FLAGS = /* @__PURE__ */ new Set([
  "-exec",
  "-toolexec",
  "-vettool",
  "-ldflags",
  "-gcflags",
  "-gccgoflags",
  "-asmflags",
  "-pkgdir",
  "-outputdir",
  "-o",
  "-c",
  "-C",
  "-cpuprofile",
  "-memprofile",
  "-coverprofile",
  "-blockprofile",
  "-mutexprofile",
  "-trace",
  "-modfile",
  "-overlay",
  "-test.cpuprofile",
  "-test.memprofile",
  "-test.coverprofile",
  "-test.blockprofile",
  "-test.mutexprofile",
  "-test.trace",
  "-test.outputdir"
]);
var PASSTHROUGH_ALL_DANGEROUS_FLAGS = /* @__PURE__ */ new Set([
  ...NPM_DANGEROUS_FLAGS,
  ...PNPM_YARN_DANGEROUS_FLAGS,
  ...TSC_DANGEROUS_FLAGS,
  ...VITEST_DANGEROUS_FLAGS,
  ...JEST_DANGEROUS_FLAGS,
  ...ESLINT_DANGEROUS_FLAGS,
  ...PYTEST_DANGEROUS_FLAGS,
  ...CARGO_DANGEROUS_FLAGS,
  ...GO_DANGEROUS_FLAGS,
  ...[...GO_DANGEROUS_FLAGS].map((flag) => flag.startsWith("-") && !flag.startsWith("--") ? `-${flag}` : flag),
  "--exec",
  "-e",
  "--eval",
  "-r",
  "--require",
  "--import",
  "--loader"
]);
var ESTIMATED_WASTE_BY_PRESET = {
  test: 2400,
  build: 1800,
  git: 1200
};
function isPlatformSystemRootSymlink2(segmentPath) {
  return process.platform === "darwin" && /^\/(?:var|tmp|etc)$/.test(segmentPath);
}
function hasUnsafeSymlinkAncestor2(targetPath) {
  let cur = import_node_path14.default.resolve(targetPath);
  const root = import_node_path14.default.parse(cur).root;
  while (true) {
    if (!isPlatformSystemRootSymlink2(cur)) {
      try {
        const st = import_node_fs13.default.lstatSync(cur);
        if (st.isSymbolicLink()) return true;
      } catch (err) {
        const code = err?.code;
        if (code !== "ENOENT") return true;
      }
    }
    if (cur === root) return false;
    const parent = import_node_path14.default.dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
}
function isWithinRealBase2(childReal, baseReal) {
  if (childReal === baseReal) return true;
  const prefix = baseReal.endsWith(import_node_path14.default.sep) ? baseReal : `${baseReal}${import_node_path14.default.sep}`;
  return childReal.startsWith(prefix);
}
function resolveSafeExistingDir(dirPath) {
  if (!dirPath || typeof dirPath !== "string" || dirPath.includes("\0")) return null;
  const resolved = import_node_path14.default.resolve(dirPath);
  if (hasUnsafeSymlinkAncestor2(resolved)) return null;
  try {
    const st = import_node_fs13.default.lstatSync(resolved);
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
    return import_node_fs13.default.realpathSync(resolved);
  } catch {
    return null;
  }
}
function ensureSafePrivateDir(dirPath) {
  if (!dirPath || typeof dirPath !== "string" || dirPath.includes("\0")) {
    throw new Error("Invalid directory path");
  }
  const resolved = import_node_path14.default.resolve(dirPath);
  if (hasUnsafeSymlinkAncestor2(resolved)) {
    throw new Error(`Refused symlink directory path: ${dirPath}`);
  }
  import_node_fs13.default.mkdirSync(resolved, { recursive: true, mode: 448 });
  const st = import_node_fs13.default.lstatSync(resolved);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`Refused unsafe target directory: ${dirPath}`);
  }
  try {
    import_node_fs13.default.chmodSync(resolved, 448);
  } catch {
  }
  return import_node_fs13.default.realpathSync(resolved);
}
function readSafeJsonFile(dirPath, fileName, maxBytes) {
  const realDir = resolveSafeExistingDir(dirPath);
  if (!realDir) return null;
  const filePath = import_node_path14.default.join(realDir, fileName);
  try {
    const st = import_node_fs13.default.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile() || st.size > maxBytes) {
      return null;
    }
    const realFile = import_node_fs13.default.realpathSync(filePath);
    if (!isWithinRealBase2(realFile, realDir)) {
      return null;
    }
    return JSON.parse(import_node_fs13.default.readFileSync(realFile, "utf8"));
  } catch {
    return null;
  }
}
function atomicWritePrivateFile(dirPath, fileName, content) {
  const realDir = ensureSafePrivateDir(dirPath);
  const targetPath = import_node_path14.default.join(realDir, fileName);
  try {
    const existing = import_node_fs13.default.lstatSync(targetPath);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error(`Refused to overwrite symlink or non-regular file: ${fileName}`);
    }
  } catch (err) {
    if (err?.code !== "ENOENT") {
      throw err;
    }
  }
  const nonce = import_node_crypto9.default.randomBytes(4).toString("hex");
  const tmpPath = import_node_path14.default.join(realDir, `.${fileName}.tmp.${process.pid}.${Date.now()}.${nonce}`);
  try {
    import_node_fs13.default.writeFileSync(tmpPath, content, { encoding: "utf8", mode: 384, flag: "wx" });
    try {
      import_node_fs13.default.chmodSync(tmpPath, 384);
    } catch {
    }
    import_node_fs13.default.renameSync(tmpPath, targetPath);
    return targetPath;
  } catch (err) {
    try {
      import_node_fs13.default.unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
}
function createDefaultTurboPrefs() {
  return {
    schemaVersion: 1,
    autoRtk: false,
    updatedAt: ""
  };
}
function loadTurboPrefsReadOnly(moduleDataDir) {
  const raw = readSafeJsonFile(moduleDataDir, PREFS_FILENAME, MAX_PREFS_BYTES);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return createDefaultTurboPrefs();
  }
  const obj = raw;
  return {
    schemaVersion: 1,
    autoRtk: obj.autoRtk === true,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : ""
  };
}
function normalizeHotspotRecord(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw;
  const commandPrefix = typeof obj.commandPrefix === "string" ? obj.commandPrefix.trim().slice(0, 64) : "";
  if (!commandPrefix) return null;
  const countNum = Number(obj.count);
  const count = Number.isFinite(countNum) && countNum > 0 ? Math.floor(countNum) : 0;
  if (count <= 0) return null;
  const wasteNum = Number(obj.estimatedWasteTokens);
  const estimatedWasteTokens = Number.isFinite(wasteNum) && wasteNum >= 0 ? Math.floor(wasteNum) : 0;
  const lastCommand = typeof obj.lastCommand === "string" ? redactFeedText(obj.lastCommand, 100) : commandPrefix;
  const lastSeenAt = typeof obj.lastSeenAt === "string" ? obj.lastSeenAt : "";
  return {
    commandPrefix,
    count,
    lastCommand,
    estimatedWasteTokens,
    lastSeenAt
  };
}
function sortHotspots(items) {
  return [...items].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  }).slice(0, MAX_HOTSPOTS_ITEMS);
}
function loadTurboHotspotsReadOnly(moduleDataDir) {
  const raw = readSafeJsonFile(moduleDataDir, HOTSPOTS_FILENAME, MAX_HOTSPOTS_BYTES);
  if (!raw) return [];
  const rawList = Array.isArray(raw) ? raw : typeof raw === "object" && Array.isArray(raw.items) ? raw.items : [];
  const normalized = [];
  for (const item of rawList) {
    const rec = normalizeHotspotRecord(item);
    if (rec) normalized.push(rec);
  }
  return sortHotspots(normalized);
}
function tokenizeSimpleSingleCommand(commandLine) {
  if (typeof commandLine !== "string") {
    return { ok: false, reason: "non-string command" };
  }
  const trimmed = commandLine.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty command" };
  }
  if (trimmed.length > MAX_COMMAND_LENGTH) {
    return { ok: false, reason: "command exceeds max length" };
  }
  if (SHELL_META_HARD_DENY_RE.test(trimmed)) {
    return { ok: false, reason: "disallowed shell metacharacter" };
  }
  const tokens = [];
  let current = "";
  let inToken = false;
  let quote = null;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === " ") {
      if (inToken) {
        if (!current) return { ok: false, reason: "empty quoted token" };
        tokens.push(current);
        current = "";
        inToken = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
      continue;
    }
    if (UNQUOTED_SHELL_SYNTAX_RE.test(ch)) {
      return { ok: false, reason: "disallowed shell glob or syntax character" };
    }
    if (!inToken && (ch === "~" || ch === "!")) {
      return { ok: false, reason: "disallowed shell expansion prefix" };
    }
    current += ch;
    inToken = true;
  }
  if (quote !== null) {
    return { ok: false, reason: "unclosed quote" };
  }
  if (inToken) {
    if (!current) return { ok: false, reason: "empty quoted token" };
    tokens.push(current);
  }
  if (tokens.length === 0) {
    return { ok: false, reason: "no tokens" };
  }
  if (tokens.length - 1 > MAX_COMMAND_ARGS) {
    return { ok: false, reason: "too many arguments" };
  }
  return { ok: true, tokens };
}
function getFlagName(arg) {
  const eqIdx = arg.indexOf("=");
  return eqIdx >= 0 ? arg.slice(0, eqIdx) : arg;
}
function matchesDangerousFlag(arg, blocked, caseInsensitive = false, normalizeDoubleDash = false) {
  let flag = getFlagName(arg);
  if (normalizeDoubleDash && flag.startsWith("--") && flag.length > 2) {
    flag = flag.slice(1);
  }
  const flagLower = flag.toLowerCase();
  for (const item of blocked) {
    if (caseInsensitive ? item.toLowerCase() === flagLower : item === flag) {
      return true;
    }
    if (!normalizeDoubleDash && item.length === 2 && item[0] === "-" && item[1] !== "-") {
      if (arg.length > 2 && arg[0] === "-" && arg[1] !== "-") {
        const argShort = arg.slice(0, 2);
        if (caseInsensitive ? argShort.toLowerCase() === item.toLowerCase() : argShort === item) {
          return true;
        }
        if (/^-[A-Za-z]{2,}$/.test(arg)) {
          const cluster = caseInsensitive ? arg.slice(1).toLowerCase() : arg.slice(1);
          const targetChar = caseInsensitive ? item[1].toLowerCase() : item[1];
          if (cluster.includes(targetChar)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}
function validateGitArgs(args) {
  if (args.length === 0) {
    return { ok: false, reason: "missing git subcommand" };
  }
  const sub = args[0];
  if (!GIT_ALLOWED_SUBCOMMANDS.has(sub)) {
    return { ok: false, reason: "disallowed git subcommand" };
  }
  const rest = args.slice(1);
  for (const arg of rest) {
    const flagName = getFlagName(arg);
    const lowerFlag = flagName.toLowerCase();
    if (GIT_DANGEROUS_SHORT_FLAGS.has(flagName)) {
      return { ok: false, reason: `disallowed git flag ${flagName}` };
    }
    if (/^-[cCoO].+/.test(arg)) {
      return { ok: false, reason: `disallowed git short flag ${arg.slice(0, 2)}` };
    }
    if (GIT_DANGEROUS_LONG_FLAG_PREFIXES.some(
      (prefix) => lowerFlag === prefix || lowerFlag.startsWith(`${prefix}=`)
    )) {
      return { ok: false, reason: `disallowed git flag ${flagName}` };
    }
  }
  if (sub === "branch") {
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (!arg.startsWith("-")) {
        return { ok: false, reason: "git branch positional argument rejected" };
      }
      const eqIdx = arg.indexOf("=");
      const flagName = eqIdx >= 0 ? arg.slice(0, eqIdx) : arg;
      if (GIT_BRANCH_READONLY_BOOL_FLAGS.has(arg)) {
        continue;
      }
      if (GIT_BRANCH_OPTIONAL_VALUE_FLAGS.has(flagName)) {
        continue;
      }
      if (GIT_BRANCH_REQUIRED_VALUE_FLAGS.has(flagName)) {
        if (eqIdx < 0) {
          if (i + 1 < rest.length && !rest[i + 1].startsWith("-")) {
            i += 1;
          } else {
            return { ok: false, reason: `git branch ${flagName} missing required value` };
          }
        }
        continue;
      }
      return { ok: false, reason: `disallowed git branch flag ${arg}` };
    }
  }
  return {
    ok: true,
    executable: "git",
    args: [...args],
    preset: "git",
    commandPrefix: `git ${sub}`
  };
}
function validateSafeTokens(executable, args) {
  if (typeof executable !== "string" || !Array.isArray(args)) {
    return { ok: false, reason: "invalid token types" };
  }
  if (args.length > MAX_COMMAND_ARGS) {
    return { ok: false, reason: "too many arguments" };
  }
  let totalLen = executable.length;
  if (!SAFE_EXECUTABLE_RE.test(executable) || FORBIDDEN_SHELL_EXECUTABLES.has(executable)) {
    return { ok: false, reason: "disallowed executable" };
  }
  if (ENV_ASSIGN_TOKEN_RE.test(executable) || SHELL_META_HARD_DENY_RE.test(executable)) {
    return { ok: false, reason: "unsafe executable token" };
  }
  for (const arg of args) {
    if (typeof arg !== "string" || arg.length === 0) {
      return { ok: false, reason: "invalid argument token" };
    }
    if (SHELL_META_HARD_DENY_RE.test(arg)) {
      return { ok: false, reason: "unsafe argument metacharacter" };
    }
    totalLen += 1 + arg.length;
    if (totalLen > MAX_COMMAND_LENGTH) {
      return { ok: false, reason: "command exceeds max length" };
    }
  }
  if (executable === "git") {
    return validateGitArgs(args);
  }
  if (executable === "npm") {
    if (args.length === 0) return { ok: false, reason: "missing npm subcommand" };
    const startIdx = args[0] === "run" ? 2 : 1;
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (matchesDangerousFlag(arg, NPM_DANGEROUS_FLAGS, true)) {
        return { ok: false, reason: `disallowed npm flag ${arg}` };
      }
      if (i >= startIdx && arg !== "--" && matchesDangerousFlag(arg, PASSTHROUGH_ALL_DANGEROUS_FLAGS, true)) {
        return { ok: false, reason: `disallowed npm passthrough flag ${arg}` };
      }
    }
    if (args[0] === "test") {
      return {
        ok: true,
        executable: "npm",
        args: [...args],
        preset: "test",
        commandPrefix: "npm test"
      };
    }
    if (args[0] === "run" && args.length >= 2 && NPM_ALLOWED_RUN_SCRIPTS.has(args[1])) {
      const script = args[1];
      return {
        ok: true,
        executable: "npm",
        args: [...args],
        preset: script === "test" ? "test" : "build",
        commandPrefix: `npm run ${script}`
      };
    }
    return { ok: false, reason: "disallowed npm subcommand" };
  }
  if (executable === "pnpm" || executable === "yarn") {
    if (args.length === 0 || !PNPM_YARN_ALLOWED_SCRIPTS.has(args[0])) {
      return { ok: false, reason: `disallowed ${executable} subcommand` };
    }
    const rest = args.slice(1);
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (matchesDangerousFlag(arg, PNPM_YARN_DANGEROUS_FLAGS, true)) {
        return { ok: false, reason: `disallowed ${executable} flag ${arg}` };
      }
      if (arg !== "--" && matchesDangerousFlag(arg, PASSTHROUGH_ALL_DANGEROUS_FLAGS, true)) {
        return { ok: false, reason: `disallowed ${executable} passthrough flag ${arg}` };
      }
    }
    return {
      ok: true,
      executable,
      args: [...args],
      preset: args[0] === "test" ? "test" : "build",
      commandPrefix: `${executable} ${args[0]}`
    };
  }
  if (executable === "npx") {
    if (args.length === 0) return { ok: false, reason: "missing npx target" };
    const tool = args[0];
    const rest = args.slice(1);
    for (const arg of rest) {
      if (matchesDangerousFlag(arg, NPX_DANGEROUS_FLAGS, true)) {
        return { ok: false, reason: `disallowed npx flag ${arg}` };
      }
    }
    if (tool === "tsc") {
      let hasNoEmitTrue = false;
      for (let i = 0; i < rest.length; i += 1) {
        const arg = rest[i];
        const lower = arg.toLowerCase();
        if (lower === "--noemit=false" || lower === "--noemit=0") {
          return { ok: false, reason: "tsc --noEmit=false is disallowed" };
        }
        if (lower === "--noemit") {
          const next = rest[i + 1]?.toLowerCase();
          if (next === "false" || next === "0") {
            return { ok: false, reason: "tsc --noEmit false is disallowed" };
          }
          hasNoEmitTrue = true;
        } else if (lower === "--noemit=true") {
          hasNoEmitTrue = true;
        }
        if (matchesDangerousFlag(arg, TSC_DANGEROUS_FLAGS, true)) {
          return { ok: false, reason: `disallowed tsc flag ${arg}` };
        }
      }
      if (!hasNoEmitTrue) {
        return { ok: false, reason: "npx tsc requires --noEmit" };
      }
      return {
        ok: true,
        executable: "npx",
        args: [...args],
        preset: "build",
        commandPrefix: "npx tsc --noEmit"
      };
    }
    if (tool === "vitest") {
      for (const arg of rest) {
        if (matchesDangerousFlag(arg, VITEST_DANGEROUS_FLAGS, true)) {
          return { ok: false, reason: `disallowed vitest flag ${arg}` };
        }
      }
      return {
        ok: true,
        executable: "npx",
        args: [...args],
        preset: "test",
        commandPrefix: "npx vitest"
      };
    }
    if (tool === "jest") {
      for (const arg of rest) {
        if (matchesDangerousFlag(arg, JEST_DANGEROUS_FLAGS, true)) {
          return { ok: false, reason: `disallowed jest flag ${arg}` };
        }
      }
      return {
        ok: true,
        executable: "npx",
        args: [...args],
        preset: "test",
        commandPrefix: "npx jest"
      };
    }
    if (tool === "eslint") {
      for (const arg of rest) {
        if (matchesDangerousFlag(arg, ESLINT_DANGEROUS_FLAGS, true)) {
          return { ok: false, reason: `disallowed eslint flag ${arg}` };
        }
      }
      return {
        ok: true,
        executable: "npx",
        args: [...args],
        preset: "build",
        commandPrefix: "npx eslint"
      };
    }
    return { ok: false, reason: "disallowed npx tool" };
  }
  if (executable === "pytest") {
    for (const arg of args) {
      if (matchesDangerousFlag(arg, PYTEST_DANGEROUS_FLAGS, true)) {
        return { ok: false, reason: `disallowed pytest flag ${arg}` };
      }
    }
    return {
      ok: true,
      executable: "pytest",
      args: [...args],
      preset: "test",
      commandPrefix: "pytest"
    };
  }
  if (executable === "cargo") {
    if (args.length === 0 || !CARGO_ALLOWED_SUBCOMMANDS.has(args[0])) {
      return { ok: false, reason: "disallowed cargo subcommand" };
    }
    for (const arg of args.slice(1)) {
      if (matchesDangerousFlag(arg, CARGO_DANGEROUS_FLAGS, false)) {
        return { ok: false, reason: `disallowed cargo flag ${arg}` };
      }
    }
    return {
      ok: true,
      executable: "cargo",
      args: [...args],
      preset: args[0] === "test" ? "test" : "build",
      commandPrefix: `cargo ${args[0]}`
    };
  }
  if (executable === "go") {
    if (args.length === 0 || !GO_ALLOWED_SUBCOMMANDS.has(args[0])) {
      return { ok: false, reason: "disallowed go subcommand" };
    }
    for (const arg of args.slice(1)) {
      if (matchesDangerousFlag(arg, GO_DANGEROUS_FLAGS, false, true)) {
        return { ok: false, reason: `disallowed go flag ${arg}` };
      }
    }
    return {
      ok: true,
      executable: "go",
      args: [...args],
      preset: args[0] === "test" ? "test" : "build",
      commandPrefix: `go ${args[0]}`
    };
  }
  return { ok: false, reason: "command not in Auto-RTK whitelist" };
}
function parseSafeAutoRtkCommand(commandLine) {
  const tokenized = tokenizeSimpleSingleCommand(commandLine);
  if (!tokenized.ok) {
    return { ok: false, reason: tokenized.reason };
  }
  const [executable, ...args] = tokenized.tokens;
  if (ENV_ASSIGN_TOKEN_RE.test(executable)) {
    return { ok: false, reason: "environment variable prefix rejected" };
  }
  return validateSafeTokens(executable, args);
}
function isSafePathForShellArg(candidate) {
  if (typeof candidate !== "string") return false;
  if (!candidate || candidate.length > 512) return false;
  if (candidate !== candidate.trim() || /[\x00-\x1f\x7f]/.test(candidate)) return false;
  if (SHELL_META_HARD_DENY_RE.test(candidate)) return false;
  if (candidate.includes("'") || candidate.includes('"')) return false;
  return SAFE_SHELL_PATH_RE.test(candidate);
}
function quoteSafePosixArg(value) {
  return `'${value}'`;
}
function resolveDefaultCliEntryPath() {
  const argvEntry = typeof process.argv[1] === "string" && process.argv[1] ? process.argv[1] : "";
  const argvDir = argvEntry ? import_node_path14.default.dirname(import_node_path14.default.resolve(argvEntry)) : "";
  const candidates = [
    argvDir ? import_node_path14.default.resolve(argvDir, "cli.cjs") : "",
    argvDir ? import_node_path14.default.resolve(argvDir, "../dist/cli.cjs") : "",
    import_node_path14.default.resolve(process.cwd(), "dist/cli.cjs")
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (import_node_fs13.default.existsSync(candidate)) {
        return candidate;
      }
    } catch {
    }
  }
  return import_node_path14.default.resolve(process.cwd(), "dist/cli.cjs");
}
function buildAutoRtkOverwriteCommand(cliEntryPath, parsed, rootDataDir) {
  if (!isSafePathForShellArg(cliEntryPath)) {
    return null;
  }
  const resolvedCli = import_node_path14.default.resolve(cliEntryPath);
  if (!isSafePathForShellArg(resolvedCli)) {
    return null;
  }
  const rechecked = validateSafeTokens(parsed.executable, parsed.args);
  if (!rechecked.ok) {
    return null;
  }
  const payloadJson = JSON.stringify({
    v: 1,
    executable: rechecked.executable,
    args: rechecked.args,
    preset: rechecked.preset
  });
  const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64url");
  if (!SAFE_B64URL_RE.test(payloadB64) || payloadB64.length > MAX_PAYLOAD_B64_LENGTH) {
    return null;
  }
  const parts = [
    "node",
    quoteSafePosixArg(resolvedCli),
    "compact-run",
    `--payload=${payloadB64}`
  ];
  if (rootDataDir !== void 0 && rootDataDir !== "") {
    if (!isSafePathForShellArg(rootDataDir)) {
      return null;
    }
    const resolvedDataDir = import_node_path14.default.resolve(rootDataDir);
    if (!isSafePathForShellArg(resolvedDataDir)) {
      return null;
    }
    parts.push(`--data-dir=${quoteSafePosixArg(resolvedDataDir)}`);
  }
  return parts.join(" ");
}
function recordTurboHotspot(moduleDataDir, commandLine, rootDataDir) {
  if (typeof commandLine !== "string" || !commandLine.trim()) return null;
  if (/\bcompact-run\b/.test(commandLine) && commandLine.includes("--payload=")) {
    return null;
  }
  const realRoot = resolveSafeExistingDir(rootDataDir);
  if (!realRoot) return null;
  const parsed = parseSafeAutoRtkCommand(commandLine);
  if (!parsed.ok) return null;
  const existing = loadTurboHotspotsReadOnly(moduleDataDir);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const safeLastCommand = redactFeedText(commandLine, 100);
  const wasteIncrement = ESTIMATED_WASTE_BY_PRESET[parsed.preset];
  const byPrefix = /* @__PURE__ */ new Map();
  for (const item of existing) {
    byPrefix.set(item.commandPrefix, { ...item });
  }
  const prev = byPrefix.get(parsed.commandPrefix);
  if (prev) {
    prev.count += 1;
    prev.lastCommand = safeLastCommand;
    prev.estimatedWasteTokens += wasteIncrement;
    prev.lastSeenAt = nowIso;
  } else {
    byPrefix.set(parsed.commandPrefix, {
      commandPrefix: parsed.commandPrefix,
      count: 1,
      lastCommand: safeLastCommand,
      estimatedWasteTokens: wasteIncrement,
      lastSeenAt: nowIso
    });
  }
  const nextItems = sortHotspots(Array.from(byPrefix.values()));
  try {
    atomicWritePrivateFile(
      moduleDataDir,
      HOTSPOTS_FILENAME,
      `${JSON.stringify({ schemaVersion: 1, updatedAt: nowIso, items: nextItems }, null, 2)}
`
    );
    return nextItems;
  } catch {
    return null;
  }
}

// src/modules/turbo/hook.ts
var RUN_COMMAND_TOOL_RE = /^run_command$/i;
function extractRunCommandInput(payload) {
  if (!payload.toolName || !RUN_COMMAND_TOOL_RE.test(payload.toolName.trim())) {
    return null;
  }
  const toolInput = payload.toolInput;
  if (!toolInput || typeof toolInput !== "object") {
    return null;
  }
  if (typeof toolInput.CommandLine === "string" && toolInput.CommandLine.trim()) {
    return { cmdKey: "CommandLine", commandLine: toolInput.CommandLine };
  }
  if (typeof toolInput.command === "string" && toolInput.command.trim()) {
    return { cmdKey: "command", commandLine: toolInput.command };
  }
  return null;
}
function handleTurboSessionStartHook(payload, _rootDataDir) {
  try {
    const candidate = payload.workspaceRoot ?? payload.workspacePaths[0] ?? payload.cwd;
    if (!candidate || typeof candidate !== "string" || candidate.includes("\0")) {
      return {};
    }
    const resolved = import_node_path15.default.resolve(candidate);
    if (!import_node_fs14.default.existsSync(resolved)) {
      return {};
    }
    const stat = import_node_fs14.default.statSync(resolved);
    if (!stat.isDirectory()) {
      return {};
    }
    const snapshot = buildWorkspaceSnapshot(resolved);
    if (!snapshot.markdown.trim()) {
      return {};
    }
    return {
      injectSteps: [
        {
          systemMessage: {
            systemMessage: `[agy-NOV Turbo Workspace Map]
${snapshot.markdown}`
          }
        }
      ]
    };
  } catch {
    return {};
  }
}
function handleTurboPreToolHook(payload, rootDataDir, cliEntryPath) {
  try {
    if (payload.event !== "PreToolUse") {
      return {};
    }
    const moduleDataDir = getModuleDataDir(rootDataDir, "turbo");
    const prefs = loadTurboPrefsReadOnly(moduleDataDir);
    if (prefs.autoRtk !== true) {
      return {};
    }
    const extracted = extractRunCommandInput(payload);
    if (!extracted) {
      return {};
    }
    const parsed = parseSafeAutoRtkCommand(extracted.commandLine);
    if (!parsed.ok) {
      return {};
    }
    const resolvedCliEntry = typeof cliEntryPath === "string" && cliEntryPath.trim() ? cliEntryPath : resolveDefaultCliEntryPath();
    const rewrittenCmd = buildAutoRtkOverwriteCommand(resolvedCliEntry, parsed, rootDataDir);
    if (!rewrittenCmd) {
      return {};
    }
    return {
      decision: "allow",
      overwrite: {
        [extracted.cmdKey]: rewrittenCmd
      }
    };
  } catch {
    return {};
  }
}
function handleTurboPostToolHook(payload, rootDataDir) {
  try {
    if (payload.event !== "PostToolUse") {
      return;
    }
    const extracted = extractRunCommandInput(payload);
    if (!extracted) {
      return;
    }
    const moduleDataDir = getModuleDataDir(rootDataDir, "turbo");
    recordTurboHotspot(moduleDataDir, extracted.commandLine, rootDataDir);
  } catch {
  }
}

// src/modules/verify/hook.ts
var import_node_crypto11 = __toESM(require("node:crypto"), 1);

// src/modules/verify/core.ts
var import_node_child_process2 = require("node:child_process");
var import_node_crypto10 = __toESM(require("node:crypto"), 1);
var import_node_fs15 = __toESM(require("node:fs"), 1);
var import_node_path16 = __toESM(require("node:path"), 1);
var ALLOWED_VERIFY_EXECUTABLES = /* @__PURE__ */ new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "node",
  "tsc",
  "vitest",
  "jest",
  "pytest",
  "python3",
  "cargo",
  "go",
  "ruff",
  "eslint",
  "git"
]);
var ALLOWED_GIT_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "diff",
  "status",
  "rev-parse",
  "check-ignore"
]);
var ALLOWED_PYTHON_MODULES = /* @__PURE__ */ new Set([
  "pytest",
  "unittest",
  "mypy",
  "ruff",
  "compileall",
  "py_compile"
]);
var ALLOWED_GO_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "test",
  "vet",
  "build",
  "version"
]);
var ALLOWED_CARGO_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "test",
  "check",
  "clippy",
  "fmt",
  "--version",
  "-V"
]);
var PACKAGE_MANAGER_EXECUTABLES = /* @__PURE__ */ new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun"
]);
var LINTER_TESTER_EXECUTABLES = /* @__PURE__ */ new Set([
  "tsc",
  "vitest",
  "jest",
  "pytest",
  "ruff",
  "eslint"
]);
var SAFE_SCRIPT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/;
var FORBIDDEN_SCRIPT_NAMES = /* @__PURE__ */ new Set([
  "exec",
  "x",
  "dlx",
  "eval"
]);
var FORBIDDEN_PM_ARG_TOKENS = /* @__PURE__ */ new Set([
  "exec",
  "x",
  "dlx",
  "eval",
  "install",
  "i",
  "add",
  "config",
  "publish",
  "set"
]);
var FORBIDDEN_NODE_LONG_FLAGS = [
  "--eval",
  "--print",
  "--require",
  "--loader",
  "--experimental-loader",
  "--env-file",
  "--env-file-if-exists",
  "--inspect",
  "--inspect-brk",
  "--inspect-wait",
  "--inspect-port",
  "--debug-port",
  "--interactive",
  "--input-type",
  "--experimental-config-file",
  "--experimental-default-config-file",
  "--openssl-config",
  "--test-global-setup"
];
var ALLOWED_PM_PRE_DASH_FLAGS = /* @__PURE__ */ new Set([
  "--silent",
  "-s",
  "--if-present",
  "--no-color",
  "--color",
  "--quiet",
  "-q"
]);
var FORBIDDEN_PM_LONG_FLAGS = /* @__PURE__ */ new Set([
  "--call",
  "--shell",
  "--script-shell",
  "--onload-script",
  "--preload",
  "--userconfig",
  "--globalconfig",
  "--node-options",
  "--node-gyp",
  "--init-module",
  "--editor",
  "--browser",
  "--require",
  "--import",
  "--loader",
  "--experimental-loader"
]);
var FORBIDDEN_NODE_SHORT_FLAGS = /* @__PURE__ */ new Set([
  "-e",
  "-p",
  "-c",
  "-r",
  "-i"
]);
var MAX_VERIFY_COMMANDS = 20;
var MAX_VERIFY_ARGS = 20;
var MAX_VERIFY_ARG_LENGTH = 256;
var MIN_COMMAND_TIMEOUT_MS = 1e3;
var MAX_COMMAND_TIMEOUT_MS = 6e4;
var DEFAULT_COMMAND_TIMEOUT_MS = 15e3;
var STOP_HOOK_SINGLE_TIMEOUT_MS = 8e3;
var STOP_HOOK_TOTAL_BUDGET_MS = 14e3;
var MAX_CAPTURE_BYTES = 64 * 1024;
var MAX_STORED_OUTPUT_TAIL_CHARS = 4096;
var MAX_STORED_SESSIONS2 = 100;
var MAX_STORED_EVIDENCE = 60;
var DEFAULT_MAX_CONSECUTIVE_BLOCKS = 3;
var MIN_CONSECUTIVE_BLOCKS = 1;
var MAX_CONSECUTIVE_BLOCKS = 10;
var COMMAND_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;
var MAX_SYMLINK_DEPTH2 = 20;
var DEFAULT_VERIFY_POLICY = {
  enforceOnStop: true,
  autoRunOnStop: true,
  blockEmptyWrites: true,
  maxConsecutiveBlocks: DEFAULT_MAX_CONSECUTIVE_BLOCKS,
  commands: [
    {
      id: "typecheck",
      label: "TypeScript Typecheck",
      executable: "npm",
      args: ["run", "typecheck"],
      timeoutMs: 15e3,
      enabled: false
    },
    {
      id: "unit-tests",
      label: "Unit Tests",
      executable: "npm",
      args: ["test"],
      timeoutMs: 3e4,
      enabled: false
    }
  ]
};
var SECRET_REDACTION_PATTERNS = [
  // Full PEM / OpenSSH private key blocks
  {
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]"
  },
  // Truncated private key block starting with BEGIN PRIVATE KEY
  {
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*/g,
    replacement: "[REDACTED_PRIVATE_KEY]"
  },
  // Bearer & JWT tokens
  {
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: "Bearer [REDACTED]"
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: "[REDACTED_JWT]"
  },
  // Provider API keys & personal access tokens
  {
    pattern: /\b(?:sk-ant-[A-Za-z0-9_-]{12,}|sk-proj-[A-Za-z0-9_-]{12,}|sk_live_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|ghu_[A-Za-z0-9]{16,}|ghs_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|AIza[0-9A-Za-z_-]{24,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16})\b/g,
    replacement: "[REDACTED_KEY]"
  },
  // Generic secret/token/password assignments
  {
    pattern: /(["']?(?:api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?token|auth[_-]?token|secret|password|passwd|authorization)["']?\s*[:=]\s*["']?)([^\s"',;}{]{8,})(["']?)/gi,
    replacement: "$1[REDACTED]$3"
  }
];
function redactVerifyOutput(input) {
  if (!input) return "";
  let out = input;
  for (const { pattern, replacement } of SECRET_REDACTION_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
function getVerifyStatePath(moduleDataDir) {
  return import_node_path16.default.join(moduleDataDir, "state.json");
}
function clampCommandTimeout(raw) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_COMMAND_TIMEOUT_MS;
  }
  return Math.max(MIN_COMMAND_TIMEOUT_MS, Math.min(MAX_COMMAND_TIMEOUT_MS, Math.round(raw)));
}
function clampMaxConsecutiveBlocks(raw) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_MAX_CONSECUTIVE_BLOCKS;
  }
  return Math.max(MIN_CONSECUTIVE_BLOCKS, Math.min(MAX_CONSECUTIVE_BLOCKS, Math.round(raw)));
}
function isForbiddenInterpreterArg(arg) {
  const lower = arg.toLowerCase();
  if (arg === "-e" || lower === "--eval" || lower.startsWith("--eval=") || arg === "-c" || arg === "-p" || lower === "--print" || lower.startsWith("--print=")) {
    return true;
  }
  if (arg.startsWith("-") && !arg.startsWith("--") && arg.length > 1) {
    if (/^-[ecp]/.test(arg)) {
      return true;
    }
    if (/^-[A-Za-z]+$/.test(arg) && /[ecp]/.test(arg.slice(1))) {
      return true;
    }
  }
  return false;
}
function hasAbsolutePathPrefix(value, includeTilde = false) {
  if (!value) return false;
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value)) {
    return true;
  }
  if (includeTilde && value.startsWith("~")) {
    return true;
  }
  return false;
}
function hasParentTraversalSegment(value) {
  if (!value) return false;
  return value.split(/[/\\]/).some((seg) => seg === "..");
}
function hasPathTraversalOrAbsolute(arg, includeTilde = true) {
  if (hasAbsolutePathPrefix(arg, includeTilde) || hasParentTraversalSegment(arg)) {
    return true;
  }
  const eqIdx = arg.indexOf("=");
  if (eqIdx > 0) {
    const rhs = arg.slice(eqIdx + 1);
    if (hasAbsolutePathPrefix(rhs, includeTilde) || hasParentTraversalSegment(rhs)) {
      return true;
    }
  }
  return false;
}
function validatePackageManagerArgs(id, executable, args) {
  if (args.length === 0) {
    return `Command "${id}" ${executable} requires an allowed subcommand (test, run <script>, --version, or -v).`;
  }
  if (executable === "bun") {
    for (const arg of args) {
      if (isForbiddenInterpreterArg(arg)) {
        return `Command "${id}" uses forbidden bun inline-execution flag "${arg}".`;
      }
    }
  }
  const sub = args[0];
  let restArgs;
  if (sub === "--version" || sub === "-v") {
    if (args.length !== 1) {
      return `Command "${id}" ${executable} ${sub} does not accept additional arguments.`;
    }
    return null;
  } else if (sub === "test") {
    restArgs = args.slice(1);
  } else if (sub === "run") {
    const scriptName = args[1];
    if (!scriptName || !SAFE_SCRIPT_NAME_RE.test(scriptName)) {
      return `Command "${id}" ${executable} run requires a safe script name matching ${SAFE_SCRIPT_NAME_RE.source}.`;
    }
    if (FORBIDDEN_SCRIPT_NAMES.has(scriptName.toLowerCase())) {
      return `Command "${id}" ${executable} run script name "${scriptName}" is forbidden.`;
    }
    restArgs = args.slice(2);
  } else {
    return `Command "${id}" ${executable} subcommand "${sub}" is not allowed (permitted: test, run <script>, --version, -v).`;
  }
  let afterDoubleDash = false;
  for (const arg of restArgs) {
    if (arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    const lower = arg.toLowerCase();
    const eqIdx = arg.indexOf("=");
    const normalizedFlag = (eqIdx >= 0 ? lower.slice(0, eqIdx) : lower).replace(/_/g, "-");
    const rhsLower = eqIdx >= 0 ? lower.slice(eqIdx + 1) : "";
    if (FORBIDDEN_PM_ARG_TOKENS.has(lower)) {
      return `Command "${id}" uses forbidden ${executable} argument "${arg}".`;
    }
    if (isForbiddenInterpreterArg(arg)) {
      return `Command "${id}" uses forbidden ${executable} flag "${arg}".`;
    }
    if (lower.includes("data:") || lower.includes("file:") || rhsLower.startsWith("data:") || rhsLower.startsWith("file:")) {
      return `Command "${id}" uses disallowed URL scheme in ${executable} argument "${arg}".`;
    }
    if (FORBIDDEN_PM_LONG_FLAGS.has(normalizedFlag) || executable === "bun" && arg === "-r") {
      return `Command "${id}" uses disallowed ${executable} option "${arg}".`;
    }
    if (!afterDoubleDash && arg.startsWith("-") && !ALLOWED_PM_PRE_DASH_FLAGS.has(normalizedFlag)) {
      return `Command "${id}" uses disallowed ${executable} option "${arg}" before "--".`;
    }
    if (hasPathTraversalOrAbsolute(arg, true)) {
      return `Command "${id}" ${executable} argument "${arg}" contains a disallowed absolute or parent-traversal path.`;
    }
  }
  return null;
}
function validateNodeArgs(id, args) {
  if (args.length === 0) {
    return `Command "${id}" node requires explicit arguments (interactive REPL is disallowed).`;
  }
  if (args[0]?.toLowerCase() === "inspect") {
    return `Command "${id}" node inspect subcommand is disallowed.`;
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const lower = arg.toLowerCase();
    if (arg === "-") {
      return `Command "${id}" node stdin execution "-" is disallowed.`;
    }
    if (isForbiddenInterpreterArg(arg)) {
      return `Command "${id}" uses forbidden node inline-execution flag "${arg}".`;
    }
    if (lower === "--import") {
      const nextArg = args[i + 1];
      if (arg !== "--import" || nextArg !== "tsx") {
        return `Command "${id}" node --import is restricted strictly to "--import tsx" or "--import=tsx".`;
      }
      i += 1;
      continue;
    }
    if (lower.startsWith("--import=")) {
      if (arg !== "--import=tsx") {
        return `Command "${id}" node --import is restricted strictly to "--import tsx" or "--import=tsx".`;
      }
      continue;
    }
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      const rawFlag = (eqIdx >= 0 ? lower.slice(0, eqIdx) : lower).replace(/_/g, "-");
      if (FORBIDDEN_NODE_LONG_FLAGS.includes(rawFlag)) {
        return `Command "${id}" uses forbidden node option "${arg}".`;
      }
      if (eqIdx > 0) {
        const rhs = arg.slice(eqIdx + 1);
        const rhsLower = rhs.toLowerCase();
        if (rhsLower.startsWith("data:") || rhsLower.startsWith("file:") || hasAbsolutePathPrefix(rhs, true) || hasParentTraversalSegment(rhs)) {
          return `Command "${id}" node option "${arg}" contains a disallowed URL, absolute path, or parent traversal.`;
        }
      }
      continue;
    }
    if (arg.startsWith("-") && !arg.startsWith("--") && arg.length > 1) {
      if (arg.length > 2) {
        return `Command "${id}" uses disallowed bundled or compact node short flag "${arg}".`;
      }
      if (FORBIDDEN_NODE_SHORT_FLAGS.has(arg)) {
        return `Command "${id}" uses forbidden node short flag "${arg}".`;
      }
      continue;
    }
    if (lower.startsWith("data:") || lower.startsWith("file:") || hasAbsolutePathPrefix(arg, true) || hasParentTraversalSegment(arg)) {
      return `Command "${id}" node positional argument "${arg}" must be a relative path inside the workspace without ".." segments.`;
    }
  }
  return null;
}
function validatePythonArgs(id, args) {
  if (args.length === 0) {
    return `Command "${id}" python3 requires explicit arguments (--version, -V, or -m <allowed_module>).`;
  }
  const first = args[0];
  if (first === "--version" || first === "-V") {
    if (args.length !== 1) {
      return `Command "${id}" python3 ${first} does not accept additional arguments.`;
    }
    return null;
  }
  if (first !== "-m") {
    return `Command "${id}" python3 only permits "--version", "-V", or "-m <module>" (disallowed leading arg "${first}").`;
  }
  const modName = args[1];
  if (!modName || !ALLOWED_PYTHON_MODULES.has(modName)) {
    return `Command "${id}" python3 module "${modName ?? ""}" is not in the allowlist (${[...ALLOWED_PYTHON_MODULES].join(", ")}).`;
  }
  for (const arg of args.slice(2)) {
    const lower = arg.toLowerCase();
    if (arg === "-" || arg === "-i" || isForbiddenInterpreterArg(arg)) {
      return `Command "${id}" uses forbidden python3 argument "${arg}".`;
    }
    if (lower === "--eval" || lower.startsWith("--eval=")) {
      return `Command "${id}" uses forbidden python3 option "${arg}".`;
    }
    if (hasPathTraversalOrAbsolute(arg, true)) {
      return `Command "${id}" python3 argument "${arg}" contains a disallowed absolute or parent-traversal path.`;
    }
  }
  return null;
}
function validateGoArgs(id, args) {
  const sub = args[0];
  if (!sub || !ALLOWED_GO_SUBCOMMANDS.has(sub)) {
    return `Command "${id}" go subcommand "${sub ?? ""}" is not allowed (permitted: ${[...ALLOWED_GO_SUBCOMMANDS].join(", ")}).`;
  }
  for (const arg of args.slice(1)) {
    const lower = arg.toLowerCase();
    if (lower === "-exec" || lower.startsWith("-exec=") || lower === "--exec" || lower.startsWith("--exec=") || lower === "-toolexec" || lower.startsWith("-toolexec=") || lower === "--toolexec" || lower.startsWith("--toolexec=") || lower === "-vettool" || lower.startsWith("-vettool=") || lower === "--vettool" || lower.startsWith("--vettool=")) {
      return `Command "${id}" uses forbidden go option "${arg}".`;
    }
    if (hasPathTraversalOrAbsolute(arg, true)) {
      return `Command "${id}" go argument "${arg}" contains a disallowed absolute or parent-traversal path.`;
    }
  }
  return null;
}
function validateCargoArgs(id, args) {
  const sub = args[0];
  if (!sub || !ALLOWED_CARGO_SUBCOMMANDS.has(sub)) {
    return `Command "${id}" cargo subcommand "${sub ?? ""}" is not allowed (permitted: ${[...ALLOWED_CARGO_SUBCOMMANDS].join(", ")}).`;
  }
  if ((sub === "--version" || sub === "-V") && args.length !== 1) {
    return `Command "${id}" cargo ${sub} does not accept additional arguments.`;
  }
  for (const arg of args.slice(1)) {
    const lower = arg.toLowerCase();
    if (lower === "--config" || lower.startsWith("--config=")) {
      return `Command "${id}" uses forbidden cargo option "${arg}".`;
    }
    if (hasPathTraversalOrAbsolute(arg, true)) {
      return `Command "${id}" cargo argument "${arg}" contains a disallowed absolute or parent-traversal path.`;
    }
  }
  return null;
}
function validateGitArgs2(id, args) {
  const subcommand = args[0];
  if (!subcommand || !ALLOWED_GIT_SUBCOMMANDS.has(subcommand)) {
    return `Command "${id}" git subcommand "${subcommand ?? ""}" is not allowed (permitted read-only subcommands: ${[...ALLOWED_GIT_SUBCOMMANDS].join(", ")}).`;
  }
  for (const arg of args.slice(1)) {
    const lower = arg.toLowerCase();
    if (lower === "--output" || lower.startsWith("--output=") || lower === "--ext-diff" || lower === "--no-index" || lower === "--textconv" || lower === "--git-dir" || lower.startsWith("--git-dir=") || lower === "--work-tree" || lower.startsWith("--work-tree=")) {
      return `Command "${id}" uses disallowed git option "${arg}".`;
    }
    if (arg.includes("..")) {
      return `Command "${id}" git argument "${arg}" contains forbidden ".." sequence.`;
    }
    if (hasAbsolutePathPrefix(arg, true) || arg.includes(":/") || arg.includes(":\\") || /^:\([^)]*\)[/\\~]/.test(arg)) {
      return `Command "${id}" git argument "${arg}" contains a disallowed absolute or home path.`;
    }
    const eqIdx = arg.indexOf("=");
    if (eqIdx > 0) {
      const rhs = arg.slice(eqIdx + 1);
      if (hasAbsolutePathPrefix(rhs, true)) {
        return `Command "${id}" git option "${arg}" contains a disallowed absolute or home path.`;
      }
    }
  }
  return null;
}
function validateLinterOrTesterArgs(id, executable, args) {
  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (lower === "--eval" || lower.startsWith("--eval=") || arg === "-c" || lower.startsWith("-c=")) {
      return `Command "${id}" uses disallowed ${executable} option "${arg}".`;
    }
    if (hasPathTraversalOrAbsolute(arg, true)) {
      return `Command "${id}" ${executable} argument "${arg}" contains a disallowed absolute or parent-traversal path.`;
    }
  }
  return null;
}
function validateVerifyCommand(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, error: "Command specification must be an object." };
  }
  const obj = raw;
  if (typeof obj.id !== "string" || !COMMAND_ID_RE.test(obj.id.trim())) {
    return {
      valid: false,
      error: "Command id must be 1..64 characters of [a-zA-Z0-9._-]."
    };
  }
  const id = obj.id.trim();
  if (typeof obj.label !== "string" || !obj.label.trim()) {
    return { valid: false, error: `Command "${id}" must have a non-empty label.` };
  }
  const label = obj.label.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, 120);
  if (typeof obj.executable !== "string" || obj.executable.length === 0) {
    return { valid: false, error: `Command "${id}" must specify an executable name.` };
  }
  const executable = obj.executable;
  if (executable.includes("/") || executable.includes("\\") || executable.includes("..") || /[\s\x00-\x1f\x7f]/.test(executable)) {
    return {
      valid: false,
      error: `Command "${id}" executable "${executable}" must be a bare command name without paths, whitespace, or control characters.`
    };
  }
  if (!ALLOWED_VERIFY_EXECUTABLES.has(executable)) {
    return {
      valid: false,
      error: `Command "${id}" executable "${executable}" is not in the verify allowlist.`
    };
  }
  if (!Array.isArray(obj.args)) {
    return { valid: false, error: `Command "${id}" args must be an array of strings.` };
  }
  if (obj.args.length > MAX_VERIFY_ARGS) {
    return {
      valid: false,
      error: `Command "${id}" exceeds maximum argument count (${MAX_VERIFY_ARGS}).`
    };
  }
  const args = [];
  for (let i = 0; i < obj.args.length; i += 1) {
    const arg = obj.args[i];
    if (typeof arg !== "string") {
      return { valid: false, error: `Command "${id}" arg[${i}] must be a string.` };
    }
    if (arg.length > MAX_VERIFY_ARG_LENGTH) {
      return {
        valid: false,
        error: `Command "${id}" arg[${i}] exceeds maximum length (${MAX_VERIFY_ARG_LENGTH}).`
      };
    }
    if (arg.includes("\0")) {
      return {
        valid: false,
        error: `Command "${id}" arg[${i}] contains a forbidden NUL byte.`
      };
    }
    args.push(arg);
  }
  let toolError = null;
  if (PACKAGE_MANAGER_EXECUTABLES.has(executable)) {
    toolError = validatePackageManagerArgs(id, executable, args);
  } else if (executable === "node") {
    toolError = validateNodeArgs(id, args);
  } else if (executable === "python3") {
    toolError = validatePythonArgs(id, args);
  } else if (executable === "go") {
    toolError = validateGoArgs(id, args);
  } else if (executable === "cargo") {
    toolError = validateCargoArgs(id, args);
  } else if (executable === "git") {
    toolError = validateGitArgs2(id, args);
  } else if (LINTER_TESTER_EXECUTABLES.has(executable)) {
    toolError = validateLinterOrTesterArgs(id, executable, args);
  } else {
    toolError = `Command "${id}" executable "${executable}" has no registered argument validator.`;
  }
  if (toolError) {
    return { valid: false, error: toolError };
  }
  const timeoutMs = clampCommandTimeout(obj.timeoutMs);
  const enabled = typeof obj.enabled === "boolean" ? obj.enabled : true;
  return {
    valid: true,
    command: {
      id,
      label,
      executable,
      args,
      timeoutMs,
      enabled
    }
  };
}
function cloneDefaultPolicy() {
  return {
    ...DEFAULT_VERIFY_POLICY,
    commands: DEFAULT_VERIFY_POLICY.commands.map((c) => ({ ...c, args: [...c.args] }))
  };
}
function createDefaultVerifyState(nowIso = (/* @__PURE__ */ new Date()).toISOString()) {
  return {
    schemaVersion: 1,
    policy: cloneDefaultPolicy(),
    sessions: {},
    evidence: [],
    blockedStops: 0,
    updatedAt: nowIso
  };
}
function normalizePolicyFromDisk(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return cloneDefaultPolicy();
  }
  const obj = raw;
  const commands = [];
  if (Array.isArray(obj.commands)) {
    const seen = /* @__PURE__ */ new Set();
    for (const item of obj.commands.slice(0, MAX_VERIFY_COMMANDS)) {
      const check = validateVerifyCommand(item);
      if (check.valid && check.command && !seen.has(check.command.id)) {
        seen.add(check.command.id);
        commands.push(check.command);
      }
    }
  } else {
    commands.push(...cloneDefaultPolicy().commands);
  }
  return {
    enforceOnStop: typeof obj.enforceOnStop === "boolean" ? obj.enforceOnStop : DEFAULT_VERIFY_POLICY.enforceOnStop,
    autoRunOnStop: typeof obj.autoRunOnStop === "boolean" ? obj.autoRunOnStop : DEFAULT_VERIFY_POLICY.autoRunOnStop,
    blockEmptyWrites: typeof obj.blockEmptyWrites === "boolean" ? obj.blockEmptyWrites : DEFAULT_VERIFY_POLICY.blockEmptyWrites,
    maxConsecutiveBlocks: clampMaxConsecutiveBlocks(obj.maxConsecutiveBlocks),
    commands
  };
}
function normalizeStringArray(raw, maxLen = 200) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of raw) {
    if (typeof item === "string" && item.trim() && !seen.has(item)) {
      seen.add(item);
      out.push(item);
      if (out.length >= maxLen) break;
    }
  }
  return out;
}
function normalizeSessionFromDisk(id, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const convId = typeof obj.conversationId === "string" && obj.conversationId.trim() ? obj.conversationId.trim().slice(0, 120) : id;
  return {
    conversationId: convId,
    workspaceRoot: typeof obj.workspaceRoot === "string" ? obj.workspaceRoot : void 0,
    dirtyFiles: normalizeStringArray(obj.dirtyFiles, 200),
    emptyFiles: normalizeStringArray(obj.emptyFiles, 200),
    lastEditAt: typeof obj.lastEditAt === "string" ? obj.lastEditAt : void 0,
    lastVerifiedAt: typeof obj.lastVerifiedAt === "string" ? obj.lastVerifiedAt : void 0,
    lastVerifiedPassed: typeof obj.lastVerifiedPassed === "boolean" ? obj.lastVerifiedPassed : void 0,
    consecutiveBlocks: typeof obj.consecutiveBlocks === "number" && Number.isFinite(obj.consecutiveBlocks) ? Math.max(0, Math.floor(obj.consecutiveBlocks)) : 0,
    totalBlocks: typeof obj.totalBlocks === "number" && Number.isFinite(obj.totalBlocks) ? Math.max(0, Math.floor(obj.totalBlocks)) : 0,
    lastGuardrailReleaseAt: typeof obj.lastGuardrailReleaseAt === "string" ? obj.lastGuardrailReleaseAt : void 0,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : nowIso
  };
}
function normalizeCommandRunResultFromDisk(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw;
  if (typeof obj.commandId !== "string" || typeof obj.executable !== "string") return null;
  return {
    commandId: obj.commandId,
    label: typeof obj.label === "string" ? obj.label : obj.commandId,
    executable: obj.executable,
    args: Array.isArray(obj.args) ? obj.args.filter((a) => typeof a === "string") : [],
    passed: Boolean(obj.passed),
    exitCode: typeof obj.exitCode === "number" && Number.isFinite(obj.exitCode) ? obj.exitCode : null,
    timedOut: Boolean(obj.timedOut),
    durationMs: typeof obj.durationMs === "number" && Number.isFinite(obj.durationMs) ? Math.max(0, Math.round(obj.durationMs)) : 0,
    outputTail: typeof obj.outputTail === "string" ? redactVerifyOutput(obj.outputTail) : "",
    outputTruncated: Boolean(obj.outputTruncated),
    error: typeof obj.error === "string" ? redactVerifyOutput(obj.error) : void 0
  };
}
function normalizeEvidenceFromDisk(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw;
  if (typeof obj.id !== "string" || typeof obj.timestamp !== "string") return null;
  const trigger = obj.trigger === "manual" || obj.trigger === "stop-hook" || obj.trigger === "app-ui" ? obj.trigger : "manual";
  const outcome = obj.outcome === "pass" || obj.outcome === "fail" || obj.outcome === "blocked" || obj.outcome === "guardrail-allow" ? obj.outcome : obj.passed ? "pass" : "fail";
  const results = [];
  if (Array.isArray(obj.results)) {
    for (const r of obj.results) {
      const norm = normalizeCommandRunResultFromDisk(r);
      if (norm) results.push(norm);
    }
  }
  return {
    id: obj.id,
    conversationId: typeof obj.conversationId === "string" ? obj.conversationId : "default-session",
    trigger,
    outcome,
    passed: Boolean(obj.passed),
    timestamp: obj.timestamp,
    durationMs: typeof obj.durationMs === "number" && Number.isFinite(obj.durationMs) ? Math.max(0, Math.round(obj.durationMs)) : 0,
    dirtyFiles: normalizeStringArray(obj.dirtyFiles, 200),
    emptyFiles: normalizeStringArray(obj.emptyFiles, 200),
    results,
    summary: typeof obj.summary === "string" ? redactVerifyOutput(obj.summary) : "",
    reason: typeof obj.reason === "string" ? redactVerifyOutput(obj.reason) : void 0
  };
}
function loadVerifyStateReadOnly(moduleDataDir) {
  const statePath = getVerifyStatePath(moduleDataDir);
  if (!import_node_fs15.default.existsSync(statePath)) {
    return createDefaultVerifyState();
  }
  try {
    const raw = JSON.parse(import_node_fs15.default.readFileSync(statePath, "utf8"));
    const policy = normalizePolicyFromDisk(raw.policy);
    const sessions = {};
    if (raw.sessions && typeof raw.sessions === "object" && !Array.isArray(raw.sessions)) {
      for (const [id, rec] of Object.entries(raw.sessions)) {
        const norm = normalizeSessionFromDisk(id, rec);
        if (norm) sessions[norm.conversationId] = norm;
      }
    }
    const evidence = [];
    if (Array.isArray(raw.evidence)) {
      for (const item of raw.evidence.slice(0, MAX_STORED_EVIDENCE)) {
        const norm = normalizeEvidenceFromDisk(item);
        if (norm) evidence.push(norm);
      }
    }
    const blockedStops = typeof raw.blockedStops === "number" && Number.isFinite(raw.blockedStops) ? Math.max(0, Math.floor(raw.blockedStops)) : evidence.filter((e) => e.outcome === "blocked").length;
    return {
      schemaVersion: 1,
      policy,
      sessions,
      evidence,
      blockedStops,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch {
    return createDefaultVerifyState();
  }
}
function saveVerifyState(moduleDataDir, state) {
  const sortedSessions = Object.values(state.sessions).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, MAX_STORED_SESSIONS2);
  const prunedSessions = {};
  for (const s of sortedSessions) {
    prunedSessions[s.conversationId] = s;
  }
  const next = {
    schemaVersion: 1,
    policy: normalizePolicyFromDisk(state.policy),
    sessions: prunedSessions,
    evidence: state.evidence.slice(0, MAX_STORED_EVIDENCE),
    blockedStops: Math.max(0, Math.floor(state.blockedStops)),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  atomicWriteJson(getVerifyStatePath(moduleDataDir), next);
  return next;
}
function resolveRealPathWithMissingTail2(inputPath, depth = 0) {
  if (depth > MAX_SYMLINK_DEPTH2) {
    throw new Error(`Too many levels of symbolic links: ${inputPath}`);
  }
  const resolved = import_node_path16.default.resolve(inputPath);
  const missingSegments = [];
  let current = resolved;
  while (true) {
    try {
      const realBase = import_node_fs15.default.realpathSync(current);
      return missingSegments.length > 0 ? import_node_path16.default.join(realBase, ...missingSegments.reverse()) : realBase;
    } catch (err) {
      const code = err?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw err;
      }
      try {
        const lstat = import_node_fs15.default.lstatSync(current);
        if (lstat.isSymbolicLink()) {
          const linkTarget = import_node_fs15.default.readlinkSync(current);
          const resolvedLink = import_node_path16.default.resolve(import_node_path16.default.dirname(current), linkTarget);
          const nextTarget = missingSegments.length > 0 ? import_node_path16.default.join(resolvedLink, ...missingSegments.reverse()) : resolvedLink;
          return resolveRealPathWithMissingTail2(nextTarget, depth + 1);
        }
      } catch {
      }
      const parent = import_node_path16.default.dirname(current);
      if (parent === current) {
        return resolved;
      }
      missingSegments.push(import_node_path16.default.basename(current));
      current = parent;
    }
  }
}
function inspectWorkspaceFile(workspaceRoot, targetPath) {
  if (!workspaceRoot || workspaceRoot.includes("\0") || !targetPath || targetPath.includes("\0")) {
    return { inside: false };
  }
  try {
    const realRoot = resolveRealPathWithMissingTail2(workspaceRoot);
    const candidate = import_node_path16.default.isAbsolute(targetPath) ? targetPath : import_node_path16.default.resolve(workspaceRoot, targetPath);
    const realTarget = resolveRealPathWithMissingTail2(candidate);
    const rootPrefix = realRoot.endsWith(import_node_path16.default.sep) ? realRoot : `${realRoot}${import_node_path16.default.sep}`;
    if (realTarget !== realRoot && !realTarget.startsWith(rootPrefix)) {
      return { inside: false };
    }
    if (realTarget === realRoot) {
      return { inside: false };
    }
    const relPath = import_node_path16.default.relative(realRoot, realTarget).split(import_node_path16.default.sep).join("/");
    if (!relPath || relPath === "." || relPath.startsWith("../")) {
      return { inside: false };
    }
    let exists = false;
    let isFile = false;
    let isEmpty = false;
    try {
      const stat = import_node_fs15.default.statSync(realTarget);
      exists = true;
      isFile = stat.isFile();
      isEmpty = isFile && stat.size === 0;
    } catch {
      exists = false;
    }
    return {
      inside: true,
      realRoot,
      realTarget,
      relPath,
      exists,
      isFile,
      isEmpty
    };
  } catch {
    return { inside: false };
  }
}
function scanEmptyWorkspaceFiles(workspaceRoot, filePaths) {
  if (!workspaceRoot) return [];
  const empty = [];
  const seen = /* @__PURE__ */ new Set();
  for (const rel of filePaths) {
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    const check = inspectWorkspaceFile(workspaceRoot, rel);
    if (check.inside && check.exists && check.isFile && check.isEmpty && check.relPath) {
      empty.push(check.relPath);
    }
  }
  return empty;
}
function truncateTailBytes(text, maxBytes) {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) {
    return { text, truncated: false };
  }
  const sliced = buf.subarray(buf.length - maxBytes);
  return { text: sliced.toString("utf8"), truncated: true };
}
function extractTailOutput(combinedRaw, alreadyTruncated = false) {
  const capped = truncateTailBytes(combinedRaw, MAX_CAPTURE_BYTES);
  const redacted = redactVerifyOutput(capped.text);
  let outputTail = redacted;
  let outputTruncated = alreadyTruncated || capped.truncated;
  if (outputTail.length > MAX_STORED_OUTPUT_TAIL_CHARS) {
    outputTail = outputTail.slice(outputTail.length - MAX_STORED_OUTPUT_TAIL_CHARS);
    outputTruncated = true;
  }
  outputTail = redactVerifyOutput(outputTail).trim();
  return { outputTail, outputTruncated };
}
function executeVerifyCommand(command, workspaceRoot, options = {}) {
  const validation = validateVerifyCommand(command);
  const startedAt = Date.now();
  if (!validation.valid || !validation.command) {
    return Promise.resolve({
      commandId: command.id,
      label: command.label,
      executable: command.executable,
      args: [...command.args],
      passed: false,
      exitCode: null,
      timedOut: false,
      durationMs: 0,
      outputTail: "",
      outputTruncated: false,
      error: validation.error ?? "Command rejected by verify allowlist."
    });
  }
  const safeCmd = validation.command;
  const effectiveTimeoutMs = Math.max(
    MIN_COMMAND_TIMEOUT_MS,
    Math.min(
      safeCmd.timeoutMs,
      options.timeoutCapMs !== void 0 ? Math.max(MIN_COMMAND_TIMEOUT_MS, Math.floor(options.timeoutCapMs)) : MAX_COMMAND_TIMEOUT_MS
    )
  );
  let resolvedCwd;
  try {
    resolvedCwd = import_node_fs15.default.realpathSync(import_node_path16.default.resolve(workspaceRoot));
    if (!import_node_fs15.default.statSync(resolvedCwd).isDirectory()) {
      throw new Error("Workspace root is not a directory.");
    }
  } catch (err) {
    return Promise.resolve({
      commandId: safeCmd.id,
      label: safeCmd.label,
      executable: safeCmd.executable,
      args: [...safeCmd.args],
      passed: false,
      exitCode: null,
      timedOut: false,
      durationMs: Date.now() - startedAt,
      outputTail: "",
      outputTruncated: false,
      error: redactVerifyOutput(err instanceof Error ? err.message : String(err))
    });
  }
  return new Promise((resolve) => {
    const isPosix = process.platform !== "win32";
    let settled = false;
    let timedOut = false;
    let streamTruncated = false;
    let bufferedBytes = 0;
    const chunks = [];
    let killTimer = null;
    let hardKillTimer = null;
    const cleanupTimers = () => {
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      if (hardKillTimer) {
        clearTimeout(hardKillTimer);
        hardKillTimer = null;
      }
    };
    const pushChunk = (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
      if (buf.length === 0) return;
      if (buf.length >= MAX_CAPTURE_BYTES) {
        const tailCopy = Buffer.from(buf.subarray(buf.length - MAX_CAPTURE_BYTES));
        chunks.length = 0;
        chunks.push(tailCopy);
        bufferedBytes = tailCopy.length;
        streamTruncated = true;
        return;
      }
      chunks.push(buf);
      bufferedBytes += buf.length;
      if (bufferedBytes > MAX_CAPTURE_BYTES * 2) {
        const merged = Buffer.concat(chunks, bufferedBytes);
        const tailCopy = Buffer.from(merged.subarray(merged.length - MAX_CAPTURE_BYTES));
        chunks.length = 0;
        chunks.push(tailCopy);
        bufferedBytes = tailCopy.length;
        streamTruncated = true;
      }
    };
    const buildOutput = () => {
      const merged = chunks.length > 0 ? Buffer.concat(chunks, bufferedBytes) : Buffer.alloc(0);
      return extractTailOutput(merged.toString("utf8"), streamTruncated);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      resolve(result);
    };
    let child;
    try {
      child = (0, import_node_child_process2.spawn)(safeCmd.executable, safeCmd.args, {
        cwd: resolvedCwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        detached: isPosix
      });
    } catch (err) {
      finish({
        commandId: safeCmd.id,
        label: safeCmd.label,
        executable: safeCmd.executable,
        args: [...safeCmd.args],
        passed: false,
        exitCode: null,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        outputTail: "",
        outputTruncated: false,
        error: redactVerifyOutput(err instanceof Error ? err.message : String(err))
      });
      return;
    }
    const killProcessTree = (signal) => {
      if (isPosix && typeof child.pid === "number" && child.pid > 0) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
        }
      }
      try {
        child.kill(signal);
      } catch {
      }
    };
    const destroyPipes = () => {
      try {
        child.stdout?.destroy();
      } catch {
      }
      try {
        child.stderr?.destroy();
      } catch {
      }
    };
    child.stdout?.on("data", pushChunk);
    child.stderr?.on("data", pushChunk);
    child.stdout?.on("error", () => {
    });
    child.stderr?.on("error", () => {
    });
    child.on("error", (err) => {
      const durationMs = Date.now() - startedAt;
      const { outputTail, outputTruncated } = buildOutput();
      finish({
        commandId: safeCmd.id,
        label: safeCmd.label,
        executable: safeCmd.executable,
        args: [...safeCmd.args],
        passed: false,
        exitCode: null,
        timedOut,
        durationMs,
        outputTail,
        outputTruncated,
        error: redactVerifyOutput(err instanceof Error ? err.message : String(err))
      });
    });
    child.on("close", (code, signal) => {
      const durationMs = Date.now() - startedAt;
      const { outputTail, outputTruncated } = buildOutput();
      const exitCode = typeof code === "number" ? code : null;
      if (!timedOut && exitCode === 0) {
        finish({
          commandId: safeCmd.id,
          label: safeCmd.label,
          executable: safeCmd.executable,
          args: [...safeCmd.args],
          passed: true,
          exitCode: 0,
          timedOut: false,
          durationMs,
          outputTail,
          outputTruncated
        });
        return;
      }
      const errMessage = timedOut ? `Command timed out after ${effectiveTimeoutMs}ms` : signal ? `Command terminated by signal ${signal}` : `Command exited with code ${exitCode ?? "unknown"}`;
      finish({
        commandId: safeCmd.id,
        label: safeCmd.label,
        executable: safeCmd.executable,
        args: [...safeCmd.args],
        passed: false,
        exitCode,
        timedOut,
        durationMs,
        outputTail,
        outputTruncated,
        error: errMessage
      });
    });
    killTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      killProcessTree("SIGTERM");
      hardKillTimer = setTimeout(() => {
        if (settled) return;
        killProcessTree("SIGKILL");
        destroyPipes();
        try {
          child.unref();
        } catch {
        }
        const durationMs = Date.now() - startedAt;
        const { outputTail, outputTruncated } = buildOutput();
        finish({
          commandId: safeCmd.id,
          label: safeCmd.label,
          executable: safeCmd.executable,
          args: [...safeCmd.args],
          passed: false,
          exitCode: null,
          timedOut: true,
          durationMs,
          outputTail,
          outputTruncated,
          error: `Command timed out after ${effectiveTimeoutMs}ms`
        });
      }, 300);
      hardKillTimer.unref?.();
    }, effectiveTimeoutMs);
    killTimer.unref?.();
  });
}
async function runVerifyCommands(commands, workspaceRoot, options = {}) {
  const startedAt = Date.now();
  const results = [];
  const totalBudgetMs = options.totalBudgetMs;
  for (const cmd of commands) {
    let timeoutCapMs = options.singleTimeoutCapMs;
    if (totalBudgetMs !== void 0) {
      const elapsed = Date.now() - startedAt;
      const remaining = totalBudgetMs - elapsed;
      if (remaining < MIN_COMMAND_TIMEOUT_MS) {
        results.push({
          commandId: cmd.id,
          label: cmd.label,
          executable: cmd.executable,
          args: [...cmd.args],
          passed: false,
          exitCode: null,
          timedOut: true,
          durationMs: 0,
          outputTail: "",
          outputTruncated: false,
          error: `Skipped: total verification time budget (${totalBudgetMs}ms) exhausted.`
        });
        continue;
      }
      timeoutCapMs = timeoutCapMs !== void 0 ? Math.min(timeoutCapMs, remaining) : remaining;
    }
    const res = await executeVerifyCommand(cmd, workspaceRoot, { timeoutCapMs });
    results.push(res);
  }
  return {
    passed: results.every((r) => r.passed),
    results,
    durationMs: Date.now() - startedAt
  };
}
function createEvidenceId(prefix = "ver") {
  return `${prefix}-${Date.now().toString(36)}-${import_node_crypto10.default.randomBytes(3).toString("hex")}`;
}
function formatFailureTailSnippet(outputTail, maxLines = 4, maxChars = 280) {
  const lines = redactVerifyOutput(outputTail).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return "";
  const tail = lines.slice(-maxLines).join(" | ");
  return tail.length > maxChars ? `\u2026${tail.slice(tail.length - (maxChars - 1))}` : tail;
}
function appendEvidenceToState(state, record) {
  state.evidence.unshift(record);
  if (state.evidence.length > MAX_STORED_EVIDENCE) {
    state.evidence = state.evidence.slice(0, MAX_STORED_EVIDENCE);
  }
  state.updatedAt = record.timestamp;
}
var MAX_DETECT_FILE_BYTES = 256 * 1024;

// src/modules/verify/hook.ts
var TRACKED_VERIFY_WRITE_TOOLS = /* @__PURE__ */ new Set([
  "write_file",
  "edit_file",
  "write_to_file",
  "create_file",
  "apply_patch",
  "patch_file",
  "replace_file_content",
  "multi_replace_file_content"
]);
var GUARDRAIL_ALLOW_REASON = "Reached maxConsecutiveBlocks guardrail; allowing stop.";
var SINGLE_PATH_KEYS = [
  "Path",
  "path",
  "TargetFile",
  "targetFile",
  "target_file",
  "TargetPath",
  "targetPath",
  "target_path",
  "AbsolutePath",
  "absolutePath",
  "absolute_path",
  "filePath",
  "file_path",
  "FilePath"
];
var PATCH_TEXT_KEYS = ["patch", "Patch", "diff", "Diff", "input", "Input"];
function normalizeToolName2(rawName) {
  if (!rawName) return "";
  const trimmed = rawName.trim().toLowerCase();
  const sepIdx = Math.max(trimmed.lastIndexOf(":"), trimmed.lastIndexOf("/"));
  return sepIdx >= 0 ? trimmed.slice(sepIdx + 1) : trimmed;
}
function deriveVerifyConversationId(payload) {
  if (payload.conversationId && payload.conversationId.trim()) {
    return payload.conversationId.trim().slice(0, 120);
  }
  const seed = payload.workspaceRoot ?? payload.workspacePaths[0] ?? payload.cwd;
  if (seed) {
    const hash = import_node_crypto11.default.createHash("sha256").update(seed).digest("hex").slice(0, 10);
    return `ws-${hash}`;
  }
  return "default-session";
}
function extractPatchPaths(patchText) {
  const paths = [];
  const lines = patchText.split(/\r?\n/);
  for (const line of lines) {
    const applyMatch = /^\*\*\*\s+(?:Add File|Update File|Move to):\s*(.+)$/.exec(line);
    if (applyMatch?.[1]) {
      const candidate = applyMatch[1].trim();
      if (candidate) paths.push(candidate);
      continue;
    }
    const diffMatch = /^\+\+\+\s+(?:b\/)?([^\t\r\n]+)/.exec(line);
    if (diffMatch?.[1]) {
      const candidate = diffMatch[1].trim();
      if (candidate && candidate !== "/dev/null") {
        paths.push(candidate);
      }
    }
  }
  return paths;
}
function extractVerifyTargetPaths(toolInput) {
  if (!toolInput) return [];
  const found = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (val) => {
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        found.push(trimmed);
      }
    }
  };
  for (const key of SINGLE_PATH_KEYS) {
    add(toolInput[key]);
  }
  for (const listKey of ["files", "paths", "Files", "Paths"]) {
    const arr = toolInput[listKey];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        add(item);
      }
    }
  }
  if (found.length === 0) {
    for (const patchKey of PATCH_TEXT_KEYS) {
      const val = toolInput[patchKey];
      if (typeof val === "string" && val.trim()) {
        for (const p of extractPatchPaths(val)) {
          add(p);
        }
      }
    }
  }
  return found;
}
function handleVerifyPostToolHook(payload, rootDataDir) {
  try {
    if (payload.event !== "PostToolUse") {
      return;
    }
    const toolName = normalizeToolName2(payload.toolName);
    if (!TRACKED_VERIFY_WRITE_TOOLS.has(toolName)) {
      return;
    }
    const workspaceRoot = payload.workspaceRoot ?? payload.workspacePaths[0] ?? payload.cwd;
    if (!workspaceRoot) {
      return;
    }
    const rawPaths = extractVerifyTargetPaths(payload.toolInput);
    if (rawPaths.length === 0) {
      return;
    }
    const validChecks = rawPaths.map((p) => inspectWorkspaceFile(workspaceRoot, p)).filter((check) => check.inside && Boolean(check.relPath));
    if (validChecks.length === 0) {
      return;
    }
    const resolvedRoot = resolveNovDataDir(rootDataDir);
    const moduleDataDir = getModuleDataDir(resolvedRoot, "verify");
    const state = loadVerifyStateReadOnly(moduleDataDir);
    const conversationId = deriveVerifyConversationId(payload);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const existing = state.sessions[conversationId];
    const dirtySet = new Set(existing?.dirtyFiles ?? []);
    const emptySet = new Set(existing?.emptyFiles ?? []);
    let resolvedWorkspaceRoot = existing?.workspaceRoot;
    for (const check of validChecks) {
      if (!check.relPath) continue;
      if (check.realRoot) resolvedWorkspaceRoot = check.realRoot;
      dirtySet.add(check.relPath);
      if (check.exists && check.isFile && check.isEmpty) {
        emptySet.add(check.relPath);
      } else {
        emptySet.delete(check.relPath);
      }
    }
    const lastVerifiedMs = existing?.lastVerifiedAt ? Date.parse(existing.lastVerifiedAt) : Number.NaN;
    const editIso = Number.isFinite(lastVerifiedMs) && Date.parse(nowIso) <= lastVerifiedMs ? new Date(lastVerifiedMs + 1).toISOString() : nowIso;
    const nextSession = {
      conversationId,
      workspaceRoot: resolvedWorkspaceRoot ?? workspaceRoot,
      dirtyFiles: [...dirtySet],
      emptyFiles: [...emptySet],
      lastEditAt: editIso,
      lastVerifiedAt: existing?.lastVerifiedAt,
      lastVerifiedPassed: false,
      consecutiveBlocks: existing?.consecutiveBlocks ?? 0,
      totalBlocks: existing?.totalBlocks ?? 0,
      lastGuardrailReleaseAt: existing?.lastGuardrailReleaseAt,
      updatedAt: editIso
    };
    state.sessions[conversationId] = nextSession;
    saveVerifyState(moduleDataDir, state);
  } catch {
  }
}
async function handleVerifyStopHook(payload, rootDataDir) {
  try {
    if (payload.event !== "Stop") {
      return { decision: "allow" };
    }
    const resolvedRoot = resolveNovDataDir(rootDataDir);
    const moduleDataDir = getModuleDataDir(resolvedRoot, "verify");
    const state = loadVerifyStateReadOnly(moduleDataDir);
    if (!state.policy.enforceOnStop) {
      return { decision: "allow" };
    }
    const conversationId = deriveVerifyConversationId(payload);
    const session = state.sessions[conversationId];
    if (!session || session.dirtyFiles.length === 0 && session.emptyFiles.length === 0) {
      return { decision: "allow" };
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const workspaceRoot = payload.workspaceRoot ?? payload.workspacePaths[0] ?? payload.cwd ?? session.workspaceRoot;
    if (session.consecutiveBlocks >= state.policy.maxConsecutiveBlocks) {
      const snapshotDirty = [...session.dirtyFiles];
      const snapshotEmpty = scanEmptyWorkspaceFiles(workspaceRoot, [
        ...session.dirtyFiles,
        ...session.emptyFiles
      ]);
      const continuationNote = payload.continuationActive === true ? " (continuationActive=true)" : "";
      const record = {
        id: createEvidenceId("ver"),
        conversationId,
        trigger: "stop-hook",
        outcome: "guardrail-allow",
        passed: false,
        timestamp: nowIso,
        durationMs: 0,
        dirtyFiles: snapshotDirty,
        emptyFiles: snapshotEmpty,
        results: [],
        summary: `${GUARDRAIL_ALLOW_REASON}${continuationNote} consecutiveBlocks=${session.consecutiveBlocks}/${state.policy.maxConsecutiveBlocks}.`,
        reason: GUARDRAIL_ALLOW_REASON
      };
      session.dirtyFiles = [];
      session.emptyFiles = [];
      session.consecutiveBlocks = 0;
      session.lastVerifiedPassed = false;
      session.lastGuardrailReleaseAt = nowIso;
      session.updatedAt = nowIso;
      appendEvidenceToState(state, record);
      saveVerifyState(moduleDataDir, state);
      return {
        decision: "allow",
        reason: GUARDRAIL_ALLOW_REASON
      };
    }
    const currentEmptyFiles = scanEmptyWorkspaceFiles(workspaceRoot, [
      ...session.dirtyFiles,
      ...session.emptyFiles
    ]);
    session.emptyFiles = currentEmptyFiles;
    if (state.policy.blockEmptyWrites && currentEmptyFiles.length > 0) {
      session.consecutiveBlocks += 1;
      session.totalBlocks += 1;
      session.lastVerifiedPassed = false;
      session.updatedAt = nowIso;
      state.blockedStops += 1;
      const fileList = currentEmptyFiles.slice(0, 5).join(", ");
      const extra = currentEmptyFiles.length > 5 ? ` (+${currentEmptyFiles.length - 5} more)` : "";
      const reason = `[agy-NOV Verify Gate] Blocked stop: detected ${currentEmptyFiles.length} empty (0-byte) modified file(s): ${fileList}${extra}. Write valid content or remove empty files before finishing.`;
      const record = {
        id: createEvidenceId("ver"),
        conversationId,
        trigger: "stop-hook",
        outcome: "blocked",
        passed: false,
        timestamp: nowIso,
        durationMs: 0,
        dirtyFiles: [...session.dirtyFiles],
        emptyFiles: [...currentEmptyFiles],
        results: [],
        summary: `Blocked stop due to ${currentEmptyFiles.length} empty modified file(s).`,
        reason
      };
      appendEvidenceToState(state, record);
      saveVerifyState(moduleDataDir, state);
      return { decision: "deny", reason };
    }
    const enabledCommands = state.policy.commands.filter((c) => c.enabled);
    let commandResults = [];
    let runDurationMs = 0;
    let targetState = state;
    let targetSession = session;
    let effectiveNowIso = nowIso;
    let concurrentEditOccurred = false;
    const preRunDirtyFiles = [...session.dirtyFiles];
    if (state.policy.autoRunOnStop && enabledCommands.length > 0) {
      if (!workspaceRoot) {
        return { decision: "allow" };
      }
      const preRunLastEditAt = session.lastEditAt;
      const preRunWorkspaceRoot = session.workspaceRoot;
      const preRunConsecutiveBlocks = session.consecutiveBlocks;
      const preRunTotalBlocks = session.totalBlocks;
      const preRunLastGuardrailReleaseAt = session.lastGuardrailReleaseAt;
      const runOut = await runVerifyCommands(enabledCommands, workspaceRoot, {
        singleTimeoutCapMs: STOP_HOOK_SINGLE_TIMEOUT_MS,
        totalBudgetMs: STOP_HOOK_TOTAL_BUDGET_MS
      });
      commandResults = runOut.results;
      runDurationMs = runOut.durationMs;
      effectiveNowIso = (/* @__PURE__ */ new Date()).toISOString();
      targetState = loadVerifyStateReadOnly(moduleDataDir);
      targetSession = targetState.sessions[conversationId] ?? {
        conversationId,
        workspaceRoot: preRunWorkspaceRoot ?? workspaceRoot,
        dirtyFiles: [...preRunDirtyFiles],
        emptyFiles: [...currentEmptyFiles],
        lastEditAt: preRunLastEditAt,
        consecutiveBlocks: preRunConsecutiveBlocks,
        totalBlocks: preRunTotalBlocks,
        lastGuardrailReleaseAt: preRunLastGuardrailReleaseAt,
        updatedAt: effectiveNowIso
      };
      targetState.sessions[conversationId] = targetSession;
      concurrentEditOccurred = targetSession.lastEditAt !== preRunLastEditAt;
      if (!runOut.passed) {
        const failed = runOut.results.filter((r) => !r.passed);
        const mergedDirtyFiles = [.../* @__PURE__ */ new Set([...preRunDirtyFiles, ...targetSession.dirtyFiles])];
        const mergedEmptyFiles = scanEmptyWorkspaceFiles(workspaceRoot, [
          ...mergedDirtyFiles,
          ...targetSession.emptyFiles,
          ...currentEmptyFiles
        ]);
        targetSession.dirtyFiles = mergedDirtyFiles;
        targetSession.emptyFiles = mergedEmptyFiles;
        targetSession.consecutiveBlocks += 1;
        targetSession.totalBlocks += 1;
        targetSession.lastVerifiedAt = effectiveNowIso;
        targetSession.lastVerifiedPassed = false;
        targetSession.updatedAt = effectiveNowIso;
        targetState.blockedStops += 1;
        const failureDetails = failed.slice(0, 3).map((item) => {
          const statusText = item.timedOut ? "timed out" : `exit=${item.exitCode !== null ? item.exitCode : "error"}`;
          const tail = formatFailureTailSnippet(
            item.outputTail.trim() || item.error || "",
            3,
            220
          );
          return tail ? `${item.label} [${item.commandId}] (${statusText}): ${tail}` : `${item.label} [${item.commandId}] (${statusText})`;
        }).join("; ");
        const reason = redactVerifyOutput(
          `[agy-NOV Verify Gate] Blocked stop: ${failed.length}/${runOut.results.length} check(s) failed \u2014 ${failureDetails}. Fix the failing check(s) before finishing.`
        );
        const record = {
          id: createEvidenceId("ver"),
          conversationId,
          trigger: "stop-hook",
          outcome: "blocked",
          passed: false,
          timestamp: effectiveNowIso,
          durationMs: runDurationMs,
          dirtyFiles: [...mergedDirtyFiles],
          emptyFiles: [...mergedEmptyFiles],
          results: commandResults,
          summary: `Blocked stop: ${failed.length}/${runOut.results.length} verification check(s) failed.`,
          reason
        };
        appendEvidenceToState(targetState, record);
        saveVerifyState(moduleDataDir, targetState);
        return { decision: "deny", reason };
      }
    } else if (!state.policy.autoRunOnStop && session.dirtyFiles.length > 0) {
      const lastEditMs = session.lastEditAt ? Date.parse(session.lastEditAt) : Number.POSITIVE_INFINITY;
      const lastVerifiedMs = session.lastVerifiedAt ? Date.parse(session.lastVerifiedAt) : Number.NEGATIVE_INFINITY;
      const unverified = !session.lastVerifiedAt || !Number.isFinite(lastVerifiedMs) || Number.isFinite(lastEditMs) && lastVerifiedMs < lastEditMs || session.lastVerifiedPassed === false;
      if (unverified) {
        session.consecutiveBlocks += 1;
        session.totalBlocks += 1;
        session.updatedAt = nowIso;
        state.blockedStops += 1;
        const fileList = session.dirtyFiles.slice(0, 5).join(", ");
        const extra = session.dirtyFiles.length > 5 ? ` (+${session.dirtyFiles.length - 5} more)` : "";
        const reason = `[agy-NOV Verify Gate] Blocked stop: ${session.dirtyFiles.length} modified file(s) (${fileList}${extra}) have not been verified since the last edit. Run verify_run_checks and ensure checks pass before finishing.`;
        const record = {
          id: createEvidenceId("ver"),
          conversationId,
          trigger: "stop-hook",
          outcome: "blocked",
          passed: false,
          timestamp: nowIso,
          durationMs: 0,
          dirtyFiles: [...session.dirtyFiles],
          emptyFiles: [...currentEmptyFiles],
          results: [],
          summary: `Blocked stop: ${session.dirtyFiles.length} modified file(s) unverified (autoRunOnStop=false).`,
          reason
        };
        appendEvidenceToState(state, record);
        saveVerifyState(moduleDataDir, state);
        return { decision: "deny", reason };
      }
    }
    const verifiedDirtyFiles = [...preRunDirtyFiles];
    if (concurrentEditOccurred) {
      targetSession.consecutiveBlocks = 0;
      targetSession.lastVerifiedPassed = false;
    } else {
      targetSession.dirtyFiles = [];
      targetSession.emptyFiles = [];
      targetSession.consecutiveBlocks = 0;
      targetSession.lastVerifiedAt = effectiveNowIso;
      targetSession.lastVerifiedPassed = true;
      targetSession.updatedAt = effectiveNowIso;
    }
    const summary = commandResults.length > 0 ? `All ${commandResults.length} verification check(s) passed on Stop in ${runDurationMs}ms.` : `Verified ${verifiedDirtyFiles.length} modified file(s) with no empty writes; Stop allowed.`;
    const passRecord = {
      id: createEvidenceId("ver"),
      conversationId,
      trigger: "stop-hook",
      outcome: "pass",
      passed: true,
      timestamp: effectiveNowIso,
      durationMs: runDurationMs,
      dirtyFiles: verifiedDirtyFiles,
      emptyFiles: [],
      results: commandResults,
      summary
    };
    appendEvidenceToState(targetState, passRecord);
    saveVerifyState(moduleDataDir, targetState);
    return { decision: "allow" };
  } catch {
    return { decision: "allow" };
  }
}

// src/modules/xray/hook.ts
var import_node_crypto12 = __toESM(require("node:crypto"), 1);
var import_node_fs16 = __toESM(require("node:fs"), 1);
var import_node_path17 = __toESM(require("node:path"), 1);
function formatErrorValue2(err) {
  if (err === void 0 || err === null || err === "") return void 0;
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
function handleXrayHook(payload, rootDataDir) {
  const moduleDataDir = getModuleDataDir(rootDataDir, "xray");
  const event = payload.event;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    ensurePrivateDir(moduleDataDir);
    const statePath = import_node_path17.default.join(moduleDataDir, "live-state.json");
    let state = { recentEvents: [] };
    if (import_node_fs16.default.existsSync(statePath)) {
      try {
        const parsed = JSON.parse(import_node_fs16.default.readFileSync(statePath, "utf8"));
        state = {
          ...parsed,
          recentEvents: Array.isArray(parsed.recentEvents) ? parsed.recentEvents : []
        };
      } catch {
        state = { recentEvents: [] };
      }
    }
    if (payload.conversationId) state.activeConversationId = payload.conversationId;
    if (payload.transcriptPath) state.activeTranscriptPath = payload.transcriptPath;
    if (payload.workspacePaths.length > 0) state.activeWorkspacePaths = payload.workspacePaths;
    if (payload.toolName) state.lastToolName = payload.toolName;
    state.lastEvent = event;
    state.updatedAt = now;
    state.recentEvents.push({
      event,
      conversationId: payload.conversationId ?? "unknown",
      toolName: payload.toolName,
      stepIdx: payload.stepIdx,
      timestamp: now,
      error: formatErrorValue2(payload.error)
    });
    if (state.recentEvents.length > 50) {
      state.recentEvents = state.recentEvents.slice(-50);
    }
    const tmpPath = `${statePath}.${process.pid}.${import_node_crypto12.default.randomBytes(4).toString("hex")}.tmp`;
    import_node_fs16.default.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}
`, { encoding: "utf8", mode: 384 });
    import_node_fs16.default.renameSync(tmpPath, statePath);
  } catch {
  }
}

// src/hooks/dispatcher.ts
var PRE_INVOCATION_GUARD_WINDOW_MS = 5 * 60 * 1e3;
var MAX_PRE_INVOCATION_FILE_BYTES = 2 * 1024 * 1024;
function readJsonStrictReadOnly(rootDataDir, moduleId, fileName) {
  try {
    const rootStat = import_node_fs17.default.lstatSync(rootDataDir);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return null;
    const modulesRoot = import_node_path18.default.join(rootDataDir, "modules");
    const modsStat = import_node_fs17.default.lstatSync(modulesRoot);
    if (modsStat.isSymbolicLink() || !modsStat.isDirectory()) return null;
    const modDir = getModuleDataDir(rootDataDir, moduleId);
    const modStat = import_node_fs17.default.lstatSync(modDir);
    if (modStat.isSymbolicLink() || !modStat.isDirectory()) return null;
    const filePath = import_node_path18.default.join(modDir, fileName);
    const fileStat = import_node_fs17.default.lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile() || fileStat.size > MAX_PRE_INVOCATION_FILE_BYTES) {
      return null;
    }
    return JSON.parse(import_node_fs17.default.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
function stripBidiAndZeroWidth(input) {
  return input.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "");
}
function escapeMarkdownInline(input) {
  return stripBidiAndZeroWidth(input).replace(/([\\`*_~[\]()!<>|#])/g, "\\$1");
}
function sanitizeInlineCodeToken(input) {
  const cleaned = stripBidiAndZeroWidth(input).replace(/[`\r\n]/g, "").replace(/[^A-Za-z0-9._:/ -]/g, "_").trim();
  return cleaned || "tool";
}
function buildPreInvocationReceiptLines(rootDataDir, config) {
  const { modules } = config;
  const lines = [];
  if (modules.spec) {
    const raw = readJsonStrictReadOnly(rootDataDir, "spec", "state.json");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const state = raw;
      const activeId = typeof state.activeSpecId === "string" ? state.activeSpecId : null;
      let activeSpec = null;
      if (activeId && Array.isArray(state.specs)) {
        for (const item of state.specs) {
          if (item && typeof item === "object" && !Array.isArray(item) && item.id === activeId) {
            activeSpec = item;
            break;
          }
        }
      } else if (activeId && state.specs && typeof state.specs === "object" && !Array.isArray(state.specs)) {
        const candidate = state.specs[activeId];
        if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
          activeSpec = candidate;
        }
      }
      if (activeSpec && activeSpec.status === "draft" && activeSpec.enforcePlanBeforeWrite === true) {
        const rawTitle = typeof activeSpec.title === "string" && activeSpec.title.trim() ? activeSpec.title : activeId ?? "Active Spec";
        const safeTitle = escapeMarkdownInline(redactFeedText(rawTitle, 80));
        lines.push(`\u{1F512} **Spec Write Lock**: "${safeTitle}" is in DRAFT \u2014 approve before editing files.`);
      }
    }
  }
  if (modules.mem) {
    const raw = readJsonStrictReadOnly(rootDataDir, "mem", "memories.json");
    const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray(raw.memories) ? raw.memories : raw && typeof raw === "object" && Array.isArray(raw.items) ? raw.items : [];
    let staleCount = 0;
    for (const item of list) {
      if (item && typeof item === "object" && !Array.isArray(item) && isMemoryRecordStale(item)) {
        staleCount += 1;
      }
    }
    if (staleCount > 0) {
      lines.push(`\u{1F9E0} **Memory Drift**: ${staleCount} anchored memory item(s) marked stale/drifted \u2014 review or re-verify anchors.`);
    }
  }
  if (modules.guard) {
    const raw = readJsonStrictReadOnly(rootDataDir, "guard", "audit.json");
    const events = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray(raw.events) ? raw.events : [];
    const nowMs = Date.now();
    let newestTs = -Infinity;
    let newestDeny = null;
    for (const item of events) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const rec = item;
      const decision = String(rec.decision ?? "").trim().toLowerCase();
      if (decision !== "deny") continue;
      const tsMs = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : Number.NaN;
      if (!Number.isFinite(tsMs)) continue;
      const ageMs = nowMs - tsMs;
      if (ageMs > PRE_INVOCATION_GUARD_WINDOW_MS || ageMs < -6e4) continue;
      if (tsMs > newestTs) {
        newestTs = tsMs;
        newestDeny = {
          toolName: sanitizeInlineCodeToken(redactFeedText(String(rec.toolName ?? rec.tool_name ?? "tool"), 48)),
          reason: escapeMarkdownInline(
            redactFeedText(String(rec.reason ?? rec.summary ?? "blocked by Guard policy"), 120) || "blocked by Guard policy"
          )
        };
      }
    }
    if (newestDeny) {
      lines.push(`\u{1F6E1}\uFE0F **Guard Blocked**: \`${newestDeny.toolName}\` was denied recently \u2014 ${newestDeny.reason}`);
    }
  }
  return lines;
}
function refreshFeedSnapshotBestEffort(rootDataDir, config) {
  try {
    writeFeedSnapshotIfDataDirExists(rootDataDir, config);
  } catch {
  }
}
async function dispatchNovHook(rawInput, fallbackEvent, cliDataDir, overrides) {
  const payload = normalizeHookPayload(rawInput, fallbackEvent);
  const rootDataDir = resolveNovDataDir(sanitizeDataDirCandidate(cliDataDir) ?? payload.pluginData);
  const config = loadNovConfigReadOnly(rootDataDir);
  const { modules } = config;
  if (payload.event === "SessionStart") {
    if (!modules.mem && !modules.turbo && !modules.spec) return {};
    const injectSteps = [];
    if (modules.turbo) {
      try {
        const turboOut = handleTurboSessionStartHook(payload, rootDataDir);
        if (turboOut && Array.isArray(turboOut.injectSteps) && turboOut.injectSteps.length > 0) {
          injectSteps.push(...turboOut.injectSteps);
        }
      } catch {
      }
    }
    if (modules.spec) {
      try {
        const specOut = handleSpecSessionStartHook(payload, rootDataDir);
        if (specOut && Array.isArray(specOut.injectSteps) && specOut.injectSteps.length > 0) {
          injectSteps.push(...specOut.injectSteps);
        }
      } catch {
      }
    }
    if (modules.mem) {
      try {
        const memOut = handleMemSessionStartHook(payload, rootDataDir);
        if (memOut && Array.isArray(memOut.injectSteps) && memOut.injectSteps.length > 0) {
          injectSteps.push(...memOut.injectSteps);
        }
      } catch {
      }
    }
    return injectSteps.length > 0 ? { injectSteps } : {};
  }
  if (payload.event === "PreInvocation") {
    if (!modules.spec && !modules.mem && !modules.guard) {
      return {};
    }
    try {
      const lines = buildPreInvocationReceiptLines(rootDataDir, config);
      if (lines.length === 0) {
        return {};
      }
      return {
        injectSteps: [
          {
            systemMessage: {
              systemMessage: "",
              metadata: {
                user_markdown: lines.join("\n")
              }
            }
          }
        ]
      };
    } catch {
      return {};
    }
  }
  if (payload.event === "PreToolUse") {
    if (!modules.guard && !modules.spec && !modules.remote && !modules.radar && !modules.turbo) {
      return {};
    }
    if (modules.radar) {
      try {
        handleRadarHook(payload, rootDataDir);
      } catch {
      }
    }
    let finalDecision;
    const reasons = [];
    if (modules.guard) {
      try {
        const guardRunner = overrides?.guardPreTool ?? handleGuardPreToolHook;
        const guardRes = guardRunner(payload, rootDataDir);
        const guardDecision = guardRes?.decision;
        if (guardDecision === "deny") {
          return { decision: "deny", reason: guardRes?.reason };
        }
        if (guardDecision === "force_ask") {
          finalDecision = "force_ask";
          if (guardRes?.reason) reasons.push(guardRes.reason);
        } else if (guardDecision === "ask") {
          if (finalDecision !== "force_ask") {
            finalDecision = "ask";
          }
          if (guardRes?.reason) reasons.push(guardRes.reason);
        } else if (guardDecision === "allow") {
          finalDecision = "allow";
        }
      } catch {
      }
    }
    if (modules.spec) {
      try {
        const specRes = handleSpecPreToolHook(payload, rootDataDir);
        if (specRes.decision === "deny") {
          return { decision: "deny", reason: specRes.reason };
        }
      } catch {
      }
    }
    if (modules.remote) {
      try {
        const remoteRunner = overrides?.remotePreTool ?? handleRemotePreToolHook;
        const remoteRes = await remoteRunner(payload, rootDataDir);
        const remoteDecision = remoteRes?.decision;
        if (remoteDecision === "deny") {
          return { decision: "deny", reason: remoteRes?.reason };
        }
        if (remoteDecision === "force_ask") {
          finalDecision = "force_ask";
          if (remoteRes?.reason) reasons.push(remoteRes.reason);
        } else if (remoteDecision === "ask") {
          if (finalDecision !== "force_ask") {
            finalDecision = "ask";
          }
          if (remoteRes?.reason) reasons.push(remoteRes.reason);
        } else if (remoteDecision === "allow" && !finalDecision) {
          finalDecision = "allow";
        }
      } catch {
      }
    }
    if (finalDecision === "force_ask") {
      return {
        decision: "force_ask",
        reason: reasons.join(" | ") || "Mandatory approval required by agy-NOV Guard"
      };
    }
    if (finalDecision === "ask") {
      return { decision: "ask", reason: reasons.join(" | ") || "Approval required by agy-NOV" };
    }
    if (modules.turbo) {
      try {
        const turboRes = handleTurboPreToolHook(payload, rootDataDir, overrides?.turboCliEntryPath);
        if (turboRes.overwrite && Object.keys(turboRes.overwrite).length > 0) {
          return {
            decision: "allow",
            overwrite: turboRes.overwrite
          };
        }
      } catch {
      }
    }
    if (finalDecision === "allow") {
      return { decision: "allow" };
    }
    return {};
  }
  if (payload.event === "PostToolUse") {
    if (modules.review) {
      try {
        handleReviewHook(payload, rootDataDir);
      } catch {
      }
    }
    if (modules.xray) {
      try {
        handleXrayHook(payload, rootDataDir);
      } catch {
      }
    }
    if (modules.radar) {
      try {
        handleRadarHook(payload, rootDataDir);
      } catch {
      }
    }
    if (modules.verify) {
      try {
        handleVerifyPostToolHook(payload, rootDataDir);
      } catch {
      }
    }
    if (modules.turbo) {
      try {
        handleTurboPostToolHook(payload, rootDataDir);
      } catch {
      }
    }
    refreshFeedSnapshotBestEffort(rootDataDir, config);
    return {};
  }
  if (payload.event === "Stop") {
    if (modules.review) {
      try {
        handleReviewHook(payload, rootDataDir);
      } catch {
      }
    }
    if (modules.xray) {
      try {
        handleXrayHook(payload, rootDataDir);
      } catch {
      }
    }
    if (modules.verify) {
      try {
        const verifyRes = await handleVerifyStopHook(payload, rootDataDir);
        if (verifyRes.decision === "deny") {
          refreshFeedSnapshotBestEffort(rootDataDir, config);
          return {
            decision: "deny",
            reason: verifyRes.reason || "[agy-NOV Verify Gate] Verification checks failed before stopping."
          };
        }
      } catch {
      }
    }
    if (modules.radar) {
      try {
        handleRadarHook(payload, rootDataDir);
      } catch {
      }
    }
    if (modules.mem) {
      try {
        handleMemStopHook(payload, rootDataDir);
      } catch {
      }
    }
    if (modules.remote) {
      try {
        await handleRemoteStopHook(payload, rootDataDir);
      } catch {
      }
    }
    refreshFeedSnapshotBestEffort(rootDataDir, config);
    return { decision: "allow" };
  }
  return {};
}
function readStdinText() {
  try {
    return import_node_fs17.default.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}
async function main() {
  const argv = process.argv.slice(2);
  const event = normalizeHookEvent(parseCliFlag(argv, "--event"), "PostToolUse");
  const cliDataDir = parseCliFlag(argv, "--data-dir");
  let rawInput = {};
  const text = readStdinText().trim();
  if (text) {
    try {
      rawInput = JSON.parse(text);
    } catch {
      rawInput = {};
    }
  }
  try {
    const out = await dispatchNovHook(rawInput, event, cliDataDir);
    process.stdout.write(`${JSON.stringify(out)}
`);
  } catch {
    const fallback = event === "Stop" ? { decision: "allow" } : {};
    process.stdout.write(`${JSON.stringify(fallback)}
`);
  }
}
var isMain = typeof require !== "undefined" && typeof module !== "undefined" && require.main === module || typeof process.argv[1] === "string" && (process.argv[1].endsWith("hook.cjs") || process.argv[1].endsWith("dispatcher.ts"));
if (isMain) {
  void main();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  dispatchNovHook
});
