/* Noise Analysis Report. Uses the existing report layout (rep-head, rep-sum, rep-sec, kvt tables, ev, lim) and the
   same element ids as the voice report (#i-status, #i-note, #i-add, #i-json, #i-pdf, #i-del), so the existing page
   handlers (status, notes, JSON export, print/PDF, delete) work on it unchanged. */
window.makeNoiseReport = function (c) {
  const { esc, fmt, incidents, previews, section, table, session, reportTypeOf, RT, STATUS } = c;
  const Q = { good: ['Good', 'ok'], fair: ['Fair', 'warn'], poor: ['Poor', 'bad'], unavailable: ['Unavailable', 'na'] };
  const L = { low: ['Low', 'ok'], medium: ['Medium', 'warn'], high: ['High', 'bad'], unavailable: ['Unavailable', 'na'] };
  const SPK = { yes: 'ok', no: 'warn', uncertain: 'na' };
  const ACTION = { keep_original: 'Keep the original', apply_noise_reduction: 'Reduce noise or re-record', record_again: 'Record again', insufficient: 'Insufficient evidence' };
  const u = (v, unit = '') => (v === null || v === undefined ? 'Unavailable' : v + unit);
  const sgn = v => (v === null || v === undefined ? 'n/a' : (v > 0 ? '+' : '') + v + ' dB');
  const pctOf = v => (v === null || v === undefined ? 'Unavailable' : Math.round(v * 1000) / 10 + '%');

  const related = i => {
    const sib = incidents().filter(x => x.uploadId && x.uploadId === i.uploadId && x.id !== i.id);
    if (!sib.length) return '';
    return section('Related reports from the same upload', `<ul class="rel-list">${sib.map(x => `<li><a href="#/incident/${encodeURIComponent(x.id)}">${esc(RT[reportTypeOf(x)] || 'Report')}</a> · ${esc(fmt(x.at))} · <small>${esc(x.id)}</small></li>`).join('')}</ul>`,
      'Reports made from the same selected file in one session. VOXA does not store the audio itself.');
  };

  function audioBlock(i, n, enh, pv) {
    const orig = pv?.url ? `<div class="nz-aud"><h3>Original (unchanged)</h3><audio src="${esc(pv.url)}" controls preload="metadata" aria-label="Play the original audio"></audio><canvas id="i-wave" class="rep-wave" height="120" aria-label="Original audio waveform"></canvas></div>` : '';
    const gone = `<p class="rep-note" style="margin:0">Playback is unavailable. VOXA does not store audio, so players exist only in the browser tab that ran the analysis. The measurements in this report were kept.</p>`;
    if (!enh.requested) {
      return (pv?.url ? orig : gone) + `<p class="rep-note">Enhancement applied: <b>No</b>. No enhanced copy was requested. Tick “Create enhanced copy” before Analyze Noise to produce one; the original is never modified.</p>`;
    }
    if (!enh.applied) return (pv?.url ? orig : gone) + `<p class="rep-note">Enhancement applied: <b>No</b>. It was requested but could not be completed${enh.reason ? ' (' + esc(enh.reason) + ')' : ''}. The original is unchanged.</p>`;
    const m = enh.measured || {}, b = enh.before || {}, a = enh.after || {};
    const enhPlayer = pv?.enhancedUrl
      ? `<div class="nz-aud"><h3>Enhanced copy</h3><audio src="${esc(pv.enhancedUrl)}" controls preload="metadata" aria-label="Play the enhanced audio"></audio><canvas id="i-wave2" class="rep-wave" height="120" aria-label="Enhanced audio waveform"></canvas>
         <div class="no-print"><a class="btn sec" id="i-dl-enh" href="${esc(pv.enhancedUrl)}" download="${esc((i.media?.name || 'audio').replace(/\.[^.]+$/, ''))}-enhanced.wav">Download enhanced audio (WAV)</a></div></div>`
      : `<p class="rep-note">The enhanced file is not stored by VOXA, so playback and download are unavailable after the tab that created it is closed or reloaded.</p>`;
    const row = (label, x, y, d) => `<tr><th scope="row">${esc(label)}</th><td>${esc(x)}</td><td>${esc(y)}</td><td>${esc(d)}</td></tr>`;
    const ba = `<table class="kvt nz-ba"><thead><tr><th></th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>
      ${row('Noise floor (quietest frames)', u(b.floorDbfs, ' dBFS'), u(a.floorDbfs, ' dBFS'), sgn(m.floorChangeDb))}
      ${row('Estimated SNR', u(b.snrDb, ' dB'), u(a.snrDb, ' dB'), sgn(m.snrChangeDb))}
      ${row('Speech level', u(b.activeLevelDbfs, ' dBFS'), u(a.activeLevelDbfs, ' dBFS'), sgn(m.speechLevelChangeDb))}
      ${b.humProminenceDb !== null && b.humProminenceDb >= 10 ? row('Mains-hum prominence', u(b.humProminenceDb, ' dB'), u(a.humProminenceDb, ' dB'), sgn(m.humChangeDb)) : ''}
      ${row('Speech detected', b.speechDetected, a.speechDetected, b.speechDetected === a.speechDetected ? 'same' : 'changed')}</tbody></table>`;
    return `<div class="nz-pair">${pv?.url ? orig : ''}${enhPlayer}</div>
      ${pv?.url ? '' : gone}
      ${table([['Enhancement applied', 'Yes'], ['Processing method', enh.method], ['Filter chain (FFmpeg)', `<code class="nz-code">${esc((enh.filters || []).join(', '))}</code>`, true], ['Output', enh.output ? `${enh.output.format}, ${enh.output.channels === 1 ? 'mono' : enh.output.channels + ' ch'}, ${enh.output.sampleRate.toLocaleString()} Hz, ${(enh.output.sizeBytes / 1024).toFixed(0)} KB` : null], ['Measured improvement', enh.measuredImprovement ? 'Yes (quiet level, SNR or hum fell or rose by the stated thresholds)' : 'No measurable improvement']])}
      ${ba}
      <p class="rep-note">${esc(enh.note || '')}</p>
      <p class="rep-note">The rows above are signal measurements. Whether the enhanced audio sounds better is a listening judgement; VOXA does not score it.</p>`;
  }

  function view(i) {
    const n = i.noise, media = i.media, enh = n.enhancement || { requested: false, applied: false }, pv = previews.get(i.id);
    const q = Q[n.quality.rating], lv = L[n.noise.level], f = n.file || {};
    const head = `<header class="rep-head"><div><p class="report-eyebrow">Noise analysis report</p><h1>${esc(media?.name || 'Audio')}</h1><p class="sub">Noise analysis · ${fmt(i.at)} · ${esc(i.id)}</p></div><div class="rep-actions no-print"><button class="btn sec" id="i-pdf">Print report</button><a class="btn" href="#/analyze">New analysis</a></div></header>`;
    const sum = `<div class="rep-sum"><div><span>Speech detected</span><b class="rep-badge ${SPK[n.speech.detected]}">${esc(n.speech.label)}</b><small>${esc(n.speech.method)}</small></div>
      <div><span>Background noise</span><b class="rep-badge ${lv[1]}">${lv[0]}</b><small>${n.noise.snrDb !== null ? 'Estimated SNR ' + n.noise.snrDb + ' dB' : 'SNR unavailable'}</small></div>
      <div><span>Audio quality</span><b class="rep-badge ${q[1]}">${q[0]}</b><small>${esc(n.quality.suitabilityText)}</small></div>
      <div><span>Status</span><b>${i.processing === 'completed' || !i.processing ? 'Completed' : esc(i.processing)}</b><small>${esc(i.id)}</small></div></div>`;
    const details = table([['Report type', RT.noise_analysis], ['Report ID', i.id], ['Upload ID', i.uploadId], ['Original file', media?.name], ['Analysis time', fmt(i.at)], ['Processing status', 'Completed'], ['Author', session.email], ['Analyzer', `${n.method} · v${n.analyzerVersion}`], ['Privacy', 'VOXA keeps no copy of the audio. This report holds measurements only; it stays in this tab session unless you kept it for 24 hours.']]);
    const props = table([['Duration', u(f.durationSec, ' s')], ['Sample rate', f.sampleRate ? f.sampleRate.toLocaleString() + ' Hz' : 'Unavailable'], ['Channels', u(f.channels)], ['Codec', u(f.codec)], ['File size', f.sizeBytes ? f.sizeBytes.toLocaleString() + ' bytes' : null], ['Analysed', `First channel, rendered at ${(f.analysisRateHz || 16000).toLocaleString()} Hz mono (peak and clipping use its native rate)`]]);
    const speech = table([['Speech detected', n.speech.label], ['Voiced (pitch-periodic) audio', u(n.speech.speechSec, ' s')], ['Pitch movement', n.speech.pitchSpreadSemitones === null || n.speech.pitchSpreadSemitones === undefined ? 'Unavailable' : n.speech.pitchSpreadSemitones + ' semitones (10th to 90th percentile)']]) + `<p class="rep-note">${esc(n.evidence[0].how)}</p>`;
    const ind = n.noise.indicators.length
      ? n.noise.indicators.map(x => `<div class="ev"><b>${esc(x.label)}</b><small>${esc(x.how)}</small></div>`).join('') + '<p class="rep-note">These describe the spectrum of the quietest frames. VOXA does not identify what is making the noise.</p>'
      : n.noise.indicatorsChecked ? '<p class="rep-note" style="margin:0">No mains-hum, high-frequency hiss-like or low-frequency rumble indicators were found in the quietest frames.</p>'
        : '<p class="rep-note" style="margin:0"><b>Insufficient evidence.</b> Noise indicators need a steady, measurable quiet floor of at least about a second; this recording does not provide one.</p>';
    const noise = table([['Background-noise level', lv[0]], ['Basis', { snr: 'Estimated SNR', 'absolute-floor': 'Absolute quiet level (no defensible SNR)', 'silent-pauses': 'Digitally silent pauses' }[n.noise.basis] || 'Unavailable'], ['Noise floor', u(n.noise.floorDbfs, ' dBFS')], ['Speech level', u(n.noise.activeLevelDbfs, ' dBFS')], ['Estimated SNR', u(n.noise.snrDb, ' dB')]]) + `<p class="rep-note">${esc(n.evidence[1].how)} ${esc(n.noise.snrNote)}</p>` + ind;
    const lev = n.levels;
    const levels = table([['Peak level', lev ? lev.peakDbfs + ' dBFS' : 'Unavailable'], ['RMS level', lev ? lev.rmsDbfs + ' dBFS' : 'Unavailable'], ['Clipping', n.clipping ? (n.clipping.detected ? `Detected: ${n.clipping.runs} runs, ${pctOf(n.clipping.ratio)} of samples` : 'None detected') : 'Unavailable'], ['Quiet audio (below -60 dBFS)', pctOf(n.silence.quietRatio)], ['Longest quiet stretch', u(n.silence.longestSec, ' s')], ['Digital silence', pctOf(n.silence.digitalRatio)]]);
    const quality = `<div class="rep-row"><span class="rep-badge ${q[1]}">${q[0]}</span><span>${esc(n.quality.suitabilityText)}</span></div>
      ${n.quality.issues.length ? `<ul style="margin:8px 0 0;padding-left:18px">${n.quality.issues.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="rep-note" style="margin:8px 0 0">No issues were found by the measurements above.</p>'}
      <p class="rep-note">Rating rules: poor when speech is missing, noise is high or clipping is heavy; fair when any smaller issue is found; good when none is. There is no numeric score.</p>`;
    const evidence = `<table class="kvt"><tbody>${n.evidence.map(e => `<tr><th scope="row">${esc(e.item)}</th><td><b>${esc(e.value)}</b><br><small>${esc(e.how)}</small></td></tr>`).join('')}</tbody></table>`;
    const rec = `<div class="rep-row"><span class="rep-badge ${n.recommendation.action === 'keep_original' ? 'ok' : n.recommendation.action === 'insufficient' ? 'na' : 'warn'}">${esc(ACTION[n.recommendation.action] || n.recommendation.action)}</span><span>${esc(n.recommendation.text)}</span></div>`;
    return `<div class="wrapv rep">${head}${sum}
      ${section('Report details', details)}
      ${section('Audio properties', props)}
      ${section('Speech detection', speech)}
      ${section('Background noise', noise)}
      ${section('Levels, clipping and silence', levels)}
      ${section('Audio-quality assessment', quality)}
      ${section('Original and enhanced audio', audioBlock(i, n, enh, pv))}
      ${section('Evidence: how each result was calculated', evidence)}
      ${section('Recommended next action', rec)}
      ${related(i)}
      <section class="rep-sec no-print"><h2>Status and notes</h2>
        <div class="filters" style="margin-top:0"><select id="i-status" aria-label="Report status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${i.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
        ${i.notes.map(x => `<div class="ev"><small>${fmt(x.at)}</small>${esc(x.text)}</div>`).join('')}
        <div class="filters"><input id="i-note" aria-label="Analyst note" style="flex:1;min-width:200px" placeholder="Add analyst note…"><button class="btn" id="i-add">Add note</button></div></section>
      <div class="lim"><b>Limitations and uncertainty.</b><ul style="margin:6px 0 0;padding-left:18px">${n.limitations.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="row-actions no-print"><button class="btn sec" id="i-json">Export JSON</button><button class="btn danger" id="i-del">Delete report</button><a class="link" href="#/incidents">Back to call reports</a></div></div>`;
  }
  return { view, related };
};
