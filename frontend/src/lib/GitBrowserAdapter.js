/**
 * GitBrowserAdapter.js - Wraps the Svelte 5 GitBrowser component with the
 * same class-based API as the original Vanilla JS GitBrowser (gitbrowser.js).
 *
 * Usage:
 *   import { GitBrowserAdapter } from './GitBrowserAdapter.js';
 *   const gb = new GitBrowserAdapter(container, {
 *     onNavigate(state) { ... },
 *   });
 *   await gb.open(session);
 *   gb.dispose();
 */
import { mount, unmount } from 'svelte';
import GitBrowser from './GitBrowser.svelte';

export class GitBrowserAdapter {
  /**
   * @param {HTMLElement} container - DOM element to mount the git browser into
   * @param {Object} [options]
   * @param {function} [options.onNavigate] - Called on internal navigation
   */
  constructor(container, options = {}) {
    this._container = container;

    this._component = mount(GitBrowser, {
      target: container,
      props: {
        onNavigate: options.onNavigate || null,
      },
    });
  }

  /**
   * Open the git browser for a session.
   * @param {string} session - Session name
   */
  async open(session) {
    await this._component.open(session);
  }

  /**
   * Increase the font size.
   */
  increaseFontSize() {
    this._component.increaseFontSize();
  }

  /**
   * Decrease the font size.
   */
  decreaseFontSize() {
    this._component.decreaseFontSize();
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
