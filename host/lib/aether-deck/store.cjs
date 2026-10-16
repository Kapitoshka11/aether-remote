const fs = require('node:fs');
const path = require('node:path');
const { createDefaultDocument, validateDocument, validatePatch } = require('./schema.cjs');

function createDeckStore({ directory }) {
  const filePath = path.join(directory, 'decks.json');
  const backupPath = path.join(directory, 'decks.backup.json');
  let document = createDefaultDocument();
  let mutationQueue = Promise.resolve();

  function serializeMutation(operation) {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  function readValid(target) {
    try {
      return validateDocument(JSON.parse(fs.readFileSync(target, 'utf8')));
    } catch (_) {
      return null;
    }
  }

  async function writeAtomic(next) {
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    if (fs.existsSync(filePath)) {
      const current = readValid(filePath);
      if (current) fs.copyFileSync(filePath, backupPath);
    }
    fs.writeFileSync(temporaryPath, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(temporaryPath, filePath);
  }

  async function load() {
    document = readValid(filePath) || readValid(backupPath) || createDefaultDocument();
    if (!readValid(filePath)) await writeAtomic(document);
    return structuredClone(document);
  }

  function getSnapshot() {
    return structuredClone(document);
  }

  async function replaceNow(input) {
    const validated = validateDocument(input);
    validated.revision = document.revision + 1;
    document = validated;
    await writeAtomic(document);
    return getSnapshot();
  }

  function replace(input) {
    return serializeMutation(() => replaceNow(input));
  }

  function applyPatch(input) {
    return serializeMutation(async () => {
      const patch = validatePatch(input);
      if (patch.baseRevision !== document.revision) throw new Error('Stale Aether Deck revision');
      return replaceNow(patch.document);
    });
  }

  function update(mutator) {
    return serializeMutation(async () => {
      const draft = getSnapshot();
      const result = mutator(draft) || draft;
      return replaceNow(result);
    });
  }

  return { load, getSnapshot, replace, applyPatch, update, filePath, backupPath };
}

module.exports = { createDeckStore };
