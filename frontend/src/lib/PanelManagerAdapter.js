// PanelManagerAdapter.js - PanelManager.svelte を Vanilla JS から利用するためのアダプター

import { mount, unmount } from 'svelte';
import PanelManager from './PanelManager.svelte';

export class PanelManagerAdapter {
  /**
   * @param {object} options
   * @param {HTMLElement} options.container
   * @param {object} options.globalUIState
   * @param {function(): boolean} options.isMobileDevice
   * @param {function(string, number): void} [options.onClientStatus]
   * @param {function(Array): void} [options.onNotificationUpdate]
   * @param {function(string): void} [options.onConnectionStateChange]
   * @param {function(*): void} [options.onFocusChange]
   * @param {function(string, string): void} [options.onFileBrowserNavigate]
   * @param {function(string, string): void} [options.onFileBrowserPreview]
   * @param {function(string, string): void} [options.onFileBrowserPreviewClose]
   * @param {function(string, Object): void} [options.onGitBrowserNavigate]
   */
  constructor(options) {
    this._mountTarget = document.createElement('div');
    this._mountTarget.style.display = 'none';
    document.body.appendChild(this._mountTarget);

    this._component = mount(PanelManager, {
      target: this._mountTarget,
      props: {
        container: options.container,
        globalUIState: options.globalUIState,
        isMobileDevice: options.isMobileDevice,
        onClientStatus: options.onClientStatus || null,
        onNotificationUpdate: options.onNotificationUpdate || null,
        onConnectionStateChange: options.onConnectionStateChange || null,
        onFocusChange: options.onFocusChange || null,
        onFileBrowserNavigate: options.onFileBrowserNavigate || null,
        onFileBrowserPreview: options.onFileBrowserPreview || null,
        onFileBrowserPreviewClose: options.onFileBrowserPreviewClose || null,
        onGitBrowserNavigate: options.onGitBrowserNavigate || null,
      },
    });

    this._component.init();
  }

  get isSplit() { return this._component.getIsSplit(); }

  getFocusedPanel() { return this._component.getFocusedPanel(); }
  getLeftPanel() { return this._component.getLeftPanel(); }
  getRightPanel() { return this._component.getRightPanel(); }

  toggleSplit(opts) { this._component.toggleSplit(opts); }
  switchFocus() { this._component.switchFocus(); }
  setFocus(panel) { this._component.setFocus(panel); }
  switchTab(tabKey) { this._component.switchTab(tabKey); }
  connectToWindow(session, windowIndex) { this._component.connectToWindow(session, windowIndex); }

  getCurrentSession() { return this._component.getCurrentSession(); }
  getCurrentWindowIndex() { return this._component.getCurrentWindowIndex(); }
  getCurrentViewMode() { return this._component.getCurrentViewMode(); }

  getTerminal() { return this._component.getTerminal(); }
  getToolbar() { return this._component.getToolbar(); }
  getFileBrowsers() { return this._component.getFileBrowsers(); }
  getGitBrowsers() { return this._component.getGitBrowsers(); }

  cleanup() {
    this._component.cleanup();
    unmount(this._component);
    this._mountTarget.remove();
    this._component = null;
  }
}
