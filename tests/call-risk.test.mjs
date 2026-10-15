import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const ctx = vm.createContext({}); ctx.window = ctx;
for (const f of ['policies', 'rules', 'call-risk']) vm.runInContext(readFileSync(`js/${f}.js`, 'utf8'), ctx);
const R = ctx.VoxaCallRisk;
const ON = {autoEnd: {enabled: true}};
const scam1 = 'Hello, this is the bank manager. Please share the OTP you just received right now.';
const scam2 = 'Your account will be blocked. Do not tell anyone about this call. Give me the OTP immediately.';

test('auto-end is off by default and never triggers without being enabled', () => {
  assert.equal(R.normalizePolicy({}).autoEnd.enabled, false);
  const e = R.create({}, 'finance'), now = 1e6;
  e.add({text: scam1, final: true, confidence: 0.95, t: 2}, now); e.add({text: scam2, final: true, confidence: 0.95, t: 8}, now);
  const r = e.evaluate(now);
  assert.ok(['high', 'critical'].includes(r.state)); assert.equal(r.autoEnd.eligible, false); assert.match(r.autoEnd.why, /off/);
});
test('no speech is "pending", not low; missing analysis is "unavailable", never safe, never ends a call', () => {
  const e = R.create(ON, 'finance');
  assert.equal(e.evaluate().status, 'pending'); assert.equal(e.evaluate().state, null);
  e.add({text: scam1, final: true, confidence: 0.99, t: 1}); e.add({text: scam2, final: true, confidence: 0.99, t: 5});
  e.setAvailable(false, 'Live transcription disconnected.');
  const r = e.evaluate();
  assert.equal(r.status, 'unavailable'); assert.equal(r.state, null); assert.equal(r.autoEnd.eligible, false);
});
test('a single prediction, interim text or low-confidence speech never ends the call', () => {
  const now = 2e6;
  let e = R.create(ON, 'finance'); e.add({text: scam1 + ' ' + scam2, final: true, confidence: 0.98, t: 1}, now);
  assert.equal(e.evaluate(now).autoEnd.eligible, false, 'one statement is not repeated evidence');
  e = R.create(ON, 'finance'); e.add({text: scam1, final: false, t: 1}, now); e.add({text: scam2, final: false, t: 4}, now);
  const p = e.evaluate(now); assert.equal(p.status, 'pending'); assert.ok(p.provisional.length > 0, 'interim matches are shown as provisional'); assert.equal(p.autoEnd.eligible, false);
  e = R.create(ON, 'finance'); e.add({text: scam1, final: true, confidence: 0.5, t: 1}, now); e.add({text: scam2, final: true, confidence: 0.6, t: 6}, now);
  assert.equal(e.evaluate(now).autoEnd.eligible, false, 'uncertain recognition does not qualify');
});
test('repeated, confident evidence across statements meets the policy; stale analysis or "keep call" blocks it', () => {
  const now = 3e6;
  const e = R.create(ON, 'finance');
  e.add({text: scam1, final: true, confidence: 0.93, t: 3}, now); e.add({text: scam2, final: true, confidence: 0.91, t: 9}, now);
  const r = e.evaluate(now);
  assert.equal(r.state, 'critical'); assert.equal(r.autoEnd.eligible, true); assert.ok(r.autoEnd.reasons.length >= 2); assert.equal(r.autoEnd.countdownSeconds, 5);
  assert.ok(r.evidence.every(x => typeof x.t === 'number' && x.confidence > 0.9), 'evidence carries timestamps and confidence');
  assert.equal(e.evaluate(now + 25000).autoEnd.eligible, false, 'no fresh analysis -> no auto-end');
  e.cancelAutoEnd(now); assert.equal(e.evaluate(now).autoEnd.eligible, false);
});
test('ordinary conversation stays low and is never eligible', () => {
  const e = R.create(ON, 'personal');
  e.add({text: 'Hi, it is me. Are we still meeting for dinner on Friday at eight?', final: true, confidence: 0.97, t: 1});
  e.add({text: 'Great, I will book the table and see you there.', final: true, confidence: 0.96, t: 6});
  const r = e.evaluate(); assert.equal(r.state, 'low'); assert.equal(r.autoEnd.eligible, false);
});
test('policy values are clamped to safe ranges', () => {
  const p = R.normalizePolicy({thresholds: {medium: 5, high: 2, critical: 1}, autoEnd: {enabled: true, minEvidence: 1, minSegments: 0, minConfidence: 0.1, countdownSeconds: 0, minState: 'low'}});
  assert.ok(p.thresholds.high > p.thresholds.medium && p.thresholds.critical > p.thresholds.high);
  assert.equal(p.autoEnd.minEvidence, 2); assert.equal(p.autoEnd.minSegments, 2); assert.equal(p.autoEnd.minConfidence, 0.5); assert.equal(p.autoEnd.countdownSeconds, 3); assert.equal(p.autoEnd.minState, 'critical');
});
