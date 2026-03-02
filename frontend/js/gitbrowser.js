// gitbrowser.js - Git ブラウザ UI
// セッションの CWD における git status, log, diff, branches を表示する

import { getGitStatus, getGitLog, getGitDiff, getGitStructuredDiff, getGitCommitFiles, getGitBranches, gitDiscard, gitStage, gitUnstage, gitDiscardHunk, gitStageHunk, gitUnstageHunk } from './api.js';

/**
 * 日時を相対的な短い形式にフォーマットする。
 * @param {string} dateStr - ISO 8601 日時文字列
 * @returns {string} フォーマット済み日時
 */
function formatRelativeDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / (1000 * 60));
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHrs < 24) return `${diffHrs}h`;
  if (diffDays < 30) return `${diffDays}d`;
  if (diffDays < 365) {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * ステータスコードに対応する CSS クラスサフィックスを返す。
 * @param {string} status - ステータスコード (M, A, D, ?, R)
 * @returns {string}
 */
function statusClass(status) {
  switch (status) {
    case 'M': return 'modified';
    case 'A': return 'added';
    case 'D': return 'deleted';
    case '?': return 'untracked';
    case 'R': return 'renamed';
    default: return 'modified';
  }
}

/**
 * GitBrowser はセッションの Git 情報を表示するUI。
 *
 * - 上部: コミットされていない変更（またはコミット詳細）— デフォルト 3/5
 * - 中部: コミットログ — デフォルト 2/5
 * - 下部: ブランチバー
 * - 分割線はドラッグで変更可能（最小 1/5）
 * - diff ビュー: ファイルタップで差分表示
 * - 内部遷移はすべて history に記録
 */
export class GitBrowser {
  /**
   * @param {HTMLElement} container - ブラウザのコンテナ要素
   * @param {Object} [options]
   * @param {function(Object): void} [options.onNavigate] - 内部遷移時のコールバック (state)
   */
  constructor(container, options = {}) {
    this._container = container;
    this._onNavigate = options.onNavigate || null;

    /** @type {string|null} 現在のセッション名 */
    this._session = null;

    /** @type {Object|null} 現在のステータス */
    this._status = null;

    /** @type {Array} コミットログ */
    this._log = [];

    /** @type {Array} ブランチ一覧 */
    this._branches = [];

    /** @type {string|null} 選択中のコミットハッシュ */
    this._selectedCommit = null;

    /** @type {Array|null} 選択コミットのファイル一覧 */
    this._commitFiles = null;

    /** @type {string|null} 選択中のブランチ */
    this._selectedBranch = null;

    /** @type {boolean} ブランチピッカー表示中 */
    this._branchPickerOpen = false;

    /** @type {boolean} diff ビュー表示中 */
    this._showingDiff = false;

    /** @type {string|null} diff 表示中のファイルパス */
    this._diffPath = null;

    /** @type {number} ロードID（レースコンディション防止用） */
    this._loadId = 0;

    /** @type {number} 分割比率（ファイルセクションの割合 0-1、デフォルト 3/5） */
    this._splitRatio = 3 / 5;

    /** @type {boolean} ドラッグ中フラグ */
    this._dragging = false;

    /** @type {number} フォントサイズ（px） */
    const savedSize = parseInt(localStorage.getItem('palmux-git-font-size'), 10);
    this._fontSize = (savedSize >= 8 && savedSize <= 24) ? savedSize : 14;

    // ドラッグハンドラ（バインド済みで保持、クリーンアップ用）
    this._onDragMove = this._handleDragMove.bind(this);
    this._onDragEnd = this._handleDragEnd.bind(this);

    /** @type {HTMLElement|null} 右ペイン（ワイドレイアウト時のみ） */
    this._rightPaneEl = null;

    /** @type {HTMLElement|null} 左ペイン参照 */
    this._leftPaneEl = null;

    /** @type {HTMLElement|null} ドラッグ基準コンテナ */
    this._dragContainerEl = null;

    /** @type {number} 横分割比率（左ペインの割合 0-1、デフォルト 0.4） */
    this._horizontalSplitRatio = 0.4;

    /** @type {boolean} 横ドラッグ中フラグ */
    this._hDragging = false;

    this._onHDragMove = this._handleHDragMove.bind(this);
    this._onHDragEnd = this._handleHDragEnd.bind(this);

    /** @type {boolean} 前回のワイドレイアウト状態 */
    this._wasWideLayout = false;

    /** @type {function} resize ハンドラ */
    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);

    this._render();
    this._applyFontSize();
  }

  /**
   * 指定セッションの Git ブラウザを開く。
   * @param {string} session - セッション名
   */
  async open(session) {
    this._session = session;
    this._selectedCommit = null;
    this._commitFiles = null;
    this._showingDiff = false;
    this._diffPath = null;
    this._branchPickerOpen = false;

    this._showLoading();

    try {
      // 並列フェッチ
      const [status, log, branches] = await Promise.all([
        getGitStatus(session),
        getGitLog(session, { branch: this._selectedBranch }),
        getGitBranches(session),
      ]);

      this._status = status;
      this._log = log || [];
      this._branches = branches || [];
      this._selectedBranch = status.branch || null;

      this._renderMain();
    } catch (err) {
      console.error('Failed to open git browser:', err);
      if (err.message && err.message.includes('not a git repository')) {
        this._showNotGitRepo();
      } else {
        this._showError(`Failed to load: ${err.message}`);
      }
    }
  }

  /**
   * 現在の状態をリフレッシュする。
   */
  async refresh() {
    if (!this._session) return;
    await this.open(this._session);
  }

  /**
   * 現在の内部状態を返す（history state 用）。
   * @returns {Object}
   */
  getState() {
    return {
      commit: this._selectedCommit,
      diff: this._showingDiff ? this._diffPath : null,
      branch: this._selectedBranch,
    };
  }

  /**
   * 保存された状態を復元する（popstate 用）。
   * @param {Object} state
   */
  async restoreState(state) {
    if (!state || !this._session) return;

    // ブランチ変更
    if (state.branch && state.branch !== this._selectedBranch) {
      this._selectedBranch = state.branch;
      try {
        const log = await getGitLog(this._session, { branch: state.branch });
        this._log = log || [];
      } catch (err) {
        console.error('Failed to load log for branch:', err);
      }
    }

    if (state.diff) {
      // diff ビューを復元
      this._selectedCommit = state.commit || null;
      this._showingDiff = true;
      this._diffPath = state.diff;
      if (this._selectedCommit && !this._commitFiles) {
        try {
          const files = await getGitCommitFiles(this._session, this._selectedCommit);
          this._commitFiles = files || [];
        } catch (err) {
          this._commitFiles = [];
        }
      }
      if (this._isWideLayout()) {
        this._renderMain();
      } else {
        this._showDiff(state.diff, { push: false });
      }
    } else if (state.commit) {
      // コミット選択を復元
      this._showingDiff = false;
      this._diffPath = null;
      this._selectedCommit = state.commit;
      if (!this._commitFiles) {
        try {
          const files = await getGitCommitFiles(this._session, state.commit);
          this._commitFiles = files || [];
        } catch (err) {
          this._commitFiles = [];
        }
      }
      this._renderMain();
    } else {
      // メインビュー（コミット未選択）
      this._selectedCommit = null;
      this._commitFiles = null;
      this._showingDiff = false;
      this._diffPath = null;
      this._renderMain();
    }
  }

  // --- 内部遷移の history 通知 ---

  /**
   * 内部遷移を history に記録する。
   * @param {boolean} push
   */
  _pushHistory(push) {
    if (!push) return;
    if (this._onNavigate) {
      this._onNavigate(this.getState());
    }
  }

  // --- レイアウト判定 ---

  /**
   * ワイドレイアウト（3ペイン）かどうかを判定する。
   * @returns {boolean}
   */
  _isWideLayout() {
    return window.innerWidth >= 1024;
  }

  /**
   * ウィンドウリサイズ時のハンドラ。レイアウトが変わったら再描画する。
   */
  _handleResize() {
    if (!this._session || !this._status) return;
    const isWide = this._isWideLayout();
    if (isWide === this._wasWideLayout) return;

    if (this._showingDiff && !isWide) {
      // ワイド → ナロー（diff 表示中）: フルスクリーン diff に切り替え
      this._wasWideLayout = isWide;
      this._showDiff(this._diffPath, { push: false });
    } else {
      this._renderMain();
    }
  }

  // --- レンダリング ---

  /**
   * ルートレンダリング（初期の空状態）。
   */
  _render() {
    this._container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'gb';
    this._wrapper = wrapper;

    this._container.appendChild(wrapper);
  }

  /**
   * ローディング状態を表示する。
   */
  _showLoading() {
    if (!this._wrapper) this._render();
    this._wrapper.innerHTML = '';

    const loading = document.createElement('div');
    loading.className = 'gb-loading';
    loading.textContent = 'Loading git info...';
    this._wrapper.appendChild(loading);
  }

  /**
   * エラーメッセージを表示する。
   * @param {string} message
   */
  _showError(message) {
    if (!this._wrapper) this._render();
    this._wrapper.innerHTML = '';

    const error = document.createElement('div');
    error.className = 'gb-error';
    error.textContent = message;
    this._wrapper.appendChild(error);
  }

  /**
   * Git リポジトリでない場合のプレースホルダーを表示する。
   */
  _showNotGitRepo() {
    if (!this._wrapper) this._render();
    this._wrapper.innerHTML = '';

    const placeholder = document.createElement('div');
    placeholder.className = 'gb-placeholder';
    placeholder.textContent = 'Not a git repository';
    this._wrapper.appendChild(placeholder);
  }

  /**
   * メインビュー（ステータス + ログ + ブランチ）をレンダリングする。
   * ワイドレイアウト（1024px以上）では左ペイン+右ペインの3ペイン構成。
   */
  _renderMain() {
    if (!this._wrapper) this._render();
    this._wrapper.innerHTML = '';
    this._wasWideLayout = this._isWideLayout();

    const body = document.createElement('div');
    body.className = 'gb-body';
    if (this._wasWideLayout) {
      body.classList.add('gb-body--wide');
    }
    this._bodyEl = body;

    // ワイド時は左ペインでラップ、ナロー時は body 直下
    const leftContainer = this._wasWideLayout
      ? document.createElement('div')
      : body;
    if (this._wasWideLayout) {
      leftContainer.className = 'gb-left-pane';
      leftContainer.style.width = `${this._horizontalSplitRatio * 100}%`;
      this._leftPaneEl = leftContainer;
      body.appendChild(leftContainer);
    } else {
      this._leftPaneEl = null;
    }
    this._dragContainerEl = leftContainer;

    // ファイルセクション（上部）
    const fileSection = document.createElement('div');
    fileSection.className = 'gb-file-section';
    fileSection.style.flex = `0 0 ${this._splitRatio * 100}%`;
    this._fileSectionEl = fileSection;
    this._renderFileSection(fileSection);
    leftContainer.appendChild(fileSection);

    // ドラッグ可能な区切り線
    const divider = document.createElement('div');
    divider.className = 'gb-divider';
    const handle = document.createElement('div');
    handle.className = 'gb-divider-handle';
    divider.appendChild(handle);
    this._setupDividerDrag(divider);
    leftContainer.appendChild(divider);

    // ログセクション（下部）
    const logSection = document.createElement('div');
    logSection.className = 'gb-log-section';
    logSection.style.flex = '1';
    this._logSectionEl = logSection;
    this._renderLogSection(logSection);
    leftContainer.appendChild(logSection);

    // 横分割ドラッグ区切り線 + 右ペイン（ワイドレイアウト時のみ）
    if (this._wasWideLayout) {
      const hDivider = document.createElement('div');
      hDivider.className = 'gb-hdivider';
      const hHandle = document.createElement('div');
      hHandle.className = 'gb-hdivider-handle';
      hDivider.appendChild(hHandle);
      this._setupHorizontalDividerDrag(hDivider);
      body.appendChild(hDivider);

      const rightPane = document.createElement('div');
      rightPane.className = 'gb-right-pane';
      this._rightPaneEl = rightPane;

      if (this._showingDiff && this._diffPath) {
        this._populateRightPane(this._diffPath);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'gb-right-pane-placeholder';
        placeholder.textContent = 'Select a file to view diff';
        rightPane.appendChild(placeholder);
      }

      body.appendChild(rightPane);
    } else {
      this._rightPaneEl = null;
    }

    this._wrapper.appendChild(body);

    // ブランチバー
    const branchBar = document.createElement('div');
    branchBar.className = 'gb-branch-bar';
    this._renderBranchBar(branchBar);
    this._wrapper.appendChild(branchBar);
  }

  // --- ドラッグ分割 ---

  /**
   * 区切り線のドラッグイベントを設定する。
   * @param {HTMLElement} divider
   */
  _setupDividerDrag(divider) {
    const onStart = (e) => {
      e.preventDefault();
      this._dragging = true;
      divider.classList.add('gb-divider--dragging');
      document.addEventListener('mousemove', this._onDragMove);
      document.addEventListener('mouseup', this._onDragEnd);
      document.addEventListener('touchmove', this._onDragMove, { passive: false });
      document.addEventListener('touchend', this._onDragEnd);
    };

    divider.addEventListener('mousedown', onStart);
    divider.addEventListener('touchstart', onStart, { passive: false });
  }

  /**
   * ドラッグ移動ハンドラ。
   * @param {MouseEvent|TouchEvent} e
   */
  _handleDragMove(e) {
    if (!this._dragging) return;
    e.preventDefault();

    const container = this._dragContainerEl || this._bodyEl;
    if (!container) return;

    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = container.getBoundingClientRect();
    const totalHeight = rect.height;
    if (totalHeight <= 0) return;

    let ratio = (clientY - rect.top) / totalHeight;

    // 最小 1/5, 最大 4/5
    const MIN = 1 / 5;
    const MAX = 4 / 5;
    ratio = Math.max(MIN, Math.min(MAX, ratio));

    this._splitRatio = ratio;
    if (this._fileSectionEl) {
      this._fileSectionEl.style.flex = `0 0 ${ratio * 100}%`;
    }
  }

  /**
   * ドラッグ終了ハンドラ。
   */
  _handleDragEnd() {
    this._dragging = false;
    const divider = this._wrapper?.querySelector('.gb-divider');
    if (divider) divider.classList.remove('gb-divider--dragging');
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
    document.removeEventListener('touchmove', this._onDragMove);
    document.removeEventListener('touchend', this._onDragEnd);
  }

  // --- 横分割ドラッグ（左右ペイン幅変更） ---

  /**
   * 横分割区切り線のドラッグイベントを設定する。
   * @param {HTMLElement} divider
   */
  _setupHorizontalDividerDrag(divider) {
    const onStart = (e) => {
      e.preventDefault();
      this._hDragging = true;
      divider.classList.add('gb-hdivider--dragging');
      document.addEventListener('mousemove', this._onHDragMove);
      document.addEventListener('mouseup', this._onHDragEnd);
      document.addEventListener('touchmove', this._onHDragMove, { passive: false });
      document.addEventListener('touchend', this._onHDragEnd);
    };

    divider.addEventListener('mousedown', onStart);
    divider.addEventListener('touchstart', onStart, { passive: false });
  }

  /**
   * 横ドラッグ移動ハンドラ。
   * @param {MouseEvent|TouchEvent} e
   */
  _handleHDragMove(e) {
    if (!this._hDragging || !this._bodyEl) return;
    e.preventDefault();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const rect = this._bodyEl.getBoundingClientRect();
    const totalWidth = rect.width;
    if (totalWidth <= 0) return;

    let ratio = (clientX - rect.left) / totalWidth;

    // 最小 20%, 最大 60%
    ratio = Math.max(0.2, Math.min(0.6, ratio));

    this._horizontalSplitRatio = ratio;
    if (this._leftPaneEl) {
      this._leftPaneEl.style.width = `${ratio * 100}%`;
    }
  }

  /**
   * 横ドラッグ終了ハンドラ。
   */
  _handleHDragEnd() {
    this._hDragging = false;
    const divider = this._wrapper?.querySelector('.gb-hdivider');
    if (divider) divider.classList.remove('gb-hdivider--dragging');
    document.removeEventListener('mousemove', this._onHDragMove);
    document.removeEventListener('mouseup', this._onHDragEnd);
    document.removeEventListener('touchmove', this._onHDragMove);
    document.removeEventListener('touchend', this._onHDragEnd);
  }

  // --- ファイルセクション ---

  /**
   * ファイルセクションをレンダリングする。
   * @param {HTMLElement} container
   */
  _renderFileSection(container) {
    container.innerHTML = '';

    // ヘッダー
    const header = document.createElement('div');
    header.className = 'gb-file-header';

    if (this._selectedCommit) {
      // コミットが選択されている場合
      const entry = this._log.find(e => e.hash === this._selectedCommit);

      // 戻るボタン
      const backBtn = document.createElement('button');
      backBtn.className = 'gb-file-header-back';
      backBtn.textContent = '\u2190';
      backBtn.setAttribute('aria-label', 'Back to uncommitted changes');
      backBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._selectedCommit = null;
        this._commitFiles = null;
        this._showingDiff = false;
        this._diffPath = null;
        this._renderMain();
        this._pushHistory(true);
      });
      header.appendChild(backBtn);

      // タイトル
      const title = document.createElement('span');
      title.className = 'gb-file-header-title gb-file-header-title--commit';
      title.textContent = entry
        ? `${entry.hash} - ${entry.subject}`
        : this._selectedCommit;
      header.appendChild(title);
    } else {
      const fileCount = this._status ? this._status.files.length : 0;
      const title = document.createElement('span');
      title.className = 'gb-file-header-title';
      title.textContent = `Uncommitted Changes (${fileCount})`;
      header.appendChild(title);
    }

    // リロードボタン（右端）
    const reloadBtn = document.createElement('button');
    reloadBtn.className = 'gb-reload-btn';
    reloadBtn.setAttribute('aria-label', 'Reload');
    reloadBtn.textContent = '\u21BB'; // ↻
    reloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.refresh();
    });
    header.appendChild(reloadBtn);

    container.appendChild(header);

    // ファイル一覧
    const list = document.createElement('div');
    list.className = 'gb-file-list';

    const files = this._selectedCommit ? (this._commitFiles || []) : (this._status ? this._status.files : []);

    if (files.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'gb-empty';
      empty.textContent = this._selectedCommit ? 'No files changed' : 'Working tree clean';
      list.appendChild(empty);
    } else if (!this._selectedCommit) {
      // コミット未選択時: Staged / Changes グループに分離表示
      const stagedFiles = files.filter(f => f.staged);
      const unstagedFiles = files.filter(f => !f.staged);

      if (stagedFiles.length > 0) {
        const groupHeader = document.createElement('div');
        groupHeader.className = 'gb-group-header';
        groupHeader.textContent = `Staged Changes (${stagedFiles.length})`;
        list.appendChild(groupHeader);
        for (const file of stagedFiles) {
          list.appendChild(this._createFileEntry(file));
        }
      }

      if (unstagedFiles.length > 0) {
        const groupHeader = document.createElement('div');
        groupHeader.className = 'gb-group-header';
        groupHeader.textContent = `Changes (${unstagedFiles.length})`;
        list.appendChild(groupHeader);
        for (const file of unstagedFiles) {
          list.appendChild(this._createFileEntry(file));
        }
      }
    } else {
      // コミット選択時: フラットにファイル一覧を表示
      for (const file of files) {
        list.appendChild(this._createFileEntry(file));
      }
    }

    container.appendChild(list);
  }

  /**
   * ファイルエントリ要素を作成する。
   * @param {Object} file - StatusFile
   * @returns {HTMLElement}
   */
  _createFileEntry(file) {
    const el = document.createElement('div');
    el.className = 'gb-file-entry';

    if (this._isWideLayout() && this._showingDiff && this._diffPath === file.path) {
      el.classList.add('gb-file-entry--selected');
    }

    const badge = document.createElement('span');
    badge.className = `gb-status-badge gb-status--${statusClass(file.status)}`;
    badge.textContent = file.status;

    const name = document.createElement('span');
    name.className = 'gb-file-name';
    name.textContent = file.path;

    el.appendChild(badge);
    el.appendChild(name);

    // クリックハンドラ（ロングプレス発火時は抑制）
    let longPressTriggered = false;

    el.addEventListener('click', (e) => {
      if (longPressTriggered) {
        longPressTriggered = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (this._isWideLayout()) {
        this._showDiffInPane(file.path);
      } else {
        this._showDiff(file.path, { push: true });
      }
    });

    // コンテキストメニュー: コミット未選択時のみ
    if (!this._selectedCommit) {
      // ロングプレス（スマホ）
      let pressTimer = null;
      let pressStartPos = null;

      const onPressStart = (e) => {
        pressStartPos = { x: e.touches?.[0]?.clientX ?? e.clientX, y: e.touches?.[0]?.clientY ?? e.clientY };
        pressTimer = setTimeout(() => {
          longPressTriggered = true;
          this._showContextMenu(file, pressStartPos.x, pressStartPos.y);
          pressTimer = null;
        }, 500);
      };

      const onPressMove = (e) => {
        if (pressTimer) {
          const x = e.touches?.[0]?.clientX ?? e.clientX;
          const y = e.touches?.[0]?.clientY ?? e.clientY;
          if (Math.abs(x - pressStartPos.x) > 10 || Math.abs(y - pressStartPos.y) > 10) {
            clearTimeout(pressTimer);
            pressTimer = null;
          }
        }
      };

      const onPressEnd = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      };

      el.addEventListener('touchstart', onPressStart, { passive: true });
      el.addEventListener('touchmove', onPressMove, { passive: true });
      el.addEventListener('touchend', onPressEnd);
      el.addEventListener('touchcancel', onPressEnd);

      // PC: 右クリック
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._showContextMenu(file, e.clientX, e.clientY);
      });
    }

    return el;
  }

  // --- ログセクション ---

  /**
   * ログセクションをレンダリングする。
   * @param {HTMLElement} container
   */
  _renderLogSection(container) {
    container.innerHTML = '';

    // 未コミット変更エントリ（常に先頭に表示）
    container.appendChild(this._createUncommittedLogEntry());

    if (this._log.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'gb-empty';
      empty.textContent = 'No commits';
      container.appendChild(empty);
      return;
    }

    for (const entry of this._log) {
      container.appendChild(this._createLogEntry(entry));
    }
  }

  /**
   * ログ一覧の先頭に表示する未コミット変更エントリを作成する。
   * @returns {HTMLElement}
   */
  _createUncommittedLogEntry() {
    const el = document.createElement('div');
    el.className = 'gb-log-entry gb-log-entry--uncommitted';
    if (this._selectedCommit === null) {
      el.classList.add('gb-log-entry--selected');
    }

    const icon = document.createElement('span');
    icon.className = 'gb-log-uncommitted-icon';
    icon.textContent = '\u25CF'; // ●

    const subject = document.createElement('span');
    subject.className = 'gb-log-subject';
    subject.textContent = 'Uncommitted Changes';

    el.appendChild(icon);
    el.appendChild(subject);

    const fileCount = this._status ? this._status.files.length : 0;
    if (fileCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'gb-log-uncommitted-badge';
      badge.textContent = fileCount;
      el.appendChild(badge);
    }

    el.addEventListener('click', () => {
      if (this._selectedCommit !== null) {
        this._selectedCommit = null;
        this._commitFiles = null;
        this._showingDiff = false;
        this._diffPath = null;
        this._renderMain();
        this._pushHistory(true);
      }
    });

    return el;
  }

  /**
   * ログエントリ要素を作成する。
   * @param {Object} entry - LogEntry
   * @returns {HTMLElement}
   */
  _createLogEntry(entry) {
    const el = document.createElement('div');
    el.className = 'gb-log-entry';
    if (this._selectedCommit === entry.hash) {
      el.classList.add('gb-log-entry--selected');
    }

    const hash = document.createElement('span');
    hash.className = 'gb-log-hash';
    hash.textContent = entry.hash;

    const subject = document.createElement('span');
    subject.className = 'gb-log-subject';
    subject.textContent = entry.subject;

    const date = document.createElement('span');
    date.className = 'gb-log-date';
    date.textContent = formatRelativeDate(entry.date);

    el.appendChild(hash);
    el.appendChild(subject);

    // refs（ブランチ・タグ）バッジ — subject と date の間に右寄せ表示
    if (entry.refs && entry.refs.length > 0) {
      const refsContainer = document.createElement('span');
      refsContainer.className = 'gb-log-refs';
      for (const ref of entry.refs) {
        const badge = document.createElement('span');
        if (ref.startsWith('tag: ')) {
          badge.className = 'gb-log-ref gb-log-ref--tag';
          badge.textContent = ref.substring(5);
        } else if (ref.includes('/')) {
          badge.className = 'gb-log-ref gb-log-ref--remote';
          badge.textContent = ref;
        } else {
          badge.className = 'gb-log-ref gb-log-ref--branch';
          badge.textContent = ref;
        }
        refsContainer.appendChild(badge);
      }
      el.appendChild(refsContainer);
    }

    el.appendChild(date);

    el.addEventListener('click', () => this._selectCommit(entry.hash, { push: true }));

    return el;
  }

  /**
   * コミットを選択する。
   * @param {string} hash - コミットハッシュ
   * @param {{ push?: boolean }} [opts]
   */
  async _selectCommit(hash, { push = true } = {}) {
    if (this._selectedCommit === hash) {
      // 同じコミットを再タップ → 選択解除
      this._selectedCommit = null;
      this._commitFiles = null;
      this._showingDiff = false;
      this._diffPath = null;
      this._renderMain();
      this._pushHistory(push);
      return;
    }

    this._selectedCommit = hash;
    this._commitFiles = null;
    this._showingDiff = false;
    this._diffPath = null;

    // ファイルセクションを更新（ローディング表示）
    this._renderMain();
    this._pushHistory(push);

    try {
      const files = await getGitCommitFiles(this._session, hash);
      if (this._selectedCommit !== hash) return; // Stale response
      this._commitFiles = files || [];
      this._renderMain();
    } catch (err) {
      console.error('Failed to load commit files:', err);
      this._commitFiles = [];
      this._renderMain();
    }
  }

  // --- ブランチ ---

  /**
   * ブランチバーをレンダリングする。
   * @param {HTMLElement} container
   */
  _renderBranchBar(container) {
    container.innerHTML = '';

    const icon = document.createElement('span');
    icon.className = 'gb-branch-icon';
    icon.textContent = '\uD83D\uDD00'; // 🔀

    const name = document.createElement('span');
    name.className = 'gb-branch-name';
    name.textContent = this._selectedBranch || 'unknown';

    const arrow = document.createElement('span');
    arrow.className = 'gb-branch-arrow';
    arrow.textContent = '\u25BC'; // ▼

    container.appendChild(icon);
    container.appendChild(name);
    container.appendChild(arrow);

    container.addEventListener('click', () => this._toggleBranchPicker());
  }

  /**
   * ブランチピッカーを表示/非表示する。
   */
  _toggleBranchPicker() {
    this._branchPickerOpen = !this._branchPickerOpen;

    // 既存のピッカーを削除
    const existing = this._wrapper.querySelector('.gb-branch-picker');
    if (existing) {
      existing.remove();
      return;
    }

    if (!this._branchPickerOpen) return;

    const picker = document.createElement('div');
    picker.className = 'gb-branch-picker';

    if (this._branches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'gb-empty';
      empty.textContent = 'No branches';
      picker.appendChild(empty);
    } else {
      for (const branch of this._branches) {
        const item = document.createElement('div');
        item.className = 'gb-branch-item';
        if (branch.name === this._selectedBranch) {
          item.classList.add('gb-branch-item--current');
        }
        if (branch.remote) {
          item.classList.add('gb-branch-item--remote');
        }

        const nameEl = document.createElement('span');
        nameEl.className = 'gb-branch-item-name';
        nameEl.textContent = branch.name;

        item.appendChild(nameEl);

        if (branch.current) {
          const currentBadge = document.createElement('span');
          currentBadge.className = 'gb-branch-item-badge';
          currentBadge.textContent = 'current';
          item.appendChild(currentBadge);
        }

        item.addEventListener('click', () => this._switchBranch(branch.name));
        picker.appendChild(item);
      }
    }

    this._wrapper.appendChild(picker);
  }

  /**
   * ブランチを切り替える（ログ表示のみ、checkoutは行わない）。
   * @param {string} branchName
   */
  async _switchBranch(branchName) {
    this._selectedBranch = branchName;
    this._branchPickerOpen = false;
    this._selectedCommit = null;
    this._commitFiles = null;
    this._showingDiff = false;
    this._diffPath = null;

    // ブランチピッカーを閉じる
    const picker = this._wrapper.querySelector('.gb-branch-picker');
    if (picker) picker.remove();

    // ログを再取得
    try {
      const log = await getGitLog(this._session, { branch: branchName });
      this._log = log || [];
      this._renderMain();
      this._pushHistory(true);
    } catch (err) {
      console.error('Failed to load log for branch:', err);
    }
  }

  // --- Diff ビュー ---

  /**
   * ワイドレイアウト時にファイルの選択状態を更新する。
   */
  _updateFileSelection() {
    if (!this._fileSectionEl) return;
    const entries = this._fileSectionEl.querySelectorAll('.gb-file-entry');
    entries.forEach(el => {
      const nameEl = el.querySelector('.gb-file-name');
      if (nameEl && nameEl.textContent === this._diffPath) {
        el.classList.add('gb-file-entry--selected');
      } else {
        el.classList.remove('gb-file-entry--selected');
      }
    });
  }

  /**
   * ワイドレイアウト時に右ペインで diff を表示する。
   * @param {string} path - ファイルパス
   * @param {{ push?: boolean }} [opts]
   */
  async _showDiffInPane(path, { push = true } = {}) {
    this._showingDiff = true;
    this._diffPath = path;
    this._pushHistory(push);
    this._updateFileSelection();
    await this._populateRightPane(path);
  }

  /**
   * 右ペインに diff コンテンツを描画する。
   * @param {string} path - ファイルパス
   */
  async _populateRightPane(path) {
    const rightPane = this._rightPaneEl;
    if (!rightPane) return;

    rightPane.innerHTML = '';

    // ヘッダー（戻るボタンなし）
    const header = document.createElement('div');
    header.className = 'gb-diff-header gb-diff-header--pane';
    const fileName = document.createElement('span');
    fileName.className = 'gb-diff-filename';
    fileName.textContent = path;
    header.appendChild(fileName);
    rightPane.appendChild(header);

    // コンテンツ
    const content = document.createElement('div');
    content.className = 'gb-diff-content';
    content.innerHTML = '<div class="gb-loading">Loading diff...</div>';
    rightPane.appendChild(content);

    try {
      if (!this._selectedCommit) {
        // 未コミット変更: hunk 操作ボタン付き structured diff
        await this._renderDiffWithHunkActions(content, path);
        return;
      }

      // コミット選択時: 既存の挙動
      const result = await getGitDiff(this._session, path, this._selectedCommit);
      if (!this._showingDiff || this._diffPath !== path) return;

      content.innerHTML = '';

      if (!result.diff) {
        const empty = document.createElement('div');
        empty.className = 'gb-empty';
        empty.textContent = 'No diff available';
        content.appendChild(empty);
        return;
      }

      const fileStatus = this._getFileStatus(path);
      const isNewFile = fileStatus === 'A' || fileStatus === '?' || this._isAllAddedDiff(result.diff);

      if (isNewFile) {
        this._renderNewFileDiff(content, result.diff);
      } else {
        this._renderSideBySideDiff(content, result.diff);
      }
    } catch (err) {
      console.error('Failed to load diff:', err);
      content.innerHTML = '';
      const error = document.createElement('div');
      error.className = 'gb-error';
      error.textContent = `Failed to load diff: ${err.message}`;
      content.appendChild(error);
    }
  }

  /**
   * diff ビューを表示する。
   * @param {string} path - ファイルパス
   * @param {{ push?: boolean }} [opts]
   */
  async _showDiff(path, { push = true } = {}) {
    // ワイドレイアウト時は右ペインに表示
    if (this._isWideLayout() && this._rightPaneEl) {
      await this._showDiffInPane(path, { push });
      return;
    }

    this._showingDiff = true;
    this._diffPath = path;
    if (!this._wrapper) this._render();
    this._wrapper.innerHTML = '';

    // ヘッダー
    const header = document.createElement('div');
    header.className = 'gb-diff-header';

    const backBtn = document.createElement('button');
    backBtn.className = 'gb-diff-back';
    backBtn.textContent = '\u2190';
    backBtn.setAttribute('aria-label', 'Back to file list');
    backBtn.addEventListener('click', () => {
      this._showingDiff = false;
      this._diffPath = null;
      this._renderMain();
      this._pushHistory(true);
    });

    const fileName = document.createElement('span');
    fileName.className = 'gb-diff-filename';
    fileName.textContent = path;

    header.appendChild(backBtn);
    header.appendChild(fileName);
    this._wrapper.appendChild(header);

    // ローディング
    const content = document.createElement('div');
    content.className = 'gb-diff-content';
    content.innerHTML = '<div class="gb-loading">Loading diff...</div>';
    this._wrapper.appendChild(content);

    this._pushHistory(push);

    try {
      if (!this._selectedCommit) {
        // 未コミット変更: hunk 操作ボタン付き
        await this._renderDiffWithHunkActions(content, path);
        return;
      }

      const result = await getGitDiff(this._session, path, this._selectedCommit || undefined);
      if (!this._showingDiff || this._diffPath !== path) return;

      content.innerHTML = '';

      if (!result.diff) {
        const empty = document.createElement('div');
        empty.className = 'gb-empty';
        empty.textContent = 'No diff available';
        content.appendChild(empty);
        return;
      }

      const fileStatus = this._getFileStatus(path);
      const isNewFile = fileStatus === 'A' || fileStatus === '?' || this._isAllAddedDiff(result.diff);
      const isWideScreen = window.innerWidth >= 768;

      if (isNewFile) {
        this._renderNewFileDiff(content, result.diff);
      } else if (isWideScreen) {
        this._renderSideBySideDiff(content, result.diff);
      } else {
        this._renderUnifiedDiff(content, result.diff);
      }
    } catch (err) {
      console.error('Failed to load diff:', err);
      content.innerHTML = '';
      const error = document.createElement('div');
      error.className = 'gb-error';
      error.textContent = `Failed to load diff: ${err.message}`;
      content.appendChild(error);
    }
  }

  // --- Diff ヘルパー ---

  /**
   * hunk からパッチ文字列を生成する。
   * @param {string} filePath - ファイルパス
   * @param {Object} hunk - DiffHunk ({header, content})
   * @returns {string} パッチ文字列
   */
  _buildHunkPatch(filePath, hunk) {
    const lines = [
      `diff --git a/${filePath} b/${filePath}`,
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
    ];
    // content には hunk ヘッダー行（@@...@@）とその下の行が含まれている
    // content をそのまま追加
    lines.push(hunk.content);
    // 末尾に改行がなければ追加
    let patch = lines.join('\n');
    if (!patch.endsWith('\n')) {
      patch += '\n';
    }
    return patch;
  }

  /**
   * hunk 操作ボタン付きの diff を描画する。
   * @param {HTMLElement} container
   * @param {string} filePath
   */
  async _renderDiffWithHunkActions(container, filePath) {
    try {
      const diffs = await getGitStructuredDiff(this._session, filePath);
      if (!this._showingDiff || this._diffPath !== filePath) return;

      container.innerHTML = '';

      if (!diffs || diffs.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'gb-empty';
        empty.textContent = 'No diff available';
        container.appendChild(empty);
        return;
      }

      const diff = diffs[0]; // 1ファイル分

      const pre = document.createElement('pre');
      pre.className = 'gb-diff-pre';

      for (const hunk of diff.hunks) {
        // hunk ヘッダー行 + アクションボタン
        const hunkHeaderRow = document.createElement('div');
        hunkHeaderRow.className = 'gb-diff-hunk-row';

        const hunkHeaderText = document.createElement('span');
        hunkHeaderText.className = 'gb-diff-line gb-diff-line--hunk gb-diff-hunk-text';
        hunkHeaderText.textContent = hunk.header;
        hunkHeaderRow.appendChild(hunkHeaderText);

        // ボタンコンテナ
        const btnContainer = document.createElement('span');
        btnContainer.className = 'gb-hunk-actions';

        // Stage ボタン
        const stageBtn = document.createElement('button');
        stageBtn.className = 'gb-hunk-btn gb-hunk-btn--stage';
        stageBtn.textContent = '\uFF0B Stage';
        stageBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            const patch = this._buildHunkPatch(diff.file_path, hunk);
            await gitStageHunk(this._session, patch);
            // diff をリロード
            await this._reloadDiff(container, filePath);
          } catch (err) {
            console.error('Failed to stage hunk:', err);
            alert(`Failed to stage hunk: ${err.message}`);
          }
        });
        btnContainer.appendChild(stageBtn);

        // Revert ボタン（確認ダイアログ付き）
        const revertBtn = document.createElement('button');
        revertBtn.className = 'gb-hunk-btn gb-hunk-btn--revert';
        revertBtn.textContent = '\u21A9 Revert';
        revertBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('\u3053\u306E hunk \u306E\u5909\u66F4\u3092\u53D6\u308A\u6D88\u3057\u307E\u3059\u304B\uFF1F\u3053\u306E\u64CD\u4F5C\u306F\u5143\u306B\u623B\u305B\u307E\u305B\u3093\u3002')) return;
          try {
            const patch = this._buildHunkPatch(diff.file_path, hunk);
            await gitDiscardHunk(this._session, patch);
            await this._reloadDiff(container, filePath);
          } catch (err) {
            console.error('Failed to revert hunk:', err);
            alert(`Failed to revert hunk: ${err.message}`);
          }
        });
        btnContainer.appendChild(revertBtn);

        hunkHeaderRow.appendChild(btnContainer);
        pre.appendChild(hunkHeaderRow);

        // hunk の本体行（ヘッダー行を除く content の行）
        const contentLines = hunk.content.split('\n');
        for (const line of contentLines) {
          // hunk ヘッダー行はスキップ（既に描画済み）
          if (line.startsWith('@@')) continue;
          if (line === '') continue; // 末尾の空行はスキップ

          const lineEl = document.createElement('div');
          lineEl.className = 'gb-diff-line';

          if (line.startsWith('+')) {
            lineEl.classList.add('gb-diff-line--added');
          } else if (line.startsWith('-')) {
            lineEl.classList.add('gb-diff-line--removed');
          }

          lineEl.textContent = line;
          pre.appendChild(lineEl);
        }
      }

      container.appendChild(pre);
    } catch (err) {
      console.error('Failed to load structured diff:', err);
      container.innerHTML = '';
      const error = document.createElement('div');
      error.className = 'gb-error';
      error.textContent = `Failed to load diff: ${err.message}`;
      container.appendChild(error);
    }
  }

  /**
   * diff を再読み込みする。
   * @param {HTMLElement} container
   * @param {string} filePath
   */
  async _reloadDiff(container, filePath) {
    container.innerHTML = '<div class="gb-loading">Loading diff...</div>';
    if (!this._selectedCommit) {
      await this._renderDiffWithHunkActions(container, filePath);
    } else {
      // コミット選択時は通常の diff（hunk 操作なし）
      const result = await getGitDiff(this._session, filePath, this._selectedCommit);
      container.innerHTML = '';
      if (!result.diff) {
        container.innerHTML = '<div class="gb-empty">No diff available</div>';
        return;
      }
      this._renderUnifiedDiff(container, result.diff);
    }
  }

  /**
   * ファイルパスに対応するステータスコードを返す。
   * @param {string} path
   * @returns {string|null}
   */
  _getFileStatus(path) {
    const files = this._selectedCommit
      ? (this._commitFiles || [])
      : (this._status ? this._status.files : []);
    const file = files.find(f => f.path === path);
    return file ? file.status : null;
  }

  /**
   * diff の全行が追加行（+）かどうか判定する（新規ファイルのフォールバック検出）。
   * @param {string} diffText
   * @returns {boolean}
   */
  _isAllAddedDiff(diffText) {
    const lines = diffText.split('\n');
    let hasContentLine = false;
    for (const line of lines) {
      if (line.startsWith('diff ') || line.startsWith('index ') ||
          line.startsWith('---') || line.startsWith('+++') ||
          line.startsWith('@@') || line === '' || line.startsWith('\\')) {
        continue;
      }
      hasContentLine = true;
      if (!line.startsWith('+')) return false;
    }
    return hasContentLine;
  }

  /**
   * unified diff を side-by-side 用に解析する。
   * @param {string} diffText
   * @returns {{ meta: string[], hunks: Array<{ header: string, left: Array<string|null>, right: Array<string|null> }> }}
   */
  _parseDiffLines(diffText) {
    const lines = diffText.split('\n');
    const meta = [];
    const hunks = [];
    let currentHunk = null;
    let removedBuf = [];
    let addedBuf = [];

    const flushBuffers = () => {
      if (!currentHunk) return;
      const maxLen = Math.max(removedBuf.length, addedBuf.length);
      for (let i = 0; i < maxLen; i++) {
        currentHunk.left.push(i < removedBuf.length ? removedBuf[i] : null);
        currentHunk.right.push(i < addedBuf.length ? addedBuf[i] : null);
      }
      removedBuf = [];
      addedBuf = [];
    };

    for (const line of lines) {
      if (line.startsWith('diff ') || line.startsWith('index ') ||
          line.startsWith('--- ') || line.startsWith('+++ ')) {
        meta.push(line);
      } else if (line.startsWith('@@')) {
        flushBuffers();
        currentHunk = { header: line, left: [], right: [] };
        hunks.push(currentHunk);
      } else if (currentHunk) {
        if (line.startsWith('-')) {
          removedBuf.push(line);
        } else if (line.startsWith('+')) {
          addedBuf.push(line);
        } else {
          flushBuffers();
          currentHunk.left.push(line);
          currentHunk.right.push(line);
        }
      }
    }
    flushBuffers();

    return { meta, hunks };
  }

  /**
   * unified diff をそのまま表示する（モバイル用）。
   * @param {HTMLElement} container
   * @param {string} diffText
   */
  _renderUnifiedDiff(container, diffText) {
    const pre = document.createElement('pre');
    pre.className = 'gb-diff-pre';

    const lines = diffText.split('\n');
    for (const line of lines) {
      const lineEl = document.createElement('div');
      lineEl.className = 'gb-diff-line';

      if (line.startsWith('+')) {
        lineEl.classList.add('gb-diff-line--added');
      } else if (line.startsWith('-')) {
        lineEl.classList.add('gb-diff-line--removed');
      } else if (line.startsWith('@@')) {
        lineEl.classList.add('gb-diff-line--hunk');
      } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
        lineEl.classList.add('gb-diff-line--meta');
      }

      lineEl.textContent = line;
      pre.appendChild(lineEl);
    }

    container.appendChild(pre);
  }

  /**
   * 新規ファイルの diff を表示する（+ プレフィックスを除去して通常表示）。
   * @param {HTMLElement} container
   * @param {string} diffText
   */
  _renderNewFileDiff(container, diffText) {
    const pre = document.createElement('pre');
    pre.className = 'gb-diff-pre';

    const lines = diffText.split('\n');
    for (const line of lines) {
      const lineEl = document.createElement('div');
      lineEl.className = 'gb-diff-line';

      if (line.startsWith('diff ') || line.startsWith('index ') ||
          line.startsWith('---') || line.startsWith('+++')) {
        lineEl.classList.add('gb-diff-line--meta');
        lineEl.textContent = line;
      } else if (line.startsWith('@@')) {
        lineEl.classList.add('gb-diff-line--hunk');
        lineEl.textContent = line;
      } else if (line.startsWith('+')) {
        lineEl.textContent = ' ' + line.substring(1);
      } else {
        lineEl.textContent = line;
      }

      pre.appendChild(lineEl);
    }

    container.appendChild(pre);
  }

  /**
   * side-by-side diff を表示する（PC/iPad 用）。
   * @param {HTMLElement} container
   * @param {string} diffText
   */
  _renderSideBySideDiff(container, diffText) {
    const parsed = this._parseDiffLines(diffText);

    // content を flex column に切り替え
    container.classList.add('gb-diff-content--sbs');

    // メタ行（diff, index, ---, +++）
    if (parsed.meta.length > 0) {
      const metaPre = document.createElement('pre');
      metaPre.className = 'gb-diff-pre gb-diff-meta-block';
      for (const line of parsed.meta) {
        const lineEl = document.createElement('div');
        lineEl.className = 'gb-diff-line gb-diff-line--meta';
        lineEl.textContent = line;
        metaPre.appendChild(lineEl);
      }
      container.appendChild(metaPre);
    }

    // side-by-side コンテナ
    const sbs = document.createElement('div');
    sbs.className = 'gb-diff-sbs';

    const leftPane = document.createElement('div');
    leftPane.className = 'gb-diff-sbs-left';
    const leftPre = document.createElement('pre');
    leftPre.className = 'gb-diff-pre';

    const rightPane = document.createElement('div');
    rightPane.className = 'gb-diff-sbs-right';
    const rightPre = document.createElement('pre');
    rightPre.className = 'gb-diff-pre';

    for (const hunk of parsed.hunks) {
      // ハンクヘッダーを両ペインに表示
      const leftHunk = document.createElement('div');
      leftHunk.className = 'gb-diff-line gb-diff-line--hunk';
      leftHunk.textContent = hunk.header;
      leftPre.appendChild(leftHunk);

      const rightHunk = document.createElement('div');
      rightHunk.className = 'gb-diff-line gb-diff-line--hunk';
      rightHunk.textContent = hunk.header;
      rightPre.appendChild(rightHunk);

      for (let i = 0; i < hunk.left.length; i++) {
        const leftLine = hunk.left[i];
        const rightLine = hunk.right[i];

        // 左ペイン（旧）
        const leftEl = document.createElement('div');
        leftEl.className = 'gb-diff-line';
        if (leftLine === null) {
          leftEl.classList.add('gb-diff-line--empty');
          leftEl.textContent = '\u00A0';
        } else if (leftLine.startsWith('-')) {
          leftEl.classList.add('gb-diff-line--removed');
          leftEl.textContent = leftLine;
        } else {
          leftEl.textContent = leftLine;
        }
        leftPre.appendChild(leftEl);

        // 右ペイン（新）
        const rightEl = document.createElement('div');
        rightEl.className = 'gb-diff-line';
        if (rightLine === null) {
          rightEl.classList.add('gb-diff-line--empty');
          rightEl.textContent = '\u00A0';
        } else if (rightLine.startsWith('+')) {
          rightEl.classList.add('gb-diff-line--added');
          rightEl.textContent = rightLine;
        } else {
          rightEl.textContent = rightLine;
        }
        rightPre.appendChild(rightEl);
      }
    }

    leftPane.appendChild(leftPre);
    rightPane.appendChild(rightPre);
    sbs.appendChild(leftPane);
    sbs.appendChild(rightPane);

    // 左右スクロール同期
    let syncing = false;
    leftPane.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      rightPane.scrollTop = leftPane.scrollTop;
      rightPane.scrollLeft = leftPane.scrollLeft;
      syncing = false;
    });
    rightPane.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      leftPane.scrollTop = rightPane.scrollTop;
      leftPane.scrollLeft = rightPane.scrollLeft;
      syncing = false;
    });

    container.appendChild(sbs);
  }

  // --- コンテキストメニュー ---

  /**
   * コンテキストメニューを表示する。
   * @param {Object} file - StatusFile
   * @param {number} x - 表示 X 座標
   * @param {number} y - 表示 Y 座標
   */
  _showContextMenu(file, x, y) {
    // 既存メニューを閉じる
    this._closeContextMenu();

    const menu = document.createElement('div');
    menu.className = 'gb-context-menu';

    if (file.staged) {
      // Unstage
      const unstageItem = document.createElement('div');
      unstageItem.className = 'gb-context-menu-item';
      unstageItem.textContent = '\u2212 Unstage File';
      unstageItem.addEventListener('click', () => this._doUnstage(file));
      menu.appendChild(unstageItem);
    } else {
      // Stage
      const stageItem = document.createElement('div');
      stageItem.className = 'gb-context-menu-item';
      stageItem.textContent = '\uFF0B Stage File';
      stageItem.addEventListener('click', () => this._doStage(file));
      menu.appendChild(stageItem);

      // Discard (untracked ファイルには表示しない)
      if (file.status !== '?') {
        const discardItem = document.createElement('div');
        discardItem.className = 'gb-context-menu-item gb-context-menu-item--danger';
        discardItem.textContent = '\u21A9 Discard Changes';
        discardItem.addEventListener('click', () => this._doDiscard(file));
        menu.appendChild(discardItem);
      }
    }

    // 位置調整（画面外にはみ出さないように）
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    this._wrapper.appendChild(menu);

    // 画面外はみ出しチェック（DOM に追加後に寸法を取得）
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      if (rect.right > vw) {
        menu.style.left = `${Math.max(0, vw - rect.width)}px`;
      }
      if (rect.bottom > vh) {
        menu.style.top = `${Math.max(0, vh - rect.height)}px`;
      }
    });

    this._contextMenu = menu;

    // メニュー外クリックで閉じる
    const closeHandler = (e) => {
      if (!menu.contains(e.target)) {
        this._closeContextMenu();
        document.removeEventListener('click', closeHandler, true);
        document.removeEventListener('touchstart', closeHandler, true);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', closeHandler, true);
      document.addEventListener('touchstart', closeHandler, true);
    }, 10);
  }

  /**
   * コンテキストメニューを閉じる。
   */
  _closeContextMenu() {
    if (this._contextMenu) {
      this._contextMenu.remove();
      this._contextMenu = null;
    }
  }

  /**
   * ファイルをステージする。
   * @param {Object} file - StatusFile
   */
  async _doStage(file) {
    this._closeContextMenu();
    try {
      await gitStage(this._session, [file.path]);
      await this.refresh();
    } catch (err) {
      console.error('Failed to stage:', err);
    }
  }

  /**
   * ファイルをアンステージする。
   * @param {Object} file - StatusFile
   */
  async _doUnstage(file) {
    this._closeContextMenu();
    try {
      await gitUnstage(this._session, [file.path]);
      await this.refresh();
    } catch (err) {
      console.error('Failed to unstage:', err);
    }
  }

  /**
   * ファイルの変更を破棄する（確認ダイアログ付き）。
   * @param {Object} file - StatusFile
   */
  async _doDiscard(file) {
    this._closeContextMenu();
    if (!confirm('この操作は取り消せません。変更を破棄しますか？')) return;
    try {
      await gitDiscard(this._session, [file.path]);
      await this.refresh();
    } catch (err) {
      console.error('Failed to discard:', err);
    }
  }

  // --- フォントサイズ ---

  /**
   * CSS 変数でフォントサイズをコンテナに適用する。
   */
  _applyFontSize() {
    this._container.style.setProperty('--gb-font-size', this._fontSize + 'px');
  }

  /**
   * フォントサイズを設定する。
   * @param {number} size - フォントサイズ（px）
   * @returns {number} 適用後のフォントサイズ
   */
  setFontSize(size) {
    const clamped = Math.max(8, Math.min(24, size));
    this._fontSize = clamped;
    localStorage.setItem('palmux-git-font-size', clamped);
    this._applyFontSize();
    return clamped;
  }

  /**
   * フォントサイズを拡大する。
   * @returns {number} 適用後のフォントサイズ
   */
  increaseFontSize() {
    return this.setFontSize(this._fontSize + 2);
  }

  /**
   * フォントサイズを縮小する。
   * @returns {number} 適用後のフォントサイズ
   */
  decreaseFontSize() {
    return this.setFontSize(this._fontSize - 2);
  }

  /**
   * リソースを解放する。
   */
  dispose() {
    // コンテキストメニューを閉じる
    this._closeContextMenu();
    // resize リスナー解除
    window.removeEventListener('resize', this._onResize);
    // ドラッグリスナー解除
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
    document.removeEventListener('touchmove', this._onDragMove);
    document.removeEventListener('touchend', this._onDragEnd);
    // 横ドラッグリスナー解除
    document.removeEventListener('mousemove', this._onHDragMove);
    document.removeEventListener('mouseup', this._onHDragEnd);
    document.removeEventListener('touchmove', this._onHDragMove);
    document.removeEventListener('touchend', this._onHDragEnd);

    this._container.innerHTML = '';
    this._session = null;
    this._status = null;
    this._log = [];
    this._branches = [];
    this._selectedCommit = null;
    this._commitFiles = null;
    this._showingDiff = false;
    this._diffPath = null;
    this._wrapper = null;
    this._bodyEl = null;
    this._fileSectionEl = null;
    this._logSectionEl = null;
    this._rightPaneEl = null;
    this._leftPaneEl = null;
    this._dragContainerEl = null;
  }
}
