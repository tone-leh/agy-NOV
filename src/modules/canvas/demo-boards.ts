import type { CanvasBoard } from './types.js';

export function buildDemoBoards(): CanvasBoard[] {
  const pricingHtml = `<!doctype html>
<html>
<head>
<style>
  body { margin:0; padding:28px; font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif; background:#0b111b; color:#f1f5f9; }
  .hero { text-align:center; margin-bottom:24px; }
  .hero h1 { margin:0 0 8px; font-size:26px; letter-spacing:-0.02em; }
  .hero p { margin:0; color:#94a3b8; font-size:14px; }
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; max-width:780px; margin:0 auto; }
  .tier { background:#131c2e; border:1px solid #24324c; border-radius:14px; padding:18px; display:flex; flex-direction:column; gap:10px; }
  .tier.pop { border-color:#38bdf8; box-shadow:0 0 0 1px rgba(56,189,248,0.4); position:relative; }
  .badge { position:absolute; top:-10px; right:14px; background:#38bdf8; color:#082f49; font-size:10px; font-weight:800; padding:2px 8px; border-radius:99px; }
  .price { font-size:28px; font-weight:800; font-family:ui-monospace,monospace; }
  ul { margin:0; padding-left:18px; color:#cbd5e1; font-size:12.5px; line-height:1.7; }
  .cta { margin-top:auto; background:#1e293b; color:#f8fafc; border:none; border-radius:8px; padding:9px; font-weight:700; cursor:pointer; }
  .tier.pop .cta { background:#38bdf8; color:#082f49; }
</style>
</head>
<body>
  <div class="hero">
    <h1>Simple Pricing for Agent Teams</h1>
    <p>Local-first MCP plugins with zero vendor lock-in.</p>
  </div>
  <div class="grid">
    <div class="tier">
      <strong>Starter</strong>
      <div class="price">$0</div>
      <ul><li>Unlimited local plugins</li><li>Offline workbench</li><li>MIT open-source</li></ul>
      <button class="cta">Get Started</button>
    </div>
    <div class="tier pop">
      <span class="badge">MOST POPULAR</span>
      <strong>Pro</strong>
      <div class="price">$19</div>
      <ul><li>Multi-workspace sync</li><li>Team review pins</li><li>Priority CI templates</li></ul>
      <button class="cta">Start Free Trial</button>
    </div>
    <div class="tier">
      <strong>Enterprise</strong>
      <div class="price">$79</div>
      <ul><li>SSO &amp; audit trails</li><li>Private plugin registry</li><li>Dedicated SLA</li></ul>
      <button class="cta">Contact Sales</button>
    </div>
  </div>
</body>
</html>`;

  const archSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 360" width="100%" height="100%" fill="none">
  <rect width="760" height="360" rx="14" fill="#0d1524"/>
  <text x="28" y="38" fill="#f8fafc" font-family="system-ui,sans-serif" font-size="16" font-weight="700">Event-Driven Checkout Pipeline (Draft v1)</text>
  <rect x="28" y="84" width="150" height="90" rx="10" fill="#131c2e" stroke="#38bdf8" stroke-width="2"/>
  <text x="103" y="124" text-anchor="middle" fill="#38bdf8" font-family="ui-monospace,monospace" font-size="12" font-weight="700">API Gateway</text>
  <text x="103" y="146" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="11">Rate Limit + JWT</text>
  <path d="M180 129 L226 129" stroke="#38bdf8" stroke-width="2.5"/>
  <rect x="230" y="84" width="160" height="90" rx="10" fill="#131c2e" stroke="#10b981" stroke-width="2"/>
  <text x="310" y="124" text-anchor="middle" fill="#34d399" font-family="ui-monospace,monospace" font-size="12" font-weight="700">Order Service</text>
  <text x="310" y="146" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="11">Idempotency Key</text>
  <path d="M392 129 L438 129" stroke="#10b981" stroke-width="2.5"/>
  <rect x="442" y="84" width="130" height="90" rx="10" fill="#131c2e" stroke="#f59e0b" stroke-width="2"/>
  <text x="507" y="124" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace,monospace" font-size="12" font-weight="700">Kafka Bus</text>
  <text x="507" y="146" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="11">orders.v1 topic</text>
  <path d="M574 129 L610 129" stroke="#f59e0b" stroke-width="2.5"/>
  <rect x="614" y="84" width="120" height="90" rx="10" fill="#131c2e" stroke="#a78bfa" stroke-width="2"/>
  <text x="674" y="124" text-anchor="middle" fill="#c4b5fd" font-family="ui-monospace,monospace" font-size="12" font-weight="700">Fulfillment</text>
  <text x="674" y="146" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="11">Retry + DLQ</text>
  <rect x="230" y="220" width="342" height="94" rx="10" fill="#131c2e" stroke="#475569" stroke-dasharray="5 4"/>
  <text x="401" y="258" text-anchor="middle" fill="#cbd5e1" font-family="ui-monospace,monospace" font-size="12" font-weight="700">PostgreSQL Primary + Redis Cache</text>
  <text x="401" y="282" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="11">Transactional outbox guarantees at-least-once event publish</text>
</svg>`;

  const slidesMd = `# Q4 Product Launch Deck

**Agy Canvas** — Point, box, and ship visual iterations 5× faster.

- Render HTML, SVG, Slides & Markdown natively inside Antigravity 2.0
- Drop numbered review pins with exact normalized coordinates
- Send structured feedback back via \`app.sendMessage()\`

---

## Why Text-Only Visual Feedback Fails

- "Move the button on the top right slightly left" → Agent guesses wrong 3 times
- Switching windows to screenshot & paste wastes 40 seconds per round
- **With Agy Canvas**: drag a box around the exact element, type *"Use pill badge + emerald tint"*, hit **Send Feedback**

---

## Revision Loop (v1 → v2 → Ship)

1. Agent calls \`canvas_publish_artifact\` → side pane opens automatically
2. Human marks pins \`#1\`, \`#2\`, \`#3\` right on the canvas
3. Agent fixes all pins and publishes \`v2\` for instant before/after comparison`;

  return [
    {
      id: 'demo-pricing-ui',
      title: 'Pricing Section Prototype (HTML)',
      kind: 'html',
      sourcePath: '/workspace/demo-app/web/pricing.html',
      sourceUri: 'file:///workspace/demo-app/web/pricing.html',
      createdAt: '2026-11-26T07:00:00Z',
      updatedAt: '2026-11-26T07:20:00Z',
      currentVersion: 1,
      revisions: [
        { version: 1, createdAt: '2026-11-26T07:00:00Z', summary: 'Initial 3-tier dark pricing grid', content: pricingHtml },
      ],
      annotations: [
        {
          id: 'pin_demo1',
          number: 1,
          revision: 1,
          xPct: 36,
          yPct: 24,
          wPct: 28,
          hPct: 16,
          tag: 'polish',
          note: 'Add annual/monthly billing toggle badge and show "/mo" next to $19',
          status: 'open',
          createdAt: '2026-11-26T07:10:00Z',
        },
        {
          id: 'pin_demo2',
          number: 2,
          revision: 1,
          xPct: 67,
          yPct: 68,
          wPct: 24,
          hPct: 14,
          tag: 'copy',
          note: 'Change CTA label from "Contact Sales" to "Book Live Demo"',
          status: 'open',
          createdAt: '2026-11-26T07:12:00Z',
        },
      ],
    },
    {
      id: 'demo-arch-svg',
      title: 'Checkout Pipeline Architecture (SVG)',
      kind: 'svg',
      sourcePath: '/workspace/demo-app/docs/checkout-arch.svg',
      sourceUri: 'file:///workspace/demo-app/docs/checkout-arch.svg',
      createdAt: '2026-11-26T06:40:00Z',
      updatedAt: '2026-11-26T06:45:00Z',
      currentVersion: 1,
      revisions: [
        { version: 1, createdAt: '2026-11-26T06:40:00Z', summary: 'Initial checkout outbox diagram', content: archSvg },
      ],
      annotations: [
        {
          id: 'pin_demo3',
          number: 1,
          revision: 1,
          xPct: 57,
          yPct: 22,
          wPct: 18,
          hPct: 28,
          tag: 'layout',
          note: 'Add a DLQ Alerting arrow from Kafka Bus to PagerDuty / Slack',
          status: 'open',
          createdAt: '2026-11-26T06:44:00Z',
        },
      ],
    },
    {
      id: 'demo-launch-slides',
      title: 'Q4 Launch Slide Deck (Slides)',
      kind: 'slides',
      sourcePath: '/workspace/demo-app/docs/launch-slides.md',
      sourceUri: 'file:///workspace/demo-app/docs/launch-slides.md',
      createdAt: '2026-11-26T06:15:00Z',
      updatedAt: '2026-11-26T06:20:00Z',
      currentVersion: 1,
      revisions: [
        { version: 1, createdAt: '2026-11-26T06:15:00Z', summary: '3-slide launch outline', content: slidesMd },
      ],
      annotations: [],
    },
  ];
}
