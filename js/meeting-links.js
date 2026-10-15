/* Meeting-link rules shared by the browser and the server (loaded as a classic script and imported by Node).
   This only validates, stores and opens links. VOXA never joins a meeting, hears meeting audio or records participants. */
(function (root) {
  const MAX_LEN = 2048;
  const PLATFORMS = {
    meet: { name: 'Google Meet', example: 'https://meet.google.com/abc-defg-hij' },
    zoom: { name: 'Zoom', example: 'https://zoom.us/j/123456789' }
  };
  const MEET_PATHS = [/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/, /^\/lookup\/[A-Za-z0-9_-]{4,64}$/];
  const ZOOM_PATHS = [/^\/j\/\d{9,11}$/, /^\/wc\/join\/\d{9,11}$/, /^\/my\/[A-Za-z0-9._-]{1,64}$/];

  // Returns { ok:true, platform, url, display } or { ok:false, error }.
  function validate(platform, raw) {
    if (!PLATFORMS[platform]) return { ok: false, error: 'Unknown platform.' };
    if (typeof raw !== 'string') return { ok: false, error: 'Enter a meeting link.' };
    let text = raw.trim();
    if (!text) return { ok: false, error: 'Enter a meeting link.' };
    if (text.length > MAX_LEN) return { ok: false, error: 'That link is too long.' };
    if (/[\u0000-\u001f\u007f\s]/.test(text)) return { ok: false, error: 'A meeting link cannot contain spaces or control characters.' };
    // Any explicit scheme other than https is refused (javascript:, data:, file:, http:, ftp: ...).
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text);
    if (scheme && !/^https:\/\//i.test(text)) {
      // "host:port/path" has no scheme; everything else with a colon before the first slash is a scheme.
      if (!/^[a-z0-9.-]+:\d+(\/|$)/i.test(text)) return { ok: false, error: 'Only https:// meeting links are accepted.' };
    }
    if (!/^https:\/\//i.test(text)) text = 'https://' + text.replace(/^\/+/, '');
    let u;
    try { u = new URL(text); } catch { return { ok: false, error: 'That is not a valid link.' }; }
    if (u.protocol !== 'https:') return { ok: false, error: 'Only https:// meeting links are accepted.' };
    if (u.username || u.password) return { ok: false, error: 'Links with a username or password in the address are not accepted.' };
    if (u.port && u.port !== '443') return { ok: false, error: 'Meeting links cannot use a custom port.' };
    const host = u.hostname.toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(host) || host.includes('..') || host.includes('xn--')) return { ok: false, error: 'The link address contains unusual characters.' };
    const path = u.pathname.replace(/\/+$/, '') || '/';
    if (platform === 'meet') {
      if (host !== 'meet.google.com') return { ok: false, error: 'Google Meet links must be on meet.google.com.' };
      if (!MEET_PATHS.some(r => r.test(path))) return { ok: false, error: 'That is not a Google Meet meeting link. It should look like ' + PLATFORMS.meet.example + '.' };
    } else {
      if (!(host === 'zoom.us' || /^([a-z0-9-]+\.)+zoom\.us$/.test(host))) return { ok: false, error: 'Zoom links must be on zoom.us (or one of its subdomains).' };
      if (!ZOOM_PATHS.some(r => r.test(path))) return { ok: false, error: 'That is not a Zoom meeting link. It should look like ' + PLATFORMS.zoom.example + '.' };
    }
    u.hash = '';
    const url = u.toString();
    // Zoom links can carry a passcode; never show it back in full.
    const shown = new URL(url);
    if (shown.searchParams.has('pwd')) shown.searchParams.set('pwd', '••••');
    return { ok: true, platform, url, display: shown.toString().replace(/%E2%80%A2/g, '•') };
  }

  // Per-user storage in this browser. VOXA has no server accounts, so links are scoped to the signed-in workspace user.
  function currentUser() {
    try { const s = JSON.parse(localStorage.getItem('voxa:session')); return (s && typeof s.name === 'string' && s.name.trim() ? s.name.trim() : 'Demo User').slice(0, 40); } catch { return 'Demo User'; }
  }
  const key = user => 'voxa:meetlinks:' + user;
  function load(user = currentUser()) {
    try {
      const raw = JSON.parse(localStorage.getItem(key(user))) || {}, out = {};
      for (const p of Object.keys(PLATFORMS)) { const v = validate(p, raw[p]?.url); if (v.ok) out[p] = { url: v.url, savedAt: Number(raw[p].savedAt) || null }; } // re-validated on every read
      return out;
    } catch { return {}; }
  }
  function save(platform, url, user = currentUser()) {
    const v = validate(platform, url); if (!v.ok) return v;
    const all = load(user); all[platform] = { url: v.url, savedAt: Date.now() };
    try { localStorage.setItem(key(user), JSON.stringify(all)); } catch { return { ok: false, error: 'Browser storage is blocked or full, so the link could not be saved.', storage: true }; }
    return v;
  }
  function remove(platform, user = currentUser()) {
    const all = load(user); delete all[platform];
    try { if (Object.keys(all).length) localStorage.setItem(key(user), JSON.stringify(all)); else localStorage.removeItem(key(user)); } catch { return false; }
    return true;
  }
  // Opens in a new tab without giving the meeting page access to VOXA. Revalidates first, never joins or records anything.
  function open(platform, url) {
    const v = validate(platform, url); if (!v.ok) return false;
    const w = window.open(v.url, '_blank', 'noopener,noreferrer'); return Boolean(w) || true;
  }

  // Asks the VOXA server to validate the link with the same rules. A rejection (422) always wins. If the server cannot answer
  // (wrong port, server stopped, proxy error) the link has already passed the identical browser-side check, so it is accepted
  // with a note instead of blocking a basic feature.
  const SERVER_URL = 'http://127.0.0.1:5174';
  async function checkWithServer(platform, raw) {
    const local = validate(platform, raw);
    if (!local.ok) return { state: 'invalid', error: local.error };
    try {
      const r = await fetch('/api/meeting-link/validate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Voxa-Request': '1' }, body: JSON.stringify({ platform, url: raw }), signal: AbortSignal.timeout(8000) });
      let d = null; try { d = await r.json(); } catch {}
      if (r.status === 422 && d && d.code === 'INVALID_LINK' && typeof d.error === 'string') return { state: 'invalid', error: d.error };
      if (r.ok && d && d.ok === true && typeof d.url === 'string') { const again = validate(platform, d.url); if (again.ok) return { state: 'ok', url: again.url }; }
      return { state: 'unavailable', url: local.url, why: r.ok ? 'unexpected reply' : 'HTTP ' + r.status + (d && d.error ? ': ' + d.error : ', not a VOXA reply') };
    } catch { return { state: 'unavailable', url: local.url, why: 'no response' }; }
  }
  const unavailableNote = why => 'Checked in your browser only. The VOXA server check was unavailable (' + why + '). For the full check, open VOXA at ' + SERVER_URL + ' (start it with start-voxa.cmd).';

  root.VoxaMeetingLinks = { PLATFORMS, validate, currentUser, load, save, remove, open, checkWithServer, unavailableNote };
})(typeof globalThis !== 'undefined' ? globalThis : window);
