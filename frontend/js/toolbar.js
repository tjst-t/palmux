// toolbar.js - 修飾キーツールバー（Termux 互換キーボードインターフェース）

/**
 * 修飾キーの状態
 * @typedef {'off' | 'oneshot' | 'locked'} ModifierState
 */

/**
 * ボタン定義
 * @typedef {Object} ButtonDef
 * @property {string} label - 表示ラベル
 * @property {string} type - 'instant' | 'modifier' | 'keyboard-mode'
 * @property {string} [key] - 送信するキーシーケンス（instant の場合）
 * @property {string} [modifier] - 修飾キー名（modifier の場合: 'ctrl' | 'alt'）
 * @property {boolean} [repeat] - キーリピート対応（矢印キー、Backspace）
 * @property {Object} [popup] - スワイプアップで表示する代替キー
 * @property {string} [popup.label] - ポップアップの表示ラベル
 * @property {string} [popup.key] - ポップアップで送信するキー
 */

/** @type {ButtonDef[]} */
const IME_BUTTON_DEFS = [
  { label: '\u3042',    type: 'keyboard-mode' },
];

/** @type {ButtonDef[]} */
const LEFT_BUTTON_DEFS = [
  { label: 'Esc',  type: 'instant',  key: '\x1b' },
  { label: 'Tab',  type: 'instant',  key: '\t' },
  { label: 'Ctrl', type: 'modifier', modifier: 'ctrl' },
  { label: 'Alt',  type: 'modifier', modifier: 'alt' },
  { label: '/',   type: 'instant',  key: '/',  popup: { label: '|', key: '|' } },
  { label: '-',   type: 'instant',  key: '-',  popup: { label: '_', key: '_' } },
];

/** @type {ButtonDef[]} */
const RIGHT_BUTTON_DEFS = [
  { label: '\u2191',    type: 'instant',  key: '\x1b[A', repeat: true },
  { label: '\u2193',    type: 'instant',  key: '\x1b[B', repeat: true },
  { label: '\u2190',    type: 'instant',  key: '\x1b[D', repeat: true },
  { label: '\u2192',    type: 'instant',  key: '\x1b[C', repeat: true },
  { label: '\u232B',    type: 'instant',  key: '\x7f',   repeat: true },
  { label: '\u21B5',    type: 'instant',  key: '\r' },
];

/**
 * ショートカットキーの定義
 * @type {Array<{label: string, key: string}>}
 */
const SHORTCUT_DEFS = [
  { label: '^C', key: '\x03' },
  { label: '^Z', key: '\x1a' },
  { label: '^D', key: '\x04' },
  { label: '^O', key: '\x0f' },
  { label: '^L', key: '\x0c' },
  { label: '^R', key: '\x12' },
  { label: '^A', key: '\x01' },
  { label: '^E', key: '\x05' },
  { label: '^W', key: '\x17' },
  { label: '^U', key: '\x15' },
  { label: '^K', key: '\x0b' },
];

/**
 * Toolbar は修飾キーツールバーコンポーネント。
 * ワンショット（タップ）とロック（長押し）の2モードに対応する（Termux スタイル）。
 */
export class Toolbar {
  /**
   * @param {HTMLElement} container - ツールバーをマウントする DOM 要素
   * @param {Object} options
   * @param {function(string): void} options.onSendKey - キーシーケンスを送信するコールバック
   * @param {function(string): void} [options.onKeyboardMode] - キーボードモード変更時のコールバック（mode: 'none' | 'direct' | 'ime'）
   */
  constructor(container, options) {
    this._container = container;
    this._onSendKey = options.onSendKey;
    this._onKeyboardMode = options.onKeyboardMode || null;

    /** @type {'none' | 'direct' | 'ime'} キーボードモード */
    this._keyboardMode = 'none';

    /** @type {HTMLButtonElement|null} キーボードモードボタンの参照 */
    this._keyboardModeBtn = null;

    /** @type {ModifierState} */
    this._ctrlState = 'off';
    /** @type {ModifierState} */
    this._altState = 'off';

    /** @type {boolean} */
    this._visible = true;

    /** @type {boolean} ショートカットモード中かどうか */
    this._inShortcutMode = false;

    /** @type {Object<string, HTMLButtonElement>} */
    this._buttons = {};

    /** @type {number|null} 長押しロック検出用タイマー */
    this._longPressTimer = null;

    /** @type {number} 長押し判定の閾値（ミリ秒） */
    this._longPressThreshold = 400;

    /** @type {boolean} 長押しが発火したかどうか */
    this._longPressTriggered = false;

    /** @type {number|null} キーリピート初回遅延タイマー */
    this._repeatTimer = null;

    /** @type {number|null} キーリピートインターバル */
    this._repeatInterval = null;

    /** @type {number} キーリピート開始までの遅延（ミリ秒） */
    this._repeatInitialDelay = 400;

    /** @type {number} キーリピートの間隔（ミリ秒） */
    this._repeatIntervalMs = 80;

    this._render();
  }

