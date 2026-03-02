// file-preview.js - File preview panel
// Renders file content based on file type: Markdown, code, images, etc.

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';

// Import specific languages to keep bundle size small
// Limited to 10 languages: go, javascript, python, bash, yaml, json, html(xml), css, sql, typescript
import javascript from 'highlight.js/lib/languages/javascript';
import go from 'highlight.js/lib/languages/go';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml'; // also handles HTML
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('go', go);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('htm', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);

// Configure marked for GFM with highlight.js
marked.setOptions({
  gfm: true,
  breaks: false,
});

/**
 * Extension sets for file type classification.
 */
const MARKDOWN_EXTS = ['.md'];

const HTML_EXTS = ['.html', '.htm'];

const CODE_EXTS = [
  '.go', '.js', '.py', '.sh', '.yaml', '.yml', '.json', '.css',
  '.sql', '.ts', '.tsx', '.jsx',
];

const PLAINTEXT_EXTS = [
  '.txt', '.log', '.csv', '.env', '.gitignore',
  '.rs', '.c', '.h', '.cpp', '.java', '.rb', '.php', '.swift', '.kt',
  '.toml', '.ini',
];

const PLAINTEXT_NAMES = ['Makefile', 'Dockerfile'];

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'];

const PDF_EXTS = ['.pdf'];

/**
 * Determine the file preview type from extension and filename.
 * @param {string} ext - File extension (e.g., '.go')
 * @param {string} name - File name (e.g., 'Makefile')
 * @returns {string} 'markdown' | 'code' | 'plaintext' | 'image' | 'pdf' | 'unknown'
 */
export function getPreviewType(ext, name) {
  const lowerExt = (ext || '').toLowerCase();

  if (MARKDOWN_EXTS.includes(lowerExt)) return 'markdown';
  if (HTML_EXTS.includes(lowerExt)) return 'html';
  if (CODE_EXTS.includes(lowerExt)) return 'code';
  if (PLAINTEXT_EXTS.includes(lowerExt)) return 'plaintext';
  if (PLAINTEXT_NAMES.includes(name)) return 'plaintext';
  if (IMAGE_EXTS.includes(lowerExt)) return 'image';
  if (PDF_EXTS.includes(lowerExt)) return 'pdf';

  return 'unknown';
}

/**
 * Check if a preview type supports editing.
 * @param {string} previewType
 * @returns {boolean}
 */
function isEditableType(previewType) {
  return previewType === 'markdown' || previewType === 'code' || previewType === 'plaintext' || previewType === 'html';
}

/**
 * Get the highlight.js language name for a given file extension.
 * @param {string} ext - File extension (e.g., '.go')
 * @returns {string} Language name for highlight.js
 */
export function getLanguageFromExt(ext) {
  const map = {
    '.go': 'go',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.sh': 'bash',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.json': 'json',
    '.css': 'css',
    '.html': 'html',
    '.htm': 'html',
    '.sql': 'sql',
    '.ts': 'typescript',
    '.tsx': 'typescript',
  };
  return map[(ext || '').toLowerCase()] || '';
}

/**
 * Format file size for display in the preview header.
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (bytes == null || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  if (i === 0) return `${bytes} B`;
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[i]}`;
}

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Escape special RegExp characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * EditHistory manages undo/redo stacks for textarea editing.
 */
class EditHistory {
  constructor() {
    this._undoStack = [];
    this._redoStack = [];
    this._lastContent = '';
    this._debounceTimer = null;
  }

  /**
   * Initialize with the starting content.
   * @param {string} content
   */
  init(content) {
    this._undoStack = [];
    this._redoStack = [];
    this._lastContent = content;
    clearTimeout(this._debounceTimer);
  }

  /**
   * Record a content change (debounced snapshot every 400ms).
   * @param {string} content
   * @param {number} cursor
   */
  record(content, cursor) {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      if (content !== this._lastContent) {
        this._undoStack.push({ content: this._lastContent, cursor });
        if (this._undoStack.length > 200) this._undoStack.shift();
        this._lastContent = content;
        this._redoStack = [];
      }
    }, 400);
  }

  /**
   * Immediately snapshot current state (e.g., before paste/cut).
   * @param {string} content
   * @param {number} cursor
   */
  snapshot(content, cursor) {
    clearTimeout(this._debounceTimer);
    if (content !== this._lastContent) {
      this._undoStack.push({ content: this._lastContent, cursor });
      if (this._undoStack.length > 200) this._undoStack.shift();
      this._lastContent = content;
      this._redoStack = [];
    }
  }

  /**
   * Flush pending debounced snapshot.
   * @param {string} content
   * @param {number} cursor
   */
  flush(content, cursor) {
    clearTimeout(this._debounceTimer);
    if (content !== this._lastContent) {
      this._undoStack.push({ content: this._lastContent, cursor });
      if (this._undoStack.length > 200) this._undoStack.shift();
      this._lastContent = content;
      this._redoStack = [];
    }
  }

  /**
   * Undo: returns previous state or null.
   * @param {string} currentContent
   * @param {number} currentCursor
   * @returns {{content: string, cursor: number}|null}
   */
  undo(currentContent, currentCursor) {
    this.flush(currentContent, currentCursor);
    if (this._undoStack.length === 0) return null;
    const prev = this._undoStack.pop();
    this._redoStack.push({ content: currentContent, cursor: currentCursor });
    this._lastContent = prev.content;
    return prev;
  }

  /**
   * Redo: returns next state or null.
   * @param {string} currentContent
   * @param {number} currentCursor
   * @returns {{content: string, cursor: number}|null}
   */
  redo(currentContent, currentCursor) {
    if (this._redoStack.length === 0) return null;
    clearTimeout(this._debounceTimer);
    const next = this._redoStack.pop();
    this._undoStack.push({ content: currentContent, cursor: currentCursor });
    this._lastContent = next.content;
    return next;
  }

  canUndo() { return this._undoStack.length > 0; }
  canRedo() { return this._redoStack.length > 0; }

  dispose() {
    clearTimeout(this._debounceTimer);
  }
}

/**
 * FilePreview renders a file preview panel within a container.
 *
 * Supports:
 * - Markdown (.md) with GFM, tables, checkboxes, code blocks highlighted
 * - Code files with syntax highlighting and line numbers
 * - Plain text files with monospace font
 * - Images displayed inline via raw API URL
 * - PDFs via iframe or download link
 * - Unknown files with "preview not available" message
 * - Edit mode for text files (markdown, code, plaintext)
 */
