# Changelog

All notable changes to **agy-NOV** will be documented in this file.

## [0.1.0] - 2026-11-27

### Added
- Consolidated six native Google Antigravity 2.0 MCP App capabilities (`review`, `guard`, `xray`, `canvas`, `mem`, `remote`) into a single modular plugin with live on/off switches and 4 presets (`core`, `local-all`, `full`, `minimal`).
- Implemented dynamic MCP tool registration (`RegisteredTool.enable()` / `.disable()`) so disabled modules incur zero model tool schema token tax.
- Built a unified lifecycle hook dispatcher (`dist/hook.cjs`) with camelCase & snake_case payload normalization and O(1) read-only short-circuiting for disabled modules.
- Hardened the opt-in `remote` module to stay strictly offline by default (zero listening ports, zero background polling, zero outbound requests) with serialized start/stop lifecycle teardown.
- Shipped a shared `NovBridge` singleton, strictly scoped per-module CSS with full dark/light theme support, an interactive Modules control center, CLI (`status`, `enable`, `disable`, `preset`, `doctor`), and a zero-touch offline `workbench/` simulator.
