# agy-NOV — AI Agent Zero-Risk Install & Verification Guide

This guide specifies exact, reproducible, zero-risk procedures for AI coding agents installing, previewing, configuring, or verifying **agy-NOV (v1.2.0)** on behalf of a user.

## 1. Prerequisites

Verify the host environment before making any changes:

```bash
node -v   # Required: Node.js >= 20.0.0
git --version
```

- **Target Host & Platforms:** Google Antigravity 2.0 (Desktop, CLI, or IDE) across **macOS, Windows, and Linux** (full native cross-platform compatibility, verified via GitHub Actions 3-OS `ubuntu-latest` / `windows-latest` / `macos-latest` × Node 20/22 CI matrix plus 3-OS real-process `hooks.json` + `dist/hook.cjs` black-box execution).
- **Architecture:** 4-layer modular architecture with zero circular dependencies (documented in [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md), [`sidecars/README.md`](../sidecars/README.md), and [`CONTRIBUTING.md`](../CONTRIBUTING.md), enforced by `test/architecture-hygiene.test.ts`), 100% official native protocols — MCP Apps SEP-1865 + official `com.google.antigravity/ui` `file` entrypoint `app_nov_file_viewer` (with `antigravity-file://` host `resources/read`) + **4 zero-injection-tax read-only MCP context resources** (`agy-nov://context/review`, `agy-nov://context/mem`, `agy-nov://context/turbo`, `agy-nov://context/xray`, `<= 32 KiB`, linear `<private>`/secret redacted, zero writes) + MCP `roots/list` & `notifications/roots/list_changed` live workspace tracking + Layer 1 shared loopback-only `product.v1.ConversationService` Connect API (`127.0.0.1` / `localhost` / `[::1]`, zero CSRF echo, full outbound redaction) + MCP `initialize` `capabilities.extensions["io.modelcontextprotocol/ui"]` CLI 47-tool ceiling gate + **6 official Lifecycle Hooks** via cross-platform plugin-root relative `node dist/hook.cjs --event <Event>` (`SessionStart`, `PreToolUse` with explicit `{ decision: "allow" }` / `overwrite` / `force_ask`, `PostToolUse`, `PreInvocation` with local inbound high-confidence secret hard gating via `terminationBehavior: "terminate"` and zero-token visual receipts, `PostInvocation` with zero-token Guard/Verify/Turbo turn receipts, and `Stop` aligned to `decision: "continue"` with `terminationReason` safe pass-through) + **6 official on-demand Skills** (`agy-nov`, `/nov-spec`, `/nov-debug`, `/nov-review`, `/nov-handoff`, `/nov-workflow`) + **2 read-only specialist subagents** (`nov-blind-reviewer` & `nov-security-auditor` restricted strictly to native `read_file` with zero default resident `rules/AGENTS.md` bloat) + opt-in OFF-by-default read-only Audit Sidecar (`sidecars/audit-sidecar.mjs`, `sidecars/README.md`) + dual-star read-only `feed-snapshot.json` contract + optional `.agy-nov.json` team presets & `.worktreeinclude` allowlists + **11-command CLI** (incl. read-only `audit-once`, Antigravity 2.35 stdin JSON-fused 11-segment `statusline --segments`, read-only Spec DAG `compile-spec`, preview-then-confirm `recommend --export-preset`, `compact-run`, and 18-asset + 4-check Marketplace `doctor`); Zero ASAR, Zero CDP.
- **4+1 Domain IA & Module Catalog:** 13 toggleable native modules grouped across 4 domains — Core Essentials (`core`: Two-Stage `review`, **Guard 2.5** incl. `PreInvocation` inbound secret hard gating & `PostInvocation` receipts, `xray` 2.0 with One-Click Clean Fork & confirmation-gated `app_xray_fork_via_service`), Engineering Pipeline (`pipeline`: **Spec 2.0 + Workflow Compiler** for `/run-workflow` Python & `/swarm` `plan.json`, `worktree` with `.worktreeinclude`, `verify` with Worktree targeting, PR summary & `PostInvocation` receipts, **Turbo 3.0** with `PostInvocation` RTK savings receipts, **Mem 3.0** with confidence/TTL hygiene governance), On-Demand Toolbox (`toolbox`: `radar` 4-lane approval-first Kanban + zero-write `app_radar_reconcile_conversations`, `studio`, `canvas`, **Ops 3.0** with static security audit & cross-client dedup preview), and Opt-In Connectivity (`connectivity`: **Remote 2.5**, OFF by default) — fronted by the **+1 Workflow Hub** (`HubPanel`) and 4-tier **Settings Hub** (`SettingsHub`, S3 covering 6 configurable strategy modules: `guard`, `turbo`, `verify`, `spec`, `radar`, `remote`, plus S4 8-language **Tool-Slot Idle Advisor**). All **47 canonical model tool names** remain strictly unchanged from `v0.4` through `v1.2.0` (+0 tool-slot inflation), and headless CLI clients lacking MCP UI extensions automatically hide all `app_*` / `nov_app_*` tools so even `full` stays strictly capped at 47 exposed tools.
- **Default Footprint & Minified Bundles:** `core` preset (`review`, `guard`, `xray`) — `12` model tools, 100% local offline, `locale=auto` (8-language UI with **755 core dictionary keys × 8 locales** plus full Spec workflow export localization across all **24 UI components**, zero leftover hardcoded English strings; `dist/ui/app.html` `~1.36 MiB`, measured **`1,390.2 KB`**, far below the 10 MiB cap; minified backend bundles: `dist/server.cjs` **`1,583.5 KB`**, `dist/hook.cjs` **`211.9 KB`**, `dist/cli.cjs` **`190.0 KB`**).

