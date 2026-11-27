# agy-NOV — AI Agent Zero-Risk Install & Verification Guide

This guide specifies exact, reproducible, zero-risk procedures for AI coding agents installing, previewing, configuring, or verifying **agy-NOV (v0.9.0)** on behalf of a user.

## 1. Prerequisites

Verify the host environment before making any changes:

```bash
node -v   # Required: Node.js >= 20.0.0
git --version
```

- **Target Host:** Google Antigravity 2.0 (Desktop, CLI, or IDE).
- **Architecture:** 100% official native protocols (MCP Apps SEP-1865 + official `com.google.antigravity/ui` `file` entrypoint `app_nov_file_viewer` + **5 official Lifecycle Hooks** incl. zero-token `PreInvocation` visual receipts, `PreToolUse.overwrite` & `force_ask` + **5 official on-demand Skills** `agy-nov` / `/nov-spec` / `/nov-debug` / `/nov-review` / `/nov-handoff` + **2 read-only specialist subagents** `nov-blind-reviewer` & `nov-security-auditor` with zero default resident `rules/AGENTS.md` bloat + dual-star read-only `feed-snapshot.json` contract + optional read-only `.agy-nov.json` team presets & `.worktreeinclude` allowlists + **9-command CLI** incl. `statusline`, `recommend`, `compact-run` & 15-asset `doctor`; Zero ASAR, Zero CDP).
- **4+1 Domain IA & Module Catalog:** 13 toggleable native modules grouped across 4 domains — Core Essentials (`core`: Two-Stage `review`, **Guard 2.5**, `xray` 2.0 with One-Click Clean Fork), Engineering Pipeline (`pipeline`: **Spec 2.0**, `worktree` with `.worktreeinclude`, `verify` with Worktree targeting & PR summary, **Turbo 3.0**, `mem` 2.0), On-Demand Toolbox (`toolbox`: `radar` 4-lane approval-first Kanban, `studio`, `canvas`, `ops` 2.5), and Opt-In Connectivity (`connectivity`: **Remote 2.5**, OFF by default) — fronted by the **+1 Workflow Hub** (`HubPanel`) and 4-tier **Settings Hub** (`SettingsHub`, S3 covering 6 configurable strategy modules: `guard`, `turbo`, `verify`, `spec`, `radar`, `remote`). All **47 canonical model tool names** remain strictly unchanged in v0.9.0 (+0 tool-slot inflation).
- **Default Footprint:** `core` preset (`review`, `guard`, `xray`) — `12` model tools, 100% local offline, `locale=auto` (full 8-language UI covering all **24 UI components**, `dist/ui/app.html` `~1.2 MB`, measured `1,233.1 KB`).

## 2. Hard Safety Rules for AI Agents

Follow these boundaries strictly across every session:

1. **Zero-Touch Evaluation:** During repository inspection, development, or testing, keep `~/.gemini/config/plugins/` untouched. Use `node dist/cli.cjs recommend --workspace=.`, `npm run workbench`, or an isolated `--data-dir=<temp_dir>` for verification.
2. **Explicit User Consent Before Enabling `remote` or Auto-RTK (`autoRtk`):**
   - Never run `enable remote` or `preset full` unless the user has explicitly asked for remote connectivity and confirmed the trade-off: `remote` (**Remote 2.5**) opens an opt-in local Mobile PWA server (featuring structured risk approval cards with `HIGH`/`MED`/`LOW` badges, affected file counts, redacted command summaries, and latest read-only `Verify` status rendered strictly via pure DOM APIs with zero `innerHTML`, plus tap-to-expand read-only redacted live step streams via `GET /api/conversations/:id/stream` with zero file writes / zero remote shell, and on-demand read-only `tailscale`/`cloudflared` command guides that never auto-launch public tunnels) and/or sends alerts to user-configured IM webhooks (Telegram, Feishu, DingTalk, WeCom, Slack, Discord). While `remote` stays OFF, `agy-NOV` maintains zero listening ports, zero background polling, zero disk writes for `remote`, and zero outbound network requests.
   - Keep Turbo 3.0 **Auto-RTK** strictly disabled by default (`autoRtk: false`). Surface `PostToolUse` noisy-command hotspots to the user and let them opt in via `TurboPanel` or **Settings Hub S3** (`PreToolUse.overwrite` runs strictly on allowlisted shell-free commands after `guard`/`spec`/`remote` pass cleanly, preserving non-zero exit codes, failure stacks, and `0600` redacted `last-raw.log`).
