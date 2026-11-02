# CW Invoicer

A local invoicing app for Cory Webb Media. A Mac desktop app; no accounts, no cloud.

## Build and run

- **Build:** `npm install`, then `npm run dist`. This creates `dist/mac/CW Invoicer.app` and `dist/CW Invoicer-1.0.0.dmg`.
  Drag the app into Applications. It isn't signed, so the first time, right-click it and choose **Open**.
- **Try it without building:** `npm run app`.
- The server runs inside the app on a private port, so no Terminal, browser or Google Chrome is needed. Cmd+Q quits everything.
  PDFs are made with the app's built-in Chromium and open in Preview; Print uses the macOS print dialog.
- **Shortcuts:** ⌘N new invoice, ⌘T log time, ⌘L line item, ⌘E expense, ⌘1–⌘6 sections, ⌘, settings.
- **Data folder:** set in `~/Library/Application Support/CW Invoicer/config.json` (`dataDir`), or with
  **File → Choose Data Folder…**, which can copy your data to the new folder. Without a setting it uses
  `~/Library/Application Support/CW Invoicer/data`. `CWINVOICER_DATA` overrides it, for testing.

## Browser mode (for development)

`npm start` runs the same server on <http://localhost:4242> and opens it in your browser (stop it with Ctrl+C).
PDF export then uses Google Chrome. It uses the same data folder as the desktop app (from its `config.json`) unless `CWINVOICER_DATA` is set; `PORT` changes the port.

## How it works

1. **Clients & Projects**: add clients with an hourly rate. Projects can override the client's rate.
2. **Log work**: add **Time** (hours like `1.5`, `1:30` or `90m`), **Line Items** (qty × rate) and **Expenses**.
   A time entry can override the rate. Otherwise the rate comes from the project, then the client, then the default in Settings.
3. **Create an invoice**: pick a client. Everything unbilled for that client starts selected; uncheck anything you don't
   want to bill yet. You can add time, line items or expenses right in the builder. Line descriptions can be edited
   before you create the invoice.
   - **Summary** format: one line per project (hours × rate). A project's line items and expenses are combined into one
     "‹Project› – expenses" line. Time with no project becomes one line; items and expenses with no project are listed on their own.
   - **Detailed** format: every time entry, line item and expense with its date and own description, grouped under a
     bold heading for each project (oldest first). Entries with no project come last, under "Other".
   You can switch the format on an existing invoice too. The default is set in Settings.
4. When you create the invoice it gets the next number, and the selected entries are marked invoiced so they won't show
   up again. Deleting an invoice marks its entries as unbilled again.
5. On the invoice page you can **Open/Download PDF** (saved to the data folder's `pdfs/`),
   Print, Edit details, or Mark paid.

## Invoice numbers

Numbers start at the **Starting invoice number** in Settings (1242 by default). After that, each invoice gets
`max(starting number, highest existing invoice + 1)`.

## Data

Everything is plain JSON in the data folder (by default `~/Library/Application Support/CW Invoicer/data`):

| File | Contents |
| --- | --- |
| `settings.json` | business details, starting number, default rate/terms/due days |
| `clients.json`, `projects.json` | clients and projects |
| `time.json`, `items.json`, `expenses.json` | work entries (`invoiceId` is set once billed) |
| `invoices.json` | invoices, with a copy of each line as it was billed |
| `logo.png`, `pdfs/` | logo and generated PDFs |

Back up the data folder to back up everything. To move it (for example to iCloud Drive), use **File → Choose Data Folder…**
in the app. The current location is shown on the Settings page.
