# agy-NOV — AI Agent Zero-Risk Install & Verification Guide

This guide specifies exact, reproducible, zero-risk procedures for AI coding agents installing, previewing, configuring, or verifying **agy-NOV (v1.0.1)** on behalf of a user.

## 1. Prerequisites

Verify the host environment before making any changes:

```bash
node -v   # Required: Node.js >= 20.0.0
git --version
```

- **Target Host & Platforms:** Google Antigravity 2.0 (Desktop, CLI, or IDE) across **macOS, Windows, and Linux** (full native cross-platform compatibility, verified via GitHub Actions 3-OS `ubuntu-latest` / `windows-latest` / `macos-latest` × Node 20/22 CI matrix).
- **Architecture:** 100% official native protocols (MCP Apps SEP-1865 + official `com.google.antigravity/ui` `file` entrypoint `app_nov_file_viewer` + **5 official Lifecycle Hooks** incl. zero-token `PreInvocation` visual receipts, `PreToolUse.overwrite` & `force_ask` + **5 official on-demand Skills** `agy-nov` / `/nov-spec` / `/nov-debug` / `/nov-review` / `/nov-handoff` + **2 read-only specialist subagents** `nov-blind-reviewer` & `nov-security-auditor` with zero default resident `rules/AGENTS.md` bloat + dual-star read-only `feed-snapshot.json` contract + optional `.agy-nov.json` team presets & `.worktreeinclude` allowlists + **9-command CLI** incl. customizable 9-segment `statusline --segments`, preview-then-confirm `recommend --export-preset`, `compact-run` & 15-asset `doctor`; Zero ASAR, Zero CDP).
- **4+1 Domain IA & Module Catalog:** 13 toggleable native modules grouped across 4 domains — Core Essentials (`core`: Two-Stage `review`, **Guard 2.5**, `xray` 2.0 with One-Click Clean Fork), Engineering Pipeline (`pipeline`: **Spec 2.0**, `worktree` with `.worktreeinclude`, `verify` with Worktree targeting & PR summary, **Turbo 3.0**, **Mem 3.0** with confidence/TTL hygiene governance), On-Demand Toolbox (`toolbox`: `radar` 4-lane approval-first Kanban, `studio`, `canvas`, **Ops 3.0** with static security audit & cross-client dedup preview), and Opt-In Connectivity (`connectivity`: **Remote 2.5**, OFF by default) — fronted by the **+1 Workflow Hub** (`HubPanel`) and 4-tier **Settings Hub** (`SettingsHub`, S3 covering 6 configurable strategy modules: `guard`, `turbo`, `verify`, `spec`, `radar`, `remote`, plus S4 8-language **Tool-Slot Idle Advisor**). All **47 canonical model tool names** remain strictly unchanged from `v0.4` through `v1.0.1` (+0 tool-slot inflation).
- **Default Footprint:** `core` preset (`review`, `guard`, `xray`) — `12` model tools, 100% local offline, `locale=auto` (full 8-language UI covering all **24 UI components**, `dist/ui/app.html` `~1.23 MiB`, measured `1,261.2 KB`, well below the 1.5 MiB target and 10 MiB cap).

## 2. Hard Safety Rules for AI Agents

Follow these boundaries strictly across every session:

