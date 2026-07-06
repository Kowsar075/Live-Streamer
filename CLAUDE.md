# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Deployment target: Cloudflare Pages (IMPORTANT — not Firebase, not Vercel)

The design doc below (§0–§12) assumes **Firebase**; the project was later moved to **Vercel**
and is now on **Cloudflare Pages + Pages Functions**. Reason: the user wants it free *no matter
the traffic*. Cloudflare charges **$0 for egress/bandwidth** and the free plan **throttles rather
than bills** (100k function requests/day; static assets unlimited). Firebase needs paid Blaze;
Vercel/Netlify bill past a bandwidth cap.

So: **ignore Firebase mechanics** in §3/§4.3/§8. The architecture (§2), manifest-rewrite rules
(§4.2), security guards (§5), and testing checklist (§12) all still apply — implemented on
Cloudflare primitives.

## Current state — scaffolded and verified working

```
TV/
├── index.html              # Vite entry
├── vite.config.ts          # React plugin + local /api proxy middleware (dev only, Node)
├── wrangler.toml           # Cloudflare Pages config (pages_build_output_dir = dist)
├── public/
│   └── channels.json       # channel list: [{ name, url, headers? }] — edit without rebuilding
├── scripts/import-m3u.mjs  # import .m3u playlists into channels.json
├── src/                    # React + TS frontend
│   ├── App.tsx             # loads channels.json; search + 5x3 paginated grid + player
│   ├── components/{UrlInput,Player,ChannelList}.tsx
│   └── lib/{buildProxyUrl,channels}.ts
├── functions/              # Cloudflare Pages Functions (the DEPLOYED proxy — Workers runtime)
│   ├── tsconfig.json       # workers-types; editor typecheck only
│   └── api/{manifest,segment}.ts   # onRequestGet handlers -> /api/manifest, /api/segment
└── api/_lib/               # shared PURE core, imported by BOTH functions/ and the Vite dev middleware
    ├── rewrite.ts          # HLS manifest rewriting — the core & main bug surface
    ├── headers.ts          # parse/allowlist the forwarded `h` header param
    ├── http.ts             # buildHeaders / guessContentType (portable, web-standard)
    ├── security.ts         # validateTargetUrl(raw, allowPrivate) — SSRF guard
    └── handlers.ts         # NODE-ONLY (node:net Happy Eyeballs); used ONLY by Vite dev middleware
```

Two runtimes share one core:
- **Deployed proxy** = `functions/api/*.ts` on the **Workers runtime** (web APIs only; segment =
  `new Response(originResp.body)`). Must NOT import `handlers.ts` (it's Node).
- **Local dev proxy** = the Vite middleware in `vite.config.ts`, which calls the Node
  `handlers.ts`. This is what `npm run dev` uses.
- Both import the pure modules (`rewrite`, `headers`, `http`, `security`). `validateTargetUrl`
  takes `allowPrivate` as a param because Workers has no `process.env`.

Verified via `wrangler pages dev` (real Workers runtime) and `npm run dev`: master → variant →
segment rewrite, segment streaming, forwarded-header auth, and private-IP 403 all work.

## Node version

**Local Node is v17 by default, which is too old.** This project needs Node 20 (pinned in
`.nvmrc`). nvm is installed but not auto-loaded in non-interactive shells. Prefix commands with:

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
```

## Commands

```bash
npm install            # deps (Node 20)
npm run dev            # Vite dev server at http://localhost:5173, /api handled by vite middleware
npm run build          # tsc --noEmit typecheck, then vite build -> dist/
npm run preview        # serve the production build locally (no /api — build is static only)
npm run typecheck      # tsc --noEmit only (checks src + api/_lib; not functions/)

npm run cf:dev         # build, then wrangler pages dev — real Workers runtime locally
npm run cf:deploy      # build, then wrangler pages deploy — deploy to Cloudflare Pages

# Import channels from an .m3u/.m3u8 playlist into public/channels.json
node scripts/import-m3u.mjs <playlist.m3u>            # merge, skip duplicate URLs
node scripts/import-m3u.mjs <playlist.m3u> --replace  # overwrite the list
```

`scripts/import-m3u.mjs` maps `#EXTINF` names + `#EXTVLCOPT`/`#EXTHTTP` (user-agent/referrer/
cookie) into channel objects with the `headers` field.

- **`npm run dev` is full-stack**: `vite.config.ts` serves `/api/manifest` + `/api/segment` via
  the Node `handlers.ts`. No Cloudflare account/CLI needed for everyday development.
