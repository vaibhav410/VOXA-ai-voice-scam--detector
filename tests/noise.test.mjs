import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createServer} from '../server.mjs';
import {resetFfmpegCache, ffmpegPath} from '../server/media.mjs';
import {analyzeSignal, buildReport, levelStats, SR} from '../server/noise-core.mjs';
import {analyzeNoise} from '../server/noise.mjs';
import {probe} from '../server/media.mjs';
import {toWav, whiteNoise, pinkishNoise, sine, mix, scale, clipAt, ttsAvailable, ttsWav, loadSpeech16k, addNoiseAtSnr, SPEECH_TEXT} from '../tools/noise-fixtures.mjs';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';

// Private temp dir for this test process, so temp-file cleanup checks are exact even when files run in parallel.
process.env.TEMP = process.env.TMP = process.env.TMPDIR = mkdtempSync(path.join(tmpdir(), 'voxa-test-'));

const HAVE_FFMPEG = Boolean(await ffmpegPath());
const skipFF = HAVE_FFMPEG ? false : 'FFmpeg is not available';
const report = x => buildReport({sig: analyzeSignal(x), levels: levelStats(Int16Array.from(x, v => Math.round(v * 32767))), file: {durationSec: x.length / SR}});

// Real speech once (Windows built-in voice); other platforms skip the speech tests.
let speech = null;
if (ttsAvailable() && HAVE_FFMPEG) {
  const dir = mkdtempSync(path.join(tmpdir(), 'voxa-tt-'));
  try { ttsWav(path.join(dir, 's.wav'), SPEECH_TEXT); speech = await loadSpeech16k(path.join(dir, 's.wav')); } catch { speech = null; } finally { rmSync(dir, {recursive: true, force: true}); }
}
const skipSpeech = speech ? false : 'Needs Windows speech synthesis and FFmpeg';

// ---------------- measurements (pure core, synthetic signals) ----------------
test('silence: no speech, no noise level, no fabricated numbers', () => {
  const r = report(new Float32Array(SR * 6));
  assert.equal(r.speech.detected, 'no');
  assert.equal(r.noise.level, 'unavailable');
  assert.equal(r.noise.snrDb, null);
  assert.equal(r.noise.floorDbfs, null);
  assert.equal(r.quality.rating, 'unavailable');
  assert.equal(r.quality.suitability, 'insufficient');
  assert.equal(r.recommendation.action, 'insufficient');
});
test('noise only: high level, hiss-like indicator, no speech and no SNR', () => {
  const r = report(whiteNoise(SR * 8, 0.05));
  assert.equal(r.speech.detected, 'no');
  assert.equal(r.noise.level, 'high');
  assert.equal(r.noise.basis, 'absolute-floor');
  assert.equal(r.noise.snrDb, null, 'SNR must not be reported without speech');
  assert.ok(r.noise.indicators.some(i => i.id === 'hf_noise'));
  assert.equal(r.quality.suitability, 'not_suitable');
  assert.equal(r.recommendation.action, 'record_again');
});
test('low-frequency rumble is identified without naming a source', () => {
  const r = report(pinkishNoise(SR * 8, 0.05));
  const ind = r.noise.indicators.find(i => i.id === 'lf_rumble');
  assert.ok(ind);
  assert.ok(!/traffic|fan|engine|car/i.test(JSON.stringify(r.noise.indicators)), 'sources must not be named');
});
test('mains hum is found at the right frequency', () => {
  for (const hz of [50, 60]) {
    const r = report(mix(sine(SR * 8, hz, 0.02), sine(SR * 8, hz * 2, 0.01), whiteNoise(SR * 8, 0.004, 6)));
    const h = r.noise.indicators.find(i => i.id === 'mains_hum');
    assert.ok(h, `hum ${hz}`);
    assert.equal(h.hz, hz);
  }
});
test('clipping is measured and an unclipped signal is not flagged', () => {
  const clipped = report(clipAt(scale(whiteNoise(SR * 6, 0.4), 6), 1));
  assert.equal(clipped.clipping.detected, true);
  assert.ok(clipped.clipping.runs >= 5);
  const clean = report(sine(SR * 6, 300, 0.3));
  assert.equal(clean.clipping.detected, false);
  assert.equal(clean.clipping.samples, 0);
});
test('steady tones and on/off beeps are not mistaken for speech', () => {
  assert.notEqual(report(sine(SR * 8, 440, 0.3)).speech.detected, 'yes');
  const beep = new Float32Array(SR * 8), t = sine(SR * 8, 440, 0.3);
  for (let i = 0; i < beep.length; i++) if (Math.floor(i / (SR * 0.4)) % 2 === 0) beep[i] = t[i];
  assert.notEqual(report(mix(beep, whiteNoise(SR * 8, 0.003, 3))).speech.detected, 'yes');
});
test('report text is honest: limitations present, Silero is not claimed, every result has an explanation', () => {
  const r = report(whiteNoise(SR * 8, 0.05));
  assert.ok(r.limitations.length >= 4);
  assert.match(JSON.stringify(r), /not Silero VAD/);
  assert.ok(r.evidence.length >= 6 && r.evidence.every(e => e.item && e.value !== undefined && e.how));
  assert.equal(r.enhancement.applied, false);
});

