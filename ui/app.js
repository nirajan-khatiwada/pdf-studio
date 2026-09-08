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

function cleanupDragState() {
  draggedPageIndex = null;
  currentDropTargetIndex = null;
  dropPosition = null;
  isDraggingCard = false;
  stopAutoScroll();
  hideFloatingDropIndicator();
  document.body.classList.remove('is-reordering-cards');
  if (els.dropOverlay) {
    els.dropOverlay.classList.remove('active');
  }
  document.querySelectorAll('.page-card.dragging').forEach(card => {
    card.classList.remove('dragging');
  });
}

// Double-Click & Smart Clipboard Paste State
let lastPageClickTime = 0;
let lastPageClickPageId = null;
let lastPasteHandledTime = 0;

// Session Persistence & Auto-Save
let saveSessionTimeout = null;

function saveSessionDebounced() {
  clearTimeout(saveSessionTimeout);
  saveSessionTimeout = setTimeout(() => {
    executeSaveSession();
  }, 300);
}

function getSessionPayload() {
  const cleanSources = {};
  for (const [id, doc] of Object.entries(state.sourcePdfs)) {
    cleanSources[id] = {
      name: doc.name,
      path: doc.path || '',
      page_count: doc.page_count
    };
  }

  return {
    version: 1,
    timestamp: Date.now(),
    pages: state.pages,
    sourcePdfs: cleanSources,
    zoom: state.zoom,
    selectedPageId: state.selectedPageId,
  };
}

async function executeSaveSession() {
  const payload = getSessionPayload();
  const jsonStr = JSON.stringify(payload);

  if (jsonStr.length < 500000) {
    try {
      localStorage.setItem('pdf_studio_session', jsonStr);
    } catch (err) {
      // quota limit fallback
    }
  }

  try {
    await fetch('/api/save_session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonStr,
      keepalive: true
    });
  } catch (err) {
    console.warn('Auto-save session to backend failed:', err);
  }
}

async function loadSavedSession() {
  let sessionRestored = false;

  try {
    const res = await fetch('/api/load_session');
    const data = await res.json();
    if (data.success && data.session && Array.isArray(data.session.pages) && data.session.pages.length > 0) {
      applySessionData(data.session);
      sessionRestored = true;
    }
  } catch (err) {
    console.warn('Backend load_session error:', err);
  }

  if (!sessionRestored) {
    try {
      const localStr = localStorage.getItem('pdf_studio_session');
      if (localStr) {
        const parsed = JSON.parse(localStr);
        if (parsed && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          applySessionData(parsed);
          sessionRestored = true;
        }
      }
    } catch (localErr) {
      console.warn('localStorage session parse error:', localErr);
    }
  }

  if (sessionRestored) {
    renderWorkspace();
    updateSidebarUploadedDocuments();
    showToast(`Restored session (${state.pages.length} pages)`, 'info');
  } else {
    renderWorkspace();
  }

  return sessionRestored;
}

function applySessionData(session) {
  state.pages = session.pages || [];
  state.sourcePdfs = session.sourcePdfs || {};
  if (typeof session.zoom === 'number' && session.zoom >= 0.5 && session.zoom <= 2.0) {
    state.zoom = session.zoom;
    els.zoomLevelDisplay.textContent = `${Math.round(state.zoom * 100)}%`;
  }
  if (session.selectedPageId && state.pages.some(p => p.id === session.selectedPageId)) {
    state.selectedPageId = session.selectedPageId;
  } else if (state.pages.length > 0) {
    state.selectedPageId = state.pages[0].id;
  }
}

