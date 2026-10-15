import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer, pickAuth} from '../server.mjs';
import {sniff, probe, extractAudio, ffmpegPath} from '../server/media.mjs';
import {blockReason} from '../server/free-mode.mjs';
import {detectRD, normalizeRD, rdPoll} from '../server/realitydefender.mjs';
import {detect, tuning} from '../server/providers.mjs';

// Everything below that talks to a provider uses MOCKED responses (test data, not real provider output).
process.env.FREE_MODE = 'off';
rdPoll.intervalMs = 0; tuning.retryMs = 0;
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(24)]);
const PNG = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n'), Buffer.alloc(24)]);

test('content sniffing trusts bytes, not names', () => {
  assert.equal(sniff(WAV).type, 'audio/wav');
  assert.equal(sniff(PNG).type, 'image/png');
  assert.equal(sniff(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Buffer.alloc(16)])).type, 'image/jpeg');
  assert.equal(sniff(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(8)])).kinds.includes('video'), true);
  assert.equal(sniff(Buffer.from('this is plain text, not media at all')), null);
  assert.equal(sniff(Buffer.alloc(3)), null);
});

test('FREE_MODE blocks unconfirmed providers and can be confirmed per provider or turned off', () => {
  assert.match(blockReason('deepgram', {}), /FREE_MODE/);
  assert.match(blockReason('realitydefender', {FREE_MODE: '1'}), /FREE_MODE_CONFIRMED/);
  assert.equal(blockReason('deepgram', {FREE_MODE_CONFIRMED: 'gemini, Deepgram'}), null);
  assert.match(blockReason('sealedrose', {FREE_MODE_CONFIRMED: 'deepgram'}), /Sealed Rose/);
  assert.equal(blockReason('sealedrose', {FREE_MODE: 'off'}), null);
});

test('FREE_MODE stops a provider call before any network request', async () => {
  process.env.FREE_MODE = '1'; delete process.env.FREE_MODE_CONFIRMED;
  try {
    let calls = 0;
    const r = await detectRD({modality: 'voice', bytes: WAV, mime: 'audio/wav', keys: {realitydefender: 'k'}}, async () => { calls++; return Response.json({}); });
    assert.equal(r.code, 'FREE_MODE_BLOCKED'); assert.equal(calls, 0);
    const s = await detect({provider: 'sealedrose', modality: 'image', bytes: PNG, mime: 'image/png', keys: {sealedrose: 'k'}}, async () => { calls++; return Response.json({}); });
    assert.equal(s.code, 'FREE_MODE_BLOCKED'); assert.equal(calls, 0);
  } finally { process.env.FREE_MODE = 'off'; }
});

test('provider choice follows configuration, never failure', () => {
  assert.equal(pickAuth('voice', 'auto', {realitydefender: 'k', sealedrose: 'k'}, {}), 'realitydefender');
  assert.equal(pickAuth('image', 'auto', {realitydefender: 'k'}, {}), 'realitydefender');
  assert.equal(pickAuth('video', 'auto', {realitydefender: 'k', sealedrose: 'k'}, {}), 'sealedrose');
  assert.equal(pickAuth('voice', 'auto', {sealedrose: 'k'}, {}), 'sealedrose');
  assert.equal(pickAuth('voice', 'auto', {realitydefender: 'k', sealedrose: 'k'}, {AUTH_PROVIDER: 'sealedrose'}), 'sealedrose');
});

