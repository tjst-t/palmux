// gitbrowser.js - Git ブラウザ UI
// セッションの CWD における git status, log, diff, branches を表示する

import { getGitStatus, getGitLog, getGitDiff, getGitCommitFiles, getGitBranches } from './api.js';

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
      if (this._selectedCommit && !this._commitFiles) {
        try {
          const files = await getGitCommitFiles(this._session, this._selectedCommit);
          this._commitFiles = files || [];
        } catch (err) {
          this._commitFiles = [];
        }
      }
      this._showDiff(state.diff, { push: false });
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
   */
  _renderMain() {
    if (!this._wrapper) this._render();
    this._wrapper.innerHTML = '';

    // splitRatio に基づいたコンテンツラッパー（ブランチバーを除いた領域）
    const body = document.createElement('div');
    body.className = 'gb-body';
    this._bodyEl = body;

    // ファイルセクション（上部）
    const fileSection = document.createElement('div');
    fileSection.className = 'gb-file-section';
    fileSection.style.flex = `0 0 ${this._splitRatio * 100}%`;
    this._fileSectionEl = fileSection;
    this._renderFileSection(fileSection);
    body.appendChild(fileSection);

    // ドラッグ可能な区切り線
    const divider = document.createElement('div');
    divider.className = 'gb-divider';
    const handle = document.createElement('div');
    handle.className = 'gb-divider-handle';
    divider.appendChild(handle);
    this._setupDividerDrag(divider);
    body.appendChild(divider);

    // ログセクション（下部）
    const logSection = document.createElement('div');
    logSection.className = 'gb-log-section';
    logSection.style.flex = '1';
    this._logSectionEl = logSection;
    this._renderLogSection(logSection);
    body.appendChild(logSection);

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
    if (!this._dragging || !this._bodyEl) return;
    e.preventDefault();

    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = this._bodyEl.getBoundingClientRect();
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
      header.textContent = entry
        ? `${entry.hash} - ${entry.subject}`
        : this._selectedCommit;
      header.classList.add('gb-file-header--commit');

      // 戻るボタン
      const backBtn = document.createElement('button');
      backBtn.className = 'gb-file-header-back';
      backBtn.textContent = '\u2190';
      backBtn.setAttribute('aria-label', 'Back to uncommitted changes');
      backBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._selectedCommit = null;
        this._commitFiles = null;
        this._renderMain();
        this._pushHistory(true);
      });
      header.prepend(backBtn);
    } else {
      const fileCount = this._status ? this._status.files.length : 0;
      header.textContent = `Uncommitted Changes (${fileCount})`;
    }

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
    } else {
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

    const badge = document.createElement('span');
    badge.className = `gb-status-badge gb-status--${statusClass(file.status)}`;
    badge.textContent = file.status;

    const name = document.createElement('span');
    name.className = 'gb-file-name';
    name.textContent = file.path;

    el.appendChild(badge);
    el.appendChild(name);

    el.addEventListener('click', () => this._showDiff(file.path, { push: true }));

    return el;
  }

  // --- ログセクション ---

  /**
   * ログセクションをレンダリングする。
   * @param {HTMLElement} container
   */
  _renderLogSection(container) {
    container.innerHTML = '';

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
      this._renderMain();
      this._pushHistory(push);
      return;
    }

    this._selectedCommit = hash;
    this._commitFiles = null;

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
   * diff ビューを表示する。
   * @param {string} path - ファイルパス
   * @param {{ push?: boolean }} [opts]
   */
  async _showDiff(path, { push = true } = {}) {
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

      const pre = document.createElement('pre');
      pre.className = 'gb-diff-pre';

      const lines = result.diff.split('\n');
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

      content.appendChild(pre);
    } catch (err) {
      console.error('Failed to load diff:', err);
      content.innerHTML = '';
      const error = document.createElement('div');
      error.className = 'gb-error';
      error.textContent = `Failed to load diff: ${err.message}`;
      content.appendChild(error);
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
    // ドラッグリスナー解除
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
    document.removeEventListener('touchmove', this._onDragMove);
    document.removeEventListener('touchend', this._onDragEnd);

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
  }
}
