import type { EntryType } from '../../shared/types';
import { toast } from '../api';
import { h } from '../dom';
import { TYPES, unbilledByClient } from '../domain';
import { editEntry } from '../entries';
import { money, qtyFmt } from '../format';
import { S, client, render } from '../state';
import { pageHead } from '../ui';
import { invoiceTable } from './invoices';

export function dashboard(): HTMLElement {
  const unbilled = unbilledByClient();
  const totalUnbilled = [...unbilled.values()].reduce((s, r) => s + r.time + r.items + r.expenses, 0);
  const totalHours = [...unbilled.values()].reduce((s, r) => s + r.hours, 0);
  const outstanding = S.invoices.filter((i) => i.status !== 'paid');
  const outstandingTotal = outstanding.reduce((s, i) => s + i.total, 0);
  const quickAdd = (type: EntryType) => async () => {
    if (await editEntry(type)) (toast('Saved'), render());
  };

  return h('div', null,
    h('div', { class: 'eyebrow' }, 'YOUR BUSINESS AT A GLANCE'),
    pageHead('Dashboard',
      h('button', { onclick: quickAdd('time') }, TYPES.time.add),
      h('button', { onclick: quickAdd('items') }, TYPES.items.add),
      h('button', { onclick: quickAdd('expenses') }, TYPES.expenses.add)),
    h('p', { class: 'page-intro' }, 'Good work deserves a clear invoice. Here’s where things stand.'),
    h('div', { class: 'grid stats-grid' },
      h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Unbilled'), h('div', { class: 'stat' }, `$${money(totalUnbilled)}`),
        h('div', { class: 'muted small' }, `${qtyFmt(totalHours)} hours of time`)),
      h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Outstanding invoices'), h('div', { class: 'stat' }, `$${money(outstandingTotal)}`),
        h('div', { class: 'muted small' }, `${outstanding.length} unpaid`)),
      h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Next invoice number'), h('div', { class: 'stat' }, `#${S.nextInvoiceNumber}`),
        h('div', { class: 'muted small' }, h('a', { href: '#/settings' }, 'Change in settings')))),
    h('h2', { style: 'margin-top:8px' }, 'Ready to bill'),
    unbilled.size
      ? h('div', { class: 'grid' }, [...unbilled.entries()].map(([clientId, r]) =>
          h('div', { class: 'card' },
            h('div', { class: 'card-head' }, h('strong', null, client(clientId)?.name || 'Unknown client'),
              h('span', { class: 'stat', style: 'font-size:18px' }, `$${money(r.time + r.items + r.expenses)}`)),
            h('div', { class: 'muted small' },
              [r.hours && `${qtyFmt(r.hours)} hrs ($${money(r.time)})`, r.items && `items $${money(r.items)}`, r.expenses && `expenses $${money(r.expenses)}`]
                .filter(Boolean).join(' · ')),
            h('div', { style: 'margin-top:12px' }, h('a', { class: 'btn primary', href: `#/invoices/new?client=${clientId}` }, 'Create invoice')))))
      : h('div', { class: 'card empty' }, h('strong', null, S.clients.length ? 'You’re all caught up.' : 'Your next project starts here.'),
          h('p', null, S.clients.length ? 'Log time, items or expenses when you’re ready to bill again.' : 'Add a client, log your work, and turn it into an invoice.'),
          h('a', { class: 'btn primary', href: S.clients.length ? '#/time' : '#/clients' }, S.clients.length ? 'Log your work' : 'Add your first client')),
    h('h2', { style: 'margin-top:8px' }, 'Recent invoices'),
    invoiceTable(S.invoices.slice().sort((a, b) => b.number - a.number).slice(0, 6)));
}
