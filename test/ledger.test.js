const { test } = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../out/shared/ledger');
const today = '2026-03-15';
const invoices = [
  { number: 3, clientId: 'a', billTo: { name: 'Original name' }, date: '2026-03-01', dueDate: '2026-03-10', total: 10.10, status: 'unpaid' },
  { number: 2, clientId: 'a', date: '2026-02-28', dueDate: today, total: 20.20, status: 'unpaid' },
  { number: 1, clientId: 'b', date: '2026-02-01', dueDate: '2026-02-10', total: 30.30, status: 'paid', paidDate: '2026-03-01' },
];

test('ledger combines client, inclusive invoice dates, and status without mutating records', () => {
  const before = JSON.stringify(invoices);
  assert.deepEqual(ledger.select(invoices, { client: 'a', from: '2026-02-28', to: '2026-03-01', status: 'unpaid' }, today).map(i => i.number), [3, 2]);
  assert.deepEqual(ledger.select(invoices, { from: '2026-03-01', to: '2026-03-01' }, today).map(i => i.number), [3]);
  assert.deepEqual(ledger.select(invoices, { status: 'overdue' }, today).map(i => i.number), [3]);
  assert.deepEqual(ledger.select(invoices, { status: 'paid', from: '2026-03-01' }, today), []);
  assert.deepEqual(ledger.select(invoices, { client: 'missing' }, today), []);
  assert.equal(JSON.stringify(invoices), before);
});

test('ledger rejects impossible dates, reversed periods, and unknown status', () => {
  for (const filters of [{ from: '2026-02-30' }, { to: 'not-a-date' }, { from: '2026-04-01', to: '2026-03-01' }, { status: 'pending' }]) {
    assert.throws(() => ledger.select(invoices, filters, today));
  }
  assert.doesNotThrow(() => ledger.select(invoices, { from: '2024-02-29' }, today));
});

test('totals partition paid and outstanding; overdue is a subset and due today is not overdue', () => {
  assert.deepEqual(ledger.totals(invoices, today), { invoiced: 60.60, paid: 30.30, outstanding: 30.30, overdue: 10.10 });
  assert.deepEqual(ledger.totals([], today), { invoiced: 0, paid: 0, outstanding: 0, overdue: 0 });
});

test('CSV uses the billed client name, fixed decimals, escaped quotes, and multiline notes', () => {
  const csv = ledger.csv([{ ...invoices[0], billTo: { name: 'Café, "North"' }, notes: 'First line\nSecond line' }], today);
  assert.ok(csv.startsWith('\uFEFF"Invoice number"'));
  assert.ok(csv.includes('"Café, ""North"""'));
  assert.ok(csv.includes('"First line\nSecond line"'));
  assert.ok(csv.includes('"10.10","10.10"'));
  assert.ok(csv.endsWith('\r\n'));
  assert.equal(ledger.csv([], today).split('\r\n').length, 2);
});

test('CSV neutralizes spreadsheet formulas, including leading whitespace and control characters', () => {
  for (const name of ['=1+1', ' +1', '-1+2', '@SUM(A1)', '\t=1', '\r=1', '\n=1']) {
    assert.ok(ledger.csv([{ ...invoices[0], billTo: { name } }], today).includes(`"'${name}"`));
  }
  const csv = ledger.csv([invoices[2]], today);
  assert.ok(csv.includes('"paid","2026-03-01","30.30","0.00"'));
});

test('negative invoice amounts remain numeric spreadsheet cells', () => {
  const csv = ledger.csv([{ ...invoices[0], total: -12.50 }], today);
  assert.ok(csv.includes('"-12.50","-12.50"'));
});
