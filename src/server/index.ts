#!/usr/bin/env node
// CW Invoicer — local invoicing server. No dependencies; data lives in JSON files.
// Run directly (npm start) for browser mode; the desktop app and tests call start().
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { errorMessage } from '../shared/errors';
import { handleApi } from './api';
import { HOST, PUBLIC, type RenderPdf, config, pdfDir } from './config';
import { send, sendFile } from './http';
import { renderInvoice } from './invoice-template';
import { loadAll } from './storage';
import { HttpError } from './util';

export { pdfFor } from './pdf';

const server = http.createServer(async (req, res) => {
  try {
    // Only answer requests addressed to this machine (blocks DNS-rebinding tricks).
    const hostname = (req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost'].includes(hostname)) throw new HttpError(403, 'Forbidden host');

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
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
      return sendFile(res, path.join(config.dataDir, logoFile));
    }

    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = path.join(PUBLIC, rel);
    if (!target.startsWith(PUBLIC + path.sep)) throw new HttpError(403, 'Forbidden');
    return sendFile(res, target);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    send(res, status, { error: errorMessage(e) });
  }
});

export interface StartOptions {
  /** 0 picks any free port. */
  port?: number;
  dataDir?: string;
  renderPdf?: RenderPdf;
  revealFile?: (p: string) => void;
}

/** Starts the server. Resolves with the port it's listening on. */
export function start(opts: StartOptions = {}): Promise<number> {
  config.port = opts.port ?? config.port;
  config.dataDir = path.resolve(opts.dataDir || config.dataDir);
  if (opts.renderPdf) config.renderPdf = opts.renderPdf;
  if (opts.revealFile) config.revealFile = opts.revealFile;
  fs.mkdirSync(pdfDir(), { recursive: true });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, HOST, () => {
      config.port = (server.address() as AddressInfo).port;
      resolve(config.port);
    });
  });
}

export const stop = () => new Promise<void>((resolve) => server.close(() => resolve()));
export const dataDir = () => config.dataDir;

/** The desktop app's data folder (from its config.json), so browser mode uses the same data. */
function appDataDir(): string {
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
      console.log(`CW Invoicer running at http://localhost:${config.port}`);
      console.log(`Data directory: ${config.dataDir}`);
      if (open) execFile('open', [`http://localhost:${config.port}`]);
    })
    .catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'EADDRINUSE') throw e;
      console.log(`CW Invoicer already seems to be running on port ${port}.`);
      if (open) execFile('open', [`http://localhost:${port}`]);
      process.exit(0);
    });
}
