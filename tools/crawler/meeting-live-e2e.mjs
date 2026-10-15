// Browser test for Meetings → Protect live. A local page titled VOXA-TEST-MEETING stands in for the Google Meet tab and
// plays the other participant's audio; Chrome auto-picks it in the tab-share prompt. Real Deepgram transcription.
// Usage: node meeting-live-e2e.mjs <scam.wav> <normal.wav>
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const [scamWav, normalWav] = process.argv.slice(2);
assert.ok(scamWav && normalWav, 'usage: node meeting-live-e2e.mjs <scam.wav> <normal.wav>');
const ROOT = path.resolve(import.meta.dirname, '../..'), PORT = 5198, B = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['server.mjs'], {cwd: ROOT, stdio: 'ignore', env: {...process.env, AUTH_MODE: 'demo', DATABASE_URL: '', PORT: String(PORT)}});
process.on('exit', () => { try { server.kill(); } catch {} });
for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/login.html')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }

let n = 0; const ok = m => console.log(`  ✓ ${++n}. ${m}`);
const errs = [];
// Headed: headless Chrome cannot render tab audio, so tab capture would be silent.
const browser = await chromium.launch({headless: false, ignoreDefaultArgs: ['--mute-audio'], args: ['--auto-select-tab-capture-source-by-title=VOXA-TEST-MEETING', '--autoplay-policy=no-user-gesture-required']});
const ctx = await browser.newContext({viewport: {width: 1400, height: 1000}});
const fakeMeeting = async (wav, loop) => {
  const p = await ctx.newPage();
  await p.route('http://fake-meeting.test/', r => r.fulfill({contentType: 'text/html', body: `<title>VOXA-TEST-MEETING</title><audio id=a ${loop ? 'loop' : ''} src="data:audio/wav;base64,${readFileSync(wav).toString('base64')}"></audio>`}));
  await p.goto('http://fake-meeting.test/'); await p.evaluate(() => document.getElementById('a').play());
  return p;
};
const app = await ctx.newPage();
app.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
app.on('response', r => { if (r.status() >= 400 && r.url().startsWith(B)) errs.push('HTTP ' + r.status() + ' ' + r.url().replace(B, '')); });
await app.goto(B + '/login.html?demo=1'); await app.click('#demo'); await app.waitForURL('**/app.html**');
await app.evaluate(() => localStorage.setItem('voxa:sector', '"finance"'));
const startMeeting = async title => {
  await app.goto(B + '/app.html#/meetings'); await app.waitForSelector('#mm-start, #mtg-start'); await app.click(await app.$('#mm-start') ? '#mm-start' : '#mtg-start');
  await app.fill('#sm-url', 'https://meet.google.com/abc-defg-hij');
  const [meetTab] = await Promise.all([ctx.waitForEvent('page'), app.click('.sm-backdrop .sm-btn.go')]);
  await app.bringToFront(); await app.goto(B + '/app.html#/meetings'); await app.waitForSelector('[data-act="recdev"]');
  return meetTab;
};
try {
  // 1. Scam meeting: live risk, auto-leave closes the meeting tab VOXA opened, report with spectrogram
  const meetTab = await startMeeting('Vendor call');
  const other = await fakeMeeting(scamWav, true); await app.bringToFront();
  await app.click('[data-act="recdev"]');
  assert.equal(await app.isChecked('#rd-live'), true); assert.equal(await app.isChecked('#rd-auto'), true);
  assert.equal(await app.isChecked('#rd-leave'), false, 'auto-leave is off by default'); assert.equal(await app.isDisabled('#rd-leave'), false, 'available: VOXA opened the meeting tab');
  assert.equal(await app.isDisabled('.sm-backdrop .sm-btn.go'), true, 'consent required');
  await app.check('#rd-leave'); await app.check('#rd-consent'); await app.click('.sm-backdrop .sm-btn.go');
  await app.waitForSelector('.mm-live .pc-chip', {timeout: 15000});
  ok('Protect live started from the meeting card: live, auto-stop on; auto-leave opt-in; consent required');
  try { await app.waitForSelector('.mm-live-ev li', {timeout: 45000}); }
  catch (e) {
    console.log('PANEL:', await app.innerText('.mm-live').catch(() => '-'), 'AUDIO:', JSON.stringify(await other.evaluate(() => { const a = document.getElementById('a'); return {paused: a.paused, t: a.currentTime, err: a.error?.code}; }))); throw e; }
  ok('live evidence on the meeting card: ' + (await app.locator('.mm-live-ev li').first().innerText()).replace(/\s+/g, ' ').slice(0, 110));
  await app.waitForFunction(() => /Leaving the meeting in/.test(document.querySelector('.mm-live')?.textContent || ''), null, {timeout: 60000});
  await app.screenshot({path: path.join(ROOT, 'crawl/meeting-live-countdown.png'), fullPage: true});
  ok('auto-leave countdown with reason and "Stay in the meeting"');
  await app.waitForSelector('.sm-backdrop #rd-report', {timeout: 20000});
  if (!meetTab.isClosed()) await meetTab.waitForEvent('close', {timeout: 5000});
  assert.equal(meetTab.isClosed(), true, 'VOXA closed the meeting tab it opened');
  assert.match(await app.innerText('.sm-backdrop'), /VOXA left the meeting/);
  ok('VOXA closed the Meet tab (left the call) and the ended dialog offers the report');
  await app.click('#rd-report'); await app.waitForSelector('.mr-rec');
  const rep = await app.innerText('#view');
  assert.match(rep, /Live risk: (critical|high)/i); assert.match(rep, /VOXA left the meeting/); assert.match(rep, /Risk factors/);
  await app.waitForSelector('[data-spec]:not([hidden])', {timeout: 20000});
  await app.screenshot({path: path.join(ROOT, 'crawl/meeting-live-report.png'), fullPage: true});
  ok('meeting report: live risk, auto-leave in the timeline, risk factors, highlighted conversation, waveform and spectrogram');
  await other.close();

  // 2. Ordinary meeting that goes silent: auto-stops by itself, Low risk report
  await startMeeting('Team sync');
  const quiet = await fakeMeeting(normalWav, false); await app.bringToFront();
  await app.click('[data-act="recdev"]'); await app.check('#rd-consent'); await app.click('.sm-backdrop .sm-btn.go');
  await app.waitForSelector('.mm-live .pc-chip', {timeout: 15000});
  await app.waitForFunction(() => /No meeting audio for/.test(document.querySelector('.mm-live')?.textContent || ''), null, {timeout: 120000});
  ok('silence after the meeting audio stops triggers the "meeting seems to have ended" warning');
  await app.waitForSelector('.sm-backdrop #rd-report', {timeout: 20000});
  assert.match(await app.innerText('.sm-backdrop'), /meeting audio went silent/);
  await app.click('#rd-report'); await app.waitForSelector('.mr-rec');
  assert.match(await app.innerText('#view'), /Live risk: low/i);
  ok('VOXA stopped by itself and the report shows Low risk');
  await quiet.close();
  assert.deepEqual(errs, [], 'no page errors');
  console.log(`\nAll ${n} meeting live-protection checks passed.`);
} finally { await browser.close(); server.kill(); }
