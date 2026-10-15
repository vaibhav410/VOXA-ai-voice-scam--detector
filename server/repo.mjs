// Data access. Every statement is parameterized; authorization decisions live in rbac.mjs and the routes, and this
// layer additionally scopes reads to what a user can see, so a missing route check cannot leak other people's data.
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {encrypt, decrypt, EncryptionUnavailable} from './crypto.mjs';

export const normEmail = e => (typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()) ? e.trim().toLowerCase() : null);
export const sha256 = s => createHash('sha256').update(s).digest('hex');
export const isUuid = s => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// ---------------------------------------------------------------- users
// New users are always plain users: this path never grants a global or team role.
export async function upsertUser(db, identity) {
  const email = identity.emailVerified || identity.demo ? normEmail(identity.email) : null;
  const display = typeof identity.name === 'string' ? identity.name.slice(0, 120) : null;
  try {
    const [u] = await db.query(`insert into voxa.users (auth_subject, email, email_normalized, display_name) values ($1, $2, $3, $4)
      on conflict (auth_subject) do update set email = coalesce(excluded.email, voxa.users.email), email_normalized = coalesce(excluded.email_normalized, voxa.users.email_normalized),
        display_name = coalesce(excluded.display_name, voxa.users.display_name), updated_at = now()
      returning id, auth_subject, email, email_normalized, display_name, status`, [identity.subject, identity.email || null, email, display]);
    return u;
  } catch (e) {
    if (e?.code !== '23505') throw e; // another account already holds this email: keep the user, without the email link
    const [u] = await db.query(`insert into voxa.users (auth_subject, email, display_name) values ($1, $2, $3)
      on conflict (auth_subject) do update set display_name = coalesce(excluded.display_name, voxa.users.display_name), updated_at = now()
      returning id, auth_subject, email, email_normalized, display_name, status`, [identity.subject, identity.email || null, display]);
    return u;
  }
}

export async function loadPrincipal(db, user) {
  const [g] = await db.query("select 1 as yes from voxa.global_roles where user_id = $1 and role = 'super_admin'", [user.id]);
  const memberships = await db.query('select m.team_id, m.role, t.name from voxa.team_memberships m join voxa.teams t on t.id = m.team_id where m.user_id = $1 order by t.name', [user.id]);
  return {id: user.id, subject: user.auth_subject, email: user.email, emailNormalized: user.email_normalized, displayName: user.display_name, status: user.status, isSuperAdmin: Boolean(g), memberships};
}

// ---------------------------------------------------------------- analyses
export async function createAnalysis(db, user, v, {teamId = null, cfg, ring, retainTranscript = false}) {
  const id = randomUUID();
  let ciphertext = null, transcriptExpires = null, transcriptNote = null;
  if (v.sensitive) {
    if (!retainTranscript || cfg.retention.transcriptMode !== 'encrypted') transcriptNote = 'not_retained';
    else {
      try { ciphertext = encrypt(ring, JSON.stringify(v.sensitive), `analysis:${id}:transcript`); transcriptExpires = new Date(Date.now() + cfg.retention.transcriptDays * 86400000); }
      catch (e) { if (e instanceof EncryptionUnavailable) transcriptNote = 'encryption_unavailable'; else throw e; }
    }
  }
  const expires = new Date(Date.now() + cfg.retention.reportDays * 86400000);
  return db.tx(async q => {
    const existing = await q('select id from voxa.analyses where owner_user_id = $1 and client_ref = $2', [user.id, v.clientRef]);
    if (existing.length) return {id: existing[0].id, created: false, transcriptNote};
    await q(`insert into voxa.analyses (id, client_ref, owner_user_id, team_id, modality, report_type, status, review_status, title, sector, policy_version, upload_ref, summary_json, transcript_ciphertext, transcript_expires_at, completed_at, expires_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,now(),$16)`,
      [id, v.clientRef, user.id, teamId, v.modality, v.reportType, v.status, v.reviewStatus, v.title, v.sector, v.policyVersion, v.uploadRef, JSON.stringify(v.summary), ciphertext, transcriptExpires, expires]);
    for (const f of v.findings) await q('insert into voxa.findings (analysis_id, finding_type, score, label, evidence_json) values ($1,$2,$3,$4,$5::jsonb)', [id, f.type, f.score ?? null, f.label ?? null, JSON.stringify(f.evidence || {})]);
    for (const r of v.providerRuns) await q('insert into voxa.provider_runs (analysis_id, provider, task_type, status, finished_at, error_code) values ($1,$2,$3,$4,now(),$5)', [id, r.provider, r.task, r.status, r.errorCode]);
    return {id, created: true, transcriptNote};
  });
}

