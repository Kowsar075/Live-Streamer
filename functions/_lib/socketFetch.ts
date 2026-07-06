// Workers-only HTTP/1.1 client over a raw TCP socket (`cloudflare:sockets`).
//
// WHY THIS EXISTS: on the deployed Cloudflare Workers runtime, `fetch()` only
// connects on ports 80/443 — it *silently drops* any non-standard port and
// connects to the scheme default instead. So an IPTV origin like
// `http://1.2.3.4:8097/...` is unreachable via fetch (fetch would hit :80).
// VLC and the Node dev proxy work because they connect to the real port.
//
// This module speaks HTTP/1.1 directly over a socket so custom-port origins are
// reachable. It is imported ONLY by the Workers functions (custom-port targets);
// standard-port targets still use the normal `fetch`. It must never be imported
// by the Node dev middleware or by api/_lib (it depends on `cloudflare:sockets`).

import { connect } from 'cloudflare:sockets';
import { ProxyError } from '../../api/_lib/security';

const MAX_REDIRECTS = 5;
const CRLF = new Uint8Array([13, 10]);
const CRLFCRLF = new Uint8Array([13, 10, 13, 10]);
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

// The socket's readable yields Uint8Array over any ArrayBufferLike; keep one
// alias so our buffers unify with what `reader.read()` returns.
type Bytes = Uint8Array<ArrayBufferLike>;

export interface SocketFetchResult {
  status: number;
  headers: Headers;
  body: ReadableStream<Bytes>;
  finalUrl: string;
}

/** True when the URL targets a port `fetch()` can't reach (anything but 80/443). */
export function needsSocket(url: URL): boolean {
  const p = url.port;
  if (p === '') return false;
  if (url.protocol === 'http:' && p === '80') return false;
  if (url.protocol === 'https:' && p === '443') return false;
  return true;
}

function concat(a: Bytes, b: Bytes): Bytes {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Index of `needle` within `hay` (byte search), or -1. */
function indexOfSeq(hay: Bytes, needle: Bytes, from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Serialize a GET request. Reserved framing headers are set by us, not forwarded. */
function buildRequest(url: URL, reqHeaders: Headers): string {
  const skip = new Set(['host', 'connection', 'accept-encoding', 'content-length', 'transfer-encoding']);
  const path = (url.pathname || '/') + url.search;
  let out = `GET ${path} HTTP/1.1\r\n`;
  out += `Host: ${url.host}\r\n`;
  for (const [k, v] of reqHeaders) {
    if (!skip.has(k.toLowerCase())) out += `${k}: ${v}\r\n`;
  }
  // Force identity so we never have to gunzip; close so body framing is simple.
  out += 'Accept-Encoding: identity\r\n';
  out += 'Connection: close\r\n\r\n';
  return out;
}

/** Wrap an async byte generator as a ReadableStream. */
function streamFromGen(gen: AsyncGenerator<Bytes>): ReadableStream<Bytes> {
  return new ReadableStream<Bytes>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        controller.error(e);
      }
    },
    async cancel() {
      try {
        await gen.return(undefined as never);
      } catch {
        /* ignore */
      }
    },
  });
}

type Reader = ReadableStreamDefaultReader<Bytes>;

