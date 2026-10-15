/* Server-side report history. When the server has a database and you are signed in:
   - on load, reports saved to your account are merged into the local list (so History and Reports show them);
   - new reports are uploaded (the server stores a sanitized summary, never media, and a transcript only if you
     opted in and encryption is configured); deletes and status changes are mirrored.
   Without a database nothing is sent; reports stay in this browser as before. */
window.makeSync = function ({ store, incidents, toast, rerender }) {
  let enabled = false, me = null, suppress = false, snapshot = new Map();
  const known = new Map(); // clientRef -> server id
  const snap = list => new Map(list.map(i => [i.id, i.status]));
  const json = r => r.json().catch(() => ({}));
  const post = (url, body, method = 'POST') => fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Voxa-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });

  function fromServer(x) {
    const s = x.summary || {};
    return {
      id: x.clientRef || x.id, serverId: x.id, fromServer: true, teamId: x.teamId, mine: x.mine,
      at: s.at || Date.parse(x.createdAt), reportType: x.reportType, modality: s.modality === 'text' ? 'voice' : s.modality || x.modality,
      sector: s.sector || x.sector || 'personal', policyVersion: s.policyVersion || x.policyVersion, priority: s.priority || 'nee', status: x.reviewStatus || 'open',
      notes: [], tags: [], media: s.media || null, transcript: null, extraction: s.extraction, language: s.language,
      authenticity: s.authenticity || { status: 'unavailable', code: 'NOT_STORED', message: 'No authenticity result is part of this report.' },
      audioAuthenticity: s.audioAuthenticity || null, intent: s.intent || { status: 'insufficient', score: 0, rules: [], words: 0 },
      noise: s.noise || undefined, privacy: s.privacy || undefined, state: s.state || 'complete', limitations: s.limitations || '',
      uploadId: x.uploadRef || undefined, context: { status: 'unavailable' },
      persist: false, expiresAt: Date.parse(x.expiresAt) // session copy; the account copy lives on the server
    };
  }

  async function start() {
    try { await window.VoxaAuth?.ready; } catch {}
    let r;
    try { r = await fetch('/api/auth/me'); } catch { return; }
    if (!r.ok) return;
    me = await json(r); window.VoxaMe = me;
    document.dispatchEvent(new CustomEvent('voxa:me', { detail: me }));
    if (!me.database) return;
    try {
      const list = await json(await fetch('/api/reports?limit=200'));
      const local = incidents(), have = new Set(local.map(i => i.id));
      for (const x of list.reports || []) known.set(x.clientRef || x.id, x.id);
      const imported = (list.reports || []).filter(x => !have.has(x.clientRef || x.id)).map(fromServer);
      if (imported.length) { suppress = true; store.set('incidents', [...local, ...imported]); suppress = false; rerender(); }
    } catch { toast('Could not load your saved reports from the server.'); }
    snapshot = snap(incidents());
    enabled = true;
  }

  async function upload(i) {
    const prefs = me?.preferences || {};
    let teamId; try { teamId = localStorage.getItem('voxa:shareTeam') || undefined; } catch {}
    const r = await post('/api/reports', { report: i, retainTranscript: i.persist === true && prefs.transcript_retention_opt_in === true, teamId });
    const d = await json(r);
    if (r.ok) known.set(i.id, d.id); else toast('Saved in this browser, but not to your account: ' + (d.error || 'server error'));
  }

  function changed(list) {
    if (!enabled || suppress) return;
    const next = snap(list);
    for (const i of list) {
      if (!snapshot.has(i.id) && !i.fromServer && !known.has(i.id)) upload(i).catch(() => toast('Saved in this browser, but the server could not be reached.'));
      else if (snapshot.has(i.id) && snapshot.get(i.id) !== i.status && known.has(i.id)) post(`/api/reports/${known.get(i.id)}`, { reviewStatus: i.status }, 'PATCH').catch(() => {});
    }
    for (const id of snapshot.keys()) if (!next.has(id) && known.has(id)) {
      const sid = known.get(id); known.delete(id);
      post(`/api/reports/${sid}`, undefined, 'DELETE').catch(() => toast('Deleted here, but the server copy could not be deleted. Try again later.'));
    }
    snapshot = next;
  }
  return { start, changed, get enabled() { return enabled; }, get me() { return me; } };
};
