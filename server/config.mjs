// Configuration + startup validation (PRD 13.1, 14 "production launch gate").
// Development stays usable with safe defaults; production refuses insecure settings instead of guessing.
import {networkInterfaces} from 'node:os';
import {parseKeyring} from './crypto.mjs';

const pick = (env, ...names) => { for (const n of names) { const v = env[n]; if (v !== undefined && String(v).trim() !== '') return String(v).trim(); } return undefined; };
const int = (v, d) => (v === undefined || !/^\d+$/.test(v) ? d : Number(v));
const list = v => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

// Private (RFC 1918) IPv4 addresses of this machine: the only extra hosts LAN mode will answer to.
export function privateIPv4(nets = networkInterfaces()) {
  const out = [];
  for (const list of Object.values(nets)) for (const n of list || []) {
    if (n.family !== 'IPv4' && n.family !== 4) continue;
    if (n.internal) continue;
    if (/^10\./.test(n.address) || /^192\.168\./.test(n.address) || /^172\.(1[6-9]|2\d|3[01])\./.test(n.address)) out.push(n.address);
  }
  return [...new Set(out)];
}

// Clerk publishable keys are pk_(test|live)_<base64(frontendApi + "$")>; the frontend API host is public by design.
export function clerkFrontendApi(pk) {
  const m = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(pk || '');
  if (!m) return null;
  try {
    const host = Buffer.from(m[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8').replace(/\$$/, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? host : null;
  } catch { return null; }
}

export function loadConfig(env = process.env) {
  const errors = [], warnings = [];
  const nodeEnv = pick(env, 'NODE_ENV') || 'development';
  const prod = nodeEnv === 'production';
  const port = int(pick(env, 'PORT'), 5174);

  // ---- authentication
  const clerkSecret = pick(env, 'CLERK_SECRET_KEY');
  const clerkPublishable = pick(env, 'CLERK_PUBLISHABLE_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'VITE_CLERK_PUBLISHABLE_KEY');
  const authMode = (pick(env, 'AUTH_MODE') || (clerkSecret ? 'clerk' : 'demo')).toLowerCase();
  if (!['clerk', 'demo'].includes(authMode)) errors.push(`AUTH_MODE must be "clerk" or "demo" (got "${authMode}").`);
  if (authMode === 'demo') {
    if (prod) errors.push('AUTH_MODE=demo is not allowed in production: the demo login is not authentication.');
    else warnings.push('AUTH_MODE=demo: no real authentication. Use only on your own machine.');
  }
  if (authMode === 'clerk') {
    if (!clerkSecret) errors.push('AUTH_MODE=clerk needs CLERK_SECRET_KEY.');
    else if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(clerkSecret)) errors.push('CLERK_SECRET_KEY does not look like a Clerk secret key (sk_test_… / sk_live_…).');
    if (!clerkPublishable) errors.push('AUTH_MODE=clerk needs CLERK_PUBLISHABLE_KEY (or NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).');
    else if (!clerkFrontendApi(clerkPublishable)) errors.push('The Clerk publishable key is not valid (pk_test_… / pk_live_…).');
    if (prod && /^sk_test_/.test(clerkSecret || '')) errors.push('Production must not use a Clerk development instance (sk_test_ key).');
  }

  // ---- hosts and origins
  // LAN mode: listen on the network and answer to this machine's private addresses (development/office use only).
  const lan = /^(1|true|on|yes)$/i.test(pick(env, 'VOXA_LAN') || '');
  if (lan && prod) errors.push('VOXA_LAN is for sharing on a local network during development. In production set ALLOWED_HOSTS and serve behind TLS.');
  const lanIps = lan ? (env.__testLanIps || privateIPv4()) : [];
  if (lan && !lanIps.length) warnings.push('VOXA_LAN=1 but this machine has no private IPv4 address; only localhost will work.');
  const bindHost = pick(env, 'BIND_HOST') || (lan ? '0.0.0.0' : '127.0.0.1');
  const allowedHosts = list(pick(env, 'ALLOWED_HOSTS')).map(h => h.toLowerCase());
  const hosts = [...new Set([...(allowedHosts.length ? allowedHosts : ['localhost', '127.0.0.1']), ...lanIps])];
  if (lan) warnings.push(`LAN mode: reachable from your local network at ${lanIps.map(ip => `http://${ip}:${port}`).join(', ') || '(no address)'}. Plain HTTP: the microphone does not work for other devices (browsers allow it only on HTTPS or localhost).`);
  if (prod && !allowedHosts.length) errors.push('Production needs ALLOWED_HOSTS (the public host name of this server).');
  if (hosts.includes('*')) errors.push('ALLOWED_HOSTS must not contain "*".');
  const allowedOrigins = list(pick(env, 'ALLOWED_ORIGINS'));
  const origins = [...new Set([...(allowedOrigins.length ? allowedOrigins : [`http://localhost:${port}`, `http://127.0.0.1:${port}`]), ...lanIps.map(ip => `http://${ip}:${port}`)])];
  if (origins.some(o => o === '*' || o.includes('*'))) errors.push('ALLOWED_ORIGINS must not contain wildcards.');
  if (prod && !allowedOrigins.length) errors.push('Production needs ALLOWED_ORIGINS (https://your.domain).');
  if (prod && origins.some(o => !o.startsWith('https://'))) errors.push('Production origins must use https:// (TLS at the edge).');

  // ---- database
  const dbUrl = pick(env, 'DATABASE_URL', 'SUPABASE_DB_URL');
  const dbMode = (pick(env, 'VOXA_DB') || '').toLowerCase();
  let db = {kind: 'none'};
  if (dbUrl) {
    if (!/^postgres(ql)?:\/\//.test(dbUrl)) errors.push('DATABASE_URL must start with postgres:// or postgresql://.');
    const caFile = pick(env, 'DATABASE_SSL_CA_FILE');
    const sslMode = (pick(env, 'DATABASE_SSL') || (caFile ? 'verify' : 'verify')).toLowerCase();
    if (sslMode === 'no-verify') { if (prod) errors.push('DATABASE_SSL=no-verify is not allowed in production. Set DATABASE_SSL_CA_FILE to the provider CA certificate.'); else warnings.push('DATABASE_SSL=no-verify: database TLS certificate is not checked (development only).'); }
    if (sslMode === 'off') { if (prod) errors.push('DATABASE_SSL=off is not allowed in production.'); else warnings.push('DATABASE_SSL=off: database traffic is not encrypted.'); }
    db = {kind: 'postgres', url: dbUrl, ssl: sslMode, caFile};
  } else if (dbMode === 'pglite') {
    if (prod) errors.push('VOXA_DB=pglite is for local development only.');
    db = {kind: 'pglite', dir: pick(env, 'VOXA_PGLITE_DIR') || './data/pglite'};
  } else {
    warnings.push('No database configured (DATABASE_URL). Accounts, server-side report history, teams and audit are off; reports stay in the browser.');
  }

  // ---- encryption (only for retained sensitive fields)
  const ringSpec = pick(env, 'VOXA_ENCRYPTION_KEYS');
  const ring = ringSpec ? parseKeyring(ringSpec, pick(env, 'VOXA_ENCRYPTION_ACTIVE_KID')) : null;
  if (ring?.error) errors.push('VOXA_ENCRYPTION_KEYS: ' + ring.error);

  // ---- retention
  const reportDays = int(pick(env, 'REPORT_RETENTION_DAYS'), 30);
  if (reportDays < 1 || reportDays > 365) errors.push('REPORT_RETENTION_DAYS must be between 1 and 365.');
  const transcriptMode = (pick(env, 'TRANSCRIPT_RETENTION') || 'none').toLowerCase();
  if (!['none', 'encrypted'].includes(transcriptMode)) errors.push('TRANSCRIPT_RETENTION must be "none" or "encrypted".');
  const transcriptDays = int(pick(env, 'TRANSCRIPT_RETENTION_DAYS'), 7);
  if (transcriptDays < 1 || transcriptDays > 30) errors.push('TRANSCRIPT_RETENTION_DAYS must be between 1 and 30.');
  if (transcriptMode === 'encrypted' && (!ring || ring.error)) errors.push('TRANSCRIPT_RETENTION=encrypted needs a valid VOXA_ENCRYPTION_KEYS. Without it transcripts are never stored (fail closed).');

  // ---- limits (current hard limits in the media pipeline; reported, and guarded against loosening)
  const limits = {voiceMB: 20, imageMB: 10, videoMB: 32, noiseSeconds: 300, jsonKB: 256};
  // Daily caps on provider-backed requests (analysis, transcription, intelligence), so a public deployment with open
  // sign-up cannot drain paid credits. In-memory, reset at 00:00 UTC.
  const quotas = {perUser: int(pick(env, 'PROVIDER_DAILY_LIMIT_PER_USER'), 20), total: int(pick(env, 'PROVIDER_DAILY_LIMIT_TOTAL'), 200)};
  if (quotas.perUser < 1 || quotas.total < 1) errors.push('PROVIDER_DAILY_LIMIT_* must be at least 1.');

  // ---- debug / FREE_MODE
  if (/^(1|true|on|yes)$/i.test(pick(env, 'VOXA_DEBUG') || '')) { if (prod) errors.push('VOXA_DEBUG must be off in production.'); else warnings.push('VOXA_DEBUG is on.'); }
  const freeMode = !/^(0|false|off|no)$/i.test(String(pick(env, 'FREE_MODE') ?? '1'));
  if (!freeMode) warnings.push('FREE_MODE=off: configured providers may be billed.');

  return {
    nodeEnv, prod, port, bindHost, lan, lanIps, errors, warnings,
    auth: {mode: authMode, clerkSecret, clerkPublishable, clerkFrontendApi: clerkFrontendApi(clerkPublishable), requireProviderConsent: authMode === 'clerk'},
    hosts, origins, db, ring: ring && !ring.error ? ring : null,
    retention: {reportDays, transcriptMode, transcriptDays},
    limits, quotas, freeMode
  };
}

// What may be shown to anyone: no secrets, no URLs with credentials.
export const publicConfig = cfg => ({
  authMode: cfg.auth.mode,
  clerkPublishableKey: cfg.auth.mode === 'clerk' ? cfg.auth.clerkPublishable : null,
  clerkFrontendApi: cfg.auth.mode === 'clerk' ? cfg.auth.clerkFrontendApi : null,
  database: cfg.db.kind !== 'none',
  transcriptRetention: cfg.retention.transcriptMode === 'encrypted' && Boolean(cfg.ring),
  reportRetentionDays: cfg.retention.reportDays
});
