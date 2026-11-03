// Renders an invoice as a standalone, print-ready HTML document (US Letter).
// Used for the in-app preview, the browser print view, and headless-Chrome PDF export.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nl2br = (s) => esc(String(s ?? '').trim()).replace(/\r?\n/g, '<br>');

const money = (n) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Rates keep up to 4 decimals (0.125, 112.505) so qty × rate visibly equals the amount.
const rate = (n) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const qty = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const usDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
};

const CSS = `
  @page { size: letter; margin: 36pt 50pt 40pt 50pt; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 10pt; line-height: 1.3; color: #000;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  @media screen {
    body { background: #e9e9ec; padding: 24px 0; }
    .page { width: 8.5in; min-height: 11in; margin: 0 auto; padding: 36pt 50pt 40pt 50pt;
            background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.15); }
  }
  .head { display: flex; align-items: flex-start; }
  .logo { width: 190pt; flex: none; }
  .logo img { max-width: 180pt; max-height: 150pt; display: block; margin-top: 28pt; }
  .from { padding-top: 4pt; }
  .biz { font-size: 16pt; font-weight: bold; margin-bottom: 10pt; }
  .details { line-height: 13.6pt; }
  h1 { font-size: 22pt; line-height: 1; margin: 42pt 0 0; font-weight: bold; }
  .meta { display: flex; justify-content: space-between; margin-top: 52pt; padding: 0 0 6pt 6pt;
          border-bottom: 0.75pt solid #9db7df; }
  .label, .facts th { font-weight: bold; }
  .billto .label { margin-bottom: 1pt; }
  .facts { border-collapse: collapse; margin-right: 0; width: 202pt; }
  .facts th { text-align: right; padding: 0 11pt 7.5pt 0; white-space: nowrap; vertical-align: top; }
  .facts td { padding: 0 0 7.5pt 0; width: 122pt; vertical-align: top; }
  .facts tr:last-child th, .facts tr:last-child td { padding-bottom: 0; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 46pt; table-layout: fixed; }
  table.lines thead th { background: #dfe6ef; font-weight: bold; text-align: left;
                         padding: 4pt 6pt 3.5pt 6pt; }
  table.lines td { padding: 5pt 6pt 0 6pt; vertical-align: top; }
  table.lines tbody tr:last-child td { padding-bottom: 14pt; }
  table.lines .num { text-align: left; }
  table.lines .amt { text-align: right; padding-right: 11pt; }
  table.lines tr { page-break-inside: avoid; }
  table.lines tr.group td { font-weight: bold; padding-top: 11pt; }
  table.lines tbody tr.group:first-child td { padding-top: 6pt; }
  .col-desc { width: 272pt; } .col-qty { width: 73pt; } .col-rate { width: 95pt; }
  .total { display: grid; grid-template-columns: 240pt 1fr auto; align-items: baseline;
           border-top: 1px dotted #b0b0b0; padding: 5pt 5pt 0 0; font-weight: bold; font-size: 12.5pt;
           page-break-inside: avoid; }
  .total .lbl { grid-column: 2; }
  .notes { margin-top: 36pt; white-space: normal; }
  .notes .label { margin-bottom: 2pt; }
`;

/**
 * @param {object} inv  invoice (or draft) with number, date, dueDate, terms, billTo, lines, notes
 * @param {object} settings  app settings (fallback for business info when inv.from is missing)
 * @param {object} [opts] { logoUrl, hasLogo, autoPrint }
 */
function renderInvoice(inv, settings, opts = {}) {
  const from = inv.from || { businessName: settings.businessName, businessDetails: settings.businessDetails };
  const logoUrl = opts.logoUrl ?? '/logo';
  const hasLogo = opts.hasLogo ?? !!settings.logoFile;
  const lines = inv.lines || [];
  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);

  const rows = lines
    .map((l) =>
      l.type === 'heading'
        ? `<tr class="group"><td colspan="4">${nl2br(l.description)}</td></tr>`
        : `<tr>
        <td>${l.date ? `${usDate(l.date)} – ` : ''}${nl2br(l.description)}</td>
        <td class="num">${qty(l.qty)}</td>
        <td class="num">${rate(l.rate)}</td>
        <td class="amt">${money(l.amount)}</td>
      </tr>`
    )
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>Invoice_${esc(inv.number)}</title>
<style>${CSS}</style>
</head><body><div class="page">
  <header class="head${hasLogo ? '' : ' nologo'}">
    ${hasLogo ? `<div class="logo"><img src="${esc(logoUrl)}" alt=""></div>` : ''}
    <div class="from">
      <div class="biz">${esc(from.businessName)}</div>
      <div class="details">${nl2br(from.businessDetails)}</div>
    </div>
  </header>
  <h1>INVOICE</h1>
  <section class="meta">
    <div class="billto">
      <div class="label">BILL TO</div>
      <div>${nl2br([inv.billTo?.name, inv.billTo?.address].filter(Boolean).join('\n'))}</div>
    </div>
    <table class="facts">
      <tr><th>INVOICE #</th><td>${esc(inv.number)}</td></tr>
      <tr><th>DATE</th><td>${usDate(inv.date)}</td></tr>
      ${inv.dueDate ? `<tr><th>DUE DATE</th><td>${usDate(inv.dueDate)}</td></tr>` : ''}
      ${inv.terms ? `<tr><th>TERMS</th><td>${esc(inv.terms)}</td></tr>` : ''}
    </table>
  </section>
  <table class="lines">
    <colgroup><col class="col-desc"><col class="col-qty"><col class="col-rate"><col></colgroup>
    <thead><tr><th>DESCRIPTION</th><th>QTY</th><th>RATE</th><th class="amt">AMOUNT</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="total"><span class="lbl">BALANCE DUE</span><span>$${money(total)}</span></div>
  ${inv.notes ? `<div class="notes"><div class="label">NOTES</div>${nl2br(inv.notes)}</div>` : ''}
</div>
${opts.autoPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),150))</script>' : ''}
</body></html>`;
}

module.exports = { renderInvoice };
