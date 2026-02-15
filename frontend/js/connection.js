// connection.js - 接続状態管理と自動再接続

/**
 * ConnectionManager は WebSocket の接続状態を管理し、
 * 切断時に指数バックオフで自動再接続を行う。
 *
 * 状態:
 * - connected: 接続中
 * - connecting: 再接続試行中
 * - disconnected: 切断（手動切断、再接続しない）
 */
export class ConnectionManager {
  /**
   * @param {object} options
   * @param {function(): string} options.getWSUrl - 現在の WebSocket URL を返す関数
   * @param {function(string): void} options.onStateChange - 状態変更コールバック
   * @param {import('./terminal.js').PalmuxTerminal} options.terminal - ターミナルインスタンス
   */
  constructor(options) {
    this._state = 'disconnected';
    this._retryCount = 0;
    this._retryTimer = null;
    this._maxRetryDelay = 30000;
    this._terminal = options.terminal;
    this._getWSUrl = options.getWSUrl;
    this._onStateChange = options.onStateChange;
    this._destroyed = false;

    this._onOnlineBound = () => this._onOnline();
    window.addEventListener('online', this._onOnlineBound);
  }

  /**
   * 現在の接続状態を返す。
   * @returns {string} 'connected' | 'connecting' | 'disconnected'
   */
  get state() {
    return this._state;
  }

  /**
   * WebSocket 接続を開始する。
   * 接続成功時に状態を 'connected' に、失敗/切断時に自動再接続を試行する。
   */
  connect() {
    if (this._destroyed) return;

    this._setState('connecting');
    const wsUrl = this._getWSUrl();

    this._terminal.connect(wsUrl, () => this._onDisconnect());

    // terminal の onConnect コールバックを設定
    this._terminal.setOnConnect(() => {
      this._retryCount = 0;
      this._setState('connected');
    });
  }

  /**
   * 手動再接続を即座に試行する。
   * disconnected 状態でもリトライカウントをリセットして接続を試みる。
   */
  reconnectNow() {
    if (this._destroyed) return;

    this._clearRetryTimer();
    this._retryCount = 0;
    this.connect();
  }

  /**
   * 意図的に接続を切断する。自動再接続は行わない。
   */
  disconnect() {
    this._destroyed = true;
    this._setState('disconnected');
    this._clearRetryTimer();
    this._retryCount = 0;
    this._terminal.disconnect();
    window.removeEventListener('online', this._onOnlineBound);
  }

  /**
   * リソースをクリーンアップする（disconnect と同義）。
   */
  destroy() {
    this.disconnect();
  }

  /**
   * WebSocket の予期しない切断時に呼ばれる。
   * 自動再接続をスケジュールする。
   * @private
   */
  _onDisconnect() {
    // 手動切断済み（disconnect() 呼び出し後）の場合は何もしない
    if (this._destroyed) return;

    this._setState('connecting');
    this._scheduleRetry();
  }

  /**
   * 指数バックオフで再接続をスケジュールする。
   * 遅延: 1s -> 2s -> 4s -> 8s -> 16s -> 30s (最大)
   * @private
   */
  _scheduleRetry() {
    this._clearRetryTimer();

    const delay = Math.min(
      1000 * Math.pow(2, this._retryCount),
      this._maxRetryDelay
    );
    this._retryCount++;

    this._retryTimer = setTimeout(() => {
      if (!this._destroyed) {
        this.connect();
      }
    }, delay);
  }

  /**
   * ネットワークがオンラインに復帰した時の処理。
   * connecting 状態の場合、即座に再接続を試行する。
   * @private
   */
  _onOnline() {
    if (this._destroyed) return;

    if (this._state === 'connecting') {
      this._clearRetryTimer();
      this._retryCount = 0;
      this.connect();
    }
  }

  /**
   * 接続状態を更新し、コールバックを呼び出す。
   * @param {string} newState - 新しい状態
   * @private
   */
  _setState(newState) {
    if (this._state === newState) return;
    this._state = newState;
    if (this._onStateChange) {
      this._onStateChange(newState);
    }
  }

  /**
   * リトライタイマーをクリアする。
   * @private
   */
  _clearRetryTimer() {
    if (this._retryTimer !== null) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }
}
