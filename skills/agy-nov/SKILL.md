---
name: agy-nov
description: Open and manage agy-NOV (v0.3.0), the 100% native modular super-workbench for Google Antigravity 2.0 (Zero ASAR, Zero CDP, survives every client update). Packs 11 independently toggleable superpowers (Diff Review, Secret Shield & Pre-Edit Snapshots, Context X-Ray with Swarm Lineage, Turbo Batch Search & Output Guard, Session Radar & Subagent Monitor, Stop-Hook Verify Gate, Git Worktree Orchestrator, Visual Canvas, Code-Anchored Memory Graph, Prompt Vault & Workspace Doctor, and Opt-In Mobile/IM Remote) with built-in 8-language UI, zero-token CLI statusLine, and zero token tax when off.
---

# agy-NOV — 100% Native Modular Super-Workbench for Antigravity 2.0

`agy-NOV` unifies 11 high-demand Google Antigravity 2.0 workflows into one strictly official native plugin (Zero ASAR, Zero CDP) with live per-module toggles, 5 presets, zero-token CLI `statusline`, and built-in **8-language UI** (`English`, `简体中文`, `繁體中文`, `日本語`, `한국어`, `Español`, `Français`, `Deutsch`). Disabled modules unregister immediately from `tools/list` (0 token tax) and short-circuit hooks in O(1).

## Core Entry Tools (Always Available)

- `nov_open`: Open the unified **agy-NOV** side-pane or global workbench (pass `module`: `review`, `guard`, `xray`, `turbo`, `radar`, `verify`, `worktree`, `canvas`, `mem`, `ops`, `remote`, or `modules`).
- `nov_status`: Inspect enabled modules, active preset, UI locale, exposed model tool count, and network isolation status.

## 11 Toggleable Native Modules (Tools Exposed Only When Enabled)

### Tier 1 — 10 Local Offline Native Modules (100% Offline)
- **Review** (`review_*`, default ON, 2 tools): Line-by-line Git diff review with categorized annotations and structured `file:line` fix prompts.
- **Guard** (`guard_*`, default ON, 4 tools): `.env`/SSH/secret leak shield, destructive command firewall, and zero-Git pre-edit file snapshots.
- **X-Ray** (`xray_*`, default ON, 4 tools): Real cached vs. fresh token breakdown, Swarm subagent lineage, multi-model cost breakdown, HTTP 429 retry alerts, workspace file activity, and EN+CJK BM25 cross-session search.
- **Turbo** (`turbo_*`, opt-in, 3 tools): Multi-pattern workspace batch search, top-level symbol outline slicing, and compact indexed log compression.
- **Radar** (`radar_*`, opt-in, 2 tools): Multi-session & parent/child Swarm subagent attention board (`running`, `awaiting_approval`, `completed`, `stalled`, `error`), orphan subagent alerts, `status-capsule.json` export, and optional chime.
- **Verify** (`verify_*`, opt-in, 4 tools): Stop-hook verification gate blocking 0-byte writes and unverified completions via shell-free allowlisted checks, `continuation_active` awareness, anti-loop `maxConsecutiveBlocks` guardrails, and redacted evidence chains.
- **Worktree** (`worktree_*`, opt-in, 4 tools): Safe parallel Git worktree orchestrator confined to `.agy-worktrees/` with `carryUncommitted` transfer, branch diff summaries, `extensions.worktreeConfig` hazard detection, and safe orphan/merged cleanup.
- **Canvas** (`canvas_*`, opt-in, 4 tools): Sandboxed HTML/SVG/Slides/Markdown/image preview with numbered visual pin annotations.
- **Memory** (`mem_*`, opt-in, 3 tools): SHA-256 code-anchored architectural memory with `SessionStart` recall and stale drift checks.
- **Ops** (`ops_*`, opt-in, 3 tools): Parameterized `{{var}}` Prompt Vault plus read-only workspace rules/skills/MCP token & storage audit.

### Tier 2 — 1 Strictly Opt-In Remote Bridge (OFF by Default)
- **Remote** (`remote_*`, default OFF, 4 tools): Local mobile PWA and Telegram/Feishu/DingTalk/WeCom/Slack/Discord alerts, risky command approval, and task dispatch.

## Presets & CLI Safety Verification (7 CLI Commands)

- Presets (exact model tool counts incl. `nov_open` + `nov_status`): `minimal` (1 mod / 6 tools), `core` *(default, 3 mods / 12 tools)*, `power` (8 mods / 28 tools), `local-all` (10 offline mods / 35 tools), `full` (11 mods incl. `remote` / 39 tools).
- Read-only health check: `node dist/cli.cjs doctor`
- Inspect status & tool count: `node dist/cli.cjs status`
- Zero-token CLI status line: `node dist/cli.cjs statusline [--compact] [--json]`
- Switch presets: `node dist/cli.cjs preset <minimal|core|power|local-all|full>`
- Toggle single module: `node dist/cli.cjs enable|disable <review|guard|xray|turbo|radar|verify|worktree|canvas|mem|ops|remote>`
- Switch plugin UI language: `node dist/cli.cjs locale <auto|en|zh-CN|zh-TW|ja|ko|es|fr|de>`
- Never enable `remote` without explicit user consent; it stays strictly inert (zero ports, zero polling, zero outbound calls, zero writes) while OFF.
