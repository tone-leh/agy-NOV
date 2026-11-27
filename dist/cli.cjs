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
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_path4 = __toESM(require("node:path"), 1);

// src/core/config.ts
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);

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
var STARTUP_VIEW_IDS = ["hub", "last"];
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
    hooks: ["SessionStart"],
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

// src/core/team-config.ts
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var TEAM_CONFIG_FILENAME = ".agy-nov.json";
var MAX_TEAM_CONFIG_BYTES = 64 * 1024;
var MAX_TEAM_VERIFY_COMMANDS = 20;
var MAX_TEAM_VERIFY_ARGS = 24;
var MAX_TEAM_VERIFY_ARG_LENGTH = 256;
var MAX_TEAM_SPEC_TEMPLATES = 10;
var TEAM_VERIFY_ALLOWED_EXECUTABLES = /* @__PURE__ */ new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "node",
  "tsc",
  "vitest",
  "jest",
  "eslint",
  "prettier",
  "biome",
  "pytest",
  "ruff",
  "mypy",
  "python",
  "python3",
  "go",
  "cargo",
  "rustc",
  "gradle",
  "mvn",
  "dotnet",
  "git"
]);
var FORBIDDEN_SHELL_EXECUTABLES = /* @__PURE__ */ new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "ksh",
  "csh",
  "tcsh",
  "ash",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "wsl",
  "wsl.exe"
]);
var PROTO_POLLUTION_KEYS = /* @__PURE__ */ new Set([
  "__proto__",
  "constructor",
  "prototype"
]);
var ALLOWED_TOP_LEVEL_KEYS = /* @__PURE__ */ new Set([
  "schemaVersion",
  "preset",
  "enableModules",
  "verifyCommands",
  "specTemplates"
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
  "eslint",
  "prettier",
  "biome",
  "pytest",
  "ruff",
  "mypy"
]);
var SAFE_SCRIPT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/;
var FORBIDDEN_SCRIPT_NAMES = /* @__PURE__ */ new Set([
  "exec",
  "x",
  "dlx",
  "eval",
  "init",
  "create",
  "explore"
]);
var FORBIDDEN_PM_ARG_TOKENS = /* @__PURE__ */ new Set([
  "exec",
  "x",
  "dlx",
  "eval",
  "init",
  "create",
  "explore",
  "install",
  "i",
  "add",
  "config",
  "publish",
  "set",
  "login",
  "adduser",
  "link"
]);
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
  "--experimental-loader",
  "--eval",
  "--print"
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
var FORBIDDEN_GO_FLAGS = /* @__PURE__ */ new Set([
  "exec",
  "toolexec",
  "vettool",
  "overlay",
  "modfile",
  "ldflags",
  "gcflags",
  "asmflags",
  "gccgoflags",
  "pkgdir",
  "o",
  "c"
]);
var ALLOWED_GIT_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "status",
  "diff",
  "rev-parse",
  "check-ignore"
]);
var FORBIDDEN_GIT_FLAGS = /* @__PURE__ */ new Set([
  "-c",
  "--config",
  "--config-env",
  "--output",
  "--ext-diff",
  "--no-index",
  "--textconv",
  "--git-dir",
  "--work-tree",
  "--upload-pack",
  "--receive-pack",
  "--exec",
  "--exec-path",
  "--extcmd",
  "--pager",
  "--tool"
]);
var ALLOWED_CARGO_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "test",
  "check",
  "clippy",
  "fmt",
  "--version",
  "-V"
]);
var FORBIDDEN_NODE_LONG_FLAGS = /* @__PURE__ */ new Set([
  "--eval",
  "--print",
  "--require",
  "--import",
  "--loader",
  "--experimental-loader",
  "--preload",
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
  "--test-global-setup",
  "--test-reporter",
  "--test-reporter-destination",
  "--node-options",
  "--conditions",
  "--redirect-warnings",
  "--diagnostic-dir",
  "--cpu-prof",
  "--heap-prof"
]);
var FORBIDDEN_NODE_SHORT_FLAGS = /* @__PURE__ */ new Set([
  "-e",
  "-p",
  "-c",
  "-r",
  "-i",
  "-C"
]);
var ALLOWED_NODE_TEST_FLAGS = /* @__PURE__ */ new Set([
  "--test",
  "--test-name-pattern",
  "--test-skip-pattern",
  "--test-concurrency",
  "--test-only",
  "--test-timeout",
  "--test-force-exit",
  "--test-shard",
  "--experimental-test-coverage"
]);
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
var ALLOWED_GRADLE_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "test",
  "check",
  "--version",
  "-v"
]);
var ALLOWED_MVN_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "test",
  "verify",
  "validate",
  "--version",
  "-v"
]);
var ALLOWED_DOTNET_SUBCOMMANDS = /* @__PURE__ */ new Set([
  "test",
  "build",
  "--version"
]);
var SHELL_METACHAR_RE = /(?:`|&&|\|\||[;|\r\n\0]|\$\(|\$\{)/;
var SECRET_LIKE_VALUE_RE = /(?<![A-Za-z0-9])(?:ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|gh[ousr]_[A-Za-z0-9]{10,}|sk-(?:proj-|live-|test-|ant-)?[A-Za-z0-9_-]{12,}|sk_(?:live|test)_[A-Za-z0-9_-]{12,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|[Bb][Ee][Aa][Rr][Ee][Rr]\s+[A-Za-z0-9\-._~+/=]{8,})(?![A-Za-z0-9])/;
function emptyNotFoundResult() {
  return {
    found: false,
    filePath: TEAM_CONFIG_FILENAME,
    valid: true,
    enableModules: [],
    verifyCommands: [],
    specTemplatesCount: 0,
    warnings: [],
    errors: []
  };
}
function sanitizeLabel(raw) {
  const trimmed = raw.replace(/[\r\n\0\t]+/g, " ").trim();
  if (!trimmed) return "unnamed";
  if (SECRET_LIKE_VALUE_RE.test(trimmed)) return "<redacted>";
  return trimmed.slice(0, 80);
}
function sanitizeArgForWarning(raw) {
  const cleaned = raw.replace(/[\r\n\0]+/g, " ").trim();
  if (!cleaned) return "<empty>";
  if (SECRET_LIKE_VALUE_RE.test(cleaned)) return "<redacted>";
  return cleaned.slice(0, 48);
}
function hasControlChars(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
function hasAbsolutePathPrefix(value) {
  if (!value) return false;
  return value.startsWith("/") || value.startsWith("\\") || value.startsWith("~") || /^[A-Za-z]:/.test(value);
}
function hasParentTraversalSegment(value) {
  if (!value) return false;
  return value.split(/[/\\]/).some((seg) => seg === "..");
}
function hasAbsoluteOrTraversalPath(value) {
  if (!value) return false;
  if (hasAbsolutePathPrefix(value) || hasParentTraversalSegment(value)) {
    return true;
  }
  const eqIdx = value.indexOf("=");
  if (eqIdx > 0) {
    const rhs = value.slice(eqIdx + 1);
    if (hasAbsolutePathPrefix(rhs) || hasParentTraversalSegment(rhs)) {
      return true;
    }
  }
  return false;
}
function hasDisallowedUrlScheme(arg) {
  const lower = arg.toLowerCase();
  const eqIdx = lower.indexOf("=");
  const rhs = eqIdx >= 0 ? lower.slice(eqIdx + 1) : "";
  return lower.startsWith("data:") || lower.startsWith("file:") || lower.includes("data:") || lower.includes("file:") || rhs.startsWith("data:") || rhs.startsWith("file:");
}
function isForbiddenInterpreterArg(arg) {
  const lower = arg.toLowerCase();
  if (arg === "-e" || lower === "--eval" || lower.startsWith("--eval=") || arg === "-c" || arg === "-p" || lower === "--print" || lower.startsWith("--print=")) {
    return true;
  }
  if (arg.startsWith("-") && !arg.startsWith("--") && arg.length > 1) {
    if (/^-[ecp]/.test(arg)) return true;
    if (/^-[A-Za-z]+$/.test(arg) && /[ecp]/.test(arg.slice(1))) return true;
  }
  return false;
}
function normalizeLongFlag(arg) {
  const lower = arg.toLowerCase();
  const eqIdx = lower.indexOf("=");
  return (eqIdx >= 0 ? lower.slice(0, eqIdx) : lower).replace(/_/g, "-");
}
function validatePackageManagerArgs(label, executable, args) {
  if (args.length === 0) {
    return `${executable} requires an allowed subcommand (test, run <script>, --version, or -v).`;
  }
  if (executable === "bun") {
    for (const arg of args) {
      if (isForbiddenInterpreterArg(arg)) {
        return `forbidden bun inline-execution flag "${sanitizeArgForWarning(arg)}".`;
      }
    }
  }
  const sub = args[0];
  let restArgs;
  if (sub === "--version" || sub === "-v") {
    if (args.length !== 1) {
      return `${executable} ${sub} does not accept additional arguments.`;
    }
    return null;
  } else if (sub === "test") {
    restArgs = args.slice(1);
  } else if (sub === "run") {
    const scriptName = args[1];
    if (!scriptName || !SAFE_SCRIPT_NAME_RE.test(scriptName)) {
      return `${executable} run requires a safe script name matching ${SAFE_SCRIPT_NAME_RE.source}.`;
    }
    if (FORBIDDEN_SCRIPT_NAMES.has(scriptName.toLowerCase())) {
      return `${executable} run script name "${sanitizeArgForWarning(scriptName)}" is forbidden.`;
    }
    restArgs = args.slice(2);
  } else {
    return `${executable} subcommand "${sanitizeArgForWarning(sub)}" is not allowed (permitted: test, run <script>, --version, -v).`;
  }
  let afterDoubleDash = false;
  for (const arg of restArgs) {
    if (arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    const lower = arg.toLowerCase();
    const normalizedFlag = normalizeLongFlag(arg);
    if (FORBIDDEN_PM_ARG_TOKENS.has(lower)) {
      return `forbidden ${executable} argument "${sanitizeArgForWarning(arg)}".`;
    }
    if (isForbiddenInterpreterArg(arg)) {
      return `forbidden ${executable} flag "${sanitizeArgForWarning(arg)}".`;
    }
    if (hasDisallowedUrlScheme(arg)) {
      return `disallowed URL scheme in ${executable} argument "${sanitizeArgForWarning(arg)}".`;
    }
    if (FORBIDDEN_PM_LONG_FLAGS.has(normalizedFlag) || executable === "bun" && (arg === "-r" || arg.startsWith("-r"))) {
      return `disallowed ${executable} option "${sanitizeArgForWarning(arg)}".`;
    }
    if (!afterDoubleDash && arg.startsWith("-") && !ALLOWED_PM_PRE_DASH_FLAGS.has(normalizedFlag)) {
      return `disallowed ${executable} option "${sanitizeArgForWarning(arg)}" before "--".`;
    }
    if (hasAbsoluteOrTraversalPath(arg)) {
      return `${executable} argument "${sanitizeArgForWarning(arg)}" contains a disallowed absolute or parent-traversal path.`;
    }
  }
  void label;
  return null;
}
function validateNodeArgs(args) {
  if (args.length === 0) {
    return "node requires explicit arguments (--version, -v, --check <file>, or --test [files]).";
  }
  const first = args[0];
  if (first === "--version" || first === "-v") {
    if (args.length !== 1) {
      return `node ${first} does not accept additional arguments.`;
    }
    return null;
  }
  if (first !== "--check" && first !== "--test") {
    return `node only permits "--version", "-v", "--check", or "--test" (disallowed leading arg "${sanitizeArgForWarning(first)}").`;
  }
  if (first === "--check" && args.length < 2) {
    return "node --check requires at least one relative file path.";
  }
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    const lower = arg.toLowerCase();
    const normalizedFlag = normalizeLongFlag(arg);
    if (arg === "-" || lower === "inspect") {
      return `node argument "${sanitizeArgForWarning(arg)}" is disallowed.`;
    }
    if (isForbiddenInterpreterArg(arg) || hasDisallowedUrlScheme(arg)) {
      return `forbidden node argument "${sanitizeArgForWarning(arg)}".`;
    }
    if (hasAbsoluteOrTraversalPath(arg)) {
      return `node argument "${sanitizeArgForWarning(arg)}" contains a disallowed absolute or parent-traversal path.`;
    }
    if (arg.startsWith("--")) {
      if (FORBIDDEN_NODE_LONG_FLAGS.has(normalizedFlag)) {
        return `forbidden node option "${sanitizeArgForWarning(arg)}".`;
      }
      if (first === "--test") {
        if (!ALLOWED_NODE_TEST_FLAGS.has(normalizedFlag)) {
          return `disallowed node --test option "${sanitizeArgForWarning(arg)}".`;
        }
        continue;
      }
      return `disallowed node --check option "${sanitizeArgForWarning(arg)}".`;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      if (arg.length > 2 || FORBIDDEN_NODE_SHORT_FLAGS.has(arg)) {
        return `forbidden node short flag "${sanitizeArgForWarning(arg)}".`;
      }
      return `disallowed node short flag "${sanitizeArgForWarning(arg)}".`;
    }
  }
  return null;
}
function validatePythonArgs(executable, args) {
  if (args.length === 0) {
    return `${executable} requires explicit arguments (--version, -V, or -m <allowed_module>).`;
  }
  const first = args[0];
  if (first === "--version" || first === "-V") {
    if (args.length !== 1) {
      return `${executable} ${first} does not accept additional arguments.`;
    }
    return null;
  }
  if (first !== "-m") {
    return `${executable} only permits "--version", "-V", or "-m <allowed_module>" (disallowed leading arg "${sanitizeArgForWarning(first)}").`;
  }
  const modName = args[1];
  if (!modName || !ALLOWED_PYTHON_MODULES.has(modName)) {
    return `${executable} module "${sanitizeArgForWarning(modName ?? "")}" is not in the safe allowlist (${[...ALLOWED_PYTHON_MODULES].join(", ")}).`;
  }
  const modArgs = args.slice(2);
  for (const arg of modArgs) {
    if (arg === "-" || arg === "-i" || isForbiddenInterpreterArg(arg) || hasDisallowedUrlScheme(arg)) {
      return `forbidden ${executable} argument "${sanitizeArgForWarning(arg)}".`;
    }
    if (hasAbsoluteOrTraversalPath(arg)) {
      return `${executable} argument "${sanitizeArgForWarning(arg)}" contains a disallowed absolute or parent-traversal path.`;
    }
  }
  if (modName === "pytest" || modName === "ruff" || modName === "mypy") {
    return validateLinterOrTesterArgs(modName, modArgs);
  }
  return null;
}
function validateGoArgs(args) {
  const sub = args[0];
  if (!sub || !ALLOWED_GO_SUBCOMMANDS.has(sub)) {
    return `go subcommand "${sanitizeArgForWarning(sub ?? "")}" is not allowed (permitted: ${[...ALLOWED_GO_SUBCOMMANDS].join(", ")}).`;
  }
  if (sub === "version") {
    if (args.length !== 1) {
      return "go version does not accept additional arguments.";
    }
    return null;
  }
  for (const arg of args.slice(1)) {
    if (hasDisallowedUrlScheme(arg)) {
      return `disallowed URL scheme in go argument "${sanitizeArgForWarning(arg)}".`;
    }
    if (hasAbsoluteOrTraversalPath(arg)) {
      return `go argument "${sanitizeArgForWarning(arg)}" contains a disallowed absolute or parent-traversal path.`;
    }
    if (arg.startsWith("-")) {
      const stripped = arg.replace(/^--?/, "");
      const eqIdx = stripped.indexOf("=");
      const flagName = (eqIdx >= 0 ? stripped.slice(0, eqIdx) : stripped).toLowerCase();
      if (FORBIDDEN_GO_FLAGS.has(flagName)) {
        return `forbidden go option "${sanitizeArgForWarning(arg)}".`;
      }
    }
  }
  return null;
}
function validateCargoArgs(args) {
  const sub = args[0];
  if (!sub || !ALLOWED_CARGO_SUBCOMMANDS.has(sub)) {
    return `cargo subcommand "${sanitizeArgForWarning(sub ?? "")}" is not allowed (permitted: ${[...ALLOWED_CARGO_SUBCOMMANDS].join(", ")}).`;
  }
  if ((sub === "--version" || sub === "-V") && args.length !== 1) {
    return `cargo ${sub} does not accept additional arguments.`;
  }
  for (const arg of args.slice(1)) {
    const normalizedFlag = normalizeLongFlag(arg);
    if (hasDisallowedUrlScheme(arg)) {
      return `disallowed URL scheme in cargo argument "${sanitizeArgForWarning(arg)}".`;
    }
    if (normalizedFlag === "--config" || arg === "-Z" || arg.startsWith("-Z") || normalizedFlag === "--unstable-features") {
      return `forbidden cargo option "${sanitizeArgForWarning(arg)}".`;
    }
    if (hasAbsoluteOrTraversalPath(arg)) {
      return `cargo argument "${sanitizeArgForWarning(arg)}" contains a disallowed absolute or parent-traversal path.`;
    }
  }
  return null;
}
function validateRustcArgs(args) {
  if (args.length !== 1 || args[0] !== "--version" && args[0] !== "-V") {
    return 'rustc in team presets only permits "--version" or "-V" (use cargo check/test for compilation).';
  }
  return null;
}
function validateGitArgs(args) {
  const sub = args[0];
  if (!sub || !ALLOWED_GIT_SUBCOMMANDS.has(sub)) {
    return `git subcommand "${sanitizeArgForWarning(sub ?? "")}" is not allowed (permitted read-only subcommands: ${[...ALLOWED_GIT_SUBCOMMANDS].join(", ")}).`;
  }
  for (const arg of args.slice(1)) {
    const normalizedFlag = normalizeLongFlag(arg);
    if (FORBIDDEN_GIT_FLAGS.has(normalizedFlag) || arg.startsWith("-c") || arg === "-x" || arg === "-t" || arg.startsWith("-t")) {
      return `disallowed git option "${sanitizeArgForWarning(arg)}".`;
    }
    if (arg.includes("..")) {
      return `git argument "${sanitizeArgForWarning(arg)}" contains forbidden ".." sequence.`;
    }
    if (hasAbsolutePathPrefix(arg) || arg.includes(":/") || arg.includes(":\\") || /^:\([^)]*\)[/\\~]/.test(arg)) {
      return `git argument "${sanitizeArgForWarning(arg)}" contains a disallowed absolute or home path.`;
    }
    const eqIdx = arg.indexOf("=");
    if (eqIdx > 0 && hasAbsolutePathPrefix(arg.slice(eqIdx + 1))) {
      return `git option "${sanitizeArgForWarning(arg)}" contains a disallowed absolute or home path.`;
    }
  }
  return null;
}
function validateLinterOrTesterArgs(executable, args) {
  for (const arg of args) {
    const canonicalFlag = normalizeCanonicalFlag(arg);
    if (hasDisallowedUrlScheme(arg)) {
      return `disallowed URL scheme in ${executable} argument "${sanitizeArgForWarning(arg)}".`;
    }
    if (hasAbsoluteOrTraversalPath(arg)) {
      return `${executable} argument "${sanitizeArgForWarning(arg)}" contains a disallowed absolute or parent-traversal path.`;
    }
    if (FORBIDDEN_LINTER_COMMON_FLAGS.has(canonicalFlag)) {
      return `disallowed ${executable} option "${sanitizeArgForWarning(arg)}".`;
    }
    if (arg.startsWith("-") && !arg.startsWith("--") && arg.length > 1) {
      if (arg === "-c" || arg.startsWith("-c") || arg === "-e" || arg.startsWith("-e") || arg === "-r" || arg.startsWith("-r") || arg === "-o" || arg.startsWith("-o")) {
        return `disallowed ${executable} short option "${sanitizeArgForWarning(arg)}".`;
      }
      if (executable === "eslint" && (arg === "-f" || arg.startsWith("-f"))) {
        return `disallowed eslint formatter option "${sanitizeArgForWarning(arg)}".`;
      }
      if (executable === "pytest" && (arg === "-p" || arg.startsWith("-p"))) {
        return `disallowed pytest plugin option "${sanitizeArgForWarning(arg)}".`;
      }
      if (executable === "prettier" && (arg === "-w" || arg.startsWith("-w"))) {
        return `disallowed prettier write option "${sanitizeArgForWarning(arg)}".`;
      }
    }
  }
  return null;
}
function validateBuildToolArgs(executable, args) {
  const sub = args[0];
  const allowed = executable === "gradle" ? ALLOWED_GRADLE_SUBCOMMANDS : executable === "mvn" ? ALLOWED_MVN_SUBCOMMANDS : ALLOWED_DOTNET_SUBCOMMANDS;
  if (!sub || !allowed.has(sub)) {
    return `${executable} subcommand "${sanitizeArgForWarning(sub ?? "")}" is not allowed (permitted: ${[...allowed].join(", ")}).`;
  }
  if ((sub === "--version" || sub === "-v") && args.length !== 1) {
    return `${executable} ${sub} does not accept additional arguments.`;
  }
  for (const arg of args.slice(1)) {
    const lower = arg.toLowerCase();
    const canonicalFlag = normalizeCanonicalFlag(arg);
    if (hasDisallowedUrlScheme(arg) || hasAbsoluteOrTraversalPath(arg)) {
      return `disallowed ${executable} path/URL argument "${sanitizeArgForWarning(arg)}".`;
    }
    if (arg.includes("=") || arg.startsWith("-D") || arg.startsWith("-P") || arg.startsWith("-I") || arg.startsWith("-p:") || arg.startsWith("/p:") || arg.startsWith("-l:") || FORBIDDEN_BUILD_TOOL_CANONICAL_FLAGS.has(canonicalFlag) || lower === "-f" || lower === "-b" || lower === "-c" || lower === "-s" || lower === "-gs" || lower === "-g" || lower === "-p" || lower === "-o" || lower.startsWith("-o")) {
      return `disallowed ${executable} option "${sanitizeArgForWarning(arg)}".`;
    }
  }
  return null;
}
function validateTeamVerifyCommand(rawEntry, index) {
  if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
    return {
      ok: false,
      warning: `Rejected verifyCommands[${index}]: entry must be a JSON object.`
    };
  }
  const obj = rawEntry;
  const rawLabel = typeof obj.label === "string" ? obj.label : "";
  const label = sanitizeLabel(rawLabel);
  if (!rawLabel.trim()) {
    return {
      ok: false,
      warning: `Rejected verifyCommands[${index}]: missing non-empty "label".`
    };
  }
  const rawExec = typeof obj.executable === "string" ? obj.executable.trim() : "";
  if (!rawExec) {
    return {
      ok: false,
      warning: `Rejected verifyCommand "${label}": missing non-empty "executable".`
    };
  }
  if (rawExec.includes("/") || rawExec.includes("\\") || rawExec.includes("..") || /\s/.test(rawExec) || hasControlChars(rawExec)) {
    return {
      ok: false,
      warning: `Rejected verifyCommand "${label}": executable must be a bare command name without path separators or whitespace.`
    };
  }
  const execLower = rawExec.toLowerCase();
  if (FORBIDDEN_SHELL_EXECUTABLES.has(execLower)) {
    return {
      ok: false,
      warning: `Rejected verifyCommand "${label}": shell interpreter "${execLower}" is forbidden.`
    };
  }
  if (!TEAM_VERIFY_ALLOWED_EXECUTABLES.has(execLower)) {
    return {
      ok: false,
      warning: `Rejected verifyCommand "${label}": executable "${sanitizeArgForWarning(rawExec)}" is not in the safe allowlist.`
    };
  }
  if (!Array.isArray(obj.args)) {
    return {
      ok: false,
      warning: `Rejected verifyCommand "${label}": "args" must be an array of strings.`
    };
  }
  if (obj.args.length > MAX_TEAM_VERIFY_ARGS) {
    return {
      ok: false,
      warning: `Rejected verifyCommand "${label}": exceeds max ${MAX_TEAM_VERIFY_ARGS} arguments.`
    };
  }
  const args = [];
  for (let i = 0; i < obj.args.length; i += 1) {
    const rawArg = obj.args[i];
    if (typeof rawArg !== "string") {
      return {
        ok: false,
        warning: `Rejected verifyCommand "${label}": args[${i}] must be a string.`
      };
    }
    if (rawArg.length === 0 || rawArg.length > MAX_TEAM_VERIFY_ARG_LENGTH) {
      return {
        ok: false,
        warning: `Rejected verifyCommand "${label}": args[${i}] is empty or exceeds ${MAX_TEAM_VERIFY_ARG_LENGTH} chars.`
      };
    }
    if (hasControlChars(rawArg) || SHELL_METACHAR_RE.test(rawArg)) {
      return {
        ok: false,
        warning: `Rejected verifyCommand "${label}": args[${i}] contains forbidden shell metacharacters or control bytes.`
      };
    }
    args.push(rawArg);
  }
  let toolError = null;
  if (PACKAGE_MANAGER_EXECUTABLES.has(execLower)) {
    toolError = validatePackageManagerArgs(label, execLower, args);
  } else if (execLower === "node") {
    toolError = validateNodeArgs(args);
  } else if (execLower === "python" || execLower === "python3") {
    toolError = validatePythonArgs(execLower, args);
  } else if (execLower === "go") {
    toolError = validateGoArgs(args);
  } else if (execLower === "cargo") {
    toolError = validateCargoArgs(args);
  } else if (execLower === "rustc") {
    toolError = validateRustcArgs(args);
  } else if (execLower === "git") {
    toolError = validateGitArgs(args);
  } else if (execLower === "gradle" || execLower === "mvn" || execLower === "dotnet") {
    toolError = validateBuildToolArgs(execLower, args);
  } else if (LINTER_TESTER_EXECUTABLES.has(execLower)) {
    toolError = validateLinterOrTesterArgs(execLower, args);
  } else {
    toolError = `executable "${execLower}" has no registered argument validator.`;
  }
  if (toolError) {
    return {
      ok: false,
      warning: `Rejected verifyCommand "${label}": ${toolError}`
    };
  }
  return {
    ok: true,
    command: {
      label,
      executable: execLower,
      args
    }
  };
}
function parseJsonSafelyWithoutProtoPollution(rawText) {
  const protoKeys = /* @__PURE__ */ new Set();
  const parsed = JSON.parse(rawText, (key, value) => {
    if (key && PROTO_POLLUTION_KEYS.has(key)) {
      protoKeys.add(key);
      return void 0;
    }
    return value;
  });
  const stripNested = (node) => {
    if (Array.isArray(node)) {
      return node.map(stripNested);
    }
    if (node && typeof node === "object") {
      const clean = /* @__PURE__ */ Object.create(null);
      for (const k of Object.getOwnPropertyNames(node)) {
        if (PROTO_POLLUTION_KEYS.has(k)) {
          protoKeys.add(k);
          continue;
        }
        clean[k] = stripNested(node[k]);
      }
      return clean;
    }
    return node;
  };
  return {
    parsed: stripNested(parsed),
    protoKeysDetected: Array.from(protoKeys)
  };
}
var SENSITIVE_TARGET_SEG_RE = /^(?:\.env(?:\.|$)|\.ssh$|\.aws$|\.gnupg$|\.kube$|credentials|.*secret.*)/i;
var SENSITIVE_TARGET_BASENAMES = /* @__PURE__ */ new Set([
  "auth.json",
  "oauth.json",
  "token.json",
  "tokens.json",
  ".npmrc",
  ".netrc",
  ".pypirc",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
  "master.key"
]);
var SENSITIVE_TARGET_EXTS = /* @__PURE__ */ new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore"
]);
function isSensitiveRelativeTarget(relPath) {
  const normalized = relPath.replace(/\\/g, "/").trim();
  if (!normalized) return false;
  const segments = normalized.split("/").filter(Boolean);
  for (const seg of segments) {
    if (SENSITIVE_TARGET_SEG_RE.test(seg)) return true;
  }
  const base = segments[segments.length - 1]?.toLowerCase() ?? "";
  if (SENSITIVE_TARGET_BASENAMES.has(base)) return true;
  if (base.startsWith("id_rsa.") || base.startsWith("id_ed25519.") || base.startsWith("id_ecdsa.") || base.startsWith("id_dsa.")) {
    return true;
  }
  return SENSITIVE_TARGET_EXTS.has(import_node_path.default.posix.extname(base));
}
function loadTeamPresetReadOnly(workspaceRoot) {
  let realRoot;
  try {
    realRoot = import_node_fs.default.realpathSync(import_node_path.default.resolve(workspaceRoot));
  } catch {
    return emptyNotFoundResult();
  }
  const rootPrefix = realRoot.endsWith(import_node_path.default.sep) ? realRoot : `${realRoot}${import_node_path.default.sep}`;
  const candidatePath = import_node_path.default.join(realRoot, TEAM_CONFIG_FILENAME);
  let lstat;
  try {
    lstat = import_node_fs.default.lstatSync(candidatePath);
  } catch (err) {
    const code = err?.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return emptyNotFoundResult();
    }
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [`Unable to inspect ${TEAM_CONFIG_FILENAME}: ${code ?? "read error"}`]
    };
  }
  let realFile;
  try {
    realFile = import_node_fs.default.realpathSync(candidatePath);
  } catch {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [
        `Refused to read ${TEAM_CONFIG_FILENAME}: unable to resolve real path (broken symlink or inaccessible target).`
      ]
    };
  }
  if (realFile !== realRoot && !realFile.startsWith(rootPrefix)) {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [`Refused to read ${TEAM_CONFIG_FILENAME}: symlink escapes workspace boundary.`]
    };
  }
  const realRel = import_node_path.default.relative(realRoot, realFile).replace(/\\/g, "/");
  if (lstat.isSymbolicLink() && isSensitiveRelativeTarget(realRel)) {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [`Refused to read ${TEAM_CONFIG_FILENAME}: symlink targets a sensitive file.`]
    };
  }
  let stat;
  try {
    stat = lstat.isSymbolicLink() ? import_node_fs.default.statSync(realFile) : lstat;
  } catch {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [`Unable to stat ${TEAM_CONFIG_FILENAME}.`]
    };
  }
  if (!stat.isFile()) {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [`${TEAM_CONFIG_FILENAME} must be a regular file.`]
    };
  }
  if (stat.size > MAX_TEAM_CONFIG_BYTES) {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [
        `${TEAM_CONFIG_FILENAME} exceeds maximum allowed size (${stat.size} bytes > ${MAX_TEAM_CONFIG_BYTES} bytes / 64 KiB).`
      ]
    };
  }
  let rawText;
  try {
    rawText = import_node_fs.default.readFileSync(realFile, "utf8");
  } catch {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [`Failed to read ${TEAM_CONFIG_FILENAME}.`]
    };
  }
  let parsedUnknown;
  let protoKeysDetected = [];
  try {
    const res = parseJsonSafelyWithoutProtoPollution(rawText);
    parsedUnknown = res.parsed;
    protoKeysDetected = res.protoKeysDetected;
  } catch {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [`Invalid JSON syntax in ${TEAM_CONFIG_FILENAME}.`]
    };
  }
  if (!parsedUnknown || typeof parsedUnknown !== "object" || Array.isArray(parsedUnknown)) {
    return {
      found: true,
      filePath: TEAM_CONFIG_FILENAME,
      valid: false,
      enableModules: [],
      verifyCommands: [],
      specTemplatesCount: 0,
      warnings: [],
      errors: [`${TEAM_CONFIG_FILENAME} root must be a JSON object.`]
    };
  }
  const rootObj = parsedUnknown;
  const warnings = [];
  const errors = [];
  if (protoKeysDetected.length > 0) {
    warnings.push(
      `Ignored dangerous prototype-pollution key(s) in ${TEAM_CONFIG_FILENAME}: ${protoKeysDetected.join(", ")}.`
    );
  }
  for (const key of Object.keys(rootObj)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      warnings.push(
        `Ignored unrecognized top-level field "${sanitizeArgForWarning(key)}" in ${TEAM_CONFIG_FILENAME}.`
      );
    }
  }
  if (rootObj.schemaVersion !== void 0 && rootObj.schemaVersion !== 1) {
    errors.push(`Unsupported schemaVersion in ${TEAM_CONFIG_FILENAME}: expected 1.`);
  }
  let preset;
  if (rootObj.preset !== void 0) {
    if (isPresetId(rootObj.preset)) {
      if (rootObj.preset === "full") {
        preset = "local-all";
        warnings.push(
          'Preset "full" includes opt-in network module "remote"; downgraded to offline "local-all" because "remote" must be enabled manually by each developer.'
        );
      } else {
        preset = rootObj.preset;
      }
    } else {
      errors.push(
        `Invalid preset "${sanitizeArgForWarning(String(rootObj.preset))}" in ${TEAM_CONFIG_FILENAME}.`
      );
    }
  }
  const enableModules = [];
  const seenModules = /* @__PURE__ */ new Set();
  if (rootObj.enableModules !== void 0) {
    if (!Array.isArray(rootObj.enableModules)) {
      errors.push(`Field "enableModules" in ${TEAM_CONFIG_FILENAME} must be an array of module IDs.`);
    } else {
      let strippedRemote = false;
      for (const item of rootObj.enableModules) {
        if (!isModuleId(item)) {
          warnings.push(
            `Ignored unknown module ID "${sanitizeArgForWarning(String(item))}" in enableModules.`
          );
          continue;
        }
        if (item === "remote") {
          if (!strippedRemote) {
            strippedRemote = true;
            warnings.push(
              'Stripped "remote" from enableModules: opt-in network module must be enabled manually by each user.'
            );
          }
          continue;
        }
        if (!seenModules.has(item)) {
          seenModules.add(item);
          enableModules.push(item);
        }
      }
    }
  }
  const verifyCommands = [];
  if (rootObj.verifyCommands !== void 0) {
    if (!Array.isArray(rootObj.verifyCommands)) {
      errors.push(`Field "verifyCommands" in ${TEAM_CONFIG_FILENAME} must be an array.`);
    } else {
      const capped = rootObj.verifyCommands.slice(0, MAX_TEAM_VERIFY_COMMANDS);
      if (rootObj.verifyCommands.length > MAX_TEAM_VERIFY_COMMANDS) {
        warnings.push(
          `Truncated verifyCommands to ${MAX_TEAM_VERIFY_COMMANDS} entries (received ${rootObj.verifyCommands.length}).`
        );
      }
      for (let i = 0; i < capped.length; i += 1) {
        const checked = validateTeamVerifyCommand(capped[i], i);
        if (checked.ok) {
          verifyCommands.push(checked.command);
        } else {
          warnings.push(checked.warning);
        }
      }
    }
  }
  const specTemplates = [];
  if (rootObj.specTemplates !== void 0) {
    if (!Array.isArray(rootObj.specTemplates)) {
      warnings.push(`Ignored non-array "specTemplates" field in ${TEAM_CONFIG_FILENAME}.`);
    } else {
      if (rootObj.specTemplates.length > MAX_TEAM_SPEC_TEMPLATES) {
        warnings.push(
          `Truncated specTemplates to ${MAX_TEAM_SPEC_TEMPLATES} entries (received ${rootObj.specTemplates.length}).`
        );
      }
      for (const rawTpl of rootObj.specTemplates.slice(0, MAX_TEAM_SPEC_TEMPLATES)) {
        if (!rawTpl || typeof rawTpl !== "object" || Array.isArray(rawTpl)) {
          warnings.push('Ignored malformed entry in specTemplates (expected object with "name").');
          continue;
        }
        const tplObj = rawTpl;
        const name = typeof tplObj.name === "string" ? tplObj.name.trim().slice(0, 100) : "";
        if (!name) {
          warnings.push('Ignored specTemplates entry missing non-empty "name".');
          continue;
        }
        const goal = typeof tplObj.goal === "string" && tplObj.goal.trim() ? tplObj.goal.trim().slice(0, 400) : void 0;
        const tasks = Array.isArray(tplObj.tasks) ? tplObj.tasks.filter((t) => typeof t === "string" && t.trim().length > 0).slice(0, 20).map((t) => t.trim().slice(0, 160)) : void 0;
        specTemplates.push({
          name,
          ...goal ? { goal } : {},
          ...tasks && tasks.length > 0 ? { tasks } : {}
        });
      }
    }
  }
  return {
    found: true,
    filePath: TEAM_CONFIG_FILENAME,
    valid: errors.length === 0,
    ...preset ? { preset } : {},
    enableModules,
    verifyCommands,
    specTemplatesCount: specTemplates.length,
    warnings,
    errors
  };
}

// src/core/config.ts
function sanitizeDataDirCandidate(candidate) {
  if (!candidate) return void 0;
  const trimmed = candidate.trim();
  if (!trimmed) return void 0;
  if (/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(trimmed)) return void 0;
  return import_node_path2.default.resolve(trimmed);
}
function resolveNovDataDir(cliDataDir) {
  return sanitizeDataDirCandidate(cliDataDir) ?? sanitizeDataDirCandidate(process.env.AGY_NOV_DATA_DIR) ?? sanitizeDataDirCandidate(process.env.PLUGIN_DATA) ?? import_node_path2.default.join(import_node_os.default.homedir(), ".agy-nov-data");
}
function getModuleDataDir(rootDataDir, moduleId) {
  return import_node_path2.default.join(rootDataDir, "modules", moduleId);
}
function getConfigPath(rootDataDir) {
  return import_node_path2.default.join(rootDataDir, "config.json");
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
  if (!import_node_fs2.default.existsSync(cfgPath)) {
    return createDefaultConfig();
  }
  try {
    const raw = JSON.parse(import_node_fs2.default.readFileSync(cfgPath, "utf8"));
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
  import_node_fs2.default.mkdirSync(rootDataDir, { recursive: true, mode: 448 });
  try {
    import_node_fs2.default.chmodSync(rootDataDir, 448);
  } catch {
  }
  const cfgPath = getConfigPath(rootDataDir);
  const tmpPath = `${cfgPath}.tmp.${process.pid}.${Date.now()}`;
  import_node_fs2.default.writeFileSync(tmpPath, `${JSON.stringify(normalized, null, 2)}
`, { mode: 384 });
  import_node_fs2.default.renameSync(tmpPath, cfgPath);
  return normalized;
}
function loadOrInitNovConfig(rootDataDir) {
  const cfgPath = getConfigPath(rootDataDir);
  if (!import_node_fs2.default.existsSync(cfgPath)) {
    return createDefaultConfig();
  }
  try {
    const raw = JSON.parse(import_node_fs2.default.readFileSync(cfgPath, "utf8"));
    return normalizeConfig(raw);
  } catch {
    try {
      import_node_fs2.default.renameSync(cfgPath, `${cfgPath}.corrupt.${Date.now()}`);
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
var MAX_CONFIG_IMPORT_BYTES = 32 * 1024;

// src/core/feed.ts
var import_node_path3 = __toESM(require("node:path"), 1);
var FEED_SNAPSHOT_FILENAME = "feed-snapshot.json";
var MAX_FEED_SNAPSHOT_BYTES = 64 * 1024;
var MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
function getFeedSnapshotPath(rootDataDir) {
  return import_node_path3.default.join(rootDataDir, FEED_SNAPSHOT_FILENAME);
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
var CLI_VERSION = "0.7.0";
function printHelp() {
  console.log(`agy-NOV CLI (v${CLI_VERSION}) \u2014 The 100% Native Modular Super-Workbench for Antigravity 2.0

Usage:
  agy-nov status [--data-dir=<dir>]                             Show enabled modules, preset, UI language & token footprint
  agy-nov enable <module> [--data-dir=<dir>]                    Enable a module (${MODULE_IDS.join(" | ")})
  agy-nov disable <module> [--data-dir=<dir>]                   Disable a module
  agy-nov preset <name> [--data-dir=<dir>]                      Apply preset (${PRESET_IDS.join(" | ")})
  agy-nov locale <lang> [--data-dir=<dir>]                      Set UI language (${LOCALE_IDS.join(" | ")})
  agy-nov statusline [--json] [--compact] [--data-dir=<dir>]    Zero-token read-only status line for Antigravity CLI
  agy-nov recommend [--workspace=<dir>] [--json]                Read-only project scanner recommending preset & modules
  agy-nov doctor [--data-dir=<dir>]                             Verify plugin bundle, manifests & config health (read-only)
`);
}
function readJsonSilent(filePath) {
  try {
    if (!import_node_fs3.default.existsSync(filePath)) return null;
    const raw = JSON.parse(import_node_fs3.default.readFileSync(filePath, "utf8"));
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
    const verifyState = readJsonSilent(import_node_path4.default.join(getModuleDataDir(dataDir, "verify"), "state.json"));
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
    const specState = readJsonSilent(import_node_path4.default.join(getModuleDataDir(dataDir, "spec"), "state.json"));
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
    const capsule = readJsonSilent(import_node_path4.default.join(radarDir, "status-capsule.json"));
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
      const board = readJsonSilent(import_node_path4.default.join(radarDir, "board.json"));
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
    const live = readJsonSilent(import_node_path4.default.join(getModuleDataDir(dataDir, "xray"), "live-state.json"));
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
  console.log(`  Config File:    ${getConfigPath(dataDir)} (${import_node_fs3.default.existsSync(getConfigPath(dataDir)) ? "persisted" : "defaults"})`);
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
function buildWorkspaceRecommendation(workspaceRoot) {
  const resolvedRoot = import_node_path4.default.resolve(workspaceRoot);
  let realRoot = resolvedRoot;
  try {
    realRoot = import_node_fs3.default.realpathSync(resolvedRoot);
  } catch {
  }
  const exists = (rel) => {
    try {
      return import_node_fs3.default.existsSync(import_node_path4.default.join(realRoot, rel));
    } catch {
      return false;
    }
  };
  const detectedStacks = [];
  let hasMultipleTestsOrScripts = false;
  if (exists("package.json")) {
    detectedStacks.push("Node.js / TypeScript");
    const pkg = readJsonSilent(import_node_path4.default.join(realRoot, "package.json"));
    const scripts = pkg?.scripts && typeof pkg.scripts === "object" && !Array.isArray(pkg.scripts) ? Object.keys(pkg.scripts) : [];
    if (scripts.some((s) => /test|typecheck|lint|check|build/i.test(s))) {
      hasMultipleTestsOrScripts = true;
    }
  }
  if (exists("pyproject.toml") || exists("pytest.ini") || exists("requirements.txt")) {
    detectedStacks.push("Python");
    hasMultipleTestsOrScripts = true;
  }
  if (exists("Cargo.toml")) {
    detectedStacks.push("Rust");
    hasMultipleTestsOrScripts = true;
  }
  if (exists("go.mod")) {
    detectedStacks.push("Go");
    hasMultipleTestsOrScripts = true;
  }
  const isGitRepo = exists(".git");
  const hasRulesOrMcp = exists("GEMINI.md") || exists("AGENTS.md") || exists("CLAUDE.md") || exists(".mcp.json") || exists("mcp_config.json") || exists(".agents/rules");
  let hasDataOrOpenApi = false;
  try {
    const entries = import_node_fs3.default.readdirSync(realRoot, { withFileTypes: true }).slice(0, 120);
    for (const ent of entries) {
      if (ent.isFile() && /\.(?:sqlite|sqlite3|db|csv|openapi\.ya?ml|openapi\.json)$/i.test(ent.name)) {
        hasDataOrOpenApi = true;
        break;
      }
      if (ent.isFile() && /^(?:openapi|swagger)\.(?:ya?ml|json)$/i.test(ent.name)) {
        hasDataOrOpenApi = true;
        break;
      }
    }
  } catch {
  }
  const teamAudit = loadTeamPresetReadOnly(realRoot);
  const teamPresetSummary = {
    found: teamAudit.found,
    valid: teamAudit.valid,
    ...teamAudit.preset ? { preset: teamAudit.preset } : {},
    enableModules: [...teamAudit.enableModules],
    verifyCommandCount: teamAudit.verifyCommands.length,
    warningCount: teamAudit.warnings.length,
    errorCount: teamAudit.errors.length
  };
  const reasons = [];
  const rawExtraModules = [];
  let recommendedPreset = "core";
  if (isGitRepo && hasMultipleTestsOrScripts) {
    recommendedPreset = "power";
    reasons.push(
      `Detected Git repository + ${detectedStacks.join(", ")} test/build setup -> "power" preset enables Verify Gate, Worktree Orchestrator, Spec Flow, Turbo RTK & Ops Budget Doctor (100% offline).`
    );
  } else {
    reasons.push(
      'Lightweight workspace detected -> "core" preset keeps tool footprint minimal (12 tools: Review, Guard & X-Ray, 100% offline).'
    );
  }
  if (hasRulesOrMcp) {
    reasons.push("Found workspace rules or MCP configuration -> Ops Budget Doctor helps prevent 24KB rule bloat & 100-tool limit overflows.");
    if (recommendedPreset === "core") rawExtraModules.push("ops");
  }
  if (hasDataOrOpenApi) {
    reasons.push("Found local database, CSV, or OpenAPI files -> enable Workspace Studio on demand for offline inspection & loopback API probing.");
    rawExtraModules.push("studio");
  }
  if (teamAudit.found) {
    if (teamAudit.valid && teamAudit.errors.length === 0) {
      if (teamAudit.preset) {
        if (teamAudit.preset === "full") {
          recommendedPreset = "local-all";
          reasons.unshift(
            'Found .agy-nov.json preset "full" -> downgraded to offline "local-all" because opt-in network module "remote" must be enabled manually.'
          );
        } else {
          recommendedPreset = teamAudit.preset;
          reasons.unshift(
            `Adopted team preset "${teamAudit.preset}" from .agy-nov.json (read-only).`
          );
        }
      }
      const safeTeamExtras = teamAudit.enableModules.filter((m) => m !== "remote");
      if (safeTeamExtras.length > 0) {
        for (const m of safeTeamExtras) {
          rawExtraModules.push(m);
        }
        reasons.push(
          `Team preset (.agy-nov.json) requests additional offline module(s): ${safeTeamExtras.join(", ")}.`
        );
      }
    } else {
      reasons.unshift(
        `Ignored invalid .agy-nov.json: ${teamAudit.errors.join(" ")}`
      );
    }
    if (teamAudit.warnings.length > 0) {
      for (const warn of teamAudit.warnings.slice(0, 8)) {
        reasons.push(`[.agy-nov.json warning] ${warn}`);
      }
    }
  }
  const presetModules = PRESET_DEFINITIONS[recommendedPreset].modules;
  const suggestedExtraModules = [];
  for (const mod of rawExtraModules) {
    if (mod === "remote") continue;
    if (presetModules[mod]) continue;
    if (!suggestedExtraModules.includes(mod)) {
      suggestedExtraModules.push(mod);
    }
  }
  const applyCommand = suggestedExtraModules.length > 0 ? `agy-nov preset ${recommendedPreset} && ${suggestedExtraModules.map((m) => `agy-nov enable ${m}`).join(" && ")}` : `agy-nov preset ${recommendedPreset}`;
  return {
    version: CLI_VERSION,
    workspaceRoot: resolvedRoot,
    detectedStacks,
    signals: {
      isGitRepo,
      hasRulesOrMcp,
      hasDataOrOpenApi,
      hasMultipleTestsOrScripts
    },
    teamPreset: teamPresetSummary,
    recommendedPreset,
    suggestedExtraModules,
    reasons,
    applyCommand
  };
}
function resolvePluginRootDir() {
  const scriptDir = import_node_path4.default.dirname(process.argv[1] || process.cwd());
  const candidates = [
    import_node_path4.default.resolve(scriptDir, ".."),
    import_node_path4.default.resolve(scriptDir, "../.."),
    process.cwd()
  ];
  for (const dir of candidates) {
    if (import_node_fs3.default.existsSync(import_node_path4.default.join(dir, "plugin.json"))) {
      return dir;
    }
  }
  return candidates[0];
}
function runDoctor(dataDir) {
  const rootDir = resolvePluginRootDir();
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
    const abs = import_node_path4.default.join(rootDir, rel);
    const exists = import_node_fs3.default.existsSync(abs);
    if (!exists) ok = false;
    const size = exists ? `${(import_node_fs3.default.statSync(abs).size / 1024).toFixed(1)} KB` : "MISSING";
    console.log(`  ${exists ? "OK  " : "FAIL"} ${rel.padEnd(28)} ${size}`);
  }
  const pluginPath = import_node_path4.default.join(rootDir, "plugin.json");
  if (import_node_fs3.default.existsSync(pluginPath)) {
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
    const manifest = JSON.parse(import_node_fs3.default.readFileSync(pluginPath, "utf8"));
    const unknown = Object.keys(manifest).filter((k) => !allowedKeys.has(k));
    if (unknown.length > 0) {
      ok = false;
      console.log(`  FAIL plugin.json contains unknown keys: ${unknown.join(", ")}`);
    } else {
      console.log(`  OK   plugin.json schema clean (name=${String(manifest.name)}, version=${String(manifest.version)})`);
    }
  }
  const uiPath = import_node_path4.default.join(rootDir, "dist/ui/app.html");
  if (import_node_fs3.default.existsSync(uiPath)) {
    const bytes = import_node_fs3.default.statSync(uiPath).size;
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
  const feedPath = getFeedSnapshotPath(dataDir);
  let feedStatusTag = "OK  ";
  let feedNote = "not generated yet (lazy read-only until first write)";
  try {
    const feedStat = import_node_fs3.default.lstatSync(feedPath);
    if (feedStat.isSymbolicLink() || !feedStat.isFile()) {
      ok = false;
      feedStatusTag = "FAIL";
      feedNote = "unsafe symlink or non-regular file";
    } else if (feedStat.size > MAX_FEED_SNAPSHOT_BYTES) {
      ok = false;
      feedStatusTag = "FAIL";
      feedNote = `exceeds 64 KB cap (${feedStat.size} bytes)`;
    } else {
      feedNote = `ready (${(feedStat.size / 1024).toFixed(1)} KB)`;
    }
  } catch (err) {
    if (err?.code !== "ENOENT") {
      feedNote = "unreadable";
    }
  }
  console.log(`  ${feedStatusTag} Feed Snapshot: ${feedPath} (${feedNote})`);
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
  if (cmd === "recommend") {
    const ws = parseCliFlag(argv, "--workspace") ?? process.cwd();
    const asJson = hasCliFlag(argv, "--json");
    const rec = buildWorkspaceRecommendation(ws);
    if (asJson) {
      console.log(JSON.stringify(rec, null, 2));
    } else {
      console.log(`agy-NOV v${CLI_VERSION} Workspace Recommendation (Read-Only)`);
      console.log(`  Workspace:   ${rec.workspaceRoot}`);
      console.log(`  Stacks:      ${rec.detectedStacks.length > 0 ? rec.detectedStacks.join(", ") : "Generic"}`);
      if (rec.teamPreset.found) {
        console.log(
          `  Team Preset: .agy-nov.json (${rec.teamPreset.valid ? "valid" : "invalid"}${rec.teamPreset.preset ? ` \xB7 preset=${rec.teamPreset.preset}` : ""} \xB7 ${rec.teamPreset.verifyCommandCount} verify cmd(s) \xB7 ${rec.teamPreset.warningCount} warn(s))`
        );
      }
      console.log(`  Recommended: preset "${rec.recommendedPreset}"${rec.suggestedExtraModules.length > 0 ? ` + [${rec.suggestedExtraModules.join(", ")}]` : ""}`);
      for (const r of rec.reasons) {
        console.log(`  - ${r}`);
      }
      console.log(`  Apply:       ${rec.applyCommand}`);
    }
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
