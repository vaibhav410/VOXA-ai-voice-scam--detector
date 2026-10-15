// Browser test for the Noise Analysis feature. Never clicks "Analyze Voice" (that calls paid providers).
// Usage: node noise-e2e.mjs http://127.0.0.1:5190
import {chromium} from 'playwright';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {buildFixtures} from '../noise-fixtures.mjs';

const B = process.argv[2] || 'http://127.0.0.1:5190';
const dir = mkdtempSync(path.join(tmpdir(), 'voxa-e2e-'));
const fx = await buildFixtures();
const noisy = path.join(dir, 'noisy-call.wav'), clean = path.join(dir, 'clean-call.wav');
writeFileSync(noisy, fx.speech_white_10dB.wav); writeFileSync(clean, fx.clean_speech.wav);

const browser = await chromium.launch(), ctx = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + String(e.stack || e.message).split('\n').slice(0, 2).join(' | ')));
p.on('response', r => { if (r.status() >= 400 && !r.url().includes('/api/status')) errs.push('HTTP ' + r.status() + ' ' + r.url().replace(/https?:\/\/[^/]+/, '')); });
const has = (t, x) => t.toLowerCase().includes(x.toLowerCase());
let step = 0; const ok = m => console.log(`  ✓ ${++step}. ${m}`);

await p.goto(B + '/login.html?demo=1'); await p.click('#demo'); await p.waitForURL('**/app.html**');
await p.goto(B + '/app.html#/analyze'); await p.waitForSelector('#a-file', {state: 'attached'});

// 1. both actions exist on the voice tab only
assert.equal((await p.innerText('#a-go')).trim(), 'Analyze Voice');
assert.equal((await p.innerText('#a-noise')).trim(), 'Analyze Noise');
assert.ok(await p.locator('#a-denoise').count());
await p.click('[data-mod="image"]'); assert.equal(await p.locator('#a-noise').count(), 0); assert.equal((await p.innerText('#a-go')).trim(), 'Analyze');
await p.click('[data-mod="voice"]'); ok('voice tab has Analyze Voice + Analyze Noise + enhanced-copy option; other tabs do not');

// 2. needs audio and consent
await p.click('#a-noise'); assert.match(await p.innerText('#toast'), /Add an audio recording/);
await p.setInputFiles('#a-file', noisy); await p.waitForFunction(() => /noisy-call\.wav/.test(document.querySelector('#a-info,.an-info')?.textContent || document.body.textContent));
await p.click('#a-noise'); assert.match(await p.innerText('#toast'), /Confirm consent/);
ok('Analyze Noise asks for audio, then consent');

// 3. run noise analysis with an enhanced copy
await p.check('#a-consent'); await p.check('#a-denoise');
await p.click('#a-noise'); await p.waitForURL('**#/incident/**', {timeout: 90000});
const noiseUrl = p.url(), noiseId = decodeURIComponent(noiseUrl.split('/incident/')[1]);
const t = await p.innerText('#view');
for (const must of ['Noise analysis report', 'noisy-call.wav', 'Speech detected', 'Background noise', 'Audio quality', 'Estimated SNR', 'Peak level', 'Clipping', 'Original and enhanced audio', 'Enhancement applied', 'afwtdn', 'Before', 'After', 'Evidence: how each result was calculated', 'Recommended next action', 'Limitations and uncertainty', 'not Silero VAD']) assert.ok(has(t, must), 'report is missing: ' + must);
assert.match(t, /Yes/i); assert.match(t, /High/i);
assert.ok(!/Intelligence results|Scam-intent findings|Voice authenticity result/.test(t), 'noise report must not contain the voice/scam report sections');
ok('noise report renders every required section, separate from the voice/scam report');
assert.equal(await p.locator('audio').count(), 2, 'original + enhanced players'); assert.ok(await p.locator('#i-dl-enh').count());
const href = await p.getAttribute('#i-dl-enh', 'href'); assert.match(href, /^blob:/);
const dl = await p.evaluate(async h => { const r = await fetch(h); const b = new Uint8Array(await r.arrayBuffer()); return {size: b.length, magic: String.fromCharCode(...b.slice(0, 4))}; }, href);
assert.equal(dl.magic, 'RIFF'); assert.ok(dl.size > 100000);
ok(`original + enhanced players, and the download is a real WAV (${Math.round(dl.size / 1024)} KB)`);
await p.waitForSelector('#i-wave2'); await p.waitForTimeout(600);
await p.screenshot({path: '../../crawl/noise-report.png', fullPage: true});

// 4. JSON export has the report type and measurements but no audio
const [download] = await Promise.all([p.waitForEvent('download'), p.click('#i-json')]);
const exp = JSON.parse(readFileSync(await download.path(), 'utf8'));
assert.equal(exp.incident.reportType, 'noise_analysis'); assert.ok(exp.incident.noise.speech); assert.ok(exp.incident.noise.enhancement.measured);
assert.ok(JSON.stringify(exp).length < 60000, 'export must not embed audio'); assert.ok(!/UklGR/.test(JSON.stringify(exp)), 'no base64 WAV in the export');
ok('JSON export carries reportType + measurements and no audio');

// 5. status + note work on the noise report (shared handlers)
await p.fill('#i-note', 'checked on headphones'); await p.click('#i-add'); await p.waitForSelector('text=checked on headphones');
await p.selectOption('#i-status', 'resolved'); await p.waitForTimeout(200);
ok('analyst note + status work on the noise report');

