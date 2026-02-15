// drawer.js - セッション/ウィンドウ Drawer UI
// ハンバーガーメニューからスライドインし、セッション/ウィンドウの切り替えを行う

import { listSessions, listWindows } from './api.js';

/**
 * Drawer はセッション/ウィンドウ切り替え用のスライドインパネル。
 *
 * - ハンバーガーメニュー (☰) タップで左からスライドイン
 * - セッション一覧を折りたたみ式で表示
 * - ウィンドウをタップで同一セッション内のウィンドウ切り替え（tmux select-window）
 * - セッションをタップで別セッションに切り替え（WebSocket 再接続）
 * - drawer 外タップまたはスワイプで閉じる
 * - 開くたびに API から最新データを取得
 */
export class Drawer {
  /**
   * @param {Object} options
   * @param {function(string, number): void} options.onSelectWindow - ウィンドウ選択時のコールバック (session, windowIndex)
   * @param {function(string, number): void} options.onSelectSession - 別セッション選択時のコールバック (sessionName, windowIndex)
   */
  constructor(options) {
    this._onSelectWindow = options.onSelectWindow;
    this._onSelectSession = options.onSelectSession;
    this._visible = false;
    this._currentSession = null;
    this._currentWindowIndex = null;
    /** @type {Set<string>} 展開中のセッション名 */
    this._expandedSessions = new Set();
    /** @type {Array} キャッシュ済みセッションデータ */
    this._sessions = [];
    /** @type {Object<string, Array>} セッション名 -> ウィンドウ一覧 */
    this._windowsCache = {};

    this._el = document.getElementById('drawer');
    this._overlay = document.getElementById('drawer-overlay');
    this._content = document.getElementById('drawer-content');

    this._setupEvents();
  }

  /**
   * イベントリスナーを設定する。
   */
  _setupEvents() {
    // overlay タップで閉じる
    this._overlay.addEventListener('click', () => {
      this.close();
    });

    // スワイプで閉じる (左スワイプ)
    let touchStartX = 0;
    let touchStartY = 0;
    this._el.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    this._el.addEventListener('touchend', (e) => {
      if (e.changedTouches.length === 0) return;
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = Math.abs(touchEndY - touchStartY);
      // 左方向に 80px 以上スワイプかつ水平方向が垂直方向より大きい場合、閉じる
      if (deltaX < -80 && deltaY < Math.abs(deltaX)) {
        this.close();
      }
    }, { passive: true });
  }

  /**
   * Drawer を開く。最新のセッション一覧を API から取得する。
   */
  async open() {
    this._visible = true;
    this._el.classList.add('drawer--open');
    this._overlay.classList.add('drawer-overlay--visible');

    // 現在のセッションは自動展開
    if (this._currentSession) {
      this._expandedSessions.add(this._currentSession);
    }

    // ローディング表示
    this._content.innerHTML = '<div class="drawer-loading">Loading...</div>';

    try {
      await this._loadSessions();
      // 現在のセッションのウィンドウ一覧を事前ロード
      if (this._currentSession) {
        await this._loadWindows(this._currentSession).catch(() => {});
      }
      this._renderContent();
    } catch (err) {
      console.error('Failed to load sessions for drawer:', err);
      this._content.innerHTML = '<div class="drawer-error">Failed to load sessions</div>';
    }
  }

  /**
   * Drawer を閉じる。
   */
  close() {
    this._visible = false;
    this._el.classList.remove('drawer--open');
    this._overlay.classList.remove('drawer-overlay--visible');
  }

  /**
   * Drawer が開いているか。
   * @returns {boolean}
   */
  get isOpen() {
    return this._visible;
  }

  /**
   * 現在のセッション/ウィンドウを設定する。
   * @param {string} session - セッション名
   * @param {number} windowIndex - ウィンドウインデックス
   */
  setCurrent(session, windowIndex) {
    this._currentSession = session;
    this._currentWindowIndex = windowIndex;
  }

  /**
   * セッション一覧を API から取得する。
   */
  async _loadSessions() {
    this._sessions = await listSessions() || [];
    this._windowsCache = {};
  }

  /**
   * 指定セッションのウィンドウ一覧をロードする。
   * @param {string} sessionName
   * @returns {Promise<Array>}
   */
  async _loadWindows(sessionName) {
    if (this._windowsCache[sessionName]) {
      return this._windowsCache[sessionName];
    }
    const windows = await listWindows(sessionName) || [];
    this._windowsCache[sessionName] = windows;
    return windows;
  }

