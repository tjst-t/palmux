// filebrowser.js - ファイルブラウザ UI
// セッションの CWD をルートとしてディレクトリを閲覧する

import { getSessionCwd, listFiles, searchFiles, getFileContent, getFileRawURL, saveFile } from './api.js';
import { FilePreview } from './file-preview.js';

/**
 * ファイル拡張子からアイコンを決定する。
 * @param {Object} entry - ファイルエントリ
 * @returns {string} アイコン文字
 */
function getFileIcon(entry) {
  if (entry.is_dir) {
    return '\uD83D\uDCC1'; // folder
  }

  const ext = (entry.extension || '').toLowerCase();

  // 画像ファイル
  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.ico'];
  if (imageExts.includes(ext)) {
    return '\uD83D\uDDBC'; // framed picture
  }

  // テキスト系ファイル
  const textExts = [
    '.txt', '.md', '.json', '.yaml', '.yml', '.toml', '.xml', '.html', '.htm',
    '.css', '.js', '.ts', '.jsx', '.tsx', '.go', '.py', '.rb', '.rs', '.c',
    '.h', '.cpp', '.hpp', '.java', '.sh', '.bash', '.zsh', '.fish', '.vim',
    '.lua', '.sql', '.graphql', '.proto', '.csv', '.log', '.conf', '.cfg',
    '.ini', '.env', '.gitignore', '.dockerignore', '.editorconfig',
    '.makefile', '.mod', '.sum', '.lock',
  ];
  if (textExts.includes(ext)) {
    return '\uD83D\uDCC4'; // page facing up
  }

  // 拡張子なしのファイル（Makefile, Dockerfile, README 等）もテキストとみなす
  if (!ext) {
    return '\uD83D\uDCC4'; // page facing up
  }

  return '\uD83D\uDCCE'; // paperclip (その他)
}

/**
 * ファイルサイズを人間が読みやすい形式にフォーマットする。
 * @param {number} bytes - バイト数
 * @returns {string} フォーマット済みサイズ
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'K', 'M', 'G', 'T'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  if (i === 0) return `${bytes} B`;
  return `${size.toFixed(size >= 10 ? 0 : 1)}${units[i]}`;
}

/**
 * 日時を短い形式にフォーマットする。
 * @param {string} dateStr - ISO 8601 日時文字列
 * @returns {string} フォーマット済み日時
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    // 今日: 時刻のみ
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays < 365) {
    // 1年以内: 月日
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } else {
    // それ以外: 年月日
    return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }
}

/**
 * FileBrowser はファイルブラウザ UI を管理する。
 *
 * - セッションの CWD を起点にディレクトリを閲覧
 * - パンくずリストでナビゲーション
 * - ディレクトリタップで中に入る
 * - ファイルタップでプレビュー表示
 */
export class FileBrowser {
  /**
   * @param {HTMLElement} container - ファイラーのコンテナ要素
   * @param {Object} [options]
   * @param {function(string, string, Object): void} [options.onFileSelect] - ファイル選択時のコールバック (session, path, entry)
   * @param {function(string): void} [options.onNavigate] - ディレクトリ移動時のコールバック (path)
   */
  constructor(container, options = {}) {
    this._container = container;
    this._onFileSelect = options.onFileSelect || null;
    this._onNavigate = options.onNavigate || null;

    /** @type {string|null} 現在のセッション名 */
    this._session = null;

    /** @type {string|null} CWD（ルートパス） */
    this._rootPath = null;

    /** @type {string} 現在の相対パス */
    this._currentPath = '.';

    /** @type {Array<string>} パスの階層（パンくず用） */
    this._pathSegments = [];

    /** @type {boolean} ロード中フラグ */
    this._loading = false;

    /** @type {number} ロードID（レースコンディション防止用） */
    this._loadId = 0;

    /** @type {import('./file-preview.js').FilePreview|null} プレビューインスタンス */
    this._preview = null;

    /** @type {number} フォントサイズ（px） */
    const savedSize = parseInt(localStorage.getItem('palmux-fb-font-size'), 10);
    this._fontSize = (savedSize >= 8 && savedSize <= 24) ? savedSize : 14;

    /** @type {boolean} dispose済みフラグ */
    this._disposed = false;

    /** @type {boolean} 検索モードフラグ */
    this._searchMode = false;

    /** @type {string} 現在の検索クエリ */
    this._searchQuery = '';

    /** @type {HTMLInputElement|null} 検索入力要素 */
    this._searchInputEl = null;

    this._render();
    this._applyFontSize();
  }

