<script>
  /**
   * Panel.svelte - パネルコンポーネント (Svelte 5)
   * 左右いずれかのパネルの全状態をカプセル化する。
   * Terminal / FileBrowser / GitBrowser / Toolbar / IME / Touch / Connection を独立に管理する。
   * タブキャッシュにより、同一セッション内の複数ウィンドウ・Files・Git を高速に切り替える。
   */

  import { onDestroy } from 'svelte';
  import { getWebSocketURL, getCommands, listNotifications, deleteNotification } from '../../js/api.js';
  import { PalmuxTerminal } from '../../js/terminal.js';
  import { ToolbarAdapter as Toolbar } from './ToolbarAdapter.js';
  import { IMEInputAdapter as IMEInput } from './IMEInputAdapter.js';
  import { TouchHandler } from '../../js/touch.js';
  import { VoiceInputAdapter as VoiceInput } from './VoiceInputAdapter.js';
  import { ConnectionManager } from '../../js/connection.js';
  import { FileBrowser } from '../../js/filebrowser.js';
  import { GitBrowser } from '../../js/gitbrowser.js';

  /**
   * @typedef {object} TabState
   * @property {'terminal'|'files'|'git'} type
   * @property {number|null} windowIndex
   * @property {HTMLElement} rootEl
   * @property {PalmuxTerminal|null} terminal
   * @property {Toolbar|null} toolbar
   * @property {IMEInput|null} imeInput
   * @property {TouchHandler|null} touchHandler
   * @property {ConnectionManager|null} connectionManager
   * @property {HTMLElement|null} reconnectOverlayEl
   * @property {VoiceInput|null} voiceInput
   * @property {FileBrowser|null} fileBrowser
   * @property {GitBrowser|null} gitBrowser
   */

  let {
    id = 'left',
    globalUIState = {},
    isMobileDevice = () => false,
    onFocusRequest = null,
    onClientStatus = null,
    onNotificationUpdate = null,
    onConnectionStateChange = null,
    onFileBrowserNavigate = null,
    onFileBrowserPreview = null,
    onFileBrowserPreviewClose = null,
    onGitBrowserNavigate = null,
  } = $props();

  /** @type {string|null} */
  let session = $state(null);
  /** @type {number|null} */
  let windowIndex = $state(null);
  /** @type {'terminal'|'filebrowser'|'gitbrowser'} */
  let viewMode = $state('terminal');

  /** @type {PalmuxTerminal|null} */
  let _terminal = null;
  /** @type {Toolbar|null} */
  let _toolbar = null;
  /** @type {IMEInput|null} */
  let _imeInput = null;
  /** @type {TouchHandler|null} */
  let _touchHandler = null;
  /** @type {ConnectionManager|null} */
  let _connectionManager = null;

  /** @type {Map<string, TabState>} */
  const _tabCache = new Map();
  /** @type {string|null} */
  let _activeTabKey = null;
  let _focused = false;

  /** @type {HTMLElement} */
  let _el = $state(null);
  let _headerEl = $state(null);
  let _headerTitleEl = $state(null);
  let _contentEl = $state(null);

  function initPanel(el) {
    _el = el;
  }

  function initHeader(el) {
    _headerEl = el;
  }

  function initHeaderTitle(el) {
    _headerTitleEl = el;
  }

  function initContent(el) {
    _contentEl = el;
  }

  function handleMouseDown() {
    if (onFocusRequest) onFocusRequest(panelAPI);
  }

  function handleTouchStart() {
    if (onFocusRequest) onFocusRequest(panelAPI);
  }

  // ───────── タブキャッシュ ─────────

  function switchToTab(tabKey) {
    if (_activeTabKey === tabKey) return;

    if (_activeTabKey && _tabCache.has(_activeTabKey)) {
      _hideTab(_tabCache.get(_activeTabKey));
    }

    if (!_tabCache.has(tabKey)) {
      const colonIdx = tabKey.indexOf(':');
      const type = colonIdx >= 0 ? tabKey.substring(0, colonIdx) : tabKey;
      const indexStr = colonIdx >= 0 ? tabKey.substring(colonIdx + 1) : null;

      switch (type) {
        case 'terminal':
          _createTerminalTab(parseInt(indexStr, 10));
          break;
        case 'files':
          _createFilesTab();
          break;
        case 'git':
          _createGitTab();
          break;
      }
    }

    const tabState = _tabCache.get(tabKey);
    _showTab(tabState);
    _activeTabKey = tabKey;
    _saveLastTab();

    if (tabState.type === 'terminal') {
      _terminal = tabState.terminal;
      _toolbar = tabState.toolbar;
      _imeInput = tabState.imeInput;
      _touchHandler = tabState.touchHandler;
      _connectionManager = tabState.connectionManager;
      windowIndex = tabState.windowIndex;
      viewMode = 'terminal';
    } else if (tabState.type === 'files') {
      viewMode = 'filebrowser';
    } else if (tabState.type === 'git') {
      viewMode = 'gitbrowser';
    }
  }

  function _createTerminalTab(windowIdx) {
    const tabKey = `terminal:${windowIdx}`;

    const rootEl = document.createElement('div');
    rootEl.className = 'panel-terminal-view hidden';

    const terminalWrapperEl = document.createElement('div');
    terminalWrapperEl.className = 'panel-terminal-wrapper';

    const terminalContainerEl = document.createElement('div');
    terminalContainerEl.className = 'panel-terminal-container';

    const reconnectOverlayEl = document.createElement('div');
    reconnectOverlayEl.className = 'panel-reconnect-overlay hidden';
    const reconnectText = document.createElement('span');
    reconnectText.className = 'reconnect-overlay-text';
    reconnectText.textContent = 'Reconnecting...';
    reconnectOverlayEl.appendChild(reconnectText);

    terminalWrapperEl.appendChild(terminalContainerEl);
    terminalWrapperEl.appendChild(reconnectOverlayEl);

    const imeContainerEl = document.createElement('div');
    const toolbarContainerEl = document.createElement('div');

    rootEl.appendChild(terminalWrapperEl);
    rootEl.appendChild(imeContainerEl);
    rootEl.appendChild(toolbarContainerEl);

    _contentEl.appendChild(rootEl);

    const terminal = new PalmuxTerminal(terminalContainerEl);

    terminal.setOnClientStatus((sess, win) => {
      if (_activeTabKey !== tabKey) return;
      const sessionChanged = sess !== session;
      const windowChanged = win !== windowIndex;
      if (!sessionChanged && !windowChanged) return;
      session = sess;
      windowIndex = win;
      _updateHeaderTitle();
      if (onClientStatus) onClientStatus(sess, win);
    });

    terminal.setOnNotificationUpdate((notifications) => {
      if (onNotificationUpdate) onNotificationUpdate(notifications);
    });

    const imeInput = new IMEInput(imeContainerEl, {
      onSend: (text) => terminal.sendInput(text),
      onToggle: (visible) => {
        terminal.setIMEMode(visible);
        requestAnimationFrame(() => terminal.fit());
      },
    });

    let voiceInput = null;
    if (VoiceInput.isSupported()) {
      voiceInput = new VoiceInput(imeInput.getBarElement(), {
        onResult: (text) => {
          imeInput.insertText(text);
          imeInput.setPreviewText('');
        },
        onInterim: (text) => imeInput.setPreviewText(text),
        lang: 'ja-JP',
      });
    }

    const toolbar = new Toolbar(toolbarContainerEl, {
      onSendKey: (key) => terminal.sendInput(key),
      onFetchCommands: (sess) => getCommands(sess),
      onKeyboardMode: (mode) => {
        terminal.setKeyboardMode(mode);
        if (mode === 'ime') {
          imeInput.show();
        } else {
          imeInput.hide();
        }
        requestAnimationFrame(() => terminal.fit());
      },
    });
    terminal.setToolbar(toolbar);
    imeInput.setToolbar(toolbar);
    toolbar.setCurrentSession(session);
    toolbar.restoreState(globalUIState);

    if (globalUIState.toolbarVisible === null) {
      if (!isMobileDevice()) {
        toolbar.toggleVisibility();
        globalUIState.toolbarVisible = false;
      } else {
        globalUIState.toolbarVisible = true;
      }
    }

    if (globalUIState.keyboardMode !== 'none') {
      terminal.setKeyboardMode(globalUIState.keyboardMode);
      if (globalUIState.keyboardMode === 'ime') {
        imeInput.show();
      }
    }

    const touchHandler = new TouchHandler(terminalContainerEl, {
      terminal,
      onPinchZoom: (delta) => {
        if (delta > 0) terminal.increaseFontSize();
        else terminal.decreaseFontSize();
      },
    });

    const connectionManager = new ConnectionManager({
      getWSUrl: () => getWebSocketURL(session, windowIdx),
      onStateChange: (state) => {
        if (state === 'connected') {
          reconnectOverlayEl.classList.add('hidden');
        } else if (state === 'connecting') {
          reconnectOverlayEl.classList.remove('hidden');
        } else {
          reconnectOverlayEl.classList.add('hidden');
        }
        if (state === 'connected') {
          deleteNotification(session, windowIdx)
            .then(() => listNotifications())
            .then((notifications) => {
              if (onNotificationUpdate && notifications) {
                onNotificationUpdate(notifications);
              }
            })
            .catch(() => {});
        }
        if (_activeTabKey === tabKey && onConnectionStateChange) {
          onConnectionStateChange(state);
        }
      },
      terminal,
    });
    connectionManager.connect();

    terminal.setOnReconnectFlush(() => {
      if (_focused && _activeTabKey === tabKey) {
        terminal.focus();
      }
    });

    terminal.setGlobalKeyHandlerEnabled(false);

    /** @type {TabState} */
    const tabState = {
      type: 'terminal',
      windowIndex: windowIdx,
      rootEl,
      terminal,
      toolbar,
      imeInput,
      touchHandler,
      connectionManager,
      reconnectOverlayEl,
      voiceInput,
      fileBrowser: null,
      gitBrowser: null,
    };

    _tabCache.set(tabKey, tabState);
  }

  function _createFilesTab(initialPath = null) {
    const rootEl = document.createElement('div');
    rootEl.className = 'panel-filebrowser-view hidden';

    const wrapper = document.createElement('div');
    wrapper.style.height = '100%';

    const browser = new FileBrowser(wrapper, {
      onFileSelect: (sess, filePath) => {
        if (onFileBrowserPreview) onFileBrowserPreview(sess, filePath);
      },
      onNavigate: (path) => {
        if (onFileBrowserNavigate) onFileBrowserNavigate(session, path);
      },
      onPreviewClose: (sess, dirPath) => {
        if (onFileBrowserPreviewClose) onFileBrowserPreviewClose(sess, dirPath);
      },
    });

    rootEl.appendChild(wrapper);
    _contentEl.appendChild(rootEl);

    browser.open(session, initialPath || '.');

    /** @type {TabState} */
    const tabState = {
      type: 'files',
      windowIndex: null,
      rootEl,
      terminal: null,
      toolbar: null,
      imeInput: null,
      touchHandler: null,
      connectionManager: null,
      reconnectOverlayEl: null,
      voiceInput: null,
      fileBrowser: browser,
      gitBrowser: null,
    };

    _tabCache.set('files', tabState);
  }

  function _createGitTab() {
    const rootEl = document.createElement('div');
    rootEl.className = 'panel-gitbrowser-view hidden';

    const wrapper = document.createElement('div');
    wrapper.style.height = '100%';
    wrapper.style.position = 'relative';

    const browser = new GitBrowser(wrapper, {
      onNavigate: (gitState) => {
        if (onGitBrowserNavigate) onGitBrowserNavigate(session, gitState);
      },
    });

    rootEl.appendChild(wrapper);
    _contentEl.appendChild(rootEl);

    browser.open(session);

    /** @type {TabState} */
    const tabState = {
      type: 'git',
      windowIndex: null,
      rootEl,
      terminal: null,
      toolbar: null,
      imeInput: null,
      touchHandler: null,
      connectionManager: null,
      reconnectOverlayEl: null,
      voiceInput: null,
      fileBrowser: null,
      gitBrowser: browser,
    };

    _tabCache.set('git', tabState);
  }

  function _hideTab(tabState) {
    if (tabState.type === 'terminal') {
      _saveToolbarState();
    }
    tabState.rootEl.classList.add('hidden');
    if (tabState.type === 'terminal' && tabState.terminal) {
      tabState.terminal.setFitEnabled(false);
      tabState.terminal.setGlobalKeyHandlerEnabled(false);
    }
  }

  function _showTab(tabState) {
    tabState.rootEl.classList.remove('hidden');
    if (tabState.type === 'terminal' && tabState.terminal) {
      tabState.terminal.setFitEnabled(true);
      tabState.terminal.setGlobalKeyHandlerEnabled(_focused);
      requestAnimationFrame(() => {
        tabState.terminal.fit();
        if (_focused) tabState.terminal.focus();
      });
    }
  }

  function _destroyTabState(tabState) {
    if (tabState.type === 'terminal') {
      if (tabState.voiceInput) tabState.voiceInput.destroy();
      if (tabState.touchHandler) tabState.touchHandler.destroy();
      if (tabState.imeInput) tabState.imeInput.destroy();
      if (tabState.toolbar) tabState.toolbar.dispose();
      if (tabState.connectionManager) tabState.connectionManager.disconnect();
      if (tabState.terminal) tabState.terminal.disconnect();
    } else if (tabState.type === 'files') {
      if (tabState.fileBrowser) tabState.fileBrowser.dispose();
    } else if (tabState.type === 'git') {
      if (tabState.gitBrowser) tabState.gitBrowser.dispose();
    }
    tabState.rootEl.remove();
  }

  // ───────── 内部ユーティリティ ─────────

  function _saveLastTab() {
    if (!session || !_activeTabKey) return;
    try {
      const type = _activeTabKey.startsWith('terminal:') ? 'terminal' : _activeTabKey;
      localStorage.setItem(`palmux-last-tab-${session}`, type);
    } catch { /* ignore */ }
  }

  function _saveToolbarState() {
    if (_toolbar) {
      globalUIState.toolbarVisible = _toolbar.visible;
      globalUIState.keyboardMode = _toolbar.keyboardMode;
      globalUIState.ctrlState = _toolbar.ctrlState;
      globalUIState.altState = _toolbar.altState;
    }
  }

  function _updateHeaderTitle() {
    if (_headerTitleEl && session !== null && windowIndex !== null) {
      _headerTitleEl.textContent = `${session}:${windowIndex}`;
    }
  }

  onDestroy(() => {
    clearTabCache();
  });

  // ───────── Exported methods ─────────

  export function getElement() {
    return _el;
  }

  export function setHeaderVisible(visible) {
    if (_headerEl) _headerEl.style.display = visible ? '' : 'none';
  }

  export { switchToTab };

  export function getActiveTabKey() {
    return _activeTabKey;
  }

  export function removeTerminalTab(windowIdx) {
    const tabKey = `terminal:${windowIdx}`;
    const tabState = _tabCache.get(tabKey);
    if (!tabState) return;

    if (_activeTabKey === tabKey) {
      _activeTabKey = null;
      if (tabState.type === 'terminal') {
        _terminal = null;
        _toolbar = null;
        _imeInput = null;
        _touchHandler = null;
        _connectionManager = null;
      }
    }

    _destroyTabState(tabState);
    _tabCache.delete(tabKey);
  }

  export function pruneTerminalTabs(windows) {
    const validIndices = new Set(windows.map(w => w.index));
    const staleKeys = [];
    for (const [tabKey, tabState] of _tabCache) {
      if (tabState.type !== 'terminal') continue;
      if (!validIndices.has(tabState.windowIndex)) {
        staleKeys.push(tabKey);
      }
    }
    for (const tabKey of staleKeys) {
      removeTerminalTab(parseInt(tabKey.split(':')[1], 10));
    }
  }

  export function clearTabCache() {
    for (const [, tabState] of _tabCache) {
      _destroyTabState(tabState);
    }
    _tabCache.clear();
    _activeTabKey = null;
    _terminal = null;
    _toolbar = null;
    _imeInput = null;
    _touchHandler = null;
    _connectionManager = null;
  }

  export function connectToWindow(sessionName, windowIdx) {
    if (sessionName !== session) {
      _saveToolbarState();
      clearTabCache();
    }
    session = sessionName;
    switchToTab(`terminal:${windowIdx}`);
    _updateHeaderTitle();
  }

  export function showTerminalView() {
    if (windowIndex !== null) {
      switchToTab(`terminal:${windowIndex}`);
    }
  }

  export function showFileBrowser(sessionName, opts = {}) {
    const path = opts.path ?? null;
    if (!_tabCache.has('files')) {
      _createFilesTab(path);
    } else if (path !== null) {
      const tabState = _tabCache.get('files');
      if (tabState.fileBrowser) {
        tabState.fileBrowser.navigateTo(path);
      }
    }
    switchToTab('files');
  }

  export function showGitBrowser(sessionName) {
    if (!_tabCache.has('git')) {
      _createGitTab();
    }
    switchToTab('git');
  }

  export function setFocused(focused) {
    _focused = focused;
    if (_el) {
      if (focused) {
        _el.classList.add('panel--focused');
      } else {
        _el.classList.remove('panel--focused');
      }
    }

    if (_terminal && viewMode === 'terminal') {
      _terminal.setGlobalKeyHandlerEnabled(focused);
      if (focused) {
        _terminal.focus();
      }
    }
  }

  export function fit() {
    if (_terminal && viewMode === 'terminal') {
      _terminal.fit();
    }
  }

  export function getTerminal() {
    return _terminal;
  }

  export function getToolbar() {
    return _toolbar;
  }

  export function getFileBrowsers() {
    const map = new Map();
    const tabState = _tabCache.get('files');
    if (tabState && tabState.fileBrowser && session) {
      map.set(session, { wrapper: tabState.rootEl, browser: tabState.fileBrowser });
    }
    return map;
  }

  export function getGitBrowsers() {
    const map = new Map();
    const tabState = _tabCache.get('git');
    if (tabState && tabState.gitBrowser && session) {
      map.set(session, { wrapper: tabState.rootEl, browser: tabState.gitBrowser });
    }
    return map;
  }

  export function getConnectionManager() {
    return _connectionManager;
  }

  export function getIsFocused() {
    return _focused;
  }

  export function getIsConnected() {
    return session !== null && _terminal !== null;
  }

  export function getSession() {
    return session;
  }

  export function setSession(s) {
    session = s;
  }

  export function getWindowIndex() {
    return windowIndex;
  }

  export function setWindowIndex(idx) {
    windowIndex = idx;
  }

  export function getViewMode() {
    return viewMode;
  }

  export function getCurrentFilePath() {
    if (viewMode !== 'filebrowser' || !session) return null;
    const tabState = _tabCache.get('files');
    if (!tabState || !tabState.fileBrowser) return null;
    return tabState.fileBrowser.getCurrentPath() || '.';
  }

  export function increaseFontSize() {
    if (viewMode === 'filebrowser') {
      const tabState = _tabCache.get('files');
      if (tabState && tabState.fileBrowser) tabState.fileBrowser.increaseFontSize();
    } else if (viewMode === 'gitbrowser') {
      const tabState = _tabCache.get('git');
      if (tabState && tabState.gitBrowser) tabState.gitBrowser.increaseFontSize();
    } else if (_terminal) {
      _terminal.increaseFontSize();
    }
  }

  export function decreaseFontSize() {
    if (viewMode === 'filebrowser') {
      const tabState = _tabCache.get('files');
      if (tabState && tabState.fileBrowser) tabState.fileBrowser.decreaseFontSize();
    } else if (viewMode === 'gitbrowser') {
      const tabState = _tabCache.get('git');
      if (tabState && tabState.gitBrowser) tabState.gitBrowser.decreaseFontSize();
    } else if (_terminal) {
      _terminal.decreaseFontSize();
    }
  }

  export function setClaudeWindow(isClaude) {
    if (_toolbar) _toolbar.setClaudeWindow(isClaude);
    for (const [, tabState] of _tabCache) {
      if (tabState.toolbar && tabState.toolbar !== _toolbar) {
        tabState.toolbar.setClaudeWindow(isClaude);
      }
    }
  }

  export function toggleToolbar() {
    if (_toolbar) {
      _toolbar.toggleVisibility();
      globalUIState.toolbarVisible = _toolbar.visible;
      if (_terminal) {
        requestAnimationFrame(() => _terminal.fit());
      }
    }
  }

  export function reconnectNow() {
    if (_connectionManager && _connectionManager.state !== 'connected') {
      _connectionManager.reconnectNow();
    }
  }

  export function cleanup() {
    _saveToolbarState();
    clearTabCache();
    session = null;
    windowIndex = null;
  }

  export function getLastTabStatic(sessionName) {
    try {
      return localStorage.getItem(`palmux-last-tab-${sessionName}`);
    } catch { return null; }
  }

  // Public API object for onFocusRequest callback (so caller gets a handle)
  const panelAPI = {
    get id() { return id; },
    get session() { return session; },
    set session(v) { session = v; },
    get windowIndex() { return windowIndex; },
    set windowIndex(v) { windowIndex = v; },
    get viewMode() { return viewMode; },
    get isFocused() { return _focused; },
    get isConnected() { return session !== null && _terminal !== null; },
    getElement,
    setHeaderVisible,
    switchToTab,
    getActiveTabKey,
    removeTerminalTab,
    pruneTerminalTabs,
    clearTabCache,
    connectToWindow,
    showTerminalView,
    showFileBrowser,
    showGitBrowser,
    setFocused,
    fit,
    getTerminal,
    getToolbar,
    getFileBrowsers,
    getGitBrowsers,
    getConnectionManager,
    getCurrentFilePath,
    increaseFontSize,
    decreaseFontSize,
    setClaudeWindow,
    toggleToolbar,
    reconnectNow,
    cleanup,
  };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="panel panel--single"
  data-panel-id={id}
  use:initPanel
  onmousedown={handleMouseDown}
  ontouchstart={handleTouchStart}
>
  <div class="panel-header" style:display="none" use:initHeader>
    <span class="panel-header-title" use:initHeaderTitle></span>
  </div>
  <div class="panel-content" use:initContent></div>
</div>