3. **End-to-End Pipeline, `.worktreeinclude` & Clean Fork Discipline:**
   - Treat workspace `.worktreeinclude` strictly as a read-only file-copy allowlist (`app_worktree_preview_include` + `applyInclude` default ON) with zero automatic post-create shell scripts; `.env*`, private keys, symlinks, and out-of-workspace paths are rejected and reported explicitly in `skippedSensitive`.
   - Use **Two-Stage Review** (Stage 1 active Spec compliance checklist + Stage 2 code quality `file:line` annotations across main workspace or registered Worktree branches), Worktree-targeted **Verify** (`worktreePath` + redacted `app_verify_pr_summary`), and **One-Click Clean Fork** (`app_xray_build_clean_fork_pack`, `<= 12 KB` linear-redacted budget via `app.sendMessage` `target: "new"`, falling back cleanly on `global` surfaces) to keep long tasks structured without context rot.
   - Dispatch on-demand playbooks (`/nov-spec`, `/nov-debug`, `/nov-review`, `/nov-handoff`) and strictly read-only specialist subagents (`nov-blind-reviewer`, `nov-security-auditor` — restricted to `read_file`, `grep_search`, `find_by_name`, `list_dir`, `subagent: true, mainAgent: false`) with zero MCP tool-slot cost and zero resident `rules/AGENTS.md` bloat.
4. **Native MCP Apps `file` Viewer Safety (`app_nov_file_viewer`):**
   - `app_nov_file_viewer` handles `.sqlite`, `.sqlite3`, `.db`, `.csv`, `.tsv`, `.svg`, `.openapi.yaml`, and `.openapi.yml` read-only previews via the official `com.google.antigravity/ui` `file` entrypoint while staying completely hidden from models (`visibility: ['app']`, zero tool tax), enforcing canonical `realpath` workspace containment, SVG XSS sanitization, and safe fallback for opaque `antigravity-file://` URIs even when `studio` and `canvas` are toggled off.
5. **Guard 2.5 Permission Modes & Turn-Grouped Rewind Discipline:**
   - Respect Guard 2.5's active protocol-level `permissionMode`: `readonly-audit` hard-denies all file mutations and command executions; `balanced-dev` runs default balanced guardrails; `strict-gate` enforces official `PreToolUse` `force_ask` confirmation on every write and command while keeping critical secret/destructive rules at hard `deny`.
   - When an edit turn needs rollback, guide the user to inspect the multi-file turn diff in `GuardPanel` and confirm the inline double-confirm 1-click turn rewind (reverting multi-edit files back to before their first edit in that turn with All-or-Nothing boundary preflight and `pre-rewind` backup).
6. **Settings Hub Governance & Single-File `.agy-nov.json` Team Preset Discipline:**
   - Config exports in Settings Hub S4 contain allowlisted fields only (zero secrets, zero local host paths); config imports enforce allowlist validation, block prototype pollution, and refuse silent `remote` enablement; resetting defaults requires explicit inline double confirmation.
   - Treat optional workspace `.agy-nov.json` files as strictly read-only (`<= 64 KiB`, `realpath`-bounded, prototype-pollution-safe). Never auto-create clutter directories inside user repositories, never auto-execute `verifyCommands` entries from `.agy-nov.json` (only statically validated against the 23-executable allowlist), and never allow a team preset to silently enable `remote`.
