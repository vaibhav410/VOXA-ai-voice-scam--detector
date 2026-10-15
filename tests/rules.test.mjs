import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const ctx=vm.createContext({});ctx.window=ctx;
for(const f of ['policies','rules','test-cases'])vm.runInContext(readFileSync(`js/${f}.js`,'utf8'),ctx);
test('three primary fraud scenarios and Hindi/mixed requests produce high risk',()=>{
 for(const id of ['kyc-en','arrest-en','otp-en','kyc-hi','arrest-hi','otp-mixed','remote-mixed']){
  const c=ctx.VOXA_TEST_CASES.find(x=>x.id===id);assert.equal(ctx.voxaScamIntent(c.text,c.sector).priority,'high',id);
 }
});
test('safety advice and ordinary calls do not raise high-risk alerts',()=>{
 for(const c of ctx.VOXA_TEST_CASES.filter(c=>!c.fraud))assert.notEqual(ctx.voxaScamIntent(c.text,c.sector).priority,'high',c.id);
});
test('brief critical requests alert without waiting for eight words; silence is not low risk',()=>{
 assert.equal(ctx.voxaScamIntent('Share OTP','finance').priority,'high');
 assert.equal(ctx.voxaScamIntent('ओटीपी बताओ','finance').priority,'high');
 assert.equal(ctx.voxaScamIntent('','finance').priority,'nee');
 assert.equal(ctx.voxaScamIntent('Transfer money immediately','personal').priority,'high');
 assert.equal(ctx.voxaScamIntent('तुरंत पैसे भेजो','personal').priority,'high');
 assert.equal(ctx.voxaScamIntent('Share your OTP and do not tell anyone','personal').priority,'high');
 assert.equal(ctx.voxaScamIntent('You are under digital arrest','personal').priority,'high');
 assert.notEqual(ctx.voxaScamIntent('Do not tell anyone your OTP. Please keep your bank account secure.','finance').priority,'high');
});