// ---------------- real speech ----------------
test('clean speech is detected, low noise, suitable', {skip: skipSpeech}, () => {
  const r = report(speech);
  assert.equal(r.speech.detected, 'yes');
  assert.equal(r.noise.level, 'low');
  assert.equal(r.quality.suitability, 'suitable');
  assert.equal(r.recommendation.action, 'keep_original');
  assert.equal(r.noise.snrDb, null, 'pauses are digitally silent, so no SNR is claimed');
});
test('speech with background noise: detected, SNR within 3 dB of the true value, level follows SNR', {skip: skipSpeech}, () => {
  const expected = {30: 'low', 20: 'medium', 10: 'high', 5: 'high', 0: 'high'};
  for (const snr of [30, 20, 10, 5, 0]) {
    const r = report(addNoiseAtSnr(speech, snr).audio);
    assert.equal(r.speech.detected, 'yes', `speech at ${snr} dB`);
    assert.ok(Math.abs(r.noise.snrDb - snr) <= 3, `SNR estimate ${r.noise.snrDb} vs true ${snr}`);
    assert.equal(r.noise.level, expected[snr], `level at ${snr} dB`);
    assert.equal(r.noise.basis, 'snr');
  }
});
test('noisy speech is flagged for noise reduction, not rejected as clean', {skip: skipSpeech}, () => {
  const r = report(addNoiseAtSnr(speech, 10).audio);
  assert.equal(r.recommendation.action, 'apply_noise_reduction');
  assert.notEqual(r.quality.suitability, 'suitable');
});
test('clipped speech is rated poor and told to record again', {skip: skipSpeech}, () => {
  const r = report(clipAt(scale(speech, 12), 1));
  assert.equal(r.clipping.detected, true);
  assert.equal(r.quality.rating, 'poor');
  assert.equal(r.recommendation.action, 'record_again');
});

