// panel-manager.js - PanelManager クラス
// パネルのライフサイクル・レイアウト・フォーカスを管理する。

import { Panel } from './panel.js';

/**
 * PanelManager は左右パネルのライフサイクル・レイアウト・フォーカスを管理する。
 */
export class PanelManager {
  /**
   * @param {object} options
   * @param {HTMLElement} options.container - パネルコンテナ要素 (#panel-container)
   * @param {object} options.globalUIState - 共有 UI 状態
   * @param {function(): boolean} options.isMobileDevice - モバイル判定
   * @param {function(string, number): void} [options.onClientStatus] - セッション/ウィンドウ変更通知
   * @param {function(Array): void} [options.onNotificationUpdate] - 通知更新
   * @param {function(string): void} [options.onConnectionStateChange] - 接続状態変更
   * @param {function(Panel): void} [options.onFocusChange] - フォーカス変更通知
   */
  constructor(options) {
    this._container = options.container;
    this._globalUIState = options.globalUIState;
    this._isMobileDevice = options.isMobileDevice;
    this._onClientStatusCb = options.onClientStatus || null;
    this._onNotificationUpdateCb = options.onNotificationUpdate || null;
    this._onConnectionStateChangeCb = options.onConnectionStateChange || null;
    this._onFocusChangeCb = options.onFocusChange || null;

    /** @type {Panel} 左パネル（常に存在） */
    this._leftPanel = null;
    /** @type {Panel|null} 右パネル（分割時のみ） */
    this._rightPanel = null;
    /** @type {Panel} フォーカス中のパネル */
    this._focusedPanel = null;
    /** @type {boolean} 分割モード */
    this._splitMode = false;
    /** @type {number} ディバイダー位置（%） */
    this._dividerPosition = this._loadDividerPosition() || 50;
    /** @type {HTMLElement|null} ディバイダー要素 */
    this._dividerEl = null;
    /** @type {function|null} リサイズハンドラ */
    this._resizeHandler = null;
    /** @type {function|null} キーボードショートカットハンドラ */
    this._keyHandler = null;

    this._init();
  }

  /**
   * 初期化: 左パネルを作成し、イベントリスナーを設定する。
   */
  _init() {
    // Left panel (always exists)
    this._leftPanel = this._createPanel('left');
    this._container.appendChild(this._leftPanel.getElement());
    this._focusedPanel = this._leftPanel;
    this._leftPanel.setFocused(true);

    // Resize handler for auto-collapse
    this._resizeHandler = () => this._handleWindowResize();
    window.addEventListener('resize', this._resizeHandler);

    // Keyboard shortcut: Ctrl+Shift+Left/Right for focus switch
    this._keyHandler = (e) => this._handleKeyboardShortcut(e);
    document.addEventListener('keydown', this._keyHandler);

    // Restore split mode from localStorage
    if (this._loadSplitMode() && window.innerWidth >= 900) {
      this.toggleSplit();
    }
  }

  /**
   * パネルを作成する。
   * @param {'left'|'right'} id
   * @returns {Panel}
   */
  _createPanel(id) {
    return new Panel({
      id,
      globalUIState: this._globalUIState,
      isMobileDevice: this._isMobileDevice,
      onFocusRequest: (panel) => this.setFocus(panel),
      onClientStatus: (session, window) => {
        if (this._onClientStatusCb) {
          this._onClientStatusCb(session, window);
        }
      },
      onNotificationUpdate: (notifications) => {
        if (this._onNotificationUpdateCb) {
          this._onNotificationUpdateCb(notifications);
        }
      },
      onConnectionStateChange: (state) => {
        if (this._onConnectionStateChangeCb) {
          this._onConnectionStateChangeCb(state);
        }
      },
    });
  }

  /**
   * 分割モードかどうかを返す。
   * @returns {boolean}
   */
  get isSplit() {
    return this._splitMode;
  }

  /**
   * フォーカス中のパネルを返す。
   * @returns {Panel}
   */
  getFocusedPanel() {
    return this._focusedPanel;
  }

  /**
   * 左パネルを返す。
   * @returns {Panel}
   */
  getLeftPanel() {
    return this._leftPanel;
  }

  /**
   * 右パネルを返す（分割時のみ）。
   * @returns {Panel|null}
   */
  getRightPanel() {
    return this._rightPanel;
  }

  /**
   * 分割モードをトグルする。
   * @param {{ skipAutoConnect?: boolean }} [opts]
   */
  toggleSplit({ skipAutoConnect = false } = {}) {
    if (this._splitMode) {
      this._unsplit();
    } else {
      this._split({ skipAutoConnect });
    }
    this._saveSplitMode();
  }

