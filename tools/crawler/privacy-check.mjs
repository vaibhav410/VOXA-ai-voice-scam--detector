import {chromium} from 'playwright';
const b=await chromium.launch();const p=await b.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto('http://127.0.0.1:5174/login.html?demo=1');await p.click('#demo');await p.waitForURL('**/app.html');await p.goto('http://127.0.0.1:5174/app.html#/analyze');await p.fill('#a-text','Share your OTP immediately and do not tell anyone about this call.');await p.check('#a-retain');await p.click('#a-go');await p.waitForURL('**#/incident/**');
if(await p.evaluate(()=>JSON.parse(localStorage.getItem('voxa:incidents')).length)!==1)throw Error('24-hour report not retained');
await p.evaluate(()=>{const a=JSON.parse(localStorage.getItem('voxa:incidents'));a[0].expiresAt=Date.now()-1;localStorage.setItem('voxa:incidents',JSON.stringify(a));});await p.goto('http://127.0.0.1:5174/app.html#/dashboard');await p.locator('h1').filter({hasText:'Call safety dashboard'}).waitFor();
if(await p.evaluate(()=>JSON.parse(localStorage.getItem('voxa:incidents')).length)!==0)throw Error('Expired report retained');
await p.goto('http://127.0.0.1:5174/app.html#/settings');await p.click('#s-wipe');await p.click('#s-wipe');for(const k of ['incidents','alerts'])if(await p.evaluate(k=>localStorage.getItem('voxa:'+k)||sessionStorage.getItem('voxa:'+k),k))throw Error('Deletion failed '+k);
await p.setViewportSize({width:390,height:844});await p.goto('http://127.0.0.1:5174/app.html#/live');if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile live overflow');await p.screenshot({path:'crawl/live-monitor-mobile.png',fullPage:true});
console.log(JSON.stringify({retentionOptIn:'passed',expiryPurge:'passed',deleteAll:'passed',mobileLive:'passed',errors}));await b.close();if(errors.length)process.exitCode=1;
