// app.js - メインアプリケーションロジック
// セッション一覧→選択→ターミナル表示のフロー
// Drawer による セッション/ウィンドウ切り替え

import { listSessions, listWindows, getWebSocketURL } from './api.js';
import { PalmuxTerminal } from './terminal.js';
import { Toolbar } from './toolbar.js';
import { IMEInput } from './ime-input.js';
import { Drawer } from './drawer.js';
import { TouchHandler } from './touch.js';
import { ConnectionManager } from './connection.js';
import { FileBrowser } from './filebrowser.js';

/** @type {PalmuxTerminal|null} */
let terminal = null;

/** @type {Toolbar|null} */
let toolbar = null;

/** @type {IMEInput|null} */
let imeInput = null;

/** @type {Drawer|null} */
let drawer = null;

/** @type {import('./touch.js').TouchHandler|null} */
let touchHandler = null;

/** @type {ConnectionManager|null} */
let connectionManager = null;

/** @type {Map<string, {wrapper: HTMLElement, browser: FileBrowser}>} セッションごとのファイルブラウザ */
const fileBrowsers = new Map();

/** @type {Map<string, string>} セッションごとの表示モード ('terminal' | 'filebrowser') */
const sessionViewModes = new Map();

/** 現在接続中のセッション名 */
let currentSession = null;

/** 現在接続中のウィンドウインデックス */
let currentWindowIndex = null;

/** 現在の表示モード: 'terminal' | 'filebrowser' */
let currentViewMode = 'terminal';

/**
 * セッション一覧画面に切り替えるUI処理（セッション読み込みは含まない）。
 * タッチハンドラー・IME・ツールバー・接続をクリーンアップし、
 * セッション一覧パネルを表示する。
 */
function _switchToSessionListView() {
  const sessionListEl = document.getElementById('session-list');
  const terminalViewEl = document.getElementById('terminal-view');
  const headerTitleEl = document.getElementById('header-title');
  const drawerBtnEl = document.getElementById('drawer-btn');

  // タッチハンドラーのクリーンアップ
  if (touchHandler) {
    touchHandler.destroy();
    touchHandler = null;
  }

  // IME 入力のクリーンアップ
  if (imeInput) {
    imeInput.destroy();
    imeInput = null;
  }

  // ツールバーのクリーンアップ
  if (toolbar) {
    toolbar.dispose();
    toolbar = null;
  }

  // ConnectionManager のクリーンアップ（自動再接続を止める）
  if (connectionManager) {
    connectionManager.disconnect();
    connectionManager = null;
  }

  // ターミナルが接続中なら切断
  if (terminal) {
    terminal.disconnect();
    terminal = null;
  }
  currentSession = null;
  currentWindowIndex = null;

  // 接続状態インジケーターを非表示
  const connectionStatusEl = document.getElementById('connection-status');
  if (connectionStatusEl) {
    connectionStatusEl.classList.add('hidden');
  }

  // 再接続オーバーレイを非表示
  const reconnectOverlayEl = document.getElementById('reconnect-overlay');
  if (reconnectOverlayEl) {
    reconnectOverlayEl.classList.add('hidden');
  }

  // FileBrowser のクリーンアップ（全セッション分）
  for (const [, entry] of fileBrowsers) {
    entry.browser.dispose();
  }
  fileBrowsers.clear();
  sessionViewModes.clear();
  currentViewMode = 'terminal';

  // UI 切り替え
  sessionListEl.classList.remove('hidden');
  terminalViewEl.classList.add('hidden');
  const filebrowserViewEl = document.getElementById('filebrowser-view');
  if (filebrowserViewEl) {
    filebrowserViewEl.classList.add('hidden');
  }
  headerTitleEl.textContent = 'Palmux';

  // ヘッダータブを非表示
  const headerTabsEl = document.getElementById('header-tabs');
  if (headerTabsEl) {
    headerTabsEl.classList.add('hidden');
  }

  // ツールバートグルボタンを非表示
  const toolbarToggleBtnEl = document.getElementById('toolbar-toggle-btn');
  if (toolbarToggleBtnEl) {
    toolbarToggleBtnEl.classList.add('hidden');
  }

  // フォントサイズコントロールを非表示
  const fontSizeControlsEl = document.getElementById('font-size-controls');
  if (fontSizeControlsEl) {
    fontSizeControlsEl.classList.add('hidden');
  }

  // drawer ボタンを非表示（セッション一覧では不要）
  if (drawerBtnEl) {
    drawerBtnEl.classList.add('hidden');
  }
}