const ROW = 'a.id, a.client_ref, a.owner_user_id, a.team_id, a.modality, a.report_type, a.status, a.review_status, a.title, a.sector, a.policy_version, a.upload_ref, a.summary_json, a.created_at, a.expires_at, (a.transcript_ciphertext is not null) as has_transcript';
// Only rows the user may see: their own, plus reports shared to a team they belong to.
export async function listAnalyses(db, user, {limit = 100, before = null, reportType = null} = {}) {
  const teamIds = user.memberships.map(m => m.team_id);
  return db.query(`select ${ROW} from voxa.analyses a where (a.owner_user_id = $1 or a.team_id = any($2::uuid[])) and a.expires_at > now()
    and ($3::timestamptz is null or a.created_at < $3) and ($4::text is null or a.report_type = $4) order by a.created_at desc limit $5`, [user.id, teamIds, before, reportType, Math.min(Math.max(1, limit), 200)]);
}
export async function getAnalysis(db, id) {
  if (!isUuid(id)) return null;
  const [a] = await db.query(`select ${ROW}, a.transcript_ciphertext, a.transcript_expires_at from voxa.analyses a where a.id = $1 and a.expires_at > now()`, [id]);
  return a || null;
}
export async function analysisDetail(db, a, ring) {
  const findings = await db.query('select finding_type, score, label, evidence_json, created_at from voxa.findings where analysis_id = $1 order by created_at', [a.id]);
  const providerRuns = await db.query('select provider, task_type, status, error_code, finished_at from voxa.provider_runs where analysis_id = $1', [a.id]);
  let sensitive = null, sensitiveError = null;
  if (a.transcript_ciphertext && (!a.transcript_expires_at || new Date(a.transcript_expires_at) > new Date())) {
    try { sensitive = JSON.parse(decrypt(ring, a.transcript_ciphertext, `analysis:${a.id}:transcript`)); } catch { sensitiveError = 'The stored transcript could not be decrypted (key missing, rotated away, or data altered).'; }
  }
  const {transcript_ciphertext, transcript_expires_at, ...rest} = a;
  return {...rest, findings, providerRuns, sensitive, sensitiveError};
}
export const deleteAnalysis = async (db, id) => (isUuid(id) ? (await db.query('delete from voxa.analyses where id = $1 returning id', [id])).length > 0 : false);
export const setReviewStatus = async (db, id, status) => db.query('update voxa.analyses set review_status = $2 where id = $1', [id, status]);

// ---------------------------------------------------------------- teams
export async function createTeam(db, user, name) {
  return db.tx(async q => {
    const [t] = await q('insert into voxa.teams (name, created_by) values ($1, $2) returning id, name, created_at', [name, user.id]);
    await q("insert into voxa.team_memberships (team_id, user_id, role) values ($1, $2, 'admin')", [t.id, user.id]);
    return t;
  });
}
export const teamMembers = (db, teamId) => db.query('select u.id as user_id, u.display_name, u.email, m.role, m.joined_at from voxa.team_memberships m join voxa.users u on u.id = m.user_id where m.team_id = $1 order by m.joined_at', [teamId]);
export async function getTeam(db, teamId) { if (!isUuid(teamId)) return null; const [t] = await db.query('select id, name, created_at from voxa.teams where id = $1', [teamId]); return t || null; }
export async function memberRole(db, teamId, userId) { const [m] = await db.query('select role from voxa.team_memberships where team_id = $1 and user_id = $2', [teamId, userId]); return m?.role || null; }

