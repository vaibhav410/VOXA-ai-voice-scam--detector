// Turns a browser report (untrusted input) into what the database may hold (PRD FR-04, 13.3).
// Allow-list only. Never kept in the summary: transcripts, quoted excerpts, analyst notes, Gemini intelligence text
// (it paraphrases the transcript), raw provider payloads. Unavailable scores stay null and are never turned into 0.
export const REPORT_TYPES = ['voice_authenticity', 'scam_analysis', 'noise_analysis', 'privacy_analysis', 'image_authenticity', 'video_authenticity'];
const MODALITIES = ['voice', 'image', 'video', 'text'];
const PRIORITIES = ['low', 'medium', 'high', 'nee'];
const REVIEW = ['open', 'investigating', 'resolved', 'fp'];
const STATE_TO_STATUS = {complete: 'completed', completed: 'completed', partial: 'partial', insufficient: 'partial', failed: 'failed'};

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v, lo = -1e9, hi = 1e12) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const prob = v => num(v, 0, 1);
const code = v => (typeof v === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(v) ? v : null);
const pickEnum = (v, list) => (list.includes(v) ? v : null);

// Bounded generic JSON copy for structured, server-generated results (e.g. the noise report).
export function boundedJson(v, depth = 0) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v.slice(0, 600);
  if (depth >= 6) return null;
  if (Array.isArray(v)) return v.slice(0, 50).map(x => boundedJson(x, depth + 1));
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v).slice(0, 60)) if (/^[A-Za-z0-9_]{1,40}$/.test(k)) out[k] = boundedJson(x, depth + 1);
    return out;
  }
  return null;
}

const authResult = a => (a && typeof a === 'object' ? {
  status: pickEnum(a.status, ['ok', 'unavailable', 'not_provided']) || 'unavailable', provider: code(a.provider), code: code(a.code),
  aiScore: prob(a.aiScore), deepfakeScore: prob(a.deepfakeScore), confidence: prob(a.confidence), message: str(a.message, 300),
  models: Array.isArray(a.models) ? a.models.slice(0, 10).map(m => ({name: str(m?.name, 60), status: str(m?.status, 30), score: prob(m?.score)})) : undefined
} : null);

const runStatus = r => (r?.status === 'ok' ? 'ok' : r?.code === 'FREE_MODE_BLOCKED' ? 'blocked' : r?.code === 'NOT_CONFIGURED' ? 'skipped' : r ? 'unavailable' : null);