/**
 * セッション一覧画面を表示する。
 * @param {{ push?: boolean, replace?: boolean }} [opts]
 */
async function showSessionList({ push = true, replace = false } = {}) {
  _switchToSessionListView();

  // ブラウザ履歴を更新
  if (replace) {
    history.replaceState({ view: 'sessions' }, '', '#sessions');
  } else if (push) {
    history.pushState({ view: 'sessions' }, '', '#sessions');
  }

  const sessionItemsEl = document.getElementById('session-items');

  // ローディング表示
  sessionItemsEl.innerHTML = '<div class="loading">Loading sessions...</div>';

  try {
    const sessions = await listSessions();

    if (!sessions || sessions.length === 0) {
      sessionItemsEl.innerHTML = '<div class="empty-message">No tmux sessions found.</div>';
      return;
    }

    sessionItemsEl.innerHTML = '';

    for (const session of sessions) {
      const item = document.createElement('div');
      item.className = 'session-item';
      item.addEventListener('click', () => showWindowList(session.name));

      const nameEl = document.createElement('div');
      nameEl.className = 'session-name';
      nameEl.textContent = session.name;

      const infoEl = document.createElement('div');
      infoEl.className = 'session-info';
      const windowCount = session.windows || 0;
      const attachedText = session.attached ? 'attached' : 'detached';
      infoEl.textContent = `${windowCount} window${windowCount !== 1 ? 's' : ''} | ${attachedText}`;

      item.appendChild(nameEl);
      item.appendChild(infoEl);
      sessionItemsEl.appendChild(item);
    }
  } catch (err) {
    console.error('Failed to load sessions:', err);
    sessionItemsEl.innerHTML = `<div class="error-message">Failed to load sessions: ${escapeHTML(err.message)}</div>`;
  }
}

/**
 * 指定セッションのウィンドウ一覧を表示する。
 * @param {string} sessionName - セッション名
 * @param {{ push?: boolean }} [opts]
 */
async function showWindowList(sessionName, { push = true } = {}) {
  const sessionItemsEl = document.getElementById('session-items');
  const headerTitleEl = document.getElementById('header-title');

  headerTitleEl.textContent = sessionName;

  sessionItemsEl.innerHTML = '<div class="loading">Loading windows...</div>';

  // ブラウザ履歴を更新（非同期処理の前に行う）
  if (push) {
    history.pushState(
      { view: 'windows', session: sessionName },
      '',
      `#windows/${encodeURIComponent(sessionName)}`
    );
  }

  try {
    const windows = await listWindows(sessionName);

    if (!windows || windows.length === 0) {
      sessionItemsEl.innerHTML = '<div class="empty-message">No windows found.</div>';
      return;
    }

    sessionItemsEl.innerHTML = '';

    for (const win of windows) {
      const item = document.createElement('div');
      item.className = 'session-item window-item';
      item.addEventListener('click', () => connectToWindow(sessionName, win.index));

      const nameEl = document.createElement('div');
      nameEl.className = 'session-name';
      nameEl.textContent = `${win.index}: ${win.name}`;

      const infoEl = document.createElement('div');
      infoEl.className = 'session-info';
      if (win.active) {
        infoEl.innerHTML = '<span class="active-indicator">&#9679;</span> active';
      }

      item.appendChild(nameEl);
      item.appendChild(infoEl);
      sessionItemsEl.appendChild(item);
    }
  } catch (err) {
    console.error('Failed to load windows:', err);
    sessionItemsEl.innerHTML = `<div class="error-message">Failed to load windows: ${escapeHTML(err.message)}</div>`;
  }
}

