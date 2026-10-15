/* Live risk engine for VOXA Protected Calls. Pure logic (no DOM, no network) so it can be tested in Node.
   It reuses window.voxaScamIntent, the same rules used for uploaded recordings.

   Principles:
   - Only FINAL transcript segments count. Interim (still changing) text is shown as provisional and never escalates.
   - No speech yet = "pending", not "low". Analysis unavailable = "unavailable", never treated as safe.
   - Auto-end (off by default) needs: the chosen state or higher, at least N distinct pieces of evidence, from at
     least M separate final segments, each with recognizer confidence >= the minimum, while analysis is live.
     Then a countdown the user can cancel. One uncertain prediction can never end a call. */
window.VoxaCallRisk = (() => {
  const STATES = ['low', 'medium', 'high', 'critical'];
  const rank = s => STATES.indexOf(s);
  const DEFAULTS = Object.freeze({
    thresholds: {medium: 3, high: 6, critical: 10},
    autoEnd: {enabled: false, minState: 'critical', minEvidence: 2, minSegments: 2, minConfidence: 0.75, freshSeconds: 20, countdownSeconds: 5}
  });
  const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

  // Clamp a user-edited policy into safe ranges; never lets auto-end trigger on weaker evidence than one rule + 2 segments.
  function normalizePolicy(p = {}) {
    const t = p.thresholds || {}, a = p.autoEnd || {}, d = DEFAULTS;
    const medium = num(t.medium, 1, 50, d.thresholds.medium), high = num(t.high, medium + 0.1, 80, Math.max(d.thresholds.high, medium + 1)), critical = num(t.critical, high + 0.1, 120, Math.max(d.thresholds.critical, high + 1));
    return {
      thresholds: {medium, high, critical},
      autoEnd: {
        enabled: a.enabled === true,
        minState: a.minState === 'high' ? 'high' : 'critical',
        minEvidence: Math.round(num(a.minEvidence, 2, 10, d.autoEnd.minEvidence)),
        minSegments: Math.round(num(a.minSegments, 2, 10, d.autoEnd.minSegments)),
        minConfidence: num(a.minConfidence, 0.5, 0.99, d.autoEnd.minConfidence),
        freshSeconds: num(a.freshSeconds, 5, 120, d.autoEnd.freshSeconds),
        countdownSeconds: Math.round(num(a.countdownSeconds, 3, 30, d.autoEnd.countdownSeconds))
      }
    };
  }

  function create(policyIn, sector = 'personal') {
    const policy = normalizePolicy(policyIn);
    const finals = []; // {t, text, confidence}
    let interim = null, available = true, unavailableReason = null, lastMessageAt = null, cancelledAt = null;

    function stateFor(score, rules) {
      const th = policy.thresholds;
      let s = score >= th.critical ? 'critical' : score >= th.high ? 'high' : score >= th.medium ? 'medium' : 'low';
      if (rules.some(r => r.critical) && rank(s) < rank('high')) s = 'high'; // a critical request is never "low"
      return s;
    }

    function evaluate(now = Date.now()) {
      const fresh = lastMessageAt !== null && (now - lastMessageAt) / 1000 <= policy.autoEnd.freshSeconds;
      if (!available) return {status: 'unavailable', reason: unavailableReason, state: null, score: null, evidence: [], provisional: [], autoEnd: {eligible: false, why: 'Analysis is unavailable, so the call is not judged and will not be ended automatically.'}};
      const text = finals.map(f => f.text).join('. ');
      const overall = window.voxaScamIntent(text, sector);
      // Per-rule evidence: which final segments matched it, when, and how confident the recognizer was.
      const evidence = overall.rules.map(r => {
        const segs = finals.filter(f => window.voxaScamIntent(f.text, sector).rules.some(x => x.id === r.id));
        const strong = segs.filter(f => typeof f.confidence === 'number' && f.confidence >= policy.autoEnd.minConfidence);
        return {id: r.id, label: r.label, weight: r.weight, critical: r.critical, excerpt: (segs[0]?.text || r.excerpt).slice(0, 200),
          t: segs[0]?.t ?? null, segments: segs.length, confidence: segs.length ? Math.min(...segs.map(f => (typeof f.confidence === 'number' ? f.confidence : 0))) : null,
          qualifies: strong.length > 0, strongSegments: strong};
      });
      const provisional = interim ? window.voxaScamIntent(interim.text, sector).rules.filter(r => !overall.rules.some(x => x.id === r.id)).map(r => ({id: r.id, label: r.label})) : [];
      if (!finals.length || (overall.status !== 'ok' && !overall.rules.length)) {
        return {status: 'pending', state: null, score: overall.score, evidence, provisional, words: overall.words, autoEnd: {eligible: false, why: 'Not enough confirmed speech yet.'}};
      }
      const state = stateFor(overall.score, overall.rules);
      const confs = finals.map(f => f.confidence).filter(c => typeof c === 'number');
      const avgConfidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
      // Auto-end eligibility (hysteresis by repetition + confidence + freshness)
      const a = policy.autoEnd, q = evidence.filter(e => e.qualifies);
      const segSet = new Set(q.flatMap(e => e.strongSegments.map(s => s.t)));
      const checks = [
        [a.enabled, 'Auto-end is off.'],
        [cancelledAt === null, 'You chose to keep this call.'],
        [fresh, 'Analysis has not reported recently.'],
        [rank(state) >= rank(a.minState), `Risk is ${state}; auto-end needs ${a.minState}.`],
        [q.length >= a.minEvidence, `${q.length} confident piece${q.length === 1 ? '' : 's'} of evidence; needs ${a.minEvidence}.`],
        [segSet.size >= a.minSegments, `Evidence from ${segSet.size} separate statement${segSet.size === 1 ? '' : 's'}; needs ${a.minSegments}.`]
      ];
      const failed = checks.find(([ok]) => !ok);
      return {
        status: 'ok', state, score: overall.score, confidence: avgConfidence, words: overall.words,
        evidence: evidence.map(({strongSegments, ...e}) => e), provisional,
        autoEnd: failed ? {eligible: false, why: failed[1]} : {eligible: true, why: 'Repeated, confident evidence met the auto-end policy.', reasons: q.map(e => e.label), countdownSeconds: a.countdownSeconds}
      };
    }

    return {
      policy,
      // t = seconds since the call started; confidence = recognizer confidence 0..1 (null if not given)
      add({text, final, confidence = null, t = 0}, now = Date.now()) {
        lastMessageAt = now;
        const clean = String(text || '').trim();
        if (!clean) return;
        if (final) { finals.push({t, text: clean.slice(0, 2000), confidence: typeof confidence === 'number' ? confidence : null}); interim = null; if (finals.length > 400) finals.shift(); }
        else interim = {t, text: clean.slice(0, 2000)};
      },
      heartbeat(now = Date.now()) { lastMessageAt = now; },
      setAvailable(ok, reason = null) { available = Boolean(ok); unavailableReason = ok ? null : reason || 'Analysis is unavailable.'; },
      cancelAutoEnd(now = Date.now()) { cancelledAt = now; },
      evaluate,
      transcript: () => finals.map(f => f.text).join(' ')
    };
  }
  return {STATES, DEFAULTS, normalizePolicy, create};
})();
