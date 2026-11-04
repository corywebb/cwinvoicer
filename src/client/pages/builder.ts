// The new-invoice builder: pick unbilled work, edit line descriptions, preview, create.
import { buildLines } from '../../shared/lines';
import type { Entry, EntryType, Invoice, InvoiceFormat } from '../../shared/types';
import { api, errorMessage, toast } from '../api';
import { h, scrollTables, type UIEvent } from '../dom';
import { ENTRY_TYPES, TYPES, entryAmount, qtyOf, rateOf } from '../domain';
import { editEntry } from '../entries';
import { addDays, byDate, money, qtyFmt, rateFmt, today, usDate } from '../format';
import { S, activeClients, client, project, render } from '../state';
import { FORMAT_HINTS, formatControls, pageHead, previewBox } from '../ui';

interface Builder {
  clientId: string;
  date: string;
  dueDate: string;
  /** Due date follows the invoice date until it's set by hand. */
  dueAuto: boolean;
  terms: string;
  notes: string;
  format: InvoiceFormat;
  sel: Record<EntryType, Set<string>>;
  overrides: Record<string, string>;
}

/** Builder state; survives re-renders while on the builder page. */
let B: Builder | null = null;
export const resetBuilder = () => {
  B = null;
};

function newBuilder(clientId: string, prev: Builder | null): Builder {
  const date = prev?.date || today();
  const b: Builder = {
    clientId,
    date,
    dueDate: prev?.dueAuto === false ? prev.dueDate : addDays(date, S.settings.dueDays),
    dueAuto: prev?.dueAuto ?? true,
    terms: prev?.terms ?? S.settings.defaultTerms ?? '',
    notes: prev?.notes ?? '',
    format: prev?.format || S.settings.defaultInvoiceFormat || 'summary',
    sel: { time: new Set(), items: new Set(), expenses: new Set() },
    overrides: {},
  };
  // Everything unbilled for the client starts selected.
  for (const t of ENTRY_TYPES) for (const e of S[t]) if (e.clientId === b.clientId && !e.invoiceId) b.sel[t].add(e.id);
  return b;
}

const unbilledFor = (type: EntryType, clientId: string): Entry[] =>
  S[type].filter((e) => e.clientId === clientId && !e.invoiceId).sort(byDate);

