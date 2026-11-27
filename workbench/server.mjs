import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const uiHtmlPath = path.join(rootDir, 'dist', 'ui', 'app.html');
const serverBundle = path.join(rootDir, 'dist', 'server.cjs');

function getFlag(flag) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag && argv[i + 1]) return argv[i + 1];
    if (argv[i].startsWith(`${flag}=`)) return argv[i].slice(flag.length + 1);
  }
  return undefined;
}

const portRaw = getFlag('--port') ?? process.env.PORT ?? '4399';
const parsedPort = Number(portRaw);
const port = Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535 ? parsedPort : 4399;
const smokeMode = process.argv.includes('--smoke');
const useLocal = process.argv.includes('--local');
const workspaceDir = path.resolve(getFlag('--repo') ?? getFlag('--workspace') ?? rootDir);
const customDataDir = getFlag('--data-dir');
const tempDataDir = customDataDir ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'agy-nov-wb-'));
const dataDir = customDataDir ? path.resolve(customDataDir) : tempDataDir;

class StdioMcpClient {
  constructor() {
    const args = [serverBundle, `--data-dir=${dataDir}`, `--workspace=${workspaceDir}`];
    if (!useLocal) args.push('--demo');
    this.proc = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'inherit'] });
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      let idx;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message || 'MCP error'));
            else resolve(msg.result);
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    });
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async init() {
    await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'agy-nov-workbench', version: '0.8.0' },
    });
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  }

  async callTool(name, args = {}) {
    return this.request('tools/call', { name, arguments: args });
  }

  close() {
    try {
      this.proc.stdin.end();
      this.proc.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
}

const mcp = new StdioMcpClient();
await mcp.init();

const hostShell = () => `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>agy-NOV — Offline Workbench (Zero-Touch Native Simulator)</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #070b12; color: #e2e8f0; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
    .bar { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; background: #0f172a; border-bottom: 1px solid #1e293b; font-size: 12.5px; gap: 10px; flex-wrap: wrap; }
    .bar button, .bar select { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
    .bar button:hover, .bar select:hover { border-color: #38bdf8; }
    .body { flex: 1; display: flex; min-height: 0; gap: 12px; padding: 12px; }
    .stage { flex: 1; display: flex; justify-content: center; min-width: 0; }
    iframe { border: 1px solid #334155; border-radius: 12px; height: 100%; background: #0b111c; transition: width 160ms ease; }
    .inspector { width: 320px; background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; }
    .inspector.hidden { display: none; }
    .inspector-head { padding: 8px 12px; border-bottom: 1px solid #1e293b; font-weight: 600; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
    .inspector-log { flex: 1; overflow: auto; padding: 10px; font-family: ui-monospace, monospace; font-size: 11px; color: #94a3b8; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <div class="bar">
    <div><strong>agy-NOV v0.8.0 Offline Workbench</strong> · Mode: <code>${useLocal ? 'Local Workspace' : 'Synthetic Demo'}</code> · Zero ASAR / Zero CDP · Daily Antigravity untouched</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
      <button onclick="setWidth('480px')">Aux Pane (480px)</button>
      <button onclick="setWidth('1160px')">Global (1160px)</button>
      <button onclick="toggleTheme()">Dark / Light</button>
      <select id="wb-locale" aria-label="Simulate Host Language" onchange="setHostLocale(this.value)">
        <option value="en">Host Locale: English</option>
        <option value="zh-CN">Host Locale: 简体中文</option>
        <option value="zh-TW">Host Locale: 繁體中文</option>
        <option value="ja">Host Locale: 日本語</option>
        <option value="ko">Host Locale: 한국어</option>
        <option value="es">Host Locale: Español</option>
        <option value="fr">Host Locale: Français</option>
        <option value="de">Host Locale: Deutsch</option>
      </select>
      <button onclick="toggleInspector()">Host Events</button>
    </div>
  </div>
  <div class="body">
    <div class="stage">
      <iframe id="frame" src="/app" style="width: 1160px;"></iframe>
    </div>
    <aside id="inspector" class="inspector hidden">
      <div class="inspector-head">
        <span>Simulated Host Events</span>
        <button onclick="document.getElementById('log').textContent=''">Clear</button>
      </div>
      <div id="log" class="inspector-log">Waiting for sendMessage / updateModelContext / openFile events...</div>
    </aside>
  </div>
  <script>
    let theme = 'dark';
    function setWidth(w) { document.getElementById('frame').style.width = w; }
    function toggleTheme() {
      theme = theme === 'dark' ? 'light' : 'dark';
      const frame = document.getElementById('frame');
      frame.contentWindow?.postMessage({ type: 'nov-workbench-theme', theme }, '*');
      if (frame.contentDocument) frame.contentDocument.documentElement.dataset.theme = theme;
    }
    function setHostLocale(locale) {
      const frame = document.getElementById('frame');
      frame.contentWindow?.postMessage({ type: 'nov-workbench-locale', locale }, '*');
    }
    function toggleInspector() {
      document.getElementById('inspector').classList.toggle('hidden');
    }
    window.addEventListener('message', (evt) => {
      if (evt.data && evt.data.type === 'nov-workbench-event') {
        const log = document.getElementById('log');
        const entry = '[' + new Date().toLocaleTimeString() + '] ' + evt.data.kind + '\\n' + JSON.stringify(evt.data.payload, null, 2) + '\\n\\n';
        log.textContent = entry + log.textContent;
      }
    });
  </script>
</body>
</html>`;

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body exceeds 2 MiB limit'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const addr = server.address();
  const actualPort = addr && typeof addr === 'object' ? addr.port : port;
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${actualPort}`);
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(hostShell());
    return;
  }
  if (url.pathname === '/app') {
    const html = fs
      .readFileSync(uiHtmlPath, 'utf8')
      .replace('<head>', '<head><script>window.__AGY_NOV_WORKBENCH__ = true;</script>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if (url.pathname === '/api/tools' && req.method === 'GET') {
    try {
      const list = await mcp.request('tools/list', {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }
  if (url.pathname.startsWith('/api/tool/') && req.method === 'POST') {
    const toolName = decodeURIComponent(url.pathname.slice('/api/tool/'.length));
    try {
      const args = await readJsonBody(req);
      const result = await mcp.callTool(toolName, args);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

function cleanup() {
  mcp.close();
  server.close();
  if (tempDataDir) {
    try {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

function httpGetStatus(targetUrl) {
  return new Promise((resolve, reject) => {
    const req = http.get(targetUrl, { timeout: 3000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Timeout fetching ${targetUrl}`)));
  });
}

