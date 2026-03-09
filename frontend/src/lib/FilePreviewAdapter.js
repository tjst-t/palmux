import { mount, unmount } from 'svelte';
import FilePreview from './FilePreview.svelte';

export class FilePreviewAdapter {
  /**
   * @param {HTMLElement} container - DOM element to mount the file preview into
   * @param {Object} [options]
   * @param {string} options.session - tmux session name
   * @param {string} options.path - File path (relative)
   * @param {Object} options.entry - File entry info
   * @param {function(): void} [options.onBack]
   * @param {function(string, string): string} [options.getRawURL]
   * @param {function(string, string): Promise<Object>} [options.fetchFile]
   * @param {function(string, string, string): Promise<Object>} [options.saveFile]
   * @param {function(): void} [options.onLoad]
   * @param {function(string): Promise<Object>} [options.getLspStatus]
   * @param {function(string, string, number, number): Promise<Object>} [options.getLspDefinition]
   * @param {function(string, string, number, number): Promise<Object>} [options.getLspReferences]
   * @param {function(string, string): Promise<Object>} [options.getLspDocumentSymbols]
   * @param {import('../../js/navigation-stack.js').NavigationStack} [options.navStack]
   * @param {function(string, number): void} [options.onNavigate]
   */
  constructor(container, options = {}) {
    this._component = mount(FilePreview, {
      target: container,
      props: { ...options },
    });
  }

  /**
   * Scroll to a specific line and optionally highlight text.
   * @param {number} lineNumber
   * @param {string} [highlightText]
   */
  scrollToLine(lineNumber, highlightText) {
    this._component.scrollToLine(lineNumber, highlightText);
  }

  /**
   * Dispose the file preview and unmount the Svelte component.
   */
  dispose() {
    this._component.dispose();
    unmount(this._component);
    this._component = null;
  }
}
