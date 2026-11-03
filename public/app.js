'use strict';

// Desktop app (Electron): leave room for the Mac window buttons and make the top edge draggable.
if (navigator.userAgent.includes('Electron')) document.documentElement.classList.add('desktop');

// ---------- tiny DOM + API helpers ----------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (['value', 'checked', 'disabled', 'selected', 'indeterminate', 'srcdoc'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

// Reapply after builder sections update as well as after full-page renders.
function scrollTables(root) {
  root.querySelectorAll('table.data').forEach((table) => {
    if (table.parentElement.classList.contains('table-scroll')) return;
    const wrap = h('div', { class: 'table-scroll', tabindex: 0, role: 'region', 'aria-label': 'Scrollable data table' });
    table.replaceWith(wrap);
    wrap.append(table);
  });
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CWInvoicer': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get('Content-Type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.error || data || res.statusText);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const formError = document.querySelector('dialog[open] .form-error');
  if (isError && formError) {
    formError.textContent = msg;
    formError.hidden = false;
    return;
  }
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = isError ? 'error' : '';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isError ? 6000 : 2500);
}

// ---------- formatting + domain helpers ----------

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const usDate = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : '');
const today = () => new Date().toLocaleDateString('en-CA');
function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toLocaleDateString('en-CA');
}
const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || '');

/** Accepts "1.5", "1:30", "90m", "2h". Returns hours as a number, or NaN. */
function parseHours(s) {
  s = String(s ?? '').trim().toLowerCase();
  if (!s) return NaN;
  let m;
  if ((m = /^(\d+):(\d{1,2})$/.exec(s))) return round2(Number(m[1]) + Number(m[2]) / 60);
  if ((m = /^(\d+(?:\.\d+)?)\s*m(in)?$/.exec(s))) return round2(Number(m[1]) / 60);
  if ((m = /^(\d*(?:\.\d+)?)\s*h?$/.exec(s)) && m[1]) return Number(m[1]);
  return NaN;
}

let S = null; // full app state from the server

const client = (id) => S.clients.find((c) => c.id === id);
const project = (id) => S.projects.find((p) => p.id === id);
const invoice = (id) => S.invoices.find((i) => i.id === id);
const activeClients = (keepId) => S.clients.filter((c) => !c.archived || c.id === keepId).sort((a, b) => a.name.localeCompare(b.name));
const clientProjects = (clientId, keepId) =>
  S.projects.filter((p) => p.clientId === clientId && (!p.archived || p.id === keepId)).sort((a, b) => a.name.localeCompare(b.name));

function defaultRate({ clientId, projectId }) {
  return project(projectId)?.rate ?? client(clientId)?.rate ?? S.settings.defaultRate;
}
const timeRate = (e) => InvoiceLines.timeRate(e, S);
function entryAmount(type, e) {
  if (type === 'time') return round2(e.hours * timeRate(e));
  if (type === 'items') return round2(e.qty * e.rate);
  return round2(e.amount);
}
function invoiceStatus(inv) {
  if (inv.status === 'paid') return 'paid';
  if (inv.dueDate && inv.dueDate < today()) return 'overdue';
  return 'unpaid';
}
const statusBadge = (inv) => {
  const s = invoiceStatus(inv);
  return h('span', { class: `badge ${s}` }, s === 'paid' ? `Paid ${usDate(inv.paidDate)}` : s === 'overdue' ? 'Overdue' : 'Unpaid');
};

const TYPES = {
  time: { label: 'Time', one: 'time entry', add: '+ Log time' },
  items: { label: 'Line Items', one: 'line item', add: '+ Line item' },
  expenses: { label: 'Expenses', one: 'expense', add: '+ Expense' },
};

// ---------- modal form ----------

/**
 * fields: array of field specs or arrays of specs (rendered side by side).
 * spec: { name, label, type: text|textarea|number|date|select|hours|checkbox, options(vals), required,
 *         placeholder (string | fn(vals)), help, disabled, step }
 */