/**
 * 指定セッションのウィンドウにターミナル接続する。
 * @param {string} sessionName - セッション名
 * @param {number} windowIndex - ウィンドウインデックス
 * @param {{ push?: boolean, replace?: boolean }} [opts]
 */
function connectToWindow(sessionName, windowIndex, { push = true, replace = false } = {}) {
  const sessionListEl = document.getElementById('session-list');
  const terminalViewEl = document.getElementById('terminal-view');
  const terminalContainerEl = document.getElementById('terminal-container');
  const imeContainerEl = document.getElementById('ime-container');
  const toolbarContainerEl = document.getElementById('toolbar-container');
  const headerTitleEl = document.getElementById('header-title');
  const toolbarToggleBtnEl = document.getElementById('toolbar-toggle-btn');
  const drawerBtnEl = document.getElementById('drawer-btn');

  // 既存ターミナルをクリーンアップ
  if (touchHandler) {
    touchHandler.destroy();
    touchHandler = null;
  }
  if (imeInput) {
    imeInput.destroy();
    imeInput = null;
  }
  if (toolbar) {
    toolbar.dispose();
    toolbar = null;
  }
  if (connectionManager) {
    connectionManager.disconnect();
    connectionManager = null;
  }
  if (terminal) {
    terminal.disconnect();
    terminal = null;
  }

  // UI 切り替え
  sessionListEl.classList.add('hidden');
  terminalViewEl.classList.remove('hidden');
  const filebrowserViewEl = document.getElementById('filebrowser-view');
  if (filebrowserViewEl) {
    filebrowserViewEl.classList.add('hidden');
  }
  headerTitleEl.textContent = `${sessionName}:${windowIndex}`;
  currentViewMode = 'terminal';

  // ヘッダータブを表示してターミナルをアクティブにする
  const headerTabsEl = document.getElementById('header-tabs');
  if (headerTabsEl) {
    headerTabsEl.classList.remove('hidden');
  }
  const headerTabTerminal = document.getElementById('header-tab-terminal');
  const headerTabFiles = document.getElementById('header-tab-files');
  if (headerTabTerminal) {
    headerTabTerminal.classList.add('header-tab-btn--active');
  }
  if (headerTabFiles) {
    headerTabFiles.classList.remove('header-tab-btn--active');
  }

  // ツールバートグルボタンを表示
  if (toolbarToggleBtnEl) {
    toolbarToggleBtnEl.classList.remove('hidden');
  }

  // フォントサイズコントロールを表示
  const fontSizeControlsEl = document.getElementById('font-size-controls');
  if (fontSizeControlsEl) {
    fontSizeControlsEl.classList.remove('hidden');
  }

  // drawer ボタンを表示（ターミナル接続中のみ）
  if (drawerBtnEl) {
    drawerBtnEl.classList.remove('hidden');
  }

  currentSession = sessionName;
  currentWindowIndex = windowIndex;

  // ブラウザ履歴を更新
  const hash = `#terminal/${encodeURIComponent(sessionName)}/${windowIndex}`;
  const state = { view: 'terminal', session: sessionName, window: windowIndex };
  if (replace) {
    history.replaceState(state, '', hash);
  } else if (push) {
    history.pushState(state, '', hash);
  }

  // Drawer の現在位置を更新
  if (drawer) {
    drawer.setCurrent(sessionName, windowIndex);
  }

  // ターミナル初期化・接続
  terminal = new PalmuxTerminal(terminalContainerEl);

  // IME 入力フィールド初期化
  imeInput = new IMEInput(imeContainerEl, {
    onSend: (text) => terminal.sendInput(text),
    onToggle: (visible) => {
      terminal.setIMEMode(visible);
      // IME 表示/非表示でレイアウトが変わるのでターミナルを再フィット
      requestAnimationFrame(() => {
        terminal.fit();
      });
    },
  });

  // ツールバー初期化
  toolbar = new Toolbar(toolbarContainerEl, {
    onSendKey: (key) => terminal.sendInput(key),
    onKeyboardMode: (mode) => {
      terminal.setKeyboardMode(mode);
      if (mode === 'ime') {
        // IME モード: IME 入力バーを表示（show() 内の onToggle で setIMEMode も実行される）
        if (imeInput) {
          imeInput.show();
        }
      } else {
        // none / direct モード: IME 入力バーを非表示（hide() 内の onToggle で setIMEMode も実行される）
        if (imeInput) {
          imeInput.hide();
        }
      }
      requestAnimationFrame(() => {
        terminal.fit();
      });
    },
  });
  terminal.setToolbar(toolbar);
  imeInput.setToolbar(toolbar);

  // デスクトップではツールバーをデフォルト非表示
  if (!isMobileDevice()) {
    toolbar.toggleVisibility();
  }

  // タッチハンドラー初期化（スワイプでウィンドウ切り替え）
  touchHandler = new TouchHandler(terminalContainerEl, {
    onSwipeLeft: () => {
      // 左スワイプ: 次のウィンドウに切り替え
      if (currentSession !== null && currentWindowIndex !== null) {
        const nextIndex = currentWindowIndex + 1;
        switchWindow(currentSession, nextIndex);
      }
    },
    onSwipeRight: () => {
      // 右スワイプ: 前のウィンドウに切り替え
      if (currentSession !== null && currentWindowIndex !== null && currentWindowIndex > 0) {
        const prevIndex = currentWindowIndex - 1;
        switchWindow(currentSession, prevIndex);
      }
    },
    onPinchZoom: (delta) => {
      if (delta > 0) {
        terminal.increaseFontSize();
      } else {
        terminal.decreaseFontSize();
      }
    },
  });

  // ConnectionManager を作成して接続を管理
  connectionManager = new ConnectionManager({
    getWSUrl: () => getWebSocketURL(currentSession, currentWindowIndex),
    onStateChange: (state) => updateConnectionUI(state),
    terminal: terminal,
  });
  connectionManager.connect();

  // セッションごとの表示モードを復元
  // ただし push: false（履歴ナビゲーション）の場合はスキップ
  // — popstate ハンドラが必要なら showFileBrowser を別途呼び出す
  const savedViewMode = push || replace ? (sessionViewModes.get(sessionName) || 'terminal') : 'terminal';
  if (savedViewMode === 'filebrowser') {
    showFileBrowser(sessionName);
  } else {
    currentViewMode = 'terminal';
    terminal.focus();
  }
}

