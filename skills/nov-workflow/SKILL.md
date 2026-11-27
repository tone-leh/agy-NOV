---
name: nov-workflow
description: Compile an approved agy-NOV Spec Task DAG into native Antigravity /run-workflow Python orchestration scripts and /swarm execution blueprints with parallel wave isolation, read-only dual-subagent review, and Verify Stop Gate handoff. Use when turning a Spec into parallel multi-agent execution (将 Spec 编排编译为 /run-workflow 并行工作流或 /swarm 蓝图).
---

# /nov-workflow — Spec DAG to `/run-workflow` & `/swarm` Orchestration Playbook

Use this on-demand playbook after a Spec is planned and approved in **agy-NOV Spec Flow** to compile its acyclic Task DAG into auditable, native Antigravity `/run-workflow` Python orchestration or a structured `/swarm` JSON execution blueprint. This skill occupies zero MCP model tool slots and preserves the canonical 47-tool ceiling.

## Step 1 — Preflight & Approval Verification

1. Call `nov_status` to confirm `spec` is enabled (and check whether `worktree`, `verify`, `review`, and `guard` are enabled).
2. Call `spec_get_state` to verify the target Spec before compiling:
   - Confirm `status` is `"approved"` and `writeLockActive` is `false`.
   - Confirm `unresolvedAnnotations === 0`.
   - If the Spec is still in `"draft"`, resolve open annotations and approve it first via `SpecPanel` (when `requireUiApproval` is `true`) or `spec_approve` after explicit user confirmation.
   - Verify the Task DAG contains clear, independent task scopes with explicit `dependsOn` edges.

## Step 2 — Compile the Task DAG (CLI or Spec UI)

Choose either zero-write read-only export path:

- **Interactive UI (recommended for instant preview & copy)**:
  1. Call `nov_open` with `module: "spec"`.
  2. Click **Compile Workflow** in the active Spec header bar of `SpecTaskDagView`.
  3. Inspect the wave summary badges and any draft/blocker warnings, switch between the **`/run-workflow (Python)`** and **`/swarm (plan.json)`** tabs, optionally toggle **Include completed tasks**, and copy the compiled artifact.
- **CLI (offline & scriptable, run from the plugin install directory, e.g. `~/.gemini/config/plugins/agy-nov`)**:
  - Default both outputs / Python workflow: `node "$PLUGIN_ROOT/dist/cli.cjs" compile-spec` (or `agy-nov compile-spec`)
  - Target specific Spec or format: `agy-nov compile-spec --spec <specId> --target workflow|swarm|both`
  - Optional flags: `--no-review-gate`, `--no-verify-gate`, `--workspace inherit`, `--model inherit|flash|pro`, `--include-completed`.

All compiled outputs automatically strip `<private>...</private>` blocks, redact high-risk secret patterns linearly, reject unknown dependencies or dependency cycles before emitting any script, and encode every Python string literal safely without raw triple-quote interpolation.

## Step 3 — Parallel Wave Execution & Workspace Isolation

1. Audit the compiled waves before execution:
   - **Single-task waves (`1 task`)**: execute directly with `await agent(...)` on `workspace="inherit"`.
   - **Parallel waves (`>= 2 independent tasks`)**: execute with `await parallel(WAVE_N_TASKS, ...)` using `workspace="share"` (isolated workspace copies) to prevent concurrent edit collisions.
2. When managing long-lived parallel branches manually across repositories, pair with the `worktree` module (`worktree_create`, `worktree_list`, `worktree_diff_summary`) so each parallel wave or feature stream stays isolated in its own Git worktree.
3. Update task progress in the Spec DAG with `spec_update_task` (`in_progress` -> `done` or `blocked`) as each wave completes and returns its structured JSON summary (`taskId`, `summary`, `filesTouched`).

## Step 4 — Read-Only Dual Subagent Review Gate

Once implementation waves finish, run the compiled **Blind Review & Security Audit** phase (on `workspace="inherit"`):

- `nov-blind-reviewer`: independent zero-history-bias read-only reviewer checking Stage 1 Spec compliance and Stage 2 code correctness directly from disk (`PASS` / `CHANGES_REQUESTED`).
- `nov-security-auditor`: independent read-only security auditor checking path/symlink boundaries, argument injection, secret redaction, output safety, and module isolation (`PASS` / `RISK_FOUND`).

If either subagent reports blocking findings, fix them in scope before advancing to verification.

## Step 5 — Verify Stop Gate & Completion Handoff

1. Execute the **Verify Gate Handoff** phase:
   - Run real project checks (`verify_run_checks` when `verify` is enabled, plus targeted typecheck and unit/integration tests matching the Spec acceptance criteria).
   - Confirm `verify_get_evidence` records passing evidence so the Antigravity `Stop` hook clears cleanly without blocking termination.
2. Mark finished DAG tasks `done` via `spec_update_task` with concise verification evidence notes.
3. Open `SpecPanel` via `nov_open` (`module: "spec"`) to update the Spec status to `completed` and archive durable architectural decisions into `mem` when ready.
