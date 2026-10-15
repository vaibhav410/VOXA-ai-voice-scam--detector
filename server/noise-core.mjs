// VOXA noise analysis core. Pure functions: samples in, measurements and a report out. No I/O, no network.
//
// Honest scope (also repeated in every report's limitations):
//  - Speech detection is an energy + spectral + modulation heuristic. It is NOT Silero VAD or any trained model.
//  - Noise "indicators" are descriptive spectral findings in the quietest frames (mains hum, high-frequency
//    hiss-like energy, low-frequency rumble). Sources such as traffic or a fan are never named.
//  - SNR is a percentile-style estimate (loud speech frames vs a stable quiet floor), only reported when
//    several conditions hold. It is not a calibrated measurement.
export const SR = 16000;
export const FRAME = 512;
export const HOP = 256;
export const LTAS_N = 4096;
export const ANALYZER_VERSION = '1.0.0';
export const MIN_SECONDS = 1;
export const MAX_SECONDS = 300;

const DIGITAL_SILENCE_DB = -85;
const QUIET_DB = -60;
const dbOf = v => 20 * Math.log10(v + 1e-9);
const powDb = p => 10 * Math.log10(p + 1e-18);
export const round = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

const hannCache = new Map();
const hann = n => {
  if (!hannCache.has(n)) { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)); hannCache.set(n, w); }
  return hannCache.get(n);
};

// In-place iterative radix-2 FFT. re/im length must be a power of two.
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// ---------- per-frame features (16 kHz mono, floats in [-1, 1]) ----------
export function frameFeatures(x) {
  const n = x.length < FRAME ? 0 : 1 + Math.floor((x.length - FRAME) / HOP);
  const db = new Float64Array(n), rms = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    const o = f * HOP;
    let ss = 0;
    for (let i = 0; i < FRAME; i++) { const v = x[o + i]; ss += v * v; }
    rms[f] = Math.sqrt(ss / FRAME);
    db[f] = dbOf(rms[f]);
  }
  return { n, db, rms };
}

// Pitch periodicity of one frame: the strongest local maximum of the normalised autocorrelation at pitch lags
// (60-400 Hz). Voiced speech scores high even with noise added; noise, even coloured noise, does not, because a
// real peak must exist (monotonic decay is rejected). Computed via FFT of the zero-padded frame.
const ACN = 1024, LAG_MIN = Math.floor(SR / 400), LAG_MAX = Math.ceil(SR / 60);
const acRe = new Float64Array(ACN), acIm = new Float64Array(ACN);
export function periodicity(x, offset) {
  acRe.fill(0); acIm.fill(0);
  let mean = 0; for (let i = 0; i < FRAME; i++) mean += x[offset + i]; mean /= FRAME;
  for (let i = 0; i < FRAME; i++) acRe[i] = x[offset + i] - mean;
  fft(acRe, acIm);
  for (let k = 0; k < ACN; k++) { acRe[k] = acRe[k] * acRe[k] + acIm[k] * acIm[k]; acIm[k] = 0; }
  fft(acRe, acIm); // autocorrelation (the power spectrum is real and symmetric)
  const r0 = acRe[0];
  periodicity.lag = 0;
  if (!(r0 > 0)) return 0;
  let best = 0, bestLag = 0;
  for (let l = LAG_MIN; l <= LAG_MAX; l++) {
    const r = acRe[l] / r0;
    if (r > best && acRe[l] > acRe[l - 1] && acRe[l] >= acRe[l + 1]) { best = r; bestLag = l; }
  }
  periodicity.lag = bestLag;
  return best;
}

