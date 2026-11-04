// Add, edit and delete forms for time, line items and expenses.
import type { Entry, EntryType } from '../shared/types';
import { api, errorMessage, toast } from './api';
import { TYPES, defaultRate } from './domain';
import { money, stamps, today } from './format';
import { type FieldRow, type FieldSpec, type FormValues, formModal, str } from './modal';
import { activeClients, clientProjects, refresh, render } from './state';

function clientField(lockClient: boolean): FieldSpec {
  return {
    name: 'clientId', label: 'Client', type: 'select', required: true, disabled: lockClient,
    options: (v) => [['', 'Choose a client…'], ...activeClients(str(v.clientId)).map((c): [string, string] => [c.id, c.name])],
  };
}
const projectField: FieldSpec = {
  name: 'projectId', label: 'Project', type: 'select',
  options: (v) => [['', '— No project —'], ...clientProjects(str(v.clientId), str(v.projectId)).map((p): [string, string] => [p.id, p.name])],
};

function entryFields(type: EntryType, lockClient: boolean): FieldRow[] {
  const common = [[clientField(lockClient), projectField]];
  if (type === 'time')
    return [
      ...common,
      [{ name: 'date', label: 'Date', type: 'date', required: true },
       { name: 'hours', label: 'Hours', type: 'hours', required: true, placeholder: '1.5, 1:30 or 90m' }],
      { name: 'description', label: 'Task / description', type: 'textarea', required: true, rows: 2 },
      { name: 'rate', label: 'Hourly rate override', type: 'number',
        placeholder: (v) => `Default: $${money(defaultRate({ clientId: str(v.clientId), projectId: str(v.projectId) }))}/hr`,
        help: 'Leave blank to use the project or client rate.' },
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

function entryPayload(type: EntryType, v: FormValues) {
  const base = { clientId: v.clientId, projectId: v.projectId || null, date: v.date, description: v.description };
  if (type === 'time') return { ...base, hours: v.hours, rate: v.rate === '' ? null : v.rate };
  if (type === 'items') return { ...base, qty: v.qty, rate: v.rate };
  return { ...base, amount: v.amount };
}

/** Opens the add/edit form for an entry. Resolves to the saved record, or null if cancelled. */
export async function editEntry(type: EntryType, existing?: Entry | null, preset: FormValues = {}, { lockClient = false } = {}): Promise<Entry | null> {
  const record: FormValues | null = existing?.id ? { ...existing } : null;
  const values: FormValues = record
    ? { ...record, rate: record.rate ?? '' }
    : { date: today(), qty: 1, ...preset, rate: preset.rate ?? '' };
  return formModal({
    title: `${record ? 'Edit' : 'Add'} ${TYPES[type].one}`,
    meta: record && stamps(existing),
    fields: entryFields(type, lockClient),
    values,
    submitLabel: record ? 'Save' : 'Add',
    onSubmit: async (v) => {
      if (lockClient) v.clientId = values.clientId;
      const saved = existing?.id
        ? await api<Entry>('PUT', `/api/${type}/${existing.id}`, entryPayload(type, v))
        : await api<Entry>('POST', `/api/${type}`, entryPayload(type, v));
      await refresh();
      return saved;
    },
  });
}

export async function deleteEntry(type: EntryType, e: Entry): Promise<void> {
  if (!confirm(`Delete this ${TYPES[type].one}?\n\n${e.description}`)) return;
  try {
    await api('DELETE', `/api/${type}/${e.id}`);
    toast('Deleted');
    render();
  } catch (err) {
    toast(errorMessage(err), true);
  }
}
