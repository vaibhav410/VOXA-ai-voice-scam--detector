(() => {
  // A bare "Failed to fetch" is useless; say what is actually wrong.
  const netError = () => new Error(location.origin !== 'http://127.0.0.1:5174' && location.origin !== 'http://localhost:5174' ? 'This page is not served by the VOXA server. Open http://127.0.0.1:5174 instead.' : 'Cannot reach the VOXA server. Run start-voxa.cmd (or npm start) in the VOXA folder, then reload.');
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    try { return await nativeFetch(...args); }
    catch (e) { throw e instanceof TypeError ? netError() : e; }
  };
  // fetch() cannot report upload progress, so uploads use XMLHttpRequest.
  const postBlob = (url, blob, mime, signal, onProgress, headers = {}) => new Promise((resolve, reject) => {
    const x = new XMLHttpRequest(); x.open('POST', url); x.responseType = 'json'; x.timeout = 240000;
    x.setRequestHeader('Content-Type', mime); x.setRequestHeader('X-Voxa-Request', '1'); for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.upload.onload = () => onProgress?.(1);
    x.onload = () => resolve({ ok: x.status >= 200 && x.status < 300, status: x.status, data: x.response || {} });
    x.onerror = () => reject(netError());
    x.ontimeout = () => reject(Object.assign(new Error('Analysis timed out.'), { name: 'TimeoutError' }));
    signal?.addEventListener('abort', () => { x.abort(); reject(Object.assign(new Error('Canceled'), { name: 'AbortError' })); }, { once: true });
    x.send(blob);
  });
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try {
      if (['incidents','alerts'].includes(k)) {
        const rows=[...(JSON.parse(localStorage.getItem('voxa:'+k)) || []),...(JSON.parse(sessionStorage.getItem('voxa:'+k)) || [])];
        const live=rows.filter(x=>(x.expiresAt || x.at+86400000)>Date.now());
        // Purge expired reports and full transcripts when they are read.
        localStorage.setItem('voxa:'+k,JSON.stringify(live.filter(x=>x.persist)));
        sessionStorage.setItem('voxa:'+k,JSON.stringify(live.filter(x=>!x.persist)));
        return live.sort((a,b)=>b.at-a.at);
      }
      return JSON.parse(localStorage.getItem('voxa:' + k)) ?? d;
    } catch { return d; } },
    set(k, v) { try {
      if (['incidents','alerts'].includes(k)) {
        localStorage.setItem('voxa:'+k,JSON.stringify(v.filter(x=>x.persist)));
        sessionStorage.setItem('voxa:'+k,JSON.stringify(v.filter(x=>!x.persist)));
        if (k === 'incidents') window.VoxaSync?.changed(v);
      } else localStorage.setItem('voxa:' + k, JSON.stringify(v));
      return true;
    } catch { toast('Browser storage is full or blocked. Export or delete reports before saving.'); return false; } },
    del(k) { try { localStorage.removeItem('voxa:' + k); sessionStorage.removeItem('voxa:'+k); } catch {} }
  };
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2800); }

  const S = VOXA_SECTORS;
  const savedSession = store.get('session', {});
  const session = {name:typeof savedSession?.name === 'string' && savedSession.name.trim() ? savedSession.name.trim().slice(0,40) : 'Demo User',email:'Local workspace'};
  let sector = store.get('sector', 'personal'); if (!S[sector]) sector = 'personal';
  const PRI = { low: ['Low', 'p-low'], medium: ['Medium', 'p-medium'], high: ['High', 'p-high'], nee: ['Not enough evidence', 'p-nee'] };
  const STATUS = { open: ['Open', 's-open'], investigating: ['Investigating', 's-investigating'], resolved: ['Resolved', 's-resolved'], fp: ['False positive', 's-fp'] };
  const pill = (map, k) => `<span class="pill ${map[k][1]}">${map[k][0]}</span>`;
  const incidents = () => store.get('incidents', []);
  setInterval(()=>{store.get('alerts',[]);const reports=incidents();const [,route,id]=(location.hash||'').split('/');if(route==='incident' && !reports.some(r=>r.id===id))render();},60000);
  const uid = () => 'INC-' + Date.now().toString(36).toUpperCase().slice(-6) + Math.random().toString(36).slice(2, 4).toUpperCase();
  const upid = () => 'UP-' + uid().slice(4);
  // Report types. New reports store the type; older saved reports derive it, so nothing needs migrating.
  const RT = { voice_authenticity: 'Voice authenticity', scam_analysis: 'Scam analysis', noise_analysis: 'Noise analysis', privacy_analysis: 'Privacy scan', image_authenticity: 'Image authenticity', video_authenticity: 'Video authenticity' };
  const reportTypeOf = i => i.reportType || (i.media?.source === 'live' || !i.media ? 'scam_analysis' : { voice: 'voice_authenticity', image: 'image_authenticity', video: 'video_authenticity' }[i.modality || 'voice'] || 'voice_authenticity');
  window.VoxaReportType = reportTypeOf; window.VoxaReportTypes = RT;
  // Read-only dashboards describe calls; noise reports are separate documents. Writers keep the full list.
  const callIncidents = () => incidents().filter(i => !['noise_analysis', 'privacy_analysis'].includes(reportTypeOf(i)));
  const fmt = t => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  const C = makeClone({ esc, store, toast, $, incidents: callIncidents, S, pill, PRI, STATUS, fmt, rerender: () => render() });
  const Safety = makeSafety({$,esc,store,incidents,S,PRI,STATUS,pill,fmt,uid,toast});
  const Mod = makeModules({$,esc,store,incidents:callIncidents,S,PRI,pill,fmt,toast});
  window.VoxaMeetings = makeMeetings({$,esc,store,incidents:callIncidents,PRI,pill,fmt,toast});
  window.VoxaIntentGraphs = intentGraphs;

  /* ---------- shell ---------- */
  const initial = session.name.trim()[0]?.toUpperCase() || 'V';
  ['#u-av', '#m-av'].forEach(s => ($(s).textContent = initial));
  $('#u-name').textContent = $('#m-name').textContent = session.name;
  $('#u-mail').textContent = $('#m-mail').textContent = $('#acct-mail').textContent = session.email;

  const sel = $('#sector');
  sel.innerHTML = Object.entries(S).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
  sel.value = sector;
  sel.onchange = () => { sector = sel.value; store.set('sector', sector); toast('Sector set to ' + S[sector].name + ' — applies to the next analysis.'); };

  const menu = $('#menu'), ub = $('#user-btn');
  const toggle = open => { menu.hidden = !open; ub.setAttribute('aria-expanded', open); };
  ub.onclick = e => { e.stopPropagation(); toggle(menu.hidden); };
  document.addEventListener('click', e => { if (!menu.contains(e.target)) toggle(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });
  menu.addEventListener('click', e => { if (e.target.closest('a')) toggle(false); });
  $('#logout').onclick = async () => { cleanupAnalyze(); Safety.cleanup(); store.del('session'); sessionStorage.removeItem('voxa:incidents'); sessionStorage.removeItem('voxa:alerts'); try { await window.VoxaAuth?.signOut?.(); } catch {} location.href = 'login.html?out=1'; };
  const mobileLayout = matchMedia('(max-width:800px)');
  const mobileMenu = $('#mobile-menu');
  const setSidebar = open => { $('#sidebar').classList.toggle('collapsed',!open); $('.app').classList.toggle('sidebar-is-collapsed',!open); mobileMenu.setAttribute('aria-expanded',String(open)); mobileMenu.setAttribute('aria-label',open?'Close navigation':'Open navigation'); };
  const syncMobile = () => setSidebar(!mobileLayout.matches);
  syncMobile(); mobileLayout.addEventListener('change',syncMobile);
  mobileMenu.onclick = () => setSidebar($('#sidebar').classList.contains('collapsed'));
  $('#collapse').onclick = () => setSidebar(false);
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && mobileLayout.matches)setSidebar(false);});

  /* ---------- views ---------- */
  function statusList() {
    return `<div id="settings-services" class="service-list" role="status">Checking services...</div><p class="sub">Configuration status confirms a key is present. Provider access and credits are checked when you run an analysis.</p><button class="btn sec" id="s-refresh">Refresh service status</button>`;
  }

  const MODS = {
    voice: { label: 'Voice', auth: 'Voice Authenticity', ctx: 'Prosody and speaking-rate cues', text: 'Transcript', ph: 'Paste the call transcript (English, Hindi or Hinglish). Optional Deepgram or Gemini transcription is available below.' },
    image: { label: 'Image', auth: 'Image Authenticity', ctx: 'Image metadata and compression cues', text: 'Text in or sent with the image (optional)', ph: 'Paste any message, caption or text that came with the image (for example a fake bank SMS). Scam-intent rules run on this text.' },
    video: { label: 'Video', auth: 'Video Authenticity', ctx: 'Frame and audio-sync cues', text: 'Speech transcript (optional)', ph: 'Paste what is said in the video (English, Hindi or Hinglish). Optional Deepgram or Gemini transcription is available below.' }
  };
  const modOf = i => i.modality || 'voice';
  let modality = 'voice', mediaMeta = null;
  let cleanupAnalyze = () => {};
  const readMeeting = () => { try { return JSON.parse(sessionStorage.getItem('voxa:meeting')); } catch { return null; } };
  function Analyze() {
    const m = MODS[modality];
    const mt = readMeeting();
    const UP = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M5 20h14"/></svg>';
    const CFG = {
      voice: {accept: '.wav,.mp3,.flac,.ogg,.m4a,.webm,audio/*', hint: 'wav, mp3, flac, ogg, m4a · max 20 MB · min 3 s', empty: 'No file selected'},
      image: {accept: '.jpg,.jpeg,.png,.webp,image/*', hint: 'jpg, png, webp · max 10 MB', empty: 'No file selected'},
      video: {accept: '.mp4,.webm,.mov,video/*', hint: 'mp4, webm, mov · max 32 MB · min 1 s', empty: 'No file selected'}
    }[modality];
    const preview = modality === 'voice' ? '<audio id="a-play" class="an-prev" controls hidden></audio>'
      : modality === 'image' ? '<img id="a-prev" class="an-prev" alt="Selected image preview" hidden>'
      : '<video id="a-prev" class="an-prev" controls hidden></video>';
    const consent = modality === 'image' ? 'I have permission to analyze this image.' : 'I have permission from everyone in this recording to analyze it.';
    return `<div class="wrapv an">
      <header class="an-head"><div><h1>New analysis</h1><p class="sub">Sector <b>${esc(S[sector].name)}</b> is locked when you press Analyze.</p></div>
        <div class="an-auth" title="Deepfake detector used for this media type"><span>Authenticity</span><strong id="a-auth-name">Checking…</strong><small id="a-auth-limit"></small><input type="hidden" id="a-provider" value="auto"></div></header>
      ${mt ? `<div class="an-meeting"><span>Meeting: <b>${esc(mt.title)}</b> · ${esc(mt.platform)}</span><button type="button" id="a-meeting-clear" class="mt-btn sm">Clear</button></div>` : ''}
      <div class="modtabs an-tabs" id="mods" role="group" aria-label="Media type">${Object.entries(MODS).map(([k, v]) => `<button aria-pressed="${k === modality}" class="${k === modality ? 'on' : ''}" data-mod="${k}">${v.label}</button>`).join('')}</div>
      <div class="an-grid">
        <section class="an-card"><div class="an-card-h"><h2>${m.label}</h2>${modality === 'voice' ? '<button class="mt-btn sm" id="a-rec" type="button">● Record from mic</button>' : ''}</div>
          <div class="an-card-b"><label class="an-drop" for="a-file">${UP}<b>Drop a file or click to upload</b><small>${CFG.hint}</small><input id="a-file" type="file" accept="${CFG.accept}" hidden></label>
            <p id="a-info" class="an-info">${CFG.empty}</p>${preview}</div></section>
        <section class="an-card"><div class="an-card-h"><h2>${modality === 'image' ? 'Text in image' : 'Transcript'}</h2>
            <div class="an-inline"><select id="a-text-provider" aria-label="${modality === 'image' ? 'Text extraction service' : 'Transcription service'}">${modality !== 'image' ? '<option value="deepgram">Deepgram</option>' : ''}<option value="gemini">Gemini</option></select><button class="mt-btn sm" id="a-transcribe" type="button">${modality === 'image' ? 'Extract text' : 'Transcribe'}</button></div></div>
          <div class="an-card-b"><textarea id="a-text" aria-label="${esc(m.text)}" placeholder="${modality === 'image' ? 'Text found in or sent with the image (optional)' : 'Paste a transcript (English, Hindi or Hinglish) or transcribe the recording'}"></textarea><p id="a-transcript-state" class="an-info" role="status"></p></div></section>
      </div>
      <section class="an-card an-options"><label class="an-consent"><input type="checkbox" id="a-consent"> ${consent}</label>
        <label><input type="checkbox" id="a-extract" ${modality !== 'image' ? 'checked' : ''}> Auto-extract ${modality === 'image' ? 'text' : 'speech'}</label>
        ${modality === 'video' ? '<label title="Checks the audio track separately; uses one extra scan"><input type="checkbox" id="a-soundtrack"> Check soundtrack</label>' : ''}
        ${modality === 'image' ? '<label title="Luxand, JPG/PNG portraits only"><input type="checkbox" id="a-live"> Face liveness</label>' : ''}
        <label title="Otherwise the report stays in this tab only"><input type="checkbox" id="a-retain"> Keep report 24 h</label>
        ${modality === 'voice' ? '<label title="With Analyze Noise: also create a separate enhanced copy using real noise reduction. The original is never changed."><input type="checkbox" id="a-denoise"> Create enhanced copy (noise removal)</label>' : ''}
        <details class="an-labels"><summary>Labels</summary><div id="a-tags">${Object.entries(S).filter(([k]) => k !== sector).map(([k, v]) => `<label><input type="checkbox" value="${k}"> ${esc(v.name)}</label>`).join('')}</div></details></section>
      <div class="an-foot"><div id="service-status" class="service-chips">Checking services…</div>
        <div class="an-actions"><span id="a-state" role="status" aria-live="polite"></span><button class="mt-btn" id="a-cancel" hidden>Cancel</button>${modality === 'voice' ? '<button class="mt-btn" id="a-noise" type="button" title="Measure background noise and audio quality. Creates a separate noise report; the voice report is not affected.">Analyze Noise</button>' : ''}<button class="mt-btn primary" id="a-go">${modality === 'voice' ? 'Analyze Voice' : 'Analyze'}</button></div></div>
      <p class="an-note">Files go to the selected providers, are not stored by VOXA, and may use provider credits.</p></div>`;
  }
  function setupAnalyze() {
    mediaMeta = null; let url, rec, chunks = [], timer, selectedBlob, uploadId = null, disposed = false, micStream, lastExtraction, requestController, mediaVersion=0, recordingStart=0,micPending=false;
    cleanupAnalyze = () => { disposed = true;sel.disabled=false; requestController?.abort(); clearInterval(timer); if (rec?.state === 'recording') rec.stop(); micStream?.getTracks().forEach(t => t.stop()); if(prev?.pause)prev.pause();if (url) URL.revokeObjectURL(url); };
    const controls=[...document.querySelectorAll('#view input,#view select,#view textarea,#view button')].filter(e=>e.id!=='a-cancel');
    const busy=on=>{if(disposed)return;controls.forEach(e=>e.disabled=on);sel.disabled=on;$('#a-cancel').hidden=!on;};
    const beginRequest=()=>{requestController=new AbortController();busy(true);return AbortSignal.any([requestController.signal,AbortSignal.timeout(180000)]);};
    $('#a-cancel').onclick=()=>requestController?.abort();
    fetch('/api/status?probe=1').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(d=>{if(disposed)return;
      const el=$('#service-status'),key={voice:'voice',image:'image',video:'video'}[modality],ap=d.authProvider?.[key];
      const names={realitydefender:'Reality Defender',sealedrose:'Sealed Rose'},limits={voice:'20 MB',image:'10 MB',video:'32 MB'};
      $('#a-auth-name').textContent=(names[ap]||ap||'Not configured')+(modality==='video'?' (video)':'');$('#a-auth-limit').textContent=limits[key]+' maximum';
      const state=x=>!x.configured?['Not configured','missing']:!x.allowed?['Blocked by FREE_MODE','missing']:x.health==='invalid-key'?['Key rejected','missing']:x.health==='unreachable'?['Unreachable','missing']:x.health==='rate-limited'?['Rate limited','missing']:x.health==='ok'?['Ready','']:['Configured',''];
      el.classList.add('service-chips');
      el.innerHTML=Object.entries(d.details).filter(([k])=>modality==='image'?k!=='deepgram':k!=='luxand').map(([k,x])=>{const [t,c]=state(x);return `<span class="service-chip ${c}" title="${esc(x.blockedReason||x.healthNote||x.note)}">${esc(x.label)} · ${t}</span>`;}).join('')+(d.freeMode?'<span class="service-chip" title="Providers whose accounts you have not confirmed as card-free are blocked.">FREE_MODE on</span>':'');
    }).catch(e=>{if(!disposed)$('#service-status').textContent=e?.message||'The analysis server is unavailable. Refresh the page after starting VOXA.';});
    $('#mods').onclick = e => { const b = e.target.closest('[data-mod]'); if (b && b.dataset.mod !== modality) { modality = b.dataset.mod; render(); } };
    const info = $('#a-info'), prev = $('#a-prev') || $('#a-play');
    const reject = m => { mediaMeta = null; selectedBlob = null; if (prev) prev.hidden = true; info.textContent = m; toast(m); };
    const fin = (meta, label) => { if (disposed) return; mediaMeta = meta; prev.src = url; prev.hidden = false; info.textContent = label; };
    const sz = b => (b.size / 1048576).toFixed(2) + ' MB';
    const use = (blob, name) => {
      const version=++mediaVersion;
      mediaMeta = null;uploadId = upid();
      if(lastExtraction && $('#a-text').value===lastExtraction.text)$('#a-text').value='';
      lastExtraction=null;$('#a-transcript-state').textContent='';
      selectedBlob = blob;
      if(prev)prev.hidden=true;
      const max=modality==='image'?10:modality==='video'?32:20;
      if(blob.size>max*1048576 || !blob.size)return reject(blob.size?'File exceeds the '+max+' MB limit.':'This file is empty.');
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      if (modality === 'image') {
        if (blob.size > 10 * 1048576) return reject('Image exceeds the 10 MB limit.');
        const im = new Image(); im.onload = () => {if(version===mediaVersion)fin({ kind: 'image', name, size: blob.size, width: im.naturalWidth, height: im.naturalHeight }, `${name} · ${sz(blob)} · ${im.naturalWidth}×${im.naturalHeight}`);};
        im.onerror = () => {if(version===mediaVersion&&!disposed)reject('That file could not be decoded as an image.');}; im.src = url; return;
      }
      const el = document.createElement(modality === 'video' ? 'video' : 'audio'); el.preload = 'metadata'; el.src = url;
      el.onloadedmetadata = () => {
        if(version!==mediaVersion || disposed)return;
        const dur = isFinite(el.duration) ? el.duration : name.startsWith('recording.') ? (Date.now()-recordingStart)/1000 : 0;
        const lim = modality === 'video' ? [32, 1, 'Video', '32 MB'] : [20, 3, 'Audio', '20 MB'];
        if (blob.size > lim[0] * 1048576) return reject(`File exceeds the ${lim[3]} limit.`);
        if (dur && dur < lim[1]) return reject(`${lim[2]} is shorter than ${lim[1]} second${lim[1] > 1 ? 's' : ''}.`);
        fin({ kind: modality, name, size: blob.size, duration: dur ? +dur.toFixed(1) : null }, `${name} · ${sz(blob)}${dur ? ' · ' + dur.toFixed(1) + 's' : ''}`);
      };
      el.onerror = () => {if(version===mediaVersion&&!disposed)reject(`That file could not be decoded as ${modality === 'voice' ? 'audio' : modality}.`);};
    };
    const EXT = { voice: /\.(wav|mp3|flac|ogg|m4a|webm)$/i, image: /\.(jpe?g|png|webp)$/i, video: /\.(mp4|webm|mov)$/i };
    const HELP = { voice: 'Unsupported format. Use wav, mp3, flac, ogg, m4a or webm.', image: 'Unsupported format. Use jpg, png or webp.', video: 'Unsupported format. Use mp4, webm or mov.' };
    $('#a-meeting-clear')?.addEventListener('click', () => { try { sessionStorage.removeItem('voxa:meeting'); } catch {} render(); });
    if (window.__voxaPending && modality === (window.__voxaPending.kind || 'voice')) { const f = window.__voxaPending; window.__voxaPending = null; use(f.blob, f.name); }
    const dz = $('.an-drop');
    if (dz) {
      ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
      dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (!f) return; const dt = new DataTransfer(); dt.items.add(f); $('#a-file').files = dt.files; $('#a-file').dispatchEvent(new Event('change')); });
    }
    $('#a-file').onchange = e => { const f = e.target.files[0]; if (!f) return; if (!EXT[modality].test(f.name)) return reject(HELP[modality]); use(f, f.name); };
    const mediaMime = () => selectedBlob?.type || ({wav:'audio/wav',mp3:'audio/mpeg',flac:'audio/flac',ogg:'audio/ogg',m4a:'audio/mp4',webm:'audio/webm',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',mp4:'video/mp4',mov:'video/quicktime'}[mediaMeta?.name.split('.').pop().toLowerCase()] || 'application/octet-stream');
    $('#a-transcribe').onclick = async () => {
      if (!$('#a-consent').checked) return toast('Confirm consent before sending a recording to transcription.');
      if (!selectedBlob || !mediaMeta) return toast('Record audio or select a file first.');
      const b = $('#a-transcribe'), state = $('#a-transcript-state'), text = $('#a-text');
      const previousText = text.value, provider = $('#a-text-provider').value;
      if (provider === 'gemini' && selectedBlob.size > 14 * 1048576) return toast('Gemini accepts up to 14 MB. Choose Deepgram for larger audio files.');
      const signal=beginRequest(); state.textContent = 'Transcribing with ' + provider + '…';
      try {
        const q = new URLSearchParams({modality,textProvider:provider});
        const r = await fetch('/api/transcribe?' + q,{method:'POST',headers:{'Content-Type':mediaMime(),'X-Voxa-Request':'1','X-Voxa-Provider-Consent':'1'},body:selectedBlob,signal});
        const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Transcription failed.');
        if (d.extraction?.status !== 'ok') throw new Error(d.extraction?.message || 'No transcript returned.');
        if (disposed) return;
        if (text.value !== previousText) { state.textContent = 'Your transcript changed while processing. Run transcription again to replace it.'; return; }
        text.value = d.extraction.text;
        lastExtraction = {text:d.extraction.text,provider,language:d.extraction.language};
        state.textContent = 'Transcribed with ' + provider + '. Review and edit the text before analyzing.';
        $('#a-extract').checked = false;
      } catch(e) { if (!disposed) state.textContent = e.name==='AbortError' ? 'Transcription canceled. Your existing text has been kept.' : e.name==='TimeoutError' ? 'Transcription timed out. Please try again.' : e.message; }
      finally { busy(false); }
    };
    $('#a-rec')?.addEventListener('click', async e => {
      const b = e.currentTarget;
      if (rec && rec.state === 'recording') return rec.stop();
      if(micPending)return;
      if (!$('#a-consent').checked) return toast('Confirm consent before recording.');
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Recording is not supported in this browser.');
      micPending=true;b.disabled=true;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (disposed) { stream.getTracks().forEach(t => t.stop()); return; }
        micStream = stream;
        rec = new MediaRecorder(stream); chunks = []; const t0 = Date.now();recordingStart=t0;let recordedBytes=0;
        rec.ondataavailable = ev => {chunks.push(ev.data);recordedBytes+=ev.data.size;if(recordedBytes>25*1048576 && rec.state==='recording')rec.stop();};
        rec.onstop = () => { clearInterval(timer); stream.getTracks().forEach(t => t.stop()); if (disposed) return; b.textContent = '● Record from mic'; $('#a-go').disabled = $('#a-transcribe').disabled = $('#a-file').disabled = false; if ($('#a-noise')) $('#a-noise').disabled = false; const ext = rec.mimeType.includes('mp4') ? 'm4a' : rec.mimeType.includes('ogg') ? 'ogg' : 'webm'; use(new Blob(chunks, { type: rec.mimeType }), 'recording.' + ext); };
        rec.start(1000); b.textContent = '■ Stop (recording 0s)';
        $('#a-go').disabled = $('#a-transcribe').disabled = $('#a-file').disabled = true; if ($('#a-noise')) $('#a-noise').disabled = true;
        timer = setInterval(() => {const seconds=Math.round((Date.now()-t0)/1000);b.textContent=`Stop recording · ${seconds}s`;if(seconds>=600 && rec.state==='recording'){rec.stop();toast('Recording stopped at the 10-minute limit.');}},500);
      } catch { if(!disposed)toast('Microphone permission was denied or recording is unavailable.'); }
      finally {micPending=false;if(!disposed)b.disabled=false;}
    });
    // Analyze Noise: independent of the voice analysis. Local FFmpeg + DSP only; no provider is called.
    $('#a-noise')?.addEventListener('click', async () => {
      if (!mediaMeta || !selectedBlob) return toast('Add an audio recording first.');
      if (!$('#a-consent').checked) return toast('Confirm consent before analyzing this recording.');
      const st = $('#a-state'), lockedMedia = mediaMeta, lockedBlob = selectedBlob, lockedUploadId = uploadId, lockSector = sector;
      const wantEnhanced = $('#a-denoise').checked, retainReport = $('#a-retain').checked;
      if (lockedBlob.size > 20 * 1048576) { st.textContent = 'Noise analysis accepts audio up to 20 MB.'; return; }
      const signal = beginRequest();
      st.dataset.state = 'uploading'; st.textContent = 'Uploading… 0%';
      let response;
      try {
        response = await postBlob('/api/noise?denoise=' + (wantEnhanced ? '1' : '0'), lockedBlob, mediaMime(), signal, f => { if (disposed) return; st.dataset.state = f < 1 ? 'uploading' : 'processing'; st.textContent = f < 1 ? `Uploading… ${Math.round(f * 100)}%` : wantEnhanced ? 'Measuring noise and creating the enhanced copy…' : 'Measuring noise and audio quality…'; });
      } catch (e) { if (!disposed) { st.dataset.state = 'failed'; st.textContent = e.name === 'AbortError' ? 'Noise analysis canceled. No report was saved.' : e.name === 'TimeoutError' ? 'Noise analysis timed out. Please try again.' : e.message || 'The analysis server is unavailable.'; busy(false); } return; }
      if (disposed) return;
      if (!response.ok) { st.dataset.state = response.status === 415 || response.status === 422 ? 'unsupported' : 'failed'; st.textContent = response.data.error || 'Noise analysis failed.'; busy(false); return; }
      const { noise, enhancedAudio } = response.data;
      if (!noise?.speech || !noise?.quality) { st.dataset.state = 'failed'; st.textContent = 'The server returned an incomplete noise report. Nothing was saved.'; busy(false); return; }
      const savedId = saveNoiseReport({ noise, enhancedAudio, media: lockedMedia, blob: lockedBlob, uploadId: lockedUploadId, retain: retainReport, sector: lockSector });
      if (!savedId) { busy(false); return; }
      st.dataset.state = 'completed';
      location.hash = '#/incident/' + savedId;
    });
    $('#a-go').onclick = async () => {
      if (mediaMeta && !$('#a-consent').checked) return toast('Confirm consent before analyzing this recording.');
      let text = $('#a-text').value.trim();
      let transcriptSource = lastExtraction?.text.trim() === text ? lastExtraction.provider : 'provided';
      if (!text && !mediaMeta) return toast(`Add ${modality === 'voice' ? 'audio' : 'a ' + modality} or text first.`);
      const btn = $('#a-go'); btn.disabled = true;
      const st = $('#a-state'), lockSector = sector, lockMod = modality, M = MODS[lockMod];
      const lockedMedia = mediaMeta, lockedBlob = selectedBlob, lockedUploadId = uploadId;
      const retainReport=$('#a-retain').checked;
      const tags = [...document.querySelectorAll('#a-tags input:checked')].map(x => x.value);
      let remote;
      if (lockedMedia && lockedBlob) {
        const provider = $('#a-provider').value;
        const limit = lockMod === 'image' ? 10 : lockMod === 'voice' ? 20 : 32;
        if (lockedBlob.size > limit * 1048576) { st.textContent = `This provider accepts files up to ${limit} MB.`; btn.disabled = false; return; }
        st.dataset.state = 'uploading'; st.textContent = 'Uploading… 0%';
        const q = new URLSearchParams({modality:lockMod,provider:$('#a-provider').value,extract:$('#a-extract').checked ? '1':'0',textProvider:$('#a-text-provider').value,liveness:$('#a-live')?.checked ? '1':'0',soundtrack:$('#a-soundtrack')?.checked ? '1':'0'});
        const signal=beginRequest();
        try {
          const response = await postBlob('/api/analyze?' + q, lockedBlob, mediaMime(), signal, f => { if (disposed) return; st.dataset.state = f < 1 ? 'uploading' : 'processing'; st.textContent = f < 1 ? `Uploading… ${Math.round(f * 100)}%` : 'Checking authenticity and transcript. This can take up to a minute.'; }, {'X-Voxa-Provider-Consent': '1'});
          remote = response.data;
          if(disposed)return;
          if (!response.ok) { const err = new Error(remote.error || 'Analysis failed.'); err.unsupported = response.status === 415 || response.status === 422; throw err; }
          if (!text && remote.extraction?.status === 'ok') { text = remote.extraction.text; transcriptSource = remote.extraction.provider; }
        } catch(e) { if(!disposed){st.dataset.state=e.unsupported?'unsupported':'failed';st.textContent=e.name==='AbortError'?'Analysis canceled. No report was saved.':e.name==='TimeoutError'?'Analysis timed out. Please try again.':e.message || 'The analysis server is unavailable.';busy(false);}return; }
      }
      if(disposed)return;
      const intent = text ? voxaScamIntent(text, lockSector) : { status: 'insufficient', priority: 'nee', score: 0, rules: [], words: 0 };
      let sha256 = null, audioInfo = {};
      if (lockedBlob) {
        try {
          const buf = await lockedBlob.arrayBuffer();
          sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
          if (lockMod === 'voice') { const ac = new AudioContext(); const a = await ac.decodeAudioData(buf.slice(0)); audioInfo = { sampleRate: a.sampleRate, channels: a.numberOfChannels }; ac.close(); }
        } catch {}
      }
      if (disposed) return;
      const inc = {
        id: uid(), at: Date.now(), modality: lockMod, sector: lockSector, policyVersion: S[lockSector].version,
        reportType: lockedMedia ? { voice: 'voice_authenticity', image: 'image_authenticity', video: 'video_authenticity' }[lockMod] : 'scam_analysis', uploadId: lockedMedia ? lockedUploadId : null,
        tags,
        priority: intent.priority, intent, transcript: text ? {text,source:transcriptSource} : null, media: lockedMedia && { ...lockedMedia, mime: lockedBlob?.type || mediaMime(), sha256, ...audioInfo }, status: 'open', notes: [],
        authenticity: remote?.authenticity || (lockedMedia
          ? { status: 'unavailable', code: 'MODEL_NOT_CONNECTED', message: `The ${lockMod} deepfake model service is not connected in this demo, so no authenticity result is shown.` }
          : { status: 'not_provided', code: 'NO_MEDIA', message: `No ${lockMod} file was provided.` }),
        meeting: readMeeting(),
        audioAuthenticity: remote?.audioAuthenticity || null, mediaInfo: remote?.media || null,
        language: remote?.extraction?.language || (lastExtraction && lastExtraction.text.trim() === text ? lastExtraction.language : null) || null,
        context: remote?.context || { status: 'unavailable', code: 'CONTEXT_NOT_CONNECTED', label: M.ctx },
        extraction: remote?.extraction ? {status:remote.extraction.status,message:remote.extraction.message,provider:remote.extraction.provider} : null,
        state: (() => { const auth = remote?.authenticity?.status === 'ok' || remote?.audioAuthenticity?.status === 'ok', req = lockedMedia ? auth : true; return req && intent.status === 'ok' ? 'complete' : (intent.status === 'ok' || auth) ? 'partial' : 'insufficient'; })(),
        limitations: VOXA_LIMITS
      };
      inc.persist = retainReport; inc.expiresAt = Date.now()+86400000; inc.consentedAt = Date.now();
      if (!store.set('incidents', [inc, ...incidents()])) { busy(false);btn.disabled=false; return; }
      if (inc.meeting) { try { sessionStorage.removeItem('voxa:meeting'); } catch {} }
      if (lockedBlob) previews.set(inc.id, { url: URL.createObjectURL(lockedBlob), kind: lockMod });
      {
        const labels = intent.priority === 'high' ? intent.rules.map(r => r.label) : [];
        if (inc.authenticity?.code === 'AI_GENERATED') labels.push(M.label + ' flagged as AI-generated');
        if (inc.audioAuthenticity?.code === 'AI_GENERATED') labels.push('Soundtrack flagged as AI-generated');
        if (labels.length) {
          const event = { at: Date.now(), source: lockedMedia?.name || 'Provided transcript', labels, incidentId: inc.id, persist: inc.persist, expiresAt: inc.expiresAt };
          store.set('alerts', [event, ...store.get('alerts', [])].slice(0, 200));
        }
      }
      st.dataset.state = 'completed';
      location.hash = inc.meeting?.meetingId && window.VoxaMeetings?.get(inc.meeting.meetingId) ? '#/meeting/' + inc.meeting.meetingId : '#/incident/' + inc.id;
    };
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function Incidents() {
    return `<div class="wrapv"><p class="report-eyebrow">Review your findings</p><h1>Call reports</h1><p class="sub">Search and filter saved analyses. VOXA does not persist raw media. Selected providers receive uploads; their retention policies apply.</p>
      <div class="filters"><input id="f-q" aria-label="Search reports" placeholder="Search ID or text…"><select id="f-src" aria-label="Filter source"><option value="">All sources</option><option value="uploaded">Uploaded media</option><option value="live">Live sessions</option></select><select id="f-rt" aria-label="Filter report type"><option value="">All report types</option>${Object.entries(RT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><select id="f-m" aria-label="Filter media type"><option value="">All types</option>${Object.entries(MODS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select><select id="f-s" aria-label="Filter sector"><option value="">All sectors</option>${Object.entries(S).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('')}</select>
      <select id="f-p" aria-label="Filter action priority"><option value="">All priorities</option>${Object.entries(PRI).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select>
      <select id="f-t" aria-label="Filter report status"><option value="">All statuses</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select>
      <input type="date" id="f-d" aria-label="Date"></div><div id="inc-table"></div></div>`;
  }
  function setupIncidents() {
    const draw = () => {
      const q = $('#f-q').value.toLowerCase(), mf = $('#f-m').value, rt = $('#f-rt').value, s = $('#f-s').value, p = $('#f-p').value, t = $('#f-t').value, d = $('#f-d').value, sr = $('#f-src').value;
      const list = incidents().filter(i => (!q || [i.id,i.media?.name,i.transcript?.text,i.intent.rules.map(r=>r.excerpt).join(' ')].filter(Boolean).join(' ').toLowerCase().includes(q)) && (!s || i.sector === s) && (!mf || modOf(i) === mf) && (!rt || reportTypeOf(i) === rt) && (!sr || (sr === 'live') === (i.media?.source === 'live')) && (!p || i.priority === p) && (!t || i.status === t) && (!d || new Date(i.at).toLocaleDateString('en-CA') === d));
      $('#inc-table').innerHTML = list.length ? `<div class="tw"><table class="t"><thead><tr><th>Call</th><th>Date</th><th>Report type</th><th>Media</th><th>Sector</th><th>Priority</th><th>State</th><th>Status</th></tr></thead><tbody>${list.map(i => `<tr class="click" data-open="${esc(i.id)}"><td><a href="#/incident/${encodeURIComponent(i.id)}">${esc(i.meeting?.title || i.media?.name || "Text analysis")}</a><small>${esc(i.id)}</small></td><td>${fmt(i.at)}</td><td>${esc(RT[reportTypeOf(i)])}</td><td>${MODS[modOf(i)].label}</td><td>${esc(S[i.sector]?.name || i.sector)}</td><td>${reportTypeOf(i) === 'noise_analysis' ? '—' : pill(PRI, i.priority)}</td><td>${esc(i.state)}</td><td>${pill(STATUS, i.status)}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="panelx"><p class="sub" style="margin:0">No reports match these filters. Try a different search, or run a new analysis.</p></div>`;
    };
    try { const pre = sessionStorage.getItem('voxa:search'); if (pre) { $('#f-q').value = pre; sessionStorage.removeItem('voxa:search'); } } catch {}
    { const pre = location.hash.split('/')[2]; if (pre === 'live' || pre === 'uploaded') $('#f-src').value = pre; }
    ['f-q', 'f-src', 'f-rt', 'f-m', 'f-s', 'f-p', 'f-t', 'f-d'].forEach(id => ($('#' + id).oninput = draw)); draw();
  }

  const previews = new Map();
  window.VoxaPreviews = previews;
  const revokePreview = id => { const pv = previews.get(id); if (pv) { if (pv.url) URL.revokeObjectURL(pv.url); if (pv.enhancedUrl) URL.revokeObjectURL(pv.enhancedUrl); previews.delete(id); } };
  window.VoxaRevokePreview = revokePreview;
  const pct = v => typeof v === 'number' && Number.isFinite(v) ? (Math.round(v * 10000) / 100).toFixed(2) + '%' : null;
  const table = list => `<table class="kvt"><tbody>${list.filter(r => r[1] !== null && r[1] !== undefined && r[1] !== '').map(([k, v, raw]) => `<tr><th scope="row">${esc(k)}</th><td>${raw ? v : esc(v)}</td></tr>`).join('')}</tbody></table>`;
  const section = (title, body, note) => `<section class="rep-sec"><h2>${esc(title)}</h2>${note ? `<p class="rep-note">${esc(note)}</p>` : ''}${body}</section>`;
  const NR = makeNoiseReport({ esc, fmt, incidents, previews, section, table, session, reportTypeOf, RT, STATUS });
  // One place that turns a /api/noise result into a saved report (used by Analyze Noise and the Noise reduction page).
  function saveNoiseReport({ noise, enhancedAudio, media, blob, uploadId, retain, sector: sec }) {
    const inc = {
      id: uid(), at: Date.now(), reportType: 'noise_analysis', uploadId, processing: 'completed', modality: 'voice',
      sector: sec, policyVersion: S[sec].version, tags: [], status: 'open', notes: [],
      priority: 'nee', intent: { status: 'insufficient', score: 0, rules: [], words: 0 }, transcript: null,
      media: { ...media, mime: blob.type || media.mime || 'audio/wav', sampleRate: noise.file.sampleRate, channels: noise.file.channels },
      authenticity: { status: 'unavailable', code: 'NOT_APPLICABLE', message: 'Voice authenticity is a separate report. This report measures noise and audio quality only.' },
      noise, state: 'complete', limitations: noise.limitations.join(' '),
      persist: retain, expiresAt: Date.now() + 86400000, consentedAt: Date.now()
    };
    let enhancedUrl = null;
    if (enhancedAudio?.base64) { try { enhancedUrl = URL.createObjectURL(new Blob([Uint8Array.from(atob(enhancedAudio.base64), ch => ch.charCodeAt(0))], { type: enhancedAudio.mime })); } catch {} }
    if (!store.set('incidents', [inc, ...incidents()])) { if (enhancedUrl) URL.revokeObjectURL(enhancedUrl); return null; }
    previews.set(inc.id, { url: URL.createObjectURL(blob), kind: 'voice', enhancedUrl });
    return inc.id;
  }
  const Acct = makeAccount({ $, esc, toast, fmt });
  const Priv = makePrivacy({ $, esc, toast, fmt, store, incidents, uid, section, table, STATUS, previews });
  const Sync = window.VoxaSync = makeSync({ store, incidents, toast, rerender: () => render() });
  const NP = makeNoisePage({ $, esc, incidents, fmt, reportTypeOf, postBlob, saveNoiseReport, setCleanup: fn => { cleanupAnalyze = fn; }, getSector: () => sector, upid, toast });
  const INTEL_ROWS = [['language','Language'],['dialect','Dialect'],['speakers','Speaker info'],['tone','Tone'],['context','Context'],['message','Message'],['translation','Translation (English)']];
  // Scam-intent graphs. Everything is computed from the rule matches of this report; nothing is estimated.
  const IG_CAT = {
    otp_pin: 'request', credentials_data: 'request', remote_access: 'request', money_transfer: 'request',
    urgency: 'pressure', legal_threat: 'pressure', secrecy: 'pressure', authority: 'impersonation'
  };
  const IG_COLOR = {request: '#4f46e5', pressure: '#e07b00', impersonation: '#0ea5e9'};
  const IG_NAME = {request: 'Sensitive requests', pressure: 'Pressure and threats', impersonation: 'Impersonation'};
  function intentGraphs(it, sec, transcript, priority) {
    const th = sec.thresholds || {medium: 4, high: 8};
    const rules = it.rules, score = it.score;
    // 1. Risk meter against this sector's thresholds
    const max = Math.max(th.high * 1.6, score * 1.1, 1), at = v => Math.min(100, v / max * 100);
    const forced = priority === 'high' && score < th.high;
    const meter = `<div class="ig-card"><h3>Risk meter</h3>
      <div class="ig-meter" role="img" aria-label="Rule score ${score}. Medium from ${th.medium}, high from ${th.high}.">
        <i class="z-low" style="width:${at(th.medium)}%"></i><i class="z-med" style="width:${at(th.high) - at(th.medium)}%"></i><i class="z-high" style="width:${100 - at(th.high)}%"></i>
        <b class="ig-pin" style="left:${at(score)}%"><span>${score}</span></b></div>
      <div class="ig-scale"><span>0</span><span style="left:${at(th.medium)}%">${th.medium}</span><span style="left:${at(th.high)}%">${th.high}</span></div>
      <p class="ig-cap">Rule score ${score} for ${esc(sec.name)}: Medium from ${th.medium}, High from ${th.high}.${forced ? ' Raised to High because a critical request was detected.' : ''}</p></div>`;
    // 2. Intent breakdown by category
    const byCat = {request: 0, pressure: 0, impersonation: 0};
    rules.forEach(r => { byCat[IG_CAT[r.id] || 'pressure'] += r.weight; });
    const tot = Object.values(byCat).reduce((a, b) => a + b, 0);
    const breakdown = `<div class="ig-card"><h3>Intent breakdown</h3>
      ${tot ? `<div class="ig-stack" role="img" aria-label="${Object.entries(byCat).map(([k, v]) => IG_NAME[k] + ' ' + v).join(', ')}">${Object.entries(byCat).filter(([, v]) => v).map(([k, v]) => `<i style="width:${v / tot * 100}%;background:${IG_COLOR[k]}" title="${IG_NAME[k]}: ${v}"></i>`).join('')}</div>` : '<div class="ig-stack empty"></div>'}
      <ul class="ig-legend">${Object.entries(byCat).map(([k, v]) => `<li><i style="background:${IG_COLOR[k]}"></i>${IG_NAME[k]}<b>${v ? Math.round(v / tot * 100) + '%' : '0%'}</b></li>`).join('')}</ul></div>`;
    // 3. Indicator weights
    const sorted = [...rules].sort((a, b) => b.weight - a.weight), wmax = Math.max(1, ...sorted.map(r => r.weight));
    const weights = `<div class="ig-card"><h3>Indicator weights</h3>${sorted.length ? sorted.map(r => `<div class="ig-bar"><span title="${esc(r.label)}">${esc(r.label)}${r.critical ? ' <em>critical</em>' : ''}</span><div><i style="width:${r.weight / wmax * 100}%;background:${IG_COLOR[IG_CAT[r.id] || 'pressure']}"></i></div><b>${r.weight}</b></div>`).join('') : '<p class="ig-cap">No indicators were triggered.</p>'}</div>`;
    // 4. Where in the transcript each indicator appears
    const pts = rules.map(r => ({r, pos: transcript ? transcript.indexOf(r.excerpt.slice(0, 60)) : -1})).filter(p => p.pos >= 0);
    const L = Math.max(1, transcript.length);
    const timeline = `<div class="ig-card"><h3>Where indicators appear</h3>
      ${pts.length ? `<div class="ig-track" role="img" aria-label="Positions of ${pts.length} indicators in the transcript">${pts.map(p => `<i style="left:${Math.min(98, p.pos / L * 100)}%;background:${IG_COLOR[IG_CAT[p.r.id] || 'pressure']}" title="${esc(p.r.label)}: ${esc(p.r.excerpt.slice(0, 90))}"></i>`).join('')}</div><div class="ig-scale flat"><span>Start of transcript</span><span>End</span></div>
      <p class="ig-cap">${pts.length} indicator${pts.length === 1 ? '' : 's'} located by text position. Hover a marker for the quoted text. Spoken timestamps are not available.</p>` : '<p class="ig-cap">Indicator positions need the transcript text.</p>'}</div>`;
    return `<div class="ig-grid">${meter}${breakdown}${weights}${timeline}</div>`;
  }
  function Incident(id) {
    const i = incidents().find(x => x.id === id);
    if (!i) return `<div class="wrapv"><h1>Report not found</h1><p class="sub">It may have been deleted. <a class="link" href="#/incidents">Back to call reports</a></p></div>`;
    if (reportTypeOf(i) === 'noise_analysis' && i.noise) return NR.view(i);
    if (reportTypeOf(i) === 'privacy_analysis' && i.privacy) return Priv.report(i);
    const mod = modOf(i), M = MODS[mod], sec = S[i.sector], it = i.intent;
    const audioOnly = i.authenticity?.status !== 'ok' && i.audioAuthenticity?.status === 'ok';
    const au = audioOnly ? i.audioAuthenticity : i.authenticity;
    const media = i.media || i.audio || null;
    const assessed = au.status === 'ok', flagged = assessed && au.code === 'AI_GENERATED', clear = assessed && au.code === 'NOT_FLAGGED';
    const providerName = {realitydefender:'Reality Defender',sealedrose:'Sealed Rose',gemini:'Gemini',deepgram:'Deepgram',luxand:'Luxand'};
    const verdict = flagged ? [(audioOnly ? 'AI-generated soundtrack' : 'AI-generated ' + M.label.toLowerCase()), 'bad'] : clear ? ['No AI detected', 'ok'] : au.code === 'SUSPICIOUS' ? ['Suspicious', 'warn'] : ['Not assessed', 'na'];
    const conf = pct(typeof au.confidence === 'number' ? au.confidence : null);
    const transcript = i.transcript?.text || '';
    const source = providerName[i.transcript?.source] || (i.transcript?.source === 'provided' ? 'Provided or reviewed text' : 'Not available');
    const mediaLine = media ? [M.label, media.size ? (media.size / 1024).toFixed(2) + ' KB' : null, media.duration ? media.duration + ' s' : null, media.width ? media.width + '×' + media.height : null].filter(Boolean).join(' · ') : 'Text only';
    const pv = previews.get(i.id);
    const preview = pv ? (pv.kind === 'image' ? `<img class="rep-media" src="${pv.url}" alt="Submitted image preview">` : pv.kind === 'video' ? `<video class="rep-media" src="${pv.url}" controls></video>` : `<audio src="${pv.url}" controls style="width:100%"></audio><canvas id="i-wave" class="rep-wave" height="120" aria-label="Audio waveform"></canvas>`)
      : `<p class="rep-note" style="margin:0">Preview unavailable. VOXA does not store media, so a preview exists only in the browser tab that ran the analysis.</p>`;
    const head = `<header class="rep-head"><div><p class="report-eyebrow">${esc(M.label)} detect report</p><h1>${esc(media?.name || 'Text submission')}</h1><p class="sub">${esc(M.label)} · ${fmt(i.at)} · ${esc(i.id)}</p></div><div class="rep-actions no-print"><button class="btn sec" id="i-pdf">Print report</button><a class="btn" href="#/analyze">New analysis</a></div></header>`;
    const sum = `<div class="rep-sum"><div><span>Verdict</span><b class="rep-badge ${verdict[1]}">${esc(verdict[0])}</b><small>${esc(providerName[au.provider] || 'No detector result')}</small></div>
      <div><span>Media</span><b>${esc(M.label)}</b><small>${esc(mediaLine)}</small></div>
      <div><span>Submitted</span><b>${fmt(i.at)}</b><small>${esc(session.email)}</small></div>
      <div><span>Confidence snapshot</span><b>${conf || (typeof au.aiScore === 'number' ? pct(au.aiScore) + ' score' : 'Unavailable')}</b><small>${media?.sha256 ? 'SHA-256 ' + esc(media.sha256.slice(0, 16)) + '…' : 'Reported by the detector'}</small></div></div>`;
    const warn = i.priority === 'high' ? `<div class="live-warning" role="alert"><b>High-risk request detected</b><p>Do not share OTPs, PINs or card details. Hang up and call back on an official number. For financial cyber fraud in India, call <a href="tel:1930">1930</a> or visit <a href="https://cybercrime.gov.in/" target="_blank" rel="noopener">cybercrime.gov.in</a>.</p></div>` : '';
    const fileDetails = table([['File type', M.label], ['File name', media?.name], ['Meeting', i.meeting?.title], ['Platform', i.meeting?.platform], ['Status', verdict[0]], ['Date submitted', fmt(i.at)], ['Author', session.email], ['Size (KB)', media?.size ? (media.size / 1024).toFixed(2) : null], ['Duration', media?.duration ? media.duration + ' s' : null], ['Dimensions', media?.width ? media.width + '×' + media.height + ' px' : null], ['Sector (locked)', sec.name], ['Policy version', i.policyVersion], ['Privacy', 'VOXA keeps no copy of the media. Providers apply their own retention.'], ['SHA-256', media?.sha256]]);
    const detectionHtml = a => {
      if (a?.status !== 'ok') return `<p class="rep-note" style="margin:0">${esc(a?.message || 'No detector result is available for this report.')}</p>`;
      const fl = a.code === 'AI_GENERATED', cl = a.code === 'NOT_FLAGGED', su = a.code === 'SUSPICIOUS';
      const label = fl ? 'AI-generated / manipulated' : cl ? 'No AI detected' : su ? 'Suspicious' : 'Not assessed';
      const modelRows = (a.models || []).map(m => ['Model · ' + m.name, m.status + (typeof m.score === 'number' ? ' (' + pct(m.score) + ')' : '')]);
      return table([['Label', label], ['Detector', providerName[a.provider] || a.provider], [a.provider === 'realitydefender' ? 'Manipulation score' : 'AI-generation score', pct(a.aiScore)], ['Deepfake score', pct(a.deepfakeScore)], ['Detector confidence', pct(typeof a.confidence === 'number' ? a.confidence : null)], ...modelRows]) + `<p class="rep-note">${esc(cl ? 'The detector found no sign of manipulation. This does not verify who is speaking or that the message is safe.' : su ? 'The result is inconclusive. Treat the media with caution and verify the source.' : 'The detector found signs of manipulation. Verify the source before acting.')} Scores come from the provider and do not guarantee accuracy.</p>`;
    };
    const detection = detectionHtml(au);
    const iv = i.intelligence;
    const intel = iv?.status === 'ok' ? table([...INTEL_ROWS.map(([k, l]) => [l, iv.data[k]]), ['Fraud type', iv.data.fraudType], ['Fraud confidence', iv.data.fraudConfidence === null ? null : iv.data.fraudConfidence + '%'], ['Fraud reasoning', iv.data.fraudReasoning]]) + `<p class="rep-note">Written by Gemini from the transcript text only. It cannot hear the audio, so it says nothing about voice authenticity. Check it against the transcript.</p>`
      : transcript.trim().length >= 20 ? `<p class="rep-note">Generate a structured reading of the transcript: language, context, message, English translation and fraud reasoning.</p><div class="row-actions no-print" style="margin-top:0"><button class="btn" id="i-intel">Generate intelligence analysis</button><span id="i-intel-state" class="sub" role="status" style="margin:0;align-self:center"></span></div>`
      : `<p class="rep-note" style="margin:0">Intelligence analysis needs a transcript. Run an analysis with Deepgram or Gemini transcription, or paste one.</p>`;
    const intent = it.status !== 'ok' ? `<p class="rep-note" style="margin:0">Not enough meaningful transcript to assess. No risk rating is shown.</p>`
      : `<div class="rep-row">${pill(PRI, i.priority)}<span>${it.rules.length ? `This ${mod === 'voice' ? 'call' : mod} shows ${esc(sec.summary)}.` : 'No scam-intent rules were triggered by this transcript.'}</span></div>${it.rules.map(r => `<div class="ev"><b>${esc(r.label)}</b> <small>weight ${r.weight}</small>${r.excerpt ? `“${esc(r.excerpt)}”` : '<small>Quoted text is not stored with saved reports.</small>'}</div>`).join('')}${intentGraphs(it, sec, transcript, i.priority)}<p class="rep-note">Rule score ${it.score} · ${it.words} words assessed on this device.</p>`;
    const transcriptBody = transcript ? `<div class="transcript-body">${esc(transcript)}</div><p class="rep-note">${esc(source)}${i.transcript?.provisional ? ' (includes interim text)' : ''} · ${(transcript.match(/\S+/g) || []).length} words. Automatic transcripts can contain errors; verify against the recording.</p><div class="no-print"><button class="btn sec" id="i-transcript">Download transcript</button> <button class="btn sec" id="i-pii">Scan for personal data</button></div>`
      : `<div class="transcript-empty">${esc(i.extraction?.message || 'No transcript was available. Choose Deepgram or Gemini when you run a new analysis.')}</div>`;
    const mi = i.mediaInfo || {};
    const stream = table([['Detected content type', mi.detectedType], ['Audio codec', mi.audio ? mi.audio.codec + ', ' + mi.audio.sampleRate + ' Hz' : null], ['Video codec', mi.video ? mi.video.codec + ', ' + mi.video.width + '×' + mi.video.height : null], ['Speech language', i.language],['Media type', media?.mime], ['Size', media?.size ? media.size.toLocaleString() + ' bytes' : null], ['Duration', media?.duration ? media.duration + ' s' : null], ['Sample rate', media?.sampleRate ? media.sampleRate.toLocaleString() + ' Hz' : null], ['Channels', media?.channels], ['Dimensions', media?.width ? media.width + '×' + media.height + ' px' : null], ['Source', media?.source === 'live' ? 'Live microphone stream' : media ? 'Uploaded or recorded file' : null], ['SHA-256', media?.sha256]]);
    return `<div class="wrapv rep">${head}${sum}${warn}
      ${section('File details', fileDetails)}
      ${section(M.label + ' authenticity result', detection)}
      ${i.audioAuthenticity ? section('Soundtrack authenticity (audio only)', detectionHtml(i.audioAuthenticity), 'The video audio track was checked separately from the visual result above.') : ''}
      ${media ? section('Media preview', preview) : ''}
      ${section('Scam-intent findings', intent)}
      ${section('Intelligence results', intel)}
      ${section('Transcript', transcriptBody)}
      ${i.context?.provider ? section('Additional checks', `<p class="rep-note" style="margin:0">${esc(i.context.message)}</p>${i.context.details ? `<pre class="context-response">${esc(i.context.details)}</pre>` : ''}`) : ''}
      ${section('Safe next steps · ' + sec.name, `<ul style="margin:0;padding-left:18px">${VOXA_SAFE_STEPS.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`)}
      ${stream.includes('<tr>') ? section('Media details', stream) : ''}
      ${NR.related(i)}
      <section class="rep-sec no-print"><h2>Status and notes</h2>
        <div class="filters" style="margin-top:0"><select id="i-status" aria-label="Report status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${i.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
        ${i.notes.map(n => `<div class="ev"><small>${fmt(n.at)}</small>${esc(n.text)}</div>`).join('')}
        <div class="filters"><input id="i-note" aria-label="Analyst note" style="flex:1;min-width:200px" placeholder="Add analyst note…"><button class="btn" id="i-add">Add note</button></div></section>
      <div class="lim"><b>Limitations.</b> ${esc(i.limitations)}</div>
      <div class="row-actions no-print"><button class="btn sec" id="i-json">Export JSON</button><button class="btn danger" id="i-del">Delete report</button><a class="link" href="#/incidents">Back to call reports</a></div></div>`;
  }
  async function drawWave(canvas, url) {
    try {
      const buf = await (await fetch(url)).arrayBuffer(), ctx = new AudioContext();
      const data = (await ctx.decodeAudioData(buf)).getChannelData(0); ctx.close();
      canvas.width = canvas.clientWidth || 900; const w = canvas.width, h = canvas.height, step = Math.max(1, Math.floor(data.length / w)), g = canvas.getContext('2d');
      g.fillStyle = '#6366f1';
      for (let x = 0; x < w; x++) { let m = 0; for (let k = 0; k < step; k++) m = Math.max(m, Math.abs(data[x * step + k] || 0)); const bar = Math.max(1, m * h); g.fillRect(x, (h - bar) / 2, 1, bar); }
    } catch { canvas.remove(); }
  }
  function setupIncident(id) {
    const save = fn => { store.set('incidents', incidents().map(x => (x.id === id ? fn(x) : x))); };
    const st = $('#i-status'); if (!st) return;
    st.onchange = () => { save(x => ({ ...x, status: st.value })); render(); };
    $('#i-add').onclick = () => { const t = $('#i-note').value.trim(); if (!t) return; save(x => ({ ...x, notes: [...x.notes, { at: Date.now(), text: t }] })); render(); };
    $('#i-pii')?.addEventListener('click', () => { const r = incidents().find(x => x.id === id); try { sessionStorage.setItem('voxa:privacyText', r?.transcript?.text || ''); } catch {} location.hash = '#/privacy'; });
    $('#i-transcript')?.addEventListener('click', () => {
      const report = incidents().find(x => x.id === id);
      const url = URL.createObjectURL(new Blob([report.transcript.text],{type:'text/plain;charset=utf-8'}));
      const a = document.createElement('a'); a.href = url; a.download = id + '-transcript.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
    });
    $('#i-json').onclick = () => {
      const i = incidents().find(x => x.id === id);
      const blob = new Blob([JSON.stringify({ app: 'VOXA', exportedAt: new Date().toISOString(), incident: i }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = id + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('#i-pdf').onclick = () => window.print();
    const pv = previews.get(id);
    if (pv && pv.kind === 'voice' && $('#i-wave')) drawWave($('#i-wave'), pv.url);
    if (pv?.enhancedUrl && $('#i-wave2')) drawWave($('#i-wave2'), pv.enhancedUrl);
    $('#i-intel')?.addEventListener('click', async e => {
      const b = e.currentTarget, st = $('#i-intel-state'), r = incidents().find(x => x.id === id); b.disabled = true; st.textContent = 'Analyzing transcript with Gemini…';
      try {
        const res = await fetch('/api/intelligence', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Voxa-Request': '1', 'X-Voxa-Provider-Consent': '1' }, body: JSON.stringify({ text: r.transcript.text }), signal: AbortSignal.timeout(120000) });
        const d = await res.json(); if (!res.ok) throw new Error(d.error || 'Analysis failed.');
        if (d.intelligence.status !== 'ok') throw new Error(d.intelligence.message);
        save(x => ({ ...x, intelligence: d.intelligence })); render();
      } catch (err) { st.textContent = err.name === 'TimeoutError' ? 'Timed out. Try again.' : err.message; b.disabled = false; }
    });
    let armed = false;
    $('#i-del').onclick = e => {
      if (!armed) { armed = true; e.target.textContent = 'Click again to confirm delete'; return; }
      revokePreview(id); store.set('incidents', incidents().filter(x => x.id !== id)); store.set('alerts',store.get('alerts',[]).filter(x=>x.incidentId!==id)); location.hash = '#/incidents';
    };
  }

  function Settings() {
    return `<div class="wrapv"><h1>Settings</h1>
      <div class="panelx field"><h3>Default sector</h3><select id="s-sector">${Object.entries(S).map(([k, v]) => `<option value="${k}" ${k === sector ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>
      <div class="panelx"><h3>Privacy and retention</h3><p class="sub" style="margin:0">VOXA does not persist raw media. Selected providers receive uploads; their retention policies apply. Reports and alerts stay in this tab session by default. Optional local retention expires after 24 hours; closed apps purge on next use. Delete reports individually or use Delete all reports below. Browser restoration may restore a previous tab session. Voice embeddings are not collected.</p></div>
      <div class="panelx"><h3>Model status</h3>${statusList()}</div>
      <div class="row-actions"><button class="btn danger" id="s-wipe">Delete all reports</button><button class="btn sec" id="s-out">Sign out</button></div></div>`;
  }
  function setupSettings() {
    const refresh=async()=>{const el=$('#settings-services'),b=$('#s-refresh');b.disabled=true;el.textContent='Checking services…';try{const r=await fetch('/api/status?probe=1');if(!r.ok)throw Error();const d=await r.json();if(!el.isConnected)return;const health={ok:'Reachable','not-probed':'Not tested (a test would use credits)','invalid-key':'Key rejected','unreachable':'Unreachable','rate-limited':'Rate limited',error:'Provider error'};el.innerHTML='<div><b>Fraud-intent rules</b><span>Runs on this device</span></div>'+`<div><b>FFmpeg</b><span>${d.tools.ffmpeg?'Available (video checks, audio extraction)':'Not available: video checks are limited'}</span></div>`+Object.values(d.details).map(x=>`<div><b>${esc(x.label)}</b><span>${!x.configured?'Not configured':!x.allowed?esc(x.blockedReason):esc(health[x.health]||x.health)}<br><small>${esc(x.note)}</small></span></div>`).join('');}catch(e){if(el.isConnected)el.textContent=e?.message||'Could not reach the analysis server.';}finally{b.disabled=false;}};
    $('#s-refresh').onclick=refresh;refresh();
    $('#s-sector').onchange = e => { sector = e.target.value; sel.value = sector; store.set('sector', sector); toast('Default sector saved.'); };
    $('#s-out').onclick = () => $('#logout').click();
    let armed = false;
    $('#s-wipe').onclick = e => { if (!armed) { armed = true; e.target.textContent = 'Click again to confirm'; return; } store.del('incidents'); store.del('alerts'); toast('All reports and alerts deleted.'); armed = false; e.target.textContent = 'Delete all reports'; };
  }
  /* ---------- router ---------- */
  const Hist = makeHistory({$,esc,store,incidents,PRI,pill,STATUS,toast,reportTypeOf,RT});
  const OWN = { history:['History',Hist.View,Hist.setup], noise:['Noise reduction',NP.View,NP.setup], privacy:['Privacy scan',Priv.View,Priv.setup], team:['Team',Acct.Team,Acct.setupTeam], profile:['Account',Acct.Account,Acct.setupAccount], audit:['Audit log',Acct.Audit,Acct.setupAudit], 'call-safety':['Call safety dashboard',Safety.Dashboard,Safety.setupDashboard], live:['Live monitor',Safety.Live,Safety.setupLive], meetings:['Meetings',Safety.Meetings,Safety.setupMeetings], integrations:['Integrations',Mod.Integrations,Mod.setupIntegrations], intelligence:['Intelligence',Mod.Intelligence,Mod.setupIntelligence], signal:['Signal',Mod.Signal,Mod.setupSignal], watermarking:['Watermarking',Mod.Watermarking,Mod.setupWatermarking], 'chrome-extension':['Chrome extension',Mod.ChromeExtension,Mod.setupChromeExtension], evaluation:['Evaluation',Safety.Evaluation,Safety.setupEvaluation], analyze: ['New analysis', Analyze, setupAnalyze], incidents: ['Call reports', Incidents, setupIncidents], settings: ['Settings', Settings, setupSettings] };
  function tabFor(route) {
    if (route === 'live') return 'live';
    if (['incidents','evaluation'].includes(route)) return 'reports';
    for (const [id, sd] of Object.entries(C.SIDE)) if (sd.groups.some(g => g[1].some(i => i[2] === '#/' + route))) return id;
    return 'detect';
  }
  // Topbar: alert bell, search, full screen
  const updateBell = () => { const n = store.get('alerts', []).filter(a => !a.retracted).length, el = $('#bell-n'); if (el) { el.hidden = !n; el.textContent = n > 99 ? '99+' : n; } };
  $('#top-q')?.addEventListener('keydown', e => { if (e.key === 'Enter') { try { sessionStorage.setItem('voxa:search', e.target.value.trim()); } catch {} e.target.value = ''; e.target.blur(); if (location.hash === '#/incidents') render(); else location.hash = '#/incidents'; } });
  addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#top-q')?.focus(); } });
  $('#fs')?.addEventListener('click', () => { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch {} });
  // Sidebar icons (stroke SVG, matched by label)
  const NAV_SVG = {
    denoise: '<path d="M3 12h2l1.5-5 2 10 2-12 2 14 1.5-7h1.5"/><path d="M17 12h4"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    shield: '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
    upload: '<path d="M12 16V4m0 0-4 4m4-4 4 4M5 20h14"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6"/>',
    flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-3 3 3 3m-6 0 2 2"/>',
    users: '<path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"/><circle cx="9.5" cy="7" r="3.5"/><path d="M21 19v-1a4 4 0 0 0-3-3.9M16 3.2a3.5 3.5 0 0 1 0 6.6"/>',
    puzzle: '<path d="M10 4a2 2 0 1 1 4 0v1h4v4h1a2 2 0 1 1 0 4h-1v5h-5v-1a2 2 0 1 0-4 0v1H4v-5h1a2 2 0 1 0 0-4H4V5h6z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    wave: '<path d="M3 12h2M7 8v8M11 4v16M15 8v8M19 10v4M21 12h0"/>'
  };
  const navIcon = label => {
    const l = label.toLowerCase();
    const k = /noise/.test(l) ? 'denoise' : /privacy|audit/.test(l) ? 'shield' : /call safety|^dashboard|overview/.test(l) ? (l.includes('call safety') ? 'shield' : 'grid') : /analy|upload/.test(l) ? 'upload' : /live|speech|meeting|voice|tts|text-to/.test(l) ? 'mic' : /report|incident|flagged|history/.test(l) ? 'file' : /evaluat|intellig/.test(l) ? 'flask' : /setting/.test(l) ? 'gear' : /key/.test(l) ? 'key' : /team|users|voices/.test(l) ? 'users' : /integrat|chrome|agent/.test(l) ? 'puzzle' : /investig/.test(l) ? 'search' : /watermark|library/.test(l) ? 'layers' : /project|enhance/.test(l) ? 'video' : /signal/.test(l) ? 'wave' : 'grid';
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NAV_SVG[k]}</svg>`;
  };
  function render() {
    cleanupAnalyze(); cleanupAnalyze = () => {};
    Safety.cleanup();
    if (mobileLayout.matches) setSidebar(false);
    const [, route = 'dashboard', param] = (location.hash || '#/dashboard').split('/');
    const aliases={'create-voice':'analyze','api-key':'api-keys','detect-dashboard':'dashboard'};
    if (aliases[route]) { location.replace('#/'+aliases[route]); return; }
    if (route === 'dashboard') { location.replace('#/call-safety'); return; }
    if (route === 'analyze' && MODS[param] && modality !== param) modality = param;
    const view = $('#view');
    let entry;
    if (route === 'incident') entry = [() => Incident(param), () => setupIncident(param)];
    else if (route === 'invite') entry = [Acct.Invite, () => Acct.setupInvite(param)];
    else if (route === 'meeting') entry = [() => window.VoxaMeetings.report(param), () => window.VoxaMeetings.setupReport(param)];
    else if (OWN[route]) entry = OWN[route].slice(1);
    else if (C.views[route]) entry = C.views[route];
    else entry=[()=>`<div class="wrapv"><p class="report-eyebrow">Page unavailable</p><h1>This page is no longer part of VOXA.</h1><p class="sub">Use the dashboard to find analysis tools, reports and settings.</p><a class="btn" href="#/dashboard">Go to dashboard</a></div>`];
    const tab = route === 'incidents' && param === 'live' ? 'live' : tabFor(route === 'incident' ? 'incidents' : route);
    const side = C.SIDE[tab];
    $('#tabs').innerHTML = C.TABS.map(t => `<a class="tab ${t.id === tab ? 'active' : ''}" href="${t.home}">${t.label}</a>`).join('');
    const active = route === 'incident' ? '#/incidents' : route === 'meeting' ? '#/meetings' : '#/' + route + (route === 'incidents' && param ? '/' + param : '');
    $('#side-body').innerHTML = (side.cta ? `<button class="cta" id="cta">${side.cta}</button>` : '') +
      side.groups.map(([g, items]) => `<div class="group"><h6><span>${g}</span><span>⌄</span></h6>${items.filter(([, , h]) => h !== '#/audit' || window.VoxaMe?.user?.isSuperAdmin).map(([l, i, h]) => `<a class="nav ${h === active ? 'active' : ''}" href="${h}"><i>${navIcon(l)}</i>${l}</a>`).join('')}</div>`).join('');
    $('#cta')?.addEventListener('click', () => (location.hash = side.ctaHref || '#/analyze'));
    view.classList.toggle('pf', ['reports','team','api-keys','profile'].includes(route));
    view.innerHTML = entry[0]({ first: session.name.split(' ')[0], session });
    view.focus({preventScroll:true});
    view.onclick = e => { const r = e.target.closest('[data-open]'); if (r) location.hash = '#/incident/' + r.dataset.open; };
    entry[1]?.();
    document.title = (OWN[route]?.[0] || C.titles?.[route] || (route==='incident'?'Analysis report':route==='profile'?'Workspace details':'Page unavailable')) + ' - VOXA';
    updateBell();
    scrollTo(0, 0);
  }
  document.addEventListener('click', e => { const t = e.target.closest('[data-toast]'); if (t) toast(t.dataset.toast); });
  addEventListener('hashchange', render);
  render();
  Sync.start().then(() => { const r = (location.hash || '').split('/')[1] || ''; if (window.VoxaMe?.user?.isSuperAdmin || ['', 'dashboard', 'call-safety', 'history', 'incidents', 'reports'].includes(r)) render(); }).catch(() => {});
})();