function formModal({ title, fields, values = {}, submitLabel = 'Save', onSubmit }) {
  const vals = { ...values };
  const controls = [];

  const read = () => {
    for (const { spec, el } of controls) {
      if (spec.type === 'checkbox') vals[spec.name] = el.checked;
      else if (spec.type === 'hours') vals[spec.name] = el.value.trim() === '' ? null : parseHours(el.value);
      else vals[spec.name] = el.value;
    }
  };
  const refreshDynamic = () => {
    for (const { spec, el } of controls) {
      if (spec.type === 'select' && typeof spec.options === 'function') {
        const current = vals[spec.name] ?? '';
        el.replaceChildren(...spec.options(vals).map(([v, l]) => h('option', { value: v }, l)));
        el.value = [...el.options].some((o) => o.value === current) ? current : el.options[0]?.value ?? '';
      }
      if (typeof spec.placeholder === 'function') el.placeholder = spec.placeholder(vals);
    }
    read();
  };

  const fieldEl = (spec) => {
    let el;
    const v = vals[spec.name];
    if (spec.type === 'textarea') el = h('textarea', { rows: spec.rows || 3 }, v ?? '');
    else if (spec.type === 'select') el = h('select');
    else if (spec.type === 'checkbox') el = h('input', { type: 'checkbox', checked: !!v });
    else
      el = h('input', {
        type: spec.type === 'hours' ? 'text' : spec.type || 'text',
        value: v ?? '',
        step: spec.type === 'number' ? spec.step || 'any' : null,
        inputmode: spec.type === 'hours' ? 'decimal' : null,
      });
    if (spec.required) el.required = true;
    if (spec.disabled) el.disabled = true;
    if (typeof spec.placeholder === 'string') el.placeholder = spec.placeholder;
    controls.push({ spec, el });
    if (spec.type === 'checkbox') return h('label', { class: 'field' }, el, ' ', spec.label);
    return h('label', { class: 'field' }, h('span', null, spec.label), el, spec.help && h('div', { class: 'help' }, spec.help));
  };

  return new Promise((resolve) => {
    let saving = false;
    const close = (result) => {
      if (saving) return;
      backdrop.close();
      backdrop.remove();
      resolve(result);
    };
    const form = h(
      'form',
      {
        class: 'modal',
        onchange: () => (read(), refreshDynamic()),
        oninput: () => (read(), refreshDynamic()),
        onsubmit: async (ev) => {
          ev.preventDefault();
          if (saving) return;
          form.querySelector('.form-error').hidden = true;
          read();
          const bad = controls.find(({ spec }) => spec.type === 'hours' && Number.isNaN(vals[spec.name]));
          if (bad) return toast(`${bad.spec.label}: enter hours like 1.5, 1:30 or 90m`, true);
          const submit = form.querySelector('[type=submit]');
          saving = true;
          submit.disabled = true;
          submit.textContent = 'Saving…';
          try {
            const result = await onSubmit(vals);
            saving = false;
            close(result);
          } catch (e) {
            toast(e.message, true);
          } finally {
            saving = false;
            submit.disabled = false;
            submit.textContent = submitLabel;
          }
        },
      },
      h('h2', { id: 'modal-title' }, title),
      h('p', { class: 'form-error', role: 'alert', hidden: true }),
      fields.map((f) => (Array.isArray(f) ? h('div', { class: 'row' }, f.map(fieldEl)) : fieldEl(f))),
      h('div', { class: 'foot' }, h('button', { type: 'button', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'primary', type: 'submit' }, submitLabel))
    );
    const backdrop = h('dialog', { class: 'dialog-shell', 'aria-labelledby': 'modal-title',
      oncancel: (e) => { e.preventDefault(); close(null); },
      onclick: (e) => e.target === backdrop && close(null) }, form);
    document.body.append(backdrop);
    backdrop.showModal();
    refreshDynamic();
    form.querySelector('input:not([type=checkbox]):not(:disabled), textarea, select:not(:disabled)')?.focus();
  });
}

// ---------- entry forms ----------

function clientField(lockClient) {
  return {
    name: 'clientId', label: 'Client', type: 'select', required: true, disabled: lockClient,
    options: (v) => [['', 'Choose a client…'], ...activeClients(v.clientId).map((c) => [c.id, c.name])],
  };
}
const projectField = {
  name: 'projectId', label: 'Project', type: 'select',
  options: (v) => [['', '— No project —'], ...clientProjects(v.clientId, v.projectId).map((p) => [p.id, p.name])],
};

function entryFields(type, lockClient) {
  const common = [[clientField(lockClient), projectField]];
  if (type === 'time')
    return [
      ...common,
      [{ name: 'date', label: 'Date', type: 'date', required: true },
       { name: 'hours', label: 'Hours', type: 'hours', required: true, placeholder: '1.5, 1:30 or 90m' }],
      { name: 'description', label: 'Task / description', type: 'textarea', required: true, rows: 2 },
      { name: 'rate', label: 'Hourly rate override', type: 'number',
        placeholder: (v) => `Default: $${money(defaultRate(v))}/hr`, help: 'Leave blank to use the project or client rate.' },
    ];
  if (type === 'items')
    return [
      ...common,
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'description', label: 'Description', type: 'textarea', required: true, rows: 2 },
      [{ name: 'qty', label: 'Quantity', type: 'number', required: true },
       { name: 'rate', label: 'Rate', type: 'number', required: true }],
    ];
  return [
    ...common,
    [{ name: 'date', label: 'Date', type: 'date', required: true },
     { name: 'amount', label: 'Amount', type: 'number', required: true }],
    { name: 'description', label: 'Description', type: 'textarea', required: true, rows: 2 },
  ];
}

const entryPayload = (type, v) => {
  const base = { clientId: v.clientId, projectId: v.projectId || null, date: v.date, description: v.description };
  if (type === 'time') return { ...base, hours: v.hours, rate: v.rate === '' ? null : v.rate };
  if (type === 'items') return { ...base, qty: v.qty, rate: v.rate };
  return { ...base, amount: v.amount };
};