/**
 * 接続状態に応じて UI を更新する。
 * @param {string} state - 'connected' | 'connecting' | 'disconnected'
 */
function updateConnectionUI(state) {
  const connectionStatusEl = document.getElementById('connection-status');
  const connectionDotEl = connectionStatusEl?.querySelector('.connection-dot');
  const connectionTextEl = connectionStatusEl?.querySelector('.connection-text');
  const reconnectOverlayEl = document.getElementById('reconnect-overlay');

  if (!connectionStatusEl || !connectionDotEl || !connectionTextEl) return;

  // インジケーターを表示
  connectionStatusEl.classList.remove('hidden');

  // ドットのクラスをリセット
  connectionDotEl.classList.remove(
    'connection-dot--connected',
    'connection-dot--connecting',
    'connection-dot--disconnected'
  );

  // disconnected 状態のクリックハンドラー用クラスをリセット
  connectionStatusEl.classList.remove('connection-status--disconnected');

  switch (state) {
    case 'connected':
      connectionDotEl.classList.add('connection-dot--connected');
      connectionTextEl.textContent = '';
      if (reconnectOverlayEl) {
        reconnectOverlayEl.classList.add('hidden');
      }
      break;

    case 'connecting':
      connectionDotEl.classList.add('connection-dot--connecting');
      connectionTextEl.textContent = 'Reconnecting...';
      if (reconnectOverlayEl) {
        reconnectOverlayEl.classList.remove('hidden');
      }
      break;

    case 'disconnected':
      connectionDotEl.classList.add('connection-dot--disconnected');
      connectionTextEl.textContent = 'Disconnected';
      connectionStatusEl.classList.add('connection-status--disconnected');
      if (reconnectOverlayEl) {
        reconnectOverlayEl.classList.add('hidden');
      }
      break;
  }
}

