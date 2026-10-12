import express from 'express';
import { createClient, cache } from '@dipanshuhandoo/fetchforge';
import { mockFetch } from '@dipanshuhandoo/fetchforge/testing';
import { beginRun } from '../../server/demo-limits.js';
import { getDemoSession } from '../../server/demo-session.js';
import { boundedBoolean, boundedInteger, boundedString, requireRecord } from '../../server/input.js';

const router = express.Router();
const baseUrl = 'https://handoo-playground.invalid';

function createFetchDemo() {
  const state = {
    calls: 0,
    failedResponsesLeft: 0,
    alwaysFail: false,
    delayMs: 0,
    events: [],
  };
  const mock = mockFetch({ baseUrl, onUnmatched: 'error' });
  mock.get('/resource', async () => {
    state.calls += 1;
    if (state.alwaysFail || state.failedResponsesLeft > 0) {
      if (state.failedResponsesLeft > 0) state.failedResponsesLeft -= 1;
      const delay = state.delayMs;
      state.delayMs = 0;
      return {
        status: 503,
        headers: { 'content-type': 'application/json' },
        json: { error: 'The sample service is temporarily unavailable.', call: state.calls },
        delay,
      };
    }
    const delay = state.delayMs;
    state.delayMs = 0;
    return {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      json: { message: 'Hello from the controlled local mock service.', call: state.calls },
      delay,
    };
  });

  const responseCache = cache({
    ttl: 20_000,
    respectCacheControl: false,
    onEvent: (event) => {
      state.events.unshift({ type: event.type, url: event.url });
      state.events.length = Math.min(state.events.length, 12);
    },
  });
  const client = createClient({
    baseUrl,
    fetch: mock,
    timeout: 1500,
    retry: { retries: 1, delay: 60, backoff: 'fixed', jitter: 0 },
    circuitBreaker: { failureThreshold: 2, resetTimeout: 10_000 },
    plugins: [responseCache],
  });
  return {
    client,
    mock,
    state,
    responseCache,
    dispose: async () => {
      await responseCache.whenIdle();
      await responseCache.clear();
    },
  };
}

router.get('/state', async (request, response, next) => {
  try {
    const session = await getDemoSession(request, response, 'fetchforge', async () => createFetchDemo());
    response.json({
      metrics: session.client.getMetrics(),
      circuit: session.client.getCircuitState(baseUrl),
      cache: session.responseCache.stats(),
      events: session.state.events,
      calls: session.state.calls,
      isolation: 'Each browser receives its own in-memory client, cache, mock service, and circuit state.',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/run', async (request, response, next) => {
  const finish = beginRun();
  try {
    const input = requireRecord(request.body);
    const scenario = boundedString(input.scenario, 'scenario', 16, 'success');
    const requestCount = boundedInteger(input.requestCount, 'requestCount', 1, 5, 1);
    const retries = boundedInteger(input.retries, 'retries', 0, 3, 1);
    const failureThreshold = boundedInteger(input.failureThreshold, 'failureThreshold', 1, 3, 2);
    const timeoutMs = boundedInteger(input.timeoutMs, 'timeoutMs', 100, 2500, 1000);
    const responseDelayMs = boundedInteger(input.responseDelayMs, 'responseDelayMs', 0, 3000, 0);
    const bypassCache = boundedBoolean(input.bypassCache, 'bypassCache', false);
    if (!['success', 'flaky', 'unavailable'].includes(scenario)) {
      throw Object.assign(new Error('scenario must be success, flaky, or unavailable.'), { status: 400 });
    }
    const failuresBeforeSuccess = boundedInteger(input.failuresBeforeSuccess, 'failuresBeforeSuccess', 1, 3, 1);
    const session = await getDemoSession(request, response, 'fetchforge', async () => createFetchDemo());
    session.client.resetCircuit(baseUrl);
    session.state.alwaysFail = scenario === 'unavailable';
    session.state.failedResponsesLeft = scenario === 'flaky' ? failuresBeforeSuccess : 0;
    session.state.delayMs = responseDelayMs;
    session.state.events.length = 0;
    const results = [];

    for (let index = 0; index < requestCount; index += 1) {
      try {
        const result = await session.client.get('/resource', {
          timeout: timeoutMs,
          retry: { retries, delay: 60, backoff: 'fixed', jitter: 0 },
          circuitBreaker: { failureThreshold, resetTimeout: 10_000 },
          meta: {
            cache: bypassCache || scenario !== 'success'
              ? false
              : { ttl: 20_000 },
          },
        });
        results.push({
          status: result.status,
          attempts: result.attempts,
          durationMs: result.durationMs,
          data: result.data,
          cache: result.cache ?? 'miss',
        });
      } catch (error) {
        results.push({
          error: error.message,
          code: error.code ?? 'ERR_REQUEST',
          attempts: error.attempts ?? 1,
        });
      }
    }

    response.json({
      scenario,
      results,
      metrics: session.client.getMetrics(),
      circuit: session.client.getCircuitState(baseUrl),
      cache: session.responseCache.stats(),
      events: session.state.events,
      calls: session.state.calls,
      notice: 'Requests run only against an in-process mockFetch route. Unmatched requests never reach the network.',
    });
  } catch (error) {
    next(error);
  } finally {
    finish();
  }
});

router.post('/reset', async (request, response, next) => {
  try {
    const session = await getDemoSession(request, response, 'fetchforge', async () => createFetchDemo());
    session.client.resetCircuit();
    session.client.resetMetrics();
    session.state.calls = 0;
    session.state.failedResponsesLeft = 0;
    session.state.alwaysFail = false;
    session.state.delayMs = 0;
    session.state.events.length = 0;
    session.mock.calls.length = 0;
    await session.responseCache.clear();
    response.json({ reset: true });
  } catch (error) {
    next(error);
  }
});

export default router;
