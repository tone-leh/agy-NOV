---
name: agy-nov
description: Open and manage agy-NOV (v0.5.0), the 100% native modular super-workbench for Google Antigravity 2.0 (Zero ASAR, Zero CDP, survives every client update). Packs 13 independently toggleable superpowers (Diff Review with pure-React syntax highlighting & -w/risk hints, Secret Shield & Pre-Edit Snapshots, Context X-Ray 2.0 with offline USD billing & handoff/OTLP/CSV export, Turbo RTK Output Guard, Session Radar & Subagent Monitor, Stop-Hook Verify Gate with stack auto-detection, Git Worktree Orchestrator, Spec Flow & Task DAG, Workspace Studio with OpenAPI 2.0/3.x parser, Visual Canvas, Code-Anchored Memory Graph, Prompt Vault & Budget Doctor, and Opt-In Mobile/IM Remote) with 100% 8-language UI (400 keys across 22 components), 8 CLI commands incl. statusline & recommend, and zero token tax when off.
---

# agy-NOV — 100% Native Modular Super-Workbench for Antigravity 2.0

`agy-NOV` unifies 13 high-demand Google Antigravity 2.0 workflows into one strictly official native plugin (Zero ASAR, Zero CDP) with live per-module toggles, 5 presets, 8 CLI commands (incl. zero-token `statusline` and read-only `recommend`), and **100% full-component 8-language UI** (`400` keys × `8` locales across all `22` components: `English`, `简体中文`, `繁體中文`, `日本語`, `한국어`, `Español`, `Français`, `Deutsch`) plus a collapsible **30-Second Zero-Risk First Try** card in **Modules**. Disabled modules unregister immediately from `tools/list` (`0` token & tool-slot tax against the 100-tool hard limit) and short-circuit hooks in O(1).

## Core Entry Tools (Always Available — 2 Tools)

- `nov_open`: Open the unified **agy-NOV** side-pane or global workbench (pass `module`: `review`, `guard`, `xray`, `turbo`, `radar`, `verify`, `worktree`, `spec`, `studio`, `canvas`, `mem`, `ops`, `remote`, or `modules`).
- `nov_status`: Inspect enabled modules, active preset, UI locale, exposed model tool count, and network isolation status.

## 13 Toggleable Native Modules (Tools Exposed Only When Enabled)

