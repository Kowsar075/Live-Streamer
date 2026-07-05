// Transport-agnostic proxy handlers. Both the Vercel serverless functions
// (api/manifest.ts, api/segment.ts) and the local Vite dev middleware call
// these, so the fetch/rewrite/security logic lives in exactly one place.

import { validateTargetUrl, ProxyError } from './security';
import { rewriteManifest } from './rewrite';

const MANIFEST_TIMEOUT_MS = 15_000;
const SEGMENT_TIMEOUT_MS = 30_000;

const ORIGIN_HEADERS = {
  // Some IPTV origins reject requests without a browser-ish UA.
  'User-Agent':
    'Mozilla/5.0 (compatible; m3u8-web-streamer proxy; +https://github.com)',
  Accept: '*/*',
};

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: ORIGIN_HEADERS,
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
): Promise<ManifestResult> {
  const url = validateTargetUrl(rawUrl);

  let resp: Response;
  try {
    resp = await fetchWithTimeout(url.toString(), MANIFEST_TIMEOUT_MS);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new ProxyError(502, `Failed to fetch manifest: ${reason}`);
  }
  if (!resp.ok) {
    throw new ProxyError(502, `Origin returned HTTP ${resp.status} for the manifest.`);
  }

  // Resolve relative refs against the final URL after any redirects.
  const finalUrl = resp.url || url.toString();
  const text = await resp.text();
  return {
    contentType: 'application/vnd.apple.mpegurl',
    body: rewriteManifest(text, finalUrl),
  };
}

export interface SegmentResult {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
}

function guessContentType(pathname: string): string {
  const p = pathname.toLowerCase();
  if (p.endsWith('.ts')) return 'video/MP2T';
  if (p.endsWith('.aac')) return 'audio/aac';
  if (p.endsWith('.mp4') || p.endsWith('.m4s')) return 'video/mp4';
  if (p.endsWith('.vtt')) return 'text/vtt';
  return 'application/octet-stream';
}

export async function getSegment(rawUrl: string | undefined): Promise<SegmentResult> {
  const url = validateTargetUrl(rawUrl);

  let resp: Response;
  try {
    resp = await fetchWithTimeout(url.toString(), SEGMENT_TIMEOUT_MS);
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
