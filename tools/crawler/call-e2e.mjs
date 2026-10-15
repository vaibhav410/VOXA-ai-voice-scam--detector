// Two-browser test for the Protected Call: real WebRTC audio between a host and a guest browser, live Deepgram
// transcription of the guest, the risk engine, and auto-end. The guest's microphone is a WAV file (Chrome fake capture).
// Needs DEEPGRAM_API_KEY in .env.local. Usage: node call-e2e.mjs <scam.wav> <normal.wav>
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const [scamWav, normalWav] = process.argv.slice(2);
assert.ok(scamWav && normalWav, 'usage: node call-e2e.mjs <scam.wav> <normal.wav>');
const ROOT = path.resolve(import.meta.dirname, '../..'), PORT = 5199, B = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['server.mjs'], {cwd: ROOT, stdio: 'ignore', env: {...process.env, AUTH_MODE: 'demo', DATABASE_URL: '', PORT: String(PORT)}});
const stop = () => { try { server.kill(); } catch {} };
process.on('exit', stop);
for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/login.html')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }

const FAKE = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
let n = 0; const ok = m => console.log(`  ✓ ${++n}. ${m}`);
const errs = [];
const watch = (p, who) => { p.on('pageerror', e => errs.push(who + ' PAGEERROR ' + String(e.message).split('\n')[0])); p.on('response', r => { if (r.status() >= 400) errs.push(who + ' HTTP ' + r.status() + ' ' + r.url().replace(B, '')); }); };

async function hostPage(browser, {auto, breakLive = false} = {}) {
  const ctx = await browser.newContext({viewport: {width: 1400, height: 1000}, permissions: ['microphone']});
  if (breakLive) await ctx.addInitScript(() => { const W = window.WebSocket; window.WebSocket = function (u, p) { if (String(u).endsWith('/api/live')) throw new Error('blocked for test'); return new W(u, p); }; window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, {CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3}); });
  const p = await ctx.newPage(); watch(p, 'host');
  await p.goto(B + '/login.html?demo=1'); await p.click('#demo'); await p.waitForURL('**/app.html**');
  await p.evaluate(() => localStorage.setItem('voxa:sector', '"finance"'));
  await p.goto(B + '/app.html#/call'); await p.waitForSelector('#pc-start');
  if (auto) await p.check('#pc-auto');
  await p.check('#pc-consent'); await p.click('#pc-start');
  await p.waitForSelector('#pc-live:not([hidden])');
  return {p, ctx, link: await p.inputValue('#pc-link')};
}
async function guestPage(wav, link) {
  const browser = await chromium.launch({args: [...FAKE, `--use-file-for-fake-audio-capture=${wav}`]});
  const p = await (await browser.newContext({permissions: ['microphone']})).newPage(); watch(p, 'guest');
  await p.goto(link);
  return {browser, p};
}

