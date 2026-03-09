// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock Panel ---
vi.mock('../panel.js', () => {
  class MockPanel {
    constructor(options) {
      this.id = options.id;
      this.session = null;
      this.windowIndex = null;
      this.viewMode = 'terminal';
      this._focused = false;
      this._terminal = { focus: vi.fn() };
      this._onFocusRequest = options.onFocusRequest;

      this._el = document.createElement('div');
      this._el.dataset.panelId = options.id;
      this._el.classList.add('panel', 'panel--single');
    }
    getElement() { return this._el; }
    setHeaderVisible() {}
    setFocused(f) { this._focused = f; }
    fit() {}
    cleanup() {}
    getTerminal() { return this._terminal; }
    getToolbar() { return null; }
    getConnectionManager() { return null; }
    switchToTab() {}
    connectToWindow() {}
    get isFocused() { return this._focused; }
    get isConnected() { return this.session !== null; }
  }
  return { Panel: MockPanel };
});

import { PanelManager } from '../panel-manager.js';

describe('PanelManager visibilitychange focus restoration', () => {
  let container;
  let manager;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    manager = new PanelManager({
      container,
      globalUIState: { toolbarVisible: true, keyboardMode: 'none' },
      isMobileDevice: () => false,
    });
  });

  afterEach(() => {
    manager.cleanup();
    container.remove();
  });

  it('should call terminal.focus() when page becomes visible', () => {
    const panel = manager.getFocusedPanel();
    const terminal = panel.getTerminal();

    // Simulate visibilitychange to visible
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(terminal.focus).toHaveBeenCalled();
  });

  it('should NOT call terminal.focus() when page becomes hidden', () => {
    const panel = manager.getFocusedPanel();
    const terminal = panel.getTerminal();
    terminal.focus.mockClear();

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(terminal.focus).not.toHaveBeenCalled();
  });

  it('should NOT call focus when panel has no terminal', () => {
    const panel = manager.getFocusedPanel();
    panel._terminal = null;
    panel.getTerminal = vi.fn(() => null);

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });

    expect(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    }).not.toThrow();
  });

  it('should remove visibilitychange listener on cleanup', () => {
    const panel = manager.getFocusedPanel();
    const terminal = panel.getTerminal();

    manager.cleanup();
    terminal.focus.mockClear();

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(terminal.focus).not.toHaveBeenCalled();
  });
});
