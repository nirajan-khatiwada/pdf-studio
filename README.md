<div align="center">

# 📄 PDF Studio

### *The buttery-smooth, local-first visual PDF workbench & editor.*

[![Python Version](https://img.shields.io/badge/Python-3.10%20%7C%203.11%20%7C%203.12-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![Engine](https://img.shields.io/badge/Engine-PyMuPDF%201.28-FF5722?style=for-the-badge&logo=pdf&logoColor=white)](https://pymupdf.readthedocs.io/)
[![Frontend](https://img.shields.io/badge/UI-shadcn%20Desktop-09090b?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://ui.shadcn.com/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=for-the-badge)](https://github.com)

<p align="center">
  <b>Reorder, rotate, split, merge, annotate, and paste screenshots with zero friction.</b><br/>
  Runs natively as a lightweight desktop app (Edge Chromium WebView2) or in your browser. 100% offline & local-first.
</p>

---

</div>

## ⚡ Why PDF Studio?

Most PDF tools force you to choose between bloated, subscription-gated desktop suites or shady web converters that upload your confidential documents to random third-party servers.

**PDF Studio** gives you the best of both worlds:
- **Instant & Fluid**: 60 FPS continuous workspace that can comfortably handle 100+ page documents without breaking a sweat.
- **Smart Clipboard Pasting**: Just press <kbd>Ctrl</kbd>+<kbd>V</kbd> — screenshot in clipboard? It's an image overlay. Copied text? It's an editable text box.
- **Orientation-Aware**: Inserting a blank page automatically inherits the dimensions and orientation of its neighbor (Portrait, Landscape, A4, US Letter, 16:9).
- **Private & Local-First**: Powered by a local Python PyMuPDF engine. Your files never leave your machine.

---

## ✨ Features at a Glance

| Feature | Description |
| :--- | :--- |
| 🔀 **Continuous Visual Canvas** | Reorder pages via butter-smooth, hardware-accelerated drag-and-drop with single global floating drop indicators. |
| 📋 **Smart Clipboard (`Ctrl+V`)** | Hit <kbd>Ctrl</kbd>+<kbd>V</kbd> anywhere: automatically detects images vs text and drops clean, proportional overlays onto the page. |
| 🖱️ **Double-Click Page Open** | Double-click any page card or thumbnail to pop straight into the high-res 150 DPI annotation studio. |
| 📑 **Orientation Inheritance** | Click the inline `(+)` gutter button between pages to insert a blank page matching the exact geometry of neighboring pages. |
| 🗑️ **Live-Blur Range Delete** | Type page ranges (e.g. `2-5, 8, 12-15`) to preview deletions in real-time with live optical blur before executing in `<5ms`. |
| 🔄 **Orientation-Aware Rotation** | Rotate pages 90° clockwise on the fly while auto-updating aspect ratio metadata. |
| ✍️ **Movable Overlays** | Add scalable text boxes (custom fonts, sizes, bold/italic, color palette) and transparent image overlays with corner handles. |
| 🗂️ **VS Code Explorer** | Native sidebar tree listing your current working folder documents and active workspace pages. |
| ⏪ **Full Undo / Redo Stack** | Deep state snapshotting with <kbd>Ctrl</kbd>+<kbd>Z</kbd> and <kbd>Ctrl</kbd>+<kbd>Y</kbd> support for up to 30 steps. |
| 📦 **Lossless PDF Export** | Compiles unified, vector-crisp PDF documents with custom overlays baked in using PyMuPDF. |

---

## 🚀 Quick Start

### 1. Prerequisites
- Python 3.10+ installed
- Windows, macOS, or Linux

### 2. Clone & Install
```bash
# Clone the repository
git clone https://github.com/yourusername/pdf-studio.git
cd pdf-studio

# Install dependencies
pip install pymupdf pywebview
```

### 3. Launch the Application

#### 🖥️ Desktop Native Mode (Recommended)
Launches in an ultra-fast Edge Chromium WebView2 window:
```bash
python main.py
```
*Or simply double-click `run.bat` on Windows.*

#### 🌐 Web Browser Mode
Launches the local HTTP backend and opens in your default browser:
```bash
python main.py --browser
```

#### ⚙️ Headless Server Mode
Runs only the API server on a dedicated port without spawning a GUI:
```bash
python main.py --server-only --port 8765
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Double Click</kbd> | Open selected page in high-res annotation editor |
| <kbd>Ctrl</kbd> + <kbd>V</kbd> | Paste clipboard image as image overlay or text as text overlay |
| <kbd>Enter</kbd> | Open selected page in annotation editor |
| <kbd>Escape</kbd> | Close annotation editor or dismiss delete popover |
| <kbd>Ctrl</kbd> + <kbd>Z</kbd> | Undo last workspace mutation |
| <kbd>Ctrl</kbd> + <kbd>Y</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> | Redo action |
| <kbd>Ctrl</kbd> + <kbd>B</kbd> | Toggle VS Code Explorer sidebar |
| <kbd>Delete</kbd> | Remove currently selected page |

---

## 🏗️ Architecture & Engineering

```
┌────────────────────────────────────────────────────────────────────────┐
│                          PDF Studio Frontend                           │
│  ┌──────────────────────┐  ┌─────────────────────────────────────────┐ │
│  │   VS Code Explorer   │  │    Continuous Workspace Grid            │ │
│  │   - Local Folder     │  │    - 60fps RAF Auto-scroll              │ │
│  │   - Open Documents   │  │    - Smart Ctrl+V Clipboard Ingestion   │ │
│  └──────────────────────┘  │    - High-Precision Double-Click Open   │ │
│                            └─────────────────────────────────────────┘ │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ JSON RPC / REST API
┌────────────────────────────────────▼───────────────────────────────────┐
│                          Local Python Backend                          │
│  ┌─────────────────────────────────┐ ┌───────────────────────────────┐ │
│  │  Robust Multi-threaded Server   │ │   Edge Chromium Desktop Host  │ │
│  │  - ThreadingHTTPServer          │ │   - pywebview JS API Bridge   │ │
│  │  - Zero socket-drop leak        │ │   - Native OS File Dialogs    │ │
│  └────────────────┬────────────────┘ └───────────────┬───────────────┘ │
│                   │                                  │                 │
│  ┌────────────────▼──────────────────────────────────▼───────────────┐ │
│  │                   PyMuPDF (Fitz 1.28) Core Engine                 │ │
│  │  - Lossless page extraction & dimension parsing                   │ │
│  │  - Multi-tier in-memory thumbnail & pixmap caching                │ │
│  │  - High-res 150 DPI editor rasterization                          │ │
│  │  - Sub-5ms page tree surgery & vector overlay compilation         │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### Key Technical Invariants:
1. **Sub-5ms Batch Mutations**: Deleting 50 pages from a 200-page document performs surgical DOM node extraction and re-indexing in `<5ms` without recreating the entire grid.
2. **True Geometric Inheritance**: Blank pages do not default to generic hardcoded sizes; they sample the preceding page's bounding box and rotation matrix to produce indistinguishable sibling pages.
3. **Hardware-Accelerated Dragging**: Reordering uses lightweight ghost chips and a single global floating indicator bar, avoiding browser frame drops and layout thrashing.
4. **Proportional Smart Clipboard Scaling**: Clipboard images calculate natural aspect ratios on arrival and scale proportionately into the sheet container with automatic collision offset.

---

## 📁 Repository Structure

```
.
├── main.py               # Desktop entrypoint & pywebview host
├── api.py                # HTTP API & REST endpoint handlers
├── pdf_engine.py         # PyMuPDF Fitz engine & document compilation
├── test_pdf_engine.py    # Automated invariant & geometry test suite
├── run.bat               # Windows instant launcher
├── pdf/                  # Default working directory for source documents
└── ui/
    ├── index.html        # Clean semantic desktop layout
    ├── style.css         # shadcn/ui inspired design system
    └── app.js            # Reactive UI logic & clipboard handling
```

---

## 🧪 Testing & Verification

Run the comprehensive unit test suite:
```bash
python test_pdf_engine.py
```
Verifies:
- Lossless sample creation
- Orientation detection (Portrait / Landscape)
- Geometric dimension inheritance on blank insertion
- Overlay text rendering accuracy
- Final document export structural integrity

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — free for personal and commercial use.
