// One place for the hidden, sandboxed window used to render invoices for PDF and print.
// If the page fails to load, the window is destroyed before the error is rethrown.
module.exports = async function loadHidden(BrowserWindow, url) {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await w.loadURL(url);
    return w;
  } catch (error) {
    if (!w.isDestroyed()) w.destroy();
    throw error;
  }
};
