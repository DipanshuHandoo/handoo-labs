import assert from 'node:assert/strict';
import test from 'node:test';
import { beginRun } from '../server/demo-limits.js';

test('caps concurrent package operations and supports idempotent release', () => {
  const release = Array.from({ length: 8 }, () => beginRun());
  assert.throws(() => beginRun(), /demo slots are currently busy/);
  release[0]();
  release[0]();
  const next = beginRun();
  next();
  for (const finish of release.slice(1)) finish();
});
