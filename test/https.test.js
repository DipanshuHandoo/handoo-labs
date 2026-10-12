import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/tls/${name}`, import.meta.url));
const certPath = fixture('localhost-cert.pem');
const keyPath = fixture('localhost-key.pem');

function startEntry(context, extraEnv) {
  const env = { ...process.env, TRUST_PROXY_HOPS: '0', ...extraEnv };
  for (const name of ['SSL_KEY_PATH', 'SSL_CERT_PATH', 'SSL_CA_PATH', 'HTTPS_PORT', 'HTTP_REDIRECT_PORT', 'PUBLIC_HOST']) {
    if (!(name in extraEnv)) delete env[name];
  }
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  context.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  });
  return child;
}

function waitForLog(child, pattern, matchCount = 1) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`Server exited with code ${code}: ${stderr}`)));
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const matches = [...stdout.matchAll(pattern)];
      if (matches.length >= matchCount) resolve(matches);
    });
  });
}

function request(client, url, options = {}) {
  return new Promise((resolve, reject) => {
    client.get(url, options, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    }).on('error', reject);
  });
}

test('serves HTTPS with HSTS when certificate paths are configured', { timeout: 15_000 }, async (context) => {
  const child = startEntry(context, { SSL_KEY_PATH: keyPath, SSL_CERT_PATH: certPath, HTTPS_PORT: '0' });
  const [[, port]] = await waitForLog(child, /listening on https:\/\/localhost:(\d+)/g);
  const response = await request(https, `https://localhost:${port}/healthz`, { ca: await readFile(certPath) });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { status: 'ok' });
  assert.equal(response.headers['strict-transport-security'], 'max-age=31536000');
});

test('redirects plain HTTP to HTTPS when HTTP_REDIRECT_PORT is set', { timeout: 15_000 }, async (context) => {
  const child = startEntry(context, {
    SSL_KEY_PATH: keyPath,
    SSL_CERT_PATH: certPath,
    HTTPS_PORT: '0',
    HTTP_REDIRECT_PORT: '0',
    PUBLIC_HOST: 'labs.example.com',
  });
  const matches = await waitForLog(child, /(listening on https|redirecting http):\/\/localhost:(\d+)/g, 2);
  const httpsPort = matches.find((match) => match[1] === 'listening on https')[2];
  const redirectPort = matches.find((match) => match[1] === 'redirecting http')[2];
  const response = await request(http, `http://localhost:${redirectPort}/excelio/?x=1`);
  assert.equal(response.status, 301);
  assert.equal(response.headers.location, `https://labs.example.com:${httpsPort}/excelio/?x=1`);
});

test('fails fast when only one certificate path is configured', { timeout: 15_000 }, async (context) => {
  const child = startEntry(context, { SSL_KEY_PATH: keyPath, HTTPS_PORT: '0' });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const [code] = await once(child, 'exit');
  assert.notEqual(code, 0);
  assert.match(stderr, /SSL_KEY_PATH and SSL_CERT_PATH must both be set/);
});
