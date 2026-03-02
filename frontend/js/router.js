// router.js - 統一的なブラウザ履歴/ナビゲーション管理
// history.pushState / replaceState / popstate を一元管理する。
// 他のファイルからは直接 history.* を呼ばない。

/**
 * @typedef {object} RouteState
 * @property {'sessions'|'windows'|'terminal'|'files'|'git'} view
 * @property {string} [session]
 * @property {number} [window]
 * @property {string} [filePath] - files view: ディレクトリパス
 * @property {string|null} [previewFile] - files view: プレビュー中のファイルパス
 * @property {object|null} [gitState] - git view: { commit, diff, branch }
 * @property {boolean} [split]
 * @property {object|null} [rightPanel] - { view, session, window, path }
 */

/**
 * Router はブラウザ履歴を一元管理するクラス。
 *
 * - push / replace で history.pushState / replaceState をラップ
 * - popstate イベントを内部でハンドルし、適切なハンドラにディスパッチ
 * - navigateFromHash でURL ハッシュから初期画面を復元
 * - suppressDuring で popstate 復元中の再 push を防止
 */
export class Router {
  /**
   * @param {object} handlers
   * @param {function(RouteState): void|Promise<void>} handlers.onSessions
   * @param {function(RouteState): void|Promise<void>} handlers.onWindows
   * @param {function(RouteState): void|Promise<void>} handlers.onTerminal
   * @param {function(RouteState): void|Promise<void>} handlers.onFiles
   * @param {function(RouteState): void|Promise<void>} handlers.onGit
   */
  constructor(handlers) {
    this._handlers = handlers;
    this._suppressed = false;

    this._onPopState = this._handlePopState.bind(this);
    window.addEventListener('popstate', this._onPopState);
  }

  /**
   * 新しい履歴エントリを追加する。
   * @param {RouteState} state
   */
  push(state) {
    if (this._suppressed) return;
    const hash = this.buildHash(state);
    history.pushState(state, '', hash);
  }

  /**
   * 現在の履歴エントリを置換する。
   * @param {RouteState} state
   */
  replace(state) {
    if (this._suppressed) return;
    const hash = this.buildHash(state);
    history.replaceState(state, '', hash);
  }

  /**
   * RouteState から URL ハッシュ文字列を生成する。
   * サブコンポーネント状態（previewFile, gitState）は history.state にのみ保存し、
   * URL ハッシュには含めない。
   * @param {RouteState} state
   * @returns {string}
   */
  buildHash(state) {
    let hash = '';

    switch (state.view) {
      case 'sessions':
        hash = '#sessions';
        break;
      case 'windows':
        hash = `#windows/${encodeURIComponent(state.session || '')}`;
        break;
      case 'terminal':
        hash = `#terminal/${encodeURIComponent(state.session || '')}/${state.window ?? 0}`;
        break;
      case 'files': {
        const s = encodeURIComponent(state.session || '');
        const w = state.window ?? 0;
        const path = state.filePath || '.';
        hash = `#files/${s}/${w}${path !== '.' ? '/' + path : ''}`;
        break;
      }
      case 'git':
        hash = `#git/${encodeURIComponent(state.session || '')}/${state.window ?? 0}`;
        break;
      default:
        hash = '#sessions';
    }

    // Split suffix
    if (state.split) {
      if (state.rightPanel) {
        const rp = state.rightPanel;
        const rs = encodeURIComponent(rp.session || '');
        let rightFrag = `terminal/${rs}/${rp.window ?? 0}`;
        if (rp.view === 'files') {
          rightFrag = `files/${rs}/${rp.window ?? 0}${rp.path && rp.path !== '.' ? '/' + rp.path : ''}`;
        } else if (rp.view === 'git') {
          rightFrag = `git/${rs}/${rp.window ?? 0}`;
        }
        hash += `&split=${rightFrag}`;
      } else {
        hash += '&split';
      }
    }

    return hash;
  }

  /**
   * URL ハッシュを解析して RouteState を返す。
   * @param {string} hash - window.location.hash
   * @returns {{ state: RouteState, hasSplit: boolean, rightFragment: string|null }}
   */
  _parseHash(hash) {
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
        rightFragment = splitPart.slice(1);
      }
    }

    const parts = cleanHash.split('/');
    const view = parts[0] || 'sessions';

    /** @type {RouteState} */
    const state = { view };

    switch (view) {
      case 'windows':
        state.session = decodeURIComponent(parts[1] || '');
        break;
      case 'terminal':
        state.session = decodeURIComponent(parts[1] || '');
        state.window = parseInt(parts[2], 10);
        break;
      case 'files':
        state.session = decodeURIComponent(parts[1] || '');
        state.window = parseInt(parts[2], 10);
        state.filePath = parts.slice(3).map(decodeURIComponent).join('/') || '.';
        break;
      case 'git':
        state.session = decodeURIComponent(parts[1] || '');
        state.window = parseInt(parts[2], 10);
        break;
    }

    state.split = hasSplit;

    return { state, hasSplit, rightFragment };
  }

  /**
   * 初期ロード時にハッシュから画面を復元する。
   * @param {string} hash - window.location.hash
   */
  async navigateFromHash(hash) {
    const { state, hasSplit, rightFragment } = this._parseHash(hash);

    // 右パネル情報を state に追加
    if (hasSplit) {
      state.split = true;
      if (rightFragment) {
        state._rightFragment = rightFragment;
      }
    }

    // replace で初期状態を設定
    this.replace(state);

    // ハンドラにディスパッチ
    await this._dispatch(state);
  }

  /**
   * popstate 復元中に push/replace が呼ばれないよう抑制する。
   * @param {function(): void|Promise<void>} fn
   */
  async suppressDuring(fn) {
    this._suppressed = true;
    try {
      await fn();
    } finally {
      this._suppressed = false;
    }
  }

  /**
   * popstate イベントハンドラ。
   * @param {PopStateEvent} event
   */
  async _handlePopState(event) {
    const state = event.state;
    if (!state) {
      await this.suppressDuring(async () => {
        await this._dispatch({ view: 'sessions' });
      });
      return;
    }

    await this.suppressDuring(async () => {
      await this._dispatch(state);
    });
  }

  /**
   * RouteState に基づいて適切なハンドラを呼び出す。
   * @param {RouteState} state
   */
  async _dispatch(state) {
    switch (state.view) {
      case 'sessions':
        if (this._handlers.onSessions) await this._handlers.onSessions(state);
        break;
      case 'windows':
        if (this._handlers.onWindows) await this._handlers.onWindows(state);
        break;
      case 'terminal':
        if (this._handlers.onTerminal) await this._handlers.onTerminal(state);
        break;
      case 'files':
        if (this._handlers.onFiles) await this._handlers.onFiles(state);
        break;
      case 'git':
        if (this._handlers.onGit) await this._handlers.onGit(state);
        break;
      default:
        if (this._handlers.onSessions) await this._handlers.onSessions(state);
    }
  }

  /**
   * イベントリスナーを除去する。
   */
  dispose() {
    window.removeEventListener('popstate', this._onPopState);
  }
}