export class FilePreview {
  /**
   * @param {HTMLElement} container - Container element to render into
   * @param {Object} options
   * @param {string} options.session - tmux session name
   * @param {string} options.path - File path (relative)
   * @param {Object} options.entry - File entry info { name, size, extension, mod_time, ... }
   * @param {function(): void} [options.onBack] - Callback when back button is pressed
   * @param {function(string, string): string} [options.getRawURL] - Function to get raw file URL (session, path) => url
   * @param {function(string, string): Promise<Object>} [options.fetchFile] - Function to fetch file content (session, path) => Promise
   * @param {function(string, string, string): Promise<Object>} [options.saveFile] - Function to save file content (session, path, content) => Promise
   * @param {function(string): Promise<Object>} [options.getLspStatus] - Function to get LSP status (session) => Promise
   * @param {function(string, string, number, number): Promise<Object>} [options.getLspDefinition] - Function to get definition (session, file, line, col) => Promise
   * @param {function(string, string): Promise<Object>} [options.getLspDocumentSymbols] - Function to get document symbols (session, file) => Promise
   * @param {import('./navigation-stack.js').NavigationStack} [options.navStack] - Shared navigation stack
   * @param {function(string, number): void} [options.onNavigate] - Callback for cross-file navigation (file, line) => void
   */
  constructor(container, options) {
    this._container = container;
    this._session = options.session;
    this._path = options.path;
    this._entry = options.entry;
    this._onBack = options.onBack || null;
    this._getRawURL = options.getRawURL || null;
    this._fetchFile = options.fetchFile || null;
    this._saveFile = options.saveFile || null;
    this._disposed = false;

    // Edit mode state
    this._editMode = false;
    this._dirty = false;
    this._originalContent = '';
    this._isEditable = false;
    this._isTruncated = false;
    this._previewType = null;

    // DOM references for edit mode
    this._toggleEl = null;
    this._textareaEl = null;
    this._saveBarEl = null;
    this._saveBtnEl = null;
    this._saveStatusEl = null;

    // Undo/Redo history
    this._history = new EditHistory();
    this._undoBtnEl = null;
    this._redoBtnEl = null;
    this._editToolbarEl = null;

    // Search state
    this._searchBarEl = null;
    this._searchInputEl = null;
    this._replaceInputEl = null;
    this._searchQuery = '';
    /** @type {number} 最後にマッチした末尾位置（検索ボックスフォーカス中の連続検索用） */
    this._searchMatchEnd = 0;

    // LSP integration
    this._onNavigate = options.onNavigate || null;
    this._getLspStatus = options.getLspStatus || null;
    this._getLspDefinition = options.getLspDefinition || null;
    this._getLspDocumentSymbols = options.getLspDocumentSymbols || null;
    this._navStack = options.navStack || null;
    this._lspAvailable = false;
    this._symbols = [];
    this._navBackBtn = null;
    this._navForwardBtn = null;
    this._outlineBtn = null;
    this._outlinePanel = null;

    this._render();
    this._loadContent();
  }

  /**
   * Render the preview panel skeleton (header + loading state).
   */
  _render() {
    this._container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'fp';
    this._wrapper = wrapper;

    // Header
    const header = document.createElement('div');
    header.className = 'fp-header';

    const backBtn = document.createElement('button');
    backBtn.className = 'fp-back-btn';
    backBtn.textContent = '\u2190';
    backBtn.setAttribute('aria-label', 'Back to file list');
    backBtn.addEventListener('click', () => this._handleBack());
    header.appendChild(backBtn);

    const fileInfo = document.createElement('div');
    fileInfo.className = 'fp-file-info';

    const fileName = document.createElement('span');
    fileName.className = 'fp-file-name';
    fileName.textContent = this._entry.name || this._path.split('/').pop();
    fileInfo.appendChild(fileName);

    const fileSize = document.createElement('span');
    fileSize.className = 'fp-file-size';
    fileSize.textContent = formatFileSize(this._entry.size);
    fileInfo.appendChild(fileSize);

    header.appendChild(fileInfo);

    // Toggle switch placeholder (will be shown after content loads if editable)
    this._headerEl = header;

    wrapper.appendChild(header);

    // Content area
    const content = document.createElement('div');
    content.className = 'fp-content';
    this._contentEl = content;

    // Loading state
    const loading = document.createElement('div');
    loading.className = 'fp-loading';
    loading.textContent = 'Loading...';
    content.appendChild(loading);

    wrapper.appendChild(content);
    this._container.appendChild(wrapper);
  }

  /**
   * Handle back button press. Shows confirmation dialog if dirty.
   */
  _handleBack() {
    if (this._dirty) {
      this._showUnsavedDialog();
      return;
    }
    if (this._onBack) this._onBack();
  }

  /**
   * Create and append the edit toggle switch to the header.
   */
  _addEditToggle() {
    const toggle = document.createElement('label');
    toggle.className = 'fp-edit-toggle';
    toggle.setAttribute('aria-label', 'Toggle edit mode');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'fp-edit-toggle-input';
    checkbox.checked = false;
    checkbox.addEventListener('change', () => {
      this._setEditMode(checkbox.checked);
    });

    const slider = document.createElement('span');
    slider.className = 'fp-edit-toggle-slider';

    const label = document.createElement('span');
    label.className = 'fp-edit-toggle-label';
    label.textContent = 'Edit';

    toggle.appendChild(checkbox);
    toggle.appendChild(slider);
    toggle.appendChild(label);

    this._toggleEl = toggle;
    this._headerEl.appendChild(toggle);
  }

  /**
   * Switch between preview and edit mode.
   * @param {boolean} editMode
   */
  _setEditMode(editMode) {
    if (editMode === this._editMode) return;
    this._editMode = editMode;

    if (editMode) {
      this._renderEditMode();
    } else {
      // Remove edit toolbar if present
      if (this._editToolbarEl) {
        this._editToolbarEl.remove();
        this._editToolbarEl = null;
      }
      this._history.dispose();
      // Switch back to preview - re-render the content
      this._renderPreviewContent();
    }
  }

