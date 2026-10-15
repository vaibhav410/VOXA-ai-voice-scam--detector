/* Authentication in the browser. The server decides the mode (/api/auth/config):
   - "clerk": loads Clerk, attaches the session token to this app's own /api requests (fetch, uploads, live socket),
     and keeps the visible session label in sync with the Clerk user. The token never goes to other origins.
   - "demo": nothing changes (local workspace, no real authentication).
   Only the publishable key reaches the browser; the secret key stays on the server. */
(() => {
  const CLERK_VERSION = '5.128.0';
  const state = { mode: null, clerk: null, token: null, config: null };
  const sameOriginApi = url => { try { const u = new URL(url, location.href); return u.origin === location.origin && u.pathname.startsWith('/api/'); } catch { return false; } };

  async function freshToken() {
    if (state.mode !== 'clerk' || !state.clerk?.session) return null;
    try { state.token = await state.clerk.session.getToken(); } catch { state.token = null; }
    return state.token;
  }

  // fetch: add Authorization for same-origin /api calls only
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (state.mode === 'clerk' && sameOriginApi(url)) {
      await ready;
      const token = await freshToken();
      if (token) { const h = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined)); h.set('Authorization', 'Bearer ' + token); init = { ...init, headers: h }; }
    }
    return nativeFetch(input, init);
  };
  // XHR (uploads with progress): uses the cached token, refreshed in the background
  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { this.__voxaApi = sameOriginApi(url); return open.call(this, method, url, ...rest); };
  XMLHttpRequest.prototype.send = function (body) { if (state.mode === 'clerk' && this.__voxaApi && state.token) this.setRequestHeader('Authorization', 'Bearer ' + state.token); return send.call(this, body); };

  function loadClerk(cfg) {
    return new Promise((resolve, reject) => {
      if (!cfg.clerkFrontendApi || !/^[a-z0-9.-]+$/i.test(cfg.clerkFrontendApi)) return reject(new Error('Clerk is not configured correctly on the server.'));
      const s = document.createElement('script');
      s.src = `https://${cfg.clerkFrontendApi}/npm/@clerk/clerk-js@${CLERK_VERSION}/dist/clerk.browser.js`;
      s.async = true; s.crossOrigin = 'anonymous';
      s.setAttribute('data-clerk-publishable-key', cfg.clerkPublishableKey);
      s.onload = async () => { try { await window.Clerk.load(); resolve(window.Clerk); } catch (e) { reject(e); } };
      s.onerror = () => reject(new Error('Could not load Clerk sign-in. Check your internet connection.'));
      document.head.appendChild(s);
    });
  }

  const ready = (async () => {
    try {
      const r = await nativeFetch('/api/auth/config', { headers: { Accept: 'application/json' } });
      state.config = await r.json();
      state.mode = state.config.authMode;
    } catch { state.mode = 'demo'; state.config = { authMode: 'demo', database: false }; }
    if (state.mode === 'clerk') {
      state.clerk = await loadClerk(state.config);
      await freshToken();
      setInterval(freshToken, 30000); // Clerk session tokens are short-lived; keep the cached one for uploads fresh
      const u = state.clerk.user;
      if (u) {
        const email = u.primaryEmailAddress?.emailAddress || '';
        try { localStorage.setItem('voxa:session', JSON.stringify({ name: u.fullName || u.username || email.split('@')[0] || 'Signed-in user', email, mode: 'clerk' })); } catch {}
      }
    }
    return state;
  })();

  window.VoxaAuth = {
    ready,
    get mode() { return state.mode; },
    get config() { return state.config; },
    get clerk() { return state.clerk; },
    signedIn: () => state.mode !== 'clerk' || Boolean(state.clerk?.user),
    // Browsers cannot set headers on WebSockets, so the token is sent as the second subprotocol.
    wsProtocols: () => (state.mode === 'clerk' && state.token ? ['voxa-auth', state.token] : undefined),
    async signOut() { if (state.mode === 'clerk' && state.clerk) await state.clerk.signOut(); try { localStorage.removeItem('voxa:session'); } catch {} }
  };
})();