## 2. Hard Safety Rules for AI Agents

Follow these boundaries strictly across every session:

1. **Zero-Touch Evaluation:** During repository inspection, development, or testing, keep `~/.gemini/config/plugins/` untouched. Use `node dist/cli.cjs recommend --workspace=.`, `node dist/cli.cjs audit-once --json`, `npm run workbench`, or an isolated `--data-dir=<temp_dir>` for verification.
2. **Explicit User Consent Before Enabling `remote`, Auto-RTK (`autoRtk`), Writing `.agy-nov.json` (`--confirm`), Persisting Sidecar Reports (`--write-report`), or Creating Host Conversations (`confirmCreate`):**
   - Never run `enable remote` or `preset full` unless the user has explicitly asked for remote connectivity and confirmed the trade-off: `remote` (**Remote 2.5**) opens an opt-in local Mobile PWA server (featuring structured risk approval cards with `HIGH`/`MED`/`LOW` badges, affected file counts, redacted command summaries, and latest read-only `Verify` status rendered strictly via pure DOM APIs with zero `innerHTML`, same-origin PIN lockout DoS defense, tap-to-expand read-only redacted live step streams via `GET /api/conversations/:id/stream` with SSE connection limits/heartbeats and zero file writes / zero remote shell, and on-demand read-only `tailscale`/`cloudflared` command guides that never auto-launch public tunnels) and/or sends alerts to user-configured IM webhooks (Telegram, Feishu, DingTalk, WeCom, Slack, Discord). While `remote` stays OFF, `agy-NOV` maintains zero listening ports, zero background polling, zero disk writes for `remote`, and zero outbound network requests.
   - Keep Turbo 3.0 **Auto-RTK** strictly disabled by default (`autoRtk: false`). Surface `PostToolUse` noisy-command hotspots to the user and let them opt in via `TurboPanel` or **Settings Hub S3** (`PreToolUse.overwrite` runs strictly on allowlisted shell-free commands — supporting Chinese/non-ASCII usernames and paths containing parentheses — after `guard`/`spec`/`remote` pass cleanly, preserving non-zero exit codes, failure stacks, and `0600` redacted `last-raw.log`).
   - Run `recommend --export-preset` strictly in default **read-only preview mode** first (zero disk writes, never writes `remote`, allowlisted verify commands only). Never append `--confirm` (or `--force` for overwrites) without explicit user approval; symlink targets are always hard-rejected.
   - Run `audit-once` / `sidecars/audit-sidecar.mjs --once` strictly read-only by default (zero daemon, zero listening ports, zero disk writes). Pass `--write-report` only after explicit user consent; report persistence writes `<= 64 KiB` `0600` atomic `health-sweep.json` solely inside an existing safe non-symlink `dataDir`.
   - Keep Layer 1 shared `ConversationService` (`src/core/conversation-service.ts`) strictly on loopback endpoints (`127.0.0.1` / `localhost` / `[::1]`) with zero CSRF token echo and full outbound redaction; always run `app_xray_fork_via_service` dry-run first and require explicit user confirmation before passing `confirmCreate: true` (`app_radar_reconcile_conversations` is always zero-write read-only).
