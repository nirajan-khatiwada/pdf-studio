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

function createPageSlot(page, index) {
  const slot = document.createElement('div');
  slot.className = 'page-slot';
  slot.dataset.index = index;
  const card = document.createElement('div');
  card.className = 'page-card' + (state.selectedPageId === page.id ? ' selected' : '');
  card.dataset.id = page.id;
  
  const thumbBox = document.createElement('div');
  thumbBox.className = 'card-thumbnail-box';
  const img = document.createElement('img');
  img.src = page.thumbnail;
  thumbBox.appendChild(img);
  card.appendChild(thumbBox);

  const footer = document.createElement('div');
  footer.className = 'card-footer';
  footer.innerHTML = `<span class="page-num">${index + 1}</span><span class="page-meta">${page.orientation} · ${Math.round(page.effective_width)}×${Math.round(page.effective_height)} pt</span>`;
  card.appendChild(footer);

  card.addEventListener('click', () => {
    state.selectedPageId = page.id;
    updateStatus();
    renderWorkspace();
  });

  slot.appendChild(card);
  return slot;
}
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

