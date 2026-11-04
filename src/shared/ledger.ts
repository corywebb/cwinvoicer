// Shared by the invoice list and CSV endpoint so filters and totals agree.
import type { Invoice } from './types';

export type LedgerStatus = 'paid' | 'unpaid' | 'overdue';
export type LedgerFilters = { client?: string; status?: string; from?: string; to?: string };
export type LedgerTotals = { invoiced: number; paid: number; outstanding: number; overdue: number };

const localToday = () => new Date().toLocaleDateString('en-CA');

export function status(invoice: Pick<Invoice, 'status' | 'dueDate'>, today: string): LedgerStatus {
  return invoice.status === 'paid' ? 'paid' : invoice.dueDate && invoice.dueDate < today ? 'overdue' : 'unpaid';
}

/** Filters (client, status, invoice-date range) and sorts newest number first. Throws on invalid filters. */
export function select(invoices: Invoice[], filters: LedgerFilters = {}, today = localToday()): Invoice[] {
  const { client = '', status: state = 'all', from = '', to = '' } = filters;
  if (!['all', 'paid', 'unpaid', 'overdue'].includes(state)) throw new Error('Choose a valid invoice status.');
  for (const value of [from, to]) {
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error('Enter a valid date (YYYY-MM-DD).');
  }
  if (from && to && from > to) throw new Error('From date must be on or before To date.');
  return invoices.filter((invoice) => (!client || invoice.clientId === client)
    && (state === 'all' || status(invoice, today) === state || (state === 'unpaid' && invoice.status !== 'paid'))
    && (!from || invoice.date >= from) && (!to || invoice.date <= to))
    .sort((a, b) => b.number - a.number);
}

export function totals(invoices: Invoice[], today = localToday()): LedgerTotals {
  const result: LedgerTotals = { invoiced: 0, paid: 0, outstanding: 0, overdue: 0 };
  for (const invoice of invoices) {
    const cents = Math.round(Number(invoice.total) * 100);
    result.invoiced += cents;
    result[invoice.status === 'paid' ? 'paid' : 'outstanding'] += cents;
    if (status(invoice, today) === 'overdue') result.overdue += cents;
  }
  return { invoiced: result.invoiced / 100, paid: result.paid / 100, outstanding: result.outstanding / 100, overdue: result.overdue / 100 };
}

function cell(value: unknown, protect = true): string {
  let text = String(value ?? '');
  // Treat user text as text in spreadsheets, even after leading whitespace.
  if (protect && (/^[\s﻿]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csv(invoices: Invoice[], today = localToday()): string {
  const rows: unknown[][] = [['Invoice number', 'Client', 'Invoice date', 'Due date', 'Status', 'Paid date', 'Total', 'Outstanding', 'Terms', 'Notes']];
  for (const invoice of invoices) rows.push([
    invoice.number, invoice.billTo?.name, invoice.date, invoice.dueDate, status(invoice, today), invoice.paidDate,
    Number(invoice.total).toFixed(2), invoice.status === 'paid' ? '0.00' : Number(invoice.total).toFixed(2),
    invoice.terms, invoice.notes,
  ]);
  // BOM preserves non-ASCII client names in Excel; CRLF and quoting preserve multiline notes.
  return '﻿' + rows.map((row) => row.map((value, index) => cell(value, ![0, 6, 7].includes(index))).join(',')).join('\r\n') + '\r\n';
}
