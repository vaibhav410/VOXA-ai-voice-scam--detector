/* History: past analyses (voice, image, video, live) grouped by day, with the conversation snippet and a
   media preview. Follows VOXA's privacy model: raw media is never persisted, so a playable preview exists only
   in the tab that ran the analysis; after a reload the entry keeps its report but shows "Preview not stored". */
window.makeHistory = function (c) {
  const { $, esc, store, incidents, PRI, pill, STATUS, toast, reportTypeOf, RT } = c;
  const TYPES = { voice: 'Voice', image: 'Image', video: 'Video' };
  const kindOf = i => (i.media?.source === 'live' ? 'live' : i.modality || 'voice');
  const previews = () => window.VoxaPreviews || new Map();
  const state = { q: '', kind: '', pri: '', rt: '' };
  const GLYPH = { voice: '🎙', image: '🖼', video: '🎬', live: '📡', text: '📝' };

  const dayLabel = t => {
    const d = new Date(t), start = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((start(new Date()) - start(d)) / 86400000);
    return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString([], { dateStyle: 'long' });
  };
  const time = t => new Date(t).toLocaleTimeString([], { timeStyle: 'short' });
  const dur = s => (typeof s === 'number' && s > 0 ? (s >= 60 ? Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s' : Math.round(s) + ' s') : '');
  const snippet = i => {
    const t = (i.transcript?.text || '').replace(/\s+/g, ' ').trim();
    if (t) return t.length > 180 ? t.slice(0, 180) + '…' : t;
    const ex = i.intent?.rules?.[0]?.excerpt;
    return ex ? ex : '';
  };
  const title = i => i.meeting?.title || i.media?.name || 'Text analysis';
  const isNoise = i => reportTypeOf(i) === 'noise_analysis' && i.noise;
  const LV = { low: 'Low', medium: 'Medium', high: 'High', unavailable: 'Unavailable' };
  const QL = { good: 'Good', fair: 'Fair', poor: 'Poor', unavailable: 'Unavailable' };
  const noiseLine = i => `Speech: ${i.noise.speech.label} · Noise: ${LV[i.noise.noise.level]}${i.noise.noise.snrDb !== null ? ' (SNR ' + i.noise.noise.snrDb + ' dB)' : ''} · Quality: ${QL[i.noise.quality.rating]}`;

  function tile(i) {
    const k = kindOf(i), pv = previews().get(i.id);
    if (pv && pv.kind === 'video') return `<video class="hs-media" src="${esc(pv.url)}" controls preload="metadata" aria-label="Replay video ${esc(title(i))}"></video>`;
    if (pv && pv.kind === 'image') return `<img class="hs-media" src="${esc(pv.url)}" alt="Image submitted for ${esc(title(i))}">`;
    if (pv && pv.kind === 'voice') return `<div class="hs-media hs-audio"><div><small>Original</small><audio src="${esc(pv.url)}" controls preload="none" aria-label="Replay original audio ${esc(title(i))}"></audio>${pv.enhancedUrl ? `<small>Enhanced copy</small><audio src="${esc(pv.enhancedUrl)}" controls preload="none" aria-label="Replay enhanced audio ${esc(title(i))}"></audio>` : ''}</div></div>`;
    return `<div class="hs-media hs-none" title="VOXA does not store media"><span aria-hidden="true">${GLYPH[i.media ? k : 'text']}</span><small>Preview not stored</small></div>`;
  }

  function card(i) {
    const k = kindOf(i), noise = isNoise(i), sn = noise ? noiseLine(i) : snippet(i), flags = noise ? i.noise.noise.indicators.slice(0, 3) : (i.intent?.rules || []).slice(0, 3);
    const meta = [RT[reportTypeOf(i)], i.media ? (k === 'live' ? 'Live session' : TYPES[k]) : 'Text', dur(i.media?.duration), time(i.at)].filter(Boolean).join(' · ');
    return `<article class="hs-card" data-id="${esc(i.id)}">${tile(i)}
      <div class="hs-body"><div class="hs-top"><h3><a href="#/incident/${encodeURIComponent(i.id)}">${esc(title(i))}</a></h3><span class="hs-pills">${noise ? `<span class="pill p-nee">Noise report</span>` : PRI[i.priority] ? pill(PRI, i.priority) : ''}${STATUS[i.status] ? pill(STATUS, i.status) : ''}</span></div>
        <p class="hs-meta">${esc(meta)} · ${i.persist ? 'Kept up to 24 h' : 'This session only'}${noise && i.noise.enhancement?.applied ? ' · Enhanced copy made' : ''}</p>
        ${sn ? `<blockquote class="hs-quote">${esc(sn)}</blockquote>` : '<p class="hs-meta">No transcript saved for this analysis.</p>'}
        ${flags.length ? `<p class="hs-flags">${flags.map(f => `<span>${esc(f.label)}</span>`).join('')}</p>` : ''}
        <div class="hs-actions"><a class="mt-btn sm primary" href="#/incident/${encodeURIComponent(i.id)}">Open report</a><button class="mt-btn sm" data-del="${esc(i.id)}" type="button">Delete</button></div></div></article>`;
  }

  function View() {
    return `<div class="wrapv hs"><p class="report-eyebrow">Past conversations</p><h1>History</h1>
      <p class="sub">Every voice, image, video and live analysis from this workspace, newest first. VOXA does not persist raw media, so a replayable preview is available only in the tab that ran the analysis.</p>
      <div class="hs-bar"><div class="an-tabs modtabs" id="hs-kinds" role="group" aria-label="Filter by type"></div>
        <input id="hs-q" type="search" aria-label="Search history" placeholder="Search names or conversation text…"><select id="hs-rt" aria-label="Filter by report type"><option value="">All report types</option>${Object.entries(RT).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select><select id="hs-p" aria-label="Filter by priority"><option value="">All priorities</option>${Object.entries(PRI).map(([k, v]) => `<option value="${k}">${esc(v[0])}</option>`).join('')}</select></div>
      <p id="hs-count" class="hs-count" role="status"></p><div id="hs-list"></div></div>`;
  }

  function setup() {
    const all = () => incidents().slice().sort((a, b) => b.at - a.at);
    const kinds = [['', 'All'], ['voice', 'Voice'], ['image', 'Image'], ['video', 'Video'], ['live', 'Live']];
    $('#hs-q').value = state.q; $('#hs-p').value = state.pri; $('#hs-rt').value = state.rt;
    const draw = () => {
      const rows = all(), counts = { '': rows.length };
      for (const r of rows) counts[kindOf(r)] = (counts[kindOf(r)] || 0) + 1;
      $('#hs-kinds').innerHTML = kinds.map(([k, l]) => `<button type="button" data-k="${k}" class="${state.kind === k ? 'on' : ''}" aria-pressed="${state.kind === k}">${l} <span class="hs-n">${counts[k] || 0}</span></button>`).join('');
      const q = state.q.toLowerCase();
      const list = rows.filter(i => (!state.kind || kindOf(i) === state.kind) && (!state.rt || reportTypeOf(i) === state.rt) && (!state.pri || i.priority === state.pri)
        && (!q || [title(i), i.id, RT[reportTypeOf(i)], i.transcript?.text, isNoise(i) ? noiseLine(i) : '', (i.intent?.rules || []).map(r => r.label + ' ' + r.excerpt).join(' ')].filter(Boolean).join(' ').toLowerCase().includes(q)));
      $('#hs-count').textContent = list.length ? `${list.length} past ${list.length === 1 ? 'analysis' : 'analyses'}` + (state.kind || state.pri || state.rt || q ? ' match' : '') : '';
      if (!list.length) {
        $('#hs-list').innerHTML = `<div class="empty-box"><div class="inbox">▭</div><b>${rows.length ? 'No analyses match these filters' : 'No past analyses yet'}</b><p>${rows.length ? 'Try a different type, priority or search.' : 'Run an analysis and it will appear here.'}</p>${rows.length ? '' : '<a class="mt-btn primary" href="#/analyze">Analyze media</a>'}</div>`;
        return;
      }
      let last = '', out = '';
      for (const i of list) { const d = dayLabel(i.at); if (d !== last) { out += `<h2 class="hs-day">${esc(d)}</h2>`; last = d; } out += card(i); }
      $('#hs-list').innerHTML = out;
    };
    $('#hs-kinds').onclick = e => { const b = e.target.closest('[data-k]'); if (b) { state.kind = b.dataset.k; draw(); } };
    $('#hs-q').oninput = e => { state.q = e.target.value; draw(); };
    $('#hs-p').onchange = e => { state.pri = e.target.value; draw(); };
    $('#hs-rt').onchange = e => { state.rt = e.target.value; draw(); };
    let armed = null;
    $('#hs-list').onclick = e => {
      const b = e.target.closest('[data-del]'); if (!b) return;
      const id = b.dataset.del;
      if (armed !== id) { armed = id; document.querySelectorAll('[data-del]').forEach(x => (x.textContent = 'Delete')); b.textContent = 'Click again to delete'; return; }
      window.VoxaRevokePreview?.(id);
      store.set('incidents', incidents().filter(x => x.id !== id));
      store.set('alerts', store.get('alerts', []).filter(x => x.incidentId !== id));
      armed = null; toast('Analysis deleted.'); draw();
    };
    draw();
  }
  return { View, setup };
};
