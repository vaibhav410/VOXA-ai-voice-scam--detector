// Authenticated API (PRD section 6) + the gate for the existing analysis routes.
// Every protected route: verified identity -> active account -> rate limit -> server-side permission check.
// Missing and forbidden reports both return 404, so ids cannot be probed. State changes are audited.
import {createAudit, hashIp, safeLogger} from './audit.mjs';
import {createLimiter, LIMITS} from './ratelimit.mjs';
import * as repo from './repo.mjs';
import {canReadAnalysis, canModifyAnalysis, canShareToTeam, canViewTeam, canManageTeam, canReadAudit, grantableRole, teamRole} from './rbac.mjs';
import {sanitizeReport} from './reports.mjs';
import {scanText} from './privacy.mjs';
import {publicConfig} from './config.mjs';
import {dbHealth} from './db.mjs';
import {DEMO_IDENTITY} from './auth.mjs';

const REVIEW = ['open', 'investigating', 'resolved', 'fp'];
const ROUTES = [
  ['GET', /^\/api\/auth\/config$/, 'authConfig', {public: true}],
  ['GET', /^\/api\/auth\/me$/, 'me', {db: false}],
  ['GET', /^\/api\/reports$/, 'listReports'],
  ['POST', /^\/api\/reports$/, 'createReport'],
  ['GET', /^\/api\/reports\/([^/]+)$/, 'getReport'],
  ['PATCH', /^\/api\/reports\/([^/]+)$/, 'patchReport'],
  ['DELETE', /^\/api\/reports\/([^/]+)$/, 'deleteReport'],
  ['GET', /^\/api\/teams$/, 'myTeams'],
  ['POST', /^\/api\/teams$/, 'createTeam'],
  ['GET', /^\/api\/teams\/([^/]+)\/members$/, 'teamMembers'],
  ['GET', /^\/api\/teams\/([^/]+)\/stats$/, 'teamStats'],
  ['PATCH', /^\/api\/teams\/([^/]+)$/, 'renameTeam'],
  ['POST', /^\/api\/teams\/([^/]+)\/invitations$/, 'invite'],
  ['PATCH', /^\/api\/teams\/([^/]+)\/members\/([^/]+)\/role$/, 'setRole'],
  ['DELETE', /^\/api\/teams\/([^/]+)\/members\/([^/]+)$/, 'removeMember'],
  ['POST', /^\/api\/invitations\/accept$/, 'acceptInvite'],
  ['GET', /^\/api\/admin\/audit-events$/, 'auditEvents'],
  ['POST', /^\/api\/privacy\/scan$/, 'privacyScan', {group: 'privacy', db: 'optional'}],
  ['GET', /^\/api\/me\/preferences$/, 'getPrefs'],
  ['PUT', /^\/api\/me\/preferences$/, 'putPrefs'],
  ['GET', /^\/api\/me\/export$/, 'exportMe'],
  ['POST', /^\/api\/me\/deletion-requests$/, 'deleteMe']
];

