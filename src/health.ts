import { createServer, type Server } from 'node:http';

/**
 * Minimal liveness endpoint (to-do «Прод / деплой»). A long-polling bot has no HTTP
 * surface, so without this the platform can only see "container exists". GET /healthz
 * returns 200 once the bot has actually started polling (503 while booting), which
 * feeds the Dockerfile HEALTHCHECK. Bound to localhost only — the health probe runs
 * inside the container; nothing is exposed, matching the no-inbound-traffic deploy
 * (long polling, no domain).
 */
export function startHealthServer(port: number, isReady: () => boolean): Server {
  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      const ready = isReady();
      res.writeHead(ready ? 200 : 503, { 'content-type': 'text/plain' });
      res.end(ready ? 'ok' : 'starting');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  server.listen(port, '127.0.0.1');
  return server;
}
