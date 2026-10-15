// Browser test for the Audo option on the Noise reduction page. Audo is MOCKED (no request reaches audo.ai).
import {chromium} from 'playwright';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from '../../server.mjs';
import {toWav, whiteNoise, buildFixtures} from '../noise-fixtures.mjs';

const fx = await buildFixtures();
const audoCalls = [];
const mock = async (url, opts) => {
  if (String(url).startsWith('https://audo.ai/')) { audoCalls.push(String(url)); return new Response(fx.clean_speech.wav, {status: 200, headers: {'Content-Type': 'audio/wav'}}); }
  throw new Error('unexpected outbound call ' + url);
};
async function start(enabled) {
  if (enabled) process.env.AUDO_ENABLED = '1'; else delete process.env.AUDO_ENABLED;
  const s = createServer({}, mock); await new Promise(r => s.listen(0, '127.0.0.1', r));
  return {s, base: `http://127.0.0.1:${s.address().port}`};
}
const dir = mkdtempSync(path.join(tmpdir(), 'voxa-audo-e2e-')), file = path.join(dir, 'street-call.wav');
writeFileSync(file, fx.speech_white_10dB.wav);
const browser = await chromium.launch();
let n = 0; const ok = m => console.log(`  ✓ ${++n}. ${m}`);
const errs = [];
async function page(base) {
  const p = await (await browser.newContext({viewport: {width: 1440, height: 1000}})).newPage();
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p.goto(base + '/login.html?demo=1'); await p.click('#demo'); await p.waitForURL('**/app.html**');
  await p.goto(base + '/app.html#/noise'); await p.waitForSelector('#nr-file', {state: 'attached'}); await p.waitForTimeout(500);
  return p;
}

// 1) server has Audo off: the option is not offered
{ const {s, base} = await start(false); const p = await page(base);
  assert.equal(await p.isVisible('#nr-enh'), false); ok('with AUDO_ENABLED unset, the Audo option is not shown');
  await p.context().close(); s.close(); }

// 2) server has Audo on
const {s, base} = await start(true); const p = await page(base);
assert.equal(await p.isVisible('#nr-enh'), true); assert.equal(await p.isChecked('input[name="nr-enh"][value="local"]'), true);
ok('with AUDO_ENABLED=1 the choice appears and Local is the default');
await p.check('input[name="nr-enh"][value="audo"]');
assert.equal(await p.isVisible('#nr-audo-box'), true); assert.match(await p.innerText('#nr-audo-box'), /audo\.ai/i); assert.match(await p.innerText('#nr-audo-box'), /first minute/i);
ok('choosing Audo shows the disclosure (who gets the audio, retention, free-tier limits)');
await p.setInputFiles('#nr-file', file); await p.waitForFunction(() => /street-call/.test(document.querySelector('#nr-info').textContent));
await p.check('#nr-consent'); await p.click('#nr-go');
assert.match(await p.innerText('#toast'), /Agree to the Audo AI upload/); assert.equal(audoCalls.length, 0);
ok('without the Audo consent box nothing is uploaded');
await p.check('#nr-audo-consent'); await p.click('#nr-go'); await p.waitForURL('**#/incident/**', {timeout: 90000});
assert.equal(audoCalls.length, 1);
const t = (await p.innerText('#view')).toLowerCase();
for (const must of ['audo ai remove-noise', 'in the cloud by audo ai', 'where the audio went', 'noise floor relative to speech', 'download enhanced audio']) assert.ok(t.includes(must), 'missing: ' + must);
ok('one upload; the report says the audio was processed in the cloud by Audo, with the gain-independent before/after row');
await p.screenshot({path: '../../crawl/audo-report.png', fullPage: true});
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : '\nno page errors');
await browser.close(); s.close(); rmSync(dir, {recursive: true, force: true}); process.exit(errs.length ? 1 : 0);
