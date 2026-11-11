const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function createApplicationLauncher({
  existsSync = fs.existsSync,
  statSync = fs.statSync,
  spawnImpl = spawn,
  shellOpenPath
}) {
  if (typeof shellOpenPath !== 'function') throw new Error('Windows shell opener is required');

  async function launch(parameters = {}) {
    const targetPath = path.resolve(String(parameters.path || '').trim());
    if (!String(parameters.path || '').trim() || !existsSync(targetPath)) throw new Error('Application path does not exist');
    if (!statSync(targetPath).isFile()) throw new Error('Application path must be a file');
    const rawArguments = parameters.arguments === undefined ? [] : parameters.arguments;
    if (!Array.isArray(rawArguments)) throw new Error('Application arguments must be an array');
    if (rawArguments.length > 64) throw new Error('Application arguments exceed the limit');
    const args = rawArguments.map(value => String(value));
    if (args.some(value => value.length > 4096)) throw new Error('Application argument is too long');

    const workingDirectoryValue = String(parameters.workingDirectory || '').trim();
    let workingDirectory;
    if (workingDirectoryValue) {
      workingDirectory = path.resolve(workingDirectoryValue);
      if (!existsSync(workingDirectory) || !statSync(workingDirectory).isDirectory()) throw new Error('Invalid application working directory');
    }

    const extension = path.extname(targetPath).toLowerCase();
    if (extension === '.exe' || extension === '.com') {
      await new Promise((resolve, reject) => {
        const child = spawnImpl(targetPath, args, {
          ...(workingDirectory ? { cwd: workingDirectory } : {}),
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        });
        child.once('error', () => reject(new Error('Не удалось запустить приложение')));
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
      });
      return { status: 'success' };
    }

    if (args.length > 0) throw new Error('Arguments are supported only for executable applications');
    const error = await shellOpenPath(targetPath);
    if (error) throw new Error(String(error));
    return { status: 'success' };
  }

  return { launch };
}

module.exports = { createApplicationLauncher };
