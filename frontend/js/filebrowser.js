// filebrowser.js - ファイルブラウザ UI
// セッションの CWD をルートとしてディレクトリを閲覧する

import { getSessionCwd, listFiles } from './api.js';

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
 * - ファイルタップはコールバック呼び出し（Task 4 で実装予定）
 */
export class FileBrowser {
  /**
   * @param {HTMLElement} container - ファイラーのコンテナ要素
   * @param {Object} [options]
   * @param {function(string, string, Object): void} [options.onFileSelect] - ファイル選択時のコールバック (session, path, entry)
   */
  constructor(container, options = {}) {
    this._container = container;
    this._onFileSelect = options.onFileSelect || null;

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

    this._render();
  }

  /**
   * 指定セッションのファイルブラウザを開く。
   * CWD を取得してルートディレクトリを表示する。
   * @param {string} session - セッション名
   */
  async open(session) {
    this._session = session;
    this._currentPath = '.';
    this._pathSegments = [];
    this._rootPath = null;

    this._showLoading();

    try {
      const cwdResult = await getSessionCwd(session);
      this._rootPath = cwdResult.path;
      await this._loadDirectory('.');
    } catch (err) {
      console.error('Failed to open file browser:', err);
      this._showError(`Failed to load: ${err.message}`);
    }
  }

  /**
   * 指定パスのディレクトリを読み込む。
   * @param {string} path - 相対パス
   */
  async _loadDirectory(path) {
    if (!this._session) return;
    this._loading = true;
    this._showLoading();

    try {
      const result = await listFiles(this._session, path);

      this._currentPath = result.path || path;
      this._pathSegments = this._buildPathSegments(this._currentPath);
      this._loading = false;

      this._renderDirectory(result.entries || []);
    } catch (err) {
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
      // ファイル: コールバック呼び出し（Task 4 で実装）
      if (this._onFileSelect) {
        const filePath = this._pathSegments.length > 0
          ? this._pathSegments.join('/') + '/' + entry.name
          : entry.name;
        this._onFileSelect(this._session, filePath, entry);
      } else {
        console.log('File selected:', entry.name);
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
   * パンくずリストを作成する。
   * @returns {HTMLElement}
   */
  _createBreadcrumb() {
    const nav = document.createElement('nav');
    nav.className = 'fb-breadcrumb';

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
    return nav;
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
   * リソースを解放する。
   */
  dispose() {
    this._container.innerHTML = '';
    this._session = null;
    this._rootPath = null;
    this._currentPath = '.';
    this._pathSegments = [];
    this._wrapper = null;
  }
}
