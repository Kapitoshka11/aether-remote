const PRIORITY = ['bridge', 'router', 'direct_udp'];

function selectWakeRoute(routes) {
  const available = new Map((routes || [])
    .filter(route => route?.status === 'available')
    .map(route => [route.kind, route]));
  for (const kind of PRIORITY) {
    if (available.has(kind)) return available.get(kind);
  }
  return null;
}

module.exports = { selectWakeRoute };
