// toolbar.js - 修飾キーツールバー（ワンショット/ロックモード対応）

/**
 * 修飾キーの状態
 * @typedef {'off' | 'oneshot' | 'locked'} ModifierState
 */

/**
 * ボタン定義
 * @typedef {Object} ButtonDef
 * @property {string} label - 表示ラベル
 * @property {string} type - 'instant' | 'modifier' | 'toggle'
 * @property {string} [key] - 送信するキーシーケンス（instant の場合）
 * @property {string} [modifier] - 修飾キー名（modifier の場合: 'ctrl' | 'alt'）
 * @property {string} [action] - トグルアクション名（toggle の場合: 'ime'）
 */

/** @type {ButtonDef[]} */
const BUTTON_DEFS = [
  { label: 'Esc',  type: 'instant',  key: '\x1b' },
  { label: 'Tab',  type: 'instant',  key: '\t' },
  { label: 'Ctrl', type: 'modifier', modifier: 'ctrl' },
  { label: 'Alt',  type: 'modifier', modifier: 'alt' },
  { label: '\u2191',    type: 'instant',  key: '\x1b[A' },
  { label: '\u2193',    type: 'instant',  key: '\x1b[B' },
  { label: '\u2190',    type: 'instant',  key: '\x1b[D' },
  { label: '\u2192',    type: 'instant',  key: '\x1b[C' },
  { label: 'PgUp', type: 'instant',  key: '\x1b[5~' },
  { label: 'PgDn', type: 'instant',  key: '\x1b[6~' },
  { label: '\u3042',    type: 'toggle',   action: 'ime' },
];

/**
 * Toolbar は修飾キーツールバーコンポーネント。
 * ワンショット（タップ1回）とロック（ダブルタップ）の2モードに対応する。
 */
export class Toolbar {
  /**
   * @param {HTMLElement} container - ツールバーをマウントする DOM 要素
   * @param {Object} options
   * @param {function(string): void} options.onSendKey - キーシーケンスを送信するコールバック
   * @param {function(): void} [options.onToggleIME] - IME トグルのコールバック
   */
  constructor(container, options) {
    this._container = container;
    this._onSendKey = options.onSendKey;
    this._onToggleIME = options.onToggleIME || null;

    /** @type {ModifierState} */
    this._ctrlState = 'off';
    /** @type {ModifierState} */
    this._altState = 'off';

    /** @type {boolean} */
    this._visible = true;

    /** @type {Object<string, HTMLButtonElement>} */
    this._buttons = {};

    /** @type {Object<string, number|null>} ダブルタップ検出用タイマー */
    this._tapTimers = { ctrl: null, alt: null };

    /** @type {number} ダブルタップ判定の閾値（ミリ秒） */
    this._doubleTapThreshold = 300;

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

    for (const def of BUTTON_DEFS) {
      const btn = document.createElement('button');
      btn.className = 'toolbar-btn';
      btn.textContent = def.label;
      btn.setAttribute('data-type', def.type);

      if (def.type === 'instant') {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this._handleInstantKey(def.key);
        });
        // タッチでの遅延を防ぐ
        btn.addEventListener('touchend', (e) => {
          e.preventDefault();
          this._handleInstantKey(def.key);
        });
      } else if (def.type === 'modifier') {
        btn.setAttribute('data-modifier', def.modifier);
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this._handleModifierTap(def.modifier);
        });
        btn.addEventListener('touchend', (e) => {
          e.preventDefault();
          this._handleModifierTap(def.modifier);
        });
        this._buttons[def.modifier] = btn;
      } else if (def.type === 'toggle') {
        btn.setAttribute('data-action', def.action);
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this._handleToggle(def.action);
        });
        btn.addEventListener('touchend', (e) => {
          e.preventDefault();
          this._handleToggle(def.action);
        });
      }

      row.appendChild(btn);
    }

    this._container.appendChild(row);
    this._updateButtonStates();
  }

  /**
   * 即時送信キー（Esc, Tab, 矢印, PgUp/PgDn）をハンドルする。
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
   * シングルタップ: off -> oneshot, oneshot -> off, locked -> off
   * ダブルタップ: off/oneshot -> locked
   * @param {'ctrl' | 'alt'} modifier
   */
  _handleModifierTap(modifier) {
    const stateKey = modifier === 'ctrl' ? '_ctrlState' : '_altState';
    const currentState = this[stateKey];

    // ダブルタップ検出
    if (this._tapTimers[modifier] !== null) {
      // ダブルタップ: ロックモードに
      clearTimeout(this._tapTimers[modifier]);
      this._tapTimers[modifier] = null;
      this[stateKey] = 'locked';
      this._updateButtonStates();
      return;
    }

    // シングルタップ: 遷移をスケジュール
    if (currentState === 'off') {
      // off -> oneshot（ただしダブルタップの可能性があるので少し待つ）
      this[stateKey] = 'oneshot';
      this._updateButtonStates();
      this._tapTimers[modifier] = setTimeout(() => {
        this._tapTimers[modifier] = null;
        // タイマー消費時は既に oneshot になっているのでそのまま
      }, this._doubleTapThreshold);
    } else if (currentState === 'oneshot') {
      // oneshot -> off
      this[stateKey] = 'off';
      this._updateButtonStates();
      // ダブルタップ検出のためタイマーセット
      this._tapTimers[modifier] = setTimeout(() => {
        this._tapTimers[modifier] = null;
      }, this._doubleTapThreshold);
    } else if (currentState === 'locked') {
      // locked -> off
      this[stateKey] = 'off';
      this._updateButtonStates();
    }
  }

  /**
   * トグルボタン（IME）をハンドルする。
   * @param {string} action
   */
  _handleToggle(action) {
    if (action === 'ime' && this._onToggleIME) {
      this._onToggleIME();
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
   * リソースを解放する。
   */
  dispose() {
    this._container.innerHTML = '';
    this._buttons = {};
    if (this._tapTimers.ctrl !== null) {
      clearTimeout(this._tapTimers.ctrl);
    }
    if (this._tapTimers.alt !== null) {
      clearTimeout(this._tapTimers.alt);
    }
  }
}
