import { chromium } from 'playwright';
const D='C:/Users/LENOVO/AppData/Local/Temp/claude/c--Users-LENOVO-VOXA/a103c4cb-62c6-4d87-ab0e-87bc24cf1d53/scratchpad/';
const B=process.argv[2];
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR '+String(e.stack||e.message).split(String.fromCharCode(10)).slice(0,3).join(' | ').slice(0,300)));
p.on('response',r=>r.status()>=400&&!r.url().includes('/api/')&&errs.push('HTTP '+r.status()+' '+r.url().replace(/https?:\/\/[^/]+/,'')));
await p.goto(B+'/login.html?demo=1'); await p.click('#demo'); await p.waitForURL('**/app.html**');
const now=Date.now(), H=3600000;
const mk=(id,at,o)=>({id,at,sector:'finance',policyVersion:'finance-1.0.0',status:'open',notes:[],tags:[],expiresAt:now+86400000,persist:false,authenticity:{status:'unavailable',code:'MODEL_NOT_CONNECTED',message:'No detector configured.'},context:{status:'unavailable'},limitations:'Decision support only.',intent:{status:'ok',score:0,rules:[],words:0},priority:'low',...o});
const rows=[
 mk('INC-VID1',now-2*60000,{modality:'video',priority:'high',media:{name:'ceo-call.webm',size:900000,duration:3},transcript:{text:'Hello, this is the CEO. Wire the payment today and do not tell anyone about this.',source:'deepgram'},intent:{status:'ok',score:7,words:15,rules:[{id:'secrecy',label:'Secrecy request',excerpt:'do not tell anyone'},{id:'money',label:'Money request',excerpt:'Wire the payment'}]}}),
 mk('INC-VOI1',now-3*H,{modality:'voice',priority:'medium',media:{name:'bank-call.wav',size:50000,duration:42},transcript:{text:'Sir your account will be blocked, share the OTP now.',source:'deepgram'}}),
 mk('INC-IMG1',now-26*H,{modality:'image',media:{name:'sms.png',size:3000,width:640,height:480},expiresAt:now+86400000,persist:true}),
 mk('INC-LIV1',now-27*H,{modality:'voice',media:{name:'Live microphone session',source:'live',duration:75},transcript:{text:'Live session transcript text',source:'deepgram'},persist:true}),
 mk('INC-TXT1',now-50*H,{persist:true}),
];
await p.evaluate(r=>{sessionStorage.setItem('voxa:incidents',JSON.stringify(r.filter(x=>!x.persist)));localStorage.setItem('voxa:incidents',JSON.stringify(r.filter(x=>x.persist)));},rows);
await p.goto(B+'/app.html#/history'); await p.waitForTimeout(800);
// attach a real video preview to INC-VID1 (what the analyze flow does in-session), then redraw
const buf=(await import('node:fs')).readFileSync(D+'t.webm').toString('base64');
await p.evaluate(async b64=>{const bin=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bin],{type:'video/webm'}));window.VoxaPreviews.set('INC-VID1',{url,kind:'video'});},buf);
await p.goto(B+'/app.html#/dashboard'); await p.waitForTimeout(300); await p.goto(B+'/app.html#/history'); await p.waitForTimeout(800);
const cnt=async()=>await p.locator('.hs-card').count();
console.log('cards all:',await cnt(),'| tabs:',(await p.locator('#hs-kinds').innerText()).replace(/\s+/g,' '));
console.log('day headings:',await p.locator('.hs-day').allInnerTexts());
console.log('video element ready:',await p.evaluate(async()=>{const v=document.querySelector('video.hs-media');if(!v)return 'no video';await new Promise(r=>v.readyState>=1?r():v.addEventListener('loadedmetadata',r,{once:true}));return 'duration '+v.duration.toFixed(1)+'s'}));
await p.screenshot({path:'../../crawl/hist-all.png'});
await p.click('[data-k="video"]'); console.log('video filter:',await cnt());
await p.click('[data-k=""]'); await p.fill('#hs-q','otp'); console.log('search otp:',await cnt());
await p.fill('#hs-q',''); await p.selectOption('#hs-p','high'); console.log('priority high:',await cnt()); await p.selectOption('#hs-p','');
await p.click('[data-k="live"]'); console.log('live filter:',await cnt()); await p.click('[data-k=""]');
await p.click('[data-del="INC-TXT1"]'); await p.click('[data-del="INC-TXT1"]'); console.log('after delete:',await cnt());
await p.goto(B+'/app.html#/history'); await p.waitForTimeout(500); console.log('after reload (persisted deleted?):',await cnt());
await p.click('.hs-card a.mt-btn'); await p.waitForTimeout(500); console.log('open report ->',p.url().split('#')[1]);
await p.reload(); await p.goto(B+'/app.html#/history'); await p.waitForTimeout(600); console.log('after full reload cards:',await cnt(),'| tile:',(await p.locator('.hs-card').first().locator('.hs-media').getAttribute('class')));
await p.screenshot({path:'../../crawl/hist-reload.png'});
console.log('ERRORS',errs); await b.close();
