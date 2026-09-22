#!/usr/bin/env python3
"""Serve the Video Drum Board to a phone or tablet on the same Wi-Fi, over HTTPS.

Safari only allows the camera and microphone on HTTPS pages, so this uses a
throwaway self-signed certificate. The phone warns that the connection is not
private the first time: tap Show Details, then "visit this website".

    python3 serve.py          # https://<this computer's address>:8443
    python3 serve.py 9443     # use another port
"""

import errno
import http.server
import os
import posixpath
import socket
import ssl
import subprocess
import sys
import tempfile
from urllib.parse import unquote

ROOT = os.path.dirname(os.path.abspath(__file__))
APP_FILES = ('/', '/index.html', '/style.css')
APP_DIRS = ('/js/',)


def lan_address():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('192.0.2.1', 9))  # sends nothing; just picks the outgoing interface
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


def make_certificate(folder, ip):
    config = os.path.join(folder, 'openssl.cnf')
    with open(config, 'w') as f:
        f.write(
            '[req]\ndistinguished_name = dn\nx509_extensions = ext\nprompt = no\n'
            '[dn]\nCN = Video Drum Board (local)\n'
            f'[ext]\nsubjectAltName = IP:{ip}, IP:127.0.0.1, DNS:localhost\n'
            'basicConstraints = critical, CA:false\n'
            'keyUsage = critical, digitalSignature, keyEncipherment\n'
            'extendedKeyUsage = serverAuth\n'
        )
    cert = os.path.join(folder, 'cert.pem')
    key = os.path.join(folder, 'key.pem')
    subprocess.run(
        ['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30',
         '-keyout', key, '-out', cert, '-config', config],
        check=True, capture_output=True,
    )
    return cert, key


class AppHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def send_head(self):
        # Only the app itself is served; nothing else in this folder is visible.
        path = posixpath.normpath(unquote(self.path.split('?', 1)[0].split('#', 1)[0]))
        if path not in APP_FILES and not path.startswith(APP_DIRS):
            self.send_error(404)
            return None
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Browsers hang up until the certificate has been accepted; that's expected.
        if isinstance(sys.exc_info()[1], (ssl.SSLError, ConnectionError)):
            return
        super().handle_error(request, client_address)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
    ip = lan_address()
    with tempfile.TemporaryDirectory() as folder:
        cert, key = make_certificate(folder, ip)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
    try:
        server = Server(('0.0.0.0', port), AppHandler)
    except OSError as err:
        if err.errno != errno.EADDRINUSE:
            raise
        sys.exit(
            f'Port {port} is already in use, so the server is probably already running.\n'
            f'On your phone, open:  https://{ip}:{port}\n'
            f'To start another copy on a different port:  python3 serve.py {port + 1}'
        )
    # Handshake in the request thread, so one stalled connection can't block the rest.
    server.socket = context.wrap_socket(server.socket, server_side=True, do_handshake_on_connect=False)
    print(f'On your phone (same Wi-Fi), open:  https://{ip}:{port}', flush=True)
    print('Safari will say the connection is not private: tap Show Details, then "visit this website".', flush=True)
    print('Press Ctrl+C to stop.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
