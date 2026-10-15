// Backend, database, auth/RBAC and privacy tests (PRD section 10 + v1.1 section 14).
// Real PostgreSQL semantics via PGlite (in memory); Clerk verification is stubbed with fixed test tokens.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
process.env.TEMP = process.env.TMP = process.env.TMPDIR = mkdtempSync(path.join(tmpdir(), 'voxa-test-'));
import {createServer} from '../server.mjs';
import * as configModule from '../server/config.mjs';
const {loadConfig} = configModule;
import {createAuth} from '../server/auth.mjs';
import {openDb, migrate, migrationStatus} from '../server/db.mjs';
import {encrypt, decrypt, parseKeyring, newKey, DecryptionFailed, EncryptionUnavailable} from '../server/crypto.mjs';
import {grantSuperAdmin, purgeExpired} from '../server/repo.mjs';
import {scanText, verhoeffValid} from '../server/privacy.mjs';
import {safeLogger, safeMetadata} from '../server/audit.mjs';
import {ffmpegPath} from '../server/media.mjs';
import {toWav, whiteNoise} from '../tools/noise-fixtures.mjs';

const PK = 'pk_test_' + Buffer.from('example-test.clerk.accounts.dev$').toString('base64');
const SK = 'sk_test_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const KEY = newKey();
const TOK = {alice: 'tok_alice_0123456789abcdef', bob: 'tok_bob_0123456789abcdef00', carol: 'tok_carol_0123456789abcdef', dave: 'tok_dave_0123456789abcdef0'};
const PEOPLE = {
  [TOK.alice]: {sub: 'user_alice', email: 'alice@example.com', name: 'Alice'},
  [TOK.bob]: {sub: 'user_bob', email: 'bob@example.com', name: 'Bob'},
  [TOK.carol]: {sub: 'user_carol', email: 'carol@example.com', name: 'Carol'},
  [TOK.dave]: {sub: 'user_dave', email: 'dave@example.com', name: 'Dave'}
};

async function setup(t, envExtra = {}, {fetcher} = {}) {
  const cfg = loadConfig({AUTH_MODE: 'clerk', CLERK_SECRET_KEY: SK, CLERK_PUBLISHABLE_KEY: PK, ...envExtra});
  assert.deepEqual(cfg.errors, [], 'test config must be valid');
  const db = await openDb({kind: 'memory'}); await migrate(db);
  const logLines = [], logger = safeLogger(l => logLines.push(l));
  const auth = createAuth(cfg, {
    verify: async token => { const p = PEOPLE[token]; if (!p) throw new Error('invalid'); return {sub: p.sub, sid: 'sess_' + p.sub}; },
    fetchProfile: async sub => { const p = Object.values(PEOPLE).find(x => x.sub === sub); return {email: p.email, emailVerified: true, name: p.name}; }
  });
  const calls = [];
  const s = createServer({sealedrose: 'sr_test_key_should_never_leak'}, async (u, o) => { calls.push(String(u)); return fetcher ? fetcher(u, o) : Response.json({aiGenerated: false, confidence: 0.9}); }, {cfg, db, auth, logger});
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  t.after(async () => { s.close(); await db.close(); });
  const base = `http://127.0.0.1:${s.address().port}`;
  const call = async (method, p, {token, body, headers = {}} = {}) => {
    const r = await fetch(base + p, {method, headers: {Origin: base, 'X-Voxa-Request': '1', ...(token ? {Authorization: 'Bearer ' + token} : {}), ...(body !== undefined ? {'Content-Type': 'application/json'} : {}), ...headers}, body: body !== undefined ? JSON.stringify(body) : undefined});
    const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch {}
    return {status: r.status, data, text};
  };
  return {cfg, db, call, base, calls, logLines};
}
const report = (id, extra = {}) => ({id, reportType: 'voice_authenticity', modality: 'voice', at: Date.now(), state: 'complete', status: 'open', priority: 'high', sector: 'finance', policyVersion: 'finance-1.0.0',
  media: {name: 'call.wav', size: 1000, duration: 12, mime: 'audio/wav'},
  intent: {status: 'ok', score: 6, words: 20, rules: [{id: 'otp', label: 'OTP request', weight: 3, excerpt: 'please share the OTP 482913 now'}]},
  authenticity: {status: 'ok', provider: 'sealedrose', code: 'NOT_FLAGGED', confidence: 0.8, aiScore: null},
  transcript: {text: 'SECRET-TRANSCRIPT please share the OTP 482913 now', source: 'deepgram'}, notes: [{at: 1, text: 'analyst private note'}], ...extra});

