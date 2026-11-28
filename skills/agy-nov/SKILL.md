---
name: agy-nov
description: Open and manage agy-NOV (v1.2.2), the 100% native 4-layer modular super-workbench for Google Antigravity 2.0 (Zero ASAR, Zero CDP). Manage 13 toggleable modules, 5 presets, 47 canonical model tools, 6 official hooks, 4 zero-tax MCP context resources, 11 CLI commands, and the opt-in read-only audit sidecar.
---

# agy-NOV — 100% Native Modular Super-Workbench (v1.2.2)

`agy-NOV` unifies 13 Google Antigravity 2.0 engineering workflows into one official native plugin (Zero ASAR, Zero CDP, cross-platform macOS / Windows / Linux) organized across **4+1 functional domains** (Core Essentials `core` / Engineering Pipeline `pipeline` / On-Demand Toolbox `toolbox` / Opt-In Connectivity `connectivity` + **L0 Workflow Hub**), with 8-language UI (`758` keys × 8 locales, `< 1.4 MiB`), strict **47** canonical model tools max, and zero token tax when modules are off.

## Core Entry Tools (Always Available — 2 Model Tools)

- `nov_open`: Open the **agy-NOV** side-pane or global workbench (`module`: `hub`, `settings`, `modules`, or any of the 13 module IDs).
- `nov_status`: Return enabled modules, active preset, UI locale, exposed model tool count, and network isolation status.

*(All Hub, Settings Hub, Spec workflow compiler `app_spec_compile_workflow`, Clean Fork `app_xray_build_clean_fork_pack` / `app_xray_fork_via_service`, Radar reconciliation `app_radar_reconcile_conversations`, Worktree include preview `app_worktree_preview_include`, Verify PR summary `app_verify_pr_summary`, Mem hygiene `app_mem_get_hygiene_summary` / `app_mem_batch_hygiene`, and native file viewer `app_nov_file_viewer` tools use `visibility: ['app']` and are automatically hidden on CLI clients without MCP UI extensions.)*

## On-Demand Playbooks, Subagents & Zero-Tax Context Resources (0 Tool Slots)

- **6 Official Skills (`skills/*/SKILL.md`)**: `agy-nov`, `/nov-spec` (Full & Delta Spec planning), `/nov-workflow` (Spec DAG → `/run-workflow` Python & `/swarm` `plan.json`), `/nov-debug` (4-step root-cause debugging), `/nov-review` (two-stage Spec + diff review), `/nov-handoff` (Clean Fork handoff).
- **2 Read-Only Subagents (`agents/nov-*.md`)**: `nov-blind-reviewer` & `nov-security-auditor` (native `read_file` only, `model: inherit`).
- **4 Read-Only MCP Context Resources (`agy-nov://context/*`)**: `agy-nov://context/review`, `agy-nov://context/mem`, `agy-nov://context/turbo`, `agy-nov://context/xray` (module-gated, `<private>` & secret redacted, `<= 32 KiB`, zero writes).
- **Native File Viewer**: `app_nov_file_viewer` opens `.sqlite`/`.sqlite3`/`.db`/`.csv`/`.tsv`/`.svg`/`.openapi.yaml`/`.openapi.yml` (incl. `antigravity-file://` via host `resources/read`).

## 13 Toggleable Modules (45 Module Tools + 2 Core = 47 Max)

### Tier 1 — 12 Local Offline Modules (100% Offline)

- **Domain 1 · Core Essentials (`core` — Default ON)**
  - `review` (`review_open`, `review_get_summary` · hooks: `PostToolUse`, `Stop`): Two-stage PR diff review across main & Worktree branches, line risk hints, categorized annotations, and `file:line` fix prompts.
  - `guard` (`guard_status`, `guard_list_snapshots`, `guard_create_checkpoint`, `guard_scan_secrets` · hooks: `PreToolUse`, `PreInvocation`, `PostInvocation`): `.env`/key shield, command firewall, `PreInvocation` local inbound secret hard gate (`terminationBehavior: "terminate"`, `blockInboundPromptSecrets`), turn-grouped zero-Git snapshots & rewind, and 3 `permissionMode` tiers (`readonly-audit` / `balanced-dev` / `strict-gate`).
  - `xray` (`xray_analyze_context`, `xray_get_file_activity`, `xray_search_sessions`, `xray_export_brief` · hooks: `PostToolUse`, `Stop`): Token/cache & offline USD cost breakdown, Swarm lineage, EN+CJK BM25 search, One-Click Clean Fork (`app_xray_fork_via_service` loopback Connect API + `sendMessage` fallback), and OTLP/CSV/Handoff export.
- **Domain 2 · Engineering Pipeline (`pipeline` — Default OFF)**
  - `spec` (`spec_get_state`, `spec_create_or_update`, `spec_approve`, `spec_update_task` · hooks: `SessionStart`, `PreToolUse`, `PreInvocation`): Full & Brownfield Delta Specs, inline plan review annotations, revision LCS diff, Task DAG, draft write lock (`enforcePlanBeforeWrite`), `requireUiApproval`, `/run-workflow` & `/swarm` compiler, and `mem` archival (requires `mem` enabled).
  - `worktree` (`worktree_list`, `worktree_create`, `worktree_diff_summary`, `worktree_cleanup`): Isolated `.agy-worktrees/` manager with read-only allowlisted `.worktreeinclude`, `carryUncommitted`, diff previews, and safe pruning.
  - `verify` (`verify_get_policy`, `verify_set_policy`, `verify_run_checks`, `verify_get_evidence` · hooks: `PostToolUse`, `PostInvocation`, `Stop`): Stop-hook verification gate (`decision: "continue"` + safe `terminationReason` pass-through), shell-free allowlist, Worktree checks, 0-byte write blocking, and PR evidence summaries.
  - `turbo` (`turbo_batch_search`, `turbo_read_outline`, `turbo_compact_output` · hooks: `SessionStart`, `PreToolUse`, `PostToolUse`, `PostInvocation`): Batch search + cross-file symbol `references`, nested outlines + offline `depPackage` contracts, RTK compression (`<= 8.8 KB`), and opt-in `autoRtk` proxy (`false` by default).
  - `mem` (`mem_remember`, `mem_recall`, `mem_forget` · hooks: `SessionStart`, `PreInvocation`, `Stop`): SHA-256 code-anchored memory graph with confidence tiers (`verified`/`normal`/`tentative`), TTL expiration, `<private>` stripping, and batch anchor re-verification.
