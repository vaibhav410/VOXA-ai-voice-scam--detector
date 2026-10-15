import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {loadKeys} from '../server.mjs';
import {transcribe,detect} from '../server/providers.mjs';
const input=process.argv[2];if(!input)throw Error('Usage: npm run evaluate:audio -- manifest.json');
const manifestPath=path.resolve(input),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
if(!Array.isArray(manifest.samples)||!manifest.samples.length)throw Error('Manifest needs samples.');
for(const s of manifest.samples)if(s.consent!==true || typeof s.fraud!=='boolean' || typeof s.synthetic!=='boolean' || typeof s.reference!=='string' || !s.mime || !s.file)throw Error('Each sample needs consent:true, fraud, synthetic, reference, mime and file.');
const ctx=vm.createContext({});ctx.window=ctx;
for(const f of ['policies','rules'])vm.runInContext(await readFile(new URL(`../js/${f}.js`,import.meta.url),'utf8'),ctx);
function wer(reference,hypothesis){
 const tokens=t=>t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').trim().split(/\s+/u).filter(Boolean);
 const a=tokens(reference),b=tokens(hypothesis);if(!a.length)return null;
 let row=Array.from({length:b.length+1},(_,j)=>j);
 for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}
 return row[b.length]/a.length;
}
const keys=loadKeys(),rows=[];
for(const sample of manifest.samples){
 const bytes=await readFile(path.resolve(path.dirname(manifestPath),sample.file));if(bytes.length>25*1048576)throw Error('Audio exceeds 25 MB.');
 const start=performance.now(),extraction=await transcribe({bytes,mime:sample.mime,keys}),sttMs=performance.now()-start;
 const intent=extraction.status==='ok'?ctx.voxaScamIntent(extraction.text,sample.sector||'finance'):null;
 const detectionStart=performance.now(),authenticity=sample.detect===false?{status:'not_run'}:await detect({provider:'sealedrose',modality:'voice',bytes,mime:sample.mime,keys});
 rows.push({id:sample.id,language:sample.language,source:sample.source,fraud:sample.fraud,synthetic:sample.synthetic,reference:sample.reference,transcript:extraction.text,sttStatus:extraction.status,sttMessage:extraction.message,sttMs,priority:intent?.priority,wordErrorRate:extraction.status==='ok'?wer(sample.reference,extraction.text):null,authenticity,detectionMs:performance.now()-detectionStart});
 console.log(sample.id,extraction.status,intent?.priority,authenticity.status,authenticity.code||'');
}
const eligible=rows.filter(r=>r.sttStatus==='ok'&&r.priority!=='nee'),ratio=(a,b)=>b?a/b:null;
const tp=eligible.filter(r=>r.fraud&&r.priority==='high').length,fn=eligible.filter(r=>r.fraud&&r.priority!=='high').length,fp=eligible.filter(r=>!r.fraud&&r.priority==='high').length,tn=eligible.filter(r=>!r.fraud&&r.priority!=='high').length;
const audio=rows.filter(r=>r.authenticity.status==='ok'),synthetic=audio.filter(r=>r.synthetic),human=audio.filter(r=>!r.synthetic);
const report={at:new Date().toISOString(),dataset:manifest.name,scope:manifest.scope||'Labeled audio evaluation',threshold:'high',metrics:{samples:rows.length,scorableFraudResults:eligible.length,coverage:ratio(eligible.length,rows.length),tp,fn,fp,tn,accuracy:ratio(tp+tn,eligible.length),falseAlarmRate:ratio(fp,fp+tn),fraudRecall:ratio(tp,tp+fn),syntheticDetectionRecall:ratio(synthetic.filter(r=>r.authenticity.code==='AI_GENERATED').length,synthetic.length),humanVoiceFalseAlarmRate:ratio(human.filter(r=>r.authenticity.code==='AI_GENERATED').length,human.length),deepfakeCoverage:ratio(audio.length,rows.filter(r=>r.authenticity.status!=='not_run').length),meanTranscriptionMs:ratio(rows.reduce((s,r)=>s+r.sttMs,0),rows.length)},limitations:['Small developer fixture set; not population accuracy.','Fraud false alarms concern content labels; human-voice false alarms need human recordings.','Whitespace-token word error rate is approximate for Hindi/code switching.','Batch latency is not live warning delay.','Unavailable results are excluded from scorable denominators and counted in coverage.'],rows};
await mkdir('evaluation',{recursive:true});await writeFile('evaluation/audio-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.metrics,null,2));
