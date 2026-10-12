const form = document.querySelector('#cache-form');
const status = document.querySelector('#cache-status');
const entries = document.querySelector('#cache-entries');
const metrics = document.querySelector('#cache-metrics');
const activity = document.querySelector('#cache-activity');
const action = document.querySelector('#cache-action');

function recencyLabel(index, count) {
  if (count === 1) return 'only entry';
  if (index === 0) return 'least recently used';
  if (index === count - 1) return 'most recently used';
  return 'in memory';
}

function render(data) {
  const stats = data.stats;
  LabDemo.metrics(metrics, [
    ['Entries', stats.entries, 'LRU capacity 6'],
    ['Hit rate', `${(stats.hitRate * 100).toFixed(0)}%`, `${stats.hits} hits · ${stats.misses} misses`],
    ['Sets', stats.sets, `${stats.deletes} explicit deletes`],
    ['Evictions', stats.evictions, `${stats.expired} expired entries`],
  ]);
  entries.className = data.entries.length ? 'result-list' : 'empty-output';
  entries.innerHTML = data.entries.length
    ? data.entries.map((entry, index) => `<div class="result-row"><span><strong>${LabDemo.escape(entry.key)}</strong><small>${LabDemo.escape(entry.value)} · ${recencyLabel(index, data.entries.length)}</small></span><span class="result-pill">${index + 1} / 6</span></div>`).join('')
    : 'Nothing in the cache yet. Add your first key.';
  activity.innerHTML = data.activity.map((item) => `<div class="result-row"><span><strong>${LabDemo.escape(item.action.toUpperCase())}${item.key ? ` · ${LabDemo.escape(item.key)}` : ''}</strong><small>${LabDemo.escape(item.detail)}</small></span><span class="output-note">${new Date(item.at).toLocaleTimeString()}</span></div>`).join('');
}

function updateFields() {
  const isClear = action.value === 'clear';
  const isSet = action.value === 'set';
  document.querySelector('#key-field').hidden = isClear;
  document.querySelector('#value-field').hidden = !isSet;
  document.querySelector('#ttl-field').hidden = !isSet;
}

action.addEventListener('change', updateFields);
updateFields();

async function refresh() {
  try {
    render(await LabDemo.get('/api/cache-bridge/state'));
  } catch (error) {
    entries.className = 'empty-output';
    entries.textContent = error.message;
    LabDemo.status(status, 'The private cache could not be loaded.', 'error');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  LabDemo.status(status, 'Running the actual Cache Bridge operation…');
  try {
    const data = await LabDemo.post('/api/cache-bridge/operation', {
      action: action.value,
      key: document.querySelector('#cache-key').value,
      value: document.querySelector('#cache-value').value,
      ttlSeconds: Number(document.querySelector('#cache-ttl').value),
    });
    render(data);
    LabDemo.status(status, data.detail, 'success');
  } catch (error) {
    LabDemo.status(status, error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

refresh();
