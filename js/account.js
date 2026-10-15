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

  // ---------------------------------------------------------------- Team
  const Team = () => shell('Manage', 'Team', 'Share reports with the people you work with. Team admins invite members and set roles; nobody can grant platform-wide admin rights from here.');
  async function setupTeam() {
    const m = await me(); if (m.error) return fail(m.error); if (!m.database) return body(noDb);
    let share; try { share = localStorage.getItem('voxa:shareTeam') || ''; } catch { share = ''; }
    const teams = m.teams || [];
    body(`<div class="panelx"><h3>Your teams</h3>${teams.length ? `<table class="kvt"><tbody>${teams.map(t => `<tr><th scope="row"><button class="link" data-team="${esc(t.id)}">${esc(t.name)}</button></th><td>${ROLE[t.role]}</td></tr>`).join('')}</tbody></table>` : '<p class="sub" style="margin:0">You are not in a team yet.</p>'}
      <form id="t-new" class="filters"><input id="t-name" maxlength="80" placeholder="New team name" aria-label="New team name" required><button class="btn">Create team</button></form></div>
      <div class="panelx"><h3>Share new reports with</h3><select id="t-share" aria-label="Share new reports with"><option value="">Only me (personal)</option>${teams.map(t => `<option value="${esc(t.id)}" ${share === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <p class="sub" style="margin:8px 0 0">Team members can read shared reports. Only you or a team admin can delete them.</p></div><div id="t-detail"></div>`);
    $('#t-share').onchange = e => { try { e.target.value ? localStorage.setItem('voxa:shareTeam', e.target.value) : localStorage.removeItem('voxa:shareTeam'); } catch {} toast('Saved for new reports.'); };
    $('#t-new').onsubmit = async e => { e.preventDefault(); try { await api('/api/teams', { method: 'POST', body: JSON.stringify({ name: $('#t-name').value }) }); toast('Team created.'); setupTeam(); } catch (err) { toast(err.message); } };
    $('#acct-body').onclick = e => { const b = e.target.closest('[data-team]'); if (b) showTeam(b.dataset.team); };
    if (teams[0]) showTeam(teams[0].id);
  }
  async function showTeam(id) {
    let d; try { d = await api(`/api/teams/${encodeURIComponent(id)}/members`); } catch (e) { $('#t-detail').innerHTML = `<div class="panelx"><p class="sub">${esc(e.message)}</p></div>`; return; }
    const admin = d.yourRole === 'admin';
    $('#t-detail').innerHTML = `<div class="panelx"><h3>${esc(d.team.name)} · members</h3><table class="kvt"><tbody>${d.members.map(x => `<tr><th scope="row">${esc(x.displayName || x.email || 'Member')}<br><small>${esc(x.email || '')}</small></th><td>${admin ? `<select data-role="${esc(x.userId)}" aria-label="Role"><option value="user" ${x.role === 'user' ? 'selected' : ''}>Member</option><option value="admin" ${x.role === 'admin' ? 'selected' : ''}>Admin</option></select> <button class="link" data-remove="${esc(x.userId)}">Remove</button>` : ROLE[x.role]}</td></tr>`).join('')}</tbody></table></div>
      ${admin ? `<div class="panelx"><h3>Invite someone</h3><form id="t-inv" class="filters"><input id="t-email" type="email" placeholder="name@example.com" aria-label="Email" required><select id="t-role" aria-label="Role"><option value="user">Member</option><option value="admin">Admin</option></select><button class="btn">Create invite link</button></form><div id="t-link"></div>
        <p class="sub" style="margin:8px 0 0">The link works once, only for that email address, and expires in 72 hours. VOXA does not send email: share the link yourself.</p></div>` : ''}`;
    const det = $('#t-detail');
    det.onchange = async e => { const s = e.target.closest('[data-role]'); if (!s) return; try { await api(`/api/teams/${id}/members/${s.dataset.role}/role`, { method: 'PATCH', body: JSON.stringify({ role: s.value }) }); toast('Role updated.'); } catch (err) { toast(err.message); showTeam(id); } };
    det.onclick = async e => { const b = e.target.closest('[data-remove]'); if (!b) return; if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Click again to remove'; return; } try { await api(`/api/teams/${id}/members/${b.dataset.remove}`, { method: 'DELETE' }); toast('Removed.'); showTeam(id); } catch (err) { toast(err.message); } };
    const f = $('#t-inv');
    if (f) f.onsubmit = async e => { e.preventDefault(); try { const r = await api(`/api/teams/${id}/invitations`, { method: 'POST', body: JSON.stringify({ email: $('#t-email').value, role: $('#t-role').value }) }); const link = location.origin + r.acceptPath; $('#t-link').innerHTML = `<div class="ev"><b>Invite link (shown once)</b><input readonly value="${esc(link)}" style="width:100%" aria-label="Invite link"><small>Expires ${esc(fmt(Date.parse(r.expiresAt)))}</small></div>`; } catch (err) { toast(err.message); } };
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
