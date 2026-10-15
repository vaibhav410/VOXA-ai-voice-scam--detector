// npm run privacy:check
// Checks configuration (auth, hosts/origins, TLS, retention, encryption, FREE_MODE, debug), .gitignore coverage and
// tracked files for committed secrets. Exits non-zero on errors. Never prints secret values.
import {execFileSync} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
import {loadEnv} from '../server.mjs';
import {loadConfig} from '../server/config.mjs';

loadEnv();
const cfg = loadConfig();
const errors = [...cfg.errors], warnings = [...cfg.warnings], ok = [];

// .gitignore must cover secrets and local data
const gi = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf8') : '';
for (const [pattern, why] of [['.env*', 'environment files'], ['data/', 'local database files'], ['node_modules/', 'dependencies']]) {
  if (gi.split(/\r?\n/).some(l => l.trim() === pattern)) ok.push(`.gitignore covers ${why} (${pattern})`); else errors.push(`.gitignore is missing "${pattern}" (${why}).`);
}

// Secret scan over tracked files (simple patterns; a dedicated scanner such as gitleaks is better if available)
const PATTERNS = [['Clerk secret key', /sk_(live|test)_[A-Za-z0-9]{20,}/], ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{20,}/], ['JWT', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/], ['Postgres URL with password', /postgres(ql)?:\/\/[^:\s'"]+:[^@\s'"]{6,}@/], ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/], ['Google API key', /AIza[0-9A-Za-z_-]{35}/]];
let files = [];
try { files = execFileSync('git', ['ls-files'], {encoding: 'utf8'}).split('\n').filter(Boolean); } catch { warnings.push('git is not available: tracked-file secret scan skipped (not passed).'); }
let hits = 0;
for (const f of files) {
  if (/\.(png|jpe?g|webp|woff2?|ico|wav|mp3|zip|pdf)$/i.test(f) || f.startsWith('tests/') || f === 'package-lock.json') continue;
  let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
  for (const [name, re] of PATTERNS) if (re.test(text)) { errors.push(`Possible ${name} committed in ${f}. Remove it and rotate the key.`); hits++; }
  if (/(^|\/)\.env(\.local)?$/.test(f)) { errors.push(`${f} is tracked by git. Remove it from the repository and rotate every key in it.`); hits++; }
}
if (files.length && !hits) ok.push(`No secret patterns in ${files.length} tracked files (pattern scan, not a full audit).`);

// Summaries
ok.push(`Auth mode: ${cfg.auth.mode}${cfg.auth.mode === 'clerk' ? ` (Clerk ${/^sk_live_/.test(cfg.auth.clerkSecret || '') ? 'production' : 'development'} instance)` : ''}`);
ok.push(`Database: ${cfg.db.kind}${cfg.db.kind === 'postgres' ? `, TLS ${cfg.db.ssl}${cfg.db.caFile ? ' with CA file' : ''}` : ''}`);
ok.push(`Report retention: ${cfg.retention.reportDays} days; transcripts: ${cfg.retention.transcriptMode === 'encrypted' ? `encrypted, ${cfg.retention.transcriptDays} days, opt-in` : 'never stored'}`);
ok.push(`Encryption key ring: ${cfg.ring ? `${cfg.ring.keys.size} key(s), active "${cfg.ring.active}"` : 'not configured (encrypted retention off)'}`);
ok.push(`FREE_MODE: ${cfg.freeMode ? 'on' : 'off'}; Audo cloud noise removal: ${/^(1|true|on|yes)$/i.test(process.env.AUDO_ENABLED || '') ? 'enabled (per-upload consent)' : 'off'}`);
ok.push(`Allowed hosts: ${cfg.hosts.join(', ')}; origins: ${cfg.origins.join(', ')}`);
ok.push(`Upload limits: voice ${cfg.limits.voiceMB} MB, image ${cfg.limits.imageMB} MB, video ${cfg.limits.videoMB} MB, noise ${cfg.limits.noiseSeconds / 60} min`);

console.log(`VOXA privacy check (${cfg.nodeEnv})\n`);
for (const x of ok) console.log('  ok    ' + x);
for (const x of warnings) console.log('  warn  ' + x);
for (const x of errors) console.log('  ERROR ' + x);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s).${cfg.prod ? '' : ' Production adds stricter checks: run with NODE_ENV=production to see them.'}`);
process.exit(errors.length ? 1 : 0);
