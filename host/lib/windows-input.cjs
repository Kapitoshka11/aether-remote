const { execFile } = require('node:child_process');
const { createPowerShellLineWorker } = require('./powershell-line-worker.cjs');

const virtualKeys = {
  BACKSPACE: 0x08, TAB: 0x09, ENTER: 0x0D, SHIFT: 0x10, CTRL: 0x11, CONTROL: 0x11, ALT: 0x12, PAUSE: 0x13, CAPSLOCK: 0x14,
  ESC: 0x1B, ESCAPE: 0x1B, SPACE: 0x20, PAGEUP: 0x21, PAGEDOWN: 0x22, END: 0x23, HOME: 0x24,
  LEFT: 0x25, UP: 0x26, RIGHT: 0x27, DOWN: 0x28, PRINTSCREEN: 0x2C, INSERT: 0x2D, DELETE: 0x2E,
  WIN: 0x5B, WINDOWS: 0x5B, RWIN: 0x5C, APPS: 0x5D,
  NUMPAD0: 0x60, NUMPAD1: 0x61, NUMPAD2: 0x62, NUMPAD3: 0x63, NUMPAD4: 0x64,
  NUMPAD5: 0x65, NUMPAD6: 0x66, NUMPAD7: 0x67, NUMPAD8: 0x68, NUMPAD9: 0x69,
  MULTIPLY: 0x6A, ADD: 0x6B, SEPARATOR: 0x6C, SUBTRACT: 0x6D, DECIMAL: 0x6E, DIVIDE: 0x6F,
  F1: 0x70, F2: 0x71, F3: 0x72, F4: 0x73, F5: 0x74, F6: 0x75, F7: 0x76, F8: 0x77, F9: 0x78, F10: 0x79, F11: 0x7A, F12: 0x7B,
  NUMLOCK: 0x90, SCROLLLOCK: 0x91,
  VOLUME_MUTE: 0xAD, VOLUME_DOWN: 0xAE, VOLUME_UP: 0xAF, MEDIA_NEXT: 0xB0, MEDIA_PREVIOUS: 0xB1, MEDIA_STOP: 0xB2, MEDIA_PLAY_PAUSE: 0xB3,
  // OEM punctuation keys
  OEM_1: 0xBA, ';': 0xBA, ':': 0xBA, SEMICOLON: 0xBA,
  OEM_PLUS: 0xBB, '=': 0xBB, '+': 0xBB, PLUS: 0xBB, EQUALS: 0xBB,
  OEM_COMMA: 0xBC, ',': 0xBC, '<': 0xBC, COMMA: 0xBC,
  OEM_MINUS: 0xBD, '-': 0xBD, '_': 0xBD, MINUS: 0xBD,
  OEM_PERIOD: 0xBE, '.': 0xBE, '>': 0xBE, PERIOD: 0xBE, DOT: 0xBE,
  OEM_2: 0xBF, '/': 0xBF, '?': 0xBF, SLASH: 0xBF,
  OEM_3: 0xC0, '`': 0xC0, '~': 0xC0, TILDE: 0xC0,
  OEM_4: 0xDB, '[': 0xDB, '{': 0xDB, OPEN_BRACKET: 0xDB,
  OEM_5: 0xDC, '\\': 0xDC, '|': 0xDC, BACKSLASH: 0xDC,
  OEM_6: 0xDD, ']': 0xDD, '}': 0xDD, CLOSE_BRACKET: 0xDD,
  OEM_7: 0xDE, '\'': 0xDE, '"': 0xDE, QUOTE: 0xDE,
  OEM_8: 0xDF
};

for (let code = 65; code <= 90; code += 1) virtualKeys[String.fromCharCode(code)] = code;
for (let code = 48; code <= 57; code += 1) virtualKeys[String.fromCharCode(code)] = code;

const inputType = String.raw`
using System;
using System.Runtime.InteropServices;
public static class AetherDeckInput {
  [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] private static extern uint MapVirtualKey(uint uCode, uint uMapType);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

  private static bool IsExtendedKey(byte key) {
    return key == 0x21 || key == 0x22 || key == 0x23 || key == 0x24 ||
           key == 0x25 || key == 0x26 || key == 0x27 || key == 0x28 ||
           key == 0x2C || key == 0x2D || key == 0x2E ||
           key == 0x5B || key == 0x5C || key == 0x5D || key == 0x90 || key == 0x6F;
  }

  public static void Keys(byte[] keys) {
    foreach (byte key in keys) {
      byte scan = (byte)MapVirtualKey((uint)key, 0);
      uint flags = IsExtendedKey(key) ? 1u : 0u;
      keybd_event(key, scan, flags, UIntPtr.Zero);
    }
    for (int i = keys.Length - 1; i >= 0; i--) {
      byte key = keys[i];
      byte scan = (byte)MapVirtualKey((uint)key, 0);
      uint flags = (IsExtendedKey(key) ? 1u : 0u) | 2u;
      keybd_event(key, scan, flags, UIntPtr.Zero);
    }
  }
  public static void Sequence(byte[][] sequence) {
    foreach (byte[] keys in sequence) {
      Keys(keys);
      System.Threading.Thread.Sleep(25);
    }
  }
  public static void Window(string command, long excludedWindow) {
    IntPtr window = GetForegroundWindow();
    if (window == IntPtr.Zero || (excludedWindow != 0 && window == new IntPtr(excludedWindow))) return;
    if (command == "minimize") ShowWindowAsync(window, 6);
    else if (command == "maximize") ShowWindowAsync(window, 3);
    else if (command == "restore") ShowWindowAsync(window, 9);
    else if (command == "close") PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
  }
}`;

