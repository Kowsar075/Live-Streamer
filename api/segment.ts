import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Readable } from 'node:stream';
import { getSegment } from './_lib/handlers';
import { ProxyError } from './_lib/security';

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { status, headers, body } = await getSegment(firstParam(req.query.u));
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.status(status);
    if (body) {
      // Stream the origin body straight through instead of buffering it.
      Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
    } else {
      res.end();
    }
  } catch (e) {
    const s = e instanceof ProxyError ? e.status : 500;
    res.status(s).json({ error: e instanceof Error ? e.message : 'Proxy error' });
  }
}
