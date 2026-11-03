const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

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
});
