import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRewrittenManifest, getSegment } from './api/_lib/handlers';
import { ProxyError } from './api/_lib/security';

function readU(req: IncomingMessage): string | undefined {
  return new URL(req.url ?? '', 'http://localhost').searchParams.get('u') ?? undefined;
}

// Serves /api/manifest and /api/segment locally using the SAME handlers Vercel
// runs in production, so `npm run dev` needs no Vercel account or CLI.
function localProxyApi(): Plugin {
  return {
    name: 'local-proxy-api',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const path = (req.url ?? '').split('?')[0];
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
          if (path === '/api/manifest') {
            const { contentType, body } = await getRewrittenManifest(readU(req));
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'no-store');
            res.end(body);
            return;
          }
          if (path === '/api/segment') {
            const { status, headers, body } = await getSegment(readU(req));
            for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
            res.statusCode = status;
            if (body) Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
            else res.end();
            return;
          }
          next();
        } catch (e) {
          res.statusCode = e instanceof ProxyError ? e.status : 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Proxy error' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localProxyApi()],
});