// ---------------------------------------------------------------- database
test('migrations: clean database, idempotent re-run, RLS on every table, constraints enforced', async () => {
  const db = await openDb({kind: 'memory'});
  assert.deepEqual(await migrate(db), ['20261015120000_voxa_core', '20261015130000_voxa_app_role']);
  assert.deepEqual(await migrate(db), [], 'second run applies nothing');
  assert.deepEqual((await migrationStatus(db)).pending, []);
  const tables = await db.query("select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'voxa' and c.relkind = 'r'");
  assert.equal(tables.length, 12); assert.ok(tables.every(x => x.relrowsecurity), 'RLS on every table');
  const [u] = await db.query("insert into voxa.users (auth_subject) values ('x') returning id");
  await assert.rejects(db.query("insert into voxa.global_roles (user_id, role) values ($1, 'admin')", [u.id]));
  const [tm] = await db.query("insert into voxa.teams (name) values ('t') returning id");
  await assert.rejects(db.query("insert into voxa.team_memberships (team_id, user_id, role) values ($1, $2, 'super_admin')", [tm.id, u.id]));
  const [ev] = await db.query("insert into voxa.audit_events (action, outcome) values ('x', 'success') returning id");
  await assert.rejects(db.query("update voxa.audit_events set action = 'y' where id = $1", [ev.id]), /append-only/);
  await db.close();
});

// ---------------------------------------------------------------- authentication
test('unauthenticated or invalid-token requests cannot reach protected data, admin routes or analysis', async t => {
  const {call} = await setup(t);
  for (const [m, p] of [['GET', '/api/reports'], ['GET', '/api/auth/me'], ['GET', '/api/admin/audit-events'], ['GET', '/api/me/export'], ['POST', '/api/teams'], ['POST', '/api/analyze?modality=voice&provider=auto'], ['POST', '/api/noise'], ['POST', '/api/transcribe?modality=voice&textProvider=deepgram']]) {
    assert.equal((await call(m, p, m === 'POST' && p === '/api/teams' ? {body: {name: 'x'}} : {})).status, 401, `${m} ${p} without token`);
    assert.equal((await call(m, p, {token: 'tok_not_a_real_session_123'})).status, 401, `${m} ${p} with invalid token`);
  }
  assert.equal((await call('GET', '/api/auth/config')).status, 200, 'public config stays public');
  assert.equal((await call('GET', '/api/auth/config')).data.clerkPublishableKey, PK);
  assert.ok(!JSON.stringify((await call('GET', '/api/auth/config')).data).includes('sk_'), 'no secret in public config');
});
test('identity comes from the verified token, never the body; signup creates a plain user with no roles', async t => {
  const {call} = await setup(t);
  const me = await call('GET', '/api/auth/me', {token: TOK.alice});
  assert.equal(me.status, 200); assert.equal(me.data.user.email, 'alice@example.com');
  assert.equal(me.data.user.isSuperAdmin, false); assert.deepEqual(me.data.teams, []);
  const r = await call('POST', '/api/reports', {token: TOK.alice, body: {report: report('INC-A1'), owner: 'user_bob', role: 'super_admin', isSuperAdmin: true}});
  assert.equal(r.status, 201);
  assert.equal((await call('GET', '/api/auth/me', {token: TOK.alice})).data.user.isSuperAdmin, false, 'body fields cannot grant roles');
  assert.equal((await call('GET', '/api/reports', {token: TOK.bob})).data.reports.length, 0, 'owner comes from the token');
});
test('state-changing calls need the app header and same origin (CSRF guard)', async t => {
  const {base} = await setup(t);
  const r = await fetch(base + '/api/teams', {method: 'POST', headers: {Authorization: 'Bearer ' + TOK.alice, 'Content-Type': 'application/json', Origin: 'https://evil.example'}, body: '{"name":"x"}'});
  assert.equal(r.status, 403);
});

