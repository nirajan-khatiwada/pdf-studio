/**
 * PDF Studio Desktop Application Client Logic
 * Features: VS Code Explorer Sidebar, Drag-and-Drop Workspace,
 * Blank Page Insertion with Orientation Inheritance, Text/Image Editing, and PDF Export.
 */

// Global Application State
const state = {
  pages: [],            // List of WorkspacePage objects
  sourcePdfs: {},       // map: source_id -> { name, bytes_b64, page_count }
  selectedPageId: null, // currently selected page id
  zoom: 1.0,            // workspace scale
  history: [],          // undo stack
  future: [],           // redo stack
  sidebarOpen: true,
  directoryItems: [],
  workingFolderName: 'note',
  editor: {
    pageId: null,
    overlays: [],
    selectedOverlayId: null,
    activeColor: '#000000',
    fontSize: 16,
    isBold: false,
    isItalic: false,
  }
};

// DOM References
const els = {
  sidebar: document.getElementById('sidebar'),
  btnToggleSidebar: document.getElementById('btnToggleSidebar'),
  btnRefreshTree: document.getElementById('btnRefreshTree'),
  sectionToggleUploaded: document.getElementById('sectionToggleUploaded'),
  sectionToggleTree: document.getElementById('sectionToggleTree'),
  sidebarUploadedList: document.getElementById('sidebarUploadedList'),
  sidebarUploadedCount: document.getElementById('sidebarUploadedCount'),
  sidebarFolderTitle: document.getElementById('sidebarFolderTitle'),
  sidebarTreeList: document.getElementById('sidebarTreeList'),
  pageGrid: document.getElementById('pageGrid'),
  emptyState: document.getElementById('emptyState'),
  dropOverlay: document.getElementById('dropOverlay'),
  dropIndicatorBar: document.getElementById('dropIndicatorBar'),
  workspaceScroll: document.getElementById('workspaceScroll'),
  btnOpenPdf: document.getElementById('btnOpenPdf'),
  pdfFileInput: document.getElementById('pdfFileInput'),
  btnAddBlankPage: document.getElementById('btnAddBlankPage'),
  btnAnnotatePage: document.getElementById('btnAnnotatePage'),
  btnRotatePage: document.getElementById('btnRotatePage'),
  btnExportPdf: document.getElementById('btnExportPdf'),
  btnUndo: document.getElementById('btnUndo'),
  btnRedo: document.getElementById('btnRedo'),
  btnZoomIn: document.getElementById('btnZoomIn'),
  btnZoomOut: document.getElementById('btnZoomOut'),
  zoomLevelDisplay: document.getElementById('zoomLevelDisplay'),
  btnClearAll: document.getElementById('btnClearAll'),
  btnEmptyOpen: document.getElementById('btnEmptyOpen'),
  statusPageCount: document.getElementById('statusPageCount'),
  statusSourceCount: document.getElementById('statusSourceCount'),
  statusSelectedInfo: document.getElementById('statusSelectedInfo'),
  docTitleDisplay: document.getElementById('docTitleDisplay'),
  toastContainer: document.getElementById('toastContainer'),
  // Remove Pages By Range/Number
  btnToggleRemovePages: document.getElementById('btnToggleRemovePages'),
  removePagesPopover: document.getElementById('removePagesPopover'),
  btnCloseRemovePagesPopover: document.getElementById('btnCloseRemovePagesPopover'),
  inputRemovePages: document.getElementById('inputRemovePages'),
  removePagesFeedback: document.getElementById('removePagesFeedback'),
  btnCancelRemovePages: document.getElementById('btnCancelRemovePages'),
  btnExecuteRemovePages: document.getElementById('btnExecuteRemovePages'),
  // Annotation Dialog
  annotationDialog: document.getElementById('annotationDialog'),
  dialogPageTitle: document.getElementById('dialogPageTitle'),
  btnCloseDialog: document.getElementById('btnCloseDialog'),
  btnCancelDialog: document.getElementById('btnCancelDialog'),
  btnSaveDialog: document.getElementById('btnSaveDialog'),
  btnAddTextBox: document.getElementById('btnAddTextBox'),
  btnAddImageOverlay: document.getElementById('btnAddImageOverlay'),
  imageOverlayInput: document.getElementById('imageOverlayInput'),
  editorFontSize: document.getElementById('editorFontSize'),
  editorToggleBold: document.getElementById('editorToggleBold'),
  editorToggleItalic: document.getElementById('editorToggleItalic'),
  editorDeleteSelected: document.getElementById('editorDeleteSelected'),
  editorSheet: document.getElementById('editorSheet'),
  editorSheetImage: document.getElementById('editorSheetImage'),
  editorOverlaysLayer: document.getElementById('editorOverlaysLayer'),
};