window.addEventListener('beforeunload', () => {
  const payload = getSessionPayload();
  const jsonStr = JSON.stringify(payload);
  try {
    localStorage.setItem('pdf_studio_session', jsonStr);
  } catch (e) {}

  if (navigator.sendBeacon) {
    const blob = new Blob([jsonStr], { type: 'application/json' });
    navigator.sendBeacon('/api/save_session', blob);
  }
});

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  initEventListeners();
  loadDirectoryTree();
  await loadSavedSession();
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
  }

  if (els.removePagesPopover) {
    els.removePagesPopover.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  // Close popover on click outside
  document.addEventListener('click', (e) => {
    if (els.removePagesPopover && els.removePagesPopover.classList.contains('open')) {
      if (!els.removePagesPopover.contains(e.target) && !els.btnToggleRemovePages.contains(e.target)) {
        closeRemovePagesPopover();
      }
    }
  });

  els.btnAnnotatePage.addEventListener('click', () => {
    const idx = getSelectedOrLastPageIndex();
    if (idx !== -1) openAnnotationDialog(state.pages[idx].id);
  });

  els.btnExportPdf.addEventListener('click', handleExport);
  els.btnUndo.addEventListener('click', undo);
  els.btnRedo.addEventListener('click', redo);

  els.btnZoomIn.addEventListener('click', () => setZoom(state.zoom + 0.1));
  els.btnZoomOut.addEventListener('click', () => setZoom(state.zoom - 0.1));

  els.btnClearAll.addEventListener('click', handleClearAll);

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
      e.preventDefault();
      redo();
    } else if (e.key === 'Delete' && state.selectedPageId && !els.annotationDialog.classList.contains('open')) {
      const idx = state.pages.findIndex(p => p.id === state.selectedPageId);
      if (idx !== -1) removePage(idx);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      els.btnToggleSidebar.click();
    } else if (e.key === 'Enter' && state.selectedPageId && !els.annotationDialog.classList.contains('open')) {
      // Enter on selected page opens annotation dialog
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        e.preventDefault();
        openAnnotationDialog(state.selectedPageId);
      }
    } else if (e.key === 'Escape') {
      cleanupDragState();
      if (els.annotationDialog.classList.contains('open')) {
        e.preventDefault();
        closeAnnotationDialog();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      // If focused inside an input or inside a text overlay textarea, let native browser paste handle text typing
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || (activeEl.tagName === 'TEXTAREA' && activeEl.closest('.sheet-overlay')))) {
        return;
      }
      // Trigger async clipboard fallback if browser paste event doesn't dispatch automatically
      setTimeout(() => {
        if (!lastPasteHandledTime || (Date.now() - lastPasteHandledTime > 300)) {
          triggerClipboardApiFallback();
        }
      }, 50);
    }
  });

  // Global Drag & Mouse Safety Net: Guarantees drag state, overlays, and auto-scroll are always cleaned up
  window.addEventListener('mouseup', cleanupDragState);
  window.addEventListener('pointerup', cleanupDragState);
  window.addEventListener('dragend', cleanupDragState);
  window.addEventListener('blur', cleanupDragState);

  // Delegated Page Grid Drag & Drop (Butter-smooth, zero per-slot overhead)
  els.pageGrid.addEventListener('dragover', (e) => {
    if (draggedPageIndex === null) return;
    e.preventDefault();
    updateAutoScroll(e.clientY);

    const slot = e.target.closest('.page-slot');
    if (slot) {
      const curIdx = parseInt(slot.dataset.index, 10);
      if (!isNaN(curIdx)) {
        const rect = slot.getBoundingClientRect();
        const isLeft = (e.clientX - rect.left) < rect.width / 2;
        currentDropTargetIndex = curIdx;
        dropPosition = isLeft ? 'left' : 'right';
        showFloatingDropIndicator(slot, isLeft);
        return;
      }
    }

    // Fallback if hovered over padding/empty space in grid
    const slots = els.pageGrid.children;
    if (slots.length > 0) {
      const firstRect = slots[0].getBoundingClientRect();
      const lastSlot = slots[slots.length - 1];
      const lastRect = lastSlot.getBoundingClientRect();
      if (e.clientY < firstRect.top + 30) {
        currentDropTargetIndex = 0;
        dropPosition = 'left';
        showFloatingDropIndicator(slots[0], true);
      } else if (e.clientY > lastRect.bottom - 30) {
        currentDropTargetIndex = slots.length - 1;
        dropPosition = 'right';
        showFloatingDropIndicator(lastSlot, false);
      }
    }
  });

  els.pageGrid.addEventListener('drop', (e) => {
    if (draggedPageIndex === null) {
      cleanupDragState();
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    const fromIdx = draggedPageIndex;
    const slot = e.target.closest('.page-slot');
    let targetIdx = currentDropTargetIndex;
    if (slot) {
      const idx = parseInt(slot.dataset.index, 10);
      if (!isNaN(idx)) targetIdx = idx;
    }

    if (targetIdx === null) {
      const slots = els.pageGrid.children;
      if (slots.length > 0) {
        const firstRect = slots[0].getBoundingClientRect();
        if (e.clientY < firstRect.top + 40) {
          targetIdx = 0;
          dropPosition = 'left';
        } else {
          targetIdx = slots.length - 1;
          dropPosition = 'right';
        }
      }
    }

    cleanupDragState();

    if (targetIdx === null) return;

    let destIndex;
    if (fromIdx < targetIdx) {
      destIndex = dropPosition === 'right' ? targetIdx : targetIdx - 1;
    } else {
      destIndex = dropPosition === 'right' ? targetIdx + 1 : targetIdx;
    }

    destIndex = Math.max(0, Math.min(destIndex, state.pages.length - 1));

    if (fromIdx === destIndex) return;

    saveHistory();

    const itemToMove = state.pages.splice(fromIdx, 1)[0];
    if (!itemToMove) {
      renderWorkspace();
      return;
    }
    state.pages.splice(destIndex, 0, itemToMove);
    state.selectedPageId = itemToMove.id;

    movePageCardInDOM(fromIdx, destIndex);
    saveSessionDebounced();
    showToast(`Moved Page ${fromIdx + 1} to position ${destIndex + 1}`, 'success');
  });

  if (els.workspaceScroll) {
    els.workspaceScroll.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null || !els.workspaceScroll.contains(e.relatedTarget)) {
        hideFloatingDropIndicator();
        stopAutoScroll();
      }
    });
  }

  // File Drag & Drop onto Workspace (Only for external OS files, never during card reordering)
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (isDraggingCard || draggedPageIndex !== null) {
      if (els.dropOverlay && els.dropOverlay.classList.contains('active')) {
        els.dropOverlay.classList.remove('active');
      }
      updateAutoScroll(e.clientY);
      return;
    }
    if (e.dataTransfer && e.dataTransfer.types) {
      const types = Array.from(e.dataTransfer.types);
      if (types.includes('Files') && !types.includes('application/x-page-card')) {
        els.dropOverlay.classList.add('active');
      }
    }
  });

  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null || e.clientX <= 0 || e.clientY <= 0) {
      els.dropOverlay.classList.remove('active');
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const hadCardDrag = isDraggingCard || draggedPageIndex !== null;
    cleanupDragState();

    if (hadCardDrag) {
      return;
    }
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleDroppedFiles(e.dataTransfer.files);
    }
  });

  // Dialog Controls
  els.btnCloseDialog.addEventListener('click', closeAnnotationDialog);
  els.btnCancelDialog.addEventListener('click', closeAnnotationDialog);
  els.btnSaveDialog.addEventListener('click', saveAnnotationDialog);

  els.btnAddTextBox.addEventListener('click', addTextBoxInEditor);
  els.btnAddImageOverlay.addEventListener('click', handleAddImageOverlayClick);
  els.imageOverlayInput.addEventListener('change', handleImageOverlayFile);

  els.editorFontSize.addEventListener('change', (e) => {
    state.editor.fontSize = parseInt(e.target.value, 10);
    applySelectedTextProp('fontSize', state.editor.fontSize);
  });

  els.editorToggleBold.addEventListener('click', () => {
    state.editor.isBold = !state.editor.isBold;
    els.editorToggleBold.style.backgroundColor = state.editor.isBold ? '#e4e4e7' : 'transparent';
    applySelectedTextProp('isBold', state.editor.isBold);
  });

  els.editorToggleItalic.addEventListener('click', () => {
    state.editor.isItalic = !state.editor.isItalic;
    els.editorToggleItalic.style.backgroundColor = state.editor.isItalic ? '#e4e4e7' : 'transparent';
    applySelectedTextProp('isItalic', state.editor.isItalic);
  });

  document.querySelectorAll('.color-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const color = pill.dataset.color;
      state.editor.activeColor = color;
      applySelectedTextProp('color', color);
    });
  });

  els.editorDeleteSelected.addEventListener('click', deleteSelectedOverlay);

  // Global Clipboard Paste Listener (Ctrl+V) for image and text overlays
  window.addEventListener('paste', handleGlobalPaste);

  // Delegated Page Grid Double-Click Handler (100% reliable)
  els.pageGrid.addEventListener('dblclick', handlePageGridDblClick);

  // Editor Sheet Image Drag-and-Drop
  if (els.editorSheet) {
    els.editorSheet.addEventListener('dragover', (e) => {
      if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
        e.stopPropagation();
        els.editorSheet.classList.add('drag-over');
      }
    });

    els.editorSheet.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null || !els.editorSheet.contains(e.relatedTarget)) {
        els.editorSheet.classList.remove('drag-over');
      }
    });

    els.editorSheet.addEventListener('drop', (e) => {
      els.editorSheet.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
          e.preventDefault();
          e.stopPropagation();
          insertImageOverlayFromFile(file);
        }
      }
    });
  }
}

