// Clients & Projects.
import type { Client, Project } from '../../shared/types';
import { api } from '../api';
import { h } from '../dom';
import { unbilledByClient } from '../domain';
import { money, stamps } from '../format';
import { type FieldRow, type FormValues, formModal, str } from '../modal';
import { S, client, render } from '../state';
import { act, pageHead } from '../ui';

let showArchived = false;

const clientFields: FieldRow[] = [
  { name: 'name', label: 'Client name (as shown on invoices)', required: true },
  { name: 'address', label: 'Billing address (optional, shown under Bill To)', type: 'textarea', rows: 3 },
  [{ name: 'email', label: 'Email', type: 'email' },
   { name: 'rate', label: 'Hourly rate', type: 'number', placeholder: () => `Default: $${money(S.settings.defaultRate)}` }],
  { name: 'notes', label: 'Notes (private)', type: 'textarea', rows: 2 },
];
const projectFields: FieldRow[] = [
  { name: 'name', label: 'Project name', required: true },
  { name: 'rate', label: 'Hourly rate override', type: 'number', help: 'Leave blank to use the client rate.',
    placeholder: (v) => `Default: $${money(client(str(v.clientId))?.rate ?? S.settings.defaultRate)}` },
];

async function saveRecord(kind: 'clients' | 'projects', existing: { id: string } | null, values: FormValues) {
  const payload = { ...values };
  if ('rate' in payload && payload.rate === '') payload.rate = null;
  return existing?.id ? api('PUT', `/api/${kind}/${existing.id}`, payload) : api('POST', `/api/${kind}`, payload);
}

async function editClient(c: Client | null) {
  const saved = await formModal({ title: c ? 'Edit client' : 'Add client', meta: c && stamps(c), fields: clientFields, values: { ...c },
    onSubmit: (v) => saveRecord('clients', c, { name: v.name, address: v.address, email: v.email, rate: v.rate, notes: v.notes }) });
  if (saved) render();
}
async function editProject(p: Project | null, clientId: string) {
  const saved = await formModal({ title: p ? 'Edit project' : `Add project for ${client(clientId)?.name}`, meta: p && stamps(p), fields: projectFields,
    values: p ? { ...p } : { clientId }, onSubmit: (v) => saveRecord('projects', p, { clientId, name: v.name, rate: v.rate }) });
  if (saved) render();
}

export function clientsPage(): HTMLElement {
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
