# Changelog

All notable changes to **agy-NOV** will be documented in this file.

## [0.4.0] - 2026-11-27

### Added
- **Expanded Modular Super-Workbench from 11 to 13 Toggleable Native Superpowers (12 Local Offline + 1 Opt-In Remote, 100% Zero ASAR / Zero CDP):**
  - **`spec` (Spec Flow & Task DAG, `workspace` category, default OFF, 4 model tools):** Spec-driven development workflow (`spec_get_state`, `spec_create_or_update`, `spec_approve`, `spec_update_task`; hooks: `SessionStart`, `PreToolUse`) maintaining `Spec -> Plan -> Task DAG` documents with Kahn topological cycle detection, dependency-gated task advancement (rejects `in_progress`/`done` when prerequisite tasks remain unfinished), pure read-only `SessionStart` active-spec and ready-task recall, `PreToolUse` draft write lock (`enforcePlanBeforeWrite`) blocking workspace mutations until approved, and `requireUiApproval` preventing model-side self-approval via `spec_approve`.
  - **`studio` (Workspace Studio, `workspace` category, default OFF, 4 model tools):** On-demand local workspace debugger (`studio_list_sources`, `studio_inspect_data`, `studio_inspect_document`, `studio_http_probe`; hooks: none) providing read-only SQLite + CSV/TSV/JSON/NDJSON dataset inspection (`<= 10 MiB`, `1–100` rows), zero-binary pure-Node offline DOCX/XLSX/PDF/Markdown/HTML/SVG/YAML/XML slicing (`<= 200` lines) with ZIP-bomb and PDF-stream caps, and a strict loopback-only anti-SSRF HTTP probe (`127.0.0.1`, `localhost`, `[::1]`) — designed to toggle off when idle for zero tool-budget overhead against Antigravity's 100-tool hard limit.
- **Turbo RTK-Style Smart Output Compression Presets (`turbo`):** Upgraded `turbo_compact_output` and `app_turbo_compact_output` with smart compression presets (`auto`, `test`, `build`, `git`, `generic`), automatic preset detection, saved-percentage accounting, and in-memory LRU (24) chunk querying.
- **Ops Budget Doctor Upgrades (`ops`):** Upgraded `ops_audit_workspace` with a **24 KB (`24576 B`) single-file / `20,000` aggregate token rule-bloat guard** to prevent false HTTP 429s, a **100-tool MCP hard-limit budget meter** (`toolBudget`, combining active `agy-NOV` model tools with external MCP server estimates), and **static MCP config health auditing** (`mcpHealthFindings`).
- **CLI `statusline` Spec Flow Read-Only Summary:** Extended `agy-nov statusline` (text, `--compact`, and `--json`) with zero-token read-only `spec` state reporting (`Spec:LOCK(done/total)` while draft write lock is active, or `Spec:<STATUS>(done/total)`).
- **Expanded 8-Language UI, Dual-Theme Visuals & Automated Test Coverage:** Added full 8-language UI panels for `spec` and `studio`, upgraded `turbo` preset controls and `ops` Budget Doctor views, refreshed dual-theme Hero (`1280×480`) and Architecture (`1280×620`) SVGs, and added `test/spec-module.test.ts`, `test/studio-module.test.ts`, and `test/v04-turbo-ops.test.ts` alongside expanded integration coverage.

### Changed
- **Updated 5 Presets & Exact Model Tool Accounting (including `nov_open` + `nov_status`):**
  - `minimal`: 1 module (`guard`) = **6** tools (100% offline)
  - `core` *(default)*: 3 modules (`review`, `guard`, `xray`) = **12** tools (100% offline)
  - `power`: 9 modules (`review`, `guard`, `xray`, `turbo`, `radar`, `verify`, `worktree`, `spec`, `ops`) = **32** tools (100% offline)
  - `local-all`: all 12 offline native modules (including `studio`, `canvas`, `mem`) = **43** tools (100% offline)
  - `full`: all 13 native modules including opt-in `remote` = **47** tools (opt-in network)
- **Unified Hook Dispatcher Integration:** Wired `spec` into `SessionStart` (alongside `turbo` and `mem`) and `PreToolUse` with strict `guard` > `spec` > `remote` precedence while preserving O(1) read-only short-circuiting for disabled modules.
- **CLI, Bundle & Metadata Alignment:** Updated `src/core/catalog.ts`, `src/server/cli.ts`, `plugin.json`, `package.json`, `skills/agy-nov/SKILL.md`, `README.md`, `llms.txt`, and `docs/llms-install.md` to v0.4.0 (`dist/ui/app.html` ~904 KB, well below the 10 MiB cap).

