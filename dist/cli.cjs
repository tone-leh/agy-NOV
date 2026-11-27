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
var import_node_fs5 = __toESM(require("node:fs"), 1);
var import_node_path7 = __toESM(require("node:path"), 1);

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

// src/core/utils.ts
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_path4 = __toESM(require("node:path"), 1);
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
function ensurePrivateDir(dirPath) {
  import_node_fs3.default.mkdirSync(dirPath, { recursive: true, mode: 448 });
  try {
    import_node_fs3.default.chmodSync(dirPath, 448);
  } catch {
  }
}
function atomicWriteJson(filePath, data) {
  ensurePrivateDir(import_node_path4.default.dirname(filePath));
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  import_node_fs3.default.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}
`, { mode: 384 });
  import_node_fs3.default.renameSync(tmpPath, filePath);
}

// src/modules/turbo/auto-rtk.ts
var import_node_child_process = require("node:child_process");
var import_node_crypto2 = __toESM(require("node:crypto"), 1);
var import_node_fs4 = __toESM(require("node:fs"), 1);
var import_node_path6 = __toESM(require("node:path"), 1);

// src/modules/turbo/core.ts
var import_node_crypto = __toESM(require("node:crypto"), 1);
var import_node_path5 = __toESM(require("node:path"), 1);
var TURBO_MAX_FILE_BYTES = 512 * 1024;
var TURBO_MAX_OUTLINE_FILE_BYTES = 1024 * 1024;
var TURBO_MAX_COMPACTED_CHUNKS = 24;
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
    const chunkId = `chk_${Date.now().toString(36)}_${import_node_crypto.default.randomBytes(3).toString("hex")}`;
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
        atomicWriteJson(import_node_path5.default.join(dataDir, "stats.json"), {
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

// src/modules/turbo/auto-rtk.ts
var PREFS_FILENAME = "prefs.json";
var LAST_RAW_LOG_FILENAME = "last-raw.log";
var MAX_PREFS_BYTES = 64 * 1024;
var MAX_HOTSPOTS_BYTES = 256 * 1024;
var MAX_RAW_LOG_BYTES = 128 * 1024;
var MAX_COMMAND_LENGTH = 512;
var MAX_COMMAND_ARGS = 24;
var MAX_PAYLOAD_B64_LENGTH = 4096;
var COMPACT_RUN_TIMEOUT_MS = 12e4;
var COMPACT_RUN_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
var FAILURE_TAIL_MIN_LINES = 60;
var SHELL_META_HARD_DENY_RE = /[;&|`$><\r\n()\\\x00-\x1f\x7f]/;
var SAFE_EXECUTABLE_RE = /^[a-z][a-z0-9-]*$/;
var SAFE_B64URL_RE = /^[A-Za-z0-9_-]+$/;
var ENV_ASSIGN_TOKEN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
var FORBIDDEN_SHELL_EXECUTABLES2 = /* @__PURE__ */ new Set([
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
function isPlatformSystemRootSymlink(segmentPath) {
  return process.platform === "darwin" && /^\/(?:var|tmp|etc)$/.test(segmentPath);
}
function hasUnsafeSymlinkAncestor(targetPath) {
  let cur = import_node_path6.default.resolve(targetPath);
  const root = import_node_path6.default.parse(cur).root;
  while (true) {
    if (!isPlatformSystemRootSymlink(cur)) {
      try {
        const st = import_node_fs4.default.lstatSync(cur);
        if (st.isSymbolicLink()) return true;
      } catch (err) {
        const code = err?.code;
        if (code !== "ENOENT") return true;
      }
    }
    if (cur === root) return false;
    const parent = import_node_path6.default.dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
}
function isWithinRealBase(childReal, baseReal) {
  if (childReal === baseReal) return true;
  const prefix = baseReal.endsWith(import_node_path6.default.sep) ? baseReal : `${baseReal}${import_node_path6.default.sep}`;
  return childReal.startsWith(prefix);
}
function resolveSafeExistingDir(dirPath) {
  if (!dirPath || typeof dirPath !== "string" || dirPath.includes("\0")) return null;
  const resolved = import_node_path6.default.resolve(dirPath);
  if (hasUnsafeSymlinkAncestor(resolved)) return null;
  try {
    const st = import_node_fs4.default.lstatSync(resolved);
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
    return import_node_fs4.default.realpathSync(resolved);
  } catch {
    return null;
  }
}
function ensureSafePrivateDir(dirPath) {
  if (!dirPath || typeof dirPath !== "string" || dirPath.includes("\0")) {
    throw new Error("Invalid directory path");
  }
  const resolved = import_node_path6.default.resolve(dirPath);
  if (hasUnsafeSymlinkAncestor(resolved)) {
    throw new Error(`Refused symlink directory path: ${dirPath}`);
  }
  import_node_fs4.default.mkdirSync(resolved, { recursive: true, mode: 448 });
  const st = import_node_fs4.default.lstatSync(resolved);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`Refused unsafe target directory: ${dirPath}`);
  }
  try {
    import_node_fs4.default.chmodSync(resolved, 448);
  } catch {
  }
  return import_node_fs4.default.realpathSync(resolved);
}
function readSafeJsonFile(dirPath, fileName, maxBytes) {
  const realDir = resolveSafeExistingDir(dirPath);
  if (!realDir) return null;
  const filePath = import_node_path6.default.join(realDir, fileName);
  try {
    const st = import_node_fs4.default.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile() || st.size > maxBytes) {
      return null;
    }
    const realFile = import_node_fs4.default.realpathSync(filePath);
    if (!isWithinRealBase(realFile, realDir)) {
      return null;
    }
    return JSON.parse(import_node_fs4.default.readFileSync(realFile, "utf8"));
  } catch {
    return null;
  }
}
function atomicWritePrivateFile(dirPath, fileName, content) {
  const realDir = ensureSafePrivateDir(dirPath);
  const targetPath = import_node_path6.default.join(realDir, fileName);
  try {
    const existing = import_node_fs4.default.lstatSync(targetPath);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error(`Refused to overwrite symlink or non-regular file: ${fileName}`);
    }
  } catch (err) {
    if (err?.code !== "ENOENT") {
      throw err;
    }
  }
  const nonce = import_node_crypto2.default.randomBytes(4).toString("hex");
  const tmpPath = import_node_path6.default.join(realDir, `.${fileName}.tmp.${process.pid}.${Date.now()}.${nonce}`);
  try {
    import_node_fs4.default.writeFileSync(tmpPath, content, { encoding: "utf8", mode: 384, flag: "wx" });
    try {
      import_node_fs4.default.chmodSync(tmpPath, 384);
    } catch {
    }
    import_node_fs4.default.renameSync(tmpPath, targetPath);
    return targetPath;
  } catch (err) {
    try {
      import_node_fs4.default.unlinkSync(tmpPath);
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
function validateGitArgs2(args) {
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
  if (!SAFE_EXECUTABLE_RE.test(executable) || FORBIDDEN_SHELL_EXECUTABLES2.has(executable)) {
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
    return validateGitArgs2(args);
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
function stripNestedPrivateBlocksLinear(input) {
  if (!input.includes("<")) return input;
  const openTag = "<private";
  const closeTag = "</private";
  const chunks = [];
  let cursor = 0;
  let i = 0;
  let depth = 0;
  const len = input.length;
  const isAsciiTagMatch = (pos, expected) => {
    if (pos + expected.length > len) return false;
    for (let k = 0; k < expected.length; k += 1) {
      let c = input.charCodeAt(pos + k);
      if (c >= 65 && c <= 90) c += 32;
      if (c !== expected.charCodeAt(k)) return false;
    }
    return true;
  };
  while (i < len) {
    if (input.charCodeAt(i) === 60) {
      if (isAsciiTagMatch(i, openTag)) {
        const after = i + openTag.length;
        const ch = after < len ? input.charCodeAt(after) : -1;
        if (ch === 62 || ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 47) {
          const endBracket = input.indexOf(">", after);
          if (endBracket !== -1) {
            const selfClosing = input.charCodeAt(endBracket - 1) === 47;
            if (depth === 0) {
              if (i > cursor) chunks.push(input.slice(cursor, i));
              chunks.push("[REDACTED_PRIVATE]");
            }
            if (!selfClosing) depth += 1;
            else if (depth === 0) cursor = endBracket + 1;
            i = endBracket + 1;
            continue;
          }
        }
      } else if (depth > 0 && isAsciiTagMatch(i, closeTag)) {
        const after = i + closeTag.length;
        const ch = after < len ? input.charCodeAt(after) : -1;
        if (ch === 62 || ch === 32 || ch === 9 || ch === 10 || ch === 13) {
          const endBracket = input.indexOf(">", after);
          if (endBracket !== -1) {
            depth -= 1;
            i = endBracket + 1;
            if (depth === 0) cursor = i;
            continue;
          }
        }
      }
    }
    i += 1;
  }
  if (depth === 0 && cursor < len) {
    chunks.push(input.slice(cursor));
  }
  return chunks.join("");
}
function stripMultilinePemAndPrivateLinear(input) {
  let out = stripNestedPrivateBlocksLinear(input);
  const beginMarker = "-----BEGIN ";
  if (out.includes(beginMarker)) {
    const chunks = [];
    let cur = 0;
    while (cur < out.length) {
      const start = out.indexOf(beginMarker, cur);
      if (start === -1) {
        chunks.push(out.slice(cur));
        break;
      }
      const headerEnd = out.indexOf("-----", start + beginMarker.length);
      if (headerEnd === -1) {
        chunks.push(out.slice(cur));
        break;
      }
      const label = out.slice(start + beginMarker.length, headerEnd);
      if (!/^[A-Z0-9 _-]{0,48}PRIVATE KEY(?: BLOCK)?$/i.test(label)) {
        chunks.push(out.slice(cur, headerEnd + 5));
        cur = headerEnd + 5;
        continue;
      }
      if (start > cur) chunks.push(out.slice(cur, start));
      chunks.push("[REDACTED_PRIVATE_KEY]");
      const endPrefix = "-----END ";
      let endIdx = out.indexOf(endPrefix, headerEnd + 5);
      let closedAt = -1;
      while (endIdx !== -1) {
        const footerEnd = out.indexOf("-----", endIdx + endPrefix.length);
        if (footerEnd === -1) break;
        const endLabel = out.slice(endIdx + endPrefix.length, footerEnd);
        if (/^[A-Z0-9 _-]{0,48}PRIVATE KEY(?: BLOCK)?$/i.test(endLabel)) {
          closedAt = footerEnd + 5;
          break;
        }
        endIdx = out.indexOf(endPrefix, footerEnd + 5);
      }
      cur = closedAt === -1 ? out.length : closedAt;
    }
    out = chunks.join("");
  }
  return out;
}
function stripAnsiEscapeCodes(input) {
  return input.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
}
function sliceTailUtf8Bytes(input, maxBytes) {
  const buf = Buffer.from(input, "utf8");
  if (buf.length <= maxBytes) return input;
  let offset = buf.length - maxBytes;
  while (offset < buf.length && (buf[offset] & 192) === 128) {
    offset += 1;
  }
  const sliced = buf.subarray(offset).toString("utf8");
  const firstNl = sliced.indexOf("\n");
  if (firstNl > 0 && firstNl < 256) {
    return sliced.slice(firstNl + 1);
  }
  return sliced;
}
function redactRawLogTail(rawText, maxBytes = MAX_RAW_LOG_BYTES) {
  const cleaned = stripAnsiEscapeCodes(rawText);
  const windowText = sliceTailUtf8Bytes(cleaned, maxBytes * 2);
  const blockStripped = stripMultilinePemAndPrivateLinear(windowText);
  const lines = blockStripped.split(/\r?\n/);
  const redactedLines = lines.map((line) => line.length === 0 ? "" : redactFeedText(line, 4096));
  const joined = `${redactedLines.join("\n")}
`;
  return sliceTailUtf8Bytes(joined, maxBytes);
}
function writeRedactedRawLogIfDataDirExists(rootDataDir, rawOutput) {
  if (!rootDataDir) return void 0;
  const realRoot = resolveSafeExistingDir(rootDataDir);
  if (!realRoot) return void 0;
  try {
    const modulesDir = import_node_path6.default.join(realRoot, "modules");
    const turboDir = import_node_path6.default.join(modulesDir, "turbo");
    const redactedTail = redactRawLogTail(rawOutput, MAX_RAW_LOG_BYTES);
    return atomicWritePrivateFile(turboDir, LAST_RAW_LOG_FILENAME, redactedTail);
  } catch {
    return void 0;
  }
}
function decodeAndRevalidatePayload(payloadB64) {
  if (typeof payloadB64 !== "string" || payloadB64.length === 0 || payloadB64.length > MAX_PAYLOAD_B64_LENGTH || !SAFE_B64URL_RE.test(payloadB64)) {
    return null;
  }
  let parsedJson;
  try {
    const decoded = Buffer.from(payloadB64, "base64url").toString("utf8");
    parsedJson = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
    return null;
  }
  const obj = parsedJson;
  if (typeof obj.executable !== "string" || !Array.isArray(obj.args)) {
    return null;
  }
  const rawArgs = [];
  for (const item of obj.args) {
    if (typeof item !== "string") return null;
    rawArgs.push(item);
  }
  const validated = validateSafeTokens(obj.executable, rawArgs);
  if (!validated.ok) {
    return null;
  }
  return validated;
}
function executeSafeCompactRun(input) {
  const validated = decodeAndRevalidatePayload(input.payloadB64);
  if (!validated) {
    const msg = "[agy-NOV Auto-RTK] Rejected unsafe or non-whitelisted compact-run payload.";
    return {
      exitCode: 126,
      output: msg,
      rawTokens: 0,
      summaryTokens: Math.ceil(msg.length / 4),
      savedTokens: 0
    };
  }
  const execCwd = typeof input.cwd === "string" && input.cwd.trim() ? import_node_path6.default.resolve(input.cwd) : process.cwd();
  const cmdLabel = [validated.executable, ...validated.args].join(" ").slice(0, 80);
  const child = (0, import_node_child_process.spawnSync)(validated.executable, validated.args, {
    cwd: execCwd,
    shell: false,
    timeout: COMPACT_RUN_TIMEOUT_MS,
    maxBuffer: COMPACT_RUN_MAX_BUFFER_BYTES,
    encoding: "utf8"
  });
  let exitCode;
  if (typeof child.status === "number") {
    exitCode = child.status;
  } else if (child.error) {
    const errCode = child.error.code;
    if (errCode === "ENOENT") exitCode = 127;
    else if (errCode === "ETIMEDOUT") exitCode = 124;
    else exitCode = 1;
  } else if (child.signal) {
    exitCode = 128;
  } else {
    exitCode = 1;
  }
  const stdout = typeof child.stdout === "string" ? child.stdout : "";
  const stderr = typeof child.stderr === "string" ? child.stderr : "";
  let combinedRaw = "";
  if (stdout && stderr) {
    combinedRaw = stdout.endsWith("\n") ? `${stdout}${stderr}` : `${stdout}
${stderr}`;
  } else {
    combinedRaw = stdout || stderr;
  }
  if (!combinedRaw && child.error) {
    combinedRaw = child.error.message;
  }
  const rawTokens = Math.ceil(combinedRaw.length / 4);
  const store = new CompactedChunkStore(1);
  let bodyText;
  if (!combinedRaw.trim()) {
    bodyText = `[Turbo Auto-RTK] ${cmdLabel} [preset=${validated.preset}, exit=${exitCode}] (no output)`;
  } else {
    const compacted = store.compact(void 0, cmdLabel, combinedRaw, {
      preset: validated.preset,
      maxErrorLines: 60,
      tailLines: 50,
      persistStats: false
    });
    bodyText = compacted.summaryText;
    if (exitCode !== 0) {
      const cleanedLines = stripAnsiEscapeCodes(combinedRaw).split(/\r?\n/);
      let lastNonEmptyIdx = cleanedLines.length - 1;
      while (lastNonEmptyIdx >= 0 && cleanedLines[lastNonEmptyIdx].trim() === "") {
        lastNonEmptyIdx -= 1;
      }
      const effectiveLines = lastNonEmptyIdx >= 0 ? cleanedLines.slice(0, lastNonEmptyIdx + 1) : [];
      const tailSlice = effectiveLines.slice(-FAILURE_TAIL_MIN_LINES);
      const nonEmptyTail = tailSlice.filter((l) => l.trim().length > 0);
      const missingAnyTailLine = nonEmptyTail.some((line) => !bodyText.includes(line));
      if (missingAnyTailLine && tailSlice.length > 0) {
        bodyText = [
          bodyText,
          `--- Preserved Failure Tail (exitCode=${exitCode}, last ${tailSlice.length} lines) ---`,
          ...tailSlice
        ].join("\n");
      }
    }
  }
  const rawLogPath = writeRedactedRawLogIfDataDirExists(input.dataDir, combinedRaw);
  const footerLine = rawLogPath ? `[Auto-RTK] exit=${exitCode} \xB7 raw tail (redacted, <=128 KiB): ${rawLogPath}` : `[Auto-RTK] exit=${exitCode}`;
  const finalOutput = `${bodyText}
${footerLine}`;
  const summaryTokens = Math.ceil(finalOutput.length / 4);
  const savedTokens = Math.max(0, rawTokens - summaryTokens);
  return {
    exitCode,
    output: finalOutput,
    rawTokens,
    summaryTokens,
    savedTokens,
    ...rawLogPath ? { rawLogPath } : {}
  };
}

// src/server/cli.ts
var CLI_VERSION = "0.8.0";
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
  agy-nov compact-run --payload=<b64> [--data-dir=<dir>]        Auto-RTK whitelisted shell-free compact command runner
`);
}
function readJsonSilent(filePath) {
  try {
    if (!import_node_fs5.default.existsSync(filePath)) return null;
    const raw = JSON.parse(import_node_fs5.default.readFileSync(filePath, "utf8"));
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
    const verifyState = readJsonSilent(import_node_path7.default.join(getModuleDataDir(dataDir, "verify"), "state.json"));
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
    const specState = readJsonSilent(import_node_path7.default.join(getModuleDataDir(dataDir, "spec"), "state.json"));
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
    const capsule = readJsonSilent(import_node_path7.default.join(radarDir, "status-capsule.json"));
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
      const board = readJsonSilent(import_node_path7.default.join(radarDir, "board.json"));
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
    const live = readJsonSilent(import_node_path7.default.join(getModuleDataDir(dataDir, "xray"), "live-state.json"));
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
  console.log(`  Config File:    ${getConfigPath(dataDir)} (${import_node_fs5.default.existsSync(getConfigPath(dataDir)) ? "persisted" : "defaults"})`);
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
  const resolvedRoot = import_node_path7.default.resolve(workspaceRoot);
  let realRoot = resolvedRoot;
  try {
    realRoot = import_node_fs5.default.realpathSync(resolvedRoot);
  } catch {
  }
  const exists = (rel) => {
    try {
      return import_node_fs5.default.existsSync(import_node_path7.default.join(realRoot, rel));
    } catch {
      return false;
    }
  };
  const detectedStacks = [];
  let hasMultipleTestsOrScripts = false;
  if (exists("package.json")) {
    detectedStacks.push("Node.js / TypeScript");
    const pkg = readJsonSilent(import_node_path7.default.join(realRoot, "package.json"));
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
    const entries = import_node_fs5.default.readdirSync(realRoot, { withFileTypes: true }).slice(0, 120);
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
  const scriptDir = import_node_path7.default.dirname(process.argv[1] || process.cwd());
  const candidates = [
    import_node_path7.default.resolve(scriptDir, ".."),
    import_node_path7.default.resolve(scriptDir, "../.."),
    process.cwd()
  ];
  for (const dir of candidates) {
    if (import_node_fs5.default.existsSync(import_node_path7.default.join(dir, "plugin.json"))) {
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
    const abs = import_node_path7.default.join(rootDir, rel);
    const exists = import_node_fs5.default.existsSync(abs);
    if (!exists) ok = false;
    const size = exists ? `${(import_node_fs5.default.statSync(abs).size / 1024).toFixed(1)} KB` : "MISSING";
    console.log(`  ${exists ? "OK  " : "FAIL"} ${rel.padEnd(28)} ${size}`);
  }
  const pluginPath = import_node_path7.default.join(rootDir, "plugin.json");
  if (import_node_fs5.default.existsSync(pluginPath)) {
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
    const manifest = JSON.parse(import_node_fs5.default.readFileSync(pluginPath, "utf8"));
    const unknown = Object.keys(manifest).filter((k) => !allowedKeys.has(k));
    if (unknown.length > 0) {
      ok = false;
      console.log(`  FAIL plugin.json contains unknown keys: ${unknown.join(", ")}`);
    } else {
      console.log(`  OK   plugin.json schema clean (name=${String(manifest.name)}, version=${String(manifest.version)})`);
    }
  }
  const uiPath = import_node_path7.default.join(rootDir, "dist/ui/app.html");
  if (import_node_fs5.default.existsSync(uiPath)) {
    const bytes = import_node_fs5.default.statSync(uiPath).size;
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
  const turboPrefs = loadTurboPrefsReadOnly(getModuleDataDir(dataDir, "turbo"));
  const autoRtkActive = cfg.modules.turbo && turboPrefs.autoRtk;
  console.log(
    `  OK   Auto-RTK: ${turboPrefs.autoRtk ? autoRtkActive ? "ON (active)" : "ON (waiting for turbo module)" : "OFF (default safe passive mode)"}`
  );
  const feedPath = getFeedSnapshotPath(dataDir);
  let feedStatusTag = "OK  ";
  let feedNote = "not generated yet (lazy read-only until first write)";
  try {
    const feedStat = import_node_fs5.default.lstatSync(feedPath);
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
  if (cmd === "compact-run") {
    const payloadB64 = parseCliFlag(argv, "--payload");
    if (!payloadB64) {
      console.error("[agy-NOV Auto-RTK] Missing required --payload=<base64url> argument.");
      process.exit(2);
    }
    const result = executeSafeCompactRun({
      payloadB64,
      cwd: process.cwd(),
      dataDir
    });
    if (result.output) {
      process.stdout.write(result.output.endsWith("\n") ? result.output : `${result.output}
`);
    }
    process.exit(result.exitCode);
  }
  console.error(`Unknown command "${cmd}".`);
  printHelp();
  process.exit(2);
}
main();
