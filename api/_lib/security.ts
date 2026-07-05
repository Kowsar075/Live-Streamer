// SSRF guard: reject requests aimed at private / internal hosts so the proxy
// can't be used to reach LAN boxes, loopback, or cloud metadata endpoints.
//
// Set ALLOW_PRIVATE_HOSTS=true (env) to permit private hosts during LAN testing
// with the local dev server. It should stay unset in a Vercel deployment, where
// private hosts are unreachable anyway and allowing them only widens SSRF risk.

const PRIVATE_HOSTNAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback']);

export class ProxyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ProxyError';
  }
}

function ipv4Parts(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  return parts.some((n) => n > 255) ? null : parts;
}

function isPrivateIPv4([a, b]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (PRIVATE_HOSTNAMES.has(h)) return true;

  const v4 = ipv4Parts(h);
  if (v4) return isPrivateIPv4(v4);

  if (h === '::1') return true; // IPv6 loopback
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // unique local
  if (h.startsWith('fe80')) return true; // link-local
  const mapped = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped IPv6
  if (mapped) {
    const p = ipv4Parts(mapped[1]);
    if (p) return isPrivateIPv4(p);
  }
  return false;
}

/**
 * Validate and normalize a user-supplied target URL. Throws ProxyError on
 * anything that isn't a public http(s) URL.
 *
 * Note: this checks the URL's literal host only. It does not defend against
 * DNS rebinding (a public hostname that resolves to a private IP). That's an
 * acceptable gap for a personal tool; harden with DNS resolution if this ever
 * goes multi-tenant.
 */
export function validateTargetUrl(raw: string | undefined, allowPrivate = false): URL {
  if (!raw) throw new ProxyError(400, 'Missing required "u" query parameter.');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProxyError(400, `Invalid URL: ${raw}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProxyError(400, `Unsupported protocol: ${url.protocol}`);
  }

  if (!allowPrivate && isPrivateHost(url.hostname)) {
    throw new ProxyError(
      403,
      `Blocked private/internal host: ${url.hostname}. ` +
        'Set ALLOW_PRIVATE_HOSTS=true to allow LAN origins during local testing.',
    );
  }

  return url;
}