1. **Zero-Touch Evaluation:** During repository inspection, development, or testing, keep `~/.gemini/config/plugins/` untouched. Use `node dist/cli.cjs recommend --workspace=.`, `npm run workbench`, or an isolated `--data-dir=<temp_dir>` for verification.
2. **Explicit User Consent Before Enabling `remote`, Auto-RTK (`autoRtk`), or Writing `.agy-nov.json` (`--confirm`):**
   - Never run `enable remote` or `preset full` unless the user has explicitly asked for remote connectivity and confirmed the trade-off: `remote` (**Remote 2.5**) opens an opt-in local Mobile PWA server (featuring structured risk approval cards with `HIGH`/`MED`/`LOW` badges, affected file counts, redacted command summaries, and latest read-only `Verify` status rendered strictly via pure DOM APIs with zero `innerHTML`, plus tap-to-expand read-only redacted live step streams via `GET /api/conversations/:id/stream` with zero file writes / zero remote shell, and on-demand read-only `tailscale`/`cloudflared` command guides that never auto-launch public tunnels) and/or sends alerts to user-configured IM webhooks (Telegram, Feishu, DingTalk, WeCom, Slack, Discord). While `remote` stays OFF, `agy-NOV` maintains zero listening ports, zero background polling, zero disk writes for `remote`, and zero outbound network requests.
   - Keep Turbo 3.0 **Auto-RTK** strictly disabled by default (`autoRtk: false`). Surface `PostToolUse` noisy-command hotspots to the user and let them opt in via `TurboPanel` or **Settings Hub S3** (`PreToolUse.overwrite` runs strictly on allowlisted shell-free commands after `guard`/`spec`/`remote` pass cleanly, preserving non-zero exit codes, failure stacks, and `0600` redacted `last-raw.log`).
   - Run `agy-nov recommend --export-preset` strictly in default **read-only preview mode** first (zero disk writes, never writes `remote`, allowlisted verify commands only). Never append `--confirm` (or `--force` for overwrites) without explicit user approval; symlink targets are always hard-rejected.
3. **Ops 3.0 Static Security Audit, Cross-Client Dedup Preview & Tool-Slot Idle Advisor Discipline:**
   - Run `ops_audit_workspace` read-only to check `securityFindings` and `securityScore` (0–100, O(n), symlink-refusing, `<= 256 KiB` / 80 files max) across `prompt-injection` (BiDi/zero-width/override+exfil), `broad-command-allow`, `risky-hook`, and `mcp-unsafe-env` (credential key names only, zero secret echoing; zero false positives on compliant repos).
   - Inspect `migrationPreview` for `.claude/` / `.cursor/rules/` / `.codex/` strictly as a read-only SHA-256 deduplication and slimming preview — never auto-modify external client rule files.
   - Use **Settings Hub S4 Tool-Slot Idle Advisor** (or `disable <module>`) to turn off idle heavy modules and reclaim Antigravity's 100-tool MCP budget.
4. **Mem 3.0 Memory Hygiene & Confidence/TTL Governance:**
   - Understand that `Stop`-hook auto-captured memories default to `confidence: "tentative"` with a `14`-day TTL (`source: "auto_capture"`) so speculative context never permanently pollutes future sessions.
   - `SessionStart` L1 Index (`<= 1,200` chars) and default `mem_recall` (`mode: "index" | "timeline" | "detail"`) automatically exclude expired unpinned `tentative` memories (`includeExpired: true` recovers them on demand; `pinned` memories never expire).
   - Guide users to review `MemPanel` hygiene filter pills and batch controls (**Verify / Refresh TTL (+30d) / Prune** with inline double confirmation). `app_mem_get_hygiene_summary` is read-only; mutating `app_mem_batch_hygiene` disables automatically when `mem` is turned off.
5. **End-to-End Pipeline, `.worktreeinclude` & Clean Fork Discipline:**
   - Treat workspace `.worktreeinclude` strictly as a read-only file-copy allowlist (`app_worktree_preview_include` + `applyInclude` default ON) with zero automatic post-create shell scripts; `.env*`, private keys, symlinks, and out-of-workspace paths are rejected and reported explicitly in `skippedSensitive`.
   - Use **Two-Stage Review** (Stage 1 active Spec compliance checklist + Stage 2 code quality `file:line` annotations across main workspace or registered Worktree branches), Worktree-targeted **Verify** (`worktreePath` + redacted `app_verify_pr_summary`), and **One-Click Clean Fork** (`app_xray_build_clean_fork_pack`, `<= 12 KB` linear-redacted budget via `app.sendMessage` `target: "new"`, falling back cleanly on `global` surfaces) to keep long tasks structured without context rot.
   - Dispatch on-demand playbooks (`/nov-spec`, `/nov-debug`, `/nov-review`, `/nov-handoff`) and strictly read-only specialist subagents (`nov-blind-reviewer`, `nov-security-auditor` — restricted to `read_file`, `grep_search`, `find_by_name`, `list_dir`, `subagent: true, mainAgent: false`) with zero MCP tool-slot cost and zero default resident `rules/AGENTS.md` bloat.
