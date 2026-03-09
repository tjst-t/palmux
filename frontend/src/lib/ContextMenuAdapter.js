/**
 * ContextMenuAdapter.js - Wraps the Svelte 5 ContextMenu component with a
 * class-based API matching the original ContextMenu class from context-menu.js.
 *
 * Usage:
 *   import { ContextMenuAdapter } from './ContextMenuAdapter.js';
 *   const menu = new ContextMenuAdapter(containerEl);
 *   menu.show(mouseOrTouchEvent, [
 *     { label: 'Copy', action: () => { ... } },
 *     { label: 'Delete', action: () => { ... }, danger: true },
 *   ]);
 *   menu.hide();
 *   menu.dispose();
 */
import { mount, unmount } from 'svelte';
import ContextMenuComponent from './ContextMenu.svelte';

export class ContextMenuAdapter {
  /**
   * @param {HTMLElement} containerEl - DOM element to mount the context menu into
   */
  constructor(containerEl) {
    this._container = containerEl;
    this._component = mount(ContextMenuComponent, {
      target: containerEl,
      props: {},
    });
  }

  /**
   * Show the context menu at the position extracted from a MouseEvent or TouchEvent.
   * @param {MouseEvent|TouchEvent} event - The triggering event
   * @param {Array<{label: string, action: () => void, danger?: boolean}>} items - Menu items
   */
  show(event, items) {
    let x, y;
    if (event.touches && event.touches.length > 0) {
      x = event.touches[0].clientX;
      y = event.touches[0].clientY;
    } else if (event.changedTouches && event.changedTouches.length > 0) {
      x = event.changedTouches[0].clientX;
      y = event.changedTouches[0].clientY;
    } else {
      x = event.clientX;
      y = event.clientY;
    }
    this._component.show(x, y, items);
  }

  /**
   * Hide the context menu.
   */
  hide() {
    this._component.hide();
  }

  /**
   * Release all resources and unmount the Svelte component.
   */
  dispose() {
    this._component.dispose();
    unmount(this._component);
    this._component = null;
  }
}
