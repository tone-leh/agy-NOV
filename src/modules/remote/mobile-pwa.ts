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
    .pill.ro { color:var(--good); background:rgba(16,185,129,0.14); border:1px solid rgba(16,185,129,0.35); font-size:10px; }
    .pill.err { color:#fda4af; background:rgba(244,63,94,0.16); }
    .pill.risk-high { color:#fecdd3; background:rgba(244,63,94,0.22); border:1px solid rgba(244,63,94,0.45); font-weight:700; }
    .pill.risk-medium { color:#fde68a; background:rgba(245,158,11,0.2); border:1px solid rgba(245,158,11,0.42); font-weight:700; }
    .pill.risk-low { color:#a7f3d0; background:rgba(16,185,129,0.18); border:1px solid rgba(16,185,129,0.38); font-weight:700; }
    .pill.v-pass { color:#6ee7b7; background:rgba(16,185,129,0.16); border:1px solid rgba(16,185,129,0.35); }
    .pill.v-fail { color:#fda4af; background:rgba(244,63,94,0.18); border:1px solid rgba(244,63,94,0.38); }
    .pill.v-blocked { color:#fcd34d; background:rgba(245,158,11,0.18); border:1px solid rgba(245,158,11,0.38); }
    .pill.v-muted { color:var(--muted); background:#0b111b; border:1px solid var(--border); }
    .risk-meta { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:7px; }
    .risk-target { font-size:12px; color:var(--fg); margin-top:6px; word-break:break-word; }
    .risk-verify-note { font-size:11px; color:var(--muted); margin-top:4px; word-break:break-word; }
    .item { background:var(--card2); border:1px solid var(--border); border-radius:11px; padding:10px; margin-bottom:8px; }
    .item-head { display:flex; justify-content:space-between; gap:8px; align-items:center; }
    .conv-trigger { width:100%; background:transparent; color:inherit; border:none; padding:0; text-align:left; font:inherit; cursor:pointer; }
    .conv-meta { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:6px; }
    .btn-mini { background:#0b111b; color:var(--accent); border:1px solid var(--border); border-radius:8px; padding:4px 9px; font-size:11px; font-weight:700; cursor:pointer; }
    .drawer { margin-top:9px; padding-top:9px; border-top:1px solid var(--border); display:flex; flex-direction:column; gap:7px; }
    .drawer-hdr { display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap; }
    .drawer-badges { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
    .stream-step { background:#0b111b; border:1px solid var(--border); border-radius:9px; padding:8px; display:flex; flex-direction:column; gap:4px; }
    .stream-step-head { display:flex; align-items:center; gap:5px; flex-wrap:wrap; }
    .role-pill { font-size:10px; font-weight:700; padding:1px 6px; border-radius:99px; font-family:ui-monospace,monospace; text-transform:uppercase; }
    .role-user { background:rgba(245,158,11,0.18); color:#fcd34d; }
    .role-assistant { background:rgba(16,185,129,0.18); color:#6ee7b7; }
    .role-tool { background:rgba(56,189,248,0.18); color:#7dd3fc; }
    .role-system { background:rgba(148,163,184,0.18); color:#cbd5e1; }
    .role-error { background:rgba(244,63,94,0.2); color:#fda4af; }
    .tool-tag { font-size:10px; padding:1px 6px; border-radius:6px; font-family:ui-monospace,monospace; background:var(--card2); color:var(--accent); border:1px solid var(--border); }
    .stream-summary { font-size:12px; line-height:1.45; color:var(--fg); word-break:break-word; white-space:pre-wrap; }
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
      let lastConversations = [];
      let refreshInFlight = false;
      const expandedConvs = Object.create(null);
      const streamStates = Object.create(null);
      const MAX_CACHED_STREAMS = 20;

      function trimStreamCache() {
        const keys = Object.keys(streamStates);
        if (keys.length <= MAX_CACHED_STREAMS) return;
        for (const key of keys) {
          if (Object.keys(streamStates).length <= MAX_CACHED_STREAMS) break;
          if (!expandedConvs[key]) {
            delete streamStates[key];
          }
        }
      }

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

      function riskBadgeMeta(level) {
        if (level === 'high') return { cls: 'pill risk-high', label: 'HIGH' };
        if (level === 'medium') return { cls: 'pill risk-medium', label: 'MED' };
        if (level === 'low') return { cls: 'pill risk-low', label: 'LOW' };
        return { cls: 'pill warn', label: 'ACTION' };
      }

      function verifyBadgeMeta(status) {
        if (status === 'pass') return { cls: 'pill v-pass', label: 'Verify: PASS' };
        if (status === 'fail') return { cls: 'pill v-fail', label: 'Verify: FAIL' };
        if (status === 'blocked') return { cls: 'pill v-blocked', label: 'Verify: BLOCKED' };
        if (status === 'idle') return { cls: 'pill v-muted', label: 'Verify: IDLE' };
        return { cls: 'pill v-muted', label: 'Verify: UNKNOWN' };
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
          const rc = a && typeof a.riskCard === 'object' && a.riskCard ? a.riskCard : null;

          const head = document.createElement('div');
          head.className = 'item-head';
          head.appendChild(createTextElement('strong', '', String(a.toolName || 'tool')));
          const rb = rc ? riskBadgeMeta(String(rc.riskLevel || '')) : { cls: 'pill warn', label: 'Action Needed' };
          head.appendChild(createTextElement('span', rb.cls, rb.label));
          item.appendChild(head);

          if (rc) {
            const metaRow = document.createElement('div');
            metaRow.className = 'risk-meta';
            const filesCount =
              typeof rc.affectedFilesCount === 'number' && isFinite(rc.affectedFilesCount)
                ? Math.max(0, Math.floor(rc.affectedFilesCount))
                : 0;
            metaRow.appendChild(
              createTextElement('span', 'pill', String(filesCount) + (filesCount === 1 ? ' file' : ' files')),
            );
            const vb = verifyBadgeMeta(String(rc.verifyStatus || 'unknown'));
            metaRow.appendChild(createTextElement('span', vb.cls, vb.label));
            item.appendChild(metaRow);

            if (rc.targetSummary) {
              item.appendChild(createTextElement('div', 'risk-target', String(rc.targetSummary)));
            }
            if (rc.commandPreview) {
              item.appendChild(createTextElement('div', 'cmd', String(rc.commandPreview)));
            } else if (a.summary) {
              item.appendChild(createTextElement('div', 'cmd', String(a.summary)));
            }
            if (rc.verifySummary) {
              item.appendChild(createTextElement('div', 'risk-verify-note', 'Verify: ' + String(rc.verifySummary)));
            }
          } else {
            item.appendChild(createTextElement('div', 'cmd', String(a.summary || '')));
          }

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

      function roleClassName(role) {
        if (role === 'user') return 'role-pill role-user';
        if (role === 'assistant') return 'role-pill role-assistant';
        if (role === 'tool') return 'role-pill role-tool';
        if (role === 'error') return 'role-pill role-error';
        return 'role-pill role-system';
      }

      async function loadConversationStream(convId) {
        const prev = streamStates[convId];
        streamStates[convId] = {
          loading: true,
          error: '',
          data: prev ? prev.data : null,
        };
        renderConvs(lastConversations);
        try {
          const res = await fetch('/api/conversations/' + encodeURIComponent(convId) + '/stream?limit=20', {
            headers: authHeaders(),
          });
          if (res.status === 401) {
            document.getElementById('authCard').style.display = 'block';
            document.getElementById('statusPill').textContent = 'Locked';
            streamStates[convId] = { loading: false, error: 'Unauthorized', data: null };
            renderConvs(lastConversations);
            return;
          }
          if (!res.ok) {
            let errText = 'Failed to load stream (HTTP ' + String(res.status) + ')';
            try {
              const errJson = await res.json();
              if (errJson && typeof errJson.error === 'string') errText = errJson.error;
            } catch {}
            streamStates[convId] = { loading: false, error: errText, data: null };
            renderConvs(lastConversations);
            return;
          }
          const payload = await res.json();
          streamStates[convId] = { loading: false, error: '', data: payload };
          trimStreamCache();
          renderConvs(lastConversations);
        } catch {
          streamStates[convId] = { loading: false, error: 'Network error while loading stream.', data: null };
          renderConvs(lastConversations);
        }
      }

      function buildStreamDrawer(convId) {
        const drawer = document.createElement('div');
        drawer.className = 'drawer';

        const state = streamStates[convId] || { loading: false, error: '', data: null };

        const hdr = document.createElement('div');
        hdr.className = 'drawer-hdr';

        const badges = document.createElement('div');
        badges.className = 'drawer-badges';
        badges.appendChild(createTextElement('span', 'pill ro', 'READ-ONLY'));
        if (state.data && typeof state.data.totalSteps === 'number') {
          const modeLabel = state.data.mode === 'demo' ? 'DEMO' : 'LIVE';
          badges.appendChild(
            createTextElement('span', 'muted', modeLabel + ' · ' + String(state.data.totalSteps) + ' steps'),
          );
        }
        hdr.appendChild(badges);

        const refreshBtn = createTextElement('button', 'btn-mini', state.loading ? 'Loading…' : 'Refresh');
        refreshBtn.type = 'button';
        refreshBtn.disabled = Boolean(state.loading);
        refreshBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          void loadConversationStream(convId);
        });
        hdr.appendChild(refreshBtn);
        drawer.appendChild(hdr);

        if (state.error) {
          drawer.appendChild(createTextElement('div', 'err', String(state.error)));
          return drawer;
        }

        if (state.loading && !state.data) {
          drawer.appendChild(createTextElement('div', 'muted', 'Loading redacted live stream…'));
          return drawer;
        }

        const events = state.data && Array.isArray(state.data.events) ? state.data.events : [];
        if (!events.length) {
          drawer.appendChild(
            createTextElement('div', 'muted', 'No local transcript steps found yet (read-only).'),
          );
          return drawer;
        }

        events.forEach(function (evItem) {
          const stepEl = document.createElement('div');
          stepEl.className = 'stream-step';

          const stepHead = document.createElement('div');
          stepHead.className = 'stream-step-head';
          const roleText = String(evItem.role || 'assistant');
          stepHead.appendChild(createTextElement('span', roleClassName(roleText), roleText.toUpperCase()));
          if (typeof evItem.stepIndex === 'number') {
            stepHead.appendChild(createTextElement('span', 'muted', '#' + String(evItem.stepIndex)));
          }
          const tools = Array.isArray(evItem.toolNames) ? evItem.toolNames : [];
          tools.forEach(function (toolName) {
            stepHead.appendChild(createTextElement('span', 'tool-tag', String(toolName)));
          });
          stepEl.appendChild(stepHead);

          stepEl.appendChild(createTextElement('div', 'stream-summary', String(evItem.summary || '')));
          drawer.appendChild(stepEl);
        });

        return drawer;
      }

      function toggleConversationStream(convId) {
        if (!convId) return;
        if (expandedConvs[convId]) {
          delete expandedConvs[convId];
          renderConvs(lastConversations);
          return;
        }
        expandedConvs[convId] = true;
        renderConvs(lastConversations);
        void loadConversationStream(convId);
      }

      function renderConvs(list) {
        const safeList = Array.isArray(list) ? list : [];
        lastConversations = safeList;
        document.getElementById('convCount').textContent = String(safeList.length);
        const box = document.getElementById('convBox');
        if (!safeList.length) {
          box.replaceChildren(createTextElement('div', 'muted', 'No conversations found.'));
          return;
        }
        const nodes = safeList.slice(0, 10).map(function (c) {
          const convId = String(c.id || '');
          const isExpanded = Boolean(convId && expandedConvs[convId]);
          const item = document.createElement('div');
          item.className = 'item';

          const trigger = document.createElement('button');
          trigger.type = 'button';
          trigger.className = 'conv-trigger';
          trigger.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
          trigger.addEventListener('click', function () {
            toggleConversationStream(convId);
          });

          const head = document.createElement('div');
          head.className = 'item-head';

          const titleEl = createTextElement('strong', '', String(c.title || 'Untitled'));
          titleEl.style.fontSize = '13px';
          head.appendChild(titleEl);

          const rawState = String(c.runState || 'IDLE');
          const pillClass = rawState === 'RUN_STATE_RUNNING' ? 'pill run' : 'pill';
          head.appendChild(createTextElement('span', pillClass, rawState.replace('RUN_STATE_', '')));
          trigger.appendChild(head);

          const summaryEl = createTextElement('div', 'muted', String(c.summary || '').slice(0, 110));
          summaryEl.style.marginTop = '4px';
          trigger.appendChild(summaryEl);

          const meta = document.createElement('div');
          meta.className = 'conv-meta';
          meta.appendChild(createTextElement('span', 'muted', convId ? convId.slice(0, 24) : ''));
          meta.appendChild(
            createTextElement('span', 'btn-mini', isExpanded ? 'Hide Live Stream' : 'Live Stream (Read-Only)'),
          );
          trigger.appendChild(meta);

          item.appendChild(trigger);

          if (isExpanded) {
            item.appendChild(buildStreamDrawer(convId));
          }
          return item;
        });
        box.replaceChildren.apply(box, nodes);
      }

      async function refreshAll() {
        if (refreshInFlight) return;
        refreshInFlight = true;
        try {
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
        } catch {
          document.getElementById('statusPill').textContent = 'Offline';
        } finally {
          refreshInFlight = false;
        }
      }

      function closeEventStream() {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
      }

      function connectEventStream() {
        closeEventStream();
        if (!token || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
        eventSource = new EventSource('/api/events?token=' + encodeURIComponent(token));
        eventSource.onmessage = function () {
          void refreshAll();
        };
      }

      function boot() {
        void refreshAll();
        connectEventStream();
      }

      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden') {
            closeEventStream();
          } else {
            void refreshAll();
            connectEventStream();
          }
        });
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('pagehide', closeEventStream);
        window.addEventListener('beforeunload', closeEventStream);
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
