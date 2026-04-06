// headerPoll.svelte.js - Header state polling (git status, portman, github URL)
//
// 2秒間隔でバックエンドをポーリングし、windowStore に結果を書き込む。

import { getGitStatus, getPortmanLeases, getGitHubURL } from '../../js/api.js';
import * as windowStore from './windowStore.svelte.js';

let _timer = null;
let _running = false;
let _cache = { gitFileCount: -1, portmanKeys: '', githubURL: null };

/**
 * ポーリングを開始する。前回のタイマーがあればクリアしてリスタート。
 */
export function startPoll() {
  stopPoll();
  _cache = { gitFileCount: -1, portmanKeys: '', githubURL: null };
  tick();
  _timer = setInterval(tick, 2000);
}

/**
 * ポーリングを停止する。
 */
export function stopPoll() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

/**
 * 即座に 1 回ポーリングを実行する。
 */
export async function tick() {
  if (_running) return;
  _running = true;

  try {
    const session = windowStore.getActiveSession();
    const view = windowStore.getActiveView();
    if (!session || view !== 'terminal') return;

    const [gitStatus, leases, ghResult] = await Promise.all([
      getGitStatus(session).catch(() => null),
      getPortmanLeases(session).catch(() => null),
      getGitHubURL(session).catch(() => null),
    ]);

    // セッションが変わっていたら破棄
    if (session !== windowStore.getActiveSession()) return;

    // Git badge: ファイル数が変わった場合のみ更新
    const newGitCount = gitStatus?.files ? gitStatus.files.length : 0;
    if (newGitCount !== _cache.gitFileCount) {
      _cache.gitFileCount = newGitCount;
      windowStore.setGitFileCount(newGitCount);
    }

    // Portman: リース名リストが変わった場合のみ更新
    const newPortmanKeys = leases && leases.length > 0
      ? leases.map(l => l.name).join(',')
      : '';
    if (newPortmanKeys !== _cache.portmanKeys) {
      _cache.portmanKeys = newPortmanKeys;
      windowStore.setPortmanLeases(leases);
    }

    // GitHub: URL が変わった場合のみ更新
    const newGhURL = ghResult?.url || null;
    if (newGhURL !== _cache.githubURL) {
      _cache.githubURL = newGhURL;
      windowStore.setGithubURL(newGhURL);
    }
  } finally {
    _running = false;
  }
}
