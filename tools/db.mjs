// npm run db:check | db:migrate | db:status
// Never drops or resets anything. Prints no connection strings or credentials.
import {loadEnv} from '../server.mjs';
import {loadConfig} from '../server/config.mjs';
import {openDb, migrate, migrationStatus, dbHealth} from '../server/db.mjs';

const cmd = process.argv[2];
if (!['check', 'migrate', 'status'].includes(cmd)) { console.error('Usage: node tools/db.mjs check|migrate|status'); process.exit(2); }
loadEnv();
const cfg = loadConfig();
const dbErrors = cfg.errors.filter(e => /DATABASE|VOXA_DB/.test(e));
if (cfg.db.kind === 'none') {
  console.error('No database configured.\n  For Supabase: set DATABASE_URL (Project Settings -> Database -> Connection string, "Session pooler" for IPv4) and DATABASE_SSL_CA_FILE (the CA certificate from the same page).\n  For local development without an account: VOXA_DB=pglite.\nSee PRIVACY_SETUP.md.');
  process.exit(1);
}
if (dbErrors.length) { for (const e of dbErrors) console.error('ERROR ' + e); process.exit(1); }
let db;
try { db = await openDb(cfg.db); }
catch (e) { console.error(`Could not open the database (${e.code || e.name}). Check DATABASE_URL, network access and TLS settings.`); process.exit(1); }
try {
  if (cmd === 'check') {
    const h = await dbHealth(db);
    console.log(JSON.stringify({kind: cfg.db.kind, tls: cfg.db.kind === 'postgres' ? cfg.db.ssl + (cfg.db.caFile ? ' (CA file)' : '') : 'n/a', ...h}, null, 2));
    if (!h.reachable) process.exit(1);
    if (!h.schemaCurrent) { console.error(`Schema is behind by ${h.pendingMigrations} migration(s). Run: npm run db:migrate`); process.exit(1); }
    const rls = await db.query("select count(*)::int as total, count(*) filter (where c.relrowsecurity)::int as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'voxa' and c.relkind = 'r'");
    console.log(`voxa tables: ${rls[0].total}, with row-level security: ${rls[0].rls}`);
    if (rls[0].total !== rls[0].rls) { console.error('Some voxa tables do not have row-level security enabled.'); process.exit(1); }
    console.log('Database OK.');
  } else if (cmd === 'migrate') {
    const applied = await migrate(db, {log: m => console.log(m)});
    console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Nothing to apply; schema is current.');
  } else {
    const st = await migrationStatus(db);
    console.log(`applied: ${st.applied.join(', ') || '(none)'}\npending: ${st.pending.join(', ') || '(none)'}`);
  }
} catch (e) { console.error(`Database ${cmd} failed: ${e.code || ''} ${String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '[connection]').slice(0, 200)}`); process.exitCode = 1; }
finally { await db.close(); }
