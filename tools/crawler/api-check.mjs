import { chromium } from 'playwright';
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1440,height:1000}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto('http://127.0.0.1:5174/login.html?demo=1');await p.click('#demo');await p.waitForURL('**/app.html');await p.goto('http://127.0.0.1:5174/app.html#/analyze');
await p.click('[data-mod="image"]');
await p.setInputFiles('#a-file',{name:'fixture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
await p.waitForFunction(()=>!document.querySelector('#a-prev').hidden);
await p.route('**/api/analyze?*',r=>r.fulfill({json:{authenticity:{status:'ok',provider:'sealedrose',code:'AI_GENERATED',confidence:0.91,message:'Fixture provider result'},extraction:{status:'ok',text:'Please share your OTP immediately or your bank account will be blocked.'},context:null}}));
await p.check('#a-extract');await p.check('#a-consent');await p.click('#a-go');await p.waitForURL('**#/incident/**');
if(!(await p.locator('#view').innerText()).includes('91%'))throw Error('Missing confidence');
await p.goto('http://127.0.0.1:5174/app.html#/analyze');await p.screenshot({path:'crawl/api-analysis.png',fullPage:true});
await p.click('[data-mod="video"]');if(await p.locator('#a-provider').inputValue()!=='sealedrose')throw Error('Bad video provider');
console.log(JSON.stringify({browserErrors:errors,resultRendering:'passed',modalityControls:'passed'}));await b.close();if(errors.length)process.exitCode=1;


