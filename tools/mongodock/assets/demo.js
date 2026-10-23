const $ = (selector) => document.querySelector(selector);
const escape = (value) => LabDemo.escape(value ?? '');
const API = '/api/mongodock';
const formatNumber = (value) => (value === null || value === undefined ? '—' : Number(value).toLocaleString());
const formatMoney = (value) => `$${Number(value).toFixed(2)}`;

const state = {
  available: false,
  categories: ['books', 'games', 'garden', 'music', 'tools'],
  maxDocs: 2000,
  ttlMinutes: 60,
  count: 0,
  health: null,
  query: { mode: 'paginate', page: 1, cursors: [undefined], cursorIndex: 0, last: null },
};

const actionButtons = () => document.querySelectorAll('main button, main input, main select');

function bindRange(input, output, format = (value) => value, onChange) {
  const update = () => {
    output.textContent = format(input.value);
    onChange?.(input.value);
  };
  input.addEventListener('input', update);
  update();
}

bindRange($('#md-count'), $('#md-count-out'));
bindRange($('#md-batch'), $('#md-batch-out'), undefined, (value) => { $('#md-code-batch').textContent = value; });
bindRange($('#md-concurrency'), $('#md-concurrency-out'), undefined, (value) => { $('#md-code-concurrency').textContent = value; });
bindRange($('#md-invalid'), $('#md-invalid-out'));
bindRange($('#md-limit'), $('#md-limit-out'));
bindRange($('#md-percent'), $('#md-percent-out'), (value) => `${Number(value) > 0 ? '+' : ''}${value}%`);
bindRange($('#md-qty'), $('#md-qty-out'));

function fillCategories() {
  const options = state.categories.map((category) => `<option value="${escape(category)}">${escape(category)}</option>`).join('');
  $('#md-category').innerHTML = `<option value="">All categories</option>${options}`;
  $('#md-update-category').innerHTML = options;
}

function renderOverview() {
  const health = state.health;
  $('#md-connection-tag').textContent = !state.available ? 'OFFLINE' : health?.ready ? 'CONNECTED' : 'NOT READY';
  LabDemo.metrics($('#md-metrics'), [
    ['Connection', state.available ? (health?.ready ? 'Ready' : health?.state ?? 'Unknown') : 'Offline', health?.latencyMs ? `ping ${Number(health.latencyMs).toFixed(1)} ms` : 'healthCheck()'],
    ['Your documents', formatNumber(state.count), `cap ${formatNumber(state.maxDocs)} per visitor`],
    ['Isolation', 'Per session', 'owner-scoped filters'],
    ['Auto cleanup', `${state.ttlMinutes} min`, 'TTL index + session expiry'],
  ]);
  $('#md-max-docs').textContent = formatNumber(state.maxDocs);
  $('#md-ttl').textContent = state.ttlMinutes;
}

function renderActivity(activity = []) {
  const root = $('#md-activity');
  if (!activity.length) {
    root.innerHTML = '<div class="empty-output">Operations you run appear here.</div>';
    return;
  }
  root.innerHTML = activity.map((item) => {
    const ok = item.outcome === 'succeeded';
    return `<div class="result-row md-log ${ok ? '' : 'md-log-bad'}"><span><strong>${escape(item.method)}()</strong><small>invocation <b>${escape(item.outcome)}</b> · database <b>${escape(item.databaseOutcome)}</b>${item.code ? ` · ${escape(item.code)}` : ''}</small></span><span class="md-log-meta"><span class="result-pill">${escape(item.durationMs)} ms</span><span class="output-note">${new Date(item.at).toLocaleTimeString()}</span></span></div>`;
  }).join('');
}

function applyCommon(data) {
  if (typeof data.count === 'number') state.count = data.count;
  if (data.activity) renderActivity(data.activity);
  renderOverview();
}

function setOffline(reason) {
  state.available = false;
  $('#md-offline').hidden = false;
  $('#md-offline-text').textContent = reason === 'unreachable'
    ? 'The demo database is unreachable right now. Try again in a minute.'
    : 'This server has no MongoDB configured for the demo (set MONGODOCK_DEMO_URI).';
  for (const element of actionButtons()) {
    if (element.closest('form, .md-toolbar, .output-head')) element.disabled = true;
  }
  renderOverview();
}

async function operation(body) {
  const data = await LabDemo.post(`${API}/operation`, body);
  applyCommon(data);
  return data;
}

async function withButton(button, task) {
  button.disabled = true;
  try {
    await task();
  } finally {
    button.disabled = !state.available;
  }
}