### Security
- **Spec Flow Write-Lock & Approval Integrity:** Enforced pure read-only zero-write `SessionStart` and `PreToolUse` hooks, draft write-lock blocking across workspace write/edit/delete tools when `enforcePlanBeforeWrite` is enabled, Kahn topological cycle validation, dependency-gated task transitions, and `requireUiApproval` blocking model-side `spec_approve` bypasses.
- **Workspace Studio Containment, ZIP-Bomb & Anti-SSRF Hardening:** Enforced canonical `realpath` workspace containment with automatic `.env*`/SSH/`.git`/`node_modules`/keystore exclusion, `10 MiB` file cap, single-statement read-only SQLite validation (`SELECT` / `EXPLAIN QUERY PLAN SELECT` / `PRAGMA table_info(...)`), pure-Node ZIP-bomb and PDF stream limits (`512` entries, `4 MiB`/entry, `6 MiB` total ZIP inflated, `2 MiB` PDF streams), and strict loopback-only HTTP probing (`127.0.0.1`, `localhost`, `[::1]`, `redirect: manual`, `64 KiB` response cap, `1–15s` timeout, automatic header/body secret redaction).
- **Zero-Touch Invariants Preserved:** Maintained strict 100% Zero ASAR / Zero CDP boundaries, zero-port/zero-write OFF-state guarantees for `remote`, and strictly read-only zero-write execution for `ops_audit_workspace`, `agy-nov statusline`, and `agy-nov doctor`.

## [0.3.0] - 2026-11-27

### Added
- **Expanded Modular Super-Workbench from 9 to 11 Toggleable Native Superpowers (10 Local Offline + 1 Opt-In Remote, 100% Zero ASAR / Zero CDP):**
  - **`verify` (Verify Gate, `safety` category, default OFF, 4 model tools):** Stop-hook verification gate (`verify_get_policy`, `verify_set_policy`, `verify_run_checks`, `verify_get_evidence`; hooks: `PostToolUse`, `Stop`) that tracks edited workspace files, blocks 0-byte writes and unverified "done" claims on `Stop` hooks, executes shell-free allowlisted checks (`npm`, `npx`, `pnpm`, `yarn`, `bun`, `node`, `tsc`, `vitest`, `jest`, `pytest`, `python3`, `cargo`, `go`, `make`, `ruff`, `eslint`, plus read-only `git` subcommands), honors `continuation_active` and `maxConsecutiveBlocks` anti-loop guardrails, and stores a redacted evidence chain per turn.
  - **`worktree` (Worktree Orchestrator, `core-dev` category, default OFF, 4 model tools):** Safe parallel Git worktree scheduler (`worktree_list`, `worktree_create`, `worktree_diff_summary`, `worktree_cleanup`; hooks: none) confined to `<repoRoot>/.agy-worktrees/` with optional `carryUncommitted` patch transfer, branch diff summaries, `extensions.worktreeConfig` hazard detection, and safe cleanup for merged or orphaned worktrees.
- **Swarm & Multi-Agent Telemetry Upgrades across `xray` and `radar`:**
  - **`xray` (Context X-Ray):** Added Swarm subagent lineage linking (`swarmLineage`), per-model token & cache cost breakdowns (`modelBreakdown`), and HTTP 429 / rate-limit retry signal detection (`retrySignals`).
  - **`radar` (Session Radar & Chime):** Added parent/child Swarm subagent tracking (`parentConversationId`, `agentRole`, `isSubagent`), orphan subagent detection (`orphanSubagents`), and compact `status-capsule.json` export for zero-token companion consumers.
- **7th CLI Command — Zero-Token `agy-nov statusline`:** Added `agy-nov statusline [--json] [--compact] [--data-dir=<dir>]` providing strictly read-only, zero-LLM-token, zero-disk-write status output (preset, active module/tool counts, offline/remote isolation mode, Verify Gate status, Radar active/waiting/stalled/orphan counts, and X-Ray active session snapshot) for Antigravity CLI native `statusLine` integration and `agy-Sag` consumption.
- **Expanded 8-Language UI & Automated Test Coverage:** Added full 8-language UI panels for `verify` and `worktree` plus Swarm lineage/model breakdown views, refreshed dual-theme SVG hero/architecture visuals, and added `test/verify-module.test.ts`, `test/worktree-module.test.ts`, and `test/swarm-telemetry.test.ts` alongside expanded integration tests.