/** Opens the add/edit form for an entry. Resolves to the saved record, or null if cancelled. */
async function editEntry(type, existing, preset = {}, { lockClient = false } = {}) {
  const isEdit = existing && existing.id;
  const values = isEdit
    ? { ...existing, hours: existing.hours, rate: existing.rate ?? '' }
    : { date: today(), qty: 1, ...preset, rate: preset.rate ?? '' };
  return formModal({
    title: `${isEdit ? 'Edit' : 'Add'} ${TYPES[type].one}`,
    fields: entryFields(type, lockClient),
    values,
    submitLabel: isEdit ? 'Save' : 'Add',
    onSubmit: async (v) => {
      if (lockClient) v.clientId = values.clientId;
      const saved = isEdit
        ? await api('PUT', `/api/${type}/${existing.id}`, entryPayload(type, v))
        : await api('POST', `/api/${type}`, entryPayload(type, v));
      await refresh();
      return saved;
    },
  });
}

async function deleteEntry(type, e) {
  if (!confirm(`Delete this ${TYPES[type].one}?\n\n${e.description}`)) return;
  try {
    await api('DELETE', `/api/${type}/${e.id}`);
    toast('Deleted');
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- pages ----------

function pageHead(title, ...actions) {
  return h('div', { class: 'page-head' }, h('h1', null, title), h('div', { class: 'actions' }, actions));
}

function unbilledByClient() {
  const out = new Map();
  for (const type of Object.keys(TYPES)) {
    for (const e of S[type]) {
      if (e.invoiceId) continue;
      const row = out.get(e.clientId) || { hours: 0, time: 0, items: 0, expenses: 0, count: 0 };
      if (type === 'time') row.hours += e.hours;
      row[type] += entryAmount(type, e);
      row.count++;
      out.set(e.clientId, row);
    }
  }
  return out;
}

function dashboard() {
  const unbilled = unbilledByClient();
  const totalUnbilled = [...unbilled.values()].reduce((s, r) => s + r.time + r.items + r.expenses, 0);
  const totalHours = [...unbilled.values()].reduce((s, r) => s + r.hours, 0);
  const outstanding = S.invoices.filter((i) => i.status !== 'paid');
  const outstandingTotal = outstanding.reduce((s, i) => s + i.total, 0);
  const quickAdd = (type) => async () => (await editEntry(type)) && (toast('Saved'), render());

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

const filters = { client: '', project: '', status: 'unbilled' };

function entriesPage(type) {
  const rows = S[type]
    .filter((e) => (!filters.client || e.clientId === filters.client)
      && (!filters.project || e.projectId === filters.project)
      && (filters.status === 'all' || (filters.status === 'unbilled' ? !e.invoiceId : e.invoiceId)))
    .sort((a, b) => byDate(b, a));
  const showQty = type !== 'expenses';
  const total = rows.reduce((s, e) => s + entryAmount(type, e), 0);
  const hours = type === 'time' ? rows.reduce((s, e) => s + e.hours, 0) : 0;
  const setFilter = (k) => (ev) => {
    filters[k] = ev.target.value;
    if (k === 'client') filters.project = '';
    render();
  };

  return h('div', null,
    pageHead(TYPES[type].label,
      h('button', { class: 'primary', onclick: async () => (await editEntry(type, null, { clientId: filters.client, projectId: filters.project })) && (toast('Saved'), render()) }, TYPES[type].add)),
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
            const inv = e.invoiceId && invoice(e.invoiceId);
            return h('tr', { class: inv ? 'off' : '' },
              h('td', { class: 'nowrap' }, usDate(e.date)),
              h('td', null, client(e.clientId)?.name, e.projectId && h('div', { class: 'muted small' }, project(e.projectId)?.name)),
              h('td', { class: 'desc' }, e.description),
              showQty && h('td', { class: 'num' }, qtyFmt(type === 'time' ? e.hours : e.qty)),
              showQty && h('td', { class: 'num' }, money(type === 'time' ? timeRate(e) : e.rate), type === 'time' && e.rate != null && h('div', { class: 'muted small' }, 'override')),
              h('td', { class: 'num' }, money(entryAmount(type, e))),
              h('td', null, inv ? h('a', { href: `#/invoices/${inv.id}` }, `#${inv.number}`) : h('span', { class: 'badge unbilled' }, 'Unbilled')),
              h('td', { class: 'nowrap right' },
                !inv && h('button', { class: 'link', onclick: async () => (await editEntry(type, e)) && render() }, 'Edit'),
                h('button', { class: 'link', title: 'Make a copy dated today', onclick: async () => (await editEntry(type, null, { ...e, id: undefined, invoiceId: undefined, date: today() })) && render() }, 'Copy'),
                !inv && h('button', { class: 'link danger', onclick: () => deleteEntry(type, e) }, 'Delete')));
          })),
          h('tfoot', null, h('tr', null, h('td', { colspan: 3 }, `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`),
            showQty && h('td', { class: 'num' }, type === 'time' ? qtyFmt(hours) : ''), showQty && h('td'),
            h('td', { class: 'num' }, money(total)), h('td'), h('td'))))
      : h('div', { class: 'empty' }, `No ${filters.status === 'all' ? '' : filters.status + ' '}${TYPES[type].label.toLowerCase()} here.`)));
}