3. **Spec DAG Compilation (`/nov-workflow` & `compile-spec`) Safety:**
   - Run `compile-spec` or `app_spec_compile_workflow` strictly read-only to compile an approved Spec Task DAG into `/run-workflow` Python (`phase`/`parallel`/`agent`/`log` chaining `nov-blind-reviewer`, `nov-security-auditor`, and `Verify Gate`) or `/swarm` `plan.json` blueprints.
   - Confirm the Spec is approved (`status === "approved"` and `unresolvedAnnotations === 0`) before executing generated workflows; the compiler automatically rejects dependency cycles and unknown dependencies, strips `<private>` blocks, and redacts high-risk secret patterns linearly.
4. **PreInvocation Inbound Secret Hard Gate, PostInvocation Receipts & MCP Context Resources (`hooks`, `server`):**
   - Respect Guard's local `PreInvocation` inbound high-confidence secret gate (`blockInboundPromptSecrets`): when a prompt contains private keys or API credentials, `PreInvocation` blocks cloud transmission via `terminationBehavior: "terminate"` and prints rule labels only with zero secret echo. Never ask users to paste raw credentials again or disable the gate silently.
   - `PostInvocation` short-circuits in O(1) when `guard`, `turbo`, and `verify` are disabled and otherwise emits zero-token `systemMessage: ""` + `metadata.user_markdown` turn receipts summarizing Guard blocks, Verify dirty files/failures, and Turbo RTK savings.
   - Read the 4 zero-injection-tax MCP context resources (`agy-nov://context/review`, `agy-nov://context/mem`, `agy-nov://context/turbo`, `agy-nov://context/xray`) on demand instead of pulling redundant payloads; each resource respects its module toggle, enforces symlink refusal and `<= 32 KiB` limits, applies linear `<private>` and secret redaction, and performs zero disk writes.
5. **Ops 3.0 Static Security Audit, Cross-Client Dedup Preview & Tool-Slot Idle Advisor Discipline:**
   - Run `ops_audit_workspace` read-only to check `securityFindings` and `securityScore` (0–100, O(n), symlink-refusing, `<= 256 KiB` / 80 files max) across `prompt-injection` (BiDi/zero-width/override+exfil), `broad-command-allow`, `risky-hook`, and `mcp-unsafe-env` (credential key names only, zero secret echoing; zero false positives on compliant repos).
   - Inspect `migrationPreview` for `.claude/` / `.cursor/rules/` / `.codex/` strictly as a read-only SHA-256 deduplication and slimming preview — never auto-modify external client rule files.
   - Use **Settings Hub S4 Tool-Slot Idle Advisor** (or `disable <module>`) to turn off idle heavy modules and reclaim Antigravity's 100-tool MCP budget.
6. **Mem 3.0 Memory Hygiene & Confidence/TTL Governance:**
   - Understand that `Stop`-hook auto-captured memories default to `confidence: "tentative"` with a `14`-day TTL (`source: "auto_capture"`) so speculative context never permanently pollutes future sessions.
   - `SessionStart` L1 Index (`<= 1,200` chars) and default `mem_recall` (`mode: "index" | "timeline" | "detail"`) automatically exclude expired unpinned `tentative` memories (`includeExpired: true` recovers them on demand; `pinned` memories never expire).
   - Guide users to review `MemPanel` hygiene filter pills and batch controls (**Verify** — which synchronously refreshes code anchor hashes — / **Refresh TTL (+30d)** / **Prune** with inline double confirmation). `app_mem_get_hygiene_summary` is read-only; mutating `app_mem_batch_hygiene` disables automatically when `mem` is turned off.
