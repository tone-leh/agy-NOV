# Changelog

All notable changes to **agy-NOV** will be documented in this file.

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
