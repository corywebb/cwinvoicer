# How CW Invoicer works

CW Invoicer is a single-user workspace for turning recorded work into invoices.
It runs on your computer. The Mac app and browser mode use the same server, invoice
calculations, and JSON records; the main difference is who opens the window and renders PDFs.

## Follow one invoice

1. **Record work.** A client owns projects, time entries, line items, and expenses.
   An entry can belong directly to a client without a project. Unbilled work appears
   on the dashboard and is preselected when you start that client's next invoice.
2. **Review the draft.** The builder uses [lines.js](../public/lines.js) for a live total.
   Its preview request sends selected entry IDs to the server, which rebuilds the
   printable HTML from the stored records. Previewing does not create an invoice.
3. **Create the invoice.** The server checks that selected entries belong to that
   client and have not already been billed. It assigns a number, stores invoice
   lines and the bill-to details, and links the source entries to the invoice.
   Billed time also records the hourly rate used.
4. **Deliver a PDF.** The [invoice template](../lib/invoice-template.js) renders a
   Letter-size document. Electron renders PDFs itself; browser mode invokes an
   installed Chrome-family browser. PDFs are saved in `pdfs/` inside the data folder.
5. **Record payment.** Mark paid stores a payment date. Mark unpaid clears it.
   Overdue is calculated from an unpaid invoice's due date and today's local date;
   it is not a third stored payment state. The app does not collect or confirm payments.
6. **Review or export.** The invoice ledger filters stored invoices and exports the
   selected rows as CSV. It does not recalculate invoice amounts from current client rates.

## Rates and invoice formats

The hourly rate for unbilled time is chosen in this order: an entry's explicit rate,
then its project's rate, then its client's rate, then the default in Settings. An
explicit zero is respected. Once billed, the saved `billedRate` takes precedence.

**Summary** combines time by project and rate, and combines a project's items and
expenses into an additional line. **Detailed** lists each dated entry under a project
heading. Both modes use the same shared calculation module on the server and browser.
Changing the format rebuilds the lines from linked entries using the saved billed rates.

Creating an invoice stores its line amounts, business name/contact text, and bill-to
name/address. These are useful snapshots, but invoices are still editable: dates,
terms, notes, recipient details, descriptions, and format can change. The logo is
served from the current data folder, so this is not an immutable document archive.

Deleting an invoice releases its source work for billing again. Numbers follow the
highest currently stored number or the configured starting number, whichever gives
the higher next value. Deleting the highest invoice can therefore reuse its number.

## Invoice ledger and CSV export

Open **Invoices**, choose a client/status, and optionally set **From date** and
**To date**. Both date endpoints are inclusive and refer to the **invoice date**.
Archived clients with invoice history remain available in the client filter.

The four totals describe the selected invoices:

| Total | Meaning |
| --- | --- |
| Invoiced | Sum of stored invoice totals in the selection |
| Paid | Selected invoices currently marked paid |
| Outstanding | Selected invoices currently unpaid, including overdue |
| Overdue | Outstanding invoices whose due date is before today |

Paid plus Outstanding equals Invoiced. Overdue is part of Outstanding, not an extra
amount to add. A paid invoice dated in January and paid in February appears in a
January invoice-date selection; this is **not a cash-receipts report**. Partial payments
and currency conversion are not modeled.

**Export CSV** downloads the same selection, ordered by descending invoice number.
Columns are invoice number, billed client name, invoice date, due date, current status,
paid date, total, outstanding, terms, and notes. Amounts use decimal points without
currency symbols or thousands separators. Dates use `YYYY-MM-DD`. Values reflect the
records at download time; another save between viewing and exporting can change them.

The file uses UTF-8 with a byte-order mark and CRLF row endings. Quotes, commas, and
multiline notes are escaped. User text that could be interpreted as a spreadsheet
formula receives a leading apostrophe; the source records are not changed. Numeric
amounts remain numeric, including negative values. Import the file as CSV rather than
splitting lines manually. Keep exports private: they include client names and notes.

The read-only endpoint is `GET /api/invoices/export.csv`, with optional `client`
(client ID), `status` (`all`, `unpaid`, `overdue`, `paid`), `from`, and `to` query parameters.
Invalid date ranges return HTTP 400. An empty selection returns column headers only;
the interface disables export when there are no matching rows.

## Runtime and source map

| Component | Responsibility |
| --- | --- |
| [electron/main.js](../electron/main.js) | Starts the local server, opens the native window, menus and PDF integration |
| [electron/print-invoice.js](../electron/print-invoice.js) | Native print lifecycle, cancellation, errors and temporary-window cleanup |
| [server.js](../server.js) | HTTP routes, record validation, invoice lifecycle and JSON persistence |
| [public/app.js](../public/app.js) | Navigation, forms, builder, invoice ledger and CSV download |
| [public/lines.js](../public/lines.js) | Shared invoice line calculations |
| [public/ledger.js](../public/ledger.js) | Shared ledger selection, totals, status and CSV serialization |
| [lib/invoice-template.js](../lib/invoice-template.js) | Printable invoice HTML |
| [scripts/demo.js](../scripts/demo.js) | Fictional workspace in a disposable temporary directory |

See the [visual architecture and lifecycle guide](visual-guide.md) for the diagrams.
The diagrams document the original architecture; the shared ledger module extends
its existing browser/server pattern without adding a service or runtime dependency.

## Storage, backups, and boundaries

Settings and each collection live in separate JSON files. Each save writes a temporary
file and renames it over that collection. Operations such as invoice creation touch
multiple collections; those writes are **not one atomic transaction**. Avoid running
multiple app/server instances against the same data folder. A network drive or cloud
folder does not turn the app into a shared multi-user database.

For a complete backup, quit every instance using the folder, then copy the entire
folder, including JSON, logo, and `pdfs/`. CSV is a portable invoice ledger, not a
restorable application backup. To use a copied data folder, select it with the Mac
app's **File → Choose Data Folder…** or set `CWINVOICER_DATA` when launching browser mode.
Keep the original backup until you have checked the restored records.

The server binds to `127.0.0.1`, checks the Host header, and requires a custom app
header for writes. These are protections for local use, not account authentication
or customer isolation. Hosting this server publicly would require a separate design.
No account, subscription, analytics service, or cloud database is needed to run it.
