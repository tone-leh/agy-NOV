---
name: nov-review
description: Execute a structured two-stage code review in agy-NOV covering Spec compliance, Git diff risk inspection, Worktree branch diffs, and optional blind or security subagent audits.
---

# /nov-review — Two-Stage Diff & Compliance Review Playbook

Use this on-demand playbook to audit working-tree edits, staged diffs, commit ranges, or parallel Git worktree branches in two distinct passes: Spec compliance first, code quality and regression second.

## Preflight — Resolve Review Target

1. Call `nov_status` to confirm `review` is enabled and check whether `spec`, `worktree`, `verify`, and `guard` are available.
2. Resolve the exact target scope:
   - **Main workspace**: call `review_get_summary` with the desired `scope` (`"working"`, `"staged"`, `"unstaged"`, `"head~1"`, or `"commit-range"` with `commitRange`) and optional `ignoreWhitespace: true`.
   - **Parallel worktree branch** (when `worktree` is enabled): call `worktree_list` to locate the active worktree path and call `worktree_diff_summary` to inspect ahead/behind counts and touched files relative to the base ref, then pass that worktree's `repoPath` into `review_get_summary` and `review_open`.

## Stage 1 — Spec Compliance & Scope Audit

1. If `spec` is enabled, call `spec_get_state` to retrieve the active spec's `goal`, `acceptanceCriteria`, `deltaItems` (`added` / `modified` / `removed`), DAG `tasks`, and `unresolvedAnnotations`.
2. Map each acceptance criterion and behavioral delta directly against the changed files and actual code on disk.
3. Explicitly call out three classes of compliance defects:
   - **Missing requirements**: acceptance criteria or approved tasks left unimplemented or lacking tests.
   - **Out-of-scope edits**: unrelated files, incidental config mutations, or unrequested refactors outside the approved boundary.
   - **Contract drift**: public signatures, CLI flags, error semantics, or schema shapes diverging from the spec.
4. If `spec` is OFF or no active spec exists, validate against the user's explicit request and workspace conventions.

## Stage 2 — Code Quality, Edge Cases & Regression Review

1. Launch the interactive diff bench via `review_open` (passing `repoPath`, `scope`, `commitRange`, and `selectedFile` for the highest-risk file) so the user can inspect highlighted hunks and drop categorized inline annotations (`security`, `bug`, `refactor`, `question`, `nit`).
2. Inspect files prioritized by `review_get_summary` risk tags (`security-sensitive`, `large`, `config`, `test`):
   - Logic correctness, state transitions, null/empty/oversized inputs, error propagation, and cleanup paths.
   - Cross-file caller compatibility and untouched references.
   - Security hygiene: path containment, symlink safety, command/Git argument escaping, secret redaction, and safe HTML rendering (call `guard_scan_secrets` when `guard` is enabled if credentials or sensitive files could be exposed).
   - Test quality and real execution proof: call `verify_get_evidence` when `verify` is enabled to check whether recent automated checks actually passed.

## Optional Zero-Bias Read-Only Subagent Escalation

For high-risk diffs, security-sensitive modules, cross-module refactors, or release sign-off, recommend dispatching `agy-NOV`'s built-in read-only subagents:
- `nov-blind-reviewer`: zero-history-bias two-stage audit verifying Spec compliance and code quality directly from disk (`PASS` / `CHANGES_REQUESTED`).
- `nov-security-auditor`: focused read-only security red-team audit reporting evidence-backed findings ranked `Critical / High / Medium / Low`.

## Review Report Contract

Deliver four concise sections:
1. **Stage 1 — Spec Compliance**: requirement-by-requirement status with `file:line` evidence.
2. **Stage 2 — Findings**: Blocking issues first, then non-blocking notes, each with `[Severity] file:line`, concrete failure impact, and minimal fix.
3. **Verification Status**: distinguish static checks, isolated tests, and unverified runtime paths.
4. **Verdict**: `PASS` or `CHANGES_REQUESTED`.
