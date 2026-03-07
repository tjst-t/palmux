// voice-input.js - Web Speech API を使った音声入力コンポーネント
// 認識結果を IME 入力フィールドに挿入し、既存の IME → WebSocket パイプラインで送信する

/**
 * VoiceInput は IME バー内にマイクボタンを配置し、
 * Web Speech API による音声認識を制御する。
 *
 * - Web Speech API 非対応ブラウザではボタンを表示しない（graceful degradation）
 * - 認識結果は onResult コールバックで返し、IMEInput 側で入力フィールドに挿入する
 * - 中間結果は onInterim コールバックで返す
 */
export class VoiceInput {
  /**
   * Web Speech API が利用可能かどうかを返す。
   * @returns {boolean}
   */
  static isSupported() {
    return !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
  }

  /**
   * @param {HTMLElement} container - マイクボタンを挿入する IME バー要素
   * @param {Object} options
   * @param {function(string): void} options.onResult - 確定テキストのコールバック
   * @param {function(string): void} [options.onInterim] - 中間結果のコールバック
   * @param {function(string): void} [options.onError] - エラーコールバック
   * @param {string} [options.lang='ja-JP'] - 認識言語
   */
  constructor(container, options) {
    this._container = container;
    this._onResult = options.onResult;
    this._onInterim = options.onInterim || null;
    this._onError = options.onError || null;
    this._state = 'idle';
    this._hasError = false;
    this._errorTimer = null;

    // SpeechRecognition インスタンス生成
    const SpeechRecognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    this._recognition = new SpeechRecognition();
    this._recognition.continuous = false;
    this._recognition.interimResults = true;
    this._recognition.lang = options.lang || 'ja-JP';

    this._setupRecognitionEvents();
    this._renderButton();
  }

  /**
   * SpeechRecognition のイベントリスナーを設定する。
   */
  _setupRecognitionEvents() {
    this._recognition.onresult = (event) => {
      const result = event.results[event.resultIndex];
      const transcript = result[0].transcript;

      if (result.isFinal) {
        this._onResult(transcript);
      } else if (this._onInterim) {
        this._onInterim(transcript);
      }
    };

    this._recognition.onerror = (event) => {
      // no-speech はエラーとして扱わない（タイムアウトで自然終了）
      if (event.error === 'no-speech') return;

      this._hasError = true;
      this._setErrorState();
      if (this._onError) {
        this._onError(event.error);
      }
    };

    this._recognition.onend = () => {
      // エラー発生時は --error 表示を維持し、タイマーに任せる
      if (this._hasError) {
        this._hasError = false;
        this._state = 'idle';
        if (this._btn) {
          this._btn.classList.remove('voice-mic-btn--listening');
        }
      } else {
        this._setState('idle');
      }
    };
  }

  /**
   * マイクボタンを描画する。送信ボタンの直前に挿入する。
   */
  _renderButton() {
    this._btn = document.createElement('button');
    this._btn.className = 'voice-mic-btn';
    this._btn.type = 'button';
    this._btn.style.minWidth = '44px';
    this._btn.style.minHeight = '44px';
    this._btn.setAttribute('aria-label', '音声入力');

    // SVG マイクアイコン
    this._btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="1" width="6" height="12" rx="3"></rect>
      <path d="M5 10a7 7 0 0 0 14 0"></path>
      <line x1="12" y1="17" x2="12" y2="21"></line>
      <line x1="8" y1="21" x2="16" y2="21"></line>
    </svg>`;

    this._btn.addEventListener('click', () => this.toggle());

    // 送信ボタンの直前に挿入
    const sendBtn = this._container.querySelector('.ime-send-btn');
    if (sendBtn) {
      this._container.insertBefore(this._btn, sendBtn);
    } else {
      this._container.appendChild(this._btn);
    }
  }

  /**
   * 状態を設定し、ボタンのクラスを更新する。
   * @param {'idle'|'listening'} newState
   */
  _setState(newState) {
    this._state = newState;
    if (!this._btn) return;

    this._btn.classList.toggle('voice-mic-btn--listening', newState === 'listening');
    if (newState !== 'idle') return;
    this._btn.classList.remove('voice-mic-btn--error');
  }

  /**
   * エラー状態を表示する。
   */
  _setErrorState() {
    if (!this._btn) return;
    this._btn.classList.add('voice-mic-btn--error');
    if (this._errorTimer) clearTimeout(this._errorTimer);
    this._errorTimer = setTimeout(() => {
      if (this._btn) {
        this._btn.classList.remove('voice-mic-btn--error');
      }
    }, 1500);
  }

  /**
   * 音声認識を開始する。
   */
  start() {
    if (this._state === 'listening') return;
    this._setState('listening');
    this._recognition.start();
  }

  /**
   * 音声認識を停止する。
   */
  stop() {
    if (this._state !== 'listening') return;
    this._setState('idle');
    this._recognition.stop();
  }

  /**
   * 音声認識の開始/停止をトグルする。
   */
  toggle() {
    if (this._state === 'listening') {
      this.stop();
    } else {
      this.start();
    }
  }

  /**
   * 現在の状態を返す。
   * @returns {'idle'|'listening'}
   */
  get state() {
    return this._state;
  }

  /**
   * 認識言語を変更する。
   * @param {string} lang - BCP 47 言語タグ（例: 'ja-JP', 'en-US'）
   */
  setLang(lang) {
    this._recognition.lang = lang;
  }

  /**
   * リソースを解放する。
   */
  destroy() {
    if (this._state === 'listening') {
      this._recognition.abort();
    }
    this._state = 'idle';
    if (this._errorTimer) {
      clearTimeout(this._errorTimer);
      this._errorTimer = null;
    }
    if (this._btn) {
      this._btn.remove();
      this._btn = null;
    }
  }
}