6. **Native MCP Apps `file` Viewer Safety (`app_nov_file_viewer`):**
   - `app_nov_file_viewer` handles `.sqlite`, `.sqlite3`, `.db`, `.csv`, `.tsv`, `.svg`, `.openapi.yaml`, and `.openapi.yml` read-only previews via the official `com.google.antigravity/ui` `file` entrypoint while staying completely hidden from models (`visibility: ['app']`, zero tool tax), enforcing canonical `realpath` workspace containment, SVG XSS sanitization, and safe fallback for opaque `antigravity-file://` URIs even when `studio` and `canvas` are toggled off.
7. **Guard 2.5 Permission Modes & Turn-Grouped Rewind Discipline:**
   - Respect Guard 2.5's active protocol-level `permissionMode`: `readonly-audit` hard-denies all file mutations and command executions; `balanced-dev` runs default balanced guardrails; `strict-gate` enforces official `PreToolUse` `force_ask` confirmation on every write and command while keeping critical secret/destructive rules at hard `deny`.
   - When an edit turn needs rollback, guide the user to inspect the multi-file turn diff in `GuardPanel` and confirm the inline double-confirm 1-click turn rewind (reverting multi-edit files back to before their first edit in that turn with All-or-Nothing boundary preflight and `pre-rewind` backup).
8. **Settings Hub Governance & Single-File `.agy-nov.json` Team Preset Discipline:**
   - Config exports in Settings Hub S4 contain allowlisted fields only (zero secrets, zero local host paths); config imports enforce allowlist validation, block prototype pollution, and refuse silent `remote` enablement; resetting defaults requires explicit inline double confirmation.
   - Treat existing workspace `.agy-nov.json` files as strictly read-only (`<= 64 KiB`, `realpath`-bounded, prototype-pollution-safe). Never auto-create clutter directories inside user repositories, never auto-execute `verifyCommands` entries from `.agy-nov.json` (only statically validated against the 23-executable allowlist), and never allow a team preset to silently enable `remote`.
