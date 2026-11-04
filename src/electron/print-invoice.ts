// Keep the temporary invoice window alive until the native print dialog finishes.
import type { BrowserWindow, Dialog } from 'electron';
import { errorMessage } from '../shared/errors';
import { type WindowClass, loadHidden } from './hidden-window';

export async function printInvoice(url: string, { BrowserWindow, dialog }: { BrowserWindow: WindowClass; dialog: Pick<Dialog, 'showErrorBox'> }): Promise<void> {
  let win: BrowserWindow | undefined;
  try {
    win = await loadHidden(BrowserWindow, url);
    const contents = win.webContents;
    await new Promise<void>((resolve, reject) => {
      contents.print(
        { silent: false, printBackground: true, pageSize: 'Letter' },
        (success, reason) => {
          if (success || reason === 'Print job canceled') resolve();
          else reject(new Error(reason || 'The printer did not accept the invoice.'));
        },
      );
    });
  } catch (error) {
    dialog.showErrorBox('Could not print invoice',
      `${errorMessage(error)}\n\nCheck your printer settings, or use Open PDF and print from your PDF viewer.`);
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
}
