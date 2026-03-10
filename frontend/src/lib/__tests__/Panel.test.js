// @vitest-environment happy-dom
import { mount, unmount, flushSync } from 'svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock all heavy dependencies ---
vi.mock('../../../js/api.js', () => ({
  getWebSocketURL: vi.fn(() => 'ws://localhost/ws'),
  getCommands: vi.fn(() => Promise.resolve({ commands: [] })),
  listNotifications: vi.fn(() => Promise.resolve([])),
  deleteNotification: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../js/terminal.js', () => {
  class MockTerminal {
    constructor() {
      this._fitEnabled = false;
      this._keyHandlerEnabled = false;
      this._imeMode = false;
    }
    setOnClientStatus() {}
    setOnNotificationUpdate() {}
    setOnReconnectFlush() {}
    setGlobalKeyHandlerEnabled(v) { this._keyHandlerEnabled = v; }
    setFitEnabled(v) { this._fitEnabled = v; }
    setIMEMode(v) { this._imeMode = v; }
    setKeyboardMode() {}
    setToolbar() {}
    sendInput() {}
    fit() {}
    focus() {}
    disconnect() {}
    increaseFontSize() {}
    decreaseFontSize() {}
  }
  return { PalmuxTerminal: MockTerminal };
});

vi.mock('../ToolbarAdapter.js', () => {
  class MockToolbar {
    constructor() {
      this._visible = true;
      this._keyboardMode = 'none';
    }
    consumeModifiers() { return { ctrl: false, alt: false }; }
    toggleVisibility() { this._visible = !this._visible; }
    setCurrentSession() {}
    setClaudeWindow() {}
    restoreState() {}
    hasCtrl() { return false; }
    hasAlt() { return false; }
    get visible() { return this._visible; }
    get keyboardMode() { return this._keyboardMode; }
    get ctrlState() { return 'off'; }
    get altState() { return 'off'; }
    dispose() {}
  }
  return { ToolbarAdapter: MockToolbar };
});

vi.mock('../IMEInputAdapter.js', () => {
  class MockIME {
    constructor() {
      this._visible = false;
      this._barEl = document.createElement('div');
    }
    show() { this._visible = true; }
    hide() { this._visible = false; }
    toggle() { this._visible = !this._visible; }
    get isVisible() { return this._visible; }
    insertText() {}
    setPreviewText() {}
    setToolbar() {}
    getBarElement() { return this._barEl; }
    dispose() {}
  }
  return { IMEInputAdapter: MockIME };
});

vi.mock('../../../js/touch.js', () => ({
  TouchHandler: class MockTouch {
    constructor() {}
    destroy() {}
  },
}));

vi.mock('../VoiceInputAdapter.js', () => {
  class MockVoice {
    static isSupported() { return false; }
    constructor() {}
    dispose() {}
  }
  return { VoiceInputAdapter: MockVoice };
});

vi.mock('../../../js/connection.js', () => ({
  ConnectionManager: class MockConnection {
    constructor() { this.state = 'disconnected'; }
    connect() { this.state = 'connected'; }
    disconnect() { this.state = 'disconnected'; }
    reconnectNow() {}
  },
}));

vi.mock('../../../js/filebrowser.js', () => ({
  FileBrowser: class MockFileBrowser {
    constructor() {}
    open() {}
    navigateTo() {}
    getCurrentPath() { return '.'; }
    dispose() {}
    increaseFontSize() {}
    decreaseFontSize() {}
  },
}));

vi.mock('../../../js/gitbrowser.js', () => ({
  GitBrowser: class MockGitBrowser {
    constructor() {}
    open() {}
    dispose() {}
    increaseFontSize() {}
    decreaseFontSize() {}
  },
}));

import Panel from '../Panel.svelte';

describe('Panel.svelte', () => {
  let component;
  let target;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    // requestAnimationFrame mock for synchronous testing
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(); return 1; });
  });

  afterEach(() => {
    if (component) {
      try { unmount(component); } catch { /* already unmounted */ }
      component = null;
    }
    target.remove();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function mountPanel(props = {}) {
    component = mount(Panel, {
      target,
      props: {
        id: 'left',
        globalUIState: { toolbarVisible: true, keyboardMode: 'none' },
        isMobileDevice: () => false,
        ...props,
      },
    });
    flushSync();
    return component;
  }

  // --- Basic rendering ---

  describe('basic rendering', () => {
    it('renders a panel element', () => {
      mountPanel();
      const panel = target.querySelector('.panel');
      expect(panel).not.toBeNull();
      expect(panel.dataset.panelId).toBe('left');
    });

    it('starts with panel--single class', () => {
      mountPanel();
      const panel = target.querySelector('.panel');
      expect(panel.classList.contains('panel--single')).toBe(true);
    });
  });

  // --- Tab creation ---

  describe('tab creation', () => {
    it('creates a terminal tab via connectToWindow', () => {
      const panel = mountPanel();
      panel.connectToWindow('test-session', 0);
      flushSync();

      expect(panel.getActiveTabKey()).toBe('terminal:0');
      expect(panel.getSession()).toBe('test-session');
      expect(panel.getWindowIndex()).toBe(0);
    });

    it('creates a files tab via showFileBrowser', () => {
      const panel = mountPanel();
      panel.connectToWindow('test-session', 0);
      flushSync();
      panel.showFileBrowser('test-session');
      flushSync();

      expect(panel.getActiveTabKey()).toBe('files');
      expect(panel.getViewMode()).toBe('filebrowser');
    });

    it('creates a git tab via showGitBrowser', () => {
      const panel = mountPanel();
      panel.connectToWindow('test-session', 0);
      flushSync();
      panel.showGitBrowser('test-session');
      flushSync();

      expect(panel.getActiveTabKey()).toBe('git');
      expect(panel.getViewMode()).toBe('gitbrowser');
    });
  });

  // --- Tab switching ---

  describe('tab switching', () => {
    it('switches between terminal tabs', () => {
      const panel = mountPanel();
      panel.connectToWindow('test-session', 0);
      flushSync();

      panel.switchToTab('terminal:0');
      flushSync();
      expect(panel.getActiveTabKey()).toBe('terminal:0');
    });

    it('switches to files and back to terminal', () => {
      const panel = mountPanel();
      panel.connectToWindow('test-session', 0);
      flushSync();

      panel.showFileBrowser('test-session');
      flushSync();
      expect(panel.getViewMode()).toBe('filebrowser');

      panel.showTerminalView();
      flushSync();
      expect(panel.getViewMode()).toBe('terminal');
    });
  });

  // --- connectToWindow ---

  describe('connectToWindow', () => {
    it('clears tab cache on session change', () => {
      const panel = mountPanel();
      panel.connectToWindow('session1', 0);
      flushSync();

      // Switching to a different session should clear the cache
      panel.connectToWindow('session2', 1);
      flushSync();

      expect(panel.getSession()).toBe('session2');
      expect(panel.getWindowIndex()).toBe(1);
    });
  });

  // --- setFocused ---

  describe('setFocused', () => {
    it('adds panel--focused class when focused', () => {
      const panel = mountPanel();
      panel.setFocused(true);
      flushSync();

      expect(target.querySelector('.panel').classList.contains('panel--focused')).toBe(true);
    });

    it('removes panel--focused class when unfocused', () => {
      const panel = mountPanel();
      panel.setFocused(true);
      flushSync();
      panel.setFocused(false);
      flushSync();

      expect(target.querySelector('.panel').classList.contains('panel--focused')).toBe(false);
    });
  });

  // --- getElement ---

  describe('getElement', () => {
    it('returns the panel DOM element', () => {
      const panel = mountPanel();
      flushSync();
      const el = panel.getElement();
      expect(el).not.toBeNull();
      expect(el.classList.contains('panel')).toBe(true);
    });
  });

  // --- cleanup ---

  describe('cleanup', () => {
    it('clears all state', () => {
      const panel = mountPanel();
      panel.connectToWindow('test', 0);
      flushSync();

      panel.cleanup();
      flushSync();

      expect(panel.getSession()).toBeNull();
      expect(panel.getWindowIndex()).toBeNull();
    });
  });

  // --- Focus request callback ---

  describe('focus request', () => {
    it('fires onFocusRequest on mousedown', () => {
      const onFocusRequest = vi.fn();
      mountPanel({ onFocusRequest });
      flushSync();

      const panel = target.querySelector('.panel');
      panel.dispatchEvent(new Event('mousedown', { bubbles: true }));

      expect(onFocusRequest).toHaveBeenCalled();
    });
  });
});
