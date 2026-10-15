import {chromium} from 'playwright';
const b=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});const ctx=await b.newContext({permissions:['microphone']});const p=await ctx.newPage({viewport:{width:1440,height:1000}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto('http://127.0.0.1:5174/login.html?demo=1');await p.click('#demo');await p.waitForURL('**/app.html');await p.locator('h1').filter({hasText:'Welcome to VOXA'}).waitFor();
if(await p.locator('a[href="#/create-voice"]').count())throw Error('Removed page still linked');await p.goto('http://127.0.0.1:5174/app.html#/create-voice');await p.waitForURL('**#/analyze');
await p.click('#a-rec');if(!await p.locator('#toast').innerText().then(t=>t.includes('consent')))throw Error('No consent gate');
let socket;await p.routeWebSocket('**/api/live',route=>{socket=route;route.send(JSON.stringify({type:'ready'}));route.onMessage(m=>{if(typeof m==='string'&&m.includes('stop'))route.close();});});
await p.goto('http://127.0.0.1:5174/app.html#/live');await p.check('#live-consent');await p.click('#live-start');await p.waitForFunction(()=>document.querySelector('#live-state').textContent.includes('Microphone on'));
const lines=['Main bank se bol raha hoon. Aapka account block ho jayega. OTP abhi batao please.','I am a police officer. You are under digital arrest. Transfer money immediately.','Download AnyDesk and share your screen immediately.'];
for(let j=0;j<lines.length;j++){socket.send(JSON.stringify({type:'transcript',text:lines[j],final:true,start:j*5,duration:5}));await p.waitForTimeout(100);}
await p.locator('#live-warning').waitFor({state:'visible'});if(await p.locator('#live-events .ev').count()<2)throw Error('Missing streaming alerts');
await p.screenshot({path:'crawl/live-monitor.png',fullPage:true});await p.click('#live-stop');await p.waitForFunction(()=>!document.querySelector('#live-save').disabled);await p.click('#live-save');await p.waitForURL('**#/incident/**');if(!await p.locator('.transcript-body').innerText().then(t=>t.includes('OTP')))throw Error('Live transcript not saved');
if(await p.evaluate(()=>JSON.parse(localStorage.getItem('voxa:incidents')||'[]').length)!==0)throw Error('Private session persisted');
await p.goto('http://127.0.0.1:5174/app.html#/call-safety');if(await p.locator('.alert-history-row').count()<2)throw Error('No alert history');await p.screenshot({path:'crawl/call-safety-dashboard.png',fullPage:true});
await p.goto('http://127.0.0.1:5174/app.html#/evaluation');await p.click('#eval-run');await p.locator('#eval-result table').waitFor();if(await p.locator('#eval-result tbody tr').count()!==18)throw Error('Missing scenarios');await p.screenshot({path:'crawl/scenario-evaluation.png',fullPage:true});
await p.setViewportSize({width:390,height:844});await p.waitForTimeout(100);if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
console.log(JSON.stringify({removedPage:'passed',consent:'passed',streamedAlerts:'passed',sessionPrivacy:'passed',dashboard:'passed',evaluation:'passed',errors}));await b.close();if(errors.length)process.exitCode=1;
