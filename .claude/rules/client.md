---
paths:
  - "src/client/**"
  - "public/**"
---

# Browser UI

- Build elements with `h()` from `dom.ts`, without `innerHTML`, so user text stays text.
- After a change, call `render()` from `state.ts` instead of patching the DOM. It refetches state and redraws the page.
- Don't put invoice calculations in pages. They belong in `src/shared/`, so the preview and stored totals agree.
- `public/app.js` is generated; edit `src/client/` instead.
- Keep visible keyboard focus, modal behavior (Tab, Shift+Tab, Escape) and the 390 × 844 layout working.
- Run the browser checklist in `CONTRIBUTING.md` against `npm run demo`, and say which items were run and which weren't.
