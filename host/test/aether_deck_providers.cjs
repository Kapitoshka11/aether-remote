const assert = require('node:assert/strict');
const { createAetherProvider } = require('../lib/aether-deck/providers/aether.cjs');
const { createSystemProvider } = require('../lib/aether-deck/providers/system.cjs');
const { createInputProvider } = require('../lib/aether-deck/providers/input.cjs');
const { createAudioProvider } = require('../lib/aether-deck/providers/audio.cjs');
const { createNavigationProvider } = require('../lib/aether-deck/providers/navigation.cjs');

function assertActionMetadata(provider) {
  for (const action of provider.actions) {
    assert.ok(['trigger', 'toggle', 'number'].includes(action.inputType), `${action.type} must declare an input type`);
    assert.ok(Array.isArray(action.supportedControlTypes) && action.supportedControlTypes.length > 0, `${action.type} must declare compatible controls`);
  }
}

async function run() {
  const executed = [];
  const aether = createAetherProvider({ executeSystemCommand: async (action, data) => { executed.push({ action, data }); return { status: 'MEDIA_EXECUTED' }; } });
  await aether.execute({ type: 'media.playPause', parameters: {} });
  assert.deepEqual(executed[0], { action: 'MEDIA', data: { command: 'PLAY_PAUSE' } });
  await aether.execute({ type: 'power.lock', parameters: {} });
  assert.equal(executed[1].action, 'POWER');
  const compatibilityAudioCalls = [], synchronizedAudioStates = [];
  const aetherWithAudio = createAetherProvider({
    executeSystemCommand: async () => { throw new Error('Deck audio must use the shared controller'); },
    onAudioState: state => synchronizedAudioStates.push(state),
    windowsAudio: {
      setVolume: async value => { compatibilityAudioCalls.push(['set', value]); return { volume: value, isMuted: false }; },
      stepUp: async value => compatibilityAudioCalls.push(['up', value]),
      stepDown: async value => compatibilityAudioCalls.push(['down', value]),
      toggleMute: async () => compatibilityAudioCalls.push(['mute'])
    }
  });
  await aetherWithAudio.execute({ type: 'audio.setVolume', parameters: { value: 37 } });
  assert.deepEqual(compatibilityAudioCalls, [['set', 37]]);
  assert.deepEqual(synchronizedAudioStates, [{ volume: 37, isMuted: false }]);

  const opened = [];
  const processCalls = [];
  const system = createSystemProvider({
    shell: { openExternal: async value => opened.push(['url', value]), openPath: async value => { opened.push(['path', value]); return ''; }, showItemInFolder: value => opened.push(['folder', value]) },
    execFileImpl: (file, args, options, callback) => { opened.push(['program', file, args]); processCalls.push({ file, args, options }); callback(null, '', ''); },
    authorizeDangerousAction: async () => true
  });
  await system.execute({ type: 'system.openUrl', parameters: { url: 'https://example.com' } });
  await system.execute({ type: 'system.runProgram', parameters: { path: 'C:\\Tools\\tool.exe', arguments: ['--safe'] } });
  assert.deepEqual(opened[0], ['url', 'https://example.com/']);
  assert.deepEqual(opened[1], ['program', 'C:\\Tools\\tool.exe', ['--safe']]);
  assert.equal(system.actions.some(action => ['system.powershell', 'system.runCommand'].includes(action.type)), false);
  await assert.rejects(() => system.execute({ type: 'system.powershell', parameters: { script: 'Write-Output unsafe' } }), /(Unknown|Unsupported) system action/i);
  const failClosedSystem = createSystemProvider({ shell: { openPath: async () => '', openExternal: async () => {} } });
  await assert.rejects(
    () => failClosedSystem.execute({ type: 'system.launchApplication', parameters: { path: 'C:\\Tools\\tool.exe' } }),
    /declined or timed out/i
  );
  await assert.rejects(
    () => failClosedSystem.execute({ type: 'system.runProgram', parameters: { path: 'C:\\Tools\\tool.exe' } }),
    /declined or timed out/i
  );

  const inputCalls = [];
  const input = createInputProvider({ windowsInput: { sendKey: async value => inputCalls.push(['key', value]), sendHotkey: async value => inputCalls.push(['hotkey', value]), sendKeySequence: async value => inputCalls.push(['sequence', value]), typeText: async value => inputCalls.push(['text', value]) } });
  await input.execute({ type: 'input.hotkey', parameters: { keys: ['CTRL', 'SHIFT', 'S'] } });
  assert.deepEqual(inputCalls[0], ['hotkey', ['CTRL', 'SHIFT', 'S']]);

  const audioCalls = [], audioStates = [];
  const audio = createAudioProvider({
    windowsAudio: {
      setVolume: async value => { audioCalls.push(value); return { volume: value, isMuted: false }; },
      toggleMute: async () => { audioCalls.push('mute'); return { volume: 38, isMuted: true }; }
    },
    onAudioState: state => audioStates.push(state)
  });
  assert.deepEqual(audio.actions.map(action => action.type), ['audio.masterVolume', 'audio.masterMute']);
  await audio.execute({ type: 'audio.masterVolume', parameters: { value: 38 } });
  assert.deepEqual(audioCalls, [38]);
  assert.deepEqual(audioStates, [{ volume: 38, isMuted: false }]);

  const navigation = createNavigationProvider();
  const navigated = [];
  const nav = await navigation.execute({ type: 'navigation.page', parameters: { pageId: 'page-2' } }, { navigate: target => navigated.push(target) });
  assert.deepEqual(nav, { status: 'success', navigation: { pageId: 'page-2' } });
  assert.deepEqual(navigated, [{ pageId: 'page-2' }]);

  for (const provider of [aether, system, input, audio, navigation]) assertActionMetadata(provider);
  assert.deepEqual(system.actions.find(action => action.type === 'system.openUrl').supportedControlTypes, ['button']);
  assert.deepEqual(audio.actions.find(action => action.type === 'audio.masterVolume').supportedControlTypes, ['slider', 'button']);
  assert.equal(audio.actions.find(action => action.type === 'audio.masterVolume').inputType, 'number');
  assert.deepEqual(navigation.actions.find(action => action.type === 'navigation.page').supportedControlTypes, ['folder']);
  console.log('Aether Deck provider tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
