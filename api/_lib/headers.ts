// Parsing of the `h` query param: an optional JSON map of HTTP headers the
// client wants the proxy to forward to the origin (e.g. a signed Cookie or a
// required User-Agent that the browser itself refuses to let JS set).
//
// Only a small allowlist is forwarded so the proxy can't be coerced into
// sending arbitrary headers (Host, Authorization to unrelated hosts, etc.).

const FORWARDABLE = new Set(['user-agent', 'cookie', 'referer', 'origin']);

/** Parse the raw (URL-decoded) `h` value into a sanitized header map. */
export function parseForwardHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string' && FORWARDABLE.has(key.toLowerCase())) {
      out[key] = value;
    }
  }
  return out;
}
