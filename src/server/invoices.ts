// Creating, editing and deleting invoices.
import * as crypto from 'node:crypto';
import { buildLines, timeRate } from '../shared/lines';
import type { Entry, EntryType, ExpenseEntry, Invoice, InvoiceFormat, InvoiceLine, ItemEntry, TimeEntry } from '../shared/types';
import { cap, describeEdit, dollars, entryCount, logInvoice, usDate } from './log';
import { removePdf } from './pdf';
import { type Db, loadAll, save } from './storage';
import { HttpError, now, round2, today } from './util';
import { type Body, asObject, isFormat, isoDate } from './validate';

export const ENTRY_TYPES: EntryType[] = ['time', 'items', 'expenses'];

type Entries = { time: TimeEntry[]; items: ItemEntry[]; expenses: ExpenseEntry[] };
type Format = { format: InvoiceFormat; overrides: Record<string, string> };
/** An invoice before it's saved, as the preview renders it. */
export type InvoiceDraft = Omit<Invoice, 'id' | 'sources' | 'status' | 'paidDate' | 'createdAt' | 'updatedAt'>;

export function nextInvoiceNumber(db: Db): number {
  const max = db.invoices.reduce((m, i) => Math.max(m, Number(i.number) || 0), 0);
  return Math.max(Number(db.settings.startingInvoiceNumber) || 1, max + 1);
}

export function invoiceNumber(db: Db, id: string): number | '?' {
  return db.invoices.find((i) => i.id === id)?.number ?? '?';
}

/**
 * Looks up the entries named in `sources` ({time: [ids], items: [ids], expenses: [ids]}) for a client.
 * For a preview, unknown and other clients' entries are skipped instead of rejected.
 */
export function collectEntries(db: Db, clientId: unknown, sources: unknown, { forPreview = false } = {}): Entries {
  const named = asObject(sources);
  const pick = <T extends Entry>(list: T[], t: EntryType): T[] => {
    const ids = named[t];
    const found: T[] = [];
    // De-duplicate so an entry listed twice is billed once (it isn't marked invoiced until after this check).
    for (const entryId of new Set(Array.isArray(ids) ? ids : [])) {
      const e = list.find((x) => x.id === entryId);
      if (forPreview) {
        if (e && e.clientId === clientId) found.push(e);
        continue;
      }
      if (!e) throw new HttpError(400, `Unknown ${t} entry`);
      if (e.clientId !== clientId) throw new HttpError(400, 'Entry belongs to a different client');
      if (e.invoiceId) throw new HttpError(409, `An entry was already invoiced (#${invoiceNumber(db, e.invoiceId)})`);
      found.push(e);
    }
    return found;
  };
  return { time: pick(db.time, 'time'), items: pick(db.items, 'items'), expenses: pick(db.expenses, 'expenses') };
}

function cleanFormat(body: Body, fallback: { format: unknown; overrides?: Record<string, string> }): Format {
  const format = body.format ?? fallback.format;
  if (!isFormat(format)) throw new HttpError(400, 'Format must be summary or detailed');
  const overrides: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...fallback.overrides, ...asObject(body.overrides) })) if (typeof v === 'string') overrides[k] = v.trim();
  return { format, overrides };
}

function linesFor(db: Db, entries: Entries, fmt: Format): InvoiceLine[] {
  return buildLines({ ...fmt, ...entries }, db).map(({ key, type, date, description, qty, rate, amount }) => ({ key, type, date, description, qty, rate, amount }));
}
const sumLines = (lines: InvoiceLine[]) => round2(lines.reduce((s, l) => s + l.amount, 0));

export function buildInvoice(db: Db, body: Body, entries: Entries): InvoiceDraft {
  const client = db.clients.find((c) => c.id === body.clientId);
  if (!client) throw new HttpError(400, 'Choose a client');
  const fmt = cleanFormat(body, { format: db.settings.defaultInvoiceFormat, overrides: {} });
  const lines = linesFor(db, entries, fmt);
  return {
    number: nextInvoiceNumber(db),
    clientId: client.id,
    date: isoDate(body.date, 'date') || today(),
    dueDate: isoDate(body.dueDate, 'dueDate'),
    terms: String(body.terms ?? '').trim() || null,
    notes: String(body.notes ?? '').trim() || null,
    billTo: { name: client.name, address: client.address || null },
    from: { businessName: db.settings.businessName, businessDetails: db.settings.businessDetails },
    ...fmt,
    lines,
    total: sumLines(lines),
  };
}

