// Saved invoice PDFs: made on demand, reused while current.
import { execFile } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Invoice, Settings } from '../shared/types';
import { HOST, config, pdfDir } from './config';
import { file, loadAll } from './storage';
import { HttpError } from './util';

const pdfPath = (inv: Pick<Invoice, 'number'>) => path.join(pdfDir(), `Invoice_${inv.number}.pdf`);
const TEMPLATE_FILE = path.join(__dirname, 'invoice-template.js');
const mtime = (p: string) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};

/** A saved PDF is current if it is newer than the invoice, the settings, the logo and the template. */
function pdfIsCurrent(inv: Invoice, settings: Settings): boolean {
  const made = mtime(pdfPath(inv));
  if (!made) return false;
  const inputs = [Date.parse(inv.updatedAt || inv.createdAt || '') || 0, mtime(file('settings')), mtime(TEMPLATE_FILE)];
  if (settings.logoFile) inputs.push(mtime(path.join(config.dataDir, settings.logoFile)));
  return inputs.every((t) => made >= t);
}

export function removePdf(inv: Pick<Invoice, 'number'>): void {
  fs.rmSync(pdfPath(inv), { force: true });
}

/** Returns the path of an invoice's PDF, making it first if it is missing or out of date (or if `fresh`). */
export async function pdfFor(id: string, fresh = false): Promise<string> {
  const db = loadAll();
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  return !fresh && pdfIsCurrent(inv, db.settings) ? pdfPath(inv) : makePdf(inv);
}

// ---------- rendering ----------

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
].filter((p): p is string => !!p);
export const findChrome = () => CHROME_CANDIDATES.find((p) => fs.existsSync(p));

// One render per invoice at a time; a second request for the same PDF waits for the first.
const rendering = new Map<string, Promise<string>>();
function makePdf(inv: Invoice): Promise<string> {
  let job = rendering.get(inv.id);
  if (!job) {
    job = renderToFile(inv).finally(() => rendering.delete(inv.id));
    rendering.set(inv.id, job);
  }
  return job;
}

// Renders to a temporary file and renames it over the old PDF only on success, so a failed
// or timed-out render never leaves the previous PDF looking like a fresh one.
async function renderToFile(inv: Invoice): Promise<string> {
  fs.mkdirSync(pdfDir(), { recursive: true });
  const out = pdfPath(inv);
  const tmp = path.join(pdfDir(), `.Invoice_${inv.number}.${crypto.randomUUID()}.pdf`);
  try {
    await renderWith(`http://${HOST}:${config.port}/invoice/${inv.id}`, tmp);
    fs.renameSync(tmp, out);
    return out;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function renderWith(url: string, out: string): Promise<void> {
  if (config.renderPdf) {
    try {
      return await config.renderPdf(url, out);
    } catch (e) {
      throw new HttpError(500, `PDF export failed: ${(e as Error).message}`);
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
