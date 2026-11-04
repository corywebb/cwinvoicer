// The invoice activity log: everything done to invoices, including deleted ones.
import type { LogAction, LogEntry } from '../../shared/types';
import { h } from '../dom';
import { dateTime } from '../format';
import { S, invoice } from '../state';
import { pageHead } from '../ui';

const ACTION_LABELS: Record<LogAction, string> = {
  created: 'Created', edited: 'Edited', reformatted: 'Format changed', paid: 'Marked paid', unpaid: 'Marked unpaid',
  pdf: 'PDF', print: 'Print', deleted: 'Deleted',
};

export function activityTable(log: LogEntry[], { showInvoice }: { showInvoice: boolean }): HTMLElement {
  if (!log.length) return h('p', { class: 'muted' }, 'No activity recorded yet. Actions are logged from this version on.');
  // The log is stored oldest first; reversing before the (stable) sort keeps same-millisecond entries newest first.
  const rows = log.slice().reverse().sort((a, b) => b.at.localeCompare(a.at));
  return h('div', { class: 'table-scroll' }, h('table', { class: 'data' },
    h('thead', null, h('tr', null, h('th', null, 'When'), showInvoice && h('th', null, 'Invoice'), h('th', null, 'Action'), h('th', null, 'Details'))),
    h('tbody', null, rows.map((l) => h('tr', null,
      h('td', { class: 'nowrap' }, dateTime(l.at)),
      showInvoice && h('td', { class: 'nowrap' }, invoice(l.invoiceId)
        ? h('a', { href: `#/invoices/${l.invoiceId}` }, `#${l.number}`)
        : h('span', { class: 'muted' }, `#${l.number} (deleted)`)),
      h('td', { class: 'nowrap' }, ACTION_LABELS[l.action] || l.action),
      h('td', { class: 'desc' }, l.detail || ''))))));
}

export function activityPage(): HTMLElement {
  return h('div', null,
    pageHead('Invoice activity', h('a', { class: 'btn', href: '#/invoices' }, 'Back to invoices')),
    h('p', { class: 'page-intro' }, 'Everything done to your invoices, newest first, including invoices that were deleted.'),
    h('div', { class: 'card' }, activityTable(S.invoiceLog, { showInvoice: true })));
}
