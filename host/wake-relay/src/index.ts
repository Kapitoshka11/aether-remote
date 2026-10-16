export { HomeGroup } from './HomeGroup';

interface Env {
  HOME_GROUPS: DurableObjectNamespace;
}

function secure(response: Response): Response {
  const result = new Response(response.body, response);
  result.headers.set('cache-control', 'no-store');
  result.headers.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  result.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  result.headers.set('referrer-policy', 'no-referrer');
  result.headers.set('x-content-type-options', 'nosniff');
  result.headers.set('x-frame-options', 'DENY');
  return result;
}

function json(body: unknown, init?: ResponseInit): Response {
  return secure(Response.json(body, init));
}

const worker = {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    void context;
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ status: 'ok', protocolVersion: 1 });
    }
    if (request.method === 'POST' && url.pathname === '/v1/groups') {
      const text = await request.text();
      if (text.length > 16_384) return json({ error: 'message_too_large' }, { status: 413 });
      let body: { groupId?: unknown };
      try {
        body = JSON.parse(text) as { groupId?: unknown };
      } catch {
        return json({ error: 'invalid_json' }, { status: 400 });
      }
      if (typeof body.groupId !== 'string' || !/^[0-9a-f]{32}$/.test(body.groupId)) {
        return json({ error: 'invalid_group_id' }, { status: 400 });
      }
      const stub = env.HOME_GROUPS.get(env.HOME_GROUPS.idFromName(body.groupId));
      return secure(await stub.fetch(new Request('https://home-group/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: text
      })));
    }
    const memberMatch = url.pathname.match(/^\/v1\/groups\/([0-9a-f]{32})\/members$/);
    if (request.method === 'POST' && memberMatch) {
      const text = await request.text();
      if (text.length > 16_384) return json({ error: 'message_too_large' }, { status: 413 });
      let body: { groupId?: unknown };
      try {
        body = JSON.parse(text) as { groupId?: unknown };
      } catch {
        return json({ error: 'invalid_json' }, { status: 400 });
      }
      if (body.groupId !== memberMatch[1]) return json({ error: 'group_mismatch' }, { status: 400 });
      const stub = env.HOME_GROUPS.get(env.HOME_GROUPS.idFromName(memberMatch[1]));
      return secure(await stub.fetch(new Request('https://home-group/members', { method: 'POST', body: text })));
    }
    const socketMatch = url.pathname.match(/^\/v1\/groups\/([0-9a-f]{32})\/socket$/);
    if (request.method === 'GET' && socketMatch) {
      const stub = env.HOME_GROUPS.get(env.HOME_GROUPS.idFromName(socketMatch[1]));
      return stub.fetch(new Request(`https://home-group/socket${url.search}`, { headers: request.headers }));
    }
    const revokeMatch = url.pathname.match(/^\/v1\/groups\/([0-9a-f]{32})\/revoke$/);
    if (request.method === 'POST' && revokeMatch) {
      const text = await request.text();
      if (text.length > 16_384) return json({ error: 'message_too_large' }, { status: 413 });
      let body: { groupId?: unknown };
      try {
        body = JSON.parse(text) as { groupId?: unknown };
      } catch {
        return json({ error: 'invalid_json' }, { status: 400 });
      }
      if (body.groupId !== revokeMatch[1]) return json({ error: 'group_mismatch' }, { status: 400 });
      const stub = env.HOME_GROUPS.get(env.HOME_GROUPS.idFromName(revokeMatch[1]));
      return secure(await stub.fetch(new Request('https://home-group/revoke', { method: 'POST', body: text })));
    }
    return json({ error: 'not_found' }, { status: 404 });
  }
};

export default worker;
