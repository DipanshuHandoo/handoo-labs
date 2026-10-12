import express from 'express';
import { createCache } from '@dipanshuhandoo/cache-bridge';
import { beginRun } from '../../server/demo-limits.js';
import { getDemoSession } from '../../server/demo-session.js';
import { boundedInteger, boundedString, requireRecord } from '../../server/input.js';

const router = express.Router();

async function getCacheDemo(request, response) {
  return getDemoSession(request, response, 'cache-bridge', async (id) => {
    const cache = createCache({
      name: `playground-${id}`,
      ttl: 60_000,
      memory: { maxEntries: 6, maxSize: 24 * 1024 },
      stats: true,
      onError: (error) => console.error('[cache-bridge demo]', error),
    });
    await cache.ready;
    return {
      cache,
      activity: [],
      values: new Map(),
      dispose: () => cache.close({ flush: false }),
    };
  });
}

function snapshot(session) {
  const keys = session.cache.keys();
  const stats = session.cache.stats();
  for (const key of session.values.keys()) {
    if (!keys.includes(key)) session.values.delete(key);
  }
  return {
    entries: keys.map((key) => ({ key, value: session.values.get(key) ?? '(value not displayed)' })),
    stats: { ...stats, redis: { enabled: stats.redis.enabled } },
    activity: session.activity,
    limitations: 'This private, in-memory playground does not connect to Redis. Expired entries are removed lazily on access.',
  };
}

router.get('/state', async (request, response, next) => {
  try {
    response.json(snapshot(await getCacheDemo(request, response)));
  } catch (error) {
    next(error);
  }
});

router.post('/operation', async (request, response, next) => {
  const finish = beginRun();
  try {
    const input = requireRecord(request.body);
    const action = boundedString(input.action, 'action', 16);
    const key = boundedString(input.key, 'key', 48).trim();
    const session = await getCacheDemo(request, response);
    const cache = session.cache;
    let detail;

    if (action === 'set') {
      const value = boundedString(input.value, 'value', 120);
      const ttlSeconds = boundedInteger(input.ttlSeconds, 'ttlSeconds', 0, 60, 15);
      if (!key) throw Object.assign(new Error('A cache key is required.'), { status: 400 });
      cache.set(key, value, { ttl: ttlSeconds * 1000 });
      session.values.set(key, value);
      detail = ttlSeconds ? `Stored "${key}" with a ${ttlSeconds}s TTL.` : `Stored "${key}" without expiration.`;
    } else if (action === 'get') {
      if (!key) throw Object.assign(new Error('A cache key is required.'), { status: 400 });
      const value = cache.get(key);
      detail = value === undefined ? `Cache miss for "${key}".` : `Cache hit for "${key}".`;
    } else if (action === 'delete') {
      if (!key) throw Object.assign(new Error('A cache key is required.'), { status: 400 });
      detail = cache.delete(key) ? `Deleted "${key}".` : `"${key}" was not in the cache.`;
      session.values.delete(key);
    } else if (action === 'clear') {
      cache.clearMemory();
      session.values.clear();
      detail = 'Cleared the in-memory entries.';
    } else {
      throw Object.assign(new Error('action must be set, get, delete, or clear.'), { status: 400 });
    }

    session.activity.unshift({ action, key: key || undefined, detail, at: new Date().toISOString() });
    session.activity.length = Math.min(session.activity.length, 12);
    response.json({ ...snapshot(session), detail });
  } catch (error) {
    next(error);
  } finally {
    finish();
  }
});

export default router;
