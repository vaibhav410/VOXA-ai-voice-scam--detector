// Audo AI (cloud noise removal) gating and behaviour. Audo is always mocked here: tests never call audo.ai.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

// Private temp dir for this test process, so temp-file cleanup checks are exact even when files run in parallel.
process.env.TEMP = process.env.TMP = process.env.TMPDIR = mkdtempSync(path.join(tmpdir(), 'voxa-test-'));
import {createServer} from '../server.mjs';
import {ffmpegPath} from '../server/media.mjs';
import {SR} from '../server/noise-core.mjs';
import {toWav, whiteNoise, sine, mix} from '../tools/noise-fixtures.mjs';

const skip = (await ffmpegPath()) ? false : 'FFmpeg is not available';
// Noise that the mocked Audo returns 30 dB quieter: a real, measurable improvement.
const noisy = toWav(whiteNoise(SR * 6, 0.05));
const cleaner = toWav(whiteNoise(SR * 6, 0.0016));
const tmpCount = () => readdirSync(tmpdir()).filter(n => /^voxa-[A-Za-z0-9]{6}$/.test(n)).length;

async function serve(t, fetcher, enabled = true) {
  const prev = process.env.AUDO_ENABLED;
  if (enabled) process.env.AUDO_ENABLED = '1'; else delete process.env.AUDO_ENABLED;
  t.after(() => { if (prev === undefined) delete process.env.AUDO_ENABLED; else process.env.AUDO_ENABLED = prev; });
  const calls = [];
  const s = createServer({}, async (url, opts) => { calls.push({url: String(url), opts}); return fetcher(url, opts); });
  await new Promise(r => s.listen(0, '127.0.0.1', r)); t.after(() => s.close());
  const base = `http://127.0.0.1:${s.address().port}`;
  const post = (qs, headers = {}) => fetch(base + '/api/noise' + qs, {method: 'POST', headers: {Origin: base, 'X-Voxa-Request': '1', 'Content-Type': 'audio/wav', ...headers}, body: noisy});
  return {post, calls, base};
}
const wavResponse = body => new Response(body, {status: 200, headers: {'Content-Type': 'audio/wav'}});

test('Audo is refused when the server has not enabled it, and nothing is sent', {skip}, async t => {
  const {post, calls} = await serve(t, async () => wavResponse(cleaner), false);
  const r = await post('?denoise=1&enhancer=audo', {'X-Voxa-External-Consent': 'audo'});
  assert.equal(r.status, 403); assert.equal((await r.json()).code, 'PROVIDER_DISABLED');
  assert.equal(calls.length, 0);
});
test('Audo needs explicit consent for each request; without it nothing is uploaded', {skip}, async t => {
  const {post, calls} = await serve(t, async () => wavResponse(cleaner));
  const r = await post('?denoise=1&enhancer=audo');
  assert.equal(r.status, 428); assert.equal((await r.json()).code, 'CONSENT_REQUIRED');
  assert.equal(calls.length, 0);
});
test('with consent: one upload to Audo, file name not sent, result measured and labelled as cloud processing', {skip}, async t => {
  const {post, calls} = await serve(t, async () => wavResponse(cleaner));
  const before = tmpCount();
  const r = await post('?denoise=1&enhancer=audo', {'X-Voxa-External-Consent': 'audo'}), d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1); assert.match(calls[0].url, /^https:\/\/audo\.ai\/api\/try\/remove-noise$/);
  const sent = calls[0].opts.body.get('file'); assert.match(sent.name, /^audio\.wav$/, 'the user file name must not be sent');
  const e = d.noise.enhancement;
  assert.equal(e.applied, true); assert.equal(e.provider, 'audo'); assert.match(e.method, /Audo AI/); assert.match(e.disclosure, /audo\.ai/);
  assert.equal(e.measuredImprovement, true); assert.ok(e.measured.relativeFloorChangeDb <= -3 || e.measured.floorChangeDb <= -3);
  assert.equal(d.enhancedAudio.mime, 'audio/wav'); assert.equal(Buffer.from(d.enhancedAudio.base64, 'base64').subarray(0, 4).toString('latin1'), 'RIFF');
  assert.equal(tmpCount(), before, 'temp files removed');
});
test('Audo failure is reported and is NOT silently replaced by local processing', {skip}, async t => {
  for (const [status, code] of [[429, 'AUDO_RATE_LIMITED'], [500, 'AUDO_HTTP_500']]) {
    const {post} = await serve(t, async () => new Response('nope', {status}));
    const r = await post('?denoise=1&enhancer=audo', {'X-Voxa-External-Consent': 'audo'}), d = await r.json();
    assert.equal(r.status, 200, 'the noise analysis itself still completes');
    assert.equal(d.enhancement, undefined);
    assert.equal(d.enhancedAudio, null);
    assert.equal(d.noise.enhancement.applied, false); assert.equal(d.noise.enhancement.errorCode, code);
    assert.ok(!(d.noise.enhancement.filters || []).length && !/afwtdn/.test(JSON.stringify(d.noise.enhancement)), 'no local fallback');
  }
});
test('a non-audio or undecodable reply from Audo is rejected, not passed on', {skip}, async t => {
  const {post} = await serve(t, async () => new Response('<html>error page</html>', {status: 200, headers: {'Content-Type': 'text/html'}}));
  const d = await (await post('?denoise=1&enhancer=audo', {'X-Voxa-External-Consent': 'audo'})).json();
  assert.equal(d.noise.enhancement.applied, false); assert.equal(d.noise.enhancement.errorCode, 'AUDO_INVALID_RESULT'); assert.equal(d.enhancedAudio, null);
});
test('free-tier truncation (first minute only) is detected and stated', {skip}, async t => {
  const short = toWav(whiteNoise(SR * 3, 0.0016));
  const {post} = await serve(t, async () => wavResponse(short));
  const d = await (await post('?denoise=1&enhancer=audo', {'X-Voxa-External-Consent': 'audo'})).json();
  assert.deepEqual(d.noise.enhancement.partial, {coveredSeconds: 3, totalSeconds: 6});
  assert.match(d.noise.enhancement.note, /only the first 3 s of 6 s/);
});
test('local processing never contacts Audo', {skip}, async t => {
  const {post, calls} = await serve(t, async () => wavResponse(cleaner));
  const d = await (await post('?denoise=1')).json();
  assert.equal(calls.length, 0); assert.equal(d.noise.enhancement.provider, 'local'); assert.match(d.noise.enhancement.method, /afwtdn/);
});
