# Contributing

CW Invoicer is a small, local macOS invoicing app. Keep contributions focused and easy to run.

## Work in a disposable workspace

Use Node.js 22 or 24 for the test workflow. The app declares Node.js 18+ support.

```sh
git clone https://github.com/YOUR-USERNAME/cwinvoicer.git
cd cwinvoicer
git remote add upstream https://github.com/corywebb/cwinvoicer.git
git switch -c your-change
npm test
npm run demo
```

Tests and the demo use Node's built-in modules, so neither needs `npm install`.
The demo prints its local URL and creates fictional clients and work in a new temporary directory.
Stopping it with Ctrl+C discards the demo data. It never reads the desktop app's configuration.
An abrupt termination such as `kill -9` can leave the temporary directory behind.

For Electron development, run `npm ci`, then `npm run app` on macOS. **Normal desktop and
browser modes share your configured business data.** Set `CWINVOICER_DATA` to a separate
folder when testing changes against either mode. Use only one app process per data folder.

## Keep the architecture small

- Preserve the dependency-free Node server and plain JavaScript UI unless a change justifies more tooling.
- Put shared line-building rules in `public/lines.js`; the server and browser both use it.
- Keep invoice HTML in `lib/invoice-template.js` so preview, print and PDF stay consistent.
- Avoid changing existing invoice totals, saved schemas or numbering as a side effect of presentation work.
- Use fictional data and `example.com` addresses in screenshots and fixtures.

## Validate a change

```sh
npm test
node --check public/app.js
node --check server.js
# macOS, after npm ci:
npm run dist
```

The Node tests exercise rates, line grouping, escaping, and the invoice lifecycle through HTTP.
CI runs them on Node 22 and 24. It does not build, sign or notarize the desktop app.

For UI changes, use `npm run demo` and check:

1. Desktop layout at 1440 × 1000 and narrow browser layout at 390 × 844.
2. Each navigation section, table scrolling, visible keyboard focus and invoice links.
3. A modal using Tab, Shift+Tab, Escape, invalid input and a successful save.
4. Invoice preview in both formats; navigate away while a preview is pending.
5. Create an invoice, mark it paid, mark it unpaid, then delete it and verify its work is unbilled again.
6. For desktop-specific changes, native menus, shortcuts, printing and PDF export in Electron.

Capture updated images only after checking the actual rendered screens. See
[the visual guide](docs/visual-guide.md) for screenshot sources and diagram maintenance.

## Send a pull request

Push a topic branch to your fork and open a PR against `corywebb/cwinvoicer:main`.
Describe the problem, resulting behavior, checks run, and any untested platform behavior.
Keep unrelated refactors and generated build output out of the diff. Screenshots help explain
UI changes; they do not replace a runnable demo or regression checks.