function invoiceTable(list) {
  if (!list.length) return h('div', { class: 'card empty' }, 'No invoices yet.');
  return h('div', { class: 'card' }, h('table', { class: 'data' },
    h('thead', null, h('tr', null, h('th', null, 'Invoice #'), h('th', null, 'Client'), h('th', null, 'Date'), h('th', null, 'Due'),
      h('th', { class: 'num' }, 'Total'), h('th', null, 'Status'))),
    h('tbody', null, list.map((inv) => h('tr', { class: 'clickable', onclick: () => (location.hash = `#/invoices/${inv.id}`) },
      h('td', null, h('a', { href: `#/invoices/${inv.id}`, 'aria-label': `Open invoice ${inv.number}` }, h('strong', null, inv.number))), h('td', null, inv.billTo?.name), h('td', null, usDate(inv.date)), h('td', null, usDate(inv.dueDate)),
      h('td', { class: 'num' }, `$${money(inv.total)}`), h('td', null, statusBadge(inv)))))));
}

const invoiceFilters = { status: 'all', client: '' };
function invoicesPage() {
  const list = S.invoices
    .filter((i) => (invoiceFilters.status === 'all' || invoiceStatus(i) === invoiceFilters.status || (invoiceFilters.status === 'unpaid' && i.status !== 'paid'))
      && (!invoiceFilters.client || i.clientId === invoiceFilters.client))
    .sort((a, b) => b.number - a.number);
  const set = (k) => (ev) => ((invoiceFilters[k] = ev.target.value), render());
  return h('div', null,
    pageHead('Invoices', h('a', { class: 'btn primary', href: '#/invoices/new' }, '+ New invoice')),
    h('div', { class: 'filters' },
      h('select', { 'aria-label': 'Filter by client', onchange: set('client') }, h('option', { value: '' }, 'All clients'),
        activeClients(invoiceFilters.client).map((c) => h('option', { value: c.id, selected: c.id === invoiceFilters.client }, c.name))),
      h('select', { 'aria-label': 'Filter by status', onchange: set('status') },
        [['all', 'All'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid']].map(([v, l]) => h('option', { value: v, selected: v === invoiceFilters.status }, l))),
      h('span', { class: 'muted', style: 'align-self:center' }, `${list.length} invoices · $${money(list.reduce((s, i) => s + i.total, 0))}`)),
    invoiceTable(list));
}

// ---------- preview iframe (scaled to fit its box) ----------

const PAGE_W = 864; // 8.5in @96dpi + screen padding
const PAGE_H = 1104;
function previewBox(frame) {
  const box = h('div', { class: 'preview-box' }, frame);
  frame.style.width = `${PAGE_W}px`;
  frame.style.height = `${PAGE_H}px`;
  const fit = () => {
    const scale = Math.min(1, box.clientWidth / PAGE_W) || 1;
    frame.style.transform = `scale(${scale})`;
    box.style.height = `${PAGE_H * scale}px`;
  };
  new ResizeObserver(fit).observe(box);
  return box;
}

const FORMAT_HINTS = {
  summary: 'One line per project. Time is totaled by project and rate.',
  detailed: 'Every time entry, line item and expense with its date and description, grouped by project.',
};
function formatControls({ format }, onChange) {
  return h('div', { class: 'seg', title: FORMAT_HINTS[format] },
    [['summary', 'Summary'], ['detailed', 'Detailed']].map(([v, l]) =>
      h('button', { type: 'button', class: format === v ? 'on' : '', onclick: () => format !== v && onChange({ format: v }) }, l)));
}

function invoiceView(id) {
  const inv = invoice(id);
  if (!inv) return h('div', { class: 'card empty' }, 'Invoice not found. ', h('a', { href: '#/invoices' }, 'Back to invoices'));
  const isLatest = inv.number === Math.max(...S.invoices.map((i) => i.number));
  const pdfUrl = (dl) => `/api/invoices/${inv.id}/pdf?fresh=1${dl ? '&download=1' : ''}`;

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
    const values = { date: inv.date, dueDate: inv.dueDate || '', terms: inv.terms || '', notes: inv.notes || '',
      billToName: inv.billTo?.name || '', billToAddress: inv.billTo?.address || '', paidDate: inv.paidDate || '' };
    inv.lines.forEach((l) => (values[`line:${l.key}`] = l.description));
    const saved = await formModal({
      title: `Edit invoice #${inv.number}`,
      values,
      fields: [
        [{ name: 'date', label: 'Invoice date', type: 'date', required: true }, { name: 'dueDate', label: 'Due date', type: 'date' }],
        [{ name: 'terms', label: 'Terms' }, inv.status === 'paid' ? { name: 'paidDate', label: 'Paid on', type: 'date' } : null].filter(Boolean),
        { name: 'billToName', label: 'Bill to', required: true },
        { name: 'billToAddress', label: 'Bill-to address', type: 'textarea', rows: 2 },
        ...inv.lines.map((l) => ({ name: `line:${l.key}`, type: 'textarea', rows: l.type === 'heading' ? 1 : 2,
          label: l.type === 'heading' ? 'Project heading' : `${l.date ? `${usDate(l.date)} · ` : ''}${qtyFmt(l.qty)} × ${money(l.rate)}` })),
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
  const reveal = () => api('POST', `/api/invoices/${inv.id}/reveal`).catch((e) => toast(e.message, true));
  const reformat = (change) => act(() => api('PUT', `/api/invoices/${inv.id}`, change));

  const frame = h('iframe', { src: `/invoice/${inv.id}?v=${Date.now()}`, title: 'Invoice preview' });
  const sourceRows = Object.keys(TYPES).flatMap((t) => S[t].filter((e) => e.invoiceId === inv.id).map((e) => ({ t, e }))).sort((a, b) => byDate(a.e, b.e));

  return h('div', { class: 'invoice-view' },
    pageHead(`Invoice #${inv.number}`,
      statusBadge(inv),
      S.pdfAvailable && h('a', { class: 'btn primary', href: pdfUrl(false), target: '_blank' }, 'Open PDF'),
      S.pdfAvailable && h('a', { class: 'btn', href: pdfUrl(true) }, 'Download PDF'),
      S.pdfAvailable && h('button', { onclick: reveal }, 'Show in Finder'),
      h('a', { class: 'btn', href: `/invoice/${inv.id}?print`, target: '_blank' }, 'Print'),
      h('button', { onclick: togglePaid }, inv.status === 'paid' ? 'Mark unpaid' : 'Mark paid'),
      h('button', { onclick: edit }, 'Edit'),
      h('button', { class: 'danger', onclick: remove }, 'Delete')),
    h('div', { class: 'page-head', style: 'margin-bottom:12px;max-width:900px' },
      h('span', { class: 'muted' }, `${inv.billTo?.name} · $${money(inv.total)} · created ${new Date(inv.createdAt).toLocaleString()}`),
      formatControls({ format: inv.format || 'summary' }, reformat)),
    previewBox(frame),
    sourceRows.length > 0 && h('div', { class: 'card', style: 'margin-top:16px;max-width:900px' },
      h('h2', null, 'Billed on this invoice'),
      h('table', { class: 'data' }, h('tbody', null, sourceRows.map(({ t, e }) => h('tr', null,
        h('td', { class: 'nowrap' }, usDate(e.date)), h('td', null, TYPES[t].one), h('td', { class: 'desc' }, e.description),
        h('td', { class: 'num' }, t === 'time' ? `${qtyFmt(e.hours)} h` : ''), h('td', { class: 'num' }, money(entryAmount(t, e)))))))));
}

// ---------- invoice builder ----------

let B = null; // builder state, survives re-renders while on the builder page

function newBuilder(clientId, prev) {
  const date = prev?.date || today();
  const b = {
    clientId: clientId || '',
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
  for (const t of Object.keys(TYPES)) for (const e of S[t]) if (e.clientId === b.clientId && !e.invoiceId) b.sel[t].add(e.id);
  return b;
}

const unbilledFor = (type, clientId) => S[type].filter((e) => e.clientId === clientId && !e.invoiceId).sort(byDate);

const selectedFor = (type) => unbilledFor(type, B.clientId).filter((e) => B.sel[type].has(e.id));
const builderLines = () =>
  InvoiceLines.buildLines({ format: B.format, overrides: B.overrides,
    time: selectedFor('time'), items: selectedFor('items'), expenses: selectedFor('expenses') }, S);

function builderPage(query) {
  const qClient = query.get('client');
  if (!B || (qClient && qClient !== B.clientId)) B = newBuilder(qClient || B?.clientId, B);

  const sections = {};
  const linesCard = h('div', { class: 'card' });
  const frame = h('iframe', { title: 'Invoice preview' });
  let previewTimer;

  const draft = () => ({
    clientId: B.clientId, date: B.date, dueDate: B.dueDate || null, terms: B.terms, notes: B.notes,
    format: B.format, overrides: B.overrides,
    sources: Object.fromEntries(Object.keys(TYPES).map((t) => [t, selectedFor(t).map((e) => e.id)])),
  });
  const schedulePreview = () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      if (!frame.isConnected || !B?.clientId) return;
      try {
        frame.srcdoc = await api('POST', '/api/invoices/preview', draft());
      } catch (e) {
        toast(e.message, true);
      }
    }, 200);
  };

  const renderLines = () => {
    const lines = builderLines();
    const total = lines.reduce((s, l) => s + l.amount, 0);
    linesCard.replaceChildren(
      h('div', { class: 'card-head' }, h('h2', { style: 'margin:0' }, 'Invoice lines'),
        formatControls(B, (change) => (Object.assign(B, change), renderLines()))),
      h('p', { class: 'muted small', style: 'margin:0 0 8px' }, `${FORMAT_HINTS[B.format]} Edit descriptions here; change hours and rates on the entries above.`),
      lines.some((l) => l.type !== 'heading')
        ? h('table', { class: 'data lines' },
            h('thead', null, h('tr', null, h('th', null, 'Description'), h('th', { class: 'num' }, 'Qty'), h('th', { class: 'num' }, 'Rate'), h('th', { class: 'num' }, 'Amount'))),
            h('tbody', null, lines.map((l) => {
              const input = h('textarea', { rows: Math.min(4, Math.max(1, Math.ceil(l.description.length / 60))),
                style: `min-height:0${l.type === 'heading' ? ';font-weight:600' : ''}`,
                oninput: (ev) => ((B.overrides[l.key] = ev.target.value), schedulePreview()) }, l.description);
              if (l.type === 'heading') return h('tr', null, h('td', { colspan: 4 }, input));
              return h('tr', null,
                h('td', null, l.date && h('div', { class: 'muted small' }, usDate(l.date)), input),
                h('td', { class: 'num' }, qtyFmt(l.qty)), h('td', { class: 'num' }, money(l.rate)), h('td', { class: 'num' }, money(l.amount)));
            })))
        : h('div', { class: 'empty' }, 'Select time, line items or expenses above.'),
      h('div', { class: 'total-line' }, h('span', null, 'Balance due'), h('span', null, `$${money(total)}`)),
      h('div', { class: 'actions', style: 'margin-top:14px;justify-content:flex-end' },
        h('button', { onclick: () => ((B = null), (location.hash = '#/invoices')) }, 'Discard'),
        h('button', { class: 'primary', disabled: !lines.some((l) => l.type !== 'heading'), onclick: create }, `Create invoice #${S.nextInvoiceNumber}`)));
    scrollTables(linesCard);
    schedulePreview();
  };

  const create = async (ev) => {
    const lines = builderLines();
    if (lines.some((l) => !l.description.trim()) && !confirm('Some lines have no description. Create anyway?')) return;
    ev.target.disabled = true;
    try {
      const inv = await api('POST', '/api/invoices', draft());
      B = null;
      toast(`Invoice #${inv.number} created`);
      location.hash = `#/invoices/${inv.id}`;
    } catch (e) {
      ev.target.disabled = false;
      toast(e.message, true);
    }
  };

  const renderSection = (type) => {
    const rows = unbilledFor(type, B.clientId);
    const sel = B.sel[type];
    const allOn = rows.length > 0 && rows.every((e) => sel.has(e.id));
    const someOn = rows.some((e) => sel.has(e.id));
    const toggle = (id, on) => (on ? sel.add(id) : sel.delete(id));
    const addOnTheFly = async () => {
      const saved = await editEntry(type, null, { clientId: B.clientId }, { lockClient: true });
      if (!saved) return;
      sel.add(saved.id);
      renderSection(type);
      renderLines();
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
              onchange: (ev) => (rows.forEach((e) => toggle(e.id, ev.target.checked)), renderSection(type), renderLines()) })),
            h('th', null, 'Date'), h('th', null, 'Description'), amountHead, h('th', { class: 'num' }, 'Amount'), h('th'))),
          h('tbody', null, rows.map((e) => h('tr', { class: sel.has(e.id) ? '' : 'off' },
            h('td', null, h('input', { type: 'checkbox', checked: sel.has(e.id), onchange: (ev) => (toggle(e.id, ev.target.checked), renderSection(type), renderLines()) })),
            h('td', { class: 'nowrap' }, usDate(e.date)),
            h('td', null, h('div', { class: 'desc' }, e.description), e.projectId && h('div', { class: 'muted small' }, project(e.projectId)?.name)),
            type !== 'expenses' && h('td', { class: 'num' }, qtyFmt(type === 'time' ? e.hours : e.qty)),
            type !== 'expenses' && h('td', { class: 'num' }, money(type === 'time' ? timeRate(e) : e.rate)),
            h('td', { class: 'num' }, money(entryAmount(type, e))),
            h('td', { class: 'right' }, h('button', { class: 'link', onclick: async () => (await editEntry(type, e, {}, { lockClient: true })) && (renderSection(type), renderLines()) }, 'Edit'))))))
      : h('div', { class: 'empty small' }, `No unbilled ${TYPES[type].label.toLowerCase()} for this client.`));
    scrollTables(sections[type]);
  };

  const setField = (k, rerender) => (ev) => {
    B[k] = ev.target.value;
    if (k === 'date' && B.dueAuto) {
      B.dueDate = addDays(B.date, S.settings.dueDays);
      dueInput.value = B.dueDate;
    }
    if (k === 'dueDate') B.dueAuto = false;
    if (rerender) render();
    else schedulePreview();
  };
  const dueInput = h('input', { type: 'date', value: B.dueDate, onchange: setField('dueDate') });

  const details = h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', null, 'Client'),
        h('select', { onchange: (ev) => ((B = newBuilder(ev.target.value, B)), render()) },
          h('option', { value: '' }, 'Choose a client…'),
          activeClients(B.clientId).map((c) => h('option', { value: c.id, selected: c.id === B.clientId }, c.name)))),
      h('label', { class: 'field' }, h('span', null, 'Invoice #'), h('input', { value: S.nextInvoiceNumber, disabled: true }))),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', null, 'Date'), h('input', { type: 'date', value: B.date, onchange: setField('date') })),
      h('label', { class: 'field' }, h('span', null, 'Due date'), dueInput),
      h('label', { class: 'field' }, h('span', null, 'Terms'), h('input', { value: B.terms, oninput: setField('terms') }))),
    h('label', { class: 'field', style: 'margin:0' }, h('span', null, 'Notes (optional, printed at the bottom)'),
      h('textarea', { rows: 2, style: 'min-height:0', oninput: setField('notes') }, B.notes)));

  if (!B.clientId) return h('div', null, pageHead('New invoice'), details);

  for (const t of Object.keys(TYPES)) {
    sections[t] = h('div', { class: 'card' });
    renderSection(t);
  }
  renderLines();

  return h('div', null,
    pageHead(`New invoice · ${client(B.clientId)?.name}`),
    h('div', { class: 'builder' },
      h('div', null, details, sections.time, sections.items, sections.expenses, linesCard),
      h('div', { class: 'preview-wrap' }, previewBox(frame))));
}

