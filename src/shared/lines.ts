// Turns time, line items and expenses into invoice lines.
// Shared by the browser (invoice builder) and the server (creating/re-formatting invoices).
import type { Client, EntryType, ExpenseEntry, InvoiceFormat, InvoiceLine, ItemEntry, LineType, Project, Settings, TimeEntry } from './types';

type Lookup = { clients: Client[]; projects: Project[]; settings: Settings };
type Dated = { date?: string; createdAt?: string };

/** An invoice line plus the description it would have without an override. */
export type BuiltLine = InvoiceLine & { auto: string };

export interface BuildOptions {
  format?: InvoiceFormat;
  /** Line key → description typed over the automatic one. */
  overrides?: Record<string, string>;
  time?: TimeEntry[];
  items?: ItemEntry[];
  expenses?: ExpenseEntry[];
}

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const byDate = (a: Dated, b: Dated) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || '');

/** Effective hourly rate: rate locked in at billing, else entry override, else project, client, default. */
export function timeRate(e: Pick<TimeEntry, 'billedRate' | 'rate' | 'projectId' | 'clientId'>, db: Lookup): number {
  if (e.billedRate != null) return e.billedRate;
  if (e.rate != null) return e.rate;
  const project = db.projects.find((p) => p.id === e.projectId);
  const client = db.clients.find((c) => c.id === e.clientId);
  return project?.rate ?? client?.rate ?? db.settings.defaultRate;
}

type Source = { e: TimeEntry | ItemEntry | ExpenseEntry; type: EntryType; qty: number; rate: number };
type Draft = Omit<BuiltLine, 'description' | 'amount'>;

/**
 * Detailed: one line per entry with its date and own description, grouped under a heading line per project
 * (oldest work first). Entries with no project come last, under "Other" when there are project groups too.
 * Summary: one line per project (time as hours × rate; a project's line items and expenses rolled into
 * one more line). Time with no project becomes one line; items/expenses with no project stay as-is.
 */
export function buildLines(opts: BuildOptions, db: Lookup): BuiltLine[] {
  const { format = 'summary', overrides = {} } = opts;
  const time = (opts.time || []).slice().sort(byDate);
  const others: Source[] = [
    ...(opts.items || []).map((e): Source => ({ e, type: 'items', qty: e.qty, rate: e.rate })),
    ...(opts.expenses || []).map((e): Source => ({ e, type: 'expenses', qty: 1, rate: e.amount })),
  ].sort((a, b) => byDate(a.e, b.e));
  const projectName = (id: string) => db.projects.find((p) => p.id === id)?.name;
  const lines: Draft[] = [];

  if (format === 'detailed') {
    const all = [...time.map((e): Source => ({ e, type: 'time', qty: e.hours, rate: timeRate(e, db) })), ...others].sort((a, b) => byDate(a.e, b.e));
    const groups = new Map<string, Source[]>();
    for (const o of all) {
      const pid = o.e.projectId || '';
      if (!groups.has(pid)) groups.set(pid, []);
      groups.get(pid)!.push(o);
    }
    const order = [...groups.keys()].filter(Boolean);
    if (groups.has('')) order.push('');
    for (const pid of order) {
      if (pid || order.length > 1) lines.push({ key: `heading:${pid}`, type: 'heading', auto: projectName(pid) || 'Other' });
      for (const o of groups.get(pid)!)
        lines.push({ key: `${o.type}:${o.e.id}`, type: o.type, date: o.e.date, qty: o.qty, rate: o.rate, auto: o.e.description });
    }
  } else {
    const projectOrder = [...new Set([...time, ...others.map((o) => o.e)].sort(byDate).map((e) => e.projectId || ''))];
    type TimeGroup = { key: string; projectId: string; qty: number; rate: number; descs: Set<string> };
    const timeGroups = new Map<string, TimeGroup>();
    for (const e of time) {
      const rate = timeRate(e, db);
      const key = `time:${e.projectId || ''}:${rate}`;
      if (!timeGroups.has(key)) timeGroups.set(key, { key, projectId: e.projectId || '', qty: 0, rate, descs: new Set() });
      const g = timeGroups.get(key)!;
      g.qty = round2(g.qty + e.hours);
      g.descs.add(e.description);
    }
    type Extras = { key: string; type: EntryType; projectId: string; rate: number; types: Set<EntryType> };
    const extras = new Map<string, Extras>();
    for (const o of others) {
      if (!o.e.projectId) continue;
      const key = `extras:${o.e.projectId}`;
      if (!extras.has(key)) extras.set(key, { key, type: o.type, projectId: o.e.projectId, rate: 0, types: new Set() });
      const g = extras.get(key)!;
      g.rate = round2(g.rate + round2(o.qty * o.rate)); // sum of each entry's own rounded amount
      g.types.add(o.type);
    }
    const emit = (projectId: string) => {
      for (const g of timeGroups.values()) {
        if (g.projectId !== projectId) continue;
        const auto = projectName(projectId) || (g.descs.size === 1 ? [...g.descs][0] : 'Professional services');
        lines.push({ key: g.key, type: 'time', qty: g.qty, rate: g.rate, auto });
      }
      const x = extras.get(`extras:${projectId}`);
      if (x) {
        const what = x.types.size > 1 ? 'items & expenses' : x.types.has('expenses') ? 'expenses' : 'additional items';
        const type: LineType = x.types.size > 1 ? 'custom' : x.type;
        lines.push({ key: x.key, type, qty: 1, rate: x.rate, auto: `${projectName(projectId)} – ${what}` });
      }
    };
    projectOrder.filter(Boolean).forEach(emit);
    emit('');
    for (const o of others) {
      if (!o.e.projectId) lines.push({ key: `${o.type}:${o.e.id}`, type: o.type, qty: o.qty, rate: o.rate, auto: o.e.description });
    }
  }

  return lines.map((l) => ({
    ...l,
    description: overrides[l.key] ?? l.auto,
    // Round only the amount, as each entry's own amount is rounded, so the invoice
    // matches the totals shown elsewhere. The rate keeps its precision.
    amount: l.type === 'heading' ? 0 : round2((l.qty ?? 0) * (l.rate ?? 0)),
  }));
}
