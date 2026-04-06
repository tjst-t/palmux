// commandRunner.js - Makefile/project command execution and caching

import { getCommands, getPaneCommand } from './api.js';
import * as windowStore from '../src/stores/windowStore.svelte.js';

let _cache = null;
const CACHE_TTL = 30000;

/**
 * コマンド一覧をキャッシュ付きで取得する。
 * @param {string} session
 * @returns {Promise<Array<{label: string, command: string}>>}
 */
export async function fetchCachedCommands(session) {
  if (_cache &&
      _cache.session === session &&
      Date.now() - _cache.timestamp < CACHE_TTL) {
    return _cache.commands;
  }
  try {
    const result = await getCommands(session);
    const commands = result.commands || [];
    _cache = { session, commands, timestamp: Date.now() };
    return commands;
  } catch {
    return [];
  }
}

/**
 * ウィンドウにコマンドを送信し、実行中バッジを表示する。
 * @param {object} panelManager - PanelManager instance
 * @param {number} windowIndex
 * @param {string} command
 */
export function sendCommandToWindow(panelManager, windowIndex, command) {
  if (!panelManager) return;
  const session = panelManager.getCurrentSession();
  if (!session) return;

  windowStore.setWindowRunning(windowIndex);
  panelManager.sendToWindow(windowIndex, command);

  // Poll pane foreground process until it returns to a shell
  let pollCount = 0;
  const maxPolls = 300; // 5 minutes at 1s intervals
  const pollInterval = setInterval(async () => {
    pollCount++;
    if (pollCount > maxPolls) {
      clearInterval(pollInterval);
      windowStore.clearWindowRunning(windowIndex);
      return;
    }
    try {
      const result = await getPaneCommand(session, windowIndex);
      if (result.is_shell) {
        clearInterval(pollInterval);
        windowStore.clearWindowRunning(windowIndex);
      }
    } catch {
      clearInterval(pollInterval);
      windowStore.clearWindowRunning(windowIndex);
    }
  }, 1000);
}
