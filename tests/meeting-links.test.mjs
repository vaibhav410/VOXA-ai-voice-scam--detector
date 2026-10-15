import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../js/meeting-links.js';
import {createServer} from '../server.mjs';
const L = globalThis.VoxaMeetingLinks;
const ok = (p, u) => { const r = L.validate(p, u); assert.equal(r.ok, true, `${p} should accept ${u}: ${r.error}`); return r; };
const bad = (p, u, why = '') => { const r = L.validate(p, u); assert.equal(r.ok, false, `${p} should reject ${JSON.stringify(u)} ${why}`); assert.equal(typeof r.error, 'string'); };

test('Google Meet: accepts real meeting links and nothing else', () => {
  assert.equal(ok('meet', 'https://meet.google.com/abc-defg-hij').url, 'https://meet.google.com/abc-defg-hij');
  ok('meet', 'meet.google.com/abc-defg-hij');                       // scheme-less paste
  ok('meet', '  https://meet.google.com/abc-defg-hij?authuser=1  '); // trims, keeps query
  ok('meet', 'https://MEET.GOOGLE.COM/abc-defg-hij/');                // case and trailing slash
  ok('meet', 'https://meet.google.com/lookup/abcd1234');
  for (const u of ['https://meet.google.com/', 'https://meet.google.com/new', 'https://meet.google.com/abc-defg', 'https://meet.google.com/abc-defg-hij/extra',
    'https://google.com/abc-defg-hij', 'https://evil-meet.google.com.attacker.com/abc-defg-hij', 'https://meet.google.com.evil.com/abc-defg-hij',
    'https://notmeet.google.com/abc-defg-hij', 'https://zoom.us/j/123456789']) bad('meet', u);
});

test('Zoom: accepts zoom.us and its subdomains, with the right meeting paths', () => {
  ok('zoom', 'https://zoom.us/j/123456789');
  ok('zoom', 'https://us02web.zoom.us/j/12345678901?pwd=AbCdEf123');
  ok('zoom', 'https://acme.zoom.us/my/jane.doe');
  ok('zoom', 'https://zoom.us/wc/join/123456789');
  ok('zoom', 'zoom.us/j/123456789');
  for (const u of ['https://zoom.us/', 'https://zoom.us/j/12', 'https://zoom.us/j/abcdefghi', 'https://zoom.us/profile',
    'https://evilzoom.us/j/123456789', 'https://zoom.us.evil.com/j/123456789', 'https://zoom.com/j/123456789',
    'https://meet.google.com/abc-defg-hij', 'https://fakezoom.us/j/123456789']) bad('zoom', u);
});

test('dangerous schemes, credentials, ports, unicode hosts and junk are rejected', () => {
  for (const p of ['meet', 'zoom']) {
    const good = p === 'meet' ? 'meet.google.com/abc-defg-hij' : 'zoom.us/j/123456789';
    for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'ftp://' + good, 'http://' + good, 'vbscript:x', 'blob:https://' + good,
      'https://user:pass@' + good, 'https://user@' + good, 'https://' + good.replace('/', ':8080/'), 'https://' + good + ' extra', 'https://' + good.slice(0, 12) + '\n' + good.slice(12), '', '   ', null, undefined, 42, 'x'.repeat(3000), '//' + 'evil.com/x', 'https://xn--zoom-9d0a.us/j/123456789']) bad(p, u);
  }
  assert.equal(L.validate('webex', 'https://webex.com/x').ok, false);
});

test('the Zoom passcode is masked for display but kept in the saved link', () => {
  const r = ok('zoom', 'https://us02web.zoom.us/j/12345678901?pwd=SECRETvalue');
  assert.ok(r.url.includes('SECRETvalue')); assert.ok(!r.display.includes('SECRETvalue')); assert.match(r.display, /pwd=••••/);
});

test('links are stored per user, can be updated and removed, and are revalidated on read', () => {
  const mem = new Map(); globalThis.localStorage = {getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k)};
  try {
    assert.equal(L.save('meet', 'https://meet.google.com/abc-defg-hij', 'alice').ok, true);
    assert.equal(L.save('zoom', 'https://zoom.us/j/123456789', 'alice').ok, true);
    assert.deepEqual(Object.keys(L.load('alice')).sort(), ['meet', 'zoom']);
    assert.deepEqual(L.load('bob'), {}, 'another user sees nothing');
    assert.equal(L.save('meet', 'https://meet.google.com/xyz-abcd-efg', 'alice').ok, true);
    assert.equal(L.load('alice').meet.url, 'https://meet.google.com/xyz-abcd-efg', 'update replaces the old link');
    assert.equal(L.save('meet', 'https://evil.com/abc-defg-hij', 'alice').ok, false);
    assert.equal(L.load('alice').meet.url, 'https://meet.google.com/xyz-abcd-efg', 'a rejected save changes nothing');
    L.remove('meet', 'alice'); assert.deepEqual(Object.keys(L.load('alice')), ['zoom']);
    mem.set('voxa:meetlinks:alice', JSON.stringify({zoom: {url: 'javascript:alert(1)'}}));
    assert.deepEqual(L.load('alice'), {}, 'tampered storage is ignored');
    mem.set('voxa:meetlinks:alice', '{not json'); assert.deepEqual(L.load('alice'), {});
  } finally { delete globalThis.localStorage; }
});

test('the server validates links with the same rules and never stores them', async t => {
  const s = createServer({}, async () => Response.json({})); await new Promise(r => s.listen(0, '127.0.0.1', r)); t.after(() => s.close());
  const base = `http://127.0.0.1:${s.address().port}`;
  const post = (body, headers = {}) => fetch(base + '/api/meeting-link/validate', {method: 'POST', headers: {Origin: base, 'X-Voxa-Request': '1', 'Content-Type': 'application/json', ...headers}, body: typeof body === 'string' ? body : JSON.stringify(body)});
  let r = await post({platform: 'meet', url: 'meet.google.com/abc-defg-hij'}); let d = await r.json();
  assert.equal(r.status, 200); assert.equal(d.url, 'https://meet.google.com/abc-defg-hij');
  r = await post({platform: 'zoom', url: 'https://us02web.zoom.us/j/12345678901?pwd=SECRET'}); d = await r.json(); assert.equal(r.status, 200); assert.ok(!d.display.includes('SECRET'));
  r = await post({platform: 'zoom', url: 'https://evilzoom.us/j/123456789'}); assert.equal(r.status, 422); assert.equal((await r.json()).code, 'INVALID_LINK');
  r = await post({platform: 'meet', url: 'javascript:alert(1)'}); assert.equal(r.status, 422);
  r = await post('{bad json'); assert.equal(r.status, 400);
  r = await post({platform: 'meet'}); assert.equal(r.status, 400);
  r = await post({platform: 'meet', url: 'meet.google.com/abc-defg-hij'}, {Origin: 'https://evil.example'}); assert.equal(r.status, 403, 'foreign origins are refused');
  r = await post({platform: 'meet', url: 'meet.google.com/abc-defg-hij'}, {'X-Voxa-Request': '0'}); assert.equal(r.status, 403);
  assert.equal((await fetch(base + '/api/meeting-link/validate')).status, 404, 'GET is not an endpoint');
});
