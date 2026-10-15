import {chromium} from 'playwright';
const B = 'http://127.0.0.1:5198', b = await chromium.launch(), p = await b.newPage({viewport: {width: 1440, height: 1000}});
const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => m.type() === 'error' && errs.push('console ' + m.text().slice(0, 200)));
p.on('response', r => r.status() >= 400 && errs.push('HTTP ' + r.status() + ' ' + r.url().replace(B, '')));
await p.goto(B + '/login.html?demo=1'); await p.click('#demo'); await p.waitForURL('**/app.html**');
for (const r of ['intelligence', 'signal', 'watermarking']) { await p.goto(B + '/app.html#/' + r); await p.waitForTimeout(1500); await p.screenshot({path: `../../crawl/page-${r}.png`, fullPage: true}); console.log(r, '| chars', (await p.innerText('#view')).length, '|', (await p.innerText('#view')).slice(0, 160).replace(/\n/g, ' / ')); }
console.log('errors:', errs.length ? errs : 'none'); await b.close();