/** Content-Length-bounded (or read-until-EOF when length is null) body. */
async function* lengthGen(
  leftover: Bytes,
  reader: Reader,
  contentLength: number | null,
): AsyncGenerator<Bytes> {
  let sent = 0;
  const clip = (chunk: Bytes): Bytes =>
    contentLength != null && sent + chunk.length > contentLength
      ? chunk.slice(0, contentLength - sent)
      : chunk;
  try {
    if (leftover.length) {
      const c = clip(leftover);
      if (c.length) {
        sent += c.length;
        yield c;
      }
    }
    while (contentLength == null || sent < contentLength) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      const c = clip(value);
      sent += c.length;
      yield c;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
}

/** Transfer-Encoding: chunked decoder. */
async function* chunkedGen(leftover: Bytes, reader: Reader): AsyncGenerator<Bytes> {
  let buf = leftover;
  const dec = new TextDecoder('utf-8');
  const readMore = async (): Promise<boolean> => {
    const { value, done } = await reader.read();
    if (done) return false;
    if (value && value.length) buf = concat(buf, value);
    return true;
  };
  try {
    for (;;) {
      let nl = indexOfSeq(buf, CRLF);
      while (nl === -1) {
        if (!(await readMore())) return;
        nl = indexOfSeq(buf, CRLF);
      }
      const sizeLine = dec.decode(buf.slice(0, nl));
      const semi = sizeLine.indexOf(';');
      const size = parseInt((semi === -1 ? sizeLine : sizeLine.slice(0, semi)).trim(), 16);
      buf = buf.slice(nl + 2);
      if (Number.isNaN(size)) return;
      if (size === 0) return; // last chunk; trailers ignored
      while (buf.length < size + 2) {
        if (!(await readMore())) break;
      }
      if (buf.length === 0) return;
      yield buf.slice(0, Math.min(size, buf.length));
      buf = buf.slice(size + 2);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Perform an HTTP/1.1 GET over a raw socket and return a normalized result whose
 * `body` is already decoded (de-chunked / length-bounded). Follows redirects.
 */
export async function socketFetch(
  urlStr: string,
  reqHeaders: Headers,
  timeoutMs: number,
  redirectsLeft = MAX_REDIRECTS,
): Promise<SocketFetchResult> {
  const url = new URL(urlStr);
  const secure = url.protocol === 'https:';
  const port = url.port ? Number(url.port) : secure ? 443 : 80;

  const socket = connect(
    { hostname: url.hostname, port },
    { secureTransport: secure ? 'on' : 'off', allowHalfOpen: true },
  );

  // A single timer guards connect + header read; cleared before body streaming.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }, timeoutMs);

  const reader = socket.readable.getReader();
  try {
    const writer = socket.writable.getWriter();
    await writer.write(new TextEncoder().encode(buildRequest(url, reqHeaders)));
    writer.releaseLock();

    // Read until the end of the header block.
    let buf: Bytes = new Uint8Array(0);
    let headerEnd = -1;
    while (headerEnd === -1) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.length) {
        buf = concat(buf, value);
        headerEnd = indexOfSeq(buf, CRLFCRLF);
      }
    }
    if (headerEnd === -1) {
      throw new ProxyError(502, 'Origin closed the socket before sending HTTP headers.');
    }

    const headerText = new TextDecoder('utf-8').decode(buf.slice(0, headerEnd));
    const leftover = buf.slice(headerEnd + 4);
    const lines = headerText.split('\r\n');
    const statusMatch = lines[0].match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
    if (!statusMatch) {
      throw new ProxyError(502, 'Malformed HTTP status line from origin.');
    }
    const status = Number(statusMatch[1]);

    const headers = new Headers();
    for (let i = 1; i < lines.length; i++) {
      const idx = lines[i].indexOf(':');
      if (idx === -1) continue;
      try {
        headers.append(lines[i].slice(0, idx).trim(), lines[i].slice(idx + 1).trim());
      } catch {
        /* skip invalid header names */
      }
    }

    clearTimeout(timer);

    // Follow redirects (open a fresh socket for the new location).
    if (REDIRECT_CODES.has(status)) {
      const loc = headers.get('location');
      if (loc && redirectsLeft > 0) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return socketFetch(new URL(loc, url).toString(), reqHeaders, timeoutMs, redirectsLeft - 1);
      }
    }

    const te = (headers.get('transfer-encoding') || '').toLowerCase();
    const isChunked = te.includes('chunked');
    const clRaw = headers.get('content-length');
    const contentLength = clRaw != null && /^\d+$/.test(clRaw) ? Number(clRaw) : null;

    // The body we emit is decoded, so these framing/encoding headers no longer apply.
    headers.delete('transfer-encoding');
    headers.delete('content-encoding');
    if (isChunked) headers.delete('content-length');

    const body = streamFromGen(
      isChunked ? chunkedGen(leftover, reader) : lengthGen(leftover, reader, contentLength),
    );

    return { status, headers, body, finalUrl: url.toString() };
  } catch (e) {
    clearTimeout(timer);
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    try {
      socket.close();
    } catch {
      /* ignore */
    }
    if (timedOut) {
      throw new ProxyError(504, `Origin timed out after ${timeoutMs}ms (socket).`);
    }
    if (e instanceof ProxyError) throw e;
    throw new ProxyError(502, `Socket fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Fetch an origin URL the right way for the Workers runtime: normal `fetch` for
 * standard ports, raw-socket HTTP/1.1 for custom ports (which fetch can't reach).
 * Returns a uniform `{ response, finalUrl }` for both paths.
 */
export async function originFetch(
  target: URL,
  headers: Headers,
  timeoutMs: number,
): Promise<{ response: Response; finalUrl: string }> {
  if (!needsSocket(target)) {
    const response = await fetch(target.toString(), {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { response, finalUrl: response.url || target.toString() };
  }
  const r = await socketFetch(target.toString(), headers, timeoutMs);
  return {
    response: new Response(r.body, { status: r.status, headers: r.headers }),
    finalUrl: r.finalUrl,
  };
}
