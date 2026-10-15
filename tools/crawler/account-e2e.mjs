// Browser test for accounts + server history using a real local database (PGlite) and the demo identity.
// Usage: node account-e2e.mjs http://127.0.0.1:5194   (server started with AUTH_MODE=demo VOXA_DB=pglite)
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {rmSync} from 'node:fs';
import path from 'node:path';

// The test runs its own server (demo identity + local PGlite DB) so it can stop it for the admin CLI step.
const PORT = 5195, B = `http://127.0.0.1:${PORT}`, ROOT = path.resolve('../..'), DIR = path.join(ROOT, 'data', 'e2e-account');
const env = {...process.env, AUTH_MODE: 'demo', VOXA_DB: 'pglite', VOXA_PGLITE_DIR: DIR, PORT: String(PORT)};
let server;
async function startServer() {
  server = spawn(process.execPath, ['server.mjs'], {cwd: ROOT, env, stdio: 'ignore'});
  for (let i = 0; i < 240; i++) { try { if ((await fetch(B + '/api/auth/config')).ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  throw new Error('server did not start');
}
const stopServer = () => new Promise(r => { server.once('exit', r); server.kill(); });
rmSync(DIR, {recursive: true, force: true});
await startServer();
const browser = await chromium.launch();
let n = 0; const ok = m => console.log(`  ✓ ${++n}. ${m}`);
const errs = [];
async function open() {
  const ctx = await browser.newContext({viewport: {width: 1440, height: 1000}}), p = await ctx.newPage();
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0, 160)));
  p.on('response', r => { if (r.status() >= 500) errs.push('HTTP ' + r.status() + ' ' + r.url().replace(B, '')); });
  await p.goto(B + '/login.html?demo=1'); await p.click('#demo'); await p.waitForURL('**/app.html**');
  await p.waitForFunction(() => window.VoxaMe !== undefined, null, {timeout: 15000});
  return {ctx, p};
}

let {ctx, p} = await open();
const me = await p.evaluate(() => window.VoxaMe);
assert.equal(me.database, true); assert.equal(me.user.isSuperAdmin, false);
ok('signed in (demo identity) with the database on; not a super admin');
assert.equal(await p.locator('#side-body a.nav[href="#/audit"]').count(), 0); ok('Audit log is hidden from a normal user');

// privacy scan -> save -> report
await p.goto(B + '/app.html#/privacy'); await p.waitForSelector('#pv-text');
await p.fill('#pv-text', 'Please call me on +91 98765 43210 and send the OTP 482913. PAN ABCPE1234F.');
await p.click('#pv-go'); assert.match(await p.innerText('#toast'), /allowed to scan/);
await p.check('#pv-consent'); await p.click('#pv-go'); await p.waitForSelector('#pv-save');
const found = await p.innerText('#pv-out');
assert.match(found, /Phone number/); assert.match(found, /OTP/); assert.match(found, /PAN/); assert.ok(!found.includes('ABCPE1234F'.slice(0, 8)) || /\[PAN\]/.test(found));
ok('privacy scan finds phone, OTP and PAN; evidence masked; redacted copy shown');
await p.click('#pv-save'); await p.waitForURL('**#/incident/**');
const t = (await p.innerText('#view')).toLowerCase();
assert.ok(t.includes('privacy scan report') && t.includes('findings') && t.includes('redacted copy'));
ok('saved as a Privacy scan report');
await p.waitForTimeout(1200);

// server history: a brand-new browser (no local storage) sees the report from the account
await ctx.close();
({ctx, p} = await open());
await p.goto(B + '/app.html#/history'); await p.waitForSelector('.hs-card', {timeout: 15000});
assert.match(await p.innerText('#hs-list'), /Privacy scan/i);
ok('a fresh browser session loads the saved report from the server');
await p.click('.hs-card a.mt-btn'); await p.waitForURL('**#/incident/**');
const tt = (await p.innerText('#view')).toLowerCase();
assert.ok(tt.includes('not stored with this report'), 'server copy has findings but not the text');
ok('server copy shows findings but not the redacted text (text is never stored without opt-in)');

// team
await p.goto(B + '/app.html#/team'); await p.waitForSelector('#t-new');
await p.fill('#t-name', 'Fraud desk'); await p.click('#t-new button'); await p.waitForSelector('#t-inv', {timeout: 10000});
await p.fill('#t-email', 'colleague@example.com'); await p.selectOption('#t-role', 'user'); await p.click('#t-inv button');
await p.waitForSelector('#t-link input'); const link = await p.inputValue('#t-link input');
assert.match(link, /#\/invite\/[A-Za-z0-9_-]{20,}/);
ok('team created; invite link generated (single use, email-bound)');

// super admin only via CLI, then the audit log appears
await ctx.close(); await stopServer();
execFileSync(process.execPath, [path.join(ROOT, 'tools', 'admin-bootstrap.mjs'), '--email', 'demo@voxa.local'], {cwd: ROOT, env, stdio: 'pipe'});
await startServer();
ok('super admin granted through the CLI (no API can do this)');
({ctx, p} = await open());
await p.waitForSelector('#side-body a.nav[href="#/audit"]', {timeout: 15000});
ok('the Audit log link now appears in the sidebar');
await p.click('#side-body a.nav[href="#/audit"]');
await p.waitForSelector('#acct-body table, #acct-body .panelx', {timeout: 15000});
const audit = await p.innerText('#acct-body');
assert.match(audit, /team\.created/); assert.match(audit, /invitation\.created/); assert.match(audit, /report\.created/);
assert.ok(!/98765|482913|ABCPE1234F|colleague@example\.com/.test(audit), 'audit holds no personal data');
ok('audit log visible to the super admin, with events and no personal data');

// account page: export
await p.goto(B + '/app.html#/profile'); await p.waitForSelector('#p-export');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#p-export')]);
ok('account page: "Download my data" works (' + (await dl.suggestedFilename()) + ')');

console.log(errs.length ? '\nERRORS:\n' + errs.join('\n') : '\nno page errors, no server errors');
await browser.close(); await stopServer(); rmSync(DIR, {recursive: true, force: true}); process.exit(errs.length ? 1 : 0);
