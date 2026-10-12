import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reservedSlugs = new Set(['api', 'assets', 'healthz']);

export async function discoverTools(toolsDir) {
  const entries = await readdir(toolsDir, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory());
  const tools = await Promise.all(folders.map(async ({ name }) => {
    if (!slugPattern.test(name) || reservedSlugs.has(name)) throw new Error(`Invalid tool directory name: ${name}`);
    const directory = path.join(toolsDir, name);
    const metadata = JSON.parse(await readFile(path.join(directory, 'tool.json'), 'utf8'));
    if (metadata.slug !== name || !isText(metadata.name, 80) || !isText(metadata.package, 120)
      || !isText(metadata.category, 40) || !isText(metadata.description, 400)
      || !Array.isArray(metadata.features) || metadata.features.length > 12
      || !metadata.features.every((feature) => isText(feature, 48))
      || !isText(metadata.icon, 8)
      || !['violet', 'blue', 'mint', 'pink'].includes(metadata.color)
      || !/^https:\/\/\S+$/.test(metadata.npm) || !/^https:\/\/\S+$/.test(metadata.repository)) {
      throw new Error(`Invalid tool metadata in ${name}/tool.json`);
    }
    await access(path.join(directory, 'index.html'));

    const serverPath = path.join(directory, 'server.js');
    let router = null;
    try {
      await access(serverPath);
      const server = await import(pathToFileURL(serverPath).href);
      router = server.default;
      if (typeof router !== 'function') throw new Error(`${name}/server.js must export an Express router.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    return { ...metadata, router, directory };
  }));

  const slugs = new Set();
  for (const tool of tools) {
    if (slugs.has(tool.slug)) throw new Error(`Duplicate tool slug: ${tool.slug}`);
    slugs.add(tool.slug);
  }
  return tools.sort((left, right) => left.name.localeCompare(right.name));
}

function isText(value, maximumLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}
