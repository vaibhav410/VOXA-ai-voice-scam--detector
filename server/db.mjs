// Database access: one small interface over PostgreSQL (pg, for Supabase/any Postgres) and PGlite (local
// development and tests, no install). All SQL is parameterized; migrations are versioned files in
// supabase/migrations, applied in order, each inside a transaction, and never drop data.
import {readdir, readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');

export async function openDb(dbCfg) {
  if (!dbCfg || dbCfg.kind === 'none') return null;
  if (dbCfg.kind === 'pglite' || dbCfg.kind === 'memory') {
    const {PGlite} = await import('@electric-sql/pglite');
    const pg = dbCfg.kind === 'memory' ? new PGlite() : new PGlite(dbCfg.dir);
    await pg.waitReady;
    const q = async (text, params = []) => (await pg.query(text, params)).rows;
    return {
      kind: dbCfg.kind,
      query: q,
      exec: sql => pg.exec(sql),
      tx: fn => pg.transaction(async t => fn(async (text, params = []) => (await t.query(text, params)).rows)),
      close: () => pg.close()
    };
  }
  if (dbCfg.kind === 'postgres') {
    const {default: pgmod} = await import('pg');
    const ssl = dbCfg.ssl === 'off' ? false : dbCfg.ssl === 'no-verify' ? {rejectUnauthorized: false} : dbCfg.caFile ? {ca: readFileSync(dbCfg.caFile, 'utf8'), rejectUnauthorized: true} : {rejectUnauthorized: true};
    // Strip sslmode from the URL so the explicit TLS settings above always win.
    const url = dbCfg.url.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '');
    const pool = new pgmod.Pool({connectionString: url, ssl, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000, statement_timeout: 15000});
    pool.on('error', () => {}); // idle-client errors must not crash the server; queries still report failures
    const q = async (text, params = []) => (await pool.query(text, params)).rows;
    return {
      kind: 'postgres',
      query: q,
      exec: async sql => { await pool.query(sql); },
      tx: async fn => {
        const c = await pool.connect();
        try { await c.query('begin'); const r = await fn(async (text, params = []) => (await c.query(text, params)).rows); await c.query('commit'); return r; }
        catch (e) { try { await c.query('rollback'); } catch {} throw e; }
        finally { c.release(); }
      },
      close: () => pool.end()
    };
  }
  throw new Error('Unknown database kind.');
}

export async function listMigrations(dir = MIGRATIONS_DIR) {
  return (await readdir(dir)).filter(f => /^\d{14}_[a-z0-9_]+\.sql$/.test(f)).sort().map(f => ({version: f.replace(/\.sql$/, ''), file: path.join(dir, f)}));
}

export async function appliedVersions(db) {
  const t = await db.query("select to_regclass('voxa.schema_migrations') as t");
  if (!t[0]?.t) return new Set();
  return new Set((await db.query('select version from voxa.schema_migrations')).map(r => r.version));
}

// Apply pending migrations only. Each file runs in a transaction; a failure rolls that file back and stops.
export async function migrate(db, {dir = MIGRATIONS_DIR, log = () => {}} = {}) {
  const done = await appliedVersions(db), applied = [];
  for (const m of await listMigrations(dir)) {
    if (done.has(m.version)) continue;
    const sql = await readFile(m.file, 'utf8');
    if (/\bdrop\s+(table|schema|database)\b|\btruncate\b/i.test(sql.replace(/--.*$/gm, ''))) throw new Error(`Refusing ${m.version}: migrations must not drop or truncate data.`);
    if (db.kind === 'postgres') await db.tx(async q => { await q(sql); await q('insert into voxa.schema_migrations (version) values ($1) on conflict do nothing', [m.version]); });
    else { await db.exec('begin'); try { await db.exec(sql); await db.query('insert into voxa.schema_migrations (version) values ($1) on conflict do nothing', [m.version]); await db.exec('commit'); } catch (e) { await db.exec('rollback'); throw e; } }
    applied.push(m.version); log(`applied ${m.version}`);
  }
  return applied;
}

export async function migrationStatus(db, dir = MIGRATIONS_DIR) {
  const done = await appliedVersions(db), all = await listMigrations(dir);
  return {applied: all.filter(m => done.has(m.version)).map(m => m.version), pending: all.filter(m => !done.has(m.version)).map(m => m.version)};
}

// Health check that never returns connection details.
export async function dbHealth(db) {
  if (!db) return {configured: false};
  try {
    const t0 = Date.now();
    await db.query('select 1');
    const st = await migrationStatus(db);
    return {configured: true, reachable: true, kind: db.kind === 'postgres' ? 'postgres' : 'local', latencyMs: Date.now() - t0, schemaCurrent: st.pending.length === 0, pendingMigrations: st.pending.length};
  } catch { return {configured: true, reachable: false}; }
}
