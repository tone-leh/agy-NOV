# agy-NOV Read-Only Audit Sidecar

`sidecars/audit-sidecar.mjs` is an **opt-in, one-shot, read-only health sweep runner** for Google Antigravity 2.35+ workflows and local scheduled checks.

## Zero Idle Daemon by Default

- Installing or enabling `agy-NOV` **never** starts this script automatically.
- There is **no background daemon**, **no polling loop**, and **no open TCP/HTTP port**.
- Each invocation runs one read-only sweep, emits redacted JSON to `stdout`, and exits immediately.

## Manual One-Shot Run

From your project workspace (or pass `--workspace=<dir>` explicitly):

```bash
node ~/.gemini/config/plugins/agy-nov/sidecars/audit-sidecar.mjs --once
```

Common options:

```bash
# Inspect a specific repository and agy-NOV data directory (strictly read-only, zero writes)
node sidecars/audit-sidecar.mjs --once --workspace=/path/to/repo --data-dir=/path/to/agy-nov-data

# Optionally persist a compact health-sweep.json (<= 64 KiB, mode 0600) into an EXISTING safe dataDir
node sidecars/audit-sidecar.mjs --once --workspace=/path/to/repo --data-dir=/path/to/agy-nov-data --write-report

# Show usage and flags
node sidecars/audit-sidecar.mjs --help
```

You can also invoke the underlying CLI subcommand directly:

```bash
agy-nov audit-once --workspace=/path/to/repo --json
```

## Optional Scheduling (Antigravity `/schedule` or OS Scheduler)

### Antigravity `/schedule`

Configure an opt-in Antigravity `/schedule` task to run the one-shot audit on your chosen cadence (for example, once daily or before release windows):

```text
Run `node ~/.gemini/config/plugins/agy-nov/sidecars/audit-sidecar.mjs --once --workspace=<repo>` and summarize `overallStatus`, `ops.highSecurityFindingsCount`, `mem.staleCount`, `verify.verifyLastStatus`, `guard.guardBlockedCount`, and `recommendations`.
```

### System Cron / launchd / Task Scheduler

- **Linux / macOS `cron`** (example: weekdays at 09:00):
  ```cron
  0 9 * * 1-5 /usr/bin/env node "$HOME/.gemini/config/plugins/agy-nov/sidecars/audit-sidecar.mjs" --once --workspace="$HOME/projects/my-repo" --write-report >/dev/null
  ```
- **macOS `launchd` / Windows Task Scheduler**: point the scheduled job at `node` with arguments `["<plugin-root>/sidecars/audit-sidecar.mjs", "--once", "--workspace=<repo>"]` and let the OS scheduler trigger it on demand.

## What the Sweep Checks (100% Read-Only)

- **Workspace Ops Audit**: `healthScore`, `securityScore`, rule bloat status (24 KB / 20K tokens), 100-tool budget meter, and redacted static security finding counts and top summaries.
- **Memory Hygiene**: `totalMemories`, `staleCount` (drifted/stale anchors), and `expiredUnpinnedCount` from `modules/mem/memories.json`.
- **Verify Gate**: `verifyLastStatus` (`pass` / `fail` / `blocked` / `idle`) and deduplicated `dirtyFilesCount` from `modules/verify/state.json`.
- **Guard Audit**: `guardBlockedCount` from `modules/guard/audit.json`.
- **Active Config**: `preset`, `enabledModulesCount`, `exposedModelTools`, and `remoteEnabled` from `config.json`.
- **Overall Status & Recommendations**: `overallStatus` (`healthy` / `attention` / `action-required`) plus up to 6 concise redacted recommendations.

## Security Boundaries

1. **100% Zero ASAR / Zero CDP**: Uses only official plugin files and Node.js standard library APIs.
2. **Zero Code Modifications**: Never edits repository files, Git state, or plugin manifests.
3. **Zero Network Footprint**: Opens zero listening sockets and sends zero outbound requests.
4. **Zero Writes by Default**: Never creates missing directories or files. With `--write-report`, writes `health-sweep.json` only when `dataDir` already exists as a safe non-symlink directory, enforcing a 64 KiB cap, `0600` permissions, `O_CREAT | O_EXCL` temporary files, and atomic rename.
5. **Symlink & File-Size Defenses**: Rejects unsafe symlink ancestors, symlinked module JSON files, and files exceeding 2 MiB.
6. **Full Redaction & Path Minimization**: Redacts tokens, keys, webhooks, PEM blocks, and `<private>` sections; emits only the workspace basename in `workspaceName` and strips host absolute paths from summaries.
7. **Shell-Free Execution**: Invokes `dist/cli.cjs` via `spawnSync(..., { shell: false })` with an explicit argument allowlist.
