// drawer.js - プロジェクト/ブランチ Drawer UI
// ハンバーガーメニューからスライドインし、プロジェクト/ブランチの切り替えを行う
// プロジェクト作成・削除、ブランチ（worktree）管理機能を含む

import { listSessions, createSession, deleteSession, listGhqRepos, cloneGhqRepo, deleteGhqRepo, listProjectWorktrees, createProjectWorktree, deleteProjectWorktree, listProjectBranches } from './api.js';

/**
 * セッション名をプロジェクト名とブランチ名に分解する。
 * @param {string} sessionName - セッション名
 * @returns {{repo: string, branch: string}}
 */
function parseSessionName(sessionName) {
  const idx = sessionName.indexOf('@');
  if (idx < 0) return { repo: sessionName, branch: '' };
  return { repo: sessionName.substring(0, idx), branch: sessionName.substring(idx + 1) };
}

/**
 * Drawer はプロジェクト/ブランチ切り替え用のスライドインパネル。
 *
 * - ハンバーガーメニュー (☰) タップで左からスライドイン
 * - プロジェクト一覧を折りたたみ式で表示
 * - ブランチをタップで別セッションに切り替え（WebSocket 再接続）
 * - drawer 外タップまたはスワイプで閉じる
 * - 開くたびに API から最新データを取得
 * - [New Session] ボタンでプロジェクト作成
 * - プロジェクト長押しで削除オプション表示
 */
export class Drawer {
  /**
   * @param {Object} options
   * @param {function(string, number): void} options.onSelectSession - 別セッション選択時のコールバック (sessionName, windowIndex)
   * @param {function(string): void} [options.onCreateSession] - セッション作成後のコールバック (sessionName)
   * @param {function(): void} [options.onDeleteSession] - セッション削除後のコールバック
   * @param {function(): void} [options.onClose] - Drawer が閉じた後のコールバック
   */
  constructor(options) {
    this._claudePath = options.claudePath || 'claude';
    this._onSelectSession = options.onSelectSession;
    this._onCreateSession = options.onCreateSession || null;
    this._onDeleteSession = options.onDeleteSession || null;
    this._onClose = options.onClose || null;
    this._visible = false;
    this._currentSession = null;
    this._currentWindowIndex = null;
    /** @type {Map<string, {sessions: Array, defaultSession: Object|null}>} プロジェクト名 -> プロジェクトデータ */
    this._projects = new Map();
    /** @type {Array} ghq 以外のセッション */
    this._otherSessions = [];
    /** @type {Set<string>} 展開中のプロジェクト名 */
    this._expandedProjects = new Set();
    /** @type {Array} キャッシュ済みセッションデータ */
    this._sessions = [];

    /** @type {number|null} 長押しタイマー ID */
    this._longPressTimer = null;
    /** @type {boolean} 長押し検出フラグ（クリックイベント抑制用） */
    this._longPressDetected = false;
    /** @type {boolean} セッション作成中フラグ */
    this._creating = false;
    /** @type {'activity'|'name'} セッション並び順 */
    this._sortOrder = 'activity';
    /** @type {Array<{session: string, window_index: number, type: string}>} 通知一覧 */
    this._notifications = [];
    /** @type {boolean} Drawer が固定表示（ピン留め）されているか */
    this._pinned = false;
    /** @type {Function|null} リサイズハンドラ（解除用） */
    this._resizeHandler = null;
    /** @type {number|null} 定期リフレッシュタイマー ID */
    this._refreshTimer = null;

    /** @type {number} ピン留め時の Drawer 幅 */
    this._drawerWidth = this._loadDrawerWidth() || 280;
    /** @type {HTMLElement|null} リサイズハンドル */
    this._resizeHandle = null;

    this._el = document.getElementById('drawer');
    this._overlay = document.getElementById('drawer-overlay');
    this._content = document.getElementById('drawer-content');
    this._sortCheckbox = document.getElementById('drawer-sort-checkbox');
    this._pinBtn = document.getElementById('drawer-pin-btn');

    this._setupEvents();
    this._setupPinButton();
    this._setupResizeHandle();
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
   * ピンボタンのイベントリスナーとリサイズ監視を設定する。
   */
  _setupPinButton() {
    if (this._pinBtn) {
      this._pinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePin();
      });
    }