// ---------------------------------------------------------------- report isolation
test('user B cannot read, change, export or delete user A\'s report by guessing its id', async t => {
  const {call, db} = await setup(t);
  const {data: {id}} = await call('POST', '/api/reports', {token: TOK.alice, body: {report: report('INC-A2')}});
  assert.equal((await call('GET', '/api/reports/' + id, {token: TOK.alice})).status, 200);
  assert.equal((await call('GET', '/api/reports/' + id, {token: TOK.bob})).status, 404);
  assert.equal((await call('PATCH', '/api/reports/' + id, {token: TOK.bob, body: {reviewStatus: 'resolved'}})).status, 404);
  assert.equal((await call('DELETE', '/api/reports/' + id, {token: TOK.bob})).status, 404);
  assert.equal((await call('GET', '/api/reports', {token: TOK.bob})).data.reports.length, 0);
  assert.equal((await call('GET', '/api/me/export', {token: TOK.bob})).data.analyses.length, 0);
  assert.equal((await call('GET', '/api/reports/not-a-uuid', {token: TOK.bob})).status, 404);
  const [still] = await db.query('select review_status from voxa.analyses where id = $1', [id]);
  assert.equal(still.review_status, 'open', 'B\'s attempts changed nothing');
  const denials = await db.query("select action from voxa.audit_events where outcome = 'denied' and action like 'report.%'");
  assert.ok(denials.length >= 3, 'denials are audited');
});
test('stored report holds no transcript, excerpts, notes or provider keys; unavailable scores stay null', async t => {
  const {call, db} = await setup(t);
  const {data} = await call('POST', '/api/reports', {token: TOK.alice, body: {report: report('INC-A3')}});
  assert.equal(data.transcript, 'not_retained');
  const rows = JSON.stringify(await db.query('select * from voxa.analyses')) + JSON.stringify(await db.query('select * from voxa.findings')) + JSON.stringify(await db.query('select * from voxa.provider_runs'));
  for (const bad of ['SECRET-TRANSCRIPT', '482913', 'analyst private note', 'sr_test_key_should_never_leak']) assert.ok(!rows.includes(bad), 'leaked: ' + bad);
  const [f] = await db.query("select score from voxa.findings where finding_type = 'authenticity'");
  assert.equal(f.score, null, 'unavailable score is null, not 0');
});

