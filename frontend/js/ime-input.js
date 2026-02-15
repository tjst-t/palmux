// ime-input.js - IME 入力フィールドコンポーネント
// Direct/IME モード切り替えで日本語等の変換入力をサポートする

/**
 * IMEInput はターミナル下部に配置される IME 入力フィールド。
 * 通常は非表示で、ツールバーの [あ] ボタンでトグルする。
 *
 * - Enter: 確定テキスト + '\n' を送信し、フィールドクリア
 * - Shift+Enter: 確定テキストのみ送信（'\n' なし）、フィールドクリア
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
      // IME 変換中（isComposing）は何もしない
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        if (e.shiftKey) {
          this._send(false); // 改行なし
        } else {
          this._send(true); // 改行あり
        }
      }
    });

    this._sendBtn.addEventListener('click', () => {
      this._send(true);
    });
  }

  /**
   * 入力テキストを送信する。
   * @param {boolean} withNewline - 末尾に '\n' を付与するか
   */
  _send(withNewline) {
    const text = this._input.value;
    if (text) {
      this._onSend(withNewline ? text + '\n' : text);
      this._input.value = '';
    }
    this._input.focus();
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
