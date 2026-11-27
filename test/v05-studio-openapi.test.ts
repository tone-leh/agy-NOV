import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MODULE_CATALOG } from '../src/core/catalog.js';
import {
  inspectStudioDocument,
  OPENAPI_MAX_ENDPOINTS,
  OPENAPI_MAX_FILE_BYTES,
  OPENAPI_MAX_YAML_LINES,
  parseOpenApiSpecFromContent,
  parseStudioOpenApiFile,
  runLoopbackHttpProbe,
  validateLoopbackProbeUrl,
  type ParsedOpenApiSpec,
  type StudioDocumentResult,
} from '../src/modules/studio/core.js';
import { registerStudioModule } from '../src/modules/studio/register.js';

function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

describe('v0.5.0 Studio OpenAPI 2.0 / 3.x parser & loopback endpoint collection', () => {
  it('1. parses OpenAPI 3.0 YAML with parameters, local $ref sampleBody, secret redaction, and attaches openApiSpec to studio_inspect_document', async () => {
    await withTempDir('agy-nov-openapi3-', (ws) => {
      fs.mkdirSync(path.join(ws, 'api'), { recursive: true });
      const yamlSpec = [
        'openapi: 3.0.3',
        'info:',
        '  title: "Workbench API: Health & Reviews"',
        '  version: 1.4.2',
        'servers:',
        '  - url: http://127.0.0.1:4399/v1',
        '    description: Local loopback dev server',
        '  - url: https://api.example.com/v1',
        '    description: Production server',
        'components:',
        '  schemas:',
        '    CreateReview:',
        '      type: object',
        '      properties:',
        '        title:',
        '          type: string',
        '          example: "Audit & verify *all* paths"',
        '        priority:',
        '          type: integer',
        '          default: 2',
        '        nested:',
        '          type: object',
        '          properties:',
        '            flag:',
        '              type: boolean',
        '            deep:',
        '              type: object',
        '              properties:',
        '                level3:',
        '                  type: object',
        '                  properties:',
        '                    level4:',
        '                      type: string',
        '        apiKey:',
        '          type: string',
        '          example: "ghp_1234567890abcdefghijklmnopqrstuvwx"',
        '        note:',
        '          type: string',
        '          example: "ref ghp_1234567890abcdefghijklmnopqrstuvwx"',
        '    RecursiveNode:',
        '      type: object',
        '      properties:',
        '        name:',
        '          type: string',
        '        child:',
        '          $ref: "#/components/schemas/RecursiveNode"',
        'paths:',
        '  /projects/{id}:',
        '    parameters:',
        '      - name: id',
        '        in: path',
        '        required: true',
        '        example: proj_42',
        '    get:',
        '      summary: Fetch project & status details',
        '      operationId: getProject',
        '      tags: [projects, core]',
        '      parameters:',
        '        - name: verbose',
        '          in: query',
        '          required: false',
        '          example: true',
        '        - name: X-Trace-Id',
        '          in: header',
        '          example: trace-99',
        '        - name: Authorization',
        '          in: header',
        '          example: Bearer top-secret-token-value-12345',
        '  /reviews:',
        '    post:',
        '      summary: Submit review batch',
        '      tags:',
        '        - reviews',
        '      requestBody:',
        '        required: true',
        '        content:',
        '          application/json:',
        '            schema:',
        '              $ref: "#/components/schemas/CreateReview"',
        '  /tree:',
        '    post:',
        '      summary: Circular ref safety test',
        '      requestBody:',
        '        content:',
        '          application/json:',
        '            schema:',
        '              $ref: "#/components/schemas/RecursiveNode"',
        '  /cache:',
        '    delete:',
        '      summary: Clear cache',
        '      tags: [maintenance]',
      ].join('\n');

      fs.writeFileSync(path.join(ws, 'api', 'openapi.yaml'), yamlSpec, 'utf8');

      const parsed = parseStudioOpenApiFile(ws, 'api/openapi.yaml');
      assert.equal(parsed.filePath, 'api/openapi.yaml');
      assert.equal(parsed.specVersion, '3.0.3');
      assert.equal(parsed.title, 'Workbench API: Health & Reviews');
      assert.equal(parsed.apiVersion, '1.4.2');
      assert.equal(parsed.truncated, false);
      assert.equal(parsed.totalEndpoints, 4);
      assert.equal(parsed.endpoints.length, 4);

      assert.equal(parsed.servers.length, 2);
      assert.equal(parsed.servers[0].url, 'http://127.0.0.1:4399/v1');
      assert.equal(parsed.servers[0].isLoopback, true);
      assert.equal(parsed.servers[1].url, 'https://api.example.com/v1');
      assert.equal(parsed.servers[1].isLoopback, false);

      // Endpoint 1: GET /projects/{id}
      const getProj = parsed.endpoints.find((e) => e.method === 'GET' && e.path === '/projects/{id}');
      assert.ok(getProj);
      assert.equal(getProj.operationId, 'getProject');
      assert.deepEqual(getProj.tags, ['projects', 'core']);
      assert.equal(getProj.resolvedLoopbackUrl, 'http://127.0.0.1:4399/v1/projects/proj_42?verbose=true');
      assert.equal(getProj.sampleHeaders['X-Trace-Id'], 'trace-99');
      assert.equal(getProj.sampleHeaders.Authorization, '[REDACTED]');

      // Endpoint 2: POST /reviews with $ref sampleBody + depth cap + secret redaction
      const postReview = parsed.endpoints.find((e) => e.method === 'POST' && e.path === '/reviews');
      assert.ok(postReview);
      assert.equal(postReview.sampleHeaders['Content-Type'], 'application/json');
      assert.ok(postReview.sampleBody);
      assert.doesNotMatch(postReview.sampleBody, /ghp_1234567890abcdefghijklmnopqrstuvwx/);
      const bodyObj = JSON.parse(postReview.sampleBody) as Record<string, unknown>;
      assert.equal(bodyObj.title, 'Audit & verify *all* paths');
      assert.equal(bodyObj.priority, 2);
      assert.equal(bodyObj.apiKey, '[REDACTED]');
      assert.equal(bodyObj.note, 'ref [REDACTED:GITHUB_TOKEN]');
      // Depth 3 stops nested expansion cleanly
      const nested = bodyObj.nested as Record<string, unknown>;
      assert.equal(nested.flag, true);
      const deep = nested.deep as Record<string, unknown>;
      assert.deepEqual(deep.level3, {});

      // Endpoint 3: Circular $ref terminates safely
      const postTree = parsed.endpoints.find((e) => e.method === 'POST' && e.path === '/tree');
      assert.ok(postTree?.sampleBody);
      const treeObj = JSON.parse(postTree.sampleBody) as Record<string, unknown>;
      assert.equal(treeObj.name, 'sample');

      // inspectStudioDocument must preserve existing fields and attach openApiSpec
      const docRes = inspectStudioDocument(ws, { filePath: 'api/openapi.yaml', startLine: 1, maxLines: 20 });
      assert.equal(docRes.format, 'yaml');
      assert.ok(docRes.lines.length > 0);
      assert.ok(docRes.openApiSpec);
      assert.equal(docRes.openApiSpec.title, 'Workbench API: Health & Reviews');
      assert.equal(docRes.openApiSpec.totalEndpoints, 4);
    });
  });

  it('2. parses Swagger 2.0 JSON with host/basePath, body schema, and maps non-loopback servers to 127.0.0.1 with warnings', async () => {
    await withTempDir('agy-nov-swagger2-', (ws) => {
      const swaggerDoc = {
        swagger: '2.0',
        info: {
          title: 'Legacy Billing Swagger',
          version: '2.1.0',
        },
        schemes: ['https'],
        host: 'billing.production.example.com',
        basePath: '/api/v2',
        definitions: {
          ChargeRequest: {
            type: 'object',
            properties: {
              amountCents: { type: 'integer', example: 2500 },
              currency: { type: 'string', enum: ['USD', 'EUR'] },
              dryRun: { type: 'boolean', default: true },
            },
          },
        },
        paths: {
          '/invoices/{invoiceId}': {
            get: {
              summary: 'Retrieve invoice',
              tags: ['billing'],
              parameters: [
                { name: 'invoiceId', in: 'path', required: true, type: 'string', default: 'inv_88' },
                { name: 'expand', in: 'query', required: true, type: 'string', enum: ['lines'] },
              ],
            },
          },
          '/charges': {
            post: {
              summary: 'Create charge',
              tags: ['billing'],
              parameters: [
                {
                  name: 'payload',
                  in: 'body',
                  required: true,
                  schema: { $ref: '#/definitions/ChargeRequest' },
                },
              ],
            },
          },
        },
      };

      fs.writeFileSync(path.join(ws, 'swagger.json'), JSON.stringify(swaggerDoc, null, 2), 'utf8');

      const parsed = parseStudioOpenApiFile(ws, 'swagger.json');
      assert.equal(parsed.specVersion, '2.0');
      assert.equal(parsed.title, 'Legacy Billing Swagger');
      assert.equal(parsed.apiVersion, '2.1.0');

      // Non-loopback server must be marked isLoopback: false and fallback mapped to 127.0.0.1:3000
      assert.equal(parsed.servers.length, 1);
      assert.equal(parsed.servers[0].url, 'https://billing.production.example.com/api/v2');
      assert.equal(parsed.servers[0].isLoopback, false);
      assert.ok(parsed.warnings.some((w) => /127\.0\.0\.1:3000/i.test(w)));

      const getInv = parsed.endpoints.find((e) => e.method === 'GET' && e.path === '/invoices/{invoiceId}');
      assert.ok(getInv);
      assert.equal(getInv.resolvedLoopbackUrl, 'http://127.0.0.1:3000/api/v2/invoices/inv_88?expand=lines');
      assert.equal(validateLoopbackProbeUrl(getInv.resolvedLoopbackUrl).hostname, '127.0.0.1');

      const postCharge = parsed.endpoints.find((e) => e.method === 'POST' && e.path === '/charges');
      assert.ok(postCharge?.sampleBody);
      assert.equal(postCharge.resolvedLoopbackUrl, 'http://127.0.0.1:3000/api/v2/charges');
      const chargeBody = JSON.parse(postCharge.sampleBody) as Record<string, unknown>;
      assert.deepEqual(chargeBody, {
        amountCents: 2500,
        currency: 'USD',
        dryRun: true,
      });

      // inspectStudioDocument also attaches openApiSpec for JSON Swagger files
      const docRes = inspectStudioDocument(ws, { filePath: 'swagger.json' });
      assert.equal(docRes.format, 'json');
      assert.equal(docRes.openApiSpec?.specVersion, '2.0');
      assert.equal(docRes.openApiSpec?.endpoints.length, 2);
    });
  });

  it('3. blocks prototype pollution (__proto__/constructor/prototype), YAML anchors/aliases, >24 nesting depth, >20k lines, >2 MiB files, and out-of-workspace/sensitive paths', async () => {
    await withTempDir('agy-nov-openapi-sec-', (tmpRoot) => {
      const ws = path.join(tmpRoot, 'ws');
      const outside = path.join(tmpRoot, 'outside');
      fs.mkdirSync(path.join(ws, 'secrets'), { recursive: true });
      fs.mkdirSync(outside, { recursive: true });

      // 3a. Prototype pollution keys in YAML & JSON must never pollute Object.prototype or leak into sampleBody
      const pollutedYaml = [
        'openapi: 3.0.3',
        '__proto__:',
        '  pollutedFromYaml: true',
        'constructor:',
        '  prototype:',
        '    evilYaml: true',
        'info:',
        '  title: Safe Spec',
        'paths:',
        '  /submit:',
        '    post:',
        '      requestBody:',
        '        content:',
        '          application/json:',
        '            schema:',
        '              type: object',
        '              properties:',
        '                __proto__:',
        '                  type: string',
        '                  example: pwned',
        '                constructor:',
        '                  type: string',
        '                  example: pwned',
        '                prototype:',
        '                  type: string',
        '                  example: pwned',
        '                safeField:',
        '                  type: string',
        '                  example: clean',
      ].join('\n');

      const yamlRes = parseOpenApiSpecFromContent('polluted.yaml', pollutedYaml, '.yaml');
      assert.equal(({} as Record<string, unknown>).pollutedFromYaml, undefined);
      assert.equal(({} as Record<string, unknown>).evilYaml, undefined);
      assert.equal(yamlRes.endpoints.length, 1);
      const yamlBody = JSON.parse(yamlRes.endpoints[0].sampleBody ?? '{}') as Record<string, unknown>;
      assert.deepEqual(Object.keys(yamlBody), ['safeField']);
      assert.equal(yamlBody.safeField, 'clean');

      const pollutedJson = JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'JSON Pollution Guard' },
        paths: {
          '/items': {
            post: {
              requestBody: {
                content: {
                  'application/json': {
                    example: JSON.parse(
                      '{"__proto__":{"pollutedFromJson":true},"constructor":"bad","prototype":"bad","ok":true}',
                    ),
                  },
                },
              },
            },
          },
        },
      });
      const jsonRes = parseOpenApiSpecFromContent('polluted.json', pollutedJson, '.json');
      assert.equal(({} as Record<string, unknown>).pollutedFromJson, undefined);
      const jsonBody = JSON.parse(jsonRes.endpoints[0].sampleBody ?? '{}') as Record<string, unknown>;
      assert.deepEqual(Object.keys(jsonBody), ['ok']);

      // 3b. YAML anchors (&) / aliases (*) Billion Laughs bomb MUST be rejected
      const billionLaughsYaml = [
        'openapi: 3.0.3',
        'x-a: &a ["lol","lol","lol","lol"]',
        'x-b: &b [*a,*a,*a,*a]',
        'info:',
        '  title: Bomb',
        'paths: {}',
      ].join('\n');
      assert.throws(
        () => parseOpenApiSpecFromContent('bomb.yaml', billionLaughsYaml, '.yaml'),
        /anchors.*aliases.*not supported/i,
      );

      const mergeKeyYaml = [
        'openapi: 3.0.3',
        'info:',
        '  title: Merge Key',
        '  <<: {}',
        'paths: {}',
      ].join('\n');
      assert.throws(
        () => parseOpenApiSpecFromContent('merge.yaml', mergeKeyYaml, '.yaml'),
        /merge keys.*not supported/i,
      );

      // 3c. Deeply nested YAML (> 24 levels) and JSON (> 24 levels) MUST be rejected
      const deepYamlLines = ['openapi: 3.0.3', 'info:', '  title: Deep', 'x-deep:'];
      for (let d = 1; d <= 25; d += 1) {
        deepYamlLines.push(`${'  '.repeat(d)}k${d}:${d === 25 ? ' boom' : ''}`);
      }
      assert.throws(
        () => parseOpenApiSpecFromContent('deep.yaml', deepYamlLines.join('\n'), '.yaml'),
        /maximum nesting depth of 24/i,
      );

      let deepJsonObj: Record<string, unknown> = { leaf: 'boom' };
      for (let d = 0; d < 25; d += 1) {
        deepJsonObj = { nested: deepJsonObj };
      }
      const deepJsonStr = JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'Deep JSON' },
        'x-deep': deepJsonObj,
      });
      assert.throws(
        () => parseOpenApiSpecFromContent('deep.json', deepJsonStr, '.json'),
        /maximum nesting depth of 24/i,
      );

      // 3d. Exceeding 20,000 YAML lines MUST be rejected
      const tooManyLinesYaml = [
        'openapi: 3.0.3',
        'info:',
        '  title: Huge Lines',
        ...Array.from({ length: OPENAPI_MAX_YAML_LINES + 5 }, () => '# comment'),
      ].join('\n');
      assert.throws(
        () => parseOpenApiSpecFromContent('lines.yaml', tooManyLinesYaml, '.yaml'),
        /maximum line limit/i,
      );

      // 3e. File exceeding 2 MiB MUST be rejected before parsing
      const hugeFile = path.join(ws, 'huge-openapi.json');
      fs.writeFileSync(
        hugeFile,
        `{"openapi":"3.0.3","info":{"title":"Big"},"x-pad":"${'A'.repeat(OPENAPI_MAX_FILE_BYTES + 128)}"}`,
        'utf8',
      );
      assert.throws(
        () => parseStudioOpenApiFile(ws, 'huge-openapi.json'),
        /2 MiB/i,
      );

      // 3f. Endpoint cap at 200 entries with truncation flag
      const manyPaths: Record<string, unknown> = {};
      for (let i = 0; i < OPENAPI_MAX_ENDPOINTS + 5; i += 1) {
        manyPaths[`/op-${i}`] = { get: { summary: `Op ${i}` } };
      }
      const cappedRes = parseOpenApiSpecFromContent(
        'many.json',
        JSON.stringify({ openapi: '3.0.3', info: { title: 'Many' }, paths: manyPaths }),
        '.json',
      );
      assert.equal(cappedRes.totalEndpoints, OPENAPI_MAX_ENDPOINTS + 5);
      assert.equal(cappedRes.endpoints.length, OPENAPI_MAX_ENDPOINTS);
      assert.equal(cappedRes.truncated, true);

      // 3g. Workspace boundary & sensitive paths MUST be rejected
      const outsideSpec = path.join(outside, 'external-openapi.yaml');
      fs.writeFileSync(outsideSpec, 'openapi: 3.0.3\ninfo:\n  title: Outside\npaths: {}\n', 'utf8');
      fs.symlinkSync(outsideSpec, path.join(ws, 'escape-openapi.yaml'));
      fs.writeFileSync(path.join(ws, 'secrets', 'openapi.yaml'), 'openapi: 3.0.3\npaths: {}\n', 'utf8');

      assert.throws(() => parseStudioOpenApiFile(ws, '../outside/external-openapi.yaml'), /escapes workspace/i);
      assert.throws(() => parseStudioOpenApiFile(ws, 'escape-openapi.yaml'), /escapes workspace/i);
      assert.throws(() => parseStudioOpenApiFile(ws, 'secrets/openapi.yaml'), /sensitive|restricted/i);

      // 3h. Boundary check: YAML with server template variables, block scalars, zero-indent sequences, and 20-level valid depth parses cleanly
      const edgeYaml = [
        '---',
        'openapi: 3.1.0',
        'info:',
        '  title: Edge Case API',
        'servers:',
        '  - url: http://localhost:{port}/api',
        '    variables:',
        '      port:',
        '        default: "8088"',
        'paths:',
        "  '/items/{id}:sync':",
        '    patch:',
        '      summary: >-',
        '        Sync an item',
        '        with folded block text',
        '      tags:',
        '      - sync',
        '      - batch',
        '      parameters:',
        '      - name: id',
        '        in: path',
        '        required: true',
        '        schema:',
        '          type: integer',
      ].join('\n');
      const edgeRes = parseOpenApiSpecFromContent('edge.yaml', edgeYaml, '.yaml');
      assert.equal(edgeRes.servers[0]?.url, 'http://localhost:8088/api');
      assert.equal(edgeRes.servers[0]?.isLoopback, true);
      assert.equal(edgeRes.endpoints.length, 1);
      assert.equal(edgeRes.endpoints[0].method, 'PATCH');
      assert.equal(edgeRes.endpoints[0].path, '/items/{id}:sync');
      assert.equal(edgeRes.endpoints[0].summary, 'Sync an item with folded block text');
      assert.deepEqual(edgeRes.endpoints[0].tags, ['sync', 'batch']);
      assert.equal(edgeRes.endpoints[0].resolvedLoopbackUrl, 'http://localhost:8088/api/items/1:sync');
    });
  });

  it('4. preserves 4 model tools on McpServer, keeps demoMode strictly zero-disk-write, and serves 4 demo endpoints via app_studio_parse_openapi', async () => {
    await withTempDir('agy-nov-openapi-demo-', async (tmpDir) => {
      const absentDataDir = path.join(tmpDir, 'never-created-data');
      const absentWorkspace = path.join(tmpDir, 'never-created-ws');

      const server = new McpServer(
        { name: 'studio-openapi-demo', version: '0.5.0' },
        { capabilities: { tools: { listChanged: true } } },
      );

      const reg = registerStudioModule(
        server,
        {
          dataDir: absentDataDir,
          workspaceRoot: absentWorkspace,
          demoMode: true,
        },
        'ui://agy-nov/app.html',
      );

      // Strictly 4 model tools aligned with MODULE_CATALOG
      assert.equal(reg.modelTools.length, 4);
      assert.deepEqual(
        reg.modelTools.map((t) => t.name),
        MODULE_CATALOG.studio.modelToolNames,
      );
      assert.deepEqual(reg.exemptReadOnlyAppTools, ['app_studio_list_sources', 'app_nov_file_viewer']);

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'studio-openapi-client', version: '0.5.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      try {
        const listed = await client.listTools();
        const modelNames = listed.tools
          .filter((t) => !t.name.startsWith('app_'))
          .map((t) => t.name)
          .sort();
        assert.deepEqual(modelNames, [
          'studio_http_probe',
          'studio_inspect_data',
          'studio_inspect_document',
          'studio_list_sources',
        ]);

        const parseTool = listed.tools.find((t) => t.name === 'app_studio_parse_openapi');
        assert.ok(parseTool);
        assert.deepEqual(
          (parseTool._meta as { ui?: { resourceUri?: string; visibility?: string[] } } | undefined)?.ui,
          { resourceUri: 'ui://agy-nov/app.html', visibility: ['app'] },
        );

        // Call app_studio_parse_openapi in demoMode
        const parseCall = await client.callTool({
          name: 'app_studio_parse_openapi',
          arguments: { filePath: 'api/openapi.yaml' },
        });
        assert.equal(parseCall.isError, undefined);
        const spec = parseCall.structuredContent as unknown as ParsedOpenApiSpec;
        assert.equal(spec.filePath, 'api/openapi.yaml');
        assert.equal(spec.totalEndpoints, 4);
        assert.deepEqual(
          spec.endpoints.map((ep) => `${ep.method} ${ep.path}`),
          [
            'GET /api/health',
            'GET /api/projects/{id}',
            'POST /api/reviews',
            'DELETE /api/cache',
          ],
        );
        assert.ok(spec.servers.some((s) => s.isLoopback));
        assert.ok(spec.servers.some((s) => !s.isLoopback));
        for (const ep of spec.endpoints) {
          assert.doesNotThrow(() => validateLoopbackProbeUrl(ep.resolvedLoopbackUrl));
        }
        const postReviews = spec.endpoints.find((ep) => ep.method === 'POST' && ep.path === '/api/reviews');
        assert.ok(postReviews?.sampleBody);

        // studio_inspect_document in demoMode also includes openApiSpec
        const docCall = await client.callTool({
          name: 'studio_inspect_document',
          arguments: { filePath: 'api/openapi.yaml' },
        });
        assert.equal(docCall.isError, undefined);
        const docRes = docCall.structuredContent as unknown as StudioDocumentResult;
        assert.equal(docRes.openApiSpec?.endpoints.length, 4);

        // Sensitive path rejected even in demoMode
        const badCall = await client.callTool({
          name: 'app_studio_parse_openapi',
          arguments: { filePath: '.env' },
        });
        assert.equal(badCall.isError, true);

        // Strictly zero disk writes
        assert.equal(fs.existsSync(absentDataDir), false);
        assert.equal(fs.existsSync(absentWorkspace), false);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });

  it('5. end-to-end live flow: parsed OpenAPI endpoint loads directly into real loopback HTTP probe', async () => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/echo') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, received: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
        });
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      await withTempDir('agy-nov-openapi-e2e-', async (ws) => {
        const specYaml = [
          'openapi: 3.1.0',
          'info:',
          '  title: Loopback E2E API',
          'servers:',
          `  - url: http://127.0.0.1:${port}`,
          'paths:',
          '  /api/echo:',
          '    post:',
          '      summary: Echo payload',
          '      requestBody:',
          '        content:',
          '          application/json:',
          '            example:',
          '              hello: loopback',
        ].join('\n');

        fs.writeFileSync(path.join(ws, 'openapi.yaml'), specYaml, 'utf8');
        const parsed = parseStudioOpenApiFile(ws, 'openapi.yaml');
        assert.equal(parsed.endpoints.length, 1);

        const ep = parsed.endpoints[0];
        const probeRes = await runLoopbackHttpProbe({
          url: ep.resolvedLoopbackUrl,
          method: ep.method,
          headers: ep.sampleHeaders,
          body: ep.sampleBody,
        });
        assert.equal(probeRes.status, 200);
        const body = JSON.parse(probeRes.bodyText) as { ok: boolean; received: { hello: string } };
        assert.equal(body.ok, true);
        assert.equal(body.received.hello, 'loopback');
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('6. neutralizes $ref/allOf DAG exponential DoS, deep oneOf chains, sensitive parameter examples, and colon-bearing anchors', () => {
    // 6a. 10-layer $ref + allOf DAG exponential fan-out (2^10 = 1024 without step budget) completes swiftly
    const dagSchemas: Record<string, unknown> = {
      Leaf: { type: 'object', properties: { v: { type: 'string', example: 'ok' } } },
    };
    for (let i = 1; i <= 10; i += 1) {
      const prev = i === 1 ? 'Leaf' : `L${i - 1}`;
      dagSchemas[`L${i}`] = {
        allOf: [
          { $ref: `#/components/schemas/${prev}` },
          { $ref: `#/components/schemas/${prev}` },
        ],
      };
    }
    const dagSpec = JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'DAG DoS Guard' },
      components: { schemas: dagSchemas },
      paths: {
        '/dag': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/L10' },
                },
              },
            },
          },
        },
      },
    });
    const t0 = Date.now();
    const dagParsed = parseOpenApiSpecFromContent('dag.json', dagSpec, '.json');
    const elapsedMs = Date.now() - t0;
    assert.equal(dagParsed.endpoints.length, 1);
    assert.ok(elapsedMs < 200, `DAG synthesis took too long: ${elapsedMs}ms`);

    // 6b. Deep oneOf chain via $ref (1000 chained schemas) must never overflow stack
    const chainSchemas: Record<string, unknown> = {
      N0: { type: 'string', example: 'end' },
    };
    for (let i = 1; i <= 1000; i += 1) {
      chainSchemas[`N${i}`] = {
        oneOf: [{ $ref: `#/components/schemas/N${i - 1}` }],
      };
    }
    const chainSpec = JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Deep oneOf Guard' },
      components: { schemas: chainSchemas },
      paths: {
        '/chain': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/N1000' },
                },
              },
            },
          },
        },
      },
    });
    const chainParsed = parseOpenApiSpecFromContent('chain.json', chainSpec, '.json');
    assert.equal(chainParsed.endpoints.length, 1);

    // 6c. Sensitive parameter names (X-Api-Key, api_key, client_secret) redact parameters[].example even without token prefix
    const paramSpec = JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Param Secret Guard' },
      servers: [{ url: 'http://127.0.0.1:4399' }],
      paths: {
        '/secure': {
          get: {
            parameters: [
              { name: 'X-Api-Key', in: 'header', example: 'raw-unprefixed-key-999' },
              { name: 'api_key', in: 'query', required: true, example: 'query-secret-abc' },
              { name: 'client_secret', in: 'cookie', example: 'cookie-secret-xyz' },
              { name: 'page', in: 'query', required: true, example: '2' },
            ],
          },
        },
      },
    });
    const paramParsed = parseOpenApiSpecFromContent('params.json', paramSpec, '.json');
    const ep = paramParsed.endpoints[0];
    assert.ok(ep);
    assert.equal(ep.parameters.find((p) => p.name === 'X-Api-Key')?.example, '[REDACTED]');
    assert.equal(ep.parameters.find((p) => p.name === 'api_key')?.example, '[REDACTED]');
    assert.equal(ep.parameters.find((p) => p.name === 'client_secret')?.example, '[REDACTED]');
    assert.equal(ep.parameters.find((p) => p.name === 'page')?.example, '2');
    assert.equal(ep.sampleHeaders['X-Api-Key'], '[REDACTED]');
    assert.doesNotMatch(ep.resolvedLoopbackUrl, /query-secret-abc/);

    // 6d. Colon-bearing YAML anchor (&a:b) must be rejected
    const colonAnchorYaml = [
      'openapi: 3.0.3',
      'info:',
      '  title: Anchor Bypass',
      'x-evil: &a:b [1, 2]',
      'paths: {}',
    ].join('\n');
    assert.throws(
      () => parseOpenApiSpecFromContent('colon-anchor.yaml', colonAnchorYaml, '.yaml'),
      /anchors.*aliases.*not supported/i,
    );
  });
});
