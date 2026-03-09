/**
 * Window state store.
 * Manages window list per session and active window tracking.
 */
import { listWindows, createWindow as apiCreateWindow, deleteWindow as apiDeleteWindow, renameWindow as apiRenameWindow } from '../../js/api.js';

/** @typedef {{ index: number, name: string, active: boolean }} Window */

let windows = $state([]);
let activeWindowIndex = $state(null);
let currentSession = $state(null);
let loading = $state(false);

export const windowStore = {
  get windows() { return windows; },
  get activeWindowIndex() { return activeWindowIndex; },
  set activeWindowIndex(value) { activeWindowIndex = value; },
  get currentSession() { return currentSession; },
  get loading() { return loading; },

  /** Fetch windows for a session */
  async fetchWindows(session) {
    loading = true;
    try {
      currentSession = session;
      windows = await listWindows(session);
      return windows;
    } finally {
      loading = false;
    }
  },

  /** Create a new window */
  async createWindow(session, name, command) {
    const result = await apiCreateWindow(session, name, command);
    await this.fetchWindows(session);
    return result;
  },

  /** Delete a window */
  async deleteWindow(session, index) {
    await apiDeleteWindow(session, index);
    if (activeWindowIndex === index) {
      activeWindowIndex = null;
    }
    await this.fetchWindows(session);
  },

  /** Rename a window */
  async renameWindow(session, index, name) {
    const result = await apiRenameWindow(session, index, name);
    await this.fetchWindows(session);
    return result;
  },

  /** Set windows directly */
  setWindows(session, newWindows) {
    currentSession = session;
    windows = newWindows;
  },

  /** Find window by index */
  findWindow(index) {
    return windows.find(w => w.index === index) || null;
  },

  /** Clear windows (e.g. on session change) */
  clear() {
    windows = [];
    activeWindowIndex = null;
    currentSession = null;
  },
};