test('Reality Defender: presign, upload, poll and map statuses (mocked)', async () => {
  const seen = [];
  const make = finalStatus => async (url, opts = {}) => {
    seen.push([opts.method || 'GET', url.split('?')[0], opts.headers?.['X-API-KEY']]);
    if (url.endsWith('/api/files/aws-presigned')) {
      assert.match(JSON.parse(opts.body).fileName, /^voxa-[0-9a-f]{8}\.wav$/);
      return Response.json({requestId: 'req-1', mediaId: 'm-1', response: {signedUrl: 'https://s3.example/put'}});
    }
    if (url === 'https://s3.example/put') { assert.equal(opts.method, 'PUT'); assert.equal(opts.headers, undefined); return new Response('', {status: 200}); }
    const polls = seen.filter(x => x[1].includes('/api/media/users/')).length;
    if (polls === 1) return Response.json({requestId: 'req-1', overallStatus: 'ANALYZING', resultsSummary: {status: 'ANALYZING'}, models: []});
    return Response.json({requestId: 'req-1', overallStatus: finalStatus, resultsSummary: {status: finalStatus, metadata: {finalScore: 87.5}}, models: [{name: 'rd-voice-a', status: finalStatus === 'FAKE' ? 'FAKE' : 'AUTHENTIC', predictionNumber: 0.9}, {name: 'rd-na', status: 'NOT_APPLICABLE', code: 'not_applicable'}]});
  };
  const args = {modality: 'voice', bytes: WAV, mime: 'audio/wav', keys: {realitydefender: 'rd-secret'}};
  const fake = await detectRD(args, make('FAKE'));
  assert.equal(fake.code, 'AI_GENERATED'); assert.equal(fake.score, 0.875); assert.deepEqual(fake.models, [{name: 'rd-voice-a', status: 'MANIPULATED', score: 0.9}]);
  assert.ok(seen.every(x => x[2] === undefined || x[2] === 'rd-secret'));
  seen.length = 0;
  assert.equal((await detectRD(args, make('AUTHENTIC'))).code, 'NOT_FLAGGED');
  assert.equal(seen.filter(x => x[1].includes('/api/media/users/')).length, 2, 'polled until finished');
  assert.equal(normalizeRD({overallStatus: 'SUSPICIOUS', resultsSummary: {status: 'SUSPICIOUS'}, models: []}).code, 'SUSPICIOUS');
  assert.equal(normalizeRD({overallStatus: 'UNABLE_TO_EVALUATE', resultsSummary: {status: 'UNABLE_TO_EVALUATE'}}).code, 'UNABLE_TO_EVALUATE');
  assert.equal(normalizeRD({}).code, 'INVALID_RESPONSE');
});

test('Reality Defender: unsupported format, size, bad upload response and rejected key', async () => {
  const keys = {realitydefender: 'rd-secret'};
  assert.equal((await detectRD({modality: 'voice', bytes: WAV, mime: 'audio/webm', keys})).code, 'UNSUPPORTED_MEDIA');
  assert.equal((await detectRD({modality: 'voice', bytes: Buffer.alloc(21 * 1048576), mime: 'audio/wav', keys})).code, 'SIZE_LIMIT');
  assert.equal((await detectRD({modality: 'voice', bytes: WAV, mime: 'audio/wav', keys: {}})).code, 'NOT_CONFIGURED');
  assert.equal((await detectRD({modality: 'voice', bytes: WAV, mime: 'audio/wav', keys}, async () => Response.json({response: {}}))).code, 'INVALID_RESPONSE');
  const denied = await detectRD({modality: 'image', bytes: PNG, mime: 'image/png', keys}, async () => new Response('rd-secret', {status: 401}));
  assert.equal(denied.code, 'HTTP_401'); assert.ok(!JSON.stringify(denied).includes('rd-secret')); assert.match(denied.message, /key was rejected/);
  const put403 = await detectRD({modality: 'image', bytes: PNG, mime: 'image/png', keys}, async url => url.endsWith('aws-presigned') ? Response.json({requestId: 'r', response: {signedUrl: 'https://s3.example/x'}}) : new Response('', {status: 403}));
  assert.equal(put403.code, 'UPLOAD_FAILED');
  const insecure = await detectRD({modality: 'image', bytes: PNG, mime: 'image/png', keys}, async () => Response.json({requestId: 'r', response: {signedUrl: 'http://evil.example/x'}}));
  assert.equal(insecure.code, 'INVALID_RESPONSE');
});

test('rate limits and outages are retried once with the same idempotency key; auth errors are not', async () => {
  const keysSeen = []; let n = 0;
  const flaky = async (url, opts) => { keysSeen.push(opts.headers['Idempotency-Key']); return n++ === 0 ? new Response('', {status: 503}) : Response.json({aiGenerated: false, confidence: 0.9}); };
  const ok = await detect({provider: 'sealedrose', modality: 'image', bytes: PNG, mime: 'image/png', keys: {sealedrose: 'k'}}, flaky);
  assert.equal(ok.code, 'NOT_FLAGGED'); assert.equal(keysSeen.length, 2); assert.equal(keysSeen[0], keysSeen[1]);
  let calls = 0;
  const limited = await detect({provider: 'sealedrose', modality: 'image', bytes: PNG, mime: 'image/png', keys: {sealedrose: 'k'}}, async () => { calls++; return new Response('', {status: 429}); });
  assert.equal(calls, 2); assert.equal(limited.code, 'HTTP_429'); assert.match(limited.message, /rate limit/);
  calls = 0; const quota = await detect({provider: 'sealedrose', modality: 'image', bytes: PNG, mime: 'image/png', keys: {sealedrose: 'k'}}, async () => { calls++; return new Response('', {status: 402}); });
  assert.equal(calls, 1); assert.match(quota.message, /credits are exhausted/);
});