export function sanitizeReport(i, {retainTranscript = false} = {}) {
  if (!i || typeof i !== 'object') return {error: 'Report body is missing.'};
  const reportType = pickEnum(i.reportType, REPORT_TYPES);
  if (!reportType) return {error: 'Unknown report type.'};
  const clientRef = typeof i.id === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(i.id) ? i.id : null;
  if (!clientRef) return {error: 'Report id is missing or invalid.'};
  const hasMedia = i.media && typeof i.media === 'object';
  const modality = reportType === 'privacy_analysis' || (reportType === 'scam_analysis' && !hasMedia) ? 'text' : pickEnum(i.modality || 'voice', MODALITIES) || 'voice';
  const media = hasMedia ? {
    name: str(i.media.name, 200), size: num(i.media.size, 0, 5e9), duration: num(i.media.duration, 0, 86400), mime: code(String(i.media.mime || '').replace('/', '.'))?.replace('.', '/') || null,
    width: num(i.media.width, 0, 1e5), height: num(i.media.height, 0, 1e5), sampleRate: num(i.media.sampleRate, 0, 1e6), channels: num(i.media.channels, 0, 64),
    source: i.media.source === 'live' ? 'live' : 'upload'
  } : null;
  const it = i.intent && typeof i.intent === 'object' ? i.intent : null;
  const rules = Array.isArray(it?.rules) ? it.rules.slice(0, 40) : [];
  const intent = it ? {status: pickEnum(it.status, ['ok', 'insufficient']) || 'insufficient', score: num(it.score, 0, 1000), words: num(it.words, 0, 1e6), rules: rules.map(r => ({id: code(r?.id), label: str(r?.label, 80), weight: num(r?.weight, 0, 100)}))} : null;
  const priority = pickEnum(i.priority, PRIORITIES);
  const authenticity = reportType === 'noise_analysis' || reportType === 'privacy_analysis' ? null : authResult(i.authenticity);
  const audioAuthenticity = authResult(i.audioAuthenticity);
  const noise = reportType === 'noise_analysis' && i.noise ? boundedJson(i.noise) : null;
  const privacy = reportType === 'privacy_analysis' && i.privacy ? {
    engine: str(i.privacy.engine, 40), total: num(i.privacy.total, 0, 1e5), counts: boundedJson(i.privacy.counts || {}),
    findings: Array.isArray(i.privacy.findings) ? i.privacy.findings.slice(0, 200).map(f => ({category: code(f?.category), label: str(f?.label, 60), start: num(f?.start, 0, 1e6), end: num(f?.end, 0, 1e6), confidence: pickEnum(f?.confidence, ['high', 'medium', 'low']), masked: str(f?.masked, 24)})) : []
  } : null;

  const summary = {
    reportType, modality, priority, at: num(i.at, 0, 1e15), state: str(i.state, 20), sector: str(i.sector, 40), policyVersion: str(i.policyVersion, 40),
    media, authenticity, audioAuthenticity, intent, noise, privacy,
    extraction: i.extraction ? {status: str(i.extraction.status, 20), provider: code(i.extraction.provider)} : null,
    language: str(i.language, 16), meeting: i.meeting?.platform ? {platform: str(i.meeting.platform, 40)} : null,
    limitations: str(i.limitations, 2000), hasTranscript: Boolean(i.transcript?.text)
  };
  const json = JSON.stringify(summary);
  if (json.length > 64 * 1024) return {error: 'Report is too large to store.'};

  const findings = [];
  if (authenticity) findings.push({type: 'authenticity', score: authenticity.aiScore, label: authenticity.code || authenticity.status, evidence: {provider: authenticity.provider, status: authenticity.status, deepfakeScore: authenticity.deepfakeScore, confidence: authenticity.confidence}});
  if (audioAuthenticity) findings.push({type: 'authenticity', score: audioAuthenticity.aiScore, label: 'soundtrack:' + (audioAuthenticity.code || audioAuthenticity.status), evidence: {provider: audioAuthenticity.provider, status: audioAuthenticity.status}});
  if (intent && reportType !== 'noise_analysis' && reportType !== 'privacy_analysis') findings.push({type: 'scam_intent', score: intent.status === 'ok' ? intent.score : null, label: priority || 'nee', evidence: {ruleIds: intent.rules.map(r => r.id).filter(Boolean), words: intent.words}});
  if (noise) findings.push({type: 'noise', score: num(noise.noise?.snrDb), label: str(noise.noise?.level, 20), evidence: {speech: str(noise.speech?.detected, 12), quality: str(noise.quality?.rating, 12), indicators: Array.isArray(noise.noise?.indicators) ? noise.noise.indicators.map(x => code(x?.id)).filter(Boolean) : [], floorDbfs: num(noise.noise?.floorDbfs)}});
  if (privacy) findings.push({type: 'privacy', score: null, label: privacy.total > 0 ? 'possible_pii' : 'none_matched', evidence: {counts: privacy.counts}});

  const providerRuns = [];
  const addRun = (provider, task, r) => { const s = runStatus(r); if (provider && s) providerRuns.push({provider, task, status: s, errorCode: s === 'ok' ? null : code(r.code)}); };
  if (authenticity) addRun(authenticity.provider, 'authenticity', i.authenticity);
  if (audioAuthenticity) addRun(audioAuthenticity.provider, 'authenticity', i.audioAuthenticity);
  if (i.extraction?.provider) addRun(code(i.extraction.provider), 'transcription', {status: i.extraction.status === 'ok' ? 'ok' : 'unavailable', code: code(i.extraction.code)});
  if (reportType === 'noise_analysis') providerRuns.push({provider: 'voxa-local', task: 'noise', status: 'ok', errorCode: null});
  if (reportType === 'privacy_analysis') providerRuns.push({provider: 'voxa-local', task: 'privacy', status: 'ok', errorCode: null});

  // Sensitive text goes only into the encrypted column, and only when the caller asked to retain it.
  let sensitive = null;
  if (retainTranscript) {
    const text = reportType === 'privacy_analysis' ? str(i.privacy?.redactedText, 20000) : str(i.transcript?.text, 20000);
    const excerpts = rules.map(r => str(r?.excerpt, 300)).filter(Boolean);
    if (text || excerpts.length) sensitive = {text, excerpts, redacted: reportType === 'privacy_analysis'};
  }
  return {value: {
    clientRef, reportType, modality, status: STATE_TO_STATUS[i.state] || 'completed', reviewStatus: pickEnum(i.status, REVIEW) || 'open',
    title: media?.name || (reportType === 'privacy_analysis' ? str(i.title, 200) || 'Privacy scan' : null), sector: summary.sector, policyVersion: summary.policyVersion,
    uploadRef: typeof i.uploadId === 'string' && /^UP-[A-Za-z0-9]{4,20}$/.test(i.uploadId) ? i.uploadId : null,
    summary, findings, providerRuns, sensitive
  }};
}
