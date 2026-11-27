import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MODULE_CATALOG } from '../src/core/config.js';
import { buildContextPack, matchSimpleGlob, redactCodeTextLinear } from '../src/modules/turbo/context-pack.js';
import { TURBO_MAX_TOOL_TEXT_BYTES } from '../src/modules/turbo/core.js';
import { inspectLockedDepContract } from '../src/modules/turbo/dep-contract.js';
import { findSymbolReferences } from '../src/modules/turbo/references.js';
import { registerTurboModule } from '../src/modules/turbo/register.js';
import { createNovServer } from '../src/server/index.js';
import { createDirSymlink } from './helpers/cross-platform.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

function hasLoneSurrogate(str: string): boolean {
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = str.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe('v0.8.0 Turbo 3.0 — Offline Dep-Contract Inspector', () => {
  it('inspects real local node_modules/zod offline, extracts version + .d.ts signatures, and applies symbolFilter', () => {
    const repoRoot = process.cwd();
    const res = inspectLockedDepContract(repoRoot, 'zod');
    assert.equal(res.found, true);
    assert.equal(res.ecosystem, 'node');
    assert.equal(res.packageName, 'zod');
    assert.ok(res.version && /^\d+\.\d+\.\d+/.test(res.version), `Expected semver version, got ${res.version}`);
    assert.ok(res.entryFile && res.entryFile.includes('zod'));
    assert.ok(res.signatures.length > 0, 'Expected concrete .d.ts exported signatures from local zod');
    assert.ok(res.totalBytes <= TURBO_MAX_TOOL_TEXT_BYTES);
    assert.equal(Buffer.byteLength(res.snippet, 'utf8'), res.totalBytes);
    assert.equal(hasLoneSurrogate(res.snippet), false);

    const filtered = inspectLockedDepContract(repoRoot, 'zod', { symbolFilter: 'toJSONSchema' });
    assert.equal(filtered.found, true);
    assert.ok(filtered.signatures.length > 0);
    assert.ok(filtered.signatures.every((s) => s.signature.toLowerCase().includes('tojsonschema')));
  });

  it('rejects path traversal (..), absolute paths, control chars, and symlink escapes outside workspace', async () => {
    await withTempDir('agy-nov-v08-dep-sec-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'ws');
      const outside = path.join(tmpDir, 'outside-secret-pkg');
      fs.mkdirSync(path.join(workspace, 'node_modules'), { recursive: true });
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(
        path.join(outside, 'package.json'),
        JSON.stringify({ name: 'evil-pkg', version: '9.9.9', types: 'index.d.ts' }),
        'utf8',
      );
      fs.writeFileSync(path.join(outside, 'index.d.ts'), 'export function leakSecret(): string;\n', 'utf8');

      // Symlink package directory escaping workspace
      createDirSymlink(outside, path.join(workspace, 'node_modules', 'evil-pkg'));

      // Package inside workspace whose index.d.ts symlinks outside
      const innerPkg = path.join(workspace, 'node_modules', 'tricky-pkg');
      fs.mkdirSync(innerPkg, { recursive: true });
      fs.writeFileSync(
        path.join(innerPkg, 'package.json'),
        JSON.stringify({ name: 'tricky-pkg', version: '1.0.0', types: 'index.d.ts' }),
        'utf8',
      );
      fs.symlinkSync(path.join(outside, 'index.d.ts'), path.join(innerPkg, 'index.d.ts'));

      // Malformed / traversal package names
      assert.throws(() => inspectLockedDepContract(workspace, '../outside-secret-pkg'), /Invalid package name/);
      assert.throws(() => inspectLockedDepContract(workspace, '/etc/passwd'), /Invalid package name/);
      assert.throws(() => inspectLockedDepContract(workspace, 'foo\0bar'), /Invalid package name/);
      assert.throws(() => inspectLockedDepContract(workspace, 'foo/../../bar'), /Invalid package name/);

      // Symlink escape interceptions
      assert.throws(() => inspectLockedDepContract(workspace, 'evil-pkg'), /escapes workspace boundary/i);
      assert.throws(() => inspectLockedDepContract(workspace, 'tricky-pkg'), /escapes workspace boundary/i);

      // Intra-workspace symlink escape: package inside node_modules linking to workspace .env
      fs.writeFileSync(path.join(workspace, '.env'), 'DATABASE_URL=postgres://secret:pass@localhost/db\n', 'utf8');
      const intraPkg = path.join(workspace, 'node_modules', 'intra-leak-pkg');
      fs.mkdirSync(intraPkg, { recursive: true });
      fs.writeFileSync(
        path.join(intraPkg, 'package.json'),
        JSON.stringify({ name: 'intra-leak-pkg', version: '1.0.0', types: 'index.d.ts' }),
        'utf8',
      );
      fs.symlinkSync(path.join(workspace, '.env'), path.join(intraPkg, 'index.d.ts'));
      assert.throws(
        () => inspectLockedDepContract(workspace, 'intra-leak-pkg'),
        /escapes package boundary|sensitive path/i,
      );
    });
  });

  it('enforces <=8.8KB UTF-8 safe truncation on huge .d.ts contracts and parses Python/Go/Rust ecosystems', async () => {
    await withTempDir('agy-nov-v08-dep-multi-', async (tmpDir) => {
      // 1. Oversized Node .d.ts with multi-byte Chinese/Emoji comments & signatures
      const nodePkg = path.join(tmpDir, 'node_modules', '@acme', 'huge-sdk');
      fs.mkdirSync(nodePkg, { recursive: true });
      fs.writeFileSync(
        path.join(nodePkg, 'package.json'),
        JSON.stringify({ name: '@acme/huge-sdk', version: '2.4.1', types: 'index.d.ts' }),
        'utf8',
      );
      const hugeDts = Array.from(
        { length: 120 },
        (_, i) =>
          `export function executeContractStep_${i}(payload: Record<string, "${'中文契约🚀'.repeat(12)}">): Promise<number>;`,
      ).join('\n');
      fs.writeFileSync(path.join(nodePkg, 'index.d.ts'), hugeDts, 'utf8');

      const hugeRes = inspectLockedDepContract(tmpDir, '@acme/huge-sdk');
      assert.equal(hugeRes.found, true);
      assert.equal(hugeRes.ecosystem, 'node');
      assert.equal(hugeRes.version, '2.4.1');
      assert.equal(hugeRes.truncated, true);
      assert.ok(hugeRes.totalBytes <= TURBO_MAX_TOOL_TEXT_BYTES);
      assert.equal(Buffer.byteLength(hugeRes.snippet, 'utf8'), hugeRes.totalBytes);
      assert.equal(hugeRes.snippet.includes('\uFFFD'), false);
      assert.equal(hasLoneSurrogate(hugeRes.snippet), false);

      // 2. Python (.venv site-packages + METADATA + __init__.pyi)
      const sitePkgs = path.join(tmpDir, '.venv', 'lib', 'python3.12', 'site-packages');
      fs.mkdirSync(path.join(sitePkgs, 'fast_client'), { recursive: true });
      fs.mkdirSync(path.join(sitePkgs, 'fast_client-1.8.2.dist-info'), { recursive: true });
      fs.writeFileSync(
        path.join(sitePkgs, 'fast_client-1.8.2.dist-info', 'METADATA'),
        'Metadata-Version: 2.1\nName: fast-client\nVersion: 1.8.2\nSummary: Offline test python client\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(sitePkgs, 'fast_client', '__init__.pyi'),
        [
          'class ClientSession:',
          '    def close(self) -> None: ...',
          'async def fetch_json(url: str, timeout: float = 5.0) -> dict: ...',
          'def build_headers(token: str) -> dict[str, str]: ...',
        ].join('\n'),
        'utf8',
      );

      const pyRes = inspectLockedDepContract(tmpDir, 'fast-client');
      assert.equal(pyRes.found, true);
      assert.equal(pyRes.ecosystem, 'python');
      assert.equal(pyRes.version, '1.8.2');
      assert.ok(pyRes.signatures.some((s) => s.kind === 'class' && s.signature.includes('ClientSession')));
      assert.ok(pyRes.signatures.some((s) => s.kind === 'def' && s.signature.includes('fetch_json')));

      // 3. Go (go.mod)
      fs.writeFileSync(
        path.join(tmpDir, 'go.mod'),
        [
          'module example.com/demo',
          'go 1.23.0',
          'require (',
          '  github.com/gin-gonic/gin v1.10.0',
          '  golang.org/x/sync v0.9.0 // indirect',
          ')',
        ].join('\n'),
        'utf8',
      );
      const goRes = inspectLockedDepContract(tmpDir, 'github.com/gin-gonic/gin');
      assert.equal(goRes.found, true);
      assert.equal(goRes.ecosystem, 'go');
      assert.equal(goRes.version, 'v1.10.0');
      assert.equal(goRes.entryFile, 'go.mod');

      // 4. Rust (Cargo.lock)
      fs.writeFileSync(
        path.join(tmpDir, 'Cargo.lock'),
        [
          'version = 3',
          '',
          '[[package]]',
          'name = "serde"',
          'version = "1.0.215"',
          'source = "registry+https://github.com/rust-lang/crates.io-index"',
          'dependencies = [',
          ' "serde_derive",',
          ']',
        ].join('\n'),
        'utf8',
      );
      const rustRes = inspectLockedDepContract(tmpDir, 'serde');
      assert.equal(rustRes.found, true);
      assert.equal(rustRes.ecosystem, 'rust');
      assert.equal(rustRes.version, '1.0.215');
      assert.equal(rustRes.entryFile, 'Cargo.lock');
      assert.ok(rustRes.signatures.some((s) => s.signature.includes('serde_derive')));
    });
  });
});

