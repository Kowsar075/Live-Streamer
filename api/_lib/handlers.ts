// Transport-agnostic proxy handlers. Both the Vercel serverless functions
// (api/manifest.ts, api/segment.ts) and the local Vite dev middleware call
// these, so the fetch/rewrite/security logic lives in exactly one place.

import net from 'node:net';
import { validateTargetUrl, ProxyError } from './security';
import { rewriteManifest } from './rewrite';
import { parseForwardHeaders } from './headers';
import { buildHeaders, guessContentType } from './http';

// Many IPTV origins are dual-stack (publish both A and AAAA records) but are
// only actually reachable over IPv4. Without Happy Eyeballs, Node's fetch picks
// the IPv6 address, can't route to it, and hangs until ETIMEDOUT ("fetch
// failed"). Enabling autoSelectFamily makes it race both families and fall back
// to IPv4 in ~500ms. Uses node:net so no external dependency is needed.
// (Not needed on Cloudflare's edge — that runtime doesn't have this problem.)
net.setDefaultAutoSelectFamily(true);
net.setDefaultAutoSelectFamilyAttemptTimeout(500);

const MANIFEST_TIMEOUT_MS = 15_000;
const SEGMENT_TIMEOUT_MS = 30_000;

const allowPrivateHosts = process.env.ALLOW_PRIVATE_HOSTS === 'true';

async function fetchWithTimeout(
  url: string,
  ms: number,
  headers: Headers,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers,
    });
  } finally {
    clearTimeout(timer);
  }
}

export interface ManifestResult {
  contentType: string;
  body: string;
}

export async function getRewrittenManifest(
  rawUrl: string | undefined,
  rawHeaders?: string,
): Promise<ManifestResult> {
  const url = validateTargetUrl(rawUrl, allowPrivateHosts);
  const custom = parseForwardHeaders(rawHeaders);

  let resp: Response;
  try {
    resp = await fetchWithTimeout(url.toString(), MANIFEST_TIMEOUT_MS, buildHeaders(custom));
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new ProxyError(502, `Failed to fetch manifest: ${reason}`);
  }
  if (!resp.ok) {
    throw new ProxyError(502, `Origin returned HTTP ${resp.status} for the manifest.`);
  }

  // Resolve relative refs against the final URL after any redirects, and carry
  // the caller's headers onto every rewritten segment/variant URL.
  const finalUrl = resp.url || url.toString();
  const headersParam = rawHeaders ? encodeURIComponent(rawHeaders) : '';
  const text = await resp.text();
  return {
    contentType: 'application/vnd.apple.mpegurl',
    body: rewriteManifest(text, finalUrl, headersParam),
  };
}

export interface SegmentResult {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
}

export async function getSegment(
  rawUrl: string | undefined,
  rawHeaders?: string,
): Promise<SegmentResult> {
  const url = validateTargetUrl(rawUrl, allowPrivateHosts);
  const custom = parseForwardHeaders(rawHeaders);

  let resp: Response;
  try {
    resp = await fetchWithTimeout(url.toString(), SEGMENT_TIMEOUT_MS, buildHeaders(custom));
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new ProxyError(502, `Failed to fetch segment: ${reason}`);
  }
  if (!resp.ok && resp.status !== 206) {
    throw new ProxyError(502, `Origin returned HTTP ${resp.status} for a segment.`);
  }

  const headers: Record<string, string> = {
    'Content-Type': resp.headers.get('content-type') ?? guessContentType(url.pathname),
    'Cache-Control': 'public, max-age=30',
  };
  const len = resp.headers.get('content-length');
  if (len) headers['Content-Length'] = len;

  return { status: resp.status, headers, body: resp.body };
}
