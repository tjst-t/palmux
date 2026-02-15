// touch.js - タッチ操作ハンドラー
// スワイプでウィンドウ切り替え、ピンチズームでフォントサイズ変更、
// 垂直スクロールで tmux スクロールバック、ダブルタップズーム防止を提供する

/**
 * TouchHandler はターミナルコンテナ上のタッチジェスチャーを処理する。
 *
 * - 左右スワイプでウィンドウ切り替え（閾値: 50px）
 * - 垂直スクロールで WheelEvent を発火（tmux mouse mode 対応）
 * - ピンチズームコールバック
 */
export class TouchHandler {
  /**
   * @param {HTMLElement} container - タッチイベントを検出する DOM 要素
   * @param {Object} options
   * @param {function(): void} [options.onSwipeLeft] - 左スワイプ時のコールバック（次のウィンドウ）
   * @param {function(): void} [options.onSwipeRight] - 右スワイプ時のコールバック（前のウィンドウ）
   * @param {function(number): void} [options.onPinchZoom] - ピンチズーム時のコールバック（delta: 拡大=正, 縮小=負）
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

    /** @type {number} スワイプ検出の閾値（ピクセル） */
    this._swipeThreshold = 50;

    // バインドされたハンドラーの参照を保持（removeEventListener 用）
    this._boundOnTouchStart = this._onTouchStart.bind(this);
    this._boundOnTouchMove = this._onTouchMove.bind(this);
    this._boundOnTouchEnd = this._onTouchEnd.bind(this);

    this._bindEvents();
  }

  /**
   * イベントリスナーをコンテナに登録する。
   * touchmove のみ passive: false（preventDefault するため）。
   */
  _bindEvents() {
    this._container.addEventListener('touchstart', this._boundOnTouchStart, { passive: true });
    this._container.addEventListener('touchmove', this._boundOnTouchMove, { passive: false });
    this._container.addEventListener('touchend', this._boundOnTouchEnd, { passive: true });
  }

  /**
   * touchstart ハンドラー。
   * シングルタッチではスワイプ開始位置を記録し、
   * 2本指タッチではピンチズームの初期距離を計算する。
   * @param {TouchEvent} e
   */
  _onTouchStart(e) {
    if (e.touches.length === 1) {
      // シングルタッチ: スワイプトラッキング開始
      this._startX = e.touches[0].clientX;
      this._startY = e.touches[0].clientY;
      this._lastScrollY = this._startY;
      this._scrollAccum = 0;
      this._tracking = true;
      this._scrolling = false;
      this._pinching = false;
    } else if (e.touches.length === 2) {
      // 2本指タッチ: ピンチズームトラッキング開始
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
   * @param {TouchEvent} e
   */
  _onTouchMove(e) {
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
      } else if (this._tracking) {
        // ジェスチャー方向の判定
        if (deltaX > deltaY && deltaX > 10) {
          // 水平方向の移動: スクロールを防止してスワイプトラッキング継続
          e.preventDefault();
        } else if (deltaY > deltaX && deltaY > 10) {
          // 垂直方向の移動: スクロールモードに移行
          this._tracking = false;
          this._scrolling = true;
          this._lastScrollY = currentY;
          this._scrollAccum = 0;
          e.preventDefault();
        }
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
   * @param {TouchEvent} e
   */
  _onTouchEnd(e) {
    if (this._tracking) {
      this._tracking = false;

      if (e.changedTouches.length === 0) return;

      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const deltaX = endX - this._startX;
      const deltaY = endY - this._startY;

      // 水平移動が閾値を超え、かつ水平方向が垂直方向より大きい場合のみスワイプ発火
      if (Math.abs(deltaX) >= this._swipeThreshold && Math.abs(deltaX) > Math.abs(deltaY)) {
        if (deltaX < 0 && this._options.onSwipeLeft) {
          // 左スワイプ: 次のウィンドウ
          this._options.onSwipeLeft();
        } else if (deltaX > 0 && this._options.onSwipeRight) {
          // 右スワイプ: 前のウィンドウ
          this._options.onSwipeRight();
        }
      }
    }

    if (this._scrolling) {
      this._scrolling = false;
    }

    // ピンチ状態をリセット（指が離れた場合）
    if (this._pinching && e.touches.length < 2) {
      this._pinching = false;
    }
  }

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
   * スワイプ検出の閾値を設定する（テスト用）。
   * @param {number} threshold - ピクセル数
   */
  setSwipeThreshold(threshold) {
    this._swipeThreshold = threshold;
  }

  /**
   * イベントリスナーを削除し、リソースを解放する。
   */
  destroy() {
    this._container.removeEventListener('touchstart', this._boundOnTouchStart);
    this._container.removeEventListener('touchmove', this._boundOnTouchMove);
    this._container.removeEventListener('touchend', this._boundOnTouchEnd);
    this._tracking = false;
    this._scrolling = false;
    this._pinching = false;
  }
}
