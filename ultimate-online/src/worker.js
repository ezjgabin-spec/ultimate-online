/* =====================================================================================
   BLACKTOP game server (Cloudflare Worker + Durable Objects)
   - serves the game (public/index.html) at your domain
   - /ws?room=NAME&peer=ID  ->  one Durable Object per room name relays messages between players
       lobby rooms  "blk-lobby-1", "blk-lobby-2", ...  (the shared park, up to LOBBY_CAP players each)
       party/game rooms  "blk-xxxxp", "blk-xxxxb", "blk-xxxxf"  (small, up to ROOM_CAP)
   client -> server   {t:'pres', p:{...}}                    set my presence (name, look, ...)
                      {t:'emit', topic, data, to?}           send to everyone else (or one peer)
                      {t:'ping'}                             keep-alive (answered without waking the room)
   server -> client   {t:'welcome', peer, peers:[{peer,p}]}  on connect / reconnect
                      {t:'join'|'pres', peer, p} {t:'left', peer} {t:'emit', peer, topic, data} {t:'full'}
   ===================================================================================== */
import { DurableObject } from 'cloudflare:workers';

const LOBBY_CAP = 30, ROOM_CAP = 8, MAX_MSG = 16000, GRACE_MS = 6000, RATE = 90;
const cleanRoom = s => String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
const cleanPeer = s => String(s || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
      const room = cleanRoom(url.searchParams.get('room'));
      if (!room.startsWith('blk-')) return new Response('bad room', { status: 400 });
      return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(req);
    }
    if (url.pathname === '/api/hello') return Response.json({ blacktop: 1 }, { headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
    return env.ASSETS.fetch(req);
  }
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rate = new Map();      // ws -> [windowStart, count]
    this.pend = new Map();      // peer -> timer for a delayed "left" (wifi blips don't kick people)
    this.lastP = new Map();     // peer -> last presence, for a quick reconnect
    try { this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}')); } catch (e) {}
  }
  info(ws) { try { return ws.deserializeAttachment() || {}; } catch (e) { return {}; } }
  sockets() { return this.ctx.getWebSockets().filter(w => w.readyState === 1 || w.readyState === undefined); }
  send(ws, o) { try { ws.send(typeof o === 'string' ? o : JSON.stringify(o)); } catch (e) {} }
  bcast(from, o) { const s = typeof o === 'string' ? o : JSON.stringify(o); for (const w of this.sockets()) if (w !== from) this.send(w, s); }

  async fetch(req) {
    const url = new URL(req.url);
    const room = cleanRoom(url.searchParams.get('room'));
    const peer = cleanPeer(url.searchParams.get('peer')) || crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const cap = room.startsWith('blk-lobby') ? LOBBY_CAP : ROOM_CAP;
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    // the same player reconnecting: drop the old socket quietly
    let had = null;
    for (const w of this.ctx.getWebSockets(peer)) { had = this.info(w).p || had; try { w.serializeAttachment({ peer, p: {}, gone: 1 }); w.close(4000, 'replaced'); } catch (e) {} }
    if (this.pend.has(peer)) { clearTimeout(this.pend.get(peer)); this.pend.delete(peer); had = had || this.lastP.get(peer) || {}; }
    const others = this.sockets().filter(w => { const a = this.info(w); return a.peer && a.peer !== peer && !a.gone; });
    this.ctx.acceptWebSocket(server, [peer]);
    if (others.length >= cap) {
      this.send(server, { t: 'full' }); try { server.close(4001, 'full'); } catch (e) {}
      return new Response(null, { status: 101, webSocket: client });
    }
    server.serializeAttachment({ peer, p: had || {} });
    this.send(server, { t: 'welcome', peer, peers: others.map(w => { const a = this.info(w); return { peer: a.peer, p: a.p || {} }; }) });
    if (!had) this.bcast(server, { t: 'join', peer, p: {} });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > MAX_MSG) return;
    const now = Date.now(), r = this.rate.get(ws) || [now, 0];
    if (now - r[0] > 1000) { r[0] = now; r[1] = 0; }
    if (++r[1] > RATE) { this.rate.set(ws, r); return; }        // flooding: drop
    this.rate.set(ws, r);
    let m; try { m = JSON.parse(msg); } catch (e) { return; }
    const a = this.info(ws); if (!a.peer || a.gone) return;
    if (m.t === 'pres') {
      const p = (m.p && typeof m.p === 'object') ? m.p : {};
      if (JSON.stringify(p).length > 4000) return;
      a.p = p; ws.serializeAttachment(a);
      this.bcast(ws, { t: 'pres', peer: a.peer, p });
    } else if (m.t === 'emit' && typeof m.topic === 'string') {
      const out = JSON.stringify({ t: 'emit', peer: a.peer, topic: m.topic.slice(0, 24), data: m.data === undefined ? null : m.data });
      if (m.to) { for (const w of this.ctx.getWebSockets(cleanPeer(m.to))) this.send(w, out); }
      else this.bcast(ws, out);
    } else if (m.t === 'ping') this.send(ws, { t: 'pong' });
  }

  closed(ws, code) {
    this.rate.delete(ws);
    const a = this.info(ws); if (!a.peer || a.gone || code === 4000 || code === 4001) return;
    const peer = a.peer; this.lastP.set(peer, a.p || {});
    if (this.lastP.size > 200) this.lastP.delete(this.lastP.keys().next().value);
    if (code === 1000) { this.bcast(ws, { t: 'left', peer }); return; }     // they left on purpose
    if (this.pend.has(peer)) clearTimeout(this.pend.get(peer));
    this.pend.set(peer, setTimeout(() => {                                 // a blip: give them a few seconds to come back
      this.pend.delete(peer);
      const back = this.ctx.getWebSockets(peer).some(w => !this.info(w).gone && w !== ws);
      if (!back) this.bcast(ws, { t: 'left', peer });
    }, GRACE_MS));
  }
  async webSocketClose(ws, code, reason) { this.closed(ws, code); try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch (e) {} }
  async webSocketError(ws) { this.closed(ws, 1006); }
}
