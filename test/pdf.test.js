const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const server = require('../out/server');

// The server runs in-process with a fake renderer, so each test controls whether a render
// succeeds, fails or is slow, and can count how many renders happened.
test('PDF export', { timeout: 20000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwinvoicer-pdf-test-'));
  let mode = 'ok';
  let renders = 0;
  const revealed = [];
  const port = await server.start({
    port: 0,
    dataDir,
    renderPdf: async (_url, out) => {
      renders++;
      if (mode === 'slow') await new Promise((r) => setTimeout(r, 150));
      if (mode === 'fail') throw new Error('Renderer crashed');
      fs.writeFileSync(out, `%PDF render ${renders}`);
    },
    revealFile: (p) => revealed.push(p),
  });
  t.after(async () => {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const call = (method, route, body, headers = { 'X-CWInvoicer': '1' }) =>
    fetch(`${base}/api/${route}`, { method, headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (method, route, body) => {
    const r = await call(method, route, body);
    assert.ok(r.ok, `${method} ${route}: ${r.status}`);
    return r.json();
  };
  const pdf = async (query = '') => {
    const r = await call('GET', `invoices/${inv.id}/pdf${query}`);
    return { status: r.status, body: await r.text() };
  };
  const tick = () => new Promise((r) => setTimeout(r, 20)); // keep file times strictly ordered

  const client = await json('POST', 'clients', { name: 'PDF client', rate: 100 });
  const entry = await json('POST', 'time', { clientId: client.id, date: '2026-01-01', description: 'Work', hours: 1 });
  const inv = await json('POST', 'invoices', { clientId: client.id, sources: { time: [entry.id] } });

  await t.test('a saved PDF is reused until the invoice, settings or logo change', async () => {
    assert.equal((await pdf()).body, '%PDF render 1');
    assert.equal((await pdf()).body, '%PDF render 1');
    assert.equal(renders, 1);
    await tick();
    await json('PUT', `invoices/${inv.id}`, { notes: 'Changed' });
    assert.equal((await pdf()).body, '%PDF render 2');
    await tick();
    await json('PUT', 'settings', { businessName: 'Renamed' });
    assert.equal((await pdf()).body, '%PDF render 3');
    await tick();
    await json('POST', 'logo', { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' });
    assert.equal((await pdf()).body, '%PDF render 4');
    assert.equal((await pdf('?fresh=1')).body, '%PDF render 5');
  });

  await t.test('a failed render is an error, keeps the old PDF and leaves no temp files', async () => {
    mode = 'fail';
    const r = await pdf('?fresh=1');
    assert.equal(r.status, 500);
    assert.match(r.body, /Renderer crashed/);
    const files = fs.readdirSync(path.join(dataDir, 'pdfs'));
    assert.deepEqual(files, [`Invoice_${inv.number}.pdf`]);
    assert.equal(fs.readFileSync(path.join(dataDir, 'pdfs', files[0]), 'utf8'), '%PDF render 5');
    mode = 'ok';
  });

  await t.test('simultaneous requests share one render', async () => {
    mode = 'slow';
    const before = renders;
    const [a, b] = await Promise.all([pdf('?fresh=1'), pdf('?fresh=1&download=1')]);
    assert.equal(renders, before + 1);
    assert.deepEqual([a.status, b.status], [200, 200]);
    assert.equal(a.body, b.body);
    mode = 'ok';
  });

  await t.test('reveal needs a POST with the app header; the PDF link needs a GET', async () => {
    assert.equal((await call('GET', `invoices/${inv.id}/reveal`)).status, 405);
    assert.equal((await call('POST', `invoices/${inv.id}/reveal`, undefined, {})).status, 403);
    assert.equal(revealed.length, 0);
    assert.equal((await call('POST', `invoices/${inv.id}/reveal`)).status, 200);
    assert.deepEqual(revealed, [path.join(dataDir, 'pdfs', `Invoice_${inv.number}.pdf`)]);
    assert.equal((await call('POST', `invoices/${inv.id}/pdf`)).status, 405);
  });
});
