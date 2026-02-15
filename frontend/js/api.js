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
 * @returns {Promise<{index: number, name: string}>}
 */
export async function createWindow(session, name) {
  const body = name ? { name } : {};
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
