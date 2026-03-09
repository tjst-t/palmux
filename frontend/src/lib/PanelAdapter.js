// PanelAdapter.js - Panel.svelte を Vanilla JS から利用するためのアダプター
// 既存の Panel クラスと同じ API を提供する。

import { mount, unmount } from 'svelte';
import Panel from './Panel.svelte';

export class PanelAdapter {
  /**
   * @param {object} options
   * @param {'left'|'right'} options.id
   * @param {object} options.globalUIState
   * @param {function(): boolean} options.isMobileDevice
   * @param {function(PanelAdapter): void} [options.onFocusRequest]
   * @param {function(string, number): void} [options.onClientStatus]
   * @param {function(Array): void} [options.onNotificationUpdate]
   * @param {function(string): void} [options.onConnectionStateChange]
   * @param {function(string, string): void} [options.onFileBrowserNavigate]
   * @param {function(string, string): void} [options.onFileBrowserPreview]
   * @param {function(string, string): void} [options.onFileBrowserPreviewClose]
   * @param {function(string, Object): void} [options.onGitBrowserNavigate]
   */
  constructor(options) {
    this._id = options.id;
    this._globalUIState = options.globalUIState;
    this._mountTarget = document.createElement('div');
    this._mountTarget.style.display = 'contents';

    // onFocusRequest needs to be intercepted to pass adapter instead of internal panelAPI
    const self = this;

    this._component = mount(Panel, {
      target: this._mountTarget,
      props: {
        id: options.id,
        globalUIState: options.globalUIState,
        isMobileDevice: options.isMobileDevice,
        onFocusRequest: options.onFocusRequest
          ? () => options.onFocusRequest(self)
          : null,
        onClientStatus: options.onClientStatus || null,
        onNotificationUpdate: options.onNotificationUpdate || null,
        onConnectionStateChange: options.onConnectionStateChange || null,
        onFileBrowserNavigate: options.onFileBrowserNavigate || null,
        onFileBrowserPreview: options.onFileBrowserPreview || null,
        onFileBrowserPreviewClose: options.onFileBrowserPreviewClose || null,
        onGitBrowserNavigate: options.onGitBrowserNavigate || null,
      },
    });
  }

  get id() { return this._id; }

  get session() { return this._component.getSession(); }
  set session(v) { this._component.setSession(v); }

  get windowIndex() { return this._component.getWindowIndex(); }
  set windowIndex(v) { this._component.setWindowIndex(v); }

  get viewMode() { return this._component.getViewMode(); }

  get isFocused() { return this._component.getIsFocused(); }

  get isConnected() { return this._component.getIsConnected(); }

  getElement() { return this._component.getElement(); }
  setHeaderVisible(visible) { this._component.setHeaderVisible(visible); }
  switchToTab(tabKey) { this._component.switchToTab(tabKey); }
  getActiveTabKey() { return this._component.getActiveTabKey(); }
  removeTerminalTab(windowIdx) { this._component.removeTerminalTab(windowIdx); }
  pruneTerminalTabs(windows) { this._component.pruneTerminalTabs(windows); }
  clearTabCache() { this._component.clearTabCache(); }
  connectToWindow(sessionName, windowIdx) { this._component.connectToWindow(sessionName, windowIdx); }
  showTerminalView() { this._component.showTerminalView(); }
  showFileBrowser(sessionName, opts) { this._component.showFileBrowser(sessionName, opts); }
  showGitBrowser(sessionName) { this._component.showGitBrowser(sessionName); }
  setFocused(focused) { this._component.setFocused(focused); }
  fit() { this._component.fit(); }
  getTerminal() { return this._component.getTerminal(); }
  getToolbar() { return this._component.getToolbar(); }
  getFileBrowsers() { return this._component.getFileBrowsers(); }
  getGitBrowsers() { return this._component.getGitBrowsers(); }
  getConnectionManager() { return this._component.getConnectionManager(); }
  getCurrentFilePath() { return this._component.getCurrentFilePath(); }
  increaseFontSize() { this._component.increaseFontSize(); }
  decreaseFontSize() { this._component.decreaseFontSize(); }
  setClaudeWindow(isClaude) { this._component.setClaudeWindow(isClaude); }
  toggleToolbar() { this._component.toggleToolbar(); }
  reconnectNow() { this._component.reconnectNow(); }
  cleanup() { this._component.cleanup(); }

  static getLastTab(sessionName) {
    try {
      return localStorage.getItem(`palmux-last-tab-${sessionName}`);
    } catch { return null; }
  }

  destroy() {
    this._component.cleanup();
    unmount(this._component);
    this._component = null;
  }
}
