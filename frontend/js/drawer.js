// drawer.js - セッション/ウィンドウ Drawer UI
// ハンバーガーメニューからスライドインし、セッション/ウィンドウの切り替えを行う
// セッション作成・削除機能を含む

import { listSessions, listWindows, createSession, deleteSession } from './api.js';

/**
 * Drawer はセッション/ウィンドウ切り替え用のスライドインパネル。
 *
 * - ハンバーガーメニュー (☰) タップで左からスライドイン
 * - セッション一覧を折りたたみ式で表示
 * - ウィンドウをタップで同一セッション内のウィンドウ切り替え（tmux select-window）
 * - セッションをタップで別セッションに切り替え（WebSocket 再接続）
 * - drawer 外タップまたはスワイプで閉じる
 * - 開くたびに API から最新データを取得
 * - [New Session] ボタンでセッション作成
 * - セッション長押しで削除オプション表示
 */
export class Drawer {
  /**
   * @param {Object} options
   * @param {function(string, number): void} options.onSelectWindow - ウィンドウ選択時のコールバック (session, windowIndex)
   * @param {function(string, number): void} options.onSelectSession - 別セッション選択時のコールバック (sessionName, windowIndex)
   * @param {function(string): void} [options.onCreateSession] - セッション作成後のコールバック (sessionName)
   * @param {function(): void} [options.onDeleteSession] - セッション削除後のコールバック
   */
  constructor(options) {
    this._onSelectWindow = options.onSelectWindow;
    this._onSelectSession = options.onSelectSession;
    this._onCreateSession = options.onCreateSession || null;
    this._onDeleteSession = options.onDeleteSession || null;
    this._visible = false;
    this._currentSession = null;
    this._currentWindowIndex = null;
    /** @type {Set<string>} 展開中のセッション名 */
    this._expandedSessions = new Set();
    /** @type {Array} キャッシュ済みセッションデータ */
    this._sessions = [];
    /** @type {Object<string, Array>} セッション名 -> ウィンドウ一覧 */
    this._windowsCache = {};

    /** @type {number|null} 長押しタイマー ID */
    this._longPressTimer = null;
    /** @type {boolean} 長押し検出フラグ（クリックイベント抑制用） */
    this._longPressDetected = false;
    /** @type {boolean} セッション作成中フラグ */
    this._creating = false;

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
    this._clearLongPressTimer();
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
      const emptyEl = document.createElement('div');
      emptyEl.className = 'drawer-empty';
      emptyEl.textContent = 'No sessions';
      this._content.appendChild(emptyEl);
    } else {
      for (const session of this._sessions) {
        const sessionEl = this._createSessionElement(session);
        this._content.appendChild(sessionEl);
      }
    }

