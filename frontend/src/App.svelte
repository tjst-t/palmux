<script>
/**
 * App.svelte - ルートコンポーネント
 * app.js + router.js の全オーケストレーションロジックを Svelte に移行
 */

import { onMount, onDestroy } from 'svelte';
import {
  listSessions, listWindows, listNotifications, deleteNotification,
  getSessionMode, createWindow, deleteWindow, renameWindow, restartClaudeWindow,
  getPortmanLeases, getGitHubURL, getGitStatus, getCommands, getPaneCommand,
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

// ─────────── Meta tags ───────────
const basePath = document.querySelector('meta[name="base-path"]')?.getAttribute('content') || '/';
const authToken = document.querySelector('meta[name="auth-token"]')?.getAttribute('content') || '';
const claudePathMeta = document.querySelector('meta[name="claude-path"]');
const claudePath = claudePathMeta ? (claudePathMeta.getAttribute('content') || 'claude') : 'claude';
const appVersion = document.querySelector('meta[name="app-version"]')?.getAttribute('content') || '';

// ─────────── State ───────────
/** @type {'sessions'|'windows'|'terminal'|'files'|'git'} */
let currentView = $state('sessions');
let currentSessionName = $state(null);
let currentWindowIndex = $state(null);

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
let connectionState = $state('disconnected');
let connectionVisible = $state(false);
let portmanLeases = $state(null);
let portmanVisible = $state(false);
let githubURL = $state(null);
let githubVisible = $state(false);
let splitActive = $state(false);
let drawerPanelTarget = $state('');
let drawerPanelTargetVisible = $state(false);

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
let tabBarRef = $state(null);
let drawerRef = $state(null);

// ─────────── TabBar internal state (for Claude detection) ───────────
let tabBarSessionName = $state(null);
let tabBarWindows = $state([]);
let tabBarIsClaudeCodeMode = $state(false);

// ─────────── Commands cache ───────────
let commandsCache = null;
const COMMANDS_CACHE_TTL = 30000;

async function _fetchCachedCommands(session) {
  if (commandsCache &&
      commandsCache.session === session &&
      Date.now() - commandsCache.timestamp < COMMANDS_CACHE_TTL) {
    return commandsCache.commands;
  }
  try {
    const result = await getCommands(session);
    const commands = result.commands || [];
    commandsCache = { session, commands, timestamp: Date.now() };
    return commands;
  } catch {
    return [];
  }
}

/**
 * Send a command to a specific window and show/clear running badge.
 * Polls the pane's foreground process to detect when the shell prompt returns.
 * @param {number} windowIndex
 * @param {string} command
 */
function _sendCommandToWindow(windowIndex, command) {
  if (!panelManager || !tabBarRef) return;
  const session = panelManager.getCurrentSession();
  if (!session) return;

  tabBarRef.setWindowRunning(windowIndex);
  panelManager.sendToWindow(windowIndex, command);

  // Poll pane foreground process until it returns to a shell
  let pollCount = 0;
  const maxPolls = 300; // 5 minutes at 1s intervals
  const pollInterval = setInterval(async () => {
    pollCount++;
    if (pollCount > maxPolls) {
      clearInterval(pollInterval);
      if (tabBarRef) tabBarRef.clearWindowRunning(windowIndex);
      return;
    }
    try {
      const result = await getPaneCommand(session, windowIndex);
      if (result.is_shell) {
        clearInterval(pollInterval);
        if (tabBarRef) tabBarRef.clearWindowRunning(windowIndex);
      }
    } catch {
      clearInterval(pollInterval);
      if (tabBarRef) tabBarRef.clearWindowRunning(windowIndex);
    }
  }, 1000);
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

  const hasNewClaudeNotif = tabBarIsClaudeCodeMode &&
    claudeNotifications.some(n => {
      if (n.session !== tabBarSessionName) return false;
      return tabBarWindows.some(w => w.index === n.window_index && w.name === 'claude');
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

async function _refreshTabBar(sessionName, activeTab) {
  if (!tabBarRef) return;
  try {
    const [windows, mode, gitStatus] = await Promise.all([
      listWindows(sessionName),
      getSessionMode(sessionName).catch(() => null),
      getGitStatus(sessionName).catch(() => null),
    ]);
    if (!windows) return;
    const isClaudeCodeMode = !!(mode && mode.claude_code);

    // Update local tracking state
    tabBarSessionName = sessionName;
    tabBarWindows = windows;
    tabBarIsClaudeCodeMode = isClaudeCodeMode;

    tabBarRef.setWindows(sessionName, windows, isClaudeCodeMode);
    tabBarRef.setActiveTab(activeTab);
    tabBarRef.setGitFileCount(gitStatus && gitStatus.files ? gitStatus.files.length : 0);

    if (panelManager) {
      panelManager.getFocusedPanel().pruneTerminalTabs(windows);
      const rightPanel = panelManager.getRightPanel();
      if (rightPanel) rightPanel.pruneTerminalTabs(windows);
    }

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

async function _refreshPortmanButton(sessionName) {
  portmanVisible = false;
  portmanLeases = null;
  try {
    const leases = await getPortmanLeases(sessionName);
    if (!leases || leases.length === 0) return;
    portmanLeases = leases;
    portmanVisible = true;
  } catch { /* ignore */ }
}

async function _refreshGitHubButton(sessionName) {
  githubVisible = false;
  githubURL = null;
  try {
    const result = await getGitHubURL(sessionName);
    if (!result || !result.url) return;
    githubURL = result.url;
    githubVisible = true;
  } catch { /* ignore */ }
}

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
  currentView = 'sessions';

  if (panelManager) {
    if (panelManager.getIsSplit()) panelManager.toggleSplit();
    panelManager.getLeftPanel().cleanup();
  }

  connectionVisible = false;
  tabBarVisible = false;
  headerTitleVisible = true;
  headerTitle = 'Palmux';
  toolbarToggleVisible = false;
  fontControlsVisible = false;
  splitToggleVisible = false;
  portmanVisible = false;
  portmanLeases = null;
  githubVisible = false;
  githubURL = null;
  drawerBtnVisible = false;
  _updateDrawerPanelTarget();
}

async function showSessionList({ push = true, replace = false } = {}) {
  _switchToSessionListView();
  currentSessionName = null;

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
  currentView = 'windows';
  currentSessionName = sessionName;
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

function connectToWindow(sessionName, windowIndex, { push = true, replace = false } = {}) {
  currentView = 'terminal';
  currentSessionName = sessionName;
  currentWindowIndex = windowIndex;

  tabBarVisible = true;
  _refreshTabBar(sessionName, { type: 'terminal', windowIndex });
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
    panelManager.connectToWindow(sessionName, windowIndex);
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

  if (drawerRef) {
    drawerRef.setCurrent(sessionName, windowIndex);
    drawerRef.restorePinState();
  }

  _updateDrawerPanelTarget();
  _refreshPortmanButton(sessionName);
  _refreshGitHubButton(sessionName);
}

function showFileBrowser(sessionName, { push = true, path = null } = {}) {
  if (!panelManager) return;
  const panel = panelManager.getFocusedPanel();
  panel.showFileBrowser(sessionName, { path });

  if (tabBarRef) tabBarRef.setActiveTab({ type: 'files' });
  toolbarToggleVisible = false;

  const currentSession = panelManager.getCurrentSession();
  const currentWindowIdx = panelManager.getCurrentWindowIndex();
  if (push && router && currentSession !== null && currentWindowIdx !== null) {
    router.push({
      view: 'files', session: sessionName, window: currentWindowIdx,
      filePath: path || '.', split: panelManager.getIsSplit(), rightPanel: _buildRightPanelState(),
    });
  }
  if (drawerRef) {
    drawerRef.setCurrent(panelManager.getCurrentSession(), panelManager.getCurrentWindowIndex());
  }
}

function showTerminalView({ push = true } = {}) {
  if (!panelManager) return;
  const panel = panelManager.getFocusedPanel();
  panel.showTerminalView();

  if (tabBarRef) {
    tabBarRef.setActiveTab({ type: 'terminal', windowIndex: panelManager.getCurrentWindowIndex() });
  }
  toolbarToggleVisible = true;

  const currentSession = panelManager.getCurrentSession();
  const currentWindowIdx = panelManager.getCurrentWindowIndex();
  if (push && router && currentSession !== null && currentWindowIdx !== null) {
    router.push({
      view: 'terminal', session: currentSession, window: currentWindowIdx,
      split: panelManager.getIsSplit(), rightPanel: _buildRightPanelState(),
    });
  }
  if (drawerRef) {
    drawerRef.setCurrent(panelManager.getCurrentSession(), panelManager.getCurrentWindowIndex());
  }
}

function showGitBrowser(sessionName, { push = true } = {}) {
  if (!panelManager) return;
  const panel = panelManager.getFocusedPanel();
  panel.showGitBrowser(sessionName);

  if (tabBarRef) tabBarRef.setActiveTab({ type: 'git' });
  toolbarToggleVisible = false;

  const currentSession = panelManager.getCurrentSession();
  const currentWindowIdx = panelManager.getCurrentWindowIndex();
  if (push && router && currentSession !== null && currentWindowIdx !== null) {
    router.push({
      view: 'git', session: sessionName, window: currentWindowIdx,
      split: panelManager.getIsSplit(), rightPanel: _buildRightPanelState(),
    });
  }
  if (drawerRef) {
    drawerRef.setCurrent(panelManager.getCurrentSession(), panelManager.getCurrentWindowIndex());
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
  connectionState = state;
  connectionVisible = true;
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
  const existing = document.querySelector('.context-menu-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'context-menu-overlay';
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  const title = document.createElement('div');
  title.className = 'context-menu__title';
  title.textContent = 'Open URL';
  menu.appendChild(title);

  const closeMenu = () => {
    overlay.classList.remove('context-menu-overlay--visible');
    setTimeout(() => overlay.remove(), 200);
  };

  for (const lease of leases) {
    const btn = document.createElement('button');
    btn.className = 'context-menu__item';
    btn.textContent = lease.name;
    btn.addEventListener('click', () => {
      closeMenu();
      window.open(lease.url, '_blank');
    });
    menu.appendChild(btn);
  }
  overlay.appendChild(menu);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('context-menu-overlay--visible'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMenu(); });
}

function _showTabModelSelectDialog(sessionName, baseCommand) {
  const existing = document.querySelector('.context-menu-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'context-menu-overlay';
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  const title = document.createElement('div');
  title.className = 'context-menu__title';
  title.textContent = 'Select Model';
  menu.appendChild(title);

  const closeDialog = () => {
    overlay.classList.remove('context-menu-overlay--visible');
    setTimeout(() => overlay.remove(), 200);
  };

  for (const model of [{ label: 'opus', flag: 'opus' }, { label: 'sonnet', flag: 'sonnet' }, { label: 'haiku', flag: 'haiku' }]) {
    const btn = document.createElement('button');
    btn.className = 'context-menu__item';
    btn.textContent = model.label;
    btn.addEventListener('click', async () => {
      closeDialog();
      try {
        const win = await restartClaudeWindow(sessionName, `${baseCommand} --model ${model.flag}`);
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
  requestAnimationFrame(() => overlay.classList.add('context-menu-overlay--visible'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDialog(); });
}

function _showTabRenameDialog(sessionName, windowIndex, currentName) {
  const existing = document.querySelector('.context-menu-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'context-menu-overlay';
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  const titleEl = document.createElement('div');
  titleEl.className = 'context-menu__title';
  titleEl.textContent = 'Rename Window';
  menu.appendChild(titleEl);

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
    overlay.classList.remove('context-menu-overlay--visible');
    setTimeout(() => overlay.remove(), 200);
  };

  const doRename = async () => {
    const newName = input.value.trim();
    if (!newName || newName === currentName) { closeDialog(); return; }
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
    if (e.key === 'Enter') { e.preventDefault(); doRename(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeDialog(); }
  });

  overlay.appendChild(menu);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.classList.add('context-menu-overlay--visible'); input.focus(); input.select(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDialog(); });
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
    const isClaudeTab = tabBarIsClaudeCodeMode &&
      tabBarWindows.some(w => w.index === windowIndex && w.name === 'claude');
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
  const win = tabBarWindows.find(w => w.index === windowIndex);
  const windowName = win ? win.name : '';

  // Build context menu items
  const items = [];

  // Add Makefile/project commands
  const commands = await _fetchCachedCommands(currentSession);
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

  if (tabBarIsClaudeCodeMode) {
    items.push({ label: 'Restart', action: () => _showTabModelSelectDialog(currentSession, claudePath) });
    items.push({ label: 'Resume', action: () => _showTabModelSelectDialog(currentSession, `${claudePath} --continue`) });
  }
  items.push({ label: 'Rename', action: () => _showTabRenameDialog(currentSession, windowIndex, windowName) });
  items.push({ label: 'Delete', action: () => _handleTabDeleteWindow(currentSession, windowIndex) });

  _showContextMenu(event.x, event.y, items, event.isMobile);
}

function _showContextMenu(x, y, items, isMobile = false) {
  const existing = document.querySelector('.context-menu-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'context-menu-overlay';
  if (!isMobile) {
    // Desktop: don't center, let the menu position itself at cursor
    overlay.style.alignItems = 'flex-start';
    overlay.style.justifyContent = 'flex-start';
  }
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  if (!isMobile) {
    menu.style.position = 'absolute';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  }

  const closeMenu = () => {
    overlay.classList.remove('context-menu-overlay--visible');
    setTimeout(() => overlay.remove(), 200);
  };

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'context-menu__separator';
      menu.appendChild(sep);
      continue;
    }
    if (item.submenu) {
      const wrapper = document.createElement('div');
      wrapper.className = 'context-menu__submenu-wrapper';
      const trigger = document.createElement('button');
      trigger.className = 'context-menu__submenu-trigger';
      trigger.textContent = item.label;
      // Toggle submenu on click (for mobile)
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        wrapper.classList.toggle('context-menu__submenu-wrapper--open');
      });
      wrapper.appendChild(trigger);
      const sub = document.createElement('div');
      sub.className = 'context-menu__submenu';
      for (const subItem of item.submenu) {
        const subBtn = document.createElement('button');
        subBtn.className = 'context-menu__item';
        subBtn.textContent = subItem.label;
        subBtn.addEventListener('click', () => { closeMenu(); subItem.action(); });
        sub.appendChild(subBtn);
      }
      wrapper.appendChild(sub);
      menu.appendChild(wrapper);
      continue;
    }
    const btn = document.createElement('button');
    btn.className = 'context-menu__item';
    btn.textContent = item.label;
    btn.addEventListener('click', () => { closeMenu(); item.action(); });
    menu.appendChild(btn);
  }

  overlay.appendChild(menu);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('context-menu-overlay--visible');
    // Clamp to viewport on desktop
    if (!isMobile) {
      const rect = menu.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (rect.right > vw) menu.style.left = Math.max(0, vw - rect.width - 8) + 'px';
      if (rect.bottom > vh) menu.style.top = Math.max(0, vh - rect.height - 8) + 'px';
    }
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMenu(); });
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

function handleReconnect() {
  if (panelManager) panelManager.getFocusedPanel().reconnectNow();
}

function handleFontDecrease() {
  if (panelManager) panelManager.getFocusedPanel().decreaseFontSize();
}

function handleFontIncrease() {
  if (panelManager) panelManager.getFocusedPanel().increaseFontSize();
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
  deleteNotification(session, win)
    .then(() => listNotifications())
    .then((notifications) => {
      if (drawerRef && notifications) drawerRef.setNotifications(notifications);
      if (tabBarRef && notifications) tabBarRef.setNotifications(notifications);
    })
    .catch(() => {});
  headerTitle = `${cs}:${cw}`;
  if (tabBarRef && cs) _refreshTabBar(cs, { type: 'terminal', windowIndex: cw });
  if (drawerRef) drawerRef.setCurrent(cs, cw, { sessionChanged: true });
}

function _handlePanelNotificationUpdate(notifications) {
  if (drawerRef) drawerRef.setNotifications(notifications);
  if (tabBarRef) tabBarRef.setNotifications(notifications);
  _checkClaudeNotificationHaptic(notifications);
}

function _handlePanelFocusChange(panel) {
  const sess = panel.getSession();
  const winIdx = panel.getWindowIndex();
  if (sess !== null && winIdx !== null) {
    headerTitle = `${sess}:${winIdx}`;
    if (drawerRef) drawerRef.setCurrent(sess, winIdx);
    if (tabBarRef) _refreshTabBar(sess, _getActiveTabDescriptor());
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
      if (drawerRef && notifications) drawerRef.setNotifications(notifications);
      if (tabBarRef && notifications) tabBarRef.setNotifications(notifications);
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
</script>

<!-- Drawer (renders its own overlay and panel) -->
<Drawer
  bind:this={drawerRef}
  onSelectSession={handleDrawerSelectSession}
  onCreateSession={handleDrawerCreateSession}
  onDeleteSession={handleDrawerDeleteSession}
  onClose={handleDrawerClose}
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

<!-- Header -->
<div id="header">
  <button id="drawer-btn" class:hidden={!drawerBtnVisible} aria-label="Open drawer" onclick={handleDrawerOpen}>&#9776;</button>
  <div id="header-title" class:hidden={!headerTitleVisible}>{headerTitle}</div>
  <div id="tab-bar-container" class="tab-bar" class:hidden={!tabBarVisible}>
    <TabBar
      bind:this={tabBarRef}
      onSelect={handleTabSelect}
      onContextMenu={handleTabContextMenu}
    />
  </div>
  <button id="split-toggle-btn" class:hidden={!splitToggleVisible} class:split-toggle-btn--active={splitActive} aria-label="Toggle split screen" onclick={handleSplitToggle}>&#x2AFF;</button>
  <div id="connection-status" class="connection-status" class:hidden={!connectionVisible} class:connection-status--disconnected={connectionState === 'disconnected'} onclick={handleReconnect}>
    <span class="connection-dot" class:connection-dot--connected={connectionState === 'connected'} class:connection-dot--connecting={connectionState === 'connecting'} class:connection-dot--disconnected={connectionState === 'disconnected'}></span>
    <span class="connection-text">{connectionState === 'connecting' ? 'Reconnecting...' : connectionState === 'disconnected' ? 'Disconnected' : ''}</span>
  </div>
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
