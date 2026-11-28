# Changelog

All notable changes to **agy-NOV** will be documented in this file.

## [1.2.2] - 2026-11-28

### Added
- **5-Layer Production Stability Defenses & Antigravity Desktop v2.36.0 Compatibility (`core`, `hooks`, `server`, `modules`, `ui`, `cli`, `sidecars`):**
  - **Defense 1 — Write-Storm Elimination & Semantic Dirty Checking (`core`, `hooks`, `radar`, `review`, `xray`, `turbo`, `guard`, `server`):** Unified JSON stores onto `atomicWriteJson` with content and semantic dirty checking (`ignoreTopLevelKeys`), owner-only `0600` permissions, and automatic `.tmp` cleanup on write failure; enabled SHA-256 semantic dirty checking ignoring `generatedAt` for `feed-snapshot.json` and `health-sweep.json`; added a `3s` `PostToolUse` coalescing window, concurrent-session anti-ping-pong merging in `radar`/`review`/`xray`, Top-20 deduplication in `turbo`, and O(1) concurrency-safe targeted GC in `guard`.
  - **Defenses 2 & 3 — Oversized, Long-Running & Corrupted Session Fault Tolerance (`hooks`, `xray`, `remote`, `mem`, `core`, `studio`):** Added strict 4,096 UTF-8 byte truncation in `clampHookResult` with order-preserving `injectSteps <= 24 KiB`; bounded head/tail sampling and multi-session aggregate read budgets (`24/32 MiB`) in `xray`; adaptive tail-window expansion up to `2 MiB` in `live-stream` and `mem/hook` to recover single steps up to `600 KB`; streaming hard abort at `4 MiB` in `ConversationService`; and batched short-lived `-safe -readonly` SQLite queries in `studio` with automatic `file:<uri>?mode=ro&immutable=1` zero-lock, zero-write fallback inside read-only WAL directories lacking `-shm`, plus graceful degradation on corrupted databases and upstream errors.
  - **Defenses 4 & 5 — MCP Apps Anti-Blank-Screen, Zero Leaks & `SIGKILL` Recovery (`ui`, `server`, `remote`, `sidecars`):** Wrapped the root application and every subpanel in an 8-language key-symmetric `ErrorBoundary` (expanding the dictionary from 755 to **758 core keys × 8 locales** across all **24 UI components**, with `srcdoc`-safe recovery resets); added rAF coalescing and transient `0×0` filtering to `App` and `ReviewPanel` `ResizeObserver` hooks; added progressive folding for Diff (`400` lines with hidden comment counts), X-Ray (`60` steps), and Spec (`400` lines); paused `RemotePanel` polling and Mobile PWA SSE automatically on window blur or visibility hidden; added `SIGINT`/`SIGTERM`/`SIGHUP`/`EPIPE` teardown with a `3s` hard-exit watchdog in the MCP server, `isPidAlive` filtering for stale `SIGKILL` `runtime.json` entries, and a `30s` child-process timeout in the Audit Sidecar.
  - **Full Antigravity Desktop v2.36.0 Compatibility (`ui`, `cli`, `ops`, `guard`, `remote`):** Added `--nov-wide-composer-clearance >= 56px` bottom safe clearance on maximized wide sidebars so floating composers remain unobstructed; added read-only dual-directory skill discovery (`~/.gemini > ~/.agents/skills`) with physical symlink deduplication wired across `doctor`, `recommend`, and `ops`; aligned out-of-workspace sensitive configuration interception across Guard file hooks, Guard shell hooks, and Remote risk cards (`.gitconfig`, `.git/hooks`, `.docker/config.json`, `.config/gh/hosts.yml`, `.gemini/antigravity/mcp_config.json`, `.claude`, `.codex`, etc.) while allowing legitimate cross-repo source edits; upgraded `ops` to recognize dynamic OAuth offline refresh flows alongside recursive nested static secret detection; and extended `statusline` to support NDJSON stdin streams and `remaining_percentage`.
- **Expanded Automated Regression Suite (`test`):**
  - Added `test/v122-stability-v236-compat.test.ts` covering all 5 stability defenses, Antigravity Desktop v2.36.0 compatibility, 8-language 758-key symmetry, and 4-layer AST zero-cycle enforcement, expanding total automated verification to **105 suites / 301 tests** passing green across the macOS / Windows / Linux 3-OS CI matrix.

### Changed
- **Preserved 13-Module Architecture, 5 Presets & Strictly 47 Canonical Model Tools (+0 Inflation):** All 13 toggleable native modules (12 local offline + 1 opt-in `remote`), 5 presets (`minimal` 6 / `core` 12 / `power` 32 / `local-all` 43 / `full` 47), 6 official Lifecycle Hooks, 6 official Skills, 2 read-only specialist subagents, 4 `agy-nov://context/*` resources, 11 CLI commands, 18-asset + 4-check Marketplace `doctor`, and all **47 canonical model tool names** remain 100% backward-compatible from `v0.4` through `v1.2.2`.
- **Antigravity 2.35+ / 2.36+ Runtime Alignment & Measured `v1.2.2` Artifacts:**
  - Updated CLI `statusLine` and host compatibility baselines from `Antigravity 2.35` to **`Antigravity 2.35+ / 2.36+`** with full **Antigravity Desktop v2.36.0** support.
  - Measured minified `v1.2.2` artifacts: `dist/server.cjs` **`1,604.1 KB`** (`~1.56 MiB`), `dist/hook.cjs` **`223.5 KB`**, `dist/cli.cjs` **`209.9 KB`**, single-file 8-language UI `dist/ui/app.html` **`1,402.1 KB`** (`~1.37 MiB`, far below the 10 MiB cap, carrying **758 core dictionary keys × 8 locales** across all **24 UI components** including the 8-language `ErrorBoundary` recovery card), `skills/agy-nov/SKILL.md` **`9.5 KB`**, `sidecars/audit-sidecar.mjs` **`5.9 KB`**, and `sidecars/README.md` **`4.2 KB`**.
  - Synchronized `README.md`, all 7 localized `docs/i18n/README.*.md` files, `llms.txt`, `docs/llms-install.md`, and `skills/agy-nov/SKILL.md` to `v1.2.2` (`doctor` reporting `version=1.2.2`).

### Fixed
- Eliminated redundant disk write storms on unchanged metadata timestamps (`generatedAt`), high-frequency `PostToolUse` bursts, concurrent multi-session state ping-pong (`radar`, `review`, `xray`), unbounded Turbo hotspot accumulation, and slow Guard snapshot garbage collection.
- Prevented oversized hook payloads, multi-hundred-KB single steps (`600 KB`), huge multi-session logs, unbounded `ConversationService` streams, and read-only WAL SQLite directories without `-shm` sidecar files from causing truncation corruption, OOM spikes, or lock failures.
- Prevented blank-screen UI crashes inside `srcdoc` MCP Apps frames, `ResizeObserver` `0×0` layout loops, background polling/SSE leaks on hidden windows, stale `SIGKILL` `runtime.json` ghost state, and runaway Sidecar subprocesses.

### Security
- **Tri-Surface Out-of-Workspace Sensitive Config Interception (`guard`, `remote`):** Aligned Guard file checks, Guard shell rules, and Remote risk approval cards to block unauthorized mutations targeting out-of-workspace sensitive configuration files (`.gitconfig`, `.git/hooks`, `.docker/config.json`, `.config/gh/hosts.yml`, `.gemini/antigravity/mcp_config.json`, `.claude`, `.codex`, etc.) while permitting legitimate cross-repository source code edits.
- **Atomic `0600` Persistence, Recursive Static Secret Scanning & Zero-Write Fallback (`core`, `ops`, `studio`, `ui`):** Enforced `0600` permissions and failed-`.tmp` cleanup in `atomicWriteJson`, recursive nested static secret inspection (with dynamic OAuth offline refresh recognition and zero secret echo) in `ops`, physical symlink deduplication across `~/.gemini > ~/.agents/skills`, `file:<uri>?mode=ro&immutable=1` zero-write SQLite fallback, and `srcdoc`-safe `ErrorBoundary` resets, preserving 100% Zero ASAR / Zero CDP boundaries, four-zero OFF-state isolation for `remote`, 10-key `plugin.json` hygiene, and **105 suites / 301 tests** green.

## [1.2.1] - 2026-11-28

### Fixed
- **Dual-Star `feed-snapshot.json` Immediate Refresh & Accurate Aggregation (`hooks`, `cli`, `core`, `remote`):**
  - Updated `PreToolUse` so `guard`, `spec`, and `remote` immediately refresh `<dataDir>/feed-snapshot.json` before returning `deny`, `force_ask`, or `ask` decisions, eliminating stale companion snapshots on blocked or approval-gated turns.
  - Updated CLI configuration mutators (`enable`, `disable`, `preset`, `locale`) to synchronously refresh an existing `<dataDir>/feed-snapshot.json` immediately after updating `config.json`, while preserving zero-mkdir/zero-write invariants whenever `dataDir` or the snapshot file is absent.
  - Fixed `latestSnapshotId` resolution in `src/core/feed.ts` by sorting snapshots by `createdAt` and selecting the newest entry (replacing legacy field lookup).
  - Bound `GUARD_BLOCKED` alert reasons strictly to real `deny` / `blocked` events so non-blocking telemetry entries never surface as Guard blocks.
  - Unified `verify` summary selection across `src/core/feed.ts` and `src/modules/remote/hook.ts` to consistently select the entry with the latest timestamp.