  /**
   * 指定セッションのファイルブラウザを開く。
   * CWD を取得してルートディレクトリを表示する。
   * @param {string} session - セッション名
   * @param {string} [initialPath='.'] - 開始時に表示するディレクトリパス
   */
  async open(session, initialPath = '.') {
    this._session = session;
    this._currentPath = '.';
    this._pathSegments = [];
    this._rootPath = null;

    this._showLoading();

    try {
      const cwdResult = await getSessionCwd(session);
      this._rootPath = cwdResult.path;
      await this._loadDirectory(initialPath, { silent: true });
    } catch (err) {
      console.error('Failed to open file browser:', err);
      this._showError(`Failed to load: ${err.message}`);
    }
  }

  /**
   * 現在のディレクトリパスを返す。
   * @returns {string}
   */
  getCurrentPath() {
    return this._currentPath;
  }

  /**
   * 指定パスに移動する（ブラウザ履歴へのプッシュなし）。
   * @param {string} path - 移動先の相対パス
   */
  async navigateTo(path) {
    await this._loadDirectory(path, { silent: true });
  }

  /**
   * 指定パスのディレクトリを読み込む。
   * @param {string} path - 相対パス
   * @param {{ silent?: boolean }} [opts] - silent: true のとき onNavigate を呼ばない
   */
  async _loadDirectory(path, { silent = false } = {}) {
    if (!this._session) return;
    const loadId = ++this._loadId;
    this._loading = true;
    this._showLoading();

    try {
      const result = await listFiles(this._session, path);
      if (loadId !== this._loadId) return; // Stale response

      this._currentPath = result.path || path;
      this._pathSegments = this._buildPathSegments(this._currentPath);
      this._loading = false;

      this._renderDirectory(result.entries || []);

      // ユーザー起点のナビゲーションのみ履歴に通知する
      if (!silent && this._onNavigate) {
        this._onNavigate(this._currentPath);
      }
    } catch (err) {
      if (loadId !== this._loadId) return; // Stale response
      this._loading = false;
      console.error('Failed to load directory:', err);
      this._showError(`Failed to load directory: ${err.message}`);
    }
  }

  /**
   * パスからパンくず用のセグメント配列を作成する。
   * @param {string} path - 相対パス（例: "internal/server"）
   * @returns {Array<string>} セグメント配列
   */
  _buildPathSegments(path) {
    if (!path || path === '.') return [];
    // 先頭・末尾のスラッシュを除去して分割
    return path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  }

  /**
   * パンくずリストの特定の階層に移動する。
   * @param {number} index - セグメントのインデックス（-1 でルート）
   */
  _navigateToBreadcrumb(index) {
    if (index < 0) {
      // ルートに戻る
      this._loadDirectory('.');
    } else {
      // 指定階層までのパス
      const path = this._pathSegments.slice(0, index + 1).join('/');
      this._loadDirectory(path);
    }
  }

  /**
   * 親ディレクトリに移動する。
   */
  _navigateUp() {
    if (this._pathSegments.length === 0) {
      // 既にルート
      return;
    }
    if (this._pathSegments.length === 1) {
      // ルートに戻る
      this._loadDirectory('.');
    } else {
      const parentPath = this._pathSegments.slice(0, -1).join('/');
      this._loadDirectory(parentPath);
    }
  }

