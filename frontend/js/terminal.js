// terminal.js - xterm.js ラッパー（WebSocket 接続、resize 処理）

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

/**
 * PalmuxTerminal は xterm.js のラッパー。
 * WebSocket 経由でサーバーの pty と双方向通信する。
 */
export class PalmuxTerminal {
  /**
   * @param {HTMLElement} container - ターミナルをマウントする DOM 要素
   */
  constructor(container) {
    this._container = container;
    this._ws = null;
    this._term = null;
    this._fitAddon = null;
    this._resizeObserver = null;
    this._onDisconnect = null;
    /** @type {function|null} 接続成功時のコールバック */
    this._onConnect = null;
    /** @type {import('./toolbar.js').Toolbar|null} */
    this._toolbar = null;
    /** @type {boolean} IME モード有効時は onData ハンドラからの入力送信を抑制する */
    this._imeMode = false;
  }

  /**
   * ターミナルを初期化し、コンテナにマウントする。
   */
  _initTerminal() {
    if (this._term) {
      this._term.dispose();
    }

    this._fitAddon = new FitAddon();

    // localStorage からフォントサイズを復元（範囲: 8〜24px、デフォルト: 14px）
    const savedSize = parseInt(localStorage.getItem('palmux-font-size'), 10);
    const fontSize = (savedSize >= 8 && savedSize <= 24) ? savedSize : 14;

    this._term = new Terminal({
      cursorBlink: true,
      fontSize: fontSize,
      fontFamily: '"Cascadia Code", "Fira Code", "Source Code Pro", monospace',
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
        selectionBackground: 'rgba(255, 255, 255, 0.3)',
      },
    });

    this._term.loadAddon(this._fitAddon);
    this._term.loadAddon(new WebLinksAddon());

    this._term.open(this._container);

    // inputmode="none" でスマホの IME を抑制（DESIGN.md の指示）
    const textarea = this._container.querySelector('.xterm-helper-textarea');
    if (textarea) {
      textarea.setAttribute('inputmode', 'none');
    }

    this.fit();

