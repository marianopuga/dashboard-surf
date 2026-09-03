from http.server import BaseHTTPRequestHandler

from _lib import get_latest_swell, json_response, error_response


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            json_response(self, get_latest_swell())
        except Exception as exc:  # noqa: BLE001 - surface upstream failure to the client
            error_response(self, f"MHL fetch failed: {exc}")
