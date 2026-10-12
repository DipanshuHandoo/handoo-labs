const form = document.querySelector('#excel-form');
const status = document.querySelector('#excel-status');
const metrics = document.querySelector('#excel-metrics');
const output = document.querySelector('#excel-output');
const size = document.querySelector('#excel-size');
let lastRows = [];

function getRows() {
  try {
    const rows = JSON.parse(document.querySelector('#excel-rows').value);
    if (!Array.isArray(rows)) throw new Error('Sample data must be a JSON array.');
    lastRows = rows;
    return rows;
  } catch (error) {
    throw new Error(`Please check the sample JSON: ${error.message}`);
  }
}

function renderSheet(sheet) {
  const headers = sheet.columns.map((column) => `<th scope="col">${LabDemo.escape(column.header)}</th>`).join('');
  const rows = sheet.rows.slice(0, 12).map((row) => `<tr>${sheet.columns.map((column) => `<td>${LabDemo.escape(row[column.key] ?? '')}</td>`).join('')}</tr>`).join('');
  return `<div class="sheet-preview"><table><caption>${LabDemo.escape(sheet.name)} · ${sheet.rows.length} rows</caption><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.querySelector('#preview-button');
  button.disabled = true;
  LabDemo.status(status, 'Writing and reading your workbook…');
  try {
    const data = await LabDemo.post('/api/excelio/preview', {
      rows: getRows(),
      useWorker: document.querySelector('#excel-worker').checked,
    });
    LabDemo.metrics(metrics, [
      ['Sheets', data.workbook.length, 'Real workbook worksheets'],
      ['Rows read', data.stats.totalRows, 'Read back from XLSX'],
      ['Validation', data.validationErrors.length, 'Row issues found'],
    ]);
    output.className = '';
    output.innerHTML = `${data.workbook.map(renderSheet).join('')}${data.validationErrors.length ? `<div class="sheet-preview"><div class="output-title validation-heading">VALIDATION FEEDBACK</div><div class="validation-list">${data.validationErrors.map((error) => `<div class="validation-item">${LabDemo.escape(error.sheet)} row ${LabDemo.escape(error.row)} · ${LabDemo.escape(error.column ?? 'row')} · ${LabDemo.escape(error.message)}</div>`).join('')}</div></div>` : '<div class="info-banner validation-success">Every row passed the read-side validation callback.</div>'}`;
    size.textContent = `${(data.stats.bytes / 1024).toFixed(1)} KB · ${data.writerMode}`;
    LabDemo.status(status, `Workbook round-trip complete in ${data.stats.durationMs} ms.`, data.validationErrors.length ? 'error' : 'success');
  } catch (error) {
    output.className = 'empty-output';
    output.textContent = error.message;
    LabDemo.status(status, 'The workbook could not be generated.', 'error');
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#download-button').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  LabDemo.status(status, 'Streaming your XLSX download…');
  try {
    const response = await fetch('/api/excelio/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ rows: getRows() }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error ?? `Download failed (${response.status}).`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'handoo-labs-demo.xlsx';
    link.click();
    URL.revokeObjectURL(url);
    LabDemo.status(status, `Downloaded ${(blob.size / 1024).toFixed(1)} KB as a real XLSX workbook.`, 'success');
  } catch (error) {
    LabDemo.status(status, error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

lastRows = getRows();
