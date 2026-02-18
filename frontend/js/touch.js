// touch.js - タッチ操作ハンドラー
// ピンチズームでフォントサイズ変更、
// 垂直スクロールで tmux スクロールバック、長押しでテキスト選択を提供する

/**
 * TouchHandler はターミナルコンテナ上のタッチジェスチャーを処理する。
 *
 * - 垂直スクロールで WheelEvent を発火（tmux mouse mode 対応）
 * - ピンチズームコールバック
 * - 長押しでテキスト選択
 */
export class TouchHandler {
  /**
   * @param {HTMLElement} container - タッチイベントを検出する DOM 要素
   * @param {Object} options
   * @param {function(number): void} [options.onPinchZoom] - ピンチズーム時のコールバック（delta: 拡大=正, 縮小=負）
   * @param {import('./terminal.js').PalmuxTerminal|null} [options.terminal] - テキスト選択用のターミナルインスタンス
   */
  constructor(container, options) {
    this._container = container;
    this._options = options || {};

    // シングルタッチ（スワイプ）のトラッキング状態
    this._startX = 0;
    this._startY = 0;
    this._tracking = false;

    // 垂直スクロールのトラッキング状態
    this._scrolling = false;
    this._lastScrollY = 0;
    /** @type {number} スクロールイベント発火の累積閾値（ピクセル） */
    this._scrollStep = 30;
    this._scrollAccum = 0;

    // ピンチズームのトラッキング状態
    this._pinchStartDistance = 0;
    this._pinching = false;

    // 長押し選択の状態
    /** @type {number|null} */
    this._longPressTimer = null;
    this._selecting = false;
    this._selectionStartRow = 0;
    this._selectionWordStart = 0;
    this._selectionWordEnd = 0;

    // バインドされたハンドラーの参照を保持（removeEventListener 用）
    this._boundOnTouchStart = this._onTouchStart.bind(this);
    this._boundOnTouchMove = this._onTouchMove.bind(this);
    this._boundOnTouchEnd = this._onTouchEnd.bind(this);

    this._bindEvents();
  }

  /**
   * イベントリスナーをコンテナに登録する。
   * touchstart は passive: false（長押し選択中に preventDefault するため）。
   * touchmove も passive: false（preventDefault するため）。
   */
  _bindEvents() {
    this._container.addEventListener('touchstart', this._boundOnTouchStart, { passive: false });
    this._container.addEventListener('touchmove', this._boundOnTouchMove, { passive: false });
    this._container.addEventListener('touchend', this._boundOnTouchEnd, { passive: true });
  }

  /**
   * touchstart ハンドラー。
   * シングルタッチではスワイプ開始位置を記録し長押しタイマーを起動、
   * 2本指タッチではピンチズームの初期距離を計算する。
   * @param {TouchEvent} e
   */
  _onTouchStart(e) {
    // 選択中に新たにタッチした場合は選択モードを解除
    if (this._selecting) {
      this._selecting = false;
    }

    if (e.touches.length === 1) {
      // シングルタッチ: スワイプトラッキング開始
      this._startX = e.touches[0].clientX;
      this._startY = e.touches[0].clientY;
      this._lastScrollY = this._startY;
      this._scrollAccum = 0;
      this._tracking = true;
      this._scrolling = false;
      this._pinching = false;

      // 長押しタイマー起動
      this._cancelLongPress();
      this._longPressTimer = setTimeout(() => {
        this._longPressTimer = null;
        this._onLongPress(this._startX, this._startY);
      }, 500);
    } else if (e.touches.length === 2) {
      // 2本指タッチ: ピンチズームトラッキング開始
      this._cancelLongPress();
      this._tracking = false;
      this._scrolling = false;
      this._pinching = true;
      this._pinchStartDistance = this._getTouchDistance(e.touches[0], e.touches[1]);
    }
  }

  /**
   * touchmove ハンドラー。
   * 水平方向のスワイプ中は preventDefault でスクロールを防止する。
   * 垂直方向の移動が大きい場合はスクロールモードに移行し、WheelEvent を発火する。
   * ピンチズーム中は距離の変化をコールバックに伝える。
   * 選択モード中はドラッグで選択範囲を拡張する。
   * @param {TouchEvent} e
   */
  _onTouchMove(e) {
    // 長押しタイマー中に移動したらキャンセル
    if (this._longPressTimer && e.touches.length === 1) {
      const deltaX = Math.abs(e.touches[0].clientX - this._startX);
      const deltaY = Math.abs(e.touches[0].clientY - this._startY);
      if (deltaX > 10 || deltaY > 10) {
        this._cancelLongPress();
      }
    }

    // 選択モード中: ドラッグで選択範囲を拡張
    if (this._selecting && e.touches.length === 1) {
      e.preventDefault();
      this._updateSelection(e.touches[0].clientX, e.touches[0].clientY);
      return;
    }

    if ((this._tracking || this._scrolling) && e.touches.length === 1) {
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const deltaX = Math.abs(currentX - this._startX);
      const deltaY = Math.abs(currentY - this._startY);

      if (this._scrolling) {
        // スクロールモード中: 垂直移動を WheelEvent に変換
        e.preventDefault();
        const scrollDelta = this._lastScrollY - currentY;
        this._scrollAccum += scrollDelta;
        this._lastScrollY = currentY;

        // 累積が閾値を超えたら WheelEvent を発火
        while (Math.abs(this._scrollAccum) >= this._scrollStep) {
          const direction = this._scrollAccum > 0 ? 1 : -1;
          this._dispatchWheelEvent(currentX, currentY, direction * 120);
          this._scrollAccum -= direction * this._scrollStep;
        }
      } else if (this._tracking && deltaY > deltaX && deltaY > 10) {
        // 垂直方向の移動: スクロールモードに移行
        this._tracking = false;
        this._scrolling = true;
        this._lastScrollY = currentY;
        this._scrollAccum = 0;
        e.preventDefault();
      }
    } else if (this._pinching && e.touches.length === 2) {
      // ピンチズーム
      const currentDistance = this._getTouchDistance(e.touches[0], e.touches[1]);
      const delta = currentDistance - this._pinchStartDistance;

      if (this._options.onPinchZoom && Math.abs(delta) > 10) {
        this._options.onPinchZoom(delta);
        this._pinchStartDistance = currentDistance;
      }

      e.preventDefault();
    }
  }