    // [New Session] ボタンを常に表示
    const newSessionBtn = this._createNewSessionButton();
    this._content.appendChild(newSessionBtn);
  }

  /**
   * [New Session] ボタンとインライン入力フォームを作成する。
   * @returns {HTMLElement}
   */
  _createNewSessionButton() {
    const container = document.createElement('div');
    container.className = 'drawer-new-session';

    const btn = document.createElement('button');
    btn.className = 'drawer-new-session-btn';
    btn.textContent = '+ New Session';
    btn.addEventListener('click', () => {
      this._showNewSessionInput(container, btn);
    });

    container.appendChild(btn);
    return container;
  }

  /**
   * セッション名入力フォームを表示する。
   * @param {HTMLElement} container - 親コンテナ
   * @param {HTMLElement} btn - トグルボタン（非表示にする）
   */
  _showNewSessionInput(container, btn) {
    // 既に入力フォームが表示中なら何もしない
    if (container.querySelector('.drawer-new-session-form')) {
      return;
    }

    btn.style.display = 'none';

    const form = document.createElement('div');
    form.className = 'drawer-new-session-form';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'drawer-new-session-input';
    input.placeholder = 'Session name';
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;

    const actions = document.createElement('div');
    actions.className = 'drawer-new-session-actions';

    const createBtn = document.createElement('button');
    createBtn.className = 'drawer-new-session-create';
    createBtn.textContent = 'Create';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'drawer-new-session-cancel';
    cancelBtn.textContent = 'Cancel';

    const errorEl = document.createElement('div');
    errorEl.className = 'drawer-inline-error';
    errorEl.style.display = 'none';

    actions.appendChild(cancelBtn);
    actions.appendChild(createBtn);
    form.appendChild(input);
    form.appendChild(actions);
    form.appendChild(errorEl);
    container.appendChild(form);

    // フォーカスを入力欄に
    input.focus();

    // Enter で作成
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._handleCreateSession(input, errorEl, container, btn, form);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._hideNewSessionInput(container, btn, form);
      }
    });

    // Create ボタンのクリック
    createBtn.addEventListener('click', () => {
      this._handleCreateSession(input, errorEl, container, btn, form);
    });

    // Cancel ボタンのクリック
    cancelBtn.addEventListener('click', () => {
      this._hideNewSessionInput(container, btn, form);
    });
  }

  /**
   * セッション名入力フォームを非表示にする。
   * @param {HTMLElement} container
   * @param {HTMLElement} btn
   * @param {HTMLElement} form
   */
  _hideNewSessionInput(container, btn, form) {
    form.remove();
    btn.style.display = '';
  }

  /**
   * セッション作成を実行する。
   * @param {HTMLInputElement} input
   * @param {HTMLElement} errorEl
   * @param {HTMLElement} container
   * @param {HTMLElement} btn
   * @param {HTMLElement} form
   */
  async _handleCreateSession(input, errorEl, container, btn, form) {
    if (this._creating) return;

    const name = input.value.trim();

    // バリデーション: 空のセッション名
    if (!name) {
      this._showInlineError(errorEl, 'Session name cannot be empty');
      input.focus();
      return;
    }

    // バリデーション: 既存名の重複チェック
    const duplicate = this._sessions.some((s) => s.name === name);
    if (duplicate) {
      this._showInlineError(errorEl, `Session "${name}" already exists`);
      input.focus();
      return;
    }

    this._creating = true;
    errorEl.style.display = 'none';
    input.disabled = true;

    try {
      await createSession(name);
      this._creating = false;

      // フォームを閉じる
      this._hideNewSessionInput(container, btn, form);

      // セッション一覧を再取得
      await this._loadSessions();
      this._renderContent();

      // コールバックで新セッションに自動接続
      if (this._onCreateSession) {
        this._onCreateSession(name);
        this.close();
      }
    } catch (err) {
      this._creating = false;
      input.disabled = false;
      console.error('Failed to create session:', err);
      this._showInlineError(errorEl, `Failed to create session: ${err.message}`);
      input.focus();
    }
  }

  /**
   * インラインエラーメッセージを表示する。
   * @param {HTMLElement} errorEl
   * @param {string} message
   */
  _showInlineError(errorEl, message) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
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

    // 長押しで削除オプション表示
    this._setupLongPress(header, session);

    // セッションヘッダーのクリックで展開/折りたたみ
    header.addEventListener('click', async (e) => {
      // 長押し後のクリックイベントは無視
      if (this._longPressDetected) {
        this._longPressDetected = false;
        return;
      }

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
   * セッションヘッダーに長押し検出を設定する。
   * 500ms の長押しで削除確認モーダルを表示する。
   * @param {HTMLElement} header - セッションヘッダー要素
   * @param {Object} session - セッション情報
   */
  _setupLongPress(header, session) {
    let startX = 0;
    let startY = 0;

    header.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      this._longPressDetected = false;

      this._longPressTimer = window.setTimeout(() => {
        this._longPressDetected = true;
        this._showDeleteConfirmation(session);
      }, 500);
    }, { passive: true });

    header.addEventListener('touchmove', (e) => {
      if (this._longPressTimer !== null) {
        const moveX = e.touches[0].clientX;
        const moveY = e.touches[0].clientY;
        // 10px 以上動いたら長押しキャンセル
        if (Math.abs(moveX - startX) > 10 || Math.abs(moveY - startY) > 10) {
          this._clearLongPressTimer();
        }
      }
    }, { passive: true });

    header.addEventListener('touchend', () => {
      this._clearLongPressTimer();
    }, { passive: true });

    header.addEventListener('touchcancel', () => {
      this._clearLongPressTimer();
    }, { passive: true });

    // デスクトップ: 右クリック（contextmenu）でも削除オプション表示
    header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._showDeleteConfirmation(session);
    });
  }

  /**
   * 長押しタイマーをクリアする。
   */
  _clearLongPressTimer() {
    if (this._longPressTimer !== null) {
      window.clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  }

  /**
   * 削除確認モーダルを表示する。
   * @param {Object} session - 削除対象セッション
   */
  _showDeleteConfirmation(session) {
    // 既にモーダルが表示中なら除去
    const existing = document.querySelector('.drawer-delete-modal-overlay');
    if (existing) {
      existing.remove();
    }

    // 現在接続中のセッションは削除不可
    if (session.name === this._currentSession) {
      this._showDeleteError('Cannot delete the currently connected session');
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'drawer-delete-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'drawer-delete-modal';

    const message = document.createElement('div');
    message.className = 'drawer-delete-modal-message';
    message.textContent = `Delete session "${session.name}"?`;

    const actions = document.createElement('div');
    actions.className = 'drawer-delete-modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'drawer-delete-modal-cancel';
    cancelBtn.textContent = 'Cancel';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'drawer-delete-modal-delete';
    deleteBtn.textContent = 'Delete';

    actions.appendChild(cancelBtn);
    actions.appendChild(deleteBtn);
    modal.appendChild(message);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // モーダル表示アニメーション
    requestAnimationFrame(() => {
      overlay.classList.add('drawer-delete-modal-overlay--visible');
    });

    const closeModal = () => {
      overlay.classList.remove('drawer-delete-modal-overlay--visible');
      // トランジション後に除去
      setTimeout(() => {
        overlay.remove();
      }, 200);
    };

    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal();
      }
    });

    deleteBtn.addEventListener('click', async () => {
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';

      try {
        await deleteSession(session.name);
        closeModal();

        // セッション一覧を再取得して描画
        await this._loadSessions();
        this._expandedSessions.delete(session.name);
        this._renderContent();

        // コールバック呼び出し
        if (this._onDeleteSession) {
          this._onDeleteSession();
        }
      } catch (err) {
        console.error('Failed to delete session:', err);
        closeModal();
        this._showDeleteError(`Failed to delete session: ${err.message}`);
      }
    });
  }

  /**
   * 削除に関するエラーメッセージを一時的に表示する。
   * @param {string} message
   */
  _showDeleteError(message) {
    // 既存のエラーを除去
    const existing = document.querySelector('.drawer-toast');
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'drawer-toast drawer-toast--error';
    toast.textContent = message;
    document.body.appendChild(toast);

    // 表示アニメーション
    requestAnimationFrame(() => {
      toast.classList.add('drawer-toast--visible');
    });

    // 3秒後に自動消去
    setTimeout(() => {
      toast.classList.remove('drawer-toast--visible');
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3000);
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
    this._clearLongPressTimer();

    // 残っているモーダル/トーストを除去
    const modal = document.querySelector('.drawer-delete-modal-overlay');
    if (modal) modal.remove();
    const toast = document.querySelector('.drawer-toast');
    if (toast) toast.remove();
  }
}
