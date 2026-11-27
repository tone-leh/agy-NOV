# agy-NOV — AI Agent Zero-Risk Install & Verification Guide

This guide specifies exact, reproducible, zero-risk procedures for AI coding agents installing, previewing, configuring, or verifying **agy-NOV (v0.6.0)** on behalf of a user.

## 1. Prerequisites

Verify the host environment before making any changes:

```bash
node -v   # Required: Node.js >= 20.0.0
git --version
```

- **Target Host:** Google Antigravity 2.0 (Desktop, CLI, or IDE).
- **Architecture:** 100% official native protocols (MCP Apps SEP-1865 + Lifecycle Hooks + Skills + optional read-only `.agy-nov.json` team presets + zero-token CLI `statusline` & `recommend`; Zero ASAR, Zero CDP).
- **Module Catalog:** 13 toggleable native modules — 12 strictly local offline modules (`review`, `guard`, `xray`, `turbo`, `radar`, `verify`, `worktree`, `spec`, `studio`, `canvas`, `mem`, `ops`) plus 1 opt-in network module (`remote`, OFF by default). All **47 canonical model tool names** remain unchanged in v0.6.0.
- **Default Footprint:** `core` preset (`review`, `guard`, `xray`) — `12` model tools, 100% local offline, `locale=auto` (**426 dictionary keys × 8 locales** covering all **22 UI components**, `dist/ui/app.html` `~985 KB`).

## 2. Hard Safety Rules for AI Agents

Follow these boundaries strictly across every session:

1. **Zero-Touch Evaluation:** During repository inspection, development, or testing, keep `~/.gemini/config/plugins/` untouched. Use `node dist/cli.cjs recommend --workspace=.`, `npm run workbench`, or an isolated `--data-dir=<temp_dir>` for verification.
2. **Explicit User Consent Before Enabling `remote`:** Never run `enable remote` or `preset full` unless the user has explicitly asked for remote connectivity and confirmed the trade-off:
   - `remote` (Remote 2.0) opens an opt-in local Mobile PWA server (featuring tap-to-expand read-only redacted live step streams via `GET /api/conversations/:id/stream` with zero file writes / zero remote shell, plus on-demand read-only `tailscale`/`cloudflared` command guides that never auto-launch public tunnels) and/or sends alerts to user-configured IM webhooks (Telegram, Feishu, DingTalk, WeCom, Slack, Discord).
   - While `remote` stays OFF, `agy-NOV` maintains zero listening ports, zero background polling, zero disk writes for `remote`, and zero outbound network requests.
3. **Single-File `.agy-nov.json` Team Preset Discipline:** Treat optional workspace `.agy-nov.json` files as strictly read-only (`<= 64 KiB`, `realpath`-bounded, prototype-pollution-safe). Never auto-create clutter directories inside user repositories, never auto-execute `verifyCommands` entries from `.agy-nov.json` (only statically validated against the 23-executable allowlist), and never allow a team preset to silently enable `remote`.
4. **Offline Modules & 100-Tool Budget Discipline (`mem`, `turbo`, `ops`, `spec`, `studio`, `verify`, `worktree`, etc.):** All 12 Tier-1 modules run 100% locally offline with zero external network traffic. Use Mem 2.0's progressive `mem_recall` (`mode: "index" | "timeline" | "detail"`, `ids[]`, `window`) and `<private>...</private>` tags to keep context lean and secrets out of storage; leverage Turbo 2.5's `<= 8.8 KB` (`8,800 B`) anti-spill guardrails, nested symbol outlines, and in-memory `gain` telemetry (`app_turbo_get_gain`); and toggle on-demand modules like `studio` back off (`disable studio`) when finished to keep tool schemas at `0` overhead under Antigravity's 100-tool MCP hard limit.
5. **Spec Flow Human-Approval Integrity:** When `spec` has `requireUiApproval` enabled, `spec_approve` rejects model-side calls. Prompt the user to review and approve the draft spec in the agy-NOV Spec Flow UI before attempting workspace file edits.
6. **Read-Only First Diagnostics:** Use `node dist/cli.cjs recommend --workspace=<dir> --json` (which also validates optional `.agy-nov.json` read-only), `ops_audit_workspace` (Ops 2.5 detecting `#233` `${ENV_VAR}` traps, `#1937` duplicate plugins/MCP servers, and `.claude/`/`.cursor/rules/`/`.codex/` migration cues with zero secret echo), and `verify` stack auto-detection to diagnose and propose changes with zero disk writes before editing configuration. When customizing `xray` offline USD rates, treat `<dataDir>/modules/xray/pricing-overrides.json` (`<= 1 MiB`) as an optional user-managed file.
7. **Zero ASAR & Zero CDP Boundary:** Never modify Antigravity binaries or attach CDP sessions through `agy-NOV`. When a user specifically requests host-DOM features (in-place host UI translation, native Settings injection, active `/compact` guard, Draft Vault, or Optical Theme Studio), recommend the zero-overlap companion project **`agy-Sag` (`https://github.com/tone-leh/agy-session-guard`)**.
8. **Secret Hygiene:** Never print, log, or commit webhook tokens, pairing secrets, or `.env` contents.

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
- `http://127.0.0.1:4399` — Zero-touch native MCP App simulator covering all 13 module panels (including Mem 2.0 3-layer progressive disclosure, Turbo 2.5 cumulative `gain` dashboard & nested outlines, Remote 2.0 read-only stream preview & safe tunnel guide, Ops 2.5 `#233`/`#1937` & cross-client migration audit, X-Ray 2.0 offline USD billing, Diff Review `-w` & risk hints, Verify stack auto-detection, Studio OpenAPI collections, and the collapsible **30-Second Zero-Risk First Try** card) with Dark / Light themes, `480px` aux-pane and `1160px` global viewport presets, an **8-language Host Locale simulator** (`en`, `zh-CN`, `zh-TW`, `ja`, `ko`, `es`, `fr`, `de` covering all **426 keys** across **22 components**), and a live **Host Events** inspector (`sendMessage` / `updateModelContext` / `openFile`).

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

