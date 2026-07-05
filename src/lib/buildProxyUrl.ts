/**
 * Build the proxied manifest URL for the player. The raw origin URL (including
 * any ?token=... auth query) is encoded whole into the `u` param so it survives
 * intact to the proxy.
 *
 * `headers` are optional per-channel HTTP headers (e.g. a signed Cookie or a
 * required User-Agent) the browser won't let JS set directly — the proxy applies
 * them server-side. They ride along in the `h` param and the proxy propagates
 * them to every segment request.
 */
export function buildManifestUrl(
  originalUrl: string,
  headers?: Record<string, string>,
): string {
  const u = encodeURIComponent(originalUrl.trim());
  const h =
    headers && Object.keys(headers).length > 0
      ? `&h=${encodeURIComponent(JSON.stringify(headers))}`
      : '';
  return `/api/manifest?u=${u}${h}`;
}
