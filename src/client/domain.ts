// Rates, amounts and statuses as the app shows them.
import { status as ledgerStatus } from '../shared/ledger';
import { timeRate as sharedTimeRate } from '../shared/lines';
import type { Entry, EntryType, Invoice, TimeEntry } from '../shared/types';
import { h } from './dom';
import { round2, today, usDate } from './format';
import { S, client, project } from './state';

export const ENTRY_TYPES: EntryType[] = ['time', 'items', 'expenses'];

export const TYPES: Record<EntryType, { label: string; one: string; add: string }> = {
  time: { label: 'Time', one: 'time entry', add: '+ Log time' },
  items: { label: 'Line Items', one: 'line item', add: '+ Line item' },
  expenses: { label: 'Expenses', one: 'expense', add: '+ Expense' },
};

/** The rate a new time entry would get: project, else client, else the default. */
export function defaultRate({ clientId, projectId }: { clientId?: string; projectId?: string }): number {
  return project(projectId)?.rate ?? client(clientId)?.rate ?? S.settings.defaultRate;
}

export const timeRate = (e: TimeEntry) => sharedTimeRate(e, S);

/** Hours, quantity, or 1 for an expense. */
export const qtyOf = (e: Entry) => ('hours' in e ? e.hours : 'qty' in e ? e.qty : 1);
/** Effective hourly rate, item rate, or the expense amount. */
export const rateOf = (e: Entry) => ('hours' in e ? timeRate(e) : 'qty' in e ? e.rate : e.amount);

export function entryAmount(e: Entry): number {
  if ('hours' in e) return round2(e.hours * timeRate(e));
  if ('qty' in e) return round2(e.qty * e.rate);
  return round2(e.amount);
}

export const invoiceStatus = (inv: Invoice) => ledgerStatus(inv, today());

export function statusBadge(inv: Invoice): HTMLElement {
  const s = invoiceStatus(inv);
  return h('span', { class: `badge ${s}` }, s === 'paid' ? `Paid ${usDate(inv.paidDate)}` : s === 'overdue' ? 'Overdue' : 'Unpaid');
}

export type UnbilledTotals = { hours: number; time: number; items: number; expenses: number; count: number };

/** Unbilled hours and amounts per client id. */
export function unbilledByClient(): Map<string, UnbilledTotals> {
  const out = new Map<string, UnbilledTotals>();
  for (const type of ENTRY_TYPES) {
    for (const e of S[type]) {
      if (e.invoiceId) continue;
      const row = out.get(e.clientId) || { hours: 0, time: 0, items: 0, expenses: 0, count: 0 };
      if ('hours' in e) row.hours += e.hours;
      row[type] += entryAmount(e);
      row.count++;
      out.set(e.clientId, row);
    }
  }
  return out;
}
