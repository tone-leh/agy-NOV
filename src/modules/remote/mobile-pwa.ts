export function renderMobilePwaHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0b111b" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <title>Agy Remote · Mobile Controller</title>
  <style>
    :root { --bg:#0b111b; --card:#131c2e; --card2:#1a263d; --fg:#f1f5f9; --muted:#94a3b8; --border:#24324c; --accent:#38bdf8; --good:#10b981; --warn:#f59e0b; --danger:#f43f5e; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--fg); font-family:-apple-system,BlinkMacSystemFont,'Inter',system-ui,sans-serif; font-size:14px; padding-bottom:28px; }
    .hdr { position:sticky; top:0; z-index:10; background:rgba(11,17,27,0.92); backdrop-filter:blur(10px); border-bottom:1px solid var(--border); padding:12px 14px; display:flex; justify-content:space-between; align-items:center; }
    .brand { display:flex; align-items:center; gap:8px; font-weight:700; font-size:15px; }
    .dot { width:9px; height:9px; border-radius:99px; background:var(--good); box-shadow:0 0 8px var(--good); }
    .wrap { max-width:520px; margin:0 auto; padding:12px; display:flex; flex-direction:column; gap:12px; }
    .card { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:13px; }
    .title { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--muted); margin-bottom:9px; display:flex; justify-content:space-between; }
    .pill { font-size:11px; padding:2px 8px; border-radius:99px; font-family:ui-monospace,monospace; background:var(--card2); color:var(--accent); }
    .pill.run { color:var(--good); background:rgba(16,185,129,0.16); }
    .pill.warn { color:var(--warn); background:rgba(245,158,11,0.16); }
    .item { background:var(--card2); border:1px solid var(--border); border-radius:11px; padding:10px; margin-bottom:8px; }
    .item-head { display:flex; justify-content:space-between; gap:8px; align-items:center; }
    .cmd { font-family:ui-monospace,monospace; font-size:12px; color:#fde68a; word-break:break-all; margin:6px 0; background:#0b111b; padding:8px; border-radius:8px; white-space:pre-wrap; }
    .row { display:flex; gap:8px; }
    button { border:none; border-radius:10px; padding:10px 12px; font-weight:700; font-size:13px; cursor:pointer; }
    .btn-ok { flex:1; background:var(--good); color:#042f2e; }
    .btn-no { flex:1; background:var(--danger); color:#fff; }
    .btn-send { width:100%; background:var(--accent); color:#082f49; margin-top:8px; }
    textarea, select, input { width:100%; background:#0b111b; color:var(--fg); border:1px solid var(--border); border-radius:10px; padding:10px; font-size:13px; font-family:inherit; }
    .muted { color:var(--muted); font-size:12px; }
    .err { color:#fda4af; font-size:12px; margin-top:6px; }
  </style>
</head>
<body>
  <div class="hdr">
    <div class="brand"><span class="dot" id="dot"></span> Agy Remote</div>
    <span class="pill" id="statusPill">Connecting…</span>
  </div>
  <div class="wrap">
    <div class="card" id="authCard" style="display:none">
      <div class="title"><span>Pair Device</span></div>
      <p class="muted">Enter your 6-digit Pairing PIN from the Agy Remote Hub panel.</p>
      <input id="pinInput" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit Pairing PIN" />
      <button id="pairBtn" type="button" class="btn-send">Unlock Controller</button>
      <div id="pairMsg" class="err"></div>
    </div>

    <div class="card">
      <div class="title"><span>Pending Approvals</span><span class="pill warn" id="pendingCount">0</span></div>
      <div id="approvalsBox"><div class="muted">No risky tool calls awaiting approval.</div></div>
    </div>

    <div class="card">
      <div class="title"><span>Dispatch New Task</span><span class="pill">ConversationService</span></div>
      <select id="modelSel" style="margin-bottom:8px">
        <option value="flash">Model: Flash (Fast)</option>
        <option value="pro">Model: Pro (Deep)</option>
        <option value="flash_lite">Model: Flash Lite</option>
      </select>
      <textarea id="promptInput" rows="3" placeholder="Tell your desktop Antigravity what to build, test, or investigate..."></textarea>
      <button id="dispatchBtn" type="button" class="btn-send">Send to Desktop Antigravity</button>
      <div id="dispatchMsg" class="muted" style="margin-top:6px"></div>
    </div>

    <div class="card">
      <div class="title"><span>Desktop Conversations</span><span class="pill" id="convCount">0</span></div>
      <div id="convBox"><div class="muted">Loading…</div></div>
    </div>
  </div>
  <script>
    (function () {
      const STORAGE_KEY = 'agy_remote_token';
      const params = new URLSearchParams(location.search);
      const urlToken = params.get('token');
      let token = urlToken || localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY) || '';
      let eventSource = null;

      if (urlToken) {
        try { localStorage.setItem(STORAGE_KEY, urlToken); } catch {}
        try { sessionStorage.setItem(STORAGE_KEY, urlToken); } catch {}
        try { history.replaceState(null, '', location.pathname); } catch {}
      }

      function saveToken(nextToken) {
        token = nextToken;
        try { localStorage.setItem(STORAGE_KEY, nextToken); } catch {}
        try { sessionStorage.setItem(STORAGE_KEY, nextToken); } catch {}
      }

      function authHeaders() {
        return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
      }

      function createTextElement(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        el.textContent = text;
        return el;
      }

      async function pairWithPin() {
        const pinEl = document.getElementById('pinInput');
        const msgEl = document.getElementById('pairMsg');
        const pin = pinEl.value.trim();
        msgEl.textContent = '';
        if (!pin) {
          msgEl.textContent = 'Please enter the 6-digit PIN.';
          return;
        }
        const res = await fetch('/api/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin }),
        });
        if (!res.ok) {
          let errMsg = res.status === 429 ? 'Too many attempts. Locked for 15 minutes.' : 'Invalid or expired PIN.';
          try {
            const errData = await res.json();
            if (errData && typeof errData.error === 'string') errMsg = errData.error;
          } catch {}
          msgEl.textContent = errMsg;
          return;
        }
        const data = await res.json();
        saveToken(String(data.token || ''));
        pinEl.value = '';
        document.getElementById('authCard').style.display = 'none';
        boot();
      }

      async function decide(id, decision) {
        await fetch('/api/approvals/' + encodeURIComponent(String(id)) + '/decide', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ decision, actor: 'mobile-pwa' }),
        });
        await refreshAll();
      }

      async function dispatchTask() {
        const promptEl = document.getElementById('promptInput');
        const prompt = promptEl.value.trim();
        if (!prompt) return;
        const model = document.getElementById('modelSel').value;
        const msgEl = document.getElementById('dispatchMsg');
        msgEl.textContent = 'Dispatching…';
        const res = await fetch('/api/conversations', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ prompt, model }),
        });
        if (res.ok) {
          promptEl.value = '';
          msgEl.textContent = 'Task started on desktop Antigravity!';
          await refreshAll();
        } else {
          msgEl.textContent = 'Failed to dispatch task.';
        }
      }

      function renderApprovals(list) {
        const pending = (Array.isArray(list) ? list : []).filter(function (a) {
          return a && a.status === 'pending';
        });
        document.getElementById('pendingCount').textContent = String(pending.length);
        const box = document.getElementById('approvalsBox');
        if (!pending.length) {
          box.replaceChildren(createTextElement('div', 'muted', 'All clear — no commands waiting for approval.'));
          return;
        }
        const nodes = pending.map(function (a) {
          const item = document.createElement('div');
          item.className = 'item';

          const head = document.createElement('div');
          head.className = 'item-head';
          head.appendChild(createTextElement('strong', '', String(a.toolName || 'tool')));
          head.appendChild(createTextElement('span', 'pill warn', 'Action Needed'));
          item.appendChild(head);

          item.appendChild(createTextElement('div', 'cmd', String(a.summary || '')));

          const row = document.createElement('div');
          row.className = 'row';

          const approveBtn = createTextElement('button', 'btn-ok', 'Approve');
          approveBtn.type = 'button';
          approveBtn.addEventListener('click', function () {
            void decide(String(a.id || ''), 'approved');
          });

          const denyBtn = createTextElement('button', 'btn-no', 'Deny');
          denyBtn.type = 'button';
          denyBtn.addEventListener('click', function () {
            void decide(String(a.id || ''), 'denied');
          });

          row.appendChild(approveBtn);
          row.appendChild(denyBtn);
          item.appendChild(row);
          return item;
        });
        box.replaceChildren.apply(box, nodes);
      }

      function renderConvs(list) {
        const safeList = Array.isArray(list) ? list : [];
        document.getElementById('convCount').textContent = String(safeList.length);
        const box = document.getElementById('convBox');
        if (!safeList.length) {
          box.replaceChildren(createTextElement('div', 'muted', 'No conversations found.'));
          return;
        }
        const nodes = safeList.slice(0, 10).map(function (c) {
          const item = document.createElement('div');
          item.className = 'item';

          const head = document.createElement('div');
          head.className = 'item-head';

          const titleEl = createTextElement('strong', '', String(c.title || 'Untitled'));
          titleEl.style.fontSize = '13px';
          head.appendChild(titleEl);

          const rawState = String(c.runState || 'IDLE');
          const pillClass = rawState === 'RUN_STATE_RUNNING' ? 'pill run' : 'pill';
          head.appendChild(createTextElement('span', pillClass, rawState.replace('RUN_STATE_', '')));
          item.appendChild(head);

          const summaryEl = createTextElement('div', 'muted', String(c.summary || '').slice(0, 110));
          summaryEl.style.marginTop = '4px';
          item.appendChild(summaryEl);
          return item;
        });
        box.replaceChildren.apply(box, nodes);
      }

      async function refreshAll() {
        const res = await fetch('/api/state', { headers: authHeaders() });
        if (res.status === 401) {
          document.getElementById('authCard').style.display = 'block';
          document.getElementById('statusPill').textContent = 'Locked';
          return;
        }
        if (!res.ok) {
          document.getElementById('statusPill').textContent = 'Error';
          return;
        }
        const data = await res.json();
        document.getElementById('authCard').style.display = 'none';
        document.getElementById('statusPill').textContent = 'Connected';
        renderApprovals(data.approvals);
        renderConvs(data.conversations);
      }

      function boot() {
        void refreshAll();
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        if (token) {
          eventSource = new EventSource('/api/events?token=' + encodeURIComponent(token));
          eventSource.onmessage = function () {
            void refreshAll();
          };
        }
      }

      document.getElementById('pairBtn').addEventListener('click', function () {
        void pairWithPin();
      });
      document.getElementById('pinInput').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') void pairWithPin();
      });
      document.getElementById('dispatchBtn').addEventListener('click', function () {
        void dispatchTask();
      });

      boot();
    })();
  </script>
</body>
</html>`;
}