// Drag and drop reordering state
let draggedPageIndex = null;
let currentDropTargetIndex = null;
let dropPosition = null;
let isDraggingCard = false;
let activeIndicatorEl = null;
let currentRenderSequence = 0;

// Double-Click & Smart Clipboard Paste State
let lastPageClickTime = 0;
let lastPageClickPageId = null;
let lastPasteHandledTime = 0;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadDirectoryTree();
  updateStatus();
});

function initEventListeners() {
  // Sidebar Toggle
  els.btnToggleSidebar.addEventListener('click', () => {
    state.sidebarOpen = !state.sidebarOpen;
    els.sidebar.classList.toggle('collapsed', !state.sidebarOpen);
  });

  els.btnRefreshTree.addEventListener('click', loadDirectoryTree);

  els.sectionToggleUploaded.addEventListener('click', () => {
    els.sectionToggleUploaded.classList.toggle('collapsed');
  });

  els.sectionToggleTree.addEventListener('click', () => {
    els.sectionToggleTree.classList.toggle('collapsed');
  });

  // Toolbar
  els.btnOpenPdf.addEventListener('click', handleOpenPdfClick);
  els.btnEmptyOpen.addEventListener('click', handleOpenPdfClick);
  els.pdfFileInput.addEventListener('change', handleFileInputChange);

  els.btnAddBlankPage.addEventListener('click', () => {
    const idx = getSelectedOrLastPageIndex();
    addBlankPage(idx);
  });

  els.btnRotatePage.addEventListener('click', () => {
    const idx = getSelectedOrLastPageIndex();
    if (idx !== -1) rotatePage(idx, 90);
  });

  // Remove Pages By Range/Number Popover & Actions
  if (els.btnToggleRemovePages) {
    els.btnToggleRemovePages.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleRemovePagesPopover();
    });
  }

  if (els.btnCloseRemovePagesPopover) {
    els.btnCloseRemovePagesPopover.addEventListener('click', (e) => {
      e.stopPropagation();
      closeRemovePagesPopover();
    });
  }

  if (els.btnCancelRemovePages) {
    els.btnCancelRemovePages.addEventListener('click', (e) => {
      e.stopPropagation();
      closeRemovePagesPopover();
    });
  }

  if (els.inputRemovePages) {
    els.inputRemovePages.addEventListener('input', handleRemovePagesInput);
    els.inputRemovePages.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeRemovePages();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeRemovePagesPopover();
      }
    });
  }

  if (els.btnExecuteRemovePages) {
    els.btnExecuteRemovePages.addEventListener('click', (e) => {
      e.stopPropagation();
      executeRemovePages();
    });
function clonePageState(pages) {
  return pages.map(p => ({
    id: p.id,
    source_pdf_id: p.source_pdf_id,
    source_pdf_name: p.source_pdf_name,
    source_page_index: p.source_page_index,
    width: p.width,
    height: p.height,
    rotation: p.rotation,
    effective_width: p.effective_width,
    effective_height: p.effective_height,
    orientation: p.orientation,
    is_blank: p.is_blank,
    thumbnail: p.thumbnail,
    overlays: p.overlays ? p.overlays.map(o => ({ ...o })) : []
  }));
}

// History
function saveHistory() {
  state.history.push(clonePageState(state.pages));
  if (state.history.length > 30) state.history.shift();
  state.future = [];
  updateUndoRedoButtons();
}

function undo() {
  if (state.history.length === 0) return;
  state.future.push(clonePageState(state.pages));
  state.pages = state.history.pop();
  renderWorkspace();
  updateUndoRedoButtons();
  showToast("Undid last action");
}

function redo() {
  if (state.future.length === 0) return;
  state.history.push(clonePageState(state.pages));
  state.pages = state.future.pop();
  renderWorkspace();
  updateUndoRedoButtons();
  showToast("Redid action");
}

function updateUndoRedoButtons() {
  els.btnUndo.disabled = state.history.length === 0;
  els.btnRedo.disabled = state.future.length === 0;
}

// VS Code Explorer Sidebar Data Loading
async function loadDirectoryTree() {
  try {
    const res = await fetch('/api/directory_tree');
    const data = await res.json();
    if (data.success) {
      state.workingFolderName = data.folder_name || 'note';
      els.sidebarFolderTitle.textContent = `FOLDER: ${state.workingFolderName.toUpperCase()}`;
      renderDirectoryTree(data.items || []);
    }
  } catch (err) {
    els.sidebarTreeList.innerHTML = `<div class="sidebar-empty-note">Could not load directory: ${err.message}</div>`;
  }
}

function renderDirectoryTree(items) {
  if (items.length === 0) {
    els.sidebarTreeList.innerHTML = '<div class="sidebar-empty-note">Folder is empty</div>';
    return;
  }

  els.sidebarTreeList.innerHTML = '';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'tree-item';
    el.title = item.is_pdf ? `Click to open ${item.name} in workspace` : item.name;

    // SVG Icon according to file type
    let iconSvg = '';
    if (item.is_dir) {
      iconSvg = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      `;
    } else if (item.is_pdf) {
      iconSvg = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e11d48" stroke-width="1.8">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      `;
    } else {
      iconSvg = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.8">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      `;
    }

    el.innerHTML = `
      <span class="tree-item-icon">${iconSvg}</span>
      <span class="tree-item-name">${item.name}</span>
      ${item.is_pdf ? `<span class="tree-item-meta">${item.page_count}p</span>` : ''}
    `;

    if (item.is_pdf) {
      el.addEventListener('click', () => loadFileFromPath(item.name));
    }

    els.sidebarTreeList.appendChild(el);
  });
}

