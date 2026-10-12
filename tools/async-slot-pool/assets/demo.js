const form = document.querySelector('#pool-form');
const status = document.querySelector('#pool-status');
const metrics = document.querySelector('#pool-metrics');
const results = document.querySelector('#task-results');
const progressNote = document.querySelector('#progress-note');
const failureLog = document.querySelector('#failure-log');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  LabDemo.status(status, 'Tasks are working through their slots…');
  progressNote.textContent = 'Pool running';
  failureLog.innerHTML = '';
  results.className = 'result-list';
  results.innerHTML = '<div class="result-row">Waiting for task outcomes…</div>';
  try {
    const data = await LabDemo.postStream('/api/async-slot-pool/run', {
      taskCount: Number(document.querySelector('#task-count').value),
      concurrency: Number(document.querySelector('#concurrency').value),
      retries: Number(document.querySelector('#retries').value),
      timeout: Number(document.querySelector('#timeout').value),
      delay: Number(document.querySelector('#delay').value),
      failCount: Number(document.querySelector('#fail-count').value),
      failureMode: document.querySelector('#failure-mode').value,
    }, (eventName, update) => {
      if (eventName === 'progress') {
        const total = update.total ?? Number(document.querySelector('#task-count').value);
        progressNote.textContent = `${update.done} / ${total} settled · ${update.pending ?? '?'} queued`;
        LabDemo.metrics(metrics, [
          ['Settled', `${update.done} / ${total}`, 'Live package callback'],
          ['Succeeded', update.succeeded, 'Tasks complete so far'],
          ['Failed', update.failed, 'Failures so far'],
          ['Pending', update.pending ?? '—', 'Items waiting to start'],
        ]);
      }
    });
    LabDemo.metrics(metrics, [
      ['Completed', data.stats.total, `${data.stats.succeeded} succeeded · ${data.stats.failed} failed`],
      ['Pool duration', `${data.stats.durationMs} ms`, `${data.stats.aborted ? 'Stopped early' : 'Run complete'}`],
      ['Retries', data.failures.filter((item) => item.willRetry).length, `${data.failures.length} failed attempts`],
      ['Succeeded', data.stats.succeeded, 'Tasks that finished'],
      ['Failed', data.stats.failed, 'Tasks with an error'],
      ['Concurrency', document.querySelector('#concurrency').value, 'Maximum active slots'],
    ]);
    results.innerHTML = [...data.succeeded.map((item) => `<div class="result-row"><span><strong>${LabDemo.escape(item.item.id)}</strong><small>Completed on attempt ${item.result.attempt}</small></span><span class="result-pill">SUCCESS</span></div>`), ...data.failed.map((item) => `<div class="result-row"><span><strong>${LabDemo.escape(item.item.id)}</strong><small>${LabDemo.escape(item.error)} · ${item.attempts} attempts</small></span><span class="result-pill is-error">FAILED</span></div>`)].join('');
    if (data.failures.length) {
      failureLog.innerHTML = `<pre class="code-preview">${data.failures.map((item) => `${item.id} · attempt ${item.attempt} · ${item.willRetry ? 'retrying' : 'giving up'} · ${item.error}`).map(LabDemo.escape).join('\n')}</pre>`;
    }
    progressNote.textContent = `${data.stats.total} / ${data.stats.total} tasks settled`;
    LabDemo.status(status, `${data.stats.succeeded} task${data.stats.succeeded === 1 ? '' : 's'} succeeded; ${data.stats.failed} failed.`, data.stats.failed ? 'error' : 'success');
  } catch (error) {
    results.className = 'empty-output';
    results.textContent = error.message;
    LabDemo.status(status, 'The run could not be completed.', 'error');
  } finally {
    button.disabled = false;
  }
});