// Fast History Cloning
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
  if (state.history.length > 20) state.history.shift();
  state.future = [];
  updateUndoRedoButtons();
}

function undo() {
  if (state.history.length === 0) return;
  state.future.push(clonePageState(state.pages));
  state.pages = state.history.pop();
  renderWorkspace();
  updateUndoRedoButtons();
  saveSessionDebounced();
  showToast("Undid last action");
}

function redo() {
  if (state.future.length === 0) return;
  state.history.push(clonePageState(state.pages));
  state.pages = state.future.pop();
  renderWorkspace();
  updateUndoRedoButtons();
  saveSessionDebounced();
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

function updateSidebarUploadedDocuments() {
  const sources = Object.entries(state.sourcePdfs);
  els.sidebarUploadedCount.textContent = sources.length;

  if (sources.length === 0) {
    els.sidebarUploadedList.innerHTML = '<div class="sidebar-empty-note">No documents opened</div>';
    return;
  }

  els.sidebarUploadedList.innerHTML = '';
  sources.forEach(([id, doc]) => {
    const el = document.createElement('div');
    el.className = 'tree-item';
    el.innerHTML = `
      <span class="tree-item-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#09090b" stroke-width="1.8">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      </span>
      <span class="tree-item-name" title="${doc.name}">${doc.name}</span>
      <span class="tree-item-meta">${doc.page_count}p</span>
      <button class="tree-item-close" title="Remove document from workspace">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;

    // Remove all pages belonging to this source document
    el.querySelector('.tree-item-close').addEventListener('click', (e) => {
      e.stopPropagation();
      removeSourceDocument(id);
    });

    // Click to focus/select first page of this document
    el.addEventListener('click', (e) => {
      if (e.target.closest('.tree-item-close')) return;
      const targetPage = state.pages.find(p => p.source_pdf_id === id);
      if (targetPage) {
        state.selectedPageId = targetPage.id;
        document.querySelectorAll('.page-card').forEach(c => {
          c.classList.toggle('selected', c.dataset.id === targetPage.id);
        });
        updateStatus();
        const slot = Array.from(els.pageGrid.children).find(s => {
          const c = s.querySelector('.page-card');
          return c && c.dataset.id === targetPage.id;
        });
        if (slot) slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    // Double-click to open first page of this document in editor
    el.addEventListener('dblclick', (e) => {
      if (e.target.closest('.tree-item-close')) return;
      const targetPage = state.pages.find(p => p.source_pdf_id === id);
      if (targetPage) {
        openAnnotationDialog(targetPage.id);
      }
    });

    els.sidebarUploadedList.appendChild(el);
  });
}

function removeSourceDocument(sourceId) {
  cleanupDragState();
  saveHistory();
  state.pages = state.pages.filter(p => p.source_pdf_id !== sourceId);
  delete state.sourcePdfs[sourceId];
  if (state.selectedPageId && !state.pages.some(p => p.id === state.selectedPageId)) {
    state.selectedPageId = state.pages[0] ? state.pages[0].id : null;
  }
  renderWorkspace();
  showToast("Removed document from workspace");
}

// File Loading & Uploading
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
    path: doc.path || '',
    page_count: doc.page_count
  };

  state.pages = state.pages.concat(doc.pages);
  if (!state.selectedPageId && state.pages.length > 0) {
    state.selectedPageId = state.pages[0].id;
  }
  renderWorkspace();
  updateSidebarUploadedDocuments();
  saveSessionDebounced();
}

function handleClearAll() {
  if (state.pages.length === 0) return;
  if (confirm("Clear all pages from workspace?")) {
    cleanupDragState();
    saveHistory();
    state.pages = [];
    state.sourcePdfs = {};
    state.selectedPageId = null;
    try {
      localStorage.removeItem('pdf_studio_session');
    } catch (e) {}
    fetch('/api/clear_session', { method: 'POST' }).catch(() => {});
    renderWorkspace();
    updateSidebarUploadedDocuments();
    showToast("Workspace cleared");
  }
}

// Blank Page Insertion with Orientation Inheritance and Offline Canvas Fallback
async function addBlankPage(afterIndex = null) {
  cleanupDragState();
  saveHistory();
  let refWidth = 595.28;
  let refHeight = 841.89;
  let refRotation = 0;
  let refOrientation = "Portrait";

  let insertPos = state.pages.length;

  if (typeof afterIndex === 'number' && !isNaN(afterIndex) && afterIndex >= 0 && afterIndex < state.pages.length) {
    const refPage = state.pages[afterIndex];
    if (refPage) {
      refWidth = refPage.width || 595.28;
      refHeight = refPage.height || 841.89;
      refRotation = refPage.rotation || 0;
      refOrientation = refPage.orientation || (refWidth > refHeight ? "Landscape" : "Portrait");
      insertPos = afterIndex + 1;
    }
  } else if (state.selectedPageId && state.pages.length > 0) {
    const selIdx = state.pages.findIndex(p => p.id === state.selectedPageId);
    if (selIdx !== -1) {
      const refPage = state.pages[selIdx];
      refWidth = refPage.width || 595.28;
      refHeight = refPage.height || 841.89;
      refRotation = refPage.rotation || 0;
      refOrientation = refPage.orientation || (refWidth > refHeight ? "Landscape" : "Portrait");
      insertPos = selIdx + 1;
    }
  }

  insertPos = Math.max(0, Math.min(state.pages.length, insertPos));

  const createLocalBlankPage = () => {
    const effW = (refRotation === 90 || refRotation === 270) ? refHeight : refWidth;
    const effH = (refRotation === 90 || refRotation === 270) ? refWidth : refHeight;
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 200;
    thumbCanvas.height = Math.round(200 * (effH / effW));
    const ctx = thumbCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, thumbCanvas.width - 2, thumbCanvas.height - 2);
    }
    return {
      id: `blank_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      source_pdf_id: 'blank',
      source_pdf_name: 'Blank Page',
      source_page_index: -1,
      width: Math.round(refWidth * 100) / 100,
      height: Math.round(refHeight * 100) / 100,
      rotation: refRotation,
      effective_width: Math.round(effW * 100) / 100,
      effective_height: Math.round(effH * 100) / 100,
      orientation: refOrientation,
      is_blank: true,
      thumbnail: thumbCanvas.toDataURL('image/png'),
      overlays: []
    };
  };

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
      saveSessionDebounced();
      showToast(`Inserted blank ${refOrientation} page`, 'success');
      return;
    }
  } catch (err) {
    console.warn("Backend create_blank fetch failed, using fallback:", err);
  }

  // Fallback if backend failed or timed out
  const fallbackPage = createLocalBlankPage();
  state.pages.splice(insertPos, 0, fallbackPage);
  state.selectedPageId = fallbackPage.id;
  renderWorkspace();
  saveSessionDebounced();
  showToast(`Inserted blank ${refOrientation} page`, 'success');
}

