/* Authored transcripts, not recordings or an independent accuracy benchmark. */
window.VOXA_TEST_CASES = [
 {id:'kyc-en',name:'Fake bank / KYC',language:'English',fraud:true,sector:'finance',text:'This is the bank manager. Your account will be suspended immediately. Share your OTP to complete KYC.'},
 {id:'arrest-en',name:'Digital-arrest impersonation',language:'English',fraud:true,sector:'government',text:'I am a police officer. You are under digital arrest. Transfer money to pay the fine immediately.'},
 {id:'otp-en',name:'OTP request',language:'English',fraud:true,sector:'finance',text:'Please tell me the OTP that just arrived on your phone.'},
 {id:'remote-en',name:'Remote-access installation',language:'English',fraud:true,sector:'finance',text:'Download AnyDesk and share your screen immediately to verify your bank account.'},
 {id:'card-en',name:'Urgent card details',language:'English',fraud:true,sector:'finance',text:'Give me your card number and CVV immediately or your account will be blocked.'},
 {id:'pay-en',name:'Urgent payment and secrecy',language:'English',fraud:true,sector:'government',text:'I am a customs officer. Transfer money immediately and do not tell anyone.'},
 {id:'kyc-hi',name:'बैंक केवाईसी धोखाधड़ी',language:'Hindi',fraud:true,sector:'finance',text:'मैं बैंक से बोल रहा हूँ। आपका खाता बंद हो जाएगा। अपना ओटीपी तुरंत बताइए।'},
 {id:'arrest-hi',name:'डिजिटल अरेस्ट',language:'Hindi',fraud:true,sector:'government',text:'मैं पुलिस अधिकारी हूँ। आप डिजिटल अरेस्ट में हैं। तुरंत पैसे भेजो।'},
 {id:'otp-mixed',name:'Mixed OTP request',language:'Hindi-English',fraud:true,sector:'finance',text:'Main bank se bol raha hoon, aapka account block ho jayega. OTP abhi batao please.'},
 {id:'remote-mixed',name:'Mixed remote support scam',language:'Hindi-English',fraud:true,sector:'finance',text:'Account verify karna hai. AnyDesk download karo aur screen share karo abhi.'},
 {id:'safe-bank',name:'Bank safety reminder',language:'English',fraud:false,sector:'finance',text:'We will never ask you to share your OTP or PIN. Please use the official bank app.'},
 {id:'safe-hi',name:'Hindi safety reminder',language:'Hindi',fraud:false,sector:'finance',text:'अपना ओटीपी कभी किसी को मत बताना। बैंक आपसे पिन नहीं पूछता है।'},
 {id:'safe-mixed',name:'Mixed safety reminder',language:'Hindi-English',fraud:false,sector:'finance',text:'OTP kisi ko mat batao. Bank ka official number use karo aur khud verify karo.'},
 {id:'genuine-family',name:'Ordinary family call',language:'English',fraud:false,sector:'personal',text:'I will come home after work and we can have dinner together this evening.'},
 {id:'genuine-booking',name:'Appointment confirmation',language:'English',fraud:false,sector:'personal',text:'Your appointment is confirmed for tomorrow morning. Please arrive at reception ten minutes early.'},
 {id:'genuine-news',name:'Mention of fraud in news',language:'English',fraud:false,sector:'government',text:'The newspaper had an article about scams yesterday and our family discussed the story over dinner.'},
 {id:'safety-remote',name:'Remote-access safety advice',language:'English',fraud:false,sector:'finance',text:'Do not install AnyDesk or enable remote access for an unsolicited caller.'},
 {id:'genuine-reminder',name:'Routine official payment reminder',language:'English',fraud:false,sector:'personal',text:'Your invoice is available in the official app. Please pay the fee by next month.'}
];
