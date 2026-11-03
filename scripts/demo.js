#!/usr/bin/env node
// A disposable workspace for screenshots and exploration. Never reads the app's config.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../server');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwinvoicer-demo-'));
process.on('exit', () => fs.rmSync(dataDir, { recursive: true, force: true }));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

async function main() {
  const port = await start({ port: 0, dataDir });
  const base = `http://127.0.0.1:${port}`;
  const api = async (method, route, body) => {
    const response = await fetch(`${base}/api/${route}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-CWInvoicer': '1' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };
  const date = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA');
  };
  await api('PUT', 'settings', {
    businessName: 'Fieldwork Studio', businessDetails: 'Independent design & development\nhello@example.com',
    startingInvoiceNumber: 1042, defaultRate: 125, defaultTerms: 'Net 15', dueDays: 15,
  });
  const clients = [];
  for (const [name, projectName, rate] of [
    ['Northstar Coffee', 'Website refresh', 125],
    ['Juniper & Co.', 'Brand identity', 150],
    ['Forma Architecture', 'Portfolio website', 125],
  ]) {
    const client = await api('POST', 'clients', { name, rate, email: 'client@example.com' });
    const project = await api('POST', 'projects', { name: projectName, clientId: client.id });
    clients.push({ client, project });
  }
  for (const [i, { client, project }] of clients.entries()) {
    const entry = await api('POST', 'time', {
      clientId: client.id, projectId: project.id, date: date(-24 + i * 9),
      description: ['Discovery & design direction', 'Visual identity system', 'Development milestone'][i], hours: [12, 16, 8][i],
    });
    const invoice = await api('POST', 'invoices', {
      clientId: client.id, date: entry.date, dueDate: date(-9 + i * 9), terms: 'Net 15',
      sources: { time: [entry.id] }, notes: 'Thank you for the collaboration.',
    });
    if (i === 1) await api('PUT', `invoices/${invoice.id}`, { status: 'paid', paidDate: date(-3) });
    await api('POST', 'time', {
      clientId: client.id, projectId: project.id, date: date(-2 + i),
      description: ['Responsive layouts & development', 'Brand guidelines & handoff', 'Project discovery & wireframes'][i], hours: [6.5, 4, 3.5][i],
    });
  }
  await api('POST', 'expenses', {
    clientId: clients[0].client.id, projectId: clients[0].project.id,
    date: date(-1), description: 'Licensed photography', amount: 85,
  });
  console.log(`Demo ready: ${base}\nSynthetic data only. Changes are discarded when you stop this process.\nPress Ctrl+C to stop.`);
}
main().catch((error) => { console.error(error); process.exit(1); });
