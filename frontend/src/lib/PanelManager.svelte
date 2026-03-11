<script>
  /**
   * PanelManager.svelte - パネルのライフサイクル・レイアウト・フォーカスを管理する (Svelte 5)
   * Panel.svelte を直接テンプレートで描画する。Adapter パターンは不要。
   */

  import { onMount, onDestroy } from 'svelte';
  import Panel from './Panel.svelte';

  let {
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

  /** @type {ReturnType<typeof Panel>} */
  let _leftPanelRef = $state(null);
  /** @type {ReturnType<typeof Panel>|null} */
  let _rightPanelRef = $state(null);
  /** @type {'left'|'right'} */
  let _focusedSide = $state('left');
  let _splitMode = $state(false);
  let _dividerPosition = $state(_loadDividerPosition() || 50);
  let _dividerEl = $state(null);
  let _containerEl = $state(null);

  let _leftCollapsed = $state(false);
  let _rightCollapsed = $state(false);

  let _resizeHandler = null;
  let _keyHandler = null;
  let _visibilityHandler = null;

  /** @returns {ReturnType<typeof Panel>|null} */
  function _getFocusedRef() {
    return _focusedSide === 'right' ? _rightPanelRef : _leftPanelRef;
  }

  onMount(() => {
    if (_leftPanelRef) {
      _leftPanelRef.setFocused(true);
    }

    _resizeHandler = () => _handleWindowResize();
    window.addEventListener('resize', _resizeHandler);

    _keyHandler = (e) => _handleKeyboardShortcut(e);
    document.addEventListener('keydown', _keyHandler);

    _visibilityHandler = () => {
      if (document.visibilityState !== 'visible') return;
      const focused = _getFocusedRef();
      const terminal = focused?.getTerminal();
      if (terminal) terminal.focus();
    };
    document.addEventListener('visibilitychange', _visibilityHandler);

    if (_loadSplitMode() && window.innerWidth >= 900) {
      toggleSplit();
    }
  });

  export function getIsSplit() {
    return _splitMode;
  }

  export function getFocusedPanel() {
    return _getFocusedRef();
  }

  export function getFocusedPanelId() {
    return _focusedSide;
  }

  export function getLeftPanel() {
    return _leftPanelRef;
  }

  export function getRightPanel() {
    return _rightPanelRef;
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

    // Capture left panel's connection info before setting split mode
    const leftConnected = _leftPanelRef?.getIsConnected();
    const leftSession = _leftPanelRef?.getSession();
    const leftWindowIndex = _leftPanelRef?.getWindowIndex();

    _splitMode = true;
    _leftCollapsed = false;
    _rightCollapsed = false;

    _applyDividerPosition();

    _focusedSide = 'left';
    if (_leftPanelRef) {
      _leftPanelRef.setFocused(true);
    }

    // Wait for right panel to mount, then auto-connect and set focus
    queueMicrotask(() => {
      if (_rightPanelRef) {
        _rightPanelRef.setFocused(false);

        if (!skipAutoConnect && leftConnected) {
          _rightPanelRef.connectToWindow(leftSession, leftWindowIndex);
        }
      }

      _handleWindowResize();

      requestAnimationFrame(() => {
        if (_leftPanelRef) _leftPanelRef.fit();
        if (_rightPanelRef) _rightPanelRef.fit();
      });

      if (onFocusChange) onFocusChange(_getFocusedRef());
    });
  }

  function _unsplit() {
    if (!_splitMode) return;

    // If right panel is focused, transfer its connection to left before destroying
    if (_focusedSide === 'right' && _rightPanelRef) {
      const rightSession = _rightPanelRef.getSession();
      const rightWindowIndex = _rightPanelRef.getWindowIndex();
      const rightViewMode = _rightPanelRef.getViewMode();

      // Clean up left panel's old state
      _leftPanelRef.cleanup();

      // Re-connect left panel with right panel's state
      if (rightSession !== null && rightWindowIndex !== null) {
        _leftPanelRef.connectToWindow(rightSession, rightWindowIndex);
        if (rightViewMode === 'filebrowser') {
          _leftPanelRef.showFileBrowser(rightSession);
        } else if (rightViewMode === 'gitbrowser') {
          _leftPanelRef.showGitBrowser(rightSession);
        }
      }
    }

    // Right panel will be destroyed by Svelte when _splitMode becomes false
    _splitMode = false;
    _leftCollapsed = false;
    _rightCollapsed = false;

    _focusedSide = 'left';
    if (_leftPanelRef) {
      _leftPanelRef.setFocused(true);
    }

    requestAnimationFrame(() => {
      if (_leftPanelRef) _leftPanelRef.fit();
    });

    if (onFocusChange) onFocusChange(_getFocusedRef());
  }

  export function switchFocus() {
    if (!_splitMode || !_rightPanelRef) return;
    const nextSide = _focusedSide === 'left' ? 'right' : 'left';
    _setFocusBySide(nextSide);
  }

  function _setFocusBySide(side) {
    if (_focusedSide === side) return;
    const prevRef = _getFocusedRef();
    if (prevRef) prevRef.setFocused(false);

    _focusedSide = side;
    const nextRef = _getFocusedRef();
    if (nextRef) nextRef.setFocused(true);

    // Update collapsed state for narrow viewports
    _handleWindowResize();

    if (onFocusChange) onFocusChange(nextRef);
  }

  export function setFocus(panelRef) {
    // Determine which side this panel ref is
    if (panelRef === _leftPanelRef) {
      _setFocusBySide('left');
    } else if (panelRef === _rightPanelRef) {
      _setFocusBySide('right');
    }
  }

  export function switchTab(tabKey) {
    const focused = _getFocusedRef();
    if (focused) focused.switchToTab(tabKey);
  }

  export function connectToWindow(session, windowIndex) {
    const focused = _getFocusedRef();
    if (focused) focused.connectToWindow(session, windowIndex);
  }

  export function getCurrentSession() {
    return _getFocusedRef()?.getSession() ?? null;
  }

  export function getCurrentWindowIndex() {
    return _getFocusedRef()?.getWindowIndex() ?? null;
  }

  export function getCurrentViewMode() {
    return _getFocusedRef()?.getViewMode() ?? 'terminal';
  }

  export function getTerminal() {
    return _getFocusedRef()?.getTerminal() ?? null;
  }

  /**
   * Send input to a specific window's terminal without switching tabs.
   * @param {number} windowIdx
   * @param {string} data
   */
  export function sendToWindow(windowIdx, data) {
    if (_leftPanelRef) _leftPanelRef.sendToWindow(windowIdx, data);
    else if (_rightPanelRef) _rightPanelRef.sendToWindow(windowIdx, data);
  }

  export function getToolbar() {
    return _getFocusedRef()?.getToolbar() ?? null;
  }

  export function getFileBrowsers() {
    return _getFocusedRef()?.getFileBrowsers() ?? new Map();
  }

  export function getGitBrowsers() {
    return _getFocusedRef()?.getGitBrowsers() ?? new Map();
  }

  // ───────── Divider drag (Svelte action) ─────────

  function dividerDrag(node) {
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
        if (_leftPanelRef) _leftPanelRef.fit();
        if (_rightPanelRef) _rightPanelRef.fit();
      });
    };

    const onMouseMove = (e) => onMove(e.clientX);
    const onMouseUp = () => onEnd();
    const onTouchMove = (e) => {
      if (e.touches.length > 0) onMove(e.touches[0].clientX);
    };
    const onTouchEnd = () => onEnd();

    const onEnd = () => {
      node.classList.remove('split-divider--active');
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

    const onMouseDown = (e) => {
      e.preventDefault();
      startX = e.clientX;
      startPosition = _dividerPosition;
      containerWidth = _containerEl ? _containerEl.offsetWidth : window.innerWidth;
      node.classList.add('split-divider--active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      startX = e.touches[0].clientX;
      startPosition = _dividerPosition;
      containerWidth = _containerEl ? _containerEl.offsetWidth : window.innerWidth;
      node.classList.add('split-divider--active');
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      document.addEventListener('touchmove', onTouchMove, { passive: true });
      document.addEventListener('touchend', onTouchEnd);
      document.addEventListener('touchcancel', onTouchEnd);
    };

    node.addEventListener('mousedown', onMouseDown);
    node.addEventListener('touchstart', onTouchStart);

    return {
      destroy() {
        node.removeEventListener('mousedown', onMouseDown);
        node.removeEventListener('touchstart', onTouchStart);
      }
    };
  }

  function _applyDividerPosition() {
    document.documentElement.style.setProperty('--panel-left-width', _dividerPosition + '%');
  }

  function _handleWindowResize() {
    if (!_splitMode) return;

    const narrow = window.innerWidth < 900;

    if (narrow) {
      if (_focusedSide === 'left') {
        _rightCollapsed = true;
        _leftCollapsed = false;
      } else {
        _leftCollapsed = true;
        _rightCollapsed = false;
      }
    } else {
      _leftCollapsed = false;
      _rightCollapsed = false;
    }

    requestAnimationFrame(() => {
      if (_leftPanelRef) _leftPanelRef.fit();
      if (_rightPanelRef) _rightPanelRef.fit();
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
    if (_leftPanelRef) _leftPanelRef.cleanup();
    if (_rightPanelRef) _rightPanelRef.cleanup();
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

<div class="panel-manager-container" bind:this={_containerEl} style="display:contents">
  <Panel
    bind:this={_leftPanelRef}
    id="left"
    layout={_splitMode ? 'left' : 'single'}
    collapsed={_leftCollapsed}
    {globalUIState}
    {isMobileDevice}
    onFocusRequest={() => setFocus(_leftPanelRef)}
    {onClientStatus}
    {onNotificationUpdate}
    {onConnectionStateChange}
    {onFileBrowserNavigate}
    {onFileBrowserPreview}
    {onFileBrowserPreviewClose}
    {onGitBrowserNavigate}
  />
  {#if _splitMode}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="split-divider" bind:this={_dividerEl} use:dividerDrag></div>
    <Panel
      bind:this={_rightPanelRef}
      id="right"
      layout="right"
      collapsed={_rightCollapsed}
      {globalUIState}
      {isMobileDevice}
      onFocusRequest={() => setFocus(_rightPanelRef)}
      {onClientStatus}
      {onNotificationUpdate}
      {onConnectionStateChange}
      {onFileBrowserNavigate}
      {onFileBrowserPreview}
      {onFileBrowserPreviewClose}
      {onGitBrowserNavigate}
    />
  {/if}
</div>
