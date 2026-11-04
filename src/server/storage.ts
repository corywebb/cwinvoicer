// JSON files in the data folder, one per collection.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Client, ExpenseEntry, Invoice, ItemEntry, LogEntry, Project, Settings, TimeEntry } from '../shared/types';
import { config } from './config';

export interface Db {
  settings: Settings;
  clients: Client[];
  projects: Project[];
  time: TimeEntry[];
  items: ItemEntry[];
  expenses: ExpenseEntry[];
  invoices: Invoice[];
  invoiceLog: LogEntry[];
}

export const DEFAULT_SETTINGS: Settings = {
  businessName: 'My Business',
  businessDetails: '',
  logoFile: null,
  startingInvoiceNumber: 1242,
  defaultRate: 100,
  defaultTerms: 'Due on receipt',
  dueDays: 15,
  defaultInvoiceFormat: 'summary',
};

export const file = (name: string) => path.join(config.dataDir, `${name}.json`);

/** Reads a data file; `missing` if it doesn't exist yet. */
function load<T>(name: string, missing: T): T {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return missing;
    throw new Error(`Could not read ${file(name)}: ${(e as Error).message}`);
  }
}

/** Writes a data file atomically (temp file, then rename). */
export function save(name: string, value: unknown): void {
  const tmp = `${file(name)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file(name));
}

export function loadAll(): Db {
  return {
    settings: { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>('settings', {}) },
    clients: load<Client[]>('clients', []),
    projects: load<Project[]>('projects', []),
    time: load<TimeEntry[]>('time', []),
    items: load<ItemEntry[]>('items', []),
    expenses: load<ExpenseEntry[]>('expenses', []),
    invoices: load<Invoice[]>('invoices', []),
    // Kept in its own file, not inside the invoices, so a deleted invoice keeps its history.
    invoiceLog: load<LogEntry[]>('invoice-log', []),
  };
}
