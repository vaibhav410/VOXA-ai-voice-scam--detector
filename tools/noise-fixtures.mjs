// Test audio for the noise analyzer. Real speech comes from the Windows built-in voices (System.Speech);
// noise, hum, clipping and tones are synthesised in JS so the true SNR of every mix is known exactly.
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ffmpegPath, run} from '../server/media.mjs';
import {wavToInt16} from '../server/noise.mjs';
import {SR, analyzeSignal} from '../server/noise-core.mjs';

export const SPEECH_TEXT = 'Hello, this is a test of the noise analysis system. Please read the account number slowly and clearly. ' +
  'The weather today is mild, and the meeting will start at ten in the morning. Thank you for calling, and have a good day. ' +
  'Next, we will check that every word can be understood, even when the room is a little busy.';

export const ttsAvailable = () => process.platform === 'win32';
export function ttsWav(file, text = SPEECH_TEXT, voice = 'Microsoft Zira Desktop') {
  const ps = `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('${voice}'); $s.SetOutputToWaveFile('${file}'); $s.Speak('${text.replace(/'/g, "''")}'); $s.Dispose()`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {timeout: 60000, windowsHide: true});
}

export const toWav = (f32, rate = SR) => {
  const n = f32.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32768))), 44 + 2 * i);
  return b;
};

// Deterministic PRNG so every run builds identical fixtures.
export function rng(seed = 1) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export function whiteNoise(n, rms, seed = 7) { const r = rng(seed), o = new Float32Array(n); let ss = 0; for (let i = 0; i < n; i++) { o[i] = r() + r() + r() + r() - 2; ss += o[i] * o[i]; } const g = rms / Math.sqrt(ss / n); for (let i = 0; i < n; i++) o[i] *= g; return o; }
export function pinkishNoise(n, rms, seed = 9) { const w = whiteNoise(n, 1, seed), o = new Float32Array(n); let a = 0, ss = 0; for (let i = 0; i < n; i++) { a = 0.98 * a + w[i]; o[i] = a; ss += a * a; } const g = rms / Math.sqrt(ss / n); for (let i = 0; i < n; i++) o[i] *= g; return o; }
export function sine(n, hz, amp) { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR); return o; }
export const mix = (...parts) => { const n = Math.max(...parts.map(p => p.length)), o = new Float32Array(n); for (const p of parts) for (let i = 0; i < p.length; i++) o[i] += p[i]; return o; };
export const scale = (x, g) => x.map(v => v * g);
export const clipAt = (x, lim) => x.map(v => Math.max(-lim, Math.min(lim, v)));
export const rmsDb = x => { let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / x.length + 1e-18); };

// Decode any WAV to 16 kHz mono floats using the same FFmpeg the server uses.
export async function loadSpeech16k(file) {
  const bin = await ffmpegPath(), out = path.join(path.dirname(file), 'speech16k.wav');
  await run(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', out], 60000);
  const {samples} = wavToInt16(readFileSync(out));
  return Float32Array.from(samples, v => v / 32768);
}

// Add noise so that (speech level while speaking) minus (noise level) equals snrDb.
// Speech level = the analyzer's measurement of the clean recording, so the ground truth is exact by construction.
export function addNoiseAtSnr(speech, snrDb, noiseFn = whiteNoise) {
  const clean = analyzeSignal(speech);
  const noiseRmsDb = clean.activeDb - snrDb;
  return {audio: mix(speech, noiseFn(speech.length, 10 ** (noiseRmsDb / 20))), groundTruthSnrDb: snrDb, noiseDb: noiseRmsDb};
}

// Build the whole fixture set once; returns {name: {wav: Buffer, truth: {...}}}.
export async function buildFixtures() {
  const dir = mkdtempSync(path.join(tmpdir(), 'voxa-fx-'));
  try {
    const out = {}, n10 = SR * 10;
    const add = (name, f32, truth) => { out[name] = {wav: toWav(f32), truth}; };
    add('silence', new Float32Array(n10), {speech: 'no'});
    add('white_noise_only', whiteNoise(n10, 0.05), {speech: 'no', noiseIndicator: 'hf_noise'});
    add('pink_noise_only', pinkishNoise(n10, 0.05), {speech: 'no'});
    add('tone_440', sine(n10, 440, 0.3), {speech: 'no'});
    add('very_short_0.5s', whiteNoise(SR / 2, 0.05), {tooShort: true});
    add('clipped_noise_burst', clipAt(scale(whiteNoise(n10, 0.4), 6), 1), {clipping: true});
    // Non-speech sounds with a steady or stepped pitch. The beep must NOT read as speech; the melody is a known
    // false positive (pitch moves), kept so the evaluation reports it instead of hiding it.
    const beep = new Float32Array(n10); { const t = sine(n10, 440, 0.3); for (let i = 0; i < n10; i++) if (Math.floor(i / (SR * 0.4)) % 2 === 0) beep[i] = t[i]; }
    add('beep_on_off', mix(beep, whiteNoise(n10, 0.003, 3)), {speech: 'no'});
    const mel = new Float32Array(n10), notes = [262, 330, 392, 523, 392, 330]; for (let i = 0; i < n10; i++) mel[i] = 0.25 * Math.sin((2 * Math.PI * notes[Math.floor(i / (SR * 0.4)) % notes.length] * i) / SR);
    add('melody_tones', mix(mel, whiteNoise(n10, 0.003, 4)), {speech: 'no', knownFalsePositive: true});
    add('hum_only_60Hz', mix(sine(n10, 60, 0.02), sine(n10, 120, 0.01), whiteNoise(n10, 0.004, 6)), {speech: 'no', hum: 60});
    if (ttsAvailable()) {
      const f = path.join(dir, 'speech.wav'); ttsWav(f);
      const sp = await loadSpeech16k(f), clean = analyzeSignal(sp);
      add('clean_speech', sp, {speech: 'yes', noise: 'low'});
      for (const snr of [30, 20, 10, 5, 0]) { const m = addNoiseAtSnr(sp, snr); add(`speech_white_${snr}dB`, m.audio, {speech: 'yes', snrDb: snr}); }
      add('speech_pink_10dB', addNoiseAtSnr(sp, 10, pinkishNoise).audio, {speech: 'yes', snrDb: 10});
      const humRms = 10 ** ((clean.activeDb - 28) / 20), bg = whiteNoise(sp.length, 10 ** ((clean.activeDb - 40) / 20), 5);
      add('speech_hum_50Hz', mix(sp, bg, sine(sp.length, 50, humRms * 1.414), sine(sp.length, 100, humRms * 0.7)), {speech: 'yes', hum: 50});
      add('speech_clipped', clipAt(scale(sp, 12), 1), {speech: 'yes', clipping: true});
      const f2 = path.join(dir, 'speech2.wav'); ttsWav(f2, 'Good afternoon. I am calling about your recent order. Could you please confirm the delivery address, and the best time for a visit? Thanks very much for your help.', 'Microsoft David Desktop');
      const sp2 = await loadSpeech16k(f2);
      add('clean_speech_david', sp2, {speech: 'yes', noise: 'low'});
      add('speech_david_white_10dB', addNoiseAtSnr(sp2, 10).audio, {speech: 'yes', snrDb: 10});
      add('speech_david_pink_5dB', addNoiseAtSnr(sp2, 5, pinkishNoise).audio, {speech: 'yes', snrDb: 5});
      out._meta = {speechSeconds: sp.length / SR, cleanActiveDb: clean.activeDb};
    }
    return out;
  } finally { rmSync(dir, {recursive: true, force: true}); }
}
