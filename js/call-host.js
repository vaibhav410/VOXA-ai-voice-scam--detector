/* VOXA Protected Call, host side. Two-person WebRTC audio call. The other person's audio is transcribed live
   (Deepgram via /api/live) and scored by VoxaCallRisk. Auto-end is off by default and can only end THIS VOXA call.
   Nothing here can hang up phone, WhatsApp, Meet or Zoom calls. No audio is recorded or stored. */
window.makeCallHost = function (c) {
  const { $, esc, toast, store, incidents, uid, getSector, setCleanup } = c;
  const LABEL = { pending: 'Listening', low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical', unavailable: 'Analysis unavailable' };
  const CLS = { pending: 'na', low: 'ok', medium: 'warn', high: 'bad', critical: 'crit', unavailable: 'na' };
  const loadPolicy = () => { try { return VoxaCallRisk.normalizePolicy(JSON.parse(localStorage.getItem('voxa:callPolicy') || '{}')); } catch { return VoxaCallRisk.normalizePolicy({}); } };
  const savePolicy = p => { try { localStorage.setItem('voxa:callPolicy', JSON.stringify(p)); } catch {} };
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function View() {
    const p = loadPolicy(), a = p.autoEnd, t = p.thresholds;
    return `<div class="wrapv an pc"><p class="report-eyebrow">Live protection</p><h1>Protected call</h1>
      <p class="sub">Talk to someone through VOXA and see, live, whether their requests look like a scam. Their speech is transcribed and checked against VOXA's scam rules; nothing is recorded. This works only for calls made here: VOXA cannot end phone, WhatsApp, Meet or Zoom calls.</p>
      <div id="pc-setup">
        <section class="an-card an-options pc-opts">
          <label class="an-consent"><input type="checkbox" id="pc-consent"> I will tell the other person that VOXA analyzes their speech for scam patterns, and I have their permission. They must also agree before they can join.</label>
          <label class="pc-switch"><input type="checkbox" id="pc-auto" ${a.enabled ? 'checked' : ''}> <span><b>Auto-end high-risk calls</b><small>Off by default. Ends only this VOXA call, after repeated, confident evidence and a ${a.countdownSeconds}-second countdown you can cancel. Never acts when analysis is unavailable.</small></span></label>
          <details class="pc-adv"><summary>Risk thresholds and auto-end policy</summary>
            <div class="pc-grid">
              <label>Medium from score<input type="number" id="pc-m" min="1" max="50" step="0.5" value="${t.medium}"></label>
              <label>High from score<input type="number" id="pc-h" min="1" max="80" step="0.5" value="${t.high}"></label>
              <label>Critical from score<input type="number" id="pc-c" min="1" max="120" step="0.5" value="${t.critical}"></label>
              <label>Auto-end at<select id="pc-min"><option value="critical" ${a.minState === 'critical' ? 'selected' : ''}>Critical</option><option value="high" ${a.minState === 'high' ? 'selected' : ''}>High or critical</option></select></label>
              <label>Evidence needed (distinct)<input type="number" id="pc-ev" min="2" max="10" value="${a.minEvidence}"></label>
              <label>From separate statements<input type="number" id="pc-seg" min="2" max="10" value="${a.minSegments}"></label>
              <label>Minimum recognition confidence<input type="number" id="pc-conf" min="0.5" max="0.99" step="0.01" value="${a.minConfidence}"></label>
              <label>Countdown (seconds)<input type="number" id="pc-cd" min="3" max="30" value="${a.countdownSeconds}"></label>
            </div><p class="an-info">Scores come from the same rules as uploaded recordings. Values outside safe ranges are clamped (for example, auto-end always needs at least two pieces of evidence from two statements).</p></details>
        </section>
        <div class="an-foot"><div class="service-chips"><span class="service-chip ok">Browser-to-browser audio</span><span class="service-chip ok">No recording</span></div><div class="an-actions"><span id="pc-state" role="status"></span><button class="mt-btn primary" id="pc-start" type="button">Start protected call</button></div></div>
      </div>
      <div id="pc-live" hidden>
        <section class="an-card pc-invite" id="pc-invite"><div class="an-card-h"><h2>Invite the other person</h2><span class="an-info" id="pc-status">Waiting for them to join…</span></div>
          <div class="an-card-b"><div class="pc-link"><input id="pc-link" readonly aria-label="Invite link"><button class="mt-btn sm" id="pc-copy" type="button">Copy link</button></div><p class="an-info">Send this link yourself. It works once for one person, expires in 2 hours, and asks them for consent before they join.</p></div></section>
        <div class="pc-warn" id="pc-warn" role="alert" hidden></div>
        <div class="pc-cols">
          <section class="an-card"><div class="an-card-h"><h2>Live risk</h2><span class="pc-chip na" id="pc-chip">Listening</span></div>
            <div class="an-card-b"><dl class="kv pc-kv"><dt>Rule score</dt><dd id="pc-score">–</dd><dt>Recognition confidence</dt><dd id="pc-confv">–</dd><dt>Auto-end</dt><dd id="pc-autov">–</dd></dl>
              <h3 class="pc-h3">Evidence</h3><div id="pc-ev-list"><p class="an-info">No evidence yet.</p></div><div id="pc-prov"></div></div></section>
          <section class="an-card"><div class="an-card-h"><h2>What they are saying</h2><span class="an-info" id="pc-clock">0:00</span></div>
            <div class="an-card-b"><div class="pc-transcript" id="pc-text">Waiting for speech…</div><p class="an-info">Automatic transcription can mishear words, especially with noise or mixed languages. Grey text is not yet confirmed and never raises the risk.</p></div></section>
        </div>
        <audio id="pc-remote" autoplay></audio>
        <div class="an-foot"><div></div><div class="an-actions"><button class="mt-btn" id="pc-mute" type="button">Mute my mic</button><button class="mt-btn danger" id="pc-end" type="button">End call</button></div></div>
      </div>
      <div id="pc-done" hidden></div></div>`;
  }

  function setup() {
    let ws = null, live = null, pc = null, rec = null, mic = null, remote = null, engine = null, started = 0, clock = null, tick = null, countdown = null, ended = false, roomId = null, lastEval = null, autoEnded = null;
    const policyFromForm = () => VoxaCallRisk.normalizePolicy({
      thresholds: {medium: +$('#pc-m').value, high: +$('#pc-h').value, critical: +$('#pc-c').value},
      autoEnd: {enabled: $('#pc-auto').checked, minState: $('#pc-min').value, minEvidence: +$('#pc-ev').value, minSegments: +$('#pc-seg').value, minConfidence: +$('#pc-conf').value, countdownSeconds: +$('#pc-cd').value}
    });
    const cleanup = () => {
      clearInterval(clock); clearInterval(tick); clearInterval(countdown?.timer);
      try { if (rec?.state === 'recording') rec.stop(); } catch {}
      mic?.getTracks().forEach(t => t.stop()); remote?.getTracks().forEach(t => t.stop());
      try { pc?.close(); } catch {}
      try { if (live && live.readyState < 2) { live.send(JSON.stringify({type: 'stop'})); live.close(); } } catch {}
      try { if (ws && ws.readyState < 2) ws.close(); } catch {}
      rec = mic = remote = pc = live = null;
    };
    setCleanup(() => { if (!ended && ws?.readyState === 1) { try { ws.send(JSON.stringify({type: 'end', reason: 'hangup'})); } catch {} } ended = true; cleanup(); });

    const render = () => {
      if (!engine) return;
      const r = lastEval = engine.evaluate();
      const key = r.status === 'unavailable' ? 'unavailable' : r.status === 'pending' ? 'pending' : r.state;
      const chip = $('#pc-chip'); if (!chip) return;
      chip.className = 'pc-chip ' + CLS[key]; chip.textContent = LABEL[key];
      $('#pc-score').textContent = r.score === null || r.status !== 'ok' ? '–' : r.score;
      $('#pc-confv').textContent = typeof r.confidence === 'number' ? Math.round(r.confidence * 100) + '% (Deepgram)' : '–';
      $('#pc-autov').textContent = engine.policy.autoEnd.enabled ? (r.autoEnd.eligible ? 'Policy met' : r.autoEnd.why) : 'Off';
      $('#pc-ev-list').innerHTML = r.evidence.length ? r.evidence.map(e => `<div class="ev"><b>${esc(e.label)}</b> <small>${e.t !== null ? 'at ' + mmss(e.t) : ''}${typeof e.confidence === 'number' ? ' · ' + Math.round(e.confidence * 100) + '% confidence' : ''}${e.segments > 1 ? ' · heard ' + e.segments + ' times' : ''}${e.qualifies ? '' : ' · below the confidence needed for auto-end'}</small>“${esc(e.excerpt)}”</div>`).join('') : '<p class="an-info">No evidence yet.</p>';
      $('#pc-prov').innerHTML = r.provisional.length ? `<p class="an-info">Possibly (not yet confirmed): ${r.provisional.map(x => esc(x.label)).join(', ')}</p>` : '';
      if (r.status === 'unavailable') showWarn(`<b>Analysis unavailable</b><p>${esc(r.reason || '')} The call is not being judged, so treat it with care. VOXA will not end it automatically.</p>`);
      else if (r.status === 'ok' && (r.state === 'high' || r.state === 'critical') && !countdown) showWarn(`<b>${r.state === 'critical' ? 'Critical' : 'High'} risk</b><p>${esc(r.evidence.map(e => e.label).join(', '))}. Do not share OTPs, PINs or card details, and do not send money. Hang up and call back on an official number.</p>`);
      else if (!countdown) $('#pc-warn').hidden = true;
      if (r.status === 'ok' && r.autoEnd.eligible && !countdown && !ended) startCountdown(r);
      if (countdown && !(r.status === 'ok' && r.autoEnd.eligible)) stopCountdown('Auto-end paused: ' + (r.autoEnd?.why || 'policy no longer met') + '.');
    };
    const showWarn = html => { const w = $('#pc-warn'); if (w) { w.innerHTML = html; w.hidden = false; } };
    function startCountdown(r) {
      let left = r.autoEnd.countdownSeconds;
      countdown = {reasons: r.autoEnd.reasons, timer: null};
      const paint = () => showWarn(`<b>Ending this call in ${left} s</b><p>Reason: ${esc(r.autoEnd.reasons.join(', '))}. This is decision support, not proof.</p><button class="mt-btn sm" id="pc-keep" type="button">Keep the call</button>`);
      paint(); $('#pc-warn').classList.add('pc-count');
      document.addEventListener('click', keep);
      countdown.timer = setInterval(() => {
        left--;
        if (left > 0) return paint();
        clearInterval(countdown.timer);
        const now = engine.evaluate();
        if (now.status === 'ok' && now.autoEnd.eligible) endCall('risk_policy', now); else stopCountdown('Auto-end cancelled: ' + now.autoEnd.why);
      }, 1000);
    }
    function keep(e) { if (e.target?.id !== 'pc-keep') return; engine.cancelAutoEnd(); stopCountdown('You kept the call. Auto-end is off for the rest of this call.'); toast('Call kept. Stay careful.'); }
    function stopCountdown(msg) { if (!countdown) return; clearInterval(countdown.timer); countdown = null; document.removeEventListener('click', keep); $('#pc-warn')?.classList.remove('pc-count'); showWarn(`<p>${esc(msg)}</p>`); }

    function startAnalysis(stream) {
      if (!window.MediaRecorder) { engine.setAvailable(false, 'This browser cannot stream audio for analysis.'); render(); return; }
      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      try { live = new WebSocket(proto + location.host + '/api/live', window.VoxaAuth?.wsProtocols?.()); } catch { engine.setAvailable(false, 'Live transcription could not start.'); render(); return; }
      const lost = reason => { if (ended) return; engine.setAvailable(false, reason); render(); };
      live.onmessage = ev => {
        let d; try { d = JSON.parse(ev.data); } catch { return; }
        if (d.type === 'ready') {
          engine.setAvailable(true); engine.heartbeat();
          const audioOnly = new MediaStream(stream.getAudioTracks());
          const mime = MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
          rec = new MediaRecorder(audioOnly, mime ? {mimeType: mime} : undefined);
          // Send bytes in order: Chrome can fail to send a MediaRecorder Blob directly ("Failed to load Blob") and drop the socket.
          let q = Promise.resolve(); const sock = live;
          rec.ondataavailable = e => { if (!e.data.size) return; const b = e.data; q = q.then(() => b.arrayBuffer()).then(buf => { if (sock.readyState === 1) sock.send(buf); }).catch(() => {}); };
          rec.start(250);
        } else if (d.type === 'transcript') {
          engine.add({text: d.text, final: d.final, confidence: d.confidence, t: (Date.now() - started) / 1000});
          const txt = engine.transcript(), interim = d.final ? '' : d.text;
          $('#pc-text').innerHTML = (txt ? esc(txt) : '') + (interim ? ` <span class="pc-interim">${esc(interim)}</span>` : '') || 'Listening…';
          render();
        } else if (d.type === 'error') lost(d.message || 'Live transcription failed.');
        else if (d.type === 'ended') lost('Live transcription ended.');
      };
      live.onerror = () => lost('Live transcription is unavailable (the service may be off, busy or not configured).');
      live.onclose = () => lost('Live transcription disconnected.');
    }

    // The guest left (closed the tab or lost network). Drop their connection and the analysis stream for it; if they
    // rejoin with the same link, a fresh connection and transcription stream start.
    function dropPeer() {
      clearInterval(tick); tick = null;
      try { if (rec?.state === 'recording') rec.stop(); } catch {}
      if (live) { live.onclose = live.onerror = live.onmessage = null; try { live.close(); } catch {} }
      try { pc?.close(); } catch {}
      remote?.getTracks().forEach(t => t.stop());
      rec = live = pc = remote = null;
      if (engine) { engine.setAvailable(false, 'The other person disconnected.'); render(); }
    }
    async function connectPeer(iceServers) {
      if (pc) dropPeer();
      pc = new RTCPeerConnection({iceServers});
      mic.getTracks().forEach(t => pc.addTrack(t, mic));
      pc.onicecandidate = e => { if (e.candidate) ws.send(JSON.stringify({type: 'signal', data: {candidate: e.candidate.toJSON()}})); };
      pc.ontrack = e => {
        if (remote) return;
        remote = e.streams[0] || new MediaStream([e.track]);
        $('#pc-remote').srcObject = remote; if (!started) started = Date.now();
        $('#pc-status').textContent = 'Connected'; $('#pc-invite').classList.add('pc-connected');
        if (!clock) clock = setInterval(() => { const el = $('#pc-clock'); if (el) el.textContent = mmss((Date.now() - started) / 1000); }, 1000);
        tick = setInterval(render, 1000);
        startAnalysis(remote);
      };
      pc.onconnectionstatechange = () => { if (['failed', 'disconnected'].includes(pc?.connectionState) && !ended) { $('#pc-status').textContent = pc.connectionState === 'failed' ? 'Connection failed (network may block direct calls)' : 'Reconnecting…'; } };
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({type: 'signal', data: {sdp: pc.localDescription.toJSON()}}));
    }

    function endCall(reason, r) {
      if (ended) return;
      ended = true;
      const ev = r || lastEval || engine?.evaluate();
      try { ws?.send(JSON.stringify({type: 'end', reason, state: ev?.state || null, ruleIds: (ev?.evidence || []).map(e => e.id)})); } catch {}
      if (reason === 'risk_policy') autoEnded = {at: Date.now(), reasons: ev.autoEnd.reasons, state: ev.state};
      finish(reason === 'risk_policy' ? 'auto' : 'you');
    }
    function finish(by) {
      const ev = engine ? engine.evaluate() : null, duration = started ? Math.round((Date.now() - started) / 1000) : 0, transcript = engine?.transcript() || '';
      cleanup(); ended = true;
      $('#pc-live').hidden = true;
      const head = by === 'auto' ? `<div class="pc-warn pc-ended" role="alert"><b>VOXA ended this call</b><p>Reason: ${esc(autoEnded.reasons.join(', '))} (risk ${esc(autoEnded.state)}). The other person only saw that the call ended.</p><p>Do not call back on a number they give you. If money or codes were involved, contact your bank through its official number; in India you can also call 1930.</p></div>`
        : by === 'them' ? '<div class="pc-warn"><b>The other person ended the call.</b></div>' : '<div class="pc-warn"><b>You ended the call.</b></div>';
      $('#pc-done').hidden = false;
      $('#pc-done').innerHTML = `${head}<section class="an-card"><div class="an-card-h"><h2>Call summary</h2><span class="an-info">${duration ? mmss(duration) : 'not connected'}</span></div><div class="an-card-b">
        <dl class="kv"><dt>Final risk</dt><dd>${ev ? esc(ev.status === 'ok' ? LABEL[ev.state] : LABEL[ev.status]) : '–'}</dd><dt>Evidence</dt><dd>${ev?.evidence?.length ? esc(ev.evidence.map(e => e.label).join(', ')) : 'None'}</dd><dt>Auto-end</dt><dd>${by === 'auto' ? 'Ended the call' : engine?.policy.autoEnd.enabled ? 'On, not triggered' : 'Off'}</dd></dl>
        ${transcript ? `<div class="transcript-body">${esc(transcript)}</div>` : ''}
        <div class="row-actions">${transcript ? '<button class="mt-btn primary" id="pc-save" type="button">Save as report</button>' : ''}<a class="mt-btn" href="#/call" id="pc-again">New protected call</a></div>
        <p class="an-info">No audio was recorded. The transcript stays in this browser unless you save the report.</p></div></section>`;
      $('#pc-again')?.addEventListener('click', e => { e.preventDefault(); dispatchEvent(new HashChangeEvent('hashchange')); });
      $('#pc-save')?.addEventListener('click', () => {
        const sector = getSector(), intent = voxaScamIntent(transcript, sector);
        const inc = {id: uid(), at: started || Date.now(), reportType: 'scam_analysis', modality: 'voice', sector, policyVersion: VOXA_SECTORS[sector]?.version, status: 'open', notes: [], tags: [], priority: intent.priority, intent,
          transcript: {text: transcript, source: 'deepgram'}, media: {name: 'VOXA protected call', source: 'live', duration}, state: 'complete',
          authenticity: {status: 'unavailable', code: 'NOT_CHECKED', message: 'Protected calls check what is said, not whether the voice is synthetic.'},
          call: {autoEnded: by === 'auto', reasons: autoEnded?.reasons || [], finalState: ev?.state || null}, limitations: VOXA_LIMITS, persist: false, expiresAt: Date.now() + 86400000};
        if (store.set('incidents', [inc, ...incidents()])) location.hash = '#/incident/' + inc.id;
      });
    }

    if (!window.isSecureContext) {
      const secure = 'https://' + location.host + location.pathname + location.hash;
      $('#pc-setup').insertAdjacentHTML('afterbegin', `<div class="pc-warn" role="alert"><b>The microphone is blocked on this address</b><p>Browsers allow calls and recording only on HTTPS or localhost. Open <a href="${esc(secure)}">${esc(secure)}</a> instead (on a local network address, accept the one-time certificate warning).</p></div>`);
    }
    $('#pc-auto').onchange = () => savePolicy(policyFromForm());
    document.querySelectorAll('.pc-grid input, .pc-grid select').forEach(el => (el.onchange = () => savePolicy(policyFromForm())));
    $('#pc-start').onclick = async () => {
      if (!$('#pc-consent').checked) return toast('Confirm you have the other person\'s permission first.');
      if (!window.isSecureContext) return toast('The microphone is blocked because this page is not secure. Open VOXA with https:// (for example https://' + location.host + ') or on localhost.');
      if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) return toast('This browser cannot make calls. Try a recent Chrome, Edge, Firefox or Safari.');
      const policy = policyFromForm(); savePolicy(policy);
      $('#pc-start').disabled = true; $('#pc-state').textContent = 'Starting…';
      try { mic = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}}); }
      catch { $('#pc-start').disabled = false; $('#pc-state').textContent = ''; return toast('Microphone permission is needed to talk. On another device, VOXA must be opened over HTTPS.'); }
      let room;
      try {
        const r = await fetch('/api/calls', {method: 'POST', headers: {'X-Voxa-Request': '1'}});
        room = await r.json(); if (!r.ok) throw new Error(room.error || 'Could not create the call.');
      } catch (e) { mic.getTracks().forEach(t => t.stop()); $('#pc-start').disabled = false; $('#pc-state').textContent = ''; return toast(e.message); }
      roomId = room.roomId; engine = VoxaCallRisk.create(policy, getSector());
      $('#pc-setup').hidden = true; $('#pc-live').hidden = false;
      $('#pc-link').value = location.origin + room.invitePath;
      $('#pc-copy').onclick = () => navigator.clipboard?.writeText($('#pc-link').value).then(() => toast('Invite link copied.'), () => toast('Select the link and copy it.'));
      $('#pc-end').onclick = () => endCall('hangup');
      $('#pc-mute').onclick = () => { const t = mic?.getAudioTracks()[0]; if (!t) return; t.enabled = !t.enabled; $('#pc-mute').textContent = t.enabled ? 'Mute my mic' : 'Unmute my mic'; };
      ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/call');
      ws.onopen = () => ws.send(JSON.stringify({type: 'hello', room: room.roomId, role: 'host', key: room.hostKey, consent: true}));
      let ice = [];
      ws.onmessage = async ev => {
        const m = JSON.parse(ev.data);
        if (m.type === 'joined') { ice = m.iceServers || []; if (m.peerPresent) await connectPeer(ice); }
        else if (m.type === 'peer-joined') { $('#pc-status').textContent = 'Connecting…'; await connectPeer(ice); }
        else if (m.type === 'signal') {
          if (m.data.sdp) await pc?.setRemoteDescription(m.data.sdp);
          else if (m.data.candidate) { try { await pc?.addIceCandidate(m.data.candidate); } catch {} }
        } else if (m.type === 'peer-left') { $('#pc-status').textContent = 'The other person disconnected. Waiting…'; $('#pc-invite').classList.remove('pc-connected'); dropPeer(); }
        else if (m.type === 'ended') { if (!ended) { ended = true; finish('them'); } }
        else if (m.type === 'denied') { toast(m.reason); }
      };
      ws.onclose = () => { if (!ended && remote) { engine.setAvailable(false, 'The call connection to VOXA was lost.'); render(); } };
    };
  }
  return { View, setup };
};
