import {execFile} from 'node:child_process';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

// Identify media by its bytes, never by file name or declared type alone.
export function sniff(b) {
  if (!b || b.length < 12) return null;
  const s4 = b.subarray(0, 4).toString('latin1'), s8 = b.subarray(4, 8).toString('latin1'), s12 = b.subarray(8, 12).toString('latin1');
  if (s4 === 'RIFF' && s12 === 'WAVE') return {type: 'audio/wav', kinds: ['audio']};
  if (s4 === 'RIFF' && s12 === 'WEBP') return {type: 'image/webp', kinds: ['image']};
  if (s4 === 'fLaC') return {type: 'audio/flac', kinds: ['audio']};
  if (s4 === 'OggS') return {type: 'audio/ogg', kinds: ['audio']};
  if (s4.startsWith('ID3') || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) return {type: 'audio/mpeg', kinds: ['audio']};
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return {type: 'image/jpeg', kinds: ['image']};
  if (b[0] === 0x89 && s4.slice(1) === 'PNG') return {type: 'image/png', kinds: ['image']};
  if (s8 === 'ftyp') return {type: s12 === 'qt  ' ? 'video/quicktime' : 'video/mp4', kinds: ['video', 'audio']};
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return {type: 'video/webm', kinds: ['video', 'audio']};
  return null;
}
export const KIND = {voice: 'audio', image: 'image', video: 'video'};
const EXT = {'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/flac': 'flac', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov'};

export const run = (bin, args, timeout = 60000) => new Promise((resolve, reject) => execFile(bin, args, {timeout, maxBuffer: 8 * 1048576, windowsHide: true}, (err, stdout, stderr) => err && !stderr ? reject(err) : resolve({err, stdout, stderr})));
let cached;
export async function ffmpegPath() {
  if (process.env.VOXA_NO_FFMPEG === '1') return null;
  if (cached !== undefined) return cached;
  const candidates = [process.env.FFMPEG_PATH];
  try { candidates.push((await import('ffmpeg-static')).default); } catch {}
  candidates.push('ffmpeg');
  for (const c of candidates) { if (!c) continue; try { await run(c, ['-version'], 10000); return (cached = c); } catch {} }
  return (cached = null);
}
export const resetFfmpegCache = () => { cached = undefined; };

// Raw media only touches a private temp directory for the duration of one call.
export async function withTemp(bytes, mime, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'voxa-'));
  try {
    const file = path.join(dir, 'in.' + (EXT[mime] || 'bin'));
    await writeFile(file, bytes);
    return await fn(file, dir);
  } finally { await rm(dir, {recursive: true, force: true}); }
}
export async function probe(bytes, mime) {
  const bin = await ffmpegPath();
  if (!bin) return {available: false};
  return withTemp(bytes, mime, async file => {
    const {stderr} = await run(bin, ['-hide_banner', '-i', file], 30000);
    const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
    const audio = /Stream #[^\n]*Audio:\s*([\w]+)[^\n]*?,\s*(\d+) Hz,\s*([^,\n]+)/.exec(stderr);
    const video = /Stream #[^\n]*Video:\s*([\w]+)[^\n]*?,\s*(\d{2,5})x(\d{2,5})/.exec(stderr);
    if (!audio && !video) return {available: true, readable: false};
    return {available: true, readable: true,
      duration: dur ? +(+dur[1] * 3600 + +dur[2] * 60 + +dur[3]).toFixed(2) : null,
      audio: audio ? {codec: audio[1], sampleRate: +audio[2], channels: /mono/i.test(audio[3]) ? 1 : /stereo/i.test(audio[3]) ? 2 : parseInt(audio[3], 10) || audio[3].trim()} : null,
      video: video ? {codec: video[1], width: +video[2], height: +video[3]} : null};
  });
}
// 16 kHz mono PCM WAV: what speech services handle reliably, whatever the source codec.
export async function extractAudio(bytes, mime) {
  const bin = await ffmpegPath();
  if (!bin) return null;
  return withTemp(bytes, mime, async (file, dir) => {
    const out = path.join(dir, 'out.wav');
    const {err, stderr} = await run(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vn', '-t', '900', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out], 90000);
    if (err) throw new Error(stderr.slice(0, 200) || 'Audio extraction failed.');
    return readFile(out);
  });
}
