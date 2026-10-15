/* Privacy scan page + privacy report view. The scan runs on the VOXA server with local rules (no provider).
   Evidence is masked; the redacted text is a separate copy and the original is never changed. */
window.makePrivacy = function (c) {
  const { $, esc, toast, fmt, store, incidents, uid, section, table, STATUS, previews } = c;
  const CONF = { high: 'p-high', medium: 'p-medium', low: 'p-low' };
  let last = null;

  function View() {
    let pre = ''; try { pre = sessionStorage.getItem('voxa:privacyText') || ''; sessionStorage.removeItem('voxa:privacyText'); } catch {}
    return `<div class="wrapv an pv"><p class="report-eyebrow">Privacy</p><h1>Privacy scan</h1>
      <p class="sub">Find possible personal data in a transcript or message: phone numbers, email and UPI ids, Aadhaar, PAN, card and account numbers, OTPs and more. Runs on the VOXA server with local rules; nothing is sent to a provider.</p>
      <section class="an-card"><div class="an-card-h"><h2>Text to scan</h2><span class="an-info" id="pv-count"></span></div>
        <div class="an-card-b"><textarea id="pv-text" maxlength="20000" aria-label="Text to scan" placeholder="Paste a transcript, chat or message (up to 20,000 characters)">${esc(pre)}</textarea></div></section>
      <section class="an-card an-options"><label class="an-consent"><input type="checkbox" id="pv-consent"> I am allowed to scan this text.</label>
        <label title="Otherwise the report stays in this tab only"><input type="checkbox" id="pv-retain"> Keep report 24 h</label></section>
      <div class="an-foot"><div class="service-chips"><span class="service-chip ok">Local rules · best-effort</span></div><div class="an-actions"><span id="pv-state" role="status" aria-live="polite"></span><button class="mt-btn primary" id="pv-go" type="button">Scan</button></div></div>
      <div id="pv-out"></div></div>`;
  }

  const results = (scan, withSave) => `<section class="an-card" style="margin-top:14px"><div class="an-card-h"><h2>Findings</h2><span class="md-count">${scan.total}</span></div><div class="an-card-b">
      <p class="sub" style="margin:0 0 10px">${esc(scan.summary)}</p>
      ${scan.findings.length ? `<table class="kvt"><thead><tr><th>Type</th><th>Confidence</th><th>Evidence (masked)</th><th>Position</th></tr></thead><tbody>${scan.findings.map(f => `<tr><th scope="row">${esc(f.label)}</th><td><span class="pill ${CONF[f.confidence]}">${esc(f.confidence)}</span></td><td><code>${esc(f.masked)}</code></td><td><small>characters ${f.start}–${f.end}</small></td></tr>`).join('')}</tbody></table>` : ''}
      <h3 style="margin:16px 0 6px;font-size:13px">Redacted copy</h3><div class="transcript-body">${esc(scan.redactedText)}</div>
      <p class="rep-note">${scan.limitations.map(esc).join(' ')}</p>
      ${withSave ? '<div class="row-actions no-print"><button class="btn sec" id="pv-copy">Copy redacted text</button><button class="btn" id="pv-save">Save as report</button></div>' : ''}</div></section>`;

  function setup() {
    const t = $('#pv-text'), count = () => ($('#pv-count').textContent = `${t.value.length.toLocaleString()} / 20,000`);
    t.oninput = count; count();
    $('#pv-go').onclick = async () => {
      const text = t.value; if (!text.trim()) return toast('Paste some text first.');
      if (!$('#pv-consent').checked) return toast('Confirm you are allowed to scan this text.');
      const st = $('#pv-state'), b = $('#pv-go'); b.disabled = true; st.textContent = 'Scanning…';
      try {
        const r = await fetch('/api/privacy/scan', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Voxa-Request': '1' }, body: JSON.stringify({ text, consent: true }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Scan failed.');
        last = d.scan; st.textContent = ''; $('#pv-out').innerHTML = results(last, true);
        $('#pv-copy').onclick = () => navigator.clipboard?.writeText(last.redactedText).then(() => toast('Redacted text copied.'), () => toast('Copy is not permitted here.'));
        $('#pv-save').onclick = () => {
          const inc = { id: uid(), at: Date.now(), reportType: 'privacy_analysis', modality: 'voice', title: 'Privacy scan', sector: 'personal', status: 'open', notes: [], tags: [], priority: 'nee', state: 'complete',
            intent: { status: 'insufficient', score: 0, rules: [], words: 0 }, transcript: null, media: null,
            authenticity: { status: 'unavailable', code: 'NOT_APPLICABLE', message: 'A privacy scan does not check authenticity.' },
            privacy: { engine: last.engine, total: last.total, counts: last.counts, findings: last.findings, summary: last.summary, redactedText: last.redactedText, characters: last.characters },
            limitations: last.limitations.join(' '), persist: $('#pv-retain').checked, expiresAt: Date.now() + 86400000 };
          if (store.set('incidents', [inc, ...incidents()])) location.hash = '#/incident/' + inc.id;
        };
      } catch (e) { st.textContent = e.message; }
      finally { b.disabled = false; }
    };
  }

  // Report view for a saved privacy scan (same layout and controls as the other reports).
  function report(i) {
    const p = i.privacy || {}, local = typeof p.redactedText === 'string';
    const head = `<header class="rep-head"><div><p class="report-eyebrow">Privacy scan report</p><h1>${esc(i.title || 'Privacy scan')}</h1><p class="sub">Privacy scan · ${fmt(i.at)} · ${esc(i.id)}</p></div><div class="rep-actions no-print"><button class="btn sec" id="i-pdf">Print report</button><a class="btn" href="#/privacy">New scan</a></div></header>`;
    const sum = `<div class="rep-sum"><div><span>Possible personal data</span><b class="rep-badge ${p.total ? 'warn' : 'ok'}">${p.total || 0} item${p.total === 1 ? '' : 's'}</b><small>${esc(p.engine || 'local rules')}</small></div>
      <div><span>Categories</span><b>${esc(Object.keys(p.counts || {}).join(', ') || 'None matched')}</b><small>Best-effort detection</small></div>
      <div><span>Text scanned</span><b>${p.characters ? p.characters.toLocaleString() + ' chars' : 'Not stored'}</b><small>Original text is not kept</small></div>
      <div><span>Status</span><b>Completed</b><small>${esc(i.id)}</small></div></div>`;
    const findings = (p.findings || []).length ? `<table class="kvt"><thead><tr><th>Type</th><th>Confidence</th><th>Evidence (masked)</th><th>Position</th></tr></thead><tbody>${p.findings.map(f => `<tr><th scope="row">${esc(f.label || f.category)}</th><td><span class="pill ${CONF[f.confidence] || 'p-nee'}">${esc(f.confidence || '')}</span></td><td><code>${esc(f.masked || '')}</code></td><td><small>${f.start ?? ''}–${f.end ?? ''}</small></td></tr>`).join('')}</tbody></table>` : '<p class="rep-note" style="margin:0">No personal data matched the rules. That does not prove there is none.</p>';
    const red = local ? `<div class="transcript-body">${esc(p.redactedText)}</div><p class="rep-note">The redacted copy is kept only in this browser${i.persist ? ' (up to 24 hours)' : ' tab'}. Your account copy holds the findings above, not the text.</p>`
      : '<p class="rep-note" style="margin:0">The redacted text is not stored with this report. Run a new scan to see it.</p>';
    return `<div class="wrapv rep">${head}${sum}
      ${section('Findings', findings, 'Each finding shows its category, how sure the rule is, a masked value and where it appears. The raw value is never shown or stored.')}
      ${section('Redacted copy', red)}
      <section class="rep-sec no-print"><h2>Status and notes</h2>
        <div class="filters" style="margin-top:0"><select id="i-status" aria-label="Report status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${i.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
        ${(i.notes || []).map(n => `<div class="ev"><small>${fmt(n.at)}</small>${esc(n.text)}</div>`).join('')}
        <div class="filters"><input id="i-note" aria-label="Analyst note" style="flex:1;min-width:200px" placeholder="Add analyst note…"><button class="btn" id="i-add">Add note</button></div></section>
      <div class="lim"><b>Limitations.</b> ${esc(i.limitations || '')} A match means possible personal data in the text; it is not evidence of a data breach.</div>
      <div class="row-actions no-print"><button class="btn sec" id="i-json">Export JSON</button><button class="btn danger" id="i-del">Delete report</button><a class="link" href="#/incidents">Back to call reports</a></div></div>`;
  }
  return { View, setup, report };
};
