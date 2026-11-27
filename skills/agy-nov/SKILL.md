---
name: agy-nov
description: Open and use agy-NOV, the all-in-one modular native MCP App workbench for Google Antigravity 2.0 (PR diff review, pre-edit snapshot & secret shield, context X-Ray, visual artifact canvas, code-anchored memory graph, and opt-in mobile/IM remote control). Toggle modules anytime from the Modules tab.
---

# agy-NOV Modular Workbench

`agy-NOV` packs six focused Antigravity 2.0 capabilities into one native MCP App side pane and unified lifecycle hook dispatcher, letting the user toggle each module on or off without paying unnecessary Token or process overhead.

## When to use

- Call `nov_open` to open the unified **agy-NOV** side pane (optionally passing `module`: `review`, `guard`, `xray`, `canvas`, `mem`, `remote`, or `modules`).
- Call `nov_status` to inspect which modules are currently enabled and how many tools are exposed.
- Only tools belonging to **enabled modules** are active:
  - **Review** (`review_*`, default ON): inspect working-tree or staged Git diffs line by line, collect inline annotations, and apply structured `file:line` fix requests.
  - **Guard** (`guard_*`, default ON): scan for secrets, inspect pre-edit file snapshots, and create manual safety checkpoints before risky refactors.
  - **X-Ray** (`xray_*`, default ON): inspect cached vs. fresh token breakdowns, live workspace file activity, and cross-session full-text search.
  - **Canvas** (`canvas_*`, opt-in): publish HTML prototypes, SVG diagrams, slides, Markdown specs, or images for visual pin/region annotations.
  - **Memory** (`mem_*`, opt-in): save, recall, or forget code-anchored project decisions with SHA-256 drift checks.
  - **Remote** (`remote_*`, opt-in, strictly offline when OFF): check gateway status, send alerts, or dispatch remote tasks when the user has explicitly enabled the Remote module.
