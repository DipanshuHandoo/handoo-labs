window.LabDemo = {
  async post(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
    return payload;
  },
  async get(path) {
    const response = await fetch(path, { credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
    return payload;
  },
  async postStream(path, body, onEvent) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error ?? `Request failed (${response.status})`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result;
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop();
      for (const message of events) {
        const event = message.match(/^event:\s*(.+)$/m)?.[1];
        const dataLine = message.match(/^data:\s*(.+)$/m)?.[1];
        if (!event || !dataLine) continue;
        const data = JSON.parse(dataLine);
        if (event === 'error') throw new Error(data.error ?? 'The task pool could not complete.');
        if (event === 'complete') result = data;
        onEvent?.(event, data);
      }
      if (done) break;
    }
    if (!result) throw new Error('The task pool closed before returning its results.');
    return result;
  },
  escape(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  },
  status(node, text, kind = '') {
    node.textContent = text;
    node.dataset.kind = kind;
  },
  metrics(target, values) {
    target.innerHTML = values.map(([label, value, note = '']) => `<div class="metric-card"><span>${this.escape(label)}</span><strong>${this.escape(value)}</strong>${note ? `<small>${this.escape(note)}</small>` : ''}</div>`).join('');
  },
};
