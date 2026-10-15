"""Public front door for VOXA (safe to put behind a tunnel).

Serves only the public site files and NEVER forwards /api/* to the real backend (server.mjs),
because that backend spends the owner's provider keys. /api/status reports "no providers"
and every other /api call is refused, so the UI renders and degrades gracefully.
The full private app still runs locally: node server.mjs -> http://127.0.0.1:5174
Usage: python serve.py [port]"""
import http.server, json, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
ALLOW = re.compile(
    r'^/(?:|index\.html|login\.html|app\.html|design-tokens\.css'
    r'|css/[\w-]+\.css|js/[\w-]+\.js|assets/fonts/[\w-]+\.woff2)$')
NAMES = {'sealedrose': 'SealedRose', 'realitydefender': 'Reality Defender', 'luxand': 'Luxand',
         'gemini': 'Gemini', 'deepgram': 'Deepgram'}
NOTE = 'Disabled on the public demo.'
STATUS = {
    'freeMode': True, 'publicDemo': True,
    'providers': {k: False for k in NAMES},
    'details': {k: {'label': v, 'class': 'external', 'configured': False, 'allowed': False,
                    'blockedReason': NOTE, 'note': NOTE, 'docs': '', 'health': 'not-configured'}
                for k, v in NAMES.items()},
    'tools': {'ffmpeg': False, 'extension': False},
    'limits': {'voiceMB': 20, 'imageMB': 10, 'videoMB': 32},
    'authProvider': {'voice': None, 'image': None, 'video': None},
}
TYPES = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
         '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2'}


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'VOXA'

    def _send(self, code, body=b'', ctype='application/json', head=False):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Cache-Control', 'no-store' if ctype == 'application/json' else 'no-cache')
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def _json(self, code, obj, head=False):
        self._send(code, json.dumps(obj).encode(), head=head)

    def _handle(self, head=False):
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        if path.startswith('/api/'):
            if path == '/api/status' and self.command in ('GET', 'HEAD'):
                return self._json(200, STATUS, head)
            return self._json(503, {'error': 'Analysis is disabled on the public demo. Run VOXA locally to use it.',
                                    'code': 'PUBLIC_DEMO'}, head)
        if self.command not in ('GET', 'HEAD') or not ALLOW.match(path):
            return self._json(404 if self.command in ('GET', 'HEAD') else 405, {'error': 'Not found.'}, head)
        target = os.path.join(ROOT, 'index.html' if path == '/' else path.lstrip('/'))
        try:
            with open(target, 'rb') as f:
                data = f.read()
        except OSError:
            return self._json(404, {'error': 'Not found.'}, head)
        self._send(200, data, TYPES[os.path.splitext(target)[1]], head)

    def do_GET(self): self._handle()
    def do_HEAD(self): self._handle(head=True)
    def do_POST(self): self._drain(); self._handle()
    do_PUT = do_DELETE = do_PATCH = do_POST

    def _drain(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n:
            self.rfile.read(min(n, 1 << 20))  # discard (bounded) so keep-alive stays in sync

    def log_message(self, *a):
        pass


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256  # default 5 refuses bursts of parallel asset requests behind a tunnel
    daemon_threads = True


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    with Server(('127.0.0.1', port), Handler) as s:
        print(f'VOXA public demo on http://127.0.0.1:{port}')
        s.serve_forever()
