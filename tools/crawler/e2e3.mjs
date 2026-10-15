import { chromium } from 'playwright';
const D='C:/Users/LENOVO/AppData/Local/Temp/claude/c--Users-LENOVO-VOXA/a103c4cb-62c6-4d87-ab0e-87bc24cf1d53/scratchpad/';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
const B='http://localhost:5173/';
await p.goto(B+'login.html?demo=1'); await p.click('button.submit'); await p.waitForURL('**/app.html**');
for (const [mod,file,txt] of [['voice','t.wav','Hello sir this is the bank manager please share your OTP immediately today'],['image','t.png','Your account will be blocked. Share OTP immediately and do not tell anyone.'],['video','t.png','']]) {
  await p.goto(B+'app.html#/analyze'); await p.click(`[data-mod="${mod}"]`);
  if (mod!=='video') { await p.setInputFiles('#a-file', D+file); await p.waitForTimeout(500); console.log(mod,'info:',await p.innerText('#a-info')); }
  else { await p.setInputFiles('#a-file', D+file); await p.waitForTimeout(300); console.log('video bad-format msg:', await p.innerText('#a-info')); }
  if (txt) await p.fill('#a-text', txt);
  else await p.fill('#a-text', 'x');
  await p.click('#a-go'); await p.waitForURL('**#/incident/**');
  const t=await p.innerText('#view'); console.log(mod,'->',/Authenticity/.exec(t)[0], '|', /HIGH|MEDIUM|LOW|NOT ENOUGH EVIDENCE/i.exec(t)[0]);
}
await p.goto(B+'app.html#/incidents'); console.log('rows',await p.locator('tbody tr').count());
await p.selectOption('#f-m','image'); console.log('image rows',await p.locator('tbody tr').count());
await p.screenshot({path:'../../crawl/m-incidents.png'});
await p.goto(B+'app.html#/analyze'); await p.click('[data-mod="image"]'); await p.screenshot({path:'../../crawl/m-image.png'});
console.log('ERRORS',errs); await b.close();
