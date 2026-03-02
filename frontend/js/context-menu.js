// context-menu.js - 共通コンテキストメニューコンポーネント
// ロングプレス/右クリック検出 + メニュー表示を統一

/**
 * 要素にロングプレス + 右クリック検出を設定する。
 * 全画面のコンテキストメニューパターンを共通化。
 *
 * @param {HTMLElement} element - 対象要素
 * @param {Object} options
 * @param {number} [options.delay=500] - ロングプレスの閾値 (ms)
 * @param {function({x: number, y: number, isMobile: boolean}): void} options.onTrigger - トリガー時コールバック
 * @returns {{ detach: function, wasLongPress: function(): boolean }}
 */
export function attachContextMenu(element, { delay = 500, onTrigger }) {
  let timer = null;
  let startPos = null;
  let longPressed = false;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const onTouchStart = (e) => {
    const touch = e.touches[0];
    startPos = { x: touch.clientX, y: touch.clientY };
    longPressed = false;
    timer = setTimeout(() => {
      longPressed = true;
      timer = null;
      onTrigger({ x: startPos.x, y: startPos.y, isMobile: true });
    }, delay);
  };

  const onTouchMove = (e) => {
    if (timer !== null) {
      const touch = e.touches[0];
      if (Math.abs(touch.clientX - startPos.x) > 10 || Math.abs(touch.clientY - startPos.y) > 10) {
        clearTimer();
      }
    }
  };

  const onTouchEnd = () => {
    clearTimer();
  };

  const onContextMenuEvent = (e) => {
    e.preventDefault();
    onTrigger({ x: e.clientX, y: e.clientY, isMobile: false });
  };

  element.addEventListener('touchstart', onTouchStart, { passive: true });
  element.addEventListener('touchmove', onTouchMove, { passive: true });
  element.addEventListener('touchend', onTouchEnd, { passive: true });
  element.addEventListener('touchcancel', onTouchEnd, { passive: true });
  element.addEventListener('contextmenu', onContextMenuEvent);

  return {
    detach() {
      clearTimer();
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchEnd);
      element.removeEventListener('contextmenu', onContextMenuEvent);
    },
    wasLongPress() {
      if (longPressed) {
        longPressed = false;
        return true;
      }
      return false;
    },
  };
}

/**
 * コンテキストメニュー表示コンポーネント。
 * body 直下に overlay + menu を配置し、overlay タッチで閉じる。
 */
export class ContextMenu {
  /**
   * @param {Object} options
   * @param {string} [options.title] - メニュータイトル
   * @param {Array<{label: string, danger?: boolean, onClick: function}>} options.items - メニュー項目
   */
  constructor({ title, items }) {
    this._title = title || null;
    this._items = items;
    this._overlay = null;
    this._menu = null;
    this._itemEls = [];
  }

  /**
   * メニューを表示する。
   * @param {Object} pos
   * @param {number} pos.x - X 座標
   * @param {number} pos.y - Y 座標
   * @param {boolean} pos.isMobile - モバイルなら画面中央、デスクトップならカーソル位置
   */
  show({ x, y, isMobile }) {
    // 既存メニューを閉じる
    this.close();

    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'context-menu-overlay';

    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    overlay.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });

    // Menu
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    // メニュー内タッチが overlay へ伝播するのを防止
    menu.addEventListener('touchstart', (e) => e.stopPropagation());

    // Title
    if (this._title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'context-menu__title';
      titleEl.textContent = this._title;
      menu.appendChild(titleEl);
    }

    // Items
    this._itemEls = [];
    for (const item of this._items) {
      const el = document.createElement('button');
      el.className = 'context-menu__item';
      if (item.danger) {
        el.classList.add('context-menu__item--danger');
      }
      el.textContent = item.label;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        item.onClick();
      });
      menu.appendChild(el);
      this._itemEls.push(el);
    }

    overlay.appendChild(menu);
    document.body.appendChild(overlay);

    this._overlay = overlay;
    this._menu = menu;

    // Position
    if (isMobile) {
      // モバイル: 画面中央
      requestAnimationFrame(() => {
        overlay.classList.add('context-menu-overlay--visible');
      });
    } else {
      // デスクトップ: カーソル位置（viewport 内に収まるよう調整）
      overlay.style.alignItems = 'flex-start';
      overlay.style.justifyContent = 'flex-start';
      menu.style.position = 'absolute';

      requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let left = x;
        let top = y;
        if (left + rect.width > vw) left = vw - rect.width - 8;
        if (top + rect.height > vh) top = vh - rect.height - 8;
        if (left < 0) left = 8;
        if (top < 0) top = 8;

        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        overlay.classList.add('context-menu-overlay--visible');
      });
    }
  }

  /**
   * メニューを閉じる（フェードアウト後 DOM 除去）。
   */
  close() {
    if (!this._overlay) return;
    const overlay = this._overlay;
    this._overlay = null;
    this._menu = null;
    this._itemEls = [];

    overlay.classList.remove('context-menu-overlay--visible');
    setTimeout(() => overlay.remove(), 200);
  }

  /**
   * メニュー項目の状態を更新する。
   * @param {number} index - 項目インデックス
   * @param {Object} updates
   * @param {string} [updates.label] - 新しいラベル
   * @param {boolean} [updates.disabled] - 無効化フラグ
   */
  updateItem(index, { label, disabled }) {
    const el = this._itemEls[index];
    if (!el) return;
    if (label !== undefined) el.textContent = label;
    if (disabled !== undefined) el.disabled = disabled;
  }
}
