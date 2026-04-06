<script>
/**
 * App.svelte - ルートコンポーネント
 * app.js + router.js の全オーケストレーションロジックを Svelte に移行
 */

import { onMount, onDestroy } from 'svelte';
import {
  listSessions, listWindows, listNotifications, deleteNotification,
  getSessionMode, createWindow, deleteWindow, renameWindow, restartClaudeWindow,
  createSession, deleteSession as deleteSessionAPI,
  listGhqRepos, cloneGhqRepo, deleteGhqRepo,
  listProjectWorktrees, createProjectWorktree, deleteProjectWorktree,
  listProjectBranches, isProjectBranchMerged, deleteProjectBranch,
} from '../js/api.js';
import PanelManager from './lib/PanelManager.svelte';
import { Router } from '../js/router.js';
import SessionList from './lib/SessionList.svelte';
import TabBar from './lib/TabBar.svelte';
import Drawer from './lib/Drawer.svelte';
import ContextMenuManager from './lib/ContextMenuManager.svelte';
import { getTheme, toggleTheme } from './stores/theme.svelte.js';
import * as windowStore from './stores/windowStore.svelte.js';
import * as headerPoll from './stores/headerPoll.svelte.js';
import { fetchCachedCommands, sendCommandToWindow } from '../js/commandRunner.js';

// ─────────── Meta tags ───────────
const basePath = document.querySelector('meta[name="base-path"]')?.getAttribute('content') || '/';
const authToken = document.querySelector('meta[name="auth-token"]')?.getAttribute('content') || '';
const claudePathMeta = document.querySelector('meta[name="claude-path"]');
const claudePath = claudePathMeta ? (claudePathMeta.getAttribute('content') || 'claude') : 'claude';
const appVersion = document.querySelector('meta[name="app-version"]')?.getAttribute('content') || '';

// ─────────── State ───────────
// currentView, currentSessionName, currentWindowIndex は store から読む
let currentView = $derived(windowStore.getActiveView());
let currentSessionName = $derived(windowStore.getActiveSession());
let currentWindowIndex = $derived(windowStore.getActiveWindowIndex());

// Session list state
let sessionListSessions = $state([]);
let sessionListWindows = $state([]);
let sessionListLoading = $state(false);
let sessionListError = $state(null);

// UI state
let headerTitle = $state('Palmux');
let headerTitleVisible = $state(true);
let tabBarVisible = $state(false);
let toolbarToggleVisible = $state(false);
let fontControlsVisible = $state(false);
let splitToggleVisible = $state(false);
let drawerBtnVisible = $state(false);
let portmanLeases = $derived(windowStore.getPortmanLeases());
let portmanVisible = $derived(!!windowStore.getPortmanLeases());
let githubURL = $derived(windowStore.getGithubURL());
let githubVisible = $derived(!!windowStore.getGithubURL());
let splitActive = $state(false);
let headerMenuOpen = $state(false);
let drawerPanelTarget = $state('');
let drawerPanelTargetVisible = $state(false);

// Theme
let currentTheme = $derived(getTheme());

// Global UI state (shared across Panel/Toolbar/IME components)
const globalUIState = {
  toolbarVisible: null,
  keyboardMode: 'none',
  ctrlState: 'off',
  altState: 'off',
};

/** @type {Set<string>} */
let _prevNotificationKeys = new Set();

// ─────────── Component refs ───────────
/** @type {ReturnType<typeof PanelManager>|null} */
let panelManager = $state(null);
/** @type {Router|null} */
let router = null;

// ─────────── Svelte component refs ───────────
let drawerRef = $state(null);
let contextMenuRef = $state(null);

const CLAUDE_MODELS = [
  { label: 'opus', flag: 'opus' },
  { label: 'opus (plan)', flag: 'opusplan' },
  { label: 'sonnet', flag: 'sonnet' },
  { label: 'haiku', flag: 'haiku' },
];

// TabBar shadow state は削除済み — windowStore から直接読む

// _sendCommandToWindow と _fetchCachedCommands は commandRunner.js に移動
function _sendCommandToWindow(windowIndex, command) {
  sendCommandToWindow(panelManager, windowIndex, command);
}

// ─────────── Helpers ───────────

function isMobileDevice() {
  return 'ontouchstart' in window && window.innerWidth <= 1024;
}

function _checkClaudeNotificationHaptic(notifications) {
  const currentKeys = new Set();
  const claudeNotifications = [];

  for (const n of notifications) {
    const key = `${n.session}:${n.window_index}`;
    currentKeys.add(key);
    if (!_prevNotificationKeys.has(key)) {
      claudeNotifications.push(n);
    }
  }
  _prevNotificationKeys = currentKeys;

  if (claudeNotifications.length === 0) return;

  const storeWindows = windowStore.getWindows();
  const hasNewClaudeNotif = windowStore.getIsClaudeCodeMode() &&
    claudeNotifications.some(n => {
      if (n.session !== windowStore.getActiveSession()) return false;
      return storeWindows.some(w => w.index === n.window_index && w.name === 'claude');
    });

  if (!hasNewClaudeNotif) return;

  if (navigator.vibrate) {
    navigator.vibrate([50, 100, 50]);
  }
  if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification('Claude Code', {
      body: 'Waiting for approval',
      tag: 'palmux-claude-approval',
    });
  }
}

