// app.js - メインアプリケーションロジック
// セッション一覧→選択→ターミナル表示のフロー
// Drawer による セッション/ウィンドウ切り替え
// PanelManager による分割画面サポート

import { listSessions, listWindows, listNotifications, deleteNotification, getSessionMode, createWindow, deleteWindow, renameWindow, restartClaudeWindow } from './api.js';
import { Drawer } from './drawer.js';
import { PanelManager } from './panel-manager.js';
import { Panel } from './panel.js';
import { TabBar } from './tab-bar.js';

/** @type {Drawer|null} */
let drawer = null;

/** @type {PanelManager|null} */
let panelManager = null;

/** @type {TabBar|null} */
let tabBar = null;

/** ツールバー/IME のグローバル状態（セッション切替で保持） */
const globalUIState = {
  toolbarVisible: null,  // null = 未初期化（デバイスデフォルトを使用）
  keyboardMode: 'none',
  ctrlState: 'off',
  altState: 'off',
};

/** @type {Set<string>} 前回の通知キー Set（新規通知検出用） */
let _prevNotificationKeys = new Set();

/**
 * Claude ウィンドウの新規通知を検出し、バイブレーションとブラウザ通知を送る。
 * @param {Array<{session: string, window_index: number, type: string}>} notifications
 */
function _checkClaudeNotificationHaptic(notifications) {
  const currentKeys = new Set();
  const claudeNotifications = [];

  for (const n of notifications) {
    const key = `${n.session}:${n.window_index}`;
    currentKeys.add(key);
    // 新しい通知かつ Claude ウィンドウ名の判定（window name は通知には含まれないため、
    // tabBar の情報を使って判定する）
    if (!_prevNotificationKeys.has(key)) {
      claudeNotifications.push(n);
    }
  }

  _prevNotificationKeys = currentKeys;

  if (claudeNotifications.length === 0) return;

  // tabBar のウィンドウ情報から Claude ウィンドウかを判定
  const hasNewClaudeNotif = tabBar && tabBar._isClaudeCodeMode &&
    claudeNotifications.some(n => {
      if (n.session !== tabBar._sessionName) return false;
      return tabBar._windows.some(w => w.index === n.window_index && w.name === 'claude');
    });

  if (!hasNewClaudeNotif) return;

  // バイブレーション
  if (navigator.vibrate) {
    navigator.vibrate([50, 100, 50]);
  }

  // ページ非表示時にブラウザ通知を送る
  if (document.hidden && Notification.permission === 'granted') {
    new Notification('Claude Code', {
      body: 'Waiting for approval',
      tag: 'palmux-claude-approval',
    });
  }
}

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

  // タブバーを非表示、ヘッダータイトルを表示
  if (tabBar) {
    tabBar.setVisible(false);
  }
  headerTitleEl.classList.remove('hidden');

  // UI 切り替え
  sessionListEl.classList.remove('hidden');
  if (panelContainerEl) {
    panelContainerEl.classList.add('hidden');
  }
  headerTitleEl.textContent = 'Palmux';

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

  // タブバーを表示、ヘッダータイトルを非表示
  if (tabBar) {
    tabBar.setVisible(true);
    _refreshTabBar(sessionName, { type: 'terminal', windowIndex });
  }
  headerTitleEl.classList.add('hidden');
  headerTitleEl.textContent = `${sessionName}:${windowIndex}`;

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
 * 保存されたタブ種別を復元する。files/git なら切り替え、terminal は何もしない。
 * @param {string} sessionName - セッション名
 */
function _restoreLastTab(sessionName) {
  const saved = Panel.getLastTab(sessionName);
  if (!saved || saved === 'terminal') return;
  if (saved === 'files') {
    showFileBrowser(sessionName, { push: false });
  } else if (saved === 'git') {
    showGitBrowser(sessionName, { push: false });
  }
}

/**
 * 別セッションに切り替える（WebSocket 再接続）。
 * @param {string} sessionName - セッション名
 * @param {number} windowIndex - ウィンドウインデックス
 */
