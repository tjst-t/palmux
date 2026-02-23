// panel.js - Panel クラス
// 1つのパネル（左/右）の状態と DOM をカプセル化する。
// Terminal, FileBrowser, GitBrowser, Toolbar, IME, Touch, Connection を保持。

import { getWebSocketURL, listNotifications, deleteNotification } from './api.js';
import { PalmuxTerminal } from './terminal.js';
import { Toolbar } from './toolbar.js';
import { IMEInput } from './ime-input.js';
import { TouchHandler } from './touch.js';
import { ConnectionManager } from './connection.js';
import { FileBrowser } from './filebrowser.js';
import { GitBrowser } from './gitbrowser.js';

/**
 * Panel は左右いずれかのパネルの全状態をカプセル化する。
 * Terminal / FileBrowser / GitBrowser / Toolbar / IME / Touch / Connection を独立に管理する。
 */
export class Panel {
  /**
   * @param {object} options
   * @param {'left'|'right'} options.id - パネル ID
   * @param {object} options.globalUIState - 共有 UI 状態
   * @param {function(string): boolean} options.isMobileDevice - モバイル判定
   * @param {function(Panel): void} [options.onFocusRequest] - フォーカス要求コールバック
   * @param {function(string, number): void} [options.onClientStatus] - セッション/ウィンドウ変更通知
   * @param {function(Array): void} [options.onNotificationUpdate] - 通知更新コールバック
   * @param {function(string): void} [options.onConnectionStateChange] - 接続状態変更コールバック
   */
  constructor(options) {
    this.id = options.id;
    this._globalUIState = options.globalUIState;
    this._isMobileDevice = options.isMobileDevice;
    this._onFocusRequest = options.onFocusRequest || null;
    this._onClientStatusCb = options.onClientStatus || null;
    this._onNotificationUpdateCb = options.onNotificationUpdate || null;
    this._onConnectionStateChangeCb = options.onConnectionStateChange || null;

    /** @type {string|null} 現在接続中のセッション名 */
    this.session = null;
    /** @type {number|null} 現在接続中のウィンドウインデックス */
    this.windowIndex = null;
    /** @type {'terminal'|'filebrowser'|'gitbrowser'} 現在の表示モード */
    this.viewMode = 'terminal';

    /** @type {PalmuxTerminal|null} */
    this._terminal = null;
    /** @type {Toolbar|null} */
    this._toolbar = null;
    /** @type {IMEInput|null} */
    this._imeInput = null;
    /** @type {TouchHandler|null} */
    this._touchHandler = null;
    /** @type {ConnectionManager|null} */
    this._connectionManager = null;

    /** @type {Map<string, {wrapper: HTMLElement, browser: FileBrowser}>} */
    this._fileBrowsers = new Map();
    /** @type {Map<string, {wrapper: HTMLElement, browser: GitBrowser}>} */
    this._gitBrowsers = new Map();
    /** @type {Map<string, string>} セッションごとの表示モード */
    this._sessionViewModes = new Map();

    /** @type {boolean} フォーカス状態 */
    this._focused = false;

    // DOM 要素
    this._el = null;
    this._headerEl = null;
    this._headerTitleEl = null;
    this._contentEl = null;
    this._terminalViewEl = null;
    this._terminalWrapperEl = null;
    this._terminalContainerEl = null;
    this._reconnectOverlayEl = null;
    this._imeContainerEl = null;
    this._toolbarContainerEl = null;
    this._filebrowserViewEl = null;
    this._filebrowserContainerEl = null;
    this._gitbrowserViewEl = null;
    this._gitbrowserContainerEl = null;
    this._tabTerminalEl = null;
    this._tabFilesEl = null;
    this._tabGitEl = null;

    this._buildDOM();
  }