function _buildRightPanelState() {
  if (!panelManager || !panelManager.getIsSplit()) return null;
  const right = panelManager.getRightPanel();
  if (!right || !right.getIsConnected()) return null;
  const vm = right.getViewMode();
  return {
    view: vm === 'filebrowser' ? 'files' : vm === 'gitbrowser' ? 'git' : 'terminal',
    session: right.getSession(),
    window: right.getWindowIndex(),
    path: right.getCurrentFilePath(),
  };
}

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
  }
}

function _getActiveTabDescriptor() {
  if (!panelManager) return { type: 'terminal', windowIndex: 0 };
  const panel = panelManager.getFocusedPanel();
  const vm = panel.getViewMode();
  if (vm === 'filebrowser') return { type: 'files' };
  if (vm === 'gitbrowser') return { type: 'git' };
  return { type: 'terminal', windowIndex: panel.getWindowIndex() };
}

function _updateDrawerPanelTarget() {
  if (panelManager && panelManager.getIsSplit()) {
    const focusedId = panelManager.getFocusedPanelId();
    const label = focusedId === 'left' ? 'Left' : 'Right';
    drawerPanelTarget = `\u2192 ${label} Panel`;
    drawerPanelTargetVisible = true;
  } else {
    drawerPanelTargetVisible = false;
  }
}

async function _refreshTabBar(sessionName, activeTabDesc, { skipModeCheck = false } = {}) {
  try {
    // Store 経由でリフレッシュ（レース防止・リクエスト合体）
    await windowStore.refreshWindows(sessionName, { skipModeCheck });

    const windows = windowStore.getWindows();
    const isClaudeCodeMode = windowStore.getIsClaudeCodeMode();

    // Store の activeTab を更新 → TabBar は props 経由で自動反映
    windowStore.setActiveTab(activeTabDesc);

    if (panelManager) {
      panelManager.getFocusedPanel().pruneTerminalTabs(windows);
      const rightPanel = panelManager.getRightPanel();
      if (rightPanel) rightPanel.pruneTerminalTabs(windows);
    }

    if (panelManager) {
      const isClaudeTab = isClaudeCodeMode &&
        activeTabDesc.type === 'terminal' &&
        windows.some(w => w.index === activeTabDesc.windowIndex && w.name === 'claude');
      panelManager.getFocusedPanel().setClaudeWindow(isClaudeTab);
    }
  } catch (err) {
    console.error('Failed to refresh tab bar:', err);
  }

  // バッジ・ボタンの即時更新（ポーリング周期を待たずに反映）
  _headerPollTick();
}

// ─────────── ヘッダー状態の定期ポーリング ───────────
// headerPoll.svelte.js に移動済み

function _startHeaderPoll() { headerPoll.startPoll(); }
function _stopHeaderPoll() { headerPoll.stopPoll(); }
function _headerPollTick() { headerPoll.tick(); }

function _getLastTab(sessionName) {
  try { return localStorage.getItem(`palmux-last-tab-${sessionName}`); }
  catch { return null; }
}

function _restoreLastTab(sessionName) {
  const saved = _getLastTab(sessionName);
  if (!saved || saved === 'terminal') return;
  if (saved === 'files') {
    showFileBrowser(sessionName, { push: false });
  } else if (saved === 'git') {
    showGitBrowser(sessionName, { push: false });
  }
}

// ─────────── View switching ───────────

function _switchToSessionListView() {
  _stopHeaderPoll();
  windowStore.navigateToSessionList();

  if (panelManager) {
    if (panelManager.getIsSplit()) panelManager.toggleSplit();
    panelManager.getLeftPanel().cleanup();
  }

  tabBarVisible = false;
  headerTitleVisible = true;
  headerTitle = 'Palmux';
  toolbarToggleVisible = false;
  fontControlsVisible = false;
  splitToggleVisible = false;
  // portman/github は store 経由で自動クリア（navigateToSessionList）
  drawerBtnVisible = false;
  _updateDrawerPanelTarget();
}

async function showSessionList({ push = true, replace = false } = {}) {
  _switchToSessionListView();

  if (router) {
    const state = { view: 'sessions' };
    if (replace) router.replace(state);
    else if (push) router.push(state);
  }

  sessionListLoading = true;
  sessionListError = null;
  sessionListSessions = [];

  try {
    const sessions = await listSessions();
    if (!sessions || sessions.length === 0) {
      sessionListSessions = [];
    } else {
      sessionListSessions = sessions;
    }
  } catch (err) {
    console.error('Failed to load sessions:', err);
    sessionListError = `Failed to load sessions: ${err.message}`;
  } finally {
    sessionListLoading = false;
  }
}

async function showWindowList(sessionName, { push = true } = {}) {
  windowStore.navigateToWindowList(sessionName);
  headerTitle = sessionName;

  if (push && router) {
    router.push({ view: 'windows', session: sessionName });
  }

  sessionListLoading = true;
  sessionListError = null;
  sessionListWindows = [];

  try {
    const windows = await listWindows(sessionName);
    if (!windows || windows.length === 0) {
      sessionListWindows = [];
    } else {
      sessionListWindows = windows;
    }
  } catch (err) {
    console.error('Failed to load windows:', err);
    sessionListError = `Failed to load windows: ${err.message}`;
  } finally {
    sessionListLoading = false;
  }
}

