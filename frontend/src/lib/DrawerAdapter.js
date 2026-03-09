/**
 * DrawerAdapter.js - Wraps the Svelte 5 Drawer component with the same
 * class-based API as the original Vanilla JS Drawer (drawer.js).
 *
 * Usage:
 *   import { DrawerAdapter as Drawer } from './DrawerAdapter.js';
 *   const drawer = new DrawerAdapter({
 *     onSelectSession(name, windowIndex) { ... },
 *     onCreateSession(name) { ... },
 *     onDeleteSession() { ... },
 *     onClose() { ... },
 *   });
 *   drawer.open();
 *   drawer.setCurrent(session, windowIndex);
 *   drawer.setNotifications([...]);
 *   drawer.togglePin();
 *   drawer.dispose();
 */
import { mount, unmount } from 'svelte';
import DrawerComponent from './Drawer.svelte';
import {
  listSessions,
  createSession,
  deleteSession,
  listGhqRepos,
  cloneGhqRepo,
  deleteGhqRepo,
  listProjectWorktrees,
  createProjectWorktree,
  deleteProjectWorktree,
  listProjectBranches,
  isProjectBranchMerged,
  deleteProjectBranch,
} from '../../js/api.js';

export class DrawerAdapter {
  /**
   * @param {Object} options
   * @param {function(string, number): void} options.onSelectSession - Called when a session is selected (sessionName, windowIndex)
   * @param {function(string): void} [options.onCreateSession] - Called after session creation (sessionName)
   * @param {function(): void} [options.onDeleteSession] - Called after session deletion
   * @param {function(): void} [options.onClose] - Called when the drawer closes
   * @param {string} [options.claudePath] - Path to claude binary
   */
  constructor(options) {
    // Find the existing drawer container or create one
    // The original drawer.js expects #drawer, #drawer-overlay, #drawer-content to exist in DOM.
    // For the Svelte version, we mount into a container that replaces those.
    this._container = document.getElementById('drawer');

    if (!this._container) {
      // Create a container if one doesn't exist
      this._container = document.createElement('div');
      this._container.id = 'drawer-svelte-container';
      document.body.appendChild(this._container);
    } else {
      // Clear existing content - Svelte will manage the DOM
      this._container.innerHTML = '';
      // Remove classes the original sets - Svelte will manage them
      this._container.classList.remove('drawer--open', 'drawer--pinned');
    }

    this._component = mount(DrawerComponent, {
      target: this._container,
      props: {
        onSelectSession: options.onSelectSession,
        onCreateSession: options.onCreateSession || null,
        onDeleteSession: options.onDeleteSession || null,
        onClose: options.onClose || null,
        claudePath: options.claudePath || 'claude',
        // Inject API functions
        listSessions,
        createSession,
        deleteSession,
        listGhqRepos,
        cloneGhqRepo,
        deleteGhqRepo,
        listProjectWorktrees,
        createProjectWorktree,
        deleteProjectWorktree,
        listProjectBranches,
        isProjectBranchMerged,
        deleteProjectBranch,
      },
    });
  }

  /**
   * Open the drawer and show session data.
   */
  async open() {
    await this._component.open();
  }

  /**
   * Close the drawer.
   */
  close() {
    this._component.close();
  }

  /**
   * Whether the drawer is currently open.
   * @returns {boolean}
   */
  get isOpen() {
    return this._component.getIsOpen();
  }

  /**
   * Whether the drawer is pinned.
   * @returns {boolean}
   */
  get isPinned() {
    return this._component.getIsPinned();
  }

  /**
   * Toggle pin state.
   */
  togglePin() {
    this._component.togglePin();
  }

  /**
   * Restore pin state from localStorage.
   */
  async restorePinState() {
    await this._component.restorePinState();
  }

  /**
   * Set current session and window index. Re-renders if drawer is visible.
   * @param {string} session - Session name
   * @param {number} windowIndex - Window index
   * @param {{ sessionChanged?: boolean }} [opts]
   */
  setCurrent(session, windowIndex, opts = {}) {
    this._component.setCurrent(session, windowIndex, opts);
  }

  /**
   * Update notification badges.
   * @param {Array<{session: string, window_index: number, type: string}>} notifications
   */
  setNotifications(notifications) {
    this._component.setNotifications(notifications);
  }

  /**
   * Open the drawer with a specific session/window context.
   * @param {string} sessionName
   * @param {number} windowIndex
   */
  show(sessionName, windowIndex) {
    this._component.show(sessionName, windowIndex);
  }

  /**
   * Hide the drawer.
   */
  hide() {
    this._component.hide();
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
