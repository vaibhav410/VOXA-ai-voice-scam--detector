// npm run public  — share the full VOXA app on the internet through a Cloudflare quick tunnel (HTTPS).
// 1) starts cloudflared and reads the https://*.trycloudflare.com address it is given;
// 2) starts VOXA trusting exactly that host/origin (plus localhost), so no other host name is accepted;
// 3) stops both together (Ctrl+C or closing the window).
// Safe to expose because analysis needs a Clerk sign-in, provider calls need consent and FREE_MODE, and the
// database is reached with the least-privilege voxa_app role. The address changes every time this runs.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PUBLIC_PORT || 5177);
const candidates = [process.env.CLOUDFLARED_PATH, 'C:/Users/LENOVO/cloudflared-bin/cloudflared.exe', 'cloudflared'].filter(Boolean);
const cloudflared = candidates.find(c => c === 'cloudflared' || existsSync(c));

const tunnel = spawn(cloudflared, ['tunnel', '--url', `http://127.0.0.1:${PORT}`, '--no-autoupdate'], {stdio: ['ignore', 'pipe', 'pipe']});
let server = null, done = false;
const stop = code => { if (done) return; done = true; try { server?.kill(); } catch {} try { tunnel.kill(); } catch {} process.exit(code); };
process.on('SIGINT', () => stop(0)); process.on('SIGTERM', () => stop(0));
tunnel.on('error', e => { console.error('cloudflared could not start: ' + e.message + '\nSet CLOUDFLARED_PATH to cloudflared.exe.'); stop(1); });
tunnel.on('exit', c => { if (!done) { console.error('The tunnel stopped (exit ' + c + ').'); stop(1); } });

const timer = setTimeout(() => { console.error('No tunnel address after 60 s. Check your internet connection.'); stop(1); }, 60000);
let buf = '';
const onData = d => {
  buf += d.toString();
  const m = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/.exec(buf);
  if (!m || server) return;
  clearTimeout(timer);
  const host = m[1], url = 'https://' + host;
  server = spawn(process.execPath, ['server.mjs', `--port=${PORT}`], {
    cwd: ROOT, stdio: 'inherit',
    env: {...process.env, PORT: String(PORT), ALLOWED_HOSTS: `${host},localhost,127.0.0.1`, ALLOWED_ORIGINS: `${url},http://127.0.0.1:${PORT},http://localhost:${PORT}`}
  });
  server.on('exit', c => { if (!done) { console.error('VOXA stopped (exit ' + c + ').'); stop(1); } });
  setTimeout(() => console.log(`\n  VOXA is public at:  ${url}\n  (this address changes each time you start the tunnel)\n`), 3000);
};
tunnel.stdout.on('data', onData); tunnel.stderr.on('data', onData);
