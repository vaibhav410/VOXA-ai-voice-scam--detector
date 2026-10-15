import {chromium} from 'playwright';
const B = process.argv[2] || 'http://127.0.0.1:5193';
const b = await chromium.launch(); const p = await b.newPage({viewport: {width: 1440, height: 900}});
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
await p.goto(B + '/app.html#/analyze'); await p.waitForTimeout(4000);
console.log('app.html without sign-in ->', p.url().replace(B, ''));
await p.goto(B + '/login.html'); 
try { await p.waitForSelector('#clerk-signin input, .cl-rootBox, .cl-signIn-root', {timeout: 20000}); console.log('Clerk sign-in rendered: yes'); }
catch { console.log('Clerk sign-in rendered: NO'); }
console.log('demo form visible:', await p.isVisible('#demo'));
console.log('identifier field present:', await p.locator('input[name="identifier"]').count() > 0);
await p.screenshot({path: '../../crawl/clerk-login.png'});
console.log('errors:', errs.length ? errs : 'none');
await b.close();