  /**
   * 分割モードに入る。
   * @param {{ skipAutoConnect?: boolean }} [opts]
   */
  _split({ skipAutoConnect = false } = {}) {
    if (this._splitMode) return;
    this._splitMode = true;

    // Update left panel layout
    this._leftPanel.getElement().classList.remove('panel--single');
    this._leftPanel.getElement().classList.add('panel--left');
    this._leftPanel.setHeaderVisible(true);

    // Create divider
    this._dividerEl = document.createElement('div');
    this._dividerEl.className = 'split-divider';
    this._container.appendChild(this._dividerEl);
    this._setupDividerDrag();

    // Create right panel
    this._rightPanel = this._createPanel('right');
    this._rightPanel.getElement().classList.remove('panel--single');
    this._rightPanel.getElement().classList.add('panel--right');
    this._rightPanel.setHeaderVisible(true);
    this._container.appendChild(this._rightPanel.getElement());

    // Apply divider position
    this._applyDividerPosition();

    // Focus stays on left panel, unfocus indicator on right
    this._rightPanel.setFocused(false);
    this._leftPanel.setFocused(true);
    this._focusedPanel = this._leftPanel;

    // Auto-connect right panel to same session if left is connected
    if (!skipAutoConnect && this._leftPanel.isConnected) {
      this._rightPanel.connectToWindow(this._leftPanel.session, this._leftPanel.windowIndex);
    }

    // Handle narrow window auto-collapse
    this._handleWindowResize();

    // Refit terminals
    requestAnimationFrame(() => {
      this._leftPanel.fit();
      if (this._rightPanel) this._rightPanel.fit();
    });

    if (this._onFocusChangeCb) {
      this._onFocusChangeCb(this._focusedPanel);
    }
  }

  /**
   * 分割モードを解除する。フォーカス中のパネルを残す。
   */
  _unsplit() {
    if (!this._splitMode) return;
    this._splitMode = false;

    // Remove divider
    if (this._dividerEl) {
      this._dividerEl.remove();
      this._dividerEl = null;
    }

    // Determine which panel to keep (focused one)
    const keepPanel = this._focusedPanel;
    const removePanel = keepPanel === this._leftPanel ? this._rightPanel : this._leftPanel;

    // If keeping right panel, swap it to left position
    if (keepPanel === this._rightPanel) {
      // Clean up old left panel
      this._leftPanel.cleanup();
      this._leftPanel.getElement().remove();

      // Move right panel to left position
      this._leftPanel = this._rightPanel;
      this._leftPanel.id = 'left'; // reassign ID
    } else {
      // Clean up right panel
      if (this._rightPanel) {
        this._rightPanel.cleanup();
        this._rightPanel.getElement().remove();
      }
    }

    this._rightPanel = null;
    this._focusedPanel = this._leftPanel;

    // Reset layout classes
    this._leftPanel.getElement().classList.remove('panel--left', 'panel--right', 'panel--collapsed');
    this._leftPanel.getElement().classList.add('panel--single');
    this._leftPanel.getElement().style.width = '';
    this._leftPanel.setHeaderVisible(false);
    this._leftPanel.setFocused(true);

    // Refit
    requestAnimationFrame(() => this._leftPanel.fit());

    if (this._onFocusChangeCb) {
      this._onFocusChangeCb(this._focusedPanel);
    }
  }

  /**
   * フォーカスを切り替える。
   */
  switchFocus() {
    if (!this._splitMode || !this._rightPanel) return;
    const next = this._focusedPanel === this._leftPanel ? this._rightPanel : this._leftPanel;
    this.setFocus(next);
  }

  /**
   * 指定パネルにフォーカスを設定する。
   * @param {Panel} panel
   */
  setFocus(panel) {
    if (this._focusedPanel === panel) return;

    if (this._focusedPanel) {
      this._focusedPanel.setFocused(false);
    }
    this._focusedPanel = panel;
    panel.setFocused(true);

    if (this._onFocusChangeCb) {
      this._onFocusChangeCb(panel);
    }
  }

  /**
   * フォーカスパネルのセッション/ウィンドウに接続する。
   * @param {string} session
   * @param {number} windowIndex
   */
  connectToWindow(session, windowIndex) {
    this._focusedPanel.connectToWindow(session, windowIndex);
  }

  /**
   * フォーカスパネルのセッション名を返す。
   * @returns {string|null}
   */
  getCurrentSession() {
    return this._focusedPanel.session;
  }

  /**
   * フォーカスパネルのウィンドウインデックスを返す。
   * @returns {number|null}
   */
  getCurrentWindowIndex() {
    return this._focusedPanel.windowIndex;
  }

  /**
   * フォーカスパネルの表示モードを返す。
   * @returns {string}
   */
  getCurrentViewMode() {
    return this._focusedPanel.viewMode;
  }

  /**
   * フォーカスパネルのターミナルを返す。
   * @returns {import('./terminal.js').PalmuxTerminal|null}
   */
  getTerminal() {
    return this._focusedPanel.getTerminal();
  }

  /**
   * フォーカスパネルのツールバーを返す。
   * @returns {import('./toolbar.js').Toolbar|null}
   */
  getToolbar() {
    return this._focusedPanel.getToolbar();
  }

