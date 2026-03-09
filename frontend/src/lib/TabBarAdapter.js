/**
 * TabBarAdapter.js - Wraps the Svelte 5 TabBar component with a class-based
 * API matching the constructor signature expected by the vanilla JS codebase.
 *
 * Usage:
 *   import { TabBarAdapter } from './TabBarAdapter.js';
 *   const tabBar = new TabBarAdapter(containerEl, {
 *     onSelect(type, windowIndex) { ... },
 *     onContextMenu(event, type, windowIndex) { ... },
 *     onNewWindow() { ... },
 *   });
 *   tabBar.setWindows(sessionName, windows, isClaudeCodeMode);
 *   tabBar.setActiveTab({ type: 'terminal', windowIndex: 0 });
 *   tabBar.setNotifications(notifications);
 *   tabBar.dispose();
 */
import { mount, unmount } from 'svelte';
import TabBarComponent from './TabBar.svelte';

export class TabBarAdapter {
  /**
   * @param {HTMLElement} containerEl - DOM element to mount the tab bar into
   * @param {Object} callbacks
   * @param {function(type: string, windowIndex?: number): void} callbacks.onSelect
   *   Called when a tab is clicked. type is 'terminal', 'files', 'git', or 'add'.
   * @param {function(event: {x: number, y: number, isMobile: boolean}, type: string, windowIndex?: number): void} [callbacks.onContextMenu]
   *   Called on long press (touch) or right click for terminal tabs.
   * @param {function(): void} [callbacks.onNewWindow]
   *   Called when the + button is clicked.
   */
  constructor(containerEl, callbacks) {
    this._container = containerEl;

    // Wrap onSelect to intercept the 'add' type and route to onNewWindow
    const wrappedOnSelect = (type, windowIndex) => {
      if (type === 'add') {
        if (callbacks.onNewWindow) callbacks.onNewWindow();
        return;
      }
      if (callbacks.onSelect) callbacks.onSelect(type, windowIndex);
    };

    this._component = mount(TabBarComponent, {
      target: containerEl,
      props: {
        onSelect: wrappedOnSelect,
        onContextMenu: callbacks.onContextMenu || null,
      },
    });
  }

  /**
   * Render tabs for the given windows array.
   * @param {string} sessionName - Current session name
   * @param {Array<{index: number, name: string, active: boolean}>} windows
   * @param {boolean} isClaudeCodeMode
   */
  setWindows(sessionName, windows, isClaudeCodeMode) {
    this._component.setWindows(sessionName, windows, isClaudeCodeMode);
  }

  /**
   * Mark a tab as active.
   * @param {{type: string, windowIndex?: number}} tab
   */
  setActiveTab(tab) {
    this._component.setActiveTab(tab);
  }

  /**
   * Show notification badges on tabs.
   * @param {Array<{session: string, window_index: number, type: string}>} notifications
   */
  setNotifications(notifications) {
    this._component.setNotifications(notifications);
  }

  /**
   * Release resources and unmount the Svelte component.
   */
  dispose() {
    this._component.dispose();
    unmount(this._component);
    this._component = null;
  }
}