// ---------------- FFmpeg pipeline: enhancement keeps the original and reports measured change ----------------
test('enhancement leaves the original bytes untouched and reports measured before/after', {skip: skipSpeech || skipFF}, async () => {
  const wav = toWav(addNoiseAtSnr(speech, 10).audio), copy = Buffer.from(wav);
  const info = await probe(wav, 'audio/wav');
  const off = await analyzeNoise({bytes: wav, mime: 'audio/wav', info, denoise: false});
  assert.equal(off.enhanced, null);
  assert.equal(off.report.enhancement.applied, false);
  const on = await analyzeNoise({bytes: wav, mime: 'audio/wav', info, denoise: true});
  assert.ok(wav.equals(copy), 'original bytes must not change');
  assert.equal(on.report.enhancement.applied, true);
  assert.match(on.report.enhancement.method, /afwtdn/);
  assert.equal(on.enhanced.bytes.subarray(0, 4).toString('latin1'), 'RIFF');
  const m = on.report.enhancement.measured;
  assert.ok(m.floorChangeDb <= -10, `quiet level should drop by 10 dB or more, got ${m.floorChangeDb}`);
  assert.ok(m.snrChangeDb >= 10);
  assert.ok(m.speechLevelChangeDb > -3, 'speech must not be attenuated by 3 dB or more at 10 dB SNR');
  assert.equal(on.report.enhancement.measuredImprovement, true);
  assert.equal(on.report.enhancement.speechPreserved, true);
  assert.ok(on.report.enhancement.before.floorDbfs !== null && on.report.enhancement.after.floorDbfs !== null);
});
test('enhancement does not claim an improvement on already clean speech', {skip: skipSpeech || skipFF}, async () => {
  const wav = toWav(speech), info = await probe(wav, 'audio/wav');
  const r = await analyzeNoise({bytes: wav, mime: 'audio/wav', info, denoise: true});
  assert.equal(r.report.enhancement.measuredImprovement, false);
  assert.match(r.report.enhancement.note, /No measurable improvement/);
});
test('hum is notch-filtered and the measured hum prominence falls', {skip: skipFF}, async () => {
  const wav = toWav(mix(sine(SR * 8, 60, 0.02), sine(SR * 8, 120, 0.01), whiteNoise(SR * 8, 0.004, 6))), info = await probe(wav, 'audio/wav');
  const r = await analyzeNoise({bytes: wav, mime: 'audio/wav', info, denoise: true});
  assert.ok(r.report.enhancement.filters.some(f => f.startsWith('bandreject=f=60')));
  assert.ok(r.report.enhancement.measured.humChangeDb <= -20);
});

// ---------------- HTTP boundary ----------------
const noiseTmp = () => readdirSync(tmpdir()).filter(n => /^voxa-[A-Za-z0-9]{6}$/.test(n)).length;
async function withServer(t, fn) {
  const s = createServer({});
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  t.after(() => s.close());
  const base = `http://127.0.0.1:${s.address().port}`;
  const post = (qs, body, type = 'audio/wav', extra = {}) => fetch(base + '/api/noise' + qs, {method: 'POST', headers: {Origin: base, 'X-Voxa-Request': '1', 'Content-Type': type, ...extra}, body});
  return fn({base, post, port: s.address().port});
}
const secs = (n, rms = 0.05) => toWav(whiteNoise(SR * n, rms));

