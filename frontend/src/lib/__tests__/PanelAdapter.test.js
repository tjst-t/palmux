// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all heavy dependencies that Panel.svelte imports
vi.mock('../../../js/api.js', () => ({
  getWebSocketURL: vi.fn(() => 'ws://mock'),
  getCommands: vi.fn(() => Promise.resolve({ commands: [] })),
  listNotifications: vi.fn(() => Promise.resolve([])),
  deleteNotification: vi.fn(),
}));

vi.mock('../../../js/terminal.js', () => ({
  PalmuxTerminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    fit: vi.fn(),
    dispose: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(),
    element: document.createElement('div'),
  })),
}));

vi.mock('../../../js/touch.js', () => ({
  TouchHandler: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
  })),
}));

vi.mock('../../../js/connection.js', () => ({
  ConnectionManager: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    dispose: vi.fn(),
    send: vi.fn(),
    isConnected: false,
  })),
}));

vi.mock('../../../js/filebrowser.js', () => ({
  FileBrowser: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
    navigate: vi.fn(),
  })),
}));

vi.mock('../../../js/gitbrowser.js', () => ({
  GitBrowser: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
    navigate: vi.fn(),
  })),
}));

import { PanelAdapter } from '../PanelAdapter.js';

describe('PanelAdapter', () => {
  let adapter;

  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb();
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    if (adapter) {
      try { adapter.destroy(); } catch { /* already destroyed */ }
      adapter = null;
    }
    vi.restoreAllMocks();
  });

  function createAdapter(overrides = {}) {
    return new PanelAdapter({
      id: 'left',
      globalUIState: {},
      isMobileDevice: () => false,
      ...overrides,
    });
  }

  it('constructor creates instance with id property', () => {
    adapter = createAdapter();
    expect(adapter.id).toBe('left');
  });

  it('getElement() returns an HTML element', () => {
    adapter = createAdapter();
    const el = adapter.getElement();
    expect(el).toBeInstanceOf(HTMLElement);
  });

  it('session getter returns null initially', () => {
    adapter = createAdapter();
    expect(adapter.session).toBeNull();
  });

  it('windowIndex getter returns null initially', () => {
    adapter = createAdapter();
    // windowIndex may be null or -1 depending on implementation
    const idx = adapter.windowIndex;
    expect(idx === null || idx === -1).toBe(true);
  });

  it('viewMode getter returns a string', () => {
    adapter = createAdapter();
    expect(typeof adapter.viewMode).toBe('string');
  });

  it('isFocused getter returns false initially', () => {
    adapter = createAdapter();
    expect(adapter.isFocused).toBe(false);
  });

  it('cleanup() does not throw', () => {
    adapter = createAdapter();
    expect(() => {
      adapter.cleanup();
    }).not.toThrow();
  });

  it('destroy() does not throw', () => {
    adapter = createAdapter();
    expect(() => {
      adapter.destroy();
    }).not.toThrow();
    adapter = null;
  });
});
