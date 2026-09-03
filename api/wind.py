from http.server import BaseHTTPRequestHandler

from _lib import get_latest_wind, json_response, error_response


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            json_response(self, get_latest_wind())
        except Exception as exc:  # noqa: BLE001 - surface upstream failure to the client
            error_response(self, f"BOM wind fetch failed: {exc}")
