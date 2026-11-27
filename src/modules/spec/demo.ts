import type { SpecDocument, SpecStateFile } from './types.js';

/**
 * Pure in-memory demo dataset for demoMode (zero disk writes).
 * Contains 2 realistic specs:
 * 1) An approved Brownfield Delta Spec (v1 -> v2) with a 4-task dependency DAG, delta items, and plan annotations
 * 2) A draft Full Spec (v1 -> v2) with pre-approval write lock, UI approval, and unresolved review annotations
 */
export function createDemoSpecState(): SpecStateFile {
  const now = Date.now();
  const iso = (offsetMinutes: number) => new Date(now - offsetMinutes * 60_000).toISOString();

  const oauthPlanV1 = [
    '# OAuth2 Refresh Token Rotation & Replay Guard',
    '> Mode: BROWNFIELD DELTA SPEC',
    '',
    '## Context & Behavioral Delta',
    '- [ADDED] (auth/db) Add token_family_id and revoked_at columns to refresh_tokens.',
    '- [MODIFIED] (auth/service) Mint single-use child refresh token on every /oauth/token refresh.',
    '- [REMOVED] (auth/session) Remove legacy static 30-day multi-use refresh token path.',
    '',
    '## Implementation Plan',
    '1. Create migration adding token_family_id and revoked_at indexes.',
    '2. Update AuthTokenService.refresh() to rotate token inside a serializable transaction.',
    '3. Sync rotated sessions to Redis pub/sub cluster for instant edge invalidation.',
    '4. Log raw refresh token prefix and user email on replay anomaly for triage.',
    '5. Run integration replay test suite and canary checklist.',
    '',
    '## Rollback Strategy',
    '- Keep dual-read compatibility flag `OAUTH_ROTATION_V2` for 7 days.',
  ].join('\n');

  const oauthPlanV2 = [
    '# OAuth2 Refresh Token Rotation & Replay Guard',
    '> Mode: BROWNFIELD DELTA SPEC',
    '',
    '## Context & Behavioral Delta',
    '- [ADDED] (auth/db) Add token_family_id and revoked_at columns to refresh_tokens.',
    '- [ADDED] (auth/telemetry) Emit secret-redacted replay anomaly counter & family revocation audit log.',
    '- [MODIFIED] (auth/service) Mint single-use child refresh token inside an atomic transaction on /oauth/token refresh.',
    '- [REMOVED] (auth/session) Remove legacy static 30-day multi-use refresh token path.',
    '',
    '## Implementation Plan',
    '1. Create non-blocking migration adding token_family_id and revoked_at indexes.',
    '2. Update AuthTokenService.refresh() to rotate token atomically and revoke the family on reuse.',
    '3. Emit structured, secret-redacted telemetry events (family_id hash only — zero raw tokens or emails).',
    '4. Execute concurrent refresh race tests, rollback drill, and canary rollout checklist.',
    '',
    '## Rollback Strategy',
    '- Keep dual-read compatibility flag `OAUTH_ROTATION_V2` for 7 days with instant fallback.',
    '- Verify p99 token refresh latency stays under 35ms before removing legacy index.',
  ].join('\n');

  const approvedSpec: SpecDocument = {
    id: 'spec-oauth-refresh-rotation',
    title: 'OAuth2 Refresh Token Rotation & Replay Guard',
    goal: 'Implement rolling refresh token families with automatic replay revocation and backward-compatible session cookie migration.',
    mode: 'delta',
    deltaItems: [
      {
        id: 'delta-oauth-1',
        kind: 'added',
        area: 'auth/db',
        text: 'Add token_family_id index and nullable revoked_at column on refresh_tokens.',
      },
      {
        id: 'delta-oauth-2',
        kind: 'added',
        area: 'auth/telemetry',
        text: 'Emit secret-redacted replay anomaly audit events with hashed family_id.',
      },
      {
        id: 'delta-oauth-3',
        kind: 'modified',
        area: 'auth/service',
        text: 'Rotate refresh tokens atomically per request and revoke entire family on reuse.',
      },
      {
        id: 'delta-oauth-4',
        kind: 'removed',
        area: 'auth/session',
        text: 'Deprecate and remove legacy static multi-use 30-day refresh token path.',
      },
    ],
    planMarkdown: oauthPlanV2,
    revision: 2,
    revisions: [
      {
        revision: 1,
        planMarkdown: oauthPlanV1,
        updatedAt: iso(55),
        summary: 'Initial brownfield delta draft for refresh token rotation',
      },
      {
        revision: 2,
        planMarkdown: oauthPlanV2,
        updatedAt: iso(44),
        summary: 'Removed Redis pub/sub scope and enforced redacted telemetry',
      },
    ],
    annotations: [
      {
        id: 'ann_demo_resolved_1',
        revision: 1,
        lineStart: 12,
        lineEnd: 12,
        kind: 'strike',
        note: 'Cut Redis pub/sub cluster sync out of phase 1 — transactional DB revocation is sufficient.',
        resolved: true,
        createdAt: iso(50),
        resolvedAt: iso(44),
      },
      {
        id: 'ann_demo_open_1',
        revision: 2,
        lineStart: 17,
        lineEnd: 18,
        kind: 'comment',
        note: 'Please add explicit canary abort threshold (e.g. >0.5% unexpected family revocations) before GA.',
        resolved: false,
        createdAt: iso(15),
      },
    ],
    acceptanceCriteria: [
      'Every refresh call mints a single-use child token and invalidates its immediate parent.',
      'Replaying a previously rotated token revokes the entire token family and logs a redacted audit event.',
      'All unit and integration tests pass with zero breaking changes to active sessions.',
    ],
    planSteps: [
      'Add token_family_id and revoked_at columns with non-blocking migration.',
      'Implement atomic rotation and reuse detection in AuthTokenService.',
      'Emit structured, secret-redacted telemetry events for rotation and replay anomalies.',
      'Execute integration suite and canary rollout verification checklist.',
    ],
    status: 'approved',
    enforcePlanBeforeWrite: true,
    requireUiApproval: false,
    approvedBy: 'user',
    approvedAt: iso(42),
    approvalNote: 'Approved schema design and rollback guardrails.',
    tasks: [
      {
        id: 'schema-migration',
        title: 'Define refresh token family schema & migration',
        description: 'Add token_family_id index and nullable revoked_at timestamp.',
        dependsOn: [],
        status: 'done',
        note: 'Migration verified cleanly on SQLite & Postgres fixtures.',
        updatedAt: iso(35),
      },
      {
        id: 'rotation-service',
        title: 'Implement atomic rotation & replay revocation',
        description: 'Rotate refresh token inside transaction and revoke family on reuse.',
        dependsOn: ['schema-migration'],
        status: 'in_progress',
        note: 'Core transaction path complete; finishing race-condition test.',
        updatedAt: iso(12),
      },
      {
        id: 'audit-telemetry',
        title: 'Add redacted security telemetry & metrics',
        description: 'Record family revocations without logging raw tokens or JWT payloads.',
        dependsOn: ['schema-migration'],
        status: 'pending',
        updatedAt: iso(35),
      },
      {
        id: 'integration-canary',
        title: 'Run end-to-end replay suite & canary checklist',
        description: 'Verify concurrent refresh races, rollback script, and latency budget.',
        dependsOn: ['rotation-service', 'audit-telemetry'],
        status: 'pending',
        updatedAt: iso(35),
      },
    ],
    createdAt: iso(55),
    updatedAt: iso(12),
  };

  const webhookPlanV1 = [
    '# Idempotent Billing Webhook Processor',
    '> Mode: FULL SPEC',
    '',
    '## Goal',
    'Guarantee exactly-once invoice state transitions with HMAC validation and dead-letter retries.',
    '',
    '## Implementation Plan',
    '1. Verify webhook HMAC signature on parsed JSON body.',
    '2. Store processed event_id in an in-memory LRU cache.',
    '3. Build custom admin dashboard UI for manual DLQ replays.',
    '4. Add duplicate & out-of-order webhook integration tests.',
  ].join('\n');

  const webhookPlanV2 = [
    '# Idempotent Billing Webhook Processor',
    '> Mode: FULL SPEC',
    '',
    '## Goal',
    'Guarantee exactly-once invoice state transitions with HMAC signature validation and bounded dead-letter retries.',
    '',
    '## Implementation Plan',
    '1. Add raw-body HMAC verification middleware with constant-time digest comparison and 5-minute timestamp window.',
    '2. Introduce persistent idempotency ledger table keyed by (provider, event_id) with 30-day TTL cleanup.',
    '3. Build custom admin dashboard UI for manual DLQ replays.',
    '4. Add automated replay tests for duplicate and out-of-order invoice webhooks.',
  ].join('\n');

  const draftSpec: SpecDocument = {
    id: 'spec-billing-webhook-idempotency',
    title: 'Idempotent Billing Webhook Processor',
    goal: 'Guarantee exactly-once invoice state transitions with HMAC signature validation and bounded dead-letter retries.',
    mode: 'full',
    deltaItems: [],
    planMarkdown: webhookPlanV2,
    revision: 2,
    revisions: [
      {
        revision: 1,
        planMarkdown: webhookPlanV1,
        updatedAt: iso(25),
        summary: 'Initial webhook processor draft',
      },
      {
        revision: 2,
        planMarkdown: webhookPlanV2,
        updatedAt: iso(18),
        summary: 'Switched to raw-body constant-time HMAC and persistent idempotency ledger',
      },
    ],
    annotations: [
      {
        id: 'ann_demo_draft_strike',
        revision: 2,
        lineStart: 10,
        lineEnd: 10,
        kind: 'strike',
        note: 'Cut the custom admin dashboard UI from this milestone — expose CLI replay command only.',
        resolved: false,
        createdAt: iso(16),
      },
      {
        id: 'ann_demo_draft_replace',
        revision: 2,
        lineStart: 9,
        lineEnd: 9,
        kind: 'replace',
        note: 'Use UNIQUE constraint instead of read-then-write check to avoid concurrent races.',
        suggestedText:
          '2. Introduce idempotency_ledger table with UNIQUE(provider, event_id) insert-on-conflict and 30-day TTL cleanup.',
        resolved: false,
        createdAt: iso(14),
      },
    ],
    acceptanceCriteria: [
      'Reject invalid or stale webhook signatures before touching application state.',
      'Deduplicate retried provider deliveries using composite (provider, event_id) keys.',
      'Surface poison events in a replayable dead-letter queue with redacted payloads.',
    ],
    planSteps: [
      'Add raw-body HMAC verification middleware with constant-time digest comparison.',
      'Introduce idempotency ledger table and transactional handler wrapper.',
      'Add automated replay tests for duplicate and out-of-order invoice webhooks.',
    ],
    status: 'draft',
    enforcePlanBeforeWrite: true,
    requireUiApproval: true,
    tasks: [
      {
        id: 'hmac-guard',
        title: 'Implement constant-time HMAC webhook signature guard',
        dependsOn: [],
        status: 'pending',
        updatedAt: iso(18),
      },
      {
        id: 'idempotency-ledger',
        title: 'Persist provider event idempotency ledger with TTL cleanup',
        dependsOn: ['hmac-guard'],
        status: 'pending',
        updatedAt: iso(18),
      },
      {
        id: 'webhook-replay-tests',
        title: 'Add duplicate & out-of-order webhook integration tests',
        dependsOn: ['idempotency-ledger'],
        status: 'pending',
        updatedAt: iso(18),
      },
    ],
    createdAt: iso(25),
    updatedAt: iso(18),
  };

  return {
    schemaVersion: 1,
    activeSpecId: approvedSpec.id,
    specs: [approvedSpec, draftSpec],
    updatedAt: iso(12),
  };
}
