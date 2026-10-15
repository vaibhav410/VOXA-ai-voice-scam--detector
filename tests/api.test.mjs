import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';
import {detect,normalize,extractText,transcribe,intelligence} from '../server/providers.mjs';
process.env.FREE_MODE = 'off'; // these tests mock providers; FREE_MODE has its own tests
process.env.VOXA_NO_FFMPEG = '1';
// Minimal byte signatures so the server's content check sees real media types (test data, not real media).
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(24)]);
const PNG = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n'), Buffer.alloc(24)]);
const MP4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(24)]);
const WEBM = Buffer.concat([Buffer.from([0x1A, 0x45, 0xDF, 0xA3]), Buffer.alloc(32)]);
test('Deepgram sends raw media securely and handles empty speech and failures',async()=>{
 const args={bytes:Buffer.from('fixture'),mime:'audio/wav',keys:{deepgram:'test-secret'}};
 const ok=await transcribe(args,async(url,opts)=>{
  assert.equal(new URL(url).searchParams.get('language'),'multi');
  assert.equal(new URL(url).searchParams.get('mip_opt_out'),'true');
  assert.equal(opts.headers.Authorization,'Token test-secret');
  assert.equal(opts.body,args.bytes);
  return Response.json({results:{channels:[{alternatives:[{transcript:'Please verify this request.'}]}]}});
 });assert.equal(ok.provider,'deepgram');assert.equal(ok.text,'Please verify this request.');
 const empty=await transcribe(args,async()=>Response.json({results:{channels:[{alternatives:[{transcript:''}]}]}}));assert.equal(empty.code,'NO_SPEECH');
 const failed=await transcribe(args,async()=>new Response('test-secret',{status:401}));assert.equal(failed.code,'HTTP_401');assert.ok(!JSON.stringify(failed).includes('test-secret'));
});
test('invalid provider responses never become authentic verdicts',()=>{
 assert.equal(normalize('sealedrose',{error:'failure'}).status,'unavailable');
 assert.equal(normalize('sealedrose',{aiGenerated:false,confidence:0.8}).code,'NOT_FLAGGED');
});
test('analysis routes Deepgram transcription separately from detection',async(t)=>{
 const s=createServer({sealedrose:'fixture',deepgram:'fixture'},async url=>url.includes('deepgram.com') ? Response.json({results:{channels:[{alternatives:[{transcript:'This is a transcribed call.'}]}]}}) : Response.json({aiGenerated:false,confidence:0.8}));
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>s.close());
 const base=`http://127.0.0.1:${s.address().port}`;
 const r=await fetch(base+'/api/analyze?modality=voice&provider=sealedrose&extract=1&textProvider=deepgram',{method:'POST',headers:{Origin:base,'X-Voxa-Request':'1','Content-Type':'audio/wav'},body:WAV});
 const d=await r.json();assert.equal(d.authenticity.provider,'sealedrose');assert.equal(d.extraction.provider,'deepgram');assert.equal(d.extraction.text,'This is a transcribed call.');
});
test('upstream failures are sanitized and not retried',async()=>{
 let calls=0;const r=await detect({provider:'sealedrose',modality:'image',bytes:Buffer.from('x'),mime:'image/png',keys:{sealedrose:'secret'}},async()=>{calls++;return new Response('secret',{status:401});});
 assert.equal(calls,1);assert.equal(r.code,'HTTP_401');assert.ok(!JSON.stringify(r).includes('secret'));
});
test('blocked or truncated extraction is not passed to intent rules',async()=>{
 const r=await extractText({bytes:Buffer.from('x'),mime:'image/png',keys:{gemini:'secret'},model:'test'},async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'partial'}]}}]}));
 assert.equal(r.status,'unavailable');assert.equal(r.text,undefined);
});
test('HTTP boundary protects secrets, validates uploads, and relays all modalities',async(t)=>{
 const calls=[];
 const s=createServer({sealedrose:'test-only'},async(url,opts)=>{calls.push([url,opts]);return Response.json({aiGenerated:true,confidence:0.9});});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>s.close());
 const base=`http://127.0.0.1:${s.address().port}`;
 for(const p of ['/css/.env.local','/.env.local','/server.mjs','/tools/crawler/package.json','/%2eenv.local']) assert.equal((await fetch(base+p)).status,404);
 assert.equal((await fetch(base+'/js/missing-public-file.js')).status,404);
 const font=await fetch(base+'/assets/fonts/inter-latin-400-normal.woff2');assert.equal(font.status,200);assert.equal(font.headers.get('content-type'),'font/woff2');
 const evaluation=await fetch(base+'/api/evaluation');
 if(evaluation.ok){const evidence=await evaluation.json();assert.ok(evidence.rows.every(r=>!('transcript' in r)&&!('reference' in r)));}
 assert.equal((await fetch(base+'/api/analyze',{method:'POST'})).status,403);
 for(const [modality,mime] of [['voice','audio/wav'],['image','image/png'],['video','video/mp4']]) {
  const r=await fetch(`${base}/api/analyze?modality=${modality}&provider=sealedrose`,{method:'POST',headers:{Origin:base,'X-Voxa-Request':'1','Content-Type':mime},body:{voice:WAV,image:PNG,video:MP4}[modality]});
  assert.equal(r.status,200);assert.equal((await r.json()).authenticity.code,'AI_GENERATED');
 }
 assert.equal(calls.length,3);assert.match(calls[0][0],/detect\/audio$/);
 const large=await fetch(base+'/api/analyze?modality=image&provider=sealedrose',{method:'POST',headers:{Origin:base,'X-Voxa-Request':'1','Content-Type':'image/png'},body:Buffer.alloc(11*1048576)});assert.equal(large.status,413);assert.equal(calls.length,3);
 const bad=await fetch(base+'/api/analyze?modality=image&provider=sealedrose',{method:'POST',headers:{Origin:base,'X-Voxa-Request':'1','Content-Type':'text/html'},body:'x'});assert.equal(bad.status,415);
});
test('blank Gemini extraction is unavailable rather than successful empty evidence',async()=>{
 const d=await extractText({bytes:Buffer.from('x'),mime:'image/png',keys:{gemini:'fixture'},model:'test'},async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'  '} ]}}]}));
 assert.equal(d.status,'unavailable');assert.equal(d.code,'NO_TEXT');
});
test('aborted uploads cancel provider requests and release the analysis slot',async(t)=>{
 let providerStarted,providerAborted;const started=new Promise(r=>providerStarted=r),aborted=new Promise(r=>providerAborted=r);let calls=0;
 const s=createServer({sealedrose:'fixture'},async(url,opts)=>{
  calls++;if(calls>1)return Response.json({aiGenerated:false,confidence:.8});
  providerStarted();return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>{providerAborted();reject(new DOMException('Canceled','AbortError'));},{once:true}));
 });await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>s.close());const base=`http://127.0.0.1:${s.address().port}`;
 const controller=new AbortController(),options={method:'POST',headers:{Origin:base,'X-Voxa-Request':'1','Content-Type':'audio/mp4'},body:MP4};
 const request=fetch(base+'/api/analyze?modality=voice&provider=sealedrose',{...options,signal:controller.signal}).catch(e=>e);
 await started;controller.abort();await request;await aborted;
 await new Promise(r=>setTimeout(r,10));const r=await fetch(base+'/api/analyze?modality=voice&provider=sealedrose',options);assert.equal(r.status,200);assert.equal(calls,2);
});

