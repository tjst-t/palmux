// windowStore.svelte.js - Central state store for session/window/tab management
//
// Single Source of Truth: 全コンポーネントはこの store から reactive に読む。
// 命令的 setter は使わず、store の action を通じて状態を変更する。

import { listWindows, getSessionMode } from '../../js/api.js';

// ─────────── Core State ───────────

/** @type {string|null} */
let activeSession = $state(null);

/** @type {number|null} */
let activeWindowIndex = $state(null);

/** @type {'sessions'|'windows'|'terminal'|'files'|'git'} */
let activeView = $state('sessions');

/** @type {Array<{index: number, name: string, active: boolean}>} */
let windows = $state([]);

/** @type {boolean} */
let isClaudeCodeMode = $state(false);

/** @type {number} */
let claudeWindowIndex = $state(-1);

/** @type {{type: 'terminal'|'files'|'git', windowIndex?: number}|null} */
let activeTab = $state(null);

// ─────────── Notification / Badge State ───────────

/** @type {Array<{session: string, window_index: number, type: string}>} */
let notifications = $state([]);

/** @type {number} */
let gitFileCount = $state(0);

/** @type {Set<number>} */
let runningWindows = $state(new Set());

// ─────────── Header State ───────────

/** @type {string} */
let headerTitle = $state('Palmux');

/** @type {Array|null} */
let portmanLeases = $state(null);

/** @type {string|null} */
let githubURL = $state(null);

// ─────────── Getters ───────────

export function getActiveSession() { return activeSession; }
export function getActiveWindowIndex() { return activeWindowIndex; }
export function getActiveView() { return activeView; }
export function getWindows() { return windows; }
export function getIsClaudeCodeMode() { return isClaudeCodeMode; }
export function getClaudeWindowIndex() { return claudeWindowIndex; }
export function getActiveTab() { return activeTab; }
export function getNotifications() { return notifications; }
export function getGitFileCount() { return gitFileCount; }
export function getRunningWindows() { return runningWindows; }
export function getHeaderTitle() { return headerTitle; }
export function getPortmanLeases() { return portmanLeases; }
export function getGithubURL() { return githubURL; }

/**
 * 現在のアクティブウィンドウが Claude ウィンドウかどうかを返す。
 */
export function isCurrentWindowClaude() {
  if (!isClaudeCodeMode || !activeTab || activeTab.type !== 'terminal') return false;
  return windows.some(w => w.index === activeTab.windowIndex && w.name === 'claude');
}

// ─────────── Actions ───────────

/**
 * セッション一覧画面に遷移する。
 */
export function navigateToSessionList() {
  activeView = 'sessions';
  activeSession = null;
  activeWindowIndex = null;
  activeTab = null;
  headerTitle = 'Palmux';
  portmanLeases = null;
  githubURL = null;
  gitFileCount = 0;
}

/**
 * ウィンドウ一覧画面に遷移する。
 */
export function navigateToWindowList(sessionName) {
  activeView = 'windows';
  activeSession = sessionName;
  headerTitle = sessionName;
}

/**
 * 特定のウィンドウ（ターミナルビュー）に遷移する。
 */
export function navigateToWindow(sessionName, windowIndex) {
  activeView = 'terminal';
  activeSession = sessionName;
  activeWindowIndex = windowIndex;
  activeTab = { type: 'terminal', windowIndex };
  headerTitle = `${sessionName}:${windowIndex}`;
}

/**
 * ファイルブラウザビューに切り替える。
 */
export function navigateToFiles() {
  activeTab = { type: 'files' };
}

/**
 * Git ブラウザビューに切り替える。
 */
export function navigateToGit() {
  activeTab = { type: 'git' };
}

/**
 * ターミナルビューに戻す。
 */
export function navigateToTerminal(windowIndex) {
  activeTab = { type: 'terminal', windowIndex: windowIndex ?? activeWindowIndex };
}

/**
 * ヘッダータイトルを更新する。
 */
export function setHeaderTitle(title) {
  headerTitle = title;
}

export function setActiveView(view) {
  activeView = view;
}

export function setActiveSession(session) {
  activeSession = session;
}

export function setActiveWindowIndex(index) {
  activeWindowIndex = index;
}

export function setActiveTab(tab) {
  activeTab = tab;
}

// ─────────── Notification / Badge Actions ───────────

export function setNotifications(notifs) {
  notifications = notifs || [];
}

export function setGitFileCount(count) {
  gitFileCount = count;
}

export function setWindowRunning(windowIndex) {
  runningWindows = new Set([...runningWindows, windowIndex]);
}

export function clearWindowRunning(windowIndex) {
  const next = new Set(runningWindows);
  next.delete(windowIndex);
  runningWindows = next;
}

// ─────────── Header State Actions ───────────

export function setPortmanLeases(leases) {
  portmanLeases = leases && leases.length > 0 ? leases : null;
}

export function setGithubURL(url) {
  githubURL = url || null;
}

// ─────────── Window Refresh (Race-safe) ───────────

let _refreshSeq = 0;
let _refreshPromise = null;

/**
 * ウィンドウ一覧とセッションモードを取得して store を更新する。
 * シーケンス番号ガードとリクエスト合体でレースを防止。
 *
 * @param {string} sessionName
 * @param {object} [opts]
 * @param {boolean} [opts.skipModeCheck=false] - getSessionMode を呼ばない（restart 直後のレース防止）
 * @returns {Promise<void>}
 */
export async function refreshWindows(sessionName, { skipModeCheck = false } = {}) {
  const seq = ++_refreshSeq;

  // 同一セッションへのリフレッシュが進行中なら合体
  if (_refreshPromise && activeSession === sessionName && !skipModeCheck) {
    return _refreshPromise;
  }

  _refreshPromise = (async () => {
    try {
      const [wins, mode] = await Promise.all([
        listWindows(sessionName),
        skipModeCheck ? null : getSessionMode(sessionName).catch(() => null),
      ]);

      // stale guard: 新しいリフレッシュが開始されていたら破棄
      if (seq !== _refreshSeq) return;

      windows = wins || [];

      if (!skipModeCheck && mode) {
        isClaudeCodeMode = !!mode.claude_code;
        claudeWindowIndex = mode.claude_window ?? -1;
      }
    } finally {
      if (seq === _refreshSeq) {
        _refreshPromise = null;
      }
    }
  })();

  return _refreshPromise;
}
