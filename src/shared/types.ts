// The records the server stores in the data folder and sends to the app.

export type EntryType = 'time' | 'items' | 'expenses';
export type InvoiceFormat = 'summary' | 'detailed';

/** Timestamps (ISO). Records saved before timestamps were added have neither. */
export interface Stamped {
  createdAt?: string;
  updatedAt?: string;
}

export interface Settings {
  businessName: string;
  businessDetails: string | null;
  logoFile: string | null;
  startingInvoiceNumber: number;
  defaultRate: number;
  defaultTerms: string | null;
  dueDays: number;
  defaultInvoiceFormat: InvoiceFormat;
  updatedAt?: string;
}

export interface Client extends Stamped {
  id: string;
  name: string;
  address: string | null;
  email: string | null;
  rate: number | null;
  notes: string | null;
  archived?: boolean | null;
}

export interface Project extends Stamped {
  id: string;
  clientId: string;
  name: string;
  rate: number | null;
  archived?: boolean | null;
}

interface EntryBase extends Stamped {
  id: string;
  clientId: string;
  projectId: string | null;
  date: string;
  description: string;
  invoiceId?: string | null;
  invoicedAt?: string | null;
}

export interface TimeEntry extends EntryBase {
  hours: number;
  /** Per-entry override of the project/client rate. */
  rate: number | null;
  /** The rate locked in when the entry was invoiced. */
  billedRate?: number | null;
}

export interface ItemEntry extends EntryBase {
  qty: number;
  rate: number;
}

export interface ExpenseEntry extends EntryBase {
  amount: number;
}

export interface EntryMap {
  time: TimeEntry;
  items: ItemEntry;
  expenses: ExpenseEntry;
}
export type Entry = TimeEntry | ItemEntry | ExpenseEntry;

export type LineType = EntryType | 'heading' | 'custom';

export interface InvoiceLine {
  key: string;
  type: LineType;
  date?: string;
  description: string;
  /** Absent on heading lines. */
  qty?: number;
  rate?: number;
  amount: number;
}

export interface Invoice extends Stamped {
  id: string;
  number: number;
  clientId: string;
  date: string;
  dueDate: string | null;
  terms: string | null;
  notes: string | null;
  billTo: { name: string; address: string | null };
  from: { businessName: string; businessDetails: string | null };
  format: InvoiceFormat;
  overrides: Record<string, string>;
  lines: InvoiceLine[];
  total: number;
  sources: Record<EntryType, string[]>;
  status: 'paid' | 'unpaid';
  paidDate: string | null;
}

export type LogAction = 'created' | 'edited' | 'reformatted' | 'paid' | 'unpaid' | 'pdf' | 'print' | 'deleted';

export interface LogEntry {
  id: string;
  invoiceId: string;
  number: number;
  at: string;
  action: LogAction;
  detail: string | null;
}

/** GET /api/state */
export interface State {
  settings: Settings;
  clients: Client[];
  projects: Project[];
  time: TimeEntry[];
  items: ItemEntry[];
  expenses: ExpenseEntry[];
  invoices: Invoice[];
  invoiceLog: LogEntry[];
  nextInvoiceNumber: number;
  dataDir: string;
  pdfAvailable: boolean;
}