  /**
   * touchend ハンドラー。
   * スワイプの水平移動量が閾値を超え、かつ水平移動 > 垂直移動の場合にコールバックを呼ぶ。
   * 選択モード中の touchend は finishSelection で処理される（_onTouchStart で確定）。
   * @param {TouchEvent} e
   */
  _onTouchEnd(e) {
    this._cancelLongPress();

    if (this._tracking) {
      this._tracking = false;
    }

    if (this._scrolling) {
      this._scrolling = false;
    }

    // ピンチ状態をリセット（指が離れた場合）
    if (this._pinching && e.touches.length < 2) {
      this._pinching = false;
    }
  }

  // --- 長押しテキスト選択 ---

  /**
   * 長押しタイマーをキャンセルする。
   */
  _cancelLongPress() {
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  }

  /**
   * 長押し検出時の処理。タッチ位置の単語を選択し、選択モードに入る。
   * @param {number} clientX
   * @param {number} clientY
   */
  _onLongPress(clientX, clientY) {
    const terminal = this._options.terminal;
    if (!terminal) return;

    const cell = terminal.getCellFromPoint(clientX, clientY);
    if (!cell) return;

    const lineText = terminal.getLineText(cell.row);
    const { start, end } = this._findWordBoundaries(lineText, cell.col);

    if (end <= start) return;

    terminal.select(start, cell.row, end - start);
    this._selectionStartRow = cell.row;
    this._selectionWordStart = start;
    this._selectionWordEnd = end;

    this._tracking = false;
    this._scrolling = false;
    this._selecting = true;

    // 触覚フィードバック
    if (navigator.vibrate) {
      navigator.vibrate(30);
    }
  }

  /**
   * 選択モード中のドラッグ: 選択範囲を拡張する。
   * @param {number} clientX
   * @param {number} clientY
   */
  _updateSelection(clientX, clientY) {
    const terminal = this._options.terminal;
    if (!terminal) return;

    const cell = terminal.getCellFromPoint(clientX, clientY);
    if (!cell) return;

    const cols = terminal.getCols();

    if (cell.row === this._selectionStartRow) {
      // 同一行: 単語の開始/終了と現在位置の広い方を選択
      const startCol = Math.min(this._selectionWordStart, cell.col);
      const endCol = Math.max(this._selectionWordEnd, cell.col + 1);
      terminal.select(startCol, this._selectionStartRow, endCol - startCol);
    } else if (cell.row > this._selectionStartRow) {
      // 下方向にドラッグ
      const length = (cell.row - this._selectionStartRow) * cols
        + cell.col + 1 - this._selectionWordStart;
      terminal.select(this._selectionWordStart, this._selectionStartRow, length);
    } else {
      // 上方向にドラッグ
      const length = (this._selectionStartRow - cell.row) * cols
        + this._selectionWordEnd - cell.col;
      terminal.select(cell.col, cell.row, length);
    }
  }

  /**
   * テキスト中の指定位置にある単語の境界を返す。
   * 非空白文字の連続を「単語」として扱う。
   * @param {string} text - 行テキスト
   * @param {number} col - カーソル位置（列）
   * @returns {{ start: number, end: number }}
   */
  _findWordBoundaries(text, col) {
    if (!text || text.length === 0) return { start: 0, end: 0 };
    if (col >= text.length) col = text.length - 1;
    if (col < 0) col = 0;

    const isWordChar = (c) => /\S/.test(c);
    const charAtCol = text[col];
    const test = isWordChar(charAtCol) ? isWordChar : (c) => !isWordChar(c);

    let start = col;
    while (start > 0 && test(text[start - 1])) start--;
    let end = col + 1;
    while (end < text.length && test(text[end])) end++;

    return { start, end };
  }

  // --- 既存ユーティリティ ---

  /**
   * WheelEvent を xterm.js のビューポート要素に発火する。
   * xterm.js が現在のマウスモードに応じて適切なエスケープシーケンスを送信する。
   * @param {number} clientX - タッチ位置 X
   * @param {number} clientY - タッチ位置 Y
   * @param {number} deltaY - スクロール量（正=下, 負=上）
   */
  _dispatchWheelEvent(clientX, clientY, deltaY) {
    // xterm.js のビューポート要素を取得
    const viewport = this._container.querySelector('.xterm-viewport');
    const target = viewport || this._container;

    const wheelEvent = new WheelEvent('wheel', {
      deltaY: deltaY,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      clientX: clientX,
      clientY: clientY,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(wheelEvent);
  }

  /**
   * 2つのタッチポイント間の距離を計算する。
   * @param {Touch} touch1
   * @param {Touch} touch2
   * @returns {number} 距離（ピクセル）
   */
  _getTouchDistance(touch1, touch2) {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * イベントリスナーを削除し、リソースを解放する。
   */
  destroy() {
    this._cancelLongPress();
    this._container.removeEventListener('touchstart', this._boundOnTouchStart);
    this._container.removeEventListener('touchmove', this._boundOnTouchMove);
    this._container.removeEventListener('touchend', this._boundOnTouchEnd);
    this._tracking = false;
    this._scrolling = false;
    this._pinching = false;
    this._selecting = false;
  }
}
