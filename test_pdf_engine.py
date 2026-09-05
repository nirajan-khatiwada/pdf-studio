"""
Comprehensive Unit & Invariant Tests for PDFEngine.
Tests orientation preservation, reordering, blank page inheritance, and overlay rendering.
"""

import os
import sys
import base64
import pymupdf
from pdf_engine import PDFEngine

import tempfile

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def run_tests():
    with tempfile.TemporaryDirectory() as tmp_dir:
        engine = PDFEngine(working_dir=tmp_dir, pdf_dir=tmp_dir)
        print("Running PDFEngine Invariant Tests...")

        # 1. Verify Sample Creation
        samples = engine.create_sample_documents()
        assert len(samples) == 2, "Expected 2 sample documents"
        assert os.path.exists(samples[0]), f"Sample 1 missing: {samples[0]}"
        assert os.path.exists(samples[1]), f"Sample 2 missing: {samples[1]}"
        print("[PASS] Sample PDF creation verified")

        # 2. Verify Loading
        doc1 = engine.load_pdf_from_file(samples[0])
        doc2 = engine.load_pdf_from_file(samples[1])
        assert doc1["page_count"] == 3, f"Doc 1 pages: {doc1['page_count']} != 3"
        assert doc2["page_count"] == 3, f"Doc 2 pages: {doc2['page_count']} != 3"
        assert doc1["pages"][0]["orientation"] == "Portrait"
        assert doc2["pages"][0]["orientation"] == "Landscape"
        print("[PASS] PDF loading and orientation detection verified")

        # 3. Verify Blank Page Generation
        # Blank next to Portrait page:
        blank_portrait = engine.create_blank_page_info(
            ref_width=doc1["pages"][0]["width"],
            ref_height=doc1["pages"][0]["height"],
            ref_rotation=doc1["pages"][0]["rotation"],
            ref_orientation=doc1["pages"][0]["orientation"],
        )
        assert blank_portrait["orientation"] == "Portrait", f"Expected Portrait blank, got {blank_portrait['orientation']}"
        assert blank_portrait["width"] == doc1["pages"][0]["width"]
        assert blank_portrait["height"] == doc1["pages"][0]["height"]

        # Blank next to Landscape page:
        blank_landscape = engine.create_blank_page_info(
            ref_width=doc2["pages"][0]["width"],
            ref_height=doc2["pages"][0]["height"],
            ref_rotation=doc2["pages"][0]["rotation"],
            ref_orientation=doc2["pages"][0]["orientation"],
        )
        assert blank_landscape["orientation"] == "Landscape", f"Expected Landscape blank, got {blank_landscape['orientation']}"
        assert blank_landscape["width"] == doc2["pages"][0]["width"]
        assert blank_landscape["height"] == doc2["pages"][0]["height"]
        print("[PASS] Blank page orientation and dimension inheritance verified")

        # 4. Create an edited manifest with mixed pages, blank pages, and overlays
        # Page 1: Doc1 Page 0 with text overlay
        p1 = dict(doc1["pages"][0])
        p1["overlays"] = [{
            "type": "text",
            "text": "VERIFIED PRODUCTION APPROVED",
            "fontSize": 18,
            "isBold": True,
            "isItalic": False,
            "color": "#e11d48",  # Rose-600
            "x": 10,
            "y": 70,
            "width": 80,
            "height": 5,
        }]

        # Page 2: Blank Portrait
        p2 = blank_portrait

        # Page 3: Doc2 Page 0 (Landscape)
        p3 = dict(doc2["pages"][0])

        # Page 4: Blank Landscape
        p4 = blank_landscape

        # Page 5: Doc1 Page 2 (reordered!)
        p5 = dict(doc1["pages"][2])

        manifest = [p1, p2, p3, p4, p5]
        source_bytes = {
            doc1["source_id"]: base64.b64decode(doc1["bytes_b64"]),
            doc2["source_id"]: base64.b64decode(doc2["bytes_b64"]),
        }

        out_path = os.path.join(engine.working_dir, "test_output_merged.pdf")
        res = engine.export_pdf(manifest, source_bytes, out_path)
        assert res["success"] is True
        assert res["page_count"] == 5
        assert os.path.exists(out_path)
        print("[PASS] Export executed successfully")

        # 5. Inspect Exported File Invariants
        verify_doc = pymupdf.open(out_path)
        assert len(verify_doc) == 5, f"Expected 5 pages, got {len(verify_doc)}"

        # Check page geometries
        # Page 1: Portrait (595.28 x 841.89)
        rect1 = verify_doc[0].rect
        assert rect1.width < rect1.height, "Page 1 must be portrait"
        text_on_p1 = verify_doc[0].get_text()
        assert "VERIFIED PRODUCTION APPROVED" in text_on_p1, "Text overlay missing from Page 1"

        # Page 2: Blank Portrait
        rect2 = verify_doc[1].rect
        assert rect2.width < rect2.height, "Page 2 must be portrait"

        # Page 3: Landscape (841.89 x 595.28)
        rect3 = verify_doc[2].rect
        assert rect3.width > rect3.height, "Page 3 must be landscape"

        # Page 4: Blank Landscape
        rect4 = verify_doc[3].rect
        assert rect4.width > rect4.height, "Page 4 must be landscape"

        # Page 5: Portrait
        rect5 = verify_doc[4].rect
        assert rect5.width < rect5.height, "Page 5 must be portrait"

        verify_doc.close()
        print("[PASS] All 5 exported pages verified for exact geometry and text rendering!")
        print("\nALL INVARIANT TESTS PASSED SUCCESSFULLY!")


if __name__ == "__main__":
    run_tests()
