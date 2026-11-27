import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { assertValidModuleRegistration } from '../src/core/module-contract.js';
import {
  detectHighConfidenceSecrets,
  isSensitivePathSegment,
  redactPemBlocksLinear,
  redactSecretsLinear,
  stripPrivateBlocksLinear,
  stripPrivateBlocksWithStats,
  truncateUtf16Safe,
} from '../src/core/sanitize.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function walkSourceFiles(dir: string, exts: ReadonlySet<string>): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkSourceFiles(abs, exts));
    } else if (entry.isFile() && exts.has(path.extname(entry.name))) {
      results.push(abs);
    }
  }
  return results;
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importRe = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(source)) !== null) {
    if (m[1]) specifiers.push(m[1]);
  }
  while ((m = dynamicRe.exec(source)) !== null) {
    if (m[1]) specifiers.push(m[1]);
  }
  return specifiers;
}

describe('Architecture Layer Hygiene & Dependency Boundaries', () => {
  it('enforces strict one-way dependency: src/core/* never imports modules, server, hooks, or ui', () => {
    const coreDir = path.join(REPO_ROOT, 'src', 'core');
    const files = walkSourceFiles(coreDir, new Set(['.ts', '.tsx']));
    assert.ok(files.length >= 6, 'expected core kernel files');

    const violations: string[] = [];
    for (const file of files) {
      const rel = path.relative(REPO_ROOT, file);
      const specs = extractImportSpecifiers(fs.readFileSync(file, 'utf8'));
      for (const spec of specs) {
        if (!spec.startsWith('.')) continue;
        const resolved = path.resolve(path.dirname(file), spec.replace(/\.js$/, '.ts'));
        const resolvedRel = path.relative(REPO_ROOT, resolved).replace(/\\/g, '/');
        if (
          resolvedRel.startsWith('src/modules/') ||
          resolvedRel.startsWith('src/server/') ||
          resolvedRel.startsWith('src/hooks/') ||
          resolvedRel.startsWith('ui/')
        ) {
          violations.push(`${rel} -> ${spec} (${resolvedRel})`);
        }
      }
    }

    assert.deepEqual(violations, [], `Layer 1 (src/core) reverse imports detected:\n${violations.join('\n')}`);
  });

  it('enforces browser sandbox isolation: ui/src/* never imports node:* or src/server|hooks|modules', () => {
    const uiDir = path.join(REPO_ROOT, 'ui', 'src');
    const files = walkSourceFiles(uiDir, new Set(['.ts', '.tsx']));
    assert.ok(files.length >= 10, 'expected ui source files');

    const violations: string[] = [];
    for (const file of files) {
      const rel = path.relative(REPO_ROOT, file);
      const specs = extractImportSpecifiers(fs.readFileSync(file, 'utf8'));
      for (const spec of specs) {
        if (spec.startsWith('node:')) {
          violations.push(`${rel} imports Node built-in ${spec}`);
        }
        if (spec.includes('../src/server') || spec.includes('../src/hooks') || spec.includes('../src/modules')) {
          violations.push(`${rel} imports backend code ${spec}`);
        }
      }
    }

    assert.deepEqual(violations, [], `Layer 4 (ui/src) isolation violations:\n${violations.join('\n')}`);
  });

  it('enforces Layer 2 boundary: src/modules/* never imports src/server/*, src/hooks/*, or ui/*', () => {
    const modulesDir = path.join(REPO_ROOT, 'src', 'modules');
    const files = walkSourceFiles(modulesDir, new Set(['.ts', '.tsx']));
    assert.ok(files.length >= 20, 'expected domain module source files');

    const violations: string[] = [];
    for (const file of files) {
      const rel = path.relative(REPO_ROOT, file);
      const specs = extractImportSpecifiers(fs.readFileSync(file, 'utf8'));
      for (const spec of specs) {
        if (!spec.startsWith('.')) continue;
        const resolved = path.resolve(path.dirname(file), spec.replace(/\.js$/, '.ts'));
        const resolvedRel = path.relative(REPO_ROOT, resolved).replace(/\\/g, '/');
        if (
          resolvedRel.startsWith('src/server/') ||
          resolvedRel.startsWith('src/hooks/') ||
          resolvedRel.startsWith('ui/')
        ) {
          violations.push(`${rel} -> ${spec} (${resolvedRel})`);
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Layer 2 (src/modules) upward imports detected:\n${violations.join('\n')}`,
    );
  });

  it('enforces zero circular dependencies across src/core/*, src/modules/*, src/hooks/*, and src/server/*', () => {
    const roots = [
      path.join(REPO_ROOT, 'src', 'core'),
      path.join(REPO_ROOT, 'src', 'modules'),
      path.join(REPO_ROOT, 'src', 'hooks'),
      path.join(REPO_ROOT, 'src', 'server'),
    ];
    const allFiles = roots.flatMap((r) => walkSourceFiles(r, new Set(['.ts'])));
    const fileSet = new Set(allFiles);
    const graph = new Map<string, string[]>();

    for (const file of allFiles) {
      const deps: string[] = [];
      for (const spec of extractImportSpecifiers(fs.readFileSync(file, 'utf8'))) {
        if (!spec.startsWith('.')) continue;
        const resolved = path.resolve(path.dirname(file), spec.replace(/\.js$/, '.ts'));
        if (fileSet.has(resolved)) {
          deps.push(resolved);
        }
      }
      graph.set(file, deps);
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const cycles: string[] = [];

    const dfs = (node: string, stack: string[]) => {
      visiting.add(node);
      stack.push(node);
      for (const dep of graph.get(node) ?? []) {
        if (visiting.has(dep)) {
          const idx = stack.indexOf(dep);
          const cyclePath = [...stack.slice(idx), dep]
            .map((p) => path.relative(REPO_ROOT, p).replace(/\\/g, '/'))
            .join(' -> ');
          cycles.push(cyclePath);
        } else if (!visited.has(dep)) {
          dfs(dep, stack);
        }
      }
      stack.pop();
      visiting.delete(node);
      visited.add(node);
    };

    for (const file of allFiles) {
      if (!visited.has(file)) {
        dfs(file, []);
      }
    }

    assert.deepEqual(cycles, [], `Circular module dependencies detected:\n${cycles.join('\n')}`);
  });

  it('verifies architecture & contributor documentation exist and stay readable', () => {
    const archDoc = path.join(REPO_ROOT, 'docs', 'ARCHITECTURE.md');
    const contribDoc = path.join(REPO_ROOT, 'CONTRIBUTING.md');
    assert.ok(fs.existsSync(archDoc), 'docs/ARCHITECTURE.md must exist');
    assert.ok(fs.existsSync(contribDoc), 'CONTRIBUTING.md must exist');
    assert.match(fs.readFileSync(archDoc, 'utf8'), /sanitize\.ts/);
    assert.match(fs.readFileSync(contribDoc, 'utf8'), /npm test/);
  });

  it('validates module registration contracts via assertValidModuleRegistration', () => {
    assert.doesNotThrow(() =>
      assertValidModuleRegistration(
        {
          moduleId: 'review',
          modelTools: [{ name: 'nov_review_diff', enable() {}, disable() {} }],
          appTools: [],
        },
        'review',
      ),
    );
    assert.throws(() =>
      assertValidModuleRegistration(
        {
          moduleId: 'guard',
          modelTools: [],
          appTools: [],
        },
        'review',
      ),
    );
    assert.throws(() =>
      assertValidModuleRegistration(
        {
          moduleId: 'review',
          modelTools: null as unknown as [],
          appTools: [],
        },
        'review',
      ),
    );
  });
});

describe('Unified Core Sanitization Kernel (src/core/sanitize.ts)', () => {
  it('strips nested, case-insensitive, self-closing, and unclosed <private> blocks in O(n)', () => {
    const nested = stripPrivateBlocksWithStats(
      'public <PRIVATE id="1">top <private>inner</private> tail</PRIVATE> visible',
      '[HIDDEN]',
    );
    assert.equal(nested.text, 'public [HIDDEN] visible');
    assert.equal(nested.strippedCount, 1);
    assert.equal(nested.hasUnclosedTag, false);

    const unclosed = stripPrivateBlocksWithStats('safe <private>secret never closed', '[HIDDEN]');
    assert.equal(unclosed.text, 'safe [HIDDEN]');
    assert.equal(unclosed.hasUnclosedTag, true);

    const malformed = stripPrivateBlocksLinear('safe <private <tag>keep</tag>');
    assert.equal(malformed, 'safe <private <tag>keep</tag>');

    const selfClosing = stripPrivateBlocksWithStats('a<private/>b', '[X]');
    assert.equal(selfClosing.text, 'a[X]b');
    assert.equal(selfClosing.strippedCount, 1);
  });

  it('redacts complete and truncated PEM/PGP private key blocks without backtracking', () => {
    const pemStart = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ');
    const pemEnd = ['-----END', 'RSA PRIVATE KEY-----'].join(' ');
    const full = `before ${pemStart}\nMIIEowIBAAKCAQEAtest\n${pemEnd} after`;
    assert.equal(redactPemBlocksLinear(full), 'before [REDACTED_PRIVATE_KEY] after');

    const truncated = `before ${pemStart}\nMIIEowIBAAKCAQEAstill-secret\n\nmore-key-material`;
    assert.equal(redactPemBlocksLinear(truncated), 'before [REDACTED_PRIVATE_KEY]');
  });

  it('redacts tokens, webhooks, basic auth, JWTs, and env vars linearly under heavy input', () => {
    const fakeGitHub = ['ghp', '_1234567890abcdefghijklmnop123456'].join('');
    const fakeOpenAi = ['sk-proj-', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'].join('');
    const fakeUrl = 'https://alice:superpass@example.com/api?token=abc123&ok=1';
    const sample = `token=${fakeGitHub} key=${fakeOpenAi} url=${fakeUrl} OPENAI_API_KEY=secretval123`;
    const clean = redactSecretsLinear(sample);
    assert.ok(!clean.includes(fakeGitHub));
    assert.ok(!clean.includes(fakeOpenAi));
    assert.ok(!clean.includes('superpass'));
    assert.ok(!clean.includes('abc123'));
    assert.ok(!clean.includes('secretval123'));

    // ReDoS stress test (100 KB hostile repeated pattern completes well within 200ms)
    const hostile = 'https://'.repeat(12_000) + '<private>'.repeat(1000);
    const t0 = Date.now();
    const out = redactSecretsLinear(hostile, { stripPrivate: true });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 500, `Expected linear O(n) redaction (<500ms), took ${elapsed}ms`);
    assert.ok(out.length <= hostile.length);
  });

  it('detects high-confidence inbound secrets returning only rule metadata (never raw secrets)', () => {
    const fakeAws = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    const fakeAnthropic = ['sk-ant-', 'api03-1234567890abcdefghij123456'].join('');
    const matches = detectHighConfidenceSecrets(`please use ${fakeAws} and ${fakeAnthropic}`);
    const ids = matches.map((m) => m.ruleId);
    assert.ok(ids.includes('inbound.aws-access-key'));
    assert.ok(ids.includes('inbound.openai-anthropic-key'));
    assert.ok(!JSON.stringify(matches).includes(fakeAws));
    assert.ok(!JSON.stringify(matches).includes(fakeAnthropic));

    assert.deepEqual(detectHighConfidenceSecrets('normal code discussion without secrets'), []);
  });

  it('identifies sensitive paths while permitting .env.example templates and preserves UTF-16 pairs', () => {
    assert.equal(isSensitivePathSegment('.env'), true);
    assert.equal(isSensitivePathSegment('config/.env.production'), true);
    assert.equal(isSensitivePathSegment('.env.example'), false);
    assert.equal(isSensitivePathSegment('/home/dev/.ssh/id_ed25519'), true);
    assert.equal(isSensitivePathSegment('src/index.ts'), false);

    // Emoji U+1F680 occupies 2 UTF-16 code units; truncating at length 3 must not split surrogate pair
    const truncated = truncateUtf16Safe('A🚀B', 3, '…');
    assert.ok(!/[\uD800-\uDBFF]$/.test(truncated.slice(0, -1)));
  });
});
