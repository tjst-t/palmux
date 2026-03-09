// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock xterm.js ---
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor() {
      this.cols = 80;
      this.rows = 24;
      this.options = { fontSize: 14 };
      this.unicode = { activeVersion: '6' };
      this.buffer = { active: { viewportY: 0 } };
    }
    loadAddon() {}
    open() {}
    onData() {}
    write(data, cb) { if (cb) cb(); }
    clear() {}
    reset() {}
    dispose() {}
    focus() {}
    attachCustomKeyEventHandler() {}
    select() {}
    getSelection() {}
    clearSelection() {}
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class { fit() {} },
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(),
}));

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: vi.fn(),
}));

vi.mock('@xterm/addon-clipboard', () => ({
  ClipboardAddon: vi.fn(),
}));

vi.mock('../api.js', () => ({
  uploadImage: vi.fn(),
}));

import { PalmuxTerminal } from '../terminal.js';

describe('PalmuxTerminal reconnect flush callback', () => {
  let container;
  let terminal;

  beforeEach(() => {
    container = document.createElement('div');
    terminal = new PalmuxTerminal(container);
  });

  it('should have _onReconnectFlush initialized to null', () => {
    expect(terminal._onReconnectFlush).toBeNull();
  });

  it('should set callback via setOnReconnectFlush', () => {
    const cb = vi.fn();
    terminal.setOnReconnectFlush(cb);
    expect(terminal._onReconnectFlush).toBe(cb);
  });

  it('should call _onReconnectFlush after flushing with data', () => {
    const cb = vi.fn();
    terminal.setOnReconnectFlush(cb);

    // Simulate reconnect state: set up _term and buffer
    terminal._initTerminal();
    terminal._reconnectBuffer = ['hello', ' world'];
    terminal._reconnectBufferTimer = null;

    terminal._flushReconnectBuffer();

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('should call _onReconnectFlush after flushing with empty buffer', () => {
    const cb = vi.fn();
    terminal.setOnReconnectFlush(cb);

    terminal._initTerminal();
    terminal._reconnectBuffer = [];
    terminal._reconnectBufferTimer = null;

    terminal._flushReconnectBuffer();

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('should not throw when _onReconnectFlush is null', () => {
    terminal._initTerminal();
    terminal._reconnectBuffer = ['data'];
    terminal._reconnectBufferTimer = null;

    expect(() => terminal._flushReconnectBuffer()).not.toThrow();
  });
});