### Changed
- **Updated 5 Presets & Exact Model Tool Accounting (including `nov_open` + `nov_status`):**
  - `minimal`: 1 module (`guard`) = **6** tools (100% offline)
  - `core` *(default)*: 3 modules (`review`, `guard`, `xray`) = **12** tools (100% offline)
  - `power`: 8 modules (`review`, `guard`, `xray`, `turbo`, `radar`, `verify`, `worktree`, `ops`) = **28** tools (100% offline)
  - `local-all`: all 10 offline native modules = **35** tools (100% offline)
  - `full`: all 11 native modules including opt-in `remote` = **39** tools (opt-in network)
- **Unified Hook Dispatcher & Stop Hook Budget:** Increased `hooks.json` `Stop` timeout from `8s` to `20s` to accommodate `verify`'s bounded `8s` single-command / `14s` total Stop-hook budget while preserving O(1) read-only short-circuiting for disabled modules.
- **CLI & Metadata Alignment:** Updated `src/core/catalog.ts`, `src/server/cli.ts`, `plugin.json`, `package.json`, `skills/agy-nov/SKILL.md`, `README.md`, `llms.txt`, and `docs/llms-install.md` to v0.3.0 specifications.

### Security
- **Verify Gate Hardening:** Enforced shell-free `execFile` allowlisting (17 executables + 4 read-only `git` subcommands), argument count/length caps, `realpath` workspace containment, secret redaction before storing command output tails, and anti-loop stop guardrails (`maxConsecutiveBlocks` default `3`, range `1`–`10`, plus `continuation_active` awareness).
- **Worktree Containment & Ref Injection Defense:** Restricted managed worktrees to `.agy-worktrees/`, validated Git refs and directory names with strict regexes to block argument injection and path traversal, used shell-free Git `execFile` with explicit `--` separators, flagged `extensions.worktreeConfig` risks, and refused non-forced cleanup on dirty worktrees.
- **Zero-Touch Invariants Preserved:** Maintained strict 100% Zero ASAR / Zero CDP boundaries, zero-port/zero-write OFF-state guarantees for `remote`, and strictly read-only zero-write execution for `agy-nov statusline` and `agy-nov doctor`.

## [0.2.0] - 2026-11-27

### Added
- **Expanded Modular Super-Workbench from 6 to 9 Toggleable Native Superpowers (8 Local Offline + 1 Opt-In Remote):**
  - **`turbo` (Turbo & Output Guard):** Multi-pattern workspace batch search (`turbo_batch_search`), top-level symbol outline slicing (`turbo_read_outline`), compact indexed compression for oversized build/test logs (`turbo_compact_output`), and `SessionStart` workspace summary hooks.
  - **`radar` (Session Radar & Chime):** Multi-session lifecycle attention board (`radar_get_board`, `radar_ack_session`) tracking parallel conversations across `running`, `awaiting_approval`, `completed`, `stalled`, and `error` states via `PreToolUse` / `PostToolUse` / `Stop` hooks, with unread counters and configurable completion chime alerts.
  - **`ops` (Prompt Vault & Doctor):** Parameterized `{{var}}` reusable prompt templates (`ops_list_prompts`, `ops_render_prompt`) paired with a read-only workspace audit of rules, skills, MCP token estimates, and local storage hygiene (`ops_audit_workspace`).
