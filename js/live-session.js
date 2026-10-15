window.setupVoxaLive = function({$,esc,store,incidents,S,PRI,pill,uid,toast}) {
 let socket,rec,stream,phase='idle',disposed=false,generation=0,connectionTimer,finishTimer;
 let started=0,ended=0,finalText='',interim='',events=[],seen=new Set(),sector='personal',saved=false;
 const state=$('#live-state'),start=$('#live-start'),stop=$('#live-stop'),save=$('#live-save'),consent=$('#live-consent');
 const stopAudio=()=>{if(rec?.state==='recording')rec.stop();stream?.getTracks().forEach(t=>t.stop());};
 const remember=()=>store.set('alerts',[...events,...store.get('alerts',[]).filter(a=>!events.some(e=>e.id===a.id))].sort((a,b)=>b.at-a.at).slice(0,200));
 function renderEvents() {
  $('#live-events').innerHTML=events.length?events.map(a=>`<div class="ev"><b>${esc(a.labels.join(', '))}</b><small>${(a.elapsedMs/1000).toFixed(1)}s into session${a.retracted?' · revised after recognition update':a.provisional?' · provisional':''}</small></div>`).join(''):'No warnings yet.';
 }
 function assess() {
  const text=(finalText+' '+interim).trim(),result=voxaScamIntent(text,sector);
  $('#live-text').textContent=text||'Listening for speech…';
  $('#live-risk').innerHTML=pill(PRI,result.priority)+result.rules.map(r=>`<div class="ev"><b>${esc(r.label)}</b>${esc(r.excerpt)}</div>`).join('');
  if(!interim){let changed=false;for(const event of events.filter(e=>e.provisional)){
   event.provisional=false;event.retracted=!event.ruleIds.every(id=>result.rules.some(r=>r.id===id));changed=true;
  }if(changed){remember();renderEvents();}}
  const warning=$('#live-warning');
  if(result.priority!=='high'){warning.hidden=true;return;}
  warning.hidden=false;warning.innerHTML=`<b>High-risk request detected</b><p>${esc(result.rules.map(r=>r.label).join(', '))}</p><p>Do not share codes or send money. Hang up and call back on an official number.</p><small>${interim?'Provisional warning from interim speech recognition.':'Warning from finalized recognized speech.'}</small>`;
  const newRules=result.rules.filter(r=>!seen.has(r.id));if(!newRules.length)return;
  newRules.forEach(r=>seen.add(r.id));
  events.push({id:uid(),at:Date.now(),source:'Live microphone',labels:newRules.map(r=>r.label),ruleIds:newRules.map(r=>r.id),elapsedMs:Date.now()-started,provisional:!!interim,retracted:false,persist:false,expiresAt:Date.now()+86400000});
  remember();renderEvents();
  if($('#live-voice').checked && 'speechSynthesis' in window){speechSynthesis.cancel();const voice=new SpeechSynthesisUtterance('High risk. Do not share your OTP or send money. Hang up and verify the caller.');voice.lang='en-IN';speechSynthesis.speak(voice);}
 }
 function finish(message) {
  if(disposed)return;
  phase='ended';if(!ended)ended=Date.now();clearTimeout(connectionTimer);clearTimeout(finishTimer);stopAudio();
  stop.disabled=true;start.disabled=false;start.textContent='Start a new session';save.disabled=saved||!(finalText||interim);consent.disabled=false;$('#sector').disabled=false;
  state.textContent=message||'Microphone off. Review or save this transcript before starting a new session.';
 }
 function fail(message) {if(disposed)return;finish(message);if(socket?.readyState<2)socket.close();}
 start.onclick=async()=>{
  if(!consent.checked)return toast('Confirm consent before starting the microphone.');
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)return toast('Microphone recording is unavailable. Upload a recording instead.');
  const current=++generation;phase='connecting';saved=false;finalText='';interim='';events=[];seen=new Set();rec=null;stream=null;ended=0;sector=$('#sector').value;
  start.disabled=true;stop.disabled=false;save.disabled=true;consent.disabled=true;$('#sector').disabled=true;
  $('#live-warning').hidden=true;$('#live-text').textContent='Connecting to transcription…';$('#live-risk').innerHTML='<p class="sub">Waiting for speech…</p>';renderEvents();state.textContent='Requesting microphone permission…';
  try {
   const source=await navigator.mediaDevices.getUserMedia({audio:true});
   if(disposed||current!==generation||phase!=='connecting'){source.getTracks().forEach(t=>t.stop());return;}
   stream=source;state.textContent='Connecting securely to Deepgram…';
   socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/api/live');
   connectionTimer=setTimeout(()=>{if(phase==='connecting')fail('Connection timed out. Check the Deepgram service in Settings and try again.');},20000);
   socket.onmessage=e=>{
    if(disposed||current!==generation)return;let d;try{d=JSON.parse(e.data);}catch{return;}
    if(d.type==='ready'&&phase==='connecting'){
     clearTimeout(connectionTimer);started=Date.now();phase='recording';
     try {
      rec=new MediaRecorder(stream);
      rec.ondataavailable=e=>{if(!e.data.size||socket.readyState!==WebSocket.OPEN)return;if(socket.bufferedAmount>1048576){fail('Connection is too slow to keep up. Microphone stopped. Please try again.');return;}socket.send(e.data);};
      rec.onstop=()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'stop'}));};
      rec.start(250);state.textContent='Microphone on · Hindi / English / mixed speech · streaming to Deepgram';
     }catch{fail('The browser could not start recording. Try uploading an audio file instead.');}
    }else if(d.type==='transcript'&&['recording','finalizing'].includes(phase)){
     if(d.final){finalText=(finalText+' '+d.text).trim();interim='';}else interim=d.text;
     assess();
    }else if(d.type==='error')fail(d.message||'Live transcription disconnected. The microphone has stopped.');
   };
   socket.onerror=()=>{if(current===generation)fail('Could not connect to live transcription. Check the Deepgram service in Settings, then try again.');};
   socket.onclose=()=>{if(disposed||current!==generation||phase==='ended')return;finish();};
  }catch{if(current===generation&&!disposed)fail('Microphone permission was denied or the microphone is unavailable. You can retry or upload a recording.');}
 };
 stop.onclick=()=>{
  ended=Date.now();
  if(phase==='connecting'){phase='ended';if(socket?.readyState<2)socket.close();finish('Connection canceled. Microphone off.');return;}
  phase='finalizing';stop.disabled=true;save.disabled=true;state.textContent='Microphone off. Finalizing the last words…';stopAudio();
  finishTimer=setTimeout(()=>{finish('Microphone off. Finalization timed out; any remaining interim text is marked provisional.');if(socket?.readyState<2)socket.close();},8000);
 };
 save.onclick=()=>{
  if(saved||phase!=='ended')return;const text=(finalText+' '+interim).trim();if(!text)return;
  const id=uid(),intent=voxaScamIntent(text,sector);
  const inc={id,at:Date.now(),modality:'voice',sector,policyVersion:S[sector].version,priority:intent.priority,intent,transcript:{text,source:'deepgram',provisional:!!interim},status:'open',notes:[],tags:[],media:{name:'Live microphone session',source:'live',size:null,duration:Math.max(0,Math.round(((ended||Date.now())-started)/1000))},authenticity:{status:'unavailable',code:'LIVE_INTENT_ONLY',message:'This live session assessed speech for fraud intent. Submit a consented recording to check voice authenticity.'},state:'partial',limitations:VOXA_LIMITS,persist:false,expiresAt:Date.now()+86400000,alerts:events};
  if(!store.set('incidents',[inc,...incidents()]))return;
  saved=true;events.forEach(e=>e.incidentId=id);remember();location.hash='#/incident/'+id;
 };
 return ()=>{disposed=true;generation++;clearTimeout(connectionTimer);clearTimeout(finishTimer);stopAudio();if(socket?.readyState<2)socket.close();window.speechSynthesis?.cancel();$('#sector').disabled=false;};
};