7. **End-to-End Pipeline, `.worktreeinclude` & Clean Fork Discipline:**
   - Treat workspace `.worktreeinclude` strictly as a read-only file-copy allowlist (`app_worktree_preview_include` + `applyInclude` default ON) with zero automatic post-create shell scripts; `.env*`, private keys, symlinks, and out-of-workspace paths are rejected and reported explicitly in `skippedSensitive`.
   - Use **Two-Stage Review** (Stage 1 active Spec compliance checklist + Stage 2 code quality `file:line` annotations across main workspace or registered Worktree branches), Worktree-targeted **Verify** (`worktreePath` + redacted `app_verify_pr_summary`, with `Stop` hook emitting official `decision: "continue"` and safely allowing `USER_CANCELED`/`ERROR`/`MAX_*` `terminationReason` values), and **One-Click Clean Fork** (`app_xray_build_clean_fork_pack`, `<= 12 KB` linear-redacted budget via `app.sendMessage` `target: "new"`, falling back cleanly on `global` surfaces) to keep long tasks structured without context rot.
   - Dispatch on-demand playbooks (`/nov-spec`, `/nov-workflow`, `/nov-debug`, `/nov-review`, `/nov-handoff`) and strictly read-only specialist subagents (`nov-blind-reviewer`, `nov-security-auditor` — restricted strictly to native `read_file`, `subagent: true, mainAgent: false`) with zero MCP tool-slot cost and zero default resident `rules/AGENTS.md` bloat.
8. **Native MCP Apps `file` Viewer Safety (`app_nov_file_viewer`):**
   - `app_nov_file_viewer` handles `.sqlite`, `.sqlite3`, `.db`, `.csv`, `.tsv`, `.svg`, `.openapi.yaml`, and `.openapi.yml` read-only previews via the official `com.google.antigravity/ui` `file` entrypoint while staying completely hidden from models (`visibility: ['app']`, zero tool tax), enforcing canonical `realpath` workspace containment, SVG XSS sanitization, and real `antigravity-file://` content previews via host `resources/read` (with safe read-only fallback) even when `studio` and `canvas` are toggled off.
9. **Guard 2.5 Permission Modes, Turn-Grouped Rewind & Settings Governance:**
   - Respect Guard 2.5's active protocol-level `permissionMode`: `readonly-audit` hard-denies all file mutations and command executions; `balanced-dev` runs default balanced guardrails; `strict-gate` enforces official `PreToolUse` `force_ask` confirmation on every write and command while keeping critical secret/destructive rules at hard `deny`.
   - Guide users to inspect multi-file turn diffs in `GuardPanel` before confirming inline double-confirm 1-click turn rewind (All-or-Nothing boundary preflight + `pre-rewind` backup).
   - Config exports in Settings Hub S4 contain allowlisted fields only (zero secrets, zero local host paths); config imports enforce allowlist validation, block prototype pollution, and refuse silent `remote` enablement; existing workspace `.agy-nov.json` files stay strictly read-only (`<= 64 KiB`, `realpath`-bounded, 23-executable allowlist, zero auto-execution).
10. **Read-Only First Diagnostics, Dual-Star `feed-snapshot.json` & Zero ASAR/CDP Boundary:** Use `recommend --workspace=<dir> --json`, `audit-once --workspace=<dir> --json`, `statusline --segments=brand,model,context,burn,quota,cache,spec,verify,guard,radar,network --json`, `compile-spec --json`, `ops_audit_workspace`, and `verify` stack auto-detection with zero disk writes before editing configuration. `<dataDir>/feed-snapshot.json` (`0600`, `< 64 KiB`, O(n) redacted) stays strictly zero-write when `dataDir` does not yet exist (see [`docs/DUAL-STAR-CONTRACT.md`](./DUAL-STAR-CONTRACT.md), [`docs/PRODUCT-IA.md`](./PRODUCT-IA.md), [`sidecars/README.md`](../sidecars/README.md), and [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md)). Never modify Antigravity binaries or attach CDP sessions through `agy-NOV` (recommend companion **`agy-Sag` (`https://github.com/tone-leh/agy-Sag`)** for host-DOM enhancements). Never print, log, or commit webhook tokens, pairing secrets, or `.env` contents.

