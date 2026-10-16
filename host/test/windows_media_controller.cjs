const assert = require('node:assert/strict');
const { createWindowsMediaController } = require('../lib/windows-media.cjs');

async function run() {
  const controller = createWindowsMediaController();
  const firstResult = await controller.togglePlayPause();
  assert.deepEqual(firstResult, { command: 'PLAY_PAUSE' });
  const secondResult = await controller.togglePlayPause();
  assert.deepEqual(secondResult, { command: 'PLAY_PAUSE' });
  controller.close();
  console.log('Windows media controller test passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
