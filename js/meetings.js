/* Meetings dashboard. Meetings here are ones you start or schedule from VOXA (a link plus a status kept in this browser).
   VOXA is never in the call: it cannot see participants, hear meeting audio or fetch recordings. Recordings you analyze and
   live-monitor sessions are attached to a meeting, and every verdict shown comes from those real analyses. */
window.makeMeetings = function ({ $, esc, store, incidents, PRI, pill, fmt, toast }) {
  const ML = () => window.VoxaMeetingLinks;
  const KEY = u => 'voxa:meetings:' + u;
  const NAME = { meet: 'Google Meet', zoom: 'Zoom' };
  const uid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const valid = m => m && typeof m.id === 'string' && NAME[m.platform] && ['live', 'scheduled', 'ended'].includes(m.status) && ML().validate(m.platform, m.url).ok;
  const load = () => { try { const r = JSON.parse(localStorage.getItem(KEY(ML().currentUser()))); return Array.isArray(r) ? r.filter(valid) : []; } catch { return []; } };
  const persist = list => { try { localStorage.setItem(KEY(ML().currentUser()), JSON.stringify(list.slice(0, 100))); return true; } catch { toast('Browser storage is blocked or full.'); return false; } };
  const count = () => load().length;
  function add({ platform, url, title, status, scheduledFor }) {
    const v = ML().validate(platform, url); if (!v.ok) return null;
    const m = { id: uid(), platform, url: v.url, title: (title || '').trim().slice(0, 80) || NAME[platform] + ' meeting', status, createdAt: Date.now(), startedAt: status === 'live' ? Date.now() : null, scheduledFor: status === 'scheduled' ? scheduledFor : null, endedAt: null };
    return persist([m, ...load()]) ? m : null;
  }
  const patch = (id, p) => persist(load().map(m => m.id === id ? { ...m, ...p } : m));
  const drop = id => persist(load().filter(m => m.id !== id));

  /* ---------- derived, real data ---------- */
  const isLive = i => i.media?.source === 'live';
  const recordings = m => incidents().filter(i => i.meeting?.meetingId === m.id);
  const liveSessions = m => incidents().filter(i => isLive(i) && m.startedAt && i.at >= m.startedAt && (!m.endedAt || i.at <= m.endedAt + 600000));
  const HOUR = 3600000;
  const groups = list => {
    const now = Date.now();
    return {
      live: list.filter(m => m.status === 'live'),
      soon: list.filter(m => m.status === 'scheduled' && m.scheduledFor - now <= HOUR),
      scheduled: list.filter(m => m.status === 'scheduled' && m.scheduledFor - now > HOUR),
      recent: list.filter(m => m.status === 'ended')
    };
  };
  const TABS = [['live', 'Live now', 'Meetings you started from VOXA that are still open.'], ['soon', 'Starting soon', 'Scheduled meetings starting within the hour.'], ['scheduled', 'Scheduled', 'Meetings you scheduled for later.'], ['recent', 'Recently protected', 'Meetings you ended, with their analyzed recordings.']];
  const tabKey = 'voxa:meeting-tab';
  const curTab = () => { try { return sessionStorage.getItem(tabKey) || 'live'; } catch { return 'live'; } };
  const ICON = {
    pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>', box: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    shield: '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/>', link: '<path d="M7 17 17 7M9 7h8v8"/>', cam: '<rect x="3" y="6.5" width="12" height="11" rx="2.2"/><path d="m15 10.5 5.5-3.2v9.4L15 13.5"/>',
    bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16.5h6"/>', flag: '<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5"/>', mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'
  };
  const ic = (n, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
  const when = ts => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  function card(m) {
    const rec = recordings(m).length, ls = liveSessions(m).length;
    const ms = media.get(m.id), recording = ms && ms.state === 'recording';
    const badge = m.status === 'live' ? '<span class="mm-b live">Live</span><span class="mm-b link" title="VOXA is not in the call. It only opened your meeting link.">Link only</span>' + (recording ? `<span class="mm-b rec">● ${ms.engine ? 'Protecting live' : 'Recording'}</span>` : ms && ms.blob ? '<span class="mm-b done">Recording ready</span>' : '') : m.status === 'scheduled' ? '<span class="mm-b sched">Scheduled</span>' : '<span class="mm-b done">Ended</span>';
    const meta = m.status === 'scheduled' ? `${ic('cal', 14)} ${when(m.scheduledFor)}` : m.status === 'live' ? `${ic('clock', 14)} Started ${when(m.startedAt)}` : `${ic('clock', 14)} ${when(m.startedAt || m.createdAt)}${m.endedAt ? ' – ' + new Date(m.endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}`;
    const join = `<a class="mt-btn sm" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${ic('link', 14)} Join room</a>`;
    const acts = m.status === 'live'
      ? `${join}${recording ? `<button class="mt-btn sm danger" data-act="stoprec" data-id="${m.id}">■ Stop ${ms.engine ? 'protection' : 'recording'}</button>` : `<button class="mt-btn sm primary" data-act="recdev" data-id="${m.id}">${ic('shield', 14)} Protect live</button>`}<button class="mt-btn sm" data-act="monitor" data-id="${m.id}">${ic('mic', 14)} Live monitor</button><button class="mt-btn sm" data-act="addrec" data-id="${m.id}">${ic('cam', 14)} ${ms && ms.blob ? 'Playback &amp; analyze' : 'Add recording'}</button><button class="mt-btn sm" data-act="end" data-id="${m.id}">End meeting</button>`
      : m.status === 'scheduled'
        ? `${join}<button class="mt-btn sm primary" data-act="startnow" data-id="${m.id}">Start now</button><button class="mt-btn sm" data-act="delete" data-id="${m.id}">Remove</button>`
        : `<button class="mt-btn sm primary" data-act="details" data-id="${m.id}">${ic('shield', 14)} View intelligence</button><button class="mt-btn sm" data-act="addrec" data-id="${m.id}">${ms && ms.blob ? 'Playback &amp; analyze' : 'Add recording'}</button><button class="mt-btn sm" data-act="delete" data-id="${m.id}">Remove</button>`;
    return `<article class="mm-card"><span class="mm-ic ${m.platform}">${ic('cam', 22)}</span><div class="mm-main"><div class="mm-title"><h3>${esc(m.title)}</h3>${badge}</div><div class="mm-plat">${NAME[m.platform].toUpperCase()}</div>
      <div class="mm-meta"><span>${meta}</span><span>${ic('file', 14)} ${rec} recording${rec === 1 ? '' : 's'}</span><span>${ic('mic', 14)} ${ls} live session${ls === 1 ? '' : 's'}</span></div>${recording ? `<div class="mm-live" id="mm-live-${m.id}" aria-live="polite">${liveHtml(m.id)}</div>` : ''}</div>
      <div class="mm-acts">${m.status !== 'ended' ? `<button class="mt-btn sm" data-act="details" data-id="${m.id}">Report</button>` : ''}${acts}</div></article>`;
  }
  function render() {
    const list = expireOld(load()), g = groups(list), tab = curTab(), stat = (icon, n, label) => `<div class="mm-stat"><span>${ic(icon, 18)}</span><div><b>${n}</b><small>${label}</small></div></div>`;
    const cur = g[tab] || [];
    const [, , blurb] = TABS.find(t => t[0] === tab) || TABS[0];
    return `<section class="mt-card mm-top"><div class="mm-top-l"><span class="cx-tag mtg-tag">${ic('shield', 13)} Trust layer</span><h1>Meetings</h1>
        <p>Start or schedule your Google Meet and Zoom meetings from VOXA, then check recordings and monitor consented audio for each one. VOXA never joins the call or records anyone.</p>
        <div class="mtg-actions" style="justify-content:flex-start"><button class="mtg-btn dark" type="button" id="mm-start">${ic('plus', 15)} Start meeting</button><button class="mtg-btn light" type="button" id="mm-schedule">${ic('cal', 15)} Schedule</button><a class="mtg-btn light" href="#/integrations">${ic('link', 15)} Meeting links</a><a class="mtg-btn light" href="#/settings">${ic('gear', 15)} Settings</a></div></div>
      <div class="mm-top-r"><div class="mm-big"><small>MEETINGS TRACKED</small><b>${list.length}</b><span>Added in this browser</span></div><div class="mm-stats">${stat('pulse', g.live.length, 'Live right now')}${stat('clock', g.soon.length, 'Starting soon')}${stat('cal', g.scheduled.length, 'Scheduled')}${stat('box', g.recent.length, 'Recently protected')}</div></div></section>
      <div class="mm-tabs" role="tablist">${TABS.map(([k, label]) => `<button role="tab" aria-selected="${k === tab}" class="${k === tab ? 'on' : ''}" data-tab="${k}">${label} <span>${g[k].length}</span></button>`).join('')}</div>
      <section class="mt-card mm-panel"><div class="mm-panel-h"><div><h2>${TABS.find(t => t[0] === tab)[1]}</h2><p>${blurb}</p></div><span class="mm-count">${cur.length} meeting${cur.length === 1 ? '' : 's'}</span></div>
        <div class="mm-list">${cur.length ? cur.map(card).join('') : `<p class="empty-state" style="padding:22px 18px!important">${tab === 'live' ? 'No live meetings. Press <b>Start meeting</b> to open a Google Meet or Zoom link.' : tab === 'recent' ? 'Meetings you end appear here with their analyzed recordings.' : 'Nothing here yet. Press <b>Schedule</b> to add an upcoming meeting.'}</p>`}</div></section>
      <p class="md-note" style="margin-top:12px">Live means you started the meeting from VOXA. VOXA cannot see who is in a call, so results are per recording you analyze or live session you run on this device.</p>`;
  }

  /* ---------- dialogs ---------- */
  function dlg({ title, sub, chips = '', bodyHtml, wide, onMount, trigger }) {
    const w = document.createElement('div'); w.className = 'sm-backdrop';
    w.innerHTML = `<div class="sm-dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mm-dt"><div class="sm-head mm-dh"><div style="flex:1"><h2 id="mm-dt">${esc(title)}</h2><p class="mm-sub">${esc(sub)}</p></div>${chips ? `<div class="mm-chips">${chips}</div>` : ''}<button class="sm-x" type="button" aria-label="Close" data-close>&times;</button></div><div class="mm-dbody">${bodyHtml}</div></div>`;
    document.body.appendChild(w); document.body.classList.add('sm-open');
    const close = () => { document.removeEventListener('keydown', onKey, true); w.remove(); document.body.classList.remove('sm-open'); trigger?.focus?.(); };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const f = [...w.querySelectorAll('button:not([disabled]),input,a[href]')].filter(el => el.offsetParent !== null); if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    w.addEventListener('mousedown', e => { if (e.target === w) close(); });
    w.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    onMount?.(w, close); (w.querySelector('input,button.go') || w.querySelector('.sm-x')).focus();
    return close;
  }
  const verdictWord = a => !a ? 'not checked' : a.status !== 'ok' ? 'unavailable' : a.code === 'AI_GENERATED' ? 'AI-generated' : a.code === 'SUSPICIOUS' ? 'suspicious' : 'not flagged';
  const tone = w => w === 'AI-generated' ? 'red' : w === 'suspicious' ? 'amber' : w === 'not flagged' ? 'green' : 'grey';
  /* ================= Meeting report: everything analyzed for one meeting, on one page ================= */
  const RANK = { high: 3, medium: 2, low: 1, nee: 0 }, RISK_NAME = ['Not assessed', 'Low', 'Medium', 'High'];
  const CASE = { open: 'Open', investigating: 'Investigating', resolved: 'Resolved', fp: 'False positive' };
  const secOf = i => (window.VOXA_SECTORS || {})[i.sector] || { name: i.sector, thresholds: { medium: 3, high: 6 }, summary: 'scam patterns' };
  const dur = s => s ? (s >= 60 ? Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s' : Math.round(s) + ' s') : null;
  // Marks the exact phrases the rules matched, so the conversation shows where the risk is.
  function highlight(text, rules) {
    const spans = [];
    for (const r of rules || []) { const ex = (r.excerpt || '').slice(0, 300); if (ex.length < 3) continue; const at = text.indexOf(ex); if (at >= 0) spans.push([at, at + ex.length, [r]]); }
    spans.sort((a, b) => a[0] - b[0]);
    const merged = []; for (const s of spans) { const last = merged[merged.length - 1]; if (last && s[0] < last[1]) { last[1] = Math.max(last[1], s[1]); last[2].push(...s[2]); } else merged.push(s); }
    let out = '', pos = 0;
    for (const [a, b, rs] of merged) { out += esc(text.slice(pos, a)) + `<mark class="rk ${rs.some(r => r.critical) ? 'crit' : ''}" title="${esc(rs.map(r => r.label).join(' · '))}">${esc(text.slice(a, b))}</mark>`; pos = b; }
    return out + esc(text.slice(pos));
  }
  const gather = m => { const recs = recordings(m).sort((a, b) => a.at - b.at), lives = liveSessions(m).sort((a, b) => a.at - b.at); return { recs, lives, all: [...recs, ...lives] }; };
  const aiFlag = i => i.authenticity?.code === 'AI_GENERATED' || i.audioAuthenticity?.code === 'AI_GENERATED';
  function authChips(i) {
    const mod = i.modality || 'voice', audio = mod === 'voice' ? i.authenticity : i.audioAuthenticity, video = mod === 'video' ? i.authenticity : null;
    const w = [mod !== 'image' ? ['Audio', audio] : null, mod === 'video' ? ['Video', video] : null, mod === 'image' ? ['Image', i.authenticity] : null].filter(Boolean);
    return w.map(([k, a]) => `<span class="mm-tag ${tone(verdictWord(a))}" title="${esc(a?.provider ? 'Checked by ' + a.provider : a?.message || '')}">${k}: ${verdictWord(a)}</span>`).join('') + `<span class="mm-tag">Scam intent: ${esc(PRI[i.priority]?.[0] || 'not assessed')}</span>`;
  }
  function recPanel(i, n, live) {
    const pv = window.VoxaPreviews?.get(i.id), tx = i.transcript?.text || '', it = i.intent, sec = secOf(i);
    const name = live ? 'Live monitoring session' : i.liveRisk ? 'Live protection · ' + (i.media?.name || 'meeting audio') : (i.media?.name || 'Recording');
    const media = live ? '' : `<div class="mr-media">${pv ? (pv.kind === 'video' ? `<video controls src="${pv.url}"></video>` : pv.kind === 'image' ? `<img alt="Analyzed image" src="${pv.url}">` : `<audio controls src="${pv.url}"></audio>`) : `<p class="mm-empty" style="margin:0">Playback is unavailable here. VOXA does not store recordings, so playback and download work only in the tab that analyzed the file.</p>`}
      <div class="row-actions">${pv ? `<a class="mt-btn sm primary" href="${pv.url}" download="${esc(i.media?.name || 'meeting-recording')}" data-dl>${ic('file', 14)} Download recording</a>` : `<button class="mt-btn sm" type="button" disabled>Download unavailable</button>`}<a class="mt-btn sm" href="#/incident/${encodeURIComponent(i.id)}">Open full report</a></div></div>`;
    const signal = !live && pv && pv.kind !== 'image' ? `<div class="mr-signal" data-signal="${esc(i.id)}"><h4>Signal analysis</h4><p class="mm-empty" data-sig-state>Analyzing the audio…</p><canvas class="md-canvas" data-wave hidden></canvas><canvas class="md-canvas" data-spec hidden></canvas><ul class="mr-warn" data-warn></ul></div>` : '';
    const speech = tx ? `<h4>Conversation</h4><div class="mr-tx">${highlight(tx, it?.rules)}</div><p class="md-note"><mark class="rk">Highlighted</mark> phrases matched a scam-intent rule${(it?.rules || []).some(r => r.critical) ? '; <mark class="rk crit">red</mark> marks a critical request' : ''}. ${esc(i.transcript?.source === 'provided' ? 'Text provided or edited by you.' : 'Automatic transcript from ' + (i.transcript?.source || 'a speech service') + ' (' + (i.language || 'language not detected') + '). It can contain errors.')}</p>`
      : `<h4>Conversation</h4><p class="mm-empty">${esc(i.extraction?.message || 'No transcript was produced for this ' + (live ? 'session.' : 'recording.'))}</p>`;
    const graphs = it && it.status === 'ok' && window.VoxaIntentGraphs ? `<h4>Scam-intent analysis</h4>${window.VoxaIntentGraphs(it, sec, tx, i.priority)}` : '';
    return `<section class="mt-card mr-rec" data-rec="${esc(i.id)}"><div class="mt-card-h"><h2>${live ? 'Live session' : 'Recording ' + n} · ${esc(name)}</h2><span>${pill(PRI, i.priority)}</span></div><div class="mt-card-b">
      <div class="mm-tags" style="margin-top:0">${i.liveRisk ? `<span class="mm-tag ${i.liveRisk.finalState === 'critical' || i.liveRisk.finalState === 'high' ? 'red' : i.liveRisk.finalState === 'medium' ? 'amber' : i.liveRisk.finalState === 'low' ? 'green' : 'grey'}">Live risk: ${esc(i.liveRisk.finalState || (i.liveRisk.status === 'unavailable' ? 'unavailable' : 'not assessed'))}</span>${i.liveRisk.autoLeft ? '<span class="mm-tag red">VOXA left the meeting</span>' : ''}` : ''}${authChips(i)}<span class="mm-tag">${when(i.at)}</span>${i.media?.duration ? `<span class="mm-tag">${dur(i.media.duration)}</span>` : ''}</div>${media}${signal}${speech}${graphs}</div></section>`;
  }
  function report(id) {
    const m = load().find(x => x.id === id);
    if (!m) return `<div class="wrapv"><h1>Meeting not found</h1><p class="sub">It may have been removed. <a class="link" href="#/meetings">Back to meetings</a></p></div>`;
    const { recs, lives, all } = gather(m), top = all.reduce((mx, i) => Math.max(mx, RANK[i.priority] ?? 0), 0);
    const flagged = recs.filter(aiFlag).length, checked = recs.filter(i => ['ok'].includes(i.authenticity?.status) || i.audioAuthenticity?.status === 'ok').length;
    const rules = all.flatMap(i => i.intent?.status === 'ok' ? i.intent.rules : []), factors = {};
    rules.forEach(r => { const f = factors[r.label] || (factors[r.label] = { n: 0, critical: false, weight: 0 }); f.n++; f.critical ||= r.critical; f.weight = Math.max(f.weight, r.weight); });
    const fList = Object.entries(factors).sort((a, b) => (b[1].critical - a[1].critical) || b[1].weight - a[1].weight);
    const totalDur = all.reduce((n, i) => n + (i.media?.duration || 0), 0), attention = top >= 2 || flagged > 0;
    const kpi = (icon, label, value, sub) => `<div class="mt-kpi"><div class="mt-kpi-ic">${ic(icon, 20)}</div><div><span>${label}</span><strong>${value}</strong><span class="mt-delta flat">${sub}</span></div></div>`;
    const alerts = (store.get('alerts', []) || []).filter(a => all.some(i => i.id === a.incidentId));
    const events = [
      m.createdAt && m.status === 'scheduled' && m.scheduledFor ? { at: m.scheduledFor, t: 'Meeting scheduled for this time' } : null,
      m.startedAt ? { at: m.startedAt, t: 'Meeting started from VOXA (link opened)' } : null,
      ...recs.map(i => ({ at: i.at, t: 'Recording analyzed: ' + (i.media?.name || 'recording') + ' (' + (PRI[i.priority]?.[0] || 'not assessed') + ' scam-intent priority' + (aiFlag(i) ? ', media flagged as AI-generated' : '') + ')' })),
      ...lives.map(i => ({ at: i.at, t: 'Live monitoring session saved (' + (PRI[i.priority]?.[0] || 'not assessed') + ' priority)' })),
      ...recs.filter(i => i.liveRisk?.autoLeft).map(i => ({ at: i.liveRisk.autoLeft.at, t: 'VOXA left the meeting automatically: ' + i.liveRisk.autoLeft.reasons.join(', ') })),
      ...alerts.map(a => ({ at: a.at, t: 'Alert raised: ' + (a.labels || []).join(', ') })),
      m.endedAt ? { at: m.endedAt, t: 'Meeting ended' } : null
    ].filter(Boolean).sort((a, b) => a.at - b.at);
    const safe = (window.VOXA_SAFE_STEPS || []).map(s => `<li>${esc(s)}</li>`).join('');
    return `<div class="wrapv dash mr">
      <header class="mt-head"><div><a class="link" href="#/meetings">Back to meetings</a><h1 style="margin-top:6px!important">${esc(m.title)}</h1><p class="sub">${NAME[m.platform]} · ${m.status === 'ended' ? 'Ended' : m.status === 'live' ? 'Live' : 'Scheduled'} · ${when(m.startedAt || m.scheduledFor || m.createdAt)}${m.endedAt ? ' – ' + new Date(m.endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''} · Case: ${CASE[m.caseStatus] || 'Open'}</p></div>
        <div class="mt-actions no-print"><button class="mt-btn" type="button" id="mr-add">Add recording</button><button class="mt-btn" type="button" id="mr-export">Export JSON</button><button class="mt-btn primary" type="button" id="mr-print">Print report</button></div></header>
      ${attention && top >= 2 ? `<div class="live-warning" role="alert"><b>${RISK_NAME[top]}-risk request found in this meeting</b><p>Do not share OTPs, PINs or card details. Hang up and call back on an official number. For financial cyber fraud in India, call <a href="tel:1930">1930</a> or visit <a href="https://cybercrime.gov.in/" target="_blank" rel="noopener noreferrer">cybercrime.gov.in</a>.</p></div>` : ''}
      <div class="mt-kpis">${kpi('shield', 'Scam-intent risk', RISK_NAME[top], all.length ? 'Highest across ' + all.length + ' item' + (all.length === 1 ? '' : 's') : 'Nothing analyzed yet')}${kpi('bot', 'Media authenticity', flagged ? flagged + ' flagged' : checked ? 'None flagged' : 'Not assessed', checked ? 'Detector results, separate from intent' : 'No detector result available')}${kpi('flag', 'Indicators found', rules.length, fList.length + ' distinct pattern' + (fList.length === 1 ? '' : 's'))}${kpi('file', 'Analyzed', all.length, (dur(totalDur) || 'Duration unknown') + ' of audio and video')}</div>
      <div class="mt-row r-1-1"><section class="mt-card"><div class="mt-card-h"><h2>Risk factors</h2></div><div class="mt-card-b">${fList.length ? fList.map(([l, f]) => `<div class="mr-factor"><span>${esc(l)}${f.critical ? ' <em>critical</em>' : ''}</span><b>${f.n}×</b></div>`).join('') : `<p class="empty-state">${all.length ? 'No scam-intent patterns were found in the transcripts.' : 'Add a recording to assess risk factors.'}</p>`}<p class="md-note">Authenticity and scam intent are separate. A genuine voice can be used for a scam, and a synthetic voice can say something harmless.</p></div></section>
        <section class="mt-card" id="mr-case"><div class="mt-card-h"><h2>Case file</h2><label class="mr-status no-print">Status <select id="mr-status">${Object.entries(CASE).map(([k, v]) => `<option value="${k}" ${(m.caseStatus || 'open') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div><div class="mt-card-b">
          <ol class="mr-tl">${events.length ? events.map(e => `<li><time>${when(e.at)}</time><span>${esc(e.t)}</span></li>`).join('') : '<li><span>No events yet.</span></li>'}</ol>
          ${(m.notes || []).map(n => `<div class="ev"><small>${fmt(n.at)}</small>${esc(n.text)}</div>`).join('')}
          <div class="filters no-print"><input id="mr-note" aria-label="Case note" style="flex:1;min-width:180px" placeholder="Add a case note…" maxlength="500"><button class="mt-btn primary" type="button" id="mr-addnote">Add note</button></div></div></section></div>
      ${recs.length ? recs.map((i, k) => recPanel(i, k + 1, false)).join('') : `<section class="mt-card"><div class="mt-card-b"><p class="empty-state">No recording has been analyzed for this meeting yet. Add the recording to see the conversation, audio graphs and risk factors.</p><div class="row-actions"><button class="mt-btn primary" type="button" data-add2>Add recording</button></div></div></section>`}
      ${lives.map(i => recPanel(i, 0, true)).join('')}
      ${card2('Safe next steps', `<ul class="md-ul">${safe}</ul>`)}
      <div class="lim"><b>Limitations.</b> VOXA is not in the call and cannot see participants, so this report covers only the recordings and live sessions you analyzed. Speech recognition can be wrong with noise, accents and mixed languages; detectors can miss or wrongly flag media. Results are decision support, not proof.</div></div>`;
  }
  const card2 = (t, body) => `<section class="mt-card" style="margin-bottom:14px"><div class="mt-card-h"><h2>${t}</h2></div><div class="mt-card-b">${body}</div></section>`;
  function setupReport(id) {
    const m = load().find(x => x.id === id); if (!m) return;
    const redo = () => dispatchEvent(new HashChangeEvent('hashchange'));
    $('#mr-print')?.addEventListener('click', () => window.print());
    $('#mr-status')?.addEventListener('change', e => { patch(id, { caseStatus: e.target.value }); redo(); });
    const addNote = () => { const el = $('#mr-note'), text = el.value.trim(); if (!text) return; patch(id, { notes: [...(load().find(x => x.id === id).notes || []), { at: Date.now(), text }].slice(-100) }); redo(); };
    $('#mr-addnote')?.addEventListener('click', addNote); $('#mr-note')?.addEventListener('keydown', e => { if (e.key === 'Enter') addNote(); });
    const add = e => recordingDialog(load().find(x => x.id === id), { trigger: e.currentTarget });
    $('#mr-add')?.addEventListener('click', add); document.querySelector('[data-add2]')?.addEventListener('click', add);
    $('#mr-export')?.addEventListener('click', () => {
      const { recs, lives } = gather(m), a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'VOXA', exportedAt: new Date().toISOString(), meeting: m, recordings: recs, liveSessions: lives }, null, 2)], { type: 'application/json' })); a.download = 'voxa-meeting-' + slug(m.title) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    // audio forensics for each recording that is still available in this tab
    const SG = window.VoxaSignal; if (!SG) return;
    document.querySelectorAll('[data-signal]').forEach(async box => {
      const pv = window.VoxaPreviews?.get(box.dataset.signal), state = box.querySelector('[data-sig-state]'); if (!pv) return;
      try {
        const blob = await (await fetch(pv.url)).blob(), a = await SG.loadAudio(blob), s = SG.analyzeSignal(a.channels, a.sampleRate);
        state.hidden = true; const w = box.querySelector('[data-wave]'), sp = box.querySelector('[data-spec]'); w.hidden = false; sp.hidden = false;
        SG.drawWave(w, s, a.channels[0]); SG.drawSpec(sp, s);
        const warn = SG.warnings(s, a.native);
        box.querySelector('[data-warn]').innerHTML = (warn.length ? warn.map(([t, d]) => `<li><b>${esc(t)}.</b> ${esc(d)}</li>`).join('') : '<li>No audio-quality problems found, so detector results are not limited by the audio itself.</li>') + `<li class="mr-sigfacts">${(s.sr / 1000).toFixed(s.sr % 1000 ? 2 : 0)} kHz · ${s.channels} channel${s.channels === 1 ? '' : 's'} · peak ${s.peakDb.toFixed(1)} dBFS · silence ${s.silentPct.toFixed(0)}% · bandwidth ${(s.rolloff / 1000).toFixed(1)} kHz</li>`;
      } catch { state.textContent = 'Signal analysis is unavailable: the browser could not decode this file\'s audio.'; }
    });
  }

  /* ---------- opening a meeting, noticing when its tab closes ---------- */
  // Open a blank tab, then send it to the meeting. We keep our own handle to the tab, so we can tell when it is closed and,
  // for "Leave the meeting automatically on high risk", close it. Browsers allow closing only while the tab keeps its
  // opener link, so the link is kept. Only validated meet.google.com and zoom.us addresses are ever opened this way.
  function openMeeting(url) {
    if (!['meet', 'zoom'].some(p => ML().validate(p, url).ok)) return null;
    const w = window.open('', '_blank'); if (!w) return null;
    try { w.location.href = url; } catch { try { w.close(); } catch {} return null; }
    return w;
  }
  const watchers = new Map(), handles = new Map(), pendingEnded = [];
  const MAX_LIVE_MS = 12 * HOUR;
  function track(id, w) {
    if (!w) return;
    handles.set(id, w);
    clearInterval(watchers.get(id));
    watchers.set(id, setInterval(() => { let closed = true; try { closed = w.closed; } catch {} if (closed) { clearInterval(watchers.get(id)); watchers.delete(id); endMeeting(id, 'tab'); } }, 1500));
  }
  const onMeetingsPage = () => /^#\/meetings/.test(location.hash);
  const redraw = () => dispatchEvent(new HashChangeEvent('hashchange'));
  const ending = new Set(); // auto-leave closes the tab, and the tab watcher then notices: end only once
  async function endMeeting(id, how) {
    const m = load().find(x => x.id === id); if (!m || m.status === 'ended' || ending.has(id)) return;
    ending.add(id);
    try { await endMeetingNow(id, how, m); } finally { ending.delete(id); }
  }
  async function endMeetingNow(id, how, m) {
    clearInterval(watchers.get(id)); watchers.delete(id);
    await finish(id, how);
    handles.delete(id);
    if (!patch(id, { status: 'ended', endedAt: Date.now() })) return;
    try { sessionStorage.setItem(tabKey, 'recent'); } catch {}
    const fresh = load().find(x => x.id === id);
    if (onMeetingsPage()) { redraw(); setTimeout(() => recordingDialog(fresh, { ended: true, how }), 150); }
    else { pendingEnded.push({ id, how }); toast(ENDED_WHY[how] ? ENDED_WHY[how] + ' "' + m.title + '" has ended. Open Meetings to see the report.' : '"' + m.title + '" was marked ended. Open Meetings to add the recording.'); }
  }
  const ENDED_WHY = { tab: 'The meeting tab was closed.', share: 'Sharing of the meeting tab stopped.', silence: 'The meeting audio went silent.', risk: 'VOXA left the meeting because of high scam risk.' };
  function expireOld(list) {
    let changed = false; const now = Date.now();
    const out = list.map(m => { if (m.status === 'live' && m.startedAt && now - m.startedAt > MAX_LIVE_MS && !watchers.has(m.id)) { changed = true; return { ...m, status: 'ended', endedAt: m.startedAt + MAX_LIVE_MS }; } return m; });
    if (changed) persist(out); return out;
  }

  /* ---------- recordings held in this tab only (never stored by VOXA) ---------- */
  const media = new Map(); // meetingId -> { state:'recording'|'ready', blob, name, kind, source, mode, rec, stream, chunks, size }
  const LIMIT_MB = { voice: 20, video: 32 };
  const pickMime = mode => (mode === 'audio' ? ['audio/webm;codecs=opus', 'audio/webm'] : ['video/webm;codecs=vp8,opus', 'video/webm']).find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'meeting';
  /* ---------- live protection: the meeting tab's audio, transcribed and checked while the meeting runs ---------- */
  // The browser's share prompt gives VOXA the meeting tab's audio, which is what the other participants say (Meet and
  // Zoom do not play your own microphone back into the tab). It is (1) recorded in this tab for playback and the
  // spectrogram, (2) streamed to /api/live for transcription and scored by VoxaCallRisk, and (3) level-metered so VOXA
  // notices when the meeting has ended. Nothing is stored by the server.
  const SILENT_DB = -55, SILENT_S = 60, END_COUNTDOWN = 10, RANKS = { low: 1, medium: 2, high: 3, critical: 4 };
  const LIVE_LABEL = { off: 'Not analyzing', pending: 'Listening', low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical', unavailable: 'Analysis unavailable' };
  const LIVE_CLS = { off: 'na', pending: 'na', low: 'ok', medium: 'warn', high: 'bad', critical: 'crit', unavailable: 'na' };
  const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  function stopRecording(id) { return finish(id, 'manual'); }
  function finish(id, why) {
    const s = media.get(id);
    if (!s || s.state !== 'recording') return Promise.resolve();
    if (s.finishing) return s.finishing;
    s.finishing = (async () => {
      clearInterval(s.tick); clearTimeout(s.retryTimer); cancelCountdown(s);
      try { if (s.liveRec?.state === 'recording') s.liveRec.stop(); } catch {}
      if (s.live) { s.live.onclose = s.live.onerror = s.live.onmessage = null; try { if (s.live.readyState === 1) s.live.send(JSON.stringify({ type: 'stop' })); s.live.close(); } catch {} }
      if (s.rec.state !== 'inactive') await new Promise(r => { s.onRecStop = r; try { s.rec.stop(); } catch { r(); } setTimeout(r, 4000); });
      s.stream.getTracks().forEach(t => t.stop());
      try { s.ac?.close(); } catch {}
      s.state = s.blob?.size ? 'ready' : 'empty'; s.endedBy = why;
      const m = load().find(x => x.id === id);
      if (s.engine && m) { const rid = saveLiveReport(m, s); if (rid) patch(id, { liveReportId: rid }); }
      if (!s.blob?.size) media.delete(id);
      if (onMeetingsPage()) redraw();
    })();
    return s.finishing;
  }
  async function startRecording(m, mode, opts = {}) {
    if (!window.isSecureContext) { toast('Capturing a meeting needs a secure page. Open VOXA with https:// or on localhost.'); return false; }
    if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) { toast('This browser cannot capture a tab. Use a recent Chrome or Edge, or add a recording file instead.'); return false; }
    let stream;
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'include', preferCurrentTab: false }); }
    catch (e) { toast(e?.name === 'NotAllowedError' ? 'Nothing was shared. Choose the meeting tab in the browser prompt.' : 'Capture could not start: ' + (e?.message || 'unknown error')); return false; }
    const audio = stream.getAudioTracks();
    if (!audio.length) { stream.getTracks().forEach(t => t.stop()); toast('No audio was shared. In the browser prompt, choose the meeting TAB (not a window) and switch on "Also share tab audio".'); return false; }
    const audioOnly = new MediaStream(audio), src = mode === 'audio' ? audioOnly : stream, mime = pickMime(mode);
    let rec; try { rec = new MediaRecorder(src, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 64000, videoBitsPerSecond: 500000 }); } catch { stream.getTracks().forEach(t => t.stop()); toast('Recording could not start in this browser.'); return false; }
    const s = { state: 'recording', mode, rec, stream, chunks: [], size: 0, kind: mode === 'audio' ? 'voice' : 'video', source: 'device', startedAt: Date.now(), opts };
    media.set(m.id, s);
    rec.ondataavailable = e => {
      if (!e.data.size) return; s.chunks.push(e.data); s.size += e.data.size;
      if (s.size > (LIMIT_MB[s.kind] - 1) * 1048576 && rec.state === 'recording') { s.recFull = true; toast('The recording reached the ' + LIMIT_MB[s.kind] + ' MB limit and stopped.' + (s.engine ? ' Live analysis continues.' : '')); rec.stop(); }
    };
    rec.onstop = () => {
      s.blob = new Blob(s.chunks, { type: (mime || (mode === 'audio' ? 'audio/webm' : 'video/webm')).split(';')[0] }); s.chunks = [];
      s.name = 'meeting-' + slug(m.title) + '-' + new Date(s.startedAt).toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.webm';
      s.onRecStop?.();
      if (!s.engine && !s.opts.autoStop && !s.finishing) finish(m.id, 'limit'); // a plain recording ends with its file
    };
    // The shared tab was closed, or sharing was stopped from the browser bar: the meeting is over for VOXA.
    const shareEnded = () => { if (s.state !== 'recording' || s.finishing) return; opts.autoStop ? endMeeting(m.id, 'share') : finish(m.id, 'share'); };
    stream.getTracks().forEach(t => t.addEventListener('ended', shareEnded));
    rec.start(1000);
    if (opts.live) startLive(m, s, audioOnly);
    if (opts.autoStop) startMeter(s, audioOnly);
    s.tick = setInterval(() => tick(m.id), 1000);
    toast(opts.live ? 'VOXA is protecting this meeting. Tell everyone it is being analyzed.' : 'Recording started on this device. Tell everyone in the meeting.'); redraw(); return true;
  }
  function startLive(m, s, audioOnly) {
    const sec = store.get('sector', 'personal'); s.sector = (window.VOXA_SECTORS || {})[sec] ? sec : 'personal';
    s.engine = VoxaCallRisk.create({ autoEnd: { enabled: Boolean(s.opts.autoLeave) } }, s.sector);
    s.retries = 0;
    // One transcription stream at a time. Streams end after the server's 10-minute cap or a network drop; VOXA then
    // reconnects and keeps the same risk history. While disconnected the state is "Analysis unavailable".
    const connect = () => {
      if (s.finishing || s.state !== 'recording') return;
      let ws, reason = 'Live transcription disconnected.';
      try { ws = s.live = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/live', window.VoxaAuth?.wsProtocols?.()); }
      catch { s.engine.setAvailable(false, 'Live transcription could not start.'); return retry(); }
      ws.onmessage = ev => {
        let d; try { d = JSON.parse(ev.data); } catch { return; }
        if (d.type === 'ready') {
          s.retries = 0; s.engine.setAvailable(true); s.engine.heartbeat();
          const lm = MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
          try { s.liveRec = new MediaRecorder(audioOnly, lm ? { mimeType: lm } : undefined); } catch { reason = 'This browser cannot stream the meeting audio for analysis.'; return ws.close(); }
          // Bytes in order: sending MediaRecorder Blobs directly can fail in Chrome ("Failed to load Blob") and drop the socket.
          let q = Promise.resolve();
          s.liveRec.ondataavailable = e => { if (!e.data.size) return; const b = e.data; q = q.then(() => b.arrayBuffer()).then(buf => { if (ws.readyState === 1) ws.send(buf); }).catch(() => {}); };
          s.liveRec.start(250);
        } else if (d.type === 'transcript') { s.engine.add({ text: d.text, final: d.final, confidence: d.confidence, t: (Date.now() - s.startedAt) / 1000 }); s.interim = d.final ? '' : d.text; }
        else if (d.type === 'error') reason = d.message || reason;
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        try { if (s.liveRec?.state === 'recording') s.liveRec.stop(); } catch {}
        if (s.finishing || s.live !== ws) return;
        s.engine.setAvailable(false, reason + ' Reconnecting…'); s.interim = '';
        retry();
      };
    };
    const retry = () => { if (s.finishing) return; if (++s.retries > 20) return s.engine.setAvailable(false, 'Live transcription is unavailable (the service may be off, busy or not configured).'); clearTimeout(s.retryTimer); s.retryTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(s.retries, 5))); };
    connect();
  }
  function startMeter(s, audioOnly) {
    try {
      s.ac = new AudioContext(); const an = s.ac.createAnalyser(), mute = s.ac.createGain(); an.fftSize = 2048; mute.gain.value = 0;
      s.ac.createMediaStreamSource(audioOnly).connect(an); an.connect(mute); mute.connect(s.ac.destination); // silent sink keeps the graph running
      s.an = an; s.buf = new Float32Array(an.fftSize); s.ac.resume?.();
    } catch { s.an = null; }
  }
  function levelDb(s) { if (!s.an) return null; s.an.getFloatTimeDomainData(s.buf); let sum = 0; for (const v of s.buf) sum += v * v; return 10 * Math.log10(sum / s.buf.length + 1e-12); }
  function tick(id) {
    const s = media.get(id); if (!s || s.state !== 'recording' || s.finishing) return;
    const now = Date.now(), m = load().find(x => x.id === id);
    if (s.opts.autoStop) {
      const db = levelDb(s);
      if (db !== null) {
        if (db > SILENT_DB) { s.heard = true; s.quietSince = null; if (s.countdown?.kind === 'silence') cancelCountdown(s); }
        else if (s.heard) { s.quietSince ??= now; if (!s.countdown && (now - s.quietSince) / 1000 >= SILENT_S) startCountdown(id, s, 'silence'); }
      }
    }
    if (s.engine) {
      const r = s.eval = s.engine.evaluate(now), canLeave = s.opts.autoLeave && handleOpen(id);
      if (canLeave && r.status === 'ok' && r.autoEnd.eligible && !s.countdown) startCountdown(id, s, 'risk');
      if (s.countdown?.kind === 'risk' && !(r.status === 'ok' && r.autoEnd.eligible)) cancelCountdown(s);
      if (r.status === 'ok' && RANKS[r.state] >= 3 && !s.alerted) { s.alerted = true; if (!onMeetingsPage()) toast(`${LIVE_LABEL[r.state]} scam risk in "${m?.title || 'your meeting'}". Open Meetings to see why.`); }
    }
    paintLive(id);
  }
  function startCountdown(id, s, kind) {
    s.countdown = { kind, left: kind === 'risk' ? (s.eval?.autoEnd?.countdownSeconds || 5) : END_COUNTDOWN };
    s.countdown.timer = setInterval(() => {
      if (!s.countdown) return;
      if (--s.countdown.left > 0) return paintLive(id);
      const k = s.countdown.kind; cancelCountdown(s);
      if (k === 'silence') endMeeting(id, 'silence');
      else { const r = s.engine.evaluate(); if (r.status === 'ok' && r.autoEnd.eligible && handleOpen(id)) leaveMeeting(id, r); }
    }, 1000);
    paintLive(id);
  }
  function cancelCountdown(s) { if (!s?.countdown) return; clearInterval(s.countdown.timer); s.countdown = null; }
  function keep(id) {
    const s = media.get(id); if (!s?.countdown) return;
    if (s.countdown.kind === 'risk') { s.engine.cancelAutoEnd(); toast('You stayed in the meeting. Auto-leave is off for the rest of it.'); }
    else s.quietSince = Date.now();
    cancelCountdown(s); paintLive(id);
  }
  const handleOpen = id => { const w = handles.get(id); try { return Boolean(w && !w.closed); } catch { return false; } };
  // VOXA opened the meeting tab itself, so it may close it. Closing the tab makes you leave the call; VOXA cannot end
  // the meeting for others, and cannot touch a meeting tab it did not open.
  function leaveMeeting(id, r) {
    const s = media.get(id); if (!s) return;
    s.autoLeft = { reasons: r.autoEnd.reasons, state: r.state, at: Date.now() };
    try { handles.get(id)?.close(); } catch {}
    endMeeting(id, 'risk');
  }
  function liveHtml(id) {
    const s = media.get(id); if (!s || s.state !== 'recording') return '';
    const r = s.eval, key = !s.engine ? 'off' : r?.status === 'unavailable' ? 'unavailable' : r?.status === 'ok' ? r.state : 'pending';
    const t = (Date.now() - s.startedAt) / 1000, quiet = s.quietSince ? Math.floor((Date.now() - s.quietSince) / 1000) : 0, cd = s.countdown;
    const banner = cd ? (cd.kind === 'risk'
      ? `<div class="pc-warn pc-count" role="alert"><b>Leaving the meeting in ${cd.left} s</b><p>Reason: ${esc((s.eval?.autoEnd?.reasons || []).join(', '))}. This is decision support, not proof.</p><button class="mt-btn sm" type="button" data-act="keep" data-id="${id}">Stay in the meeting</button></div>`
      : `<div class="pc-warn" role="alert"><b>No meeting audio for ${SILENT_S} s</b><p>The meeting seems to have ended. VOXA will stop and prepare the report in ${cd.left} s.</p><button class="mt-btn sm" type="button" data-act="keep" data-id="${id}">Keep listening</button></div>`)
      : key === 'unavailable' ? `<div class="pc-warn" role="alert"><b>Analysis unavailable</b><p>${esc(r.reason || '')} The meeting is not being judged${s.opts.autoLeave ? ', and VOXA will not leave it automatically' : ''}. The recording continues.</p></div>`
      : r?.status === 'ok' && RANKS[r.state] >= 3 ? `<div class="pc-warn" role="alert"><b>${LIVE_LABEL[r.state]} risk</b><p>${esc(r.evidence.map(e => e.label).join(', '))}. Do not share OTPs, PINs or card details, and do not send money.${s.opts.autoLeave && !handleOpen(id) ? ' VOXA cannot leave this meeting for you because it did not open the meeting tab. Leave it yourself.' : ''}</p></div>` : '';
    const ev = (r?.evidence || []).slice(0, 3).map(e => `<li><b>${esc(e.label)}</b> <small>${e.t !== null ? 'at ' + mmss(e.t) : ''}${typeof e.confidence === 'number' ? ' · ' + Math.round(e.confidence * 100) + '%' : ''}</small> “${esc(e.excerpt.slice(0, 120))}”</li>`).join('');
    const last = s.engine ? (s.interim || s.engine.transcript().split('. ').slice(-1)[0] || '') : '';
    const facts = [`<span class="pc-chip ${LIVE_CLS[key]}">${LIVE_LABEL[key]}</span>`, `<span>${mmss(t)}</span>`];
    if (s.engine && r?.status === 'ok') { facts.push(`<span>Score ${r.score}</span>`); if (typeof r.confidence === 'number') facts.push(`<span>${Math.round(r.confidence * 100)}% recognition</span>`); }
    if (s.opts.autoStop) facts.push(`<span>${quiet >= 10 ? 'Quiet for ' + quiet + ' s' : s.heard ? 'Hearing the meeting' : 'Waiting for meeting audio'}</span>`);
    if (s.opts.autoLeave) facts.push(`<span>${handleOpen(id) ? 'Auto-leave on' : 'Auto-leave unavailable'}</span>`);
    if (s.recFull) facts.push('<span>Recording full</span>');
    return `${banner}<div class="mm-live-row">${facts.join('')}</div>${ev ? `<ul class="mm-live-ev">${ev}</ul>` : ''}${last ? `<p class="mm-live-tx">${s.interim ? '<span class="pc-interim">' + esc(last.slice(-200)) + '</span>' : esc(last.slice(-200))}</p>` : ''}`;
  }
  const paintLive = id => { const el = document.getElementById('mm-live-' + id); if (el) el.innerHTML = liveHtml(id); };
  function saveLiveReport(m, s) {
    const text = s.engine.transcript(), ev = s.engine.evaluate(), sector = s.sector;
    const intent = text ? voxaScamIntent(text, sector) : { status: 'insufficient', priority: 'nee', score: 0, rules: [], words: 0 };
    const inc = {
      id: 'INC-' + Date.now().toString(36).toUpperCase().slice(-6) + Math.random().toString(36).slice(2, 4).toUpperCase(), at: s.startedAt,
      modality: s.kind, sector, policyVersion: (window.VOXA_SECTORS || {})[sector]?.version, reportType: 'scam_analysis', tags: ['meeting', 'live-protection'],
      priority: intent.priority, intent, transcript: text ? { text, source: 'deepgram' } : null,
      media: { name: s.name || 'meeting-' + slug(m.title) + '.webm', source: 'meeting', mime: s.blob?.type || null, duration: Math.round((Date.now() - s.startedAt) / 1000) },
      status: 'open', notes: [],
      authenticity: { status: 'unavailable', code: 'NOT_CHECKED', message: 'Live protection checks what is said. Use "Playback & analyze" on the meeting to check whether the voices are AI-generated.' },
      meeting: { title: m.title, platform: NAME[m.platform], meetingId: m.id },
      extraction: text ? null : { status: 'unavailable', message: ev.status === 'unavailable' ? ev.reason : 'No speech was transcribed from the meeting audio.' },
      liveRisk: { status: ev.status, finalState: ev.status === 'ok' ? ev.state : null, evidence: ev.evidence.map(e => ({ id: e.id, label: e.label, t: e.t, confidence: e.confidence })), autoLeft: s.autoLeft || null, endedBy: s.endedBy },
      language: null, state: intent.status === 'ok' ? 'partial' : 'insufficient', limitations: window.VOXA_LIMITS, persist: false, expiresAt: Date.now() + 86400000, consentedAt: s.startedAt
    };
    if (!store.set('incidents', [inc, ...incidents()])) return null;
    if (s.blob?.size) window.VoxaPreviews?.set(inc.id, { url: URL.createObjectURL(s.blob), kind: s.kind });
    return inc.id;
  }
  const playerHtml = s => s.kind === 'video' ? `<video controls src="${URL.createObjectURL(s.blob)}"></video>` : `<audio controls src="${URL.createObjectURL(s.blob)}"></audio>`;
  const mb = n => (n / 1048576).toFixed(2) + ' MB';
  function handoff(m, s) {
    window.__voxaPending = { blob: s.blob, name: s.name, kind: s.kind };
    try { sessionStorage.setItem('voxa:meeting', JSON.stringify({ title: m.title, platform: NAME[m.platform], meetingId: m.id })); } catch { return toast('Browser storage is blocked.'); }
    location.hash = '#/analyze/' + s.kind;
  }
  // A file is only accepted if the browser can actually decode it.
  function playable(file, kind) {
    return new Promise(res => {
      const el = document.createElement(kind === 'video' ? 'video' : 'audio'), url = URL.createObjectURL(file); let done = false;
      const fin = ok => { if (done) return; done = true; URL.revokeObjectURL(url); res(ok); };
      el.preload = 'metadata'; el.onloadedmetadata = () => fin(true); el.onerror = () => fin(false); setTimeout(() => fin(false), 6000); el.src = url;
    });
  }
  function recordingDialog(m, opts = {}) {
    if (!m) return;
    const s = media.get(m.id), have = s && s.blob;
    const rep = m.liveReportId && incidents().find(i => i.id === m.liveReportId), lr = rep?.liveRisk;
    const body = `${opts.ended ? `<p class="mm-lead">${ENDED_WHY[opts.how] || 'This meeting is marked as ended.'} ${rep ? '' : 'Google Meet and Zoom do not give VOXA the recording, so add it here to play it back and analyze it.'}</p>` : ''}
      ${rep ? `<div class="mm-rep ${lr?.autoLeft ? 'risk' : ''}"><b>${lr?.autoLeft ? 'VOXA left the meeting: ' + esc(lr.autoLeft.reasons.join(', ')) : 'Live protection report ready'}</b><p>Scam-intent risk: ${esc(PRI[rep.priority]?.[0] || 'not assessed')}${lr?.finalState ? ' · live state ' + esc(lr.finalState) : lr?.status === 'unavailable' ? ' · live analysis was unavailable' : ''} · ${(rep.intent?.rules || []).length} indicator${(rep.intent?.rules || []).length === 1 ? '' : 's'}</p><button class="mt-btn sm primary" type="button" id="rd-report">View meeting report</button></div>` : ''}
      ${have ? `<div class="mm-rec"><div class="mm-rec-h"><span class="mm-av">${ic(s.kind === 'video' ? 'cam' : 'mic', 18)}</span><div><b>${esc(s.name)}</b><small>${s.source === 'device' ? 'RECORDED ON THIS DEVICE' : 'FILE YOU ADDED'} · ${s.kind === 'video' ? 'VIDEO' : 'AUDIO'} · ${mb(s.blob.size)}</small></div></div><div class="mm-player">${playerHtml(s)}</div>
        <div class="mm-rec-f"><button class="mt-btn sm${rep ? '' : ' primary'}" type="button" id="rd-analyze">${rep ? 'Also check voices for AI generation' : 'Analyze this recording'}</button><button class="mt-btn sm" type="button" id="rd-replace">Use a different file</button></div></div>`
      : `<label class="an-drop md-drop" for="rd-file"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0-4 4m4-4 4 4M5 20h14"/></svg><b>Add the meeting recording</b><small>mp4, webm, mov, mp3, wav, m4a · video up to 32 MB, audio up to 20 MB</small><input id="rd-file" type="file" accept="video/*,audio/*,.mp4,.webm,.mov,.mp3,.wav,.m4a,.ogg,.flac" hidden></label><p class="mm-hint" id="rd-msg" role="alert" hidden></p>`}
      ${!have && m.status === 'live' ? `<p class="mm-hint">Or record this meeting from this device while it runs: use <b>Record on this device</b> on the meeting card.</p>` : ''}
      <p class="md-note">Only analyze recordings that everyone in the meeting agreed to. VOXA does not store the file; playback works in this tab only.</p><div class="mm-dfoot"><span style="flex:1"></span><button class="sm-btn cancel" type="button" data-close>${have ? 'Close' : 'Not now'}</button></div>`;
    dlg({ title: opts.ended ? 'Meeting ended' : 'Add a recording', sub: m.title.toUpperCase(), wide: true, bodyHtml: body, trigger: opts.trigger,
      onMount: (w, close) => {
        const msg = w.querySelector('#rd-msg'), say = t => { if (msg) { msg.hidden = !t; msg.textContent = t || ''; } };
        const take = async file => {
          if (!file) return;
          const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'voice' : '';
          if (!kind) return say('That is not an audio or video file.');
          if (file.size > LIMIT_MB[kind] * 1048576) return say('That ' + (kind === 'video' ? 'video' : 'audio') + ' file is over the ' + LIMIT_MB[kind] + ' MB analysis limit.');
          if (!file.size) return say('That file is empty.');
          say('Checking the file…');
          if (!(await playable(file, kind))) return say('That file could not be played. It may be corrupted or use a format the browser cannot read.');
          media.set(m.id, { state: 'ready', blob: file, name: file.name, kind, source: 'file' }); close(); recordingDialog(m, { ...opts, reopened: true });
        };
        const input = w.querySelector('#rd-file'), dz = w.querySelector('.md-drop');
        input?.addEventListener('change', () => take(input.files[0]));
        if (dz) { ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); })); ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); })); dz.addEventListener('drop', e => take(e.dataTransfer.files[0])); }
        w.querySelector('#rd-replace')?.addEventListener('click', () => { media.delete(m.id); close(); recordingDialog(m, opts); });
        w.querySelector('#rd-analyze')?.addEventListener('click', () => { close(); handoff(m, media.get(m.id)); });
        w.querySelector('#rd-report')?.addEventListener('click', () => { close(); location.hash = '#/meeting/' + m.id; });
      } });
  }
  function recordDeviceDialog(m, trigger) {
    const canLeave = handleOpen(m.id);
    dlg({ title: 'Protect this meeting live', sub: m.title.toUpperCase(), trigger, wide: true,
      bodyHtml: `<p class="mm-lead">VOXA listens to the meeting tab's audio (what the other people say), transcribes it live and checks it for scam patterns, the same way as Protected call. It keeps a recording in this tab for the report's playback and spectrogram. Nothing starts until you choose the tab in your browser's prompt.</p>
        <ol class="mm-steps"><li>Choose the options below.</li><li>In the browser prompt, pick the <b>${NAME[m.platform]} tab</b> and switch on <b>Also share tab audio</b>.</li><li>Keep talking in ${NAME[m.platform]} as usual. When the meeting ends, VOXA stops and the report opens.</li></ol>
        <form id="rd-form">
        <label class="mm-opt"><input type="checkbox" id="rd-live" checked> <span><b>Analyze live for scams</b><small>Live risk (Low to Critical), evidence with timestamps and recognition confidence, while the meeting runs.</small></span></label>
        <label class="mm-opt"><input type="checkbox" id="rd-auto" checked> <span><b>Stop automatically when the meeting ends</b><small>When the meeting tab closes, sharing stops, or no meeting audio is heard for ${SILENT_S} s (with a ${END_COUNTDOWN}-second warning you can cancel).</small></span></label>
        <label class="mm-opt ${canLeave ? '' : 'off'}"><input type="checkbox" id="rd-leave" ${canLeave ? '' : 'disabled'}> <span><b>Leave the meeting automatically on high risk</b><small>${canLeave ? 'Off by default. After repeated, confident scam evidence and a 5-second countdown, VOXA closes the meeting tab it opened, so you leave the call. It cannot end the meeting for others. Never acts when analysis is unavailable.' : 'Available only when this meeting was opened from VOXA in this browser tab (use Start meeting or Start now). VOXA cannot close a tab it did not open.'}</small></span></label>
        <div class="mm-mode"><label class="mm-opt"><input type="radio" name="rm" value="audio" checked> <span><b>Keep an audio recording (recommended)</b><small>About 40 minutes fit the 20 MB analysis limit. Live analysis continues after that.</small></span></label><label class="mm-opt"><input type="radio" name="rm" value="video"> <span><b>Keep audio and video</b><small>The recording stops at 32 MB (about 6 minutes); live analysis continues.</small></span></label></div>
        <label class="sm-check"><input type="checkbox" id="rd-consent"> Everyone in this meeting knows VOXA is analyzing it and has agreed.</label>
        <p class="md-note">Audio is sent to the speech-to-text service only while live analysis runs and is not stored. The recording stays in this browser tab.</p><div class="sm-actions"><button type="button" class="sm-btn cancel" data-close>Cancel</button><button type="submit" class="sm-btn go" disabled>Choose the meeting tab</button></div></form>`,
      onMount: (w, close) => {
        const go = w.querySelector('.go'), cb = w.querySelector('#rd-consent'); cb.addEventListener('change', () => { go.disabled = !cb.checked; });
        w.querySelector('#rd-live').addEventListener('change', e => { const l = w.querySelector('#rd-leave'); if (!e.target.checked) { l.checked = false; l.disabled = true; } else l.disabled = !canLeave; });
        w.querySelector('#rd-form').addEventListener('submit', async e => {
          e.preventDefault(); if (!cb.checked) return;
          const mode = w.querySelector('input[name=rm]:checked').value, opts = { live: w.querySelector('#rd-live').checked, autoStop: w.querySelector('#rd-auto').checked, autoLeave: w.querySelector('#rd-leave').checked };
          close(); await startRecording(m, mode, opts);
        });
      } });
  }
  function startAnalyze(m) {
    try { sessionStorage.setItem('voxa:meeting', JSON.stringify({ title: m.title, platform: NAME[m.platform], meetingId: m.id })); } catch { return toast('Browser storage is blocked.'); }
    location.hash = '#/analyze/video';
  }
  function scheduleDialog(trigger) {
    const pad = n => String(n).padStart(2, '0'), d = new Date(Date.now() + HOUR), def = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
    dlg({ title: 'Schedule a meeting', sub: 'Add an upcoming Google Meet or Zoom meeting. VOXA only lists it and opens the link when you ask; it does not remind, join or record.', trigger,
      bodyHtml: `<form class="mt-form" id="mm-sf" novalidate style="max-width:none"><label>Meeting title <input id="mm-st" maxlength="80" placeholder="e.g. Vendor call" autocomplete="off"></label><label>Meeting URL <input id="mm-su" inputmode="url" autocomplete="off" spellcheck="false" maxlength="2048" placeholder="https://zoom.us/…, https://meet.google.com/…"></label><label>Date and time <input id="mm-sd" type="datetime-local" value="${def}"></label><p class="sm-msg" id="mm-sm" role="alert" aria-live="polite" hidden></p><div class="sm-actions"><button type="button" class="sm-btn cancel" data-close>Cancel</button><button type="submit" class="sm-btn go">Schedule meeting</button></div></form>`,
      onMount: (w, close) => {
        const msg = w.querySelector('#mm-sm'), say = (t, c) => { msg.hidden = !t; msg.textContent = t || ''; msg.className = 'sm-msg ' + (c || 'warn'); };
        w.querySelector('#mm-sf').addEventListener('submit', async e => {
          e.preventDefault();
          const raw = w.querySelector('#mm-su').value, when = new Date(w.querySelector('#mm-sd').value).getTime();
          const v = ['meet', 'zoom'].map(p => ML().validate(p, raw)).find(x => x.ok);
          if (!v) { const l = raw.toLowerCase(); return say(l.includes('meet.google.com') ? ML().validate('meet', raw).error : l.includes('zoom.us') ? ML().validate('zoom', raw).error : 'Enter a Google Meet or Zoom meeting link.'); }
          if (!Number.isFinite(when)) return say('Choose a date and time.');
          if (when < Date.now() - 60000) return say('Choose a time in the future.');
          const btn = w.querySelector('.go'); btn.disabled = true;
          try {
            const c = await ML().checkWithServer(v.platform, raw);
            if (c.state === 'invalid') return say(c.error);
            if (!add({ platform: v.platform, url: c.url, title: w.querySelector('#mm-st').value, status: 'scheduled', scheduledFor: when })) return say('The meeting could not be saved.', 'err');
            close(); try { sessionStorage.setItem(tabKey, when - Date.now() <= HOUR ? 'soon' : 'scheduled'); } catch {} toast('Meeting scheduled.' + (c.state === 'unavailable' ? ' ' + ML().unavailableNote(c.why) : '')); dispatchEvent(new HashChangeEvent('hashchange'));
          } catch (err) { say(err?.message || 'The meeting could not be scheduled. Try again.', 'err'); } finally { btn.disabled = false; }
        });
      } });
  }

  let onViewClick = () => {}; // one delegated handler; replaced (never stacked) each time the page renders
  function setup() {
    if (pendingEnded.length) { const p = pendingEnded.shift(); setTimeout(() => recordingDialog(load().find(x => x.id === p.id), { ended: true, how: p.how }), 200); }
    $('#mm-start')?.addEventListener('click', e => window.VoxaStartDialog?.(e.currentTarget));
    $('#mm-schedule')?.addEventListener('click', e => scheduleDialog(e.currentTarget));
    document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { try { sessionStorage.setItem(tabKey, b.dataset.tab); } catch {} dispatchEvent(new HashChangeEvent('hashchange')); }));
    const prev = onViewClick;
    onViewClick = e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const m = load().find(x => x.id === b.dataset.id); if (!m) return;
      const act = b.dataset.act, redraw = () => dispatchEvent(new HashChangeEvent('hashchange'));
      if (act === 'details') location.hash = '#/meeting/' + m.id;
      else if (act === 'monitor') location.hash = '#/live';
      else if (act === 'analyze') startAnalyze(m);
      else if (act === 'end') endMeeting(m.id, 'manual');
      else if (act === 'addrec') recordingDialog(m, { ended: m.status === 'ended', trigger: b });
      else if (act === 'recdev') recordDeviceDialog(m, b);
      else if (act === 'keep') keep(m.id);
      else if (act === 'stoprec') stopRecording(m.id).then(() => { redraw(); setTimeout(() => recordingDialog(load().find(x => x.id === m.id), { trigger: null }), 150); });
      else if (act === 'liverep') location.hash = '#/meeting/' + m.id;
      else if (act === 'startnow') { if (patch(m.id, { status: 'live', startedAt: Date.now(), scheduledFor: null })) { track(m.id, openMeeting(m.url)); try { sessionStorage.setItem(tabKey, 'live'); } catch {} redraw(); } }
      else if (act === 'delete') { if (b.dataset.armed) { drop(m.id); redraw(); } else { b.dataset.armed = '1'; b.textContent = 'Confirm remove'; setTimeout(() => { if (b.isConnected) { b.textContent = 'Remove'; delete b.dataset.armed; } }, 3500); } }
    };
    $('#view').removeEventListener('click', prev); $('#view').addEventListener('click', onViewClick);
  }
  return { add, count, render, setup, load, openMeeting, track, report, setupReport, get: id => load().find(x => x.id === id) };
};
