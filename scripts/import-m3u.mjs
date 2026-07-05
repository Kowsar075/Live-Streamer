#!/usr/bin/env node
// Import channels from an .m3u/.m3u8 playlist into public/channels.json.
//
// Usage:
//   node scripts/import-m3u.mjs <playlist.m3u>            # merge (skip dup URLs)
//   node scripts/import-m3u.mjs <playlist.m3u> --replace  # overwrite the list
//
// Understands #EXTINF names plus the header-carrying extensions some IPTV lists
// use, mapping them to this app's per-channel `headers` field:
//   #EXTVLCOPT:http-user-agent=...  -> User-Agent
//   #EXTVLCOPT:http-referrer=...    -> Referer
//   #EXTHTTP:{"cookie":"..."}       -> Cookie (and any other keys in the JSON)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHANNELS_PATH = resolve(__dirname, '../public/channels.json');

const [, , inputArg, ...flags] = process.argv;
if (!inputArg) {
  console.error('Usage: node scripts/import-m3u.mjs <playlist.m3u> [--replace]');
  process.exit(1);
}
const replace = flags.includes('--replace');

/** Parse a playlist into [{ name, url, headers? }]. */
function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let name = '';
  let headers = {};

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === '#EXTM3U') continue;

    if (line.startsWith('#EXTINF')) {
      const comma = line.lastIndexOf(',');
      name = comma >= 0 ? line.slice(comma + 1).trim() : '';
      headers = {};
    } else if (line.startsWith('#EXTVLCOPT:')) {
      const opt = line.slice('#EXTVLCOPT:'.length);
      const eq = opt.indexOf('=');
      const key = opt.slice(0, eq).trim().toLowerCase();
      const val = opt.slice(eq + 1).trim();
      if (key === 'http-user-agent') headers['User-Agent'] = val;
      else if (key === 'http-referrer' || key === 'http-referer') headers['Referer'] = val;
    } else if (line.startsWith('#EXTHTTP:')) {
      try {
        const obj = JSON.parse(line.slice('#EXTHTTP:'.length));
        for (const [k, v] of Object.entries(obj)) {
          const key = k.toLowerCase() === 'cookie' ? 'Cookie' : k;
          if (typeof v === 'string') headers[key] = v;
        }
      } catch {
        /* ignore malformed EXTHTTP */
      }
    } else if (!line.startsWith('#')) {
      const channel = { name: name || line, url: line };
      if (Object.keys(headers).length) channel.headers = headers;
      channels.push(channel);
      name = '';
      headers = {};
    }
  }
  return channels;
}

const parsed = parseM3U(readFileSync(resolve(process.cwd(), inputArg), 'utf8'));

let existing = [];
try {
  existing = JSON.parse(readFileSync(CHANNELS_PATH, 'utf8'));
} catch {
  /* no existing list yet */
}

let result;
if (replace) {
  result = parsed;
} else {
  const seen = new Set(existing.map((c) => c.url));
  const added = parsed.filter((c) => !seen.has(c.url));
  result = [...existing, ...added];
  console.log(
    `Parsed ${parsed.length} from playlist; ${added.length} new, ${parsed.length - added.length} duplicate URLs skipped.`,
  );
}

writeFileSync(CHANNELS_PATH, JSON.stringify(result, null, 2) + '\n');
console.log(`channels.json now has ${result.length} channels.`);
