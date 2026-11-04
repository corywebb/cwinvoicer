// Number, date and timestamp formatting.

export const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const money = (n: number | null | undefined) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const rateFmt = (n: number | null | undefined) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const qtyFmt = (n: number | null | undefined) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const usDate = (iso: string | null | undefined) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : '');
export const today = () => new Date().toLocaleDateString('en-CA');

export function addDays(iso: string, days: number | null | undefined): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toLocaleDateString('en-CA');
}

export const dateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

/** "Created Nov 3, 2026, 2:15 PM · Updated Nov 4, 2026, 9:02 AM". Records from before timestamps say so. */
export function stamps(r: { createdAt?: string; updatedAt?: string } | null | undefined): string {
  if (!r?.createdAt) return r?.updatedAt ? `Updated ${dateTime(r.updatedAt)} · created before timestamps were recorded` : 'Created before timestamps were recorded';
  const updated = r.updatedAt && r.updatedAt !== r.createdAt ? ` · Updated ${dateTime(r.updatedAt)}` : '';
  return `Created ${dateTime(r.createdAt)}${updated}`;
}

type Dated = { date?: string; createdAt?: string };
export const byDate = (a: Dated, b: Dated) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || '');

/** Accepts "1.5", "1:30", "90m", "2h". Returns hours as a number, or NaN. */
export function parseHours(input: unknown): number {
  const s = String(input ?? '').trim().toLowerCase();
  if (!s) return NaN;
  let m;
  if ((m = /^(\d+):(\d{1,2})$/.exec(s))) return round2(Number(m[1]) + Number(m[2]) / 60);
  if ((m = /^(\d+(?:\.\d+)?)\s*m(in)?$/.exec(s))) return round2(Number(m[1]) / 60);
  if ((m = /^(\d*(?:\.\d+)?)\s*h?$/.exec(s)) && m[1]) return Number(m[1]);
  return NaN;
}
