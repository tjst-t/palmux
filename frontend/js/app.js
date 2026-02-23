// app.js - メインアプリケーションロジック
// セッション一覧→選択→ターミナル表示のフロー
// Drawer による セッション/ウィンドウ切り替え
// PanelManager による分割画面サポート

import { listSessions, listWindows, listNotifications, deleteNotification } from './api.js';
import { Drawer } from './drawer.js';
import { PanelManager } from './panel-manager.js';

/** @type {Drawer|null} */
let drawer = null;

/** @type {PanelManager|null} */
let panelManager = null;

/** ツールバー/IME のグローバル状態（セッション切替で保持） */
const globalUIState = {
  toolbarVisible: null,  // null = 未初期化（デバイスデフォルトを使用）
  keyboardMode: 'none',
  ctrlState: 'off',
  altState: 'off',
};

/**
 * パネルの状態を URL フラグメントに変換する。
 * @param {import('./panel.js').Panel} panel
 * @returns {string} - "terminal/session/0", "files/session/0/path", "git/session/0"
 */
function _buildPanelFragment(panel) {
  const s = encodeURIComponent(panel.session);
  const w = panel.windowIndex;
  switch (panel.viewMode) {
    case 'filebrowser': {
      const path = panel.getCurrentFilePath();
      return `files/${s}/${w}${path && path !== '.' ? '/' + path : ''}`;
    }
    case 'gitbrowser':
      return `git/${s}/${w}`;
    default:
      return `terminal/${s}/${w}`;
  }
}

/**
 * 分割モード時の URL サフィックスを返す。
 * @returns {string} - "", "&split", "&split=terminal/dev/1" など
 */
function _getSplitSuffix() {
  if (!panelManager || !panelManager.isSplit) return '';
  const right = panelManager.getRightPanel();
  if (!right || !right.isConnected) return '&split';
  return '&split=' + _buildPanelFragment(right);
}

/**
 * 分割モード時の右パネル状態オブジェクトを返す。
 * @returns {object|null}
 */
function _buildRightPanelState() {
  if (!panelManager || !panelManager.isSplit) return null;
  const right = panelManager.getRightPanel();
  if (!right || !right.isConnected) return null;
  return {
    view: right.viewMode === 'filebrowser' ? 'files' : right.viewMode === 'gitbrowser' ? 'git' : 'terminal',
    session: right.session,
    window: right.windowIndex,
    path: right.getCurrentFilePath(),
  };
}

/**
 * 右パネルの URL フラグメントから状態を復元する。
 * @param {string} fragment - "terminal/dev/1", "files/dev/1/path/to/file", "git/dev/1"
 */
function _restoreRightPanel(fragment) {
  const parts = fragment.split('/');
  const view = parts[0];
  const session = decodeURIComponent(parts[1] || '');
  const win = parseInt(parts[2], 10);
  if (!session || isNaN(win)) return;

  const rightPanel = panelManager.getRightPanel();
  if (!rightPanel) return;

  rightPanel.connectToWindow(session, win);

  switch (view) {
    case 'files': {
      const path = parts.slice(3).map(decodeURIComponent).join('/') || '.';
      rightPanel.showFileBrowser(session, { path });
      break;
    }
    case 'git':
      rightPanel.showGitBrowser(session);
      break;
    // 'terminal' はデフォルト（connectToWindow 後の初期状態）
  }
}

/**
 * セッション一覧画面に切り替えるUI処理（セッション読み込みは含まない）。
 * PanelManager のパネルをクリーンアップし、セッション一覧パネルを表示する。
 */