9. **Offline Modules & Spec 2.0 Human-Approval Integrity (`turbo`, `spec`, `studio`, `verify`, `worktree`):** All 12 Tier-1 modules run 100% locally offline with zero external network traffic. Leverage **Turbo 3.0**'s offline locked dependency contracts (`turbo_read_outline` `depPackage`), O(n) cross-file symbol references (`turbo_batch_search` `mode: "references"`), redacted Context Pack (`app_turbo_build_context_pack`), and in-memory `gain` telemetry (`app_turbo_get_gain`). When `spec` has `requireUiApproval` enabled, `spec_approve` rejects model-side calls — prompt the user to inspect the `full` or Brownfield `delta` spec in the Spec 2.0 Plannotator review bench and approve in UI before editing files.
10. **Read-Only First Diagnostics, Zero-Token `PreInvocation`, Dual-Star `feed-snapshot.json` & Zero ASAR/CDP Boundary:** Use `node dist/cli.cjs recommend --workspace=<dir> --json`, `node dist/cli.cjs statusline --segments=brand,context,burn,cache,spec,verify,guard,radar,network --json`, `ops_audit_workspace`, and `verify` stack auto-detection with zero disk writes before editing configuration. `PreInvocation` emits non-blocking zero-token visual receipts (`systemMessage: ""` + `metadata.user_markdown`) with O(1) short-circuiting; `<dataDir>/feed-snapshot.json` (`0600`, `< 64 KiB`, O(n) redacted) stays strictly zero-write when `dataDir` does not yet exist (see [`docs/DUAL-STAR-CONTRACT.md`](./DUAL-STAR-CONTRACT.md) and [`docs/PRODUCT-IA.md`](./PRODUCT-IA.md)). Never modify Antigravity binaries or attach CDP sessions through `agy-NOV` (recommend companion **`agy-Sag` (`https://github.com/tone-leh/agy-Sag`)** for host-DOM enhancements). Never print, log, or commit webhook tokens, pairing secrets, or `.env` contents.

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
- `http://127.0.0.1:4399` — Zero-touch native MCP App simulator covering the **L0 Workflow Hub** (6-node pipeline bar + alert cards + One-Click Clean Fork), **4-tier Settings Hub** (S1–S4, with 6 S3 policy drawers & S4 8-language **Tool-Slot Idle Advisor**), **`Cmd/Ctrl+K` command palette**, and all 13 domain-grouped module panels (including **Ops 3.0** static security audit & cross-client dedup preview, **Mem 3.0** hygiene bar & confidence/TTL badges, Two-Stage Review & Worktree branch switcher, `.worktreeinclude` preview, Verify Worktree targeting & PR delivery summary, Radar 4-lane approval-first Kanban, X-Ray One-Click Clean Fork, Native `file` viewer preview, **Remote 2.5** structured risk approval cards, **Turbo 3.0**, **Guard 2.5**, **Spec 2.0**, and Studio OpenAPI collections) with Dark / Light themes, `< 720px` (`480px` aux-pane compact bar) and `>= 720px` (`1160px` global `204px` left rail) viewport presets, an **8-language Host Locale simulator** (`en`, `zh-CN`, `zh-TW`, `ja`, `ko`, `es`, `fr`, `de` covering all **24 UI components**), and a live **Host Events** inspector (`sendMessage` / `updateModelContext` / `openFile`).

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

*(Optional Companion)* If the user also requests host-DOM localization, native Settings injection, active `/compact` compaction guard, or theme customization, install the companion repository separately after confirming with the user:

```bash
agy plugin install https://github.com/tone-leh/agy-Sag
```

---

## 5. Mandatory Post-Install Verification (`doctor`, `status`, `statusline` & `recommend`)

Run read-only verification commands inside the plugin directory (or using `agy-nov` if linked on `PATH`):

```bash
node dist/cli.cjs doctor
node dist/cli.cjs status
node dist/cli.cjs statusline --segments=brand,context,burn,cache,spec,verify,guard,radar,network --json
node dist/cli.cjs recommend --workspace=. --export-preset --json
```

### Required Pass Criteria for `node dist/cli.cjs doctor`

Confirm every check prints `OK` and exits with code `0`:

1. All **15 required core plugin assets** exist:
   - Manifests & config (3): `plugin.json`, `mcp_config.json`, `hooks.json`
   - Official Skills (5): `skills/agy-nov/SKILL.md`, `skills/nov-spec/SKILL.md`, `skills/nov-debug/SKILL.md`, `skills/nov-review/SKILL.md`, `skills/nov-handoff/SKILL.md`
   - Read-only specialist subagents (2): `agents/nov-blind-reviewer.md`, `agents/nov-security-auditor.md`
   - Visual & runtime bundles (5): `assets/logo.svg`, `dist/server.cjs`, `dist/hook.cjs`, `dist/cli.cjs`, `dist/ui/app.html`
2. `plugin.json schema clean` — strictly within the 10 officially supported top-level manifest keys (`name`, `displayName`, `description`, `version`, `logo`, `suggestedPrompts`, `author`, `homepage`, `repository`, `disabled`), reporting `version=1.0.1`.
3. `dist/ui/app.html well below 10 MiB cap` (`~1.23 MiB`, measured `1,261.2 KB`, well below the 1.5 MiB target and 10 MiB cap).
4. `config readable` showing expected defaults (`preset=core, locale=auto, remote=OFF`) unless the user requested another preset or locale.

### Full Developer Verification (Inside Source Checkout Only)

