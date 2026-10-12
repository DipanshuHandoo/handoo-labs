import express from 'express';
import { discoverTools } from './discover-tools.js';
import { demoLimits } from './demo-limits.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');

export async function createApp() {
  const app = express();
  const tools = await discoverTools(path.join(rootDir, 'tools'));
  const trustProxyHops = process.env.TRUST_PROXY_HOPS === undefined ? 0 : Number(process.env.TRUST_PROXY_HOPS);
  if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 10) {
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
  }

  app.disable('x-powered-by');
  app.set('trust proxy', trustProxyHops);
  app.use((_request, response, next) => {
    response.set('X-Content-Type-Options', 'nosniff');
    response.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.set('X-Frame-Options', 'DENY');
    response.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', demoLimits);
  app.use('/assets', express.static(path.join(publicDir, 'assets'), {
    immutable: true,
    maxAge: '1h',
  }));
  app.get('/healthz', (_request, response) => response.json({ status: 'ok' }));
  app.get('/api/tools', (_request, response) => response.json(tools.map(({ router, directory, ...tool }) => tool)));

  for (const tool of tools) {
    app.use(`/api/${tool.slug}`, tool.router);
  }

  app.get('/', (_request, response) => response.sendFile(path.join(publicDir, 'index.html')));

  for (const tool of tools) {
    app.get(`/${tool.slug}/`, (_request, response) => response.sendFile(path.join(rootDir, 'tools', tool.slug, 'index.html')));
    app.use(`/${tool.slug}/assets`, express.static(path.join(rootDir, 'tools', tool.slug, 'assets'), { maxAge: '1h' }));
  }

  app.use((_request, response) => response.status(404).json({ error: 'Not found.' }));
  app.use((error, _request, response, _next) => {
    if (!(error.status && error.status < 500)) console.error('[server]', error);
    if (response.headersSent) return;
    if (error.type === 'entity.too.large') return response.status(413).json({ error: 'Request body exceeds the size limit.' });
    response.status(error.status ?? 500).json({ error: error.status && error.status < 500 ? error.message : 'Something went wrong.' });
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error('PORT must be an integer from 0 to 65535.');
  }
  app.listen(port, () => console.log(`Handoo Labs listening on http://localhost:${port}`));
}
