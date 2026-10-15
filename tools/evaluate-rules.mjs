import vm from 'node:vm';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const ctx=vm.createContext({});ctx.window=ctx;
for(const f of ['policies','rules','test-cases'])vm.runInContext(await readFile(`js/${f}.js`,'utf8'),ctx);
const rows=ctx.VOXA_TEST_CASES.map(c=>{const t=performance.now();const result=ctx.voxaScamIntent(c.text,c.sector);return {...c,predicted:result.priority,indicators:result.rules.map(r=>r.id),ruleTimeMs:performance.now()-t};});
const tp=rows.filter(c=>c.fraud&&c.predicted==='high').length,fn=rows.filter(c=>c.fraud&&c.predicted!=='high').length,fp=rows.filter(c=>!c.fraud&&c.predicted==='high').length,tn=rows.filter(c=>!c.fraud&&c.predicted!=='high').length;
const report={at:new Date().toISOString(),scope:'Authored transcript rules only; not audio/STT/deepfake accuracy.',threshold:'high',count:rows.length,tp,fn,fp,tn,accuracy:(tp+tn)/rows.length,falseAlarmRate:fp/(fp+tn),fraudRecall:tp/(tp+fn),rows};
await mkdir('evaluation',{recursive:true});await writeFile('evaluation/rule-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:undefined},null,2));
