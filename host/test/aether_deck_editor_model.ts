import assert from 'node:assert/strict';
import {
  CONTROL_CHOICES,
  STATUS_OPTIONS,
  compatibleProviders,
  folderTargets,
  formatStatusValue,
  friendlyFieldsFor,
  loadDeveloperMode,
  saveDeveloperMode,
  isActionCompatible,
  statusOption
} from '../src/aether-deck/editorModel.ts';
import type { ProviderDescription } from '../src/aether-deck/types.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const storage = new MemoryStorage();
assert.equal(loadDeveloperMode(storage), false, 'developer mode must be off for first-time users');
saveDeveloperMode(storage, true);
assert.equal(loadDeveloperMode(storage), true, 'developer mode preference must persist');
saveDeveloperMode(storage, false);
assert.equal(loadDeveloperMode(storage), false, 'developer mode must persist the disabled state');

assert.deepEqual(CONTROL_CHOICES.map(item => item.type), ['button', 'toggle', 'slider', 'folder', 'status']);
assert.equal(CONTROL_CHOICES.find(item => item.type === 'folder')?.label, 'Папка');
assert.match(CONTROL_CHOICES.find(item => item.type === 'status')?.description || '', /состояние ПК/i);

for (const binding of ['audio.volume', 'audio.muted', 'media.track', 'media.artist', 'media.playing', 'obs.streaming', 'system.cpu', 'system.ram', 'system.connectedClients', 'stream.screen']) {
  assert.equal(STATUS_OPTIONS.some(item => item.binding === binding), true, `${binding} must be available in the friendly Status picker`);
}
assert.equal(statusOption('media.track')?.label, 'Текущий трек');
assert.equal(formatStatusValue('audio.volume', 37), '37%');
assert.equal(formatStatusValue('audio.muted', true), 'Выключен');
assert.equal(formatStatusValue('media.playing', false), 'Пауза');
assert.equal(formatStatusValue('obs.streaming', true), 'Запущен');
assert.equal(formatStatusValue('media.track', null), 'Нет данных');

assert.deepEqual(friendlyFieldsFor('system.openUrl').map(item => item.key), ['url']);
assert.deepEqual(friendlyFieldsFor('audio.masterVolume').map(item => item.key), ['value']);
assert.deepEqual(friendlyFieldsFor('input.hotkey').map(item => item.key), ['keys']);
assert.equal(friendlyFieldsFor('media.playPause').length, 0);
assert.equal(friendlyFieldsFor('unknown.action'), null, 'unknown parameter shapes must require developer mode');

const providers: ProviderDescription[] = [
  { id: 'system', name: 'System', available: true, actions: [
    { type: 'system.openUrl', name: 'URL', inputType: 'trigger', supportedControlTypes: ['button'] },
    { type: 'system.powershell', name: 'PowerShell', inputType: 'trigger', supportedControlTypes: ['button'], developerOnly: true }
  ] },
  { id: 'audio', name: 'Audio', available: true, actions: [
    { type: 'audio.masterVolume', name: 'Volume', inputType: 'number', supportedControlTypes: ['slider', 'button'] },
    { type: 'audio.masterMute', name: 'Mute', inputType: 'toggle', supportedControlTypes: ['button', 'toggle'] }
  ] }
];
assert.deepEqual(compatibleProviders(providers, 'slider', false).map(item => [item.id, item.actions.map(action => action.type)]), [['audio', ['audio.masterVolume']]]);
assert.deepEqual(compatibleProviders(providers, 'button', false).find(item => item.id === 'system')?.actions.map(action => action.type), ['system.openUrl']);
assert.deepEqual(compatibleProviders(providers, 'button', true).find(item => item.id === 'system')?.actions.map(action => action.type), ['system.openUrl', 'system.powershell']);
assert.equal(isActionCompatible(providers, { providerId: 'system', type: 'system.openUrl' }, 'slider'), false);
assert.equal(isActionCompatible(providers, { providerId: 'audio', type: 'audio.masterVolume' }, 'slider'), true);

const pages = [{ id: 'root', name: 'Главная' }, { id: 'second', name: 'Медиа' }];
assert.deepEqual(folderTargets(pages, 'root').map(page => page.id), ['second']);
assert.equal(folderTargets([pages[0]], 'root').length, 0);

console.log('Aether Deck editor model tests passed.');
