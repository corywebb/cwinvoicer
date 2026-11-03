#!/usr/bin/env node
// CW Invoicer — local invoicing server. No dependencies; data lives in JSON files.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { renderInvoice } = require('./lib/invoice-template');
const { buildLines, timeRate } = require('./public/lines');

const HOST = '127.0.0.1';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

// Set by start(); the desktop app passes its own data folder, PDF renderer and Finder hook.
let PORT = 4242;
let DATA = path.join(ROOT, 'data');
let PDF_DIR = path.join(DATA, 'pdfs');
let renderPdf = null; // async (url, outPath) => void; falls back to headless Chrome
let revealFile = (p) => execFile('open', ['-R', p]);

const ENTRY_TYPES = ['time', 'items', 'expenses'];
const COLLECTIONS = ['clients', 'projects', ...ENTRY_TYPES, 'invoices'];
const FORMATS = ['summary', 'detailed'];

const DEFAULT_SETTINGS = {
  businessName: 'My Business',
  businessDetails: '',
  logoFile: null,
  startingInvoiceNumber: 1242,
  defaultRate: 100,
  defaultTerms: 'Due on receipt',
  dueDays: 15,
  defaultInvoiceFormat: 'summary',
};

// Field specs: type, with "!" suffix for required.
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
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- storage ----------

const file = (name) => path.join(DATA, `${name}.json`);

function load(name) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return name === 'settings' ? { ...DEFAULT_SETTINGS } : [];
    throw new Error(`Could not read ${file(name)}: ${e.message}`);
  }
}

function save(name, value) {
  const tmp = `${file(name)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file(name));
}

function loadAll() {
  const db = { settings: { ...DEFAULT_SETTINGS, ...load('settings') } };
  for (const c of COLLECTIONS) db[c] = load(c);
  db.invoiceLog = load('invoice-log');
  return db;
}

const now = () => new Date().toISOString();

// ---------- invoice activity log ----------
// Kept in its own file, not inside the invoices, so a deleted invoice keeps its history.

const LOG_ACTIONS = ['created', 'edited', 'reformatted', 'paid', 'unpaid', 'pdf', 'print', 'deleted'];

function logInvoice(db, inv, action, detail = null) {
  if (!LOG_ACTIONS.includes(action)) throw new Error(`Unknown invoice action: ${action}`);
  db.invoiceLog.push({ id: crypto.randomUUID(), invoiceId: inv.id, number: inv.number, at: now(), action, detail });
  save('invoice-log', db.invoiceLog);
}

function recordInvoiceAction(id, action, detail) {
  const db = loadAll();
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  logInvoice(db, inv, action, detail);
}

// Events the app reports when you click PDF and print buttons. The details are fixed here,
// so the log only ever says what the server wrote.
const CLIENT_EVENTS = {
  'pdf-open': ['pdf', 'Opened PDF'],
  'pdf-download': ['pdf', 'Downloaded PDF'],
  print: ['print', 'Opened the print dialog'],
};

const usDate = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : 'none');
const dollars = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const entryCount = (n) => `${n} ${n === 1 ? 'entry' : 'entries'}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Describes what an edit changed, e.g. "Due date 01/15/2026 → 01/30/2026; Notes". Empty if nothing did. */
function describeEdit(before, after) {
  const changes = [];
  const same = (a, b) => (a || null) === (b || null);
  for (const [k, label] of [['date', 'Invoice date'], ['dueDate', 'Due date'], ['paidDate', 'Paid date']]) {
    if (k === 'paidDate' && before.status !== after.status) continue; // covered by the paid/unpaid entry
    if (!same(before[k], after[k])) changes.push(`${label} ${usDate(before[k])} → ${usDate(after[k])}`);
  }
  for (const [k, label] of [['terms', 'Terms'], ['notes', 'Notes']]) if (!same(before[k], after[k])) changes.push(label);
  if (before.billTo?.name !== after.billTo?.name) changes.push('Bill to');
  if (!same(before.billTo?.address, after.billTo?.address)) changes.push('Bill-to address');
  if ((before.format || 'summary') === after.format) {
    const renamed = after.lines.filter((l) => before.lines.find((b) => b.key === l.key)?.description !== l.description).length;
    if (renamed) changes.push(`${renamed} line description${renamed === 1 ? '' : 's'}`);
  }
  return changes.join('; ');
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

/** Returns a YYYY-MM-DD string or null, or throws a 400 naming the field. */
function isoDate(value, key) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `${key} must be a date (YYYY-MM-DD)`);
  return value;
}

