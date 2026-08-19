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

    def render_thumbnail_png(self, pdf_bytes: bytes, page_idx: int, source_id: Optional[str] = None) -> bytes:
        """Render a single page thumbnail as raw PNG bytes with memory caching."""
        cache_key = (source_id, page_idx) if source_id else None
        if cache_key and cache_key in self._thumb_cache:
            return self._thumb_cache[cache_key]

        with self._lock:
            if cache_key and cache_key in self._thumb_cache:
                return self._thumb_cache[cache_key]

            doc = None
            should_close = False
            if source_id and source_id in self._doc_cache:
                doc = self._doc_cache[source_id]
            else:
                doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
                if source_id:
                    self._doc_cache[source_id] = doc
                else:
                    should_close = True

            if page_idx < 0 or page_idx >= len(doc):
                if should_close:
                    doc.close()
                raise IndexError("Page index out of range")

            page = doc[page_idx]
            rect = page.rect
            scale = 220.0 / max(rect.height, 1.0)
            dpi = int(72 * max(scale, 0.4))
            pix = page.get_pixmap(dpi=dpi)
            png_bytes = pix.tobytes(output="png")

            if should_close:
                doc.close()

            if cache_key:
                if len(self._thumb_cache) > 2500:
                    # Evict oldest entries
                    for k in list(self._thumb_cache.keys())[:500]:
                        self._thumb_cache.pop(k, None)
                self._thumb_cache[cache_key] = png_bytes

            return png_bytes

    def close_source(self, source_id: str):
        """Release cached document and thumbnails for a closed document."""
        with self._lock:
            doc = self._doc_cache.pop(source_id, None)
            if doc:
                try:
                    doc.close()
                except Exception:
                    pass
            keys_to_del = [k for k in self._thumb_cache if k[0] == source_id]
            for k in keys_to_del:
                self._thumb_cache.pop(k, None)

    def render_high_res_page(self, pdf_bytes: bytes, page_idx: int, rotation: int = 0) -> str:
        """Render a single page at high resolution (e.g. 150 DPI) for the annotation editor."""
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        if page_idx < 0 or page_idx >= len(doc):
            doc.close()
            raise IndexError("Page index out of range")
        
        page = doc[page_idx]
        if rotation != page.rotation:
            page.set_rotation(rotation)
            
        pix = page.get_pixmap(dpi=150)
        img_bytes = pix.tobytes(output="png")
        doc.close()
        return "data:image/png;base64," + base64.b64encode(img_bytes).decode("ascii")

    def list_working_dir_pdfs(self) -> List[Dict[str, Any]]:
        return []
