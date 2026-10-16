const http = require('node:http');
const crypto = require('node:crypto');

async function createOAuthCallback({ timeoutMs = 180000 } = {}) {
  const route = `/aether-account/${crypto.randomBytes(24).toString('hex')}`;
  let resolve, reject, timer, finished = false;
  const result = new Promise((yes, no) => { resolve = yes; reject = no; });
  result.catch(() => {});
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (finished || req.method !== 'GET' || req.url.length > 8192 || req.headers.host !== `127.0.0.1:${server.address().port}`) {
      res.writeHead(400).end('Недопустимый запрос.'); return;
    }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== route) { res.writeHead(404).end('Не найдено.'); return; }
    const code = url.searchParams.get('code');
    const flowId = url.searchParams.get('sb_flow_id');
    if (url.searchParams.has('error') || !code || code.length > 4096 ||
        (flowId !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(flowId))) {
      res.writeHead(400).end('Вход не завершён. Вернитесь в Aether Remote.');
      finish(new Error('account_oauth_failed')); return;
    }
    res.end('Ответ получен. Можно вернуться в Aether Remote.');
    finish(null, { code, flowId });
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  server.maxConnections = 4;
  function finish(error, value) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    server.close();
    server.closeIdleConnections();
    if (error) reject(error); else resolve(value);
  }
  await new Promise((yes, no) => {
    server.once('error', no);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', no); yes(); });
  });
  server.on('error', () => finish(new Error('account_oauth_callback_failed')));
  timer = setTimeout(() => finish(new Error('account_oauth_timeout')), timeoutMs);
  timer.unref();
  return { redirectTo: `http://127.0.0.1:${server.address().port}${route}`, result,
    cancel() { finish(new Error('account_oauth_cancelled')); server.closeAllConnections(); } };
}

module.exports = { createOAuthCallback };