- **5 One-Click Presets:** Added `power` (`core + turbo + radar + ops`, 20 model tools, 100% offline) alongside `minimal` (6), `core` (12, default), `local-all` (27), and `full` (31, including opt-in `remote`).
- **Built-In 8-Language Plugin UI & Locale Controls:** Shipped real-time localization inside `dist/ui/app.html` with `auto` BCP-47 host detection plus explicit selection across all 8 languages (`English`, `简体中文`, `繁體中文`, `日本語`, `한국어`, `Español`, `Français`, `Deutsch`) via the top-bar dropdown and `agy-nov locale <auto|en|zh-CN|zh-TW|ja|ko|es|fr|de>` CLI command, matching the 8-language documentation (`docs/i18n/README.*.md`).
- **Upgraded Offline Workbench Simulator:** Added an 8-language Host Locale selector alongside Dark/Light themes, `480px`/`1160px` viewport presets, and the live Host Events inspector at `http://127.0.0.1:4399`.
- **Visual Assets, 8-Language Docs & AI-Agent Discovery:** Added dual-theme dark/light Hero and Architecture SVGs (`assets/hero-{dark,light}.svg`, `assets/architecture-{dark,light}.svg`), 8-language README translations, `llms.txt`, and `docs/llms-install.md`.
- **100% Native `config.json` Live Hot-Sync (Zero CDP / Zero Ports / Zero Premature Writes):** Added serialized `syncConfigFromDiskIfChanged()` with delta `syncToolVisibility()` updates, an `.unref()` read-only `statSync` poller (`configPollMs`, default `1500ms`), and immediate sync on `nov_open` / `nov_status` / `nov_app_get_config` — enabling live control from `agy-Sag`'s native Antigravity Settings panel or the `agy-nov` CLI without adding CDP or network sockets, while tolerating transient malformed JSON and keeping uninitialized `dataDir` untouched.
- **Expanded Automated Tests:** Added `test/modules-v02.test.ts` and expanded `test/nov-integration.test.ts` covering all 9 modules, 5 presets, exact model tool counts (`6`/`12`/`20`/`27`/`31`), 8-language locale handling, live external `config.json` hot-sync with delta `tools/list_changed` notifications, zero-write poller invariants, and isolation checks.

### Changed
- **100% Native Zero-CDP Architecture Boundary:** Established a strict official-protocol boundary for `agy-NOV` (Zero ASAR, Zero CDP, immune to Antigravity client updates), keeping host-DOM CDP customizations cleanly separated in companion repository `agy-Sag` (`https://github.com/tone-leh/agy-session-guard`).
- Upgraded `src/core/catalog.ts` with 5 module categories (`core-dev`, `safety`, `observability`, `workspace`, `connectivity`), 2 explicit isolation tiers (`offline`, `opt-in-network`), 8 UI locale definitions (`UI_LOCALE_IDS`, `LOCALE_IDS`, `LOCALE_NATIVE_LABELS`), and exact model tool accounting (`countEnabledModelTools`).
- Hardened `src/server/index.ts` with automatic app-tool tracking so disabling any module synchronously disables both model-visible tools and mutating `app_*` tools while keeping lightweight read-only offline status snapshots accessible.
- Streamlined `src/server/cli.ts` to 6 clean commands (`status`, `enable`, `disable`, `preset`, `locale`, `doctor`) with 9-file bundle verification, `plugin.json` 10-key schema validation, and `< 10 MiB` UI bundle enforcement.
- Updated `plugin.json`, `package.json`, `skills/agy-nov/SKILL.md`, and `scripts/bundle-server.mjs` for v0.2.0.

### Security
- Enforced a strict Zero ASAR & Zero CDP protocol boundary across the entire plugin with zero binary modification and zero host DOM injection.
- Preserved strict OFF-state zero-touch isolation for `remote`: zero listening ports, zero background timers, zero disk writes, and zero outbound requests while disabled.
- Enforced `realpath` canonical workspace containment and automatic `.env`, SSH key, `.git`, and `node_modules` exclusions across `turbo` and `ops` alongside `guard`, `canvas`, and `mem`.

## [0.1.0] - 2026-11-27

### Added
- Consolidated six native Google Antigravity 2.0 MCP App capabilities (`review`, `guard`, `xray`, `canvas`, `mem`, `remote`) into a single modular plugin with live on/off switches and 4 presets (`core`, `local-all`, `full`, `minimal`).
- Implemented dynamic MCP tool registration (`RegisteredTool.enable()` / `.disable()`) so disabled modules incur zero model tool schema token tax.
- Built a unified lifecycle hook dispatcher (`dist/hook.cjs`) with camelCase & snake_case payload normalization and O(1) read-only short-circuiting for disabled modules.
- Hardened the opt-in `remote` module to stay strictly offline by default (zero listening ports, zero background polling, zero outbound requests) with serialized start/stop lifecycle teardown.
- Shipped a shared `NovBridge` singleton, strictly scoped per-module CSS with full dark/light theme support, an interactive Modules control center, CLI (`status`, `enable`, `disable`, `preset`, `doctor`), and a zero-touch offline `workbench/` simulator.
