import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverTools } from '../server/discover-tools.js';

test('discovers only valid tool metadata and permits tools without a backend module', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'handoo-tools-'));
  try {
    await mkdir(path.join(directory, 'sample-tool'));
    await writeFile(path.join(directory, 'sample-tool', 'tool.json'), JSON.stringify({
      slug: 'sample-tool',
      name: 'Sample Tool',
      package: '@example/sample',
      category: 'Test',
      description: 'A browser-only demo.',
      features: ['Example'],
      icon: '✳',
      color: 'violet',
      npm: 'https://www.npmjs.com/package/example',
      repository: 'https://github.com/example/sample',
    }));
    await writeFile(path.join(directory, 'sample-tool', 'index.html'), '<!doctype html>');

    const [tool] = await discoverTools(directory);
    assert.equal(tool.slug, 'sample-tool');
    assert.equal(tool.router, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails startup discovery when metadata has an unsafe package URL', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'handoo-invalid-tool-'));
  try {
    await mkdir(path.join(directory, 'sample-tool'));
    await writeFile(path.join(directory, 'sample-tool', 'tool.json'), JSON.stringify({
      slug: 'sample-tool',
      name: 'Sample Tool',
      package: '@example/sample',
      category: 'Test',
      description: 'Invalid metadata.',
      features: [],
      icon: '✳',
      color: 'violet',
      npm: 'javascript:alert(1)',
      repository: 'https://github.com/example/sample',
    }));
    await assert.rejects(discoverTools(directory), /Invalid tool metadata/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