function nextInvoiceNumber(db) {
  const max = db.invoices.reduce((m, i) => Math.max(m, Number(i.number) || 0), 0);
  return Math.max(Number(db.settings.startingInvoiceNumber) || 1, max + 1);
}

// ---------- validation ----------

function clean(kind, input, existing, db) {
  const out = { ...existing };
  for (const [key, spec] of Object.entries(SCHEMAS[kind])) {
    if (!(key in input)) continue;
    const type = spec.replace('!', '');
    let v = input[key];
    if (v === '' || v === undefined) v = null;
    if (v !== null) {
      switch (type) {
        case 'string':
        case 'text':
          v = String(v).trim();
          if (type === 'string') v = v.replace(/\s+/g, ' ');
          if (!v) v = null;
          break;
        case 'number':
        case 'int':
          v = Number(v);
          if (!Number.isFinite(v)) throw new HttpError(400, `${key} must be a number`);
          if (type === 'int') v = Math.round(v);
          break;
        case 'bool':
          v = !!v;
          break;
        case 'date':
          if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, `${key} must be a date (YYYY-MM-DD)`);
          break;
        case 'format':
          if (!FORMATS.includes(v)) throw new HttpError(400, `${key} must be summary or detailed`);
          break;
        case 'client':
          if (!db.clients.some((c) => c.id === v)) throw new HttpError(400, 'Unknown client');
          break;
        case 'project':
          if (!db.projects.some((p) => p.id === v)) throw new HttpError(400, 'Unknown project');
          break;
      }
    }
    out[key] = v;
  }
  for (const [key, spec] of Object.entries(SCHEMAS[kind])) {
    if (spec.endsWith('!') && (out[key] === null || out[key] === undefined))
      throw new HttpError(400, `${key} is required`);
  }
  if (out.projectId) {
    const project = db.projects.find((p) => p.id === out.projectId);
    if (project.clientId !== out.clientId) throw new HttpError(400, 'Project belongs to a different client');
  }
  return out;
}

// ---------- invoices ----------

/** Looks up the entries named in `sources` ({time: [ids], items: [ids], expenses: [ids]}) for a client. */
function collectEntries(db, clientId, sources, { forPreview = false } = {}) {
  const entries = {};
  for (const t of ENTRY_TYPES) {
    entries[t] = [];
    // De-duplicate so an entry listed twice is billed once (it isn't marked invoiced until after this check).
    for (const entryId of new Set(sources?.[t] || [])) {
      const e = db[t].find((x) => x.id === entryId);
      if (forPreview) {
        if (e && e.clientId === clientId) entries[t].push(e);
        continue;
      }
      if (!e) throw new HttpError(400, `Unknown ${t} entry`);
      if (e.clientId !== clientId) throw new HttpError(400, 'Entry belongs to a different client');
      if (e.invoiceId) throw new HttpError(409, `An entry was already invoiced (#${invoiceNumber(db, e.invoiceId)})`);
      entries[t].push(e);
    }
  }
  return entries;
}

function cleanFormat(body, fallback) {
  const format = body.format ?? fallback.format;
  if (!FORMATS.includes(format)) throw new HttpError(400, 'Format must be summary or detailed');
  const overrides = {};
  for (const [k, v] of Object.entries({ ...fallback.overrides, ...body.overrides })) if (typeof v === 'string') overrides[k] = v.trim();
  return { format, overrides };
}

function linesFor(db, entries, fmt) {
  return buildLines({ ...fmt, ...entries }, db).map(({ key, type, date, description, qty, rate, amount }) => ({ key, type, date, description, qty, rate, amount }));
}
const sumLines = (lines) => round2(lines.reduce((s, l) => s + l.amount, 0));