// Change a team role. Refuses to leave a team without an admin. Only 'admin' | 'user' can ever be written.
export async function setMemberRole(db, teamId, userId, role) {
  return db.tx(async q => {
    const [cur] = await q('select role from voxa.team_memberships where team_id = $1 and user_id = $2 for update', [teamId, userId]);
    if (!cur) return {error: 'NOT_MEMBER'};
    if (cur.role === 'admin' && role !== 'admin') {
      const [{n}] = await q("select count(*)::int as n from voxa.team_memberships where team_id = $1 and role = 'admin'", [teamId]);
      if (n <= 1) return {error: 'LAST_ADMIN'};
    }
    await q('update voxa.team_memberships set role = $3 where team_id = $1 and user_id = $2', [teamId, userId, role]);
    return {previous: cur.role};
  });
}
export async function removeMember(db, teamId, userId) {
  return db.tx(async q => {
    const [cur] = await q('select role from voxa.team_memberships where team_id = $1 and user_id = $2 for update', [teamId, userId]);
    if (!cur) return {error: 'NOT_MEMBER'};
    if (cur.role === 'admin') { const [{n}] = await q("select count(*)::int as n from voxa.team_memberships where team_id = $1 and role = 'admin'", [teamId]); if (n <= 1) return {error: 'LAST_ADMIN'}; }
    await q('delete from voxa.team_memberships where team_id = $1 and user_id = $2', [teamId, userId]);
    return {removed: true};
  });
}

// ---------------------------------------------------------------- invitations (one-time token; only its hash is stored)
export async function createInvitation(db, {teamId, email, role, invitedBy, ttlHours = 72}) {
  const token = randomBytes(32).toString('base64url');
  const [inv] = await db.query('insert into voxa.invitations (team_id, email_normalized, role, token_hash, expires_at, invited_by) values ($1,$2,$3,$4,$5,$6) returning id, expires_at',
    [teamId, email, role, sha256(token), new Date(Date.now() + ttlHours * 3600000), invitedBy]);
  return {...inv, token};
}
export async function acceptInvitation(db, user, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return {error: 'INVALID'};
  return db.tx(async q => {
    const [inv] = await q('select id, team_id, email_normalized, role, expires_at, accepted_at from voxa.invitations where token_hash = $1 for update', [sha256(token)]);
    if (!inv) return {error: 'INVALID'};
    if (inv.accepted_at) return {error: 'USED'};
    if (new Date(inv.expires_at) <= new Date()) return {error: 'EXPIRED'};
    if (!user.emailNormalized || user.emailNormalized !== inv.email_normalized) return {error: 'EMAIL_MISMATCH'};
    await q('update voxa.invitations set accepted_at = now(), accepted_by = $2 where id = $1', [inv.id, user.id]);
    await q('insert into voxa.team_memberships (team_id, user_id, role) values ($1, $2, $3) on conflict (team_id, user_id) do nothing', [inv.team_id, user.id, inv.role]);
    return {teamId: inv.team_id, role: inv.role};
  });
}

