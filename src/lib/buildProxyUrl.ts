/**
 * Build the proxied manifest URL for the player. The raw origin URL (including
 * any ?token=... auth query) is encoded whole into the `u` param so it survives
 * intact to the proxy.
 */
export function buildManifestUrl(originalUrl: string): string {
  return `/api/manifest?u=${encodeURIComponent(originalUrl.trim())}`;
}
