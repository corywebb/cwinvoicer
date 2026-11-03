const { test } = require('node:test');
const assert = require('node:assert/strict');
const printInvoice = require('../electron/print-invoice');

function fixture({ loadError, printError } = {}) {
  const errors = [];
  let callback;
  let options;
  let destroyed = false;
  let loaded;
  class BrowserWindow {
    async loadURL(url) {
      loaded = url;
      if (loadError) throw loadError;
    }
    webContents = {
      print(settings, done) {
        if (printError) throw printError;
        options = settings;
        callback = done;
      },
    };
    isDestroyed() { return destroyed; }
    destroy() { destroyed = true; }
  }
  return {
    dependencies: { BrowserWindow, dialog: { showErrorBox: (...args) => errors.push(args) } },
    errors,
    finish: (...args) => callback(...args),
    get options() { return options; },
    get destroyed() { return destroyed; },
    get loaded() { return loaded; },
  };
}

const url = 'http://127.0.0.1:1234/invoice/test';

test('printing requests a dialog and Letter paper, retaining its window until completion', async () => {
  const f = fixture();
  const pending = printInvoice(url, f.dependencies);
  await Promise.resolve();
  assert.equal(f.loaded, url);
  assert.deepEqual(f.options, { silent: false, printBackground: true, pageSize: 'Letter' });
  assert.equal(f.destroyed, false);
  f.finish(true);
  await pending;
  assert.equal(f.destroyed, true);
  assert.deepEqual(f.errors, []);
});

test('canceling the native print dialog closes the window without an error', async () => {
  const f = fixture();
  const pending = printInvoice(url, f.dependencies);
  await Promise.resolve();
  f.finish(false, 'Print job canceled');
  await pending;
  assert.equal(f.destroyed, true);
  assert.deepEqual(f.errors, []);
});

for (const reason of ['Invalid printer settings', '']) {
  test(`a print failure reports a PDF fallback and releases the window (${reason || 'no reason'})`, async () => {
    const f = fixture();
    const pending = printInvoice(url, f.dependencies);
    await Promise.resolve();
    f.finish(false, reason);
    await pending;
    assert.equal(f.destroyed, true);
    assert.equal(f.errors.length, 1);
    assert.equal(f.errors[0][0], 'Could not print invoice');
    assert.ok(f.errors[0][1].includes(reason || 'The printer did not accept the invoice.'));
    assert.ok(f.errors[0][1].includes('Open PDF'));
  });
}

for (const failure of ['loadError', 'printError']) {
  test(`${failure} is reported and the temporary window is destroyed`, async () => {
    const f = fixture({ [failure]: new Error('Test failure') });
    await printInvoice(url, f.dependencies);
    assert.equal(f.destroyed, true);
    assert.equal(f.errors.length, 1);
    assert.match(f.errors[0][1], /Test failure/);
  });
}
