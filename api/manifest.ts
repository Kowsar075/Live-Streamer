import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRewrittenManifest } from './_lib/handlers';
import { ProxyError } from './_lib/security';

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { contentType, body } = await getRewrittenManifest(firstParam(req.query.u));
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(body);
  } catch (e) {
    const status = e instanceof ProxyError ? e.status : 500;
    res.status(status).json({ error: e instanceof Error ? e.message : 'Proxy error' });
  }
}
