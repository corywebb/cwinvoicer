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
  return db;
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

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
    for (const entryId of sources?.[t] || []) {
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
    date: body.date || today(),
    dueDate: body.dueDate || null,
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
  const now = new Date().toISOString();
  const sources = Object.fromEntries(ENTRY_TYPES.map((t) => [t, entries[t].map((e) => e.id)]));
  const invoice = { id, ...draft, sources, status: 'unpaid', paidDate: null, createdAt: now };
  for (const t of ENTRY_TYPES) {
    if (!entries[t].length) continue;
    for (const e of entries[t]) {
      // Lock in the hourly rate so later rate changes never alter a billed invoice.
      if (t === 'time') e.billedRate = timeRate(e, db);
      Object.assign(e, { invoiceId: id, invoicedAt: now });
    }
    save(t, db[t]);
  }
  db.invoices.push(invoice);
  save('invoices', db.invoices);
  return invoice;
}

function invoiceNumber(db, id) {
  return db.invoices.find((i) => i.id === id)?.number ?? '?';
}

function updateInvoice(id, body) {
  const db = loadAll();
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  for (const k of ['date', 'dueDate', 'paidDate']) {
    if (!(k in body)) continue;
    if (body[k] && !/^\d{4}-\d{2}-\d{2}$/.test(body[k])) throw new HttpError(400, `${k} must be a date`);
    inv[k] = body[k] || null;
  }
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
  inv.updatedAt = new Date().toISOString();
  save('invoices', db.invoices);
  removePdf(inv);
  return inv;
}

function deleteInvoice(id) {
  const db = loadAll();
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  for (const t of ENTRY_TYPES) {
    let changed = false;
    for (const e of db[t]) {
      if (e.invoiceId === id) {
        e.invoiceId = null;
        e.invoicedAt = null;
        delete e.billedRate;
        changed = true;
      }
    }
    if (changed) save(t, db[t]);
  }
  save('invoices', db.invoices.filter((i) => i !== inv));
  removePdf(inv);
}

const pdfPath = (inv) => path.join(PDF_DIR, `Invoice_${inv.number}.pdf`);
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

async function makePdf(inv) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
  const out = pdfPath(inv);
  const url = `http://${HOST}:${PORT}/invoice/${inv.id}`;
  if (renderPdf) {
    try {
      await renderPdf(url, out);
      return out;
    } catch (e) {
      throw new HttpError(500, `PDF export failed: ${e.message}`);
    }
  }
  const chrome = findChrome();
  if (!chrome) throw new HttpError(501, 'No Chrome-based browser found for PDF export. Use Print → Save as PDF instead.');
  const profile = path.join(os.tmpdir(), 'cwinvoicer-chrome');
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
      if (fs.existsSync(out)) return resolve(out);
      reject(new HttpError(500, `PDF export failed: ${err?.message || stderr}`));
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

  if (method === 'GET' && first === 'state') {
    const db = loadAll();
    return send(res, 200, { ...db, nextInvoiceNumber: nextInvoiceNumber(db), dataDir: DATA, pdfAvailable: !!(renderPdf || findChrome()) });
  }
  if (first === 'settings' && method === 'PUT') {
    const db = loadAll();
    const settings = clean('settings', await readJson(req), db.settings, db);
    if (settings.startingInvoiceNumber < 1) throw new HttpError(400, 'Starting invoice number must be positive');
    save('settings', settings);
    return send(res, 200, settings);
  }
  if (first === 'logo' && method === 'POST') {
    const { dataUrl } = await readJson(req);
    const db = loadAll();
    if (db.settings.logoFile) fs.rmSync(path.join(DATA, db.settings.logoFile), { force: true });
    if (dataUrl) {
      const m = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,(.+)$/.exec(dataUrl);
      if (!m) throw new HttpError(400, 'Logo must be a PNG, JPG, GIF, WebP or SVG image');
      const ext = m[1] === 'svg+xml' ? 'svg' : m[1].replace('jpeg', 'jpg');
      db.settings.logoFile = `logo.${ext}`;
      fs.writeFileSync(path.join(DATA, db.settings.logoFile), Buffer.from(m[2], 'base64'));
    } else {
      db.settings.logoFile = null;
    }
    save('settings', db.settings);
    return send(res, 200, db.settings);
  }

  if (first === 'invoices') {
    if (method === 'POST' && id === 'preview') {
      const db = loadAll();
      const body = await readJson(req);
      const draft = buildInvoice(db, body, collectEntries(db, body.clientId, body.sources, { forPreview: true }));
      return send(res, 200, renderInvoice(draft, db.settings), 'text/html; charset=utf-8');
    }
    if (method === 'POST' && !id) return send(res, 201, createInvoice(await readJson(req)));
    if (method === 'PUT' && id) return send(res, 200, updateInvoice(id, await readJson(req)));
    if (method === 'DELETE' && id) {
      deleteInvoice(id);
      return send(res, 200, { ok: true });
    }
    if (id && (action === 'pdf' || action === 'reveal')) {
      const inv = loadAll().invoices.find((i) => i.id === id);
      if (!inv) throw new HttpError(404, 'Invoice not found');
      const out = await pdfFor(inv.id, url.searchParams.get('fresh') === '1');
      if (action === 'reveal') {
        revealFile(out);
        return send(res, 200, { ok: true, path: out });
      }
      const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
      return sendFile(res, out, { 'Content-Disposition': `${disposition}; filename="${path.basename(out)}"` });
    }
  }

  if (['clients', 'projects', ...ENTRY_TYPES].includes(first)) {
    const db = loadAll();
    const list = db[first];
    const body = method === 'GET' ? null : await readJson(req);

    if (method === 'POST' && !id) {
      const now = new Date().toISOString();
      const record = { id: crypto.randomUUID(), ...clean(first, body, {}, db), createdAt: now };
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
      list[idx] = { ...clean(first, body, record, db), updatedAt: new Date().toISOString() };
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

/** Returns the path of an invoice's PDF, making it first if needed (or if `fresh`). */
async function pdfFor(id, fresh = false) {
  const inv = loadAll().invoices.find((i) => i.id === id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  return fs.existsSync(pdfPath(inv)) && !fresh ? pdfPath(inv) : makePdf(inv);
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

module.exports = { start, pdfFor, dataDir: () => DATA };

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
