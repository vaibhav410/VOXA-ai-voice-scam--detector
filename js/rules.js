/* Request-aware heuristic rules. Runs locally; never an identity/criminality verdict. */
window.VOXA_RULES = [
 {id:'otp_pin',label:'OTP / PIN / password request',weight:5,critical:true,request:true,re:/\b(otp|one[- ]time password|pin|cvv|passcode|password)\b|ओटीपी|ओ टी पी|पिन|पासवर्ड/i},
 {id:'credentials_data',label:'Card / sensitive-data request',weight:4,request:true,re:/\b(card (number|details)|account number|aadhaa?r|pan (card|number)|login details)\b|कार्ड (नंबर|नम्बर|डिटेल)|आधार|खाता नंबर/i},
 {id:'remote_access',label:'Remote-access / screen-sharing request',weight:5,critical:true,request:true,re:/\b(anydesk|team\s?viewer|remote[- ]access|screen\s?shar(e|ing)|quicksupport)\b|एनीडेस्क|स्क्रीन शेयर|रिमोट/i},
 {id:'money_transfer',label:'Payment demand',weight:3,request:true,re:/\b(payment|money|transfer|upi|fine|fee|paise|paisa|pese)\b|पैसे|भुगतान|जुर्माना|ट्रांसफर/i},
 {id:'authority',label:'Claim of official authority',weight:2,re:/\b(i am|this is|speaking (from|for)|calling (from|on behalf of)|main|mai|hum).{0,40}\b(bank|police|cbi|rbi|customs|officer|manager|cyber cell)\b|\b(bank|police|cbi|rbi|customs).{0,15}(bol raha|se bol|officer)|मैं.{0,25}(बैंक|पुलिस|सीबीआई)|हम.{0,25}(पुलिस|बैंक)/i},
 {id:'legal_threat',label:'Account-suspension / legal threat',weight:4,re:/\b(digital arrest|arrest warrant|under arrest|arrest you|account.{0,20}(block|suspend|freez)|jail|arrest ho|khata.{0,15}(band|block))\b|डिजिटल अरेस्ट|गिरफ्तार|खाता.{0,20}(बंद|ब्लॉक)|जेल/i},
 {id:'urgency',label:'Urgency pressure',weight:1,re:/\b(immediately|right now|urgent(ly)?|asap|within \d+ (minutes?|hours?)|jaldi|abhi|turant|fauran)\b|तुरंत|अभी|जल्दी|फौरन/i},
 {id:'secrecy',label:'Keep-it-secret instruction',weight:2,re:/(don'?t|do not) (tell|inform) (anyone|anybody|family)|keep (this|it) (a )?secret|kisi ko (mat|na) bata|किसी को मत बताना/i}
];
const VOXA_REQUEST = /\b(share|tell|give|read|send|confirm|provide|enter|disclose|install|download|open|allow|enable|pay|transfer|bhej\w*|bata\w*|bta\w*|do|dijiye|karo|kijiye|karna|daalo|dena)\b|बताओ|बताएं|बताइए|बताइये|भेज|दीजिए|दें|करें|करो|डाउनलोड|इंस्टॉल|डालो|डालें/i;
const VOXA_SAFETY = /\b(never|do not|don'?t|must not|will never|cannot|won'?t|nahi|nahin|mat)\b|कभी.{0,16}(नहीं|मत)|नहीं|मत /i;
window.VOXA_SAFE_STEPS = [
 'Do not share OTPs, PINs, passwords or card details.',
 'Hang up. Call back using the official number in your bank app, card or department website.',
 'Do not install remote-access apps or make a payment under pressure.',
 'For financial cyber fraud in India, call 1930 promptly or report at cybercrime.gov.in.'
];
window.voxaScamIntent = function(text, sectorKey='personal') {
 const sector=VOXA_SECTORS[sectorKey] || VOXA_SECTORS.personal;
 const words=(text.match(/\S+/g)||[]).length, rules=[];
 const clauses=text.split(/[.!?।\n]+/).map(x=>x.trim()).filter(Boolean);
 const secrecy=/\b(don'?t|do not) (tell|inform) (anyone|anybody|family)\b|keep (this|it) (a )?secret/i;
 for(const rule of VOXA_RULES) {
  const clause=clauses.find(c=>rule.re.test(c) && (!rule.request || VOXA_REQUEST.test(c.replace(secrecy,''))) &&
    // Conservative suppression of safety statements; limitations documented for mixed clauses.
    (!VOXA_SAFETY.test(c.replace(secrecy,'')) || rule.id==='secrecy'));
  if(!clause)continue;
  const weight=+(rule.weight*(sector.boost[rule.id]||1)).toFixed(1);
  rules.push({id:rule.id,label:rule.label,weight,excerpt:clause.slice(0,300),critical:!!rule.critical || rule.id==='legal_threat' && /digital arrest|डिजिटल अरेस्ट/i.test(clause)});
 }
 const score=+rules.reduce((n,r)=>n+r.weight,0).toFixed(1);
 const urgentPayment=rules.some(r=>r.id==='money_transfer') && rules.some(r=>r.id==='urgency');
 const status=words>=8 || urgentPayment || rules.some(r=>r.critical || r.id==='legal_threat') ? 'ok':'insufficient';
 const priority=status!=='ok' ? 'nee' : urgentPayment || rules.some(r=>r.critical) || score>=sector.thresholds.high ? 'high' : score>=sector.thresholds.medium ? 'medium':'low';
 return {status,words,score,rules,priority};
};
