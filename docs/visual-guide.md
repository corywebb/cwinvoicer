# Visual guide

All app screenshots show fictional **Fieldwork Studio** data produced by `npm run demo`.
They are browser captures of the application, not mockups. Dates are relative to the day the
demo starts. No business records are needed to reproduce the screens.

## Workspace

![Desktop dashboard with unbilled work, outstanding balances and recent invoices](images/dashboard.png)

## Build an invoice

The builder keeps source work and the printable preview beside each other at desktop widths.
At narrow widths the preview follows the form. Summary and detailed formats share the same
line-building module on the client and server.

![Invoice builder and live printable preview](images/invoice-builder.png)

## Narrow browser layout

Navigation becomes a compact grid. Cards stack, and wide tables scroll inside their own region.
This is browser responsiveness; the macOS desktop window still has a 900-pixel minimum width.

<img src="images/mobile.png" width="390" alt="CW Invoicer dashboard at a 390-pixel browser width">

## Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/architecture-dark.png">
  <img src="images/architecture-light.png" alt="Electron loads the workspace and starts a local Node server, which stores JSON and renders PDFs">
</picture>

[Open the interactive diagram source](diagrams/architecture.html) ·
[Typed specification](diagrams/architecture.json) · [Verification receipt](diagrams/receipt.json)

GitHub displays HTML as source. Download the HTML file and open it locally for the interactive
viewer, themes, source links and export controls. It is self-contained and is not loaded by the app.
The diagram was generated with [Archify](https://github.com/tt-a1i/archify), with source references
pinned to Cory's initial commit. It describes that source architecture, not a running deployment.

The server reads and replaces JSON collection files. Invoice creation updates several files;
these writes are not a single database transaction. In desktop mode, Electron supplies a PDF
renderer; browser mode invokes an installed Chrome-family browser. The overview groups these
two PDF implementations into one operation and explains them in its detail cards.

## Invoice lifecycle

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/invoice-lifecycle-dark.png">
  <img src="images/invoice-lifecycle-light.png" alt="Unbilled work becomes an unpaid invoice, then paid; deleting the invoice releases its work">
</picture>

[Interactive lifecycle](diagrams/invoice-lifecycle.html) ·
[Typed specification](diagrams/invoice-lifecycle.json) ·
[Verification receipt](diagrams/invoice-lifecycle-receipt.json)

Creating an invoice locks its selected entries against editing or rebilling. Marking an invoice
paid records a payment date; marking it unpaid clears that date. Deleting either kind of invoice
releases its source work. **Overdue** is computed from an unpaid invoice's due date, rather than
stored as a separate payment state. The automated HTTP tests exercise these lifecycle operations.

## Refreshing the assets

1. Start `npm run demo` and open the printed URL in a browser.
2. Capture the dashboard at 1440 × 1000 as `images/dashboard.png`.
3. Choose **Create invoice** for Northstar Coffee and capture the full page as `images/invoice-builder.png`.
4. Return to Dashboard, resize to 390 × 844, and capture the full page as `images/mobile.png`.
5. Inspect every image for clipped content, correct totals and fictional data before committing.
6. If architecture changes, update the typed spec's source revision and references, regenerate
   with Archify, and refresh the diagram captures and receipt. Do not hand-edit generated HTML.

The checked-in receipt records deterministic validation and browser checks separately from
human visual inspection. Regeneration tooling is optional; running the app needs none of it.
