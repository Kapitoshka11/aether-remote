const { spawn } = require('node:child_process');

function createPowerShellLineWorker({ script, spawnImpl = spawn, timeoutMs = 10000, failureMessage }) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  let child = null;
  let stdoutBuffer = '';
  const pending = [];

  function rejectAll(error) {
    while (pending.length) {
      const request = pending.shift();
      clearTimeout(request.timeout);
      request.reject(error);
    }
  }

  function ensureChild() {
    if (child && !child.killed && child.stdin && !child.stdin.destroyed) return child;
    child = spawnImpl('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true
    });
    stdoutBuffer = '';
    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk.toString('utf8');
      let newline;
      while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (!line) continue;
        let result;
        try {
          result = JSON.parse(line);
        } catch (_) {
          continue;
        }
        const request = pending.shift();
        if (!request) continue;
        clearTimeout(request.timeout);
        if (result && result.error) request.reject(new Error(failureMessage));
        else request.resolve(result);
      }
    });
    const failed = () => {
      child = null;
      rejectAll(new Error(failureMessage));
    };
    child.once('error', failed);
    child.once('exit', failed);
    return child;
  }

  function request(payload) {
    return new Promise((resolve, reject) => {
      const process = ensureChild();
      const entry = { resolve, reject, timeout: null };
      entry.timeout = setTimeout(() => {
        const index = pending.indexOf(entry);
        if (index >= 0) pending.splice(index, 1);
        try { process.kill(); } catch (_) {}
        child = null;
        reject(new Error(failureMessage));
      }, timeoutMs);
      pending.push(entry);
      try {
        process.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (_) {
        clearTimeout(entry.timeout);
        pending.splice(pending.indexOf(entry), 1);
        reject(new Error(failureMessage));
      }
    });
  }

  function close() {
    if (child) {
      try { child.stdin.end(); } catch (_) {}
      child = null;
    }
  }

  return { request, close };
}

module.exports = { createPowerShellLineWorker };
