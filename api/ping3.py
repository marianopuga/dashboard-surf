"""Diagnostic endpoint: makes an outbound HTTPS fetch to a host that is
never blocked (ipify), using the same fetch() helper as the real
endpoints. Isolates generic outbound-network breakage from MHL/BOM
specifically blocking Vercel's egress IPs. Also reports the egress IP
itself, so we can check it against MHL/BOM.
"""
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib import fetch_json, json_response, error_response  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            data = fetch_json("https://api.ipify.org?format=json", timeout=8)
            json_response(self, {"ok": True, "stage": "ping3", "egress": data})
        except Exception as exc:  # noqa: BLE001
            error_response(self, f"ping3 fetch failed: {type(exc).__name__}: {exc}")
