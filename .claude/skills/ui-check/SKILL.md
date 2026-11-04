---
name: ui-check
description: Run the CONTRIBUTING.md browser checklist against a disposable demo workspace and report what passed, failed or couldn't be checked. Use after changing src/client/, public/ or src/server/invoice-template.ts, or when asked to check the UI in a browser.
context: fork
---

# UI check

Automated tests don't cover `src/client/`, so this is the check for UI behavior. It only uses throwaway demo data. Never run it with `npm start`, `npm run app` or a real data folder.

## 1. Start the demo

Run this as a background command, so the stop signal reaches the demo process directly:

```sh
npm run build && exec node scripts/demo.js
```

Wait for the `Demo ready: http://127.0.0.1:<port>` line and use that URL. The port changes on every run. If the build fails, stop and report the error.

## 2. Open a browser

Use whichever browser tool this session has, loading its skill first if there is one. If no browser tool is available, stop the demo and say the check wasn't run. Don't infer results from reading the code.

## 3. Run the checklist

Read "Validate a change" in `CONTRIBUTING.md` and run items 1 to 5 in order. That list is the source of truth; don't work from memory.

Look at the rendered page for each item, and check the browser console for errors as you go.

The demo starts with invoices #1042 to #1044. For the invoice lifecycle item, use Northstar Coffee:
- Its unbilled time and expense should be selected when the builder opens.
- The new invoice should be #1045, totaling $897.50.
- After deleting it, the time and expense should be unbilled again.

If an action needs a local Chrome-family browser, such as Open PDF, and the app doesn't offer it, report that item as not checked.

## 4. Stop the demo

Stop the background command when finished, including after a failure. Stopping it deletes the temporary data folder.

## 5. Report

List each checklist item as **passed**, **failed** or **not checked**, with what you saw for each failure. Always list item 6 (native menus, shortcuts, printing and PDF export in Electron) as **not checked** unless it was actually run in Electron; a browser can't show it.

Report failures without fixing them, unless asked to fix them.
