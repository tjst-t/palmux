// api.js - REST API クライアント（base-path 対応）

/**
 * <meta name="base-path"> タグからベースパスを取得する。
 * サーバーが注入した値を使用し、必ず "/" で終わるように正規化する。
 * @returns {string} ベースパス（例: "/", "/palmux/"）
 */
export function getBasePath() {
  const meta = document.querySelector('meta[name="base-path"]');
  if (!meta) {
    return '/';
  }
  let path = meta.getAttribute('content') || '/';
  if (!path.endsWith('/')) {
    path += '/';
  }
  return path;
}

/**
 * <meta name="auth-token"> タグから認証トークンを取得する。
 * @returns {string} Bearer トークン
 */
export function getToken() {
  const meta = document.querySelector('meta[name="auth-token"]');
  if (!meta) {
    return '';
  }
  return meta.getAttribute('content') || '';
}

/**
 * 認証付きで API リクエストを送信する。
 * base-path を自動的に付与し、Authorization ヘッダーを設定する。
 * @param {string} path - API パス（base-path からの相対パス、例: "api/sessions"）
 * @param {RequestInit} options - fetch オプション
 * @returns {Promise<any>} レスポンスの JSON、または 204 の場合 null
 */
export async function fetchAPI(path, options = {}) {
  const basePath = getBasePath();
  const token = getToken();
  const url = basePath + path;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API error: ${res.status} ${text}`);
  }

  if (res.status === 204) {
    return null;
  }

  return res.json();
}

/**
 * セッション一覧を取得する。
 * @returns {Promise<Array<{name: string, windows: number, attached: boolean, created: string}>>}
 */
export async function listSessions() {
  return fetchAPI('api/sessions');
}

/**
 * 新しいセッションを作成する。
 * @param {string} name - セッション名
 * @returns {Promise<{name: string}>}
 */
export async function createSession(name) {
  return fetchAPI('api/sessions', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/**
 * セッションを削除する。
 * @param {string} name - セッション名
 * @returns {Promise<null>}
 */
export async function deleteSession(name) {
  return fetchAPI(`api/sessions/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

/**
 * 指定セッションのウィンドウ一覧を取得する。
 * @param {string} session - セッション名
 * @returns {Promise<Array<{index: number, name: string, active: boolean}>>}
 */
export async function listWindows(session) {
  return fetchAPI(`api/sessions/${encodeURIComponent(session)}/windows`);
}

/**
 * 新しいウィンドウを作成する。
 * @param {string} session - セッション名
 * @param {string} [name] - ウィンドウ名（省略可）
 * @param {string} [command] - 起動コマンド（省略可）
 * @returns {Promise<{index: number, name: string}>}
 */
export async function createWindow(session, name, command) {
  const body = {};
  if (name) body.name = name;
  if (command) body.command = command;
  return fetchAPI(`api/sessions/${encodeURIComponent(session)}/windows`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * ウィンドウをリネームする。
 * @param {string} session - セッション名
 * @param {number} index - ウィンドウインデックス
 * @param {string} name - 新しいウィンドウ名
 * @returns {Promise<{index: number, name: string, active: boolean}>}
 */
export async function renameWindow(session, index, name) {
  return fetchAPI(
    `api/sessions/${encodeURIComponent(session)}/windows/${index}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }
  );
}

/**
 * ウィンドウを削除する。
 * @param {string} session - セッション名
 * @param {number} index - ウィンドウインデックス
 * @returns {Promise<null>}
 */
export async function deleteWindow(session, index) {
  return fetchAPI(
    `api/sessions/${encodeURIComponent(session)}/windows/${index}`,
    { method: 'DELETE' }
  );
}

/**
 * セッションの現在の作業ディレクトリ（CWD）を取得する。
 * @param {string} session - セッション名
 * @returns {Promise<{path: string}>}
 */
export async function getSessionCwd(session) {
  return fetchAPI(`api/sessions/${encodeURIComponent(session)}/cwd`);
}

/**
 * ディレクトリ内のファイル一覧を取得する。
 * @param {string} session - セッション名
 * @param {string} [path='.'] - 相対パス
 * @returns {Promise<{path: string, abs_path: string, entries: Array<{name: string, size: number, is_dir: boolean, mod_time: string, extension: string}>}>}
 */
export async function listFiles(session, path = '.') {
  return fetchAPI(`api/sessions/${encodeURIComponent(session)}/files?path=${encodeURIComponent(path)}`);
}

/**
 * ファイルの内容を取得する。
 * @param {string} session - セッション名
 * @param {string} path - ファイルの相対パス
 * @returns {Promise<{content: string, truncated: boolean}>}
 */
export async function getFileContent(session, path) {
  return fetchAPI(`api/sessions/${encodeURIComponent(session)}/files?path=${encodeURIComponent(path)}`);
}

/**
 * ファイル名を再帰的に検索する。
 * @param {string} session - セッション名
 * @param {string} query - 検索クエリ（ファイル名部分一致）
 * @param {string} [path='.'] - 検索起点の相対パス
 * @returns {Promise<{query: string, results: Array<{path: string, name: string, is_dir: boolean, size: number}>}>}
 */
export async function searchFiles(session, query, path = '.') {
  return fetchAPI(`api/sessions/${encodeURIComponent(session)}/files/search?q=${encodeURIComponent(query)}&path=${encodeURIComponent(path)}`);
}

/**
 * ファイルの内容を保存する（上書き）。
 * @param {string} session - セッション名
 * @param {string} path - ファイルの相対パス
 * @param {string} content - 新しいファイル内容
 * @returns {Promise<{path: string, size: number}>}
 */
export async function saveFile(session, path, content) {
  return fetchAPI(`api/sessions/${encodeURIComponent(session)}/files?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

/**
 * ファイルの raw コンテンツ URL を生成する。
 * 認証トークンをクエリパラメータに付与する（ブラウザの img/iframe 等で使用するため）。
 * @param {string} session - セッション名
 * @param {string} path - ファイルの相対パス
 * @returns {string} raw ファイル URL
 */
export function getFileRawURL(session, path) {
  const basePath = getBasePath();
  const token = getToken();
  let url = `${basePath}api/sessions/${encodeURIComponent(session)}/files?path=${encodeURIComponent(path)}&raw=true`;
  if (token) {
    url += `&token=${encodeURIComponent(token)}`;
  }
  return url;
}

/**
 * ghq リポジトリ一覧を取得する。
 * @returns {Promise<Array<{name: string, path: string, full_path: string}>>}
 */
export async function listGhqRepos() {
  return fetchAPI('api/ghq/repos');
}

// --- Git API ---

/**
 * セッションの git status を取得する。
 * @param {string} session - セッション名
 * @returns {Promise<{branch: string, files: Array<{path: string, status: string, status_text: string}>}>}
 */
export async function getGitStatus(session) {
  return fetchAPI(`api/sessions/${encodeURIComponent(session)}/git/status`);
}

/**
 * セッションの git log を取得する。
 * @param {string} session - セッション名
 * @param {Object} [opts]
 * @param {string} [opts.branch] - ブランチ名
 * @param {number} [opts.limit] - 取得件数
 * @returns {Promise<Array<{hash: string, author_name: string, date: string, subject: string}>>}
 */
export async function getGitLog(session, { branch, limit } = {}) {
  const params = new URLSearchParams();
  if (branch) params.set('branch', branch);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return fetchAPI(`api/sessions/${encodeURIComponent(session)}/git/log${qs ? '?' + qs : ''}`);
}

/**
 * セッションの git diff を取得する。
 * @param {string} session - セッション名
 * @param {string} [path] - ファイルパス
 * @param {string} [commit] - コミットハッシュ
 * @returns {Promise<{diff: string}>}
 */
export async function getGitDiff(session, path, commit) {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  if (commit) params.set('commit', commit);
  const qs = params.toString();
  return fetchAPI(`api/sessions/${encodeURIComponent(session)}/git/diff${qs ? '?' + qs : ''}`);
}

/**
 * コミットで変更されたファイル一覧を取得する。
 * @param {string} session - セッション名
 * @param {string} commit - コミットハッシュ
 * @returns {Promise<Array<{path: string, status: string, status_text: string}>>}
 */
export async function getGitCommitFiles(session, commit) {
  return fetchAPI(`api/sessions/${encodeURIComponent(session)}/git/show?commit=${encodeURIComponent(commit)}`);
}

/**
 * セッションの git ブランチ一覧を取得する。
 * @param {string} session - セッション名
 * @returns {Promise<Array<{name: string, current: boolean, remote: boolean}>>}
 */
export async function getGitBranches(session) {
  return fetchAPI(`api/sessions/${encodeURIComponent(session)}/git/branches`);
}

/**
 * 画像ファイルをサーバーにアップロードし、保存先パスを返す。
 * fetchAPI() は Content-Type: application/json を固定するため、直接 fetch + FormData を使用する。
 * @param {File} file - アップロードする画像ファイル
 * @returns {Promise<{path: string}>} 保存先パス
 */
export async function uploadImage(file) {
  const basePath = getBasePath();
  const token = getToken();
  const url = basePath + 'api/upload';

  const formData = new FormData();
  formData.append('file', file);

  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload error: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * 通知一覧を取得する。
 * @returns {Promise<Array<{session: string, window_index: number, type: string}>>}
 */
export async function listNotifications() {
  return fetchAPI('api/notifications');
}

/**
 * 指定ウィンドウの通知を削除する。
 * @param {string} session - セッション名
 * @param {number} windowIndex - ウィンドウインデックス
 * @returns {Promise<null>}
 */
export async function deleteNotification(session, windowIndex) {
  return fetchAPI(
    `api/notifications?session=${encodeURIComponent(session)}&window=${windowIndex}`,
    { method: 'DELETE' }
  );
}

/**
 * WebSocket 接続用の URL を生成する。
 * base-path とプロトコル（ws/wss）を考慮し、認証トークンをクエリパラメータに付与する。
 * @param {string} session - セッション名
 * @param {number} index - ウィンドウインデックス
 * @returns {string} WebSocket URL
 */
export function getWebSocketURL(session, index) {
  const basePath = getBasePath();
  const token = getToken();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = `${basePath}api/sessions/${encodeURIComponent(session)}/windows/${index}/attach`;
  let url = `${protocol}//${location.host}${path}`;
  if (token) {
    url += `?token=${encodeURIComponent(token)}`;
  }
  return url;
}