describe('v0.8.0 Turbo 3.0 — Lightweight Cross-File Symbol References', () => {
  it('classifies definitions, imports, and usages accurately while skipping comments, sensitive files, and symlinks', async () => {
    await withTempDir('agy-nov-v08-refs-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'ws');
      const outside = path.join(tmpDir, 'outside.ts');
      fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
      fs.writeFileSync(outside, 'export function computeScore() { return 999; }\n', 'utf8');

      // Definition file + partial identifier noise + single-line comment noise
      fs.writeFileSync(
        path.join(workspace, 'src', 'engine.ts'),
        [
          '// computeScore should be ignored in comments',
          'export function computeScore(items: number[]): number {',
          '  const computeScoreExtra = items.length;',
          '  return computeScoreExtra;',
          '}',
        ].join('\n'),
        'utf8',
      );

      // Importer + usage file (notice `const total = computeScore(...)` must be usage, not definition)
      fs.writeFileSync(
        path.join(workspace, 'src', 'consumer.ts'),
        [
          "import { computeScore } from './engine.js';",
          'export function runReport(vals: number[]) {',
          '  const total = computeScore(vals);',
          '  return total + computeScore([1]);',
          '}',
        ].join('\n'),
        'utf8',
      );

      // Sensitive file and symlink must be skipped
      fs.writeFileSync(path.join(workspace, '.env.local'), 'computeScore=LEAKED\n', 'utf8');
      fs.symlinkSync(outside, path.join(workspace, 'src', 'linked.ts'));

      const res = findSymbolReferences(workspace, 'computeScore');
      assert.equal(res.symbol, 'computeScore');
      assert.equal(res.definitions.length, 1);
      assert.equal(res.definitions[0]?.file, 'src/engine.ts');
      assert.equal(res.definitions[0]?.line, 2);

      assert.equal(res.imports.length, 1);
      assert.equal(res.imports[0]?.file, 'src/consumer.ts');
      assert.equal(res.imports[0]?.line, 1);

      assert.equal(res.usages.length, 2);
      assert.ok(res.usages.every((u) => u.file === 'src/consumer.ts'));
      assert.equal(res.totalHits, 4);

      // Ensure .env and symlinked outside file never leaked
      const allFiles = [...res.definitions, ...res.imports, ...res.usages].map((h) => h.file);
      assert.equal(allFiles.some((f) => f.includes('.env') || f.includes('linked.ts')), false);

      // Reject invalid / regex-metacharacter symbols
      assert.throws(() => findSymbolReferences(workspace, ''), /Invalid symbol identifier/);
      assert.throws(() => findSymbolReferences(workspace, '(a+)+$'), /Invalid symbol identifier/);
      assert.throws(() => findSymbolReferences(workspace, 'foo.bar'), /Invalid symbol identifier/);
      assert.throws(() => findSymbolReferences(workspace, '123abc'), /Invalid symbol identifier/);
    });
  });
});

