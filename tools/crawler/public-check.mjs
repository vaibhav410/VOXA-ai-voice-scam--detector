import {chromium} from 'playwright';
const B = process.argv[2];
const b = await chromium.launch(); const p = await b.newPage({viewport: {width: 1300, height: 860}});
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
p.on('response', r => { if (r.status() >= 400 && r.url().startsWith(B) && !/\/api\/(auth\/me|status)/.test(r.url())) errs.push(`HTTP ${r.status()} ${r.url().replace(B, '')}`); });
await p.goto(B + '/'); console.log('landing page:', (await p.title()).slice(0, 60));
await p.goto(B + '/app.html'); await p.waitForTimeout(4000); console.log('app without sign-in ->', p.url().replace(B, ''));
await p.goto(B + '/login.html');
let ok = true; try { await p.waitForSelector('input[name="identifier"]', {timeout: 30000}); } catch { ok = false; }
console.log('Clerk sign-in rendered:', ok, '| secure context (microphone allowed):', await p.evaluate(() => window.isSecureContext));
const st = await (await fetch(B + '/api/status')).json();
console.log('status: auth', st.auth.authMode, '| database configured', st.database.configured, 'reachable', st.database.reachable, 'schema current', st.database.schemaCurrent, '| ffmpeg', st.tools.ffmpeg, '| audo', st.tools.audo);
const H = {Origin: B, 'X-Voxa-Request': '1'};
for (const [m, path, ct] of [['POST', '/api/analyze?modality=voice&provider=auto', 'audio/wav'], ['POST', '/api/noise', 'audio/wav'], ['GET', '/api/reports'], ['GET', '/api/admin/audit-events'], ['POST', '/api/privacy/scan', 'application/json']])
  console.log(`  ${m} ${path.padEnd(42)} without sign-in ->`, (await fetch(B + path, {method: m, headers: {...H, ...(ct ? {'Content-Type': ct} : {})}, body: m === 'POST' ? 'x' : undefined})).status);
for (const f of ['/.env.local', '/css/.env.local', '/server.mjs', '/certs/supabase-prod-ca-2021.crt', '/supabase/migrations/20261015120000_voxa_core.sql', '/package.json'])
  console.log(`  ${f.padEnd(52)} ->`, (await fetch(B + f)).status);
await p.screenshot({path: '../../crawl/public-login.png'});
console.log('page errors / failed assets:', errs.length ? errs : 'none'); await b.close();
