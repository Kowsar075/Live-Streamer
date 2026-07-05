export interface Channel {
  name: string;
  url: string;
  /** Optional HTTP headers to forward to the origin (e.g. Cookie, User-Agent). */
  headers?: Record<string, string>;
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Load the channel list from /channels.json (a static file in public/, editable
 * without a rebuild). Silently drops malformed entries rather than failing the
 * whole list.
 */
export async function loadChannels(): Promise<Channel[]> {
  const res = await fetch('/channels.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load channels.json (HTTP ${res.status})`);

  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error('channels.json must be a JSON array.');

  return data
    .filter(
      (c): c is Channel =>
        !!c &&
        typeof (c as Channel).name === 'string' &&
        typeof (c as Channel).url === 'string',
    )
    .map((c) => {
      const headers = stringMap((c as { headers?: unknown }).headers);
      return headers ? { name: c.name, url: c.url, headers } : { name: c.name, url: c.url };
    });
}
