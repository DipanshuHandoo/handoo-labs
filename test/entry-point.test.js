import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const entries = [
  ['server.js', [fileURLToPath(new URL('../server.js', import.meta.url))]],
  ['server/app.js', [fileURLToPath(new URL('../server/app.js', import.meta.url))]],
  // Passenger (Hostinger) loads the startup file with require(), which rejects top-level await.
  ['server.js via require()', ['-e', `require(${JSON.stringify(fileURLToPath(new URL('../server.js', import.meta.url)))})`]],
];

for (const [entry, args] of entries) {
  test(`${entry} starts the app on the configured port`, { timeout: 15_000 }, async (context) => {
    const child = spawn(process.execPath, args, {
      env: { ...process.env, PORT: '0', TRUST_PROXY_HOPS: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    context.after(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    const port = await new Promise((resolve, reject) => {
      let stdout = '';
      child.on('error', reject);
      child.on('exit', (code) => reject(new Error(`Server exited with code ${code}: ${stderr}`)));
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        const match = stdout.match(/listening on http:\/\/localhost:(\d+)/);
        if (match) resolve(Number(match[1]));
      });
    });
    assert.ok(port > 0);
    const response = await fetch(`http://localhost:${port}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });
}
