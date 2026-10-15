// Real provider calls THROUGH a Cloudflare tunnel (HTTPS), one small request each. Prints status/codes only.
// Usage: node providers-tunnel-check.mjs https://<tunnel>.trycloudflare.com
import {buildFixtures, toWav} from '../noise-fixtures.mjs';
import {wavToInt16} from '../../server/noise.mjs';
import {WebSocket} from 'ws';
import {deflateSync} from 'node:zlib';

const B = process.argv[2];
const H = {Origin: B, 'X-Voxa-Request': '1', 'X-Voxa-Provider-Consent': '1'};
const fx = await buildFixtures();
const pcm = wavToInt16(fx.clean_speech.wav).samples;
const speech8s = toWav(Float32Array.from(pcm.subarray(0, 16000 * 8), v => v / 32768)); // 8 s of real (synthetic TTS) speech
const T = new Uint32Array(256).map((_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 3) & 255; raw[o + 1] = (y * 2) & 255; raw[o + 2] = 150; }
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(Buffer.concat([Buffer.from(t), d])), 8 + d.length); return b; };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const line = (name, ok, detail) => console.log(`${ok ? '✓' : '✗'} ${name.padEnd(44)} ${detail}`);
const post = async (path, body, type) => { const t0 = Date.now(); const r = await fetch(B + path, {method: 'POST', headers: {...H, 'Content-Type': type}, body}); return {status: r.status, data: await r.json().catch(() => ({})), ms: Date.now() - t0}; };

// 1) voice: Reality Defender (auto) + Deepgram transcript in one request
let r = await post('/api/analyze?modality=voice&provider=auto&extract=1&textProvider=deepgram', speech8s, 'audio/wav');
line('Voice authenticity (Reality Defender)', r.data.authenticity?.status === 'ok', `HTTP ${r.status} · ${r.data.authenticity?.provider} ${r.data.authenticity?.status}/${r.data.authenticity?.code} · ${r.ms} ms`);
line('Transcript (Deepgram)', r.data.extraction?.status === 'ok', `${r.data.extraction?.provider} ${r.data.extraction?.status} · "${String(r.data.extraction?.text || r.data.extraction?.message || '').slice(0, 60)}…"`);
const transcript = r.data.extraction?.text || 'Hello, this is the bank. Please share the OTP right now.';
// 2) Gemini transcription
r = await post('/api/transcribe?modality=voice&textProvider=gemini', speech8s, 'audio/wav');
line('Transcription (Gemini)', r.data.extraction?.status === 'ok', `HTTP ${r.status} · ${r.data.extraction?.status} · "${String(r.data.extraction?.text || r.data.extraction?.message || r.data.error || '').slice(0, 60)}…" · ${r.ms} ms`);
// 3) Gemini intelligence on the transcript
r = await post('/api/intelligence', JSON.stringify({text: transcript}), 'application/json');
line('Intelligence (Gemini)', r.data.intelligence?.status === 'ok', `HTTP ${r.status} · ${r.data.intelligence?.status} · language: ${r.data.intelligence?.data?.language || r.data.intelligence?.message || r.data.error || '-'}`);
// 4) image: Reality Defender + Luxand liveness (synthetic image, so Luxand can only answer "cannot assess")
r = await post('/api/analyze?modality=image&provider=auto&extract=0&textProvider=gemini&liveness=1', png(256, 256), 'image/png');
line('Image authenticity (Reality Defender)', r.data.authenticity?.status === 'ok', `HTTP ${r.status} · ${r.data.authenticity?.provider} ${r.data.authenticity?.status}/${r.data.authenticity?.code} · ${r.ms} ms`);
line('Face liveness (Luxand, synthetic non-face)', Boolean(r.data.context?.provider === 'luxand'), `${r.data.context?.status || '-'}: ${String(r.data.context?.message || '').slice(0, 60)}`);
// 5) noise analysis + local denoise (no provider)
r = await post('/api/noise?denoise=1', toWav(Float32Array.from(wavToInt16(fx.speech_white_10dB.wav).samples.subarray(0, 16000 * 8), v => v / 32768)), 'audio/wav');
line('Noise analysis + local noise reduction', r.status === 200 && r.data.noise?.enhancement?.applied, `HTTP ${r.status} · speech ${r.data.noise?.speech?.detected} · noise ${r.data.noise?.noise?.level} · floor ${r.data.noise?.enhancement?.measured?.floorChangeDb} dB · ${r.ms} ms`);
// 6) live: Deepgram streaming over wss through the tunnel
await new Promise(res => {
  const ws = new WebSocket(B.replace('https://', 'wss://') + '/api/live', {headers: {Origin: B}});
  const timer = setTimeout(() => { line('Live transcription socket (Deepgram)', false, 'no "ready" within 20 s'); ws.terminate(); res(); }, 20000);
  ws.on('message', m => { const d = JSON.parse(m.toString()); if (d.type === 'ready') { clearTimeout(timer); line('Live transcription socket (Deepgram)', true, 'connected over wss; Deepgram stream ready'); ws.close(); res(); } else if (d.type === 'error') { clearTimeout(timer); line('Live transcription socket (Deepgram)', false, d.message); ws.close(); res(); } });
  ws.on('unexpected-response', (q, resp) => { clearTimeout(timer); line('Live transcription socket (Deepgram)', false, 'HTTP ' + resp.statusCode); res(); });
  ws.on('error', e => { clearTimeout(timer); line('Live transcription socket (Deepgram)', false, e.message); res(); });
});