### Tier 1 — 12 Local Offline Native Modules (100% Offline)
- **Review** (`review_open`, `review_get_summary` · default ON, 2 tools): Line-by-line Git diff review with pure-React syntax highlighting (zero `dangerouslySetInnerHTML`), ignore-whitespace (`-w`) toggle, deterministic zero-ReDoS line risk hints (1-click annotate), categorized annotations, and structured `file:line` fix prompts.
- **Guard** (`guard_status`, `guard_list_snapshots`, `guard_create_checkpoint`, `guard_scan_secrets` · default ON, 4 tools): `.env`/SSH/secret leak shield, destructive command firewall, and zero-Git pre-edit file snapshots.
- **X-Ray** (`xray_analyze_context`, `xray_get_file_activity`, `xray_search_sessions`, `xray_export_brief` · default ON, 4 tools): Context X-Ray 2.0 with offline USD reference billing (read-only `pricing-overrides.json`), 14-day trend & 5h rolling burn-rate alerts, cached vs. fresh token breakdown, Swarm subagent lineage, HTTP 429 retry alerts, workspace file activity, EN+CJK BM25 search, and `xray_export_brief` (`format: 'brief' | 'handoff' | 'otlp' | 'csv'`, formula-injection safe).
- **Turbo** (`turbo_batch_search`, `turbo_read_outline`, `turbo_compact_output` · opt-in, 3 tools): Multi-pattern workspace batch search, top-level symbol outline slicing, and RTK-style smart output compression presets (`auto`/`test`/`build`/`git`/`generic`) with in-memory LRU chunk queries.
- **Radar** (`radar_get_board`, `radar_ack_session` · opt-in, 2 tools): Multi-session & parent/child Swarm subagent attention board (`running`, `awaiting_approval`, `completed`, `stalled`, `error`), orphan subagent alerts, `status-capsule.json` export, and optional chime.
- **Verify** (`verify_get_policy`, `verify_set_policy`, `verify_run_checks`, `verify_get_evidence` · opt-in, 4 tools): Stop-hook verification gate with zero-write stack auto-detection (`package.json` pnpm/yarn/bun/npm, `pyproject.toml`/`pytest.ini`, `Cargo.toml`, `go.mod`) validated against the shell-free allowlist, 0-byte write blocking, `continuation_active` awareness, anti-loop `maxConsecutiveBlocks` guardrails, and redacted evidence chains.
- **Worktree** (`worktree_list`, `worktree_create`, `worktree_diff_summary`, `worktree_cleanup` · opt-in, 4 tools): Safe parallel Git worktree orchestrator confined to `.agy-worktrees/` with `carryUncommitted` transfer, branch diff summaries, `extensions.worktreeConfig` hazard detection, and safe orphan/merged cleanup.
- **Spec** (`spec_get_state`, `spec_create_or_update`, `spec_approve`, `spec_update_task` · opt-in, 4 tools): Spec-driven `Spec -> Plan -> Task DAG` workflow with Kahn cycle detection, dependency-gated task advancement, `SessionStart` next-task recall, `PreToolUse` draft write lock (`enforcePlanBeforeWrite`), and `requireUiApproval` blocking model self-approval.
- **Studio** (`studio_list_sources`, `studio_inspect_data`, `studio_inspect_document`, `studio_http_probe` · opt-in, 4 tools): On-demand local debugger with read-only SQLite + CSV/TSV/JSON/NDJSON inspection, pure-Node offline DOCX/XLSX/PDF/Markdown slicing (ZIP-bomb guards), zero-dependency OpenAPI 2.0/3.x parser (YAML-bomb & prototype-pollution safe) generating clickable endpoint collections, and strict loopback-only anti-SSRF HTTP probing — toggle OFF when idle for `0` tool-budget tax.
- **Canvas** (`canvas_publish_artifact`, `canvas_open_file`, `canvas_get_feedback`, `canvas_resolve_annotations` · opt-in, 4 tools): Sandboxed HTML/SVG/Slides/Markdown/image preview with numbered visual pin annotations.
- **Memory** (`mem_remember`, `mem_recall`, `mem_forget` · opt-in, 3 tools): SHA-256 code-anchored architectural memory with `SessionStart` recall and stale drift checks.
- **Ops** (`ops_list_prompts`, `ops_render_prompt`, `ops_audit_workspace` · opt-in, 3 tools): Parameterized `{{var}}` Prompt Vault plus read-only Budget Doctor auditing 24KB/20K rule bloat (false 429 guard), 100-tool MCP budget usage, static MCP config health, skills, and local storage.

### Tier 2 — 1 Strictly Opt-In Remote Bridge (OFF by Default)
- **Remote** (`remote_status`, `remote_send_alert`, `remote_list_conversations`, `remote_dispatch_task` · default OFF, 4 tools): Local mobile PWA and Telegram/Feishu/DingTalk/WeCom/Slack/Discord alerts, risky command approval, and task dispatch.

## Presets & CLI Safety Verification (8 CLI Commands)

- Presets (exact model tool counts incl. `nov_open` + `nov_status`, all 47 tool names unchanged): `minimal` (1 mod / 6 tools), `core` *(default, 3 mods / 12 tools)*, `power` (9 mods / 32 tools), `local-all` (12 offline mods / 43 tools), `full` (13 mods incl. `remote` / 47 tools).
- Read-only stack scanner & preset recommendation (zero writes): `node dist/cli.cjs recommend [--workspace=<dir>] [--json]`
- Read-only health check: `node dist/cli.cjs doctor`
- Inspect status & tool count: `node dist/cli.cjs status`
- Zero-token CLI status line (incl. `Spec:LOCK(done/total)`): `node dist/cli.cjs statusline [--compact] [--json]`
- Switch presets: `node dist/cli.cjs preset <minimal|core|power|local-all|full>`
- Toggle single module: `node dist/cli.cjs enable|disable <review|guard|xray|turbo|radar|verify|worktree|spec|studio|canvas|mem|ops|remote>`
- Switch plugin UI language: `node dist/cli.cjs locale <auto|en|zh-CN|zh-TW|ja|ko|es|fr|de>`
- Guardrails: Never enable `remote` without explicit user consent (it stays strictly inert with zero ports, zero polling, zero outbound calls, and zero writes while OFF). Respect `requireUiApproval` on `spec`, and disable on-demand `studio` after debugging to keep tool budgets lean.
