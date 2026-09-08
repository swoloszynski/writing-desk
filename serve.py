#!/usr/bin/env python3
"""Static file server for local development.

The same as `python3 -m http.server`, except it tells the browser not to
cache anything. Without that, an edited .js file keeps being served out of
the browser cache and you end up debugging code that is no longer running.
"""

import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    # Python's mimetypes table has never heard of .webmanifest, and a manifest
    # served as octet-stream is a manifest the browser ignores — which shows up
    # as the desk simply not offering to install.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.webmanifest': 'application/manifest+json'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4175

    # Pass --lan to bind every interface, so a phone on the same network can
    # reach it. Off by default: it exposes the directory to anyone on the
    # network, which is not what you want by accident.
    lan = '--lan' in sys.argv
    host = '0.0.0.0' if lan else '127.0.0.1'

    print(f'writing desk: http://localhost:{port}/')
    if lan:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(('8.8.8.8', 80))
            print(f'on this network: http://{s.getsockname()[0]}:{port}/')
        except OSError:
            print('on this network: could not determine the address')
        finally:
            s.close()

    ThreadingHTTPServer((host, port), NoCacheHandler).serve_forever()