- **Disabled-Module Hard Gating & `PostToolUse` O(1) Short-Circuit (`spec`, `mem`, `server`, `hooks`):**
  - Hard-gated cross-module `spec -> mem` archival (`archiveSpecToMemory`) with live `cfg.modules.mem` validation: whenever `mem` is disabled, archival refuses writes cleanly with zero directory creation.
  - Gated read-only Audit Sidecar sweeps (`src/server/sidecar.ts`) against `cfg.modules.mem`, `cfg.modules.verify`, and `cfg.modules.guard` so stale historical files left by disabled modules never raise false positives.
  - Added an all-disabled O(1) short-circuit guard at the top of `PostToolUse` in `dist/hook.cjs`.

### Changed
- **TypeScript AST Architecture Guard & Entry Skill Slimming (`test`, `skills/`, `docs/`):**
  - Upgraded `test/architecture-hygiene.test.ts` to parse imports via the TypeScript AST and enforce a strict Layer 2 horizontal cross-module import allowlist across the codebase.
  - Slimmed `skills/agy-nov/SKILL.md` from ~30 KB down to **`9.5 KB`**, clearing `ops.large-instruction-file` rule-bloat warnings while keeping concise invocation instructions intact.
  - Added `test/v121-consistency-hardening.test.ts` verifying dual-star snapshot freshness/aggregation, disabled-module hard gating, and `PostToolUse` O(1) short-circuiting, expanding total automated verification to **101 suites / 286 tests** passing green across the macOS / Windows / Linux 3-OS CI matrix.
- **Preserved 13-Module Architecture, 5 Presets & Strictly 47 Canonical Model Tools (+0 Inflation):** All 13 toggleable native modules (12 local offline + 1 opt-in `remote`), 5 presets (`minimal` 6 / `core` 12 / `power` 32 / `local-all` 43 / `full` 47), 6 official Lifecycle Hooks, 6 official Skills, 2 read-only specialist subagents, 4 `agy-nov://context/*` resources, 11 CLI commands, 18-asset + 4-check Marketplace `doctor`, and all **47 canonical model tool names** remain 100% backward-compatible from `v0.4` through `v1.2.1`.
- **Measured `v1.2.1` Runtime Artifacts & Synchronized Documentation:**
  - Measured minified `v1.2.1` artifacts: `dist/server.cjs` **`1,584.5 KB`** (`~1.55 MiB`), `dist/hook.cjs` **`212.8 KB`**, `dist/cli.cjs` **`201.2 KB`**, single-file 8-language UI `dist/ui/app.html` **`1,390.2 KB`** (`~1.36 MiB`, far below the 10 MiB cap, carrying **755 core dictionary keys × 8 locales** across all **24 UI components**), and `skills/agy-nov/SKILL.md` **`9.5 KB`**.
  - Updated `docs/ARCHITECTURE.md`, `docs/DUAL-STAR-CONTRACT.md`, `README.md`, all 7 localized `docs/i18n/README.*.md` files, `llms.txt`, and `docs/llms-install.md` to `v1.2.1` (`doctor` reporting `version=1.2.1`).

### Security
- **Disabled-Module Zero-Write Containment & AST Layer Enforcement (`v1.2.1`):**
  - Verified `archiveSpecToMemory` performs zero disk writes and zero directory creation whenever `cfg.modules.mem` is `false`, Audit Sidecar sweeps respect `cfg.modules.{mem,verify,guard}`, and `PostToolUse` short-circuits in O(1) when all participating modules are off.
  - Verified TypeScript AST architecture checks enforce unidirectional 4-layer imports and the Layer 2 horizontal cross-module allowlist with zero circular dependencies, preserving 100% Zero ASAR / Zero CDP boundaries, four-zero OFF-state isolation for `remote`, 10-key `plugin.json` hygiene, and **101 suites / 286 tests** green.

## [1.2.0] - 2026-11-28

### Added
- **Opt-In Read-Only Audit Sidecar & 11th CLI Command `audit-once` (+0 Model Tools) (`server`, `cli`, `sidecars/`):**
  - Added `src/server/sidecar.ts`, one-shot runner `sidecars/audit-sidecar.mjs`, and usage guide [`sidecars/README.md`](./sidecars/README.md), staying strictly OFF by default (zero idle daemon, zero background polling, zero listening ports, zero directory creation, and zero disk writes until invoked).
  - Aggregates read-only workspace Ops static security & rule scores, Mem stale-anchor & expired-unpinned counts, Verify dirty files & last check status, Guard block counts, and active config posture into a redacted JSON sweep report with actionable recommendations for Antigravity `/schedule` or OS schedulers (`cron`, `launchd`, Task Scheduler).
  - Added the **11th native CLI command** `agy-nov audit-once [--workspace=<dir>] [--data-dir=<dir>] [--json] [--write-report]` and standalone invocation `node sidecars/audit-sidecar.mjs --once`; `--write-report` atomically persists `health-sweep.json` (`<= 64 KiB`, mode `0600`) strictly inside an existing safe non-symlink `dataDir`.
- **Layer 1 Shared `ConversationService` Connect API Collaboration (+0 Model Tools) (`core`, `remote`, `xray`, `radar`):**
  - Added Layer 1 shared client `src/core/conversation-service.ts` wrapping Google Antigravity's official `product.v1.ConversationService` Connect API with strict loopback-only anti-SSRF validation (`127.0.0.1` / `localhost` / `[::1]`), silent graceful degradation when unavailable, zero CSRF token echoing, and full outbound `<private>`/secret redaction, shared cleanly across `remote`, `xray`, and `radar`.
  - Added confirmation-gated App-only tool `app_xray_fork_via_service` (`visibility: ['app']`, +0 model tools) to `xray`: supports dry-run Clean Fork preview and explicit `confirmCreate` creation of a clean new conversation via `ConversationService`, falling back gracefully to `app.sendMessage` when the host service is unavailable.
  - Added read-only App-only tool `app_radar_reconcile_conversations` (`visibility: ['app']`, +0 model tools) to `radar`: performs zero-write reconciliation between the local Radar board and live host `ListConversations`, surfacing ghost sessions that have turned idle alongside newly active host conversations.
- **Antigravity Marketplace Readiness Alignment & 18-Asset `doctor` (`plugin.json`, `cli`):**
  - Refined `plugin.json` while strictly retaining only the 10 officially allowed top-level manifest keys, condensing `description` to **148 characters** (within the 60–200 recommended range) alongside 3 validated `suggestedPrompts` and the 128×128 transparent-background `assets/logo.svg`.
  - Expanded `agy-nov doctor` verification from 16 to all **18 core plugin assets** (adding `sidecars/audit-sidecar.mjs` and `sidecars/README.md`) and integrated **4 Marketplace Readiness Checks** (concise `description` 60–200 chars, 1–3 non-empty `suggestedPrompts`, relative regular `logo` asset containment inside plugin root, and zero always-on `rules/AGENTS.md` rule bloat).
- **Expanded Automated Regression Verification (`test`):**
  - Added `test/v120-sidecar-marketplace.test.ts` covering read-only sidecar sweeps, `audit-once`, `ConversationService` loopback/redaction invariants, `app_xray_fork_via_service`, `app_radar_reconcile_conversations`, and 18-asset + 4-check Marketplace `doctor`, expanding total automated verification to **100 suites / 280 tests** passing green.

### Changed
- **Preserved 13-Module Architecture, 5 Presets & Strictly 47 Canonical Model Tools (+0 Inflation):** All 13 toggleable native modules (12 local offline + 1 opt-in `remote`), 5 presets (`minimal` 6 / `core` 12 / `power` 32 / `local-all` 43 / `full` 47), 6 official Lifecycle Hooks, 6 official Skills, 2 read-only specialist subagents, 4 `agy-nov://context/*` resources, and all **47 canonical model tool names** remain 100% backward-compatible from `v0.4` through `v1.2.0`; `app_xray_fork_via_service` and `app_radar_reconcile_conversations` stay strictly App-only (`visibility: ['app']`) and hidden automatically on headless CLI clients without MCP UI extensions.
- **Updated Runtime Bundles, 11 CLI Commands & 18-Asset `doctor` (`v1.2.0`):**
  - Measured minified `v1.2.0` artifacts: `dist/server.cjs` **`1,583.5 KB`**, `dist/hook.cjs` **`211.9 KB`**, `dist/cli.cjs` **`190.0 KB`**, and single-file 8-language UI `dist/ui/app.html` **`1,390.2 KB`** (`~1.36 MiB`, far below the 10 MiB cap, carrying **755 core dictionary keys × 8 locales** across all **24 UI components**).
  - Updated `src/server/cli.ts` to **11 native CLI commands** (adding `audit-once`), `doctor` to verify all **18** core plugin assets plus **4** Marketplace Readiness Checks (`version=1.2.0`), and synchronized `README.md`, all 7 localized `docs/i18n/README.*.md` files, `llms.txt`, `docs/llms-install.md`, and `skills/agy-nov/SKILL.md` to `v1.2.0` with links to `sidecars/README.md`.

### Security
- **Opt-In Audit Sidecar Zero-Touch & Safe Write Containment (`server`, `sidecars/`):** Sidecar execution starts strictly on demand with zero background daemon, zero listening sockets, zero outbound network traffic, shell-free `spawnSync(..., { shell: false })`, symlink ancestor refusal, 2 MiB JSON read caps, and full `<private>`/secret redaction with host path minimization. `--write-report` writes `health-sweep.json` only when `dataDir` already exists as a safe non-symlink directory, enforcing `<= 64 KiB`, `0600` permissions, `O_CREAT | O_EXCL` temporary files, and atomic rename.
- **Loopback-Only `ConversationService` Anti-SSRF & Zero-Echo Guarantees (`core`, `xray`, `radar`, `remote`):** Enforces strict loopback host validation (`127.0.0.1` / `localhost` / `[::1]`) on Connect API calls, never echoes CSRF tokens in responses or errors, applies full outbound `<private>` and secret redaction, requires explicit `confirmCreate` before `app_xray_fork_via_service` creates a conversation, and keeps `app_radar_reconcile_conversations` strictly read-only with zero disk writes.
- **Marketplace Manifest Hygiene & Zero-Touch Invariants Preserved (`v1.2.0`):** Verified `plugin.json` contains strictly the 10 officially allowed top-level keys (`description` 148 chars, 3 valid `suggestedPrompts`, relative regular `assets/logo.svg`, zero `rules/AGENTS.md`), maintained 100% Zero ASAR / Zero CDP boundaries and four-zero OFF-state isolation for `remote`, and verified **100 suites / 280 tests** green.