  /**
   * フォーカスパネルのファイルブラウザ Map を返す。
   * @returns {Map}
   */
  getFileBrowsers() {
    return this._focusedPanel.getFileBrowsers();
  }

  /**
   * フォーカスパネルの Git ブラウザ Map を返す。
   * @returns {Map}
   */
  getGitBrowsers() {
    return this._focusedPanel.getGitBrowsers();
  }

  /**
   * ディバイダードラッグを設定する。
   */
  _setupDividerDrag() {
    if (!this._dividerEl) return;

    let startX = 0;
    let startPosition = 0;
    let containerWidth = 0;

    const onMove = (clientX) => {
      const delta = clientX - startX;
      const deltaPercent = (delta / containerWidth) * 100;
      const newPosition = Math.max(20, Math.min(80, startPosition + deltaPercent));
      this._dividerPosition = newPosition;
      this._applyDividerPosition();

      // Refit terminals
      requestAnimationFrame(() => {
        this._leftPanel.fit();
        if (this._rightPanel) this._rightPanel.fit();
      });
    };

    const onEnd = () => {
      this._dividerEl.classList.remove('split-divider--active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
      this._saveDividerPosition();
    };

    const onMouseMove = (e) => onMove(e.clientX);
    const onMouseUp = () => onEnd();
    const onTouchMove = (e) => {
      if (e.touches.length > 0) onMove(e.touches[0].clientX);
    };
    const onTouchEnd = () => onEnd();

    this._dividerEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startPosition = this._dividerPosition;
      containerWidth = this._container.offsetWidth;
      this._dividerEl.classList.add('split-divider--active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    this._dividerEl.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      startX = e.touches[0].clientX;
      startPosition = this._dividerPosition;
      containerWidth = this._container.offsetWidth;
      this._dividerEl.classList.add('split-divider--active');
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      document.addEventListener('touchmove', onTouchMove, { passive: true });
      document.addEventListener('touchend', onTouchEnd);
      document.addEventListener('touchcancel', onTouchEnd);
    });
  }

  /**
   * ディバイダー位置を CSS に反映する。
   */
  _applyDividerPosition() {
    document.documentElement.style.setProperty('--panel-left-width', this._dividerPosition + '%');
  }

  /**
   * ウィンドウリサイズ時の処理。900px 未満で自動折りたたみ。
   */
  _handleWindowResize() {
    if (!this._splitMode) return;

    const narrow = window.innerWidth < 900;

    if (narrow) {
      // Auto-collapse: hide non-focused panel
      if (this._rightPanel) {
        if (this._focusedPanel === this._leftPanel) {
          this._rightPanel.getElement().classList.add('panel--collapsed');
          this._leftPanel.getElement().classList.remove('panel--collapsed');
        } else {
          this._leftPanel.getElement().classList.add('panel--collapsed');
          this._rightPanel.getElement().classList.remove('panel--collapsed');
        }
      }
    } else {
      // Show both panels
      this._leftPanel.getElement().classList.remove('panel--collapsed');
      if (this._rightPanel) {
        this._rightPanel.getElement().classList.remove('panel--collapsed');
      }
    }

    // Refit visible panels
    requestAnimationFrame(() => {
      this._leftPanel.fit();
      if (this._rightPanel) this._rightPanel.fit();
    });
  }

  /**
   * キーボードショートカット（Ctrl+Shift+Left/Right）でフォーカス切り替え。
   * @param {KeyboardEvent} e
   */
  _handleKeyboardShortcut(e) {
    if (!this._splitMode) return;
    if (!e.ctrlKey || !e.shiftKey) return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      this.switchFocus();
    }
  }

  /**
   * 全リソースをクリーンアップする。
   */
  cleanup() {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    if (this._leftPanel) {
      this._leftPanel.cleanup();
    }
    if (this._rightPanel) {
      this._rightPanel.cleanup();
    }
  }

  // --- localStorage ---

  /**
   * ディバイダー位置を保存する。
   */
  _saveDividerPosition() {
    try {
      localStorage.setItem('palmux-divider-position', String(this._dividerPosition));
    } catch (e) { /* ignored */ }
  }

  /**
   * ディバイダー位置を復元する。
   * @returns {number|null}
   */
  _loadDividerPosition() {
    try {
      const saved = localStorage.getItem('palmux-divider-position');
      if (saved) {
        const pos = parseFloat(saved);
        if (pos >= 20 && pos <= 80) return pos;
      }
      return null;
    } catch (e) { return null; }
  }

  /**
   * 分割モードを保存する。
   */
  _saveSplitMode() {
    try {
      localStorage.setItem('palmux-split-mode', this._splitMode ? '1' : '0');
    } catch (e) { /* ignored */ }
  }

  /**
   * 分割モードを復元する。
   * @returns {boolean}
   */
  _loadSplitMode() {
    try {
      return localStorage.getItem('palmux-split-mode') === '1';
    } catch (e) { return false; }
  }
}