  /**
   * ディレクトリエントリをタップした際の処理。
   * @param {Object} entry - ファイルエントリ
   */
  _handleEntryTap(entry) {
    if (entry.is_dir) {
      // ディレクトリ: 中に入る
      const newPath = this._pathSegments.length > 0
        ? this._pathSegments.join('/') + '/' + entry.name
        : entry.name;
      this._loadDirectory(newPath);
    } else {
      // ファイル: プレビュー表示
      const filePath = this._pathSegments.length > 0
        ? this._pathSegments.join('/') + '/' + entry.name
        : entry.name;
      this.showPreview(this._session, filePath, entry);

      // コールバックも呼び出す（外部連携用）
      if (this._onFileSelect) {
        this._onFileSelect(this._session, filePath, entry);
      }
    }
  }

  /**
   * ルートレンダリング（初期の空状態）。
   */
  _render() {
    this._container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'fb';
    this._wrapper = wrapper;

    this._container.appendChild(wrapper);
  }

  /**
   * ローディング状態を表示する。
   */
  _showLoading() {
    if (!this._wrapper) this._render();
    this._wrapper.innerHTML = '';

    // パンくずリスト（ローディング中でも表示）
    if (this._rootPath) {
      this._wrapper.appendChild(this._createBreadcrumb());
    }

    const loading = document.createElement('div');
    loading.className = 'fb-loading';
    loading.textContent = 'Loading...';
    this._wrapper.appendChild(loading);
  }

  /**
   * エラーメッセージを表示する。
   * @param {string} message
   */
  _showError(message) {
    if (!this._wrapper) this._render();
    this._wrapper.innerHTML = '';

    // パンくず（あれば）
    if (this._rootPath) {
      this._wrapper.appendChild(this._createBreadcrumb());
    }

    const error = document.createElement('div');
    error.className = 'fb-error';
    error.textContent = message;
    this._wrapper.appendChild(error);
  }

  /**
   * ディレクトリ内容をレンダリングする。
   * @param {Array} entries - ファイルエントリ配列
   */
  _renderDirectory(entries) {
    if (!this._wrapper) this._render();
    this._wrapper.innerHTML = '';

    // パンくずリスト
    this._wrapper.appendChild(this._createBreadcrumb());

    // ファイル一覧
    const list = document.createElement('div');
    list.className = 'fb-list';

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fb-empty';
      empty.textContent = 'Empty directory';
      list.appendChild(empty);
    } else {
      for (const entry of entries) {
        list.appendChild(this._createEntryElement(entry));
      }
    }

