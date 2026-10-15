import {chromium} from 'playwright';
const B = 'http://127.0.0.1:5198', b = await chromium.launch(), errs = [];
for (const [w, h] of [[1440, 1000], [900, 1000], [420, 900]]) {
  const p = await b.newPage({viewport: {width: w, height: h}}); p.on('pageerror', e => errs.push(e.message));
  await p.goto(B + '/login.html?demo=1'); await p.click('#demo'); await p.waitForURL('**/app.html**'); await p.goto(B + '/app.html#/call-safety'); await p.waitForTimeout(1500);
  const q = await p.$$eval('.mt-quick .mt-q', els => els.map(e => { const r = e.getBoundingClientRect(); return {t: e.querySelector('b').innerText, x: Math.round(r.x), w: Math.round(r.width)}; }));
  const live = await p.$eval('.mt-row.r-1 .mt-card h2', e => { const s = e.closest('.mt-card').getBoundingClientRect(), row = e.closest('.mt-row').getBoundingClientRect(); return {title: e.innerText, cardW: Math.round(s.width), rowW: Math.round(row.width)}; }).catch(() => null);
  console.log(`${w}px quick cards:`, q.map(x => `${x.t}(${x.w}px)`).join(' | '), '| live card fills row:', live && live.cardW === live.rowW, '| text has "Service status":', (await p.innerText('#view')).includes('Service status'));
  await p.screenshot({path: `../../crawl/dash-${w}.png`, fullPage: false});
}
console.log('page errors:', errs.length ? errs : 'none'); await b.close();