// ---------------------------------------------------------------- preferences, export, deletion
export async function getPreferences(db, userId) {
  const [p] = await db.query('select locale, retention_opt_in, transcript_retention_opt_in, updated_at from voxa.user_preferences where user_id = $1', [userId]);
  return p || {locale: null, retention_opt_in: false, transcript_retention_opt_in: false, updated_at: null};
}
export async function setPreferences(db, userId, {locale = null, retentionOptIn = false, transcriptRetentionOptIn = false}) {
  const [p] = await db.query(`insert into voxa.user_preferences (user_id, locale, retention_opt_in, transcript_retention_opt_in, updated_at) values ($1,$2,$3,$4,now())
    on conflict (user_id) do update set locale = excluded.locale, retention_opt_in = excluded.retention_opt_in, transcript_retention_opt_in = excluded.transcript_retention_opt_in, updated_at = now()
    returning locale, retention_opt_in, transcript_retention_opt_in, updated_at`, [userId, locale, Boolean(retentionOptIn), Boolean(transcriptRetentionOptIn)]);
  return p;
}
export async function exportUserData(db, user) {
  const analyses = await db.query(`select ${ROW} from voxa.analyses a where a.owner_user_id = $1 order by a.created_at desc`, [user.id]);
  const ids = analyses.map(a => a.id);
  const findings = ids.length ? await db.query('select analysis_id, finding_type, score, label, evidence_json, created_at from voxa.findings where analysis_id = any($1::uuid[])', [ids]) : [];
  return {
    exportedAt: new Date().toISOString(),
    profile: {id: user.id, email: user.email, displayName: user.displayName, status: user.status},
    preferences: await getPreferences(db, user.id),
    memberships: user.memberships,
    analyses: analyses.map(a => ({...a, findings: findings.filter(f => f.analysis_id === a.id)})),
    deletionRequests: await db.query('select id, scope, target_ref, status, requested_at, completed_at from voxa.deletion_requests where requester_user_id = $1 order by requested_at desc', [user.id]),
    note: 'Encrypted transcripts are not included in exports. Audit records about your account are kept in minimized form for security.'
  };
}
// Erase a user's VOXA data. Refuses while the user is the only admin of a team that has other members.
export async function deleteAllMyData(db, user) {
  return db.tx(async q => {
    const [req] = await q("insert into voxa.deletion_requests (requester_user_id, scope, status) values ($1, 'all_my_data', 'pending') returning id", [user.id]);
    const blocking = await q(`select t.name from voxa.team_memberships m join voxa.teams t on t.id = m.team_id where m.user_id = $1 and m.role = 'admin'
      and (select count(*) from voxa.team_memberships a where a.team_id = m.team_id and a.role = 'admin') = 1
      and (select count(*) from voxa.team_memberships x where x.team_id = m.team_id) > 1`, [user.id]);
    if (blocking.length) { await q("update voxa.deletion_requests set status = 'failed', completed_at = now() where id = $1", [req.id]); return {error: 'LAST_ADMIN', teams: blocking.map(b => b.name), requestId: req.id}; }
    const [{n}] = await q('with d as (delete from voxa.analyses where owner_user_id = $1 returning 1) select count(*)::int as n from d', [user.id]);
    await q('delete from voxa.teams where id in (select team_id from voxa.team_memberships where user_id = $1) and (select count(*) from voxa.team_memberships x where x.team_id = voxa.teams.id) = 1', [user.id]);
    await q('delete from voxa.team_memberships where user_id = $1', [user.id]);
    await q('delete from voxa.user_preferences where user_id = $1', [user.id]);
    await q('delete from voxa.global_roles where user_id = $1', [user.id]);
    // Anonymize the account row (kept so minimized audit records still have a valid reference).
    await q("update voxa.users set email = null, email_normalized = null, display_name = null, status = 'disabled', updated_at = now() where id = $1", [user.id]);
    await q("update voxa.deletion_requests set status = 'completed', completed_at = now() where id = $1", [req.id]);
    return {requestId: req.id, analysesDeleted: n};
  });
}

// ---------------------------------------------------------------- retention, admin
export async function purgeExpired(db, {auditDays = 365} = {}) {
  const a = await db.query('delete from voxa.analyses where expires_at <= now() returning id');
  const t = await db.query('update voxa.analyses set transcript_ciphertext = null, transcript_expires_at = null where transcript_expires_at <= now() returning id');
  const i = await db.query("delete from voxa.invitations where expires_at <= now() - interval '7 days' returning id");
  const e = await db.query('delete from voxa.audit_events where created_at <= now() - ($1::int * interval \'1 day\') returning id', [auditDays]);
  return {analyses: a.length, transcripts: t.length, invitations: i.length, auditEvents: e.length};
}
export async function grantSuperAdmin(db, email) {
  const e = normEmail(email);
  if (!e) return {error: 'INVALID_EMAIL'};
  const [u] = await db.query("select id from voxa.users where email_normalized = $1 and status = 'active'", [e]);
  if (!u) return {error: 'NO_SUCH_USER'};
  await db.query("insert into voxa.global_roles (user_id, role, granted_via) values ($1, 'super_admin', 'cli') on conflict (user_id) do nothing", [u.id]);
  return {userId: u.id};
}
export const listAudit = (db, {limit = 200, before = null} = {}) => db.query(`select id, actor_user_id, team_id, action, target_type, target_id, outcome, severity, classification, correlation_id, metadata_json, created_at
  from voxa.audit_events where ($1::timestamptz is null or created_at < $1) order by created_at desc limit $2`, [before, Math.min(Math.max(1, limit), 500)]);
