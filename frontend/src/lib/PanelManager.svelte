<script>
  /**
   * PanelManager.svelte - パネルのライフサイクル・レイアウト・フォーカスを管理する (Svelte 5)
   */

  import { onDestroy } from 'svelte';
  import { PanelAdapter as Panel } from './PanelAdapter.js';

  let {
    container = $bindable(null),
    globalUIState = {},
    isMobileDevice = () => false,
    onClientStatus = null,
    onNotificationUpdate = null,
    onConnectionStateChange = null,
    onFocusChange = null,
    onFileBrowserNavigate = null,
    onFileBrowserPreview = null,
    onFileBrowserPreviewClose = null,
    onGitBrowserNavigate = null,
  } = $props();

  /** @type {Panel} */
  let _leftPanel = $state(null);
  /** @type {Panel|null} */
  let _rightPanel = $state(null);
  /** @type {Panel} */
  let _focusedPanel = $state(null);
  let _splitMode = $state(false);
  let _dividerPosition = $state(_loadDividerPosition() || 50);
  let _dividerEl = $state(null);

  let _resizeHandler = null;
  let _keyHandler = null;
  let _visibilityHandler = null;

  function _createPanel(id) {
    const panel = new Panel({
      id,
      globalUIState,
      isMobileDevice,
      onFocusRequest: (p) => setFocus(p),
      onClientStatus: onClientStatus || null,
      onNotificationUpdate: onNotificationUpdate || null,
      onConnectionStateChange: onConnectionStateChange || null,
      onFileBrowserNavigate: onFileBrowserNavigate || null,
      onFileBrowserPreview: onFileBrowserPreview || null,
      onFileBrowserPreviewClose: onFileBrowserPreviewClose || null,
      onGitBrowserNavigate: onGitBrowserNavigate || null,
    });
    return panel;
  }

  export function init() {
    if (!container) return;

    _leftPanel = _createPanel('left');
    container.appendChild(_leftPanel.getElement());
    _focusedPanel = _leftPanel;
    _leftPanel.setFocused(true);

    _resizeHandler = () => _handleWindowResize();
    window.addEventListener('resize', _resizeHandler);

    _keyHandler = (e) => _handleKeyboardShortcut(e);
    document.addEventListener('keydown', _keyHandler);

    _visibilityHandler = () => {
      if (document.visibilityState !== 'visible') return;
      const terminal = _focusedPanel?.getTerminal();
      if (terminal) terminal.focus();
    };
    document.addEventListener('visibilitychange', _visibilityHandler);

    if (_loadSplitMode() && window.innerWidth >= 900) {
      toggleSplit();
    }
  }

  export function getIsSplit() {
    return _splitMode;
  }

  export function getFocusedPanel() {
    return _focusedPanel;
  }

  export function getLeftPanel() {
    return _leftPanel;
  }

  export function getRightPanel() {
    return _rightPanel;
  }

  export function toggleSplit(opts = {}) {
    if (_splitMode) {
      _unsplit();
    } else {
      _split(opts);
    }
    _saveSplitMode();
  }

  function _split({ skipAutoConnect = false } = {}) {
    if (_splitMode) return;
    _splitMode = true;

    _leftPanel.getElement().classList.remove('panel--single');
    _leftPanel.getElement().classList.add('panel--left');
    _leftPanel.setHeaderVisible(true);

    _dividerEl = document.createElement('div');
    _dividerEl.className = 'split-divider';
    container.appendChild(_dividerEl);
    _setupDividerDrag();

    _rightPanel = _createPanel('right');
    _rightPanel.getElement().classList.remove('panel--single');
    _rightPanel.getElement().classList.add('panel--right');
    _rightPanel.setHeaderVisible(true);
    container.appendChild(_rightPanel.getElement());

    _applyDividerPosition();

    _rightPanel.setFocused(false);
    _leftPanel.setFocused(true);
    _focusedPanel = _leftPanel;

    if (!skipAutoConnect && _leftPanel.isConnected) {
      _rightPanel.connectToWindow(_leftPanel.session, _leftPanel.windowIndex);
    }

    _handleWindowResize();

    requestAnimationFrame(() => {
      _leftPanel.fit();
      if (_rightPanel) _rightPanel.fit();
    });

    if (onFocusChange) onFocusChange(_focusedPanel);
  }

  function _unsplit() {
    if (!_splitMode) return;
    _splitMode = false;

    if (_dividerEl) {
      _dividerEl.remove();
      _dividerEl = null;
    }

    const keepPanel = _focusedPanel;

    if (keepPanel === _rightPanel) {
      _leftPanel.cleanup();
      _leftPanel.getElement().remove();
      _leftPanel = _rightPanel;
    } else {
      if (_rightPanel) {
        _rightPanel.cleanup();
        _rightPanel.getElement().remove();
      }
    }

    _rightPanel = null;
    _focusedPanel = _leftPanel;

    _leftPanel.getElement().classList.remove('panel--left', 'panel--right', 'panel--collapsed');
    _leftPanel.getElement().classList.add('panel--single');
    _leftPanel.getElement().style.width = '';
    _leftPanel.setHeaderVisible(false);
    _leftPanel.setFocused(true);

    requestAnimationFrame(() => _leftPanel.fit());

    if (onFocusChange) onFocusChange(_focusedPanel);
  }

  export function switchFocus() {
    if (!_splitMode || !_rightPanel) return;
    const next = _focusedPanel === _leftPanel ? _rightPanel : _leftPanel;
    setFocus(next);
  }

  export function setFocus(panel) {
    if (_focusedPanel === panel) return;

    if (_focusedPanel) _focusedPanel.setFocused(false);
    _focusedPanel = panel;
    panel.setFocused(true);

    if (onFocusChange) onFocusChange(panel);
  }

  export function switchTab(tabKey) {
    _focusedPanel.switchToTab(tabKey);
  }

  export function connectToWindow(session, windowIndex) {
    _focusedPanel.connectToWindow(session, windowIndex);
  }

  export function getCurrentSession() {
    return _focusedPanel?.session ?? null;
  }

  export function getCurrentWindowIndex() {
    return _focusedPanel?.windowIndex ?? null;
  }

  export function getCurrentViewMode() {
    return _focusedPanel?.viewMode ?? 'terminal';
  }

  export function getTerminal() {
    return _focusedPanel?.getTerminal() ?? null;
  }

  export function getToolbar() {
    return _focusedPanel?.getToolbar() ?? null;
  }

  export function getFileBrowsers() {
    return _focusedPanel?.getFileBrowsers() ?? new Map();
  }

  export function getGitBrowsers() {
    return _focusedPanel?.getGitBrowsers() ?? new Map();
  }

  function _setupDividerDrag() {
    if (!_dividerEl) return;

    let startX = 0;
    let startPosition = 0;
    let containerWidth = 0;

    const onMove = (clientX) => {
      const delta = clientX - startX;
      const deltaPercent = (delta / containerWidth) * 100;
      const newPosition = Math.max(20, Math.min(80, startPosition + deltaPercent));
      _dividerPosition = newPosition;
      _applyDividerPosition();

      requestAnimationFrame(() => {
        _leftPanel.fit();
        if (_rightPanel) _rightPanel.fit();
      });
    };

    const onEnd = () => {
      _dividerEl.classList.remove('split-divider--active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
      _saveDividerPosition();
    };

    const onMouseMove = (e) => onMove(e.clientX);
    const onMouseUp = () => onEnd();
    const onTouchMove = (e) => {
      if (e.touches.length > 0) onMove(e.touches[0].clientX);
    };
    const onTouchEnd = () => onEnd();

    _dividerEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startPosition = _dividerPosition;
      containerWidth = container.offsetWidth;
      _dividerEl.classList.add('split-divider--active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    _dividerEl.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      startX = e.touches[0].clientX;
      startPosition = _dividerPosition;
      containerWidth = container.offsetWidth;
      _dividerEl.classList.add('split-divider--active');
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      document.addEventListener('touchmove', onTouchMove, { passive: true });
      document.addEventListener('touchend', onTouchEnd);
      document.addEventListener('touchcancel', onTouchEnd);
    });
  }

  function _applyDividerPosition() {
    document.documentElement.style.setProperty('--panel-left-width', _dividerPosition + '%');
  }

  function _handleWindowResize() {
    if (!_splitMode) return;

    const narrow = window.innerWidth < 900;

    if (narrow) {
      if (_rightPanel) {
        if (_focusedPanel === _leftPanel) {
          _rightPanel.getElement().classList.add('panel--collapsed');
          _leftPanel.getElement().classList.remove('panel--collapsed');
        } else {
          _leftPanel.getElement().classList.add('panel--collapsed');
          _rightPanel.getElement().classList.remove('panel--collapsed');
        }
      }
    } else {
      _leftPanel.getElement().classList.remove('panel--collapsed');
      if (_rightPanel) {
        _rightPanel.getElement().classList.remove('panel--collapsed');
      }
    }

    requestAnimationFrame(() => {
      _leftPanel.fit();
      if (_rightPanel) _rightPanel.fit();
    });
  }

  function _handleKeyboardShortcut(e) {
    if (!_splitMode) return;
    if (!e.ctrlKey || !e.shiftKey) return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      switchFocus();
    }
  }

  export function cleanup() {
    if (_resizeHandler) {
      window.removeEventListener('resize', _resizeHandler);
      _resizeHandler = null;
    }
    if (_keyHandler) {
      document.removeEventListener('keydown', _keyHandler);
      _keyHandler = null;
    }
    if (_visibilityHandler) {
      document.removeEventListener('visibilitychange', _visibilityHandler);
      _visibilityHandler = null;
    }
    if (_leftPanel) _leftPanel.cleanup();
    if (_rightPanel) _rightPanel.cleanup();
  }

  function _saveDividerPosition() {
    try {
      localStorage.setItem('palmux-divider-position', String(_dividerPosition));
    } catch { /* ignored */ }
  }

  function _loadDividerPosition() {
    try {
      const saved = localStorage.getItem('palmux-divider-position');
      if (saved) {
        const pos = parseFloat(saved);
        if (pos >= 20 && pos <= 80) return pos;
      }
      return null;
    } catch { return null; }
  }

  function _saveSplitMode() {
    try {
      localStorage.setItem('palmux-split-mode', _splitMode ? '1' : '0');
    } catch { /* ignored */ }
  }

  function _loadSplitMode() {
    try {
      return localStorage.getItem('palmux-split-mode') === '1';
    } catch { return false; }
  }

  onDestroy(() => {
    cleanup();
  });
</script>

<!-- PanelManager has no visible template - it manages panels imperatively -->