function buildInvoice(db, body, entries) {
  const client = db.clients.find((c) => c.id === body.clientId);
  if (!client) throw new HttpError(400, 'Choose a client');
  const fmt = cleanFormat(body, { format: db.settings.defaultInvoiceFormat, overrides: {} });
  const lines = linesFor(db, entries, fmt);
  return {
    number: nextInvoiceNumber(db),
    clientId: client.id,
    date: isoDate(body.date, 'date') || today(),
    dueDate: isoDate(body.dueDate, 'dueDate'),
    terms: String(body.terms ?? '').trim() || null,
    notes: String(body.notes ?? '').trim() || null,
    billTo: { name: client.name, address: client.address || null },
    from: { businessName: db.settings.businessName, businessDetails: db.settings.businessDetails },
    ...fmt,
    lines,
    total: sumLines(lines),
  };
}

function createInvoice(body) {
  const db = loadAll();
  const entries = collectEntries(db, body.clientId, body.sources);
  const draft = buildInvoice(db, body, entries);
  if (!draft.lines.length) throw new HttpError(400, 'Select at least one entry to invoice');
  const id = crypto.randomUUID();
  const stamp = now();
  const sources = Object.fromEntries(ENTRY_TYPES.map((t) => [t, entries[t].map((e) => e.id)]));
  const invoice = { id, ...draft, sources, status: 'unpaid', paidDate: null, createdAt: stamp, updatedAt: stamp };
  for (const t of ENTRY_TYPES) {
    if (!entries[t].length) continue;
    for (const e of entries[t]) {
      // Lock in the hourly rate so later rate changes never alter a billed invoice.
      if (t === 'time') e.billedRate = timeRate(e, db);
      Object.assign(e, { invoiceId: id, invoicedAt: stamp, updatedAt: stamp });
    }
    save(t, db[t]);
  }
  db.invoices.push(invoice);
  save('invoices', db.invoices);
  const billed = ENTRY_TYPES.reduce((n, t) => n + entries[t].length, 0);
  logInvoice(db, invoice, 'created', `${dollars(invoice.total)} · ${entryCount(billed)}`);
  return invoice;
}

function invoiceNumber(db, id) {
  return db.invoices.find((i) => i.id === id)?.number ?? '?';
}

function updateInvoice(id, body) {
  const db = loadAll();
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  const before = structuredClone(inv);
  for (const k of ['date', 'dueDate', 'paidDate']) if (k in body) inv[k] = isoDate(body[k], k);
  if (!inv.date) throw new HttpError(400, 'date is required');
  for (const k of ['terms', 'notes']) if (k in body) inv[k] = String(body[k] ?? '').trim() || null;
  if (body.billTo) {
    inv.billTo = {
      name: String(body.billTo.name ?? inv.billTo.name).trim(),
      address: String(body.billTo.address ?? '').trim() || null,
    };
  }
  if ('status' in body) {
    if (!['paid', 'unpaid'].includes(body.status)) throw new HttpError(400, 'Invalid status');
    inv.status = body.status;
    if (inv.status === 'paid' && !inv.paidDate) inv.paidDate = today();
    if (inv.status === 'unpaid') inv.paidDate = null;
  }
  if ('format' in body || 'overrides' in body) {
    delete inv.showDates;
    Object.assign(inv, cleanFormat(body, { format: inv.format || 'summary', overrides: inv.overrides }));
    const entries = Object.fromEntries(ENTRY_TYPES.map((t) => [t, db[t].filter((e) => e.invoiceId === inv.id)]));
    inv.lines = linesFor(db, entries, inv);
    inv.total = sumLines(inv.lines);
  }
  const edited = describeEdit(before, inv);
  const statusChanged = before.status !== inv.status;
  const formatChanged = (before.format || 'summary') !== inv.format;
  // Saving with nothing changed doesn't touch the invoice, its PDF or the log.
  if (!edited && !statusChanged && !formatChanged && before.total === inv.total) return before;
  inv.updatedAt = now();
  save('invoices', db.invoices);
  removePdf(inv);
  if (statusChanged) logInvoice(db, inv, inv.status, inv.status === 'paid' ? `Paid on ${usDate(inv.paidDate)}` : null);
  if (formatChanged) logInvoice(db, inv, 'reformatted', `${cap(before.format || 'summary')} → ${cap(inv.format)}`);
  if (edited) logInvoice(db, inv, 'edited', edited);
  return inv;
}

