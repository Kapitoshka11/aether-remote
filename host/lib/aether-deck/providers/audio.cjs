const ACTIONS = [
  ['audio.masterVolume', 'Общая громкость'], ['audio.masterMute', 'Общий Mute'], ['audio.outputDevice', 'Устройство вывода'],
  ['audio.inputDevice', 'Устройство ввода'], ['audio.microphoneMute', 'Mute микрофона'], ['audio.applicationVolume', 'Громкость приложения']
].map(([type, name]) => {
  if (type === 'audio.masterVolume' || type === 'audio.applicationVolume') return { type, name, inputType: 'number', supportedControlTypes: ['slider', 'button'] };
  return { type, name, inputType: 'toggle', supportedControlTypes: ['button', 'toggle'] };
});

function createAudioProvider({ windowsAudio, onAudioState = null }) {
  const requiredMethods = {
    'audio.masterVolume': 'setVolume', 'audio.masterMute': 'toggleMute', 'audio.outputDevice': 'setOutputDevice',
    'audio.inputDevice': 'setInputDevice', 'audio.microphoneMute': 'setMicrophoneMute', 'audio.applicationVolume': 'setApplicationVolume'
  };
  const actions = ACTIONS.filter(action => typeof windowsAudio[requiredMethods[action.type]] === 'function');
  return {
    id: 'audio', name: 'Аудио', actions,
    validate(action) {
      if (!actions.some(candidate => candidate.type === action.type)) throw new Error(`Unavailable audio action: ${action.type}`);
      return action;
    },
    async execute(action) {
      const parameters = action.parameters || {};
      if (action.type === 'audio.masterVolume' || action.type === 'audio.masterMute') {
        const state = await (action.type === 'audio.masterVolume'
          ? windowsAudio.setVolume(Number(parameters.value))
          : windowsAudio.toggleMute());
        if (typeof onAudioState === 'function') onAudioState(state);
        return state;
      }
      if (action.type === 'audio.outputDevice' && windowsAudio.setOutputDevice) return windowsAudio.setOutputDevice(String(parameters.deviceId || ''));
      if (action.type === 'audio.inputDevice' && windowsAudio.setInputDevice) return windowsAudio.setInputDevice(String(parameters.deviceId || ''));
      if (action.type === 'audio.microphoneMute' && windowsAudio.setMicrophoneMute) return windowsAudio.setMicrophoneMute(parameters.muted === true);
      if (action.type === 'audio.applicationVolume' && windowsAudio.setApplicationVolume) return windowsAudio.setApplicationVolume(String(parameters.process || ''), Number(parameters.value));
      throw new Error('Requested Windows audio capability is unavailable');
    }
  };
}

module.exports = { createAudioProvider };
