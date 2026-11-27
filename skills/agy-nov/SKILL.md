---
name: agy-nov
description: Open and manage agy-NOV, the 100% native modular super-workbench for Google Antigravity 2.0 (Zero ASAR, Zero CDP, survives every client update). Packs 9 independently toggleable superpowers (Diff Review, Secret Shield & Pre-Edit Snapshots, Context X-Ray, Turbo Batch Search & Output Guard, Session Radar & Chime, Visual Canvas, Code-Anchored Memory Graph, Prompt Vault & Workspace Doctor, and Opt-In Mobile/IM Remote) with built-in 8-language UI and zero token tax when off.
---

# agy-NOV — 100% Native Modular Super-Workbench for Antigravity 2.0

`agy-NOV` unifies 9 high-demand Google Antigravity 2.0 workflows into one strictly official native plugin (Zero ASAR, Zero CDP) with live per-module toggles, 5 presets, and built-in **8-language UI** (`English`, `简体中文`, `繁體中文`, `日本語`, `한국어`, `Español`, `Français`, `Deutsch`). Disabled modules unregister immediately from `tools/list` (0 token tax) and short-circuit hooks in O(1).

## Core Entry Tools (Always Available)

- `nov_open`: Open the unified **agy-NOV** side-pane or global workbench (pass `module`: `review`, `guard`, `xray`, `turbo`, `radar`, `canvas`, `mem`, `ops`, `remote`, or `modules`).
- `nov_status`: Inspect enabled modules, active preset, UI locale, exposed model tool count, and network isolation status.

## 9 Toggleable Native Modules (Tools Exposed Only When Enabled)

### Tier 1 — 8 Local Offline Native Modules (100% Offline)
- **Review** (`review_*`, default ON): Line-by-line Git diff review with categorized annotations and structured `file:line` fix prompts.
- **Guard** (`guard_*`, default ON): `.env`/SSH/secret leak shield, destructive command firewall, and zero-Git pre-edit file snapshots.
- **X-Ray** (`xray_*`, default ON): Real cached vs. fresh token breakdown, workspace file activity, and EN+CJK BM25 cross-session search.
- **Turbo** (`turbo_*`, opt-in): Multi-pattern workspace batch search, top-level symbol outline slicing, and compact indexed log compression.
- **Radar** (`radar_*`, opt-in): Multi-session attention board (`running`, `awaiting_approval`, `completed`, `stalled`, `error`) with optional chime alerts.
- **Canvas** (`canvas_*`, opt-in): Sandboxed HTML/SVG/Slides/Markdown/image preview with numbered visual pin annotations.
- **Memory** (`mem_*`, opt-in): SHA-256 code-anchored architectural memory with `SessionStart` recall and stale drift checks.
- **Ops** (`ops_*`, opt-in): Parameterized `{{var}}` Prompt Vault plus read-only workspace rules/skills/MCP token & storage audit.

### Tier 2 — 1 Strictly Opt-In Remote Bridge (OFF by Default)
- **Remote** (`remote_*`, default OFF): Local mobile PWA and Telegram/Feishu/DingTalk/WeCom/Slack/Discord alerts, risky command approval, and task dispatch.

## CLI & Safety Verification

- Read-only health check: `node dist/cli.cjs doctor`
- Inspect status & tool count: `node dist/cli.cjs status`
- Switch presets: `node dist/cli.cjs preset <minimal|core|power|local-all|full>`
- Switch plugin UI language: `node dist/cli.cjs locale <auto|en|zh-CN|zh-TW|ja|ko|es|fr|de>`
- Never enable `remote` without explicit user consent; it stays strictly inert (zero ports, zero polling, zero outbound calls, zero writes) while OFF.
