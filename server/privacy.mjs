// Privacy scanner (PRD FR-05, 13.8). Local, rule-based PII recognizers: a documented fallback for Presidio, which
// needs Python. Best-effort by design: it can miss PII and can flag things that are not PII. A match means
// "possible personal data in this text", never "a data breach happened".
//
// Checksums are used wherever the format defines one (Aadhaar: Verhoeff; payment cards: Luhn), which removes most
// random-number false positives. Redaction always returns a separate string; the input is never modified.
export const ENGINE = 'voxa-pii-rules v1';
export const MAX_SCAN_CHARS = 20000;

const VERHOEFF_D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VERHOEFF_P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
export const verhoeffValid = digits => { let c = 0; const a = String(digits).split('').reverse().map(Number); for (let i = 0; i < a.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][a[i]]]; return c === 0; };
export const luhnValid = digits => { let s = 0, alt = false; for (let i = digits.length - 1; i >= 0; i--) { let n = digits.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; } return s % 10 === 0; };
const onlyDigits = s => s.replace(/\D/g, '');
const near = (text, start, end, re, span = 30) => re.test(text.slice(Math.max(0, start - span), Math.min(text.length, end + span)));

const UPI_HANDLES = 'okaxis|oksbi|okhdfcbank|okicici|ybl|ibl|axl|paytm|upi|apl|ptyes|ptaxis|pthdfc|ptsbi|yapl|airtel|jio|fbl|kotak|icici|hdfcbank|sbi|axisbank|freecharge|waaxis|wahdfcbank|wasbi|abfspay|naviaxis|superyes';
const R = [
  {category: 'EMAIL', label: 'Email address', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g, confidence: () => 'high'},
  {category: 'UPI_ID', label: 'UPI ID', re: new RegExp(`\\b[A-Za-z0-9._-]{2,64}@(?:${UPI_HANDLES})\\b`, 'gi'), confidence: () => 'high'},
  {category: 'CARD_NUMBER', label: 'Payment card number', re: /\b(?:\d[ -]?){12,18}\d\b/g, check: m => { const d = onlyDigits(m); return d.length >= 13 && d.length <= 19 && luhnValid(d); }, confidence: () => 'high'},
  {category: 'AADHAAR', label: 'Aadhaar number', re: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g, check: m => verhoeffValid(onlyDigits(m)), confidence: (t, s, e) => (near(t, s, e, /aadhaa?r|आधार|uid/i) ? 'high' : 'medium')},
  {category: 'PAN', label: 'PAN (Indian tax id)', re: /\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b/g, confidence: () => 'high'},
  {category: 'IFSC', label: 'IFSC bank branch code', re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, confidence: (t, s, e) => (near(t, s, e, /ifsc|branch|bank/i) ? 'high' : 'medium')},
  {category: 'PHONE', label: 'Phone number', re: /(?:\+91[\s-]?|\b0)?\b[6-9]\d{4}[\s-]?\d{5}\b|\+\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g, check: m => { const d = onlyDigits(m); return d.length >= 10 && d.length <= 13; }, confidence: (t, s) => (/^\+/.test(t.slice(s)) || near(t, s, s, /phone|mobile|call|number|whatsapp|फ़ोन|मोबाइल/i) ? 'high' : 'medium')},
  {category: 'BANK_ACCOUNT', label: 'Bank account number', re: /\b\d{9,18}\b/g, check: (m, t, s, e) => near(t, s, e, /account|a\/c|acct|khata|खाता|account no/i), confidence: () => 'medium'},
  {category: 'OTP_OR_PIN', label: 'OTP / PIN', re: /\b\d{4,8}\b/g, check: (m, t, s, e) => near(t, s, e, /\botp\b|one[- ]time|\bpin\b|passcode|verification code|ओटीपी|पिन/i, 25), confidence: (t, s, e) => (near(t, s, e, /\bpin\b|पिन/i, 25) ? 'high' : 'medium')},
  {category: 'IP_ADDRESS', label: 'IP address', re: /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, confidence: () => 'low'},
  {category: 'DATE_OF_BIRTH', label: 'Date of birth', re: /\b(?:0?[1-9]|[12]\d|3[01])[\/.-](?:0?[1-9]|1[0-2])[\/.-](?:19|20)\d{2}\b/g, check: (m, t, s, e) => near(t, s, e, /born|birth|dob|d\.o\.b|जन्म/i), confidence: () => 'medium'}
];
const RANK = {high: 3, medium: 2, low: 1};
const mask = v => { const s = String(v); const tail = s.replace(/\s/g, '').slice(-2); return '•'.repeat(Math.min(10, Math.max(3, s.length - 2))) + tail; };

export function scanText(input) {
  const text = String(input ?? '');
  if (text.length > MAX_SCAN_CHARS) return {error: 'TOO_LONG', message: `Scan up to ${MAX_SCAN_CHARS.toLocaleString()} characters at a time.`};
  const raw = [];
  for (const r of R) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(text))) {
      const s = m.index, e = s + m[0].length;
      if (r.check && !r.check(m[0], text, s, e)) continue;
      raw.push({category: r.category, label: r.label, start: s, end: e, confidence: r.confidence(text, s, e), value: m[0]});
    }
  }
  // Overlaps: keep the higher-confidence, then longer, match.
  raw.sort((a, b) => RANK[b.confidence] - RANK[a.confidence] || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const kept = [];
  for (const f of raw) if (!kept.some(k => f.start < k.end && k.start < f.end)) kept.push(f);
  kept.sort((a, b) => a.start - b.start);
  let redacted = '', pos = 0;
  for (const f of kept) { redacted += text.slice(pos, f.start) + `[${f.category}]`; pos = f.end; }
  redacted += text.slice(pos);
  const counts = {};
  for (const f of kept) counts[f.category] = (counts[f.category] || 0) + 1;
  return {
    engine: ENGINE, bestEffort: true, characters: text.length,
    findings: kept.map(({value, ...f}) => ({...f, masked: mask(value)})), // evidence is masked; the raw value is never returned
    counts, total: kept.length, redactedText: redacted,
    summary: kept.length ? `${kept.length} possible personal-data item${kept.length === 1 ? '' : 's'} found.` : 'No personal data matched the rules. That does not prove there is none.',
    limitations: [
      'Rule-based and best-effort: names, addresses and many free-form details are not detected, and some matches may not be personal data.',
      'A match means possible personal data in this text. It is not evidence that a data breach occurred.',
      'Detection is local; nothing is sent to a provider. Presidio (Python) is not used in this build.'
    ]
  };
}