// ---------- long-term spectrum of the quietest frames ----------
function floorSpectrum(x, floorFrames) {
  const segs = []; // contiguous sample runs covered by floor frames
  let start = null, prev = null;
  const flush = () => { if (start !== null) segs.push([start * HOP, prev * HOP + FRAME]); start = null; };
  for (const f of floorFrames) { if (start !== null && f === prev + 1) prev = f; else { flush(); start = f; prev = f; } }
  flush();
  const bins = LTAS_N / 2 + 1, acc = new Float64Array(bins);
  const w = hann(LTAS_N), re = new Float64Array(LTAS_N), im = new Float64Array(LTAS_N);
  let count = 0;
  for (const [a, b] of segs) {
    for (let o = a; o + LTAS_N <= b; o += LTAS_N / 2) {
      for (let i = 0; i < LTAS_N; i++) { re[i] = x[o + i] * w[i]; im[i] = 0; }
      fft(re, im);
      for (let k = 0; k < bins; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
      count++;
    }
  }
  if (count >= 4) { for (let k = 0; k < bins; k++) acc[k] /= count; return { power: acc, segments: count, binHz: SR / LTAS_N, fine: true }; }
  // Fallback: average 512-point spectra of the floor frames. Too coarse (31 Hz bins) to judge 50/60 Hz hum.
  if (floorFrames.length < 32) return null;
  const fb = FRAME / 2 + 1, facc = new Float64Array(fb), fw = hann(FRAME), fre = new Float64Array(FRAME), fim = new Float64Array(FRAME);
  for (const f of floorFrames) {
    for (let i = 0; i < FRAME; i++) { fre[i] = x[f * HOP + i] * fw[i]; fim[i] = 0; }
    fft(fre, fim);
    for (let k = 0; k < fb; k++) facc[k] += fre[k] * fre[k] + fim[k] * fim[k];
  }
  for (let k = 0; k < fb; k++) facc[k] /= floorFrames.length;
  return { power: facc, segments: floorFrames.length, binHz: SR / FRAME, fine: false };
}
const bandPower = (sp, lo, hi) => { let s = 0; const a = Math.max(1, Math.round(lo / sp.binHz)), b = Math.min(sp.power.length - 1, Math.round(hi / sp.binHz)); for (let k = a; k <= b; k++) s += sp.power[k]; return { sum: s, bins: b - a + 1 }; };
function peakProminenceDb(sp, hz) {
  const k0 = Math.round(hz / sp.binHz), P = sp.power;
  let peak = 0; for (let k = k0 - 1; k <= k0 + 1; k++) peak = Math.max(peak, P[k] || 0);
  const nb = []; for (let k = k0 - 10; k <= k0 + 10; k++) if (Math.abs(k - k0) >= 4 && k > 0 && P[k] !== undefined) nb.push(P[k]);
  nb.sort((a, b) => a - b);
  const base = nb[nb.length >> 1] || 0;
  return base > 0 && peak > 0 ? 10 * Math.log10(peak / base) : null;
}
function spectralIndicators(sp) {
  const out = [];
  const total = bandPower(sp, 20, 7500).sum;
  if (!(total > 0)) return { indicators: out, metrics: null };
  // Mains hum: a narrow tonal peak at 50 or 60 Hz that stands well above its neighbours.
  const hum = sp.fine ? [50, 60].map(f => ({ f, prom: peakProminenceDb(sp, f), harm: peakProminenceDb(sp, f * 2) })).sort((a, b) => (b.prom ?? -99) - (a.prom ?? -99))[0] : { f: null, prom: null, harm: null };
  const humNear = new Set(); if (sp.fine) for (const f of [50, 60, 100, 120, 150, 180]) for (let d = -2; d <= 2; d++) humNear.add(Math.round(f / sp.binHz) + d);
  let lfNoHum = 0; { const a = Math.max(1, Math.round(20 / sp.binHz)), b = Math.round(200 / sp.binHz); for (let k = a; k <= b; k++) if (!humNear.has(k)) lfNoHum += sp.power[k]; }
  const lfShare = lfNoHum / total;
  const mid = bandPower(sp, 500, 2000), hf = bandPower(sp, 4000, 7500);
  const hissRatioDb = 10 * Math.log10((hf.sum / hf.bins) / (mid.sum / mid.bins));
  if (hum.prom !== null && hum.prom >= 10) out.push({ id: 'mains_hum', label: `Mains-frequency hum (${hum.f} Hz tonal component)`, hz: hum.f, evidence: { prominenceDb: round(hum.prom), harmonicProminenceDb: round(hum.harm) }, how: `A narrow peak at ${hum.f} Hz is ${round(hum.prom)} dB above the surrounding spectrum of the quietest frames (threshold 10 dB).` });
  if (hissRatioDb > -12) out.push({ id: 'hf_noise', label: 'Broadband / high-frequency noise (hiss-like)', evidence: { highVsMidDb: round(hissRatioDb) }, how: `In the quietest frames, energy per Hz at 4-7.5 kHz is ${round(hissRatioDb)} dB relative to 0.5-2 kHz (flagged above -12 dB; white noise is 0 dB).` });
  if (lfShare >= 0.6) out.push({ id: 'lf_rumble', label: 'Low-frequency rumble (energy concentrated below 200 Hz)', evidence: { shareBelow200Hz: round(lfShare * 100, 0) + '%' }, how: `${round(lfShare * 100, 0)}% of the quietest frames' energy is below 200 Hz, excluding mains-hum bins (flagged at 60% or more). The source is not identified.` });
  return { indicators: out, metrics: { humPromDb: round(hum.prom), humHz: hum.f, hissRatioDb: round(hissRatioDb), lfShare: round(lfShare, 2), humChecked: sp.fine } };
}

// ---------- whole-signal analysis ----------
const VOICED_PERIODICITY = 0.4;
export const PITCH_SPREAD_MIN = 2; // semitones, 10th-90th percentile of voiced-frame pitch
export function analyzeSignal(x) {
  const ft = frameFeatures(x), n = ft.n, frameSec = HOP / SR;
  const res = { durationSec: round(x.length / SR, 2), frames: n };
  if (n < 8) return { ...res, insufficient: true, speech: { detected: 'uncertain', speechSec: 0 }, floorDb: null, floorMode: 'none', snrDb: null, indicators: [], silence: { quietRatio: null, longestSec: null, digitalRatio: null } };
  const valid = []; for (let f = 0; f < n; f++) if (ft.db[f] >= DIGITAL_SILENCE_DB) valid.push(f);
  const digitalRatio = 1 - valid.length / n, validSec = valid.length * frameSec;
  let quiet = 0, run = 0, longest = 0;
  for (let f = 0; f < n; f++) { if (ft.db[f] < QUIET_DB) { quiet++; run++; longest = Math.max(longest, run); } else run = 0; }
  const silence = { quietRatio: round(quiet / n, 3), longestSec: round(longest * frameSec, 2), digitalRatio: round(digitalRatio, 3) };
  if (validSec < 1) {
    return { ...res, silence, validSec: round(validSec, 2), speech: { detected: validSec < 0.3 ? 'no' : 'uncertain', speechSec: 0, ratio: 0 }, floorDb: null, floorMode: 'none', activeDb: null, snrDb: null, dynamicRangeDb: null, indicators: [], spectrumMetrics: null, noSignal: validSec < 0.3 };
  }
  const sortedDb = valid.map(f => ft.db[f]).sort((a, b) => a - b);
  const p = q => percentile(sortedDb, q), p10 = p(0.1), p90 = p(0.9);
  const dynamicRangeDb = p90 - p10;
  const floorMode = digitalRatio >= 0.05 ? 'silent-pauses' : 'measured';
  // Floor frames: the cluster within 3 dB of the 10th-percentile level. Steady noise puts nearly every frame here;
  // speech with pauses puts the pauses here. They are contiguous, so a long FFT can be taken on them.
  const floorFrames = valid.filter(f => ft.db[f] <= p10 + 3);
  const meanPow = fr => fr.reduce((s, f) => s + ft.rms[f] ** 2, 0) / Math.max(1, fr.length);
  const floorDb = floorMode === 'measured' ? powDb(meanPow(floorFrames)) : null;
  // A floor is "stable" when enough frames sit in the cluster (>= 1 s and >= 10% of non-silent audio).
  const stableFloor = floorMode === 'measured' && floorFrames.length >= 62 && floorFrames.length >= 0.1 * valid.length;
  // Speech heuristic: voiced (pitch-periodic) frames clearly above the floor, in runs of >= 5 frames (80 ms).
  const voiced = new Uint8Array(n), lag = new Float32Array(n);
  for (const f of valid) if (ft.db[f] > p10 + 3 && periodicity(x, f * HOP) >= VOICED_PERIODICITY) { voiced[f] = 1; lag[f] = periodicity.lag; }
  const speechyFrames = [];
  { let s = -1; for (let f = 0; f <= n; f++) { if (f < n && voiced[f]) { if (s < 0) s = f; } else if (s >= 0) { if (f - s >= 5) for (let k = s; k < f; k++) speechyFrames.push(k); s = -1; } } }
  const speechSec = speechyFrames.length * frameSec, ratio = speechyFrames.length / valid.length;
  // Pitch movement: speech glides; steady tones, beeps and hum hold one pitch.
  const semis = speechyFrames.map(f => 12 * Math.log2(SR / lag[f])).sort((a, b) => a - b);
  const pitchSpread = semis.length >= 10 ? percentile(semis, 0.9) - percentile(semis, 0.1) : null;
  let detected = 'uncertain';
  if (speechSec < 0.3) detected = 'no';
  else if (speechSec >= 1 && pitchSpread !== null && pitchSpread >= PITCH_SPREAD_MIN) detected = 'yes';
  const activeDb = speechyFrames.length ? powDb(meanPow(speechyFrames)) : null;
  // The loud frames contain the noise too, so subtract the floor power before taking the ratio.
  const pa = speechyFrames.length ? meanPow(speechyFrames) : 0, pf = floorMode === 'measured' ? meanPow(floorFrames) : 0;
  const snrDb = detected === 'yes' && stableFloor && pf > 0 && pa > 1.5 * pf ? 10 * Math.log10((pa - pf) / pf) : null;
  let indicators = [], spectrumMetrics = null;
  if (floorMode === 'measured' && floorDb > -80 && stableFloor) {
    const sp = floorSpectrum(x, floorFrames);
    if (sp) { const r = spectralIndicators(sp); indicators = r.indicators; spectrumMetrics = r.metrics; }
  }
  return { ...res, silence, validSec: round(validSec, 2), speech: { detected, speechSec: round(speechSec, 2), ratio: round(ratio, 3), pitchSpreadSemitones: round(pitchSpread) }, dynamicRangeDb: round(dynamicRangeDb), floorMode, floorDb: round(floorDb), stableFloor, floorFrameCount: floorFrames.length, activeDb: round(activeDb), snrDb: round(snrDb), indicators, spectrumMetrics, spectrumAvailable: spectrumMetrics !== null };
}

// Peak / RMS / clipping on the decoded first channel at its native rate (Int16 samples).
export function levelStats(s16) {
  const n = s16.length;
  if (!n) return null;
  let peak = 0, ss = 0, clipped = 0, runs = 0, run = 0;
  for (let i = 0; i < n; i++) {
    const v = s16[i], a = v < 0 ? -v : v;
    if (a > peak) peak = a;
    ss += v * v;
    if (a >= 32700) { run++; if (run === 3) { runs++; clipped += 3; } else if (run > 3) clipped++; } else run = 0;
  }
  const ratio = clipped / n;
  return { samples: n, peakDbfs: round(dbOf(peak / 32768)), rmsDbfs: round(dbOf(Math.sqrt(ss / n) / 32768)), clippedSamples: clipped, clippedRuns: runs, clippedRatio: round(ratio, 5), clippingDetected: runs >= 5 && ratio >= 0.0001 };
}

// ---------- classification and report text ----------
export function noiseLevel(sig) {
  if (sig.noSignal || sig.insufficient) return { level: 'unavailable', basis: null, why: 'There is no audible signal to measure.' };
  if (sig.floorMode === 'silent-pauses') return { level: 'low', basis: 'silent-pauses', why: 'Pauses between speech are digitally silent (below -85 dBFS), so no steady background noise is present there. Noise underneath speech cannot be measured, and a noise gate would look the same.' };
  if (sig.floorDb === null) return { level: 'unavailable', basis: null, why: 'Too little non-silent audio to estimate a floor.' };
  if (sig.snrDb !== null) {
    const level = sig.snrDb >= 25 ? 'low' : sig.snrDb >= 12 ? 'medium' : 'high';
    return { level, basis: 'snr', why: `Estimated SNR ${sig.snrDb} dB (low at 25 dB or more, medium 12-25, high below 12).` };
  }
  const level = sig.floorDb <= -60 ? 'low' : sig.floorDb <= -45 ? 'medium' : 'high';
  return { level, basis: 'absolute-floor', why: `${sig.speech.detected === 'no' ? 'No speech was found, so this describes the quietest part of the whole signal, not noise behind a voice. ' : ''}Quietest-frame level ${sig.floorDb} dBFS; no defensible SNR, so the absolute level is used (low at -60 dBFS or less, medium to -45, high above). This is a level, not a signal-to-noise measurement.` };
}

export function buildReport({ sig, levels, file, enhancement }) {
  const nl = noiseLevel(sig);
  const sp = sig.speech;
  const speechLabel = { yes: 'Yes', no: 'No', uncertain: 'Uncertain' }[sp.detected];
  const lim = [
    'Speech detection counts sustained pitch-periodic (voiced) frames whose pitch moves like speech. It is not Silero VAD or any trained model: music or singing can be mistaken for speech, and whispered or very noisy speech can be missed.',
    'Noise indicators describe the spectrum of the quietest frames (mains hum, high-frequency hiss-like energy, low-frequency rumble). VOXA does not identify sources such as traffic or a fan, and does not detect crackle or static.',
    'SNR is an estimate from loud speech frames versus a stable quiet floor and is reported only when those conditions hold. It is not a calibrated measurement.',
    'Only the first audio channel is analysed. The analysis runs on a 16 kHz mono rendering; clipping and peak levels use the first channel at its native rate.',
    'Noise present only underneath continuous speech cannot be separated from the speech itself.'
  ];
  if (sig.floorMode === 'silent-pauses') lim.push('Digitally silent pauses mean the floor was not measurable; a noise gate or editing may have removed noise between words.');
  // Quality: transparent rules, no invented score.
  const major = [], minor = [];
  if (sp.detected === 'no') major.push('No speech was detected.');
  if (nl.level === 'high') major.push('Background noise is high.');
  if (nl.level === 'medium') minor.push('Background noise is moderate.');
  if (levels?.clippingDetected) (levels.clippedRatio >= 0.001 ? major : minor).push(`Clipping detected (${levels.clippedRuns} runs, ${round(levels.clippedRatio * 100, 3)}% of samples).`);
  if (file.durationSec !== null && file.durationSec < 3) minor.push('The recording is shorter than 3 seconds.');
  if (sig.silence.quietRatio !== null && sig.silence.quietRatio > 0.6) minor.push(`Mostly quiet or silent (${round(sig.silence.quietRatio * 100, 0)}% of frames below -60 dBFS).`);
  for (const i of sig.indicators) minor.push(`${i.label}.`);
  const unavailable = nl.level === 'unavailable' && sp.detected !== 'yes';
  const rating = unavailable ? 'unavailable' : major.length ? 'poor' : minor.length ? 'fair' : 'good';
  const suitability = unavailable || sp.detected === 'uncertain' && !major.length ? 'insufficient' : sp.detected === 'no' || major.length ? 'not_suitable' : minor.length ? 'caution' : 'suitable';
  const suitText = { suitable: 'Suitable for further voice analysis.', caution: 'Usable for voice analysis with caution; results may be less reliable.', not_suitable: 'Not suitable for reliable voice analysis in its current state.', insufficient: 'Insufficient evidence to say whether this recording is suitable.' }[suitability];
  // Recommended next action
  let action = 'keep_original', text = 'Keep the original audio. No action needed before voice analysis.';
  if (suitability === 'insufficient') { action = 'insufficient'; text = 'Insufficient evidence. Record or upload a longer sample that contains clear speech, then analyse again.'; }
  else if (sp.detected === 'no') { action = 'record_again'; text = 'No speech was found. Check the microphone or the file, then record again.'; }
  else if (levels?.clippingDetected && levels.clippedRatio >= 0.001) { action = 'record_again'; text = 'Heavy clipping cannot be repaired by noise reduction. Record again at a lower input level.'; }
  else if (nl.level === 'high' || nl.level === 'medium' || sig.indicators.length) { action = 'apply_noise_reduction'; text = 'Apply noise reduction to a copy and compare, or record again in a quieter place. Always keep the original unchanged; analyse authenticity on the original, not the enhanced copy.'; }
  const evidence = [
    { item: 'Speech detected', value: speechLabel, how: `${sp.speechSec ?? 0} s of pitch-periodic (voiced) frames at least 3 dB above the quietest level; pitch spread ${sp.pitchSpreadSemitones ?? 'n/a'} semitones. Yes needs 1 s or more of voiced frames and a pitch spread of ${PITCH_SPREAD_MIN} semitones or more (steady tones and hum do not move); No means under 0.3 s of voiced frames.` },
    { item: 'Background-noise level', value: nl.level, how: nl.why },
    { item: 'Noise floor', value: sig.floorDb === null ? 'Unavailable' : sig.floorDb + ' dBFS', how: sig.floorDb === null ? (sig.floorMode === 'silent-pauses' ? 'Pauses are digitally silent, so there is no floor to measure.' : 'Not enough non-silent audio.') : 'RMS power of the non-silent 32 ms frames within 3 dB of the 10th-percentile level (the steady quiet cluster).' },
    { item: 'Estimated SNR', value: sig.snrDb === null ? 'Unavailable' : sig.snrDb + ' dB', how: sig.snrDb === null ? 'Not reported: it needs speech detected, a stable measured quiet floor (at least 1 s, 10% of the audio) and speech clearly above it.' : `Speech power (voiced frames ${sig.activeDb} dBFS, floor power removed) over floor ${sig.floorDb} dBFS. Assumes the noise under speech matches the floor; approximate, not calibrated.` },
    { item: 'Peak / RMS level', value: levels ? `${levels.peakDbfs} / ${levels.rmsDbfs} dBFS` : 'Unavailable', how: 'Measured on the first channel at its native sample rate.' },
    { item: 'Clipping', value: levels ? (levels.clippingDetected ? 'Detected' : 'None detected') : 'Unavailable', how: levels ? `${levels.clippedRuns} runs of 3 or more samples at full scale; flagged at 5 runs and 0.01% of samples.` : 'Not measured.' },
    { item: 'Silence', value: sig.silence.quietRatio === null ? 'Unavailable' : round(sig.silence.quietRatio * 100, 0) + '% quiet', how: sig.silence.quietRatio === null ? 'Not measured.' : `Frames below -60 dBFS; longest quiet stretch ${sig.silence.longestSec} s; digital silence ${round(sig.silence.digitalRatio * 100, 0)}%.` }
  ];
  return {
    analyzerVersion: ANALYZER_VERSION,
    method: 'FFmpeg decode + VOXA JavaScript DSP (no external service, no model)',
    file,
    speech: { detected: sp.detected, label: speechLabel, speechSec: sp.speechSec, ratio: sp.ratio, pitchSpreadSemitones: sp.pitchSpreadSemitones, method: 'Voiced-frame (pitch periodicity) heuristic (not a trained VAD)' },
    noise: { level: nl.level, basis: nl.basis, floorDbfs: sig.floorDb, floorMode: sig.floorMode, activeLevelDbfs: sig.activeDb, snrDb: sig.snrDb, snrNote: sig.snrDb === null ? 'Unavailable: no defensible estimate.' : 'Approximate estimate, not a calibrated measurement.', indicators: sig.indicators, indicatorsChecked: sig.spectrumAvailable === true, spectrum: sig.spectrumMetrics },
    levels,
    clipping: levels ? { detected: levels.clippingDetected, runs: levels.clippedRuns, samples: levels.clippedSamples, ratio: levels.clippedRatio } : null,
    silence: sig.silence,
    quality: { rating, suitability, suitabilityText: suitText, issues: [...major, ...minor] },
    recommendation: { action, text },
    enhancement: enhancement || { requested: false, applied: false },
    evidence,
    limitations: lim
  };
}