// ---------- clients & projects ----------

let showArchived = false;

const clientFields = [
  { name: 'name', label: 'Client name (as shown on invoices)', required: true },
  { name: 'address', label: 'Billing address (optional, shown under Bill To)', type: 'textarea', rows: 3 },
  [{ name: 'email', label: 'Email', type: 'email' },
   { name: 'rate', label: 'Hourly rate', type: 'number', placeholder: () => `Default: $${money(S.settings.defaultRate)}` }],
  { name: 'notes', label: 'Notes (private)', type: 'textarea', rows: 2 },
];
const projectFields = [
  { name: 'name', label: 'Project name', required: true },
  { name: 'rate', label: 'Hourly rate override', type: 'number', help: 'Leave blank to use the client rate.',
    placeholder: (v) => `Default: $${money(client(v.clientId)?.rate ?? S.settings.defaultRate)}` },
];

async function saveRecord(kind, existing, values) {
  const payload = { ...values };
  if ('rate' in payload && payload.rate === '') payload.rate = null;
  return existing?.id ? api('PUT', `/api/${kind}/${existing.id}`, payload) : api('POST', `/api/${kind}`, payload);
}

async function editClient(c) {
  const saved = await formModal({ title: c ? 'Edit client' : 'Add client', fields: clientFields, values: c || {},
    onSubmit: (v) => saveRecord('clients', c, { name: v.name, address: v.address, email: v.email, rate: v.rate, notes: v.notes }) });
  if (saved) render();
}
async function editProject(p, clientId) {
  const saved = await formModal({ title: p ? 'Edit project' : `Add project for ${client(clientId).name}`, fields: projectFields,
    values: p || { clientId }, onSubmit: (v) => saveRecord('projects', p, { clientId, name: v.name, rate: v.rate }) });
  if (saved) render();
}
async function act(fn, ok) {
  try {
    await fn();
    if (ok) toast(ok);
    render();
  } catch (e) {
    toast(e.message, true);
  }
}

