// CW Invoicer desktop app: runs the local server in-process and shows it in a native window.
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const printInvoicePage = require('./print-invoice');
const loadHidden = require('./hidden-window');

// Same support folder in development and in the packaged app.
app.setPath('userData', path.join(app.getPath('appData'), 'CW Invoicer'));

const server = require('../server');

const CONFIG = path.join(app.getPath('userData'), 'config.json');
const readConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch {
    return {};
  }
};
const writeConfig = (patch) => {
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify({ ...readConfig(), ...patch }, null, 2) + '\n');
};
const dataDir = () => process.env.CWINVOICER_DATA || readConfig().dataDir || path.join(app.getPath('userData'), 'data');

let baseUrl = null;
let win = null;

// ---------- PDF + printing (Electron's own Chromium, no Google Chrome needed) ----------

async function renderPdf(url, outPath) {
  const w = await loadHidden(BrowserWindow, url);
  try {
    const pdf = await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(outPath, pdf);
  } finally {
    w.destroy();
  }
}

async function printInvoice(id) {
  await printInvoicePage(`${baseUrl}/invoice/${id}`, { BrowserWindow, dialog });
}

async function openPdf(id) {
  try {
    const file = await server.pdfFor(id);
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
  } catch (e) {
    dialog.showErrorBox('Could not open PDF', e.message);
  }
}

// ---------- window ----------

/** Runs code in the page once the app (and its state) has loaded. The page exposes `CWInvoicer` for this. */
function inPage(code) {
  showWindow();
  const run = () =>
    win.webContents.executeJavaScript(`(async () => { while (!window.CWInvoicer?.loaded) await new Promise((r) => setTimeout(r, 50)); ${code} })()`);
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', run);
  else run();
}
const go = (hash) => inPage(`location.hash = ${JSON.stringify(hash)};`);
const addEntry = (type) => inPage(`if (await CWInvoicer.editEntry(${JSON.stringify(type)})) CWInvoicer.render();`);

function handleLink(url) {
  const u = new URL(url);
  if (u.origin !== baseUrl) {
    shell.openExternal(url);
    return;
  }
  let m;
  if ((m = /^\/api\/invoices\/([\w-]+)\/pdf$/.exec(u.pathname)) && u.searchParams.get('download') !== '1') return openPdf(m[1]);
  if ((m = /^\/invoice\/([\w-]+)$/.exec(u.pathname)) && u.searchParams.has('print')) return printInvoice(m[1]);
  shell.openExternal(url);
}

function createWindow() {
  const bounds = readConfig().windowBounds || { width: 1360, height: 900 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    title: 'CW Invoicer',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#f6f6f4',
    show: false,
    webPreferences: { sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    handleLink(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (ev, url) => {
    if (new URL(url).origin === baseUrl) return;
    ev.preventDefault();
    shell.openExternal(url);
  });
  win.once('ready-to-show', () => win.show());
  win.on('close', () => writeConfig({ windowBounds: win.getBounds() }));
  win.on('closed', () => (win = null));
  win.loadURL(`${baseUrl}/`);
}

function showWindow() {
  if (!win) createWindow();
  else win.show();
}

// ---------- data folder ----------

async function chooseDataFolder() {
  const current = dataDir();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose Data Folder',
    message: 'Choose where CW Invoicer keeps its data (JSON files, logo and PDFs).',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: current,
  });
  if (canceled || !filePaths[0] || path.resolve(filePaths[0]) === path.resolve(current)) return;
  const target = filePaths[0];
  if (!fs.existsSync(path.join(target, 'settings.json'))) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      message: 'This folder has no CW Invoicer data. Copy your current data into it?',
      detail: `Current data folder:\n${current}`,
      buttons: ['Copy Data', 'Start Empty', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 2) return;
    if (response === 0) fs.cpSync(current, target, { recursive: true });
  }
  writeConfig({ dataDir: target });
  app.relaunch();
  app.exit(0);
}

// ---------- menu ----------

function buildMenu() {
  const nav = [
    ['Dashboard', '#/', 'CmdOrCtrl+1'],
    ['Time', '#/time', 'CmdOrCtrl+2'],
    ['Line Items', '#/items', 'CmdOrCtrl+3'],
    ['Expenses', '#/expenses', 'CmdOrCtrl+4'],
    ['Invoices', '#/invoices', 'CmdOrCtrl+5'],
    ['Clients & Projects', '#/clients', 'CmdOrCtrl+6'],
  ].map(([label, hash, accelerator]) => ({ label, accelerator, click: () => go(hash) }));

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => go('#/settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Invoice', accelerator: 'CmdOrCtrl+N', click: () => go('#/invoices/new') },
        { type: 'separator' },
        { label: 'Log Time…', accelerator: 'CmdOrCtrl+T', click: () => addEntry('time') },
        { label: 'Add Line Item…', accelerator: 'CmdOrCtrl+L', click: () => addEntry('items') },
        { label: 'Add Expense…', accelerator: 'CmdOrCtrl+E', click: () => addEntry('expenses') },
        { type: 'separator' },
        { label: 'Show Data Folder', click: () => shell.openPath(dataDir()) },
        { label: 'Choose Data Folder…', click: chooseDataFolder },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...nav,
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

// ---------- startup ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    try {
      const port = await server.start({
        port: 0,
        dataDir: dataDir(),
        renderPdf,
        revealFile: (p) => shell.showItemInFolder(p),
      });
      baseUrl = `http://127.0.0.1:${port}`;
    } catch (e) {
      dialog.showErrorBox('CW Invoicer could not start', e.stack || e.message);
      app.exit(1);
      return;
    }
    buildMenu();
    createWindow();
    app.on('activate', showWindow);
  });
  // Mac convention: closing the window keeps the app running; Cmd+Q quits.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
