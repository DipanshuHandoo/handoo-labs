import express from 'express';
import { discoverTools } from './discover-tools.js';
import { demoLimits } from './demo-limits.js';
import { createRedirectHandler, loadTlsOptions, parsePort } from './tls.js';
import http from 'node:http';
import https from 'node:https';
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
  app.use((request, response, next) => {
    if (request.secure) response.set('Strict-Transport-Security', 'max-age=31536000');
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

async function listen(server, port, label) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      if (error.code === 'EACCES') {
        reject(new Error(`${label} port ${port} requires elevated privileges. Run as admin/root, grant CAP_NET_BIND_SERVICE, or use a port above 1023 behind a proxy.`, { cause: error }));
      } else if (error.code === 'EADDRINUSE') {
        reject(new Error(`${label} port ${port} is already in use.`, { cause: error }));
      } else {
        reject(error);
      }
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
  // Passenger/lsnode intercept listen(); address() may then be null or a socket path.
  const address = server.address();
  if (address && typeof address === 'object') return address.port;
  return address ?? port;
}

function resolveHttpPort(value) {
  // Passenger-style hosts may pass a Unix socket/named pipe path instead of a number.
  if (value && !/^\d+$/.test(value)) return value;
  return parsePort(value, 'PORT', 3000);
}

export function exitOnStartupError(error) {
  console.error('[server] Failed to start:', error);
  process.exit(1);
}

export async function startServer(env = process.env) {
  const app = await createApp();
  const tlsOptions = await loadTlsOptions(env);

  if (!tlsOptions) {
    const port = resolveHttpPort(env.PORT);
    const server = http.createServer(app);
    const boundPort = await listen(server, port, 'HTTP');
    console.log(`Handoo Labs listening on http://localhost:${boundPort}`);
    return server;
  }

  const httpsPort = parsePort(env.HTTPS_PORT ?? env.PORT, 'HTTPS_PORT', 443);
  const server = https.createServer(tlsOptions, app);
  const boundHttpsPort = await listen(server, httpsPort, 'HTTPS');
  console.log(`Handoo Labs listening on https://localhost:${boundHttpsPort}`);

  if (env.HTTP_REDIRECT_PORT !== undefined && env.HTTP_REDIRECT_PORT !== '') {
    const redirectPort = parsePort(env.HTTP_REDIRECT_PORT, 'HTTP_REDIRECT_PORT', 80);
    const redirectServer = http.createServer(createRedirectHandler({ httpsPort: boundHttpsPort, publicHost: env.PUBLIC_HOST }));
    try {
      const boundRedirectPort = await listen(redirectServer, redirectPort, 'HTTP redirect');
      console.log(`Handoo Labs redirecting http://localhost:${boundRedirectPort} to HTTPS`);
    } catch (error) {
      server.close();
      throw error;
    }
    server.on('close', () => redirectServer.close());
  }

  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch(exitOnStartupError);
}