// Remove and Rotate
function removePage(index) {
  cleanupDragState();
  if (index < 0 || index >= state.pages.length) return;
  saveHistory();
  const removed = state.pages.splice(index, 1)[0];
  if (state.selectedPageId === removed.id) {
    state.selectedPageId = state.pages[index] ? state.pages[index].id : (state.pages[index - 1] ? state.pages[index - 1].id : null);
  }

  renderWorkspace();
  updateSidebarUploadedDocuments();
  updateStatus();
  saveSessionDebounced();
  showToast(`Removed Page ${index + 1}`);
}

// Remove Pages By Page Number and Range (start-end) with Live Blur
function parsePageRanges(str, totalPages) {
  if (!str || totalPages <= 0) return [];
  // Normalize hyphens with spaces (e.g. " 2 - 4 " -> "2-4")
  const normalized = str.replace(/\s*-\s*/g, '-');
  const parts = normalized.split(/[,;\s]+/).map(p => p.trim()).filter(Boolean);
  const matched = new Set();

  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      const pageNum = parseInt(part, 10);
      if (pageNum >= 1 && pageNum <= totalPages) {
        matched.add(pageNum - 1);
      }
    } else if (/^(\d+)-(\d+)$/.test(part)) {
      const match = part.match(/^(\d+)-(\d+)$/);
      let start = parseInt(match[1], 10);
      let end = parseInt(match[2], 10);
      if (start > end) {
        const temp = start;
        start = end;
        end = temp;
      }
      start = Math.max(1, start);
      end = Math.min(totalPages, end);
      for (let p = start; p <= end; p++) {
        matched.add(p - 1);
      }
    } else if (/^(\d+)-$/.test(part)) {
      const start = parseInt(part, 10);
      if (start >= 1 && start <= totalPages) {
        matched.add(start - 1);
      }
    }
  }

  return Array.from(matched).sort((a, b) => a - b);
}

function openRemovePagesPopover() {
  if (state.pages.length === 0) {
    showToast("Workspace has no pages to remove", "info");
    return;
  }
  if (!els.removePagesPopover) return;
  els.removePagesPopover.classList.add('open');
  if (els.btnToggleRemovePages) els.btnToggleRemovePages.classList.add('active');
  els.inputRemovePages.value = '';
  els.removePagesFeedback.textContent = `Enter page numbers or range (1 - ${state.pages.length})`;
  els.removePagesFeedback.classList.remove('active');
  els.btnExecuteRemovePages.disabled = true;
  els.btnExecuteRemovePages.textContent = "Delete";
  setTimeout(() => els.inputRemovePages.focus(), 60);
}

let currentMarkedIndices = new Set();
let removePagesDebounceTimer = null;

function closeRemovePagesPopover() {
  if (!els.removePagesPopover) return;
  els.removePagesPopover.classList.remove('open');
  if (els.btnToggleRemovePages) els.btnToggleRemovePages.classList.remove('active');
  if (els.inputRemovePages) els.inputRemovePages.value = '';
  clearTimeout(removePagesDebounceTimer);
  clearDeletionBlur();
}

function toggleRemovePagesPopover() {
  if (!els.removePagesPopover) return;
  if (els.removePagesPopover.classList.contains('open')) {
    closeRemovePagesPopover();
  } else {
    openRemovePagesPopover();
  }
}

// Fast O(K) blur clearing only for previously marked cards
function clearDeletionBlur() {
  if (currentMarkedIndices.size === 0) return;
  const slots = els.pageGrid.children;
  for (const idx of currentMarkedIndices) {
    const slot = slots[idx];
    if (slot) {
      const card = slot.querySelector('.page-card');
      if (card) card.classList.remove('marked-for-deletion');
    }
  }
  currentMarkedIndices.clear();
}

function handleRemovePagesInput() {
  clearTimeout(removePagesDebounceTimer);
  removePagesDebounceTimer = setTimeout(processRemovePagesInput, 70);
}