function clientsPage() {
  const list = S.clients.filter((c) => showArchived || !c.archived).sort((a, b) => a.name.localeCompare(b.name));
  const unbilled = unbilledByClient();
  return h('div', null,
    pageHead('Clients & Projects',
      h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: showArchived, onchange: (e) => ((showArchived = e.target.checked), render()) }), ' Show archived'),
      h('button', { class: 'primary', onclick: () => editClient(null) }, '+ Add client')),
    list.length ? list.map((c) => {
      const projects = S.projects.filter((p) => p.clientId === c.id && (showArchived || !p.archived)).sort((a, b) => a.name.localeCompare(b.name));
      const u = unbilled.get(c.id);
      return h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', null, h('strong', { style: 'font-size:16px' }, c.name), c.archived && h('span', { class: 'badge', style: 'margin-left:8px' }, 'Archived'),
            h('div', { class: 'muted small' }, [`$${money(c.rate ?? S.settings.defaultRate)}/hr${c.rate == null ? ' (default)' : ''}`, c.email,
              u && `$${money(u.time + u.items + u.expenses)} unbilled`].filter(Boolean).join(' · ')),
            c.address && h('div', { class: 'muted small desc' }, c.address)),
          h('div', { class: 'actions' },
            u && h('a', { class: 'btn', href: `#/invoices/new?client=${c.id}` }, 'Invoice'),
            h('button', { onclick: () => editProject(null, c.id) }, '+ Project'),
            h('button', { onclick: () => editClient(c) }, 'Edit'),
            h('button', { onclick: () => act(() => api('PUT', `/api/clients/${c.id}`, { archived: !c.archived })) }, c.archived ? 'Unarchive' : 'Archive'),
            h('button', { class: 'danger', onclick: () => confirm(`Delete ${c.name}?`) && act(() => api('DELETE', `/api/clients/${c.id}`), 'Client deleted') }, 'Delete'))),
        projects.length > 0 && h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, 'Project'), h('th', { class: 'num' }, 'Rate'), h('th'))),
          h('tbody', null, projects.map((p) => h('tr', { class: p.archived ? 'off' : '' },
            h('td', null, p.name, p.archived && ' (archived)'),
            h('td', { class: 'num' }, p.rate != null ? `$${money(p.rate)}/hr` : h('span', { class: 'muted' }, 'client rate')),
            h('td', { class: 'right nowrap' },
              h('button', { class: 'link', onclick: () => editProject(p, c.id) }, 'Edit'),
              h('button', { class: 'link', onclick: () => act(() => api('PUT', `/api/projects/${p.id}`, { archived: !p.archived })) }, p.archived ? 'Unarchive' : 'Archive'),
              h('button', { class: 'link danger', onclick: () => confirm(`Delete project ${p.name}?`) && act(() => api('DELETE', `/api/projects/${p.id}`), 'Project deleted') }, 'Delete')))))));
    }) : h('div', { class: 'card empty' }, 'No clients yet.'));
}

