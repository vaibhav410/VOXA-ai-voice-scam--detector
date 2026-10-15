import { randomUUID } from 'node:crypto';
import { blockReason } from './free-mode.mjs';
import { missing, request, failure } from './providers.mjs';

// Reality Defender REST flow (https://docs.realitydefender.com/api-reference/quickstart):
// presigned URL -> PUT file -> poll the media result by requestId.
const P = 'realitydefender';
const BASE = 'https://api.prd.realitydefender.xyz';
export const RD_EXT = {'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/flac': 'flac', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov'};
export const RD_LIMIT_MB = {voice: 20, image: 50, video: 250};
export const rdPoll = {intervalMs: 4000, maxMs: 100000};
const IN_PROGRESS = new Set(['ANALYZING', 'DOWNLOADING']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function normalizeRD(d) {
  const raw = d?.resultsSummary?.status || d?.overallStatus;
  if (typeof raw !== 'string') return missing(P, 'Reality Defender returned an unreadable result.', 'INVALID_RESPONSE');
  if (IN_PROGRESS.has(raw)) return null;
  const models = (Array.isArray(d.models) ? d.models : [])
    .filter(m => m && m.status !== 'NOT_APPLICABLE' && m.code !== 'not_applicable' && m.status !== 'ANALYZING' && typeof m.name === 'string')
    .map(m => ({name: m.name.slice(0, 80), status: m.status === 'FAKE' ? 'MANIPULATED' : String(m.status), score: typeof m.predictionNumber === 'number' ? m.predictionNumber : null}));
  const fs = d.resultsSummary?.metadata?.finalScore;
  const score = typeof fs === 'number' && fs >= 0 && fs <= 100 ? fs / 100 : null;
  const base = {status: 'ok', provider: P, requestId: typeof d.requestId === 'string' ? d.requestId : null, score, aiScore: score, models};
  if (raw === 'AUTHENTIC') return {...base, code: 'NOT_FLAGGED', message: 'Reality Defender did not flag this media as manipulated.'};
  if (raw === 'FAKE' || raw === 'MANIPULATED') return {...base, code: 'AI_GENERATED', message: 'Reality Defender flagged this media as manipulated.'};
  if (raw === 'SUSPICIOUS') return {...base, code: 'SUSPICIOUS', message: 'Reality Defender found this media suspicious but not conclusive.'};
  if (raw === 'NOT_APPLICABLE') return missing(P, 'Reality Defender could not evaluate this type of content.', 'NOT_APPLICABLE');
  if (raw === 'UNABLE_TO_EVALUATE') return missing(P, 'Reality Defender could not evaluate this media (often a timeout). Retry, or try a shorter or smaller file.', 'UNABLE_TO_EVALUATE');
  return missing(P, 'Reality Defender returned an unknown status.', 'INVALID_RESPONSE');
}

export async function detectRD({modality, bytes, mime, keys, signal}, fetcher = fetch) {
  if (!keys.realitydefender) return missing(P, 'No Reality Defender key configured.', 'NOT_CONFIGURED');
  const blocked = blockReason(P); if (blocked) return missing(P, blocked, 'FREE_MODE_BLOCKED');
  const ext = RD_EXT[mime];
  if (!ext) return missing(P, `Reality Defender does not accept ${mime}. Use wav, mp3, flac, ogg or m4a for audio; jpg, png or webp for images.`, 'UNSUPPORTED_MEDIA');
  const limit = RD_LIMIT_MB[modality];
  if (bytes.length > limit * 1048576) return missing(P, `Reality Defender accepts ${modality} files up to ${limit} MB.`, 'SIZE_LIMIT');
  const auth = {'X-API-KEY': keys.realitydefender};
  try {
    const up = await request(`${BASE}/api/files/aws-presigned`, {method: 'POST', signal, headers: {...auth, 'Content-Type': 'application/json'}, body: JSON.stringify({fileName: `voxa-${randomUUID().slice(0, 8)}.${ext}`})}, fetcher);
    const signed = up?.response?.signedUrl, requestId = up?.requestId;
    if (typeof signed !== 'string' || !/^https:\/\//.test(signed) || typeof requestId !== 'string' || !requestId) return missing(P, 'Reality Defender returned an unexpected upload response.', 'INVALID_RESPONSE');
    const put = await fetcher(signed, {method: 'PUT', body: bytes, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000)});
    if (!put.ok) return missing(P, `Uploading to Reality Defender failed (HTTP ${put.status}).`, 'UPLOAD_FAILED');
    const started = Date.now();
    for (;;) {
      try {
        const r = normalizeRD(await request(`${BASE}/api/media/users/${encodeURIComponent(requestId)}`, {method: 'GET', signal, headers: auth}, fetcher));
        if (r) return r;
      } catch (e) { if (!(e.status === 404 && Date.now() - started < 20000)) throw e; }
      if (Date.now() - started > rdPoll.maxMs) return missing(P, 'Reality Defender is still analyzing this file. Try again in a minute.', 'TIMEOUT');
      await sleep(rdPoll.intervalMs);
    }
  } catch (e) { return failure(P, e, 'Authenticity check'); }
}
