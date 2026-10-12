import express from 'express';

const windowMs = 60_000;
const maxRequests = 60;
const requests = new Map();
let activeRuns = 0;
const maxConcurrentRuns = 8;
const maxTrackedAddresses = 5000;

export function beginRun() {
  if (activeRuns >= maxConcurrentRuns) {
    const error = new Error('All demo slots are currently busy. Please try again shortly.');
    error.status = 429;
    throw error;
  }
  activeRuns += 1;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    activeRuns -= 1;
  };
}

export const demoLimits = express.Router();
demoLimits.use((request, response, next) => {
  const now = Date.now();
  const key = request.ip;
  if (!requests.has(key) && requests.size >= maxTrackedAddresses) {
    for (const [address, entry] of requests) {
      if (now - entry.startedAt >= windowMs) requests.delete(address);
    }
    if (requests.size >= maxTrackedAddresses) requests.delete(requests.keys().next().value);
  }
  const entry = requests.get(key);
  if (!entry || now - entry.startedAt >= windowMs) {
    requests.set(key, { startedAt: now, count: 1 });
    next();
    return;
  }
  entry.count += 1;
  if (entry.count > maxRequests) {
    response.status(429).json({ error: 'Demo request limit reached. Please wait a minute and try again.' });
    return;
  }
  next();
});
