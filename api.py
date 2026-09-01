"""
API and HTTP Server for PDF Studio Desktop Application.
Exposes endpoints for PDF loading, blank page generation, high-res rendering, and export.
Serves static UI files and handles JSON API calls.
"""

import os
import io
import sys
import json
import base64
import urllib.parse
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, Any, Optional

from pdf_engine import PDFEngine


class RobustThreadingHTTPServer(ThreadingHTTPServer):
    """ThreadingHTTPServer that cleanly suppresses harmless client socket disconnects."""
    daemon_threads = True

    def handle_error(self, request, client_address):
        exc_type, _, _ = sys.exc_info()
        if exc_type in (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
            return
        super().handle_error(request, client_address)


class PDFStudioAPI:
    """Core API service interacting with PDFEngine and maintaining in-memory source cache."""
    def __init__(self, working_dir: Optional[str] = None, pdf_dir: Optional[str] = None):
        self.working_dir = working_dir or os.getcwd()
        self.pdf_dir = pdf_dir or os.path.join(self.working_dir, "pdf")
        os.makedirs(self.pdf_dir, exist_ok=True)
        self.engine = PDFEngine(self.working_dir, pdf_dir=self.pdf_dir)
        self.source_cache: Dict[str, bytes] = {}

    def get_working_dir_pdfs(self) -> Dict[str, Any]:
        pdfs = self.engine.list_working_dir_pdfs()
        return {"success": True, "pdfs": pdfs, "working_dir": self.pdf_dir}

    def get_directory_tree(self, sub_path: Optional[str] = None) -> Dict[str, Any]:
        tree = self.engine.get_directory_tree(sub_path)
        return {"success": True, **tree}

    def load_pdf_file(self, file_path_or_name: str) -> Dict[str, Any]:
        if not os.path.isabs(file_path_or_name):
            # Check pdf_dir first
            in_pdf_dir = os.path.join(self.pdf_dir, file_path_or_name)
            if os.path.exists(in_pdf_dir):
                file_path = in_pdf_dir
            else:
                file_path = os.path.join(self.working_dir, file_path_or_name)
        else:
            file_path = file_path_or_name

        data = self.engine.load_pdf_from_file(file_path)
        raw_bytes = data.pop("_raw_bytes", None)
        if not raw_bytes and "bytes_b64" in data:
            raw_bytes = base64.b64decode(data["bytes_b64"])
        self.source_cache[data["source_id"]] = raw_bytes
        # Avoid sending multi-megabyte base64 over HTTP JSON
        data.pop("bytes_b64", None)
        return {"success": True, "document": data}

    def upload_pdf_bytes(self, file_name: str, data_base64: str) -> Dict[str, Any]:
        if "," in data_base64:
            data_base64 = data_base64.split(",", 1)[1]
        pdf_bytes = base64.b64decode(data_base64)
        
        # Save uploaded file directly into the pdf/ directory
        saved_path = os.path.join(self.pdf_dir, file_name)
        with open(saved_path, "wb") as f:
            f.write(pdf_bytes)

        data = self.engine.load_pdf_from_bytes(pdf_bytes, file_name, file_path=saved_path)
        self.source_cache[data["source_id"]] = pdf_bytes
        data.pop("_raw_bytes", None)
        data.pop("bytes_b64", None)
        return {"success": True, "document": data}

    def get_thumbnail_png(self, source_id: str, page_index: int) -> Optional[bytes]:
        if source_id not in self.source_cache:
            return None
        pdf_bytes = self.source_cache[source_id]
        return self.engine.render_thumbnail_png(pdf_bytes, page_index, source_id=source_id)

    def get_high_res_page(self, source_id: str, page_index: int, rotation: int = 0) -> Dict[str, Any]:
        if source_id not in self.source_cache:
            return {"success": False, "error": f"Source document {source_id} not found in cache"}
        
        pdf_bytes = self.source_cache[source_id]
        img_url = self.engine.render_high_res_page(pdf_bytes, page_index, rotation)
        return {"success": True, "imageUrl": img_url}

    def create_blank_page(
        self,
        ref_width: float = 595.28,
        ref_height: float = 841.89,
        ref_rotation: int = 0,
        ref_orientation: Optional[str] = None
    ) -> Dict[str, Any]:
        blank_info = self.engine.create_blank_page_info(
            ref_width=ref_width,
            ref_height=ref_height,
            ref_rotation=ref_rotation,
            ref_orientation=ref_orientation
        )
        return {"success": True, "page": blank_info}

    def export_document(
        self,
        manifest: list,
        output_name: Optional[str] = None,
        custom_source_bytes: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        if custom_source_bytes:
            for s_id, b64_str in custom_source_bytes.items():
                if "," in b64_str:
                    b64_str = b64_str.split(",", 1)[1]
                self.source_cache[s_id] = base64.b64decode(b64_str)

        if not output_name:
            output_name = "Exported_Document.pdf"

        if not os.path.isabs(output_name):
            output_path = os.path.join(self.pdf_dir, output_name)
        else:
            output_path = output_name

        result = self.engine.export_pdf(manifest, self.source_cache, output_path)
        with open(output_path, "rb") as f:
            out_bytes = f.read()
        out_b64 = base64.b64encode(out_bytes).decode("ascii")

        return {
            "success": True,
            "output_path": output_path,
            "output_name": os.path.basename(output_path),
            "page_count": result["page_count"],
            "file_size": result["file_size"],
            "pdf_base64": out_b64,
        }


class PDFStudioHTTPHandler(SimpleHTTPRequestHandler):
    """HTTP Request Handler serving UI assets and JSON API."""
    api_instance: Optional[PDFStudioAPI] = None
    ui_dir: str = ""

    def __init__(self, *args, **kwargs):
        # Set directory for static file serving
        super().__init__(*args, directory=self.ui_dir, **kwargs)

    def end_headers(self):
        # Enable CORS and caching headers for desktop local app
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.OK)
        self.end_headers()

    def _send_json(self, data: Dict[str, Any], status=HTTPStatus.OK):
        try:
            content = json.dumps(data).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
            pass

    def _send_error_json(self, message: str, status=HTTPStatus.BAD_REQUEST):
        try:
            self._send_json({"success": False, "error": str(message)}, status=status)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
            pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/working_dir_pdfs":
            try:
                res = self.api_instance.get_working_dir_pdfs()
                self._send_json(res)
            except Exception as e:
                self._send_error_json(str(e))
            return

        if path == "/api/directory_tree":
            try:
                query_params = urllib.parse.parse_qs(parsed.query)
                sub_path = query_params.get("path", [None])[0]
                res = self.api_instance.get_directory_tree(sub_path)
                self._send_json(res)
            except Exception as e:
                self._send_error_json(str(e))
            return

        if path == "/api/thumbnail":
            try:
                query_params = urllib.parse.parse_qs(parsed.query)
                source_id = query_params.get("sourceId", [None])[0]
                page_index = int(query_params.get("pageIndex", [0])[0])

                if not source_id or source_id not in self.api_instance.source_cache:
                    self.send_error(HTTPStatus.NOT_FOUND, "Document source not found")
                    return

                png_bytes = self.api_instance.get_thumbnail_png(source_id, page_index)
                if png_bytes is None:
                    self.send_error(HTTPStatus.NOT_FOUND, "Thumbnail not available")
                    return

                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(png_bytes)))
                self.send_header("Cache-Control", "public, max-age=86400")
                self.end_headers()
                self.wfile.write(png_bytes)
            except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
                pass
            except Exception as e:
                self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, str(e))
            return


        # Default: serve static files from ui_dir
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        content_len = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_len) if content_len > 0 else b"{}"

        try:
            body = json.loads(post_data.decode("utf-8")) if post_data else {}
        except Exception:
            body = {}

        try:
            if path == "/api/load_file":
                filename = body.get("filePath") or body.get("fileName")
                if not filename:
                    return self._send_error_json("Missing filePath or fileName")
                res = self.api_instance.load_pdf_file(filename)
                return self._send_json(res)

            elif path == "/api/upload_pdf":
                filename = body.get("fileName", "Uploaded.pdf")
                data_b64 = body.get("dataBase64", "")
                if not data_b64:
                    return self._send_error_json("Missing dataBase64")
                res = self.api_instance.upload_pdf_bytes(filename, data_b64)
                return self._send_json(res)

            elif path == "/api/create_blank":
                w = float(body.get("refWidth", 595.28))
                h = float(body.get("refHeight", 841.89))
                rot = int(body.get("refRotation", 0))
                orient = body.get("refOrientation")
                res = self.api_instance.create_blank_page(w, h, rot, orient)
                return self._send_json(res)

            elif path == "/api/high_res_page":
                source_id = body.get("sourcePdfId")
                page_idx = int(body.get("sourcePageIndex", 0))
                rot = int(body.get("rotation", 0))
                res = self.api_instance.get_high_res_page(source_id, page_idx, rot)
                return self._send_json(res)

            elif path == "/api/export":
                manifest = body.get("manifest", [])
                out_name = body.get("outputPath") or body.get("outputName")
                custom_sources = body.get("sourceBytes")
                res = self.api_instance.export_document(manifest, out_name, custom_sources)
                return self._send_json(res)

            else:
                self._send_error_json("Endpoint not found", status=HTTPStatus.NOT_FOUND)

        except Exception as e:
            self._send_error_json(str(e), status=HTTPStatus.INTERNAL_SERVER_ERROR)