// ---------------------------------------------------------------- teams and roles
test('team sharing: members can read team reports; only owner/team admin can delete', async t => {
  const {call} = await setup(t);
  const team = (await call('POST', '/api/teams', {token: TOK.alice, body: {name: 'Fraud desk'}})).data;
  const inv = (await call('POST', `/api/teams/${team.id}/invitations`, {token: TOK.alice, body: {email: 'bob@example.com', role: 'user'}})).data;
  assert.equal((await call('POST', '/api/invitations/accept', {token: TOK.bob, body: {token: inv.token}})).status, 200);
  const {data: {id}} = await call('POST', '/api/reports', {token: TOK.alice, body: {report: report('INC-T1'), teamId: team.id}});
  assert.equal((await call('GET', '/api/reports/' + id, {token: TOK.bob})).status, 200, 'team member reads shared report');
  assert.equal((await call('DELETE', '/api/reports/' + id, {token: TOK.bob})).status, 404, 'plain member cannot delete');
  assert.equal((await call('GET', '/api/reports/' + id, {token: TOK.carol})).status, 404, 'outsider cannot read');
  assert.equal((await call('POST', '/api/reports', {token: TOK.carol, body: {report: report('INC-C1'), teamId: team.id}})).status, 403, 'cannot share into a team you are not in');
});
test('a team admin cannot administer another team', async t => {
  const {call} = await setup(t);
  const x = (await call('POST', '/api/teams', {token: TOK.alice, body: {name: 'X'}})).data;
  const y = (await call('POST', '/api/teams', {token: TOK.carol, body: {name: 'Y'}})).data;
  assert.equal((await call('GET', `/api/teams/${y.id}/members`, {token: TOK.alice})).status, 404);
  assert.equal((await call('POST', `/api/teams/${y.id}/invitations`, {token: TOK.alice, body: {email: 'bob@example.com', role: 'user'}})).status, 404);
  const carolId = (await call('GET', `/api/teams/${y.id}/members`, {token: TOK.carol})).data.members[0].userId;
  assert.equal((await call('PATCH', `/api/teams/${y.id}/members/${carolId}/role`, {token: TOK.alice, body: {role: 'user'}})).status, 404);
  assert.equal((await call('DELETE', `/api/teams/${y.id}/members/${carolId}`, {token: TOK.alice})).status, 404);
  assert.equal((await call('GET', `/api/teams/${x.id}/members`, {token: TOK.alice})).status, 200);
});
test('no API can grant super_admin or an unknown role; attempts are flagged as suspicious', async t => {
  const {call, db} = await setup(t);
  const team = (await call('POST', '/api/teams', {token: TOK.alice, body: {name: 'T'}})).data;
  for (const role of ['super_admin', 'owner', 'ADMIN', '']) assert.equal((await call('POST', `/api/teams/${team.id}/invitations`, {token: TOK.alice, body: {email: 'bob@example.com', role}})).status, 400);
  const aliceId = (await call('GET', `/api/teams/${team.id}/members`, {token: TOK.alice})).data.members[0].userId;
  assert.equal((await call('PATCH', `/api/teams/${team.id}/members/${aliceId}/role`, {token: TOK.alice, body: {role: 'super_admin'}})).status, 400);
  const [g] = await db.query('select count(*)::int as n from voxa.global_roles');
  assert.equal(g.n, 0);
  const sus = await db.query("select count(*)::int as n from voxa.audit_events where action = 'privilege_escalation_attempt' and classification = 'suspicious'");
  assert.equal(sus[0].n, 5);
});
test('a plain member cannot invite or change roles; the last admin cannot be demoted', async t => {
  const {call} = await setup(t);
  const team = (await call('POST', '/api/teams', {token: TOK.alice, body: {name: 'T'}})).data;
  const inv = (await call('POST', `/api/teams/${team.id}/invitations`, {token: TOK.alice, body: {email: 'bob@example.com', role: 'user'}})).data;
  await call('POST', '/api/invitations/accept', {token: TOK.bob, body: {token: inv.token}});
  assert.equal((await call('POST', `/api/teams/${team.id}/invitations`, {token: TOK.bob, body: {email: 'carol@example.com', role: 'admin'}})).status, 403);
  const members = (await call('GET', `/api/teams/${team.id}/members`, {token: TOK.alice})).data.members;
  const alice = members.find(m => m.email === 'alice@example.com').userId;
  assert.equal((await call('PATCH', `/api/teams/${team.id}/members/${alice}/role`, {token: TOK.bob, body: {role: 'user'}})).status, 403);
  assert.equal((await call('PATCH', `/api/teams/${team.id}/members/${alice}/role`, {token: TOK.alice, body: {role: 'user'}})).status, 409, 'last admin');
});
test('invitations: single use, email-bound, expiring; only the token hash is stored', async t => {
  const {call, db} = await setup(t);
  const team = (await call('POST', '/api/teams', {token: TOK.alice, body: {name: 'T'}})).data;
  const inv = (await call('POST', `/api/teams/${team.id}/invitations`, {token: TOK.alice, body: {email: 'bob@example.com', role: 'user'}})).data;
  assert.ok(!JSON.stringify(await db.query('select * from voxa.invitations')).includes(inv.token), 'plain token never stored');
  assert.equal((await call('POST', '/api/invitations/accept', {token: TOK.carol, body: {token: inv.token}})).status, 403, 'wrong email');
  assert.equal((await call('POST', '/api/invitations/accept', {token: TOK.bob, body: {token: inv.token}})).status, 200);
  assert.equal((await call('POST', '/api/invitations/accept', {token: TOK.bob, body: {token: inv.token}})).status, 409, 'single use');
  const inv2 = (await call('POST', `/api/teams/${team.id}/invitations`, {token: TOK.alice, body: {email: 'dave@example.com', role: 'user'}})).data;
  await db.query("update voxa.invitations set expires_at = now() - interval '1 minute' where id = $1", [inv2.invitationId]);
  assert.equal((await call('POST', '/api/invitations/accept', {token: TOK.dave, body: {token: inv2.token}})).status, 410);
});
test('super admin only via the CLI path; audit events readable only by super admin', async t => {
  const {call, db} = await setup(t);
  await call('GET', '/api/auth/me', {token: TOK.alice}); await call('GET', '/api/auth/me', {token: TOK.bob});
  assert.equal((await call('GET', '/api/admin/audit-events', {token: TOK.alice})).status, 403);
  assert.deepEqual(await grantSuperAdmin(db, 'nobody@example.com'), {error: 'NO_SUCH_USER'});
  assert.ok((await grantSuperAdmin(db, 'alice@example.com')).userId);
  const r = await call('GET', '/api/admin/audit-events', {token: TOK.alice});
  assert.equal(r.status, 200); assert.ok(r.data.events.some(e => e.action === 'admin.audit_denied'));
  assert.equal((await call('GET', '/api/admin/audit-events', {token: TOK.bob})).status, 403);
  // super admin does not gain access to other people's personal reports
  const {data: {id}} = await call('POST', '/api/reports', {token: TOK.bob, body: {report: report('INC-B9')}});
  assert.equal((await call('GET', '/api/reports/' + id, {token: TOK.alice})).status, 404);
});

