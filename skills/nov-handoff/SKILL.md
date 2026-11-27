---
name: nov-handoff
description: Prevent context rot with a structured agy-NOV session handoff combining redacted X-Ray briefs, ready Spec DAG tasks, code-anchored Memory decisions, and Clean Fork continuation.
---

# /nov-handoff — Anti-Context-Rot Handoff & Clean Fork Playbook

Use this on-demand playbook whenever a session grows large, prefix cache efficiency drops, retries accumulate noise, or work needs a clean continuation in a fresh session.

## Step 1 — Diagnose Context Health & Export Redacted Brief

1. Call `nov_status` to check active modules (`xray` and `review` are ON by default; `spec` and `mem` are opt-in).
2. Call `xray_analyze_context` to inspect peak context window size, prefix cache hit rate, tool-output hotspots ("Token Vampires"), and diagnostic alerts.
3. Call `xray_export_brief` with `format: "handoff"` to produce a compact, secret-redacted handoff snapshot that strips noise while retaining concrete progress.
4. Optionally call `xray_get_file_activity` (`modifiedOnly: true`) and `review_get_summary` to capture the exact set of modified workspace files and any open diff annotations.

## Step 2 — Pinpoint Next Unblocked Spec DAG Tasks

1. When `spec` is enabled, call `spec_get_state` to extract:
   - Active spec ID, title, revision, status (`draft` / `approved` / `completed`), and `writeLockActive`.
   - Task completion count (`done` / total) and any open `unresolvedAnnotations`.
   - The exact next unblocked `ready` tasks (`computedState: "ready"`, empty `unmetDeps`), plus any `in_progress` or `blocked` tasks with blocker notes.
2. Call `spec_update_task` before handing off if any task's real disk progress differs from its recorded DAG status.

## Step 3 — Anchor Durable Decisions in Memory Graph

1. When `mem` is enabled, persist lasting cross-session architecture choices, non-obvious pitfalls, or workspace conventions via `mem_remember`:
   - Choose the right `kind` (`"architecture"`, `"decision"`, `"pitfall"`, `"convention"`, or `"preference"`).
   - Provide concise `title`, clear `content`, and `anchors` (`filePath` + optional `symbol`) so SHA-256 drift detection flags stale memories if those files change later.
2. Never include credentials, tokens, or personal secrets in memory entries. `mem_remember` automatically strips `<private>...</private>` sections and redacts secret patterns; omit sensitive values at source as well.
3. Keep transient step-by-step checklists inside the handoff summary and Spec DAG to preserve a lean `SessionStart` memory index.

## Step 4 — Emit the Compact Handoff Packet

Present a tight, copy-ready handoff summary with five blocks:
1. **Completed & Verified**: concrete changes delivered and exact checks that passed.
2. **Workspace State**: modified files, branch/worktree location, and open review annotations.
3. **Next Unblocked `ready` Task(s)**: exact Spec ID, `ready` task IDs, dependencies cleared, and acceptance criteria.
4. **Anchored Decisions & Pitfalls**: durable constraints saved via `mem_remember` (or noted inline if `mem` is OFF).
5. **Open Risks & Unverified Items**: explicit list of remaining edge cases or tests still to run.

## Step 5 — Continue via Clean Fork

1. Call `nov_open` (`module: "xray"` or `module: "hub"`).
2. Invite the user to click **Clean Fork** in the **agy-NOV Hub** or **X-Ray** panel to start a clean session in the same workspace seeded with the compact handoff context and free of stale transcript buildup.