export function createInvoice(body: Body): Invoice {
  const db = loadAll();
  const entries = collectEntries(db, body.clientId, body.sources);
  const draft = buildInvoice(db, body, entries);
  if (!draft.lines.length) throw new HttpError(400, 'Select at least one entry to invoice');
  const id = crypto.randomUUID();
  const stamp = now();
  const sources = { time: entries.time.map((e) => e.id), items: entries.items.map((e) => e.id), expenses: entries.expenses.map((e) => e.id) };
  const invoice: Invoice = { id, ...draft, sources, status: 'unpaid', paidDate: null, createdAt: stamp, updatedAt: stamp };
  // Lock in the hourly rate so later rate changes never alter a billed invoice.
  for (const e of entries.time) e.billedRate = timeRate(e, db);
  for (const t of ENTRY_TYPES) {
    if (!entries[t].length) continue;
    for (const e of entries[t]) Object.assign(e, { invoiceId: id, invoicedAt: stamp, updatedAt: stamp });
    save(t, db[t]);
  }
  db.invoices.push(invoice);
  save('invoices', db.invoices);
  const billed = ENTRY_TYPES.reduce((n, t) => n + entries[t].length, 0);
  logInvoice(db, invoice, 'created', `${dollars(invoice.total)} · ${entryCount(billed)}`);
  return invoice;
}

export function updateInvoice(id: string, body: Body): Invoice {
  const db = loadAll();
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  const before = structuredClone(inv);
  if ('date' in body) {
    const date = isoDate(body.date, 'date');
    if (!date) throw new HttpError(400, 'date is required');
    inv.date = date;
  }
  if ('dueDate' in body) inv.dueDate = isoDate(body.dueDate, 'dueDate');
  if ('paidDate' in body) inv.paidDate = isoDate(body.paidDate, 'paidDate');
  for (const k of ['terms', 'notes'] as const) if (k in body) inv[k] = String(body[k] ?? '').trim() || null;
  if (body.billTo) {
    const billTo = asObject(body.billTo);
    inv.billTo = {
      name: String(billTo.name ?? inv.billTo.name).trim(),
      address: String(billTo.address ?? '').trim() || null,
    };
  }
  if ('status' in body) {
    const status = body.status;
    if (status !== 'paid' && status !== 'unpaid') throw new HttpError(400, 'Invalid status');
    inv.status = status;
    if (inv.status === 'paid' && !inv.paidDate) inv.paidDate = today();
    if (inv.status === 'unpaid') inv.paidDate = null;
  }
  if ('format' in body || 'overrides' in body) {
    Reflect.deleteProperty(inv, 'showDates'); // replaced by the detailed format
    Object.assign(inv, cleanFormat(body, { format: inv.format || 'summary', overrides: inv.overrides }));
    const billed = <T extends Entry>(list: T[]) => list.filter((e) => e.invoiceId === inv.id);
    inv.lines = linesFor(db, { time: billed(db.time), items: billed(db.items), expenses: billed(db.expenses) }, inv);
    inv.total = sumLines(inv.lines);
  }
  const edited = describeEdit(before, inv);
  const statusChanged = before.status !== inv.status;
  const formatChanged = (before.format || 'summary') !== inv.format;
  // Saving with nothing changed doesn't touch the invoice, its PDF or the log.
  if (!edited && !statusChanged && !formatChanged && before.total === inv.total) return before;
  inv.updatedAt = now();
  save('invoices', db.invoices);
  removePdf(inv);
  if (statusChanged) logInvoice(db, inv, inv.status, inv.status === 'paid' ? `Paid on ${usDate(inv.paidDate)}` : null);
  if (formatChanged) logInvoice(db, inv, 'reformatted', `${cap(before.format || 'summary')} → ${cap(inv.format)}`);
  if (edited) logInvoice(db, inv, 'edited', edited);
  return inv;
}

/** Deletes an invoice and marks its entries unbilled again. */
export function deleteInvoice(id: string): void {
  const db = loadAll();
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  const stamp = now();
  let released = 0;
  for (const t of ENTRY_TYPES) {
    let changed = false;
    for (const e of db[t]) {
      if (e.invoiceId !== id) continue;
      e.invoiceId = null;
      e.invoicedAt = null;
      e.updatedAt = stamp;
      if ('billedRate' in e) delete e.billedRate;
      released++;
      changed = true;
    }
    if (changed) save(t, db[t]);
  }
  save('invoices', db.invoices.filter((i) => i !== inv));
  removePdf(inv);
  logInvoice(db, inv, 'deleted', `${dollars(inv.total)} · ${entryCount(released)} marked unbilled`);
}