describe('v0.8.0 Turbo 3.0 — Budgeted Secret-Redacted Context Pack', () => {
  it('redacts credentials in O(n), skips .env/binaries/symlinks, enforces maxTokens budget, and supports fromGitDiff', async () => {
    await withTempDir('agy-nov-v08-pack-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'repo');
      const outsideFile = path.join(tmpDir, 'outside.txt');
      fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
      fs.writeFileSync(outsideFile, 'outside secret content\n', 'utf8');

      // Dynamically construct synthetic fake secrets via Array.join to avoid literal secrets in source
      const fakeOpenAiKey = ['sk', 'proj', 'FakeDemoToken1234567890abcd'].join('-');
      const fakeJwt = [
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        'eyJzdWIiOiJkZW1vX3VzZXIifQ',
        'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      ].join('.');
      const fakePem = [
        ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' '),
        'MIIEFAKEKEYDATA000000000000000000000000',
        ['-----END', 'RSA PRIVATE KEY-----'].join(' '),
      ].join('\n');
      const fakeWebhook = ['https://hooks.slack.com', 'services', 'T00000000', 'B00000000', 'XXXXXXXXXXXXXXXXXXXX'].join('/');
      const fakePrivateBlock = ['<private>', 'top secret prompt data', '</private>'].join('');

      fs.writeFileSync(
        path.join(workspace, 'src', 'app.ts'),
        [
          `export const apiKey = "${fakeOpenAiKey}";`,
          `export const authHeader = "Bearer ${fakeJwt}";`,
          `export const hook = "${fakeWebhook}";`,
          `export const note = "${fakePrivateBlock}";`,
          `const pem = \`${fakePem}\`;`,
          'export function greet(name: string) { return `hi ${name}`; }',
        ].join('\n'),
        'utf8',
      );

      // Additional files: sensitive .env, binary file with NUL byte, symlink, and large normal file
      fs.writeFileSync(path.join(workspace, '.env'), `SECRET_KEY=${fakeOpenAiKey}\n`, 'utf8');
      fs.writeFileSync(path.join(workspace, 'src', 'image.bin'), Buffer.from([0x89, 0x50, 0x00, 0x47, 0x0d]));
      fs.symlinkSync(outsideFile, path.join(workspace, 'src', 'link.ts'));
      fs.writeFileSync(
        path.join(workspace, 'src', 'big.ts'),
        Array.from({ length: 180 }, (_, idx) => `export const ITEM_${idx} = "${'abcdef1234567890'.repeat(4)}";`).join('\n'),
        'utf8',
      );

      // Glob check (linear ReDoS-safe)
      assert.equal(matchSimpleGlob('src/app.ts', 'src/**/*.ts'), true);
      assert.equal(matchSimpleGlob('src/deep/nested/file.ts', 'src/**/*.ts'), true);
      assert.equal(matchSimpleGlob('src/image.bin', '*.ts'), false);

      // Redactor standalone sanity (including unquoted YAML/INI secret lines)
      const yamlSecret = ['my', 'unquoted', 'yaml', 'secret', '987654321'].join('_');
      const redCheck = redactCodeTextLinear(
        `const k = "${fakeOpenAiKey}";\n${fakePrivateBlock}\napi_key: ${yamlSecret}\nclient_secret=${yamlSecret}`,
      );
      assert.equal(redCheck.text.includes(fakeOpenAiKey), false);
      assert.equal(redCheck.text.includes('top secret prompt data'), false);
      assert.equal(redCheck.text.includes(yamlSecret), false, 'Unquoted YAML/INI secrets must be redacted');
      assert.ok(redCheck.redactions >= 4);

      // 1. Scope mode with tight token budget (forces truncation)
      const packed = buildContextPack(workspace, { scope: 'src', globs: ['**/*.ts'], maxTokens: 400 });
      assert.equal(packed.mode, 'scope');
      assert.equal(packed.truncated, true);
      assert.ok(packed.estimatedTokens <= 400, `Expected <= 400 tokens, got ${packed.estimatedTokens}`);
      assert.ok(packed.redactionCount >= 4);
      assert.equal(packed.markdown.includes(fakeOpenAiKey), false);
      assert.equal(packed.markdown.includes(fakeJwt), false);
      assert.equal(packed.markdown.includes('MIIEFAKEKEYDATA'), false);
      assert.equal(packed.markdown.includes(fakeWebhook), false);
      assert.equal(packed.markdown.includes('top secret prompt data'), false);
      assert.equal(packed.markdown.includes('[REDACTED_KEY]'), true);
      assert.equal(packed.markdown.includes('[REDACTED_PRIVATE]'), true);
      assert.equal(packed.markdown.includes('[REDACTED_PRIVATE_KEY]'), true);
      assert.equal(packed.markdown.includes('[REDACTED_WEBHOOK]'), true);
      assert.equal(packed.markdown.includes('outside secret content'), false);
      assert.equal(packed.files.some((f) => f.path.includes('.env') || f.path.includes('image.bin') || f.path.includes('link.ts')), false);
      assert.ok(packed.skippedSymlinks >= 1);

      // 2. fromGitDiff mode in a real temp git repo
      execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: workspace, stdio: 'ignore' });
      execFileSync('git', ['add', 'src/app.ts', 'src/big.ts'], { cwd: workspace, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: workspace, stdio: 'ignore' });

      // Modify only src/app.ts
      fs.appendFileSync(path.join(workspace, 'src', 'app.ts'), '\nexport const changedFlag = true;\n', 'utf8');

      const diffPack = buildContextPack(workspace, { fromGitDiff: true, maxTokens: 4000 });
      assert.equal(diffPack.mode, 'git_diff');
      assert.equal(diffPack.includedFiles, 1);
      assert.equal(diffPack.files[0]?.path, 'src/app.ts');
      assert.ok(diffPack.markdown.includes('changedFlag'));
      assert.equal(diffPack.markdown.includes('ITEM_0'), false);
      assert.equal(diffPack.markdown.includes(fakeOpenAiKey), false);
    });
  });
});

