const { spawn } = require('node:child_process');
const { advertisableIpv4Entries } = require('./network-policy.cjs');

const WINDOWS_WATCHER_SOURCE = String.raw`
using System;
using System.Net.NetworkInformation;
using System.Threading;

public static class AetherNetworkChangeWatcher
{
    public static void Run()
    {
        NetworkChange.NetworkAddressChanged += (sender, args) =>
        {
            Console.Out.WriteLine("NETWORK_CHANGED");
            Console.Out.Flush();
        };
        Console.Out.WriteLine("WATCHER_READY");
        Console.Out.Flush();
        Thread.Sleep(Timeout.Infinite);
    }
}
`;

function networkInterfaceSignature(networkInterfaces) {
  return advertisableIpv4Entries(networkInterfaces)
    .map(({ name, entry }) => [
      name,
      entry.address || '',
      entry.netmask || '',
      entry.mac || ''
    ].join('|'))
    .sort()
    .join('\n');
}

function windowsWatcherCommand() {
  const escapedSource = WINDOWS_WATCHER_SOURCE.replace(/'/g, "''");
  const script = `Add-Type -TypeDefinition '${escapedSource}' -Language CSharp; [AetherNetworkChangeWatcher]::Run()`;
  return Buffer.from(script, 'utf16le').toString('base64');
}

function createNetworkChangeMonitor({
  onChange,
  getNetworkInterfaces,
  platform = process.platform,
  spawnProcess = spawn,
  debounceMs = 750,
  fallbackIntervalMs = 30_000,
  restartDelayMs = 5_000,
  logger = console
}) {
  if (typeof onChange !== 'function') throw new TypeError('onChange must be a function');
  if (typeof getNetworkInterfaces !== 'function') throw new TypeError('getNetworkInterfaces must be a function');

  let running = false;
  let child = null;
  let stdoutBuffer = '';
  let debounceTimer = null;
  let restartTimer = null;
  let fallbackInterval = null;
  let lastSignature = '';

  function checkNow() {
    if (!running) return false;
    const nextSignature = networkInterfaceSignature(getNetworkInterfaces());
    if (nextSignature === lastSignature) return false;
    const previousSignature = lastSignature;
    lastSignature = nextSignature;
    onChange({ previousSignature, nextSignature });
    return true;
  }

  function scheduleCheck() {
    if (!running) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      try {
        checkNow();
      } catch (error) {
        logger.warn?.(`[Network] Failed to refresh interfaces: ${error.message}`);
      }
    }, debounceMs);
    debounceTimer.unref?.();
  }

  function scheduleWatcherRestart() {
    if (!running || platform !== 'win32' || restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      startWindowsWatcher();
    }, restartDelayMs);
    restartTimer.unref?.();
  }

  function startWindowsWatcher() {
    if (!running || platform !== 'win32' || child) return;
    try {
      const candidate = spawnProcess('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', windowsWatcherCommand()
      ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      child = candidate;
      stdoutBuffer = '';
      candidate.stdout?.on('data', chunk => {
        stdoutBuffer += chunk.toString('utf8');
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || '';
        if (lines.some(line => line.trim() === 'NETWORK_CHANGED')) scheduleCheck();
      });
      candidate.stderr?.on('data', () => {});
      candidate.on('error', error => {
        logger.warn?.(`[Network] Native change watcher failed: ${error.message}`);
      });
      let watcherClosed = false;
      const handleWatcherClosed = () => {
        if (watcherClosed) return;
        watcherClosed = true;
        if (child === candidate) child = null;
        scheduleWatcherRestart();
      };
      candidate.on('exit', handleWatcherClosed);
      candidate.on('close', handleWatcherClosed);
    } catch (error) {
      logger.warn?.(`[Network] Native change watcher failed to start: ${error.message}`);
      child = null;
      scheduleWatcherRestart();
    }
  }

  function start() {
    if (running) return;
    running = true;
    lastSignature = networkInterfaceSignature(getNetworkInterfaces());
    startWindowsWatcher();
    fallbackInterval = setInterval(scheduleCheck, fallbackIntervalMs);
    fallbackInterval.unref?.();
  }

  function stop() {
    if (!running) return;
    running = false;
    clearTimeout(debounceTimer);
    clearTimeout(restartTimer);
    clearInterval(fallbackInterval);
    debounceTimer = null;
    restartTimer = null;
    fallbackInterval = null;
    const activeChild = child;
    child = null;
    if (activeChild && !activeChild.killed) activeChild.kill();
  }

  return { start, stop, checkNow };
}

module.exports = {
  createNetworkChangeMonitor,
  networkInterfaceSignature,
  windowsWatcherCommand
};
