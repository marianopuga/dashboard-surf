"""Diagnostic endpoint: imports _lib.py (cross-file import + json_response
helper) but makes no external network call. Isolates whether the crash is
in the shared-module import mechanism vs. the outbound fetch itself.
"""
from http.server import BaseHTTPRequestHandler

from _lib import deg_to_compass, json_response


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        json_response(self, {"ok": True, "stage": "ping2", "compass": deg_to_compass(90)})