/**
 * 同一セッション内のウィンドウを切り替える。
 * WebSocket を再接続して指定ウィンドウに接続する。
 * @param {string} sessionName - セッション名
 * @param {number} windowIndex - ウィンドウインデックス
 */
function switchWindow(sessionName, windowIndex) {
  connectToWindow(sessionName, windowIndex);
}

/**
 * 別セッションに切り替える（WebSocket 再接続）。
 * @param {string} sessionName - セッション名
 * @param {number} windowIndex - ウィンドウインデックス
 */
function switchSession(sessionName, windowIndex) {
  // 完全に再接続する
  connectToWindow(sessionName, windowIndex);
}

/**
 * ファイルブラウザ表示に切り替える。
 * ターミナルビューを隠し、ファイラーパネルを表示する。
 * セッションごとに独立したファイルブラウザ状態を管理する。
 * @param {string} sessionName - セッション名
 * @param {{ push?: boolean }} [opts]
 */
function showFileBrowser(sessionName, { push = true } = {}) {
  const terminalViewEl = document.getElementById('terminal-view');
  const filebrowserViewEl = document.getElementById('filebrowser-view');
  const filebrowserContainerEl = document.getElementById('filebrowser-container');
  const headerTabTerminal = document.getElementById('header-tab-terminal');
  const headerTabFiles = document.getElementById('header-tab-files');

  if (!terminalViewEl || !filebrowserViewEl || !filebrowserContainerEl) return;

  // ブラウザ履歴を更新
  if (push && currentSession !== null && currentWindowIndex !== null) {
    const hash = `#files/${encodeURIComponent(sessionName)}/${currentWindowIndex}`;
    history.pushState({ view: 'files', session: sessionName, window: currentWindowIndex }, '', hash);
  }

  // ターミナルを隠してファイラーを表示
  terminalViewEl.classList.add('hidden');
  filebrowserViewEl.classList.remove('hidden');

  // ツールバートグルを非表示（ターミナル専用）
  const toolbarToggleBtnEl = document.getElementById('toolbar-toggle-btn');
  if (toolbarToggleBtnEl) {
    toolbarToggleBtnEl.classList.add('hidden');
  }

  // フォントサイズコントロールは表示したまま（ファイルブラウザでも使用）
  const fontSizeControlsEl = document.getElementById('font-size-controls');
  if (fontSizeControlsEl) {
    fontSizeControlsEl.classList.remove('hidden');
  }

  // タブの状態を更新
  if (headerTabTerminal) {
    headerTabTerminal.classList.remove('header-tab-btn--active');
  }
  if (headerTabFiles) {
    headerTabFiles.classList.add('header-tab-btn--active');
  }

  currentViewMode = 'filebrowser';
  sessionViewModes.set(sessionName, 'filebrowser');

  // コンテナから現在のファイラーを取り外す（DOM を破壊せず保持）
  while (filebrowserContainerEl.firstChild) {
    filebrowserContainerEl.removeChild(filebrowserContainerEl.firstChild);
  }

  // セッション用の FileBrowser を取得 or 新規作成
  if (!fileBrowsers.has(sessionName)) {
    const wrapper = document.createElement('div');
    wrapper.style.height = '100%';
    const browser = new FileBrowser(wrapper, {
      onFileSelect: (session, path, entry) => {
        // Preview is handled internally by FileBrowser.showPreview()
      },
    });
    fileBrowsers.set(sessionName, { wrapper, browser });
    browser.open(sessionName);
  }

  // セッション用のファイラー DOM をコンテナに追加（状態が保持される）
  const entry = fileBrowsers.get(sessionName);
  filebrowserContainerEl.appendChild(entry.wrapper);
}

