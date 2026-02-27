// panel.js - Panel クラス
// 1つのパネル（左/右）の状態と DOM をカプセル化する。
// Terminal, FileBrowser, GitBrowser, Toolbar, IME, Touch, Connection を保持。
// タブキャッシュにより、同一セッション内のタブ切り替え時にリソースを再作成しない。

import { getWebSocketURL, getCommands, listNotifications, deleteNotification } from './api.js';
import { PalmuxTerminal } from './terminal.js';
import { Toolbar } from './toolbar.js';
import { IMEInput } from './ime-input.js';
import { TouchHandler } from './touch.js';
import { ConnectionManager } from './connection.js';
import { FileBrowser } from './filebrowser.js';
import { GitBrowser } from './gitbrowser.js';

/**
 * TabState はタブキャッシュ内の1タブの状態を保持する。
 * @typedef {object} TabState
 * @property {'terminal'|'files'|'git'} type
 * @property {number|null} windowIndex - terminal タブのみ
 * @property {HTMLElement} rootEl - タブのルート要素
 * @property {PalmuxTerminal|null} terminal
 * @property {Toolbar|null} toolbar
 * @property {IMEInput|null} imeInput
 * @property {TouchHandler|null} touchHandler
 * @property {ConnectionManager|null} connectionManager
 * @property {HTMLElement|null} reconnectOverlayEl
 * @property {FileBrowser|null} fileBrowser
 * @property {GitBrowser|null} gitBrowser
 */