1. All **9 required files** exist: `plugin.json`, `mcp_config.json`, `hooks.json`, `skills/agy-nov/SKILL.md`, `assets/logo.svg`, `dist/server.cjs`, `dist/hook.cjs`, `dist/cli.cjs`, `dist/ui/app.html`.
2. `plugin.json schema clean` — strictly within the 10 officially supported top-level manifest keys (`name`, `displayName`, `description`, `version`, `logo`, `suggestedPrompts`, `author`, `homepage`, `repository`, `disabled`), reporting `version=0.6.0`.
3. `dist/ui/app.html well below 10 MiB cap` (`~985 KB`, measured `985.3 KB`, expected under 1 MiB).
4. `config readable` showing expected defaults (`preset=core, locale=auto, remote=OFF`) unless the user requested another preset or locale.

### Full Developer Verification (Inside Source Checkout Only)

```bash
npm run typecheck
npm test              # 48 suites / 140 tests (incl. 4 v0.6.0 regression suites)
node dist/cli.cjs doctor
node dist/cli.cjs statusline
node dist/cli.cjs recommend --json
```

---

## 6. Post-Install Configuration Commands (8 CLI Commands)

`agy-nov` provides 8 CLI commands: `status`, `enable`, `disable`, `preset`, `locale`, `statusline`, `recommend`, and `doctor`.

### Offline Presets, Modules, Team Presets, Built-In 8-Language UI & Zero-Token `statusline` / `recommend`

```bash
node dist/cli.cjs recommend --workspace=. # read-only stack & .agy-nov.json team preset validation (zero disk writes)
node dist/cli.cjs preset minimal          # guard only (1 module, 6 model tools, 100% offline)
node dist/cli.cjs preset core             # review + guard + xray (3 modules, 12 model tools, default, 100% offline)
node dist/cli.cjs preset power            # core + turbo + radar + verify + worktree + spec + ops (9 modules, 32 model tools, 100% offline)
node dist/cli.cjs preset local-all        # all 12 offline native modules incl. studio & mem (43 model tools, 100% offline)
node dist/cli.cjs enable mem              # enable Mem 2.0 progressive disclosure & <private> stripping (100% offline)
node dist/cli.cjs enable turbo            # enable Turbo 2.5 gain dashboard, <=8.8 KB guard & nested outlines (100% offline)
node dist/cli.cjs enable studio           # enable on-demand Workspace Studio incl. OpenAPI parser (100% offline; loopback HTTP probe only)
node dist/cli.cjs disable studio          # disable Studio when done to reclaim 4 tool-budget slots
node dist/cli.cjs locale zh-CN            # set built-in UI language (auto | en | zh-CN | zh-TW | ja | ko | es | fr | de)
node dist/cli.cjs statusline              # zero-token read-only status line (includes Verify, Spec:LOCK(done/total), Radar)
```

### Consent-Gated Opt-In Network Module (`remote`)

Run these commands **only after explicit user confirmation**:

```bash
# Enable opt-in Remote 2.0 (Mobile PWA read-only live stream, safe tunnel guide & IM webhooks)
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