async function handleOpenPdfClick() {
  if (window.pywebview && window.pywebview.api && window.pywebview.api.open_native_pdf_dialog) {
    try {
      const paths = await window.pywebview.api.open_native_pdf_dialog();
      if (paths && paths.length > 0) {
        for (const p of paths) {
          await loadFileFromPath(p);
        }
        return;
      }
    } catch (err) {
      console.warn("Native file dialog fallback:", err);
    }
  }
  els.pdfFileInput.click();
}

function handleFileInputChange(e) {
  if (e.target.files && e.target.files.length > 0) {
    handleDroppedFiles(e.target.files);
    els.pdfFileInput.value = '';
  }
}

async function handleDroppedFiles(fileList) {
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
      await uploadPdfFile(file);
    } else {
      showToast(`Skipped non-PDF: ${file.name}`, 'error');
    }
  }
}

let isLoadingFile = false;

async function loadFileFromPath(filePath) {
  if (isLoadingFile) return;
  isLoadingFile = true;
  const shortName = filePath.split(/[\/\\]/).pop();
  showToast(`Loading ${shortName}...`);
  try {
    const res = await fetch('/api/load_file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath })
    });
    const data = await res.json();
    if (data.success && data.document) {
      addDocumentPagesToWorkspace(data.document);
      showToast(`Loaded ${data.document.name} (${data.document.page_count} pages)`, 'success');
    } else {
      showToast(`Failed to load: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    isLoadingFile = false;
  }
}

async function uploadPdfFile(file) {
  showToast(`Uploading ${file.name}...`);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Data = reader.result;
        const res = await fetch('/api/upload_pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            dataBase64: base64Data
          })
        });
        const data = await res.json();
        if (data.success && data.document) {
          addDocumentPagesToWorkspace(data.document);
          showToast(`Added ${data.document.name} (${data.document.page_count} pages)`, 'success');
          loadDirectoryTree();
        } else {
          showToast(`Upload failed: ${data.error}`, 'error');
        }
      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
      }
      resolve();
    };
    reader.readAsDataURL(file);
  });
}

function addDocumentPagesToWorkspace(doc) {
  saveHistory();
  state.sourcePdfs[doc.source_id] = {
    name: doc.name,
    page_count: doc.page_count,
    bytes_b64: doc.bytes_b64
  };

  state.pages = state.pages.concat(doc.pages);
  if (!state.selectedPageId && state.pages.length > 0) {
    state.selectedPageId = state.pages[0].id;
  }
  renderWorkspace();
}

function handleClearAll() {
  if (state.pages.length === 0) return;
  if (confirm("Clear all pages from workspace?")) {
    saveHistory();
    state.pages = [];
    state.sourcePdfs = {};
    state.selectedPageId = null;
    renderWorkspace();
    showToast("Workspace cleared");
  }
}

// Blank Page Insertion with Orientation Inheritance
async function addBlankPage(afterIndex = null) {
  saveHistory();
  let refWidth = 595.28;
  let refHeight = 841.89;
  let refRotation = 0;
  let refOrientation = "Portrait";

  let insertPos = state.pages.length;

  if (afterIndex !== null && afterIndex >= 0 && afterIndex < state.pages.length) {
    const refPage = state.pages[afterIndex];
    refWidth = refPage.width;
    refHeight = refPage.height;
    refRotation = refPage.rotation;
    refOrientation = refPage.orientation;
    insertPos = afterIndex + 1;
  }

  try {
    const res = await fetch('/api/create_blank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refWidth,
        refHeight,
        refRotation,
        refOrientation
      })
    });
    const data = await res.json();
    if (data.success && data.page) {
      state.pages.splice(insertPos, 0, data.page);
      state.selectedPageId = data.page.id;
      renderWorkspace();
      showToast(`Inserted blank ${refOrientation} page`, 'success');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// Remove and Rotate
function removePage(index) {
  if (index < 0 || index >= state.pages.length) return;
  saveHistory();
  const removed = state.pages.splice(index, 1)[0];
  if (state.selectedPageId === removed.id) {
    state.selectedPageId = state.pages[index] ? state.pages[index].id : (state.pages[index - 1] ? state.pages[index - 1].id : null);
  }

  if (state.pages.length === 0) {
    renderWorkspace();
    showToast(`Removed Page ${index + 1}`);
    return;
  }

  const slot = els.pageGrid.children[index];
  if (slot) {
    slot.remove();
    // Re-index subsequent slots
    for (let i = index; i < els.pageGrid.children.length; i++) {
      const s = els.pageGrid.children[i];
      s.dataset.index = i;
      const c = s.querySelector('.page-card');
      if (c) {
        c.dataset.index = i;
        const num = c.querySelector('.card-page-num');
        if (num) num.textContent = i + 1;
      }
      const gutterBtn = s.querySelector('.gutter-add-btn');
      if (gutterBtn && state.pages[i]) {
        gutterBtn.title = `Insert blank ${state.pages[i].orientation} page after Page ${i + 1}`;
      }
    }
    els.docTitleDisplay.textContent = `Document (${state.pages.length} pages)`;
    updateSidebarUploadedDocuments();
    updateStatus();
  } else {
    renderWorkspace();
  }
  showToast(`Removed Page ${index + 1}`);
}

// Remove Pages By Page Number and Range (start-end) with Live Blur
function rotatePage(index, degrees) {
  if (index < 0 || index >= state.pages.length) return;
  saveHistory();
  const page = state.pages[index];
  page.rotation = (page.rotation + degrees) % 360;
  if (page.rotation === 90 || page.rotation === 270) {
    page.effective_width = page.height;
    page.effective_height = page.width;
  } else {
    page.effective_width = page.width;
    page.effective_height = page.height;
  }
  page.orientation = page.effective_width > page.effective_height ? "Landscape" : "Portrait";

  const slot = els.pageGrid.children[index];
  if (slot) {
    const img = slot.querySelector('.card-thumbnail-box img');
    if (img) {
      img.style.transform = `rotate(${page.rotation}deg)`;
    }
    const metaEl = slot.querySelector('.card-meta-text');
    if (metaEl) {
      metaEl.textContent = `${page.orientation} · ${Math.round(page.effective_width)}×${Math.round(page.effective_height)} pt`;
    }
    const gutterBtn = slot.querySelector('.gutter-add-btn');
    if (gutterBtn) {
      gutterBtn.title = `Insert blank ${page.orientation} page after Page ${index + 1}`;
    }
    updateStatus();
  } else {
    renderWorkspace();
  }

  showToast(`Rotated Page ${index + 1} to ${page.rotation}°`);
}

function getSelectedOrLastPageIndex() {
  if (state.pages.length === 0) return -1;
  if (!state.selectedPageId) return state.pages.length - 1;
  const idx = state.pages.findIndex(p => p.id === state.selectedPageId);
  return idx !== -1 ? idx : state.pages.length - 1;
}

// Single Global Floating Insertion Indicator
let lastIndicatedSlot = null;
let lastIndicatedSide = null;

function showFloatingDropIndicator(slot, isLeft) {
  if (!els.dropIndicatorBar || !els.workspaceScroll) return;
  if (lastIndicatedSlot === slot && lastIndicatedSide === isLeft) return;
  lastIndicatedSlot = slot;
  lastIndicatedSide = isLeft;

  const scrollRect = els.workspaceScroll.getBoundingClientRect();
  const slotRect = slot.getBoundingClientRect();
  const x = isLeft ? (slotRect.left - scrollRect.left - 6) : (slotRect.right - scrollRect.left + 2);
  const y = (slotRect.top - scrollRect.top) + els.workspaceScroll.scrollTop + 4;
  const h = slotRect.height - 8;

  els.dropIndicatorBar.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  els.dropIndicatorBar.style.height = `${h}px`;
  els.dropIndicatorBar.classList.add('active');
}

function hideFloatingDropIndicator() {
  if (!els.dropIndicatorBar) return;
  els.dropIndicatorBar.classList.remove('active');
  lastIndicatedSlot = null;
  lastIndicatedSide = null;
}

// Edge Auto-Scrolling Engine (Effortlessly scroll across 100+ pages during drag)
let autoScrollRaf = null;
let autoScrollSpeed = 0;

function startAutoScrollLoop() {
  if (autoScrollRaf !== null) return;
  function step() {
    if (autoScrollSpeed !== 0 && els.workspaceScroll) {
      els.workspaceScroll.scrollTop += autoScrollSpeed;
      autoScrollRaf = requestAnimationFrame(step);
    } else {
      autoScrollRaf = null;
    }
  }
  autoScrollRaf = requestAnimationFrame(step);
}

function stopAutoScroll() {
  if (autoScrollRaf !== null) {
    cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = null;
  }
  autoScrollSpeed = 0;
}

function updateAutoScroll(clientY) {
  if (draggedPageIndex === null || !els.workspaceScroll) {
    stopAutoScroll();
    return;
  }

  const rect = els.workspaceScroll.getBoundingClientRect();
  const edgeZone = 120;

  if (clientY < rect.top + edgeZone) {
    // Continuous upward auto-scroll (e.g. from Page 100 towards Page 1)
    // Non-linear acceleration up to 58 px/frame (~3,500 px/sec) even if cursor moves into toolbar
    const distance = (rect.top + edgeZone) - clientY;
    const ratio = Math.min(1.8, Math.max(0.15, distance / edgeZone));
    autoScrollSpeed = -Math.round(8 + ratio * 28);
    startAutoScrollLoop();
  } else if (clientY > rect.bottom - edgeZone) {
    // Continuous downward auto-scroll
    const distance = clientY - (rect.bottom - edgeZone);
    const ratio = Math.min(1.8, Math.max(0.15, distance / edgeZone));
    autoScrollSpeed = Math.round(8 + ratio * 28);
    startAutoScrollLoop();
  } else {
    autoScrollSpeed = 0;
    stopAutoScroll();
  }
}

// Instant in-place DOM reordering (<0.5ms) without rebuilding the page grid
function movePageCardInDOM(fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  const slots = els.pageGrid.children;
  const draggedSlot = slots[fromIndex];
  if (!draggedSlot || !slots[toIndex]) {
    renderWorkspace();
    return;
  }

  if (toIndex >= slots.length - 1) {
    els.pageGrid.appendChild(draggedSlot);
  } else if (fromIndex < toIndex) {
    els.pageGrid.insertBefore(draggedSlot, slots[toIndex + 1]);
  } else {
    els.pageGrid.insertBefore(draggedSlot, slots[toIndex]);
  }

  // Re-index only the affected range between min and max
  const minIdx = Math.min(fromIndex, toIndex);
  const maxIdx = Math.max(fromIndex, toIndex);
  for (let i = minIdx; i <= maxIdx; i++) {
    const slotEl = els.pageGrid.children[i];
    if (slotEl) {
      slotEl.dataset.index = i;
      const cardEl = slotEl.querySelector('.page-card');
      if (cardEl) {
        cardEl.dataset.index = i;
        const pageNumEl = cardEl.querySelector('.card-page-num');
        if (pageNumEl) pageNumEl.textContent = i + 1;
      }
      const gutterBtn = slotEl.querySelector('.gutter-add-btn');
      if (gutterBtn && state.pages[i]) {
        gutterBtn.title = `Insert blank ${state.pages[i].orientation} page after Page ${i + 1}`;
      }
    }
  }

  updateStatus();
}

// Modular page slot builder with butter-smooth drag handles and zero per-slot overhead
function createPageSlot(page, index) {
  const slot = document.createElement('div');
  slot.className = 'page-slot';
  slot.dataset.index = index;

  const card = document.createElement('div');
  card.className = `page-card ${page.id === state.selectedPageId ? 'selected' : ''}`;
  card.draggable = true;
  card.dataset.index = index;
  card.dataset.id = page.id;

  const baseWidth = 220;
  card.style.width = `${Math.round(baseWidth * state.zoom)}px`;

  // Action Bar on Hover (Rotate, Annotate, Delete)
  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const rotateBtn = document.createElement('button');
  rotateBtn.className = 'action-pill rotate';
  rotateBtn.title = 'Rotate 90° clockwise';
  rotateBtn.draggable = false;
  rotateBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>';
  rotateBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const curIdx = parseInt(slot.dataset.index, 10);
    rotatePage(curIdx, 90);
  });

  const editBtn = document.createElement('button');
  editBtn.className = 'action-pill edit';
  editBtn.title = 'Add text or images';
  editBtn.draggable = false;
  editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openAnnotationDialog(page.id);
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'action-pill danger';
  removeBtn.title = 'Remove page';
  removeBtn.draggable = false;
  removeBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const curIdx = parseInt(slot.dataset.index, 10);
    removePage(curIdx);
  });

  actions.appendChild(rotateBtn);
  actions.appendChild(editBtn);
  actions.appendChild(removeBtn);
  card.appendChild(actions);

  // Thumbnail Area
  const thumbBox = document.createElement('div');
  thumbBox.className = 'card-thumbnail-box';
  thumbBox.style.height = `${Math.round(240 * state.zoom)}px`;

  const imgWrapper = document.createElement('div');
  imgWrapper.style.position = 'relative';
  imgWrapper.style.display = 'flex';
  imgWrapper.style.alignItems = 'center';
  imgWrapper.style.justifyContent = 'center';
  imgWrapper.style.maxWidth = '100%';
  imgWrapper.style.maxHeight = '100%';
  imgWrapper.style.pointerEvents = 'none';

  const img = document.createElement('img');
  img.src = page.thumbnail;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = `Page ${index + 1}`;
  img.draggable = false;
  img.setAttribute('draggable', 'false');
  img.style.userSelect = 'none';
  img.style.webkitUserDrag = 'none';
  if (page.rotation !== 0) {
    img.style.transform = `rotate(${page.rotation}deg)`;
  }
  imgWrapper.appendChild(img);

  // Badge showing count of overlays if present
  if (page.overlays && page.overlays.length > 0) {
    const ovBadge = document.createElement('div');
    ovBadge.style.cssText = 'position: absolute; bottom: 4px; right: 4px; background: #09090b; color: #fff; font-size: 9.5px; padding: 2px 5px; border-radius: 3px; font-weight: 500; display: flex; align-items: center; gap: 3px; pointer-events: none;';
    ovBadge.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> ${page.overlays.length}`;
    imgWrapper.appendChild(ovBadge);
  }

  thumbBox.appendChild(imgWrapper);
  card.appendChild(thumbBox);

  // Minimal Card Footer
  const footer = document.createElement('div');
  footer.className = 'card-footer';
  footer.innerHTML = `
    <span class="card-page-num">${index + 1}</span>
    <span class="card-meta-text">${page.orientation} · ${Math.round(page.effective_width)}×${Math.round(page.effective_height)} pt</span>
  `;
  card.appendChild(footer);

  card.title = "Click to select · Double-click to open page";
  thumbBox.title = "Double-click to open page in editor";

  // Click Selection with High-Precision Double-Click Trigger
  card.addEventListener('click', (e) => {
    if (e.target.closest('.action-pill') || e.target.closest('.gutter-add-btn')) return;

    state.selectedPageId = page.id;
    document.querySelectorAll('.page-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    updateStatus();

    const now = Date.now();
    const timeDiff = now - lastPageClickTime;
    if (lastPageClickPageId === page.id && timeDiff < 420 && timeDiff > 30) {
      lastPageClickTime = 0;
      lastPageClickPageId = null;
      openAnnotationDialog(page.id);
      return;
    }
    lastPageClickTime = now;
    lastPageClickPageId = page.id;
  });

  // Direct Double-Click Listeners (on card and slot)
  const onSlotDblClick = (e) => {
    if (e.target.closest('.action-pill') || e.target.closest('.gutter-add-btn')) return;
    openAnnotationDialog(page.id);
  };
  card.addEventListener('dblclick', onSlotDblClick);
  slot.addEventListener('dblclick', onSlotDblClick);

  // Gutter (+) Add Blank Page Button
  const gutterBtn = document.createElement('button');
  gutterBtn.className = 'gutter-add-btn';
  gutterBtn.title = `Insert blank ${page.orientation} page after Page ${index + 1}`;
  gutterBtn.draggable = false;
  gutterBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#71717a" stroke-width="1.8" fill="#ffffff"/>
      <polyline points="14 2 14 8 20 8" stroke="#71717a" stroke-width="1.8"/>
      <circle cx="16.5" cy="16.5" r="5" fill="#f43f5e" stroke="#ffffff" stroke-width="1.2"/>
      <line x1="16.5" y1="14.2" x2="16.5" y2="18.8" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round"/>
      <line x1="14.2" y1="16.5" x2="18.8" y2="16.5" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round"/>
    </svg>
  `;
  gutterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const curIdx = parseInt(slot.dataset.index, 10);
    addBlankPage(curIdx);
  });

  // Butter-Smooth Drag Initiation
  card.addEventListener('dragstart', (e) => {
    const curIdx = parseInt(slot.dataset.index, 10);
    draggedPageIndex = curIdx;
    isDraggingCard = true;
    card.classList.add('dragging');
    document.body.classList.add('is-reordering-cards');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-page-card', String(curIdx));
    e.dataTransfer.setData('text/plain', String(curIdx));

    // Featherlight ghost badge: eliminates browser freeze snapshotting complex DOM
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost-chip';
    ghost.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span>Page ${curIdx + 1}</span>
    `;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 24, 16);
    requestAnimationFrame(() => ghost.remove());

    if (els.dropOverlay && els.dropOverlay.classList.contains('active')) {
      els.dropOverlay.classList.remove('active');
    }
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.body.classList.remove('is-reordering-cards');
    draggedPageIndex = null;
    isDraggingCard = false;
    stopAutoScroll();
    hideFloatingDropIndicator();
    if (els.dropOverlay && els.dropOverlay.classList.contains('active')) {
      els.dropOverlay.classList.remove('active');
    }
  });

  slot.appendChild(card);
  slot.appendChild(gutterBtn);

  return slot;
}