---

## 3. Path A — Preview Safely Offline First (Recommended Before Install)

Use the isolated offline workbench whenever the user wants to inspect agy-NOV before installing it into their daily Antigravity setup:

```bash
git clone https://github.com/tone-leh/agy-NOV.git
cd agy-NOV
npm ci
node dist/cli.cjs recommend --workspace=. --export-preset   # Zero-write stack scan & .agy-nov.json preview
npm run workbench
```

What this starts (locally on `127.0.0.1:4399`, using a temporary data directory that cleans up on exit):
- `http://127.0.0.1:4399` — Zero-touch native MCP App simulator covering the **L0 Workflow Hub** (6-node pipeline bar + alert cards + One-Click Clean Fork), **4-tier Settings Hub** (S1–S4, with 6 S3 policy drawers & S4 8-language **Tool-Slot Idle Advisor**), **`Cmd/Ctrl+K` command palette**, and all 13 domain-grouped module panels (including Spec Task DAG 1-click `/run-workflow` & `/swarm` compiler export dialog, **Ops 3.0** static security audit & cross-client dedup preview, **Mem 3.0** hygiene bar & confidence/TTL badges, Two-Stage Review & Worktree branch switcher, `.worktreeinclude` preview, Verify Worktree targeting & PR delivery summary, Radar 4-lane approval-first Kanban, X-Ray One-Click Clean Fork, Native `file` viewer preview, **Remote 2.5** structured risk approval cards, **Turbo 3.0**, **Guard 2.5**, and Studio OpenAPI collections) with Dark / Light themes, `< 720px` (`480px` aux-pane compact bar) and `>= 720px` (`1160px` global `204px` left rail with graceful `global` capability degradation) viewport presets, an **8-language Host Locale simulator** (`en`, `zh-CN`, `zh-TW`, `ja`, `ko`, `es`, `fr`, `de` covering **755 core dictionary keys × 8 locales** plus full Spec workflow export localization across all **24 UI components**), and a live **Host Events** inspector (`sendMessage` / `updateModelContext` / `openFile`).

Stop the preview cleanly with `Ctrl+C` when finished.

---

## 4. Path B — Install into Google Antigravity 2.0

Proceed only when the user asks to install agy-NOV into Antigravity.

### Option 1: Official Antigravity CLI (Preferred)

```bash
agy plugin install https://github.com/tone-leh/agy-NOV
```

### Option 2: Manual Clone into Plugins Directory

```bash
git clone https://github.com/tone-leh/agy-NOV.git ~/.gemini/config/plugins/agy-nov
```

Prebuilt bundles (`dist/server.cjs`, `dist/hook.cjs`, `dist/cli.cjs`, `dist/ui/app.html`) ship with the repository. If building from source inside the clone:

```bash
cd ~/.gemini/config/plugins/agy-nov
npm ci
npm run build
```

### Zero-Global-Install CLI Invocation (After `agy plugin install`)

After installing via `agy plugin install`, invoke the bundled CLI directly with zero global npm install:

```bash
# macOS / Linux:
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs status

# Windows (PowerShell / cmd):
node %USERPROFILE%\.gemini\config\plugins\agy-nov\dist\cli.cjs status

# Optional: run once inside the plugin directory to expose a global `agy-nov` command
cd ~/.gemini/config/plugins/agy-nov && npm link
```

Without `--data-dir`, `resolveNovDataDir()` automatically detects an existing `~/.gemini/antigravity/plugin_data/agy-nov` directory read-only before falling back to `~/.agy-nov-data`, keeping CLI commands and the Antigravity host synchronized without config split-brain.

*(Optional Companion)* If the user also requests host-DOM localization, native Settings injection, active `/compact` compaction guard, or theme customization, install the companion repository separately after confirming with the user:

