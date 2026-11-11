const assert = require('node:assert/strict');
const { createLinuxControl } = require('../lib/linux-control.cjs');

function fakeExec(responses, calls) {
  return (file, args, options, callback) => {
    calls.push({ file, args });
    const key = `${file} ${args.join(' ')}`;
    const response = responses.find(item => key.startsWith(item.prefix));
    if (!response) return callback(new Error(`Unexpected command: ${key}`), '', '');
    callback(response.error || null, response.stdout || '', response.stderr || '');
  };
}

async function run() {
  const calls = [];
  const responses = [
    { prefix: 'pactl get-sink-volume', stdout: 'Volume: front-left: 32768 / 50% / -18.00 dB\n' },
    { prefix: 'pactl get-sink-mute', stdout: 'Mute: no\n' },
    { prefix: 'pactl set-sink-volume' },
    { prefix: 'pactl set-sink-mute' },
    { prefix: 'playerctl play-pause' },
    { prefix: 'playerctl next' },
    { prefix: 'playerctl previous' },
    { prefix: 'playerctl metadata', stdout: 'Track title\tArtist name\n' },
    { prefix: 'playerctl status', stdout: 'Playing\n' },
    { prefix: 'xdotool mousemove_relative' },
    { prefix: 'xdotool click' },
    { prefix: 'xdotool key' },
    { prefix: 'xdotool type' },
    { prefix: 'loginctl lock-session' },
    { prefix: 'systemctl suspend' },
  ];
  const clipboard = { value: '', readText() { return this.value; }, writeText(value) { this.value = value; } };
  const controller = createLinuxControl({
    execFileImpl: fakeExec(responses, calls),
    commandExists: command => ['pactl', 'playerctl', 'xdotool', 'loginctl', 'systemctl'].includes(command),
    clipboard,
  });

  assert.deepEqual(controller.getCapabilities().sort(), [
    'linux-audio-pulse-v1',
    'linux-input-x11-v1',
    'linux-media-playerctl-v1',
    'linux-power-systemd-v1',
  ]);
  assert.deepEqual(await controller.getState(), { volume: 50, isMuted: false });
  assert.deepEqual(await controller.getMediaState(), { title: 'Track title', artist: 'Artist name', isPlaying: true });
  await controller.setVolume(73);
  await controller.toggleMute();
  await controller.togglePlayPause();
  await controller.nextTrack();
  await controller.previousTrack();
  await controller.mouseMove(-12, 7);
  await controller.mouseClick('right');
  await controller.mouseScroll(-2);
  await controller.sendKey('ENTER');
  await controller.sendHotkey(['CTRL', 'ALT', 'T']);
  await controller.typeText('Привет Linux');
  await controller.power('LOCK');
  await controller.power('SLEEP');
  controller.writeClipboardText('shared');
  assert.equal(controller.readClipboardText(), 'shared');

  assert.ok(calls.some(call => call.file === 'pactl' && call.args.includes('73%')));
  assert.ok(calls.some(call => call.file === 'xdotool' && call.args.join(' ') === 'mousemove_relative -- -12 7'));
  assert.ok(calls.some(call => call.file === 'xdotool' && call.args.join(' ') === 'key ctrl+alt+t'));
  assert.ok(calls.some(call => call.file === 'loginctl' && call.args[0] === 'lock-session'));
  console.log('Linux control adapter tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