/**
 * ターミナル表示に戻す。
 * ファイラーパネルを隠し、ターミナルビューを表示する。
 * @param {{ push?: boolean }} [opts]
 */
function showTerminalView({ push = true } = {}) {
  const terminalViewEl = document.getElementById('terminal-view');
  const filebrowserViewEl = document.getElementById('filebrowser-view');
  const headerTabTerminal = document.getElementById('header-tab-terminal');
  const headerTabFiles = document.getElementById('header-tab-files');

  if (!terminalViewEl || !filebrowserViewEl) return;

  // ブラウザ履歴を更新
  if (push && currentSession !== null && currentWindowIndex !== null) {
    const hash = `#terminal/${encodeURIComponent(currentSession)}/${currentWindowIndex}`;
    history.pushState({ view: 'terminal', session: currentSession, window: currentWindowIndex }, '', hash);
  }

  // ファイラーを隠してターミナルを表示
  filebrowserViewEl.classList.add('hidden');
  terminalViewEl.classList.remove('hidden');

  // ツールバートグルとフォントサイズを再表示
  const toolbarToggleBtnEl = document.getElementById('toolbar-toggle-btn');
  if (toolbarToggleBtnEl) {
    toolbarToggleBtnEl.classList.remove('hidden');
  }
  const fontSizeControlsEl = document.getElementById('font-size-controls');
  if (fontSizeControlsEl) {
    fontSizeControlsEl.classList.remove('hidden');
  }

  // タブの状態を更新
  if (headerTabTerminal) {
    headerTabTerminal.classList.add('header-tab-btn--active');
  }
  if (headerTabFiles) {
    headerTabFiles.classList.remove('header-tab-btn--active');
  }

  currentViewMode = 'terminal';
  if (currentSession) {
    sessionViewModes.set(currentSession, 'terminal');
  }

  // ターミナルを再フィット
  if (terminal) {
    requestAnimationFrame(() => {
      terminal.fit();
      terminal.focus();
    });
  }
}

/**
 * URL ハッシュから初期画面を復元する。
 * ページ読み込み時にハッシュが存在する場合に呼び出す。
 * @param {string} hash - window.location.hash（例: "#terminal/main/0"）
 */
async function navigateFromHash(hash) {
  const parts = hash.slice(1).split('/');
  const view = parts[0];

  try {
    switch (view) {
      case 'sessions':
        await showSessionList({ replace: true });
        break;

      case 'windows': {
        const session = decodeURIComponent(parts[1] || '');
        if (!session) { await autoConnect(); break; }
        _switchToSessionListView();
        history.replaceState({ view: 'windows', session }, '', hash);
        await showWindowList(session, { push: false });
        break;
      }

      case 'terminal': {
        const session = decodeURIComponent(parts[1] || '');
        const win = parseInt(parts[2], 10);
        if (!session || isNaN(win)) { await autoConnect(); break; }
        history.replaceState({ view: 'terminal', session, window: win }, '', hash);
        connectToWindow(session, win, { push: false });
        break;
      }

      case 'files': {
        const session = decodeURIComponent(parts[1] || '');
        const win = parseInt(parts[2], 10);
        if (!session || isNaN(win)) { await autoConnect(); break; }
        history.replaceState({ view: 'files', session, window: win }, '', hash);
        connectToWindow(session, win, { push: false });
        showFileBrowser(session, { push: false });
        break;
      }

      default:
        await autoConnect();
    }
  } catch (err) {
    console.error('Hash navigation failed:', err);
    await autoConnect();
  }
}

/**
 * HTML をエスケープする。
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * モバイルデバイスかどうかを判定する。
 * タッチ対応かつ画面幅が狭い場合にモバイルと判定する。
 * @returns {boolean}
 */
