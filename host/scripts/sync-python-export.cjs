const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'aether_server.py'), 'utf8')
  .split(/\r?\n/).map(line => line.trimEnd()).join('\n')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');
fs.writeFileSync(
  path.join(root, 'src', 'data', 'pythonCode.ts'),
  `export const PYTHON_HOST_AGENT_CODE = String.raw\`${source}\`;\n`,
  'utf8'
);
