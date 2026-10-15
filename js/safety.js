window.makeSafety = function({$,esc,store,incidents,S,PRI,STATUS,pill,fmt,uid,toast}) {
 let clean=()=>{};
 const alerts=()=>store.get('alerts',[]);
 const advice=()=>`<div class="safety-guidance"><b>Pause before you act</b><p>Do not share OTPs, PINs or card details. Hang up and call back on an official number. Do not install remote-access apps.</p><a href="tel:1930">Financial cyber fraud in India: 1930</a> · <a href="https://cybercrime.gov.in/" target="_blank" rel="noopener">Report online</a></div>`;
 // ---- Call safety dashboard (all numbers come from this browser's saved reports and alerts) ----
 const isLive = i => i.media?.source === 'live';
 const ATTN = ['AI_GENERATED', 'SUSPICIOUS'];
 // A report needs attention when scam intent is medium/high OR a detector flagged the media. The two stay separate in the report.
 const attention = i => ['high', 'medium'].includes(i.priority) || ATTN.includes(i.authenticity?.code) || ATTN.includes(i.audioAuthenticity?.code);
 const aiFlag = i => i.authenticity?.code === 'AI_GENERATED' || i.audioAuthenticity?.code === 'AI_GENERATED';
 let dashSrc = 'all'; try { dashSrc = sessionStorage.getItem('voxa:dash-src') || 'all'; } catch {}
 const dashList = () => { const all = incidents(); return dashSrc === 'all' ? all : all.filter(i => (dashSrc === 'live') === isLive(i)); };
 const liveStats = () => {
  const week = Date.now() - 7 * 86400000, sessions = incidents().filter(isLive);
  return {sessions, week7: sessions.filter(i => i.at >= week).length, alerts7: alerts().filter(a => !a.retracted && a.source === 'Live microphone' && a.at >= week).length, last: sessions[0]?.at || null};
 };
 const ICON = {
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 9"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  live: '<circle cx="12" cy="12" r="2.2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  users: '<path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"/><circle cx="9.5" cy="7" r="3.5"/><path d="M21 19v-1a4 4 0 0 0-3-3.9M16 3.2a3.5 3.5 0 0 1 0 6.6"/>',
  flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0"/>',
  bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16.5h6"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>',
  shield: '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'
 };
 const svg = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
 const DAY = 86400000;
 const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
 const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago'; };
 const authLabel = i => ({AI_GENERATED: ['AI-generated', 'red'], NOT_FLAGGED: ['No AI detected', 'green'], SUSPICIOUS: ['Suspicious', 'amber']}[i.authenticity?.code] || ['Unavailable', 'grey']);
 function series(list, n) {
  const today = startOfDay(Date.now());
  return Array.from({length: n}, (_, j) => { const t = today - (n - 1 - j) * DAY, rows = list.filter(i => i.at >= t && i.at < t + DAY); return {t, all: rows.length, high: rows.filter(i => i.priority === 'high').length}; });
 }
 function smooth(pts, top, base) {
  if (pts.length < 2) return '';
  const cl = y => Math.min(base, Math.max(top, y));
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
   const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, k = 0.18;
   d += ` C${(p1[0] + (p2[0] - p0[0]) * k).toFixed(1)},${cl(p1[1] + (p2[1] - p0[1]) * k).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) * k).toFixed(1)},${cl(p2[1] - (p3[1] - p1[1]) * k).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
 }
 function volumeChart(list, n) {
  const data = series(list, n), W = 640, H = 270, L = 40, R = 12, T = 14, B = 28, base = H - B, top = T;
  const max = Math.max(1, ...data.map(d => d.all)), step = Math.max(1, Math.ceil(max / 4)), ymax = step * 4;
  const x = j => L + (n === 1 ? 0 : j * (W - L - R) / (n - 1)), y = v => base - v / ymax * (base - top);
  const all = data.map((d, j) => [x(j), y(d.all)]), high = data.map((d, j) => [x(j), y(d.high)]);
  const grid = [0, 1, 2, 3, 4].map(k => `<line x1="${L}" x2="${W - R}" y1="${y(k * step)}" y2="${y(k * step)}" class="mt-grid"/><text x="${L - 8}" y="${y(k * step) + 4}" text-anchor="end" class="mt-tick">${k * step}</text>`).join('');
  const every = n <= 7 ? 1 : n <= 30 ? 5 : 15;
  const xl = data.map((d, j) => (j % every === 0 || j === n - 1) ? `<text x="${x(j)}" y="${H - 8}" text-anchor="middle" class="mt-tick">${new Date(d.t).toLocaleDateString([], n <= 7 ? {weekday: 'short'} : {month: 'short', day: 'numeric'})}</text>` : '').join('');
  const line = smooth(all, top, base);
  const desc = data.map(d => `${new Date(d.t).toLocaleDateString()}: ${d.all} calls, ${d.high} high risk`).join('; ');
  return `<svg viewBox="0 0 ${W} ${H}" class="mt-svg" role="img" aria-label="Call volume, last ${n} days. ${esc(desc)}">${grid}
   <path d="${line} L${x(n - 1)},${base} L${x(0)},${base} Z" class="mt-area"/><path d="${line}" class="mt-line-blue"/><path d="${smooth(high, top, base)}" class="mt-line-teal"/>${xl}</svg>
   <p class="mt-legend"><i class="mt-dot blue"></i>All analyzed calls <i class="mt-dot teal"></i>High-risk calls</p>`;
 }
 function donut(list) {
  const keys = ['high', 'medium', 'low', 'nee'], color = {high: '#dc2626', medium: '#e07b00', low: '#16a34a', nee: '#94a3b8'};
  const counts = Object.fromEntries(keys.map(k => [k, 0])); list.forEach(i => counts[keys.includes(i.priority) ? i.priority : 'nee']++);
  const total = list.length, R = 64, C = 2 * Math.PI * R; let off = 0;
  const segs = total ? keys.filter(k => counts[k]).map(k => { const len = counts[k] / total * C; const s = `<circle cx="90" cy="90" r="${R}" fill="none" stroke="${color[k]}" stroke-width="26" stroke-dasharray="${Math.max(0, len - (total > 1 ? 2 : 0)).toFixed(2)} ${(C - len + (total > 1 ? 2 : 0)).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 90 90)"/>`; off += len; return s; }).join('') : `<circle cx="90" cy="90" r="${R}" fill="none" stroke="#e5e7eb" stroke-width="26"/>`;
  return `<svg viewBox="0 0 180 180" class="mt-donut" role="img" aria-label="Reports by action priority">${segs}<text x="90" y="88" text-anchor="middle" class="mt-donut-n">${total}</text><text x="90" y="106" text-anchor="middle" class="mt-tick">reports</text></svg>
   <ul class="mt-legend-list">${keys.map(k => `<li><i class="mt-dot" style="background:${color[k]}"></i>${esc(PRI[k]?.[0] || k)}<b>${counts[k]}</b></li>`).join('')}</ul>`;
 }
 function ring(used, cap) {
  const R = 56, C = 2 * Math.PI * R, f = Math.min(1, used / cap);
  return `<svg viewBox="0 0 150 150" class="mt-ring" role="img" aria-label="${used} of ${cap} free-plan scans used in retained reports this month"><circle cx="75" cy="75" r="${R}" fill="none" stroke="#e5e7eb" stroke-width="9"/>${f > 0 ? `<circle cx="75" cy="75" r="${R}" fill="none" stroke="#4f46e5" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(f * C).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 75 75)"/>` : ''}<text x="75" y="70" text-anchor="middle" class="mt-tick">Scans used</text><text x="75" y="94" text-anchor="middle" class="mt-ring-n">${used}/${cap}</text></svg>`;
 }
 function delta(cur, prev, riskUp) {
  if (!cur && !prev) return '<span class="mt-delta flat">No data yet</span>';
  if (!prev) return `<span class="mt-delta ${riskUp ? 'bad' : 'good'}">↑ +${cur} vs previous 7 days</span>`;
  const p = Math.round((cur - prev) / prev * 100);
  if (p === 0) return '<span class="mt-delta flat">• No change vs previous 7 days</span>';
  return `<span class="mt-delta ${(p > 0) === !!riskUp ? 'bad' : 'good'}">${p > 0 ? '↑ +' : '↓ '}${p}% vs previous 7 days</span>`;
 }
 function Dashboard() {
  const list = dashList(), history = alerts().filter(a => !a.retracted && (dashSrc === 'all' || (dashSrc === 'live') === (a.source === 'Live microphone'))), now = Date.now(), live = liveStats();
  const inWin = (rows, a, b) => rows.filter(r => r.at >= a && r.at < b);
  const cur = inWin(list, now - 7 * DAY, now + 1), prev = inWin(list, now - 14 * DAY, now - 7 * DAY);
  const curA = inWin(history, now - 7 * DAY, now + 1), prevA = inWin(history, now - 14 * DAY, now - 7 * DAY);
  const flagged = r => r.filter(attention).length, ai = r => r.filter(aiFlag).length;
  const kpi = (icon, label, value, d) => `<div class="mt-kpi"><div class="mt-kpi-ic">${svg(icon, 20)}</div><div><span>${label}</span><strong>${value}</strong>${d}</div></div>`;
  const counts = {}; list.forEach(i => i.intent?.rules.forEach(r => counts[r.label] = (counts[r.label] || 0) + 1));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 7), topMax = Math.max(1, ...top.map(t => t[1]));
  const bars = top.length ? `<div class="mt-bars">${top.map(([label, n]) => `<div title="${esc(label)}: ${n}"><span class="mt-bar-n">${n}</span><i style="height:${Math.max(4, n / topMax * 100)}%"></i><em>${esc(label)}</em></div>`).join('')}</div>` : '<p class="empty-state">No indicators yet. Analyze a consented recording to begin.</p>';
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const scans = list.filter(i => i.at >= +month).reduce((n, i) => n + (i.authenticity?.status === 'ok' && i.authenticity.provider === 'realitydefender' ? 1 : 0) + (i.audioAuthenticity?.status === 'ok' && i.audioAuthenticity.provider === 'realitydefender' ? 1 : 0), 0);
  const feed = [...list.map(i => ({at: i.at, kind: 'report', i})), ...history.map(a => ({at: a.at, kind: 'alert', a}))].sort((x, y) => y.at - x.at).slice(0, 6);
  const activity = feed.length ? feed.map(f => f.kind === 'report'
    ? `<a class="mt-act" href="#/incident/${encodeURIComponent(f.i.id)}"><span class="mt-act-ic">${svg('file', 15)}</span><div><b>${esc(f.i.media?.name || 'Text analysis')}</b><small>${esc((f.i.media ? MODN[f.i.modality || 'voice'] : 'Text'))} · ${esc(PRI[f.i.priority]?.[0] || 'Not assessed')} · ${ago(f.at)}</small></div></a>`
    : `<a class="mt-act" href="#/incident/${encodeURIComponent(f.a.incidentId || '')}"><span class="mt-act-ic warn">${svg('bell', 15)}</span><div><b>High-risk alert</b><small>${esc((f.a.labels || []).join(', '))} · ${ago(f.at)}</small></div></a>`).join('')
    : '<p class="empty-state">Activity appears here after your first analysis or live session.</p>';
  const recent = list.slice(0, 6);
  const table = recent.length ? `<div class="mt-table-wrap"><table class="mt-table"><thead><tr><th>Report</th><th>Type</th><th>Date</th><th>Priority</th><th>Authenticity</th></tr></thead><tbody>${recent.map(i => { const [t, c] = authLabel(i); return `<tr data-open="${esc(i.id)}" class="click"><td><b>${esc(i.media?.name || 'Text analysis')}</b><small>${esc(i.id)}</small></td><td>${esc((i.media ? MODN[i.modality || 'voice'] : 'Text'))}</td><td>${new Date(i.at).toLocaleDateString()}</td><td>${pill(PRI, i.priority)}</td><td><span class="mt-pill ${c}">${t}</span></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="empty-state">No reports yet. Analyze a recording, image or video to see it here.</p>';
  return `<div class="wrapv dash">
   <header class="mt-head"><div><h1>Call safety</h1><p class="sub">Last 7 days · ${list.length} ${dashSrc === 'live' ? 'live session' : dashSrc === 'uploaded' ? 'uploaded report' : 'report'}${list.length === 1 ? '' : 's'} saved in this browser</p></div>
    <div class="mt-actions"><div class="mt-seg" id="dash-src" role="group" aria-label="Source">${[['all', 'All'], ['uploaded', 'Uploaded'], ['live', 'Live']].map(([k, l]) => `<button data-src="${k}" class="${dashSrc === k ? 'on' : ''}">${l}</button>`).join('')}</div><button class="mt-btn icon" id="dash-refresh" aria-label="Refresh" title="Refresh">${svg('refresh', 16)}</button><button class="mt-btn icon" id="dash-export" aria-label="Export saved reports as JSON" title="Export saved reports">${svg('download', 16)}</button></div></header>
   <div class="mt-quick"><a class="mt-q" href="#/analyze/voice"><span>${svg('mic', 18)}</span><div><b>Analyze voice</b><small>Upload or record audio</small></div></a><a class="mt-q" href="#/analyze/image"><span>${svg('image', 18)}</span><div><b>Analyze image</b><small>Photos and screenshots</small></div></a><a class="mt-q" href="#/analyze/video"><span>${svg('video', 18)}</span><div><b>Analyze video</b><small>Clips and recordings</small></div></a><a class="mt-q live" href="#/live"><span>${svg('live', 18)}</span><div><b>Live monitor</b><small>Real-time speech alerts</small></div></a></div>
   <div class="mt-kpis">${kpi('users', 'Calls analyzed', list.length, delta(cur.length, prev.length, false))}${kpi('flag', 'Flagged calls', flagged(list), delta(flagged(cur), flagged(prev), true))}${kpi('bell', 'High-risk alerts', history.length, delta(curA.length, prevA.length, true))}${kpi('bot', 'AI-generated flags', ai(list), delta(ai(cur), ai(prev), true))}</div>
   <div class="mt-row r-2-1"><section class="mt-card"><div class="mt-card-h"><h2>Call volume</h2><div class="mt-seg" id="vol-range" role="group" aria-label="Range"><button class="on" data-n="7">7D</button><button data-n="30">30D</button><button data-n="90">90D</button></div></div><div class="mt-card-b" id="vol-chart">${volumeChart(list, 7)}</div></section>
    <section class="mt-card"><div class="mt-card-h"><h2>Recent activity</h2></div><div class="mt-card-b mt-scroll">${activity}</div></section></div>
   <div class="mt-row r-2-1"><section class="mt-card"><div class="mt-card-h"><h2>Most common indicators</h2></div><div class="mt-card-b">${bars}</div></section>
    <section class="mt-card"><div class="mt-card-h"><h2>Reports by priority</h2></div><div class="mt-card-b center">${donut(list)}</div></section></div>
   <div class="mt-row r-2-1"><section class="mt-card"><div class="mt-card-h"><h2>Recent reports</h2><a class="link" href="#/incidents">View all</a></div><div class="mt-card-b flush">${table}</div></section>
    <section class="mt-card"><div class="mt-card-h"><h2>Free-plan scans</h2></div><div class="mt-card-b center">${ring(scans, 50)}<p class="mt-note">Reality Defender scans in reports saved in this browser this month. The free plan allows 50 a month; scans from other browsers or deleted reports are not counted.</p></div></section></div>
   <div class="mt-row r-1-1"><section class="mt-card"><div class="mt-card-h"><h2>Live monitoring</h2><a class="link" href="#/incidents/live">All live sessions</a></div><div class="mt-card-b"><div class="mt-live-stats"><div><strong>${live.week7}</strong><span>Sessions, 7 days</span></div><div><strong>${live.alerts7}</strong><span>Live alerts, 7 days</span></div><div><strong>${live.last ? ago(live.last) : '—'}</strong><span>Last session</span></div></div>
     ${live.sessions.slice(0, 3).map(i => `<a class="mt-act" href="#/incident/${encodeURIComponent(i.id)}"><span class="mt-act-ic">${svg('live', 15)}</span><div><b>Live session · ${esc(PRI[i.priority]?.[0] || 'Not assessed')}</b><small>${fmt(i.at)}${i.media?.duration ? ' · ' + i.media.duration + ' s' : ''}</small></div></a>`).join('') || '<p class="empty-state">No live sessions saved yet. Start the monitor and save a session report.</p>'}
     <div class="row-actions" style="margin-top:12px"><a class="mt-btn primary" href="#/live">${svg('live', 15)} Start live monitor</a></div></div></section>
    <section class="mt-card"><div class="mt-card-h"><h2>Service status</h2><a class="link" href="#/settings">Settings</a></div><div class="mt-card-b" id="dash-services"><p class="sub">Checking services…</p></div></section></div>
   <div class="mt-row r-1"><section class="mt-card"><div class="mt-card-h"><h2>Alert history</h2></div><div class="mt-card-b mt-scroll">${history.slice(0, 12).map(a => `<div class="alert-history-row"><span class="pill p-high">${a.source === 'Live microphone' ? 'Live' : 'High risk'}</span><div><b>${esc((a.labels || []).join(', '))}</b><small>${fmt(a.at)} · ${esc(a.source)}${typeof a.elapsedMs === 'number' ? ' · ' + (a.elapsedMs / 1000).toFixed(1) + 's from session start' : ''}</small></div></div>`).join('') || '<p class="empty-state">Warnings appear here when high-risk requests are detected.</p>'}</div></section></div>
   ${advice()}<p class="sub">Noise, accents, code switching and recognition errors can hide or invent indicators. A low-risk result does not establish that a caller is safe.</p></div>`;
 }
 const MODN = {voice: 'Voice', image: 'Image', video: 'Video'};
 function setupDashboard() {
  const list = dashList();
  $('#dash-src')?.addEventListener('click', e => { const b = e.target.closest('[data-src]'); if (!b) return; dashSrc = b.dataset.src; try { sessionStorage.setItem('voxa:dash-src', dashSrc); } catch {} dispatchEvent(new HashChangeEvent('hashchange')); });
  $('#vol-range')?.addEventListener('click', e => { const b = e.target.closest('[data-n]'); if (!b) return; document.querySelectorAll('#vol-range button').forEach(x => x.classList.toggle('on', x === b)); $('#vol-chart').innerHTML = volumeChart(list, +b.dataset.n); });
  $('#dash-refresh')?.addEventListener('click', () => dispatchEvent(new HashChangeEvent('hashchange')));
  $('#dash-export')?.addEventListener('click', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({app: 'VOXA', exportedAt: new Date().toISOString(), incidents: list}, null, 2)], {type: 'application/json'})); a.download = 'voxa-reports.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); });
  fetch('/api/status?probe=1').then(r => { if (!r.ok) throw 0; return r.json(); }).then(d => {
   const el = $('#dash-services'); if (!el) return;
   const st = x => !x.configured ? ['Not configured', 'grey'] : !x.allowed ? ['Blocked by FREE_MODE', 'amber'] : x.health === 'ok' ? ['Ready', 'green'] : x.health === 'invalid-key' ? ['Key rejected', 'red'] : x.health === 'unreachable' ? ['Unreachable', 'red'] : x.health === 'rate-limited' ? ['Rate limited', 'amber'] : ['Configured', 'green'];
   el.innerHTML = Object.values(d.details).map(x => { const [t, c] = st(x); return `<div class="mt-svc" title="${esc(x.blockedReason || x.healthNote || x.note)}"><b>${esc(x.label)}</b><span class="mt-pill ${c}">${t}</span></div>`; }).join('') + `<div class="mt-svc"><b>FFmpeg</b><span class="mt-pill ${d.tools.ffmpeg ? 'green' : 'amber'}">${d.tools.ffmpeg ? 'Available' : 'Missing'}</span></div>`;
  }).catch(() => { const el = $('#dash-services'); if (el) el.innerHTML = '<p class="sub">The VOXA server is not reachable. Run start-voxa.cmd.</p>'; });
 }
 // ---- Meetings: analyze a consented recording and track meeting reports ----
 const PLATFORMS = ['Zoom', 'Microsoft Teams', 'Google Meet', 'Webex', 'Phone call', 'Other'];
  // ---- "Start a protected meeting" dialog ----
  function openStartDialog(trigger) {
    const ML = window.VoxaMeetingLinks; if (!ML) return;
    const saved = ML.load(), names = { meet: 'Google Meet', zoom: 'Zoom' };
    const wrap = document.createElement('div'); wrap.className = 'sm-backdrop';
    wrap.innerHTML = `<div class="sm-dialog" role="dialog" aria-modal="true" aria-labelledby="sm-title" aria-describedby="sm-sub">
      <div class="sm-head"><span class="sm-ic">${svg('video', 20)}</span><div><h2 id="sm-title">Start a protected meeting</h2><p id="sm-sub">Add your Google Meet or Zoom link. VOXA opens it in a new tab and keeps this page ready to check the recording or monitor consented audio.</p></div><button class="sm-x" type="button" aria-label="Close" data-close>&times;</button></div>
      <form class="sm-body" novalidate><label for="sm-url">Meeting URL</label>
        <div class="sm-field"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg><input id="sm-url" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="2048" placeholder="https://zoom.us/…, https://meet.google.com/…" aria-describedby="sm-msg"></div>
        <p class="sm-msg" id="sm-msg" role="alert" aria-live="polite" hidden></p>
        ${Object.keys(saved).length ? `<div class="sm-saved"><span>Saved links</span>${Object.keys(saved).map(p => `<button type="button" class="sm-chip" data-use="${p}">${names[p]}</button>`).join('')}</div>` : ''}
        <p class="sm-help">We support Google Meet and Zoom meeting links.</p>
        <label class="sm-check"><input type="checkbox" id="sm-remember" ${Object.keys(saved).length ? '' : 'checked'}> Remember this link for next time</label>
        <p class="sm-note">The meeting is added to your Meetings list in this browser. VOXA does not join the call, hear the meeting or record anyone. To check a meeting, analyze a recording that everyone agreed to, or use the live monitor on this device.</p>
        <div class="sm-actions"><button type="button" class="sm-btn cancel" data-close>Cancel</button><button type="submit" class="sm-btn go" disabled>Start meeting</button></div></form></div>`;
    document.body.appendChild(wrap);
    const input = wrap.querySelector('#sm-url'), go = wrap.querySelector('.go'), msg = wrap.querySelector('#sm-msg');
    const detect = raw => {
      if (!raw.trim()) return { ok: false, silent: true };
      for (const p of ['meet', 'zoom']) { const v = ML.validate(p, raw); if (v.ok) return v; }
      const l = raw.toLowerCase();
      if (l.includes('meet.google.com')) return ML.validate('meet', raw);
      if (l.includes('zoom.us')) return ML.validate('zoom', raw);
      return { ok: false, error: 'Enter a Google Meet or Zoom meeting link.' };
    };
    const show = (text, tone) => { msg.hidden = !text; msg.textContent = text || ''; msg.className = 'sm-msg ' + (tone || ''); };
    const refresh = () => { const v = detect(input.value); go.disabled = !v.ok; input.setAttribute('aria-invalid', !v.ok && !v.silent ? 'true' : 'false'); show(v.ok || v.silent ? (v.ok ? names[v.platform] + ' link recognized.' : '') : v.error, v.ok ? 'ok' : 'warn'); return v; };
    const close = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); document.body.classList.remove('sm-open'); trigger?.focus(); };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const f = [...wrap.querySelectorAll('button:not([disabled]),input,a[href]')].filter(el => el.offsetParent !== null);
      if (!f.length) return; const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true); document.body.classList.add('sm-open');
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    wrap.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', () => { input.value = saved[b.dataset.use].url; refresh(); input.focus(); }));
    input.addEventListener('input', refresh);
    wrap.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const v = refresh(); if (!v.ok) return;
      go.disabled = true; go.textContent = 'Checking…';
      try {
        const c = await ML.checkWithServer(v.platform, input.value);
        if (c.state === 'invalid') { show(c.error, 'warn'); return; }
        if (wrap.querySelector('#sm-remember').checked) { const sv = ML.save(v.platform, c.url); if (!sv.ok) { show(sv.error, 'err'); return; } }
        close();
        const rec = window.VoxaMeetings?.add({ platform: v.platform, url: c.url, status: 'live' });
        const tab = window.VoxaMeetings ? window.VoxaMeetings.openMeeting(c.url) : window.open(c.url, '_blank', 'noopener,noreferrer');
        if (rec) window.VoxaMeetings.track(rec.id, tab);
        try { sessionStorage.setItem('voxa:meeting-tab', 'live'); } catch {}
        toast((v.platform === 'meet' ? 'Google Meet' : 'Zoom') + ' link opened in a new tab. VOXA is not in the call. If no tab appeared, allow pop-ups.' + (c.state === 'unavailable' ? ' ' + ML.unavailableNote(c.why) : ''));
        if (rec) dispatchEvent(new HashChangeEvent('hashchange')); else showStarted(v.platform);
      } catch (err) { show(err?.message || 'The meeting could not be started. Try again.', 'err'); }
      finally { go.textContent = 'Start meeting'; if (document.body.contains(wrap)) go.disabled = !detect(input.value).ok; }
    });
    input.focus();
  }
  function showStarted(platform) {
    document.querySelector('#mtg-banner')?.remove();
    const el = document.createElement('div'); el.id = 'mtg-banner'; el.className = 'mtg-banner'; el.setAttribute('role', 'status');
    const name = platform === 'meet' ? 'Google Meet' : 'Zoom';
    el.innerHTML = `<div><b>${name} link opened in a new tab.</b><span>VOXA is not in the call and nothing is being recorded. If no tab appeared, allow pop-ups for VOXA. When the meeting ends, check it here.</span></div><div class="mtg-banner-actions"><a class="mt-btn primary" href="#/analyze/video">Analyze the recording</a><a class="mt-btn" href="#/live">Live monitor</a><button class="mt-btn" type="button" id="mtg-dismiss">Dismiss</button></div>`;
    const hero = document.querySelector('.mtg-hero'); hero?.parentNode.insertBefore(el, hero);
    el.querySelector('#mtg-dismiss').addEventListener('click', () => el.remove());
    el.scrollIntoView({ block: 'nearest' });
  }
 function meetingHero() {
  const ML = window.VoxaMeetingLinks, saved = ML ? ML.load() : {}, names = {meet: 'Google Meet', zoom: 'Zoom'}, have = Object.keys(saved);
  const chips = ['meet', 'zoom'].map(p => `<span class="md-chip ${saved[p] ? 'ok' : 'off'}"><b>${names[p]}</b> ${saved[p] ? 'Link saved' : 'Not connected'}</span>`).join('');
  return `<section class="mt-card mtg-hero"><span class="cx-tag mtg-tag">${svg('shield', 13)} Trust layer</span>
   <h1>Protect every meeting</h1>
   <p>${have.length ? 'Open your meeting from here, then check the recording afterwards or monitor consented audio on this device.' : 'Connect a Google Meet or Zoom link to open meetings from VOXA, then check recordings or monitor consented audio on this device.'} VOXA never joins your calls or records anyone.</p>
   <div class="mtg-actions"><a class="mtg-btn dark" href="#/integrations">${svg('plus', 15)} ${have.length ? 'Manage meeting links' : 'Connect a meeting link'}</a><button class="mtg-btn light" type="button" id="mtg-start">${svg('video', 15)} Start a meeting</button><button class="mtg-btn light" type="button" id="mtg-analyze">${svg('file', 15)} Analyze a recording</button></div>
   <div class="mtg-chips">${chips}</div><p class="mtg-small"><a class="link" href="#/live">Live monitor</a> · <a class="link" href="#/settings">Edit settings</a></p></section>`;
 }
 // Before anything is connected: the "Protect every meeting" page. After a link is saved or a meeting started: the dashboard.
 const meetingsConnected = () => Boolean(window.VoxaMeetings && (window.VoxaMeetings.count() > 0 || Object.keys((window.VoxaMeetingLinks?.load()) || {}).length > 0));
 function Meetings() {
  return meetingsConnected() ? `<div class="wrapv dash">${window.VoxaMeetings.render()}</div>` : `<div class="wrapv dash">${meetingHero()}</div>`;
 }
 function setupMeetings() {
  window.VoxaStartDialog = openStartDialog;
  if (meetingsConnected()) { window.VoxaMeetings.setup(); return; }
  $('#mtg-start')?.addEventListener('click', e => openStartDialog(e.currentTarget));
  $('#mtg-analyze')?.addEventListener('click', () => { location.hash = '#/analyze/video'; });
 }
 function Live() {
  return `<div class="wrapv"><header class="report-header"><div><p class="report-eyebrow">Hindi · English · mixed speech</p><h1>Live call monitor</h1><p class="sub">Monitor a consented call audible to this microphone. Device call audio is not captured automatically.</p></div></header>
   ${(() => { const l = liveStats(); return `<div class="mt-strip"><span><b>${l.week7}</b> live sessions, 7 days</span><span><b>${l.alerts7}</b> live alerts, 7 days</span><span>Last session: <b>${l.last ? ago(l.last) : '—'}</b></span><a class="link" href="#/incidents/live">View live sessions</a></div>`; })()}
   <section class="panelx"><label class="consent-line"><input type="checkbox" id="live-consent"> I have permission from everyone in this test call to transcribe and analyze it.</label><p class="sub">Audio is streamed to Deepgram. Fraud rules run on this device. VOXA does not save raw recordings. Provider retention policies apply; model-improvement opt-out is requested.</p><label class="consent-line"><input type="checkbox" id="live-voice"> Speak high-risk warnings aloud</label><div class="row-actions"><button class="btn" id="live-start">Start monitoring</button><button class="btn sec" id="live-stop" disabled>Stop microphone</button><button class="btn sec" id="live-save" disabled>Save session report</button></div><p id="live-state" class="sub" role="status">Microphone is off.</p></section>
   <div id="live-warning" class="live-warning" role="alert" aria-live="assertive" hidden></div>
   <div class="two report-signals"><section class="panelx"><h3>Live transcript</h3><p class="sub">Interim text may change. Warnings are provisional until verified.</p><div id="live-text" class="transcript-body">Start monitoring to see speech here.</div></section><section class="panelx"><h3>Current call risk</h3><div id="live-risk"><p class="sub">Waiting for speech…</p></div><h3>Session alerts</h3><div id="live-events" class="empty-state">No warnings yet.</div></section></div>${advice()}<p class="sub">Live mode assesses fraud intent from speech. Analyze a saved, consented recording separately for deepfake detection. Warnings depend on network speed and speech-recognition accuracy.</p></div>`;
 }
 function setupLive() { clean=setupVoxaLive({$,esc,store,incidents,S,PRI,pill,uid,toast}); }
 function Evaluation() {return `<div class="wrapv"><p class="report-eyebrow">Reproducible checks</p><h1>Evaluation lab</h1><p class="sub">Run labeled transcript scenarios locally. These results measure fraud-intent rules, not transcription or audio deepfake accuracy.</p><section class="panelx"><button class="btn" id="eval-run">Run scenario benchmark</button><div id="eval-result"></div></section><section class="panelx"><h3>Audio validation checklist</h3><p>Use consented human recordings only. Record language, noise and the expected fraud label. Evaluate genuine and fraudulent calls separately.</p><p>Run <code>npm run evaluate:audio -- path/to/manifest.json</code> with the documented manifest. The report includes end-to-end fraud accuracy, false-alarm rate, transcription word error rate, provider latency.</p><p class="sub">Live warning delay is measured separately during streamed tests. No human-audio accuracy or false-alarm rate is claimed until a labeled audio set is evaluated.</p><a class="link" href="#/live">Open live monitor</a></section></div>`;}
 function setupEvaluation() {
  $('#eval-run').onclick=()=>{
   const rows=VOXA_TEST_CASES.map(c=>({...c,result:voxaScamIntent(c.text,c.sector||'finance')}));
   const tp=rows.filter(c=>c.fraud&&c.result.priority==='high').length,fn=rows.filter(c=>c.fraud&&c.result.priority!=='high').length,fp=rows.filter(c=>!c.fraud&&c.result.priority==='high').length,tn=rows.filter(c=>!c.fraud&&c.result.priority!=='high').length;
   $('#eval-result').innerHTML=`<div class="report-metrics"><div><span>Accuracy at high-risk threshold</span><strong>${((tp+tn)/rows.length*100).toFixed(1)}%</strong><small>${rows.length} authored transcript fixtures</small></div><div><span>False-alarm rate</span><strong>${(fp/(fp+tn)*100).toFixed(1)}%</strong><small>${fp} of ${fp+tn} genuine fixtures</small></div><div><span>Fraud recall</span><strong>${(tp/(tp+fn)*100).toFixed(1)}%</strong><small>${tp} of ${tp+fn} fraud fixtures</small></div><div><span>Audio accuracy</span><strong>Not measured</strong><small>Requires labeled audio recordings</small></div></div><div class="tw"><table class="t"><thead><tr><th>Scenario</th><th>Language</th><th>Expected</th><th>Observed</th></tr></thead><tbody>${rows.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.language)}</td><td>${c.fraud?'Fraud':'Genuine'}</td><td>${pill(PRI,c.result.priority)}</td></tr>`).join('')}</tbody></table></div><p class="sub">Authored fixtures are small and not representative of real callers. Negation, quoted scams, background noise, unseen phrases and mixed clauses remain limitations.</p>`;
  };
 }
 return {Dashboard,setupDashboard,Meetings,setupMeetings,Live,setupLive,Evaluation,setupEvaluation,cleanup:()=>{clean();clean=()=>{};}};
};
