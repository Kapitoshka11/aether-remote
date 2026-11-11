'use strict';

const path = require('node:path');

function createDownloadDirectoryStore({ settingsPath, fallbackPath, fs }) {
  let selected = '';
  try {
    selected = String(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).downloadDirectory || '');
  } catch (_) {}

  function ensureDirectory(candidate) {
    if (!candidate) return null;
    try {
      fs.mkdirSync(candidate, { recursive: true });
      return fs.statSync(candidate).isDirectory() ? path.resolve(candidate) : null;
    } catch (_) {
      return null;
    }
  }

  function get() {
    const effective = ensureDirectory(selected) || ensureDirectory(fallbackPath);
    if (!effective) throw new Error('Download directory is unavailable');
    return effective;
  }

  function set(candidate) {
    const resolved = ensureDirectory(String(candidate || ''));
    if (!resolved) throw new Error('Selected download directory is unavailable');
    selected = resolved;
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ downloadDirectory: selected }, null, 2), 'utf8');
    return selected;
  }

  function createUniquePath(fileName) {
    const directory = get();
    const parsed = path.parse(fileName);
    let candidate = path.join(directory, fileName);
    let suffix = 1;
    while (fs.existsSync(candidate)) {
      candidate = path.join(directory, `${parsed.name} (${suffix})${parsed.ext}`);
      suffix += 1;
    }
    return candidate;
  }

  return { get, set, createUniquePath };
}

function isPathInsideDirectory(candidate, directory, platform = process.platform) {
  const normalize = value => {
    const resolved = path.resolve(value);
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const target = normalize(candidate);
  const root = normalize(directory);
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

module.exports = { createDownloadDirectoryStore, isPathInsideDirectory };
