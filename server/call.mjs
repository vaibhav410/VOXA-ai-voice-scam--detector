// VOXA Protected Call: signalling for a two-person WebRTC audio call. The server relays only connection set-up
// messages (SDP offers/answers and ICE candidates). Audio flows browser-to-browser and never touches this server
// or any storage. Live analysis happens in the host's browser via the existing /api/live transcription socket.
//
// Authorization: rooms are created only through the authenticated API (POST /api/calls). Each room has two random
// keys (host, guest); only their SHA-256 hashes are kept. A socket must present the right key AND consent before it
// is admitted. At most one host and one guest. Rooms expire after 2 hours and are kept only in memory.
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {WebSocketServer, WebSocket} from 'ws';

const hash = s => createHash('sha256').update(String(s)).digest();
const sameHash = (a, b) => a.length === b.length && timingSafeEqual(a, b);
const ROOM_TTL_MS = 2 * 3600000, MAX_ROOMS = 200, MAX_PER_OWNER = 5;

export function defaultIceServers(env = process.env) {
  try { const v = JSON.parse(env.VOXA_ICE_SERVERS || ''); if (Array.isArray(v) && v.length) return v; } catch {}
  return [{urls: 'stun:stun.l.google.com:19302'}];
}

export function createCallRooms({now = () => Date.now(), audit = async () => {}} = {}) {
  const rooms = new Map();
  const sweep = () => { for (const [id, r] of rooms) if (r.expiresAt <= now() || (r.ended && !r.peers.host && !r.peers.guest)) rooms.delete(id); };
  return {
    rooms, audit,
    create(ownerSubject) {
      sweep();
      if (rooms.size >= MAX_ROOMS) return {error: 'BUSY'};
      if ([...rooms.values()].filter(r => r.owner === ownerSubject && !r.ended).length >= MAX_PER_OWNER) return {error: 'TOO_MANY'};
      const id = randomBytes(12).toString('base64url'), hostKey = randomBytes(24).toString('base64url'), guestKey = randomBytes(24).toString('base64url');
      rooms.set(id, {id, owner: ownerSubject, keys: {host: hash(hostKey), guest: hash(guestKey)}, createdAt: now(), expiresAt: now() + ROOM_TTL_MS, peers: {host: null, guest: null}, consent: {host: false, guest: false}, ended: false});
      return {roomId: id, hostKey, guestKey, expiresAt: new Date(now() + ROOM_TTL_MS).toISOString()};
    },
    get: id => (typeof id === 'string' ? rooms.get(id) : undefined),
    sweep
  };
}

// Attach the /api/call WebSocket endpoint. originOk(origin, host) and hostOk(host) come from the HTTP server config.
export function attachCall(server, calls, {hostOk = () => true, originOk = () => true, iceServers = defaultIceServers()} = {}) {
  const wss = new WebSocketServer({noServer: true, maxPayload: 64 * 1024});
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/call') return; // other paths belong to other handlers
    const host = req.headers.host || '';
    if (!hostOk(host) || !originOk(req.headers.origin, host)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  const send = (ws, d) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(d)); };
  wss.on('connection', ws => {
    let room = null, role = null, msgs = 0;
    const window0 = setInterval(() => { msgs = 0; }, 60000);
    const hello = setTimeout(() => { if (!room) ws.close(4401, 'hello timeout'); }, 10000);
    const leave = () => {
      clearInterval(window0); clearTimeout(hello);
      if (room && room.peers[role] === ws) { room.peers[role] = null; room.consent[role] = false; send(room.peers[role === 'host' ? 'guest' : 'host'], {type: 'peer-left', role}); }
    };
    ws.on('close', leave); ws.on('error', leave);
    ws.on('message', raw => {
      if (++msgs > 600) return ws.close(4429, 'too many messages');
      let m; try { m = JSON.parse(raw.toString()); } catch { return ws.close(4400, 'bad message'); }
      if (!room) {
        if (m.type !== 'hello') return ws.close(4400, 'hello first');
        const r = calls.get(m.room);
        const okRole = m.role === 'host' || m.role === 'guest';
        if (!r || !okRole || r.ended || r.expiresAt <= Date.now() || typeof m.key !== 'string' || !sameHash(hash(m.key), r.keys[m.role])) { send(ws, {type: 'denied', reason: 'This call link is invalid or has expired.'}); return ws.close(4403, 'denied'); }
        if (m.consent !== true) { send(ws, {type: 'denied', reason: 'Consent is required to join a VOXA protected call.'}); return ws.close(4403, 'consent'); }
        if (r.peers[m.role]) { send(ws, {type: 'denied', reason: 'Someone is already connected in this role.'}); return ws.close(4409, 'busy'); }
        room = r; role = m.role; clearTimeout(hello);
        r.peers[role] = ws; r.consent[role] = true;
        const other = r.peers[role === 'host' ? 'guest' : 'host'];
        send(ws, {type: 'joined', role, peerPresent: Boolean(other), iceServers});
        send(other, {type: 'peer-joined', role});
        return;
      }
      if (m.type === 'signal') {
        const data = m.data && typeof m.data === 'object' ? m.data : null;
        if (!data || (!data.sdp && !data.candidate)) return;
        return send(room.peers[role === 'host' ? 'guest' : 'host'], {type: 'signal', data: {sdp: data.sdp ?? undefined, candidate: data.candidate ?? undefined}});
      }
      if (m.type === 'end') {
        // Either side may hang up. Only the host's protection can end it for a risk reason; the reason given to the
        // other side is generic. Audit keeps rule ids and the risk state only (no transcript, no audio).
        const reason = role === 'host' && m.reason === 'risk_policy' ? 'risk_policy' : 'hangup';
        room.ended = true;
        const other = room.peers[role === 'host' ? 'guest' : 'host'];
        send(other, {type: 'ended', by: role});
        calls.audit({action: reason === 'risk_policy' ? 'call.auto_ended' : 'call.ended', targetType: 'call', targetId: room.id.slice(0, 8), severity: reason === 'risk_policy' ? 'medium' : 'info',
          metadata: {reason, status: typeof m.state === 'string' ? m.state.slice(0, 12) : undefined, categories: Array.isArray(m.ruleIds) ? m.ruleIds.slice(0, 12).map(String) : undefined}}).catch?.(() => {});
        for (const p of [room.peers.host, room.peers.guest]) if (p) p.close(1000, 'ended');
      }
    });
  });
  const sweeper = setInterval(() => calls.sweep(), 60000); sweeper.unref?.();
  wss.on('close', () => clearInterval(sweeper));
  return wss;
}
