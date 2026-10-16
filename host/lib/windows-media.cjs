const { execFile } = require('node:child_process');
const { createPowerShellLineWorker } = require('./powershell-line-worker.cjs');

const mediaKeyTypeDefinition = String.raw`
using System;
using System.Runtime.InteropServices;

public static class AetherMediaKeys {
  [DllImport("user32.dll", SetLastError = true)]
  private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

  public static void TogglePlayPause() {
    const byte MediaPlayPause = 0xB3;
    keybd_event(MediaPlayPause, 0, 0, UIntPtr.Zero);
    keybd_event(MediaPlayPause, 0, 2, UIntPtr.Zero);
  }
}`;

function createWindowsMediaController(options = {}) {
  const execFileImpl = options.execFileImpl || execFile;
  const escapedType = mediaKeyTypeDefinition.replace(/'/g, "''");
  const worker = options.execFileImpl ? null : createPowerShellLineWorker({
    spawnImpl: options.spawnImpl,
    failureMessage: 'Не удалось переключить воспроизведение Windows',
    script: `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $source='${escapedType}'; Add-Type -TypeDefinition $source; while (($line=[Console]::In.ReadLine()) -ne $null) { try { [AetherMediaKeys]::TogglePlayPause(); [Console]::Out.WriteLine('{"command":"PLAY_PAUSE"}') } catch { [Console]::Out.WriteLine('{"error":"media_failed"}') } }`
  });

  function togglePlayPause() {
    if (worker) return worker.request({ command: 'PLAY_PAUSE' });
    const script = `$ErrorActionPreference='Stop'; $source='${escapedType}'; Add-Type -TypeDefinition $source; [AetherMediaKeys]::TogglePlayPause()`;
    const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');

    return new Promise((resolve, reject) => {
      execFileImpl(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
        { encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 },
        error => {
          if (error) {
            reject(new Error('Не удалось переключить воспроизведение Windows'));
            return;
          }
          resolve({ command: 'PLAY_PAUSE' });
        }
      );
    });
  }

  return { togglePlayPause, close: () => worker?.close() };
}

module.exports = { createWindowsMediaController, mediaKeyTypeDefinition };
