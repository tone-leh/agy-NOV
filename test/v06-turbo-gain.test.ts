import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MODULE_CATALOG } from '../src/core/config.js';
import {
  enforceToolTextGuardrail,
  estimateSavedUsd,
  extractOutlineSymbols,
  TURBO_GAIN_MAX_RECENT,
  TURBO_INPUT_USD_PER_MILLION_TOKENS,
  TURBO_MAX_TOOL_TEXT_BYTES,
  TurboGainTracker,
  type TurboGainSummary,
} from '../src/modules/turbo/core.js';
import { registerTurboModule } from '../src/modules/turbo/register.js';

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

describe('v0.6.0 Turbo 2.5 — <=8.8KB tool text guardrail', () => {
  it('passes through texts <= 8800 bytes untouched and caps oversized ASCII + CJK + Emoji safely', () => {
    assert.equal(TURBO_MAX_TOOL_TEXT_BYTES, 8800);

    // Exact boundary: 8800 ASCII bytes passes through untouched
    const exactBoundary = 'A'.repeat(TURBO_MAX_TOOL_TEXT_BYTES);
    const exactRes = enforceToolTextGuardrail(exactBoundary, 'should not appear');
    assert.equal(exactRes.capped, false);
    assert.equal(exactRes.text, exactBoundary);
    assert.equal(exactRes.bytes, TURBO_MAX_TOOL_TEXT_BYTES);
    assert.equal(exactRes.originalBytes, TURBO_MAX_TOOL_TEXT_BYTES);

    // Oversized ASCII text
    const oversizedAscii = Array.from(
      { length: 300 },
      (_, idx) => `line-${String(idx + 1).padStart(3, '0')}: ${'x'.repeat(60)}`,
    ).join('\n');
    const asciiHint = 'Query chunkId="chk_demo_123" for full output.';
    const asciiRes = enforceToolTextGuardrail(oversizedAscii, asciiHint);
    assert.equal(asciiRes.capped, true);
    assert.ok(asciiRes.originalBytes > TURBO_MAX_TOOL_TEXT_BYTES);
    assert.ok(asciiRes.bytes <= TURBO_MAX_TOOL_TEXT_BYTES);
    assert.equal(Buffer.byteLength(asciiRes.text, 'utf8'), asciiRes.bytes);
    assert.ok(asciiRes.text.includes(asciiHint));
    assert.equal(asciiRes.text.includes('\uFFFD'), false);

    // Oversized multi-byte UTF-8: Chinese (3 bytes) + Emoji surrogate pairs (4 bytes) without newlines
    const multiByteUnit = '测试护栏🚀性能压缩🎉边界🔥';
    const oversizedMultiByte = multiByteUnit.repeat(800);
    assert.ok(Buffer.byteLength(oversizedMultiByte, 'utf8') > 20_000);
    const mbHint = '请缩小 startLine/endLine 行号范围 🚀';
    const mbRes = enforceToolTextGuardrail(oversizedMultiByte, mbHint);
    assert.equal(mbRes.capped, true);
    assert.ok(mbRes.bytes <= TURBO_MAX_TOOL_TEXT_BYTES);
    assert.equal(Buffer.byteLength(mbRes.text, 'utf8'), mbRes.bytes);
    assert.equal(mbRes.text.includes('\uFFFD'), false, 'Must never produce UTF-8 replacement character U+FFFD');
    assert.equal(hasLoneSurrogate(mbRes.text), false, 'Must never split UTF-16 surrogate pairs');
    assert.equal(Buffer.from(mbRes.text, 'utf8').toString('utf8'), mbRes.text);
    assert.ok(mbRes.text.includes(mbHint));

    // Oversized hint still respects hard <= 8800 byte ceiling
    const hugeHint = '超长提示🎯'.repeat(2000);
    const hugeHintRes = enforceToolTextGuardrail(oversizedMultiByte, hugeHint);
    assert.equal(hugeHintRes.capped, true);
    assert.ok(hugeHintRes.bytes <= TURBO_MAX_TOOL_TEXT_BYTES);
    assert.equal(Buffer.byteLength(hugeHintRes.text, 'utf8'), hugeHintRes.bytes);
    assert.equal(hugeHintRes.text.includes('\uFFFD'), false);
    assert.equal(hasLoneSurrogate(hugeHintRes.text), false);
  });

  it('enforces <=8.8KB guardrail end-to-end across turbo_batch_search, turbo_read_outline, and turbo_compact_output', async () => {
    await withTempDir('agy-nov-v06-guardrail-mcp-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'ws');
      const dataDir = path.join(tmpDir, 'nov-data-absent');
      fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });

      // Generate files with dense multi-byte content around each query to force > 8.8 KB summary
      const longSubDir = path.join(workspace, 'src', 'long-workspace-subsystem-directory', 'nested-handlers');
      fs.mkdirSync(longSubDir, { recursive: true });
      const queries = Array.from({ length: 8 }, (_, idx) => `TOKEN_MARK_${idx + 1}`);
      for (let f = 1; f <= 5; f += 1) {
        const lines = queries.map(
          (q) =>
            `const 中文前缀数据🚀测试内容边界检查_${f} = "${'性能指标压缩护栏🚀'.repeat(8)}${q}${'多字节日志上下文🎉'.repeat(12)}";`,
        );
        fs.writeFileSync(path.join(longSubDir, `handler_module_${f}.ts`), lines.join('\n'), 'utf8');
      }

      // Large TypeScript file for turbo_read_outline slice (> 8.8 KB within 120 lines)
      const hugeOutlineLines = Array.from(
        { length: 140 },
        (_, idx) => `export const BIG_CONST_${idx + 1} = "${'中文符号🚀'.repeat(25)}";`,
      );
      fs.writeFileSync(path.join(workspace, 'src', 'huge-outline.ts'), hugeOutlineLines.join('\n'), 'utf8');

      const server = new McpServer(
        { name: 'v06-guardrail-test', version: '0.6.0' },
        { capabilities: { tools: { listChanged: true } } },
      );
      registerTurboModule(
        server,
        { dataDir, workspaceRoot: workspace, demoMode: false },
        'ui://agy-nov/app.html',
      );

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'v06-guardrail-client', version: '0.6.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        // 1. turbo_batch_search
        const searchCall = await client.callTool({
          name: 'turbo_batch_search',
          arguments: { queries, maxMatchesPerQuery: 5 },
        });
        assert.equal(searchCall.isError, undefined);
        const searchText = (searchCall.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
        const searchBytes = Buffer.byteLength(searchText, 'utf8');
        const searchSc = searchCall.structuredContent as {
          textGuardrailApplied: boolean;
          textBytes: number;
        };
        assert.equal(searchSc.textGuardrailApplied, true);
        assert.equal(searchSc.textBytes, searchBytes);
        assert.ok(searchBytes <= TURBO_MAX_TOOL_TEXT_BYTES);
        assert.equal(searchText.includes('\uFFFD'), false);
        assert.equal(hasLoneSurrogate(searchText), false);

        // 2. turbo_read_outline
        const outlineCall = await client.callTool({
          name: 'turbo_read_outline',
          arguments: { filePath: 'src/huge-outline.ts', startLine: 1, endLine: 120, maxSliceLines: 120 },
        });
        assert.equal(outlineCall.isError, undefined);
        const outlineText = (outlineCall.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
        const outlineBytes = Buffer.byteLength(outlineText, 'utf8');
        const outlineSc = outlineCall.structuredContent as {
          textGuardrailApplied: boolean;
          textBytes: number;
        };
        assert.equal(outlineSc.textGuardrailApplied, true);
        assert.equal(outlineSc.textBytes, outlineBytes);
        assert.ok(outlineBytes <= TURBO_MAX_TOOL_TEXT_BYTES);
        assert.equal(outlineText.includes('\uFFFD'), false);
        assert.equal(hasLoneSurrogate(outlineText), false);
        assert.match(outlineText, /startLine\/endLine/);

        // 3. turbo_compact_output with oversized error payload exceeding 8.8 KB
        const hugeErrors = Array.from(
          { length: 220 },
          (_, idx) =>
            `src/pkg/file_${idx + 1}.ts:${idx + 1}:5 - error TS2322: 中文类型不匹配🚀 ${'DetailPayload'.repeat(12)}`,
        ).join('\n');
        const compactCall = await client.callTool({
          name: 'turbo_compact_output',
          arguments: { label: 'huge-tsc', rawText: hugeErrors, preset: 'build', maxErrorLines: 60 },
        });
        assert.equal(compactCall.isError, undefined);
        const compactText = (compactCall.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
        const compactBytes = Buffer.byteLength(compactText, 'utf8');
        const compactSc = compactCall.structuredContent as {
          chunkId: string;
          textGuardrailApplied: boolean;
          textBytes: number;
        };
        assert.equal(compactSc.textGuardrailApplied, true);
        assert.equal(compactSc.textBytes, compactBytes);
        assert.ok(compactBytes <= TURBO_MAX_TOOL_TEXT_BYTES);
        assert.ok(compactText.includes(compactSc.chunkId), 'Guardrail suffix should guide follow-up chunkId query');
        assert.equal(compactText.includes('\uFFFD'), false);
        assert.equal(hasLoneSurrogate(compactText), false);

        // Verify gain tracker counted all 3 guardrail triggers and wrote zero files
        const gainCall = await client.callTool({ name: 'app_turbo_get_gain', arguments: {} });
        const gain = gainCall.structuredContent as unknown as TurboGainSummary;
        assert.equal(gain.totalOperations, 3);
        assert.equal(gain.guardrailTriggeredCount, 3);
        assert.equal(fs.existsSync(dataDir), false);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});

describe('v0.6.0 Turbo 2.5 — Multi-indent nested symbol outlines', () => {
  it('extracts TS/JS class methods, accessors, constructors, interface members, and namespaces while filtering control flow', () => {
    const tsCode = [
      'export interface LedgerGateway {',
      '    readonly currency: string;',
      '    charge(',
      '        amount: number,',
      '        memo: string,',
      '    ): Promise<boolean>;',
      '    refund?(txId: string): Promise<void>;',
      '}',
      '',
      'export class PaymentProcessor {',
      '    private retries = 3;',
      '',
      '    public constructor(private readonly gw: LedgerGateway) {',
      '        if (this.retries < 1) {',
      '            throw new Error("bad retries");',
      '        }',
      '    }',
      '',
      '    public static async executeBatch(items: string[]): Promise<number> {',
      '        for (const item of items) {',
      '            while (item.length === 0) {',
      '                break;',
      '            }',
      '            try {',
      '                switch (item) {',
      '                    case "skip":',
      '                        continue;',
      '                    default:',
      '                        break;',
      '                }',
      '            } catch (err) {',
      '                if (err) {',
      '                    return -1;',
      '                } else {',
      '                    do {',
      '                        break;',
      '                    } while (false);',
      '                }',
      '            }',
      '        }',
      '        return items.length;',
      '    }',
      '',
      '        override get status(): string {',
      '            return "ready";',
      '        }',
      '',
      '        protected set status(next: string) {',
      '            void next;',
      '        }',
      '',
      '    private handleRetry = async (attempt: number) => {',
      '        return attempt + 1;',
      '    };',
      '}',
      '',
      'export namespace Billing {',
      '    export function formatCents(cents: number): string {',
      '        return `${cents}`;',
      '    }',
      '    export class Invoice {',
      '        render(): string {',
      '            return "inv";',
      '        }',
      '    }',
      '}',
    ].join('\n');

    const { symbols, truncated } = extractOutlineSymbols(tsCode, 'typescript', 120);
    assert.equal(truncated, false);

    // Interface + nested property & method (multiline params `amount`/`memo` must NOT appear as properties)
    assert.ok(symbols.some((s) => s.kind === 'interface' && s.name === 'LedgerGateway' && s.level === 0));
    assert.ok(
      symbols.some((s) => s.kind === 'property' && s.name === 'currency' && s.parent === 'LedgerGateway' && s.level === 1),
    );
    assert.ok(
      symbols.some((s) => s.kind === 'method' && s.name === 'charge' && s.parent === 'LedgerGateway' && s.level === 1),
    );
    assert.ok(
      symbols.some((s) => s.kind === 'method' && s.name === 'refund' && s.parent === 'LedgerGateway' && s.level === 1),
    );
    assert.equal(symbols.some((s) => s.name === 'amount' || s.name === 'memo'), false);

    // Class + multi-indent (4-space & 8-space) methods, constructor, static async, get/set, arrow method
    assert.ok(symbols.some((s) => s.kind === 'class' && s.name === 'PaymentProcessor' && s.level === 0));
    assert.ok(
      symbols.some((s) => s.kind === 'method' && s.name === 'constructor' && s.parent === 'PaymentProcessor' && s.level === 1),
    );
    assert.ok(
      symbols.some((s) => s.kind === 'method' && s.name === 'executeBatch' && s.parent === 'PaymentProcessor' && s.level === 1),
    );
    const statusAccessors = symbols.filter(
      (s) => s.kind === 'method' && s.name === 'status' && s.parent === 'PaymentProcessor' && s.level === 1,
    );
    assert.equal(statusAccessors.length, 2, 'Expected both get status and set status accessors');
    assert.ok(
      symbols.some((s) => s.kind === 'method' && s.name === 'handleRetry' && s.parent === 'PaymentProcessor' && s.level === 1),
    );

    // Namespace + nested function + nested class + its method
    assert.ok(symbols.some((s) => s.kind === 'namespace' && s.name === 'Billing' && s.level === 0));
    assert.ok(
      symbols.some((s) => s.kind === 'function' && s.name === 'formatCents' && s.parent === 'Billing' && s.level === 1),
    );
    assert.ok(
      symbols.some((s) => s.kind === 'class' && s.name === 'Invoice' && s.parent === 'Billing' && s.level === 1),
    );
    assert.ok(
      symbols.some((s) => s.kind === 'method' && s.name === 'render' && s.parent === 'Invoice' && s.level === 1),
    );

    // Strict control-flow filtering: none of if/for/while/switch/catch/else/try/return/do/with may appear
    const forbidden = new Set(['if', 'for', 'while', 'switch', 'catch', 'else', 'try', 'return', 'do', 'with']);
    for (const sym of symbols) {
      assert.equal(forbidden.has(sym.name), false, `Control flow keyword falsely reported as symbol: ${sym.name}`);
    }
  });

  it('extracts Python class methods (def / async def), Go receiver methods, and Rust impl/trait methods', () => {
    // Python
    const pyCode = [
      'def top_func(x):',
      '    return x',
      '',
      'class DataPipeline:',
      '    """',
      '    def fake_in_docstring(self):',
      '        pass',
      '    """',
      '    def __init__(self, name: str):',
      '        self.name = name',
      '',
      '    @staticmethod',
      '    async def run_batch(items):',
      '        def _local_helper():',
      '            return 1',
      '        if items:',
      '            for item in items:',
      '                pass',
      '        return _local_helper()',
      '',
      'async def top_async():',
      '    return True',
    ].join('\n');

    const py = extractOutlineSymbols(pyCode, 'python');
    assert.deepEqual(
      py.symbols.map((s) => ({ kind: s.kind, name: s.name, parent: s.parent, level: s.level })),
      [
        { kind: 'function', name: 'top_func', parent: undefined, level: 0 },
        { kind: 'class', name: 'DataPipeline', parent: undefined, level: 0 },
        { kind: 'method', name: '__init__', parent: 'DataPipeline', level: 1 },
        { kind: 'method', name: 'run_batch', parent: 'DataPipeline', level: 1 },
        { kind: 'function', name: 'top_async', parent: undefined, level: 0 },
      ],
    );

    // Go (value receiver, pointer receiver, generic receiver, plain function, generic function)
    const goCode = [
      'package store',
      'type Cache[K comparable, V any] struct{}',
      'func NewCache[K comparable, V any]() *Cache[K, V] { return nil }',
      'func (c *Cache[K, V]) Get(key K) (V, bool) { var zero V; return zero, false }',
      'func (c Cache[K, V]) Len() int { return 0 }',
      'func (*Cache[K, V]) Clear() {}',
      'func main() {}',
    ].join('\n');

    const go = extractOutlineSymbols(goCode, 'go');
    assert.deepEqual(
      go.symbols.map((s) => ({ kind: s.kind, name: s.name, parent: s.parent, level: s.level })),
      [
        { kind: 'struct', name: 'Cache', parent: undefined, level: 0 },
        { kind: 'function', name: 'NewCache', parent: undefined, level: 0 },
        { kind: 'method', name: 'Get', parent: 'Cache', level: 1 },
        { kind: 'method', name: 'Len', parent: 'Cache', level: 1 },
        { kind: 'method', name: 'Clear', parent: 'Cache', level: 1 },
        { kind: 'function', name: 'main', parent: undefined, level: 0 },
      ],
    );

    // Rust (top-level fn/struct/trait + multi-indent impl & trait methods with lifetimes)
    const rsCode = [
      'pub struct Ledger<T> { inner: T }',
      '',
      'pub trait Persistable {',
      '    fn flush(&mut self) -> Result<(), String>;',
      '    fn is_dirty(&self) -> bool { false }',
      '}',
      '',
      'impl<T> Ledger<T> {',
      "    pub async fn load<'a>(&'a self, key: &'a str) -> Option<&'a str> {",
      '        fn nested_local() {}',
      '        if key.is_empty() {',
      '            return None;',
      '        }',
      '        Some(key)',
      '    }',
      '',
      '        pub(crate) fn reset(&mut self) {',
      '            // deeply indented method inside impl',
      '        }',
      '}',
      '',
      'impl<T> Persistable for Ledger<T> {',
      '    fn flush(&mut self) -> Result<(), String> { Ok(()) }',
      '}',
      '',
      'pub fn bootstrap() {}',
    ].join('\n');

    const rs = extractOutlineSymbols(rsCode, 'rust');
    assert.deepEqual(
      rs.symbols.map((s) => ({ kind: s.kind, name: s.name, parent: s.parent, level: s.level })),
      [
        { kind: 'struct', name: 'Ledger', parent: undefined, level: 0 },
        { kind: 'trait', name: 'Persistable', parent: undefined, level: 0 },
        { kind: 'method', name: 'flush', parent: 'Persistable', level: 1 },
        { kind: 'method', name: 'is_dirty', parent: 'Persistable', level: 1 },
        { kind: 'impl', name: 'Ledger', parent: undefined, level: 0 },
        { kind: 'method', name: 'load', parent: 'Ledger', level: 1 },
        { kind: 'method', name: 'reset', parent: 'Ledger', level: 1 },
        { kind: 'impl', name: 'Ledger', parent: undefined, level: 0 },
        { kind: 'method', name: 'flush', parent: 'Ledger', level: 1 },
        { kind: 'fn', name: 'bootstrap', parent: undefined, level: 0 },
      ],
    );

    // Respects maxItems cap
    const capped = extractOutlineSymbols(rsCode, 'rust', 4);
    assert.equal(capped.symbols.length, 4);
    assert.equal(capped.truncated, true);
  });

  it('defends against 100KB unclosed quote O(n^2) and whitespace ReDoS payloads (< 100ms each)', () => {
    const escapedQuotes100k = '\\"'.repeat(50_000);
    const unclosedQuote100k = `"${'\\"'.repeat(50_000)}`;
    const rustCharAttack100k = "'\\a".repeat(33_334);
    const spaces100k = ' '.repeat(100_000);

    const cases: Array<{ label: string; lang: string; content: string }> = [
      { label: 'TS escaped quotes 100KB', lang: 'typescript', content: escapedQuotes100k },
      { label: 'TS unclosed quote 100KB', lang: 'typescript', content: unclosedQuote100k },
      { label: 'Rust escaped quotes 100KB', lang: 'rust', content: escapedQuotes100k },
      { label: 'Rust unclosed quote 100KB', lang: 'rust', content: unclosedQuote100k },
      { label: 'Rust escaped char literal 100KB', lang: 'rust', content: rustCharAttack100k },
      { label: 'Python escaped quotes 100KB', lang: 'python', content: escapedQuotes100k },
      { label: 'Python unclosed quote 100KB', lang: 'python', content: unclosedQuote100k },
      { label: 'TS type whitespace 100KB', lang: 'typescript', content: `type Foo${spaces100k}x` },
      {
        label: 'TS class member whitespace 100KB',
        lang: 'typescript',
        content: `class A {\n  foo${spaces100k}x\n}`,
      },
      {
        label: 'TS interface member whitespace 100KB',
        lang: 'typescript',
        content: `interface I {\n  bar${spaces100k}x\n}`,
      },
      { label: 'TS function whitespace 100KB', lang: 'typescript', content: `function${spaces100k}(` },
      { label: 'Go func whitespace 100KB', lang: 'go', content: `func foo${spaces100k}x` },
      { label: 'Go type whitespace 100KB', lang: 'go', content: `type Foo${spaces100k}x` },
    ];

    for (const c of cases) {
      const start = performance.now();
      const res = extractOutlineSymbols(c.content, c.lang);
      const elapsedMs = performance.now() - start;
      assert.ok(Array.isArray(res.symbols));
      assert.ok(
        elapsedMs < 100,
        `${c.label} took ${elapsedMs.toFixed(2)}ms (expected < 100ms, strict linear O(n))`,
      );
    }
  });
});

describe('v0.6.0 Turbo 2.5 — Cumulative gain tracker, app_turbo_get_gain & 3-tool contract', () => {
  it('accurately computes token savings, USD ($2.50/1M, 4 decimals), per-op buckets, and caps recent history at 20', () => {
    assert.equal(TURBO_INPUT_USD_PER_MILLION_TOKENS, 2.5);
    assert.equal(TURBO_GAIN_MAX_RECENT, 20);
    assert.equal(estimateSavedUsd(0), 0);
    assert.equal(estimateSavedUsd(-500), 0);
    assert.equal(estimateSavedUsd(1_000_000), 2.5);
    assert.equal(estimateSavedUsd(400_000), 1);
    assert.equal(estimateSavedUsd(12_345), 0.0309);

    const tracker = new TurboGainTracker();
    tracker.record({
      op: 'batch_search',
      label: 'q1, q2',
      rawTokens: 20_000,
      returnedTokens: 1_000,
      guardrailApplied: false,
    });
    tracker.record({
      op: 'read_outline',
      label: 'src/core.ts',
      rawTokens: 10_000,
      returnedTokens: 1_000,
      guardrailApplied: true,
    });
    tracker.record({
      op: 'compact_output',
      label: 'vitest',
      rawTokens: 50_000,
      returnedTokens: 2_000,
      guardrailApplied: true,
    });

    const summary = tracker.getSummary();
    assert.equal(summary.totalOperations, 3);
    assert.equal(summary.totalRawTokens, 80_000);
    assert.equal(summary.totalReturnedTokens, 4_000);
    assert.equal(summary.totalSavedTokens, 76_000);
    assert.equal(summary.avgCompressionPercent, 95);
    assert.equal(summary.estimatedSavedUsd, 0.19);
    assert.equal(summary.guardrailTriggeredCount, 2);

    assert.equal(summary.byOperation.search.operations, 1);
    assert.equal(summary.byOperation.search.savedTokens, 19_000);
    assert.equal(summary.byOperation.outline.operations, 1);
    assert.equal(summary.byOperation.outline.savedTokens, 9_000);
    assert.equal(summary.byOperation.compact.operations, 1);
    assert.equal(summary.byOperation.compact.savedTokens, 48_000);

    // Most recent entry appears first
    assert.equal(summary.recent[0]?.op, 'compact_output');
    assert.equal(summary.recent[0]?.label, 'vitest');
    assert.equal(summary.recent[0]?.guardrailApplied, true);

    // Push 22 additional operations to verify recent cap stays at 20 while totals keep accumulating
    for (let i = 1; i <= 22; i += 1) {
      tracker.record({
        op: 'batch_search',
        label: `extra-${i}`,
        rawTokens: 1000,
        returnedTokens: 200,
      });
    }
    const afterMany = tracker.getSummary();
    assert.equal(afterMany.totalOperations, 25);
    assert.equal(afterMany.recent.length, TURBO_GAIN_MAX_RECENT);
    assert.equal(afterMany.recent[0]?.label, 'extra-22');
  });

  it('keeps exactly 3 Turbo model tools, exposes read-only app_turbo_get_gain, and seeds demoMode with zero disk writes', async () => {
    await withTempDir('agy-nov-v06-gain-mcp-', async (tmpDir) => {
      const workspace = path.join(tmpDir, 'ws');
      const liveDataDir = path.join(tmpDir, 'live-data-absent');
      const demoDataDir = path.join(tmpDir, 'demo-data-absent');
      fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(workspace, 'src', 'service.ts'),
        [
          'export class OrderService {',
          '  async createOrder(id: string) {',
          '    return { id, status: "ok" };',
          '  }',
          '}',
          ...Array.from({ length: 80 }, (_, idx) => `// padding comment line ${idx + 1} ${'x'.repeat(40)}`),
        ].join('\n'),
        'utf8',
      );

      // 1. Live mode verification
      const liveServer = new McpServer(
        { name: 'v06-gain-live', version: '0.6.0' },
        { capabilities: { tools: { listChanged: true } } },
      );
      const liveReg = registerTurboModule(
        liveServer,
        { dataDir: liveDataDir, workspaceRoot: workspace, demoMode: false },
        'ui://agy-nov/app.html',
      );

      // Strictly 3 model tools matching MODULE_CATALOG.turbo.modelToolNames
      assert.equal(liveReg.modelTools.length, 3);
      assert.deepEqual(
        liveReg.modelTools.map((t) => t.name),
        ['turbo_batch_search', 'turbo_read_outline', 'turbo_compact_output'],
      );
      assert.deepEqual(
        liveReg.modelTools.map((t) => t.name),
        MODULE_CATALOG.turbo.modelToolNames,
      );
      // L1: app_turbo_get_gain must NOT be exempted so disabling turbo hides prior recent queries/paths
      assert.equal(liveReg.exemptReadOnlyAppTools?.includes('app_turbo_get_gain') ?? false, false);

      const [cTrans, sTrans] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'v06-gain-client', version: '0.6.0' });
      await liveServer.connect(sTrans);
      await client.connect(cTrans);

      try {
        const listed = await client.listTools();
        const modelNames = listed.tools.filter((t) => !t.name.startsWith('app_')).map((t) => t.name);
        assert.deepEqual(modelNames, ['turbo_batch_search', 'turbo_read_outline', 'turbo_compact_output']);

        const gainToolMeta = listed.tools.find((t) => t.name === 'app_turbo_get_gain')?._meta as
          | { ui?: { visibility?: string[]; resourceUri?: string } }
          | undefined;
        assert.deepEqual(gainToolMeta?.ui?.visibility, ['app']);

        // Execute search, outline, compact and inspect live cumulative gain
        await client.callTool({ name: 'turbo_batch_search', arguments: { queries: ['createOrder'] } });
        await client.callTool({
          name: 'turbo_read_outline',
          arguments: { filePath: 'src/service.ts', startLine: 1, endLine: 6 },
        });
        await client.callTool({
          name: 'turbo_compact_output',
          arguments: {
            label: 'live-tests',
            rawText: Array.from({ length: 120 }, (_, i) => `✔ test item #${i + 1} passed`).join('\n'),
          },
        });

        const gainRes = await client.callTool({ name: 'app_turbo_get_gain', arguments: {} });
        const gainData = gainRes.structuredContent as unknown as TurboGainSummary;
        assert.equal(gainData.totalOperations, 3);
        assert.ok(gainData.totalSavedTokens > 0);
        assert.equal(gainData.estimatedSavedUsd, estimateSavedUsd(gainData.totalSavedTokens));
        assert.equal(gainData.byOperation.search.operations, 1);
        assert.equal(gainData.byOperation.outline.operations, 1);
        assert.equal(gainData.byOperation.compact.operations, 1);
        assert.equal(gainData.recent.length, 3);

        // app_turbo_get_state embeds the same gain summary
        const stateRes = await client.callTool({ name: 'app_turbo_get_state', arguments: {} });
        const stateGain = (stateRes.structuredContent as { gain: TurboGainSummary }).gain;
        assert.deepEqual(stateGain, gainData);

        assert.equal(fs.existsSync(liveDataDir), false, 'Live in-memory gain tracker must never write to disk');
      } finally {
        await client.close();
        await liveServer.close();
      }

      // 2. Demo mode verification (synthetic data + zero disk writes)
      const demoServer = new McpServer(
        { name: 'v06-gain-demo', version: '0.6.0' },
        { capabilities: { tools: { listChanged: true } } },
      );
      registerTurboModule(
        demoServer,
        { dataDir: demoDataDir, workspaceRoot: workspace, demoMode: true },
        'ui://agy-nov/app.html',
      );
      assert.equal(fs.existsSync(demoDataDir), false);

      const [dcTrans, dsTrans] = InMemoryTransport.createLinkedPair();
      const demoClient = new Client({ name: 'v06-gain-demo-client', version: '0.6.0' });
      await demoServer.connect(dsTrans);
      await demoClient.connect(dcTrans);

      try {
        const demoGainCall = await demoClient.callTool({ name: 'app_turbo_get_gain', arguments: {} });
        const demoGain = demoGainCall.structuredContent as unknown as TurboGainSummary;
        assert.ok(demoGain.totalOperations >= 4);
        assert.ok(demoGain.totalSavedTokens > 10_000);
        assert.ok(demoGain.estimatedSavedUsd > 0);
        assert.ok(demoGain.avgCompressionPercent >= 50);
        assert.ok(demoGain.guardrailTriggeredCount >= 1);
        assert.ok(demoGain.recent.length >= 4);

        const demoStateCall = await demoClient.callTool({ name: 'app_turbo_get_state', arguments: {} });
        const demoState = demoStateCall.structuredContent as {
          mode: string;
          gain: TurboGainSummary;
          lastOutline: { outline: Array<{ parent?: string; level?: number }> };
        };
        assert.equal(demoState.mode, 'demo');
        assert.deepEqual(demoState.gain, demoGain);
        assert.ok(
          demoState.lastOutline.outline.some((s) => s.parent === 'CompactedChunkStore' && s.level === 1),
          'Demo outline should showcase nested class methods',
        );

        assert.equal(fs.existsSync(demoDataDir), false, 'Demo mode must leave dataDir completely untouched');
      } finally {
        await demoClient.close();
        await demoServer.close();
      }
    });
  });
});
