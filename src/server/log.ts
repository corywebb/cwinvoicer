// The invoice activity log.
import * as crypto from 'node:crypto';
import type { Invoice, LogAction } from '../shared/types';
import { type Db, loadAll, save } from './storage';
import { HttpError, now } from './util';

const LOG_ACTIONS: LogAction[] = ['created', 'edited', 'reformatted', 'paid', 'unpaid', 'pdf', 'print', 'deleted'];

export function logInvoice(db: Db, inv: Pick<Invoice, 'id' | 'number'>, action: LogAction, detail: string | null = null): void {
  if (!LOG_ACTIONS.includes(action)) throw new Error(`Unknown invoice action: ${action}`);
  db.invoiceLog.push({ id: crypto.randomUUID(), invoiceId: inv.id, number: inv.number, at: now(), action, detail });
  save('invoice-log', db.invoiceLog);
}

// Events the app reports when you click PDF and print buttons. The details are fixed here,
// so the log only ever says what the server wrote.
const CLIENT_EVENTS: Record<string, [LogAction, string]> = {
  'pdf-open': ['pdf', 'Opened PDF'],
  'pdf-download': ['pdf', 'Downloaded PDF'],
  print: ['print', 'Opened the print dialog'],
};

/** Logs an event the app reported for an invoice. */
export function recordClientEvent(id: string, event: unknown): void {
  if (typeof event !== 'string' || !Object.hasOwn(CLIENT_EVENTS, event)) throw new HttpError(400, 'Unknown event');
  const db = loadAll();
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  logInvoice(db, inv, ...CLIENT_EVENTS[event]);
}

export const usDate = (iso: string | null | undefined) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : 'none');
export const dollars = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const entryCount = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Describes what an edit changed, e.g. "Due date 01/15/2026 → 01/30/2026; Notes". Empty if nothing did. */
export function describeEdit(before: Invoice, after: Invoice): string {
  const changes: string[] = [];
  const same = (a: unknown, b: unknown) => (a || null) === (b || null);
  const dates = [['date', 'Invoice date'], ['dueDate', 'Due date'], ['paidDate', 'Paid date']] as const;
  for (const [k, label] of dates) {
    if (k === 'paidDate' && before.status !== after.status) continue; // covered by the paid/unpaid entry
    if (!same(before[k], after[k])) changes.push(`${label} ${usDate(before[k])} → ${usDate(after[k])}`);
  }
  for (const [k, label] of [['terms', 'Terms'], ['notes', 'Notes']] as const) if (!same(before[k], after[k])) changes.push(label);
  if (before.billTo?.name !== after.billTo?.name) changes.push('Bill to');
  if (!same(before.billTo?.address, after.billTo?.address)) changes.push('Bill-to address');
  if ((before.format || 'summary') === after.format) {
    const renamed = after.lines.filter((l) => before.lines.find((b) => b.key === l.key)?.description !== l.description).length;
    if (renamed) changes.push(`${renamed} line description${renamed === 1 ? '' : 's'}`);
  }
  return changes.join('; ');
}