function deleteInvoice(id) {
  const db = loadAll();
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  const stamp = now();
  let released = 0;
  for (const t of ENTRY_TYPES) {
    let changed = false;
    for (const e of db[t]) {
      if (e.invoiceId === id) {
        e.invoiceId = null;
        e.invoicedAt = null;
        e.updatedAt = stamp;
        delete e.billedRate;
        released++;
        changed = true;
      }
    }
    if (changed) save(t, db[t]);
  }
  save('invoices', db.invoices.filter((i) => i !== inv));
  removePdf(inv);
  logInvoice(db, inv, 'deleted', `${dollars(inv.total)} · ${entryCount(released)} marked unbilled`);
}

const pdfPath = (inv) => path.join(PDF_DIR, `Invoice_${inv.number}.pdf`);
const TEMPLATE_FILE = require.resolve('./lib/invoice-template');
const mtime = (p) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};

/** A saved PDF is current if it is newer than the invoice, the settings, the logo and the template. */
function pdfIsCurrent(inv, settings) {
  const made = mtime(pdfPath(inv));
  if (!made) return false;
  const inputs = [Date.parse(inv.updatedAt || inv.createdAt) || 0, mtime(file('settings')), mtime(TEMPLATE_FILE)];
  if (settings.logoFile) inputs.push(mtime(path.join(DATA, settings.logoFile)));
  return inputs.every((t) => made >= t);
}
function removePdf(inv) {
  fs.rmSync(pdfPath(inv), { force: true });
}

// ---------- PDF via headless Chrome ----------

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
].filter(Boolean);
const findChrome = () => CHROME_CANDIDATES.find((p) => fs.existsSync(p));

// One render per invoice at a time; a second request for the same PDF waits for the first.
const rendering = new Map();
function makePdf(inv) {
  if (!rendering.has(inv.id)) rendering.set(inv.id, renderToFile(inv).finally(() => rendering.delete(inv.id)));
  return rendering.get(inv.id);
}

// Renders to a temporary file and renames it over the old PDF only on success, so a failed
// or timed-out render never leaves the previous PDF looking like a fresh one.
async function renderToFile(inv) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
  const out = pdfPath(inv);
  const tmp = path.join(PDF_DIR, `.Invoice_${inv.number}.${crypto.randomUUID()}.pdf`);
  try {
    await renderWith(`http://${HOST}:${PORT}/invoice/${inv.id}`, tmp);
    fs.renameSync(tmp, out);
    return out;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function renderWith(url, out) {
  if (renderPdf) {
    try {
      return await renderPdf(url, out);
    } catch (e) {
      throw new HttpError(500, `PDF export failed: ${e.message}`);
    }
  }
  const chrome = findChrome();
  if (!chrome) throw new HttpError(501, 'No Chrome-based browser found for PDF export. Use Print → Save as PDF instead.');
  // A fresh profile per export: Chrome hands off to any process already using a profile,
  // so a shared one makes simultaneous exports fail.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cwinvoicer-chrome-'));
  const args = [
    '--headless',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    `--print-to-pdf=${out}`,
    url,
  ];
  return new Promise((resolve, reject) => {
    execFile(chrome, args, { timeout: 45000 }, (err, _stdout, stderr) => {
      fs.rmSync(profile, { recursive: true, force: true });
      if (!err && fs.existsSync(out)) return resolve();
      reject(new HttpError(500, `PDF export failed: ${err?.message || stderr || 'no file was written'}`));
    });
  });
}

// ---------- HTTP ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
};

