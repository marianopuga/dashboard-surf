#!/usr/bin/env python3
"""Local dev server: no Node/npm needed, just `python3 serve.py`.

Serves the static frontend and implements the same /api/mhl, /api/wind and
/api/tide endpoints the Vercel deployment exposes, reusing api/_lib.py.
"""
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "api"))
import _lib  # noqa: E402

ROOT = Path(__file__).parent
PORT = 8000

ROUTES = {
    "/api/mhl": _lib.get_latest_swell,
    "/api/wind": _lib.get_latest_wind,
    "/api/tide": _lib.get_tide_events,
    "/api/forecast": _lib.get_forecast,
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ROUTES:
            try:
                _lib.json_response(self, ROUTES[self.path]())
            except Exception as exc:  # noqa: BLE001
                _lib.error_response(self, str(exc))
            return
        self._serve_static()

    def _serve_static(self):
        rel = self.path.lstrip("/") or "index.html"
        file_path = (ROOT / rel).resolve()
        if ROOT not in file_path.parents and file_path != ROOT:
            self.send_error(403)
            return
        if not file_path.is_file():
            self.send_error(404)
            return
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
        }.get(file_path.suffix, "application/octet-stream")
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"[serve.py] {self.address_string()} - {fmt % args}")


if __name__ == "__main__":
    print(f"Surf dashboard running at http://localhost:{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
