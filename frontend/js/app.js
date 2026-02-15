// app.js - メインアプリケーションロジック
// セッション一覧→選択→ターミナル表示のフロー
// Drawer による セッション/ウィンドウ切り替え

import { listSessions, listWindows, getWebSocketURL } from './api.js';
import { PalmuxTerminal } from './terminal.js';
import { Toolbar } from './toolbar.js';
import { IMEInput } from './ime-input.js';
import { Drawer } from './drawer.js';
import { TouchHandler } from './touch.js';

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

/** 現在接続中のセッション名 */
let currentSession = null;

/** 現在接続中のウィンドウインデックス */
let currentWindowIndex = null;

/**
 * セッション一覧画面を表示する。
 */
async function showSessionList() {
  const sessionListEl = document.getElementById('session-list');
  const terminalViewEl = document.getElementById('terminal-view');
  const headerTitleEl = document.getElementById('header-title');
  const backBtnEl = document.getElementById('back-btn');
  const sessionItemsEl = document.getElementById('session-items');
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

  // ターミナルが接続中なら切断
  if (terminal) {
    terminal.disconnect();
    terminal = null;
  }
  currentSession = null;
  currentWindowIndex = null;

  // UI 切り替え
  sessionListEl.classList.remove('hidden');
  terminalViewEl.classList.add('hidden');
  headerTitleEl.textContent = 'Palmux';
  backBtnEl.classList.add('hidden');

  // ツールバートグルボタンを非表示
  const toolbarToggleBtnEl = document.getElementById('toolbar-toggle-btn');
  if (toolbarToggleBtnEl) {
    toolbarToggleBtnEl.classList.add('hidden');
  }

  // drawer ボタンを非表示（セッション一覧では不要）
  if (drawerBtnEl) {
    drawerBtnEl.classList.add('hidden');
  }

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
 */
async function showWindowList(sessionName) {
  const sessionItemsEl = document.getElementById('session-items');
  const headerTitleEl = document.getElementById('header-title');
  const backBtnEl = document.getElementById('back-btn');

  headerTitleEl.textContent = sessionName;
  backBtnEl.classList.remove('hidden');

  sessionItemsEl.innerHTML = '<div class="loading">Loading windows...</div>';

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
 */
function connectToWindow(sessionName, windowIndex) {
  const sessionListEl = document.getElementById('session-list');
  const terminalViewEl = document.getElementById('terminal-view');
  const terminalContainerEl = document.getElementById('terminal-container');
  const imeContainerEl = document.getElementById('ime-container');
  const toolbarContainerEl = document.getElementById('toolbar-container');
  const headerTitleEl = document.getElementById('header-title');
  const backBtnEl = document.getElementById('back-btn');
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
  if (terminal) {
    terminal.disconnect();
    terminal = null;
  }

  // UI 切り替え
  sessionListEl.classList.add('hidden');
  terminalViewEl.classList.remove('hidden');
  headerTitleEl.textContent = `${sessionName}:${windowIndex}`;
  backBtnEl.classList.remove('hidden');

  // ツールバートグルボタンを表示
  if (toolbarToggleBtnEl) {
    toolbarToggleBtnEl.classList.remove('hidden');
  }

  // drawer ボタンを表示（ターミナル接続中のみ）
  if (drawerBtnEl) {
    drawerBtnEl.classList.remove('hidden');
  }

  currentSession = sessionName;
  currentWindowIndex = windowIndex;

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
    onToggleIME: () => {
      if (imeInput) {
        imeInput.toggle();
      }
    },
  });
  terminal.setToolbar(toolbar);

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
      // ピンチズーム: Task 5 で実装予定（フォントサイズ調整）
    },
  });

  const wsUrl = getWebSocketURL(sessionName, windowIndex);
  terminal.connect(wsUrl, () => {
    // 切断時はセッション一覧に戻る
    console.log('WebSocket disconnected');
  });
  terminal.focus();
}

/**
 * 同一セッション内のウィンドウを切り替える。
 * tmux の prefix + コマンドモードで select-window を実行する。
 * @param {string} sessionName - セッション名
 * @param {number} windowIndex - ウィンドウインデックス
 */
function switchWindow(sessionName, windowIndex) {
  if (!terminal) return;

  // tmux prefix (Ctrl+B) + コマンドモード(:) + select-window コマンド + Enter
  // \x02 = Ctrl+B (default tmux prefix)
  terminal.sendInput('\x02:select-window -t :' + windowIndex + '\r');

  // ヘッダータイトルを更新
  const headerTitleEl = document.getElementById('header-title');
  headerTitleEl.textContent = `${sessionName}:${windowIndex}`;

  currentWindowIndex = windowIndex;

  // Drawer の現在位置を更新
  if (drawer) {
    drawer.setCurrent(sessionName, windowIndex);
  }

  // ターミナルにフォーカスを戻す
  terminal.focus();
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
 * HTML をエスケープする。
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// アプリケーション初期化
document.addEventListener('DOMContentLoaded', () => {
  const backBtnEl = document.getElementById('back-btn');
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
  });

  // drawer ボタンのイベント
  if (drawerBtnEl) {
    drawerBtnEl.addEventListener('click', () => {
      if (drawer) {
        drawer.open();
      }
    });
  }

  // 戻るボタンのイベント
  backBtnEl.addEventListener('click', () => {
    if (terminal && currentSession !== null) {
      // ターミナル表示中 → セッション一覧に戻る
      showSessionList();
    } else if (currentSession === null) {
      // ウィンドウ一覧表示中は既に showSessionList で処理される
      showSessionList();
    }
  });

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

  // 初期表示: セッション一覧
  showSessionList();
});