- **`npm run cf:dev`** runs the *actual deployed* Workers functions locally (miniflare) against
  the built `dist/` — use it to verify a change behaves the same on Cloudflare before deploying.
- **LAN testing**: the SSRF guard blocks private IPs by default. For a `192.168.x`/LAN origin in
  local dev, set `ALLOW_PRIVATE_HOSTS=true` before `npm run dev` (never set it in production).
- **Deploy**: `npx wrangler login` once, then `npm run cf:deploy`. First deploy creates the Pages
  project (name from `wrangler.toml`). Or connect a Git repo in the Cloudflare dashboard with
  build command `npm run build` and output dir `dist`. Free plan limit: 100k function req/day.

## Key architectural facts

- **`api/_lib/rewrite.ts` is the core and the main bug surface.** It resolves every manifest
  reference against the manifest's own (post-redirect) URL via `new URL(ref, base)` and
  preserves query tokens before re-encoding. Master-playlist variant URLs and `#EXT-X-MEDIA`/
  I-frame/rendition-report URIs route to `/api/manifest`; segments, `#EXT-X-KEY`, `#EXT-X-MAP`,
  and LL-HLS parts route to `/api/segment`.
- **One shared core, two runtimes.** The deployed Workers functions (`functions/api/*.ts`) and
  the Node Vite dev middleware are thin adapters over the pure `api/_lib` modules. Put proxy
  logic in `_lib`, never duplicate it in an adapter. Keep `_lib` free of Node-only imports EXCEPT
  `handlers.ts`, which is Node-only by design and must not be imported by `functions/`.
- **Security implemented:** `security.ts` blocks private/loopback/link-local/CGNAT IPv4+IPv6 and
  cloud-metadata (169.254.169.254), and rejects non-http(s) schemes. Not yet implemented from §5:
  auth on the proxy and rate limiting — add these before sharing the deployed URL publicly, or
  it's an open proxy (on Cloudflare that burns the 100k/day request budget). The guard checks the
  literal host only (no DNS-rebinding defense) — fine for a personal tool.
- **Custom origin ports need a raw socket on Cloudflare.** On the deployed Workers
  runtime, `fetch()` only connects on ports 80/443 — it *silently drops* any other port and
  hits the scheme default. So an origin like `http://1.2.3.4:8097/...` is unreachable via
  fetch (VLC and `npm run dev`/Node fetch work because they honor the port; symptom is
  `manifestLoadError` only on the deployed site). Fix: `functions/_lib/socketFetch.ts` — a
  Workers-only HTTP/1.1 client over `cloudflare:sockets`. `originFetch()` there routes
  non-80/443 targets through the socket (handles redirects, chunked + content-length framing,
  streams the body) and everything else through normal `fetch`. Both `functions/api/*.ts`
  call `originFetch`. This file is Workers-only (imports `cloudflare:sockets`) — never import
  it from the Node dev middleware or `api/_lib`; Node dev already honors ports via its fetch.
- **Segment streaming**: Workers = `new Response(originResp.body)`; Node dev =
  `Readable.fromWeb(resp.body).pipe(res)`. Never buffer whole segments. Manifests use
  `Cache-Control: no-store`; segments `public, max-age=30`.
- **Per-channel forwarded headers.** A channel in `channels.json` may include a `headers` map
  (e.g. `User-Agent`, `Cookie` for token-signed IPTV origins like Toffee/Google Edge Cache).
  The browser can't set those, so the frontend passes them JSON-encoded in the `h` query param;
  the proxy applies them to the origin fetch and `rewrite.ts` propagates `h` onto every rewritten
  variant/segment URL so the whole chain is authenticated. `headers.ts` only forwards an
  allowlist (`user-agent`, `cookie`, `referer`, `origin`).
- **Dual-stack IPv6 hang:** many IPTV origins publish A+AAAA but are IPv4-only reachable; without
  Happy Eyeballs Node's fetch hangs → `fetch failed`. `handlers.ts` calls
  `net.setDefaultAutoSelectFamily(true)` at load to fix this. Symptom to recognize: curl works,
  proxy returns 502 "fetch failed" (ETIMEDOUT).

---

# M3U/M3U8 Web Streamer — original design spec (Firebase framing; see note above)

## Handoff document for Claude Code implementation

---

## 0. Read this first — the one hard constraint

**Firebase Cloud Functions run inside Google Cloud, not on your local network.**

Your example URL —

