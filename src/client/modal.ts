// The modal form used for every add/edit dialog.
import { errorMessage } from './api';
import { h } from './dom';
import { parseHours } from './format';

/** Raw form input by field name. The server validates and converts it. */
export type FormValues = Record<string, unknown>;

export interface FieldSpec {
  name: string;
  label: string;
  /** "hours" accepts 1.5, 1:30 or 90m. */
  type?: 'text' | 'email' | 'textarea' | 'number' | 'date' | 'select' | 'hours' | 'checkbox';
  /** Select options as [value, label], recomputed whenever any field changes. */
  options?: (vals: FormValues) => [string, string][];
  required?: boolean;
  placeholder?: string | ((vals: FormValues) => string);
  help?: string;
  disabled?: boolean;
  step?: string;
  rows?: number;
}
/** A field, or fields shown side by side. */
export type FieldRow = FieldSpec | FieldSpec[];

/** A form value as a string ('' when empty). */
export const str = (v: unknown) => (v == null ? '' : String(v));

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * Shows a form in a modal dialog. Resolves to what onSubmit returned, or null if cancelled.
 * If onSubmit throws, the form stays open and shows the error.
 */
export function formModal<T>({ title, meta, fields, values = {}, submitLabel = 'Save', onSubmit }: {
  title: string;
  meta?: string | false | null;
  fields: FieldRow[];
  values?: FormValues;
  submitLabel?: string;
  onSubmit: (vals: FormValues) => Promise<T>;
}): Promise<T | null> {
  const vals: FormValues = { ...values };
  const controls: { spec: FieldSpec; el: Control }[] = [];

  const read = () => {
    for (const { spec, el } of controls) {
      if (spec.type === 'checkbox' && el instanceof HTMLInputElement) vals[spec.name] = el.checked;
      else if (spec.type === 'hours') vals[spec.name] = el.value.trim() === '' ? null : parseHours(el.value);
      else vals[spec.name] = el.value;
    }
  };
  const refreshDynamic = () => {
    for (const { spec, el } of controls) {
      if (el instanceof HTMLSelectElement && spec.options) {
        const current = str(vals[spec.name]);
        el.replaceChildren(...spec.options(vals).map(([v, l]) => h('option', { value: v }, l)));
        el.value = [...el.options].some((o) => o.value === current) ? current : el.options[0]?.value ?? '';
      }
      if (typeof spec.placeholder === 'function' && !(el instanceof HTMLSelectElement)) el.placeholder = spec.placeholder(vals);
    }
    read();
  };

  const fieldEl = (spec: FieldSpec) => {
    let el: Control;
    const v = vals[spec.name];
    if (spec.type === 'textarea') el = h('textarea', { rows: spec.rows || 3 }, str(v));
    else if (spec.type === 'select') el = h('select');
    else if (spec.type === 'checkbox') el = h('input', { type: 'checkbox', checked: !!v });
    else
      el = h('input', {
        type: spec.type === 'hours' ? 'text' : spec.type || 'text',
        value: str(v),
        step: spec.type === 'number' ? spec.step || 'any' : null,
        inputmode: spec.type === 'hours' ? 'decimal' : null,
      });
    if (spec.required) el.required = true;
    if (spec.disabled) el.disabled = true;
    if (typeof spec.placeholder === 'string' && !(el instanceof HTMLSelectElement)) el.placeholder = spec.placeholder;
    controls.push({ spec, el });
    if (spec.type === 'checkbox') return h('label', { class: 'field' }, el, ' ', spec.label);
    return h('label', { class: 'field' }, h('span', null, spec.label), el, spec.help && h('div', { class: 'help' }, spec.help));
  };

  return new Promise((resolve) => {
    let saving = false;
    let closing = false;
    let pressedOutside = false;
    const close = (result: T | null) => {
      if (saving || closing) return;
      closing = true;
      backdrop.close();
      backdrop.remove();
      resolve(result);
    };
    const errorEl = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const showError = (msg: string) => {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    };
    const submit = h('button', { class: 'primary', type: 'submit' }, submitLabel);
    const form = h(
      'form',
      {
        class: 'modal',
        onchange: () => (read(), refreshDynamic()),
        oninput: () => (read(), refreshDynamic()),
        onsubmit: async (ev) => {
          ev.preventDefault();
          if (saving) return;
          errorEl.hidden = true;
          read();
          const bad = controls.find(({ spec }) => spec.type === 'hours' && Number.isNaN(vals[spec.name]));
          if (bad) return showError(`${bad.spec.label}: enter hours like 1.5, 1:30 or 90m`);
          saving = true;
          submit.disabled = true;
          submit.textContent = 'Saving…';
          let result: T;
          try {
            result = await onSubmit(vals);
          } catch (e) {
            saving = false;
            submit.disabled = false;
            submit.textContent = submitLabel;
            return showError(errorMessage(e));
          }
          saving = false;
          close(result);
        },
      },
      h('h2', { id: 'modal-title' }, title),
      meta && h('p', { class: 'muted small form-meta' }, meta),
      errorEl,
      fields.map((f) => (Array.isArray(f) ? h('div', { class: 'row' }, f.map(fieldEl)) : fieldEl(f))),
      h('div', { class: 'foot' }, h('button', { type: 'button', onclick: () => close(null) }, 'Cancel'), submit)
    );
    const backdrop = h('dialog', { class: 'dialog-shell', 'aria-labelledby': 'modal-title',
      oncancel: (e) => { e.preventDefault(); close(null); },
      // A repeated Escape can close the dialog without a cancel event. Reopen it during a
      // save so the form and its pending result survive; otherwise treat it as Cancel.
      onclose: () => {
        if (closing) return;
        if (saving) backdrop.showModal();
        else close(null);
      } }, form);
    // The <dialog> is the hit target for its ::backdrop and its own scrollbar, so test
    // the pointer position, not just the target. Close only when the press starts and ends outside.
    const outside = (e: MouseEvent) => {
      if (e.target !== backdrop) return false;
      const r = backdrop.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    backdrop.addEventListener('mousedown', (e) => (pressedOutside = outside(e)));
    backdrop.addEventListener('click', (e) => pressedOutside && outside(e) && close(null));
    document.body.append(backdrop);
    backdrop.showModal();
    refreshDynamic();
    form.querySelector<HTMLElement>('input:not([type=checkbox]):not(:disabled), textarea, select:not(:disabled)')?.focus();
  });
}
