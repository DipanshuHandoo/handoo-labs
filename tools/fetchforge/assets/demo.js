const form = document.querySelector('#fetch-form');
const status = document.querySelector('#fetch-status');
const metrics = document.querySelector('#fetch-metrics');
const results = document.querySelector('#fetch-results');
const events = document.querySelector('#fetch-events');
const circuit = document.querySelector('#circuit-state');

function render(data) {
  const value = data.metrics ?? data;
  LabDemo.metrics(metrics, [
    ['Requests', value.requests ?? 0, `${value.succeeded ?? 0} successful · ${value.failed ?? 0} failed`],
    ['Attempts', value.attempts ?? 0, `${value.retries ?? 0} retries`],
    ['Cache hits', data.cache?.hits ?? 0, `${data.cache?.misses ?? 0} misses`],
    ['Circuit', data.circuit ?? 'closed', `${value.circuitRejections ?? 0} rejected`],
  ]);
  circuit.textContent = `CIRCUIT ${(data.circuit ?? 'closed').toUpperCase()}`;
  circuit.classList.toggle('is-error', data.circuit === 'open');
  if (data.results) {
    results.className = 'result-list';
    results.innerHTML = data.results.map((result, index) => `<div class="result-row"><span><strong>Request ${index + 1}${result.cache === 'hit' ? ' · CACHE HIT' : ''}</strong><small>${result.error ? `${LabDemo.escape(result.code)} · ${LabDemo.escape(result.error)}` : `HTTP ${result.status} · ${result.attempts} attempt${result.attempts === 1 ? '' : 's'} · ${result.durationMs} ms · ${LabDemo.escape(result.cache)}`}</small></span><span class="result-pill ${result.error ? 'is-error' : ''}">${result.error ? 'FAILED' : result.status}</span></div>`).join('');
  }
  if (data.events?.length) {
    events.innerHTML = `<div class="output-title validation-heading">RESPONSE-CACHE EVENTS</div>${data.events.map((event) => `<div class="result-row"><span><strong>${LabDemo.escape(event.type.toUpperCase())}</strong><small>${LabDemo.escape(event.url)}</small></span></div>`).join('')}`;
  } else {
    events.innerHTML = '';
  }
}

async function refresh() {
  try {
    render(await LabDemo.get('/api/fetchforge/state'));
  } catch (error) {
    LabDemo.status(status, error.message, 'error');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.querySelector('#fetch-run');
  button.disabled = true;
  LabDemo.status(status, 'Sending requests through your FetchForge client…');
  try {
    const data = await LabDemo.post('/api/fetchforge/run', {
      scenario: document.querySelector('#fetch-scenario').value,
      requestCount: Number(document.querySelector('#fetch-count').value),
      retries: Number(document.querySelector('#fetch-retries').value),
      failureThreshold: Number(document.querySelector('#fetch-threshold').value),
      timeoutMs: Number(document.querySelector('#fetch-timeout').value),
      failuresBeforeSuccess: Number(document.querySelector('#fetch-failures').value),
      responseDelayMs: Number(document.querySelector('#fetch-delay').value),
      bypassCache: document.querySelector('#fetch-bypass').checked,
    });
    render(data);
    const failed = data.results.filter((item) => item.error).length;
    LabDemo.status(status, `${data.results.length} request${data.results.length === 1 ? '' : 's'} finished; ${failed} failed; circuit ${data.circuit}.`, failed ? 'error' : 'success');
  } catch (error) {
    LabDemo.status(status, error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#fetch-reset').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await LabDemo.post('/api/fetchforge/reset', {});
    results.className = 'empty-output';
    results.textContent = 'The client, metrics, circuit, and response cache have been reset.';
    events.innerHTML = '';
    await refresh();
    LabDemo.status(status, 'Your private client is fresh and ready.', 'success');
  } catch (error) {
    LabDemo.status(status, error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

refresh();
