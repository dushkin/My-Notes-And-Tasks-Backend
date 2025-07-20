import { WebSocketServer } from 'ws';
const clients = new Map();

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const userId = req.headers['sec-websocket-protocol'];
        if (!userId) return ws.close();

        if (!clients.has(userId)) clients.set(userId, []);
        clients.get(userId).push(ws);

        ws.on('close', () => {
          const arr = clients.get(userId)?.filter((c) => c !== ws);
          clients.set(userId, arr);
        });
      });
    }
  });
}

export function notifyUser(userId, payload) {
  const sessions = clients.get(userId) || [];
  sessions.forEach(ws => {
    try { ws.send(JSON.stringify(payload)); } catch {}
  });
}
