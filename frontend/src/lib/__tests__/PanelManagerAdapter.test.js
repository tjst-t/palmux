// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all heavy dependencies that Panel.svelte imports (via PanelManager -> PanelAdapter -> Panel.svelte)
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

import { PanelManagerAdapter } from '../PanelManagerAdapter.js';

describe('PanelManagerAdapter', () => {
  let adapter;
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'panel-container';
    document.body.appendChild(container);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb();
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    if (adapter) {
      try { adapter.cleanup(); } catch { /* already cleaned up */ }
      adapter = null;
    }
    container.remove();
    vi.restoreAllMocks();
  });

  function createAdapter(overrides = {}) {
    return new PanelManagerAdapter({
      container,
      globalUIState: {},
      isMobileDevice: () => false,
      ...overrides,
    });
  }

  it('constructor creates instance', () => {
    adapter = createAdapter();
    expect(adapter).toBeDefined();
  });

  it('isSplit returns false initially', () => {
    adapter = createAdapter();
    expect(adapter.isSplit).toBe(false);
  });

  it('getFocusedPanel() returns an object', () => {
    adapter = createAdapter();
    const panel = adapter.getFocusedPanel();
    expect(panel).toBeDefined();
    expect(panel).not.toBeNull();
  });

  it('getLeftPanel() returns an object', () => {
    adapter = createAdapter();
    const panel = adapter.getLeftPanel();
    expect(panel).toBeDefined();
    expect(panel).not.toBeNull();
  });

  it('cleanup() does not throw', () => {
    adapter = createAdapter();
    expect(() => {
      adapter.cleanup();
    }).not.toThrow();
    adapter = null;
  });
});
