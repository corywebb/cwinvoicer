// Turns time, line items and expenses into invoice lines.
// Shared by the browser (invoice builder) and the server (creating/re-formatting invoices).
(function (root) {
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || '');

  /** Effective hourly rate: rate locked in at billing, else entry override, else project, client, default. */
  function timeRate(e, db) {
    if (e.billedRate != null) return e.billedRate;
    if (e.rate != null) return e.rate;
    const project = db.projects.find((p) => p.id === e.projectId);
    const client = db.clients.find((c) => c.id === e.clientId);
    return project?.rate ?? client?.rate ?? db.settings.defaultRate;
  }

  /**
   * Detailed: one line per entry with its date and own description, grouped under a heading line per project
   * (oldest work first). Entries with no project come last, under "Other" when there are project groups too.
   * Summary: one line per project (time as hours × rate; a project's line items and expenses rolled into
   * one more line). Time with no project becomes one line; items/expenses with no project stay as-is.
   *
   * @param {object} opts { format: 'summary'|'detailed', overrides: {lineKey: description}, time, items, expenses }
   * @param {object} db   { clients, projects, settings }
   */
  function buildLines(opts, db) {
    const { format = 'summary', overrides = {} } = opts;
    const time = (opts.time || []).slice().sort(byDate);
    const others = [
      ...(opts.items || []).map((e) => ({ e, type: 'items', qty: e.qty, rate: e.rate })),
      ...(opts.expenses || []).map((e) => ({ e, type: 'expenses', qty: 1, rate: e.amount })),
    ].sort((a, b) => byDate(a.e, b.e));
    const projectName = (id) => db.projects.find((p) => p.id === id)?.name;
    const lines = [];

    if (format === 'detailed') {
      const all = [...time.map((e) => ({ e, type: 'time', qty: e.hours, rate: timeRate(e, db) })), ...others].sort((a, b) => byDate(a.e, b.e));
      const groups = new Map();
      for (const o of all) {
        const pid = o.e.projectId || '';
        if (!groups.has(pid)) groups.set(pid, []);
        groups.get(pid).push(o);
      }
      const order = [...groups.keys()].filter(Boolean);
      if (groups.has('')) order.push('');
      for (const pid of order) {
        if (pid || order.length > 1) lines.push({ key: `heading:${pid}`, type: 'heading', auto: projectName(pid) || 'Other' });
        for (const o of groups.get(pid))
          lines.push({ key: `${o.type}:${o.e.id}`, type: o.type, date: o.e.date, qty: o.qty, rate: o.rate, auto: o.e.description });
      }
    } else {
      const projectOrder = [...new Set([...time, ...others.map((o) => o.e)].sort(byDate).map((e) => e.projectId || ''))];
      const timeGroups = new Map();
      for (const e of time) {
        const rate = timeRate(e, db);
        const key = `time:${e.projectId || ''}:${rate}`;
        if (!timeGroups.has(key)) timeGroups.set(key, { key, type: 'time', projectId: e.projectId || '', qty: 0, rate, descs: new Set() });
        const g = timeGroups.get(key);
        g.qty = round2(g.qty + e.hours);
        g.descs.add(e.description);
      }
      const extras = new Map();
      for (const o of others.filter((x) => x.e.projectId)) {
        const key = `extras:${o.e.projectId}`;
        if (!extras.has(key)) extras.set(key, { key, type: o.type, projectId: o.e.projectId, qty: 1, rate: 0, types: new Set() });
        const g = extras.get(key);
        g.rate = round2(g.rate + o.qty * o.rate);
        g.types.add(o.type);
      }
      const emit = (projectId) => {
        for (const g of timeGroups.values()) {
          if (g.projectId !== projectId) continue;
          const auto = projectName(projectId) || (g.descs.size === 1 ? [...g.descs][0] : 'Professional services');
          lines.push({ key: g.key, type: 'time', qty: g.qty, rate: g.rate, auto });
        }
        const x = extras.get(`extras:${projectId}`);
        if (x) {
          const what = x.types.size > 1 ? 'items & expenses' : x.types.has('expenses') ? 'expenses' : 'additional items';
          lines.push({ key: x.key, type: x.types.size > 1 ? 'custom' : x.type, qty: 1, rate: x.rate, auto: `${projectName(projectId)} – ${what}` });
        }
      };
      projectOrder.filter(Boolean).forEach(emit);
      emit('');
      for (const o of others.filter((x) => !x.e.projectId))
        lines.push({ key: `${o.type}:${o.e.id}`, type: o.type, qty: o.qty, rate: o.rate, auto: o.e.description });
    }

    for (const l of lines) {
      l.description = overrides[l.key] ?? l.auto;
      if (l.type === 'heading') {
        l.amount = 0;
        continue;
      }
      l.rate = round2(l.rate);
      l.amount = round2(l.qty * l.rate);
    }
    return lines;
  }

  const api = { buildLines, timeRate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InvoiceLines = api;
})(this);