  /**
   * ツールバーの DOM を構築する。
   */
  _render() {
    this._container.innerHTML = '';
    this._container.className = 'toolbar';

    const row = document.createElement('div');
    row.className = 'toolbar-row';

    const imeGroup = document.createElement('div');
    imeGroup.className = 'toolbar-group toolbar-group--ime';

    const leftGroup = document.createElement('div');
    leftGroup.className = 'toolbar-group toolbar-group--left';

    const rightGroup = document.createElement('div');
    rightGroup.className = 'toolbar-group toolbar-group--right';

    for (const [defs, group] of [[IME_BUTTON_DEFS, imeGroup], [LEFT_BUTTON_DEFS, leftGroup], [RIGHT_BUTTON_DEFS, rightGroup]]) {
      for (const def of defs) {
        const btn = document.createElement('button');
        btn.className = 'toolbar-btn';
        btn.textContent = def.label;
        btn.setAttribute('data-type', def.type);

        if (def.type === 'instant' && def.repeat) {
          // キーリピート対応ボタン（矢印キー、Backspace）
          this._addRepeatableButtonHandler(btn, def.key);
        } else if (def.type === 'instant' && def.popup) {
          // ポップアップ対応ボタン（/, -）
          this._addPopupButtonHandler(btn, def.key, def.popup);
        } else if (def.type === 'instant') {
          // 通常の即時送信ボタン（Esc, Tab）
          this._addButtonHandler(btn, (e) => {
            e.preventDefault();
            this._handleInstantKey(def.key);
          });
        } else if (def.type === 'modifier') {
          // 修飾キーボタン（Ctrl, Alt）- 長押しロック対応
          btn.setAttribute('data-modifier', def.modifier);
          this._addModifierButtonHandler(btn, def.modifier);
          this._buttons[def.modifier] = btn;
        } else if (def.type === 'keyboard-mode') {
          // キーボードモード切替ボタン（none → direct → ime → none）
          this._keyboardModeBtn = btn;
          this._addButtonHandler(btn, (e) => {
            e.preventDefault();
            this._handleKeyboardModeToggle();
          });
        }

        group.appendChild(btn);
      }
    }

    row.appendChild(imeGroup);
    row.appendChild(leftGroup);
    row.appendChild(rightGroup);
    this._container.appendChild(row);
    this._row = row;

    // > ボタン（ショートカットモードへ切り替え、右端に絶対配置）
    this._switchFwdBtn = document.createElement('button');
    this._switchFwdBtn.className = 'toolbar-switch-btn toolbar-switch-btn--fwd';
    this._switchFwdBtn.textContent = '>';
    this._addButtonHandler(this._switchFwdBtn, (e) => {
      e.preventDefault();
      this._enterShortcutMode();
    });
    this._container.appendChild(this._switchFwdBtn);

    // < ボタン（通常モードへ戻す、左端に絶対配置、初期非表示）
    this._switchBackBtn = document.createElement('button');
    this._switchBackBtn.className = 'toolbar-switch-btn toolbar-switch-btn--back';
    this._switchBackBtn.textContent = '<';
    this._addButtonHandler(this._switchBackBtn, (e) => {
      e.preventDefault();
      this._exitShortcutMode();
    });
    this._container.appendChild(this._switchBackBtn);

    // ショートカット行（初期非表示）
    this._shortcutRow = document.createElement('div');
    this._shortcutRow.className = 'toolbar-shortcut-row';
    for (const def of SHORTCUT_DEFS) {
      const btn = document.createElement('button');
      btn.className = 'toolbar-shortcut-btn';
      btn.textContent = def.label;
      this._addButtonHandler(btn, (e) => {
        e.preventDefault();
        this._onSendKey(def.key);
      });
      this._shortcutRow.appendChild(btn);
    }
    this._container.appendChild(this._shortcutRow);

    this._updateButtonStates();
  }

  /**
   * ボタンにイベントハンドラを登録する。
   * touchend で処理した場合は後続の click を抑制し、モバイルでの二重発火を防ぐ。
   * @param {HTMLButtonElement} btn
   * @param {function(Event): void} handler
   */
  _addButtonHandler(btn, handler) {
    let touchHandled = false;
    btn.addEventListener('touchend', (e) => {
      touchHandled = true;
      handler(e);
    });
    btn.addEventListener('click', (e) => {
      if (touchHandled) {
        touchHandled = false;
        return;
      }
      handler(e);
    });
  }