function connectToWindow(sessionName, windowIndex, { push = true, replace = false, skipModeCheck = false, forceClean = false } = {}) {
  windowStore.navigateToWindow(sessionName, windowIndex);

  tabBarVisible = true;
  _refreshTabBar(sessionName, { type: 'terminal', windowIndex }, { skipModeCheck });
  headerTitleVisible = false;
  headerTitle = `${sessionName}:${windowIndex}`;
  toolbarToggleVisible = true;
  fontControlsVisible = true;
  splitToggleVisible = true;

  if (drawerRef && drawerRef.getIsPinned()) {
    drawerBtnVisible = false;
  } else {
    drawerBtnVisible = true;
  }

  if (panelManager) {
    panelManager.connectToWindow(sessionName, windowIndex, forceClean ? { forceClean: true } : undefined);
  }

  if (router) {
    const state = {
      view: 'terminal', session: sessionName, window: windowIndex,
      split: !!(panelManager && panelManager.getIsSplit()),
      rightPanel: _buildRightPanelState(),
    };
    if (replace) router.replace(state);
    else if (push) router.push(state);
  }

  // currentSession/windowIndex は store → Drawer props で自動同期
  if (drawerRef) {
    drawerRef.restorePinState();
  }

  _updateDrawerPanelTarget();
  _startHeaderPoll();
}

function showFileBrowser(sessionName, { push = true, path = null } = {}) {
  if (!panelManager) return;
  const panel = panelManager.getFocusedPanel();
  panel.showFileBrowser(sessionName, { path });

  windowStore.navigateToFiles();
  toolbarToggleVisible = false;

  const currentSession = panelManager.getCurrentSession();
  const currentWindowIdx = panelManager.getCurrentWindowIndex();
  if (push && router && currentSession !== null && currentWindowIdx !== null) {
    router.push({
      view: 'files', session: sessionName, window: currentWindowIdx,
      filePath: path || '.', split: panelManager.getIsSplit(), rightPanel: _buildRightPanelState(),
    });
  }
}

function showTerminalView({ push = true } = {}) {
  if (!panelManager) return;
  const panel = panelManager.getFocusedPanel();
  panel.showTerminalView();

  windowStore.navigateToTerminal(panelManager.getCurrentWindowIndex());
  toolbarToggleVisible = true;

  const currentSession = panelManager.getCurrentSession();
  const currentWindowIdx = panelManager.getCurrentWindowIndex();
  if (push && router && currentSession !== null && currentWindowIdx !== null) {
    router.push({
      view: 'terminal', session: currentSession, window: currentWindowIdx,
      split: panelManager.getIsSplit(), rightPanel: _buildRightPanelState(),
    });
  }
}

function showGitBrowser(sessionName, { push = true } = {}) {
  if (!panelManager) return;
  const panel = panelManager.getFocusedPanel();
  panel.showGitBrowser(sessionName);

  windowStore.navigateToGit();
  toolbarToggleVisible = false;

  const currentSession = panelManager.getCurrentSession();
  const currentWindowIdx = panelManager.getCurrentWindowIndex();
  if (push && router && currentSession !== null && currentWindowIdx !== null) {
    router.push({
      view: 'git', session: sessionName, window: currentWindowIdx,
      split: panelManager.getIsSplit(), rightPanel: _buildRightPanelState(),
    });
  }
}

function switchWindow(sessionName, windowIndex) {
  connectToWindow(sessionName, windowIndex);
}

async function switchSession(sessionName, windowIndex) {
  try {
    const mode = await getSessionMode(sessionName);
    if (mode && mode.claude_code && mode.claude_window >= 0) {
      connectToWindow(sessionName, mode.claude_window);
      _restoreLastTab(sessionName);
      return;
    }
  } catch { /* ignore */ }
  connectToWindow(sessionName, windowIndex);
  _restoreLastTab(sessionName);
}

function updateConnectionUI(state) {
  // Update global UI state store (used by other components)
  // Connection indicator removed from header, but state is still tracked
  void state;
}

async function autoConnect() {
  try {
    const sessions = await listSessions();
    if (!sessions || sessions.length === 0) {
      showSessionList({ replace: true });
      return;
    }
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
    console.error('Auto-connect failed:', err);
    showSessionList({ replace: true });
  }
}

// ─────────── Context menus / Dialogs ───────────

function _showPortmanURLMenu(leases) {
  if (contextMenuRef) contextMenuRef.showPortmanUrls(leases);
}

function _showTabModelSelectDialog(sessionName, baseCommand) {
  if (contextMenuRef) contextMenuRef.showModelSelect(sessionName, baseCommand);
}

function _showTabRenameDialog(sessionName, windowIndex, currentName) {
  if (contextMenuRef) contextMenuRef.showRename(sessionName, windowIndex, currentName);
}

