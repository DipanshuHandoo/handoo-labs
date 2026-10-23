import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, test } from 'node:test';
import { excelio } from '@dipanshuhandoo/excelio';
import { createApp } from '../server/app.js';

const app = await createApp();
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseUrl = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  server.close();
  await once(server, 'close');
});

async function json(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, data: await response.json() };
}

function cookieFrom(response) {
  return response.headers.get('set-cookie')?.split(';', 1)[0];
}

test('serves the homepage and discovers every package playground', async () => {
  const homepage = await fetch(`${baseUrl}/`);
  assert.equal(homepage.status, 200);
  assert.match(await homepage.text(), /Small tools/);
  assert.equal(homepage.headers.get('x-powered-by'), null);
  assert.equal(homepage.headers.get('x-frame-options'), 'DENY');
  assert.match(homepage.headers.get('content-security-policy'), /default-src 'self'/);

  const { response, data } = await json('/api/tools');
  assert.equal(response.status, 200);
  assert.deepEqual(new Set(data.map((tool) => tool.slug)), new Set([
    'async-slot-pool', 'cache-bridge', 'excelio', 'fetchforge', 'mongodock',
  ]));
  assert.ok(data.every((tool) => tool.npm.startsWith('https://')));
  for (const slug of ['async-slot-pool', 'cache-bridge', 'excelio', 'fetchforge', 'mongodock']) {
    const page = await fetch(`${baseUrl}/${slug}/`);
    assert.equal(page.status, 200, `${slug} playground page`);
  }
  const serverSource = await fetch(`${baseUrl}/async-slot-pool/assets/server.js`);
  assert.equal(serverSource.status, 404);
});

test('runs the actual async pool and streams incremental progress', async () => {
  const response = await fetch(`${baseUrl}/api/async-slot-pool/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskCount: 3, concurrency: 2, retries: 1, timeout: 500, delay: 30,
      failCount: 2, failureMode: 'once',
    }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const events = (await response.text()).split(/\r?\n\r?\n/).filter(Boolean);
  assert.ok(events.some((event) => event.startsWith('event: progress')));
  const complete = events.find((event) => event.startsWith('event: complete'));
  assert.ok(complete);
  const result = JSON.parse(complete.match(/^data: (.+)$/m)[1]);
  assert.equal(result.stats.succeeded, 3);
  assert.equal(result.stats.failed, 0);
  assert.equal(result.failures.filter((failure) => failure.willRetry).length, 2);

  const partial = await fetch(`${baseUrl}/api/async-slot-pool/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskCount: 3, concurrency: 2, retries: 0, timeout: 500, delay: 30,
      failCount: 1, failureMode: 'always',
    }),
  });
  const partialEvents = (await partial.text()).split(/\r?\n\r?\n/).filter(Boolean);
  const partialComplete = partialEvents.find((event) => event.startsWith('event: complete'));
  const partialResult = JSON.parse(partialComplete.match(/^data: (.+)$/m)[1]);
  assert.equal(partialResult.stats.succeeded, 2);
  assert.equal(partialResult.stats.failed, 1);
  assert.equal(partialResult.failed[0].item.id, 'task-01');
});

test('rejects invalid pool limits instead of silently clamping them', async () => {
  const { response, data } = await json('/api/async-slot-pool/run', {
    method: 'POST',
    body: { taskCount: 99 },
  });
  assert.equal(response.status, 400);
  assert.match(data.error, /taskCount/);
  const invalidBoolean = await json('/api/fetchforge/run', {
    method: 'POST',
    body: { scenario: 'success', bypassCache: 'false' },
  });
  assert.equal(invalidBoolean.response.status, 400);
  assert.match(invalidBoolean.data.error, /bypassCache/);
});

test('isolates Cache Bridge data per visitor and reports LRU eviction', async () => {
  const firstState = await json('/api/cache-bridge/state');
  const firstCookie = cookieFrom(firstState.response);
  assert.ok(firstCookie?.startsWith('handoo_cache-bridge='));

  const isolatedState = await json('/api/cache-bridge/state');
  assert.deepEqual(isolatedState.data.entries, []);
  for (let index = 0; index < 7; index += 1) {
    const result = await json('/api/cache-bridge/operation', {
      method: 'POST',
      cookie: firstCookie,
      body: { action: 'set', key: `key-${index}`, value: `value-${index}`, ttlSeconds: 0 },
    });
    assert.equal(result.response.status, 200);
  }

  const snapshot = await json('/api/cache-bridge/state', { cookie: firstCookie });
  assert.equal(snapshot.data.entries.length, 6);
  assert.equal(snapshot.data.entries.some((entry) => entry.key === 'key-0'), false);
  assert.equal(snapshot.data.stats.evictions, 1);
});