  /**
   * Render the edit mode toolbar (undo/redo + search bar) into the header.
   */
  _renderEditToolbar() {
    // Remove old toolbar if present
    if (this._editToolbarEl) {
      this._editToolbarEl.remove();
      this._editToolbarEl = null;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'fp-edit-toolbar';
    this._editToolbarEl = toolbar;

    // Undo button
    const undoBtn = document.createElement('button');
    undoBtn.className = 'fp-edit-tool-btn';
    undoBtn.title = 'Undo (Ctrl+Z)';
    undoBtn.textContent = '↩';
    undoBtn.disabled = !this._history.canUndo();
    undoBtn.addEventListener('click', () => this._handleUndo());
    this._undoBtnEl = undoBtn;
    toolbar.appendChild(undoBtn);

    // Redo button
    const redoBtn = document.createElement('button');
    redoBtn.className = 'fp-edit-tool-btn';
    redoBtn.title = 'Redo (Ctrl+Y)';
    redoBtn.textContent = '↪';
    redoBtn.disabled = !this._history.canRedo();
    redoBtn.addEventListener('click', () => this._handleRedo());
    this._redoBtnEl = redoBtn;
    toolbar.appendChild(redoBtn);

    // Separator
    const sep = document.createElement('span');
    sep.className = 'fp-edit-toolbar-sep';
    toolbar.appendChild(sep);

    // Search input
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'fp-edit-search-input';
    searchInput.placeholder = '検索...';
    searchInput.setAttribute('aria-label', '検索');
    searchInput.value = this._searchQuery;
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._searchQuery = searchInput.value;
        this._searchNext();
      }
      if (e.key === 'Escape') {
        searchInput.value = '';
        this._searchQuery = '';
        if (this._textareaEl) this._textareaEl.focus();
      }
    });
    searchInput.addEventListener('input', () => {
      this._searchQuery = searchInput.value;
      this._searchMatchEnd = 0; // クエリ変更時はマッチ位置をリセット
    });
    this._searchInputEl = searchInput;
    toolbar.appendChild(searchInput);

    // Search button
    const searchBtn = document.createElement('button');
    searchBtn.className = 'fp-edit-tool-btn';
    searchBtn.title = '次を検索';
    searchBtn.textContent = '▶';
    searchBtn.addEventListener('click', () => {
      this._searchQuery = searchInput.value;
      this._searchNext();
      searchInput.focus();
    });
    toolbar.appendChild(searchBtn);

    // Replace input
    const replaceInput = document.createElement('input');
    replaceInput.type = 'text';
    replaceInput.className = 'fp-edit-replace-input';
    replaceInput.placeholder = '置換...';
    replaceInput.setAttribute('aria-label', '置換');
    replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._handleReplace(replaceInput.value);
      }
    });
    this._replaceInputEl = replaceInput;
    toolbar.appendChild(replaceInput);

    // Replace button
    const replaceBtn = document.createElement('button');
    replaceBtn.className = 'fp-edit-tool-btn fp-edit-replace-btn';
    replaceBtn.title = '置換';
    replaceBtn.textContent = '↓';
    replaceBtn.addEventListener('click', () => this._handleReplace(replaceInput.value));
    toolbar.appendChild(replaceBtn);

    // Replace All button
    const replaceAllBtn = document.createElement('button');
    replaceAllBtn.className = 'fp-edit-tool-btn fp-edit-replace-btn';
    replaceAllBtn.title = '全て置換';
    replaceAllBtn.textContent = '↓↓';
    replaceAllBtn.addEventListener('click', () => this._handleReplaceAll(replaceInput.value));
    toolbar.appendChild(replaceAllBtn);

    // Insert after header
    this._wrapper.insertBefore(toolbar, this._contentEl);
  }

  /**
   * Render the edit mode textarea and save bar.
   */
  _renderEditMode() {
    this._contentEl.innerHTML = '';
    this._contentEl.classList.add('fp-content--edit');

    const initialContent = this._dirty
      ? (this._textareaEl ? this._textareaEl.value : this._originalContent)
      : this._originalContent;

    const textarea = document.createElement('textarea');
    textarea.className = 'fp-edit-textarea';
    textarea.value = initialContent;
    textarea.spellcheck = false;

    textarea.addEventListener('input', () => {
      const isDirty = textarea.value !== this._originalContent;
      this._dirty = isDirty;
      this._updateSaveBar();
      this._history.record(textarea.value, textarea.selectionStart);
      this._updateUndoRedoBtns();
    });

    textarea.addEventListener('paste', () => {
      // Snapshot before paste content arrives (on next tick)
      setTimeout(() => {
        this._history.snapshot(textarea.value, textarea.selectionStart);
        this._updateUndoRedoBtns();
      }, 0);
    });

    textarea.addEventListener('cut', () => {
      setTimeout(() => {
        this._history.snapshot(textarea.value, textarea.selectionStart);
        this._updateUndoRedoBtns();
      }, 0);
    });

    // Ctrl-Z / Ctrl-Y keyboard shortcuts
    textarea.addEventListener('keydown', (e) => {
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        this._handleUndo();
      } else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        this._handleRedo();
      } else if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        this._focusSearchInput();
      }
    });

    this._textareaEl = textarea;
    this._contentEl.appendChild(textarea);

    // Initialize history with current content
    this._history.init(initialContent);

    // Save bar
    const saveBar = document.createElement('div');
    saveBar.className = 'fp-edit-save-bar';

    const saveStatus = document.createElement('span');
    saveStatus.className = 'fp-edit-save-status';
    this._saveStatusEl = saveStatus;
    saveBar.appendChild(saveStatus);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'fp-edit-save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.disabled = !this._dirty;
    saveBtn.addEventListener('click', () => this._handleSave());
    this._saveBtnEl = saveBtn;
    saveBar.appendChild(saveBtn);

    this._saveBarEl = saveBar;
    this._contentEl.appendChild(saveBar);
    this._updateSaveBar();

    // Render edit toolbar (undo/redo + search)
    this._renderEditToolbar();
    this._updateUndoRedoBtns();
  }

  /**
   * Update undo/redo button states.
   */
  _updateUndoRedoBtns() {
    if (this._undoBtnEl) this._undoBtnEl.disabled = !this._history.canUndo();
    if (this._redoBtnEl) this._redoBtnEl.disabled = !this._history.canRedo();
  }

  /**
   * Handle undo action.
   */
  _handleUndo() {
    if (!this._textareaEl) return;
    const state = this._history.undo(this._textareaEl.value, this._textareaEl.selectionStart);
    if (!state) return;
    this._textareaEl.value = state.content;
    const pos = Math.min(state.cursor, state.content.length);
    this._textareaEl.setSelectionRange(pos, pos);
    this._dirty = state.content !== this._originalContent;
    this._updateSaveBar();
    this._updateUndoRedoBtns();
    this._textareaEl.focus();
  }

  /**
   * Handle redo action.
   */
  _handleRedo() {
    if (!this._textareaEl) return;
    const state = this._history.redo(this._textareaEl.value, this._textareaEl.selectionStart);
    if (!state) return;
    this._textareaEl.value = state.content;
    const pos = Math.min(state.cursor, state.content.length);
    this._textareaEl.setSelectionRange(pos, pos);
    this._dirty = state.content !== this._originalContent;
    this._updateSaveBar();
    this._updateUndoRedoBtns();
    this._textareaEl.focus();
  }

  /**
   * Focus the search input field.
   */
  _focusSearchInput() {
    if (this._searchInputEl) {
      this._searchInputEl.focus();
      this._searchInputEl.select();
    }
  }

  /**
   * Search next match from current cursor position (wrap-around).
   * 検索ボックスがフォーカス中の場合はフォーカスを奪わず、連続Enter検索を維持する。
   */
  _searchNext() {
    if (!this._searchQuery || !this._textareaEl) return;

    const text = this._textareaEl.value;
    const queryLower = this._searchQuery.toLowerCase();
    const textLower = text.toLowerCase();

    // 検索ボックスがフォーカス中なら _searchMatchEnd から、そうでなければカーソル位置から検索
    const searchFromSearchBox = document.activeElement === this._searchInputEl;
    const cursor = searchFromSearchBox
      ? this._searchMatchEnd
      : this._textareaEl.selectionEnd;

    // Search from cursor to end
    let idx = textLower.indexOf(queryLower, cursor);

    if (idx === -1) {
      // Wrap: search from beginning up to (but not including) cursor
      const wrapIdx = textLower.indexOf(queryLower, 0);
      if (wrapIdx === -1 || wrapIdx >= cursor) {
        // Not found anywhere (or only at/after cursor)
        return;
      }
      idx = wrapIdx;
    }

    // マッチ末尾を記録（次回の連続検索のスタート地点）
    this._searchMatchEnd = idx + this._searchQuery.length;

    this._textareaEl.setSelectionRange(idx, idx + this._searchQuery.length);
    this._scrollTextareaToSelection();

    // 検索ボックスがフォーカス中でない場合だけ textarea にフォーカスを移す
    if (!searchFromSearchBox) {
      this._textareaEl.focus();
    }
  }

  /**
   * Scroll textarea so the current selection is visible.
   */
  _scrollTextareaToSelection() {
    const ta = this._textareaEl;
    if (!ta) return;
    const text = ta.value.substring(0, ta.selectionStart);
    const lines = text.split('\n');
    const style = getComputedStyle(ta);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const targetScroll = (lines.length - 1) * lineHeight + paddingTop - ta.clientHeight / 2;
    ta.scrollTop = Math.max(0, targetScroll);
  }

  /**
   * Replace the currently selected text (if it matches search query) with replace string.
   * Then jump to next match.
   * @param {string} replaceStr
   */
  _handleReplace(replaceStr) {
    if (!this._searchQuery || !this._textareaEl) return;

    const ta = this._textareaEl;
    const selected = ta.value.substring(ta.selectionStart, ta.selectionEnd);

    if (selected.toLowerCase() === this._searchQuery.toLowerCase()) {
      // Snapshot before modification
      this._history.snapshot(ta.value, ta.selectionStart);

      const start = ta.selectionStart;
      const before = ta.value.substring(0, start);
      const after = ta.value.substring(ta.selectionEnd);
      ta.value = before + replaceStr + after;
      ta.setSelectionRange(start + replaceStr.length, start + replaceStr.length);

      this._dirty = ta.value !== this._originalContent;
      this._updateSaveBar();
      this._history.record(ta.value, ta.selectionStart);
      this._updateUndoRedoBtns();
    }

    // Jump to next match
    this._searchNext();
  }

  /**
   * Replace all occurrences of search query with replace string.
   * @param {string} replaceStr
   */
  _handleReplaceAll(replaceStr) {
    if (!this._searchQuery || !this._textareaEl) return;

    const ta = this._textareaEl;
    this._history.snapshot(ta.value, ta.selectionStart);

    const regex = new RegExp(escapeRegExp(this._searchQuery), 'gi');
    const newValue = ta.value.replace(regex, replaceStr);
    if (newValue === ta.value) return;

    ta.value = newValue;
    this._dirty = ta.value !== this._originalContent;
    this._updateSaveBar();
    this._history.record(ta.value, ta.selectionStart);
    this._updateUndoRedoBtns();
  }

  /**
   * Re-render the preview content from original (or saved) content.
   */
  _renderPreviewContent() {
    this._contentEl.classList.remove('fp-content--edit');
    const ext = (this._entry.extension || '').toLowerCase();

    if (this._previewType === 'markdown') {
      this._renderMarkdown(this._originalContent, this._isTruncated);
    } else if (this._previewType === 'html') {
      this._renderHTML();
    } else if (this._previewType === 'code') {
      this._renderCode(this._originalContent, ext, this._isTruncated);
    } else {
      this._renderPlaintext(this._originalContent, this._isTruncated);
    }
  }

  /**
   * Update the save bar state.
   */
  _updateSaveBar() {
    if (!this._saveBtnEl) return;
    this._saveBtnEl.disabled = !this._dirty;
    if (this._saveStatusEl) {
      this._saveStatusEl.textContent = this._dirty ? 'Unsaved changes' : '';
    }
  }

  /**
   * Handle the save button click.
   */
  async _handleSave() {
    if (!this._saveFile || !this._textareaEl) return;

    const content = this._textareaEl.value;
    this._saveBtnEl.disabled = true;
    this._saveBtnEl.textContent = 'Saving...';
    if (this._saveStatusEl) {
      this._saveStatusEl.textContent = '';
    }

    try {
      await this._saveFile(this._session, this._path, content);
      this._originalContent = content;
      this._dirty = false;
      this._saveBtnEl.textContent = 'Save';
      this._updateSaveBar();
      if (this._saveStatusEl) {
        this._saveStatusEl.textContent = 'Saved';
        this._saveStatusEl.classList.add('fp-edit-save-status--success');
        setTimeout(() => {
          if (this._saveStatusEl) {
            this._saveStatusEl.textContent = '';
            this._saveStatusEl.classList.remove('fp-edit-save-status--success');
          }
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to save file:', err);
      this._saveBtnEl.textContent = 'Save';
      this._saveBtnEl.disabled = false;
      if (this._saveStatusEl) {
        this._saveStatusEl.textContent = `Save failed: ${err.message}`;
        this._saveStatusEl.classList.add('fp-edit-save-status--error');
        setTimeout(() => {
          if (this._saveStatusEl) {
            this._saveStatusEl.classList.remove('fp-edit-save-status--error');
          }
        }, 3000);
      }
    }
  }

  /**
   * Show the unsaved changes confirmation dialog.
   */
  _showUnsavedDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'fp-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'fp-dialog';

    const msg = document.createElement('div');
    msg.className = 'fp-dialog-msg';
    msg.textContent = 'You have unsaved changes. What would you like to do?';
    dialog.appendChild(msg);

    const buttons = document.createElement('div');
    buttons.className = 'fp-dialog-buttons';

    const discardBtn = document.createElement('button');
    discardBtn.className = 'fp-dialog-btn fp-dialog-btn--discard';
    discardBtn.textContent = 'Discard';
    discardBtn.addEventListener('click', () => {
      overlay.remove();
      this._dirty = false;
      if (this._onBack) this._onBack();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'fp-dialog-btn fp-dialog-btn--cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      overlay.remove();
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'fp-dialog-btn fp-dialog-btn--save';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      if (!this._saveFile || !this._textareaEl) {
        overlay.remove();
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        await this._saveFile(this._session, this._path, this._textareaEl.value);
        this._dirty = false;
        overlay.remove();
        if (this._onBack) this._onBack();
      } catch (err) {
        console.error('Failed to save before navigating:', err);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        msg.textContent = `Save failed: ${err.message}. Discard changes or try again.`;
      }
    });

    buttons.appendChild(discardBtn);
    buttons.appendChild(cancelBtn);
    buttons.appendChild(saveBtn);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);

    this._wrapper.appendChild(overlay);
  }

  /**
   * Load and display the file content.
   */
  async _loadContent() {
    const ext = (this._entry.extension || '').toLowerCase();
    const name = this._entry.name || '';
    const previewType = getPreviewType(ext, name);
    this._previewType = previewType;

    try {
      switch (previewType) {
        case 'image':
          this._renderImage();
          break;
        case 'pdf':
          this._renderPDF();
          break;
        case 'html': {
          // Fetch content for edit mode, then render via iframe
          if (this._fetchFile) {
            const data = await this._fetchFileContent();
            if (this._disposed) return;
            if (data) {
              this._originalContent = data.content || '';
              this._isTruncated = !!data.truncated;
              this._isEditable = !data.truncated && !!this._saveFile;
            }
          }
          this._renderHTML();
          if (this._isEditable) {
            this._addEditToggle();
          }
          break;
        }
        case 'markdown':
        case 'code':
        case 'plaintext': {
          const data = await this._fetchFileContent();
          if (this._disposed) return;
          if (!data) {
            this._renderError('Failed to load file content');
            return;
          }

          // Store content for edit mode
          this._originalContent = data.content || '';
          this._isTruncated = !!data.truncated;
          this._isEditable = isEditableType(previewType) && !data.truncated && !!this._saveFile;

          if (previewType === 'markdown') {
            this._renderMarkdown(data.content || '', data.truncated);
          } else if (previewType === 'code') {
            this._renderCode(data.content || '', ext, data.truncated);
          } else {
            this._renderPlaintext(data.content || '', data.truncated);
          }

          // Add edit toggle if editable
          if (this._isEditable) {
            this._addEditToggle();
          }

          // Initialize LSP for code and plaintext files
          if (previewType === 'code' || previewType === 'plaintext') {
            this._initLsp();
          }
          break;
        }
        default: {
          // 拡張子で不明なファイルでも、バックエンドで text と判定されたものはテキスト表示
          let renderedAsText = false;
          if (this._fetchFile) {
            try {
              const data = await this._fetchFileContent();
              if (!this._disposed && data && data.content_type === 'text') {
                this._originalContent = data.content || '';
                this._isTruncated = !!data.truncated;
                this._isEditable = !data.truncated && !!this._saveFile;
                this._previewType = 'plaintext';
                this._renderPlaintext(data.content || '', data.truncated);
                if (this._isEditable) {
                  this._addEditToggle();
                }
                renderedAsText = true;
              }
            } catch (_) {
              // fall through to unknown
            }
          }
          if (!renderedAsText && !this._disposed) {
            this._renderUnknown();
          }
          break;
        }
      }
    } catch (err) {
      if (this._disposed) return;
      console.error('Failed to load file preview:', err);
      this._renderError(`Failed to load: ${err.message}`);
    }
  }

  /**
   * Fetch file content via the API.
   * @returns {Promise<Object|null>}
   */
  async _fetchFileContent() {
    if (!this._fetchFile) return null;
    return this._fetchFile(this._session, this._path);
  }

  /**
   * Render markdown content.
   * @param {string} content - Raw markdown content
   * @param {boolean} truncated - Whether the content was truncated
   */
  _renderMarkdown(content, truncated) {
    this._contentEl.innerHTML = '';

    const mdContainer = document.createElement('div');
    mdContainer.className = 'fp-markdown';

    // Transform relative image paths to raw API URLs
    let processedContent = content;
    if (this._getRawURL) {
      const getRawURL = this._getRawURL;
      const session = this._session;
      const dirPath = this._path.includes('/')
        ? this._path.substring(0, this._path.lastIndexOf('/'))
        : '';

      // Replace relative image paths: ![alt](./path) or ![alt](path)
      processedContent = processedContent.replace(
        /!\[([^\]]*)\]\((?!https?:\/\/|data:)([^)]+)\)/g,
        (match, alt, imgPath) => {
          // Resolve relative path
          let resolvedPath = imgPath;
          if (imgPath.startsWith('./')) {
            resolvedPath = imgPath.substring(2);
          }
          if (dirPath && !imgPath.startsWith('/')) {
            resolvedPath = dirPath + '/' + resolvedPath;
          }
          // Normalize path segments (resolve .. and .)
          resolvedPath = resolvedPath.split('/').reduce((parts, segment) => {
            if (segment === '..') parts.pop();
            else if (segment !== '.' && segment !== '') parts.push(segment);
            return parts;
          }, []).join('/');
          const url = getRawURL(session, resolvedPath);
          return `![${alt}](${url})`;
        }
      );
    }

    // Configure marked renderer with highlight.js for code blocks
    const renderer = new marked.Renderer();

    const rawHTML = marked.parse(processedContent, {
      gfm: true,
      breaks: false,
      renderer: renderer,
    });
    mdContainer.innerHTML = DOMPurify.sanitize(rawHTML, { ADD_ATTR: ['class'] });

    // Apply syntax highlighting to all code blocks after rendering
    const codeBlocks = mdContainer.querySelectorAll('pre code');
    for (const block of codeBlocks) {
      hljs.highlightElement(block);
    }

    this._contentEl.appendChild(mdContainer);

    if (truncated) {
      this._contentEl.appendChild(this._createTruncatedNotice());
    }
  }

  /**
   * Render code with syntax highlighting and line numbers.
   * @param {string} content - Raw code content
   * @param {string} ext - File extension
   * @param {boolean} truncated - Whether the content was truncated
   */
  _renderCode(content, ext, truncated) {
    this._contentEl.innerHTML = '';

    const codeContainer = document.createElement('div');
    codeContainer.className = 'fp-code';

    const lang = getLanguageFromExt(ext);
    let highlightedCode;
    try {
      if (lang && hljs.getLanguage(lang)) {
        highlightedCode = hljs.highlight(content, { language: lang }).value;
      } else {
        highlightedCode = hljs.highlightAuto(content).value;
      }
    } catch (_) {
      highlightedCode = escapeHTML(content);
    }

    // Split into lines and add line numbers
    const lines = highlightedCode.split('\n');
    // Remove trailing empty line if present (common in files)
    if (lines.length > 1 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    const table = document.createElement('table');
    table.className = 'fp-code-table';

    const tbody = document.createElement('tbody');

    for (let i = 0; i < lines.length; i++) {
      const tr = document.createElement('tr');

      const lineNumTd = document.createElement('td');
      lineNumTd.className = 'fp-code-linenum';
      lineNumTd.textContent = i + 1;
      lineNumTd.setAttribute('data-line', i + 1);

      const codeTd = document.createElement('td');
      codeTd.className = 'fp-code-line';
      codeTd.innerHTML = lines[i] || ' '; // Ensure empty lines have content

      tr.appendChild(lineNumTd);
      tr.appendChild(codeTd);
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    codeContainer.appendChild(table);
    this._contentEl.appendChild(codeContainer);

    if (truncated) {
      this._contentEl.appendChild(this._createTruncatedNotice());
    }
  }

  /**
   * Render plain text content.
   * @param {string} content - Raw text content
   * @param {boolean} truncated - Whether the content was truncated
   */
  _renderPlaintext(content, truncated) {
    this._contentEl.innerHTML = '';

    const pre = document.createElement('pre');
    pre.className = 'fp-plaintext';
    pre.textContent = content;

    this._contentEl.appendChild(pre);

    if (truncated) {
      this._contentEl.appendChild(this._createTruncatedNotice());
    }
  }

  /**
   * Render image preview using the raw API URL.
   */
  _renderImage() {
    this._contentEl.innerHTML = '';

    const imgContainer = document.createElement('div');
    imgContainer.className = 'fp-image';

    const img = document.createElement('img');
    img.className = 'fp-image-el';
    img.alt = this._entry.name || 'Image';

    if (this._getRawURL) {
      img.src = this._getRawURL(this._session, this._path);
    }

    img.addEventListener('error', () => {
      imgContainer.innerHTML = '';
      const errMsg = document.createElement('div');
      errMsg.className = 'fp-error';
      errMsg.textContent = 'Failed to load image';
      imgContainer.appendChild(errMsg);
    });

    imgContainer.appendChild(img);
    this._contentEl.appendChild(imgContainer);
  }

  /**
   * Render PDF preview via iframe or download link.
   */
  _renderPDF() {
    this._contentEl.innerHTML = '';

    const pdfContainer = document.createElement('div');
    pdfContainer.className = 'fp-pdf';

    if (this._getRawURL) {
      const url = this._getRawURL(this._session, this._path);

      const iframe = document.createElement('iframe');
      iframe.className = 'fp-pdf-iframe';
      iframe.src = url;
      iframe.setAttribute('frameborder', '0');
      pdfContainer.appendChild(iframe);

      // Also show a download link as fallback
      const downloadLink = document.createElement('a');
      downloadLink.className = 'fp-pdf-download';
      downloadLink.href = url;
      downloadLink.download = this._entry.name || 'file.pdf';
      downloadLink.textContent = 'Download PDF';
      downloadLink.target = '_blank';
      downloadLink.rel = 'noopener noreferrer';
      pdfContainer.appendChild(downloadLink);
    } else {
      const msg = document.createElement('div');
      msg.className = 'fp-unknown-msg';
      msg.textContent = 'PDF preview not available';
      pdfContainer.appendChild(msg);
    }

    this._contentEl.appendChild(pdfContainer);
  }

  /**
   * Render HTML file via iframe using the raw file URL.
   */
  _renderHTML() {
    this._contentEl.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'fp-html';

    if (this._getRawURL) {
      const iframe = document.createElement('iframe');
      iframe.className = 'fp-html-iframe';
      iframe.src = this._getRawURL(this._session, this._path);
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute('title', this._entry.name || 'HTML preview');
      container.appendChild(iframe);
    } else {
      const msg = document.createElement('div');
      msg.className = 'fp-unknown-msg';
      msg.textContent = 'HTML preview not available';
      container.appendChild(msg);
    }

    this._contentEl.appendChild(container);
  }

  /**
   * Render "preview not available" message with file info.
   */
  _renderUnknown() {
    this._contentEl.innerHTML = '';

    const unknownContainer = document.createElement('div');
    unknownContainer.className = 'fp-unknown';

    const msg = document.createElement('div');
    msg.className = 'fp-unknown-msg';
    msg.textContent = 'Preview not available for this file type';
    unknownContainer.appendChild(msg);

    const info = document.createElement('div');
    info.className = 'fp-unknown-info';

    const sizeInfo = document.createElement('div');
    sizeInfo.textContent = `Size: ${formatFileSize(this._entry.size)}`;
    info.appendChild(sizeInfo);

    if (this._entry.extension) {
      const extInfo = document.createElement('div');
      extInfo.textContent = `Extension: ${this._entry.extension}`;
      info.appendChild(extInfo);
    }

    if (this._entry.mod_time) {
      const dateInfo = document.createElement('div');
      const d = new Date(this._entry.mod_time);
      dateInfo.textContent = `Modified: ${d.toLocaleString()}`;
      info.appendChild(dateInfo);
    }

    unknownContainer.appendChild(info);

    // Download link if raw URL is available
    if (this._getRawURL) {
      const url = this._getRawURL(this._session, this._path);
      const downloadLink = document.createElement('a');
      downloadLink.className = 'fp-download-link';
      downloadLink.href = url;
      downloadLink.download = this._entry.name || 'file';
      downloadLink.textContent = 'Download file';
      downloadLink.target = '_blank';
      downloadLink.rel = 'noopener noreferrer';
      unknownContainer.appendChild(downloadLink);
    }

    this._contentEl.appendChild(unknownContainer);
  }

  /**
   * Render an error message.
   * @param {string} message
   */
  _renderError(message) {
    this._contentEl.innerHTML = '';

    const error = document.createElement('div');
    error.className = 'fp-error';
    error.textContent = message;
    this._contentEl.appendChild(error);
  }

  /**
   * Create a truncated file notice element.
   * @returns {HTMLElement}
   */
  _createTruncatedNotice() {
    const notice = document.createElement('div');
    notice.className = 'fp-truncated';
    notice.textContent = 'File is large. Only partial content is shown.';
    return notice;
  }

  // --- LSP Integration Methods ---

  /**
   * Initialize LSP: check availability, fetch symbols, and apply links.
   */
  async _initLsp() {
    if (!this._getLspStatus || !this._getLspDocumentSymbols) return;

    try {
      const status = await this._getLspStatus(this._session);
      if (this._disposed || !status || !status.available) return;
      this._lspAvailable = true;

      const result = await this._getLspDocumentSymbols(this._session, this._path);
      if (this._disposed || !result || !result.symbols) return;
      this._symbols = result.symbols;

      // Add outline button to header
      this._addOutlineButton();

      // Add navigation buttons if navStack provided
      if (this._navStack) {
        this._addNavigationButtons();
      }

      // Apply symbol links to code
      this._applySymbolLinks();
    } catch (err) {
      console.error('LSP init failed:', err);
    }
  }

  /**
   * Make symbols clickable in the code table.
   * Searches ALL lines for occurrences of known symbol names,
   * not just the definition lines. This enables clicking on
   * function calls to jump to their definitions.
   */
  _applySymbolLinks() {
    if (!this._symbols.length || !this._contentEl) return;

    const rows = this._contentEl.querySelectorAll('.fp-code-table tbody tr');
    if (!rows.length) return;

    // Collect all symbol names (skip very short names to avoid false positives)
    const symbolNames = new Set();
    this._collectSymbolNames(this._symbols, symbolNames);
    if (symbolNames.size === 0) return;

    // Build regex matching any symbol name (longest first to avoid partial matches)
    const sortedNames = Array.from(symbolNames).sort((a, b) => b.length - a.length);
    const pattern = new RegExp('\\b(' + sortedNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b');

    // Get source lines for column calculation
    const sourceLines = this._originalContent.split('\n');

    // Process each line
    for (let i = 0; i < rows.length; i++) {
      const codeTd = rows[i].querySelector('.fp-code-line');
      if (!codeTd) continue;

      const lineNum = i + 1; // 1-based
      const sourceLine = sourceLines[i] || '';

      this._wrapSymbolsInLine(codeTd, pattern, lineNum, sourceLine);
    }
  }

  /**
   * Recursively collect symbol names from document symbols.
   * Skips names shorter than 2 characters to avoid false positives.
   * @param {Array} symbols
   * @param {Set} names
   */
  _collectSymbolNames(symbols, names) {
    for (const sym of symbols) {
      if (sym.name && sym.name.length >= 2) {
        names.add(sym.name);
      }
      if (sym.children) {
        this._collectSymbolNames(sym.children, names);
      }
    }
  }

  /**
   * Wrap all symbol name occurrences in a code line with clickable spans.
   * @param {HTMLElement} codeTd - The code cell element
   * @param {RegExp} pattern - Regex matching any known symbol name
   * @param {number} lineNum - 1-based line number
   * @param {string} sourceLine - Raw source text of this line
   */
  _wrapSymbolsInLine(codeTd, pattern, lineNum, sourceLine) {
    const walker = document.createTreeWalker(codeTd, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent;
      const match = pattern.exec(text);
      if (!match) continue;

      const symName = match[1];
      const idx = match.index;

      // Calculate the 1-based column from the source line
      const col = sourceLine.indexOf(symName) + 1;

      const before = text.substring(0, idx);
      const after = text.substring(idx + symName.length);
      const parent = textNode.parentNode;

      if (before) {
        parent.insertBefore(document.createTextNode(before), textNode);
      }

      const link = document.createElement('span');
      link.className = 'fp-symbol-link';
      link.textContent = symName;
      link.title = symName;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._handleSymbolClick(symName, lineNum, col > 0 ? col : 1);
      });
      parent.insertBefore(link, textNode);

      if (after) {
        parent.insertBefore(document.createTextNode(after), textNode);
      }

      parent.removeChild(textNode);
      // Reset regex lastIndex (since we modified the DOM)
      pattern.lastIndex = 0;
    }
  }

  /**
   * Handle a symbol click: call LSP definition with the actual click position.
   * @param {string} name - Symbol name
   * @param {number} line - 1-based line number of the click
   * @param {number} col - 1-based column number of the click
   */
  async _handleSymbolClick(name, line, col) {
    if (!this._getLspDefinition) return;

    try {
      const result = await this._getLspDefinition(this._session, this._path, line, col);
      if (!result || !result.locations || result.locations.length === 0) return;

      const loc = result.locations[0];

      // Skip if definition is the same position (clicking on the definition itself)
      if (loc.file === this._path && loc.line === line) return;

      // Push current position to nav stack
      if (this._navStack) {
        this._navStack.push({ file: this._path, line: line, session: this._session });
      }

      if (loc.file === this._path) {
        // Same file: scroll to the definition line
        this._scrollToLine(loc.line);
      } else {
        // Different file: navigate
        if (this._onNavigate) {
          this._onNavigate(loc.file, loc.line);
        }
      }

      this._updateNavigationButtons();
    } catch (err) {
      console.error('Definition jump failed:', err);
    }
  }

  /**
   * Scroll to and highlight a specific line number.
   * @param {number} lineNum - 1-based line number
   */
  _scrollToLine(lineNum) {
    const rows = this._contentEl.querySelectorAll('.fp-code-table tbody tr');
    const row = rows[lineNum - 1]; // 1-based to 0-based
    if (!row) return;

    // Remove previous highlights
    this._contentEl.querySelectorAll('.fp-code-highlight').forEach(el =>
      el.classList.remove('fp-code-highlight')
    );
    row.classList.add('fp-code-highlight');

    // Scroll into view
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /**
   * Public method to scroll to a line (used by FileBrowser after navigation).
   * @param {number} lineNum - 1-based line number
   */
  scrollToLine(lineNum) {
    this._scrollToLine(lineNum);
  }

  /**
   * Add navigation (back/forward) buttons to the header.
   */
  _addNavigationButtons() {
    const navContainer = document.createElement('div');
    navContainer.className = 'fp-nav-buttons';

    const backBtn = document.createElement('button');
    backBtn.className = 'fp-nav-btn';
    backBtn.textContent = '\u2190'; // left arrow
    backBtn.title = 'Go back';
    backBtn.disabled = !this._navStack.canGoBack();
    backBtn.addEventListener('click', () => this._navigateBack());
    this._navBackBtn = backBtn;

    const forwardBtn = document.createElement('button');
    forwardBtn.className = 'fp-nav-btn';
    forwardBtn.textContent = '\u2192'; // right arrow
    forwardBtn.title = 'Go forward';
    forwardBtn.disabled = !this._navStack.canGoForward();
    forwardBtn.addEventListener('click', () => this._navigateForward());
    this._navForwardBtn = forwardBtn;

    navContainer.appendChild(backBtn);
    navContainer.appendChild(forwardBtn);

    // Insert after back button in header
    const backBtnEl = this._headerEl.querySelector('.fp-back-btn');
    if (backBtnEl && backBtnEl.nextSibling) {
      this._headerEl.insertBefore(navContainer, backBtnEl.nextSibling);
    } else {
      this._headerEl.appendChild(navContainer);
    }
  }

  /**
   * Navigate back in the navigation stack.
   */
  _navigateBack() {
    if (!this._navStack || !this._navStack.canGoBack()) return;
    const loc = this._navStack.back();
    if (!loc) return;

    if (loc.file === this._path) {
      this._scrollToLine(loc.line);
    } else if (this._onNavigate) {
      this._onNavigate(loc.file, loc.line);
    }
    this._updateNavigationButtons();
  }

  /**
   * Navigate forward in the navigation stack.
   */
  _navigateForward() {
    if (!this._navStack || !this._navStack.canGoForward()) return;
    const loc = this._navStack.forward();
    if (!loc) return;

    if (loc.file === this._path) {
      this._scrollToLine(loc.line);
    } else if (this._onNavigate) {
      this._onNavigate(loc.file, loc.line);
    }
    this._updateNavigationButtons();
  }

  /**
   * Update the disabled state of navigation buttons.
   */
  _updateNavigationButtons() {
    if (this._navBackBtn) {
      this._navBackBtn.disabled = !this._navStack || !this._navStack.canGoBack();
    }
    if (this._navForwardBtn) {
      this._navForwardBtn.disabled = !this._navStack || !this._navStack.canGoForward();
    }
  }

  /**
   * Add the outline toggle button to the header.
   */
  _addOutlineButton() {
    if (!this._symbols.length) return;

    const btn = document.createElement('button');
    btn.className = 'fp-outline-btn';
    btn.textContent = '\u2261'; // triple horizontal bar
    btn.title = 'Show outline';
    btn.addEventListener('click', () => this._toggleOutline());
    this._outlineBtn = btn;
    this._headerEl.appendChild(btn);
  }

  /**
   * Toggle the outline panel visibility.
   */
  _toggleOutline() {
    if (this._outlinePanel) {
      this._outlinePanel.remove();
      this._outlinePanel = null;
      return;
    }

    const panel = document.createElement('div');
    panel.className = 'fp-outline-panel';

    const title = document.createElement('div');
    title.className = 'fp-outline-title';
    title.textContent = 'Outline';
    panel.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'fp-outline-list';

    this._renderOutlineItems(list, this._symbols, 0);

    panel.appendChild(list);
    this._outlinePanel = panel;

    // Insert after header, before content
    this._wrapper.insertBefore(panel, this._contentEl);
  }

  /**
   * Render outline items recursively.
   * @param {HTMLElement} list
   * @param {Array} symbols
   * @param {number} depth
   */
  _renderOutlineItems(list, symbols, depth) {
    for (const sym of symbols) {
      const li = document.createElement('li');
      li.className = 'fp-outline-item';
      li.style.paddingLeft = `${depth * 12 + 8}px`;

      const kindIcon = this._getSymbolIcon(sym.kind);

      const btn = document.createElement('button');
      btn.className = 'fp-outline-item-btn';
      btn.innerHTML = `<span class="fp-outline-icon">${kindIcon}</span><span class="fp-outline-name">${escapeHTML(sym.name)}</span><span class="fp-outline-kind">${sym.kind}</span>`;
      btn.addEventListener('click', () => {
        this._scrollToLine(sym.line);
        // Close outline on mobile
        if (window.innerWidth < 768 && this._outlinePanel) {
          this._outlinePanel.remove();
          this._outlinePanel = null;
        }
      });

      li.appendChild(btn);
      list.appendChild(li);

      if (sym.children && sym.children.length > 0) {
        this._renderOutlineItems(list, sym.children, depth + 1);
      }
    }
  }

  /**
   * Get a short icon character for a symbol kind.
   * @param {string} kind
   * @returns {string}
   */
  _getSymbolIcon(kind) {
    switch (kind) {
      case 'function': case 'method': return 'f';
      case 'class': case 'struct': return 'S';
      case 'interface': return 'I';
      case 'variable': case 'field': return 'v';
      case 'constant': return 'c';
      case 'package': case 'module': return 'P';
      case 'enum': return 'E';
      case 'property': return 'p';
      default: return '\u00B7'; // middle dot
    }
  }

  /**
   * Dispose of the preview and clean up.
   */
  dispose() {
    this._disposed = true;
    this._history.dispose();
    this._container.innerHTML = '';
    this._wrapper = null;
    this._contentEl = null;
    this._headerEl = null;
    this._toggleEl = null;
    this._textareaEl = null;
    this._saveBarEl = null;
    this._saveBtnEl = null;
    this._saveStatusEl = null;
    this._editToolbarEl = null;
    this._undoBtnEl = null;
    this._redoBtnEl = null;
    this._searchInputEl = null;
    this._replaceInputEl = null;
    // LSP cleanup
    this._navBackBtn = null;
    this._navForwardBtn = null;
    this._outlineBtn = null;
    if (this._outlinePanel) {
      this._outlinePanel.remove();
      this._outlinePanel = null;
    }
    this._symbols = [];
  }
}
