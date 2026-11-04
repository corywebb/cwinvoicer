import { shell } from './dom';

/** Calls the local server. Writes carry the app header the server requires. Throws the server's error message. */
export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CWInvoicer': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get('Content-Type') || '';
  const data: unknown = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? data.error : data;
    throw new Error(String(error || res.statusText));
  }
  return data as T;
}

export { errorMessage } from '../shared/errors';

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, isError = false): void {
  const t = shell('#toast');
  t.textContent = msg;
  t.className = isError ? 'error' : '';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isError ? 6000 : 2500);
}
