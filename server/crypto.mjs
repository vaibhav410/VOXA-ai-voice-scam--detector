// AES-256-GCM for retained sensitive fields (PRD FR-06, 13.5).
// Format: v1.<keyId>.<iv b64url>.<tag b64url>.<ciphertext b64url>. Unique 96-bit IV per encryption, 128-bit tag,
// optional AAD binds the ciphertext to its row/field so it cannot be swapped into another record.
// Keys come from the environment (VOXA_ENCRYPTION_KEYS="kid:base64key,..."), never from the database or the repo.
import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';

export class EncryptionUnavailable extends Error { constructor(msg = 'Encryption is not configured, so this data is not stored.') { super(msg); this.code = 'ENCRYPTION_UNAVAILABLE'; } }
export class DecryptionFailed extends Error { constructor() { super('Decryption failed: the data was altered, or the key is wrong or missing.'); this.code = 'DECRYPTION_FAILED'; } }

export function parseKeyring(spec, activeKid) {
  const keys = new Map();
  for (const part of String(spec).split(',').map(s => s.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    if (i < 1) return {error: 'each entry must be "keyId:base64Key".'};
    const kid = part.slice(0, i), raw = part.slice(i + 1);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(kid)) return {error: `key id "${kid}" must be 1-32 letters, digits, _ or -.`};
    let key;
    try { key = Buffer.from(raw, 'base64'); } catch { return {error: `key "${kid}" is not base64.`}; }
    if (key.length !== 32) return {error: `key "${kid}" must decode to exactly 32 bytes (got ${key.length}).`};
    if (key.every(b => b === key[0])) return {error: `key "${kid}" is trivially weak.`};
    if (keys.has(kid)) return {error: `duplicate key id "${kid}".`};
    keys.set(kid, key);
  }
  if (!keys.size) return {error: 'no keys given.'};
  const active = activeKid || [...keys.keys()][0];
  if (!keys.has(active)) return {error: `active key id "${active}" is not in the key ring.`};
  return {keys, active};
}

const b64u = b => b.toString('base64url');

export function encrypt(ring, plaintext, aad = '') {
  if (!ring?.keys?.has(ring.active)) throw new EncryptionUnavailable();
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', ring.keys.get(ring.active), iv);
  if (aad) c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  return ['v1', ring.active, b64u(iv), b64u(c.getAuthTag()), b64u(ct)].join('.');
}

export function decrypt(ring, blob, aad = '') {
  const p = String(blob).split('.');
  if (p.length !== 5 || p[0] !== 'v1') throw new DecryptionFailed();
  const key = ring?.keys?.get(p[1]);
  if (!key) throw new DecryptionFailed();
  try {
    const iv = Buffer.from(p[2], 'base64url'), tag = Buffer.from(p[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const d = createDecipheriv('aes-256-gcm', key, iv);
    if (aad) d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(Buffer.from(p[4], 'base64url')), d.final()]).toString('utf8');
  } catch { throw new DecryptionFailed(); }
}

export const newKey = () => randomBytes(32).toString('base64');
