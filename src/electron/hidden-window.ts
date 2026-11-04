// One place for the hidden, sandboxed window used to render invoices for PDF and print.
// If the page fails to load, the window is destroyed before the error is rethrown.
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';

/** Electron's BrowserWindow class, passed in so tests can supply a fake. */
export type WindowClass = new (options: BrowserWindowConstructorOptions) => BrowserWindow;

export async function loadHidden(Window: WindowClass, url: string): Promise<BrowserWindow> {
  const w = new Window({ show: false, webPreferences: { sandbox: true } });
  try {
    await w.loadURL(url);
    return w;
  } catch (error) {
    if (!w.isDestroyed()) w.destroy();
    throw error;
  }
}
