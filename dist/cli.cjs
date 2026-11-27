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

// src/server/cli.ts
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);

// src/core/config.ts
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path = __toESM(require("node:path"), 1);

// src/core/catalog.ts
var MODULE_IDS = ["review", "guard", "xray", "canvas", "mem", "remote"];
var PRESET_IDS = ["core", "local-all", "full", "minimal"];
var MODULE_CATALOG = {
  review: {
    id: "review",
    name: "Diff Review",
    shortLabel: "Review",
    tagline: "PR-grade inline diff review & line annotations",
    description: "Review working-tree, staged, or commit diffs line by line, drop categorized comments, and send pinpoint file:line fix prompts back to the agent.",
    networkAccess: "offline",
    defaultEnabled: true,
    hooks: ["PostToolUse", "Stop"],
    modelToolNames: ["review_open", "review_get_summary"]
  },
  guard: {
    id: "guard",
    name: "Guard & Snapshots",
    shortLabel: "Guard",
    tagline: "Secret leak shield, command firewall & pre-edit snapshots",
    description: "Blocks .env/SSH/credential leaks and destructive commands before execution, snapshots files prior to edits without touching Git, and restores in one click.",
    networkAccess: "offline",
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
    name: "Context X-Ray",
    shortLabel: "X-Ray",
    tagline: "Token breakdown, live file tree & cross-session search",
    description: "Inspect real cached vs. fresh tokens per turn, identify token-heavy tools, open touched workspace files in one click, and search past sessions with EN+CJK BM25.",
    networkAccess: "offline",
    defaultEnabled: true,
    hooks: ["PostToolUse", "Stop"],
    modelToolNames: [
      "xray_analyze_context",
      "xray_get_file_activity",
      "xray_search_sessions",
      "xray_export_brief"
    ]
  },
  canvas: {
    id: "canvas",
    name: "Visual Canvas",
    shortLabel: "Canvas",
    tagline: "HTML/SVG/Slides/Markdown visual preview & pin annotations",
    description: "Render web mockups, SVG diagrams, slide decks, Markdown specs, and images in an isolated sandbox, drop numbered visual pins, and send edits back to the agent.",
    networkAccess: "offline",
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
    name: "Memory Graph",
    shortLabel: "Memory",
    tagline: "Code-anchored long-term memory with drift detection",
    description: "Capture architectural decisions anchored to SHA-256 file hashes, auto-recall relevant context at SessionStart, and flag stale memories when code changes.",
    networkAccess: "offline",
    defaultEnabled: false,
    hooks: ["SessionStart", "Stop"],
    modelToolNames: ["mem_remember", "mem_recall", "mem_forget"]
  },
  remote: {
    id: "remote",
    name: "Mobile & IM Remote",
    shortLabel: "Remote",
    tagline: "Opt-in Mobile PWA & IM remote alerts / risky approvals",
    description: "Strictly OFF by default (zero ports, zero outbound requests). When enabled, pairs your phone PWA or Telegram/Feishu/DingTalk/WeCom/Slack/Discord webhooks for task alerts and approvals.",
    networkAccess: "opt-in-network",
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
var PRESET_DEFINITIONS = {
  core: {
    id: "core",
    label: "Core (Default)",
    description: "Review + Guard + X-Ray \u2014 100% offline local essentials with low token footprint.",
    modules: { review: true, guard: true, xray: true, canvas: false, mem: false, remote: false }
  },
  "local-all": {
    id: "local-all",
    label: "Local All (5 Offline)",
    description: "All 5 local modules enabled; Remote stays completely off with zero network activity.",
    modules: { review: true, guard: true, xray: true, canvas: true, mem: true, remote: false }
  },
  full: {
    id: "full",
    label: "Full Suite (6 Modules)",
    description: "All 6 modules including the opt-in Mobile PWA / IM remote approval hub.",
    modules: { review: true, guard: true, xray: true, canvas: true, mem: true, remote: true }
  },
  minimal: {
    id: "minimal",
    label: "Minimal Shield",
    description: "Guard only \u2014 secret shield & pre-edit snapshots with minimum model tool overhead.",
    modules: { review: false, guard: true, xray: false, canvas: false, mem: false, remote: false }
  }
};
function isModuleId(value) {
  return typeof value === "string" && MODULE_IDS.includes(value);
}
function isPresetId(value) {
  return typeof value === "string" && PRESET_IDS.includes(value);
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
function getConfigPath(rootDataDir) {
  return import_node_path.default.join(rootDataDir, "config.json");
}
function createDefaultConfig() {
  return {
    schemaVersion: 1,
    preset: "core",
    modules: { ...PRESET_DEFINITIONS.core.modules },
    defaultTab: "review",
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
  const enabledList = MODULE_IDS.filter((id) => modules[id]);
  const defaultTab = isModuleId(obj.defaultTab) && modules[obj.defaultTab] ? obj.defaultTab : enabledList[0] ?? "review";
  return {
    schemaVersion: 1,
    preset: detectPreset(modules),
    modules,
    defaultTab,
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
    defaultTab: enabled ? moduleId : current.defaultTab
  });
}
function applyPresetConfig(rootDataDir, preset) {
  const current = loadOrInitNovConfig(rootDataDir);
  const def = PRESET_DEFINITIONS[preset];
  return saveNovConfig(rootDataDir, {
    ...current,
    preset,
    modules: { ...def.modules },
    defaultTab: MODULE_IDS.find((id) => def.modules[id]) ?? "review"
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

// src/server/cli.ts
function printHelp() {
  console.log(`agy-NOV CLI (v0.1.0) \u2014 Modular Native MCP App Workbench for Antigravity 2.0

Usage:
  agy-nov status [--data-dir=<dir>]          Show enabled modules, preset & token footprint
  agy-nov enable <module> [--data-dir=<dir>] Enable a module (${MODULE_IDS.join(" | ")})
  agy-nov disable <module> [--data-dir=<dir>] Disable a module
  agy-nov preset <name> [--data-dir=<dir>]   Apply preset (${PRESET_IDS.join(" | ")})
  agy-nov doctor [--data-dir=<dir>]          Verify plugin bundle, manifests & config health
`);
}
function printStatus(dataDir) {
  const cfg = loadNovConfigReadOnly(dataDir);
  const enabledCount = MODULE_IDS.filter((id) => cfg.modules[id]).length;
  const modelTools = countEnabledModelTools(cfg.modules);
  console.log(`agy-NOV Status`);
  console.log(`  Data Dir:     ${dataDir}`);
  console.log(`  Config File:  ${getConfigPath(dataDir)} (${import_node_fs2.default.existsSync(getConfigPath(dataDir)) ? "persisted" : "defaults"})`);
  console.log(`  Preset:       ${cfg.preset}`);
  console.log(`  Modules:      ${enabledCount}/${MODULE_IDS.length} enabled (${modelTools} model tools)`);
  console.log(`  Network:      ${cfg.modules.remote ? "Remote Hub enabled (opt-in)" : "100% offline"}`);
  console.log("");
  for (const id of MODULE_IDS) {
    const meta = MODULE_CATALOG[id];
    const flag = cfg.modules[id] ? "ON " : "OFF";
    const net = meta.networkAccess === "offline" ? "offline" : "opt-in-net";
    console.log(
      `  [${flag}] ${id.padEnd(8)} ${meta.name.padEnd(20)} (${meta.modelToolNames.length} tools \xB7 ${net})`
    );
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
  console.log("agy-NOV Doctor");
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
      console.log(`  OK   plugin.json schema clean (name=${String(manifest.name)})`);
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
  console.log(`  OK   config readable (preset=${cfg.preset}, remote=${cfg.modules.remote ? "ON" : "OFF"})`);
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
  if (cmd === "doctor") {
    process.exit(runDoctor(dataDir));
  }
  console.error(`Unknown command "${cmd}".`);
  printHelp();
  process.exit(2);
}
main();