// ---------------------------------------------------------------- encryption and retention
test('AES-256-GCM: round trip, tampering and AAD swaps are rejected, missing key fails closed, rotation works', () => {
  const ring = parseKeyring('k1:' + KEY);
  const c = encrypt(ring, 'hello transcript', 'analysis:1:transcript');
  assert.match(c, /^v1\.k1\./); assert.ok(!c.includes('hello'));
  assert.equal(decrypt(ring, c, 'analysis:1:transcript'), 'hello transcript');
  const parts = c.split('.');
  const flip = s => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
  for (const i of [2, 3, 4]) { const bad = [...parts]; bad[i] = flip(bad[i]); assert.throws(() => decrypt(ring, bad.join('.'), 'analysis:1:transcript'), DecryptionFailed); }
  assert.throws(() => decrypt(ring, c, 'analysis:2:transcript'), DecryptionFailed, 'ciphertext cannot be moved to another row');
  assert.throws(() => encrypt(null, 'x'), EncryptionUnavailable);
  assert.throws(() => decrypt(parseKeyring('k2:' + newKey()), c, 'analysis:1:transcript'), DecryptionFailed, 'unknown key id');
  const rotated = parseKeyring(`k2:${newKey()},k1:${KEY}`, 'k2');
  assert.equal(decrypt(rotated, c, 'analysis:1:transcript'), 'hello transcript', 'old data still readable after rotation');
  assert.match(encrypt(rotated, 'new'), /^v1\.k2\./);
  assert.ok(parseKeyring('k1:' + Buffer.alloc(32, 7).toString('base64')).error, 'weak key refused');
  assert.ok(parseKeyring('k1:' + Buffer.alloc(16, 1).toString('base64')).error, 'short key refused');
});
test('transcripts are stored only when opted in AND encryption is configured; stored form is ciphertext', async t => {
  const {call, db} = await setup(t, {TRANSCRIPT_RETENTION: 'encrypted', VOXA_ENCRYPTION_KEYS: 'k1:' + KEY});
  let r = await call('POST', '/api/reports', {token: TOK.alice, body: {report: report('INC-E1'), retainTranscript: true}});
  assert.equal(r.data.transcript, 'not_retained', 'request alone is not enough without the saved preference');
  await call('PUT', '/api/me/preferences', {token: TOK.alice, body: {retentionOptIn: true, transcriptRetentionOptIn: true}});
  r = await call('POST', '/api/reports', {token: TOK.alice, body: {report: report('INC-E2'), retainTranscript: true}});
  assert.equal(r.data.transcript, 'retained');
  const [row] = await db.query('select transcript_ciphertext from voxa.analyses where id = $1', [r.data.id]);
  assert.match(row.transcript_ciphertext, /^v1\.k1\./); assert.ok(!row.transcript_ciphertext.includes('SECRET'));
  const got = await call('GET', '/api/reports/' + r.data.id, {token: TOK.alice});
  assert.match(got.data.transcript.text, /SECRET-TRANSCRIPT/);
  assert.equal((await db.query("select count(*)::int as n from voxa.audit_events where action = 'retention.changed'"))[0].n, 1);
});
test('config refuses encrypted transcript retention without a key (fail closed)', () => {
  const cfg = loadConfig({AUTH_MODE: 'demo', TRANSCRIPT_RETENTION: 'encrypted'});
  assert.ok(cfg.errors.some(e => /VOXA_ENCRYPTION_KEYS/.test(e)));
});
test('deletion is idempotent and owner-scoped; erase-my-data removes reports and anonymizes the account', async t => {
  const {call, db} = await setup(t);
  const {data: {id}} = await call('POST', '/api/reports', {token: TOK.alice, body: {report: report('INC-D1')}});
  assert.equal((await call('DELETE', '/api/reports/' + id, {token: TOK.alice})).status, 200);
  assert.equal((await call('DELETE', '/api/reports/' + id, {token: TOK.alice})).status, 404, 'second delete is a no-op');
  assert.equal((await db.query('select count(*)::int as n from voxa.findings'))[0].n, 0, 'findings cascade');
  await call('POST', '/api/reports', {token: TOK.alice, body: {report: report('INC-D2')}});
  assert.equal((await call('POST', '/api/me/deletion-requests', {token: TOK.alice, body: {scope: 'all_my_data'}})).status, 400, 'explicit confirmation required');
  const del = await call('POST', '/api/me/deletion-requests', {token: TOK.alice, body: {scope: 'all_my_data', confirm: 'DELETE'}});
  assert.equal(del.status, 200); assert.equal(del.data.analysesDeleted, 1);
  const [u] = await db.query("select email, status from voxa.users where auth_subject = 'user_alice'");
  assert.equal(u.email, null); assert.equal(u.status, 'disabled');
  assert.equal((await call('GET', '/api/reports', {token: TOK.alice})).status, 403, 'disabled account');
});
test('retention purge removes expired reports and expired transcripts', async t => {
  const {call, db} = await setup(t);
  const a = (await call('POST', '/api/reports', {token: TOK.alice, body: {report: report('INC-P1')}})).data.id;
  await call('POST', '/api/reports', {token: TOK.alice, body: {report: report('INC-P2')}});
  await db.query("update voxa.analyses set expires_at = now() - interval '1 second' where id = $1", [a]);
  assert.equal((await call('GET', '/api/reports', {token: TOK.alice})).data.reports.length, 1, 'expired report hidden at once');
  const r = await purgeExpired(db);
  assert.equal(r.analyses, 1);
  assert.equal((await db.query('select count(*)::int as n from voxa.analyses'))[0].n, 1);
});

