// The invoice list: filters, totals and CSV export.
import { select, totals as ledgerTotals, type LedgerTotals } from '../../shared/ledger';
import type { Invoice } from '../../shared/types';
import { api, errorMessage, toast } from '../api';
import { h, type UIEvent } from '../dom';
import { statusBadge } from '../domain';
import { money, today, usDate } from '../format';
import { S, render } from '../state';
import { pageHead } from '../ui';

export function invoiceTable(list: Invoice[]): HTMLElement {
  if (!list.length) return h('div', { class: 'card empty' }, 'No invoices yet.');
  return h('div', { class: 'card' }, h('table', { class: 'data' },
    h('thead', null, h('tr', null, h('th', null, 'Invoice #'), h('th', null, 'Client'), h('th', null, 'Date'), h('th', null, 'Due'),
      h('th', { class: 'num' }, 'Total'), h('th', null, 'Status'))),
    h('tbody', null, list.map((inv) => h('tr', { class: 'clickable', onclick: () => (location.hash = `#/invoices/${inv.id}`) },
      h('td', null, h('a', { href: `#/invoices/${inv.id}`, 'aria-label': `Open invoice ${inv.number}` }, h('strong', null, inv.number))),
      h('td', null, inv.billTo?.name), h('td', null, usDate(inv.date)), h('td', null, usDate(inv.dueDate)),
      h('td', { class: 'num' }, `$${money(inv.total)}`), h('td', null, statusBadge(inv)))))));
}

type InvoiceFilters = { status: string; client: string; from: string; to: string };
const EMPTY_FILTERS: InvoiceFilters = { status: 'all', client: '', from: '', to: '' };
const invoiceFilters: InvoiceFilters = { ...EMPTY_FILTERS };

const STATUS_OPTIONS = [['all', 'All'], ['unpaid', 'Unpaid (including overdue)'], ['overdue', 'Overdue'], ['paid', 'Paid']] as const;
const TOTAL_CARDS: [keyof LedgerTotals, string][] = [['invoiced', 'Invoiced'], ['paid', 'Paid'], ['outstanding', 'Outstanding'], ['overdue', 'Overdue']];

export function invoicesPage(): HTMLElement {
  let list: Invoice[] = [];
  let error = '';
  try { list = select(S.invoices, invoiceFilters, today()); }
  catch (e) { error = errorMessage(e); }
  const totals = ledgerTotals(list, today());
  const set = (k: keyof InvoiceFilters) => (ev: UIEvent) => { invoiceFilters[k] = ev.target.value; render(); };
  const reset = () => { Object.assign(invoiceFilters, EMPTY_FILTERS); render(); };
  const exportButton = h('button', { disabled: !!error || !list.length, onclick: async () => {
    exportButton.disabled = true;
    try {
      const csv = await api<string>('GET', `/api/invoices/export.csv?${new URLSearchParams(invoiceFilters)}`);
      const url = URL.createObjectURL(new Blob(['﻿' + csv.replace(/^﻿/, '')], { type: 'text/csv;charset=utf-8' }));
      const link = h('a', { href: url, download: `cwinvoicer-invoices-${today()}.csv` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('CSV download started');
    } catch (e) { toast(errorMessage(e), true); }
    finally { exportButton.disabled = false; }
  } }, 'Export CSV');
  // Archived clients still belong in the historical ledger.
  const clients = S.clients.filter((c) => !c.archived || S.invoices.some((i) => i.clientId === c.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return h('div', null,
    pageHead('Invoices', h('a', { class: 'btn', href: '#/invoices/activity' }, 'Activity log'), exportButton, h('a', { class: 'btn primary', href: '#/invoices/new' }, '+ New invoice')),
    h('p', { class: 'muted' }, 'Review your billing history and export the selected invoices to a spreadsheet.'),
    h('div', { class: 'filters ledger-filters' },
      h('label', { class: 'field' }, h('span', null, 'Client'),
        h('select', { 'aria-label': 'Filter by client', onchange: set('client') }, h('option', { value: '' }, 'All clients'),
          clients.map((c) => h('option', { value: c.id, selected: c.id === invoiceFilters.client }, c.name + (c.archived ? ' (archived)' : ''))))),
      h('label', { class: 'field' }, h('span', null, 'Status'),
        h('select', { 'aria-label': 'Filter by status', onchange: set('status') },
          STATUS_OPTIONS.map(([v, l]) => h('option', { value: v, selected: v === invoiceFilters.status }, l)))),
      (['from', 'to'] as const).map((key) => h('label', { class: 'field' }, h('span', null, key === 'from' ? 'From date' : 'To date'),
        h('input', { type: 'date', value: invoiceFilters[key], onchange: set(key), 'aria-invalid': error ? 'true' : null, 'aria-describedby': error ? 'ledger-error' : null }))),
      h('button', { onclick: reset }, 'Reset filters')),
    h('p', { class: 'muted small' }, 'Dates filter the invoice date, including both endpoints. Paid totals describe these invoices, not payments received during the period.'),
    error ? h('p', { id: 'ledger-error', role: 'alert', class: 'form-error' }, error) : [
      h('div', { class: 'grid stats-grid ledger-totals', 'aria-label': 'Selected invoice totals' },
        TOTAL_CARDS.map(([key, label]) =>
          h('div', { class: 'card' }, h('div', { class: 'muted small' }, label), h('div', { class: 'stat' }, `$${money(totals[key])}`)))),
      h('p', { class: 'muted', role: 'status' }, `${list.length} ${list.length === 1 ? 'invoice' : 'invoices'} selected. Export CSV includes this selection.`),
      list.length ? invoiceTable(list) : h('div', { class: 'card empty' }, S.invoices.length ? 'No invoices match these filters. Try a wider date range or reset the filters.' : 'No invoices yet.'),
    ]);
}