  /**
   * Drawer の内容を描画する。
   */
  _renderContent() {
    this._content.innerHTML = '';

    if (this._sessions.length === 0) {
      this._content.innerHTML = '<div class="drawer-empty">No sessions</div>';
      return;
    }

    for (const session of this._sessions) {
      const sessionEl = this._createSessionElement(session);
      this._content.appendChild(sessionEl);
    }
  }

  /**
   * セッション要素を作成する。
   * @param {Object} session - セッション情報
   * @returns {HTMLElement}
   */
  _createSessionElement(session) {
    const wrapper = document.createElement('div');
    wrapper.className = 'drawer-session';

    const isExpanded = this._expandedSessions.has(session.name);
    const isCurrent = session.name === this._currentSession;

    // セッションヘッダー
    const header = document.createElement('div');
    header.className = 'drawer-session-header';
    if (isCurrent) {
      header.classList.add('drawer-session-header--current');
    }

    const arrow = document.createElement('span');
    arrow.className = 'drawer-session-arrow';
    arrow.textContent = isExpanded ? '\u25BC' : '\u25B6';

    const name = document.createElement('span');
    name.className = 'drawer-session-name';
    name.textContent = session.name;

    header.appendChild(arrow);
    header.appendChild(name);

    // セッションヘッダーのクリックで展開/折りたたみ
    header.addEventListener('click', async () => {
      if (this._expandedSessions.has(session.name)) {
        this._expandedSessions.delete(session.name);
        this._renderContent();
      } else {
        this._expandedSessions.add(session.name);
        // ウィンドウ一覧をロード
        try {
          await this._loadWindows(session.name);
        } catch (err) {
          console.error('Failed to load windows:', err);
        }
        this._renderContent();
      }
    });

    wrapper.appendChild(header);

    // 展開中の場合、ウィンドウ一覧を表示
    if (isExpanded) {
      const windowsList = document.createElement('div');
      windowsList.className = 'drawer-windows';

      const windows = this._windowsCache[session.name] || [];

      if (windows.length === 0) {
        const loading = document.createElement('div');
        loading.className = 'drawer-window-loading';
        loading.textContent = 'Loading windows...';
        windowsList.appendChild(loading);

        // 非同期でウィンドウ取得してから再描画
        this._loadWindows(session.name).then(() => {
          this._renderContent();
        }).catch((err) => {
          console.error('Failed to load windows:', err);
        });
      } else {
        for (const win of windows) {
          const winEl = this._createWindowElement(session.name, win);
          windowsList.appendChild(winEl);
        }
      }

      wrapper.appendChild(windowsList);
    }

    return wrapper;
  }

  /**
   * ウィンドウ要素を作成する。
   * @param {string} sessionName - セッション名
   * @param {Object} win - ウィンドウ情報
   * @returns {HTMLElement}
   */
  _createWindowElement(sessionName, win) {
    const el = document.createElement('div');
    el.className = 'drawer-window-item';

    const isCurrent = sessionName === this._currentSession &&
                      win.index === this._currentWindowIndex;
    if (isCurrent) {
      el.classList.add('drawer-window-item--current');
    }

    const nameEl = document.createElement('span');
    nameEl.className = 'drawer-window-name';
    nameEl.textContent = `${win.index}: ${win.name}`;

    el.appendChild(nameEl);

    if (win.active || isCurrent) {
      const indicator = document.createElement('span');
      indicator.className = 'drawer-window-active';
      indicator.textContent = '\u25CF';
      el.appendChild(indicator);
    }

    // ウィンドウタップでの挙動
    el.addEventListener('click', () => {
      if (sessionName === this._currentSession) {
        // 同じセッション内: ウィンドウ切り替え
        this._onSelectWindow(sessionName, win.index);
      } else {
        // 別セッション: セッション切り替え + ウィンドウ選択
        this._onSelectSession(sessionName, win.index);
      }
      this._currentSession = sessionName;
      this._currentWindowIndex = win.index;
      this.close();
    });

    return el;
  }

  /**
   * リソースを解放する。
   */
  dispose() {
    this._content.innerHTML = '';
    this._sessions = [];
    this._windowsCache = {};
    this._expandedSessions.clear();
  }
}
