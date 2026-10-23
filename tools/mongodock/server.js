import express from 'express';
import mongoose from 'mongoose';
import { createMongoService, isMongoDockError, toSafeDiagnostic } from '@dipanshuhandoo/mongodock';
import { beginRun } from '../../server/demo-limits.js';
import { getDemoSession } from '../../server/demo-session.js';
import { boundedBoolean, boundedInteger, boundedString, requireRecord } from '../../server/input.js';

const router = express.Router();
const MODEL = 'PlaygroundItem';
const COLLECTION = 'handoo_playground_items';
const CATEGORIES = ['books', 'games', 'garden', 'music', 'tools'];
const SORT_FIELDS = ['price', 'name', 'stock', 'createdAt'];
const MAX_DOCS_PER_VISITOR = 2000;
const DOC_TTL_SECONDS = 60 * 60;
const RECONNECT_BACKOFF_MS = 15_000;
const ACTIVITY_LIMIT = 14;
const activityByOwner = new Map();

const itemSchema = new mongoose.Schema({
  owner: { type: String, required: true },
  sku: { type: String, required: true, maxlength: 24 },
  name: { type: String, required: true, maxlength: 60 },
  category: { type: String, required: true, enum: CATEGORIES },
  price: { type: Number, required: true, min: 0, max: 100_000 },
  stock: { type: Number, required: true, min: 0, max: 100_000 },
  createdAt: { type: Date, default: Date.now },
}, { collection: COLLECTION, versionKey: false });
itemSchema.index({ createdAt: 1 }, { expireAfterSeconds: DOC_TTL_SECONDS });
for (const field of ['price', 'name', 'stock', 'createdAt']) itemSchema.index({ owner: 1, [field]: 1, _id: 1 });
itemSchema.index({ owner: 1, category: 1, price: 1, _id: 1 });

let serviceState = { promise: null, failedAt: 0 };

