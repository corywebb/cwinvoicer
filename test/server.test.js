const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');

test('invoice lifecycle in an isolated data folder', { timeout: 20000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwinvoicer-test-'));
  const child = spawn(process.execPath, ['-e',
    "require('./server').start({ port: 0, dataDir: process.env.CWINVOICER_DATA }).then(port => process.send(port))"],
  { cwd: path.resolve(__dirname, '..'), env: { ...process.env, CWINVOICER_DATA: dataDir }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      child.kill();
      await exit;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const [port] = await once(child, 'message', { signal: AbortSignal.timeout(5000) });
  const base = `http://127.0.0.1:${port}`;
  const request = async (method, route, body, expected = 200) => {
    const response = await fetch(`${base}/api/${route}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-CWInvoicer': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  };
  await t.test('writes require the app header', async () => {
    const response = await fetch(`${base}/api/clients`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 403);
  });
  const client = await request('POST', 'clients', { name: 'Example client', rate: 125 }, 201);
  const other = await request('POST', 'clients', { name: 'Other client' }, 201);
  const entry = await request('POST', 'time', { clientId: client.id, date: '2026-01-01', description: 'Design', hours: 2 }, 201);
  let invoice;
  await t.test('rejects empty and cross-client invoices', async () => {
    await request('POST', 'invoices', { clientId: client.id, sources: {} }, 400);
    await request('POST', 'invoices', { clientId: other.id, sources: { time: [entry.id] } }, 400);
  });
  await t.test('invoice dates must be YYYY-MM-DD', async () => {
    for (const date of [20260101, 'Jan 1 2026', '2026-1-1']) {
      await request('POST', 'invoices', { clientId: client.id, date, sources: { time: [entry.id] } }, 400);
      await request('POST', 'invoices/preview', { clientId: client.id, date, sources: { time: [entry.id] } }, 400);
    }
    await request('POST', 'invoices', { clientId: client.id, dueDate: 'soon', sources: { time: [entry.id] } }, 400);
    assert.equal((await request('GET', 'state')).time[0].invoiceId, null, 'a rejected invoice bills nothing');
  });
  await t.test('creating an invoice locks entries against rebilling and editing', async () => {
    invoice = await request('POST', 'invoices', { clientId: client.id, sources: { time: [entry.id] } }, 201);
    assert.equal(invoice.total, 250);
    assert.equal(invoice.number, 1242);
    await request('POST', 'invoices', { clientId: client.id, sources: { time: [entry.id] } }, 409);
    await request('PUT', `time/${entry.id}`, { hours: 99 }, 409);
    await request('DELETE', `time/${entry.id}`, undefined, 409);
  });
  await t.test('reformatting preserves billed rates after client rate changes', async () => {
    await request('PUT', `clients/${client.id}`, { rate: 999 });
    const updated = await request('PUT', `invoices/${invoice.id}`, { format: 'detailed' });
    assert.equal(updated.total, 250);
    assert.equal(updated.lines.find((l) => l.type === 'time').rate, 125);
  });
  await t.test('paid and unpaid transitions manage the payment date', async () => {
    const paid = await request('PUT', `invoices/${invoice.id}`, { status: 'paid' });
    assert.match(paid.paidDate, /^\d{4}-\d{2}-\d{2}$/);
    const unpaid = await request('PUT', `invoices/${invoice.id}`, { status: 'unpaid' });
    assert.equal(unpaid.paidDate, null);
  });
  await t.test('deleting an invoice releases its work for billing again', async () => {
    await request('DELETE', `invoices/${invoice.id}`);
    const state = await request('GET', 'state');
    assert.equal(state.invoices.length, 0);
    assert.equal(state.time[0].invoiceId, null);
    assert.equal(state.time[0].billedRate, undefined);
    assert.equal(state.nextInvoiceNumber, 1242);
  });
  await t.test('listing an entry twice bills it once', async () => {
    const c = await request('POST', 'clients', { name: 'Duplicate check', rate: 100 }, 201);
    const e = await request('POST', 'time', { clientId: c.id, date: '2026-01-02', description: 'Once', hours: 1 }, 201);
    const preview = await fetch(`${base}/api/invoices/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CWInvoicer': '1' },
      body: JSON.stringify({ clientId: c.id, sources: { time: [e.id, e.id] } }),
    }).then((r) => r.text());
    assert.equal(preview.split('Once').length - 1, 1, 'preview lists the entry once');
    const inv = await request('POST', 'invoices', { clientId: c.id, sources: { time: [e.id, e.id] } }, 201);
    assert.equal(inv.total, 100);
    assert.deepEqual(inv.sources.time, [e.id]);
    await request('DELETE', `invoices/${inv.id}`);
  });
  await t.test('overlapping saves both persist', async () => {
    // Open two requests, send headers only, then finish their bodies: each handler is
    // waiting on its body at the same time, as with two quick saves from the app.
    const start = (body) => {
      const payload = JSON.stringify(body);
      const req = http.request(`${base}/api/time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CWInvoicer': '1', 'Content-Length': Buffer.byteLength(payload) },
      });
      req.flushHeaders();
      const done = once(req, 'response').then(([res]) => { res.resume(); return res.statusCode; });
      return { finish: () => req.end(payload), done };
    };
    const a = start({ clientId: client.id, date: '2026-02-01', description: 'Overlap A', hours: 1 });
    const b = start({ clientId: client.id, date: '2026-02-01', description: 'Overlap B', hours: 1 });
    await new Promise((r) => setTimeout(r, 100));
    a.finish();
    b.finish();
    assert.deepEqual(await Promise.all([a.done, b.done]), [201, 201]);
    const { time } = await request('GET', 'state');
    assert.ok(time.some((e) => e.description === 'Overlap A'), 'A was saved');
    assert.ok(time.some((e) => e.description === 'Overlap B'), 'B was saved');
  });
  await t.test('a rejected logo upload keeps the current logo', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
    await request('POST', 'logo', { dataUrl: png });
    await request('POST', 'logo', { dataUrl: 'data:image/bmp;base64,Qk0=' }, 400);
    assert.equal((await request('GET', 'state')).settings.logoFile, 'logo.png');
    assert.equal((await fetch(`${base}/logo`)).status, 200);
    // Switching formats removes the old file; removing the logo removes the file.
    await request('POST', 'logo', { dataUrl: png.replace('image/png', 'image/gif') });
    assert.equal(fs.existsSync(path.join(dataDir, 'logo.png')), false);
    assert.equal(fs.existsSync(path.join(dataDir, 'logo.gif')), true);
    await request('POST', 'logo', { dataUrl: null });
    assert.equal(fs.existsSync(path.join(dataDir, 'logo.gif')), false);
  });
});
