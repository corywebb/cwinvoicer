// The /api/ routes.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';
import { errorMessage } from '../shared/errors';
import * as ledger from '../shared/ledger';
import type { EntryType } from '../shared/types';
import { config } from './config';
import { send, readJson, sendFile } from './http';
import { renderInvoice } from './invoice-template';
import { ENTRY_TYPES, buildInvoice, collectEntries, createInvoice, deleteInvoice, invoiceNumber, nextInvoiceNumber, updateInvoice } from './invoices';
import { recordClientEvent } from './log';
import { findChrome, pdfFor } from './pdf';
import { loadAll, save } from './storage';
import { HttpError, now, today } from './util';
import { type Body, clean } from './validate';

const RECORD_KINDS = ['clients', 'projects', ...ENTRY_TYPES] as const;
type RecordKind = (typeof RECORD_KINDS)[number];
const isRecordKind = (s: string | undefined): s is RecordKind => (RECORD_KINDS as readonly string[]).includes(s ?? '');
const isEntryType = (s: string): s is EntryType => (ENTRY_TYPES as string[]).includes(s);

/** What the generic record routes need to know about any record. */
type StoredRecord = { id: string; createdAt?: string; updatedAt?: string; invoiceId?: string | null };

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const [first, id, action] = url.pathname.split('/').slice(2); // after /api/
  const method = req.method;
  // Read the whole body before loading any data. Everything from loadAll() to save() below
  // then runs without an await, so overlapping requests can't save stale copies over each other.
  const body: Body = method === 'GET' ? {} : await readJson(req);

  if (method === 'GET' && first === 'state') {
    const db = loadAll();
    return send(res, 200, { ...db, nextInvoiceNumber: nextInvoiceNumber(db), dataDir: config.dataDir, pdfAvailable: !!(config.renderPdf || findChrome()) });
  }
  if (url.pathname === '/api/invoices/export.csv' && method === 'GET') {
    const db = loadAll();
    const asOf = today();
    let invoices;
    try {
      invoices = ledger.select(db.invoices, Object.fromEntries(url.searchParams), asOf);
    } catch (error) {
      throw new HttpError(400, errorMessage(error));
    }
    return send(res, 200, ledger.csv(invoices, asOf), 'text/csv; charset=utf-8', {
      'Content-Disposition': `attachment; filename="cwinvoicer-invoices-${asOf}.csv"`,
      'X-Content-Type-Options': 'nosniff',
    });
  }
  if (first === 'settings' && method === 'PUT') {
    const db = loadAll();
    const settings = { ...clean('settings', body, db.settings, db), updatedAt: now() };
    if (settings.startingInvoiceNumber < 1) throw new HttpError(400, 'Starting invoice number must be positive');
    save('settings', settings);
    return send(res, 200, settings);
  }
  if (first === 'logo' && method === 'POST') {
    const { dataUrl } = body;
    // Validate and write the new file before touching the old one, so a rejected upload
    // leaves the current logo in place.
    let newFile: string | null = null;
    if (dataUrl) {
      const m = typeof dataUrl === 'string' ? /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,(.+)$/.exec(dataUrl) : null;
      if (!m) throw new HttpError(400, 'Logo must be a PNG, JPG, GIF, WebP or SVG image');
      const ext = m[1] === 'svg+xml' ? 'svg' : m[1].replace('jpeg', 'jpg');
      newFile = `logo.${ext}`;
      fs.writeFileSync(path.join(config.dataDir, newFile), Buffer.from(m[2], 'base64'));
    }
    const db = loadAll();
    const oldFile = db.settings.logoFile;
    db.settings.logoFile = newFile;
    db.settings.updatedAt = now();
    save('settings', db.settings);
    if (oldFile && oldFile !== newFile) fs.rmSync(path.join(config.dataDir, oldFile), { force: true });
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
      recordClientEvent(id, body.event);
      return send(res, 200, { ok: true });
    }
    // Opening a PDF is a GET (it's a link). Revealing it in Finder must be a POST, so it
    // always carries the app header and another site can't trigger it.
    if (id && action === 'reveal') {
      if (method !== 'POST') throw new HttpError(405, 'Use POST');
      const out = await pdfFor(id);
      config.revealFile(out);
      return send(res, 200, { ok: true, path: out });
    }
    if (id && action === 'pdf') {
      if (method !== 'GET') throw new HttpError(405, 'Use GET');
      const out = await pdfFor(id, url.searchParams.get('fresh') === '1');
      const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
      return sendFile(res, out, { 'Content-Disposition': `${disposition}; filename="${path.basename(out)}"` });
    }
  }

  if (isRecordKind(first)) {
    const db = loadAll();
    const list: StoredRecord[] = db[first];

    if (method === 'POST' && !id) {
      const stamp = now();
      const record: StoredRecord = { id: crypto.randomUUID(), ...clean(first, body, {}, db), createdAt: stamp, updatedAt: stamp };
      if (isEntryType(first)) record.invoiceId = null;
      list.push(record);
      save(first, list);
      return send(res, 201, record);
    }

    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) throw new HttpError(404, 'Not found');
    const record = list[idx];

    if (isEntryType(first) && record.invoiceId && method !== 'GET')
      throw new HttpError(409, `This was billed on invoice #${invoiceNumber(db, record.invoiceId)}. Delete that invoice first to change it.`);

    if (method === 'PUT') {
      list[idx] = { ...clean(first, body, record, db), id: record.id, updatedAt: now() };
      save(first, list);
      return send(res, 200, list[idx]);
    }
    if (method === 'DELETE') {
      const owned = (lists: { clientId?: string; projectId?: string | null }[][], key: 'clientId' | 'projectId') =>
        lists.some((l) => l.some((r) => r[key] === id));
      if (first === 'clients' && owned([db.time, db.items, db.expenses, db.projects, db.invoices], 'clientId'))
        throw new HttpError(409, 'This client has projects, entries or invoices. Archive it instead.');
      if (first === 'projects' && owned([db.time, db.items, db.expenses], 'projectId'))
        throw new HttpError(409, 'This project has entries. Archive it instead.');
      list.splice(idx, 1);
      save(first, list);
      return send(res, 200, { ok: true });
    }
  }

  throw new HttpError(404, 'Unknown API route');
}
