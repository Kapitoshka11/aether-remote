import assert from 'node:assert/strict';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Module from 'node:module';
import path from 'node:path';

const bundle = await build({
  entryPoints: ['src/components/SettingsModal.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['react', 'react-dom'],
});
const source = bundle.outputFiles[0].text;
const compiled = new Module(path.resolve('test/settings-modal-render-bundle.cjs'));
compiled.filename = path.resolve('test/settings-modal-render-bundle.cjs');
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(source, compiled.filename);
const { SettingsModal } = compiled.exports;

const html = renderToStaticMarkup(React.createElement(SettingsModal, {
  isOpen: true,
  onClose() {},
  language: 'RU',
  onLanguageChange() {},
  theme: 'dark',
  onThemeChange() {},
  autoStart: true,
  onAutoStartChange() {},
  minimizeToTray: true,
  onMinimizeToTrayChange() {},
  isConnected: false,
  onForceDisconnect() {},
  approvedTokens: [],
  onRevokeToken() {},
}));

assert.doesNotMatch(html, /Aether Wake Bridge/i, 'settings must not show the unused Wake Bridge control');
assert.match(html, /Папка загрузок/, 'settings must show the download directory control');
assert.match(html, /Выбрать папку/, 'settings must let the user select the download directory');
assert.match(html, /Открыть папку/, 'settings must let the user open the download directory');
assert.match(html, /Глубокий чёрный/, 'settings must describe the dark appearance');
assert.match(html, /Тёплый оранжевый/, 'settings must describe the light orange appearance');
assert.match(html, /Аккаунт/, 'account management must live inside settings');
assert.match(html, /Вход, синхронизация и доверенные устройства/, 'the collapsed account row must explain its purpose');
assert.match(html, /Aether Remote 2\.1\.0/, 'settings must show the release version');
console.log('Settings modal hides the unused Wake Bridge control.');

assert.match(html, /Передавать историю буфера обмена/);
assert.match(html, /type="checkbox"/);
assert.doesNotMatch(html, /type="checkbox"[^>]*checked/);
