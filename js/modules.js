/* Intelligence, Signal, Watermarking and Chrome Extension pages.
   Intelligence reads real saved reports. Signal and Watermarking run entirely in the browser. Nothing here invents results. */
window.makeModules = function ({ $, esc, store, incidents, S, PRI, pill, fmt, toast }) {
  const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago'; };
  const pct = v => typeof v === 'number' && Number.isFinite(v) ? (Math.round(v * 10000) / 100).toFixed(2) + '%' : null;
  const rows = list => `<table class="kvt"><tbody>${list.filter(r => r[1] !== null && r[1] !== undefined && r[1] !== '').map(([k, v, raw]) => `<tr><th scope="row">${esc(k)}</th><td>${raw ? v : esc(v)}</td></tr>`).join('')}</tbody></table>`;
  const card = (title, body, extra = '') => `<section class="mt-card md-card"><div class="mt-card-h"><h2>${esc(title)}</h2>${extra}</div><div class="mt-card-b">${body}</div></section>`;
  const badge = (text, tone) => `<span class="mt-pill ${tone}">${esc(text)}</span>`;
  const NAMES = { realitydefender: 'Reality Defender', sealedrose: 'Sealed Rose', deepgram: 'Deepgram', gemini: 'Gemini', luxand: 'Luxand' };
  const MOD = { voice: 'Voice', image: 'Image', video: 'Video' };

  /* ================= Intelligence ================= */
  const selKey = 'voxa:intel-sel';
  function authState(a) {
    if (!a) return ['Not provided', 'grey', 'No media was analyzed, so there is no authenticity assessment.'];
    if (a.status !== 'ok') return ['Unavailable', 'grey', a.message || 'The detector returned no result.'];
    if (a.code === 'AI_GENERATED') return ['Flagged', 'red', 'The detector found signs of AI generation or manipulation.'];
    if (a.code === 'SUSPICIOUS') return ['Inconclusive', 'amber', 'The detector could not reach a confident conclusion.'];
    return ['Not flagged', 'green', 'The detector found no sign of manipulation. This does not verify who is speaking.'];
  }
  function authCard(a, title, at) {
    const [label, tone, why] = authState(a);
    const ok = a && a.status === 'ok';
    return card(title, `<div class="md-state">${badge(label, tone)}<span>${esc(why)}</span></div>` + rows([
      ['Provider', a ? NAMES[a.provider] || a.provider : null], ['Result code', a?.code],
      ['Score', ok ? pct(a.aiScore) : null], ['Detector confidence', ok && typeof a.confidence === 'number' ? pct(a.confidence) : null],
      ...(ok ? (a.models || []).map(m => ['Model · ' + m.name, m.status + (typeof m.score === 'number' ? ' (' + pct(m.score) + ')' : '')]) : []),
      ['Analyzed', fmt(at)]]) + (a && a.status !== 'ok' ? `<p class="md-err"><b>Processing issue:</b> ${esc(a.code || 'UNAVAILABLE')}</p>` : '') + '<p class="md-note">Scores are shown only when the provider returned them. Authenticity says nothing about what is being said.</p>');
  }
  function intentCard(i) {
    const it = i.intent, th = (S[i.sector] || {}).thresholds || {};
    if (!it || it.status !== 'ok') return card('Scam intent', `<div class="md-state">${badge('Not enough evidence', 'grey')}<span>There was too little transcript to assess. No risk rating is shown.</span></div>`);
    return card('Scam intent', `<div class="md-state">${pill(PRI, i.priority)}<span>${it.rules.length ? it.rules.length + ' pattern' + (it.rules.length === 1 ? '' : 's') + ' matched in the transcript.' : 'No scam-intent patterns matched.'}</span></div>` +
      (it.rules.length ? `<div class="md-evidence">${it.rules.map(r => `<div><b>${esc(r.label)}</b>${r.critical ? ' <em>critical</em>' : ''}<small>weight ${r.weight}</small><q>${esc(r.excerpt)}</q></div>`).join('')}</div>` : '') +
      rows([['Rule score', it.score], ['Words assessed', it.words], ['Sector policy', i.policyVersion], ['Medium from', th.medium], ['High from', th.high]]) + '<p class="md-note">Rules run on this device on the transcript text. A critical request raises priority regardless of score.</p>');
  }
  function transcriptCard(i) {
    const t = i.transcript?.text || '', src = { deepgram: 'Deepgram', gemini: 'Gemini', provided: 'Provided or edited by you' }[i.transcript?.source] || i.transcript?.source || null;
    if (!t) return card('Transcription', `<div class="md-state">${badge('Unavailable', 'grey')}<span>${esc(i.extraction?.message || 'No transcript was produced for this report.')}</span></div>`);
    return card('Transcription', `<div class="md-state">${badge('Available', 'green')}<span>${(t.match(/\S+/g) || []).length} words</span></div>` + rows([['Source', src], ['Detected language', i.language], ['Provisional text', i.transcript?.provisional ? 'Includes interim words' : null]]) + `<div class="md-quote">${esc(t.slice(0, 700))}${t.length > 700 ? '…' : ''}</div><p class="md-note">Automatic transcripts can contain errors, especially with noise, accents and mixed Hindi-English speech.</p>`);
  }
  function Intelligence() {
    const list = incidents();
    if (!list.length) return `<div class="wrapv md"><header class="mt-head"><div><h1>Intelligence</h1><p class="sub">Three independent assessments per report. A genuine voice can read a scam, and a synthetic voice can say something harmless, so they are never merged into one score.</p></div><a class="mt-btn primary" href="#/analyze">Analyze media</a></header>
      <div class="md-engine" id="intel-engine"><span class="md-chip">Checking detection services…</span></div>
      <div class="md-grid3">${card('Voice, image and video authenticity', '<p class="md-note" style="margin-top:0">Is the media synthetic or manipulated? Reality Defender checks voice and images; Sealed Rose checks video. A score is shown only when the provider returns one.</p>')}
        ${card('Scam intent', '<p class="md-note" style="margin-top:0">Does the conversation show scam patterns, such as OTP or PIN requests, urgency, secrecy, impersonated authority or payment pressure? Rules run on this device, in English, Hindi and Hinglish.</p>')}
        ${card('Transcription', '<p class="md-note" style="margin-top:0">What was said, from Deepgram or Gemini. Optionally, Gemini reads the transcript for context and fraud reasoning; it never judges authenticity.</p>')}</div>
      <div class="mt-card"><div class="mt-card-b"><p class="empty-state">No analyses yet. Analyze a recording, image or video and its three assessments appear here, side by side.</p><div class="row-actions"><a class="mt-btn primary" href="#/analyze">Analyze media</a><a class="mt-btn" href="#/live">Start live monitor</a></div></div></div></div>`;
    let id = ''; try { id = sessionStorage.getItem(selKey) || ''; } catch {}
    const cur = list.find(x => x.id === id) || list[0], mod = cur.modality || 'voice';
    const issues = {}; list.forEach(i => { if (i.authenticity && i.authenticity.status && !['ok', 'not_provided'].includes(i.authenticity.status)) issues['Authenticity · ' + (i.authenticity.code || 'UNAVAILABLE')] = (issues['Authenticity · ' + (i.authenticity.code || 'UNAVAILABLE')] || 0) + 1; if (i.extraction && i.extraction.status && i.extraction.status !== 'ok') issues['Transcription · ' + (i.extraction.provider || 'service')] = (issues['Transcription · ' + (i.extraction.provider || 'service')] || 0) + 1; });
    const iv = cur.intelligence;
    return `<div class="wrapv md"><header class="mt-head"><div><h1>Intelligence</h1><p class="sub">Three independent assessments per report. A genuine voice can read a scam, and a synthetic voice can say something harmless, so they are never merged into one score.</p></div></header>
      <div class="md-engine" id="intel-engine"><span class="md-chip">Checking detection services…</span></div>
      <div class="md-split"><section class="mt-card"><div class="mt-card-h"><h2>Reports</h2><span class="md-count">${list.length}</span></div><div class="md-list">${list.slice(0, 40).map(i => `<button class="${i.id === cur.id ? 'on' : ''}" data-sel="${esc(i.id)}"><b>${esc(i.meeting?.title || i.media?.name || 'Text analysis')}</b><small>${esc(i.media?.source === 'live' ? 'Live' : MOD[i.modality || 'voice'])} · ${ago(i.at)}</small>${pill(PRI, i.priority)}</button>`).join('')}</div></section>
      <div class="md-detail"><div class="md-strip"><span><b>${esc(cur.meeting?.title || cur.media?.name || 'Text analysis')}</b></span><span>${esc(MOD[mod])}</span><span>${fmt(cur.at)}</span><span>${esc((S[cur.sector] || {}).name || cur.sector)}</span><span>${cur.state === 'complete' ? 'All checks completed' : 'Partial analysis'}</span><a class="link" href="#/incident/${encodeURIComponent(cur.id)}">Open report</a></div>
        <div class="md-grid3">${authCard(cur.authenticity?.status === 'not_provided' ? null : cur.authenticity, MOD[mod] + ' authenticity', cur.at)}${intentCard(cur)}${transcriptCard(cur)}</div>
        ${cur.audioAuthenticity ? authCard(cur.audioAuthenticity, 'Soundtrack authenticity (audio only)', cur.at) : ''}
        ${iv?.status === 'ok' ? card('Language-model reading of the transcript', rows([['Language', iv.data.language], ['Dialect', iv.data.dialect], ['Context', iv.data.context], ['Message', iv.data.message], ['Fraud type', iv.data.fraudType], ['Reasoning', iv.data.fraudReasoning]]) + `<p class="md-note">Written by ${esc(NAMES[iv.provider] || iv.provider || 'Gemini')} from the transcript only. It cannot hear audio and says nothing about authenticity.</p>`) : ''}</div></div>
      ${Object.keys(issues).length ? card('Processing issues across saved reports', `<div class="md-issues">${Object.entries(issues).map(([k, n]) => `<div><span>${esc(k)}</span><b>${n}</b></div>`).join('')}</div>`) : ''}</div>`;
  }
  function setupIntelligence() {
    document.querySelectorAll('[data-sel]').forEach(b => b.addEventListener('click', () => { try { sessionStorage.setItem(selKey, b.dataset.sel); } catch {} dispatchEvent(new HashChangeEvent('hashchange')); }));
    fetch('/api/status?probe=1').then(r => r.json()).then(d => {
      const el = $('#intel-engine'); if (!el) return;
      const st = x => !x.configured ? ['Not configured', 'off'] : !x.allowed ? ['Blocked by FREE_MODE', 'warn'] : x.health === 'ok' ? ['Ready', 'ok'] : x.health === 'invalid-key' ? ['Key rejected', 'bad'] : x.health === 'unreachable' ? ['Unreachable', 'bad'] : x.health === 'rate-limited' ? ['Rate limited', 'warn'] : ['Configured', 'ok'];
      const role = { realitydefender: 'Voice and image authenticity', sealedrose: 'Video authenticity', deepgram: 'Transcription', gemini: 'Text reading', luxand: 'Face liveness' };
      el.innerHTML = Object.entries(d.details).map(([k, x]) => { const [t, c] = st(x); return `<span class="md-chip ${c}" title="${esc(x.blockedReason || x.healthNote || x.note)}"><b>${esc(x.label)}</b> ${esc(role[k] || '')} · ${t}</span>`; }).join('');
    }).catch(() => { const el = $('#intel-engine'); if (el) el.innerHTML = '<span class="md-chip bad">The VOXA server is not reachable.</span>'; });
  }

  /* ================= shared audio helpers ================= */
  function readWav(buf) {
    const v = new DataView(buf);
    if (buf.byteLength < 44 || v.getUint32(0) !== 0x52494646 || v.getUint32(8) !== 0x57415645) return null;
    let p = 12, fmtc = null, data = null;
    while (p + 8 <= buf.byteLength) {
      const id = v.getUint32(p), size = v.getUint32(p + 4, true);
      if (id === 0x666d7420) fmtc = { tag: v.getUint16(p + 8, true), ch: v.getUint16(p + 10, true), sr: v.getUint32(p + 12, true), bits: v.getUint16(p + 22, true) };
      else if (id === 0x64617461) { data = { at: p + 8, size: Math.min(size, buf.byteLength - p - 8) }; break; }
      p += 8 + size + (size & 1);
    }
    if (!fmtc || !data) return null;
    const { ch, bits, tag } = fmtc, bytes = bits / 8, n = Math.floor(data.size / (bytes * ch));
    if (!(tag === 1 && [16, 24, 32].includes(bits)) && !(tag === 3 && bits === 32)) return null;
    const out = Array.from({ length: ch }, () => new Float32Array(n));
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
      const o = data.at + (i * ch + c) * bytes;
      out[c][i] = tag === 3 ? v.getFloat32(o, true) : bits === 16 ? v.getInt16(o, true) / 32768 : bits === 24 ? ((v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16)) / 8388608) : v.getInt32(o, true) / 2147483648;
    }
    return { channels: out, sampleRate: fmtc.sr, native: true };
  }
  async function loadAudio(file) {
    const buf = await file.arrayBuffer();
    const wav = readWav(buf.slice(0));
    if (wav) return wav;
    const ctx = new AudioContext();
    try { const a = await ctx.decodeAudioData(buf.slice(0)); return { channels: Array.from({ length: a.numberOfChannels }, (_, c) => a.getChannelData(c).slice()), sampleRate: a.sampleRate, native: false }; }
    finally { ctx.close(); }
  }
  const dB = x => 20 * Math.log10(x + 1e-9);
  const mm = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  function dropzone(inputId, hint) {
    return `<label class="an-drop md-drop" for="${inputId}"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0-4 4m4-4 4 4M5 20h14"/></svg><b>Drop an audio file or click to choose</b><small>${hint}</small><input id="${inputId}" type="file" accept=".wav,.mp3,.flac,.ogg,.m4a,.webm,audio/*" hidden></label>`;
  }
  function wireDrop(inputId, onFile) {
    const input = $('#' + inputId), dz = input.closest('.md-drop');
    input.onchange = () => input.files[0] && onFile(input.files[0]);
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) onFile(f); });
  }

  /* ================= Signal: audio forensics ================= */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
    }
  }
  function analyzeSignal(ch, sr) {
    const x = ch[0], N = x.length, dur = N / sr;
    let peak = 0, sq = 0, clipped = 0;
    for (let i = 0; i < N; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; sq += a * a; if (a >= 0.999) clipped++; }
    const wl = Math.max(1, Math.round(sr * 0.05)), W = Math.floor(N / wl), lev = new Float32Array(W);
    for (let w = 0; w < W; w++) { let s = 0; for (let i = w * wl; i < (w + 1) * wl; i++) s += x[i] * x[i]; lev[w] = Math.max(-100, dB(Math.sqrt(s / wl))); }
    const silent = [], thr = -50; let run = -1;
    for (let w = 0; w <= W; w++) { const low = w < W && lev[w] < thr; if (low && run < 0) run = w; if (!low && run >= 0) { if (w - run >= 6) silent.push({ s: run * wl / sr, e: w * wl / sr }); run = -1; } }
    const silentSec = silent.reduce((n, r) => n + (r.e - r.s), 0);
    const sorted = [...lev].sort((a, b) => a - b), q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? -120;
    const clipMarks = []; if (clipped) { let last = -1; for (let i = 0; i < N && clipMarks.length < 40; i++) if (Math.abs(x[i]) >= 0.999 && i - last > sr * 0.2) { clipMarks.push(i / sr); last = i; } }
    // spectrum + spectrogram
    const FN = 1024, cols = Math.max(1, Math.min(900, Math.floor((N - FN) / (FN / 2)))), hop = Math.max(1, (N - FN) / Math.max(1, cols - 1));
    const spec = new Float32Array(cols * (FN / 2)), avg = new Float64Array(FN / 2), hann = new Float32Array(FN).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FN - 1)));
    const re = new Float64Array(FN), im = new Float64Array(FN);
    for (let c = 0; c < cols; c++) {
      const st = Math.floor(c * hop); for (let i = 0; i < FN; i++) { re[i] = (x[st + i] || 0) * hann[i]; im[i] = 0; }
      fft(re, im);
      for (let k = 0; k < FN / 2; k++) { const m = Math.hypot(re[k], im[k]) / FN; spec[c * (FN / 2) + k] = dB(m); avg[k] += m * m; }
    }
    let tot = 0; for (let k = 0; k < FN / 2; k++) tot += avg[k];
    let acc = 0, roll = FN / 2 - 1; for (let k = 0; k < FN / 2; k++) { acc += avg[k]; if (acc >= 0.99 * tot) { roll = k; break; } }
    const rolloff = tot > 0 ? roll * sr / FN : 0;
    // pitch by autocorrelation on a decimated copy
    const fac = Math.max(1, Math.round(sr / 8000)), sr2 = sr / fac, fl = Math.round(sr2 * 0.04), pitch = [];
    const step = Math.max(fl / 2, Math.floor((Math.floor(N / fac) - fl) / 400));
    const lo = Math.floor(sr2 / 400), hi = Math.ceil(sr2 / 70);
    for (let st = 0; st + fl + hi < N / fac; st += step) {
      const f = new Float32Array(fl + hi); let e = 0;
      for (let i = 0; i < fl + hi; i++) { let s = 0; for (let k = 0; k < fac; k++) s += x[(st + i) * fac + k] || 0; f[i] = s / fac; if (i < fl) e += f[i] * f[i]; }
      const t = st * fac / sr;
      if (dB(Math.sqrt(e / fl)) < -40) { pitch.push([t, null]); continue; }
      let best = 0, bl = 0; for (let l = lo; l <= hi; l++) { let s = 0, e2 = 0; for (let i = 0; i < fl; i++) { s += f[i] * f[i + l]; e2 += f[i + l] * f[i + l]; } const r = s / Math.sqrt(e * e2 + 1e-12); if (r > best) { best = r; bl = l; } }
      pitch.push([t, best > 0.5 ? sr2 / bl : null]);
    }
    const voiced = pitch.filter(p => p[1]).map(p => p[1]).sort((a, b) => a - b);
    return { N, dur, sr, channels: ch.length, peak, peakDb: dB(peak), rmsDb: dB(Math.sqrt(sq / N)), clipPct: clipped / N * 100, clipMarks, silent, silentPct: silentSec / dur * 100, floorDb: q(0.1), spreadDb: q(0.9) - q(0.1), rolloff, lev, wl, spec, FN, cols, pitch, pitchMed: voiced.length >= 10 ? voiced[Math.floor(voiced.length / 2)] : null, pitchRange: voiced.length >= 10 ? [voiced[Math.floor(voiced.length * 0.05)], voiced[Math.floor(voiced.length * 0.95)]] : null };
  }
  function warnings(m, native) {
    const w = [];
    if (m.dur < 3) w.push(['Very short audio', `Only ${m.dur.toFixed(1)} s. Detectors need at least about 3 seconds to be reliable.`]);
    if (m.sr < 16000) w.push(['Low sample rate', `${m.sr} Hz removes the high-frequency detail many detectors rely on.`]);
    if (m.peakDb < -30) w.push(['Very quiet recording', `Peak level is ${m.peakDb.toFixed(1)} dBFS. Quiet audio is dominated by noise.`]);
    if (m.clipPct >= 0.1) w.push(['Clipping', `${m.clipPct.toFixed(2)}% of samples are at full scale. Distortion can look like synthesis artifacts.`]);
    if (m.silentPct > 60) w.push(['Mostly silence', `${m.silentPct.toFixed(0)}% of the file is silent, leaving little speech to assess.`]);
    if (m.floorDb > -35 && m.silentPct <= 60) w.push(['High background noise', `The noise floor is about ${m.floorDb.toFixed(0)} dBFS, which can hide or mimic artifacts.`]);
    if (m.rolloff > 0 && m.rolloff < 4500) w.push(['Band-limited audio', `Almost all energy is below ${(m.rolloff / 1000).toFixed(1)} kHz, typical of phone calls. Detectors trained on wideband audio may be less reliable.`]);
    return w;
  }
  function Signal() {
    return `<div class="wrapv md"><header class="mt-head"><div><h1>Signal</h1><p class="sub">Audio-quality and forensic indicators for a recording. These are supporting evidence about reliability, never proof that audio is fake.</p></div></header>
      <section class="mt-card"><div class="mt-card-b">${dropzone('sg-file', 'wav, mp3, flac, ogg, m4a · analyzed in this browser, nothing is uploaded')}<p id="sg-state" class="an-info"></p></div></section><div id="sg-out"></div></div>`;
  }
  function drawWave(cv, m, x) {
    const w = cv.width = cv.clientWidth * (devicePixelRatio || 1) || 1000, h = cv.height = 150, g = cv.getContext('2d'), per = Math.max(1, Math.floor(m.N / w));
    g.fillStyle = '#f8fafc'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(148,163,184,.28)'; m.silent.forEach(r => g.fillRect(r.s / m.dur * w, 0, Math.max(1, (r.e - r.s) / m.dur * w), h));
    g.fillStyle = '#4f46e5';
    for (let px = 0; px < w; px++) { let lo = 0, hi = 0; for (let i = px * per; i < Math.min(m.N, (px + 1) * per); i++) { const v = x[i]; if (v < lo) lo = v; if (v > hi) hi = v; } g.fillRect(px, h / 2 - hi * h / 2, 1, Math.max(1, (hi - lo) * h / 2)); }
    g.fillStyle = '#dc2626'; m.clipMarks.forEach(t => g.fillRect(t / m.dur * w, 0, 2, 8));
  }
  function drawSpec(cv, m) {
    const w = cv.width = m.cols, h = cv.height = 180, g = cv.getContext('2d'), img = g.createImageData(w, h), K = m.FN / 2, shown = Math.min(K, Math.ceil(K * Math.min(1, 12000 / (m.sr / 2))));
    for (let c = 0; c < w; c++) for (let y = 0; y < h; y++) {
      const k = Math.min(shown - 1, Math.floor((h - 1 - y) / h * shown)), v = Math.max(0, Math.min(1, (m.spec[c * K + k] + 110) / 80)), o = (y * w + c) * 4;
      img.data[o] = 255 * Math.min(1, Math.max(0, 1.6 * v - 0.4)); img.data[o + 1] = 255 * Math.min(1, Math.max(0, 1.7 * v - 0.55)); img.data[o + 2] = 255 * (v < 0.5 ? 0.25 + v : Math.max(0, 1.4 - v * 1.4)); img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0); cv.dataset.max = (shown / K * m.sr / 2 / 1000).toFixed(0);
  }
  function drawPitch(cv, m) {
    const w = cv.width = cv.clientWidth * (devicePixelRatio || 1) || 1000, h = cv.height = 110, g = cv.getContext('2d');
    g.fillStyle = '#f8fafc'; g.fillRect(0, 0, w, h); g.strokeStyle = '#e5e7eb'; [100, 200, 300].forEach(f => { const y = h - (f - 50) / 350 * h; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); });
    g.fillStyle = '#0ea5e9'; m.pitch.forEach(([t, f]) => { if (f) g.fillRect(t / m.dur * w - 1, h - (Math.min(400, Math.max(50, f)) - 50) / 350 * h - 1, 3, 3); });
  }
  function setupSignal() {
    wireDrop('sg-file', async file => {
      const st = $('#sg-state'), out = $('#sg-out'); st.textContent = 'Analyzing ' + file.name + '…'; out.innerHTML = '';
      let a, m;
      try { a = await loadAudio(file); await new Promise(r => setTimeout(r, 30)); m = analyzeSignal(a.channels, a.sampleRate); }
      catch { st.textContent = 'That file could not be decoded as audio.'; return; }
      st.textContent = file.name;
      const url = URL.createObjectURL(file), warn = warnings(m, a.native), grade = warn.length === 0 ? ['Good', 'green'] : warn.length <= 2 ? ['Fair', 'amber'] : ['Poor', 'red'];
      out.innerHTML = `<div class="md-grid4">
        <div class="mt-kpi"><div><span>Suitability for analysis</span><strong class="md-grade ${grade[1]}">${grade[0]}</strong><span class="mt-delta flat">${warn.length} warning${warn.length === 1 ? '' : 's'}</span></div></div>
        <div class="mt-kpi"><div><span>Duration</span><strong>${mm(m.dur)}</strong><span class="mt-delta flat">${m.channels} channel${m.channels === 1 ? '' : 's'}</span></div></div>
        <div class="mt-kpi"><div><span>Sample rate</span><strong>${(m.sr / 1000).toFixed(m.sr % 1000 ? 2 : 0)} kHz</strong><span class="mt-delta flat">${a.native ? 'From the WAV header' : 'After browser decoding'}</span></div></div>
        <div class="mt-kpi"><div><span>Bandwidth (99% energy)</span><strong>${(m.rolloff / 1000).toFixed(1)} kHz</strong><span class="mt-delta flat">of ${(m.sr / 2000).toFixed(1)} kHz available</span></div></div></div>
      ${card('Waveform', `<audio id="sg-audio" controls src="${url}" style="width:100%"></audio><canvas id="sg-wave" class="md-canvas"></canvas><p class="md-note"><i class="md-sw" style="background:rgba(148,163,184,.5)"></i>Silence (below −50 dBFS for 0.3 s+) <i class="md-sw" style="background:#dc2626"></i>Clipping. Click the waveform to jump to that time.</p>`)}
      <div class="mt-row r-1-1">${card('Spectrogram', `<canvas id="sg-spec" class="md-canvas"></canvas><p class="md-note">Frequency up to <span id="sg-max"></span> kHz over time. Sharp cut-offs show band-limiting or earlier compression.</p>`)}${card('Pitch contour', m.pitchMed ? `<canvas id="sg-pitch" class="md-canvas short"></canvas><p class="md-note">Median ${m.pitchMed.toFixed(0)} Hz, 5–95% range ${m.pitchRange[0].toFixed(0)}–${m.pitchRange[1].toFixed(0)} Hz. Estimated by autocorrelation on voiced frames only. Pitch alone cannot tell real from synthetic speech.</p>` : '<p class="empty-state">Not enough voiced speech to estimate pitch.</p>')}</div>
      <div class="mt-row r-1-1">${card('Levels and quality checks', rows([['Peak level', m.peakDb.toFixed(1) + ' dBFS'], ['Average level (RMS)', m.rmsDb.toFixed(1) + ' dBFS'], ['Noise floor (10th percentile)', m.floorDb <= -99 ? 'Digital silence (below −100 dBFS)' : m.floorDb.toFixed(1) + ' dBFS'], ['Level spread (10th–90th)', m.spreadDb.toFixed(1) + ' dB' + (m.floorDb <= -99 ? ' (measured from digital silence)' : '')], ['Clipped samples', m.clipPct.toFixed(3) + '%'], ['Silence', m.silentPct.toFixed(0) + '% (' + m.silent.length + ' gap' + (m.silent.length === 1 ? '' : 's') + ')'], ['File', file.type || file.name.split('.').pop() + ' · ' + (file.size / 1048576).toFixed(2) + ' MB']]))}
        ${card('Reliability warnings', warn.length ? warn.map(([t, d]) => `<div class="md-warn"><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('') : '<p class="empty-state">No quality problems found. Detection results should not be limited by the audio itself.</p>')}</div>
      ${card('Quality segments', (m.silent.length || m.clipMarks.length) ? `<div class="md-seg-list">${m.silent.slice(0, 20).map(r => `<div><b>Silence</b><span>${mm(r.s)} – ${mm(r.e)}</span></div>`).join('')}${m.clipMarks.slice(0, 20).map(t => `<div><b>Clipping</b><span>near ${mm(t)}</span></div>`).join('')}</div><p class="md-note">These mark audio-quality events only. They are not deepfake indicators, and no segment is labeled suspicious.</p>` : '<p class="empty-state">No silent gaps or clipping events.</p>')}
      <p class="md-note">Signal features are supporting evidence about how reliable a detector can be on this file. They do not prove audio is real or fake.</p>
      <div class="row-actions"><button class="mt-btn primary" id="sg-run">Run full analysis with this file</button></div>`;
      $('#sg-max').textContent = ''; drawWave($('#sg-wave'), m, a.channels[0]); drawSpec($('#sg-spec'), m); $('#sg-max').textContent = $('#sg-spec').dataset.max; if (m.pitchMed) drawPitch($('#sg-pitch'), m);
      $('#sg-wave').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); $('#sg-audio').currentTime = (e.clientX - r.left) / r.width * m.dur; $('#sg-audio').play(); });
      $('#sg-run').addEventListener('click', () => { window.__voxaPending = { blob: file, name: file.name, kind: 'voice' }; location.hash = '#/analyze/voice'; });
    });
  }

  /* ================= Watermarking (audio) ================= */
  const BITS = 8, ALPHA = 0.09, MIN_SEC = 4;
  const hashKey = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  function envelope(x) {
    const n = x.length, P = new Float64Array(n + 1); for (let i = 0; i < n; i++) P[i + 1] = P[i] + Math.abs(x[i]);
    const e = new Float32Array(n), h = 512; for (let i = 0; i < n; i++) { const a = Math.max(0, i - h), b = Math.min(n, i + h); e[i] = (P[b] - P[a]) / (b - a); } return e;
  }
  function embed(channels, key, payload) {
    const N = channels[0].length, out = channels.map(c => new Float32Array(c)), r = rng(hashKey(key)), p = new Int8Array(N);
    for (let i = 0; i < N; i++) p[i] = r() < 0.5 ? -1 : 1;
    let wsq = 0, xsq = 0;
    out.forEach((y, c) => {
      const x = channels[c], env = envelope(x);
      for (let k = 0; k < BITS; k++) {
        const s = Math.floor(k * N / BITS), e = Math.floor((k + 1) * N / BITS), sign = (payload >> (BITS - 1 - k)) & 1 ? 1 : -1;
        for (let i = s; i < e; i++) { const w = ALPHA * sign * p[i] * Math.max(env[i], 0.003); y[i] = Math.max(-1, Math.min(1, x[i] + w)); wsq += w * w; xsq += x[i] * x[i]; }
      }
    });
    return { out, snrDb: 10 * Math.log10((xsq + 1e-12) / (wsq + 1e-12)) };
  }
  function corrSegments(mono, seed) {
    const N = mono.length, r = rng(seed), c = new Float64Array(BITS);
    for (let k = 0; k < BITS; k++) { const s = Math.floor(k * N / BITS), e = Math.floor((k + 1) * N / BITS); let a = 0; for (let i = s; i < e; i++) a += mono[i] * (r() < 0.5 ? -1 : 1); c[k] = a / (e - s); } return c;
  }
  function verify(channels, key) {
    const N = channels[0].length, mono = new Float32Array(N);
    for (let i = 0; i < N; i++) { let s = 0; for (const c of channels) s += c[i]; mono[i] = s / channels.length; }
    const seed = hashKey(key), real = corrSegments(mono, seed), nulls = []; for (let j = 1; j <= 16; j++) nulls.push(corrSegments(mono, hashKey(key + '#null' + j)));
    const z = Array.from(real, (c, k) => c / Math.sqrt(nulls.reduce((a, n) => a + n[k] * n[k], 0) / nulls.length + 1e-18));
    const hits = z.filter(v => Math.abs(v) >= 3).length;
    let payload = 0; z.forEach((v, k) => { payload = (payload << 1) | (v > 0 ? 1 : 0); });
    return { detected: hits >= 6, hits, z, payload };
  }
  function wavBlob(channels, sr) {
    const n = channels[0].length, ch = channels.length, buf = new ArrayBuffer(44 + n * ch * 2), v = new DataView(buf), W = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    W(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); W(8, 'WAVE'); W(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); W(36, 'data'); v.setUint32(40, n * ch * 2, true);
    let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { v.setInt16(o, Math.max(-1, Math.min(1, channels[c][i])) * 32767, true); o += 2; }
    return new Blob([buf], { type: 'audio/wav' });
  }
  function Watermarking() {
    return `<div class="wrapv md"><header class="mt-head"><div><h1>Watermarking</h1><p class="sub">Mark audio you produce with an inaudible, key-based watermark, then check later whether a file carries it. Runs entirely in this browser.</p></div></header>
      <div class="mt-row r-1-1">${card('Add a watermark', `${dropzone('wm-in', 'wav is best · at least 4 seconds')}<p id="wm-info" class="an-info"></p>
        <form id="wm-form" class="mt-form" style="margin-top:12px"><label>Secret key<input id="wm-key" type="password" minlength="8" required autocomplete="off" placeholder="At least 8 characters. Keep it private."></label><label>Mark ID (0–255)<input id="wm-id" type="number" min="0" max="255" value="1" required></label><div><button class="mt-btn primary" type="submit" id="wm-go">Add watermark</button></div></form><div id="wm-out"></div>`)}
        ${card('Check for a watermark', `${dropzone('wm-chk', 'the same key is required')}<p id="wm-cinfo" class="an-info"></p>
        <form id="wm-vform" class="mt-form" style="margin-top:12px"><label>Secret key<input id="wm-vkey" type="password" minlength="8" required autocomplete="off" placeholder="The key used when marking"></label><div><button class="mt-btn primary" type="submit">Check file</button></div></form><div id="wm-vout"></div>`)}</div>
      ${card('What this does and does not do', `<ul class="md-ul"><li>It adds a faint key-dependent noise pattern shaped to follow the loudness of the audio, carrying an 8-bit mark ID. Without the key it cannot be found or read.</li><li><b>Survives:</b> saving and copying as WAV, small volume changes.</li><li><b>Does not survive:</b> MP3/AAC compression, resampling, trimming, speed changes or re-recording through a speaker.</li><li>A positive check proves the file was marked with your key. It does not prove who made the content or that it is real. A negative check does not prove the file is unmarked.</li><li>Image and video watermarking are not available.</li></ul>`)}</div>`;
  }
  function setupWatermarking() {
    let src = null, chk = null;
    wireDrop('wm-in', async f => { $('#wm-info').textContent = 'Reading…'; try { src = { ...(await loadAudio(f)), name: f.name }; const d = src.channels[0].length / src.sampleRate; $('#wm-info').textContent = `${f.name} · ${d.toFixed(1)} s · ${src.sampleRate} Hz${src.native ? '' : ' (decoded by the browser)'}`; } catch { src = null; $('#wm-info').textContent = 'That file could not be decoded as audio.'; } });
    wireDrop('wm-chk', async f => { $('#wm-cinfo').textContent = 'Reading…'; try { chk = { ...(await loadAudio(f)), name: f.name }; $('#wm-cinfo').textContent = `${f.name} · ${(chk.channels[0].length / chk.sampleRate).toFixed(1)} s · ${chk.sampleRate} Hz${chk.native ? '' : ' (decoded by the browser)'}`; } catch { chk = null; $('#wm-cinfo').textContent = 'That file could not be decoded as audio.'; } });
    $('#wm-form').addEventListener('submit', e => {
      e.preventDefault(); const out = $('#wm-out');
      if (!src) return toast('Choose an audio file first.');
      if (src.channels[0].length / src.sampleRate < MIN_SEC) return toast('The audio must be at least ' + MIN_SEC + ' seconds.');
      const key = $('#wm-key').value, id = Math.max(0, Math.min(255, parseInt($('#wm-id').value, 10) || 0));
      const { out: ch, snrDb } = embed(src.channels, key, id), blob = wavBlob(ch, src.sampleRate), url = URL.createObjectURL(blob), name = src.name.replace(/\.[^.]+$/, '') + '.voxa.wav';
      out.innerHTML = `<div class="md-result ok"><b>Watermark added</b><span>Mark ID ${id} · watermark level ${snrDb.toFixed(1)} dB below the audio</span><audio controls src="${url}" style="width:100%;margin-top:8px"></audio><a class="mt-btn primary" style="margin-top:8px" href="${url}" download="${esc(name)}">Download ${esc(name)}</a></div>`;
    });
    $('#wm-vform').addEventListener('submit', e => {
      e.preventDefault(); const out = $('#wm-vout');
      if (!chk) return toast('Choose an audio file first.');
      if (chk.channels[0].length / chk.sampleRate < MIN_SEC) { out.innerHTML = '<div class="md-result na"><b>Too short</b><span>Files shorter than ' + MIN_SEC + ' seconds cannot be checked.</span></div>'; return; }
      const r = verify(chk.channels, $('#wm-vkey').value);
      out.innerHTML = r.detected
        ? `<div class="md-result ok"><b>Watermark detected</b><span>Mark ID ${r.payload}. ${r.hits} of ${BITS} segments matched the key (strength z ≥ 3).</span></div>`
        : `<div class="md-result na"><b>Watermark not detected</b><span>Only ${r.hits} of ${BITS} segments matched (at least 6 needed). Possible reasons: wrong key, no watermark, or the file was compressed, resampled or trimmed.</span></div>`;
      out.insertAdjacentHTML('beforeend', `<p class="md-note">Segment strengths: ${r.z.map(v => v.toFixed(1)).join(', ')}</p>`);
    });
  }

  /* ================= Integrations: catalog, with Google Meet and Zoom working ================= */
  const ML = () => window.VoxaMeetingLinks;
  const LIVE_INT = {
    meet: { desc: 'Save your Google Meet link and open the meeting in a new tab. Works with meeting links on meet.google.com.', ph: 'https://meet.google.com/abc-defg-hij' },
    zoom: { desc: 'Save your Zoom meeting link and open it in a new tab. Works with zoom.us links, including company subdomains.', ph: 'https://zoom.us/j/123456789' }
  };
  const CAMERA = '<rect x="3" y="6.5" width="12" height="11" rx="2.2"/><path d="m15 10.5 5.5-3.2v9.4L15 13.5"/>';
  const CATS = ['Meetings & video', 'Communication', 'Contact center', 'CRM & sales', 'Storage & files', 'Data & warehouse', 'Identity & security', 'HR & recruiting', 'Productivity', 'Support', 'Social & media', 'Developer'];
  const CATALOG = [
    ['zoom', 'Zoom', 'Meetings & video', 'Z'], ['teams', 'Microsoft Teams', 'Meetings & video', 'T'], ['meet', 'Google Meet', 'Meetings & video', '▶'], ['webex', 'Webex', 'Meetings & video', 'W'], ['whereby', 'Whereby', 'Meetings & video', 'W'], ['goto', 'GoTo Meeting', 'Meetings & video', 'GM'],
    ['slack', 'Slack', 'Communication', '#'], ['discord', 'Discord', 'Communication', 'D'], ['telegram', 'Telegram', 'Communication', '➤'], ['whatsapp', 'WhatsApp', 'Communication', '✆'], ['intercom', 'Intercom', 'Communication', 'I'], ['front', 'Front', 'Communication', 'F'], ['twilio', 'Twilio', 'Communication', '●'], ['vonage', 'Vonage', 'Communication', 'V'],
    ['nice', 'NICE CXone', 'Contact center', 'NC'], ['five9', 'Five9', 'Contact center', 'F'], ['talkdesk', 'Talkdesk', 'Contact center', 'T'], ['genesys', 'Genesys', 'Contact center', 'G'], ['ringcentral', 'RingCentral', 'Contact center', 'R'], ['aircall', 'Aircall', 'Contact center', 'A'], ['dialpad', 'Dialpad', 'Contact center', 'D'],
    ['gdrive', 'Google Drive', 'Storage & files', 'G'], ['dropbox', 'Dropbox', 'Storage & files', 'D'], ['box', 'Box', 'Storage & files', 'B'], ['onedrive', 'OneDrive', 'Storage & files', 'O']
  ].map(([id, name, cat, glyph]) => ({ id, name, cat, glyph, live: id === 'zoom' || id === 'meet' }));
  const camSvg = (s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CAMERA}</svg>`;
  function intCard(p, saved) {
    const name = ML().PLATFORMS[p].name, has = Boolean(saved);
    return `<section class="int-card" data-platform="${p}"><p class="mt-help" style="margin:0 0 12px">${LIVE_INT[p].desc}</p>
        <div class="int-state"><span class="mt-pill ${has ? 'green' : 'grey'}" data-status>${has ? 'Connected' : 'Not connected'}</span></div>
        <div class="int-saved" data-saved ${has ? '' : 'hidden'}><span>Saved link</span><b data-saved-url>${has ? esc(ML().validate(p, saved.url).display) : ''}</b></div>
        <form class="int-form" novalidate><label>Meeting link<input type="text" name="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="2048" placeholder="${has ? 'Paste a new link to update' : LIVE_INT[p].ph}" aria-describedby="msg-${p}"></label>
          <p class="int-msg" id="msg-${p}" role="alert" aria-live="polite" hidden></p>
          <div class="row-actions"><button class="mt-btn primary" type="submit">Save link</button>
            <a class="mt-btn" data-launch target="_blank" rel="noopener noreferrer" ${has ? `href="${esc(saved.url)}"` : 'aria-disabled="true" tabindex="-1"'}>Open meeting</a>
            <button class="mt-btn" type="button" data-remove ${has ? '' : 'disabled'}>Remove</button></div></form>
        <p class="md-note">This only saves and opens a link. VOXA does not join the meeting, hear its audio or record anyone.</p></section>`;
  }
  // Generic dialog shared by the Zoom/Meet panels and the "Coming soon" notice.
  function modal({ title, sub, iconHtml, bodyHtml, onMount, trigger }) {
    const wrap = document.createElement('div'); wrap.className = 'sm-backdrop';
    wrap.innerHTML = `<div class="sm-dialog" role="dialog" aria-modal="true" aria-labelledby="md-title"><div class="sm-head"><span class="sm-ic">${iconHtml}</span><div><h2 id="md-title">${esc(title)}</h2><p>${esc(sub)}</p></div><button class="sm-x" type="button" aria-label="Close" data-close>&times;</button></div><div class="sm-body">${bodyHtml}</div></div>`;
    document.body.appendChild(wrap); document.body.classList.add('sm-open');
    const close = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); document.body.classList.remove('sm-open'); trigger?.focus?.(); };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const f = [...wrap.querySelectorAll('button:not([disabled]),input,a[href]')].filter(el => el.offsetParent !== null); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    onMount?.(wrap, close);
    (wrap.querySelector('input,button.go,button.cancel') || wrap.querySelector('.sm-x')).focus();
    return close;
  }
  function Integrations() {
    const saved = ML().load(), connected = Object.keys(saved).length;
    const counts = Object.fromEntries(CATS.map(c => [c, CATALOG.filter(x => x.cat === c).length]));
    return `<div class="wrapv md"><section class="mt-card int-hero"><span class="cx-tag">Integrations</span><h1>Connect VOXA to your stack</h1><p>Google Meet and Zoom work today: save a meeting link and open it in one click. The other integrations are on the way.</p></section>
      <div class="int-layout"><nav class="int-cats" id="int-cats" aria-label="Integration categories"><button class="on" data-cat="">All <span>${CATALOG.length}</span></button>${CATS.map(c => `<button data-cat="${esc(c)}">${esc(c)} <span>${counts[c]}</span></button>`).join('')}</nav>
        <div><input class="int-search" id="int-q" type="search" placeholder="Search integrations…" aria-label="Search integrations"><div class="int-grid" id="int-grid"></div><p class="md-note" id="int-empty" hidden>No integrations match your search.</p>
          <p class="md-note">${connected} of 2 meeting platforms connected. Meeting links are saved in this browser for your workspace user and are never sent to the meeting service.</p></div></div></div>`;
  }
  function paintTiles(state) {
    const saved = ML().load(), q = state.q.toLowerCase();
    const list = CATALOG.filter(x => (!state.cat || x.cat === state.cat) && (!q || x.name.toLowerCase().includes(q) || x.cat.toLowerCase().includes(q)));
    $('#int-grid').innerHTML = list.map(x => {
      const st = x.live ? (saved[x.id] ? ['Connected', 'green'] : ['Not connected', 'grey']) : ['Coming soon', 'soon'];
      return `<button type="button" class="int-tile ${x.live ? 'live' : ''}" data-int="${x.id}"><span class="int-glyph ${x.live ? x.id : ''}">${x.live ? camSvg(18) : esc(x.glyph)}</span><span class="int-name"><b>${esc(x.name)}</b><small>${esc(x.cat)}</small></span><span class="mt-pill ${st[1]}">${st[0]}</span></button>`;
    }).join('');
    $('#int-empty').hidden = list.length > 0;
  }
  function bindIntCard(cardEl, onChange) {
    const p = cardEl.dataset.platform, form = cardEl.querySelector('form'), input = form.url, msg = cardEl.querySelector('.int-msg'), pill = cardEl.querySelector('[data-status]');
    const openA = cardEl.querySelector('[data-launch]'), rem = cardEl.querySelector('[data-remove]'), savedBox = cardEl.querySelector('[data-saved]'), savedUrl = cardEl.querySelector('[data-saved-url]');
    const paint = (state, text) => {
      const cur = ML().load()[p], st = state || (cur ? 'saved' : 'none');
      const map = { none: ['Not connected', 'grey'], saved: ['Connected', 'green'], invalid: ['Invalid URL', 'amber'], error: ['Error', 'red'] }[st];
      pill.textContent = map[0]; pill.className = 'mt-pill ' + map[1]; pill.dataset.state = st;
      msg.hidden = !text; msg.textContent = text || ''; msg.className = 'int-msg ' + (st === 'error' ? 'err' : st === 'invalid' ? 'warn' : 'ok');
      input.setAttribute('aria-invalid', st === 'invalid' ? 'true' : 'false');
      savedBox.hidden = !cur; if (cur) savedUrl.textContent = ML().validate(p, cur.url).display;
      if (cur) { openA.href = cur.url; openA.removeAttribute('aria-disabled'); openA.removeAttribute('tabindex'); } else { openA.removeAttribute('href'); openA.setAttribute('aria-disabled', 'true'); openA.tabIndex = -1; }
      rem.disabled = !cur; input.placeholder = cur ? 'Paste a new link to update' : LIVE_INT[p].ph; onChange?.();
    };
    input.addEventListener('input', () => { if (pill.dataset.state === 'invalid' || pill.dataset.state === 'error') paint(null, ''); });
    openA.addEventListener('click', e => { const cur = ML().load()[p]; if (!cur || !ML().validate(p, cur.url).ok) e.preventDefault(); });
    rem.addEventListener('click', () => { if (ML().remove(p)) { input.value = ''; paint(null, 'Link removed.'); toast(ML().PLATFORMS[p].name + ' link removed.'); } else paint('error', 'The link could not be removed because browser storage is blocked.'); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const local = ML().validate(p, input.value); if (!local.ok) return paint('invalid', local.error);
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const c = await ML().checkWithServer(p, input.value);
        if (c.state === 'invalid') return paint('invalid', c.error);
        const s = ML().save(p, c.url); if (!s.ok) return paint('error', s.error);
        input.value = ''; paint('saved', c.state === 'ok' ? 'Link saved. Nothing has been opened or joined.' : 'Link saved. ' + ML().unavailableNote(c.why));
      } catch (err) { paint('error', err?.message || 'The link could not be saved.'); }
      finally { btn.disabled = false; }
    });
  }
  function setupIntegrations() {
    const state = { cat: '', q: '' }; paintTiles(state);
    $('#int-q').addEventListener('input', e => { state.q = e.target.value.trim(); paintTiles(state); });
    $('#int-cats').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (!b) return; state.cat = b.dataset.cat; document.querySelectorAll('#int-cats button').forEach(x => x.classList.toggle('on', x === b)); paintTiles(state); });
    $('#int-grid').addEventListener('click', e => {
      const tile = e.target.closest('[data-int]'); if (!tile) return;
      const item = CATALOG.find(x => x.id === tile.dataset.int);
      if (item.live) {
        modal({ title: item.name, sub: 'Save a meeting link and open it in a new tab.', iconHtml: camSvg(20), bodyHtml: intCard(item.id, ML().load()[item.id]), trigger: tile,
          onMount: wrap => bindIntCard(wrap.querySelector('.int-card'), () => paintTiles(state)) });
      } else {
        modal({ title: item.name + ' — coming soon', sub: 'This integration is not available yet.', iconHtml: `<span style="font-weight:600">${esc(item.glyph)}</span>`, trigger: tile,
          bodyHtml: `<p class="sm-note" style="border:0;padding:0;margin:0 0 16px">${esc(item.name)} is on our list but cannot be connected yet. Nothing has been saved or sent anywhere. Today VOXA supports <b>Google Meet</b> and <b>Zoom</b> meeting links.</p><div class="sm-actions" style="margin-top:0"><button type="button" class="sm-btn go" data-close>Got it</button></div>` });
      }
    });
  }

  /* ================= Chrome extension ================= */
  function ChromeExtension() {
    const V = (t, tone, label, d, ic) => `<div class="cx-v ${tone}"><div class="cx-v-top"><span class="cx-ic">${ic}</span><em>${label}</em></div><h3>${t}</h3><p>${d}</p></div>`;
    const ok = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>', bad = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>', unk = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/></svg>';
    return `<div class="wrapv md cx"><section class="mt-card cx-hero"><div class="cx-tags"><span class="cx-tag">Chrome extension</span><span class="cx-beta">Beta</span></div>
      <h1>Check media for AI generation while you browse.</h1>
      <p class="cx-lead">Right-click any image, video or audio clip and VOXA checks it for AI generation through your own local VOXA server. No data goes anywhere else.</p>
      <button class="cx-install" id="cx-go" type="button"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg> Install extension</button>
      <div class="cx-works"><b>Works on</b><span>Images</span><span>Videos</span><span>Audio clips</span><span>Any site where you can right-click media</span></div></section>
      <p class="md-eyebrow">Know what you're looking at</p><h2 class="md-title">Every check returns a clear verdict.</h2>
      <div class="cx-verdicts">${V('Authentic', 'green', 'No action needed', 'No signs of AI generation detected. This does not prove the content is trustworthy.', ok)}${V('AI-generated', 'red', 'Treat with skepticism', 'Signs of AI generation or manipulation. Check the source before sharing.', bad)}${V('Uncertain', 'amber', 'Use your judgement', 'No confident conclusion. Common with heavily compressed or low-quality media.', unk)}</div>
      <section class="mt-card" id="cx-install-card"><div class="mt-card-h"><h2>Install in four steps</h2><div class="md-engine" id="cx-status"><span class="md-chip">Checking VOXA…</span></div></div><div class="mt-card-b"><ol class="cx-steps">
        <li><b>Open the extensions page</b><span>Go to <code>chrome://extensions</code> and switch on <b>Developer mode</b>.</span></li>
        <li><b>Load the extension</b><span>Choose <b>Load unpacked</b> and select the <code>extension</code> folder inside your VOXA project.</span></li>
        <li><b>Allow it in VOXA</b><span>Copy the extension ID shown on the card. Add <code>VOXA_EXTENSION_ID=&lt;that id&gt;</code> to <code>.env.local</code> and restart VOXA. Only that ID may call your server.</span></li>
        <li><b>Check media</b><span>Right-click an image, video or audio clip and choose <b>Check with VOXA</b>. The verdict appears as a notification, and the toolbar icon lists recent checks.</span></li></ol></div></section>
      <div class="mt-row r-1-1">${card('Before you rely on it', `<ul class="md-ul"><li>VOXA must be running (<code>start-voxa.cmd</code>) while you browse.</li><li>Each check uses one scan with your configured detector. Reality Defender's free plan allows 50 a month; FREE_MODE still applies.</li><li>Limits: images 10 MB, audio 20 MB, video 32 MB. Videos use the Sealed Rose detector, which costs 12 credits.</li><li>Checks from the extension are not saved as VOXA reports; the extension keeps its own short history.</li></ul>`)}
        ${card('Privacy', `<ul class="md-ul"><li>Your browser downloads the media and sends it only to <code>127.0.0.1</code>, your VOXA server.</li><li>VOXA forwards it to the detector you configured and keeps no copy.</li><li>The extension asks for access to all sites so it can download the media you right-click. It does not read pages or browsing history.</li></ul>`)}</div></div>`;
  }
  function setupChromeExtension() {
    $('#cx-go')?.addEventListener('click', () => $('#cx-install-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    fetch('/api/status').then(r => r.json()).then(d => {
      const el = $('#cx-status'); if (!el) return;
      const det = d.details.realitydefender?.allowed && d.details.realitydefender?.configured ? 'Reality Defender ready' : d.details.sealedrose?.allowed && d.details.sealedrose?.configured ? 'Sealed Rose ready' : 'No detector ready';
      el.innerHTML = `<span class="md-chip ok"><b>VOXA</b> running</span><span class="md-chip ${d.tools.extension ? 'ok' : 'warn'}"><b>Extension ID</b> ${d.tools.extension ? 'configured' : 'not set'}</span><span class="md-chip ${/ready/.test(det) ? 'ok' : 'warn'}">${det}</span>`;
    }).catch(() => { const el = $('#cx-status'); if (el) el.innerHTML = '<span class="md-chip bad">VOXA server not reachable</span>'; });
  }

  window.VoxaSignal = { loadAudio, analyzeSignal, drawWave, drawSpec, drawPitch, warnings };
  return { Integrations, setupIntegrations, Intelligence, setupIntelligence, Signal, setupSignal, Watermarking, setupWatermarking, ChromeExtension, setupChromeExtension };
};
