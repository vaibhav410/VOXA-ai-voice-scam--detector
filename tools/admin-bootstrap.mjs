// npm run admin:bootstrap -- --email you@example.com
// The only way to create a super admin. Runs on the server with direct database access; there is no API for it.
// The person must have signed in to VOXA once (so their account row exists with a verified email).
import {loadEnv} from '../server.mjs';
import {loadConfig} from '../server/config.mjs';
import {openDb} from '../server/db.mjs';
import {grantSuperAdmin} from '../server/repo.mjs';
import {createAudit} from '../server/audit.mjs';

const i = process.argv.indexOf('--email'), email = i > 0 ? process.argv[i + 1] : null;
if (!email) { console.error('Usage: npm run admin:bootstrap -- --email you@example.com'); process.exit(2); }
loadEnv();
const cfg = loadConfig();
if (cfg.db.kind === 'none') { console.error('No database configured (see PRIVACY_SETUP.md).'); process.exit(1); }
if (cfg.db.kind === 'pglite') console.warn('Local PGlite database: stop the VOXA server before running this (PGlite allows one process at a time), then start it again.');
const db = await openDb(cfg.db);
try {
  const r = await grantSuperAdmin(db, email);
  if (r.error === 'INVALID_EMAIL') { console.error('That is not a valid email address.'); process.exitCode = 1; }
  else if (r.error === 'NO_SUCH_USER') { console.error('No active VOXA account with that verified email. Sign in to VOXA once with it, then run this again.'); process.exitCode = 1; }
  else {
    await createAudit(db)({actorUserId: null, action: 'role.super_admin_granted', targetType: 'user', targetId: r.userId, severity: 'medium', classification: 'event', metadata: {method: 'cli'}});
    console.log('Super admin granted. The change is recorded in the audit log.');
  }
} finally { await db.close(); }
