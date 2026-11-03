const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildLines, timeRate } = require('../public/lines');
const { renderInvoice } = require('../lib/invoice-template');
const db = {
  settings: { defaultRate: 100 }, clients: [{ id: 'c', rate: 120 }],
  projects: [{ id: 'p', name: 'Website', rate: 150 }],
};

test('rate precedence preserves explicit zero and the billed rate', () => {
  const e = { clientId: 'c', projectId: 'p' };
  assert.equal(timeRate({}, db), 100);
  assert.equal(timeRate({ clientId: 'c' }, db), 120);
  assert.equal(timeRate(e, db), 150);
  assert.equal(timeRate({ ...e, rate: 0 }, db), 0);
  assert.equal(timeRate({ ...e, rate: 175, billedRate: 0 }, db), 0);
});

test('summary keeps different rates separate and combines project extras', () => {
  const lines = buildLines({
    time: [
      { id: 't1', projectId: 'p', hours: 2, rate: 100 },
      { id: 't2', projectId: 'p', hours: 1.5, rate: 120 },
    ],
    items: [{ id: 'i', projectId: 'p', qty: 2, rate: 25 }],
    expenses: [{ id: 'e', projectId: 'p', amount: 19.95 }],
  }, db);
  assert.deepEqual(lines.map((l) => l.amount), [200, 180, 69.95]);
  assert.equal(lines[2].description, 'Website – items & expenses');
});

test('detailed lines sort work within projects and place unassigned work last', () => {
  const lines = buildLines({ format: 'detailed',
    time: [
      { id: 'none', date: '2026-01-01', hours: 1, description: 'Consulting' },
      { id: 'later', projectId: 'p', date: '2026-01-03', hours: 2, description: 'Build' },
      { id: 'early', projectId: 'p', date: '2026-01-02', hours: 1, description: 'Design' },
    ], overrides: { 'time:early': 'Design review' },
  }, db);
  assert.deepEqual(lines.map((l) => l.description), ['Website', 'Design review', 'Build', 'Other', 'Consulting']);
  assert.equal(lines.filter((l) => l.type === 'heading').reduce((sum, l) => sum + l.amount, 0), 0);
});

test('invoice HTML escapes user text and omits an absent logo', () => {
  const html = renderInvoice({ number: 42, date: '2026-01-01', billTo: { name: '<script>alert(1)</script>' },
    notes: 'First line\nSecond & last', lines: [{ description: '<img onerror=alert(1)>', qty: 1, rate: 25, amount: 25 }],
  }, { businessName: 'A & B', businessDetails: '', logoFile: null });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img onerror=alert(1)&gt;'));
  assert.ok(html.includes('First line<br>Second &amp; last'));
  assert.ok(html.includes('$25.00'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('src="/logo"'));
});
