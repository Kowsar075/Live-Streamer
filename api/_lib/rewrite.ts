// Core HLS manifest rewriter: turns every URL a manifest references into a URL
// that points back through this proxy, so segments/keys/variants all round-trip
// through us instead of being fetched cross-origin by the browser.

type Route = 'manifest' | 'segment';

/**
 * Build the proxied path for an absolute origin URL. `headersParam` is the
 * already-encoded value of the `h` query param (custom forward headers); when
 * present it is carried onto every rewritten URL so segment/variant fetches
 * send the same headers (e.g. a signed Cookie) the manifest fetch used.
 */
export function proxyPath(absUrl: string, route: Route, headersParam: string): string {
  const h = headersParam ? `&h=${headersParam}` : '';
  return `/api/${route}?u=${encodeURIComponent(absUrl)}${h}`;
}

/** A referenced URL is a (variant) playlist if its path ends in .m3u8/.m3u. */
function isPlaylistUrl(absUrl: string): boolean {
  try {
    const p = new URL(absUrl).pathname.toLowerCase();
    return p.endsWith('.m3u8') || p.endsWith('.m3u');
  } catch {
    return false;
  }
}

/**
 * Resolve a manifest reference against the manifest's own URL. This is the
 * single most common HLS-proxy bug: relative refs (`seg001.ts`, `../v2/x.m3u8`)
 * must be resolved against the manifest URL, and query params (tokens) preserved.
 */
function resolve(ref: string, base: string): string {
  return new URL(ref, base).toString();
}

/**
 * Rewrite a full manifest body. `manifestUrl` must be the absolute URL the
 * manifest was fetched from (after redirects), so relative refs resolve right.
 * `headersParam` is the encoded `h` value to propagate (empty string if none).
 */
export function rewriteManifest(body: string, manifestUrl: string, headersParam = ''): string {
  // Rewrite the URI="..." attribute inside a directive line (KEY, MEDIA, MAP...).
  const rewriteUriAttr = (line: string, route: Route): string =>
    line.replace(/URI="([^"]*)"/i, (_m, uri: string) => {
      const abs = resolve(uri, manifestUrl);
      return `URI="${proxyPath(abs, route, headersParam)}"`;
    });

  const out: string[] = [];

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed === '') {
      out.push(line);
      continue;
    }

    if (trimmed.startsWith('#')) {
      const upper = trimmed.toUpperCase();
      // Keys and init segments are binary -> segment route.
      if (
        upper.startsWith('#EXT-X-KEY') ||
        upper.startsWith('#EXT-X-SESSION-KEY') ||
        upper.startsWith('#EXT-X-MAP')
      ) {
        out.push(rewriteUriAttr(line, 'segment'));
      }
      // Alt renditions, I-frame streams, rendition reports -> playlists.
      else if (
        upper.startsWith('#EXT-X-MEDIA') ||
        upper.startsWith('#EXT-X-I-FRAME-STREAM-INF') ||
        upper.startsWith('#EXT-X-RENDITION-REPORT')
      ) {
        out.push(rewriteUriAttr(line, 'manifest'));
      }
      // Any other directive carrying a URI (LL-HLS parts/preload hints) -> segment.
      else if (/URI="/i.test(line)) {
        out.push(rewriteUriAttr(line, 'segment'));
      } else {
        out.push(line);
      }
      continue;
    }

    // A bare URL line: variant playlist (master) or media segment.
    const abs = resolve(trimmed, manifestUrl);
    out.push(proxyPath(abs, isPlaylistUrl(abs) ? 'manifest' : 'segment', headersParam));
  }

  return out.join('\n');
}