async function switchSession(sessionName, windowIndex) {
  try {
    const mode = await getSessionMode(sessionName);
    if (mode && mode.claude_code && mode.claude_window >= 0) {
      connectToWindow(sessionName, mode.claude_window);
      _restoreLastTab(sessionName);
      return;
    }
  } catch {
    // ignore — フォールバックで指定ウィンドウに接続
  }
  connectToWindow(sessionName, windowIndex);
  _restoreLastTab(sessionName);
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

  // タブバーのアクティブタブを更新
  if (tabBar) {
    tabBar.setActiveTab({ type: 'files' });
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

  // Drawer の状態を更新
  if (drawer) {
    drawer.setCurrent(panelManager.getCurrentSession(), panelManager.getCurrentWindowIndex());
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

  // タブバーのアクティブタブを更新
  if (tabBar) {
    tabBar.setActiveTab({ type: 'terminal', windowIndex: panelManager.getCurrentWindowIndex() });
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

  // Drawer の状態を更新
  if (drawer) {
    drawer.setCurrent(panelManager.getCurrentSession(), panelManager.getCurrentWindowIndex());
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

  // タブバーのアクティブタブを更新
  if (tabBar) {
    tabBar.setActiveTab({ type: 'git' });
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

  // Drawer の状態を更新
  if (drawer) {
    drawer.setCurrent(panelManager.getCurrentSession(), panelManager.getCurrentWindowIndex());
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
 * フォーカスパネルの現在の状態からタブのアクティブ記述子を返す。
 * @returns {{type: string, windowIndex?: number}}
 */
function _getActiveTabDescriptor() {
  if (!panelManager) return { type: 'terminal', windowIndex: 0 };
  const panel = panelManager.getFocusedPanel();
  if (panel.viewMode === 'filebrowser') return { type: 'files' };
  if (panel.viewMode === 'gitbrowser') return { type: 'git' };
  return { type: 'terminal', windowIndex: panel.windowIndex };
}

/**
 * タブバーのウィンドウ一覧をリフレッシュする。
 * @param {string} sessionName
 * @param {{type: string, windowIndex?: number}} activeTab
 */
async function _refreshTabBar(sessionName, activeTab) {
  if (!tabBar) return;
  try {
    const [windows, mode] = await Promise.all([
      listWindows(sessionName),
      getSessionMode(sessionName).catch(() => null),
    ]);
    if (!windows) return;
    const isClaudeCodeMode = !!(mode && mode.claude_code);
    tabBar.setWindows(sessionName, windows, isClaudeCodeMode);
    tabBar.setActiveTab(activeTab);
    tabBar.scrollToActive();

    // アクティブタブが Claude ウィンドウかを判定してパネルに伝播
    if (panelManager) {
      const isClaudeTab = isClaudeCodeMode &&
        activeTab.type === 'terminal' &&
        windows.some(w => w.index === activeTab.windowIndex && w.name === 'claude');
      panelManager.getFocusedPanel().setClaudeWindow(isClaudeTab);
    }
  } catch (err) {
    console.error('Failed to refresh tab bar:', err);
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

  // TabBar 初期化
  const tabBarContainerEl = document.getElementById('tab-bar-container');
  tabBar = new TabBar({
    container: tabBarContainerEl,
    onTabSelect: ({ type, windowIndex }) => {
      if (!panelManager) return;
      const currentSession = panelManager.getCurrentSession();
      if (!currentSession) return;

      if (type === 'terminal') {
        connectToWindow(currentSession, windowIndex);
        // Claude ウィンドウかを判定してパネルに伝播
        const isClaudeTab = tabBar._isClaudeCodeMode &&
          tabBar._windows.some(w => w.index === windowIndex && w.name === 'claude');
        panelManager.getFocusedPanel().setClaudeWindow(isClaudeTab);
      } else if (type === 'files') {
        showFileBrowser(currentSession);
        panelManager.getFocusedPanel().setClaudeWindow(false);
      } else if (type === 'git') {
        showGitBrowser(currentSession);
        panelManager.getFocusedPanel().setClaudeWindow(false);
      }
    },
    onCreateWindow: async () => {
      const currentSession = panelManager?.getCurrentSession();
      if (!currentSession) return;
      try {
        const result = await createWindow(currentSession, '', '');
        connectToWindow(currentSession, result.index);
        _refreshTabBar(currentSession, { type: 'terminal', windowIndex: result.index });
      } catch (err) {
        console.error('Failed to create window:', err);
      }
    },
    onContextAction: async ({ action, windowIndex, windowName }) => {
      const currentSession = panelManager?.getCurrentSession();
      if (!currentSession) return;

      switch (action) {
        case 'restart':
          _showTabModelSelectDialog(currentSession, claudePath);
          break;
        case 'resume':
          _showTabModelSelectDialog(currentSession, `${claudePath} --continue`);
          break;
        case 'rename':
          _showTabRenameDialog(currentSession, windowIndex, windowName);
          break;
        case 'delete':
          await _handleTabDeleteWindow(currentSession, windowIndex);
          break;
      }
    },
  });

  /**
   * タブバーのコンテキストメニューから「Restart」「Resume」が選択されたとき、
   * モデル選択ダイアログを表示する。
   * @param {string} sessionName
   * @param {string} baseCommand - claude コマンドのベース（例: "claude" or "claude --continue"）
   */
  function _showTabModelSelectDialog(sessionName, baseCommand) {
    const existing = document.querySelector('.drawer-context-menu-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'drawer-context-menu-overlay';

    const menu = document.createElement('div');
    menu.className = 'drawer-context-menu';

    const title = document.createElement('div');
    title.className = 'drawer-context-menu-title';
    title.textContent = 'Select Model';
    menu.appendChild(title);

    const closeDialog = () => {
      overlay.classList.remove('drawer-context-menu-overlay--visible');
      setTimeout(() => overlay.remove(), 200);
    };

    const models = [
      { label: 'opus', flag: 'opus' },
      { label: 'sonnet', flag: 'sonnet' },
      { label: 'haiku', flag: 'haiku' },
    ];

    for (const model of models) {
      const btn = document.createElement('button');
      btn.className = 'drawer-context-menu-item';
      btn.textContent = model.label;
      btn.addEventListener('click', async () => {
        closeDialog();
        const command = `${baseCommand} --model ${model.flag}`;
        try {
          const win = await restartClaudeWindow(sessionName, command);
          connectToWindow(sessionName, win.index);
          _refreshTabBar(sessionName, { type: 'terminal', windowIndex: win.index });
        } catch (err) {
          console.error('Failed to restart claude window:', err);
        }
      });
      menu.appendChild(btn);
    }

    overlay.appendChild(menu);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.classList.add('drawer-context-menu-overlay--visible');
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog();
    });
  }

  /**
   * タブバーのコンテキストメニューから「Rename」が選択されたとき、
   * リネームダイアログを表示する。
   * @param {string} sessionName
   * @param {number} windowIndex
   * @param {string} currentName
   */
  function _showTabRenameDialog(sessionName, windowIndex, currentName) {
    const existing = document.querySelector('.drawer-context-menu-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'drawer-context-menu-overlay';

    const menu = document.createElement('div');
    menu.className = 'drawer-context-menu';

    const title = document.createElement('div');
    title.className = 'drawer-context-menu-title';
    title.textContent = 'Rename Window';
    menu.appendChild(title);

    const inputWrapper = document.createElement('div');
    inputWrapper.style.padding = '12px 16px';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'drawer-window-rename-input';
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    inputWrapper.appendChild(input);
    menu.appendChild(inputWrapper);

    const closeDialog = () => {
      overlay.classList.remove('drawer-context-menu-overlay--visible');
      setTimeout(() => overlay.remove(), 200);
    };

    const doRename = async () => {
      const newName = input.value.trim();
      if (!newName || newName === currentName) {
        closeDialog();
        return;
      }
      try {
        await renameWindow(sessionName, windowIndex, newName);
        closeDialog();
        _refreshTabBar(sessionName, _getActiveTabDescriptor());
      } catch (err) {
        console.error('Failed to rename window:', err);
        closeDialog();
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog();
      }
    });

    overlay.appendChild(menu);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.classList.add('drawer-context-menu-overlay--visible');
      input.focus();
      input.select();
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog();
    });
  }

  /**
   * タブバーのコンテキストメニューから「Delete」が選択されたとき、
   * ウィンドウを削除する。
   * @param {string} sessionName
   * @param {number} windowIndex
   */
  async function _handleTabDeleteWindow(sessionName, windowIndex) {
    try {
      await deleteWindow(sessionName, windowIndex);

      const currentWindowIndex = panelManager?.getCurrentWindowIndex();

      // If deleted window was the current one, switch to another
      if (currentWindowIndex === windowIndex) {
        const windows = await listWindows(sessionName);
        if (!windows || windows.length === 0) {
          showSessionList({ replace: true });
          return;
        }
        // Find previous window or first available
        const prevWindow = windows.reduce((prev, w) => {
          if (w.index < windowIndex && (prev === null || w.index > prev.index)) return w;
          return prev;
        }, null) || windows[0];
        connectToWindow(sessionName, prevWindow.index);
      }

      _refreshTabBar(sessionName, _getActiveTabDescriptor());
    } catch (err) {
      console.error('Failed to delete window:', err);
    }
  }

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
          if (tabBar && notifications) {
            tabBar.setNotifications(notifications);
          }
        })
        .catch(() => {});

      // ヘッダータイトルを更新
      const headerTitleEl = document.getElementById('header-title');
      if (headerTitleEl) {
        headerTitleEl.textContent = `${currentSession}:${currentWindowIndex}`;
      }

      // タブバーをリフレッシュ（tmux 側でウィンドウ変更された場合）
      if (tabBar && currentSession) {
        _refreshTabBar(currentSession, { type: 'terminal', windowIndex: currentWindowIndex });
      }

      if (drawer) {
        drawer.setCurrent(currentSession, currentWindowIndex, { sessionChanged: true });
      }
    },
    onNotificationUpdate: (notifications) => {
      if (drawer) {
        drawer.setNotifications(notifications);
      }
      if (tabBar) {
        tabBar.setNotifications(notifications);
      }
      _checkClaudeNotificationHaptic(notifications);
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

        if (drawer) {
          drawer.setCurrent(panel.session, panel.windowIndex);
        }

        // タブバーをフォーカスパネルの状態に同期
        if (tabBar) {
          _refreshTabBar(panel.session, _getActiveTabDescriptor());
        }
      }

      // Drawer パネルターゲットを更新
      _updateDrawerPanelTarget();
    },
  });

  // Drawer 初期化
  drawer = new Drawer({
    claudePath,
    onSelectSession: (sessionName, windowIndex) => {
      switchSession(sessionName, windowIndex);
    },
    onCreateSession: async (sessionName) => {
      try {
        const mode = await getSessionMode(sessionName);
        if (mode && mode.claude_code && mode.claude_window >= 0) {
          connectToWindow(sessionName, mode.claude_window);
          _restoreLastTab(sessionName);
          return;
        }
      } catch {
        // ignore
      }
      connectToWindow(sessionName, 0);
      _restoreLastTab(sessionName);
    },
    onDeleteSession: () => {
      showSessionList({ replace: true });
    },
    onClose: () => {
      // Drawer が閉じた後、フォーカスパネルのターミナルにフォーカスを戻す
      if (panelManager) {
        const panel = panelManager.getFocusedPanel();
        if (panel) {
          const terminal = panel.getTerminal();
          if (terminal && panel.viewMode === 'terminal') {
            terminal.focus();
          }
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

  // ブラウザ通知の権限リクエスト（初回ユーザー操作時）
  if ('Notification' in window && Notification.permission === 'default') {
    const requestNotificationPermission = () => {
      Notification.requestPermission();
      document.removeEventListener('click', requestNotificationPermission);
      document.removeEventListener('touchstart', requestNotificationPermission);
    };
    document.addEventListener('click', requestNotificationPermission, { once: true });
    document.addEventListener('touchstart', requestNotificationPermission, { once: true });
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

  // 初期通知を取得してドロワーとタブバーに反映
  listNotifications()
    .then((notifications) => {
      if (drawer && notifications) {
        drawer.setNotifications(notifications);
      }
      if (tabBar && notifications) {
        tabBar.setNotifications(notifications);
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

    // Claude Code モードなら claude ウィンドウに優先接続
    try {
      const mode = await getSessionMode(latest.name);
      if (mode && mode.claude_code && mode.claude_window >= 0) {
        connectToWindow(latest.name, mode.claude_window, { replace: true });
        _restoreLastTab(latest.name);
        return;
      }
    } catch { /* ignore */ }

    const activeWindow = windows.find((w) => w.active) || windows[0];
    connectToWindow(latest.name, activeWindow.index, { replace: true });
    _restoreLastTab(latest.name);
  } catch (err) {
    console.error('Auto-connect failed, showing session list:', err);
    showSessionList({ replace: true });
  }
}
