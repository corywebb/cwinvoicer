// Business details, invoicing defaults, logo and data folder.
import type { Settings } from '../../shared/types';
import { api } from '../api';
import { h } from '../dom';
import { S, bumpLogoVersion, logoVersion } from '../state';
import { act, pageHead } from '../ui';

export function settingsPage(): HTMLElement {
  const s = S.settings;
  const input = (name: keyof Settings, props = {}) => h('input', { name, value: s[name] ?? '', ...props });
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
    const f = ev.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => act(async () => { await api('POST', '/api/logo', { dataUrl: reader.result }); bumpLogoVersion(); }, 'Logo updated');
    reader.readAsDataURL(f);
  } });

  return h('div', null,
    pageHead('Settings'),
    form,
    h('div', { class: 'card', style: 'max-width:640px' },
      h('h2', null, 'Logo'),
      s.logoFile ? h('img', { src: `/logo?v=${logoVersion}`, style: 'max-width:180px;max-height:140px;display:block;margin-bottom:12px' }) : h('p', { class: 'muted' }, 'No logo.'),
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