// ---------- settings ----------

function settingsPage() {
  const s = S.settings;
  const input = (name, props = {}) => h('input', { name, value: s[name] ?? '', ...props });
  const form = h('form', {
    class: 'card', style: 'max-width:640px',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      await act(() => api('PUT', '/api/settings', data), 'Settings saved');
    },
  },
    h('h2', null, 'Business details (top of every invoice)'),
    h('label', { class: 'field' }, h('span', null, 'Business name'), input('businessName', { required: true })),
    h('label', { class: 'field' }, h('span', null, 'Address & contact lines'), h('textarea', { name: 'businessDetails', rows: 5 }, s.businessDetails || '')),
    h('h2', { style: 'margin-top:20px' }, 'Invoicing'),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', null, 'Starting invoice number'), input('startingInvoiceNumber', { type: 'number', min: 1, step: 1, required: true }),
        h('div', { class: 'help' }, `Next invoice: #${S.nextInvoiceNumber}. Numbers always continue after your highest existing invoice.`)),
      h('label', { class: 'field' }, h('span', null, 'Default hourly rate'), input('defaultRate', { type: 'number', step: 'any', required: true }),
        h('div', { class: 'help' }, 'Used when neither the client nor the project has a rate.'))),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', null, 'Default terms'), input('defaultTerms')),
      h('label', { class: 'field' }, h('span', null, 'Days until due'), input('dueDays', { type: 'number', min: 0, step: 1, required: true })),
      h('label', { class: 'field' }, h('span', null, 'Default invoice format'),
        h('select', { name: 'defaultInvoiceFormat' }, [['summary', 'Summary'], ['detailed', 'Detailed']].map(([v, l]) =>
          h('option', { value: v, selected: (s.defaultInvoiceFormat || 'summary') === v }, l))))),
    h('div', { class: 'foot', style: 'display:flex;justify-content:flex-end' }, h('button', { class: 'primary' }, 'Save settings')));

  const fileInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => act(() => api('POST', '/api/logo', { dataUrl: reader.result }), 'Logo updated');
    reader.readAsDataURL(f);
  } });

  return h('div', null,
    pageHead('Settings'),
    form,
    h('div', { class: 'card', style: 'max-width:640px' },
      h('h2', null, 'Logo'),
      s.logoFile ? h('img', { src: `/logo?v=${Date.now()}`, style: 'max-width:180px;max-height:140px;display:block;margin-bottom:12px' }) : h('p', { class: 'muted' }, 'No logo.'),
      h('div', { class: 'actions' }, fileInput,
        h('button', { onclick: () => fileInput.click() }, s.logoFile ? 'Replace logo…' : 'Upload logo…'),
        s.logoFile && h('button', { class: 'danger', onclick: () => confirm('Remove the logo?') && act(() => api('POST', '/api/logo', { dataUrl: null }), 'Logo removed') }, 'Remove'))),
    h('div', { class: 'card', style: 'max-width:640px' },
      h('h2', null, 'Data'),
      h('p', { class: 'muted' }, 'All data is stored as JSON files in:'),
      h('code', null, S.dataDir),
      h('p', { class: 'muted small' }, 'Back up this folder to back up everything. PDFs are saved in its pdfs/ subfolder.'),
      !S.pdfAvailable && h('p', { class: 'small', style: 'color:var(--danger)' }, 'Google Chrome was not found, so PDF export is off. Use Print → Save as PDF instead.')));
}