7. **Offline Modules & 100-Tool Budget Discipline (`turbo`, `spec`, `mem`, `ops`, `studio`, `verify`, `worktree`, etc.):** All 12 Tier-1 modules run 100% locally offline with zero external network traffic. Leverage **Turbo 3.0**'s offline locked dependency contracts (`turbo_read_outline` `depPackage` for Node/Python/Go/Rust with `realpath` containment and `<= 8.8 KB` UTF-8 safe caps), O(n) cross-file symbol references (`turbo_batch_search` `mode: "references"`), redacted Context Pack (`app_turbo_build_context_pack`), and in-memory `gain` telemetry (`app_turbo_get_gain`); use Mem 2.0's progressive `mem_recall` (`mode: "index" | "timeline" | "detail"`, `ids[]`, `window`) and `<private>...</private>` tags to keep context lean; and toggle on-demand modules like `studio` back off (`disable studio`) when finished to keep tool schemas at `0` overhead under Antigravity's 100-tool MCP hard limit.
8. **Spec 2.0 Human-Approval & Archive Integrity:** When `spec` has `requireUiApproval` enabled, `spec_approve` rejects model-side calls. Prompt the user to inspect the `full` or Brownfield `delta` (`ADDED`/`MODIFIED`/`REMOVED`) spec in the Spec 2.0 Plannotator review bench (line-level LCS diff, inline `Comment`/`Strike`/`Replace` annotations, 8-revision history) and approve it in UI before editing files. Archiving completed specs into `mem` automatically strips `<private>` tags and redacts secrets.
9. **Read-Only First Diagnostics, Zero-Token `PreInvocation` & Dual-Star `feed-snapshot.json`:** Use `node dist/cli.cjs recommend --workspace=<dir> --json` (which also validates optional `.agy-nov.json` read-only), `ops_audit_workspace` (Ops 2.5 detecting `#233` `${ENV_VAR}` traps, `#1937` duplicate plugins/MCP servers, and `.claude/`/`.cursor/rules/`/`.codex/` migration cues with zero secret echo), and `verify` stack auto-detection to diagnose and propose changes with zero disk writes before editing configuration. `PreInvocation` emits non-blocking zero-token visual receipts (`systemMessage: ""` + `metadata.user_markdown`) with O(1) short-circuiting when `spec`, `mem`, and `guard` are off; `<dataDir>/feed-snapshot.json` (`0600`, `< 64 KiB`, O(n) redacted) stays strictly zero-write when `dataDir` does not yet exist (see [`docs/DUAL-STAR-CONTRACT.md`](./DUAL-STAR-CONTRACT.md) and [`docs/PRODUCT-IA.md`](./PRODUCT-IA.md)).
10. **Zero ASAR & Zero CDP Boundary + Secret Hygiene:** Never modify Antigravity binaries or attach CDP sessions through `agy-NOV` (recommend companion **`agy-Sag` (`https://github.com/tone-leh/agy-session-guard`)** for host-DOM enhancements). Never print, log, or commit webhook tokens, pairing secrets, or `.env` contents.

---

## 3. Path A — Preview Safely Offline First (Recommended Before Install)

Use the isolated offline workbench whenever the user wants to inspect agy-NOV before installing it into their daily Antigravity setup:

```bash
git clone https://github.com/tone-leh/agy-NOV.git
cd agy-NOV
npm ci
node dist/cli.cjs recommend --workspace=.   # Zero-write stack & .agy-nov.json preset recommendation
npm run workbench
```

