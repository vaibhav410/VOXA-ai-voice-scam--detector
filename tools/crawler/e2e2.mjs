import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('console', m => m.type() === 'error' && errs.push('console ' + m.text()));
const B = 'http://localhost:5173/';
await p.goto(B + 'login.html?demo=1'); await p.click('button.submit'); await p.waitForURL('**/app.html**');
const routes = ['dashboard','meetings','reports','investigator','agent-detection','chrome-extension','integrations','intelligence','signal','watermarking','team','api-keys','playground','voice-overview','tts','sts','stt','voices','voice-library','create-voice','projects','enhance','analyze','incidents','settings','profile'];
for (const r of routes) { await p.goto(B + 'app.html#/' + r); await p.waitForTimeout(120);
  const t = (await p.innerText('#view')).trim().length; const tabs = await p.locator('.tab.active').innerText();
  console.log(r.padEnd(18), 'chars', t, '| tab:', tabs.trim()); }
await p.goto(B + 'app.html#/analyze');
await p.fill('#a-text', 'Hello sir, this is the bank manager. Your account will be blocked. Please share the OTP immediately and do not tell anyone.');
await p.click('#a-go'); await p.waitForURL('**#/incident/**');
await p.goto(B + 'app.html#/reports'); console.log('report rows', await p.locator('tbody tr').count());
await p.click('tbody tr'); await p.waitForURL('**#/incident/**'); console.log('opened from report');
await p.goto(B + 'app.html#/integrations'); await p.fill('#int-q', 'zoom'); console.log('int search', await p.locator('.int').count());
await p.goto(B + 'app.html#/voice-library'); await p.click('[data-fav="Nova"]'); await p.click('[data-vt="fav"]'); console.log('favs', await p.locator('.vrow').count());
await p.goto(B + 'app.html#/projects'); await p.click('#np'); await p.fill('dialog input[name=name]', 'Test'); await p.click('dialog button[value=ok]'); await p.waitForTimeout(200); console.log('projects', await p.locator('.vcard').count());
for (const r of ['dashboard','reports','integrations','voice-library','enhance']) { await p.goto(B + 'app.html#/' + r); await p.waitForTimeout(150); await p.screenshot({ path: `../../crawl/c-${r}.png` }); }
console.log('ERRORS', errs); await b.close();
