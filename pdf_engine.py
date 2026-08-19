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

    def create_sample_documents(self) -> List[str]:
        """
        Generate two high quality sample PDFs in the working directory:
        1. Sample_Report_Portrait.pdf (A4 Portrait, 3 pages)
        2. Sample_Deck_Landscape.pdf (16:9 Landscape, 3 pages)
        Allows instant testing of multiple PDFs with mixed orientations!
        """
        created = []
        path1 = os.path.join(self.working_dir, "Sample_Report_Portrait.pdf")
        doc1 = pymupdf.open()
        titles1 = ["Executive Summary & Overview", "Statistical Findings & Analysis", "Recommendations & Next Steps"]
        colors1 = [(0.1, 0.2, 0.4), (0.15, 0.35, 0.25), (0.35, 0.15, 0.25)]
        
        for i, (title, color) in enumerate(zip(titles1, colors1)):
            p = doc1.new_page(width=595.28, height=841.89)
            p.draw_rect(pymupdf.Rect(40, 40, 555.28, 85), color=color, fill=color)
            p.insert_text(pymupdf.Point(55, 70), f"SAMPLE REPORT · A4 PORTRAIT · PAGE {i + 1}", fontsize=12, color=(1, 1, 1), fontname="hebo")
            p.insert_text(pymupdf.Point(55, 130), title, fontsize=22, color=(0.1, 0.1, 0.1), fontname="hebo")
            p.draw_line(pymupdf.Point(55, 145), pymupdf.Point(540, 145), color=(0.8, 0.8, 0.8), width=1.5)
            
            body_text = (
                f"Page {i + 1} of Portrait Document.\n\n"
                "Overview and specifications:\n"
                "- Continuous multi-page workspace\n"
                "- Orientation-preserving page extraction\n"
                "- Blank page insertion matching neighbor geometry\n"
                "- Precise text and image overlay positioning\n"
                "- Lossless PDF document compilation"
            )
            p.insert_textbox(pymupdf.Rect(55, 165, 540, 450), body_text, fontsize=13, fontname="helv", color=(0.2, 0.2, 0.2))
            p.draw_line(pymupdf.Point(55, 790), pymupdf.Point(540, 790), color=(0.85, 0.85, 0.85), width=1)
            p.insert_text(pymupdf.Point(55, 808), "Document ID: SR-PORTRAIT-2026", fontsize=9, color=(0.5, 0.5, 0.5), fontname="helv")
            p.insert_text(pymupdf.Point(500, 808), f"Page {i + 1} of 3", fontsize=9, color=(0.5, 0.5, 0.5), fontname="helv")

        doc1.save(path1)
        doc1.close()
        created.append(path1)

        path2 = os.path.join(self.working_dir, "Sample_Deck_Landscape.pdf")
        doc2 = pymupdf.open()
        titles2 = ["Q3 Machine Learning & Data Pipeline", "Model Architecture & Evaluation", "Production Deployment Metrics"]
        
        for i, title in enumerate(titles2):
            p = doc2.new_page(width=841.89, height=595.28)
            p.draw_rect(pymupdf.Rect(0, 0, 841.89, 8), color=(0.15, 0.38, 0.85), fill=(0.15, 0.38, 0.85))
            p.insert_text(pymupdf.Point(50, 65), "SLIDE DECK · LANDSCAPE ORIENTATION (842 × 595 pt)", fontsize=11, color=(0.4, 0.4, 0.4), fontname="hebo")
            p.insert_text(pymupdf.Point(50, 110), title, fontsize=24, color=(0.08, 0.12, 0.2), fontname="hebo")
            p.draw_line(pymupdf.Point(50, 125), pymupdf.Point(790, 125), color=(0.88, 0.88, 0.88), width=1)

            col1 = (
                "Key Highlights:\n\n"
                "- Continuous multi-PDF workspace\n"
                "- Exact landscape aspect ratio preservation\n"
                "- Inherited blank slide creation\n"
                "- Drag and drop between mixed formats"
            )
            col2 = (
                "Technical Verification:\n\n"
                "- True PDF point measurements\n"
                "- Lossless vector and raster extraction\n"
                "- High-precision overlay coordinate mapping\n"
                "- Standard PDF compliance"
            )
            p.insert_textbox(pymupdf.Rect(50, 150, 390, 480), col1, fontsize=13, fontname="helv", color=(0.25, 0.25, 0.25))
            p.insert_textbox(pymupdf.Rect(430, 150, 780, 480), col2, fontsize=13, fontname="helv", color=(0.25, 0.25, 0.25))

            p.draw_line(pymupdf.Point(50, 545), pymupdf.Point(790, 545), color=(0.88, 0.88, 0.88), width=1)
            p.insert_text(pymupdf.Point(50, 565), "Confidential · ML Research Group", fontsize=9, color=(0.5, 0.5, 0.5), fontname="helv")
            p.insert_text(pymupdf.Point(740, 565), f"Slide {i + 1} / 3", fontsize=9, color=(0.5, 0.5, 0.5), fontname="helv")

        doc2.save(path2)
        doc2.close()
        created.append(path2)

        return created