// Progressive Chunk Workspace Rendering
function renderWorkspace() {
  currentRenderSequence++;
  const thisToken = currentRenderSequence;

  updateSidebarUploadedDocuments();

  if (state.pages.length === 0) {
    els.emptyState.style.display = 'block';
    els.pageGrid.style.display = 'none';
    els.docTitleDisplay.textContent = 'Empty Document';
    if (els.btnToggleRemovePages) els.btnToggleRemovePages.disabled = true;
    updateStatus();
    return;
  }

  if (els.btnToggleRemovePages) els.btnToggleRemovePages.disabled = false;
  els.emptyState.style.display = 'none';
  els.pageGrid.style.display = 'flex';
  els.docTitleDisplay.textContent = `Document (${state.pages.length} pages)`;

  els.pageGrid.innerHTML = '';

  // Mount initial batch immediately (first 36 pages for instant view)
  const initialLimit = Math.min(36, state.pages.length);
  const initialFrag = document.createDocumentFragment();
  for (let i = 0; i < initialLimit; i++) {
    initialFrag.appendChild(createPageSlot(state.pages[i], i));
  }
  els.pageGrid.appendChild(initialFrag);

  // Stream remainder progressively in chunks of 48 via requestAnimationFrame
  if (state.pages.length > initialLimit) {
    let nextIndex = initialLimit;
    function appendNextBatch() {
      if (thisToken !== currentRenderSequence) return;
      if (nextIndex >= state.pages.length) return;

      const frag = document.createDocumentFragment();
      const chunkEnd = Math.min(nextIndex + 48, state.pages.length);
      for (let i = nextIndex; i < chunkEnd; i++) {
        frag.appendChild(createPageSlot(state.pages[i], i));
      }
      els.pageGrid.appendChild(frag);
      nextIndex = chunkEnd;

      if (nextIndex < state.pages.length) {
        requestAnimationFrame(appendNextBatch);
      }
    }
    requestAnimationFrame(appendNextBatch);
  }

  updateStatus();
}

