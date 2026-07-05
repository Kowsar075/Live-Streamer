// Portable HTTP helpers shared by the Node proxy (Vite dev middleware) and the
// Cloudflare Worker functions. Uses only web-standard APIs (Headers), so it runs
// in both the Node 18+ and Workers runtimes.

// Some IPTV origins reject requests without a browser-ish UA.
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; m3u8-web-streamer proxy; +https://github.com)';

/** Merge default headers with the caller's forwarded ones (custom wins). */
export function buildHeaders(custom: Record<string, string>): Headers {
  const headers = new Headers();
  headers.set('User-Agent', DEFAULT_USER_AGENT);
  headers.set('Accept', '*/*');
  // Headers.set is case-insensitive, so a custom User-Agent overrides the default.
  for (const [key, value] of Object.entries(custom)) headers.set(key, value);
  return headers;
}

/** Best-effort content type from a segment path when the origin omits one. */
export function guessContentType(pathname: string): string {
  const p = pathname.toLowerCase();
  if (p.endsWith('.ts')) return 'video/MP2T';
  if (p.endsWith('.aac')) return 'audio/aac';
  if (p.endsWith('.mp4') || p.endsWith('.m4s')) return 'video/mp4';
  if (p.endsWith('.vtt')) return 'text/vtt';
  return 'application/octet-stream';
}
