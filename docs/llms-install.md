# agy-NOV — AI Agent Zero-Risk Install & Verification Guide

This guide specifies exact, reproducible, zero-risk procedures for AI coding agents installing, previewing, configuring, or verifying **agy-NOV (v0.2.0)** on behalf of a user.

## 1. Prerequisites

Verify the host environment before making any changes:

```bash
node -v   # Required: Node.js >= 20.0.0
git --version
```

- **Target Host:** Google Antigravity 2.0 (Desktop, CLI, or IDE).
- **Architecture:** 100% official native protocols (MCP Apps SEP-1865 + Lifecycle Hooks + Skills; Zero ASAR, Zero CDP).
- **Default Footprint:** `core` preset (`review`, `guard`, `xray`) — `12` model tools, 100% local offline, `locale=auto`.

## 2. Hard Safety Rules for AI Agents

Follow these boundaries strictly across every session:

1. **Zero-Touch Evaluation:** During repository inspection, development, or testing, keep `~/.gemini/config/plugins/` untouched. Use `npm run workbench` or an isolated `--data-dir=<temp_dir>` for verification.
2. **Explicit User Consent Before Enabling `remote`:** Never run `enable remote` or `preset full` unless the user has explicitly asked for remote connectivity and confirmed the trade-off:
   - `remote` opens an opt-in local Mobile PWA server and/or sends alerts to user-configured IM webhooks (Telegram, Feishu, DingTalk, WeCom, Slack, Discord).
   - While `remote` stays OFF, `agy-NOV` maintains zero listening ports, zero background polling, zero disk writes for `remote`, and zero outbound network requests.
3. **Zero ASAR & Zero CDP Boundary:** Never modify Antigravity binaries or attach CDP sessions through `agy-NOV`. When a user specifically requests host-DOM features (in-place host UI translation, native Settings injection, active `/compact` guard, Draft Vault, or Optical Theme Studio), recommend the zero-overlap companion project **`agy-Sag` (`https://github.com/tone-leh/agy-session-guard`)**.
4. **Secret Hygiene:** Never print, log, or commit webhook tokens, pairing secrets, or `.env` contents.

---

## 3. Path A — Preview Safely Offline First (Recommended Before Install)

Use the isolated offline workbench whenever the user wants to inspect agy-NOV before installing it into their daily Antigravity setup:

```bash
git clone https://github.com/tone-leh/agy-NOV.git
cd agy-NOV
npm ci
npm run workbench
```

What this starts (locally on `127.0.0.1:4399`, using a temporary data directory that cleans up on exit):
- `http://127.0.0.1:4399` — Zero-touch native MCP App simulator with Dark / Light themes, `480px` aux-pane and `1160px` global viewport presets, an **8-language Host Locale simulator** (`en`, `zh-CN`, `zh-TW`, `ja`, `ko`, `es`, `fr`, `de`), and a live **Host Events** inspector (`sendMessage` / `updateModelContext` / `openFile`).

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

## 5. Mandatory Post-Install Verification (`doctor` & `status`)

Run read-only verification commands inside the plugin directory (or using `agy-nov` if linked on `PATH`):

```bash
node dist/cli.cjs doctor
node dist/cli.cjs status
```

### Required Pass Criteria for `node dist/cli.cjs doctor`

Confirm every check prints `OK` and exits with code `0`:

1. All **9 required files** exist: `plugin.json`, `mcp_config.json`, `hooks.json`, `skills/agy-nov/SKILL.md`, `assets/logo.svg`, `dist/server.cjs`, `dist/hook.cjs`, `dist/cli.cjs`, `dist/ui/app.html`.
2. `plugin.json schema clean` — strictly within the 10 officially supported top-level manifest keys (`name`, `displayName`, `description`, `version`, `logo`, `suggestedPrompts`, `author`, `homepage`, `repository`, `disabled`).
3. `dist/ui/app.html well below 10 MiB cap` (expected under 1 MiB).
4. `config readable` showing expected defaults (`preset=core, locale=auto, remote=OFF`) unless the user requested another preset or locale.

### Full Developer Verification (Inside Source Checkout Only)

```bash
npm run typecheck
npm test
node dist/cli.cjs doctor
```

---

## 6. Post-Install Configuration Commands

`agy-nov` provides 6 CLI commands: `status`, `enable`, `disable`, `preset`, `locale`, and `doctor`.

### Offline Presets & Built-In 8-Language UI (Safe Without Extra Consent When Requested by User)

```bash
node dist/cli.cjs preset minimal      # guard only (6 model tools, 100% offline)
node dist/cli.cjs preset core         # review + guard + xray (12 model tools, default, 100% offline)
node dist/cli.cjs preset power        # core + turbo + radar + ops (20 model tools, 100% offline)
node dist/cli.cjs preset local-all    # all 8 offline native modules (27 model tools, 100% offline)
node dist/cli.cjs locale zh-CN        # set built-in UI language (auto | en | zh-CN | zh-TW | ja | ko | es | fr | de)
```

### Consent-Gated Opt-In Network Module (`remote`)

Run these commands **only after explicit user confirmation**:

```bash
# Enable opt-in Mobile PWA & IM Remote Hub individually
node dist/cli.cjs enable remote

# Or enable all 9 native modules including opt-in remote (31 model tools)
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