    this._wrapper.appendChild(list);
  }

  /**
   * パンくずリストを作成する（右側に検索ボックス付き）。
   * @returns {HTMLElement}
   */
  _createBreadcrumb() {
    const nav = document.createElement('nav');
    nav.className = 'fb-breadcrumb';

    // 検索モード中は「戻る」ボタンのみ表示
    if (this._searchMode) {
      const backBtn = document.createElement('button');
      backBtn.className = 'fb-breadcrumb-back';
      backBtn.textContent = '\u2190';
      backBtn.setAttribute('aria-label', 'Back to file list');
      backBtn.addEventListener('click', () => this._exitSearchMode());
      nav.appendChild(backBtn);

      const label = document.createElement('span');
      label.className = 'fb-search-result-label';
      label.textContent = `"${this._searchQuery}" の検索結果`;
      nav.appendChild(label);

      return nav;
    }

    // 戻るボタン（ルート以外のとき）
    if (this._pathSegments.length > 0) {
      const backBtn = document.createElement('button');
      backBtn.className = 'fb-breadcrumb-back';
      backBtn.textContent = '\u2190'; // left arrow
      backBtn.setAttribute('aria-label', 'Go to parent directory');
      backBtn.addEventListener('click', () => this._navigateUp());
      nav.appendChild(backBtn);
    }

    const crumbs = document.createElement('div');
    crumbs.className = 'fb-breadcrumb-items';

    // ルート名（CWD のディレクトリ名）
    const rootName = this._rootPath
      ? this._rootPath.split('/').filter(Boolean).pop() || '/'
      : '/';

    const rootLink = document.createElement('button');
    rootLink.className = 'fb-breadcrumb-item';
    if (this._pathSegments.length === 0) {
      rootLink.classList.add('fb-breadcrumb-item--current');
    }
    rootLink.textContent = rootName;
    rootLink.addEventListener('click', () => this._navigateToBreadcrumb(-1));
    crumbs.appendChild(rootLink);

    // 各セグメント
    for (let i = 0; i < this._pathSegments.length; i++) {
      const sep = document.createElement('span');
      sep.className = 'fb-breadcrumb-sep';
      sep.textContent = '/';
      crumbs.appendChild(sep);

      const link = document.createElement('button');
      link.className = 'fb-breadcrumb-item';
      if (i === this._pathSegments.length - 1) {
        link.classList.add('fb-breadcrumb-item--current');
      }
      link.textContent = this._pathSegments[i];
      const idx = i;
      link.addEventListener('click', () => this._navigateToBreadcrumb(idx));
      crumbs.appendChild(link);
    }

    nav.appendChild(crumbs);

    // 検索ボックス
    const searchBox = document.createElement('div');
    searchBox.className = 'fb-search-box';

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'fb-search-input';
    searchInput.placeholder = '🔍';
    searchInput.value = this._searchQuery;
    searchInput.setAttribute('aria-label', 'ファイル検索');
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = searchInput.value.trim();
        if (q) {
          this._searchQuery = q;
          this._handleSearch(q);
        }
      }
      if (e.key === 'Escape') {
        searchInput.value = '';
        this._searchQuery = '';
        searchInput.blur();
      }
    });
    this._searchInputEl = searchInput;

    searchBox.appendChild(searchInput);
    nav.appendChild(searchBox);

    return nav;
  }

  /**
   * 検索を実行する。
   * @param {string} query - 検索クエリ
   */
  async _handleSearch(query) {
    if (!this._session || !query) return;

    this._searchMode = true;
    this._searchQuery = query;

    this._showLoading();

    try {
      const result = await searchFiles(this._session, query, this._currentPath);
      if (this._disposed) return;
      this._renderSearchResults(result.results || []);
    } catch (err) {
      console.error('Search failed:', err);
      this._searchMode = false;
      this._showError(`Search failed: ${err.message}`);
    }
  }

  /**
   * 検索モードを終了してディレクトリ一覧に戻る。
   */
  _exitSearchMode() {
    this._searchMode = false;
    this._searchQuery = '';
    this._loadDirectory(this._currentPath, { silent: true });
  }

  /**
   * 検索結果をレンダリングする。
   * @param {Array} results - 検索結果エントリ配列
   */
  _renderSearchResults(results) {
    if (!this._wrapper) this._render();
    this._wrapper.innerHTML = '';

    this._wrapper.appendChild(this._createBreadcrumb());

    const list = document.createElement('div');
    list.className = 'fb-list';

    if (results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fb-empty';
      empty.textContent = 'ファイルが見つかりませんでした';
      list.appendChild(empty);
    } else {
      for (const entry of results) {
        const el = document.createElement('div');
        el.className = 'fb-entry fb-search-result-entry';
        if (entry.is_dir) el.classList.add('fb-entry--dir');

        const icon = document.createElement('span');
        icon.className = 'fb-entry-icon';
        icon.textContent = entry.is_dir ? '\uD83D\uDCC1' : '\uD83D\uDCC4';

        const nameCol = document.createElement('div');
        nameCol.className = 'fb-search-result-names';

        const name = document.createElement('span');
        name.className = 'fb-entry-name';
        name.textContent = entry.name;

        const pathEl = document.createElement('span');
        pathEl.className = 'fb-search-result-path';
        pathEl.textContent = entry.path;

        nameCol.appendChild(name);
        nameCol.appendChild(pathEl);

        const meta = document.createElement('span');
        meta.className = 'fb-entry-meta';
        if (!entry.is_dir) {
          const size = document.createElement('span');
          size.className = 'fb-entry-size';
          size.textContent = formatFileSize(entry.size || 0);
          meta.appendChild(size);
        }

        el.appendChild(icon);
        el.appendChild(nameCol);
        el.appendChild(meta);

        el.addEventListener('click', () => {
          if (entry.is_dir) {
            this._searchMode = false;
            this._searchQuery = '';
            this._loadDirectory(entry.path);
          } else {
            this.showPreview(this._session, entry.path, entry);
            if (this._onFileSelect) {
              this._onFileSelect(this._session, entry.path, entry);
            }
          }
        });

        list.appendChild(el);
      }
    }

    this._wrapper.appendChild(list);
  }

  /**
   * ファイルエントリ要素を作成する。
   * @param {Object} entry - ファイルエントリ
   * @returns {HTMLElement}
   */
  _createEntryElement(entry) {
    const el = document.createElement('div');
    el.className = 'fb-entry';
    if (entry.is_dir) {
      el.classList.add('fb-entry--dir');
    }

    const icon = document.createElement('span');
    icon.className = 'fb-entry-icon';
    icon.textContent = getFileIcon(entry);

    const name = document.createElement('span');
    name.className = 'fb-entry-name';
    name.textContent = entry.name;

    const meta = document.createElement('span');
    meta.className = 'fb-entry-meta';

    const size = document.createElement('span');
    size.className = 'fb-entry-size';
    size.textContent = entry.is_dir ? '' : formatFileSize(entry.size || 0);

    const date = document.createElement('span');
    date.className = 'fb-entry-date';
    date.textContent = formatDate(entry.mod_time);

    meta.appendChild(size);
    meta.appendChild(date);

    el.appendChild(icon);
    el.appendChild(name);
    el.appendChild(meta);

    el.addEventListener('click', () => this._handleEntryTap(entry));

    return el;
  }

  /**
   * ファイルプレビューを表示する。
   * ファイル一覧をプレビューパネルに置き換える。
   * @param {string} session - セッション名
   * @param {string} path - ファイルの相対パス
   * @param {Object} entry - ファイルエントリ情報
   */
  showPreview(session, path, entry) {
    // 既存プレビューを破棄
    if (this._preview) {
      this._preview.dispose();
      this._preview = null;
    }

    // コンテナの中身をクリアしてプレビューに置き換え
    this._container.innerHTML = '';

    this._preview = new FilePreview(this._container, {
      session: session,
      path: path,
      entry: entry,
      onBack: () => {
        // プレビューを閉じてファイル一覧に戻る
        if (this._preview) {
          this._preview.dispose();
          this._preview = null;
        }
        this._container.innerHTML = '';
        this._container.appendChild(this._wrapper);
        // 現在のディレクトリを再読み込み
        this._loadDirectory(this._currentPath);
      },
      getRawURL: (s, p) => getFileRawURL(s, p),
      fetchFile: (s, p) => getFileContent(s, p),
      saveFile: (s, p, c) => saveFile(s, p, c),
    });
  }

  /**
   * CSS 変数でフォントサイズをコンテナに適用する。
   */
  _applyFontSize() {
    this._container.style.setProperty('--fb-font-size', this._fontSize + 'px');
  }

  /**
   * フォントサイズを設定する。
   * @param {number} size - フォントサイズ（px）
   * @returns {number} 適用後のフォントサイズ
   */
  setFontSize(size) {
    const clamped = Math.max(8, Math.min(24, size));
    this._fontSize = clamped;
    localStorage.setItem('palmux-fb-font-size', clamped);
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
   * 現在のフォントサイズを取得する。
   * @returns {number}
   */
  getFontSize() {
    return this._fontSize;
  }

  /**
   * リソースを解放する。
   */
  dispose() {
    if (this._preview) {
      this._preview.dispose();
      this._preview = null;
    }
    this._container.innerHTML = '';
    this._session = null;
    this._rootPath = null;
    this._currentPath = '.';
    this._pathSegments = [];
    this._wrapper = null;
    this._searchMode = false;
    this._searchQuery = '';
    this._searchInputEl = null;
    this._disposed = true;
  }
}
