---
paths:
  - "src/server/**"
---

# Server

- Use Node built-ins only; the server has no runtime dependencies.
- Keep `loadAll()` to `save()` free of any `await`. `handleApi` reads the whole request body first, and this is the only protection against overlapping requests saving stale copies over each other.
- Make anything with a side effect a non-GET request, so it carries the `x-cwinvoicer` header. Revealing a PDF in Finder and writing to the invoice log are POSTs for this reason.
- Report request errors with `HttpError`, which sets the status. Anything else becomes a logged 500.
- Add new record fields to `SCHEMAS` in `validate.ts`. `clean()` only applies fields listed there, so a missing field is silently dropped from the request.
- When an invoice changes, follow `updateInvoice` and `deleteInvoice`: call `removePdf()` and record it with `logInvoice()`.
- Escape user text in `invoice-template.ts` with `esc` or `nl2br`.
