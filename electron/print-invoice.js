// Keep the temporary invoice window alive until the native print dialog finishes.
module.exports = async function printInvoice(url, { BrowserWindow, dialog }) {
  let window;
  try {
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await window.loadURL(url);
    await new Promise((resolve, reject) => {
      window.webContents.print(
        { silent: false, printBackground: true, pageSize: 'Letter' },
        (success, reason) => {
          if (success || reason === 'Print job canceled') resolve();
          else reject(new Error(reason || 'The printer did not accept the invoice.'));
        },
      );
    });
  } catch (error) {
    dialog.showErrorBox('Could not print invoice',
      `${error.message}\n\nCheck your printer settings, or use Open PDF and print from your PDF viewer.`);
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
  }
};