function send(res, status, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 15e6) throw new HttpError(413, 'Request too large');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function sendFile(res, filePath, headers = {}) {
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, { error: 'Not found' });
    send(res, 200, buf, MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', headers);
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').slice(2); // after /api/
  const [first, id, action] = parts;
  const method = req.method;
  // Read the whole body before loading any data. Everything from loadAll() to save() below
  // then runs without an await, so overlapping requests can't save stale copies over each other.
  const body = method === 'GET' ? null : await readJson(req);

  if (method === 'GET' && first === 'state') {
    const db = loadAll();
    return send(res, 200, { ...db, nextInvoiceNumber: nextInvoiceNumber(db), dataDir: DATA, pdfAvailable: !!(renderPdf || findChrome()) });
  }
  if (first === 'settings' && method === 'PUT') {
    const db = loadAll();
    const settings = clean('settings', body, db.settings, db);
    if (settings.startingInvoiceNumber < 1) throw new HttpError(400, 'Starting invoice number must be positive');
    settings.updatedAt = now();
    save('settings', settings);
    return send(res, 200, settings);
  }
  if (first === 'logo' && method === 'POST') {
    const { dataUrl } = body;
    // Validate and write the new file before touching the old one, so a rejected upload
    // leaves the current logo in place.
    let newFile = null;
    if (dataUrl) {
      const m = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,(.+)$/.exec(dataUrl);
      if (!m) throw new HttpError(400, 'Logo must be a PNG, JPG, GIF, WebP or SVG image');
      const ext = m[1] === 'svg+xml' ? 'svg' : m[1].replace('jpeg', 'jpg');
      newFile = `logo.${ext}`;
      fs.writeFileSync(path.join(DATA, newFile), Buffer.from(m[2], 'base64'));
    }
    const db = loadAll();
    const oldFile = db.settings.logoFile;
    db.settings.logoFile = newFile;
    db.settings.updatedAt = now();
    save('settings', db.settings);
    if (oldFile && oldFile !== newFile) fs.rmSync(path.join(DATA, oldFile), { force: true });
    return send(res, 200, db.settings);
  }

  if (first === 'invoices') {
    if (method === 'POST' && id === 'preview') {
      const db = loadAll();
      const draft = buildInvoice(db, body, collectEntries(db, body.clientId, body.sources, { forPreview: true }));
      return send(res, 200, renderInvoice(draft, db.settings), 'text/html; charset=utf-8');
    }
    if (method === 'POST' && !id) return send(res, 201, createInvoice(body));
    if (method === 'PUT' && id) return send(res, 200, updateInvoice(id, body));
    if (method === 'DELETE' && id) {
      deleteInvoice(id);
      return send(res, 200, { ok: true });
    }
    // The app reports PDF and print clicks here. It's a POST (so it needs the app header)
    // rather than a side effect of the GET links, so other sites can't write to the log.
    if (method === 'POST' && id && action === 'log') {
      const event = CLIENT_EVENTS[body.event];
      if (!event) throw new HttpError(400, 'Unknown event');
      recordInvoiceAction(id, ...event);
      return send(res, 200, { ok: true });
    }
    // Opening a PDF is a GET (it's a link). Revealing it in Finder must be a POST, so it
    // always carries the app header and another site can't trigger it.
    if (id && action === 'reveal') {
      if (method !== 'POST') throw new HttpError(405, 'Use POST');
      const out = await pdfFor(id);
      revealFile(out);
      return send(res, 200, { ok: true, path: out });
    }
    if (id && action === 'pdf') {
      if (method !== 'GET') throw new HttpError(405, 'Use GET');
      const out = await pdfFor(id, url.searchParams.get('fresh') === '1');
      const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
      return sendFile(res, out, { 'Content-Disposition': `${disposition}; filename="${path.basename(out)}"` });
    }
  }

  if (['clients', 'projects', ...ENTRY_TYPES].includes(first)) {
    const db = loadAll();
    const list = db[first];

    if (method === 'POST' && !id) {
      const stamp = now();
      const record = { id: crypto.randomUUID(), ...clean(first, body, {}, db), createdAt: stamp, updatedAt: stamp };
      if (ENTRY_TYPES.includes(first)) record.invoiceId = null;
      list.push(record);
      save(first, list);
      return send(res, 201, record);
    }

    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) throw new HttpError(404, 'Not found');
    const record = list[idx];

    if (ENTRY_TYPES.includes(first) && record.invoiceId && method !== 'GET')
      throw new HttpError(409, `This was billed on invoice #${invoiceNumber(db, record.invoiceId)}. Delete that invoice first to change it.`);

    if (method === 'PUT') {
      list[idx] = { ...clean(first, body, record, db), updatedAt: now() };
      save(first, list);
      return send(res, 200, list[idx]);
    }
    if (method === 'DELETE') {
      if (first === 'clients') {
        const used = [...ENTRY_TYPES, 'projects', 'invoices'].some((t) => db[t].some((r) => r.clientId === id));
        if (used) throw new HttpError(409, 'This client has projects, entries or invoices. Archive it instead.');
      }
      if (first === 'projects' && ENTRY_TYPES.some((t) => db[t].some((r) => r.projectId === id)))
        throw new HttpError(409, 'This project has entries. Archive it instead.');
      list.splice(idx, 1);
      save(first, list);
      return send(res, 200, { ok: true });
    }
  }

  throw new HttpError(404, 'Unknown API route');
}