function setZoom(newZoom) {
  state.zoom = Math.max(0.6, Math.min(1.5, Math.round(newZoom * 10) / 10));
  els.zoomLevelDisplay.textContent = `${Math.round(state.zoom * 100)}%`;
  renderWorkspace();
}

function updateStatus() {
  const total = state.pages.length;
  let portraits = 0;
  let landscapes = 0;
  state.pages.forEach(p => {
    if (p.orientation === 'Landscape') landscapes++;
    else portraits++;
  });

  els.statusPageCount.textContent = `${total} pages (${portraits} Portrait, ${landscapes} Landscape)`;
  const sourceCount = Object.keys(state.sourcePdfs).length;
  els.statusSourceCount.textContent = `${sourceCount} document${sourceCount === 1 ? '' : 's'}`;

  const selIdx = state.pages.findIndex(p => p.id === state.selectedPageId);
  if (selIdx !== -1) {
    const p = state.pages[selIdx];
    els.statusSelectedInfo.textContent = `Page ${selIdx + 1}: ${p.orientation} (${Math.round(p.effective_width)} × ${Math.round(p.effective_height)} pt)`;
  } else {
    els.statusSelectedInfo.textContent = 'No page selected';
  }
}

// Page Annotation Dialog (Text & Images)
async function handleExport() {
  if (state.pages.length === 0) {
    showToast("Cannot export: Workspace is empty", "error");
    return;
  }

  showToast("Compiling PDF document...", "info");
  els.btnExportPdf.disabled = true;

  try {
    let targetFilename = "Exported_Document.pdf";

    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_native_pdf_dialog) {
      const chosenPath = await window.pywebview.api.save_native_pdf_dialog(targetFilename);
      if (chosenPath) {
        targetFilename = chosenPath;
      }
    }

    const sourceBytesMap = {};
    for (const [id, doc] of Object.entries(state.sourcePdfs)) {
      if (doc.bytes_b64) {
        sourceBytesMap[id] = doc.bytes_b64;
      }
    }

    const payload = {
      manifest: state.pages,
      outputPath: targetFilename,
      sourceBytes: sourceBytesMap
    };

    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      showToast(`Exported ${data.page_count} pages (${(data.file_size / 1024).toFixed(1)} KB)`, 'success');

      if (data.pdf_base64) {
        const link = document.createElement('a');
        link.href = `data:application/pdf;base64,${data.pdf_base64}`;
        link.download = data.output_name || 'Exported_Document.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      loadDirectoryTree();
    } else {
      showToast(`Export failed: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Export error: ${err.message}`, 'error');
  } finally {
    els.btnExportPdf.disabled = false;
  }
}

// Toast Notifications (Minimalist, Zero emojis)
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  els.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.15s ease';
    setTimeout(() => toast.remove(), 180);
  }, 3000);
}