async function _handleRestartClaude(sessionName, command) {
  try {
    const win = await restartClaudeWindow(sessionName, command);
    // forceClean: 古いタブの WebSocket 接続を全てクリアし、新しい接続のみにする
    // skipModeCheck: EnsureClaudeWindow がプロセス起動前に bash を検出して再作成するのを防ぐ
    connectToWindow(sessionName, win.index, { skipModeCheck: true, forceClean: true });
  } catch (err) {
    console.error('Failed to restart claude window:', err);
  }
}

async function _handleRenameWindow(sessionName, windowIndex, newName) {
  try {
    await renameWindow(sessionName, windowIndex, newName);
    _refreshTabBar(sessionName, _getActiveTabDescriptor());
  } catch (err) {
    console.error('Failed to rename window:', err);
  }
}

async function _handleTabDeleteWindow(sessionName, windowIndex) {
  try {
    await deleteWindow(sessionName, windowIndex);
    const curWinIdx = panelManager?.getCurrentWindowIndex();

    if (panelManager) {
      panelManager.getFocusedPanel().removeTerminalTab(windowIndex);
      const rightPanel = panelManager.getRightPanel();
      if (rightPanel) rightPanel.removeTerminalTab(windowIndex);
    }

    if (curWinIdx === windowIndex) {
      const windows = await listWindows(sessionName);
      if (!windows || windows.length === 0) {
        showSessionList({ replace: true });
        return;
      }
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

// ─────────── TabBar callbacks ───────────

function handleTabSelect(type, windowIndex) {
  if (type === 'add') {
    handleCreateWindow();
    return;
  }
  if (!panelManager) return;
  const currentSession = panelManager.getCurrentSession();
  if (!currentSession) return;

  if (type === 'terminal') {
    connectToWindow(currentSession, windowIndex);
    const isClaudeTab = windowStore.getIsClaudeCodeMode() &&
      windowStore.getWindows().some(w => w.index === windowIndex && w.name === 'claude');
    panelManager.getFocusedPanel().setClaudeWindow(isClaudeTab);
  } else if (type === 'files') {
    showFileBrowser(currentSession);
    panelManager.getFocusedPanel().setClaudeWindow(false);
  } else if (type === 'git') {
    showGitBrowser(currentSession);
    panelManager.getFocusedPanel().setClaudeWindow(false);
  }
}

async function handleCreateWindow() {
  const currentSession = panelManager?.getCurrentSession();
  if (!currentSession) return;
  try {
    const result = await createWindow(currentSession, '', '');
    connectToWindow(currentSession, result.index);
    _refreshTabBar(currentSession, { type: 'terminal', windowIndex: result.index });
  } catch (err) {
    console.error('Failed to create window:', err);
  }
}

async function handleTabContextMenu(event, type, windowIndex) {
  const currentSession = panelManager?.getCurrentSession();
  if (!currentSession) return;
  if (type !== 'terminal') return;

  // Find the window name
  const storeWins = windowStore.getWindows();
  const win = storeWins.find(w => w.index === windowIndex);
  const windowName = win ? win.name : '';
  const isClaudeTab = windowStore.getIsClaudeCodeMode() && win && win.name === 'claude';

  // Build context menu items
  const items = [];

  if (isClaudeTab) {
    // Claude タブ: Restart / Resume のみ（Makefile コマンドは不要）
    items.push({ label: 'Restart', action: () => _showTabModelSelectDialog(currentSession, claudePath) });
    items.push({ label: 'Resume', action: () => _showTabModelSelectDialog(currentSession, `${claudePath} --continue`) });
  } else {
    // 通常タブ: Makefile/project commands（Restart/Resume は不要）
    const commands = await fetchCachedCommands(currentSession);
    if (commands.length > 0) {
      // "serve" command goes at top level
      const serveCmd = commands.find(c => c.label === 'serve');
      if (serveCmd) {
        items.push({
          label: serveCmd.label,
          action: () => _sendCommandToWindow(windowIndex, serveCmd.command),
        });
      }

      // Other commands go into a submenu
      const otherCommands = commands.filter(c => c.label !== 'serve');
      if (otherCommands.length > 0) {
        items.push({
          label: 'Commands',
          submenu: otherCommands.map(cmd => ({
            label: cmd.label,
            action: () => _sendCommandToWindow(windowIndex, cmd.command),
          })),
        });
      }

      items.push({ separator: true });
    }
  }
  items.push({ label: 'Rename', action: () => _showTabRenameDialog(currentSession, windowIndex, windowName) });
  items.push({ label: 'Delete', action: () => _handleTabDeleteWindow(currentSession, windowIndex) });

  _showContextMenu(event.x, event.y, items, event.isMobile);
}

function _showContextMenu(x, y, items, isMobile = false) {
  if (contextMenuRef) contextMenuRef.showContextMenu(x, y, items, isMobile);
}

// ─────────── Button handlers ───────────

function handleDrawerOpen() {
  if (drawerRef) drawerRef.open();
}

function handleToolbarToggle() {
  if (panelManager) panelManager.getFocusedPanel().toggleToolbar();
}

function handleSplitToggle() {
  if (!panelManager) return;
  panelManager.toggleSplit();
  const viewMode = panelManager.getCurrentViewMode();
  toolbarToggleVisible = viewMode === 'terminal';
  splitActive = panelManager.getIsSplit();
  _updateDrawerPanelTarget();
}

function handleFontDecrease() {
  if (panelManager) panelManager.getFocusedPanel().decreaseFontSize();
}

function handleFontIncrease() {
  if (panelManager) panelManager.getFocusedPanel().increaseFontSize();
}

function handleThemeToggle() {
  toggleTheme();
  if (panelManager) {
    const isDark = getTheme() === 'dark';
    panelManager.applyTerminalTheme(isDark);
  }
}

function handlePortmanClick() {
  if (!portmanLeases || portmanLeases.length === 0) return;
  if (portmanLeases.length === 1) {
    window.open(portmanLeases[0].url, '_blank');
  } else {
    _showPortmanURLMenu(portmanLeases);
  }
}

function handleGitHubClick() {
  if (githubURL) window.open(githubURL + '/issues', '_blank');
}

// ─────────── Drawer callbacks ───────────

function handleDrawerSelectSession(sessionName, windowIndex) {
  switchSession(sessionName, windowIndex);
}

async function handleDrawerCreateSession(sessionName) {
  try {
    const mode = await getSessionMode(sessionName);
    if (mode && mode.claude_code && mode.claude_window >= 0) {
      connectToWindow(sessionName, mode.claude_window);
      _restoreLastTab(sessionName);
      return;
    }
  } catch { /* ignore */ }
  connectToWindow(sessionName, 0);
  _restoreLastTab(sessionName);
}

function handleDrawerDeleteSession() {
  showSessionList({ replace: true });
}

function handleDrawerClose() {
  if (panelManager) {
    const panel = panelManager.getFocusedPanel();
    if (panel) {
      const terminal = panel.getTerminal();
      if (terminal && panel.getViewMode() === 'terminal') {
        terminal.focus();
      }
    }
  }
}

function handleDrawerPinChange() {
  // Update drawer button visibility when pin state changes
  if (drawerRef && drawerRef.getIsPinned()) {
    drawerBtnVisible = false;
  } else if (currentView !== 'sessions' && currentView !== 'windows') {
    drawerBtnVisible = true;
  }
}

// ─────────── Router + PanelManager helpers ───────────

function _restoreRightPanelFromState(s) {
  if (!panelManager) return;
  if (s.split && !panelManager.getIsSplit() && window.innerWidth >= 900) {
    panelManager.toggleSplit({ skipAutoConnect: !!s.rightPanel });
  } else if (!s.split && panelManager.getIsSplit()) {
    panelManager.toggleSplit();
  }
  if (s.rightPanel && panelManager.getIsSplit()) {
    const rp = s.rightPanel;
    const rightPanel = panelManager.getRightPanel();
    if (rightPanel && rp.session) {
      rightPanel.connectToWindow(rp.session, rp.window);
      switch (rp.view) {
        case 'files': rightPanel.showFileBrowser(rp.session, { path: rp.path || '.' }); break;
        case 'git': rightPanel.showGitBrowser(rp.session); break;
      }
    }
  }
  if (s._rightFragment && panelManager) {
    if (!panelManager.getIsSplit() && s.split && window.innerWidth >= 900) {
      panelManager.toggleSplit({ skipAutoConnect: true });
    }
    if (panelManager.getIsSplit()) _restoreRightPanel(s._rightFragment);
  }
}

function _isAlreadyConnected(s) {
  if (!panelManager) return false;
  const cs = panelManager.getCurrentSession();
  const cw = panelManager.getCurrentWindowIndex();
  const t = panelManager.getTerminal();
  return cs === s.session && cw === s.window && t !== null;
}

// ─────────── Lifecycle ───────────

let _viewportResizeHandler = null;
let _viewportScrollHandler = null;
let _notificationRequestHandler = null;

// ─────────── PanelManager callback functions ───────────

function _handlePanelClientStatus(session, win) {
  const cs = panelManager?.getCurrentSession();
  const cw = panelManager?.getCurrentWindowIndex();
  // Store に状態を同期 → Drawer/TabBar は props 経由で自動反映
  if (cs !== null && cw !== null) {
    windowStore.setActiveSession(cs);
    windowStore.setActiveWindowIndex(cw);
    windowStore.setHeaderTitle(`${cs}:${cw}`);
  }
  deleteNotification(session, win)
    .then(() => listNotifications())
    .then((notifications) => {
      if (notifications) windowStore.setNotifications(notifications);
    })
    .catch(() => {});
  headerTitle = `${cs}:${cw}`;
  if (cs) _refreshTabBar(cs, { type: 'terminal', windowIndex: cw });
}

function _handlePanelNotificationUpdate(notifications) {
  windowStore.setNotifications(notifications);
  _checkClaudeNotificationHaptic(notifications);
}

function _handlePanelFocusChange(panel) {
  const sess = panel.getSession();
  const winIdx = panel.getWindowIndex();
  if (sess !== null && winIdx !== null) {
    // Store に状態を同期 → Drawer/TabBar は props 経由で自動反映
    windowStore.setActiveSession(sess);
    windowStore.setActiveWindowIndex(winIdx);
    headerTitle = `${sess}:${winIdx}`;
    _refreshTabBar(sess, _getActiveTabDescriptor());
  }
  _updateDrawerPanelTarget();
}

function _handlePanelFileBrowserNavigate(session, path) {
  if (!router || !panelManager) return;
  router.push({
    view: 'files', session, window: panelManager.getCurrentWindowIndex(),
    filePath: path, split: panelManager.getIsSplit(), rightPanel: _buildRightPanelState(),
  });
}

function _handlePanelFileBrowserPreview(session, filePath) {
  if (!router || !panelManager) return;
  const panel = panelManager.getFocusedPanel();
  const dirPath = panel.getCurrentFilePath() || '.';
  router.push({
    view: 'files', session, window: panelManager.getCurrentWindowIndex(),
    filePath: dirPath, previewFile: filePath,
    split: panelManager.getIsSplit(), rightPanel: _buildRightPanelState(),
  });
}

function _handlePanelFileBrowserPreviewClose(session, dirPath) {
  if (!router || !panelManager) return;
  router.push({
    view: 'files', session, window: panelManager.getCurrentWindowIndex(),
    filePath: dirPath, previewFile: null,
    split: panelManager.getIsSplit(), rightPanel: _buildRightPanelState(),
  });
}

function _handlePanelGitBrowserNavigate(session, gitState) {
  if (!router || !panelManager) return;
  router.push({
    view: 'git', session, window: panelManager.getCurrentWindowIndex(),
    gitState, split: panelManager.getIsSplit(), rightPanel: _buildRightPanelState(),
  });
}

onMount(() => {
  // Initialize Router
  router = new Router({
    onSessions: async () => {
      await showSessionList({ push: false });
    },
    onWindows: async (s) => {
      if (!s.session) { await autoConnect(); return; }
      _switchToSessionListView();
      await showWindowList(s.session, { push: false });
    },
    onTerminal: async (s) => {
      if (!s.session || isNaN(s.window)) { await autoConnect(); return; }
      if (_isAlreadyConnected(s)) {
        showTerminalView({ push: false });
      } else {
        connectToWindow(s.session, s.window, { push: false });
      }
      _restoreRightPanelFromState(s);
    },
    onFiles: async (s) => {
      if (!s.session || isNaN(s.window)) { await autoConnect(); return; }
      const filePath = s.filePath || s.path || '.';
      if (!_isAlreadyConnected(s)) {
        connectToWindow(s.session, s.window, { push: false });
      }
      showFileBrowser(s.session, { push: false, path: filePath });
      if (s.previewFile && panelManager) {
        const browsers = panelManager.getFileBrowsers();
        if (browsers.has(s.session)) {
          const fb = browsers.get(s.session).browser;
          fb.showPreview(s.session, s.previewFile, {
            name: s.previewFile.split('/').pop(),
            extension: s.previewFile.includes('.') ? s.previewFile.substring(s.previewFile.lastIndexOf('.')) : '',
          });
        }
      }
      _restoreRightPanelFromState(s);
    },
    onGit: async (s) => {
      if (!s.session || isNaN(s.window)) { await autoConnect(); return; }
      if (!_isAlreadyConnected(s)) {
        connectToWindow(s.session, s.window, { push: false });
      }
      showGitBrowser(s.session, { push: false });
      if (s.gitState && panelManager) {
        const gitBrowsers = panelManager.getGitBrowsers();
        if (gitBrowsers.has(s.session)) {
          gitBrowsers.get(s.session).browser.restoreState(s.gitState);
        }
      }
      _restoreRightPanelFromState(s);
    },
  });

  // Initial notifications
  listNotifications()
    .then((notifications) => {
      // notifications は store → Drawer props で自動同期
      if (notifications) windowStore.setNotifications(notifications);
    })
    .catch((err) => console.error('Failed to load initial notifications:', err));

  // Initial navigation
  const initialHash = window.location.hash;
  if (initialHash && initialHash !== '#') {
    router.navigateFromHash(initialHash);
  } else {
    autoConnect();
  }

  // Browser notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    const requestPerm = () => {
      Notification.requestPermission();
      document.removeEventListener('click', requestPerm);
      document.removeEventListener('touchstart', requestPerm);
    };
    document.addEventListener('click', requestPerm, { once: true });
    document.addEventListener('touchstart', requestPerm, { once: true });
    _notificationRequestHandler = requestPerm;
  }

  // Visual Viewport API
  const appEl = document.getElementById('app');
  if (window.visualViewport && appEl) {
    const updateViewport = () => {
      appEl.style.height = window.visualViewport.height + 'px';
    };
    _viewportResizeHandler = updateViewport;
    _viewportScrollHandler = updateViewport;
    window.visualViewport.addEventListener('resize', updateViewport);
    window.visualViewport.addEventListener('scroll', updateViewport);
  }
});

onDestroy(() => {
  _stopHeaderPoll();
  if (panelManager) panelManager.cleanup();
  if (router) router.dispose();
  if (window.visualViewport) {
    if (_viewportResizeHandler) window.visualViewport.removeEventListener('resize', _viewportResizeHandler);
    if (_viewportScrollHandler) window.visualViewport.removeEventListener('scroll', _viewportScrollHandler);
  }
});

// Track split state reactively
$effect(() => {
  splitActive = panelManager?.getIsSplit() ?? false;
});

// ビュー切り替え時にヘッダーメニューを閉じる
$effect(() => {
  currentView;
  headerMenuOpen = false;
});
</script>

<!-- Drawer (renders its own overlay and panel) -->
<Drawer
  bind:this={drawerRef}
  activeSession={windowStore.getActiveSession()}
  activeWindowIndex={windowStore.getActiveWindowIndex()}
  notifications={windowStore.getNotifications()}
  onSelectSession={handleDrawerSelectSession}
  onCreateSession={handleDrawerCreateSession}
  onDeleteSession={handleDrawerDeleteSession}
  onClose={handleDrawerClose}
  onPinChange={handleDrawerPinChange}
  {claudePath}
  listSessions={listSessions}
  createSession={createSession}
  deleteSession={deleteSessionAPI}
  {listGhqRepos}
  {cloneGhqRepo}
  {deleteGhqRepo}
  {listProjectWorktrees}
  {createProjectWorktree}
  {deleteProjectWorktree}
  {listProjectBranches}
  {isProjectBranchMerged}
  {deleteProjectBranch}
/>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && headerMenuOpen) headerMenuOpen = false; }} />

