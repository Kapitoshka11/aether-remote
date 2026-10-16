const assert = require('node:assert/strict');
const { createWindowsInputController } = require('../lib/windows-input.cjs');

async function run() {
  let clipboardValue = 'original';
  const events = [];
  const clipboard = {
    readText: () => clipboardValue,
    writeText: value => { clipboardValue = value; events.push(`clipboard:${value}`); }
  };
  const commands = [];
  const clipboardFingerprints = [];
  const controller = createWindowsInputController({
    clipboard,
    onClipboardChanged: value => clipboardFingerprints.push(value),
    getExcludedWindowHandle: () => '4242',
    execFileImpl: (_file, args, _options, callback) => {
      commands.push(Buffer.from(args.at(-1), 'base64').toString('utf16le'));
      events.push(`paste:${clipboardValue}`);
      if (commands.at(-1).includes('::Keys')) {
        assert.equal(controller.readClipboardText(), 'original');
        assert.equal(controller.isClipboardBusy(), true);
        assert.throws(() => controller.writeClipboardText('remote overwrite'), /busy/);
      }
      setImmediate(() => callback(null));
    }
  });

  await Promise.all([controller.typeText('first'), controller.typeText('second')]);
  assert.deepEqual(events, [
    'clipboard:first', 'paste:first', 'clipboard:original',
    'clipboard:second', 'paste:second', 'clipboard:original'
  ]);
  assert.equal(clipboardValue, 'original');
  assert.equal(controller.isClipboardBusy(), false);
  assert.deepEqual(clipboardFingerprints, ['first', 'original', 'second', 'original']);

  await controller.windowCommand('close');
  assert.match(commands.at(-1), /Window\('close',4242\)/);
  let failPaste = true;
  const failing = createWindowsInputController({ clipboard,
    execFileImpl: (_file, _args, _options, callback) => callback(failPaste ? new Error('Paste failed') : null)
  });
  await assert.rejects(failing.typeText('temporary secret'));
  assert.equal(clipboardValue, 'original');
  assert.equal(failing.isClipboardBusy(), false);
  failPaste = false;
  await failing.typeText('retry');
  assert.equal(clipboardValue, 'original');
  console.log('Windows input controller tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
