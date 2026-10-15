/* VOXA Protected Call, guest side. Joins with the one-time key from the invite link's #fragment (never sent to the
   server in a URL) and only after explicit consent. Audio goes browser-to-browser; this page records nothing. */
(() => {
  const $ = s => document.querySelector(s);
  const [room, key] = (location.hash.slice(1) || '').split('.');
  // Remove the key from the address bar and history so it is not copied around by accident.
  try { history.replaceState(null, '', location.pathname); } catch {}
  let ws = null, pc = null, mic = null, ended = false;
  const show = id => { for (const s of ['g-join', 'g-live', 'g-done']) $('#' + s).hidden = s !== id; };
  const status = t => { $('#g-status').textContent = t; };
  const cleanup = () => { mic?.getTracks().forEach(t => t.stop()); try { pc?.close(); } catch {} try { if (ws && ws.readyState < 2) ws.close(); } catch {} mic = pc = null; };
  const done = (h, p) => { ended = true; cleanup(); $('#g-done-h').textContent = h; $('#g-done-p').textContent = p; show('g-done'); };
  if (!room || !key) { done('This link is incomplete', 'Ask the person who invited you for a new link.'); return; }

  $('#g-join-btn').onclick = async () => {
    if (!$('#g-consent').checked) return status('Please agree to the analysis to join.');
    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) return status('This browser cannot make calls. Try a recent Chrome, Edge, Firefox or Safari.');
    $('#g-join-btn').disabled = true; status('Asking for microphone…');
    try { mic = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}}); }
    catch { $('#g-join-btn').disabled = false; return status('Microphone permission is needed to talk. The page must be opened over HTTPS.'); }
    status('Joining…');
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/call');
    ws.onopen = () => ws.send(JSON.stringify({type: 'hello', room, role: 'guest', key, consent: true}));
    ws.onmessage = async ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'denied') return done('Could not join', m.reason || 'This call link is invalid or has expired.');
      if (m.type === 'joined') {
        show('g-live'); $('#g-live-status').textContent = m.peerPresent ? 'Connecting…' : 'Waiting for the other person…';
        pc = new RTCPeerConnection({iceServers: m.iceServers || []});
        mic.getTracks().forEach(t => pc.addTrack(t, mic));
        pc.onicecandidate = e => { if (e.candidate && ws?.readyState === 1) ws.send(JSON.stringify({type: 'signal', data: {candidate: e.candidate.toJSON()}})); };
        pc.ontrack = e => { $('#g-remote').srcObject = e.streams[0] || new MediaStream([e.track]); $('#g-live-status').textContent = 'Connected. This call is protected by VOXA.'; };
        pc.onconnectionstatechange = () => { if (pc?.connectionState === 'failed' && !ended) $('#g-live-status').textContent = 'Connection failed. Your network may block direct calls.'; };
      } else if (m.type === 'peer-joined') $('#g-live-status').textContent = 'Connecting…';
      else if (m.type === 'signal' && pc) {
        if (m.data.sdp) {
          await pc.setRemoteDescription(m.data.sdp);
          if (m.data.sdp.type === 'offer') { const a = await pc.createAnswer(); await pc.setLocalDescription(a); ws.send(JSON.stringify({type: 'signal', data: {sdp: pc.localDescription.toJSON()}})); }
        } else if (m.data.candidate) { try { await pc.addIceCandidate(m.data.candidate); } catch {} }
      } else if (m.type === 'peer-left') $('#g-live-status').textContent = 'The other person disconnected. Waiting…';
      else if (m.type === 'ended') done('The call has ended', 'The other person ended the call. You can close this page.');
    };
    ws.onclose = () => { if (!ended) done('The call has ended', 'The connection to VOXA was closed.'); };
  };
  $('#g-end').onclick = () => { try { ws?.send(JSON.stringify({type: 'end', reason: 'hangup'})); } catch {} done('The call has ended', 'You ended the call. You can close this page.'); };
  $('#g-mute').onclick = () => { const t = mic?.getAudioTracks()[0]; if (!t) return; t.enabled = !t.enabled; $('#g-mute').textContent = t.enabled ? 'Mute my mic' : 'Unmute my mic'; };
  addEventListener('pagehide', () => { if (!ended) { try { ws?.send(JSON.stringify({type: 'end', reason: 'hangup'})); } catch {} cleanup(); } });
})();