test('standalone transcription supports both providers without detection calls',async(t)=>{
 const urls=[];const s=createServer({deepgram:'fixture',gemini:'fixture'},async url=>{urls.push(url);return url.includes('deepgram.com') ? Response.json({results:{channels:[{alternatives:[{transcript:'A recorded call transcript.'}]}]}}) : Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'A recorded call transcript.'}]}}]});});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>s.close());
 const base=`http://127.0.0.1:${s.address().port}`;
 for (const provider of ['deepgram','gemini']) {
  const r=await fetch(base+'/api/transcribe?modality=voice&textProvider='+provider,{method:'POST',headers:{Origin:base,'X-Voxa-Request':'1','Content-Type':'audio/webm;codecs=opus'},body:WEBM});
  assert.equal(r.status,200);const d=await r.json();assert.equal(d.extraction.provider,provider);assert.equal(d.extraction.text,'A recorded call transcript.');assert.equal(d.authenticity,undefined);
 }
 assert.equal(urls.length,2);assert.ok(urls.every(u=>!u.includes('sealedrose')));
});

test('intelligence uses structured output, treats the transcript as data and sanitizes failures',async()=>{
 const text='Share your OTP right now or your account will be blocked.';
 const ok=await intelligence({text,keys:{gemini:'test-secret'},model:'m'},async(url,opts)=>{
  assert.equal(opts.headers['x-goog-api-key'],'test-secret');
  const b=JSON.parse(opts.body);assert.equal(b.generationConfig.responseMimeType,'application/json');assert.ok(b.systemInstruction.parts[0].text.includes('untrusted'));
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({language:'English',message:'Asks for OTP',fraudType:'vishing',fraudReasoning:'OTP request',fraudConfidence:140})}]}}]});
 });
 assert.equal(ok.status,'ok');assert.equal(ok.data.fraudConfidence,100);assert.equal(ok.data.fraudType,'vishing');
 const bad=await intelligence({text,keys:{gemini:'test-secret'},model:'m'},async()=>new Response('test-secret',{status:503}));
 assert.equal(bad.code,'HTTP_503');assert.ok(!JSON.stringify(bad).includes('test-secret'));
 assert.equal((await intelligence({text,keys:{},model:'m'})).code,'NOT_CONFIGURED');
});
