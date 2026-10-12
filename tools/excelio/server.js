import express from 'express';
import { excelio } from '@dipanshuhandoo/excelio';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { beginRun } from '../../server/demo-limits.js';
import { boundedBoolean, requireRecord } from '../../server/input.js';

const router = express.Router();
const maxRows = 75;
const maxWorkbookBytes = 1024 * 1024;

function parseRows(body) {
  const input = requireRecord(body);
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > maxRows) {
    throw Object.assign(new Error(`rows must contain between 1 and ${maxRows} records.`), { status: 400 });
  }
  return input.rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || typeof row.name !== 'string' || row.name.length > 80
      || typeof row.team !== 'string' || row.team.length > 80
      || typeof row.score !== 'number' || !Number.isFinite(row.score) || Math.abs(row.score) > 100_000) {
      throw Object.assign(new Error(`Row ${index + 1} must have a name, team, and finite score between -100000 and 100000.`), { status: 400 });
    }
    return { name: row.name, team: row.team, score: row.score };
  });
}

function workbook(rows) {
  const average = rows.reduce((sum, row) => sum + row.score, 0) / rows.length;
  return [{
    workbook: 'Handoo Labs demo',
    properties: { author: 'Handoo Labs', title: 'People and scores' },
    sheets: [
      {
        sheet: 'People',
        columns: [
          { key: 'name', header: 'Name', type: 'string', width: 22 },
          { key: 'team', header: 'Team', type: 'string', width: 18 },
          { key: 'score', header: 'Score', type: 'number', format: '0.00', width: 12 },
        ],
        styling: { headerBold: true, freezeHeader: true, autoFilter: true },
        data: rows,
      },
      {
        sheet: 'Summary',
        columns: [
          { key: 'metric', header: 'Metric', type: 'string', width: 24 },
          { key: 'value', header: 'Value', type: 'number', format: '0.00', width: 16 },
        ],
        styling: { headerBold: true, freezeHeader: true },
        data: [{ metric: 'Record count', value: rows.length }, { metric: 'Average score', value: average }],
      },
    ],
  }];
}

function validator(row, context) {
  if (context.sheetName !== 'People') return null;
  const name = row.Name ?? row.name ?? '';
  const team = row.Team ?? row.team ?? '';
  const score = row.Score ?? row.score;
  if (!name.trim()) return { code: 'NAME_REQUIRED', message: 'Name cannot be blank.', column: 'Name' };
  if (!team.trim()) return { code: 'TEAM_REQUIRED', message: 'Team cannot be blank.', column: 'Team' };
  if (score < 0 || score > 100) return { code: 'SCORE_RANGE', message: 'Score must be between 0 and 100.', column: 'Score' };
  return null;
}

router.post('/preview', async (request, response, next) => {
  const finish = beginRun();
  try {
    const input = requireRecord(request.body);
    const rows = parseRows(input);
    const useWorker = boundedBoolean(input.useWorker, 'useWorker', false);
    const buffer = await excelio.write(workbook(rows), { useWorker });
    if (!Buffer.isBuffer(buffer) || buffer.byteLength > maxWorkbookBytes) {
      throw Object.assign(new Error('Generated workbook exceeds the 1 MB playground limit.'), { status: 413 });
    }
    const read = await excelio.read(buffer, { useWorker, onRowError: 'collect', validateRow: validator });
    response.json({
      workbook: read.data.map((file) => file.sheets.map((sheet) => ({
        name: sheet.sheet,
        columns: sheet.columns,
        rows: sheet.data.slice(0, maxRows),
      }))).flat(),
      validationErrors: read.errors,
      stats: { ...read.stats, bytes: buffer.byteLength },
      writerMode: useWorker ? 'Worker requested (writing)' : 'Inline (writing)',
      readerMode: 'Inline (read validation uses a callback)',
    });
  } catch (error) {
    next(error);
  } finally {
    finish();
  }
});

router.post('/download', async (request, response, next) => {
  const finish = beginRun();
  try {
    const rows = parseRows(request.body);
    let bytes = 0;
    const sizeGuard = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > maxWorkbookBytes
          ? Object.assign(new Error('Generated workbook exceeds the 1 MB playground limit.'), { status: 413 })
          : null, chunk);
      },
    });
    response.status(200).set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="handoo-labs-demo.xlsx"',
      'Cache-Control': 'no-store',
    });
    await pipeline(excelio.writeStream(workbook(rows), { useWorker: false }), sizeGuard, response);
  } catch (error) {
    if (!response.headersSent) next(error);
    else {
      console.error('[excelio demo download]', error);
      response.destroy(error);
    }
  } finally {
    finish();
  }
});

export default router;
