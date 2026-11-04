// CW Invoicer desktop app: runs the local server in-process and shows it in a native window.
import { BrowserWindow, Menu, type MenuItemConstructorOptions, type Rectangle, app, dialog, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { errorMessage } from '../shared/errors';
import type { EntryType } from '../shared/types';
import * as server from '../server';
import { loadHidden } from './hidden-window';
import { printInvoice as printInvoicePage } from './print-invoice';

// Same support folder in development and in the packaged app. The server doesn't read it
// until start(), so setting it here, after the imports load, is early enough.
app.setPath('userData', path.join(app.getPath('appData'), 'CW Invoicer'));

interface AppConfig {
  /** A data folder chosen with File → Choose Data Folder…. */
  dataDir?: string;
  windowBounds?: Rectangle;
}

const CONFIG = path.join(app.getPath('userData'), 'config.json');
const readConfig = (): AppConfig => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch {
    return {};
  }
};
const writeConfig = (patch: AppConfig) => {
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify({ ...readConfig(), ...patch }, null, 2) + '\n');
};
const dataDir = () => process.env.CWINVOICER_DATA || readConfig().dataDir || path.join(app.getPath('userData'), 'data');

let baseUrl = '';
let win: BrowserWindow | null = null;

// ---------- PDF + printing (Electron's own Chromium, no Google Chrome needed) ----------

async function renderPdf(url: string, outPath: string): Promise<void> {
  const w = await loadHidden(BrowserWindow, url);
  try {
    const pdf = await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(outPath, pdf);
  } finally {
    w.destroy();
  }
}

async function printInvoice(id: string): Promise<void> {
  await printInvoicePage(`${baseUrl}/invoice/${id}`, { BrowserWindow, dialog });
}

async function openPdf(id: string): Promise<void> {
  try {
    const file = await server.pdfFor(id);
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
  } catch (e) {
    dialog.showErrorBox('Could not open PDF', errorMessage(e));
  }
}

// ---------- window ----------

/** Runs code in the page once the app (and its state) has loaded. The page exposes `CWInvoicer` for this. */
function inPage(code: string): void {
  const w = showWindow();
  const run = () =>
    w.webContents.executeJavaScript(`(async () => { while (!window.CWInvoicer?.loaded) await new Promise((r) => setTimeout(r, 50)); ${code} })()`);
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', run);
  else run();
}
const go = (hash: string) => inPage(`location.hash = ${JSON.stringify(hash)};`);
const addEntry = (type: EntryType) => inPage(`if (await CWInvoicer.editEntry(${JSON.stringify(type)})) CWInvoicer.render();`);

function handleLink(url: string): void {
  const u = new URL(url);
  if (u.origin !== baseUrl) {
    shell.openExternal(url);
    return;
  }
  let m;
  if ((m = /^\/api\/invoices\/([\w-]+)\/pdf$/.exec(u.pathname)) && u.searchParams.get('download') !== '1') return void openPdf(m[1]);
  if ((m = /^\/invoice\/([\w-]+)$/.exec(u.pathname)) && u.searchParams.has('print')) return void printInvoice(m[1]);
  shell.openExternal(url);
}

function createWindow(): BrowserWindow {
  const bounds = readConfig().windowBounds || { width: 1360, height: 900 };
  const w = new BrowserWindow({
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
  w.webContents.setWindowOpenHandler(({ url }) => {
    handleLink(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (ev, url) => {
    if (new URL(url).origin === baseUrl) return;
    ev.preventDefault();
    shell.openExternal(url);
  });
  w.once('ready-to-show', () => w.show());
  w.on('close', () => writeConfig({ windowBounds: w.getBounds() }));
  w.on('closed', () => (win = null));
  w.loadURL(`${baseUrl}/`);
  return (win = w);
}

function showWindow(): BrowserWindow {
  if (!win) return createWindow();
  win.show();
  return win;
}

// ---------- data folder ----------

async function chooseDataFolder(): Promise<void> {
  const current = dataDir();
  const options = {
    title: 'Choose Data Folder',
    message: 'Choose where CW Invoicer keeps its data (JSON files, logo and PDFs).',
    properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
    defaultPath: current,
  };
  const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (canceled || !filePaths[0] || path.resolve(filePaths[0]) === path.resolve(current)) return;
  const target = filePaths[0];
  if (!fs.existsSync(path.join(target, 'settings.json'))) {
    const question = {
      type: 'question' as const,
      message: 'This folder has no CW Invoicer data. Copy your current data into it?',
      detail: `Current data folder:\n${current}`,
      buttons: ['Copy Data', 'Start Empty', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    };
    const { response } = win ? await dialog.showMessageBox(win, question) : await dialog.showMessageBox(question);
    if (response === 2) return;
    if (response === 0) fs.cpSync(current, target, { recursive: true });
  }
  writeConfig({ dataDir: target });
  app.relaunch();
  app.exit(0);
}

// ---------- menu ----------

function buildMenu(): void {
  const nav: MenuItemConstructorOptions[] = ([
    ['Dashboard', '#/', 'CmdOrCtrl+1'],
    ['Time', '#/time', 'CmdOrCtrl+2'],
    ['Line Items', '#/items', 'CmdOrCtrl+3'],
    ['Expenses', '#/expenses', 'CmdOrCtrl+4'],
    ['Invoices', '#/invoices', 'CmdOrCtrl+5'],
    ['Clients & Projects', '#/clients', 'CmdOrCtrl+6'],
  ] as const).map(([label, hash, accelerator]) => ({ label, accelerator, click: () => go(hash) }));

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
      dialog.showErrorBox('CW Invoicer could not start', (e as Error).stack || errorMessage(e));
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
