// VOXA noise analysis + optional enhancement. FFmpeg does the decoding and (when asked) the denoising;
// server/noise-core.mjs does the measuring. Raw audio only touches a private temp directory that is always removed.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {ffmpegPath, run, withTemp} from './media.mjs';
import {SR, MAX_SECONDS, analyzeSignal, levelStats, buildReport, round} from './noise-core.mjs';

export class NoiseError extends Error { constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; } }

// Parse a PCM WAV written by FFmpeg (walks the chunks; does not assume a 44-byte header).
export function wavToInt16(buf) {
  if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF') throw new NoiseError('DECODE_FAILED', 'The audio could not be decoded.');
  let o = 12, rate = 0, bits = 0, ch = 0;
  while (o + 8 <= buf.length) {
    const id = buf.toString('latin1', o, o + 4), size = buf.readUInt32LE(o + 4), body = o + 8;
    if (id === 'fmt ') { ch = buf.readUInt16LE(body + 2); rate = buf.readUInt32LE(body + 4); bits = buf.readUInt16LE(body + 14); }
    if (id === 'data') {
      if (bits !== 16) throw new NoiseError('DECODE_FAILED', 'Unexpected decoded format.');
      const end = Math.min(buf.length, body + size), len = (end - body) >> 1, out = new Int16Array(len);
      for (let i = 0; i < len; i++) out[i] = buf.readInt16LE(body + 2 * i);
      return {samples: out, rate, channels: ch};
    }
    o = body + size + (size & 1);
  }
  throw new NoiseError('DECODE_FAILED', 'The decoded audio had no samples.');
}
const toFloat = s16 => { const f = new Float32Array(s16.length); for (let i = 0; i < s16.length; i++) f[i] = s16[i] / 32768; return f; };

