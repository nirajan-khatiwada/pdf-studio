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


class DesktopBridge:
    """JavaScript API bridge exposed directly into the WebView window."""
    def __init__(self, api: PDFStudioAPI, window_getter):
        self.api = api
        self._get_window = window_getter

    def open_native_pdf_dialog(self):
        """Open native OS file picker to select one or more PDF files."""
        window = self._get_window()
        if not window:
            return []
        try:
            import webview
            files = window.create_file_dialog(
                webview.OPEN_DIALOG,
                allow_multiple=True,
                file_types=("PDF Files (*.pdf)", "All Files (*.*)")
            )
            return list(files) if files else []
        except Exception as e:
            print(f"Error opening native file dialog: {e}")
            return []

    def open_native_image_dialog(self):
        """Open native OS file picker to select an image."""
        window = self._get_window()
        if not window:
            return None
        try:
            import webview
            files = window.create_file_dialog(
                webview.OPEN_DIALOG,
                allow_multiple=False,
                file_types=("Image Files (*.png;*.jpg;*.jpeg)", "All Files (*.*)")
            )
            return files[0] if files else None
        except Exception as e:
            print(f"Error opening native image dialog: {e}")
            return None

    def save_native_pdf_dialog(self, default_filename: str = "Exported_Document.pdf"):
        """Open native OS file save dialog."""
        window = self._get_window()
        if not window:
            return None
        try:
            import webview
            path = window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=default_filename,
                file_types=("PDF Files (*.pdf)",)
            )
            return path
        except Exception as e:
            print(f"Error opening save file dialog: {e}")
            return None


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