function isMobileDevice() {
  return 'ontouchstart' in window && window.innerWidth <= 1024;
}

// アプリケーション初期化
document.addEventListener('DOMContentLoaded', () => {
  const toolbarToggleBtnEl = document.getElementById('toolbar-toggle-btn');
  const drawerBtnEl = document.getElementById('drawer-btn');

  // Drawer 初期化
  drawer = new Drawer({
    onSelectWindow: (session, windowIndex) => {
      // 同一セッション内のウィンドウ切り替え
      switchWindow(session, windowIndex);
    },
    onSelectSession: (sessionName, windowIndex) => {
      // 別セッションへの切り替え（再接続）
      switchSession(sessionName, windowIndex);
    },
    onCreateSession: (sessionName) => {
      // 新セッション作成後、最初のウィンドウ（index 0）に自動接続
      connectToWindow(sessionName, 0);
    },
    onDeleteSession: () => {
      // セッション削除後の処理（現在は特に何もしない。
      // 現在接続中のセッション削除は drawer 側でブロックされている）
    },
    onCreateWindow: (session, windowIndex) => {
      // ウィンドウ作成後、ヘッダータイトルを更新
      const headerTitleEl = document.getElementById('header-title');
      if (headerTitleEl && session === currentSession) {
        headerTitleEl.textContent = `${session}:${windowIndex}`;
      }
    },
    onDeleteWindow: () => {
      // ウィンドウ削除後、ヘッダータイトルを更新
      const headerTitleEl = document.getElementById('header-title');
      if (headerTitleEl && currentSession !== null && drawer) {
        // drawer の現在ウィンドウインデックスを反映
        headerTitleEl.textContent = `${currentSession}:${currentWindowIndex}`;
      }
    },
    onRenameWindow: (session, windowIndex, newName) => {
      // ウィンドウリネーム後、現在表示中のウィンドウならヘッダータイトルを更新
      if (session === currentSession && windowIndex === currentWindowIndex) {
        const headerTitleEl = document.getElementById('header-title');
        if (headerTitleEl) {
          headerTitleEl.textContent = `${session}:${windowIndex}`;
        }
      }
    },
  });

  // drawer ボタンのイベント
  if (drawerBtnEl) {
    drawerBtnEl.addEventListener('click', () => {
      if (drawer) {
        drawer.open();
      }
    });
  }

  // ツールバートグルボタンのイベント
  if (toolbarToggleBtnEl) {
    toolbarToggleBtnEl.addEventListener('click', () => {
      if (toolbar) {
        toolbar.toggleVisibility();
        // ツールバー表示/非表示でターミナルを再フィット
        if (terminal) {
          // 少し待ってからフィット（DOM 更新後）
          requestAnimationFrame(() => {
            terminal.fit();
          });
        }
      }
    });
  }

  // 接続状態インジケーターのクリック（手動再接続）
  const connectionStatusEl = document.getElementById('connection-status');
  if (connectionStatusEl) {
    connectionStatusEl.addEventListener('click', () => {
      if (connectionManager && connectionManager.state !== 'connected') {
        connectionManager.reconnectNow();
      }
    });
  }

  // ヘッダータブのイベント
  const headerTabTerminal = document.getElementById('header-tab-terminal');
  const headerTabFiles = document.getElementById('header-tab-files');

  if (headerTabTerminal) {
    headerTabTerminal.addEventListener('click', () => {
      if (currentViewMode !== 'terminal' && currentSession !== null) {
        showTerminalView();
      }
    });
  }

  if (headerTabFiles) {
    headerTabFiles.addEventListener('click', () => {
      if (currentViewMode !== 'filebrowser' && currentSession !== null) {
        showFileBrowser(currentSession);
      }
    });
  }

  // フォントサイズボタンのイベント（ターミナル / ファイルブラウザ 両対応）
  const fontDecreaseBtn = document.getElementById('font-decrease-btn');
  const fontIncreaseBtn = document.getElementById('font-increase-btn');
  if (fontDecreaseBtn) {
    fontDecreaseBtn.addEventListener('click', () => {
      if (currentViewMode === 'filebrowser' && currentSession && fileBrowsers.has(currentSession)) {
        fileBrowsers.get(currentSession).browser.decreaseFontSize();
      } else if (terminal) {
        terminal.decreaseFontSize();
      }
    });
  }
  if (fontIncreaseBtn) {
    fontIncreaseBtn.addEventListener('click', () => {
      if (currentViewMode === 'filebrowser' && currentSession && fileBrowsers.has(currentSession)) {
        fileBrowsers.get(currentSession).browser.increaseFontSize();
      } else if (terminal) {
        terminal.increaseFontSize();
      }
    });
  }

  // Visual Viewport API: ソフトキーボード表示時にビューポートを追従
  // #app の高さを可視領域に合わせる。ターミナルの再フィットは
  // terminal.js の ResizeObserver がコンテナサイズ変更を検知して自動実行する。
  const appEl = document.getElementById('app');
  if (window.visualViewport && appEl) {
    const updateViewport = () => {
      appEl.style.height = window.visualViewport.height + 'px';
    };
    window.visualViewport.addEventListener('resize', updateViewport);
    window.visualViewport.addEventListener('scroll', updateViewport);
  }

  // ブラウザの戻る/進むボタン（popstate）ハンドラ
  window.addEventListener('popstate', async (event) => {
    const s = event.state;
    if (!s) {
      // 履歴の最初のエントリまで戻った場合
      await showSessionList({ push: false });
      return;
    }
    switch (s.view) {
      case 'sessions':
        await showSessionList({ push: false });
        break;
      case 'windows':
        _switchToSessionListView();
        await showWindowList(s.session, { push: false });
        break;
      case 'terminal':
        // すでに同じセッション/ウィンドウに接続中なら再接続せずビューだけ切り替える
        if (currentSession === s.session && currentWindowIndex === s.window && terminal !== null) {
          showTerminalView({ push: false });
        } else {
          connectToWindow(s.session, s.window, { push: false });
        }
        break;
      case 'files':
        // すでに同じセッション/ウィンドウに接続中なら再接続せずビューだけ切り替える
        if (currentSession === s.session && currentWindowIndex === s.window && terminal !== null) {
          showFileBrowser(s.session, { push: false });
        } else {
          connectToWindow(s.session, s.window, { push: false });
          showFileBrowser(s.session, { push: false });
        }
        break;
    }
  });

  // 初期表示: ハッシュがあればそこから復元、なければ自動接続
  const initialHash = window.location.hash;
  if (initialHash && initialHash !== '#') {
    navigateFromHash(initialHash);
  } else {
    autoConnect();
  }
});

/**
 * 最後のセッション（Activity が最も新しいセッション）のアクティブウィンドウに自動接続する。
 * セッションが存在しない場合やエラー時はセッション一覧を表示する。
 */
async function autoConnect() {
  try {
    const sessions = await listSessions();

    if (!sessions || sessions.length === 0) {
      showSessionList({ replace: true });
      return;
    }

    // Activity が最も新しいセッションを選択
    let latest = sessions[0];
    for (let i = 1; i < sessions.length; i++) {
      if (new Date(sessions[i].activity) > new Date(latest.activity)) {
        latest = sessions[i];
      }
    }

    // そのセッションのウィンドウ一覧を取得し、アクティブウィンドウに接続
    const windows = await listWindows(latest.name);

    if (!windows || windows.length === 0) {
      showSessionList({ replace: true });
      return;
    }

    // アクティブウィンドウを探す。なければ最初のウィンドウ
    const activeWindow = windows.find((w) => w.active) || windows[0];
    connectToWindow(latest.name, activeWindow.index, { replace: true });
  } catch (err) {
    console.error('Auto-connect failed, showing session list:', err);
    showSessionList({ replace: true });
  }
}