async function decode(bin, file, out, rate) {
  // First channel only, resampled; -t caps work on long inputs (the caller rejects anything over the limit).
  const af = rate ? `pan=mono|c0=c0,aresample=${rate}` : 'pan=mono|c0=c0';
  const {err, stderr} = await run(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vn', '-t', String(MAX_SECONDS + 5), '-af', af, '-c:a', 'pcm_s16le', out], 120000);
  if (err) throw new NoiseError('DECODE_FAILED', (stderr || '').slice(0, 160) || 'The audio could not be decoded.');
  return wavToInt16(await readFile(out));
}

// Filter chain built only from numbers we computed, never from user text.
export function enhancementChain(report) {
  const n = report.noise, filters = ['pan=mono|c0=c0', `aresample=${SR}`];
  const hum = n.indicators.find(i => i.id === 'mains_hum');
  if (hum) for (const f of [hum.hz, hum.hz * 2, hum.hz * 3]) filters.push(`bandreject=f=${f}:width_type=h:w=6`);
  if (n.indicators.some(i => i.id === 'lf_rumble')) filters.push('highpass=f=80');
  // Adaptive wavelet denoiser. Chosen by measurement on speech + white/pink noise: FFmpeg's afftdn with noise
  // tracking left white noise untouched (-0.2 dB), and with a fixed floor it barely moved pink noise (-2 dB).
  filters.push('afwtdn=levels=10:adaptive=1:percent=85');
  return filters;
}

const measure = sig => ({speechDetected: sig.speech.detected, floorDbfs: sig.floorDb, snrDb: sig.snrDb, activeLevelDbfs: sig.activeDb, humProminenceDb: sig.spectrumMetrics?.humPromDb ?? null, hissHighVsMidDb: sig.spectrumMetrics?.hissRatioDb ?? null});
const diff = (a, b) => (a === null || b === null ? null : round(b - a));

export async function analyzeNoise({bytes, mime, info, denoise = false}) {
  const bin = await ffmpegPath();
  if (!bin) throw new NoiseError('FFMPEG_MISSING', 'Noise analysis needs FFmpeg, which is not available on this server. No result was produced.', 503);
  return withTemp(bytes, mime, async (file, dir) => {
    const dec = await decode(bin, file, path.join(dir, 'a16.wav'), SR);
    const durationSec = dec.samples.length / SR;
    if (durationSec < 1) throw new NoiseError('TOO_SHORT', 'The audio is shorter than 1 second.');
    if (durationSec > MAX_SECONDS) throw new NoiseError('TOO_LONG', `Noise analysis accepts audio up to ${MAX_SECONDS / 60} minutes.`);
    const rate = info?.audio?.sampleRate || SR;
    const nat = await decode(bin, file, path.join(dir, 'native.wav'), Math.min(rate, 48000));
    const x = toFloat(dec.samples), sig = analyzeSignal(x);
    const levels = levelStats(nat.samples);
    const fileInfo = {durationSec: round(durationSec, 2), sampleRate: info?.audio?.sampleRate ?? null, channels: info?.audio?.channels ?? null, codec: info?.audio?.codec ?? null, analyzedChannel: 'first', analysisRateHz: SR, sizeBytes: bytes.length};
    let report = buildReport({sig, levels, file: fileInfo});
    if (!denoise) return {report, enhanced: null};
    // Enhancement writes a separate file; the original is never modified.
    const filters = enhancementChain(report), outFile = path.join(dir, 'enhanced.wav');
    const {err, stderr} = await run(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vn', '-t', String(MAX_SECONDS + 5), '-af', filters.join(','), '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', outFile], 120000);
    if (err) {
      report = buildReport({sig, levels, file: fileInfo, enhancement: {requested: true, applied: false, reason: (stderr || 'Enhancement failed.').slice(0, 160), method: null}});
      return {report, enhanced: null};
    }
    const encoded = await readFile(outFile), enh = wavToInt16(encoded), after = analyzeSignal(toFloat(enh.samples));
    const before = measure(sig), aft = measure(after);
    const measured = {floorChangeDb: diff(before.floorDbfs, aft.floorDbfs), snrChangeDb: diff(before.snrDb, aft.snrDb), speechLevelChangeDb: diff(before.activeLevelDbfs, aft.activeLevelDbfs), humChangeDb: diff(before.humProminenceDb, aft.humProminenceDb)};
    const improved = (measured.floorChangeDb !== null && measured.floorChangeDb <= -3) || (measured.snrChangeDb !== null && measured.snrChangeDb >= 3) || (measured.humChangeDb !== null && measured.humChangeDb <= -6);
    const speechKept = before.speechDetected !== 'yes' || aft.speechDetected === 'yes';
    const note = (improved ? 'Measured: the quiet-frame level dropped and/or the SNR estimate rose. Whether it sounds better is a listening judgement VOXA does not score. Denoising can also smear speech; analyse authenticity on the original.'
      : 'No measurable improvement: the quiet-frame level, SNR estimate and hum prominence did not change enough (3 dB, 3 dB, 6 dB). Compare by ear before relying on the enhanced copy.')
      + (speechKept ? '' : ' Warning: speech was detected in the original but not in the enhanced copy, so the enhancement may have damaged it.')
      + (measured.speechLevelChangeDb !== null && measured.speechLevelChangeDb <= -3 ? ` Speech level fell ${Math.abs(measured.speechLevelChangeDb)} dB, a sign of speech attenuation.` : '');
    report = buildReport({sig, levels, file: fileInfo, enhancement: {requested: true, applied: true, method: 'FFmpeg afwtdn (adaptive wavelet denoiser)' + (filters.some(f => f.startsWith('bandreject')) ? ' with mains-hum notch filters' : ''), filters, output: {format: 'WAV, 16-bit PCM', sampleRate: SR, channels: 1, sizeBytes: encoded.length, note: 'Mono first channel at 16 kHz, so before/after are comparable.'}, before, after: aft, measured, measuredImprovement: improved, speechPreserved: speechKept, note}});
    return {report, enhanced: {mime: 'audio/wav', sampleRate: SR, channels: 1, sizeBytes: encoded.length, bytes: encoded}};
  });
}
