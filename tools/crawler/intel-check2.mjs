import {chromium} from 'playwright';
const B = 'http://127.0.0.1:5198', b = await chromium.launch(), p = await b.newPage({viewport: {width: 1440, height: 1000}});
const errs = []; p.on('pageerror', e => errs.push('PAGEERROR ' + String(e.stack || e.message).split('\n').slice(0, 3).join(' | '))); p.on('console', m => m.type() === 'error' && errs.push('console ' + m.text().slice(0, 200)));
await p.goto(B + '/login.html?demo=1'); await p.click('#demo'); await p.waitForURL('**/app.html**');
await p.evaluate(() => { const now = Date.now(); sessionStorage.setItem('voxa:incidents', JSON.stringify([
  {id: 'INC-IN1', at: now - 60000, reportType: 'voice_authenticity', modality: 'voice', sector: 'finance', policyVersion: 'finance-1.0.0', status: 'open', priority: 'high', notes: [], tags: [], persist: false, expiresAt: now + 86400000, state: 'complete',
   media: {name: 'bank-call.wav', size: 120000, duration: 18, mime: 'audio/wav', sampleRate: 16000, channels: 1},
   intent: {status: 'ok', score: 9, words: 40, rules: [{id: 'otp_pin', label: 'OTP / PIN request', weight: 6, excerpt: 'please share the OTP now'}, {id: 'urgency', label: 'Urgency pressure', weight: 1, excerpt: 'immediately'}]},
   transcript: {text: 'This is the bank manager. Your account will be blocked. Please share the OTP immediately.', source: 'deepgram'},
   authenticity: {status: 'ok', provider: 'realitydefender', code: 'AI_GENERATED', aiScore: 0.91, confidence: 0.9, message: 'Reality Defender flagged this media as manipulated.'},
   extraction: {status: 'ok', provider: 'deepgram'}, language: 'en', context: {status: 'unavailable'}, limitations: 'Decision support only.',
   intelligence: {status: 'ok', data: {language: 'English', dialect: 'Indian English', speakers: 'One caller', tone: 'Urgent', context: 'Bank call', message: 'Asks for an OTP', translation: '', fraudType: 'Bank impersonation', fraudConfidence: 80, fraudReasoning: 'Requests OTP with urgency.'}}},
  {id: 'INC-IN2', at: now - 30000, reportType: 'noise_analysis', modality: 'voice', sector: 'personal', status: 'open', priority: 'nee', notes: [], tags: [], persist: false, expiresAt: now + 86400000, state: 'complete', media: {name: 'room.wav', size: 5000, duration: 5},
   intent: {status: 'insufficient', score: 0, rules: [], words: 0}, authenticity: {status: 'unavailable', code: 'NOT_APPLICABLE', message: 'n/a'}, limitations: 'x',
   noise: {speech: {detected: 'no', label: 'No'}, noise: {level: 'high', indicators: [], snrDb: null}, quality: {rating: 'poor', suitability: 'not_suitable', issues: []}, enhancement: {applied: false}, evidence: [{how: 'x'}, {how: 'y'}], limitations: ['x'], file: {}}}
])); });
await p.goto(B + '/app.html#/call-safety'); await p.goto(B + '/app.html#/intelligence'); await p.waitForTimeout(2000);
console.log((await p.innerText('#view')).slice(0, 900));
await p.screenshot({path: '../../crawl/page-intelligence-full.png', fullPage: true});
console.log('\nerrors:', errs.length ? errs : 'none'); await b.close();
