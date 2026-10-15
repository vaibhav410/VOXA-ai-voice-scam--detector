// Browser test for the "Noise reduction" sidebar page. Local processing only; no provider is called.
// Usage: node noise-page-e2e.mjs http://127.0.0.1:5174
import {chromium} from 'playwright';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {buildFixtures} from '../noise-fixtures.mjs';

const B = process.argv[2] || 'http://127.0.0.1:5174';
const dir = mkdtempSync(path.join(tmpdir(), 'voxa-nr-')), fx = await buildFixtures();
const noisy = path.join(dir, 'office-call.wav'), notAudio = path.join(dir, 'notes.txt');
writeFileSync(noisy, fx.speech_white_10dB.wav); writeFileSync(notAudio, 'hello');
const browser = await chromium.launch(), p = await (await browser.newContext({viewport: {width: 1440, height: 900}})).newPage();
const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + String(e.stack || e.message).split('\n').slice(0, 2).join(' | ')));
p.on('response', r => { if (r.status() >= 400 && !r.url().includes('/api/status')) errs.push('HTTP ' + r.status() + ' ' + r.url().replace(/https?:\/\/[^/]+/, '')); });
let n = 0; const ok = m => console.log(`  ✓ ${++n}. ${m}`);

await p.goto(B + '/login.html?demo=1'); await p.click('#demo'); await p.waitForURL('**/app.html**');
await p.goto(B + '/app.html#/call-safety'); await p.waitForSelector('#side-body .nav');

// sidebar entry, under Models, with an icon
const link = p.locator('#side-body a.nav', {hasText: 'Noise reduction'});
assert.equal(await link.count(), 1);
assert.ok(await link.locator('svg').count(), 'sidebar item must have an icon');
const groups = await p.locator('#side-body .group').evaluateAll(gs => gs.map(g => ({h: g.querySelector('h6')?.innerText.trim(), items: [...g.querySelectorAll('a.nav')].map(a => a.innerText.trim())})));
const models = groups.find(g => /models/i.test(g.h)); assert.ok(models.items.includes('Noise reduction'), JSON.stringify(models));
ok(`sidebar shows "Noise reduction" with an icon under ${models.h}: ${models.items.join(', ')}`);
await p.screenshot({path: '../../crawl/noise-sidebar.png', clip: {x: 0, y: 0, width: 260, height: 900}});

await link.click(); await p.waitForURL('**#/noise'); await p.waitForSelector('#nr-file', {state: 'attached'});
assert.equal((await p.title()).includes('Noise reduction'), true);
assert.ok(await p.locator('#side-body a.nav.active', {hasText: 'Noise reduction'}).count(), 'item is highlighted on its page');
assert.equal(await p.isChecked('#nr-denoise'), true);
ok('clicking it opens the page; item is highlighted; enhanced copy is on by default');
await p.screenshot({path: '../../crawl/noise-page.png', fullPage: true});

// validation
await p.click('#nr-go'); assert.match(await p.innerText('#toast'), /Add an audio file/);
await p.setInputFiles('#nr-file', notAudio); await p.waitForTimeout(300);
assert.match(await p.innerText('#nr-info'), /Unsupported format/);
await p.setInputFiles('#nr-file', noisy); await p.waitForFunction(() => /office-call\.wav/.test(document.querySelector('#nr-info').textContent));
await p.click('#nr-go'); assert.match(await p.innerText('#toast'), /Confirm consent/);
ok('rejects a non-audio file, asks for audio, then for consent');

// run
await p.check('#nr-consent'); await p.click('#nr-go'); await p.waitForURL('**#/incident/**', {timeout: 90000});
const id = decodeURIComponent(p.url().split('/incident/')[1]); const t = await p.innerText('#view');
for (const must of ['Noise analysis report', 'office-call.wav', 'Original and enhanced audio', 'afwtdn', 'Download enhanced audio']) assert.ok(t.toLowerCase().includes(must.toLowerCase()), 'missing ' + must);
assert.equal(await p.locator('audio').count(), 2);
ok('analysis from the page opens the same Noise analysis report, with original + enhanced players');

// shows up in the page's recent list and in history
await p.goto(B + '/app.html#/noise'); await p.waitForSelector('.nr-recent');
assert.ok(await p.locator(`.nr-recent a[href="#/incident/${id}"]`).count());
await p.goto(B + '/app.html#/history'); await p.waitForSelector('.hs-card'); await p.selectOption('#hs-rt', 'noise_analysis');
assert.equal(await p.locator('.hs-card').count(), 1);
ok('report appears in "Recent noise reports" and in History (noise filter)');

// without enhanced copy
await p.goto(B + '/app.html#/noise'); await p.waitForSelector('#nr-file', {state: 'attached'});
await p.setInputFiles('#nr-file', noisy); await p.waitForFunction(() => /office-call\.wav/.test(document.querySelector('#nr-info').textContent));
await p.check('#nr-consent'); await p.uncheck('#nr-denoise'); await p.click('#nr-go'); await p.waitForURL('**#/incident/**', {timeout: 90000});
assert.equal(await p.locator('audio').count(), 1); assert.ok((await p.innerText('#view')).includes('No enhanced copy was requested'));
ok('with the option off: no enhanced copy, and the report says so');

console.log(errs.length ? '\nERRORS:\n' + errs.join('\n') : '\nno page errors, no failed requests');
await browser.close(); rmSync(dir, {recursive: true, force: true}); process.exit(errs.length ? 1 : 0);
