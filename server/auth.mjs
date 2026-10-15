// Authentication (PRD FR-02, 13.4). Identity always comes from a verified Clerk session token, never from the
// request body. Demo mode exists only for local development and is refused in production by config.mjs.
export const DEMO_IDENTITY = Object.freeze({subject: 'demo|local', email: 'demo@voxa.local', name: 'Demo User', demo: true});

export function createAuth(cfg, deps = {}) {
  const mode = cfg.auth.mode;
  let verify = deps.verify, fetchProfile = deps.fetchProfile, client = null;
  if (mode === 'clerk' && !verify) {
    verify = async token => {
      const {verifyToken} = await import('@clerk/backend');
      return verifyToken(token, {secretKey: cfg.auth.clerkSecret, authorizedParties: cfg.origins, clockSkewInMs: 10000});
    };
  }
  if (mode === 'clerk' && !fetchProfile) {
    fetchProfile = async sub => {
      const {createClerkClient} = await import('@clerk/backend');
      client ??= createClerkClient({secretKey: cfg.auth.clerkSecret});
      const u = await client.users.getUser(sub);
      const primary = u.emailAddresses?.find(e => e.id === u.primaryEmailAddressId) || u.emailAddresses?.[0];
      return {email: primary?.emailAddress || null, emailVerified: primary?.verification?.status === 'verified', name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || null};
    };
  }
  const profiles = new Map(); // sub -> {at, profile}; short cache so every request does not call Clerk
  async function fromToken(token) {
    if (mode === 'demo') return DEMO_IDENTITY;
    if (!token || !/^[A-Za-z0-9._-]{20,8192}$/.test(token)) return null;
    let claims;
    try { claims = await verify(token); } catch { return {invalid: true}; }
    if (!claims || typeof claims.sub !== 'string' || !claims.sub) return {invalid: true};
    let p = profiles.get(claims.sub);
    if (!p || Date.now() - p.at > 300000) {
      let profile = {email: null, emailVerified: false, name: null};
      try { profile = await fetchProfile(claims.sub); } catch {}
      p = {at: Date.now(), profile}; profiles.set(claims.sub, p);
      if (profiles.size > 5000) profiles.delete(profiles.keys().next().value);
    }
    return {subject: claims.sub, sessionId: typeof claims.sid === 'string' ? claims.sid : null, ...p.profile};
  }
  return {
    mode,
    // HTTP: Authorization: Bearer <Clerk session token>
    identify: req => fromToken((/^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '') || [])[1]),
    // WebSocket: browsers cannot set headers, so the token travels as the 2nd subprotocol after "voxa-auth".
    identifyWs: req => {
      if (mode === 'demo') return Promise.resolve(DEMO_IDENTITY);
      const parts = String(req.headers['sec-websocket-protocol'] || '').split(',').map(s => s.trim());
      return fromToken(parts[0] === 'voxa-auth' ? parts[1] : null);
    }
  };
}
