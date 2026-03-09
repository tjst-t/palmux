/**
 * ToolbarAdapter.js - Wraps the Svelte 5 Toolbar component with the same
 * class-based API as the original Vanilla JS Toolbar (toolbar.js).
 *
 * Usage:
 *   import { ToolbarAdapter as Toolbar } from './ToolbarAdapter.js';
 *   const toolbar = new Toolbar(container, { onSendKey, onKeyboardMode, onFetchCommands });
 *   toolbar.consumeModifiers();
 *   toolbar.toggleVisibility();
 *   toolbar.dispose();
 */
import { mount, unmount } from 'svelte';
import ToolbarComponent from './Toolbar.svelte';

export class ToolbarAdapter {
  /**
   * @param {HTMLElement} container - DOM element to mount the toolbar into
   * @param {Object} options
   * @param {function(string): void} options.onSendKey
   * @param {function(string): void} [options.onKeyboardMode]
   * @param {function(string): Promise<{commands: Array}>} [options.onFetchCommands]
   */
  constructor(container, options) {
    this._container = container;

    // Mount the Svelte component into the container.
    // Svelte 5's mount() returns the component instance with exported bindings.
    this._component = mount(ToolbarComponent, {
      target: container,
      props: {
        onSendKey: options.onSendKey,
        onKeyboardMode: options.onKeyboardMode || null,
        onFetchCommands: options.onFetchCommands || null,
      },
    });
  }

  /**
   * Consume current modifier state and reset oneshot modifiers.
   * @returns {{ ctrl: boolean, alt: boolean }}
   */
  consumeModifiers() {
    return this._component.consumeModifiers();
  }

  /**
   * Toggle toolbar visibility.
   */
  toggleVisibility() {
    this._component.toggleVisibility();
  }

  /**
   * Set current session name. Clears command cache if session changed.
   * @param {string} session
   */
  setCurrentSession(session) {
    this._component.setCurrentSession(session);
  }

  /**
   * Set whether the current window is a Claude window.
   * @param {boolean} isClaude
   */
  setClaudeWindow(isClaude) {
    this._component.setClaudeWindow(isClaude);
  }

  /**
   * Restore saved toolbar state.
   * @param {Object} state
   * @param {boolean|null} state.toolbarVisible
   * @param {'none'|'direct'|'ime'} state.keyboardMode
   * @param {'off'|'oneshot'|'locked'} state.ctrlState
   * @param {'off'|'oneshot'|'locked'} state.altState
   */
  restoreState(state) {
    this._component.restoreState(state);
  }

  /**
   * Whether Ctrl is active (oneshot or locked).
   * @returns {boolean}
   */
  hasCtrl() {
    return this._component.hasCtrl();
  }

  /**
   * Whether Alt is active (oneshot or locked).
   * @returns {boolean}
   */
  hasAlt() {
    return this._component.hasAlt();
  }

  /**
   * Whether the toolbar is currently visible.
   * @returns {boolean}
   */
  get visible() {
    return this._component.getVisible();
  }

  /**
   * Current Ctrl modifier state.
   * @returns {'off' | 'oneshot' | 'locked'}
   */
  get ctrlState() {
    return this._component.getCtrlState();
  }

  /**
   * Current Alt modifier state.
   * @returns {'off' | 'oneshot' | 'locked'}
   */
  get altState() {
    return this._component.getAltState();
  }

  /**
   * Current keyboard mode.
   * @returns {'none' | 'direct' | 'ime'}
   */
  get keyboardMode() {
    return this._component.getKeyboardMode();
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