```bash
npm run typecheck
npm test              # 88 suites / 245 tests (cross-platform macOS / Windows / Linux × Node 20/22 CI)
node dist/cli.cjs doctor
node dist/cli.cjs statusline --segments=brand,context,burn,cache,spec,verify,guard,radar,network
node dist/cli.cjs recommend --export-preset --json
```

---

## 6. Post-Install Configuration Commands (9 CLI Commands)

`agy-nov` provides **9 CLI commands**: `status`, `enable`, `disable`, `preset`, `locale`, `statusline`, `recommend`, `doctor`, and `compact-run`.

### Offline Presets, Modules, Team Preset Scaffold, Built-In 8-Language UI & Customizable `statusline`

```bash
node dist/cli.cjs recommend --workspace=.                 # read-only stack & .agy-nov.json validation (zero disk writes)
node dist/cli.cjs recommend --workspace=. --export-preset # strictly read-only preview of generated .agy-nov.json scaffold
# Write .agy-nov.json atomically ONLY after explicit user confirmation (add --force to overwrite):
node dist/cli.cjs recommend --workspace=. --export-preset --confirm
node dist/cli.cjs preset minimal          # guard 2.5 only (1 module, 6 model tools, 100% offline)
node dist/cli.cjs preset core             # review + guard 2.5 + xray 2.0 (3 modules, 12 model tools, default, 100% offline)
node dist/cli.cjs preset power            # core + turbo 3.0 + radar + verify + worktree + spec 2.0 + ops 3.0 (9 modules, 32 model tools, 100% offline)
node dist/cli.cjs preset local-all        # all 12 offline native modules incl. studio & mem 3.0 (43 model tools, 100% offline)
node dist/cli.cjs enable ops              # enable Ops 3.0 static security audit & cross-client dedup preview (100% offline)
node dist/cli.cjs enable mem              # enable Mem 3.0 confidence/TTL hygiene governance & progressive disclosure (100% offline)
node dist/cli.cjs enable turbo            # enable Turbo 3.0 (offline dep contracts, symbol refs, Context Pack & opt-in Auto-RTK, 100% offline)
node dist/cli.cjs enable spec             # enable Spec 2.0 Plannotator review bench & Brownfield delta specs (100% offline)
node dist/cli.cjs enable worktree         # enable Worktree Orchestrator incl. safe read-only .worktreeinclude (100% offline)
node dist/cli.cjs enable studio           # enable on-demand Workspace Studio incl. OpenAPI parser (100% offline; loopback HTTP probe only)
node dist/cli.cjs disable studio          # disable Studio when done to reclaim 4 tool-budget slots (app_nov_file_viewer stays available)
node dist/cli.cjs locale zh-CN            # set built-in UI language (auto | en | zh-CN | zh-TW | ja | ko | es | fr | de)
node dist/cli.cjs statusline --segments=brand,context,burn,cache,spec,verify,guard,radar,network
# Or set env fallback: AGY_NOV_STATUSLINE_SEGMENTS=brand,context,burn,guard,verify agy-nov statusline
# Auto-RTK internal runner (invoked automatically by PreToolUse.overwrite only when autoRtk=true):
node dist/cli.cjs compact-run --payload=<base64url>
```

### Consent-Gated Opt-In Network Module (`remote`)

Run these commands **only after explicit user confirmation**:

```bash
# Enable opt-in Remote 2.5 (Mobile PWA structured risk approval cards, read-only live stream, safe tunnel guide & IM webhooks)
node dist/cli.cjs enable remote

# Or enable all 13 native modules including opt-in remote (47 model tools)
node dist/cli.cjs preset full
```

---

## 7. Instant Rollback & Clean Uninstall

### Disable `remote` or Any Module Immediately

```bash
node dist/cli.cjs disable remote      # immediately stops remote & returns to 100% offline
node dist/cli.cjs disable <module>    # unregisters tools & short-circuits hooks in O(1)
node dist/cli.cjs preset core         # reset back to the default 3-module offline preset (12 tools)
```

### Complete Uninstall

Remove the installed plugin directory (confirm path with the user first):

```bash
rm -rf ~/.gemini/config/plugins/agy-nov
```
