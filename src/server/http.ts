// Response and request helpers.
import * as fs from 'node:fs';
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import * as path from 'node:path';
import { HttpError } from './util';
import type { Body } from './validate';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
};

/** Sends JSON (the default type), or a string/Buffer body for any other type. Never cached. */
export function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8', headers: OutgoingHttpHeaders = {}): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : (body as string | Buffer));
}

/** Reads a JSON object body (up to 15 MB, for logo uploads). An empty body is {}. */
export async function readJson(req: IncomingMessage): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 15e6) throw new HttpError(413, 'Request too large');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object');
  return body as Body;
}

export function sendFile(res: ServerResponse, filePath: string, headers: OutgoingHttpHeaders = {}): void {
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, { error: 'Not found' });
    send(res, 200, buf, MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', headers);
  });
}
