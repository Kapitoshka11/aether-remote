const { resolvePath, renderTemplate } = require('./template.cjs');

function renderValue(value, variables) {
  if (typeof value === 'string') return renderTemplate(value, variables);
  if (Array.isArray(value)) return value.map(item => renderValue(item, variables));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderValue(item, variables)]));
  return value;
}

function evaluateCondition(condition, variables) {
  if (!condition) return true;
  if (condition.all && Array.isArray(condition.all)) return condition.all.every(item => evaluateCondition(item, variables));
  if (condition.any && Array.isArray(condition.any)) return condition.any.some(item => evaluateCondition(item, variables));
  if (condition.not) return !evaluateCondition(condition.not, variables);
  const actual = resolvePath(variables, condition.variable);
  const expected = condition.value;
  switch (condition.operator) {
    case 'exists': return actual !== undefined && actual !== null;
    case 'notExists': return actual === undefined || actual === null;
    case 'notEquals': return actual !== expected;
    case 'greaterThan': return Number(actual) > Number(expected);
    case 'greaterThanOrEqual': return Number(actual) >= Number(expected);
    case 'lessThan': return Number(actual) < Number(expected);
    case 'lessThanOrEqual': return Number(actual) <= Number(expected);
    case 'truthy': return actual === true || actual === 1;
    case 'falsy': return actual === false || actual === 0 || actual === null || actual === undefined;
    case 'equals':
    default: return actual === expected;
  }
}

function createMacroEngine({ registry, publishState = () => {}, delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  const toggleStates = new Map();
  const triggerResults = new Map();
  const running = new Map();

  async function executeActions(actions, context, controlId) {
    for (const action of actions || []) {
      if (action.enabled === false || !evaluateCondition(action.condition, context.variables || {})) continue;
      if (action.delayMs > 0) await delay(action.delayMs);
      const repeats = Math.max(1, Math.min(100, Number(action.repeat) || 1));
      for (let index = 0; index < repeats; index += 1) {
        try {
          const provider = registry.get(action.providerId);
          const rendered = structuredClone(action);
          rendered.parameters = renderValue(rendered.parameters, context.variables || {});
          const validated = typeof provider.validate === 'function' ? provider.validate(rendered) : rendered;
          await provider.execute(validated, { ...context, controlId, repeatIndex: index });
        } catch (error) {
          if (!action.continueOnError) return { status: 'error', actionId: action.id, error: error.message || String(error) };
        }
      }
    }
    return { status: 'success' };
  }

  function executeControl(control, context = {}) {
    if (!control || control.enabled === false) return { status: 'disabled' };
    if (!['button', 'toggle'].includes(control.type)) return { status: 'unsupported' };
    if (context.triggerId && triggerResults.has(context.triggerId)) return triggerResults.get(context.triggerId);
    if (context.triggerId && running.has(context.triggerId)) return running.get(context.triggerId);
    const operation = executeControlOnce(control, context);
    if (context.triggerId) running.set(context.triggerId, operation);
    return operation;
  }

  async function executeControlOnce(control, context) {
    publishState(control.id, { running: true, error: null });
    try {
      const active = toggleStates.get(control.id) === true;
      const actions = control.type === 'toggle' && active ? control.actionsB : control.actions;
      const result = await executeActions(actions, context, control.id);
      if (control.type === 'toggle' && result.status === 'success') {
        toggleStates.set(control.id, !active);
        publishState(control.id, { active: !active });
      }
      publishState(control.id, { running: false, error: result.status === 'error' ? result.error : null });
      if (context.triggerId) triggerResults.set(context.triggerId, result);
      if (triggerResults.size > 500) triggerResults.delete(triggerResults.keys().next().value);
      return result;
    } finally {
      if (context.triggerId && running.get(context.triggerId)) running.delete(context.triggerId);
    }
  }

  function setToggleState(controlId, active) {
    toggleStates.set(controlId, active === true);
    publishState(controlId, { active: active === true });
  }

  return { executeControl, setToggleState, evaluateCondition: (condition, variables) => evaluateCondition(condition, variables) };
}

module.exports = { createMacroEngine, evaluateCondition };
