import assert from 'node:assert/strict';
import { getDesktopBridge } from '../src/platform/desktopBridge.ts';

const electronBridge = {
  send() {},
  invoke: async () => 'electron',
  on() { return this; },
  removeListener() { return this; },
};

(globalThis as any).window = {
  require(name: string) {
    assert.equal(name, 'electron');
    return { ipcRenderer: electronBridge };
  },
};
assert.equal(getDesktopBridge(), electronBridge, 'Electron preload remains the preferred bridge');

const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
(globalThis as any).window = {
  __TAURI__: {
    core: {
      async invoke(command: string, args?: Record<string, unknown>) {
        calls.push({ command, args });
        return { status: 'SUCCESS' };
      },
    },
    event: {
      async listen() { return () => {}; },
    },
  },
};

const tauriBridge = getDesktopBridge();
assert.ok(tauriBridge, 'Tauri global API is detected');
await tauriBridge.invoke('get-system-info', { verbose: false });
tauriBridge.send('set-autostart', true);
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(calls[0], {
  command: 'ipc_invoke',
  args: { channel: 'get-system-info', args: [{ verbose: false }] },
});
assert.deepEqual(calls[1], {
  command: 'ipc_send',
  args: { channel: 'set-autostart', args: [true] },
});

console.log('Desktop bridge compatibility tests passed');

