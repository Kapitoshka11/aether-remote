const assert = require('node:assert/strict');
const { createProviderRegistry } = require('../lib/aether-deck/provider-registry.cjs');
const { createMacroEngine } = require('../lib/aether-deck/macro-engine.cjs');
const { renderTemplate } = require('../lib/aether-deck/template.cjs');

async function run() {
  const calls = [];
  const states = {};
  const registry = createProviderRegistry();
  registry.register({
    id: 'test',
    actions: [{ type: 'record', name: 'Record' }],
    validate: action => action,
    execute: async action => {
      calls.push(action.parameters.value);
      if (action.parameters.fail) throw new Error('expected failure');
      return { status: 'success' };
    }
  });
  const engine = createMacroEngine({
    registry,
    publishState: (controlId, value) => { states[controlId] = { ...(states[controlId] || {}), ...value }; },
    delay: async () => {}
  });
  const action = value => ({ id: value, providerId: 'test', type: 'record', enabled: true, parameters: { value }, delayMs: 0, repeat: 1, condition: null, continueOnError: false });
  const button = { id: 'button', type: 'button', enabled: true, actions: [action('first'), { ...action('skip'), condition: { variable: 'ready', operator: 'equals', value: false } }, { ...action('third'), repeat: 2 }] };
  const result = await engine.executeControl(button, { variables: { ready: true }, triggerId: 'trigger-1' });
  assert.equal(result.status, 'success');
  assert.deepEqual(calls, ['first', 'third', 'third']);
  await engine.executeControl({ id: 'template', type: 'button', enabled: true, actions: [action('{{media.track}}')] }, { variables: { media: { track: 'Song' } }, triggerId: 'trigger-template' });
  assert.equal(calls.at(-1), 'Song');

  const toggle = { id: 'toggle', type: 'toggle', enabled: true, actions: [action('on')], actionsB: [action('off')] };
  await engine.executeControl(toggle, { variables: {}, triggerId: 'trigger-2' });
  assert.equal(states.toggle.active, true);
  await engine.executeControl(toggle, { variables: {}, triggerId: 'trigger-3' });
  assert.equal(states.toggle.active, false);

  const failure = await engine.executeControl({ id: 'bad', type: 'button', enabled: true, actions: [{ ...action('bad'), parameters: { value: 'bad', fail: true } }, action('never')] }, { variables: {}, triggerId: 'trigger-4' });
  assert.equal(failure.status, 'error');
  assert.equal(calls.includes('never'), false);

  let releaseDuplicate;
  let duplicateCalls = 0;
  const duplicateRegistry = createProviderRegistry();
  duplicateRegistry.register({ id: 'slow', actions: [], execute: async () => { duplicateCalls += 1; await new Promise(resolve => { releaseDuplicate = resolve; }); } });
  const duplicateEngine = createMacroEngine({ registry: duplicateRegistry });
  const duplicateControl = { id: 'duplicate', type: 'button', enabled: true, actions: [{ ...action('duplicate'), providerId: 'slow' }] };
  const firstDuplicate = duplicateEngine.executeControl(duplicateControl, { triggerId: 'same-trigger' });
  const secondDuplicate = duplicateEngine.executeControl(duplicateControl, { triggerId: 'same-trigger' });
  releaseDuplicate();
  assert.deepEqual(await firstDuplicate, { status: 'success' });
  assert.deepEqual(await secondDuplicate, { status: 'success' });
  assert.equal(duplicateCalls, 1, 'duplicate triggers must share the terminal result');

  assert.equal(renderTemplate('{{media.track}} · {{audio.volume}}%', { media: { track: 'Song' }, audio: { volume: 42 } }), 'Song · 42%');
  assert.equal(renderTemplate('{{missing.value}}', {}), '');
  console.log('Aether Deck engine tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
