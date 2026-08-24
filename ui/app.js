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

function createPageSlot(page, index) {
  const slot = document.createElement('div');
  slot.className = 'page-slot';
  return slot;
}
function renderWorkspace() {}
function showToast(msg, type='info') { console.log(msg); }
