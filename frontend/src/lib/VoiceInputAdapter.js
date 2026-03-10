// VoiceInputAdapter.js - Drop-in replacement adapter for the vanilla VoiceInput class.
// Wraps the Svelte 5 VoiceInput component via mount() so existing code
// (e.g. panel.js) can use `new VoiceInputAdapter(container, options)` unchanged.

import { mount, unmount } from 'svelte';
import VoiceInput from './VoiceInput.svelte';

/**
 * Adapter that presents the same class-based API as the original
 * `VoiceInput` from `voice-input.js`, but delegates to the Svelte 5 component.
 *
 * @example
 *   const voice = new VoiceInputAdapter(container, {
 *     onResult: (text) => ime.insertText(text),
 *     onInterim: (text) => ime.setPreviewText(text),
 *     onError: (err) => console.error(err),
 *     lang: 'ja-JP',
 *   });
 *   voice.toggle();
 *   voice.dispose();
 */
export class VoiceInputAdapter {
  /**
   * Web Speech API が利用可能かどうかを返す。
   * @returns {boolean}
   */
  static isSupported() {
    return !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
  }

  /**
   * @param {HTMLElement} container - マイクボタンを挿入する DOM 要素
   * @param {Object} options
   * @param {function(string): void} options.onResult - 確定テキストのコールバック
   * @param {function(string): void} [options.onInterim] - 中間結果のコールバック
   * @param {function(string): void} [options.onError] - エラーコールバック
   * @param {string} [options.lang='ja-JP'] - 認識言語
   */
  constructor(container, options) {
    this._container = container;

    // 送信ボタンの直前に anchor 要素を挿入して、そこにマウントする
    this._anchor = document.createElement('span');
    const sendBtn = container.querySelector('.ime-send-btn');
    if (sendBtn) {
      container.insertBefore(this._anchor, sendBtn);
    } else {
      container.appendChild(this._anchor);
    }

    /** @type {ReturnType<typeof mount>} */
    this._component = mount(VoiceInput, {
      target: this._anchor,
      props: {
        onResult: options.onResult,
        onInterim: options.onInterim || null,
        onError: options.onError || null,
        lang: options.lang || 'ja-JP',
      },
    });
  }

  /**
   * 音声認識を開始する。
   */
  start() {
    this._component.start();
  }

  /**
   * 音声認識を停止する。
   */
  stop() {
    this._component.stop();
  }

  /**
   * 音声認識の開始/停止をトグルする。
   */
  toggle() {
    this._component.toggle();
  }

  /**
   * 現在の状態を返す。
   * @returns {'idle' | 'listening'}
   */
  get state() {
    return this._component.getState();
  }

  /**
   * 認識言語を変更する。
   * @param {string} lang - BCP 47 言語タグ（例: 'ja-JP', 'en-US'）
   */
  setLang(lang) {
    this._component.setLang(lang);
  }

  /**
   * リソースを解放する。
   */
  dispose() {
    this._component.dispose();
    unmount(this._component);
    if (this._anchor) {
      this._anchor.remove();
      this._anchor = null;
    }
  }
}
