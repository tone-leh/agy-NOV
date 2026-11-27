import { extractCodeSnippet, parseUnifiedDiff } from './diff-parser.js';
import type { DiffFile, ReviewAnnotation, ReviewScope, ReviewSession } from './types.js';

export const DEMO_REPO_KEY = 'demo-agy-review-01';
export const DEMO_REPO_PATH = '/workspace/acme-auth-service';

const DEMO_UNIFIED_DIFF = `diff --git a/src/auth/token-middleware.ts b/src/auth/token-middleware.ts
index 8e11c20..f72a903 100644
--- a/src/auth/token-middleware.ts
+++ b/src/auth/token-middleware.ts
@@ -1,18 +1,48 @@
 import type { IncomingMessage, ServerResponse } from 'node:http';
 import { verifyJwt } from './jwt.js';
+import rateLimitConfig from '../config/rate-limit.json' with { type: 'json' };
 
 export interface AuthContext {
   userId: string;
   role: 'admin' | 'member';
+  sessionId: string;
+}
+const attemptWindow = new Map<string, { count: number; resetAt: number }>();
+
+function checkRateLimit(clientIp: string): boolean {
+  const now = Date.now();
+  const entry = attemptWindow.get(clientIp);
+  if (!entry || entry.resetAt <= now) {
+    attemptWindow.set(clientIp, { count: 1, resetAt: now + rateLimitConfig.windowMs });
+    return true;
+  }
+  entry.count += 1;
+  return entry.count <= rateLimitConfig.maxRequests;
 }
 
 export async function requireAuth(
   req: IncomingMessage,
   res: ServerResponse,
 ): Promise<AuthContext | null> {
-  const header = req.headers.authorization;
-  if (!header?.startsWith('Bearer ')) {
+  const clientIp = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown');
+  if (!checkRateLimit(clientIp)) {
+    res.writeHead(429, { 'Content-Type': 'application/json' });
+    res.end(JSON.stringify({ error: 'Too many requests' }));
+    return null;
+  }
+
+  const header = req.headers.authorization ?? '';
+  const queryToken = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token');
+  const rawToken = header.startsWith('Bearer ') ? header.slice(7).trim() : queryToken;
+  if (!rawToken) {
     res.writeHead(401, { 'Content-Type': 'application/json' });
     res.end(JSON.stringify({ error: 'Unauthorized' }));
     return null;
   }
-  const payload = await verifyJwt(header.slice(7).trim());
-  return { userId: payload.sub, role: payload.role };
+  try {
+    const payload = await verifyJwt(rawToken);
+    return { userId: payload.sub, role: payload.role, sessionId: payload.sid ?? 'legacy' };
+  } catch {
+    return { userId: 'guest', role: 'member', sessionId: 'fallback' };
+  }
 }
diff --git a/src/config/rate-limit.json b/src/config/rate-limit.json
new file mode 100644
index 0000000..4bc19ea
--- /dev/null
+++ b/src/config/rate-limit.json
@@ -0,0 +1,8 @@
+{
+  "windowMs": 60000,
+  "maxRequests": 120,
+  "burstMultiplier": 1.5,
+  "trustProxyHeader": true,
+  "excludePaths": ["/healthz", "/metrics"]
+}
diff --git a/test/token-middleware.test.ts b/test/token-middleware.test.ts
index 241b001..99c3e84 100644
--- a/test/token-middleware.test.ts
+++ b/test/token-middleware.test.ts
@@ -12,7 +12,24 @@ describe('requireAuth middleware', () => {
     assert.equal(ctx, null);
     assert.equal(res.statusCode, 401);
   });
-});
 
-export {};
+  it('returns 429 when rate limit threshold is exceeded', async () => {
+    let lastCode = 200;
+    for (let i = 0; i < 125; i++) {
+      const res = createMockResponse();
+      await requireAuth(createMockRequest({ ip: '10.0.0.8' }), res);
+      lastCode = res.statusCode;
+    }
+    assert.equal(lastCode, 429);
+  });
+
+  it('attaches sessionId from verified JWT payload', async () => {
+    const res = createMockResponse();
+    const ctx = await requireAuth(
+      createMockRequest({ authorization: 'Bearer valid-jwt-token' }),
+      res,
+    );
+    assert.equal(ctx?.sessionId, 'sess_94a1');
+  });
+});
`;

export function buildDemoFiles(): DiffFile[] {
  const parsed = parseUnifiedDiff(DEMO_UNIFIED_DIFF, { repoPath: DEMO_REPO_PATH });
  return parsed.files;
}

export function buildDemoSeedAnnotations(files: DiffFile[], scope: ReviewScope = 'working'): ReviewAnnotation[] {
  const authFile = files.find((f) => f.path === 'src/auth/token-middleware.ts');
  const now = '2026-11-26T10:15:00.000Z';

  return [
    {
      id: 'ann_demo_sec_01',
      repoKey: DEMO_REPO_KEY,
      scope,
      filePath: 'src/auth/token-middleware.ts',
      side: 'new',
      startLine: 35,
      endLine: 37,
      category: 'security',
      comment:
        'Remove query string `token` fallback: bearer tokens in URLs leak into reverse-proxy logs, browser history, and Referer headers. Accept tokens strictly via the Authorization header.',
      codeSnippet: extractCodeSnippet(authFile, 35, 37, 'new'),
      fileFingerprint: authFile?.fingerprint,
      resolved: false,
      stale: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ann_demo_bug_02',
      repoKey: DEMO_REPO_KEY,
      scope,
      filePath: 'src/auth/token-middleware.ts',
      side: 'new',
      startLine: 45,
      endLine: 47,
      category: 'bug',
      comment:
        'Catching JWT verification errors and returning a `guest` AuthContext bypasses authentication on expired or forged tokens. Respond with HTTP 401 and return `null` instead.',
      codeSnippet: extractCodeSnippet(authFile, 45, 47, 'new'),
      fileFingerprint: authFile?.fingerprint,
      resolved: false,
      stale: false,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function createDemoSession(scope: ReviewScope = 'working'): ReviewSession {
  const files = buildDemoFiles();
  const annotations = buildDemoSeedAnnotations(files, scope);
  return {
    repoPath: DEMO_REPO_PATH,
    repoName: 'acme-auth-service (Demo)',
    repoKey: DEMO_REPO_KEY,
    branch: 'feat/token-refresh-guard',
    headCommit: 'f72a903',
    scope,
    isGitRepo: true,
    isDemo: true,
    notice: 'Demo mode active — showcasing a realistic 3-file PR diff with pre-seeded inline annotations.',
    generatedAt: new Date().toISOString(),
    totalFiles: files.length,
    totalAdditions: files.reduce((s, f) => s + f.additions, 0),
    totalDeletions: files.reduce((s, f) => s + f.deletions, 0),
    truncated: false,
    files,
    viewedFiles: ['test/token-middleware.test.ts'],
    annotations,
    signal: {
      lastEvent: 'PostToolUse',
      lastToolName: 'edit_file',
      lastWriteAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      changeCount: 3,
      workspacePaths: [DEMO_REPO_PATH],
    },
  };
}
