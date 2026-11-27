# Contributing to agy-NOV

Thank you for helping build **agy-NOV** — the 100% native modular super-workbench for Google Antigravity 2.0 (macOS / Windows / Linux).

Before opening a pull request, please review [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) so your changes fit cleanly into the 4-layer architecture.

---

## 1. Local Isolated Development (Zero-Touch Guarantee)

Developing and testing `agy-NOV` never touches your daily `~/.gemini/config/plugins/` installation:

```bash
git clone https://github.com/tone-leh/agy-NOV.git
cd agy-NOV
npm ci

# Typecheck + production build (UI + minified server/hook/cli bundles) + full 3-OS test suite
npm run typecheck
npm test

# Read-only health verification & offline UI workbench
node dist/cli.cjs doctor
node workbench/server.mjs --smoke --port=0
npm run workbench   # Opens local simulator at http://127.0.0.1:4399 with synthetic demo data
```

- Always use temporary directories (`os.tmpdir()`) in tests.
- Never write into `~/.gemini/config/plugins/` or hardcode personal absolute paths.

---

## 2. Engineering & Modularity Principles

1. **Respect Layer Boundaries**:
   - `src/core/*` must never import from `src/modules/*`, `src/server/*`, `src/hooks/*`, or `ui/*`.
   - Keep domain modules under `src/modules/<id>/` self-contained. Split files cleanly by responsibility (`types`, `store`, `runner`, `demo`, `register`, `hook`) rather than growing monolithic files.
   - Reuse shared primitives from `src/core/fs-safe.ts`, `src/core/process-safe.ts`, and `src/core/sanitize.ts` instead of duplicating `realpath`, atomic rename, `<private>` stripping, or secret redaction logic.
2. **Protect the Tool Budget**:
   - Keep model-visible tools lean and strictly purposeful. Prefer App-only tools (`visibility: ['app']`), Hooks, on-demand Skills, CLI commands, or MCP Resources whenever the model does not need direct tool invocation.
   - Remember that CLI clients without `io.modelcontextprotocol/ui` automatically hide all `app_*` / `nov_app_*` tools via `src/server/index.ts`.
3. **Preserve 100% Zero ASAR / Zero CDP**:
   - Never patch `app.asar`, attach CDP sessions, or inject DOM scripts into the Antigravity host window.
   - Keep `plugin.json` strictly limited to official supported manifest fields.
4. **Cross-Platform First (macOS, Windows, Linux)**:
   - Use `canonicalRealpathSync`, `isSamePath`, `isPathInsideDir`, and `atomicRenameSync` from `src/core/fs-safe.ts` (re-exported by `src/core/utils.ts`).
   - Spawn child processes strictly with `shell: false` and resolve Windows JS shims via `resolveSafeSpawnTarget`.
   - Use `test/helpers/cross-platform.ts` (`createDirSymlink` / `createFileSymlink`) for symlink tests so Windows CI runs reliably without admin privileges.
5. **100% 8-Locale UI Coverage**:
   - Any new user-visible UI text must use the i18n dictionary (`useNovI18n`) across all 8 locales (`en`, `zh-CN`, `zh-TW`, `ja`, `ko`, `es`, `fr`, `de`).
   - The automated test suite asserts strict 8-locale key symmetry, non-empty values, and placeholder parity.

---

## 3. Security Red Lines (Checked in Every PR)

- **Workspace & Symlink Containment**: Every file operation must resolve real paths and verify containment inside the active workspace or plugin data directory.
- **No Shell Injection**: Never concatenate untrusted input into shell strings; use `execFile` / `spawn` with `shell: false` and explicit `--` separators before untrusted Git refs or paths.
- **Linear-Time Sanitization**: Avoid nested-quantifier regexes on untrusted inputs; reuse `src/core/sanitize.ts`.
- **Zero-Write & Default-Off Isolation**: Read-only tools and disabled modules must perform zero directory creation, zero disk writes, zero open ports, and zero outbound network requests.
- **No Fake Secret Literals in Source/Tests**: Construct synthetic test tokens dynamically when testing redaction so secret scanners stay clean.

---

## 4. Pull Request Checklist

- [ ] `npm run typecheck` passes with 0 errors
- [ ] `npm test` passes (including `test/architecture-hygiene.test.ts` and `test/v102-runtime-hardening.test.ts`)
- [ ] `node dist/cli.cjs doctor` and `node workbench/server.mjs --smoke --port=0` pass
- [ ] All 8 UI locale files remain key-symmetric if UI text changed
- [ ] Release PRs update `CHANGELOG.md`, `llms.txt`, `docs/llms-install.md`, `skills/agy-nov/SKILL.md`, and all 8 READMEs
- [ ] GitHub Actions 3-OS CI (`ubuntu-latest`, `windows-latest`, `macos-latest` × Node 20/22) passes