/**
 * Panel は左右いずれかのパネルの全状態をカプセル化する。
 * Terminal / FileBrowser / GitBrowser / Toolbar / IME / Touch / Connection を独立に管理する。
 * タブキャッシュにより、同一セッション内の複数ウィンドウ・Files・Git を高速に切り替える。
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

    /** @type {PalmuxTerminal|null} アクティブターミナルタブの terminal（files/git 表示時は最後のターミナルを保持） */
    this._terminal = null;
    /** @type {Toolbar|null} */
    this._toolbar = null;
    /** @type {IMEInput|null} */
    this._imeInput = null;
    /** @type {TouchHandler|null} */
    this._touchHandler = null;
    /** @type {ConnectionManager|null} */
    this._connectionManager = null;

    /** @type {Map<string, TabState>} タブキャッシュ (key: "terminal:0", "files", "git") */
    this._tabCache = new Map();
    /** @type {string|null} 現在アクティブなタブキー */
    this._activeTabKey = null;

    /** @type {boolean} フォーカス状態 */
    this._focused = false;

    // DOM 要素
    this._el = null;
    this._headerEl = null;
    this._headerTitleEl = null;
    this._contentEl = null;

    this._buildDOM();
  }

  /**
   * パネルの DOM 構造を動的に生成する。
   * タブの DOM は switchToTab() 経由で動的に生成される。
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
    this._el.appendChild(this._headerEl);

    // Content area (tabs are added dynamically)
    this._contentEl = document.createElement('div');
    this._contentEl.className = 'panel-content';
    this._el.appendChild(this._contentEl);
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

  // ───────── タブキャッシュ ─────────

  /**
   * 指定タブに切り替える。キャッシュヒット時は show/hide のみ。
   * @param {string} tabKey - "terminal:0", "files", "git"
   */
  switchToTab(tabKey) {
    if (this._activeTabKey === tabKey) return;

    // 現在のタブを非表示
    if (this._activeTabKey && this._tabCache.has(this._activeTabKey)) {
      this._hideTab(this._tabCache.get(this._activeTabKey));
    }

    // キャッシュにない場合は新規作成
    if (!this._tabCache.has(tabKey)) {
      const colonIdx = tabKey.indexOf(':');
      const type = colonIdx >= 0 ? tabKey.substring(0, colonIdx) : tabKey;
      const indexStr = colonIdx >= 0 ? tabKey.substring(colonIdx + 1) : null;

      switch (type) {
        case 'terminal':
          this._createTerminalTab(parseInt(indexStr, 10));
          break;
        case 'files':
          this._createFilesTab();
          break;
        case 'git':
          this._createGitTab();
          break;
      }
    }

    // 新しいタブを表示
    const tabState = this._tabCache.get(tabKey);
    this._showTab(tabState);
    this._activeTabKey = tabKey;
    this._saveLastTab();

    // Panel の公開参照を更新
    if (tabState.type === 'terminal') {
      this._terminal = tabState.terminal;
      this._toolbar = tabState.toolbar;
      this._imeInput = tabState.imeInput;
      this._touchHandler = tabState.touchHandler;
      this._connectionManager = tabState.connectionManager;
      this.windowIndex = tabState.windowIndex;
      this.viewMode = 'terminal';
    } else if (tabState.type === 'files') {
      this.viewMode = 'filebrowser';
      // _terminal 等は最後のターミナルタブのものを保持（isConnected 等で使用）
    } else if (tabState.type === 'git') {
      this.viewMode = 'gitbrowser';
    }
  }

  /**
   * アクティブなタブキーを返す。
   * @returns {string|null}
   */
  getActiveTabKey() {
    return this._activeTabKey;
  }

  /**
   * ターミナルタブを新規作成してキャッシュに追加する。
   * @param {number} windowIdx
   */
  _createTerminalTab(windowIdx) {
    const tabKey = `terminal:${windowIdx}`;

    // DOM 構造
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

    this._contentEl.appendChild(rootEl);

    // Terminal
    const terminal = new PalmuxTerminal(terminalContainerEl);

    // Client status handler
    terminal.setOnClientStatus((session, window) => {
      // アクティブタブのみ Panel 状態を更新
      if (this._activeTabKey !== tabKey) return;

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
    terminal.setOnNotificationUpdate((notifications) => {
      if (this._onNotificationUpdateCb) {
        this._onNotificationUpdateCb(notifications);
      }
    });

    // IME
    const imeInput = new IMEInput(imeContainerEl, {
      onSend: (text) => terminal.sendInput(text),
      onToggle: (visible) => {
        terminal.setIMEMode(visible);
        requestAnimationFrame(() => terminal.fit());
      },
    });

    // Toolbar
    const toolbar = new Toolbar(toolbarContainerEl, {
      onSendKey: (key) => terminal.sendInput(key),
      onFetchCommands: (session) => getCommands(session),
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
    toolbar.setCurrentSession(this.session);
    toolbar.restoreState(this._globalUIState);

    // Toolbar visibility
    if (this._globalUIState.toolbarVisible === null) {
      if (!this._isMobileDevice()) {
        toolbar.toggleVisibility();
        this._globalUIState.toolbarVisible = false;
      } else {
        this._globalUIState.toolbarVisible = true;
      }
    }

    // Keyboard mode restoration
    if (this._globalUIState.keyboardMode !== 'none') {
      terminal.setKeyboardMode(this._globalUIState.keyboardMode);
      if (this._globalUIState.keyboardMode === 'ime') {
        imeInput.show();
      }
    }

    // Touch
    const touchHandler = new TouchHandler(terminalContainerEl, {
      terminal,
      onPinchZoom: (delta) => {
        if (delta > 0) terminal.increaseFontSize();
        else terminal.decreaseFontSize();
      },
    });

    // Connection
    const connectionManager = new ConnectionManager({
      getWSUrl: () => getWebSocketURL(this.session, windowIdx),
      onStateChange: (state) => {
        // このタブ自身の再接続オーバーレイを更新
        if (state === 'connected') {
          reconnectOverlayEl.classList.add('hidden');
        } else if (state === 'connecting') {
          reconnectOverlayEl.classList.remove('hidden');
        } else {
          reconnectOverlayEl.classList.add('hidden');
        }
        if (state === 'connected') {
          deleteNotification(this.session, windowIdx)
            .then(() => listNotifications())
            .then((notifications) => {
              if (this._onNotificationUpdateCb && notifications) {
                this._onNotificationUpdateCb(notifications);
              }
            })
            .catch(() => {});
        }
        // アクティブタブのみヘッダーの接続状態を更新
        if (this._activeTabKey === tabKey && this._onConnectionStateChangeCb) {
          this._onConnectionStateChangeCb(state);
        }
      },
      terminal,
    });
    connectionManager.connect();

    // グローバルキーハンドラは無効で作成（_showTab で有効化）
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
      fileBrowser: null,
      gitBrowser: null,
    };

    this._tabCache.set(tabKey, tabState);
  }

  /**
   * ファイルブラウザタブを新規作成してキャッシュに追加する。
   * @param {string|null} [initialPath] - 初期パス
   */
  _createFilesTab(initialPath = null) {
    const rootEl = document.createElement('div');
    rootEl.className = 'panel-filebrowser-view hidden';

    const wrapper = document.createElement('div');
    wrapper.style.height = '100%';

    const browser = new FileBrowser(wrapper, {
      onFileSelect: () => {},
      onNavigate: () => {},
    });

    rootEl.appendChild(wrapper);
    this._contentEl.appendChild(rootEl);

    browser.open(this.session, initialPath || '.');

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
      fileBrowser: browser,
      gitBrowser: null,
    };

    this._tabCache.set('files', tabState);
  }

  /**
   * Git ブラウザタブを新規作成してキャッシュに追加する。
   */
  _createGitTab() {
    const rootEl = document.createElement('div');
    rootEl.className = 'panel-gitbrowser-view hidden';

    const wrapper = document.createElement('div');
    wrapper.style.height = '100%';
    wrapper.style.position = 'relative';

    const browser = new GitBrowser(wrapper, {
      onNavigate: () => {},
    });

    rootEl.appendChild(wrapper);
    this._contentEl.appendChild(rootEl);

    browser.open(this.session);

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
      fileBrowser: null,
      gitBrowser: browser,
    };

    this._tabCache.set('git', tabState);
  }

  /**
   * タブを非表示にする。
   * @param {TabState} tabState
   */
  _hideTab(tabState) {
    if (tabState.type === 'terminal') {
      this._saveToolbarState();
    }
    tabState.rootEl.classList.add('hidden');
    if (tabState.type === 'terminal' && tabState.terminal) {
      tabState.terminal.setFitEnabled(false);
      tabState.terminal.setGlobalKeyHandlerEnabled(false);
    }
  }

  /**
   * タブを表示する。
   * @param {TabState} tabState
   */
  _showTab(tabState) {
    tabState.rootEl.classList.remove('hidden');
    if (tabState.type === 'terminal' && tabState.terminal) {
      tabState.terminal.setFitEnabled(true);
      tabState.terminal.setGlobalKeyHandlerEnabled(this._focused);
      requestAnimationFrame(() => {
        tabState.terminal.fit();
        if (this._focused) tabState.terminal.focus();
      });
    }
  }

  /**
   * 全タブの WebSocket 切断・ターミナル破棄・DOM 削除を行う。
   */
  clearTabCache() {
    for (const [, tabState] of this._tabCache) {
      this._destroyTabState(tabState);
    }
    this._tabCache.clear();
    this._activeTabKey = null;
    this._terminal = null;
    this._toolbar = null;
    this._imeInput = null;
    this._touchHandler = null;
    this._connectionManager = null;
  }

  /**
   * 1つのタブの全リソースを破棄する。
   * @param {TabState} tabState
   */
  _destroyTabState(tabState) {
    if (tabState.type === 'terminal') {
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

  // ───────── 接続・ビュー切り替え ─────────

  /**
   * 指定セッション/ウィンドウに接続する。
   * @param {string} sessionName
   * @param {number} windowIdx
   */
  connectToWindow(sessionName, windowIdx) {
    if (sessionName !== this.session) {
      // セッション変更時はキャッシュをクリア
      this._saveToolbarState();
      this.clearTabCache();
    }

    this.session = sessionName;
    this.switchToTab(`terminal:${windowIdx}`);
    this._updateHeaderTitle();
  }

  /**
   * ターミナル表示に切り替える。
   */
  showTerminalView() {
    if (this.windowIndex !== null) {
      this.switchToTab(`terminal:${this.windowIndex}`);
    }
  }

  /**
   * ファイルブラウザ表示に切り替える。
   * @param {string} sessionName
   * @param {{ path?: string|null }} [opts]
   */
  showFileBrowser(sessionName, { path = null } = {}) {
    if (!this._tabCache.has('files')) {
      this._createFilesTab(path);
    } else if (path !== null) {
      const tabState = this._tabCache.get('files');
      if (tabState.fileBrowser) {
        tabState.fileBrowser.navigateTo(path);
      }
    }
    this.switchToTab('files');
  }

  /**
   * Git ブラウザ表示に切り替える。
   * @param {string} sessionName
   */
  showGitBrowser(sessionName) {
    if (!this._tabCache.has('git')) {
      this._createGitTab();
    }
    this.switchToTab('git');
  }

  // ───────── フォーカス ─────────

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

    // アクティブなターミナルタブのみキーハンドラを制御
    if (this._terminal && this.viewMode === 'terminal') {
      this._terminal.setGlobalKeyHandlerEnabled(focused);
      if (focused) {
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

  // ───────── アクセサ ─────────

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
   * タブキャッシュから動的に構築する。
   * @returns {Map<string, {wrapper: HTMLElement, browser: FileBrowser}>}
   */
  getFileBrowsers() {
    const map = new Map();
    const tabState = this._tabCache.get('files');
    if (tabState && tabState.fileBrowser && this.session) {
      map.set(this.session, { wrapper: tabState.rootEl, browser: tabState.fileBrowser });
    }
    return map;
  }

  /**
   * パネル内の Git ブラウザ Map を返す。
   * タブキャッシュから動的に構築する。
   * @returns {Map<string, {wrapper: HTMLElement, browser: GitBrowser}>}
   */
  getGitBrowsers() {
    const map = new Map();
    const tabState = this._tabCache.get('git');
    if (tabState && tabState.gitBrowser && this.session) {
      map.set(this.session, { wrapper: tabState.rootEl, browser: tabState.gitBrowser });
    }
    return map;
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
    const tabState = this._tabCache.get('files');
    if (!tabState || !tabState.fileBrowser) return null;
    return tabState.fileBrowser.getCurrentPath() || '.';
  }

  // ───────── フォントサイズ ─────────

  /**
   * フォントサイズを大きくする。
   */
  increaseFontSize() {
    if (this.viewMode === 'filebrowser') {
      const tabState = this._tabCache.get('files');
      if (tabState && tabState.fileBrowser) {
        tabState.fileBrowser.increaseFontSize();
      }
    } else if (this.viewMode === 'gitbrowser') {
      const tabState = this._tabCache.get('git');
      if (tabState && tabState.gitBrowser) {
        tabState.gitBrowser.increaseFontSize();
      }
    } else if (this._terminal) {
      this._terminal.increaseFontSize();
    }
  }

  /**
   * フォントサイズを小さくする。
   */
  decreaseFontSize() {
    if (this.viewMode === 'filebrowser') {
      const tabState = this._tabCache.get('files');
      if (tabState && tabState.fileBrowser) {
        tabState.fileBrowser.decreaseFontSize();
      }
    } else if (this.viewMode === 'gitbrowser') {
      const tabState = this._tabCache.get('git');
      if (tabState && tabState.gitBrowser) {
        tabState.gitBrowser.decreaseFontSize();
      }
    } else if (this._terminal) {
      this._terminal.decreaseFontSize();
    }
  }

  // ───────── ツールバー ─────────

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

  // ───────── クリーンアップ ─────────

  /**
   * パネル内リソースをクリーンアップする。
   */
  cleanup() {
    this._saveToolbarState();
    this.clearTabCache();
    this.session = null;
    this.windowIndex = null;
  }

  // ───────── 内部ユーティリティ ─────────

  /**
   * アクティブタブ種別を localStorage に保存する。
   */
  _saveLastTab() {
    if (!this.session || !this._activeTabKey) return;
    try {
      const type = this._activeTabKey.startsWith('terminal:') ? 'terminal' : this._activeTabKey;
      localStorage.setItem(`palmux-last-tab-${this.session}`, type);
    } catch { /* ignore */ }
  }

  /**
   * 指定セッションの最後のアクティブタブ種別を返す。
   * @param {string} sessionName
   * @returns {string|null}
   */
  static getLastTab(sessionName) {
    try {
      return localStorage.getItem(`palmux-last-tab-${sessionName}`);
    } catch { return null; }
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
   * パネルヘッダーのタイトルを更新する。
   */
  _updateHeaderTitle() {
    if (this._headerTitleEl && this.session !== null && this.windowIndex !== null) {
      this._headerTitleEl.textContent = `${this.session}:${this.windowIndex}`;
    }
  }

}