// Diff-based blur marking: only modifies cards whose state changed
function processRemovePagesInput() {
  const val = els.inputRemovePages.value.trim();
  if (!val) {
    clearDeletionBlur();
    els.removePagesFeedback.textContent = `Enter page numbers or range (1 - ${state.pages.length})`;
    els.removePagesFeedback.classList.remove('active');
    els.btnExecuteRemovePages.disabled = true;
    els.btnExecuteRemovePages.textContent = "Delete";
    return;
  }

  const indices = parsePageRanges(val, state.pages.length);
  const newSet = new Set(indices);
  const slots = els.pageGrid.children;

  // Unmark cards no longer in selection
  for (const idx of currentMarkedIndices) {
    if (!newSet.has(idx)) {
      const slot = slots[idx];
      if (slot) {
        const card = slot.querySelector('.page-card');
        if (card) card.classList.remove('marked-for-deletion');
      }
    }
  }

  // Mark newly selected cards
  for (const idx of newSet) {
    if (!currentMarkedIndices.has(idx)) {
      const slot = slots[idx];
      if (slot) {
        const card = slot.querySelector('.page-card');
        if (card) card.classList.add('marked-for-deletion');
      }
    }
  }

  currentMarkedIndices = newSet;

  if (indices.length === 0) {
    els.removePagesFeedback.textContent = "No matching pages found in document.";
    els.removePagesFeedback.classList.remove('active');
    els.btnExecuteRemovePages.disabled = true;
    els.btnExecuteRemovePages.textContent = "Delete";
  } else {
    const listSummary = indices.length <= 6
      ? indices.map(i => i + 1).join(', ')
      : `${indices.slice(0, 5).map(i => i + 1).join(', ')}... (+${indices.length - 5} more)`;
    els.removePagesFeedback.textContent = `${indices.length} page${indices.length > 1 ? 's' : ''} selected: [${listSummary}]`;
    els.removePagesFeedback.classList.add('active');
    els.btnExecuteRemovePages.disabled = false;
    els.btnExecuteRemovePages.textContent = `Delete ${indices.length} Page${indices.length > 1 ? 's' : ''}`;

    // Scroll first matched card into view if needed
    const firstIdx = indices[0];
    const firstSlot = slots[firstIdx];
    if (firstSlot && els.workspaceScroll) {
      const containerRect = els.workspaceScroll.getBoundingClientRect();
      const cardRect = firstSlot.getBoundingClientRect();
      const isVisible = (
        cardRect.top >= containerRect.top &&
        cardRect.bottom <= containerRect.bottom
      );
      if (!isVisible) {
        firstSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }
}

// Batch deletion with drag cleanup and clean state synchronization
function executeRemovePages() {
  cleanupDragState();
  const val = els.inputRemovePages.value.trim();
  const indices = parsePageRanges(val, state.pages.length);
  if (indices.length === 0) return;

  saveHistory();
  const indexSet = new Set(indices);
  const removedCount = indices.length;

  // 1. Update state array
  state.pages = state.pages.filter((_, idx) => !indexSet.has(idx));

  if (state.selectedPageId && !state.pages.some(p => p.id === state.selectedPageId)) {
    state.selectedPageId = state.pages[0] ? state.pages[0].id : null;
  }

  closeRemovePagesPopover();
  currentMarkedIndices.clear();

  // 2. Clean workspace render
  renderWorkspace();
  updateSidebarUploadedDocuments();
  updateStatus();
  saveSessionDebounced();

  showToast(`Removed ${removedCount} page${removedCount > 1 ? 's' : ''}`, 'success');
}


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

  saveSessionDebounced();
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
    if (!isDraggingCard || draggedPageIndex === null) {
      stopAutoScroll();
      return;
    }
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
  if (!isDraggingCard || draggedPageIndex === null || !els.workspaceScroll) {
    stopAutoScroll();
    return;
  }

  const rect = els.workspaceScroll.getBoundingClientRect();
  const edgeZone = 70;

  if (clientY < rect.top + edgeZone) {
    const distance = (rect.top + edgeZone) - clientY;
    const ratio = Math.min(1.5, Math.max(0.15, distance / edgeZone));
    autoScrollSpeed = -Math.round(6 + ratio * 20);
    startAutoScrollLoop();
  } else if (clientY > rect.bottom - edgeZone) {
    const distance = clientY - (rect.bottom - edgeZone);
    const ratio = Math.min(1.5, Math.max(0.15, distance / edgeZone));
    autoScrollSpeed = Math.round(6 + ratio * 20);
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

  const stopActionMousedown = (e) => {
    e.stopPropagation();
  };

  const rotateBtn = document.createElement('button');
  rotateBtn.className = 'action-pill rotate';
  rotateBtn.title = 'Rotate 90° clockwise';
  rotateBtn.draggable = false;
  rotateBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>';
  rotateBtn.addEventListener('mousedown', stopActionMousedown);
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
  editBtn.addEventListener('mousedown', stopActionMousedown);
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openAnnotationDialog(page.id);
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'action-pill danger';
  removeBtn.title = 'Remove page';
  removeBtn.draggable = false;
  removeBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  removeBtn.addEventListener('mousedown', stopActionMousedown);
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const curIdx = parseInt(slot.dataset.index, 10);
    removePage(curIdx);
  });

  actions.addEventListener('mouseenter', () => {
    card.draggable = false;
  });
  actions.addEventListener('mouseleave', () => {
    if (!isDraggingCard) card.draggable = true;
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
  imgWrapper.className = 'card-img-wrapper';
  imgWrapper.style.position = 'relative';
  imgWrapper.style.display = 'inline-block';
  imgWrapper.style.lineHeight = '0';
  imgWrapper.style.maxWidth = '100%';
  imgWrapper.style.maxHeight = '100%';
  imgWrapper.style.pointerEvents = 'none';

  const img = document.createElement('img');
  img.src = page.thumbnail;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = `Page ${index + 1}`;
  img.draggable = false;
  if (img.setAttribute) {
    img.setAttribute('draggable', 'false');
  }
  img.style.userSelect = 'none';
  img.style.webkitUserDrag = 'none';
  img.style.display = 'block';
  img.style.maxWidth = '100%';
  img.style.maxHeight = `${Math.round(236 * state.zoom)}px`;
  img.style.objectFit = 'contain';
  if (page.rotation !== 0) {
    img.style.transform = `rotate(${page.rotation}deg)`;
  }
  imgWrapper.appendChild(img);

  // Live miniature overlays layer so image and text additions on blank (and any) pages show instantly!
  if (page.overlays && page.overlays.length > 0) {
    const miniLayer = document.createElement('div');
    miniLayer.className = 'card-mini-overlays-layer';

    page.overlays.forEach(ov => {
      const ovEl = document.createElement('div');
      ovEl.className = `card-mini-overlay-item ${ov.type === 'text' ? 'text-item' : 'image-item'}`;
      ovEl.style.left = `${ov.x}%`;
      ovEl.style.top = `${ov.y}%`;
      ovEl.style.width = `${ov.width}%`;
      ovEl.style.height = `${ov.height}%`;

      if (ov.type === 'image' && ov.imageUrl) {
        const miniImg = document.createElement('img');
        miniImg.src = ov.imageUrl;
        miniImg.draggable = false;
        ovEl.appendChild(miniImg);
      } else if (ov.type === 'text' && ov.text) {
        ovEl.style.fontSize = `${Math.max(6, Math.round((ov.fontSize || 16) * 0.22 * state.zoom))}px`;
        ovEl.style.color = ov.color || '#000000';
        ovEl.style.fontWeight = ov.isBold ? '700' : '400';
        ovEl.style.fontStyle = ov.isItalic ? 'italic' : 'normal';
        ovEl.textContent = ov.text;
      }
      miniLayer.appendChild(ovEl);
    });

    imgWrapper.appendChild(miniLayer);

    // Badge showing count of overlays if present
    const ovBadge = document.createElement('div');
    ovBadge.style.cssText = 'position: absolute; bottom: 4px; right: 4px; background: rgba(9, 9, 11, 0.85); color: #fff; font-size: 9px; padding: 2px 5px; border-radius: 3px; font-weight: 500; display: flex; align-items: center; gap: 3px; pointer-events: none; z-index: 5;';
    ovBadge.innerHTML = `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> ${page.overlays.length}`;
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
  gutterBtn.addEventListener('mouseenter', () => {
    card.draggable = false;
  });
  gutterBtn.addEventListener('mouseleave', () => {
    if (!isDraggingCard) card.draggable = true;
  });
  gutterBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });
  gutterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const curIdx = parseInt(slot.dataset.index, 10);
    addBlankPage(curIdx);
  });

  // Butter-Smooth Drag Initiation
  card.addEventListener('dragstart', (e) => {
    if (e.target.closest('.card-actions') || e.target.closest('.action-pill') || e.target.closest('.gutter-add-btn') || e.target.closest('button')) {
      e.preventDefault();
      return;
    }
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
    cleanupDragState();
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
  saveSessionDebounced();
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
async function openAnnotationDialog(pageId) {
  const page = state.pages.find(p => p.id === pageId);
  if (!page) return;

  state.editor.pageId = pageId;
  state.editor.overlays = JSON.parse(JSON.stringify(page.overlays || []));
  state.editor.selectedOverlayId = null;

  const pageIdx = state.pages.indexOf(page);
  els.dialogPageTitle.textContent = `Annotate Page ${pageIdx + 1} (${page.orientation} · ${Math.round(page.effective_width)} × ${Math.round(page.effective_height)} pt)`;

  let imageUrl = page.thumbnail;
  if (!page.is_blank && page.source_pdf_id !== 'blank') {
    try {
      const res = await fetch('/api/high_res_page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcePdfId: page.source_pdf_id,
          sourcePageIndex: page.source_page_index,
          rotation: page.rotation
        })
      });
      const data = await res.json();
      if (data.success && data.imageUrl) {
        imageUrl = data.imageUrl;
      }
    } catch (e) {
      console.warn("High-res load fallback:", e);
    }
  }

  els.editorSheetImage.src = imageUrl;
  renderEditorOverlays();
  els.annotationDialog.classList.add('open');
}