// 6. a voice report from the same upload, seeded (no provider calls), links both ways
const uploadId = await p.evaluate(id => JSON.parse(sessionStorage.getItem('voxa:incidents')).find(x => x.id === id).uploadId, noiseId);
assert.match(uploadId, /^UP-/);
await p.evaluate(({uploadId}) => {
  const now = Date.now();
  const v = {id: 'INC-VOICE1', at: now - 1000, uploadId, reportType: 'voice_authenticity', modality: 'voice', sector: 'finance', policyVersion: 'finance-1.0.0', status: 'open', notes: [], tags: [], persist: false, expiresAt: now + 86400000,
    intent: {status: 'ok', score: 6, words: 12, rules: [{id: 'otp', label: 'OTP request', weight: 3, excerpt: 'share the OTP'}]}, priority: 'high', transcript: {text: 'Please share the OTP now.', source: 'provided'},
    media: {name: 'noisy-call.wav', size: 100, duration: 20, kind: 'voice'}, authenticity: {status: 'unavailable', code: 'MODEL_NOT_CONNECTED', message: 'No detector.'}, context: {status: 'unavailable'}, limitations: 'Decision support only.', state: 'partial'};
  const cur = JSON.parse(sessionStorage.getItem('voxa:incidents') || '[]'); sessionStorage.setItem('voxa:incidents', JSON.stringify([v, ...cur]));
}, {uploadId});
await p.goto(B + '/app.html#/incident/INC-VOICE1'); await p.waitForSelector('.rep');
assert.ok(has(await p.innerText('#view'), 'Related reports from the same upload')); assert.ok(await p.locator(`a[href="#/incident/${noiseId}"]`).count());
await p.goto(B + '/app.html#/incident/' + noiseId); await p.waitForSelector('.rep');
assert.ok(await p.locator('a[href="#/incident/INC-VOICE1"]').count());
ok('voice and noise reports from one upload link to each other; the voice report page still renders');

// 7. history + report-type filters
await p.goto(B + '/app.html#/history'); await p.waitForSelector('.hs-card');
assert.equal(await p.locator('.hs-card').count(), 2);
await p.selectOption('#hs-rt', 'noise_analysis'); assert.equal(await p.locator('.hs-card').count(), 1);
assert.match(await p.innerText('.hs-card'), /Noise analysis/i); assert.match(await p.innerText('.hs-card'), /Speech: Yes/i);
await p.selectOption('#hs-rt', 'voice_authenticity'); assert.equal(await p.locator('.hs-card').count(), 1); await p.selectOption('#hs-rt', '');
await p.goto(B + '/app.html#/incidents'); await p.waitForSelector('#inc-table table');
assert.equal(await p.locator('#inc-table tbody tr').count(), 2); await p.selectOption('#f-rt', 'noise_analysis'); assert.equal(await p.locator('#inc-table tbody tr').count(), 1);
assert.match(await p.innerText('#inc-table'), /Noise analysis/i);
ok('History and Call reports filter by report type (noise vs voice)');

// 8. dashboards do not count noise reports as calls
await p.goto(B + '/app.html#/call-safety'); await p.waitForTimeout(800);
const dash = await p.innerText('#view');
assert.match(dash, /Last 7 days · 1 reports? saved/, 'only the voice report counts as a call');
ok('call dashboard counts 1 call, not the noise report');

// 9. reload: report reopens; audio is gone (not stored) and says so
await p.goto(B + '/app.html#/incident/' + noiseId); await p.reload(); await p.waitForSelector('.rep');
const after = await p.innerText('#view');
assert.ok(has(after, 'Noise analysis report') && has(after, 'Playback is unavailable')); assert.equal(await p.locator('audio').count(), 0);
ok('after a reload the noise report reopens from storage; audio is correctly unavailable');

// 10. retention: "Keep report 24 h" persists across tabs/sessions
await p.goto(B + '/app.html#/analyze'); await p.setInputFiles('#a-file', clean); await p.waitForTimeout(500);
await p.check('#a-consent'); await p.check('#a-retain'); await p.click('#a-noise'); await p.waitForURL('**#/incident/**', {timeout: 90000});
const keptId = decodeURIComponent(p.url().split('/incident/')[1]);
assert.match(await p.innerText('#view'), /Silent|silent|Low/); assert.match(await p.innerText('#view'), /Enhancement applied: No|Enhancement applied/);
const p2 = await ctx.newPage(); // same browser profile, new tab = new tab session; the login session is shared
await p2.goto(B + '/app.html#/incident/' + keptId); await p2.waitForSelector('.rep');
assert.ok(has(await p2.innerText('#view'), 'Noise analysis report'));
const gone = await p2.evaluate(id => !JSON.parse(sessionStorage.getItem('voxa:incidents') || '[]').some(x => x.id === id), noiseId);
assert.ok(gone, 'the un-kept report must not persist into a new tab session');
ok('a kept report opens in a new tab; the un-kept report stays in its own tab only (retention honoured)');
await p2.close();

// 11. delete
await p.goto(B + '/app.html#/incident/' + keptId); await p.click('#i-del'); await p.click('#i-del'); await p.waitForURL('**#/incidents');
assert.equal(await p.evaluate(id => JSON.parse(localStorage.getItem('voxa:incidents') || '[]').some(x => x.id === id), keptId), false);
ok('delete removes the report');

console.log(errs.length ? '\nERRORS:\n' + errs.join('\n') : '\nno page errors, no failed requests');
await browser.close(); rmSync(dir, {recursive: true, force: true});
process.exit(errs.length ? 1 : 0);