test('writes, reads, validates, and streams real Excel workbooks', async () => {
  const preview = await json('/api/excelio/preview', {
    method: 'POST',
    body: { rows: [{ name: '', team: 'Platform', score: 96 }, { name: 'Alex', team: 'Design', score: 110 }] },
  });
  assert.equal(preview.response.status, 200);
  assert.deepEqual(preview.data.workbook.map((sheet) => sheet.name), ['People', 'Summary']);
  assert.equal(preview.data.validationErrors.length, 2);
  assert.equal(preview.data.stats.totalSheets, 2);

  const workerPreview = await json('/api/excelio/preview', {
    method: 'POST',
    body: { rows: [{ name: 'Worker', team: 'Platform', score: 87 }], useWorker: true },
  });
  assert.equal(workerPreview.response.status, 200);
  assert.equal(workerPreview.data.writerMode, 'Worker requested (writing)');
  assert.equal(workerPreview.data.workbook[0].rows[0].Name, 'Worker');

  const invalid = await json('/api/excelio/preview', {
    method: 'POST',
    body: { rows: [{ name: 'Alex', team: 'Platform', score: 'not a number' }] },
  });
  assert.equal(invalid.response.status, 400);

  const download = await fetch(`${baseUrl}/api/excelio/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: [{ name: 'Jamie', team: 'Research', score: 92 }] }),
  });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-type'), /spreadsheetml\.sheet/);
  const buffer = Buffer.from(await download.arrayBuffer());
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  const readBack = await excelio.read(buffer);
  assert.equal(readBack.data[0].sheets[0].data[0].Name, 'Jamie');
});

test('demonstrates FetchForge retries, caching, timeouts, and circuit failures', async () => {
  const initial = await json('/api/fetchforge/state');
  const cookie = cookieFrom(initial.response);
  const recovered = await json('/api/fetchforge/run', {
    method: 'POST',
    cookie,
    body: {
      scenario: 'flaky', requestCount: 1, retries: 1, failureThreshold: 2,
      timeoutMs: 500, responseDelayMs: 0, failuresBeforeSuccess: 1,
    },
  });
  assert.equal(recovered.response.status, 200);
  assert.equal(recovered.data.results[0].status, 200);
  assert.equal(recovered.data.results[0].attempts, 2);
  assert.equal(recovered.data.metrics.retries, 1);

  const cached = await json('/api/fetchforge/run', {
    method: 'POST',
    cookie,
    body: { scenario: 'success', requestCount: 2, retries: 0, failureThreshold: 2, timeoutMs: 500 },
  });
  assert.equal(cached.data.results[1].cache, 'hit');

  const unavailable = await json('/api/fetchforge/run', {
    method: 'POST',
    cookie,
    body: {
      scenario: 'unavailable', requestCount: 2, retries: 0, failureThreshold: 1,
      timeoutMs: 500, bypassCache: true,
    },
  });
  assert.equal(unavailable.data.results[0].code, 'ERR_HTTP');
  assert.equal(unavailable.data.circuit, 'open');
  assert.ok(unavailable.data.results[1].error);

  const timeout = await json('/api/fetchforge/run', {
    method: 'POST',
    body: {
      scenario: 'success', requestCount: 1, retries: 0, failureThreshold: 1,
      timeoutMs: 100, responseDelayMs: 250, bypassCache: true,
    },
  });
  assert.equal(timeout.response.status, 200);
  assert.equal(timeout.data.results[0].code, 'ERR_TIMEOUT');
});

test('bounds JSON request bodies and returns a simple readiness signal', async () => {
  const health = await json('/healthz');
  assert.equal(health.data.status, 'ok');
  const large = await fetch(`${baseUrl}/api/cache-bridge/operation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'x'.repeat(70_000) }),
  });
  assert.equal(large.status, 413);
});

test('limits public API request rates per client IP', async () => {
  let throttled = false;
  for (let index = 0; index < 75; index += 1) {
    const response = await fetch(`${baseUrl}/api/tools`);
    if (response.status === 429) {
      throttled = true;
      break;
    }
    assert.equal(response.status, 200);
  }
  assert.equal(throttled, true);
});
