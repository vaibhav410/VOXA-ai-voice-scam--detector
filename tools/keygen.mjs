// npm run keys:generate -- prints a new AES-256-GCM key entry for VOXA_ENCRYPTION_KEYS. Store it in your secret store.
import {newKey} from '../server/crypto.mjs';
const kid = 'k' + new Date().toISOString().slice(0, 10).replace(/-/g, '');
console.log(`VOXA_ENCRYPTION_KEYS=${kid}:${newKey()}\nVOXA_ENCRYPTION_ACTIVE_KID=${kid}\n\nKeep this out of git and out of the database. To rotate, put the new entry first and keep the old one after it.`);