function _switchToSessionListView() {
  const sessionListEl = document.getElementById('session-list');
  const panelContainerEl = document.getElementById('panel-container');
  const headerTitleEl = document.getElementById('header-title');
  const drawerBtnEl = document.getElementById('drawer-btn');

  // PanelManager のパネルをクリーンアップ
  if (panelManager) {
    // 分割モードの場合は解除
    if (panelManager.isSplit) {
      panelManager.toggleSplit();
    }
    panelManager.getLeftPanel().cleanup();
  }

  // 接続状態インジケーターを非表示
  const connectionStatusEl = document.getElementById('connection-status');
  if (connectionStatusEl) {
    connectionStatusEl.classList.add('hidden');
  }

  // UI 切り替え
  sessionListEl.classList.remove('hidden');
  if (panelContainerEl) {
    panelContainerEl.classList.add('hidden');
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

  // Split toggle ボタンを非表示
  const splitToggleBtnEl = document.getElementById('split-toggle-btn');
  if (splitToggleBtnEl) {
    splitToggleBtnEl.classList.add('hidden');
  }

  // drawer ボタンを非表示（セッション一覧では不要）
  if (drawerBtnEl) {
    drawerBtnEl.classList.add('hidden');
  }

  // Drawer パネルターゲットを非表示
  _updateDrawerPanelTarget();
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
 * PanelManager のフォーカスパネルに委譲する。
 * @param {string} sessionName - セッション名
 * @param {number} windowIndex - ウィンドウインデックス
 * @param {{ push?: boolean, replace?: boolean }} [opts]
 */
function connectToWindow(sessionName, windowIndex, { push = true, replace = false } = {}) {
  const sessionListEl = document.getElementById('session-list');
  const panelContainerEl = document.getElementById('panel-container');
  const headerTitleEl = document.getElementById('header-title');
  const toolbarToggleBtnEl = document.getElementById('toolbar-toggle-btn');
  const drawerBtnEl = document.getElementById('drawer-btn');

  // UI 切り替え
  sessionListEl.classList.add('hidden');
  if (panelContainerEl) {
    panelContainerEl.classList.remove('hidden');
  }
  headerTitleEl.textContent = `${sessionName}:${windowIndex}`;

  // ヘッダータブを表示（シングルモード時のみ。分割時はパネルヘッダーにタブがある）
  const headerTabsEl = document.getElementById('header-tabs');
  if (headerTabsEl) {
    if (panelManager && panelManager.isSplit) {
      headerTabsEl.classList.add('hidden');
    } else {
      headerTabsEl.classList.remove('hidden');
    }
  }
  _updateHeaderTabs('terminal');

  // ツールバートグルボタンを表示
  if (toolbarToggleBtnEl) {
    toolbarToggleBtnEl.classList.remove('hidden');
  }

  // フォントサイズコントロールを表示
  const fontSizeControlsEl = document.getElementById('font-size-controls');
  if (fontSizeControlsEl) {
    fontSizeControlsEl.classList.remove('hidden');
  }

  // Split toggle を表示
  const splitToggleBtnEl = document.getElementById('split-toggle-btn');
  if (splitToggleBtnEl) {
    splitToggleBtnEl.classList.remove('hidden');
  }

  // drawer ボタンを表示（ターミナル接続中のみ、ピン留め中は非表示）
  if (drawerBtnEl) {
    if (drawer && drawer.isPinned) {
      drawerBtnEl.classList.add('hidden');
    } else {
      drawerBtnEl.classList.remove('hidden');
    }
  }

  // PanelManager のフォーカスパネルに接続
  if (panelManager) {
    panelManager.connectToWindow(sessionName, windowIndex);
  }

  // ブラウザ履歴を更新
  const splitSuffix = _getSplitSuffix();
  const hash = `#terminal/${encodeURIComponent(sessionName)}/${windowIndex}${splitSuffix}`;
  const state = { view: 'terminal', session: sessionName, window: windowIndex, split: !!(panelManager && panelManager.isSplit), rightPanel: _buildRightPanelState() };
  if (replace) {
    history.replaceState(state, '', hash);
  } else if (push) {
    history.pushState(state, '', hash);
  }

  // Drawer の現在位置を更新
  if (drawer) {
    drawer.setCurrent(sessionName, windowIndex);
    drawer.restorePinState();
  }

  // Drawer パネルターゲットを更新
  _updateDrawerPanelTarget();
}

/**
 * 接続状態に応じてヘッダーの接続インジケーターを更新する。
 * @param {string} state - 'connected' | 'connecting' | 'disconnected'
 */
function updateConnectionUI(state) {
  const connectionStatusEl = document.getElementById('connection-status');
  const connectionDotEl = connectionStatusEl?.querySelector('.connection-dot');
  const connectionTextEl = connectionStatusEl?.querySelector('.connection-text');

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
      break;

    case 'connecting':
      connectionDotEl.classList.add('connection-dot--connecting');
      connectionTextEl.textContent = 'Reconnecting...';
      break;

    case 'disconnected':
      connectionDotEl.classList.add('connection-dot--disconnected');
      connectionTextEl.textContent = 'Disconnected';
      connectionStatusEl.classList.add('connection-status--disconnected');
      break;
  }
}

/**
 * 同一セッション内のウィンドウを切り替える。
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
  connectToWindow(sessionName, windowIndex);
}

/**
 * フォーカスパネルのファイルブラウザ表示に切り替える。
 * @param {string} sessionName - セッション名
 * @param {{ push?: boolean, path?: string|null }} [opts]
 */
function showFileBrowser(sessionName, { push = true, path = null } = {}) {
  if (!panelManager) return;
  const panel = panelManager.getFocusedPanel();

  panel.showFileBrowser(sessionName, { path });

  // ヘッダータブを更新（シングルモード時）
  if (!panelManager.isSplit) {
    _updateHeaderTabs('filebrowser');
  }

  // ツールバートグルを非表示（ターミナル専用）
  const toolbarToggleBtnEl = document.getElementById('toolbar-toggle-btn');
  if (toolbarToggleBtnEl) {
    toolbarToggleBtnEl.classList.add('hidden');
  }

  // ブラウザ履歴を更新
  const currentSession = panelManager.getCurrentSession();
  const currentWindowIndex = panelManager.getCurrentWindowIndex();
  if (push && currentSession !== null && currentWindowIndex !== null) {
    const splitSuffix = _getSplitSuffix();
    const filePath = path || '.';
    const hash = `#files/${encodeURIComponent(sessionName)}/${currentWindowIndex}${filePath !== '.' ? '/' + filePath : ''}${splitSuffix}`;
    history.pushState(
      { view: 'files', session: sessionName, window: currentWindowIndex, path: filePath, split: panelManager.isSplit, rightPanel: _buildRightPanelState() },
      '',
      hash,
    );
  }
}

/**
 * フォーカスパネルのターミナル表示に戻す。
 * @param {{ push?: boolean }} [opts]
 */
function showTerminalView({ push = true } = {}) {
  if (!panelManager) return;
  const panel = panelManager.getFocusedPanel();

  panel.showTerminalView();

  // ヘッダータブを更新（シングルモード時）
  if (!panelManager.isSplit) {
    _updateHeaderTabs('terminal');
  }

  // ツールバートグルを再表示
  const toolbarToggleBtnEl = document.getElementById('toolbar-toggle-btn');
  if (toolbarToggleBtnEl) {
    toolbarToggleBtnEl.classList.remove('hidden');
  }

  // ブラウザ履歴を更新
  const currentSession = panelManager.getCurrentSession();
  const currentWindowIndex = panelManager.getCurrentWindowIndex();
  if (push && currentSession !== null && currentWindowIndex !== null) {
    const splitSuffix = _getSplitSuffix();
    const hash = `#terminal/${encodeURIComponent(currentSession)}/${currentWindowIndex}${splitSuffix}`;
    history.pushState({ view: 'terminal', session: currentSession, window: currentWindowIndex, split: panelManager.isSplit, rightPanel: _buildRightPanelState() }, '', hash);
  }
}

/**
 * フォーカスパネルの Git ブラウザ表示に切り替える。
 * @param {string} sessionName - セッション名
 * @param {{ push?: boolean }} [opts]
 */
function showGitBrowser(sessionName, { push = true } = {}) {
  if (!panelManager) return;
  const panel = panelManager.getFocusedPanel();

  panel.showGitBrowser(sessionName);

  // ヘッダータブを更新（シングルモード時）
  if (!panelManager.isSplit) {
    _updateHeaderTabs('gitbrowser');
  }

  // ツールバートグルを非表示（ターミナル専用）
  const toolbarToggleBtnEl = document.getElementById('toolbar-toggle-btn');
  if (toolbarToggleBtnEl) {
    toolbarToggleBtnEl.classList.add('hidden');
  }

  // ブラウザ履歴を更新
  const currentSession = panelManager.getCurrentSession();
  const currentWindowIndex = panelManager.getCurrentWindowIndex();
  if (push && currentSession !== null && currentWindowIndex !== null) {
    const splitSuffix = _getSplitSuffix();
    const hash = `#git/${encodeURIComponent(sessionName)}/${currentWindowIndex}${splitSuffix}`;
    history.pushState(
      { view: 'git', session: sessionName, window: currentWindowIndex, split: panelManager.isSplit, rightPanel: _buildRightPanelState() },
      '',
      hash,
    );
  }
}

/**
 * ヘッダータブの active 状態を更新する（シングルモード時に使用）。
 * @param {'terminal'|'filebrowser'|'gitbrowser'} mode
 */
function _updateHeaderTabs(mode) {
  const headerTabTerminal = document.getElementById('header-tab-terminal');
  const headerTabFiles = document.getElementById('header-tab-files');
  const headerTabGit = document.getElementById('header-tab-git');

  if (headerTabTerminal) {
    headerTabTerminal.classList.toggle('header-tab-btn--active', mode === 'terminal');
  }
  if (headerTabFiles) {
    headerTabFiles.classList.toggle('header-tab-btn--active', mode === 'filebrowser');
  }
  if (headerTabGit) {
    headerTabGit.classList.toggle('header-tab-btn--active', mode === 'gitbrowser');
  }
}

/**
 * Drawer のパネルターゲット表示を更新する。
 */
function _updateDrawerPanelTarget() {
  const targetEl = document.getElementById('drawer-panel-target');
  if (!targetEl) return;

  if (panelManager && panelManager.isSplit) {
    const focused = panelManager.getFocusedPanel();
    const label = focused.id === 'left' ? 'Left' : 'Right';
    targetEl.textContent = `\u2192 ${label} Panel`;
    targetEl.classList.add('drawer-panel-target--visible');
  } else {
    targetEl.classList.remove('drawer-panel-target--visible');
  }
}

/**
 * URL ハッシュから初期画面を復元する。
 * @param {string} hash - window.location.hash（例: "#terminal/main/0" or "#terminal/main/0&split=terminal/dev/1"）
 */
async function navigateFromHash(hash) {
  // Parse &split and optional right panel fragment
  const hashBody = hash.slice(1);
  const splitIdx = hashBody.indexOf('&split');
  let hasSplit = false;
  let rightFragment = null;
  let cleanHash = hashBody;

  if (splitIdx !== -1) {
    hasSplit = true;
    cleanHash = hashBody.slice(0, splitIdx);
    const splitPart = hashBody.slice(splitIdx + 6); // "&split".length = 6
    if (splitPart.startsWith('=') && splitPart.length > 1) {
      rightFragment = splitPart.slice(1); // "=" の後ろ
    }
  }

  const parts = cleanHash.split('/');
  const view = parts[0];

  /**
   * 分割モードを復元し、右パネルの状態を適用する。
   */
  const restoreSplit = () => {
    if (hasSplit && panelManager && !panelManager.isSplit && window.innerWidth >= 900) {
      // rightFragment がある場合は自動接続をスキップ
      panelManager.toggleSplit({ skipAutoConnect: !!rightFragment });
    }
    if (hasSplit && rightFragment && panelManager && panelManager.isSplit) {
      _restoreRightPanel(rightFragment);
    }
  };

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
        history.replaceState({ view: 'terminal', session, window: win, split: hasSplit }, '', hash);
        connectToWindow(session, win, { push: false });
        restoreSplit();
        break;
      }

      case 'files': {
        const session = decodeURIComponent(parts[1] || '');
        const win = parseInt(parts[2], 10);
        const filePath = parts.slice(3).map(decodeURIComponent).join('/') || '.';
        if (!session || isNaN(win)) { await autoConnect(); break; }
        history.replaceState({ view: 'files', session, window: win, path: filePath, split: hasSplit }, '', hash);
        connectToWindow(session, win, { push: false });
        showFileBrowser(session, { push: false, path: filePath });
        restoreSplit();
        break;
      }

      case 'git': {
        const session = decodeURIComponent(parts[1] || '');
        const win = parseInt(parts[2], 10);
        if (!session || isNaN(win)) { await autoConnect(); break; }
        history.replaceState({ view: 'git', session, window: win, split: hasSplit }, '', hash);
        connectToWindow(session, win, { push: false });
        showGitBrowser(session, { push: false });
        restoreSplit();
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
 * @returns {boolean}
 */
function isMobileDevice() {
  return 'ontouchstart' in window && window.innerWidth <= 1024;
}

// アプリケーション初期化
document.addEventListener('DOMContentLoaded', () => {
  const toolbarToggleBtnEl = document.getElementById('toolbar-toggle-btn');
  const drawerBtnEl = document.getElementById('drawer-btn');
  const splitToggleBtnEl = document.getElementById('split-toggle-btn');
  const panelContainerEl = document.getElementById('panel-container');

  // claude-path meta タグからコマンドパスを読み取る
  const claudePathMeta = document.querySelector('meta[name="claude-path"]');
  const claudePath = claudePathMeta ? (claudePathMeta.getAttribute('content') || 'claude') : 'claude';

  // PanelManager 初期化
  panelManager = new PanelManager({
    container: panelContainerEl,
    globalUIState,
    isMobileDevice,
    onClientStatus: (session, window) => {
      // フォーカスパネルのセッション/ウィンドウ変更を反映
      const currentSession = panelManager.getCurrentSession();
      const currentWindowIndex = panelManager.getCurrentWindowIndex();

      // 通知をクリア
      deleteNotification(session, window)
        .then(() => listNotifications())
        .then((notifications) => {
          if (drawer && notifications) {
            drawer.setNotifications(notifications);
          }
        })
        .catch(() => {});

      // ヘッダータイトルを更新
      const headerTitleEl = document.getElementById('header-title');
      if (headerTitleEl) {
        headerTitleEl.textContent = `${currentSession}:${currentWindowIndex}`;
      }

      if (drawer) {
        drawer.setCurrent(currentSession, currentWindowIndex, { sessionChanged: true });
      }
    },
    onNotificationUpdate: (notifications) => {
      if (drawer) {
        drawer.setNotifications(notifications);
      }
    },
    onConnectionStateChange: (state) => {
      updateConnectionUI(state);
    },
    onFocusChange: (panel) => {
      // フォーカス変更時にヘッダーを更新
      if (panel.session !== null && panel.windowIndex !== null) {
        const headerTitleEl = document.getElementById('header-title');
        if (headerTitleEl) {
          headerTitleEl.textContent = `${panel.session}:${panel.windowIndex}`;
        }

        // シングルモードのヘッダータブを更新
        if (!panelManager.isSplit) {
          _updateHeaderTabs(panel.viewMode);
        }

        if (drawer) {
          drawer.setCurrent(panel.session, panel.windowIndex);
        }
      }

      // Drawer パネルターゲットを更新
      _updateDrawerPanelTarget();
    },
  });

  // Drawer 初期化
  drawer = new Drawer({
    claudePath,
    onSelectWindow: (session, windowIndex) => {
      switchWindow(session, windowIndex);
    },
    onSelectSession: (sessionName, windowIndex) => {
      switchSession(sessionName, windowIndex);
    },
    onCreateSession: (sessionName) => {
      connectToWindow(sessionName, 0);
    },
    onDeleteSession: () => {
      showSessionList({ replace: true });
    },
    onCreateWindow: (session, windowIndex) => {
      const headerTitleEl = document.getElementById('header-title');
      const currentSession = panelManager ? panelManager.getCurrentSession() : null;
      if (headerTitleEl && session === currentSession) {
        headerTitleEl.textContent = `${session}:${windowIndex}`;
      }
    },
    onDeleteWindow: () => {
      const headerTitleEl = document.getElementById('header-title');
      const currentSession = panelManager ? panelManager.getCurrentSession() : null;
      const currentWindowIndex = panelManager ? panelManager.getCurrentWindowIndex() : null;
      if (headerTitleEl && currentSession !== null) {
        headerTitleEl.textContent = `${currentSession}:${currentWindowIndex}`;
      }
    },
    onRenameWindow: (session, windowIndex, newName) => {
      const currentSession = panelManager ? panelManager.getCurrentSession() : null;
      const currentWindowIndex = panelManager ? panelManager.getCurrentWindowIndex() : null;
      if (session === currentSession && windowIndex === currentWindowIndex) {
        const headerTitleEl = document.getElementById('header-title');
        if (headerTitleEl) {
          headerTitleEl.textContent = `${session}:${windowIndex}`;
        }
      }
    },
    onClose: () => {
      // Drawer が閉じた後、フォーカスパネルのターミナルにフォーカスを戻す
      if (panelManager) {
        const panel = panelManager.getFocusedPanel();
        const terminal = panel.getTerminal();
        if (terminal && panel.viewMode === 'terminal') {
          terminal.focus();
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
      if (panelManager) {
        panelManager.getFocusedPanel().toggleToolbar();
      }
    });
  }

  // Split toggle ボタンのイベント
  if (splitToggleBtnEl) {
    splitToggleBtnEl.addEventListener('click', () => {
      if (panelManager) {
        panelManager.toggleSplit();

        // ヘッダータブの表示を切り替え
        const headerTabsEl = document.getElementById('header-tabs');
        if (headerTabsEl) {
          if (panelManager.isSplit) {
            // 分割モード: ヘッダータブは非表示（パネルヘッダーにタブがある）
            headerTabsEl.classList.add('hidden');
          } else {
            // シングルモード: ヘッダータブを表示
            headerTabsEl.classList.remove('hidden');
            _updateHeaderTabs(panelManager.getCurrentViewMode());
          }
        }

        // ツールバートグルの表示を更新
        if (toolbarToggleBtnEl) {
          const viewMode = panelManager.getCurrentViewMode();
          if (viewMode === 'terminal') {
            toolbarToggleBtnEl.classList.remove('hidden');
          } else {
            toolbarToggleBtnEl.classList.add('hidden');
          }
        }

        // Split toggle ボタンのアクティブ状態
        splitToggleBtnEl.classList.toggle('split-toggle-btn--active', panelManager.isSplit);

        // Drawer パネルターゲットを更新
        _updateDrawerPanelTarget();
      }
    });
  }

  // 接続状態インジケーターのクリック（手動再接続）
  const connectionStatusEl = document.getElementById('connection-status');
  if (connectionStatusEl) {
    connectionStatusEl.addEventListener('click', () => {
      if (panelManager) {
        panelManager.getFocusedPanel().reconnectNow();
      }
    });
  }

  // ヘッダータブのイベント（シングルモード時のみ有効）
  const headerTabTerminal = document.getElementById('header-tab-terminal');
  const headerTabFiles = document.getElementById('header-tab-files');
  const headerTabGit = document.getElementById('header-tab-git');

  if (headerTabTerminal) {
    headerTabTerminal.addEventListener('click', () => {
      if (panelManager && !panelManager.isSplit) {
        const currentSession = panelManager.getCurrentSession();
        if (panelManager.getCurrentViewMode() !== 'terminal' && currentSession !== null) {
          showTerminalView();
        }
      }
    });
  }

  if (headerTabFiles) {
    headerTabFiles.addEventListener('click', () => {
      if (panelManager && !panelManager.isSplit) {
        const currentSession = panelManager.getCurrentSession();
        if (panelManager.getCurrentViewMode() !== 'filebrowser' && currentSession !== null) {
          showFileBrowser(currentSession);
        }
      }
    });
  }

  if (headerTabGit) {
    headerTabGit.addEventListener('click', () => {
      if (panelManager && !panelManager.isSplit) {
        const currentSession = panelManager.getCurrentSession();
        if (panelManager.getCurrentViewMode() !== 'gitbrowser' && currentSession !== null) {
          showGitBrowser(currentSession);
        }
      }
    });
  }

  // フォントサイズボタンのイベント
  const fontDecreaseBtn = document.getElementById('font-decrease-btn');
  const fontIncreaseBtn = document.getElementById('font-increase-btn');
  if (fontDecreaseBtn) {
    fontDecreaseBtn.addEventListener('click', () => {
      if (panelManager) {
        panelManager.getFocusedPanel().decreaseFontSize();
      }
    });
  }
  if (fontIncreaseBtn) {
    fontIncreaseBtn.addEventListener('click', () => {
      if (panelManager) {
        panelManager.getFocusedPanel().increaseFontSize();
      }
    });
  }

  // Visual Viewport API: ソフトキーボード表示時にビューポートを追従
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
      await showSessionList({ push: false });
      return;
    }

    /**
     * popstate で右パネルの状態を復元する。
     */
    const restoreRightPanelFromState = () => {
      if (!panelManager) return;

      // 分割状態の同期
      if (s.split && !panelManager.isSplit && window.innerWidth >= 900) {
        panelManager.toggleSplit({ skipAutoConnect: !!s.rightPanel });
      } else if (!s.split && panelManager.isSplit) {
        panelManager.toggleSplit();
      }

      // 右パネルの状態を復元
      if (s.rightPanel && panelManager.isSplit) {
        const rp = s.rightPanel;
        const rightPanel = panelManager.getRightPanel();
        if (rightPanel && rp.session) {
          rightPanel.connectToWindow(rp.session, rp.window);
          switch (rp.view) {
            case 'files':
              rightPanel.showFileBrowser(rp.session, { path: rp.path || '.' });
              break;
            case 'git':
              rightPanel.showGitBrowser(rp.session);
              break;
          }
        }
      }
    };

    switch (s.view) {
      case 'sessions':
        await showSessionList({ push: false });
        break;
      case 'windows':
        _switchToSessionListView();
        await showWindowList(s.session, { push: false });
        break;
      case 'terminal': {
        const currentSession = panelManager ? panelManager.getCurrentSession() : null;
        const currentWindowIndex = panelManager ? panelManager.getCurrentWindowIndex() : null;
        const terminal = panelManager ? panelManager.getTerminal() : null;
        if (currentSession === s.session && currentWindowIndex === s.window && terminal !== null) {
          showTerminalView({ push: false });
        } else {
          connectToWindow(s.session, s.window, { push: false });
        }
        restoreRightPanelFromState();
        break;
      }
      case 'files': {
        const filePath = s.path || '.';
        const currentSession = panelManager ? panelManager.getCurrentSession() : null;
        const currentWindowIndex = panelManager ? panelManager.getCurrentWindowIndex() : null;
        const terminal = panelManager ? panelManager.getTerminal() : null;
        if (currentSession === s.session && currentWindowIndex === s.window && terminal !== null) {
          showFileBrowser(s.session, { push: false, path: filePath });
        } else {
          connectToWindow(s.session, s.window, { push: false });
          showFileBrowser(s.session, { push: false, path: filePath });
        }
        restoreRightPanelFromState();
        break;
      }
      case 'git': {
        const currentSession = panelManager ? panelManager.getCurrentSession() : null;
        const currentWindowIndex = panelManager ? panelManager.getCurrentWindowIndex() : null;
        const terminal = panelManager ? panelManager.getTerminal() : null;
        if (currentSession === s.session && currentWindowIndex === s.window && terminal !== null) {
          showGitBrowser(s.session, { push: false });
        } else {
          connectToWindow(s.session, s.window, { push: false });
          showGitBrowser(s.session, { push: false });
        }
        // git 内部状態（コミット選択、diff 表示など）を復元
        if (s.gitState && panelManager) {
          const gitBrowsers = panelManager.getGitBrowsers();
          if (gitBrowsers.has(s.session)) {
            gitBrowsers.get(s.session).browser.restoreState(s.gitState);
          }
        }
        restoreRightPanelFromState();
        break;
      }
    }
  });

  // 初期通知を取得してドロワーに反映
  listNotifications()
    .then((notifications) => {
      if (drawer && notifications) {
        drawer.setNotifications(notifications);
      }
    })
    .catch((err) => {
      console.error('Failed to load initial notifications:', err);
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
 * 最後のセッションのアクティブウィンドウに自動接続する。
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

    const windows = await listWindows(latest.name);

    if (!windows || windows.length === 0) {
      showSessionList({ replace: true });
      return;
    }

    const activeWindow = windows.find((w) => w.active) || windows[0];
    connectToWindow(latest.name, activeWindow.index, { replace: true });
  } catch (err) {
    console.error('Auto-connect failed, showing session list:', err);
    showSessionList({ replace: true });
  }
}