```
http://192.168.40.168:8080/video.m3u8?token=abcd1234
```

— is a **private LAN IP address**. A Cloud Function cannot reach it, the same way your laptop can't reach a random stranger's home router. This isn't a config issue, it's fundamental to how private IP ranges work.

This proxy design will work perfectly for:
- Any stream origin with a **public IP or public domain** (most IPTV panels, restream services, CDN-backed HLS origins).
- Local testing, if you run the Cloud Functions **emulator locally** (then it runs on your machine and *can* reach your LAN).

It will **not** work in production for a stream that only exists on your home/office LAN, unless you either:
- Expose that origin server to the public internet (port-forward + dynamic DNS, or a tunnel like Cloudflare Tunnel/ngrok), or
- Run the proxy somewhere on your LAN instead of Firebase (defeats the "no dedicated backend" goal), or
- Use a VPN/Cloud Interconnect between your network and Google Cloud (overkill for this use case).

**Action item for you before building:** confirm whether your real-world stream sources are public-facing. If some are LAN-only IPTV boxes, decide now whether you're okay restricting this app to public sources, or whether you want a local-dev-only mode via the Functions emulator.

Everything below assumes the origin is reachable from the public internet.

---

## 1. Project Overview

A web app where a user pastes an M3U or M3U8 URL (optionally with a token/auth query param), and the app streams it in-browser.

**Flow:**
1. User pastes URL into input field.
2. Frontend sends it to a Firebase Cloud Function proxy instead of fetching it directly (avoids CORS issues, hides origin from browser network tab if desired, lets you control/validate access).
3. The proxy fetches the manifest, **rewrites every URL inside it** to point back through the proxy, and returns it.
4. hls.js (or native Safari HLS) plays the rewritten manifest — every segment request also transparently round-trips through the proxy.

---

## 2. Architecture

```
┌─────────────────────┐        ┌──────────────────────────┐        ┌────────────────────┐
│   Browser (SPA)      │        │   Firebase Hosting        │        │  Origin stream      │
│   React + Vite + TS   │──────▶│   (static site + rewrite) │        │  server (IPTV/HLS)  │
│   hls.js player        │       │        │                  │        │                     │
└─────────────────────┘        │        ▼                  │        └────────────────────┘
                                 │  Cloud Function (Gen 2)   │───────────────▲
                                 │  "streamProxy"            │  fetch()      │
                                 │  - /manifest?u=<url>       │───────────────┘
                                 │  - /segment?u=<url>        │
                                 └──────────────────────────┘
```

- **Frontend**: static SPA hosted on Firebase Hosting.
- **"Backend"**: a single Cloud Function (2nd gen, Node.js), reachable via a Firebase Hosting rewrite so it lives at a clean path like `/api/manifest` instead of a `cloudfunctions.net` URL.
- **No database needed** for the MVP — this is stateless request proxying. (Firestore could be added later for saved channels/history — see §11.)

---

## 3. Why this needs the Blaze (pay-as-you-go) plan

Cloud Functions on the free **Spark** plan cannot make outbound requests to non-Google APIs/hosts. Fetching an arbitrary stream origin counts as outbound network access, so this project **requires upgrading to Blaze**. Blaze still has a generous free tier underneath it — you're only billed for usage beyond that — but the plan itself must be Blaze or the `fetch()` calls to the origin server will fail outright.

Action item: run `firebase projects:list` / check the console and upgrade the project to Blaze before writing the function.

---

## 4. Components

### 4.1 Frontend

- **Stack**: React + Vite + TypeScript (matches your existing tooling preferences).
- **Player library**: `hls.js`.
- **UI**: one input box (paste M3U/M3U8 URL) + "Play" button + `<video>` element + basic error/status display (loading, playing, error with reason).
- **Behavior**:
  - On submit, build the proxied manifest URL: `/api/manifest?u=<encodeURIComponent(originalUrl)>`.
  - Feed that into hls.js (or native `<video>` src on Safari).
  - Never fetch the raw origin URL directly from the browser — always go through the proxy, so CORS is handled server-side once and for all.

### 4.2 Backend proxy — Cloud Function `streamProxy`

Two logical routes inside one function (or two functions if you prefer):