async function withServer(t, keys, fetcher) {
  const s = createServer(keys, fetcher); await new Promise(r => s.listen(0, '127.0.0.1', r)); t.after(() => s.close());
  const base = `http://127.0.0.1:${s.address().port}`;
  const post = (qs, body, mime) => fetch(`${base}/api/analyze?${qs}`, {method: 'POST', headers: {Origin: base, 'X-Voxa-Request': '1', 'Content-Type': mime}, body});
  return {base, post};
}

test('status reports configured, allowed and tool availability without leaking keys', async t => {
  const {base} = await withServer(t, {deepgram: 'dg-secret-key', realitydefender: 'rd-secret-key'}, async () => Response.json({}));
  const text = await (await fetch(base + '/api/status')).text(); const d = JSON.parse(text);
  assert.ok(!/secret-key/.test(text));
  assert.equal(d.providers.deepgram, true); assert.equal(d.providers.gemini, false);
  assert.equal(d.details.gemini.health, 'not-configured'); assert.equal(typeof d.tools.ffmpeg, 'boolean');
  assert.equal(d.authProvider.voice, 'realitydefender'); assert.equal(d.authProvider.video, 'sealedrose');
});

test('status probe uses free metadata calls only and reports invalid keys', async t => {
  const urls = [];
  const {base} = await withServer(t, {deepgram: 'k1', gemini: 'k2', realitydefender: 'k3', sealedrose: 'k4', luxand: 'k5'}, async url => { urls.push(url); return new Response('', {status: url.includes('deepgram') ? 401 : 200}); });
  const d = await (await fetch(base + '/api/status?probe=1')).json();
  assert.equal(d.details.deepgram.health, 'invalid-key'); assert.equal(d.details.gemini.health, 'ok'); assert.equal(d.details.realitydefender.health, 'ok');
  assert.equal(d.details.sealedrose.health, 'not-probed'); assert.match(d.details.sealedrose.healthNote, /credits/);
  assert.ok(urls.every(u => !/sealedrose|luxand|detect|listen$/.test(u)), 'no credit-consuming endpoint was called: ' + urls.join(' '));
});

test('uploads are validated by content before any provider is called', async t => {
  let providerCalls = 0;
  const {post} = await withServer(t, {sealedrose: 'k', realitydefender: 'k'}, async () => { providerCalls++; return Response.json({}); });
  let r = await post('modality=voice&provider=auto', Buffer.alloc(0), 'audio/wav'); assert.equal(r.status, 400); assert.equal((await r.json()).code, 'EMPTY_FILE');
  r = await post('modality=voice&provider=auto', Buffer.from('definitely not audio, just text'), 'audio/wav'); assert.equal(r.status, 415); assert.equal((await r.json()).code, 'UNRECOGNIZED_MEDIA');
  r = await post('modality=voice&provider=auto', PNG, 'audio/wav'); assert.equal(r.status, 415); assert.equal((await r.json()).code, 'TYPE_MISMATCH');
  r = await post('modality=image&provider=auto', WAV, 'image/png'); assert.equal(r.status, 415);
  r = await post('modality=voice&provider=auto', Buffer.alloc(21 * 1048576), 'audio/wav'); assert.equal(r.status, 413);
  r = await post('modality=other&provider=auto', WAV, 'audio/wav'); assert.equal(r.status, 400);
  r = await post('modality=voice&provider=auto', WAV, 'text/plain'); assert.equal(r.status, 415);
  const e = await r.json(); assert.equal(typeof e.error, 'string'); assert.equal(typeof e.code, 'string');
  assert.equal(providerCalls, 0);
});