// ---------------------------------------------------------------- privacy scanner
test('PII scan: consent required, masked evidence, redaction is separate and labelled best-effort', async t => {
  const {call, db} = await setup(t);
  let base = '23456789012', aad = null; for (let d = 0; d < 10; d++) if (verhoeffValid(base + d)) aad = base + d;
  const text = `My aadhaar is ${aad}, phone +91 98765 43210, PAN ABCPE1234F, card 4111 1111 1111 1111. Not PII: 234567890123, 4111 1111 1111 1112.`;
  assert.equal((await call('POST', '/api/privacy/scan', {token: TOK.alice, body: {text}})).status, 428);
  const r = await call('POST', '/api/privacy/scan', {token: TOK.alice, body: {text, consent: true, save: true, clientRef: 'PRV-12345', title: 'Pasted call notes'}});
  assert.equal(r.status, 200);
  const cats = r.data.scan.findings.map(f => f.category).sort();
  assert.deepEqual(cats, ['AADHAAR', 'CARD_NUMBER', 'PAN', 'PHONE']);
  assert.ok(r.data.scan.bestEffort); assert.match(r.data.scan.limitations.join(' '), /not evidence that a data breach/);
  assert.ok(!JSON.stringify(r.data.scan.findings).includes('ABCPE1234F'), 'evidence is masked');
  assert.match(r.data.scan.redactedText, /\[PAN\]/); assert.match(r.data.scan.redactedText, /234567890123/, 'checksum-invalid numbers are left alone');
  assert.equal(r.data.saved.transcript, 'not_retained', 'redacted text exists but is not kept without opt-in');
  const stored = JSON.stringify(await db.query('select * from voxa.analyses')) + JSON.stringify(await db.query('select * from voxa.findings'));
  for (const bad of [aad, 'ABCPE1234F', '98765 43210', '4111 1111 1111 1111']) assert.ok(!stored.includes(bad), 'raw PII stored: ' + bad);
  assert.equal(scanText('x'.repeat(20001)).error, 'TOO_LONG');
});

