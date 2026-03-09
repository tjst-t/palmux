// TerminalAdapter.js - Wraps the Svelte 5 Terminal component with a class-based
// API matching the PalmuxTerminal interface expected by the vanilla JS codebase.
//
// Usage:
//   import { TerminalAdapter } from './TerminalAdapter.js';
//   const term = new TerminalAdapter(containerEl, {
//     onSend: (data) => ws.send(data),
//     toolbar: toolbarInstance,
//   });
//   term.connect('ws://localhost:8080/ws');
//   term.fit();
//   term.destroy();

import { mount, unmount } from 'svelte';
import Terminal from './Terminal.svelte';

export class TerminalAdapter {
  /**
   * @param {HTMLElement} container - DOM element to mount the terminal into
   * @param {Object} [options]
   */
  constructor(container, options = {}) {
    this._container = container;

    this._component = mount(Terminal, {
      target: container,
      props: {
        ...options,
      },
    });
  }

  /**
   * WebSocket 接続を開始する。
   * @param {string} wsUrl
   * @param {function(): void} [onDisconnect]
   */
  connect(wsUrl, onDisconnect) {
    this._component.connect(wsUrl, onDisconnect);
  }

  /**
   * 既存接続を切断し再接続する。
   * @param {string} wsUrl
   * @param {function(): void} [onDisconnect]
   */
  reconnect(wsUrl, onDisconnect) {
    this._component.reconnect(wsUrl, onDisconnect);
  }

  /**
   * WebSocket 接続を切断する。
   */
  disconnect() {
    this._component.disconnect();
  }

  /**
   * ターミナルサイズをコンテナに合わせる。
   */
  fit() {
    this._component.fit();
  }

  /**
   * ターミナルに入力データを送信する。
   * @param {string} data
   */
  sendInput(data) {
    this._component.sendInput(data);
  }

  /**
   * ツールバーを設定する。
   * @param {import('../../js/toolbar.js').Toolbar|null} toolbar
   */
  setToolbar(toolbar) {
    this._component.setToolbar(toolbar);
  }

  /**
   * IME モードの有効/無効を切り替える。
   * @param {boolean} enabled
   */
  setIMEMode(enabled) {
    this._component.setIMEMode(enabled);
  }

  /**
   * キーボードモードを設定する。
   * @param {string} mode
   */
  setKeyboardMode(mode) {
    this._component.setKeyboardMode(mode);
  }

  /**
   * グローバルキーハンドラの有効/無効を切り替える。
   * @param {boolean} enabled
   */
  setGlobalKeyHandlerEnabled(enabled) {
    this._component.setGlobalKeyHandlerEnabled(enabled);
  }

  /**
   * 自動 fit の有効/無効を切り替える。
   * @param {boolean} enabled
   */
  setFitEnabled(enabled) {
    this._component.setFitEnabled(enabled);
  }

  /**
   * 接続成功時のコールバックを設定する。
   * @param {function(): void} callback
   */
  setOnConnect(callback) {
    this._component.setOnConnect(callback);
  }

  /**
   * クライアントステータス変更時のコールバックを設定する。
   * @param {function(string): void} callback
   */
  setOnClientStatus(callback) {
    this._component.setOnClientStatus(callback);
  }

  /**
   * 通知更新時のコールバックを設定する。
   * @param {function(): void} callback
   */
  setOnNotificationUpdate(callback) {
    this._component.setOnNotificationUpdate(callback);
  }

  /**
   * 再接続フラッシュ時のコールバックを設定する。
   * @param {function(): void} callback
   */
  setOnReconnectFlush(callback) {
    this._component.setOnReconnectFlush(callback);
  }

  /**
   * ターミナルにフォーカスする。
   */
  focus() {
    this._component.focus();
  }

  /**
   * 画面座標からセル位置を取得する。
   * @param {number} x
   * @param {number} y
   * @returns {{col: number, row: number}|null}
   */
  getCellFromPoint(x, y) {
    return this._component.getCellFromPoint(x, y);
  }

  /**
   * 指定ビューポート行のテキストを取得する。
   * @param {number} viewportRow
   * @returns {string}
   */
  getLineText(viewportRow) {
    return this._component.getLineText(viewportRow);
  }

  /**
   * テキストを選択する。
   * @param {number} col
   * @param {number} row
   * @param {number} length
   */
  select(col, row, length) {
    this._component.select(col, row, length);
  }

  /**
   * 現在の選択テキストを取得する。
   * @returns {string}
   */
  getSelection() {
    return this._component.getSelection();
  }

  /**
   * 選択を解除する。
   */
  clearSelection() {
    this._component.clearSelection();
  }

  /**
   * ターミナルのカラム数を取得する。
   * @returns {number}
   */
  getCols() {
    return this._component.getCols();
  }

  /**
   * フォントサイズを設定する。
   * @param {number} size
   */
  setFontSize(size) {
    this._component.setFontSize(size);
  }

  /**
   * フォントサイズを拡大する。
   */
  increaseFontSize() {
    this._component.increaseFontSize();
  }

  /**
   * フォントサイズを縮小する。
   */
  decreaseFontSize() {
    this._component.decreaseFontSize();
  }

  /**
   * 現在のフォントサイズを取得する。
   * @returns {number}
   */
  getFontSize() {
    return this._component.getFontSize();
  }

  /**
   * リソースを解放し Svelte コンポーネントをアンマウントする。
   */
  destroy() {
    unmount(this._component);
    this._component = null;
  }
}
