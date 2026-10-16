const assert = require('node:assert/strict');
const { createWindowsAudioController } = require('../lib/windows-audio.cjs');

async function run() {
  const controller = createWindowsAudioController();
  const initial = await controller.getState();
  try {
    assert.ok(initial.volume >= 0 && initial.volume <= 100);
    assert.equal(typeof initial.isMuted, 'boolean');

    const afterSet = await controller.setVolume(initial.volume);
    assert.equal(afterSet.volume, initial.volume);
    assert.equal(typeof afterSet.isMuted, 'boolean');
    assert.equal(Object.keys(afterSet).sort().join(','), 'isMuted,volume');

    if (initial.volume <= 95) {
      assert.equal((await controller.stepUp(5)).volume, initial.volume + 5);
      assert.equal((await controller.stepDown(5)).volume, initial.volume);
    } else {
      assert.equal((await controller.stepDown(5)).volume, initial.volume - 5);
      assert.equal((await controller.stepUp(5)).volume, initial.volume);
    }

    const toggledMute = await controller.toggleMute();
    assert.equal(toggledMute.isMuted, !initial.isMuted);
    assert.equal((await controller.toggleMute()).isMuted, initial.isMuted);

    console.log(`Windows audio controller tests passed. Volume: ${afterSet.volume}%`);
  } finally {
    const restored = await controller.setVolume(initial.volume);
    if (restored.isMuted !== initial.isMuted) await controller.toggleMute();
    controller.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
