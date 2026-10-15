import {chromium} from 'playwright';
const B = 'http://10.131.167.225:5175';
const b = await chromium.launch(); const p = await b.newPage({viewport: {width: 1300, height: 860}});
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160))); p.on('console', m => m.type() === 'error' && errs.push('console: ' + m.text().slice(0, 200)));
await p.goto(B + '/app.html'); await p.waitForTimeout(3000);
console.log('app.html (not signed in) ->', p.url().replace(B, ''));
await p.goto(B + '/login.html');
let rendered = true; try { await p.waitForSelector('input[name="identifier"]', {timeout: 25000}); } catch { rendered = false; }
console.log('Clerk sign-in rendered over the network address:', rendered);
console.log('secure context (needed for microphone):', await p.evaluate(() => window.isSecureContext));
const st = await (await fetch(B + '/api/status')).json();
console.log('status: auth', st.auth.authMode, '| database', st.database.configured, '| audo', st.tools.audo);
const r = await fetch(B + '/api/analyze?modality=voice&provider=auto', {method: 'POST', headers: {Origin: B, 'X-Voxa-Request': '1', 'Content-Type': 'audio/wav'}, body: 'x'});
console.log('analysis without sign-in over the network ->', r.status);
const evil = await fetch(B + '/api/status', {headers: {Host: 'evil.example'}}).then(x => x.status).catch(() => 'blocked');
console.log('request with a foreign Host header ->', evil);
await p.screenshot({path: '../../crawl/lan-login.png'});
console.log('errors:', errs.length ? errs : 'none'); await b.close();
