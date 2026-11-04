// Entry point: hash router, page shell, and the hook the desktop app's menus use.
import type { EntryType } from '../shared/types';
import { h, scrollTables, shell } from './dom';
import { editEntry } from './entries';
import { activityPage } from './pages/activity';
import { builderPage, resetBuilder } from './pages/builder';
import { clientsPage } from './pages/clients';
import { dashboard } from './pages/dashboard';
import { entriesPage } from './pages/entries';
import { invoiceView } from './pages/invoice-view';
import { invoicesPage } from './pages/invoices';
import { settingsPage } from './pages/settings';
import { loaded, refresh, render, setRenderer } from './state';

// Desktop app (Electron): leave room for the Mac window buttons and make the top edge draggable.
if (navigator.userAgent.includes('Electron')) document.documentElement.classList.add('desktop');

type Route = [RegExp, (m: RegExpExecArray, q: URLSearchParams) => HTMLElement, string | ((m: RegExpExecArray) => string)];

const routes: Route[] = [
  [/^\/?$/, () => dashboard(), 'dashboard'],
  [/^\/(time|items|expenses)$/, (m) => entriesPage(m[1] as EntryType), (m) => m[1]],
  [/^\/invoices$/, () => invoicesPage(), 'invoices'],
  [/^\/invoices\/new$/, (m, q) => builderPage(q), 'invoices'],
  [/^\/invoices\/activity$/, () => activityPage(), 'invoices'],
  [/^\/invoices\/([\w-]+)$/, (m) => invoiceView(m[1]), 'invoices'],
  [/^\/clients$/, () => clientsPage(), 'clients'],
  [/^\/settings$/, () => settingsPage(), 'settings'],
];

let lastPath: string | null = null;
async function renderPage(): Promise<void> {
  const [path, qs = ''] = location.hash.replace(/^#/, '').split('?');
  // Leaving the builder discards its draft.
  if (lastPath && lastPath !== path && path !== '/invoices/new') resetBuilder();
  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
  const app = shell('#app');
  try {
    await refresh();
  } catch (e) {
    app.replaceChildren(h('div', { class: 'card empty' }, `Can't reach the invoicer server: ${e instanceof Error ? e.message : e}`));
    return;
  }
  for (const [re, view, nav] of routes) {
    const m = re.exec(path || '/');
    if (!m) continue;
    const navKey = typeof nav === 'function' ? nav(m) : nav;
    document.querySelectorAll<HTMLElement>('[data-nav]').forEach((a) => {
      const active = a.dataset.nav === navKey;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    app.replaceChildren(view(m, new URLSearchParams(qs)));
    scrollTables(app);
    return;
  }
  location.hash = '#/';
}
setRenderer(renderPage);

// Called by electron/main.js (menu items like File → Log Time…) once `loaded` is true.
declare global {
  interface Window {
    CWInvoicer: { readonly loaded: boolean; editEntry: typeof editEntry; render: typeof render };
  }
}
window.CWInvoicer = { get loaded() { return loaded(); }, editEntry, render };

shell('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  shell('#app').focus();
});
window.addEventListener('hashchange', render);
render();
