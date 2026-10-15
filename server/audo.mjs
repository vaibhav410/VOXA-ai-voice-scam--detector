// Audo AI noise removal (https://audo.ai/api). Uses the documented keyless "Free API": POST /api/try/remove-noise.
// Free tier per Audo's docs: only the first part of each file (the first minute) is processed, a few times a day
// (3/day for remove-noise); paid use needs an API key. Audo deletes uploads after 24 h and free results after 1 h;
// its AI processing providers may retain data under their own terms.
//
// Privacy rules enforced by the caller (server.mjs): off unless AUDO_ENABLED=1, explicit per-request consent, never a
// silent fallback to or from local processing. This module only talks to Audo and validates what comes back.
import {sniff} from './media.mjs';

export const AUDO_URL = 'https://audo.ai/api/try/remove-noise';
export const AUDO_FREE_SECONDS = 60;
export const AUDO_DISCLOSURE = 'Your audio is uploaded to Audo AI (audo.ai) for noise removal. Audo deletes uploads after 24 hours and free results after 1 hour; its AI processing providers may keep data under their own terms. The free tier processes only the first minute, up to 3 times a day.';
const MAX_RESULT = 40 * 1048576;
const EXT = {'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/flac': 'flac', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov'};

export class AudoError extends Error { constructor(code, message) { super(message); this.code = code; } }

export async function audoRemoveNoise({bytes, mime, signal}, fetcher = fetch) {
  const form = new FormData();
  form.append('file', new Blob([bytes], {type: mime}), 'audio.' + (EXT[mime] || 'wav')); // neutral name: the user's file name is not sent
  let res;
  try {
    res = await fetcher(AUDO_URL, {method: 'POST', body: form, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(150000)]) : AbortSignal.timeout(150000)});
  } catch (e) {
    throw new AudoError(e?.name === 'TimeoutError' ? 'AUDO_TIMEOUT' : 'AUDO_UNREACHABLE', e?.name === 'TimeoutError' ? 'Audo did not respond in time.' : 'Audo could not be reached.');
  }
  if (res.status === 429) throw new AudoError('AUDO_RATE_LIMITED', 'Audo\'s free tier limit was reached (3 noise removals a day). Try again tomorrow or use local processing.');
  if (res.status === 413) throw new AudoError('AUDO_TOO_LARGE', 'Audo rejected the file size.');
  if (!res.ok) throw new AudoError('AUDO_HTTP_' + res.status, `Audo returned an error (HTTP ${res.status}).`);
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_RESULT) throw new AudoError('AUDO_RESULT_TOO_LARGE', 'Audo\'s result was larger than expected and was not used.');
  const out = Buffer.from(await res.arrayBuffer());
  if (out.length > MAX_RESULT) throw new AudoError('AUDO_RESULT_TOO_LARGE', 'Audo\'s result was larger than expected and was not used.');
  const sn = sniff(out);
  if (!sn || !sn.kinds.includes('audio')) throw new AudoError('AUDO_INVALID_RESULT', 'Audo did not return audio.');
  return {bytes: out, mime: sn.type};
}
