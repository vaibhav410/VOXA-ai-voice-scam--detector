// HTTPS for local-network previews. Browsers allow the microphone only on HTTPS or localhost, so a plain
// http://10.x.x.x address cannot record, run Live monitor or make Protected calls. This creates a self-signed
// certificate for this machine's private addresses (kept in data/lan-tls/, which is git-ignored) and renews it
// when the addresses change or it is close to expiry. Visitors see a one-time "not private" warning to accept.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import selfsigned from 'selfsigned';

const DAYS = 365;

export async function lanTls(dir, ips) {
  const names = ['localhost'], addrs = [...new Set(['127.0.0.1', ...ips])].sort();
  const keyFile = path.join(dir, 'key.pem'), certFile = path.join(dir, 'cert.pem'), metaFile = path.join(dir, 'meta.json');
  try {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    const fresh = meta.expiresAt - Date.now() > 7 * 86400000, same = JSON.stringify(meta.addrs) === JSON.stringify(addrs);
    if (fresh && same && existsSync(keyFile) && existsSync(certFile)) return {key: readFileSync(keyFile), cert: readFileSync(certFile), created: false};
  } catch {}
  const pems = await selfsigned.generate([{name: 'commonName', value: 'VOXA local network'}], {
    days: DAYS, keySize: 2048, algorithm: 'sha256',
    extensions: [{name: 'subjectAltName', altNames: [...names.map(value => ({type: 2, value})), ...addrs.map(ip => ({type: 7, ip}))]}]
  });
  mkdirSync(dir, {recursive: true});
  writeFileSync(keyFile, pems.private, {mode: 0o600}); writeFileSync(certFile, pems.cert);
  writeFileSync(metaFile, JSON.stringify({addrs, expiresAt: Date.now() + DAYS * 86400000, fingerprint: pems.fingerprint}));
  return {key: pems.private, cert: pems.cert, created: true};
}
