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
        """Open native OS file picker to select an image and return as dataUrl."""
        window = self._get_window()
        if not window:
            return None
        try:
            import webview
            files = window.create_file_dialog(
                webview.OPEN_DIALOG,
                allow_multiple=False,
                file_types=("Image Files (*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif)", "All Files (*.*)")
            )
            if files and len(files) > 0:
                p = files[0]
                if os.path.exists(p):
                    with open(p, "rb") as f:
                        data = f.read()
                    ext = os.path.splitext(p)[1].lower().replace(".", "")
                    mime = "image/png"
                    if ext in ["jpg", "jpeg"]:
                        mime = "image/jpeg"
                    elif ext in ["webp", "gif", "bmp"]:
                        mime = f"image/{ext}"
                    b64 = base64.b64encode(data).decode("ascii")
                    return {
                        "success": True,
                        "dataUrl": f"data:{mime};base64,{b64}",
                        "filename": os.path.basename(p),
                        "path": p
                    }
            return None
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
    parser = argparse.ArgumentParser(description="PDF Studio Desktop Application")
    parser.add_argument("--port", type=int, default=8765, help="Port for the local server")
    parser.add_argument("--server-only", action="store_true", help="Run in headless server mode without opening a desktop window")
    parser.add_argument("--browser", action="store_true", help="Open in default system web browser")
    args = parser.parse_args()

    base_dir = os.path.dirname(os.path.abspath(__file__))
    ui_dir = os.path.join(base_dir, "ui")
    os.makedirs(ui_dir, exist_ok=True)

    pdf_dir = os.path.join(base_dir, "pdf")
    os.makedirs(pdf_dir, exist_ok=True)
    api = PDFStudioAPI(working_dir=base_dir, pdf_dir=pdf_dir)

    port = find_free_port(args.port)
    url = f"http://127.0.0.1:{port}"

    if args.server_only:
        print(f"PDF Studio desktop backend active at: {url}")
        print("Running in server-only mode. Press Ctrl+C to stop.")
        try:
            run_server(port, api, ui_dir)
        except KeyboardInterrupt:
            print("\nShutting down.")
        return

    server_thread = threading.Thread(target=run_server, args=(port, api, ui_dir), daemon=True)
    server_thread.start()

    print(f"PDF Studio desktop backend active at: {url}")

    if args.browser:
        print("Opening in system web browser...")
        webbrowser.open(url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nShutting down.")
        return

    # Native Desktop Application Mode using pywebview
    window_ref = [None]
    bridge = DesktopBridge(api, lambda: window_ref[0])

    try:
        import webview
        print("Launching native Windows desktop window...")
        window = webview.create_window(
            title="PDF Studio — Document Page Management & Editor",
            url=url,
            js_api=bridge,
            width=1340,
            height=860,
            min_size=(960, 600),
            background_color="#FFFFFF"
        )
        window_ref[0] = window
        # Use Edge Chromium for modern HTML5, Canvas, and drag-and-drop
        webview.start(gui="edgechromium", debug=False)
    except Exception as err:
        print(f"Native desktop window startup fallback: {err}")
        print(f"Opening browser at: {url}")
        webbrowser.open(url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