```bash
agy plugin install https://github.com/tone-leh/agy-Sag
```

---

## 5. Mandatory Post-Install Verification (`doctor`, `status`, `statusline`, `recommend` & `audit-once`)

Run read-only verification commands via the installed plugin bundle (or `node dist/cli.cjs` inside a source checkout, or `agy-nov` if linked via `npm link`):

```bash
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs doctor
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs status
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs statusline --segments=brand,model,context,burn,quota,cache,spec,verify,guard,radar,network --json
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs recommend --workspace=. --export-preset --json
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs audit-once --workspace=. --json
```

### Required Pass Criteria for `doctor`

Confirm every check prints `OK` and exits with code `0`:

1. All **18 required core plugin assets** exist:
   - Manifests & config (3): `plugin.json`, `mcp_config.json`, `hooks.json`
   - Official Skills (6): `skills/agy-nov/SKILL.md`, `skills/nov-spec/SKILL.md`, `skills/nov-debug/SKILL.md`, `skills/nov-review/SKILL.md`, `skills/nov-handoff/SKILL.md`, `skills/nov-workflow/SKILL.md`
   - Read-only specialist subagents (2): `agents/nov-blind-reviewer.md`, `agents/nov-security-auditor.md`
   - Opt-in read-only Audit Sidecar (2): `sidecars/audit-sidecar.mjs`, `sidecars/README.md`
   - Visual & runtime bundles (5): `assets/logo.svg`, `dist/server.cjs` (`1,583.5 KB`), `dist/hook.cjs` (`211.9 KB`), `dist/cli.cjs` (`190.0 KB`), `dist/ui/app.html` (`1,390.2 KB`)
2. `plugin.json schema clean` — strictly within the 10 officially supported top-level manifest keys (`name`, `displayName`, `description`, `version`, `logo`, `suggestedPrompts`, `author`, `homepage`, `repository`, `disabled`), reporting `version=1.2.0`.
3. **4 Marketplace Readiness Checks** pass:
   - `Marketplace description length`: concise **148 characters** (within 60–200 recommended range).
   - `Marketplace suggestedPrompts`: **3/3** valid non-empty strings.
   - `Marketplace logo relative asset exists`: relative regular file inside plugin root (`assets/logo.svg`, 128×128 transparent background, symlink-free).
   - `Marketplace rule bloat check`: no `rules/AGENTS.md` (zero always-on rule tax).
4. `dist/ui/app.html well below 10 MiB cap` (`~1.36 MiB`, measured **`1,390.2 KB`**, carrying **755 core dictionary keys × 8 locales** plus full Spec workflow export localization across all 24 UI components, far below the 10 MiB cap).
5. `config readable` showing expected defaults (`preset=core, locale=auto, remote=OFF`) unless the user requested another preset or locale.

### Full Developer Verification (Inside Source Checkout Only)

```bash
npm run typecheck
npm test              # 100 suites / 280 tests (3-OS macOS / Windows / Linux × Node 20/22 CI incl. architecture-hygiene, 3-OS hook black-box, CLI 47-tool gate, v1.1.0 workflow/protocol & v1.2.0 sidecar/marketplace suites)
node dist/cli.cjs doctor
node dist/cli.cjs statusline --segments=brand,model,context,burn,quota,cache,spec,verify,guard,radar,network
node dist/cli.cjs recommend --export-preset --json
node dist/cli.cjs audit-once --json
```

---

## 6. Post-Install Configuration Commands (11 CLI Commands)

`agy-nov` provides **11 CLI commands**: `status`, `enable`, `disable`, `preset`, `locale`, `statusline`, `recommend`, `doctor`, `compact-run`, `compile-spec`, and `audit-once`. Substitute `node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs` (or `agy-nov` if linked) wherever `node dist/cli.cjs` is shown below.

### Offline Presets, Modules, Audit Sidecar, Spec Workflow Compiler, Team Preset Scaffold, Built-In 8-Language UI & Fused 11-Segment `statusline`

