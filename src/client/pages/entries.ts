// The Time, Line Items and Expenses pages.
import type { EntryType } from '../../shared/types';
import { toast } from '../api';
import { h } from '../dom';
import { TYPES, entryAmount, qtyOf, rateOf } from '../domain';
import { deleteEntry, editEntry } from '../entries';
import { byDate, money, qtyFmt, rateFmt, today, usDate } from '../format';
import { S, activeClients, client, clientProjects, invoice, project, render } from '../state';
import { pageHead } from '../ui';

const filters = { client: '', project: '', status: 'unbilled' };

export function entriesPage(type: EntryType): HTMLElement {
  const rows = S[type]
    .filter((e) => (!filters.client || e.clientId === filters.client)
      && (!filters.project || e.projectId === filters.project)
      && (filters.status === 'all' || (filters.status === 'unbilled' ? !e.invoiceId : e.invoiceId)))
    .sort((a, b) => byDate(b, a));
  const showQty = type !== 'expenses';
  const total = rows.reduce((s, e) => s + entryAmount(e), 0);
  const hours = rows.reduce((s, e) => s + ('hours' in e ? e.hours : 0), 0);
  const setFilter = (k: keyof typeof filters) => (ev: { target: HTMLInputElement }) => {
    filters[k] = ev.target.value;
    if (k === 'client') filters.project = '';
    render();
  };
  const addNew = async () => {
    if (await editEntry(type, null, { clientId: filters.client, projectId: filters.project })) (toast('Saved'), render());
  };

  return h('div', null,
    pageHead(TYPES[type].label, h('button', { class: 'primary', onclick: addNew }, TYPES[type].add)),
    h('div', { class: 'filters' },
      h('select', { 'aria-label': 'Filter by client', onchange: setFilter('client') }, h('option', { value: '' }, 'All clients'),
        activeClients(filters.client).map((c) => h('option', { value: c.id, selected: c.id === filters.client }, c.name))),
      filters.client && h('select', { 'aria-label': 'Filter by project', onchange: setFilter('project') }, h('option', { value: '' }, 'All projects'),
        clientProjects(filters.client, filters.project).map((p) => h('option', { value: p.id, selected: p.id === filters.project }, p.name))),
      h('select', { 'aria-label': 'Filter by status', onchange: setFilter('status') },
        [['unbilled', 'Unbilled'], ['invoiced', 'Invoiced'], ['all', 'All']].map(([v, l]) => h('option', { value: v, selected: v === filters.status }, l)))),
    h('div', { class: 'card' }, rows.length
      ? h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Client / Project'), h('th', null, 'Description'),
            showQty && h('th', { class: 'num' }, type === 'time' ? 'Hours' : 'Qty'), showQty && h('th', { class: 'num' }, 'Rate'),
            h('th', { class: 'num' }, 'Amount'), h('th', null, 'Status'), h('th'))),
          h('tbody', null, rows.map((e) => {
            const inv = e.invoiceId ? invoice(e.invoiceId) : undefined;
            return h('tr', { class: inv ? 'off' : '' },
              h('td', { class: 'nowrap' }, usDate(e.date)),
              h('td', null, client(e.clientId)?.name, e.projectId && h('div', { class: 'muted small' }, project(e.projectId)?.name)),
              h('td', { class: 'desc' }, e.description),
              showQty && h('td', { class: 'num' }, qtyFmt(qtyOf(e))),
              showQty && h('td', { class: 'num' }, rateFmt(rateOf(e)), 'hours' in e && e.rate != null && h('div', { class: 'muted small' }, 'override')),
              h('td', { class: 'num' }, money(entryAmount(e))),
              h('td', null, inv ? h('a', { href: `#/invoices/${inv.id}` }, `#${inv.number}`) : h('span', { class: 'badge unbilled' }, 'Unbilled')),
              h('td', { class: 'nowrap right' },
                !inv && h('button', { class: 'link', onclick: async () => (await editEntry(type, e)) && render() }, 'Edit'),
                h('button', { class: 'link', title: 'Make a copy dated today',
                  onclick: async () => (await editEntry(type, null, { ...e, id: undefined, invoiceId: undefined, date: today() })) && render() }, 'Copy'),
                !inv && h('button', { class: 'link danger', onclick: () => deleteEntry(type, e) }, 'Delete')));
          })),
          h('tfoot', null, h('tr', null, h('td', { colspan: 3 }, `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`),
            showQty && h('td', { class: 'num' }, type === 'time' ? qtyFmt(hours) : ''), showQty && h('td'),
            h('td', { class: 'num' }, money(total)), h('td'), h('td'))))
      : h('div', { class: 'empty' }, `No ${filters.status === 'all' ? '' : filters.status + ' '}${TYPES[type].label.toLowerCase()} here.`)));
}