## [1.1.0] - 2026-11-28

### Added
- **4-Layer Modular Systems Architecture Refactor & Governance (`src/core/`, `docs/`, `test/`):**
  - Extracted a zero-module-import Layer 1 core kernel (`src/core/fs-safe.ts`, `src/core/process-safe.ts`, `src/core/brain-paths.ts`, `src/core/sanitize.ts`, `src/core/module-contract.ts`) unifying cross-platform `canonicalRealpathSync`, NTFS atomic rename retries, `shell: false` Windows JS entry resolution, Brain path discovery, linear O(n) `<private>` stripping, and secret redaction across every module.
  - Split 8 oversized monolithic files (`src/modules/ops/core.ts`, `src/modules/verify/core.ts`, `src/modules/studio/core.ts`, `src/modules/turbo/core.ts`, `src/modules/spec/core.ts`, `src/modules/worktree/core.ts`, `src/server/cli.ts`, and `ui/src/modules/spec/SpecPanel.tsx`) into cohesive, single-responsibility vertical submodules with **zero circular dependencies** across the entire repository.
  - Published [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and [`CONTRIBUTING.md`](./CONTRIBUTING.md), backed by automated architecture gatekeeping tests (`test/architecture-hygiene.test.ts`) enforcing unidirectional 4-layer imports, zero cycles, and clean kernel boundaries.
- **Spec DAG → `/run-workflow` & `/swarm` Native Orchestration Compiler (+0 Model Tools) (`spec`, `cli`, `ui`, `skills/`):**
  - Added pure read-only compiler `src/modules/spec/compiler.ts` using Kahn topological wave layering to compile approved Spec Task DAGs into standard Antigravity `/run-workflow` Python orchestration scripts (`phase`, `parallel`, `agent`, `log` automatically chaining `nov-blind-reviewer`, `nov-security-auditor`, and `Verify Gate`) and structured `/swarm` `plan.json` blueprints, rejecting dependency cycles and unknown dependencies with linear `<private>` and secret redaction.
  - Added App-only `app_spec_compile_workflow` (`visibility: ['app']`, +0 model tools) and a 1-click preview & export dialog inside the Spec Task DAG header across all 8 UI languages (full key-symmetric localization).
  - Added the **10th native CLI command** `agy-nov compile-spec [--spec=<id>] [--format=workflow|swarm|both] [--json] [--include-completed] [--no-review-gate] [--no-verify-gate] [--workspace=inherit] [--model=inherit|flash|pro]` for zero-write offline compilation.
  - Added the **6th official on-demand Skill** `/nov-workflow` (`skills/nov-workflow/SKILL.md`), expanding `agy-nov doctor` verification to all **16** core plugin assets.
- **Deterministic Security & Zero-Injection Context 2.0 (+0 Model Tools) (`hooks`, `guard`, `server`):**
  - **PreInvocation Inbound Secret Hard Gate (`hooks`, `guard`):** Scans inbound user prompts locally before cloud transmission for high-confidence private keys and API credentials, blocking leaks via official `terminationBehavior: "terminate"` with a zero-secret-echo `errorMessage` (configurable via Guard policy `blockInboundPromptSecrets`).
  - **Official 6th Lifecycle Hook — `PostInvocation` (`hooks.json`, `hooks`):** Added `PostInvocation` (`5s` timeout) with first-line O(1) read-only short-circuiting when `guard`, `turbo`, and `verify` are disabled; emits zero-token visual turn receipts (`systemMessage: ""` + `metadata.user_markdown`) summarizing Guard blocks, Verify dirty files/failures, and Turbo RTK savings.
  - **4 Zero-Injection-Tax Read-Only MCP Context Resources (`src/server/context-resources.ts`):** Exposed `agy-nov://context/review`, `agy-nov://context/mem`, `agy-nov://context/turbo`, and `agy-nov://context/xray` under module toggle gating with full linear `<private>`/secret redaction, `<= 32 KiB` caps, symlink refusal, and strict zero-write isolation.
- **Antigravity 2.35 CLI `statusLine` stdin JSON Fusion (`cli`):**
  - Upgraded `agy-nov statusline` to asynchronously read bounded host CLI stdin JSON telemetry (`model`, `context_window`, `cost`, `quota`, `subagents`, `workspace`) with zero-delay TTY detection, `120ms` timeout protection, and `256 KiB` size caps, adding new `model` and `quota` composable segments (expanding `statusline --segments` to **11** segments fused seamlessly with `agy-NOV` engineering state).
- **Expanded Automated Regression Verification (`test`):**
  - Added `test/architecture-hygiene.test.ts` and `test/v110-workflow-protocol.test.ts`, expanding total automated verification to **97 test suites / 274 tests** passing green.

### Changed
- **Preserved 13-Module Architecture, 5 Presets & Strictly 47 Canonical Model Tools (+0 Inflation):** All 13 toggleable native modules (12 local offline + 1 opt-in `remote`), 5 presets (`minimal` 6 / `core` 12 / `power` 32 / `local-all` 43 / `full` 47), and all **47 canonical model tool names** remain 100% backward-compatible from `v0.4` through `v1.1.0`; all Spec workflow compilation UI controls stay strictly App-only (`visibility: ['app']`) and hidden automatically on headless CLI clients without MCP UI extensions.
- **Updated Runtime Bundles, 6 Hooks, 6 Skills, 10 CLI Commands & 16-Asset `doctor` (`v1.1.0`):**
  - Measured minified `v1.1.0` artifacts: `dist/server.cjs` **`1,572.2 KB`**, `dist/hook.cjs` **`211.9 KB`**, `dist/cli.cjs` **`124.1 KB`**, and single-file 8-language UI `dist/ui/app.html` **`1,390.2 KB`** (`~1.36 MiB`, far below the 10 MiB cap, extending the 755 core dictionary keys × 8 locales with full key-symmetric localization for Spec workflow compilation).
  - Updated `hooks.json` to **6 official Lifecycle Hooks** (`SessionStart`, `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`), `skills/` to **6 official Skills** (`agy-nov` + `/nov-spec`, `/nov-debug`, `/nov-review`, `/nov-handoff`, `/nov-workflow`), `cli.ts` to **10 native CLI commands**, and `doctor` to verify all **16** core plugin assets (`version=1.1.0`).
  - Synchronized `README.md`, all 7 localized `docs/i18n/README.*.md` files, `llms.txt`, `docs/llms-install.md`, and `skills/agy-nov/SKILL.md` to `v1.1.0` with links to `docs/ARCHITECTURE.md` and `CONTRIBUTING.md`.

### Security
- **Inbound Prompt Secret Interception & Zero-Echo Guarantees (`hooks`, `guard`):** `PreInvocation` detects high-confidence private keys and API tokens locally before cloud dispatch, terminating with `terminationBehavior: "terminate"` and returning rule labels only with zero raw secret echoing (controllable via Guard policy `blockInboundPromptSecrets`).
- **MCP Context Resources Containment (`server`):** All 4 `agy-nov://context/*` resources enforce active module enablement checks, symlink refusal (`lstatSync` + `realpath` boundary verification), linear O(n) `<private>` stripping and secret redaction, strict `<= 32 KiB` output caps, and zero directory creation or disk writes.
- **Spec DAG Compiler Safety (`spec`, `cli`):** `compile-spec` and `app_spec_compile_workflow` run strictly read-only, reject dependency cycles and unknown task references before emitting artifacts, strip `<private>` spans and redact secrets linearly, and encode Python string literals safely without raw triple-quote injection.
- **Zero-Touch & Architecture Invariants Preserved (`v1.1.0`):** Maintained 100% Zero ASAR / Zero CDP boundaries, four-zero OFF-state isolation for `remote`, bounded `statusline` stdin parsing (`256 KiB` / `120ms` timeout, zero writes when `dataDir` is absent), clean `https://github.com/tone-leh/agy-Sag` companion links, and 97 suites / 274 tests verified green.

## [1.0.2] - 2026-11-27

### Added
- **Antigravity CLI 100-Tool Budget Gate & Dynamic Workspace Awareness (`server`, `core`, `test`):**
  - Inspected `capabilities.extensions["io.modelcontextprotocol/ui"]` during MCP `initialize`: headless CLI clients without UI extension support automatically hide all `app_*` and `nov_app_*` tools, keeping even the full `full` preset strictly capped at **47** exposed model tools well inside Antigravity CLI's 100-tool budget.
  - Integrated official MCP `roots/list` and `notifications/roots/list_changed` handling in `src/server/index.ts` so cross-project switches immediately refresh the active workspace root in real time.
  - Added read-only auto-detection in `resolveNovDataDir()` for an existing `~/.gemini/antigravity/plugin_data/agy-nov` directory before falling back to `~/.agy-nov-data`, eliminating split-brain config divergence between CLI invocations and the Antigravity host.
- **3-OS Real-Process Hook Black-Box & CLI Gate Regression Suites (`test`):**
  - Added end-to-end 3-OS black-box execution coverage for `hooks.json` + `dist/hook.cjs` alongside Antigravity CLI 47-tool ceiling gate tests, raising total automated verification to **91 test suites / 256 tests**.
- **Refreshed `v1.0.2` 4+1 IA Workbench Preview (`assets`):**
  - Recorded an updated `assets/demo-preview.gif` showcasing the `v1.0.2` 4+1 Domain IA, Workflow Hub, 4-tier Settings Hub, and full 8-language workbench UI.

### Changed
- **Backend Bundle Minification (~45.5% Size Reduction) & Full 755-Key 8-Language Localization (`build`, `ui`):**
  - Enabled `minify: true` for backend bundles, reducing artifact footprint by **~45.5%**: `dist/server.cjs` **`1,541.9 KB`**, `dist/hook.cjs` **`207.1 KB`**, and `dist/cli.cjs` **`94.5 KB`**.
  - Expanded the built-in 8-language UI dictionary by **+264 net keys** to **755 core dictionary keys × 8 locales** across all **24 UI components**, removing 110+ leftover hardcoded English strings across 12 components (`dist/ui/app.html` measured **`1,376.3 KB`** / `~1.34 MiB`, well below the 10 MiB resource limit).
- **Cross-Platform Plugin-Root Relative Hook Commands (`hooks.json`):**
  - Standardized all 5 lifecycle hooks in `hooks.json` onto plugin-root relative commands (`node dist/hook.cjs --event <Event>`), resolving Windows `cmd /c` failures caused by unexpanded `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` placeholders.
- **Dual-Star Feed Telemetry & Subagent Tool Alignment (`core`, `agents/`):**
  - Enriched `<dataDir>/feed-snapshot.json` with `forceAskCount`, `permissionMode`, `snapshotCount`, and `latestSnapshotId` for richer read-only companion visibility.
  - Aligned specialist read-only subagent manifests (`agents/nov-blind-reviewer.md`, `agents/nov-security-auditor.md`) onto the native Antigravity `read_file` tool name.
- **Zero-Global-Install CLI Guidance & Docs Alignment (`v1.0.2`):**
  - Documented direct zero-global-install CLI execution after `agy plugin install` (`node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs <cmd>`, or an optional one-time `npm link` inside the plugin directory for a global `agy-nov` command) across all 8 READMEs, `llms.txt`, `docs/llms-install.md`, and `skills/agy-nov/SKILL.md`.
  - Preserved all 13 toggleable native modules, 5 presets, 9 CLI commands, 5 official Skills, 2 read-only specialist subagents, 5 official Hooks, and all **47 canonical model tool names** strictly unchanged (`v0.4` -> `v1.0.2`).

### Fixed
- **Official Antigravity Hook Protocol Alignment (`hooks`, `verify`):**
  - Aligned `Verify Gate`'s `Stop` hook response with Antigravity's official `decision: "continue"` protocol and added safe pass-through handling for `terminationReason` (`USER_CANCELED`, `ERROR`, `MAX_*`).
  - Updated `PreToolUse` pass-through responses to return `{ decision: "allow" }` explicitly.
- **Frontend `NovBridge`, Host File Previews & `global` Surface Fallbacks (`ui`):**
  - Added first-frame `ontoolresult` cache replay in `NovBridge` to prevent initial render drops when tool payloads arrive before component subscription.
  - Upgraded `app_nov_file_viewer` to fetch real file contents for `antigravity-file://` URIs via host `resources/read` while keeping strict read-only safeguards.
  - Added graceful capability degradation across workspace panels when running inside `global` surfaces that omit pane-specific host actions.
- **Mem 3.0 Batch Verify Anchor Refresh & Auto-RTK Non-ASCII / Parenthesis Paths (`mem`, `turbo`):**
  - Updated `Mem 3.0` batch `verify` actions to refresh code anchor hashes synchronously alongside confidence upgrades.
  - Fixed `Auto-RTK` command handling for Chinese / non-ASCII user directory names and filesystem paths containing parentheses.

### Security
- **Remote 2.5 Same-Origin PIN Lockout DoS & SSE Resource Guardrails (`remote`):**
  - Hardened `Remote 2.5` authentication with same-origin enforcement against cross-origin PIN lockout DoS attempts, and bounded SSE live streams with strict connection caps and periodic heartbeats while keeping `remote` strictly OFF by default with four-zero isolation.
- **Protocol, Workspace & Link Integrity Preserved (`v1.0.2`):**
  - Maintained 100% Zero ASAR / Zero CDP boundaries, 15-asset `agy-nov doctor` verification (`version=1.0.2`), clean companion repository links pointing strictly to `https://github.com/tone-leh/agy-Sag`, and verified all 91 suites / 256 tests across macOS, Windows, and Linux.

## [1.0.1] - 2026-11-27

### Added
- **Windows & Linux Full Cross-Platform Compatibility (`core`, `hooks`, `ui`, `ci`, `test`):**
  - Added cross-platform core path, filesystem, and process utilities: `canonicalRealpathSync` with Windows 8.3 short-path expansion, case-insensitive path boundary comparison on Windows, a Linux `/home` / `/var/run` / `/var/lock` system symlink allowlist, NTFS `EPERM` / `EBUSY` / `EACCES` retry handling in `atomicRenameSync`, and `shell: false` CVE-2024-27980-safe Node JS entry resolution for `npm`, `npx`, `pnpm`, `yarn`, `tsc`, `eslint`, `vitest`, and `jest` on Windows.
  - Added a cross-platform test runner (`scripts/run-tests.mjs`), `.gitattributes` LF line-ending enforcement, and a full **3-OS (`ubuntu-latest` / `windows-latest` / `macos-latest`) × Node 20/22** GitHub Actions CI matrix.
  - Added dedicated cross-platform regression coverage (`test/v101-cross-platform.test.ts`), raising total automated verification to **88 test suites / 245 tests**.

### Changed
- **Runtime, Hook & UI Cross-Platform Hardening (`hooks`, `ui`, `modules`):**
  - Quoted `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` in `hooks.json` for whitespace-safe paths across platforms, switched `dist/hook.cjs` to async bounded stdin streaming, and fixed Windows `file://` URI handling in `ui/src/bridge.ts`.
  - Hardened per-module Windows & Linux runtime behavior: Windows read-only snapshot restore fallback in `guard`, `python` allowlist entry and `taskkill /T /F` process-tree teardown in `verify`, Windows quoting & safe path argument validation in Turbo Auto-RTK, `fileURLToPath` & Windows drive/URI tracking in `mem` and `xray`, `.exe` / `.cmd` / relative path detection in `ops`, and headless-Linux safe notification skipping in `radar`.
- **Preserved 13-Module Architecture & 47 Canonical Model Tools (`v1.0.1`):** All 13 toggleable native modules, 5 presets, 9 CLI commands, 5 official Skills, 2 read-only specialist subagents, 5 official Hooks, and all **47 canonical model tool names** remain strictly unchanged (`dist/ui/app.html` measured `1,261.2 KB` / `~1.23 MiB`, well below the 1.5 MiB target and 10 MiB cap).

### Fixed
- **Documentation & Companion Link Fix:** Updated all companion installation commands (`agy plugin install https://github.com/tone-leh/agy-Sag`) and repository links across all 8 READMEs (`README.md` and `docs/i18n/README.*.md`), `llms.txt`, `docs/llms-install.md`, and `CHANGELOG.md` to `https://github.com/tone-leh/agy-Sag`.

### Security
- **Windows & Linux Destructive Command & Process Hardening (`guard`, `remote`, `verify`, `turbo`, `core`):**
  - Extended `guard` and `remote` destructive command detection with Windows PowerShell and `cmd` rules (`Remove-Item -Recurse -Force`, `rmdir /s`, `del /f /s`, `format`, `Clear-Disk`, `diskpart`, `irm|iex`).
  - Eliminated Windows `.cmd` shell-injection exposure (CVE-2024-27980) by resolving Node JS entrypoints directly under `shell: false`, while preserving canonical workspace boundary checks across Windows case-insensitive drive paths, 8.3 short paths, and Linux system symlinks.
  - Preserved 100% Zero ASAR / Zero CDP boundaries, four-zero OFF-state isolation for `remote`, and 15-asset `agy-nov doctor` verification across macOS, Windows, and Linux.

## [1.0.0] - 2026-11-27

### Added
- **Ops 3.0 — Static Read-Only Security Audit, Cross-Client Dedup Preview & SettingsHub S4 Tool-Slot Idle Advisor (`ops`, `ui`):**
  - Extended `ops_audit_workspace` with a pure read-only static security scanner (`securityFindings` + `securityScore` 0–100, linear O(n), rejecting symlinks, capped at `<= 256 KiB` per file and 80 files max) across workspace rules, skills, hooks, and MCP configs (`src/modules/ops/core.ts`). Accurately detects 4 categories with zero false positives on compliant repositories: `prompt-injection` (BiDi overrides, zero-width steganography, override + exfiltration pairs), `broad-command-allow` (wildcard approvals, `--yolo`, `chmod 777`), `risky-hook` (curl/wget pipe-to-shell, bare `rm -rf`, `eval`), and `mcp-unsafe-env` (hardcoded plaintext credentials reporting key names only with zero secret echoing, plus non-loopback plaintext HTTP endpoints).
  - Upgraded `.claude/` / `.cursor/rules/` / `.codex/` migration hints into a strictly read-only **Deduplication & Slimming Comparison Preview** (`migrationPreview`), computing normalized line and paragraph SHA-256 hashes to report exact duplication ratios, reclaimable bytes, and token savings without modifying any user files.
  - Added an 8-language **Tool-Slot Idle Advisor** in **Settings Hub S4** (`SettingsHub`), surfacing idle heavy modules and enabling one-click toggling off to reclaim Antigravity's 100-tool MCP budget.
- **Mem 3.0 — Memory Hygiene, Confidence Tiers & TTL Governance (`mem`, `hooks`, `ui`):**
  - Added source confidence tiers (`confidence`: `verified` / `normal` / `tentative`), provenance markers (`source`: `manual` / `spec_archive` / `auto_capture`), and optional TTL expiration (`ttlDays` 1–365 / `expiresAt`) while preserving seamless backward-compatible loading of legacy `memories.json` files (`src/modules/mem/store.ts`, `src/modules/mem/register.ts`).
  - Downgraded `Stop`-hook auto-captured memories by default to `tentative` with a `14`-day TTL so transient missteps do not pollute future sessions; `SessionStart` L1 Index and default `mem_recall` automatically exclude expired unpinned `tentative` entries (`includeExpired: true` recovers them on demand, while `pinned` entries never expire).
  - Upgraded `MemPanel` with memory hygiene summary filter pills, confidence & TTL badges, multi-select checkboxes, and a batch cleanup bar (**Verify / Refresh TTL (+30d) / Prune** with inline double confirmation). Kept model tools strictly at **3** (`mem_remember`, `mem_recall`, `mem_forget`), adding App-only `app_mem_get_hygiene_summary` (read-only) and `app_mem_batch_hygiene` (mutating, disabled automatically whenever `mem` is turned off).
- **Customizable CLI `statusLine` + Preview-Then-Confirm `.agy-nov.json` Scaffold (`cli`):**
  - Extended `agy-nov statusline` with `--segments=<csv>` (plus `AGY_NOV_STATUSLINE_SEGMENTS` environment-variable fallback) to compose any subset of **9 read-only status segments** (`brand`, `context` context usage bar, `burn` 5h burn rate, `cache` prefix cache hit rate, `spec`, `verify`, `guard` permission mode & block count, `radar`, `network`) with zero LLM tokens, zero disk writes when `dataDir` is absent, and strict symlink rejection (`src/server/cli.ts`).
  - Extended `agy-nov recommend` with `--export-preset`, defaulting to a strictly **read-only preview** of the generated `.agy-nov.json` team preset scaffold (zero disk writes, never emits `remote`, all verify commands validated against the 23-executable allowlist). Writes atomically only when `--confirm` is explicitly passed (refusing to overwrite existing files without `--force`, hard-rejecting symlink targets) and runs immediate post-write self-validation.
- **Expanded Automated v1.0.0 Production-Grade Test Suite (`test`):**
  - Added 3 dedicated v1.0.0 test suites (`test/v10-ops-security-dedup.test.ts`, `test/v10-mem-hygiene-ttl.test.ts`, `test/v10-cli-statusline-preset.test.ts`), raising total automated verification to **85 test suites / 233 tests**.

### Changed
- **Preserved 13-Module Architecture, 5 Presets, 9 CLI Commands, 5 Skills, 2 Read-Only Subagents & 47 Model Tools Unchanged:** Across `v0.4` -> `v1.0.0`, all 13 toggleable native modules (12 local offline + 1 opt-in `remote`), 5 presets (`minimal` 6 / `core` 12 / `power` 32 / `local-all` 43 / `full` 47), 9 CLI commands, 5 official on-demand Skills, 2 read-only specialist subagents, and all **47 canonical model tool names** remain 100% backward-compatible with **+0 tool-slot inflation**.
- **Bundle, 8-Language UI & Docs Alignment (`v1.0.0` GA):** Updated `package.json`, `plugin.json`, `src/server/cli.ts`, all 8 bundled UI languages across all **24 UI components** (`dist/ui/app.html` `~1.2 MB`, measured `1,260.1 KB`, well below the 1.5 MiB target and 10 MiB cap), `skills/agy-nov/SKILL.md`, `README.md`, all 7 localized `docs/i18n/README.*.md` files, `llms.txt`, and `docs/llms-install.md` to `v1.0.0`.

### Security
- **Ops 3.0 Static Security Scan & Zero-Echo Dedup Preview (`ops`):** Enforced strictly read-only O(n) scanning with symlink refusal, `<= 256 KiB` file cap, 80-file scan ceiling, zero secret value echoing (reporting credential key names only), and zero writes to any workspace or external client rule directories during cross-client deduplication preview.
- **Mem 3.0 Hygiene Gating & Synchronized App-Tool Shutdown (`mem`, `hooks`):** Defaulted `Stop`-hook auto-captures to `tentative` + `14`-day TTL to prevent unverified context pollution, required inline double confirmation for batch pruning, and synced `app_mem_batch_hygiene` enable/disable state strictly with the `mem` module switch while keeping `app_mem_get_hygiene_summary` read-only.
- **CLI `statusline` & `.agy-nov.json` Export Scaffold Hardening (`cli`):** Enforced symlink refusal and zero disk writes when `dataDir` is absent for `statusline --segments`; locked `recommend --export-preset` to read-only preview by default, requiring explicit `--confirm` for atomic writes (with `--force` required for overwrites, hard symlink refusal, allowlisted-only verify commands, and permanent exclusion of `remote`).
- **Zero-Touch Invariants Preserved:** Maintained 100% Zero ASAR / Zero CDP boundaries, four-zero OFF-state isolation for `remote`, zero default resident `rules/AGENTS.md` bloat, and 15-asset `agy-nov doctor` verification.

## [0.9.0] - 2026-11-27

### Added
- **End-to-End Engineering Pipeline Loop (`Spec → Worktree → Two-Stage Review → Verify → Mem`):**
  - **Safe Read-Only `.worktreeinclude` & One-Click Handoff (`worktree`):** Added read-only `.worktreeinclude` allowlist preview (`app_worktree_preview_include`) and default-on `applyInclude` copying inside `worktree_create`, strictly rejecting `.env*`, SSH keys, symlinks, and out-of-workspace paths while surfacing rejected entries in `skippedSensitive` with zero automatic RCE scripts (`src/modules/worktree/core.ts`). Added one-click jump actions on each worktree card to open `Review` or `Verify` against that branch.
  - **Two-Stage Review & Worktree Branch Switcher (`review`):** Enabled one-click switching to review any registered worktree branch, automatically loading active Spec acceptance criteria read-only (`loadActiveSpecComplianceReadOnly`) to run a structured two-stage review (**Stage 1:** Spec compliance checklist + **Stage 2:** code quality `file:line` annotations).
  - **Worktree-Targeted Verification & Redacted PR Evidence (`verify`):** Added targeted allowlisted verification inside any registered worktree (`worktreePath`) and App-only `app_verify_pr_summary` (`buildPrDeliverySummary`) to generate paste-ready, secret-redacted PR delivery evidence summaries.
  - **Approval-First 4-Lane Kanban Board (`radar`):** Added an approval-first 4-lane Kanban view (`Awaiting Approval` pinned first → `Running` → `Stalled / Error` → `Completed`) with one-click card jump directly into `Review`.
- **One-Click Clean Fork Anti-Context-Rot (`xray`, `hub`, `ui`):**
  - Added read-only App-only `app_xray_build_clean_fork_pack` (`src/modules/xray/clean-fork.ts`, zero model-tool tax) aggregating a redacted X-Ray handoff brief, active Spec unblocked `ready` tasks, and Mem code-anchored decisions inside a linear-redacted `<= 12 KB` budget.
  - Wired One-Click Clean Fork into both `XrayPanel` and `HubPanel`, launching a fresh clean background session in the same project via official MCP Apps `app.sendMessage({ _meta: { "com.google.antigravity/message": { target: "new" } } })` and gracefully falling back to context-pill attachment or clipboard copy on `global` surfaces lacking the `message` capability.
- **4 On-Demand Official Slash Playbooks + 2 Read-Only Specialist Subagents (`skills/`, `agents/`):**
  - Added 4 on-demand official slash playbooks occupying zero MCP tool slots and zero resident `rules/AGENTS.md` bloat: `/nov-spec` (`skills/nov-spec/SKILL.md`, Spec-first & Brownfield Delta workflow), `/nov-debug` (`skills/nov-debug/SKILL.md`, 4-step root-cause debugging), `/nov-review` (`skills/nov-review/SKILL.md`, two-stage Spec + diff review), and `/nov-handoff` (`skills/nov-handoff/SKILL.md`, anti-context-rot handoff & Clean Fork).
  - Added 2 independent read-only specialist subagents (`agents/nov-blind-reviewer.md` for zero-history-bias two-stage code review and `agents/nov-security-auditor.md` for OWASP & local-agent red-team auditing), strictly declaring read-only tools (`read_file`, `grep_search`, `find_by_name`, `list_dir`) with `subagent: true` and `mainAgent: false`.
- **MCP Apps `file` Native Custom File Viewer + Remote 2.5 Structured Risk Approval Cards (`studio`, `remote`, `ui`):**
  - Registered official `com.google.antigravity/ui` `file` entrypoint `app_nov_file_viewer` (`src/modules/studio/file-viewer.ts`, completely hidden from models with zero tool-slot tax) supporting `.sqlite`, `.sqlite3`, `.db`, `.csv`, `.tsv`, `.svg`, `.openapi.yaml`, and `.openapi.yml` previews even when `studio` or `canvas` is toggled off.
  - Upgraded `remote` to **Remote 2.5**, enriching Mobile PWA and IM approval cards with structured risk context (`HIGH` / `MED` / `LOW` risk badge, affected file count, redacted command summary, and latest read-only `Verify` status) rendered strictly via pure DOM APIs with zero `innerHTML`.
- **Expanded 15-Asset `doctor` Verification & Automated v0.9.0 Regression Suite (`cli`, `test`):**
  - Expanded `agy-nov doctor` read-only asset validation from 9 to all **15** core plugin files (covering all 5 official Skills and 2 read-only specialist subagents alongside manifests, logo, and bundles).
  - Added 3 dedicated v0.9.0 automated test suites (`test/v09-pipeline-chain.test.ts`, `test/v09-fork-viewer-remote.test.ts`, `test/v09-skills-agents.test.ts`), raising total automated verification to **77 suites / 209 tests**.

### Changed
- **Preserved 13-Module Architecture, 5 Presets, 9 CLI Commands & 47 Model Tools Unchanged:** All 13 toggleable native modules (12 local offline + 1 opt-in `remote`), 5 presets (`minimal` 6 / `core` 12 / `power` 32 / `local-all` 43 / `full` 47), 9 CLI commands, and all **47 canonical model tool names** remain 100% backward-compatible with zero tool-slot inflation; all v0.9.0 pipeline preview, Clean Fork, PR summary, and native file viewer actions remain strictly App-only (`visibility: ['app']`).
- **Bundle, UI Localization & Docs Alignment:** Updated `package.json`, `plugin.json`, `src/server/cli.ts`, all 8 bundled UI languages across all **24 UI components** (`dist/ui/app.html` `~1.2 MB`, measured `1,233.1 KB`, far below the 10 MiB cap), `skills/agy-nov/SKILL.md`, `README.md`, all 7 localized `docs/i18n/README.*.md` files, `llms.txt`, and `docs/llms-install.md` to `v0.9.0`.

### Security
- **`.worktreeinclude` Anti-RCE & Sensitive-File Rejection (`worktree`):** Enforced strictly read-only allowlist parsing (zero post-create shell scripts), canonical `realpath` containment, file count/size caps, and hard rejection of `.env*`, private keys, symlinks, and out-of-workspace paths reported explicitly in `skippedSensitive`.
- **Native `file` Viewer Containment & SVG XSS Sanitization (`studio`, `ui`):** Enforced strict canonical `realpath` workspace containment, SVG XSS sanitization (stripping `<script>`, event handlers, and unsafe URIs), and safe read-only fallback handling for opaque `antigravity-file://` URIs while keeping `app_nov_file_viewer` completely hidden from model tool lists.
- **Clean Fork Redaction Cap & Read-Only Subagent Isolation (`xray`, `agents/`):** Capped Clean Fork payloads at `<= 12 KB` with linear O(n) secret & `<private>` redaction; locked `agents/nov-blind-reviewer.md` and `agents/nov-security-auditor.md` strictly to read-only tools (`read_file`, `grep_search`, `find_by_name`, `list_dir`) with `subagent: true, mainAgent: false` and zero resident `rules/AGENTS.md` injection.
- **Remote 2.5 DOM Safety & Four-Zero Isolation (`remote`):** Rendered structured risk badges, affected file counts, redacted command summaries, and read-only `Verify` status using pure DOM APIs with zero `innerHTML`, zero remote file writes, zero remote shell access, and unchanged four-zero isolation while `remote` stays OFF.

## [0.8.0] - 2026-11-27

### Added
- **Auto-RTK Transparent `PreToolUse.overwrite` Proxy & `PostToolUse` Hotspot Discovery (`turbo`, `hooks`, `cli`):**
  - Added an opt-in transparent token-saving command proxy strictly disabled by default (`autoRtk: false` in `<dataDir>/modules/turbo/prefs.json`).
  - When explicitly enabled, `PreToolUse` rewrites strictly allowlisted single commands (test runners, build/typecheck/lint scripts, and read-only Git queries — zero shell metacharacters, zero `shell: true`) via official `PreToolUse.overwrite` into `agy-nov compact-run --payload=<base64url>` (`src/modules/turbo/auto-rtk.ts`).
  - Non-zero exits preserve complete error stacks (minimum 60-line failure tail), propagate the exact original exit code, and persist redacted raw output to owner-only `0600` `<dataDir>/modules/turbo/last-raw.log` (`<= 128 KiB`).
  - Added `PostToolUse` noisy-command hotspot detection (`hotspots.json`, capped at 20 prefixes) surfaced in both `TurboPanel` and the **Settings Hub S3** drawer for one-click Auto-RTK activation.
  - Added the **9th CLI command** `agy-nov compact-run --payload=<base64url>` (`status`, `enable`, `disable`, `preset`, `locale`, `statusline`, `recommend`, `doctor`, `compact-run`) and App-only preference controls (`app_turbo_get_prefs`, `app_turbo_update_prefs`).
- **Turbo 3.0 — Offline Locked Dependency Contracts, Lightweight Cross-File Symbol References & Redacted Context Pack (`turbo`):**
  - Extended `turbo_read_outline` with `depPackage` (and App-only `app_turbo_inspect_dep`) for 100% offline read-only signature lookup across workspace-locked `node_modules/.d.ts` (including barrel re-exports up to depth 2 / 8 files), Python `.venv/.pyi`, Go `go.mod`, and Rust `Cargo.lock` — strictly enforcing `realpath` containment and UTF-8 code-point-safe `<= 8.8 KB` output caps (`src/modules/turbo/dep-contract.ts`).
  - Extended `turbo_batch_search` with `mode: "references"` for strictly O(n) lexical-boundary cross-file lookup categorizing `definitions`, `imports`, and `usages` without any resident LSP server (`src/modules/turbo/references.ts`).
  - Added App-only `app_turbo_build_context_pack` (`src/modules/turbo/context-pack.ts`) to assemble directory, safe-glob (up to 16 patterns), or `fromGitDiff` slices with configurable token budgets (`256`–`32,000`, default `8,000`), automatic sensitive/binary/symlink skipping, and linear O(n) secret redaction.
  - Zero model-tool expansion: `turbo` remains strictly at **3** canonical model tools (`turbo_batch_search`, `turbo_read_outline`, `turbo_compact_output`).
- **Guard 2.5 — Turn-Grouped Snapshot Rewind & 3-Tier Protocol Permission Modes (`guard`, `hooks`, `ui`):**
  - Grouped pre-edit snapshots automatically by session and turn (`turnKey`), guaranteeing that reverting a turn where a file was edited multiple times restores the original state captured **before the first edit** in that turn.
  - Added multi-file turn diff preview (`app_guard_get_turn_diff`), All-or-Nothing workspace-boundary and symlink preflight validation, automatic `pre-rewind` backup checkpoints, and inline double-confirmation one-click full-turn rollback (`app_guard_restore_turn`).
  - Added 3 protocol-level `permissionMode` tiers persisted in `0600` `policy.json` and wired directly into `GuardPanel` and **Settings Hub S3**:
    - `readonly-audit`: hard `deny` blocking all mutating file tools and command execution tools.
    - `balanced-dev`: default balanced safety firewall.
    - `strict-gate`: enforces mandatory human confirmation via official `PreToolUse` `force_ask` on all file writes and command executions while keeping critical secret/destructive rules at hard `deny` (`ask` can never downgrade `force_ask`).
  - Zero model-tool expansion: `guard` remains strictly at **4** canonical model tools (`guard_status`, `guard_list_snapshots`, `guard_create_checkpoint`, `guard_scan_secrets`).
- **Full 8-Language Localization & Automated v0.8.0 Regression Suite (`ui`, `test`):**
  - Updated all 8 bundled UI languages (`en`, `zh-CN`, `zh-TW`, `ja`, `ko`, `es`, `fr`, `de`) across `TurboPanel`, `GuardPanel`, and `SettingsHub` S3 drawers (now covering 6 configurable strategy modules: `guard`, `turbo`, `verify`, `spec`, `radar`, `remote`).
  - Added 3 dedicated v0.8.0 automated test suites (`test/v08-auto-rtk.test.ts`, `test/v08-turbo-contracts-pack.test.ts`, `test/v08-guard-rewind-modes.test.ts`), raising total automated verification to **67 suites / 187 tests**.

### Changed
- **Preserved 13-Module Architecture, 5 Presets & 47 Model Tools Unchanged:** All 13 toggleable native modules (12 local offline + 1 opt-in `remote`), 5 presets (`minimal` 6 / `core` 12 / `power` 32 / `local-all` 43 / `full` 47), and all 47 canonical model tool names remain 100% backward-compatible with zero tool-slot inflation.
- **Expanded `turbo` Hook Wiring & Strict `PreToolUse` Precedence:** Extended `turbo` hooks from `SessionStart` to `SessionStart`, `PreToolUse`, and `PostToolUse` while enforcing strict `PreToolUse` precedence: `guard` (`deny` / `force_ask` / `ask`) > `spec` (`deny`) > `remote` (`deny` / `force_ask` / `ask`) > `turbo` Auto-RTK (`overwrite`, invoked exclusively when all higher gates remain clean).
- **Bundle, CLI, Feed & Docs Alignment:** Updated `package.json`, `plugin.json`, `src/core/feed.ts`, `src/server/cli.ts` (9 CLI commands), `skills/agy-nov/SKILL.md`, `README.md`, all 7 localized `docs/i18n/README.*.md` files, `llms.txt`, and `docs/llms-install.md` to `v0.8.0` (`dist/ui/app.html` `~1.2 MB`, measured `1,201.2 KB`, far below the 10 MiB cap).

### Security
- **Auto-RTK Zero-Shell & Fail-Safe Hardening (`turbo`, `cli`, `hooks`):** Auto-RTK stays strictly `false` by default, rejects all shell metacharacters, control bytes, glob wildcards, env-assignment prefixes, and shell/interpreter binaries (`sh`, `bash`, `zsh`, `node`, `eval`, etc.), validates allowlisted command prefixes and safe flags, runs via shell-free `spawnSync` (`shell: false`), preserves original non-zero exit codes with failure stacks, and writes redacted `last-raw.log` at mode `0600` (`<= 128 KiB`).
- **Turbo 3.0 Offline Containment (`turbo`):** `depPackage` inspection enforces canonical `realpath` confinement inside workspace dependency directories with strict file-size and re-export depth limits (`<= 8.8 KB` UTF-8 safe output); `references` scanning enforces O(n) lexical tokenization with file/hit/time caps; Context Pack enforces `realpath` boundaries, skips sensitive/binary/symlink files, and runs linear O(n) secret redaction.
- **Guard 2.5 Rewind Atomicity & Protocol Mode Integrity (`guard`, `hooks`):** Turn-grouped rewind runs All-or-Nothing preflight boundary and symlink verification across every target file before mutating disk, records `pre-rewind` safety backups, and requires inline double confirmation; `strict-gate` emits official `force_ask` that cannot be downgraded by lower `ask` decisions while high-risk rules remain hard `deny`.
- **Zero-Touch Invariants Preserved:** Maintained 100% Zero ASAR / Zero CDP boundaries, four-zero OFF-state isolation for `remote`, and zero-write guarantees for read-only CLI commands (`status`, `statusline`, `recommend`, `doctor`) and `PreInvocation`.

## [0.7.0] - 2026-11-27

### Added
- **4+1 Functional Domain IA, Adaptive Wide/Narrow Navigation, Workflow Hub & `⌘K` Command Palette (`ui`, `core`):**
  - Reorganized all 13 native modules into **4 clear functional domains** — Core Essentials (`core`: `review`, `guard`, `xray`), Engineering Pipeline (`pipeline`: `spec`, `worktree`, `verify`, `turbo`, `mem`), On-Demand Toolbox (`toolbox`: `radar`, `studio`, `canvas`, `ops`), and Opt-In Connectivity (`connectivity`: `remote`) — fronted by the **+1 Workflow Hub** (`HubPanel`).
  - Built responsive wide/narrow navigation within the single UI bundle: `< 720px` narrow sidebars (`aux_pane`) switch to a clean 4-control top bar with a domain-grouped dropdown switcher; `>= 720px` full-width panes (`global`) switch to a `204px` domain-grouped left rail.
  - Added the **L0 Workflow Hub** overview featuring a 6-node pipeline status strip, prioritized alert cards, and a `Cmd/Ctrl+K` (`⌘K`) command palette for instant jumps across views and modules, plus configurable `startupView` (`hub` | `last`).
- **4-Tier Unified Settings Hub (`SettingsHub`, `server`):**
  - **S1:** Global mode controls, instant search, 5 one-click presets, and a live 100-tool budget progress bar.
  - **S2:** Single-source-of-truth domain-grouped master switches for all 13 modules.
  - **S3:** On-demand policy drawers expanded exclusively for enabled modules (`guard`, `verify`, `spec`, `radar`, `remote`).
  - **S4:** Collapsed-by-default advanced governance with redacted JSON config export, allowlist-validated config import (blocking prototype pollution and refusing silent `remote` enablement), inline double-confirmation reset to defaults, plus read-only `.agy-nov.json` team preset and dual-star feed status.
  - Added 5 App-only control tools (`nov_app_get_hub_state`, `nov_app_set_startup_view`, `nov_app_export_config`, `nov_app_import_config`, `nov_app_reset_config`) marked `visibility: ['app']` so model-visible tools remain strictly unchanged at **47**.
- **Spec 2.0 — Plannotator Inline Review Bench, Brownfield Delta Spec & Archive to `mem` (`spec`):**
  - Added `full` and `delta` (`ADDED` / `MODIFIED` / `REMOVED`) specification modes tailored for both greenfield plans and brownfield repository changes.
  - Added automatic revision numbering with a rolling history of the **latest 8 snapshots** and a zero-dependency pure-TypeScript line-level LCS diff engine (automatically falling back to linear diffing beyond **600 lines**).
  - Added inline `Comment`, `Strike`, and `Replace` annotations with one-click structured bounce-back prompts to the agent, plus one-click archival into `mem` with automatic `<private>` tag stripping and secret redaction.
- **Dual-Star Read-Only Feed Snapshot (`feed-snapshot.json`) & Official `PreInvocation` Zero-Token Visual Receipts (`core`, `hooks`, `docs`):**
  - Added event-driven `<dataDir>/feed-snapshot.json` generation (`src/core/feed.ts`) with `0600` atomic writes, hard `< 64 KiB` size cap, linear O(n) full redaction, explicit declaration of all `modules/<id>/` paths, and strict zero-write / zero-mkdir guarantees when `dataDir` does not yet exist.
  - Published canonical architecture & integration specs: [`docs/DUAL-STAR-CONTRACT.md`](./docs/DUAL-STAR-CONTRACT.md) and [`docs/PRODUCT-IA.md`](./docs/PRODUCT-IA.md).
  - Extended `hooks.json` from 4 to **5 official Antigravity Lifecycle Hooks** by adding `PreInvocation` (5s timeout) emitting zero-model-token visual receipts (`systemMessage: ""` + `metadata.user_markdown`) for active `spec` draft write locks, `mem` stale-anchor warnings, and recent `guard` denies, with O(1) short-circuiting when all three modules are off.
- **Expanded 8-Language Dictionary & Automated v0.7.0 Test Coverage:**
  - Expanded the built-in 8-language UI dictionary to **491 keys × 8 locales** covering all **24 UI components** (including new `HubPanel` and `SettingsHub`).
  - Added 3 dedicated v0.7.0 automated test suites (`test/v07-feed-preinvocation.test.ts`, `test/v07-spec-plannotator.test.ts`, `test/v07-settings-ia.test.ts`), raising total automated verification to **55 suites / 163 tests**.

### Changed
- **Preserved 13-Module Architecture, 5 Presets, 8 CLI Commands & 47 Model Tools Unchanged:** All 13 toggleable native modules (12 local offline + 1 opt-in `remote`), 5 presets (`minimal` 6 / `core` 12 / `power` 32 / `local-all` 43 / `full` 47), 8 CLI commands, and all 47 canonical model tool names (including `spec`'s 4 tools) remain 100% backward-compatible.
- **Extended `nov_open` Targets:** `nov_open` now accepts `'hub'` and `'settings'` alongside all 13 module IDs and backward-compatible `'modules'`.
- **Bundle, Docs & Metadata Alignment:** Updated `package.json`, `plugin.json`, `hooks.json`, `skills/agy-nov/SKILL.md`, `README.md`, all 7 localized `docs/i18n/README.*.md` files, `llms.txt`, and `docs/llms-install.md` to `v0.7.0` (`dist/ui/app.html` `~1.1 MB`, measured `1,112.7 KB`, far below the 10 MiB cap; 491 keys × 8 locales across 24 components).

### Security
- **Dual-Star Feed Snapshot Containment & Zero-Touch Guarantees (`core`):** Enforced symlink checks (`lstatSync`), `0600` atomic rename writes, `< 64 KiB` hard cap, linear O(n) redaction stripping tokens/keys/webhooks/`<private>` spans, and zero directory creation or disk writes when `dataDir` is absent.
- **Zero-Token Non-Blocking `PreInvocation` Hook (`hooks`):** Strictly sets `systemMessage: ""` while placing sanitized Markdown inside `metadata.user_markdown`, never emits termination/block directives, performs zero writes, and short-circuits in O(1) when `spec`, `mem`, and `guard` are disabled.
- **Settings Hub Governance Hardening (`server`, `ui`):** Config export outputs allowlisted fields only (zero secrets, zero host paths); config import enforces strict allowlist validation, blocks `__proto__` / `constructor` / `prototype` prototype pollution, and refuses silent `remote` enablement; reset to defaults requires explicit inline double confirmation (`confirm: true`).
- **Spec 2.0 Diff & Archive Hardening (`spec`):** Pure-TypeScript LCS diff falls back linearly past 600 lines to prevent CPU spikes, and archiving specs to `mem` automatically strips `<private>` blocks and redacts credentials while maintaining 100% Zero ASAR / Zero CDP invariants.

## [0.6.0] - 2026-11-27

### Added
- **Mem 2.0 — 3-Layer Progressive Disclosure & `<private>` Tag Stripping (`mem`):**
  - Upgraded `SessionStart` memory injection to a compact **L1 Index** (`<= 1,200` chars) to drastically reduce initial context overhead across sessions.
  - Extended existing `mem_recall` (zero tool-count expansion) with `mode: "index" | "timeline" | "detail"`, `ids[]`, and `window` parameters so agents can browse compact L1 entries, fetch chronological L2 timelines, and load full L3 memory details on demand.
  - Added linear O(n) `<private>...</private>` tag stripping (with unclosed-tag truncation defense against partial leaks) across memory writes and hooks, plus automatic Stop-hook skipping when a turn contains purely private content.
- **Turbo 2.5 — Cumulative `gain` Dashboard, `<= 8.8 KB` Anti-Spill Guard & Nested Multi-Indent Outlines (`turbo`):**
  - Added an in-memory cumulative savings **Gain Dashboard** (`app_turbo_get_gain`) tracking saved tokens and estimated USD savings locally (benchmarked at `$2.50 / 1M` tokens).
  - Enforced a UTF-8 code-point-safe **`<= 8.8 KB` (`8,800 B`)** anti-spill guardrail across all three model tools (`turbo_batch_search`, `turbo_read_outline`, `turbo_compact_output`) to prevent oversized tool outputs from spilling to host temp files.
  - Upgraded `turbo_read_outline` beyond top-level declarations to capture multi-indent nested symbols: TypeScript/JavaScript class methods & interface members, Python class methods, Go receiver methods, and Rust `impl`/`trait` methods.
- **Remote 2.0 — Read-Only Mobile PWA Conversation Live Stream & Safe Tunnel Guide (`remote`):**
  - Enabled tapping any conversation in the Mobile PWA to expand a read-only, redacted live step stream (`GET /api/conversations/:id/stream`) strictly limited to observation without exposing file writes or remote shell access.
  - Added on-demand read-only `tailscale` and `cloudflared` binary detection in the Remote Hub with copyable safe tunnel command guides (shell-free `execFile`, zero automatic public tunnel spawning; keeps strict four-zero OFF-state isolation while disabled).
- **Single-File Team Preset `.agy-nov.json` & Ops 2.5 Cross-Client Pitfall Detection (`core`, `ops`, `cli`):**
  - Added support for an optional single-file workspace team preset `.agy-nov.json` (strictly read-only; never auto-creates clutter directories inside user repos), integrated directly into `agy-nov recommend` for read-only team preset validation.
  - Upgraded `ops_audit_workspace` (Ops 2.5) to detect Antigravity `#233` unexpanded `${ENV_VAR}` config traps, `#1937` duplicate plugin / duplicate MCP server definitions, and read-only cross-client migration hints for `.claude/`, `.cursor/rules/`, and `.codex/` with zero secret echoing.
- **Expanded 8-Language Localization & Automated v0.6.0 Regression Coverage:** Expanded the built-in 8-language UI dictionary to **426 keys × 8 locales** covering 100% of all **22 UI components**, and added 4 dedicated v0.6.0 regression test suites (`test/v06-mem-progressive.test.ts`, `test/v06-turbo-gain.test.ts`, `test/v06-remote-live.test.ts`, `test/v06-team-ops.test.ts`) bringing total automated verification to **48 suites / 140 tests**.

### Changed
- **Preserved 13-Module Architecture, 5 Presets & 47 Model Tools Unchanged:** All 13 toggleable native modules (12 local offline + 1 opt-in `remote`), 5 presets (`minimal` 6 / `core` 12 / `power` 32 / `local-all` 43 / `full` 47), and all 47 canonical model tool names remain 100% backward-compatible with zero tool-count inflation.
- **CLI `recommend` Team-Preset Integration:** Extended `agy-nov recommend` (8 CLI commands unchanged: `status`, `enable`, `disable`, `preset`, `locale`, `statusline`, `recommend`, `doctor`) to read and statically validate optional workspace `.agy-nov.json` files without disk writes or command execution.
- **Bundle, UI & Metadata Alignment:** Updated `package.json`, `plugin.json`, `skills/agy-nov/SKILL.md`, `README.md`, `docs/i18n/README.zh-CN.md`, `llms.txt`, and `docs/llms-install.md` to `v0.6.0` (`dist/ui/app.html` `~985 KB`, verified at `985.3 KB`, far below the 10 MiB cap; 426 keys × 8 locales across 22 components).

### Security
- **Remote 2.0 Read-Only Stream & Tunnel Hardening (`remote`):** Protected `GET /api/conversations/:id/stream` with strict token authentication, regex conversation ID traversal blocking, dual-pass secret/credential redaction, a `256 KiB` file tail cap, and zero-`innerHTML` DOM rendering against XSS; tunnel detection uses shell-free `execFile`, never auto-starts public tunnels, and preserves zero ports / zero polling / zero writes / zero outbound traffic while `remote` stays OFF.
- **Team Preset `.agy-nov.json` Static Containment (`core`, `cli`):** Enforced strictly read-only parsing with a `64 KiB` size cap, `realpath` workspace containment, `__proto__` / `constructor` / `prototype` prototype-pollution defense, static validation against a strict per-tool 23-executable verify command allowlist with zero automatic execution, and hard refusal to silently enable `remote`.
- **Mem 2.0 Privacy Stripping & Turbo 2.5 UTF-8 Truncation Safety (`mem`, `turbo`):** Implemented O(n) `<private>` block stripping with unclosed-tag tail truncation to block accidental secret persistence, and enforced code-point-safe UTF-8 slicing at `<= 8.8 KB` (`8,800 B`) to prevent surrogate splitting and host file spilling.
- **Ops 2.5 Zero-Echo Cross-Client Diagnostics (`ops`):** Inspected `${ENV_VAR}` traps (`#233`), duplicate plugins/MCP servers (`#1937`), and `.claude/` / `.cursor/rules/` / `.codex/` migration cues strictly read-only without echoing any secret values, while preserving 100% Zero ASAR / Zero CDP invariants.

## [0.5.0] - 2026-11-27

### Added
- **100% Full-Component 8-Language Localization (400 Keys × 8 Locales across All 22 UI Components):** Completed localization for all remaining subcomponents across `review` (5 subcomponents) and `xray` (3 subcomponents), eliminating hardcoded English fallbacks across the entire workbench UI. Added a collapsible **"30-Second Zero-Risk First Try"** onboarding card inside the **Modules** tab.
- **Context X-Ray 2.0 (`xray` — Offline USD Billing, 5h Burn-Rate Alerts, Anti-Compaction Handoff & OTLP/CSV Export):**
  - Built-in offline reference model pricing table with strictly read-only custom override support via `<dataDir>/modules/xray/pricing-overrides.json` (`<= 1 MiB`), surfacing estimated session USD spend and prefix-cache USD savings locally with zero network requests.
  - Added 14-day daily spend trend tracking and a rolling **5-hour burn-rate warning window** (`normal` / `elevated` / `critical`).
  - Extended `xray_export_brief` with `format: 'brief' | 'handoff' | 'otlp' | 'csv'` for one-click anti-compaction handoff snapshots, OpenTelemetry JSON payloads, and spreadsheet-safe CSV exports with formula-injection neutralization.
- **Verify Gate Read-Only Stack Auto-Detection (`verify`):** Added zero-write workspace stack detection (`detectWorkspaceVerifyCommands`) scanning `package.json` (`pnpm` / `yarn` / `bun` / `npm`), `pyproject.toml` / `pytest.ini`, `Cargo.toml`, and `go.mod`, re-validating every candidate against the shell-free 17-binary allowlist before surfacing one-click safe check recommendations.
- **Diff Review Power Trio (`review`):**
  - Added zero-dependency pure-React lightweight syntax highlighting inside `DiffViewer` (zero `dangerouslySetInnerHTML`).
  - Added an **Ignore Whitespace (`-w`)** diff toggle across working-tree, staged, and commit scopes.
  - Added deterministic, zero-ReDoS line-level risk pre-annotations (`detectLineRiskHint`) with one-click conversion into structured review annotations.
- **Workspace Studio Zero-Dependency OpenAPI 2.0 / 3.x Parser (`studio`):** Added an offline pure-Node OpenAPI / Swagger YAML & JSON parser (`src/modules/studio/openapi.ts`) scanning workspace `.openapi.yaml` / `.openapi.json` / `openapi.*` / `swagger.*` specs into a clickable endpoint collection that auto-populates the loopback-only HTTP probe.
- **8th CLI Command — Read-Only `agy-nov recommend`:** Added `agy-nov recommend [--workspace=<dir>] [--json]` to scan workspace stack signals, Git/test setup, rule/MCP configs, and local data/OpenAPI assets with zero disk writes and recommend the best-fit preset and optional modules.
- **Expanded Automated Regression Tests:** Added `test/v05-xray-billing.test.ts`, `test/v05-verify-review.test.ts`, and `test/v05-studio-openapi.test.ts` covering offline billing, 5h burn-rate warnings, OTLP/CSV formula-safe export, stack auto-detection, whitespace-ignored diffs, deterministic risk hints, OpenAPI security caps, and `agy-nov recommend`.

### Changed
- **Preserved 13-Module Architecture, 5 Presets & 47 Model Tools Unchanged:** All 13 toggleable native modules (12 local offline + 1 opt-in `remote`), 5 presets (`minimal` 6 / `core` 12 / `power` 32 / `local-all` 43 / `full` 47), and all 47 model tool names remain 100% backward-compatible.
- **First-Screen Conversion & 8-Language Docs Refresh:** Added a **Live Workbench Preview** (`assets/demo-preview.gif`) block and a **30-Second Read-Only First Try** quick-trial block across `README.md` and all 7 `docs/i18n/README.*.md` translations.
- **CLI, Bundle & Metadata Alignment:** Updated `package.json`, `plugin.json`, `src/server/cli.ts` (8 CLI commands), `skills/agy-nov/SKILL.md`, `README.md`, all 7 localized READMEs, `llms.txt`, and `docs/llms-install.md` to v0.5.0 (`dist/ui/app.html` ~956 KB, far below the 10 MiB limit).

### Security
- **Zero-HTML-Injection Highlighting & Zero-ReDoS Risk Hints (`review`):** Implemented syntax highlighting purely via React element tokens without `dangerouslySetInnerHTML`, and restricted line-level risk pre-annotations to linear deterministic scanning immune to catastrophic backtracking.
- **OpenAPI YAML Bomb & Prototype-Pollution Defense (`studio`):** Enforced strict caps (`2 MiB` file limit, `20,000` YAML lines, nesting depth `24`, `200` endpoints, `8 KiB` sample payload), blocked YAML anchor/alias bomb expansion and `__proto__` / `constructor` / `prototype` key pollution, and kept all auto-populated HTTP probes strictly confined to loopback targets.
- **CSV Formula Injection & Override Cap Hardening (`xray`):** Neutralized leading `=`, `+`, `-`, `@`, tab, and carriage-return cells in CSV exports and capped read-only `pricing-overrides.json` loading at `1 MiB` with zero writes.
- **Zero-Write Verification & Recommendation Invariants:** Kept `detectWorkspaceVerifyCommands`, `agy-nov recommend`, `agy-nov statusline`, and `agy-nov doctor` strictly read-only with zero disk writes, while preserving 100% Zero ASAR / Zero CDP boundaries and zero-port OFF-state isolation for `remote`.

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
- **100% Native Zero-CDP Architecture Boundary:** Established a strict official-protocol boundary for `agy-NOV` (Zero ASAR, Zero CDP, immune to Antigravity client updates), keeping host-DOM CDP customizations cleanly separated in companion repository `agy-Sag` (`https://github.com/tone-leh/agy-Sag`).
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