What this starts (locally on `127.0.0.1:4399`, using a temporary data directory that cleans up on exit):
- `http://127.0.0.1:4399` — Zero-touch native MCP App simulator covering the **L0 Workflow Hub** (6-node pipeline bar + alert cards + One-Click Clean Fork), **4-tier Settings Hub** (S1–S4, with 6 S3 policy drawers incl. Guard `permissionMode` & Turbo `autoRtk`), **`Cmd/Ctrl+K` command palette**, and all 13 domain-grouped module panels (including Two-Stage Review & Worktree branch switcher, `.worktreeinclude` preview, Verify Worktree targeting & PR delivery summary, Radar 4-lane approval-first Kanban, X-Ray One-Click Clean Fork, Native `file` viewer preview, **Remote 2.5** structured risk approval cards, **Turbo 3.0**, **Guard 2.5**, **Spec 2.0**, Mem 2.0, Ops 2.5, and Studio OpenAPI collections) with Dark / Light themes, `< 720px` (`480px` aux-pane compact bar) and `>= 720px` (`1160px` global `204px` left rail) viewport presets, an **8-language Host Locale simulator** (`en`, `zh-CN`, `zh-TW`, `ja`, `ko`, `es`, `fr`, `de` covering all **24 UI components**), and a live **Host Events** inspector (`sendMessage` / `updateModelContext` / `openFile`).

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
agy plugin install https://github.com/tone-leh/agy-session-guard
```

---

## 5. Mandatory Post-Install Verification (`doctor`, `status`, `statusline` & `recommend`)

Run read-only verification commands inside the plugin directory (or using `agy-nov` if linked on `PATH`):

```bash
node dist/cli.cjs doctor
node dist/cli.cjs status
node dist/cli.cjs statusline --json
node dist/cli.cjs recommend --workspace=. --json
```

### Required Pass Criteria for `node dist/cli.cjs doctor`

Confirm every check prints `OK` and exits with code `0`:

1. All **15 required core plugin assets** exist:
   - Manifests & config (3): `plugin.json`, `mcp_config.json`, `hooks.json`
   - Official Skills (5): `skills/agy-nov/SKILL.md`, `skills/nov-spec/SKILL.md`, `skills/nov-debug/SKILL.md`, `skills/nov-review/SKILL.md`, `skills/nov-handoff/SKILL.md`
   - Read-only specialist subagents (2): `agents/nov-blind-reviewer.md`, `agents/nov-security-auditor.md`
   - Visual & runtime bundles (5): `assets/logo.svg`, `dist/server.cjs`, `dist/hook.cjs`, `dist/cli.cjs`, `dist/ui/app.html`
2. `plugin.json schema clean` — strictly within the 10 officially supported top-level manifest keys (`name`, `displayName`, `description`, `version`, `logo`, `suggestedPrompts`, `author`, `homepage`, `repository`, `disabled`), reporting `version=0.9.0`.
3. `dist/ui/app.html well below 10 MiB cap` (`~1.2 MB`, measured `1,233.1 KB`, far below 10 MiB).
4. `config readable` showing expected defaults (`preset=core, locale=auto, remote=OFF`) unless the user requested another preset or locale.

### Full Developer Verification (Inside Source Checkout Only)

```bash
npm run typecheck
npm test              # 77 suites / 209 tests (incl. 3 v0.9.0 regression suites)
node dist/cli.cjs doctor
node dist/cli.cjs statusline
node dist/cli.cjs recommend --json
```

---

## 6. Post-Install Configuration Commands (9 CLI Commands)

`agy-nov` provides **9 CLI commands**: `status`, `enable`, `disable`, `preset`, `locale`, `statusline`, `recommend`, `doctor`, and `compact-run`.

### Offline Presets, Modules, Team Presets, Built-In 8-Language UI & Zero-Token `statusline` / `recommend`

```bash
node dist/cli.cjs recommend --workspace=. # read-only stack & .agy-nov.json team preset validation (zero disk writes)
node dist/cli.cjs preset minimal          # guard 2.5 only (1 module, 6 model tools, 100% offline)
node dist/cli.cjs preset core             # review + guard 2.5 + xray 2.0 (3 modules, 12 model tools, default, 100% offline)
node dist/cli.cjs preset power            # core + turbo 3.0 + radar + verify + worktree + spec 2.0 + ops 2.5 (9 modules, 32 model tools, 100% offline)
node dist/cli.cjs preset local-all        # all 12 offline native modules incl. studio & mem 2.0 (43 model tools, 100% offline)
node dist/cli.cjs enable turbo            # enable Turbo 3.0 (offline dep contracts, symbol refs, Context Pack & opt-in Auto-RTK, 100% offline)
node dist/cli.cjs enable spec             # enable Spec 2.0 Plannotator review bench & Brownfield delta specs (100% offline)
node dist/cli.cjs enable worktree         # enable Worktree Orchestrator incl. safe read-only .worktreeinclude (100% offline)
node dist/cli.cjs enable mem              # enable Mem 2.0 progressive disclosure & <private> stripping (100% offline)
node dist/cli.cjs enable studio           # enable on-demand Workspace Studio incl. OpenAPI parser (100% offline; loopback HTTP probe only)
node dist/cli.cjs disable studio          # disable Studio when done to reclaim 4 tool-budget slots (app_nov_file_viewer stays available)
node dist/cli.cjs locale zh-CN            # set built-in UI language (auto | en | zh-CN | zh-TW | ja | ko | es | fr | de)
node dist/cli.cjs statusline              # zero-token read-only status line (includes Verify, Spec:LOCK(done/total), Radar)
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
