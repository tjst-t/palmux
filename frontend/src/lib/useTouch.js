// useTouch.js - TouchHandler を Svelte action としてラップする
import { TouchHandler } from '../../js/touch.js';

/**
 * Svelte action: ターミナルコンテナにタッチジェスチャー処理を追加する。
 *
 * - 垂直スクロール → WheelEvent（tmux mouse mode 対応）
 * - ピンチズーム → コールバック
 * - 長押し → テキスト選択（触覚フィードバック付き）
 *
 * @param {HTMLElement} node - action が適用される DOM 要素
 * @param {{ terminal?: object, onPinchZoom?: (delta: number) => void }} options
 * @returns {{ update: (newOptions: { terminal?: object, onPinchZoom?: (delta: number) => void }) => void, destroy: () => void }}
 *
 * @example
 * <div use:useTouch={{ terminal: termRef, onPinchZoom: handlePinch }}>
 */
export function useTouch(node, options = {}) {
  let handler = new TouchHandler(node, {
    terminal: options.terminal ?? null,
    onPinchZoom: options.onPinchZoom ?? undefined,
  });

  return {
    update(newOptions) {
      handler.destroy();
      handler = new TouchHandler(node, {
        terminal: newOptions.terminal ?? null,
        onPinchZoom: newOptions.onPinchZoom ?? undefined,
      });
    },
    destroy() {
      handler.destroy();
    },
  };
}
