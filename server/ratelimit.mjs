// Fixed-window rate limits per key (user id or hashed IP). In memory: fine for one server process.
export function createLimiter({now = () => Date.now()} = {}) {
  const hits = new Map();
  let sweep = now();
  return function allow(key, max, windowMs) {
    const t = now();
    if (t - sweep > 60000) { for (const [k, v] of hits) if (t - v.start > v.windowMs) hits.delete(k); sweep = t; }
    const h = hits.get(key);
    if (!h || t - h.start >= windowMs) { hits.set(key, {start: t, count: 1, windowMs}); return true; }
    h.count++;
    return h.count <= max;
  };
}
export const LIMITS = {
  analyze: [20, 60000],      // provider-backed or CPU-heavy analysis per user per minute
  privacy: [30, 60000],
  api: [240, 60000],         // report/team API calls per user per minute
  authFail: [20, 300000]     // failed authentications per IP per 5 minutes before it is marked suspicious
};
