/* Account, Team, invitation and Audit pages. All permission checks happen on the server; the UI only hides what
   the server would refuse anyway. */
window.makeAccount = function (c) {
  const { $, esc, toast, fmt } = c;
  const api = async (url, opts = {}) => {
    const r = await fetch(url, { ...opts, headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), 'X-Voxa-Request': '1', ...(opts.headers || {}) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || `Request failed (${r.status}).`), { status: r.status, code: d.code });
    return d;
  };
  const me = async () => { try { return await api('/api/auth/me'); } catch (e) { return { error: e }; } };
  const noDb = `<div class="panelx"><h3>Needs the database</h3><p class="sub" style="margin:0">Accounts, teams and server-side history need a database. This server has none configured yet, so reports stay in this browser. An administrator connects it by setting <code>DATABASE_URL</code> (see PRIVACY_SETUP.md).</p></div>`;
  const shell = (eyebrow, title, sub) => `<div class="wrapv acct"><p class="report-eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p><div id="acct-body"><p class="sub">Loading…</p></div></div>`;
  const body = html => { const el = $('#acct-body'); if (el) el.innerHTML = html; };
  const fail = e => body(`<div class="panelx"><h3>Unavailable</h3><p class="sub" style="margin:0">${esc(e.code === 'DB_NOT_CONFIGURED' ? 'The database is not configured on this server.' : e.message)}</p></div>`);
  const ROLE = { admin: 'Admin', user: 'Member' };

  // ---------------------------------------------------------------- Team dashboard
  const ICON = {
    chart: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 20V12M10 20V6M15 20v-9M20 20V9"/></svg>',
    users: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"/><circle cx="9.5" cy="7" r="3.5"/><path d="M21 19v-1a4 4 0 0 0-3-3.9M16 3.2a3.5 3.5 0 0 1 0 6.6"/></svg>',
    add: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M3 20a6 6 0 0 1 12 0M19 8v6M16 11h6"/></svg>',
    edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>'
  };
  const mins = s => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
  const Team = () => `<div class="wrapv td"><div id="acct-body"><p class="sub">Loading…</p></div></div>`;
  let current = null;

  async function setupTeam() {
    const m = await me(); if (m.error) return fail(m.error);
    if (!m.database) return body(`<section class="td-card td-head"><div class="td-hero"><h1>Team dashboard</h1><p>Manage your team, review usage and share analysis reports.</p></div></section>${noDb}`);
    const teams = m.teams || [];
    if (!teams.length) {
      const suggested = m.user?.email || m.user?.displayName || 'My team';
      body(`<section class="td-card td-head"><div class="td-hero"><h1>Team dashboard</h1><p>Manage your team, review usage and share analysis reports.</p></div>
        <form class="td-bar" id="t-new"><div><div class="td-team">Create your team</div><small>You will be its admin. Plan: Free (no billing).</small></div>
        <div class="td-actions"><input id="t-name" maxlength="80" value="${esc(suggested)}" aria-label="Team name" required><button class="mt-btn sm primary">Create team</button></div></form></section>`);
      $('#t-new').onsubmit = async e => { e.preventDefault(); try { await api('/api/teams', {method: 'POST', body: JSON.stringify({name: $('#t-name').value})}); toast('Team created.'); setupTeam(); } catch (err) { toast(err.message); } };
      return;
    }
    if (!current || !teams.some(t => t.id === current)) current = teams[0].id;
    let st, mem;
    try { [st, mem] = await Promise.all([api(`/api/teams/${current}/stats`), api(`/api/teams/${current}/members`)]); } catch (e) { return fail(e); }
    const admin = st.yourRole === 'admin';
    let share; try { share = localStorage.getItem('voxa:shareTeam') || ''; } catch { share = ''; }
    const by = st.reports.byType || {};
    const tile = (label, value, sub = '') => `<div class="td-card td-tile"><span>${esc(label)}</span><b>${esc(value)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
    body(`<section class="td-card td-head"><div class="td-hero"><h1>Team dashboard</h1><p>Manage your team, review usage and share analysis reports.</p></div>
      <div class="td-bar"><div><div class="td-team">Team: <b>${esc(st.team.name)}</b></div><small>Team plan: ${esc(st.team.plan === 'free' ? 'Free' : st.team.plan)} (no billing)</small></div>
        <div class="td-actions">${teams.length > 1 ? `<select id="td-pick" aria-label="Choose team">${teams.map(t => `<option value="${esc(t.id)}" ${t.id === current ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : ''}
          ${admin ? `<button class="mt-btn sm td-ghost" id="td-rename" type="button">${ICON.edit} Edit team name</button><button class="mt-btn sm primary" id="td-add" type="button">${ICON.add} Add member</button>` : ''}</div></div></section>
      <div class="td-grid"><div>
        <h2 class="td-h">${ICON.chart} Usage statistics</h2>
        <div class="td-stats">${tile('Reports shared', st.reports.total)}${tile('High-priority reports', st.reports.highPriority)}${tile('Audio analyzed', mins(st.audioSeconds))}
          <div class="td-card td-tile"><span>Team members</span><b>${st.members}</b><small>${st.admins} admin${st.admins === 1 ? '' : 's'}${st.pendingInvitations ? ` · ${st.pendingInvitations} pending invite${st.pendingInvitations === 1 ? '' : 's'}` : ''}</small></div></div>
        <div class="td-h2row"><h2 class="td-h">Reports by type</h2><a class="mt-btn sm td-ghost" href="#/incidents">View reports</a></div>
        <div class="td-types">${tile('Voice authenticity', by.voice_authenticity || 0)}${tile('Noise analysis', by.noise_analysis || 0)}${tile('Privacy scans', by.privacy_analysis || 0)}</div>
      </div><div>
        <div class="td-h2row"><h2 class="td-h">${ICON.users} Team members</h2>${admin ? `<button class="link td-link" id="td-add2" type="button">${ICON.add} Add</button>` : ''}</div>
        <div class="td-card td-members">${mem.members.map(x => { const name = x.displayName || (x.email || 'Member').split('@')[0]; return `<div class="td-mem"><span class="td-av">${esc((name[0] || 'M').toUpperCase())}</span><div class="td-who"><b>${esc(name)}</b><small>${esc(x.email || '')}</small></div>
          ${admin ? `<select class="td-role" data-role="${esc(x.userId)}" aria-label="Role for ${esc(name)}"><option value="admin" ${x.role === 'admin' ? 'selected' : ''}>Admin</option><option value="user" ${x.role === 'user' ? 'selected' : ''}>Member</option></select><button class="td-x" data-remove="${esc(x.userId)}" type="button" aria-label="Remove ${esc(name)}">×</button>` : `<span class="td-badge">${ROLE[x.role]}</span>`}</div>`; }).join('')}</div>
        <div class="td-card td-share"><b>Share new reports with</b><select id="t-share" aria-label="Share new reports with"><option value="">Only me (personal)</option>${teams.map(t => `<option value="${esc(t.id)}" ${share === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
          <small>Team members can read shared reports. Only you or a team admin can delete them. Audio is never shared or stored.</small></div>
        <form class="td-new" id="t-new2"><input id="t-name2" maxlength="80" placeholder="Create another team" aria-label="New team name" required><button class="mt-btn sm">Create</button></form>
      </div></div>
      <dialog class="td-dlg" id="td-dlg"><form method="dialog" id="td-form"></form></dialog>`);

    $('#td-pick')?.addEventListener('change', e => { current = e.target.value; setupTeam(); });
    $('#t-share').onchange = e => { try { e.target.value ? localStorage.setItem('voxa:shareTeam', e.target.value) : localStorage.removeItem('voxa:shareTeam'); } catch {} toast('Saved for new reports.'); };
    $('#t-new2').onsubmit = async e => { e.preventDefault(); try { const t = await api('/api/teams', {method: 'POST', body: JSON.stringify({name: $('#t-name2').value})}); current = t.id; toast('Team created.'); setupTeam(); } catch (err) { toast(err.message); } };
    const dlg = $('#td-dlg'), form = $('#td-form');
    const open = html => { form.innerHTML = html; dlg.showModal(); form.querySelector('input')?.focus(); };
    const rename = () => {
      open(`<h3>Edit team name</h3><label class="field"><span>Team name</span><input id="td-n" maxlength="80" value="${esc(st.team.name)}" required></label><p class="td-err" id="td-e"></p><div class="actions"><button class="mt-btn sm" value="cancel" formnovalidate>Cancel</button><button class="mt-btn sm primary" id="td-ok" type="button">Save</button></div>`);
      $('#td-ok').onclick = async () => { try { await api(`/api/teams/${current}`, {method: 'PATCH', body: JSON.stringify({name: $('#td-n').value})}); dlg.close(); toast('Team renamed.'); setupTeam(); } catch (e) { $('#td-e').textContent = e.message; } };
    };
    const add = () => {
      open(`<h3>Add member</h3><p class="sub" style="margin:0 0 10px">Creates a one-time invite link for this email address (valid 72 hours). VOXA does not send email: share the link yourself.</p>
        <label class="field"><span>Email</span><input id="td-email" type="email" placeholder="name@example.com" required></label>
        <label class="field"><span>Role</span><select id="td-r"><option value="user">Member</option><option value="admin">Admin</option></select></label><p class="td-err" id="td-e"></p><div id="td-link"></div>
        <div class="actions"><button class="mt-btn sm" value="cancel" formnovalidate>Close</button><button class="mt-btn sm primary" id="td-ok" type="button">Create invite link</button></div>`);
      $('#td-ok').onclick = async () => {
        try {
          const r = await api(`/api/teams/${current}/invitations`, {method: 'POST', body: JSON.stringify({email: $('#td-email').value, role: $('#td-r').value})});
          const link = location.origin + r.acceptPath;
          $('#td-link').innerHTML = `<div class="ev"><b>Invite link (shown once)</b><input readonly value="${esc(link)}" style="width:100%" aria-label="Invite link"><small>Expires ${esc(fmt(Date.parse(r.expiresAt)))}</small></div>`;
          $('#td-ok').textContent = 'Copy link'; $('#td-ok').onclick = () => navigator.clipboard?.writeText(link).then(() => toast('Invite link copied.'), () => toast('Copy is not permitted here; select the link and copy it.'));
          $('#td-e').textContent = '';
        } catch (e) { $('#td-e').textContent = e.message; }
      };
    };
    $('#td-rename')?.addEventListener('click', rename);
    $('#td-add')?.addEventListener('click', add); $('#td-add2')?.addEventListener('click', add);
    const members = $('.td-members');
    members.onchange = async e => { const s = e.target.closest('[data-role]'); if (!s) return; try { await api(`/api/teams/${current}/members/${s.dataset.role}/role`, {method: 'PATCH', body: JSON.stringify({role: s.value})}); toast('Role updated.'); setupTeam(); } catch (err) { toast(err.message); setupTeam(); } };
    members.onclick = async e => { const b = e.target.closest('[data-remove]'); if (!b) return; if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Remove?'; b.classList.add('armed'); return; } try { await api(`/api/teams/${current}/members/${b.dataset.remove}`, {method: 'DELETE'}); toast('Member removed.'); setupTeam(); } catch (err) { toast(err.message); } };
  }

  // ---------------------------------------------------------------- Accept invitation
  const Invite = () => shell('Team invitation', 'Join a team', 'Accept the invitation that was shared with you. It only works for the email address it was sent to.');
  async function setupInvite(token) {
    const m = await me(); if (m.error) return fail(m.error); if (!m.database) return body(noDb);
    body(`<div class="panelx"><p class="sub">Signed in as <b>${esc(m.user?.email || 'unknown')}</b>.</p><button class="btn" id="inv-go">Join team</button></div>`);
    $('#inv-go').onclick = async () => { try { await api('/api/invitations/accept', { method: 'POST', body: JSON.stringify({ token }) }); toast('You joined the team.'); location.hash = '#/team'; } catch (e) { body(`<div class="panelx"><h3>Could not join</h3><p class="sub" style="margin:0">${esc(e.message)}</p></div>`); } };
  }

  // ---------------------------------------------------------------- Account
  const Account = () => shell('Your account', 'Account and privacy', 'Who you are signed in as, what VOXA keeps about you, and how to take it with you or erase it.');
  async function setupAccount() {
    const m = await me(); if (m.error) return fail(m.error);
    const mode = window.VoxaAuth?.mode;
    const cfg = window.VoxaAuth?.config || {};
    if (!m.database) { body(`<div class="panelx"><dl class="kv"><dt>Signed in as</dt><dd>${esc(m.user?.email || m.user?.displayName || 'Local workspace')}</dd><dt>Sign-in</dt><dd>${mode === 'clerk' ? 'Clerk account' : 'Local demo workspace (no account)'}</dd></dl></div>${noDb}<div class="row-actions"><button class="btn sec" id="a-out">Sign out</button></div>`); $('#a-out').onclick = () => $('#logout').click(); return; }
    const p = m.preferences || {};
    body(`<div class="panelx"><dl class="kv"><dt>Signed in as</dt><dd>${esc(m.user.email || m.user.displayName || '')}</dd><dt>Sign-in</dt><dd>${mode === 'clerk' ? 'Clerk account' : 'Local demo workspace'}</dd><dt>Role</dt><dd>${m.user.isSuperAdmin ? 'Super admin' : 'User'}</dd><dt>Teams</dt><dd>${esc((m.teams || []).map(t => t.name + ' (' + ROLE[t.role] + ')').join(', ') || 'None')}</dd></dl></div>
      <div class="panelx"><h3>What VOXA keeps</h3><p class="sub">Saved reports: a summary and findings, for ${esc(String(cfg.reportRetentionDays || 30))} days. Never kept: audio, images, video, quoted excerpts, analyst notes, raw provider responses.</p>
        <label class="consent-line"><input type="checkbox" id="p-ret" ${p.retention_opt_in ? 'checked' : ''}> Keep my saved reports in my account</label><br>
        <label class="consent-line"><input type="checkbox" id="p-tr" ${p.transcript_retention_opt_in ? 'checked' : ''} ${cfg.transcriptRetention ? '' : 'disabled'}> Also keep transcripts, encrypted, for reports I mark “Keep report 24 h”</label>
        <p class="sub" style="margin:6px 0 0">${cfg.transcriptRetention ? 'Transcripts are encrypted with AES-256-GCM before they are stored and expire automatically.' : 'Transcript storage is off on this server (no encryption key configured), so transcripts are never stored.'}</p>
        <div class="row-actions"><button class="btn" id="p-save">Save choices</button></div></div>
      <div class="panelx"><h3>Your data</h3><div class="row-actions" style="margin-top:0"><button class="btn sec" id="p-export">Download my data (JSON)</button></div>
        <h3 style="margin-top:16px">Erase my VOXA data</h3><p class="sub">Deletes your saved reports, preferences and memberships, and anonymizes your account. Your sign-in account itself is managed by Clerk.</p>
        <div class="filters"><input id="p-confirm" placeholder="Type DELETE to confirm" aria-label="Type DELETE to confirm"><button class="btn danger" id="p-erase">Erase my data</button></div></div>
      <div class="row-actions"><button class="btn sec" id="a-out">Sign out</button></div>`);
    $('#a-out').onclick = () => $('#logout').click();
    $('#p-save').onclick = async () => { try { const r = await api('/api/me/preferences', { method: 'PUT', body: JSON.stringify({ retentionOptIn: $('#p-ret').checked, transcriptRetentionOptIn: $('#p-tr').checked }) }); if (window.VoxaMe) window.VoxaMe.preferences = r; toast('Choices saved.'); } catch (e) { toast(e.message); } };
    $('#p-export').onclick = async () => { try { const d = await api('/api/me/export'); const u = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = u; a.download = 'voxa-my-data.json'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); } catch (e) { toast(e.message); } };
    $('#p-erase').onclick = async () => { if ($('#p-confirm').value !== 'DELETE') return toast('Type DELETE to confirm.'); try { const r = await api('/api/me/deletion-requests', { method: 'POST', body: JSON.stringify({ scope: 'all_my_data', confirm: 'DELETE' }) }); body(`<div class="panelx"><h3>Erased</h3><p class="sub" style="margin:0">${esc(r.note)}</p></div>`); } catch (e) { toast(e.message); } };
  }

  // ---------------------------------------------------------------- Audit (super admin)
  const Audit = () => shell('Security', 'Audit log', 'Security-relevant events. Entries hold ids and short labels only: no media, transcripts, tokens or keys. A denied request is a security event, not a breach.');
  async function setupAudit() {
    let d; try { d = await api('/api/admin/audit-events?limit=200'); } catch (e) { return body(`<div class="panelx"><p class="sub" style="margin:0">${esc(e.status === 403 ? 'Only a super admin can view the audit log.' : e.message)}</p></div>`); }
    const SEV = { info: 'p-low', low: 'p-low', medium: 'p-medium', high: 'p-high' };
    body(d.events.length ? `<div class="tw"><table class="t"><thead><tr><th>Time</th><th>Action</th><th>Outcome</th><th>Severity</th><th>Class</th><th>Target</th></tr></thead><tbody>${d.events.map(e => `<tr><td>${esc(fmt(Date.parse(e.created_at)))}</td><td>${esc(e.action)}</td><td>${esc(e.outcome)}</td><td><span class="pill ${SEV[e.severity] || 'p-nee'}">${esc(e.severity)}</span></td><td>${esc(e.classification)}</td><td><small>${esc((e.target_type || '') + ' ' + (e.target_id || ''))}</small></td></tr>`).join('')}</tbody></table></div>` : '<div class="panelx"><p class="sub" style="margin:0">No events yet.</p></div>');
  }

  return { Team, setupTeam, Invite, setupInvite, Account, setupAccount, Audit, setupAudit };
};
