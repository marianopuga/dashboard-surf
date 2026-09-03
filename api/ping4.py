"""Diagnostic: report Python version, bundled files, and the exact
import error for _lib, all caught so nothing crashes the invocation.
"""
import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        info = {
            "python_version": sys.version,
            "cwd": os.getcwd(),
            "file_dir": os.path.dirname(os.path.abspath(__file__)),
            "file_dir_listing": None,
            "cwd_listing": None,
            "sys_path": sys.path,
            "import_lib_result": None,
        }
        try:
            info["file_dir_listing"] = sorted(os.listdir(info["file_dir"]))
        except Exception as exc:  # noqa: BLE001
            info["file_dir_listing"] = f"error: {exc}"
        try:
            info["cwd_listing"] = sorted(os.listdir(info["cwd"]))
        except Exception as exc:  # noqa: BLE001
            info["cwd_listing"] = f"error: {exc}"
        try:
            import _lib  # noqa: F401
            info["import_lib_result"] = "OK"
        except Exception:
            info["import_lib_result"] = traceback.format_exc()

        body = json.dumps(info, indent=2).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