// ---------------------------------------------------------------- providers, consent, logs
test('provider routes need consent in Clerk mode; FREE_MODE still blocks calls; no fabricated score', async t => {
  const {call, calls, base} = await setup(t);
  const wav = toWav(whiteNoise(16000 * 2, 0.05));
  const post = headers => fetch(base + '/api/analyze?modality=voice&provider=sealedrose&extract=0&textProvider=gemini', {method: 'POST', headers: {Origin: base, 'X-Voxa-Request': '1', 'Content-Type': 'audio/wav', Authorization: 'Bearer ' + TOK.alice, ...headers}, body: wav});
  let r = await post({});
  assert.equal(r.status, 428); assert.equal(calls.length, 0, 'nothing sent without consent');
  r = await post({'X-Voxa-Provider-Consent': '1'});
  const d = await r.json();
  assert.equal(calls.length, 0, 'FREE_MODE (default on) blocks the unconfirmed provider');
  assert.equal(d.authenticity.status, 'unavailable'); assert.equal(d.authenticity.aiScore, undefined);
});
test('logs and audit records never contain tokens, secrets, keys or transcript text', async t => {
  const {call, db, logLines} = await setup(t);
  await call('GET', '/api/reports', {token: 'tok_not_a_real_session_123'});
  await call('POST', '/api/reports', {token: TOK.alice, body: {report: report('INC-L1')}});
  await call('POST', '/api/privacy/scan', {token: TOK.alice, body: {text: 'SECRET-TRANSCRIPT call 9876543210', consent: true}});
  const everything = JSON.stringify(await db.query('select * from voxa.audit_events')) + logLines.join('\n');
  for (const bad of [TOK.alice, 'tok_not_a_real_session_123', SK, 'SECRET-TRANSCRIPT', '9876543210', 'sr_test_key_should_never_leak', KEY]) assert.ok(!everything.includes(bad), 'leaked: ' + bad);
  assert.deepEqual(safeMetadata({transcript: 'x', token: 'y', reason: 'Bearer eyJabc.def.ghi', role: 'user'}), {reason: '[redacted]', role: 'user'});
  const lines = []; safeLogger(l => lines.push(l))('x', {message: 'key sk_live_ABCDEF123456', transcript: 'secret words'});
  assert.ok(!lines[0].includes('sk_live_ABCDEF') && !lines[0].includes('secret words'));
});
test('rate limit: a burst of report calls is cut off with 429 and flagged', async t => {
  const {call, db} = await setup(t);
  let last = 0;
  for (let i = 0; i < 245; i++) last = (await call('GET', '/api/reports', {token: TOK.dave})).status;
  assert.equal(last, 429);
  assert.ok((await db.query("select count(*)::int as n from voxa.audit_events where action = 'rate_limited'"))[0].n >= 1);
});

// ---------------------------------------------------------------- media cleanup on failure paths
const tmpCount = () => readdirSync(tmpdir()).filter(n => /^voxa-[A-Za-z0-9]{6}$/.test(n)).length;
test('temp media is deleted after provider error, malformed input and client cancellation', {skip: (await ffmpegPath()) ? false : 'FFmpeg missing'}, async t => {
  const {base} = await setup(t, {}, {fetcher: async () => { throw new Error('provider exploded'); }});
  const headers = {Origin: base, 'X-Voxa-Request': '1', 'Content-Type': 'audio/wav', Authorization: 'Bearer ' + TOK.alice, 'X-Voxa-Provider-Consent': '1'};
  const before = tmpCount();
  await fetch(base + '/api/noise', {method: 'POST', headers, body: toWav(whiteNoise(16000 * 3, 0.05))});                       // success path
  await fetch(base + '/api/noise', {method: 'POST', headers, body: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(300, 9)])}); // malformed
  const ac = new AbortController(); const p = fetch(base + '/api/noise?denoise=1', {method: 'POST', headers, body: toWav(whiteNoise(16000 * 20, 0.05)), signal: ac.signal}).catch(() => {});
  setTimeout(() => ac.abort(), 150); await p; await new Promise(r => setTimeout(r, 2500));                                            // cancelled
  assert.equal(tmpCount(), before);
});

// ---------------------------------------------------------------- production gate
test('production refuses insecure configuration; development stays usable', () => {
  const prodBad = loadConfig({NODE_ENV: 'production', AUTH_MODE: 'demo', ALLOWED_ORIGINS: '*', VOXA_DEBUG: '1'});
  for (const re of [/AUTH_MODE=demo is not allowed/, /ALLOWED_HOSTS/, /wildcards/, /VOXA_DEBUG/]) assert.ok(prodBad.errors.some(e => re.test(e)), 'missing error ' + re);
  const prodTestKeys = loadConfig({NODE_ENV: 'production', AUTH_MODE: 'clerk', CLERK_SECRET_KEY: SK, CLERK_PUBLISHABLE_KEY: PK, ALLOWED_HOSTS: 'voxa.example', ALLOWED_ORIGINS: 'https://voxa.example', DATABASE_URL: 'postgres://u:p@h/db', DATABASE_SSL: 'no-verify'});
  assert.ok(prodTestKeys.errors.some(e => /development instance/.test(e)));
  assert.ok(prodTestKeys.errors.some(e => /no-verify is not allowed/.test(e)));
  const dev = loadConfig({});
  assert.deepEqual(dev.errors, []); assert.equal(dev.auth.mode, 'demo');
});

