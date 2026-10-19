import { DurableObject } from 'cloudflare:workers';
import { handleSignal, type RateWindow } from './hubLogic.ts';

/**
 * One instance relays connection set-up messages between members who have the HMS Data Sync app open. Members connect with a WebSocket; the object sleeps
 * (and costs nothing) while nothing is being said. It keeps no data: a message for a member who is not connected is simply reported as not delivered.
 */
export class SyncHub extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const key = request.headers.get('X-Member-Key');
    if (!key) return new Response('Missing member', { status: 400 });
    // One connection per member: a newer one replaces the older.
    for (const old of this.ctx.getWebSockets(key)) old.close(1000, 'Replaced by a newer connection');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [key]);
    server.serializeAttachment({ w: 0, n: 0 } satisfies RateWindow);
    // Keep-alive pings are answered without waking the object.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    const key = this.ctx.getTags(ws)[0];
    const rate = (ws.deserializeAttachment() as RateWindow | null) ?? { w: 0, n: 0 };
    const reply = await handleSignal(key, message, Math.floor(Date.now() / 1000), rate, (to) => this.ctx.getWebSockets(to));
    ws.serializeAttachment(rate);
    ws.send(JSON.stringify(reply));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }
}
