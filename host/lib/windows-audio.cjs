const { execFile } = require('node:child_process');
const { createPowerShellLineWorker } = require('./powershell-line-worker.cjs');

const coreAudioTypeDefinition = String.raw`
using System;
using System.Runtime.InteropServices;

public enum EDataFlow { eRender, eCapture, eAll }
public enum ERole { eConsole, eMultimedia, eCommunications }

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumerator { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int NotImpl1();
  [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object endpoint);
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr notify);
  int UnregisterControlChangeNotify(IntPtr notify);
  int GetChannelCount(ref uint channelCount);
  int SetMasterVolumeLevel(float levelDb, Guid eventContext);
  int SetMasterVolumeLevelScalar(float level, Guid eventContext);
  int GetMasterVolumeLevel(ref float levelDb);
  int GetMasterVolumeLevelScalar(ref float level);
  int SetChannelVolumeLevel(uint channel, float levelDb, Guid eventContext);
  int SetChannelVolumeLevelScalar(uint channel, float level, Guid eventContext);
  int GetChannelVolumeLevel(uint channel, ref float levelDb);
  int GetChannelVolumeLevelScalar(uint channel, ref float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, Guid eventContext);
  int GetMute([MarshalAs(UnmanagedType.Bool)] ref bool muted);
  int GetVolumeStepInfo(ref uint step, ref uint stepCount);
  int VolumeStepUp(Guid eventContext);
  int VolumeStepDown(Guid eventContext);
  int QueryHardwareSupport(ref uint mask);
  int GetVolumeRange(ref float minDb, ref float maxDb, ref float incrementDb);
}

public static class AetherAudio {
  private static IAudioEndpointVolume Endpoint() {
    IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDevice device;
    int result = enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device);
    if (result != 0) Marshal.ThrowExceptionForHR(result);
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object endpoint;
    result = device.Activate(ref iid, 23, IntPtr.Zero, out endpoint);
    if (result != 0) Marshal.ThrowExceptionForHR(result);
    return (IAudioEndpointVolume)endpoint;
  }

  public static void SetVolume(float value) {
    value = Math.Max(0f, Math.Min(1f, value));
    Guid context = Guid.Empty;
    int result = Endpoint().SetMasterVolumeLevelScalar(value, context);
    if (result != 0) Marshal.ThrowExceptionForHR(result);
  }

  public static void ChangeVolume(float delta) {
    IAudioEndpointVolume endpoint = Endpoint();
    float value = 0f;
    int result = endpoint.GetMasterVolumeLevelScalar(ref value);
    if (result != 0) Marshal.ThrowExceptionForHR(result);
    value = Math.Max(0f, Math.Min(1f, value + delta));
    Guid context = Guid.Empty;
    result = endpoint.SetMasterVolumeLevelScalar(value, context);
    if (result != 0) Marshal.ThrowExceptionForHR(result);
  }

  public static void ToggleMute() {
    IAudioEndpointVolume endpoint = Endpoint();
    bool muted = false;
    int result = endpoint.GetMute(ref muted);
    if (result != 0) Marshal.ThrowExceptionForHR(result);
    Guid context = Guid.Empty;
    result = endpoint.SetMute(!muted, context);
    if (result != 0) Marshal.ThrowExceptionForHR(result);
  }

  public static string GetStateJson() {
    IAudioEndpointVolume endpoint = Endpoint();
    float volume = 0f;
    bool muted = false;
    int volumeResult = endpoint.GetMasterVolumeLevelScalar(ref volume);
    int muteResult = endpoint.GetMute(ref muted);
    if (volumeResult != 0) Marshal.ThrowExceptionForHR(volumeResult);
    if (muteResult != 0) Marshal.ThrowExceptionForHR(muteResult);
    int percent = (int)Math.Round(volume * 100f);
    return "{\"volume\":" + percent + ",\"isMuted\":" + (muted ? "true" : "false") + "}";
  }
}`;

function parseAudioState(stdout) {
  const jsonLine = String(stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .reverse()
    .find(line => line.startsWith('{') && line.endsWith('}'));
  if (!jsonLine) throw new Error('Windows audio returned no state');
  const state = JSON.parse(jsonLine);
  const volume = Number(state.volume);
  if (!Number.isFinite(volume) || volume < 0 || volume > 100 || typeof state.isMuted !== 'boolean') {
    throw new Error('Windows audio returned an invalid state');
  }
  return { volume: Math.round(volume), isMuted: state.isMuted };
}

function createWindowsAudioController(options = {}) {
  const execFileImpl = options.execFileImpl || execFile;
  const escapedType = coreAudioTypeDefinition.replace(/'/g, "''");
  const worker = options.execFileImpl ? null : createPowerShellLineWorker({
    spawnImpl: options.spawnImpl,
    failureMessage: 'Не удалось изменить системную громкость Windows',
    script: `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $source='${escapedType}'; Add-Type -TypeDefinition $source; while (($line=[Console]::In.ReadLine()) -ne $null) { try { $request=$line | ConvertFrom-Json; $value=[double]$request.value; if ($request.operation -eq 'SET') { [AetherAudio]::SetVolume($value/100) } elseif ($request.operation -eq 'UP') { [AetherAudio]::ChangeVolume($value/100) } elseif ($request.operation -eq 'DOWN') { [AetherAudio]::ChangeVolume(-$value/100) } elseif ($request.operation -eq 'MUTE') { [AetherAudio]::ToggleMute() }; [Console]::Out.WriteLine([AetherAudio]::GetStateJson()) } catch { [Console]::Out.WriteLine('{"error":"audio_failed"}') } }`
  });

  function execute(operation = 'GET', value = 0) {
    const normalizedValue = Math.max(0, Math.min(100, Number(value) || 0));
    if (worker) return worker.request({ operation, value: normalizedValue }).then(result => parseAudioState(JSON.stringify(result)));
    let invoke = '';
    if (operation === 'SET') invoke = `[AetherAudio]::SetVolume(${(normalizedValue / 100).toFixed(4)});`;
    if (operation === 'UP') invoke = `[AetherAudio]::ChangeVolume(${(normalizedValue / 100).toFixed(4)});`;
    if (operation === 'DOWN') invoke = `[AetherAudio]::ChangeVolume(-${(normalizedValue / 100).toFixed(4)});`;
    if (operation === 'MUTE') invoke = '[AetherAudio]::ToggleMute();';
    const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $source='${escapedType}'; Add-Type -TypeDefinition $source; ${invoke} [AetherAudio]::GetStateJson()`;
    const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');

    return new Promise((resolve, reject) => {
      execFileImpl(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
        { encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            reject(new Error('Не удалось изменить системную громкость Windows'));
            return;
          }
          try {
            resolve(parseAudioState(stdout));
          } catch (parseError) {
            reject(parseError);
          }
        }
      );
    });
  }

  return {
    getState: () => execute('GET'),
    setVolume: value => execute('SET', value),
    stepUp: value => execute('UP', value),
    stepDown: value => execute('DOWN', value),
    toggleMute: () => execute('MUTE'),
    close: () => worker?.close()
  };
}

module.exports = { coreAudioTypeDefinition, createWindowsAudioController, parseAudioState };