export function builderPage(query: URLSearchParams): HTMLElement {
  const qClient = query.get('client');
  if (!B || (qClient && qClient !== B.clientId)) B = newBuilder(qClient || B?.clientId || '', B);
  const b = B;

  const selected = <T extends Entry>(list: T[], type: EntryType) =>
    list.filter((e) => e.clientId === b.clientId && !e.invoiceId && b.sel[type].has(e.id)).sort(byDate);
  const builderLines = () => buildLines({ format: b.format, overrides: b.overrides,
    time: selected(S.time, 'time'), items: selected(S.items, 'items'), expenses: selected(S.expenses, 'expenses') }, S);

  const sections = {} as Record<EntryType, HTMLElement>;
  const linesCard = h('div', { class: 'card' });
  const frame = h('iframe', { title: 'Invoice preview' });
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

  const draft = () => ({
    clientId: b.clientId, date: b.date, dueDate: b.dueDate || null, terms: b.terms, notes: b.notes,
    format: b.format, overrides: b.overrides,
    sources: Object.fromEntries(ENTRY_TYPES.map((t) => [t, selected<Entry>(S[t], t).map((e) => e.id)])),
  });
  const schedulePreview = () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      if (!frame.isConnected || B !== b || !b.clientId) return;
      try {
        frame.srcdoc = await api<string>('POST', '/api/invoices/preview', draft());
      } catch (e) {
        toast(errorMessage(e), true);
      }
    }, 200);
  };

  const create = async (ev: UIEvent) => {
    const lines = builderLines();
    if (lines.some((l) => !l.description.trim()) && !confirm('Some lines have no description. Create anyway?')) return;
    ev.target.disabled = true;
    try {
      const inv = await api<Invoice>('POST', '/api/invoices', draft());
      B = null;
      toast(`Invoice #${inv.number} created`);
      location.hash = `#/invoices/${inv.id}`;
    } catch (e) {
      ev.target.disabled = false;
      toast(errorMessage(e), true);
    }
  };

  const renderLines = () => {
    const lines = builderLines();
    const total = lines.reduce((s, l) => s + l.amount, 0);
    linesCard.replaceChildren(
      h('div', { class: 'card-head' }, h('h2', { style: 'margin:0' }, 'Invoice lines'),
        formatControls(b, (change) => (Object.assign(b, change), renderLines()))),
      h('p', { class: 'muted small', style: 'margin:0 0 8px' }, `${FORMAT_HINTS[b.format]} Edit descriptions here; change hours and rates on the entries above.`),
      lines.some((l) => l.type !== 'heading')
        ? h('table', { class: 'data lines' },
            h('thead', null, h('tr', null, h('th', null, 'Description'), h('th', { class: 'num' }, 'Qty'), h('th', { class: 'num' }, 'Rate'), h('th', { class: 'num' }, 'Amount'))),
            h('tbody', null, lines.map((l) => {
              const input = h('textarea', { rows: Math.min(4, Math.max(1, Math.ceil(l.description.length / 60))),
                style: `min-height:0${l.type === 'heading' ? ';font-weight:600' : ''}`,
                oninput: (ev) => ((b.overrides[l.key] = ev.target.value), schedulePreview()) }, l.description);
              if (l.type === 'heading') return h('tr', null, h('td', { colspan: 4 }, input));
              return h('tr', null,
                h('td', null, l.date && h('div', { class: 'muted small' }, usDate(l.date)), input),
                h('td', { class: 'num' }, qtyFmt(l.qty)), h('td', { class: 'num' }, rateFmt(l.rate)), h('td', { class: 'num' }, money(l.amount)));
            })))
        : h('div', { class: 'empty' }, 'Select time, line items or expenses above.'),
      h('div', { class: 'total-line' }, h('span', null, 'Balance due'), h('span', null, `$${money(total)}`)),
      h('div', { class: 'actions', style: 'margin-top:14px;justify-content:flex-end' },
        h('button', { onclick: () => ((B = null), (location.hash = '#/invoices')) }, 'Discard'),
        h('button', { class: 'primary', disabled: !lines.some((l) => l.type !== 'heading'), onclick: create }, `Create invoice #${S.nextInvoiceNumber}`)));
    scrollTables(linesCard);
    schedulePreview();
  };

  const renderSection = (type: EntryType) => {
    const rows = unbilledFor(type, b.clientId);
    const sel = b.sel[type];
    const allOn = rows.length > 0 && rows.every((e) => sel.has(e.id));
    const someOn = rows.some((e) => sel.has(e.id));
    const toggle = (id: string, on: boolean) => (on ? sel.add(id) : sel.delete(id));
    const redraw = () => (renderSection(type), renderLines());
    const addOnTheFly = async () => {
      const saved = await editEntry(type, null, { clientId: b.clientId }, { lockClient: true });
      if (!saved) return;
      sel.add(saved.id);
      redraw();
    };
    const head = h('div', { class: 'card-head' },
      h('h2', { style: 'margin:0' }, TYPES[type].label),
      h('div', { class: 'actions' },
        h('button', { onclick: addOnTheFly }, TYPES[type].add)));
    const amountHead = type === 'expenses' ? [] : [h('th', { class: 'num' }, type === 'time' ? 'Hours' : 'Qty'), h('th', { class: 'num' }, 'Rate')];
    sections[type].replaceChildren(head, rows.length
      ? h('table', { class: 'data pick' },
          h('thead', null, h('tr', null,
            h('th', null, h('input', { type: 'checkbox', checked: allOn, indeterminate: someOn && !allOn,
              onchange: (ev) => (rows.forEach((e) => toggle(e.id, ev.target.checked)), redraw()) })),
            h('th', null, 'Date'), h('th', null, 'Description'), amountHead, h('th', { class: 'num' }, 'Amount'), h('th'))),
          h('tbody', null, rows.map((e) => h('tr', { class: sel.has(e.id) ? '' : 'off' },
            h('td', null, h('input', { type: 'checkbox', checked: sel.has(e.id), onchange: (ev) => (toggle(e.id, ev.target.checked), redraw()) })),
            h('td', { class: 'nowrap' }, usDate(e.date)),
            h('td', null, h('div', { class: 'desc' }, e.description), e.projectId && h('div', { class: 'muted small' }, project(e.projectId)?.name)),
            type !== 'expenses' && h('td', { class: 'num' }, qtyFmt(qtyOf(e))),
            type !== 'expenses' && h('td', { class: 'num' }, rateFmt(rateOf(e))),
            h('td', { class: 'num' }, money(entryAmount(e))),
            h('td', { class: 'right' }, h('button', { class: 'link', onclick: async () => (await editEntry(type, e, {}, { lockClient: true })) && redraw() }, 'Edit'))))))
      : h('div', { class: 'empty small' }, `No unbilled ${TYPES[type].label.toLowerCase()} for this client.`));
    scrollTables(sections[type]);
  };

  const setField = (k: 'date' | 'dueDate' | 'terms' | 'notes') => (ev: UIEvent) => {
    b[k] = ev.target.value;
    if (k === 'date' && b.dueAuto) {
      b.dueDate = addDays(b.date, S.settings.dueDays);
      dueInput.value = b.dueDate;
    }
    if (k === 'dueDate') b.dueAuto = false;
    schedulePreview();
  };
  const dueInput = h('input', { type: 'date', value: b.dueDate, onchange: setField('dueDate') });

  const details = h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', null, 'Client'),
        h('select', { onchange: (ev) => ((B = newBuilder(ev.target.value, b)), render()) },
          h('option', { value: '' }, 'Choose a client…'),
          activeClients(b.clientId).map((c) => h('option', { value: c.id, selected: c.id === b.clientId }, c.name)))),
      h('label', { class: 'field' }, h('span', null, 'Invoice #'), h('input', { value: S.nextInvoiceNumber, disabled: true }))),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', null, 'Date'), h('input', { type: 'date', value: b.date, onchange: setField('date') })),
      h('label', { class: 'field' }, h('span', null, 'Due date'), dueInput),
      h('label', { class: 'field' }, h('span', null, 'Terms'), h('input', { value: b.terms, oninput: setField('terms') }))),
    h('label', { class: 'field', style: 'margin:0' }, h('span', null, 'Notes (optional, printed at the bottom)'),
      h('textarea', { rows: 2, style: 'min-height:0', oninput: setField('notes') }, b.notes)));

  if (!b.clientId) return h('div', null, pageHead('New invoice'), details);

  for (const t of ENTRY_TYPES) {
    sections[t] = h('div', { class: 'card' });
    renderSection(t);
  }
  renderLines();

  return h('div', null,
    pageHead(`New invoice · ${client(b.clientId)?.name}`),
    h('div', { class: 'builder' },
      h('div', null, details, sections.time, sections.items, sections.expenses, linesCard),
      h('div', { class: 'preview-wrap' }, previewBox(frame))));
}