// ---------- router ----------

async function refresh() {
  S = await api('GET', '/api/state');
  const mark = document.querySelector('.brand-mark');
  if (S.settings.logoFile) {
    mark.replaceChildren(h('img', { src: '/logo', alt: '', onerror: () => { mark.textContent = 'CW'; } }));
  } else mark.textContent = 'CW';
}

const routes = [
  [/^\/?$/, () => dashboard(), 'dashboard'],
  [/^\/(time|items|expenses)$/, (m) => entriesPage(m[1]), (m) => m[1]],
  [/^\/invoices$/, () => invoicesPage(), 'invoices'],
  [/^\/invoices\/new$/, (m, q) => builderPage(q), 'invoices'],
  [/^\/invoices\/([\w-]+)$/, (m) => invoiceView(m[1]), 'invoices'],
  [/^\/clients$/, () => clientsPage(), 'clients'],
  [/^\/settings$/, () => settingsPage(), 'settings'],
];

let lastPath = null;
async function render() {
  const [path, qs = ''] = location.hash.replace(/^#/, '').split('?');
  if (lastPath && lastPath !== path && path !== '/invoices/new') B = null;
  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
  try {
    await refresh();
  } catch (e) {
    document.getElementById('app').replaceChildren(h('div', { class: 'card empty' }, `Can't reach the invoicer server: ${e.message}`));
    return;
  }
  for (const [re, view, nav] of routes) {
    const m = re.exec(path || '/');
    if (!m) continue;
    const navKey = typeof nav === 'function' ? nav(m) : nav;
    document.querySelectorAll('[data-nav]').forEach((a) => {
      const active = a.dataset.nav === navKey;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.getElementById('app').replaceChildren(view(m, new URLSearchParams(qs)));
    scrollTables(document.getElementById('app'));
    return;
  }
  location.hash = '#/';
}

document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  document.getElementById('app').focus();
});
window.addEventListener('hashchange', render);
render();