#### `/manifest?u=<encoded absolute URL>`
1. Fetch the URL server-side (`fetch()` in Node 18+, which is built in).
2. Read the response as text.
3. Parse it **line by line**:
   - Lines starting with `#` are directives — mostly pass through unchanged, **except**:
     - `#EXT-X-KEY:...URI="..."` (AES-128 encrypted HLS) — rewrite the URI the same way as media lines.
     - `#EXT-X-MEDIA:...URI="..."` (alternate audio/subtitle tracks) — rewrite similarly.
   - Lines that are **not** comments and not blank are either:
     - another `.m3u8` playlist (variant/rendition, in a master playlist) → rewrite to `/api/manifest?u=<encoded absolute url>`
     - a media segment (`.ts`, `.aac`, `.mp4`, fragmented mp4, etc.) → rewrite to `/api/segment?u=<encoded absolute url>`
   - Relative URLs in the manifest must be resolved against the **manifest's own URL** before re-encoding, using `new URL(line, originalManifestUrl).toString()`. This is the most common bug source — don't skip it.
   - **Preserve query params** (including the token) as part of the absolute URL you encode — don't strip them.
4. Return the rewritten text with:
   - `Content-Type: application/vnd.apple.mpegurl`
   - `Access-Control-Allow-Origin: *` (or your specific frontend origin)
   - `Cache-Control: no-store` (manifests for live streams change constantly; don't let anything cache them)

#### `/segment?u=<encoded absolute URL>`
1. Fetch the URL server-side, **streaming the response body through** rather than buffering the whole thing in memory (important for large segments / long function runtimes).
2. Pass through the origin's `Content-Type` (fallback to `video/MP2T` for `.ts` if missing).
3. Add CORS headers.
4. Set a short `Cache-Control` (e.g. `public, max-age=30`) — segments are effectively immutable once published, so light caching here is safe and reduces egress cost.

### 4.3 Firebase Hosting rewrites

`firebase.json`:
```json
{
  "hosting": {
    "public": "frontend/dist",
    "rewrites": [
      { "source": "/api/manifest", "function": "streamProxy" },
      { "source": "/api/segment", "function": "streamProxy" },
      { "source": "**", "destination": "/index.html" }
    ]
  },
  "functions": {
    "source": "functions"
  }
}
```

Inside the function, branch on `req.path` (`/manifest` vs `/segment`) or just use two exported functions and two rewrite rules — either works; two separate exported functions is simpler to reason about and log.

---

## 5. Security considerations (don't skip this)

This proxy is, by design, a general-purpose URL fetcher — which is exactly the shape of an "open proxy" that gets abused if left unrestricted. Before this goes anywhere near public internet:

1. **Require auth to call the proxy.** Easiest: Firebase Auth (even anonymous auth is fine) + verify the ID token in the function before proxying. This alone stops random bots from using your Cloud Functions bill as free bandwidth.
2. **Domain/host allowlist**, if practical — e.g. only allow proxying to hosts you've pre-approved (your known IPTV providers). Optional if (1) is in place and it's just for personal use.
3. **Block private/internal IP ranges explicitly in code** (`10.x`, `172.16-31.x`, `192.168.x`, `127.x`, `169.254.x`, and IPv6 equivalents) — this prevents SSRF where someone feeds your proxy an internal cloud metadata URL or scans your VPC. Do this even though §0 says LAN IPs won't resolve for *your* streams — it's still a required guard against malicious input.
4. **Rate limiting** — App Check or a simple per-IP/per-user counter (Firestore or in-memory with function instance reuse) to prevent bandwidth abuse.
5. **Timeouts** — set an explicit fetch timeout (e.g. 15s to fetch a manifest) so a slow/hanging origin doesn't rack up function billing time.

For a purely personal/local tool this can be lighter-weight (e.g. just a shared-secret query param or Firebase Auth check), but don't skip it entirely and deploy it wide open.

---

## 6. Known limitations & costs

- **Egress cost**: video is bandwidth-heavy. Every byte of every segment flows through your Cloud Function, which bills for both compute time and egress. This is fine for personal/small-scale use; it will get expensive at real scale. A CDN in front of `/segment` (Firebase Hosting already CDNs static content, but proxied function responses need their own caching headers — done above) helps but doesn't eliminate cost.
- **Cold starts**: Cloud Functions Gen 2 (Cloud Run under the hood) can have cold-start latency on the first request after idle. Consider `minInstances: 1` if this matters to you (costs a bit more to keep warm).
- **Function timeout**: Gen 2 functions can be configured up to 60 minutes, but each *individual* request here is short-lived (fetch one manifest or one segment, not the whole stream), so default timeouts (a few minutes) are plenty. You are not holding one long-lived connection open per viewer — HLS is inherently segmented/polling, which is exactly why this architecture works well on serverless.
- **Encrypted streams (AES-128 HLS)**: supported by the `#EXT-X-KEY` rewrite above, but adds complexity — build this only if you actually encounter it.
- **Live vs VOD**: works for both; live just means the manifest changes on every poll (handled naturally since you never cache manifests).
- **Mixed content**: since Firebase Hosting serves over HTTPS, and your proxy fetches the origin server-side (not from the browser), the origin can be `http://` without triggering browser mixed-content blocking. This is actually a nice side benefit of the proxy approach.

---

## 7. Tech stack summary

| Layer | Choice |
|---|---|
| Frontend framework | React + Vite + TypeScript |
| Player | hls.js (+ native Safari HLS fallback) |
| Hosting | Firebase Hosting |
| Backend | Firebase Cloud Functions, 2nd gen, Node.js 18+ |
| Auth (recommended) | Firebase Auth (anonymous is enough for MVP) |
| Plan required | Blaze (pay-as-you-go) |
| Database | None for MVP (optional Firestore later, see §11) |

---

## 8. Firebase project setup steps

1. `npm install -g firebase-tools` (if not already installed).
2. `firebase login`
3. `firebase init` — select **Hosting** and **Functions**, Functions in TypeScript, Hosting public dir → `frontend/dist`.
4. Upgrade project to **Blaze** in the console (required, see §3).
5. `firebase deploy` once both frontend build and function are ready.
6. Local dev: `firebase emulators:start` runs Hosting + Functions locally — note this is also your only way to test against LAN-only origins (see §0).

---

## 9. Suggested file/folder structure

```
m3u8-streamer/
├── firebase.json
├── .firebaserc
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── UrlInput.tsx
│   │   │   └── Player.tsx
│   │   ├── lib/
│   │   │   └── buildProxyUrl.ts
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
└── functions/
    ├── src/
    │   ├── index.ts            # exports manifestProxy, segmentProxy
    │   ├── manifestRewriter.ts # core M3U8 parsing/rewriting logic
    │   ├── security.ts         # private-IP blocking, auth check, rate limit
    │   └── fetchWithTimeout.ts
    ├── package.json
    └── tsconfig.json
```

---

## 10. Implementation phases for Claude Code

**Phase 0 — Scaffold**
`firebase init` with Hosting + Functions (TS), get an empty deploy working end to end (hello-world function reachable via `/api/ping`).

**Phase 1 — Manifest proxy (no security yet, localhost only)**
Implement `manifestRewriter.ts`: fetch, parse, rewrite absolute/relative URLs, return rewritten text with correct headers. Test against a known public HLS test stream (e.g. Apple's public test streams) before touching any real IPTV source.

**Phase 2 — Segment proxy**
Implement streaming pass-through for `.ts`/`.mp4` segments with correct content-type and caching headers.

**Phase 3 — Frontend player**
React input + hls.js wired to `/api/manifest`. Verify playback end-to-end against the public test stream from Phase 1.

**Phase 4 — Real-world source test**
Point it at one of your actual public-facing stream URLs (with token). Confirm token/query params survive the round trip.

**Phase 5 — Security hardening**
Add Firebase Auth check, private-IP blocking, timeouts, basic rate limiting (§5).

**Phase 6 — Polish**
Loading/error states, master-playlist (multi-quality) support check, `#EXT-X-KEY` support if you hit an encrypted source, deploy to production Hosting URL.

---

## 11. Optional future additions (not needed for MVP)

- Firestore collection of saved/favorite channel URLs per user.
- Server-side allowlist of approved origin domains, editable from an admin UI.
- Analytics on which streams get used (Firebase Analytics).
- Picture-in-picture / casting support in the player.

---

## 12. Testing checklist

- [ ] Public VOD `.m3u8` (single-quality) plays.
- [ ] Public master playlist (`#EXT-X-STREAM-INF` with multiple renditions) — quality switching works.
- [ ] Live stream with a continuously-updating manifest.
- [ ] URL with query-string token — confirm it's preserved through both the manifest rewrite and each segment fetch.
- [ ] Relative segment paths (e.g. `segment001.ts` not `https://.../segment001.ts`) resolve correctly.
- [ ] CORS headers present on both `/manifest` and `/segment` responses.
- [ ] Private IP input (e.g. `192.168.x.x`) is explicitly rejected with a clear error, not a silent hang.
- [ ] Auth check blocks unauthenticated requests (once Phase 5 is done).
