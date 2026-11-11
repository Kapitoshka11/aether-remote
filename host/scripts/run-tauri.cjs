const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
const environment = {
  ...process.env,
  PATH: `${cargoBin}${path.delimiter}${process.env.PATH || ''}`,
};
const cli = path.join(__dirname, '..', 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: path.join(__dirname, '..'),
  env: environment,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
