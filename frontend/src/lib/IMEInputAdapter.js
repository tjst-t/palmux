// IMEInputAdapter.js - Drop-in replacement adapter for the vanilla IMEInput class.
// Wraps the Svelte 5 IMEInput component via mount() so existing code
// (e.g. panel.js) can use `new IMEInputAdapter(container, options)` unchanged.

import { mount, unmount } from 'svelte';
import IMEInput from './IMEInput.svelte';

/**
 * Adapter that presents the same class-based API as the original
 * `IMEInput` from `ime-input.js`, but delegates to the Svelte 5 component.
 *
 * @example
 *   const ime = new IMEInputAdapter(container, {
 *     onSend: (text) => ws.send(text),
 *     onToggle: (visible) => console.log(visible),
 *     toolbar: toolbarInstance,
 *   });
 *   ime.show();
 *   ime.insertText('hello');
 *   ime.destroy();
 */
export class IMEInputAdapter {
  /**
   * @param {HTMLElement} container - IME 入力バーをマウントする DOM 要素
   * @param {Object} options
   * @param {function(string): void} options.onSend - テキストを送信するコールバック
   * @param {function(boolean): void} [options.onToggle] - IME モード変更時のコールバック
   * @param {import('../../js/toolbar.js').Toolbar|null} [options.toolbar] - ツールバー参照
   */
  constructor(container, options) {
    this._container = container;

    /** @type {ReturnType<typeof mount>} */
    this._component = mount(IMEInput, {
      target: container,
      props: {
        onSend: options.onSend,
        onToggle: options.onToggle || null,
        toolbar: options.toolbar || null,
      },
    });
  }

  /**
   * IME 入力フィールドを表示する。
   */
  show() {
    this._component.show();
  }

  /**
   * IME 入力フィールドを非表示にする。
   */
  hide() {
    this._component.hide();
  }

  /**
   * IME 入力フィールドの表示/非表示をトグルする。
   */
  toggle() {
    this._component.toggle();
  }

  /**
   * IME 入力フィールドが現在表示されているか。
   * @returns {boolean}
   */
  get isVisible() {
    return this._component.getIsVisible();
  }

  /**
   * テキストを入力フィールドに追加する（音声入力結果の挿入用）。
   * @param {string} text
   */
  insertText(text) {
    this._component.insertText(text);
  }

  /**
   * 中間結果テキストをプレビュー表示する。空文字で非表示。
   * @param {string} text
   */
  setPreviewText(text) {
    this._component.setPreviewText(text);
  }

  /**
   * ツールバーを設定する。
   * @param {import('../../js/toolbar.js').Toolbar|null} toolbar
   */
  setToolbar(toolbar) {
    this._component.setToolbar(toolbar);
  }

  /**
   * IME バー要素を返す（マイクボタン挿入用）。
   * @returns {HTMLElement}
   */
  getBarElement() {
    return this._component.getBarElement();
  }

  /**
   * リソースを解放する。
   */
  destroy() {
    this._component.destroy();
    unmount(this._component);
  }
}
