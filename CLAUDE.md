# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

CW Invoicer is a single-user, local macOS invoicing app. An Electron shell and browser mode share one dependency-free Node server, which stores records as JSON files.

## Commands

Run `npm ci` first: the build needs esbuild, and type-checking needs TypeScript. Use Node 22 or 24, the versions CI tests.

```sh
npm run build       # src/ -> public/app.js and out/
npm run watch       # rebuild on change
npm run typecheck   # checks both tsconfigs; esbuild does not type-check
npm test            # builds, then runs all tests with node --test
npm run demo        # builds, then serves fictional data from a temp folder, discarded on Ctrl+C
npm start           # builds, then serves http://localhost:4242 and opens a browser (PORT overrides)
npm run app         # builds, then runs Electron
npm run dist        # type-checks, builds, then packages an unsigned .app and .dmg into dist/
```

Tests import the built JavaScript from `out/`, so build before running a subset. Calling `node --test` directly does not rebuild, and it will silently test stale code:

```sh
npm run build && node --test test/ledger.test.js
npm run build && node --test --test-name-pattern='CSV' test/ledger.test.js
```

CI runs `npm run typecheck` and `npm test` on Node 22 and 24. It does not build the desktop app.

## Real data

`npm start` and `npm run app` use the real business data folder (`~/Library/Application Support/CW Invoicer/`, or the `dataDir` in its `config.json`). For manual testing, use `npm run demo` or set `CWINVOICER_DATA="$(mktemp -d)"`.

Run only one app process per data folder. Nothing locks the data folder (Electron's single-instance lock doesn't cover browser mode), and a multi-collection write is not one atomic transaction.

## Architecture

`docs/system.md` has the invoice lifecycle, ledger/CSV rules and a source map. The points below span several files.

**Four source areas, two build outputs** (`scripts/build.mjs`):
- `src/client/` is bundled into `public/app.js`, an IIFE for the browser.
- `src/shared/`, `src/server/` and `src/electron/` compile file for file into `out/` as CommonJS.
- `src/shared/` is included in both `tsconfig.json` (DOM, no Node types) and `tsconfig.node.json` (Node types, no DOM), so it can use neither browser nor Node APIs.

**Shared rules.** `src/shared/lines.ts` (invoice lines, rate precedence) and `src/shared/ledger.ts` (filters, totals, CSV) run in both the browser and the server, so the preview, stored totals and export agree. Change calculations there, not in a page or route.

**Invoice HTML has one source.** `src/server/invoice-template.ts` renders the preview, print view and PDF. The builder's preview POSTs selected entry IDs and the server renders from stored records.

**Server.** `src/server/index.ts` handles the host check, the `x-cwinvoicer: 1` header required on non-GET `/api/` requests, static files and `start()`. `src/server/api.ts` holds the routes, with generic CRUD for clients, projects and entries. `config` and the HTTP server are module-level singletons, so each process runs one server. `test/server.test.js` starts its server in a spawned child process.

**PDF freshness depends on file mtimes.** A saved PDF is reused unless the invoice, settings, logo or `out/server/invoice-template.js` is newer (`src/server/pdf.ts`). The build's `write-changed` plugin therefore skips unchanged output files; removing it would make every saved PDF stale on each build.

**PDF renderer is injected.** Electron passes `renderPdf` to `start()` and renders with its own Chromium. Browser mode falls back to an installed Chrome-family browser (`CHROME_PATH` overrides detection).

**Client.** No framework. `src/client/main.ts` is a hash router; each route in `pages/` returns an `HTMLElement` built with `h()` from `dom.ts`. `render()` refetches all of `/api/state` into `S` (`state.ts`) and redraws the page, so after a change a page calls `render()` instead of patching the DOM. Electron menus call into the page through `window.CWInvoicer`, defined in `main.ts`.

**Billed records.**
- Invoices store snapshots of their lines, billed rates and bill-to details.
- Source entries link back through `invoiceId`. The API rejects changes to a billed entry with 409 until its invoice is deleted, which releases the entries for billing.
- Overdue is derived from an unpaid invoice's due date, never stored.

## Constraints

- Don't change existing invoice totals, saved schemas or numbering as a side effect of presentation work.
- Use fictional data and `example.com` addresses in screenshots and fixtures.
- Keep generated output (`out/`, `public/app.js`) and unrelated refactors out of the diff.
- When setup steps, commands or file paths change, update `README.md` and `CONTRIBUTING.md` in the same change.

Area-specific rules for data compatibility, the server, the browser UI and docs are in `.claude/rules/`.
