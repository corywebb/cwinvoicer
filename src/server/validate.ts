// Turns request bodies into clean records.
import type { Client, ExpenseEntry, InvoiceFormat, ItemEntry, Project, Settings, TimeEntry } from '../shared/types';
import type { Db } from './storage';
import { HttpError } from './util';

/** A parsed JSON request body. Nothing in it is trusted until validated. */
export type Body = Record<string, unknown>;

/** `v` if it's a plain object, else an empty one. */
export const asObject = (v: unknown): Body => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Body) : {});

export const FORMATS: InvoiceFormat[] = ['summary', 'detailed'];
export const isFormat = (v: unknown): v is InvoiceFormat => typeof v === 'string' && (FORMATS as string[]).includes(v);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns a YYYY-MM-DD string or null, or throws a 400 naming the field. */
export function isoDate(value: unknown, key: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE.test(value)) throw new HttpError(400, `${key} must be a date (YYYY-MM-DD)`);
  return value;
}

type FieldType = 'string' | 'text' | 'number' | 'int' | 'bool' | 'date' | 'format' | 'client' | 'project';
/** A field type, with "!" suffix for required. */
type FieldSpec = FieldType | `${FieldType}!`;

const SCHEMAS = {
  settings: {
    businessName: 'string!', businessDetails: 'text', startingInvoiceNumber: 'int!',
    defaultRate: 'number!', defaultTerms: 'string', dueDays: 'int!', defaultInvoiceFormat: 'format!',
  },
  clients: { name: 'string!', address: 'text', email: 'string', rate: 'number', notes: 'text', archived: 'bool' },
  projects: { clientId: 'client!', name: 'string!', rate: 'number', archived: 'bool' },
  time: { clientId: 'client!', projectId: 'project', date: 'date!', description: 'text!', hours: 'number!', rate: 'number' },
  items: { clientId: 'client!', projectId: 'project', date: 'date!', description: 'text!', qty: 'number!', rate: 'number!' },
  expenses: { clientId: 'client!', projectId: 'project', date: 'date!', description: 'text!', amount: 'number!' },
} satisfies Record<string, Record<string, FieldSpec>>;

type Records = { settings: Settings; clients: Client; projects: Project; time: TimeEntry; items: ItemEntry; expenses: ExpenseEntry };
export type Kind = keyof Records;
/** A record's own fields: everything but its id and timestamps, which the routes set. */
export type Fields<K extends Kind> = Omit<Records[K], 'id' | 'createdAt' | 'updatedAt'>;

function cleanValue(type: FieldType, key: string, input: unknown, db: Db): unknown {
  let v = input;
  if (v === '' || v === undefined || v === null) return null;
  switch (type) {
    case 'string':
    case 'text': {
      let s = String(v).trim();
      if (type === 'string') s = s.replace(/\s+/g, ' ');
      return s || null;
    }
    case 'number':
    case 'int':
      v = Number(v);
      if (!Number.isFinite(v)) throw new HttpError(400, `${key} must be a number`);
      return type === 'int' ? Math.round(v as number) : v;
    case 'bool':
      return !!v;
    case 'date':
      return isoDate(v, key);
    case 'format':
      if (!isFormat(v)) throw new HttpError(400, `${key} must be summary or detailed`);
      return v;
    case 'client':
      if (!db.clients.some((c) => c.id === v)) throw new HttpError(400, 'Unknown client');
      return v;
    case 'project':
      if (!db.projects.some((p) => p.id === v)) throw new HttpError(400, 'Unknown project');
      return v;
  }
}

/**
 * Applies the fields present in `input` to a copy of `existing`, converting and checking each one,
 * then checks that required fields are set and that a project belongs to the record's client.
 */
export function clean<K extends Kind>(kind: K, input: Body, existing: object, db: Db): Fields<K> {
  const schema: Record<string, FieldSpec> = SCHEMAS[kind];
  const out: Record<string, unknown> = { ...existing };
  for (const [key, spec] of Object.entries(schema)) {
    if (key in input) out[key] = cleanValue(spec.replace('!', '') as FieldType, key, input[key], db);
  }
  for (const [key, spec] of Object.entries(schema)) {
    if (spec.endsWith('!') && (out[key] === null || out[key] === undefined)) throw new HttpError(400, `${key} is required`);
  }
  if (out.projectId) {
    const project = db.projects.find((p) => p.id === out.projectId);
    if (project?.clientId !== out.clientId) throw new HttpError(400, 'Project belongs to a different client');
  }
  return out as unknown as Fields<K>;
}
