const ACTIONS = [
  ['media.playPause', 'Play / Pause'], ['media.next', 'Следующий трек'], ['media.previous', 'Предыдущий трек'],
  ['audio.volumeUp', 'Громче'], ['audio.volumeDown', 'Тише'], ['audio.mute', 'Mute'], ['audio.setVolume', 'Установить громкость'],
  ['power.lock', 'Заблокировать ПК'], ['power.sleep', 'Сон'], ['power.shutdown', 'Выключить ПК'], ['power.restart', 'Перезагрузить ПК'],
  ['window.closeActive', 'Закрыть активное окно'], ['stream.start', 'Запустить трансляцию экрана'], ['stream.stop', 'Остановить трансляцию экрана']
].map(([type, name]) => {
  if (type === 'audio.setVolume') return { type, name, inputType: 'number', supportedControlTypes: ['slider', 'button'] };
  if (['media.playPause', 'audio.mute', 'stream.start', 'stream.stop'].includes(type)) return { type, name, inputType: 'toggle', supportedControlTypes: ['button', 'toggle'] };
  return { type, name, inputType: 'trigger', supportedControlTypes: ['button'] };
});

function createAetherProvider({ executeSystemCommand, setScreenStreaming = null, windowsAudio = null, onAudioState = null }) {
  const commands = {
    'media.playPause': ['MEDIA', { command: 'PLAY_PAUSE' }],
    'media.next': ['MEDIA', { command: 'NEXT_TRACK' }],
    'media.previous': ['MEDIA', { command: 'PREV_TRACK' }],
    'audio.volumeUp': ['MEDIA', { command: 'VOL_UP', value: 5 }],
    'audio.volumeDown': ['MEDIA', { command: 'VOL_DOWN', value: 5 }],
    'audio.mute': ['MEDIA', { command: 'VOL_MUTE' }],
    'power.lock': ['POWER', { command: 'LOCK' }],
    'power.sleep': ['POWER', { command: 'SLEEP' }],
    'power.shutdown': ['POWER', { command: 'SHUTDOWN', confirm: true }],
    'power.restart': ['POWER', { command: 'REBOOT', confirm: true }],
    'window.closeActive': ['POWER', { command: 'CLOSE_WINDOW' }]
  };
  return {
    id: 'aether',
    name: 'Aether Remote',
    actions: ACTIONS,
    validate(action) {
      if (!ACTIONS.some(candidate => candidate.type === action.type)) throw new Error(`Unknown Aether action: ${action.type}`);
      return action;
    },
    async execute(action, context) {
      if (windowsAudio) {
        let operation = null;
        if (action.type === 'audio.setVolume') operation = windowsAudio.setVolume(Number(action.parameters.value));
        if (action.type === 'audio.volumeUp') operation = windowsAudio.stepUp(5);
        if (action.type === 'audio.volumeDown') operation = windowsAudio.stepDown(5);
        if (action.type === 'audio.mute') operation = windowsAudio.toggleMute();
        if (operation) {
          const state = await operation;
          if (typeof onAudioState === 'function') onAudioState(state);
          return state;
        }
      }
      if (action.type === 'audio.setVolume') return executeSystemCommand('MEDIA', { command: 'VOLUME_SET', value: action.parameters.value });
      if (action.type === 'stream.start' || action.type === 'stream.stop') {
        if (typeof setScreenStreaming !== 'function') throw new Error('Screen streaming is unavailable');
        return setScreenStreaming(action.type === 'stream.start', context);
      }
      const mapping = commands[action.type];
      if (!mapping) throw new Error(`Unsupported Aether action: ${action.type}`);
      return executeSystemCommand(mapping[0], structuredClone(mapping[1]));
    }
  };
}

module.exports = { createAetherProvider };
