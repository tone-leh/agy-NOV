---
name: nov-debug
description: Follow a disciplined 4-step root-cause debugging playbook in agy-NOV with bounded Turbo inspection, Guard safety checkpoints, falsifiable hypotheses, and real Verify/Review evidence.
---

# /nov-debug — 4-Step Root-Cause Debugging Playbook

Use this on-demand playbook to diagnose bugs systematically without guess-and-patch edits. Complete observation, safety isolation, and hypothesis falsification before editing source files.

## Preflight — Check Active Modules & Guard Mode

1. Call `nov_status` to check active modules (`guard` and `review` are ON by default; `turbo` and `verify` are opt-in).
2. Call `guard_status` to confirm the current `permissionMode` (`readonly-audit`, `balanced-dev`, or `strict-gate`) and pre-edit snapshot protection.

## Step 1 — Reproduce & Observe

1. Record the minimal reproduction steps, exact failing command or input, expected behavior, actual behavior, and verbatim stack trace.
2. Inspect only the narrowest code surface needed to trace the failure path:
   - When `turbo` is enabled:
     - Call `turbo_batch_search` with `mode: "references"` (`queries: ["SymbolName"]`) to locate definitions, imports, and call sites in one bounded pass, or `mode: "text"` with 1–8 targeted error/symbol queries.
     - Call `turbo_read_outline` with `filePath` (`startLine`, `endLine`) to read targeted symbol outlines and line slices while avoiding full-file context bloat.
     - Call `turbo_read_outline` with `depPackage` (and optional `symbolFilter`) to verify locally locked dependency contracts offline (`node_modules/.d.ts`, Python `.pyi`, `go.mod`, `Cargo.lock`) before assuming external API behavior.
     - Pass noisy stack logs through `turbo_compact_output` (`preset: "test" | "build" | "git" | "auto"`) to retain failing frames cleanly.
   - When `turbo` is OFF, keep file reads tightly bounded to stack frames and mention `node dist/cli.cjs enable turbo` for large repositories.

## Step 2 — Protect & Isolate

1. Keep the workspace unchanged while investigating. For high-risk debugging in sensitive repositories, advise the user to switch Guard `permissionMode` to `readonly-audit` via `nov_open` (`module: "guard"` or `module: "settings"`) during diagnosis.
2. Before applying any edit, create a zero-Git manual checkpoint with `guard_create_checkpoint` (`files: [...]`, `reason: "pre-debug-fix: <short symptom>"`).
3. Verify snapshot coverage with `guard_list_snapshots` (`groupByTurn: true`) so any faulty experiment can be rewound cleanly in `GuardPanel`.
4. Never read or echo `.env`, SSH keys, or credential files; run `guard_scan_secrets` if the failure involves config loading or logging paths.

## Step 3 — Hypothesize & Narrow

1. Write down 1–3 explicit, falsifiable root-cause hypotheses grounded in exact `file:line` observations.
2. Run the smallest read-only check or isolated unit probe that can disprove the leading hypothesis.
3. Discard disproven hypotheses explicitly and refine until one verified mechanism accounts for both the stack trace and boundary conditions.
4. Refuse speculative multi-file edits while the root cause remains unproven.

## Step 4 — Minimal Fix & Real Evidence

1. Implement the smallest cohesive change that eliminates the proven root cause, leaving unrelated code untouched.
2. Add or tighten a focused regression test that reproduces the original bug and passes after the fix.
3. Capture concrete verification evidence:
   - When `verify` is enabled, inspect `verify_get_policy`, run `verify_run_checks`, and confirm the recorded pass entry via `verify_get_evidence`.
   - Run targeted unit tests and typechecks directly whenever `verify` is OFF or does not include the affected test file.
4. Call `review_get_summary` (and `review_open` for multi-file fixes) to confirm the diff stays minimal, scoped, and regression-free.

## Delivery Summary Format

Report five concise blocks: **Reproduction**, **Confirmed Root Cause (`file:line`)**, **Minimal Fix**, **Verification Evidence** (exact commands and pass/fail status), and **Residual Risks**.
