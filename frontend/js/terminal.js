// terminal.js - xterm.js ラッパー（WebSocket 接続、resize 処理）

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { uploadImage } from './api.js';

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
    /** @type {function|null} クライアントセッション/ウィンドウ変更時のコールバック */
    this._onClientStatus = null;
    /** @type {function|null} 通知更新時のコールバック */
    this._onNotificationUpdate = null;
    /** @type {import('./toolbar.js').Toolbar|null} */
    this._toolbar = null;
    /** @type {boolean} IME モード有効時は onData ハンドラからの入力送信を抑制する */
    this._imeMode = false;
    /** @type {boolean} 修飾キー即時送信で処理済みフラグ（onData 二重送信防止） */
    this._modifierHandled = false;
    /** @type {function|null} document レベルの keydown ハンドラー参照 */
    this._boundGlobalKeyHandler = null;
    /** @type {function|null} document レベルの paste ハンドラー参照 */
    this._boundPasteHandler = null;
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
      allowProposedApi: true,
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

    // Unicode 11 の文字幅テーブルを使用し、CJK 文字の幅を正しく計算する
    const unicode11Addon = new Unicode11Addon();
    this._term.loadAddon(unicode11Addon);
    this._term.unicode.activeVersion = '11';

    // OSC 52 クリップボード同期（tmux コピーモード等 → ブラウザクリップボード）
    // HTTPS または localhost でのみ navigator.clipboard API が利用可能
    // tmux は selection パラメータを空文字で送るため、デフォルトプロバイダ（"c" のみ受付）
    // では動作しない。全 selection タイプを受け付けるカスタムプロバイダを使用する。
    this._term.loadAddon(new ClipboardAddon(undefined, {
      readText() { return navigator.clipboard.readText(); },
      writeText(_selection, text) { return navigator.clipboard.writeText(text); },
    }));

    // Ctrl+V / Cmd+V: xterm.js が ^V 制御文字を送信するのを抑止する。
    // return false でキー処理をスキップするが、preventDefault() は呼ばないので
    // ブラウザのネイティブ paste イベントが発火し、テキスト・画像ペーストが動作する。
    this._term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.key.toLowerCase() === 'v' &&
          (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        return false; // xterm.js の ^V 送信を抑止、paste イベントに委譲
      }
      return true;
    });

    // ブラウザショートカット（Ctrl+N, Ctrl+T 等）を抑止し、ターミナルに送信する。
    // document レベルで捕捉することで、xterm にフォーカスがない場合でも動作する。
    if (this._boundGlobalKeyHandler) {
      document.removeEventListener('keydown', this._boundGlobalKeyHandler);
    }
    this._boundGlobalKeyHandler = this._globalKeyHandler.bind(this);
    document.addEventListener('keydown', this._boundGlobalKeyHandler);

    // デフォルトは 'none' モード（ソフトキーボード非表示）
    // ツールバーのキーボードモード切替で 'direct'/'ime' に変更可能
    const helperTextarea = this._container.querySelector('.xterm-helper-textarea');
    if (helperTextarea) {
      helperTextarea.setAttribute('inputmode', 'none');
    }

    this.fit();

    // ウィンドウリサイズ時に自動フィット
    this._resizeObserver = new ResizeObserver(() => {
      this.fit();
    });
    this._resizeObserver.observe(this._container);

    // クリップボードから画像をペースト → アップロード → パスをターミナルに入力
    // xterm.js が paste イベントの伝播を止めるため、キャプチャフェーズで先に捕捉する
    if (this._boundPasteHandler) {
      document.removeEventListener('paste', this._boundPasteHandler, true);
    }
    this._boundPasteHandler = this._handlePaste.bind(this);
    document.addEventListener('paste', this._boundPasteHandler, true);

    // 修飾キー有効時の即時送信: IME の composing を待たずに制御文字を送信
    if (helperTextarea) {
      helperTextarea.addEventListener('input', (e) => {
        if (!this._toolbar) return;
        if (!this._toolbar.hasCtrl() && !this._toolbar.hasAlt()) return;

        // 修飾キーが有効な場合、入力された文字を即座に制御文字として送信
        const char = e.data;
        if (!char) return;

        const mods = this._toolbar.consumeModifiers();
        const modified = this._applyModifiers(char, mods);
        this._sendInput(modified);

        // composing をキャンセルし、onData での二重送信を防止
        helperTextarea.value = '';
        this._modifierHandled = true;
      });
    }
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
        } else if (msg.type === 'ping') {
          // サーバーからの ping に pong で応答（Cloudflare アイドルタイムアウト対策）
          this._ws.send(JSON.stringify({ type: 'pong' }));
        } else if (msg.type === 'client_status') {
          if (this._onClientStatus) {
            this._onClientStatus(msg.session, msg.window);
          }
        } else if (msg.type === 'notification_update') {
          if (this._onNotificationUpdate) {
            this._onNotificationUpdate(msg.notifications || []);
          }
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
      // 修飾キー即時送信で既に処理済みの場合はスキップ（二重送信防止）
      if (this._modifierHandled) {
        this._modifierHandled = false;
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
   * WebSocket のみ再接続する（ターミナルは保持）。
   * 自動再接続時のちらつきを防止する。
   * ターミナルが未初期化の場合はフルコネクトにフォールバック。
   * @param {string} wsUrl - WebSocket URL（トークン付き）
   * @param {function} [onDisconnect] - 切断時のコールバック
   */
  reconnect(wsUrl, onDisconnect) {
    if (!this._term) {
      this.connect(wsUrl, onDisconnect);
      return;
    }

    // 古い WebSocket をクリーンアップ（onclose 発火を防止）
    if (this._ws) {
      this._ws.onopen = null;
      this._ws.onmessage = null;
      this._ws.onclose = null;
      this._ws.onerror = null;
      this._ws.close();
      this._ws = null;
    }

    this._onDisconnect = onDisconnect || null;

    this._ws = new WebSocket(wsUrl);

    this._ws.onopen = () => {
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
        } else if (msg.type === 'ping') {
          this._ws.send(JSON.stringify({ type: 'pong' }));
        } else if (msg.type === 'client_status') {
          if (this._onClientStatus) {
            this._onClientStatus(msg.session, msg.window);
          }
        } else if (msg.type === 'notification_update') {
          if (this._onNotificationUpdate) {
            this._onNotificationUpdate(msg.notifications || []);
          }
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
  }

  /**
   * WebSocket 接続を切断し、リソースをクリーンアップする。
   */
  disconnect() {
    if (this._boundGlobalKeyHandler) {
      document.removeEventListener('keydown', this._boundGlobalKeyHandler);
      this._boundGlobalKeyHandler = null;
    }
    if (this._boundPasteHandler) {
      document.removeEventListener('paste', this._boundPasteHandler, true);
      this._boundPasteHandler = null;
    }
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
   * キーボードモードを設定する。
   * - 'none': inputmode="none"（ソフトキーボード非表示、外部キーボード用）
   * - 'direct': inputmode="url"（ソフトキーボード表示、ASCII 直接入力。Android IME の変換下線を回避）
   * - 'ime': inputmode="none"（ソフトキーボード非表示、IME 入力バー経由で入力）
   * @param {'none' | 'direct' | 'ime'} mode - キーボードモード
   */
  setKeyboardMode(mode) {
    const helperTextarea = this._container.querySelector('.xterm-helper-textarea');
    if (!helperTextarea) return;

    switch (mode) {
      case 'none':
        helperTextarea.setAttribute('inputmode', 'none');
        break;
      case 'direct':
        helperTextarea.setAttribute('inputmode', 'url');
        break;
      case 'ime':
        helperTextarea.setAttribute('inputmode', 'none');
        break;
      default:
        helperTextarea.setAttribute('inputmode', 'none');
        break;
    }
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
   * クライアントのセッション/ウィンドウ変更時のコールバックを設定する。
   * サーバーから client_status メッセージを受信した際に呼ばれる。
   * セッション切替・ウィンドウ切替の両方を通知する。
   * @param {function(string, number): void|null} callback - (session, window) を受け取るコールバック
   */
  setOnClientStatus(callback) {
    this._onClientStatus = callback;
  }

  /**
   * 通知更新時のコールバックを設定する。
   * サーバーから notification_update メッセージを受信した際に呼ばれる。
   * @param {function(Array<{session: string, window_index: number, type: string}>): void|null} callback
   */
  setOnNotificationUpdate(callback) {
    this._onNotificationUpdate = callback;
  }

  /**
   * paste イベントハンドラ。
   * クリップボードに画像がある場合のみインターセプトし、アップロードしてパスを送信する。
   * 画像がない場合は何もせず xterm.js のテキストペースト処理に任せる。
   * @param {ClipboardEvent} e
   */
  _handlePaste(e) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;

    const files = e.clipboardData?.files;
    if (!files || files.length === 0) return;

    const imageFile = Array.from(files).find((f) => f.type.startsWith('image/'));
    if (!imageFile) return;

    // 画像が見つかった場合のみ既定の paste 動作を止める
    e.preventDefault();
    e.stopImmediatePropagation();
    this._showUploadFeedback('Uploading...', 'info');

    uploadImage(imageFile)
      .then((resp) => {
        this._sendInput(resp.path);
        this._showUploadFeedback('Pasted: ' + resp.path, 'success');
      })
      .catch((err) => {
        console.error('Image upload failed:', err);
        this._showUploadFeedback('Upload failed', 'error');
      });
  }

  /**
   * アップロードフィードバックをトースト表示する。
   * 既存の .drawer-toast CSS クラスを再利用する。
   * @param {string} message - 表示メッセージ
   * @param {'info'|'success'|'error'} type - トーストの種類
   */
  _showUploadFeedback(message, type) {
    // 既存のトーストがあれば削除
    const existing = document.querySelector('.drawer-toast--upload');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `drawer-toast drawer-toast--upload drawer-toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // 表示アニメーション
    requestAnimationFrame(() => {
      toast.classList.add('drawer-toast--visible');
    });

    // 自動で非表示 + 削除
    setTimeout(() => {
      toast.classList.remove('drawer-toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, type === 'error' ? 3000 : 2000);
  }

  /**
   * document レベルの keydown ハンドラー。
   * ターミナル接続中にブラウザショートカットを抑止し、
   * xterm にフォーカスがない場合は制御文字を直接送信する。
   * @param {KeyboardEvent} e
   */
  _globalKeyHandler(e) {
    if (!this._term || !this._ws) return;

    // ブラウザ DevTools は許可
    if (e.key === 'F12') return;
    if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J')) return;

    // Ctrl+V / Cmd+V: ブラウザのネイティブ paste イベントに委譲する。
    // preventDefault() を呼ばないことで paste イベントが発火し、
    // _handlePaste（画像）と xterm.js（テキスト）が処理する。
    // ターミナル非フォーカス時はフォーカスを移してから paste を発火させる。
    if (e.key.toLowerCase() === 'v' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      if (!this._isTerminalFocused()) {
        this._term.focus();
      }
      return; // preventDefault() を呼ばない → paste イベント発火
    }

    // Ctrl+<key>: ブラウザデフォルト動作を抑止（Ctrl+V は上で除外）
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      const key = e.key.toLowerCase();
      if (key !== 'v' && key.length === 1) {
        e.preventDefault();
        // xterm にフォーカスがなければ制御文字を直接送信
        if (!this._isTerminalFocused()) {
          const code = key.toUpperCase().charCodeAt(0);
          if (code >= 64 && code <= 95) {
            this._sendInput(String.fromCharCode(code - 64));
          }
          this._term.focus();
        }
      }
    }

    // Alt+<key>: メニューバー起動等を抑止
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
      e.preventDefault();
      if (!this._isTerminalFocused()) {
        this._sendInput('\x1b' + e.key);
        this._term.focus();
      }
    }
  }

  /**
   * xterm のテキストエリアにフォーカスがあるかを返す。
   * @returns {boolean}
   */
  _isTerminalFocused() {
    const active = document.activeElement;
    const helperTextarea = this._container.querySelector('.xterm-helper-textarea');
    return active === helperTextarea;
  }

  /**
   * ターミナルにフォーカスする。
   */
  focus() {
    if (this._term) {
      this._term.focus();
    }
  }

  /**
   * 画面座標からターミナルのセル位置（col, row）を算出する。
   * @param {number} x - clientX
   * @param {number} y - clientY
   * @returns {{ col: number, row: number }|null}
   */
  getCellFromPoint(x, y) {
    const screen = this._container.querySelector('.xterm-screen');
    if (!screen || !this._term) return null;
    const rect = screen.getBoundingClientRect();
    const col = Math.floor((x - rect.left) / (rect.width / this._term.cols));
    const row = Math.floor((y - rect.top) / (rect.height / this._term.rows));
    return {
      col: Math.max(0, Math.min(col, this._term.cols - 1)),
      row: Math.max(0, Math.min(row, this._term.rows - 1)),
    };
  }

  /**
   * ビューポート行のテキストを返す。
   * @param {number} viewportRow - ビューポート内の行番号（0 始まり）
   * @returns {string}
   */
  getLineText(viewportRow) {
    if (!this._term) return '';
    const bufferRow = this._term.buffer.active.viewportY + viewportRow;
    const line = this._term.buffer.active.getLine(bufferRow);
    return line ? line.translateToString() : '';
  }

  /**
   * テキスト範囲を選択する。
   * @param {number} col - 開始列
   * @param {number} row - 開始行（ビューポート相対）
   * @param {number} length - 選択する文字数（行をまたぐ場合は列数単位で折り返す）
   */
  select(col, row, length) {
    if (this._term) {
      this._term.select(col, row, length);
    }
  }

  /**
   * 現在の選択テキストを返す。
   * @returns {string}
   */
  getSelection() {
    return this._term ? this._term.getSelection() : '';
  }

  /**
   * 選択を解除する。
   */
  clearSelection() {
    if (this._term) {
      this._term.clearSelection();
    }
  }

  /**
   * ターミナルの列数を返す。
   * @returns {number}
   */
  getCols() {
    return this._term ? this._term.cols : 80;
  }
}