export function createApi({cfg, db, auth, logger = safeLogger()}) {
  const audit = createAudit(db, logger);
  const allow = createLimiter();
  let health = db ? null : {configured: false};
  const ready = async (force = false) => { if (!db) return false; if (force || !health?.schemaCurrent) health = await dbHealth(db); return Boolean(health.reachable && health.schemaCurrent); };
  const ipOf = req => req.socket?.remoteAddress || '';
  // Daily provider quota (per user and in total). Counted when a provider-backed request is let through.
  let quotaDay = '', quotaUsers = new Map(), quotaTotal = 0;
  function takeQuota(subject) {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== quotaDay) { quotaDay = day; quotaUsers = new Map(); quotaTotal = 0; }
    const q = cfg.quotas || {perUser: 20, total: 200}, used = quotaUsers.get(subject) || 0;
    if (quotaTotal >= q.total) return 'total';
    if (used >= q.perUser) return 'user';
    quotaUsers.set(subject, used + 1); quotaTotal++;
    return null;
  }

  async function readJson(req, h, max = cfg.limits.jsonKB * 1024) {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) { h.fail(415, 'JSON_REQUIRED', 'Send JSON.'); return undefined; }
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > max) { h.fail(413, 'TOO_LARGE', 'Request body is too large.'); return undefined; } chunks.push(c); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { h.fail(400, 'BAD_JSON', 'Malformed JSON.'); return undefined; }
  }

  async function identify(req, h) {
    if (cfg.auth.mode === 'demo') return DEMO_IDENTITY;
    const id = await auth.identify(req);
    if (!id) { h.fail(401, 'UNAUTHENTICATED', 'Sign in to continue.'); return null; }
    if (id.invalid) {
      const ipHash = hashIp(ipOf(req)), burst = !allow('authfail:' + ipHash, ...LIMITS.authFail);
      await audit({action: burst ? 'auth.failure_burst' : 'auth.failed', outcome: 'denied', severity: burst ? 'medium' : 'low', classification: burst ? 'suspicious' : 'security_event', correlationId: h.cid, metadata: {ipHash, reason: 'invalid_or_expired_token'}});
      h.fail(401, 'UNAUTHENTICATED', 'Your session is invalid or has expired. Sign in again.');
      return null;
    }
    return id;
  }
  async function principal(id, h) {
    if (!db) { h.fail(503, 'DB_NOT_CONFIGURED', 'The database is not configured on this server, so accounts, teams and server-side history are off. Reports stay in this browser.'); return null; }
    if (!(await ready())) { h.fail(503, 'SCHEMA_NOT_READY', 'The database schema is not up to date. Run: npm run db:migrate'); return null; }
    const p = await repo.loadPrincipal(db, await repo.upsertUser(db, id));
    if (p.status !== 'active') { h.fail(403, 'ACCOUNT_DISABLED', 'This account is disabled.'); return null; }
    return p;
  }
  const deny = async (h, user, action, targetType, targetId, extra = {}) => audit({actorUserId: user?.id, action, targetType, targetId, outcome: 'denied', severity: extra.severity || 'low', classification: extra.classification || 'security_event', correlationId: h.cid, metadata: extra.metadata || {}});
  const reportOut = (a, user) => ({id: a.id, clientRef: a.client_ref, reportType: a.report_type, modality: a.modality, status: a.status, reviewStatus: a.review_status, title: a.title, sector: a.sector, policyVersion: a.policy_version,
    uploadRef: a.upload_ref, teamId: a.team_id, mine: a.owner_user_id === user.id, hasTranscript: Boolean(a.has_transcript), createdAt: a.created_at, expiresAt: a.expires_at, summary: a.summary_json});
  const notFound = h => h.fail(404, 'NOT_FOUND', 'Not found.');

  const handlers = {
    async authConfig(req, h) { h.json(200, publicConfig(cfg)); },

    async me(req, h, m, id) {
      if (!db) return h.json(200, {authMode: cfg.auth.mode, database: false, user: {email: id.email || null, displayName: id.name || null, isSuperAdmin: false}, teams: []});
      const u = await principal(id, h); if (!u) return;
      h.json(200, {authMode: cfg.auth.mode, database: true, user: {id: u.id, email: u.email, displayName: u.displayName, isSuperAdmin: u.isSuperAdmin}, teams: u.memberships.map(x => ({id: x.team_id, name: x.name, role: x.role})), preferences: await repo.getPreferences(db, u.id)});
    },

    async listReports(req, h, m, id, u, url) {
      const type = url.searchParams.get('type'), before = url.searchParams.get('before');
      const rows = await repo.listAnalyses(db, u, {limit: Number(url.searchParams.get('limit')) || 100, reportType: type || null, before: before && !isNaN(Date.parse(before)) ? new Date(before) : null});
      h.json(200, {reports: rows.map(a => reportOut(a, u))});
    },
    async createReport(req, h, m, id, u) {
      const body = await readJson(req, h); if (body === undefined) return;
      const prefs = await repo.getPreferences(db, u.id);
      const retain = body.retainTranscript === true && prefs.transcript_retention_opt_in === true;
      const s = sanitizeReport(body.report, {retainTranscript: retain});
      if (s.error) return h.fail(400, 'INVALID_REPORT', s.error);
      let teamId = null;
      if (body.teamId) {
        if (!canShareToTeam(u, body.teamId)) { await deny(h, u, 'report.share_denied', 'team', body.teamId); return h.fail(403, 'FORBIDDEN', 'You are not a member of that team.'); }
        teamId = body.teamId;
      }
      const r = await repo.createAnalysis(db, u, s.value, {teamId, cfg, ring: cfg.ring, retainTranscript: retain});
      if (r.created) await audit({actorUserId: u.id, teamId, action: 'report.created', targetType: 'analysis', targetId: r.id, correlationId: h.cid, metadata: {reportType: s.value.reportType, modality: s.value.modality}});
      h.json(r.created ? 201 : 200, {id: r.id, created: r.created, transcript: !s.value.sensitiveAvailable ? 'none' : s.value.sensitive ? (r.transcriptNote || 'retained') : 'not_retained'});
    },
    async getReport(req, h, m, id, u) {
      const a = await repo.getAnalysis(db, m[1]);
      if (!a) return notFound(h);
      if (!canReadAnalysis(u, a)) { await deny(h, u, 'report.access_denied', 'analysis', a.id); return notFound(h); }
      const d = await repo.analysisDetail(db, a, cfg.ring);
      h.json(200, {...reportOut(a, u), findings: d.findings, providerRuns: d.providerRuns, transcript: d.sensitive, transcriptError: d.sensitiveError});
    },
    async patchReport(req, h, m, id, u) {
      const body = await readJson(req, h); if (body === undefined) return;
      if (!REVIEW.includes(body.reviewStatus)) return h.fail(400, 'INVALID_STATUS', 'reviewStatus must be open, investigating, resolved or fp.');
      const a = await repo.getAnalysis(db, m[1]);
      if (!a || !canModifyAnalysis(u, a)) { if (a) await deny(h, u, 'report.modify_denied', 'analysis', a.id); return notFound(h); }
      await repo.setReviewStatus(db, a.id, body.reviewStatus);
      await audit({actorUserId: u.id, teamId: a.team_id, action: 'report.status_changed', targetType: 'analysis', targetId: a.id, correlationId: h.cid, metadata: {status: body.reviewStatus}});
      h.json(200, {id: a.id, reviewStatus: body.reviewStatus});
    },
    async deleteReport(req, h, m, id, u) {
      const a = await repo.getAnalysis(db, m[1]);
      if (!a || !canModifyAnalysis(u, a)) { if (a) await deny(h, u, 'report.delete_denied', 'analysis', a.id); return notFound(h); }
      await repo.deleteAnalysis(db, a.id);
      await audit({actorUserId: u.id, teamId: a.team_id, action: 'report.deleted', targetType: 'analysis', targetId: a.id, correlationId: h.cid, metadata: {reportType: a.report_type}});
      h.json(200, {deleted: true});
    },

    async myTeams(req, h, m, id, u) { h.json(200, {teams: u.memberships.map(x => ({id: x.team_id, name: x.name, role: x.role}))}); },
    async createTeam(req, h, m, id, u) {
      const body = await readJson(req, h); if (body === undefined) return;
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (name.length < 1 || name.length > 80) return h.fail(400, 'INVALID_NAME', 'Team name must be 1-80 characters.');
      const t = await repo.createTeam(db, u, name);
      await audit({actorUserId: u.id, teamId: t.id, action: 'team.created', targetType: 'team', targetId: t.id, correlationId: h.cid});
      h.json(201, {id: t.id, name: t.name, role: 'admin'});
    },
    async teamMembers(req, h, m, id, u) {
      const t = await repo.getTeam(db, m[1]);
      if (!t || !canViewTeam(u, t.id)) { if (t) await deny(h, u, 'team.view_denied', 'team', t.id); return notFound(h); }
      h.json(200, {team: {id: t.id, name: t.name}, yourRole: teamRole(u, t.id), members: (await repo.teamMembers(db, t.id)).map(x => ({userId: x.user_id, displayName: x.display_name, email: x.email, role: x.role, joinedAt: x.joined_at}))});
    },
    async teamStats(req, h, m, id, u) {
      const t = await repo.getTeam(db, m[1]);
      if (!t || !canViewTeam(u, t.id)) { if (t) await deny(h, u, 'team.view_denied', 'team', t.id); return notFound(h); }
      h.json(200, {...(await repo.teamStats(db, t.id)), yourRole: teamRole(u, t.id)});
    },
    async renameTeam(req, h, m, id, u) {
      const body = await readJson(req, h); if (body === undefined) return;
      const t = await repo.getTeam(db, m[1]);
      if (!t || !canViewTeam(u, t.id)) { if (t) await deny(h, u, 'team.rename_denied', 'team', t.id); return notFound(h); }
      if (!canManageTeam(u, t.id)) { await deny(h, u, 'team.rename_denied', 'team', t.id); return h.fail(403, 'FORBIDDEN', 'Only a team admin can rename the team.'); }
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (name.length < 1 || name.length > 80) return h.fail(400, 'INVALID_NAME', 'Team name must be 1-80 characters.');
      const r = await repo.renameTeam(db, t.id, name);
      await audit({actorUserId: u.id, teamId: t.id, action: 'team.renamed', targetType: 'team', targetId: t.id, correlationId: h.cid});
      h.json(200, r);
    },
    async invite(req, h, m, id, u) {
      const body = await readJson(req, h); if (body === undefined) return;
      const t = await repo.getTeam(db, m[1]);
      if (!t || !canViewTeam(u, t.id)) { if (t) await deny(h, u, 'invitation.denied', 'team', t.id); return notFound(h); }
      if (!canManageTeam(u, t.id)) { await deny(h, u, 'invitation.denied', 'team', t.id); return h.fail(403, 'FORBIDDEN', 'Only a team admin can invite members.'); }
      const role = grantableRole(body.role);
      if (!role) { await deny(h, u, 'privilege_escalation_attempt', 'team', t.id, {severity: 'medium', classification: 'suspicious', metadata: {role: String(body.role || '')}}); return h.fail(400, 'INVALID_ROLE', 'Role must be admin or user.'); }
      const email = repo.normEmail(body.email);
      if (!email) return h.fail(400, 'INVALID_EMAIL', 'Enter a valid email address.');
      const inv = await repo.createInvitation(db, {teamId: t.id, email, role, invitedBy: u.id});
      await audit({actorUserId: u.id, teamId: t.id, action: 'invitation.created', targetType: 'invitation', targetId: inv.id, correlationId: h.cid, metadata: {role, emailDomain: email.split('@')[1]}});
      // The token is returned once and never stored in plain form; share the link with the invitee.
      h.json(201, {invitationId: inv.id, expiresAt: inv.expires_at, token: inv.token, acceptPath: '/app.html#/invite/' + inv.token});
    },
    async setRole(req, h, m, id, u) {
      const body = await readJson(req, h); if (body === undefined) return;
      const t = await repo.getTeam(db, m[1]);
      if (!t || !canViewTeam(u, t.id)) { if (t) await deny(h, u, 'member.role_denied', 'team', t.id); return notFound(h); }
      if (!canManageTeam(u, t.id)) { await deny(h, u, 'member.role_denied', 'team', t.id); return h.fail(403, 'FORBIDDEN', 'Only a team admin can change roles.'); }
      const role = grantableRole(body.role);
      if (!role) { await deny(h, u, 'privilege_escalation_attempt', 'team', t.id, {severity: 'medium', classification: 'suspicious', metadata: {role: String(body.role || '')}}); return h.fail(400, 'INVALID_ROLE', 'Role must be admin or user. Global roles cannot be granted through the API.'); }
      if (!repo.isUuid(m[2])) return notFound(h);
      const r = await repo.setMemberRole(db, t.id, m[2], role);
      if (r.error === 'NOT_MEMBER') return notFound(h);
      if (r.error === 'LAST_ADMIN') return h.fail(409, 'LAST_ADMIN', 'A team needs at least one admin. Make someone else admin first.');
      await audit({actorUserId: u.id, teamId: t.id, action: 'member.role_changed', targetType: 'user', targetId: m[2], correlationId: h.cid, metadata: {role, previousRole: r.previous}});
      h.json(200, {userId: m[2], role});
    },
    async removeMember(req, h, m, id, u) {
      const t = await repo.getTeam(db, m[1]);
      if (!t || !canViewTeam(u, t.id) || !repo.isUuid(m[2])) { if (t) await deny(h, u, 'member.remove_denied', 'team', t.id); return notFound(h); }
      if (m[2] !== u.id && !canManageTeam(u, t.id)) { await deny(h, u, 'member.remove_denied', 'team', t.id); return h.fail(403, 'FORBIDDEN', 'Only a team admin can remove other members.'); }
      const r = await repo.removeMember(db, t.id, m[2]);
      if (r.error === 'NOT_MEMBER') return notFound(h);
      if (r.error === 'LAST_ADMIN') return h.fail(409, 'LAST_ADMIN', 'A team needs at least one admin.');
      await audit({actorUserId: u.id, teamId: t.id, action: 'member.removed', targetType: 'user', targetId: m[2], correlationId: h.cid});
      h.json(200, {removed: true});
    },
    async acceptInvite(req, h, m, id, u) {
      const body = await readJson(req, h); if (body === undefined) return;
      const r = await repo.acceptInvitation(db, u, body.token);
      const map = {INVALID: [404, 'Invitation not found.'], USED: [409, 'This invitation was already used.'], EXPIRED: [410, 'This invitation has expired. Ask for a new one.'], EMAIL_MISMATCH: [403, 'This invitation was sent to a different email address.']};
      if (r.error) { await deny(h, u, 'invitation.accept_denied', 'invitation', null, {metadata: {reason: r.error}}); return h.fail(map[r.error][0], r.error, map[r.error][1]); }
      await audit({actorUserId: u.id, teamId: r.teamId, action: 'invitation.accepted', targetType: 'team', targetId: r.teamId, correlationId: h.cid, metadata: {role: r.role}});
      h.json(200, {teamId: r.teamId, role: r.role});
    },
    async auditEvents(req, h, m, id, u, url) {
      if (!canReadAudit(u)) { await deny(h, u, 'admin.audit_denied', 'audit', null); return h.fail(403, 'FORBIDDEN', 'Only a super admin can read audit events.'); }
      const before = url.searchParams.get('before');
      const rows = await repo.listAudit(db, {limit: Number(url.searchParams.get('limit')) || 200, before: before && !isNaN(Date.parse(before)) ? new Date(before) : null});
      await audit({actorUserId: u.id, action: 'admin.audit_viewed', targetType: 'audit', correlationId: h.cid, metadata: {count: rows.length}});
      h.json(200, {events: rows});
    },
    async privacyScan(req, h, m, id, u) {
      const body = await readJson(req, h, 96 * 1024); if (body === undefined) return;
      if (body.consent !== true) return h.fail(428, 'CONSENT_REQUIRED', 'Confirm you are allowed to scan this text.');
      if (typeof body.text !== 'string' || !body.text.trim()) return h.fail(400, 'TEXT_REQUIRED', 'Paste the text to scan.');
      const scan = scanText(body.text);
      if (scan.error) return h.fail(413, scan.error, scan.message);
      let saved = null;
      if (body.save === true && !u) return h.fail(503, 'DB_NOT_CONFIGURED', 'Saving needs the database. The scan itself works without it.');
      if (body.save === true) {
        const prefs = await repo.getPreferences(db, u.id);
        const retain = body.retainTranscript === true && prefs.transcript_retention_opt_in === true;
        const s = sanitizeReport({id: body.clientRef, reportType: 'privacy_analysis', at: Date.now(), title: body.title, state: 'complete', privacy: {...scan, redactedText: scan.redactedText}, limitations: scan.limitations.join(' ')}, {retainTranscript: retain});
        if (s.error) return h.fail(400, 'INVALID_REPORT', s.error);
        const r = await repo.createAnalysis(db, u, s.value, {cfg, ring: cfg.ring, retainTranscript: retain});
        saved = {id: r.id, transcript: !s.value.sensitiveAvailable ? 'none' : s.value.sensitive ? (r.transcriptNote || 'retained') : 'not_retained'};
        await audit({actorUserId: u.id, action: 'report.created', targetType: 'analysis', targetId: r.id, correlationId: h.cid, metadata: {reportType: 'privacy_analysis', categories: Object.keys(scan.counts)}});
      }
      h.json(200, {scan, saved});
    },
    async getPrefs(req, h, m, id, u) { h.json(200, await repo.getPreferences(db, u.id)); },
    async putPrefs(req, h, m, id, u) {
      const body = await readJson(req, h); if (body === undefined) return;
      const before = await repo.getPreferences(db, u.id);
      const p = await repo.setPreferences(db, u.id, {locale: typeof body.locale === 'string' ? body.locale.slice(0, 16) : null, retentionOptIn: body.retentionOptIn === true, transcriptRetentionOptIn: body.transcriptRetentionOptIn === true});
      if (before.retention_opt_in !== p.retention_opt_in || before.transcript_retention_opt_in !== p.transcript_retention_opt_in) await audit({actorUserId: u.id, action: 'retention.changed', targetType: 'user', targetId: u.id, correlationId: h.cid, metadata: {retention: p.retention_opt_in, transcriptRetention: p.transcript_retention_opt_in}});
      h.json(200, p);
    },
    async exportMe(req, h, m, id, u) {
      const data = await repo.exportUserData(db, u);
      await audit({actorUserId: u.id, action: 'data.exported', targetType: 'user', targetId: u.id, correlationId: h.cid, metadata: {count: data.analyses.length}});
      h.json(200, data, {'Content-Disposition': 'attachment; filename="voxa-my-data.json"'});
    },
    async deleteMe(req, h, m, id, u) {
      const body = await readJson(req, h); if (body === undefined) return;
      if (body.scope !== 'all_my_data' || body.confirm !== 'DELETE') return h.fail(400, 'CONFIRM_REQUIRED', 'Send {"scope":"all_my_data","confirm":"DELETE"} to erase your VOXA data.');
      const r = await repo.deleteAllMyData(db, u);
      if (r.error === 'LAST_ADMIN') return h.fail(409, 'LAST_ADMIN', `You are the only admin of: ${r.teams.join(', ')}. Make someone else admin, or remove the other members, first.`);
      await audit({actorUserId: u.id, action: 'deletion.completed', targetType: 'user', targetId: u.id, correlationId: h.cid, metadata: {scope: 'all_my_data', count: r.analysesDeleted}});
      h.json(200, {...r, note: 'Your VOXA data was erased. Your sign-in account itself is managed by Clerk: delete it from your Clerk account settings. Minimized security audit records are kept for up to 365 days.'});
    }
  };

  return {
    ready,
    health: async () => (db ? (health = await dbHealth(db)) : {configured: false}),
    // New API routes. Returns true when the request was handled.
    async handle(req, res, url, h) {
      const route = ROUTES.find(([method, re]) => re.test(url.pathname) && method === req.method);
      if (!route) {
        if (ROUTES.some(([, re]) => re.test(url.pathname))) { h.fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'); return true; }
        return false;
      }
      const [method, re, name, opt = {}] = route, m = url.pathname.match(re);
      if (opt.public) { await handlers[name](req, h, m); return true; }
      if (method !== 'GET' && (req.headers['x-voxa-request'] !== '1' || !(req.headers.origin === url.origin || cfg.origins.includes(req.headers.origin)))) { h.fail(403, 'FORBIDDEN', 'Open VOXA on this server to make changes.'); return true; }
      const id = await identify(req, h); if (!id) return true;
      if (opt.db === false) { await handlers[name](req, h, m, id, null, url); return true; }
      // db 'optional': works without a database (e.g. a local privacy scan); saving still needs one.
      const u = opt.db === 'optional' && !(db && (await ready())) ? null : await principal(id, h);
      if (!u && opt.db !== 'optional') return true;
      if (!allow(`${opt.group || 'api'}:${u?.id || id.subject}`, ...LIMITS[opt.group || 'api'])) { await deny(h, u, 'rate_limited', 'route', name, {severity: 'low', classification: 'suspicious', metadata: {route: name}}); h.fail(429, 'RATE_LIMITED', 'Too many requests. Wait a minute and try again.'); return true; }
      await handlers[name](req, h, m, id, u, url);
      return true;
    },
    // Gate in front of the existing analysis routes. Demo mode keeps the original local-only behaviour.
    async guard(req, url, h, {providers = false, group = 'analyze'} = {}) {
      if (cfg.auth.mode === 'demo') return DEMO_IDENTITY;
      const id = await identify(req, h); if (!id) return null;
      if (!allow(`${group}:${id.subject}`, ...LIMITS[group])) { h.fail(429, 'RATE_LIMITED', 'Too many requests. Wait a minute and try again.'); return null; }
      if (providers && cfg.auth.requireProviderConsent && req.headers['x-voxa-provider-consent'] !== '1') { h.fail(428, 'CONSENT_REQUIRED', 'Confirm consent to send this media to the selected providers.'); return null; }
      if (providers) {
        const over = takeQuota(id.subject);
        if (over) { await audit({action: 'provider.quota_exceeded', outcome: 'denied', severity: over === 'total' ? 'medium' : 'low', classification: 'suspicious', correlationId: h.cid, metadata: {reason: over}}); h.fail(429, 'DAILY_LIMIT', over === 'total' ? 'This VOXA server has reached its daily analysis limit. Try again tomorrow.' : 'You have reached your daily analysis limit. Try again tomorrow.'); return null; }
      }
      if (providers && db && (await ready())) {
        try { const u = await repo.loadPrincipal(db, await repo.upsertUser(db, id)); await audit({actorUserId: u.id, action: 'provider.dispatch', targetType: 'route', targetId: url.pathname, correlationId: h.cid, metadata: {route: url.pathname, modality: url.searchParams.get('modality') || undefined}}); } catch {}
      }
      return id;
    }
  };
}
