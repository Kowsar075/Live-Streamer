// Cloudflare Pages Function: GET /api/manifest?u=<encoded origin URL>&h=<headers>
// Runs on the Workers runtime (web APIs only — no Node). Reuses the same pure
// rewrite/security/header logic the local Node dev server uses.

import { validateTargetUrl, ProxyError } from '../../api/_lib/security';
import { rewriteManifest } from '../../api/_lib/rewrite';
import { parseForwardHeaders } from '../../api/_lib/headers';
import { buildHeaders } from '../../api/_lib/http';
import { originFetch } from '../_lib/socketFetch';

interface Env {
  ALLOW_PRIVATE_HOSTS?: string;
}

const MANIFEST_TIMEOUT_MS = 15_000;
const CORS = { 'Access-Control-Allow-Origin': '*' };

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const params = new URL(request.url).searchParams;
  try {
    const target = validateTargetUrl(
      params.get('u') ?? undefined,
      env.ALLOW_PRIVATE_HOSTS === 'true',
    );
    const rawHeaders = params.get('h') ?? undefined;
    const custom = parseForwardHeaders(rawHeaders);

    // `fetch` can't reach non-standard ports on the Workers runtime; originFetch
    // transparently uses a raw socket for those and plain fetch for 80/443.
    const { response: resp, finalUrl } = await originFetch(
      target,
      buildHeaders(custom),
      MANIFEST_TIMEOUT_MS,
    );
    if (!resp.ok) {
      throw new ProxyError(502, `Origin returned HTTP ${resp.status} for the manifest.`);
    }

    const headersParam = rawHeaders ? encodeURIComponent(rawHeaders) : '';
    const body = rewriteManifest(await resp.text(), finalUrl, headersParam);

    return new Response(body, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const status = e instanceof ProxyError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Proxy error';
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
};
