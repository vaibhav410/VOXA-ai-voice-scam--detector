import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR '+e.message.slice(0,160)));
p.on('response',r=>r.status()>=400&&errs.push('HTTP '+r.status()+' '+r.url().replace(/https?:\/\/[^/]+/,'')));
const B=process.argv[2];
await p.goto(B+'/login.html?demo=1'); await p.click('#demo'); await p.waitForURL('**/app.html**');
for (const r of ['dashboard','analyze','incidents','settings','meetings']) { await p.goto(B+'/app.html#/'+r); await p.waitForTimeout(1500);
  console.log(r.padEnd(10),'chars',(await p.innerText('#view')).trim().length,'| nav',await p.locator('.nav').count()); }
await p.goto(B+'/app.html#/dashboard'); await p.waitForTimeout(1500); await p.screenshot({path:'../../crawl/public-dash.png'});
console.log('ERRORS',errs); await b.close();
