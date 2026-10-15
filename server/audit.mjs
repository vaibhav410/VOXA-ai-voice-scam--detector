// Security audit events + safe logging (PRD FR-08, 13.10).
// Events carry ids, action, outcome, severity, classification and a few short, allow-listed metadata fields.
// Never: passwords, tokens, API keys, encryption keys, raw media, transcripts or provider payloads.
import {createHash, randomUUID} from 'node:crypto';

const META_KEYS = new Set(['reason', 'role', 'previousRole', 'reportType', 'modality', 'providers', 'scope', 'count', 'route', 'status', 'retention', 'transcriptRetention', 'method', 'ipHash', 'limit', 'teamName', 'emailDomain', 'outcomeCode', 'categories']);
const SECRET_PATTERNS = [/sk_(test|live)_[A-Za-z0-9]+/g, /pk_(test|live)_[A-Za-z0-9+/=_-]+/g, /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, /Bearer\s+\S+/gi, /postgres(ql)?:\/\/[^\s]+/gi, /\b[A-Za-z0-9_-]{32,}\b/g];

export function scrub(value) {
  let s = String(value);
  for (const p of SECRET_PATTERNS) s = s.replace(p, '[redacted]');
  return s.slice(0, 200);
}
export function safeMetadata(meta = {}) {
  const out = {};
  for (const [k, v] of Object.entries(meta || {})) {
    if (!META_KEYS.has(k) || v === undefined || v === null) continue;
    if (Array.isArray(v)) out[k] = v.slice(0, 12).map(x => scrub(x).slice(0, 40));
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else out[k] = scrub(v);
  }
  return out;
}
export const hashIp = ip => (ip ? createHash('sha256').update('voxa-ip:' + ip).digest('hex').slice(0, 16) : null);

const SEVERITY = new Set(['info', 'low', 'medium', 'high']), OUTCOME = new Set(['success', 'denied', 'failure']), CLASS = new Set(['event', 'security_event', 'suspicious', 'alert']);

export function createAudit(db, logger = safeLogger()) {
  return async function record({actorUserId = null, teamId = null, action, targetType = null, targetId = null, outcome = 'success', severity = 'info', classification = 'event', correlationId = null, metadata = {}}) {
    const row = [actorUserId, teamId, String(action).slice(0, 64), targetType ? String(targetType).slice(0, 32) : null, targetId ? String(targetId).slice(0, 80) : null,
      OUTCOME.has(outcome) ? outcome : 'failure', SEVERITY.has(severity) ? severity : 'info', CLASS.has(classification) ? classification : 'event', correlationId, JSON.stringify(safeMetadata(metadata))];
    if (!db) { logger('audit', {action: row[2], outcome: row[5], severity: row[6]}); return null; }
    try {
      const [r] = await db.query('insert into voxa.audit_events (actor_user_id, team_id, action, target_type, target_id, outcome, severity, classification, correlation_id, metadata_json) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) returning id', row);
      return r.id;
    } catch { logger('audit_write_failed', {action: row[2]}); return null; } // auditing must never break the request
  };
}

// Structured log line with an allow-list of fields. Values are scrubbed; free text (transcripts) is never accepted.
const LOG_KEYS = new Set(['action', 'outcome', 'severity', 'route', 'status', 'code', 'ms', 'kind', 'count', 'version', 'message']);
export function safeLogger(write = line => process.stdout.write(line + '\n')) {
  return (event, fields = {}) => {
    const f = {};
    for (const [k, v] of Object.entries(fields)) if (LOG_KEYS.has(k) && v !== undefined) f[k] = typeof v === 'number' || typeof v === 'boolean' ? v : scrub(v);
    write(JSON.stringify({t: new Date().toISOString(), event: scrub(event).slice(0, 60), ...f}));
  };
}
export const correlationId = () => randomUUID();
