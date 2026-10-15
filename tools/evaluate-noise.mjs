// Runs the noise analyzer over generated fixtures and prints estimates next to ground truth.
// Usage: node tools/evaluate-noise.mjs [--denoise] [--json evaluation/noise-results.json]
import {writeFileSync} from 'node:fs';
import {probe} from '../server/media.mjs';
import {analyzeNoise, NoiseError} from '../server/noise.mjs';
import {buildFixtures, ttsAvailable} from './noise-fixtures.mjs';

const denoise = process.argv.includes('--denoise');
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
console.log(ttsAvailable() ? 'Real speech: Windows System.Speech voice.' : 'No TTS on this OS: speech fixtures skipped.');
const fx = await buildFixtures(), rows = [];
for (const [name, f] of Object.entries(fx)) {
  if (name === '_meta') continue;
  let r;
  try {
    const info = await probe(f.wav, 'audio/wav');
    r = await analyzeNoise({bytes: f.wav, mime: 'audio/wav', info, denoise});
  } catch (e) { rows.push({name, error: e instanceof NoiseError ? e.code : String(e.message).slice(0, 80), truth: f.truth}); continue; }
  const p = r.report;
  rows.push({
    name, truth: f.truth, speech: p.speech.detected, level: p.noise.level, basis: p.noise.basis, floorDbfs: p.noise.floorDbfs,
    snrDb: p.noise.snrDb, indicators: p.noise.indicators.map(i => i.id), clipping: p.clipping?.detected, quality: p.quality.rating, suitability: p.quality.suitability,
    action: p.recommendation.action, enhancement: p.enhancement.applied ? {measured: p.enhancement.measured, improved: p.enhancement.measuredImprovement} : null
  });
}
const pad = (v, n) => String(v ?? '-').padEnd(n);
console.log(['fixture', 'truth', 'speech', 'level(basis)', 'floor', 'SNR est', 'indicators', 'clip', 'quality', 'suitability'].map((h, i) => pad(h, [22, 26, 10, 26, 8, 8, 20, 6, 12, 14][i])).join(''));
for (const r of rows) {
  if (r.error) { console.log(pad(r.name, 22) + 'ERROR ' + r.error); continue; }
  const t = Object.entries(r.truth).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(pad(r.name, 22) + pad(t, 26) + pad(r.speech, 10) + pad(`${r.level}(${r.basis ?? '-'})`, 26) + pad(r.floorDbfs, 8) + pad(r.snrDb, 8) + pad(r.indicators.join(','), 20) + pad(r.clipping, 6) + pad(r.quality, 12) + pad(r.suitability, 14));
}
if (denoise) { console.log('\nEnhancement (measured):'); for (const r of rows) if (r.enhancement) console.log(pad(r.name, 22), JSON.stringify(r.enhancement)); }
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify({generatedAt: new Date().toISOString(), denoise, rows}, null, 1)); console.log('wrote', jsonOut); }
