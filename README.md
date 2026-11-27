# agy-NOV

[简体中文](./README.zh-CN.md)

**One native, modular MCP App workbench for Google Antigravity 2.0.**  
PR-grade inline diff review, pre-edit file snapshots & secret shield, context X-Ray, visual artifact canvas, code-anchored memory graph, and opt-in mobile/IM remote control — **toggle any module on or off anytime**.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/Node-%3E%3D20-339933.svg)](https://nodejs.org)
[![Zero ASAR / Zero CDP](https://img.shields.io/badge/Injection-Zero%20ASAR%20%2F%20Zero%20CDP-0ea5e9.svg)](#architecture)
[![MCP Apps SEP-1865](https://img.shields.io/badge/Protocol-MCP%20Apps%20(SEP--1865)-6366f1.svg)](#architecture)

---

## Why One Modular Workbench?

Installing six separate plugins means six resident Node processes, duplicated UI bundles, multiple forked hooks per tool call, and dozens of model tool schemas consuming context every turn.

**`agy-NOV` consolidates all six capabilities into a single native plugin** with a live **Modules Switchboard**:
- **1 resident MCP server + 1 unified hook dispatcher + 1 self-contained single-file UI**
- **Dynamic model tool visibility**: disabled modules unregister from the model's `tools/list` (`0` extra token tax) and short-circuit hooks immediately.
- **Strict offline-first default**: `Remote` is **OFF by default** — zero listening ports, zero background polling, zero outbound network requests unless you explicitly toggle it ON.
- **Zero Electron / ASAR / CDP patching**: built strictly on Google Antigravity 2.0's official MCP Apps (`aux_pane` + `global`), Lifecycle Hooks, and Skills specs. Survives every client update.

---

## 6 Toggleable Modules

| Module | Default | Privacy / Network | Model Tools | Lifecycle Hooks | What It Does |
| :--- | :---: | :--- | :---: | :--- | :--- |
| **Diff Review** (`review`) | **ON** | 100% Offline | 2 | `PostToolUse`, `Stop` | PR-grade working-tree/staged diff viewer with line-level annotations and one-click structured fix prompts. |
| **Guard & Snapshots** (`guard`) | **ON** | 100% Offline | 4 | `PreToolUse` | Blocks `.env`/SSH/credential leaks and destructive shell commands; auto-snapshots files before edits without touching Git; 1-click diff rollback. |
| **Context X-Ray** (`xray`) | **ON** | 100% Offline | 4 | `PostToolUse`, `Stop` | Real cached vs. fresh token breakdown, "Token Vampire" ranking, live workspace file tree (`toggle-aux-pane`), and EN+CJK BM25 cross-session search. |
| **Visual Canvas** (`canvas`) | OFF | 100% Offline | 4 | None | Sandboxed preview for HTML prototypes, SVG diagrams, slide decks, Markdown specs & images with numbered visual pin/region annotations. |
| **Memory Graph** (`mem`) | OFF | 100% Offline | 3 | `SessionStart`, `Stop` | Glass-box architectural memory anchored to SHA-256 file hashes, automatic SessionStart recall, and stale-drift detection. |
| **Mobile & IM Remote** (`remote`) | OFF | Opt-in Network | 4 | `PreToolUse`, `Stop` | Local PWA + Telegram / Feishu / DingTalk / WeCom / Slack / Discord alerts, remote risky-command approval, and background task dispatch. |

### One-Click Presets

- **`core` (default)**: `review` + `guard` + `xray` — 100% offline local essentials (12 model tools total including `nov_open` & `nov_status`).
- **`local-all`**: All 5 local modules enabled; `remote` stays strictly offline.
- **`full`**: All 6 modules enabled including the Mobile/IM Remote hub.
- **`minimal`**: `guard` only (6 model tools total) for maximum minimalism.

---

## Quick Start

### 1. Install into Antigravity 2.0

```bash
agy plugin install https://github.com/tone-leh/agy-NOV
```

Or clone manually into your plugins directory:

```bash
git clone https://github.com/tone-leh/agy-NOV.git ~/.gemini/config/plugins/agy-nov
```

Open **agy-NOV** from the side pane `+` menu or the left sidebar, then click **Modules** in the top-right corner to toggle features or switch presets anytime.

### 2. Preview Safely Offline (Without Touching Your Daily Antigravity)

```bash
git clone https://github.com/tone-leh/agy-NOV.git
cd agy-NOV
npm ci
npm run workbench
```

Opens a local zero-touch simulator at `http://127.0.0.1:4399` with synthetic demo data, dark/light theme toggle, `480px` side-pane / `1160px` global width presets, and a live Host Events inspector.

### 3. Manage Modules via CLI

```bash
node dist/cli.cjs status
node dist/cli.cjs enable canvas
node dist/cli.cjs disable xray
node dist/cli.cjs preset local-all
node dist/cli.cjs doctor
```

---

## Architecture

```text
Antigravity 2.0 Host (Desktop / CLI / IDE)
 ├── Single MCP Server (dist/server.cjs)
 │    ├── Always-on: nov_open, nov_status, nov_app_{get_config,set_module,apply_preset}
 │    ├── Dynamic Tool Visibility (RegisteredTool.enable / .disable -> tools/list_changed)
 │    └── Unified Single-File UI Resource: ui://agy-nov/app.html (< 10 MiB, auto dark/light)
 ├── Unified Hook Dispatcher (dist/hook.cjs)
 │    ├── Reads <dataDir>/config.json read-only first; disabled modules short-circuit in O(1)
 │    └── Normalizes camelCase & snake_case hook payloads across PreToolUse / PostToolUse / SessionStart / Stop
 └── Per-Module Isolated Data Storage (<dataDir>/modules/<moduleId>/, mode 0700 / 0600)
```

---

## Companion Project

- **[agy-session-guard](https://github.com/tone-leh/agy-session-guard)**: Standalone CDP-based session copilot for custom `/compact` thresholds, draft vault, and turn bookmarks (kept separate to preserve `agy-NOV`'s zero-CDP guarantee).

## License

MIT © [tone-leh](https://github.com/tone-leh)