describe('v0.8.0 Turbo 3.0 — MCP Protocol Contract, Toggle Enforcement & Zero Disk Writes in Demo', () => {
  it('preserves strictly 3 model tools, disables app_turbo_update_prefs when turbo is off, and keeps demo zero-write', async () => {
    await withTempDir('agy-nov-v08-mcp-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'ws');
      const liveDataDir = path.join(tmpDir, 'live-data');
      const demoDataDir = path.join(tmpDir, 'demo-data-absent');
      fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(workspace, 'src', 'sample.ts'),
        [
          'export function helloTurbo(x: number) { return x + 1; }',
          'export const ans = helloTurbo(41);',
        ].join('\n'),
        'utf8',
      );
      const pkgDir = path.join(workspace, 'node_modules', 'mini-lib');
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'mini-lib', version: '3.2.1', types: 'index.d.ts' }),
        'utf8',
      );
      fs.writeFileSync(
        path.join(pkgDir, 'index.d.ts'),
        'export function pingLib(host: string): Promise<boolean>;\n',
        'utf8',
      );

      // 1. Direct registerTurboModule contract check
      const rawServer = new McpServer(
        { name: 'v08-turbo-direct', version: '0.8.0' },
        { capabilities: { tools: { listChanged: true } } },
      );
      const reg = registerTurboModule(
        rawServer,
        { dataDir: path.join(tmpDir, 'direct-absent'), workspaceRoot: workspace, demoMode: false },
        'ui://agy-nov/app.html',
      );
      assert.equal(reg.modelTools.length, 3);
      assert.deepEqual(
        reg.modelTools.map((t) => t.name),
        MODULE_CATALOG.turbo.modelToolNames,
      );
      assert.deepEqual(reg.exemptReadOnlyAppTools, [
        'app_turbo_get_prefs',
        'app_turbo_inspect_dep',
        'app_turbo_build_context_pack',
      ]);
      assert.equal(reg.exemptReadOnlyAppTools?.includes('app_turbo_update_prefs'), false);
      assert.equal(reg.exemptReadOnlyAppTools?.includes('app_turbo_get_gain'), false);

      // 2. Full Nov server: toggle turbo ON/OFF and verify app_turbo_update_prefs disables when turbo is OFF
      const bundle = createNovServer({
        dataDir: liveDataDir,
        workspaceRoot: workspace,
        demoMode: false,
        configPollMs: 0,
        exposeAppToolsWithoutUiCapability: true,
      });
      const [cTrans, sTrans] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'v08-mcp-client', version: '0.8.0' });
      await bundle.server.connect(sTrans);
      await client.connect(cTrans);

      try {
        // Default core preset has turbo OFF
        const listedOff = await client.listTools();
        const turboModelToolsOff = listedOff.tools
          .filter((t) => t.name.startsWith('turbo_'))
          .map((t) => t.name);
        assert.deepEqual(turboModelToolsOff, [], 'Turbo model tools must be hidden when turbo is disabled');
        assert.equal(
          listedOff.tools.some((t) => t.name === 'app_turbo_update_prefs'),
          false,
          'Write tool app_turbo_update_prefs must be disabled when turbo is off',
        );
        // Exempt read-only app tools remain accessible
        assert.equal(listedOff.tools.some((t) => t.name === 'app_turbo_get_prefs'), true);
        assert.equal(listedOff.tools.some((t) => t.name === 'app_turbo_inspect_dep'), true);
        assert.equal(listedOff.tools.some((t) => t.name === 'app_turbo_build_context_pack'), true);

        // Enable turbo -> strictly 3 model tools + app_turbo_update_prefs enabled
        await bundle.setModule('turbo', true);
        const listedOn = await client.listTools();
        const turboModelToolsOn = listedOn.tools
          .filter((t) => t.name.startsWith('turbo_'))
          .map((t) => t.name);
        assert.deepEqual(turboModelToolsOn, [
          'turbo_batch_search',
          'turbo_read_outline',
          'turbo_compact_output',
        ]);
        assert.equal(listedOn.tools.some((t) => t.name === 'app_turbo_update_prefs'), true);

        // Exercise turbo_batch_search(mode="references")
        const refCall = await client.callTool({
          name: 'turbo_batch_search',
          arguments: { queries: ['helloTurbo'], mode: 'references' },
        });
        assert.equal(refCall.isError, undefined);
        const refSc = refCall.structuredContent as {
          mode: string;
          definitions: Array<{ line: number }>;
          usages: Array<{ line: number }>;
          textBytes: number;
        };
        assert.equal(refSc.mode, 'references');
        assert.equal(refSc.definitions.length, 1);
        assert.equal(refSc.usages.length, 1);
        assert.ok(refSc.textBytes <= TURBO_MAX_TOOL_TEXT_BYTES);

        // Exercise turbo_read_outline(depPackage="mini-lib")
        const depCall = await client.callTool({
          name: 'turbo_read_outline',
          arguments: { depPackage: 'mini-lib', symbolFilter: 'pingLib' },
        });
        assert.equal(depCall.isError, undefined);
        const depSc = depCall.structuredContent as {
          mode: string;
          found: boolean;
          version: string;
          signatures: Array<{ signature: string }>;
          textBytes: number;
        };
        assert.equal(depSc.mode, 'dep_contract');
        assert.equal(depSc.found, true);
        assert.equal(depSc.version, '3.2.1');
        assert.equal(depSc.signatures.length, 1);
        assert.ok(depSc.textBytes <= TURBO_MAX_TOOL_TEXT_BYTES);

        // Disable turbo again -> app_turbo_update_prefs disabled again
        await bundle.setModule('turbo', false);
        const listedOffAgain = await client.listTools();
        assert.equal(listedOffAgain.tools.some((t) => t.name === 'app_turbo_update_prefs'), false);
      } finally {
        await client.close();
        await bundle.dispose();
      }

      // 3. Demo mode strictly zero disk writes across prefs, update_prefs, inspect_dep, build_context_pack
      const demoServer = new McpServer(
        { name: 'v08-turbo-demo', version: '0.8.0' },
        { capabilities: { tools: { listChanged: true } } },
      );
      registerTurboModule(
        demoServer,
        { dataDir: demoDataDir, workspaceRoot: workspace, demoMode: true },
        'ui://agy-nov/app.html',
      );
      const [dcTrans, dsTrans] = InMemoryTransport.createLinkedPair();
      const demoClient = new Client({ name: 'v08-demo-client', version: '0.8.0' });
      await demoServer.connect(dsTrans);
      await demoClient.connect(dcTrans);

      try {
        const prefsBefore = await demoClient.callTool({ name: 'app_turbo_get_prefs', arguments: {} });
        const pbSc = prefsBefore.structuredContent as {
          prefs: { autoRtk: boolean };
          hotspots: Array<{ commandPrefix: string }>;
        };
        assert.equal(pbSc.prefs.autoRtk, false);
        assert.equal(pbSc.hotspots.length, 2);

        const prefsUpdated = await demoClient.callTool({
          name: 'app_turbo_update_prefs',
          arguments: { autoRtk: true },
        });
        const puSc = prefsUpdated.structuredContent as { prefs: { autoRtk: boolean } };
        assert.equal(puSc.prefs.autoRtk, true);

        const demoDep = await demoClient.callTool({
          name: 'app_turbo_inspect_dep',
          arguments: { packageName: 'zod' },
        });
        const ddSc = demoDep.structuredContent as { result: { found: boolean; packageName: string } };
        assert.equal(ddSc.result.found, true);
        assert.equal(ddSc.result.packageName, 'zod');

        const demoPack = await demoClient.callTool({
          name: 'app_turbo_build_context_pack',
          arguments: { scope: 'src', maxTokens: 4000 },
        });
        const dpSc = demoPack.structuredContent as { result: { includedFiles: number; redactionCount: number } };
        assert.ok(dpSc.result.includedFiles >= 1);
        assert.ok(dpSc.result.redactionCount >= 1);

        assert.equal(fs.existsSync(demoDataDir), false, 'Demo mode must strictly write zero files to disk');
      } finally {
        await demoClient.close();
        await demoServer.close();
      }
    });
  });
});
