// Pieces shared by several pages.
import type { InvoiceFormat } from '../shared/types';
import { errorMessage, toast } from './api';
import { h, type Kid } from './dom';
import { render } from './state';

export function pageHead(title: string, ...actions: Kid[]): HTMLElement {
  return h('div', { class: 'page-head' }, h('h1', null, title), h('div', { class: 'actions' }, actions));
}

/** Runs an action, then re-renders (with an optional success toast). Errors show as a toast. */
export async function act(fn: () => Promise<unknown>, ok?: string): Promise<void> {
  try {
    await fn();
    if (ok) toast(ok);
    render();
  } catch (e) {
    toast(errorMessage(e), true);
  }
}

// ---------- invoice preview (an iframe scaled to fit its box) ----------

const PAGE_W = 864; // 8.5in @96dpi + screen padding
const PAGE_H = 1104;

export function previewBox(frame: HTMLIFrameElement): HTMLElement {
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

export const FORMAT_HINTS: Record<InvoiceFormat, string> = {
  summary: 'One line per project. Time is totaled by project and rate.',
  detailed: 'Every time entry, line item and expense with its date and description, grouped by project.',
};

/** The Summary / Detailed switch. */
export function formatControls({ format }: { format: InvoiceFormat }, onChange: (change: { format: InvoiceFormat }) => unknown): HTMLElement {
  const options: [InvoiceFormat, string][] = [['summary', 'Summary'], ['detailed', 'Detailed']];
  return h('div', { class: 'seg', title: FORMAT_HINTS[format] },
    options.map(([v, l]) =>
      h('button', { type: 'button', class: format === v ? 'on' : '', onclick: () => format !== v && onChange({ format: v }) }, l)));
}
