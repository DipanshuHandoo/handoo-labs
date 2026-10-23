import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, describe, test } from 'node:test';

// Live tests opt in through MONGODOCK_TEST_URI so a stray demo URI never hits a real database.
const liveUri = process.env.MONGODOCK_TEST_URI;
if (liveUri) process.env.MONGODOCK_DEMO_URI = liveUri;
else delete process.env.MONGODOCK_DEMO_URI;

const { createApp } = await import('../server/app.js');
const app = await createApp();
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseUrl = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  server.closeAllConnections?.();
  server.close();
  await once(server, 'close');
  if (liveUri) {
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect();
  }
});

async function request(path, { body, cookie } = {}) {
  const response = await fetch(`${baseUrl}/api/mongodock${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return response;
}

const cookieFrom = (response) => response.headers.get('set-cookie')?.split(';', 1)[0];

function parseEvents(text) {
  return text.split('\n\n').filter(Boolean).map((chunk) => {
    const event = chunk.match(/^event: (.+)$/m)?.[1];
    const data = chunk.match(/^data: (.+)$/m)?.[1];
    return { event, data: data ? JSON.parse(data) : undefined };
  });
}

test('rejects unknown actions and out-of-range input before touching MongoDB', async () => {
  const unknown = await request('/operation', { body: { action: 'dropDatabase' } });
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error, /action must be one of/);

  const seed = await request('/seed', { body: { count: 5000 } });
  assert.equal(seed.status, 400);
  assert.match((await seed.json()).error, /count/);
});

describe('without MONGODOCK_DEMO_URI', { skip: Boolean(liveUri) }, () => {
  test('reports the playground as offline instead of failing', async () => {
    const response = await request('/state');
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.available, false);
    assert.equal(state.reason, 'not-configured');
    assert.ok(state.categories.length > 0);
  });

  test('returns 503 NOT_CONFIGURED for database operations', async () => {
    const response = await request('/operation', { body: { action: 'health' } });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'NOT_CONFIGURED');
  });
});

describe('against a live MongoDB', { skip: liveUri ? false : 'set MONGODOCK_TEST_URI to run' }, () => {
  let cookie;

  test('seeds through batched bulkWrite and reports invalid rows', async () => {
    const state = await request('/state');
    cookie = cookieFrom(state);
    assert.equal((await state.json()).available, true);

    const response = await request('/seed', { cookie, body: { count: 40, batchSize: 10, concurrency: 2, invalidCount: 3 } });
    assert.equal(response.status, 200);
    const events = parseEvents(await response.text());
    assert.equal(events[0].event, 'start');
    assert.equal(events[0].data.totalBatches, 4);
    assert.equal(events.filter((entry) => entry.event === 'batch').length, 4);
    const complete = events.at(-1);
    assert.equal(complete.event, 'complete');
    assert.equal(complete.data.count, 37);
  });

  test('paginates with keyset cursors and isolates visitors', async () => {
    const first = await request('/operation', { cookie, body: { action: 'cursor', sortField: 'price', direction: 'asc', limit: 10 } });
    assert.equal(first.status, 200);
    const page = await first.json();
    assert.equal(page.docs.length, 10);
    assert.equal(page.hasNextPage, true);
    const prices = page.docs.map((item) => item.price);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b));

    const stranger = await request('/operation', { body: { action: 'paginate', limit: 10 } });
    assert.equal((await stranger.json()).count, 0);
  });

  test('blocks unsafe operations with guards', async () => {
    const response = await request('/operation', { cookie, body: { action: 'guard', scenario: 'deleteAll' } });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.blocked, true);
    assert.equal(result.count, 37);
  });

  test('resets the visitor documents', async () => {
    const response = await request('/operation', { cookie, body: { action: 'reset' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).count, 0);
  });
});
