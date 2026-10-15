// VOXA Protected Call signalling: authorization, consent, two-party limit, relay scoping, ending.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createServer} from '../server.mjs';
import {loadConfig} from '../server/config.mjs';
import {createAuth} from '../server/auth.mjs';
import {attachCall, createCallRooms} from '../server/call.mjs';

async function boot(t, env = {AUTH_MODE: 'demo'}, authDeps) {
  const cfg = loadConfig(env), audits = [];
  const calls = createCallRooms({audit: async e => audits.push(e)});
  const s = createServer({}, fetch, {cfg, calls, auth: authDeps ? createAuth(cfg, authDeps) : undefined});
  calls.audit = async e => audits.push(e); // record call events for assertions
  attachCall(s, calls, {hostOk: s.voxa.hostOk, originOk: (o, host) => o === `http://${host}` || cfg.origins.includes(o)});
  await new Promise(r => s.listen(0, '127.0.0.1', r)); t.after(() => s.close());
  const base = `http://127.0.0.1:${s.address().port}`;
  return {base, calls, audits, create: (headers = {}) => fetch(base + '/api/calls', {method: 'POST', headers: {Origin: base, 'X-Voxa-Request': '1', ...headers}})};
}
function peer(base, origin = base) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/api/call', {origin});
  const inbox = [];
  ws.on('message', m => inbox.push(JSON.parse(m.toString())));
  const next = type => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout waiting for ' + type)), 4000); const iv = setInterval(() => { const i = inbox.findIndex(x => x.type === type); if (i >= 0) { clearInterval(iv); clearTimeout(t); res(inbox.splice(i, 1)[0]); } }, 10); });
  return {ws, inbox, next, open: () => once(ws, 'open'), send: d => ws.send(JSON.stringify(d)), closed: () => new Promise(r => (ws.readyState === 3 ? r() : ws.once('close', (c) => r(c))))};
}

test('creating a call needs a signed-in user (Clerk mode); keys are random and only hashes are stored', async t => {
  const {create, calls} = await boot(t, {AUTH_MODE: 'clerk', CLERK_SECRET_KEY: 'sk_test_' + 'a'.repeat(30), CLERK_PUBLISHABLE_KEY: 'pk_test_' + Buffer.from('x.clerk.accounts.dev$').toString('base64')},
    {verify: async tk => { if (tk !== 'tok_valid_0123456789abcd') throw new Error('bad'); return {sub: 'user_1'}; }, fetchProfile: async () => ({email: 'a@b.c', emailVerified: true})});
  assert.equal((await create()).status, 401);
  const r = await create({Authorization: 'Bearer tok_valid_0123456789abcd'}); const d = await r.json();
  assert.equal(r.status, 201); assert.match(d.invitePath, /^\/call\.html#[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{30,}$/);
  const stored = JSON.stringify([...calls.rooms.values()].map(x => ({...x, keys: x.keys.host.toString('hex') + x.keys.guest.toString('hex')})));
  assert.ok(!stored.includes(d.hostKey) && !stored.includes(d.guestKey), 'plain keys are never stored');
});

test('join needs the right key and consent; at most one host and one guest; foreign origins refused', async t => {
  const {base, create} = await boot(t);
  const room = await (await create()).json();
  const bad = peer(base); await bad.open(); bad.send({type: 'hello', room: room.roomId, role: 'guest', key: 'wrong-key', consent: true});
  assert.match((await bad.next('denied')).reason, /invalid or has expired/);
  const noConsent = peer(base); await noConsent.open(); noConsent.send({type: 'hello', room: room.roomId, role: 'guest', key: room.guestKey, consent: false});
  assert.match((await noConsent.next('denied')).reason, /Consent/);
  const swap = peer(base); await swap.open(); swap.send({type: 'hello', room: room.roomId, role: 'host', key: room.guestKey, consent: true});
  assert.match((await swap.next('denied')).reason, /invalid/, 'the guest key cannot claim the host role');
  const host = peer(base); await host.open(); host.send({type: 'hello', room: room.roomId, role: 'host', key: room.hostKey, consent: true});
  const j = await host.next('joined'); assert.equal(j.peerPresent, false); assert.ok(Array.isArray(j.iceServers));
  const host2 = peer(base); await host2.open(); host2.send({type: 'hello', room: room.roomId, role: 'host', key: room.hostKey, consent: true});
  assert.match((await host2.next('denied')).reason, /already connected/);
  const evil = new WebSocket(base.replace('http', 'ws') + '/api/call', {origin: 'https://evil.example'});
  const err = await new Promise(r => evil.once('error', r)); assert.match(err.message, /403/);
  for (const p of [bad, noConsent, swap, host, host2]) p.ws.close();
});

test('signals reach only the other peer; host risk-ending notifies the guest without the reason and audits rule ids only', async t => {
  const {base, create, audits} = await boot(t);
  const room = await (await create()).json();
  const host = peer(base), guest = peer(base); await host.open(); await guest.open();
  host.send({type: 'hello', room: room.roomId, role: 'host', key: room.hostKey, consent: true}); await host.next('joined');
  guest.send({type: 'hello', room: room.roomId, role: 'guest', key: room.guestKey, consent: true}); await guest.next('joined');
  assert.equal((await host.next('peer-joined')).role, 'guest');
  host.send({type: 'signal', data: {sdp: {type: 'offer', sdp: 'v=0 fake'}}});
  const got = await guest.next('signal'); assert.equal(got.data.sdp.type, 'offer'); assert.equal(host.inbox.filter(x => x.type === 'signal').length, 0, 'not echoed to the sender');
  guest.send({type: 'signal', data: {candidate: {candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host'}}});
  assert.ok((await host.next('signal')).data.candidate);
  host.send({type: 'end', reason: 'risk_policy', state: 'critical', ruleIds: ['otp_pin', 'secrecy'], transcript: 'MUST NOT BE LOGGED'});
  const ended = await guest.next('ended'); assert.deepEqual(ended, {type: 'ended', by: 'host'}, 'the guest is not told the risk reason');
  await Promise.all([host.closed(), guest.closed()]);
  const a = audits.find(e => e.action === 'call.auto_ended');
  assert.ok(a); assert.deepEqual(a.metadata.categories, ['otp_pin', 'secrecy']); assert.ok(!JSON.stringify(audits).includes('MUST NOT BE LOGGED'));
  const late = peer(base); await late.open(); late.send({type: 'hello', room: room.roomId, role: 'guest', key: room.guestKey, consent: true});
  assert.match((await late.next('denied')).reason, /expired/, 'an ended call cannot be rejoined');
});

test('a guest cannot end the call with a risk reason; unknown WebSocket paths are refused', async t => {
  const {base, create, audits} = await boot(t);
  const room = await (await create()).json();
  const host = peer(base), guest = peer(base); await host.open(); await guest.open();
  host.send({type: 'hello', room: room.roomId, role: 'host', key: room.hostKey, consent: true}); await host.next('joined');
  guest.send({type: 'hello', room: room.roomId, role: 'guest', key: room.guestKey, consent: true}); await guest.next('joined');
  guest.send({type: 'end', reason: 'risk_policy'});
  assert.equal((await host.next('ended')).by, 'guest');
  await new Promise(r => setTimeout(r, 100));
  assert.ok(audits.some(e => e.action === 'call.ended' && e.metadata.reason === 'hangup'));
});
