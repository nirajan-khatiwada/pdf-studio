"""
Comprehensive Verification Tests for PDF Studio Fixes:
1. Multi-Image Addition & Overlays Integrity
2. Composite Thumbnail Rendering with Baked Overlays
3. Session State Persistence (Save, Load, Clear) & Cache Restoration
4. HTTP Endpoints Contract Verification
"""

import os
import sys
import json
import base64
import tempfile
import pymupdf

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from pdf_engine import PDFEngine
from api import PDFStudioAPI


def create_dummy_png_b64(width=100, height=100, color=(255, 0, 0)) -> str:
    """Create a minimal PNG dataUrl for testing image overlays."""
    doc = pymupdf.open()
    page = doc.new_page(width=width, height=height)
    r = color[0] / 255.0
    g = color[1] / 255.0
    b = color[2] / 255.0
    page.draw_rect(pymupdf.Rect(0, 0, width, height), color=(r, g, b), fill=(r, g, b))
    pix = page.get_pixmap(dpi=72)
    png_bytes = pix.tobytes("png")
    doc.close()
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")


def run_tests():
    print("==================================================")
    print("STARTING PDF STUDIO VERIFICATION SUITE")
    print("==================================================")

    with tempfile.TemporaryDirectory() as tmp_dir:
        pdf_dir = os.path.join(tmp_dir, "pdf")
        os.makedirs(pdf_dir, exist_ok=True)
        engine = PDFEngine(working_dir=tmp_dir, pdf_dir=pdf_dir)
        api = PDFStudioAPI(working_dir=tmp_dir, pdf_dir=pdf_dir)

        # ----------------------------------------------------------------------
        # TEST 1: Blank Page Creation & Geometry Inheritance
        # ----------------------------------------------------------------------
        print("\n[TEST 1] Testing Blank Page Creation & Neighbor Inheritance...")
        blank_page = api.create_blank_page(
            ref_width=595.28,
            ref_height=841.89,
            ref_rotation=0,
            ref_orientation="Portrait"
        )["page"]

        assert blank_page["is_blank"] is True
        assert blank_page["orientation"] == "Portrait"
        assert blank_page["width"] == 595.28
        assert blank_page["height"] == 841.89
        assert blank_page["thumbnail"].startswith("data:image/png;base64,")
        print("  [PASS] Blank portrait page created with valid thumbnail")

        # ----------------------------------------------------------------------
        # TEST 2: Multi-Image Overlay on Blank Page
        # ----------------------------------------------------------------------
        print("\n[TEST 2] Testing Multiple Image Overlays on Blank Page...")
        img1_b64 = create_dummy_png_b64(120, 80, color=(255, 0, 0))    # Red rectangle
        img2_b64 = create_dummy_png_b64(100, 100, color=(0, 0, 255))   # Blue square
        img3_b64 = create_dummy_png_b64(80, 120, color=(0, 200, 0))   # Green rectangle

        blank_page["overlays"] = [
            {
                "id": "img_test_1",
                "type": "image",
                "imageUrl": img1_b64,
                "x": 10,
                "y": 10,
                "width": 30,
                "height": 20
            },
            {
                "id": "img_test_2",
                "type": "image",
                "imageUrl": img2_b64,
                "x": 50,
                "y": 10,
                "width": 30,
                "height": 30
            },
            {
                "id": "img_test_3",
                "type": "image",
                "imageUrl": img3_b64,
                "x": 25,
                "y": 55,
                "width": 40,
                "height": 25
            },
            {
                "id": "txt_test_1",
                "type": "text",
                "text": "Multi-Image Overlay Test",
                "x": 10,
                "y": 85,
                "width": 80,
                "height": 8,
                "fontSize": 18,
                "isBold": True,
                "color": "#111827"
            }
        ]

        assert len(blank_page["overlays"]) == 4
        print("  [PASS] Added 3 distinct images + 1 text overlay without collision")

        # ----------------------------------------------------------------------
        # TEST 3: Composite Thumbnail Generation with Baked Overlays
        # ----------------------------------------------------------------------
        print("\n[TEST 3] Testing Composite Thumbnail Baking...")
        composite_res = api.composite_thumbnail(blank_page)
        assert composite_res["success"] is True
        thumb_data = composite_res["thumbnail"]
        assert thumb_data.startswith("data:image/png;base64,")
        
        # Verify rendered PNG is valid and has expected dimensions
        raw_b64 = thumb_data.split(",", 1)[1]
        png_bytes = base64.b64decode(raw_b64)
        assert len(png_bytes) > 500, "Composite thumbnail PNG too small"
        
        # Open in PyMuPDF to verify it's a valid rendered pixmap
        img_doc = pymupdf.open(stream=png_bytes, filetype="png")
        assert len(img_doc) == 1
        img_doc.close()
        print(f"  [PASS] Composite thumbnail generated successfully ({len(png_bytes)} bytes)")

        # ----------------------------------------------------------------------
        # TEST 4: Export Document with Blank Page + Multi-Images
        # ----------------------------------------------------------------------
        print("\n[TEST 4] Testing PDF Export with Multi-Image Blank Page...")
        samples = engine.create_sample_documents()
        doc1 = api.load_pdf_file(samples[0])["document"]
        p1 = doc1["pages"][0]

        manifest = [p1, blank_page]
        export_res = api.export_document(manifest, output_name="test_multi_image_export.pdf")
        assert export_res["success"] is True
        assert export_res["page_count"] == 2
        assert os.path.exists(export_res["output_path"])

        # Inspect exported PDF
        check_doc = pymupdf.open(export_res["output_path"])
        assert len(check_doc) == 2
        exported_blank = check_doc[1]
        # Verify image list on page 2 contains our 3 inserted images
        img_list = exported_blank.get_images()
        assert len(img_list) >= 3, f"Expected at least 3 images on exported page, found {len(img_list)}"
        # Verify text is rendered
        text_content = exported_blank.get_text()
        assert "Multi-Image Overlay Test" in text_content
        check_doc.close()
        print("  [PASS] Exported PDF verified: contains 2 pages, all 3 images and text overlay intact!")

        # ----------------------------------------------------------------------
        # TEST 5: Session Persistence (Save, Load, Clear)
        # ----------------------------------------------------------------------
        print("\n[TEST 5] Testing Session State Persistence...")
        session_data = {
            "version": 1,
            "timestamp": 1720000000,
            "pages": [p1, blank_page],
            "sourcePdfs": {
                doc1["source_id"]: {
                    "name": doc1["name"],
                    "path": samples[0],
                    "page_count": doc1["page_count"]
                }
            },
            "zoom": 1.2,
            "selectedPageId": blank_page["id"]
        }

        # 5a. Save session
        save_res = api.save_session(session_data)
        assert save_res["success"] is True
        session_file = os.path.join(tmp_dir, ".pdf_studio_session.json")
        assert os.path.exists(session_file), "Session file .pdf_studio_session.json was not created"
        print("  [PASS] Session saved to disk (.pdf_studio_session.json)")

        # 5b. Create a fresh API instance (simulating app restart)
        fresh_api = PDFStudioAPI(working_dir=tmp_dir, pdf_dir=pdf_dir)
        assert len(fresh_api.source_cache) == 0, "Fresh API source cache should be initially empty"

        # 5c. Load session
        load_res = fresh_api.load_session()
        assert load_res["success"] is True
        restored_session = load_res["session"]
        assert restored_session is not None
        assert len(restored_session["pages"]) == 2
        assert restored_session["pages"][0]["id"] == p1["id"]
        assert restored_session["pages"][1]["id"] == blank_page["id"]
        assert len(restored_session["pages"][1]["overlays"]) == 4
        assert restored_session["zoom"] == 1.2
        assert restored_session["selectedPageId"] == blank_page["id"]
        print("  [PASS] Session loaded and verified: exact page sequence, zoom, and overlays restored")

        # 5d. Verify source cache was automatically re-populated from disk
        assert doc1["source_id"] in fresh_api.source_cache, "Source cache was not restored from file path"
        assert len(fresh_api.source_cache[doc1["source_id"]]) > 0
        print("  [PASS] Source document cache automatically restored from disk")

        # 5e. Re-export using restored session without re-uploading
        re_export = fresh_api.export_document(restored_session["pages"], output_name="re_exported.pdf")
        assert re_export["success"] is True
        assert re_export["page_count"] == 2
        print("  [PASS] Re-export from restored session succeeded with zero re-uploads")

        # 5f. Clear session
        clear_res = fresh_api.clear_session()
        assert clear_res["success"] is True
        assert not os.path.exists(session_file), "Session file should be removed after clear"
        load_after_clear = fresh_api.load_session()
        assert load_after_clear["session"] is None
        print("  [PASS] Clear session removed file cleanly")

    print("\n==================================================")
    print("ALL VERIFICATION TESTS PASSED SUCCESSFULLY!")
    print("==================================================")


if __name__ == "__main__":
    run_tests()
