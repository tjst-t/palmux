<script>
  /**
   * Panel.svelte - パネルコンポーネント (Svelte 5)
   * 左右いずれかのパネルの全状態をカプセル化する。
   * Terminal / FileBrowser / GitBrowser / Toolbar / IME / Touch / Connection を独立に管理する。
   * タブキャッシュにより、同一セッション内の複数ウィンドウ・Files・Git を高速に切り替える。
   */

  import { onDestroy, flushSync } from 'svelte';
  import { getWebSocketURL, getCommands, listNotifications, deleteNotification } from '../../js/api.js';
  import { PalmuxTerminal } from '../../js/terminal.js';
  import ToolbarComponent from './Toolbar.svelte';
  import IMEInputComponent from './IMEInput.svelte';
  import VoiceInputComponent from './VoiceInput.svelte';
  import { TouchHandler } from '../../js/touch.js';
  import { ConnectionManager } from '../../js/connection.js';
  import FileBrowserComponent from './FileBrowser.svelte';
  import GitBrowserComponent from './GitBrowser.svelte';

  const voiceSupported = !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);

  /**
   * @typedef {object} TabState
   * @property {string} key
   * @property {'terminal'|'files'|'git'} type
   * @property {number|null} windowIndex
   * @property {PalmuxTerminal|null} terminal
   * @property {Toolbar|null} toolbar
   * @property {IMEInput|null} imeInput
   * @property {TouchHandler|null} touchHandler
   * @property {ConnectionManager|null} connectionManager
   * @property {VoiceInput|null} voiceInput
   * @property {FileBrowser|null} fileBrowser
   * @property {GitBrowser|null} gitBrowser
   * @property {boolean} reconnecting
   * @property {HTMLElement|null} rootEl - reference to the root DOM element (set by action)
   */

  let {
    id = 'left',
    layout = 'single',
    collapsed = false,
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

  /** @type {TabState[]} */
  let tabs = $state([]);
  /** @type {string|null} */
  let activeTabKey = $state(null);
  let _focused = $state(false);

  /** @type {HTMLElement} */
  let _el = $state(null);
  let _headerEl = $state(null);
  let _headerTitleEl = $state(null);

  function handleMouseDown() {
    if (onFocusRequest) onFocusRequest(panelAPI);
  }

  function handleTouchStart() {
    if (onFocusRequest) onFocusRequest(panelAPI);
  }

  // ───────── タブ検索ヘルパー ─────────

  function _findTab(key) {
    return tabs.find(t => t.key === key) ?? null;
  }

  function _findTabIndex(key) {
    return tabs.findIndex(t => t.key === key);
  }

  // ───────── タブキャッシュ ─────────

  function switchToTab(tabKey) {
    if (activeTabKey === tabKey) return;

    if (activeTabKey) {
      const prevTab = _findTab(activeTabKey);
      if (prevTab) _hideTab(prevTab);
    }

    if (!_findTab(tabKey)) {
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

    const tabState = _findTab(tabKey);
    activeTabKey = tabKey;
    _saveLastTab();

    if (tabState.type === 'terminal') {
      _terminal = tabState.terminal;
      _toolbar = tabState.toolbar;
      _imeInput = tabState.imeInput;
      _touchHandler = tabState.touchHandler;
      _connectionManager = tabState.connectionManager;
      windowIndex = tabState.windowIndex;
      viewMode = 'terminal';
      // _showTab logic is handled by the action when terminal becomes visible
      // For already-initialized terminals, trigger show logic
      if (tabState.terminal) {
        _showTabLogic(tabState);
      }
    } else if (tabState.type === 'files') {
      viewMode = 'filebrowser';
    } else if (tabState.type === 'git') {
      viewMode = 'gitbrowser';
    }
  }

  function _createTerminalTab(windowIdx) {
    const tabKey = `terminal:${windowIdx}`;

    /** @type {TabState} */
    const tabState = {
      key: tabKey,
      type: 'terminal',
      windowIndex: windowIdx,
      terminal: null,
      toolbar: null,
      imeInput: null,
      touchHandler: null,
      connectionManager: null,
      voiceInput: null,
      fileBrowser: null,
      gitBrowser: null,
      reconnecting: false,
      rootEl: null,
    };

    tabs.push(tabState);
  }

  function _createFilesTab(initialPath = null) {
    /** @type {TabState} */
    const tabState = {
      key: 'files',
      type: 'files',
      windowIndex: null,
      terminal: null,
      toolbar: null,
      imeInput: null,
      touchHandler: null,
      connectionManager: null,
      voiceInput: null,
      fileBrowser: null,
      gitBrowser: null,
      reconnecting: false,
      rootEl: null,
      _initialPath: initialPath,
    };

    tabs.push(tabState);
  }

  function _createGitTab() {
    /** @type {TabState} */
    const tabState = {
      key: 'git',
      type: 'git',
      windowIndex: null,
      terminal: null,
      toolbar: null,
      imeInput: null,
      touchHandler: null,
      connectionManager: null,
      voiceInput: null,
      fileBrowser: null,
      gitBrowser: null,
      reconnecting: false,
      rootEl: null,
    };

    tabs.push(tabState);
  }

  function _hideTab(tabState) {
    if (tabState.type === 'terminal') {
      _saveToolbarState();
    }
    if (tabState.type === 'terminal' && tabState.terminal) {
      tabState.terminal.setFitEnabled(false);
      tabState.terminal.setGlobalKeyHandlerEnabled(false);
    }
  }

  /** Apply show logic for a terminal tab (fit, focus, enable) */
  function _showTabLogic(tabState) {
    if (tabState.type === 'terminal' && tabState.terminal) {
      tabState.terminal.setFitEnabled(true);
      tabState.terminal.setGlobalKeyHandlerEnabled(_focused);
      requestAnimationFrame(() => {
        tabState.terminal.fit();
        if (_focused) tabState.terminal.focus();
      });
    }
  }

  /**
   * 明示的にタブリソースを解放する。
   * Svelte の onDestroy でも dispose() が呼ばれるが、各コンポーネントの
   * dispose() は null チェック済みなので二重呼び出しは安全。
   */
  function _destroyTabState(tabState) {
    if (tabState.type === 'terminal') {
      if (tabState.voiceInput) tabState.voiceInput.dispose();
      if (tabState.touchHandler) tabState.touchHandler.destroy();
      if (tabState.imeInput) tabState.imeInput.dispose();
      if (tabState.toolbar) tabState.toolbar.dispose();
      if (tabState.connectionManager) tabState.connectionManager.disconnect();
      if (tabState.terminal) tabState.terminal.disconnect();
    } else if (tabState.type === 'files') {
      if (tabState.fileBrowser) tabState.fileBrowser.dispose();
    } else if (tabState.type === 'git') {
      if (tabState.gitBrowser) tabState.gitBrowser.dispose();
    }
  }

  // ───────── Svelte use:action directives ─────────

  function initTerminal(node, tab) {
    const tabKey = tab.key;

    const terminal = new PalmuxTerminal(node);

    terminal.setOnClientStatus((sess, win) => {
      if (activeTabKey !== tabKey) return;
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

    tab.terminal = terminal;

    // Set module-level ref immediately for active tab
    if (activeTabKey === tabKey) {
      _terminal = terminal;
    }

    terminal.setGlobalKeyHandlerEnabled(false);

    return {
      destroy() {
        // Cleanup is handled by _destroyTabState
      }
    };
  }

  /**
   * Wire terminal tab components together after all child components are mounted.
   * Runs on the outer panel-terminal-view div.
   * Uses queueMicrotask to ensure bind:this refs for Toolbar/IMEInput are resolved.
   */
  function wireTerminalTab(node, tab) {
    tab.rootEl = node;
    const tabKey = tab.key;
    const windowIdx = tab.windowIndex;

    queueMicrotask(() => {
      const terminal = tab.terminal;
      if (!terminal) {
        console.warn(`[Panel] wireTerminalTab: terminal not resolved for tab ${tabKey}`);
        return;
      }

      // Wire toolbar to terminal
      const toolbar = tab.toolbar;
      if (toolbar) {
        terminal.setToolbar(toolbar);
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
      }

      // Wire IME to toolbar
      const imeInput = tab.imeInput;
      if (imeInput && toolbar) {
        imeInput.setToolbar(toolbar);
      }

      // Apply keyboard mode state
      if (globalUIState.keyboardMode !== 'none') {
        terminal.setKeyboardMode(globalUIState.keyboardMode);
        if (globalUIState.keyboardMode === 'ime' && imeInput) {
          imeInput.show();
        }
      }

      // Init touch handler
      const terminalContainerEl = node.querySelector('.panel-terminal-container');
      if (terminalContainerEl) {
        const touchHandler = new TouchHandler(terminalContainerEl, {
          terminal,
          onPinchZoom: (delta) => {
            if (delta > 0) terminal.increaseFontSize();
            else terminal.decreaseFontSize();
          },
        });
        tab.touchHandler = touchHandler;
      }

      // Init connection manager
      const connectionManager = new ConnectionManager({
        getWSUrl: () => getWebSocketURL(session, windowIdx),
        onStateChange: (state) => {
          if (state === 'connected') {
            tab.reconnecting = false;
          } else if (state === 'connecting') {
            tab.reconnecting = true;
          } else {
            tab.reconnecting = false;
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
          if (activeTabKey === tabKey && onConnectionStateChange) {
            onConnectionStateChange(state);
          }
        },
        terminal,
      });
      connectionManager.connect();
      tab.connectionManager = connectionManager;

      terminal.setOnReconnectFlush(() => {
        if (_focused && activeTabKey === tabKey) {
          terminal.focus();
        }
      });

      // Set module-level refs if this is the active tab
      if (activeTabKey === tabKey) {
        _toolbar = toolbar;
        _imeInput = imeInput;
        _touchHandler = tab.touchHandler;
        _connectionManager = connectionManager;
        _showTabLogic(tab);
      }
    });

    return {
      destroy() {
        // Cleanup is handled by _destroyTabState
      }
    };
  }

  /**
   * Wire files tab after FileBrowserComponent is mounted.
   * Calls open() via queueMicrotask to ensure bind:this is resolved.
   */
  function wireFilesTab(node, tab) {
    tab.rootEl = node;
    const initialPath = tab._initialPath || null;

    queueMicrotask(() => {
      if (tab.fileBrowser) {
        tab.fileBrowser.open(session, initialPath || '.');
      } else {
        console.warn('[Panel] wireFilesTab: fileBrowser not resolved');
      }
    });

    return {
      destroy() {
        // Cleanup is handled by _destroyTabState
      }
    };
  }

  /**
   * Wire git tab after GitBrowserComponent is mounted.
   * Calls open() via queueMicrotask to ensure bind:this is resolved.
   */
  function wireGitTab(node, tab) {
    tab.rootEl = node;

    queueMicrotask(() => {
      if (tab.gitBrowser) {
        tab.gitBrowser.open(session);
      } else {
        console.warn('[Panel] wireGitTab: gitBrowser not resolved');
      }
    });

    return {
      destroy() {
        // Cleanup is handled by _destroyTabState
      }
    };
  }

  // ───────── 内部ユーティリティ ─────────

  function _saveLastTab() {
    if (!session || !activeTabKey) return;
    try {
      const type = activeTabKey.startsWith('terminal:') ? 'terminal' : activeTabKey;
      localStorage.setItem(`palmux-last-tab-${session}`, type);
    } catch { /* ignore */ }
  }

  function _saveToolbarState() {
    if (_toolbar) {
      globalUIState.toolbarVisible = _toolbar.getVisible();
      globalUIState.keyboardMode = _toolbar.getKeyboardMode();
      globalUIState.ctrlState = _toolbar.getCtrlState();
      globalUIState.altState = _toolbar.getAltState();
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

  export function getId() {
    return id;
  }

  export function setHeaderVisible(visible) {
    if (_headerEl) _headerEl.style.display = visible ? '' : 'none';
  }

  export { switchToTab };

  export function getActiveTabKey() {
    return activeTabKey;
  }

  export function removeTerminalTab(windowIdx) {
    const tabKey = `terminal:${windowIdx}`;
    const idx = _findTabIndex(tabKey);
    if (idx < 0) return;
    const tabState = tabs[idx];

    if (activeTabKey === tabKey) {
      activeTabKey = null;
      if (tabState.type === 'terminal') {
        _terminal = null;
        _toolbar = null;
        _imeInput = null;
        _touchHandler = null;
        _connectionManager = null;
      }
    }

    _destroyTabState(tabState);
    tabs.splice(idx, 1);
  }

  export function pruneTerminalTabs(windows) {
    const validIndices = new Set(windows.map(w => w.index));
    const staleIndices = [];
    for (const tab of tabs) {
      if (tab.type !== 'terminal') continue;
      if (!validIndices.has(tab.windowIndex)) {
        staleIndices.push(tab.windowIndex);
      }
    }
    for (const winIdx of staleIndices) {
      removeTerminalTab(winIdx);
    }
  }

  export function clearTabCache() {
    for (const tabState of tabs) {
      _destroyTabState(tabState);
    }
    tabs = [];
    activeTabKey = null;
    _terminal = null;
    _toolbar = null;
    _imeInput = null;
    _touchHandler = null;
    _connectionManager = null;
  }

  export function connectToWindow(sessionName, windowIdx, { forceClean = false } = {}) {
    if (sessionName !== session || forceClean) {
      _saveToolbarState();
      clearTabCache();
      // flushSync is required: clearTabCache sets tabs=[] and the subsequent
      // switchToTab re-creates a tab with the same key (e.g. "terminal:2").
      // Without flushing, Svelte batches the removal and re-addition, sees the
      // same keyed item, and reuses the DOM node without re-running use: actions
      // (initTerminal, initToolbar, etc.), leaving the terminal uninitialized.
      flushSync();
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
    if (!_findTab('files')) {
      _createFilesTab(path);
    } else if (path !== null) {
      const tabState = _findTab('files');
      if (tabState.fileBrowser) {
        tabState.fileBrowser.navigateTo(path);
      }
    }
    switchToTab('files');
  }

  export function showGitBrowser(sessionName) {
    if (!_findTab('git')) {
      _createGitTab();
    }
    switchToTab('git');
  }

  export function setFocused(focused) {
    _focused = focused;

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

  /**
   * Send input to a specific window's terminal.
   * If the terminal's WebSocket isn't connected yet (tab never visited),
   * switches to the tab to trigger connection, waits, then sends.
   * @param {number} windowIdx
   * @param {string} data
   */
  export function sendToWindow(windowIdx, data) {
    const tabKey = `terminal:${windowIdx}`;
    const tabState = _findTab(tabKey);

    // Terminal already connected — send immediately
    if (tabState?.terminal?._ws?.readyState === WebSocket.OPEN) {
      tabState.terminal.sendInput(data);
      return;
    }

    // Tab doesn't exist or terminal not connected — switch to it to trigger init
    const prevTabKey = activeTabKey;
    switchToTab(tabKey);

    // Wait for the WebSocket connection then send
    const maxWait = 5000;
    const interval = 100;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += interval;
      const ts = _findTab(tabKey);
      if (ts?.terminal?._ws?.readyState === WebSocket.OPEN) {
        clearInterval(timer);
        ts.terminal.sendInput(data);
        // Switch back to the original tab
        if (prevTabKey && prevTabKey !== tabKey) {
          switchToTab(prevTabKey);
        }
      } else if (elapsed >= maxWait) {
        clearInterval(timer);
        // Timeout — switch back
        if (prevTabKey && prevTabKey !== tabKey) {
          switchToTab(prevTabKey);
        }
      }
    }, interval);
  }

  export function getToolbar() {
    return _toolbar;
  }

  export function getFileBrowsers() {
    const map = new Map();
    const tabState = _findTab('files');
    if (tabState && tabState.fileBrowser && session) {
      map.set(session, { wrapper: tabState.rootEl, browser: tabState.fileBrowser });
    }
    return map;
  }

  export function getGitBrowsers() {
    const map = new Map();
    const tabState = _findTab('git');
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
    const tabState = _findTab('files');
    if (!tabState || !tabState.fileBrowser) return null;
    return tabState.fileBrowser.getCurrentPath() || '.';
  }

  export function increaseFontSize() {
    if (viewMode === 'filebrowser') {
      const tabState = _findTab('files');
      if (tabState && tabState.fileBrowser) tabState.fileBrowser.increaseFontSize();
    } else if (viewMode === 'gitbrowser') {
      const tabState = _findTab('git');
      if (tabState && tabState.gitBrowser) tabState.gitBrowser.increaseFontSize();
    } else if (_terminal) {
      _terminal.increaseFontSize();
    }
  }

  export function decreaseFontSize() {
    if (viewMode === 'filebrowser') {
      const tabState = _findTab('files');
      if (tabState && tabState.fileBrowser) tabState.fileBrowser.decreaseFontSize();
    } else if (viewMode === 'gitbrowser') {
      const tabState = _findTab('git');
      if (tabState && tabState.gitBrowser) tabState.gitBrowser.decreaseFontSize();
    } else if (_terminal) {
      _terminal.decreaseFontSize();
    }
  }

  export function setClaudeWindow(isClaude) {
    if (_toolbar) _toolbar.setClaudeWindow(isClaude);
    for (const tabState of tabs) {
      if (tabState.toolbar && tabState.toolbar !== _toolbar) {
        tabState.toolbar.setClaudeWindow(isClaude);
      }
    }
  }

  export function toggleToolbar() {
    if (_toolbar) {
      _toolbar.toggleVisibility();
      globalUIState.toolbarVisible = _toolbar.getVisible();
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

  export function applyTerminalTheme(isDark) {
    for (const tab of tabs) {
      if (tab.type === 'terminal' && tab.terminal) {
        tab.terminal.setTheme(isDark);
      }
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
  class="panel"
  class:panel--single={layout === 'single'}
  class:panel--left={layout === 'left'}
  class:panel--right={layout === 'right'}
  class:panel--focused={_focused}
  class:panel--collapsed={collapsed}
  data-panel-id={id}
  bind:this={_el}
  onmousedown={handleMouseDown}
  ontouchstart={handleTouchStart}
>
  <div class="panel-header" style:display={layout === 'single' ? 'none' : ''} bind:this={_headerEl}>
    <span class="panel-header-title" bind:this={_headerTitleEl}></span>
  </div>
  <div class="panel-content">
    {#each tabs as tab (tab.key)}
      {#if tab.type === 'terminal'}
        <div class="panel-terminal-view" class:hidden={tab.key !== activeTabKey} use:wireTerminalTab={tab}>
          <div class="panel-terminal-wrapper">
            <div class="panel-terminal-container" use:initTerminal={tab}></div>
            <div class="panel-reconnect-overlay" class:hidden={!tab.reconnecting}>
              <span class="reconnect-overlay-text">Reconnecting...</span>
            </div>
          </div>
          <IMEInputComponent
            bind:this={tab.imeInput}
            onSend={(text) => tab.terminal?.sendInput(text)}
            onToggle={(visible) => {
              tab.terminal?.setIMEMode(visible);
              requestAnimationFrame(() => tab.terminal?.fit());
            }}
          >
            {#if voiceSupported}
              <VoiceInputComponent
                bind:this={tab.voiceInput}
                onResult={(text) => { tab.imeInput?.insertText(text); tab.imeInput?.setPreviewText(''); }}
                onInterim={(text) => tab.imeInput?.setPreviewText(text)}
                lang="ja-JP"
              />
            {/if}
          </IMEInputComponent>
          <ToolbarComponent
            bind:this={tab.toolbar}
            onSendKey={(key) => tab.terminal?.sendInput(key)}
            onFetchCommands={(sess) => getCommands(sess)}
            onKeyboardMode={(mode) => {
              tab.terminal?.setKeyboardMode(mode);
              if (tab.imeInput) {
                if (mode === 'ime') tab.imeInput.show();
                else tab.imeInput.hide();
              }
              requestAnimationFrame(() => tab.terminal?.fit());
            }}
          />
        </div>
      {:else if tab.type === 'files'}
        <div class="panel-filebrowser-view" class:hidden={tab.key !== activeTabKey} use:wireFilesTab={tab}>
          <FileBrowserComponent
            bind:this={tab.fileBrowser}
            onFileSelect={(sess, filePath) => onFileBrowserPreview?.(sess, filePath)}
            onNavigate={(path) => onFileBrowserNavigate?.(session, path)}
            onPreviewClose={(sess, dirPath) => onFileBrowserPreviewClose?.(sess, dirPath)}
          />
        </div>
      {:else if tab.type === 'git'}
        <div class="panel-gitbrowser-view" class:hidden={tab.key !== activeTabKey} use:wireGitTab={tab}>
          <GitBrowserComponent
            bind:this={tab.gitBrowser}
            onNavigate={(gitState) => onGitBrowserNavigate?.(session, gitState)}
          />
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  /* Individual Panel */
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    position: relative;
    min-width: 0;
  }

  /* Single panel mode: panel takes full width */
  :global(.panel--single) {
    flex: 1;
  }

  /* Split mode panels */
  :global(.panel--left) {
    /* width set by JS via CSS variable */
    width: var(--panel-left-width, 50%);
    flex-shrink: 0;
  }

  :global(.panel--right) {
    flex: 1;
    min-width: 0;
  }

  /* Focus indicator */
  :global(.panel--focused) {
    /* no outline (was causing a visual bleed line on the adjacent panel) */
  }

  /* Panel Header (visible in split mode only) */
  .panel-header {
    display: flex;
    align-items: center;
    height: 32px;
    min-height: 32px;
    padding: 0 8px;
    background: var(--bg-panel-header);
    border-bottom: 1px solid var(--border-subtle);
    user-select: none;
    -webkit-user-select: none;
    flex-shrink: 0;
    gap: 4px;
    transition: background 0.15s, border-color 0.15s;
  }

  /* Focused panel header accent */
  :global(.panel--focused) .panel-header {
    background: var(--bg-panel-header-focused);
    border-bottom-color: var(--accent-primary);
  }

  .panel-header-title {
    font-size: 12px;
    font-weight: 500;
    color: var(--panel-header-title);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-right: auto;
    transition: color 0.15s;
  }

  :global(.panel--focused) .panel-header-title {
    color: var(--panel-header-title-focused);
  }

  /* Panel Content Areas */
  .panel-content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .panel-terminal-view {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .panel-terminal-view.hidden {
    display: none;
  }

  .panel-terminal-wrapper {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }

  .panel-terminal-container {
    position: absolute;
    inset: 0;
    overflow: hidden;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .panel-terminal-container :global(.xterm) {
    height: 100%;
  }

  .panel-reconnect-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
  }

  .panel-reconnect-overlay.hidden {
    display: none;
  }

  .panel-filebrowser-view,
  .panel-gitbrowser-view {
    height: 100%;
  }

  .panel-filebrowser-view.hidden,
  .panel-gitbrowser-view.hidden {
    display: none;
  }

  /* Light mode overrides */
  :global([data-theme="light"]) .panel-reconnect-overlay {
    background: rgba(255, 255, 255, 0.75);
  }

  /* Responsive: auto-collapse split under 900px */
  @media (max-width: 899px) {
    /* Force single panel mode */
    :global(.panel--left),
    :global(.panel--right) {
      width: 100% !important;
      flex: 1;
    }

    .panel-header {
      display: none !important;
    }

    /* Hide collapsed panel */
    :global(.panel--collapsed) {
      display: none !important;
    }
  }
</style>
