import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lib import get_tide_events, json_response, error_response  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            json_response(self, get_tide_events())
        except Exception as exc:  # noqa: BLE001 - surface upstream failure to the client
            error_response(self, f"BOM tide fetch failed: {exc}")