  /**
   * パネルの DOM 構造を動的に生成する。
   */
  _buildDOM() {
    this._el = document.createElement('div');
    this._el.className = 'panel panel--single';
    this._el.dataset.panelId = this.id;

    // クリックでフォーカス要求
    this._el.addEventListener('mousedown', () => {
      if (this._onFocusRequest) {
        this._onFocusRequest(this);
      }
    });
    this._el.addEventListener('touchstart', () => {
      if (this._onFocusRequest) {
        this._onFocusRequest(this);
      }
    }, { passive: true });

    // Panel Header (split mode only)
    this._headerEl = document.createElement('div');
    this._headerEl.className = 'panel-header';
    this._headerEl.style.display = 'none'; // hidden by default (single mode)

    this._headerTitleEl = document.createElement('span');
    this._headerTitleEl.className = 'panel-header-title';
    this._headerTitleEl.textContent = '';
    this._headerEl.appendChild(this._headerTitleEl);

    // Tab buttons [T] [F] [G]
    this._tabTerminalEl = this._createTabButton('Terminal', true,
      '<polyline points="2,4 6,7 2,10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="7" y1="10" x2="12" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>');
    this._tabFilesEl = this._createTabButton('Files', false,
      '<path d="M1.5 3.5h4l1.5 1.5h5.5v6.5h-11z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>');
    this._tabGitEl = this._createTabButton('Git', false,
      '<circle cx="4" cy="4" r="1.5" stroke="currentColor" stroke-width="1.3"/><circle cx="10" cy="4" r="1.5" stroke="currentColor" stroke-width="1.3"/><circle cx="7" cy="11" r="1.5" stroke="currentColor" stroke-width="1.3"/><line x1="4" y1="5.5" x2="7" y2="9.5" stroke="currentColor" stroke-width="1.3"/><line x1="10" y1="5.5" x2="7" y2="9.5" stroke="currentColor" stroke-width="1.3"/>');

    this._headerEl.appendChild(this._tabTerminalEl);
    this._headerEl.appendChild(this._tabFilesEl);
    this._headerEl.appendChild(this._tabGitEl);
    this._el.appendChild(this._headerEl);

    // Tab click handlers
    this._tabTerminalEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.viewMode !== 'terminal' && this.session) {
        this.showTerminalView();
      }
    });
    this._tabFilesEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.viewMode !== 'filebrowser' && this.session) {
        this.showFileBrowser(this.session);
      }
    });
    this._tabGitEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.viewMode !== 'gitbrowser' && this.session) {
        this.showGitBrowser(this.session);
      }
    });

    // Content area
    this._contentEl = document.createElement('div');
    this._contentEl.className = 'panel-content';

    // Terminal view
    this._terminalViewEl = document.createElement('div');
    this._terminalViewEl.className = 'panel-terminal-view';

    this._terminalWrapperEl = document.createElement('div');
    this._terminalWrapperEl.className = 'panel-terminal-wrapper';

    this._terminalContainerEl = document.createElement('div');
    this._terminalContainerEl.className = 'panel-terminal-container';

    this._reconnectOverlayEl = document.createElement('div');
    this._reconnectOverlayEl.className = 'panel-reconnect-overlay hidden';
    const reconnectText = document.createElement('span');
    reconnectText.className = 'reconnect-overlay-text';
    reconnectText.textContent = 'Reconnecting...';
    this._reconnectOverlayEl.appendChild(reconnectText);

    this._terminalWrapperEl.appendChild(this._terminalContainerEl);
    this._terminalWrapperEl.appendChild(this._reconnectOverlayEl);

    this._imeContainerEl = document.createElement('div');
    this._toolbarContainerEl = document.createElement('div');

    this._terminalViewEl.appendChild(this._terminalWrapperEl);
    this._terminalViewEl.appendChild(this._imeContainerEl);
    this._terminalViewEl.appendChild(this._toolbarContainerEl);

    // File browser view
    this._filebrowserViewEl = document.createElement('div');
    this._filebrowserViewEl.className = 'panel-filebrowser-view hidden';
    this._filebrowserContainerEl = document.createElement('div');
    this._filebrowserContainerEl.style.height = '100%';
    this._filebrowserViewEl.appendChild(this._filebrowserContainerEl);

    // Git browser view
    this._gitbrowserViewEl = document.createElement('div');
    this._gitbrowserViewEl.className = 'panel-gitbrowser-view hidden';
    this._gitbrowserContainerEl = document.createElement('div');
    this._gitbrowserContainerEl.style.height = '100%';
    this._gitbrowserContainerEl.style.position = 'relative';
    this._gitbrowserViewEl.appendChild(this._gitbrowserContainerEl);

    this._contentEl.appendChild(this._terminalViewEl);
    this._contentEl.appendChild(this._filebrowserViewEl);
    this._contentEl.appendChild(this._gitbrowserViewEl);
    this._el.appendChild(this._contentEl);
  }

  /**
   * パネルヘッダーのタブボタンを作成する。
   * @param {string} label - aria-label
   * @param {boolean} active - 初期アクティブ状態
   * @param {string} svgContent - SVG の内部コンテンツ
   * @returns {HTMLButtonElement}
   */
  _createTabButton(label, active, svgContent) {
    const btn = document.createElement('button');
    btn.className = 'panel-tab-btn' + (active ? ' panel-tab-btn--active' : '');
    btn.setAttribute('aria-label', label);
    btn.innerHTML = `<svg class="panel-tab-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${svgContent}</svg>`;
    return btn;
  }

  /**
   * パネルのルート DOM 要素を返す。
   * @returns {HTMLElement}
   */
  getElement() {
    return this._el;
  }

  /**
   * パネルヘッダーの表示/非表示を切り替える。
   * @param {boolean} visible
   */
  setHeaderVisible(visible) {
    this._headerEl.style.display = visible ? '' : 'none';
  }

  /**
   * 指定セッション/ウィンドウに接続する。
   * @param {string} sessionName
   * @param {number} windowIdx
   */
  connectToWindow(sessionName, windowIdx) {
    // 状態を保存してからクリーンアップ
    this._saveToolbarState();
    this._cleanupCurrent();

    this.session = sessionName;
    this.windowIndex = windowIdx;
    this.viewMode = 'terminal';

    this._updateHeaderTitle();
    this._updateTabState();

    // Terminal
    this._terminal = new PalmuxTerminal(this._terminalContainerEl);

    // Client status handler
    this._terminal.setOnClientStatus((session, window) => {
      const sessionChanged = session !== this.session;
      const windowChanged = window !== this.windowIndex;
      if (!sessionChanged && !windowChanged) return;
      this.session = session;
      this.windowIndex = window;
      this._updateHeaderTitle();

      if (this._onClientStatusCb) {
        this._onClientStatusCb(session, window);
      }
    });

    // Notification handler
    this._terminal.setOnNotificationUpdate((notifications) => {
      if (this._onNotificationUpdateCb) {
        this._onNotificationUpdateCb(notifications);
      }
    });

    // IME
    this._imeInput = new IMEInput(this._imeContainerEl, {
      onSend: (text) => this._terminal.sendInput(text),
      onToggle: (visible) => {
        this._terminal.setIMEMode(visible);
        requestAnimationFrame(() => this._terminal.fit());
      },
    });

    // Toolbar
    this._toolbar = new Toolbar(this._toolbarContainerEl, {
      onSendKey: (key) => this._terminal.sendInput(key),
      onKeyboardMode: (mode) => {
        this._terminal.setKeyboardMode(mode);
        if (mode === 'ime') {
          if (this._imeInput) this._imeInput.show();
        } else {
          if (this._imeInput) this._imeInput.hide();
        }
        requestAnimationFrame(() => this._terminal.fit());
      },
    });
    this._terminal.setToolbar(this._toolbar);
    this._imeInput.setToolbar(this._toolbar);
    this._toolbar.restoreState(this._globalUIState);

    // Toolbar visibility
    if (this._globalUIState.toolbarVisible === null) {
      if (!this._isMobileDevice()) {
        this._toolbar.toggleVisibility();
        this._globalUIState.toolbarVisible = false;
      } else {
        this._globalUIState.toolbarVisible = true;
      }
    }

    // Keyboard mode restoration
    if (this._globalUIState.keyboardMode !== 'none') {
      this._terminal.setKeyboardMode(this._globalUIState.keyboardMode);
      if (this._globalUIState.keyboardMode === 'ime' && this._imeInput) {
        this._imeInput.show();
      }
    }

    // Touch
    this._touchHandler = new TouchHandler(this._terminalContainerEl, {
      terminal: this._terminal,
      onPinchZoom: (delta) => {
        if (delta > 0) this._terminal.increaseFontSize();
        else this._terminal.decreaseFontSize();
      },
    });

    // Connection
    this._connectionManager = new ConnectionManager({
      getWSUrl: () => getWebSocketURL(this.session, this.windowIndex),
      onStateChange: (state) => {
        this._updateConnectionUI(state);
        if (state === 'connected') {
          deleteNotification(this.session, this.windowIndex)
            .then(() => listNotifications())
            .then((notifications) => {
              if (this._onNotificationUpdateCb && notifications) {
                this._onNotificationUpdateCb(notifications);
              }
            })
            .catch(() => {});
        }
        if (this._onConnectionStateChangeCb) {
          this._onConnectionStateChangeCb(state);
        }
      },
      terminal: this._terminal,
    });
    this._connectionManager.connect();

    // グローバルキーハンドラの制御（フォーカス中のパネルのみ有効）
    this._terminal.setGlobalKeyHandlerEnabled(this._focused);

    // View mode restoration
    const savedViewMode = this._sessionViewModes.get(sessionName) || 'terminal';
    if (savedViewMode === 'filebrowser') {
      this.showFileBrowser(sessionName);
    } else if (savedViewMode === 'gitbrowser') {
      this.showGitBrowser(sessionName);
    } else {
      this.viewMode = 'terminal';
      this._terminalViewEl.classList.remove('hidden');
      this._filebrowserViewEl.classList.add('hidden');
      this._gitbrowserViewEl.classList.add('hidden');
      if (this._focused) {
        this._terminal.focus();
      }
    }
  }

  /**
   * ターミナル表示に切り替える。
   */
  showTerminalView() {
    this._terminalViewEl.classList.remove('hidden');
    this._filebrowserViewEl.classList.add('hidden');
    this._gitbrowserViewEl.classList.add('hidden');
    this.viewMode = 'terminal';
    if (this.session) {
      this._sessionViewModes.set(this.session, 'terminal');
    }
    this._updateTabState();
    if (this._terminal) {
      // fit を再有効化してからリサイズ
      this._terminal.setFitEnabled(true);
      requestAnimationFrame(() => {
        this._terminal.fit();
        if (this._focused) this._terminal.focus();
      });
    }
  }

  /**
   * ファイルブラウザ表示に切り替える。
   * @param {string} sessionName
   * @param {{ path?: string|null }} [opts]
   */
  showFileBrowser(sessionName, { path = null } = {}) {
    // ターミナルの fit を無効化（非表示時に 0 サイズへのリサイズを防止）
    if (this._terminal) {
      this._terminal.setFitEnabled(false);
    }
    this._terminalViewEl.classList.add('hidden');
    this._filebrowserViewEl.classList.remove('hidden');
    this._gitbrowserViewEl.classList.add('hidden');
    this.viewMode = 'filebrowser';
    this._sessionViewModes.set(sessionName, 'filebrowser');
    this._updateTabState();

    // Clear container
    while (this._filebrowserContainerEl.firstChild) {
      this._filebrowserContainerEl.removeChild(this._filebrowserContainerEl.firstChild);
    }

    if (!this._fileBrowsers.has(sessionName)) {
      const wrapper = document.createElement('div');
      wrapper.style.height = '100%';
      const browser = new FileBrowser(wrapper, {
        onFileSelect: () => {},
        onNavigate: () => {},
      });
      this._fileBrowsers.set(sessionName, { wrapper, browser });
      const initialPath = path !== null ? path : '.';
      browser.open(sessionName, initialPath);
    } else {
      const fb = this._fileBrowsers.get(sessionName);
      if (path !== null) {
        fb.browser.navigateTo(path);
      }
    }

    const entry = this._fileBrowsers.get(sessionName);
    this._filebrowserContainerEl.appendChild(entry.wrapper);
  }

  /**
   * Git ブラウザ表示に切り替える。
   * @param {string} sessionName
   */
  showGitBrowser(sessionName) {
    // ターミナルの fit を無効化（非表示時に 0 サイズへのリサイズを防止）
    if (this._terminal) {
      this._terminal.setFitEnabled(false);
    }
    this._terminalViewEl.classList.add('hidden');
    this._filebrowserViewEl.classList.add('hidden');
    this._gitbrowserViewEl.classList.remove('hidden');
    this.viewMode = 'gitbrowser';
    this._sessionViewModes.set(sessionName, 'gitbrowser');
    this._updateTabState();

    // Clear container
    while (this._gitbrowserContainerEl.firstChild) {
      this._gitbrowserContainerEl.removeChild(this._gitbrowserContainerEl.firstChild);
    }

    if (!this._gitBrowsers.has(sessionName)) {
      const wrapper = document.createElement('div');
      wrapper.style.height = '100%';
      wrapper.style.position = 'relative';
      const browser = new GitBrowser(wrapper, {
        onNavigate: () => {},
      });
      this._gitBrowsers.set(sessionName, { wrapper, browser });
      browser.open(sessionName);
    }

    const entry = this._gitBrowsers.get(sessionName);
    this._gitbrowserContainerEl.appendChild(entry.wrapper);
  }

  /**
   * フォーカス状態を設定する。
   * @param {boolean} focused
   */
  setFocused(focused) {
    this._focused = focused;
    if (focused) {
      this._el.classList.add('panel--focused');
    } else {
      this._el.classList.remove('panel--focused');
    }

    // Global key handler control
    if (this._terminal) {
      this._terminal.setGlobalKeyHandlerEnabled(focused);
      if (focused && this.viewMode === 'terminal') {
        this._terminal.focus();
      }
    }
  }

  /**
   * パネルのサイズにフィットさせる。
   * ターミナル表示中のみ fit を実行する。
   */
  fit() {
    if (this._terminal && this.viewMode === 'terminal') {
      this._terminal.fit();
    }
  }

  /**
   * パネル内のターミナルを返す。
   * @returns {PalmuxTerminal|null}
   */
  getTerminal() {
    return this._terminal;
  }

  /**
   * パネル内のツールバーを返す。
   * @returns {Toolbar|null}
   */
  getToolbar() {
    return this._toolbar;
  }

  /**
   * パネル内のファイルブラウザ Map を返す。
   * @returns {Map<string, {wrapper: HTMLElement, browser: FileBrowser}>}
   */
  getFileBrowsers() {
    return this._fileBrowsers;
  }

  /**
   * パネル内の Git ブラウザ Map を返す。
   * @returns {Map<string, {wrapper: HTMLElement, browser: GitBrowser}>}
   */
  getGitBrowsers() {
    return this._gitBrowsers;
  }

  /**
   * ConnectionManager を返す。
   * @returns {ConnectionManager|null}
   */
  getConnectionManager() {
    return this._connectionManager;
  }

  /**
   * フォーカス中かどうかを返す。
   * @returns {boolean}
   */
  get isFocused() {
    return this._focused;
  }

  /**
   * 接続中かどうかを返す。
   * @returns {boolean}
   */
  get isConnected() {
    return this.session !== null && this._terminal !== null;
  }

  /**
   * ファイルブラウザの現在のパスを返す。
   * @returns {string|null}
   */
  getCurrentFilePath() {
    if (this.viewMode !== 'filebrowser' || !this.session) return null;
    const fb = this._fileBrowsers.get(this.session);
    if (!fb) return null;
    return fb.browser.getCurrentPath() || '.';
  }

  /**
   * フォントサイズを大きくする。
   */
  increaseFontSize() {
    if (this.viewMode === 'filebrowser' && this.session && this._fileBrowsers.has(this.session)) {
      this._fileBrowsers.get(this.session).browser.increaseFontSize();
    } else if (this.viewMode === 'gitbrowser' && this.session && this._gitBrowsers.has(this.session)) {
      this._gitBrowsers.get(this.session).browser.increaseFontSize();
    } else if (this._terminal) {
      this._terminal.increaseFontSize();
    }
  }

  /**
   * フォントサイズを小さくする。
   */
  decreaseFontSize() {
    if (this.viewMode === 'filebrowser' && this.session && this._fileBrowsers.has(this.session)) {
      this._fileBrowsers.get(this.session).browser.decreaseFontSize();
    } else if (this.viewMode === 'gitbrowser' && this.session && this._gitBrowsers.has(this.session)) {
      this._gitBrowsers.get(this.session).browser.decreaseFontSize();
    } else if (this._terminal) {
      this._terminal.decreaseFontSize();
    }
  }

  /**
   * ツールバーの表示/非表示を切り替える。
   */
  toggleToolbar() {
    if (this._toolbar) {
      this._toolbar.toggleVisibility();
      this._globalUIState.toolbarVisible = this._toolbar.visible;
      if (this._terminal) {
        requestAnimationFrame(() => this._terminal.fit());
      }
    }
  }

  /**
   * 手動再接続を試行する。
   */
  reconnectNow() {
    if (this._connectionManager && this._connectionManager.state !== 'connected') {
      this._connectionManager.reconnectNow();
    }
  }

  /**
   * パネル内リソースをクリーンアップする。
   */
  cleanup() {
    this._saveToolbarState();
    this._cleanupCurrent();
    this._cleanupBrowsers();
    this._sessionViewModes.clear();
  }

  /**
   * 現在の接続をクリーンアップする（ブラウザキャッシュは保持）。
   */
  _cleanupCurrent() {
    if (this._touchHandler) {
      this._touchHandler.destroy();
      this._touchHandler = null;
    }
    if (this._imeInput) {
      this._imeInput.destroy();
      this._imeInput = null;
    }
    if (this._toolbar) {
      this._toolbar.dispose();
      this._toolbar = null;
    }
    if (this._connectionManager) {
      this._connectionManager.disconnect();
      this._connectionManager = null;
    }
    if (this._terminal) {
      this._terminal.disconnect();
      this._terminal = null;
    }
    this.session = null;
    this.windowIndex = null;
  }

  /**
   * ファイルブラウザ・Git ブラウザをクリーンアップする。
   */
  _cleanupBrowsers() {
    for (const [, entry] of this._fileBrowsers) {
      entry.browser.dispose();
    }
    this._fileBrowsers.clear();

    for (const [, entry] of this._gitBrowsers) {
      entry.browser.dispose();
    }
    this._gitBrowsers.clear();
  }

  /**
   * ツールバー状態を globalUIState に保存する。
   */
  _saveToolbarState() {
    if (this._toolbar) {
      this._globalUIState.toolbarVisible = this._toolbar.visible;
      this._globalUIState.keyboardMode = this._toolbar.keyboardMode;
      this._globalUIState.ctrlState = this._toolbar.ctrlState;
      this._globalUIState.altState = this._toolbar.altState;
    }
  }

  /**
   * 接続状態に応じて再接続オーバーレイを更新する。
   * @param {string} state - 'connected' | 'connecting' | 'disconnected'
   */
  _updateConnectionUI(state) {
    if (state === 'connected') {
      this._reconnectOverlayEl.classList.add('hidden');
    } else if (state === 'connecting') {
      this._reconnectOverlayEl.classList.remove('hidden');
    } else {
      this._reconnectOverlayEl.classList.add('hidden');
    }
  }

  /**
   * パネルヘッダーのタイトルを更新する。
   */
  _updateHeaderTitle() {
    if (this._headerTitleEl && this.session !== null && this.windowIndex !== null) {
      this._headerTitleEl.textContent = `${this.session}:${this.windowIndex}`;
    }
  }

  /**
   * パネルヘッダーのタブ状態を更新する。
   */
  _updateTabState() {
    if (!this._tabTerminalEl) return;
    this._tabTerminalEl.classList.toggle('panel-tab-btn--active', this.viewMode === 'terminal');
    this._tabFilesEl.classList.toggle('panel-tab-btn--active', this.viewMode === 'filebrowser');
    this._tabGitEl.classList.toggle('panel-tab-btn--active', this.viewMode === 'gitbrowser');
  }
}
