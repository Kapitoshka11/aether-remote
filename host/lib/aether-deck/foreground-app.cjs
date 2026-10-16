const { execFile } = require('node:child_process');

function normalize(value) { return String(value || '').trim().toLowerCase(); }

function ruleMatches(rule, application) {
  if (rule.processName && normalize(rule.processName) !== normalize(application.processName)) return false;
  if (rule.executablePath && normalize(rule.executablePath) !== normalize(application.executablePath)) return false;
  if (rule.windowTitle && !normalize(application.windowTitle).includes(normalize(rule.windowTitle))) return false;
  return Boolean(rule.processName || rule.executablePath || rule.windowTitle);
}

function selectDeckForApplication(document, application) {
  const matches = [];
  for (const deck of document.decks || []) {
    if (deck.enabled === false || deck.autoSwitchEnabled !== true) continue;
    for (const rule of deck.applicationRules || []) {
      if (ruleMatches(rule, application)) matches.push({ deckId: deck.id, priority: Number(rule.priority) || 0 });
    }
  }
  matches.sort((left, right) => right.priority - left.priority);
  return matches[0]?.deckId || null;
}

function readWindowsForeground() {
  const script = `Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AetherForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
'@; $handle=[AetherForeground]::GetForegroundWindow(); $pidValue=0; [void][AetherForeground]::GetWindowThreadProcessId($handle,[ref]$pidValue); $builder=New-Object Text.StringBuilder 1024; [void][AetherForeground]::GetWindowText($handle,$builder,1024); $process=Get-Process -Id $pidValue -ErrorAction SilentlyContinue; if ($process) { [pscustomobject]@{processName=($process.ProcessName + '.exe'); executablePath=$process.Path; windowTitle=$builder.ToString()} | ConvertTo-Json -Compress }`;
  return new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
    if (error || !stdout.trim()) return resolve(null);
    try { resolve(JSON.parse(stdout.trim())); } catch { resolve(null); }
  }));
}

function createForegroundAppObserver({ publish, readForeground = readWindowsForeground, shouldObserve = () => true, intervalMs = 1000 }) {
  let timer = null;
  let stopped = true;
  let lastKey = '';
  let reading = false;
  async function tick() {
    if (stopped || reading || !shouldObserve()) return;
    reading = true;
    try {
      const current = await readForeground();
      if (!current) return;
      const key = JSON.stringify([normalize(current.processName), normalize(current.executablePath), String(current.windowTitle || '')]);
      if (key !== lastKey) { lastKey = key; publish(current); }
    } finally { reading = false; }
  }
  return {
    start() { if (!stopped) return; stopped = false; tick(); timer = setInterval(tick, Math.max(5, intervalMs)); },
    stop() { stopped = true; if (timer) clearInterval(timer); timer = null; }
  };
}

module.exports = { createForegroundAppObserver, readWindowsForeground, selectDeckForApplication };