test('noise endpoint: success returns a full report; enhancement returns a playable WAV; temp files are removed', {skip: skipFF}, async t => {
  await withServer(t, async ({post}) => {
    const before = noiseTmp();
    const a = await post('', secs(5)), d = await a.json();
    assert.equal(a.status, 200);
    assert.equal(d.enhancedAudio, null);
    assert.equal(d.noise.speech.detected, 'no');
    assert.equal(d.noise.file.sampleRate, SR);
    assert.equal(d.noise.file.channels, 1);
    assert.ok(Math.abs(d.noise.file.durationSec - 5) < 0.1);
    const b = await post('?denoise=1', secs(5)), e = await b.json();
    assert.equal(b.status, 200);
    assert.equal(e.enhancedAudio.mime, 'audio/wav');
    assert.equal(Buffer.from(e.enhancedAudio.base64, 'base64').subarray(0, 4).toString('latin1'), 'RIFF');
    assert.equal(noiseTmp(), before, 'no temp directories may remain');
  });
});
test('noise endpoint: rejects requests that are not from this app', {skip: skipFF}, async t => {
  await withServer(t, async ({base}) => {
    const no = await fetch(base + '/api/noise', {method: 'POST', headers: {'Content-Type': 'audio/wav'}, body: secs(2)});
    assert.equal(no.status, 403);
    const wrongOrigin = await fetch(base + '/api/noise', {method: 'POST', headers: {Origin: 'https://evil.example', 'X-Voxa-Request': '1', 'Content-Type': 'audio/wav'}, body: secs(2)});
    assert.equal(wrongOrigin.status, 403);
    const badHost = await new Promise(res => { const q = http.request({host: '127.0.0.1', port: new URL(base).port, path: '/api/noise', method: 'POST', headers: {Host: 'attacker.example', 'Content-Type': 'audio/wav'}}, r => res(r.statusCode)); q.end(secs(2)); });
    assert.equal(badHost, 403, 'non-local Host must be refused');
  });
});
test('noise endpoint: bad input returns specific errors and cleans up', {skip: skipFF}, async t => {
  await withServer(t, async ({post}) => {
    const before = noiseTmp();
    const code = async res => (await res.json()).code;
    let r = await post('', secs(3), 'image/png'); assert.equal(r.status, 415); assert.equal(await code(r), 'UNSUPPORTED_TYPE');
    r = await post('', Buffer.alloc(0)); assert.equal(r.status, 400); assert.equal(await code(r), 'EMPTY_FILE');
    r = await post('', Buffer.from('this is plain text, not audio at all')); assert.equal(r.status, 415); assert.equal(await code(r), 'UNRECOGNIZED_MEDIA');
    const png = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n'), Buffer.alloc(40)]);
    r = await post('', png); assert.equal(r.status, 415); assert.equal(await code(r), 'TYPE_MISMATCH');
    const corrupt = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(200, 7)]);
    r = await post('', corrupt); assert.equal(r.status, 422); assert.equal(await code(r), 'UNREADABLE_MEDIA');
    r = await post('', toWav(whiteNoise(SR / 2, 0.05))); assert.equal(r.status, 422); assert.equal(await code(r), 'TOO_SHORT');
    r = await post('', toWav(new Float32Array(SR * 305))); assert.equal(r.status, 422); assert.equal(await code(r), 'TOO_LONG');
    r = await post('', Buffer.alloc(21 * 1048576, 1)); assert.equal(r.status, 413); assert.equal(await code(r), 'TOO_LARGE');
    assert.equal(noiseTmp(), before, 'failures must not leave temp files behind');
  });
});
test('noise endpoint: without FFmpeg it refuses and produces no result', async t => {
  const prev = process.env.VOXA_NO_FFMPEG;
  process.env.VOXA_NO_FFMPEG = '1'; resetFfmpegCache();
  t.after(() => { if (prev === undefined) delete process.env.VOXA_NO_FFMPEG; else process.env.VOXA_NO_FFMPEG = prev; resetFfmpegCache(); });
  await withServer(t, async ({post}) => {
    const r = await post('', secs(3)), d = await r.json();
    assert.equal(r.status, 503);
    assert.equal(d.code, 'FFMPEG_MISSING');
    assert.equal(d.noise, undefined);
  });
});
test('noise endpoint: a second request while one is running gets 429', {skip: skipFF}, async t => {
  await withServer(t, async ({post, port, base}) => {
    const body = secs(4);
    // First request: send headers and half the body, then hold the connection open so the server is "busy".
    const first = http.request({host: '127.0.0.1', port, path: '/api/noise', method: 'POST', headers: {Origin: base, 'X-Voxa-Request': '1', 'Content-Type': 'audio/wav', 'Content-Length': body.length}});
    const done = new Promise(res => first.on('response', r => { r.resume(); r.on('end', () => res(r.statusCode)); }));
    first.write(body.subarray(0, body.length / 2));
    await new Promise(r => setTimeout(r, 150));
    const second = await post('', secs(2));
    assert.equal(second.status, 429);
    first.end(body.subarray(body.length / 2));
    assert.equal(await done, 200);
    const after = await post('', secs(2));
    assert.equal(after.status, 200, 'the lock must be released afterwards');
  });
});