function closeAnnotationDialog() {
  if (state.editor.pageId) {
    const page = state.pages.find(p => p.id === state.editor.pageId);
    if (page && state.editor.overlays) {
      page.overlays = JSON.parse(JSON.stringify(state.editor.overlays));
      renderWorkspace();
      saveSessionDebounced();
    }
  }
  els.annotationDialog.classList.remove('open');
  if (els.editorOverlaysLayer) {
    els.editorOverlaysLayer.innerHTML = '';
  }
  if (els.editorSheetImage) {
    els.editorSheetImage.src = '';
  }
  state.editor.pageId = null;
  state.editor.overlays = [];
  state.editor.selectedOverlayId = null;
  cleanupDragState();
}

function saveAnnotationDialog() {
  if (!state.editor.pageId) return;
  saveHistory();
  const page = state.pages.find(p => p.id === state.editor.pageId);
  if (page) {
    page.overlays = JSON.parse(JSON.stringify(state.editor.overlays));
    renderWorkspace();
    saveSessionDebounced();
    showToast(`Saved annotations for Page ${state.pages.indexOf(page) + 1}`, 'success');

    // Asynchronously request baked composite thumbnail from backend
    fetch('/api/composite_thumbnail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: page })
    }).then(res => res.json()).then(data => {
      if (data.success && data.thumbnail) {
        page.thumbnail = data.thumbnail;
        saveSessionDebounced();
      }
    }).catch(() => {});
  }
  closeAnnotationDialog();
}

function renderEditorOverlays() {
  els.editorOverlaysLayer.innerHTML = '';
  state.editor.overlays.forEach(item => {
    const el = document.createElement('div');
    el.className = `sheet-overlay ${item.id === state.editor.selectedOverlayId ? 'active' : ''}`;
    el.dataset.id = item.id;
    el.style.left = `${item.x}%`;
    el.style.top = `${item.y}%`;
    el.style.width = `${item.width}%`;
    el.style.height = `${item.height}%`;

    if (item.type === 'text') {
      const textarea = document.createElement('textarea');
      textarea.value = item.text || '';
      textarea.style.fontSize = `${item.fontSize || 16}px`;
      textarea.style.color = item.color || '#000000';
      textarea.style.fontWeight = item.isBold ? '700' : '400';
      textarea.style.fontStyle = item.isItalic ? 'italic' : 'normal';
      textarea.placeholder = 'Type text...';

      textarea.addEventListener('input', (e) => {
        item.text = e.target.value;
        if (state.editor.pageId) {
          const page = state.pages.find(p => p.id === state.editor.pageId);
          if (page) {
            page.overlays = JSON.parse(JSON.stringify(state.editor.overlays));
            renderWorkspace();
            saveSessionDebounced();
          }
        }
      });

      textarea.addEventListener('focus', () => selectEditorOverlay(item.id));
      el.appendChild(textarea);
    } else if (item.type === 'image') {
      const img = document.createElement('img');
      img.src = item.imageUrl;
      img.draggable = false;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'contain';
      img.style.userSelect = 'none';
      img.style.webkitUserDrag = 'none';
      el.appendChild(img);
    }

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    makeResizable(el, resizeHandle, item);
    el.appendChild(resizeHandle);

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-overlay-btn';
    delBtn.innerHTML = '✕';
    delBtn.title = 'Delete element';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteOverlay(item.id);
    });
    el.appendChild(delBtn);

    makeMovable(el, item);

    el.addEventListener('mousedown', (e) => {
      if (e.target !== resizeHandle && e.target !== delBtn) {
        selectEditorOverlay(item.id);
      }
    });

    els.editorOverlaysLayer.appendChild(el);
  });
}

function selectEditorOverlay(id) {
  state.editor.selectedOverlayId = id;
  const item = state.editor.overlays.find(o => o.id === id);
  if (item && item.type === 'text') {
    els.editorFontSize.value = String(item.fontSize || 16);
    els.editorToggleBold.style.backgroundColor = item.isBold ? '#e4e4e7' : 'transparent';
    els.editorToggleItalic.style.backgroundColor = item.isItalic ? '#e4e4e7' : 'transparent';
  }
  document.querySelectorAll('.sheet-overlay').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });
}

function applySelectedTextProp(prop, val) {
  if (!state.editor.selectedOverlayId) return;
  const item = state.editor.overlays.find(o => o.id === state.editor.selectedOverlayId);
  if (item && item.type === 'text') {
    item[prop] = val;
    renderEditorOverlays();
    if (state.editor.pageId) {
      const page = state.pages.find(p => p.id === state.editor.pageId);
      if (page) {
        page.overlays = JSON.parse(JSON.stringify(state.editor.overlays));
        renderWorkspace();
        saveSessionDebounced();
      }
    }
  }
}

