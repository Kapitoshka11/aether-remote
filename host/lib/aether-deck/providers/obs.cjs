const ACTIONS = [
  ['obs.stream.start', 'Запустить стрим'], ['obs.stream.stop', 'Остановить стрим'], ['obs.stream.toggle', 'Переключить стрим'],
  ['obs.record.start', 'Начать запись'], ['obs.record.stop', 'Остановить запись'], ['obs.record.toggle', 'Переключить запись'],
  ['obs.record.pause', 'Пауза записи'], ['obs.record.resume', 'Продолжить запись'], ['obs.scene.set', 'Переключить сцену'],
  ['obs.source.visibility', 'Видимость источника'], ['obs.source.mute', 'Mute источника'], ['obs.studioMode', 'Studio Mode'],
  ['obs.transition', 'Переход'], ['obs.replay.save', 'Сохранить Replay Buffer']
].map(([type, name]) => {
  const toggleTypes = new Set(['obs.stream.start', 'obs.stream.stop', 'obs.stream.toggle', 'obs.record.start', 'obs.record.stop', 'obs.record.toggle', 'obs.source.visibility', 'obs.source.mute', 'obs.studioMode']);
  return { type, name, inputType: toggleTypes.has(type) ? 'toggle' : 'trigger', supportedControlTypes: toggleTypes.has(type) ? ['button', 'toggle'] : ['button'] };
});

function createObsProvider({ client }) {
  return {
    id: 'obs', name: 'OBS Studio', actions: ACTIONS,
    isAvailable: () => client.isConnected(),
    subscribe: publish => client.subscribe(publish),
    validate(action) {
      if (!ACTIONS.some(candidate => candidate.type === action.type)) throw new Error(`Unknown OBS action: ${action.type}`);
      return action;
    },
    async execute(action) {
      const p = action.parameters || {};
      const simple = {
        'obs.stream.start': 'StartStream', 'obs.stream.stop': 'StopStream', 'obs.stream.toggle': 'ToggleStream',
        'obs.record.start': 'StartRecord', 'obs.record.stop': 'StopRecord', 'obs.record.toggle': 'ToggleRecord',
        'obs.record.pause': 'PauseRecord', 'obs.record.resume': 'ResumeRecord', 'obs.replay.save': 'SaveReplayBuffer'
      };
      if (simple[action.type]) return client.request(simple[action.type], {});
      if (action.type === 'obs.scene.set') return client.request('SetCurrentProgramScene', { sceneName: String(p.sceneName || '') });
      if (action.type === 'obs.source.mute') return client.request('SetInputMute', { inputName: String(p.inputName || ''), inputMuted: p.muted === true });
      if (action.type === 'obs.studioMode') return client.request('SetStudioModeEnabled', { studioModeEnabled: p.enabled === true });
      if (action.type === 'obs.transition') return client.request('SetCurrentSceneTransition', { transitionName: String(p.transitionName || '') });
      if (action.type === 'obs.source.visibility') return client.request('SetSceneItemEnabled', { sceneName: String(p.sceneName || ''), sceneItemId: Number(p.sceneItemId), sceneItemEnabled: p.enabled === true });
      throw new Error(`Unsupported OBS action: ${action.type}`);
    }
  };
}

module.exports = { createObsProvider };