    // ウィンドウリサイズ時に自動フィット
    this._resizeObserver = new ResizeObserver(() => {
      this.fit();
    });
    this._resizeObserver.observe(this._container);
  }

  /**
   * WebSocket 経由でサーバーに接続し、pty との双方向通信を開始する。
   * @param {string} wsUrl - WebSocket URL（トークン付き）
   * @param {function} [onDisconnect] - 切断時のコールバック
   */
  connect(wsUrl, onDisconnect) {
    this.disconnect();
    this._initTerminal();
    this._onDisconnect = onDisconnect || null;

    this._ws = new WebSocket(wsUrl);

    this._ws.onopen = () => {
      // 接続成功時にリサイズ情報を送信
      this._sendResize();
      if (this._onConnect) {
        this._onConnect();
      }
    };

    this._ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output' && msg.data) {
          this._term.write(msg.data);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    this._ws.onclose = () => {
      if (this._onDisconnect) {
        this._onDisconnect();
      }
    };

    this._ws.onerror = (event) => {
      console.error('WebSocket error:', event);
    };

    // ターミナル入力を WebSocket に送信（修飾キー合成付き）
    // IME モード有効時は直接入力を抑制する（IME フィールド経由で送信）
    this._term.onData((data) => {
      if (this._imeMode) {
        return;
      }
      if (this._toolbar) {
        const mods = this._toolbar.consumeModifiers();
        data = this._applyModifiers(data, mods);
      }
      this._sendInput(data);
    });
  }

  /**
   * WebSocket 接続を切断し、リソースをクリーンアップする。
   */
  disconnect() {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._term) {
      this._term.dispose();
      this._term = null;
    }
    this._fitAddon = null;
  }

  /**
   * ターミナルをコンテナサイズにフィットさせ、リサイズ情報をサーバーに送信する。
   */
  fit() {
    if (this._fitAddon && this._term) {
      try {
        this._fitAddon.fit();
        this._sendResize();
      } catch (e) {
        // ターミナルがまだ表示されていない場合のエラーを無視
      }
    }
  }

  /**
   * 入力メッセージを WebSocket に送信する。
   * @param {string} data - 入力データ
   */
  _sendInput(data) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({
        type: 'input',
        data: data,
      }));
    }
  }

  /**
   * リサイズメッセージを WebSocket に送信する。
   */
  _sendResize() {
    if (this._ws && this._ws.readyState === WebSocket.OPEN && this._term) {
      this._ws.send(JSON.stringify({
        type: 'resize',
        cols: this._term.cols,
        rows: this._term.rows,
      }));
    }
  }

  /**
   * 修飾キー状態を入力データに適用する。
   * Ctrl: 単一文字の場合、制御文字に変換する（例: 'c' -> \x03）
   * Alt: ESC プレフィクスを付与する（例: 'x' -> \x1bx）
   * @param {string} data - 元の入力データ
   * @param {{ ctrl: boolean, alt: boolean }} mods - 修飾キー状態
   * @returns {string} 修飾適用後のデータ
   */
  _applyModifiers(data, mods) {
    let result = data;

    if (mods.ctrl && result.length === 1) {
      const code = result.toUpperCase().charCodeAt(0);
      // @ (64) から _ (95) の範囲で制御文字に変換
      // Ctrl+@ = \x00, Ctrl+A = \x01, ..., Ctrl+Z = \x1a, ..., Ctrl+_ = \x1f
      if (code >= 64 && code <= 95) {
        result = String.fromCharCode(code - 64);
      }
    }

    if (mods.alt) {
      result = '\x1b' + result;
    }

    return result;
  }

  /**
   * フォントサイズを設定する（8〜24px にクランプ）。
   * 変更後に fit() を呼んで再レイアウトし、localStorage に保存する。
   * @param {number} size - 設定するフォントサイズ（px）
   * @returns {number} クランプ後の実際のフォントサイズ
   */
  setFontSize(size) {
    const clamped = Math.max(8, Math.min(24, size));
    if (this._term) {
      this._term.options.fontSize = clamped;
      this.fit();
    }
    localStorage.setItem('palmux-font-size', clamped);
    return clamped;
  }

  /**
   * フォントサイズを 2px 大きくする。
   * @returns {number} 変更後のフォントサイズ
   */
  increaseFontSize() {
    return this.setFontSize((this._term?.options.fontSize || 14) + 2);
  }

  /**
   * フォントサイズを 2px 小さくする。
   * @returns {number} 変更後のフォントサイズ
   */
  decreaseFontSize() {
    return this.setFontSize((this._term?.options.fontSize || 14) - 2);
  }

  /**
   * 現在のフォントサイズを返す。
   * @returns {number} フォントサイズ（px）
   */
  getFontSize() {
    return this._term?.options.fontSize || 14;
  }

  /**
   * 入力データを WebSocket 経由でサーバーに送信する（公開メソッド）。
   * ツールバーからの直接送信に使用する。
   * @param {string} data - 送信するデータ
   */
  sendInput(data) {
    this._sendInput(data);
  }

  /**
   * ツールバーを設定する。
   * @param {import('./toolbar.js').Toolbar|null} toolbar
   */
  setToolbar(toolbar) {
    this._toolbar = toolbar;
  }

  /**
   * IME モードの有効/無効を切り替える。
   * IME モード有効時はターミナルへの直接キー入力を無効化し、
   * IME 入力フィールド経由でのみテキストを送信する。
   * @param {boolean} enabled - true で IME モード有効
   */
  setIMEMode(enabled) {
    this._imeMode = enabled;
  }

  /**
   * 接続成功時のコールバックを設定する。
   * ConnectionManager が接続成功を検知するために使用する。
   * @param {function|null} callback - 接続成功時に呼ばれるコールバック
   */
  setOnConnect(callback) {
    this._onConnect = callback;
  }

  /**
   * ターミナルにフォーカスする。
   */
  focus() {
    if (this._term) {
      this._term.focus();
    }
  }
}