function addTextBoxInEditor() {
  const offset = (state.editor.overlays.length % 6) * 3;
  const newText = {
    id: `txt_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    type: 'text',
    text: 'Click to edit text',
    x: Math.min(65, 20 + offset),
    y: Math.min(70, 20 + offset),
    width: 35,
    height: 8,
    fontSize: state.editor.fontSize || 16,
    isBold: state.editor.isBold || false,
    isItalic: state.editor.isItalic || false,
    color: state.editor.activeColor || '#000000',
  };
  state.editor.overlays.push(newText);
  selectEditorOverlay(newText.id);
  renderEditorOverlays();
  if (state.editor.pageId) {
    const page = state.pages.find(p => p.id === state.editor.pageId);
    if (page) {
      page.overlays = JSON.parse(JSON.stringify(state.editor.overlays));
      renderWorkspace();
      saveSessionDebounced();
    }
  }
}

async function handleAddImageOverlayClick() {
  // 1. Try pywebview native desktop dialog first
  if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.open_native_image_dialog === 'function') {
    try {
      const res = await window.pywebview.api.open_native_image_dialog();
      if (res && res.dataUrl) {
        await insertImageOverlayFromDataUrl(res.dataUrl);
        return;
      } else if (res === null) {
        return;
      }
    } catch (err) {
      console.warn('Native image dialog error, falling back to dynamic input:', err);
    }
  }

  // 2. Web browser or fallback mode: use fresh dynamic input
  triggerFreshImageFileInput();
}

function triggerFreshImageFileInput() {
  const tempInput = document.createElement('input');
  tempInput.type = 'file';
  tempInput.accept = 'image/png, image/jpeg, image/webp, image/gif, image/bmp, image/*';
  tempInput.style.position = 'fixed';
  tempInput.style.top = '-1000px';
  tempInput.style.left = '-1000px';
  tempInput.style.opacity = '0';
  document.body.appendChild(tempInput);

  tempInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      await insertImageOverlayFromFile(file);
    }
    setTimeout(() => {
      if (tempInput.parentNode) {
        tempInput.parentNode.removeChild(tempInput);
      }
    }, 100);
  }, { once: true });

  tempInput.click();
}

function handleImageOverlayFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  insertImageOverlayFromFile(file);
  if (els.imageOverlayInput) {
    els.imageOverlayInput.value = '';
  }
}

function handlePageGridDblClick(e) {
  if (e.target.closest('.action-pill') || e.target.closest('.gutter-add-btn')) return;
  const slot = e.target.closest('.page-slot');
  if (slot) {
    const idx = parseInt(slot.dataset.index, 10);
    if (!isNaN(idx) && state.pages[idx]) {
      openAnnotationDialog(state.pages[idx].id);
    }
  }
}

function insertImageOverlayFromDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const sheetRect = els.editorSheet ? els.editorSheet.getBoundingClientRect() : { width: 600, height: 800 };
      const sheetW = sheetRect.width > 0 ? sheetRect.width : 600;
      const sheetH = sheetRect.height > 0 ? sheetRect.height : 800;

      const natW = img.naturalWidth || 300;
      const natH = img.naturalHeight || 300;
      const aspect = natW / natH;

      // Proportional sizing: around 35% of page width preserving natural aspect ratio
      let widthPercent = 35;
      let widthPx = (widthPercent / 100) * sheetW;
      let heightPx = widthPx / aspect;
      let heightPercent = (heightPx / sheetH) * 100;

      // Prevent oversized overlays
      if (heightPercent > 60) {
        heightPercent = 60;
        heightPx = (heightPercent / 100) * sheetH;
        widthPx = heightPx * aspect;
        widthPercent = (widthPx / sheetW) * 100;
      }

      widthPercent = Math.min(90, Math.max(10, Math.round(widthPercent * 10) / 10));
      heightPercent = Math.min(90, Math.max(6, Math.round(heightPercent * 10) / 10));

      // Staggered positioning
      const offset = (state.editor.overlays.length % 6) * 3;
      const posX = Math.max(5, Math.min(100 - widthPercent, Math.round(((100 - widthPercent) / 2) + offset)));
      const posY = Math.max(5, Math.min(100 - heightPercent, Math.round(((100 - heightPercent) / 2) + offset)));

      const newImg = {
        id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        type: 'image',
        imageUrl: dataUrl,
        x: posX,
        y: posY,
        width: widthPercent,
        height: heightPercent,
      };

      state.editor.overlays.push(newImg);
      selectEditorOverlay(newImg.id);
      renderEditorOverlays();
      if (state.editor.pageId) {
        const page = state.pages.find(p => p.id === state.editor.pageId);
        if (page) {
          page.overlays = JSON.parse(JSON.stringify(state.editor.overlays));
          renderWorkspace();
          saveSessionDebounced();
        }
      }
      lastPasteHandledTime = Date.now();
      showToast("Added image overlay to page", "success");
      resolve(newImg);
    };
    img.src = dataUrl;
  });
}

function insertImageOverlayFromFile(fileOrBlob) {
  if (!fileOrBlob) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const item = await insertImageOverlayFromDataUrl(reader.result);
        resolve(item);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(fileOrBlob);
  });
}

function insertTextOverlayFromClipboard(text) {
  if (!text || !text.trim()) return;
  const cleanText = text.trim();
  const lines = cleanText.split('\n');
  const maxLineLen = Math.max(...lines.map(l => l.length));

  // Determine intelligent width & height
  let widthPercent = Math.min(80, Math.max(25, Math.round(maxLineLen * 1.3)));
  let heightPercent = Math.min(50, Math.max(8, Math.round(lines.length * 4.5 + 5)));

  const offset = (state.editor.overlays.length % 6) * 3;
  const posX = Math.max(5, Math.min(100 - widthPercent, Math.round(((100 - widthPercent) / 2) + offset)));
  const posY = Math.max(5, Math.min(100 - heightPercent, Math.round(((100 - heightPercent) / 2) + offset)));

  const newText = {
    id: `txt_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    type: 'text',
    text: cleanText,
    x: posX,
    y: posY,
    width: widthPercent,
    height: heightPercent,
    fontSize: state.editor.fontSize || 16,
    isBold: state.editor.isBold || false,
    isItalic: state.editor.isItalic || false,
    color: state.editor.activeColor || '#000000',
  };

  state.editor.overlays.push(newText);
  selectEditorOverlay(newText.id);
  renderEditorOverlays();
  if (state.editor.pageId) {
    const page = state.pages.find(p => p.id === state.editor.pageId);
    if (page) {
      page.overlays = JSON.parse(JSON.stringify(state.editor.overlays));
      renderWorkspace();
      saveSessionDebounced();
    }
  }

  setTimeout(() => {
    const textarea = els.editorOverlaysLayer.querySelector(`.sheet-overlay[data-id="${newText.id}"] textarea`);
    if (textarea) textarea.focus();
  }, 50);

  lastPasteHandledTime = Date.now();
  showToast("Pasted text overlay onto page", "success");
}