  /**
   * 修飾キーボタン（Ctrl/Alt）のイベントハンドラを登録する。
   * タップ: off <-> oneshot トグル
   * 長押し（400ms+）: locked 状態に遷移
   * @param {HTMLButtonElement} btn
   * @param {'ctrl' | 'alt'} modifier
   */
  _addModifierButtonHandler(btn, modifier) {
    let touchHandled = false;

    const startPress = () => {
      this._longPressTriggered = false;
      this._longPressTimer = setTimeout(() => {
        this._longPressTriggered = true;
        const stateKey = modifier === 'ctrl' ? '_ctrlState' : '_altState';
        this[stateKey] = 'locked';
        this._updateButtonStates();
      }, this._longPressThreshold);
    };

    const endPress = (e) => {
      e.preventDefault();
      if (this._longPressTimer !== null) {
        clearTimeout(this._longPressTimer);
        this._longPressTimer = null;
      }
      if (!this._longPressTriggered) {
        // 短いタップ: off <-> oneshot トグル
        this._handleModifierTap(modifier);
      }
      this._longPressTriggered = false;
    };

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      touchHandled = true;
      startPress();
    }, { passive: false });

    btn.addEventListener('touchend', (e) => {
      endPress(e);
    });

    btn.addEventListener('touchcancel', () => {
      if (this._longPressTimer !== null) {
        clearTimeout(this._longPressTimer);
        this._longPressTimer = null;
      }
      this._longPressTriggered = false;
    });

    btn.addEventListener('mousedown', (e) => {
      if (touchHandled) {
        touchHandled = false;
        return;
      }
      e.preventDefault();
      startPress();
    });

    btn.addEventListener('mouseup', (e) => {
      if (touchHandled) {
        return;
      }
      endPress(e);
    });

    btn.addEventListener('mouseleave', () => {
      if (this._longPressTimer !== null) {
        clearTimeout(this._longPressTimer);
        this._longPressTimer = null;
      }
    });
  }

  /**
   * キーリピート対応ボタン（矢印キー、Backspace）のイベントハンドラを登録する。
   * 押下: 即座に1回発火 -> 400ms後から80msごとにリピート
   * @param {HTMLButtonElement} btn
   * @param {string} key - 送信するキーシーケンス
   */
  _addRepeatableButtonHandler(btn, key) {
    let touchHandled = false;

    const startRepeat = () => {
      // 前回のリピートタイマーをクリア（二重起動防止）
      this._clearRepeat();
      // 即座に1回発火
      this._handleInstantKey(key);
      btn.classList.add('toolbar-btn--pressed');

      // 初回遅延後にリピート開始
      this._repeatTimer = setTimeout(() => {
        this._repeatInterval = setInterval(() => {
          this._handleInstantKey(key);
        }, this._repeatIntervalMs);
      }, this._repeatInitialDelay);
    };

    const stopRepeat = () => {
      this._clearRepeat();
      btn.classList.remove('toolbar-btn--pressed');
    };

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      touchHandled = true;
      startRepeat();
    }, { passive: false });

    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      stopRepeat();
    });

    btn.addEventListener('touchcancel', () => {
      stopRepeat();
    });

    btn.addEventListener('mousedown', (e) => {
      if (touchHandled) {
        touchHandled = false;
        return;
      }
      e.preventDefault();
      startRepeat();
    });

    btn.addEventListener('mouseup', () => {
      if (touchHandled) {
        return;
      }
      stopRepeat();
    });

    btn.addEventListener('mouseleave', () => {
      if (touchHandled) {
        return;
      }
      stopRepeat();
    });
  }

  /**
   * ポップアップ対応ボタン（/, -）のイベントハンドラを登録する。
   * タッチ: 押して上にスワイプするとポップアップ表示、離すとポップアップのキーを送信
   * デスクトップ: クリックで通常キーを送信（ポップアップなし）
   * @param {HTMLButtonElement} btn
   * @param {string} key - 通常の送信キー
   * @param {Object} popup - ポップアップ定義
   * @param {string} popup.label - ポップアップの表示ラベル
   * @param {string} popup.key - ポップアップで送信するキー
   */
  _addPopupButtonHandler(btn, key, popup) {
    // ポップアップ DOM 要素を生成
    const popupEl = document.createElement('span');
    popupEl.className = 'toolbar-btn-popup';
    popupEl.textContent = popup.label;
    btn.appendChild(popupEl);

    let touchHandled = false;
    let popupVisible = false;

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      touchHandled = true;
      popupVisible = false;
    }, { passive: false });

    btn.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const btnRect = btn.getBoundingClientRect();

      if (touch.clientY < btnRect.top) {
        // 指がボタンの上端より上に移動した
        if (!popupVisible) {
          popupEl.classList.add('toolbar-btn-popup--visible');
          popupVisible = true;
        }
      } else {
        // 指がボタン内に戻った
        if (popupVisible) {
          popupEl.classList.remove('toolbar-btn-popup--visible');
          popupVisible = false;
        }
      }
    }, { passive: false });

    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (popupVisible) {
        popupEl.classList.remove('toolbar-btn-popup--visible');
        popupVisible = false;
        this._handleInstantKey(popup.key);
      } else {
        this._handleInstantKey(key);
      }
    });

    btn.addEventListener('touchcancel', () => {
      popupEl.classList.remove('toolbar-btn-popup--visible');
      popupVisible = false;
    });

    // デスクトップ: クリックで通常キーを送信
    btn.addEventListener('click', (e) => {
      if (touchHandled) {
        touchHandled = false;
        return;
      }
      e.preventDefault();
      this._handleInstantKey(key);
    });
  }

  /**
   * ショートカットモードに切り替える。
   * 通常のツールバー行を非表示にし、ショートカット行を表示する。
   */
  _enterShortcutMode() {
    this._inShortcutMode = true;
    this._row.style.display = 'none';
    this._switchFwdBtn.style.display = 'none';
    this._shortcutRow.style.display = 'flex';
    this._switchBackBtn.style.display = 'flex';
  }

  /**
   * ショートカットモードから通常モードに戻す。
   */
  _exitShortcutMode() {
    this._inShortcutMode = false;
    this._shortcutRow.style.display = 'none';
    this._switchBackBtn.style.display = 'none';
    this._row.style.display = '';
    this._switchFwdBtn.style.display = '';
  }

  /**
   * キーリピートのタイマーとインターバルをクリアする。
   */
  _clearRepeat() {
    if (this._repeatTimer !== null) {
      clearTimeout(this._repeatTimer);
      this._repeatTimer = null;
    }
    if (this._repeatInterval !== null) {
      clearInterval(this._repeatInterval);
      this._repeatInterval = null;
    }
  }

  /**
   * 即時送信キー（Esc, Tab, 矢印, Backspace 等）をハンドルする。
   * 現在の修飾キー状態を適用してから送信する。
   * @param {string} key - エスケープシーケンス
   */
  _handleInstantKey(key) {
    // 修飾キーを消費してから送信
    const mods = this.consumeModifiers();
    let data = key;
    // 即時キーに Alt 修飾を適用する場合（ESC + key 形式に）
    if (mods.alt && key.length === 1) {
      data = '\x1b' + key;
    }
    this._onSendKey(data);
  }

  /**
   * 修飾キー（Ctrl/Alt）のタップをハンドルする。
   * タップ: off -> oneshot, oneshot -> off, locked -> off
   * @param {'ctrl' | 'alt'} modifier
   */
  _handleModifierTap(modifier) {
    const stateKey = modifier === 'ctrl' ? '_ctrlState' : '_altState';
    const currentState = this[stateKey];

    if (currentState === 'off') {
      this[stateKey] = 'oneshot';
    } else {
      // oneshot -> off, locked -> off
      this[stateKey] = 'off';
    }
    this._updateButtonStates();
  }

  /**
   * キーボードモードを次のモードに切り替える。
   * サイクル: none → direct → ime → none
   */
  _handleKeyboardModeToggle() {
    switch (this._keyboardMode) {
      case 'none':
        this._keyboardMode = 'direct';
        break;
      case 'direct':
        this._keyboardMode = 'ime';
        break;
      case 'ime':
        this._keyboardMode = 'none';
        break;
      default:
        this._keyboardMode = 'none';
        break;
    }

    this._updateKeyboardModeButton();

    if (this._onKeyboardMode) {
      this._onKeyboardMode(this._keyboardMode);
    }
  }

  /**
   * キーボードモードボタンの表示ラベルとスタイルを更新する。
   * - 'none': ラベル 'あ'、ハイライトなし
   * - 'direct': ラベル 'A'、oneshot スタイルハイライト
   * - 'ime': ラベル 'あ'、oneshot スタイルハイライト
   */
  _updateKeyboardModeButton() {
    if (!this._keyboardModeBtn) return;

    this._keyboardModeBtn.classList.remove('toolbar-btn--oneshot');

    switch (this._keyboardMode) {
      case 'none':
        this._keyboardModeBtn.textContent = '\u3042';
        break;
      case 'direct':
        this._keyboardModeBtn.textContent = 'A';
        this._keyboardModeBtn.classList.add('toolbar-btn--oneshot');
        break;
      case 'ime':
        this._keyboardModeBtn.textContent = '\u3042';
        this._keyboardModeBtn.classList.add('toolbar-btn--oneshot');
        break;
    }
  }

  /**
   * ボタンの視覚的状態を更新する。
   */
  _updateButtonStates() {
    if (this._buttons.ctrl) {
      this._buttons.ctrl.classList.remove('toolbar-btn--oneshot', 'toolbar-btn--locked');
      if (this._ctrlState === 'oneshot') {
        this._buttons.ctrl.classList.add('toolbar-btn--oneshot');
      } else if (this._ctrlState === 'locked') {
        this._buttons.ctrl.classList.add('toolbar-btn--locked');
      }
    }

    if (this._buttons.alt) {
      this._buttons.alt.classList.remove('toolbar-btn--oneshot', 'toolbar-btn--locked');
      if (this._altState === 'oneshot') {
        this._buttons.alt.classList.add('toolbar-btn--oneshot');
      } else if (this._altState === 'locked') {
        this._buttons.alt.classList.add('toolbar-btn--locked');
      }
    }
  }

  /**
   * 現在の修飾キー状態を返し、ワンショットモードの場合はリセットする。
   * terminal.js の onData ハンドラから呼ばれる。
   * @returns {{ ctrl: boolean, alt: boolean }}
   */
  consumeModifiers() {
    const mods = {
      ctrl: this._ctrlState !== 'off',
      alt: this._altState !== 'off',
    };

    if (this._ctrlState === 'oneshot') {
      this._ctrlState = 'off';
    }
    if (this._altState === 'oneshot') {
      this._altState = 'off';
    }

    this._updateButtonStates();
    return mods;
  }

  /**
   * ツールバーの表示/非表示をトグルする。
   */
  toggleVisibility() {
    this._visible = !this._visible;
    if (this._visible) {
      this._container.classList.remove('toolbar--hidden');
    } else {
      this._container.classList.add('toolbar--hidden');
    }
  }

  /**
   * ツールバーが現在表示されているか。
   * @returns {boolean}
   */
  get visible() {
    return this._visible;
  }

  /**
   * Ctrl の現在の状態を返す（テスト用）。
   * @returns {ModifierState}
   */
  get ctrlState() {
    return this._ctrlState;
  }

  /**
   * Alt の現在の状態を返す（テスト用）。
   * @returns {ModifierState}
   */
  get altState() {
    return this._altState;
  }

  /**
   * 現在のキーボードモードを返す。
   * @returns {'none' | 'direct' | 'ime'}
   */
  get keyboardMode() {
    return this._keyboardMode;
  }

  /**
   * Ctrl が有効（oneshot または locked）かどうかを返す。
   * @returns {boolean}
   */
  hasCtrl() {
    return this._ctrlState !== 'off';
  }

  /**
   * Alt が有効（oneshot または locked）かどうかを返す。
   * @returns {boolean}
   */
  hasAlt() {
    return this._altState !== 'off';
  }

  /**
   * 保存された状態を復元する。
   * @param {Object} state
   * @param {boolean|null} state.toolbarVisible
   * @param {'none'|'direct'|'ime'} state.keyboardMode
   * @param {ModifierState} state.ctrlState
   * @param {ModifierState} state.altState
   */
  restoreState(state) {
    // キーボードモード復元
    if (state.keyboardMode && state.keyboardMode !== 'none') {
      this._keyboardMode = state.keyboardMode;
      this._updateKeyboardModeButton();
    }
    // 修飾キー状態復元
    if (state.ctrlState) {
      this._ctrlState = state.ctrlState;
    }
    if (state.altState) {
      this._altState = state.altState;
    }
    this._updateButtonStates();
    // ツールバー表示/非表示復元
    if (state.toolbarVisible === false) {
      this._visible = false;
      this._container.classList.add('toolbar--hidden');
    }
  }

  /**
   * リソースを解放する。
   */
  dispose() {
    this._container.innerHTML = '';
    this._buttons = {};
    this._row = null;
    this._switchFwdBtn = null;
    this._switchBackBtn = null;
    this._shortcutRow = null;
    if (this._longPressTimer !== null) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
    this._clearRepeat();
  }
}