server.listen(port, '127.0.0.1', async () => {
  const addr = server.address();
  const actualPort = addr && typeof addr === 'object' ? addr.port : port;
  const baseUrl = `http://127.0.0.1:${actualPort}`;
  if (smokeMode) {
    try {
      const rootRes = await httpGetStatus(`${baseUrl}/`);
      const appRes = await httpGetStatus(`${baseUrl}/app`);
      const toolsRes = await httpGetStatus(`${baseUrl}/api/tools`);
      const parsedTools = JSON.parse(toolsRes.body);
      if (
        rootRes.status !== 200 ||
        appRes.status !== 200 ||
        toolsRes.status !== 200 ||
        !Array.isArray(parsedTools?.tools)
      ) {
        throw new Error(
          `Unexpected smoke status: /=${rootRes.status}, /app=${appRes.status}, /api/tools=${toolsRes.status}`,
        );
      }
      console.log(`agy-NOV workbench smoke pass (/=200, /app=200, /api/tools=200, tools=${parsedTools.tools.length})`);
      cleanup();
      process.exit(0);
    } catch (err) {
      console.error(`agy-NOV workbench smoke failed: ${err instanceof Error ? err.message : String(err)}`);
      cleanup();
      process.exit(1);
    }
  } else {
    console.log(`agy-NOV offline workbench running at ${baseUrl}`);
  }
});
