/**
 * FileBrowserAdapter.js - Wraps the Svelte 5 FileBrowser component with the
 * same class-based API as the original Vanilla JS FileBrowser (filebrowser.js).
 *
 * Usage:
 *   import { FileBrowserAdapter } from './FileBrowserAdapter.js';
 *   const fb = new FileBrowserAdapter(container, {
 *     onFileSelect(session, path, entry) { ... },
 *     onNavigate(path) { ... },
 *     onPreviewClose() { ... },
 *   });
 *   await fb.open(session, '.');
 *   fb.navigateTo('src');
 *   fb.dispose();
 */
import { mount, unmount } from 'svelte';
import FileBrowser from './FileBrowser.svelte';

export class FileBrowserAdapter {
  /**
   * @param {HTMLElement} container - DOM element to mount the file browser into
   * @param {Object} [options]
   * @param {function} [options.onFileSelect] - Called when a file is selected
   * @param {function} [options.onNavigate] - Called when navigating to a directory
   * @param {function} [options.onPreviewClose] - Called when a preview is closed
   */
  constructor(container, options = {}) {
    this._container = container;

    this._component = mount(FileBrowser, {
      target: container,
      props: {
        onFileSelect: options.onFileSelect || undefined,
        onNavigate: options.onNavigate || undefined,
        onPreviewClose: options.onPreviewClose || undefined,
      },
    });
  }

  /**
   * Open the file browser for a session.
   * @param {string} session - Session name
   * @param {string} [initialPath] - Initial directory path
   */
  async open(session, initialPath) {
    await this._component.open(session, initialPath);
  }

  /**
   * Get the current directory path.
   * @returns {string|null}
   */
  getCurrentPath() {
    return this._component.getCurrentPath();
  }

  /**
   * Get the currently previewed file path.
   * @returns {string|null}
   */
  getPreviewFile() {
    return this._component.getPreviewFile();
  }

  /**
   * Navigate to a directory path.
   * @param {string} path
   */
  async navigateTo(path) {
    await this._component.navigateTo(path);
  }

  /**
   * Show a file preview.
   * @param {string} session - Session name
   * @param {string} path - File path
   * @param {Object} entry - File entry object
   * @param {Object} [opts] - Options (lineNumber, highlightText)
   */
  showPreview(session, path, entry, opts) {
    this._component.showPreview(session, path, entry, opts);
  }

  /**
   * Set the font size for the file browser.
   * @param {number} size
   */
  setFontSize(size) {
    this._component.setFontSize(size);
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
   * Get the current font size.
   * @returns {number|null}
   */
  getFontSize() {
    return this._component.getFontSize();
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
