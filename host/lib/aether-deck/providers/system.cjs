const { execFile } = require('node:child_process');
const { createApplicationLauncher } = require('../../application-launcher.cjs');

const ACTIONS = [
  ['system.launchApplication', 'Открыть приложение'], ['system.runProgram', 'Запустить программу'], ['system.openFile', 'Открыть файл'], ['system.openFolder', 'Открыть папку'],
  ['system.openUrl', 'Открыть URL'], ['system.typeText', 'Ввести текст'],
  ['window.minimize', 'Свернуть активное окно'], ['window.maximize', 'Развернуть активное окно'], ['window.restore', 'Восстановить активное окно'], ['window.close', 'Закрыть активное окно']
].map(([type, name]) => ({ type, name, inputType: 'trigger', supportedControlTypes: ['button'] }));

function promisifyCall(invoke, failureMessage) {
  return new Promise((resolve, reject) => invoke((error, stdout = '') => error ? reject(new Error(failureMessage)) : resolve({ status: 'success', output: String(stdout).slice(0, 4096) })));
}

function createSystemProvider({ shell, execFileImpl = execFile, spawnImpl, windowsInput = null, applicationLauncher = null, authorizeDangerousAction = async () => false }) {
  const launcher = applicationLauncher || createApplicationLauncher({ spawnImpl, shellOpenPath: file => shell.openPath(file) });
  return {
    id: 'system', name: 'Система', actions: ACTIONS,
    validate(action) {
      if (!ACTIONS.some(candidate => candidate.type === action.type)) throw new Error(`Unknown system action: ${action.type}`);
      return action;
    },
    async execute(action, context = {}) {
      const parameters = action.parameters || {};
      if (action.type === 'system.launchApplication') {
        if (!await authorizeDangerousAction(action, context)) throw new Error('Application launch was declined or timed out on the PC');
        return launcher.launch(parameters);
      }
      if (action.type === 'system.openUrl') {
        const url = new URL(String(parameters.url || ''));
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported');
        await shell.openExternal(url.toString());
        return { status: 'success' };
      }
      if (action.type === 'system.openFile') {
        const error = await shell.openPath(String(parameters.path || ''));
        if (error) throw new Error(error);
        return { status: 'success' };
      }
      if (action.type === 'system.openFolder') {
        const target = String(parameters.path || '');
        if (parameters.reveal === true) shell.showItemInFolder(target);
        else {
          const error = await shell.openPath(target);
          if (error) throw new Error(error);
        }
        return { status: 'success' };
      }
      if (action.type === 'system.runProgram') {
        if (!await authorizeDangerousAction(action, context)) throw new Error('Program launch was declined or timed out on the PC');
        const file = String(parameters.path || '');
        const args = Array.isArray(parameters.arguments) ? parameters.arguments.map(String).slice(0, 64) : [];
        return promisifyCall(callback => execFileImpl(file, args, { timeout: 30000, windowsHide: false }, callback), 'Не удалось запустить программу');
      }
      if (action.type === 'system.typeText') {
        if (!windowsInput) throw new Error('Text input is unavailable');
        await windowsInput.typeText(String(parameters.text || ''));
        return { status: 'success' };
      }
      if (action.type.startsWith('window.')) {
        if (!windowsInput || typeof windowsInput.windowCommand !== 'function') throw new Error('Window control is unavailable');
        await windowsInput.windowCommand(action.type.slice('window.'.length));
        return { status: 'success' };
      }
      throw new Error(`Unsupported system action: ${action.type}`);
    }
  };
}

module.exports = { createSystemProvider };
