const assert = require('node:assert/strict');
const { applyStreamPreferences, recordFrameDispatch, resolveFrameSentAt } = require('../lib/stream-policy.cjs');

const state = { streamQuality: 80, streamResolution: '1080p' };
applyStreamPreferences(state, {});
assert.deepEqual(state, { streamQuality: 80, streamResolution: '1080p' });

applyStreamPreferences(state, { quality: 5, resolution: 'invalid' });
assert.deepEqual(state, { streamQuality: 10, streamResolution: '1080p' });

applyStreamPreferences(state, { quality: 73.6, resolution: '480p' });
assert.deepEqual(state, { streamQuality: 74, streamResolution: '480p' });

const frames = {};
const first = recordFrameDispatch(frames, 1_000);
const lost = recordFrameDispatch(frames, 1_100);
const third = recordFrameDispatch(frames, 1_200);
assert.equal(resolveFrameSentAt(frames, { frameId: third.frameId }), 1_200);
assert.equal(resolveFrameSentAt(frames, { frameId: first.frameId }), 1_000);
assert.equal(resolveFrameSentAt(frames, { frameId: lost.frameId }), 1_100);
assert.equal(resolveFrameSentAt(frames, { frameId: 999 }), null);

console.log('Stream policy tests passed.');
