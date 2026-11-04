// One invoice: preview, actions, billed entries and activity.
import type { Entry, EntryType } from '../../shared/types';
import { api, errorMessage, toast } from '../api';
import { h } from '../dom';
import { ENTRY_TYPES, TYPES, entryAmount, statusBadge } from '../domain';
import { byDate, money, qtyFmt, rateFmt, stamps, usDate } from '../format';
import { type FieldSpec, type FormValues, formModal } from '../modal';
import { S, invoice, refresh, render } from '../state';
import { act, formatControls, pageHead, previewBox } from '../ui';
import { activityTable } from './activity';

export function invoiceView(id: string): HTMLElement {
  const inv = invoice(id);
  if (!inv) return h('div', { class: 'card empty' }, 'Invoice not found. ', h('a', { href: '#/invoices' }, 'Back to invoices'));
  const isLatest = inv.number === Math.max(...S.invoices.map((i) => i.number));
  const pdfUrl = (dl: boolean) => `/api/invoices/${inv.id}/pdf${dl ? '?download=1' : ''}`;

  const togglePaid = async () => {
    await api('PUT', `/api/invoices/${inv.id}`, { status: inv.status === 'paid' ? 'unpaid' : 'paid' });
    render();
  };
  const remove = async () => {
    const gap = isLatest ? '' : `\n\nNote: this isn't the most recent invoice, so #${inv.number} will be skipped in your numbering.`;
    if (!confirm(`Delete invoice #${inv.number}?\n\nIts time, line items and expenses will be marked unbilled again.${gap}`)) return;
    await api('DELETE', `/api/invoices/${inv.id}`);
    toast(`Invoice #${inv.number} deleted`);
    location.hash = '#/invoices';
  };
  const edit = async () => {
    const values: FormValues = { date: inv.date, dueDate: inv.dueDate || '', terms: inv.terms || '', notes: inv.notes || '',
      billToName: inv.billTo?.name || '', billToAddress: inv.billTo?.address || '', paidDate: inv.paidDate || '' };
    inv.lines.forEach((l) => (values[`line:${l.key}`] = l.description));
    const paidField: FieldSpec[] = inv.status === 'paid' ? [{ name: 'paidDate', label: 'Paid on', type: 'date' }] : [];
    const saved = await formModal({
      title: `Edit invoice #${inv.number}`,
      values,
      fields: [
        [{ name: 'date', label: 'Invoice date', type: 'date', required: true }, { name: 'dueDate', label: 'Due date', type: 'date' }],
        [{ name: 'terms', label: 'Terms' }, ...paidField],
        { name: 'billToName', label: 'Bill to', required: true },
        { name: 'billToAddress', label: 'Bill-to address', type: 'textarea', rows: 2 },
        ...inv.lines.map((l): FieldSpec => ({ name: `line:${l.key}`, type: 'textarea', rows: l.type === 'heading' ? 1 : 2,
          label: l.type === 'heading' ? 'Project heading' : `${l.date ? `${usDate(l.date)} · ` : ''}${qtyFmt(l.qty)} × ${rateFmt(l.rate)}` })),
        { name: 'notes', label: 'Notes (printed at the bottom)', type: 'textarea', rows: 2 },
      ],
      onSubmit: (v) => api('PUT', `/api/invoices/${inv.id}`, {
        date: v.date, dueDate: v.dueDate, terms: v.terms, notes: v.notes, paidDate: inv.status === 'paid' ? v.paidDate : undefined,
        billTo: { name: v.billToName, address: v.billToAddress },
        overrides: Object.fromEntries(inv.lines.map((l) => [l.key, v[`line:${l.key}`]])),
      }),
    });
    if (saved) (toast('Invoice updated'), render());
  };
  const reveal = () => api('POST', `/api/invoices/${inv.id}/reveal`).catch((e) => toast(errorMessage(e), true));
  // PDF and print are plain links, so their clicks are reported separately. Only the
  // Activity card is redrawn, so the preview doesn't reload.
  const activity = h('div', { class: 'card', style: 'margin-top:16px;max-width:900px' });
  const drawActivity = () => activity.replaceChildren(h('h2', null, 'Activity'),
    activityTable(S.invoiceLog.filter((l) => l.invoiceId === inv.id), { showInvoice: false }));
  const logEvent = (event: string) => () => {
    api('POST', `/api/invoices/${inv.id}/log`, { event })
      .then(refresh).then(drawActivity)
      .catch((e) => toast(errorMessage(e), true));
  };
  drawActivity();
  const reformat = (change: object) => act(() => api('PUT', `/api/invoices/${inv.id}`, change));

  const frame = h('iframe', { src: `/invoice/${inv.id}?v=${Date.now()}`, title: 'Invoice preview' });
  const sourceRows: { t: EntryType; e: Entry }[] = ENTRY_TYPES
    .flatMap((t) => S[t].filter((e) => e.invoiceId === inv.id).map((e) => ({ t, e })))
    .sort((a, b) => byDate(a.e, b.e));

  return h('div', { class: 'invoice-view' },
    pageHead(`Invoice #${inv.number}`,
      statusBadge(inv),
      S.pdfAvailable && h('a', { class: 'btn primary', href: pdfUrl(false), target: '_blank', onclick: logEvent('pdf-open') }, 'Open PDF'),
      S.pdfAvailable && h('a', { class: 'btn', href: pdfUrl(true), onclick: logEvent('pdf-download') }, 'Download PDF'),
      S.pdfAvailable && h('button', { onclick: reveal }, 'Show in Finder'),
      h('a', { class: 'btn', href: `/invoice/${inv.id}?print`, target: '_blank', onclick: logEvent('print') }, 'Print'),
      h('button', { onclick: togglePaid }, inv.status === 'paid' ? 'Mark unpaid' : 'Mark paid'),
      h('button', { onclick: edit }, 'Edit'),
      h('button', { class: 'danger', onclick: remove }, 'Delete')),
    h('div', { class: 'page-head', style: 'margin-bottom:12px;max-width:900px' },
      h('span', { class: 'muted' }, `${inv.billTo?.name} · $${money(inv.total)} · ${stamps(inv)}`),
      formatControls({ format: inv.format || 'summary' }, reformat)),
    previewBox(frame),
    sourceRows.length > 0 && h('div', { class: 'card', style: 'margin-top:16px;max-width:900px' },
      h('h2', null, 'Billed on this invoice'),
      h('table', { class: 'data' }, h('tbody', null, sourceRows.map(({ t, e }) => h('tr', null,
        h('td', { class: 'nowrap' }, usDate(e.date)), h('td', null, TYPES[t].one), h('td', { class: 'desc' }, e.description),
        h('td', { class: 'num' }, 'hours' in e ? `${qtyFmt(e.hours)} h` : ''), h('td', { class: 'num' }, money(entryAmount(e)))))))),
    activity);
}
