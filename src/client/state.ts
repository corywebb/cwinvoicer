// App state from the server, record lookups, and the render hook pages call after changes.
import type { State } from '../shared/types';
import { api } from './api';
import { h, shell } from './dom';

/** Full app state from the server; reloaded before every render. */
export let S!: State;
export const loaded = () => S !== undefined;

export const client = (id: string | null | undefined) => S.clients.find((c) => c.id === id);
export const project = (id: string | null | undefined) => S.projects.find((p) => p.id === id);
export const invoice = (id: string | null | undefined) => S.invoices.find((i) => i.id === id);

/** Unarchived clients by name, plus `keepId` so a record's current client stays selectable. */
export const activeClients = (keepId?: string) =>
  S.clients.filter((c) => !c.archived || c.id === keepId).sort((a, b) => a.name.localeCompare(b.name));
export const clientProjects = (clientId: string, keepId?: string) =>
  S.projects.filter((p) => p.clientId === clientId && (!p.archived || p.id === keepId)).sort((a, b) => a.name.localeCompare(b.name));

/** Bumped after each upload so the replaced file is fetched. */
export let logoVersion = Date.now();
export const bumpLogoVersion = () => {
  logoVersion++;
};

export async function refresh(): Promise<void> {
  S = await api<State>('GET', '/api/state');
  // Only touch the mark when the logo changes, so navigation and saves don't re-download it.
  const mark = shell('.brand-mark');
  const key = S.settings.logoFile ? `${S.settings.logoFile}:${logoVersion}` : '';
  if (mark.dataset.logo === key) return;
  mark.dataset.logo = key;
  if (key) mark.replaceChildren(h('img', { src: `/logo?v=${logoVersion}`, alt: '', onerror: () => { mark.textContent = 'CW'; } }));
  else mark.textContent = 'CW';
}

// The router registers itself here, so pages can re-render without importing it.
let renderer: () => Promise<void> = async () => {};
export const setRenderer = (fn: () => Promise<void>) => {
  renderer = fn;
};
/** Reloads state and redraws the current page. */
export const render = () => renderer();
