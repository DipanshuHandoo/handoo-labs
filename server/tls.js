import { readFile } from 'node:fs/promises';

const hostnamePattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export function parsePort(value, name, fallback) {
  const port = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`${name} must be an integer from 0 to 65535.`);
  }
  return port;
}

async function readTlsFile(filePath, name) {
  try {
    return await readFile(filePath);
  } catch (error) {
    throw new Error(`${name} could not be read (${filePath}): ${error.message}`, { cause: error });
  }
}

export async function loadTlsOptions(env = process.env) {
  const keyPath = env.SSL_KEY_PATH;
  const certPath = env.SSL_CERT_PATH;
  if (!keyPath && !certPath) return null;
  if (!keyPath || !certPath) {
    throw new Error('SSL_KEY_PATH and SSL_CERT_PATH must both be set to enable HTTPS.');
  }

  const [key, cert, ca] = await Promise.all([
    readTlsFile(keyPath, 'SSL_KEY_PATH'),
    readTlsFile(certPath, 'SSL_CERT_PATH'),
    env.SSL_CA_PATH ? readTlsFile(env.SSL_CA_PATH, 'SSL_CA_PATH') : undefined,
  ]);
  return {
    key,
    cert,
    ...(ca && { ca }),
    ...(env.SSL_PASSPHRASE && { passphrase: env.SSL_PASSPHRASE }),
    minVersion: 'TLSv1.2',
  };
}

export function createRedirectHandler({ httpsPort, publicHost }) {
  if (publicHost && !hostnamePattern.test(publicHost)) {
    throw new Error('PUBLIC_HOST must be a bare hostname such as labs.example.com.');
  }

  return (request, response) => {
    const requestHost = (request.headers.host ?? '').replace(/:\d+$/, '');
    const host = publicHost || (hostnamePattern.test(requestHost) ? requestHost : '');
    if (!host) {
      response.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad Request');
      return;
    }
    const portSuffix = httpsPort === 443 ? '' : `:${httpsPort}`;
    const target = `https://${host}${portSuffix}${request.url?.startsWith('/') ? request.url : '/'}`;
    response.writeHead(301, { Location: target, 'Content-Type': 'text/plain' }).end(`Redirecting to ${target}`);
  };
}
