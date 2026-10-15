import {chromium} from 'playwright';
const browser=await chromium.launch();
try {
 const p=await browser.newPage(),base='http://127.0.0.1:5174/',errors=[],failures=[];
 p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'login.html?next=projects');
 await p.evaluate(()=>{
  localStorage.setItem('voxa:projects',JSON.stringify([{id:'existing-project',name:'Existing project',desc:'Keep this project',at:Date.now()}]));
  localStorage.setItem('voxa:voices',JSON.stringify([{name:'Existing voice',desc:'Saved catalog record'}]));
  localStorage.setItem('voxa:favs',JSON.stringify(['Nova']));
 });
 await p.click('#demo');await p.waitForURL('**/app.html#/projects');
 if(!await p.locator('.vcard').innerText().then(t=>t.includes('Existing project')))throw Error('Existing project lost');
 await p.click('#np');await p.fill('dialog input[name=name]','Restored project');await p.fill('dialog textarea','Project controls restored');await p.click('dialog button[value=ok]');await p.locator('.vcard').filter({hasText:'Restored project'}).waitFor();
 await p.reload();if(await p.locator('.vcard').count()!==2)throw Error('Projects not preserved');
 await p.locator('.vcard').filter({hasText:'Restored project'}).locator('[data-delp]').click();
 if(!await p.locator('.vcard').innerText().then(t=>t.includes('Existing project')))throw Error('Unrelated project removed');
 await p.goto(base+'app.html#/voice-library');await p.click('[data-vt=fav]');
 if(!await p.locator('.vrow').innerText().then(t=>t.includes('Nova')))throw Error('Existing favorite lost');
 await p.click('[data-vt=lib]');await p.fill('#v-q','Lucy');await p.click('[data-fav=Lucy]');await p.fill('#v-q','');await p.click('[data-vt=fav]');
 if(await p.locator('.vrow').count()!==2)throw Error('Favorite toggle failed');
 await p.goto(base+'app.html#/voices');if(!await p.locator('.vrow').innerText().then(t=>t.includes('Existing voice')))throw Error('Saved voice lost');
 await p.goto(base+'app.html#/integrations');await p.fill('#int-q','Zoom');if(await p.locator('.int').count()!==1)throw Error('Integration search failed');await p.fill('#int-q','');await p.click('[data-cat="Storage & files"]');if(await p.locator('.int').count()!==4)throw Error('Integration category failed');
 const routes=['dashboard','call-safety','meetings','reports','investigator','agent-detection','chrome-extension','integrations','intelligence','signal','watermarking','team','api-keys','playground','voice-overview','tts','sts','stt','voices','voice-library','projects','enhance','analyze','incidents','settings','profile','live','evaluation'];
 const reachable=new Set([...routes,'incident','create-voice','detect-dashboard','api-key']);
 for(const width of [320,820,1440]){
  await p.setViewportSize({width,height:1000});
  for(const route of routes){
   await p.goto(base+'app.html#/'+route);await p.locator('#view h1').waitFor();
   if((await p.title()).includes('Page unavailable'))failures.push({route,width,issue:'Unavailable route'});
   if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))failures.push({route,width,issue:'Horizontal overflow'});
   const bad=await p.locator('a[href^="#/"]').evaluateAll(links=>links.map(a=>a.getAttribute('href').split('/')[1]));
   for(const target of bad)if(!reachable.has(target))failures.push({route,target,issue:'Broken route'});
   if(await p.locator('a[href="#/create-voice"]').count())throw Error('Create Voice was reintroduced');
  }
 }
 await p.goto(base+'app.html#/stt');await p.check('#a-consent');await p.fill('#a-text','Please share your OTP immediately.');await p.click('#a-go');await p.waitForURL('**#/incident/**');
 if(await p.locator('.report-metrics>div').count()!==4)throw Error('Current result dashboard lost');
 await p.goto(base+'app.html#/reports');await p.locator('tbody a').first().click();await p.waitForURL('**#/incident/**');
 await p.goto(base+'app.html#/create-voice');await p.waitForURL('**#/analyze');
 for(const route of ['dashboard','call-safety','voice-library','projects']){await p.goto(base+'app.html#/'+route);await p.screenshot({path:'crawl/restored-'+route+'.png',fullPage:true});}
 console.log(JSON.stringify({routes:routes.length,responsiveChecks:routes.length*3,existingCollections:'preserved',projectControls:'passed',favorites:'passed',integrationFilters:'passed',analysisAndReports:'passed',failures,errors}));
 if(failures.length||errors.length)process.exitCode=1;
} finally {await browser.close();}