// ---- real FFmpeg (free, local). Media is generated here and deleted afterwards. ----
const ffmpeg = await ffmpegPath();
test('FFmpeg: probes real video, extracts a 16 kHz mono WAV, rejects corrupt files', {skip: !ffmpeg && 'FFmpeg not available'}, async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'voxa-test-')); t.after(() => rmSync(dir, {recursive: true, force: true}));
  const mp4 = path.join(dir, 'clip.mp4');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', mp4]);
  const bytes = readFileSync(mp4);
  const info = await probe(bytes, 'video/mp4');
  assert.equal(info.readable, true); assert.equal(info.video.width, 320); assert.equal(info.video.height, 240); assert.ok(info.audio.sampleRate >= 8000); assert.ok(info.duration >= 1.5 && info.duration <= 3);
  const wav = await extractAudio(bytes, 'video/mp4');
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF'); assert.equal(wav.readUInt32LE(24), 16000); assert.equal(wav.readUInt16LE(22), 1);
  const silent = path.join(dir, 'silent.mp4');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=2', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', silent]);
  assert.equal((await probe(readFileSync(silent), 'video/mp4')).audio, null);
  const corrupt = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.from('garbage'.repeat(50))]);
  assert.equal((await probe(corrupt, 'video/mp4')).readable, false);

  // HTTP flow with real files; only the detector responses are mocked test data.
  const calls = [];
  const {post} = await withServer(t, {sealedrose: 'k', deepgram: 'k'}, async (url, opts) => { calls.push([url, opts.headers?.['Content-Type'], opts.body?.length]); return url.includes('deepgram') ? Response.json({results: {channels: [{alternatives: [{transcript: 'mock transcript words here'}]}]}}) : Response.json({aiGenerated: false, confidence: 0.8}); });
  let r = await post('modality=video&provider=auto&extract=1&textProvider=deepgram&soundtrack=1', bytes, 'video/mp4'); let d = await r.json();
  assert.equal(r.status, 200); assert.equal(d.authenticity.code, 'NOT_FLAGGED'); assert.equal(d.audioAuthenticity.code, 'NOT_FLAGGED'); assert.equal(d.extraction.text, 'mock transcript words here');
  assert.equal(d.media.video.width, 320); assert.ok(d.media.audio);
  const dg = calls.find(c => c[0].includes('deepgram')); assert.equal(dg[1], 'audio/wav', 'speech service received extracted audio, not the video');
  const sr = calls.filter(c => c[0].includes('sealedrose')).map(c => c[0].split('/').pop()); assert.deepEqual(sr.sort(), ['audio', 'video']);
  r = await post('modality=video&provider=auto&extract=1&textProvider=deepgram', readFileSync(silent), 'video/mp4'); d = await r.json();
  assert.equal(d.extraction.code, 'NO_AUDIO');
  r = await post('modality=video&provider=auto', corrupt, 'video/mp4'); assert.equal(r.status, 422); assert.equal((await r.json()).code, 'UNREADABLE_MEDIA');
  r = await post('modality=video&provider=auto', Buffer.from(WAV), 'video/mp4'); assert.equal(r.status, 415);
});

test('the analyze route accepts only the configured extension origin', async t => {
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  const {base} = await withServer(t, {sealedrose: 'k'}, async () => Response.json({aiGenerated: false, confidence: 0.9}));
  const call = origin => fetch(`${base}/api/analyze?modality=image&provider=sealedrose`, {method: 'POST', headers: {Origin: origin, 'X-Voxa-Request': '1', 'Content-Type': 'image/png'}, body: PNG});
  try {
    delete process.env.VOXA_EXTENSION_ID;
    assert.equal((await call('chrome-extension://' + id)).status, 403, 'blocked until an ID is configured');
    process.env.VOXA_EXTENSION_ID = 'not-a-valid-id';
    assert.equal((await call('chrome-extension://not-a-valid-id')).status, 403, 'malformed IDs are ignored');
    process.env.VOXA_EXTENSION_ID = id;
    assert.equal((await call('chrome-extension://' + id)).status, 200);
    assert.equal((await call('chrome-extension://' + id.replace(/a/g, 'b'))).status, 403, 'other extensions stay blocked');
    assert.equal((await call('https://evil.example')).status, 403);
    const d = await (await fetch(base + '/api/status')).json(); assert.equal(d.tools.extension, true);
  } finally { delete process.env.VOXA_EXTENSION_ID; }
});
