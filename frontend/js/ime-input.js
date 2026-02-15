// ime-input.js - IME 入力フィールドコンポーネント
// Direct/IME モード切り替えで日本語等の変換入力をサポートする

/**
 * IMEInput はターミナル下部に配置される IME 入力フィールド。
 * 通常は非表示で、ツールバーの [あ] ボタンでトグルする。
 *
 * - Enter（テキストあり）: 確定テキストのみ送信し、フィールドクリア
 * - Enter（テキストなし）: '\r'（Enter キー）をターミナルに送信
 * - Shift+Enter: 確定テキスト + '\r' を一括送信し、フィールドクリア
 * - 送信後もフォーカスを維持（連続入力可能）
 * - e.isComposing チェックで未確定の IME 入力中は送信しない
 */
export class IMEInput {
  /**
   * @param {HTMLElement} container - IME 入力バーをマウントする DOM 要素
   * @param {Object} options
   * @param {function(string): void} options.onSend - テキストを送信するコールバック
   * @param {function(boolean): void} [options.onToggle] - IME モード変更時のコールバック
   */
  constructor(container, options) {
    this._container = container;
    this._visible = false;
    this._onSend = options.onSend;
    this._onToggle = options.onToggle || null;
    this._render();
  }

  /**
   * DOM 要素を構築する。
   */
  _render() {
    this._el = document.createElement('div');
    this._el.className = 'ime-input-bar';
    this._el.style.display = 'none';

    this._input = document.createElement('input');
    this._input.type = 'text';
    this._input.className = 'ime-input-field';
    this._input.placeholder = '\u65E5\u672C\u8A9E\u5165\u529B...';

    this._sendBtn = document.createElement('button');
    this._sendBtn.className = 'ime-send-btn';
    this._sendBtn.textContent = '\u9001\u4FE1';

    this._el.appendChild(this._input);
    this._el.appendChild(this._sendBtn);
    this._container.appendChild(this._el);

    this._setupEvents();
  }

  /**
   * イベントリスナーを設定する。
   */
  _setupEvents() {
    this._input.addEventListener('keydown', (e) => {
      if (e.isComposing) {
        return; // IME 変換中は何もしない
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          this._send(true); // テキスト + Enter を一括送信
        } else {
          this._send(false); // テキストのみ、または空なら Enter
        }
      } else if (e.key === 'Backspace' && !this._input.value) {
        // フィールドが空の場合、ターミナルに Backspace を送信
        e.preventDefault();
        this._onSend('\x7f');
      }
    });

    this._sendBtn.addEventListener('click', () => {
      this._send(true);
    });
  }

  /**
   * 入力テキストを送信する。
   * @param {boolean} withEnter - テキストと一緒に '\r' も送信するか
   */
  _send(withEnter) {
    const text = this._input.value;
    if (text) {
      this._onSend(withEnter ? text + '\r' : text);
      this._input.value = '';
    } else {
      // テキストが空の場合は Enter を送信
      this._onSend('\r');
    }
    this._input.focus();
  }

  /**
   * IME 入力フィールドを表示する。
   */
  show() {
    if (!this._visible) {
      this._visible = true;
      this._el.style.display = 'flex';
      this._input.focus();
      if (this._onToggle) {
        this._onToggle(true);
      }
    }
  }

  /**
   * IME 入力フィールドを非表示にする。
   */
  hide() {
    if (this._visible) {
      this._visible = false;
      this._el.style.display = 'none';
      if (this._onToggle) {
        this._onToggle(false);
      }
    }
  }

  /**
   * IME 入力フィールドの表示/非表示をトグルする。
   */
  toggle() {
    this._visible = !this._visible;
    this._el.style.display = this._visible ? 'flex' : 'none';
    if (this._visible) {
      this._input.focus();
    }
    if (this._onToggle) {
      this._onToggle(this._visible);
    }
  }

  /**
   * IME 入力フィールドが現在表示されているか。
   * @returns {boolean}
   */
  get isVisible() {
    return this._visible;
  }

  /**
   * リソースを解放する。
   */
  destroy() {
    this._el.remove();
  }
}
