"""
PDF Engine for PDF Studio Desktop Application.
Powered by PyMuPDF (fitz) for ultra-fast, high-fidelity PDF manipulation.
Preserves page geometry, orientation, and dimensions without quality loss.
"""

import os
import io
import uuid
import base64
import threading
from typing import List, Dict, Any, Optional, Tuple
import pymupdf  # PyMuPDF


class PDFEngine:
    def __init__(self, working_dir: Optional[str] = None, pdf_dir: Optional[str] = None):
        self.working_dir = working_dir or os.getcwd()
        self.pdf_dir = pdf_dir or os.path.join(self.working_dir, "pdf")
        os.makedirs(self.pdf_dir, exist_ok=True)
        self._doc_cache: Dict[str, pymupdf.Document] = {}
        self._thumb_cache: Dict[Tuple[str, int], bytes] = {}
        self._lock = threading.Lock()

    def list_working_dir_pdfs(self) -> List[Dict[str, Any]]:
        """List all PDF files in the pdf directory with metadata."""
        pdf_files = []
        try:
            for item in sorted(os.listdir(self.pdf_dir)):
                if item.lower().endswith(".pdf") and os.path.isfile(os.path.join(self.pdf_dir, item)):
                    full_path = os.path.join(self.pdf_dir, item)
                    size_bytes = os.path.getsize(full_path)
                    try:
                        doc = pymupdf.open(full_path)
                        page_count = len(doc)
                        doc.close()
                    except Exception:
                        page_count = 0
                    
                    pdf_files.append({
                        "name": item,
                        "path": full_path,
                        "size": size_bytes,
                        "page_count": page_count,
                    })
        except Exception as e:
            print(f"Error listing pdf directory PDFs: {e}")
        return pdf_files

    def get_directory_tree(self, sub_path: Optional[str] = None) -> Dict[str, Any]:
        """Return directory structure of the pdf directory for VS Code file explorer."""
        target_dir = os.path.join(self.pdf_dir, sub_path) if sub_path else self.pdf_dir
        folder_name = "pdf"
        items = []

        try:
            for entry in sorted(os.scandir(target_dir), key=lambda e: (not e.is_dir(), e.name.lower())):
                if entry.name.startswith("."):
                    continue

                is_dir = entry.is_dir()
                is_pdf = entry.name.lower().endswith(".pdf") and not is_dir
                page_count = 0
                if is_pdf:
                    try:
                        doc = pymupdf.open(entry.path)
                        page_count = len(doc)
                        doc.close()
                    except Exception:
                        page_count = 0

                items.append({
                    "name": entry.name,
                    "is_dir": is_dir,
                    "is_pdf": is_pdf,
                    "size": entry.stat().st_size if not is_dir else 0,
                    "page_count": page_count,
                    "rel_path": os.path.relpath(entry.path, self.pdf_dir).replace("\\", "/"),
                })
        except Exception as err:
            print(f"Error scanning pdf directory: {err}")

        return {
            "folder_name": folder_name,
            "folder_path": target_dir,
            "items": items
        }

    def load_pdf_from_file(self, file_path: str) -> Dict[str, Any]:
        """Load a PDF from disk and extract page metadata and thumbnails."""
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")
        
        file_name = os.path.basename(file_path)
        with open(file_path, "rb") as f:
            pdf_bytes = f.read()
        
        return self.load_pdf_from_bytes(pdf_bytes, file_name, file_path=file_path)

    def load_pdf_from_bytes(self, pdf_bytes: bytes, file_name: str, file_path: Optional[str] = None) -> Dict[str, Any]:
        """Load a PDF from bytes and generate metadata for each page."""
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        source_id = f"pdf_{uuid.uuid4().hex[:8]}"
        pages_data = []

        for page_idx in range(len(doc)):
            page = doc[page_idx]
            rect = page.rect
            rotation = page.rotation
            width = rect.width
            height = rect.height
            
            # Determine effective orientation based on visual aspect ratio
            # If rotated 90 or 270, effective width/height swap
            if rotation in (90, 270):
                effective_w, effective_h = height, width
            else:
                effective_w, effective_h = width, height

            is_landscape = effective_w > effective_h
            orientation_name = "Landscape" if is_landscape else "Portrait"

            pages_data.append({
                "id": f"p_{uuid.uuid4().hex[:8]}",
                "source_pdf_id": source_id,
                "source_pdf_name": file_name,
                "source_page_index": page_idx,
                "width": round(width, 2),
                "height": round(height, 2),
                "rotation": rotation,
                "effective_width": round(effective_w, 2),
                "effective_height": round(effective_h, 2),
                "orientation": orientation_name,
                "is_blank": False,
                "thumbnail": f"/api/thumbnail?sourceId={source_id}&pageIndex={page_idx}",
                "overlays": [],
            })

        # Cache the open document for instant thumbnail rendering
        with self._lock:
            if len(self._doc_cache) > 8:
                oldest_key = next(iter(self._doc_cache))
                old_doc = self._doc_cache.pop(oldest_key, None)
                if old_doc:
                    try:
                        old_doc.close()
                    except Exception:
                        pass
            self._doc_cache[source_id] = doc

        return {
            "source_id": source_id,
            "name": file_name,
            "path": file_path or "",
            "size": len(pdf_bytes),
            "page_count": len(pages_data),
            "pages": pages_data,
            "_raw_bytes": pdf_bytes,
            "bytes_b64": base64.b64encode(pdf_bytes).decode("ascii")
        }

    def list_working_dir_pdfs(self) -> List[Dict[str, Any]]:
        return []
