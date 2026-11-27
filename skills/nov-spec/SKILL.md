---
name: nov-spec
description: Run a Spec-first planning and Brownfield delta workflow in agy-NOV using Spec Flow, Task DAG tracking, inline UI review, pre-approval write locking, and Memory Graph archival.
---

# /nov-spec — Spec-First Planning & Brownfield Delta Playbook

Use this on-demand playbook to drive structured engineering delivery with **agy-NOV Spec Flow** (`full` specs for greenfield work, `delta` specs for brownfield changes). This skill occupies zero MCP tool slots and relies strictly on canonical `agy-NOV` tools.

## Step 1 — Preflight & Module Check

1. Call `nov_status` to check whether `spec` (and optionally `mem` and `verify`) is enabled.
2. If `spec` is OFF, pause and tell the user how to enable it:
   - Interactive UI: call `nov_open` with `module: "modules"` (or `module: "settings"`), or
   - CLI: `node dist/cli.cjs enable spec` (or `node dist/cli.cjs preset power` for the full offline engineering pipeline).
   - Never silently enable `remote` or unrelated modules without explicit user consent.
3. Once `spec` is ON, call `spec_get_state` to inspect any active spec, current `revision`, `writeLockActive`, `unresolvedAnnotations`, and DAG task readiness.

## Step 2 — Draft or Revise the Spec & Task DAG

1. Select the spec mode:
   - `mode: "full"` for greenfield features or standalone deliverables.
   - `mode: "delta"` for brownfield changes; populate `deltaItems` with `kind` (`"added"`, `"modified"`, or `"removed"`), optional `area`, and a concise behavioral contract in `text`.
2. Call `spec_create_or_update` with:
   - `title` and `goal` stating scope, boundaries, and non-goals.
   - `planMarkdown` (Context, Contract, File Scope, Risks, Verification) for inline review and revision diffing.
   - `acceptanceCriteria` (testable checks), ordered `planSteps`, and `tasks` (unique IDs matching `/^[a-zA-Z0-9._-]{1,48}$/` with acyclic `dependsOn`).
   - `enforcePlanBeforeWrite: true` (default) to keep the `PreToolUse` draft write lock active until approval, plus `revisionSummary` on updates.
   - Preserve `requireUiApproval` whenever UI-only sign-off is enabled.

## Step 3 — Inline UI Review & Approval Gate

1. Open the Spec Flow workbench via `nov_open` (`module: "spec"`).
2. Ask the user to review the plan line by line in `SpecPanel`, using inline `comment`, `strike`, or `replace` annotations for pinpoint adjustments.
3. Whenever `spec_get_state` reports `unresolvedAnnotations > 0`, address every open annotation and publish a fresh revision with `spec_create_or_update` before requesting approval again.
4. Respect approval guardrails strictly:
   - When `requireUiApproval` is `true`, wait for the user to approve directly inside `SpecPanel` (`spec_approve` is intentionally blocked for model callers).
   - When `requireUiApproval` is `false`, call `spec_approve` only after explicit user confirmation.
   - Never attempt workspace edits while `enforcePlanBeforeWrite` holds the draft write lock active.

## Step 4 — Execute Ready DAG Tasks

1. Call `spec_get_state` and pick tasks whose `computedState` is `ready` (all `dependsOn` prerequisites `done`).
2. Before modifying files for a task, call `spec_update_task` with `status: "in_progress"`.
3. Implement strictly within the approved file scope and acceptance criteria.
4. Verify each completed task with real checks (call `verify_run_checks` when `verify` is enabled, or run targeted tests/typechecks), then call `spec_update_task` with `status: "done"` and a concise evidence `note`.
5. If a task hits an external blocker or ambiguity, mark it `status: "blocked"` with an actionable `note` and report to the user.

## Step 5 — Archive & Distill to Memory

1. After all DAG tasks reach `done` and acceptance criteria pass, open `SpecPanel` via `nov_open` (`module: "spec"`).
2. Prompt the user to click **Archive to Memory** in `SpecPanel` to archive the completed spec into `mem` (automatically stripping `<private>` blocks and redacting secrets).
3. If `mem` is enabled and key code-anchored architectural invariants remain outside the spec summary, capture them with `mem_remember` anchored to relevant `filePath` values.
