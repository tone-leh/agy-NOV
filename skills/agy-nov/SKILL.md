---
name: agy-nov
description: Open and manage agy-NOV (v0.4.0), the 100% native modular super-workbench for Google Antigravity 2.0 (Zero ASAR, Zero CDP, survives every client update). Packs 13 independently toggleable superpowers (Diff Review, Secret Shield & Pre-Edit Snapshots, Context X-Ray with Swarm Lineage, Turbo RTK Output Guard, Session Radar & Subagent Monitor, Stop-Hook Verify Gate, Git Worktree Orchestrator, Spec Flow & Task DAG, Workspace Studio, Visual Canvas, Code-Anchored Memory Graph, Prompt Vault & Budget Doctor, and Opt-In Mobile/IM Remote) with built-in 8-language UI, zero-token CLI statusLine, and zero token tax when off.
---

# agy-NOV — 100% Native Modular Super-Workbench for Antigravity 2.0

`agy-NOV` unifies 13 high-demand Google Antigravity 2.0 workflows into one strictly official native plugin (Zero ASAR, Zero CDP) with live per-module toggles, 5 presets, zero-token CLI `statusline`, and built-in **8-language UI** (`English`, `简体中文`, `繁體中文`, `日本語`, `한국어`, `Español`, `Français`, `Deutsch`). Disabled modules unregister immediately from `tools/list` (`0` token & tool-slot tax against the 100-tool hard limit) and short-circuit hooks in O(1).

## Core Entry Tools (Always Available — 2 Tools)

- `nov_open`: Open the unified **agy-NOV** side-pane or global workbench (pass `module`: `review`, `guard`, `xray`, `turbo`, `radar`, `verify`, `worktree`, `spec`, `studio`, `canvas`, `mem`, `ops`, `remote`, or `modules`).
- `nov_status`: Inspect enabled modules, active preset, UI locale, exposed model tool count, and network isolation status.

## 13 Toggleable Native Modules (Tools Exposed Only When Enabled)

### Tier 1 — 12 Local Offline Native Modules (100% Offline)
- **Review** (`review_open`, `review_get_summary` · default ON, 2 tools): Line-by-line Git diff review with categorized annotations and structured `file:line` fix prompts.
- **Guard** (`guard_status`, `guard_list_snapshots`, `guard_create_checkpoint`, `guard_scan_secrets` · default ON, 4 tools): `.env`/SSH/secret leak shield, destructive command firewall, and zero-Git pre-edit file snapshots.
- **X-Ray** (`xray_analyze_context`, `xray_get_file_activity`, `xray_search_sessions`, `xray_export_brief` · default ON, 4 tools): Real cached vs. fresh token breakdown, Swarm subagent lineage, multi-model cost breakdown, HTTP 429 retry alerts, workspace file activity, and EN+CJK BM25 cross-session search.
- **Turbo** (`turbo_batch_search`, `turbo_read_outline`, `turbo_compact_output` · opt-in, 3 tools): Multi-pattern workspace batch search, top-level symbol outline slicing, and RTK-style smart output compression presets (`auto`/`test`/`build`/`git`/`generic`) with in-memory LRU chunk queries.
- **Radar** (`radar_get_board`, `radar_ack_session` · opt-in, 2 tools): Multi-session & parent/child Swarm subagent attention board (`running`, `awaiting_approval`, `completed`, `stalled`, `error`), orphan subagent alerts, `status-capsule.json` export, and optional chime.
- **Verify** (`verify_get_policy`, `verify_set_policy`, `verify_run_checks`, `verify_get_evidence` · opt-in, 4 tools): Stop-hook verification gate blocking 0-byte writes and unverified completions via shell-free allowlisted checks, `continuation_active` awareness, anti-loop `maxConsecutiveBlocks` guardrails, and redacted evidence chains.
- **Worktree** (`worktree_list`, `worktree_create`, `worktree_diff_summary`, `worktree_cleanup` · opt-in, 4 tools): Safe parallel Git worktree orchestrator confined to `.agy-worktrees/` with `carryUncommitted` transfer, branch diff summaries, `extensions.worktreeConfig` hazard detection, and safe orphan/merged cleanup.
- **Spec** (`spec_get_state`, `spec_create_or_update`, `spec_approve`, `spec_update_task` · opt-in, 4 tools): Spec-driven `Spec -> Plan -> Task DAG` workflow with Kahn cycle detection, dependency-gated task advancement, `SessionStart` next-task recall, `PreToolUse` draft write lock (`enforcePlanBeforeWrite`), and `requireUiApproval` blocking model self-approval.
- **Studio** (`studio_list_sources`, `studio_inspect_data`, `studio_inspect_document`, `studio_http_probe` · opt-in, 4 tools): On-demand local debugger with read-only SQLite + CSV/TSV/JSON/NDJSON inspection, pure-Node offline DOCX/XLSX/PDF/Markdown slicing (ZIP-bomb guards), and strict loopback-only anti-SSRF HTTP probing — toggle OFF when idle for `0` tool-budget tax.
- **Canvas** (`canvas_publish_artifact`, `canvas_open_file`, `canvas_get_feedback`, `canvas_resolve_annotations` · opt-in, 4 tools): Sandboxed HTML/SVG/Slides/Markdown/image preview with numbered visual pin annotations.
- **Memory** (`mem_remember`, `mem_recall`, `mem_forget` · opt-in, 3 tools): SHA-256 code-anchored architectural memory with `SessionStart` recall and stale drift checks.
- **Ops** (`ops_list_prompts`, `ops_render_prompt`, `ops_audit_workspace` · opt-in, 3 tools): Parameterized `{{var}}` Prompt Vault plus read-only Budget Doctor auditing 24KB/20K rule bloat (false 429 guard), 100-tool MCP budget usage, static MCP config health, skills, and local storage.

### Tier 2 — 1 Strictly Opt-In Remote Bridge (OFF by Default)
- **Remote** (`remote_status`, `remote_send_alert`, `remote_list_conversations`, `remote_dispatch_task` · default OFF, 4 tools): Local mobile PWA and Telegram/Feishu/DingTalk/WeCom/Slack/Discord alerts, risky command approval, and task dispatch.

## Presets & CLI Safety Verification (7 CLI Commands)

- Presets (exact model tool counts incl. `nov_open` + `nov_status`): `minimal` (1 mod / 6 tools), `core` *(default, 3 mods / 12 tools)*, `power` (9 mods / 32 tools), `local-all` (12 offline mods / 43 tools), `full` (13 mods incl. `remote` / 47 tools).
- Read-only health check: `node dist/cli.cjs doctor`
- Inspect status & tool count: `node dist/cli.cjs status`
- Zero-token CLI status line (incl. `Spec:LOCK(done/total)`): `node dist/cli.cjs statusline [--compact] [--json]`
- Switch presets: `node dist/cli.cjs preset <minimal|core|power|local-all|full>`
- Toggle single module: `node dist/cli.cjs enable|disable <review|guard|xray|turbo|radar|verify|worktree|spec|studio|canvas|mem|ops|remote>`
- Switch plugin UI language: `node dist/cli.cjs locale <auto|en|zh-CN|zh-TW|ja|ko|es|fr|de>`
- Guardrails: Never enable `remote` without explicit user consent (it stays strictly inert with zero ports, zero polling, zero outbound calls, and zero writes while OFF). Respect `requireUiApproval` on `spec`, and disable on-demand `studio` after debugging to keep tool budgets lean.
