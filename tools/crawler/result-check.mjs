import { chromium } from 'playwright';
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1440,height:1100}});await p.goto('http://127.0.0.1:5174/app.html');
await p.evaluate(()=>localStorage.setItem('voxa:session',JSON.stringify({name:'Demo User',email:'demo@voxa.app'})));await p.evaluate(()=>localStorage.setItem('voxa:incidents',JSON.stringify([{id:'RESULT-PREVIEW',at:Date.now(),modality:'voice',sector:'personal',policyVersion:'1',tags:[],priority:'nee',intent:{status:'insufficient',priority:'nee',score:0,rules:[],words:0},media:{name:'recording.webm',size:2048},status:'open',notes:[],authenticity:{status:'ok',code:'NOT_FLAGGED',provider:'sealedrose',confidence:1,message:'Sealed Rose did not flag this media as AI-generated.'},extraction:{status:'ok',provider:'gemini'},state:'partial'}])));
await p.goto('http://127.0.0.1:5174/app.html#/incident/RESULT-PREVIEW');await p.locator('.result-title').waitFor();await p.screenshot({path:'crawl/result-card.png',fullPage:true});
console.log('Result preview rendered');await b.close();