function createWindowsInputController({ execFileImpl = null, clipboard = null, onClipboardChanged = () => {}, getExcludedWindowHandle = () => '0', spawnImpl = undefined } = {}) {
  let textQueue = Promise.resolve();
  let clipboardBusy = false;
  let originalClipboardText = '';

  const fallbackExec = execFileImpl || execFile;
  const escapedType = inputType.replace(/'/g, "''");

  const worker = execFileImpl ? null : createPowerShellLineWorker({
    spawnImpl,
    failureMessage: 'Не удалось отправить ввод Windows',
    script: `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $source='${escapedType}'; Add-Type -TypeDefinition $source; while (($line=[Console]::In.ReadLine()) -ne $null) { try { $req=$line | ConvertFrom-Json; if ($req.operation -eq 'KEYS') { [AetherDeckInput]::Keys([byte[]]$req.keys) } elseif ($req.operation -eq 'SEQUENCE') { $groups=[System.Collections.Generic.List[byte[]]]::new(); foreach ($g in $req.sequence) { $groups.Add([byte[]]$g) } [AetherDeckInput]::Sequence($groups.ToArray()) } elseif ($req.operation -eq 'WINDOW') { [AetherDeckInput]::Window($req.command, [long]$req.excluded) }; [Console]::Out.WriteLine('{"status":"success"}') } catch { [Console]::Out.WriteLine('{"error":"input_failed"}') } }`
  });

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

  function executeFallback(invoke) {
    const source = inputType.replace(/'/g, "''");
    const script = `$ErrorActionPreference='Stop'; $source='${source}'; Add-Type -TypeDefinition $source; ${invoke}`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return new Promise((resolve, reject) => fallbackExec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { timeout: 10000, windowsHide: true }, error => error ? reject(new Error('Не удалось отправить ввод Windows')) : resolve({ status: 'success' })));
  }

  const array = keys => `@(${keys.map(key => code(key)).join(',')})`;

  async function sendKey(key) {
    const byteCode = code(key);
    if (worker) return worker.request({ operation: 'KEYS', keys: [byteCode] });
    return executeFallback(`[AetherDeckInput]::Keys([byte[]]${array([key])})`);
  }

  async function sendHotkey(keys) {
    if (!Array.isArray(keys) || !keys.length || keys.length > 8) throw new Error('Hotkey must contain 1–8 keys');
    const byteCodes = keys.map(code);
    if (worker) return worker.request({ operation: 'KEYS', keys: byteCodes });
    return executeFallback(`[AetherDeckInput]::Keys([byte[]]${array(keys)})`);
  }

  async function sendKeySequence(sequence) {
    if (!Array.isArray(sequence) || !sequence.length || sequence.length > 100) throw new Error('Key sequence is invalid');
    const groups = sequence.map(item => Array.isArray(item) ? item : [item]);
    const byteGroups = groups.map(group => group.map(code));
    if (worker) return worker.request({ operation: 'SEQUENCE', sequence: byteGroups });
    const invoke = `$groups=[System.Collections.Generic.List[byte[]]]::new(); ${groups.map(group => `$groups.Add([byte[]]${array(group)});`).join(' ')} [AetherDeckInput]::Sequence($groups.ToArray())`;
    return executeFallback(invoke);
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
        await new Promise(r => setTimeout(r, 60));
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
    if (worker) return worker.request({ operation: 'WINDOW', command, excluded: Number(excluded) });
    return executeFallback(`[AetherDeckInput]::Window('${command}',${excluded})`);
  }

  return {
    sendKey, sendHotkey, sendKeySequence, typeText, windowCommand,
    readClipboardText, writeClipboardText, isClipboardBusy: () => clipboardBusy,
    close: () => worker?.close()
  };
}

module.exports = { createWindowsInputController, virtualKeys, inputType };