function demoError(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function recordActivity({ context, invocationOutcome, databaseOutcome, error }) {
  if (context.metadata?.internal) return;
  const activity = activityByOwner.get(context.metadata?.owner);
  if (!activity) return;
  activity.unshift({
    method: context.method,
    outcome: invocationOutcome,
    databaseOutcome,
    durationMs: Date.now() - context.startedAt,
    code: error?.code === undefined ? undefined : String(error.code),
    at: new Date().toISOString(),
  });
  activity.length = Math.min(activity.length, ACTIVITY_LIMIT);
}

async function connectService(uri) {
  const service = createMongoService({
    uri,
    options: { serverSelectionTimeoutMS: 6000, maxPoolSize: 10, appName: 'handoo-labs-mongodock' },
    limits: { readLimit: 50, maxReadLimit: 500, pageLimit: 10, concurrency: 4, hookTimeoutMS: 2000 },
    hooks: {
      onComplete: recordActivity,
      onHookError: ({ error }) => console.error('[mongodock demo hook]', toSafeDiagnostic(error)),
    },
  });
  service.registerModel({ name: MODEL, schema: itemSchema });
  await service.connect();
  // mongodock disables autoIndex, so the TTL and keyset indexes are built explicitly once.
  await service.getModel(MODEL).createIndexes().catch((error) => {
    console.error('[mongodock demo] index creation failed', toSafeDiagnostic(error));
  });
  return service;
}

async function getService() {
  const uri = process.env.MONGODOCK_DEMO_URI;
  if (!uri) throw demoError('The live MongoDB playground is not configured on this server.', 503, { code: 'NOT_CONFIGURED' });
  if (serviceState.promise) return serviceState.promise;
  if (serviceState.failedAt && Date.now() - serviceState.failedAt < RECONNECT_BACKOFF_MS) {
    throw demoError('MongoDB is unreachable right now. Retrying shortly.', 503, { code: 'ERR_CONNECTION' });
  }
  const promise = connectService(uri);
  serviceState = { promise, failedAt: 0 };
  try {
    return await promise;
  } catch (error) {
    console.error('[mongodock demo] connect failed', toSafeDiagnostic(error));
    serviceState = { promise: null, failedAt: Date.now() };
    throw demoError('MongoDB is unreachable right now. Retrying shortly.', 503, { code: 'ERR_CONNECTION' });
  }
}

async function getVisitor(request, response) {
  return getDemoSession(request, response, 'mongodock', async (owner) => {
    const activity = [];
    activityByOwner.set(owner, activity);
    return {
      owner,
      activity,
      dispose: async () => {
        activityByOwner.delete(owner);
        const promise = serviceState.promise;
        if (!promise) return;
        const service = await promise;
        await service.deleteMany({ model: MODEL, filter: { owner } });
      },
    };
  });
}

const call = (visitor) => ({ metadata: { owner: visitor.owner } });
const bookkeeping = (visitor) => ({ metadata: { owner: visitor.owner, internal: true } });
const projection = { owner: 0 };
const money = (value) => Math.round(value * 100) / 100;

function countOwned(service, visitor) {
  return service.countDocuments({ model: MODEL, filter: { owner: visitor.owner }, ...bookkeeping(visitor) });
}

function toItem(doc) {
  return {
    id: String(doc._id),
    sku: doc.sku,
    name: doc.name,
    category: doc.category,
    price: money(doc.price),
    stock: doc.stock,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
  };
}

function readQueryInput(input) {
  const sortField = boundedString(input.sortField, 'sortField', 16, 'price');
  if (!SORT_FIELDS.includes(sortField)) throw demoError(`sortField must be one of ${SORT_FIELDS.join(', ')}.`);
  const direction = boundedString(input.direction, 'direction', 4, 'asc');
  if (!['asc', 'desc'].includes(direction)) throw demoError('direction must be asc or desc.');
  const category = boundedString(input.category, 'category', 16, '');
  if (category && !CATEGORIES.includes(category)) throw demoError(`category must be one of ${CATEGORIES.join(', ')}.`);
  return {
    sort: { [sortField]: direction === 'asc' ? 1 : -1 },
    category,
    limit: boundedInteger(input.limit, 'limit', 1, 50, 8),
  };
}

function ownerFilter(visitor, category) {
  return category ? { owner: visitor.owner, category } : { owner: visitor.owner };
}

const adjectives = ['Swift', 'Quiet', 'Bright', 'Lunar', 'Amber', 'Nimble', 'Solid', 'Vivid', 'Gentle', 'Rapid'];
const nouns = { books: 'Atlas', games: 'Puzzle', garden: 'Planter', music: 'Synth', tools: 'Wrench' };

function* seedOperations(owner, count, invalidCount) {
  // Spread invalid rows across the run so failures land in different batches.
  const invalidEvery = invalidCount ? Math.max(1, Math.floor(count / invalidCount)) : 0;
  let invalidLeft = invalidCount;
  const stamp = Date.now();
  const prefix = stamp.toString(36).slice(-4).toUpperCase();
  for (let index = 0; index < count; index += 1) {
    const category = CATEGORIES[index % CATEGORIES.length];
    const invalid = invalidLeft > 0 && index % invalidEvery === invalidEvery - 1;
    if (invalid) invalidLeft -= 1;
    yield {
      insertOne: {
        document: {
          owner,
          sku: `SKU-${prefix}-${String(index + 1).padStart(4, '0')}`,
          name: `${adjectives[(index * 7) % adjectives.length]} ${nouns[category]} ${index + 1}`,
          category,
          price: invalid ? -1 : Math.round((5 + ((index * 37) % 495) + (index % 3) * 0.49) * 100) / 100,
          stock: (index * 13) % 250,
          createdAt: new Date(stamp - index * 1000),
        },
      },
    };
  }
}

function publicError(error) {
  if (error.status && error.status < 500) return { status: error.status, body: { error: error.message, code: error.code } };
  if (error.code === 'NOT_CONFIGURED' || error.code === 'ERR_CONNECTION') {
    return { status: 503, body: { error: error.message, code: error.code } };
  }
  if (isMongoDockError(error)) {
    const status = ['ERR_INVALID_OPTION', 'ERR_OPERATION_VETO', 'ERR_TRANSACTION'].includes(error.code) ? 400 : 503;
    return { status, body: { error: error.message, code: error.code, databaseOutcome: error.databaseOutcome } };
  }
  if (error?.name === 'ValidationError' || error?.name === 'CastError') {
    return { status: 400, body: { error: 'MongoDB rejected the input during schema validation.', code: error.name } };
  }
  console.error('[mongodock demo]', toSafeDiagnostic(error));
  return { status: 500, body: { error: 'Something went wrong.' } };
}

function sendError(response, error) {
  const { status, body } = publicError(error);
  response.status(status).json(body);
}

router.get('/state', async (request, response) => {
  try {
    const visitor = await getVisitor(request, response);
    const base = { categories: CATEGORIES, maxDocs: MAX_DOCS_PER_VISITOR, ttlMinutes: DOC_TTL_SECONDS / 60 };
    if (!process.env.MONGODOCK_DEMO_URI) return response.json({ ...base, available: false, reason: 'not-configured', activity: [] });
    const service = await getService();
    const [health, count] = await Promise.all([
      service.healthCheck({ probe: true, timeoutMS: 3000 }),
      countOwned(service, visitor),
    ]);
    const connection = Object.values(health.connections)[0];
    response.json({
      ...base,
      available: true,
      health: { ready: health.ready, latencyMs: connection?.latencyMs ?? null, state: connection?.state },
      count,
      activity: visitor.activity,
    });
  } catch (error) {
    if (error.code === 'ERR_CONNECTION') return response.json({ available: false, reason: 'unreachable', activity: [] });
    sendError(response, error);
  }
});

router.post('/seed', async (request, response) => {
  let endRun;
  let disconnected = false;
  const controller = new AbortController();
  try {
    const input = requireRecord(request.body);
    const count = boundedInteger(input.count, 'count', 10, 1000, 200);
    const batchSize = boundedInteger(input.batchSize, 'batchSize', 5, 500, 50);
    const concurrency = boundedInteger(input.concurrency, 'concurrency', 1, 8, 4);
    const invalidCount = boundedInteger(input.invalidCount, 'invalidCount', 0, 20, 0);
    const visitor = await getVisitor(request, response);
    const service = await getService();
    const existing = await countOwned(service, visitor);
    if (existing + count > MAX_DOCS_PER_VISITOR) {
      throw demoError(`This would exceed the ${MAX_DOCS_PER_VISITOR}-document playground limit (you have ${existing}). Reset first.`);
    }
    endRun = beginRun();
    response.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.on('close', () => {
      if (response.writableEnded) return;
      disconnected = true;
      controller.abort();
    });
    const emit = (event, data) => {
      if (!disconnected) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    emit('start', { count, batchSize, concurrency, totalBatches: Math.ceil(count / batchSize) });
    const report = await service.bulkWrite({
      model: MODEL,
      batching: true,
      operations: seedOperations(visitor.owner, count, invalidCount),
      batchSize,
      concurrency,
      signal: controller.signal,
      onBatch: (outcome) => emit('batch', {
        batchIndex: outcome.batchIndex,
        size: outcome.size,
        status: outcome.status,
        succeeded: outcome.succeeded,
        failed: outcome.failed,
        elapsedMs: outcome.elapsedMs,
        errors: outcome.errors.slice(0, 3),
      }),
      ...call(visitor),
    });
    const total = await countOwned(service, visitor);
    emit('complete', { report, count: total, activity: visitor.activity });
    response.end();
  } catch (error) {
    if (response.headersSent && !response.writableEnded && !response.destroyed) {
      const { body } = publicError(error);
      response.write(`event: error\ndata: ${JSON.stringify(body)}\n\n`);
      response.end();
    } else if (!response.headersSent) {
      sendError(response, error);
    }
  } finally {
    endRun?.();
  }
});

const operations = {
  async paginate(service, visitor, input) {
    const query = readQueryInput(input);
    const page = boundedInteger(input.page, 'page', 1, 400, 1);
    const result = await service.paginate({
      model: MODEL,
      filter: ownerFilter(visitor, query.category),
      sort: query.sort,
      page,
      limit: query.limit,
      projection,
      lean: true,
      ...call(visitor),
    });
    return { kind: 'paginate', ...result, docs: result.docs.map(toItem), detail: `Offset page ${result.page} of ${result.totalPages || 1}.` };
  },

  async cursor(service, visitor, input) {
    const query = readQueryInput(input);
    const cursor = boundedString(input.cursor, 'cursor', 8192, '') || undefined;
    const result = await service.paginateCursor({
      model: MODEL,
      filter: ownerFilter(visitor, query.category),
      sort: query.sort,
      limit: query.limit,
      cursor,
      projection,
      lean: true,
      ...call(visitor),
    });
    return {
      kind: 'cursor',
      ...result,
      docs: result.docs.map(toItem),
      detail: result.hasNextPage ? 'Keyset page loaded. The opaque cursor fetches the next page.' : 'Reached the end of the keyset.',
    };
  },

  async aggregate(service, visitor) {
    const groups = await service.aggregate({
      model: MODEL,
      pipeline: [
        { $match: { owner: visitor.owner } },
        { $group: { _id: '$category', count: { $sum: 1 }, avgPrice: { $avg: '$price' }, minPrice: { $min: '$price' }, maxPrice: { $max: '$price' }, totalStock: { $sum: '$stock' } } },
        { $sort: { _id: 1 } },
      ],
      ...call(visitor),
    });
    return {
      kind: 'aggregate',
      groups: groups.map((group) => ({
        category: group._id,
        count: group.count,
        avgPrice: money(group.avgPrice),
        minPrice: money(group.minPrice),
        maxPrice: money(group.maxPrice),
        totalStock: group.totalStock,
      })),
      detail: `Grouped ${groups.reduce((sum, group) => sum + group.count, 0)} documents by category.`,
    };
  },

  async stream(service, visitor, input) {
    const batchSize = boundedInteger(input.batchSize, 'batchSize', 5, 500, 100);
    const strategy = boundedString(input.strategy, 'strategy', 8, 'cursor');
    if (!['cursor', 'keyset'].includes(strategy)) throw demoError('strategy must be cursor or keyset.');
    const batches = [];
    let totalStock = 0;
    let totalDocs = null;
    let processed = 0;
    let batchCount = 0;
    const started = performance.now();
    for await (const batch of service.iterateBatches({
      model: MODEL,
      filter: { owner: visitor.owner },
      batchSize,
      strategy,
      includeTotal: true,
      projection: { stock: 1 },
      lean: true,
      ...call(visitor),
    })) {
      totalDocs = batch.totalDocs ?? totalDocs;
      processed = batch.processed;
      batchCount += 1;
      totalStock += batch.docs.reduce((sum, doc) => sum + doc.stock, 0);
      if (batches.length < 60) batches.push({ batchIndex: batch.batchIndex, size: batch.docs.length, processed: batch.processed, hasCursor: Boolean(batch.nextCursor) });
    }
    return {
      kind: 'stream',
      strategy,
      batchSize,
      batches,
      batchCount,
      totalDocs,
      totalStock,
      elapsedMs: Math.round(performance.now() - started),
      detail: batchCount ? `Streamed ${processed} documents in ${batchCount} bounded batches.` : 'Nothing to stream. Seed some data first.',
    };
  },

  async update(service, visitor, input) {
    const category = boundedString(input.category, 'category', 16, '');
    if (!CATEGORIES.includes(category)) throw demoError(`category must be one of ${CATEGORIES.join(', ')}.`);
    const percent = boundedInteger(input.percent, 'percent', -50, 100, 10);
    const result = await service.updateMany({
      model: MODEL,
      filter: { owner: visitor.owner, category },
      update: { $mul: { price: 1 + percent / 100 } },
      ...call(visitor),
    });
    return {
      kind: 'update',
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      detail: `Adjusted ${result.modifiedCount} ${category} prices by ${percent}%.`,
    };
  },

  async guard(service, visitor, input) {
    const scenario = boundedString(input.scenario, 'scenario', 16, 'deleteAll');
    const attempts = {
      deleteAll: () => service.deleteMany({ model: MODEL, filter: {}, ...call(visitor) }),
      updateAll: () => service.updateMany({ model: MODEL, filter: { $and: [{}] }, update: { $set: { stock: 0 } }, ...call(visitor) }),
      outStage: () => service.aggregate({ model: MODEL, pipeline: [{ $match: { owner: visitor.owner } }, { $out: 'handoo_playground_copy' }], ...call(visitor) }),
    };
    if (!Object.hasOwn(attempts, scenario)) throw demoError('scenario must be deleteAll, updateAll, or outStage.');
    try {
      await attempts[scenario]();
    } catch (error) {
      if (isMongoDockError(error)) {
        return {
          kind: 'guard',
          blocked: true,
          scenario,
          code: error.code,
          databaseOutcome: error.databaseOutcome,
          message: error.message,
          detail: `Blocked before dispatch with ${error.code}.`,
        };
      }
      throw error;
    }
    throw demoError('The guard unexpectedly allowed this operation.', 500);
  },

  async transaction(service, visitor, input) {
    const quantity = boundedInteger(input.quantity, 'quantity', 1, 50, 5);
    const forceAbort = boundedBoolean(input.forceAbort, 'forceAbort', false);
    const [from, to] = await service.find({
      model: MODEL,
      filter: { owner: visitor.owner, stock: { $gte: quantity } },
      sort: { stock: -1 },
      limit: 2,
      projection,
      lean: true,
      ...call(visitor),
    });
    if (!from || !to) throw demoError(`Seed at least two documents with ${quantity}+ stock first.`);
    const ids = [from._id, to._id];
    const snapshotStock = async () => {
      const docs = await service.find({ model: MODEL, filter: { owner: visitor.owner, _id: { $in: ids } }, projection, lean: true, ...bookkeeping(visitor) });
      return ids.map((id) => docs.find((doc) => doc._id.equals(id))).filter(Boolean).map(toItem);
    };
    const before = await snapshotStock();
    let outcome;
    try {
      await service.withTransaction(async (tx) => {
        await tx.ops.updateOne({ model: MODEL, filter: { _id: from._id, owner: visitor.owner }, update: { $inc: { stock: -quantity } } });
        await tx.ops.updateOne({ model: MODEL, filter: { _id: to._id, owner: visitor.owner }, update: { $inc: { stock: quantity } } });
        if (forceAbort) throw demoError('Simulated failure after both writes.', 409, { code: 'SIMULATED_ABORT' });
      }, call(visitor));
      outcome = { committed: true, detail: `Committed: moved ${quantity} units of stock atomically.` };
    } catch (error) {
      if (error.code === 'SIMULATED_ABORT') {
        outcome = { committed: false, aborted: true, detail: 'Aborted after both writes: MongoDB rolled them back.' };
      } else if (error.code === 'ERR_TRANSACTION') {
        outcome = {
          committed: false,
          unsupported: true,
          code: error.code,
          databaseOutcome: error.databaseOutcome,
          detail: 'This MongoDB deployment rejected the transaction (a replica set is required).',
        };
      } else {
        throw error;
      }
    }
    return { kind: 'transaction', quantity, before, after: await snapshotStock(), ...outcome };
  },

  async health(service) {
    const report = await service.healthCheck({ probe: true, timeoutMS: 3000 });
    const connection = Object.values(report.connections)[0];
    return {
      kind: 'health',
      ready: report.ready,
      checkedAt: report.checkedAt,
      connection: { name: connection?.name, state: connection?.state, ready: connection?.ready, latencyMs: connection?.latencyMs, probed: connection?.probed },
      detail: report.ready ? `Ping answered in ${connection?.latencyMs ?? '?'} ms.` : 'The connection is not ready.',
    };
  },

  async reset(service, visitor) {
    const result = await service.deleteMany({ model: MODEL, filter: { owner: visitor.owner }, ...call(visitor) });
    return { kind: 'reset', deletedCount: result.deletedCount, detail: `Deleted ${result.deletedCount} of your documents.` };
  },
};

router.post('/operation', async (request, response) => {
  let endRun;
  try {
    const input = requireRecord(request.body);
    const action = boundedString(input.action, 'action', 16);
    if (!Object.hasOwn(operations, action)) throw demoError(`action must be one of ${Object.keys(operations).join(', ')}.`);
    const visitor = await getVisitor(request, response);
    const service = await getService();
    endRun = beginRun();
    const result = await operations[action](service, visitor, input);
    const count = await countOwned(service, visitor);
    response.json({ ...result, count, activity: visitor.activity });
  } catch (error) {
    sendError(response, error);
  } finally {
    endRun?.();
  }
});

export default router;