<!-- Header -->
<div id="header">
  <button id="drawer-btn" class:hidden={!drawerBtnVisible} aria-label="Open drawer" onclick={handleDrawerOpen}>&#9776;</button>
  <div id="header-title" class:hidden={!headerTitleVisible}>{headerTitle}</div>
  <div id="tab-bar-container" class="tab-bar" class:hidden={!tabBarVisible}>
    <TabBar
      sessionName={windowStore.getActiveSession()}
      windows={windowStore.getWindows()}
      isClaudeCodeMode={windowStore.getIsClaudeCodeMode()}
      activeTab={windowStore.getActiveTab()}
      notifications={windowStore.getNotifications()}
      gitFileCount={windowStore.getGitFileCount()}
      runningWindows={windowStore.getRunningWindows()}
      onSelect={handleTabSelect}
      onContextMenu={handleTabContextMenu}
    />
  </div>
  <button id="split-toggle-btn" class:hidden={!splitToggleVisible} class:split-toggle-btn--active={splitActive} aria-label="Toggle split screen" onclick={handleSplitToggle}>&#x2AFF;</button>
  <!-- Desktop: inline buttons -->
  <div class="header-actions header-actions--desktop">
    <button class="theme-toggle-btn" aria-label="Toggle theme" onclick={handleThemeToggle}>{currentTheme === 'dark' ? '\u2600' : '\u263E'}</button>
    <button id="portman-btn" class="portman-btn" class:hidden={!portmanVisible} aria-label="Open portman URL" onclick={handlePortmanClick}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 2H3C2.44772 2 2 2.44772 2 3V13C2 13.5523 2.44772 14 3 14H13C13.5523 14 14 13.5523 14 13V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M9 2H14V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M14 2L7 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <button id="github-btn" class="github-btn" class:hidden={!githubVisible} aria-label="Open GitHub Issues" onclick={handleGitHubClick}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 1C4.13 1 1 4.13 1 8C1 11.1 3.05 13.71 5.86 14.68C6.23 14.75 6.36 14.53 6.36 14.34C6.36 14.17 6.36 13.71 6.35 13.11C4.34 13.56 3.91 12.13 3.91 12.13C3.57 11.29 3.08 11.07 3.08 11.07C2.42 10.62 3.13 10.63 3.13 10.63C3.86 10.68 4.25 11.38 4.25 11.38C4.9 12.5 5.96 12.17 6.38 11.99C6.44 11.52 6.63 11.19 6.83 11.01C5.24 10.82 3.57 10.21 3.57 7.57C3.57 6.77 3.86 6.12 4.27 5.61C4.2 5.42 3.95 4.68 4.33 3.68C4.33 3.68 4.94 3.48 6.35 4.41C6.93 4.25 7.47 4.17 8 4.17C8.53 4.17 9.07 4.25 9.65 4.41C11.06 3.48 11.67 3.68 11.67 3.68C12.05 4.68 11.8 5.42 11.73 5.61C12.14 6.12 12.43 6.77 12.43 7.57C12.43 10.22 10.76 10.82 9.16 11C9.42 11.23 9.65 11.68 9.65 12.37C9.65 13.37 9.64 14.18 9.64 14.34C9.64 14.53 9.77 14.76 10.15 14.68C12.95 13.71 15 11.1 15 8C15 4.13 11.87 1 8 1Z" fill="currentColor"/>
      </svg>
    </button>
    <div id="font-size-controls" class="font-size-controls" class:hidden={!fontControlsVisible}>
      <button id="font-decrease-btn" class="font-size-btn" aria-label="Decrease font size" onclick={handleFontDecrease}>A&#x2212;</button>
      <button id="font-increase-btn" class="font-size-btn" aria-label="Increase font size" onclick={handleFontIncrease}>A+</button>
    </div>
    <button id="toolbar-toggle-btn" class:hidden={!toolbarToggleVisible} aria-label="Toggle toolbar" onclick={handleToolbarToggle}>&#9000;</button>
  </div>
  <!-- Mobile: dropdown menu -->
  <div class="header-actions header-actions--mobile">
    <button class="header-menu-btn" aria-label="Open menu" onclick={() => headerMenuOpen = !headerMenuOpen}>&#x22EE;</button>
    {#if headerMenuOpen}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="header-menu-overlay" onclick={() => headerMenuOpen = false}></div>
      <div class="header-menu-dropdown">
        <button class="header-menu-item" onclick={() => { handleThemeToggle(); headerMenuOpen = false; }}>
          <span class="header-menu-icon">{currentTheme === 'dark' ? '\u2600' : '\u263E'}</span>
          <span>{currentTheme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
        {#if portmanVisible}
          <button class="header-menu-item" onclick={() => { handlePortmanClick(); headerMenuOpen = false; }}>
            <span class="header-menu-icon">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 2H3C2.44772 2 2 2.44772 2 3V13C2 13.5523 2.44772 14 3 14H13C13.5523 14 14 13.5523 14 13V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M9 2H14V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M14 2L7 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span>Open URL</span>
          </button>
        {/if}
        {#if githubVisible}
          <button class="header-menu-item" onclick={() => { handleGitHubClick(); headerMenuOpen = false; }}>
            <span class="header-menu-icon">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 1C4.13 1 1 4.13 1 8C1 11.1 3.05 13.71 5.86 14.68C6.23 14.75 6.36 14.53 6.36 14.34C6.36 14.17 6.36 13.71 6.35 13.11C4.34 13.56 3.91 12.13 3.91 12.13C3.57 11.29 3.08 11.07 3.08 11.07C2.42 10.62 3.13 10.63 3.13 10.63C3.86 10.68 4.25 11.38 4.25 11.38C4.9 12.5 5.96 12.17 6.38 11.99C6.44 11.52 6.63 11.19 6.83 11.01C5.24 10.82 3.57 10.21 3.57 7.57C3.57 6.77 3.86 6.12 4.27 5.61C4.2 5.42 3.95 4.68 4.33 3.68C4.33 3.68 4.94 3.48 6.35 4.41C6.93 4.25 7.47 4.17 8 4.17C8.53 4.17 9.07 4.25 9.65 4.41C11.06 3.48 11.67 3.68 11.67 3.68C12.05 4.68 11.8 5.42 11.73 5.61C12.14 6.12 12.43 6.77 12.43 7.57C12.43 10.22 10.76 10.82 9.16 11C9.42 11.23 9.65 11.68 9.65 12.37C9.65 13.37 9.64 14.18 9.64 14.34C9.64 14.53 9.77 14.76 10.15 14.68C12.95 13.71 15 11.1 15 8C15 4.13 11.87 1 8 1Z" fill="currentColor"/>
              </svg>
            </span>
            <span>GitHub</span>
          </button>
        {/if}
        {#if fontControlsVisible}
          <div class="header-menu-item header-menu-font-controls">
            <span class="header-menu-icon">A</span>
            <span>Font size</span>
            <div class="header-menu-font-btns">
              <button class="header-menu-font-btn" aria-label="Decrease font size" onclick={handleFontDecrease}>&#x2212;</button>
              <button class="header-menu-font-btn" aria-label="Increase font size" onclick={handleFontIncrease}>+</button>
            </div>
          </div>
        {/if}
        {#if toolbarToggleVisible}
          <button class="header-menu-item" onclick={() => { handleToolbarToggle(); headerMenuOpen = false; }}>
            <span class="header-menu-icon">&#9000;</span>
            <span>Toolbar</span>
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<!-- Main Content -->
<div id="main">
  <!-- Session/Window List -->
  <div id="session-list" class:hidden={currentView !== 'sessions' && currentView !== 'windows'}>
    <SessionList
      mode={currentView === 'windows' ? 'windows' : 'sessions'}
      sessionName={currentSessionName}
      sessions={sessionListSessions}
      windows={sessionListWindows}
      loading={sessionListLoading}
      error={sessionListError}
      onSelectSession={(name) => showWindowList(name)}
      onSelectWindow={(session, winIdx) => connectToWindow(session, winIdx)}
    />
  </div>

  <!-- Panel Container -->
  <div id="panel-container" class:hidden={currentView === 'sessions' || currentView === 'windows'}>
    <PanelManager
      bind:this={panelManager}
      {globalUIState}
      {isMobileDevice}
      onClientStatus={_handlePanelClientStatus}
      onNotificationUpdate={_handlePanelNotificationUpdate}
      onConnectionStateChange={(state) => updateConnectionUI(state)}
      onFocusChange={_handlePanelFocusChange}
      onFileBrowserNavigate={_handlePanelFileBrowserNavigate}
      onFileBrowserPreview={_handlePanelFileBrowserPreview}
      onFileBrowserPreviewClose={_handlePanelFileBrowserPreviewClose}
      onGitBrowserNavigate={_handlePanelGitBrowserNavigate}
    />
  </div>
</div>

<!-- Context Menu Manager -->
<ContextMenuManager
  bind:this={contextMenuRef}
  models={CLAUDE_MODELS}
  onRestartClaude={_handleRestartClaude}
  onRenameWindow={_handleRenameWindow}
/>
