// Cloudflare Pages Function: GET /api/segment?u=<encoded origin URL>&h=<headers>
// Streams the origin response body straight through — on the Workers runtime
// that's just returning `new Response(originResponse.body, ...)`.

import { validateTargetUrl, ProxyError } from '../../api/_lib/security';
import { parseForwardHeaders } from '../../api/_lib/headers';
import { buildHeaders, guessContentType } from '../../api/_lib/http';
import { originFetch } from '../_lib/socketFetch';

interface Env {
  ALLOW_PRIVATE_HOSTS?: string;
}

const SEGMENT_TIMEOUT_MS = 30_000;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const params = new URL(request.url).searchParams;
  try {
    const target = validateTargetUrl(
      params.get('u') ?? undefined,
      env.ALLOW_PRIVATE_HOSTS === 'true',
    );
    const custom = parseForwardHeaders(params.get('h') ?? undefined);

    // Custom-port origins are reached over a raw socket (fetch drops the port).
    const { response: resp } = await originFetch(
      target,
      buildHeaders(custom),
      SEGMENT_TIMEOUT_MS,
    );
    if (!resp.ok && resp.status !== 206) {
      throw new ProxyError(502, `Origin returned HTTP ${resp.status} for a segment.`);
    }

    const headers = new Headers();
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set(
      'Content-Type',
      resp.headers.get('content-type') ?? guessContentType(target.pathname),
    );
    headers.set('Cache-Control', 'public, max-age=30');
    const len = resp.headers.get('content-length');
    if (len) headers.set('Content-Length', len);

    return new Response(resp.body, { status: resp.status, headers });
  } catch (e) {
    const status = e instanceof ProxyError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Proxy error';
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    });
  }
};