async function loadState() {
  try {
    const data = await LabDemo.get(`${API}/state`);
    if (data.categories) state.categories = data.categories;
    if (data.maxDocs) state.maxDocs = data.maxDocs;
    if (data.ttlMinutes) state.ttlMinutes = data.ttlMinutes;
    fillCategories();
    if (!data.available) return setOffline(data.reason);
    state.available = true;
    state.health = data.health;
    applyCommon(data);
    if (state.count > 0) runQuery();
  } catch (error) {
    fillCategories();
    setOffline('unreachable');
    LabDemo.status($('#md-top-status'), error.message, 'error');
  }
}

$('#md-health').addEventListener('click', (event) => withButton(event.currentTarget, async () => {
  try {
    const data = await operation({ action: 'health' });
    state.health = { ready: data.ready, latencyMs: data.connection.latencyMs, state: data.connection.state };
    renderOverview();
    LabDemo.status($('#md-top-status'), data.detail, data.ready ? 'success' : 'error');
  } catch (error) {
    LabDemo.status($('#md-top-status'), error.message, 'error');
  }
}));

$('#md-reset').addEventListener('click', (event) => withButton(event.currentTarget, async () => {
  try {
    const data = await operation({ action: 'reset' });
    LabDemo.status($('#md-top-status'), data.detail, 'success');
    resetQuery();
    renderTable(null);
  } catch (error) {
    LabDemo.status($('#md-top-status'), error.message, 'error');
  }
}));

// Seeding -------------------------------------------------------------------
function batchCell(batch) {
  const cell = $(`#md-batch-${batch.batchIndex}`);
  if (!cell) return;
  cell.className = `md-batch md-batch-${batch.status}`;
  cell.title = `Batch ${batch.batchIndex + 1}: ${batch.status} · ${batch.succeeded}/${batch.size} written · ${batch.elapsedMs} ms`;
}

$('#md-seed-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type=submit]');
  const status = $('#md-seed-status');
  const body = {
    count: Number($('#md-count').value),
    batchSize: Number($('#md-batch').value),
    concurrency: Number($('#md-concurrency').value),
    invalidCount: Number($('#md-invalid').value),
  };
  const batchesRoot = $('#md-batches');
  batchesRoot.innerHTML = '';
  $('#md-report').innerHTML = '';
  $('#md-diagnostics').innerHTML = '';
  let finished = 0;
  let total = 0;
  await withButton(button, async () => {
    LabDemo.status(status, 'Streaming batches through the slot pool…');
    try {
      const result = await LabDemo.postStream(`${API}/seed`, body, (type, data) => {
        if (type === 'start') {
          total = data.totalBatches;
          batchesRoot.innerHTML = Array.from({ length: total }, (_, index) => `<span class="md-batch" id="md-batch-${index}" title="Batch ${index + 1}: queued"></span>`).join('');
          $('#md-seed-note').textContent = `${total} batches · ${data.concurrency} in flight`;
        } else if (type === 'batch') {
          finished += 1;
          batchCell(data);
          $('#md-seed-note').textContent = `${finished} / ${total} batches settled`;
        }
      });
      const report = result.report;
      LabDemo.metrics($('#md-report'), [
        ['Status', report.status, `${report.batches.total} batches · ${report.batches.partial} partial`],
        ['Inserted', formatNumber(report.insertedCount), `${formatNumber(report.attempted)} attempted`],
        ['Failed', formatNumber(report.failed), `${formatNumber(report.uncertain)} uncertain`],
        ['Elapsed', `${formatNumber(report.elapsedMs)} ms`, `${body.concurrency} concurrent slots`],
      ]);
      $('#md-diagnostics').innerHTML = report.diagnostics.samples.slice(0, 6).map((sample) => `<div class="result-row"><span><strong>Input #${escape(sample.index ?? '—')}</strong><small>batch ${escape(sample.batchIndex + 1)} · ${escape(sample.kind)} failure${sample.code ? ` · code ${escape(sample.code)}` : ''}</small></span><span class="result-pill">diagnostic</span></div>`).join('');
      applyCommon(result);
      LabDemo.status(status, `Report status "${report.status}": ${report.insertedCount} inserted, ${report.failed} rejected by validation.`, report.status === 'completed' ? 'success' : '');
      resetQuery();
      runQuery();
    } catch (error) {
      LabDemo.status(status, error.message, 'error');
    }
  });
});

// Query explorer ------------------------------------------------------------
const queryMode = () => document.querySelector('input[name="md-mode"]:checked').value;

function resetQuery() {
  state.query.page = 1;
  state.query.cursors = [undefined];
  state.query.cursorIndex = 0;
}

function queryBody() {
  const mode = queryMode();
  return {
    action: mode,
    category: $('#md-category').value,
    sortField: $('#md-sort').value,
    direction: $('#md-direction').value,
    limit: Number($('#md-limit').value),
    ...(mode === 'paginate' ? { page: state.query.page } : { cursor: state.query.cursors[state.query.cursorIndex] }),
  };
}

