// drawer.js - セッション/ウィンドウ Drawer UI
// ハンバーガーメニューからスライドインし、セッション/ウィンドウの切り替えを行う
// セッション作成・削除機能を含む

import { listSessions, listWindows, createSession, deleteSession, createWindow, deleteWindow, renameWindow, listGhqRepos } from './api.js';

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
   * @param {function(string, number): void} [options.onCreateWindow] - ウィンドウ作成後のコールバック (session, windowIndex)
   * @param {function(): void} [options.onDeleteWindow] - ウィンドウ削除後のコールバック
   * @param {function(string, number, string): void} [options.onRenameWindow] - ウィンドウリネーム後のコールバック (session, windowIndex, newName)
   * @param {function(): void} [options.onClose] - Drawer が閉じた後のコールバック
   */
  constructor(options) {
    this._onSelectWindow = options.onSelectWindow;
    this._onSelectSession = options.onSelectSession;
    this._onCreateSession = options.onCreateSession || null;
    this._onDeleteSession = options.onDeleteSession || null;
    this._onCreateWindow = options.onCreateWindow || null;
    this._onDeleteWindow = options.onDeleteWindow || null;
    this._onRenameWindow = options.onRenameWindow || null;
    this._onClose = options.onClose || null;
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
    /** @type {boolean} ウィンドウ作成中フラグ */
    this._creatingWindow = false;
    /** @type {'activity'|'name'} セッション並び順 */
    this._sortOrder = 'activity';

    this._el = document.getElementById('drawer');
    this._overlay = document.getElementById('drawer-overlay');
    this._content = document.getElementById('drawer-content');
    this._sortCheckbox = document.getElementById('drawer-sort-checkbox');

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

    // ソートトグルスイッチ
    if (this._sortCheckbox) {
      this._sortCheckbox.addEventListener('change', () => {
        this._sortOrder = this._sortCheckbox.checked ? 'name' : 'activity';
        this._updateSortLabels();
        this._renderContent();
      });
    }
  }

  /**
   * Drawer を開く。最新のセッション一覧を API から取得する。
   */
  async open() {
    this._visible = true;
    this._el.classList.add('drawer--open');
    this._overlay.classList.add('drawer-overlay--visible');

    // 現在のセッションだけ自動展開（アコーディオン）
    this._expandedSessions.clear();
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
    if (this._onClose) {
      this._onClose();
    }
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
   * セッションまたはウィンドウが変わり、Drawer が開いている場合は再描画する。
   * @param {string} session - セッション名
   * @param {number} windowIndex - ウィンドウインデックス
   */
  /**
   * 現在のセッション/ウィンドウを設定する。
   * セッションまたはウィンドウが変わり、Drawer が開いている場合は再描画する。
   * @param {string} session - セッション名
   * @param {number} windowIndex - ウィンドウインデックス
   * @param {{ sessionChanged?: boolean }} [opts]
   */
  setCurrent(session, windowIndex, { sessionChanged = false } = {}) {
    const changed = (this._currentSession !== session || this._currentWindowIndex !== windowIndex);
    this._currentSession = session;
    this._currentWindowIndex = windowIndex;

    if (!changed || !this._visible) return;

    if (sessionChanged) {
      // セッション切替: セッション一覧とウィンドウ一覧を再取得して再描画
      this._expandedSessions.clear();
      this._expandedSessions.add(session);
      this._loadSessions()
        .then(() => this._loadWindows(session).catch(() => {}))
        .then(() => this._renderContent())
        .catch(() => this._renderContent());
    } else {
      // ウィンドウ切替: キャッシュの active フラグを更新して即再描画
      // （旧・新ウィンドウ両方に ● が表示される問題を回避）
      if (this._windowsCache[session]) {
        for (const w of this._windowsCache[session]) {
          w.active = (w.index === windowIndex);
        }
      }
      this._renderContent();
    }
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
   * セッションをソートして返す。元の配列は変更しない。
   * @returns {Array}
   */
  _getSortedSessions() {
    const sessions = [...this._sessions];
    if (this._sortOrder === 'name') {
      sessions.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // activity 降順（新しい順）
      sessions.sort((a, b) => new Date(b.activity) - new Date(a.activity));
    }
    return sessions;
  }

  /**
   * ソートトグルのラベルのアクティブ状態を更新する。
   */
  _updateSortLabels() {
    const labels = this._el.querySelectorAll('.drawer-sort-label');
    for (const label of labels) {
      if (label.dataset.sort === this._sortOrder) {
        label.classList.add('drawer-sort-label--active');
      } else {
        label.classList.remove('drawer-sort-label--active');
      }
    }
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
      const sorted = this._getSortedSessions();
      for (const session of sorted) {
        const sessionEl = this._createSessionElement(session);
        this._content.appendChild(sessionEl);
      }
    }

    // [New Session] ボタンを常に表示
    const newSessionBtn = this._createNewSessionButton();
    this._content.appendChild(newSessionBtn);
  }

  /**
   * [New Session] ボタンとプロジェクトピッカーを作成する。
   * @returns {HTMLElement}
   */
  _createNewSessionButton() {
    const container = document.createElement('div');
    container.className = 'drawer-new-session';

    const btn = document.createElement('button');
    btn.className = 'drawer-new-session-btn';
    btn.textContent = '+ New Session';
    btn.addEventListener('click', () => {
      this._showProjectPicker(container, btn);
    });

    container.appendChild(btn);
    return container;
  }

  /**
   * プロジェクトピッカーを表示する。
   * ghq リポジトリ一覧から未使用のプロジェクトを表示し、タップでセッション作成する。
   * ghq が利用できない場合はカスタム名入力フォームにフォールバックする。
   * @param {HTMLElement} container - 親コンテナ
   * @param {HTMLElement} btn - トグルボタン（非表示にする）
   */
  async _showProjectPicker(container, btn) {
    // 既にピッカーが表示中なら何もしない
    if (container.querySelector('.drawer-project-picker')) {
      return;
    }

    btn.style.display = 'none';

    const picker = document.createElement('div');
    picker.className = 'drawer-project-picker';

    // ローディング表示
    const loadingEl = document.createElement('div');
    loadingEl.className = 'drawer-project-picker-loading';
    loadingEl.textContent = 'Loading projects...';
    picker.appendChild(loadingEl);
    container.appendChild(picker);

    let repos = [];
    try {
      repos = await listGhqRepos() || [];
    } catch (err) {
      console.error('Failed to load ghq repos:', err);
    }

    // ローディング除去
    loadingEl.remove();

    // 既存セッション名のセット
    const existingNames = new Set(this._sessions.map((s) => s.name));

    // 未使用のリポジトリだけ残す
    const availableRepos = repos.filter((r) => !existingNames.has(r.name));

    // ghq リポジトリがない場合はカスタム名入力に直接遷移
    if (availableRepos.length === 0 && repos.length === 0) {
      picker.remove();
      this._showCustomNameInput(container, btn);
      return;
    }

    this._renderProjectPickerContent(picker, availableRepos, container, btn);
  }

  /**
   * プロジェクトピッカーの内容を描画する。
   * @param {HTMLElement} picker - ピッカーコンテナ
   * @param {Array} availableRepos - 利用可能なリポジトリ
   * @param {HTMLElement} container - 親コンテナ
   * @param {HTMLElement} btn - トグルボタン
   */
  _renderProjectPickerContent(picker, availableRepos, container, btn) {
    picker.innerHTML = '';

    // フィルター入力
    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.className = 'drawer-project-picker-filter';
    filterInput.placeholder = 'Filter projects...';
    filterInput.autocomplete = 'off';
    filterInput.autocapitalize = 'off';
    filterInput.spellcheck = false;
    picker.appendChild(filterInput);

    // プロジェクトリスト
    const listEl = document.createElement('div');
    listEl.className = 'drawer-project-picker-list';
    picker.appendChild(listEl);

    const renderList = (filter) => {
      listEl.innerHTML = '';

      const filtered = filter
        ? availableRepos.filter((r) =>
            r.name.toLowerCase().includes(filter) ||
            r.path.toLowerCase().includes(filter)
          )
        : availableRepos;

      if (filtered.length === 0 && availableRepos.length > 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'drawer-project-picker-empty';
        emptyEl.textContent = 'No matching projects';
        listEl.appendChild(emptyEl);
      } else if (filtered.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'drawer-project-picker-empty';
        emptyEl.textContent = 'All projects already have sessions';
        listEl.appendChild(emptyEl);
      } else {
        for (const repo of filtered) {
          const item = this._createProjectPickerItem(repo, container, btn, picker);
          listEl.appendChild(item);
        }
      }
    };

    renderList('');

    // フィルター入力イベント
    filterInput.addEventListener('input', () => {
      renderList(filterInput.value.trim().toLowerCase());
    });

    // Escape でピッカーを閉じる
    filterInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this._hideProjectPicker(container, btn, picker);
      }
    });

    // Custom name ボタン
    const customBtn = document.createElement('div');
    customBtn.className = 'drawer-project-picker-custom';
    customBtn.textContent = 'Custom name...';
    customBtn.addEventListener('click', () => {
      picker.remove();
      this._showCustomNameInput(container, btn);
    });
    picker.appendChild(customBtn);

    // Cancel ボタン
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'drawer-new-session-cancel drawer-project-picker-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      this._hideProjectPicker(container, btn, picker);
    });
    picker.appendChild(cancelBtn);
  }

  /**
   * プロジェクトピッカーの項目を作成する。
   * @param {Object} repo - リポジトリ情報 {name, path, full_path}
   * @param {HTMLElement} container - 親コンテナ
   * @param {HTMLElement} btn - トグルボタン
   * @param {HTMLElement} picker - ピッカーコンテナ
   * @returns {HTMLElement}
   */
  _createProjectPickerItem(repo, container, btn, picker) {
    const item = document.createElement('div');
    item.className = 'drawer-project-picker-item';

    const nameEl = document.createElement('div');
    nameEl.className = 'drawer-project-picker-item-name';
    nameEl.textContent = repo.name;

    const pathEl = document.createElement('div');
    pathEl.className = 'drawer-project-picker-item-path';
    pathEl.textContent = repo.path;

    item.appendChild(nameEl);
    item.appendChild(pathEl);

    item.addEventListener('click', () => {
      this._handleCreateSessionFromPicker(repo.name, item, container, btn, picker);
    });

    return item;
  }

  /**
   * プロジェクトピッカーからセッションを作成する。
   * @param {string} name - セッション名
   * @param {HTMLElement} item - クリックされた項目
   * @param {HTMLElement} container - 親コンテナ
   * @param {HTMLElement} btn - トグルボタン
   * @param {HTMLElement} picker - ピッカーコンテナ
   */
  async _handleCreateSessionFromPicker(name, item, container, btn, picker) {
    if (this._creating) return;
    this._creating = true;

    item.classList.add('drawer-project-picker-item--creating');
    item.textContent = 'Creating...';

    try {
      await createSession(name);
      this._creating = false;

      // ピッカーを閉じる
      this._hideProjectPicker(container, btn, picker);

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
      console.error('Failed to create session:', err);
      this._showDeleteError(`Failed to create session: ${err.message}`);
      // 項目を元に戻す
      item.classList.remove('drawer-project-picker-item--creating');
      item.textContent = '';
      const nameEl = document.createElement('div');
      nameEl.className = 'drawer-project-picker-item-name';
      nameEl.textContent = name;
      item.appendChild(nameEl);
    }
  }

  /**
   * プロジェクトピッカーを非表示にする。
   * @param {HTMLElement} container
   * @param {HTMLElement} btn
   * @param {HTMLElement} picker
   */
  _hideProjectPicker(container, btn, picker) {
    picker.remove();
    btn.style.display = '';
  }

  /**
   * カスタム名入力フォームを表示する。
   * @param {HTMLElement} container - 親コンテナ
   * @param {HTMLElement} btn - トグルボタン（非表示にする）
   */
  _showCustomNameInput(container, btn) {
    // 既に入力フォームが表示中なら何もしない
    if (container.querySelector('.drawer-new-session-form')) {
      return;
    }

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
        this._hideCustomNameInput(container, btn, form);
      }
    });

    // Create ボタンのクリック
    createBtn.addEventListener('click', () => {
      this._handleCreateSession(input, errorEl, container, btn, form);
    });

    // Cancel ボタンのクリック
    cancelBtn.addEventListener('click', () => {
      this._hideCustomNameInput(container, btn, form);
    });
  }

  /**
   * カスタム名入力フォームを非表示にする。
   * @param {HTMLElement} container
   * @param {HTMLElement} btn
   * @param {HTMLElement} form
   */
  _hideCustomNameInput(container, btn, form) {
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
      this._hideCustomNameInput(container, btn, form);

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
        // 他のセッションを閉じて、このセッションだけ展開（アコーディオン）
        this._expandedSessions.clear();
        this._expandedSessions.add(session.name);
        // ウィンドウ一覧をロード
        let windows = [];
        try {
          windows = await this._loadWindows(session.name);
        } catch (err) {
          console.error('Failed to load windows:', err);
        }
        this._renderContent();

        // 別セッションの場合: アクティブなウィンドウに自動遷移（Drawer は開いたまま）
        if (session.name !== this._currentSession && windows && windows.length > 0) {
          const activeWindow = windows.find((w) => w.active) || windows[0];
          this._onSelectSession(session.name, activeWindow.index);
          this._currentSession = session.name;
          this._currentWindowIndex = activeWindow.index;
          // ウィンドウ一覧の current 表示を更新するため再描画
          this._renderContent();
        }
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
          const winEl = this._createWindowElement(session.name, win, windows.length);
          windowsList.appendChild(winEl);
        }

        // [+] 新規ウィンドウ作成ボタン
        const newWinBtn = this._createNewWindowButton(session.name);
        windowsList.appendChild(newWinBtn);
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
   * @param {number} windowCount - セッション内のウィンドウ総数
   * @returns {HTMLElement}
   */
  _createWindowElement(sessionName, win, windowCount) {
    const el = document.createElement('div');
    el.className = 'drawer-window-item';

    const isCurrent = sessionName === this._currentSession &&
                      win.index === this._currentWindowIndex;
    if (isCurrent) {
      el.classList.add('drawer-window-item--current');
    }

    const indexEl = document.createElement('span');
    indexEl.className = 'drawer-window-index';
    indexEl.textContent = `${win.index}: `;

    const nameEl = document.createElement('span');
    nameEl.className = 'drawer-window-name';
    nameEl.textContent = win.name;

    // インジケーターは常に配置し、アクティブ/現在でない場合は非表示
    const indicator = document.createElement('span');
    indicator.className = 'drawer-window-active';
    if (win.active || isCurrent) {
      indicator.textContent = '\u25CF';
    }

    el.appendChild(indexEl);
    el.appendChild(nameEl);
    el.appendChild(indicator);

    // 長押しでウィンドウ操作メニュー表示（Rename / Delete）
    this._setupWindowLongPress(el, sessionName, win, windowCount, indexEl, nameEl);

    // ウィンドウタップでの挙動（名前以外の部分をタップした場合）
    el.addEventListener('click', () => {
      // 長押し後のクリックイベントは無視
      if (this._longPressDetected) {
        this._longPressDetected = false;
        return;
      }

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
   * ウィンドウ名のインライン編集を開始する。
   * ウィンドウ名部分を input に切り替え、Enter で確定、Esc でキャンセルする。
   * @param {HTMLElement} el - ウィンドウ要素
   * @param {HTMLElement} indexEl - インデックス表示要素
   * @param {HTMLElement} nameEl - 名前表示要素
   * @param {string} sessionName - セッション名
   * @param {Object} win - ウィンドウ情報
   */
  _startWindowRename(el, indexEl, nameEl, sessionName, win) {
    // 既に編集中なら何もしない
    if (el.querySelector('.drawer-window-rename-input')) {
      return;
    }

    const originalName = win.name;

    // 名前要素を非表示にして input に置き換え
    nameEl.style.display = 'none';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'drawer-window-rename-input';
    input.value = originalName;
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;

    // indexEl の後に挿入
    indexEl.after(input);
    input.focus();
    input.select();

    const finishRename = async () => {
      const newName = input.value.trim();

      // 空や変更なしの場合はキャンセル
      if (!newName || newName === originalName) {
        input.remove();
        nameEl.style.display = '';
        return;
      }

      input.disabled = true;

      try {
        const result = await renameWindow(sessionName, win.index, newName);

        // キャッシュを更新
        if (this._windowsCache[sessionName]) {
          const cachedWin = this._windowsCache[sessionName].find(w => w.index === win.index);
          if (cachedWin) {
            cachedWin.name = result.name;
          }
        }

        // 表示を更新
        input.remove();
        nameEl.textContent = result.name;
        nameEl.style.display = '';

        // コールバック呼び出し（ヘッダータイトルの更新用）
        if (this._onRenameWindow) {
          this._onRenameWindow(sessionName, win.index, result.name);
        }
      } catch (err) {
        console.error('Failed to rename window:', err);
        input.remove();
        nameEl.style.display = '';
        this._showDeleteError(`Failed to rename window: ${err.message}`);
      }
    };

    const cancelRename = () => {
      input.remove();
      nameEl.style.display = '';
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finishRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelRename();
      }
    });

    input.addEventListener('blur', () => {
      // blur 時にも確定を試みる（名前変更あれば保存、なければキャンセル）
      finishRename();
    });

    // input のクリックが親要素に伝播しないようにする
    input.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  /**
   * ウィンドウ要素に長押し検出を設定する。
   * 500ms の長押しで操作メニュー（Rename / Delete）を表示する。
   * @param {HTMLElement} el - ウィンドウ要素
   * @param {string} sessionName - セッション名
   * @param {Object} win - ウィンドウ情報
   * @param {number} windowCount - セッション内のウィンドウ総数
   * @param {HTMLElement} indexEl - インデックス表示要素
   * @param {HTMLElement} nameEl - 名前表示要素
   */
  _setupWindowLongPress(el, sessionName, win, windowCount, indexEl, nameEl) {
    let startX = 0;
    let startY = 0;

    const showMenu = () => {
      this._showWindowContextMenu(el, sessionName, win, windowCount, indexEl, nameEl);
    };

    el.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      this._longPressDetected = false;

      this._longPressTimer = window.setTimeout(() => {
        this._longPressDetected = true;
        showMenu();
      }, 500);
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (this._longPressTimer !== null) {
        const moveX = e.touches[0].clientX;
        const moveY = e.touches[0].clientY;
        if (Math.abs(moveX - startX) > 10 || Math.abs(moveY - startY) > 10) {
          this._clearLongPressTimer();
        }
      }
    }, { passive: true });

    el.addEventListener('touchend', () => {
      this._clearLongPressTimer();
    }, { passive: true });

    el.addEventListener('touchcancel', () => {
      this._clearLongPressTimer();
    }, { passive: true });

    // デスクトップ: 右クリック（contextmenu）でも操作メニュー表示
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showMenu();
    });
  }

  /**
   * ウィンドウ操作メニュー（Rename / Delete）を表示する。
   * @param {HTMLElement} el - ウィンドウ要素
   * @param {string} sessionName - セッション名
   * @param {Object} win - ウィンドウ情報
   * @param {number} windowCount - セッション内のウィンドウ総数
   * @param {HTMLElement} indexEl - インデックス表示要素
   * @param {HTMLElement} nameEl - 名前表示要素
   */
  _showWindowContextMenu(el, sessionName, win, windowCount, indexEl, nameEl) {
    // 既にメニューが表示中なら除去
    const existing = document.querySelector('.drawer-context-menu-overlay');
    if (existing) {
      existing.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'drawer-context-menu-overlay';

    const menu = document.createElement('div');
    menu.className = 'drawer-context-menu';

    const title = document.createElement('div');
    title.className = 'drawer-context-menu-title';
    title.textContent = `${win.index}: ${win.name}`;
    menu.appendChild(title);

    // Rename
    const renameBtn = document.createElement('button');
    renameBtn.className = 'drawer-context-menu-item';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => {
      closeMenu();
      this._startWindowRename(el, indexEl, nameEl, sessionName, win);
    });
    menu.appendChild(renameBtn);

    // Delete
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'drawer-context-menu-item drawer-context-menu-item--danger';
    if (windowCount <= 1) {
      deleteBtn.disabled = true;
      deleteBtn.title = 'Cannot delete the last window';
    }
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      closeMenu();
      this._doDeleteWindow(sessionName, win, windowCount);
    });
    menu.appendChild(deleteBtn);

    overlay.appendChild(menu);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.classList.add('drawer-context-menu-overlay--visible');
    });

    const closeMenu = () => {
      overlay.classList.remove('drawer-context-menu-overlay--visible');
      setTimeout(() => {
        overlay.remove();
      }, 200);
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeMenu();
      }
    });
  }

  /**
   * ウィンドウを確認なしで即削除する。
   * @param {string} sessionName - セッション名
   * @param {Object} win - 削除対象ウィンドウ
   * @param {number} windowCount - セッション内のウィンドウ総数
   */
  async _doDeleteWindow(sessionName, win, windowCount) {
    // セッション内の最後のウィンドウは削除不可（tmux の制約）
    if (windowCount <= 1) {
      this._showDeleteError('Cannot delete the last window in a session');
      return;
    }

    try {
      await deleteWindow(sessionName, win.index);

      // ウィンドウ一覧を再取得
      delete this._windowsCache[sessionName];
      const updatedWindows = await this._loadWindows(sessionName);

      // 削除したウィンドウが現在表示中だった場合、前のウィンドウに切り替え
      if (sessionName === this._currentSession && win.index === this._currentWindowIndex) {
        if (updatedWindows.length > 0) {
          // 削除されたインデックスより前のウィンドウに切り替え、なければ最初のウィンドウ
          const prevWindow = updatedWindows.reduce((prev, w) => {
            if (w.index < win.index && (prev === null || w.index > prev.index)) {
              return w;
            }
            return prev;
          }, null) || updatedWindows[0];

          this._currentWindowIndex = prevWindow.index;
          this._onSelectWindow(sessionName, prevWindow.index);
        }
      }

      this._renderContent();

      // コールバック呼び出し
      if (this._onDeleteWindow) {
        this._onDeleteWindow();
      }
    } catch (err) {
      console.error('Failed to delete window:', err);
      this._showDeleteError(`Failed to delete window: ${err.message}`);
    }
  }

  /**
   * [+] 新規ウィンドウ作成ボタンを作成する。
   * クリックするとウィンドウ種別選択ダイアログを表示する。
   * @param {string} sessionName - セッション名
   * @returns {HTMLElement}
   */
  _createNewWindowButton(sessionName) {
    const btn = document.createElement('div');
    btn.className = 'drawer-new-window-btn';
    btn.textContent = '+ New Window';

    btn.addEventListener('click', () => {
      this._showNewWindowDialog(sessionName);
    });

    return btn;
  }

  /**
   * 新規ウィンドウ種別選択ダイアログを表示する。
   * @param {string} sessionName - セッション名
   */
  _showNewWindowDialog(sessionName) {
    // 既にダイアログが表示中なら除去
    const existing = document.querySelector('.drawer-context-menu-overlay');
    if (existing) {
      existing.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'drawer-context-menu-overlay';

    const menu = document.createElement('div');
    menu.className = 'drawer-context-menu';

    const title = document.createElement('div');
    title.className = 'drawer-context-menu-title';
    title.textContent = 'New Window';
    menu.appendChild(title);

    const options = [
      { label: 'claude · new session', command: 'claude', isClaude: true },
      { label: 'claude · resume', command: 'claude --continue', isClaude: true },
      { label: 'shell', command: '' },
    ];

    for (const opt of options) {
      const btn = document.createElement('button');
      btn.className = 'drawer-context-menu-item';
      btn.textContent = opt.label;
      btn.addEventListener('click', () => {
        closeDialog();
        if (opt.isClaude) {
          this._showModelSelectDialog(sessionName, opt.command);
        } else {
          this._handleCreateWindow(sessionName, opt.command);
        }
      });
      menu.appendChild(btn);
    }

    overlay.appendChild(menu);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.classList.add('drawer-context-menu-overlay--visible');
    });

    const closeDialog = () => {
      overlay.classList.remove('drawer-context-menu-overlay--visible');
      setTimeout(() => {
        overlay.remove();
      }, 200);
    };

    // オーバーレイ外タップでキャンセル
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeDialog();
      }
    });
  }

  /**
   * Claude モデル選択ダイアログを表示する。
   * @param {string} sessionName - セッション名
   * @param {string} baseCommand - ベースコマンド（'claude' or 'claude --continue'）
   */
  _showModelSelectDialog(sessionName, baseCommand) {
    const existing = document.querySelector('.drawer-context-menu-overlay');
    if (existing) {
      existing.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'drawer-context-menu-overlay';

    const menu = document.createElement('div');
    menu.className = 'drawer-context-menu';

    const title = document.createElement('div');
    title.className = 'drawer-context-menu-title';
    title.textContent = 'Select Model';
    menu.appendChild(title);

    const models = [
      { label: 'opus', flag: 'opus' },
      { label: 'sonnet', flag: 'sonnet' },
      { label: 'haiku', flag: 'haiku' },
    ];

    for (const model of models) {
      const btn = document.createElement('button');
      btn.className = 'drawer-context-menu-item';
      btn.textContent = model.label;
      btn.addEventListener('click', () => {
        closeDialog();
        const command = `${baseCommand} --model ${model.flag}`;
        this._handleCreateWindow(sessionName, command);
      });
      menu.appendChild(btn);
    }

    overlay.appendChild(menu);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.classList.add('drawer-context-menu-overlay--visible');
    });

    const closeDialog = () => {
      overlay.classList.remove('drawer-context-menu-overlay--visible');
      setTimeout(() => {
        overlay.remove();
      }, 200);
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeDialog();
      }
    });
  }

  /**
   * ウィンドウを作成して切り替える。
   * @param {string} sessionName - セッション名
   * @param {string} command - 起動コマンド（空の場合はデフォルトシェル）
   */
  async _handleCreateWindow(sessionName, command) {
    if (this._creatingWindow) return;
    this._creatingWindow = true;

    try {
      const result = await createWindow(sessionName, '', command);

      // ウィンドウ一覧を再取得
      delete this._windowsCache[sessionName];
      await this._loadWindows(sessionName);
      this._renderContent();

      this._creatingWindow = false;

      // 新しいウィンドウに自動切り替え
      const newWindowIndex = result.index;
      if (sessionName === this._currentSession) {
        this._onSelectWindow(sessionName, newWindowIndex);
        this._currentWindowIndex = newWindowIndex;
      } else {
        this._onSelectSession(sessionName, newWindowIndex);
        this._currentSession = sessionName;
        this._currentWindowIndex = newWindowIndex;
      }

      if (this._onCreateWindow) {
        this._onCreateWindow(sessionName, newWindowIndex);
      }

      this.close();
    } catch (err) {
      this._creatingWindow = false;
      console.error('Failed to create window:', err);
      this._showDeleteError(`Failed to create window: ${err.message}`);
    }
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