- **Domain 3 · On-Demand Toolbox (`toolbox` — Default OFF)**
  - `radar` (`radar_get_board`, `radar_ack_session` · hooks: `PreToolUse`, `PostToolUse`, `Stop`): Approval-first 4-lane Kanban attention board, Swarm orphan alerts, `status-capsule.json`, and read-only host `ConversationService` reconciliation (`app_radar_reconcile_conversations`).
  - `studio` (`studio_list_sources`, `studio_inspect_data`, `studio_inspect_document`, `studio_http_probe`): Read-only SQLite/CSV/JSON viewer, offline DOCX/XLSX/PDF/Markdown slicer, OpenAPI 2.0/3.x parser, and loopback-only HTTP probe.
  - `canvas` (`canvas_publish_artifact`, `canvas_open_file`, `canvas_get_feedback`, `canvas_resolve_annotations`): Sandboxed HTML/SVG/Slides/Markdown/image canvas with numbered pin annotations.
  - `ops` (`ops_list_prompts`, `ops_render_prompt`, `ops_audit_workspace`): Parameterized `{{var}}` Prompt Vault, static security audit (`securityScore`), cross-client rule dedup preview (`.claude`/`.cursor`/`.codex`), 24KB rule bloat & 100-tool MCP budget doctor.

### Tier 2 — Domain 4 · Opt-In Connectivity (`connectivity` — OFF by Default)

- `remote` (`remote_status`, `remote_send_alert`, `remote_list_conversations`, `remote_dispatch_task` · hooks: `PreToolUse`, `Stop`): Strictly inert while OFF (0 ports, 0 writes, 0 polling, 0 outbound calls). Opt-in local Mobile PWA + 6 IM webhooks with risk-card approvals and read-only redacted SSE live streams.

## Presets, Hooks, Sidecar & 11 CLI Commands

- **Presets (exact model tools)**: `minimal` (1/6), `core` *(default, 3/12)*, `power` (9/32), `local-all` (12/43), `full` (13/47).
- **6 Official Hooks (`hooks.json`)**: `SessionStart`, `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop` via cross-platform `node dist/hook.cjs --event <Event>`.
- **Dual-Star Feed (`feed-snapshot.json`)**: Event-driven `0600` atomic `< 64 KiB` redacted summary for companion `agy-Sag` (see `docs/DUAL-STAR-CONTRACT.md` & `docs/ARCHITECTURE.md`).
- **Opt-In Read-Only Audit Sidecar (`sidecars/audit-sidecar.mjs`, OFF by default)**: Run `node ~/.gemini/config/plugins/agy-nov/sidecars/audit-sidecar.mjs --once` manually or via `/schedule` (zero ports, zero writes unless `--write-report` is explicitly passed; see `sidecars/README.md`).
- **CLI Entry**: Invoke `node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs <cmd>` (macOS/Linux) or `node %USERPROFILE%\.gemini\config\plugins\agy-nov\dist\cli.cjs <cmd>` (Windows):
  - `status` — Show enabled modules, preset, locale, and model tool count.
  - `preset <minimal|core|power|local-all|full>` — Apply a module preset.
  - `enable|disable <module>` — Toggle a single module.
  - `locale <auto|en|zh-CN|zh-TW|ja|ko|es|fr|de>` — Set built-in UI language.
  - `statusline [--compact] [--json] [--segments=<csv>]` — Zero-token CLI status line fusing Antigravity 2.35+ / 2.36+ stdin JSON across 11 segments (`brand,model,context,burn,quota,cache,spec,verify,guard,radar,network`).
  - `recommend [--workspace=<dir>] [--json] [--export-preset [--confirm] [--force]]` — Read-only stack scan and preview-then-confirm `.agy-nov.json` scaffold.
  - `compile-spec [--spec=<id>] [--format=workflow|swarm|both] [--json]` — Read-only Spec DAG compiler to `/run-workflow` Python & `/swarm` `plan.json`.
  - `audit-once [--workspace=<dir>] [--data-dir=<dir>] [--json] [--write-report]` — Read-only Ops/Mem/Verify/Guard health sweep (`health-sweep.json` only with `--write-report`).
  - `doctor [--data-dir=<dir>]` — Verify all 18 core plugin assets, 4 Marketplace Readiness Checks, and config health.
  - `compact-run --payload=<b64>` — Shell-free Auto-RTK runner (invoked by `PreToolUse.overwrite`).

## Safety Guardrails

- Keep `remote`, `autoRtk`, and `sidecars/audit-sidecar.mjs` OFF unless explicitly requested by the user.
- Require explicit user consent before passing `--confirm` / `--force` to `recommend --export-preset`, `--write-report` to `audit-once`, or `confirmCreate: true` to `app_xray_fork_via_service`.
- Respect Guard `permissionMode`, `blockInboundPromptSecrets`, Spec `requireUiApproval`, read-only `.worktreeinclude`, and zero auto-execution of `.agy-nov.json` commands.
