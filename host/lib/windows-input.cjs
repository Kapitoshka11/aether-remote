const { execFile } = require('node:child_process');

const virtualKeys = {
  BACKSPACE: 0x08, TAB: 0x09, ENTER: 0x0D, SHIFT: 0x10, CTRL: 0x11, CONTROL: 0x11, ALT: 0x12, ESC: 0x1B, ESCAPE: 0x1B,
  SPACE: 0x20, PAGEUP: 0x21, PAGEDOWN: 0x22, END: 0x23, HOME: 0x24, LEFT: 0x25, UP: 0x26, RIGHT: 0x27, DOWN: 0x28,
  PRINTSCREEN: 0x2C, INSERT: 0x2D, DELETE: 0x2E, WIN: 0x5B, WINDOWS: 0x5B,
  F1: 0x70, F2: 0x71, F3: 0x72, F4: 0x73, F5: 0x74, F6: 0x75, F7: 0x76, F8: 0x77, F9: 0x78, F10: 0x79, F11: 0x7A, F12: 0x7B,
  VOLUME_MUTE: 0xAD, VOLUME_DOWN: 0xAE, VOLUME_UP: 0xAF, MEDIA_NEXT: 0xB0, MEDIA_PREVIOUS: 0xB1, MEDIA_STOP: 0xB2, MEDIA_PLAY_PAUSE: 0xB3
};

for (let code = 65; code <= 90; code += 1) virtualKeys[String.fromCharCode(code)] = code;
for (let code = 48; code <= 57; code += 1) virtualKeys[String.fromCharCode(code)] = code;

const inputType = String.raw`
using System;
using System.Runtime.InteropServices;
public static class AetherDeckInput {
  [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  public static void Keys(byte[] keys) { foreach (byte key in keys) keybd_event(key, 0, 0, UIntPtr.Zero); for (int i=keys.Length-1;i>=0;i--) keybd_event(keys[i], 0, 2, UIntPtr.Zero); }
  public static void Sequence(byte[][] sequence) { foreach (byte[] keys in sequence) { Keys(keys); System.Threading.Thread.Sleep(25); } }
  public static void Window(string command, long excludedWindow) { IntPtr window=GetForegroundWindow(); if (window==IntPtr.Zero || (excludedWindow!=0 && window==new IntPtr(excludedWindow))) return; if (command=="minimize") ShowWindowAsync(window,6); else if(command=="maximize") ShowWindowAsync(window,3); else if(command=="restore") ShowWindowAsync(window,9); else if(command=="close") PostMessage(window,0x0010,IntPtr.Zero,IntPtr.Zero); }
}`;

function createWindowsInputController({ execFileImpl = execFile, clipboard = null, onClipboardChanged = () => {}, getExcludedWindowHandle = () => '0' } = {}) {
  let textQueue = Promise.resolve();
  let clipboardBusy = false;
  let originalClipboardText = '';
  function readClipboardText() {
    return clipboardBusy ? originalClipboardText : clipboard.readText();
  }
  function writeClipboardText(value) {
    if (clipboardBusy) throw new Error('Clipboard is busy; retry after text input');
    clipboard.writeText(value);
    onClipboardChanged(value);
  }
  function code(key) {
    const normalized = String(key || '').trim().toUpperCase();
    const value = virtualKeys[normalized];
    if (!Number.isInteger(value)) throw new Error(`Unsupported key: ${key}`);
    return value;
  }
  function execute(invoke) {
    const source = inputType.replace(/'/g, "''");
    const script = `$ErrorActionPreference='Stop'; $source='${source}'; Add-Type -TypeDefinition $source; ${invoke}`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return new Promise((resolve, reject) => execFileImpl('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { timeout: 10000, windowsHide: true }, error => error ? reject(new Error('Не удалось отправить ввод Windows')) : resolve({ status: 'success' })));
  }
  const array = keys => `@(${keys.map(key => code(key)).join(',')})`;
  async function sendKey(key) { return execute(`[AetherDeckInput]::Keys([byte[]]${array([key])})`); }
  async function sendHotkey(keys) {
    if (!Array.isArray(keys) || !keys.length || keys.length > 8) throw new Error('Hotkey must contain 1–8 keys');
    return execute(`[AetherDeckInput]::Keys([byte[]]${array(keys)})`);
  }
  async function sendKeySequence(sequence) {
    if (!Array.isArray(sequence) || !sequence.length || sequence.length > 100) throw new Error('Key sequence is invalid');
    const groups = sequence.map(item => Array.isArray(item) ? item : [item]);
    const invoke = `$groups=[System.Collections.Generic.List[byte[]]]::new(); ${groups.map(group => `$groups.Add([byte[]]${array(group)});`).join(' ')} [AetherDeckInput]::Sequence($groups.ToArray())`;
    return execute(invoke);
  }
  function typeText(text) {
    const operation = textQueue.then(async () => {
      if (!clipboard) throw new Error('Unicode text input is unavailable');
      const value = String(text || '').slice(0, 10000);
      const previous = clipboard.readText();
      originalClipboardText = previous;
      clipboardBusy = true;
      try {
        clipboard.writeText(value);
        onClipboardChanged(value);
        await sendHotkey(['CTRL', 'V']);
      }
      finally {
        try {
          if (clipboard.readText() === value) clipboard.writeText(previous);
          onClipboardChanged(clipboard.readText());
        } finally {
          clipboardBusy = false;
          originalClipboardText = '';
        }
      }
      return { status: 'success' };
    });
    textQueue = operation.catch(() => {});
    return operation;
  }
  async function windowCommand(command) {
    if (!['minimize', 'maximize', 'restore', 'close'].includes(command)) throw new Error('Unsupported window command');
    const excluded = String(getExcludedWindowHandle() || '0');
    if (!/^\d+$/.test(excluded)) throw new Error('Invalid excluded window handle');
    return execute(`[AetherDeckInput]::Window('${command}',${excluded})`);
  }
  return { sendKey, sendHotkey, sendKeySequence, typeText, windowCommand,
    readClipboardText, writeClipboardText, isClipboardBusy: () => clipboardBusy };
}

module.exports = { createWindowsInputController, virtualKeys, inputType };