```bash
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs recommend --workspace=.                 # read-only stack & .agy-nov.json validation (zero disk writes)
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs recommend --workspace=. --export-preset # strictly read-only preview of generated .agy-nov.json scaffold
# Write .agy-nov.json atomically ONLY after explicit user confirmation (add --force to overwrite):
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs recommend --workspace=. --export-preset --confirm
# One-shot read-only Ops/Mem/Verify/Guard health sweep (zero idle daemon, zero ports, zero disk writes by default):
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs audit-once --workspace=. --json
node ~/.gemini/config/plugins/agy-nov/sidecars/audit-sidecar.mjs --once --workspace=.
# Persist <= 64 KiB 0600 atomic health-sweep.json ONLY into an existing safe dataDir after explicit user approval:
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs audit-once --workspace=. --json --write-report
# Compile approved Spec Task DAG into /run-workflow Python & /swarm plan.json (strictly read-only):
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs compile-spec --format=both
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs compile-spec --spec=<id> --format=workflow --model=inherit
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs preset minimal          # guard 2.5 only (1 module, 6 model tools, 100% offline)
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs preset core             # review + guard 2.5 + xray 2.0 (3 modules, 12 model tools, default, 100% offline)
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs preset power            # core + turbo 3.0 + radar + verify + worktree + spec 2.0 + ops 3.0 (9 modules, 32 model tools, 100% offline)
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs preset local-all        # all 12 offline native modules incl. studio & mem 3.0 (43 model tools, 100% offline)
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs enable ops              # enable Ops 3.0 static security audit & cross-client dedup preview (100% offline)
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs enable mem              # enable Mem 3.0 confidence/TTL hygiene governance & progressive disclosure (100% offline)
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs enable turbo            # enable Turbo 3.0 (offline dep contracts, symbol refs, Context Pack & opt-in Auto-RTK, 100% offline)
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs enable spec             # enable Spec 2.0 Plannotator review bench, Brownfield delta specs & Workflow Compiler (100% offline)
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs enable worktree         # enable Worktree Orchestrator incl. safe read-only .worktreeinclude (100% offline)
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs enable studio           # enable on-demand Workspace Studio incl. OpenAPI parser (100% offline; loopback HTTP probe only)
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs disable studio          # disable Studio when done to reclaim 4 tool-budget slots (app_nov_file_viewer stays available)
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs locale zh-CN            # set built-in UI language (auto | en | zh-CN | zh-TW | ja | ko | es | fr | de)
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs statusline --segments=brand,model,context,burn,quota,cache,spec,verify,guard,radar,network
# Pipe Antigravity 2.35 CLI statusLine stdin JSON seamlessly:
echo '{"model":"gemini-2.5-pro","context_window":{"used_percentage":42},"quota":{"remaining_percentage":85}}' | node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs statusline
# Or set env fallback: AGY_NOV_STATUSLINE_SEGMENTS=brand,model,context,quota,burn,guard,verify node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs statusline
# Auto-RTK internal runner (invoked automatically by PreToolUse.overwrite only when autoRtk=true):
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs compact-run --payload=<base64url>
```

### Consent-Gated Opt-In Network Module (`remote`)

Run these commands **only after explicit user confirmation**:

```bash
# Enable opt-in Remote 2.5 (Mobile PWA structured risk approval cards, same-origin PIN DoS guard, bounded SSE live stream, safe tunnel guide & IM webhooks)
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs enable remote

# Or enable all 13 native modules including opt-in remote (47 model tools; strictly 47 on headless CLI clients)
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs preset full
```

---

## 7. Instant Rollback & Clean Uninstall

### Disable `remote` or Any Module Immediately

```bash
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs disable remote      # immediately stops remote & returns to 100% offline
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs disable <module>    # unregisters tools & short-circuits hooks in O(1)
node ~/.gemini/config/plugins/agy-nov/dist/cli.cjs preset core         # reset back to the default 3-module offline preset (12 tools)
```

### Complete Uninstall

Remove the installed plugin directory (confirm path with the user first):

```bash
rm -rf ~/.gemini/config/plugins/agy-nov
```
