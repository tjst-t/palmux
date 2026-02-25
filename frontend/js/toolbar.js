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
  { label: '^Y', key: '\x19' },
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
   * @param {function(string): Promise<{commands: Array}>} [options.onFetchCommands] - コマンド取得コールバック
   */
  constructor(container, options) {
    this._container = container;
    this._onSendKey = options.onSendKey;
    this._onKeyboardMode = options.onKeyboardMode || null;
    this._onFetchCommands = options.onFetchCommands || null;

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

    /** @type {'normal' | 'shortcut' | 'commands'} ツールバーモード */
    this._mode = 'normal';

    /** @type {string|null} 現在のセッション名 */
    this._currentSession = null;

    /** @type {{session: string, commands: Array, timestamp: number}|null} コマンドキャッシュ */
    this._commandsCache = null;

    /** @type {number} キャッシュ有効期間（ミリ秒） */
    this._commandsCacheTTL = 30000;

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

    /** @type {boolean} 横スワイプジェスチャ検出中かどうか */
    this._swipeDetected = false;

    /** @type {'left' | 'right' | null} 検出したスワイプ方向 */
    this._swipeDirection = null;

    /**
     * スワイプ検出時に呼ぶキャンセルコールバック。
     * リピートボタンの touchstart で登録し、touchend/cancel でクリアする。
     * @type {function|null}
     */
    this._cancelRepeatTouch = null;

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

    // > ボタン（右端に絶対配置）
    // normal → shortcut / commands → normal
    this._switchFwdBtn = document.createElement('button');
    this._switchFwdBtn.className = 'toolbar-switch-btn toolbar-switch-btn--fwd';
    this._switchFwdBtn.textContent = '>';
    this._addButtonHandler(this._switchFwdBtn, (e) => {
      e.preventDefault();
      if (this._mode === 'normal') {
        this._setMode('shortcut');
      } else if (this._mode === 'commands') {
        this._setMode('normal');
      }
    });
    this._container.appendChild(this._switchFwdBtn);

    // < ボタン（左端に絶対配置）
    // normal → commands / shortcut → normal
    this._switchBackBtn = document.createElement('button');
    this._switchBackBtn.className = 'toolbar-switch-btn toolbar-switch-btn--back';
    this._switchBackBtn.textContent = '<';
    this._addButtonHandler(this._switchBackBtn, (e) => {
      e.preventDefault();
      if (this._mode === 'normal') {
        this._setMode('commands');
      } else {
        this._setMode('normal');
      }
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

    // コマンド行（初期非表示）
    this._commandsRow = document.createElement('div');
    this._commandsRow.className = 'toolbar-commands-row';
    this._container.appendChild(this._commandsRow);

    this._updateButtonStates();
    // 通常モードでは < ボタンも表示（commands へのアクセス用）
    this._switchBackBtn.style.display = 'flex';

    this._addSwipeGesture();
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
      if (this._swipeDetected) return;
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
      if (this._swipeDetected) {
        this._longPressTriggered = false;
        return;
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
   *
   * タッチ: touchstart から 50ms 遅延して初回発火 → 400ms 後からリピート。
   *   50ms 以内にスワイプ検出された場合は発火をキャンセルする。
   *   50ms 以内に離した場合（クイックタップ）は touchend 時に補完発火する。
   * マウス: 即座に1回発火 → 400ms 後からリピート（変更なし）。
   *
   * @param {HTMLButtonElement} btn
   * @param {string} key - 送信するキーシーケンス
   */
  _addRepeatableButtonHandler(btn, key) {
    let touchHandled = false;
    /** @type {number|null} タッチ用: 初回発火の遅延タイマー */
    let initialFireTimer = null;
    /** 初回キーが発火済みかどうか */
    let hasFired = false;

    const fireAndScheduleRepeat = () => {
      hasFired = true;
      this._handleInstantKey(key);
      this._repeatTimer = setTimeout(() => {
        this._repeatInterval = setInterval(() => {
          this._handleInstantKey(key);
        }, this._repeatIntervalMs);
      }, this._repeatInitialDelay);
    };

    /**
     * タッチ用: 50ms 後に初回発火。スワイプ検出猶予を確保する。
     */
    const startRepeatTouch = () => {
      this._clearRepeat();
      hasFired = false;
      btn.classList.add('toolbar-btn--pressed');
      initialFireTimer = setTimeout(() => {
        initialFireTimer = null;
        fireAndScheduleRepeat();
      }, 50);
    };

    /**
     * マウス用: 即座に初回発火（遅延なし）。
     */
    const startRepeatMouse = () => {
      this._clearRepeat();
      hasFired = false;
      btn.classList.add('toolbar-btn--pressed');
      fireAndScheduleRepeat();
    };

    /**
     * @param {boolean} wasSwiping - スワイプ検出済みなら true。クイックタップ補完を抑制する。
     */
    const stopRepeat = (wasSwiping = false) => {
      if (initialFireTimer !== null) {
        clearTimeout(initialFireTimer);
        initialFireTimer = null;
        // クイックタップ（50ms 未満で離し、スワイプでもない）: touchend で補完発火
        if (!wasSwiping && !hasFired) {
          this._handleInstantKey(key);
        }
      }
      this._clearRepeat();
      btn.classList.remove('toolbar-btn--pressed');
      hasFired = false;
    };

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      touchHandled = true;
      startRepeatTouch();
      // スワイプ検出時に呼ばれるキャンセルコールバックを登録する
      this._cancelRepeatTouch = () => stopRepeat(true);
    }, { passive: false });

    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      this._cancelRepeatTouch = null;
      stopRepeat(this._swipeDetected);
    });

    btn.addEventListener('touchcancel', () => {
      this._cancelRepeatTouch = null;
      stopRepeat(true); // キャンセルはスワイプと同様: キー発火しない
    });

    btn.addEventListener('mousedown', (e) => {
      if (touchHandled) {
        touchHandled = false;
        return;
      }
      e.preventDefault();
      startRepeatMouse();
    });

    btn.addEventListener('mouseup', () => {
      if (touchHandled) {
        return;
      }
      stopRepeat(false);
    });

    btn.addEventListener('mouseleave', () => {
      if (touchHandled) {
        return;
      }
      stopRepeat(false);
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
      if (this._swipeDetected) {
        popupEl.classList.remove('toolbar-btn-popup--visible');
        popupVisible = false;
        return;
      }
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
   * ツールバー全体に横スワイプジェスチャを登録する。
   * - 左スワイプ: normal → shortcut / commands → normal
   * - 右スワイプ: normal → commands / shortcut → normal
   *
   * touchmove で `_swipeDetected` フラグを立て、各ボタンハンドラが
   * スワイプ中に誤発火しないよう制御する。
   */
  _addSwipeGesture() {
    let startX = 0;
    let startY = 0;
    /** @type {boolean|null} 最初の動きで水平/垂直を確定するフラグ */
    let isHorizontal = null;

    const SWIPE_THRESHOLD = 50;
    const DIRECTION_RATIO = 1.5;
    /** ゴムバンド効果が始まる水平移動量（px） */
    const SOFT_LIMIT = 40;
    /** 追従の最大移動量（px） */
    const MAX_DRAG = 80;

    /** 現在表示中のコンテンツ行を返す */
    const getActiveRow = () => {
      if (this._mode === 'normal') return this._row;
      if (this._mode === 'shortcut') return this._shortcutRow;
      return this._commandsRow;
    };

    /** 現在のモードで左スワイプが有効か */
    const canSwipeLeft = () => this._mode === 'normal' || this._mode === 'commands';
    /** 現在のモードで右スワイプが有効か */
    const canSwipeRight = () => this._mode === 'normal' || this._mode === 'shortcut';

    /**
     * ドラッグ中、指に追従して行を動かす。
     * SOFT_LIMIT を超えた分は 30% の摩擦を加えたゴムバンド効果にする。
     * 有効なスワイプ方向がないときは移動量をゼロにする。
     */
    const applyDrag = (el, dx) => {
      let limited = dx;
      if (dx < 0 && !canSwipeLeft()) limited = 0;
      if (dx > 0 && !canSwipeRight()) limited = 0;
      if (Math.abs(limited) > SOFT_LIMIT) {
        const excess = Math.abs(limited) - SOFT_LIMIT;
        limited = Math.sign(limited) * (SOFT_LIMIT + excess * 0.3);
      }
      limited = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, limited));
      const opacity = Math.max(0.5, 1 - Math.abs(limited) / (MAX_DRAG * 1.5));
      el.style.transition = 'none';
      el.style.transform = `translateX(${limited}px)`;
      el.style.opacity = String(opacity);
    };

    /**
     * スワイプ未達のとき、ばね感のあるカーブで元の位置に戻す。
     */
    const snapBack = (el) => {
      el.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease';
      el.style.transform = '';
      el.style.opacity = '';
      el.addEventListener('transitionend', () => {
        el.style.transition = '';
      }, { once: true });
    };

    /**
     * しきい値超え時: 現在の行をスワイプ方向へスライドアウトし、callback を呼ぶ。
     * @param {HTMLElement} el
     * @param {'left' | 'right'} direction
     * @param {function} callback
     */
    const slideOut = (el, direction, callback) => {
      const toX = direction === 'left' ? -(SOFT_LIMIT * 2) : (SOFT_LIMIT * 2);
      el.style.transition = 'transform 0.15s ease-in, opacity 0.15s ease-in';
      el.style.transform = `translateX(${toX}px)`;
      el.style.opacity = '0';
      setTimeout(() => {
        el.style.transition = '';
        el.style.transform = '';
        el.style.opacity = '';
        callback();
      }, 160);
    };

    /**
     * モード切替後: 新しい行を反対側からスライドインさせる。
     * @param {HTMLElement} el
     * @param {'left' | 'right'} fromSide - 新コンテンツが出てくる側
     */
    const slideIn = (el, fromSide) => {
      const fromX = fromSide === 'right' ? 40 : -40;
      el.style.transition = 'none';
      el.style.transform = `translateX(${fromX}px)`;
      el.style.opacity = '0';
      void el.offsetWidth; // reflow して transition を有効化
      el.style.transition = 'transform 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.2s ease-out';
      el.style.transform = '';
      el.style.opacity = '';
      el.addEventListener('transitionend', () => {
        el.style.transition = '';
      }, { once: true });
    };

    this._container.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      this._swipeDetected = false;
      this._swipeDirection = null;
      isHorizontal = null;
    }, { passive: true });

    this._container.addEventListener('touchmove', (e) => {
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      // 最初の動きで水平/垂直スワイプかを確定する
      if (isHorizontal === null) {
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
          isHorizontal = Math.abs(dx) >= Math.abs(dy);
          // 水平スワイプと確定した瞬間にリピートタイマーをキャンセルする。
          // 50px の _swipeDetected 判定より早く（約 20ms）キャンセルできるため
          // タイマー（50ms）が発火する前に抑止できる。
          if (isHorizontal && this._cancelRepeatTouch) {
            this._cancelRepeatTouch();
            this._cancelRepeatTouch = null;
          }
        }
        return;
      }
      if (!isHorizontal) return;

      applyDrag(getActiveRow(), dx);

      if (!this._swipeDetected && Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) >= Math.abs(dy) * DIRECTION_RATIO) {
        this._swipeDetected = true;
        this._swipeDirection = dx < 0 ? 'left' : 'right';
        // リピートボタン上でスワイプが確定したら即座にタイマーをキャンセルする
        if (this._cancelRepeatTouch) {
          this._cancelRepeatTouch();
          this._cancelRepeatTouch = null;
        }
      }
    }, { passive: true });

    this._container.addEventListener('touchend', () => {
      const activeRow = getActiveRow();

      if (!this._swipeDetected) {
        snapBack(activeRow);
        this._swipeDirection = null;
        return;
      }

      const dir = this._swipeDirection;
      this._swipeDetected = false;
      this._swipeDirection = null;

      let targetMode = null;
      if (dir === 'left') {
        if (this._mode === 'normal') targetMode = 'shortcut';
        else if (this._mode === 'commands') targetMode = 'normal';
      } else {
        if (this._mode === 'normal') targetMode = 'commands';
        else if (this._mode === 'shortcut') targetMode = 'normal';
      }

      if (!targetMode) {
        snapBack(activeRow);
        return;
      }

      slideOut(activeRow, dir, () => {
        this._setMode(targetMode);
        // 新コンテンツは現在の行（_setMode 後に getActiveRow() が返す）
        slideIn(getActiveRow(), dir === 'left' ? 'right' : 'left');
      });
    }, { passive: true });

    this._container.addEventListener('touchcancel', () => {
      snapBack(getActiveRow());
      this._swipeDetected = false;
      this._swipeDirection = null;
      isHorizontal = null;
    }, { passive: true });
  }

  /**
   * ツールバーのモードを設定する。
   *
   * モード遷移:
   *   < ボタン: normal → commands（左側）、shortcut → normal
   *   > ボタン: normal → shortcut（右側）、commands → normal
   *
   * @param {'normal' | 'shortcut' | 'commands'} mode
   */
  _setMode(mode) {
    this._mode = mode;

    // 全行・ボタンを一旦非表示
    this._row.style.display = 'none';
    this._shortcutRow.style.display = 'none';
    this._commandsRow.style.display = 'none';
    this._switchFwdBtn.style.display = 'none';
    this._switchBackBtn.style.display = 'none';

    if (mode === 'normal') {
      // 通常: メイン行 + 両方のモード切替ボタンを表示
      this._row.style.display = '';
      this._switchFwdBtn.style.display = '';   // > → shortcut
      this._switchBackBtn.style.display = 'flex'; // < → commands
    } else if (mode === 'shortcut') {
      // ショートカット: ショートカット行 + < (戻る) のみ
      this._shortcutRow.style.display = 'flex';
      this._switchBackBtn.style.display = 'flex'; // < → normal
    } else if (mode === 'commands') {
      // コマンド: コマンド行 + > (戻る) のみ
      this._commandsRow.style.display = 'flex';
      this._switchFwdBtn.style.display = '';   // > → normal
      this._loadCommands();
    }
  }

  /**
   * コマンドを読み込んでボタンを動的生成する。
   */
  _loadCommands() {
    if (!this._onFetchCommands || !this._currentSession) {
      this._commandsRow.innerHTML = '<span class="toolbar-commands-empty">No session</span>';
      return;
    }

    // キャッシュが有効ならそれを使う
    if (this._commandsCache &&
        this._commandsCache.session === this._currentSession &&
        Date.now() - this._commandsCache.timestamp < this._commandsCacheTTL) {
      this._renderCommandButtons(this._commandsCache.commands);
      return;
    }

    this._commandsRow.innerHTML = '<span class="toolbar-commands-loading">Loading...</span>';

    this._onFetchCommands(this._currentSession)
      .then((result) => {
        const commands = result.commands || [];
        this._commandsCache = {
          session: this._currentSession,
          commands,
          timestamp: Date.now(),
        };
        // まだ commands モードなら描画
        if (this._mode === 'commands') {
          this._renderCommandButtons(commands);
        }
      })
      .catch(() => {
        if (this._mode === 'commands') {
          this._commandsRow.innerHTML = '<span class="toolbar-commands-empty">Error loading commands</span>';
        }
      });
  }

  /**
   * コマンドボタンを描画する。
   * @param {Array<{label: string, command: string, source: string}>} commands
   */
  _renderCommandButtons(commands) {
    this._commandsRow.innerHTML = '';
    if (commands.length === 0) {
      this._commandsRow.innerHTML = '<span class="toolbar-commands-empty">No commands found</span>';
      return;
    }

    for (const cmd of commands) {
      const btn = document.createElement('button');
      btn.className = 'toolbar-command-btn';
      btn.textContent = cmd.label;
      btn.title = cmd.command.replace('\r', '');
      this._addTapButtonHandler(btn, (e) => {
        e.preventDefault();
        this._onSendKey(cmd.command);
      });
      this._commandsRow.appendChild(btn);
    }
  }

  /**
   * スワイプと区別するタップ専用ハンドラ。
   * touchstart で位置を記録し、touchend で移動量が閾値を超えていれば無視する。
   * これにより横スクロール中にボタンが誤発火しない。
   * @param {HTMLButtonElement} btn
   * @param {function(Event): void} handler
   */
  _addTapButtonHandler(btn, handler) {
    const TAP_THRESHOLD = 8;
    let startX = 0;
    let startY = 0;
    let touchHandled = false;

    btn.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      touchHandled = false;
    }, { passive: true });

    btn.addEventListener('touchend', (e) => {
      const dx = Math.abs(e.changedTouches[0].clientX - startX);
      const dy = Math.abs(e.changedTouches[0].clientY - startY);
      touchHandled = true;
      if (dx > TAP_THRESHOLD || dy > TAP_THRESHOLD) {
        // スワイプ操作 → コマンド実行しない
        return;
      }
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
   * 現在のセッション名を設定する。
   * セッションが変わった場合キャッシュをクリアする。
   * @param {string} session
   */
  setCurrentSession(session) {
    if (this._currentSession !== session) {
      this._currentSession = session;
      this._commandsCache = null;
    }
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
    this._commandsRow = null;
    this._commandsCache = null;
    if (this._longPressTimer !== null) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
    if (this._cancelRepeatTouch) {
      this._cancelRepeatTouch();
      this._cancelRepeatTouch = null;
    }
    this._clearRepeat();
  }
}
