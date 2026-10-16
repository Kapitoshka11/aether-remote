const ACTIONS = [
  ['input.key', 'Одиночная клавиша'], ['input.hotkey', 'Горячая клавиша'], ['input.sequence', 'Последовательность клавиш'], ['input.text', 'Ввод текста']
].map(([type, name]) => ({ type, name, inputType: 'trigger', supportedControlTypes: ['button'] }));

function createInputProvider({ windowsInput }) {
  return {
    id: 'input', name: 'Клавиатура', actions: ACTIONS,
    validate(action) {
      if (!ACTIONS.some(candidate => candidate.type === action.type)) throw new Error(`Unknown input action: ${action.type}`);
      return action;
    },
    async execute(action) {
      const parameters = action.parameters || {};
      if (action.type === 'input.key') await windowsInput.sendKey(String(parameters.key || ''));
      else if (action.type === 'input.hotkey') await windowsInput.sendHotkey(Array.isArray(parameters.keys) ? parameters.keys.map(String) : []);
      else if (action.type === 'input.sequence') await windowsInput.sendKeySequence(Array.isArray(parameters.keys) ? parameters.keys : []);
      else if (action.type === 'input.text') await windowsInput.typeText(String(parameters.text || ''));
      return { status: 'success' };
    }
  };
}

module.exports = { createInputProvider };
