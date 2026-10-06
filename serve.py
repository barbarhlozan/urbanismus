#!/usr/bin/env python3
"""Local dev server with caching disabled, so edits show up on reload.

Usage:  python3 serve.py [port]      (default $PORT or 8173)
"""
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".webmanifest": "application/manifest+json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    # The browser requests many ES modules at once; the default backlog (5)
    # makes some connections get reset.
    request_queue_size = 128
    daemon_threads = True


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8173))
    print(f"Dědina running at http://localhost:{port}")
    Server(("", port), NoCacheHandler).serve_forever()