function renderTable(data) {
  const table = $('#md-table');
  const sortField = $('#md-sort').value;
  if (!data || !data.docs.length) {
    table.className = 'empty-output';
    table.textContent = state.count ? 'No documents match this filter.' : 'Seed some documents, then run a query.';
    $('#md-prev').disabled = true;
    $('#md-next').disabled = true;
    $('#md-page-label').textContent = '';
    $('#md-cursor').hidden = true;
    return;
  }
  const columns = [['sku', 'SKU'], ['name', 'name'], ['category', 'category'], ['price', 'price'], ['stock', 'stock']];
  table.className = 'md-table-wrap';
  table.innerHTML = `<table class="md-table"><thead><tr>${columns.map(([key, label]) => `<th class="${key === sortField ? 'md-sorted' : ''}">${escape(label)}</th>`).join('')}</tr></thead><tbody>${data.docs.map((doc) => `<tr>${columns.map(([key]) => `<td class="${key === sortField ? 'md-sorted' : ''}">${key === 'price' ? formatMoney(doc.price) : key === 'category' ? `<span class="md-tag md-tag-${escape(doc.category)}">${escape(doc.category)}</span>` : escape(doc[key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

  if (data.kind === 'paginate') {
    $('#md-prev').disabled = !data.hasPrevPage;
    $('#md-next').disabled = !data.hasNextPage;
    $('#md-page-label').textContent = `page ${data.page} / ${data.totalPages || 1}`;
    $('#md-query-meta').textContent = `${formatNumber(data.totalDocs)} total · skip ${(data.page - 1) * data.limit}`;
    $('#md-cursor').hidden = true;
  } else {
    $('#md-prev').disabled = state.query.cursorIndex === 0;
    $('#md-next').disabled = !data.hasNextPage;
    $('#md-page-label').textContent = `keyset page ${state.query.cursorIndex + 1}`;
    $('#md-query-meta').textContent = 'no count query · no skip';
    const cursor = $('#md-cursor');
    cursor.hidden = !data.nextCursor;
    if (data.nextCursor) cursor.innerHTML = `<span class="output-note">nextCursor (${data.nextCursor.length} chars, bound to this query)</span><code>${escape(data.nextCursor.slice(0, 96))}…</code>`;
  }
}

async function runQuery() {
  const status = $('#md-query-status');
  $('#md-query-title').textContent = queryMode() === 'paginate' ? 'paginate() RESULTS' : 'paginateCursor() RESULTS';
  try {
    const data = await operation(queryBody());
    state.query.last = data;
    if (data.kind === 'cursor' && data.nextCursor) state.query.cursors[state.query.cursorIndex + 1] = data.nextCursor;
    renderTable(data);
    LabDemo.status(status, data.detail, 'success');
  } catch (error) {
    LabDemo.status(status, error.message, 'error');
  }
}

$('#md-query-form').addEventListener('submit', (event) => {
  event.preventDefault();
  resetQuery();
  withButton(event.currentTarget.querySelector('button[type=submit]'), runQuery);
});

for (const element of [...document.querySelectorAll('input[name="md-mode"]'), $('#md-category'), $('#md-sort'), $('#md-direction')]) {
  element.addEventListener('change', () => {
    resetQuery();
    if (state.available && state.count) runQuery();
  });
}

$('#md-next').addEventListener('click', () => {
  if (queryMode() === 'paginate') state.query.page += 1;
  else state.query.cursorIndex += 1;
  runQuery();
});

$('#md-prev').addEventListener('click', () => {
  if (queryMode() === 'paginate') state.query.page = Math.max(1, state.query.page - 1);
  else state.query.cursorIndex = Math.max(0, state.query.cursorIndex - 1);
  runQuery();
});

// Aggregate & stream --------------------------------------------------------
function applyWidths(root) {
  for (const bar of root.querySelectorAll('[data-width]')) bar.style.width = `${bar.dataset.width}%`;
}

$('#md-aggregate').addEventListener('click', (event) => withButton(event.currentTarget, async () => {
  const root = $('#md-chart');
  try {
    const data = await operation({ action: 'aggregate' });
    if (!data.groups.length) {
      root.className = 'empty-output';
      root.textContent = 'Nothing to group yet. Seed some documents first.';
      return;
    }
    const maxCount = Math.max(...data.groups.map((group) => group.count));
    const maxAvg = Math.max(...data.groups.map((group) => group.avgPrice));
    root.className = 'md-chart';
    root.innerHTML = data.groups.map((group) => `<div class="md-bar-row"><span class="md-tag md-tag-${escape(group.category)}">${escape(group.category)}</span><div class="md-bars"><div class="md-bar md-bar-count" data-width="${Math.max(4, (group.count / maxCount) * 100).toFixed(1)}"><span>${group.count} docs</span></div><div class="md-bar md-bar-price" data-width="${Math.max(4, (group.avgPrice / maxAvg) * 100).toFixed(1)}"><span>avg ${formatMoney(group.avgPrice)}</span></div></div><small>${formatMoney(group.minPrice)}–${formatMoney(group.maxPrice)} · stock ${formatNumber(group.totalStock)}</small></div>`).join('');
    applyWidths(root);
  } catch (error) {
    root.className = 'empty-output';
    root.textContent = error.message;
  }
}));

$('#md-stream').addEventListener('click', (event) => withButton(event.currentTarget, async () => {
  const root = $('#md-stream-out');
  try {
    const data = await operation({ action: 'stream', strategy: $('#md-strategy').value, batchSize: Number($('#md-stream-size').value) });
    if (!data.batchCount) {
      root.className = 'empty-output';
      root.textContent = data.detail;
      return;
    }
    root.className = 'md-stream';
    root.innerHTML = `<div class="metric-grid md-mini">${[
      ['Batches', data.batchCount],
      ['Documents', formatNumber(data.totalDocs)],
      ['Σ stock', formatNumber(data.totalStock)],
      ['Elapsed', `${data.elapsedMs} ms`],
    ].map(([label, value]) => `<div class="metric-card"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`).join('')}</div><div class="md-chips">${data.batches.map((batch) => `<span class="md-chip" title="processed ${batch.processed}${batch.hasCursor ? ' · keyset cursor issued' : ''}">#${batch.batchIndex + 1}<b>${batch.size}</b></span>`).join('')}${data.batchCount > data.batches.length ? `<span class="md-chip md-chip-more">+${data.batchCount - data.batches.length}</span>` : ''}</div><p class="md-muted">${escape(data.detail)} Strategy <code>${escape(data.strategy)}</code>: ${data.strategy === 'keyset' ? 'repeated keyset pages, each yielding a resumable cursor.' : 'one server cursor for the whole walk.'}</p>`;
  } catch (error) {
    root.className = 'empty-output';
    root.textContent = error.message;
  }
}));

// Writes, guards, transactions ---------------------------------------------
$('#md-update-form').addEventListener('submit', (event) => {
  event.preventDefault();
  withButton(event.currentTarget.querySelector('button[type=submit]'), async () => {
    const status = $('#md-update-status');
    try {
      const data = await operation({ action: 'update', category: $('#md-update-category').value, percent: Number($('#md-percent').value) });
      LabDemo.status(status, `${data.detail} (matched ${data.matchedCount}).`, 'success');
      if (state.query.last) runQuery();
    } catch (error) {
      LabDemo.status(status, error.message, 'error');
    }
  });
});

$('#md-guard-form').addEventListener('submit', (event) => {
  event.preventDefault();
  withButton(event.currentTarget.querySelector('button[type=submit]'), async () => {
    const root = $('#md-guard-out');
    try {
      const data = await operation({ action: 'guard', scenario: $('#md-guard').value });
      root.className = 'md-guard-out md-guard-blocked';
      root.innerHTML = `<strong>🛡 Blocked · ${escape(data.code)}</strong><span>${escape(data.message)}</span><small>databaseOutcome: <b>${escape(data.databaseOutcome)}</b> — nothing was sent to MongoDB.</small>`;
    } catch (error) {
      root.className = 'md-guard-out md-guard-error';
      root.textContent = error.message;
    }
  });
});

function stockRows(before, after) {
  return before.map((item, index) => {
    const next = after[index];
    const delta = next ? next.stock - item.stock : 0;
    return `<div class="md-tx-row"><span>${escape(item.name)}</span><span>${formatNumber(item.stock)} → <b>${formatNumber(next?.stock)}</b></span><span class="md-delta ${delta > 0 ? 'md-up' : delta < 0 ? 'md-down' : ''}">${delta > 0 ? '+' : ''}${delta}</span></div>`;
  }).join('');
}

$('#md-tx-form').addEventListener('submit', (event) => {
  event.preventDefault();
  withButton(event.currentTarget.querySelector('button[type=submit]'), async () => {
    const root = $('#md-tx-out');
    try {
      const data = await operation({ action: 'transaction', quantity: Number($('#md-qty').value), forceAbort: $('#md-abort').checked });
      const kind = data.committed ? 'md-guard-ok' : data.aborted ? 'md-guard-blocked' : 'md-guard-error';
      const title = data.committed ? '✓ Committed' : data.aborted ? '↺ Rolled back' : `⚠ ${escape(data.code ?? 'Not supported')}`;
      root.className = `md-guard-out ${kind}`;
      root.innerHTML = `<strong>${title}</strong><span>${escape(data.detail)}</span>${stockRows(data.before, data.after)}`;
      if (state.query.last) runQuery();
    } catch (error) {
      root.className = 'md-guard-out md-guard-error';
      root.textContent = error.message;
    }
  });
});

renderOverview();
loadState();
