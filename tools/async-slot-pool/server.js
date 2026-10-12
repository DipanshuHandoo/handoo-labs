import express from 'express';
import { asyncSlotPool } from '@dipanshuhandoo/async-slot-pool';
import { beginRun } from '../../server/demo-limits.js';
import { boundedInteger, boundedString, requireRecord } from '../../server/input.js';

const router = express.Router();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

router.post('/run', async (request, response, next) => {
  let endRun;
  try {
    const input = requireRecord(request.body);
    const taskCount = boundedInteger(input.taskCount, 'taskCount', 1, 12, 8);
    const concurrency = boundedInteger(input.concurrency, 'concurrency', 1, 6, 3);
    const retries = boundedInteger(input.retries, 'retries', 0, 3, 1);
    const timeout = boundedInteger(input.timeout, 'timeout', 0, 3000, 1200);
    const delay = boundedInteger(input.delay, 'delay', 30, 600, 240);
    const failCount = boundedInteger(input.failCount, 'failCount', 0, taskCount, 2);
    const failureMode = boundedString(input.failureMode, 'failureMode', 16, 'once');
    if (!['once', 'always'].includes(failureMode)) {
      throw Object.assign(new Error('failureMode must be once or always.'), { status: 400 });
    }
    endRun = beginRun();
    response.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    let disconnected = false;
    response.on('close', () => { disconnected = true; });
    const emit = (event, data) => {
      if (!disconnected) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const attemptsByIndex = new Map();
    const failures = [];
    const tasks = Array.from({ length: taskCount }, (_, index) => ({ id: `task-${String(index + 1).padStart(2, '0')}`, index }));
    const result = await asyncSlotPool(tasks, async (task) => {
      const attempt = (attemptsByIndex.get(task.index) ?? 0) + 1;
      attemptsByIndex.set(task.index, attempt);
      await sleep(delay + (task.index % 4) * 45);
      if (task.index < failCount && (failureMode === 'always' || attempt === 1)) {
        throw new Error(failureMode === 'always' ? 'Simulated service unavailable' : 'Simulated transient error');
      }
      return { message: 'Completed successfully', attempt };
    }, {
      concurrency,
      retries,
      timeout,
      retryDelay: 100,
      retryJitter: 0,
      onProgress: (stats) => emit('progress', stats),
      onTaskError: (failure) => failures.push({
        id: failure.item.id,
        attempt: failure.attempt,
        willRetry: failure.willRetry,
        error: failure.error,
      }),
    });
    emit('complete', { ...result, failures });
    response.end();
  } catch (error) {
    if (!(error.status && error.status < 500)) console.error('[async-slot-pool demo]', error);
    if (response.headersSent && !response.destroyed && !response.writableEnded) {
      const message = error.status && error.status < 500 ? error.message : 'The task pool could not complete.';
      response.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
      response.end();
    } else if (!response.headersSent) {
      next(error);
    }
  } finally {
    endRun?.();
  }
});

export default router;
