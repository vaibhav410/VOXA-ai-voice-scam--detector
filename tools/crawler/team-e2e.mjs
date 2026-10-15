// Browser test for the Team Dashboard (demo identity + local PGlite database; never touches Supabase).
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

const PORT = 5199, B = `http://127.0.0.1:${PORT}`, ROOT = path.resolve('../..'), DIR = path.join(ROOT, 'data', 'e2e-team');
rmSync(DIR, {recursive: true, force: true});
const server = spawn(process.execPath, ['server.mjs'], {cwd: ROOT, stdio: 'ignore', env: {...process.env, AUTH_MODE: 'demo', DATABASE_URL: '', VOXA_DB: 'pglite', VOXA_PGLITE_DIR: DIR, PORT: String(PORT)}});
for (let i = 0; i < 240; i++) { try { if ((await fetch(B + '/api/auth/config')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
const browser = await chromium.launch(), p = await (await browser.newContext({viewport: {width: 1440, height: 1000}})).newPage();
const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('response', r => { if (r.status() >= 500) errs.push('HTTP ' + r.status() + ' ' + r.url()); });
let n = 0; const ok = m => console.log(`  ✓ ${++n}. ${m}`);
try {
  await p.goto(B + '/login.html?demo=1'); await p.click('#demo'); await p.waitForURL('**/app.html**');
  await p.goto(B + '/app.html#/team'); await p.waitForSelector('#t-new');
  assert.equal(await p.inputValue('#t-name'), 'demo@voxa.local'); ok('empty state offers "Create your team", prefilled with your email');
  await p.click('#t-new button'); await p.waitForSelector('.td-stats');
  const tiles = await p.$$eval('.td-stats .td-tile span', e => e.map(x => x.innerText));
  assert.deepEqual(tiles, ['Reports shared', 'High-priority reports', 'Audio analyzed', 'Team members']);
  assert.match(await p.innerText('.td-bar'), /Team: demo@voxa\.local/); assert.match(await p.innerText('.td-bar'), /Free \(no billing\)/);
  assert.match(await p.innerText('.td-members'), /demo@voxa\.local/);
  ok('dashboard: team header, 4 usage tiles, members list with you as Admin');
  await p.screenshot({path: '../../crawl/team-dashboard.png', fullPage: true});

  await p.click('#td-rename'); await p.fill('#td-n', 'Fraud desk'); await p.click('#td-ok'); await p.waitForFunction(() => /Fraud desk/.test(document.querySelector('.td-bar')?.innerText || ''));
  ok('Edit team name works');
  await p.click('#td-add'); await p.fill('#td-email', 'colleague@example.com'); await p.click('#td-ok'); await p.waitForSelector('#td-link input');
  assert.match(await p.inputValue('#td-link input'), /#\/invite\/[A-Za-z0-9_-]{20,}/); await p.click('#td-form button[value="cancel"]');
  await p.goto(B + '/app.html#/call-safety'); await p.goto(B + '/app.html#/team'); await p.waitForSelector('.td-stats');
  assert.match(await p.innerText('.td-stats'), /1 pending invite/); ok('Add member creates a one-time invite link; pending invite counted');

  await p.selectOption('#t-share', {label: 'Fraud desk'});
  await p.goto(B + '/app.html#/privacy'); await p.fill('#pv-text', 'Call +91 98765 43210, OTP 482913.'); await p.check('#pv-consent'); await p.click('#pv-go'); await p.waitForSelector('#pv-save'); await p.click('#pv-save'); await p.waitForURL('**#/incident/**'); await p.waitForTimeout(1500);
  await p.goto(B + '/app.html#/team'); await p.waitForSelector('.td-types');
  const t = await p.innerText('.td-grid');
  assert.match(t, /Reports shared\s*1/); assert.match(t, /Privacy scans\s*1/); ok('a report shared with the team shows in "Reports shared" and "Reports by type"');
  await p.setViewportSize({width: 420, height: 900}); await p.waitForTimeout(300);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false); ok('phone width: no horizontal overflow');
} finally {
  console.log(errs.length ? '\nERRORS:\n' + errs.join('\n') : '\nno page errors, no server errors');
  await browser.close(); server.kill(); await new Promise(r => setTimeout(r, 500)); rmSync(DIR, {recursive: true, force: true});
}
process.exit(errs.length ? 1 : 0);
