const ACTIONS = [
  ['navigation.page', 'Открыть страницу'], ['navigation.deck', 'Открыть Deck'], ['navigation.back', 'Назад']
].map(([type, name]) => ({ type, name, inputType: 'trigger', supportedControlTypes: ['folder'] }));

function createNavigationProvider() {
  return {
    id: 'navigation', name: 'Навигация', actions: ACTIONS,
    validate(action) {
      if (!ACTIONS.some(candidate => candidate.type === action.type)) throw new Error(`Unknown navigation action: ${action.type}`);
      return action;
    },
    async execute(action, context = {}) {
      const navigation = action.type === 'navigation.page'
        ? { pageId: String(action.parameters.pageId || '') }
        : action.type === 'navigation.deck'
          ? { deckId: String(action.parameters.deckId || '') }
          : { back: true };
      if (typeof context.navigate === 'function') await context.navigate(navigation);
      return { status: 'success', navigation };
    }
  };
}

module.exports = { createNavigationProvider };