/** Returns the path of an invoice's PDF, making it first if it is missing or out of date (or if `fresh`). */
async function pdfFor(id, fresh = false) {
  const db = loadAll();
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  return !fresh && pdfIsCurrent(inv, db.settings) ? pdfPath(inv) : makePdf(inv);
}

const server = http.createServer(async (req, res) => {
  try {
    // Only answer requests addressed to this machine (blocks DNS-rebinding tricks).
    const hostname = (req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost'].includes(hostname)) throw new HttpError(403, 'Forbidden host');

    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      // Custom header can't be sent cross-site without a CORS preflight, which we never approve.
      if (req.method !== 'GET' && req.headers['x-cwinvoicer'] !== '1') throw new HttpError(403, 'Missing app header');
      return await handleApi(req, res, url);
    }

    const inv = /^\/invoice\/([\w-]+)$/.exec(url.pathname);
    if (inv) {
      const db = loadAll();
      const invoice = db.invoices.find((i) => i.id === inv[1]);
      if (!invoice) throw new HttpError(404, 'Invoice not found');
      return send(res, 200, renderInvoice(invoice, db.settings, { autoPrint: url.searchParams.has('print') }), 'text/html; charset=utf-8');
    }

    if (url.pathname === '/logo') {
      const { logoFile } = loadAll().settings;
      if (!logoFile) throw new HttpError(404, 'No logo');
      return sendFile(res, path.join(DATA, logoFile));
    }

    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = path.join(PUBLIC, rel);
    if (!target.startsWith(PUBLIC + path.sep)) throw new HttpError(403, 'Forbidden');
    return sendFile(res, target);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    send(res, status, { error: e.message });
  }
});

/**
 * Starts the server. Resolves with the port it's listening on.
 * @param {object} opts { port (0 = any free port), dataDir, renderPdf, revealFile }
 */
function start(opts = {}) {
  PORT = opts.port ?? PORT;
  DATA = path.resolve(opts.dataDir || DATA);
  PDF_DIR = path.join(DATA, 'pdfs');
  if (opts.renderPdf) renderPdf = opts.renderPdf;
  if (opts.revealFile) revealFile = opts.revealFile;
  fs.mkdirSync(PDF_DIR, { recursive: true });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, () => {
      PORT = server.address().port;
      resolve(PORT);
    });
  });
}

const stop = () => new Promise((resolve) => server.close(resolve));

module.exports = { start, stop, pdfFor, dataDir: () => DATA };

/** The desktop app's data folder (from its config.json), so browser mode uses the same data. */
function appDataDir() {
  const support = path.join(os.homedir(), 'Library', 'Application Support', 'CW Invoicer');
  try {
    const { dataDir } = JSON.parse(fs.readFileSync(path.join(support, 'config.json'), 'utf8'));
    if (dataDir) return dataDir;
  } catch {}
  return path.join(support, 'data');
}

if (require.main === module) {
  const open = process.argv.includes('--open');
  const port = Number(process.env.PORT) || 4242;
  start({ port, dataDir: process.env.CWINVOICER_DATA || appDataDir() })
    .then(() => {
      console.log(`CW Invoicer running at http://localhost:${PORT}`);
      console.log(`Data directory: ${DATA}`);
      if (open) execFile('open', [`http://localhost:${PORT}`]);
    })
    .catch((e) => {
      if (e.code !== 'EADDRINUSE') throw e;
      console.log(`CW Invoicer already seems to be running on port ${port}.`);
      if (open) execFile('open', [`http://localhost:${port}`]);
      process.exit(0);
    });
}