    // 画面が狭くなったら自動的にピン解除
    this._resizeHandler = () => {
      if (this._pinned && window.innerWidth <= 600) {
        this._unpin();
      }
    };
    window.addEventListener('resize', this._resizeHandler);
  }

  /**
   * Drawer がピン留めされているかどうか。
   * @returns {boolean}
   */
  get isPinned() {
    return this._pinned;
  }

  /**
   * ピン/アンピンを切り替える。
   */
  togglePin() {
    if (this._pinned) {
      this._unpin();
    } else {
      this._pin();
    }
  }

  /**
   * Drawer をピン留めする（固定表示）。
   * オーバーレイを非表示にし、メインコンテンツを右にずらす。
   */
  async _pin() {
    this._pinned = true;
    this._setDrawerWidth(this._drawerWidth);
    this._el.classList.add('drawer--pinned');
    this._overlay.classList.remove('drawer-overlay--visible');
    document.body.classList.add('drawer-pinned');

    if (this._pinBtn) {
      this._pinBtn.classList.add('drawer-pin-btn--active');
      this._pinBtn.setAttribute('aria-label', 'Unpin drawer');
    }

    // ハンバーガーボタンを非表示（Drawer が常に見えるため不要）
    const drawerBtn = document.getElementById('drawer-btn');
    if (drawerBtn) {
      drawerBtn.classList.add('hidden');
    }

    // Drawer が未オープンならオープンする
    if (!this._visible) {
      await this.open();
    }

    this._savePinState();
  }

  /**
   * Drawer のピン留めを解除する（自動で閉じるモードに戻す）。
   */
  _unpin() {
    this._pinned = false;
    this._el.classList.remove('drawer--pinned');
    document.body.classList.remove('drawer-pinned');
    document.documentElement.style.removeProperty('--drawer-pinned-width');

    if (this._pinBtn) {
      this._pinBtn.classList.remove('drawer-pin-btn--active');
      this._pinBtn.setAttribute('aria-label', 'Pin drawer');
    }

    // ハンバーガーボタンを再表示
    const drawerBtn = document.getElementById('drawer-btn');
    if (drawerBtn) {
      drawerBtn.classList.remove('hidden');
    }

    this.close();
    this._savePinState();
  }

  /**
   * ピン状態を localStorage に保存する。
   */
  _savePinState() {
    try {
      localStorage.setItem('palmux-drawer-pinned', this._pinned ? '1' : '0');
    } catch (e) {
      // localStorage が利用できない環境
    }
  }

  /**
   * localStorage にピン状態が保存されているか確認する。
   * @returns {boolean}
   */
  _checkSavedPinState() {
    try {
      return localStorage.getItem('palmux-drawer-pinned') === '1' && window.innerWidth > 600;
    } catch (e) {
      return false;
    }
  }

  /**
   * 保存されたピン状態を復元する。
   * 画面が十分広い場合のみピンする。
   */
  async restorePinState() {
    if (this._pinned) return;
    if (this._checkSavedPinState()) {
      await this._pin();
    }
  }

  /**
   * リサイズハンドルを作成し、ドラッグによる幅変更を設定する。
   */
  _setupResizeHandle() {
    this._resizeHandle = document.createElement('div');
    this._resizeHandle.className = 'drawer-resize-handle';
    this._el.appendChild(this._resizeHandle);

    let startX = 0;
    let startWidth = 0;

    const onMove = (clientX) => {
      const newWidth = startWidth + (clientX - startX);
      const clamped = Math.max(200, Math.min(600, newWidth));
      this._setDrawerWidth(clamped);
    };

    const onEnd = () => {
      this._resizeHandle.classList.remove('drawer-resize-handle--active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
      this._saveDrawerWidth();
    };

    const onMouseMove = (e) => onMove(e.clientX);
    const onMouseUp = () => onEnd();
    const onTouchMove = (e) => {
      if (e.touches.length > 0) onMove(e.touches[0].clientX);
    };
    const onTouchEnd = () => onEnd();

    this._resizeHandle.addEventListener('mousedown', (e) => {
      if (!this._pinned) return;
      e.preventDefault();
      startX = e.clientX;
      startWidth = this._el.offsetWidth;
      this._resizeHandle.classList.add('drawer-resize-handle--active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    this._resizeHandle.addEventListener('touchstart', (e) => {
      if (!this._pinned || e.touches.length !== 1) return;
      e.preventDefault();
      startX = e.touches[0].clientX;
      startWidth = this._el.offsetWidth;
      this._resizeHandle.classList.add('drawer-resize-handle--active');
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      document.addEventListener('touchmove', onTouchMove, { passive: true });
      document.addEventListener('touchend', onTouchEnd);
      document.addEventListener('touchcancel', onTouchEnd);
    });
  }

  /**
   * Drawer の幅を設定する（CSS 変数経由）。
   * @param {number} width - 幅（px）
   */
  _setDrawerWidth(width) {
    this._drawerWidth = width;
    document.documentElement.style.setProperty('--drawer-pinned-width', width + 'px');
  }

  /**
   * Drawer の幅を localStorage に保存する。
   */
  _saveDrawerWidth() {
    try {
      localStorage.setItem('palmux-drawer-width', String(this._drawerWidth));
    } catch (e) {
      // localStorage が利用できない環境
    }
  }

  /**
   * localStorage から Drawer の幅を読み込む。
   * @returns {number|null}
   */
  _loadDrawerWidth() {
    try {
      const saved = localStorage.getItem('palmux-drawer-width');
      if (saved) {
        const width = parseInt(saved, 10);
        if (width >= 200 && width <= 600) return width;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Drawer を開く。最新のセッション一覧を API から取得する。
   */
  async open() {
    this._visible = true;
    this._el.classList.add('drawer--open');
    if (!this._pinned) {
      this._overlay.classList.add('drawer-overlay--visible');
    }

    // 現在のプロジェクトだけ自動展開
    this._expandedProjects.clear();
    if (this._currentSession) {
      const { repo } = parseSessionName(this._currentSession);
      this._expandedProjects.add(repo);
    }

    // ローディング表示
    this._content.innerHTML = '<div class="drawer-loading">Loading...</div>';

    try {
      const [sessions, repos] = await Promise.all([listSessions(), listGhqRepos()]);
      this._sessions = sessions || [];
      this._groupSessionsByProject(this._sessions, repos || []);
      this._renderContent();
      this._startRefreshPolling();
    } catch (err) {
      console.error('Failed to load drawer data:', err);
      this._content.innerHTML = '<div class="drawer-error">Failed to load sessions</div>';
    }
  }

  /**
   * Drawer を閉じる。
   */
  close() {
    if (this._pinned) {
      // ピン留め中は閉じない。ハイライト更新のため再描画だけ行う。
      this._renderContent();
      return;
    }
    this._visible = false;
    this._el.classList.remove('drawer--open');
    this._overlay.classList.remove('drawer-overlay--visible');
    this._clearLongPressTimer();
    this._stopRefreshPolling();
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
   * @param {{ sessionChanged?: boolean }} [opts]
   */
  setCurrent(session, windowIndex, { sessionChanged = false } = {}) {
    const changed = (this._currentSession !== session || this._currentWindowIndex !== windowIndex);
    this._currentSession = session;
    this._currentWindowIndex = windowIndex;

    if (!changed || !this._visible) return;

    if (sessionChanged) {
      const { repo } = parseSessionName(session);
      this._expandedProjects.clear();
      this._expandedProjects.add(repo);
      // Reload sessions
      Promise.all([listSessions(), listGhqRepos()]).then(([sessions, repos]) => {
        this._sessions = sessions || [];
        this._groupSessionsByProject(this._sessions, repos || []);
        this._renderContent();
      }).catch(() => this._renderContent());
    } else {
      this._renderContent();
    }
  }

  /**
   * セッションをプロジェクト別にグループ化する。
   * @param {Array} sessions - セッション一覧
   * @param {Array} repos - ghq リポジトリ一覧
   */
  _groupSessionsByProject(sessions, repos) {
    const repoNames = new Set(repos.map(r => r.name));
    this._projects = new Map();
    this._otherSessions = [];

    for (const session of sessions) {
      const { repo, branch } = parseSessionName(session.name);
      if (repoNames.has(repo)) {
        if (!this._projects.has(repo)) {
          this._projects.set(repo, { sessions: [], defaultSession: null });
        }
        const project = this._projects.get(repo);
        project.sessions.push({ ...session, branch: branch || repo, isDefault: !branch });
        if (!branch) {
          project.defaultSession = session;
        }
      } else {
        this._otherSessions.push(session);
      }
    }
  }

  /**
   * セッション一覧を API から取得する。
   */
  async _loadSessions() {
    this._sessions = await listSessions() || [];
    // セッション一覧が更新されたので、ハンバーガーバッジも再評価する
    this._updateDrawerBtnBadge();
  }

  /**
   * 展開中のプロジェクトのセッション一覧を定期的にリフレッシュするポーリングを開始する。
   */
  _startRefreshPolling() {
    this._stopRefreshPolling();
    this._refreshTimer = window.setInterval(async () => {
      if (!this._visible) return;
      try {
        const [sessions, repos] = await Promise.all([listSessions(), listGhqRepos()]);
        const oldNames = new Set(this._sessions.map(s => s.name));
        const newNames = new Set((sessions || []).map(s => s.name));
        // Only re-render if sessions changed
        if (oldNames.size !== newNames.size || [...oldNames].some(n => !newNames.has(n))) {
          this._sessions = sessions || [];
          this._groupSessionsByProject(this._sessions, repos || []);
          this._renderContent();
        }
      } catch {
        // ネットワークエラー等は無視（次回ポーリングで再試行）
      }
    }, 5000);
  }

  /**
   * ポーリングを停止する。
   */
  _stopRefreshPolling() {
    if (this._refreshTimer !== null) {
      window.clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
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
   * プロジェクトをソートして返す。
   * @returns {Array<[string, Object]>}
   */
  _getSortedProjects() {
    const entries = [...this._projects.entries()];
    if (this._sortOrder === 'name') {
      entries.sort((a, b) => a[0].localeCompare(b[0]));
    } else {
      // activity: sort by most recent session in each project
      entries.sort((a, b) => {
        const aMax = Math.max(...a[1].sessions.map(s => new Date(s.activity)));
        const bMax = Math.max(...b[1].sessions.map(s => new Date(s.activity)));
        return bMax - aMax;
      });
    }
    return entries;
  }

  /**
   * Drawer の内容を描画する。
   */
  _renderContent() {
    this._content.innerHTML = '';

    // 1. プロジェクト一覧
    const sortedProjects = this._getSortedProjects();
    for (const [name, project] of sortedProjects) {
      this._content.appendChild(this._createProjectElement(name, project));
    }

    // 2. Other Sessions
    if (this._otherSessions.length > 0) {
      this._content.appendChild(this._createOtherSessionsSection());
    }

    // 3. + New Session
    this._content.appendChild(this._createNewSessionButton());
  }

  /**
   * プロジェクト要素を作成する。
   * @param {string} projectName - プロジェクト名
   * @param {Object} project - プロジェクトデータ
   * @returns {HTMLElement}
   */
  _createProjectElement(projectName, project) {
    const wrapper = document.createElement('div');
    wrapper.className = 'drawer-project';

    const isExpanded = this._expandedProjects.has(projectName);
    const { repo: currentRepo } = this._currentSession ? parseSessionName(this._currentSession) : { repo: '' };
    const isCurrent = currentRepo === projectName;

    // Project header
    const header = document.createElement('div');
    header.className = 'drawer-session-header';
    if (isCurrent) header.classList.add('drawer-session-header--current');

    const arrow = document.createElement('span');
    arrow.className = 'drawer-session-arrow';
    arrow.textContent = isExpanded ? '\u25BC' : '\u25B6';

    const name = document.createElement('span');
    name.className = 'drawer-session-name';
    name.textContent = projectName;

    // Notification badge
    const badge = document.createElement('span');
    badge.className = 'drawer-session-badge';
    if (project.sessions.some(s => this._hasSessionNotification(s.name))) {
      badge.classList.add('drawer-session-badge--active');
    }

    header.appendChild(arrow);
    header.appendChild(name);
    header.appendChild(badge);

    // Long press for delete
    this._setupLongPress(header, project.defaultSession || project.sessions[0]);

    // Click to expand/collapse + auto-connect
    header.addEventListener('click', async () => {
      if (this._longPressDetected) {
        this._longPressDetected = false;
        return;
      }

      if (this._expandedProjects.has(projectName)) {
        this._expandedProjects.delete(projectName);
        this._renderContent();
      } else {
        this._expandedProjects.clear();
        this._expandedProjects.add(projectName);
        this._renderContent();

        // Auto-connect to default branch session if not already connected
        if (currentRepo !== projectName && project.defaultSession) {
          this._onSelectSession(project.defaultSession.name, 0);
          this._currentSession = project.defaultSession.name;
          this._currentWindowIndex = 0;
          this._renderContent();
        }
      }
    });

    wrapper.appendChild(header);

    // Expanded: show branches + Open Branch button
    if (isExpanded) {
      const branchList = document.createElement('div');
      branchList.className = 'drawer-windows'; // reuse existing style

      // Sort: default first, then alphabetical
      const sortedSessions = [...project.sessions].sort((a, b) => {
        if (a.isDefault) return -1;
        if (b.isDefault) return 1;
        return a.branch.localeCompare(b.branch);
      });

      for (const branchSession of sortedSessions) {
        branchList.appendChild(this._createBranchElement(projectName, branchSession));
      }

      // "Open Branch..." button
      branchList.appendChild(this._createOpenBranchButton(projectName));

      wrapper.appendChild(branchList);
    }

    return wrapper;
  }

  /**
   * ブランチ要素を作成する。
   * @param {string} projectName - プロジェクト名
   * @param {Object} branchSession - ブランチセッション情報
   * @returns {HTMLElement}
   */
  _createBranchElement(projectName, branchSession) {
    const el = document.createElement('div');
    el.className = 'drawer-branch-item';

    const isCurrent = branchSession.name === this._currentSession;
    if (isCurrent) el.classList.add('drawer-branch-item--current');

    // Git branch icon
    const iconEl = document.createElement('span');
    iconEl.className = 'drawer-window-icon';
    iconEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="4" cy="3" r="1.5" stroke="currentColor" stroke-width="1.2"/><circle cx="4" cy="11" r="1.5" stroke="currentColor" stroke-width="1.2"/><circle cx="10" cy="5" r="1.5" stroke="currentColor" stroke-width="1.2"/><line x1="4" y1="4.5" x2="4" y2="9.5" stroke="currentColor" stroke-width="1.2"/><path d="M4 6 Q4 5 10 5" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>';

    const nameEl = document.createElement('span');
    nameEl.className = 'drawer-window-name';
    nameEl.textContent = branchSession.branch;

    const indicator = document.createElement('span');
    indicator.className = 'drawer-window-active';
    if (isCurrent) indicator.textContent = '\u25CF';

    // Notification badge
    const badge = document.createElement('span');
    badge.className = 'drawer-window-badge';
    if (this._hasSessionNotification(branchSession.name)) {
      badge.classList.add('drawer-window-badge--active');
    }

    el.appendChild(iconEl);
    el.appendChild(nameEl);
    el.appendChild(badge);
    el.appendChild(indicator);

    // Long press for delete (worktree session)
    this._setupBranchLongPress(el, projectName, branchSession);

    // Click to connect
    el.addEventListener('click', () => {
      if (this._longPressDetected) {
        this._longPressDetected = false;
        return;
      }
      this._onSelectSession(branchSession.name, 0);
      this._currentSession = branchSession.name;
      this._currentWindowIndex = 0;
      this._renderContent();
      if (!this._pinned) this.close();
    });

    return el;
  }

  /**
   * ブランチ要素に長押し検出を設定する。
   * @param {HTMLElement} el - ブランチ要素
   * @param {string} projectName - プロジェクト名
   * @param {Object} branchSession - ブランチセッション情報
   */
  _setupBranchLongPress(el, projectName, branchSession) {
    let startX = 0;
    let startY = 0;

    const showDelete = () => {
      this._showBranchDeleteConfirmation(projectName, branchSession);
    };

    el.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      this._longPressDetected = false;
      this._longPressTimer = window.setTimeout(() => {
        this._longPressDetected = true;
        showDelete();
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

    el.addEventListener('touchend', () => this._clearLongPressTimer(), { passive: true });
    el.addEventListener('touchcancel', () => this._clearLongPressTimer(), { passive: true });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showDelete();
    });
  }

  /**
   * ブランチ削除確認モーダルを表示する。
   * @param {string} projectName - プロジェクト名
   * @param {Object} branchSession - ブランチセッション情報
   */
  _showBranchDeleteConfirmation(projectName, branchSession) {
    const existing = document.querySelector('.drawer-delete-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'drawer-delete-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'drawer-delete-modal';

    const message = document.createElement('div');
    message.className = 'drawer-delete-modal-message';
    message.textContent = branchSession.isDefault
      ? `Delete session "${branchSession.name}"?`
      : `Delete branch session "${branchSession.branch}"?`;

    const actions = document.createElement('div');
    actions.className = 'drawer-delete-modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'drawer-delete-modal-cancel';
    cancelBtn.textContent = 'Cancel';

    const closeModal = () => {
      overlay.classList.remove('drawer-delete-modal-overlay--visible');
      setTimeout(() => overlay.remove(), 200);
    };

    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    // For non-default branches, offer "Delete + Remove Worktree"
    if (!branchSession.isDefault) {
      const deleteKeepBtn = document.createElement('button');
      deleteKeepBtn.className = 'drawer-delete-modal-delete';
      deleteKeepBtn.textContent = 'Kill Session';
      deleteKeepBtn.style.background = '#666';

      const deleteRemoveBtn = document.createElement('button');
      deleteRemoveBtn.className = 'drawer-delete-modal-delete';
      deleteRemoveBtn.textContent = 'Kill + Remove';

      actions.appendChild(cancelBtn);
      actions.appendChild(deleteKeepBtn);
      actions.appendChild(deleteRemoveBtn);

      const doDelete = async (removeWorktree) => {
        deleteKeepBtn.disabled = true;
        deleteRemoveBtn.disabled = true;
        try {
          await deleteProjectWorktree(projectName, branchSession.branch, removeWorktree);
          closeModal();
          const [sessions, repos] = await Promise.all([listSessions(), listGhqRepos()]);
          this._sessions = sessions || [];
          this._groupSessionsByProject(this._sessions, repos || []);
          this._renderContent();
          if (branchSession.name === this._currentSession) {
            await this._transitionToRecentSession();
          }
        } catch (err) {
          closeModal();
          this._showDeleteError(`Failed to delete: ${err.message}`);
        }
      };

      deleteKeepBtn.addEventListener('click', () => doDelete(false));
      deleteRemoveBtn.addEventListener('click', () => doDelete(true));
    } else {
      // Default branch: just kill session (same as before)
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'drawer-delete-modal-delete';
      deleteBtn.textContent = 'Delete';
      actions.appendChild(cancelBtn);
      actions.appendChild(deleteBtn);

      deleteBtn.addEventListener('click', async () => {
        deleteBtn.disabled = true;
        deleteBtn.textContent = 'Deleting...';
        try {
          await deleteSession(branchSession.name);
          closeModal();
          const [sessions, repos] = await Promise.all([listSessions(), listGhqRepos()]);
          this._sessions = sessions || [];
          this._groupSessionsByProject(this._sessions, repos || []);
          this._renderContent();
          if (branchSession.name === this._currentSession) {
            await this._transitionToRecentSession();
          }
        } catch (err) {
          closeModal();
          this._showDeleteError(`Failed to delete session: ${err.message}`);
        }
      });
    }

    modal.appendChild(message);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('drawer-delete-modal-overlay--visible'));
  }

  /**
   * "Open Branch..." ボタンを作成する。
   * @param {string} projectName - プロジェクト名
   * @returns {HTMLElement}
   */
  _createOpenBranchButton(projectName) {
    const btn = document.createElement('div');
    btn.className = 'drawer-open-branch-btn';
    btn.textContent = 'Open Branch...';

    btn.addEventListener('click', () => {
      this._showBranchPicker(projectName, btn);
    });

    return btn;
  }

  /**
   * ブランチピッカーを表示する。
   * @param {string} projectName - プロジェクト名
   * @param {HTMLElement} triggerBtn - トリガーボタン
   */
  async _showBranchPicker(projectName, triggerBtn) {
    triggerBtn.textContent = 'Loading...';

    try {
      const [branches, worktrees] = await Promise.all([
        listProjectBranches(projectName),
        listProjectWorktrees(projectName),
      ]);

      // Filter: exclude branches that already have sessions
      const existingBranches = new Set(worktrees.filter(w => w.has_session).map(w => w.branch));
      const availableBranches = (branches || []).filter(b => !existingBranches.has(b.name));

      this._showBranchPickerUI(projectName, availableBranches, triggerBtn);
    } catch (err) {
      console.error('Failed to load branches:', err);
      triggerBtn.textContent = 'Open Branch...';
      this._showDeleteError(`Failed to load branches: ${err.message}`);
    }
  }

  /**
   * ブランチピッカー UI を表示する。
   * @param {string} projectName - プロジェクト名
   * @param {Array} branches - 利用可能なブランチ一覧
   * @param {HTMLElement} triggerBtn - トリガーボタン
   */
  _showBranchPickerUI(projectName, branches, triggerBtn) {
    // Replace the triggerBtn's parent with the picker
    const parent = triggerBtn.parentElement;
    triggerBtn.style.display = 'none';

    const picker = document.createElement('div');
    picker.className = 'drawer-branch-picker';

    // Filter input
    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.className = 'drawer-project-picker-filter';
    filterInput.placeholder = 'Filter branches...';
    filterInput.autocomplete = 'off';
    filterInput.autocapitalize = 'off';
    filterInput.spellcheck = false;
    picker.appendChild(filterInput);

    // Branch list
    const listEl = document.createElement('div');
    listEl.className = 'drawer-project-picker-list';
    picker.appendChild(listEl);

    const renderList = (filter) => {
      listEl.innerHTML = '';
      const filtered = filter
        ? branches.filter(b => b.name.toLowerCase().includes(filter))
        : branches;

      if (filtered.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'drawer-project-picker-empty';
        emptyEl.textContent = filter ? 'No matching branches' : 'No available branches';
        listEl.appendChild(emptyEl);
      } else {
        for (const branch of filtered) {
          const item = document.createElement('div');
          item.className = 'drawer-project-picker-item';

          const nameEl = document.createElement('div');
          nameEl.className = 'drawer-project-picker-item-name';
          nameEl.textContent = branch.name;

          if (branch.remote) {
            const remoteTag = document.createElement('span');
            remoteTag.className = 'drawer-branch-remote-tag';
            remoteTag.textContent = 'remote';
            nameEl.appendChild(remoteTag);
          }

          item.appendChild(nameEl);

          item.addEventListener('click', () => {
            this._createWorktreeAndConnect(projectName, branch.name, false, picker, triggerBtn);
          });
          listEl.appendChild(item);
        }
      }
    };

    renderList('');
    filterInput.addEventListener('input', () => renderList(filterInput.value.trim().toLowerCase()));
    filterInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        picker.remove();
        triggerBtn.style.display = '';
        triggerBtn.textContent = 'Open Branch...';
      }
    });

    // Create new branch button
    const createBtn = document.createElement('div');
    createBtn.className = 'drawer-project-picker-custom';
    createBtn.textContent = 'Create new branch...';
    createBtn.addEventListener('click', () => {
      this._showCreateBranchInput(projectName, picker, triggerBtn);
    });
    picker.appendChild(createBtn);

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'drawer-new-session-cancel drawer-project-picker-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      picker.remove();
      triggerBtn.style.display = '';
      triggerBtn.textContent = 'Open Branch...';
    });
    picker.appendChild(cancelBtn);

    parent.appendChild(picker);
    filterInput.focus();
  }

  /**
   * 新規ブランチ作成入力 UI を表示する。
   * @param {string} projectName - プロジェクト名
   * @param {HTMLElement} picker - ピッカーコンテナ
   * @param {HTMLElement} triggerBtn - トリガーボタン
   */
  _showCreateBranchInput(projectName, picker, triggerBtn) {
    picker.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'drawer-project-picker-clone-title';
    title.textContent = 'Create New Branch';
    picker.appendChild(title);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'drawer-project-picker-filter';
    input.placeholder = 'Branch name (e.g. feature/login)';
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    picker.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'drawer-project-picker-clone-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'drawer-new-session-cancel';
    cancelBtn.textContent = 'Cancel';

    const createBtn = document.createElement('button');
    createBtn.className = 'drawer-new-session-create';
    createBtn.textContent = 'Create';

    actions.appendChild(cancelBtn);
    actions.appendChild(createBtn);
    picker.appendChild(actions);

    input.focus();

    const doCreate = () => {
      const branchName = input.value.trim();
      if (!branchName) return;
      this._createWorktreeAndConnect(projectName, branchName, true, picker, triggerBtn);
    };

    createBtn.addEventListener('click', doCreate);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doCreate(); }
      else if (e.key === 'Escape') {
        e.preventDefault();
        picker.remove();
        triggerBtn.style.display = '';
        triggerBtn.textContent = 'Open Branch...';
      }
    });
    cancelBtn.addEventListener('click', () => {
      picker.remove();
      triggerBtn.style.display = '';
      triggerBtn.textContent = 'Open Branch...';
    });
  }

  /**
   * Worktree を作成してセッションに接続する。
   * @param {string} projectName - プロジェクト名
   * @param {string} branch - ブランチ名
   * @param {boolean} createBranch - 新規ブランチを作成するか
   * @param {HTMLElement} picker - ピッカーコンテナ
   * @param {HTMLElement} triggerBtn - トリガーボタン
   */
  async _createWorktreeAndConnect(projectName, branch, createBranch, picker, triggerBtn) {
    if (this._creating) return;
    this._creating = true;

    try {
      await createProjectWorktree(projectName, branch, createBranch);
      this._creating = false;

      picker.remove();
      triggerBtn.style.display = '';
      triggerBtn.textContent = 'Open Branch...';

      const sessionName = projectName + '@' + branch;
      const [sessions, repos] = await Promise.all([listSessions(), listGhqRepos()]);
      this._sessions = sessions || [];
      this._groupSessionsByProject(this._sessions, repos || []);
      this._renderContent();

      if (this._onCreateSession) {
        this._onCreateSession(sessionName);
        if (!this._pinned) this.close();
      }
    } catch (err) {
      this._creating = false;
      console.error('Failed to create worktree session:', err);
      this._showDeleteError(`Failed to create branch: ${err.message}`);
      triggerBtn.textContent = 'Open Branch...';
    }
  }

  /**
   * Other Sessions セクションを作成する。
   * @returns {HTMLElement}
   */
  _createOtherSessionsSection() {
    const section = document.createElement('div');
    section.className = 'drawer-other-sessions';

    const isExpanded = this._expandedProjects.has('__other__');

    const header = document.createElement('div');
    header.className = 'drawer-session-header drawer-other-sessions-header';

    const arrow = document.createElement('span');
    arrow.className = 'drawer-session-arrow';
    arrow.textContent = isExpanded ? '\u25BC' : '\u25B6';

    const name = document.createElement('span');
    name.className = 'drawer-session-name';
    name.textContent = 'Other Sessions';

    header.appendChild(arrow);
    header.appendChild(name);

    header.addEventListener('click', () => {
      if (this._expandedProjects.has('__other__')) {
        this._expandedProjects.delete('__other__');
      } else {
        this._expandedProjects.add('__other__');
      }
      this._renderContent();
    });

    section.appendChild(header);

    if (isExpanded) {
      const list = document.createElement('div');
      list.className = 'drawer-windows';

      for (const session of this._otherSessions) {
        const el = document.createElement('div');
        el.className = 'drawer-branch-item';
        if (session.name === this._currentSession) el.classList.add('drawer-branch-item--current');

        const iconEl = document.createElement('span');
        iconEl.className = 'drawer-window-icon';
        iconEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="2,4 6,7 2,10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="7" y1="10" x2="12" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

        const nameEl = document.createElement('span');
        nameEl.className = 'drawer-window-name';
        nameEl.textContent = session.name;

        const indicator = document.createElement('span');
        indicator.className = 'drawer-window-active';
        if (session.name === this._currentSession) indicator.textContent = '\u25CF';

        el.appendChild(iconEl);
        el.appendChild(nameEl);
        el.appendChild(indicator);

        // Long press for delete
        this._setupLongPress(el, session);

        el.addEventListener('click', () => {
          if (this._longPressDetected) { this._longPressDetected = false; return; }
          this._onSelectSession(session.name, 0);
          this._currentSession = session.name;
          this._currentWindowIndex = 0;
          this._renderContent();
          if (!this._pinned) this.close();
        });

        list.appendChild(el);
      }

      section.appendChild(list);
    }

    return section;
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

    // Clone new repo ボタン
    const cloneBtn = document.createElement('div');
    cloneBtn.className = 'drawer-project-picker-clone';
    cloneBtn.textContent = 'Clone new repo...';
    cloneBtn.addEventListener('click', () => {
      this._showCloneRepoInput(picker, availableRepos, container, btn);
    });
    picker.appendChild(cloneBtn);

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

    // フォーカス
    filterInput.focus();
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

    // 長押しで削除確認モーダル
    let longPressTimer = null;
    let longPressDetected = false;
    let startX = 0;
    let startY = 0;

    const showDelete = () => {
      this._showRepoDeleteConfirmation(repo, picker, container, btn);
    };

    item.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      longPressDetected = false;
      longPressTimer = window.setTimeout(() => {
        longPressDetected = true;
        showDelete();
      }, 600);
    }, { passive: true });

    item.addEventListener('touchmove', (e) => {
      if (longPressTimer !== null) {
        const moveX = e.touches[0].clientX;
        const moveY = e.touches[0].clientY;
        if (Math.abs(moveX - startX) > 10 || Math.abs(moveY - startY) > 10) {
          window.clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }
    }, { passive: true });

    item.addEventListener('touchend', () => {
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }, { passive: true });

    item.addEventListener('touchcancel', () => {
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }, { passive: true });

    // デスクトップ: 右クリックで削除オプション
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showDelete();
    });

    item.addEventListener('click', () => {
      if (longPressDetected) {
        longPressDetected = false;
        return;
      }
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
      const repos = await listGhqRepos() || [];
      this._groupSessionsByProject(this._sessions, repos);
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
   * リポジトリ削除確認モーダルを表示する。
   * @param {Object} repo - リポジトリ情報 {name, path, full_path}
   * @param {HTMLElement} picker - ピッカーコンテナ
   * @param {HTMLElement} container - 親コンテナ
   * @param {HTMLElement} btn - トグルボタン
   */
  _showRepoDeleteConfirmation(repo, picker, container, btn) {
    // 既にモーダルが表示中なら除去
    const existing = document.querySelector('.drawer-delete-modal-overlay');
    if (existing) {
      existing.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'drawer-delete-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'drawer-delete-modal';

    const message = document.createElement('div');
    message.className = 'drawer-delete-modal-message';
    message.textContent = `Delete repository "${repo.name}"?`;

    const pathEl = document.createElement('div');
    pathEl.className = 'drawer-delete-modal-path';
    pathEl.textContent = repo.full_path;

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
    modal.appendChild(pathEl);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.classList.add('drawer-delete-modal-overlay--visible');
    });

    const closeModal = () => {
      overlay.classList.remove('drawer-delete-modal-overlay--visible');
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
        await deleteGhqRepo(repo.full_path);
        closeModal();

        // リスト再取得して再描画
        let repos = [];
        try {
          repos = await listGhqRepos() || [];
        } catch (err) {
          console.error('Failed to reload repos:', err);
        }

        const existingNames = new Set(this._sessions.map((s) => s.name));
        const newAvailableRepos = repos.filter((r) => !existingNames.has(r.name));

        this._renderProjectPickerContent(picker, newAvailableRepos, container, btn);
      } catch (err) {
        console.error('Failed to delete repo:', err);
        closeModal();
        this._showDeleteError(`Failed to delete repo: ${err.message}`);
      }
    });
  }

  /**
   * Clone リポジトリ入力 UI を表示する。
   * ピッカーの内容を Clone 入力 UI に差し替える。
   * @param {HTMLElement} picker - ピッカーコンテナ
   * @param {Array} availableRepos - 利用可能なリポジトリ
   * @param {HTMLElement} container - 親コンテナ
   * @param {HTMLElement} btn - トグルボタン
   */
  _showCloneRepoInput(picker, availableRepos, container, btn) {
    picker.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'drawer-project-picker-clone-title';
    title.textContent = 'Clone Repository';
    picker.appendChild(title);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'drawer-project-picker-filter';
    input.placeholder = 'https://github.com/owner/repo';
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    picker.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'drawer-project-picker-clone-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'drawer-new-session-cancel';
    cancelBtn.textContent = 'Cancel';

    const cloneBtn = document.createElement('button');
    cloneBtn.className = 'drawer-new-session-create';
    cloneBtn.textContent = 'Clone';

    actions.appendChild(cancelBtn);
    actions.appendChild(cloneBtn);
    picker.appendChild(actions);

    const statusEl = document.createElement('div');
    statusEl.className = 'drawer-project-picker-clone-status';
    statusEl.style.display = 'none';
    picker.appendChild(statusEl);

    input.focus();

    const doClone = async () => {
      const url = input.value.trim();
      if (!url) return;

      input.disabled = true;
      cloneBtn.disabled = true;
      cancelBtn.disabled = true;
      statusEl.textContent = 'Cloning...';
      statusEl.style.display = 'block';

      try {
        await cloneGhqRepo(url);
        statusEl.textContent = 'Clone successful!';

        // リスト再取得して再描画
        let repos = [];
        try {
          repos = await listGhqRepos() || [];
        } catch (err) {
          console.error('Failed to reload repos:', err);
        }

        const existingNames = new Set(this._sessions.map((s) => s.name));
        const newAvailableRepos = repos.filter((r) => !existingNames.has(r.name));

        this._renderProjectPickerContent(picker, newAvailableRepos, container, btn);
      } catch (err) {
        console.error('Failed to clone repo:', err);
        statusEl.textContent = '';
        statusEl.style.display = 'none';
        input.disabled = false;
        cloneBtn.disabled = false;
        cancelBtn.disabled = false;
        this._showDeleteError(`Failed to clone: ${err.message}`);
      }
    };

    cloneBtn.addEventListener('click', doClone);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doClone();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._renderProjectPickerContent(picker, availableRepos, container, btn);
      }
    });

    cancelBtn.addEventListener('click', () => {
      this._renderProjectPickerContent(picker, availableRepos, container, btn);
    });
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
      const repos = await listGhqRepos() || [];
      this._groupSessionsByProject(this._sessions, repos);
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

      const wasActive = session.name === this._currentSession;

      try {
        await deleteSession(session.name);
        closeModal();

        // セッション一覧を再取得して描画
        await this._loadSessions();
        const repos = await listGhqRepos() || [];
        this._groupSessionsByProject(this._sessions, repos);
        this._expandedProjects.delete(session.name);
        this._renderContent();

        if (wasActive) {
          // 削除したのが active session → 別セッションに自動遷移
          await this._transitionToRecentSession();
        } else if (this._onDeleteSession) {
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
   * 最近アクセスしたセッションに自動遷移する。
   * セッションが0件の場合は _onDeleteSession コールバックを呼ぶ。
   */
  async _transitionToRecentSession() {
    if (this._sessions.length === 0) {
      if (this._onDeleteSession) {
        this._onDeleteSession();
      }
      return;
    }

    // activity 降順（最近アクセスした順）でソート
    const sorted = [...this._sessions].sort(
      (a, b) => new Date(b.activity) - new Date(a.activity)
    );
    const target = sorted[0];

    this._currentSession = target.name;
    this._currentWindowIndex = 0;
    this._onSelectSession(target.name, 0);
    this._renderContent();
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
   * 通知一覧を更新し、Drawer が開いていれば再描画する。
   * ハンバーガーボタンの通知ドットも更新する。
   * @param {Array<{session: string, window_index: number, type: string}>} notifications
   */
  setNotifications(notifications) {
    this._notifications = notifications || [];
    this._updateDrawerBtnBadge();
    if (this._visible) {
      this._renderContent();
    }
  }

  /**
   * 指定セッションに通知があるかを返す。
   * @param {string} session
   * @returns {boolean}
   */
  _hasSessionNotification(session) {
    return this._notifications.some((n) => n.session === session);
  }

  /**
   * ハンバーガーボタンの通知ドットを更新する。
   * セッション一覧が読み込み済みの場合は、存在するセッションへの通知のみを対象にする。
   * これにより、削除済みセッションへの古い通知でバッジが残り続けるバグを防ぐ。
   */
  _updateDrawerBtnBadge() {
    const drawerBtn = document.getElementById('drawer-btn');
    if (!drawerBtn) return;

    let hasNotification;
    if (this._sessions.length > 0) {
      // セッション一覧が読み込まれている場合は、既知のセッションへの通知のみカウント
      const sessionNames = new Set(this._sessions.map((s) => s.name));
      hasNotification = this._notifications.some((n) => sessionNames.has(n.session));
    } else {
      // セッション一覧が未読み込みの場合は通知の有無のみチェック
      hasNotification = this._notifications.length > 0;
    }

    if (hasNotification) {
      drawerBtn.classList.add('drawer-btn--has-notification');
    } else {
      drawerBtn.classList.remove('drawer-btn--has-notification');
    }
  }

  /**
   * リソースを解放する。
   */
  dispose() {
    this._content.innerHTML = '';
    this._sessions = [];
    this._projects = new Map();
    this._otherSessions = [];
    this._expandedProjects.clear();
    this._clearLongPressTimer();
    this._stopRefreshPolling();

    // ピン状態をクリア
    if (this._pinned) {
      this._pinned = false;
      this._el.classList.remove('drawer--pinned');
      document.body.classList.remove('drawer-pinned');
      document.documentElement.style.removeProperty('--drawer-pinned-width');
    }

    // リサイズハンドルを除去
    if (this._resizeHandle) {
      this._resizeHandle.remove();
      this._resizeHandle = null;
    }

    // リサイズリスナーを解除
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }

    // 残っているモーダル/トーストを除去
    const modal = document.querySelector('.drawer-delete-modal-overlay');
    if (modal) modal.remove();
    const toast = document.querySelector('.drawer-toast');
    if (toast) toast.remove();
  }
}
