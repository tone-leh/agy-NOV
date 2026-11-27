# Changelog

All notable changes to **agy-NOV** will be documented in this file.

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
- Preserved strict OFF-state zero-touch isolation for `remote`: zero listening ports, zero background timers, zero disk writes, and zero outbound network requests while disabled.
- Enforced `realpath` canonical workspace containment and automatic `.env`, SSH key, `.git`, and `node_modules` exclusions across `turbo` and `ops` alongside `guard`, `canvas`, and `mem`.

## [0.1.0] - 2026-11-27

### Added
- Consolidated six native Google Antigravity 2.0 MCP App capabilities (`review`, `guard`, `xray`, `canvas`, `mem`, `remote`) into a single modular plugin with live on/off switches and 4 presets (`core`, `local-all`, `full`, `minimal`).
- Implemented dynamic MCP tool registration (`RegisteredTool.enable()` / `.disable()`) so disabled modules incur zero model tool schema token tax.
- Built a unified lifecycle hook dispatcher (`dist/hook.cjs`) with camelCase & snake_case payload normalization and O(1) read-only short-circuiting for disabled modules.
- Hardened the opt-in `remote` module to stay strictly offline by default (zero listening ports, zero background polling, zero outbound requests) with serialized start/stop lifecycle teardown.
- Shipped a shared `NovBridge` singleton, strictly scoped per-module CSS with full dark/light theme support, an interactive Modules control center, CLI (`status`, `enable`, `disable`, `preset`, `doctor`), and a zero-touch offline `workbench/` simulator.