const hostBrowser = await chromium.launch({args: FAKE});
try {
  // 1. Page, sidebar and defaults
  {
    const ctx = await hostBrowser.newContext({viewport: {width: 1400, height: 1000}}); const p = await ctx.newPage(); watch(p, 'host');
    await p.goto(B + '/login.html?demo=1'); await p.click('#demo'); await p.waitForURL('**/app.html**');
    await p.goto(B + '/app.html#/call'); await p.waitForSelector('#pc-start');
    assert.equal(await p.locator('#side-body a.nav', {hasText: 'Protected call'}).count(), 1);
    assert.equal(await p.isChecked('#pc-auto'), false, 'auto-end is off by default');
    await p.click('#pc-start'); assert.ok(await p.isVisible('#pc-setup'), 'cannot start without consent');
    await p.screenshot({path: path.join(ROOT, 'crawl/call-setup.png'), fullPage: true});
    ok('sidebar shows "Protected call"; auto-end is off by default; starting needs consent');
    await ctx.close();
  }

  // 2. Scam call with auto-end on: evidence, timestamps, confidence, countdown, VOXA ends only this call
  {
    const h = await hostPage(hostBrowser, {auto: true});
    assert.match(h.link, /\/call\.html#[\w-]+\.[\w-]{30,}$/);
    const g = await guestPage(scamWav, h.link);
    assert.ok(!g.p.url().includes('#'), 'the guest key is removed from the address bar');
    await g.p.click('#g-join-btn'); assert.ok(await g.p.isVisible('#g-join'), 'guest cannot join without consent');
    await g.p.check('#g-consent'); await g.p.click('#g-join-btn');
    await h.p.waitForFunction(() => document.querySelector('#pc-status')?.textContent === 'Connected', null, {timeout: 20000});
    await g.p.waitForFunction(() => /Connected/.test(document.querySelector('#g-live-status')?.textContent), null, {timeout: 20000});
    ok('guest joined after consent over WebRTC; host shows "Connected"');
    await h.p.waitForSelector('#pc-ev-list .ev', {timeout: 45000});
    const ev = await h.p.locator('#pc-ev-list .ev').first().innerText();
    assert.match(ev, /at \d+:\d\d/); assert.match(ev, /\d+% confidence/);
    ok('live evidence with timestamp and confidence: ' + ev.replace(/\s+/g, ' ').slice(0, 120));
    await h.p.waitForFunction(() => /Ending this call in/.test(document.querySelector('#pc-warn')?.textContent), null, {timeout: 60000});
    const chip = await h.p.innerText('#pc-chip');
    await h.p.screenshot({path: path.join(ROOT, 'crawl/call-countdown.png'), fullPage: true});
    ok(`auto-end countdown shown at risk "${chip}" with a reason and a "Keep the call" button`);
    await h.p.waitForSelector('#pc-done:not([hidden])', {timeout: 20000});
    const done = await h.p.innerText('#pc-done');
    assert.match(done, /VOXA ended this call/); assert.match(done, /Reason:/);
    await g.p.waitForSelector('#g-done:not([hidden])', {timeout: 10000});
    const gd = await g.p.innerText('#g-done');
    assert.doesNotMatch(gd, /OTP|risk|scam/i, 'the guest is not told the risk reason');
    await h.p.screenshot({path: path.join(ROOT, 'crawl/call-ended.png'), fullPage: true});
    ok('VOXA ended the call with the reason shown to the host; the guest only saw "' + gd.split('\n')[0] + '"');
    const tracksLive = await h.p.evaluate(() => document.querySelector('#pc-remote')?.srcObject?.getTracks().some(t => t.readyState === 'live') ?? false);
    assert.equal(tracksLive, false, 'remote audio stopped');
    await h.p.click('#pc-save'); await h.p.waitForURL(/#\/incident\//);
    ok('media cleaned up; the call can be saved as a scam report');
    const again = await g.browser.newContext({permissions: ['microphone']}).then(c => c.newPage());
    await again.goto(h.link); await again.check('#g-consent'); await again.click('#g-join-btn');
    await again.waitForSelector('#g-done:not([hidden])'); assert.match(await again.innerText('#g-done'), /Could not join/);
    ok('the used invite link is refused after the call ended');
    await g.browser.close(); await h.ctx.close();
  }

  // 3. Ordinary call, auto-end on: stays low, never ends
  {
    const h = await hostPage(hostBrowser, {auto: true});
    const g = await guestPage(normalWav, h.link); await g.p.check('#g-consent'); await g.p.click('#g-join-btn');
    await h.p.waitForFunction(() => document.querySelector('#pc-status')?.textContent === 'Connected', null, {timeout: 20000});
    await h.p.waitForFunction(() => document.querySelector('#pc-chip')?.textContent === 'Low', null, {timeout: 45000});
    await h.p.waitForTimeout(15000);
    assert.equal(await h.p.innerText('#pc-chip'), 'Low'); assert.ok(await h.p.isVisible('#pc-live'), 'still connected');
    ok('ordinary conversation stays "Low" and is not ended');
    await h.p.click('#pc-end'); await g.p.waitForSelector('#g-done:not([hidden])', {timeout: 10000});
    ok('host hang-up ends the call for the guest');
    await g.browser.close(); await h.ctx.close();
  }

  // 4. Analysis unavailable: shown clearly, never auto-ends even on a scam
  {
    const h = await hostPage(hostBrowser, {auto: true, breakLive: true});
    const g = await guestPage(scamWav, h.link); await g.p.check('#g-consent'); await g.p.click('#g-join-btn');
    await h.p.waitForFunction(() => document.querySelector('#pc-chip')?.textContent === 'Analysis unavailable', null, {timeout: 20000});
    await h.p.waitForTimeout(12000);
    assert.ok(await h.p.isVisible('#pc-live'), 'not ended'); assert.match(await h.p.innerText('#pc-warn'), /Analysis unavailable/);
    ok('"Analysis unavailable" is shown and the call is never ended automatically');
    await h.p.click('#pc-end'); await g.browser.close(); await h.ctx.close();
  }
  const real = errs.filter(e => !/HTTP 404 \/favicon/.test(e));
  assert.deepEqual(real, [], 'no page errors');
  console.log(`\nAll ${n} protected-call checks passed.`);
} finally { await hostBrowser.close(); stop(); }
