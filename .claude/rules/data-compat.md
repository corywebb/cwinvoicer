---
paths:
  - "src/shared/types.ts"
  - "src/shared/lines.ts"
  - "src/server/validate.ts"
  - "src/server/storage.ts"
  - "src/server/invoices.ts"
---

# Stored data compatibility

These files define records in the user's real JSON files. There is no migration step, so every existing file must keep loading and rendering.

- Give each new field a default or fallback for records that lack it, like `DEFAULT_SETTINGS` in `storage.ts` or `inv.format || 'summary'` in `invoices.ts`.
- Test changes against records saved by older versions, not only a fresh demo workspace.
- Don't recalculate stored invoices from current rates or settings. Time keeps its `billedRate` once billed, and rebuilding lines for a format change must keep using it.
- Don't change invoice totals, rounding or numbering without saying so explicitly and adding a test that shows the new behavior.
