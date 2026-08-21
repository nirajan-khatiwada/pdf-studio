"""
PDF Studio - Desktop Application Entrypoint.
Launches a native desktop window using pywebview (Edge Chromium WebView2)
and hosts the local Python API and shadcn/ui frontend.
"""

import os
import sys
import time
import socket
import argparse
import threading
import webbrowser
from typing import Optional

from api import PDFStudioAPI, PDFStudioHTTPHandler, RobustThreadingHTTPServer


def find_free_port(start_port: int = 8765) -> int:
    """Find a free local port starting from start_port."""
    port = start_port
    while port < start_port + 100:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                port += 1
    return start_port


def run_server(port: int, api: PDFStudioAPI, ui_dir: str):
    """Run the robust multi-threaded HTTP server."""
    PDFStudioHTTPHandler.api_instance = api
    PDFStudioHTTPHandler.ui_dir = ui_dir
    server = RobustThreadingHTTPServer(("127.0.0.1", port), PDFStudioHTTPHandler)
    server.serve_forever()


def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    ui_dir = os.path.join(base_dir, "ui")
    port = find_free_port()
    run_server(port, PDFStudioAPI(), ui_dir)

if __name__ == "__main__":
    main()
