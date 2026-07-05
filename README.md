# M3U8 Web Streamer

A web app for playing **M3U / M3U8 (HLS)** streams in the browser. Pick a channel
from a list (or paste any HLS URL) and it plays via [hls.js](https://github.com/video-dev/hls.js).

A small proxy sits between the browser and the stream origin so that things which
normally break in-browser just work:

- **CORS** — origins that don't send CORS headers still play.
- **Mixed content** — `http://` origins play on an `https://` site.
- **Custom headers** — origins that require a `Cookie` or a specific `User-Agent`
  (which browsers forbid JavaScript from setting) work via per-channel `headers`.

The proxy runs two ways from one shared codebase:

- **Locally** — a Vite dev-server middleware (Node). This is what this guide sets up.
- **In production** — Cloudflare Pages Functions (see [Deploying](#deploying)).

---

## Table of contents

- [Requirements](#requirements)
- [Run it locally from scratch](#run-it-locally-from-scratch)
- [Using the app](#using-the-app)
- [Managing channels](#managing-channels)
- [Importing an .m3u playlist](#importing-an-m3u-playlist)
- [Playing LAN / private-network streams](#playing-lan--private-network-streams)
- [All available commands](#all-available-commands)
- [Project structure](#project-structure)
- [Deploying](#deploying)
- [Troubleshooting](#troubleshooting)

---

## Requirements

- **Node.js 20** (the project is pinned to it via `.nvmrc`).
  - Your system may default to an older Node — this project will **not** run on
    Node 17 or below. The steps below use [nvm](https://github.com/nvm-sh/nvm) to
    select Node 20.
- **npm** (ships with Node).
- A modern browser (Chrome, Edge, Firefox, or Safari).

Check what you have:

```bash
node --version   # want v20.x
```

---

## Run it locally from scratch

These steps assume you're starting with just the source files and no
`node_modules` yet.

### 1. Open a terminal in the project folder

```bash
cd path/to/m3u8-web-streamer
```

(Replace `path/to/m3u8-web-streamer` with wherever you cloned/downloaded this
project.)

### 2. Select Node 20

If you use **nvm** (recommended):

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 20   # only needed the first time; downloads Node 20 if missing
nvm use 20
```

You should see `Now using node v20.x`. Confirm:

```bash
node --version   # v20.x
```

> **No nvm?** Install Node 20 however you like (e.g. from
> [nodejs.org](https://nodejs.org/) or your OS package manager), then continue.

### 3. Install dependencies

```bash
npm install
```

This downloads everything into `node_modules/` (React, Vite, hls.js, TypeScript,
etc.). It only needs to be run once — or again whenever dependencies change.

### 4. Start the dev server

```bash
npm run dev
```

You'll see output ending with:

```
  ➜  Local:   http://localhost:5173/
```

Leave this terminal running — it's serving both the web page **and** the proxy
(`/api/manifest` and `/api/segment`).

### 5. Open the app

Open **http://localhost:5173** in your browser.

You should see the channel grid. Click any channel to play it. To stop the
server later, press **Ctrl+C** in the terminal.

> Every time you come back to develop, you only need steps 1, 2, and 4
> (`cd`, select Node 20, `npm run dev`). Steps 3 is one-time.

---

## Using the app

- **Play a channel** — click a card in the grid.
- **Search** — type in the search box to filter by channel name or URL.
- **Pages** — the grid shows 15 channels per page (5×3); use the `‹` / `›`
  arrows to move between pages. The player stays put while you browse.
- **Play any URL** — paste an `.m3u8`/`.m3u` URL into the "Or paste a URL" box and
  press **Play**.

---

## Managing channels

Channels live in **`public/channels.json`** — a JSON array of objects. Edit this
file to add, remove, or rename channels. The dev server picks up changes on the
next page reload (no rebuild needed locally).

Minimal entry:

```json
{
  "name": "Channel KMP",
  "url": "https://myserver.dev/video-stream.m3u"
}
```

Entry that needs custom HTTP headers (e.g. a token-signed IPTV stream):

```json
{
  "name": "Sony Ten Sports 1 HD",
  "url": "https://example.cdn/live/sony_sports_1_hd/playlist.m3u8",
  "headers": {
    "User-Agent": "Toffee (Linux;Android 14)",
    "Cookie": "Edge-Cache-Cookie=...signed-token..."
  }
}
```

The proxy sends `headers` to the origin for the manifest **and** every segment.
Only these header names are forwarded (for safety): `User-Agent`, `Cookie`,
`Referer`, `Origin`.

> **Note:** signed cookies/tokens expire. When a channel that used to work starts
> failing with an auth error, refresh its token from your source and update the
> value in `channels.json`.

---

## Importing an .m3u playlist

If you have a playlist file, import it instead of hand-editing:

```bash
# merge into the existing list (skips channels whose URL is already present)
node scripts/import-m3u.mjs /path/to/playlist.m3u

# replace the whole list with the playlist's channels
node scripts/import-m3u.mjs /path/to/playlist.m3u --replace
```

The importer understands `#EXTINF` names and maps the header extensions some
playlists use into the `headers` field:

- `#EXTVLCOPT:http-user-agent=...` → `User-Agent`
- `#EXTVLCOPT:http-referrer=...` → `Referer`
- `#EXTHTTP:{"cookie":"..."}` → `Cookie`

---

## Playing LAN / private-network streams

By default the proxy **blocks** private/internal addresses (`192.168.x`, `10.x`,
`127.x`, etc.) as a security measure (SSRF protection). If you want to play a
stream that only exists on your local network **during local development**, start
the dev server with the guard disabled:

```bash
ALLOW_PRIVATE_HOSTS=true npm run dev
```

> Only do this locally. A deployed Cloudflare instance can't reach your LAN
> anyway, and the guard should stay on in production.

---

## All available commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (run once). |
| `npm run dev` | Start the local dev server (page + proxy) at `http://localhost:5173`. |
| `npm run build` | Type-check and build the production site into `dist/`. |
| `npm run preview` | Serve the built `dist/` locally — **static only**, the proxy does **not** run here. |
| `npm run typecheck` | Type-check without building. |
| `npm run cf:dev` | Build, then run the **real Cloudflare functions** locally (miniflare) at `http://localhost:8788`. |
| `npm run cf:deploy` | Build and deploy to Cloudflare Pages (see [Deploying](#deploying)). |
| `node scripts/import-m3u.mjs <file>` | Import channels from a playlist. |

> `npm run preview` serves a static build with no proxy, so streams won't play
> there. For local testing use `npm run dev` (Node proxy) or `npm run cf:dev`
> (Workers proxy).

---

## Project structure

```
TV/
├── index.html              # Vite entry
├── vite.config.ts          # React plugin + local proxy middleware (dev only)
├── wrangler.toml           # Cloudflare Pages config
├── .nvmrc                  # pins Node 20
├── public/
│   └── channels.json       # the channel list (edit this)
├── scripts/
│   └── import-m3u.mjs      # playlist importer
├── src/                    # React + TypeScript frontend
│   ├── App.tsx             # channel grid, search, pagination, player
│   ├── components/         # UrlInput, Player, ChannelList
│   └── lib/                # buildProxyUrl, channels loader
├── functions/              # Cloudflare Pages Functions (production proxy)
│   └── api/                # manifest.ts, segment.ts
└── api/_lib/               # shared proxy core (rewrite, headers, security, http)
```

### How the proxy works (in brief)

1. The player requests `/api/manifest?u=<origin URL>`.
2. The proxy fetches the manifest and **rewrites every URL inside it** to point
   back through `/api/manifest` (for sub-playlists) or `/api/segment` (for media
   segments/keys), preserving tokens and any forwarded headers.
3. hls.js then requests those rewritten URLs, so every segment also flows through
   the proxy — solving CORS, mixed content, and custom-header requirements.

---

## Deploying

The app is deployed to **Cloudflare Pages** (free tier — no bandwidth charges).

```bash
npx wrangler login      # one-time; opens a browser to authorize
npm run cf:deploy       # build + deploy
```

The first deploy creates the project; afterwards it updates the same production
URL. Use the **production** URL it prints (e.g. `https://m3u8-streamer.pages.dev`),
**not** the `<hash>.<project>.pages.dev` preview link (that deeper subdomain has a
TLS certificate mismatch and won't load).

---

## Troubleshooting

**`npm run dev` fails / weird syntax errors** — you're probably on an old Node.
Run `node --version`; if it's below 20, do `nvm use 20` (see step 2) and retry.

**A channel shows `Error: ... Blocked private/internal host`** — the URL is a
LAN/private address. See
[Playing LAN / private-network streams](#playing-lan--private-network-streams).

**A channel shows `manifestLoadError` / `fetch failed` (502)** — the origin is
down, geo-blocked, or requires headers/token you don't have. Try a known-good test
stream (e.g. `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`) to confirm the
app itself works.

**A channel returns 403** — it needs a valid `Cookie`/token or a specific
`User-Agent`. Add them under the channel's `headers` (see
[Managing channels](#managing-channels)). If it already has them, the token has
likely expired — refresh it.

**Nothing plays but the page loads** — make sure you're using `npm run dev` (which
runs the proxy), not `npm run preview` (static only).