test('LAN mode answers only to private addresses and is refused in production', () => {
  const nets = {wifi: [{family: 'IPv4', address: '10.131.167.225', internal: false}, {family: 'IPv4', address: '8.8.8.8', internal: false}, {family: 'IPv6', address: 'fe80::1', internal: false}], lo: [{family: 'IPv4', address: '127.0.0.1', internal: true}]};
  const {privateIPv4} = configModule;
  assert.deepEqual(privateIPv4(nets), ['10.131.167.225'], 'public and loopback addresses are never added');
  const cfg = loadConfig({VOXA_LAN: '1', PORT: '5175', __testLanIps: ['192.168.1.20']});
  assert.equal(cfg.bindHost, '0.0.0.0'); assert.ok(cfg.hosts.includes('192.168.1.20')); assert.ok(cfg.origins.includes('http://192.168.1.20:5175'));
  assert.ok(!cfg.hosts.includes('*'));
  assert.ok(loadConfig({NODE_ENV: 'production', VOXA_LAN: '1'}).errors.some(e => /VOXA_LAN/.test(e)));
  assert.equal(loadConfig({}).bindHost, '127.0.0.1', 'default stays local-only');
});

test('behind an HTTPS tunnel the analysis routes accept the configured https origin and still refuse others', {skip: (await ffmpegPath()) ? false : 'FFmpeg missing'}, async t => {
  const http = await import('node:http');
  const cfg = loadConfig({AUTH_MODE: 'demo', ALLOWED_HOSTS: 'voxa-tunnel.example,localhost,127.0.0.1', ALLOWED_ORIGINS: 'https://voxa-tunnel.example'});
  const s = createServer({}, fetch, {cfg}); await new Promise(r => s.listen(0, '127.0.0.1', r)); t.after(() => s.close());
  const body = toWav(whiteNoise(16000 * 2, 0.05));
  const send = origin => new Promise((res, rej) => { const q = http.request({host: '127.0.0.1', port: s.address().port, path: '/api/noise', method: 'POST', headers: {Host: 'voxa-tunnel.example', Origin: origin, 'X-Voxa-Request': '1', 'Content-Type': 'audio/wav', 'Content-Length': body.length}}, r => { r.resume(); r.on('end', () => res(r.statusCode)); }); q.on('error', rej); q.end(body); });
  assert.equal(await send('https://voxa-tunnel.example'), 200, 'browser behind Cloudflare sends https://host');
  assert.equal(await send('https://evil.example'), 403);
  assert.equal(await send('http://voxa-tunnel.example'), 200, 'plain same-origin still works');
});

test('daily provider quota: per-user cap, then a server-wide cap; non-provider routes are not counted', async t => {
  const {base} = await setup(t, {PROVIDER_DAILY_LIMIT_PER_USER: '2', PROVIDER_DAILY_LIMIT_TOTAL: '3'});
  const wav = toWav(whiteNoise(16000 * 2, 0.05));
  const post = token => fetch(base + '/api/analyze?modality=voice&provider=sealedrose&extract=0&textProvider=gemini', {method: 'POST', headers: {Origin: base, 'X-Voxa-Request': '1', 'Content-Type': 'audio/wav', Authorization: 'Bearer ' + token, 'X-Voxa-Provider-Consent': '1'}, body: wav}).then(r => r.status);
  assert.equal(await post(TOK.alice), 200); assert.equal(await post(TOK.alice), 200);
  assert.equal(await post(TOK.alice), 429, 'third call for the same user is refused');
  assert.equal(await post(TOK.bob), 200);
  assert.equal(await post(TOK.carol), 429, 'server-wide cap reached');
});

test('a firewall intercepting TLS is reported as TLS_INTERCEPTED, not a vague network error', async () => {
  const {failure} = await import('../server/providers.mjs');
  const e = Object.assign(new TypeError('fetch failed'), {cause: Object.assign(new Error('unable to verify the first certificate'), {code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'})});
  const r = failure('realitydefender', e, 'Authenticity check');
  assert.equal(r.status, 'unavailable'); assert.equal(r.code, 'TLS_INTERCEPTED'); assert.match(r.message, /did not send anything/);
  assert.equal(failure('realitydefender', new TypeError('fetch failed'), 'X').code, 'NETWORK_ERROR');
});
