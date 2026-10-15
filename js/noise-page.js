/* Noise reduction page. Upload audio, run the local noise analysis, optionally create an enhanced copy.
   Uses the same /api/noise endpoint and the same report as "Analyze Noise" on the Analyze page. */
window.makeNoisePage = function (c) {
  const { $, esc, incidents, fmt, reportTypeOf, postBlob, saveNoiseReport, setCleanup, getSector, upid, toast } = c;
  const UP = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M5 20h14"/></svg>';
  const EXT = /\.(wav|mp3|flac|ogg|m4a|webm)$/i;
  const MIME = { wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4', webm: 'audio/webm' };
  const LV = { low: 'Low', medium: 'Medium', high: 'High', unavailable: 'Unavailable' };

  function View() {
    const recent = incidents().filter(i => reportTypeOf(i) === 'noise_analysis' && i.noise).slice(0, 6);
    return `<div class="wrapv an nr"><p class="report-eyebrow">Audio quality</p><h1>Noise reduction</h1>
      <p class="sub">Measure background noise and audio quality, and optionally create an enhanced copy with real noise reduction. It runs on this computer: no provider is called, and VOXA keeps no copy of your audio.</p>
      <div id="nr-warn" class="live-warning" role="alert" hidden><b>FFmpeg is not available</b><p>Noise analysis needs FFmpeg, so it is switched off. Install FFmpeg or run <code>npm install</code> in the VOXA folder, then restart.</p></div>
      <div class="an-grid">
        <section class="an-card"><div class="an-card-h"><h2>Audio file</h2></div>
          <div class="an-card-b"><label class="an-drop" for="nr-file">${UP}<b>Drop a file or click to upload</b><small>wav, mp3, flac, ogg, m4a or webm · up to 20 MB · 1 second to 5 minutes</small><input id="nr-file" type="file" accept=".wav,.mp3,.flac,.ogg,.m4a,.webm,audio/*" hidden></label>
            <p id="nr-info" class="an-info">No audio selected.</p><audio id="nr-prev" class="an-prev" controls hidden></audio></div></section>
        <section class="an-card"><div class="an-card-h"><h2>What you get</h2></div>
          <div class="an-card-b"><ul class="nr-list"><li>A <b>Noise analysis report</b>: speech detected, noise level, estimated SNR when it can be defended, hum or hiss-like indicators, clipping, silence and a quality rating.</li>
            <li>With the enhanced copy: a <b>separate denoised file</b>, players for both, a download, and the <b>measured</b> before/after change.</li>
            <li>The original is never changed. Authenticity should be checked on the original, not the enhanced copy.</li></ul></div></section>
      </div>
      <section class="an-card an-options"><label class="an-consent"><input type="checkbox" id="nr-consent"> I have permission from everyone in this recording to analyze it.</label>
        <label title="Creates a separate enhanced file using real noise reduction. The original is never changed."><input type="checkbox" id="nr-denoise" checked> Create enhanced copy (noise reduction)</label>
        <label title="Otherwise the report stays in this tab only"><input type="checkbox" id="nr-retain"> Keep report 24 h</label></section>
      <div class="an-foot"><div class="service-chips"><span class="service-chip ok" title="Runs locally with FFmpeg; no provider key is used">Local processing</span></div>
        <div class="an-actions"><span id="nr-state" role="status" aria-live="polite"></span><button class="mt-btn" id="nr-cancel" type="button" hidden>Cancel</button><button class="mt-btn primary" id="nr-go" type="button">Analyze noise</button></div></div>
      <p class="an-note">Audio is processed on this computer and is not stored. The report keeps measurements only.</p>
      <section class="an-card" style="margin-top:14px"><div class="an-card-h"><h2>Recent noise reports</h2><a class="mt-btn sm" href="#/incidents">All reports</a></div>
        <div class="an-card-b">${recent.length ? `<ul class="nr-recent">${recent.map(i => `<li><a href="#/incident/${encodeURIComponent(i.id)}">${esc(i.media?.name || 'Audio')}</a><span>Noise ${LV[i.noise.noise.level]} · ${esc(fmt(i.at))}</span></li>`).join('')}</ul>` : '<p class="an-info" style="margin:0">No noise reports yet. Analyze a recording above.</p>'}</div></section></div>`;
  }

  function setup() {
    let blob = null, meta = null, url = null, uploadId = null, disposed = false, controller = null, version = 0;
    const info = $('#nr-info'), prev = $('#nr-prev'), st = $('#nr-state'), go = $('#nr-go'), cancel = $('#nr-cancel');
    const controls = [...document.querySelectorAll('#view input,#view button')].filter(e => e.id !== 'nr-cancel');
    const busy = on => { if (disposed) return; controls.forEach(e => (e.disabled = on)); cancel.hidden = !on; };
    setCleanup(() => { disposed = true; controller?.abort(); prev?.pause?.(); if (url) URL.revokeObjectURL(url); });
    fetch('/api/status').then(r => r.json()).then(d => { if (disposed || d?.tools?.ffmpeg !== false) return; $('#nr-warn').hidden = false; go.disabled = true; go.title = 'FFmpeg is not available'; }).catch(() => {});
    const reject = m => { blob = meta = null; prev.hidden = true; info.textContent = m; toast(m); };
    const use = (file) => {
      const my = ++version; blob = meta = null; prev.hidden = true;
      if (!EXT.test(file.name)) return reject('Unsupported format. Use wav, mp3, flac, ogg, m4a or webm.');
      if (!file.size) return reject('This file is empty.');
      if (file.size > 20 * 1048576) return reject('File exceeds the 20 MB limit.');
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(file);
      const el = document.createElement('audio'); el.preload = 'metadata'; el.src = url;
      el.onloadedmetadata = () => {
        if (my !== version || disposed) return;
        const dur = isFinite(el.duration) ? el.duration : 0;
        if (dur && dur < 1) return reject('Audio is shorter than 1 second.');
        if (dur > 300) return reject('Noise analysis accepts audio up to 5 minutes.');
        blob = file; meta = { kind: 'voice', name: file.name, size: file.size, duration: dur ? +dur.toFixed(1) : null }; uploadId = upid();
        prev.src = url; prev.hidden = false;
        info.textContent = `${file.name} · ${(file.size / 1048576).toFixed(2)} MB${dur ? ' · ' + dur.toFixed(1) + ' s' : ''}`;
      };
      el.onerror = () => { if (my === version && !disposed) reject('That file could not be decoded as audio.'); };
    };
    $('#nr-file').onchange = e => { const f = e.target.files[0]; if (f) use(f); };
    const dz = $('.an-drop');
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) use(f); });
    cancel.onclick = () => controller?.abort();
    go.onclick = async () => {
      if (!blob || !meta) return toast('Add an audio file first.');
      if (!$('#nr-consent').checked) return toast('Confirm consent before analyzing this recording.');
      const wantEnhanced = $('#nr-denoise').checked, retain = $('#nr-retain').checked, lockBlob = blob, lockMeta = meta, lockUpload = uploadId, sector = getSector();
      controller = new AbortController(); busy(true);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(240000)]);
      st.dataset.state = 'uploading'; st.textContent = 'Uploading… 0%';
      let res;
      try {
        res = await postBlob('/api/noise?denoise=' + (wantEnhanced ? '1' : '0'), lockBlob, lockBlob.type || MIME[lockMeta.name.split('.').pop().toLowerCase()] || 'audio/wav', signal, f => { if (disposed) return; st.dataset.state = f < 1 ? 'uploading' : 'processing'; st.textContent = f < 1 ? `Uploading… ${Math.round(f * 100)}%` : wantEnhanced ? 'Measuring noise and creating the enhanced copy…' : 'Measuring noise and audio quality…'; });
      } catch (e) { if (!disposed) { st.dataset.state = 'failed'; st.textContent = e.name === 'AbortError' ? 'Canceled. No report was saved.' : e.name === 'TimeoutError' ? 'Timed out. Please try again.' : e.message || 'The analysis server is unavailable.'; busy(false); } return; }
      if (disposed) return;
      if (!res.ok) { st.dataset.state = res.status === 415 || res.status === 422 ? 'unsupported' : 'failed'; st.textContent = res.data.error || 'Noise analysis failed.'; busy(false); return; }
      const { noise, enhancedAudio } = res.data;
      if (!noise?.speech || !noise?.quality) { st.dataset.state = 'failed'; st.textContent = 'The server returned an incomplete noise report. Nothing was saved.'; busy(false); return; }
      const id = saveNoiseReport({ noise, enhancedAudio, media: lockMeta, blob: lockBlob, uploadId: lockUpload, retain, sector });
      if (!id) { busy(false); return; }
      st.dataset.state = 'completed';
      location.hash = '#/incident/' + id;
    };
  }
  return { View, setup };
};
