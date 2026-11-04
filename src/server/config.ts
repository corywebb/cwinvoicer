// Paths and runtime settings. start() fills in the port, data folder and desktop hooks.
import { execFile } from 'node:child_process';
import * as path from 'node:path';

export const HOST = '127.0.0.1';
/** The app root (this file is built to out/server/config.js). */
export const ROOT = path.resolve(__dirname, '..', '..');
export const PUBLIC = path.join(ROOT, 'public');

/** Renders the page at `url` to a PDF at `outPath`. */
export type RenderPdf = (url: string, outPath: string) => Promise<void>;

export const config = {
  port: 4242,
  dataDir: path.join(ROOT, 'data'),
  /** The desktop app's renderer; without it, PDFs use headless Chrome. */
  renderPdf: null as RenderPdf | null,
  /** Shows a file in Finder. */
  revealFile: (p: string): void => {
    execFile('open', ['-R', p]);
  },
};

export const pdfDir = () => path.join(config.dataDir, 'pdfs');