async function handleGlobalPaste(e) {
  // If actively focused in an input (e.g. range delete input), let native paste handle it
  const activeEl = document.activeElement;
  if (activeEl && activeEl.tagName === 'INPUT') {
    return;
  }

  const clipboardData = e.clipboardData || window.clipboardData;
  let imageFile = null;

  if (clipboardData) {
    // 1. Check DataTransferItemList for image
    if (clipboardData.items) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.type && item.type.startsWith('image/')) {
          imageFile = item.getAsFile();
          break;
        }
      }
    }

    // 2. Check files list for image
    if (!imageFile && clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const f = clipboardData.files[i];
        if (f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)) {
          imageFile = f;
          break;
        }
      }
    }
  }

  const pastedText = clipboardData ? (clipboardData.getData('text/plain') || clipboardData.getData('text')) : '';

  // Prevent default synchronously on event tick so browser does not execute default action
  if (imageFile) {
    e.preventDefault();
    e.stopPropagation();
  } else if (pastedText && pastedText.trim().length > 0) {
    if (activeEl && activeEl.tagName === 'TEXTAREA' && activeEl.closest('.sheet-overlay')) {
      lastPasteHandledTime = Date.now();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  // Ensure annotation editor dialog is open (auto-opens for selected page if closed!)
  let isDialogOpen = els.annotationDialog.classList.contains('open');
  if (!isDialogOpen) {
    if (state.pages.length === 0) {
      showToast("Workspace has no pages to paste onto", "info");
      return;
    }
    const targetIdx = getSelectedOrLastPageIndex();
    if (targetIdx === -1) return;
    await openAnnotationDialog(state.pages[targetIdx].id);
    isDialogOpen = true;
  }

  // PRIORITY 1: Image in clipboard -> paste image overlay
  if (imageFile) {
    await insertImageOverlayFromFile(imageFile);
    return;
  }

  // PRIORITY 2: Text in clipboard -> paste text overlay
  if (pastedText && pastedText.trim().length > 0) {
    insertTextOverlayFromClipboard(pastedText);
    return;
  }

  // PRIORITY 3: Fallback using navigator.clipboard API
  if (navigator.clipboard && (navigator.clipboard.read || navigator.clipboard.readText)) {
    await triggerClipboardApiFallback();
  }
}

async function triggerClipboardApiFallback() {
  let isDialogOpen = els.annotationDialog.classList.contains('open');
  if (!isDialogOpen) {
    if (state.pages.length === 0) return;
    const targetIdx = getSelectedOrLastPageIndex();
    if (targetIdx === -1) return;
    await openAnnotationDialog(state.pages[targetIdx].id);
    isDialogOpen = true;
  }

  try {
    if (navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            await insertImageOverlayFromFile(blob);
            return;
          }
        }
      }
    }

    if (navigator.clipboard.readText) {
      const clipText = await navigator.clipboard.readText();
      if (clipText && clipText.trim().length > 0) {
        const activeEl = document.activeElement;
        if (!(activeEl && activeEl.tagName === 'TEXTAREA' && activeEl.closest('.sheet-overlay'))) {
          insertTextOverlayFromClipboard(clipText);
          return;
        }
      }
    }
  } catch (err) {
    // Silent ignore for clipboard permission denial
  }
}

function deleteSelectedOverlay() {
  if (!state.editor.selectedOverlayId) return;
  deleteOverlay(state.editor.selectedOverlayId);
}

function deleteOverlay(id) {
  state.editor.overlays = state.editor.overlays.filter(o => o.id !== id);
  if (state.editor.selectedOverlayId === id) {
    state.editor.selectedOverlayId = null;
  }
  renderEditorOverlays();
  if (state.editor.pageId) {
    const page = state.pages.find(p => p.id === state.editor.pageId);
    if (page) {
      page.overlays = JSON.parse(JSON.stringify(state.editor.overlays));
      renderWorkspace();
      saveSessionDebounced();
    }
  }
}

function makeMovable(element, item) {
  let isDragging = false;
  let startX, startY;
  let startLeft, startTop;

  element.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'TEXTAREA' && document.activeElement === e.target) {
      return;
    }
    if (e.target.classList.contains('resize-handle') || e.target.classList.contains('delete-overlay-btn')) return;

    if (e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
    }

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const sheetRect = els.editorSheet.getBoundingClientRect();
    startLeft = (item.x / 100) * sheetRect.width;
    startTop = (item.y / 100) * sheetRect.height;

    const onMouseMove = (moveEvt) => {
      if (!isDragging) return;
      const dx = moveEvt.clientX - startX;
      const dy = moveEvt.clientY - startY;
      const newX = ((startLeft + dx) / sheetRect.width) * 100;
      const newY = ((startTop + dy) / sheetRect.height) * 100;

      item.x = Math.max(0, Math.min(100 - item.width, Math.round(newX * 10) / 10));
      item.y = Math.max(0, Math.min(100 - item.height, Math.round(newY * 10) / 10));

      element.style.left = `${item.x}%`;
      element.style.top = `${item.y}%`;
    };

    const onMouseUp = () => {
      isDragging = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (state.editor.pageId) {
        const page = state.pages.find(p => p.id === state.editor.pageId);
        if (page) {
          page.overlays = JSON.parse(JSON.stringify(state.editor.overlays));
          renderWorkspace();
          saveSessionDebounced();
        }
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

function makeResizable(element, handle, item) {
  let isResizing = false;
  let startX, startY;
  let startWidth, startHeight;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;

    const sheetRect = els.editorSheet.getBoundingClientRect();
    startWidth = (item.width / 100) * sheetRect.width;
    startHeight = (item.height / 100) * sheetRect.height;

    const onMouseMove = (moveEvt) => {
      if (!isResizing) return;
      const dx = moveEvt.clientX - startX;
      const dy = moveEvt.clientY - startY;

      const newW = ((startWidth + dx) / sheetRect.width) * 100;
      const newH = ((startHeight + dy) / sheetRect.height) * 100;

      item.width = Math.max(5, Math.min(100 - item.x, Math.round(newW * 10) / 10));
      item.height = Math.max(3, Math.min(100 - item.y, Math.round(newH * 10) / 10));

      element.style.width = `${item.width}%`;
      element.style.height = `${item.height}%`;
    };

    const onMouseUp = () => {
      isResizing = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (state.editor.pageId) {
        const page = state.pages.find(p => p.id === state.editor.pageId);
        if (page) {
          page.overlays = JSON.parse(JSON.stringify(state.editor.overlays));
          renderWorkspace();
          saveSessionDebounced();
        }
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

// PDF Export Execution
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

// Expose internal methods to window.app for desktop testing & bridge access
window.app = {
  state,
  els,
  loadDirectoryTree,
  loadFileFromPath,
  addBlankPage,
  removePage,
  rotatePage,
  openAnnotationDialog,
  closeAnnotationDialog,
  saveAnnotationDialog,
  handleExport,
  renderWorkspace,
  showToast,
  parsePageRanges,
  openRemovePagesPopover,
  closeRemovePagesPopover,
  toggleRemovePagesPopover,
  clearDeletionBlur,
  handleRemovePagesInput,
  executeRemovePages,
  movePageCardInDOM,
  updateAutoScroll,
  showFloatingDropIndicator,
  hideFloatingDropIndicator,
  handleGlobalPaste,
  insertImageOverlayFromDataUrl,
  insertImageOverlayFromFile,
  insertTextOverlayFromClipboard,
};
